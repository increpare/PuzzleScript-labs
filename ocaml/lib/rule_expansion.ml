open Domain
open Syntax
open Rule_ir

let error = Compile_diagnostics.fatal

let unique values =
  List.fold_left
    (fun acc value -> if List.mem value acc then acc else acc @ [ value ])
    [] values

let source_lookup declarations line name = Rule_names.source declarations ~line name
let lookup declarations _line name = Rule_names.selection declarations name

let movement_choices direction qualifier =
  match Option.bind qualifier (Qualifier.movements direction) with
  | None -> [ None ]
  | Some movements -> List.map Option.some movements

let map_cells f rows =
  List.mapi
    (fun row cells -> List.mapi (fun cell -> map_contents (f (row, cell))) cells)
    rows

let terms_with_addresses rows =
  List.mapi
    (fun row cells ->
      List.mapi
        (fun cell contents ->
          List.map (fun term -> ((row, cell), term)) (cell_contents contents))
        cells
      |> List.concat)
    rows
  |> List.concat

let expand_aggregates ~report declarations line rows =
  map_cells
    (fun _ terms ->
      let rec expand reversed = function
        | [] -> List.rev reversed
        | term :: rest -> (
            match
              Compiled_names.aggregate declarations.Source_declarations.compiled_names
                term.term_name
            with
            | Some (first :: others) ->
                if term.qualifier = Some Qualifier.No then
                  report line
                    ("You cannot use 'no' to exclude the aggregate object "
                   ^ Utf8.uppercase term.term_name
                   ^ " (defined using 'AND'), only regular objects, or properties \
                      (objects defined using 'OR').  If you want to do this, you'll have \
                      to write it out yourself the long way.");
                expand
                  ({ term with term_name = first } :: reversed)
                  (rest @ List.map (fun term_name -> { term with term_name }) others)
            | Some [] | None -> expand (term :: reversed) rest)
      in
      expand [] terms)
    rows

let rephrase_aliases declarations rows =
  map_cells
    (fun _ terms ->
      List.map
        (fun term ->
          match
            Compiled_names.alias declarations.Source_declarations.compiled_names
              term.term_name
          with
          | None -> term
          | Some term_name -> { term with term_name })
        terms)
    rows

let rule_identity declarations authored direction lhs rhs =
  let canonicalize =
    map_cells (fun _ terms ->
        List.map
          (fun term ->
            let term_name =
              match lookup declarations authored.rule_line term.term_name with
              | Object reference -> reference.source_name
              | Property _ | Aggregate _ -> term.term_name
            in
            let qualifier =
              match movement_choices direction term.qualifier with
              | [ Some movement ] -> Some (Qualifier.Movement movement)
              | _ -> term.qualifier
            in
            { term_name; qualifier })
          terms)
  in
  let lhs = canonicalize lhs and rhs = Option.map canonicalize rhs in
  let reverse =
    (not (List.exists (List.exists has_ellipsis_name) lhs))
    && List.mem direction [ Up; Left ]
  in
  let lhs = if reverse then List.map List.rev lhs else lhs in
  let rhs = if reverse then Option.map (List.map List.rev) rhs else rhs in
  let direction = if reverse then Direction.opposite direction else direction in
  {
    source_line = authored.rule_line;
    source_direction =
      (if List.exists (fun row -> List.length row > 1) lhs then Some direction else None);
    source_lhs = lhs;
    source_rhs = rhs;
    source_commands = authored.commands;
    source_rigid = authored.headers.rigid;
    source_random = authored.headers.random;
  }

let expand_rule ~report declarations authored : Oriented.t list =
  let line = authored.rule_line in
  List.iter
    (fun (_, term) ->
      if term.term_name <> "..." then
        ignore (source_lookup declarations line term.term_name))
    (terms_with_addresses authored.lhs
    @ terms_with_addresses (Option.value ~default:[] authored.rhs));
  let directions =
    List.concat_map Rule_header.expand_direction authored.headers.directions
  in
  let directional =
    List.exists (fun row -> List.length row > 1) authored.lhs
    || List.exists
         (fun (_, term) ->
           Option.fold ~none:false ~some:Qualifier.directional term.qualifier)
         (terms_with_addresses authored.lhs
         @ terms_with_addresses (Option.value ~default:[] authored.rhs))
  in
  let directions = if directions = [] then Direction.all else unique directions in
  let directions = if directional then directions else [ List.hd directions ] in
  let lhs = authored.lhs and rhs = authored.rhs in
  (match rhs with
  | Some rhs
    when List.length lhs <> List.length rhs
         || not (List.for_all2 (fun l r -> List.length l = List.length r) lhs rhs) ->
      error line
        "In a rule, each pattern to match on the left must have a corresponding pattern \
         on the right of equal length (number of cells)."
  | _ -> ());
  List.map
    (fun direction ->
      let absolute =
        map_cells (fun _ terms ->
            List.map
              (fun term ->
                match movement_choices direction term.qualifier with
                | [ Some movement ] ->
                    { term with qualifier = Some (Qualifier.Movement movement) }
                | _ -> term)
              terms)
      in
      let lhs = absolute lhs and rhs = Option.map absolute rhs in
      let reverse =
        (not (List.exists (List.exists has_ellipsis_name) lhs))
        && List.mem direction [ Up; Left ]
      in
      let normalize rows =
        expand_aggregates ~report declarations line rows |> rephrase_aliases declarations
      in
      Oriented.
        {
          authored;
          direction = (if reverse then Direction.opposite direction else direction);
          left = normalize (if reverse then List.map List.rev lhs else lhs);
          right =
            Option.map
              (fun rows -> normalize (if reverse then List.map List.rev rows else rows))
              rhs;
        })
    directions

let bind_rules ~report declarations sources =
  let invalid = ref false in
  let sides (source : Oriented.t) =
    Rule_bindings.{ left = source.left; right = Option.value ~default:[] source.right }
  in
  let apply (source : Oriented.t) (sides : Rule_bindings.sides) =
    {
      source with
      left = sides.left;
      right = Option.map (fun _ -> sides.right) source.right;
    }
  in
  let moved =
    List.concat_map
      (fun (source : Oriented.t) ->
        let expanded =
          Rule_bindings.movements ~direction:source.direction (sides source)
        in
        (match expanded.unresolved with
        | None -> ()
        | Some movement ->
            invalid := true;
            report source.authored.rule_line
              ("This rule has an ambiguous movement on the right-hand side, \"" ^ movement
             ^ "\", that can't be inferred from the left-hand side.  (either for every \
                ambiguous movement associated to an entity on the right there has to be \
                a corresponding one on the left attached to the same entity, OR, if \
                there's a single occurrence of a particular ambiguous movement on the \
                left, all properties of the same movement attached to the same object on \
                the right are assumed to be the same (or something like that))."));
        List.map (apply source) expanded.variants)
      sources
  in
  let bound =
    List.concat_map
      (fun (source : Oriented.t) ->
        let expanded = Rule_bindings.properties declarations (sides source) in
        (match expanded.unresolved with
        | None -> ()
        | Some property ->
            report source.authored.rule_line
              ("This rule has a property on the right-hand side, \""
             ^ Utf8.uppercase property
             ^ "\", that can't be inferred from the left-hand side.  (either for every \
                property on the right there has to be a corresponding one on the left in \
                the same cell, OR, if there's a single occurrence of a particular \
                property name on the left, all properties of the same name on the right \
                are assumed to be the same)."));
        List.map (apply source) expanded.variants)
      moved
  in
  if !invalid then raise Compile_diagnostics.Stop;
  List.map
    (fun (source : Oriented.t) ->
      let source =
        if source.authored.headers.late then source
        else apply source (Rule_bindings.stationary_spawns declarations (sides source))
      in
      let identity =
        rule_identity declarations source.authored source.direction source.left
          source.right
      in
      match Bound.of_oriented ~identity source with
      | Ok bound -> bound
      | Error (Unresolved_movement qualifier) ->
          error source.authored.rule_line
            ("Unresolved movement qualifier: " ^ Qualifier.to_string qualifier)
      | Error Mismatched_patterns ->
          error source.authored.rule_line
            "In a rule, each pattern to match on the left must have a corresponding \
             pattern on the right of equal length (number of cells).")
    bound

let compile ~report declarations entries =
  let sources =
    List.concat_map
      (function Rule authored -> expand_rule ~report declarations authored | _ -> [])
      entries
  in
  let variants = bind_rules ~report declarations sources in
  (* Visit backwards so the last occurrence in each source group survives. *)
  let _, _, kept =
    List.fold_left
      (fun (group, seen, kept) (variant : Bound.t) ->
        let source_group = variant.authored.group_line in
        let seen = if group = Some source_group then seen else Identities.empty in
        if Identities.mem variant.identity seen then (Some source_group, seen, kept)
        else (Some source_group, Identities.add variant.identity seen, variant :: kept))
      (None, Identities.empty, []) (List.rev variants)
  in
  kept

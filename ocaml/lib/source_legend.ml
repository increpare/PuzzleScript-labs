open Syntax
module Names = Domain.Names

type 'a registration = { registration_line : int; value : 'a }

type t = {
  objects : int Names.t;
  aliases : string registration Names.t;
  properties : string list registration Names.t;
  aggregates : string list registration Names.t;
}

type resolution =
  | Object_name of string
  | Property_name of string * string list
  | Aggregate_name of string * string list
  | Undeclared_name of string

let first name value names =
  if Names.mem name names then names else Names.add name value names

let register declaration registry =
  match declaration.expression with
  | Alias value ->
      {
        registry with
        aliases =
          first declaration.legend_name
            { registration_line = declaration.legend_line; value }
            registry.aliases;
      }
  | Alternatives value ->
      {
        registry with
        properties =
          first declaration.legend_name
            { registration_line = declaration.legend_line; value }
            registry.properties;
      }
  | Constituents value ->
      {
        registry with
        aggregates =
          first declaration.legend_name
            { registration_line = declaration.legend_line; value }
            registry.aggregates;
      }

let of_declarations objects legend =
  let registry, aliases =
    List.fold_left
      (fun (registry, aliases) declaration ->
        let registry =
          {
            registry with
            objects =
              Names.add declaration.object_name declaration.object_line registry.objects;
          }
        in
        (registry, aliases @ object_legend_aliases declaration))
      ( {
          objects = Names.empty;
          aliases = Names.empty;
          properties = Names.empty;
          aggregates = Names.empty;
        },
        [] )
      objects
  in
  List.stable_sort
    (fun left right -> compare left.legend_line right.legend_line)
    (aliases @ legend)
  |> List.fold_left (fun registry declaration -> register declaration registry) registry

let declared registry name =
  match Names.find_opt name registry.objects with
  | Some line -> Some line
  | None ->
      let line names =
        Option.map (fun entry -> entry.registration_line) (Names.find_opt name names)
      in
      List.find_map Fun.id
        [ line registry.aggregates; line registry.properties; line registry.aliases ]

let lookup registry name =
  let rec visit seen name =
    if Names.mem name registry.objects then Object_name name
    else if List.mem name seen then Undeclared_name name
    else
      match Names.find_opt name registry.aliases with
      | Some entry -> visit (name :: seen) entry.value
      | None -> (
          match
            ( Names.find_opt name registry.aggregates,
              Names.find_opt name registry.properties )
          with
          | Some entry, _ -> Aggregate_name (name, entry.value)
          | None, Some entry -> Property_name (name, entry.value)
          | None, None -> Undeclared_name name)
  in
  visit [] name

type phase = Name | Equals | Member | Operator

exception Limit

let read_line ?(diagnostics_before = 0) ?(previous = []) ~reserved_names ~errors_before
    objects (input : Source_line.t) =
  let diagnostics = ref [] in
  let report line severity message =
    diagnostics :=
      Diagnostics.normalize
        (!diagnostics @ [ { location = Some { line; column = 1 }; severity; message } ]);
    if diagnostics_before + List.length !diagnostics > 100 then raise Limit
  in
  let check_limit () =
    if
      errors_before + Diagnostics.error_count !diagnostics > 5
      || diagnostics_before + List.length !diagnostics > 100
    then raise Limit
  in
  let bad_format =
    "Incorrect format of legend - should be one of \"A = B\", \"A = B or C [ or D \
     ...]\", \"A = B and C [ and D ...]\"."
  in
  let finish registry line splits =
    let issue = report line Error_severity and warn = report line Warning_severity in
    if splits = [] then None
    else if List.length splits = 1 then (
      issue bad_format;
      None)
    else if List.length splits mod 2 = 0 then (
      issue
        ("Incorrect format of legend - should be one of \"A = B\", \"A = B or C [ or D \
          ...]\", \"A = B and C [ and D ...]\", but it looks like you have a dangling \""
        ^ Utf8.uppercase (List.hd (List.rev splits))
        ^ "\"?");
      None)
    else
      let name = List.hd splits and valid = ref true in
      let invalid message =
        valid := false;
        issue message
      in
      (match declared registry name with
      | Some previous ->
          invalid
            ("Name \"" ^ Utf8.uppercase name ^ "\" already in use (on line line "
           ^ string_of_int previous ^ ").")
      | None -> ());
      if List.length (Utf8.utf16 name) > 1 && List.mem name reserved_names then
        warn
          ("You named an object \"" ^ Utf8.uppercase name
         ^ "\", but this is a keyword. Don't do that!");
      let splits = ref splits in
      let rec remove_self () =
        match
          List.find_index
            (fun (index, value) -> index >= 2 && value = name)
            (List.mapi (fun i value -> (i, value)) !splits)
        with
        | None -> ()
        | Some index ->
            let start = if index >= 4 then index - 1 else index in
            splits := List.filteri (fun i _ -> i < start || i >= start + 2) !splits;
            remove_self ()
      in
      let rec inspect index =
        match List.nth_opt !splits index with
        | None -> ()
        | Some member ->
            if member = name then (
              invalid
                ("You can't define object " ^ Utf8.uppercase name ^ " in terms of itself!");
              remove_self ());
            List.iteri
              (fun i previous ->
                if i >= 2 && i < index && i mod 2 = 0 && previous = member then
                  warn
                    ("You're repeating the object " ^ Utf8.uppercase member
                   ^ " here multiple times on the RHS.  This makes no sense.  Don't do \
                      that."))
              !splits;
            inspect (index + 2)
      in
      inspect 2;
      let members = List.filteri (fun i _ -> i >= 2 && i mod 2 = 0) !splits in
      List.iter
        (fun member ->
          if member <> name && declared registry member = None then
            issue
              ("You're talking about " ^ Utf8.uppercase member
             ^ " but it's not defined anywhere."))
        members;
      let rec expand aggregate seen member =
        match lookup registry member with
        | Object_name name | Undeclared_name name -> [ name ]
        | Aggregate_name (target, _) when not aggregate ->
            issue
              ("Cannot define a property (something defined in terms of 'or') in terms \
                of an aggregate (something that uses 'and').  In this case, you can't \
                define \"" ^ Utf8.uppercase name ^ "\" in terms of \""
             ^ Utf8.uppercase target ^ "\".");
            []
        | Property_name (target, _) when aggregate ->
            invalid
              "Cannot define an aggregate (using 'and') in terms of properties \
               (something that uses 'or').";
            [ target ]
        | Property_name (target, values) | Aggregate_name (target, values) ->
            if List.mem target seen then []
            else
              values
              |> List.filter (fun value -> aggregate || value <> target)
              |> List.concat_map (expand aggregate (target :: seen))
      in
      let expression =
        match !splits with
        | [ _; _; target ] ->
            let terminal =
              match lookup registry target with
              | Object_name n
              | Undeclared_name n
              | Property_name (n, _)
              | Aggregate_name (n, _) ->
                  n
            in
            if terminal = name then (
              issue
                ("You can't define object " ^ Utf8.uppercase name ^ " in terms of itself!");
              None)
            else Some (Alias target)
        | _ :: _ :: _ :: "and" :: _ ->
            Some (Constituents (List.concat_map (expand true []) members))
        | _ :: _ :: _ :: "or" :: _
          when List.for_all
                 (fun (i, word) -> i < 5 || i mod 2 = 0 || word = "or")
                 (List.mapi (fun i word -> (i, word)) !splits) -> (
            match List.concat_map (expand false []) members with
            | [] -> None
            | values -> Some (Alternatives values))
        | _ :: _ :: _ :: "or" :: _ -> None
        | _ ->
            if !valid then
              issue
                "This legend-entry is incorrectly-formatted - it should be one of A = B, \
                 A = B or C ( or D ...), A = B and C (and D ...)";
            None
      in
      Option.map
        (fun expression -> { legend_line = line; legend_name = name; expression })
        expression
  in
  let line = input.number and registry = of_declarations objects previous in
  let finished depth reversed = (finish registry line (List.rev reversed), depth) in
  let rec lex phase reversed depth text =
    let text = Source_line.left_trim text in
    if text = "" then finished depth reversed
    else if depth > 0 || text.[0] = '(' then
      let depth, rest = Source_line.comment depth text in
      if rest = "" then finished depth reversed else lex phase reversed depth rest
    else if text.[0] = ')' then (
      report line Warning_severity Source_line.close_warning;
      check_limit ();
      let rest = Source_line.drop 1 text in
      if rest = "" then (None, 0) else lex phase reversed 0 rest)
    else
      let text =
        match Source_sections.heading_prefix text with
        | None -> text
        | Some (_, ending) -> Source_line.drop ending text
      in
      if text = "" then finished 0 reversed
      else
        let value, rest, next =
          match phase with
          | Name ->
              let name, rest =
                Utf8.span
                  (fun cp -> (not (Utf8.whitespace cp)) && cp <> 61 && cp <> 40)
                  text
              in
              (Some name, rest, Equals)
          | Equals when String.starts_with ~prefix:"=" text ->
              (Some "=", String.sub text 1 (String.length text - 1), Member)
          | Equals ->
              report line Error_severity
                "In the legend, define new items using the equals symbol - declarations \
                 must look like \"A = B\", \"A = B or C [ or D ...]\", \"A = B and C [ \
                 and D ...]\".";
              (Some "ERROR", snd (Source_line.before_comment text), Member)
          | Member | Operator ->
              let name, rest = Utf8.identifier_prefix text in
              if name = "" then (
                report line Error_severity "Something bad's happening in the LEGEND";
                (None, snd (Source_line.before_comment text), Member))
              else (
                if phase = Operator then
                  if name <> "and" && name <> "or" then
                    report line Error_severity
                      ("Expected and 'AND' or an 'OR' here, but got "
                     ^ Utf8.uppercase name
                     ^ " instead. In the legend, define new items using the equals \
                        symbol - declarations must look like 'A = B' or 'A = B and C' or \
                        'A = B or C'.")
                  else if
                    List.length reversed >= 5 && List.nth (List.rev reversed) 3 <> name
                  then
                    report line Error_severity
                      "Hey! You can't go mixing ANDs and ORs in a single legend entry.";
                (Some name, rest, if phase = Member then Operator else Member))
        in
        let reversed =
          match value with None -> reversed | Some value -> value :: reversed
        in
        let rest = Source_line.left_trim rest in
        if rest = "" then (
          let result = finished 0 reversed in
          check_limit ();
          result)
        else (
          check_limit ();
          lex next reversed 0 rest)
  in
  try
    let declaration, comment_depth =
      lex Name [] input.comment_depth (Utf8.lowercase input.raw)
    in
    check_limit ();
    Ok
      Source_line.
        { value = Option.to_list declaration; comment_depth; diagnostics = !diagnostics }
  with Limit -> Error !diagnostics

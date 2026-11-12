open Domain
open Syntax
open Rule_ir

let discard_overlaps ~report variants =
  let describe = function
    | [] -> assert false
    | (left, right) :: others ->
        let parenthetical =
          if others = [] then ""
          else
            let rec format index = function
              | [] -> ""
              | (left, right) :: rest ->
                  (if index = 0 then "" else if rest = [] then ", and " else ", ")
                  ^ left ^ "/" ^ right
                  ^ if index = 2 && rest <> [] then " etc." else format (index + 1) rest
            in
            " (ditto for " ^ format 0 others ^ ")"
        in
        left ^ " and " ^ right ^ " can never overlap" ^ parenthetical
        ^ ". This rule requires that to happen, so it impossible it will ever trigger."
  in
  let rec visit kept conflicts = function
    | [] -> List.rev kept
    | variant :: rest -> (
        match variant.overlap with
        | None -> visit (variant :: kept) conflicts rest
        | Some pair ->
            let conflicts =
              if List.mem pair conflicts then conflicts else conflicts @ [ pair ]
            in
            let before =
              match kept with
              | previous :: _ -> previous.rule.line = variant.rule.line
              | [] -> false
            in
            let after =
              match rest with
              | next :: _ -> next.rule.line = variant.rule.line
              | [] -> false
            in
            if (not (before || after)) || (kept = [] && rest = []) then
              report variant.rule.line (describe conflicts);
            visit kept conflicts rest)
  in
  visit [] [] variants

let collect variants ~late =
  let add groups (variant : lowered) =
    if variant.late <> late then groups
    else
      match groups with
      | (source_group, reversed) :: rest when source_group = variant.source_group ->
          (source_group, variant :: reversed) :: rest
      | groups -> (variant.source_group, [ variant ]) :: groups
  in
  List.fold_left add [] variants |> List.rev_map (fun (_, reversed) -> List.rev reversed)

let schedule ~report variants ~late =
  let normalize variants =
    let variants = discard_overlaps ~report variants in
    let rigid = List.exists (fun variant -> variant.rule.rigid) variants in
    match variants with
    | [] -> None
    | first :: _ ->
        let rules = List.map (fun variant -> { variant.rule with rigid }) variants in
        Some { random = first.identity.source_random; rules }
  in
  let groups =
    collect variants ~late |> List.filter_map normalize |> Frozen_array.of_list
  in
  { groups; loops = Int_map.empty }

let check_gaps ~report ~warn schedule =
  Frozen_array.iter
    (fun (group : group) ->
      List.iter
        (fun (rule : rule) ->
          List.iter
            (fun row ->
              let rec count previous total = function
                | [] -> ()
                | Gap :: rest ->
                    let total = total + 1 in
                    if total > 2 then
                      report rule.line
                        "You can't use more than two ellipses in a single cell match \
                         pattern."
                    else if previous then
                      warn rule.line
                        "Why would you go and have two ellipses in a row like that? It's \
                         exactly the same as just having a single ellipsis, right?";
                    count true total rest
                | Cell _ :: rest -> count false total rest
              in
              count false 0 row)
            rule.rows)
        group.rules)
    schedule.groups

let check_rigid_limit ~report schedule =
  let rigid =
    Frozen_array.to_list schedule.groups
    |> List.filter (fun (group : group) ->
        List.exists (fun (rule : rule) -> rule.rigid) group.rules)
  in
  if List.length rigid > 30 then
    report (List.hd (List.nth rigid 30).rules).line
      "There can't be more than 30 rigid groups (rule groups containing rigid members)."

type loop_progress = Start_expected | End_expected of int
type loop_marker = Loop_start of int | Loop_end of int

let loop_pairs ~report entries =
  let consume (phase, pairs) marker =
    match (phase, marker) with
    | Start_expected, Loop_start line -> (End_expected line, pairs)
    | Start_expected, Loop_end line ->
        report line "Found an ENDLOOP, but I'm not in a loop?";
        (End_expected line, pairs)
    | End_expected first, Loop_end last -> (Start_expected, (first, last) :: pairs)
    | End_expected first, Loop_start last ->
        report last
          "Found a STARTLOOP, but I'm already inside a loop? (Puzzlescript can't nest \
           loops, FWIW).";
        (Start_expected, (first, last) :: pairs)
  in
  let phase, pairs =
    List.fold_left
      (fun state -> function
        | Start_loop line -> consume state (Loop_start line)
        | End_loop line -> consume state (Loop_end line)
        | _ -> state)
      (Start_expected, []) entries
  in
  match phase with
  | Start_expected -> List.rev pairs
  | End_expected line ->
      report line "Yo I found a STARTLOOP without a corresponding ENDLOOP.";
      List.rev ((line, line) :: pairs)

let attach_loops ~report pairs schedule =
  let loops =
    List.fold_left
      (fun loops (first, last) ->
        let rec visit index initial loops =
          if index = Frozen_array.length schedule.groups then loops
          else
            let rules = (Frozen_array.get schedule.groups index).rules in
            let first_line = (List.hd rules).line
            and last_line = (List.hd (List.rev rules)).line in
            if
              (first_line <= first && first <= last_line)
              || (first_line <= last && last <= last_line)
            then
              report first
                "Found a loop point in the middle of a rule. You probably don't want to \
                 do this, right?";
            if last < first_line then loops
            else if first <= first_line then
              let initial = Option.value ~default:index initial in
              let loops =
                if Int_map.find_opt (index - 1) loops = Some initial then
                  Int_map.remove (index - 1) loops
                else loops
              in
              visit (index + 1) (Some initial) (Int_map.add index initial loops)
            else visit (index + 1) initial loops
        in
        visit 0 None loops)
      Int_map.empty pairs
  in
  { schedule with loops }

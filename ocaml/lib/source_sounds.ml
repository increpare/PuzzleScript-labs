open Syntax

let events =
  [
    ("undo", Undo_event);
    ("restart", Restart_event);
    ("titlescreen", Title_event);
    ("startgame", Start_game_event);
    ("cancel", Cancel_event);
    ("endgame", End_game_event);
    ("startlevel", Start_level_event);
    ("endlevel", End_level_event);
    ("showmessage", Show_message_event);
    ("closemessage", Close_message_event);
  ]
  @ List.init 11 (fun n -> ("sfx" ^ string_of_int n, Slot_event n))

let event_name event =
  List.find_map (fun (name, value) -> if value = event then Some name else None) events
  |> Option.get

let declares_event event =
  List.exists (function
    | Incomplete_sound { declared_event = Some candidate; _ }
    | Event_sound { sound_event = candidate; _ } ->
        candidate = event
    | _ -> false)

let verbs =
  [
    ("move", Move_sound);
    ("action", Action_sound);
    ("create", Create_sound);
    ("destroy", Destroy_sound);
    ("cantmove", Failure_sound);
  ]

let verb_name verb =
  List.find_map (fun (name, value) -> if value = verb then Some name else None) verbs
  |> Option.get

let directions =
  [
    ("up", [ Domain.Move Direction.Up ]);
    ("down", [ Move Down ]);
    ("left", [ Move Left ]);
    ("right", [ Move Right ]);
    ("horizontal", [ Move Left; Move Right ]);
    ("vertical", [ Move Up; Move Down ]);
    ("orthogonal", List.map (fun d -> Domain.Move d) Direction.all);
  ]

let ascii_word = function
  | 'a' .. 'z' | 'A' .. 'Z' | '0' .. '9' | '_' -> true
  | _ -> false

let boundary text = text = "" || not (ascii_word text.[0])
let left_trim text = snd (Utf8.span Utf8.whitespace text)

let direction_boundary text =
  match Utf8.scalars text with
  | [] -> true
  | (cp, _) :: _ -> not (Utf8.identifier_character cp)

let prefix boundary table text =
  List.find_map
    (fun (name, value) ->
      if not (String.starts_with ~prefix:name text) then None
      else
        let rest =
          String.sub text (String.length name) (String.length text - String.length name)
        in
        if boundary rest then Some (name, value, left_trim rest) else None)
    table

let seed_prefix text =
  let digits, rest = Utf8.span (fun cp -> cp >= 48 && cp <= 57) text in
  if digits <> "" && boundary rest then Some (digits, rest) else None

let fallback_rest text =
  let token, rest =
    Utf8.span (fun cp -> (not (Utf8.whitespace cp)) && cp <> 40 && cp <> 41) text
  in
  if token <> "" then (token, left_trim rest) else Utf8.span (( <> ) 40) text

let fallback text = Utf8.trim (fst (fallback_rest text))

let recover text =
  match prefix boundary events text with
  | Some (_, _, rest) -> rest
  | None -> (
      match prefix boundary verbs text with
      | Some (_, _, rest) -> rest
      | None -> (
          match prefix direction_boundary directions text with
          | Some (_, _, rest) -> rest
          | None ->
              (* The legacy recovery consumes a numeric prefix, then tries a name/fallback
     in the same visit. Preserve that progress without treating suffixes as new
     declarations or reporting additional grammar errors. *)
              let rest =
                match seed_prefix text with None -> text | Some (_, rest) -> rest
              in
              let name, remaining = Utf8.identifier_prefix rest in
              if name <> "" then left_trim remaining else snd (fallback_rest rest)))

type phase =
  | Start
  | Event_seed of sound_event
  | Object_verb of string
  | Object_seed of string * sound_verb * (string * Domain.movement list) list
  | Complete of sound_entry * string
  | Failed

exception Limit

let read_line ?(diagnostics_before = 0) ~known_names ~errors_before
    (input : Source_line.t) =
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
  let line = input.number in
  let issue = report line Error_severity and warn = report line Warning_severity in
  let object_sound target verb directions seed =
    let sound_directions =
      if verb = Action_sound then Domain.Movements.singleton Domain.Action
      else
        (if directions = [] then List.map (fun d -> Domain.Move d) Direction.all
         else List.concat_map snd directions)
        |> Domain.Movements.of_list
    in
    Object_sound
      {
        sound_line = line;
        sound_target = target;
        sound_verb = verb;
        sound_directions;
        object_seed = seed;
      }
  in
  let finish = function
    | Start | Failed -> None
    | Complete (declaration, _) -> Some declaration
    | Event_seed event ->
        Some (Incomplete_sound { sound_line = line; declared_event = Some event })
    | Object_verb _ ->
        Some (Incomplete_sound { sound_line = line; declared_event = None })
    | Object_seed (target, verb, []) ->
        Some (object_sound target verb [] (Recovered_seed (verb_name verb)))
    | Object_seed (target, verb, (last, _) :: earlier) ->
        Some (object_sound target verb earlier (Recovered_seed last))
  in
  let finished depth phase = (finish phase, depth) in
  let rec scan phase depth text =
    let text = left_trim text in
    if text = "" then finished depth phase
    else if depth > 0 || text.[0] = '(' then
      let depth, rest = Source_line.comment depth text in
      if rest = "" then finished depth phase else scan phase depth rest
    else if text.[0] = ')' then (
      warn Source_line.close_warning;
      check_limit ();
      let rest = String.sub text 1 (String.length text - 1) in
      (* This early return bypasses end-of-line registration. An additional
         whitespace/token visit can still finalize the pending declaration. *)
      if rest = "" then (None, 0) else scan phase 0 rest)
    else
      let text =
        match Source_sections.heading_prefix text with
        | None -> text
        | Some (_, ending) -> Source_line.drop ending text
      in
      if text = "" then finished 0 phase
      else
        let next, rest =
          match phase with
          | Failed -> (Failed, recover text)
          | Start -> (
              match prefix boundary events text with
              | Some (_, event, rest) -> (Event_seed event, rest)
              | None ->
                  let name, rest = Utf8.identifier_prefix text in
                  if name = "" then (
                    warn
                      "Was expecting a sound event (like SFX3, or ENDLEVEL) or an object \
                       name, but didn't find either.";
                    (Failed, snd (fallback_rest text)))
                  else if List.mem name known_names then (Object_verb name, left_trim rest)
                  else (
                    (match
                       (List.assoc_opt name verbs, List.assoc_opt name directions)
                     with
                    | Some _, _ ->
                        issue
                          ("Sound verb \"" ^ Utf8.uppercase name
                         ^ "\" needs an entity before it, e.g. \"Player "
                         ^ Utf8.uppercase name ^ " 12345\".")
                    | None, Some _ ->
                        issue
                          ("Sound direction \"" ^ Utf8.uppercase name
                         ^ "\" needs an entity and MOVE or CANTMOVE before it, e.g. \
                            \"Player MOVE " ^ Utf8.uppercase name ^ " 12345\".")
                    | None, None -> issue ("unexpected sound token \"" ^ name ^ "\"."));
                    (Failed, left_trim rest)))
          | Event_seed event -> (
              match seed_prefix text with
              | Some (seed, rest) ->
                  ( Complete
                      ( Event_sound
                          { sound_line = line; sound_event = event; event_seed = seed },
                        seed ),
                    rest )
              | None ->
                  issue
                    "Was expecting a sound seed here (a number like 123123, like you \
                     generate by pressing the buttons above the console panel), but \
                     found something else.";
                  (Failed, snd (fallback_rest text)))
          | Object_verb target -> (
              match prefix boundary verbs text with
              | Some (_, verb, rest) -> (Object_seed (target, verb, []), rest)
              | None ->
                  issue
                    ("Was expecting a sound verb here (e.g. MOVE, DESTROY, CANTMOVE, or \
                      the like), but found something else. Try \"" ^ Utf8.uppercase target
                   ^ " MOVE 12345\" or \"" ^ Utf8.uppercase target ^ " ACTION 12345\".");
                  (Failed, snd (fallback_rest text)))
          | Object_seed (target, verb, seen) -> (
              let direction =
                if verb = Move_sound || verb = Failure_sound then
                  prefix direction_boundary directions text
                else None
              in
              match (direction, seed_prefix text) with
              | Some (name, values, rest), _ ->
                  (Object_seed (target, verb, (name, values) :: seen), rest)
              | None, Some (seed, rest) ->
                  ( Complete (object_sound target verb seen (Numeric_seed seed), seed),
                    rest )
              | None, None ->
                  let after =
                    match seen with [] -> verb_name verb | (last, _) :: _ -> last
                  in
                  issue
                    ("Ah I was expecting "
                    ^ (if verb = Move_sound || verb = Failure_sound then
                         "direction or a sound seed"
                       else "a sound seed")
                    ^ " here after " ^ Utf8.uppercase after
                    ^ ", but I don't know what to make of \""
                    ^ Utf8.uppercase (fallback text)
                    ^ "\".");
                  (Failed, snd (fallback_rest text)))
          | Complete (_, last) ->
              issue
                ("I wasn't expecting anything after the sound declaration "
               ^ Utf8.uppercase last ^ " on this line, so I don't know what to do with \""
                ^ Utf8.uppercase (fallback text)
                ^ "\" here.");
              (Failed, snd (fallback_rest text))
        in
        check_limit ();
        if rest = "" then finished 0 next else scan next 0 rest
  in
  try
    let declaration, comment_depth =
      scan Start input.comment_depth (Utf8.lowercase input.raw)
    in
    Ok
      Source_line.
        { value = Option.to_list declaration; comment_depth; diagnostics = !diagnostics }
  with Limit -> Error !diagnostics

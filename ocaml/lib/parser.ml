open Syntax
module Published = Set.Make (String)

exception Diagnostics_limit of diagnostic list

let reserved_names =
  List.filter (( <> ) "orthogonal") Qualifier.keywords
  @ [
      "objects";
      "collisionlayers";
      "legend";
      "sounds";
      "rules";
      "winconditions";
      "levels";
      "...";
      "|";
      "[";
      "]";
      "late";
      "rigid";
      "any";
      "all";
      "some";
      "message";
      "move";
      "create";
      "destroy";
      "cantmove";
      "cancel";
      "restart";
      "win";
      "again";
      "undo";
      "titlescreen";
      "startgame";
      "endgame";
      "startlevel";
      "endlevel";
      "showmessage";
      "closemessage";
    ]
  @ List.init 11 (fun index -> "sfx" ^ string_of_int index)

(* Declaration readers are persistent. The parser owns only routing, source
   publication and the accumulated document; each body reader owns comments. *)
type state = {
  sections : Source_sections.t;
  objects : Source_objects.t;
  metadata : Source_metadata.t;
  legend_rev : legend_declaration list;
  sounds_rev : sound_entry list;
  rules_rev : rule_entry list;
  wins_rev : win_entry list;
  layers : collision_layer list;
  levels : raw_level list;
  published : Published.t;
  diagnostics : diagnostic list;
}

let initial =
  {
    sections = Source_sections.initial;
    objects = Source_objects.initial;
    metadata = Source_metadata.initial;
    legend_rev = [];
    sounds_rev = [];
    rules_rev = [];
    wins_rev = [];
    layers = [];
    levels = [];
    published = Published.empty;
    diagnostics = [];
  }

let declarations state = Source_objects.declarations state.objects
let legend state = List.rev state.legend_rev
let error_count state = Diagnostics.error_count state.diagnostics
let diagnostic_count state = List.length state.diagnostics

let add_diagnostics issues state =
  let diagnostics = Diagnostics.normalize (state.diagnostics @ issues) in
  if Diagnostics.error_count diagnostics > 5 || List.length diagnostics > 100 then
    raise (Diagnostics_limit diagnostics);
  { state with diagnostics }

let accept state = function
  | Ok (value, diagnostics) -> (value, add_diagnostics diagnostics state)
  | Error diagnostics ->
      let state = add_diagnostics diagnostics state in
      raise (Diagnostics_limit state.diagnostics)

let accept_line state = function
  | Error diagnostics ->
      let state = add_diagnostics diagnostics state in
      raise (Diagnostics_limit state.diagnostics)
  | Ok (reading : _ Source_line.reading) ->
      let state = add_diagnostics reading.diagnostics state in
      let sections =
        Source_sections.with_comment_depth reading.comment_depth state.sections
      in
      (reading.value, { state with sections })

let with_comment_depth depth state =
  { state with sections = Source_sections.with_comment_depth depth state.sections }

let preceding_diagnostics reader_diagnostics state =
  ( max 0 (error_count state - Diagnostics.error_count reader_diagnostics),
    max 0 (diagnostic_count state - List.length reader_diagnostics) )

let object_line ~comment_depth line state =
  let aliases =
    List.filter_map
      (fun declaration ->
        match declaration.expression with
        | Alias _ -> Some declaration.legend_name
        | _ -> None)
      (legend state)
  in
  let reader = Source_objects.add_aliases aliases state.objects in
  let errors_before, diagnostics_before =
    preceding_diagnostics (Source_objects.diagnostics reader) state
  in
  let objects =
    Source_objects.feed_raw ~diagnostics_before ~reserved_names ~errors_before
      ~comment_depth reader line
  in
  { state with objects }
  |> add_diagnostics (Source_objects.diagnostics objects)
  |> with_comment_depth (Source_objects.comment_depth objects)

let metadata_line ~comment_depth line state =
  let errors_before, diagnostics_before =
    preceding_diagnostics (Source_metadata.diagnostics state.metadata) state
  in
  let metadata =
    Source_metadata.feed ~diagnostics_before ~errors_before ~comment_depth state.metadata
      line
  in
  { state with metadata }
  |> add_diagnostics (Source_metadata.diagnostics metadata)
  |> with_comment_depth (Source_metadata.comment_depth metadata)

let known_names state =
  List.concat_map object_names (declarations state)
  @ List.map (fun declaration -> declaration.legend_name) (legend state)

let read_body section (line : Source_line.t) state =
  let diagnostics_before = diagnostic_count state and errors_before = error_count state in
  let published_names = Published.elements state.published in
  match section with
  | Source_sections.Legend ->
      let entries, state =
        accept_line state
          (Source_legend.read_line ~diagnostics_before ~previous:(legend state)
             ~reserved_names ~errors_before (declarations state) line)
      in
      { state with legend_rev = List.rev_append entries state.legend_rev }
  | Layers ->
      let registry = Source_legend.of_declarations (declarations state) (legend state) in
      let layers, state =
        accept_line state
          (Source_layers.read_line ~diagnostics_before ~registry ~previous:state.layers
             ~errors_before line)
      in
      { state with layers }
  | Wins ->
      let entries, state =
        accept_line state
          (Source_wins.read_line ~diagnostics_before ~known_names:published_names
             ~errors_before line)
      in
      { state with wins_rev = List.rev_append entries state.wins_rev }
  | Rules ->
      let entries, state =
        accept_line state
          (Source_rules.read_line ~diagnostics_before ~known_names:published_names
             ~errors_before line)
      in
      { state with rules_rev = List.rev_append entries state.rules_rev }
  | Sounds ->
      let entries, state =
        accept_line state
          (Source_sounds.read_line ~diagnostics_before ~known_names:(known_names state)
             ~errors_before line)
      in
      { state with sounds_rev = List.rev_append entries state.sounds_rev }
  | Metadata ->
      metadata_line ~comment_depth:line.comment_depth (line.number, line.raw) state
  | Objects -> object_line ~comment_depth:line.comment_depth (line.number, line.raw) state
  | Levels -> assert false (* The complete remaining block goes to read_levels. *)

let read_levels remaining state =
  let known_glyphs =
    List.concat_map object_names (declarations state)
    @ List.filter_map
        (fun declaration ->
          match declaration.expression with
          | Alias _ | Constituents _ -> Some declaration.legend_name
          | Alternatives _ -> None)
        (legend state)
    |> List.filter (fun name -> List.length (Code_unit.of_utf8 name) = 1)
  in
  let comment_depth = Source_sections.comment_depth state.sections in
  let lines =
    List.map (fun (number, raw) -> Source_levels.{ number; raw; comment_depth }) remaining
  in
  let levels, state =
    accept state
      (Source_levels.read ~diagnostics_before:(diagnostic_count state) ~known_glyphs
         ~errors_before:(error_count state) lines)
  in
  { state with levels }

let enter_section section state =
  match section with
  | Source_sections.Objects ->
      { state with objects = Source_objects.reset_section state.objects }
  | Sounds ->
      let published =
        List.fold_left
          (fun names name -> Published.add name names)
          state.published (known_names state)
      in
      { state with published }
  | Metadata | Legend | Layers | Rules | Wins | Levels -> state

let read_line (number, raw) state =
  let before = Source_sections.section state.sections in
  let comment_depth = Source_sections.comment_depth state.sections in
  let sections, event, issues =
    Source_sections.line ~errors_before:(error_count state)
      ~diagnostics_before:(diagnostic_count state) state.sections ~number raw
  in
  let state = add_diagnostics issues { state with sections } in
  match event with
  | Header section -> enter_section section state
  | Ignored -> (
      match before with
      | Metadata | Objects | Legend | Layers | Wins | Rules | Sounds ->
          read_body before Source_line.{ number; raw; comment_depth } state
      | Levels -> state)
  | Blank when before = Objects -> object_line ~comment_depth:0 (number, "") state
  | Blank | Separator -> state
  | Content line -> read_body before line state

let document state =
  {
    objects = declarations state;
    legend = legend state;
    rules = List.rev state.rules_rev;
    rule_names = Published.elements state.published;
    collision_layers = state.layers;
    sounds = List.rev state.sounds_rev;
    wins = List.rev state.wins_rev;
    levels = state.levels;
    metadata = Source_metadata.entries state.metadata;
    diagnostics = state.diagnostics;
  }

let parse source =
  let rec read state remaining =
    match (Source_sections.section state.sections, remaining) with
    | Levels, remaining -> read_levels remaining state
    | _, [] -> state
    | _, line :: rest -> read (read_line line state) rest
  in
  let lines =
    String.split_on_char '\n' source |> List.mapi (fun index raw -> (index + 1, raw))
  in
  try Ok (document (read initial lines))
  with Diagnostics_limit diagnostics -> Error diagnostics

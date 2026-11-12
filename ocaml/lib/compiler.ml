open Domain
open Syntax

let board (game : game) rows =
  let context =
    Level_compiler.
      {
        glyphs = game.glyphs;
        property_names =
          Names.bindings game.names
          |> List.filter_map (function name, Property _ -> Some name | _ -> None);
        layers = game.layers;
        background_id = Option.bind game.background (fun reference -> reference.object_id);
        background_layer =
          Option.bind game.background (fun reference -> reference.source_layer);
      }
  in
  let rows =
    List.mapi
      (fun index text ->
        { level_line = index + 1; glyphs = Code_unit.of_utf8 (Utf8.lowercase text) })
      rows
  in
  match Level_compiler.grid context rows with
  | Error diagnostics -> Error diagnostics
  | Ok compiled when compiled.diagnostics <> [] -> Error compiled.diagnostics
  | Ok compiled -> Ok compiled.board

type compilation = { game : game; document : document; diagnostics : diagnostic list }

let require_special_names ~global_error (document : document) =
  let declared name =
    List.exists
      (fun declaration -> List.mem name (object_names declaration))
      document.objects
    || List.exists (fun declaration -> declaration.legend_name = name) document.legend
  in
  List.iter
    (fun name ->
      if not (declared name) then
        global_error
          ("Error, didn't find any object called " ^ name
         ^ ", either in the objects section, or the legends section. There must be a "
         ^ name ^ "!"))
    [ "player"; "background" ]

let background ~add ~global_error (declarations : Source_declarations.t)
    (document : document) =
  let fallback_background =
    if Frozen_array.length declarations.definitions = 0 then None
    else
      Names.find_opt (Frozen_array.get declarations.definitions 0).name
        declarations.actuals
  in
  let background =
    let actual = Names.find_opt "background" declarations.actuals in
    let line =
      List.find_map
        (fun declaration ->
          if declaration.legend_name = "background" then Some declaration.legend_line
          else None)
        (List.rev document.legend)
    in
    let located message =
      add
        [
          {
            location = Option.map (fun line -> { line; column = 1 }) line;
            severity = Error_severity;
            message;
          };
        ]
    in
    match actual with
    | Some _ -> actual
    | None -> (
        let alias = Compiled_names.alias declarations.compiled_names "background" in
        let property = Compiled_names.property declarations.compiled_names "background" in
        match (alias, property) with
        | Some target, _ -> (
            match Names.find_opt target declarations.actuals with
            | Some reference -> Some reference
            | None -> fallback_background)
        | None, Some (first :: rest) -> (
            match Names.find_opt first declarations.actuals with
            | None -> None
            | Some reference ->
                List.iter
                  (fun name ->
                    match Names.find_opt name declarations.actuals with
                    | Some other when other.source_layer <> reference.source_layer ->
                        located "Background objects must be on the same layer"
                    | _ -> ())
                  rest;
                Some reference)
        | None, _
          when Compiled_names.aggregate declarations.compiled_names "background" <> None
          ->
            add
              [
                {
                  location = Option.map (fun line -> { line; column = 1 }) line;
                  severity = Error_severity;
                  message =
                    "background cannot be an aggregate (declared with 'and'), it has to \
                     be a simple type, or property (declared in terms of others using \
                     'or').";
                };
              ];
            fallback_background
        | None, Some [] -> fallback_background
        | None, None ->
            global_error "Seriously, you have to define something to be the background.";
            fallback_background)
  in
  background

let compile_levels ~add level_context (document : document) =
  List.map
    (function
      | Level_text authored ->
          let text, issues = Level_compiler.message authored in
          add issues;
          Text text
      | Grid rows -> (
          match Level_compiler.grid level_context rows with
          | Ok compiled ->
              add compiled.diagnostics;
              Board (Board.rows compiled.board)
          | Error (diagnostic :: _) -> raise (Compile_diagnostics.Invalid diagnostic)
          | Error [] -> assert false))
    document.levels
  |> Frozen_array.of_list

let compile (document : document) =
  let diagnostics = Compile_diagnostics.create () in
  let add = Compile_diagnostics.add diagnostics in
  let report line message =
    Compile_diagnostics.report diagnostics ~line Error_severity message
  in
  let warn line message =
    Compile_diagnostics.report diagnostics ~line Warning_severity message
  in
  let global_error = Compile_diagnostics.report diagnostics Error_severity in
  try
    let discarded_diagnostics =
      List.concat_map
        (function Discarded_rule rejected -> rejected.diagnostics | _ -> [])
        document.rules
    in
    add (document.diagnostics @ discarded_diagnostics);
    require_special_names ~global_error document;
    let declarations =
      match Source_declarations.compile document with
      | Ok declarations -> declarations
      | Error issues ->
          add issues;
          raise Compile_diagnostics.Stop
    in
    add (Source_metadata.check_palettes document.metadata);
    add (Source_assets.check document.objects);
    add declarations.glyph_diagnostics;
    add declarations.name_diagnostics;
    if Frozen_array.length declarations.definitions = 0 then
      global_error "You need to have some objects defined";
    let background = background ~add ~global_error declarations document in
    let player = declarations.player in
    if members player = [] then
      global_error
        "Error, didn't find any object called player, either in the objects section, or \
         the legends section.";
    let level_context =
      Level_compiler.
        {
          glyphs = declarations.glyphs;
          property_names = List.map fst (Names.bindings declarations.properties);
          layers = declarations.collision;
          background_id = Option.bind background (fun reference -> reference.object_id);
          background_layer =
            Option.bind background (fun reference -> reference.source_layer);
        }
    in
    let levels = compile_levels ~add level_context document in
    let prepared_rules = Rule_compiler.prepare ~diagnostics declarations document in
    let wins = Win_compiler.compile ~report declarations document.wins in
    add declarations.unlayered;
    let metadata, metadata_diagnostics = Source_metadata.compile document.metadata in
    add metadata_diagnostics;
    let sounds = Sound_compiler.compile ~report ~warn declarations document.sounds in
    let early, late = Rule_compiler.finish ~diagnostics prepared_rules in
    add (Source_metadata.check_presentation document.metadata);
    if document.levels = [] then global_error "No levels found.  Add some levels!";
    let game =
      {
        objects = declarations.definitions;
        names = declarations.namespace;
        glyphs = declarations.glyphs;
        layers = declarations.collision;
        background;
        player;
        early;
        late;
        wins;
        levels;
        metadata;
        sounds;
      }
    in
    let diagnostics = Compile_diagnostics.all diagnostics in
    if Diagnostics.error_count diagnostics > 5 then Error diagnostics
    else Ok { game; document; diagnostics }
  with
  | Compile_diagnostics.Invalid issue ->
      Error (Compile_diagnostics.rejected diagnostics [ issue ])
  | Compile_diagnostics.Stop -> Error (Compile_diagnostics.all diagnostics)

let source text = Result.bind (Parser.parse text) compile

open Puzzlescript
open Domain

let expect message condition = if not condition then failwith message

let rejects message operation =
  expect message
    (try
       ignore (operation ());
       false
     with Invalid_argument _ -> true)

let accepted = function
  | Ok value -> value
  | Error errors ->
      failwith
        (String.concat "; " (List.map (fun (d : Syntax.diagnostic) -> d.message) errors))

let source =
  {|title Immutable pushing
objects
Background
black

Player
white

Crate
red

Wall
blue

legend
. = Background
P = Player
C = Crate
# = Wall

sounds

collisionlayers
Background
Player, Crate, Wall

rules
([ Player ] -> [ Wall ] This comment must never become a rule.)
[ > Player | Crate ] -> [ > Player | > Crate ]

winconditions
no Player

levels
PC.#
|}

let () =
  List.iter
    (fun (authored, expected) ->
      expect ("Unicode lowercase: " ^ authored) (Utf8.lowercase authored = expected))
    [
      ("PLAYER", "player");
      ("АБВ", "абв");
      ("ΟΣ", "ος");
      ("ΟΣΑ", "οσα");
      ("ΟΣ́", "ος́");
      ("İ", "i̇");
      ("K", "k");
      ("ẞ", "ß");
      ("𐐀", "𐐨");
    ];
  expect "Unicode whitespace separates identifiers"
    (Utf8.words "Player Crate\tWall" = [ "Player"; "Crate"; "Wall" ]);
  expect "NEXT LINE is not ECMAScript whitespace"
    (Utf8.words "Player\194\133Crate" = [ "Player\194\133Crate" ]);
  expect "lowercasing preserves decomposed spelling" (Utf8.lowercase "É" = "é");
  expect "lowercasing does not case-fold sharp s" (Utf8.lowercase "Straße" = "straße");
  expect "diagnostic uppercasing uses the full Unicode mapping"
    (Utf8.uppercase "straße" = "STRASSE");
  expect "observable name sorting uses UTF-16 units"
    (Utf8.compare_utf16 "𐐀" "\238\128\128" < 0);
  List.iter
    (fun (source, expected) ->
      expect "Sigma context crosses case-ignorable ASCII punctuation"
        (Utf8.lowercase source = expected))
    [ ("Α'Σ", "α'ς"); ("ΟΣ'Α", "οσ'α"); ("ΟΣ.Α", "οσ.α"); ("ΟΣ'", "ος'") ];
  rejects "Prefix scanning validates an invalid suffix before accepting a token"
    (fun () -> Utf8.span (fun cp -> cp = Char.code 'a') "a \128");
  List.iter
    (fun source ->
      rejects "The strict source boundary rejects malformed UTF-8" (fun () ->
          Compiler.source source))
    [ "\192\175"; "\226\130"; "\237\160\128"; "\244\144\128\128"; "\128" ];
  rejects "RNG seeds must be nonempty" (fun () -> Random_stream.create "");
  rejects "RNG choices require a positive collection size" (fun () ->
      Random_stream.choose 0 (Random_stream.create "boundary"));
  (* These byte vectors were independently obtained from the pinned vanilla
     RNG, including UTF-16 surrogate handling rather than UTF-8 seeding. *)
  List.iter
    (fun (seed, expected) ->
      let random = Random_stream.create seed in
      expect ("seed bytes: " ^ seed) (Random_stream.preview 8 random = expected);
      let _, after = Random_stream.choose 1 random in
      expect "singleton choices consume seven bytes"
        (fst (Random_stream.indices after) = 7);
      expect "drawing preserves the incoming RNG snapshot"
        (Random_stream.preview 8 random = expected);
      let _, same_after = Random_stream.choose 1 random in
      expect "persistent RNG branches agree" (Random_stream.equal after same_after))
    [
      ("example", [ 67; 139; 232; 152; 89; 244; 17; 7 ]);
      ("é", [ 45; 138; 81; 86; 161; 244; 163; 56 ]);
      ("Ā", [ 196; 153; 27; 74; 58; 131; 249; 127 ]);
      ("😀", [ 118; 75; 184; 170; 83; 47; 139; 49 ]);
      ("a\000b", [ 54; 72; 200; 30; 153; 100; 123; 88 ]);
    ];
  let compilation = accepted (Compiler.source source) in
  let game = compilation.game and document = compilation.document in
  let parsed =
    Source_rules.compile ~known_names:document.rule_names
      ~is_property:(fun _ -> false)
      ~sounds:document.sounds document.rules
  in
  let authored =
    List.find_map (function Syntax.Rule rule -> Some rule | _ -> None) parsed.entries
    |> Option.get
  in
  let identity =
    Rule_ir.
      {
        source_line = authored.rule_line;
        source_direction = Some Direction.Right;
        source_lhs = authored.lhs;
        source_rhs = authored.rhs;
        source_commands = authored.commands;
        source_rigid = authored.headers.rigid;
        source_random = authored.headers.random;
      }
  in
  let oriented qualifier =
    Rule_ir.Oriented.
      {
        authored;
        direction = Direction.Right;
        left =
          [ [ [ Syntax.Named { term_name = "player"; qualifier = Some qualifier } ] ] ];
        right = None;
      }
  in
  List.iter
    (fun qualifier ->
      expect "Unresolved movement choices cannot enter bound rule IR"
        (Rule_ir.Bound.of_oriented ~identity (oriented qualifier)
        = Error (Unresolved_movement qualifier)))
    Qualifier.[ Moving; Axis Horizontal; Parallel; Relative Forward ];
  let bound =
    Result.get_ok
      (Rule_ir.Bound.of_oriented ~identity (oriented (Qualifier.Movement Action)))
  in
  expect "Bound rule IR retains concrete action movement"
    (match bound.rows with
    | [
     [
       {
         detection = [ Rule_ir.Bound.Named { qualifier = Movement Action; _ } ];
         replacement = None;
       };
     ];
    ] ->
        true
    | _ -> false);
  let mismatched = { (oriented (Qualifier.Movement Action)) with right = Some [] } in
  expect "Mismatched replacement shapes cannot enter bound rule IR"
    (Rule_ir.Bound.of_oriented ~identity mismatched = Error Mismatched_patterns);
  let exported = Frozen_array.to_array game.objects in
  let original = exported.(0) in
  let imported = Frozen_array.of_array exported in
  exported.(0) <- { original with name = "corrupted" };
  expect "Exported object arrays cannot mutate a compiled game"
    ((Frozen_array.get game.objects 0).name = original.name);
  expect "Imported indexed collections own their storage"
    ((Frozen_array.get imported 0).name = original.name);
  expect "Negative RNG preview counts fail before drawing"
    (try
       ignore (Random_stream.preview (-1) (Random_stream.create "preview"));
       false
     with Invalid_argument _ -> true);

  let message_source prefix =
    Str.global_replace
      (Str.regexp_string "levels\nPC.#")
      ("levels\n" ^ prefix ^ "\nP.")
      source
  in
  let message prefix =
    match
      Frozen_array.get (accepted (Compiler.source (message_source prefix))).game.levels 0
    with
    | Text text -> text
    | _ -> failwith "Expected a captured message level"
  in
  expect "ordinary astral messages remain valid UTF-8" (message "message 😀" = "😀");
  expect "case expansion before a message preserves legacy UTF-16 slicing"
    (Json.to_string (Json.String (message "(İ)message 😀")) = "\"\\ude00\"");
  let literal = accepted (Compiler.source (message_source "(leading)message (literal")) in
  expect "literal message parentheses cannot swallow a following grid"
    (Frozen_array.length literal.game.levels = 2);
  expect "literal message parentheses do not change comment nesting"
    (literal.diagnostics = []);
  let commented_sprite =
    Str.global_replace
      (Str.regexp_string "Background\nblack")
      "Background\n\
       black white\n\
       00000\n\
       (comment-only lines preserve the sprite)\n\
       01110\n\
       01010\n\
       01110\n\
       00000"
      source
  in
  let sprite_game = (accepted (Compiler.source commented_sprite)).game in
  expect "comment-only lines do not end sprite data"
    ((Frozen_array.get sprite_game.objects
        (Option.get (Option.get sprite_game.background).object_id))
       .sprite
    = [ "00000"; "01110"; "01010"; "01110"; "00000" ]);
  let detached_pixels =
    Str.global_replace
      (Str.regexp_string "Wall\nblue")
      ".333.\n.232.\n.333.\n\nWall\nblue" source
  in
  let recovered = accepted (Compiler.source detached_pixels) in
  expect "detached invalid sprite rows do not register objects"
    (Frozen_array.length recovered.game.objects = 4);
  expect "discarded object junk remains diagnosed" (List.length recovered.diagnostics = 3);
  let partial_sprite =
    Str.global_replace
      (Str.regexp_string "Crate\nred")
      "Crate\nred\n00x00\n00000\n00000\n00000\n00000" source
    |> Compiler.source |> accepted
  in
  expect "invalid sprite tokens retain the actual parsed prefix"
    ((Frozen_array.find_opt
        (fun (definition : object_definition) -> definition.name = "crate")
        partial_sprite.game.objects
     |> Option.get)
       .sprite
    = [ "00"; "00000"; "00000"; "00000"; "00000" ]);
  let unlayered =
    Str.global_replace (Str.regexp_string "Wall\nblue") "Ghost\nred\n\nWall\nblue" source
    |> Compiler.source |> accepted
  in
  expect "recovered references retain missing source-layer information"
    (match Names.find "ghost" unlayered.game.names with
    | Object reference ->
        reference.object_id
        = Option.bind unlayered.game.background (fun reference -> reference.object_id)
        && reference.source_layer = None
    | _ -> false);
  let invalid_screens =
    accepted (Compiler.source ("flickscreen broken\nzoomscreen -2x1.5\n" ^ source))
  in
  expect "invalid screen metadata is removed while compilation continues"
    (invalid_screens.game.metadata.flickscreen = None
    && invalid_screens.game.metadata.zoomscreen = None);
  expect "invalid dimensions are warnings"
    (List.length invalid_screens.diagnostics = 4
    && List.for_all
         (fun (diagnostic : Syntax.diagnostic) -> diagnostic.severity = Warning_severity)
         invalid_screens.diagnostics);
  let empty = Board.create ~width:2 ~height:1 in
  rejects "Regular boards require positive dimensions" (fun () ->
      Board.create ~width:0 ~height:1);
  rejects "Regular boards reject negative dimensions" (fun () ->
      Board.create ~width:1 ~height:(-1));
  rejects "Rows must form a rectangle" (fun () -> Board.of_rows [ [ empty_cell ]; [] ]);
  rejects "Reading outside the board is rejected" (fun () -> Board.get empty (-1, 0));
  rejects "Writing outside the board is rejected" (fun () ->
      Board.set empty (2, 0) empty_cell);
  expect "Rejected operations preserve the board"
    (Board.rows empty = [ [ empty_cell; empty_cell ] ]);
  let occupied =
    Board.set empty (0, 0) { empty_cell with objects = Int_set.singleton 7 }
  in
  let twice =
    Board.set occupied (1, 0) { empty_cell with objects = Int_set.singleton 7 }
  in
  let once = Board.set twice (0, 0) empty_cell in
  let absent = Board.set once (1, 0) empty_cell in
  expect "presence tracks all occurrences, not just the most recent cell"
    (Board.has_object 7 once && not (Board.has_object 7 absent));
  expect "presence updates preserve earlier snapshots"
    (Board.has_object 7 occupied && not (Board.has_object 7 empty));
  expect "position indexes preserve earlier snapshots"
    (Board.positions_of_any [ 7 ] twice = [ (0, 0); (1, 0) ]
    && Board.positions_of_any [ 7 ] once = [ (1, 0) ]
    && Board.object_count 7 twice = 2);
  let indexed =
    Board.of_rows
      [
        [
          { empty_cell with objects = Int_set.of_list [ 7; 8 ] };
          { empty_cell with objects = Int_set.singleton 8 };
        ];
        [ { empty_cell with objects = Int_set.singleton 7 }; empty_cell ];
      ]
  in
  expect "union index removes duplicate coordinates and follows row order"
    (Board.positions_of_any [ 7; 8 ] indexed = [ (0, 0); (1, 0); (0, 1) ]);
  expect "union index follows column order when requested"
    (Board.positions_of_any ~vertical:true [ 7; 8 ] indexed = [ (0, 0); (0, 1); (1, 0) ]);
  expect "unchanged cell edits share the board"
    (Board.set occupied (0, 0) (Board.get occupied (0, 0)) == occupied);
  let environment =
    Session.{ next_level_seed = (fun index -> "test:" ^ string_of_int index) }
  in
  rejects "An explicit replay level must exist" (fun () ->
      Session.create game environment ~seed:"test" ~level:9);
  let before, _ = Session.create game environment ~seed:"test" ~level:0 in
  let original = Board.serialize game before.execution.board in
  let moved, _ = Session.step game environment (Session.Movement (Move Right)) before in
  let rows = Board.names game moved.execution.board in
  expect "push moved both entities"
    (rows
    = [
        [
          [ "background" ];
          [ "background"; "player" ];
          [ "background"; "crate" ];
          [ "background"; "wall" ];
        ];
      ]);
  expect "session input leaves its predecessor intact"
    (Board.serialize game before.execution.board = original);
  let undone, _ = Session.step game environment Session.Undo moved in
  expect "undo restores the actual earlier board"
    (Board.equal_objects before.execution.board undone.execution.board);
  expect "undo consumes one history boundary" (undone.history = []);
  let blocked, _ = Session.step game environment (Session.Movement (Move Right)) moved in
  expect "blocked push has no board effect"
    (Board.equal_objects blocked.execution.board moved.execution.board);
  expect "blocked push adds no undo boundary" (List.length blocked.history = 1);
  let bad = Str.global_replace (Str.regexp_string "Crate ]") "Unknown ]" source in
  expect "unknown rule objects fail compilation" (Result.is_error (Compiler.source bad));
  print_endline "OCaml core contracts passed"

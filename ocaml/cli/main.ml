open Puzzlescript
open Domain
open Json

module Observation = struct
  type t = Initial | Input | Again

  let name = function Initial -> "initial" | Input -> "input" | Again -> "again"
end

type saved_request = { level : int; grid : string option }

type startup =
  | At_title of saved_request option
  | Start_level of int
  | Restore of saved_request

type request = Compile_only | Direct_replay of int | Interactive of startup

let request ~compile_only ~interactive ~title ~resume ~grid ~level =
  let saved =
    if resume || grid <> "" then
      Some { level; grid = (if grid = "" then None else Some grid) }
    else None
  in
  if compile_only then Compile_only
  else if title then Interactive (At_title saved)
  else if interactive || Option.is_some saved then
    Interactive
      (match saved with None -> Start_level level | Some saved -> Restore saved)
  else Direct_replay level

let read_file filename = In_channel.with_open_bin filename In_channel.input_all
let emit json = print_endline (Json.to_string json)
let strings values = Json.Array (List.map (fun value -> Json.String value) values)
let integers values = Json.Array (List.map (fun value -> Json.Int value) values)

let diagnostic (d : Syntax.diagnostic) =
  Json.Object
    [
      ("line", match d.location with None -> Null | Some p -> Int p.line);
      ("column", match d.location with None -> Null | Some p -> Int p.column);
      ("message", String d.message);
      ( "severity",
        String
          (match d.severity with
          | Error_severity -> "error"
          | Warning_severity -> "warning") );
    ]

let viewport = function
  | None -> Json.Null
  | Some (view : Session.viewport) ->
      Object
        [
          ("left", Int view.left);
          ("top", Int view.top);
          ("right", Int view.right);
          ("bottom", Int view.bottom);
        ]

module Board_cache = Ephemeron.K1.Make (struct
  type t = Board.t

  let equal a b = a == b
  let hash = Board.hash
end)

module History_cache = Ephemeron.K1.Make (struct
  type t = Session.snapshot list

  let equal a b = a == b

  let hash = function
    | [] -> 0
    | (head : Session.snapshot) :: _ -> Hashtbl.hash (Board.hash head.board, head.viewport)
end)

let board_cache = Board_cache.create 64
let history_cache = History_cache.create 64
let hash text = Digest.BLAKE512.(to_hex (string text))

let board_text game board =
  match Board_cache.find_opt board_cache board with
  | Some text -> text
  | None ->
      let text = Board.serialize game board in
      Board_cache.add board_cache board text;
      text

let snapshot_digest game (value : Session.snapshot) =
  let view =
    match value.viewport with
    | None -> "none"
    | Some v ->
        String.concat "," (List.map string_of_int [ v.left; v.top; v.right; v.bottom ])
  in
  hash
    (Printf.sprintf "%dx%d\n%s\n%s" (Board.width value.board) (Board.height value.board)
       view (board_text game value.board))

let rec history_digest game history =
  match History_cache.find_opt history_cache history with
  | Some digest -> digest
  | None ->
      let digest =
        match history with
        | [] -> hash "puzzlescript-history-v1"
        | head :: tail -> hash (snapshot_digest game head ^ ":" ^ history_digest game tail)
      in
      History_cache.add history_cache history digest;
      digest

let snapshot ~state_digests game (value : Session.snapshot) =
  Object
    [
      ( (if state_digests then "boardDigest" else "board"),
        String
          (if state_digests then snapshot_digest game value
           else board_text game value.board) );
      ("width", Int (Board.width value.board));
      ("height", Int (Board.height value.board));
      ("viewport", viewport value.viewport);
    ]

let command = function
  | Again -> "again"
  | Cancel -> "cancel"
  | Restart -> "restart"
  | Checkpoint -> "checkpoint"
  | Win -> "win"
  | Message _ -> "message"
  | Sound index -> "sfx" ^ string_of_int index

let input = function
  | "up" | "0" -> Session.Movement (Move Direction.Up)
  | "left" | "1" -> Session.Movement (Move Direction.Left)
  | "down" | "2" -> Session.Movement (Move Direction.Down)
  | "right" | "3" -> Session.Movement (Move Direction.Right)
  | "action" | "4" -> Session.Movement Action
  | "tick" -> Session.Tick
  | "undo" -> Session.Undo
  | "restart" -> Session.Restart_input
  | "advance" -> Session.Advance
  | token -> invalid_arg ("Unknown input: " ^ token)

let trace ~compact ~state_digests game state phase sounds played diagnostics
    saved_progress saved_checkpoint events =
  let i, j = Random_stream.indices state.Session.execution.random in
  Json.Object
    ([
       ("phase", String (Observation.name phase));
       ("board", String (Board.serialize game state.execution.board));
       ("level", Int state.level);
       ("history", Int (List.length state.history));
       ("again", Bool (Session.again state));
       ( (if state_digests then "historyDigest" else "historyBoards"),
         if state_digests then String (history_digest game state.history)
         else Array (List.map (snapshot ~state_digests game) (List.rev state.history)) );
       ("restartTarget", snapshot ~state_digests game state.restart_target);
       ("restartIsCheckpoint", Bool state.checkpoint);
       ("viewport", viewport state.viewport);
       ("loadedSeed", String state.loaded_seed);
       ("message", String (Execution.message_text state.execution));
       ("commands", strings (List.map command state.execution.commands));
       ( "screen",
         String
           (match state.screen with
           | Playing -> "board"
           | Title -> "title"
           | Level_message _ | Rule_message _ -> "message") );
       ( "rng",
         Object
           [
             ("i", Int i);
             ("j", Int j);
             ("preview", integers (Random_stream.preview 8 state.execution.random));
             ("permutation", integers (Random_stream.permutation state.execution.random));
           ] );
       ("sounds", strings sounds);
       ("playedSounds", strings played);
       ( "savedProgress",
         match saved_progress with None -> Null | Some progress -> String progress );
       ( "savedCheckpoint",
         match saved_checkpoint with
         | None -> Null
         | Some value -> snapshot ~state_digests game value );
       ("events", Array events);
       ("diagnostics", strings diagnostics);
     ]
    @
    if compact then []
    else
      [
        ( "rows",
          Array
            (List.map
               (fun row -> Json.Array (List.map strings row))
               (Board.names game state.execution.board)) );
      ])

let run () =
  let seed = ref "example"
  and level = ref 0
  and compact = ref false
  and compile_only = ref false
  and state_digests = ref false in
  let interactive = ref false
  and title = ref false
  and resume = ref false
  and resume_grid = ref "" in
  let positional = ref [] in
  Arg.parse
    [
      ("--seed", Arg.Set_string seed, "Explicit nonempty RNG seed");
      ("--level", Arg.Set_int level, "Zero-based initial level");
      ("--interactive", Arg.Set interactive, "Use timed interactive controls");
      ("--title", Arg.Set title, "Begin interactive play on the title screen");
      ("--resume", Arg.Set resume, "Restore saved progress at --level");
      ( "--resume-grid",
        Arg.Set_string resume_grid,
        "Restore checkpoint glyph rows separated by /" );
      ("--compact", Arg.Set compact, "Omit redundant named-cell rows from traces");
      ( "--state-digests",
        Arg.Set state_digests,
        "Fingerprint complete saved boards with BLAKE2b-512" );
      ( "--compile-only",
        Arg.Set compile_only,
        "Compile source and report diagnostics without running a session" );
    ]
    (fun value -> positional := value :: !positional)
    "PuzzleScript OCaml: [--seed SEED] [--level INDEX] SOURCE [INPUT ...]";
  let request =
    request ~compile_only:!compile_only ~interactive:!interactive ~title:!title
      ~resume:!resume ~grid:!resume_grid ~level:!level
  in
  match List.rev !positional with
  | [] -> invalid_arg "Provide a PuzzleScript source file"
  | filename :: inputs -> (
      match Compiler.source (read_file filename) with
      | Error diagnostics ->
          emit
            (Object
               [
                 ("phase", String "compile");
                 ("accepted", Bool false);
                 ("errorCount", Int (Diagnostics.error_count diagnostics));
                 ("diagnostics", Array (List.map diagnostic diagnostics));
               ]);
          exit 2
      | Ok compilation -> (
          let game = compilation.game in
          emit
            (Object
               [
                 ("phase", String "compile");
                 ("accepted", Bool true);
                 ("errorCount", Int (Diagnostics.error_count compilation.diagnostics));
                 ("unicodeVersion", String Uucp.unicode_version);
                 ("diagnostics", Array (List.map diagnostic compilation.diagnostics));
               ]);
          let environment =
            Session.
              { next_level_seed = (fun index -> !seed ^ ":level:" ^ string_of_int index) }
          in
          let sounds = ref []
          and played = ref []
          and saved_progress = ref None
          and saved_checkpoint = ref None
          and events = ref [] in
          let recording_start = ref !level in
          let capture ?(extra = []) phase (state, effects) =
            if phase = Observation.Initial then recording_start := state.Session.level;
            let persist operation key value =
              events :=
                !events
                @ [
                    Object
                      ([
                         ("kind", String "persistence");
                         ("operation", String operation);
                         ("key", String key);
                       ]
                      @ match value with None -> [] | Some value -> [ ("value", value) ]);
                  ]
            in
            List.iter
              (function
                | Session.Sound_effect { seed; simple } ->
                    played := !played @ [ seed ];
                    if not simple then sounds := !sounds @ [ seed ];
                    events :=
                      !events
                      @ [
                          Object
                            [
                              ("kind", String "sound");
                              ("seed", String seed);
                              ("simple", Bool simple);
                            ];
                        ]
                | Persistence (Set_progress progress) ->
                    let progress = string_of_int progress in
                    saved_progress := Some progress;
                    persist "set" "progress" (Some (String progress))
                | Persistence (Set_checkpoint target) ->
                    saved_checkpoint := Some target;
                    persist "set" "checkpoint"
                      (Some (snapshot ~state_digests:!state_digests game target))
                | Persistence Clear_progress ->
                    saved_progress := None;
                    persist "remove" "progress" None
                | Persistence Clear_checkpoint ->
                    saved_checkpoint := None;
                    persist "remove" "checkpoint" None
                | Clear_recording level ->
                    recording_start := level;
                    sounds := []
                | _ -> ())
              effects;
            (* Vanilla's compile/load recording boundary clears recorded sounds
               after startup rules, while audible requests remain observable. *)
            if phase = Observation.Initial then sounds := [];
            let diagnostics =
              List.filter_map
                (function Session.Diagnostic message -> Some message | _ -> None)
                effects
            in
            let value =
              trace ~compact:!compact ~state_digests:!state_digests game state phase
                !sounds !played diagnostics !saved_progress !saved_checkpoint !events
            in
            emit
              (match value with
              | Object fields ->
                  Object
                    (fields @ [ ("recordingStartLevel", Int !recording_start) ] @ extra)
              | _ -> assert false);
            state
          in
          match request with
          | Compile_only -> ()
          | Interactive startup ->
              let checkpoint_grid text =
                match Compiler.board game (String.split_on_char '/' text) with
                | Ok board -> Some Session.{ board; viewport = None }
                | Error _ -> invalid_arg "Invalid checkpoint glyph grid"
              in
              let restore saved =
                let checkpoint_board = Option.bind saved.grid checkpoint_grid in
                saved_progress := Some (string_of_int saved.level);
                saved_checkpoint := checkpoint_board;
                Session.{ level_index = saved.level; checkpoint_board }
              in
              let opened =
                match startup with
                | At_title saved ->
                    Player.create ?progress:(Option.map restore saved) game ~seed:!seed
                | Start_level level -> Player.start game environment ~seed:!seed ~level
                | Restore saved ->
                    Player.resume game environment ~seed:!seed (restore saved)
              in
              let player =
                match opened with
                | Ok value -> value
                | Error _ -> invalid_arg "Invalid saved progress or initial level"
              in
              let capture_player phase (player, effects) =
                let extra =
                  [
                    ("winning", Bool (Session.winning player.Player.session));
                    ("timerMs", Float player.timer_ms);
                    ("autotickMs", Float player.autotick_ms);
                    ("inputThrottleMs", Float player.input_throttle_ms);
                    ( "lastDirection",
                      match player.last_direction with
                      | None -> Null
                      | Some direction -> String (Direction.to_string direction) );
                    ("ignoreHeldAction", Bool (Player.ignore_held_action player));
                    ("messageSelected", Bool (Player.message_selected player));
                    ( "choice",
                      String
                        (if player.session.screen <> Title then "none"
                         else
                           match player.choice with
                           | New_game -> "new"
                           | Continue -> "continue") );
                    ( "transition",
                      String
                        (match Player.transition player with
                        | Idle -> "idle"
                        | Leaving_title | Leaving_both -> "title"
                        | Closing_message -> "message") );
                    ( "titlePending",
                      Bool
                        (match Player.transition player with
                        | Leaving_title | Leaving_both -> true
                        | _ -> false) );
                    ( "messagePending",
                      Bool
                        (match Player.transition player with
                        | Closing_message | Leaving_both -> true
                        | _ -> false) );
                    ("canContinue", Bool (Player.can_continue player));
                  ]
                in
                ignore (capture ~extra phase (player.session, effects));
                player
              in
              let state = capture_player Observation.Initial player in
              ignore
                (List.fold_left
                   (fun state token ->
                     let result =
                       if String.starts_with ~prefix:"storage:" token then (
                         let spec = String.sub token 8 (String.length token - 8) in
                         let progress =
                           if spec = "none" then None
                           else
                             let level, checkpoint_board =
                               match String.index_opt spec ':' with
                               | None -> (int_of_string spec, None)
                               | Some split ->
                                   ( int_of_string (String.sub spec 0 split),
                                     checkpoint_grid
                                       (String.sub spec (split + 1)
                                          (String.length spec - split - 1)) )
                             in
                             Some Session.{ level_index = level; checkpoint_board }
                         in
                         match Player.observe_progress game progress state with
                         | Error _ -> invalid_arg "Invalid observed saved progress"
                         | Ok state ->
                             saved_progress :=
                               Option.map
                                 (fun value -> string_of_int value.Session.level_index)
                                 progress;
                             saved_checkpoint :=
                               Option.bind progress (fun value ->
                                   value.Session.checkpoint_board);
                             (state, []))
                       else if String.starts_with ~prefix:"wait:" token then
                         Player.elapse game environment
                           ~milliseconds:
                             (float_of_string
                                (String.sub token 5 (String.length token - 5)))
                           state
                       else
                         let repeated = String.starts_with ~prefix:"repeat:" token in
                         let token =
                           if repeated then String.sub token 7 (String.length token - 7)
                           else token
                         in
                         let button =
                           if token = "menu" then Player.Menu
                           else
                             match input token with
                             | Movement (Move direction) -> Player.Direction direction
                             | Movement Action -> Player.Action
                             | Undo -> Player.Undo
                             | Restart_input -> Player.Restart
                             | _ ->
                                 invalid_arg
                                   "Interactive inputs are directions, action, undo, \
                                    restart, menu and wait:MS"
                         in
                         Player.press ~repeated game environment button state
                     in
                     capture_player Observation.Input result)
                   state inputs)
          | Direct_replay level ->
              let state =
                capture Observation.Initial
                  (Session.create game environment ~seed:!seed ~level)
              in
              ignore
                (List.fold_left
                   (fun state token ->
                     let state =
                       capture Observation.Input
                         (Session.step game environment (input token) state)
                     in
                     let rec drain count state =
                       if not (Session.again state) then state
                       else if count = 1000 then
                         failwith "AGAIN continuation limit reached"
                       else
                         drain (count + 1)
                           (capture Observation.Again
                              (Session.step game environment Session.Tick state))
                     in
                     drain 0 state)
                   state inputs)))

let () =
  try run () with
  | Invalid_argument message | Failure message ->
      prerr_endline message;
      exit 1
  | Sys_error message ->
      prerr_endline message;
      exit 1

open Puzzlescript
open Domain

let expect message value = if not value then failwith message

let value = function
  | Ok value -> value
  | Error _ -> failwith "Expected a valid transition"

let source =
  {|title Interactive contracts
objects
Background
black

Player
white

Crate
red

legend
. = Background
P = Player
C = Crate

sounds

collisionlayers
Background
Player, Crate

rules
[ action Player ] -> [ Player ] message Hello

winconditions
no Player

levels
P..

message Middle

P..
|}

let () =
  let compilation =
    match Compiler.source source with
    | Ok game -> game
    | Error _ -> failwith "Compile contract source"
  in
  let game = compilation.game in
  let environment =
    Session.{ next_level_seed = (fun index -> "interactive:" ^ string_of_int index) }
  in
  let player, _ = value (Player.start game environment ~seed:"interactive" ~level:0) in
  let message, _ = Player.press game environment Player.Action player in
  expect "Rule messages have an explicit screen"
    (message.session.screen
    = Rule_message { text = "Hello"; continuation = Resume Check_board });
  expect "Opening a message preserves the previous state" (player.session.screen = Playing);
  let pressed, _ = Player.press game environment Player.Action message in
  let boundary, _ = Player.elapse game environment ~milliseconds:150. pressed in
  expect "The message boundary is strict"
    (boundary.session.screen
    = Rule_message { text = "Hello"; continuation = Resume Check_board });
  let dismissed, _ = Player.elapse game environment ~milliseconds:1. boundary in
  expect "Dismissal returns to the unchanged board"
    (dismissed.session.screen = Playing
    && Board.equal player.session.execution.board dismissed.session.execution.board);
  expect "A later frame cannot mutate the boundary snapshot"
    (Player.transition boundary = Closing_message);
  let duplicate, _ = Player.elapse game environment ~milliseconds:1. boundary in
  expect "Persistent time branches agree"
    (Board.equal duplicate.session.execution.board dismissed.session.execution.board
    && Player.transition duplicate = Player.transition dismissed);
  let progress checkpoint =
    Session.{ level_index = 0; checkpoint_board = Some checkpoint }
  in
  let checkpoint : Session.snapshot =
    { board = player.session.execution.board; viewport = None }
  in
  expect "A valid snapshot can be loaded"
    (Session.validate_progress game (progress checkpoint) = Ok ());
  let restored, _ =
    value (Player.resume game environment ~seed:"restored" (progress checkpoint))
  in
  expect "Restoration uses the supplied seed"
    (Random_stream.equal restored.session.execution.random
       (Random_stream.create "restored"));
  expect "Restoration marks the checkpoint restart target" restored.session.checkpoint;
  expect "Invalid level is an explicit error"
    (Session.validate_progress game { (progress checkpoint) with level_index = 9 }
    = Error (Invalid_level 9));
  let message_progress = { (progress checkpoint) with level_index = 1 } in
  expect "Message progress may retain a board target"
    (Session.validate_progress game message_progress = Ok ());
  let message, _ =
    value
      (Session.load_progress game environment ~seed:"message" message_progress
         player.session)
  in
  expect "A message continuation preserves the current board"
    (Board.equal message.execution.board player.session.execution.board);
  expect "Loading a message preserves the previous restart target"
    (message.restart_target == player.session.restart_target);
  let empty_checkpoint = { checkpoint with board = Board.empty } in
  expect "A title message's empty checkpoint can be validated"
    (Session.validate_progress game (progress empty_checkpoint) = Ok ());
  let empty, _ =
    value (Player.resume game environment ~seed:"empty" (progress empty_checkpoint))
  in
  expect "A saved empty board round-trips through progress"
    (Board.width empty.session.execution.board = 0 && empty.session.checkpoint);
  expect "An empty board still bounds its viewport"
    (Session.validate_progress game
       (progress
          {
            empty_checkpoint with
            viewport = Some { left = 0; top = 0; right = 1; bottom = 0 };
          })
    = Error Invalid_checkpoint_viewport);
  let bad =
    Board.set checkpoint.board (0, 0) { empty_cell with objects = Int_set.singleton 999 }
  in
  expect "Unknown object identities are rejected"
    (Session.validate_progress game (progress { checkpoint with board = bad })
    = Error (Unknown_checkpoint_object 999));
  let bad =
    Board.set checkpoint.board (0, 0) { empty_cell with objects = Int_set.singleton (-1) }
  in
  expect "Negative object identities are rejected"
    (Session.validate_progress game (progress { checkpoint with board = bad })
    = Error (Unknown_checkpoint_object (-1)));
  expect "Invalid viewports are rejected"
    (Session.validate_progress game
       (progress
          { checkpoint with viewport = Some { left = 2; top = 0; right = 1; bottom = 1 } })
    = Error Invalid_checkpoint_viewport);
  List.iter
    (fun milliseconds ->
      expect "Invalid elapsed time is rejected"
        (try
           ignore (Player.elapse game environment ~milliseconds player);
           false
         with Invalid_argument _ -> true))
    [ -1.; Float.nan; Float.infinity ];
  expect "Failed validation cannot modify a checkpoint"
    (Board.equal checkpoint.board player.session.execution.board);
  let throttled_source = "throttle_movement\nrealtime_interval 10000\n" ^ source in
  let throttled_game =
    match Compiler.source throttled_source with
    | Ok value -> value.game
    | Error _ -> failwith "Compile throttle source"
  in
  let initial, _ =
    value (Player.start throttled_game environment ~seed:"throttle" ~level:0)
  in
  let moved, _ =
    Player.press throttled_game environment (Player.Direction Right) initial
  in
  let held, _ =
    Player.press ~repeated:true throttled_game environment (Player.Direction Right) moved
  in
  expect "A held direction is throttled"
    (Board.equal moved.session.execution.board held.session.execution.board);
  let before_boundary, _ =
    Player.elapse throttled_game environment ~milliseconds:149. held
  in
  let still, _ =
    Player.press throttled_game environment (Player.Direction Right) before_boundary
  in
  expect "A fresh same-direction press shares the throttle"
    (Board.equal moved.session.execution.board still.session.execution.board);
  let boundary, _ = Player.elapse throttled_game environment ~milliseconds:1. still in
  let after, _ =
    Player.press throttled_game environment (Player.Direction Right) boundary
  in
  expect "The throttle permits input at its exact boundary"
    (not (Board.equal boundary.session.execution.board after.session.execution.board));
  expect "Throttle branches preserve the original input state"
    (initial.last_direction = None && initial.input_throttle_ms = 0.);
  let observed =
    value (Player.observe_progress game (Some (progress checkpoint)) player)
  in
  expect "Storage observations preserve the current execution snapshot"
    (observed.session == player.session);
  expect "Storage observations preserve timers"
    (observed.timer_ms = player.timer_ms && observed.autotick_ms = player.autotick_ms);
  expect "Storage observations do not change a live title target"
    (not (Player.can_continue observed));
  let title, _ = Player.press game environment Player.Menu observed in
  expect "The next title entry reads the observed checkpoint" (Player.can_continue title);
  let erased = value (Player.observe_progress game None observed) in
  expect "A failed write can restore the host's actual empty storage"
    (erased.saved_level = None && erased.saved_checkpoint = None);
  expect "Invalid external progress is rejected"
    (Player.observe_progress game
       (Some { (progress checkpoint) with level_index = 99 })
       observed
    = Error (Invalid_level 99));
  expect "Rejected observations preserve the previous storage snapshot"
    (observed.saved_level = Some 0 && observed.saved_checkpoint = Some checkpoint);
  let moved, _ = Player.press game environment (Player.Direction Right) player in
  let title, _ = Player.press game environment Player.Menu moved in
  let confirmed, effects = Player.press game environment Player.Action title in
  expect "Title confirmation exposes the recording boundary"
    (List.mem (Session.Clear_recording title.session.level) effects);
  expect "A recording reset preserves the current session snapshot"
    (confirmed.session == title.session);
  expect "A recording reset preserves undo history"
    (confirmed.session.history = moved.session.history);
  let open Player_control in
  expect "A held action cannot cross a new-screen barrier"
    (press_action ~repeated:true ~repeat_disabled:false initial = Blocked);
  let fresh =
    match press_action ~repeated:false ~repeat_disabled:false initial with
    | Accepted state -> state
    | Blocked -> failwith "Fresh action was blocked"
  in
  expect "A fresh press opens the repeat gate" (not (ignore_held_action fresh));
  let closing = select_message fresh in
  let overlapping = select_title closing |> open_message in
  expect "A replacement message preserves both pending transitions"
    (transition overlapping = Leaving_both && not (message_selected overlapping));
  let title_pending = finish_message overlapping in
  expect "Finishing an old close preserves a replacement's unselected state"
    (transition title_pending = Leaving_title && not (message_selected title_pending));
  let settled = finish_title title_pending in
  expect "Completed transitions require a new action press"
    (transition settled = Idle && ignore_held_action settled);
  let consumed = finish_message closing in
  expect "A completed selection remains consumed until another message"
    (message_selected consumed && not (message_selected (open_message consumed)));
  let deferred rule =
    let game =
      value
        (Compiler.source
           (Str.global_replace
              (Str.regexp_string "[ action Player ] -> [ Player ] message Hello")
              rule source))
      |> fun compiled -> compiled.Compiler.game
    in
    let player, _ = value (Player.start game environment ~seed:"deferred" ~level:0) in
    let message, _ = Player.press game environment Player.Action player in
    let selected, _ = Player.press game environment Player.Action message in
    let resumed, _ = Player.elapse game environment ~milliseconds:151. selected in
    (game, player, message, resumed)
  in
  let _, initial, message, resumed =
    deferred "[ action Player ] -> [ Crate ] restart message Hello"
  in
  expect "Deferred restarts are explicit message continuations"
    (match message.session.screen with
    | Rule_message { continuation = Restart_after_message; _ } -> true
    | _ -> false);
  expect "Acknowledging a deferred restart restores the saved board"
    (resumed.session.screen = Playing
    && Board.equal_objects initial.session.execution.board resumed.session.execution.board
    );
  let _, _, message, resumed =
    deferred "[ action Player ] -> [ Player ] win message Hello"
  in
  expect "Deferred command wins are explicit message continuations"
    (match message.session.screen with
    | Rule_message { continuation = Resume Requested_win; _ } -> true
    | _ -> false);
  expect "Acknowledgement schedules victory without an AGAIN continuation"
    (Session.winning resumed.session && not (Session.again resumed.session));
  print_endline "OCaml interactive contracts passed"

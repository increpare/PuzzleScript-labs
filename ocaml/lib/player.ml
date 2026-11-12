open Domain

type button = Direction of Direction.t | Action | Undo | Restart | Menu
type choice = New_game | Continue

type transition = Player_control.transition =
  | Idle
  | Leaving_title
  | Closing_message
  | Leaving_both

type t = {
  session : Session.t;
  choice : choice;
  control : Player_control.t;
  timer_ms : float;
  autotick_ms : float;
  input_throttle_ms : float;
  last_direction : Direction.t option;
  continue_target : Session.snapshot option;
  saved_level : int option;
  saved_checkpoint : Session.snapshot option;
}

let transition state = Player_control.transition state.control
let title_pending state = Player_control.title_pending state.control
let message_pending state = Player_control.message_pending state.control
let message_selected state = Player_control.message_selected state.control
let ignore_held_action state = Player_control.ignore_held_action state.control
let can_continue state = state.session.level > 0 || state.continue_target <> None
let choose state = if can_continue state then Continue else New_game

let from_session ?progress session =
  let continue_target =
    Option.bind progress (fun value -> value.Session.checkpoint_board)
  in
  let state =
    {
      session;
      choice = New_game;
      control = Player_control.initial;
      timer_ms = 0.;
      autotick_ms = 0.;
      input_throttle_ms = 0.;
      last_direction = None;
      continue_target;
      saved_level = Option.map (fun progress -> progress.Session.level_index) progress;
      saved_checkpoint = continue_target;
    }
  in
  { state with choice = choose state }

let remember state effects =
  List.fold_left
    (fun state -> function
      | Session.Persistence (Set_progress level) ->
          { state with saved_level = Some level }
      | Persistence (Set_checkpoint checkpoint) ->
          { state with saved_checkpoint = Some checkpoint }
      | Persistence Clear_progress -> { state with saved_level = None }
      | Persistence Clear_checkpoint -> { state with saved_checkpoint = None }
      | Rule_message_opened _ ->
          { state with control = Player_control.open_message state.control }
      | _ -> state)
    state effects

let create ?progress game ~seed =
  match Session.create_title ?progress game ~seed with
  | Error _ as error -> error
  | Ok (session, effects) ->
      Ok (remember (from_session ?progress session) effects, effects)

let load_progress game environment ~seed ~saved progress =
  match Session.create_title game ~seed with
  | Error _ as error -> error
  | Ok (initial, _) -> (
      match Session.load_progress game environment ~seed progress initial with
      | Error _ as error -> error
      | Ok (session, effects) ->
          Ok (remember (from_session ?progress:saved session) effects, effects))

let start game environment ~seed ~level =
  load_progress game environment ~seed ~saved:None
    Session.{ level_index = level; checkpoint_board = None }

let resume game environment ~seed progress =
  load_progress game environment ~seed ~saved:(Some progress) progress

let observe_progress game progress state =
  let checked =
    match progress with
    | None -> Ok ()
    | Some value -> Session.validate_progress game value
  in
  match checked with
  | Error _ as error -> error
  | Ok () ->
      Ok
        {
          state with
          saved_level = Option.map (fun progress -> progress.Session.level_index) progress;
          saved_checkpoint =
            Option.bind progress (fun progress -> progress.Session.checkpoint_board);
        }

let adopt ?(turn = false) state (session, effects) =
  let timer_ms =
    if
      (Session.winning session && not (Session.winning state.session))
      || (turn && Session.again session)
    then 0.
    else state.timer_ms
  in
  let state = remember { state with session; timer_ms } effects in
  let state =
    if session.screen = Title then { state with choice = choose state } else state
  in
  (state, effects)

let advance game environment state =
  let control =
    if
      state.session.screen <> Session.Title
      && state.session.level + 1 < Frozen_array.length game.levels
    then Player_control.reset_message_selection state.control
    else state.control
  in
  adopt ~turn:true
    { state with continue_target = None; control = Player_control.require_fresh control }
    (Session.step game environment Session.Advance state.session)

let open_title game environment state =
  let progress =
    Session.
      {
        level_index = (if state.choice = New_game then 0 else state.session.level);
        checkpoint_board =
          (if state.choice = New_game then None else state.continue_target);
      }
  in
  let seed = environment.Session.next_level_seed progress.level_index in
  match Session.open_title game environment ~seed progress state.session with
  | Error _ -> invalid_arg "Cannot open the selected title level"
  | Ok (session, effects) ->
      adopt ~turn:true
        {
          state with
          continue_target = progress.checkpoint_board;
          control = Player_control.require_fresh state.control;
        }
        (session, effects)

let press ?(repeated = false) game environment button state =
  if Session.winning state.session then (state, [])
  else
    let action =
      if button = Action then
        Player_control.press_action ~repeated
          ~repeat_disabled:game.metadata.no_repeat_action state.control
      else Player_control.Accepted state.control
    in
    match action with
    | Player_control.Blocked -> (state, [])
    | Accepted control -> (
        let state = { state with control } in
        let blocked_direction =
          match button with
          | Direction direction ->
              game.metadata.throttle_movement
              && state.last_direction = Some direction
              && state.input_throttle_ms < game.metadata.key_repeat_interval_ms
          | _ -> false
        in
        if blocked_direction then (state, [])
        else
          let state =
            match button with
            | Direction direction when game.metadata.throttle_movement ->
                { state with last_direction = Some direction; input_throttle_ms = 0. }
            | _ -> state
          in
          match (button, state.session.screen) with
          | Menu, (Playing | Level_message _ | Rule_message _) ->
              let session, effects =
                Session.title ?level:state.saved_level game state.session
              in
              let continue_target =
                match (state.saved_level, state.saved_checkpoint) with
                | Some _, Some _ -> state.saved_checkpoint
                | _ -> state.continue_target
              in
              let state = { state with session; continue_target } in
              ({ state with choice = choose state }, effects)
          | _, Title -> (
              if title_pending state || Frozen_array.length game.levels = 0 then
                (state, [])
              else
                match button with
                | Direction Up when can_continue state ->
                    ({ state with choice = New_game }, [])
                | Direction Down when can_continue state ->
                    ({ state with choice = Continue }, [])
                | Action when not repeated ->
                    ( {
                        state with
                        control = Player_control.select_title state.control;
                        timer_ms = 0.;
                      },
                      Session.simple game Start_game_event
                      @
                      if can_continue state then []
                      else [ Clear_recording state.session.level ] )
                | _ -> (state, []))
          | Action, (Level_message _ | Rule_message _)
            when (not repeated) && not (message_selected state) ->
              ( {
                  state with
                  control = Player_control.select_message state.control;
                  timer_ms = 0.;
                },
                Session.simple game Close_message_event )
          | _, (Level_message _ | Rule_message _) -> (state, [])
          | _, Playing -> (
              let input =
                match button with
                | Direction direction -> Some (Session.Movement (Move direction))
                | Action when not game.metadata.no_action ->
                    Some (Session.Movement Action)
                | Undo -> Some Session.Undo
                | Restart when not repeated -> Some Session.Restart_input
                | _ -> None
              in
              match input with
              | None -> (state, [])
              | Some (Session.Movement _) when Session.again state.session -> (state, [])
              | Some input ->
                  let state, effects =
                    adopt
                      ~turn:
                        (match input with
                        | Movement _ -> true
                        | Restart_input -> not game.metadata.no_restart
                        | _ -> false)
                      state
                      (Session.step game environment input state.session)
                  in
                  let state =
                    if state.session.screen <> Playing then
                      { state with control = Player_control.require_fresh state.control }
                    else state
                  in
                  (state, effects)))

let finish_title_if_due game environment state =
  if title_pending state && state.timer_ms > 300. then
    let state = { state with control = Player_control.finish_title state.control } in
    if state.session.screen = Title then open_title game environment state
    else advance game environment state
  else (state, [])

let again_if_due game environment state =
  if
    Session.again state.session
    && state.timer_ms > game.metadata.again_interval_ms
    && not (Execution.has_message state.session.execution)
  then
    let before = state.session.execution.board in
    let state, effects =
      adopt ~turn:true state (Session.step game environment Session.Tick state.session)
    in
    let modified = not (Board.equal_objects before state.session.execution.board) in
    ({ state with autotick_ms = (if modified then 0. else state.autotick_ms) }, effects)
  else (state, [])

let finish_message_if_due game environment state =
  if message_pending state && state.timer_ms > 150. then
    let state = { state with control = Player_control.finish_message state.control } in
    if state.session.screen = Title then open_title game environment state
    else
      match Session.dismissal state.session with
      | Advance_level -> advance game environment state
      | Resume_rule continuation ->
          adopt
            ~turn:(continuation = Restart_after_message)
            state
            (Session.acknowledge game environment state.session)
  else (state, [])

let victory_if_due game environment state =
  if Session.winning state.session && state.timer_ms > 500. then
    advance game environment state
  else (state, [])

let realtime_if_due game environment ~milliseconds state =
  if
    game.metadata.realtime_interval_ms > 0.
    && state.session.screen = Playing
    && (not (Session.again state.session))
    && not (Session.winning state.session)
  then
    let state = { state with autotick_ms = state.autotick_ms +. milliseconds } in
    if state.autotick_ms > game.metadata.realtime_interval_ms then
      adopt ~turn:true
        { state with autotick_ms = 0. }
        (Session.step game environment Session.Tick state.session)
    else (state, [])
  else (state, [])

(* All pending transitions observe this shared clock. The order is part of
   the host protocol: a single frame can complete several overlapping phases. *)
let elapse game environment ~milliseconds state =
  if (not (Float.is_finite milliseconds)) || milliseconds < 0. then
    invalid_arg "Elapsed milliseconds must be finite and nonnegative";
  let state =
    {
      state with
      timer_ms = state.timer_ms +. milliseconds;
      input_throttle_ms = state.input_throttle_ms +. milliseconds;
    }
  in
  let state, title = finish_title_if_due game environment state in
  let state, again = again_if_due game environment state in
  let state, message = finish_message_if_due game environment state in
  let state, victory = victory_if_due game environment state in
  let state, realtime = realtime_if_due game environment ~milliseconds state in
  (state, title @ again @ message @ victory @ realtime)

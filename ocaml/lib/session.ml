open Domain

type input = Movement of movement | Tick | Undo | Restart_input | Advance
type mode = Replay | Interactive
type win_request = Check_board | Requested_win
type message_continuation = Resume of win_request | Restart_after_message
type rule_message = { text : string; continuation : message_continuation }
type screen = Playing | Level_message of string | Rule_message of rule_message | Title
type pending_work = Ready | Again_pending | Victory_pending
type evaluation_context = Ordinary | Restarting
type win_policy = Allow_win | Suppress_win
type viewport = { left : int; top : int; right : int; bottom : int }
type snapshot = { board : Board.t; viewport : viewport option }

type persistence =
  | Set_progress of int
  | Set_checkpoint of snapshot
  | Clear_progress
  | Clear_checkpoint

type session_effect =
  | Sound_effect of { seed : string; simple : bool }
  | Victory of { level : int; suppressed : bool }
  | Persistence of persistence
  | Diagnostic of string
  | Rule_message_opened of string
  | Clear_recording of int

type environment = { next_level_seed : int -> string }

type t = {
  execution : Execution.t;
  mode : mode;
  pending : pending_work;
  level : int;
  history : snapshot list;
  restart_target : snapshot;
  viewport : viewport option;
  checkpoint : bool;
  screen : screen;
  loaded_seed : string;
}

let again state = state.pending = Again_pending
let winning state = state.pending = Victory_pending
let clear_again = function Again_pending -> Ready | pending -> pending

let win_request execution =
  if List.mem Win execution.Execution.commands then Requested_win else Check_board

(* The retained execution message is a compatibility latch, independent of the
   displayed screen when title/message transitions overlap. *)
type dismissal = Advance_level | Resume_rule of message_continuation

let dismissal state =
  if not (Execution.has_message state.execution) then Advance_level
  else
    let continuation =
      match state.screen with
      | Rule_message message -> message.continuation
      | Playing | Level_message _ | Title -> Resume Check_board
    in
    Resume_rule continuation

let defer_win state =
  let execution = Execution.keep_commands (( = ) Win) state.execution in
  let screen =
    match state.screen with
    | Rule_message message ->
        Rule_message { message with continuation = Resume (win_request execution) }
    | screen -> screen
  in
  { state with execution; screen }

let simple game event =
  List.filter_map
    (fun definition ->
      if definition.trigger = Simple event then
        Some (Sound_effect { seed = definition.seed; simple = true })
      else None)
    game.sounds

let output_commands ?(continuation = Resume Check_board) game state =
  List.fold_left
    (fun (state, effects) -> function
      | Sound index -> (state, effects @ simple game (Slot_event index))
      | Message text when state.mode = Interactive ->
          ( { state with screen = Rule_message { text; continuation } },
            effects @ (Rule_message_opened text :: simple game Show_message_event) )
      | _ -> (state, effects))
    (state, []) state.execution.commands

let clear_commands state =
  { state with execution = Execution.clear_commands state.execution }

let diagnostics execution =
  List.map (fun message -> Diagnostic message) execution.Execution.diagnostics

let snapshot state = { board = state.execution.board; viewport = state.viewport }

let restore target state =
  {
    state with
    execution = Execution.restore target.board state.execution;
    viewport = target.viewport;
    pending = clear_again state.pending;
  }

let viewport game board =
  match
    match game.metadata.flickscreen with
    | Some _ as size -> size
    | None -> game.metadata.zoomscreen
  with
  | None -> None
  | Some (width, height) ->
      Some
        {
          left = 0;
          top = 0;
          right = min width (Board.width board);
          bottom = min height (Board.height board);
        }

let reset_flickscreen game state =
  match game.metadata.flickscreen with
  | None -> state
  | Some (width, height) ->
      {
        state with
        viewport =
          Some
            {
              left = 0;
              top = 0;
              right = min width (Board.width state.execution.board);
              bottom = min height (Board.height state.execution.board);
            };
      }

let undo ?(force = false) ?(skip_duplicates = false) game state =
  if game.metadata.no_undo && not force then (state, [])
  else
    let rec skip = function
      | target :: rest
        when skip_duplicates && Board.equal_objects target.board state.execution.board ->
          skip rest
      | history -> history
    in
    match skip state.history with
    | [] -> ({ state with history = [] }, [])
    | board :: history ->
        ( restore board { state with history },
          if force then [] else simple game Undo_event )

let require_player_cancel game input before after =
  if (not game.metadata.require_player_movement) || input = None then false
  else
    let players =
      Board.positions before
      |> List.filter (fun p -> matches_name (Board.get before p).objects game.player)
    in
    players <> []
    && List.for_all
         (fun p ->
           List.exists
             (fun id -> Int_set.mem id (Board.get after p).objects)
             (members game.player))
         players

let ordinary_sounds game state =
  let execution = state.execution in
  let sound seed = Sound_effect { seed; simple = false } in
  let object_sounds trigger objects =
    List.filter_map
      (fun definition ->
        if
          definition.trigger = trigger
          &&
          match definition.selection with
          | None -> false
          | Some name -> List.exists (fun id -> Int_set.mem id objects) (members name)
        then Some (sound definition.seed)
        else None)
      game.sounds
  in
  List.map sound (execution.failed_sounds @ execution.succeeded_sounds)
  @ object_sounds On_create execution.created
  @ object_sounds On_destroy execution.destroyed

let rec load ?checkpoint ~context game environment ~seed level state =
  if level < 0 || level >= Frozen_array.length game.levels then
    invalid_arg "level index is outside the game";
  let state =
    {
      state with
      level;
      loaded_seed = seed;
      pending = Ready;
      execution = Execution.reseed seed state.execution;
    }
  in
  match Frozen_array.get game.levels level with
  | Text text ->
      ( { state with screen = Level_message text },
        (if checkpoint = None then [] else simple game Start_level_event)
        @ simple game Show_message_event )
  | Board rows ->
      let board = Board.of_rows rows in
      let target =
        Option.value ~default:{ board; viewport = viewport game board } checkpoint
      in
      let target = { target with board = Board.clear_movements target.board } in
      let board = target.board and viewport = target.viewport in
      let state =
        {
          state with
          screen = Playing;
          history = [];
          restart_target = target;
          viewport;
          checkpoint = checkpoint <> None;
          execution = Execution.load board seed state.execution;
        }
      in
      let state, effects =
        if game.metadata.run_rules_on_level_start && checkpoint = None then
          execute ~context game environment ~win_policy:Suppress_win None state
        else (state, [])
      in
      (state, simple game Start_level_event @ effects)

and next_level ~context game environment state =
  let recording level =
    if state.screen = Playing then [] else [ Clear_recording level ]
  in
  let state =
    { state with pending = Ready; execution = Execution.set_message "" state.execution }
  in
  let index = if state.screen = Title then 0 else state.level + 1 in
  let state, effects =
    if index < Frozen_array.length game.levels then
      let state, effects =
        load ~context game environment
          ~seed:(environment.next_level_seed index)
          index state
      in
      ( state,
        effects @ recording index
        @ [ Persistence (Set_progress index); Persistence Clear_checkpoint ] )
    else
      ( { state with level = 0; screen = Title },
        [ Persistence Clear_progress; Persistence Clear_checkpoint ]
        @ simple game End_game_event @ recording 0
        @ [ Persistence (Set_progress 0); Persistence Clear_checkpoint ] )
  in
  (reset_flickscreen game state, effects)

and restart ?(force = false) ~context game environment state =
  if context = Restarting || (game.metadata.no_restart && not force) then (state, [])
  else
    let state, undo_effects =
      if again state then undo ~force ~skip_duplicates:true game state else (state, [])
    in
    let state =
      {
        state with
        history = (if force then state.history else snapshot state :: state.history);
      }
    in
    let state = restore state.restart_target state in
    let state, effects =
      if game.metadata.run_rules_on_level_start && not state.checkpoint then
        execute ~context:Restarting game environment ~win_policy:Suppress_win None state
      else (state, [])
    in
    (clear_commands state, undo_effects @ simple game Restart_event @ effects)

and check_win ~context game environment ~win_policy ~request state =
  if
    winning state || state.screen <> Playing
    || not (request = Requested_win || Execution.has_won game state.execution.board)
  then (state, [])
  else
    let effects =
      [ Victory { level = state.level; suppressed = win_policy = Suppress_win } ]
    in
    if win_policy = Suppress_win then (state, effects)
    else if state.mode = Interactive then
      ({ state with pending = Victory_pending }, effects @ simple game End_level_event)
    else
      let state, more =
        next_level ~context game environment
          { state with pending = clear_again state.pending }
      in
      (state, effects @ simple game End_level_event @ more)

and prepare_again ~context game environment state =
  let original_execution = state.execution in
  let before = snapshot state in
  let execution = Execution.turn game None state.execution in
  let state = { state with execution; pending = clear_again state.pending } in
  let commands = execution.commands in
  let state, effects, pending =
    if require_player_cancel game None before.board execution.board then
      (restore before state, [], Ready)
    else if List.mem Cancel commands then
      ( restore before state,
        simple game Cancel_event,
        if List.length commands > 1 then Again_pending else Ready )
    else
      let state =
        if List.mem Restart commands then { state with history = before :: state.history }
        else state
      in
      if not (Board.equal_objects before.board execution.board) then
        (restore before state, [], Again_pending)
      else if List.mem Win commands || List.mem Restart commands then
        (state, [], Again_pending)
      else
        let state, effects =
          check_win ~context game environment ~win_policy:Suppress_win
            ~request:(win_request state.execution) state
        in
        (clear_commands state, effects, Ready)
  in
  ( {
      state with
      pending;
      execution = Execution.restore_commands original_execution state.execution;
    },
    diagnostics execution @ effects )

and execute ~context game environment ~win_policy input state =
  let before = snapshot state in
  let state =
    {
      state with
      execution = Execution.turn game input state.execution;
      pending = clear_again state.pending;
    }
  in
  let diagnostic_effects = diagnostics state.execution in
  let commands = state.execution.commands in
  if require_player_cancel game input before.board state.execution.board then
    let state = restore before state in
    ( { state with execution = Execution.set_message "" state.execution },
      diagnostic_effects )
  else if List.mem Cancel commands then
    let state, effects = output_commands game state in
    (restore before state, diagnostic_effects @ effects @ simple game Cancel_event)
  else if
    state.mode = Interactive && context = Ordinary && List.mem Restart commands
    && List.exists (function Message _ -> true | _ -> false) commands
  then
    let state, effects =
      output_commands ~continuation:Restart_after_message game
        { state with history = before :: state.history }
    in
    (state, diagnostic_effects @ effects)
  else
    let state, effects =
      if List.mem Restart commands then
        let state, command_effects = output_commands game state in
        let state, effects =
          restart ~context ~force:true game environment
            { state with history = before :: state.history }
        in
        (state, command_effects @ effects)
      else (state, [])
    in
    let modified = not (Board.equal_objects before.board state.execution.board) in
    let state =
      if modified && input <> None then { state with history = before :: state.history }
      else state
    in
    let ordinary = ordinary_sounds game state in
    let state, command_effects = output_commands game state in
    let effects = effects @ ordinary @ command_effects in
    let state, win_effects =
      check_win ~context game environment ~win_policy
        ~request:(win_request state.execution) state
    in
    let state, checkpoint_effects =
      if (not (winning state)) && List.mem Checkpoint state.execution.commands then
        let target = snapshot state in
        ( { state with restart_target = target; checkpoint = true },
          [
            Persistence (Set_checkpoint (snapshot state));
            Persistence (Set_progress state.level);
          ] )
      else (state, [])
    in
    let state, again_effects =
      if (not (winning state)) && modified && List.mem Again state.execution.commands then
        prepare_again ~context game environment state
      else (state, [])
    in
    let state =
      if
        state.mode = Interactive && win_policy = Allow_win && state.screen <> Playing
        && List.mem Win commands
        && List.exists (function Message _ -> true | _ -> false) commands
      then defer_win state
      else clear_commands state
    in
    ( state,
      diagnostic_effects @ effects @ win_effects @ checkpoint_effects @ again_effects )

let initial ~mode ~seed ~level =
  let dummy = Board.empty in
  let execution = Execution.create dummy seed in
  {
    execution;
    mode;
    level;
    history = [];
    restart_target = { board = dummy; viewport = None };
    viewport = None;
    checkpoint = false;
    pending = Ready;
    screen = Title;
    loaded_seed = seed;
  }

let create ?(mode = Replay) game environment ~seed ~level =
  load ~context:Ordinary game environment ~seed level (initial ~mode ~seed ~level)

let step game environment input state =
  match input with
  | Undo -> undo ~skip_duplicates:true game state
  | Restart_input -> restart ~context:Ordinary game environment state
  | Movement movement ->
      execute ~context:Ordinary game environment ~win_policy:Allow_win (Some movement)
        state
  | Tick -> execute ~context:Ordinary game environment ~win_policy:Allow_win None state
  | Advance -> next_level ~context:Ordinary game environment state

type progress = { level_index : int; checkpoint_board : snapshot option }

type load_error =
  | Invalid_level of int
  | Unknown_checkpoint_object of int
  | Invalid_checkpoint_viewport

let validate_progress game progress =
  if progress.level_index < 0 || progress.level_index >= Frozen_array.length game.levels
  then Error (Invalid_level progress.level_index)
  else
    match progress.checkpoint_board with
    | None -> Ok ()
    | Some target -> (
        let width = Board.width target.board and height = Board.height target.board in
        let unknown =
          Board.positions target.board
          |> List.find_map (fun position ->
              Int_set.to_seq (Board.get target.board position).objects
              |> Seq.find (fun id -> id < 0 || id >= Frozen_array.length game.objects))
        in
        match unknown with
        | Some id -> Error (Unknown_checkpoint_object id)
        | None -> (
            match target.viewport with
            | Some view
              when view.left < 0 || view.top < 0 || view.right < view.left
                   || view.bottom < view.top || view.right > width || view.bottom > height
              ->
                Error Invalid_checkpoint_viewport
            | _ -> Ok ()))

let create_title ?progress game ~seed =
  let start () =
    let level =
      Option.fold ~none:0 ~some:(fun progress -> progress.level_index) progress
    in
    Ok (initial ~mode:Interactive ~seed ~level, simple game Title_event)
  in
  match progress with
  | None -> start ()
  | Some progress -> (
      match validate_progress game progress with
      | Error _ as error -> error
      | Ok () -> start ())

let load_progress game environment ~seed progress state =
  match validate_progress game progress with
  | Error _ as error -> error
  | Ok () ->
      Ok
        (load ?checkpoint:progress.checkpoint_board ~context:Ordinary game environment
           ~seed progress.level_index state)

let open_title game environment ~seed progress state =
  match load_progress game environment ~seed progress state with
  | Error _ as error -> error
  | Ok (state, effects) ->
      let state, checkpoint_effect =
        match progress.checkpoint_board with
        | None -> (state, Persistence Clear_checkpoint)
        | Some _ ->
            let target = snapshot state in
            ( { state with restart_target = target; checkpoint = true },
              Persistence (Set_checkpoint target) )
      in
      Ok
        ( reset_flickscreen game state,
          effects
          @ [
              Clear_recording state.level;
              Persistence (Set_progress state.level);
              checkpoint_effect;
            ] )

let title ?level game state =
  let level = Option.value ~default:state.level level in
  if
    level < 0
    ||
    if Frozen_array.length game.levels = 0 then level <> 0
    else level >= Frozen_array.length game.levels
  then invalid_arg "Title progress level is outside the game";
  ( {
      state with
      level;
      screen = Title;
      pending = Ready;
      execution = Execution.set_message "" state.execution;
    },
    simple game Title_event )

let acknowledge game environment state =
  match state.screen with
  | Rule_message { text; continuation } when text <> "" -> (
      let state =
        {
          state with
          screen = Playing;
          execution = Execution.set_message "" state.execution;
        }
      in
      match continuation with
      | Restart_after_message ->
          restart ~context:Ordinary ~force:true game environment state
      | Resume request ->
          check_win ~context:Ordinary game environment ~win_policy:Allow_win ~request
            state)
  | Level_message _ | Rule_message _ ->
      next_level ~context:Ordinary game environment state
  | Playing | Title -> (state, [])

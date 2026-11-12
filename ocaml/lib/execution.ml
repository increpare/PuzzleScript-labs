open Domain

type message_latch = No_message | Message_text of string

let latch = function "" -> No_message | text -> Message_text text

type t = {
  board : Board.t;
  random : Random_stream.t;
  commands : command list;
  message : message_latch;
  marks : int Int_map.t Positions.t;
  banned : Int_set.t;
  created : Int_set.t;
  destroyed : Int_set.t;
  succeeded_sounds : string list;
  failed_sounds : string list;
  diagnostics : string list;
}

let create board seed =
  {
    board;
    random = Random_stream.create seed;
    commands = [];
    message = No_message;
    marks = Positions.empty;
    banned = Int_set.empty;
    created = Int_set.empty;
    destroyed = Int_set.empty;
    succeeded_sounds = [];
    failed_sounds = [];
    diagnostics = [];
  }

let restore board state =
  {
    state with
    board = Board.clear_movements board;
    marks = Positions.empty;
    commands = [];
  }

let clear_commands state = { state with commands = [] }

let keep_commands predicate state =
  { state with commands = List.filter predicate state.commands }

let message_text state =
  match state.message with No_message -> "" | Message_text text -> text

let has_message state =
  match state.message with No_message -> false | Message_text _ -> true

let set_message text state = { state with message = latch text }

let restore_commands source state =
  { state with commands = source.commands; message = source.message }

let reseed seed state = { state with random = Random_stream.create seed }

let load board seed state =
  { (reseed seed state) with board; commands = []; marks = Positions.empty }

let add_unique value values = if List.mem value values then values else values @ [ value ]

let sound_matches ?layer (_game : game) trigger (cell : cell) definition =
  definition.trigger = trigger
  &&
  match definition.selection with
  | None -> false
  | Some selection ->
      List.exists
        (fun reference ->
          has_reference cell.objects reference
          && (match layer with
            | None -> true
            | Some layer -> reference.source_layer = Some layer)
          && (trigger = On_create || trigger = On_destroy
             ||
             match reference.source_layer with
             | None -> false
             | Some layer ->
                 not
                   (Movements.is_empty
                      (Movements.inter definition.directions (movements layer cell)))))
        (references selection)

let sounds ?layer game trigger cell existing =
  List.fold_left
    (fun seeds definition ->
      if sound_matches ?layer game trigger cell definition then
        add_unique definition.seed seeds
      else seeds)
    existing game.sounds

let predicate (_game : game) (cell : cell) = function
  | Layer_movement (layer, test) -> (
      match test with
      | Unspecified -> true
      | Stationary -> Movements.is_empty (movements layer cell)
      | Moving movement -> Movements.mem movement (movements layer cell))
  | Absent selection ->
      not (List.exists (fun id -> Int_set.mem id cell.objects) (members selection))
  | Present (selection, test) -> (
      let matches reference =
        has_reference cell.objects reference
        &&
        match test with
        | Unspecified -> true
        | Stationary -> Movements.is_empty (movements (reference_layer reference) cell)
        | Moving movement ->
            Movements.mem movement (movements (reference_layer reference) cell)
      in
      match selection with
      | Aggregate ids -> List.for_all matches ids
      | Object id -> matches id
      | Property ids -> List.exists matches ids)

let matches_cell game board position pattern =
  Board.contains board position
  && List.for_all (predicate game (Board.get board position)) pattern.predicates

type row_match = (position * cell_pattern * cell_edit option) list

let row_starts board direction row =
  let estimate selection =
    match selection with
    | Object reference ->
        Option.fold ~none:(0, [])
          ~some:(fun id -> (Board.object_count id board, [ id ]))
          reference.object_id
    | Property _ ->
        let ids = members selection in
        (List.fold_left (fun total id -> total + Board.object_count id board) 0 ids, ids)
    | Aggregate _ ->
        List.fold_left
          (fun ((count, _) as best) id ->
            let current = Board.object_count id board in
            if current < count then (current, [ id ]) else best)
          (max_int, []) (members selection)
  in
  (* A fixed cell before the first ellipsis has a known offset from its start.
     Any required occupant is a sound anchor. Keep the smallest index, then
     translate its coordinates without changing the original scan order. *)
  let rec anchor offset best = function
    | [] | Gap :: _ -> best
    | Cell (pattern, _) :: rest ->
        let best =
          List.fold_left
            (fun ((cost, _, _) as best) -> function
              | Absent _ | Layer_movement _ -> best
              | Present (selection, _) ->
                  let candidate, ids = estimate selection in
                  if candidate < cost then (candidate, offset, ids) else best)
            best pattern.predicates
        in
        anchor (offset + 1) best rest
  in
  let vertical = direction = Direction.Up || direction = Down in
  let _, offset, ids = anchor 0 (Board.width board * Board.height board, 0, []) row in
  if ids = [] then Board.positions ~vertical board
  else
    let dx, dy = Direction.delta direction in
    Board.positions_of_any ~vertical ids board
    |> List.map (fun (x, y) -> (x - (offset * dx), y - (offset * dy)))
    |> List.filter (Board.contains board)

let find_row game board direction row : row_match list =
  let dx, dy = Direction.delta direction in
  let advance (x, y) = (x + dx, y + dy) in
  let rec visit position visited = function
    | [] -> [ List.rev visited ]
    (* Keep the compiler warning, but give adjacent gaps their stated single-gap
       meaning. Enumerating their partitions would bias random rule choices. *)
    | Gap :: Gap :: rest -> visit position visited (Gap :: rest)
    | Gap :: rest ->
        let rec gaps position =
          if not (Board.contains board position) then []
          else visit position visited rest @ gaps (advance position)
        in
        gaps position
    | Cell (pattern, edit) :: rest ->
        if matches_cell game board position pattern then
          visit (advance position) ((position, pattern, edit) :: visited) rest
        else []
  in
  List.concat_map (fun position -> visit position [] row) (row_starts board direction row)

let matching_rows game board (rule : rule) =
  let possible = function
    | Object reference ->
        Option.fold ~none:false
          ~some:(fun id -> Board.has_object id board)
          reference.object_id
    | Property _ as name ->
        List.exists (fun id -> Board.has_object id board) (members name)
    | Aggregate _ as name ->
        List.for_all (fun id -> Board.has_object id board) (members name)
  in
  let possible_cell = function
    | Gap -> true
    | Cell (pattern, _) ->
        List.for_all
          (function
            | Absent _ | Layer_movement _ -> true | Present (name, _) -> possible name)
          pattern.predicates
  in
  if not (List.for_all (List.for_all possible_cell) rule.rows) then None
  else
    let rows = List.map (find_row game board rule.direction) rule.rows in
    if rows = [] || List.exists (( = ) []) rows then None else Some rows

(* The first row varies fastest. Row searches are frozen before any writes, but
   their Cartesian product is a lazy sequence rather than an exponential list. *)
let rec tuples = function
  | [] -> Seq.return []
  | row :: rest ->
      Seq.flat_map
        (fun tail -> Seq.map (fun head -> head :: tail) (List.to_seq row))
        (tuples rest)

let tuple_count rows =
  List.fold_left
    (fun count row ->
      let length = List.length row in
      if length <> 0 && count > max_int / length then
        invalid_arg "Rule match product exceeds addressable collection size";
      count * length)
    1 rows

let rec tuple_at index = function
  | [] -> []
  | row :: rest ->
      let length = List.length row in
      List.nth row (index mod length) :: tuple_at (index / length) rest

let recheck game board tuple =
  List.for_all
    (List.for_all (fun (position, pattern, _) -> matches_cell game board position pattern))
    tuple

let queue (rule : rule) state =
  if
    List.mem Cancel state.commands
    || (List.mem Restart state.commands && not (List.mem Cancel rule.commands))
  then state
  else
    let replaces_commands =
      List.mem Cancel rule.commands || List.mem Restart rule.commands
    in
    let commands = if replaces_commands then [] else state.commands in
    List.fold_left
      (fun state command ->
        let message =
          match command with Message message -> latch message | _ -> state.message
        in
        let same a b = match (a, b) with Message _, Message _ -> true | _ -> a = b in
        if List.exists (same command) state.commands then state
        else { state with commands = state.commands @ [ command ]; message })
      {
        state with
        commands;
        message = (if replaces_commands then No_message else state.message);
      }
      rule.commands

let edit_cell (game : game) edit (cell : cell) random =
  let random_candidates =
    List.filter (fun (placement : placement) -> placement.random) edit.placements
    |> List.concat_map (fun p -> p.occupants)
    |> Int_set.of_list |> Int_set.elements
  in
  let additions =
    List.filter (fun (p : placement) -> (not p.random) && p.concrete) edit.placements
    |> List.concat_map (fun p -> p.occupants)
    |> Int_set.of_list
  in
  let additions, clear_layers, reset, random =
    match random_candidates with
    | [] -> (additions, edit.clear_layers, edit.reset_movements, random)
    | candidates ->
        let chosen, random = Random_stream.choose (List.length candidates) random in
        let id = List.nth candidates chosen in
        let layer = (Frozen_array.get game.objects id).layer in
        ( Int_set.add id additions,
          Int_set.add layer edit.clear_layers,
          Int_set.add layer edit.reset_movements,
          random )
  in
  let cleared =
    Int_set.fold
      (fun layer objects -> Int_set.union objects (Frozen_array.get game.layers layer))
      clear_layers Int_set.empty
  in
  let objects =
    Int_set.diff cell.objects (Int_set.union edit.remove cleared)
    |> Int_set.union additions
  in
  let cell =
    {
      objects;
      movements =
        Int_map.filter (fun layer _ -> not (Int_set.mem layer reset)) cell.movements;
    }
  in
  let cell =
    List.fold_left
      (fun cell (layer, movement) ->
        set_movements layer (Movements.remove movement (movements layer cell)) cell)
      cell edit.remove_movements
  in
  let cell =
    List.fold_left
      (fun cell (placement : placement) ->
        if placement.random then cell
        else
          match placement.motion with
          | Set movement ->
              Int_set.fold
                (fun layer cell ->
                  set_movements layer (Movements.add movement (movements layer cell)) cell)
                placement.movement_layers cell
          | Clear | Preserve | Random_direction -> cell)
      cell edit.placements
  in
  let random_layers =
    List.filter (fun p -> p.motion = Random_direction) edit.placements
    |> List.fold_left
         (fun layers placement -> Int_set.union layers placement.movement_layers)
         Int_set.empty
  in
  Int_set.fold
    (fun layer (cell, random) ->
      let index, random = Random_stream.choose 4 random in
      let movement = Move (List.nth Direction.all index) in
      (set_movements layer (Movements.add movement (movements layer cell)) cell, random))
    random_layers (cell, random)

let apply_at game group (rule : rule) state tuple =
  List.fold_left
    (fun (state, changed) row ->
      List.fold_left
        (fun (state, changed) (position, _, edit) ->
          match edit with
          | None -> (state, changed)
          | Some edit ->
              let before = Board.get state.board position in
              let after, random = edit_cell game edit before state.random in
              let owner =
                Option.value ~default:Int_map.empty
                  (Positions.find_opt position state.marks)
              in
              let owner, marked =
                if rule.rigid then
                  Int_set.fold
                    (fun layer (owner, marked) ->
                      if Int_map.mem layer owner then (owner, marked)
                      else (Int_map.add layer group owner, true))
                    edit.reset_movements (owner, false)
                else (owner, false)
              in
              let marks =
                if Int_map.is_empty owner then state.marks
                else Positions.add position owner state.marks
              in
              let state =
                {
                  state with
                  board = Board.set state.board position after;
                  random;
                  marks;
                  created =
                    Int_set.union state.created
                      (Int_set.diff after.objects before.objects);
                  destroyed =
                    Int_set.union state.destroyed
                      (Int_set.diff before.objects after.objects);
                }
              in
              ( state,
                changed || marked
                || not
                     (Int_set.equal before.objects after.objects
                     && Int_map.equal Movements.equal before.movements after.movements) ))
        (state, changed) row)
    (state, false) tuple

let apply_rule game group (rule : rule) state =
  match matching_rows game state.board rule with
  | None -> (state, false)
  | Some rows ->
      let has_edits =
        List.exists
          (List.exists (function Cell (_, Some _) -> true | _ -> false))
          rule.rows
      in
      let state, changed =
        if not has_edits then (state, false)
        else
          Seq.fold_left
            (fun (state, changed) tuple ->
              if not (recheck game state.board tuple) then (state, changed)
              else
                let state, edited = apply_at game group rule state tuple in
                (state, changed || edited))
            (state, false) (tuples rows)
      in
      (queue rule state, changed)

let apply_group game group_index (group : group) before =
  if group.random then
    let candidates =
      List.filter_map
        (fun rule ->
          Option.map
            (fun rows -> (rule, rows, tuple_count rows))
            (matching_rows game before.board rule))
        group.rules
    in
    match candidates with
    | [] -> (before, false)
    | _ ->
        let count =
          List.fold_left
            (fun total (_, _, count) ->
              if total > max_int - count then
                invalid_arg "Random rule candidates exceed addressable collection size";
              total + count)
            0 candidates
        in
        let selected, random = Random_stream.choose count before.random in
        let rec locate index = function
          | [] -> assert false
          | (rule, rows, count) :: rest ->
              if index < count then (rule, tuple_at index rows)
              else locate (index - count) rest
        in
        let rule, tuple = locate selected candidates in
        let after, changed =
          apply_at game group_index rule { before with random } tuple
        in
        (queue rule after, changed)
  else
    let rec settle pass changed state =
      if pass = 200 then
        ( { state with diagnostics = state.diagnostics @ [ "Rule-group iteration limit" ] },
          changed )
      else
        let after, edited =
          List.fold_left
            (fun (state, changed) rule ->
              let state, edited = apply_rule game group_index rule state in
              (state, changed || edited))
            (state, false) group.rules
        in
        if edited then settle (pass + 1) true after else (after, changed)
    in
    settle 0 false before

let apply_schedule game schedule state =
  let rec run index propagated loops state =
    if index >= Frozen_array.length schedule.groups then state
    else
      let state, changed =
        if Int_set.mem index state.banned then (state, false)
        else apply_group game index (Frozen_array.get schedule.groups index) state
      in
      let propagated = propagated || changed in
      match if propagated then Int_map.find_opt index schedule.loops else None with
      | Some target when loops < 200 -> run target false (loops + 1) state
      | Some _ ->
          { state with diagnostics = state.diagnostics @ [ "Rule-loop iteration limit" ] }
      | None -> run (index + 1) propagated loops state
  in
  run 0 false 0 state

(* Rigid rollback carries these observations forward while restoring the
   original board/commands. A failed final attempt remains available at the cap. *)
type retry_carry = {
  banned : Int_set.t;
  random : Random_stream.t;
  failed_sounds : string list;
  message : message_latch;
  diagnostics : string list;
}

type resolution = Settled of t | Retry of { failed : t; carry : retry_carry }

let retry_snapshot (snapshot : t) (carry : retry_carry) =
  {
    snapshot with
    banned = carry.banned;
    random = carry.random;
    failed_sounds = carry.failed_sounds;
    message = carry.message;
    diagnostics = carry.diagnostics;
  }

let resolve game state =
  let rec sweep board succeeded_sounds =
    let board, succeeded_sounds, changed =
      List.fold_left
        (fun (board, succeeded_sounds, changed) position ->
          let original = Board.get board position in
          Frozen_array.fold_lefti
            (fun (board, seeds, changed) layer layer_objects ->
              if Int_set.is_empty layer_objects then (board, seeds, changed)
              else
                let cell = Board.get board position in
                let pending = movements layer cell in
                if Movements.is_empty pending then (board, seeds, changed)
                else
                  let dx, dy, action =
                    match Movements.elements pending with
                    | [ Move direction ] ->
                        let dx, dy = Direction.delta direction in
                        (dx, dy, false)
                    | [ Action ] -> (0, 0, true)
                    | _ -> (0, 0, false)
                  in
                  let x, y = position in
                  let destination = (x + dx, y + dy) in
                  if not (Board.contains board destination) then (board, seeds, changed)
                  else
                    let target = Board.get board destination in
                    if
                      (not action)
                      && not
                           (Int_set.is_empty (Int_set.inter target.objects layer_objects))
                    then (board, seeds, changed)
                    else
                      let seeds = sounds ~layer game On_move original seeds in
                      let occupants = Int_set.inter cell.objects layer_objects in
                      let source =
                        set_movements layer Movements.empty
                          { cell with objects = Int_set.diff cell.objects occupants }
                      in
                      let board = Board.set board position source in
                      let target = Board.get board destination in
                      let board =
                        Board.set board destination
                          { target with objects = Int_set.union target.objects occupants }
                      in
                      (board, seeds, true))
            (board, succeeded_sounds, changed)
            game.layers)
        (board, succeeded_sounds, false)
        (Board.positions ~vertical:true board)
    in
    if changed then sweep board succeeded_sounds else (board, succeeded_sounds)
  in
  let board, succeeded_sounds = sweep state.board state.succeeded_sounds in
  let banned, failed_sounds =
    List.fold_left
      (fun (banned, seeds) position ->
        let cell = Board.get board position in
        let owners =
          Option.value ~default:Int_map.empty (Positions.find_opt position state.marks)
        in
        let marked = not (Int_map.is_empty owners) in
        let first_failed =
          Int_map.bindings cell.movements
          |> List.find_opt (fun (layer, motions) ->
              Int_map.mem layer owners && not (Movements.is_empty motions))
        in
        let banned =
          match first_failed with
          | None -> banned
          | Some (layer, _) -> Int_set.add (Int_map.find layer owners) banned
        in
        let sound_cell =
          if marked then
            {
              cell with
              movements =
                Int_map.filter (fun layer _ -> Int_map.mem layer owners) cell.movements;
            }
          else cell
        in
        (banned, sounds game On_failure sound_cell seeds))
      (state.banned, state.failed_sounds)
      (Board.positions ~vertical:true board)
  in
  let after =
    {
      state with
      board = Board.clear_movements board;
      banned;
      succeeded_sounds;
      failed_sounds;
      marks = Positions.empty;
    }
  in
  if Int_set.equal banned state.banned then Settled after
  else
    let carry =
      {
        banned;
        random = after.random;
        failed_sounds;
        message = after.message;
        diagnostics = after.diagnostics;
      }
    in
    Retry { failed = after; carry }

let turn game input before =
  let board =
    match input with
    | None -> before.board
    | Some movement ->
        Board.map
          (fun _ cell ->
            if not (matches_name cell.objects game.player) then cell
            else
              List.fold_left
                (fun (cell : cell) id ->
                  if not (Int_set.mem id cell.objects) then cell
                  else
                    let layer = (Frozen_array.get game.objects id).layer in
                    set_movements layer
                      (Movements.add movement (movements layer cell))
                      cell)
                cell (members game.player))
          before.board
  in
  let snapshot =
    {
      before with
      board;
      marks = Positions.empty;
      banned = Int_set.empty;
      commands = [];
      created = Int_set.empty;
      destroyed = Int_set.empty;
      succeeded_sounds = [];
      failed_sounds = [];
      diagnostics = [];
    }
  in
  let rec attempt count state =
    let state = apply_schedule game game.early state in
    match resolve game state with
    | Retry { carry; _ } when count < 50 ->
        attempt (count + 1) (retry_snapshot snapshot carry)
    | Retry { failed; _ } ->
        { failed with diagnostics = failed.diagnostics @ [ "Rigid retry limit" ] }
    | Settled state ->
        let banned = state.banned in
        let state = apply_schedule game game.late { state with banned = Int_set.empty } in
        { state with banned }
  in
  attempt 1 snapshot

let has_won game board =
  game.wins <> []
  && List.for_all
       (fun condition ->
         let relevant (cell : cell) = matches_name cell.objects condition.subject in
         let target (cell : cell) =
           match condition.on with
           | None -> true
           | Some target -> matches_name cell.objects target
         in
         let cells = List.map (Board.get board) (Board.positions board) in
         match condition.quantifier with
         | No -> not (List.exists (fun cell -> relevant cell && target cell) cells)
         | Exists -> List.exists (fun cell -> relevant cell && target cell) cells
         | For_all ->
             List.for_all (fun cell -> (not (relevant cell)) || target cell) cells)
       game.wins

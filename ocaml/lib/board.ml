open Domain

module Coordinates = Set.Make (struct
  type t = position

  let compare = compare
end)

type t = {
  width : int;
  height : int;
  cells : cell Positions.t;
  locations : Coordinates.t Int_map.t;
  by_row : position list;
  by_column : position list;
}

let empty =
  {
    width = 0;
    height = 0;
    cells = Positions.empty;
    locations = Int_map.empty;
    by_row = [];
    by_column = [];
  }

let create ~width ~height =
  if width <= 0 || height <= 0 then invalid_arg "board dimensions must be positive";
  {
    width;
    height;
    cells = Positions.empty;
    locations = Int_map.empty;
    by_row = List.init height (fun y -> List.init width (fun x -> (x, y))) |> List.concat;
    by_column =
      List.init width (fun x -> List.init height (fun y -> (x, y))) |> List.concat;
  }

let width board = board.width
let height board = board.height
let contains board (x, y) = x >= 0 && y >= 0 && x < board.width && y < board.height

let get board position =
  if not (contains board position) then invalid_arg "cell outside board";
  Option.value ~default:empty_cell (Positions.find_opt position board.cells)

let set board position (cell : cell) =
  if not (contains board position) then invalid_arg "cell outside board";
  let before = get board position in
  if
    Int_set.equal before.objects cell.objects
    && Int_map.equal Movements.equal before.movements cell.movements
  then board
  else
    let adjust update id locations =
      let positions =
        Option.value ~default:Coordinates.empty (Int_map.find_opt id locations)
        |> update position
      in
      if Coordinates.is_empty positions then Int_map.remove id locations
      else Int_map.add id positions locations
    in
    let locations =
      Int_set.fold (adjust Coordinates.remove)
        (Int_set.diff before.objects cell.objects)
        board.locations
    in
    let locations =
      Int_set.fold (adjust Coordinates.add)
        (Int_set.diff cell.objects before.objects)
        locations
    in
    let cells =
      if cell = empty_cell then Positions.remove position board.cells
      else Positions.add position cell board.cells
    in
    { board with cells; locations }

let has_object id board = Int_map.mem id board.locations

let object_count id board =
  match Int_map.find_opt id board.locations with
  | None -> 0
  | Some positions -> Coordinates.cardinal positions

let positions_of_any ?(vertical = false) ids board =
  let positions =
    List.fold_left
      (fun positions id ->
        match Int_map.find_opt id board.locations with
        | None -> positions
        | Some more -> Coordinates.union positions more)
      Coordinates.empty ids
    |> Coordinates.elements
  in
  if vertical then positions
  else List.sort (fun (x, y) (x', y') -> compare (y, x) (y', x')) positions

let hash board = Hashtbl.hash (board.width, board.height, board.cells)

let of_rows rows =
  let width = match rows with [] -> 0 | row :: _ -> List.length row in
  if List.exists (fun row -> List.length row <> width) rows then
    invalid_arg "board rows must be rectangular";
  let board = create ~width ~height:(List.length rows) in
  List.fold_left
    (fun board (y, row) ->
      List.fold_left
        (fun board (x, cell) -> set board (x, y) cell)
        board
        (List.mapi (fun x cell -> (x, cell)) row))
    board
    (List.mapi (fun y row -> (y, row)) rows)

let rows board =
  List.init board.height (fun y -> List.init board.width (fun x -> get board (x, y)))

let positions ?(vertical = false) board =
  if vertical then board.by_column else board.by_row

let map f board =
  List.fold_left (fun out p -> set out p (f p (get board p))) board (positions board)

let equal a b =
  a == b
  || a.width = b.width && a.height = b.height
     && List.for_all
          (fun p ->
            let a = get a p and b = get b p in
            Int_set.equal a.objects b.objects
            && Int_map.equal Movements.equal a.movements b.movements)
          (positions a)

let equal_objects a b =
  a == b
  || a.width = b.width && a.height = b.height
     && List.for_all
          (fun p -> Int_set.equal (get a p).objects (get b p).objects)
          (positions a)

let clear_movements board =
  map (fun _ cell -> { cell with movements = Int_map.empty }) board

let object_names (game : game) (cell : cell) =
  Int_set.elements cell.objects
  |> List.map (fun id -> (Frozen_array.get game.objects id).name)
  |> List.sort Utf8.compare_utf16

let names game board =
  List.init board.height (fun y ->
      List.init board.width (fun x -> object_names game (get board (x, y))))

let serialize game board =
  let labels = ref Names.empty and next = ref 0 in
  let out = Buffer.create 128 in
  List.iteri
    (fun index p ->
      let label = String.concat " " (object_names game (get board p)) in
      let id =
        match Names.find_opt label !labels with
        | Some id -> id
        | None ->
            let id = !next in
            incr next;
            labels := Names.add label id !labels;
            Buffer.add_string out (label ^ ":");
            id
      in
      Buffer.add_string out (string_of_int id ^ ",");
      if (index + 1) mod board.width = 0 then Buffer.add_char out '\n')
    (positions ~vertical:true board);
  Buffer.contents out

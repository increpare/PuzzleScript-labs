type relative = Forward | Backward | Anticlockwise | Clockwise
type axis = Horizontal | Vertical

type t =
  | No
  | Stationary
  | Movement of Domain.movement
  | Relative of relative
  | Moving
  | Orthogonal
  | Axis of axis
  | Parallel
  | Perpendicular
  | Random
  | Randomdir
  | Ellipsis

let of_string = function
  | "no" -> Some No
  | "stationary" -> Some Stationary
  | "action" -> Some (Movement Action)
  | "up" -> Some (Movement (Move Up))
  | "down" -> Some (Movement (Move Down))
  | "left" -> Some (Movement (Move Left))
  | "right" -> Some (Movement (Move Right))
  | ">" -> Some (Relative Forward)
  | "<" -> Some (Relative Backward)
  | "^" -> Some (Relative Anticlockwise)
  | "v" -> Some (Relative Clockwise)
  | "moving" -> Some Moving
  | "orthogonal" -> Some Orthogonal
  | "horizontal" -> Some (Axis Horizontal)
  | "vertical" -> Some (Axis Vertical)
  | "parallel" -> Some Parallel
  | "perpendicular" -> Some Perpendicular
  | "random" -> Some Random
  | "randomdir" -> Some Randomdir
  | _ -> None

let to_string = function
  | No -> "no"
  | Stationary -> "stationary"
  | Movement Action -> "action"
  | Movement (Move direction) -> Direction.to_string direction
  | Relative Forward -> ">"
  | Relative Backward -> "<"
  | Relative Anticlockwise -> "^"
  | Relative Clockwise -> "v"
  | Moving -> "moving"
  | Orthogonal -> "orthogonal"
  | Axis Horizontal -> "horizontal"
  | Axis Vertical -> "vertical"
  | Parallel -> "parallel"
  | Perpendicular -> "perpendicular"
  | Random -> "random"
  | Randomdir -> "randomdir"
  | Ellipsis -> "..."

let keywords =
  [
    "no";
    "stationary";
    "moving";
    "action";
    "up";
    "down";
    "left";
    "right";
    "horizontal";
    "vertical";
    "orthogonal";
    "parallel";
    "perpendicular";
    ">";
    "<";
    "^";
    "v";
    "random";
    "randomdir";
  ]

let movements direction =
  let moves directions = List.map (fun direction -> Domain.Move direction) directions in
  function
  | Movement movement -> Some [ movement ]
  | Relative relative ->
      let direction =
        match relative with
        | Forward -> direction
        | Backward -> Direction.opposite direction
        | Anticlockwise -> Direction.anticlockwise direction
        | Clockwise -> Direction.clockwise direction
      in
      Some [ Move direction ]
  | Moving -> Some (moves Direction.all @ [ Action ])
  | Orthogonal -> Some (moves Direction.all)
  | Axis Horizontal -> Some (moves [ Left; Right ])
  | Axis Vertical -> Some (moves [ Up; Down ])
  | Parallel ->
      Some
        (moves
           (match direction with
           | Up | Down -> [ Up; Down ]
           | Left | Right -> [ Left; Right ]))
  | Perpendicular ->
      Some
        (moves
           (match direction with
           | Up | Down -> [ Left; Right ]
           | Left | Right -> [ Up; Down ]))
  | No | Stationary | Random | Randomdir | Ellipsis -> None

let directional = function Relative _ | Parallel | Perpendicular -> true | _ -> false

type direction = Cardinal of Direction.t | Horizontal | Vertical | Orthogonal

type t = {
  directions : direction list;
  late : bool;
  rigid : bool;
  random : bool;
  joined : bool;
}

let direction_of_string = function
  | "up" -> Some (Cardinal Up)
  | "down" -> Some (Cardinal Down)
  | "left" -> Some (Cardinal Left)
  | "right" -> Some (Cardinal Right)
  | "horizontal" -> Some Horizontal
  | "vertical" -> Some Vertical
  | "orthogonal" -> Some Orthogonal
  | _ -> None

let expand_direction = function
  | Cardinal direction -> [ direction ]
  | Horizontal -> [ Direction.Left; Right ]
  | Vertical -> [ Up; Down ]
  | Orthogonal -> Direction.all

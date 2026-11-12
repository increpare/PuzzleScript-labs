type t = Up | Down | Left | Right

let all = [ Up; Down; Left; Right ]
let delta = function Up -> (0, -1) | Down -> (0, 1) | Left -> (-1, 0) | Right -> (1, 0)
let opposite = function Up -> Down | Down -> Up | Left -> Right | Right -> Left
let clockwise = function Up -> Right | Right -> Down | Down -> Left | Left -> Up
let anticlockwise d = opposite (clockwise d)
let to_string = function Up -> "up" | Down -> "down" | Left -> "left" | Right -> "right"

let of_string = function
  | "up" -> Some Up
  | "down" -> Some Down
  | "left" -> Some Left
  | "right" -> Some Right
  | _ -> None

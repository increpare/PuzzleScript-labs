(* Source provenance belongs to compilation, not executable transactions.
   Equal transactions on different source lines can have different random weight. *)
type identity = {
  source_line : int;
  source_direction : Direction.t option;
  source_lhs : Syntax.pattern_cell list list;
  source_rhs : Syntax.pattern_cell list list option;
  source_commands : Domain.command list;
  source_rigid : bool;
  source_random : bool;
}

module Identities = Set.Make (struct
  type t = identity

  let compare = compare
end)

module Oriented = struct
  type t = {
    authored : Syntax.authored_rule;
    direction : Direction.t;
    left : Syntax.pattern_cell list list;
    right : Syntax.pattern_cell list list option;
  }
end

module Bound = struct
  (* Movement choices and relative directions cannot reach lowering. *)
  type qualifier =
    | Unspecified
    | Excluded
    | Stationary
    | Movement of Domain.movement
    | Random_object
    | Random_direction

  type term = { name : string; qualifier : qualifier }
  type item = Named of term | Ellipsis of string
  type cell = { detection : item list; replacement : item list option }
  type error = Unresolved_movement of Qualifier.t | Mismatched_patterns

  type t = {
    authored : Syntax.authored_rule;
    direction : Direction.t;
    rows : cell list list;
    identity : identity;
  }

  let qualifier = function
    | None -> Ok Unspecified
    | Some Qualifier.No -> Ok Excluded
    | Some Stationary -> Ok Stationary
    | Some (Movement movement) -> Ok (Movement movement)
    | Some Random -> Ok Random_object
    | Some Randomdir -> Ok Random_direction
    | Some
        (( Relative _ | Moving | Orthogonal | Axis _ | Parallel | Perpendicular
         | Qualifier.Ellipsis ) as unresolved) ->
        Error (Unresolved_movement unresolved)

  let ( let* ) = Result.bind

  let traverse f values =
    let rec visit reversed = function
      | [] -> Ok (List.rev reversed)
      | value :: rest ->
          let* value = f value in
          visit (value :: reversed) rest
    in
    visit [] values

  let item = function
    | Syntax.Ellipsis name -> Ok (Ellipsis name)
    | Named { term_name; qualifier = Some Qualifier.Ellipsis } -> Ok (Ellipsis term_name)
    | Named { term_name; qualifier = authored } ->
        let* qualifier = qualifier authored in
        Ok (Named { name = term_name; qualifier })

  let of_oriented ~identity (source : Oriented.t) =
    let rows = traverse (traverse (traverse item)) in
    let* left = rows source.left in
    let* right =
      match source.right with
      | None -> Ok None
      | Some right ->
          let* right = rows right in
          Ok (Some right)
    in
    let rec zip f left right =
      match (left, right) with
      | [], [] -> Ok []
      | left :: left_rest, right :: right_rest ->
          let* paired = f left right in
          let* rest = zip f left_rest right_rest in
          Ok (paired :: rest)
      | [], _ :: _ | _ :: _, [] -> Error Mismatched_patterns
    in
    let* rows =
      match right with
      | None ->
          Ok
            (List.map
               (List.map (fun detection -> { detection; replacement = None }))
               left)
      | Some right ->
          zip
            (zip (fun detection replacement ->
                 Ok { detection; replacement = Some replacement }))
            left right
    in
    Ok { authored = source.authored; direction = source.direction; rows; identity }
end

type lowered = {
  identity : identity;
  rule : Domain.rule;
  overlap : (string * string) option;
  source_group : int;
  late : bool;
}

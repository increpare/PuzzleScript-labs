type compilation = private {
  game : Domain.game;
  document : Syntax.document;
  diagnostics : Syntax.diagnostic list;
}
(** Successful compilation can include diagnosed recovery. The result owns an immutable
    game and retains source syntax and ordered diagnostics for callers that display or
    inspect them. *)

val source : string -> (compilation, Syntax.diagnostic list) result
val compile : Syntax.document -> (compilation, Syntax.diagnostic list) result

val board : Domain.game -> string list -> (Board.t, Syntax.diagnostic list) result
(** Build a board from source glyph rows with the game's namespaces and background rules.
    Diagnosed recovery is returned as [Error] here. *)

type context = {
  glyphs : int list Domain.Names.t;
  property_names : string list;
  layers : Domain.Int_set.t Frozen_array.t;
  background_id : int option;
  background_layer : int option;
}

type compiled = { board : Board.t; diagnostics : Syntax.diagnostic list }

val grid : context -> Syntax.level_row list -> (compiled, Syntax.diagnostic list) result
(** Write glyphs in column order. The first invalid glyph returns the partial board and
    its diagnostic without background filling. *)

val message : Syntax.level_message -> string * Syntax.diagnostic list
(** Compile a message and its terminal-height warning using UTF-16 units. *)

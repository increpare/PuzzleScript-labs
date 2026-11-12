type t = private {
  definitions : Domain.object_definition Frozen_array.t;
  namespace : Domain.name Domain.Names.t;
  actuals : Domain.object_reference Domain.Names.t;
  properties : Domain.object_reference list Domain.Names.t;
  property_layers : int option Domain.Names.t;
  compiled_names : Compiled_names.t;
  memberships : Domain.object_reference list Domain.Names.t;
  win_names : Domain.name Domain.Names.t;
  player : Domain.name;
  glyphs : int list Domain.Names.t;
  collision : Domain.Int_set.t Frozen_array.t;
  glyph_diagnostics : Syntax.diagnostic list;
  name_diagnostics : Syntax.diagnostic list;
  unlayered : Syntax.diagnostic list;
}

val compile : Syntax.document -> (t, Syntax.diagnostic list) result
(** Resolve source declarations into explicit identity/layer references. Glyph
    registration and final semantic names remain distinct namespaces. *)

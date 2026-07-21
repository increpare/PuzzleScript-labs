import PuzzleScript.BitVec

namespace PuzzleScript

structure CellPattern where
  objectsPresent : MaskWords
  objectsMissing : MaskWords
  /-- Each entry is an OR-mask: the cell must share at least one bit with the mask
  (JS `anyObjectsPresent`; AND across entries). -/
  anyObjectsPresent : Array MaskWords
  anyMovementsPresent : Array MaskWords
  movementsPresent : MaskWords
  movementsMissing : MaskWords
  /-- When false, replacement is a no-op (JS `replacement === null`). -/
  hasReplacement : Bool
  objectsClear : MaskWords
  objectsSet : MaskWords
  movementsClear : MaskWords
  movementsSet : MaskWords
  /-- OR'd into movements clear at apply time (JS `movementsLayerMask`). -/
  movementsLayerMask : MaskWords
  deriving Repr

inductive PatternCell where
  | cell (cp : CellPattern)
  | ellipsis
  deriving Repr

/-- Row match start: fixed tile, or ellipsis tuple from JS `cellRowMatches`. -/
inductive RowMatch where
  | fixed (start : Nat)
  | ellipsis1 (start gap : Nat)
  | ellipsis2 (start gap1 gap2 : Nat)
  deriving Repr, Inhabited

structure Rule where
  direction : Nat
  lineNumber : Nat
  groupNumber : Nat
  patternRows : Array (Array PatternCell)
  ellipsisCounts : Array Nat
  commands : Array String
  rigid : Bool
  isRandom : Bool
  deriving Repr

structure WinCondition where
  quantifier : Int
  filter1 : MaskWords
  filter2 : MaskWords
  aggr1 : Bool
  aggr2 : Bool
  deriving Repr

end PuzzleScript

import PuzzleScript.BitVec

namespace PuzzleScript

structure CellPattern where
  objectsPresent : MaskWords
  objectsMissing : MaskWords
  movementsPresent : MaskWords
  movementsMissing : MaskWords
  objectsClear : MaskWords
  objectsSet : MaskWords
  movementsClear : MaskWords
  movementsSet : MaskWords
  /-- OR'd into movements clear at apply time (JS `movementsLayerMask`). -/
  movementsLayerMask : MaskWords
  deriving Repr

structure Rule where
  direction : Nat
  lineNumber : Nat
  groupNumber : Nat
  /-- Single row of adjacent cells (v1). -/
  cells : Array CellPattern
  deriving Repr

structure WinCondition where
  quantifier : Int
  filter1 : MaskWords
  filter2 : MaskWords
  deriving Repr

end PuzzleScript

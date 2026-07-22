import PuzzleScript.Board
import PuzzleScript.BitVec
import PuzzleScript.Command
import PuzzleScript.Dir4
import PuzzleScript.IR
import PuzzleScript.Rng
import PuzzleScript.Rules
import PuzzleScript.View

namespace PuzzleScript

def ruleDirectionDelta (direction : RuleDir) (height : Nat) : Int :=
  let h := Int.ofNat height
  let d := direction.bits
  let d0 := Int.ofNat (d &&& 1).toNat
  let d1 := Int.ofNat ((d >>> 1) &&& 1).toNat
  let d2 := Int.ofNat ((d >>> 2) &&& 1).toNat
  let d3 := Int.ofNat ((d >>> 3) &&& 1).toNat
  (d3 - d2) * h + (d1 - d0)

/-- Int cursor for the `k`-th cell on a fixed (non-ellipsis) line walk. -/
def fixedWalkIdx (start : Nat) (delta : Int) (k : Nat) : Int :=
  Int.ofNat start + delta * Int.ofNat k

/-- `some t` when the cursor is non-negative (matches match/apply OOB gating). -/
def fixedWalkTile? (start : Nat) (delta : Int) (k : Nat) : Option Nat :=
  let idx := fixedWalkIdx start delta k
  if idx < 0 then none else some idx.toNat

/-- Cardinal single-bit rule directions (UP/DOWN/LEFT/RIGHT). -/
def RuleDir.isCardinal (d : RuleDir) : Bool :=
  let n := d.toNat
  n == 1 || n == 2 || n == 4 || n == 8

/-- JS `processInput` direction index → movement bit mask (before layer shift). -/
def dirInputToLayerBits (dir : Int) : Option UInt32 :=
  match Dir4.ofInputIndex? dir with
  | some d => some d.toBits
  | none => if dir == 4 then some 16 else none

def dirDelta (dirBits : UInt32) : Option (Int × Int) :=
  Dir4.ofBits? dirBits |>.map (·.delta)

/-- Player / clock input. Movement uses `Dir4`; JS action key is `.action` (bit 16). -/
inductive InputToken where
  | move (d : Dir4)
  | action
  | undo
  | restart
  | tick
  deriving Repr

def InputToken.dirMask? : InputToken → Option UInt32
  | .move d => some d.toBits
  | .action => some 16
  | .undo | .restart | .tick => none

def parseMovementInputToken (tok : String) : Except String InputToken :=
  if tok == "undo" then
    pure (.undo)
  else if tok == "restart" then
    pure (.restart)
  else if tok == "tick" then
    pure (.tick)
  else
    match tok.toInt? with
    | none => throw s!"invalid input token: {tok}"
    | some n =>
      if n == 4 then
        pure .action
      else
        match Dir4.ofInputIndex? n with
        | some d => pure (.move d)
        | none => throw s!"input code out of range (expected 0..4): {tok}"

/-- Apply clear/set masks bitwisely: `result_bit = set ∨ (old ∧ ¬clear)`. -/
def maskApplyReplacement (old clear set : MaskWords) : MaskWords :=
  let nWords := max (max old.size clear.size) set.size
  let maxBit := nWords * 32
  (List.range maxBit).foldl
    (fun acc bit =>
      let v := maskGetBit set bit || (maskGetBit old bit && !maskGetBit clear bit)
      maskSetBit acc bit v)
    (#[] : MaskWords)

/-- Alias: authoritative builder lives on `Game` (`IR.lean`) for WF / parse checks. -/
abbrev buildLayerMasks := Game.buildLayerMasks

private def anyObjectsPresentMatch (objs : MaskWords) (terms : Array MaskWords) : Bool :=
  terms.all fun term => maskAnyBits (maskAnd objs term)

private def anyMovementsPresentMatch (movs : MaskWords) (terms : Array MaskWords) : Bool :=
  terms.all fun term => maskAnyBits (maskAnd movs term)

private def maskAggregateMatchesAtTile (b : Board) (mask : MaskWords) (tile : Nat) : Bool :=
  maskBitsSetIn mask (b.cellObjWords tile)

def layerOptionMatches (objs movs : MaskWords) (layer : LayerCoupledLayer) : Bool :=
  -- Native/JS: object mask is an overlap test (any bit), not a full subset test.
  maskAnyBits (maskAnd layer.objectMask objs)
    && (if maskAnyBits layer.movementsAny then maskAnyBits (maskAnd movs layer.movementsAny) else true)
    && maskBitsSetIn layer.movementsPresent movs
    && maskNoBitsInCommon layer.movementsMissing movs

private def layerCoupledTermMatches (objs movs : MaskWords) (term : LayerCoupledTerm) : Bool :=
  maskAnyBits (maskAnd term.objectMask objs) && term.layers.any (layerOptionMatches objs movs)

private def layerCoupledMasksMatch (objs movs : MaskWords) (terms : Array LayerCoupledTerm) : Bool :=
  terms.all (layerCoupledTermMatches objs movs)

def getLayerMovementBits (mov : MaskWords) (layer : Nat) : UInt32 :=
  let shift := 5 * layer
  let wordIdx := shift / 32
  let wordShift := shift % 32
  let w0 := maskWord mov wordIdx
  let raw := w0 >>> UInt32.ofNat wordShift
  let raw' :=
    if wordShift > 27 then
      raw ||| (maskWord mov (wordIdx + 1) <<< (32 - UInt32.ofNat wordShift))
    else raw
  raw' &&& 31

def setLayerMovementBits (mov : MaskWords) (layer : Nat) (bits : UInt32) : MaskWords :=
  let shift := 5 * layer
  let wordIdx := shift / 32
  let wordShift := shift % 32
  let clearMask : UInt32 := (31 : UInt32) <<< UInt32.ofNat wordShift
  let setBits := (bits &&& 31) <<< UInt32.ofNat wordShift
  Id.run do
    let mut out := mov
    while out.size ≤ wordIdx + 1 do
      out := out.push 0
    let old := maskWord out wordIdx
    out := out.set! wordIdx ((old &&& (~~~clearMask)) ||| setBits)
    if wordShift > 27 then
      let spill := (bits &&& 31) >>> (32 - UInt32.ofNat wordShift)
      let old1 := maskWord out (wordIdx + 1)
      let clearHigh : UInt32 := (31 : UInt32) >>> UInt32.ofNat (32 - wordShift)
      out := out.set! (wordIdx + 1) ((old1 &&& (~~~clearHigh)) ||| spill)
    pure out

def clearLayerMovementBits (mov : MaskWords) (layer : Nat) : MaskWords :=
  setLayerMovementBits mov layer 0

def movMaskZeros (stride : Nat) : MaskWords :=
  Array.replicate stride (0 : UInt32)

def getMovementBitsForLayerAt (b : Board) (tile : Nat) (layer : Nat) : UInt32 :=
  getLayerMovementBits (b.cellMovWords tile) layer

def tupleCellTile (rm : RowMatch) (delta : Int) (_rowIdx cellIdx : Nat) : Nat :=
  let base :=
    match rm with
    | .fixed s => s
    | .ellipsis1 s _ => s
    | .ellipsis2 s _ _ => s
  (Int.ofNat base + delta * Int.ofNat cellIdx).toNat

/-- Whether a property alias matches at `tile` for this binding (object + optional movement). -/
def propertyAliasMatches (b : Board) (tile : Nat) (bnd : PropertyBinding)
    (alias : PropertyAlias) : Bool :=
  if !maskGetBit (b.cellObjWords tile) alias.objectId.val then
    false
  else
    let mode := bnd.sourceMovementMode
    if mode != 0 then
      let movementBits := getMovementBitsForLayerAt b tile alias.layerIndex.val
      let sm := UInt32.ofNat bnd.sourceMovementMask
      if mode == 1 then
        (movementBits &&& sm) == 0
      else if mode == 3 then
        (movementBits &&& sm) != 0
      else
        (movementBits &&& sm) == sm
    else
      true

/-- Pick first alias that matches cell object bits (+ optional movement filter). -/
def capturePropertyBindingAlias (b : Board) (delta : Int) (tuple : Array RowMatch)
    (bnd : PropertyBinding) : Option PropertyAlias :=
  let rm := tuple.getD bnd.sourceRow (.fixed 0)
  let tile := tupleCellTile rm delta bnd.sourceRow bnd.sourceCell
  bnd.aliases.toList.find? (propertyAliasMatches b tile bnd)

def capturePropertyBindings (_game : Game) (b : Board) (rule : Rule) (tuple : Array RowMatch) (delta : Int)
    (caps : RuleCaptures) : RuleCaptures :=
  rule.propertyBindings.toList.foldl
    (fun out bnd =>
      match capturePropertyBindingAlias b delta tuple bnd with
      | some alias => out.setProperty bnd.propertyName alias
      | none => out)
    caps

/-- Apply one aggregate binding (properties unchanged). -/
def captureAggregateBinding (b : Board) (tuple : Array RowMatch) (delta : Int)
    (caps : RuleCaptures) (bnd : AggregateBinding) : RuleCaptures :=
  let rm := tuple.getD bnd.sourceRow (.fixed 0)
  let tile := tupleCellTile rm delta bnd.sourceRow bnd.sourceCell
  let sourceLayer? : Option Nat :=
    match bnd.sourcePropertyName, bnd.sourceLayer with
    | some pname, _ => (caps.getProperty pname).map (fun (a : PropertyAlias) => a.layerIndex.val)
    | none, some l => some l
    | none, none => some 0
  let bits : Nat :=
    match sourceLayer? with
    | none => 0
    | some sourceLayer =>
      (getMovementBitsForLayerAt b tile sourceLayer).toNat &&& bnd.aggregateMask
  caps.setAggregate bnd.aggregateName bits

def captureAggregateBindings (b : Board) (rule : Rule) (tuple : Array RowMatch) (delta : Int)
    (caps : RuleCaptures) : RuleCaptures :=
  rule.aggregateBindings.toList.foldl (captureAggregateBinding b tuple delta) caps

/-- One inferred-aggregate binding step (movement-only; objects unchanged). -/
def applyInferredAggregateBinding (caps : RuleCaptures) :
    (MaskWords × MaskWords × MaskWords × MaskWords) → InferredAggregateBinding →
      (MaskWords × MaskWords × MaskWords × MaskWords)
  | (oc, os, mc, ms), b =>
    match caps.getAggregate b.aggregateName with
    | none => (oc, os, mc, ms)
    | some captured =>
      let layerIdx? :=
        match b.layerIndex, b.propertyName with
        | some l, _ => some l
        | none, some pname =>
          match caps.getProperty pname with
          | some cap => some cap.layerIndex.val
          | none => none
        | none, none => some 0
      match layerIdx? with
      | none => (oc, os, mc, ms)
      | some layerIdx =>
        let ms := setLayerMovementBits ms layerIdx (UInt32.ofNat captured)
        let mc :=
          match b.propertyName with
          | some pname =>
            match caps.getProperty pname with
            | some cap => setLayerMovementBits mc cap.layerIndex.val 31
            | none => mc
          | none => mc
        (oc, os, mc, ms)

/-- Sources + property bindings (object-affecting inferred phase). -/
def applyInferredPropertyAndBindingMasks (game : Game) (pat : CellPattern) (caps : RuleCaptures)
    (objectsClear objectsSet movementsClear movementsSet : MaskWords) :
    (MaskWords × MaskWords × MaskWords × MaskWords) :=
  let (oc, os, mc, ms) :=
    pat.inferredPropertySources.foldl
      (fun (oc, os, mc, ms) s =>
        match caps.getProperty s.propertyName with
        | some cap =>
          (maskOr oc (game.layerMasks.getD cap.layerIndex.val #[]), os,
            setLayerMovementBits mc cap.layerIndex.val 31, ms)
        | none => (oc, os, mc, ms))
      (objectsClear, objectsSet, movementsClear, movementsSet)
  pat.inferredPropertyBindings.foldl
    (fun (oc, os, mc, ms) b =>
      match caps.getProperty b.propertyName with
      | some cap =>
        let mc :=
          if b.dirMode != 0 then setLayerMovementBits mc cap.layerIndex.val 31 else mc
        let ms :=
          if b.dirMode != 0 && b.dirMode == 2 then
            setLayerMovementBits ms cap.layerIndex.val (UInt32.ofNat b.dirMask)
          else ms
        let layer := (game.objectLayers.getD cap.objectId.val ⟨0⟩).val
        let layerMask := game.layerMasks.getD layer #[]
        (maskOr oc layerMask, maskSetBit (maskAndNot os layerMask) cap.objectId.val true, mc, ms)
      | none => (oc, os, mc, ms))
    (oc, os, mc, ms)

/-- Layer-coupled movement replacements (movement-only). -/
def applyLayerCoupledMovementReplacements (caps : RuleCaptures)
    (objs movs : MaskWords) (couplings : Array LayerCoupledMovementReplacement)
    (mc ms : MaskWords) : MaskWords × MaskWords :=
  couplings.foldl
    (fun (mc, ms) coupled =>
      coupled.layers.foldl
        (fun (mc, ms) layerTerm =>
          if layerOptionMatches objs movs layerTerm then
            let mc := setLayerMovementBits mc layerTerm.layerIndex 31
            let ms :=
              match coupled.replacementAggregateName with
              | some aname =>
                match caps.getAggregate aname with
                | some bits => setLayerMovementBits ms layerTerm.layerIndex (UInt32.ofNat bits)
                | none => ms
              | none =>
                match coupled.replacementMovementMask with
                | some m => setLayerMovementBits ms layerTerm.layerIndex (UInt32.ofNat m)
                | none => ms
            (mc, ms)
          else
            (mc, ms))
        (mc, ms))
    (mc, ms)

/-- Apply inferred property/aggregate/layer-coupled mask rewrites (pure folds). -/
def applyInferredReplacementFields (game : Game) (pat : CellPattern) (caps : RuleCaptures)
    (objs movs : MaskWords)
    (objectsClear objectsSet movementsClear movementsSet : MaskWords) :
    (MaskWords × MaskWords × MaskWords × MaskWords) :=
  let bnd :=
    applyInferredPropertyAndBindingMasks game pat caps
      objectsClear objectsSet movementsClear movementsSet
  let agg :=
    pat.inferredAggregateBindings.foldl (applyInferredAggregateBinding caps) bnd
  let (mc, ms) :=
    applyLayerCoupledMovementReplacements caps objs movs
      pat.layerCoupledMovementReplacements agg.2.2.1 agg.2.2.2
  (agg.1, agg.2.1, mc, ms)

def buildRigidGroupMask (game : Game) (groupNumber : Nat) (movementsLayerMask : MaskWords) (stride : Nat) : MaskWords :=
  let rgi := (game.groupNumberToRigidGroupIndex.getD groupNumber none).getD 0 + 1
  let full :=
    (List.range game.layerCount).foldl
      (fun m layer => setLayerMovementBits m layer (UInt32.ofNat rgi))
      (movMaskZeros stride)
  maskAnd full movementsLayerMask

private def cellPatternMatches (b : Board) (tile : Nat) (pat : CellPattern) : Bool :=
  let objs := b.cellObjWords tile
  let movs := b.cellMovWords tile
  maskBitsSetIn pat.objectsPresent objs
    && maskNoBitsInCommon pat.objectsMissing objs
    && anyObjectsPresentMatch objs pat.anyObjectsPresent
    && anyMovementsPresentMatch movs pat.anyMovementsPresent
    && layerCoupledMasksMatch objs movs pat.layerCoupledMovementMasks
    && maskBitsSetIn pat.movementsPresent movs
    && maskNoBitsInCommon pat.movementsMissing movs

def collectMaskBits (m : MaskWords) (maxBit : Nat) : Array Nat :=
  ((List.range maxBit).filter (fun bit => maskGetBit m bit)).toArray

private def dirBitsFromIndex (n : Nat) : UInt32 :=
  (Dir4.ofRandomIndex n).toBits

/-- Random-entity draw: set one oid and OR its collision-layer into clear masks. -/
def applyRandomEntityMasks (game : Game) (b : Board) (pat : CellPattern)
    (objectsClear objectsSet movementsClear : MaskWords) (rng : RngState) :
    MaskWords × MaskWords × MaskWords × RngState :=
  if !maskAnyBits pat.randomEntityMask then
    (objectsClear, objectsSet, movementsClear, rng)
  else
    let choices := collectMaskBits pat.randomEntityMask game.objectCount
    if choices.isEmpty then
      (objectsClear, objectsSet, movementsClear, rng)
    else
      let (idx0, r) := rng.randomNat 0 choices.size
      -- Guard float RNG; in-range index makes WF / RepOk proofs tractable.
      if hIdx : idx0 < choices.size then
        let oid := choices[idx0]
        let layer := (game.objectLayers.getD oid ⟨0⟩).val
        let layerMask := game.layerMasks.getD layer #[]
        (maskOr objectsClear layerMask,
          maskSetBit (maskAndNot objectsSet layerMask) oid true,
          maskOr movementsClear (setLayerMovementBits (movMaskZeros b.strideMov) layer 31),
          r)
      else
        (objectsClear, objectsSet, movementsClear, r)

/-- RandomDir: fold over layers (proof-friendly vs `for` + `Id.run`). -/
def applyRandomDirMasks (game : Game) (pat : CellPattern)
    (movementsSet : MaskWords) (rng : RngState) : MaskWords × RngState :=
  (List.range game.layerCount).foldl
    (fun (ms, rng) layer =>
      if getLayerMovementBits pat.randomDirMask layer != 0 then
        let (dirIdx, r) := rng.randomNat 0 4
        (setLayerMovementBits ms layer (dirBitsFromIndex dirIdx), r)
      else
        (ms, rng))
    (movementsSet, rng)

/-- Rigid group bookkeeping for a cell; returns `(board, rigidChanged)`. -/
def applyRigidCellMasks (game : Game) (rule : Rule) (b : Board) (tile : Nat)
    (pat : CellPattern) : Board × Bool :=
  if !rule.rigid then
    (b, false)
  else
    let rigidMask := buildRigidGroupMask game rule.groupNumber pat.movementsLayerMask b.strideMov
    let curGroup := b.cellRigidGroupIndexMask tile
    let curApplied := b.cellRigidMovementAppliedMask tile
    if maskNoBitsInCommon rigidMask curGroup &&
        maskNoBitsInCommon pat.movementsLayerMask curApplied then
      let b := b.setCellRigidGroupIndexMask tile (maskOr curGroup rigidMask)
      let b := b.setCellRigidMovementAppliedMask tile (maskOr curApplied pat.movementsLayerMask)
      (b, true)
    else
      (b, false)

/--
Commit object/movement/rigid writes for one replacement cell.
Public for well-formedness proofs.
-/
def commitCellReplacement (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern)
    (objectsClear objectsSet movementsClear movementsSet : MaskWords) (rng : RngState) :
    Bool × Board × RngState :=
  let oldObj := b.cellObjWords tile
  let oldMov := b.cellMovWords tile
  let newObj := maskApplyReplacement oldObj objectsClear objectsSet
  let movClear := maskOr movementsClear pat.movementsLayerMask
  let newMov := maskApplyReplacement oldMov movClear movementsSet
  let (board0, rigidChange) := applyRigidCellMasks game rule b tile pat
  if newObj == oldObj && newMov == oldMov && !rigidChange then
    (false, b, rng)
  else
    let board := (board0.setCellObjWords tile newObj).setCellMovWords tile newMov
    (true, board, rng)

/-- Cell replacement (public for WF preservation). -/
def applyCellReplacement (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern)
    (caps : RuleCaptures) (rng : RngState) : (Bool × Board × RngState) :=
  if !pat.hasReplacement then
    (false, b, rng)
  else
    let (oc0, os0, mc0, rng1) :=
      applyRandomEntityMasks game b pat pat.objectsClear pat.objectsSet pat.movementsClear rng
    let (ms0, rng2) := applyRandomDirMasks game pat pat.movementsSet rng1
    let oldObj := b.cellObjWords tile
    let oldMov := b.cellMovWords tile
    let (oc, os, mc, ms) :=
      applyInferredReplacementFields game pat caps oldObj oldMov oc0 os0 mc0 ms0
    commitCellReplacement game rule b tile pat oc os mc ms rng2

def rowCellsMatchFixed (b : Board) (startTile : Nat) (delta : Int) (row : Array PatternCell) : Bool :=
  (List.range row.size).all fun k =>
    match row[k]?.getD (.ellipsis) with
    | .ellipsis => false
    | .cell pat =>
      match fixedWalkTile? startTile delta k with
      | none => false
      | some t =>
        t < b.nTiles && cellPatternMatches b t pat

private def rowCellsMatchEllipsis1 (b : Board) (startTile gap : Nat) (delta : Int) (row : Array PatternCell) : Bool :=
  Id.run do
    let mut idx : Int := Int.ofNat startTile
    let mut ellipsisSeen := false
    let mut gapLeft := gap
    for cell in row do
      match cell with
      | .ellipsis =>
        if ellipsisSeen then return false
        ellipsisSeen := true
        idx := idx + delta * Int.ofNat gapLeft
      | .cell pat =>
        if idx < 0 then return false
        let t := idx.toNat
        if t >= b.nTiles then return false
        if !cellPatternMatches b t pat then return false
        idx := idx + delta
    pure ellipsisSeen

private def rowCellsMatchEllipsis2 (b : Board) (startTile gap1 gap2 : Nat) (delta : Int) (row : Array PatternCell) : Bool :=
  Id.run do
    let mut idx : Int := Int.ofNat startTile
    let mut ellipsisCount := 0
    for cell in row do
      match cell with
      | .ellipsis =>
        ellipsisCount := ellipsisCount + 1
        if ellipsisCount == 1 then
          idx := idx + delta * Int.ofNat gap1
        else if ellipsisCount == 2 then
          idx := idx + delta * Int.ofNat gap2
        else
          return false
      | .cell pat =>
        if idx < 0 then return false
        let t := idx.toNat
        if t >= b.nTiles then return false
        if !cellPatternMatches b t pat then return false
        idx := idx + delta
    pure (ellipsisCount == 2)

private def patternRowLen (row : Array PatternCell) (ellipsisCount : Nat) : Nat :=
  row.size - ellipsisCount

private structure ScanBounds where
  xmin : Nat
  xmax : Nat
  ymin : Nat
  ymax : Nat
  horizontal : Bool

private def scanBoundsForRule (b : Board) (direction : Nat) (patternLen : Nat) : ScanBounds :=
  let len := patternLen
  let (xmin, xmax, ymin, ymax) :=
    if len == 0 then (0, b.width, 0, b.height)
    else
      match direction with
      | 1 => (0, b.width, len - 1, b.height)
      | 2 => (0, b.width, 0, b.height - (len - 1))
      | 4 => (len - 1, b.width, 0, b.height)
      | 8 => (0, b.width - (len - 1), 0, b.height)
      | _ => (0, b.width, 0, b.height)
  { xmin, xmax, ymin, ymax, horizontal := direction > 2 }

/-- Max ellipsis gap `k` (JS `kmax`). Use `x + 2 - len` not `x - len + 2`:
Lean `Nat` subtraction saturates, so `1 - 2 + 2 = 2` instead of `1`. -/
private def ellipsisKMax (b : Board) (direction : Nat) (x y : Nat) (len : Nat) : Nat :=
  if direction == 4 then
    if x + 1 >= len then x + 2 - len else 0
  else if direction == 8 then
    if x + len ≤ b.width then b.width + 1 - (x + len) else 0
  else if direction == 2 then
    if y + len ≤ b.height then b.height + 1 - (y + len) else 0
  else if direction == 1 then
    if y + 1 >= len then y + 2 - len else 0
  else 0

private def findFixedRowMatches (b : Board) (direction : Nat) (delta : Int) (row : Array PatternCell) : Array RowMatch :=
  let len := row.size
  if len == 0 then #[] else
  let bounds := scanBoundsForRule b direction len
  Id.run do
    let mut out : Array RowMatch := #[]
    if bounds.horizontal then
      for y in [bounds.ymin:bounds.ymax] do
        let mut i := bounds.xmin * b.height + y
        for x in [bounds.xmin:bounds.xmax] do
          if rowCellsMatchFixed b i delta row then
            out := out.push (.fixed i)
          i := i + b.height
    else
      for x in [bounds.xmin:bounds.xmax] do
        let mut i := x * b.height + bounds.ymin
        for y in [bounds.ymin:bounds.ymax] do
          if rowCellsMatchFixed b i delta row then
            out := out.push (.fixed i)
          i := i + 1
    pure out

private def findEllipsis1RowMatches (b : Board) (direction : Nat) (delta : Int) (row : Array PatternCell) : Array RowMatch :=
  let len := patternRowLen row 1
  if len == 0 then #[] else
  let bounds := scanBoundsForRule b direction len
  Id.run do
    let mut out : Array RowMatch := #[]
    if bounds.horizontal then
      for y in [bounds.ymin:bounds.ymax] do
        let mut i := bounds.xmin * b.height + y
        for x in [bounds.xmin:bounds.xmax] do
          let kmax := ellipsisKMax b direction x y len
          for k in [0:kmax] do
            if rowCellsMatchEllipsis1 b i k delta row then
              out := out.push (.ellipsis1 i k)
          i := i + b.height
    else
      for x in [bounds.xmin:bounds.xmax] do
        let mut i := x * b.height + bounds.ymin
        for y in [bounds.ymin:bounds.ymax] do
          let kmax := ellipsisKMax b direction x y len
          for k in [0:kmax] do
            if rowCellsMatchEllipsis1 b i k delta row then
              out := out.push (.ellipsis1 i k)
          i := i + 1
    pure out

private def findEllipsis2RowMatches (b : Board) (direction : Nat) (delta : Int) (row : Array PatternCell) : Array RowMatch :=
  let len := patternRowLen row 2
  if len == 0 then #[] else
  let bounds := scanBoundsForRule b direction len
  Id.run do
    let mut out : Array RowMatch := #[]
    if bounds.horizontal then
      for y in [bounds.ymin:bounds.ymax] do
        let mut i := bounds.xmin * b.height + y
        for x in [bounds.xmin:bounds.xmax] do
          let kmax := ellipsisKMax b direction x y len
          for k1 in [0:kmax] do
            for k2 in [0:kmax] do
              if k1 + k2 < kmax && rowCellsMatchEllipsis2 b i k1 k2 delta row then
                out := out.push (.ellipsis2 i k1 k2)
          i := i + b.height
    else
      for x in [bounds.xmin:bounds.xmax] do
        let mut i := x * b.height + bounds.ymin
        for y in [bounds.ymin:bounds.ymax] do
          let kmax := ellipsisKMax b direction x y len
          for k1 in [0:kmax] do
            for k2 in [0:kmax] do
              if k1 + k2 < kmax && rowCellsMatchEllipsis2 b i k1 k2 delta row then
                out := out.push (.ellipsis2 i k1 k2)
          i := i + 1
    pure out

private def findRowMatches (b : Board) (rule : Rule) (rowIndex : Nat) : Array RowMatch :=
  let row := rule.patternRows.getD rowIndex #[]
  let ec := rule.ellipsisCounts.getD rowIndex 0
  let delta := ruleDirectionDelta rule.direction b.height
  let dirNat := rule.direction.toNat
  if ec == 0 then findFixedRowMatches b dirNat delta row
  else if ec == 1 then findEllipsis1RowMatches b dirNat delta row
  else if ec == 2 then findEllipsis2RowMatches b dirNat delta row
  else #[]

private def cartesianRowMatches (lists : Array (Array RowMatch)) : Array (Array RowMatch) :=
  Id.run do
    let mut tuples : Array (Array RowMatch) := #[#[]]
    for rowMatches in lists do
      let mut next : Array (Array RowMatch) := #[]
      for rm in rowMatches do
        for t in tuples do
          next := next.push (t.push rm)
      tuples := next
    pure tuples

def rowMatchStart (rm : RowMatch) : Nat :=
  match rm with
  | .fixed s => s
  | .ellipsis1 s _ => s
  | .ellipsis2 s _ _ => s

def patternCellIsEllipsis : PatternCell → Bool
  | .ellipsis => true
  | .cell _ => false

/-- Apply one fixed row via `fixedWalkTile?` (non-ellipsis rows only). -/
def applyRowAtFixed (game : Game) (rule : Rule) (b : Board) (delta : Int) (row : Array PatternCell)
    (start : Nat) (caps : RuleCaptures) (rng : RngState) : (Bool × Board × RngState) :=
  (List.range row.size).foldl
    (fun (changed, board, rng') k =>
      match row[k]?.getD (.ellipsis) with
      | .ellipsis => (changed, board, rng')
      | .cell pat =>
        match fixedWalkTile? start delta k with
        | none => (changed, board, rng')
        | some t =>
          if t >= board.nTiles then (changed, board, rng')
          else
            let (c, b', r) := applyCellReplacement game rule board t pat caps rng'
            (changed || c, b', r))
    (false, b, rng)

def applyRowAtFold (game : Game) (rule : Rule) (b : Board) (delta : Int) (row : Array PatternCell)
    (rm : RowMatch) (caps : RuleCaptures) (rng : RngState) : (Bool × Board × RngState) :=
  let gaps : Array Nat :=
    match rm with
    | .fixed _ => #[]
    | .ellipsis1 _ g => #[g]
    | .ellipsis2 _ g1 g2 => #[g1, g2]
  let init : Nat × Int × Bool × Board × RngState :=
    (0, Int.ofNat (rowMatchStart rm), false, b, rng)
  let (_, _, changed, board, rng') :=
    row.toList.foldl
      (fun (gapIdx, idx, changed, board, rng') cell =>
        match cell with
        | .ellipsis =>
          let g := gaps.getD gapIdx 0
          (gapIdx + 1, idx + delta * Int.ofNat g, changed, board, rng')
        | .cell pat =>
          let t := idx.toNat
          -- Matches never visit OOB/negative tiles; skip is a no-op vs out-of-range set!.
          if idx < 0 || t >= board.nTiles then
            (gapIdx, idx + delta, changed, board, rng')
          else
            let (c, b', r) := applyCellReplacement game rule board t pat caps rng'
            (gapIdx, idx + delta, changed || c, b', r))
      init
  (changed, board, rng')

/-- Apply one pattern row at a matched start (pure list fold). -/
def applyRowAt (game : Game) (rule : Rule) (b : Board) (delta : Int) (row : Array PatternCell)
    (rm : RowMatch) (caps : RuleCaptures) (rng : RngState) : (Bool × Board × RngState) :=
  match rm with
  | .fixed s =>
    if row.any patternCellIsEllipsis then
      applyRowAtFold game rule b delta row rm caps rng
    else
      applyRowAtFixed game rule b delta row s caps rng
  | .ellipsis1 _ _ =>
    applyRowAtFold game rule b delta row rm caps rng
  | .ellipsis2 _ _ _ =>
    applyRowAtFold game rule b delta row rm caps rng

def tupleStillMatches (b : Board) (rule : Rule) (tuple : Array RowMatch) : Bool :=
  let delta := ruleDirectionDelta rule.direction b.height
  tuple.size == rule.patternRows.size &&
    (tuple.zip rule.patternRows).all fun (rm, row) =>
      match rm with
      | .fixed s => rowCellsMatchFixed b s delta row
      | .ellipsis1 s g => rowCellsMatchEllipsis1 b s g delta row
      | .ellipsis2 s g1 g2 => rowCellsMatchEllipsis2 b s g1 g2 delta row

def applyRuleTuple (game : Game) (b : Board) (rule : Rule) (tuple : Array RowMatch) (recheck : Bool)
    (rng : RngState) : (Bool × Board × RngState) :=
  if recheck && !tupleStillMatches b rule tuple then
    (false, b, rng)
  else
    let delta := ruleDirectionDelta rule.direction b.height
    let caps :=
      captureAggregateBindings b rule tuple delta
        (capturePropertyBindings game b rule tuple delta RuleCaptures.empty)
    let init : Bool × Board × RngState := (false, b, rng)
    (List.range tuple.size).foldl
      (fun (changed, board, rng') ri =>
        let row := rule.patternRows.getD ri #[]
        let rm := tuple.getD ri (.fixed 0)
        let (c, b', r) := applyRowAt game rule board delta row rm caps rng'
        (changed || c, b', r))
      init

/-- Queue rule commands (JS cancel/restart short-circuit). Public for T5 congruence. -/
def queueCommandsForRule (existing : Array Command) (rule : Rule) : Array Command :=
  if existing.contains .cancel then
    existing
  else if existing.contains .restart && !(rule.commands.contains .cancel) then
    existing
  else
    let base :=
      if rule.commands.contains .cancel || rule.commands.contains .restart then #[] else existing
    rule.commands.foldl (fun out c => if c ∈ out then out else out.push c) base

private def mergeCommands (existing newCmds : Array Command) : Array Command :=
  if newCmds.any (· == .cancel) then #[.cancel]
  else if newCmds.any (· == .restart) then #[.restart]
  else
    Id.run do
      let mut out := existing
      for c in newCmds do
        unless c.isSfx || c == .cancel || c == .restart || out.contains c do
          out := out.push c
      pure out

structure TurnState where
  commandQueue : Array Command
  modified : Bool
  againPending : Bool
  rng : RngState
  deriving Repr

def TurnState.initial (rng : RngState) : TurnState :=
  { commandQueue := #[], modified := false, againPending := false, rng }

/-- Command-queue atoms that affect win / again / cancel / restart / checkpoint. -/
def cmdEffectEq (a b : Array Command) : Prop :=
  (.cancel ∈ a ↔ .cancel ∈ b) ∧
  (.restart ∈ a ↔ .restart ∈ b) ∧
  (.win ∈ a ↔ .win ∈ b) ∧
  (.checkpoint ∈ a ↔ .checkpoint ∈ b) ∧
  (.again ∈ a ↔ .again ∈ b)

def TurnState.effectEq (a b : TurnState) : Prop :=
  a.modified = b.modified ∧ a.againPending = b.againPending ∧ a.rng = b.rng ∧
  cmdEffectEq a.commandQueue b.commandQueue

theorem cmdEffectEq.refl (a : Array Command) : cmdEffectEq a a :=
  ⟨Iff.rfl, Iff.rfl, Iff.rfl, Iff.rfl, Iff.rfl⟩

theorem cmdEffectEq.symm {a b : Array Command} (h : cmdEffectEq a b) : cmdEffectEq b a := by
  rcases h with ⟨h1, h2, h3, h4, h5⟩
  exact ⟨h1.symm, h2.symm, h3.symm, h4.symm, h5.symm⟩

theorem TurnState.effectEq.refl (a : TurnState) : TurnState.effectEq a a :=
  ⟨rfl, rfl, rfl, cmdEffectEq.refl _⟩

theorem TurnState.effectEq.symm {a b : TurnState} (h : TurnState.effectEq a b) :
    TurnState.effectEq b a := by
  rcases h with ⟨hm, ha, hr, hc⟩
  exact ⟨hm.symm, ha.symm, hr.symm, cmdEffectEq.symm hc⟩

theorem cmdEffectEq.trans {a b c : Array Command} (hab : cmdEffectEq a b) (hbc : cmdEffectEq b c) :
    cmdEffectEq a c := by
  rcases hab with ⟨h1, h2, h3, h4, h5⟩
  rcases hbc with ⟨h1', h2', h3', h4', h5'⟩
  exact ⟨h1.trans h1', h2.trans h2', h3.trans h3', h4.trans h4', h5.trans h5'⟩

theorem TurnState.effectEq.trans {a b c : TurnState}
    (hab : TurnState.effectEq a b) (hbc : TurnState.effectEq b c) : TurnState.effectEq a c := by
  rcases hab with ⟨hm, ha, hr, hc⟩
  rcases hbc with ⟨hm', ha', hr', hc'⟩
  exact ⟨hm.trans hm', ha.trans ha', hr.trans hr', cmdEffectEq.trans hc hc'⟩

private theorem contains_eq_of_mem_iff {α : Type} [BEq α] [LawfulBEq α]
    {a b : Array α} {x : α} (h : x ∈ a ↔ x ∈ b) : a.contains x = b.contains x := by
  apply Bool.eq_iff_iff.mpr
  exact Iff.trans Array.contains_iff_mem (Iff.trans h Array.contains_iff_mem.symm)

theorem cmdEffectEq.contains_cancel {a b : Array Command} (h : cmdEffectEq a b) :
    a.contains .cancel = b.contains .cancel :=
  contains_eq_of_mem_iff h.1

theorem cmdEffectEq.contains_restart {a b : Array Command} (h : cmdEffectEq a b) :
    a.contains .restart = b.contains .restart :=
  contains_eq_of_mem_iff h.2.1

theorem cmdEffectEq.contains_win {a b : Array Command} (h : cmdEffectEq a b) :
    a.contains .win = b.contains .win :=
  contains_eq_of_mem_iff h.2.2.1

theorem cmdEffectEq.contains_checkpoint {a b : Array Command} (h : cmdEffectEq a b) :
    a.contains .checkpoint = b.contains .checkpoint :=
  contains_eq_of_mem_iff h.2.2.2.1

theorem cmdEffectEq.contains_again {a b : Array Command} (h : cmdEffectEq a b) :
    a.contains .again = b.contains .again :=
  contains_eq_of_mem_iff h.2.2.2.2

theorem TurnState.effectEq.contains_win {a b : TurnState} (h : TurnState.effectEq a b) :
    a.commandQueue.contains .win = b.commandQueue.contains .win :=
  cmdEffectEq.contains_win h.2.2.2

/-- JS again-gate object delta: compare object masks only (not movements / command firings). -/
def objectsChanged (before after : Board) : Bool :=
  before.objects != after.objects

/-- Again is eligible when `again` is queued and objects differ from the turn backup. -/
def againEligible (cmds : Array Command) (backup current : Board) : Bool :=
  match cmds.contains .again with
  | true => objectsChanged backup current
  | false => false

theorem againEligible_congr_cmdEffectEq
    (qL qR : Array Command) (backup current : Board)
    (h : cmdEffectEq qL qR) :
    againEligible qL backup current = againEligible qR backup current := by
  simp only [againEligible, cmdEffectEq.contains_again h]

/-- Apply all match tuples for a non-inert rule (board + RNG only; no command queue). -/
def applyMatchedTuples (game : Game) (b : Board) (rule : Rule)
    (tuples : Array (Array RowMatch)) (rng : RngState) : (Bool × Board × RngState) :=
  (List.range tuples.size).foldl
    (fun (any, board, rng) ti =>
      let tuple := tuples.getD ti #[]
      let recheck := ti > 0
      let (c, b', rng') := applyRuleTuple game board rule tuple recheck rng
      (any || c, b', rng'))
    (false, b, rng)

/--
Apply one rule. Syntactically inert command-only rules never mutate the board or RNG:
they only match and extend the command queue (sfx/message). This early-out matches the
compiled-IR `isCommandOnly` contract and makes the T5 leaf lemma definitional.
-/
def tryApplyRule (game : Game) (b : Board) (rule : Rule) (st : TurnState) : (Bool × Board × TurnState) :=
  let rowMatchLists := rule.patternRows.mapIdx fun i _ => findRowMatches b rule i
  if rowMatchLists.any (·.isEmpty) then
    (false, b, st)
  else if rule.syntacticInertCommandOnly then
    -- Match succeeded; queue inert commands; board/RNG/modified unchanged (`changed = false`).
    (false, b, { st with commandQueue := queueCommandsForRule st.commandQueue rule })
  else
    let (any, board, rng') :=
      applyMatchedTuples game b rule (cartesianRowMatches rowMatchLists) st.rng
    -- §4.0: do not treat command presence as board modification (JS uses object delta).
    (any, board,
      { st with
        commandQueue := queueCommandsForRule st.commandQueue rule
        modified := st.modified || any
        rng := rng' })

/-- Leaf fact for T5: inert command-only apply never changes the board or reports a change. -/
theorem tryApplyRule_syntacticInert_preserves_board
    (game : Game) (b : Board) (rule : Rule) (st : TurnState)
    (h : rule.syntacticInertCommandOnly = true) :
    (tryApplyRule game b rule st).1 = false
      ∧ (tryApplyRule game b rule st).2.1 = b := by
  unfold tryApplyRule
  -- With `h`, the non-inert branch is unreachable; remaining if is match-fail vs inert queue.
  simp [h]
  split <;> simp

def findRuleMatchTuples (b : Board) (rule : Rule) : Array (Array RowMatch) :=
  let rowMatchLists := rule.patternRows.mapIdx fun i _ => findRowMatches b rule i
  if rowMatchLists.any (·.isEmpty) then #[] else cartesianRowMatches rowMatchLists

/-- Collect (ruleIdx, tuple) candidates for a random rule group. -/
def collectRandomRuleMatches (b : Board) (group : Array Rule) : Array (Nat × Array RowMatch) :=
  (List.range group.size).foldl
    (fun acc ruleIdx =>
      match group[ruleIdx]? with
      | none => acc
      | some rule =>
        (findRuleMatchTuples b rule).foldl
          (fun acc tuple => acc.push (ruleIdx, tuple)) acc)
    #[]

def applyRandomRuleGroup (game : Game) (b : Board) (group : Array Rule) (st : TurnState) :
    (Bool × Board × TurnState) :=
  let ruleMatches := collectRandomRuleMatches b group
  if ruleMatches.isEmpty then
    (false, b, st)
  else
    let (pickIdx, rng') := st.rng.randomNat 0 ruleMatches.size
    let (ruleIdx, tuple) := ruleMatches.getD pickIdx (0, #[])
    match group[ruleIdx]? with
    | none => (false, b, st)
    | some rule =>
      let cmdQ := queueCommandsForRule st.commandQueue rule
      let (changed, board, rng'') := applyRuleTuple game b rule tuple false rng'
      let modified := st.modified || changed
      (changed, board, { st with commandQueue := cmdQ, modified := modified, rng := rng'' })

/--
One left-to-right pass over a rule group (List form for T5 induction).
Consecutive-failure early exit counts only **non-inert** failures (inert rules are
board no-ops via `tryApplyRule` early-out). `nonInertCount` is the number of
non-inert rules in the full group — equal to `(rules.filter notInert).length`,
so filtering inert rules does not change board-pass semantics.
Returns `(madeChange, board, turn)`.
-/
def applyRuleGroupPass (game : Game) (b : Board) (st : TurnState) :
    List Rule → (nonInertCount : Nat) → (consec : Nat) → (made : Bool) → (Bool × Board × TurnState)
  | [], _nonInertCount, _consec, made => (made, b, st)
  | rule :: rest, nonInertCount, consec, made =>
    match tryApplyRule game b rule st with
    | (changed, b', st') =>
      if rule.syntacticInertCommandOnly then
        -- Queue inert cmds; do not advance consecutive-failure (board-noop).
        applyRuleGroupPass game b st' rest nonInertCount consec made
      else if changed then
        applyRuleGroupPass game b' st' rest nonInertCount 0 true
      else if nonInertCount ≠ 0 ∧ consec + 1 = nonInertCount then
        (made, b, st')
      else
        applyRuleGroupPass game b st' rest nonInertCount (consec + 1) made

def countNonInertRules (rules : List Rule) : Nat :=
  (rules.filter (fun r => !r.syntacticInertCommandOnly)).length

/-- Non-inert rules kept by `Game.dropInert` (same filter). -/
def filterNonInertRules (rules : List Rule) : List Rule :=
  rules.filter (fun r => !r.syntacticInertCommandOnly)

theorem countNonInertRules_eq_filter_length (rules : List Rule) :
    countNonInertRules rules = (filterNonInertRules rules).length := by
  rfl

theorem countNonInertRules_filter (rules : List Rule) :
    countNonInertRules (filterNonInertRules rules) = countNonInertRules rules := by
  simp [countNonInertRules, filterNonInertRules, List.filter_filter]

theorem filterNonInertRules_cons_inert (rule : Rule) (rest : List Rule)
    (h : rule.syntacticInertCommandOnly = true) :
    filterNonInertRules (rule :: rest) = filterNonInertRules rest := by
  simp [filterNonInertRules, h]

theorem filterNonInertRules_cons_nonInert (rule : Rule) (rest : List Rule)
    (h : rule.syntacticInertCommandOnly = false) :
    filterNonInertRules (rule :: rest) = rule :: filterNonInertRules rest := by
  simp [filterNonInertRules, h]

/-- Up to `fuel` passes; same 200-cap as the previous `while` loop. -/
def applyRuleGroupFuel (game : Game) (b : Board) (group : List Rule) (st : TurnState) :
    Nat → Bool → (Bool × Board × TurnState)
  | 0, groupChanged => (groupChanged, b, st)
  | fuel + 1, groupChanged =>
    let nNon := countNonInertRules group
    let (made, b', st') := applyRuleGroupPass game b st group nNon 0 false
    if made then
      applyRuleGroupFuel game b' group st' fuel true
    else
      (groupChanged, b', st')

private theorem contains_push_of_ne (a : Array Command) (x y : Command) (hne : x ≠ y) :
    (a.push x).contains y = a.contains y := by
  rw [Array.contains_push]
  cases h : y == x with
  | false => simp
  | true => exact absurd (beq_iff_eq.mp h).symm hne

private theorem array_all_inert_mem (cmds : Array Command) (hAll : cmds.all (·.isInert) = true) :
    ∀ c ∈ cmds, c.isInert = true := by
  intro c hc
  rcases (Array.mem_iff_getElem (a := c) (xs := cmds)).mp hc with ⟨i, hi, rfl⟩
  exact (Array.all_eq_true.mp hAll) i hi

private theorem foldl_queue_mem (base : Array Command) (cmds : List Command) (t : Command) :
    t ∈ cmds.foldl (fun out c => if c ∈ out then out else out.push c) base ↔
      t ∈ base ∨ t ∈ cmds := by
  induction cmds generalizing base with
  | nil => simp
  | cons c rest ih =>
    simp only [List.foldl_cons, List.mem_cons]
    by_cases hCont : c ∈ base
    · have hAcc : (if c ∈ base then base else base.push c) = base := by
        simp [hCont]
      rw [hAcc, ih]
      constructor
      · intro h
        rcases h with h | h
        · exact Or.inl h
        · exact Or.inr (Or.inr h)
      · intro h
        rcases h with h | h | h
        · exact Or.inl h
        · subst h
          exact Or.inl hCont
        · exact Or.inr h
    · have hAcc : (if c ∈ base then base else base.push c) = base.push c := by
        simp [hCont]
      rw [hAcc, ih, Array.mem_push]
      constructor
      · intro h
        rcases h with (h | h) | h
        · exact Or.inl h
        · exact Or.inr (Or.inl h)
        · exact Or.inr (Or.inr h)
      · intro h
        rcases h with h | h | h
        · exact Or.inl (Or.inl h)
        · exact Or.inl (Or.inr h)
        · exact Or.inr h

private theorem foldl_queue_contains_array (base : Array Command) (cmds : Array Command) (t : Command) :
    (cmds.foldl (fun out c => if c ∈ out then out else out.push c) base).contains t =
      (base.contains t || cmds.contains t) := by
  apply Bool.eq_iff_iff.mpr
  simp only [Array.contains_iff_mem, Bool.or_eq_true]
  simpa [Array.foldl_toList, Array.mem_toList_iff] using foldl_queue_mem base cmds.toList t

private theorem contains_foldl_inert_preserves (base : Array Command) (cmds : Array Command)
    (hAll : cmds.all (·.isInert) = true) (target : Command) (hTarget : target.isInert = false) :
    (cmds.foldl (fun out c => if c ∈ out then out else out.push c) base).contains target =
      base.contains target := by
  have hMem := array_all_inert_mem cmds hAll
  have hNotIn : target ∉ cmds := by
    intro hIn
    have := hMem target hIn
    simp [hTarget] at this
  rw [foldl_queue_contains_array]
  cases h : cmds.contains target
  · simp
  · have : target ∈ cmds := (Array.contains_iff_mem).mp h
    exact absurd this hNotIn

theorem Rule.syntacticInert_commands_all_inert (rule : Rule)
    (h : rule.syntacticInertCommandOnly = true) :
    rule.commands.all (·.isInert) = true := by
  unfold Rule.syntacticInertCommandOnly at h
  have h1 : PuzzleScript.syntacticInertCommandOnly rule.commands = true :=
    (Bool.and_eq_true_iff.mp h).2
  unfold PuzzleScript.syntacticInertCommandOnly at h1
  exact (Bool.and_eq_true_iff.mp h1).2

private theorem syntacticInert_not_contains_effectful (rule : Rule)
    (h : rule.syntacticInertCommandOnly = true) (c : Command)
    (hc : c = .cancel ∨ c = .restart ∨ c = .win ∨ c = .checkpoint ∨ c = .again) :
    rule.commands.contains c = false := by
  have hAll := Rule.syntacticInert_commands_all_inert rule h
  have hFalse := Command.isInert_false_of_effectful c hc
  cases hContains : rule.commands.contains c with
  | false => rfl
  | true =>
    rcases (Array.contains_iff_exists_mem_beq (xs := rule.commands) (a := c)).mp hContains with
      ⟨a', ha', hbeq⟩
    have hEq : c = a' := beq_iff_eq.mp hbeq
    have hInert : a'.isInert = true := array_all_inert_mem rule.commands hAll a' ha'
    rw [← hEq, hFalse] at hInert
    cases hInert

/-- Queuing a syntactic-inert rule does not change turn-effectful command membership. -/
theorem queueCommandsForRule_syntacticInert_cmdEffectEq
    (existing : Array Command) (rule : Rule)
    (h : rule.syntacticInertCommandOnly = true) :
    cmdEffectEq existing (queueCommandsForRule existing rule) := by
  have hAll := Rule.syntacticInert_commands_all_inert rule h
  have hNoCancel : rule.commands.contains .cancel = false :=
    syntacticInert_not_contains_effectful rule h _ (Or.inl rfl)
  have hNoRestart : rule.commands.contains .restart = false :=
    syntacticInert_not_contains_effectful rule h _ (Or.inr (Or.inl rfl))
  unfold queueCommandsForRule
  split
  · exact cmdEffectEq.refl _
  · split
    · exact cmdEffectEq.refl _
    · have hOr :
          (rule.commands.contains .cancel || rule.commands.contains .restart) = false := by
        rw [hNoCancel, hNoRestart]; rfl
      have hBase :
          (if (rule.commands.contains .cancel || rule.commands.contains .restart) = true
            then (#[] : Array Command) else existing) =
            existing := by
        rw [hOr]; rfl
      rw [hBase]
      have atom (t : Command) (ht : t.isInert = false) :
          t ∈ existing ↔
            t ∈ rule.commands.foldl (fun out c => if c ∈ out then out else out.push c) existing := by
        have h := contains_foldl_inert_preserves existing rule.commands hAll t ht
        simpa [Array.contains_iff_mem] using (Bool.eq_iff_iff.mp h).symm
      exact ⟨atom _ rfl, atom _ rfl, atom _ rfl, atom _ rfl, atom _ rfl⟩

/-- Inert apply: board no-op, `changed = false`, and turn-effectful command atoms unchanged. -/
theorem tryApplyRule_syntacticInert_effectEq
    (game : Game) (b : Board) (rule : Rule) (st : TurnState)
    (h : rule.syntacticInertCommandOnly = true) :
    let r := tryApplyRule game b rule st
    r.1 = false ∧ r.2.1 = b ∧ TurnState.effectEq st r.2.2 := by
  have hb := tryApplyRule_syntacticInert_preserves_board game b rule st h
  refine ⟨hb.1, hb.2, ?_⟩
  unfold tryApplyRule
  simp [h]
  split
  · exact TurnState.effectEq.refl st
  · refine ⟨rfl, rfl, rfl, queueCommandsForRule_syntacticInert_cmdEffectEq st.commandQueue rule h⟩

/--
Queueing is congruent for turn-effectful command atoms.
-/
theorem queueCommandsForRule_cmdEffectEq_congr
    (q1 q2 : Array Command) (rule : Rule) (h : cmdEffectEq q1 q2) :
    cmdEffectEq (queueCommandsForRule q1 rule) (queueCommandsForRule q2 rule) := by
  rcases h with ⟨hc, hr, hw, hcp, ha⟩
  have key (t : Command) (ht : t ∈ q1 ↔ t ∈ q2) :
      t ∈ queueCommandsForRule q1 rule ↔ t ∈ queueCommandsForRule q2 rule := by
    simp only [queueCommandsForRule, Array.contains_iff_mem]
    by_cases hC : Command.cancel ∈ q1
    · have hC2 : Command.cancel ∈ q2 := hc.mp hC
      simp [hC, hC2, ht]
    · have hC2 : ¬Command.cancel ∈ q2 := fun h => hC (hc.mpr h)
      simp [hC, hC2]
      by_cases hG : Command.restart ∈ q1 ∧ ¬Command.cancel ∈ rule.commands
      · have hG2 : Command.restart ∈ q2 ∧ ¬Command.cancel ∈ rule.commands :=
          ⟨hr.mp hG.1, hG.2⟩
        simp [hG, hG2, ht]
      · have hG2 : ¬(Command.restart ∈ q2 ∧ ¬Command.cancel ∈ rule.commands) := by
          intro ⟨hR2, hNC⟩
          exact hG ⟨hr.mpr hR2, hNC⟩
        simp [hG, hG2]
        by_cases hClr : Command.cancel ∈ rule.commands ∨ Command.restart ∈ rule.commands
        · simp [hClr, Array.foldl_toList, foldl_queue_mem]
        · simp [hClr]
          have h1 := foldl_queue_mem q1 rule.commands.toList t
          have h2 := foldl_queue_mem q2 rule.commands.toList t
          simp [Array.foldl_toList] at h1 h2 ⊢
          simp [h1, h2, ht]
  exact ⟨key _ hc, key _ hr, key _ hw, key _ hcp, key _ ha⟩

/-- `tryApplyRule` preserves board/changed/effectEq when turn states are effect-equal. -/
theorem tryApplyRule_congr_effectEq
    (game : Game) (b : Board) (rule : Rule) (stL stR : TurnState)
    (hst : TurnState.effectEq stL stR) :
    (tryApplyRule game b rule stL).1 = (tryApplyRule game b rule stR).1 ∧
      (tryApplyRule game b rule stL).2.1 = (tryApplyRule game b rule stR).2.1 ∧
      TurnState.effectEq (tryApplyRule game b rule stL).2.2
        (tryApplyRule game b rule stR).2.2 := by
  rcases hst with ⟨hm, ha, hrng, hcmd⟩
  generalize hRows :
      (rule.patternRows.mapIdx fun i _ => findRowMatches b rule i) = rowMatchLists
  cases hEmpty : rowMatchLists.any (·.isEmpty) with
  | true =>
    have hL : tryApplyRule game b rule stL = (false, b, stL) := by
      simp [tryApplyRule, hRows, hEmpty]
    have hR : tryApplyRule game b rule stR = (false, b, stR) := by
      simp [tryApplyRule, hRows, hEmpty]
    simp [hL, hR]
    exact ⟨hm, ha, hrng, hcmd⟩
  | false =>
    cases hInert : rule.syntacticInertCommandOnly with
    | true =>
      have hL :
          tryApplyRule game b rule stL =
            (false, b, { stL with commandQueue := queueCommandsForRule stL.commandQueue rule }) := by
        simp [tryApplyRule, hRows, hEmpty, hInert]
      have hR :
          tryApplyRule game b rule stR =
            (false, b, { stR with commandQueue := queueCommandsForRule stR.commandQueue rule }) := by
        simp [tryApplyRule, hRows, hEmpty, hInert]
      simp [hL, hR]
      exact ⟨hm, ha, hrng, queueCommandsForRule_cmdEffectEq_congr _ _ _ hcmd⟩
    | false =>
      -- Both sides reduce to the same `applyMatchedTuples` call once RNGs agree.
      simp [tryApplyRule, hRows, hEmpty, hInert, hrng, hm, ha]
      -- Remain: changed ∧ board ∧ (rng ∧ cmdEffectEq).
      exact ⟨rfl, rfl, rfl, queueCommandsForRule_cmdEffectEq_congr _ _ rule hcmd⟩

/--
One pass over a group agrees with a pass over its non-inert filter on board change flag,
board masks, and turn-effectful state (`TurnState.effectEq`).
`nonInertCount` is shared (same early-exit threshold on both sides).
-/
theorem applyRuleGroupPass_filterNonInert
    (game : Game) (b : Board) (stL stR : TurnState) (group : List Rule)
    (nonInertCount consec : Nat) (made : Bool)
    (hst : TurnState.effectEq stL stR) :
    (applyRuleGroupPass game b stL group nonInertCount consec made).1 =
        (applyRuleGroupPass game b stR (filterNonInertRules group) nonInertCount consec made).1 ∧
      (applyRuleGroupPass game b stL group nonInertCount consec made).2.1 =
        (applyRuleGroupPass game b stR (filterNonInertRules group) nonInertCount consec made).2.1 ∧
      TurnState.effectEq
        (applyRuleGroupPass game b stL group nonInertCount consec made).2.2
        (applyRuleGroupPass game b stR (filterNonInertRules group) nonInertCount consec made).2.2 := by
  induction group generalizing b stL stR consec made with
  | nil =>
    simpa [applyRuleGroupPass, filterNonInertRules] using hst
  | cons rule rest ih =>
    cases hInert : rule.syntacticInertCommandOnly with
    | true =>
      have hLeft := tryApplyRule_syntacticInert_effectEq game b rule stL hInert
      have hEq : TurnState.effectEq (tryApplyRule game b rule stL).2.2 stR :=
        TurnState.effectEq.trans (TurnState.effectEq.symm hLeft.2.2) hst
      simp [applyRuleGroupPass, hInert, filterNonInertRules_cons_inert rule rest hInert]
      rcases hTry : tryApplyRule game b rule stL with ⟨changed, b', st'⟩
      have hc : changed = false := by simpa [hTry] using hLeft.1
      have hb' : b' = b := by simpa [hTry] using hLeft.2.1
      simp [hTry, hc, hb']
      exact ih b st' stR consec made (by simpa [hTry] using hEq)
    | false =>
      have hFilt := filterNonInertRules_cons_nonInert rule rest hInert
      have hCong := tryApplyRule_congr_effectEq game b rule stL stR hst
      simp [applyRuleGroupPass, hInert, hFilt]
      rcases hTryL : tryApplyRule game b rule stL with ⟨changed, bL, stL'⟩
      rcases hTryR : tryApplyRule game b rule stR with ⟨changedR, bR, stR'⟩
      have hc : changedR = changed := by simpa [hTryL, hTryR] using hCong.1.symm
      have hb' : bR = bL := by simpa [hTryL, hTryR] using hCong.2.1.symm
      have he : TurnState.effectEq stL' stR' := by simpa [hTryL, hTryR] using hCong.2.2
      simp [hTryL, hTryR, hc, hb']
      cases hChanged : changed with
      | true =>
        simp
        exact ih bL stL' stR' 0 true he
      | false =>
        simp
        by_cases hExit : nonInertCount ≠ 0 ∧ consec + 1 = nonInertCount
        · simp [hExit]
          exact he
        · simp [hExit]
          exact ih b stL' stR' (consec + 1) made he

/-- Fuelled group apply agrees with the non-inert filter on board/effectEq. -/
theorem applyRuleGroupFuel_filterNonInert
    (game : Game) (b : Board) (stL stR : TurnState) (group : List Rule)
    (fuel : Nat) (groupChanged : Bool)
    (hst : TurnState.effectEq stL stR) :
    (applyRuleGroupFuel game b group stL fuel groupChanged).1 =
        (applyRuleGroupFuel game b (filterNonInertRules group) stR fuel groupChanged).1 ∧
      (applyRuleGroupFuel game b group stL fuel groupChanged).2.1 =
        (applyRuleGroupFuel game b (filterNonInertRules group) stR fuel groupChanged).2.1 ∧
      TurnState.effectEq
        (applyRuleGroupFuel game b group stL fuel groupChanged).2.2
        (applyRuleGroupFuel game b (filterNonInertRules group) stR fuel groupChanged).2.2 := by
  induction fuel generalizing b stL stR groupChanged with
  | zero =>
    simpa [applyRuleGroupFuel] using hst
  | succ fuel ih =>
    have hn : countNonInertRules (filterNonInertRules group) = countNonInertRules group :=
      countNonInertRules_filter group
    have hPass :=
      applyRuleGroupPass_filterNonInert game b stL stR group (countNonInertRules group) 0 false hst
    rcases hL : applyRuleGroupPass game b stL group (countNonInertRules group) 0 false with
      ⟨made, b', stL'⟩
    have hR :
        applyRuleGroupPass game b stR (filterNonInertRules group)
            (countNonInertRules (filterNonInertRules group)) 0 false =
          applyRuleGroupPass game b stR (filterNonInertRules group)
            (countNonInertRules group) 0 false := by
      simp [hn]
    rcases hR' : applyRuleGroupPass game b stR (filterNonInertRules group)
        (countNonInertRules group) 0 false with
      ⟨madeR, bR, stR'⟩
    have hc : madeR = made := by simpa [hL, hR'] using hPass.1.symm
    have hb' : bR = b' := by simpa [hL, hR'] using hPass.2.1.symm
    have he : TurnState.effectEq stL' stR' := by simpa [hL, hR'] using hPass.2.2
    rw [applyRuleGroupFuel, applyRuleGroupFuel, hL, hR, hR', hc, hb']
    cases made with
    | true =>
      simp
      exact ih b' stL' stR' true he
    | false =>
      simp
      exact he

/-- Apply one rule group (non-random path uses `applyRuleGroupFuel`). -/
def applyRuleGroup (game : Game) (b : Board) (group : Array Rule) (st : TurnState) :
    Except String (Bool × Board × TurnState) := do
  if h : group.size > 0 then
    have g0 := group[0]
    if g0.isRandom then
      let (changed, board, turn) := applyRandomRuleGroup game b group st
      return (changed, board, turn)
  let rules := group.toList
  pure (applyRuleGroupFuel game b rules st 200 false)

/-- Drop inert command-only rules from one group (same filter as `Game.dropInert`). -/
def filterNonInertGroup (group : Array Rule) : Array Rule :=
  group.filter (fun r => !r.syntacticInertCommandOnly)

theorem filterNonInertGroup_toList (group : Array Rule) :
    (filterNonInertGroup group).toList = filterNonInertRules group.toList := by
  simp [filterNonInertGroup, filterNonInertRules, Array.toList_filter]

/-- Every rule in the group is non-random (includes the empty group). -/
def groupNotRandom (group : Array Rule) : Bool :=
  group.all (fun r => !r.isRandom)

theorem groupNotRandom_filter (group : Array Rule) (h : groupNotRandom group = true) :
    groupNotRandom (filterNonInertGroup group) = true := by
  simp only [groupNotRandom, filterNonInertGroup]
  refine (Array.all_eq_true).2 ?_
  intro i hi
  have hIn :
      (group.filter (fun r => !r.syntacticInertCommandOnly))[i] ∈
        group.filter (fun r => !r.syntacticInertCommandOnly) :=
    Array.getElem_mem hi
  have hMem := Array.mem_filter.mp hIn
  rcases Array.mem_iff_getElem.mp hMem.1 with ⟨j, hj, hEq⟩
  have := (Array.all_eq_true.mp h) j hj
  simpa [hEq] using this

/-- Non-random groups: `applyRuleGroup` is the fuelled list path. -/
theorem applyRuleGroup_eq_fuel_of_not_random
    (game : Game) (b : Board) (group : Array Rule) (st : TurnState)
    (h : groupNotRandom group = true) :
    applyRuleGroup game b group st =
      pure (applyRuleGroupFuel game b group.toList st 200 false) := by
  unfold applyRuleGroup
  split
  · next hsz =>
    have hr : group[0].isRandom = false := by
      simpa [Bool.not_eq_true'] using (Array.all_eq_true.mp h) 0 hsz
    simp [hr]
  · rfl

/-- Result view for OK applyRuleGroup triples. -/
def applyRuleGroupResultEq
    (l r : Except String (Bool × Board × TurnState)) : Prop :=
  match l, r with
  | .ok (cL, bL, tL), .ok (cR, bR, tR) =>
      cL = cR ∧ bL = bR ∧ TurnState.effectEq tL tR
  | .error eL, .error eR => eL = eR
  | _, _ => False

/-- Under non-random, applying a group equals applying its inert-filtered form. -/
theorem applyRuleGroup_filterNonInert
    (game : Game) (b : Board) (group : Array Rule) (stL stR : TurnState)
    (hst : TurnState.effectEq stL stR)
    (h : groupNotRandom group = true) :
    applyRuleGroupResultEq
      (applyRuleGroup game b group stL)
      (applyRuleGroup game b (filterNonInertGroup group) stR) := by
  have hFuelL := applyRuleGroup_eq_fuel_of_not_random game b group stL h
  have hFuelR :=
    applyRuleGroup_eq_fuel_of_not_random game b (filterNonInertGroup group) stR
      (groupNotRandom_filter group h)
  have hFuel :=
    applyRuleGroupFuel_filterNonInert game b stL stR group.toList 200 false hst
  rw [hFuelL, hFuelR, filterNonInertGroup_toList]
  simp only [applyRuleGroupResultEq]
  exact ⟨hFuel.1, hFuel.2.1, hFuel.2.2⟩

structure ApplyRulesState where
  board : Board
  turn : TurnState
  rulesChanged : Bool
  ruleGroupIndex : Nat
  loopPropagated : Bool
  loopCount : Nat
  deriving Repr

mutual
/--
Post-apply control flow for the rules/loop walker (loop jumps / advance index).
Split out of `go` so congruence proofs can target it directly.
-/
def applyRulesWithLoops.continueAfter
    (game : Game) (groups : Array (Array Rule)) (loopPoint : Array (Option Nat))
    (bannedGroup : Array Bool) (rulesCount : Nat) (fuel : Nat)
    (board1 : Board) (turn1 : TurnState) (rulesChanged1 loopPropagated1 : Bool)
    (idx loopCount0 : Nat) : Except String (Bool × Board × TurnState) :=
  if loopPropagated1 then
    match loopPoint[idx]? with
    | some (some target) =>
      if loopCount0 + 1 > 200 then
        pure (rulesChanged1, board1, turn1)
      else
        applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel
          { board := board1, turn := turn1, rulesChanged := rulesChanged1
            ruleGroupIndex := target, loopPropagated := false, loopCount := loopCount0 + 1 }
    | _ =>
      if idx + 1 == rulesCount && loopPropagated1 then
        match loopPoint[rulesCount]? with
        | some (some target) =>
          if loopCount0 + 1 > 200 then
            pure (rulesChanged1, board1, turn1)
          else
            applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel
              { board := board1, turn := turn1, rulesChanged := rulesChanged1
                ruleGroupIndex := target, loopPropagated := false, loopCount := loopCount0 + 1 }
        | _ =>
          applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel
            { board := board1, turn := turn1, rulesChanged := rulesChanged1
              ruleGroupIndex := idx + 1, loopPropagated := loopPropagated1, loopCount := loopCount0 }
      else
        applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel
          { board := board1, turn := turn1, rulesChanged := rulesChanged1
            ruleGroupIndex := idx + 1, loopPropagated := loopPropagated1, loopCount := loopCount0 }
  else
    applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel
      { board := board1, turn := turn1, rulesChanged := rulesChanged1
        ruleGroupIndex := idx + 1, loopPropagated := false, loopCount := loopCount0 }

/--
Rules/loop walker (fuelled; replaces the previous `while` loop).
Fuel bound: `(rulesCount + 1) * 202` covers ≥200 loop jumps plus linear scans.
-/
def applyRulesWithLoops.go
    (game : Game) (groups : Array (Array Rule)) (loopPoint : Array (Option Nat))
    (bannedGroup : Array Bool) (rulesCount : Nat) :
    Nat → ApplyRulesState → Except String (Bool × Board × TurnState)
  | 0, s => pure (s.rulesChanged, s.board, s.turn)
  | fuel + 1, s =>
    if s.ruleGroupIndex < rulesCount then
      let board0 := s.board
      let turn0 := s.turn
      let rulesChanged0 := s.rulesChanged
      let loopPropagated0 := s.loopPropagated
      let idx := s.ruleGroupIndex
      let loopCount0 := s.loopCount
      let applyResult : Except String (Board × TurnState × Bool × Bool) :=
        if bannedGroup.getD idx false then
          .ok (board0, turn0, rulesChanged0, loopPropagated0)
        else
          match applyRuleGroup game board0 groups[idx]! turn0 with
          | .error e => .error e
          | .ok (groupChanged, b', st') =>
            .ok (b', st', rulesChanged0 || groupChanged, loopPropagated0 || groupChanged)
      match applyResult with
      | .error e => .error e
      | .ok (board1, turn1, rulesChanged1, loopPropagated1) =>
        applyRulesWithLoops.continueAfter game groups loopPoint bannedGroup rulesCount fuel
          board1 turn1 rulesChanged1 loopPropagated1 idx loopCount0
    else
      pure (s.rulesChanged, s.board, s.turn)
end

def applyRulesWithLoops (game : Game) (b : Board) (groups : Array (Array Rule))
    (loopPoint : Array (Option Nat)) (st : TurnState) (bannedGroup : Array Bool) :
    Except String (Bool × Board × TurnState) :=
  let rulesCount := groups.size
  let fuel := (rulesCount + 1) * 202
  applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel
    { board := b, turn := st, rulesChanged := false, ruleGroupIndex := 0
      loopPropagated := false, loopCount := 0 }

/-- Per-group inert filter; preserves array size / indices (for loopPoint). -/
def filterNonInertGroups (groups : Array (Array Rule)) : Array (Array Rule) :=
  groups.map filterNonInertGroup

theorem filterNonInertGroups_size (groups : Array (Array Rule)) :
    (filterNonInertGroups groups).size = groups.size := by
  simp [filterNonInertGroups]

theorem filterNonInertGroups_isEmpty (groups : Array (Array Rule)) :
    (filterNonInertGroups groups).isEmpty = groups.isEmpty := by
  simp [filterNonInertGroups, Array.isEmpty, Array.size_map]

def ApplyRulesState.sync (sL sR : ApplyRulesState) : Prop :=
  sL.board = sR.board ∧
  TurnState.effectEq sL.turn sR.turn ∧
  sL.rulesChanged = sR.rulesChanged ∧
  sL.ruleGroupIndex = sR.ruleGroupIndex ∧
  sL.loopPropagated = sR.loopPropagated ∧
  sL.loopCount = sR.loopCount

theorem ApplyRulesState.sync.refl (s : ApplyRulesState) : ApplyRulesState.sync s s :=
  ⟨rfl, TurnState.effectEq.refl _, rfl, rfl, rfl, rfl⟩

private theorem applyRuleGroupResultEq_pure_effect
    (c : Bool) (b : Board) (tL tR : TurnState) (ht : TurnState.effectEq tL tR) :
    applyRuleGroupResultEq (pure (c, b, tL)) (pure (c, b, tR)) := by
  simp [applyRuleGroupResultEq, pure]
  exact ⟨rfl, rfl, ht⟩

/-- `go`-IH at states that share everything except turns (`effectEq`). -/
private theorem go_ih_effect
    {game : Game} {groups : Array (Array Rule)} {loopPoint : Array (Option Nat)}
    {bannedGroup : Array Bool} {rulesCount fuel : Nat}
    (ih : ∀ (sL sR : ApplyRulesState), ApplyRulesState.sync sL sR →
      applyRuleGroupResultEq
        (applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel sL)
        (applyRulesWithLoops.go game (filterNonInertGroups groups) loopPoint bannedGroup
          rulesCount fuel sR))
    (board : Board) (tL tR : TurnState)
    (rulesChanged : Bool) (idx : Nat) (loopPropagated : Bool) (loopCount : Nat)
    (ht : TurnState.effectEq tL tR) :
    applyRuleGroupResultEq
      (applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel
        { board := board, turn := tL, rulesChanged := rulesChanged
          ruleGroupIndex := idx, loopPropagated := loopPropagated, loopCount := loopCount })
      (applyRulesWithLoops.go game (filterNonInertGroups groups) loopPoint bannedGroup
        rulesCount fuel
        { board := board, turn := tR, rulesChanged := rulesChanged
          ruleGroupIndex := idx, loopPropagated := loopPropagated, loopCount := loopCount }) :=
  ih
    { board := board, turn := tL, rulesChanged := rulesChanged
      ruleGroupIndex := idx, loopPropagated := loopPropagated, loopCount := loopCount }
    { board := board, turn := tR, rulesChanged := rulesChanged
      ruleGroupIndex := idx, loopPropagated := loopPropagated, loopCount := loopCount }
    ⟨rfl, ht, rfl, rfl, rfl, rfl⟩

/-- Loop-count overflow vs recurse, shared control flow. -/
private theorem continueAfter_loopJump
    (game : Game) (groups : Array (Array Rule)) (loopPoint : Array (Option Nat))
    (bannedGroup : Array Bool) (rulesCount fuel : Nat)
    (board1 : Board) (turnL turnR : TurnState)
    (rulesChanged1 : Bool) (target loopCount0 : Nat)
    (ht : TurnState.effectEq turnL turnR)
    (ih : ∀ (sL sR : ApplyRulesState), ApplyRulesState.sync sL sR →
      applyRuleGroupResultEq
        (applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel sL)
        (applyRulesWithLoops.go game (filterNonInertGroups groups) loopPoint bannedGroup
          rulesCount fuel sR)) :
    applyRuleGroupResultEq
      (if loopCount0 + 1 > 200 then pure (rulesChanged1, board1, turnL)
       else
         applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel
           { board := board1, turn := turnL, rulesChanged := rulesChanged1
             ruleGroupIndex := target, loopPropagated := false, loopCount := loopCount0 + 1 })
      (if loopCount0 + 1 > 200 then pure (rulesChanged1, board1, turnR)
       else
         applyRulesWithLoops.go game (filterNonInertGroups groups) loopPoint bannedGroup
           rulesCount fuel
           { board := board1, turn := turnR, rulesChanged := rulesChanged1
             ruleGroupIndex := target, loopPropagated := false, loopCount := loopCount0 + 1 }) := by
  by_cases h : loopCount0 + 1 > 200
  · simp only [h]
    exact applyRuleGroupResultEq_pure_effect rulesChanged1 board1 turnL turnR ht
  · simp only [h]
    exact go_ih_effect ih board1 turnL turnR rulesChanged1 target false (loopCount0 + 1) ht

/--
`continueAfter` congruence: shared board/flags/index; turns related by `effectEq`.
Uses the fuel-`go` induction hypothesis for recursive jumps.
-/
theorem applyRulesWithLoops.continueAfter_filterNonInert
    (game : Game) (groups : Array (Array Rule)) (loopPoint : Array (Option Nat))
    (bannedGroup : Array Bool) (rulesCount : Nat) (fuel : Nat)
    (board1 : Board) (turnL turnR : TurnState)
    (rulesChanged1 loopPropagated1 : Bool) (idx loopCount0 : Nat)
    (ht : TurnState.effectEq turnL turnR)
    (ih : ∀ (sL sR : ApplyRulesState), ApplyRulesState.sync sL sR →
      applyRuleGroupResultEq
        (applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel sL)
        (applyRulesWithLoops.go game (filterNonInertGroups groups) loopPoint bannedGroup
          rulesCount fuel sR)) :
    applyRuleGroupResultEq
      (applyRulesWithLoops.continueAfter game groups loopPoint bannedGroup rulesCount fuel
        board1 turnL rulesChanged1 loopPropagated1 idx loopCount0)
      (applyRulesWithLoops.continueAfter game (filterNonInertGroups groups) loopPoint
        bannedGroup rulesCount fuel board1 turnR rulesChanged1 loopPropagated1 idx
        loopCount0) := by
  unfold applyRulesWithLoops.continueAfter
  cases hProp : loopPropagated1 with
  | false =>
    exact go_ih_effect ih board1 turnL turnR rulesChanged1 (idx + 1) false loopCount0 ht
  | true =>
    cases hLP : loopPoint[idx]? with
    | none =>
      simp only [Bool.and_true]
      cases hEnd : (idx + 1 == rulesCount) with
      | false =>
        exact go_ih_effect ih board1 turnL turnR rulesChanged1 (idx + 1) true loopCount0 ht
      | true =>
        cases hLP2 : loopPoint[rulesCount]? with
        | none =>
          exact go_ih_effect ih board1 turnL turnR rulesChanged1 (idx + 1) true loopCount0 ht
        | some tgt =>
          cases tgt with
          | none =>
            exact go_ih_effect ih board1 turnL turnR rulesChanged1 (idx + 1) true loopCount0 ht
          | some target =>
            exact continueAfter_loopJump game groups loopPoint bannedGroup rulesCount fuel
              board1 turnL turnR rulesChanged1 target loopCount0 ht ih
    | some tgt =>
      cases tgt with
      | none =>
        simp only [Bool.and_true]
        cases hEnd : (idx + 1 == rulesCount) with
        | false =>
          exact go_ih_effect ih board1 turnL turnR rulesChanged1 (idx + 1) true loopCount0 ht
        | true =>
          cases hLP2 : loopPoint[rulesCount]? with
          | none =>
            exact go_ih_effect ih board1 turnL turnR rulesChanged1 (idx + 1) true loopCount0 ht
          | some tgt2 =>
            cases tgt2 with
            | none =>
              exact go_ih_effect ih board1 turnL turnR rulesChanged1 (idx + 1) true
                loopCount0 ht
            | some target =>
              exact continueAfter_loopJump game groups loopPoint bannedGroup rulesCount fuel
                board1 turnL turnR rulesChanged1 target loopCount0 ht ih
      | some target =>
        exact continueAfter_loopJump game groups loopPoint bannedGroup rulesCount fuel
          board1 turnL turnR rulesChanged1 target loopCount0 ht ih

/--
Fuelled walker congruence: elementwise inert-filtered groups stay in lockstep under
`groupNotRandom` for every group.
-/
theorem applyRulesWithLoops.go_filterNonInert
    (game : Game) (groups : Array (Array Rule)) (loopPoint : Array (Option Nat))
    (bannedGroup : Array Bool) (rulesCount : Nat) (fuel : Nat)
    (sL sR : ApplyRulesState)
    (hsync : ApplyRulesState.sync sL sR)
    (hCount : rulesCount = groups.size)
    (hNotRandom : groups.all groupNotRandom = true) :
    applyRuleGroupResultEq
      (applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel sL)
      (applyRulesWithLoops.go game (filterNonInertGroups groups) loopPoint bannedGroup
        rulesCount fuel sR) := by
  induction fuel generalizing sL sR with
  | zero =>
    rcases sL with ⟨boardL, turnL, rcL, idxL, lpL, lcL⟩
    rcases sR with ⟨boardR, turnR, rcR, idxR, lpR, lcR⟩
    rcases hsync with ⟨rfl, ht, rfl, rfl, rfl, rfl⟩
    simp only [applyRulesWithLoops.go]
    exact applyRuleGroupResultEq_pure_effect rcL boardL turnL turnR ht
  | succ fuel ih =>
    rcases sL with ⟨boardL, turnL, rcL, idxL, lpL, lcL⟩
    rcases sR with ⟨boardR, turnR, rcR, idxR, lpR, lcR⟩
    rcases hsync with ⟨rfl, ht, rfl, rfl, rfl, rfl⟩
    simp only [applyRulesWithLoops.go]
    split
    · next hIdx =>
      cases hBan : bannedGroup.getD idxL false with
      | true =>
        exact applyRulesWithLoops.continueAfter_filterNonInert game groups loopPoint
          bannedGroup rulesCount fuel boardL turnL turnR rcL lpL idxL lcL ht ih
      | false =>
        have hIdxBound : idxL < groups.size := by simpa [hCount] using hIdx
        have ht' : TurnState.effectEq turnL turnR := ht
        have hNR : groupNotRandom groups[idxL]! = true := by
          have := (Array.all_eq_true.mp hNotRandom) idxL hIdxBound
          simpa [getElem!_pos groups idxL hIdxBound] using this
        have hG :
            (filterNonInertGroups groups)[idxL]! =
              filterNonInertGroup groups[idxL]! := by
          have hsz : idxL < (groups.map filterNonInertGroup).size := by
            simpa [filterNonInertGroups, Array.size_map] using hIdxBound
          simp only [filterNonInertGroups,
            getElem!_pos (groups.map filterNonInertGroup) idxL hsz,
            getElem!_pos groups idxL hIdxBound, Array.getElem_map]
        have hAppl :=
          applyRuleGroup_filterNonInert game boardL groups[idxL]! turnL turnR ht' hNR
        -- Align right-hand group with `filterNonInertGroup groups[idx]!`.
        simp only [hG]
        cases hL : applyRuleGroup game boardL groups[idxL]! turnL with
        | error eL =>
          simp only [hL, applyRuleGroupResultEq] at hAppl
          cases hR' : applyRuleGroup game boardL
              (filterNonInertGroup groups[idxL]!) turnR with
          | error eR =>
            simp only [hR', applyRuleGroupResultEq] at hAppl
            simp only [hL, hR']
            simpa [applyRuleGroupResultEq] using hAppl
          | ok _ =>
            simp only [hR', applyRuleGroupResultEq] at hAppl
        | ok tripL =>
          rcases tripL with ⟨cL, bL, tL⟩
          simp only [hL, applyRuleGroupResultEq] at hAppl
          cases hR' : applyRuleGroup game boardL
              (filterNonInertGroup groups[idxL]!) turnR with
          | error _ =>
            simp only [hR', applyRuleGroupResultEq] at hAppl
          | ok tripR =>
            rcases tripR with ⟨cR, bR, tR⟩
            simp only [hR', applyRuleGroupResultEq] at hAppl
            rcases hAppl with ⟨rfl, rfl, hT⟩
            simp only [hL, hR']
            exact applyRulesWithLoops.continueAfter_filterNonInert game groups loopPoint
              bannedGroup rulesCount fuel bL tL tR (rcL || cL) (lpL || cL) idxL lcL hT ih
    · exact applyRuleGroupResultEq_pure_effect rcL boardL turnL turnR ht

theorem applyRulesWithLoops_filterNonInert
    (game : Game) (b : Board) (groups : Array (Array Rule))
    (loopPoint : Array (Option Nat)) (stL stR : TurnState) (bannedGroup : Array Bool)
    (hst : TurnState.effectEq stL stR)
    (hNotRandom : groups.all groupNotRandom = true) :
    applyRuleGroupResultEq
      (applyRulesWithLoops game b groups loopPoint stL bannedGroup)
      (applyRulesWithLoops game b (filterNonInertGroups groups) loopPoint stR bannedGroup) := by
  simp only [applyRulesWithLoops, filterNonInertGroups_size]
  exact applyRulesWithLoops.go_filterNonInert game groups loopPoint bannedGroup
    groups.size ((groups.size + 1) * 202)
    { board := b, turn := stL, rulesChanged := false, ruleGroupIndex := 0
      loopPropagated := false, loopCount := 0 }
    { board := b, turn := stR, rulesChanged := false, ruleGroupIndex := 0
      loopPropagated := false, loopCount := 0 }
    ⟨rfl, hst, rfl, rfl, rfl, rfl⟩ rfl hNotRandom

private def maskAnyMatchesAtTile (b : Board) (entityMask : MaskWords) (tile : Nat) : Bool :=
  let cell := b.cellObjWords tile
  maskAnyBits (maskAnd cell entityMask)

def layersOfMask (game : Game) (cell : MaskWords) : Array Nat :=
  ((List.range game.objectCount).filter (maskGetBit cell)).map
    (fun oid => (game.objectLayers.getD oid ⟨0⟩).val) |>.toArray

def moveEntitiesAtIndex (game : Game) (b : Board) (tile : Nat) (entityMask : MaskWords) (dirMask : UInt32) : Board :=
  let cell := b.cellObjWords tile
  let cellFiltered :=
    (List.range b.strideObj).foldl
      (fun out i => out.set! i (maskWord cell i &&& maskWord entityMask i))
      cell
  let layers := layersOfMask game cellFiltered
  let mov := b.cellMovWords tile
  let newMov := layers.foldl (fun m layer => setLayerMovementBits m layer
    (getLayerMovementBits m layer ||| dirMask)) mov
  b.setCellMovWords tile newMov

private def playerMatchesAtTile (game : Game) (b : Board) (tile : Nat) : Bool :=
  if game.playerMaskAggregate then
    maskAggregateMatchesAtTile b game.playerMask tile
  else
    maskAnyMatchesAtTile b game.playerMask tile

/-- Tiles where the player currently matches (aggregate AND or any-bit OR). -/
def getPlayerPositions (game : Game) (b : Board) : Array Nat :=
  Id.run do
    let mut out : Array Nat := #[]
    for tile in [:b.nTiles] do
      if playerMatchesAtTile game b tile then
        out := out.push tile
    pure out

/-- True iff no bits of `mask` appear in the cell (JS `bitsClearInArray`). -/
private def maskBitsClearInCell (mask cell : MaskWords) : Bool :=
  maskNoBitsInCommon mask cell

/-- After resolve: did any start-of-turn player tile lose all player-mask objects? -/
def playerMovementDetected (game : Game) (b : Board) (playerPositions : Array Nat) : Bool :=
  playerPositions.any fun pos => maskBitsClearInCell game.playerMask (b.cellObjWords pos)

def startMovement (game : Game) (b : Board) (dirMask : UInt32) : Board × Array Nat :=
  let positions := getPlayerPositions game b
  let board :=
    positions.foldl
      (fun board tile => moveEntitiesAtIndex game board tile game.playerMask dirMask)
      b
  (board, positions)

def layerMaskFor (game : Game) (layer : Nat) : MaskWords :=
  game.layerMasks.getD layer #[]

/-- Objects present in `cell` whose collision layer equals `layer`. -/
def objectsOnLayerMask (game : Game) (cell : MaskWords) (layer : Nat) : MaskWords :=
  (List.range game.objectCount).foldl
    (fun m oid =>
      if (game.objectLayers.getD oid ⟨0⟩).val == layer && maskGetBit cell oid then
        maskSetBit m oid true
      else m)
    #[]

def repositionEntitiesOnLayer (game : Game) (b : Board) (tile : Nat) (layer : Nat) (dirMask : UInt32) : (Bool × Board) :=
  match dirDelta dirMask with
  | none =>
    if dirMask == 16 then (false, b) else (false, b)
  | some (dx, dy) =>
    let x := b.tileCol tile
    let y := b.tileRow tile
    let maxx := b.width - 1
    let maxy := b.height - 1
    if (x == 0 && dx < 0) || (x == maxx && dx > 0) || (y == 0 && dy < 0) || (y == maxy && dy > 0) then
      (false, b)
    else
      let targetTile :=
        (Int.ofNat tile + dy + dx * Int.ofNat b.height).toNat
      -- Explicit bound (edge guards already imply this; keeps WF proofs free of Int geometry).
      if targetTile >= b.nTiles || targetTile == tile then
        (false, b)
      else
        let layerMask := layerMaskFor game layer
        let targetObj := b.cellObjWords targetTile
        if maskAnyBits (maskAnd layerMask targetObj) && dirMask != 16 then
          (false, b)
        else
          let sourceObj := b.cellObjWords tile
          let moving := objectsOnLayerMask game sourceObj layer
          let newSource := maskApplyReplacement sourceObj layerMask #[]
          let newTarget := maskOr targetObj moving
          let b1 := b.setCellObjWords tile newSource
          let b2 := b1.setCellObjWords targetTile newTarget
          (true, b2)

def repositionEntitiesAtCell (game : Game) (b : Board) (tile : Nat) : (Bool × Board) :=
  let mov := b.cellMovWords tile
  if !maskAnyBits mov then
    (false, b)
  else
    let (moved, board, movement) :=
      (List.range game.layerCount).foldl
        (fun (moved, board, movement) layer =>
          let bits := getLayerMovementBits movement layer
          if bits != 0 then
            let (thisMoved, b') := repositionEntitiesOnLayer game board tile layer bits
            if thisMoved then
              (true, b', clearLayerMovementBits movement layer)
            else
              (moved, board, movement)
          else
            (moved, board, movement))
        (false, b, mov)
    (moved, board.setCellMovWords tile movement)

private def setBannedGroup (bg : Array Bool) (groupIndex : Nat) : Array Bool :=
  if bg.size ≤ groupIndex then
    (bg ++ Array.replicate (groupIndex + 1 - bg.size) false).set! groupIndex true
  else if bg[groupIndex]! then bg else bg.set! groupIndex true

def clearAllMovementBits (game : Game) (mov : MaskWords) : MaskWords :=
  (List.range game.layerCount).foldl (fun m layer => clearLayerMovementBits m layer) mov

/-- Fuelled movement-resolution sweep (replaces `while again`). -/
def resolveMovements.sweep (game : Game) : Nat → Board → Board
  | 0, board => board
  | fuel + 1, board =>
    let (moved, board') :=
      (List.range board.nTiles).foldl
        (fun (moved, board) tile =>
          let mov := board.cellMovWords tile
          if maskAnyBits mov then
            let (thisMoved, b') := repositionEntitiesAtCell game board tile
            if thisMoved then (true, b') else (moved, board)
          else
            (moved, board))
        (false, board)
    if moved then
      resolveMovements.sweep game fuel board'
    else
      board'

/-- Clear leftover movement (and rigid) masks at one tile. -/
def clearLingeringAtTile (game : Game) (board : Board) (tile : Nat) : Board :=
  let mov := board.cellMovWords tile
  if maskAnyBits mov then
    let board := board.setCellMovWords tile (clearAllMovementBits game mov)
    if game.gameRigid then
      let board := board.setCellRigidGroupIndexMask tile (movMaskZeros board.strideMov)
      board.setCellRigidMovementAppliedMask tile (movMaskZeros board.strideMov)
    else
      board
  else
    board

/-- Clear leftover movement (and rigid) masks per tile — board-only half of finalize. -/
def clearLingeringMovements (game : Game) (b : Board) : Board :=
  (List.range b.nTiles).foldl (clearLingeringAtTile game) b

/-- Update rigid-ban flags from lingering movement (does not mutate the board). -/
def resolveMovements.collectRigidBans (game : Game) (b : Board) (bannedGroup : Array Bool) :
    Bool × Array Bool :=
  (List.range b.nTiles).foldl
    (fun (doUndo, banned) tile =>
      let mov := b.cellMovWords tile
      if maskAnyBits mov && game.gameRigid then
        let rigidApplied := b.cellRigidMovementAppliedMask tile
        if maskAnyBits rigidApplied then
          let movementMask := maskAnd mov rigidApplied
          if maskAnyBits movementMask then
            (List.range game.layerCount).foldl
              (fun (doUndo, banned, done) layer =>
                if done then (doUndo, banned, true)
                else
                  let layerSection := getLayerMovementBits movementMask layer
                  if layerSection != 0 then
                    let rigidGroupIndex :=
                      getLayerMovementBits (b.cellRigidGroupIndexMask tile) layer
                    if rigidGroupIndex != 0 then
                      let rgi := rigidGroupIndex.toNat - 1
                      let groupIndex := game.rigidGroupIndexToGroupIndex.getD rgi 0
                      if !banned.getD groupIndex false then
                        (true, setBannedGroup banned groupIndex, true)
                      else
                        (doUndo, banned, true)
                    else
                      (doUndo, banned, true)
                  else
                    (doUndo, banned, false))
              (doUndo, banned, false)
            |> fun (d, bg, _) => (d, bg)
          else (doUndo, banned)
        else (doUndo, banned)
      else (doUndo, banned))
    (false, bannedGroup)

/-- Clear leftover movement/rigid masks after the sweep; also updates rigid-ban flags. -/
def resolveMovements.finalize (game : Game) (b : Board) (bannedGroup : Array Bool) :
    (Board × Bool × Array Bool) :=
  let (doUndo, banned) := resolveMovements.collectRigidBans game b bannedGroup
  (clearLingeringMovements game b, doUndo, banned)

/-- Resolve pending cell movements. Sweep fuel is `nTiles * layerCount + 1`. -/
def resolveMovements (game : Game) (b : Board) (bannedGroup : Array Bool) : (Board × Bool × Array Bool) :=
  let fuel := b.nTiles * game.layerCount + 1
  let board := resolveMovements.sweep game fuel b
  resolveMovements.finalize game board bannedGroup

/-- One rigid-retry iteration state (early rules → resolve → optional late rules). -/
structure RigidRetryState where
  board : Board
  turn : TurnState
  bannedGroup : Array Bool
  deriving Repr

/--
Fuelled rigid-retry loop (replaces `while rigidIter < 50` in `executeTurn`).
Rule arrays are parameters so inert-filtered groups can share the same `game`
for `resolveMovements`.
-/
def rigidRetry.go (game : Game) (rules lateRules : Array (Array Rule))
    (loopPoint lateLoopPoint : Array (Option Nat)) (startBoard : Board) :
    Nat → RigidRetryState → Except String RigidRetryState
  | 0, s => pure s
  | fuel + 1, s =>
    match applyRulesWithLoops game s.board rules loopPoint s.turn s.bannedGroup with
    | .error e => .error e
    | .ok (_, board', turn') =>
      let (board'', doUndo, banned') := resolveMovements game board' s.bannedGroup
      if doUndo then
        let board :=
          { startBoard with
            objects := startBoard.objects
            movements := startBoard.movements
            rigidGroupIndexMask := startBoard.rigidGroupIndexMask
            rigidMovementAppliedMask := startBoard.rigidMovementAppliedMask }
        let turn := { turn' with commandQueue := #[] }
        rigidRetry.go game rules lateRules loopPoint lateLoopPoint startBoard fuel
          { board := board, turn := turn, bannedGroup := banned' }
      else if !lateRules.isEmpty then
        match applyRulesWithLoops game board'' lateRules lateLoopPoint turn' #[] with
        | .error e => .error e
        | .ok (_, board''', turn'') =>
          pure { board := board''', turn := turn'', bannedGroup := banned' }
      else
        pure { board := board'', turn := turn', bannedGroup := banned' }

def rigidRetry (game : Game) (rules lateRules : Array (Array Rule))
    (loopPoint lateLoopPoint : Array (Option Nat)) (startBoard : Board)
    (turn : TurnState) : Except String (Board × TurnState) :=
  match rigidRetry.go game rules lateRules loopPoint lateLoopPoint startBoard 50
      { board := startBoard, turn := turn, bannedGroup := #[] } with
  | .error e => .error e
  | .ok s => pure (s.board, s.turn)

theorem TurnState.effectEq_clear_commandQueue
    {tL tR : TurnState} (h : TurnState.effectEq tL tR) :
    TurnState.effectEq { tL with commandQueue := #[] } { tR with commandQueue := #[] } := by
  rcases h with ⟨hm, ha, hr, _⟩
  exact ⟨hm, ha, hr, cmdEffectEq.refl _⟩

/-- Result view for OK rigid-retry states. -/
def rigidRetryResultEq
    (l r : Except String RigidRetryState) : Prop :=
  match l, r with
  | .ok sL, .ok sR =>
      sL.board = sR.board ∧ TurnState.effectEq sL.turn sR.turn ∧
        sL.bannedGroup = sR.bannedGroup
  | .error eL, .error eR => eL = eR
  | _, _ => False

theorem rigidRetry.go_filterNonInert
    (game : Game) (rules lateRules : Array (Array Rule))
    (loopPoint lateLoopPoint : Array (Option Nat)) (startBoard : Board)
    (fuel : Nat) (sL sR : RigidRetryState)
    (hsync : sL.board = sR.board ∧ TurnState.effectEq sL.turn sR.turn ∧
      sL.bannedGroup = sR.bannedGroup)
    (hRules : rules.all groupNotRandom = true)
    (hLate : lateRules.all groupNotRandom = true) :
    rigidRetryResultEq
      (rigidRetry.go game rules lateRules loopPoint lateLoopPoint startBoard fuel sL)
      (rigidRetry.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
        loopPoint lateLoopPoint startBoard fuel sR) := by
  induction fuel generalizing sL sR with
  | zero =>
    rcases hsync with ⟨hb, ht, hban⟩
    simp only [rigidRetry.go, rigidRetryResultEq, pure]
    exact ⟨hb, ht, hban⟩
  | succ fuel ih =>
    rcases sL with ⟨boardL, turnL, banL⟩
    rcases sR with ⟨boardR, turnR, banR⟩
    rcases hsync with ⟨rfl, ht, rfl⟩
    simp only [rigidRetry.go]
    have hEarly :=
      applyRulesWithLoops_filterNonInert game boardL rules loopPoint turnL turnR banL ht hRules
    cases hEL : applyRulesWithLoops game boardL rules loopPoint turnL banL with
    | error eL =>
      simp only [hEL, applyRuleGroupResultEq] at hEarly
      cases hER : applyRulesWithLoops game boardL (filterNonInertGroups rules) loopPoint
          turnR banL with
      | error eR =>
        simp only [hER, applyRuleGroupResultEq] at hEarly
        simp only [hEL, hER, rigidRetryResultEq]
        exact hEarly
      | ok _ =>
        simp only [hER, applyRuleGroupResultEq] at hEarly
    | ok tripL =>
      rcases tripL with ⟨_cL, bL, tL⟩
      simp only [hEL, applyRuleGroupResultEq] at hEarly
      cases hER : applyRulesWithLoops game boardL (filterNonInertGroups rules) loopPoint
          turnR banL with
      | error _ =>
        simp only [hER, applyRuleGroupResultEq] at hEarly
      | ok tripR =>
        rcases tripR with ⟨_cR, bR, tR⟩
        simp only [hER, applyRuleGroupResultEq] at hEarly
        rcases hEarly with ⟨_hc, rfl, hT⟩
        simp only [hEL, hER]
        rcases hRes : resolveMovements game bL banL with ⟨board'', doUndo, banned'⟩
        simp only [hRes]
        cases hDo : doUndo with
        | true =>
          simp only [hDo]
          exact ih _ _
            ⟨rfl, TurnState.effectEq_clear_commandQueue hT, rfl⟩
        | false =>
          simp only [hDo, filterNonInertGroups_isEmpty]
          cases hEmpty : lateRules.isEmpty with
          | true =>
            simp only [hEmpty, rigidRetryResultEq, pure]
            exact ⟨rfl, hT, rfl⟩
          | false =>
            simp only [hEmpty, Bool.not_false]
            have hLateAppl :=
              applyRulesWithLoops_filterNonInert game board'' lateRules lateLoopPoint tL tR #[]
                hT hLate
            cases hLL : applyRulesWithLoops game board'' lateRules lateLoopPoint tL #[] with
            | error eL =>
              simp only [hLL, applyRuleGroupResultEq] at hLateAppl
              cases hLR : applyRulesWithLoops game board''
                  (filterNonInertGroups lateRules) lateLoopPoint tR #[] with
              | error eR =>
                simp only [hLR, applyRuleGroupResultEq] at hLateAppl
                simp only [hLL, hLR, rigidRetryResultEq]
                exact hLateAppl
              | ok _ =>
                simp only [hLR, applyRuleGroupResultEq] at hLateAppl
            | ok tripLL =>
              rcases tripLL with ⟨_, bLL, tLL⟩
              simp only [hLL, applyRuleGroupResultEq] at hLateAppl
              cases hLR : applyRulesWithLoops game board''
                  (filterNonInertGroups lateRules) lateLoopPoint tR #[] with
              | error _ =>
                simp only [hLR, applyRuleGroupResultEq] at hLateAppl
              | ok tripLR =>
                rcases tripLR with ⟨_, bLR, tLR⟩
                simp only [hLR, applyRuleGroupResultEq] at hLateAppl
                rcases hLateAppl with ⟨_, rfl, hT'⟩
                simp only [hLL, hLR, rigidRetryResultEq, pure]
                exact ⟨rfl, hT', rfl⟩

theorem rigidRetry_filterNonInert
    (game : Game) (rules lateRules : Array (Array Rule))
    (loopPoint lateLoopPoint : Array (Option Nat)) (startBoard : Board)
    (turnL turnR : TurnState) (ht : TurnState.effectEq turnL turnR)
    (hRules : rules.all groupNotRandom = true)
    (hLate : lateRules.all groupNotRandom = true) :
    (match
        rigidRetry game rules lateRules loopPoint lateLoopPoint startBoard turnL,
        rigidRetry game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
          loopPoint lateLoopPoint startBoard turnR with
      | .ok (bL, tL), .ok (bR, tR) => bL = bR ∧ TurnState.effectEq tL tR
      | .error eL, .error eR => eL = eR
      | _, _ => False) := by
  have h :=
    rigidRetry.go_filterNonInert game rules lateRules loopPoint lateLoopPoint startBoard 50
      { board := startBoard, turn := turnL, bannedGroup := #[] }
      { board := startBoard, turn := turnR, bannedGroup := #[] }
      ⟨rfl, ht, rfl⟩ hRules hLate
  simp only [rigidRetry]
  cases hL : rigidRetry.go game rules lateRules loopPoint lateLoopPoint startBoard 50
      { board := startBoard, turn := turnL, bannedGroup := #[] } with
  | error eL =>
    simp only [hL, rigidRetryResultEq] at h
    cases hR : rigidRetry.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
        loopPoint lateLoopPoint startBoard 50
        { board := startBoard, turn := turnR, bannedGroup := #[] } with
    | error eR =>
      simp only [hR, rigidRetryResultEq] at h
      simp only [hL, hR]
      exact h
    | ok _ =>
      simp only [hR, rigidRetryResultEq] at h
  | ok sL =>
    simp only [hL, rigidRetryResultEq] at h
    cases hR : rigidRetry.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
        loopPoint lateLoopPoint startBoard 50
        { board := startBoard, turn := turnR, bannedGroup := #[] } with
    | error _ =>
      simp only [hR, rigidRetryResultEq] at h
    | ok sR =>
      simp only [hR, rigidRetryResultEq] at h
      rcases h with ⟨hb, ht', _⟩
      simp only [hL, hR, hb, pure]
      exact ⟨rfl, ht'⟩

private def filterMatchesAtTile (b : Board) (mask : MaskWords) (aggr : Bool) (tile : Nat) : Bool :=
  if aggr then maskAggregateMatchesAtTile b mask tile else maskAnyMatchesAtTile b mask tile

private def winConditionPasses (b : Board) (wc : WinCondition) : Bool :=
  let n := b.nTiles
  if wc.quantifier == 1 then
    Id.run do
      for tile in [:n] do
        if filterMatchesAtTile b wc.filter1 wc.aggr1 tile then
          if !filterMatchesAtTile b wc.filter2 wc.aggr2 tile then
            return false
      pure true
  else if wc.quantifier == -1 then
    Id.run do
      for tile in [:n] do
        if filterMatchesAtTile b wc.filter1 wc.aggr1 tile && filterMatchesAtTile b wc.filter2 wc.aggr2 tile then
          return false
      pure true
  else if wc.quantifier == 0 then
    Id.run do
      for tile in [:n] do
        if filterMatchesAtTile b wc.filter1 wc.aggr1 tile && filterMatchesAtTile b wc.filter2 wc.aggr2 tile then
          return true
      pure false
  else
    false

def evaluateWinConditions (game : Game) (b : Board) : Bool :=
  if game.winConditions.isEmpty then
    false
  else
    game.winConditions.all (winConditionPasses b)

private def boardsDiffer (a b : Board) : Bool :=
  a.objects != b.objects || a.movements != b.movements

/--
Fuel budget for nested turn recursion (`runRulesOnLevelStart` / again-probe).
Large enough for any realistic nesting; enables induction for inert congruence.
-/
def turnFuelDefault : Nat := 64

/-- Win / checkpoint bookkeeping after cancel/restart handling (rules-independent). -/
def processCommandQueue.afterWinCheckpoint (game : Game) (s1 : Session)
    (cmds : Array Command) : Session :=
  let winning := s1.winning || cmds.contains .win || evaluateWinConditions game s1.board
  let s2 := { s1 with winning }
  if !s2.winning && cmds.contains .checkpoint then
    { s2 with restartBoard := some s2.board.clearMovements }
  else
    s2

mutual
/-- JS: after restore/load with `run_rules_on_level_start`, run `processInput(-1)` and ignore win. -/
def runRulesOnLevelStartIfNeeded.go (game : Game) (rules lateRules : Array (Array Rule))
    (session : Session) : Nat → Except String Session
  | 0 => throw "turn fuel exhausted (runRulesOnLevelStart)"
  | fuel + 1 =>
    if !game.runRulesOnLevelStart then
      pure session
    else
      match executeTurn.go game rules lateRules session (.tick) true fuel with
      | .error e => .error e
      | .ok (s, _) =>
        -- JS ignores win conditions satisfied during the level-start rule pass.
        pure { s with winning := false }

def processCommandQueue.go (game : Game) (rules lateRules : Array (Array Rule))
    (turnBackup : Session) (session : Session) (turn : TurnState) (skipAgainProbe : Bool) :
    Nat → Except String (Session × Bool)
  | 0 => throw "turn fuel exhausted (processCommandQueue)"
  | fuel + 1 =>
    let cmds := turn.commandQueue
    if cmds.contains .cancel then
      pure (turnBackup, false)
    else
      let s0 :=
        if cmds.contains .restart then
          let s1 :=
            { session with
              undoBackups :=
                session.undoBackups.push (turnBackup.board, turnBackup.currentLevel, turnBackup.winning) }
          match s1.restartBoard with
          | some rb => { s1 with board := rb.clearMovements }
          | none => s1
        else
          session
      let afterRestart : Except String Session :=
        if cmds.contains .restart then
          runRulesOnLevelStartIfNeeded.go game rules lateRules s0 fuel
        else
          pure s0
      match afterRestart with
      | .error e => .error e
      | .ok s1 =>
        -- Inlined `processCommandQueue.finish` (kept here for mutual termination).
        let s3 := processCommandQueue.afterWinCheckpoint game s1 cmds
        match againEligible cmds turnBackup.board s3.board with
        | true =>
          match skipAgainProbe with
          | true => pure (s3, true)
          | false =>
            let boardBeforeProbe := s3.board
            match executeTurn.go game rules lateRules s3 (.tick) true fuel with
            | .error _ => pure (s3, false)
            | .ok (probed, _) =>
              pure ({ s3 with rng := probed.rng }, objectsChanged boardBeforeProbe probed.board)
        | false => pure (s3, false)

/--
`game` supplies movement/win/session metadata; `rules`/`lateRules` are the rule arrays
(so inert-filtered rule sets can share the same `game`).
-/
def executeTurn.go (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
    (input : InputToken) (skipAgainProbe : Bool) : Nat → Except String (Session × Bool)
  | 0 => throw "turn fuel exhausted (executeTurn)"
  | fuel + 1 =>
    match input with
    | .undo =>
      match session.undoBackups.back? with
      | none => pure (session, false)
      | some (board, lvl, win) =>
        let backups := session.undoBackups.extract 0 (session.undoBackups.size - 1)
        -- Drop restart target if it no longer matches the restored level's active playable
        -- (undo-across-win). Keeps Session.WellFormed restart coherent with currentLevel.
        let restartBoard :=
          match session.restartBoard with
          | none => none
          | some rb =>
            match Game.activePlayableLevel? game lvl with
            | some e =>
              if Board.matchesPlayable game rb e then some rb else none
            | none => none
        let s' : Session :=
          { session with
            board := board.clearMovements
            currentLevel := lvl
            winning := win
            undoBackups := backups
            restartBoard := restartBoard }
        pure (s', false)
    | .restart =>
      let s0 :=
        match session.restartBoard with
        | some rb =>
          { session with
            board := rb.clearMovements
            undoBackups := session.undoBackups.push (session.board, session.currentLevel, session.winning) }
        | none => session
      match runRulesOnLevelStartIfNeeded.go game rules lateRules s0 fuel with
      | .error e => .error e
      | .ok s => pure (s, false)
    | .tick | .move _ | .action =>
      let turnBackup := session
      let board0 := session.board.clearMovements
      let turn0 := TurnState.initial session.rng
      let (board1, playerPositions) :=
        match input.dirMask? with
        | some dirMask => startMovement game board0 dirMask
        | none => (board0, #[])
      match rigidRetry game rules lateRules game.loopPoint game.lateLoopPoint board1 turn0 with
      | .error e => .error e
      | .ok (board2, turn2) =>
        if game.requirePlayerMovement && playerPositions.size > 0
            && !playerMovementDetected game board2 playerPositions then
          pure (turnBackup, false)
        else
          let winning0 := evaluateWinConditions game board2
          let winning := winning0 || turn2.commandQueue.contains .win
          let s0 := { session with board := board2, winning, rng := turn2.rng }
          match processCommandQueue.go game rules lateRules turnBackup s0 turn2 skipAgainProbe fuel with
          | .error e => .error e
          | .ok (s1, againPending) =>
            pure (sessionAfterWinAdvance game s1, againPending)
end

/--
Again-probe / return after restart+win bookkeeping. Matches the `.ok` branch of
`processCommandQueue.go` (extracted for congruence proofs).
-/
def processCommandQueue.finish (game : Game) (rules lateRules : Array (Array Rule))
    (turnBackup : Session) (s1 : Session) (cmds : Array Command) (skipAgainProbe : Bool)
    (fuel : Nat) : Except String (Session × Bool) :=
  let s3 := processCommandQueue.afterWinCheckpoint game s1 cmds
  match againEligible cmds turnBackup.board s3.board with
  | true =>
    match skipAgainProbe with
    | true => pure (s3, true)
    | false =>
      let boardBeforeProbe := s3.board
      match executeTurn.go game rules lateRules s3 (.tick) true fuel with
      | .error _ => pure (s3, false)
      | .ok (probed, _) =>
        pure ({ s3 with rng := probed.rng }, objectsChanged boardBeforeProbe probed.board)
  | false => pure (s3, false)

/--
Tick / move / action body extracted for congruence proofs (definitionally matches `go`).
-/
def executeTurn.movementGo (game : Game) (rules lateRules : Array (Array Rule))
    (session : Session) (startBoard : Board) (playerPositions : Array Nat)
    (turn0 : TurnState) (skipAgainProbe : Bool) (fuel : Nat) :
    Except String (Session × Bool) :=
  let turnBackup := session
  match rigidRetry game rules lateRules game.loopPoint game.lateLoopPoint startBoard turn0 with
  | .error e => .error e
  | .ok (board2, turn2) =>
    if game.requirePlayerMovement && playerPositions.size > 0
        && !playerMovementDetected game board2 playerPositions then
      pure (turnBackup, false)
    else
      let winning0 := evaluateWinConditions game board2
      let winning := winning0 || turn2.commandQueue.contains .win
      let s0 := { session with board := board2, winning, rng := turn2.rng }
      match processCommandQueue.go game rules lateRules turnBackup s0 turn2 skipAgainProbe fuel with
      | .error e => .error e
      | .ok (s1, againPending) =>
        pure (sessionAfterWinAdvance game s1, againPending)

theorem executeTurn.go_eq_movementGo
    (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
    (input : InputToken) (skip : Bool) (fuel : Nat)
    (h : input = .tick ∨ input = .action ∨ ∃ d, input = .move d) :
    executeTurn.go game rules lateRules session input skip (fuel + 1) =
      (let board0 := session.board.clearMovements
       let turn0 := TurnState.initial session.rng
       let (board1, playerPositions) :=
         match input.dirMask? with
         | some dirMask => startMovement game board0 dirMask
         | none => (board0, #[])
       executeTurn.movementGo game rules lateRules session board1 playerPositions turn0 skip
         fuel) := by
  rcases h with h | h | ⟨d, h⟩ <;> subst h <;> rfl

def runRulesOnLevelStartIfNeeded (game : Game) (session : Session) : Except String Session :=
  runRulesOnLevelStartIfNeeded.go game game.rules game.lateRules session turnFuelDefault

def processCommandQueue (game : Game) (turnBackup : Session) (session : Session) (turn : TurnState)
    (skipAgainProbe : Bool) : Except String (Session × Bool) :=
  processCommandQueue.go game game.rules game.lateRules turnBackup session turn skipAgainProbe
    turnFuelDefault

def executeTurn (game : Game) (session : Session) (input : InputToken) (skipAgainProbe := false) :
    Except String (Session × Bool) :=
  executeTurn.go game game.rules game.lateRules session input skipAgainProbe turnFuelDefault

def replay (game : Game) (session : Session) (inputs : Array String) (maxInputs : Option Nat := none) : Except String Session := do
  let mut s := session
  let mut count := 0
  for tok in inputs do
    match maxInputs with
    | some m => if count >= m then break
    | none => pure ()
    let input ← parseMovementInputToken tok
    let pre := s
    let (s', againPending) ← executeTurn game s input
    s := s'
    let mut again := againPending
    while again do
      let (s'', again') ← executeTurn game s (.tick)
      s := s''
      again := again'
    -- Push one undo frame per player input after again settles (not per again tick).
    match input with
    | .move _ | .action =>
      if boardsDiffer pre.board s.board then
        s := { s with undoBackups := s.undoBackups.push (pre.board, pre.currentLevel, pre.winning) }
    | .undo | .restart | .tick => pure ()
    count := count + 1
  pure s

/-- JS `processInput` direction index (0..3 move, 4 action). -/
def parseDirInputIndex (inputIdx : Int) : Except String InputToken :=
  if inputIdx == 4 then pure InputToken.action
  else
    match Dir4.ofInputIndex? inputIdx with
    | some d => pure (.move d)
    | none => throw s!"invalid movement input index: {inputIdx}"

def stepOneInput (game : Game) (session : Session) (inputIdx : Int) : Except String Session :=
  match parseDirInputIndex inputIdx with
  | .error e => .error e
  | .ok input =>
    match executeTurn game session input with
    | .error e => .error e
    | .ok (s, _) => .ok s

def stepInputToken (game : Game) (session : Session) (tok : String) : Except String Session :=
  match parseMovementInputToken tok with
  | .error e => .error e
  | .ok input =>
    match executeTurn game session input with
    | .error e => .error e
    | .ok (s, _) => .ok s

end PuzzleScript

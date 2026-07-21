import PuzzleScript.Board
import PuzzleScript.BitVec
import PuzzleScript.Command
import PuzzleScript.Dir4
import PuzzleScript.IR
import PuzzleScript.Rng
import PuzzleScript.Rules

namespace PuzzleScript

def ruleDirectionDelta (direction : RuleDir) (height : Nat) : Int :=
  let h := Int.ofNat height
  let d := direction.bits
  let d0 := Int.ofNat (d &&& 1).toNat
  let d1 := Int.ofNat ((d >>> 1) &&& 1).toNat
  let d2 := Int.ofNat ((d >>> 2) &&& 1).toNat
  let d3 := Int.ofNat ((d >>> 3) &&& 1).toNat
  (d3 - d2) * h + (d1 - d0)

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

private def maskComplementWord (w : UInt32) : UInt32 := ~~~w

def maskApplyReplacement (old clear set : MaskWords) : MaskWords :=
  let n := max (max old.size clear.size) set.size
  Id.run do
    let mut out : MaskWords := .mkEmpty n
    for i in [:n] do
      let o := maskWord old i
      let c := maskWord clear i
      let s := maskWord set i
      out := out.push ((o &&& maskComplementWord c) ||| s)
    pure out

def buildLayerMasks (game : Game) : Array MaskWords :=
  Id.run do
    let mut layers : Array MaskWords := Array.replicate game.layerCount #[]
    for oid in [:game.objectCount] do
      let layer := game.objectLayers.getD oid 0
      if layer < game.layerCount then
        let cur := layers.getD layer #[]
        layers := layers.set! layer (maskSetBit cur oid true)
    pure layers

private def anyObjectsPresentMatch (objs : MaskWords) (terms : Array MaskWords) : Bool :=
  terms.all fun term => maskAnyBits (maskAnd objs term)

private def anyMovementsPresentMatch (movs : MaskWords) (terms : Array MaskWords) : Bool :=
  terms.all fun term => maskAnyBits (maskAnd movs term)

private def maskAggregateMatchesAtTile (b : Board) (mask : MaskWords) (tile : Nat) : Bool :=
  maskBitsSetIn mask (b.cellObjWords tile)

private def layerOptionMatches (objs movs : MaskWords) (layer : LayerCoupledLayer) : Bool :=
  -- Native/JS: object mask is an overlap test (any bit), not a full subset test.
  maskAnyBits (maskAnd layer.objectMask objs)
    && (if maskAnyBits layer.movementsAny then maskAnyBits (maskAnd movs layer.movementsAny) else true)
    && maskBitsSetIn layer.movementsPresent movs
    && maskNoBitsInCommon layer.movementsMissing movs

private def layerCoupledTermMatches (objs movs : MaskWords) (term : LayerCoupledTerm) : Bool :=
  maskAnyBits (maskAnd term.objectMask objs) && term.layers.any (layerOptionMatches objs movs)

private def layerCoupledMasksMatch (objs movs : MaskWords) (terms : Array LayerCoupledTerm) : Bool :=
  terms.all (layerCoupledTermMatches objs movs)

private def getLayerMovementBits (mov : MaskWords) (layer : Nat) : UInt32 :=
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

private def setLayerMovementBits (mov : MaskWords) (layer : Nat) (bits : UInt32) : MaskWords :=
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

private def clearLayerMovementBits (mov : MaskWords) (layer : Nat) : MaskWords :=
  setLayerMovementBits mov layer 0

private def movMaskZeros (stride : Nat) : MaskWords :=
  Array.replicate stride (0 : UInt32)

private def getMovementBitsForLayerAt (b : Board) (tile : Nat) (layer : Nat) : UInt32 :=
  getLayerMovementBits (b.cellMovWords tile) layer

private def tupleCellTile (rm : RowMatch) (delta : Int) (_rowIdx cellIdx : Nat) : Nat :=
  let base :=
    match rm with
    | .fixed s => s
    | .ellipsis1 s _ => s
    | .ellipsis2 s _ _ => s
  (Int.ofNat base + delta * Int.ofNat cellIdx).toNat

private def capturePropertyBindings (_game : Game) (b : Board) (rule : Rule) (tuple : Array RowMatch) (delta : Int)
    (caps : RuleCaptures) : RuleCaptures :=
  Id.run do
    let mut out := caps
    for bnd in rule.propertyBindings do
      let rm := tuple.getD bnd.sourceRow (.fixed 0)
      let tile := tupleCellTile rm delta bnd.sourceRow bnd.sourceCell
      let mut found : Option PropertyAlias := none
      for alias in bnd.aliases do
        if !maskGetBit (b.cellObjWords tile) alias.objectId then
          continue
        let mode := bnd.sourceMovementMode
        if mode != 0 then
          let movementBits := getMovementBitsForLayerAt b tile alias.layerIndex
          let sm := UInt32.ofNat bnd.sourceMovementMask
          if mode == 1 then
            if (movementBits &&& sm) != 0 then continue
          else if mode == 3 then
            if (movementBits &&& sm) == 0 then continue
          else if (movementBits &&& sm) != sm then
            continue
        found := some alias
        break
      match found with
      | some alias => out := out.setProperty bnd.propertyName alias
      | none => pure ()
    pure out

private def captureAggregateBindings (b : Board) (rule : Rule) (tuple : Array RowMatch) (delta : Int) (caps : RuleCaptures) : RuleCaptures :=
  Id.run do
    let mut out := caps
    for bnd in rule.aggregateBindings do
      let rm := tuple.getD bnd.sourceRow (.fixed 0)
      let tile := tupleCellTile rm delta bnd.sourceRow bnd.sourceCell
      let sourceLayer? : Option Nat :=
        match bnd.sourcePropertyName, bnd.sourceLayer with
        | some pname, _ => (caps.getProperty pname).map (·.layerIndex)
        | none, some l => some l
        | none, none => some 0
      match sourceLayer? with
      | none => out := out.setAggregate bnd.aggregateName 0
      | some sourceLayer =>
        let raw := getMovementBitsForLayerAt b tile sourceLayer
        let bits := raw.toNat &&& bnd.aggregateMask
        out := out.setAggregate bnd.aggregateName bits
    pure out

private def applyInferredReplacementFields (game : Game) (pat : CellPattern) (caps : RuleCaptures)
    (objs movs : MaskWords)
    (objectsClear objectsSet movementsClear movementsSet : MaskWords) :
    (MaskWords × MaskWords × MaskWords × MaskWords) :=
  Id.run do
    let mut oc := objectsClear
    let mut os := objectsSet
    let mut mc := movementsClear
    let mut ms := movementsSet
    for s in pat.inferredPropertySources do
      match caps.getProperty s.propertyName with
      | some cap =>
        oc := maskOr oc (game.layerMasks.getD cap.layerIndex #[])
        mc := setLayerMovementBits mc cap.layerIndex 31
      | none => pure ()
    for b in pat.inferredPropertyBindings do
      match caps.getProperty b.propertyName with
      | some cap =>
        if b.dirMode != 0 then
          mc := setLayerMovementBits mc cap.layerIndex 31
          if b.dirMode == 2 then
            ms := setLayerMovementBits ms cap.layerIndex (UInt32.ofNat b.dirMask)
        os := maskSetBit os cap.objectId true
      | none => pure ()
    for b in pat.inferredAggregateBindings do
      match caps.getAggregate b.aggregateName with
      | none => pure ()
      | some captured =>
        let layerIdx? :=
          match b.layerIndex, b.propertyName with
          | some l, _ => some l
          | none, some pname =>
            match caps.getProperty pname with
            | some cap => some cap.layerIndex
            | none => none
          | none, none => some 0
        match layerIdx? with
        | none => pure ()
        | some layerIdx =>
          ms := setLayerMovementBits ms layerIdx (UInt32.ofNat captured)
          if let some pname := b.propertyName then
            match caps.getProperty pname with
            | some cap => mc := setLayerMovementBits mc cap.layerIndex 31
            | none => pure ()
    -- Only rewrite movement on layer options that match this cell (JS/native overlap).
    for coupled in pat.layerCoupledMovementReplacements do
      for layerTerm in coupled.layers do
        if layerOptionMatches objs movs layerTerm then
          mc := setLayerMovementBits mc layerTerm.layerIndex 31
          if let some aname := coupled.replacementAggregateName then
            match caps.getAggregate aname with
            | some bits => ms := setLayerMovementBits ms layerTerm.layerIndex (UInt32.ofNat bits)
            | none => pure ()
          else if let some m := coupled.replacementMovementMask then
            ms := setLayerMovementBits ms layerTerm.layerIndex (UInt32.ofNat m)
    pure (oc, os, mc, ms)

private def buildRigidGroupMask (game : Game) (groupNumber : Nat) (movementsLayerMask : MaskWords) (stride : Nat) : MaskWords :=
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

private def collectMaskBits (m : MaskWords) (maxBit : Nat) : Array Nat :=
  Id.run do
    let mut out : Array Nat := #[]
    for bit in [:maxBit] do
      if maskGetBit m bit then out := out.push bit
    pure out

private def dirBitsFromIndex (n : Nat) : UInt32 :=
  (Dir4.ofRandomIndex n).toBits

private def applyCellReplacement (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern) (caps : RuleCaptures)
    (rng : RngState) : (Bool × Board × RngState) :=
  if !pat.hasReplacement then
    (false, b, rng)
  else
    Id.run do
      let mut rng' := rng
      let mut objectsClear := pat.objectsClear
      let mut objectsSet := pat.objectsSet
      let mut movementsClear := pat.movementsClear
      let mut movementsSet := pat.movementsSet
      if maskAnyBits pat.randomEntityMask then
        let choices := collectMaskBits pat.randomEntityMask game.objectCount
        unless choices.isEmpty do
          let (idx, r) := rng'.randomNat 0 choices.size
          rng' := r
          let oid := choices.getD idx 0
          objectsSet := maskSetBit objectsSet oid true
          let layer := game.objectLayers.getD oid 0
          let layerMask := game.layerMasks.getD layer #[]
          objectsClear := maskOr objectsClear layerMask
          movementsClear := maskOr movementsClear (setLayerMovementBits (movMaskZeros b.strideMov) layer 31)
      for layer in [:game.layerCount] do
        if getLayerMovementBits pat.randomDirMask layer != 0 then
          let (dirIdx, r) := rng'.randomNat 0 4
          rng' := r
          movementsSet := setLayerMovementBits movementsSet layer (dirBitsFromIndex dirIdx)
      let oldObj := b.cellObjWords tile
      let oldMov := b.cellMovWords tile
      let (oc, os, mc, ms) :=
        applyInferredReplacementFields game pat caps oldObj oldMov objectsClear objectsSet movementsClear movementsSet
      objectsClear := oc
      objectsSet := os
      movementsClear := mc
      movementsSet := ms
      let newObj := maskApplyReplacement oldObj objectsClear objectsSet
      let movClear := maskOr movementsClear pat.movementsLayerMask
      let newMov := maskApplyReplacement oldMov movClear movementsSet
      let mut rigidChange := false
      let mut board := b
      if rule.rigid then
        let rigidMask := buildRigidGroupMask game rule.groupNumber pat.movementsLayerMask b.strideMov
        let curGroup := board.cellRigidGroupIndexMask tile
        let curApplied := board.cellRigidMovementAppliedMask tile
        if maskNoBitsInCommon rigidMask curGroup && maskNoBitsInCommon pat.movementsLayerMask curApplied then
          rigidChange := true
          board := board.setCellRigidGroupIndexMask tile (maskOr curGroup rigidMask)
          board := board.setCellRigidMovementAppliedMask tile (maskOr curApplied pat.movementsLayerMask)
      if newObj == oldObj && newMov == oldMov && !rigidChange then
        return (false, b, rng')
      board := board.setCellObjWords tile newObj
      board := board.setCellMovWords tile newMov
      return (true, board, rng')

private def rowCellsMatchFixed (b : Board) (startTile : Nat) (delta : Int) (row : Array PatternCell) : Bool :=
  Id.run do
    let mut idx : Int := Int.ofNat startTile
    for cell in row do
      match cell with
      | .ellipsis => return false
      | .cell pat =>
        if idx < 0 then return false
        let t := idx.toNat
        if t >= b.nTiles then return false
        if !cellPatternMatches b t pat then return false
        idx := idx + delta
    pure true

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

private def rowMatchStart (rm : RowMatch) : Nat :=
  match rm with
  | .fixed s => s
  | .ellipsis1 s _ => s
  | .ellipsis2 s _ _ => s

private def applyRowAt (game : Game) (rule : Rule) (b : Board) (delta : Int) (row : Array PatternCell) (rm : RowMatch) (caps : RuleCaptures)
    (rng : RngState) : (Bool × Board × RngState) :=
  Id.run do
    let mut board := b
    let mut changed := false
    let mut rng' := rng
    let mut idx : Int := Int.ofNat (rowMatchStart rm)
    let mut gapIdx := 0
    let gaps :=
      match rm with
      | .fixed _ => #[]
      | .ellipsis1 _ g => #[g]
      | .ellipsis2 _ g1 g2 => #[g1, g2]
    for cell in row do
      match cell with
      | .ellipsis =>
        let g := gaps.getD gapIdx 0
        gapIdx := gapIdx + 1
        idx := idx + delta * Int.ofNat g
      | .cell pat =>
        let t := idx.toNat
        let (c, b', r) := applyCellReplacement game rule board t pat caps rng'
        changed := changed || c
        board := b'
        rng' := r
        idx := idx + delta
    pure (changed, board, rng')

private def tupleStillMatches (b : Board) (rule : Rule) (tuple : Array RowMatch) : Bool :=
  let delta := ruleDirectionDelta rule.direction b.height
  tuple.size == rule.patternRows.size &&
    (tuple.zip rule.patternRows).all fun (rm, row) =>
      match rm with
      | .fixed s => rowCellsMatchFixed b s delta row
      | .ellipsis1 s g => rowCellsMatchEllipsis1 b s g delta row
      | .ellipsis2 s g1 g2 => rowCellsMatchEllipsis2 b s g1 g2 delta row

private def applyRuleTuple (game : Game) (b : Board) (rule : Rule) (tuple : Array RowMatch) (recheck : Bool) (rng : RngState) : (Bool × Board × RngState) :=
  if recheck && !tupleStillMatches b rule tuple then
    (false, b, rng)
  else
    let delta := ruleDirectionDelta rule.direction b.height
    let caps :=
      captureAggregateBindings b rule tuple delta
        (capturePropertyBindings game b rule tuple delta RuleCaptures.empty)
    Id.run do
      let mut board := b
      let mut changed := false
      let mut rng' := rng
      for ri in [:tuple.size] do
        let row := rule.patternRows[ri]!
        let (c, b', r) := applyRowAt game rule board delta row (tuple[ri]!) caps rng'
        changed := changed || c
        board := b'
        rng' := r
      pure (changed, board, rng')

private def findRuleMatchTuples (b : Board) (rule : Rule) : Array (Array RowMatch) :=
  let rowMatchLists := rule.patternRows.mapIdx fun i _ => findRowMatches b rule i
  if rowMatchLists.any (·.isEmpty) then #[] else cartesianRowMatches rowMatchLists

private def queueCommandsForRule (existing : Array Command) (rule : Rule) : Array Command :=
  let preCancel := existing.contains .cancel
  let preRestart := existing.contains .restart
  let ruleCancel := rule.commands.contains .cancel
  let ruleRestart := rule.commands.contains .restart
  if preCancel then
    existing
  else if preRestart && !ruleCancel then
    existing
  else
    let base := if ruleCancel || ruleRestart then #[] else existing
    Id.run do
      let mut out := base
      for c in rule.commands do
        unless out.contains c do
          out := out.push c
      pure out

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

/-- JS again-gate object delta: compare object masks only (not movements / commands). -/
def objectsChanged (before after : Board) : Bool :=
  before.objects != after.objects

/-- Again is eligible when `again` is queued and objects differ from the turn backup. -/
def againEligible (cmds : Array Command) (backup current : Board) : Bool :=
  match cmds.contains .again with
  | true => objectsChanged backup current
  | false => false

def tryApplyRule (game : Game) (b : Board) (rule : Rule) (st : TurnState) : (Bool × Board × TurnState) :=
  let rowMatchLists := rule.patternRows.mapIdx fun i _ => findRowMatches b rule i
  if rowMatchLists.any (·.isEmpty) then
    (false, b, st)
  else
    let tuples := cartesianRowMatches rowMatchLists
    Id.run do
      let mut board := b
      let mut any := false
      let mut turn := st
      let mut cmdQ := st.commandQueue
      cmdQ := queueCommandsForRule cmdQ rule
      for ti in [:tuples.size] do
        let tuple := tuples[ti]!
        let recheck := ti > 0
        let (c, b', rng') := applyRuleTuple game board rule tuple recheck turn.rng
        turn := { turn with rng := rng' }
        any := any || c
        board := b'
      -- §4.0: do not treat command presence as board modification (JS uses object delta).
      let modified := turn.modified || any
      pure (any, board, { turn with commandQueue := cmdQ, modified := modified })

private def applyRandomRuleGroup (game : Game) (b : Board) (group : Array Rule) (st : TurnState) : (Bool × Board × TurnState) :=
  Id.run do
    let mut ruleMatches : Array (Nat × Array RowMatch) := #[]
    for ruleIdx in [:group.size] do
      match group[ruleIdx]? with
      | none => pure ()
      | some rule =>
        for tuple in findRuleMatchTuples b rule do
          ruleMatches := ruleMatches.push (ruleIdx, tuple)
    if ruleMatches.isEmpty then
      return (false, b, st)
    let (pickIdx, rng') := st.rng.randomNat 0 ruleMatches.size
    let (ruleIdx, tuple) := ruleMatches[pickIdx]!
    match group[ruleIdx]? with
    | none => return (false, b, st)
    | some rule =>
      let cmdQ := queueCommandsForRule st.commandQueue rule
      let (changed, board, rng'') := applyRuleTuple game b rule tuple false rng'
      let modified := st.modified || changed
      return (changed, board, { st with commandQueue := cmdQ, modified := modified, rng := rng'' })

private def applyRuleGroup (game : Game) (b : Board) (group : Array Rule) (st : TurnState) : Except String (Bool × Board × TurnState) := do
  if h : group.size > 0 then
    have g0 := group[0]
    if g0.isRandom then
      let (changed, board, turn) := applyRandomRuleGroup game b group st
      return (changed, board, turn)
  let maxLoops := 200
  let mut board := b
  let mut turn := st
  let mut groupChanged := false
  let mut loopCount := 0
  let mut madeChangeThisLoop := true
  while madeChangeThisLoop && loopCount < maxLoops do
    madeChangeThisLoop := false
    loopCount := loopCount + 1
    let mut consecutiveFailures := 0
    for rule in group do
      let (changed, b', st') := tryApplyRule game board rule turn
      turn := st'
      if changed then
        madeChangeThisLoop := true
        consecutiveFailures := 0
        board := b'
      else
        consecutiveFailures := consecutiveFailures + 1
        if consecutiveFailures == group.size then
          break
    if madeChangeThisLoop then
      groupChanged := true
  pure (groupChanged, board, turn)

private def applyRulesWithLoops (game : Game) (b : Board) (groups : Array (Array Rule)) (loopPoint : Array (Option Nat)) (st : TurnState)
    (bannedGroup : Array Bool) : Except String (Bool × Board × TurnState) := do
  let mut board := b
  let mut turn := st
  let mut rulesChanged := false
  let mut ruleGroupIndex := 0
  let mut loopPropagated := false
  let mut loopCount := 0
  let rulesCount := groups.size
  while ruleGroupIndex < rulesCount do
    unless bannedGroup.getD ruleGroupIndex false do
      let group := groups[ruleGroupIndex]!
      let (groupChanged, b', st') ← applyRuleGroup game board group turn
      board := b'
      turn := st'
      rulesChanged := rulesChanged || groupChanged
      loopPropagated := loopPropagated || groupChanged
    if loopPropagated then
      match loopPoint[ruleGroupIndex]? with
      | some (some target) =>
        ruleGroupIndex := target
        loopPropagated := false
        loopCount := loopCount + 1
        if loopCount > 200 then
          break
        continue
      | _ => pure ()
    ruleGroupIndex := ruleGroupIndex + 1
    if ruleGroupIndex == rulesCount && loopPropagated then
      match loopPoint[rulesCount]? with
      | some (some target) =>
        ruleGroupIndex := target
        loopPropagated := false
        loopCount := loopCount + 1
        if loopCount > 200 then
          break
      | _ => pure ()
  pure (rulesChanged, board, turn)

private def maskAnyMatchesAtTile (b : Board) (entityMask : MaskWords) (tile : Nat) : Bool :=
  let cell := b.cellObjWords tile
  maskAnyBits (maskAnd cell entityMask)

private def layersOfMask (game : Game) (cell : MaskWords) : Array Nat :=
  Id.run do
    let mut out : Array Nat := #[]
    for oid in [:game.objectCount] do
      if maskGetBit cell oid then
        out := out.push (game.objectLayers.getD oid 0)
    pure out

private def moveEntitiesAtIndex (game : Game) (b : Board) (tile : Nat) (entityMask : MaskWords) (dirMask : UInt32) : Board :=
  let cell := b.cellObjWords tile
  let cellFiltered := Id.run do
    let mut out := cell
    for i in [:b.strideObj] do
      out := out.set! i (maskWord cell i &&& maskWord entityMask i)
    pure out
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
private def playerMovementDetected (game : Game) (b : Board) (playerPositions : Array Nat) : Bool :=
  playerPositions.any fun pos => maskBitsClearInCell game.playerMask (b.cellObjWords pos)

def startMovement (game : Game) (b : Board) (dirMask : UInt32) : Board × Array Nat :=
  Id.run do
    let positions := getPlayerPositions game b
    let mut board := b
    for tile in positions do
      board := moveEntitiesAtIndex game board tile game.playerMask dirMask
    pure (board, positions)

private def layerMaskFor (game : Game) (layer : Nat) : MaskWords :=
  (buildLayerMasks game).getD layer #[]

private def repositionEntitiesOnLayer (game : Game) (b : Board) (tile : Nat) (layer : Nat) (dirMask : UInt32) : (Bool × Board) :=
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
      let layerMask := layerMaskFor game layer
      let targetObj := b.cellObjWords targetTile
      if maskAnyBits (maskAnd layerMask targetObj) && dirMask != 16 then
        (false, b)
      else
        let sourceObj := b.cellObjWords tile
        let moving := maskAnd sourceObj layerMask
        let newSource := maskApplyReplacement sourceObj layerMask #[]
        let newTarget := maskOr targetObj moving
        let b1 := b.setCellObjWords tile newSource
        let b2 := b1.setCellObjWords targetTile newTarget
        (true, b2)

private def repositionEntitiesAtCell (game : Game) (b : Board) (tile : Nat) : (Bool × Board) :=
  let mov := b.cellMovWords tile
  if !maskAnyBits mov then
    (false, b)
  else
    Id.run do
      let mut board := b
      let mut moved := false
      let mut movement := mov
      for layer in [:game.layerCount] do
        let bits := getLayerMovementBits movement layer
        if bits != 0 then
          let (thisMoved, b') := repositionEntitiesOnLayer game board tile layer bits
          if thisMoved then
            moved := true
            movement := clearLayerMovementBits movement layer
            board := b'
      pure (moved, board.setCellMovWords tile movement)

private def setBannedGroup (bg : Array Bool) (groupIndex : Nat) : Array Bool :=
  if bg.size ≤ groupIndex then
    (bg ++ Array.replicate (groupIndex + 1 - bg.size) false).set! groupIndex true
  else if bg[groupIndex]! then bg else bg.set! groupIndex true

private def clearAllMovementBits (game : Game) (mov : MaskWords) : MaskWords :=
  (List.range game.layerCount).foldl (fun m layer => clearLayerMovementBits m layer) mov

def resolveMovements (game : Game) (b : Board) (bannedGroup : Array Bool) : (Board × Bool × Array Bool) :=
  Id.run do
    let mut board := b
    let mut again := true
    while again do
      again := false
      for tile in [:board.nTiles] do
        let mov := board.cellMovWords tile
        if maskAnyBits mov then
          let (moved, b') := repositionEntitiesAtCell game board tile
          if moved then
            again := true
            board := b'
    let mut doUndo := false
    let mut banned := bannedGroup
    for tile in [:board.nTiles] do
      let mov := board.cellMovWords tile
      if maskAnyBits mov then
        if game.gameRigid then
          let rigidApplied := board.cellRigidMovementAppliedMask tile
          if maskAnyBits rigidApplied then
            let movementMask := maskAnd mov rigidApplied
            if maskAnyBits movementMask then
              for layer in [:game.layerCount] do
                let layerSection := getLayerMovementBits movementMask layer
                if layerSection != 0 then
                  let rigidGroupIndex := getLayerMovementBits (board.cellRigidGroupIndexMask tile) layer
                  if rigidGroupIndex != 0 then
                    let rgi := rigidGroupIndex.toNat - 1
                    let groupIndex := game.rigidGroupIndexToGroupIndex.getD rgi 0
                    if !banned.getD groupIndex false then
                      banned := setBannedGroup banned groupIndex
                      doUndo := true
                  break
        board := board.setCellMovWords tile (clearAllMovementBits game mov)
        if game.gameRigid then
          board := board.setCellRigidGroupIndexMask tile (movMaskZeros board.strideMov)
          board := board.setCellRigidMovementAppliedMask tile (movMaskZeros board.strideMov)
    return (board, doUndo, banned)

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

mutual
/-- JS: after restore/load with `run_rules_on_level_start`, run `processInput(-1)` and ignore win. -/
partial def runRulesOnLevelStartIfNeeded (game : Game) (session : Session) : Except String Session := do
  if !game.runRulesOnLevelStart then
    return session
  let (s, _) ← executeTurn game session (.tick) (skipAgainProbe := true)
  -- JS ignores win conditions satisfied during the level-start rule pass.
  pure { s with winning := false }

partial def processCommandQueue (game : Game) (turnBackup : Session) (session : Session) (turn : TurnState)
    (skipAgainProbe : Bool) : Except String (Session × Bool) := do
  let cmds := turn.commandQueue
  if cmds.contains .cancel then
    return (turnBackup, false)
  let mut s := session
  if cmds.contains .restart then
    s := { s with undoBackups := s.undoBackups.push (turnBackup.board, turnBackup.currentLevel, turnBackup.winning) }
    if let some rb := s.restartBoard then
      s := { s with board := rb.clearMovements }
    s ← runRulesOnLevelStartIfNeeded game s
  let winning := s.winning || cmds.contains .win || evaluateWinConditions game s.board
  s := { s with winning }
  if !s.winning && cmds.contains .checkpoint then
    s := { s with restartBoard := some s.board.clearMovements }
  -- Again gate: JS compares objects only (not movements / command firings).
  let mut againPending := false
  if againEligible cmds turnBackup.board s.board then
    if skipAgainProbe then
      againPending := true
    else
      -- JS: processInput(-1, dontModify) then DoUndo restores objects but NOT RandomGen.
      let boardBeforeProbe := s.board
      match executeTurn game s (.tick) (skipAgainProbe := true) with
      | .error _ =>
        againPending := false
      | .ok (probed, _) =>
        s := { s with rng := probed.rng }
        againPending := objectsChanged boardBeforeProbe probed.board
  return (s, againPending)

partial def executeTurn (game : Game) (session : Session) (input : InputToken) (skipAgainProbe := false) : Except String (Session × Bool) := do
  match input with
  | .undo =>
    match session.undoBackups.back? with
    | none => pure (session, false)
    | some (board, lvl, win) =>
      let backups := session.undoBackups.extract 0 (session.undoBackups.size - 1)
      pure ({ session with board := board.clearMovements, currentLevel := lvl, winning := win, undoBackups := backups }, false)
  | .restart =>
    let s0 :=
      match session.restartBoard with
      | some rb => { session with board := rb.clearMovements, undoBackups := session.undoBackups.push (session.board, session.currentLevel, session.winning) }
      | none => session
    let s ← runRulesOnLevelStartIfNeeded game s0
    pure (s, false)
  | .tick | .move _ | .action =>
    let turnBackup := session
    let mut board := session.board.clearMovements
    let mut turn := TurnState.initial session.rng
    let mut playerPositions : Array Nat := #[]
    if let some dirMask := input.dirMask? then
      let (board', positions) := startMovement game board dirMask
      board := board'
      playerPositions := positions
    let startBoard := board
    let mut bannedGroup : Array Bool := #[]
    let mut rigidIter := 0
    let mut rigidloop := true
    while rigidIter < 50 && rigidloop do
      rigidloop := false
      rigidIter := rigidIter + 1
      let (_, board', turn') ← applyRulesWithLoops game board game.rules game.loopPoint turn bannedGroup
      board := board'
      turn := turn'
      let (board'', doUndo, banned') := resolveMovements game board bannedGroup
      board := board''
      bannedGroup := banned'
      if doUndo then
        rigidloop := true
        board := { startBoard with
          objects := startBoard.objects
          movements := startBoard.movements
          rigidGroupIndexMask := startBoard.rigidGroupIndexMask
          rigidMovementAppliedMask := startBoard.rigidMovementAppliedMask }
        turn := { turn with commandQueue := #[] }
      else if !game.lateRules.isEmpty then
        let (_, board''', turn'') ← applyRulesWithLoops game board game.lateRules game.lateLoopPoint turn #[]
        board := board'''
        turn := turn''
    -- JS: require_player_movement cancels the turn before win/checkpoint/again.
    if game.requirePlayerMovement && playerPositions.size > 0
        && !playerMovementDetected game board playerPositions then
      return (turnBackup, false)
    let mut winning := evaluateWinConditions game board
    if turn.commandQueue.contains .win then
      winning := true
    let mut s := { session with board, winning, rng := turn.rng }
    let (s', againPending) ← processCommandQueue game turnBackup s turn skipAgainProbe
    s := s'
    -- Undo stack is updated in `replay` after again settles (JS player-input frames only).
    s := sessionAfterWinAdvance game s
    pure (s, againPending)
end

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

def stepOneInput (game : Game) (session : Session) (inputIdx : Int) : Except String Session := do
  let input ←
    if inputIdx == 4 then pure InputToken.action
    else
      match Dir4.ofInputIndex? inputIdx with
      | some d => pure (.move d)
      | none => throw s!"invalid movement input index: {inputIdx}"
  let (s, _) ← executeTurn game session input
  pure s

def stepInputToken (game : Game) (session : Session) (tok : String) : Except String Session := do
  let input ← parseMovementInputToken tok
  let (s, _) ← executeTurn game session input
  pure s

end PuzzleScript

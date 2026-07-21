import PuzzleScript.Board
import PuzzleScript.BitVec
import PuzzleScript.IR
import PuzzleScript.Rules

namespace PuzzleScript

/-! Column-major tile index (matches JS `level` storage: `x * height + y`). -/

def Board.runtimeTile (b : Board) (x y : Nat) : Nat :=
  x * b.height + y

def Board.tileCol (b : Board) (tile : Nat) : Nat :=
  tile / b.height

def Board.tileRow (b : Board) (tile : Nat) : Nat :=
  tile % b.height

def ruleDirectionDelta (direction height : Nat) : Int :=
  let h := Int.ofNat height
  let d := UInt32.ofNat direction
  let d0 := Int.ofNat (d &&& 1).toNat
  let d1 := Int.ofNat ((d >>> 1) &&& 1).toNat
  let d2 := Int.ofNat ((d >>> 2) &&& 1).toNat
  let d3 := Int.ofNat ((d >>> 3) &&& 1).toNat
  (d3 - d2) * h + (d1 - d0)

/-- JS `processInput` direction index → movement bit mask (before layer shift). -/
def dirInputToLayerBits (dir : Int) : Option UInt32 :=
  match dir with
  | 0 => some 1
  | 1 => some 4
  | 2 => some 2
  | 3 => some 8
  | 4 => some 16
  | _ => none

def dirDelta (dirBits : UInt32) : Option (Int × Int) :=
  if dirBits == 1 then some (0, -1)
  else if dirBits == 2 then some (0, 1)
  else if dirBits == 4 then some (-1, 0)
  else if dirBits == 8 then some (1, 0)
  else none

def parseMovementInputToken (tok : String) : Except String Int :=
  if tok == "undo" then
    throw "undo input not supported in Lean runtime subset"
  else if tok == "restart" then
    throw "restart input not supported in Lean runtime subset"
  else
    match tok.toInt? with
    | none => throw s!"invalid input token: {tok}"
    | some n =>
      if n < 0 || n > 4 then
        throw s!"input code out of range (expected 0..4): {tok}"
      else
        pure n

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

private def cellPatternMatches (b : Board) (tile : Nat) (pat : CellPattern) : Bool :=
  let objs := b.cellObjWords tile
  let movs := b.cellMovWords tile
  maskBitsSetIn pat.objectsPresent objs
    && maskNoBitsInCommon pat.objectsMissing objs
    && anyObjectsPresentMatch objs pat.anyObjectsPresent
    && maskBitsSetIn pat.movementsPresent movs
    && maskNoBitsInCommon pat.movementsMissing movs

private def applyCellReplacement (b : Board) (tile : Nat) (pat : CellPattern) : (Bool × Board) :=
  let oldObj := b.cellObjWords tile
  let oldMov := b.cellMovWords tile
  let newObj := maskApplyReplacement oldObj pat.objectsClear pat.objectsSet
  let movClear := maskOr pat.movementsClear pat.movementsLayerMask
  let newMov := maskApplyReplacement oldMov movClear pat.movementsSet
  if newObj == oldObj && newMov == oldMov then
    (false, b)
  else
    let b1 := b.setCellObjWords tile newObj
    let b2 := b1.setCellMovWords tile newMov
    (true, b2)

private def rowPatternMatches (b : Board) (startTile : Nat) (delta : Int) (cells : Array CellPattern) : Bool :=
  Id.run do
    let mut idx : Int := Int.ofNat startTile
    for cell in cells do
      if idx < 0 then
        return false
      let t := idx.toNat
      if t >= b.nTiles then
        return false
      if !cellPatternMatches b t cell then
        return false
      idx := idx + delta
    pure true

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

private def findRowMatchStarts (b : Board) (rule : Rule) : Array Nat :=
  let delta := ruleDirectionDelta rule.direction b.height
  let cells := rule.cells
  if cells.isEmpty then
    #[]
  else
    let bounds := scanBoundsForRule b rule.direction cells.size
    Id.run do
      let mut out : Array Nat := #[]
      if bounds.horizontal then
        for y in [bounds.ymin:bounds.ymax] do
          let mut i := bounds.xmin * b.height + y
          for _x in [bounds.xmin:bounds.xmax] do
            if rowPatternMatches b i delta cells then
              out := out.push i
            i := i + b.height
      else
        for x in [bounds.xmin:bounds.xmax] do
          let mut i := x * b.height + bounds.ymin
          for _y in [bounds.ymin:bounds.ymax] do
            if rowPatternMatches b i delta cells then
              out := out.push i
            i := i + 1
      pure out

private def applyRuleAt (b : Board) (rule : Rule) (startTile : Nat) (recheck : Bool) : (Bool × Board) :=
  let delta := ruleDirectionDelta rule.direction b.height
  if recheck && !rowPatternMatches b startTile delta rule.cells then
    (false, b)
  else
    Id.run do
      let mut board := b
      let mut changed := false
      let mut idx : Int := Int.ofNat startTile
      for cell in rule.cells do
        let t := idx.toNat
        let (c, b') := applyCellReplacement board t cell
        changed := changed || c
        board := b'
        idx := idx + delta
      pure (changed, board)

def tryApplyRule (_game : Game) (b : Board) (rule : Rule) : (Bool × Board) :=
  let starts := findRowMatchStarts b rule
  if starts.isEmpty then
    (false, b)
  else
    Id.run do
      let mut board := b
      let mut any := false
      for i in [:starts.size] do
        let start := starts[i]!
        let recheck := i > 0
        let (c, b') := applyRuleAt board rule start recheck
        any := any || c
        board := b'
      pure (any, board)

private def applyRuleGroup (game : Game) (b : Board) (group : Array Rule) : Except String (Bool × Board) := do
  let maxLoops := 1000
  let mut board := b
  let mut groupChanged := false
  let mut loopCount := 0
  let mut madeChangeThisLoop := true
  while madeChangeThisLoop && loopCount < maxLoops do
    madeChangeThisLoop := false
    loopCount := loopCount + 1
    let mut consecutiveFailures := 0
    for rule in group do
      let (changed, b') := tryApplyRule game board rule
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
  if loopCount >= maxLoops then
    throw "rule group exceeded iteration cap"
  pure (groupChanged, board)

def applyRules (game : Game) (b : Board) (groups : Array (Array Rule)) : Except String (Bool × Board) := do
  let mut board := b
  let mut any := false
  for group in groups do
    let (changed, b') ← applyRuleGroup game board group
    any := any || changed
    board := b'
  pure (any, board)

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

private def getLayerMovementBits (mov : MaskWords) (layer : Nat) : UInt32 :=
  let shift := 5 * layer
  if shift >= 32 then 0 else
    (maskWord mov 0 >>> UInt32.ofNat shift) &&& 31

private def setLayerMovementBits (mov : MaskWords) (layer : Nat) (bits : UInt32) : MaskWords :=
  let shift := 5 * layer
  let clearMask : UInt32 := (31 : UInt32) <<< UInt32.ofNat shift
  let old := maskWord mov 0
  let cleared := old &&& (~~~clearMask)
  let next := cleared ||| ((bits &&& 31) <<< UInt32.ofNat shift)
  if mov.isEmpty then #[next] else mov.set! 0 next

private def clearLayerMovementBits (mov : MaskWords) (layer : Nat) : MaskWords :=
  setLayerMovementBits mov layer 0

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

def startMovement (game : Game) (b : Board) (dirMask : UInt32) : Board :=
  Id.run do
    let mut board := b
    for tile in [:b.nTiles] do
      if maskAnyMatchesAtTile board game.playerMask tile then
        board := moveEntitiesAtIndex game board tile game.playerMask dirMask
    pure board

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

def resolveMovements (game : Game) (b : Board) : Board :=
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
    for tile in [:board.nTiles] do
      let mov := board.cellMovWords tile
      if maskAnyBits mov then
        board := board.setCellMovWords tile (Id.run do
          let mut m := mov
          for layer in [:game.layerCount] do
            m := clearLayerMovementBits m layer
          pure m)
    pure board

private def winConditionPasses (b : Board) (wc : WinCondition) : Bool :=
  let n := b.nTiles
  if wc.quantifier == 1 then
    Id.run do
      for tile in [:n] do
        if maskAnyMatchesAtTile b wc.filter1 tile then
          if !maskAnyMatchesAtTile b wc.filter2 tile then
            return false
      pure true
  else if wc.quantifier == -1 then
    Id.run do
      for tile in [:n] do
        if maskAnyMatchesAtTile b wc.filter1 tile && maskAnyMatchesAtTile b wc.filter2 tile then
          return false
      pure true
  else if wc.quantifier == 0 then
    Id.run do
      for tile in [:n] do
        if maskAnyMatchesAtTile b wc.filter1 tile && maskAnyMatchesAtTile b wc.filter2 tile then
          return true
      pure false
  else
    false

def evaluateWinConditions (game : Game) (b : Board) : Bool :=
  if game.winConditions.isEmpty then
    false
  else
    game.winConditions.all (winConditionPasses b)

def executeTurn (game : Game) (session : Session) (inputIdx : Int) : Except String Session := do
  let mut board := session.board.clearMovements
  if inputIdx >= 0 then
    let dirMask ← match dirInputToLayerBits inputIdx with
      | none => throw s!"invalid movement input index: {inputIdx}"
      | some m => pure m
    board := startMovement game board dirMask
  let (_, board') ← applyRules game board game.rules
  board := resolveMovements game board'
  if !game.lateRules.isEmpty then
    let (_, board'') ← applyRules game board game.lateRules
    board := board''
    if board.movements.any (· != 0) then
      board := resolveMovements game board
  let winning := evaluateWinConditions game board
  let session' := { session with board, winning }
  pure (sessionAfterWinAdvance game session')

def replay (game : Game) (session : Session) (inputs : Array String) : Except String Session := do
  let mut s := session
  for tok in inputs do
    let idx ← parseMovementInputToken tok
    s ← executeTurn game s idx
  pure s

def stepOneInput (game : Game) (session : Session) (inputIdx : Int) : Except String Session :=
  executeTurn game session inputIdx

def stepInputToken (game : Game) (session : Session) (tok : String) : Except String Session := do
  let idx ← parseMovementInputToken tok
  executeTurn game session idx

end PuzzleScript

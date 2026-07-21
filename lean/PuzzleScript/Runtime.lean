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

inductive InputToken where
  | movement (idx : Int)
  | undo
  | restart
  | tick
  deriving Repr

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
      if n < 0 || n > 4 then
        throw s!"input code out of range (expected 0..4): {tok}"
      else
        pure (.movement n)

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

private def cellPatternMatches (b : Board) (tile : Nat) (pat : CellPattern) : Bool :=
  let objs := b.cellObjWords tile
  let movs := b.cellMovWords tile
  maskBitsSetIn pat.objectsPresent objs
    && maskNoBitsInCommon pat.objectsMissing objs
    && anyObjectsPresentMatch objs pat.anyObjectsPresent
    && anyMovementsPresentMatch movs pat.anyMovementsPresent
    && maskBitsSetIn pat.movementsPresent movs
    && maskNoBitsInCommon pat.movementsMissing movs

private def applyCellReplacement (b : Board) (tile : Nat) (pat : CellPattern) : (Bool × Board) :=
  if !pat.hasReplacement then
    (false, b)
  else
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

private def ellipsisKMax (b : Board) (direction : Nat) (x y : Nat) (len : Nat) : Nat :=
  if direction == 4 then
    if x + 1 >= len then x - len + 2 else 0
  else if direction == 8 then
    b.width - (x + len) + 1
  else if direction == 2 then
    b.height - (y + len) + 1
  else if direction == 1 then
    if y + 1 >= len then y - len + 2 else 0
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

private def findRowMatches (b : Board) (rule : Rule) (rowIndex : Nat) : Array RowMatch :=
  let row := rule.patternRows.getD rowIndex #[]
  let ec := rule.ellipsisCounts.getD rowIndex 0
  let delta := ruleDirectionDelta rule.direction b.height
  if ec == 0 then findFixedRowMatches b rule.direction delta row
  else if ec == 1 then findEllipsis1RowMatches b rule.direction delta row
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

private def applyRowAt (b : Board) (delta : Int) (row : Array PatternCell) (rm : RowMatch) : (Bool × Board) :=
  Id.run do
    let mut board := b
    let mut changed := false
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
        let (c, b') := applyCellReplacement board t pat
        changed := changed || c
        board := b'
        idx := idx + delta
    pure (changed, board)

private def tupleStillMatches (b : Board) (rule : Rule) (tuple : Array RowMatch) : Bool :=
  let delta := ruleDirectionDelta rule.direction b.height
  tuple.size == rule.patternRows.size &&
    (tuple.zip rule.patternRows).all fun (rm, row) =>
      match rm with
      | .fixed s => rowCellsMatchFixed b s delta row
      | .ellipsis1 s g => rowCellsMatchEllipsis1 b s g delta row
      | .ellipsis2 .. => false

private def applyRuleTuple (b : Board) (rule : Rule) (tuple : Array RowMatch) (recheck : Bool) : (Bool × Board) :=
  if recheck && !tupleStillMatches b rule tuple then
    (false, b)
  else
    let delta := ruleDirectionDelta rule.direction b.height
    Id.run do
      let mut board := b
      let mut changed := false
      for ri in [:tuple.size] do
        let row := rule.patternRows[ri]!
        let (c, b') := applyRowAt board delta row (tuple.getD ri default)
        changed := changed || c
        board := b'
      pure (changed, board)

private def isSfxCommand (cmd : String) : Bool :=
  cmd.startsWith "sfx"

private def mergeCommands (existing newCmds : Array String) : Array String :=
  if newCmds.any (· == "cancel") then #["cancel"]
  else if newCmds.any (· == "restart") then #["restart"]
  else
    Id.run do
      let mut out := existing
      for c in newCmds do
        unless isSfxCommand c || c == "cancel" || c == "restart" || out.contains c do
          out := out.push c
      pure out

structure TurnState where
  commandQueue : Array String
  modified : Bool
  againPending : Bool
  deriving Repr

def TurnState.initial : TurnState := { commandQueue := #[], modified := false, againPending := false }

def tryApplyRule (_game : Game) (b : Board) (rule : Rule) (st : TurnState) : (Bool × Board × TurnState) :=
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
      cmdQ := mergeCommands cmdQ rule.commands
      for h : ti in [:tuples.size] do
        let tuple := tuples[ti]!
        let recheck := ti > 0
        let (c, b') := applyRuleTuple board rule tuple recheck
        any := any || c
        board := b'
      let modified := turn.modified || any || !rule.commands.isEmpty
      pure (any, board, { turn with commandQueue := cmdQ, modified := modified })

private def applyRuleGroup (game : Game) (b : Board) (group : Array Rule) (st : TurnState) : Except String (Bool × Board × TurnState) := do
  let maxLoops := 1000
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
  if loopCount >= maxLoops then
    throw "rule group exceeded iteration cap"
  pure (groupChanged, board, turn)

private def applyRulesWithLoops (game : Game) (b : Board) (groups : Array (Array Rule)) (loopPoint : Array (Option Nat)) (st : TurnState) : Except String (Bool × Board × TurnState) := do
  let mut board := b
  let mut turn := st
  let mut rulesChanged := false
  let mut ruleGroupIndex := 0
  let mut loopPropagated := false
  let mut loopCount := 0
  let rulesCount := groups.size
  while ruleGroupIndex < rulesCount do
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
      let playerHere :=
        if game.playerMaskAggregate then
          maskAggregateMatchesAtTile board game.playerMask tile
        else
          maskAnyMatchesAtTile board game.playerMask tile
      if playerHere then
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

private def processCommandQueue (game : Game) (turnBackup : Session) (session : Session) (turn : TurnState) : Except String (Session × Bool) := do
  let cmds := turn.commandQueue
  if cmds.contains "cancel" then
    return (turnBackup, false)
  let mut s := session
  if cmds.contains "restart" then
    if let some rb := s.restartBoard then
      s := { s with board := rb.clearMovements, undoBackups := s.undoBackups.push (s.board, s.currentLevel, s.winning) }
  let winning := s.winning || cmds.contains "win" || evaluateWinConditions game s.board
  s := { s with winning }
  let againPending := cmds.contains "again" && turn.modified
  return (s, againPending)

def executeTurn (game : Game) (session : Session) (input : InputToken) : Except String (Session × Bool) := do
  match input with
  | .undo =>
    match session.undoBackups.back? with
    | none => pure (session, false)
    | some (board, lvl, win) =>
      let backups := session.undoBackups.extract 0 (session.undoBackups.size - 1)
      pure ({ session with board := board.clearMovements, currentLevel := lvl, winning := win, undoBackups := backups }, false)
  | .restart =>
    let s :=
      match session.restartBoard with
      | some rb => { session with board := rb.clearMovements, undoBackups := session.undoBackups.push (session.board, session.currentLevel, session.winning) }
      | none => session
    pure (s, false)
  | .tick | .movement _ =>
    let turnBackup := session
    let mut board := session.board.clearMovements
    let mut turn := TurnState.initial
    if let .movement idx := input then
      if idx >= 0 then
        let dirMask ← match dirInputToLayerBits idx with
          | none => throw s!"invalid movement input index: {idx}"
          | some m => pure m
        board := startMovement game board dirMask
    let (_, board', turn') ← applyRulesWithLoops game board game.rules game.loopPoint turn
    board := resolveMovements game board'
    turn := turn'
    if !game.lateRules.isEmpty then
      let (_, board'', turn'') ← applyRulesWithLoops game board game.lateRules game.lateLoopPoint turn
      board := board''
      turn := turn''
      if board.movements.any (· != 0) then
        board := resolveMovements game board
    let mut winning := evaluateWinConditions game board
    if turn.commandQueue.contains "win" then
      winning := true
    let mut s := { session with board, winning }
    let (s', againPending) ← processCommandQueue game turnBackup s turn
    s := s'
    if boardsDiffer turnBackup.board s.board || turn.modified then
      s := { s with undoBackups := s.undoBackups.push (turnBackup.board, turnBackup.currentLevel, turnBackup.winning) }
    s := sessionAfterWinAdvance game s
    pure (s, againPending)

def replay (game : Game) (session : Session) (inputs : Array String) : Except String Session := do
  let mut s := session
  for tok in inputs do
    let input ← parseMovementInputToken tok
    let (s', againPending) ← executeTurn game s input
    s := s'
    let mut again := againPending
    while again do
      let (s'', again') ← executeTurn game s (.tick)
      s := s''
      again := again'
  pure s

def stepOneInput (game : Game) (session : Session) (inputIdx : Int) : Except String Session := do
  let (s, _) ← executeTurn game session (.movement inputIdx)
  pure s

def stepInputToken (game : Game) (session : Session) (tok : String) : Except String Session := do
  let input ← parseMovementInputToken tok
  let (s, _) ← executeTurn game session input
  pure s

end PuzzleScript

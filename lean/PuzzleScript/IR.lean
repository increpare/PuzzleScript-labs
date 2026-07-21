import Lean.Data.Json
import PuzzleScript.Board
import PuzzleScript.Serialize
import PuzzleScript.Rules
open Lean

namespace PuzzleScript

/-- Playable grid level, or a message screen between levels (JS `kind: "message"`). -/
inductive LevelEntry where
  | playable (width height layerCount : Nat) (objects : Array UInt32)
  | message (text : String)
  deriving Repr

def LevelEntry.isPlayable : LevelEntry → Bool
  | .playable .. => true
  | .message _ => false

structure Game where
  idDict : Array String
  objectCount : Nat
  strideObj : Nat
  strideMov : Nat
  layerCount : Nat
  playerMask : MaskWords
  playerMaskAggregate : Bool
  objectLayers : Array Nat
  rules : Array (Array Rule)
  lateRules : Array (Array Rule)
  /-- Sparse loop map: index is rule group index (may equal `rules.length` for end-loop). -/
  loopPoint : Array (Option Nat)
  lateLoopPoint : Array (Option Nat)
  winConditions : Array WinCondition
  levels : Array LevelEntry
  deriving Repr

structure Session where
  board : Board
  winning : Bool
  currentLevel : Nat
  undoBackups : Array (Board × Nat × Bool)
  restartBoard : Option Board
  deriving Repr

private def jsonGetInt (j : Json) (ctx : String) : Except String Int :=
  j.getInt?.mapError fun _ => ctx

private def int32Min : Int := -2147483648
private def int32Max : Int := 2147483647

private def intToUInt32 (i : Int) (ctx : String) : Except String UInt32 := do
  if i < int32Min || i > int32Max then
    throw s!"{ctx}: integer out of Int32 range: {i}"
  pure (UInt32.ofBitVec (BitVec.ofInt 32 i))

private def jsonGetUInt32 (j : Json) (ctx : String) : Except String UInt32 := do
  let i ← jsonGetInt j ctx
  intToUInt32 i ctx

private def parseStringArray (j : Json) (ctx : String) : Except String (Array String) := do
  let arr ← (Json.getArr? j).mapError fun e => s!"{ctx}: {e}"
  arr.mapM fun elt =>
    match elt with
    | .str s => pure s
    | _ => throw s!"{ctx}: expected string array element"

private def parseUInt32Array (j : Json) (ctx : String) : Except String (Array UInt32) := do
  let arr ← (Json.getArr? j).mapError fun e => s!"{ctx}: {e}"
  arr.mapM fun elt => jsonGetUInt32 elt ctx

private def parseMaskWords (j : Json) (ctx : String) : Except String MaskWords :=
  parseUInt32Array j ctx

private def jsonArrayNonempty (j : Json) (ctx : String) : Except String Bool := do
  let arr ← (Json.getArr? j).mapError fun _ => s!"{ctx}: expected array"
  pure (arr.size > 0)

private def parseMaskWordsArray (j : Json) (ctx : String) : Except String (Array MaskWords) := do
  let arr ← (Json.getArr? j).mapError fun e => s!"{ctx}: {e}"
  arr.mapIdxM fun i elt => parseMaskWords elt s!"{ctx}[{i}]"

private def emptyMask : MaskWords := #[]

private def parseReplacementFields (repl : Json) (ctx : String) : Except String (MaskWords × MaskWords × MaskWords × MaskWords × MaskWords) := do
  let objectsClear ← parseMaskWords (← (repl.getObjVal? "objects_clear").mapError toString) s!"{ctx}.objects_clear"
  let objectsSet ← parseMaskWords (← (repl.getObjVal? "objects_set").mapError toString) s!"{ctx}.objects_set"
  let movementsClear ← parseMaskWords (← (repl.getObjVal? "movements_clear").mapError toString) s!"{ctx}.movements_clear"
  let movementsSet ← parseMaskWords (← (repl.getObjVal? "movements_set").mapError toString) s!"{ctx}.movements_set"
  let movementsLayerMask ←
    match repl.getObjVal? "movements_layer_mask" with
    | .ok j => parseMaskWords j s!"{ctx}.replacement.movements_layer_mask"
    | .error _ => pure #[0]
  pure (objectsClear, objectsSet, movementsClear, movementsSet, movementsLayerMask)

private def parseCellPattern (j : Json) (ctx : String) : Except String CellPattern := do
  let kind ← (j.getObjValAs? String "kind").mapError fun _ => s!"{ctx}: missing kind"
  if kind != "cell_pattern" then
    throw s!"{ctx}: unsupported cell kind {kind}"
  let lcm ← (j.getObjVal? "layer_coupled_movement_masks").mapError fun _ => s!"{ctx}: missing layer_coupled_movement_masks"
  if (← jsonArrayNonempty lcm s!"{ctx}.layer_coupled_movement_masks") then
    throw s!"{ctx}: layer_coupled_movement_masks not supported"
  let objectsPresent ← parseMaskWords (← (j.getObjVal? "objects_present").mapError toString) s!"{ctx}.objects_present"
  let objectsMissing ← parseMaskWords (← (j.getObjVal? "objects_missing").mapError toString) s!"{ctx}.objects_missing"
  let anyObjectsPresent ←
    parseMaskWordsArray (← (j.getObjVal? "any_objects_present").mapError toString) s!"{ctx}.any_objects_present"
  let anyMovementsPresent ←
    parseMaskWordsArray (← (j.getObjVal? "any_movements_present").mapError toString) s!"{ctx}.any_movements_present"
  let movementsPresent ← parseMaskWords (← (j.getObjVal? "movements_present").mapError toString) s!"{ctx}.movements_present"
  let movementsMissing ← parseMaskWords (← (j.getObjVal? "movements_missing").mapError toString) s!"{ctx}.movements_missing"
  let (hasReplacement, objectsClear, objectsSet, movementsClear, movementsSet, movementsLayerMask) ←
    match j.getObjVal? "replacement" with
    | .error _ =>
      pure (false, emptyMask, emptyMask, emptyMask, emptyMask, #[0])
    | .ok repl =>
      if repl == Json.null then
        pure (false, emptyMask, emptyMask, emptyMask, emptyMask, #[0])
      else
        let (oc, os, mc, ms, mlm) ← parseReplacementFields repl s!"{ctx}.replacement"
        pure (true, oc, os, mc, ms, mlm)
  pure {
    objectsPresent, objectsMissing, anyObjectsPresent, anyMovementsPresent
    movementsPresent, movementsMissing
    hasReplacement, objectsClear, objectsSet, movementsClear, movementsSet, movementsLayerMask
  }

private def parsePatternCell (j : Json) (ctx : String) : Except String PatternCell := do
  let kind ← (j.getObjValAs? String "kind").mapError fun _ => s!"{ctx}: missing kind"
  if kind == "ellipsis" then
    pure (.ellipsis)
  else if kind == "cell_pattern" then
    let cp ← parseCellPattern j ctx
    pure (.cell cp)
  else
    throw s!"{ctx}: unsupported pattern cell kind {kind}"

private def parseCommandName (j : Json) (ctx : String) : Except String String :=
  match j with
  | Json.str s => pure s
  | Json.arr arr =>
    match arr[0]? with
    | some (Json.str s) => pure s
    | _ => throw s!"{ctx}: expected command string or [string, ...]"
  | _ => throw s!"{ctx}: expected command string or array"

private def parseCommands (j : Json) (ctx : String) : Except String (Array String) := do
  let arr ← (Json.getArr? j).mapError fun e => s!"{ctx}: {e}"
  arr.mapIdxM fun i elt => parseCommandName elt s!"{ctx}[{i}]"

private def parseRule (j : Json) (ctx : String) : Except String Rule := do
  let isRandom ← (j.getObjValAs? Bool "is_random").mapError fun _ => s!"{ctx}: missing is_random"
  if isRandom then
    throw s!"{ctx}: is_random rules not supported"
  let rigid ← (j.getObjValAs? Bool "rigid").mapError fun _ => s!"{ctx}: missing rigid"
  if rigid then
    throw s!"{ctx}: rigid rules not supported"
  let ellipsisJson ← (j.getObjVal? "ellipsis_count").mapError fun _ => s!"{ctx}: missing ellipsis_count"
  let ellipsisArr ← (Json.getArr? ellipsisJson).mapError fun e => s!"{ctx}.ellipsis_count: {e}"
  let ellipsisCounts ← ellipsisArr.mapIdxM fun i elt =>
    jsonGetInt elt s!"{ctx}.ellipsis_count[{i}]" |>.map Int.toNat
  let propBind ← (j.getObjVal? "property_bindings").mapError fun _ => s!"{ctx}: missing property_bindings"
  if (← jsonArrayNonempty propBind s!"{ctx}.property_bindings") then
    throw s!"{ctx}: property_bindings not supported"
  let aggrBind ← (j.getObjVal? "aggregate_bindings").mapError fun _ => s!"{ctx}: missing aggregate_bindings"
  if (← jsonArrayNonempty aggrBind s!"{ctx}.aggregate_bindings") then
    throw s!"{ctx}: aggregate_bindings not supported"
  let commands ← parseCommands (← (j.getObjVal? "commands").mapError fun _ => s!"{ctx}: missing commands") s!"{ctx}.commands"
  let patterns ← (j.getObjVal? "patterns").mapError fun _ => s!"{ctx}: missing patterns"
  let patternRowsJson ← (Json.getArr? patterns).mapError fun e => s!"{ctx}.patterns: {e}"
  if patternRowsJson.size != ellipsisCounts.size then
    throw s!"{ctx}: patterns rows {patternRowsJson.size} != ellipsis_count {ellipsisCounts.size}"
  let patternRows ← patternRowsJson.mapIdxM fun ri rowJ => do
    let cellsJson ← (Json.getArr? rowJ).mapError fun e => s!"{ctx}.patterns[{ri}]: {e}"
    cellsJson.mapIdxM fun ci cellJ => parsePatternCell cellJ s!"{ctx}.patterns[{ri}][{ci}]"
  let direction ← (j.getObjValAs? Nat "direction").mapError fun _ => s!"{ctx}: missing direction"
  let lineNumber ← (j.getObjValAs? Nat "line_number").mapError fun _ => s!"{ctx}: missing line_number"
  let groupNumber ← (j.getObjValAs? Nat "group_number").mapError fun _ => s!"{ctx}: missing group_number"
  pure { direction, lineNumber, groupNumber, patternRows, ellipsisCounts, commands, rigid, isRandom }

private def parseRuleGroup (j : Json) (ctx : String) : Except String (Array Rule) := do
  let arr ← (Json.getArr? j).mapError fun e => s!"{ctx}: {e}"
  arr.mapIdxM fun i ruleJ => parseRule ruleJ s!"{ctx}[{i}]"

private def parseRuleGroups (j : Json) (ctx : String) : Except String (Array (Array Rule)) := do
  let groups ← (Json.getArr? j).mapError fun e => s!"{ctx}: {e}"
  groups.mapIdxM fun gi groupJ => parseRuleGroup groupJ s!"{ctx}[{gi}]"

private def parseLoopPointMap (j : Json) (ctx : String) (groupCount : Nat) : Except String (Array (Option Nat)) := do
  let obj ← (j.getObj?).mapError fun _ => s!"{ctx}: expected object"
  let mut maxIdx := groupCount
  let mut points : Array (Option Nat) := Array.replicate (groupCount + 1) none
  for (k, v) in obj do
    let gi ← match k.toNat? with
      | some n => pure n
      | none => throw s!"{ctx}: non-integer loop_point key {k}"
    let target ← jsonGetInt v s!"{ctx}[{k}]" |>.map Int.toNat
    if gi > maxIdx then
      maxIdx := gi
    while points.size ≤ gi do
      points := points.push none
    points := points.set! gi (some target)
  if maxIdx > groupCount then
    while points.size ≤ maxIdx do
      points := points.push none
  pure points

private def parseWinCondition (j : Json) (ctx : String) : Except String WinCondition := do
  let quantifier ← jsonGetInt (← (j.getObjVal? "quantifier").mapError fun _ => s!"{ctx}: missing quantifier") s!"{ctx}.quantifier"
  let filter1 ← parseMaskWords (← (j.getObjVal? "filter1").mapError toString) s!"{ctx}.filter1"
  let filter2 ← parseMaskWords (← (j.getObjVal? "filter2").mapError toString) s!"{ctx}.filter2"
  let aggr1 ← (j.getObjValAs? Bool "aggr1").mapError fun _ => s!"{ctx}: missing aggr1"
  let aggr2 ← (j.getObjValAs? Bool "aggr2").mapError fun _ => s!"{ctx}: missing aggr2"
  pure { quantifier, filter1, filter2, aggr1, aggr2 }

private def parseWinConditions (j : Json) (ctx : String) : Except String (Array WinCondition) := do
  let arr ← (Json.getArr? j).mapError fun e => s!"{ctx}: {e}"
  arr.mapIdxM fun i wcJ => parseWinCondition wcJ s!"{ctx}[{i}]"

private def parseObjectLayers (j : Json) (objectCount : Nat) (ctx : String) : Except String (Array Nat) := do
  let arr ← (Json.getArr? j).mapError fun e => s!"{ctx}: {e}"
  let mut layers := Array.replicate objectCount 0
  for h : i in [:arr.size] do
    let elt := arr[i]
    let id ← (elt.getObjValAs? Nat "id").mapError fun _ => s!"{ctx}[{i}]: missing id"
    let layer ← (elt.getObjValAs? Nat "layer").mapError fun _ => s!"{ctx}[{i}]: missing layer"
    if id >= objectCount then
      throw s!"{ctx}[{i}]: object id {id} out of range (object_count={objectCount})"
    layers := layers.set! id layer
  pure layers

private def parseLevelEntry (j : Json) (ctx : String) (strideObj : Nat) : Except String LevelEntry := do
  let kind ← (j.getObjValAs? String "kind").mapError fun _ => s!"{ctx}: missing kind"
  match kind with
  | "message" =>
    let text ← (j.getObjValAs? String "message").mapError fun _ => s!"{ctx}: message level missing message"
    pure (.message text)
  | "level" => do
    let width ← (j.getObjValAs? Nat "width").mapError toString
    let height ← (j.getObjValAs? Nat "height").mapError toString
    let layerCount ← (j.getObjValAs? Nat "layer_count").mapError toString
    let objectsJson ← (j.getObjVal? "objects").mapError toString
    let objects ← parseUInt32Array objectsJson s!"{ctx}.objects"
    let nTiles := width * height
    let expectedObjLen := nTiles * strideObj
    if objects.size != expectedObjLen then
      throw s!"{ctx}.objects: length {objects.size}, expected {expectedObjLen}"
    pure (.playable width height layerCount objects)
  | other =>
    throw s!"{ctx}: unsupported level kind {other}"

private def parseLevels (j : Json) (ctx : String) (strideObj : Nat) : Except String (Array LevelEntry) := do
  let arr ← (Json.getArr? j).mapError fun e => s!"{ctx}: {e}"
  arr.mapIdxM fun i lvlJ => parseLevelEntry lvlJ s!"{ctx}[{i}]" strideObj

def boardFromPlayable (game : Game) (width height layerCount : Nat) (objects : Array UInt32) : Board :=
  let nTiles := width * height
  { width, height
    layerCount := layerCount
    strideObj := game.strideObj
    strideMov := game.strideMov
    objects
    movements := Array.replicate (nTiles * game.strideMov) 0 }

private def parseRestartBoard (j : Json) (game : Game) (ctx : String) : Except String Board := do
  let width ← (j.getObjValAs? Nat "width").mapError fun _ => s!"{ctx}: missing width"
  let height ← (j.getObjValAs? Nat "height").mapError fun _ => s!"{ctx}: missing height"
  let objectsJson ← (j.getObjVal? "objects").mapError fun _ => s!"{ctx}: missing objects"
  let objects ← parseUInt32Array objectsJson s!"{ctx}.objects"
  let nTiles := width * height
  let expectedObjLen := nTiles * game.strideObj
  if objects.size != expectedObjLen then
    throw s!"{ctx}.objects: length {objects.size}, expected {expectedObjLen}"
  pure (boardFromPlayable game width height game.layerCount objects)

def sessionAfterWinAdvance (game : Game) (session : Session) : Session :=
  if !session.winning then
    session
  else
    Id.run do
      let mut idx := session.currentLevel + 1
      while idx < game.levels.size do
        match game.levels[idx]? with
        | some (.playable w h lc objs) =>
          return {
            session with
            board := boardFromPlayable game w h lc objs
            currentLevel := idx
            winning := false
          }
        | some (.message _) =>
          idx := idx + 1
        | none =>
          break
      pure session

def loadPreparedSerializedLevel (root : Json) : Except String String := do
  let ps ← (root.getObjVal? "prepared_session").mapError toString
  (ps.getObjValAs? String "serialized_level").mapError toString

private def parseGame (j : Json) : Except String Game := do
  let game ← (j.getObjVal? "game").mapError toString
  let idDict ← parseStringArray (← (game.getObjVal? "id_dict").mapError toString) "game.id_dict"
  let objectCount ← (game.getObjValAs? Nat "object_count").mapError toString
  let strides ← (game.getObjVal? "strides").mapError toString
  let strideObj ← (strides.getObjValAs? Nat "object").mapError toString
  let strideMov ← (strides.getObjValAs? Nat "movement").mapError toString
  let layerCount ← (strides.getObjValAs? Nat "layers").mapError toString
  let pm ← (game.getObjVal? "player_mask").mapError toString
  let maskJson ← (pm.getObjVal? "mask").mapError toString
  let playerMask ← parseUInt32Array maskJson "game.player_mask.mask"
  let playerMaskAggregate ← (pm.getObjValAs? Bool "aggregate").mapError fun _ => "game.player_mask: missing aggregate"
  let objectsJson ← (game.getObjVal? "objects").mapError toString
  let objectLayers ← parseObjectLayers objectsJson objectCount "game.objects"
  let rulesJson ← (game.getObjVal? "rules").mapError toString
  let rules ← parseRuleGroups rulesJson "game.rules"
  let lateRulesJson ← (game.getObjVal? "late_rules").mapError toString
  let lateRules ← parseRuleGroups lateRulesJson "game.late_rules"
  let loopPoint ←
    match game.getObjVal? "loop_point" with
    | .ok lp => parseLoopPointMap lp "game.loop_point" rules.size
    | .error _ => pure (Array.replicate (rules.size + 1) none)
  let lateLoopPoint ←
    match game.getObjVal? "late_loop_point" with
    | .ok lp => parseLoopPointMap lp "game.late_loop_point" lateRules.size
    | .error _ => pure (Array.replicate (lateRules.size + 1) none)
  let winJson ← (game.getObjVal? "winconditions").mapError toString
  let winConditions ← parseWinConditions winJson "game.winconditions"
  let levelsJson ← (game.getObjVal? "levels").mapError toString
  let levels ← parseLevels levelsJson "game.levels" strideObj
  pure {
    idDict, objectCount, strideObj, strideMov, layerCount, playerMask, playerMaskAggregate
    objectLayers, rules, lateRules, loopPoint, lateLoopPoint, winConditions, levels
  }

private def parseSession (j : Json) (game : Game) : Except String Session := do
  let ps ← (j.getObjVal? "prepared_session").mapError toString
  let winning ← (ps.getObjValAs? Bool "winning").mapError toString
  let currentLevel ←
    match ps.getObjValAs? Nat "current_level_index" with
    | .ok n => pure n
    | .error _ => pure 0
  let level ← (ps.getObjVal? "level").mapError toString
  let width ← (level.getObjValAs? Nat "width").mapError toString
  let height ← (level.getObjValAs? Nat "height").mapError toString
  let layerCount ← (level.getObjValAs? Nat "layer_count").mapError toString
  let objectsJson ← (level.getObjVal? "objects").mapError toString
  let objects ← parseUInt32Array objectsJson "prepared_session.level.objects"
  let nTiles := width * height
  let expectedObjLen := nTiles * game.strideObj
  if objects.size != expectedObjLen then
    throw s!"prepared_session.level.objects: length {objects.size}, expected {expectedObjLen}"
  let movements ←
    match level.getObjVal? "movements" with
    | .ok movJson => do
      let movs ← parseUInt32Array movJson "prepared_session.level.movements"
      let expectedMovLen := nTiles * game.strideMov
      if movs.size != expectedMovLen then
        throw s!"prepared_session.level.movements: length {movs.size}, expected {expectedMovLen}"
      else
        pure movs
    | .error _ => pure (Array.replicate (nTiles * game.strideMov) 0)
  let board : Board := {
    width, height
    layerCount := layerCount
    strideObj := game.strideObj
    strideMov := game.strideMov
    objects, movements
  }
  let restartBoard ←
    match ps.getObjVal? "restart_target" with
    | .ok rt => parseRestartBoard rt game "prepared_session.restart_target" |>.map some
    | .error _ => pure none
  pure { board, winning, currentLevel, undoBackups := #[], restartBoard }

def parseIrJson (root : Json) : Except String (Game × Session) := do
  let game ← parseGame root
  let session ← parseSession root game
  pure (game, session)

def loadIrFile (path : System.FilePath) : IO (Game × Session) := do
  let contents ← IO.FS.readFile path
  match Json.parse contents with
  | .error e => throw <| IO.userError s!"{path}: parse error: {e}"
  | .ok j =>
    match parseIrJson j with
    | .error e => throw <| IO.userError s!"{path}: schema error: {e}"
    | .ok pair => pure pair

end PuzzleScript
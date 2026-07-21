import Lean.Data.Json
import PuzzleScript.Board
import PuzzleScript.Serialize
open Lean

namespace PuzzleScript

structure Game where
  idDict : Array String
  objectCount : Nat
  strideObj : Nat
  strideMov : Nat
  layerCount : Nat
  playerMask : MaskWords
  deriving Repr

structure Session where
  board : Board
  winning : Bool
  deriving Repr

private def jsonGetInt (j : Json) (ctx : String) : Except String Int :=
  j.getInt?.mapError fun _ => ctx

private def int32Min : Int := -2147483648
private def int32Max : Int := 2147483647

/-- Interpret JSON integers as signed Int32 words (JS `Int32Array`), then as UInt32 bit patterns. -/
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
  pure {
    idDict, objectCount, strideObj, strideMov, layerCount, playerMask
  }

private def parseSession (j : Json) (game : Game) : Except String Session := do
  let ps ← (j.getObjVal? "prepared_session").mapError toString
  let winning ← (ps.getObjValAs? Bool "winning").mapError toString
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
  pure { board, winning }

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

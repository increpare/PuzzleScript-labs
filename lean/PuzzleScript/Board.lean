import PuzzleScript.BitVec
import PuzzleScript.Ids

namespace PuzzleScript

structure Board where
  width : Nat
  height : Nat
  layerCount : Nat
  strideObj : Nat
  strideMov : Nat
  objects : Array UInt32
  movements : Array UInt32
  rigidMovementAppliedMask : Array UInt32
  rigidGroupIndexMask : Array UInt32
  deriving Repr

def Board.nTiles (b : Board) : Nat := b.width * b.height

/-! Column-major tile index (matches JS `level` storage: `x * height + y`). -/

def Board.runtimeTile (b : Board) (x y : Nat) : Nat :=
  x * b.height + y

def Board.tileCol (b : Board) (tile : Nat) : Nat :=
  tile / b.height

def Board.tileRow (b : Board) (tile : Nat) : Nat :=
  tile % b.height

/-- Internal Nat-indexed accessors (private Runtime loops may call these). -/
def Board.cellObjWords (b : Board) (tile : Nat) : MaskWords :=
  let start := tile * b.strideObj
  b.objects.extract start (start + b.strideObj)

def Board.cellMovWords (b : Board) (tile : Nat) : MaskWords :=
  let start := tile * b.strideMov
  b.movements.extract start (start + b.strideMov)

/-- Public typed cell accessors (T1 boundary). -/
def Board.cellObjWordsAt (b : Board) (t : TileIdx) : MaskWords :=
  b.cellObjWords t.val

def Board.cellMovWordsAt (b : Board) (t : TileIdx) : MaskWords :=
  b.cellMovWords t.val

def Board.setCellObjWords (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  Id.run do
    let mut objs := b.objects
    for i in [:b.strideObj] do
      objs := objs.set! (tile * b.strideObj + i) (ws.getD i 0)
    pure { b with objects := objs }

def Board.setCellMovWords (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  Id.run do
    let mut mov := b.movements
    for i in [:b.strideMov] do
      mov := mov.set! (tile * b.strideMov + i) (ws.getD i 0)
    pure { b with movements := mov }

def Board.setCellObjWordsAt (b : Board) (t : TileIdx) (ws : MaskWords) : Board :=
  b.setCellObjWords t.val ws

def Board.setCellMovWordsAt (b : Board) (t : TileIdx) (ws : MaskWords) : Board :=
  b.setCellMovWords t.val ws

def Board.cellRigidMovementAppliedMask (b : Board) (tile : Nat) : MaskWords :=
  let start := tile * b.strideMov
  b.rigidMovementAppliedMask.extract start (start + b.strideMov)

def Board.setCellRigidMovementAppliedMask (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  Id.run do
    let mut arr := b.rigidMovementAppliedMask
    for i in [:b.strideMov] do
      arr := arr.set! (tile * b.strideMov + i) (ws.getD i 0)
    pure { b with rigidMovementAppliedMask := arr }

def Board.cellRigidGroupIndexMask (b : Board) (tile : Nat) : MaskWords :=
  let start := tile * b.strideMov
  b.rigidGroupIndexMask.extract start (start + b.strideMov)

def Board.setCellRigidGroupIndexMask (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  Id.run do
    let mut arr := b.rigidGroupIndexMask
    for i in [:b.strideMov] do
      arr := arr.set! (tile * b.strideMov + i) (ws.getD i 0)
    pure { b with rigidGroupIndexMask := arr }

def Board.clearMovements (b : Board) : Board :=
  { b with
    movements := Array.replicate (b.nTiles * b.strideMov) 0
    rigidMovementAppliedMask := Array.replicate (b.nTiles * b.strideMov) 0
    rigidGroupIndexMask := Array.replicate (b.nTiles * b.strideMov) 0 }

def Board.withClearedRigidMasks (b : Board) : Board :=
  { b with
    rigidMovementAppliedMask := Array.replicate (b.nTiles * b.strideMov) 0
    rigidGroupIndexMask := Array.replicate (b.nTiles * b.strideMov) 0 }

end PuzzleScript

import PuzzleScript.BitVec

namespace PuzzleScript

structure Board where
  width : Nat
  height : Nat
  layerCount : Nat
  strideObj : Nat
  strideMov : Nat
  /-- length = width * height * strideObj -/
  objects : Array UInt32
  /-- length = width * height * strideMov -/
  movements : Array UInt32
  deriving Repr

def Board.nTiles (b : Board) : Nat := b.width * b.height

def Board.cellObjWords (b : Board) (tile : Nat) : MaskWords :=
  let start := tile * b.strideObj
  b.objects.extract start (start + b.strideObj)

def Board.cellMovWords (b : Board) (tile : Nat) : MaskWords :=
  let start := tile * b.strideMov
  b.movements.extract start (start + b.strideMov)

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

def Board.clearMovements (b : Board) : Board :=
  { b with movements := Array.replicate (b.nTiles * b.strideMov) 0 }

end PuzzleScript

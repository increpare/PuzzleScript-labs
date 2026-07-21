import PuzzleScript.BitVec
import PuzzleScript.Board
import PuzzleScript.Dir4
import PuzzleScript.Ids
import PuzzleScript.IR

namespace PuzzleScript

/-!
Abstract views over mask `Board` (occupancy / pending movement).
No second board store — projections only.
Without Mathlib `Finset`, occupancy is a deduplicated `List ObjectId` (`ObjectSet`).
-/

/-- Set-like occupancy (unique object ids). Stand-in for `Finset ObjectId`. -/
abbrev ObjectSet := List ObjectId

def ObjectSet.empty : ObjectSet := []

def ObjectSet.insert (s : ObjectSet) (o : ObjectId) : ObjectSet :=
  if s.contains o then s else s.concat o

def ObjectSet.mem (s : ObjectSet) (o : ObjectId) : Bool :=
  s.contains o

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

/-- Objects present at a tile (object-mask bits). -/
def Board.occ (b : Board) (t : TileIdx) : ObjectSet :=
  if t.val ≥ b.nTiles then
    ObjectSet.empty
  else
    let cell := b.cellObjWordsAt t
    Id.run do
      let mut out : ObjectSet := ObjectSet.empty
      let maxBit := b.strideObj * 32
      for bit in [:maxBit] do
        if maskGetBit cell bit then
          out := out.insert ⟨bit⟩
      pure out

/-- Pending movement direction for one collision layer at a tile (ignores rigid bit 31). -/
def Board.movAt (b : Board) (t : TileIdx) (ℓ : LayerIdx) : Option Dir4 :=
  if t.val ≥ b.nTiles || ℓ.val ≥ b.layerCount then
    none
  else
    let bits := getLayerMovementBits (b.cellMovWordsAt t) ℓ.val
    Dir4.ofBits? (bits &&& 15)

/-- Bounds-checked column-major neighbor. -/
def TileIdx.neighbor (b : Board) (t : TileIdx) (d : Dir4) : Option TileIdx :=
  if t.val ≥ b.nTiles || b.height == 0 then
    none
  else
    let x := b.tileCol t.val
    let y := b.tileRow t.val
    let (dx, dy) := d.delta
    let x' := Int.ofNat x + dx
    let y' := Int.ofNat y + dy
    if x' < 0 || y' < 0 then
      none
    else
      let xn := x'.toNat
      let yn := y'.toNat
      if xn ≥ b.width || yn ≥ b.height then
        none
      else
        some ⟨b.runtimeTile xn yn⟩

/-- Count objects on a layer at a tile (for well-formedness checks). -/
def Board.layerOccupancyCount (game : Game) (b : Board) (tile layer : Nat) : Nat :=
  Id.run do
    let mut n := 0
    for oid in [:game.objectCount] do
      if maskGetBit (b.cellObjWords tile) oid
          && (game.objectLayers.getD oid ⟨0⟩).val == layer then
        n := n + 1
    pure n

/-- Executable well-formedness: dims/strides, objectLayers coherence, ≤1 object per layer per tile. -/
def Board.wellFormed (game : Game) (b : Board) : Bool :=
  b.layerCount == game.layerCount
    && b.strideObj == game.strideObj
    && b.strideMov == game.strideMov
    && game.objectLayers.size == game.objectCount
    && b.objects.size == b.nTiles * b.strideObj
    && b.movements.size == b.nTiles * b.strideMov
    && Id.run do
      let mut ok := true
      for oid in [:game.objectCount] do
        unless game.validLayer (game.objectLayers.getD oid ⟨0⟩) do
          ok := false
      for t in [:b.nTiles] do
        for oid in [:game.objectCount] do
          if maskGetBit (b.cellObjWords t) oid then
            unless game.validObject ⟨oid⟩ && game.validLayer (game.objectLayers.getD oid ⟨0⟩) do
              ok := false
        for ℓ in [:game.layerCount] do
          if b.layerOccupancyCount game t ℓ > 1 then
            ok := false
      pure ok

/-- Prop alias for theorems. -/
def Board.WellFormed (game : Game) (b : Board) : Prop :=
  b.wellFormed game = true

/-- Board geometry matches a playable level entry (objects payload not compared). -/
def Board.matchesPlayable (game : Game) (b : Board) (e : LevelEntry) : Bool :=
  match e with
  | .playable w h lc _ =>
    b.width == w && b.height == h && b.layerCount == lc
      && b.strideObj == game.strideObj && b.strideMov == game.strideMov
  | .message _ => false

/--
First playable level at or after `lvl` (JS level cursor may sit on a preceding
message screen while the prepared board is already the next playable).
-/
def Game.activePlayableLevel? (game : Game) (lvl : LevelIdx) : Option LevelEntry :=
  Id.run do
    let mut i := lvl.val
    while i < game.levels.size do
      match game.levels[i]? with
      | some e =>
        if e.isPlayable then
          return some e
        else
          i := i + 1
      | none => break
    pure none

/-- Undo frame: board geometry matches the active playable at the recorded index. -/
def Session.undoFrameWellFormed (game : Game) (frame : Board × LevelIdx × Bool) : Bool :=
  let (b, lvl, _) := frame
  match Game.activePlayableLevel? game lvl with
  | some e => Board.matchesPlayable game b e && Board.wellFormed game b
  | none => false

/--
Session coherence: current board (and optional restart board) match the active
playable level at/after `currentLevel`; undo frames are each coherent with their
stored level cursor.
-/
def Session.wellFormed (game : Game) (s : Session) : Bool :=
  match Game.activePlayableLevel? game s.currentLevel with
  | some e =>
    Board.matchesPlayable game s.board e
      && Board.wellFormed game s.board
      && (match s.restartBoard with
          | none => true
          | some rb =>
            Board.matchesPlayable game rb e && Board.wellFormed game rb)
      && s.undoBackups.all (Session.undoFrameWellFormed game)
  | none => false

def Session.WellFormed (game : Game) (s : Session) : Prop :=
  Session.wellFormed game s = true

end PuzzleScript

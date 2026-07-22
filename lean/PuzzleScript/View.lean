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
  ((List.range game.objectCount).filter fun oid =>
    maskGetBit (b.cellObjWords tile) oid
      && ((game.objectLayers.getD oid ⟨0⟩).val == layer)).length

/-- Object-layer metadata ok: collision-layer ids valid; sentinel (≥ layerCount) allowed. -/
def Game.objectLayersMetaOk (game : Game) : Bool :=
  game.objectLayers.size == game.objectCount
    && (List.range game.objectCount).all fun oid =>
      let ℓ := (game.objectLayers.getD oid ⟨0⟩).val
      ℓ ≥ game.layerCount || game.validLayer ⟨ℓ⟩

/-- Tile object bits reference valid collision-layer objects only. -/
def Board.tileObjectsOk (game : Game) (b : Board) (t : Nat) : Bool :=
  (List.range game.objectCount).all fun oid =>
    !maskGetBit (b.cellObjWords t) oid
      || (game.validObject ⟨oid⟩
          && (let ℓ := (game.objectLayers.getD oid ⟨0⟩).val
              ℓ < game.layerCount && game.validLayer ⟨ℓ⟩))

/-- ≤1 object per collision layer at tile. -/
def Board.tileLayersOk (game : Game) (b : Board) (t : Nat) : Bool :=
  (List.range game.layerCount).all fun ℓ =>
    b.layerOccupancyCount game t ℓ ≤ 1

/-- Executable well-formedness: dims/strides, objectLayers coherence, ≤1 object per layer per tile. -/
def Board.wellFormed (game : Game) (b : Board) : Bool :=
  b.layerCount == game.layerCount
    && b.strideObj == game.strideObj
    && b.strideMov == game.strideMov
    && Game.objectLayersMetaOk game
    && b.objects.size == b.nTiles * b.strideObj
    && b.movements.size == b.nTiles * b.strideMov
    && (List.range b.nTiles).all fun t =>
        Board.tileObjectsOk game b t && Board.tileLayersOk game b t

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

/-- Pure scan for first playable level at or after index `i` (returns index + entry). -/
def Game.findPlayableFrom (game : Game) (i : Nat) : Option (Nat × LevelEntry) :=
  if hlt : i < game.levels.size then
    match game.levels[i]? with
    | some e =>
      if e.isPlayable then some (i, e)
      else Game.findPlayableFrom game (i + 1)
    | none => none
  else
    none
termination_by game.levels.size - i

/--
First playable level at or after `lvl` (JS level cursor may sit on a preceding
message screen while the prepared board is already the next playable).
-/
def Game.activePlayableLevel? (game : Game) (lvl : LevelIdx) : Option LevelEntry :=
  (Game.findPlayableFrom game lvl.val).map (·.2)

theorem Game.findPlayableFrom_isPlayable (game : Game) (i : Nat) (j : Nat) (e : LevelEntry)
    (h : Game.findPlayableFrom game i = some (j, e)) :
    e.isPlayable = true ∧ j < game.levels.size ∧ game.levels[j]? = some e := by
  have ⟨fuel, hfuel⟩ : ∃ fuel, game.levels.size - i ≤ fuel := ⟨game.levels.size - i, Nat.le_refl _⟩
  revert i j e h hfuel
  induction fuel with
  | zero =>
    intro i j e h hfuel
    unfold Game.findPlayableFrom at h
    by_cases hlt : i < game.levels.size
    · have : 0 < game.levels.size - i := Nat.sub_pos_of_lt hlt
      exact absurd hfuel (Nat.not_le_of_gt this)
    · simp only [hlt, ↓reduceDIte] at h
      cases h
  | succ fuel ih =>
    intro i j e h hfuel
    unfold Game.findPlayableFrom at h
    by_cases hlt : i < game.levels.size
    · simp only [hlt, ↓reduceDIte] at h
      cases hGet : game.levels[i]? with
      | none => simp [hGet] at h
      | some e' =>
        simp only [hGet] at h
        by_cases hp : e'.isPlayable = true
        · simp only [hp, ↓reduceIte] at h
          cases h
          exact ⟨hp, hlt, hGet⟩
        · simp only [eq_false_of_ne_true hp, ↓reduceIte] at h
          exact ih (i + 1) j e h (by
            have : game.levels.size - (i + 1) < game.levels.size - i :=
              Nat.sub_succ_lt_self _ _ hlt
            omega)
    · simp only [hlt, ↓reduceDIte] at h
      cases h

theorem Game.activePlayableLevel?_isPlayable (game : Game) (lvl : LevelIdx) (e : LevelEntry)
    (h : Game.activePlayableLevel? game lvl = some e) :
    e.isPlayable = true ∧ ∃ j < game.levels.size, game.levels[j]? = some e := by
  simp only [Game.activePlayableLevel?] at h
  cases hf : Game.findPlayableFrom game lvl.val with
  | none => simp [hf] at h
  | some p =>
    rcases p with ⟨j, e'⟩
    simp only [hf, Option.map] at h
    cases h
    have := Game.findPlayableFrom_isPlayable game lvl.val j e hf
    exact ⟨this.1, ⟨j, this.2.1, this.2.2⟩⟩

/-- Undo frame: board geometry matches the active playable at the recorded index. -/
def Session.undoFrameWellFormed (game : Game) (frame : Board × LevelIdx × Bool) : Bool :=
  let (b, lvl, _) := frame
  match Game.activePlayableLevel? game lvl with
  | some e => Board.matchesPlayable game b e && Board.wellFormed game b
  | none => false

/-- Every playable level's object payload forms a well-formed board under `game`. -/
def Game.playableLevelBoardOk (game : Game) (e : LevelEntry) : Bool :=
  match e with
  | .playable w h lc objs => Board.wellFormed game (boardFromPlayable game w h lc objs)
  | .message _ => true

def Game.levelsBoardsOk (game : Game) : Bool :=
  game.levels.all (Game.playableLevelBoardOk game)

def Game.LevelsBoardsOk (game : Game) : Prop :=
  Game.levelsBoardsOk game = true

/--
Session coherence: current board matches the active playable level at/after
`currentLevel`; restart board (if any) matches that same active playable;
undo frames are each coherent with their stored level cursor.
-/
def Session.wellFormed (game : Game) (s : Session) : Bool :=
  match Game.activePlayableLevel? game s.currentLevel with
  | some e =>
    Board.matchesPlayable game s.board e
      && Board.wellFormed game s.board
      && (match s.restartBoard with
          | none => true
          | some rb => Board.matchesPlayable game rb e && Board.wellFormed game rb)
      && s.undoBackups.all (Session.undoFrameWellFormed game)
  | none => false

def Session.WellFormed (game : Game) (s : Session) : Prop :=
  Session.wellFormed game s = true

end PuzzleScript

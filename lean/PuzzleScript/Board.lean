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

theorem Board.tileRow_runtimeTile (b : Board) (x y : Nat) (hy : y < b.height) :
    b.tileRow (b.runtimeTile x y) = y := by
  simp [Board.tileRow, Board.runtimeTile]
  exact Nat.mod_eq_of_lt hy

theorem Board.tileCol_runtimeTile (b : Board) (x y : Nat) (hy : y < b.height)
    (hh : 0 < b.height) :
    b.tileCol (b.runtimeTile x y) = x := by
  simp [Board.tileCol, Board.runtimeTile]
  have hcomm : x * b.height = b.height * x := Nat.mul_comm _ _
  rw [hcomm, Nat.add_comm, Nat.add_mul_div_left y x hh, Nat.div_eq_of_lt hy, Nat.zero_add]

theorem Board.runtimeTile_tileCol_tileRow (b : Board) (tile : Nat)
    (_hh : 0 < b.height) :
    b.runtimeTile (b.tileCol tile) (b.tileRow tile) = tile := by
  simp [Board.runtimeTile, Board.tileCol, Board.tileRow]
  rw [Nat.mul_comm]
  exact Nat.div_add_mod tile b.height

theorem Array.size_set! {α : Type} (xs : Array α) (i : Nat) (v : α) :
    (xs.set! i v).size = xs.size := by
  simp [Array.set!, Array.setIfInBounds]
  split <;> simp [Array.size_set]

theorem Array.size_foldl_set!
    {α : Type} (xs : Array α) (indices : List Nat) (idx : Nat → Nat) (f : Nat → α) :
    (indices.foldl (fun a i => a.set! (idx i) (f i)) xs).size = xs.size := by
  induction indices generalizing xs with
  | nil => rfl
  | cons i is ih =>
    simp only [List.foldl_cons, Array.size_set!, ih]

/-- Write `ws` into the tile-sized slice `[tile * stride, tile * stride + stride)`. -/
def Array.setStrideSlice (xs : Array UInt32) (tile stride : Nat) (ws : MaskWords) :
    Array UInt32 :=
  let start := tile * stride
  (List.range stride).foldl
    (fun arr i => arr.set! (start + i) (ws.getD i 0))
    xs

theorem Array.size_setStrideSlice (xs : Array UInt32) (tile stride : Nat) (ws : MaskWords) :
    (Array.setStrideSlice xs tile stride ws).size = xs.size := by
  dsimp only [Array.setStrideSlice]
  change ((List.range stride).foldl
      (fun arr i => arr.set! (tile * stride + i) (ws.getD i 0))
      xs).size = xs.size
  exact Array.size_foldl_set! _ _ _ _

theorem Array.getD_set!_ne {α : Type} (xs : Array α) (i j : Nat) (v d : α)
    (hne : i ≠ j) :
    (xs.set! i v).getD j d = xs.getD j d := by
  by_cases hi : i < xs.size
  · have hset : xs.set! i v = xs.set i v hi := by
      simp [Array.set!, Array.setIfInBounds, hi]
    rw [hset]
    simp only [Array.getD]
    by_cases hj : j < xs.size
    · have hsize : (xs.set i v hi).size = xs.size := Array.size_set _
      simp [hj, hsize, Array.getElem_set_ne hi hj hne]
    · have hsize : (xs.set i v hi).size = xs.size := Array.size_set _
      simp [hj, hsize]
  · simp only [Array.set!, Array.setIfInBounds, hi, ↓reduceDIte]

theorem Array.getD_foldl_set!_ne {α : Type}
    (xs : Array α) (indices : List Nat) (idx : Nat → Nat) (f : Nat → α) (j : Nat) (d : α)
    (hne : ∀ i ∈ indices, idx i ≠ j) :
    (indices.foldl (fun a i => a.set! (idx i) (f i)) xs).getD j d = xs.getD j d := by
  induction indices generalizing xs with
  | nil => rfl
  | cons i is ih =>
    simp only [List.foldl_cons]
    have hi : idx i ≠ j := hne i (by simp)
    have hrest : ∀ k ∈ is, idx k ≠ j := fun k hk => hne k (by simp [hk])
    rw [ih (xs.set! (idx i) (f i)) hrest, Array.getD_set!_ne xs (idx i) j (f i) d hi]

theorem Array.getD_setStrideSlice_ne
    (xs : Array UInt32) (tile stride : Nat) (ws : MaskWords) (j : Nat)
    (hne : ∀ i < stride, tile * stride + i ≠ j) :
    (Array.setStrideSlice xs tile stride ws).getD j 0 = xs.getD j 0 := by
  dsimp only [Array.setStrideSlice]
  change ((List.range stride).foldl
      (fun arr i => arr.set! (tile * stride + i) (ws.getD i 0))
      xs).getD j 0 = xs.getD j 0
  refine Array.getD_foldl_set!_ne _ _ _ _ _ _ ?_
  intro i hi
  have hi' : i < stride := List.mem_range.mp hi
  exact hne i hi'

theorem tile_stride_indices_eq_implies_tile_eq
    (tile t s i j : Nat) (hs : 0 < s) (hi : i < s) (hj : j < s)
    (heq : tile * s + i = t * s + j) : tile = t := by
  have hdiv : (tile * s + i) / s = tile := by
    rw [Nat.mul_comm tile s, Nat.mul_add_div hs, Nat.div_eq_of_lt hi, Nat.add_zero]
  have hdiv' : (t * s + j) / s = t := by
    rw [Nat.mul_comm t s, Nat.mul_add_div hs, Nat.div_eq_of_lt hj, Nat.add_zero]
  rw [heq] at hdiv
  exact hdiv.symm.trans hdiv'

theorem tile_ranges_disjoint
    (tile t s i j : Nat) (hne : tile ≠ t) (hi : i < s) (hj : j < s) :
    tile * s + i ≠ t * s + j := by
  intro heq
  by_cases hs : s = 0
  · simp [hs] at hi
  · have hspos : 0 < s := Nat.pos_of_ne_zero hs
    exact hne (tile_stride_indices_eq_implies_tile_eq tile t s i j hspos hi hj heq)

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
  { b with objects := Array.setStrideSlice b.objects tile b.strideObj ws }

def Board.setCellMovWords (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  { b with movements := Array.setStrideSlice b.movements tile b.strideMov ws }

def Board.setCellObjWordsAt (b : Board) (t : TileIdx) (ws : MaskWords) : Board :=
  b.setCellObjWords t.val ws

def Board.setCellMovWordsAt (b : Board) (t : TileIdx) (ws : MaskWords) : Board :=
  b.setCellMovWords t.val ws

def Board.cellRigidMovementAppliedMask (b : Board) (tile : Nat) : MaskWords :=
  let start := tile * b.strideMov
  b.rigidMovementAppliedMask.extract start (start + b.strideMov)

def Board.setCellRigidMovementAppliedMask (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  { b with rigidMovementAppliedMask :=
      Array.setStrideSlice b.rigidMovementAppliedMask tile b.strideMov ws }

def Board.cellRigidGroupIndexMask (b : Board) (tile : Nat) : MaskWords :=
  let start := tile * b.strideMov
  b.rigidGroupIndexMask.extract start (start + b.strideMov)

def Board.setCellRigidGroupIndexMask (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  { b with rigidGroupIndexMask :=
      Array.setStrideSlice b.rigidGroupIndexMask tile b.strideMov ws }

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

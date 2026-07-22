import Init.Data.BitVec.Lemmas
import PuzzleScript.BitVec
import PuzzleScript.Board
import PuzzleScript.IR
import PuzzleScript.Runtime
import PuzzleScript.View

set_option maxHeartbeats 800000

open BitVec

namespace PuzzleScript

/-!
# Board well-formedness preservation (Phase A)

Leaf mask algebra uses `Init.Data.BitVec`.
-/

theorem Array.set!_eq_set {α : Type} (xs : Array α) (i : Nat) (v : α) (h : i < xs.size) :
    xs.set! i v = xs.set i v h := by
  simp [Array.set!, Array.setIfInBounds, h]

theorem maskEnsureWords_size (ws : MaskWords) (n : Nat) :
    n ≤ (maskEnsureWords ws n).size := by
  unfold maskEnsureWords
  by_cases h : ws.size ≥ n
  · simp [h]
  · simp [h, Array.size_append, Array.size_replicate]; omega

theorem maskWord_maskEnsureWords (ws : MaskWords) (n i : Nat) :
    maskWord (maskEnsureWords ws n) i = maskWord ws i := by
  unfold maskEnsureWords
  by_cases h : ws.size ≥ n
  · simp [h]
  · dsimp [maskWord]
    by_cases hi : i < ws.size
    · simp [Array.getD, hi, h, Array.getElem_append_left hi]
      intro; omega
    · simp [Array.getD, hi, h]
      by_cases hi2 : i < ws.size + (n - ws.size)
      · have hge : ws.size ≤ i := Nat.le_of_not_gt hi
        simp [Array.getElem_append_right hge, Nat.add_sub_of_le (Nat.le_of_not_ge h),
          Array.getElem_replicate]
      · intro; omega

theorem maskGetBit_maskEnsureWords (ws : MaskWords) (n bit : Nat) :
    maskGetBit (maskEnsureWords ws n) bit = maskGetBit ws bit := by
  simp [maskGetBit, maskWord_maskEnsureWords]

theorem maskWord_set!_eq (ws : MaskWords) (w : Nat) (v : UInt32) (hw : w < ws.size) :
    maskWord (ws.set! w v) w = v := by
  rw [Array.set!_eq_set _ _ _ hw]
  simp [maskWord, Array.getD, hw]

theorem maskWord_set!_ne (ws : MaskWords) (w w' : Nat) (v : UInt32)
    (hw : w < ws.size) (hne : w ≠ w') :
    maskWord (ws.set! w v) w' = maskWord ws w' := by
  rw [Array.set!_eq_set _ _ _ hw]
  dsimp [maskWord]
  by_cases hw' : w' < ws.size
  · simp [Array.getD, hw', Array.getElem_set_ne hw hw' hne]
  · simp [Array.getD, hw']

/-- Single-bit mask: `(1 <<< b).getLsbD i` is true iff `i = b` (in-range). -/
theorem getLsbD_one_shiftLeft_eq (b i : Nat) (_hb : b < 32) (hi : i < 32) :
    ((1#32 <<< b).getLsbD i) = decide (i = b) := by
  simp only [getLsbD_shiftLeft, getLsbD_one, hi, decide_true, Bool.true_and]
  by_cases hlt : i < b
  · simp [hlt]
    intro; omega
  · simp [hlt]
    by_cases heq : i = b
    · simp [heq]
    · have : i - b ≠ 0 := by omega
      simp [this, heq]

theorem maskGetBit_maskSetBit_same (ws : MaskWords) (bit : Nat) (val : Bool) :
    maskGetBit (maskSetBit ws bit val) bit = val := by
  have hb : bit % 32 < 32 := Nat.mod_lt bit (by decide)
  unfold maskSetBit maskGetBit
  have hEns : bit / 32 < (maskEnsureWords ws (bit / 32 + 1)).size := by
    have := maskEnsureWords_size ws (bit / 32 + 1); omega
  rw [maskWord_set!_eq _ _ _ hEns, UInt32.toBitVec_ofBitVec]
  cases val with
  | true =>
    simp [getLsbD_or, getLsbD_one_shiftLeft_eq (bit % 32) (bit % 32) hb hb]
  | false =>
    simp [getLsbD_and, getLsbD_not, getLsbD_one_shiftLeft_eq (bit % 32) (bit % 32) hb hb]

theorem maskGetBit_maskSetBit_ne (ws : MaskWords) (bit oid : Nat) (val : Bool)
    (hne : bit ≠ oid) :
    maskGetBit (maskSetBit ws bit val) oid = maskGetBit ws oid := by
  have hbBit : bit % 32 < 32 := Nat.mod_lt bit (by decide)
  have hbOid : oid % 32 < 32 := Nat.mod_lt oid (by decide)
  unfold maskSetBit maskGetBit
  have hEns : bit / 32 < (maskEnsureWords ws (bit / 32 + 1)).size := by
    have := maskEnsureWords_size ws (bit / 32 + 1); omega
  by_cases hw : bit / 32 = oid / 32
  · have hbne : bit % 32 ≠ oid % 32 := by
      intro h; apply hne
      have h1 := Nat.div_add_mod bit 32
      have h2 := Nat.div_add_mod oid 32
      omega
    rw [← hw, maskWord_set!_eq _ _ _ hEns, UInt32.toBitVec_ofBitVec,
      maskWord_maskEnsureWords]
    have hmask :
        ((1#32 <<< (bit % 32)).getLsbD (oid % 32)) = false := by
      rw [getLsbD_one_shiftLeft_eq (bit % 32) (oid % 32) hbBit hbOid]
      simp [Ne.symm hbne]
    cases val with
    | true =>
      simp only [↓reduceIte]
      rw [getLsbD_or, hmask, Bool.or_false]
    | false =>
      have hif :
          (if false = true then (maskWord ws (bit / 32)).toBitVec ||| 1#32 <<< (bit % 32)
            else (maskWord ws (bit / 32)).toBitVec &&& ~~~(1#32 <<< (bit % 32))) =
            ((maskWord ws (bit / 32)).toBitVec &&& ~~~(1#32 <<< (bit % 32))) := by
        simp
      rw [hif]
      calc
        ((maskWord ws (bit / 32)).toBitVec &&& ~~~(1#32 <<< (bit % 32))).getLsbD (oid % 32)
            = ((maskWord ws (bit / 32)).toBitVec.getLsbD (oid % 32) &&
                (~~~(1#32 <<< (bit % 32))).getLsbD (oid % 32)) := by
              rw [getLsbD_and]
        _ = ((maskWord ws (bit / 32)).toBitVec.getLsbD (oid % 32) &&
              (decide (oid % 32 < 32) && !((1#32 <<< (bit % 32)).getLsbD (oid % 32)))) := by
              rw [getLsbD_not]
        _ = ((maskWord ws (bit / 32)).toBitVec.getLsbD (oid % 32) &&
              (decide (oid % 32 < 32) && !false)) := by
              rw [hmask]
        _ = (maskWord ws (bit / 32)).toBitVec.getLsbD (oid % 32) := by
              simp [hbOid]
  · have hneW : bit / 32 ≠ oid / 32 := hw
    rw [maskWord_set!_ne _ _ _ _ hEns hneW, maskWord_maskEnsureWords]

theorem maskGetBit_foldl_set_preserves
    (acc : MaskWords) (bits : List Nat) (f : Nat → Bool) (oid : Nat)
    (h : oid ∉ bits) :
    maskGetBit (bits.foldl (fun a bit => maskSetBit a bit (f bit)) acc) oid =
      maskGetBit acc oid := by
  induction bits generalizing acc with
  | nil => rfl
  | cons x xs ih =>
    have hx : x ≠ oid := by intro heq; exact h (by simp [heq])
    have hxs : oid ∉ xs := fun hin => h (by simp [hin])
    simp only [List.foldl_cons]
    rw [ih _ hxs, maskGetBit_maskSetBit_ne acc x oid (f x) hx]

theorem maskGetBit_foldl_set_mem
    (acc : MaskWords) (bits : List Nat) (f : Nat → Bool) (oid : Nat)
    (hmem : oid ∈ bits) (hnodup : bits.Nodup) :
    maskGetBit (bits.foldl (fun a bit => maskSetBit a bit (f bit)) acc) oid = f oid := by
  induction bits generalizing acc with
  | nil => cases hmem
  | cons bit bits ih =>
    simp only [List.foldl_cons]
    obtain ⟨hnotin, hnodup'⟩ := List.nodup_cons.mp hnodup
    simp only [List.mem_cons] at hmem
    rcases hmem with rfl | hmem
    · rw [maskGetBit_foldl_set_preserves _ _ _ _ hnotin, maskGetBit_maskSetBit_same]
    · exact ih (maskSetBit acc bit (f bit)) hmem hnodup'

/-- Bit semantics of `maskApplyReplacement` (BitVec-backed `maskSetBit` fold). -/
theorem maskGetBit_maskApplyReplacement (old clear set : MaskWords) (oid : Nat)
    (hOid : oid < max (max old.size clear.size) set.size * 32) :
    maskGetBit (maskApplyReplacement old clear set) oid =
      (maskGetBit set oid || (maskGetBit old oid && !maskGetBit clear oid)) := by
  simp only [maskApplyReplacement]
  exact maskGetBit_foldl_set_mem #[]
    (List.range (max (max old.size clear.size) set.size * 32))
    (fun bit => maskGetBit set bit || (maskGetBit old bit && !maskGetBit clear bit))
    oid (List.mem_range.mpr hOid) List.nodup_range

/-- Bit semantics of replacement with no oid upper bound. -/
theorem maskGetBit_maskApplyReplacement'
    (old clear set : MaskWords) (oid : Nat) :
    maskGetBit (maskApplyReplacement old clear set) oid =
      (maskGetBit set oid || (maskGetBit old oid && !maskGetBit clear oid)) := by
  by_cases hIn : oid < max (max old.size clear.size) set.size * 32
  · exact maskGetBit_maskApplyReplacement old clear set oid hIn
  · simp only [maskApplyReplacement]
    have hPres : maskGetBit
        ((List.range (max (max old.size clear.size) set.size * 32)).foldl
          (fun acc bit =>
            maskSetBit acc bit
              (maskGetBit set bit || (maskGetBit old bit && !maskGetBit clear bit)))
          #[]) oid = maskGetBit (#[] : MaskWords) oid :=
      maskGetBit_foldl_set_preserves _ _ _ _ (by
        intro hmem
        have := List.mem_range.mp hmem
        omega)
    rw [hPres]
    have hEmpty : maskGetBit (#[] : MaskWords) oid = false := by
      simp [maskGetBit, maskWord, Array.getD]
    have word0 (ws : MaskWords) (h : ¬ oid / 32 < ws.size) :
        maskGetBit ws oid = false := by
      simp [maskGetBit, maskWord, Array.getD, h]
    have hs : ¬ oid / 32 < set.size := by omega
    have ho : ¬ oid / 32 < old.size := by omega
    have hc : ¬ oid / 32 < clear.size := by omega
    simp [hEmpty, word0 set hs, word0 old ho, word0 clear hc]

/--
Bit-level identity for `maskApplyReplacement`: if every set bit is already in `old`,
and every bit cleared from `old` is restored by `set`, then each bit of `old` is unchanged.
-/
theorem maskGetBit_maskApplyReplacement_eq_old
    (old clear set : MaskWords) (oid : Nat)
    (hSet : maskGetBit set oid = true → maskGetBit old oid = true)
    (hClr : maskGetBit clear oid = true → maskGetBit old oid = true →
      maskGetBit set oid = true) :
    maskGetBit (maskApplyReplacement old clear set) oid = maskGetBit old oid := by
  rw [maskGetBit_maskApplyReplacement']
  cases hOld : maskGetBit old oid <;> cases hSetB : maskGetBit set oid <;>
    cases hClrB : maskGetBit clear oid <;> simp_all

theorem Board.setCellMovWords_size (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellMovWords tile ws).movements.size = b.movements.size := by
  simp [Board.setCellMovWords, Array.size_setStrideSlice]

theorem Board.setCellObjWords_size (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellObjWords tile ws).objects.size = b.objects.size := by
  simp [Board.setCellObjWords, Array.size_setStrideSlice]

theorem Board.setCellRigidMovementAppliedMask_size (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellRigidMovementAppliedMask tile ws).rigidMovementAppliedMask.size =
      b.rigidMovementAppliedMask.size := by
  simp [Board.setCellRigidMovementAppliedMask, Array.size_setStrideSlice]

theorem Board.setCellRigidGroupIndexMask_size (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellRigidGroupIndexMask tile ws).rigidGroupIndexMask.size =
      b.rigidGroupIndexMask.size := by
  simp [Board.setCellRigidGroupIndexMask, Array.size_setStrideSlice]

/-- `wellFormed` ignores rigid mask arrays. -/
theorem Board.withClearedRigidMasks_wellFormed (game : Game) (b : Board)
    (h : Board.WellFormed game b) :
    Board.WellFormed game (b.withClearedRigidMasks) := by
  simp only [Board.WellFormed] at h ⊢
  simpa [Board.wellFormed, Board.withClearedRigidMasks, Board.nTiles,
    Board.tileObjectsOk, Board.tileLayersOk, Board.layerOccupancyCount,
    Board.cellObjWords] using h

theorem Board.setCellRigidMovementAppliedMask_wellFormed
    (game : Game) (b : Board) (tile : Nat) (ws : MaskWords)
    (h : Board.WellFormed game b) :
    Board.WellFormed game (b.setCellRigidMovementAppliedMask tile ws) := by
  simp only [Board.WellFormed] at h ⊢
  simpa [Board.wellFormed, Board.setCellRigidMovementAppliedMask, Board.nTiles,
    Board.tileObjectsOk, Board.tileLayersOk, Board.layerOccupancyCount,
    Board.cellObjWords] using h

theorem Board.setCellRigidGroupIndexMask_wellFormed
    (game : Game) (b : Board) (tile : Nat) (ws : MaskWords)
    (h : Board.WellFormed game b) :
    Board.WellFormed game (b.setCellRigidGroupIndexMask tile ws) := by
  simp only [Board.WellFormed] at h ⊢
  simpa [Board.wellFormed, Board.setCellRigidGroupIndexMask, Board.nTiles,
    Board.tileObjectsOk, Board.tileLayersOk, Board.layerOccupancyCount,
    Board.cellObjWords] using h

/-- Clearing movements keeps object occupancy / dimensions; resets movement array size. -/
theorem Board.clearMovements_wellFormed (game : Game) (b : Board)
    (h : Board.WellFormed game b) :
    Board.WellFormed game (b.clearMovements) := by
  simp only [Board.WellFormed] at h ⊢
  unfold Board.wellFormed at h ⊢
  obtain ⟨hFront, hTiles⟩ := Bool.and_eq_true_iff.mp h
  obtain ⟨hDims, _hMov⟩ := Bool.and_eq_true_iff.mp hFront
  refine Bool.and_eq_true_iff.mpr ⟨?_, ?_⟩
  · refine Bool.and_eq_true_iff.mpr ⟨?_, ?_⟩
    · have hEq :
          (((b.clearMovements.layerCount == game.layerCount &&
            b.clearMovements.strideObj == game.strideObj &&
            b.clearMovements.strideMov == game.strideMov &&
            game.objectLayersMetaOk &&
            b.clearMovements.objects.size ==
              b.clearMovements.nTiles * b.clearMovements.strideObj))) =
          (b.layerCount == game.layerCount && b.strideObj == game.strideObj &&
            b.strideMov == game.strideMov && game.objectLayersMetaOk &&
            b.objects.size == b.nTiles * b.strideObj) := by
        simp [Board.clearMovements, Board.nTiles]
      rw [hEq]; exact hDims
    · simp [Board.clearMovements, Board.nTiles, Array.size_replicate]
  · have hEq :
        (((List.range b.clearMovements.nTiles).all fun t =>
          Board.tileObjectsOk game b.clearMovements t &&
            Board.tileLayersOk game b.clearMovements t)) =
        ((List.range b.nTiles).all fun t =>
          Board.tileObjectsOk game b t && Board.tileLayersOk game b t) := by
      simp [Board.clearMovements, Board.nTiles, Board.tileObjectsOk, Board.tileLayersOk,
        Board.layerOccupancyCount, Board.cellObjWords]
    rw [hEq]; exact hTiles

/-- Movement writes do not affect `Board.wellFormed` occupancy (objects-only). -/
theorem Board.setCellMovWords_wellFormed (game : Game) (b : Board) (tile : Nat) (ws : MaskWords)
    (h : Board.WellFormed game b) :
    Board.WellFormed game (b.setCellMovWords tile ws) := by
  simp only [Board.WellFormed] at h ⊢
  unfold Board.wellFormed at h ⊢
  obtain ⟨hFront, hTiles⟩ := Bool.and_eq_true_iff.mp h
  obtain ⟨hDims, hMov⟩ := Bool.and_eq_true_iff.mp hFront
  refine Bool.and_eq_true_iff.mpr ⟨?_, ?_⟩
  · refine Bool.and_eq_true_iff.mpr ⟨?_, ?_⟩
    · have hEq :
          (((b.setCellMovWords tile ws).layerCount == game.layerCount &&
            (b.setCellMovWords tile ws).strideObj == game.strideObj &&
            (b.setCellMovWords tile ws).strideMov == game.strideMov &&
            game.objectLayersMetaOk &&
            (b.setCellMovWords tile ws).objects.size ==
              (b.setCellMovWords tile ws).nTiles * (b.setCellMovWords tile ws).strideObj)) =
          (b.layerCount == game.layerCount && b.strideObj == game.strideObj &&
            b.strideMov == game.strideMov && game.objectLayersMetaOk &&
            b.objects.size == b.nTiles * b.strideObj) := by
        simp [Board.setCellMovWords, Board.nTiles]
      rw [hEq]; exact hDims
    · have hsz := Board.setCellMovWords_size b tile ws
      simp only [Board.setCellMovWords, Board.nTiles] at hsz ⊢
      rw [hsz]
      exact hMov
  · have hEq :
        (((List.range (b.setCellMovWords tile ws).nTiles).all fun t =>
          Board.tileObjectsOk game (b.setCellMovWords tile ws) t &&
            Board.tileLayersOk game (b.setCellMovWords tile ws) t)) =
        ((List.range b.nTiles).all fun t =>
          Board.tileObjectsOk game b t && Board.tileLayersOk game b t) := by
      simp [Board.setCellMovWords, Board.nTiles, Board.tileObjectsOk, Board.tileLayersOk,
        Board.layerOccupancyCount, Board.cellObjWords]
    rw [hEq]; exact hTiles

/-- Clear/set masks that respect collision layers (runtime post-random/inferred surface). -/
def ReplacementObjectsOk (game : Game) (clear set : MaskWords) : Bool :=
  (List.range game.layerCount).all (fun ℓ => objectsSetCountOnLayer game set ℓ ≤ 1)
    && (List.range game.objectCount).all fun oid =>
      !maskGetBit set oid
        || (let layer := (game.objectLayers.getD oid ⟨0⟩).val
            layer < game.layerCount
              && maskBitsSetIn (game.layerMasks.getD layer #[]) clear)

theorem CellPattern.layerRespecting_hasReplacement
    (game : Game) (p : CellPattern) (h : CellPattern.layerRespecting game p = true)
    (hr : p.hasReplacement = true) :
    ReplacementObjectsOk game p.objectsClear p.objectsSet = true := by
  simp only [CellPattern.layerRespecting, hr, Bool.not_true] at h
  obtain ⟨h12, _⟩ := Bool.and_eq_true_iff.mp h
  simpa [ReplacementObjectsOk] using h12

theorem CellPattern.layerRespecting_randomEntityCompatible
    (game : Game) (p : CellPattern) (h : CellPattern.layerRespecting game p = true)
    (hr : p.hasReplacement = true) :
    CellPattern.randomEntityCompatible game p = true := by
  simp only [CellPattern.layerRespecting, hr, Bool.not_true] at h
  exact (Bool.and_eq_true_iff.mp h).2

theorem CellPattern.layerRespecting_noReplacement
    (game : Game) (p : CellPattern) (h : p.hasReplacement = false) :
    CellPattern.layerRespecting game p = true := by
  simp [CellPattern.layerRespecting, h]

/-- Object write preserves WF when the resulting board's per-tile checks all hold. -/
theorem Board.setCellObjWords_wellFormed_of_tilesOk
    (game : Game) (b : Board) (tile : Nat) (ws : MaskWords)
    (h : Board.WellFormed game b)
    (hTiles :
      ((List.range b.nTiles).all fun t =>
        Board.tileObjectsOk game (b.setCellObjWords tile ws) t &&
          Board.tileLayersOk game (b.setCellObjWords tile ws) t) = true) :
    Board.WellFormed game (b.setCellObjWords tile ws) := by
  simp only [Board.WellFormed] at h ⊢
  unfold Board.wellFormed at h ⊢
  obtain ⟨hFront, _⟩ := Bool.and_eq_true_iff.mp h
  obtain ⟨hDims, hMov⟩ := Bool.and_eq_true_iff.mp hFront
  refine Bool.and_eq_true_iff.mpr ⟨?_, ?_⟩
  · refine Bool.and_eq_true_iff.mpr ⟨?_, ?_⟩
    · have hEq :
          (((b.setCellObjWords tile ws).layerCount == game.layerCount &&
            (b.setCellObjWords tile ws).strideObj == game.strideObj &&
            (b.setCellObjWords tile ws).strideMov == game.strideMov &&
            game.objectLayersMetaOk &&
            (b.setCellObjWords tile ws).objects.size ==
              (b.setCellObjWords tile ws).nTiles * (b.setCellObjWords tile ws).strideObj)) =
          (b.layerCount == game.layerCount && b.strideObj == game.strideObj &&
            b.strideMov == game.strideMov && game.objectLayersMetaOk &&
            b.objects.size == b.nTiles * b.strideObj) := by
        have hsz := Board.setCellObjWords_size b tile ws
        simp only [Board.setCellObjWords, Board.nTiles] at hsz ⊢
        rw [hsz]
      rw [hEq]; exact hDims
    · have hEq :
          (((b.setCellObjWords tile ws).movements.size ==
            (b.setCellObjWords tile ws).nTiles * (b.setCellObjWords tile ws).strideMov)) =
          (b.movements.size == b.nTiles * b.strideMov) := by
        simp [Board.setCellObjWords, Board.nTiles]
      rw [hEq]; exact hMov
  · have hEq :
        (((List.range (b.setCellObjWords tile ws).nTiles).all fun t =>
          Board.tileObjectsOk game (b.setCellObjWords tile ws) t &&
            Board.tileLayersOk game (b.setCellObjWords tile ws) t)) =
        ((List.range b.nTiles).all fun t =>
          Board.tileObjectsOk game (b.setCellObjWords tile ws) t &&
            Board.tileLayersOk game (b.setCellObjWords tile ws) t) := by
      simp [Board.setCellObjWords, Board.nTiles]
    rw [hEq]; exact hTiles

/-- Occupancy count on a raw mask (same fold as `layerOccupancyCount` for a cell). -/
def cellMaskLayerCount (game : Game) (ws : MaskWords) (layer : Nat) : Nat :=
  objectsSetCountOnLayer game ws layer

def cellMaskObjectsOk (game : Game) (ws : MaskWords) : Bool :=
  (List.range game.objectCount).all fun oid =>
    !maskGetBit ws oid
      || (game.validObject ⟨oid⟩
          && (let ℓ := (game.objectLayers.getD oid ⟨0⟩).val
              ℓ < game.layerCount && game.validLayer ⟨ℓ⟩))

def cellMaskLayersOk (game : Game) (ws : MaskWords) : Bool :=
  (List.range game.layerCount).all fun ℓ => cellMaskLayerCount game ws ℓ ≤ 1

theorem Board.layerOccupancyCount_eq_cellMask
    (game : Game) (b : Board) (tile layer : Nat) :
    b.layerOccupancyCount game tile layer =
      cellMaskLayerCount game (b.cellObjWords tile) layer := by
  rfl

theorem Board.tileLayersOk_eq_cellMask (game : Game) (b : Board) (t : Nat) :
    Board.tileLayersOk game b t =
      cellMaskLayersOk game (b.cellObjWords t) := by
  rfl

theorem Board.tileObjectsOk_eq_cellMask (game : Game) (b : Board) (t : Nat) :
    Board.tileObjectsOk game b t =
      cellMaskObjectsOk game (b.cellObjWords t) := by
  rfl

theorem Game.wellFormed_objectLayers_size (game : Game) (h : Game.WellFormed game) :
    game.objectLayers.size = game.objectCount := by
  simp only [Game.WellFormed, Game.wellFormed] at h
  obtain ⟨h123, _⟩ := Bool.and_eq_true_iff.mp h
  obtain ⟨h12, _⟩ := Bool.and_eq_true_iff.mp h123
  obtain ⟨h1, _⟩ := Bool.and_eq_true_iff.mp h12
  exact beq_iff_eq.mp h1

theorem Game.wellFormed_layerMasks_size (game : Game) (h : Game.WellFormed game) :
    game.layerMasks.size = game.layerCount := by
  simp only [Game.WellFormed, Game.wellFormed] at h
  obtain ⟨h123, _⟩ := Bool.and_eq_true_iff.mp h
  obtain ⟨h12, _⟩ := Bool.and_eq_true_iff.mp h123
  obtain ⟨_, h2⟩ := Bool.and_eq_true_iff.mp h12
  exact beq_iff_eq.mp h2

theorem Game.wellFormed_layerMasksCoherent (game : Game) (h : Game.WellFormed game) :
    Game.layerMasksCoherent game = true := by
  simp only [Game.WellFormed, Game.wellFormed] at h
  exact (Bool.and_eq_true_iff.mp h).2

theorem Game.layerMask_getBit_of_onLayer
    (game : Game) (oid layer : Nat)
    (hWF : Game.WellFormed game)
    (hOid : oid < game.objectCount)
    (hLayer : layer < game.layerCount)
    (hOn : (game.objectLayers.getD oid ⟨0⟩).val = layer) :
    maskGetBit (game.layerMasks.getD layer #[]) oid = true := by
  have hCoh := Game.wellFormed_layerMasksCoherent game hWF
  simp only [Game.layerMasksCoherent] at hCoh
  have hObj := (Bool.and_eq_true_iff.mp hCoh).1
  have hOidMem : oid ∈ List.range game.objectCount := List.mem_range.mpr hOid
  have hOne := (List.all_eq_true.mp hObj) oid hOidMem
  simp only [hOn, hLayer, ↓reduceIte] at hOne
  exact hOne

/-- `maskBitsSetIn req act` ⇒ every set bit of `req` is set in `act`. -/
theorem maskGetBit_of_maskBitsSetIn (req act : MaskWords) (bit : Nat)
    (h : maskBitsSetIn req act = true) (hreq : maskGetBit req bit = true) :
    maskGetBit act bit = true := by
  simp only [maskBitsSetIn] at h
  by_cases hIn : bit / 32 < max req.size act.size
  · have hMem : bit / 32 ∈ List.range (max req.size act.size) := List.mem_range.mpr hIn
    have hWord := (List.all_eq_true.mp h) (bit / 32) hMem
    have heq : (maskWord req (bit / 32) &&& maskWord act (bit / 32)) = maskWord req (bit / 32) :=
      beq_iff_eq.mp hWord
    have hreqBit :
        (maskWord req (bit / 32)).toBitVec.getLsbD (bit % 32) = true := by
      simpa [maskGetBit] using hreq
    have hAndBV :
        (maskWord req (bit / 32) &&& maskWord act (bit / 32)).toBitVec =
          (maskWord req (bit / 32)).toBitVec &&& (maskWord act (bit / 32)).toBitVec :=
      UInt32.toBitVec_and _ _
    simp only [maskGetBit]
    have h1 := congrArg (fun v : UInt32 => v.toBitVec.getLsbD (bit % 32)) heq
    simp only [hAndBV, getLsbD_and, hreqBit, Bool.true_and] at h1
    exact h1
  · have : maskGetBit req bit = false := by
      have : ¬ bit / 32 < req.size := by omega
      simp [maskGetBit, maskWord, Array.getD, this]
    simp [this] at hreq

theorem maskGetBit_clear_of_layerMask
    (game : Game) (clear : MaskWords) (layer oid : Nat)
    (hLayer : layer < game.layerCount)
    (hOid : oid < game.objectCount)
    (hOnLayer : (game.objectLayers.getD oid ⟨0⟩).val = layer)
    (hMask : maskBitsSetIn (game.layerMasks.getD layer #[]) clear = true)
    (hWF : Game.WellFormed game) :
    maskGetBit clear oid = true := by
  have hBit := Game.layerMask_getBit_of_onLayer game oid layer hWF hOid hLayer hOnLayer
  exact maskGetBit_of_maskBitsSetIn _ _ _ hMask hBit

theorem List.filter_sublist_of_imp {α : Type} (p q : α → Bool) (l : List α)
    (h : ∀ x ∈ l, p x = true → q x = true) :
    (l.filter p).Sublist (l.filter q) := by
  induction l with
  | nil => exact List.Sublist.slnil
  | cons x xs ih =>
    have ih' : (xs.filter p).Sublist (xs.filter q) :=
      ih (fun y hy hyP => h y (List.mem_cons_of_mem x hy) hyP)
    rw [List.filter_cons, List.filter_cons]
    by_cases hx : p x
    · have hq : q x = true := h x (by simp) hx
      rw [if_pos hx, if_pos hq]
      exact List.Sublist.cons_cons x ih'
    · rw [if_neg hx]
      by_cases hq : q x
      · rw [if_pos hq]
        exact List.Sublist.cons x ih'
      · rw [if_neg hq]
        exact ih'

theorem objectsSetCountOnLayer_mono
    (game : Game) (ws₁ ws₂ : MaskWords) (layer : Nat)
    (h : ∀ oid ∈ List.range game.objectCount,
      (maskGetBit ws₁ oid && ((game.objectLayers.getD oid ⟨0⟩).val == layer)) = true →
        (maskGetBit ws₂ oid && ((game.objectLayers.getD oid ⟨0⟩).val == layer)) = true) :
    objectsSetCountOnLayer game ws₁ layer ≤ objectsSetCountOnLayer game ws₂ layer := by
  simpa [objectsSetCountOnLayer] using
    List.Sublist.length_le (List.filter_sublist_of_imp _ _ _ h)

theorem ReplacementObjectsOk_set_count_le
    (game : Game) (clear set : MaskWords) (layer : Nat)
    (hRep : ReplacementObjectsOk game clear set = true)
    (hLayer : layer < game.layerCount) :
    objectsSetCountOnLayer game set layer ≤ 1 := by
  simp only [ReplacementObjectsOk] at hRep
  have hAll := (Bool.and_eq_true_iff.mp hRep).1
  have hMem : layer ∈ List.range game.layerCount := List.mem_range.mpr hLayer
  exact of_decide_eq_true ((List.all_eq_true.mp hAll) layer hMem)

theorem ReplacementObjectsOk_set_layer_clear
    (game : Game) (clear set : MaskWords) (oid : Nat)
    (hRep : ReplacementObjectsOk game clear set = true)
    (hOid : oid < game.objectCount)
    (hSet : maskGetBit set oid = true) :
    ((game.objectLayers.getD oid ⟨0⟩).val < game.layerCount &&
      maskBitsSetIn (game.layerMasks.getD (game.objectLayers.getD oid ⟨0⟩).val #[]) clear) = true := by
  simp only [ReplacementObjectsOk] at hRep
  have hAll := (Bool.and_eq_true_iff.mp hRep).2
  have hMem : oid ∈ List.range game.objectCount := List.mem_range.mpr hOid
  have hOne := (List.all_eq_true.mp hAll) oid hMem
  simp [hSet] at hOne
  simpa using (Bool.and_eq_true_iff.mpr ⟨decide_eq_true hOne.1, hOne.2⟩)

/-- Core: replacement under `ReplacementObjectsOk` preserves ≤1 per layer. -/
theorem cellMaskLayersOk_maskApplyReplacement
    (game : Game) (old clear setM : MaskWords)
    (hWF : Game.WellFormed game)
    (hOld : cellMaskLayersOk game old = true)
    (hRep : ReplacementObjectsOk game clear setM = true) :
    cellMaskLayersOk game (maskApplyReplacement old clear setM) = true := by
  simp only [cellMaskLayersOk, cellMaskLayerCount]
  refine List.all_eq_true.mpr ?_
  intro layer hMem
  have hLayer : layer < game.layerCount := List.mem_range.mp hMem
  have hOldLe : objectsSetCountOnLayer game old layer ≤ 1 :=
    of_decide_eq_true ((List.all_eq_true.mp hOld) layer hMem)
  have hSetLe := ReplacementObjectsOk_set_count_le game clear setM layer hRep hLayer
  by_cases hAny : ∃ oid, oid ∈ List.range game.objectCount ∧
      maskGetBit setM oid = true ∧ (game.objectLayers.getD oid ⟨0⟩).val = layer
  · obtain ⟨oid0, hOidMem, hSet0, hOn0⟩ := hAny
    have hOid0 : oid0 < game.objectCount := List.mem_range.mp hOidMem
    have hClrInfo := ReplacementObjectsOk_set_layer_clear game clear setM oid0 hRep hOid0 hSet0
    have hMask : maskBitsSetIn (game.layerMasks.getD layer #[]) clear = true := by
      have h := (Bool.and_eq_true_iff.mp hClrInfo).2
      rw [← hOn0]; exact h
    have hLe1 : objectsSetCountOnLayer game (maskApplyReplacement old clear setM) layer ≤
        objectsSetCountOnLayer game setM layer := by
      refine objectsSetCountOnLayer_mono _ _ _ _ ?_
      intro oid hOidMem' hBits
      have hNew : maskGetBit (maskApplyReplacement old clear setM) oid = true :=
        (Bool.and_eq_true_iff.mp hBits).1
      have hOn : ((game.objectLayers.getD oid ⟨0⟩).val == layer) = true :=
        (Bool.and_eq_true_iff.mp hBits).2
      have hOid' : oid < game.objectCount := List.mem_range.mp hOidMem'
      have hOnEq : (game.objectLayers.getD oid ⟨0⟩).val = layer := beq_iff_eq.mp hOn
      have hCleared := maskGetBit_clear_of_layerMask game clear layer oid hLayer hOid' hOnEq hMask hWF
      have hSetB : maskGetBit setM oid = true := by
        have hSem := maskGetBit_maskApplyReplacement' old clear setM oid
        rw [hSem] at hNew
        simpa [hCleared] using hNew
      exact Bool.and_eq_true_iff.mpr ⟨hSetB, hOn⟩
    have hLe2 : objectsSetCountOnLayer game setM layer ≤
        objectsSetCountOnLayer game (maskApplyReplacement old clear setM) layer := by
      refine objectsSetCountOnLayer_mono _ _ _ _ ?_
      intro oid hOidMem' hBits
      have hSetB : maskGetBit setM oid = true := (Bool.and_eq_true_iff.mp hBits).1
      have hOn : ((game.objectLayers.getD oid ⟨0⟩).val == layer) = true :=
        (Bool.and_eq_true_iff.mp hBits).2
      have hNew : maskGetBit (maskApplyReplacement old clear setM) oid = true := by
        have hSem := maskGetBit_maskApplyReplacement' old clear setM oid
        rw [hSem, hSetB]; simp
      exact Bool.and_eq_true_iff.mpr ⟨hNew, hOn⟩
    have hEq : objectsSetCountOnLayer game (maskApplyReplacement old clear setM) layer =
        objectsSetCountOnLayer game setM layer := Nat.le_antisymm hLe1 hLe2
    exact decide_eq_true (hEq ▸ hSetLe)
  · have hMono : objectsSetCountOnLayer game (maskApplyReplacement old clear setM) layer ≤
        objectsSetCountOnLayer game old layer := by
      refine objectsSetCountOnLayer_mono _ _ _ _ ?_
      intro oid hOidMem hBits
      have hNew : maskGetBit (maskApplyReplacement old clear setM) oid = true :=
        (Bool.and_eq_true_iff.mp hBits).1
      have hOn : ((game.objectLayers.getD oid ⟨0⟩).val == layer) = true :=
        (Bool.and_eq_true_iff.mp hBits).2
      have hSem := maskGetBit_maskApplyReplacement' old clear setM oid
      rw [hSem] at hNew
      have hSetF : maskGetBit setM oid = false := by
        by_cases hs : maskGetBit setM oid = true
        · exact False.elim (hAny ⟨oid, hOidMem, hs, beq_iff_eq.mp hOn⟩)
        · exact eq_false_of_ne_true hs
      simp [hSetF] at hNew
      have hold : maskGetBit old oid = true := by
        cases ho : maskGetBit old oid <;> simp_all
      exact Bool.and_eq_true_iff.mpr ⟨hold, hOn⟩
    exact decide_eq_true (Nat.le_trans hMono hOldLe)


theorem cellMaskObjectsOk_maskApplyReplacement
    (game : Game) (old clear setM : MaskWords)
    (hOld : cellMaskObjectsOk game old = true)
    (hRep : ReplacementObjectsOk game clear setM = true) :
    cellMaskObjectsOk game (maskApplyReplacement old clear setM) = true := by
  simp only [cellMaskObjectsOk]
  refine List.all_eq_true.mpr ?_
  intro oid hMem
  have hOid : oid < game.objectCount := List.mem_range.mp hMem
  have hOldOne := (List.all_eq_true.mp hOld) oid hMem
  by_cases hPresent : maskGetBit (maskApplyReplacement old clear setM) oid = true
  · have hSem := maskGetBit_maskApplyReplacement' old clear setM oid
    have hBits : (maskGetBit setM oid || (maskGetBit old oid && !maskGetBit clear oid)) = true := by
      rwa [← hSem]
    by_cases hSet : maskGetBit setM oid = true
    · have hClr := ReplacementObjectsOk_set_layer_clear game clear setM oid hRep hOid hSet
      have hLayer : (game.objectLayers.getD oid ⟨0⟩).val < game.layerCount :=
        of_decide_eq_true (Bool.and_eq_true_iff.mp hClr).1
      have hValidObj : game.validObject ⟨oid⟩ = true := by simp [Game.validObject, hOid]
      have hValidLayer : game.validLayer ⟨(game.objectLayers.getD oid ⟨0⟩).val⟩ = true := by
        simpa [Game.validLayer] using decide_eq_true hLayer
      simp only [hPresent, Bool.not_true, Bool.false_or]
      refine Bool.and_eq_true_iff.mpr ⟨hValidObj, ?_⟩
      refine Bool.and_eq_true_iff.mpr ⟨?_, hValidLayer⟩
      simpa using decide_eq_true hLayer
    · have hSetF : maskGetBit setM oid = false := eq_false_of_ne_true hSet
      simp [hSetF] at hBits
      have hold : maskGetBit old oid = true := by
        cases ho : maskGetBit old oid <;> simp_all
      simp only [hold, Bool.not_true, Bool.false_or] at hOldOne
      simp only [hPresent, Bool.not_true, Bool.false_or]
      exact hOldOne
  · have hAbs : maskGetBit (maskApplyReplacement old clear setM) oid = false :=
      eq_false_of_ne_true hPresent
    simp [hAbs]


/-- No replacement ⇒ board unchanged. -/
theorem applyCellReplacement_noReplacement
    (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern)
    (caps : RuleCaptures) (rng : RngState)
    (h : pat.hasReplacement = false) :
    applyCellReplacement game rule b tile pat caps rng = (false, b, rng) := by
  by_cases hs : rule.skipCellWrites = true
  · simp [applyCellReplacement, hs]
  · simp [applyCellReplacement, hs, h]

theorem applyCellReplacement_wellFormed_noReplacement
    (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern)
    (caps : RuleCaptures) (rng : RngState)
    (hB : Board.WellFormed game b)
    (h : pat.hasReplacement = false) :
    Board.WellFormed game (applyCellReplacement game rule b tile pat caps rng).2.1 := by
  rw [applyCellReplacement_noReplacement game rule b tile pat caps rng h]
  exact hB

theorem Board.objects_getD_setCellObjWords_ne
    (b : Board) (tile : Nat) (ws : MaskWords) (j : Nat)
    (hne : ∀ i < b.strideObj, tile * b.strideObj + i ≠ j) :
    (b.setCellObjWords tile ws).objects.getD j 0 = b.objects.getD j 0 := by
  simpa [Board.setCellObjWords] using
    Array.getD_setStrideSlice_ne b.objects tile b.strideObj ws j hne

theorem Board.movements_getD_setCellMovWords_ne
    (b : Board) (tile : Nat) (ws : MaskWords) (j : Nat)
    (hne : ∀ i < b.strideMov, tile * b.strideMov + i ≠ j) :
    (b.setCellMovWords tile ws).movements.getD j 0 = b.movements.getD j 0 := by
  simpa [Board.setCellMovWords] using
    Array.getD_setStrideSlice_ne b.movements tile b.strideMov ws j hne

theorem Array.getD_extract {α : Type} (xs : Array α) (start stop i : Nat) (d : α) :
    (xs.extract start stop).getD i d =
      (if i < (xs.extract start stop).size then xs.getD (start + i) d else d) := by
  have hsz : (xs.extract start stop).size = min stop xs.size - start := Array.size_extract
  simp only [Array.getD]
  by_cases hi : i < (xs.extract start stop).size
  · have hbound : start + i < xs.size := by
      simp only [hsz] at hi
      omega
    simp [Array.getElem_extract hi, hbound]
  · simp only [hsz] at hi
    simp [hsz, hi]


theorem Board.maskGetBit_cellObjWords_setCellObjWords_ne
    (b : Board) (tile t : Nat) (ws : MaskWords) (oid : Nat)
    (hne : tile ≠ t)
    (hWord : oid / 32 < b.strideObj) :
    maskGetBit ((b.setCellObjWords tile ws).cellObjWords t) oid =
      maskGetBit (b.cellObjWords t) oid := by
  have hdisj : ∀ i < b.strideObj, tile * b.strideObj + i ≠ t * b.strideObj + oid / 32 := by
    intro i hi
    exact tile_ranges_disjoint tile t b.strideObj i (oid / 32) hne hi hWord
  have hget := Board.objects_getD_setCellObjWords_ne b tile ws (t * b.strideObj + oid / 32) hdisj
  have hsz := Board.setCellObjWords_size b tile ws
  have hstride : (b.setCellObjWords tile ws).strideObj = b.strideObj := by
    simp [Board.setCellObjWords]
  simp only [maskGetBit, maskWord, Board.cellObjWords, hstride]
  let start := t * b.strideObj
  let stop := t * b.strideObj + b.strideObj
  have hx1 := Array.getD_extract (b.setCellObjWords tile ws).objects start stop (oid / 32) (0 : UInt32)
  have hx2 := Array.getD_extract b.objects start stop (oid / 32) (0 : UInt32)
  have hsizeEq :
      ((b.setCellObjWords tile ws).objects.extract start stop).size =
        (b.objects.extract start stop).size := by
    simp [Array.size_extract, hsz]
  by_cases hIn : oid / 32 < (b.objects.extract start stop).size
  · have hIn' : oid / 32 < ((b.setCellObjWords tile ws).objects.extract start stop).size := by
      simpa [hsizeEq] using hIn
    rw [hx1, hx2, if_pos hIn', if_pos hIn]
    exact congrArg (fun w : UInt32 => w.toBitVec.getLsbD (oid % 32)) hget
  · have hIn' : ¬ oid / 32 < ((b.setCellObjWords tile ws).objects.extract start stop).size := by
      simpa [hsizeEq] using hIn
    rw [hx1, hx2, if_neg hIn', if_neg hIn]

/-- Writing one tile's object words leaves every other tile's object extract unchanged. -/
theorem Board.cellObjWords_setCellObjWords_ne
    (b : Board) (tile t : Nat) (ws : MaskWords) (hne : tile ≠ t) :
    (b.setCellObjWords tile ws).cellObjWords t = b.cellObjWords t := by
  simp only [Board.cellObjWords, Board.setCellObjWords]
  exact Array.extract_setStrideSlice_ne b.objects tile t b.strideObj ws hne

/-- Writing one tile's movement words leaves every other tile's movement extract unchanged. -/
theorem Board.cellMovWords_setCellMovWords_ne
    (b : Board) (tile t : Nat) (ws : MaskWords) (hne : tile ≠ t) :
    (b.setCellMovWords tile ws).cellMovWords t = b.cellMovWords t := by
  simp only [Board.cellMovWords, Board.setCellMovWords]
  exact Array.extract_setStrideSlice_ne b.movements tile t b.strideMov ws hne

theorem Board.cellMovWords_setCellObjWords
    (b : Board) (tile t : Nat) (ws : MaskWords) :
    (b.setCellObjWords tile ws).cellMovWords t = b.cellMovWords t := by
  simp [Board.cellMovWords, Board.setCellObjWords]

theorem Board.cellObjWords_setCellMovWords
    (b : Board) (tile t : Nat) (ws : MaskWords) :
    (b.setCellMovWords tile ws).cellObjWords t = b.cellObjWords t := by
  simp [Board.cellObjWords, Board.setCellMovWords]

theorem Array.getD_foldl_set!_mem {α : Type}
    (xs : Array α) (indices : List Nat) (idx : Nat → Nat) (f : Nat → α) (i : Nat) (d : α)
    (hmem : i ∈ indices)
    (hnodup : indices.Nodup)
    (hinj : ∀ a ∈ indices, ∀ b ∈ indices, idx a = idx b → a = b)
    (hbound : ∀ a ∈ indices, idx a < xs.size) :
    (indices.foldl (fun a j => a.set! (idx j) (f j)) xs).getD (idx i) d = f i := by
  induction indices generalizing xs with
  | nil => cases hmem
  | cons j js ih =>
    simp only [List.foldl_cons]
    obtain ⟨hnotin, hnodup'⟩ := List.nodup_cons.mp hnodup
    simp only [List.mem_cons] at hmem
    have hbound' : ∀ a ∈ js, idx a < (xs.set! (idx j) (f j)).size := by
      intro a ha
      have := hbound a (by simp [ha])
      simpa [Array.size_set!] using this
    have hinj' : ∀ a ∈ js, ∀ b ∈ js, idx a = idx b → a = b := fun a ha b hb =>
      hinj a (by simp [ha]) b (by simp [hb])
    rcases hmem with rfl | hmem
    · have hpres : ∀ a ∈ js, idx a ≠ idx i := by
        intro a ha heq
        have : a = i := hinj a (by simp [ha]) i (by simp) heq
        exact hnotin (this ▸ ha)
      have hget := Array.getD_foldl_set!_ne (xs.set! (idx i) (f i)) js idx f (idx i) d hpres
      rw [hget]
      have hb : idx i < xs.size := hbound i (by simp)
      have hset : xs.set! (idx i) (f i) = xs.set (idx i) (f i) hb := by
        simp [Array.set!, Array.setIfInBounds, hb]
      rw [hset]
      have hsize : (xs.set (idx i) (f i) hb).size = xs.size := Array.size_set _
      have hj : idx i < (xs.set (idx i) (f i) hb).size := by omega
      simp only [Array.getD, hj, ↓reduceDIte]
      change (xs.set (idx i) (f i) hb)[idx i] = f i
      rw [Array.getElem_set hb hj]
      simp
    · exact ih (xs.set! (idx j) (f j)) hmem hnodup' hinj' hbound'

theorem Board.objects_getD_setCellObjWords_same
    (b : Board) (tile i : Nat) (ws : MaskWords)
    (hi : i < b.strideObj)
    (hRange : tile * b.strideObj + b.strideObj ≤ b.objects.size) :
    (b.setCellObjWords tile ws).objects.getD (tile * b.strideObj + i) 0 = ws.getD i 0 := by
  change ((List.range b.strideObj).foldl
      (fun objs j => objs.set! (tile * b.strideObj + j) (ws.getD j 0))
      b.objects).getD (tile * b.strideObj + i) 0 = ws.getD i 0
  refine Array.getD_foldl_set!_mem b.objects (List.range b.strideObj)
      (fun j => tile * b.strideObj + j) (fun j => ws.getD j 0) i 0
      (List.mem_range.mpr hi) List.nodup_range ?_ ?_
  · intro a ha b hb heq
    have ha' := List.mem_range.mp ha
    have hb' := List.mem_range.mp hb
    omega
  · intro a ha
    have ha' := List.mem_range.mp ha
    omega

theorem Board.wellFormed_objects_size
    (game : Game) (b : Board) (h : Board.WellFormed game b) :
    b.objects.size = b.nTiles * b.strideObj := by
  simp only [Board.WellFormed, Board.wellFormed] at h
  obtain ⟨hFront, _⟩ := Bool.and_eq_true_iff.mp h
  obtain ⟨hDims, _⟩ := Bool.and_eq_true_iff.mp hFront
  obtain ⟨_, hObj⟩ := Bool.and_eq_true_iff.mp hDims
  exact beq_iff_eq.mp hObj

theorem Board.wellFormed_strideObj
    (game : Game) (b : Board) (h : Board.WellFormed game b) :
    b.strideObj = game.strideObj := by
  simp only [Board.WellFormed, Board.wellFormed] at h
  obtain ⟨hFront, _⟩ := Bool.and_eq_true_iff.mp h
  obtain ⟨hDims, _⟩ := Bool.and_eq_true_iff.mp hFront
  obtain ⟨h1234, _⟩ := Bool.and_eq_true_iff.mp hDims
  obtain ⟨h123, _⟩ := Bool.and_eq_true_iff.mp h1234
  obtain ⟨h12, _⟩ := Bool.and_eq_true_iff.mp h123
  obtain ⟨_, hStride⟩ := Bool.and_eq_true_iff.mp h12
  exact beq_iff_eq.mp hStride

theorem Game.wellFormed_oid_word_lt_stride
    (game : Game) (h : Game.WellFormed game) (oid : Nat) (hOid : oid < game.objectCount) :
    oid / 32 < game.strideObj := by
  simp only [Game.WellFormed, Game.wellFormed] at h
  obtain ⟨h123, _⟩ := Bool.and_eq_true_iff.mp h
  obtain ⟨_, hStride⟩ := Bool.and_eq_true_iff.mp h123
  have hge : game.strideObj * 32 ≥ game.objectCount := by
    cases hzero : (game.strideObj == 0 && game.objectCount == 0) with
    | true =>
      have : game.objectCount = 0 :=
        beq_iff_eq.mp (Bool.and_eq_true_iff.mp hzero).2
      omega
    | false =>
      simpa [hzero] using hStride
  have : oid < 32 * game.strideObj := by
    rw [Nat.mul_comm]
    exact Nat.lt_of_lt_of_le hOid hge
  exact Nat.div_lt_of_lt_mul this

theorem Board.maskGetBit_cellObjWords_setCellObjWords_same
    (b : Board) (tile : Nat) (ws : MaskWords) (oid : Nat)
    (hWord : oid / 32 < b.strideObj)
    (hRange : tile * b.strideObj + b.strideObj ≤ b.objects.size) :
    maskGetBit ((b.setCellObjWords tile ws).cellObjWords tile) oid =
      maskGetBit ws oid := by
  have hget := Board.objects_getD_setCellObjWords_same b tile (oid / 32) ws hWord hRange
  have hsz := Board.setCellObjWords_size b tile ws
  have hstride : (b.setCellObjWords tile ws).strideObj = b.strideObj := by
    simp [Board.setCellObjWords]
  simp only [maskGetBit, maskWord, Board.cellObjWords, hstride]
  let start := tile * b.strideObj
  let stop := tile * b.strideObj + b.strideObj
  have hx := Array.getD_extract (b.setCellObjWords tile ws).objects start stop (oid / 32) (0 : UInt32)
  have hIn : oid / 32 < ((b.setCellObjWords tile ws).objects.extract start stop).size := by
    have : ((b.setCellObjWords tile ws).objects.extract start stop).size =
        min stop (b.setCellObjWords tile ws).objects.size - start := Array.size_extract
    simp only [this, hsz]
    omega
  rw [hx, if_pos hIn]
  exact congrArg (fun w : UInt32 => w.toBitVec.getLsbD (oid % 32)) hget

theorem Board.tile_range_le_objects
    (game : Game) (b : Board) (tile : Nat)
    (hB : Board.WellFormed game b) (hTile : tile < b.nTiles) :
    tile * b.strideObj + b.strideObj ≤ b.objects.size := by
  have hsz := Board.wellFormed_objects_size game b hB
  rw [hsz, ← Nat.succ_mul]
  exact Nat.mul_le_mul_right _ (Nat.succ_le_of_lt hTile)

theorem Board.maskGetBit_setCellObjWords_same_of_wf
    (game : Game) (b : Board) (tile : Nat) (ws : MaskWords) (oid : Nat)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hTile : tile < b.nTiles) (hOid : oid < game.objectCount) :
    maskGetBit ((b.setCellObjWords tile ws).cellObjWords tile) oid =
      maskGetBit ws oid := by
  have hWordG := Game.wellFormed_oid_word_lt_stride game hG oid hOid
  have hStride := Board.wellFormed_strideObj game b hB
  have hWord : oid / 32 < b.strideObj := by omega
  exact Board.maskGetBit_cellObjWords_setCellObjWords_same b tile ws oid hWord
    (Board.tile_range_le_objects game b tile hB hTile)

theorem Board.maskGetBit_setCellObjWords_ne_of_wf
    (game : Game) (b : Board) (tile t : Nat) (ws : MaskWords) (oid : Nat)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hne : tile ≠ t) (hOid : oid < game.objectCount) :
    maskGetBit ((b.setCellObjWords tile ws).cellObjWords t) oid =
      maskGetBit (b.cellObjWords t) oid := by
  have hWordG := Game.wellFormed_oid_word_lt_stride game hG oid hOid
  have hStride := Board.wellFormed_strideObj game b hB
  have hWord : oid / 32 < b.strideObj := by omega
  exact Board.maskGetBit_cellObjWords_setCellObjWords_ne b tile t ws oid hne hWord

theorem Bool.eq_iff_eq_true (a b : Bool) : a = b ↔ (a = true ↔ b = true) := by
  cases a <;> cases b <;> simp

theorem cellMaskObjectsOk_congr_bits
    (game : Game) (ws₁ ws₂ : MaskWords)
    (h : ∀ oid ∈ List.range game.objectCount, maskGetBit ws₁ oid = maskGetBit ws₂ oid) :
    cellMaskObjectsOk game ws₁ = cellMaskObjectsOk game ws₂ := by
  rw [Bool.eq_iff_eq_true]
  constructor
  · intro h1
    refine List.all_eq_true.mpr ?_
    intro oid hMem
    have hb := h oid hMem
    have hOne := (List.all_eq_true.mp h1) oid hMem
    simpa [cellMaskObjectsOk, hb] using hOne
  · intro h2
    refine List.all_eq_true.mpr ?_
    intro oid hMem
    have hb := (h oid hMem).symm
    have hOne := (List.all_eq_true.mp h2) oid hMem
    simpa [cellMaskObjectsOk, hb] using hOne

theorem cellMaskLayersOk_congr_bits
    (game : Game) (ws₁ ws₂ : MaskWords)
    (h : ∀ oid ∈ List.range game.objectCount, maskGetBit ws₁ oid = maskGetBit ws₂ oid) :
    cellMaskLayersOk game ws₁ = cellMaskLayersOk game ws₂ := by
  have hCount : ∀ layer, cellMaskLayerCount game ws₁ layer = cellMaskLayerCount game ws₂ layer := by
    intro layer
    simp only [cellMaskLayerCount, objectsSetCountOnLayer]
    congr 1
    refine List.filter_congr ?_
    intro oid hMem
    simp [h oid hMem]
  simp only [cellMaskLayersOk]
  rw [Bool.eq_iff_eq_true]
  constructor
  · intro h1
    refine List.all_eq_true.mpr ?_
    intro layer hMem
    have hOne := (List.all_eq_true.mp h1) layer hMem
    simpa [hCount layer] using hOne
  · intro h2
    refine List.all_eq_true.mpr ?_
    intro layer hMem
    have hOne := (List.all_eq_true.mp h2) layer hMem
    simpa [hCount layer] using hOne

theorem Board.tileObjectsOk_setCellObjWords_ne
    (game : Game) (b : Board) (tile t : Nat) (ws : MaskWords)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) (hne : tile ≠ t) :
    Board.tileObjectsOk game (b.setCellObjWords tile ws) t =
      Board.tileObjectsOk game b t := by
  simp only [Board.tileObjectsOk_eq_cellMask]
  refine cellMaskObjectsOk_congr_bits _ _ _ ?_
  intro oid hMem
  exact Board.maskGetBit_setCellObjWords_ne_of_wf game b tile t ws oid hG hB hne (List.mem_range.mp hMem)

theorem Board.tileLayersOk_setCellObjWords_ne
    (game : Game) (b : Board) (tile t : Nat) (ws : MaskWords)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) (hne : tile ≠ t) :
    Board.tileLayersOk game (b.setCellObjWords tile ws) t =
      Board.tileLayersOk game b t := by
  simp only [Board.tileLayersOk_eq_cellMask]
  refine cellMaskLayersOk_congr_bits _ _ _ ?_
  intro oid hMem
  exact Board.maskGetBit_setCellObjWords_ne_of_wf game b tile t ws oid hG hB hne (List.mem_range.mp hMem)

theorem Board.tileObjectsOk_setCellObjWords_same
    (game : Game) (b : Board) (tile : Nat) (ws : MaskWords)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) (hTile : tile < b.nTiles) :
    Board.tileObjectsOk game (b.setCellObjWords tile ws) tile =
      cellMaskObjectsOk game ws := by
  simp only [Board.tileObjectsOk_eq_cellMask]
  refine cellMaskObjectsOk_congr_bits _ _ _ ?_
  intro oid hMem
  exact Board.maskGetBit_setCellObjWords_same_of_wf game b tile ws oid hG hB hTile (List.mem_range.mp hMem)

theorem Board.tileLayersOk_setCellObjWords_same
    (game : Game) (b : Board) (tile : Nat) (ws : MaskWords)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) (hTile : tile < b.nTiles) :
    Board.tileLayersOk game (b.setCellObjWords tile ws) tile =
      cellMaskLayersOk game ws := by
  simp only [Board.tileLayersOk_eq_cellMask]
  refine cellMaskLayersOk_congr_bits _ _ _ ?_
  intro oid hMem
  exact Board.maskGetBit_setCellObjWords_same_of_wf game b tile ws oid hG hB hTile (List.mem_range.mp hMem)

theorem Board.setCellObjWords_wellFormed
    (game : Game) (b : Board) (tile : Nat) (ws : MaskWords)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) (hTile : tile < b.nTiles)
    (hObj : cellMaskObjectsOk game ws = true) (hLay : cellMaskLayersOk game ws = true) :
    Board.WellFormed game (b.setCellObjWords tile ws) := by
  refine Board.setCellObjWords_wellFormed_of_tilesOk game b tile ws hB ?_
  refine List.all_eq_true.mpr ?_
  intro t hMem
  have ht : t < b.nTiles := List.mem_range.mp hMem
  by_cases heq : tile = t
  · subst heq
    rw [Board.tileObjectsOk_setCellObjWords_same game b tile ws hG hB hTile, hObj,
      Board.tileLayersOk_setCellObjWords_same game b tile ws hG hB hTile, hLay]
    simp
  · have hObjT : Board.tileObjectsOk game b t = true := by
      simp only [Board.WellFormed, Board.wellFormed] at hB
      have hTiles := (Bool.and_eq_true_iff.mp hB).2
      have hOne := (List.all_eq_true.mp hTiles) t hMem
      exact (Bool.and_eq_true_iff.mp hOne).1
    have hLayT : Board.tileLayersOk game b t = true := by
      simp only [Board.WellFormed, Board.wellFormed] at hB
      have hTiles := (Bool.and_eq_true_iff.mp hB).2
      have hOne := (List.all_eq_true.mp hTiles) t hMem
      exact (Bool.and_eq_true_iff.mp hOne).2
    rw [Board.tileObjectsOk_setCellObjWords_ne game b tile t ws hG hB heq, hObjT,
      Board.tileLayersOk_setCellObjWords_ne game b tile t ws hG hB heq, hLayT]
    simp

theorem Board.setCellObjWords_wellFormed_maskApplyReplacement
    (game : Game) (b : Board) (tile : Nat) (clear setM : MaskWords)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) (hTile : tile < b.nTiles)
    (hRep : ReplacementObjectsOk game clear setM = true) :
    Board.WellFormed game (b.setCellObjWords tile (maskApplyReplacement (b.cellObjWords tile) clear setM)) := by
  have hObjOld : cellMaskObjectsOk game (b.cellObjWords tile) = true := by
    simp only [← Board.tileObjectsOk_eq_cellMask]
    simp only [Board.WellFormed, Board.wellFormed] at hB
    have hTiles := (Bool.and_eq_true_iff.mp hB).2
    have hMem : tile ∈ List.range b.nTiles := List.mem_range.mpr hTile
    exact (Bool.and_eq_true_iff.mp ((List.all_eq_true.mp hTiles) tile hMem)).1
  have hLayOld : cellMaskLayersOk game (b.cellObjWords tile) = true := by
    simp only [← Board.tileLayersOk_eq_cellMask]
    simp only [Board.WellFormed, Board.wellFormed] at hB
    have hTiles := (Bool.and_eq_true_iff.mp hB).2
    have hMem : tile ∈ List.range b.nTiles := List.mem_range.mpr hTile
    exact (Bool.and_eq_true_iff.mp ((List.all_eq_true.mp hTiles) tile hMem)).2
  exact Board.setCellObjWords_wellFormed game b tile _ hG hB hTile
    (cellMaskObjectsOk_maskApplyReplacement game _ clear setM hObjOld hRep)
    (cellMaskLayersOk_maskApplyReplacement game _ clear setM hG hLayOld hRep)


theorem Board.applyRigidCellMasks_wellFormed
    (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern)
    (h : Board.WellFormed game b) :
    Board.WellFormed game (applyRigidCellMasks game rule b tile pat).1 := by
  unfold applyRigidCellMasks
  cases rule.rigid with
  | false => simp; exact h
  | true =>
    simp only [Bool.not_true]
    cases (maskNoBitsInCommon
        (buildRigidGroupMask game rule.groupNumber pat.movementsLayerMask b.strideMov)
        (b.cellRigidGroupIndexMask tile) &&
      maskNoBitsInCommon pat.movementsLayerMask (b.cellRigidMovementAppliedMask tile)) with
    | false => simp; exact h
    | true =>
      simp only
      exact Board.setCellRigidMovementAppliedMask_wellFormed game _ tile _
        (Board.setCellRigidGroupIndexMask_wellFormed game b tile _ h)

theorem Board.applyRigidCellMasks_cellWords
    (game : Game) (rule : Rule) (b : Board) (tile t : Nat) (pat : CellPattern) :
    (applyRigidCellMasks game rule b tile pat).1.cellObjWords t = b.cellObjWords t ∧
      (applyRigidCellMasks game rule b tile pat).1.cellMovWords t = b.cellMovWords t := by
  unfold applyRigidCellMasks
  cases rule.rigid with
  | false => simp
  | true =>
    simp only [Bool.not_true]
    cases (maskNoBitsInCommon
        (buildRigidGroupMask game rule.groupNumber pat.movementsLayerMask b.strideMov)
        (b.cellRigidGroupIndexMask tile) &&
      maskNoBitsInCommon pat.movementsLayerMask (b.cellRigidMovementAppliedMask tile)) with
    | false => simp
    | true =>
      simp [Board.setCellRigidMovementAppliedMask, Board.setCellRigidGroupIndexMask,
        Board.cellObjWords, Board.cellMovWords]

theorem Board.applyRigidCellMasks_cellObjWords
    (game : Game) (rule : Rule) (b : Board) (tile t : Nat) (pat : CellPattern) :
    (applyRigidCellMasks game rule b tile pat).1.cellObjWords t = b.cellObjWords t :=
  (Board.applyRigidCellMasks_cellWords game rule b tile t pat).1

theorem Board.applyRigidCellMasks_nTiles
    (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern) :
    (applyRigidCellMasks game rule b tile pat).1.nTiles = b.nTiles := by
  unfold applyRigidCellMasks
  cases rule.rigid with
  | false => simp
  | true =>
    simp only [Bool.not_true]
    cases (maskNoBitsInCommon
        (buildRigidGroupMask game rule.groupNumber pat.movementsLayerMask b.strideMov)
        (b.cellRigidGroupIndexMask tile) &&
      maskNoBitsInCommon pat.movementsLayerMask (b.cellRigidMovementAppliedMask tile)) with
    | false => simp
    | true =>
      simp [Board.setCellRigidMovementAppliedMask, Board.setCellRigidGroupIndexMask, Board.nTiles]

theorem Board.applyRigidCellMasks_cellMovWords
    (game : Game) (rule : Rule) (b : Board) (tile t : Nat) (pat : CellPattern) :
    (applyRigidCellMasks game rule b tile pat).1.cellMovWords t = b.cellMovWords t :=
  (Board.applyRigidCellMasks_cellWords game rule b tile t pat).2

/-- `commitCellReplacement` only mutates object/movement words at `tile`. -/
theorem Board.commitCellReplacement_preserves_other_tiles
    (game : Game) (rule : Rule) (b : Board) (tile other : Nat) (pat : CellPattern)
    (objectsClear objectsSet movementsClear movementsSet : MaskWords) (rng : RngState)
    (hne : other ≠ tile) :
    let r := commitCellReplacement game rule b tile pat
      objectsClear objectsSet movementsClear movementsSet rng
    r.2.1.cellObjWords other = b.cellObjWords other ∧
      r.2.1.cellMovWords other = b.cellMovWords other := by
  dsimp only [commitCellReplacement]
  generalize hRigid : applyRigidCellMasks game rule b tile pat = rigidPair
  rcases rigidPair with ⟨board0, rigidChange⟩
  dsimp only
  have hObj0 : board0.cellObjWords other = b.cellObjWords other := by
    simpa [hRigid] using Board.applyRigidCellMasks_cellObjWords game rule b tile other pat
  have hMov0 : board0.cellMovWords other = b.cellMovWords other := by
    simpa [hRigid] using Board.applyRigidCellMasks_cellMovWords game rule b tile other pat
  cases hCond :
      ((maskApplyReplacement (b.cellObjWords tile) objectsClear objectsSet == b.cellObjWords tile) &&
        (maskApplyReplacement (b.cellMovWords tile) (maskOr movementsClear pat.movementsLayerMask)
            movementsSet ==
          b.cellMovWords tile) &&
        !rigidChange) with
  | true =>
    simp [hCond]
  | false =>
    simp [hCond]
    have htileNe : tile ≠ other := Ne.symm hne
    refine ⟨?obj, ?mov⟩
    · rw [Board.cellObjWords_setCellMovWords,
        Board.cellObjWords_setCellObjWords_ne board0 tile other _ htileNe, hObj0]
    · rw [Board.cellMovWords_setCellMovWords_ne _ tile other _ htileNe,
        Board.cellMovWords_setCellObjWords board0 tile other _, hMov0]

/-- `applyCellReplacement` only mutates object/movement words at `tile`. -/
theorem applyCellReplacement_preserves_other_tiles
    (game : Game) (rule : Rule) (b : Board) (tile other : Nat) (pat : CellPattern)
    (caps : RuleCaptures) (rng : RngState)
    (hne : other ≠ tile) :
    let r := applyCellReplacement game rule b tile pat caps rng
    r.2.1.cellObjWords other = b.cellObjWords other ∧
      r.2.1.cellMovWords other = b.cellMovWords other := by
  dsimp only [applyCellReplacement]
  by_cases hs : rule.skipCellWrites = true
  · simp [hs]
  · simp only [hs, ↓reduceIte]
    by_cases hNo : (!pat.hasReplacement) = true
    · rw [if_pos hNo]
      exact ⟨rfl, rfl⟩
    · rw [if_neg hNo]
      exact Board.commitCellReplacement_preserves_other_tiles game rule b tile other pat
        _ _ _ _ _ hne

theorem Board.commitCellReplacement_wellFormed
    (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern)
    (objectsClear objectsSet movementsClear movementsSet : MaskWords) (rng : RngState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) (hTile : tile < b.nTiles)
    (hRep : ReplacementObjectsOk game objectsClear objectsSet = true) :
    Board.WellFormed game
      (commitCellReplacement game rule b tile pat objectsClear objectsSet movementsClear movementsSet rng).2.1 := by
  dsimp only [commitCellReplacement]
  generalize hRigid : applyRigidCellMasks game rule b tile pat = rigidPair
  rcases rigidPair with ⟨board0, rigidChange⟩
  dsimp only at *
  have hBoard0 : Board.WellFormed game board0 := by
    have := Board.applyRigidCellMasks_wellFormed game rule b tile pat hB
    simpa [hRigid] using this
  have hTile0 : tile < board0.nTiles := by
    have := Board.applyRigidCellMasks_nTiles game rule b tile pat
    simp [hRigid] at this
    omega
  have hObjEq : board0.cellObjWords tile = b.cellObjWords tile := by
    have := Board.applyRigidCellMasks_cellObjWords game rule b tile tile pat
    simpa [hRigid] using this
  cases hCond :
      ((maskApplyReplacement (b.cellObjWords tile) objectsClear objectsSet == b.cellObjWords tile) &&
        (maskApplyReplacement (b.cellMovWords tile) (maskOr movementsClear pat.movementsLayerMask)
            movementsSet ==
          b.cellMovWords tile) &&
        !rigidChange) with
  | true =>
    simp [hCond]
    exact hB
  | false =>
    simp [hCond]
    have hObj : Board.WellFormed game
        (board0.setCellObjWords tile
          (maskApplyReplacement (b.cellObjWords tile) objectsClear objectsSet)) := by
      have : maskApplyReplacement (b.cellObjWords tile) objectsClear objectsSet =
          maskApplyReplacement (board0.cellObjWords tile) objectsClear objectsSet := by
        simp [hObjEq]
      rw [this]
      exact Board.setCellObjWords_wellFormed_maskApplyReplacement game board0 tile
        objectsClear objectsSet hG hBoard0 hTile0 hRep
    exact Board.setCellMovWords_wellFormed game _ tile _ hObj


theorem Array.size_foldl_push_range {α : Type} (f : Nat → α) (n : Nat) :
    ((List.range n).foldl (fun out i => out.push (f i)) (#[] : Array α)).size = n := by
  have h : (List.range n).foldl (fun out i => out.push (f i)) (#[] : Array α) =
      (#[] : Array α) ++ (List.map f (List.range n)).toArray :=
    List.foldl_push_eq_append
  simp [h, List.length_map, List.length_range]

theorem Array.getD_foldl_push_range {α : Type} (f : Nat → α) (n i : Nat) (d : α)
    (hi : i < n) :
    ((List.range n).foldl (fun out i => out.push (f i)) (#[] : Array α)).getD i d = f i := by
  have hsz := Array.size_foldl_push_range f n
  have hbound : i < ((List.range n).foldl (fun out i => out.push (f i)) (#[] : Array α)).size := by
    simpa [hsz] using hi
  have hget : ((List.range n).foldl (fun out i => out.push (f i)) (#[] : Array α))[i] = f i := by
    have h : (List.range n).foldl (fun out i => out.push (f i)) (#[] : Array α) =
        (List.map f (List.range n)).toArray := by
      simpa using List.foldl_push_eq_append (xs := (#[] : Array α)) (l := List.range n) (f := f)
    simp only [h]
    rw [← Array.getElem_toList]
    simp [List.getElem_map, List.getElem_range]
  simp only [Array.getD, hbound, ↓reduceDIte]
  exact hget

theorem maskWord_maskOr (a b : MaskWords) (i : Nat) :
    maskWord (maskOr a b) i = maskWord a i ||| maskWord b i := by
  show maskWord ((List.range (max a.size b.size)).foldl
      (fun out i => out.push (maskWord a i ||| maskWord b i)) #[]) i =
    maskWord a i ||| maskWord b i
  by_cases hi : i < max a.size b.size
  · have hget := Array.getD_foldl_push_range (fun i => maskWord a i ||| maskWord b i)
      (max a.size b.size) i (0 : UInt32) hi
    simpa [maskWord] using hget
  · have hsz := Array.size_foldl_push_range (fun i => maskWord a i ||| maskWord b i) (max a.size b.size)
    have : ¬ i < ((List.range (max a.size b.size)).foldl
        (fun out i => out.push (maskWord a i ||| maskWord b i)) (#[] : MaskWords)).size := by
      simpa [hsz] using hi
    have ha : ¬ i < a.size := by omega
    have hb : ¬ i < b.size := by omega
    simp [maskWord, Array.getD, this, ha, hb]

theorem maskGetBit_maskOr (a b : MaskWords) (bit : Nat) :
    maskGetBit (maskOr a b) bit = (maskGetBit a bit || maskGetBit b bit) := by
  simp only [maskGetBit, maskWord_maskOr, UInt32.toBitVec_or, getLsbD_or]

theorem maskWord_maskAndNot (a b : MaskWords) (i : Nat) :
    maskWord (maskAndNot a b) i = maskWord a i &&& ~~~maskWord b i := by
  show maskWord ((List.range (max a.size b.size)).foldl
      (fun out i => out.push (maskWord a i &&& ~~~maskWord b i)) #[]) i =
    maskWord a i &&& ~~~maskWord b i
  by_cases hi : i < max a.size b.size
  · have hget := Array.getD_foldl_push_range (fun i => maskWord a i &&& ~~~maskWord b i)
      (max a.size b.size) i (0 : UInt32) hi
    simpa [maskWord] using hget
  · have hsz := Array.size_foldl_push_range (fun i => maskWord a i &&& ~~~maskWord b i) (max a.size b.size)
    have : ¬ i < ((List.range (max a.size b.size)).foldl
        (fun out i => out.push (maskWord a i &&& ~~~maskWord b i)) (#[] : MaskWords)).size := by
      simpa [hsz] using hi
    have ha : ¬ i < a.size := by omega
    have hb : ¬ i < b.size := by omega
    simp [maskWord, Array.getD, this, ha, hb]

theorem maskGetBit_maskAndNot (a b : MaskWords) (bit : Nat) :
    maskGetBit (maskAndNot a b) bit = (maskGetBit a bit && !maskGetBit b bit) := by
  simp only [maskGetBit, maskWord_maskAndNot, UInt32.toBitVec_and]
  rw [UInt32.toBitVec_not]
  have hlt : bit % 32 < 32 := Nat.mod_lt _ (by decide)
  simp [getLsbD_and, getLsbD_not, hlt]


theorem BitVec.or_and_self_left {w : Nat} (x y : BitVec w) : x ||| (x &&& y) = x := by
  apply BitVec.eq_of_getLsbD_eq
  intro i _hi
  cases hx : x.getLsbD i <;> simp [BitVec.getLsbD_or, BitVec.getLsbD_and, hx]

theorem maskBitsSetIn_maskOr_right (req act extra : MaskWords)
    (h : maskBitsSetIn req act = true) :
    maskBitsSetIn req (maskOr act extra) = true := by
  simp only [maskBitsSetIn] at h ⊢
  refine List.all_eq_true.mpr ?_
  intro i _hMem
  have hOr := maskWord_maskOr act extra i
  by_cases hIn : i < max req.size act.size
  · have hWord := (List.all_eq_true.mp h) i (List.mem_range.mpr hIn)
    have heq : (maskWord req i &&& maskWord act i) = maskWord req i := beq_iff_eq.mp hWord
    have hBV :
        (maskWord req i).toBitVec &&& (maskWord act i).toBitVec = (maskWord req i).toBitVec := by
      simpa [UInt32.toBitVec_and] using congrArg UInt32.toBitVec heq
    have : (maskWord req i &&& (maskWord act i ||| maskWord extra i)) = maskWord req i := by
      apply UInt32.eq_of_toBitVec_eq
      simp only [UInt32.toBitVec_and, UInt32.toBitVec_or, BitVec.and_or_distrib_left, hBV,
        BitVec.or_and_self_left]
    simp [hOr, this]
  · have hreq : ¬ i < req.size :=
      Nat.not_lt_of_ge (Nat.le_trans (Nat.le_max_left _ _) (Nat.le_of_not_gt hIn))
    simp [maskWord, Array.getD, hreq]

theorem maskGetBit_maskAndNot_of_layerMask
    (game : Game) (set : MaskWords) (layer oid : Nat)
    (hWF : Game.WellFormed game) (hOid : oid < game.objectCount)
    (hLayer : layer < game.layerCount)
    (hOn : (game.objectLayers.getD oid ⟨0⟩).val = layer) :
    maskGetBit (maskAndNot set (game.layerMasks.getD layer #[])) oid = false := by
  have hBit := Game.layerMask_getBit_of_onLayer game oid layer hWF hOid hLayer hOn
  rw [maskGetBit_maskAndNot, hBit]; simp

theorem objectsSetCountOnLayer_maskAndNot_layer
    (game : Game) (set : MaskWords) (layer : Nat)
    (hWF : Game.WellFormed game) (hLayer : layer < game.layerCount) :
    objectsSetCountOnLayer game (maskAndNot set (game.layerMasks.getD layer #[])) layer = 0 := by
  have hNil :
      (List.range game.objectCount).filter (fun oid =>
        maskGetBit (maskAndNot set (game.layerMasks.getD layer #[])) oid &&
          ((game.objectLayers.getD oid ⟨0⟩).val == layer)) = [] := by
    refine List.filter_eq_nil_iff.mpr ?_
    intro oid hMem hp
    obtain ⟨hGet, hOnB⟩ := Bool.and_eq_true_iff.mp hp
    have hOn := beq_iff_eq.mp hOnB
    have hClr := maskGetBit_maskAndNot_of_layerMask game set layer oid hWF (List.mem_range.mp hMem) hLayer hOn
    rw [hClr] at hGet; exact Bool.noConfusion hGet
  simpa [objectsSetCountOnLayer] using congrArg List.length hNil

theorem List.nodup_filter' {α : Type} {l : List α} (p : α → Bool) (h : l.Nodup) :
    (l.filter p).Nodup := by
  induction l with
  | nil => simp
  | cons x xs ih =>
    have ⟨hnotin, hxs⟩ := List.nodup_cons.mp h
    simp only [List.filter]
    by_cases hp : p x = true
    · simp only [hp, ↓reduceIte]
      refine List.nodup_cons.mpr ⟨?_, ih hxs⟩
      intro hmem
      exact hnotin (List.mem_filter.mp hmem).1
    · simp only [hp, Bool.false_eq_true, ↓reduceIte]
      exact ih hxs

theorem List.length_le_one_of_forall_eq {α : Type} {l : List α}
    (hnd : l.Nodup) (h : ∀ a ∈ l, ∀ b ∈ l, a = b) : l.length ≤ 1 := by
  match l with
  | [] => simp
  | [_] => simp
  | x :: y :: ys =>
    exact False.elim ((List.nodup_cons.mp hnd).1 (h x (by simp) y (by simp) ▸ by simp))

theorem objectsSetCountOnLayer_after_setObjectOnLayer
    (game : Game) (set : MaskWords) (oid layer : Nat)
    (hWF : Game.WellFormed game) (hOid : oid < game.objectCount)
    (hLayer : layer < game.layerCount)
    (hOn : (game.objectLayers.getD oid ⟨0⟩).val = layer) :
    objectsSetCountOnLayer game
      (maskSetBit (maskAndNot set (game.layerMasks.getD layer #[])) oid true) layer = 1 := by
  let set0 := maskAndNot set (game.layerMasks.getD layer #[])
  have hZero := objectsSetCountOnLayer_maskAndNot_layer game set layer hWF hLayer
  let p : Nat → Bool := fun x =>
    maskGetBit (maskSetBit set0 oid true) x && ((game.objectLayers.getD x ⟨0⟩).val == layer)
  have hOidP : p oid = true :=
    Bool.and_eq_true_iff.mpr ⟨by simp [maskGetBit_maskSetBit_same], beq_iff_eq.mpr hOn⟩
  have hOnly : ∀ x ∈ List.range game.objectCount, p x = true → x = oid := by
    intro x hx hp
    obtain ⟨hGet, hOnX⟩ := Bool.and_eq_true_iff.mp hp
    by_cases hxe : x = oid
    · exact hxe
    · have hGet0 : maskGetBit set0 x = true := by
        rwa [maskGetBit_maskSetBit_ne set0 oid x true (Ne.symm hxe)] at hGet
      have hNil :
          (List.range game.objectCount).filter (fun y =>
            maskGetBit set0 y && ((game.objectLayers.getD y ⟨0⟩).val == layer)) = [] := by
        have hlen0 :
            ((List.range game.objectCount).filter (fun y =>
              maskGetBit set0 y && ((game.objectLayers.getD y ⟨0⟩).val == layer))).length = 0 := by
          simpa [objectsSetCountOnLayer, set0] using hZero
        exact List.eq_nil_of_length_eq_zero hlen0
      have hIn :
          x ∈ (List.range game.objectCount).filter (fun y =>
            maskGetBit set0 y && ((game.objectLayers.getD y ⟨0⟩).val == layer)) :=
        List.mem_filter.mpr ⟨hx, Bool.and_eq_true_iff.mpr ⟨hGet0, hOnX⟩⟩
      rw [hNil] at hIn; cases hIn
  have hMem := List.mem_filter.mpr ⟨List.mem_range.mpr hOid, hOidP⟩
  have hlen_pos := List.length_pos_of_mem hMem
  have hnd : ((List.range game.objectCount).filter p).Nodup :=
    List.nodup_filter' (l := List.range game.objectCount) p List.nodup_range
  have hlen_le : ((List.range game.objectCount).filter p).length ≤ 1 :=
    List.length_le_one_of_forall_eq hnd fun a ha b hb =>
      (hOnly a (List.mem_filter.mp ha).1 (List.mem_filter.mp ha).2).trans
        (hOnly b (List.mem_filter.mp hb).1 (List.mem_filter.mp hb).2).symm
  have hlen : ((List.range game.objectCount).filter p).length = 1 := by omega
  simp only [objectsSetCountOnLayer, set0]
  exact hlen


theorem ReplacementObjectsOk_maskOr_clear
    (game : Game) (clear set extra : MaskWords)
    (hRep : ReplacementObjectsOk game clear set = true) :
    ReplacementObjectsOk game (maskOr clear extra) set = true := by
  simp only [ReplacementObjectsOk] at hRep ⊢
  obtain ⟨hCnt, hClr⟩ := Bool.and_eq_true_iff.mp hRep
  refine Bool.and_eq_true_iff.mpr ⟨hCnt, ?_⟩
  refine List.all_eq_true.mpr ?_
  intro oid hMem
  have hOne := (List.all_eq_true.mp hClr) oid hMem
  by_cases hSet : maskGetBit set oid = true
  · simp only [hSet, Bool.not_true, Bool.false_or] at hOne ⊢
    obtain ⟨hLayer, hMask⟩ := Bool.and_eq_true_iff.mp hOne
    exact Bool.and_eq_true_iff.mpr ⟨hLayer, maskBitsSetIn_maskOr_right _ _ _ hMask⟩
  · have hSetF := eq_false_of_ne_true hSet
    simpa [hSetF] using hOne

theorem objectsSetCountOnLayer_maskAndNot_le
    (game : Game) (set m : MaskWords) (ℓ : Nat) :
    objectsSetCountOnLayer game (maskAndNot set m) ℓ ≤
      objectsSetCountOnLayer game set ℓ := by
  refine objectsSetCountOnLayer_mono _ _ _ _ ?_
  intro oid hMem hBits
  obtain ⟨hGet, hOn⟩ := Bool.and_eq_true_iff.mp hBits
  have hGet' : maskGetBit set oid = true := by
    have := maskGetBit_maskAndNot set m oid
    rw [this] at hGet
    exact (Bool.and_eq_true_iff.mp hGet).1
  exact Bool.and_eq_true_iff.mpr ⟨hGet', hOn⟩

theorem objectsSetCountOnLayer_maskSetBit_ne_layer
    (game : Game) (set : MaskWords) (oid ℓ : Nat) (val : Bool)
    (hOn : (game.objectLayers.getD oid ⟨0⟩).val ≠ ℓ) :
    objectsSetCountOnLayer game (maskSetBit set oid val) ℓ =
      objectsSetCountOnLayer game set ℓ := by
  simp only [objectsSetCountOnLayer]
  congr 1
  refine List.filter_congr ?_
  intro x _hx
  by_cases hxe : x = oid
  · subst hxe
    have hFalse : ((game.objectLayers.getD x ⟨0⟩).val == ℓ) = false :=
      eq_false_of_ne_true (mt beq_iff_eq.mp hOn)
    simp only [hFalse, Bool.and_false]
  · rw [maskGetBit_maskSetBit_ne set oid x val (Ne.symm hxe)]

def setObjectOnLayer (game : Game) (clear set : MaskWords) (oid : Nat) : MaskWords × MaskWords :=
  let layer := (game.objectLayers.getD oid ⟨0⟩).val
  let layerMask := game.layerMasks.getD layer #[]
  (maskOr clear layerMask, maskSetBit (maskAndNot set layerMask) oid true)

theorem ReplacementObjectsOk_setObjectOnLayer
    (game : Game) (clear set : MaskWords) (oid : Nat)
    (hG : Game.WellFormed game) (hOid : oid < game.objectCount)
    (hLayer : (game.objectLayers.getD oid ⟨0⟩).val < game.layerCount)
    (hRep : ReplacementObjectsOk game clear set = true) :
    ReplacementObjectsOk game
      (setObjectOnLayer game clear set oid).1
      (setObjectOnLayer game clear set oid).2 = true := by
  dsimp only [setObjectOnLayer]
  let layer := (game.objectLayers.getD oid ⟨0⟩).val
  let layerMask := game.layerMasks.getD layer #[]
  let c' := maskOr clear layerMask
  let s' := maskSetBit (maskAndNot set layerMask) oid true
  change ReplacementObjectsOk game c' s' = true
  have hOn : (game.objectLayers.getD oid ⟨0⟩).val = layer := rfl
  simp only [ReplacementObjectsOk]
  refine Bool.and_eq_true_iff.mpr ⟨?_, ?_⟩
  · refine List.all_eq_true.mpr ?_
    intro ℓ hMem
    have hℓ : ℓ < game.layerCount := List.mem_range.mp hMem
    by_cases hEq : ℓ = layer
    · subst hEq
      have hCnt := objectsSetCountOnLayer_after_setObjectOnLayer game set oid layer hG hOid hLayer hOn
      exact decide_eq_true (Nat.le_of_eq hCnt)
    · have hOld : objectsSetCountOnLayer game set ℓ ≤ 1 :=
        ReplacementObjectsOk_set_count_le game clear set ℓ hRep hℓ
      have hAnd : objectsSetCountOnLayer game (maskAndNot set layerMask) ℓ ≤
          objectsSetCountOnLayer game set ℓ :=
        objectsSetCountOnLayer_maskAndNot_le game set layerMask ℓ
      have hSet :
          objectsSetCountOnLayer game s' ℓ =
            objectsSetCountOnLayer game (maskAndNot set layerMask) ℓ := by
        have : (game.objectLayers.getD oid ⟨0⟩).val ≠ ℓ := by
          intro h; exact hEq (h.symm.trans hOn)
        simpa [s'] using objectsSetCountOnLayer_maskSetBit_ne_layer game
          (maskAndNot set layerMask) oid ℓ true this
      have : objectsSetCountOnLayer game s' ℓ ≤ 1 :=
        Nat.le_trans (hSet ▸ hAnd) hOld
      exact decide_eq_true this
  · refine List.all_eq_true.mpr ?_
    intro x hMem
    have hx : x < game.objectCount := List.mem_range.mp hMem
    by_cases hSetX : maskGetBit s' x = true
    · simp only [hSetX, Bool.not_true, Bool.false_or]
      by_cases hxe : x = oid
      · subst hxe
        refine Bool.and_eq_true_iff.mpr ⟨decide_eq_true hLayer, ?_⟩
        have : maskBitsSetIn layerMask c' = true := by
          -- layerMask ⊆ maskOr clear layerMask
          have : maskBitsSetIn layerMask (maskOr clear layerMask) = true := by
            simp only [maskBitsSetIn]
            refine List.all_eq_true.mpr ?_
            intro i _
            have hOr := maskWord_maskOr clear layerMask i
            -- (lm &&& (c|||lm)) = lm
            have : (maskWord layerMask i &&& (maskWord clear i ||| maskWord layerMask i)) =
                maskWord layerMask i := by
              apply UInt32.eq_of_toBitVec_eq
              simp only [UInt32.toBitVec_and, UInt32.toBitVec_or, BitVec.and_or_distrib_left]
              -- lm &&& c ||| lm &&& lm = ... ||| lm = lm
              simp [BitVec.and_self]
              -- need (lm &&& c) ||| lm = lm
              apply BitVec.eq_of_getLsbD_eq
              intro j hj
              cases hx : (maskWord layerMask i).toBitVec.getLsbD j <;>
                simp [BitVec.getLsbD_or, BitVec.getLsbD_and, hx]
            simpa [hOr, this, beq_iff_eq]
          simpa [c', layerMask] using this
        exact this
      · -- x survived from andNot and was in old set with clear ok, clear only grew
        have hGet0 : maskGetBit (maskAndNot set layerMask) x = true := by
          rwa [maskGetBit_maskSetBit_ne (maskAndNot set layerMask) oid x true (Ne.symm hxe)] at hSetX
        have hGetSet : maskGetBit set x = true := by
          have := maskGetBit_maskAndNot set layerMask x
          rw [this] at hGet0
          exact (Bool.and_eq_true_iff.mp hGet0).1
        have hOld := ReplacementObjectsOk_set_layer_clear game clear set x hRep hx hGetSet
        obtain ⟨hLx, hMask⟩ := Bool.and_eq_true_iff.mp hOld
        exact Bool.and_eq_true_iff.mpr ⟨hLx, maskBitsSetIn_maskOr_right _ _ _ hMask⟩
    · simp [eq_false_of_ne_true hSetX]


theorem collectMaskBits_getElem_lt (m : MaskWords) (maxBit i : Nat)
    (hi : i < (collectMaskBits m maxBit).size) :
    (collectMaskBits m maxBit)[i] < maxBit := by
  simp only [collectMaskBits] at hi ⊢
  have hi' : i < ((List.range maxBit).filter (maskGetBit m)).length := by simpa using hi
  have hmem' := List.getElem_mem (l := (List.range maxBit).filter (maskGetBit m)) hi'
  exact List.mem_range.mp (List.mem_filter.mp hmem').1

theorem applyRandomEntityMasks_replacementOk
    (game : Game) (b : Board) (pat : CellPattern)
    (objectsClear objectsSet movementsClear : MaskWords) (rng : RngState)
    (hG : Game.WellFormed game)
    (hRep : ReplacementObjectsOk game objectsClear objectsSet = true)
    (hCompat : CellPattern.randomEntityCompatible game pat = true) :
    ReplacementObjectsOk game
      (applyRandomEntityMasks game b pat objectsClear objectsSet movementsClear rng).1
      (applyRandomEntityMasks game b pat objectsClear objectsSet movementsClear rng).2.1 = true := by
  unfold applyRandomEntityMasks
  by_cases hAny : maskAnyBits pat.randomEntityMask = true
  · simp only [hAny, Bool.not_true]
    by_cases hEmpty : (collectMaskBits pat.randomEntityMask game.objectCount).isEmpty = true
    · simp only [hEmpty]; exact hRep
    · have hE : (collectMaskBits pat.randomEntityMask game.objectCount).isEmpty = false :=
        eq_false_of_ne_true hEmpty
      simp only [hE, Bool.not_false]
      generalize hCh : collectMaskBits pat.randomEntityMask game.objectCount = choices
      generalize hRn : rng.randomNat 0 choices.size = pr
      rcases pr with ⟨idx0, r⟩
      dsimp only
      by_cases hIdx : idx0 < choices.size
      · simp only [hIdx, ↓reduceDIte]
        let oid := choices[idx0]
        have hOid : oid < game.objectCount := by
          have := collectMaskBits_getElem_lt pat.randomEntityMask game.objectCount idx0
            (by simpa [← hCh] using hIdx)
          simpa [oid, ← hCh] using this
        have hBit : maskGetBit pat.randomEntityMask oid = true := by
          have hi' : idx0 < ((List.range game.objectCount).filter
              (maskGetBit pat.randomEntityMask)).length := by
            simpa [← hCh, collectMaskBits] using hIdx
          have hmem := List.getElem_mem
            (l := (List.range game.objectCount).filter (maskGetBit pat.randomEntityMask)) hi'
          have hoid : oid = ((List.range game.objectCount).filter
              (maskGetBit pat.randomEntityMask))[idx0] := by
            simp only [oid, ← hCh, collectMaskBits]; rfl
          simpa [hoid] using (List.mem_filter.mp hmem).2
        have hLayer : (game.objectLayers.getD oid ⟨0⟩).val < game.layerCount := by
          simp only [CellPattern.randomEntityCompatible] at hCompat
          have hAll := (Bool.and_eq_true_iff.mp hCompat).2
          have hOne := (List.all_eq_true.mp hAll) oid (List.mem_range.mpr hOid)
          simpa [hBit] using hOne
        simpa [setObjectOnLayer] using
          ReplacementObjectsOk_setObjectOnLayer game objectsClear objectsSet oid hG hOid hLayer hRep
      · simp only [hIdx, ↓reduceDIte]; exact hRep
  · simp only [eq_false_of_ne_true hAny, Bool.not_false]; exact hRep

/-- Sources only OR into clear — preserves RepOk. -/
theorem foldl_inferredSources_replacementOk
    (game : Game) (caps : RuleCaptures) (sources : List InferredPropertySource)
    (oc os mc ms : MaskWords)
    (hRep : ReplacementObjectsOk game oc os = true) :
    let p := sources.foldl
      (fun (oc, os, mc, ms) s =>
        match caps.getProperty s.propertyName with
        | some cap =>
          (maskOr oc (game.layerMasks.getD cap.layerIndex.val #[]), os,
            setLayerMovementBits mc cap.layerIndex.val 31, ms)
        | none => (oc, os, mc, ms))
      (oc, os, mc, ms)
    ReplacementObjectsOk game p.1 p.2.1 = true := by
  induction sources generalizing oc os mc ms with
  | nil => simpa using hRep
  | cons s rest ih =>
    simp only [List.foldl_cons]
    match hcap : caps.getProperty s.propertyName with
    | none => exact ih _ _ _ _ hRep
    | some cap =>
      exact ih _ _ _ _ (ReplacementObjectsOk_maskOr_clear game oc os _ hRep)

/-- Bindings apply setObjectOnLayer when capture present. -/
theorem foldl_inferredBindings_replacementOk
    (game : Game) (caps : RuleCaptures) (bindings : List InferredPropertyBinding)
    (oc os mc ms : MaskWords)
    (hG : Game.WellFormed game)
    (hRep : ReplacementObjectsOk game oc os = true)
    (hOk : ∀ b ∈ bindings, ∀ cap, caps.getProperty b.propertyName = some cap →
      cap.objectId.val < game.objectCount ∧
        (game.objectLayers.getD cap.objectId.val ⟨0⟩).val < game.layerCount) :
    let p := bindings.foldl
      (fun (oc, os, mc, ms) b =>
        match caps.getProperty b.propertyName with
        | some cap =>
          let mc := if b.dirMode != 0 then setLayerMovementBits mc cap.layerIndex.val 31 else mc
          let ms := if b.dirMode != 0 && b.dirMode == 2 then
              setLayerMovementBits ms cap.layerIndex.val (UInt32.ofNat b.dirMask) else ms
          let layer := (game.objectLayers.getD cap.objectId.val ⟨0⟩).val
          let layerMask := game.layerMasks.getD layer #[]
          (maskOr oc layerMask, maskSetBit (maskAndNot os layerMask) cap.objectId.val true, mc, ms)
        | none => (oc, os, mc, ms))
      (oc, os, mc, ms)
    ReplacementObjectsOk game p.1 p.2.1 = true := by
  induction bindings generalizing oc os mc ms with
  | nil => simpa using hRep
  | cons b rest ih =>
    simp only [List.foldl_cons]
    match hcap : caps.getProperty b.propertyName with
    | none => exact ih _ _ _ _ hRep (fun b' hb' => hOk b' (List.mem_cons_of_mem _ hb'))
    | some cap =>
      have ⟨hOid, hLayer⟩ := hOk b (by simp) cap hcap
      have hRep' := ReplacementObjectsOk_setObjectOnLayer game oc os cap.objectId.val hG hOid hLayer hRep
      exact ih _ _ _ _ (by simpa [setObjectOnLayer] using hRep')
        (fun b' hb' => hOk b' (List.mem_cons_of_mem _ hb'))


theorem applyInferredAggregateBinding_objects (caps : RuleCaptures)
    (st : MaskWords × MaskWords × MaskWords × MaskWords) (b : InferredAggregateBinding) :
    (applyInferredAggregateBinding caps st b).1 = st.1 ∧
      (applyInferredAggregateBinding caps st b).2.1 = st.2.1 := by
  rcases st with ⟨oc, os, mc, ms⟩
  dsimp only [applyInferredAggregateBinding]
  cases hAgg : caps.getAggregate b.aggregateName with
  | none => simp
  | some captured =>
    cases hl : b.layerIndex with
    | some l => simp
    | none =>
      cases hp : b.propertyName with
      | none => simp
      | some pname =>
        cases hc : caps.getProperty pname with
        | none => simp [hc]
        | some cap => simp [hc]

theorem foldl_inferredAggregates_objects_eq (caps : RuleCaptures)
    (aggs : List InferredAggregateBinding) (oc os mc ms : MaskWords) :
    (aggs.foldl (applyInferredAggregateBinding caps) (oc, os, mc, ms)).1 = oc ∧
      (aggs.foldl (applyInferredAggregateBinding caps) (oc, os, mc, ms)).2.1 = os := by
  induction aggs generalizing oc os mc ms with
  | nil => simp
  | cons b rest ih =>
    simp only [List.foldl_cons]
    have h := applyInferredAggregateBinding_objects caps (oc, os, mc, ms) b
    have ih' := ih (applyInferredAggregateBinding caps (oc, os, mc, ms) b).1
      (applyInferredAggregateBinding caps (oc, os, mc, ms) b).2.1
      (applyInferredAggregateBinding caps (oc, os, mc, ms) b).2.2.1
      (applyInferredAggregateBinding caps (oc, os, mc, ms) b).2.2.2
    exact ⟨ih'.1.trans h.1, ih'.2.trans h.2⟩

theorem applyInferredPropertyAndBindingMasks_replacementOk
    (game : Game) (pat : CellPattern) (caps : RuleCaptures)
    (oc os mc ms : MaskWords)
    (hG : Game.WellFormed game)
    (hRep : ReplacementObjectsOk game oc os = true)
    (hOk : ∀ b ∈ pat.inferredPropertyBindings.toList, ∀ cap,
      caps.getProperty b.propertyName = some cap →
        cap.objectId.val < game.objectCount ∧
          (game.objectLayers.getD cap.objectId.val ⟨0⟩).val < game.layerCount) :
    ReplacementObjectsOk game
      (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms).1
      (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms).2.1 = true := by
  unfold applyInferredPropertyAndBindingMasks
  have hSrc := foldl_inferredSources_replacementOk game caps
    pat.inferredPropertySources.toList oc os mc ms hRep
  simp only [← Array.foldl_toList] at hSrc ⊢
  exact foldl_inferredBindings_replacementOk game caps
    pat.inferredPropertyBindings.toList _ _ _ _ hG hSrc hOk

theorem applyInferredReplacementFields_replacementOk
    (game : Game) (pat : CellPattern) (caps : RuleCaptures)
    (objs movs oc os mc ms : MaskWords)
    (hG : Game.WellFormed game)
    (hRep : ReplacementObjectsOk game oc os = true)
    (hOk : ∀ b ∈ pat.inferredPropertyBindings.toList, ∀ cap,
      caps.getProperty b.propertyName = some cap →
        cap.objectId.val < game.objectCount ∧
          (game.objectLayers.getD cap.objectId.val ⟨0⟩).val < game.layerCount) :
    ReplacementObjectsOk game
      (applyInferredReplacementFields game pat caps objs movs oc os mc ms).1
      (applyInferredReplacementFields game pat caps objs movs oc os mc ms).2.1 = true := by
  unfold applyInferredReplacementFields
  have hBind := applyInferredPropertyAndBindingMasks_replacementOk game pat caps oc os mc ms hG hRep hOk
  have hAgg := foldl_inferredAggregates_objects_eq caps
    pat.inferredAggregateBindings.toList
    (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms).1
    (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms).2.1
    (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms).2.2.1
    (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms).2.2.2
  have hArr :
      (pat.inferredAggregateBindings.foldl (applyInferredAggregateBinding caps)
        (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms)).1 =
        (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms).1 ∧
      (pat.inferredAggregateBindings.foldl (applyInferredAggregateBinding caps)
        (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms)).2.1 =
        (applyInferredPropertyAndBindingMasks game pat caps oc os mc ms).2.1 := by
    simpa [← Array.foldl_toList] using hAgg
  simpa [hArr.1, hArr.2] using hBind

theorem RuleCaptures.propertiesOk_empty (game : Game) :
    RuleCaptures.propertiesOk game RuleCaptures.empty = true := by
  simp [RuleCaptures.propertiesOk, RuleCaptures.empty]

theorem PropertyAlias.ok_bounds (game : Game) (a : PropertyAlias)
    (h : PropertyAlias.ok game a = true) :
    a.objectId.val < game.objectCount ∧
      (game.objectLayers.getD a.objectId.val ⟨0⟩).val < game.layerCount := by
  simp only [PropertyAlias.ok, Game.validObject] at h
  have ⟨hab, hc⟩ := Bool.and_eq_true_iff.mp h
  have ⟨ha, _hb⟩ := Bool.and_eq_true_iff.mp hab
  exact ⟨of_decide_eq_true ha, of_decide_eq_true hc⟩

theorem RuleCaptures.propertiesOk_getProperty
    (game : Game) (caps : RuleCaptures) (name : String) (cap : PropertyAlias)
    (hCaps : RuleCaptures.propertiesOk game caps = true)
    (hGet : caps.getProperty name = some cap) :
    PropertyAlias.ok game cap = true := by
  simp only [RuleCaptures.getProperty] at hGet
  cases hf : caps.properties.toList.find? (fun p => p.1 == name) with
  | none => simp [hf] at hGet
  | some p =>
    simp [hf] at hGet
    cases hGet
    exact (List.all_eq_true.mp hCaps) p (List.mem_of_find?_eq_some hf)

theorem RuleCaptures.setProperty_propertiesOk
    (game : Game) (caps : RuleCaptures) (name : String) (alias : PropertyAlias)
    (hCaps : RuleCaptures.propertiesOk game caps = true)
    (hA : PropertyAlias.ok game alias = true) :
    RuleCaptures.propertiesOk game (caps.setProperty name alias) = true := by
  simp only [RuleCaptures.propertiesOk, RuleCaptures.setProperty, Array.toList_push,
    Array.toList_filter]
  refine List.all_eq_true.mpr ?_
  intro p hp
  simp only [List.mem_append, List.mem_singleton] at hp
  rcases hp with hOld | hNew
  · exact (List.all_eq_true.mp hCaps) p (List.mem_filter.mp hOld).1
  · simpa [hNew] using hA

theorem capturePropertyBindingAlias_mem
    (b : Board) (delta : Int) (tuple : Array RowMatch)
    (bnd : PropertyBinding) (alias : PropertyAlias)
    (hFound : capturePropertyBindingAlias b delta tuple bnd = some alias) :
    alias ∈ bnd.aliases.toList := by
  unfold capturePropertyBindingAlias at hFound
  exact List.mem_of_find?_eq_some hFound

theorem capturePropertyBindings_propertiesOk
    (game : Game) (b : Board) (rule : Rule) (tuple : Array RowMatch) (delta : Int)
    (caps : RuleCaptures)
    (hRule : Rule.propertyAliasesOk game rule = true)
    (hCaps : RuleCaptures.propertiesOk game caps = true) :
    RuleCaptures.propertiesOk game
      (capturePropertyBindings game b rule tuple delta caps) = true := by
  unfold capturePropertyBindings
  have : ∀ (bnds : List PropertyBinding) (caps : RuleCaptures),
      (bnds.all fun bnd => bnd.aliases.all (PropertyAlias.ok game)) = true →
      RuleCaptures.propertiesOk game caps = true →
      RuleCaptures.propertiesOk game
        (bnds.foldl
          (fun out bnd =>
            match capturePropertyBindingAlias b delta tuple bnd with
            | some alias => out.setProperty bnd.propertyName alias
            | none => out)
          caps) = true := by
    intro bnds caps hBnds hCaps
    induction bnds generalizing caps with
    | nil => exact hCaps
    | cons bnd rest ih =>
      simp only [List.foldl_cons]
      have hBnd : bnd.aliases.all (PropertyAlias.ok game) = true :=
        (List.all_eq_true.mp hBnds) bnd (by simp)
      have hRest : (rest.all fun bnd => bnd.aliases.all (PropertyAlias.ok game)) = true := by
        refine List.all_eq_true.mpr ?_
        intro x hx
        exact (List.all_eq_true.mp hBnds) x (List.mem_cons_of_mem _ hx)
      cases hFound : capturePropertyBindingAlias b delta tuple bnd with
      | none => exact ih _ hRest hCaps
      | some alias =>
        have hMem := capturePropertyBindingAlias_mem b delta tuple bnd alias hFound
        have hA : PropertyAlias.ok game alias = true :=
          (List.all_eq_true.mp (by simpa [Array.all_toList] using hBnd)) alias hMem
        exact ih _ hRest
          (RuleCaptures.setProperty_propertiesOk game caps bnd.propertyName alias hCaps hA)
  have hRule' : (rule.propertyBindings.toList.all fun bnd =>
      bnd.aliases.all (PropertyAlias.ok game)) = true := by
    simpa [Rule.propertyAliasesOk, Array.all_toList] using hRule
  exact this _ _ hRule' hCaps

/-- Caps bounds from `RuleCaptures.propertiesOk` (IR aliases + capture). -/
theorem applyCellReplacement_wellFormed
    (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern)
    (caps : RuleCaptures) (rng : RngState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) (hTile : tile < b.nTiles)
    (hLR : CellPattern.layerRespecting game pat = true)
    (hCaps : RuleCaptures.propertiesOk game caps = true) :
    Board.WellFormed game (applyCellReplacement game rule b tile pat caps rng).2.1 := by
  unfold applyCellReplacement
  by_cases hs : rule.skipCellWrites = true
  · simp [hs]; exact hB
  · simp only [hs, ↓reduceIte]
    by_cases hr : pat.hasReplacement = true
    · simp only [hr, Bool.not_true]
      have hRep0 := CellPattern.layerRespecting_hasReplacement game pat hLR hr
      have hCompat := CellPattern.layerRespecting_randomEntityCompatible game pat hLR hr
      have hRand := applyRandomEntityMasks_replacementOk game b pat
        pat.objectsClear pat.objectsSet pat.movementsClear rng hG hRep0 hCompat
      have hOk : ∀ b ∈ pat.inferredPropertyBindings.toList, ∀ cap,
          caps.getProperty b.propertyName = some cap →
            cap.objectId.val < game.objectCount ∧
              (game.objectLayers.getD cap.objectId.val ⟨0⟩).val < game.layerCount := by
        intro b hb cap hget
        exact PropertyAlias.ok_bounds game cap
          (RuleCaptures.propertiesOk_getProperty game caps b.propertyName cap hCaps hget)
      have hInf := applyInferredReplacementFields_replacementOk game pat caps
        (b.cellObjWords tile) (b.cellMovWords tile)
        (applyRandomEntityMasks game b pat pat.objectsClear pat.objectsSet pat.movementsClear rng).1
        (applyRandomEntityMasks game b pat pat.objectsClear pat.objectsSet pat.movementsClear rng).2.1
        (applyRandomEntityMasks game b pat pat.objectsClear pat.objectsSet pat.movementsClear rng).2.2.1
        (applyRandomDirMasks game pat pat.movementsSet
          (applyRandomEntityMasks game b pat pat.objectsClear pat.objectsSet pat.movementsClear rng).2.2.2).1
        hG hRand hOk
      exact Board.commitCellReplacement_wellFormed game rule b tile pat
        _ _ _ _ _ hG hB hTile hInf
    · have : pat.hasReplacement = false := eq_false_of_ne_true hr
      simp only [this, Bool.not_false]
      exact hB


theorem maskGetBit_empty (bit : Nat) : maskGetBit (#[] : MaskWords) bit = false := by
  simp [maskGetBit, maskWord, Array.getD]

theorem objectsSetCountOnLayer_empty (game : Game) (layer : Nat) :
    objectsSetCountOnLayer game #[] layer = 0 := by
  simp only [objectsSetCountOnLayer]
  have : (List.range game.objectCount).filter
      (fun oid => maskGetBit #[] oid && (game.objectLayers[oid]?.getD ⟨0⟩).val == layer) = [] := by
    refine List.filter_eq_nil_iff.mpr ?_
    intro oid _
    simp [maskGetBit_empty]
  simp [this]

theorem ReplacementObjectsOk_clear_empty_set (game : Game) (clear : MaskWords) :
    ReplacementObjectsOk game clear #[] = true := by
  simp only [ReplacementObjectsOk]
  refine Bool.and_eq_true_iff.mpr ⟨?_, ?_⟩
  · refine List.all_eq_true.mpr ?_
    intro ℓ _
    simp [objectsSetCountOnLayer_empty]
  · refine List.all_eq_true.mpr ?_
    intro oid _
    simp [maskGetBit_empty]

theorem Board.moveEntitiesAtIndex_wellFormed
    (game : Game) (b : Board) (tile : Nat) (entityMask : MaskWords) (dirMask : UInt32)
    (h : Board.WellFormed game b) :
    Board.WellFormed game (moveEntitiesAtIndex game b tile entityMask dirMask) := by
  unfold moveEntitiesAtIndex
  exact Board.setCellMovWords_wellFormed game b tile _ h

theorem foldl_moveEntities_wellFormed
    (game : Game) (dirMask : UInt32) (tiles : List Nat) (b : Board)
    (h : Board.WellFormed game b) :
    Board.WellFormed game
      (tiles.foldl (fun board tile => moveEntitiesAtIndex game board tile game.playerMask dirMask) b) := by
  induction tiles generalizing b with
  | nil => simpa using h
  | cons t rest ih =>
    simp only [List.foldl_cons]
    exact ih _ (Board.moveEntitiesAtIndex_wellFormed game b t game.playerMask dirMask h)

theorem Board.startMovement_wellFormed
    (game : Game) (b : Board) (dirMask : UInt32)
    (h : Board.WellFormed game b) :
    Board.WellFormed game (startMovement game b dirMask).1 := by
  unfold startMovement
  simpa [← Array.foldl_toList] using
    foldl_moveEntities_wellFormed game dirMask (getPlayerPositions game b).toList b h

set_option maxHeartbeats 8000000

theorem maskWord_maskAnd (a b : MaskWords) (i : Nat) :
    maskWord (maskAnd a b) i = maskWord a i &&& maskWord b i := by
  show maskWord ((List.range (max a.size b.size)).foldl
      (fun out i => out.push (maskWord a i &&& maskWord b i)) #[]) i =
    maskWord a i &&& maskWord b i
  by_cases hi : i < max a.size b.size
  · have hget := Array.getD_foldl_push_range (fun i => maskWord a i &&& maskWord b i)
      (max a.size b.size) i (0 : UInt32) hi
    simpa [maskWord] using hget
  · have hsz := Array.size_foldl_push_range (fun i => maskWord a i &&& maskWord b i) (max a.size b.size)
    have : ¬ i < ((List.range (max a.size b.size)).foldl
        (fun out i => out.push (maskWord a i &&& maskWord b i)) (#[] : MaskWords)).size := by
      simpa [hsz] using hi
    have ha : ¬ i < a.size := by omega
    have hb : ¬ i < b.size := by omega
    simp [maskWord, Array.getD, ha, hb]

theorem maskGetBit_maskAnd (a b : MaskWords) (bit : Nat) :
    maskGetBit (maskAnd a b) bit = (maskGetBit a bit && maskGetBit b bit) := by
  simp only [maskGetBit, maskWord_maskAnd, UInt32.toBitVec_and, getLsbD_and]

/-- Same identity criteria packaged with `maskBitsSetIn` (`set ⊆ old`, `old ∩ clear ⊆ set`). -/
theorem maskGetBit_maskApplyReplacement_of_bitsSetIn
    (old clear set : MaskWords) (oid : Nat)
    (hSet : maskBitsSetIn set old = true)
    (hClr : maskBitsSetIn (maskAnd clear old) set = true) :
    maskGetBit (maskApplyReplacement old clear set) oid = maskGetBit old oid := by
  refine maskGetBit_maskApplyReplacement_eq_old old clear set oid ?_ ?_
  · intro hs
    exact maskGetBit_of_maskBitsSetIn set old oid hSet hs
  · intro hc ho
    have hand : maskGetBit (maskAnd clear old) oid = true := by
      simp [maskGetBit_maskAnd, hc, ho]
    exact maskGetBit_of_maskBitsSetIn (maskAnd clear old) set oid hClr hand

/-- Solo-layer identity: `clear = set` and `set ⊆ old`. -/
theorem maskGetBit_maskApplyReplacement_clear_eq_set
    (old set : MaskWords) (oid : Nat)
    (hSet : maskBitsSetIn set old = true) :
    maskGetBit (maskApplyReplacement old set set) oid = maskGetBit old oid := by
  refine maskGetBit_maskApplyReplacement_eq_old old set set oid ?_ (fun hs _ => hs)
  intro hs
  exact maskGetBit_of_maskBitsSetIn set old oid hSet hs

def onLayerStep (game : Game) (cell : MaskWords) (layer : Nat) (m : MaskWords) (o : Nat) : MaskWords :=
  if (game.objectLayers.getD o ⟨0⟩).val == layer && maskGetBit cell o then
    maskSetBit m o true else m

theorem foldl_onLayer_getBit_not_mem
    (game : Game) (cell : MaskWords) (layer : Nat) (oids : List Nat) (acc : MaskWords) (oid : Nat)
    (hnotin : oid ∉ oids) :
    maskGetBit (oids.foldl (onLayerStep game cell layer) acc) oid = maskGetBit acc oid := by
  induction oids generalizing acc with
  | nil => rfl
  | cons o rest ih =>
    have ho' : o ≠ oid := by
      intro heq; exact hnotin (List.mem_cons.mpr (Or.inl heq.symm))
    have hnotin' : oid ∉ rest := fun h => hnotin (List.mem_cons.mpr (Or.inr h))
    change maskGetBit ((o :: rest).foldl (onLayerStep game cell layer) acc) oid = maskGetBit acc oid
    rw [List.foldl_cons]
    dsimp only [onLayerStep]
    cases hset : ((game.objectLayers.getD o ⟨0⟩).val == layer && maskGetBit cell o) with
    | true =>
      show maskGetBit (rest.foldl (onLayerStep game cell layer) (maskSetBit acc o true)) oid = _
      rw [ih (maskSetBit acc o true) hnotin', maskGetBit_maskSetBit_ne _ o oid true ho']
    | false =>
      show maskGetBit (rest.foldl (onLayerStep game cell layer) acc) oid = _
      exact ih acc hnotin'

theorem foldl_onLayer_getBit_mem
    (game : Game) (cell : MaskWords) (layer : Nat) (oids : List Nat) (acc : MaskWords) (oid : Nat)
    (hnodup : oids.Nodup) (hin : oid ∈ oids) (hacc : maskGetBit acc oid = false) :
    maskGetBit (oids.foldl (onLayerStep game cell layer) acc) oid =
      ((game.objectLayers.getD oid ⟨0⟩).val == layer && maskGetBit cell oid) := by
  induction oids generalizing acc with
  | nil => cases hin
  | cons o rest ih =>
    have ⟨ho_notin, hrest⟩ := List.nodup_cons.mp hnodup
    rw [List.foldl_cons]
    dsimp only [onLayerStep]
    rcases List.mem_cons.mp hin with rfl | hinr
    · cases hset : ((game.objectLayers.getD oid ⟨0⟩).val == layer && maskGetBit cell oid) with
      | true =>
        show maskGetBit (rest.foldl (onLayerStep game cell layer) (maskSetBit acc oid true)) oid = true
        rw [foldl_onLayer_getBit_not_mem game cell layer rest _ oid ho_notin,
          maskGetBit_maskSetBit_same]
      | false =>
        show maskGetBit (rest.foldl (onLayerStep game cell layer) acc) oid = false
        rw [foldl_onLayer_getBit_not_mem game cell layer rest _ oid ho_notin, hacc]
    · have ho : o ≠ oid := fun heq => ho_notin (heq ▸ hinr)
      cases hset : ((game.objectLayers.getD o ⟨0⟩).val == layer && maskGetBit cell o) with
      | true =>
        show maskGetBit (rest.foldl (onLayerStep game cell layer) (maskSetBit acc o true)) oid = _
        refine ih (maskSetBit acc o true) hrest hinr ?_
        rw [maskGetBit_maskSetBit_ne _ o oid true ho, hacc]
      | false =>
        show maskGetBit (rest.foldl (onLayerStep game cell layer) acc) oid = _
        exact ih acc hrest hinr hacc

theorem objectsOnLayerMask_getBit
    (game : Game) (cell : MaskWords) (layer oid : Nat)
    (hOid : oid < game.objectCount) :
    maskGetBit (objectsOnLayerMask game cell layer) oid =
      ((game.objectLayers.getD oid ⟨0⟩).val == layer && maskGetBit cell oid) := by
  unfold objectsOnLayerMask
  change maskGetBit ((List.range game.objectCount).foldl (onLayerStep game cell layer) #[]) oid = _
  exact foldl_onLayer_getBit_mem game cell layer _ #[] oid List.nodup_range
    (List.mem_range.mpr hOid) (by simp [maskGetBit_empty])

theorem cellMaskLayerCount_objectsOnLayerMask_other
    (game : Game) (cell : MaskWords) (layer ℓ : Nat)
    (hne : ℓ ≠ layer) :
    cellMaskLayerCount game (objectsOnLayerMask game cell layer) ℓ = 0 := by
  simp only [cellMaskLayerCount, objectsSetCountOnLayer]
  have hnil :
      (List.range game.objectCount).filter
        (fun oid => maskGetBit (objectsOnLayerMask game cell layer) oid &&
          (game.objectLayers.getD oid ⟨0⟩).val == ℓ) = [] := by
    refine List.filter_eq_nil_iff.mpr ?_
    intro oid hOid hBit
    have ⟨hGet, hL⟩ := Bool.and_eq_true_iff.mp hBit
    have hOid' : oid < game.objectCount := List.mem_range.mp hOid
    rw [objectsOnLayerMask_getBit game cell layer oid hOid'] at hGet
    have hOnLayer : (game.objectLayers.getD oid ⟨0⟩).val = layer :=
      beq_iff_eq.mp (Bool.and_eq_true_iff.mp hGet).1
    have hOnℓ : (game.objectLayers.getD oid ⟨0⟩).val = ℓ := beq_iff_eq.mp hL
    exact hne (hOnℓ.symm.trans hOnLayer)
  rw [hnil]; rfl

theorem cellMaskLayerCount_objectsOnLayerMask_le
    (game : Game) (cell : MaskWords) (layer : Nat)
    (hCell : cellMaskLayerCount game cell layer ≤ 1) :
    cellMaskLayerCount game (objectsOnLayerMask game cell layer) layer ≤ 1 := by
  simp only [cellMaskLayerCount, objectsSetCountOnLayer] at hCell ⊢
  have hSub : ((List.range game.objectCount).filter
      (fun oid => maskGetBit (objectsOnLayerMask game cell layer) oid &&
        (game.objectLayers.getD oid ⟨0⟩).val == layer)).Sublist
      ((List.range game.objectCount).filter
        (fun oid => maskGetBit cell oid &&
          (game.objectLayers.getD oid ⟨0⟩).val == layer)) := by
    refine List.filter_sublist_of_imp _ _ _ ?_
    intro oid hOid hBit
    have ⟨hGet, hL⟩ := Bool.and_eq_true_iff.mp hBit
    have hOid' : oid < game.objectCount := List.mem_range.mp hOid
    rw [objectsOnLayerMask_getBit game cell layer oid hOid'] at hGet
    exact Bool.and_eq_true_iff.mpr ⟨(Bool.and_eq_true_iff.mp hGet).2, hL⟩
  exact Nat.le_trans (List.Sublist.length_le hSub) hCell

theorem cellMaskObjectsOk_objectsOnLayerMask
    (game : Game) (cell : MaskWords) (layer : Nat)
    (h : cellMaskObjectsOk game cell = true) :
    cellMaskObjectsOk game (objectsOnLayerMask game cell layer) = true := by
  simp only [cellMaskObjectsOk] at h ⊢
  refine List.all_eq_true.mpr ?_
  intro oid hMem
  have hOid : oid < game.objectCount := List.mem_range.mp hMem
  rw [objectsOnLayerMask_getBit game cell layer oid hOid]
  cases hb : ((game.objectLayers.getD oid ⟨0⟩).val == layer && maskGetBit cell oid) with
  | true =>
    simp only [hb, Bool.not_true, Bool.false_or]
    have hs : maskGetBit cell oid = true := (Bool.and_eq_true_iff.mp hb).2
    have hOne := (List.all_eq_true.mp h) oid hMem
    simpa [hs] using hOne
  | false =>
    simp only [hb, Bool.not_false, Bool.true_or]

theorem Board.setCellObjWords_clearLayer_wellFormed
    (game : Game) (b : Board) (tile : Nat) (clear : MaskWords)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) (hTile : tile < b.nTiles) :
    Board.WellFormed game
      (b.setCellObjWords tile (maskApplyReplacement (b.cellObjWords tile) clear #[])) := by
  exact Board.setCellObjWords_wellFormed_maskApplyReplacement game b tile clear #[]
    hG hB hTile (ReplacementObjectsOk_clear_empty_set game clear)

theorem cellMaskLayerCount_maskOr_layer
    (game : Game) (target moving : MaskWords) (layer : Nat)
    (hFree : cellMaskLayerCount game target layer = 0) :
    cellMaskLayerCount game (maskOr target moving) layer =
      cellMaskLayerCount game moving layer := by
  simp only [cellMaskLayerCount, objectsSetCountOnLayer] at hFree ⊢
  have hTnil :
      (List.range game.objectCount).filter
        (fun oid => maskGetBit target oid && (game.objectLayers.getD oid ⟨0⟩).val == layer) = [] :=
    List.eq_nil_of_length_eq_zero hFree
  apply congrArg List.length
  refine List.filter_congr fun oid hOid => ?_
  have hTL : (maskGetBit target oid && (game.objectLayers.getD oid ⟨0⟩).val == layer) = false :=
    eq_false_of_ne_true ((List.filter_eq_nil_iff.mp hTnil) oid hOid)
  simp only [maskGetBit_maskOr, Bool.and_or_distrib_right, hTL, Bool.false_or]

theorem cellMaskLayerCount_maskOr_other
    (game : Game) (target moving : MaskWords) (ℓ : Nat)
    (hMovOnly : cellMaskLayerCount game moving ℓ = 0) :
    cellMaskLayerCount game (maskOr target moving) ℓ =
      cellMaskLayerCount game target ℓ := by
  simp only [cellMaskLayerCount, objectsSetCountOnLayer] at hMovOnly ⊢
  have hMnil :
      (List.range game.objectCount).filter
        (fun oid => maskGetBit moving oid && (game.objectLayers.getD oid ⟨0⟩).val == ℓ) = [] :=
    List.eq_nil_of_length_eq_zero hMovOnly
  apply congrArg List.length
  refine List.filter_congr fun oid hOid => ?_
  have hML : (maskGetBit moving oid && (game.objectLayers.getD oid ⟨0⟩).val == ℓ) = false :=
    eq_false_of_ne_true ((List.filter_eq_nil_iff.mp hMnil) oid hOid)
  simp only [maskGetBit_maskOr, Bool.and_or_distrib_right, hML, Bool.or_false]

theorem cellMaskLayersOk_maskOr_moving
    (game : Game) (target moving : MaskWords) (layer : Nat)
    (hLay : cellMaskLayersOk game target = true)
    (hFree : cellMaskLayerCount game target layer = 0)
    (hMovLayer : cellMaskLayerCount game moving layer ≤ 1)
    (hMovOther : ∀ ℓ < game.layerCount, ℓ ≠ layer → cellMaskLayerCount game moving ℓ = 0) :
    cellMaskLayersOk game (maskOr target moving) = true := by
  simp only [cellMaskLayersOk] at hLay ⊢
  refine List.all_eq_true.mpr ?_
  intro ℓ hMem
  have hℓ : ℓ < game.layerCount := List.mem_range.mp hMem
  have hT : cellMaskLayerCount game target ℓ ≤ 1 := of_decide_eq_true ((List.all_eq_true.mp hLay) ℓ hMem)
  by_cases heq : ℓ = layer
  · subst heq
    have hEq := cellMaskLayerCount_maskOr_layer game target moving ℓ hFree
    exact decide_eq_true (by omega)
  · have hEq := cellMaskLayerCount_maskOr_other game target moving ℓ (hMovOther ℓ hℓ heq)
    exact decide_eq_true (by omega)

theorem cellMaskObjectsOk_maskOr
    (game : Game) (target moving : MaskWords)
    (hT : cellMaskObjectsOk game target = true)
    (hM : cellMaskObjectsOk game moving = true) :
    cellMaskObjectsOk game (maskOr target moving) = true := by
  simp only [cellMaskObjectsOk] at hT hM ⊢
  refine List.all_eq_true.mpr ?_
  intro oid hMem
  by_cases hb : maskGetBit (maskOr target moving) oid = true
  · have hor := Bool.or_eq_true_iff.mp (by simpa [maskGetBit_maskOr] using hb)
    cases hor with
    | inl ht =>
      have hOne := (List.all_eq_true.mp hT) oid hMem
      simpa [ht, maskGetBit_maskOr, hb] using hOne
    | inr hm =>
      have hOne := (List.all_eq_true.mp hM) oid hMem
      simpa [hm, maskGetBit_maskOr, hb] using hOne
  · simp [eq_false_of_ne_true hb]

set_option maxHeartbeats 8000000

theorem maskAnyBits_of_maskGetBit (ws : MaskWords) (bit : Nat)
    (h : maskGetBit ws bit = true) : maskAnyBits ws = true := by
  simp only [maskAnyBits]
  have hw : bit / 32 < ws.size := by
    by_cases hsz : bit / 32 < ws.size
    · exact hsz
    · simp [maskGetBit, maskWord, Array.getD, hsz] at h
  have hbit : (ws[bit / 32]).toBitVec.getLsbD (bit % 32) = true := by
    simpa [maskGetBit, maskWord, Array.getD, hw] using h
  have hne : (ws[bit / 32] != 0) = true := by
    refine bne_iff_ne.mpr ?_
    intro heq; simp [heq] at hbit
  exact (Array.any_eq_true (as := ws) (p := fun x => x != 0)).2 ⟨bit / 32, hw, hne⟩

theorem cellMaskLayerCount_eq_zero_of_layerMask_free
    (game : Game) (target : MaskWords) (layer : Nat)
    (hG : Game.WellFormed game)
    (hLayer : layer < game.layerCount)
    (hFree : maskAnyBits (maskAnd (game.layerMasks.getD layer #[]) target) = false) :
    cellMaskLayerCount game target layer = 0 := by
  simp only [cellMaskLayerCount, objectsSetCountOnLayer]
  have hnil :
      (List.range game.objectCount).filter
        (fun oid => maskGetBit target oid && (game.objectLayers.getD oid ⟨0⟩).val == layer) = [] := by
    refine List.filter_eq_nil_iff.mpr ?_
    intro oid hOid hBit
    have ⟨hT, hL⟩ := Bool.and_eq_true_iff.mp hBit
    have hOid' : oid < game.objectCount := List.mem_range.mp hOid
    have hOn : (game.objectLayers.getD oid ⟨0⟩).val = layer := beq_iff_eq.mp hL
    have hMask := Game.layerMask_getBit_of_onLayer game oid layer hG hOid' hLayer hOn
    have hAnd : maskGetBit (maskAnd (game.layerMasks.getD layer #[]) target) oid = true := by
      simp only [maskGetBit_maskAnd, hMask, hT, Bool.true_and]
    have hAny := maskAnyBits_of_maskGetBit _ _ hAnd
    exact Bool.noConfusion (hFree.symm.trans hAny)
  rw [hnil]; rfl

theorem dirDelta_some_ne_action (dirMask : UInt32) {off : Int × Int}
    (h : dirDelta dirMask = some off) : (dirMask != 16) = true := by
  refine bne_iff_ne.mpr ?_
  intro heq
  subst heq
  simp [dirDelta, Dir4.ofBits?] at h

private theorem tileOk_from_WF (game : Game) (b : Board) (t : Nat)
    (hB : Board.WellFormed game b) (ht : t < b.nTiles) :
    cellMaskObjectsOk game (b.cellObjWords t) = true ∧
      cellMaskLayersOk game (b.cellObjWords t) = true := by
  simp only [Board.WellFormed, Board.wellFormed] at hB
  have hTiles := (Bool.and_eq_true_iff.mp hB).2
  have hOne := (List.all_eq_true.mp hTiles) t (List.mem_range.mpr ht)
  exact Bool.and_eq_true_iff.mp hOne

theorem Board.repositionEntitiesOnLayer_wellFormed
    (game : Game) (b : Board) (tile layer : Nat) (dirMask : UInt32)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hTile : tile < b.nTiles) (hLayer : layer < game.layerCount) :
    Board.WellFormed game (repositionEntitiesOnLayer game b tile layer dirMask).2 := by
  unfold repositionEntitiesOnLayer
  cases hDir : dirDelta dirMask with
  | none => cases (dirMask == 16) <;> simp <;> exact hB
  | some offset =>
    have hNe16 := dirDelta_some_ne_action dirMask hDir
    rcases offset with ⟨dx, dy⟩
    dsimp only []
    by_cases hBound : ((b.tileCol tile == 0 && dx < 0) || (b.tileCol tile == b.width - 1 && dx > 0) ||
        (b.tileRow tile == 0 && dy < 0) || (b.tileRow tile == b.height - 1 && dy > 0)) = true
    · rw [if_pos hBound]; exact hB
    · rw [if_neg hBound]
      by_cases hTB : (decide ((Int.ofNat tile + dy + dx * Int.ofNat b.height).toNat ≥ b.nTiles) ||
          (Int.ofNat tile + dy + dx * Int.ofNat b.height).toNat == tile) = true
      · rw [if_pos hTB]; exact hB
      · rw [if_neg hTB]
        generalize hTdef : (Int.ofNat tile + dy + dx * Int.ofNat b.height).toNat = targetTile
        simp only [hTdef] at hTB ⊢
        have hTlt : targetTile < b.nTiles := by
          refine Nat.lt_of_not_ge ?_
          intro hge
          have htrue : (decide (targetTile ≥ b.nTiles) || targetTile == tile) = true := by
            simp [hge]
          exact absurd htrue hTB
        by_cases hOcc : (maskAnyBits (maskAnd (layerMaskFor game layer) (b.cellObjWords targetTile)) &&
            dirMask != 16) = true
        · rw [if_pos hOcc]; exact hB
        · rw [if_neg hOcc]
          let layerMask := layerMaskFor game layer
          let targetObj := b.cellObjWords targetTile
          let sourceObj := b.cellObjWords tile
          let moving := objectsOnLayerMask game sourceObj layer
          let newSource := maskApplyReplacement sourceObj layerMask #[]
          let newTarget := maskOr targetObj moving
          have hB1 : Board.WellFormed game (b.setCellObjWords tile newSource) :=
            Board.setCellObjWords_clearLayer_wellFormed game b tile layerMask hG hB hTile
          have ⟨hObjT, hLayT⟩ := tileOk_from_WF game b targetTile hB hTlt
          have ⟨hObjS, hLayS⟩ := tileOk_from_WF game b tile hB hTile
          have hFreeBits : maskAnyBits (maskAnd layerMask targetObj) = false := by
            have hOcc' : (maskAnyBits (maskAnd layerMask targetObj) && dirMask != 16) = false := by
              simpa [layerMask, targetObj, eq_false_of_ne_true hOcc]
            simpa [hNe16] using hOcc'
          have hFree : cellMaskLayerCount game targetObj layer = 0 := by
            simpa [layerMask, layerMaskFor, targetObj] using
              cellMaskLayerCount_eq_zero_of_layerMask_free game (b.cellObjWords targetTile) layer
                hG hLayer hFreeBits
          have hMovOther : ∀ ℓ < game.layerCount, ℓ ≠ layer →
              cellMaskLayerCount game moving ℓ = 0 := fun ℓ _ hne => by
            simpa [moving, sourceObj] using
              cellMaskLayerCount_objectsOnLayerMask_other game (b.cellObjWords tile) layer ℓ hne
          have hMovLayer : cellMaskLayerCount game moving layer ≤ 1 := by
            have hSrc : cellMaskLayerCount game sourceObj layer ≤ 1 := by
              have hAll := hLayS
              simp only [cellMaskLayersOk, sourceObj] at hAll
              exact of_decide_eq_true ((List.all_eq_true.mp hAll) layer (List.mem_range.mpr hLayer))
            simpa [moving, sourceObj] using
              cellMaskLayerCount_objectsOnLayerMask_le game (b.cellObjWords tile) layer hSrc
          have hLayNew : cellMaskLayersOk game newTarget = true :=
            cellMaskLayersOk_maskOr_moving game targetObj moving layer hLayT hFree hMovLayer hMovOther
          have hObjNew : cellMaskObjectsOk game newTarget = true :=
            cellMaskObjectsOk_maskOr game targetObj moving hObjT
              (cellMaskObjectsOk_objectsOnLayerMask game sourceObj layer hObjS)
          have hTile1 : targetTile < (b.setCellObjWords tile newSource).nTiles := by
            simpa [Board.setCellObjWords, Board.nTiles] using hTlt
          exact Board.setCellObjWords_wellFormed game (b.setCellObjWords tile newSource)
            targetTile newTarget hG hB1 hTile1 hObjNew hLayNew


theorem Board.setCellObjWords_wh (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellObjWords tile ws).width = b.width ∧ (b.setCellObjWords tile ws).height = b.height := by
  simp [Board.setCellObjWords]

theorem Board.setCellMovWords_wh (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellMovWords tile ws).width = b.width ∧ (b.setCellMovWords tile ws).height = b.height := by
  simp [Board.setCellMovWords]

theorem Board.setCellObjWords_nTiles (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellObjWords tile ws).nTiles = b.nTiles := by
  simp [Board.setCellObjWords, Board.nTiles]

theorem Board.repositionEntitiesOnLayer_wh
    (game : Game) (b : Board) (tile layer : Nat) (dirMask : UInt32) :
    (repositionEntitiesOnLayer game b tile layer dirMask).2.width = b.width ∧
      (repositionEntitiesOnLayer game b tile layer dirMask).2.height = b.height := by
  unfold repositionEntitiesOnLayer
  cases dirDelta dirMask with
  | none => cases (dirMask == 16) <;> simp
  | some offset =>
    rcases offset with ⟨dx, dy⟩
    dsimp only []
    by_cases hBound : ((b.tileCol tile == 0 && dx < 0) || (b.tileCol tile == b.width - 1 && dx > 0) ||
        (b.tileRow tile == 0 && dy < 0) || (b.tileRow tile == b.height - 1 && dy > 0)) = true
    · rw [if_pos hBound]; simp
    · rw [if_neg hBound]
      by_cases hTB : (decide ((Int.ofNat tile + dy + dx * Int.ofNat b.height).toNat ≥ b.nTiles) ||
          (Int.ofNat tile + dy + dx * Int.ofNat b.height).toNat == tile) = true
      · rw [if_pos hTB]; simp
      · rw [if_neg hTB]
        by_cases hOcc : (maskAnyBits (maskAnd (layerMaskFor game layer)
            (b.cellObjWords (Int.ofNat tile + dy + dx * Int.ofNat b.height).toNat)) &&
            dirMask != 16) = true
        · rw [if_pos hOcc]; simp
        · rw [if_neg hOcc]; simp [Board.setCellObjWords]

theorem Board.repositionEntitiesOnLayer_nTiles
    (game : Game) (b : Board) (tile layer : Nat) (dirMask : UInt32) :
    (repositionEntitiesOnLayer game b tile layer dirMask).2.nTiles = b.nTiles := by
  simp [Board.nTiles, Board.repositionEntitiesOnLayer_wh]

theorem foldl_reposition_layers_wellFormed
    (game : Game) (tile : Nat) (layers : List Nat) (moved : Bool) (b : Board) (mov : MaskWords)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hTile : tile < b.nTiles)
    (hLayers : ∀ ℓ ∈ layers, ℓ < game.layerCount) :
    Board.WellFormed game
      (layers.foldl
        (fun (moved, board, movement) layer =>
          let bits := getLayerMovementBits movement layer
          if bits != 0 then
            let (thisMoved, b') := repositionEntitiesOnLayer game board tile layer bits
            if thisMoved then (true, b', clearLayerMovementBits movement layer)
            else (moved, board, movement)
          else (moved, board, movement))
        (moved, b, mov)).2.1 := by
  induction layers generalizing moved b mov with
  | nil => simpa using hB
  | cons layer rest ih =>
    have hL := hLayers layer (by simp)
    have hRest : ∀ ℓ ∈ rest, ℓ < game.layerCount := fun ℓ h => hLayers ℓ (by simp [h])
    simp only [List.foldl_cons]
    by_cases hb : (getLayerMovementBits mov layer != 0) = true
    · rw [if_pos hb]
      by_cases hTM : (repositionEntitiesOnLayer game b tile layer
          (getLayerMovementBits mov layer)).1 = true
      · rw [if_pos hTM]
        have hB' := Board.repositionEntitiesOnLayer_wellFormed game b tile layer
          (getLayerMovementBits mov layer) hG hB hTile hL
        have hTile' : tile < (repositionEntitiesOnLayer game b tile layer
            (getLayerMovementBits mov layer)).2.nTiles := by
          simpa [Board.repositionEntitiesOnLayer_nTiles] using hTile
        exact ih true _ _ hB' hTile' hRest
      · rw [if_neg hTM]
        exact ih moved b mov hB hTile hRest
    · rw [if_neg hb]
      exact ih moved b mov hB hTile hRest

theorem Board.repositionEntitiesAtCell_wellFormed
    (game : Game) (b : Board) (tile : Nat)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hTile : tile < b.nTiles) :
    Board.WellFormed game (repositionEntitiesAtCell game b tile).2 := by
  unfold repositionEntitiesAtCell
  by_cases hAny : maskAnyBits (b.cellMovWords tile) = true
  · have : (!maskAnyBits (b.cellMovWords tile)) = false := by simp [hAny]
    simp only [this]
    have hFold := foldl_reposition_layers_wellFormed game tile (List.range game.layerCount)
      false b (b.cellMovWords tile) hG hB hTile (fun ℓ h => List.mem_range.mp h)
    exact Board.setCellMovWords_wellFormed game _ tile _ hFold
  · have : (!maskAnyBits (b.cellMovWords tile)) = true := by simp [eq_false_of_ne_true hAny]
    simp only [this]
    exact hB

theorem Board.repositionEntitiesAtCell_nTiles
    (game : Game) (b : Board) (tile : Nat) :
    (repositionEntitiesAtCell game b tile).2.nTiles = b.nTiles := by
  have hwh : (repositionEntitiesAtCell game b tile).2.width = b.width ∧
      (repositionEntitiesAtCell game b tile).2.height = b.height := by
    unfold repositionEntitiesAtCell
    by_cases hAny : maskAnyBits (b.cellMovWords tile) = true
    · have : (!maskAnyBits (b.cellMovWords tile)) = false := by simp [hAny]
      simp only [this]
      have hfold :
          ∀ (layers : List Nat) (moved : Bool) (board : Board) (mov : MaskWords),
            board.width = b.width → board.height = b.height →
            let st := layers.foldl
              (fun (moved, board, movement) layer =>
                let bits := getLayerMovementBits movement layer
                if bits != 0 then
                  let (thisMoved, b') := repositionEntitiesOnLayer game board tile layer bits
                  if thisMoved then (true, b', clearLayerMovementBits movement layer)
                  else (moved, board, movement)
                else (moved, board, movement))
              (moved, board, mov)
            st.2.1.width = b.width ∧ st.2.1.height = b.height := by
        intro layers moved board mov hw hh
        induction layers generalizing moved board mov with
        | nil => exact ⟨hw, hh⟩
        | cons layer rest ih =>
          simp only [List.foldl_cons]
          by_cases hb : (getLayerMovementBits mov layer != 0) = true
          · rw [if_pos hb]
            by_cases hTM : (repositionEntitiesOnLayer game board tile layer
                (getLayerMovementBits mov layer)).1 = true
            · rw [if_pos hTM]
              have ⟨hw', hh'⟩ := Board.repositionEntitiesOnLayer_wh game board tile layer
                (getLayerMovementBits mov layer)
              exact ih true _ _ (hw'.trans hw) (hh'.trans hh)
            · rw [if_neg hTM]; exact ih _ _ _ hw hh
          · rw [if_neg hb]; exact ih _ _ _ hw hh
      have ⟨hw, hh⟩ := hfold (List.range game.layerCount) false b (b.cellMovWords tile) rfl rfl
      simpa [Board.setCellMovWords] using And.intro hw hh
    · have : (!maskAnyBits (b.cellMovWords tile)) = true := by simp [eq_false_of_ne_true hAny]
      simp only [this]; exact ⟨rfl, rfl⟩
  simp [Board.nTiles, hwh.1, hwh.2]

theorem foldl_resolve_pass_wellFormed
    (game : Game) (tiles : List Nat) (moved : Bool) (b : Board)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hTiles : ∀ t ∈ tiles, t < b.nTiles) :
    Board.WellFormed game
      (tiles.foldl
        (fun (moved, board) tile =>
          let mov := board.cellMovWords tile
          if maskAnyBits mov then
            let (thisMoved, b') := repositionEntitiesAtCell game board tile
            if thisMoved then (true, b') else (moved, board)
          else (moved, board))
        (moved, b)).2 := by
  induction tiles generalizing moved b with
  | nil => simpa using hB
  | cons t rest ih =>
    have ht := hTiles t (by simp)
    have hRest0 : ∀ u ∈ rest, u < b.nTiles := fun u hu => hTiles u (by simp [hu])
    simp only [List.foldl_cons]
    by_cases hM : maskAnyBits (b.cellMovWords t) = true
    · rw [if_pos hM]
      by_cases hTM : (repositionEntitiesAtCell game b t).1 = true
      · rw [if_pos hTM]
        have hB' := Board.repositionEntitiesAtCell_wellFormed game b t hG hB ht
        have hRest : ∀ u ∈ rest, u < (repositionEntitiesAtCell game b t).2.nTiles := by
          intro u hu
          simpa [Board.repositionEntitiesAtCell_nTiles] using hRest0 u hu
        exact ih true _ hB' hRest
      · rw [if_neg hTM]
        exact ih moved b hB hRest0
    · rw [if_neg hM]
      exact ih moved b hB hRest0

theorem resolveMovements.sweep_wellFormed
    (game : Game) (fuel : Nat) (b : Board)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) :
    Board.WellFormed game (resolveMovements.sweep game fuel b) := by
  induction fuel generalizing b with
  | zero => simpa [resolveMovements.sweep] using hB
  | succ fuel ih =>
    unfold resolveMovements.sweep
    have hPass := foldl_resolve_pass_wellFormed game (List.range b.nTiles) false b hG hB
      (fun t ht => List.mem_range.mp ht)
    generalize hSt : ((List.range b.nTiles).foldl
      (fun (moved, board) tile =>
        let mov := board.cellMovWords tile
        if maskAnyBits mov then
          let (thisMoved, b') := repositionEntitiesAtCell game board tile
          if thisMoved then (true, b') else (moved, board)
        else (moved, board))
      (false, b)) = st
    rcases st with ⟨moved, board'⟩
    have hPass' : Board.WellFormed game board' := by
      have hEq : ((List.range b.nTiles).foldl
          (fun (moved, board) tile =>
            let mov := board.cellMovWords tile
            if maskAnyBits mov then
              let (thisMoved, b') := repositionEntitiesAtCell game board tile
              if thisMoved then (true, b') else (moved, board)
            else (moved, board))
          (false, b)).2 = board' := by
        simpa [hSt]
      simpa [← hEq] using hPass
    by_cases hMoved : moved = true
    · simp only [hMoved, ↓reduceIte]
      exact ih board' hPass'
    · simp only [eq_false_of_ne_true hMoved]
      exact hPass'

theorem clearLingeringAtTile_wellFormed
    (game : Game) (board : Board) (tile : Nat)
    (hBoard : Board.WellFormed game board) :
    Board.WellFormed game (clearLingeringAtTile game board tile) := by
  unfold clearLingeringAtTile
  by_cases hM : maskAnyBits (board.cellMovWords tile) = true
  · rw [if_pos hM]
    have hMov := Board.setCellMovWords_wellFormed game board tile
      (clearAllMovementBits game (board.cellMovWords tile)) hBoard
    by_cases hRigid : game.gameRigid = true
    · simp only [hRigid, ↓reduceIte]
      exact Board.setCellRigidMovementAppliedMask_wellFormed game _
        tile (movMaskZeros board.strideMov)
        (Board.setCellRigidGroupIndexMask_wellFormed game _ tile
          (movMaskZeros board.strideMov) hMov)
    · simp only [eq_false_of_ne_true hRigid]
      exact hMov
  · rw [if_neg hM]
    exact hBoard

theorem clearLingeringMovements_wellFormed
    (game : Game) (b : Board)
    (hB : Board.WellFormed game b) :
    Board.WellFormed game (clearLingeringMovements game b) := by
  unfold clearLingeringMovements
  have : ∀ (tiles : List Nat) (board : Board),
      Board.WellFormed game board →
      Board.WellFormed game (tiles.foldl (clearLingeringAtTile game) board) := by
    intro tiles board hBoard
    induction tiles generalizing board with
    | nil => exact hBoard
    | cons t rest ih =>
      simp only [List.foldl_cons]
      exact ih _ (clearLingeringAtTile_wellFormed game board t hBoard)
  exact this (List.range b.nTiles) b hB

theorem resolveMovements.finalize_wellFormed
    (game : Game) (b : Board) (bannedGroup : Array Bool)
    (_hG : Game.WellFormed game) (hB : Board.WellFormed game b) :
    Board.WellFormed game (resolveMovements.finalize game b bannedGroup).1 := by
  unfold resolveMovements.finalize
  exact clearLingeringMovements_wellFormed game b hB

theorem Board.resolveMovements_wellFormed
    (game : Game) (b : Board) (bannedGroup : Array Bool)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b) :
    Board.WellFormed game (resolveMovements game b bannedGroup).1 := by
  unfold resolveMovements
  exact resolveMovements.finalize_wellFormed game _
    bannedGroup hG (resolveMovements.sweep_wellFormed game _ b hG hB)

theorem RuleCaptures.setAggregate_properties (c : RuleCaptures) (name : String) (bits : Nat) :
    (c.setAggregate name bits).properties = c.properties := by
  simp [RuleCaptures.setAggregate]

theorem captureAggregateBinding_properties_eq
    (b : Board) (tuple : Array RowMatch) (delta : Int)
    (caps : RuleCaptures) (bnd : AggregateBinding) :
    (captureAggregateBinding b tuple delta caps bnd).properties = caps.properties := by
  simp [captureAggregateBinding, RuleCaptures.setAggregate_properties]

theorem captureAggregateBindings_properties_eq
    (b : Board) (rule : Rule) (tuple : Array RowMatch) (delta : Int) (caps : RuleCaptures) :
    (captureAggregateBindings b rule tuple delta caps).properties = caps.properties := by
  unfold captureAggregateBindings
  induction rule.aggregateBindings.toList generalizing caps with
  | nil => rfl
  | cons bnd rest ih =>
    simp only [List.foldl_cons]
    exact (ih _).trans (captureAggregateBinding_properties_eq b tuple delta caps bnd)

theorem captureAggregateBindings_propertiesOk
    (game : Game) (b : Board) (rule : Rule) (tuple : Array RowMatch) (delta : Int)
    (caps : RuleCaptures)
    (hCaps : RuleCaptures.propertiesOk game caps = true) :
    RuleCaptures.propertiesOk game (captureAggregateBindings b rule tuple delta caps) = true := by
  simpa [RuleCaptures.propertiesOk, captureAggregateBindings_properties_eq] using hCaps

theorem applyRowAtFold_wellFormed
    (game : Game) (rule : Rule) (b : Board) (delta : Int)
    (row : Array PatternCell) (rm : RowMatch)
    (caps : RuleCaptures) (rng : RngState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hRow : row.all (PatternCell.layerRespecting game) = true)
    (hCaps : RuleCaptures.propertiesOk game caps = true) :
    Board.WellFormed game (applyRowAtFold game rule b delta row rm caps rng).2.1 := by
  unfold applyRowAtFold
  let gaps : Array Nat :=
    match rm with
    | .fixed _ => #[]
    | .ellipsis1 _ g => #[g]
    | .ellipsis2 _ g1 g2 => #[g1, g2]
  have : ∀ (cells : List PatternCell) (gapIdx : Nat) (idx : Int) (changed : Bool)
      (board : Board) (rng : RngState),
      Board.WellFormed game board →
      (cells.all (PatternCell.layerRespecting game) = true) →
      Board.WellFormed game
        (cells.foldl
          (fun (gapIdx, idx, changed, board, rng') cell =>
            match cell with
            | .ellipsis =>
              let g := gaps.getD gapIdx 0
              (gapIdx + 1, idx + delta * Int.ofNat g, changed, board, rng')
            | .cell pat =>
              let t := idx.toNat
              if idx < 0 || t >= board.nTiles then
                (gapIdx, idx + delta, changed, board, rng')
              else
                let (c, b', r) := applyCellReplacement game rule board t pat caps rng'
                (gapIdx, idx + delta, changed || c, b', r))
          (gapIdx, idx, changed, board, rng)).2.2.2.1 := by
    intro cells gapIdx idx changed board rng hBoard hCells
    induction cells generalizing gapIdx idx changed board rng with
    | nil => exact hBoard
    | cons cell rest ih =>
      simp only [List.foldl_cons]
      have hCellOK : PatternCell.layerRespecting game cell = true :=
        (List.all_eq_true.mp hCells) cell (by simp)
      have hRest : (rest.all (PatternCell.layerRespecting game) = true) := by
        refine List.all_eq_true.mpr ?_
        intro x hx
        exact (List.all_eq_true.mp hCells) x (List.mem_cons_of_mem _ hx)
      cases cell with
      | ellipsis =>
        exact ih _ _ _ _ _ hBoard hRest
      | cell pat =>
        have hLR : CellPattern.layerRespecting game pat = true := by
          simpa [PatternCell.layerRespecting] using hCellOK
        by_cases hSkip : (decide (idx < 0) || decide (idx.toNat ≥ board.nTiles)) = true
        · simp only [hSkip, ↓reduceIte]
          exact ih _ _ _ _ _ hBoard hRest
        · have hTile : idx.toNat < board.nTiles := by
            have hFalse := eq_false_of_ne_true hSkip
            have ⟨_, hGe⟩ := Bool.or_eq_false_iff.mp hFalse
            exact Nat.lt_of_not_ge (of_decide_eq_false hGe)
          simp only [eq_false_of_ne_true hSkip]
          have hB' := applyCellReplacement_wellFormed game rule board idx.toNat pat caps rng
            hG hBoard hTile hLR hCaps
          exact ih _ _ _ _ _ hB' hRest
  exact this row.toList 0 (Int.ofNat (rowMatchStart rm)) false b rng hB
    (by simpa [Array.all_toList] using hRow)

/-- Shared Fixed-row fold induction: `Inv` is preserved by each cell replacement. -/
theorem applyRowAtFixed_preserves
    (game : Game) (rule : Rule) (b : Board) (delta : Int)
    (row : Array PatternCell) (start : Nat)
    (caps : RuleCaptures) (rng : RngState)
    (Inv : Board → Prop)
    (h0 : Inv b)
    (hApply : ∀ (board : Board) (t : Nat) (pat : CellPattern) (rng : RngState) (k : Nat),
      Inv board → t < board.nTiles → k < row.size →
        row[k]?.getD (.ellipsis) = .cell pat →
        Inv (applyCellReplacement game rule board t pat caps rng).2.1) :
    Inv (applyRowAtFixed game rule b delta row start caps rng).2.1 := by
  dsimp only [applyRowAtFixed]
  have hInv :
      ∀ (ks : List Nat) (changed : Bool) (board : Board) (rng : RngState),
        Inv board →
        (∀ k ∈ ks, k < row.size) →
        Inv
          (ks.foldl
            (fun (changed, board, rng') k =>
              match row[k]?.getD (.ellipsis) with
              | .ellipsis => (changed, board, rng')
              | .cell pat =>
                match fixedWalkTile? start delta k with
                | none => (changed, board, rng')
                | some t =>
                  if t ≥ board.nTiles then (changed, board, rng')
                  else
                    let (c, b', r) := applyCellReplacement game rule board t pat caps rng'
                    (changed || c, b', r))
            (changed, board, rng)).2.1 := by
    intro ks changed board rng hBoard hBounds
    induction ks generalizing changed board rng with
    | nil => exact hBoard
    | cons k rest ih =>
      simp only [List.foldl_cons]
      have hk : k < row.size := hBounds k (by simp)
      have hRestBounds : ∀ k' ∈ rest, k' < row.size :=
        fun k' hk' => hBounds k' (List.mem_cons_of_mem _ hk')
      cases hcell : row[k]?.getD (.ellipsis) with
      | ellipsis =>
        exact ih _ _ _ hBoard hRestBounds
      | cell pat =>
        cases hwalk : fixedWalkTile? start delta k with
        | none =>
          exact ih _ _ _ hBoard hRestBounds
        | some t =>
          by_cases ht : t ≥ board.nTiles
          · simp [hcell, hwalk, if_pos ht]
            exact ih _ _ _ hBoard hRestBounds
          · simp [hcell, hwalk, if_neg (by intro h; exact ht h)]
            have hTile : t < board.nTiles := Nat.lt_of_not_ge ht
            have hB' := hApply board t pat rng k hBoard hTile hk hcell
            exact ih _ _ _ hB' hRestBounds
  have hRange : ∀ k ∈ List.range row.size, k < row.size :=
    fun k hk => List.mem_range.mp hk
  exact hInv (List.range row.size) false b rng h0 hRange

theorem applyRowAtFixed_wellFormed
    (game : Game) (rule : Rule) (b : Board) (delta : Int)
    (row : Array PatternCell) (start : Nat)
    (caps : RuleCaptures) (rng : RngState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hRow : row.all (PatternCell.layerRespecting game) = true)
    (hCaps : RuleCaptures.propertiesOk game caps = true) :
    Board.WellFormed game (applyRowAtFixed game rule b delta row start caps rng).2.1 := by
  refine applyRowAtFixed_preserves game rule b delta row start caps rng
    (Board.WellFormed game) hB ?_
  intro board t pat rng k hBoard hTile hk hcell
  have hLR : CellPattern.layerRespecting game pat = true := by
    have hAll := Array.all_eq_true.mp hRow
    have hget : row[k]?.getD (.ellipsis) = row[k] := by
      simp [Array.getD, Array.getElem?_eq_getElem hk]
    have : PatternCell.layerRespecting game (row[k]?.getD (.ellipsis)) = true := by
      rw [hget]; exact hAll k hk
    simpa [hcell, PatternCell.layerRespecting] using this
  exact applyCellReplacement_wellFormed game rule board t pat caps rng
    hG hBoard hTile hLR hCaps

theorem applyRowAt_wellFormed
    (game : Game) (rule : Rule) (b : Board) (delta : Int)
    (row : Array PatternCell) (rm : RowMatch)
    (caps : RuleCaptures) (rng : RngState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hRow : row.all (PatternCell.layerRespecting game) = true)
    (hCaps : RuleCaptures.propertiesOk game caps = true) :
    Board.WellFormed game (applyRowAt game rule b delta row rm caps rng).2.1 := by
  cases rm with
  | fixed s =>
    simp only [applyRowAt]
    by_cases hEll : row.any patternCellIsEllipsis = true
    · simp only [hEll, ↓reduceIte]
      exact applyRowAtFold_wellFormed game rule b delta row (.fixed s) caps rng hG hB hRow hCaps
    · simp only [eq_false_of_ne_true hEll, ↓reduceIte]
      exact applyRowAtFixed_wellFormed game rule b delta row s caps rng hG hB hRow hCaps
  | ellipsis1 start gap =>
    simpa [applyRowAt] using
      applyRowAtFold_wellFormed game rule b delta row (.ellipsis1 start gap) caps rng
        hG hB hRow hCaps
  | ellipsis2 start gap1 gap2 =>
    simpa [applyRowAt] using
      applyRowAtFold_wellFormed game rule b delta row (.ellipsis2 start gap1 gap2) caps rng
        hG hB hRow hCaps

theorem Rule.layerRespecting_getD_row
    (game : Game) (rule : Rule) (ri : Nat)
    (h : Rule.layerRespecting game rule = true) :
    (rule.patternRows.getD ri #[]).all (PatternCell.layerRespecting game) = true := by
  simp only [Rule.layerRespecting] at h
  by_cases hLt : ri < rule.patternRows.size
  · have := (Array.all_eq_true.mp h) ri hLt
    simpa [Array.getD, hLt] using this
  · have : (rule.patternRows.getD ri #[] = (#[] : Array PatternCell)) := by
      simp [Array.getD, hLt]
    simp [this]

theorem applyRuleTuple_wellFormed
    (game : Game) (b : Board) (rule : Rule) (tuple : Array RowMatch)
    (recheck : Bool) (rng : RngState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hLR : Rule.layerRespecting game rule = true)
    (hAlias : Rule.propertyAliasesOk game rule = true) :
    Board.WellFormed game (applyRuleTuple game b rule tuple recheck rng).2.1 := by
  unfold applyRuleTuple
  by_cases hRecheck : (recheck && !tupleStillMatches b rule tuple) = true
  · rw [if_pos hRecheck]; exact hB
  · rw [if_neg hRecheck]
    let delta := ruleDirectionDelta rule.direction b.height
    let caps :=
      captureAggregateBindings b rule tuple delta
        (capturePropertyBindings game b rule tuple delta RuleCaptures.empty)
    have hCaps :
        RuleCaptures.propertiesOk game caps = true :=
      captureAggregateBindings_propertiesOk game b rule tuple delta _
        (capturePropertyBindings_propertiesOk game b rule tuple delta _
          hAlias (RuleCaptures.propertiesOk_empty game))
    have : ∀ (ris : List Nat) (changed : Bool) (board : Board) (rng : RngState),
        Board.WellFormed game board →
        Board.WellFormed game
          (ris.foldl
            (fun (changed, board, rng') ri =>
              let row := rule.patternRows.getD ri #[]
              let rm := tuple.getD ri (.fixed 0)
              let (c, b', r) := applyRowAt game rule board delta row rm caps rng'
              (changed || c, b', r))
            (changed, board, rng)).2.1 := by
      intro ris changed board rng hBoard
      induction ris generalizing changed board rng with
      | nil => exact hBoard
      | cons ri rest ih =>
        simp only [List.foldl_cons]
        have hRow := Rule.layerRespecting_getD_row game rule ri hLR
        have hB' := applyRowAt_wellFormed game rule board delta
          (rule.patternRows.getD ri #[]) (tuple.getD ri (.fixed 0)) caps rng
          hG hBoard hRow hCaps
        exact ih _ _ _ hB'
    exact this (List.range tuple.size) false b rng hB

theorem applyMatchedTuples_wellFormed
    (game : Game) (b : Board) (rule : Rule)
    (tuples : Array (Array RowMatch)) (rng : RngState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hLR : Rule.layerRespecting game rule = true)
    (hAlias : Rule.propertyAliasesOk game rule = true) :
    Board.WellFormed game (applyMatchedTuples game b rule tuples rng).2.1 := by
  unfold applyMatchedTuples
  have : ∀ (tis : List Nat) (any : Bool) (board : Board) (rng : RngState),
      Board.WellFormed game board →
      Board.WellFormed game
        (tis.foldl
          (fun (any, board, rng) ti =>
            let tuple := tuples.getD ti #[]
            let recheck := ti > 0
            let (c, b', rng') := applyRuleTuple game board rule tuple recheck rng
            (any || c, b', rng'))
          (any, board, rng)).2.1 := by
    intro tis any board rng hBoard
    induction tis generalizing any board rng with
    | nil => exact hBoard
    | cons ti rest ih =>
      simp only [List.foldl_cons]
      have hB' := applyRuleTuple_wellFormed game board rule (tuples.getD ti #[]) (ti > 0) rng
        hG hBoard hLR hAlias
      exact ih _ _ _ hB'
  exact this (List.range tuples.size) false b rng hB

theorem tryApplyRule_wellFormed
    (game : Game) (b : Board) (rule : Rule) (st : TurnState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hLR : Rule.layerRespecting game rule = true)
    (hAlias : Rule.propertyAliasesOk game rule = true) :
    Board.WellFormed game (tryApplyRule game b rule st).2.1 := by
  simp only [tryApplyRule]
  split
  · exact hB
  · split
    · exact hB
    · exact applyMatchedTuples_wellFormed game b rule _ st.rng hG hB hLR hAlias

theorem applyRuleGroupPass_wellFormed
    (game : Game) (b : Board) (st : TurnState) (rules : List Rule)
    (nonInertCount consec : Nat) (made : Bool)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hLR : ∀ r ∈ rules, Rule.layerRespecting game r = true)
    (hAlias : ∀ r ∈ rules, Rule.propertyAliasesOk game r = true) :
    Board.WellFormed game (applyRuleGroupPass game b st rules nonInertCount consec made).2.1 := by
  induction rules generalizing b st nonInertCount consec made with
  | nil =>
    simp [applyRuleGroupPass]
    exact hB
  | cons rule rest ih =>
    have hLRr := hLR rule (by simp)
    have hAr := hAlias rule (by simp)
    have hRestL : ∀ r ∈ rest, Rule.layerRespecting game r = true := fun r hr => hLR r (by simp [hr])
    have hRestA : ∀ r ∈ rest, Rule.propertyAliasesOk game r = true := fun r hr => hAlias r (by simp [hr])
    rw [applyRuleGroupPass]
    have hTry := tryApplyRule_wellFormed game b rule st hG hB hLRr hAr
    rcases hT : tryApplyRule game b rule st with ⟨changed, b', st'⟩
    simp only [hT]
    have hBw : Board.WellFormed game b' := by simpa [hT] using hTry
    by_cases hInert : rule.syntacticInertCommandOnly = true
    · rw [if_pos hInert]
      exact ih b st' nonInertCount consec made hB hRestL hRestA
    · rw [if_neg hInert]
      by_cases hCh : changed = true
      · rw [if_pos hCh]
        exact ih b' st' nonInertCount 0 true hBw hRestL hRestA
      · rw [if_neg hCh]
        by_cases hStop : nonInertCount ≠ 0 ∧ consec + 1 = nonInertCount
        · rw [if_pos hStop]
          exact hB
        · rw [if_neg hStop]
          exact ih b st' nonInertCount (consec + 1) made hB hRestL hRestA

theorem applyRuleGroupFuel_wellFormed
    (game : Game) (b : Board) (group : List Rule) (st : TurnState)
    (fuel : Nat) (groupChanged : Bool)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hLR : ∀ r ∈ group, Rule.layerRespecting game r = true)
    (hAlias : ∀ r ∈ group, Rule.propertyAliasesOk game r = true) :
    Board.WellFormed game (applyRuleGroupFuel game b group st fuel groupChanged).2.1 := by
  induction fuel generalizing b st groupChanged with
  | zero =>
    simp [applyRuleGroupFuel]
    exact hB
  | succ fuel ih =>
    rw [applyRuleGroupFuel]
    have hPass := applyRuleGroupPass_wellFormed game b st group (countNonInertRules group) 0 false
      hG hB hLR hAlias
    rcases hP : applyRuleGroupPass game b st group (countNonInertRules group) 0 false with ⟨made, b', st'⟩
    simp only [hP]
    have hB' : Board.WellFormed game b' := by simpa [hP] using hPass
    by_cases hMade : made = true
    · rw [if_pos hMade]
      exact ih b' st' true hB'
    · rw [if_neg hMade]
      exact hB'




theorem applyRandomRuleGroup_wellFormed
    (game : Game) (b : Board) (group : Array Rule) (st : TurnState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hLR : ∀ r ∈ group.toList, Rule.layerRespecting game r = true)
    (hAlias : ∀ r ∈ group.toList, Rule.propertyAliasesOk game r = true) :
    Board.WellFormed game (applyRandomRuleGroup game b group st).2.1 := by
  unfold applyRandomRuleGroup
  by_cases hEmpty : (collectRandomRuleMatches b group).isEmpty = true
  · simp only [hEmpty, ↓reduceIte]
    exact hB
  · simp only [eq_false_of_ne_true hEmpty]
    generalize hp : st.rng.randomNat 0 (collectRandomRuleMatches b group).size = pickPair
    rcases pickPair with ⟨pickIdx, rng'⟩
    generalize hm : (collectRandomRuleMatches b group).getD pickIdx (0, #[]) = pair
    rcases pair with ⟨ruleIdx, tuple⟩
    simp only [hp, hm]
    cases hR : group[ruleIdx]? with
    | none => simp only [hR]; exact hB
    | some rule =>
      simp only [hR]
      have hMem : rule ∈ group.toList := by
        have ⟨hLt, hEq⟩ := Array.getElem?_eq_some_iff.mp hR
        simpa [hEq, Array.mem_toList_iff] using Array.getElem_mem (xs := group) hLt
      exact applyRuleTuple_wellFormed game b rule tuple false rng' hG hB
        (hLR rule hMem) (hAlias rule hMem)

theorem applyRuleGroup_wellFormed
    (game : Game) (b : Board) (group : Array Rule) (st : TurnState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hLR : ∀ r ∈ group.toList, Rule.layerRespecting game r = true)
    (hAlias : ∀ r ∈ group.toList, Rule.propertyAliasesOk game r = true)
    {r : Bool × Board × TurnState}
    (hr : applyRuleGroup game b group st = .ok r) :
    Board.WellFormed game r.2.1 := by
  unfold applyRuleGroup at hr
  split at hr
  · next hsz =>
    by_cases hRand : group[0].isRandom = true
    · simp only [hRand, ↓reduceIte] at hr
      cases hr
      exact applyRandomRuleGroup_wellFormed game b group st hG hB hLR hAlias
    · simp only [eq_false_of_ne_true hRand] at hr
      cases hr
      exact applyRuleGroupFuel_wellFormed game b group.toList st 200 false hG hB
        (fun r hr => hLR r hr) (fun r hr => hAlias r hr)
  · cases hr
    exact applyRuleGroupFuel_wellFormed game b group.toList st 200 false hG hB
      (fun r hr => hLR r hr) (fun r hr => hAlias r hr)





theorem applyRulesWithLoops.go_wellFormed
    (game : Game) (groups : Array (Array Rule)) (loopPoint : Array (Option Nat))
    (bannedGroup : Array Bool) (rulesCount : Nat) (fuel : Nat) (s : ApplyRulesState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game s.board)
    (hLR : ruleGroupsLayerRespecting game groups = true)
    (hAlias : ruleGroupsPropertyAliasesOk game groups = true)
    (hCount : rulesCount = groups.size)
    (r : Bool × Board × TurnState)
    (hr : applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel s = .ok r) :
    Board.WellFormed game r.2.1 := by
  revert r hr
  induction fuel generalizing s with
  | zero =>
    intro r hr
    simp [applyRulesWithLoops.go] at hr
    cases hr; exact hB
  | succ fuel ih =>
    intro r hr
    rw [applyRulesWithLoops.go] at hr
    by_cases hIdx : s.ruleGroupIndex < rulesCount
    · simp only [hIdx, ↓reduceIte] at hr
      have continue_wf :
          ∀ (board1 : Board) (turn1 : TurnState) (rc lp : Bool) (idx lc : Nat),
            Board.WellFormed game board1 →
            ∀ (r : Bool × Board × TurnState),
              applyRulesWithLoops.continueAfter game groups loopPoint bannedGroup rulesCount fuel
                  board1 turn1 rc lp idx lc = .ok r →
                Board.WellFormed game r.2.1 := by
        intro board1 turn1 rc lp idx lc hB1 r hr'
        unfold applyRulesWithLoops.continueAfter at hr'
        split at hr'
        · cases hLP : loopPoint[idx]? with
          | none =>
            simp only [hLP] at hr'
            split at hr'
            · cases hLP2 : loopPoint[rulesCount]? with
              | none =>
                simp only [hLP2] at hr'
                exact ih _ hB1 _ hr'
              | some v =>
                cases v with
                | none =>
                  simp only [hLP2] at hr'
                  exact ih _ hB1 _ hr'
                | some target =>
                  simp only [hLP2] at hr'
                  split at hr'
                  · cases hr'; exact hB1
                  · exact ih _ hB1 _ hr'
            · exact ih _ hB1 _ hr'
          | some v =>
            cases v with
            | none =>
              simp only [hLP] at hr'
              split at hr'
              · cases hLP2 : loopPoint[rulesCount]? with
                | none =>
                  simp only [hLP2] at hr'
                  exact ih _ hB1 _ hr'
                | some w =>
                  cases w with
                  | none =>
                    simp only [hLP2] at hr'
                    exact ih _ hB1 _ hr'
                  | some target =>
                    simp only [hLP2] at hr'
                    split at hr'
                    · cases hr'; exact hB1
                    · exact ih _ hB1 _ hr'
              · exact ih _ hB1 _ hr'
            | some target =>
              simp only [hLP] at hr'
              split at hr'
              · cases hr'; exact hB1
              · exact ih _ hB1 _ hr'
        · exact ih _ hB1 _ hr'
      by_cases hBan : bannedGroup.getD s.ruleGroupIndex false = true
      · simp only [hBan, ↓reduceIte] at hr
        exact continue_wf s.board s.turn s.rulesChanged s.loopPropagated
          s.ruleGroupIndex s.loopCount hB r hr
      · simp only [eq_false_of_ne_true hBan] at hr
        have hGi : s.ruleGroupIndex < groups.size := by simpa [hCount] using hIdx
        have hGroupLR : ∀ r ∈ (groups[s.ruleGroupIndex]).toList,
            Rule.layerRespecting game r = true := by
          intro r hm
          have hAll := (Array.all_eq_true.mp hLR) s.ruleGroupIndex hGi
          have ⟨i, hi, he⟩ := Array.mem_iff_getElem.mp (Array.mem_toList_iff.mp hm)
          simpa [he] using (Array.all_eq_true.mp hAll) i hi
        have hGroupAl : ∀ r ∈ (groups[s.ruleGroupIndex]).toList,
            Rule.propertyAliasesOk game r = true := by
          intro r hm
          have hAll := (Array.all_eq_true.mp hAlias) s.ruleGroupIndex hGi
          have ⟨i, hi, he⟩ := Array.mem_iff_getElem.mp (Array.mem_toList_iff.mp hm)
          simpa [he] using (Array.all_eq_true.mp hAll) i hi
        cases hAg : applyRuleGroup game s.board groups[s.ruleGroupIndex]! s.turn with
        | error e =>
          simp [hAg] at hr
        | ok trip =>
          have hBang : groups[s.ruleGroupIndex]! = groups[s.ruleGroupIndex] := by
            rw [Array.getElem!_eq_getD]
            simp [Array.getD, hGi]
          have hB1 := applyRuleGroup_wellFormed game s.board groups[s.ruleGroupIndex]! s.turn
            hG hB (by simpa [hBang] using hGroupLR) (by simpa [hBang] using hGroupAl) hAg
          simp only [hAg] at hr
          rcases trip with ⟨gc, b', st'⟩
          exact continue_wf b' st' (s.rulesChanged || gc) (s.loopPropagated || gc)
            s.ruleGroupIndex s.loopCount hB1 r hr
    · simp only [hIdx, ↓reduceIte] at hr
      cases hr; exact hB

theorem applyRulesWithLoops_wellFormed
    (game : Game) (b : Board) (groups : Array (Array Rule))
    (loopPoint : Array (Option Nat)) (st : TurnState) (bannedGroup : Array Bool)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game b)
    (hLR : ruleGroupsLayerRespecting game groups = true)
    (hAlias : ruleGroupsPropertyAliasesOk game groups = true)
    {r : Bool × Board × TurnState}
    (hr : applyRulesWithLoops game b groups loopPoint st bannedGroup = .ok r) :
    Board.WellFormed game r.2.1 := by
  unfold applyRulesWithLoops at hr
  exact applyRulesWithLoops.go_wellFormed game groups loopPoint bannedGroup groups.size _ _
    hG hB hLR hAlias rfl _ hr


end PuzzleScript

/-
Fixed line-walk row/column locality (non-ellipsis, cardinal RuleDir).
-/
import PuzzleScript.Board
import PuzzleScript.Runtime
import PuzzleScript.Rules
import PuzzleScript.WellFormed

namespace PuzzleScript

set_option maxHeartbeats 4000000

theorem ruleDirectionDelta_up (h : Nat) :
    ruleDirectionDelta (RuleDir.ofNat 1) h = -1 := by
  simp [ruleDirectionDelta, RuleDir.ofNat]

theorem ruleDirectionDelta_down (h : Nat) :
    ruleDirectionDelta (RuleDir.ofNat 2) h = 1 := by
  simp [ruleDirectionDelta, RuleDir.ofNat]

theorem ruleDirectionDelta_left (h : Nat) :
    ruleDirectionDelta (RuleDir.ofNat 4) h = -Int.ofNat h := by
  simp [ruleDirectionDelta, RuleDir.ofNat]

theorem ruleDirectionDelta_right (h : Nat) :
    ruleDirectionDelta (RuleDir.ofNat 8) h = Int.ofNat h := by
  simp [ruleDirectionDelta, RuleDir.ofNat]

/-- Horizontal step (±height) preserves row (`tileRow`). -/
theorem tileRow_add_height (b : Board) (tile : Nat) (_hh : 0 < b.height) :
    b.tileRow (tile + b.height) = b.tileRow tile := by
  simp [Board.tileRow]

theorem tileRow_sub_height (b : Board) (tile : Nat) (hge : b.height ≤ tile)
    (_hh : 0 < b.height) :
    b.tileRow (tile - b.height) = b.tileRow tile := by
  simp only [Board.tileRow]
  simpa [Nat.mul_one] using
    Nat.sub_mul_mod (n := b.height) (k := 1) (x := tile) (by simpa [Nat.one_mul] using hge)

/-- Vertical step (+1) preserves col when not at bottom of column. -/
theorem tileCol_succ_of_row_lt (b : Board) (tile : Nat)
    (hh : 0 < b.height) (hrow : b.tileRow tile + 1 < b.height) :
    b.tileCol (tile + 1) = b.tileCol tile := by
  let col := b.tileCol tile
  let row := b.tileRow tile
  have hrt := b.runtimeTile_tileCol_tileRow tile hh
  have hsucc : tile + 1 = col * b.height + (row + 1) := by
    calc tile + 1
        _ = b.runtimeTile col row + 1 := by rw [← hrt]
        _ = col * b.height + (row + 1) := by rw [Board.runtimeTile, Nat.add_assoc]
  simp only [Board.tileCol]
  rw [hsucc, Nat.add_comm (col * b.height), Nat.mul_comm col b.height,
    Nat.add_mul_div_left _ _ hh, Nat.div_eq_of_lt (by rw [show row = b.tileRow tile from rfl]; exact hrow)]
  have hcol : col = tile / b.height := by simp [col, Board.tileCol]
  rw [Nat.zero_add, hcol]

theorem tileCol_pred_of_row_pos (b : Board) (tile : Nat)
    (hh : 0 < b.height) (hrow : 0 < b.tileRow tile) :
    b.tileCol (tile - 1) = b.tileCol tile := by
  let col := b.tileCol tile
  let row := b.tileRow tile
  have hrt := b.runtimeTile_tileCol_tileRow tile hh
  have hsub : tile - 1 = col * b.height + (row - 1) := by
    calc tile - 1
        _ = b.runtimeTile col row - 1 := by rw [← hrt]
        _ = col * b.height + (row - 1) := by
          rw [Board.runtimeTile, Nat.add_sub_assoc (Nat.succ_le_iff.mp hrow)]
  have hpred : row - 1 < b.height :=
    Nat.lt_trans (Nat.sub_one_lt (Nat.ne_of_gt hrow)) (Nat.mod_lt tile hh)
  simp only [Board.tileCol]
  rw [hsub, Nat.add_comm (col * b.height), Nat.mul_comm col b.height,
    Nat.add_mul_div_left _ _ hh, Nat.div_eq_of_lt hpred]
  have hcol : col = tile / b.height := by simp [col, Board.tileCol]
  rw [Nat.zero_add, hcol]

/-! Fixed-walk row/column locality (induction on walk length). -/

theorem intToNat_ofNat (n : Nat) : (Int.ofNat n).toNat = n := rfl

theorem intOfNat_mul (a b : Nat) : Int.ofNat a * Int.ofNat b = Int.ofNat (a * b) := by
  rw [Int.ofNat_eq_natCast, Int.ofNat_eq_natCast, Int.ofNat_eq_natCast, Int.natCast_mul]

theorem intOfNat_add (a b : Nat) : Int.ofNat a + Int.ofNat b = Int.ofNat (a + b) := by
  rw [Int.ofNat_eq_natCast, Int.ofNat_eq_natCast, Int.ofNat_eq_natCast, Int.natCast_add]

theorem fixedWalkIdx_left_eq (b : Board) (s k : Nat) :
    fixedWalkIdx s (-Int.ofNat b.height) k = Int.ofNat s - Int.ofNat (k * b.height) := by
  unfold fixedWalkIdx
  rw [Int.neg_mul, intOfNat_mul, Nat.mul_comm, Int.add_neg_eq_sub]

theorem fixedWalkIdx_succ (start : Nat) (delta : Int) (k : Nat) :
    fixedWalkIdx start delta (k + 1) = fixedWalkIdx start delta k + delta := by
  unfold fixedWalkIdx
  rw [show Int.ofNat (k + 1) = Int.ofNat k + 1 by simp, Int.mul_add]
  omega

theorem fixedWalkIdx_zero (start : Nat) (delta : Int) :
    fixedWalkIdx start delta 0 = Int.ofNat start := by
  simp [fixedWalkIdx]

theorem fixedWalkIdx_right_nonneg (b : Board) (s k : Nat) :
    0 ≤ fixedWalkIdx s (Int.ofNat b.height) k := by
  unfold fixedWalkIdx
  exact Int.add_nonneg (Int.natCast_nonneg _) (Int.mul_nonneg (Int.natCast_nonneg _) (Int.natCast_nonneg _))

theorem fixedWalkIdx_right_toNat (b : Board) (s k : Nat) :
    (fixedWalkIdx s (Int.ofNat b.height) k).toNat = s + k * b.height := by
  induction k with
  | zero => simp [fixedWalkIdx, intToNat_ofNat]
  | succ k ih =>
    rw [fixedWalkIdx_succ]
    have h₀ : 0 ≤ fixedWalkIdx s (Int.ofNat b.height) k :=
      fixedWalkIdx_right_nonneg b s k
    have h₁ : 0 ≤ Int.ofNat b.height := Int.natCast_nonneg _
    rw [Int.toNat_add h₀ h₁, ih, intToNat_ofNat]
    simp [Nat.mul_succ, Nat.add_mul, Nat.add_assoc]

theorem fixedWalkIdx_right_tileRow (b : Board) (s k : Nat) (hh : 0 < b.height) :
    b.tileRow (fixedWalkIdx s (Int.ofNat b.height) k).toNat = b.tileRow s := by
  rw [fixedWalkIdx_right_toNat]
  induction k with
  | zero => simp
  | succ k ih =>
    rw [Nat.add_mul, Nat.one_mul, ← Nat.add_assoc, tileRow_add_height b (s + k * b.height) hh, ih]

theorem mul_succ_le_of_mul_succ_le {a b c : Nat} (h : (a + 1) * b ≤ c) : a * b ≤ c := by
  have heq : (a + 1) * b = a * b + b := by rw [Nat.add_mul, Nat.one_mul]
  exact Nat.le_trans (Nat.le_add_right _ _) (heq ▸ h)

theorem fixedWalkIdx_left_nonneg (b : Board) (s k : Nat) (hk : k * b.height ≤ s) :
    0 ≤ fixedWalkIdx s (-Int.ofNat b.height) k := by
  rw [fixedWalkIdx_left_eq]
  rw [Int.sub_nonneg]
  exact (Int.ofNat_le).mpr hk

theorem fixedWalkIdx_up_eq (s k : Nat) :
    fixedWalkIdx s (-1) k = Int.ofNat s - Int.ofNat k := by
  induction k generalizing s with
  | zero => simp [fixedWalkIdx]
  | succ k ih =>
    rw [fixedWalkIdx_succ, ih, Int.add_neg_eq_sub]
    rw [show (1 : Int) = Int.ofNat 1 by rfl, ← intOfNat_add]
    omega

theorem fixedWalkIdx_left_toNat (b : Board) (s k : Nat) (hk : k * b.height ≤ s) :
    (fixedWalkIdx s (-Int.ofNat b.height) k).toNat = s - k * b.height := by
  rw [fixedWalkIdx_left_eq]
  exact Int.toNat_sub s (k * b.height)

theorem fixedWalkIdx_left_tileRow (b : Board) (s k : Nat) (hh : 0 < b.height)
    (hk : k * b.height ≤ s) :
    b.tileRow (fixedWalkIdx s (-Int.ofNat b.height) k).toNat = b.tileRow s := by
  rw [fixedWalkIdx_left_toNat b s k hk]
  induction k with
  | zero => simp [Nat.mul_zero, Nat.sub_zero]
  | succ k ih =>
    have hk₀ : k * b.height ≤ s := mul_succ_le_of_mul_succ_le hk
    have hmul : (k + 1) * b.height = k * b.height + b.height := by rw [Nat.add_mul, Nat.one_mul]
    have hsub : s - (k * b.height + b.height) = s - k * b.height - b.height :=
      Nat.sub_add_eq s (k * b.height) b.height
    rw [hmul, hsub, tileRow_sub_height b (s - k * b.height) (by omega) hh, ih hk₀]

theorem fixedWalkIdx_down_toNat (s k : Nat) :
    (fixedWalkIdx s 1 k).toNat = s + k := by
  induction k with
  | zero => simp [fixedWalkIdx, intToNat_ofNat]
  | succ k ih =>
    rw [fixedWalkIdx_succ]
    have h₀ : 0 ≤ fixedWalkIdx s 1 k := by
      unfold fixedWalkIdx
      exact Int.add_nonneg (Int.natCast_nonneg _) (Int.mul_nonneg (Int.natCast_nonneg _) (Int.natCast_nonneg _))
    have h₁ : 0 ≤ (1 : Int) := Int.natCast_nonneg _
    rw [Int.toNat_add h₀ h₁, ih]
    omega

theorem tileRow_add_one (b : Board) (tile : Nat) (hh : 0 < b.height) (h : b.tileRow tile + 1 < b.height) :
    b.tileRow (tile + 1) = b.tileRow tile + 1 := by
  let col := b.tileCol tile
  let row := b.tileRow tile
  have hrt := b.runtimeTile_tileCol_tileRow tile hh
  have hsucc : tile + 1 = b.runtimeTile col (row + 1) := by
    calc tile + 1
        _ = b.runtimeTile col row + 1 := by rw [← hrt]
        _ = b.runtimeTile col (row + 1) := by simp [Board.runtimeTile, col, row, Nat.add_assoc]
  rw [hsucc, Board.tileRow_runtimeTile b col (row + 1) h]

theorem tileRow_walk_down (b : Board) (s k : Nat) (hh : 0 < b.height) (h : b.tileRow s + k < b.height) :
    b.tileRow (s + k) = b.tileRow s + k := by
  induction k with
  | zero => rfl
  | succ k ih =>
    have ih' := ih (by omega)
    rw [show s + (k + 1) = s + k + 1 from Nat.add_assoc s k 1]
    rw [tileRow_add_one b (s + k) hh (by rw [ih']; omega)]
    rw [ih']
    omega

theorem fixedWalkIdx_down_tileCol (b : Board) (s k : Nat) (hh : 0 < b.height)
    (hcol : b.tileRow s + k < b.height) :
    b.tileCol (fixedWalkIdx s 1 k).toNat = b.tileCol s := by
  rw [fixedWalkIdx_down_toNat]
  induction k with
  | zero => rfl
  | succ k ih =>
    have ih' := ih (by omega)
    rw [show s + (k + 1) = s + k + 1 from Nat.add_assoc s k 1]
    rw [tileCol_succ_of_row_lt b (s + k) hh (by rw [tileRow_walk_down b s k hh (by omega)]; omega)]
    exact ih'

theorem fixedWalkIdx_up_toNat (b : Board) (s k : Nat) (hk : k ≤ b.tileRow s) :
    (fixedWalkIdx s (-1) k).toNat = s - k := by
  rw [fixedWalkIdx_up_eq]
  simpa [Int.ofNat_eq_natCast] using Int.toNat_sub s k

theorem tileRow_sub_one (b : Board) (tile : Nat) (hh : 0 < b.height) (h : 0 < b.tileRow tile) :
    b.tileRow (tile - 1) = b.tileRow tile - 1 := by
  let col := b.tileCol tile
  let row := b.tileRow tile
  have hrt := b.runtimeTile_tileCol_tileRow tile hh
  have hsub : tile - 1 = b.runtimeTile col (row - 1) := by
    calc tile - 1
        _ = b.runtimeTile col row - 1 := by rw [← hrt]
        _ = b.runtimeTile col (row - 1) := by simp [Board.runtimeTile, col, row, Nat.add_sub_assoc (Nat.succ_le_iff.mp h)]
  rw [hsub, Board.tileRow_runtimeTile b col (row - 1)
    (Nat.lt_trans (Nat.sub_one_lt (Nat.ne_of_gt h)) (Nat.mod_lt tile hh))]

theorem tileRow_walk_up (b : Board) (s k : Nat) (hh : 0 < b.height) (hk : k ≤ b.tileRow s) :
    b.tileRow (s - k) = b.tileRow s - k := by
  induction k generalizing s with
  | zero => simp [Nat.sub_zero]
  | succ k ih =>
    have hk' : k + 1 ≤ b.tileRow s := hk
    have hk₀ : k ≤ b.tileRow s := Nat.le_trans (Nat.le_succ k) hk'
    have htr := ih s hk₀
    have hpos : 0 < s - k :=
      Nat.pos_of_ne_zero fun hz => by
        have h0 : b.tileRow (s - k) = 0 := by rw [hz, Board.tileRow, Nat.zero_mod]
        rw [h0] at htr
        omega
    rw [show k + 1 = Nat.succ k from rfl, Nat.sub_succ s k, Nat.pred_eq_sub_one]
    rw [tileRow_sub_one b (s - k) hh (by rw [ih s hk₀]; omega)]
    rw [ih s hk₀]
    omega

theorem fixedWalkIdx_up_tileCol (b : Board) (s k : Nat) (hh : 0 < b.height)
    (hk : k ≤ b.tileRow s) :
    b.tileCol (fixedWalkIdx s (-1) k).toNat = b.tileCol s := by
  rw [fixedWalkIdx_up_toNat b s k hk]
  induction k generalizing s with
  | zero => rfl
  | succ k ih =>
    have hk' : k + 1 ≤ b.tileRow s := hk
    have hk₀ : k ≤ b.tileRow s := Nat.le_trans (Nat.le_succ k) hk'
    rw [show k + 1 = Nat.succ k from rfl, Nat.sub_succ s k, Nat.pred_eq_sub_one]
    rw [tileCol_pred_of_row_pos b (s - k) hh (by rw [tileRow_walk_up b s k hh hk₀]; omega)]
    exact ih s hk₀

theorem RuleDir.eq_ofNat_toNat (d : RuleDir) : d = RuleDir.ofNat d.toNat := by
  cases d
  simp [RuleDir.ofNat, RuleDir.toNat]

theorem fixedWalk_horizontal_same_row (b : Board) (d : RuleDir) (s k : Nat)
    (_hC : d.isCardinal = true) (hH : d.toNat == 4 || d.toNat == 8) (hh : 0 < b.height)
    (hNonneg : fixedWalkIdx s (ruleDirectionDelta d b.height) k ≥ 0) :
    b.tileRow (fixedWalkIdx s (ruleDirectionDelta d b.height) k).toNat = b.tileRow s := by
  by_cases h4 : d.toNat = 4
  · have hδ : ruleDirectionDelta d b.height = -Int.ofNat b.height := by
      rw [RuleDir.eq_ofNat_toNat d, h4, ruleDirectionDelta_left]
    rw [hδ] at hNonneg ⊢
    have hk : k * b.height ≤ s := by
      rw [fixedWalkIdx_left_eq] at hNonneg
      exact (Int.ofNat_le).mp (Int.sub_nonneg.mp hNonneg)
    exact fixedWalkIdx_left_tileRow b s k hh hk
  · have h8 : d.toNat = 8 := by
      simp only [beq_iff_eq, Bool.or_eq_true, decide_eq_true_eq] at hH
      rcases hH with h | h
      · exact absurd h h4
      · exact h
    rw [show ruleDirectionDelta d b.height = Int.ofNat b.height from by
      rw [RuleDir.eq_ofNat_toNat d, h8, ruleDirectionDelta_right]]
    exact fixedWalkIdx_right_tileRow b s k hh

theorem fixedWalk_vertical_same_col (b : Board) (d : RuleDir) (s k : Nat)
    (_hC : d.isCardinal = true) (hV : d.toNat == 1 || d.toNat == 2) (hh : 0 < b.height)
    (hDown : d.toNat == 2 → b.tileRow s + k < b.height)
    (hUp : d.toNat == 1 → k ≤ b.tileRow s) :
    b.tileCol (fixedWalkIdx s (ruleDirectionDelta d b.height) k).toNat = b.tileCol s := by
  by_cases h1 : d.toNat = 1
  · rw [show ruleDirectionDelta d b.height = -1 from by
      rw [RuleDir.eq_ofNat_toNat d, h1, ruleDirectionDelta_up]]
    exact fixedWalkIdx_up_tileCol b s k hh (hUp (by simpa using h1))
  · have h2 : d.toNat = 2 := by
      simp only [beq_iff_eq, Bool.or_eq_true, decide_eq_true_eq] at hV
      rcases hV with h | h
      · exact absurd h h1
      · exact h
    rw [show ruleDirectionDelta d b.height = 1 from by
      rw [RuleDir.eq_ofNat_toNat d, h2, ruleDirectionDelta_down]]
    exact fixedWalkIdx_down_tileCol b s k hh (hDown (by simpa using h2))

/-! Match/apply corollaries on the fixed walk. -/

/-- If `rowCellsMatchFixed` succeeds at cell index `k`, that cell is `.cell`
and `fixedWalkTile?` is `some t` with `t < nTiles` (the only tiles consulted). -/
theorem rowCellsMatchFixed_implies_walk_tile
    (b : Board) (start : Nat) (delta : Int) (row : Array PatternCell) (k : Nat)
    (hk : k < row.size)
    (h : rowCellsMatchFixed b start delta row = true) :
    ∃ pat t, row[k]?.getD (.ellipsis) = .cell pat ∧
      fixedWalkTile? start delta k = some t ∧ t < b.nTiles := by
  simp only [rowCellsMatchFixed] at h
  have hall := List.all_eq_true.mp h
  have hkCell := hall k (List.mem_range.mpr hk)
  cases hcell : row[k]?.getD (.ellipsis) with
  | ellipsis =>
    simp [hcell] at hkCell
  | cell pat =>
    cases hwalk : fixedWalkTile? start delta k with
    | none =>
      simp [hcell, hwalk] at hkCell
    | some t =>
      simp [hcell, hwalk] at hkCell
      exact ⟨pat, t, rfl, rfl, hkCell.1⟩

theorem applyRowAtFixed_preserves_off_walk
    (game : Game) (rule : Rule) (b : Board) (delta : Int) (row : Array PatternCell)
    (start other : Nat) (caps : RuleCaptures) (rng : RngState)
    (hOff : ∀ k < row.size, fixedWalkTile? start delta k ≠ some other) :
    let r := applyRowAtFixed game rule b delta row start caps rng
    r.2.1.cellObjWords other = b.cellObjWords other ∧
      r.2.1.cellMovWords other = b.cellMovWords other := by
  dsimp only [applyRowAtFixed]
  have hInv :
      ∀ (ks : List Nat) (changed : Bool) (board : Board) (rng : RngState),
        board.cellObjWords other = b.cellObjWords other →
          board.cellMovWords other = b.cellMovWords other →
        (∀ k ∈ ks, k < row.size) →
        let r :=
          ks.foldl
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
            (changed, board, rng)
        r.2.1.cellObjWords other = b.cellObjWords other ∧
          r.2.1.cellMovWords other = b.cellMovWords other := by
    intro ks changed board rng hObj hMov hBounds
    induction ks generalizing changed board rng with
    | nil => exact ⟨hObj, hMov⟩
    | cons k ks ih =>
      simp only [List.foldl_cons]
      have hk : k < row.size := hBounds k (by simp)
      have hRest : ∀ k' ∈ ks, k' < row.size :=
        fun k' hk' => hBounds k' (List.mem_cons_of_mem _ hk')
      cases hcell : row[k]?.getD (.ellipsis) with
      | ellipsis =>
        exact ih changed board rng hObj hMov hRest
      | cell pat =>
        cases hwalk : fixedWalkTile? start delta k with
        | none =>
          exact ih changed board rng hObj hMov hRest
        | some t =>
          by_cases ht : t ≥ board.nTiles
          · simp [hcell, hwalk, if_pos ht]
            exact ih changed board rng hObj hMov hRest
          · simp [hcell, hwalk, if_neg (by intro h; exact ht h)]
            have htNe : t ≠ other := fun heq => hOff k hk (by simpa [heq] using hwalk)
            have hp :=
              applyCellReplacement_preserves_other_tiles game rule board t other pat caps rng
                (Ne.symm htNe)
            exact ih (changed || (applyCellReplacement game rule board t pat caps rng).1)
              (applyCellReplacement game rule board t pat caps rng).2.1
              (applyCellReplacement game rule board t pat caps rng).2.2
              (hp.1.trans hObj) (hp.2.trans hMov) hRest
  have hRange : ∀ k ∈ List.range row.size, k < row.size := fun k hk => List.mem_range.mp hk
  exact hInv (List.range row.size) false b rng rfl rfl hRange

theorem applyRowAt_fixed_preserves_off_walk
    (game : Game) (rule : Rule) (b : Board) (delta : Int) (row : Array PatternCell)
    (start other : Nat) (caps : RuleCaptures) (rng : RngState)
    (hNoEll : row.any patternCellIsEllipsis = false)
    (hOff : ∀ k < row.size, fixedWalkTile? start delta k ≠ some other) :
    let r := applyRowAt game rule b delta row (.fixed start) caps rng
    r.2.1.cellObjWords other = b.cellObjWords other ∧
      r.2.1.cellMovWords other = b.cellMovWords other := by
  dsimp only [applyRowAt]
  have hEll : ¬(row.any patternCellIsEllipsis = true) := by
    simpa using hNoEll
  rw [if_neg hEll]
  exact applyRowAtFixed_preserves_off_walk game rule b delta row start other caps rng hOff

end PuzzleScript

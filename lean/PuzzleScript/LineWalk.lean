/-
Fixed line-walk row/column locality (non-ellipsis, cardinal RuleDir).
-/
import PuzzleScript.Board
import PuzzleScript.Runtime
import PuzzleScript.Rules

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

end PuzzleScript

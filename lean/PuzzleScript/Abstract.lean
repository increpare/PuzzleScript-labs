import PuzzleScript.Command
import PuzzleScript.Ids
import PuzzleScript.IR
import PuzzleScript.Rules
import PuzzleScript.Runtime
import PuzzleScript.View

namespace PuzzleScript

/-!
# Abstract kernel (inert-relevant fragment)

Narrow kernel for the first bridge theorems:
command-only / movement-identity rules where mask apply leaves `objects`/`movements` unchanged.

Masks remain authoritative for `parity_smoke`. These lemmas underwrite inert prune.
-/

/-- Rule has commands and every command is inert (`sfx*` / `message`). -/
def Rule.syntacticInertCommands (r : Rule) : Bool :=
  syntacticInertCommandOnly r.commands

/--
Solver-facing board view equality: same geometry and identical object/movement masks.
Implies equal `occ` / `movAt` projections (same mask words ⇒ same bit reads).
-/
structure BoardViewEq (a b : Board) : Prop where
  width : a.width = b.width
  height : a.height = b.height
  layerCount : a.layerCount = b.layerCount
  strideObj : a.strideObj = b.strideObj
  strideMov : a.strideMov = b.strideMov
  objects : a.objects = b.objects
  movements : a.movements = b.movements

theorem BoardViewEq.refl (b : Board) : BoardViewEq b b :=
  ⟨rfl, rfl, rfl, rfl, rfl, rfl, rfl⟩

theorem BoardViewEq.symm {a b : Board} (h : BoardViewEq a b) : BoardViewEq b a :=
  ⟨h.width.symm, h.height.symm, h.layerCount.symm, h.strideObj.symm, h.strideMov.symm,
    h.objects.symm, h.movements.symm⟩

theorem BoardViewEq.trans {a b c : Board} (hab : BoardViewEq a b) (hbc : BoardViewEq b c) :
    BoardViewEq a c :=
  ⟨hab.width.trans hbc.width, hab.height.trans hbc.height, hab.layerCount.trans hbc.layerCount,
    hab.strideObj.trans hbc.strideObj, hab.strideMov.trans hbc.strideMov,
    hab.objects.trans hbc.objects, hab.movements.trans hbc.movements⟩

/-- Occupancy projection agrees when views are equal. -/
theorem BoardViewEq.occ_eq {a b : Board} (h : BoardViewEq a b) (t : TileIdx) :
    a.occ t = b.occ t := by
  cases h
  simp [Board.occ, Board.nTiles, Board.cellObjWords, *]

/-- Movement projection agrees when views are equal. -/
theorem BoardViewEq.movAt_eq {a b : Board} (h : BoardViewEq a b) (t : TileIdx) (ℓ : LayerIdx) :
    a.movAt t ℓ = b.movAt t ℓ := by
  cases h
  simp [Board.movAt, Board.nTiles, Board.cellMovWords, *]

/-- §4.0: without `again` in the queue, again is never eligible. -/
theorem againEligible_false_of_no_again
    (backup current : Board) (cmds : Array Command)
    (hNoAgain : cmds.contains .again = false) :
    againEligible cmds backup current = false := by
  unfold againEligible
  rw [hNoAgain]

/-- If objects are unchanged, again is not eligible even when `again` is queued. -/
theorem againEligible_false_of_objects_unchanged
    (backup current : Board) (cmds : Array Command)
    (h : objectsChanged backup current = false) :
    againEligible cmds backup current = false := by
  unfold againEligible
  cases cmds.contains .again with
  | true => exact h
  | false => rfl

/--
Again-eligibility depends only on the command queue and object masks.
Given `BoardViewEq` (same objects), eligibility vs a fixed backup agrees.

Note: this does *not* prove that mask/group/turn apply of an inert rule yields
`BoardViewEq` — that seam is T5 (`boardViewEq_of_commandOnly_…` at the turn path).
-/
theorem againEligible_congr_of_boardViewEq
    (backup b b' : Board) (cmds : Array Command)
    (hMask : BoardViewEq b b') :
    againEligible cmds backup b = againEligible cmds backup b' := by
  unfold againEligible objectsChanged
  cases hMask
  cases cmds.contains .again <;> simp [*]

end PuzzleScript

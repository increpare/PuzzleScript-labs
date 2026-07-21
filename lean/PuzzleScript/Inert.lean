import PuzzleScript.Abstract
import PuzzleScript.Command
import PuzzleScript.IR
import PuzzleScript.Rules
import PuzzleScript.Runtime

namespace PuzzleScript

/-!
# Inert command-only prune (T5)

## Proven cone

- `tryApplyRule_syntacticInert_preserves_board` / `_effectEq` — inert early-out is a board no-op
  with turn-effectful command atoms unchanged (Runtime.lean)
- `tryApplyRule_congr_effectEq` — apply is congruent under `TurnState.effectEq`
- `queueCommandsForRule_cmdEffectEq_congr` / `_syntacticInert_cmdEffectEq`
- `applyRuleGroupPass_filterNonInert` — one group pass ≡ pass on `filterNonInertRules`
- `applyRuleGroupFuel_filterNonInert` — fuelled group loop ≡ filtered group
- `applyRulesWithLoops_filterNonInert` / `go_filterNonInert` / `continueAfter_filterNonInert`
- `rigidRetry_filterNonInert` / `rigidRetry.go_filterNonInert`
- `cmdEffectEq.contains_*` / `againEligible_congr_cmdEffectEq`
- Fuelled `executeTurn.go` / `processCommandQueue.go` / `runRulesOnLevelStartIfNeeded.go`
  (explicit rule-array parameters; `turnFuelDefault`)
- `syntacticInert_tryApply_boardViewEq` — packages leaf into `BoardViewEq`
- `Command.isInert_ne_*` (again/win/cancel/restart/checkpoint)
- `Game.dropInert` / `noRandomRuleGroups` / `DropInertTurnCongruence` statement

## Done bar

`dropInert_turn_congruence : ∀ g, DropInertTurnCongruence g` under `noRandomRuleGroups`
(rule-array form via `runTurnObsWithRules`; random groups excluded).

Still open: assemble fuelled turn-path induction → `dropInert_turn_congruence` (no `sorry`).
-/

/-- Drop every syntactically inert command-only rule from early and late rule groups. -/
def Game.dropInert (g : Game) : Game :=
  { g with
    rules := filterNonInertGroups g.rules
    lateRules := filterNonInertGroups g.lateRules }

/--
No rule is tagged `isRandom` (stronger than “first rule only”).
Needed so `dropInert`’s filtered groups stay on the non-random `applyRuleGroup` path.
-/
def Game.noRandomRuleGroups (g : Game) : Bool :=
  g.rules.all groupNotRandom && g.lateRules.all groupNotRandom

theorem Game.dropInert_rules (g : Game) :
    (Game.dropInert g).rules = filterNonInertGroups g.rules := rfl

theorem Game.dropInert_lateRules (g : Game) :
    (Game.dropInert g).lateRules = filterNonInertGroups g.lateRules := rfl

theorem Game.noRandomRuleGroups_rules (g : Game) (h : g.noRandomRuleGroups = true) :
    g.rules.all groupNotRandom = true := by
  simp only [Game.noRandomRuleGroups] at h
  exact (Bool.and_eq_true_iff.mp h).1

theorem Game.noRandomRuleGroups_lateRules (g : Game) (h : g.noRandomRuleGroups = true) :
    g.lateRules.all groupNotRandom = true := by
  simp only [Game.noRandomRuleGroups] at h
  exact (Bool.and_eq_true_iff.mp h).2

theorem Game.dropInert_loopPoint (g : Game) : (Game.dropInert g).loopPoint = g.loopPoint := rfl
theorem Game.dropInert_lateLoopPoint (g : Game) : (Game.dropInert g).lateLoopPoint = g.lateLoopPoint := rfl
theorem Game.dropInert_winConditions (g : Game) : (Game.dropInert g).winConditions = g.winConditions := rfl
theorem Game.dropInert_requirePlayerMovement (g : Game) :
    (Game.dropInert g).requirePlayerMovement = g.requirePlayerMovement := rfl
theorem Game.dropInert_runRulesOnLevelStart (g : Game) :
    (Game.dropInert g).runRulesOnLevelStart = g.runRulesOnLevelStart := rfl

theorem Game.dropInert_evaluateWinConditions (g : Game) (b : Board) :
    evaluateWinConditions (Game.dropInert g) b = evaluateWinConditions g b := by
  simp [evaluateWinConditions, Game.dropInert_winConditions]

/-- True if any rule is syntactic-inert-command-only. -/
def Game.hasSyntacticInert (g : Game) : Bool :=
  g.rules.any (fun group => group.any (fun r => r.syntacticInertCommandOnly))
    || g.lateRules.any (fun group => group.any (fun r => r.syntacticInertCommandOnly))

/--
Board + win + again observables extracted after one turn (for stating congruence).
-/
structure TurnObs where
  objects : Array UInt32
  movements : Array UInt32
  winning : Bool
  currentLevel : Nat
  againPending : Bool
  deriving Repr, DecidableEq

def turnObs (s : Session) (againPending : Bool) : TurnObs :=
  { objects := s.board.objects
    movements := s.board.movements
    winning := s.winning
    currentLevel := s.currentLevel
    againPending }

def runTurnObs (g : Game) (s : Session) (input : InputToken) : Except String TurnObs := do
  let (s', again) ← executeTurn g s input
  pure (turnObs s' again)

/-- Turn obs via explicit rule arrays (same `game` metadata). -/
def runTurnObsWithRules (g : Game) (rules lateRules : Array (Array Rule))
    (s : Session) (input : InputToken) : Except String TurnObs := do
  let (s', again) ←
    executeTurn.go g rules lateRules s input false turnFuelDefault
  pure (turnObs s' again)

theorem runTurnObs_eq_withRules (g : Game) (s : Session) (input : InputToken) :
    runTurnObs g s input = runTurnObsWithRules g g.rules g.lateRules s input := by
  simp [runTurnObs, runTurnObsWithRules, executeTurn]

/--
T5 done-bar: under `noRandomRuleGroups`, swapping in inert-filtered rule arrays (same game
metadata) does not change turn observables. This is the executable content of `Game.dropInert`
(which only rewrites `rules` / `lateRules`).
-/
def DropInertTurnCongruence (g : Game) : Prop :=
  g.noRandomRuleGroups = true →
    ∀ (s : Session) (input : InputToken),
      runTurnObsWithRules g g.rules g.lateRules s input =
        runTurnObsWithRules g (filterNonInertGroups g.rules) (filterNonInertGroups g.lateRules)
          s input

/-- Leaf + view bridge packaged for the inert apply. -/
theorem syntacticInert_tryApply_boardViewEq
    (game : Game) (b : Board) (rule : Rule) (st : TurnState)
    (h : rule.syntacticInertCommandOnly = true) :
    BoardViewEq b (tryApplyRule game b rule st).2.1 := by
  have hb := tryApplyRule_syntacticInert_preserves_board game b rule st h
  have hb' : (tryApplyRule game b rule st).2.1 = b := hb.2
  rw [hb']
  exact BoardViewEq.refl b

/-- If objects are unchanged, again-eligibility ignores whatever inert cmds were queued. -/
theorem againEligible_of_inert_queue_and_same_objects
    (backup current : Board) (cmds : Array Command)
    (hObj : objectsChanged backup current = false) :
    againEligible cmds backup current = false :=
  againEligible_false_of_objects_unchanged backup current cmds hObj

theorem boardViewEq_of_unchanged_masks (b b' : Board)
    (hw : b.width = b'.width) (hh : b.height = b'.height) (hl : b.layerCount = b'.layerCount)
    (hsO : b.strideObj = b'.strideObj) (hsM : b.strideMov = b'.strideMov)
    (ho : b.objects = b'.objects) (hm : b.movements = b'.movements) :
    BoardViewEq b b' :=
  ⟨hw, hh, hl, hsO, hsM, ho, hm⟩

/-!
## Next proof step (turn assembly)

`applyRulesWithLoops_filterNonInert` and `rigidRetry_filterNonInert` are proved.
`executeTurn` / `processCommandQueue` / `runRulesOnLevelStartIfNeeded` are fuelled (`*.go`)
and take explicit rule arrays so the same `game` metadata is shared.

Assemble `dropInert_turn_congruence : DropInertTurnCongruence g` by induction on `turnFuelDefault`
using `cmdEffectEq.contains_*`, `againEligible_congr_cmdEffectEq`, and the rigid-retry lemma.
-/

end PuzzleScript

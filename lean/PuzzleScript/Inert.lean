import PuzzleScript.Abstract
import PuzzleScript.Command
import PuzzleScript.IR
import PuzzleScript.Rules
import PuzzleScript.Runtime

namespace PuzzleScript

/-!
# Inert command-only prune (T5)

**In the proven cone today:**
- `Rule.isCommandOnly` / `syntacticInertCommandOnly` / `isCommandOnly_implies_cellsDoNotMutate`
- `BoardViewEq`, `againEligible_*` (Abstract.lean)
- `Game.dropInert` (definition)

**T5 done bar:** prove `DropInertTurnCongruence` below — turn-path observables agree after
`dropInert`, covering `applyRuleGroup` / rigid-retry / late rules / `executeTurn` (not leaf-only).
-/

/-- Drop every syntactically inert command-only rule from early and late rule groups. -/
def Game.dropInert (g : Game) : Game :=
  { g with
    rules := g.rules.map (fun group => group.filter (fun r => !r.syntacticInertCommandOnly))
    lateRules := g.lateRules.map (fun group => group.filter (fun r => !r.syntacticInertCommandOnly)) }

/--
Board + win + again observables extracted after one turn (for stating congruence).
-/
structure TurnObs where
  objects : Array UInt32
  movements : Array UInt32
  winning : Bool
  currentLevel : Nat
  againPending : Bool
  deriving Repr

def turnObs (s : Session) (againPending : Bool) : TurnObs :=
  { objects := s.board.objects
    movements := s.board.movements
    winning := s.winning
    currentLevel := s.currentLevel
    againPending }

def runTurnObs (g : Game) (s : Session) (input : InputToken) : Except String TurnObs := do
  let (s', again) ← executeTurn g s input
  pure (turnObs s' again)

/--
T5 done-bar *statement*: dropping inert command-only rules does not change turn observables.
-/
def DropInertTurnCongruence (g : Game) : Prop :=
  ∀ (s : Session) (input : InputToken),
    runTurnObs g s input = runTurnObs (Game.dropInert g) s input

/--
Leaf scaffolding: if mask apply left objects/movements/geometry unchanged, views and
again-eligibility agree. The missing step is proving command-only inert rules force
that unchanged outcome through `tryApplyRule` then the turn loop.
-/
theorem boardViewEq_of_unchanged_masks (b b' : Board)
    (hw : b.width = b'.width) (hh : b.height = b'.height) (hl : b.layerCount = b'.layerCount)
    (hsO : b.strideObj = b'.strideObj) (hsM : b.strideMov = b'.strideMov)
    (ho : b.objects = b'.objects) (hm : b.movements = b'.movements) :
    BoardViewEq b b' :=
  ⟨hw, hh, hl, hsO, hsM, ho, hm⟩

end PuzzleScript

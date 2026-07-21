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

- T5: `dropInert_turn_congruence` under `noRandomRuleGroups` (no `sorry`).
- Soundness: `dropInert_boardWinEquiv` — multi-turn solver-obs congruence via
  `replaySolverGo` / `drainAgain.go` (executable content of `Game.dropInert`).
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
  currentLevel : LevelIdx
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

/-- Win/checkpoint session agrees under effectful command membership. -/
theorem processCommandQueue.afterWinCheckpoint_congr_cmdEffectEq
    (game : Game) (s1 : Session) (cmdsL cmdsR : Array Command)
    (h : cmdEffectEq cmdsL cmdsR) :
    processCommandQueue.afterWinCheckpoint game s1 cmdsL =
      processCommandQueue.afterWinCheckpoint game s1 cmdsR := by
  simp only [processCommandQueue.afterWinCheckpoint, cmdEffectEq.contains_win h,
    cmdEffectEq.contains_checkpoint h]

/-- Again-probe finish: filtered rules agree (only nested `executeTurn` differs). -/
theorem processCommandQueue.finish_filterNonInert
    (game : Game) (rules lateRules : Array (Array Rule))
    (turnBackup s1 : Session) (cmds : Array Command) (skip : Bool) (fuel : Nat)
    (ihTurn :
      ∀ (session : Session),
        executeTurn.go game rules lateRules session .tick true fuel =
          executeTurn.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
            session .tick true fuel) :
    processCommandQueue.finish game rules lateRules turnBackup s1 cmds skip fuel =
      processCommandQueue.finish game (filterNonInertGroups rules)
        (filterNonInertGroups lateRules) turnBackup s1 cmds skip fuel := by
  simp only [processCommandQueue.finish]
  cases againEligible cmds turnBackup.board
      (processCommandQueue.afterWinCheckpoint game s1 cmds).board with
  | true =>
    cases skip with
    | true => rfl
    | false => rw [ihTurn _]
  | false => rfl

/-- Again-probe finish: same rules; effectful command queues agree. -/
theorem processCommandQueue.finish_congr_cmdEffectEq
    (game : Game) (rules lateRules : Array (Array Rule))
    (turnBackup s1 : Session) (cmdsL cmdsR : Array Command) (skip : Bool) (fuel : Nat)
    (h : cmdEffectEq cmdsL cmdsR) :
    processCommandQueue.finish game rules lateRules turnBackup s1 cmdsL skip fuel =
      processCommandQueue.finish game rules lateRules turnBackup s1 cmdsR skip fuel := by
  have hAfter :=
    processCommandQueue.afterWinCheckpoint_congr_cmdEffectEq game s1 cmdsL cmdsR h
  simp only [processCommandQueue.finish, ← hAfter]
  have hElig :=
    againEligible_congr_cmdEffectEq cmdsL cmdsR turnBackup.board
      (processCommandQueue.afterWinCheckpoint game s1 cmdsL).board h
  simp only [hElig]

/-- Same rules; turns related by `effectEq` ⇒ command queue path agrees. -/
theorem processCommandQueue.go_congr_effectEq
    (game : Game) (rules lateRules : Array (Array Rule))
    (turnBackup session : Session) (turnL turnR : TurnState) (skip : Bool) (fuel : Nat)
    (hst : TurnState.effectEq turnL turnR) :
    processCommandQueue.go game rules lateRules turnBackup session turnL skip fuel =
      processCommandQueue.go game rules lateRules turnBackup session turnR skip fuel := by
  cases fuel with
  | zero => rfl
  | succ fuel =>
    have hCancel := cmdEffectEq.contains_cancel hst.2.2.2
    have hRestart := cmdEffectEq.contains_restart hst.2.2.2
    have hWin := cmdEffectEq.contains_win hst.2.2.2
    have hCheck := cmdEffectEq.contains_checkpoint hst.2.2.2
    have hElig :
        ∀ (b : Board),
          againEligible turnL.commandQueue turnBackup.board b =
            againEligible turnR.commandQueue turnBackup.board b :=
      fun b => againEligible_congr_cmdEffectEq turnL.commandQueue turnR.commandQueue
        turnBackup.board b hst.2.2.2
    have hAfter :
        ∀ (s1 : Session),
          processCommandQueue.afterWinCheckpoint game s1 turnL.commandQueue =
            processCommandQueue.afterWinCheckpoint game s1 turnR.commandQueue :=
      fun s1 =>
        processCommandQueue.afterWinCheckpoint_congr_cmdEffectEq game s1
          turnL.commandQueue turnR.commandQueue hst.2.2.2
    simp only [processCommandQueue.go]
    simp only [← hCancel, ← hRestart, hElig, hAfter]

/-- Movement body congruence under inert-filtered rules. -/
theorem executeTurn.movementGo_filterNonInert
    (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
    (startBoard : Board) (playerPositions : Array Nat) (turn0 : TurnState)
    (skip : Bool) (fuel : Nat)
    (hRules : rules.all groupNotRandom = true)
    (hLate : lateRules.all groupNotRandom = true)
    (ihCmd :
      ∀ (turnBackup session : Session) (turn : TurnState) (skip : Bool),
        processCommandQueue.go game rules lateRules turnBackup session turn skip fuel =
          processCommandQueue.go game (filterNonInertGroups rules)
            (filterNonInertGroups lateRules) turnBackup session turn skip fuel) :
    executeTurn.movementGo game rules lateRules session startBoard playerPositions turn0 skip
        fuel =
      executeTurn.movementGo game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
        session startBoard playerPositions turn0 skip fuel := by
  simp only [executeTurn.movementGo]
  have hRigid :=
    rigidRetry_filterNonInert game rules lateRules game.loopPoint game.lateLoopPoint
      startBoard turn0 turn0 (TurnState.effectEq.refl _) hRules hLate
  cases hRL : rigidRetry game rules lateRules game.loopPoint game.lateLoopPoint startBoard turn0 with
  | error eL =>
    simp only [hRL] at hRigid ⊢
    cases hRR : rigidRetry game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
        game.loopPoint game.lateLoopPoint startBoard turn0 with
    | error eR =>
      simp only [hRR] at hRigid ⊢
      simp only [hRigid]
    | ok _ => simp only [hRR] at hRigid
  | ok tripL =>
    rcases tripL with ⟨bL, tL⟩
    simp only [hRL] at hRigid ⊢
    cases hRR : rigidRetry game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
        game.loopPoint game.lateLoopPoint startBoard turn0 with
    | error _ => simp only [hRR] at hRigid
    | ok tripR =>
      rcases tripR with ⟨bR, tR⟩
      simp only [hRR] at hRigid ⊢
      rcases hRigid with ⟨rfl, hT⟩
      have hWin := TurnState.effectEq.contains_win hT
      have hRng : tL.rng = tR.rng := hT.2.2.1
      simp only [← hWin, ← hRng]
      split
      · rfl
      · -- Session fields match via ←hWin/←hRng; filter then effectEq on the turn.
        have hP :=
          ihCmd session
            { session with
              board := bL
              winning := evaluateWinConditions game bL || tL.commandQueue.contains .win
              rng := tL.rng }
            tL skip
        have hP' :=
          processCommandQueue.go_congr_effectEq game (filterNonInertGroups rules)
            (filterNonInertGroups lateRules) session
            { session with
              board := bL
              winning := evaluateWinConditions game bL || tL.commandQueue.contains .win
              rng := tL.rng }
            tL tR skip fuel hT
        rw [hP, hP']

/-- Fuelled turn-path: filtered rule arrays stay observationally equal. -/
theorem turnGo_filterNonInert (fuel : Nat) :
    (∀ (game : Game) (rules lateRules : Array (Array Rule)) (session : Session),
      rules.all groupNotRandom = true →
      lateRules.all groupNotRandom = true →
      runRulesOnLevelStartIfNeeded.go game rules lateRules session fuel =
        runRulesOnLevelStartIfNeeded.go game (filterNonInertGroups rules)
          (filterNonInertGroups lateRules) session fuel) ∧
    (∀ (game : Game) (rules lateRules : Array (Array Rule))
        (turnBackup session : Session) (turn : TurnState) (skip : Bool),
      rules.all groupNotRandom = true →
      lateRules.all groupNotRandom = true →
      processCommandQueue.go game rules lateRules turnBackup session turn skip fuel =
        processCommandQueue.go game (filterNonInertGroups rules)
          (filterNonInertGroups lateRules) turnBackup session turn skip fuel) ∧
    (∀ (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
        (input : InputToken) (skip : Bool),
      rules.all groupNotRandom = true →
      lateRules.all groupNotRandom = true →
      executeTurn.go game rules lateRules session input skip fuel =
        executeTurn.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
          session input skip fuel) := by
  induction fuel with
  | zero =>
    refine ⟨fun _ _ _ _ _ _ => rfl, fun _ _ _ _ _ _ _ _ _ => rfl,
      fun _ _ _ _ _ _ _ _ => rfl⟩
  | succ fuel ih =>
    rcases ih with ⟨ihStart, ihCmd, ihTurn⟩
    refine ⟨?start, ?cmd, ?turn⟩
    case start =>
      intro game rules lateRules session hRules hLate
      simp only [runRulesOnLevelStartIfNeeded.go]
      split
      · rfl
      · rw [ihTurn game rules lateRules session .tick true hRules hLate]
    case cmd =>
      intro game rules lateRules turnBackup session turn skip hRules hLate
      cases hC : turn.commandQueue.contains .cancel with
      | true =>
        simp only [processCommandQueue.go]
        rw [hC]
        simp
      | false =>
        cases hRst : turn.commandQueue.contains .restart with
        | true =>
          simp only [processCommandQueue.go]
          rw [hC, hRst]
          simp
          rw [ihStart game rules lateRules _ hRules hLate]
          cases runRulesOnLevelStartIfNeeded.go game (filterNonInertGroups rules)
              (filterNonInertGroups lateRules)
              (let s1 :=
                { session with
                  undoBackups :=
                    session.undoBackups.push
                      (turnBackup.board, turnBackup.currentLevel, turnBackup.winning) }
               match s1.restartBoard with
               | some rb => { s1 with board := rb.clearMovements }
               | none => s1) fuel with
          | error _ => rfl
          | ok s1 =>
            change
              processCommandQueue.finish game rules lateRules turnBackup s1
                  turn.commandQueue skip fuel =
                processCommandQueue.finish game (filterNonInertGroups rules)
                  (filterNonInertGroups lateRules) turnBackup s1 turn.commandQueue skip fuel
            exact
              processCommandQueue.finish_filterNonInert game rules lateRules turnBackup s1
                turn.commandQueue skip fuel fun session =>
                  ihTurn game rules lateRules session .tick true hRules hLate
        | false =>
          simp only [processCommandQueue.go]
          rw [hC, hRst]
          simp
          change
            processCommandQueue.finish game rules lateRules turnBackup session
                turn.commandQueue skip fuel =
              processCommandQueue.finish game (filterNonInertGroups rules)
                (filterNonInertGroups lateRules) turnBackup session turn.commandQueue skip fuel
          exact
            processCommandQueue.finish_filterNonInert game rules lateRules turnBackup session
              turn.commandQueue skip fuel fun session =>
                ihTurn game rules lateRules session .tick true hRules hLate
    case turn =>
      intro game rules lateRules session input skip hRules hLate
      cases input with
      | undo => simp only [executeTurn.go]
      | restart =>
        simp only [executeTurn.go]
        rw [ihStart game rules lateRules _ hRules hLate]
      | tick =>
        rw [executeTurn.go_eq_movementGo game rules lateRules session .tick skip fuel
          (Or.inl rfl)]
        rw [executeTurn.go_eq_movementGo game (filterNonInertGroups rules)
          (filterNonInertGroups lateRules) session .tick skip fuel (Or.inl rfl)]
        exact executeTurn.movementGo_filterNonInert game rules lateRules session _ _
          (TurnState.initial session.rng) skip fuel hRules hLate
          (fun tb s t sk => ihCmd game rules lateRules tb s t sk hRules hLate)
      | move d =>
        rw [executeTurn.go_eq_movementGo game rules lateRules session (.move d) skip fuel
          (Or.inr (Or.inr ⟨d, rfl⟩))]
        rw [executeTurn.go_eq_movementGo game (filterNonInertGroups rules)
          (filterNonInertGroups lateRules) session (.move d) skip fuel
          (Or.inr (Or.inr ⟨d, rfl⟩))]
        exact executeTurn.movementGo_filterNonInert game rules lateRules session _ _
          (TurnState.initial session.rng) skip fuel hRules hLate
          (fun tb s t sk => ihCmd game rules lateRules tb s t sk hRules hLate)
      | action =>
        rw [executeTurn.go_eq_movementGo game rules lateRules session .action skip fuel
          (Or.inr (Or.inl rfl))]
        rw [executeTurn.go_eq_movementGo game (filterNonInertGroups rules)
          (filterNonInertGroups lateRules) session .action skip fuel (Or.inr (Or.inl rfl))]
        exact executeTurn.movementGo_filterNonInert game rules lateRules session _ _
          (TurnState.initial session.rng) skip fuel hRules hLate
          (fun tb s t sk => ihCmd game rules lateRules tb s t sk hRules hLate)

theorem executeTurn.go_filterNonInert
    (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
    (input : InputToken) (skip : Bool) (fuel : Nat)
    (hRules : rules.all groupNotRandom = true)
    (hLate : lateRules.all groupNotRandom = true) :
    executeTurn.go game rules lateRules session input skip fuel =
      executeTurn.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
        session input skip fuel :=
  (turnGo_filterNonInert fuel).2.2 game rules lateRules session input skip hRules hLate

/-- T5 done-bar: inert-filtered rule arrays preserve turn observables. -/
theorem dropInert_turn_congruence (g : Game) : DropInertTurnCongruence g := by
  intro h s input
  have hR := Game.noRandomRuleGroups_rules g h
  have hL := Game.noRandomRuleGroups_lateRules g h
  have hGo :=
    executeTurn.go_filterNonInert g g.rules g.lateRules s input false turnFuelDefault hR hL
  simp only [runTurnObsWithRules, hGo]

/-!
# boardWinEquiv (multi-turn inert soundness)

Lift T5 turn congruence through again-drain and finite input sequences.
`Game.dropInert` only rewrites `rules`/`lateRules`; solver obs are compared under the
same game metadata with those arrays swapped (executable content of dropInert).
-/

theorem Game.withoutRules_dropInert (g : Game) :
    Game.withoutRules (Game.dropInert g) = Game.withoutRules g := rfl

/-- Solver-facing session snapshot (excludes undo depth, rng, restart board, sounds). -/
structure SolverObs where
  objects : Array UInt32
  movements : Array UInt32
  winning : Bool
  currentLevel : LevelIdx
  deriving Repr, DecidableEq

def sessionSolverObs (s : Session) : SolverObs :=
  { objects := s.board.objects
    movements := s.board.movements
    winning := s.winning
    currentLevel := s.currentLevel }

/-- Leaf board-effect identity: apply leaves the board unchanged. -/
def Rule.boardEffectId (game : Game) (rule : Rule) : Prop :=
  ∀ (b : Board) (st : TurnState), (tryApplyRule game b rule st).2.1 = b

theorem syntacticInert_boardEffectId (game : Game) (rule : Rule)
    (h : rule.syntacticInertCommandOnly = true) :
    Rule.boardEffectId game rule := by
  intro b st
  exact (tryApplyRule_syntacticInert_preserves_board game b rule st h).2

/-- Fuelled again-drain (replay's `while again`). -/
def drainAgain.go (game : Game) (rules lateRules : Array (Array Rule))
    (s : Session) (again : Bool) : Nat → Except String Session
  | 0 => throw "again fuel exhausted"
  | fuel + 1 =>
    match again with
    | false => pure s
    | true =>
      match executeTurn.go game rules lateRules s .tick false fuel with
      | .error e => .error e
      | .ok (s', again') => drainAgain.go game rules lateRules s' again' fuel

/-- Finite input sequence under explicit rule arrays (no undo; solver-obs only). -/
def replaySolverGo (game : Game) (rules lateRules : Array (Array Rule))
    (s : Session) : List InputToken → Nat → Except String Session
  | [], _ => pure s
  | _, 0 => throw "replay fuel exhausted"
  | input :: rest, fuel + 1 =>
    match executeTurn.go game rules lateRules s input false fuel with
    | .error e => .error e
    | .ok (s', again) =>
      match drainAgain.go game rules lateRules s' again fuel with
      | .error e => .error e
      | .ok sSettled => replaySolverGo game rules lateRules sSettled rest fuel

theorem drainAgain.go_filterNonInert
    (game : Game) (rules lateRules : Array (Array Rule))
    (s : Session) (again : Bool) (fuel : Nat)
    (hRules : rules.all groupNotRandom = true)
    (hLate : lateRules.all groupNotRandom = true) :
    drainAgain.go game rules lateRules s again fuel =
      drainAgain.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
        s again fuel := by
  induction fuel generalizing s again with
  | zero => rfl
  | succ fuel ih =>
    cases again with
    | false => rfl
    | true =>
      simp only [drainAgain.go]
      rw [executeTurn.go_filterNonInert game rules lateRules s .tick false fuel hRules hLate]
      cases executeTurn.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
          s .tick false fuel with
      | error _ => rfl
      | ok p =>
        rcases p with ⟨s', again'⟩
        exact ih s' again'

theorem replaySolverGo_filterNonInert
    (game : Game) (rules lateRules : Array (Array Rule))
    (s : Session) (inputs : List InputToken) (fuel : Nat)
    (hRules : rules.all groupNotRandom = true)
    (hLate : lateRules.all groupNotRandom = true) :
    replaySolverGo game rules lateRules s inputs fuel =
      replaySolverGo game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
        s inputs fuel := by
  induction inputs generalizing s fuel with
  | nil => cases fuel <;> rfl
  | cons input rest ih =>
    cases fuel with
    | zero => rfl
    | succ fuel =>
      simp only [replaySolverGo]
      rw [executeTurn.go_filterNonInert game rules lateRules s input false fuel hRules hLate]
      cases executeTurn.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
          s input false fuel with
      | error _ => rfl
      | ok p =>
        rcases p with ⟨s', again⟩
        simp
        rw [drainAgain.go_filterNonInert game rules lateRules s' again fuel hRules hLate]
        cases drainAgain.go game (filterNonInertGroups rules) (filterNonInertGroups lateRules)
            s' again fuel with
        | error _ => rfl
        | ok sSettled => exact ih sSettled fuel

/--
`boardWinEquiv g g'`: same non-rule game metadata, and finite input sequences under
`g`'s metadata with each game's rule arrays agree on solver observables.
-/
def boardWinEquiv (g g' : Game) : Prop :=
  Game.withoutRules g = Game.withoutRules g' ∧
    ∀ (s : Session) (inputs : List InputToken),
      (sessionSolverObs <$>
          replaySolverGo g g.rules g.lateRules s inputs turnFuelDefault) =
        (sessionSolverObs <$>
          replaySolverGo g g'.rules g'.lateRules s inputs turnFuelDefault)

/--
Inert prune soundness: under `noRandomRuleGroups`, `dropInert` preserves solver
observables across finite input sequences (design-doc `boardWinEquiv`).
-/
theorem dropInert_boardWinEquiv (g : Game) (h : g.noRandomRuleGroups = true) :
    boardWinEquiv g (Game.dropInert g) := by
  refine ⟨Game.withoutRules_dropInert g, ?_⟩
  intro s inputs
  have hR := Game.noRandomRuleGroups_rules g h
  have hL := Game.noRandomRuleGroups_lateRules g h
  simp only [Game.dropInert_rules, Game.dropInert_lateRules]
  rw [replaySolverGo_filterNonInert g g.rules g.lateRules s inputs turnFuelDefault hR hL]

end PuzzleScript

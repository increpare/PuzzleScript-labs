/-
Session / turn WellFormed preservation (Phase B–C).
-/
import PuzzleScript.WellFormed
import PuzzleScript.Inert

namespace PuzzleScript

set_option maxHeartbeats 8000000

theorem Game.RulesLayerRespecting.rules_layer
    (game : Game) (h : Game.RulesLayerRespecting game) :
    ruleGroupsLayerRespecting game game.rules = true := by
  simp only [Game.RulesLayerRespecting, Game.rulesLayerRespecting, Bool.and_eq_true_iff] at h
  exact h.1.1.1

theorem Game.RulesLayerRespecting.late_layer
    (game : Game) (h : Game.RulesLayerRespecting game) :
    ruleGroupsLayerRespecting game game.lateRules = true := by
  simp only [Game.RulesLayerRespecting, Game.rulesLayerRespecting, Bool.and_eq_true_iff] at h
  exact h.1.1.2

theorem Game.RulesLayerRespecting.rules_alias
    (game : Game) (h : Game.RulesLayerRespecting game) :
    ruleGroupsPropertyAliasesOk game game.rules = true := by
  simp only [Game.RulesLayerRespecting, Game.rulesLayerRespecting, Bool.and_eq_true_iff] at h
  exact h.1.2

theorem Game.RulesLayerRespecting.late_alias
    (game : Game) (h : Game.RulesLayerRespecting game) :
    ruleGroupsPropertyAliasesOk game game.lateRules = true := by
  simp only [Game.RulesLayerRespecting, Game.rulesLayerRespecting, Bool.and_eq_true_iff] at h
  exact h.2

theorem Board.matchesPlayable_clearMovements (game : Game) (b : Board) (e : LevelEntry) :
    Board.matchesPlayable game b.clearMovements e = Board.matchesPlayable game b e := by
  cases e <;> simp [Board.matchesPlayable, Board.clearMovements]

theorem Board.rigidUndo_wellFormed (game : Game) (startBoard : Board)
    (h : Board.WellFormed game startBoard) :
    Board.WellFormed game
      { startBoard with
        objects := startBoard.objects
        movements := startBoard.movements
        rigidGroupIndexMask := startBoard.rigidGroupIndexMask
        rigidMovementAppliedMask := startBoard.rigidMovementAppliedMask } := h

theorem rigidRetry.go_wellFormed
    (game : Game) (rules lateRules : Array (Array Rule))
    (loopPoint lateLoopPoint : Array (Option Nat)) (startBoard : Board)
    (fuel : Nat) (s : RigidRetryState)
    (hG : Game.WellFormed game) (hStart : Board.WellFormed game startBoard)
    (hB : Board.WellFormed game s.board)
    (hLR : ruleGroupsLayerRespecting game rules = true)
    (hAlias : ruleGroupsPropertyAliasesOk game rules = true)
    (hLRl : ruleGroupsLayerRespecting game lateRules = true)
    (hAliasL : ruleGroupsPropertyAliasesOk game lateRules = true)
    (r : RigidRetryState)
    (hr : rigidRetry.go game rules lateRules loopPoint lateLoopPoint startBoard fuel s = .ok r) :
    Board.WellFormed game r.board := by
  revert r hr
  induction fuel generalizing s with
  | zero =>
    intro r hr
    simp [rigidRetry.go] at hr
    cases hr; exact hB
  | succ fuel ih =>
    intro r hr
    rw [rigidRetry.go] at hr
    cases hEarly : applyRulesWithLoops game s.board rules loopPoint s.turn s.bannedGroup with
    | error e => simp [hEarly] at hr
    | ok trip =>
      simp only [hEarly] at hr
      have hB' := applyRulesWithLoops_wellFormed game s.board rules loopPoint s.turn s.bannedGroup
        hG hB hLR hAlias hEarly
      rcases trip with ⟨_, board', turn'⟩
      simp only at hB' hr
      have hRes := Board.resolveMovements_wellFormed game board' s.bannedGroup hG hB'
      generalize hRM : resolveMovements game board' s.bannedGroup = rm
      rcases rm with ⟨board'', doUndo, banned'⟩
      have hB'' : Board.WellFormed game board'' := by simpa [hRM] using hRes
      simp only [hRM] at hr
      by_cases hUndo : doUndo = true
      · simp only [hUndo, ↓reduceIte] at hr
        exact ih _ (Board.rigidUndo_wellFormed game startBoard hStart) _ hr
      · simp only [eq_false_of_ne_true hUndo] at hr
        by_cases hLateEmpty : lateRules.isEmpty = true
        · have : (!lateRules.isEmpty) = false := by simp [hLateEmpty]
          simp only [this, ↓reduceIte] at hr
          cases hr; exact hB''
        · have : (!lateRules.isEmpty) = true := by
            simp [eq_false_of_ne_true hLateEmpty]
          simp only [this, ↓reduceIte] at hr
          cases hLateR : applyRulesWithLoops game board'' lateRules lateLoopPoint turn' #[] with
          | error e => simp [hLateR] at hr
          | ok tripL =>
            simp only [hLateR] at hr
            cases hr
            exact applyRulesWithLoops_wellFormed game board'' lateRules lateLoopPoint turn' #[]
              hG hB'' hLRl hAliasL hLateR

theorem rigidRetry_wellFormed
    (game : Game) (rules lateRules : Array (Array Rule))
    (loopPoint lateLoopPoint : Array (Option Nat)) (startBoard : Board) (turn : TurnState)
    (hG : Game.WellFormed game) (hB : Board.WellFormed game startBoard)
    (hLR : ruleGroupsLayerRespecting game rules = true)
    (hAlias : ruleGroupsPropertyAliasesOk game rules = true)
    (hLRl : ruleGroupsLayerRespecting game lateRules = true)
    (hAliasL : ruleGroupsPropertyAliasesOk game lateRules = true)
    (r : Board × TurnState)
    (hr : rigidRetry game rules lateRules loopPoint lateLoopPoint startBoard turn = .ok r) :
    Board.WellFormed game r.1 := by
  simp only [rigidRetry] at hr
  cases hGo : rigidRetry.go game rules lateRules loopPoint lateLoopPoint startBoard 50
      { board := startBoard, turn := turn, bannedGroup := #[] } with
  | error e => simp [hGo] at hr
  | ok s =>
    simp only [hGo] at hr
    cases hr
    exact rigidRetry.go_wellFormed game rules lateRules loopPoint lateLoopPoint startBoard 50 _
      hG hB hB hLR hAlias hLRl hAliasL _ hGo

theorem Session.WellFormed.board
    (game : Game) (s : Session) (h : Session.WellFormed game s) :
    Board.WellFormed game s.board := by
  simp only [Session.WellFormed, Session.wellFormed] at h
  cases hAct : Game.activePlayableLevel? game s.currentLevel with
  | none => simp [hAct] at h
  | some e =>
    simp only [hAct, Bool.and_eq_true_iff] at h
    exact h.1.1.2

theorem Session.WellFormed.undoFrames
    (game : Game) (s : Session) (h : Session.WellFormed game s) :
    s.undoBackups.all (Session.undoFrameWellFormed game) = true := by
  simp only [Session.WellFormed, Session.wellFormed] at h
  cases hAct : Game.activePlayableLevel? game s.currentLevel with
  | none => simp [hAct] at h
  | some e =>
    simp only [hAct, Bool.and_eq_true_iff] at h
    exact h.2

theorem Session.WellFormed.restartOk
    (game : Game) (s : Session) (e : LevelEntry)
    (h : Session.WellFormed game s)
    (hAct : Game.activePlayableLevel? game s.currentLevel = some e) :
    (match s.restartBoard with
      | none => true
      | some rb => Board.matchesPlayable game rb e && Board.wellFormed game rb) = true := by
  simp only [Session.WellFormed, Session.wellFormed, hAct, Bool.and_eq_true_iff] at h
  exact h.1.2

theorem Session.undoFrameWellFormed_of_mem
    (game : Game) (frames : Array (Board × LevelIdx × Bool))
    (frame : Board × LevelIdx × Bool)
    (hFrames : frames.all (Session.undoFrameWellFormed game) = true)
    (hMem : frame ∈ frames) :
    Session.undoFrameWellFormed game frame = true := by
  have ⟨i, hi, he⟩ := Array.mem_iff_getElem.mp hMem
  simpa [he] using (Array.all_eq_true.mp hFrames) i hi

theorem Array.all_extract_prefix {α : Type} (a : Array α) (n : Nat) (p : α → Bool)
    (h : a.all p = true) (hn : n ≤ a.size) :
    (a.extract 0 n).all p = true := by
  refine Array.all_eq_true.mpr ?_
  intro i hi
  have hsz : (a.extract 0 n).size = min n a.size := by simp [Array.size_extract]
  have hi' : i < a.size := by
    have : i < min n a.size := by simpa [hsz] using hi
    exact Nat.lt_of_lt_of_le this (Nat.min_le_right _ _)
  have hEq : (a.extract 0 n)[i] = a[i] := by
    simp [Array.getElem_extract, Nat.add_zero]
  simpa [hEq] using (Array.all_eq_true.mp h) i hi'

theorem Session.undo_preserves_wellFormed
    (game : Game) (session : Session)
    (hS : Session.WellFormed game session)
    (board : Board) (lvl : LevelIdx) (win : Bool)
    (hFrame : session.undoBackups.back? = some (board, lvl, win)) :
    Session.WellFormed game
      (let restartBoard :=
        match session.restartBoard with
        | none => none
        | some rb =>
          match Game.activePlayableLevel? game lvl with
          | some e =>
            if Board.matchesPlayable game rb e then some rb else none
          | none => none
       { session with
         board := board.clearMovements
         currentLevel := lvl
         winning := win
         undoBackups := session.undoBackups.extract 0 (session.undoBackups.size - 1)
         restartBoard := restartBoard }) := by
  have hFrames := Session.WellFormed.undoFrames game session hS
  have hMem := Array.mem_of_back? hFrame
  have hUF := Session.undoFrameWellFormed_of_mem game session.undoBackups (board, lvl, win)
    hFrames hMem
  let restartBoard :=
    match session.restartBoard with
    | none => none
    | some rb =>
      match Game.activePlayableLevel? game lvl with
      | some e =>
        if Board.matchesPlayable game rb e then some rb else none
      | none => none
  let s' : Session :=
    { session with
      board := board.clearMovements
      currentLevel := lvl
      winning := win
      undoBackups := session.undoBackups.extract 0 (session.undoBackups.size - 1)
      restartBoard := restartBoard }
  show Session.WellFormed game s'
  simp only [Session.WellFormed, Session.wellFormed, Session.undoFrameWellFormed] at hUF
  cases hAct : Game.activePlayableLevel? game lvl with
  | none => simp [hAct] at hUF
  | some e =>
    simp only [hAct, Bool.and_eq_true_iff] at hUF
    have hMatch : Board.matchesPlayable game board.clearMovements e = true := by
      simpa [Board.matchesPlayable_clearMovements] using hUF.1
    have hBWF : Board.wellFormed game board.clearMovements = true :=
      Board.clearMovements_wellFormed game board hUF.2
    have hUndoPref :=
      Array.all_extract_prefix session.undoBackups (session.undoBackups.size - 1)
        (Session.undoFrameWellFormed game) hFrames (Nat.sub_le _ _)
    have hRB :
        (match restartBoard with
          | none => true
          | some rb => Board.matchesPlayable game rb e && Board.wellFormed game rb) = true := by
      dsimp only [restartBoard]
      cases hOld : session.restartBoard with
      | none => simp [hAct]
      | some rb =>
        simp only [hOld, hAct]
        by_cases hm : Board.matchesPlayable game rb e = true
        · rw [if_pos hm]
          have hB : Board.wellFormed game rb = true := by
            simp only [Session.WellFormed, Session.wellFormed] at hS
            cases hA : Game.activePlayableLevel? game session.currentLevel with
            | none => simp [hA] at hS
            | some e0 =>
              simp only [hA, Bool.and_eq_true_iff, hOld] at hS
              exact hS.1.2.2
          exact Bool.and_eq_true_iff.mpr ⟨hm, hB⟩
        · rw [if_neg hm]
    simp only [Session.WellFormed, Session.wellFormed, s', hAct]
    exact Bool.and_eq_true_iff.mpr
      ⟨Bool.and_eq_true_iff.mpr ⟨Bool.and_eq_true_iff.mpr ⟨hMatch, hBWF⟩, hRB⟩, hUndoPref⟩

theorem executeTurn.go_undo_session_wellFormed
    (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
    (skip : Bool) (fuel : Nat)
    (hS : Session.WellFormed game session)
    (r : Session × Bool)
    (hr : executeTurn.go game rules lateRules session .undo skip (fuel + 1) = .ok r) :
    Session.WellFormed game r.1 := by
  simp only [executeTurn.go] at hr
  cases hU : session.undoBackups.back? with
  | none =>
    simp [hU] at hr
    cases hr
    exact hS
  | some frame =>
    simp only [hU] at hr
    cases hr
    rcases frame with ⟨board, lvl, win⟩
    exact Session.undo_preserves_wellFormed game session hS board lvl win hU

theorem Session.withBoard_wellFormed
    (game : Game) (s : Session) (b : Board)
    (hS : Session.WellFormed game s)
    (hB : Board.WellFormed game b)
    (hMatch : ∀ e, Game.activePlayableLevel? game s.currentLevel = some e →
      Board.matchesPlayable game b e = true) :
    Session.WellFormed game { s with board := b } := by
  simp only [Session.WellFormed, Session.wellFormed] at hS ⊢
  cases hAct : Game.activePlayableLevel? game s.currentLevel with
  | none => simp [hAct] at hS
  | some e =>
    simp only [hAct, Bool.and_eq_true_iff] at hS ⊢
    exact ⟨⟨⟨hMatch e hAct, hB⟩, hS.1.2⟩, hS.2⟩

theorem Session.withWinning_wellFormed
    (game : Game) (s : Session) (w : Bool)
    (hS : Session.WellFormed game s) :
    Session.WellFormed game { s with winning := w } := by
  simpa [Session.WellFormed, Session.wellFormed] using hS

theorem Session.withRng_wellFormed
    (game : Game) (s : Session) (rng : RngState)
    (hS : Session.WellFormed game s) :
    Session.WellFormed game { s with rng := rng } := by
  simpa [Session.WellFormed, Session.wellFormed] using hS

/-- `matchesPlayable` depends only on geometry fields. -/
theorem Board.matchesPlayable_congr_geom
    (game : Game) (b b' : Board) (e : LevelEntry)
    (hw : b.width = b'.width) (hh : b.height = b'.height)
    (hl : b.layerCount = b'.layerCount)
    (so : b.strideObj = b'.strideObj) (sm : b.strideMov = b'.strideMov) :
    Board.matchesPlayable game b e = Board.matchesPlayable game b' e := by
  cases e <;> simp [Board.matchesPlayable, hw, hh, hl, so, sm]

theorem Board.setCellObjWords_geom (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellObjWords tile ws).width = b.width ∧
    (b.setCellObjWords tile ws).height = b.height ∧
    (b.setCellObjWords tile ws).layerCount = b.layerCount ∧
    (b.setCellObjWords tile ws).strideObj = b.strideObj ∧
    (b.setCellObjWords tile ws).strideMov = b.strideMov := by
  simp [Board.setCellObjWords]

theorem Board.setCellMovWords_geom (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellMovWords tile ws).width = b.width ∧
    (b.setCellMovWords tile ws).height = b.height ∧
    (b.setCellMovWords tile ws).layerCount = b.layerCount ∧
    (b.setCellMovWords tile ws).strideObj = b.strideObj ∧
    (b.setCellMovWords tile ws).strideMov = b.strideMov := by
  simp [Board.setCellMovWords]

theorem Board.clearMovements_geom (b : Board) :
    b.clearMovements.width = b.width ∧
    b.clearMovements.height = b.height ∧
    b.clearMovements.layerCount = b.layerCount ∧
    b.clearMovements.strideObj = b.strideObj ∧
    b.clearMovements.strideMov = b.strideMov := by
  simp [Board.clearMovements]

theorem Board.moveEntitiesAtIndex_geom
    (game : Game) (b : Board) (tile : Nat) (mask : MaskWords) (dirMask : UInt32) :
    let b' := moveEntitiesAtIndex game b tile mask dirMask
    b'.width = b.width ∧ b'.height = b.height ∧ b'.layerCount = b.layerCount ∧
    b'.strideObj = b.strideObj ∧ b'.strideMov = b.strideMov := by
  simp [moveEntitiesAtIndex, Board.setCellMovWords_geom]

theorem foldl_moveEntities_geom
    (game : Game) (dirMask : UInt32) (tiles : List Nat) (b : Board) :
    let b' := tiles.foldl (fun board tile => moveEntitiesAtIndex game board tile game.playerMask dirMask) b
    b'.width = b.width ∧ b'.height = b.height ∧ b'.layerCount = b.layerCount ∧
    b'.strideObj = b.strideObj ∧ b'.strideMov = b.strideMov := by
  induction tiles generalizing b with
  | nil => simp
  | cons t rest ih =>
    simp only [List.foldl_cons]
    have h1 := Board.moveEntitiesAtIndex_geom game b t game.playerMask dirMask
    have h2 := ih (moveEntitiesAtIndex game b t game.playerMask dirMask)
    exact ⟨h2.1.trans h1.1, h2.2.1.trans h1.2.1, h2.2.2.1.trans h1.2.2.1,
      h2.2.2.2.1.trans h1.2.2.2.1, h2.2.2.2.2.trans h1.2.2.2.2⟩

theorem Board.startMovement_geom (game : Game) (b : Board) (dirMask : UInt32) :
    let b' := (startMovement game b dirMask).1
    b'.width = b.width ∧ b'.height = b.height ∧ b'.layerCount = b.layerCount ∧
    b'.strideObj = b.strideObj ∧ b'.strideMov = b.strideMov := by
  unfold startMovement
  simpa [← Array.foldl_toList] using foldl_moveEntities_geom game dirMask (getPlayerPositions game b).toList b

/-- Helper: transfer matchesPlayable across equal geometry. -/
theorem Board.matchesPlayable_of_geom
    (game : Game) (b b' : Board) (e : LevelEntry)
    (hMatch : Board.matchesPlayable game b e = true)
    (hw : b'.width = b.width) (hh : b'.height = b.height)
    (hl : b'.layerCount = b.layerCount)
    (so : b'.strideObj = b.strideObj) (sm : b'.strideMov = b.strideMov) :
    Board.matchesPlayable game b' e = true := by
  simpa [Board.matchesPlayable_congr_geom game b b' e hw.symm hh.symm hl.symm so.symm sm.symm] using hMatch

theorem Board.startMovement_matchesPlayable
    (game : Game) (b : Board) (dirMask : UInt32) (e : LevelEntry)
    (h : Board.matchesPlayable game b e = true) :
    Board.matchesPlayable game (startMovement game b dirMask).1 e = true := by
  have g := Board.startMovement_geom game b dirMask
  exact Board.matchesPlayable_of_geom game b _ e h g.1 g.2.1 g.2.2.1 g.2.2.2.1 g.2.2.2.2

theorem processCommandQueue.afterWinCheckpoint_wellFormed
    (game : Game) (s1 : Session) (cmds : Array Command)
    (hS : Session.WellFormed game s1) :
    Session.WellFormed game (processCommandQueue.afterWinCheckpoint game s1 cmds) := by
  unfold processCommandQueue.afterWinCheckpoint
  by_cases hWin : (s1.winning || cmds.contains .win || evaluateWinConditions game s1.board) = true
  · simp only [hWin, Bool.not_true]
    exact Session.withWinning_wellFormed game s1 true hS
  · have hWinF : (s1.winning || cmds.contains .win || evaluateWinConditions game s1.board) = false :=
      eq_false_of_ne_true hWin
    simp only [hWinF, Bool.not_false]
    by_cases hCp : cmds.contains .checkpoint = true
    · simp only [hCp]
      have hOut : Session.WellFormed game
          { s1 with winning := false, restartBoard := some s1.board.clearMovements } := by
        simp only [Session.WellFormed, Session.wellFormed] at hS ⊢
        cases hAct : Game.activePlayableLevel? game s1.currentLevel with
        | none => simp [hAct] at hS
        | some e =>
          simp only [hAct, Bool.and_eq_true_iff] at hS ⊢
          have hMatch := by simpa [Board.matchesPlayable_clearMovements] using hS.1.1.1
          have hBWF := Board.clearMovements_wellFormed game s1.board hS.1.1.2
          exact ⟨⟨⟨hS.1.1.1, hS.1.1.2⟩, ⟨hMatch, hBWF⟩⟩, hS.2⟩
      simpa using hOut
    · simp only [eq_false_of_ne_true hCp]
      exact Session.withWinning_wellFormed game s1 false hS

theorem executeTurn.go_wellFormed_undo
    (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
    (skip : Bool) (fuel : Nat)
    (hS : Session.WellFormed game session)
    (r : Session × Bool)
    (hr : executeTurn.go game rules lateRules session .undo skip (fuel + 1) = .ok r) :
    Session.WellFormed game r.1 :=
  executeTurn.go_undo_session_wellFormed game rules lateRules session skip fuel hS r hr


/-- With Board.WF on both sides, matchesPlayable needs only width/height preservation. -/
theorem Board.matchesPlayable_of_WH_preserved
    (game : Game) (b b' : Board) (e : LevelEntry)
    (hMatch : Board.matchesPlayable game b e = true)
    (hWF : Board.WellFormed game b)
    (hWF' : Board.WellFormed game b')
    (hw : b'.width = b.width) (hh : b'.height = b.height) :
    Board.matchesPlayable game b' e = true := by
  have hl : b'.layerCount = b.layerCount := by
    simp only [Board.WellFormed, Board.wellFormed, Bool.and_eq_true_iff, beq_iff_eq] at hWF hWF'
    exact hWF'.1.1.1.1.1.1.trans hWF.1.1.1.1.1.1.symm
  have so : b'.strideObj = b.strideObj := by
    simp only [Board.WellFormed, Board.wellFormed, Bool.and_eq_true_iff, beq_iff_eq] at hWF hWF'
    exact hWF'.1.1.1.1.1.2.trans hWF.1.1.1.1.1.2.symm
  have sm : b'.strideMov = b.strideMov := by
    simp only [Board.WellFormed, Board.wellFormed, Bool.and_eq_true_iff, beq_iff_eq] at hWF hWF'
    exact hWF'.1.1.1.1.2.trans hWF.1.1.1.1.2.symm
  exact Board.matchesPlayable_of_geom game b b' e hMatch hw hh hl so sm

theorem Board.clearMovements_WH (b : Board) :
    b.clearMovements.width = b.width ∧ b.clearMovements.height = b.height := by
  simp [Board.clearMovements]

theorem Board.startMovement_WH (game : Game) (b : Board) (dirMask : UInt32) :
    (startMovement game b dirMask).1.width = b.width ∧
    (startMovement game b dirMask).1.height = b.height := by
  have g := Board.startMovement_geom game b dirMask
  exact ⟨g.1, g.2.1⟩

theorem Session.withBoardWinningRng_wellFormed
    (game : Game) (s : Session) (b : Board) (w : Bool) (rng : RngState)
    (hS : Session.WellFormed game s)
    (hB : Board.WellFormed game b)
    (hMatch : ∀ e, Game.activePlayableLevel? game s.currentLevel = some e →
      Board.matchesPlayable game b e = true) :
    Session.WellFormed game { s with board := b, winning := w, rng := rng } := by
  have h1 := Session.withBoard_wellFormed game s b hS hB hMatch
  have h2 := Session.withWinning_wellFormed game { s with board := b } w h1
  simpa using Session.withRng_wellFormed game { s with board := b, winning := w } rng h2

/-- Push current board as undo frame; preserves Session.WF. -/
theorem Session.pushUndo_wellFormed
    (game : Game) (s : Session)
    (hS : Session.WellFormed game s) :
    Session.WellFormed game
      { s with
        undoBackups :=
          s.undoBackups.push (s.board, s.currentLevel, s.winning) } := by
  simp only [Session.WellFormed, Session.wellFormed] at hS ⊢
  cases hAct : Game.activePlayableLevel? game s.currentLevel with
  | none => simp [hAct] at hS
  | some e =>
    simp only [hAct, Bool.and_eq_true_iff] at hS ⊢
    have hFrame : Session.undoFrameWellFormed game (s.board, s.currentLevel, s.winning) = true := by
      simp only [Session.undoFrameWellFormed, hAct]
      exact Bool.and_eq_true_iff.mpr ⟨hS.1.1.1, hS.1.1.2⟩
    have hAll : (s.undoBackups.push (s.board, s.currentLevel, s.winning)).all
        (Session.undoFrameWellFormed game) = true := by
      refine Array.all_eq_true.mpr ?_
      intro i hi
      have hsz : (s.undoBackups.push (s.board, s.currentLevel, s.winning)).size =
          s.undoBackups.size + 1 := by simp
      have hi' : i < s.undoBackups.size + 1 := by simpa [hsz] using hi
      by_cases hLast : i = s.undoBackups.size
      · have heq : (s.undoBackups.push (s.board, s.currentLevel, s.winning))[i]'(by simpa [hsz] using hi) =
            (s.board, s.currentLevel, s.winning) := by
          simp [Array.getElem_push, hLast]
        simpa [heq] using hFrame
      · have hi0 : i < s.undoBackups.size := by omega
        have heq : (s.undoBackups.push (s.board, s.currentLevel, s.winning))[i]'(by simpa [hsz] using hi) =
            s.undoBackups[i] := by
          simp [Array.getElem_push, hi0]
        simpa [heq] using (Array.all_eq_true.mp hS.2) i hi0
    exact ⟨⟨⟨hS.1.1.1, hS.1.1.2⟩, hS.1.2⟩, hAll⟩

/-- Restore restart board when it matches the active playable at `currentLevel`. -/
theorem Session.restoreRestartBoard_wellFormed
    (game : Game) (s : Session) (rb : Board) (e : LevelEntry)
    (hS : Session.WellFormed game s)
    (_hRB : s.restartBoard = some rb)
    (hAct : Game.activePlayableLevel? game s.currentLevel = some e)
    (hMatch : Board.matchesPlayable game rb e = true)
    (hB : Board.WellFormed game rb) :
    Session.WellFormed game
      { s with
        board := rb.clearMovements
        undoBackups :=
          s.undoBackups.push (s.board, s.currentLevel, s.winning) } := by
  have hPush := Session.pushUndo_wellFormed game s hS
  refine Session.withBoard_wellFormed game
    { s with undoBackups := s.undoBackups.push (s.board, s.currentLevel, s.winning) }
    rb.clearMovements hPush
    (Board.clearMovements_wellFormed game rb hB) ?_
  intro e' hAct'
  have : e' = e := by
    rw [hAct] at hAct'
    exact (Option.some.inj hAct').symm
  subst this
  simpa [Board.matchesPlayable_clearMovements] using hMatch


theorem Board.applyRigidCellMasks_WH
    (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern) :
    (applyRigidCellMasks game rule b tile pat).1.width = b.width ∧
    (applyRigidCellMasks game rule b tile pat).1.height = b.height := by
  unfold applyRigidCellMasks
  by_cases hr : rule.rigid = true
  · have : (!rule.rigid) = false := by simp [hr]
    simp only [this]
    by_cases hBits :
        (maskNoBitsInCommon
            (buildRigidGroupMask game rule.groupNumber pat.movementsLayerMask b.strideMov)
            (b.cellRigidGroupIndexMask tile) &&
          maskNoBitsInCommon pat.movementsLayerMask (b.cellRigidMovementAppliedMask tile)) = true
    · rw [if_pos hBits]
      simp [Board.setCellRigidGroupIndexMask, Board.setCellRigidMovementAppliedMask]
    · rw [if_neg hBits]; simp
  · have : (!rule.rigid) = true := by simp [eq_false_of_ne_true hr]
    simp only [this]; simp

theorem Board.commitCellReplacement_WH
    (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern)
    (oc os mc ms : MaskWords) (rng : RngState) :
    (commitCellReplacement game rule b tile pat oc os mc ms rng).2.1.width = b.width ∧
    (commitCellReplacement game rule b tile pat oc os mc ms rng).2.1.height = b.height := by
  dsimp only [commitCellReplacement]
  generalize hRigid : applyRigidCellMasks game rule b tile pat = rigidPair
  rcases rigidPair with ⟨board0, rigidChange⟩
  have h0 := Board.applyRigidCellMasks_WH game rule b tile pat
  simp only [hRigid] at h0
  cases hCond :
      ((maskApplyReplacement (b.cellObjWords tile) oc os == b.cellObjWords tile) &&
        (maskApplyReplacement (b.cellMovWords tile) (maskOr mc pat.movementsLayerMask) ms ==
          b.cellMovWords tile) &&
        !rigidChange) with
  | true => simp
  | false =>
    simp [Board.setCellObjWords, Board.setCellMovWords, h0.1, h0.2]

theorem applyCellReplacement_WH
    (game : Game) (rule : Rule) (b : Board) (tile : Nat) (pat : CellPattern)
    (caps : RuleCaptures) (rng : RngState) :
    (applyCellReplacement game rule b tile pat caps rng).2.1.width = b.width ∧
    (applyCellReplacement game rule b tile pat caps rng).2.1.height = b.height := by
  unfold applyCellReplacement
  by_cases h : (!pat.hasReplacement) = true
  · simp [h]
  · simp only [eq_false_of_ne_true h]
    exact Board.commitCellReplacement_WH game rule b tile pat _ _ _ _ _

theorem Board.repositionEntitiesAtCell_wh
    (game : Game) (b : Board) (tile : Nat) :
    (repositionEntitiesAtCell game b tile).2.width = b.width ∧
    (repositionEntitiesAtCell game b tile).2.height = b.height := by
  have := Board.repositionEntitiesAtCell_nTiles game b tile
  -- nTiles proof already established WH internally; unfold similarly
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

theorem foldl_resolve_pass_WH
    (game : Game) (tiles : List Nat) (moved : Bool) (b : Board) :
    (tiles.foldl
      (fun (moved, board) tile =>
        let mov := board.cellMovWords tile
        if maskAnyBits mov then
          let (thisMoved, b') := repositionEntitiesAtCell game board tile
          if thisMoved then (true, b') else (moved, board)
        else (moved, board))
      (moved, b)).2.width = b.width ∧
    (tiles.foldl
      (fun (moved, board) tile =>
        let mov := board.cellMovWords tile
        if maskAnyBits mov then
          let (thisMoved, b') := repositionEntitiesAtCell game board tile
          if thisMoved then (true, b') else (moved, board)
        else (moved, board))
      (moved, b)).2.height = b.height := by
  induction tiles generalizing moved b with
  | nil => simp
  | cons t rest ih =>
    simp only [List.foldl_cons]
    by_cases hm : maskAnyBits (b.cellMovWords t) = true
    · rw [if_pos hm]
      have hR := Board.repositionEntitiesAtCell_wh game b t
      by_cases ht : (repositionEntitiesAtCell game b t).1 = true
      · rw [if_pos ht]
        have ih' := ih true (repositionEntitiesAtCell game b t).2
        exact ⟨ih'.1.trans hR.1, ih'.2.trans hR.2⟩
      · rw [if_neg ht]; exact ih moved b
    · rw [if_neg hm]; exact ih moved b

theorem resolveMovements.sweep_WH (game : Game) (fuel : Nat) (b : Board) :
    (resolveMovements.sweep game fuel b).width = b.width ∧
    (resolveMovements.sweep game fuel b).height = b.height := by
  induction fuel generalizing b with
  | zero => simp [resolveMovements.sweep]
  | succ fuel ih =>
    rw [resolveMovements.sweep]
    have hPass := foldl_resolve_pass_WH game (List.range b.nTiles) false b
    generalize hR : (List.range b.nTiles).foldl
      (fun (moved, board) tile =>
        let mov := board.cellMovWords tile
        if maskAnyBits mov then
          let (thisMoved, b') := repositionEntitiesAtCell game board tile
          if thisMoved then (true, b') else (moved, board)
        else (moved, board))
      (false, b) = r
    rcases r with ⟨moved, board'⟩
    have hWH : board'.width = b.width ∧ board'.height = b.height := by simpa [hR] using hPass
    simp only [hR]
    by_cases hm : moved = true
    · rw [if_pos hm]
      have ih' := ih board'
      exact ⟨ih'.1.trans hWH.1, ih'.2.trans hWH.2⟩
    · rw [if_neg hm]; exact hWH

theorem clearLingeringAtTile_WH (game : Game) (board : Board) (tile : Nat) :
    (clearLingeringAtTile game board tile).width = board.width ∧
    (clearLingeringAtTile game board tile).height = board.height := by
  unfold clearLingeringAtTile
  by_cases h : maskAnyBits (board.cellMovWords tile) = true
  · rw [if_pos h]
    by_cases hr : game.gameRigid = true
    · rw [if_pos hr]
      simp [Board.setCellMovWords, Board.setCellRigidGroupIndexMask,
        Board.setCellRigidMovementAppliedMask]
    · rw [if_neg hr]; simp [Board.setCellMovWords]
  · rw [if_neg h]; simp

theorem foldl_clearLingering_WH
    (game : Game) (tiles : List Nat) (b : Board) :
    (tiles.foldl (clearLingeringAtTile game) b).width = b.width ∧
    (tiles.foldl (clearLingeringAtTile game) b).height = b.height := by
  induction tiles generalizing b with
  | nil => simp
  | cons t rest ih =>
    simp only [List.foldl_cons]
    have h1 := clearLingeringAtTile_WH game b t
    have h2 := ih (clearLingeringAtTile game b t)
    exact ⟨h2.1.trans h1.1, h2.2.trans h1.2⟩

theorem clearLingeringMovements_WH (game : Game) (b : Board) :
    (clearLingeringMovements game b).width = b.width ∧
    (clearLingeringMovements game b).height = b.height := by
  unfold clearLingeringMovements
  exact foldl_clearLingering_WH game (List.range b.nTiles) b

theorem Board.resolveMovements_WH
    (game : Game) (b : Board) (bannedGroup : Array Bool) :
    (resolveMovements game b bannedGroup).1.width = b.width ∧
    (resolveMovements game b bannedGroup).1.height = b.height := by
  unfold resolveMovements resolveMovements.finalize
  have hS := resolveMovements.sweep_WH game (b.nTiles * game.layerCount + 1) b
  have hC := clearLingeringMovements_WH game
    (resolveMovements.sweep game (b.nTiles * game.layerCount + 1) b)
  exact ⟨hC.1.trans hS.1, hC.2.trans hS.2⟩


theorem applyRowAtFold_WH
    (game : Game) (rule : Rule) (b : Board) (delta : Int)
    (row : Array PatternCell) (rm : RowMatch)
    (caps : RuleCaptures) (rng : RngState) :
    (applyRowAtFold game rule b delta row rm caps rng).2.1.width = b.width ∧
    (applyRowAtFold game rule b delta row rm caps rng).2.1.height = b.height := by
  unfold applyRowAtFold
  let gaps : Array Nat :=
    match rm with
    | .fixed _ => #[]
    | .ellipsis1 _ g => #[g]
    | .ellipsis2 _ g1 g2 => #[g1, g2]
  have fold_wh : ∀ (cells : List PatternCell) (gapIdx : Nat) (idx : Int) (changed : Bool)
      (board : Board) (rng : RngState),
      board.width = b.width → board.height = b.height →
      let out := cells.foldl
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
        (gapIdx, idx, changed, board, rng)
      out.2.2.2.1.width = b.width ∧ out.2.2.2.1.height = b.height := by
    intro cells gapIdx idx changed board rng hw hh
    induction cells generalizing gapIdx idx changed board rng with
    | nil => exact ⟨hw, hh⟩
    | cons cell rest ih =>
      simp only [List.foldl_cons]
      cases cell with
      | ellipsis => exact ih _ _ _ _ _ hw hh
      | cell pat =>
        by_cases hSkip : (decide (idx < 0) || decide (idx.toNat ≥ board.nTiles)) = true
        · simp only [hSkip, ↓reduceIte]; exact ih _ _ _ _ _ hw hh
        · simp only [eq_false_of_ne_true hSkip]
          have hC := applyCellReplacement_WH game rule board idx.toNat pat caps rng
          exact ih _ _ _ _ _ (hC.1.trans hw) (hC.2.trans hh)
  exact fold_wh row.toList 0 (Int.ofNat (rowMatchStart rm)) false b rng rfl rfl

theorem applyRowAtFixed_WH
    (game : Game) (rule : Rule) (b : Board) (delta : Int)
    (row : Array PatternCell) (start : Nat)
    (caps : RuleCaptures) (rng : RngState) :
    (applyRowAtFixed game rule b delta row start caps rng).2.1.width = b.width ∧
    (applyRowAtFixed game rule b delta row start caps rng).2.1.height = b.height := by
  dsimp only [applyRowAtFixed]
  have hInv :
      ∀ (ks : List Nat) (changed : Bool) (board : Board) (rng : RngState),
        board.width = b.width → board.height = b.height →
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
          (changed, board, rng)).2.1.width = b.width ∧
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
          (changed, board, rng)).2.1.height = b.height := by
    intro ks changed board rng hw hh
    induction ks generalizing changed board rng with
    | nil => exact ⟨hw, hh⟩
    | cons k rest ih =>
      simp only [List.foldl_cons]
      cases hcell : row[k]?.getD (.ellipsis) with
      | ellipsis => exact ih _ _ _ hw hh
      | cell pat =>
        cases hwalk : fixedWalkTile? start delta k with
        | none => exact ih _ _ _ hw hh
        | some t =>
          by_cases ht : t ≥ board.nTiles
          · simp [hcell, hwalk, if_pos ht]; exact ih _ _ _ hw hh
          · simp [hcell, hwalk, if_neg (by intro h; exact ht h)]
            have hC := applyCellReplacement_WH game rule board t pat caps rng
            exact ih _ _ _ (hC.1.trans hw) (hC.2.trans hh)
  exact hInv (List.range row.size) false b rng rfl rfl

theorem applyRowAt_WH
    (game : Game) (rule : Rule) (b : Board) (delta : Int)
    (row : Array PatternCell) (rm : RowMatch)
    (caps : RuleCaptures) (rng : RngState) :
    (applyRowAt game rule b delta row rm caps rng).2.1.width = b.width ∧
    (applyRowAt game rule b delta row rm caps rng).2.1.height = b.height := by
  cases rm with
  | fixed s =>
    simp only [applyRowAt]
    by_cases hEll : row.any patternCellIsEllipsis = true
    · simp only [hEll, ↓reduceIte]
      exact applyRowAtFold_WH game rule b delta row (.fixed s) caps rng
    · simp only [eq_false_of_ne_true hEll, ↓reduceIte]
      exact applyRowAtFixed_WH game rule b delta row s caps rng
  | ellipsis1 start gap =>
    simpa [applyRowAt] using
      applyRowAtFold_WH game rule b delta row (.ellipsis1 start gap) caps rng
  | ellipsis2 start gap1 gap2 =>
    simpa [applyRowAt] using
      applyRowAtFold_WH game rule b delta row (.ellipsis2 start gap1 gap2) caps rng

theorem applyRuleTuple_WH
    (game : Game) (b : Board) (rule : Rule) (tuple : Array RowMatch)
    (recheck : Bool) (rng : RngState) :
    (applyRuleTuple game b rule tuple recheck rng).2.1.width = b.width ∧
    (applyRuleTuple game b rule tuple recheck rng).2.1.height = b.height := by
  unfold applyRuleTuple
  by_cases hRecheck : (recheck && !tupleStillMatches b rule tuple) = true
  · rw [if_pos hRecheck]; exact ⟨rfl, rfl⟩
  · rw [if_neg hRecheck]
    let delta := ruleDirectionDelta rule.direction b.height
    let caps :=
      captureAggregateBindings b rule tuple delta
        (capturePropertyBindings game b rule tuple delta RuleCaptures.empty)
    have fold_wh : ∀ (ris : List Nat) (changed : Bool) (board : Board) (rng : RngState),
        board.width = b.width → board.height = b.height →
        let out := ris.foldl
          (fun (changed, board, rng') ri =>
            let (c, b', r) := applyRowAt game rule board delta
              (rule.patternRows.getD ri #[]) (tuple.getD ri (.fixed 0)) caps rng'
            (changed || c, b', r))
          (changed, board, rng)
        out.2.1.width = b.width ∧ out.2.1.height = b.height := by
      intro ris changed board rng hw hh
      induction ris generalizing changed board rng with
      | nil => exact ⟨hw, hh⟩
      | cons ri rest ih =>
        simp only [List.foldl_cons]
        have hR := applyRowAt_WH game rule board delta
          (rule.patternRows.getD ri #[]) (tuple.getD ri (.fixed 0)) caps rng
        exact ih _ _ _ (hR.1.trans hw) (hR.2.trans hh)
    exact fold_wh (List.range tuple.size) false b rng rfl rfl

theorem applyMatchedTuples_WH
    (game : Game) (b : Board) (rule : Rule) (tuples : Array (Array RowMatch))
    (rng : RngState) :
    (applyMatchedTuples game b rule tuples rng).2.1.width = b.width ∧
    (applyMatchedTuples game b rule tuples rng).2.1.height = b.height := by
  unfold applyMatchedTuples
  have fold_wh : ∀ (tis : List Nat) (any : Bool) (board : Board) (rng : RngState),
      board.width = b.width → board.height = b.height →
      let out := tis.foldl
        (fun (any, board, rng) ti =>
          let (c, b', rng') := applyRuleTuple game board rule (tuples.getD ti #[]) (ti > 0) rng
          (any || c, b', rng'))
        (any, board, rng)
      out.2.1.width = b.width ∧ out.2.1.height = b.height := by
    intro tis any board rng hw hh
    induction tis generalizing any board rng with
    | nil => exact ⟨hw, hh⟩
    | cons ti rest ih =>
      simp only [List.foldl_cons]
      have hT := applyRuleTuple_WH game board rule (tuples.getD ti #[]) (decide (ti > 0)) rng
      exact ih _ _ _ (hT.1.trans hw) (hT.2.trans hh)
  exact fold_wh (List.range tuples.size) false b rng rfl rfl

theorem tryApplyRule_WH
    (game : Game) (b : Board) (rule : Rule) (st : TurnState) :
    (tryApplyRule game b rule st).2.1.width = b.width ∧
    (tryApplyRule game b rule st).2.1.height = b.height := by
  simp only [tryApplyRule]
  split
  · exact ⟨rfl, rfl⟩
  · split
    · exact ⟨rfl, rfl⟩
    · exact applyMatchedTuples_WH game b rule _ st.rng

theorem applyRuleGroupPass_WH
    (game : Game) (b : Board) (st : TurnState) (group : List Rule)
    (nonInertCount consec : Nat) (made : Bool) :
    (applyRuleGroupPass game b st group nonInertCount consec made).2.1.width = b.width ∧
    (applyRuleGroupPass game b st group nonInertCount consec made).2.1.height = b.height := by
  induction group generalizing b st consec made with
  | nil => simp [applyRuleGroupPass]
  | cons rule rest ih =>
    rw [applyRuleGroupPass]
    have hTry := tryApplyRule_WH game b rule st
    rcases hT : tryApplyRule game b rule st with ⟨changed, b', st'⟩
    simp only [hT]
    have hBw : b'.width = b.width ∧ b'.height = b.height := by simpa [hT] using hTry
    by_cases hInert : rule.syntacticInertCommandOnly = true
    · rw [if_pos hInert]
      exact ih b st' consec made
    · rw [if_neg hInert]
      by_cases hc : changed = true
      · rw [if_pos hc]
        have ih' := ih b' st' 0 true
        exact ⟨ih'.1.trans hBw.1, ih'.2.trans hBw.2⟩
      · rw [if_neg hc]
        by_cases hStop : nonInertCount ≠ 0 ∧ consec + 1 = nonInertCount
        · rw [if_pos hStop]
          exact ⟨rfl, rfl⟩
        · rw [if_neg hStop]
          exact ih b st' (consec + 1) made

theorem applyRuleGroupFuel_WH
    (game : Game) (b : Board) (group : List Rule) (st : TurnState)
    (fuel : Nat) (groupChanged : Bool) :
    (applyRuleGroupFuel game b group st fuel groupChanged).2.1.width = b.width ∧
    (applyRuleGroupFuel game b group st fuel groupChanged).2.1.height = b.height := by
  induction fuel generalizing b st groupChanged with
  | zero => simp [applyRuleGroupFuel]
  | succ fuel ih =>
    rw [applyRuleGroupFuel]
    have hPass := applyRuleGroupPass_WH game b st group (countNonInertRules group) 0 false
    rcases hP : applyRuleGroupPass game b st group (countNonInertRules group) 0 false with
      ⟨made, b', st'⟩
    simp only [hP]
    have hBw : b'.width = b.width ∧ b'.height = b.height := by simpa [hP] using hPass
    by_cases hm : made = true
    · rw [if_pos hm]
      have ih' := ih b' st' true
      exact ⟨ih'.1.trans hBw.1, ih'.2.trans hBw.2⟩
    · rw [if_neg hm]
      exact hBw

theorem applyRandomRuleGroup_WH
    (game : Game) (b : Board) (group : Array Rule) (st : TurnState) :
    (applyRandomRuleGroup game b group st).2.1.width = b.width ∧
    (applyRandomRuleGroup game b group st).2.1.height = b.height := by
  unfold applyRandomRuleGroup
  by_cases hEmpty : (collectRandomRuleMatches b group).isEmpty = true
  · rw [if_pos hEmpty]; exact ⟨rfl, rfl⟩
  · rw [if_neg hEmpty]
    generalize hp : st.rng.randomNat 0 (collectRandomRuleMatches b group).size = pickPair
    rcases pickPair with ⟨pickIdx, rng'⟩
    generalize hm : (collectRandomRuleMatches b group).getD pickIdx (0, #[]) = pair
    rcases pair with ⟨ruleIdx, tuple⟩
    simp only [hp, hm]
    cases hR : group[ruleIdx]? with
    | none =>
      simp only [hR]
      exact ⟨trivial, trivial⟩
    | some rule =>
      simp only [hR]
      exact applyRuleTuple_WH game b rule tuple false rng'

theorem applyRuleGroup_WH
    (game : Game) (b : Board) (group : Array Rule) (st : TurnState)
    {r : Bool × Board × TurnState}
    (hr : applyRuleGroup game b group st = .ok r) :
    r.2.1.width = b.width ∧ r.2.1.height = b.height := by
  unfold applyRuleGroup at hr
  split at hr
  · next hsz =>
    by_cases hRand : group[0].isRandom = true
    · simp only [hRand, ↓reduceIte] at hr
      cases hr
      exact applyRandomRuleGroup_WH game b group st
    · simp only [eq_false_of_ne_true hRand] at hr
      cases hr
      exact applyRuleGroupFuel_WH game b group.toList st 200 false
  · cases hr
    exact applyRuleGroupFuel_WH game b group.toList st 200 false


theorem applyRulesWithLoops.go_WH
    (game : Game) (groups : Array (Array Rule)) (loopPoint : Array (Option Nat))
    (bannedGroup : Array Bool) (rulesCount : Nat) (fuel : Nat) (s : ApplyRulesState)
    (r : Bool × Board × TurnState)
    (hr : applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel s = .ok r) :
    r.2.1.width = s.board.width ∧ r.2.1.height = s.board.height := by
  revert r hr
  induction fuel generalizing s with
  | zero =>
    intro r hr
    simp [applyRulesWithLoops.go] at hr
    cases hr; exact ⟨rfl, rfl⟩
  | succ fuel ih =>
    intro r hr
    rw [applyRulesWithLoops.go] at hr
    by_cases hIdx : s.ruleGroupIndex < rulesCount
    · simp only [hIdx, ↓reduceIte] at hr
      have continue_wh :
          ∀ (board1 : Board) (turn1 : TurnState) (rc lp : Bool) (idx lc : Nat),
            board1.width = s.board.width → board1.height = s.board.height →
            ∀ (r : Bool × Board × TurnState),
              applyRulesWithLoops.continueAfter game groups loopPoint bannedGroup rulesCount fuel
                  board1 turn1 rc lp idx lc = .ok r →
                r.2.1.width = s.board.width ∧ r.2.1.height = s.board.height := by
        intro board1 turn1 rc lp idx lc hw1 hh1 r hr'
        unfold applyRulesWithLoops.continueAfter at hr'
        have finish_go : ∀ (s' : ApplyRulesState),
            s'.board.width = s.board.width → s'.board.height = s.board.height →
            ∀ (r : Bool × Board × TurnState),
              applyRulesWithLoops.go game groups loopPoint bannedGroup rulesCount fuel s' = .ok r →
                r.2.1.width = s.board.width ∧ r.2.1.height = s.board.height := by
          intro s' hw' hh' r hr''
          have ⟨a, b⟩ := ih s' r hr''
          exact ⟨a.trans hw', b.trans hh'⟩
        split at hr'
        · cases hLP : loopPoint[idx]? with
          | none =>
            simp only [hLP] at hr'
            split at hr'
            · cases hLP2 : loopPoint[rulesCount]? with
              | none =>
                simp only [hLP2] at hr'
                exact finish_go _ hw1 hh1 _ hr'
              | some v =>
                cases v with
                | none =>
                  simp only [hLP2] at hr'
                  exact finish_go _ hw1 hh1 _ hr'
                | some target =>
                  simp only [hLP2] at hr'
                  split at hr'
                  · cases hr'; exact ⟨hw1, hh1⟩
                  · exact finish_go _ hw1 hh1 _ hr'
            · exact finish_go _ hw1 hh1 _ hr'
          | some v =>
            cases v with
            | none =>
              simp only [hLP] at hr'
              split at hr'
              · cases hLP2 : loopPoint[rulesCount]? with
                | none =>
                  simp only [hLP2] at hr'
                  exact finish_go _ hw1 hh1 _ hr'
                | some w =>
                  cases w with
                  | none =>
                    simp only [hLP2] at hr'
                    exact finish_go _ hw1 hh1 _ hr'
                  | some target =>
                    simp only [hLP2] at hr'
                    split at hr'
                    · cases hr'; exact ⟨hw1, hh1⟩
                    · exact finish_go _ hw1 hh1 _ hr'
              · exact finish_go _ hw1 hh1 _ hr'
            | some target =>
              simp only [hLP] at hr'
              split at hr'
              · cases hr'; exact ⟨hw1, hh1⟩
              · exact finish_go _ hw1 hh1 _ hr'
        · exact finish_go _ hw1 hh1 _ hr'
      by_cases hBan : bannedGroup.getD s.ruleGroupIndex false = true
      · simp only [hBan, ↓reduceIte] at hr
        exact continue_wh s.board s.turn s.rulesChanged s.loopPropagated
          s.ruleGroupIndex s.loopCount rfl rfl r hr
      · simp only [eq_false_of_ne_true hBan] at hr
        cases hAg : applyRuleGroup game s.board groups[s.ruleGroupIndex]! s.turn with
        | error e => simp [hAg] at hr
        | ok trip =>
          have hB1 := applyRuleGroup_WH game s.board groups[s.ruleGroupIndex]! s.turn hAg
          simp only [hAg] at hr
          rcases trip with ⟨gc, b', st'⟩
          simp only at hB1
          exact continue_wh b' st' (s.rulesChanged || gc) (s.loopPropagated || gc)
            s.ruleGroupIndex s.loopCount hB1.1 hB1.2 r hr
    · simp only [hIdx, ↓reduceIte] at hr
      cases hr; exact ⟨rfl, rfl⟩

theorem applyRulesWithLoops_WH
    (game : Game) (b : Board) (groups : Array (Array Rule))
    (loopPoint : Array (Option Nat)) (st : TurnState) (bannedGroup : Array Bool)
    {r : Bool × Board × TurnState}
    (hr : applyRulesWithLoops game b groups loopPoint st bannedGroup = .ok r) :
    r.2.1.width = b.width ∧ r.2.1.height = b.height := by
  unfold applyRulesWithLoops at hr
  exact applyRulesWithLoops.go_WH game groups loopPoint bannedGroup groups.size _ _ _ hr

theorem rigidRetry.go_WH
    (game : Game) (rules lateRules : Array (Array Rule))
    (loopPoint lateLoopPoint : Array (Option Nat)) (startBoard : Board)
    (fuel : Nat) (s : RigidRetryState)
    (hWH : s.board.width = startBoard.width ∧ s.board.height = startBoard.height)
    (r : RigidRetryState)
    (hr : rigidRetry.go game rules lateRules loopPoint lateLoopPoint startBoard fuel s = .ok r) :
    r.board.width = startBoard.width ∧ r.board.height = startBoard.height := by
  revert r hr
  induction fuel generalizing s with
  | zero =>
    intro r hr
    simp [rigidRetry.go] at hr
    cases hr; exact hWH
  | succ fuel ih =>
    intro r hr
    rw [rigidRetry.go] at hr
    cases hEarly : applyRulesWithLoops game s.board rules loopPoint s.turn s.bannedGroup with
    | error e => simp [hEarly] at hr
    | ok trip =>
      simp only [hEarly] at hr
      have hEarlyWH := applyRulesWithLoops_WH game s.board rules loopPoint s.turn s.bannedGroup hEarly
      rcases trip with ⟨_, board', turn'⟩
      simp only at hEarlyWH hr
      have hRes := Board.resolveMovements_WH game board' s.bannedGroup
      generalize hRM : resolveMovements game board' s.bannedGroup = rm
      rcases rm with ⟨board'', doUndo, banned'⟩
      have hB'' : board''.width = board'.width ∧ board''.height = board'.height := by
        simpa [hRM] using hRes
      simp only [hRM] at hr
      by_cases hUndo : doUndo = true
      · simp only [hUndo, ↓reduceIte] at hr
        exact ih _ ⟨rfl, rfl⟩ _ hr
      · simp only [eq_false_of_ne_true hUndo] at hr
        by_cases hLateEmpty : lateRules.isEmpty = true
        · have : (!lateRules.isEmpty) = false := by simp [hLateEmpty]
          simp only [this, ↓reduceIte] at hr
          cases hr
          exact ⟨hB''.1.trans hEarlyWH.1 |>.trans hWH.1,
            hB''.2.trans hEarlyWH.2 |>.trans hWH.2⟩
        · have : (!lateRules.isEmpty) = true := by simp [eq_false_of_ne_true hLateEmpty]
          simp only [this, ↓reduceIte] at hr
          cases hLateR : applyRulesWithLoops game board'' lateRules lateLoopPoint turn' #[] with
          | error e => simp [hLateR] at hr
          | ok tripL =>
            simp only [hLateR] at hr
            cases hr
            have hL := applyRulesWithLoops_WH game board'' lateRules lateLoopPoint turn' #[] hLateR
            exact ⟨hL.1.trans hB''.1 |>.trans hEarlyWH.1 |>.trans hWH.1,
              hL.2.trans hB''.2 |>.trans hEarlyWH.2 |>.trans hWH.2⟩

theorem rigidRetry_WH
    (game : Game) (rules lateRules : Array (Array Rule))
    (loopPoint lateLoopPoint : Array (Option Nat)) (startBoard : Board) (turn : TurnState)
    {r : Board × TurnState}
    (hr : rigidRetry game rules lateRules loopPoint lateLoopPoint startBoard turn = .ok r) :
    r.1.width = startBoard.width ∧ r.1.height = startBoard.height := by
  simp only [rigidRetry] at hr
  cases hGo : rigidRetry.go game rules lateRules loopPoint lateLoopPoint startBoard 50
      { board := startBoard, turn := turn, bannedGroup := #[] } with
  | error e => simp [hGo] at hr
  | ok s =>
    simp only [hGo] at hr
    cases hr
    exact rigidRetry.go_WH game rules lateRules loopPoint lateLoopPoint startBoard 50 _
      ⟨rfl, rfl⟩ _ hGo

/-- Movement-path board after clearMovements + optional startMovement + rigidRetry. -/
theorem Session.boardAfterRigid_matchesPlayable
    (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
    (board1 : Board) (turn0 : TurnState)
    (hS : Session.WellFormed game session)
    (hG : Game.WellFormed game)
    (hLR : ruleGroupsLayerRespecting game rules = true)
    (hAlias : ruleGroupsPropertyAliasesOk game rules = true)
    (hLRl : ruleGroupsLayerRespecting game lateRules = true)
    (hAliasL : ruleGroupsPropertyAliasesOk game lateRules = true)
    (hStartWH : board1.width = session.board.width ∧ board1.height = session.board.height)
    (hStartWF : Board.WellFormed game board1)
    {r : Board × TurnState}
    (hr : rigidRetry game rules lateRules game.loopPoint game.lateLoopPoint board1 turn0 = .ok r)
    (e : LevelEntry)
    (hAct : Game.activePlayableLevel? game session.currentLevel = some e) :
    Board.matchesPlayable game r.1 e = true ∧ Board.WellFormed game r.1 := by
  have hB0 := Session.WellFormed.board game session hS
  have hMatch0 : Board.matchesPlayable game session.board e = true := by
    simp only [Session.WellFormed, Session.wellFormed, hAct, Bool.and_eq_true_iff] at hS
    exact hS.1.1.1
  have hWF := rigidRetry_wellFormed game rules lateRules game.loopPoint game.lateLoopPoint
    board1 turn0 hG hStartWF hLR hAlias hLRl hAliasL _ hr
  have hWH := rigidRetry_WH game rules lateRules game.loopPoint game.lateLoopPoint board1 turn0 hr
  have hMatch1 := Board.matchesPlayable_of_WH_preserved game session.board board1 e
    hMatch0 hB0 hStartWF hStartWH.1 hStartWH.2
  have hMatch2 := Board.matchesPlayable_of_WH_preserved game board1 r.1 e
    hMatch1 hStartWF hWF hWH.1 hWH.2
  exact ⟨hMatch2, hWF⟩


theorem boardFromPlayable_matches
    (game : Game) (w h lc : Nat) (objs : Array UInt32) :
    Board.matchesPlayable game (boardFromPlayable game w h lc objs)
      (.playable w h lc objs) = true := by
  simp [Board.matchesPlayable, boardFromPlayable]

theorem boardFromPlayable_wellFormed_of_playableOk
    (game : Game) (w height lc : Nat) (objs : Array UInt32)
    (hOk : Game.playableLevelBoardOk game (.playable w height lc objs) = true) :
    Board.WellFormed game (boardFromPlayable game w height lc objs) := by
  simpa [Game.playableLevelBoardOk, Board.WellFormed] using hOk

theorem Game.levelsBoardsOk_of_mem
    (game : Game) (h : Game.LevelsBoardsOk game) (i : Nat) (e : LevelEntry)
    (hi : i < game.levels.size) (hEq : game.levels[i] = e) :
    Game.playableLevelBoardOk game e = true := by
  simp only [Game.LevelsBoardsOk, Game.levelsBoardsOk] at h
  simpa [hEq] using (Array.all_eq_true.mp h) i hi

/-- Win-advance when not winning is identity. -/
theorem sessionAfterWinAdvance_wellFormed_of_not_winning
    (game : Game) (session : Session)
    (hS : Session.WellFormed game session)
    (h : session.winning = false) :
    Session.WellFormed game (sessionAfterWinAdvance game session) := by
  simpa [sessionAfterWinAdvance_of_not_winning game session h] using hS

/-- After rigidRetry on a same-geometry board, Session with updated board/winning/rng is WF. -/
theorem Session.afterRigidRetry_wellFormed
    (game : Game) (session : Session) (board2 : Board) (winning : Bool) (rng : RngState)
    (hS : Session.WellFormed game session)
    (hB : Board.WellFormed game board2)
    (hMatch : ∀ e, Game.activePlayableLevel? game session.currentLevel = some e →
      Board.matchesPlayable game board2 e = true) :
    Session.WellFormed game { session with board := board2, winning := winning, rng := rng } :=
  Session.withBoardWinningRng_wellFormed game session board2 winning rng hS hB hMatch


theorem sessionAfterWinAdvance.go_wellFormed
    (game : Game) (session : Session) (idx : Nat)
    (hS : Session.WellFormed game session)
    (hLevels : Game.LevelsBoardsOk game) :
    Session.WellFormed game (sessionAfterWinAdvance.go game session idx) := by
  have ⟨fuel, hfuel⟩ : ∃ fuel, game.levels.size - idx ≤ fuel := ⟨_, Nat.le_refl _⟩
  revert idx hfuel
  induction fuel with
  | zero =>
    intro idx hfuel
    unfold sessionAfterWinAdvance.go
    by_cases hlt : idx < game.levels.size
    · have : 0 < game.levels.size - idx := Nat.sub_pos_of_lt hlt
      exact absurd hfuel (Nat.not_le_of_gt this)
    · simp only [hlt, ↓reduceDIte]
      exact hS
  | succ fuel ih =>
    intro idx hfuel
    unfold sessionAfterWinAdvance.go
    by_cases hlt : idx < game.levels.size
    · simp only [hlt, ↓reduceDIte]
      cases hGet : game.levels[idx]? with
      | none => simp only [hGet]; exact hS
      | some e =>
        cases e with
        | message _ =>
          simp only [hGet]
          exact ih (idx + 1) (by
            have : game.levels.size - (idx + 1) < game.levels.size - idx :=
              Nat.sub_succ_lt_self _ _ hlt
            omega) 
        | playable w height lc objs =>
          simp only [hGet]
          have hElem : game.levels[idx] = LevelEntry.playable w height lc objs :=
            (Array.getElem?_eq_some_iff.mp hGet).2
          have hOk := Game.levelsBoardsOk_of_mem game hLevels idx (.playable w height lc objs)
            hlt hElem
          have hB := boardFromPlayable_wellFormed_of_playableOk game w height lc objs hOk
          have hMatch := boardFromPlayable_matches game w height lc objs
          let nb := boardFromPlayable game w height lc objs
          have hAct : Game.activePlayableLevel? game ⟨idx⟩ = some (.playable w height lc objs) := by
            simp only [Game.activePlayableLevel?]
            have hf : Game.findPlayableFrom game idx =
                some (idx, .playable w height lc objs) := by
              unfold Game.findPlayableFrom
              simp only [hlt, ↓reduceDIte]
              simpa [hGet, LevelEntry.isPlayable] using rfl
            simp [hf]
          have hOut : Session.WellFormed game
              { session with
                board := nb
                restartBoard := some nb
                currentLevel := ⟨idx⟩
                winning := false } := by
            simp only [Session.WellFormed, Session.wellFormed, hAct]
            have hFrames := Session.WellFormed.undoFrames game session hS
            exact Bool.and_eq_true_iff.mpr
              ⟨Bool.and_eq_true_iff.mpr
                ⟨Bool.and_eq_true_iff.mpr ⟨hMatch, hB⟩,
                  Bool.and_eq_true_iff.mpr ⟨hMatch, hB⟩⟩, hFrames⟩
          simpa [nb] using hOut
    · simp only [hlt, ↓reduceDIte]
      exact hS

theorem sessionAfterWinAdvance_wellFormed
    (game : Game) (session : Session)
    (hS : Session.WellFormed game session)
    (hLevels : Game.LevelsBoardsOk game) :
    Session.WellFormed game (sessionAfterWinAdvance game session) := by
  unfold sessionAfterWinAdvance
  by_cases hw : (!session.winning) = true
  · simp only [hw, ↓reduceIte]
    exact hS
  · simp only [eq_false_of_ne_true hw, ↓reduceIte]
    exact sessionAfterWinAdvance.go_wellFormed game session (session.currentLevel.val + 1) hS hLevels

/-- Movement path after `clearMovements` / optional `startMovement`: rigidRetry → cmds → win-advance. -/

theorem executeTurn.movementGo_session_wellFormed
    (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
    (startBoard : Board) (playerPositions : Array Nat) (turn0 : TurnState)
    (skip : Bool) (fuel : Nat)
    (hG : Game.WellFormed game)
    (hLR : ruleGroupsLayerRespecting game rules = true)
    (hA : ruleGroupsPropertyAliasesOk game rules = true)
    (hLRl : ruleGroupsLayerRespecting game lateRules = true)
    (hAl : ruleGroupsPropertyAliasesOk game lateRules = true)
    (hLev : Game.LevelsBoardsOk game)
    (hS : Session.WellFormed game session)
    (hStartWF : Board.WellFormed game startBoard)
    (hStartMatch : ∀ e, Game.activePlayableLevel? game session.currentLevel = some e →
      Board.matchesPlayable game startBoard e = true)
    (hStartWH : startBoard.width = session.board.width ∧ startBoard.height = session.board.height)
    (ihCmd : ∀ (turnBackup session : Session) (turn : TurnState) (skip : Bool)
        (r : Session × Bool),
      Session.WellFormed game turnBackup →
      Session.WellFormed game session →
      processCommandQueue.go game rules lateRules turnBackup session turn skip fuel = .ok r →
      Session.WellFormed game r.1)
    (r : Session × Bool)
    (hr : executeTurn.movementGo game rules lateRules session startBoard playerPositions turn0 skip
        fuel = .ok r) :
    Session.WellFormed game r.1 := by
  simp only [executeTurn.movementGo] at hr
  cases hRR : rigidRetry game rules lateRules game.loopPoint game.lateLoopPoint startBoard turn0 with
  | error e => simp [hRR] at hr
  | ok trip =>
    simp only [hRR] at hr
    have hWF2 := rigidRetry_wellFormed game rules lateRules game.loopPoint game.lateLoopPoint
      startBoard turn0 hG hStartWF hLR hA hLRl hAl _ hRR
    have hWH2 := rigidRetry_WH game rules lateRules game.loopPoint game.lateLoopPoint
      startBoard turn0 hRR
    rcases trip with ⟨board2, turn2⟩
    simp only at hWF2 hWH2 hr
    by_cases hReq :
        (game.requirePlayerMovement && decide (playerPositions.size > 0) &&
          !playerMovementDetected game board2 playerPositions) = true
    · rw [if_pos hReq] at hr
      cases hr; exact hS
    · rw [if_neg hReq] at hr
      have hMatch2 : ∀ e, Game.activePlayableLevel? game session.currentLevel = some e →
          Board.matchesPlayable game board2 e = true := by
        intro e hAct
        exact Board.matchesPlayable_of_WH_preserved game startBoard board2 e
          (hStartMatch e hAct) hStartWF hWF2 hWH2.1 hWH2.2
      have hS0 := Session.afterRigidRetry_wellFormed game session board2
        (evaluateWinConditions game board2 || turn2.commandQueue.contains .win) turn2.rng
        hS hWF2 hMatch2
      cases hCmd : processCommandQueue.go game rules lateRules session
          { session with
            board := board2
            winning := evaluateWinConditions game board2 || turn2.commandQueue.contains .win
            rng := turn2.rng }
          turn2 skip fuel with
      | error e =>
        rw [hCmd] at hr; cases hr
      | ok pair =>
        rw [hCmd] at hr; cases hr
        have hS1 := ihCmd session
          { session with
            board := board2
            winning := evaluateWinConditions game board2 || turn2.commandQueue.contains .win
            rng := turn2.rng }
          turn2 skip pair hS hS0 hCmd
        exact sessionAfterWinAdvance_wellFormed game pair.1 hS1 hLev

/-- Undo frame from a well-formed session. -/
theorem Session.undoFrameWellFormed_of_session
    (game : Game) (s : Session) (hS : Session.WellFormed game s) :
    Session.undoFrameWellFormed game (s.board, s.currentLevel, s.winning) = true := by
  simp only [Session.WellFormed, Session.wellFormed] at hS
  cases hAct : Game.activePlayableLevel? game s.currentLevel with
  | none => simp [hAct] at hS
  | some e =>
    simp only [hAct, Bool.and_eq_true_iff] at hS
    simp only [Session.undoFrameWellFormed, hAct]
    exact Bool.and_eq_true_iff.mpr ⟨hS.1.1.1, hS.1.1.2⟩

/-- Push an arbitrary well-formed undo frame. -/
theorem Session.pushUndoFrame_wellFormed
    (game : Game) (s : Session) (frame : Board × LevelIdx × Bool)
    (hS : Session.WellFormed game s)
    (hF : Session.undoFrameWellFormed game frame = true) :
    Session.WellFormed game { s with undoBackups := s.undoBackups.push frame } := by
  simp only [Session.WellFormed, Session.wellFormed] at hS ⊢
  cases hAct : Game.activePlayableLevel? game s.currentLevel with
  | none => simp [hAct] at hS
  | some e =>
    simp only [hAct, Bool.and_eq_true_iff] at hS ⊢
    have hAll : (s.undoBackups.push frame).all (Session.undoFrameWellFormed game) = true := by
      refine Array.all_eq_true.mpr ?_
      intro i hi
      have hsz : (s.undoBackups.push frame).size = s.undoBackups.size + 1 := by simp
      by_cases hLast : i = s.undoBackups.size
      · have heq : (s.undoBackups.push frame)[i]'(by simpa [hsz] using hi) = frame := by
          simp [Array.getElem_push, hLast]
        simpa [heq] using hF
      · have hi0 : i < s.undoBackups.size := by omega
        have heq : (s.undoBackups.push frame)[i]'(by simpa [hsz] using hi) = s.undoBackups[i] := by
          simp [Array.getElem_push, hi0]
        simpa [heq] using (Array.all_eq_true.mp hS.2) i hi0
    exact ⟨⟨⟨hS.1.1.1, hS.1.1.2⟩, hS.1.2⟩, hAll⟩

/-- Command-queue restart: push turnBackup, restore restart board. -/
theorem Session.cmdRestartRestore_wellFormed
    (game : Game) (session turnBackup : Session) (rb : Board) (e : LevelEntry)
    (hS : Session.WellFormed game session)
    (hTB : Session.WellFormed game turnBackup)
    (hAct : Game.activePlayableLevel? game session.currentLevel = some e)
    (hMatch : Board.matchesPlayable game rb e = true)
    (hB : Board.WellFormed game rb) :
    Session.WellFormed game
      { session with
        board := rb.clearMovements
        undoBackups :=
          session.undoBackups.push
            (turnBackup.board, turnBackup.currentLevel, turnBackup.winning) } := by
  have hPush := Session.pushUndoFrame_wellFormed game session
    (turnBackup.board, turnBackup.currentLevel, turnBackup.winning) hS
    (Session.undoFrameWellFormed_of_session game turnBackup hTB)
  refine Session.withBoard_wellFormed game
    { session with
      undoBackups :=
        session.undoBackups.push
          (turnBackup.board, turnBackup.currentLevel, turnBackup.winning) }
    rb.clearMovements hPush
    (Board.clearMovements_wellFormed game rb hB) ?_
  intro e' hAct'
  have : e' = e := by
    rw [hAct] at hAct'
    exact (Option.some.inj hAct').symm
  subst this
  simpa [Board.matchesPlayable_clearMovements] using hMatch

/-- Again-probe finish after checkpoint. -/
theorem processCommandQueue.finish_session_wellFormed
    (game : Game) (rules lateRules : Array (Array Rule))
    (turnBackup s1 : Session) (cmds : Array Command) (skip : Bool) (fuel : Nat)
    (r : Session × Bool)
    (hS1 : Session.WellFormed game s1)
    (hr : processCommandQueue.finish game rules lateRules turnBackup s1 cmds skip fuel =
      Except.ok r) :
    Session.WellFormed game r.1 := by
  simp only [processCommandQueue.finish] at hr
  have hS3 := processCommandQueue.afterWinCheckpoint_wellFormed game s1 cmds hS1
  cases hAg : againEligible cmds turnBackup.board
      (processCommandQueue.afterWinCheckpoint game s1 cmds).board with
  | false =>
    simp only [hAg] at hr; cases hr; exact hS3
  | true =>
    simp only [hAg] at hr
    cases hSkip : skip with
    | true => simp only [hSkip] at hr; cases hr; exact hS3
    | false =>
      simp only [hSkip] at hr
      cases hPr : executeTurn.go game rules lateRules
          (processCommandQueue.afterWinCheckpoint game s1 cmds) .tick true fuel with
      | error e => simp [hPr] at hr; cases hr; exact hS3
      | ok probed =>
        simp only [hPr] at hr; cases hr
        exact Session.withRng_wellFormed game
          (processCommandQueue.afterWinCheckpoint game s1 cmds) probed.1.rng hS3

theorem turnFamily_session_wellFormed (fuel : Nat) :
    (∀ (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
        (input : InputToken) (skip : Bool) (r : Session × Bool),
      Game.WellFormed game →
      ruleGroupsLayerRespecting game rules = true →
      ruleGroupsPropertyAliasesOk game rules = true →
      ruleGroupsLayerRespecting game lateRules = true →
      ruleGroupsPropertyAliasesOk game lateRules = true →
      Game.LevelsBoardsOk game →
      Session.WellFormed game session →
      executeTurn.go game rules lateRules session input skip fuel = .ok r →
      Session.WellFormed game r.1) ∧
    (∀ (game : Game) (rules lateRules : Array (Array Rule))
        (turnBackup session : Session) (turn : TurnState) (skip : Bool)
        (r : Session × Bool),
      Game.WellFormed game →
      ruleGroupsLayerRespecting game rules = true →
      ruleGroupsPropertyAliasesOk game rules = true →
      ruleGroupsLayerRespecting game lateRules = true →
      ruleGroupsPropertyAliasesOk game lateRules = true →
      Game.LevelsBoardsOk game →
      Session.WellFormed game turnBackup →
      Session.WellFormed game session →
      processCommandQueue.go game rules lateRules turnBackup session turn skip fuel = .ok r →
      Session.WellFormed game r.1) ∧
    (∀ (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
        (s' : Session),
      Game.WellFormed game →
      ruleGroupsLayerRespecting game rules = true →
      ruleGroupsPropertyAliasesOk game rules = true →
      ruleGroupsLayerRespecting game lateRules = true →
      ruleGroupsPropertyAliasesOk game lateRules = true →
      Game.LevelsBoardsOk game →
      Session.WellFormed game session →
      runRulesOnLevelStartIfNeeded.go game rules lateRules session fuel = .ok s' →
      Session.WellFormed game s') := by
  induction fuel with
  | zero =>
    refine ⟨?_, ?_, ?_⟩
    · intro game rules lateRules session input skip r _ _ _ _ _ _ _ hr
      simp [executeTurn.go] at hr
    · intro game rules lateRules turnBackup session turn skip r _ _ _ _ _ _ _ _ hr
      simp [processCommandQueue.go] at hr
    · intro game rules lateRules session s' _ _ _ _ _ _ _ hr
      simp [runRulesOnLevelStartIfNeeded.go] at hr
  | succ fuel ih =>
    rcases ih with ⟨ihTurn, ihCmd, ihStart⟩
    refine ⟨?exec, ?cmd, ?start⟩
    · intro game rules lateRules session input skip r hG hLR hA hLRl hAl hLev hS hr
      cases input with
      | undo =>
        exact executeTurn.go_undo_session_wellFormed game rules lateRules session skip fuel hS r
          (by simpa [executeTurn.go] using hr)
      | restart =>
        simp only [executeTurn.go] at hr
        cases hRB : session.restartBoard with
        | none =>
          simp only [hRB] at hr
          cases hSt : runRulesOnLevelStartIfNeeded.go game rules lateRules session fuel with
          | error e =>
            rw [hSt] at hr; cases hr
          | ok s =>
            rw [hSt] at hr; cases hr
            exact ihStart game rules lateRules session s hG hLR hA hLRl hAl hLev hS hSt
        | some rb =>
          simp only [hRB] at hr
          cases hAct : Game.activePlayableLevel? game session.currentLevel with
          | none =>
            simp only [Session.WellFormed, Session.wellFormed, hAct] at hS
            nomatch hS
          | some e =>
            have hROk := Session.WellFormed.restartOk game session e hS hAct
            simp only [hRB] at hROk
            have hMatch := (Bool.and_eq_true_iff.mp hROk).1
            have hB : Board.WellFormed game rb := (Bool.and_eq_true_iff.mp hROk).2
            have hS0 := Session.restoreRestartBoard_wellFormed game session rb e hS hRB hAct
              hMatch hB
            cases hSt : runRulesOnLevelStartIfNeeded.go game rules lateRules
                { board := rb.clearMovements
                  winning := session.winning
                  currentLevel := session.currentLevel
                  undoBackups :=
                    session.undoBackups.push
                      (session.board, session.currentLevel, session.winning)
                  restartBoard := some rb
                  rng := session.rng } fuel with
            | error e =>
              rw [hSt] at hr; cases hr
            | ok s =>
              rw [hSt] at hr; cases hr
              have hS0' : Session.WellFormed game
                  { board := rb.clearMovements
                    winning := session.winning
                    currentLevel := session.currentLevel
                    undoBackups :=
                      session.undoBackups.push
                        (session.board, session.currentLevel, session.winning)
                    restartBoard := some rb
                    rng := session.rng } := by
                simpa [hRB] using hS0
              exact ihStart game rules lateRules _ s hG hLR hA hLRl hAl hLev hS0' hSt
      | tick =>
        have hEq := executeTurn.go_eq_movementGo game rules lateRules session .tick skip fuel
          (Or.inl rfl)
        rw [hEq] at hr
        simp only [InputToken.dirMask?] at hr
        have hB0 := Board.clearMovements_wellFormed game session.board
          (Session.WellFormed.board game session hS)
        have hMatch0 : ∀ e, Game.activePlayableLevel? game session.currentLevel = some e →
            Board.matchesPlayable game session.board.clearMovements e = true := by
          intro e hAct
          have hm : Board.matchesPlayable game session.board e = true := by
            simp only [Session.WellFormed, Session.wellFormed, hAct, Bool.and_eq_true_iff] at hS
            exact hS.1.1.1
          simpa [Board.matchesPlayable_clearMovements] using hm
        exact executeTurn.movementGo_session_wellFormed game rules lateRules session
          session.board.clearMovements #[] (TurnState.initial session.rng) skip fuel
          hG hLR hA hLRl hAl hLev hS hB0 hMatch0 (Board.clearMovements_WH session.board)
          (fun tb s t sk r' hTB hSs hr' =>
            ihCmd game rules lateRules tb s t sk r' hG hLR hA hLRl hAl hLev hTB hSs hr')
          r hr
      | action =>
        have hEq := executeTurn.go_eq_movementGo game rules lateRules session .action skip fuel
          (Or.inr (Or.inl rfl))
        rw [hEq] at hr
        simp only [InputToken.dirMask?] at hr
        have hB0 := Board.clearMovements_wellFormed game session.board
          (Session.WellFormed.board game session hS)
        have hB1 := Board.startMovement_wellFormed game session.board.clearMovements 16 hB0
        have hWH := Board.startMovement_WH game session.board.clearMovements 16
        have hC := Board.clearMovements_WH session.board
        exact executeTurn.movementGo_session_wellFormed game rules lateRules session
          (startMovement game session.board.clearMovements 16).1
          (startMovement game session.board.clearMovements 16).2
          (TurnState.initial session.rng) skip fuel
          hG hLR hA hLRl hAl hLev hS hB1
          (fun e hAct => Board.matchesPlayable_of_WH_preserved game session.board
            (startMovement game session.board.clearMovements 16).1 e
            (by
              simp only [Session.WellFormed, Session.wellFormed, hAct, Bool.and_eq_true_iff] at hS
              exact hS.1.1.1)
            (Session.WellFormed.board game session hS) hB1
            (hWH.1.trans hC.1) (hWH.2.trans hC.2))
          ⟨hWH.1.trans hC.1, hWH.2.trans hC.2⟩
          (fun tb s t sk r' hTB hSs hr' =>
            ihCmd game rules lateRules tb s t sk r' hG hLR hA hLRl hAl hLev hTB hSs hr')
          r hr
      | move dir =>
        have hEq := executeTurn.go_eq_movementGo game rules lateRules session (.move dir) skip fuel
          (Or.inr (Or.inr ⟨dir, rfl⟩))
        rw [hEq] at hr
        simp only [InputToken.dirMask?] at hr
        have hB0 := Board.clearMovements_wellFormed game session.board
          (Session.WellFormed.board game session hS)
        have hB1 := Board.startMovement_wellFormed game session.board.clearMovements dir.toBits hB0
        have hWH := Board.startMovement_WH game session.board.clearMovements dir.toBits
        have hC := Board.clearMovements_WH session.board
        exact executeTurn.movementGo_session_wellFormed game rules lateRules session
          (startMovement game session.board.clearMovements dir.toBits).1
          (startMovement game session.board.clearMovements dir.toBits).2
          (TurnState.initial session.rng) skip fuel
          hG hLR hA hLRl hAl hLev hS hB1
          (fun e hAct => Board.matchesPlayable_of_WH_preserved game session.board
            (startMovement game session.board.clearMovements dir.toBits).1 e
            (by
              simp only [Session.WellFormed, Session.wellFormed, hAct, Bool.and_eq_true_iff] at hS
              exact hS.1.1.1)
            (Session.WellFormed.board game session hS) hB1
            (hWH.1.trans hC.1) (hWH.2.trans hC.2))
          ⟨hWH.1.trans hC.1, hWH.2.trans hC.2⟩
          (fun tb s t sk r' hTB hSs hr' =>
            ihCmd game rules lateRules tb s t sk r' hG hLR hA hLRl hAl hLev hTB hSs hr')
          r hr
    · intro game rules lateRules turnBackup session turn skip r
          hG hLR hA hLRl hAl hLev hTB hS hr
      cases hC : turn.commandQueue.contains .cancel with
      | true =>
        simp only [processCommandQueue.go, hC] at hr
        cases hr; exact hTB
      | false =>
        cases hRst : turn.commandQueue.contains .restart with
        | true =>
          simp only [processCommandQueue.go] at hr
          rw [hC, hRst] at hr
          simp at hr
          have hPush0 := Session.pushUndoFrame_wellFormed game session
            (turnBackup.board, turnBackup.currentLevel, turnBackup.winning) hS
            (Session.undoFrameWellFormed_of_session game turnBackup hTB)
          cases hRB : session.restartBoard with
          | none =>
            simp only [hRB] at hr
            have hS0 : Session.WellFormed game
                { board := session.board
                  winning := session.winning
                  currentLevel := session.currentLevel
                  undoBackups :=
                    session.undoBackups.push
                      (turnBackup.board, turnBackup.currentLevel, turnBackup.winning)
                  restartBoard := none
                  rng := session.rng } := by
              simpa [hRB] using hPush0
            cases hSt : runRulesOnLevelStartIfNeeded.go game rules lateRules
                { board := session.board
                  winning := session.winning
                  currentLevel := session.currentLevel
                  undoBackups :=
                    session.undoBackups.push
                      (turnBackup.board, turnBackup.currentLevel, turnBackup.winning)
                  restartBoard := none
                  rng := session.rng } fuel with
            | error e =>
              rw [hSt] at hr; cases hr
            | ok s1 =>
              rw [hSt] at hr
              have hS1 := ihStart game rules lateRules _ s1 hG hLR hA hLRl hAl hLev hS0 hSt
              change processCommandQueue.finish game rules lateRules turnBackup s1
                  turn.commandQueue skip fuel = Except.ok r at hr
              exact processCommandQueue.finish_session_wellFormed game rules lateRules
                turnBackup s1 turn.commandQueue skip fuel r hS1 hr
          | some rb =>
            simp only [hRB] at hr
            cases hAct : Game.activePlayableLevel? game session.currentLevel with
            | none =>
              simp only [Session.WellFormed, Session.wellFormed, hAct] at hS
              nomatch hS
            | some e =>
              have hROk := Session.WellFormed.restartOk game session e hS hAct
              simp only [hRB] at hROk
              have hMatch := (Bool.and_eq_true_iff.mp hROk).1
              have hB : Board.WellFormed game rb := (Bool.and_eq_true_iff.mp hROk).2
              have hS0 := Session.cmdRestartRestore_wellFormed game session turnBackup rb e
                hS hTB hAct hMatch hB
              have hS0' : Session.WellFormed game
                  { board := rb.clearMovements
                    winning := session.winning
                    currentLevel := session.currentLevel
                    undoBackups :=
                      session.undoBackups.push
                        (turnBackup.board, turnBackup.currentLevel, turnBackup.winning)
                    restartBoard := some rb
                    rng := session.rng } := by
                simpa [hRB] using hS0
              cases hSt : runRulesOnLevelStartIfNeeded.go game rules lateRules
                  { board := rb.clearMovements
                    winning := session.winning
                    currentLevel := session.currentLevel
                    undoBackups :=
                      session.undoBackups.push
                        (turnBackup.board, turnBackup.currentLevel, turnBackup.winning)
                    restartBoard := some rb
                    rng := session.rng } fuel with
              | error e =>
                rw [hSt] at hr; cases hr
              | ok s1 =>
                rw [hSt] at hr
                have hS1 := ihStart game rules lateRules _ s1 hG hLR hA hLRl hAl hLev hS0' hSt
                change processCommandQueue.finish game rules lateRules turnBackup s1
                    turn.commandQueue skip fuel = Except.ok r at hr
                exact processCommandQueue.finish_session_wellFormed game rules lateRules
                  turnBackup s1 turn.commandQueue skip fuel r hS1 hr
        | false =>
          simp only [processCommandQueue.go] at hr
          rw [hC, hRst] at hr
          simp at hr
          change processCommandQueue.finish game rules lateRules turnBackup session
              turn.commandQueue skip fuel = Except.ok r at hr
          exact processCommandQueue.finish_session_wellFormed game rules lateRules
            turnBackup session turn.commandQueue skip fuel r hS hr
    · intro game rules lateRules session s' hG hLR hA hLRl hAl hLev hS hr
      simp only [runRulesOnLevelStartIfNeeded.go] at hr
      by_cases hRun : (!game.runRulesOnLevelStart) = true
      · rw [if_pos hRun] at hr; cases hr; exact hS
      · rw [if_neg hRun] at hr
        cases hT : executeTurn.go game rules lateRules session .tick true fuel with
        | error e =>
          rw [hT] at hr; cases hr
        | ok pair =>
          rw [hT] at hr; cases hr
          have hS' := ihTurn game rules lateRules session .tick true pair
            hG hLR hA hLRl hAl hLev hS hT
          exact Session.withWinning_wellFormed game pair.1 false hS'

theorem executeTurn.go_session_wellFormed
    (game : Game) (rules lateRules : Array (Array Rule)) (session : Session)
    (input : InputToken) (skip : Bool) (fuel : Nat) (r : Session × Bool)
    (hG : Game.WellFormed game)
    (hLR : ruleGroupsLayerRespecting game rules = true)
    (hA : ruleGroupsPropertyAliasesOk game rules = true)
    (hLRl : ruleGroupsLayerRespecting game lateRules = true)
    (hAl : ruleGroupsPropertyAliasesOk game lateRules = true)
    (hLev : Game.LevelsBoardsOk game)
    (hS : Session.WellFormed game session)
    (hr : executeTurn.go game rules lateRules session input skip fuel = .ok r) :
    Session.WellFormed game r.1 :=
  (turnFamily_session_wellFormed fuel).1 game rules lateRules session input skip r
    hG hLR hA hLRl hAl hLev hS hr

theorem executeTurn_session_wellFormed
    (game : Game) (session : Session) (input : InputToken) (skip : Bool)
    (r : Session × Bool)
    (hG : Game.WellFormed game)
    (hR : Game.RulesLayerRespecting game)
    (hLev : Game.LevelsBoardsOk game)
    (hS : Session.WellFormed game session)
    (hr : executeTurn game session input skip = .ok r) :
    Session.WellFormed game r.1 := by
  simp only [executeTurn] at hr
  exact executeTurn.go_session_wellFormed game game.rules game.lateRules session input skip
    turnFuelDefault r hG
    (Game.RulesLayerRespecting.rules_layer game hR)
    (Game.RulesLayerRespecting.rules_alias game hR)
    (Game.RulesLayerRespecting.late_layer game hR)
    (Game.RulesLayerRespecting.late_alias game hR)
    hLev hS hr

theorem drainAgain.go_session_wellFormed
    (game : Game) (rules lateRules : Array (Array Rule))
    (s : Session) (again : Bool) (fuel : Nat) (s' : Session)
    (hG : Game.WellFormed game)
    (hLR : ruleGroupsLayerRespecting game rules = true)
    (hA : ruleGroupsPropertyAliasesOk game rules = true)
    (hLRl : ruleGroupsLayerRespecting game lateRules = true)
    (hAl : ruleGroupsPropertyAliasesOk game lateRules = true)
    (hLev : Game.LevelsBoardsOk game)
    (hS : Session.WellFormed game s)
    (hr : drainAgain.go game rules lateRules s again fuel = .ok s') :
    Session.WellFormed game s' := by
  induction fuel generalizing s again with
  | zero => simp [drainAgain.go] at hr
  | succ fuel ih =>
    simp only [drainAgain.go] at hr
    cases hAg : again with
    | false => simp only [hAg] at hr; cases hr; exact hS
    | true =>
      simp only [hAg] at hr
      cases hT : executeTurn.go game rules lateRules s .tick false fuel with
      | error e => simp [hT] at hr
      | ok pair =>
        simp only [hT] at hr
        have hS1 := executeTurn.go_session_wellFormed game rules lateRules s .tick false fuel
          pair hG hLR hA hLRl hAl hLev hS hT
        exact ih pair.1 pair.2 hS1 hr

theorem replaySolverGo_session_wellFormed
    (game : Game) (rules lateRules : Array (Array Rule))
    (s : Session) (inputs : List InputToken) (fuel : Nat) (s' : Session)
    (hG : Game.WellFormed game)
    (hLR : ruleGroupsLayerRespecting game rules = true)
    (hA : ruleGroupsPropertyAliasesOk game rules = true)
    (hLRl : ruleGroupsLayerRespecting game lateRules = true)
    (hAl : ruleGroupsPropertyAliasesOk game lateRules = true)
    (hLev : Game.LevelsBoardsOk game)
    (hS : Session.WellFormed game s)
    (hr : replaySolverGo game rules lateRules s inputs fuel = .ok s') :
    Session.WellFormed game s' := by
  induction inputs generalizing s fuel with
  | nil =>
    cases fuel with
    | zero => simp [replaySolverGo] at hr; cases hr; exact hS
    | succ fuel => simp [replaySolverGo] at hr; cases hr; exact hS
  | cons input rest ih =>
    cases fuel with
    | zero => simp [replaySolverGo] at hr
    | succ fuel =>
      simp only [replaySolverGo] at hr
      cases hT : executeTurn.go game rules lateRules s input false fuel with
      | error e => simp [hT] at hr
      | ok pair =>
        simp only [hT] at hr
        have hS1 := executeTurn.go_session_wellFormed game rules lateRules s input false fuel
          pair hG hLR hA hLRl hAl hLev hS hT
        cases hD : drainAgain.go game rules lateRules pair.1 pair.2 fuel with
        | error e => simp [hD] at hr
        | ok sSettled =>
          simp only [hD] at hr
          have hS2 := drainAgain.go_session_wellFormed game rules lateRules pair.1 pair.2 fuel
            sSettled hG hLR hA hLRl hAl hLev hS1 hD
          exact ih sSettled fuel hS2 hr

theorem stepOneInput_session_wellFormed
    (game : Game) (session : Session) (inputIdx : Int) (s' : Session)
    (hG : Game.WellFormed game)
    (hR : Game.RulesLayerRespecting game)
    (hLev : Game.LevelsBoardsOk game)
    (hS : Session.WellFormed game session)
    (hr : stepOneInput game session inputIdx = .ok s') :
    Session.WellFormed game s' := by
  simp only [stepOneInput] at hr
  cases hParse : parseDirInputIndex inputIdx with
  | error e =>
    rw [hParse] at hr; simp only at hr; cases hr
  | ok input =>
    rw [hParse] at hr; simp only at hr
    cases hT : executeTurn game session input with
    | error e =>
      rw [hT] at hr; simp only at hr; cases hr
    | ok pair =>
      rw [hT] at hr; simp only at hr; cases hr
      exact executeTurn_session_wellFormed game session input false pair hG hR hLev hS hT

theorem stepInputToken_session_wellFormed
    (game : Game) (session : Session) (tok : String) (s' : Session)
    (hG : Game.WellFormed game)
    (hR : Game.RulesLayerRespecting game)
    (hLev : Game.LevelsBoardsOk game)
    (hS : Session.WellFormed game session)
    (hr : stepInputToken game session tok = .ok s') :
    Session.WellFormed game s' := by
  simp only [stepInputToken] at hr
  cases hParse : parseMovementInputToken tok with
  | error e =>
    rw [hParse] at hr; simp only at hr; cases hr
  | ok input =>
    rw [hParse] at hr; simp only at hr
    cases hT : executeTurn game session input with
    | error e =>
      rw [hT] at hr; simp only at hr; cases hr
    | ok pair =>
      rw [hT] at hr; simp only at hr; cases hr
      exact executeTurn_session_wellFormed game session input false pair hG hR hLev hS hT

end PuzzleScript

namespace PuzzleScript

/-- Closed PuzzleScript rule-command vocabulary (`languageConstants.js`). -/
inductive Command where
  | sfx (n : Fin 11)
  | cancel
  | checkpoint
  | restart
  | win
  | message
  | again
  deriving DecidableEq, Repr

def Command.isInert : Command → Bool
  | .sfx _ | .message => true
  | _ => false

def Command.isSfx : Command → Bool
  | .sfx _ => true
  | _ => false

theorem Command.isInert_ne_again (c : Command) (h : c.isInert = true) : c ≠ .again := by
  cases c <;> try (intro hEq; cases hEq)
  simp [Command.isInert] at h

theorem Command.isInert_ne_win (c : Command) (h : c.isInert = true) : c ≠ .win := by
  cases c <;> try (intro hEq; cases hEq)
  simp [Command.isInert] at h

theorem Command.isInert_ne_cancel (c : Command) (h : c.isInert = true) : c ≠ .cancel := by
  cases c <;> try (intro hEq; cases hEq)
  simp [Command.isInert] at h

theorem Command.isInert_ne_restart (c : Command) (h : c.isInert = true) : c ≠ .restart := by
  cases c <;> try (intro hEq; cases hEq)
  simp [Command.isInert] at h

theorem Command.isInert_ne_checkpoint (c : Command) (h : c.isInert = true) : c ≠ .checkpoint := by
  cases c <;> try (intro hEq; cases hEq)
  simp [Command.isInert] at h

theorem Command.isInert_false_of_effectful (c : Command)
    (h : c = .cancel ∨ c = .restart ∨ c = .win ∨ c = .checkpoint ∨ c = .again) :
    c.isInert = false := by
  rcases h with h | h | h | h | h <;> subst h <;> rfl

/-- Solver-facing syntactic inert: every command is inert (sfx / message). -/
def syntacticInertCommandOnly (cmds : Array Command) : Bool :=
  !cmds.isEmpty && cmds.all (·.isInert)

def Command.toString : Command → String
  | .sfx n => s!"sfx{n.val}"
  | .cancel => "cancel"
  | .checkpoint => "checkpoint"
  | .restart => "restart"
  | .win => "win"
  | .message => "message"
  | .again => "again"

def parseCommand (s : String) : Except String Command :=
  if s == "cancel" then pure .cancel
  else if s == "checkpoint" then pure .checkpoint
  else if s == "restart" then pure .restart
  else if s == "win" then pure .win
  else if s == "message" then pure .message
  else if s == "again" then pure .again
  else if s.startsWith "sfx" then
    let rest := s.drop 3
    match rest.toNat? with
    | none => throw s!"unsupported command: {s}"
    | some n =>
      if h : n < 11 then
        pure (.sfx ⟨n, h⟩)
      else
        throw s!"unsupported command: {s}"
  else
    throw s!"unsupported command: {s}"

end PuzzleScript

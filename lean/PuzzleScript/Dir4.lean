namespace PuzzleScript

/-- Cardinal directions. Bit encoding matches JS movement nibble: UP=1, DOWN=2, LEFT=4, RIGHT=8. -/
inductive Dir4 where
  | up
  | down
  | left
  | right
  deriving DecidableEq, Repr, Inhabited

def Dir4.toBits : Dir4 → UInt32
  | .up => 1
  | .down => 2
  | .left => 4
  | .right => 8

def Dir4.ofBits? : UInt32 → Option Dir4
  | 1 => some .up
  | 2 => some .down
  | 4 => some .left
  | 8 => some .right
  | _ => none

/-- `(dx, dy)` in board coordinates (column-major neighbor uses `tile + dy + dx * height`). -/
def Dir4.delta : Dir4 → Int × Int
  | .up => (0, -1)
  | .down => (0, 1)
  | .left => (-1, 0)
  | .right => (1, 0)

/-- JS `processInput` direction index 0..3 → `Dir4` (action=4 is not a Dir4). -/
def Dir4.ofInputIndex? : Int → Option Dir4
  | 0 => some .up
  | 1 => some .left
  | 2 => some .down
  | 3 => some .right
  | _ => none

/-- Random-dir pick index `n % 4` → bits `1 << (n % 4)` (JS `IBITSET` order: up/down/left/right). -/
def Dir4.ofRandomIndex (n : Nat) : Dir4 :=
  match n % 4 with
  | 0 => .up
  | 1 => .down
  | 2 => .left
  | _ => .right

theorem Dir4.ofBits_toBits (d : Dir4) : Dir4.ofBits? d.toBits = some d := by
  cases d <;> rfl

end PuzzleScript

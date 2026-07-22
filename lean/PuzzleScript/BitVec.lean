import Init.Data.BitVec.Lemmas

namespace PuzzleScript

/-- Packed mask words (JS Int32Array / bitvec data), stored as UInt32. -/
abbrev MaskWords := Array UInt32

def maskWord (ws : MaskWords) (i : Nat) : UInt32 :=
  ws.getD i 0

/-- Bit test via `BitVec 32` view of the packed word. -/
def maskGetBit (ws : MaskWords) (bit : Nat) : Bool :=
  (maskWord ws (bit / 32)).toBitVec.getLsbD (bit % 32)

def maskEnsureWords (ws : MaskWords) (nWords : Nat) : MaskWords :=
  if ws.size ≥ nWords then ws
  else ws ++ Array.replicate (nWords - ws.size) 0

/-- Set/clear one bit via `BitVec 32` (`Init.Data.BitVec`). -/
def maskSetBit (ws : MaskWords) (bit : Nat) (val : Bool) : MaskWords :=
  let w := bit / 32
  let b := bit % 32
  let ws := maskEnsureWords ws (w + 1)
  let bv := (maskWord ws w).toBitVec
  let bv' := if val then bv ||| (1#32 <<< b) else bv &&& ~~~(1#32 <<< b)
  ws.set! w (UInt32.ofBitVec bv')

def maskOr (a b : MaskWords) : MaskWords :=
  let n := max a.size b.size
  (List.range n).foldl
    (fun out i => out.push (maskWord a i ||| maskWord b i))
    (#[] : MaskWords)

def maskAnd (a b : MaskWords) : MaskWords :=
  let n := max a.size b.size
  (List.range n).foldl
    (fun out i => out.push (maskWord a i &&& maskWord b i))
    (#[] : MaskWords)

/-- Clear bits of `a` wherever `b` has bits set (`a & ~b`). -/
def maskAndNot (a b : MaskWords) : MaskWords :=
  let n := max a.size b.size
  (List.range n).foldl
    (fun out i => out.push (maskWord a i &&& ~~~maskWord b i))
    (#[] : MaskWords)

def maskAnyBits (ws : MaskWords) : Bool :=
  ws.any (· != 0)

def maskBitsSetIn (required actual : MaskWords) : Bool :=
  let n := max required.size actual.size
  (List.range n).all fun i =>
    let r := maskWord required i
    let a := maskWord actual i
    (r &&& a) == r

def maskNoBitsInCommon (a b : MaskWords) : Bool :=
  let n := max a.size b.size
  (List.range n).all fun i =>
    (maskWord a i &&& maskWord b i) == 0

end PuzzleScript

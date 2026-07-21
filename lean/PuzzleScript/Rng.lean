namespace PuzzleScript

/-- RC4 state matching `src/js/rng.js` (used by `RandomGen`). -/
structure RngState where
  i : Nat
  j : Nat
  s : Array Nat
  deriving Repr

def RngState.nextByte (st : RngState) : Nat × RngState :=
  let i := (st.i + 1) % 256
  let j := (st.j + (st.s.getD i 0)) % 256
  let s1 := st.s.set! i (st.s.getD j 0) |>.set! j (st.s.getD i 0)
  let k := (s1.getD i 0) + (s1.getD j 0)
  let byte := s1.getD (k % 256) 0
  (byte, { i, j, s := s1 })

def RngState.uniform (st : RngState) : Float × RngState :=
  Id.run do
    let mut acc : Float := 0
    let mut cur := st
    for _ in [:7] do
      let (b, st') := cur.nextByte
      acc := acc * 256 + Float.ofNat b
      cur := st'
    let denom := Float.ofNat (256 ^ 7 - 1)
    pure (acc / denom, cur)

def RngState.randomNat (st : RngState) (lo hi : Nat) : Nat × RngState :=
  if hi ≤ lo then (lo, st)
  else
    let (u, st') := st.uniform
    let span := hi - lo
    (lo + (Float.floor (u * Float.ofNat span)).toUInt32.toNat, st')

def RngState.fromSnapshot (i j : Nat) (s : Array Nat) : RngState :=
  Id.run do
    let mut arr := Array.replicate 256 0
    for idx in [:min 256 s.size] do
      arr := arr.set! idx (s[idx]! % 256)
    pure { i := i % 256, j := j % 256, s := arr }

def RngState.identity : RngState :=
  { i := 0, j := 0, s := Array.ofFn (fun (i : Fin 256) => i.val) }

end PuzzleScript

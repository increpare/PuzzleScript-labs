namespace PuzzleScript

/-- Packed mask words (JS Int32Array / bitvec data), stored as UInt32. -/
abbrev MaskWords := Array UInt32

def maskWord (ws : MaskWords) (i : Nat) : UInt32 :=
  ws.getD i 0

def maskGetBit (ws : MaskWords) (bit : Nat) : Bool :=
  let w := bit / 32
  let b := bit % 32
  ((maskWord ws w) >>> UInt32.ofNat b) &&& 1 == 1

def maskSetBit (ws : MaskWords) (bit : Nat) (val : Bool) : MaskWords :=
  let w := bit / 32
  let b := bit % 32
  let cur := maskWord ws w
  let bitv : UInt32 := (1 : UInt32) <<< UInt32.ofNat b
  let next := if val then cur ||| bitv else cur &&& (~~~bitv)
  Id.run do
    let mut out := ws
    while out.size ≤ w do
      out := out.push 0
    pure (out.set! w next)

def maskOr (a b : MaskWords) : MaskWords :=
  let n := max a.size b.size
  Id.run do
    let mut out : MaskWords := .mkEmpty n
    for i in [:n] do
      out := out.push (maskWord a i ||| maskWord b i)
    pure out

def maskAnd (a b : MaskWords) : MaskWords :=
  let n := max a.size b.size
  Id.run do
    let mut out : MaskWords := .mkEmpty n
    for i in [:n] do
      out := out.push (maskWord a i &&& maskWord b i)
    pure out

def maskAnyBits (ws : MaskWords) : Bool :=
  ws.any (· != 0)

def maskBitsSetIn (required actual : MaskWords) : Bool :=
  let n := max required.size actual.size
  Id.run do
    let mut ok := true
    for i in [:n] do
      let r := maskWord required i
      let a := maskWord actual i
      if (r &&& a) != r then
        ok := false
    pure ok

def maskNoBitsInCommon (a b : MaskWords) : Bool :=
  let n := max a.size b.size
  Id.run do
    let mut ok := true
    for i in [:n] do
      if (maskWord a i &&& maskWord b i) != 0 then
        ok := false
    pure ok

end PuzzleScript

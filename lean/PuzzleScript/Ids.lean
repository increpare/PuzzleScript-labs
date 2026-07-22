namespace PuzzleScript

/-- Flat column-major tile index (`x * height + y`). Not `Fin nTiles` — level size changes in-session. -/
structure TileIdx where
  val : Nat
  deriving DecidableEq, Repr, Inhabited

/-- Collision-layer index. Bound checked via `WellFormed` / hypotheses, not `Fin layerCount`. -/
structure LayerIdx where
  val : Nat
  deriving DecidableEq, Repr, Inhabited

/-- Object id in the game’s id space. -/
structure ObjectId where
  val : Nat
  deriving DecidableEq, Repr, Inhabited

/-- Index into `Game.levels` (playable or message entries). -/
structure LevelIdx where
  val : Nat
  deriving DecidableEq, Repr, Inhabited

instance : Hashable TileIdx where
  hash t := hash t.val

instance : Hashable LayerIdx where
  hash ℓ := hash ℓ.val

instance : Hashable ObjectId where
  hash o := hash o.val

instance : Hashable LevelIdx where
  hash ℓ := hash ℓ.val

/-- Convenience constructors. -/
def ObjectId.ofNat (n : Nat) : ObjectId := ⟨n⟩
def LayerIdx.ofNat (n : Nat) : LayerIdx := ⟨n⟩
def LevelIdx.ofNat (n : Nat) : LevelIdx := ⟨n⟩

end PuzzleScript

# Lean line-walk row/column locality

Status: Done (v1 fixed + cardinal; no sorry).
Date: 2026-07-22.

Related:
- Board layout / scan: [`lean/PuzzleScript/Runtime.lean`](../../lean/PuzzleScript/Runtime.lean) (`ruleDirectionDelta`, `findFixedRowMatches`, `rowCellsMatchFixed`, `applyRowAt`)
- Coordinate helpers (if present): [`lean/PuzzleScript/View.lean`](../../lean/PuzzleScript/View.lean)
- Parallel tracks (do not block): [inert skipCellWrites](2026-07-22-lean-inert-skip-cell-writes-soundness-design.md), [WellFormed preservation](2026-07-22-lean-wellformed-preservation-design.md) (done)

## 1. Problem

PuzzleScript levels are stored as a flat tile array. In the Lean mask runtime the encoding is

\[
i = x \cdot \texttt{height} + y
\]

Horizontal rules scan with `delta = ±height`; vertical with `delta = ±1` (`ruleDirectionDelta`). Match (`rowCellsMatchFixed`) and apply (`applyRowAt`) each walk that arithmetic independently. Ellipsis variants add gap skips. Nothing yet proves that a horizontal/vertical **fixed** (non-ellipsis) rule stays on a single row/column, or that apply cannot mutate off-line tiles.

That locality is the geometric fact that makes 1D storage safe for line rules — and a useful exercise before heavier inert/`skipCellWrites` work.

## 2. Goals (done bar)

Prove, with no `sorry`, for **cardinal single-bit** `RuleDir` (`1|2|4|8`) and **non-ellipsis** pattern rows:

| Layer | Claim |
|-------|--------|
| **Geom** | Stepping by `±height` preserves `y`; stepping by `±1` preserves `x` while the walk stays inside a column (no wrap into the next column) |
| **Walk** | Every tile on a fixed line walk from a well-started match lies on that row (horizontal) or column (vertical) |
| **Match** | `rowCellsMatchFixed` only inspects walk tiles (corollary) |
| **Apply** | After `applyRowAt` on `RowMatch.fixed`, every tile **not** on the walk is unchanged |

Refactor match/apply so both consume the **same** fixed line-walk definition (behavior-preserving).

## 3. Non-goals (v1)

- Ellipsis-1 / ellipsis-2 walks (reuse the walk API later; gaps are `gap * delta`)
- Omni / multi-bit `RuleDir` (composite `ruleDirectionDelta`)
- Full `tryApplyRule` / multi-row tuple locality beyond “each fixed row is one walk”
- Retargeting inert or WellFormed proofs onto line locality
- Changing JS semantics or Lean gameplay outcomes

## 4. Approach: shared line walk

Chosen over pure arithmetic-only proofs on the duplicated loops: one walk definition is the source of truth for match and apply, so locality is proved once and both paths inherit it. Arithmetic lemmas still underpin the walk.

### 4.1 Tile coordinates

Introduce small helpers (names illustrative):

- `tileX (h : Nat) (i : Nat) : Nat := i / h` (with `h > 0` hypotheses as needed)
- `tileY (h : Nat) (i : Nat) : Nat := i % h`
- Inverse: `mkTile h x y = x * h + y` with the usual round-trip lemmas when `y < h`

### 4.2 Fixed walk

For `start : Nat`, `delta : Int`, `nCells : Nat` (number of non-ellipsis pattern cells):

```text
fixedWalkTiles start delta nCells
  = [ start + k·delta  (as Nat, under non-neg / in-bounds side conditions) | k < nCells ]
```

Concrete API can be `List Nat`, `Array Nat`, or a fold/`foldl` over `List.range nCells` — pick whatever proves cleanest against current `Id.run` / `foldl` style. Definitional equality with today’s loops is the bar.

Ellipsis (later): walk steps are a mix of `+delta` (cell) and `+gap·delta` (ellipsis); out of v1 scope.

### 4.3 Runtime wiring

1. Extract `fixedWalkTiles` (or equivalent) in `Runtime.lean` (or a tiny `Geometry.lean` if preferred).
2. Refactor `rowCellsMatchFixed` to iterate walk tiles + pattern cells in lockstep (reject `.ellipsis` in the row as today).
3. Refactor `applyRowAt` for `.fixed` to apply replacements along the same walk.
4. Keep `tupleCellTile` for `.fixed` as `start + cellIdx·delta` (should match walk index `cellIdx`); prove congruence if useful, not required for v1 done bar.
5. No gameplay change: `make lean_parity_smoke` (+ inert static smoke if Runtime touch is broad) must stay green.

### 4.4 Cardinal directions

Restrict theorems to `direction.toNat ∈ {1, 2, 4, 8}` (or a `RuleDir.isCardinal` Bool). Then:

| Dir | `delta` (height `h`) | Line invariant |
|-----|----------------------|----------------|
| UP `1` | `-1` | same `x`, decreasing `y` |
| DOWN `2` | `+1` | same `x`, increasing `y` |
| LEFT `4` | `-h` | same `y`, decreasing `x` |
| RIGHT `8` | `+h` | same `y`, increasing `x` |

**Column wrap:** vertical walks with `|delta|=1` leave the column if they cross a `y` boundary into `y=0` of the next `x`. Scan bounds in `findFixedRowMatches` already limit starts so a pattern of length `len` fits; locality theorems take the corresponding hypotheses (start’s `y` range / `nCells` vs `height`), not “any start is safe.”

## 5. Proof architecture

```text
tileX / tileY / mkTile round-trips
    → ruleDirectionDelta_cardinal (delta ∈ {±1, ±h})
    → step_preserves_row / step_preserves_col (under bounds)
    → fixedWalk_locality
    → rowCellsMatchFixed inspects ⊆ walk
    → applyRowAt_fixed_preserves_off_walk
```

Minimal extracts for proof access (same style as WF / inert): prefer public or `@[simp]`-friendly pure helpers over fighting `Id.run` mutability. If `rowCellsMatchFixed` stays private, either open it for proofs or add a public `go`/`spec` twin that is definitionally equal.

## 6. Milestone checklist

1. Coordinate helpers + round-trip / step lemmas for cardinal `delta`.
2. `fixedWalkTiles` (or fold equivalent) + locality theorem.
3. Refactor `rowCellsMatchFixed` onto the walk; prove match inspects only walk tiles.
4. Refactor fixed branch of `applyRowAt` onto the walk; prove off-walk tiles unchanged.
5. Wire module (e.g. `PuzzleScript/LineWalk.lean` or section in `WellFormed.lean` — prefer a dedicated file to keep WF modules focused).
6. `lake build` + `make lean_parity_smoke`; note in `lean/README.md`.

## 7. Success criteria

- No `sorry`
- Goals in §2
- Parity smoke green after refactor
- README mentions line-walk locality

## 8. Risks

- **`Id.run` / for-loops:** may need a pure recursive/`foldl` twin for proofs (already a pattern elsewhere in Runtime).
- **Int tile indices:** match uses `Int` cursors and `.toNat`; walk API should match that carefully to avoid off-by-one at negatives.
- **Defeq after refactor:** keep smoke as the oracle; avoid “cleanup” that changes scan order or early-outs.
- **Vertical wrap hypotheses:** easy to over-claim “same column for any start”; stick to scan-bounds-shaped assumptions.

## 9. Spec self-review

- Scope is fixed non-ellipsis + cardinal dirs only; ellipsis/omni explicitly deferred.
- Shared walk is the committed approach; arithmetic lemmas support it, not a second competing architecture.
- Apply claim is **off-walk unchanged**, not full WF (orthogonal to WellFormed preservation).
- No contradiction with inert/`skipCellWrites` (parallel track).
- Checklist is implementation-sized; no placeholders.

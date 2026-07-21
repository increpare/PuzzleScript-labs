# Lean parity leftovers (clean corpus)

Last updated: 2026-07-21. Target: **305/305** clean candidates.

## This wave

- **`require_player_movement`**: parse `metadata_map.require_player_movement`; cancel turn if no player left a start tile (JS `bitsClearInArray`). Fixes **aggregate player allowed #1032** and **C #1032** (AND-player vacuous ALL win after hat-only moves).
- **Layer-coupled overlap**: `layerOptionMatches` / term match use **object-mask overlap** (any bit), not subset — matches JS/native. Fixes **One/Many player unlimited rigidbodies**, **10 layers***, **Kreiseln**, and many gallery cases.
- **Undo + again**: push one undo frame per player input **after** again settles; again gated on real board change. Fixes **Undo test (#315)** and **Undo and Real-time #796**.
- **Restart target on win advance** (prior): `restartBoard` updated in `sessionAfterWinAdvance`.
- Expand default timeout **60s**. Bisect uses settled again snapshots.

## Coverage

Run `python3 scripts/lean_parity_expand.py --write-whitelist` then count unique whitelist ∩ clean candidates. Latest expand: **~14 newly passing** this wave after overlap fix; leftover names below.

## Remaining leftovers

### Timeouts (again / realtime / long traces)

| Fixture | Why |
|---------|-----|
| `robotic arm` | Heavy again / rule loops (may still exceed 60s) |
| `increpare game: robot arm` | Same family |
| `Rigidbody fix bug #246` | Rigid rollback + long search |
| `Neoprenanzieher` | Long input trace |
| `Oh No My Dog Is About To Swallow A Piece Of Chocolate` | Long / again |
| `SWIMMING TIME!` | Realtime-style |
| `REALTIME DOG MOUNTAIN RESCUE` | `realtime_interval` not modeled |

### Serialize mismatch

| Fixture | Why |
|---------|-----|
| `propagation test` | Movement-guide / vertical propagation edge case (bisect input 2) |
| `Car Crash` | Compound collision / rules |
| `Expand, avoid the flames [also it's not always solvable]` | Large / special rules |
| `Lightdown` | Lighting / multi-layer rules |
| `Sok7` | Large sokoban variant |

### FAIL

| Fixture | Why |
|---------|-----|
| `gallery: tidy the cafe` | Large gallery; parity_smoke error snippet is title-only |

## Tooling

- `python3 scripts/lean_parity_expand.py --write-whitelist [--timeout 60]`
- `python3 scripts/lean_parity_bisect.py --fixture 'NAME'` (again-settled snapshots)

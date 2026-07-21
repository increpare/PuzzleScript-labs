# Lean parity leftovers (clean corpus)

Last updated: 2026-07-21. **Coverage: 292 / 303** unique clean names in `fixtures.json` (`make lean_parity_smoke` green). Candidate file has 305 lines including duplicates.

## This wave

- **`require_player_movement`**: parse `metadata_map`; cancel turn if no player left a start tile. Fixes **aggregate player allowed #1032** / **C #1032**.
- **Layer-coupled object overlap**: match/apply use overlap (any bit), not subset — JS/native. Fixes unlimited-rigidbody games, 10-layer suites, many gallery titles.
- **Undo + again**: one undo frame per player input after again settles; again requires board change. Fixes **Undo test (#315)**.
- Expand default timeout **60s**; bisect uses again-settled snapshots.

## Remaining (11)

### Timeouts

| Fixture | Why |
|---------|-----|
| `Rigidbody fix bug #246` | Rigid rollback + long turn budget |
| `Neoprenanzieher` | Long input trace |
| `Oh No My Dog Is About To Swallow A Piece Of Chocolate` | Long / again |
| `SWIMMING TIME!` | Realtime-style |
| `REALTIME DOG MOUNTAIN RESCUE` | `realtime_interval` not modeled |

### Serialize mismatch

| Fixture | Why |
|---------|-----|
| `propagation test` | Movement-guide leftover (bisect @ input 2) |
| `Car Crash` | Compound rules |
| `Expand, avoid the flames [also it's not always solvable]` | Large / special |
| `Lightdown` | Multi-layer / lighting rules |
| `Sok7` | Large variant |

### FAIL

| Fixture | Why |
|---------|-----|
| `gallery: tidy the cafe` | Large gallery mismatch |

## Tooling

- `python3 scripts/lean_parity_expand.py --write-whitelist`
- `python3 scripts/lean_parity_bisect.py --fixture 'NAME'`

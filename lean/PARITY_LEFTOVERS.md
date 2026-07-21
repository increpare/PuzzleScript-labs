# Lean parity leftovers (clean corpus)

Last updated: 2026-07-21. **Coverage: 261 / 305** clean candidates in `parity_whitelist.txt` (`make lean_parity_smoke` green).

## Fixed this session

- **restart test** — `sessionAfterWinAdvance` now sets `restartBoard := some nb` when advancing after a win (mirrors JS `loadLevel` / `restartTarget = backupLevel()`). Keyboard `restart` after level change restores the current level’s snapshot, not the initial IR restart target.

## Remaining failures (44)

### Timeouts (10) — again probe / turn budget / realtime

Likely need realtime tick loop, flick/zoom metadata, or further again-probe parity; some may be duplicate candidate names.

| Fixture | Notes |
|---------|--------|
| `robotic arm` | Heavy again / rule loops |
| `Rigidbody fix bug #246` | Rigid rollback + many rule applications |
| `gallery game: two worlds` (×2 in candidates) | Large gallery; duplicate line in `parity_clean_candidates.txt` |
| `increpare game: robot arm` | Same family as robotic arm |
| `Neoprenanzieher` | Long input trace |
| `Oh No My Dog Is About To Swallow A Piece Of Chocolate` | Long / again |
| `SWIMMING TIME!` | Realtime-style |
| `REALTIME DOG MOUNTAIN RESCUE` | Realtime (`realtime_interval` not modeled) |
| `wb + gems test` | Large trace |

### Serialize mismatch (30)

| Fixture | Likely root cause |
|---------|-------------------|
| `aggregate player allowed #1032`, `aggregate player allowed C #1032` | Aggregate **AND** player: split body/hat movement + `all player on target` win semantics; Lean spurious level advance (~input 7) after gameplay diverges from JS (hat chain rule vs aggregate player movement). B/D variants pass (OR player mask). |
| `One player, unlimited rigidbodies`, `Many parallel players, unlimited rigidbodies` | Multi-entity rigid groups / parallel players |
| `Undo test (#315)`, `Undo and Real-time #796` | Undo stack + realtime/tick interaction |
| `propagation test`, `right [ vertical playerortarget \| vertical player ] -> …` | Movement propagation / vertical movement bits |
| `Push Pull`, `Slide Pull`, `Psyshic push`, `Caramelban`, … | Compound push/pull/rigid/rule features |
| `Sokoban... in 3D!`, `Sok7`, `Crate Assembler` | 3D / layer-coupled / large rule sets |
| Gallery-scale puzzles (`A CLEAR VIEW OF THE SKY` ×2, `BIAXIAL INVASION OF SATURN`, …) | Many combined engine features; fix incrementally with bisect |

### FAIL without clean mismatch label (4)

Large gallery games; parity_smoke reports game title as error snippet (serialization diff too large or replay error):

- `gallery game: mad queens`
- `gallery: beam islands`
- `gallery: tidy the cafe`
- `increpare game: snortal`

## Tooling

- `python3 scripts/lean_parity_expand.py --write-whitelist` — grow whitelist from `parity_clean_candidates.txt`
- `python3 scripts/lean_parity_bisect.py --fixture 'NAME'` — first step where Lean serialize ≠ JS trace (strip trailing newlines when comparing)

## Next priorities

1. Aggregate AND player: align win check with JS (avoid vacuous `ALL` win / spurious `sessionAfterWinAdvance`); bisect movement from input 1.
2. `require_player_movement` in IR + `executeTurn` (if exported in fixtures).
3. Realtime / undo / rigid multi-player buckets above.

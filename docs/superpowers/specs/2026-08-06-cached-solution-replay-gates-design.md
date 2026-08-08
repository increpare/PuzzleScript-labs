# Cached solution replay gates

Date: 2026-08-06  
Status: approved for planning

## Problem

GBC (and native C++) correctness was only exercised by ad-hoc solver→replay
marathons. Those runs are slow, easy to skip, and rediscover the same gaps.
Solution verification must be a standard gate: cached solutions in git, replay
on every normal test run, no solver required for CI.

Evidence from the 2026-08-06 eligible corpus sweep (3s solve timeout):

- 293 retained boards attempted across 46 eligible games
- 280 C++ solutions found; all 280 won under JS replay
- only 134 of those won on host GBC core (`host_known_good` candidates)
- 146 JS-valid solutions currently lose on host GBC (false-negative / parity gap)
- cart/libmGBA first-board sweep: 35/46 successful under the existing harness

## Goals

1. Check in a reusable solution cache for the eligible GBC corpus.
2. Make host GBC + native C++ replay of known-good cached solutions part of
   default `ctest` / `make tests`.
3. Make thorough testing cover full `js_valid` on C++, quarantined host reporting
   for known host gaps, and cart/libmGBA replay of every cached board
   (`make all_tests_thorough` / CI thorough).
4. Keep solver out of the default and thorough gates; solving is a maintainer
   refresh step only.

## Non-goals

- Fixing the existing host GBC false-negatives in this change
- Exhaustive cart specialized-vs-host parity (use `cart_quarantine` for known
  SDCC gaps; launcher WRAM / interpreter bank-fit fixes are in-tree)
- Replacing performance benches (`bench_gbc_*`); those remain separate
- Solving every unsolved board during ordinary test runs

## Design

### Cache layout

Checked in under `src/tests/solution_cache/eligible/`:

```text
src/tests/solution_cache/eligible/
  manifest.json
  solutions/
    <slug>/
      board-<n>.txt
```

Each `board-<n>.txt` is one input token per line (`up`/`down`/`left`/`right`/`action`).

`manifest.json` is the single source of truth. Each entry includes at least:

| Field | Meaning |
| --- | --- |
| `slug` | Eligible-game slug (matches `ELIGIBLE_GAMES`) |
| `source` | Repo-relative game path |
| `board_index` | Retained GBC board ordinal (0-based) |
| `source_level` | Source-level index used for JS/C++ replay |
| `solution_path` | Repo-relative path to the token file |
| `source_sha256` | SHA-256 of the current game source bytes |
| `tags` | Array including `js_valid` and optionally `host_known_good`, `cart_quarantine` |

Rules:

- Every committed solution must be tagged `js_valid` (JS engine replays to win
  on `source_level`).
- `host_known_good` means host GBC core also wins that fixture on `board_index`.
- `cart_quarantine` means host still wins but cart/libmGBA currently diverges
  (maintainer-tagged; refresh preserves the tag).
- Entries whose `source_sha256` no longer matches the game file are stale;
  runners fail until refresh updates or removes them.

### Refresh tool

`scripts/refresh_eligible_solution_cache.py` maintains the cache.

Default mode (no solve):

1. Load existing cache + eligible game list / retained-board mapping.
2. JS-verify every cached solution; drop or refuse entries that no longer win.
3. Host-classify: add/remove `host_known_good` based on current host GBC replay.
4. Rewrite `manifest.json` and report counts.

Opt-in fill mode:

- `--solve --timeout-ms N` attempts to fill missing retained boards via the
  existing culled single-level C++ solver path.
- Newly found solutions are kept only after JS verification.
- Host win promotes `host_known_good`.

Refresh is a maintainer command. It is **not** invoked by `make tests` or
`make all_tests_thorough`.

### Default gate (fast, always-on)

Replays every entry tagged `host_known_good` on:

1. Host GBC core (desktop interpreter path)
2. Native C++ runtime

Wiring:

- CMake `add_test` targets so `make ctest` runs them
- Makefile convenience target `solution_cache_tests`
- Included in `make tests`

Constraints:

- No solver
- No GBDK / libmGBA
- Fail on: missing fixture, bad tokens, source hash mismatch, replay not won

### Thorough gate

In addition to the default gate:

1. Replay every `js_valid` entry on **native C++** (hard fail if not won)
2. Replay every `js_valid` entry on host GBC:
   - `host_known_good` → hard fail if not won
   - `js_valid` only (known host gap) → run and report, but do **not** fail the
     thorough gate until promoted (fixing those gaps is out of scope here)
3. Build one multi-game benchmark cart (existing cart builder)
4. Replay **every** cached board under libmGBA (one cart build, one emulated
   run per cached board). The host pre-seeds a board-ordinal request in SRAM;
   the cart benchmark firmware loads that retained board and finalizes on win.
   Hard-fail policy mirrors host quarantine:
   - `host_known_good` without `cart_quarantine` → miss is fatal
   - `js_valid` only (known GBC gap) → run and report, not fatal
   - `cart_quarantine` (known cart/SDCC divergence while host still wins) →
     run and report, not fatal

Wiring:

- Makefile targets `solution_cache_tests_thorough` and `gbc_cart_solution_tests`
- Included in `make all_tests_thorough`
- Cart failures are hard failures

### Runners

Thin, reusable runners preferred over growing the old bench scripts:

| Runner | Role |
| --- | --- |
| Host/C++ replay test binary or script | Reads manifest + tag filter; replays; exits non-zero on any miss |
| Cart solution test script | Builds/reuses benchmark cart; replays every cached board via libmGBA |
| Refresh script | Maintains cache; optional solve |

Existing `bench_gbc_eligible_solutions.py` / `bench_gbc_cart_solutions.py` remain
available for performance measurement; correctness ownership moves to the new
gate.

### Failure and promotion policy

| Situation | Behavior |
| --- | --- |
| `host_known_good` fails host or C++ in default gate | Fail CI |
| `js_valid` fails C++ in thorough | Fail thorough |
| `host_known_good` fails host in thorough | Fail thorough |
| `js_valid`-only fails host in thorough | Report only (quarantined host gap) |
| Cart `host_known_good` miss (no `cart_quarantine`) | Fail thorough |
| Cart `js_valid`-only miss | Report only (same GBC gap class as host) |
| Cart `cart_quarantine` miss | Report only (known cart/SDCC gap) |
| JS-valid but host-losing solution | Stays in cache with `js_valid` only |
| Host later wins that fixture | Refresh promotes `host_known_good` |
| Cart later wins a quarantined fixture | Refresh/manual clears `cart_quarantine` |

### Initial cache seed

Seed from the 2026-08-06 verified fixtures where possible:

- All JS-winning solutions → `js_valid`
- Subset that also won on host GBC → also `host_known_good`
- Unsolved boards are simply absent until a refresh `--solve` finds them

## Test plan (for the implementation itself)

1. Unit-test manifest load / tag filter / hash mismatch detection.
2. Seed a tiny fixture set and prove default runner fails on a deliberately
   broken token file.
3. Prove default runner passes on `host_known_good` seed.
4. Prove thorough C++ path fails if a `js_valid` fixture is broken, and that a
   `js_valid`-only host miss is reported without failing thorough.
5. Smoke cart thorough path on a small `--limit` if full 46-game cart is too
   heavy for the implementation PR’s local loop; full corpus remains the real
   thorough gate.

## Decisions log

- Default runtime target: host GBC + C++; cart in thorough only
- Default corpus width: all retained boards that have cached solutions, filtered
  by `host_known_good` for the fast gate
- Cache all JS-valid solutions; split via tags/manifests
- Same cache used for C++ and GBC
- Thorough cart replays every cached board after one cart build (per-board
  SRAM board-ordinal request + one libmGBA run each)
- Cart hard-fail scope matches host: only unexpected `host_known_good` misses;
  `js_valid`-only and `cart_quarantine` are reported
- Approach: checked-in corpus + thin runners (not generate-on-first-run)

### Known cart quarantines

- `sokobond-demake` boards 1, 3–13 (`cart_quarantine`): host GBC baseline wins;
  cart specialized wins boards 0/2 only; cart interpreter loses all boards
  (SDCC layer-coupled / object-gated gap). Boards 0 and 2 stay unquarantined.

Cleared from quarantine by cart interpreter-only + bank splits: `match-maker`,
`unclean-residues`, `two-tone-tango`, `the-red-ring-of-immortality`, plus earlier
`head-skuller`.

Interpreter-only cart games (sibling asset bank for level cells / patterns as
needed): `slot-machine`, `pipe-puffer`, `yellow-box`, `head-skuller`,
`unclean-residues`, `two-tone-tango`, `the-red-ring-of-immortality`,
`match-maker` — see `SPECIALIZED_FORCE_INTERPRETER_SLUGS` /
`INTERPRETER_SPLIT_*` in `scripts/build_gbc_cart.py`. Pattern tables use the
per-rule slice hook (`pattern_asset_bytes` / `ps_gbc_pattern_slice_read`).

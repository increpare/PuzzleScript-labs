# GBC specialized codegen: any-masks + layer-coupled (Milestone A)

Status: Approved for planning (design conversation 2026-07-25).  
Date: 2026-07-25.

Parent / related:
- [`2026-07-24-gbc-specialized-turn-codegen-design.md`](./2026-07-24-gbc-specialized-turn-codegen-design.md)
- [`2026-07-24-gbc-specialized-size-and-bank-split-design.md`](./2026-07-24-gbc-specialized-size-and-bank-split-design.md)
- Desktop model: `native/src/compiler/compact_turn_codegen.cpp` any-object /
  any-movement / layer-coupled match+apply paths; runtime
  `matchesPatternAt` / `applyReplacementAt` in `native/src/runtime/core.cpp`.

## 1. Problem

GBC export rejects patterns that lower to **any-object / any-movement** masks
or **layer-coupled movement** terms:

```text
dynamic any/layer-coupled masks are not in the v1 runtime
```

A fresh cull audit of `src/tests/good_games` (178 games) shows **50** fixtures
failing only on that gate (first failure). The GBC interpreter/façade matcher
only implements literal present/missing masks. Growing that interpreter is the
wrong investment: it is too slow for shipping play, and it delays codegen.

**Product stance:** a PuzzleScript engine must run PuzzleScript games.
On GBC, that means **specialized turn codegen** modeled on the existing C++
compact-turn emitters — not a feature-complete slow interpreter.

## 2. Goal

**Milestone A:** Export and run games that need any-object, any-movement, and
layer-coupled movement **via specialized GbdC emit**, with desktop-equivalent
match/apply semantics.

**Success bar:**

1. Exporter no longer rejects those pattern shapes when specialized emit
   succeeds.
2. Host specialized oracle / parity green for ≥1 representative any-using
   fixture (new or trimmed from `good_games`).
3. Re-audit `good_games` with `--cull-oversize-levels`: the previous 50 move
   off the any/coupled reject (to **OK**, or to a *different* honest hard
   fail such as bank overflow / object count / multi-row).
4. Size or emit failure **fails export** — no interpreter fallback.

## 3. Non-goals (A)

- Teaching `core.c` / `facade_rules.c` full any / layer-coupled matching
  (optional later cleanup only).
- **Milestone B:** property/aggregate bindings and aggregate player masks
  (follow-on, same codegen-first policy).
- Multi-row rules, ellipsis, rigid, random rule groups.
- Raising 32-object or 6 movement-layer limits.
- Keeping “specialized blew the bank → link interpreter” as a supported
  shipping path.

## 4. Policy: specialized or fail

| Situation | Behavior |
|-----------|----------|
| Game uses any / layer-coupled (A) | Must emit specialized turn |
| Specialized emit unsupported for a construct | **Export fails** with a clear error |
| Specialized links but exceeds per-bank 16 KiB or total 512 KiB | **Export / ROM build fails** — do **not** delete specialized and relink interpreter |
| Games that never needed any/coupled | Still prefer specialized when emit succeeds; same hard-fail on size once this policy is wired globally for shipping export |

Firmware `build-rom` size→interpreter fallback (`e0431d40`) is **retired for
shipping export** under this spec (at minimum for games that require A
features; prefer removing the fallback path entirely so policy is one line).

## 5. Approach

**Codegen-first (chosen).** Extend GBC specialized rule match/apply emission
using the desktop compact-turn generators as the semantic model. Emit integer
literals / small loops over packed mask tables in generated C — not a fatter
interpreter `ps_gbc_pattern` ABI as the feature vehicle.

Rejected alternatives:

- **Interpreter side tables first** — correct but invests in the slow path and
  delays the path we ship.
- **Fixed padded `ps_gbc_pattern` slots for N anys** — arbitrary caps; poor fit
  for layer-coupled term trees; irrelevant once specialized literals exist.

## 6. Architecture

```text
export-gbc
  → lower Game (unchanged desktop lowering: anyObjectOffsets, layerCoupled…)
  → validateRule: ALLOW any / layer-coupled (A); still reject B/multi-row/…
  → emitGbcSpecializedTurnFiles (required)
       rule match: present/missing + each any-mask (≥1 bit) + coupled terms
       rule apply: existing clear/set + layer-coupled movement replacements
       multi-bank rule packs as today when source size requires it
  → link specialized banks
  → on size/link failure: FAIL (no interpreter fallback)

Host oracle
  → same generated specialized C (or host twin) vs desktop compact-turn / runtime
```

### Semantics to mirror (desktop)

Match (per cell pattern), after literal present/missing:

1. For each any-object mask: `(objects & mask) != 0`.
2. For each any-movement mask: `(movements & mask) != 0`.
3. For each layer-coupled match term: desktop
   `layerCoupledMovementMaskTermMatches` equivalent (object mask on the
   collision layer + movement any/present/missing as lowered).

Apply:

- Existing objects/movements clear/set and movement layer clears.
- Layer-coupled **replacements** when `replacement.dynamic` carries them
  (same ordering/bit effects as `applyReplacementAt`).

GBC remains ≤32 objects / single `uint32_t` object word and the existing
movement-layer packing — masks are repacked through the current movement
layout helper used by export.

### Specialized eligibility

- Unrolled specialized emit must accept rules that include any/coupled terms.
- If a game has only constructs outside A/B still rejected (multi-row, etc.),
  export still fails at validate — unchanged.
- Compact-turn “native kernel” support gates should be widened so any/coupled
  no longer force `specialized_turn: false` / missing artifacts.

## 7. Measurement / verification

1. Unit / exporter structural tests: a fixture with `moving` / property-as-any
   emits specialized C containing the expected mask tests; no reject string.
2. `puzzlescript_gbc_specialized_oracle_smoke` (or sibling) for the new fixture.
3. Scripted cull audit over `good_games`: count by failure class before/after;
   ledger row with OK count (was 14) and remaining top reject reasons.
4. Spot ROM build for 1–2 newly OK games; confirm specialized banks ≤16 KiB
   each and no fallback.

## 8. Rollout

1. Remove exporter reject + widen specialized emit for any-object (smallest).
2. Any-movement + layer-coupled match.
3. Layer-coupled apply/replacements.
4. Retire size→interpreter fallback for shipping export; fail with bank stats.
5. Full `good_games` audit + ledger.
6. **Milestone B** (separate spec): property/aggregate bindings in codegen.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Emit size explosion on any-heavy games | Existing multi-bank rule packs; hard fail if still over |
| Semantic drift vs desktop | Oracle against compact-turn / runtime; prefer shared emit helpers where practical |
| Host tests still link interpreter stubs | Keep stubs for tests only; shipping ROM path requires specialized |
| Partial unlock (any OK, then hit object_count) | Expected; audit reports next wall honestly |

## 10. Open follow-ups

- Milestone B spec: property/aggregate bindings + aggregate player.
- Multi-row / ellipsis codegen.
- Whether to delete or `#ifdef` dead interpreter match paths after A/B.
- Optional: drop redundant 5×5 sprite export check (PuzzleScript already
  constrains object art).

**Next:** Implementation plan under `docs/superpowers/plans/` after written-spec
review.

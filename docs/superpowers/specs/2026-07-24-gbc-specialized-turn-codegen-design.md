# GBC specialized turn codegen (compact_turn retarget)

Status: Approved for planning.
Date: 2026-07-24.

Related:
- Desktop emitter: [`native/src/compiler/compact_turn_codegen.cpp`](../../../native/src/compiler/compact_turn_codegen.cpp), [`compact_turn_codegen.hpp`](../../../native/src/compiler/compact_turn_codegen.hpp)
- GBC runtime step: [`native/src/gbc/core.c`](../../../native/src/gbc/core.c) (`ps_gbc_step`)
- GBC export / data codegen: [`native/src/gbc/exporter.cpp`](../../../native/src/gbc/exporter.cpp)
- Firmware: [`firmware/gbc/`](../../../firmware/gbc/)
- Perf context: [`docs/performance/gbc-opportunity-audit-2026-07-22.md`](../../performance/gbc-opportunity-audit-2026-07-22.md), [`gbc-optimization-ledger.md`](../../performance/gbc-optimization-ledger.md)

## 1. Problem

PuzzleScript on GBC already has strong rendering and interpreter-side opts, but
turns are still dominated by **generic rule matching** over generated tables.
Desktop gets large wins from **programmatic per-game specialized turn codegen**
(`compact_turn_codegen`). The cartridge path does not use that yet: the host
emits data tables; firmware runs a shared C interpreter (`ps_gbc_step` →
`ps_gbc_apply_turn_phases`).

Goal: make as many of the 14 eligible GBC games as possible feel snappy
(~50–80 ms/turn on solution-replay workloads) by retargeting compact-turn
specialization to GBDK C, with a hard **512 KiB** ROM ceiling and interpreter
fallback when unsupported or oversized.

## 2. Goals

| Area | Claim |
|------|--------|
| **Codegen** | Automatically emit a per-game specialized whole turn (`ps_gbc_step_specialized`), not AI-handwritten game code |
| **Reuse** | Maximize reuse of `compact_turn_codegen` via a **target dialect** + thin GBC façade (not a greenfield matcher) |
| **Feel** | Target ~50–80 ms/turn where possible; maximize how many eligible games hit it (not all-or-nothing) |
| **Measure** | Primary workload = **level solution replays**; ledger speed + ROM/bank/WRAM every experiment |
| **Size** | Extra switchable ROM banks allowed; total ROM ≤ **512 KiB** or fall back to interpreter |
| **Parity** | Specialized path ≡ current GBC interpreter semantics (host oracle first, then cart) |
| **Player fact** | When proved (invariant player count + exactly one per retained level), bake a single `player_cell` into the specialized turn |

## 3. Non-goals (v1)

- Compiling today’s desktop compact-turn **C++ output blobs** with SDCC unchanged
- Handwritten SM83 for the entire turn (optional later micro-opts)
- Expanding the GBC language profile (still no aggregate player, rigid, ellipsis, etc.)
- Requiring commercial-game decompilation for v1 (optional inspiration after M3)
- Guaranteeing every eligible game hits 50–80 ms

Clarification: “reuse with constants” is in scope. Constants alone are not
enough (emitted code uses `PersistentLevelState`, `std::vector`, C++
references). The plan is **dialect + façade + width constants**, still one
emitter family.

## 4. Architecture

```text
Game source
    → existing host compile (parser / semantic / GBC export facts)
    → compact_turn_codegen (target = GbdC)
         emits banked specialized step + helpers
    → GBC façade (thin): session board ↔ compact-turn cell API
    → firmware: ps_gbc_step → specialized entry (or interpreter fallback)
```

### 4.1 Target dialect

Extend `CompactCodegenOptions` with a target (e.g. `NativeCpp` vs `GbdC`).
Same host emitter; dialect switches:

- types / integer widths (proved object/movement bytes, strides, max cells)
- no `std::vector` or C++ references in emitted code
- bank section / `#pragma bank` as needed for GBDK
- entry name suitable for firmware (`ps_gbc_step_specialized`)

### 4.2 GBC façade

Small shared C API mapping compact-turn-style cell get/set/match/layer ops onto
`ps_gbc_session` storage. Specialized code calls the façade; the façade does
not reimplement PuzzleScript rule semantics.

Must build under GBDK and under a host test configuration for the oracle.

### 4.3 Banking

- Executing from a switchable ROM bank is **not** inherently slower than bank 0.
- Cost is **bank switches** and GBDK `BANKED` trampolines.
- Packing rule: whole hot specialized turn in **one** bank when possible; call
  once from the fixed shell. If oversized, split only at **phase boundaries**
  (e.g. early vs late), never per-rule inside match/apply loops.
- Levels / render / audio data stay in existing generated data banks where useful.
- Total linked ROM hard stop: **512 KiB**.

### 4.4 Fallback

If compact-turn support is unsupported for the game, or projected/linked ROM
would exceed 512 KiB → keep today’s table interpreter. Build succeeds; report
records the reason. No mixed semantics mid-turn.

## 5. Turn control / data flow

```text
frontend → ps_gbc_step(session, input)          [fixed bank shell]
  ├─ message / tick / no-op guards (unchanged)
  ├─ undo snapshot write (shared)
  └─ ONE banked call → ps_gbc_step_specialized(...)
        [hot bank]
        ├─ clear per-turn scratch / audio counters (façade)
        ├─ seed player movement from input
        │    • if single-player certified: touch player_cell only
        ├─ early rulegroups (generated, input-specialized)
        ├─ movement resolution (generated or same-bank helper)
        ├─ late rulegroups (generated)
        ├─ commands / again / cancel (interpreter-equivalent)
        └─ win check → session flags, dirty cells, player_cell
  ← return ps_step_result
  render / audio remain on existing paths outside the specialized turn
```

## 6. Correctness, measurement, fallback details

### 6.1 Parity

- Host oracle: identical board masks, win/again/cancel, and command/sfx streams
  vs current GBC interpreter on the same inputs.
- Primary traces: level solution replays.
- Retain existing GBC parity smokes for covered games.

### 6.2 Size

- After link: total ROM ≤ 512 KiB.
- Oversize → interpreter fallback for that game; report why.
- Ledger: mean ms/turn on replay, ROM bytes, bank count, fixed/WRAM deltas.

### 6.3 Snappy scoreboard

Per eligible game: fraction of replay turns ≤80 ms (and ≤50 ms as a stretch
band). Optimize for maximizing games with a good scoreboard.

### 6.4 Single-player bake-in

Enable only when analysis proves:

1. Player cardinality never changes under the game’s rules (for the GBC-supported rule set), and
2. Every retained level has exactly one player cell.

Otherwise keep scan / posting-list style behavior inside specialized or
interpreter paths.

## 7. Rollout milestones

| Milestone | Deliverable |
|-----------|-------------|
| **M0** | `GbdC` dialect hooks + minimal façade compiling under GBDK and host tests |
| **M1** | Specialized turn for one simple eligible game; host oracle parity on solution replay |
| **M2** | Banked cartridge: `ps_gbc_step` → specialized entry; mGBA replay timing + ROM report; ledger entry |
| **M3** | Specialize supportable games among the 14; scoreboard; single-player bake-in where proved |
| **M4** | Size/speed hardening (phase-boundary splits, trim desktop-only emission); optional external ROM study |

Out of scope until after M3: full-turn handwritten SM83; widening the GBC language profile.

## 8. Risks

| Risk | Mitigation |
|------|------------|
| SDCC emits large/slow code from desktop-shaped patterns | Dialect forbids C++-isms; façade keeps accessors simple; measure early on Sokoban |
| ROM balloon past 512 KiB | Hard fallback to interpreter; trim shared helpers; phase-boundary banking only |
| Semantic drift vs interpreter | Host oracle before cart; solution-replay gate |
| Cross-bank call overhead eats wins | Single hot bank; one entry call per turn |
| Not all games become snappy | Scoreboard accepts partial success; keep interpreter for hard cases |

## 9. Open follow-ups (not blocking planning)

- Exact solution-replay artifact format / where solutions are sourced for the 14 games
- Whether host oracle compiles emitted GBDK C with a second toolchain or a host-C dialect twin
- Optional later: disassemble other GBC puzzle games for micro-opt ideas

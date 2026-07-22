# Puzzle Processing Unit (PPU) Design

Status: proposed  
Date: 2026-07-21

## Summary

Design a dedicated **Puzzle Processing Unit (PPU)** — a hardware-shaped
"next board" engine for playing PuzzleScript. The PPU takes a host-compiled
rule program, an on-die level state, and a tick reason, and produces the next
level state plus a command stream with **100% equivalence to the JavaScript
PuzzleScript oracle**.

This is intentionally **not** a handheld console design. Render, audio, UI,
power management, and product packaging are out of scope except as consumers
of the PPU interface. Those pieces may use ordinary CPUs and commodity
hardware. The PPU is the specialized block: optimized for **tick latency**,
**energy per tick**, and **physical size (die area)**.

Architecture is custom-silicon-first in spirit, with FPGA as the proving
ground and a path that remains open to both an FPGA-hosted product and a
later ASIC that preserves the same exterior contract.

## Goals

- Define a PPU whose unit of time is a **play tick**, not a video frame.
- Guarantee **JS-oracle-identical** results after every tick (state and
  command stream). C++ is a useful secondary reference; JS remains master.
- Keep each tick fast enough that hard games — big boards, dense rules,
  long `again` / realtime chains — still **feel instant** when a host paints
  every tick.
- Keep working state in **on-die SRAM** (compute-local memory model).
- Keep the PPU **physically small**: area is a first-class constraint.
- Host-compile `.txt` → cartridge IR; the PPU does not parse PuzzleScript
  source in v1.
- Preserve a clean exterior contract so a later handheld (FPGA or ASIC) can
  wrap the PPU without redesigning game semantics.

## Non-goals

- Full handheld / console product architecture (case, battery, panel, library UI).
- On-device `.txt` compilation (may be added later outside the PPU).
- Pixel rendering, display controllers, or camera/zoom policy inside the PPU.
- Audio synthesis; SFX are command IDs only (hosts may play pre-baked PCM).
- Solver-oriented execution that collapses `again` or realtime ticks.
- Silent degradation when games exceed on-die capacity.
- Fixed framerate / vsync as a correctness or performance contract.

## Context And Relationship To Existing Work

The repo already has:

- JavaScript PuzzleScript (oracle engine and editor)
- Native C++ compiler/runtime (`native/`)
- Embedded / handheld experiments (ESP32-P4, pocket card, etc.)

This design does **not** replace those tracks. It asks a bluer-sky question:
what would a PuzzleScript-first **processing unit** look like if we optimized
the tick engine for silicon, then proved it on FPGA?

Existing handheld specs remain valid product explorations. The PPU is a
sharper research/engineering object that those products (or others) could
eventually host.

## Exterior Contract

### Inputs (host → PPU)

- Cartridge / rule program (or a banked resident slice)
- Initial or current level state load
- Tick reason:
  - player input (direction, action, undo, restart, …)
  - `again` continuation
  - `realtime_interval` tick
- Control: reset, halt, clear fault

### Outputs (PPU → host)

- Updated level state (readable after commit)
- Monotonic `tick_gen`
- Command stream for the tick (`SFX` id, message, win, …)
- Status: idle, busy, `NEED_AGAIN`, fault / capacity reject

### Semantic laws

1. **JS is the oracle.** Wrong board outcomes are PPU bugs. Equivalence means
   oracle-visible results after each tick (objects, movements, win/again, and
   command stream). On-die encoding may differ from JS memory layout if a
   defined export view still matches the oracle.
2. **One play tick per invocation.** Input, `again`, and realtime are the
   same shape of tick. The PPU must not gobble an `again` chain in one go.
3. **Hosts that want playable juice must observe every commit** (especially
   `again` and realtime). That observation is outside the PPU; the PPU only
   guarantees distinct commits.
4. **No fixed FPS.** Success is low tick latency / energy on hard games.
5. **Capacity is explicit.** Over-limit games refuse to load; they do not
   partially run.

## Memory Model

**Choice: on-die working state (model B).**

- Level state, movement/match scratch, and undo history live in **PPU SRAM**.
- Rule program ideally resides on-die; huge programs may use a narrow host
  overlay/fetch window, but the *working board* does not rely on external RAM
  for the common tick path.
- Host bus traffic is load / unload / tick / readback — not per-cell chatter
  during rule scan.

### Why this model

- Best energy and latency story for bitvec-heavy PuzzleScript ticks.
- Forces an honest area budget and corpus capacity story.
- Matches the idea of a small dedicated puzzle chip.

### Declared capacity knobs

Sized from corpus measurement (e.g. existing handheld report tooling) plus
headroom; exact numbers are an implementation-plan deliverable, not hand-waved
infinity:

| Budget | Meaning |
|--------|---------|
| Max board width × height | Largest loadable level |
| State word geometry | Objects / layers / movement encoding width |
| Resident IR size | Rule program bytes on-die |
| Undo depth | Snapshots retained on-die |
| Command ring depth | Max commands harvested per tick |

## Tick Micro-architecture

Logical pipeline (JS-equivalent semantics, silicon-friendly structure):

1. Decode tick reason (input / undo / restart / again / realtime).
2. Seed input movements when applicable.
3. **Rule phase** — apply rule groups with bitvec match/replace over state SRAM.
4. **Movement / collision resolve** — layer-aware; internal resolve loops that
   today's engines perform *within* a single tick remain inside this step.
5. **Command harvest** — SFX ids, messages, again flag, win, etc.
6. **Commit** — state consistent; `tick_gen++`; raise `NEED_AGAIN` or idle.

### Specialization targets (inside the PPU)

These are the interesting silicon investments:

- Wide bitvec operations and match against cell words
- Tight rule-program fetch/decode
- Movement resolve datapath over local SRAM
- Clock/power gating between ticks

Soft control is acceptable for rare edge paths if the hot path stays local and
oracle tests cover the branches. A later revision may harden more of the hot
path once FPGA profiles say what earns gates.

## Host Toolchain

The host is the only place that understands `.txt` in v1.

1. Compile with JS (oracle) and/or C++.
2. Lower to a stable **PPU IR** (encoding TBD in implementation planning;
   bytecode, tables, or micro-ops are all fine if semantics match JS).
3. Optionally bake render/audio assets for *hosts* — not required for PPU
   correctness (PPU only needs rule program + state + SFX **command ids**).
4. Verify: replay golden tick traces on a host PPU model and/or FPGA; require
   oracle-visible state equivalence and equal command streams vs JS after
   every tick.
5. Pack a cartridge image the host can load into the PPU.

Untrusted or unverified IR is out of scope for bring-up.

## Verification Gates

Blocking gates before claiming the PPU works:

1. **Oracle parity** — oracle-visible state + command stream vs JS on golden
   tick traces and the simulation corpus subset that fits capacity.
2. **Capacity honesty** — corpus sizing → SRAM budget; over-limit games fail
   closed.
3. **Perf / energy** — measure tick latency and energy proxies (FPGA cycle
   counters, toggle activity; ASIC estimates later) on hard fitted games.
4. **Area** — SRAM + logic estimate treated as a primary score, not a
   cleanup item.

## Realization Ladder

1. Spec (this document) + IR sketch + golden tick trace format from JS.
2. Host-executable PPU model (software) for fast oracle iteration.
3. FPGA implementation of the same exterior contract.
4. Optional ASIC hardening with identical exterior contract.

FPGA-in-product and ASIC-in-product both remain open; they must not fork the
tick interface.

## Relationship To A Future Handheld

If a handheld appears later, a sensible wrap is:

- PPU = tick engine (this design)
- Ordinary CPU = library UI, render blit, play host-baked PCM for `SFX`
  commands, storage, power
- Shared or bus-loaded buffers only at load/readback boundaries

That wrap is **not** specified here beyond preserving the PPU contract.

## Open Decisions (For Implementation Planning)

These are deliberate follow-ups, not TBDs that block the architecture:

- Concrete IR encoding and instruction/table layout
- Exact numeric capacity budgets from corpus measurement
- How much of the tick pipeline is soft control vs hardened datapath in the
  first FPGA cut
- Host bus width / DMA protocol for load and readback
- Whether directional/sprite-facing bits live in the same state words the
  eventual renderer would want, or a PPU-private encoding with a defined
  export view

## Success Criteria

The design succeeds when:

1. A PPU model/FPGA can play capacity-fitting games with JS-oracle-equivalent ticks.
2. `again` and realtime remain discrete visible commits (from the host's point
  of view).
3. Hard fitted games stay interactively snappy by measured tick latency.
4. On-die SRAM + logic sizing is small enough to still be called a dedicated
   unit, not "a general SoC that happens to run PuzzleScript."

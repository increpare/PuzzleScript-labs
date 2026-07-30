# GBC Same-Bank Compact-Facade Sharing Design

**Status:** Approved documentation follow-up from Task 11 of the GBC
extended-optimization plan. This document authorizes one opt-in canary
experiment only; it does not authorize general object sharing.

## Evidence and decision

The Task 10 shipping/benchmark object set at revision `9dab2dfa` contains 473
per-game ASxxxx objects and an exact 473-entry manifest bank map. Normalizing
only leading `_gNN_` / `b_gNN_` symbols that match the containing object,
corresponding leading object/module prefixes, `_CODE_N` area numbers, and
symbol addresses (including generated bank-symbol values), while preserving
interior namespace-like substrings and every instruction/relocation byte,
reproduces the roadmap exactly:

| Kind | Objects / normalized contents | Gross duplicates |
| --- | ---: | ---: |
| `generated_core` | 46 / 33 | 110,558 B |
| `generated_facade_rules` | 46 / 36 | 27,160 B |
| `generated_compact_facade` | 46 / 15 | 10,644 B |
| **Total** | | **148,362 B** |

None of those bytes is directly shareable. The objects expose namespaced
definitions, and the core/rule objects also refer to namespaced game code.
Across all per-game objects, all 1,634 namespaced reference records resolve;
884 are same-bank, 750 cross a bank, and none lacks bank ownership.
Direct-shareability analysis also inventories every consumer of clustered
definitions and rejects a cluster when a consumer lies outside the retained
implementation bank.

A deliberately conservative model keeps one implementation for each of the
25 duplicate configuration clusters, then reserves 1,034 bytes for
per-game context/far pointers, 7,664 bytes for aliases or banked bridges,
1,856 bytes for 58 modeled shared bridge/thunks, and 25,414 bytes (25% of the
shared implementations) for genericity/code-growth uncertainty. That model
yields 112,394 bytes. A stronger stress calculation replaces the modeled
thunk charge with 32 bytes for each of all 750 observed cross-bank reference
records, yielding 90,250 bytes. The 65,536-byte design gate uses that lower
stress-bound result and still passes.

The gate justifies a separate experiment, not a linker-only deduplication.
Three approaches were considered:

1. **Same-bank ASxxxx aliases for one compact-facade pair (selected).** It
   changes no call instruction, runtime context, or far-call convention and
   provides the cleanest proof that normalized identity is sufficient.
2. **Generated C forwarding wrappers.** This is easier to express in C, but
   eight hot wrappers per game can erase a 349-byte saving and distort the
   latency result.
3. **Cross-bank shared compact facade or core.** This reaches more of the
   112 KB estimate, but immediately introduces `BANKED` stack arguments,
   ownership changes, and hot far calls. It is too broad for the first proof.

## Canary scope

The only eligible cluster is:

- `g21` / `explodoban`
- `g31` / `two-step-pete`

Their normalized `generated_compact_facade.o` objects are identical and are
349 bytes each. Their compact-facade and facade-rules objects are already
co-located in packed bank 142 in the Task 10 artifact. The two
`generated_facade_rules.o` objects are also normalized-identical, but this
experiment does **not** share them.

The candidate may remove one 349-byte compact-facade implementation and add
zero-byte symbol aliases. It must not share any other cluster, modify
`pack_items()`, change the generated C ABI, or change the bank-call ABI.

## Opt-in boundary

Add a single explicit cart-builder option,
`--share-compact-facade-canary`, default false. The Makefile and normal
`gbc_cart`, `gbc_cart_smoke`, and Task 10 scoreboard paths remain default-off
unless an experiment command opts in.

With the option disabled:

- every generated source and all 381 generated game/rule objects must be
  byte-identical to the Task 10 production build;
- the cart item list, relocation, packing, and manifest schema remain
  unchanged apart from paths outside the artifact;
- there is no dormant firmware code, WRAM, HOME, SRAM, or runtime branch.

The candidate manifest records the option, owner prefix, member prefixes,
normalized digest, source/final bank, implementation bytes, and gross bytes
removed. A build fails rather than silently falling back when the canary
invariants do not hold.

## Alias and context ABI

`g21_generated_compact_facade.o` is the owner. After both candidate objects
are compiled and verified normalized-identical:

1. Keep the owner's eight definitions and code/relocation records unchanged.
2. Append eight `g31_` definition records to the owner object. Each alias has
   exactly the address of the corresponding `g21_` definition.
3. Increase the ASxxxx header's global-symbol count without reordering any
   existing symbol. Existing relocation indices therefore remain unchanged.
4. Omit `g31_generated_compact_facade.o` from the candidate link.

The public ABI remains the eight signatures already declared in
`puzzlescript/gbc_compact_facade.h`. The aliases are zero-byte entry aliases,
not wrapper functions. `ps_gbc_session*` remains the sole runtime context;
board and movement widths remain compile-time-identical for the selected
cluster. No descriptor, vtable, indirect call, new global, or per-game
context record is introduced.

Before linking, the checker must prove that every alias address matches the
owner definition after namespace normalization and that the two objects have
identical `T` bytes and `R` records. Different instruction bytes, constants,
post-namespace call targets, or relocation kinds reject the candidate.

## Bank ownership and packing

The candidate replaces the two ordinary facade `CartItem`s with one compound
canary item containing:

- the aliased owner compact-facade object;
- `g21_generated_facade_rules.o`;
- `g31_generated_facade_rules.o`.

The existing `pack_items()` algorithm places this compound item as a unit and
the normal relocation pass gives all three objects one final bank. The item
must fit below 16 KiB. Both games' facade-rules callers and all aliases are
therefore same-bank.

This experiment owns no far pointer and emits no `BANKED` function. It must
add zero HOME bytes. If grouping, packing, or relocation would separate a
caller from the owner, require a far pointer, or overflow a bank, the build
fails. It must not synthesize a trampoline.

## Validation and retention gates

Structural tests must cover ASxxxx symbol-count parsing, append-only aliases,
address equality, preserved symbol order/relocations, namespace mismatch,
code-byte mismatch, relocation-kind mismatch, and compound-item capacity.
The candidate then runs:

- focused Python build/analyzer tests;
- all native GBC tests and all JavaScript tests;
- all 46 eligible exports, the full cart checker, and cart smoke;
- two fresh-boot Task 10 solution-scoreboard sweeps.

The default-off build must reproduce all 381 Task 10 generated objects
byte-for-byte. The opt-in candidate must preserve game state, commands,
undo/restart/checkpoint, `again`, message, win, and sound behavior.

Memory gates are fixed ROM at or below 8,192 bytes, static WRAM at or below
6,080 bytes, every switchable bank at or below 16,384 bytes, and unchanged
SRAM layout. The candidate must reduce packed payload by at least one byte
and may not increase allocated-bank count or highest used bank.

Task 10 provides exact canary baselines:

| Game | Logic ticks/turn | Interaction ticks/turn | Maximum turn |
| --- | ---: | ---: | ---: |
| `explodoban` | 263.217 | 489.652 | 2,025 |
| `two-step-pete` | 254.909 | 658.091 | 1,247 |

Retain only if both fresh sweeps are deterministic, neither canary game
regresses by more than 1.0% in logic, interaction, or maximum-turn ticks, and
the 46-game weighted logic/interaction totals regress by no more than 0.5%.
Any semantic mismatch, nondeterminism, HOME growth, bank overflow, nonpositive
payload saving, or latency threshold failure rejects the candidate and
removes the opt-in path.

## Explicit non-goals and checkpoint

This plan does not share `generated_facade_rules`, `generated_core`,
specialized rule packs, or compact-facade members that occupy different
banks. It does not parameterize configurations and does not implement dynamic
far calls.

Even if the canary passes, broader facade-rules or core sharing requires a
new evidence checkpoint: refreshed object clusters after the canary, measured
payload savings, Task 10 per-game latency, and an approved design for
descriptor ownership and far-call behavior. Passing this canary alone does
not authorize that work.

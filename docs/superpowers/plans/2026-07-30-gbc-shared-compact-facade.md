# GBC Same-Bank Compact-Facade Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test one default-off, same-bank ASxxxx alias that lets `g21` and
`g31` share their normalized-identical 349-byte compact-facade
implementation without changing runtime calls or context.

**Architecture:** Compile both games normally, prove their compact-facade
objects equivalent under the Task 11 normalization, append `g31` definition
aliases at the matching `g21` addresses, and link only the aliased owner.
Place the owner and both facade-rules callers in one compound `CartItem` so
the existing packer and relocation pass preserve same-bank calls. Reject the
experiment on any structural, semantic, capacity, or latency failure.

**Tech Stack:** Python 3 for ASxxxx rewriting/cart building, C11/SDCC through
GBDK-2020 for the candidate ROM, CMake/CTest and Node/QUnit for parity, and
libmGBA plus the Task 10 scoreboard for hardware-timer measurements.

**Approved design:**
`docs/superpowers/specs/2026-07-30-gbc-shared-compact-facade-design.md`

---

## File map

- Create `scripts/gbc_cart_object_aliases.py`: pure ASxxxx parser, normalized
  equivalence check, and append-only definition aliases.
- Create `scripts/gbc_cart_object_aliases_test.py`: synthetic symbol-count,
  address, byte, call-target, and relocation tests.
- Modify `scripts/build_gbc_cart.py`: default-off canary switch, compound
  facade item, aliased owner, omitted member, and manifest evidence.
- Modify `scripts/build_gbc_cart_test.py`: default identity, canary selection,
  grouping, capacity, and manifest tests.
- Modify `scripts/check_gbc_cart.py`: validate the optional alias manifest
  against linked objects and bank ownership.
- Modify `scripts/check_gbc_cart_test.py`: valid alias and forged/cross-bank
  alias cases.
- Modify `docs/performance/gbc-optimization-ledger.md`: measured verdict.

`pack_items()`, the generated C ABI, firmware, native runtime, and exporter
remain unchanged.

---

### Task 1: Add an append-only ASxxxx alias rewriter

**Files:**

- Create: `scripts/gbc_cart_object_aliases.py`
- Create: `scripts/gbc_cart_object_aliases_test.py`

- [ ] **Step 1: Write the failing exact-alias test**

Create two synthetic objects with:

```text
XL4
H B areas 2 global symbols
M generated_compact_facade
A _CODE_25 size 3 flags 0 addr 0
S _g21_get Def00000001
S _g21_set Def00000002
T 00 00 00 00 3E 02 C9
R 00 00 08 00
```

and the same object at `_CODE_35` with `g31_` definitions. Assert:

```python
merged = merge_namespaced_definitions(
    owner_text, member_text, owner_prefix="g21", member_prefix="g31"
)
assert "H B areas 4 global symbols" in merged
assert "S _g31_get Def00000001" in merged
assert "S _g31_set Def00000002" in merged
assert merged.count("\nT ") == owner_text.count("\nT ")
assert merged.count("\nR ") == owner_text.count("\nR ")
```

Also assert the original owner lines remain in their original order.

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
python3 scripts/gbc_cart_object_aliases_test.py
```

Expected: fail because `gbc_cart_object_aliases` does not exist.

- [ ] **Step 3: Add failing rejection cases**

Before implementation, add one assertion for each rejection:

- unequal `_CODE_N` sizes;
- one changed `T` instruction/constant byte;
- one changed symbol name after removing only `g21_`/`g31_`;
- one changed `R` byte;
- unequal normalized definition addresses;
- an alias name already defined by the owner;
- malformed or overflowing ASxxxx global-symbol count.

Each error message names the violated invariant. Do not normalize a `T` or
`R` byte to make a test pass.

- [ ] **Step 4: Implement the pure rewriter**

Implement:

```python
@dataclass(frozen=True)
class AliasMerge:
    text: str
    aliases: tuple[tuple[str, int], ...]
    implementation_bytes: int
    normalized_sha256: str


def merge_namespaced_definitions(
    owner_text: str,
    member_text: str,
    *,
    owner_prefix: str,
    member_prefix: str,
) -> AliasMerge:
    ...
```

Parse the `H` record, the single nonempty `_CODE_N` area, `S` definitions,
and all `T`/`R` records. Normalize only leading `_g21_` / `b_g21_` owner
symbols and the corresponding leading `_g31_` / `b_g31_` member symbols, the
`_CODE_N` number, and `S` addresses for the equivalence digest. Preserve
interior namespace-like substrings, instruction bytes, constants, remaining
call-target names, symbol order, and relocation bytes. Append aliases after
the owner's last `S` definition and increase the hexadecimal global-symbol
count. Never insert before an existing symbol because `R` records index the
original symbol table.

- [ ] **Step 5: Verify green**

Run:

```bash
python3 scripts/gbc_cart_object_aliases_test.py
python3 scripts/analyze_gbc_cart_sharing_test.py
```

Expected: both print `ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/gbc_cart_object_aliases.py \
  scripts/gbc_cart_object_aliases_test.py
git commit -m "Validate same-bank GBC object aliases"
```

---

### Task 2: Wire the default-off canary into cart construction

**Files:**

- Modify: `scripts/build_gbc_cart.py`
- Modify: `scripts/build_gbc_cart_test.py`

- [ ] **Step 1: Write failing option-boundary tests**

Add parser/build-option tests that assert:

```python
assert options.share_compact_facade_canary is False
assert shared_compact_canary(("g21", "g31"), enabled=False) is None
```

With the option enabled, require exactly the canonical prefixes
`("g21", "g31")`; reject a limited cart that does not contain both.

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
python3 scripts/build_gbc_cart_test.py
```

Expected: fail because the option and canary helper are absent.

- [ ] **Step 3: Add failing compound-item tests**

Construct synthetic `g21`/`g31` facade objects and assert the enabled result
contains exactly:

```python
(
    Path("g21_generated_compact_facade.o"),
    Path("g21_generated_facade_rules.o"),
    Path("g31_generated_facade_rules.o"),
)
```

Assert `g31_generated_compact_facade.o` is absent from link objects, the item
size equals the three retained code areas, and a total above 16,384 bytes is
rejected before `pack_items()`.

- [ ] **Step 4: Implement the canary builder path**

Add `--share-compact-facade-canary`. Continue compiling both ordinary objects
so equivalence is proved from the candidate toolchain. When enabled:

1. call `merge_namespaced_definitions()` with owner `g21` and member `g31`;
2. rewrite only the owner object with the returned text;
3. remove the member compact object from `all_game_objects`;
4. replace the two ordinary facade items with one compound item holding the
   owner compact object and both facade-rules objects;
5. leave `pack_items()` and `relocate_object_code_area()` unchanged.

The default-off branch must execute the existing statements in their existing
order and must not rewrite any object.

- [ ] **Step 5: Emit explicit manifest evidence**

When disabled, emit no sharing field. When enabled, add:

```json
{
  "compact_facade_sharing": {
    "mode": "same-bank-alias-canary-v1",
    "owner": "g21",
    "members": ["g21", "g31"],
    "normalized_sha256": "...",
    "implementation_bytes": 349,
    "gross_removed_bytes": 349,
    "bank": 142,
    "aliases": [
      "g31_ps_gbc_facade_cell_count"
    ]
  }
}
```

Populate `bank` after relocation and list all eight aliases in sorted order.

- [ ] **Step 6: Verify default-off identity**

Build a fresh default cart beside the preserved Task 10 artifact and compare:

```bash
python3 scripts/build_gbc_cart.py \
  --repository . --compiler build/native/puzzlescript_cpp \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --out build/gbc/cart-shared-compact-default
python3 -c 'from pathlib import Path; reference=Path("build/gbc/cart-task10-9dab2dfa/objects"); candidate=Path("build/gbc/cart-shared-compact-default/objects"); names=sorted(path.name for path in reference.glob("g??_generated*.o")); mismatches=[name for name in names if not (candidate/name).is_file() or (reference/name).read_bytes() != (candidate/name).read_bytes()]; assert len(names)==381, len(names); assert not mismatches, mismatches[:10]; print("381/381 generated objects byte-identical")'
```

Expected: `381/381 generated objects byte-identical`.

- [ ] **Step 7: Commit**

```bash
git add scripts/build_gbc_cart.py scripts/build_gbc_cart_test.py
git commit -m "Add opt-in compact-facade sharing canary"
```

---

### Task 3: Make the cart checker prove alias ownership

**Files:**

- Modify: `scripts/check_gbc_cart.py`
- Modify: `scripts/check_gbc_cart_test.py`

- [ ] **Step 1: Write the failing valid-canary test**

Create synthetic owner/caller objects and a manifest with
`same-bank-alias-canary-v1`. Assert the checker passes only when:

- the owner defines all eight owner symbols and all eight member aliases;
- every alias address equals its normalized owner address;
- the member compact object is absent;
- owner and both facade-rules objects have one identical code bank;
- `implementation_bytes == gross_removed_bytes == 349`.

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
python3 scripts/check_gbc_cart_test.py
```

Expected: the synthetic forged candidate is not yet checked.

- [ ] **Step 3: Add negative ownership tests**

Add individual failures for a missing alias, wrong alias address, retained
member object, split caller bank, unknown mode, and a compound bank over
16,384 bytes.

- [ ] **Step 4: Implement the checker**

Keep all existing production checks. If `compact_facade_sharing` is present,
parse definitions from the owner object, compare alias/owner addresses by
normalized suffix, inspect `object_banks`, and emit separate named
`CartCheck`s for alias completeness, same-bank ownership, omitted duplicate,
and recorded bytes. A missing field is the valid default-off state.

- [ ] **Step 5: Verify focused gates**

Run:

```bash
python3 scripts/gbc_cart_object_aliases_test.py
python3 scripts/build_gbc_cart_test.py
python3 scripts/check_gbc_cart_test.py
python3 scripts/analyze_gbc_cart_sharing_test.py
```

Expected: all print `ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/check_gbc_cart.py scripts/check_gbc_cart_test.py
git commit -m "Check GBC shared-facade alias ownership"
```

---

### Task 4: Build and structurally validate the canary

**Files:**

- Modify only if a test exposes a defect in Tasks 1-3.

- [ ] **Step 1: Build the opt-in benchmark cart**

```bash
python3 scripts/build_gbc_cart.py \
  --repository . --compiler build/native/puzzlescript_cpp \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --out build/gbc/cart-shared-compact-canary \
  --benchmark --share-compact-facade-canary
```

Expected: all 46 games link, the member compact object is omitted, and the
manifest reports eight aliases and one common caller/owner bank.

- [ ] **Step 2: Run the structural/capacity checker**

```bash
python3 scripts/check_gbc_cart.py \
  build/gbc/cart-shared-compact-canary/puzzlescript-compilation-benchmark-46.gb \
  build/gbc/cart-shared-compact-canary/cart-manifest.json \
  build/gbc/cart-shared-compact-canary/puzzlescript-compilation-benchmark-46.map \
  build/gbc/cart-shared-compact-canary/objects
```

Expected: all checks pass, HOME is at most 8,192 bytes, static WRAM is at most
6,080 bytes, and no bank exceeds 16,384 bytes.

- [ ] **Step 3: Record the exact size result**

Compare against Task 10 `9dab2dfa` and record packed payload, allocated
payload banks, highest used bank, physical 4 MB headroom, HOME, WRAM, owner
bank used bytes, and the linked alias addresses. Reject and revert Tasks 1-3
if packed payload does not decrease or any capacity metric fails.

- [ ] **Step 4: Run semantic gates**

```bash
cmake --build build --target puzzlescript_cpp puzzlescript_gbc_exporter_tests
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
node src/tests/run_tests_node.js
make gbc_eligible GBC_CONTINUE=1
python3 scripts/build_gbc_cart.py \
  --repository . --compiler build/native/puzzlescript_cpp \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --out build/gbc/cart-shared-compact-canary-smoke \
  --autotest --share-compact-facade-canary
python3 scripts/run_gbc_cart_smoke.py \
  build/gbc/cart-shared-compact-canary-smoke/puzzlescript-compilation-autotest-46.gb \
  build/gbc/cart-shared-compact-canary-smoke/cart-manifest.json
```

Expected: all native GBC tests, all JavaScript tests, 46 eligible exports,
and a boot/relaunch smoke of the full 46-game opt-in cart pass. The smoke
artifact must contain both canary members `g21` and `g31`; the default
nine-game Make target is not evidence for this experiment. Any mismatch
rejects the candidate.

---

### Task 5: Apply the Task 10 latency gate and record the verdict

**Files:**

- Modify: `docs/performance/gbc-optimization-ledger.md`
- Modify: `docs/superpowers/plans/2026-07-30-gbc-shared-compact-facade.md`

- [ ] **Step 1: Run two fresh-boot candidate sweeps**

Reuse the already-built benchmark cart:

```bash
python3 scripts/bench_gbc_cart_solutions.py \
  --repository . --compiler build/native/puzzlescript_cpp \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --reuse-cart \
  --out build/gbc/cart-shared-compact-canary/solution-run1.json
python3 scripts/bench_gbc_cart_solutions.py \
  --repository . --compiler build/native/puzzlescript_cpp \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --reuse-cart \
  --out build/gbc/cart-shared-compact-canary/solution-run2.json
```

Expected: every successful `(logic_ticks, render_ticks, max_turn_ticks)`
tuple and both worst-ten orders match between candidate runs.

- [ ] **Step 2: Compare the canary games and weighted totals**

Compare to Task 10:

| Game | Logic | Interaction | Maximum |
| --- | ---: | ---: | ---: |
| `explodoban` | 263.217 | 489.652 | 2,025 |
| `two-step-pete` | 254.909 | 658.091 | 1,247 |

Reject if either game's logic, interaction, or maximum-turn count regresses
by more than 1.0%, or if weighted 46-game logic/interaction regresses by more
than 0.5%.

- [ ] **Step 3: Record and act on one verdict**

For **retain**, record exact size/memory/timing deltas and mark the canary
complete. State that facade-rules/core expansion remains unauthorized pending
a new evidence checkpoint.

For **reject**, restore the source state before Task 1, retain only the
ledger evidence, and record which structural, size, semantic, or latency gate
failed. Do not leave a disabled alias subsystem.

- [ ] **Step 4: Run final verification**

```bash
git diff --check
git status --short
python3 scripts/gbc_cart_object_aliases_test.py
python3 scripts/build_gbc_cart_test.py
python3 scripts/check_gbc_cart_test.py
python3 scripts/analyze_gbc_cart_sharing_test.py
```

Expected: clean diff, only intentional source/docs changes plus ignored build
artifacts, and all focused tests pass.

- [ ] **Step 5: Commit the measured result**

For a retained result:

```bash
git add scripts docs/performance/gbc-optimization-ledger.md \
  docs/superpowers/plans/2026-07-30-gbc-shared-compact-facade.md
git commit -m "Share one same-bank GBC compact facade"
```

For a rejected result, commit only the ledger/plan conclusion:

```bash
git add docs/performance/gbc-optimization-ledger.md \
  docs/superpowers/plans/2026-07-30-gbc-shared-compact-facade.md
git commit -m "Record rejected GBC facade sharing canary"
```

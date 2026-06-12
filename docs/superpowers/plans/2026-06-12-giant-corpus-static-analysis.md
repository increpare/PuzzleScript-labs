# Giant Corpus Static Analysis Audits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale static-analysis consistency auditing (#1) to the ~30k gist corpus using the same parallel/checkpoint patterns as `fuzz_corpus_batch_giant`, and add original-vs-canonical static tag parity checking (#9) on the mini corpus (CI) plus giant corpus (overnight).

**Architecture:** Extract the violation logic from `static_analysis_claims_consistency_node.js` into a reusable audit module. Add a lightweight analyze-only parallel runner (no engine load — much faster than fuzz). Add a separate canonical parity audit that runs `analyzeSource` on original and round-trip decanonicalized sources and compares projected tags. Defer tag-implication mining (#11) until rules are proposed and approved by Stephen.

**Tech Stack:** Node.js (existing `ps_static_analysis`, `canonicalize`, `decanonicalize`), Makefile sharding vars, reuse patterns from `fuzz_corpus_batch.js` / `fuzz_corpus_batch_parallel.js`.

**Out of scope (explicitly rejected for now):** corpus health dashboard (#2), branch diff gate (#3), automated #11 rule synthesis without human approval.

---

## Current state (answers upfront)

| Idea | Mini corpus (`solver_tests`) today? | Giant corpus today? |
|------|-------------------------------------|-------------------|
| **#1 Cross-family consistency** | Yes — `static_analysis_claims_consistency_node.js` in `make static_analysis_tests` | No |
| **#9 Original vs canonical static tags** | **No** — canonicalization fuzz checks *simulation replay* parity, not `analyzeSource` parity | No |
| **#11 Tag implication mining** | No | No (future; human gate) |

---

## File map

| File | Responsibility |
|------|----------------|
| `src/tests/static_analysis_consistency_audit.js` | Pure functions: given `analyzeSource` report + game label → violations + info stats |
| `src/tests/static_analysis_canonical_parity_audit.js` | Canonical round-trip + tag projection + mismatch detection |
| `src/tests/run_static_analysis_corpus_audit.js` | Single-shard worker: analyze games in index window, write checkpoint/failures |
| `src/tests/run_static_analysis_corpus_parallel.js` | Parallel launcher: sharding, progress.json, partial-run prompt |
| `src/tests/static_analysis_claims_consistency_node.js` | Thin CLI wrapper → audit module (keep `make static_analysis_tests` behavior) |
| `Makefile` | `static_analysis_consistency_giant`, optional `STATIC_ANALYSIS_GIANT_CORPUS` |

---

### Task 1: Extract consistency audit module

**Files:**
- Create: `src/tests/static_analysis_consistency_audit.js`
- Modify: `src/tests/static_analysis_claims_consistency_node.js`
- Test: existing `make static_analysis_tests` (includes consistency node)

- [ ] **Step 1: Create audit module with exported `auditAnalyzedReport`**

Move the violation loop from `static_analysis_claims_consistency_node.js` (lines 51–99) into:

```javascript
'use strict';

function auditAnalyzedReport(report, gameLabel) {
    const violations = [];
    const info = {
        createdButNeverIncreases: 0,
        destroyedButNeverDecreases: 0,
        inertCountChangeDisagreements: 0,
    };
    if (report.status !== 'ok') {
        return { violations, info, skipped: 'compile_error' };
    }
    const tagged = report.ps_tagged;
    const objByName = new Map(tagged.objects.map(object => [object.name, object]));
    // ... existing checks (cosmetic+win, temporary+static, layers, merge candidates) ...
    return { violations, info, skipped: null };
}

function analyzeAndAudit(source, gameLabel, analyzeSource) {
    let report;
    try {
        report = analyzeSource(source, { sourcePath: gameLabel });
    } catch (error) {
        return {
            violations: [`${gameLabel}: analyzeSource threw: ${String(error && error.message).split('\n')[0]}`],
            info: {},
            skipped: 'threw',
        };
    }
    const result = auditAnalyzedReport(report, gameLabel);
    return result;
}

module.exports = { auditAnalyzedReport, analyzeAndAudit };
```

- [ ] **Step 2: Refactor consistency node to use module + `--corpus`**

```javascript
const { analyzeAndAudit } = require('./static_analysis_consistency_audit');
// parse --corpus PATH (default src/tests/solver_tests)
// loop games, aggregate violations/stats, same exit code behavior
```

- [ ] **Step 3: Verify mini corpus unchanged**

Run: `node src/tests/static_analysis_claims_consistency_node.js`  
Expected: `static_analysis_claims_consistency_node: ok` (same as before)

Run: `make static_analysis_tests`  
Expected: all steps pass

- [ ] **Step 4: Commit**

```bash
git add src/tests/static_analysis_consistency_audit.js src/tests/static_analysis_claims_consistency_node.js
git commit -m "refactor: extract static analysis consistency audit module"
```

---

### Task 2: Canonical static tag parity audit (#9)

**Files:**
- Create: `src/tests/static_analysis_canonical_parity_audit.js`
- Create: `src/tests/static_analysis_canonical_parity_node.js`
- Modify: `Makefile` (add to `static_analysis_tests`)

**Comparison strategy (v1 — conservative):**

1. Skip if `canonicalizeSource` unavailable (same skip reasons as `fuzz_canonicalization.js`: random semantics, duplicate collision layers).
2. `canonicalSource = decanonicalizeSemantic(canonicalizeSource(source))`.
3. Run `analyzeSource` on original and on `canonicalSource`.
4. If either fails to analyze, skip (not a parity violation).
5. Project each report to a **tag signature** per object name (sorted object list, compare selected boolean/string tags only — not rule ids or internal graph ids).
6. Compare signatures; mismatch → violation with diff summary.

Tag signature fields (v1):

```javascript
const OBJECT_TAG_KEYS = [
    'cosmetic', 'static', 'temporary', 'is_player', 'is_background',
    'may_be_created', 'may_be_destroyed', 'present_in_some_levels',
];
// quantity.never_increases / never_decreases as nested booleans
```

Also compare global counts: number of merge candidates, number of static layers, wincondition count.

- [ ] **Step 1: Write parity module with fixture test via node script**

Create `static_analysis_canonical_parity_node.js` with one inline fixture from `solver_tests` that is known to canonicalize cleanly (e.g. `castlecloset.txt`), assert parity passes.

Run: `node src/tests/static_analysis_canonical_parity_node.js`  
Expected: `static_analysis_canonical_parity_node: ok`

- [ ] **Step 2: Add corpus loop with `--corpus` defaulting to `solver_tests`**

Same pattern as consistency node.

- [ ] **Step 3: Wire into `make static_analysis_tests`**

Add after consistency node in Makefile `static_analysis_tests` target.

Run: `make static_analysis_tests`  
Expected: pass including new parity node

- [ ] **Step 4: Commit**

```bash
git add src/tests/static_analysis_canonical_parity_audit.js src/tests/static_analysis_canonical_parity_node.js Makefile
git commit -m "feat: add original-vs-canonical static analysis parity audit"
```

---

### Task 3: Analyze-only parallel corpus runner (#1 at scale)

**Files:**
- Create: `src/tests/run_static_analysis_corpus_audit.js`
- Create: `src/tests/run_static_analysis_corpus_parallel.js`
- Reuse: `fuzz_corpus_batch.js` helpers (`listCorpusGames`, `partialRunInstructions`, progress formatting)

**Worker behavior (`run_static_analysis_corpus_audit.js`):**

- Args: `--corpus`, `--start`, `--end`, `--log-dir`, `--shard-id`, `--checks consistency|parity|both`
- Per game: run selected audits, append violations to `failures.jsonl`
- Update `checkpoint.json` after each game (`lastCompletedIndex`)
- No PuzzleScript engine load — only `analyzeSource` + optional canonicalize

**Parallel launcher:**

- Mirror `fuzz_corpus_batch_parallel.js`: 8 shards default, `progress.json` every 15s, partial-run prompt
- Log dir default: `build/static-analysis-audit-giant`
- Aggregate: `aggregate-summary.json` with violation counts by check type

- [ ] **Step 1: Implement single-shard worker**

Run smoke test:

```bash
node src/tests/run_static_analysis_corpus_audit.js \
  --corpus src/tests/solver_tests \
  --start 0 --end 20 \
  --log-dir /tmp/sa-audit-smoke \
  --checks both
```

Expected: completes in seconds, `failures.jsonl` empty or documents known issues

- [ ] **Step 2: Implement parallel launcher**

```bash
node src/tests/run_static_analysis_corpus_parallel.js \
  --corpus src/tests/solver_tests \
  --jobs 4 \
  --log-dir /tmp/sa-audit-parallel
```

Expected: aggregate summary, progress lines with `overall X%`

- [ ] **Step 3: Commit**

```bash
git add src/tests/run_static_analysis_corpus_audit.js src/tests/run_static_analysis_corpus_parallel.js
git commit -m "feat: parallel static analysis corpus audit runner"
```

---

### Task 4: Makefile targets

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add variables**

```makefile
STATIC_ANALYSIS_GIANT_CORPUS ?= $(FUZZ_BATCH_GIANT_CORPUS)
STATIC_ANALYSIS_GIANT_OUT ?= $(BUILD_DIR)/static-analysis-audit-giant
STATIC_ANALYSIS_GIANT_JOBS ?= 8
```

- [ ] **Step 2: Add targets**

```makefile
static_analysis_consistency_giant:
	@$(MAKE) static_analysis_corpus_audit_giant CHECKS=consistency

static_analysis_corpus_audit_giant:
	@mkdir -p "$(STATIC_ANALYSIS_GIANT_OUT)"
	$(NODE) src/tests/run_static_analysis_corpus_parallel.js \
		--corpus "$(STATIC_ANALYSIS_GIANT_CORPUS)" \
		--jobs "$(STATIC_ANALYSIS_GIANT_JOBS)" \
		--checks "$(or $(CHECKS),both)" \
		--log-dir "$(STATIC_ANALYSIS_GIANT_OUT)" \
		$(STATIC_ANALYSIS_FRESH_FLAG)

.PHONY: static_analysis_consistency_giant static_analysis_corpus_audit_giant
```

Update `make help` with one line for `static_analysis_consistency_giant`.

- [ ] **Step 3: Smoke test giant path (optional local verify)**

```bash
make static_analysis_corpus_audit_giant \
  STATIC_ANALYSIS_GIANT_CORPUS=src/tests/solver_tests \
  STATIC_ANALYSIS_GIANT_OUT=/tmp/sa-giant-smoke \
  STATIC_ANALYSIS_GIANT_JOBS=2
```

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat: add make static_analysis_consistency_giant target"
```

---

### Task 5: Document #11 human gate (no automation yet)

**Files:**
- Create: `docs/superpowers/notes/2026-06-12-tag-implication-mining-gate.md`

- [ ] **Step 1: Write short note**

Content:

- #11 may propose new rules for `static_analysis_consistency_audit.js`
- Process: run mining script (future) → produce `proposed-rules.json` with support/violation counts → Stephen approves → rules land in audit module + optional micro-fixture
- No mining script in this plan

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-06-12-tag-implication-mining-gate.md
git commit -m "docs: gate tag-implication mining on human approval"
```

---

## Self-review

| Requirement | Task |
|-------------|------|
| #1 at giant scale | Tasks 1, 3, 4 |
| #9 on mini + giant | Task 2 (CI), Task 3 `--checks both` |
| Skip #2, #3 | Out of scope |
| #11 feeds #1 with approval | Task 5 note only |
| Reuse fuzz batch infra | Task 3 mirrors checkpoint/progress/prompt patterns |

No placeholders remain; all file paths and commands are concrete.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-06-12-giant-corpus-static-analysis.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement tasks in this session with checkpoints

Which approach?

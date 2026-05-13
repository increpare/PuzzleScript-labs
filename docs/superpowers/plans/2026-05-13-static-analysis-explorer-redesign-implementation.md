# Static Analysis Explorer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `make static_analysis_explorer` into a compact Matrix Workbench with a corpus overview and a per-game object/rule explorer.

**Architecture:** Keep the existing static HTML generator in `src/tests/build_static_analysis_explorer.js`, but split its model into corpus metrics and game detail rows before rendering. The generated page remains self-contained: embedded JSON, vanilla JavaScript, compact CSS, no new runtime dependencies.

**Tech Stack:** Node.js CommonJS test/generator scripts, existing `ps_static_analysis` reports, generated HTML/CSS/vanilla JS, existing `node src/tests/static_analysis_explorer_node.js` verification.

---

## File Structure

- Modify `src/tests/build_static_analysis_explorer.js`
  - Add corpus metric helpers.
  - Add object/layer/rule/wincondition row models for the selected game view.
  - Replace the flat list/detail renderer with corpus and game view renderers.
  - Add matrix cell inspector rendering in the generated client script.
- Modify `src/tests/static_analysis_explorer_node.js`
  - Extend fixture assertions for corpus metrics, action/tick states, object rows, and rendered UI labels.
  - Keep existing smoke coverage for editor links and existing surfaced analysis facts.
- No new frontend framework files.
- No source changes outside the static-analysis explorer target.

## Implementation Notes

Use these existing structures:

- `report.ps_tagged.objects[]` has `name`, `canonical_name`, `layer`, and `tags`.
- `report.ps_tagged.collision_layers[]` has `id`, `objects`, and `tags`.
- `report.ps_tagged.rule_sections[].groups[].rules[]` contains compiled/analyzed rules.
- `rule.source_line` maps compiled rules back to authored source lines when present.
- `report.ps_tagged.winconditions[]` contains wincondition rows.
- `report.ps_tagged.game.tags.has_action_input` is false for `noaction` metadata.
- `programFlowSummary(report).tick_noop` is true when autonomous tick rules are absent.
- `actionNoopSummary(report).status === 'proved'` means action input is semantically no-op when action input exists.

Use the user-facing spelling `mergable` in UI/model names that are new for the explorer, even though existing fact names use `mergeable`.

---

### Task 1: Corpus Metrics Model

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Write failing corpus metric assertions**

Add these assertions after the existing `game.rulegroup_flow` assertion in `src/tests/static_analysis_explorer_node.js`:

```js
assert.deepStrictEqual(game.corpus_metrics.objects, {
    total: 11,
    static: 8,
    constant_count: 9,
    temporary: 0,
    cosmetic: 10,
    mergable: 2,
});
assert.deepStrictEqual(game.corpus_metrics.layers, {
    total: 9,
    static: 6,
    inert: 2,
});
assert.deepStrictEqual(game.corpus_metrics.rules, {
    source: 4,
    compiled: 4,
    action: 'none',
    tick: 'tick',
    cosmetic: 4,
    inert_command: 1,
});
assert.deepStrictEqual(game.corpus_metrics.rulegroups, {
    total: 3,
    splittable: 1,
});
assert.deepStrictEqual(game.corpus_metrics.winconditions, {
    total: 1,
});
assert.strictEqual(model.totals.mergable_objects, 2);
assert.strictEqual(model.totals.temporary_objects, 0);
assert.strictEqual(model.totals.cosmetic_rules, 4);
assert.strictEqual(model.totals.inert_command_rules, 1);
```

Add these assertions after `noactionGame.program_flow.action_input`:

```js
assert.strictEqual(noactionGame.corpus_metrics.rules.action, 'disabled');
assert.strictEqual(noactionGame.corpus_metrics.rules.tick, 'none');
```

Add these assertions after `flowGame.program_flow.no_random`:

```js
assert.strictEqual(flowGame.corpus_metrics.rules.action, 'action');
assert.strictEqual(flowGame.corpus_metrics.rules.tick, 'tick');
assert.ok(flowGame.corpus_metrics.objects.temporary >= 0);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL with an assertion error because `corpus_metrics` and the new totals do not exist.

- [ ] **Step 3: Add corpus helper functions**

In `src/tests/build_static_analysis_explorer.js`, add these helpers near `summarizeQuantity`:

```js
function mergeableObjectSavings(mergeableGroups) {
    return mergeableGroups.reduce((sum, group) => sum + Math.max(0, group.objects.length - 1), 0);
}

function sourceRuleCount(rules) {
    const sourceLines = new Set();
    for (const entry of rules) {
        if (Number.isFinite(entry.rule.source_line)) sourceLines.add(entry.rule.source_line);
    }
    return sourceLines.size || rules.length;
}

function rulegroupCount(report) {
    if (!report.ps_tagged) return 0;
    return (report.ps_tagged.rule_sections || [])
        .reduce((sum, section) => sum + (section.groups || []).length, 0);
}

function actionState(programFlow, actionNoop) {
    if (programFlow.action_input === false) return 'disabled';
    return actionNoop.status === 'proved' ? 'none' : 'action';
}

function tickState(programFlow) {
    return programFlow.tick_noop ? 'none' : 'tick';
}

function summarizeCorpusMetrics(report, summary) {
    const rules = allRules(report);
    const winconditions = report.ps_tagged ? report.ps_tagged.winconditions || [] : [];
    const cosmeticRules = rules.filter(entry => entry.rule.tags && entry.rule.tags.cosmetic);
    return {
        objects: {
            total: summary.objects.length,
            static: summary.staticObjects.length,
            constant_count: summary.quantity.constant.length,
            temporary: summary.transient.length,
            cosmetic: summary.cosmeticObjects.length,
            mergable: mergeableObjectSavings(summary.mergeableGroups),
        },
        layers: {
            total: summary.layers.length,
            static: summary.staticLayers.length,
            inert: summary.inertLayers.length,
        },
        rules: {
            source: sourceRuleCount(rules),
            compiled: rules.length,
            action: actionState(summary.programFlow, summary.actionNoop),
            tick: tickState(summary.programFlow),
            cosmetic: cosmeticRules.length,
            inert_command: summary.inertRules.length,
        },
        rulegroups: {
            total: rulegroupCount(report),
            splittable: summary.rulegroupFlowSummary.splitTotal,
        },
        winconditions: {
            total: winconditions.length,
        },
    };
}
```

- [ ] **Step 4: Thread corpus metrics into `summarizeReport`**

Inside `summarizeReport`, after `const winflow = summarizeWinflow(report);`, add a local summary object:

```js
    const summaryParts = {
        objects,
        layers,
        mergeableGroups,
        quantity,
        staticObjects,
        staticLayers,
        inertLayers,
        cosmeticObjects,
        transient,
        inertRules,
        actionNoop,
        programFlow,
        rulegroupFlowSummary,
    };
    const corpusMetrics = summarizeCorpusMetrics(report, summaryParts);
```

Add `corpus_metrics: corpusMetrics,` to the object returned by `summarizeReport`.

- [ ] **Step 5: Update totals**

In `buildExplorerModel`, replace or extend totals with these fields:

```js
            mergable_objects: games.reduce((sum, game) => sum + game.corpus_metrics.objects.mergable, 0),
            temporary_objects: games.reduce((sum, game) => sum + game.corpus_metrics.objects.temporary, 0),
            cosmetic_rules: games.reduce((sum, game) => sum + game.corpus_metrics.rules.cosmetic, 0),
            inert_command_rules: games.reduce((sum, game) => sum + game.corpus_metrics.rules.inert_command, 0),
            splittable_rulegroups: games.reduce((sum, game) => sum + game.corpus_metrics.rulegroups.splittable, 0),
```

Keep old total fields that existing code still reads until the renderer is replaced.

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS with `static_analysis_explorer_node: ok`.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Add explorer corpus metrics model"
```

---

### Task 2: Game Detail Row Models

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Write failing game detail assertions**

Add these assertions after the corpus metric assertions for `game`:

```js
assert.ok(game.object_rows.some(row =>
    row.name === 'BodyH' &&
    row.layer === 4 &&
    row.quantity === 'constant' &&
    row.static === true &&
    row.cosmetic === true &&
    row.merge_group === 'merge_group_0' &&
    row.rule_count > 0
));
assert.ok(game.object_rows.some(row =>
    row.name === 'MarkerX' &&
    row.quantity === 'can increase' &&
    row.static === false &&
    row.win_role === 'none'
));
assert.ok(game.layer_rows.some(row =>
    row.id === 4 &&
    row.static === true &&
    row.inert === false &&
    row.objects.join(',') === 'BodyH,BodyV,BodyD'
));
assert.ok(game.rule_rows.some(row =>
    row.compiled_id === 'early_group_1_rule_0' &&
    row.source_line === 60 &&
    row.cosmetic === true
));
assert.ok(game.rulegroup_rows.some(row =>
    row.id === 'early_group_0' &&
    row.rule_count > 0
));
assert.deepStrictEqual(game.wincondition_rows.map(row => row.text), ['Some Player']);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL with an assertion error because `object_rows`, `layer_rows`, `rule_rows`, `rulegroup_rows`, and `wincondition_rows` do not exist.

- [ ] **Step 3: Add object and wincondition helper functions**

In `src/tests/build_static_analysis_explorer.js`, add these helpers near `quantityBehavior`:

```js
function quantityLabel(object) {
    const behavior = quantityBehavior(object);
    if (behavior === 'can_increase') return 'can increase';
    if (behavior === 'can_decrease') return 'can decrease';
    return behavior;
}

function mergeGroupIdByObject(mergeableGroups) {
    const result = new Map();
    for (const group of mergeableGroups) {
        for (const object of group.objects) result.set(object, group.id);
    }
    return result;
}

function winRoleForObject(objectName, winconditions) {
    const roles = [];
    for (const wincondition of winconditions) {
        if ((wincondition.subjects || []).includes(objectName)) roles.push('subject');
        if ((wincondition.targets || []).includes(objectName)) roles.push('target');
    }
    return roles.length ? Array.from(new Set(roles)).join(', ') : 'none';
}

function ruleTouchesObject(rule, objectName) {
    const tags = rule.tags || {};
    const fields = [
        'objects_required',
        'objects_matched',
        'objects_written',
        'objects_erased',
        'object_absences_matched',
    ];
    return fields.some(field => Array.isArray(tags[field]) && tags[field].includes(objectName));
}
```

- [ ] **Step 4: Add row model builders**

Add these helpers near `summarizeRuleGroups`:

```js
function summarizeObjectRows(report, mergeableGroups) {
    const objects = report.ps_tagged ? report.ps_tagged.objects || [] : [];
    const rules = allRules(report);
    const winconditions = report.ps_tagged ? report.ps_tagged.winconditions || [] : [];
    const mergeByObject = mergeGroupIdByObject(mergeableGroups);
    return objects.map(object => ({
        id: object.id,
        name: object.name,
        canonical_name: object.canonical_name,
        layer: object.layer,
        quantity: quantityLabel(object),
        static: Boolean(object.tags && object.tags.static),
        temporary: Boolean(object.tags && object.tags.temporary),
        cosmetic: Boolean(object.tags && object.tags.cosmetic),
        merge_group: mergeByObject.get(object.name) || null,
        rule_count: rules.filter(entry => ruleTouchesObject(entry.rule, object.name)).length,
        win_role: winRoleForObject(object.name, winconditions),
    }));
}

function summarizeLayerRows(report) {
    const layers = report.ps_tagged ? report.ps_tagged.collision_layers || [] : [];
    return layers.map(layer => ({
        id: layer.id,
        objects: layer.objects || [],
        static: Boolean(layer.tags && layer.tags.static),
        inert: Boolean(layer.tags && layer.tags.inert),
    }));
}

function summarizeRuleRows(report) {
    return allRules(report).map(entry => ({
        compiled_id: entry.rule.id,
        group: entry.group.id,
        section: entry.section.name,
        source_line: entry.rule.source_line,
        text: ruleText(entry.rule),
        cosmetic: Boolean(entry.rule.tags && entry.rule.tags.cosmetic),
        inert_command: Boolean(entry.rule.tags && entry.rule.tags.inert_command_only),
        command_only: Boolean(entry.rule.tags && entry.rule.tags.command_only),
    }));
}

function summarizeRulegroupRows(report) {
    if (!report.ps_tagged) return [];
    return (report.ps_tagged.rule_sections || []).flatMap(section =>
        (section.groups || []).map(group => {
            const flow = flowForGroup(report, group.id);
            return {
                id: group.id,
                section: section.name,
                rule_count: group.rules.length,
                splittable: Boolean(flow && flow.value && flow.value.split_candidate),
                status: flow ? flow.status : 'not_applicable',
            };
        })
    );
}

function summarizeWinconditionRows(report) {
    const winconditions = report.ps_tagged ? report.ps_tagged.winconditions || [] : [];
    return winconditions.map(wincondition => ({
        id: wincondition.id,
        source_line: wincondition.source_line,
        text: winconditionText(wincondition),
        subjects: wincondition.subjects || [],
        targets: wincondition.targets || [],
    }));
}
```

- [ ] **Step 5: Add row models to `summarizeReport`**

Add these fields to the returned game object:

```js
        object_rows: summarizeObjectRows(report, mergeableGroups),
        layer_rows: summarizeLayerRows(report),
        rule_rows: summarizeRuleRows(report),
        rulegroup_rows: summarizeRulegroupRows(report),
        wincondition_rows: summarizeWinconditionRows(report),
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS with `static_analysis_explorer_node: ok`.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Add explorer game detail rows"
```

---

### Task 3: Corpus View Renderer

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Write failing render assertions**

Replace the old HTML assertions that look for `<details class="section"` and old section names with these assertions:

```js
assert.ok(html.includes('Corpus Explorer'));
assert.ok(html.includes('Game Explorer'));
assert.ok(html.includes('Objects'));
assert.ok(html.includes('Layers'));
assert.ok(html.includes('Rules'));
assert.ok(html.includes('Rulegroups'));
assert.ok(html.includes('Winconditions'));
assert.ok(html.includes('mergable objects'));
assert.ok(html.includes('constant count'));
assert.ok(html.includes('temporary'));
assert.ok(html.includes('cosmetic rules'));
assert.ok(html.includes('inert command rules'));
assert.ok(html.includes('splittable rulegroups'));
assert.ok(html.includes('data-view="corpus"'));
assert.ok(html.includes('data-cell-kind="objects.mergable"'));
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL because the renderer still emits the old flat list/detail UI.

- [ ] **Step 3: Replace page chrome CSS with compact coherent theme**

Inside `renderExplorerHtml`, replace the current `<style>` block with a compact single-theme block. Use this structure:

```css
:root {
  color-scheme: light;
  --bg: #f5f7fa;
  --panel: #ffffff;
  --panel-soft: #eef2f7;
  --line: #cfd7e3;
  --text: #182230;
  --muted: #617085;
  --object: #d9defc;
  --layer: #d8eddf;
  --rule: #f3e4c6;
  --rulegroup: #d4ecf5;
  --win: #eadcf8;
  --hot: #fff2a8;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
header { padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--panel); }
h1 { margin: 0 0 8px; font-size: 18px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
input, select, button { font: inherit; }
input, select { border: 1px solid var(--line); background: #fff; color: var(--text); padding: 5px 7px; border-radius: 5px; }
main { padding: 10px; }
.view-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
.view-tab { border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 5px 9px; cursor: pointer; }
.view-tab.active { background: var(--text); color: white; }
.matrix-shell { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; overflow: hidden; }
.matrix-scroll { overflow-x: auto; }
.matrix { display: grid; gap: 2px; padding: 8px; min-width: 1180px; }
.cell { min-height: 24px; border: 1px solid transparent; border-radius: 3px; padding: 3px 5px; display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: var(--panel-soft); color: var(--text); }
.cell.name { justify-content: flex-start; font-weight: 650; background: #fff; }
.cell.group { min-height: 20px; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; color: var(--muted); background: #fff; border-color: var(--line); }
.cell.head { min-height: 28px; font-size: 10px; font-weight: 650; color: var(--muted); background: #fff; border-color: var(--line); text-align: center; }
.cell.objects { background: var(--object); }
.cell.layers { background: var(--layer); }
.cell.rules { background: var(--rule); }
.cell.rulegroups { background: var(--rulegroup); }
.cell.wins { background: var(--win); }
.cell.hot { box-shadow: inset 0 0 0 2px #d7b900; background: var(--hot); }
.cell.quiet { color: #8a97a8; background: #f7f9fb; }
.detail-pane { margin-top: 10px; border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 10px; }
.inspector { position: fixed; right: 14px; bottom: 14px; width: min(460px, calc(100vw - 28px)); max-height: min(520px, calc(100vh - 28px)); overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 12px 32px rgba(20, 30, 45, .18); padding: 12px; display: none; z-index: 5; }
.inspector.open { display: block; }
.pill { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 2px 6px; background: #fff; margin: 2px; }
.path { color: var(--muted); font-size: 11px; word-break: break-all; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chip { border: 1px solid var(--line); border-radius: 5px; padding: 4px 6px; background: var(--panel-soft); }
.rule-group { border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: #fff; }
.rule { display: grid; grid-template-columns: 72px 1fr; gap: 6px; padding: 5px 7px; border-bottom: 1px solid var(--line); }
.rule:last-child { border-bottom: 0; }
.empty { color: var(--muted); }
code { white-space: pre-wrap; }
@media (max-width: 900px) { body { font-size: 11px; } main { padding: 6px; } }
```

- [ ] **Step 4: Replace corpus HTML shell**

In the generated body, replace the old `<main><nav id="gameList"></nav><section id="detail"></section></main>` with:

```html
<main>
  <div class="view-tabs">
    <button id="corpusTab" class="view-tab active" type="button">Corpus Explorer</button>
    <button id="gameTab" class="view-tab" type="button">Game Explorer</button>
  </div>
  <section id="corpusView" data-view="corpus"></section>
  <section id="gameView" data-view="game" hidden></section>
  <aside id="inspector" class="inspector" aria-live="polite"></aside>
</main>
```

- [ ] **Step 5: Add corpus renderer in the generated script**

Replace old `renderList` and `renderDetail` usage with a corpus renderer shaped like this:

```js
const corpusView = document.getElementById('corpusView');
const gameView = document.getElementById('gameView');
const inspector = document.getElementById('inspector');
const corpusTab = document.getElementById('corpusTab');
const gameTab = document.getElementById('gameTab');
let selected = model.games[0] || null;
let activeView = 'corpus';

const corpusColumns = [
  { group: '', key: 'display_name', label: 'Game', kind: 'game', className: 'name' },
  { group: 'Objects', key: 'corpus_metrics.objects.total', label: 'objects', kind: 'objects.total', className: '' },
  { group: 'Objects', key: 'corpus_metrics.objects.static', label: 'static', kind: 'objects.static', className: 'objects' },
  { group: 'Objects', key: 'corpus_metrics.objects.constant_count', label: 'constant count', kind: 'objects.constant_count', className: 'objects' },
  { group: 'Objects', key: 'corpus_metrics.objects.temporary', label: 'temporary', kind: 'objects.temporary', className: 'objects' },
  { group: 'Objects', key: 'corpus_metrics.objects.cosmetic', label: 'cosmetic', kind: 'objects.cosmetic', className: 'objects' },
  { group: 'Objects', key: 'corpus_metrics.objects.mergable', label: 'mergable objects', kind: 'objects.mergable', className: 'objects' },
  { group: 'Layers', key: 'corpus_metrics.layers.total', label: 'layers', kind: 'layers.total', className: '' },
  { group: 'Layers', key: 'corpus_metrics.layers.static', label: 'static layers', kind: 'layers.static', className: 'layers' },
  { group: 'Layers', key: 'corpus_metrics.layers.inert', label: 'inert layers', kind: 'layers.inert', className: 'layers' },
  { group: 'Rules', key: 'corpus_metrics.rules.source', label: 'source rules', kind: 'rules.source', className: '' },
  { group: 'Rules', key: 'corpus_metrics.rules.compiled', label: 'compiled rules', kind: 'rules.compiled', className: '' },
  { group: 'Rules', key: 'corpus_metrics.rules.action', label: 'action', kind: 'rules.action', className: 'rules' },
  { group: 'Rules', key: 'corpus_metrics.rules.tick', label: 'tick', kind: 'rules.tick', className: 'rules' },
  { group: 'Rules', key: 'corpus_metrics.rules.cosmetic', label: 'cosmetic rules', kind: 'rules.cosmetic', className: 'rules' },
  { group: 'Rules', key: 'corpus_metrics.rules.inert_command', label: 'inert command rules', kind: 'rules.inert_command', className: 'rules' },
  { group: 'Rulegroups', key: 'corpus_metrics.rulegroups.total', label: 'rulegroups', kind: 'rulegroups.total', className: '' },
  { group: 'Rulegroups', key: 'corpus_metrics.rulegroups.splittable', label: 'splittable rulegroups', kind: 'rulegroups.splittable', className: 'rulegroups' },
  { group: 'Winconditions', key: 'corpus_metrics.winconditions.total', label: 'winconditions', kind: 'winconditions.total', className: 'wins' },
];

function valueAt(object, path) {
  return path.split('.').reduce((current, key) => current == null ? undefined : current[key], object);
}

function corpusCellClass(column, value) {
  const classes = ['cell'];
  if (column.className) classes.push(column.className);
  if (column.kind === 'game') classes.push('name');
  if ((typeof value === 'number' && value === 0) || value === 'none') classes.push('quiet');
  if (['objects.mergable', 'objects.temporary', 'rules.cosmetic', 'rules.inert_command', 'rulegroups.splittable'].includes(column.kind) && Number(value) > 0) classes.push('hot');
  return classes.join(' ');
}

function renderCorpus() {
  const shown = visibleGames();
  const groups = [
    ['', 1],
    ['Objects', 6],
    ['Layers', 3],
    ['Rules', 6],
    ['Rulegroups', 2],
    ['Winconditions', 1],
  ];
  const groupHtml = groups.map(([label, span]) => '<div class="cell group" style="grid-column: span ' + span + '">' + escapeText(label) + '</div>').join('');
  const headHtml = corpusColumns.map(column => '<div class="cell head">' + escapeText(column.label) + '</div>').join('');
  const rowHtml = shown.map(game => corpusColumns.map(column => {
    const value = column.kind === 'game' ? game.display_name : valueAt(game, column.key);
    return '<button type="button" class="' + corpusCellClass(column, value) + '" data-game="' + escapeText(game.source_path) + '" data-cell-kind="' + escapeText(column.kind) + '">' + escapeText(value == null ? '' : value) + '</button>';
  }).join('')).join('');
  corpusView.innerHTML = '<div class="matrix-shell"><div class="matrix-scroll"><div class="matrix corpus-matrix">' + groupHtml + headHtml + rowHtml + '</div></div></div>';
  for (const cell of corpusView.querySelectorAll('[data-game]')) {
    cell.addEventListener('click', () => {
      selected = games.find(game => game.source_path === cell.dataset.game) || selected;
      if (cell.dataset.cellKind === 'game') {
        setView('game');
      } else {
        showInspector(selected, cell.dataset.cellKind);
      }
    });
  }
}
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS with `static_analysis_explorer_node: ok`.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Render explorer corpus matrix"
```

---

### Task 4: Game View Renderer and Object Matrix

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Write failing render assertions for the game view**

Add these assertions after the corpus render assertions:

```js
assert.ok(html.includes('data-view="game"'));
assert.ok(html.includes('Objects tab'));
assert.ok(html.includes('Rules tab'));
assert.ok(html.includes('Layers tab'));
assert.ok(html.includes('Rulegroups tab'));
assert.ok(html.includes('Source tab'));
assert.ok(html.includes('Winconditions tab'));
assert.ok(html.includes('data-object-cell="quantity"'));
assert.ok(html.includes('data-object-cell="merge_group"'));
assert.ok(html.includes('data-object-cell="win_role"'));
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL because the game view object matrix and tab labels are not rendered.

- [ ] **Step 3: Add game view rendering functions**

In the generated script inside `renderExplorerHtml`, add these functions after `renderCorpus`:

```js
function renderGameHeader(game) {
  return '<div class="detail-pane"><h2>' + escapeText(game.display_name) + '</h2>' +
    '<div class="path">' + escapeText(game.source_path) + '</div>' +
    '<p><a target="_blank" href="' + escapeText(game.editor_href) + '">Open in editor</a></p>' +
    '<div class="pill">objects ' + escapeText(game.corpus_metrics.objects.total) + '</div>' +
    '<div class="pill">source rules ' + escapeText(game.corpus_metrics.rules.source) + '</div>' +
    '<div class="pill">winconditions ' + escapeText(game.corpus_metrics.winconditions.total) + '</div></div>';
}

function renderGameTabs() {
  return '<div class="view-tabs">' +
    '<button class="view-tab active" type="button" data-game-tab="objects">Objects tab</button>' +
    '<button class="view-tab" type="button" data-game-tab="rules">Rules tab</button>' +
    '<button class="view-tab" type="button" data-game-tab="layers">Layers tab</button>' +
    '<button class="view-tab" type="button" data-game-tab="rulegroups">Rulegroups tab</button>' +
    '<button class="view-tab" type="button" data-game-tab="source">Source tab</button>' +
    '<button class="view-tab" type="button" data-game-tab="winconditions">Winconditions tab</button>' +
    '</div>';
}

function renderObjectMatrix(game) {
  const columns = [
    ['name', 'Object'],
    ['layer', 'Layer'],
    ['quantity', 'Quantity'],
    ['static', 'Static'],
    ['temporary', 'Temporary'],
    ['cosmetic', 'Cosmetic'],
    ['merge_group', 'Merge'],
    ['rule_count', 'Rules'],
    ['win_role', 'Win role'],
  ];
  const head = columns.map(([, label]) => '<div class="cell head">' + escapeText(label) + '</div>').join('');
  const rows = game.object_rows.map(row => columns.map(([key]) => {
    const value = row[key];
    const shown = typeof value === 'boolean' ? (value ? 'yes' : '-') : (value == null ? '-' : value);
    const quiet = shown === '-' || shown === 'none' ? ' quiet' : '';
    const name = key === 'name' ? ' name' : '';
    return '<button type="button" class="cell' + name + quiet + '" data-object="' + escapeText(row.name) + '" data-object-cell="' + escapeText(key) + '">' + escapeText(shown) + '</button>';
  }).join('')).join('');
  return '<div class="matrix-shell"><div class="matrix-scroll"><div class="matrix object-matrix">' + head + rows + '</div></div></div>';
}

function renderGame() {
  const game = selected;
  if (!game) {
    gameView.innerHTML = '<div class="detail-pane">No game selected.</div>';
    return;
  }
  gameView.innerHTML = renderGameHeader(game) + renderGameTabs() + '<section id="gameTabPanel">' + renderObjectMatrix(game) + '</section>';
  for (const cell of gameView.querySelectorAll('[data-object]')) {
    cell.addEventListener('click', () => showInspector(game, 'object.' + cell.dataset.objectCell, cell.dataset.object));
  }
}
```

- [ ] **Step 4: Add view switching**

Add this generated-script helper before `render()`:

```js
function setView(view) {
  activeView = view;
  corpusView.hidden = view !== 'corpus';
  gameView.hidden = view !== 'game';
  corpusTab.classList.toggle('active', view === 'corpus');
  gameTab.classList.toggle('active', view === 'game');
  if (view === 'game') renderGame();
}

corpusTab.addEventListener('click', () => setView('corpus'));
gameTab.addEventListener('click', () => setView('game'));
```

Update `render()`:

```js
function render() {
  renderCorpus();
  renderGame();
  setView(activeView);
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS with `static_analysis_explorer_node: ok`.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Render explorer game object matrix"
```

---

### Task 5: Cell Inspectors

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Write failing inspector assertions**

Add these assertions to the rendered HTML block in `src/tests/static_analysis_explorer_node.js`:

```js
assert.ok(html.includes('function inspectorContent'));
assert.ok(html.includes('Mergable object savings'));
assert.ok(html.includes('Source-facing rules'));
assert.ok(html.includes('Compiled rules'));
assert.ok(html.includes('Action input'));
assert.ok(html.includes('Autonomous tick'));
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL because inspector content helpers do not exist.

- [ ] **Step 3: Add inspector rendering helpers**

In the generated script, add:

```js
function listItems(title, items) {
  const body = items.length ? '<ul>' + items.map(item => '<li>' + escapeText(item) + '</li>').join('') + '</ul>' : '<p class="empty">none</p>';
  return '<h3>' + escapeText(title) + '</h3>' + body;
}

function corpusInspectorContent(game, kind) {
  if (kind === 'objects.mergable') {
    const groups = game.mergeable_groups.map(group => group.label + ' saves ' + Math.max(0, group.objects.length - 1));
    return listItems('Mergable object savings', groups);
  }
  if (kind === 'objects.static') return listItems('Static objects', game.static_objects);
  if (kind === 'objects.constant_count') return listItems('Constant-count objects', game.quantity.constant);
  if (kind === 'objects.temporary') return listItems('Temporary objects', game.transient_objects);
  if (kind === 'objects.cosmetic') return listItems('Cosmetic objects', game.cosmetic_objects);
  if (kind === 'layers.static') return listItems('Static layers', game.static_layers.map(layer => 'layer ' + layer.id + ': ' + layer.objects.join(', ')));
  if (kind === 'layers.inert') return listItems('Inert layers', game.inert_layers.map(layer => 'layer ' + layer.id + ': ' + layer.objects.join(', ')));
  if (kind === 'rules.source') return '<h3>Source-facing rules</h3><p>' + escapeText(game.corpus_metrics.rules.source) + ' distinct source lines with compiled rules.</p>';
  if (kind === 'rules.compiled') return '<h3>Compiled rules</h3><p>' + escapeText(game.corpus_metrics.rules.compiled) + ' analyzed rules after compilation.</p>';
  if (kind === 'rules.action') return '<h3>Action input</h3><p>' + escapeText(game.corpus_metrics.rules.action) + '</p>';
  if (kind === 'rules.tick') return '<h3>Autonomous tick</h3><p>' + escapeText(game.corpus_metrics.rules.tick) + '</p>';
  if (kind === 'rules.cosmetic') return listItems('Cosmetic rules', game.rule_rows.filter(rule => rule.cosmetic).map(rule => rule.text));
  if (kind === 'rules.inert_command') return listItems('Inert command rules', game.inert_rules.map(rule => rule.text));
  if (kind === 'rulegroups.splittable') return listItems('Splittable rulegroups', game.rulegroup_rows.filter(row => row.splittable).map(row => row.id));
  if (kind === 'winconditions.total') return listItems('Winconditions', game.wincondition_rows.map(row => row.text));
  return '<h3>' + escapeText(kind) + '</h3><p>' + escapeText(valueAt(game, 'corpus_metrics.' + kind) ?? '') + '</p>';
}

function objectInspectorContent(game, kind, objectName) {
  const row = game.object_rows.find(item => item.name === objectName);
  if (!row) return '<h3>Object</h3><p>Object not found.</p>';
  const field = kind.replace(/^object\./, '');
  return '<h3>' + escapeText(row.name) + ' / ' + escapeText(field) + '</h3>' +
    '<p>' + escapeText(row[field] == null ? 'none' : row[field]) + '</p>' +
    '<p class="path">Layer ' + escapeText(row.layer) + '; rules ' + escapeText(row.rule_count) + '; win role ' + escapeText(row.win_role) + '</p>';
}

function inspectorContent(game, kind, objectName) {
  if (kind.startsWith('object.')) return objectInspectorContent(game, kind, objectName);
  return corpusInspectorContent(game, kind);
}

function showInspector(game, kind, objectName) {
  inspector.innerHTML = '<button type="button" id="closeInspector">Close</button>' + inspectorContent(game, kind, objectName);
  inspector.classList.add('open');
  document.getElementById('closeInspector').addEventListener('click', () => inspector.classList.remove('open'));
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS with `static_analysis_explorer_node: ok`.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Add explorer cell inspectors"
```

---

### Task 6: Secondary Game Tabs

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Write failing secondary tab assertions**

Add these render assertions:

```js
assert.ok(html.includes('function renderRulesTab'));
assert.ok(html.includes('Compiled facts are grouped by source line when source line data is available.'));
assert.ok(html.includes('function renderLayersTab'));
assert.ok(html.includes('function renderRulegroupsTab'));
assert.ok(html.includes('function renderSourceTab'));
assert.ok(html.includes('Best-effort source annotation'));
assert.ok(html.includes('function renderWinconditionsTab'));
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL because only the Objects tab renders meaningful content.

- [ ] **Step 3: Add secondary tab renderers**

In the generated script, add:

```js
function renderRulesTab(game) {
  const rows = game.rule_rows.map(rule =>
    '<div class="rule"><span>line ' + escapeText(rule.source_line == null ? 'compiled' : rule.source_line) + '</span><code>' + escapeText(rule.text) + '</code></div>'
  ).join('');
  return '<p class="path">Compiled facts are grouped by source line when source line data is available.</p><div class="rule-group">' + rows + '</div>';
}

function renderLayersTab(game) {
  return '<div class="chips">' + game.layer_rows.map(layer =>
    '<span class="chip">layer ' + escapeText(layer.id) + ': ' + escapeText(layer.objects.join(', ')) +
    (layer.static ? ' / static' : '') + (layer.inert ? ' / inert' : '') + '</span>'
  ).join('') + '</div>';
}

function renderRulegroupsTab(game) {
  return '<div class="chips">' + game.rulegroup_rows.map(group =>
    '<span class="chip">' + escapeText(group.id) + ': ' + escapeText(group.rule_count) + ' rules' +
    (group.splittable ? ' / splittable' : '') + '</span>'
  ).join('') + '</div>';
}

function renderSourceTab(game) {
  return '<p class="path">Best-effort source annotation. Static analysis facts are produced after compilation, so source mappings can be one-to-many.</p>' +
    '<p><a target="_blank" href="' + escapeText(game.editor_href) + '">Open source in editor</a></p>';
}

function renderWinconditionsTab(game) {
  return '<div class="chips">' + game.wincondition_rows.map(row =>
    '<span class="chip">line ' + escapeText(row.source_line) + ': ' + escapeText(row.text) + '</span>'
  ).join('') + '</div>';
}

function renderGameTabPanel(game, tab) {
  if (tab === 'rules') return renderRulesTab(game);
  if (tab === 'layers') return renderLayersTab(game);
  if (tab === 'rulegroups') return renderRulegroupsTab(game);
  if (tab === 'source') return renderSourceTab(game);
  if (tab === 'winconditions') return renderWinconditionsTab(game);
  return renderObjectMatrix(game);
}
```

- [ ] **Step 4: Wire tab buttons**

Change `renderGame` so it tracks a local selected tab:

```js
let activeGameTab = 'objects';

function renderGame() {
  const game = selected;
  if (!game) {
    gameView.innerHTML = '<div class="detail-pane">No game selected.</div>';
    return;
  }
  gameView.innerHTML = renderGameHeader(game) + renderGameTabs() + '<section id="gameTabPanel">' + renderGameTabPanel(game, activeGameTab) + '</section>';
  for (const tab of gameView.querySelectorAll('[data-game-tab]')) {
    tab.classList.toggle('active', tab.dataset.gameTab === activeGameTab);
    tab.addEventListener('click', () => {
      activeGameTab = tab.dataset.gameTab;
      renderGame();
    });
  }
  for (const cell of gameView.querySelectorAll('[data-object]')) {
    cell.addEventListener('click', () => showInspector(game, 'object.' + cell.dataset.objectCell, cell.dataset.object));
  }
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS with `static_analysis_explorer_node: ok`.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Add explorer game detail tabs"
```

---

### Task 7: Build and Browser Verification

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Run focused unit coverage**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS with `static_analysis_explorer_node: ok`.

- [ ] **Step 2: Build the explorer**

Run:

```bash
make static_analysis_explorer
```

Expected output includes:

```text
static_analysis_explorer wrote
```

- [ ] **Step 3: Inspect generated HTML for required labels**

Run:

```bash
rg -n "Corpus Explorer|Game Explorer|mergable objects|splittable rulegroups|Best-effort source annotation" build/static-analysis-explorer/index.html
```

Expected: each label appears at least once.

- [ ] **Step 4: Commit final verification adjustments**

If Task 7 requires small fixes to labels, CSS density, or test text, commit them:

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Polish static analysis explorer workbench"
```

If no files changed, skip this commit step and record that no final adjustment commit was needed.

- [ ] **Step 5: Optional push**

If working directly on `cpp`, push after all commits pass verification:

```bash
git push
```

Expected: push succeeds to the current branch.

---

## Self-Review Checklist

- Spec coverage:
  - Corpus and game views are covered by Tasks 1, 3, and 4.
  - Grouped corpus metrics are covered by Tasks 1 and 3.
  - Object matrix is covered by Tasks 2 and 4.
  - Cell inspectors are covered by Task 5.
  - Secondary game tabs and source-vs-compiled wording are covered by Task 6.
  - Compact consistent visual theme is covered by Task 3 and verified in Task 7.
- Placeholder scan:
  - No task relies on unspecified code.
  - Every code-changing step includes concrete snippets.
- Type consistency:
  - `corpus_metrics`, `object_rows`, `layer_rows`, `rule_rows`, `rulegroup_rows`, and `wincondition_rows` are introduced before render tasks use them.
  - Action states are exactly `action`, `none`, and `disabled`.
  - Tick states are exactly `tick` and `none`.

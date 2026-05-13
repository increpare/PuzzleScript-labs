# Static Analysis Explorer UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the statically generated static-analysis explorer into a coherent report UI system with reusable widgets, report definitions, sortable rows, shared inspector behavior, and consistent per-tab layout.

**Architecture:** Keep `make static_analysis_explorer` as a static HTML generator. Server-side summarizers in `src/tests/build_static_analysis_explorer.js` produce normalized game/report data; generated client JavaScript renders that data through reusable widgets: explorer shell, corpus matrix, report shell, sortable table, source viewer, and inspector. The UI remains framework-free and self-contained inside `build/static-analysis-explorer/index.html`.

**Tech Stack:** Node.js CommonJS scripts, plain browser JavaScript, generated HTML/CSS, existing `src/tests/static_analysis_explorer_node.js` fixture tests, `make static_analysis_explorer`, `make static_analysis_tests`.

---

## File Structure

- Modify `src/tests/build_static_analysis_explorer.js`
  - Keep static site generation entry point.
  - Add normalized report data helpers.
  - Replace ad-hoc tab renderers with reusable generated client-side widgets.
  - Keep generated page self-contained.
- Modify `src/tests/static_analysis_explorer_node.js`
  - Add red/green fixture assertions for report definitions, reusable widget names, sortable columns, consistent report anatomy, source annotations, empty states, and generated script parse.
  - Keep the existing fixture games.
- Create `src/tests/static_analysis_explorer_runtime_smoke.js`
  - Load `build/static-analysis-explorer/index.html`, execute the generated script in a small fake DOM, and verify corpus/report sorting and tab rendering.
  - Keep it as an explicit post-build verification command, not part of `make static_analysis_tests`, because it depends on the generated explorer artifact.
- No generated `build/static-analysis-explorer/index.html` file should be committed unless it is already tracked. Use it for verification only.

---

### Task 1: Add Refactor Regression Tests

**Files:**
- Modify: `src/tests/static_analysis_explorer_node.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Add failing assertions for report definitions and reusable widgets**

In `src/tests/static_analysis_explorer_node.js`, after the existing `const html = renderExplorerHtml(model);` block begins and near the current UI string assertions, add these assertions:

```js
assert.ok(html.includes('function reportDefinitionsForGame'));
assert.ok(html.includes('function renderReportShell'));
assert.ok(html.includes('function renderSortableTable'));
assert.ok(html.includes('function renderSourceReport'));
assert.ok(html.includes('function renderInspectorPayload'));
assert.ok(html.includes('const columnTypes ='));
assert.ok(html.includes("id: 'objects'"));
assert.ok(html.includes("id: 'rules'"));
assert.ok(html.includes("id: 'layers'"));
assert.ok(html.includes("id: 'rulegroups'"));
assert.ok(html.includes("id: 'ruleflow'"));
assert.ok(html.includes("id: 'winconditions'"));
assert.ok(html.includes("id: 'source'"));
assert.ok(html.includes('data-report-id="rules"'));
assert.ok(html.includes('data-report-id="layers"'));
assert.ok(html.includes('data-report-id="rulegroups"'));
assert.ok(html.includes('data-report-id="ruleflow"'));
assert.ok(html.includes('data-report-id="winconditions"'));
assert.ok(html.includes('data-report-id="source"'));
```

- [ ] **Step 2: Add failing assertions for consistent report anatomy**

In the same assertion block, add:

```js
assert.ok(html.includes('class="report-shell"'));
assert.ok(html.includes('class="report-header"'));
assert.ok(html.includes('class="report-summary"'));
assert.ok(html.includes('class="report-body"'));
assert.ok(html.includes('class="report-notes"'));
assert.ok(html.includes('class="sortable-table"'));
assert.ok(html.includes('class="inspector-panel"'));
assert.ok(!html.includes('function renderRulesTab'));
assert.ok(!html.includes('function renderLayersTab'));
assert.ok(!html.includes('function renderRulegroupsTab'));
assert.ok(!html.includes('function renderWinconditionsTab'));
```

- [ ] **Step 3: Add failing assertions for sortable report columns**

In the same assertion block, add:

```js
assert.ok(html.includes('data-report-sort-key="line"'));
assert.ok(html.includes('data-report-sort-key="source_lines"'));
assert.ok(html.includes('data-report-sort-key="wake_edge_count"'));
assert.ok(html.includes('function handleReportSort'));
assert.ok(html.includes('function sortReportRows'));
assert.ok(html.includes('defaultSort'));
```

- [ ] **Step 4: Run the fixture test and verify it fails for the new refactor contract**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL on the first missing refactor marker, such as `function reportDefinitionsForGame`.

- [ ] **Step 5: Commit the failing test**

```bash
git add src/tests/static_analysis_explorer_node.js
git commit -m "Test explorer report UI contract"
```

---

### Task 2: Normalize Report-Ready Model Data

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Modify: `src/tests/static_analysis_explorer_node.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Add failing assertions for inspector-ready row payloads**

In `src/tests/static_analysis_explorer_node.js`, after existing `game.object_rows`, `game.rule_rows`, `game.rulegroup_rows`, and `game.wincondition_rows` assertions, add:

```js
assert.ok(game.object_rows.every(row => row.inspector && row.inspector.title && Array.isArray(row.inspector.facts)));
assert.ok(game.rule_rows.every(row => row.inspector && row.inspector.title && Array.isArray(row.inspector.facts)));
assert.ok(game.layer_rows.every(row => row.inspector && row.inspector.title && Array.isArray(row.inspector.facts)));
assert.ok(game.rulegroup_rows.every(row => row.inspector && row.inspector.title && Array.isArray(row.inspector.facts)));
assert.ok(game.wincondition_rows.every(row => row.inspector && row.inspector.title && Array.isArray(row.inspector.facts)));
assert.ok(game.source_lines.some(row => row.annotations && row.annotations.some(annotation => annotation.kind === 'rulegroup')));
```

- [ ] **Step 2: Run the fixture test and verify it fails**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL because row `inspector` and `source_lines[].annotations` are not present.

- [ ] **Step 3: Add helper functions for inspector payloads**

In `src/tests/build_static_analysis_explorer.js`, near the existing summarizer helpers, add:

```js
function factItem(label, value) {
    return { label, value: value == null || value === '' ? '-' : String(value) };
}

function inspectorPayload(title, factsList, details = []) {
    return {
        title,
        facts: factsList,
        details,
    };
}

function yesNo(value) {
    return value ? 'yes' : '-';
}
```

- [ ] **Step 4: Add inspector payloads to object rows**

Update `summarizeObjectRows(report, mergeableGroups)` so each returned row is created as an object literal and includes:

```js
inspector: inspectorPayload(`Object ${object.name}`, [
    factItem('layer', object.layer),
    factItem('quantity', quantityLabel(object)),
    factItem('static', yesNo(Boolean(object.tags && object.tags.static))),
    factItem('temporary', yesNo(Boolean(object.tags && object.tags.temporary))),
    factItem('cosmetic', yesNo(Boolean(object.tags && object.tags.cosmetic))),
    factItem('merge group', mergeByObject.get(object.name) || '-'),
    factItem('rules touching object', rules.filter(entry => ruleTouchesObject(entry.rule, object.name)).length),
    factItem('win role', winRoleForObject(object.name, winconditions)),
])
```

- [ ] **Step 5: Add inspector payloads to layer rows**

Update `summarizeLayerRows(report)` so each row includes:

```js
inspector: inspectorPayload(`Layer ${layer.id}`, [
    factItem('objects', (layer.objects || []).join(', ') || '-'),
    factItem('object count', (layer.objects || []).length),
    factItem('static', yesNo(Boolean(layer.tags && layer.tags.static))),
    factItem('inert', yesNo(Boolean(layer.tags && layer.tags.inert))),
])
```

- [ ] **Step 6: Add inspector payloads to rule rows**

Update `summarizeRuleRows(report)` so each row includes:

```js
inspector: inspectorPayload(`Rule ${entry.rule.id}`, [
    factItem('line', Number.isFinite(entry.rule.source_line) ? entry.rule.source_line : 'compiled'),
    factItem('section', entry.section.name),
    factItem('group', entry.group.id),
    factItem('cosmetic', yesNo(Boolean(entry.rule.tags && entry.rule.tags.cosmetic))),
    factItem('inert command', yesNo(Boolean(entry.rule.tags && entry.rule.tags.inert_command_only))),
    factItem('command only', yesNo(Boolean(entry.rule.tags && entry.rule.tags.command_only))),
], [ruleText(entry.rule)])
```

- [ ] **Step 7: Add inspector payloads to rulegroup rows**

Update `summarizeRulegroupRows(report)` so each row includes:

```js
inspector: inspectorPayload(`Rulegroup ${group.id}`, [
    factItem('source lines', sourceLines),
    factItem('section', section.name),
    factItem('rules', group.rules.length),
    factItem('splittable', yesNo(Boolean(flow && flow.value && flow.value.split_candidate))),
    factItem('flow status', flow ? flow.status : 'not_applicable'),
    factItem('components', flow && flow.value && Array.isArray(flow.value.components) ? flow.value.components.length : 0),
    factItem('interactions', flow && flow.value && Array.isArray(flow.value.interaction_edges) ? flow.value.interaction_edges.length : 0),
    factItem('rerun masks', flow && flow.value && flow.value.rerun_masks
        ? Object.values(flow.value.rerun_masks).filter(mask => Array.isArray(mask) && mask.length > 0).length
        : 0),
], group.rules.slice(0, 6).map(rule => ruleText(rule)))
```

- [ ] **Step 8: Add inspector payloads to wincondition rows**

Update `summarizeWinconditionRows(report)` so each row includes:

```js
inspector: inspectorPayload(`Wincondition ${wincondition.id}`, [
    factItem('line', Number.isFinite(wincondition.source_line) ? wincondition.source_line : 'compiled'),
    factItem('subjects', (wincondition.subjects || []).join(', ') || '-'),
    factItem('targets', (wincondition.targets || []).join(', ') || '-'),
    factItem('wake edges', wakeEdges.filter(edge => edge.to === wincondition.id).length),
], [winconditionText(wincondition)])
```

- [ ] **Step 9: Convert source rule summaries into annotations**

Update `summarizeSourceLines(report)` so each line row includes:

```js
annotations: [
    ...Array.from(new Map((ruleSummaries.get(line) || []).map(rule => [rule.group, []])).keys()).map(group => ({
        kind: 'rulegroup',
        label: group,
        title: (ruleSummaries.get(line) || [])
            .filter(rule => rule.group === group)
            .map(rule => `${rule.compiled_id}: ${rule.text}`)
            .join('\n'),
    })),
    ...(winconditionCounts.get(line) ? [{
        kind: 'wincondition',
        label: `${winconditionCounts.get(line)} wincondition${winconditionCounts.get(line) === 1 ? '' : 's'}`,
        title: 'Wincondition source line',
    }] : []),
]
```

Keep existing `rule_summaries`, `rule_count`, and `wincondition_count` fields for compatibility during the refactor.

- [ ] **Step 10: Run the fixture test and verify it passes the model-shape assertions**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: Still FAIL on UI refactor markers from Task 1, but no longer fail on missing inspector payloads or source annotations.

- [ ] **Step 11: Commit normalized model data**

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Normalize explorer report row data"
```

---

### Task 3: Add Shared Report CSS And Static HTML Markers

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Add failing CSS marker assertions if Task 1 did not cover them**

Ensure `src/tests/static_analysis_explorer_node.js` includes:

```js
assert.ok(html.includes('.report-shell'));
assert.ok(html.includes('.report-header'));
assert.ok(html.includes('.report-summary'));
assert.ok(html.includes('.report-body'));
assert.ok(html.includes('.report-notes'));
assert.ok(html.includes('.sortable-table'));
assert.ok(html.includes('.inspector-panel'));
```

- [ ] **Step 2: Run the fixture test and verify it fails**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL on at least one missing CSS class marker.

- [ ] **Step 3: Replace ad-hoc report CSS with shared report classes**

In the `<style>` block inside `renderExplorerHtml(model)`, add these classes and keep existing color variables:

```css
.report-shell { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; overflow: hidden; }
.report-header { padding: 10px 12px; border-bottom: 1px solid var(--line); background: #f7f9fc; }
.report-header h3 { margin: 0 0 3px; font-size: 14px; }
.report-purpose { color: var(--muted); margin: 0; max-width: 980px; }
.report-summary { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--line); background: #fff; }
.report-toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); background: var(--panel-soft); }
.report-body { overflow-x: auto; background: #fff; }
.report-notes { padding: 8px 12px; border-top: 1px solid var(--line); background: #fbfcfe; color: var(--muted); }
.sortable-table { width: 100%; min-width: 920px; border-collapse: collapse; background: #fff; }
.sortable-table th, .sortable-table td { border-bottom: 1px solid var(--line); padding: 5px 6px; text-align: left; vertical-align: top; }
.sortable-table th { font-size: 10px; color: var(--muted); text-transform: uppercase; background: var(--panel-soft); }
.sortable-table tr:last-child td { border-bottom: 0; }
.sortable-table button.header-sort { width: 100%; border: 0; background: transparent; color: inherit; text-align: inherit; padding: 0; cursor: pointer; font-weight: 650; }
.sortable-table tr.selected td { background: #fff8d6; }
.inspector-panel { position: fixed; right: 14px; bottom: 14px; width: min(460px, calc(100vw - 28px)); max-height: min(520px, calc(100vh - 28px)); overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 12px 32px rgba(20, 30, 45, .18); padding: 12px; display: none; z-index: 5; }
.inspector-panel.open { display: block; }
.source-report { border: 1px solid var(--line); border-radius: 6px; background: #fff; overflow: hidden; }
.source-row { display: grid; grid-template-columns: 52px minmax(0, 1fr) minmax(220px, auto); gap: 8px; border-bottom: 1px solid var(--line); padding: 3px 6px; align-items: start; }
.source-row:last-child { border-bottom: 0; }
.source-annotations { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
```

- [ ] **Step 4: Rename inspector element class in static HTML**

Change the `<aside>` in `renderExplorerHtml(model)` from:

```html
<aside id="inspector" class="inspector" aria-live="polite"></aside>
```

to:

```html
<aside id="inspector" class="inspector-panel" aria-live="polite"></aside>
```

- [ ] **Step 5: Update inspector class toggling**

Keep `inspector.classList.add('open')` and `inspector.classList.remove('open')`. The CSS now uses `.inspector-panel.open`, so no JavaScript class-name change is needed beyond the aside class.

- [ ] **Step 6: Run fixture test**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: Still FAIL on missing report/widget functions from Task 1, but CSS class assertions pass.

- [ ] **Step 7: Commit shared report styling**

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Add explorer report styling primitives"
```

---

### Task 4: Implement Report Definitions

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Add client-side `columnTypes` object**

Inside the generated `<script>` block in `renderExplorerHtml(model)`, after `escapeText(value)`, add:

```js
const columnTypes = {
  line: {
    className: 'col-line',
    value(row, column) { return row[column.key] == null ? 'compiled' : row[column.key]; },
    compare(left, right, column) { return compareScalar(left[column.key] == null ? -1 : left[column.key], right[column.key] == null ? -1 : right[column.key]); },
  },
  id: {
    className: 'col-id',
    value(row, column) { return row[column.key] == null ? '-' : row[column.key]; },
  },
  text: {
    className: 'col-text',
    value(row, column) { return row[column.key] == null ? '-' : row[column.key]; },
  },
  boolean: {
    className: 'col-boolean',
    value(row, column) { return row[column.key] ? 'yes' : '-'; },
    compare(left, right, column) { return Number(Boolean(left[column.key])) - Number(Boolean(right[column.key])); },
  },
  count: {
    className: 'col-count',
    value(row, column) { return row[column.key] == null ? 0 : row[column.key]; },
  },
  status: {
    className: 'col-status',
    value(row, column) { return row[column.key] == null ? '-' : row[column.key]; },
  },
  relation: {
    className: 'col-relation',
    value(row, column) { return row[column.key] == null ? '-' : row[column.key]; },
  },
  preview: {
    className: 'col-preview',
    value(row, column) {
      const value = row[column.key];
      return Array.isArray(value) ? value.join('\n') : (value == null ? '-' : value);
    },
  },
};
```

- [ ] **Step 2: Add `summaryItems` helper**

Inside the generated script, add:

```js
function summaryItems(items) {
  return items.map(([label, value]) => ({ label, value }));
}
```

- [ ] **Step 3: Add `reportDefinitionsForGame(game)`**

Inside the generated script, add:

```js
function reportDefinitionsForGame(game) {
  return [
    {
      id: 'objects',
      title: 'Objects',
      purpose: 'Object-level static-analysis traits, quantities, merge groups, and wincondition roles.',
      summary: summaryItems([
        ['objects', game.corpus_metrics.objects.total],
        ['static', game.corpus_metrics.objects.static],
        ['constant count', game.corpus_metrics.objects.constant_count],
        ['temporary', game.corpus_metrics.objects.temporary],
        ['cosmetic', game.corpus_metrics.objects.cosmetic],
        ['mergable', game.corpus_metrics.objects.mergable],
      ]),
      columns: objectColumns.map(column => Object.assign({}, column, {
        type: column.key === 'name' ? 'id' :
          column.key === 'layer' || column.key === 'rule_count' ? 'count' :
          ['static', 'temporary', 'cosmetic'].includes(column.key) ? 'boolean' :
          column.key === 'quantity' || column.key === 'merge_group' || column.key === 'win_role' ? 'status' :
          'text',
      })),
      rows: game.object_rows,
      defaultSort: { key: 'name', direction: 'asc' },
      notes: 'Object rows are source object declarations after compilation and static tagging.',
    },
    {
      id: 'rules',
      title: 'Rules',
      purpose: 'Compiled rule facts grouped back to source lines where possible.',
      summary: summaryItems([
        ['source lines', game.corpus_metrics.rules.source],
        ['compiled', game.corpus_metrics.rules.compiled],
        ['cosmetic', game.corpus_metrics.rules.cosmetic],
        ['inert commands', game.corpus_metrics.rules.inert_command],
        ['action', game.corpus_metrics.rules.action],
        ['tick', game.corpus_metrics.rules.tick],
      ]),
      columns: [
        { key: 'source_line', label: 'Line', type: 'line' },
        { key: 'section', label: 'Section', type: 'status' },
        { key: 'group', label: 'Group', type: 'id' },
        { key: 'cosmetic', label: 'Cosmetic', type: 'boolean' },
        { key: 'inert_command', label: 'Inert command', type: 'boolean' },
        { key: 'command_only', label: 'Command only', type: 'boolean' },
        { key: 'text', label: 'Rule', type: 'preview' },
      ],
      rows: game.rule_rows,
      defaultSort: { key: 'source_line', direction: 'asc' },
      notes: 'Line values use source lines when available; compiled means no source line was available.',
    },
    {
      id: 'layers',
      title: 'Layers',
      purpose: 'Collision layer traits and layer-level static-analysis conclusions.',
      summary: summaryItems([
        ['layers', game.corpus_metrics.layers.total],
        ['static', game.corpus_metrics.layers.static],
        ['inert', game.corpus_metrics.layers.inert],
      ]),
      columns: [
        { key: 'id', label: 'Layer', type: 'count' },
        { key: 'objects', label: 'Objects', type: 'preview', value: row => row.objects.join(', ') },
        { key: 'object_count', label: 'Object count', type: 'count', value: row => row.objects.length },
        { key: 'static', label: 'Static', type: 'boolean' },
        { key: 'inert', label: 'Inert', type: 'boolean' },
      ],
      rows: game.layer_rows,
      defaultSort: { key: 'id', direction: 'asc' },
      notes: 'Layer traits summarize conclusions that apply to every object in the collision layer.',
    },
    {
      id: 'rulegroups',
      title: 'Rulegroups',
      purpose: 'Source-facing rulegroup ranges, previews, and flow status.',
      summary: summaryItems([
        ['rulegroups', game.corpus_metrics.rulegroups.total],
        ['splittable', game.corpus_metrics.rulegroups.splittable],
      ]),
      columns: [
        { key: 'id', label: 'Rulegroup', type: 'id' },
        { key: 'source_lines', label: 'Source lines', type: 'line' },
        { key: 'section', label: 'Section', type: 'status' },
        { key: 'rule_count', label: 'Rules', type: 'count' },
        { key: 'splittable', label: 'Splittable', type: 'boolean' },
        { key: 'status', label: 'Flow status', type: 'status' },
        { key: 'rule_preview', label: 'Preview', type: 'preview' },
      ],
      rows: game.rulegroup_rows,
      defaultSort: { key: 'source_lines', direction: 'asc' },
      notes: 'Rulegroups are the source-facing units used for rule execution and flow analysis.',
    },
    {
      id: 'ruleflow',
      title: 'Rule Flow',
      purpose: 'Rulegroups with split candidates, components, interactions, or rerun masks.',
      summary: summaryItems([
        ['reported groups', game.rulegroup_flow_total],
        ['splittable', game.rulegroup_flow_split_total],
        ['shown', game.rulegroup_flow.length],
      ]),
      columns: [
        { key: 'id', label: 'Rulegroup', type: 'id' },
        { key: 'section', label: 'Section', type: 'status' },
        { key: 'split_candidate', label: 'Splittable', type: 'boolean' },
        { key: 'component_count', label: 'Components', type: 'count' },
        { key: 'interaction_edge_count', label: 'Interactions', type: 'count' },
        { key: 'rerun_mask_count', label: 'Rerun masks', type: 'count' },
        { key: 'rules', label: 'Compiled rules by component', type: 'preview', value: row => row.rules.map(rule => '[' + (rule.component == null ? '-' : rule.component) + '] ' + rule.text).join('\n') },
      ],
      rows: game.rulegroup_flow,
      defaultSort: { key: 'split_candidate', direction: 'desc' },
      empty: 'No splittable or rerun-sensitive rulegroups were reported for this game.',
      notes: 'Rule flow is computed after compilation, so ids are compiled rulegroup ids with source ranges available in the Rulegroups report.',
    },
    {
      id: 'winconditions',
      title: 'Winconditions',
      purpose: 'Wincondition subjects, targets, source lines, and wake edges.',
      summary: summaryItems([
        ['winconditions', game.corpus_metrics.winconditions.total],
        ['wake edges', game.winflow.wake_edge_count],
      ]),
      columns: [
        { key: 'source_line', label: 'Line', type: 'line' },
        { key: 'text', label: 'Wincondition', type: 'preview' },
        { key: 'subjects', label: 'Subjects', type: 'preview', value: row => row.subjects.join(', ') || '-' },
        { key: 'targets', label: 'Targets', type: 'preview', value: row => row.targets.join(', ') || '-' },
        { key: 'wake_edge_count', label: 'Wake edges', type: 'count' },
      ],
      rows: game.wincondition_rows,
      defaultSort: { key: 'source_line', direction: 'asc' },
      empty: 'This game has no winconditions.',
      notes: 'Wake edges show rule-to-wincondition relationships found by winflow analysis.',
    },
    {
      id: 'source',
      title: 'Source',
      purpose: 'Best-effort source annotations linked to compiled rulegroups and static-analysis facts.',
      summary: summaryItems([
        ['source lines', game.source_lines.length],
        ['compiled rules', game.corpus_metrics.rules.compiled],
        ['winconditions', game.corpus_metrics.winconditions.total],
      ]),
      sourceRows: game.source_lines,
      defaultSort: { key: 'line', direction: 'asc' },
      notes: 'Source annotations are best-effort because static analysis facts are produced after compilation.',
    },
  ];
}
```

- [ ] **Step 4: Run fixture test and verify definition markers pass**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: Still FAIL on missing generic renderer functions from Task 1, but no longer fail on `reportDefinitionsForGame`, report ids, `columnTypes`, or `defaultSort`.

- [ ] **Step 5: Commit report definitions**

```bash
git add src/tests/build_static_analysis_explorer.js
git commit -m "Define explorer reports declaratively"
```

---

### Task 5: Implement Shared Report Renderer And Sortable Table

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Add renderer state**

Inside the generated script, replace `let activeGameTab = 'objects';` with:

```js
let activeReportId = 'objects';
let reportSortState = {};
let selectedReportRow = null;
```

Keep `activeGameTab` temporarily only if needed for compatibility during the edit, but remove it before this task is complete.

- [ ] **Step 2: Add column value helpers**

Inside the generated script, add:

```js
function columnType(column) {
  return columnTypes[column.type || 'text'] || columnTypes.text;
}

function columnRawValue(row, column) {
  if (typeof column.value === 'function') return column.value(row);
  return row[column.key];
}

function columnDisplayValue(row, column) {
  const type = columnType(column);
  if (typeof column.value === 'function') {
    const value = column.value(row);
    return value == null || value === '' ? '-' : value;
  }
  return type.value ? type.value(row, column) : columnRawValue(row, column);
}

function compareReportValues(left, right, column) {
  const type = columnType(column);
  if (type.compare && typeof column.value !== 'function') return type.compare(left, right, column);
  return compareScalar(columnRawValue(left, column), columnRawValue(right, column));
}
```

- [ ] **Step 3: Add report sorting**

Inside the generated script, add:

```js
function reportSort(report) {
  return reportSortState[report.id] || report.defaultSort || { key: report.columns && report.columns[0] ? report.columns[0].key : '', direction: 'asc' };
}

function sortReportRows(report) {
  const rows = (report.rows || []).slice();
  if (!report.columns || report.columns.length === 0) return rows;
  const sort = reportSort(report);
  const column = report.columns.find(item => item.key === sort.key);
  if (!column || column.sortable === false) return rows;
  rows.sort((left, right) => {
    const base = compareReportValues(left, right, column);
    const directed = sort.direction === 'asc' ? base : -base;
    return directed || compareScalar(left.id || left.name || left.text || '', right.id || right.name || right.text || '');
  });
  return rows;
}

function handleReportSort(reportId, key) {
  const game = selected;
  if (!game) return;
  const report = reportDefinitionsForGame(game).find(item => item.id === reportId);
  if (!report) return;
  const current = reportSort(report);
  reportSortState[reportId] = {
    key,
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
  };
  selectedReportRow = null;
  renderGame();
}
```

- [ ] **Step 4: Add shared cell renderer**

Inside the generated script, add:

```js
function renderReportCell(row, column) {
  const type = columnType(column);
  const value = columnDisplayValue(row, column);
  const text = Array.isArray(value) ? value.join('\n') : value;
  const quiet = text === '-' || text === '' ? ' quiet' : '';
  return '<td class="' + escapeText((type.className || '') + quiet) + '" data-report-cell="' + escapeText(column.key) + '">' +
    '<span>' + escapeText(text == null ? '-' : text) + '</span>' +
    '</td>';
}
```

- [ ] **Step 5: Add `renderSortableTable(report)`**

Inside the generated script, add:

```js
function renderSortableTable(report) {
  const rows = sortReportRows(report);
  const sort = reportSort(report);
  if (!rows.length) {
    return '<div class="report-empty">' + escapeText(report.empty || 'No rows for this report.') + '</div>';
  }
  const head = report.columns.map(column => {
    const sorted = sort.key === column.key;
    const marker = sorted ? ' ' + sort.direction : '';
    const disabled = column.sortable === false;
    const inner = disabled
      ? escapeText(column.label)
      : '<button type="button" class="header-sort" data-report-id="' + escapeText(report.id) + '" data-report-sort-key="' + escapeText(column.key) + '">' + escapeText(column.label + marker) + '</button>';
    return '<th class="' + escapeText(columnType(column).className || '') + '">' + inner + '</th>';
  }).join('');
  const body = rows.map((row, index) => {
    const rowId = row.id || row.compiled_id || row.name || String(index);
    const selected = selectedReportRow && selectedReportRow.reportId === report.id && selectedReportRow.rowId === rowId;
    return '<tr class="' + (selected ? 'selected' : '') + '" data-report-id="' + escapeText(report.id) + '" data-report-row="' + escapeText(rowId) + '">' +
      report.columns.map(column => renderReportCell(row, column)).join('') +
      '</tr>';
  }).join('');
  return '<table class="sortable-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}
```

- [ ] **Step 6: Add `renderReportShell(report)`**

Inside the generated script, add:

```js
function renderReportSummary(report) {
  const items = report.summary || [];
  return '<div class="report-summary">' + items.map(item => '<span class="pill">' + escapeText(item.label) + ' ' + escapeText(item.value) + '</span>').join('') + '</div>';
}

function renderReportShell(report, bodyHtml) {
  return '<section class="report-shell" data-report-id="' + escapeText(report.id) + '">' +
    '<div class="report-header"><h3>' + escapeText(report.title) + '</h3><p class="report-purpose">' + escapeText(report.purpose || '') + '</p></div>' +
    renderReportSummary(report) +
    '<div class="report-body">' + bodyHtml + '</div>' +
    (report.notes ? '<div class="report-notes">' + escapeText(report.notes) + '</div>' : '') +
    '</section>';
}
```

- [ ] **Step 7: Add `renderSourceReport(report)`**

Inside the generated script, add:

```js
function renderSourceAnnotation(annotation) {
  return '<span class="chip" data-source-annotation="' + escapeText(annotation.kind) + '" title="' + escapeText(annotation.title || '') + '">' + escapeText(annotation.label) + '</span>';
}

function renderSourceReport(report) {
  const rows = report.sourceRows || [];
  if (!rows.length) return renderReportShell(report, '<div class="report-empty">' + escapeText(report.empty || 'Source text was not embedded in this explorer build.') + '</div>');
  const body = '<div class="source-report">' + rows.map(row =>
    '<div class="source-row" data-report-id="' + escapeText(report.id) + '" data-source-line="' + escapeText(row.line) + '">' +
      '<span class="line-no">' + escapeText(row.line) + '</span>' +
      '<code>' + escapeText(row.text || ' ') + '</code>' +
      '<span class="source-annotations">' + (row.annotations || []).map(renderSourceAnnotation).join('') + '</span>' +
    '</div>'
  ).join('') + '</div>';
  return renderReportShell(report, body);
}
```

- [ ] **Step 8: Replace `renderGameTabPanel`**

Replace the existing `renderGameTabPanel(game, tab)` implementation with:

```js
function renderGameReport(game, reportId) {
  const report = reportDefinitionsForGame(game).find(item => item.id === reportId) || reportDefinitionsForGame(game)[0];
  if (report.id === 'source') return renderSourceReport(report);
  return renderReportShell(report, renderSortableTable(report));
}
```

- [ ] **Step 9: Replace `renderGameTabs`**

Replace `renderGameTabs()` with:

```js
function renderGameTabs(game) {
  return '<div class="view-tabs">' + reportDefinitionsForGame(game).map(report =>
    '<button class="view-tab' + (report.id === activeReportId ? ' active' : '') + '" type="button" data-report-tab="' + escapeText(report.id) + '">' + escapeText(report.title) + '</button>'
  ).join('') + '</div>';
}
```

- [ ] **Step 10: Replace `renderGame` tab wiring**

In `renderGame()`, replace:

```js
gameView.innerHTML = renderGameHeader(game) + renderGameTabs() + '<section id="gameTabPanel">' + renderGameTabPanel(game, activeGameTab) + '</section>';
```

with:

```js
gameView.innerHTML = renderGameHeader(game) + renderGameTabs(game) + '<section id="gameTabPanel">' + renderGameReport(game, activeReportId) + '</section>';
```

Then replace the `[data-game-tab]` listener block with:

```js
for (const tab of gameView.querySelectorAll('[data-report-tab]')) {
  tab.addEventListener('click', () => {
    activeReportId = tab.dataset.reportTab;
    selectedReportRow = null;
    renderGame();
  });
}
for (const head of gameView.querySelectorAll('[data-report-sort-key]')) {
  head.addEventListener('click', () => handleReportSort(head.dataset.reportId, head.dataset.reportSortKey));
}
for (const row of gameView.querySelectorAll('[data-report-row]')) {
  row.addEventListener('click', () => {
    selectedReportRow = { reportId: row.dataset.reportId, rowId: row.dataset.reportRow };
    showInspectorForReportRow(game, selectedReportRow.reportId, selectedReportRow.rowId);
    renderGame();
  });
}
```

- [ ] **Step 11: Remove old tab renderer functions**

Delete these generated script functions:

```js
renderObjectMatrix
renderRulesTab
renderLayersTab
renderRulegroupsTab
renderRuleFlowTab
renderWinconditionsTab
sourceBadges
renderSourceTab
renderGameTabPanel
handleObjectHeaderSort
sortedObjectRows
compareObjectRows
defaultDirectionForObjectColumn
```

Keep helpers still used by report definitions or source annotations.

- [ ] **Step 12: Run fixture test**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS for Task 1 UI markers, or fail only on inspector-specific assertions that Task 6 will handle.

- [ ] **Step 13: Commit shared report renderer**

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Render explorer reports with shared widgets"
```

---

### Task 6: Unify Inspector Behavior

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Modify: `src/tests/static_analysis_explorer_node.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Add failing inspector assertions**

In `src/tests/static_analysis_explorer_node.js`, add:

```js
assert.ok(html.includes('function showInspectorForReportRow'));
assert.ok(html.includes('function showInspectorForSourceLine'));
assert.ok(html.includes('function renderInspectorPayload'));
assert.ok(html.includes('data-report-row='));
assert.ok(html.includes('data-source-line='));
```

- [ ] **Step 2: Run fixture test and verify it fails if inspector functions are missing**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: FAIL on any missing inspector function.

- [ ] **Step 3: Add payload renderer**

Inside the generated script, add:

```js
function renderInspectorPayload(payload) {
  if (!payload) return '<h3>Inspector</h3><p class="empty">No row selected.</p>';
  const factsHtml = payload.facts && payload.facts.length
    ? '<dl>' + payload.facts.map(item => '<dt>' + escapeText(item.label) + '</dt><dd>' + escapeText(item.value) + '</dd>').join('') + '</dl>'
    : '<p class="empty">No facts available.</p>';
  const detailsHtml = payload.details && payload.details.length
    ? '<div>' + payload.details.map(detail => '<pre><code>' + escapeText(detail) + '</code></pre>').join('') + '</div>'
    : '';
  return '<h3>' + escapeText(payload.title || 'Inspector') + '</h3>' + factsHtml + detailsHtml;
}
```

- [ ] **Step 4: Add report row inspector routing**

Inside the generated script, add:

```js
function findReportRow(game, reportId, rowId) {
  const report = reportDefinitionsForGame(game).find(item => item.id === reportId);
  if (!report || !report.rows) return null;
  return report.rows.find((row, index) => String(row.id || row.compiled_id || row.name || index) === String(rowId)) || null;
}

function showInspectorForReportRow(game, reportId, rowId) {
  const row = findReportRow(game, reportId, rowId);
  inspector.innerHTML = '<button type="button" id="closeInspector">Close</button>' + renderInspectorPayload(row && row.inspector);
  inspector.classList.add('open');
  document.getElementById('closeInspector').addEventListener('click', closeInspector);
}
```

- [ ] **Step 5: Add source line inspector routing**

Inside the generated script, add:

```js
function showInspectorForSourceLine(game, lineNumber) {
  const row = (game.source_lines || []).find(item => String(item.line) === String(lineNumber));
  const annotations = row && row.annotations ? row.annotations.map(annotation => annotation.label + (annotation.title ? ': ' + annotation.title : '')) : [];
  const payload = row ? {
    title: 'Source line ' + row.line,
    facts: [
      { label: 'rules', value: row.rule_count || 0 },
      { label: 'winconditions', value: row.wincondition_count || 0 },
      { label: 'object', value: row.object_name || '-' },
    ],
    details: [row.text || ''].concat(annotations),
  } : null;
  inspector.innerHTML = '<button type="button" id="closeInspector">Close</button>' + renderInspectorPayload(payload);
  inspector.classList.add('open');
  document.getElementById('closeInspector').addEventListener('click', closeInspector);
}
```

- [ ] **Step 6: Wire source row selection in `renderGame()`**

After the report row listener block, add:

```js
for (const sourceLine of gameView.querySelectorAll('[data-source-line]')) {
  sourceLine.addEventListener('click', () => showInspectorForSourceLine(game, sourceLine.dataset.sourceLine));
}
```

- [ ] **Step 7: Keep corpus inspector path working**

Do not delete `corpusInspectorContent`, `objectInspectorContent`, `inspectorContent`, or `showInspector` until corpus metric clicks and any remaining object-cell clicks have been replaced. In this task, leave corpus inspector behavior unchanged.

- [ ] **Step 8: Run fixture test**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS.

- [ ] **Step 9: Commit inspector unification**

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Unify explorer report inspector"
```

---

### Task 7: Corpus Matrix Consistency Pass

**Files:**
- Modify: `src/tests/build_static_analysis_explorer.js`
- Modify: `src/tests/static_analysis_explorer_node.js`
- Test: `src/tests/static_analysis_explorer_node.js`

- [ ] **Step 1: Add corpus consistency assertions**

In `src/tests/static_analysis_explorer_node.js`, ensure these assertions exist:

```js
assert.ok(html.includes('function renderCorpusMatrix'));
assert.ok(html.includes('data-sort-key="corpus_metrics.objects.static"'));
assert.ok(html.includes('button.cell.name[data-game]'));
assert.ok(html.includes('cursor: pointer'));
assert.ok(html.includes('white-space: normal'));
```

- [ ] **Step 2: Run fixture test**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS if prior corpus fixes still exist; otherwise FAIL and restore the missing markers in the next step.

- [ ] **Step 3: Rename corpus render function for consistency**

If the generated script still uses `renderCorpus()` only, add a wrapper:

```js
function renderCorpusMatrix() {
  renderCorpus();
}
```

Then update `render()` and search/sort handlers to call `renderCorpusMatrix()` instead of `renderCorpus()`.

- [ ] **Step 4: Keep corpus and report header styles aligned**

Ensure corpus header cells use `.cell.head.sortable` and report table headers use `.header-sort` inside `.sortable-table th`. Both must wrap long labels and show full labels via `title`.

- [ ] **Step 5: Run fixture test**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected: PASS.

- [ ] **Step 6: Commit corpus consistency pass**

```bash
git add src/tests/build_static_analysis_explorer.js src/tests/static_analysis_explorer_node.js
git commit -m "Align corpus matrix with report UI"
```

---

### Task 8: Generated Page Runtime Smoke

**Files:**
- Create: `src/tests/static_analysis_explorer_runtime_smoke.js`
- Test: generated `build/static-analysis-explorer/index.html`

- [ ] **Step 1: Create the runtime smoke file**

Create `src/tests/static_analysis_explorer_runtime_smoke.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');

const htmlPath = process.argv[2] || 'build/static-analysis-explorer/index.html';
const html = fs.readFileSync(htmlPath, 'utf8');
const dataText = html.match(/<script id="explorer-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
const model = JSON.parse(dataText);
const script = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)][1][1];

class FakeClassList {
    add() {}
    remove() {}
    toggle() {}
}

class FakeNode {
    constructor(dataset = {}) {
        this.dataset = dataset;
        this.classList = new FakeClassList();
        this.listeners = {};
    }
    addEventListener(name, fn) {
        this.listeners[name] = fn;
    }
    click() {
        if (this.listeners.click) this.listeners.click();
    }
}

class FakeElement extends FakeNode {
    constructor(id) {
        super({});
        this.id = id;
        this.value = '';
        this.hidden = false;
        this.textContent = id === 'explorer-data' ? dataText : '';
        this._html = '';
        this.cache = {};
    }
    set innerHTML(value) {
        this._html = value;
        this.cache = {};
    }
    get innerHTML() {
        return this._html;
    }
    nodes(name, regex, mapper) {
        if (!this.cache[name]) this.cache[name] = [...this._html.matchAll(regex)].map(mapper);
        return this.cache[name];
    }
    querySelectorAll(selector) {
        if (selector === '[data-sort-key]') return this.nodes('sort', /data-sort-key="([^"]+)"/g, match => new FakeNode({ sortKey: match[1] }));
        if (selector === '[data-report-sort-key]') return this.nodes('reportSort', /data-report-id="([^"]+)" data-report-sort-key="([^"]+)"/g, match => new FakeNode({ reportId: match[1], reportSortKey: match[2] }));
        if (selector === '[data-report-row]') return this.nodes('reportRow', /data-report-id="([^"]+)" data-report-row="([^"]+)"/g, match => new FakeNode({ reportId: match[1], reportRow: match[2] }));
        if (selector === '[data-report-tab]') return this.nodes('reportTab', /data-report-tab="([^"]+)"/g, match => new FakeNode({ reportTab: match[1] }));
        if (selector === '[data-game]') return this.nodes('game', /data-game="([^"]+)"[^>]*data-cell-kind="([^"]+)"/g, match => new FakeNode({ game: match[1], cellKind: match[2] }));
        if (selector === '[data-source-line]') return this.nodes('sourceLine', /data-source-line="([^"]+)"/g, match => new FakeNode({ sourceLine: match[1] }));
        return [];
    }
}

const elements = new Map();
global.document = {
    getElementById(id) {
        if (!elements.has(id)) elements.set(id, new FakeElement(id));
        return elements.get(id);
    },
};

new Function(script)();

const corpusView = document.getElementById('corpusView');
const staticHeader = corpusView.querySelectorAll('[data-sort-key]').find(node => node.dataset.sortKey === 'corpus_metrics.objects.static');
if (!staticHeader) throw new Error('static corpus header missing');
staticHeader.click();

const firstGame = (corpusView.innerHTML.match(/data-game="([^"]+)"[^>]*data-cell-kind="game"/) || [])[1];
const maxStatic = Math.max(...model.games.map(game => game.corpus_metrics.objects.static));
const firstStatic = model.games.find(game => game.source_path === firstGame).corpus_metrics.objects.static;
if (firstStatic !== maxStatic) throw new Error(`corpus header sort failed: first static ${firstStatic}, max ${maxStatic}`);

const gameView = document.getElementById('gameView');
const ruleCountHeader = gameView.querySelectorAll('[data-report-sort-key]').find(node => node.dataset.reportSortKey === 'rule_count');
if (!ruleCountHeader) throw new Error('object report rule_count sort header missing');
ruleCountHeader.click();

if (!gameView.innerHTML.includes('report-shell')) throw new Error('game report shell missing');
if (!gameView.innerHTML.includes('sortable-table')) throw new Error('sortable table missing');

console.log('static_analysis_explorer_runtime_smoke: ok');
```

- [ ] **Step 2: Make the runtime smoke executable**

Run:

```bash
chmod +x src/tests/static_analysis_explorer_runtime_smoke.js
```

- [ ] **Step 3: Build the real explorer**

Run:

```bash
make static_analysis_explorer
```

Expected output includes:

```text
static_analysis_explorer wrote
```

- [ ] **Step 4: Run generated script parse check**

Run:

```bash
node -e "const fs=require('fs');const html=fs.readFileSync('build/static-analysis-explorer/index.html','utf8');const scripts=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]); new Function(scripts[1]); console.log('generated script parses: ok');"
```

Expected:

```text
generated script parses: ok
```

- [ ] **Step 5: Run runtime smoke**

```bash
node src/tests/static_analysis_explorer_runtime_smoke.js build/static-analysis-explorer/index.html
```

Expected:

```text
static_analysis_explorer_runtime_smoke: ok
```

- [ ] **Step 6: Do not add runtime smoke to `static_analysis_tests`**

Leave `Makefile` unchanged. The smoke loads `build/static-analysis-explorer/index.html`, so it should remain an explicit post-build verification command.

- [ ] **Step 7: Commit runtime smoke**

```bash
git add src/tests/static_analysis_explorer_runtime_smoke.js
git commit -m "Add explorer runtime smoke"
```

---

### Task 9: Full Verification And Push

**Files:**
- Verify all changed files
- No implementation files should remain unstaged except unrelated `.superpowers/brainstorm/*`

- [ ] **Step 1: Run fixture test**

Run:

```bash
node src/tests/static_analysis_explorer_node.js
```

Expected:

```text
static_analysis_explorer_node: ok
```

- [ ] **Step 2: Build real explorer**

Run:

```bash
make static_analysis_explorer
```

Expected output includes:

```text
static_analysis_explorer wrote
```

- [ ] **Step 3: Run generated script parse check**

Run:

```bash
node -e "const fs=require('fs');const html=fs.readFileSync('build/static-analysis-explorer/index.html','utf8');const scripts=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]); new Function(scripts[1]); console.log('generated script parses: ok');"
```

Expected:

```text
generated script parses: ok
```

- [ ] **Step 4: Run runtime smoke**

```bash
node src/tests/static_analysis_explorer_runtime_smoke.js build/static-analysis-explorer/index.html
```

Expected:

```text
static_analysis_explorer_runtime_smoke: ok
```

- [ ] **Step 5: Run full static-analysis tests**

Run:

```bash
make static_analysis_tests
```

Expected output ends with:

```text
static_analysis_runtime_contracts: ok
```

- [ ] **Step 6: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` has no output. `git status --short` only shows intentional changed files and unrelated `.superpowers/brainstorm/*` scratch directories.

- [ ] **Step 7: Confirm no implementation changes remain uncommitted**

No implementation files should remain unstaged at this point. If `git status --short` shows tracked implementation changes in `src/tests/build_static_analysis_explorer.js`, `src/tests/static_analysis_explorer_node.js`, or `src/tests/static_analysis_explorer_runtime_smoke.js`, stop and commit the task-specific change before pushing. Do not make a catch-all cleanup commit and do not stage `.superpowers/brainstorm/*`.

- [ ] **Step 8: Push `cpp`**

```bash
git push
```

Expected:

```text
cpp -> cpp
```

---

## Self-Review Notes

- Spec coverage: the plan covers static generation, normalized model data, report definitions, reusable widgets, sortable rows, shared inspector behavior, source annotations, rule flow as a first-class report, corpus readability, and generated-page tests.
- Placeholder scan: no `TBD`, `TODO`, optional-file branches, or open-ended “add appropriate” steps remain.
- Type consistency: report ids are `objects`, `rules`, `layers`, `rulegroups`, `ruleflow`, `winconditions`, and `source`; sort keys and report row fields match the current summarizer field names.

# Static Analysis Explorer Redesign

## Goal

Redesign `make static_analysis_explorer` so browsing static-analysis data feels like using a focused analysis workbench rather than reading a flat diagnostics dump.

The explorer should support two main jobs:

- skim the solver-test corpus and find games with interesting optimization or debugging signals
- open one game and understand its objects, rules, layers, rulegroups, and winconditions without wading through endless inconsistent lists

The generated artifact should remain a static, self-contained HTML file built by `src/tests/build_static_analysis_explorer.js`.

## Current Problems

The current explorer is difficult to navigate because it presents many unrelated lists in one detail view. Ordering is weak, section presentation is inconsistent, and the most useful facts are not visually prioritized.

The corpus overview and the per-game detail view are also mixed together too tightly. Corpus browsing needs compact game-level metrics. Deep inspection needs wider per-game matrices and drill-downs.

## Design Direction

Use a Matrix Workbench design with two separate views:

- **Corpus Explorer**: a compact game-level overview table for skimming and outlier finding.
- **Game Explorer**: a per-game workspace with object, layer, rule, rulegroup, source, and wincondition views.

The corpus page should not try to show every object or every static-analysis fact directly. It should summarize each game using clear counts and small state values. The game page owns the detailed trait matrices and explanations.

## Corpus Explorer

The corpus page shows one row per game. Columns are grouped by the part of the compiled game being summarized, in this order:

1. Game
2. Objects
3. Layers
4. Rules
5. Rulegroups
6. Winconditions

### Objects Columns

- `objects`: total object count
- `static`: number of static objects
- `constant count`: number of objects whose quantity is proved constant
- `temporary`: number of objects tagged temporary
- `cosmetic`: number of cosmetic objects
- `mergable objects`: estimated number of objects that could be saved by merging

`mergable objects` is a savings metric, not a group count. For each merge group, savings are `group.length - 1`. The corpus value is the sum across groups.

### Layers Columns

- `layers`: total collision layer count
- `static layers`: number of static collision layers
- `inert layers`: number of inert collision layers

### Rules Columns

- `source rules`: source-facing authored rule count where available
- `compiled rules`: analyzed/compiled rule count
- `action`: per-game action state, with values `action`, `none`, or `disabled`
- `tick`: per-game autonomous tick state, with values `tick` or `none`
- `cosmetic rules`: number of cosmetic rules
- `inert command rules`: number of inert command-only rules

`action` should be positive and browsable. It answers whether action input may matter, not whether a negative proof label exists. `disabled` is used for `noaction` metadata.

### Rulegroups Columns

- `rulegroups`: total rulegroup count
- `splittable rulegroups`: number of rulegroups considered splittable

### Winconditions Columns

- `winconditions`: authored/analyzed wincondition count

Keep the default wincondition section simple. Do not surface winflow edges in the default corpus table.

### Corpus Interactions

- Search should match games, source paths, object names, and surfaced trait names.
- Sort should support useful optimization/debug signals such as mergable objects, constant-count objects, temporary objects, cosmetic rules, inert command rules, and splittable rulegroups.
- Clicking a game opens the Game Explorer for that game.
- Clicking a metric cell opens an inspector listing the objects, layers, rules, or rulegroups behind the number.
- Highlighting should mean the cell carries a useful optimization or debugging signal, not merely that it has a nonzero value.

## Game Explorer

The game page opens one selected game and starts with a compact header containing:

- title or file name
- source path
- key counts
- open-in-editor link

Below the header, the Game Explorer uses tabs:

- **Objects**: default tab and primary digestible view
- **Rules**: source-rule-oriented view where possible
- **Layers**: collision layer view
- **Rulegroups**: splittable groups, components, rerun masks, and involved rules
- **Source**: best-effort annotated source view
- **Winconditions**: wincondition list and object involvement

### Objects Tab

The Objects tab is an object trait matrix. Rows are objects. Columns include:

- object name
- collision layer
- quantity state: `constant`, `can increase`, `can decrease`, or `dynamic`
- static
- temporary
- cosmetic
- merge group
- related rule count or rule involvement
- win role

If object thumbnails are available later, the design can add a compact thumbnail/name cell without changing the table semantics.

### Rules Tab

The Rules tab should prefer source-facing presentation, but static analysis happens after compile, so the UI must be clear about source-vs-compiled facts.

Where mapping is available, show a source rule first and nest compiled/analyzed rule facts beneath it. Where mapping is uncertain or one source rule expands into multiple compiled rules, label that explicitly instead of pretending there is a perfect one-to-one mapping.

### Source Tab

The Source tab is a secondary drill-down, not the main browsing spine. It can annotate object declarations and source rules with static-analysis attributes, but it must present this as a best-effort map back to source text.

## Cell Inspectors

Matrix cells should have consistent click behavior:

- Plain count cells open a list of the underlying items.
- Trait cells explain the trait in normal language first, then show analyzer fields/facts.
- `action` and `tick` cells explain semantic input behavior, not just proof labels.
- `mergable objects` cells show merge groups and per-group savings.
- Rules cells distinguish source-facing rules from compiled/analyzed rules.
- Candidate/proved/rejected facts show status, evidence, and blockers where available.

Inspectors should support navigation to related object rows, rules, source lines, or the editor link when those targets exist.

## Visual Design

Use one coherent theme across the page chrome, controls, tables, inspectors, and detail views. Avoid mixing a light page with a dark table.

The table design should be compact enough to fit common desktop widths. Prefer:

- tight but readable padding
- short column labels
- grouped column headers
- semantic color accents
- text values alongside color
- horizontal scrolling only as a fallback

Color should help scanning but not carry meaning alone.

## Implementation Shape

Keep the existing static-generator architecture. Refactor `src/tests/build_static_analysis_explorer.js` into clearer model and rendering helpers without introducing a frontend framework.

Suggested implementation units:

- Corpus model: grouped game-level metrics, mergable-object savings, action/tick states, sort/search text.
- Game model: object rows, layer rows, rule rows, rulegroup rows, source mapping metadata, wincondition rows.
- View rendering: corpus view, game view, tabs, matrices, cell inspectors.
- Styling: compact consistent theme with semantic colors and responsive fallbacks.

## Testing

Extend `src/tests/static_analysis_explorer_node.js` to cover:

- corpus model fields and grouped metric labels
- mergable-object savings calculation
- action state values: `action`, `none`, `disabled`
- tick state values: `tick`, `none`
- temporary object counts
- cosmetic rule and inert command rule counts
- splittable rulegroup counts
- object matrix fields
- source-vs-compiled rule wording where representative mapping data exists
- rendered HTML includes the major view labels and inspector affordances

The redesign should preserve the existing `make static_analysis_explorer` entrypoint.

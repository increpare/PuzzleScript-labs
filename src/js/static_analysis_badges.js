'use strict';

// Turns a static-analysis report (static_analysis.js) into badges placed on
// source lines, each with a hover description. Used by MIS95's Static analysis
// tab; pure, so it also runs in node.
//
// A badge is { t: text, k: kind, d: description, n: true when it reports a
// false/empty/rejected result (hidden unless negatives are shown) }.
// Kinds: 'on' (true flag), 'off' (false flag), 'list', 'val', and a fact's
// status: 'proved', 'candidate', 'rejected'.

const CLAIMS = require('../tests/static_analysis_claim_descriptions.json');

// Descriptions for tags the claim file does not cover, or covers under another name.
const OWN = {
    // rules
    command_only: 'The rule only issues commands: it writes no objects and no movements.',
    inert_command_only: 'The rule only issues inert commands (message, sfx0–sfx10), so it cannot change game state.',
    object_mutating: 'The rule RHS may add or remove objects.',
    writes_movement: 'The rule RHS may set or clear movements.',
    movement_only: 'The rule writes movements but no objects, and issues no semantic command (cancel, again, restart, win, checkpoint).',
    reads_action: 'The rule LHS reads the action movement.',
    has_again: 'The rule issues the again command.',
    force_always_run: 'The rule has an empty LHS, so it runs every turn.',
    solver_state_active: 'The rule may change solver-visible state: it is not inert-command-only and has a non-inert effect.',
    rigid_active: 'A rigid rule with a non-inert effect.',
    late: 'Late rule: runs after movement is resolved.',
    rigid: 'Rigid rule: if its movement fails, the whole turn is undone.',
    random_rule: 'Random rule: one match is picked at random each time the group runs.',
    random: 'Random rule group: one match among its rules is picked at random.',
    direction: 'Directions this source line was compiled into (one compiled rule per direction).',
    commands: 'Commands issued by the rule.',
    group: 'Rule group this line starts. A group is a rule plus the + rules after it; it loops until none of them fires.',
    // objects
    present_in_all_levels: 'Object appears in every playable level.',
    present_in_some_levels: 'Object appears in some, but not all, playable levels.',
    present_in_no_levels: 'Object appears in no playable level.',
    may_be_created: 'A solver-active rule may write this object present in a cell.',
    may_be_destroyed: 'A solver-active rule may write this object absent from a cell.',
    'quantity.never_increases': 'No solver-active rule increases the total board count of this object.',
    'quantity.never_decreases': 'No solver-active rule decreases the total board count of this object.',
    layer: 'Collision layer this object is on.',
    // layers
    'layer.inert': 'No object on this layer is the player, is mentioned by any rule, or is read by a win condition.',
    'layer.static': 'Every object on this layer is static.',
    // win conditions
    plain: 'A plain win condition (no "on" clause), such as "Some X" or "No X".',
    // legend
    property: 'Legend property: any one of its members.',
    synonym: 'Legend synonym: another name for one object.',
    aggregate: 'Legend aggregate: all of its members together in one cell.',
    // game
    has_action_input: 'Action input is enabled (no noaction metadata).',
    run_rules_on_level_start: 'The run_rules_on_level_start metadata flag is set.',
    'game.has_again': 'Some rule issues again.',
    can_win: 'Some level can be won: there are win conditions, or a rule issues win.',
    has_random: 'Some rule is random, spawns random objects, or uses randomdir.',
    has_rigid: 'Some rule is rigid.',
    has_action_rules: 'Some rule reads the action movement.',
    has_autonomous_tick_rules: 'Some solver-active rule fires without needing player input movement.',
    // facts with no claim entry
    program_flow: 'Whole-program rule wake edges: which rules may make which others newly matchable.',
    wakes: 'Rules this rule may make newly matchable (program_flow wake edges).',
    woken_by: 'Rules that may make this rule newly matchable (program_flow wake edges).',
    again_rule: 'Firing this rule queues again (program_flow again_rules).',
    wakes_win: 'Win conditions this rule may affect (winflow wake edges).',
    woken_by_rules: 'Rules that may affect this win condition (winflow wake edges).',
    win_relevant: 'Kept by the backward win-relevance slice: may matter for winning.',
    win_irrelevant: 'Solver-active, but outside the backward win-relevance slice: cannot affect winning.',
    win_root: 'Seeds the win-relevance slice.',
    semantic_root: 'Seeds the win-relevance slice through a semantic command (cancel, again, restart, win, checkpoint).',
    movement_root: 'Seeds the win-relevance slice through movement.',
    movement_collision_root: 'Seeds the win-relevance slice through movement collisions.',
    schema: 'Mechanic schema fingerprint this rule matches (mechanic_profile).',
    hash_projected: 'Can be projected out of forward solver hashes (solver_hash_projection).',
    transient: 'Proved absent at stable turn boundaries (solver_hash_projection).',
    tick_restart_possible: 'A tick may restart the level (program_flow).',
    mergeable: 'Same-layer object pair that the solver may treat as one object (mergeability).',
    count_sum: 'Linear count invariant over a group of objects (linear_count_invariants).',
    unreachable: 'Objects proved never to exist in this level by the conservative closure.',
    created_here: 'Objects added by the creation closure beyond the level\'s initial board.',
    wake_masks: 'Per-rule certified wake masks: what the rule reads and writes, with polarity (certified_wake_masks).',
    setup: 'Whether the rule only sets up the board and then goes quiet (rule_setup).',
    flow: 'Rule-group split and single-pass analysis (rulegroup_flow).',
};
// Report key -> claim-file field name.
const ALIASES = {
    may_be_created: 'created_by_rules',
    may_be_destroyed: 'destroyed_by_rules',
    'quantity.never_increases': 'quantity_never_increases',
    'quantity.never_decreases': 'quantity_never_decreases',
};
const SCHEMA_FOR = { object: 'object_tags', rule: 'rule_tags', win: 'wincondition_tags', group: 'rulegroup_flow' };
// Families that describe the whole game rather than one line.
const GAME_FAMILIES = new Set(['program_flow', 'winflow', 'win_relevance', 'mechanic_profile', 'movement_action', 'solver_hash_projection']);
const MAX_INLINE = 3, MAX_INLINE_CHARS = 36, MAX_TIP_ITEMS = 60;

let claimIndex = null;
function claims() {
    if (claimIndex) return claimIndex;
    claimIndex = { bySchema: {}, families: {} };
    for (const schema of CLAIMS.fixtureSchemas) {
        const map = claimIndex.bySchema[schema.name] = {};
        claimIndex.families[schema.name] = schema.description;
        const walk = fields => {
            for (const field of fields || []) {
                const text = [field.description, field.specification].filter(Boolean).join('\n');
                if (!map[field.name]) map[field.name] = text;
                walk(field.fields);
                if (field.items) walk(field.items.fields);
            }
        };
        walk(schema.fields);
    }
    return claimIndex;
}

function describe(scope, key) {
    const index = claims();
    const name = ALIASES[key] || key;
    const schema = SCHEMA_FOR[scope];
    return (schema && index.bySchema[schema][name]) || OWN[scope + '.' + key] || OWN[key]
        || Object.values(index.bySchema).map(map => map[name]).find(Boolean) || '';
}

function familyDescription(family) {
    return claims().families[family] || OWN[family] || '';
}

function listText(items) {
    const shown = items.slice(0, MAX_TIP_ITEMS).join(', ');
    return items.length > MAX_TIP_ITEMS ? `${shown}, … (${items.length} in all)` : shown;
}

function tip(title, description, extra) {
    return [title, description, ...(extra || [])].filter(Boolean).join('\n\n');
}

function flag(scope, key, value, label) {
    return { t: label || key, k: value ? 'on' : 'off', d: tip(`${label || key}: ${value}`, describe(scope, key)), n: !value };
}

function list(scope, key, items, label) {
    label = label || key;
    if (!items.length) return { t: `${label}: none`, k: 'off', d: tip(`${label}: none`, describe(scope, key)), n: true };
    const inline = items.join(', ');
    const text = items.length <= MAX_INLINE && inline.length <= MAX_INLINE_CHARS ? `${label}: ${inline}` : `${label} ×${items.length}`;
    return { t: text, k: 'list', d: tip(`${label} (${items.length})`, describe(scope, key), [listText(items)]) };
}

function value(scope, key, text, extra) {
    return { t: `${key}: ${text}`, k: 'val', d: tip(`${key}: ${text}`, describe(scope, key), extra) };
}

// Tags for one entity. Booleans become flags, arrays lists, nested objects
// (quantity) are flattened, anything else is shown as a value.
function tagBadges(scope, tags, skip) {
    const out = [];
    for (const [key, raw] of Object.entries(tags || {})) {
        if (skip && skip.has(key)) continue;
        if (typeof raw === 'boolean') out.push(flag(scope, key, raw));
        else if (Array.isArray(raw)) out.push(list(scope, key, raw.map(String)));
        else if (raw && typeof raw === 'object') {
            for (const [sub, v] of Object.entries(raw)) {
                if (typeof v === 'boolean') out.push(flag(scope, `${key}.${sub}`, v));
                else if (Array.isArray(v)) out.push(list(scope, `${key}.${sub}`, v.map(String)));
            }
        } else if (raw !== undefined && raw !== null) out.push(value(scope, key, String(raw)));
    }
    return out;
}

// One source line can compile into several rules (one per direction). Merge
// their tags: a flag true for only some directions says which.
function mergedRuleBadges(rows) {
    const out = [];
    // Compiled rows can share a direction; number them so tips can tell them apart.
    const dirs = rows.map(rule => rule.direction);
    const rowName = rows.map((rule, i) => dirs.filter(d => d === rule.direction).length > 1 ? `${rule.direction}#${dirs.slice(0, i + 1).filter(d => d === rule.direction).length}` : rule.direction);
    if (rows.length) {
        const counts = [...new Set(dirs)].map(d => { const n = dirs.filter(x => x === d).length; return n > 1 ? `${d}×${n}` : d; });
        out.push(value('rule', 'direction', counts.join(' '), ['Compiled rules: ' + rowName.join(', ')]));
    }
    const keys = [];
    for (const rule of rows) for (const key of Object.keys(rule.tags)) if (!keys.includes(key)) keys.push(key);
    for (const key of ['late', 'rigid', 'random_rule']) {
        const on = rows.filter(rule => rule[key]).length;
        out.push(flag('rule', key, on > 0));
    }
    const commands = [...new Set(rows.flatMap(rule => (rule.commands || []).map(command => Array.isArray(command) ? command.filter(Boolean).join(' ') : String(command))))];
    if (commands.length) out.push(list('rule', 'commands', commands));
    for (const key of keys) {
        const values = rows.map(rule => rule.tags[key]);
        if (values.every(v => typeof v === 'boolean' || v === undefined)) {
            const on = rows.filter(rule => rule.tags[key] === true);
            if (on.length === 0 || on.length === rows.length) out.push(flag('rule', key, on.length > 0));
            else {
                out.push({ t: `${key} ${on.length}/${rows.length}`, k: 'on',
                    d: tip(`${key}: true for ${rowName.filter((_, i) => rows[i].tags[key] === true).join(', ')}; false for ${rowName.filter((_, i) => rows[i].tags[key] !== true).join(', ')}`, describe('rule', key)) });
            }
        } else if (values.every(v => Array.isArray(v) || v === undefined)) {
            const union = [...new Set(values.flatMap(v => v || []))].map(String);
            out.push(list('rule', key, union));
        }
    }
    return out;
}

function factStatus(facts) {
    const statuses = [...new Set(facts.map(f => f.status))];
    return statuses.length === 1 ? statuses[0] : 'candidate';
}

function factDetails(facts, ruleLine) {
    const named = items => [...new Set(items)].map(item => ruleLine.has(item) ? `${item} (line ${ruleLine.get(item)})` : String(item));
    const proof = named(facts.flatMap(f => f.proof || []));
    const blockers = named(facts.flatMap(f => f.blockers || []));
    const evidence = named(facts.flatMap(f => f.evidence || []));
    const lines = [];
    if (facts.length > 1) lines.push(facts.map(f => `${f.id}: ${f.status}`).join('\n'));
    else lines.push(`${facts[0].id}: ${facts[0].status}`);
    if (proof.length) lines.push('Proof: ' + listText(proof));
    if (blockers.length) lines.push('Blockers: ' + listText(blockers));
    if (evidence.length) lines.push('Evidence: ' + listText(evidence));
    const valueText = summarizeValue(facts[0].value, ruleLine);
    if (valueText) lines.push(valueText);
    return lines;
}

// Readable digest of a fact's value: lists of names, short scalars. Engine
// bit masks are left out.
function summarizeValue(raw, ruleLine) {
    if (raw === undefined || raw === null) return '';
    const name = item => typeof item === 'string' && ruleLine.has(item) ? `line ${ruleLine.get(item)}` : (typeof item === 'object' ? JSON.stringify(item) : String(item));
    if (Array.isArray(raw)) return raw.length ? 'Value: ' + listText(raw.map(name)) : '';
    if (typeof raw !== 'object') return 'Value: ' + String(raw);
    const lines = [];
    const walk = (object, prefix) => {
        for (const [key, v] of Object.entries(object)) {
            if (key === 'masks' || key === 'bitvec_format' || key === 'rule_ids') continue;
            const label = prefix ? `${prefix}.${key}` : key;
            if (Array.isArray(v)) {
                if (!v.length) continue;
                if (v.every(item => item && typeof item === 'object' && 'from' in item && 'to' in item)) {
                    lines.push(`${label}: ${v.length} edges`);
                } else lines.push(`${label}: ${listText([...new Set(v.map(name))])}`);
            } else if (v && typeof v === 'object') walk(v, label);
            else if (v !== null && v !== undefined) lines.push(`${label}: ${v}`);
        }
    };
    walk(raw, '');
    return lines.join('\n');
}

function factBadge(label, facts, ruleLine, descriptionKey) {
    const status = factStatus(facts);
    const description = OWN[descriptionKey] || familyDescription(facts[0].family);
    return { t: label, k: status, d: tip(`${label} — ${facts[0].family}`, description, factDetails(facts, ruleLine)), n: status === 'rejected' };
}

function lineNumbers(sourceText) {
    // Collision layer i is the i-th non-blank line of COLLISIONLAYERS, after
    // removing (possibly nested, multi-line) comments. Legend names are found
    // here too: the compiler's original_line_numbers misses punctuation names
    // such as "." or "#", which its \bname\b search cannot match. The same
    // goes for glyphs given on an object's own line ("Player !"), so OBJECTS
    // lines are kept as word lists too.
    const lines = String(sourceText || '').split('\n');
    let depth = 0, section = '';
    const layerLines = [], legendLines = new Map(), objectLines = [];
    const sections = new Set(['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels']);
    lines.forEach((line, index) => {
        let text = '';
        for (const ch of line) {
            if (ch === '(') depth++;
            else if (ch === ')' && depth > 0) depth--;
            else if (depth === 0) text += ch;
        }
        const trimmed = text.trim();
        if (!trimmed || /^=+$/.test(trimmed)) return;
        if (sections.has(trimmed.toLowerCase())) { section = trimmed.toLowerCase(); return; }
        if (section === 'objects') objectLines.push({ line: index + 1, words: trimmed.toLowerCase().split(/\s+/) });
        if (section === 'collisionlayers') layerLines.push({ line: index + 1, words: trimmed.toLowerCase().split(/[\s,]+/).filter(Boolean) });
        const legend = section === 'legend' && /^(\S+?)\s*=/.exec(trimmed);
        if (legend && !legendLines.has(legend[1].toLowerCase())) legendLines.set(legend[1].toLowerCase(), index + 1);
    });
    return { layerLines, legendLines, objectLines };
}

function layerLine(layer, layerLines, propertyMembers) {
    const covers = entry => entry.words.some(word => layer.canonical_objects.includes(word)
        || (propertyMembers.get(word) || []).some(member => layer.canonical_objects.includes(member)));
    const direct = layerLines[layer.id];
    if (direct && covers(direct)) return direct.line;
    const found = layerLines.find(covers);
    return found ? found.line : null;
}

// info: { nameLines: canonical name -> 1-based line (compiler original_line_numbers),
//         levelLines: compiled level index -> 1-based line or null, sourceText,
//         anyBoard: the report was made with arbitraryBoards (its one level is
//         a stand-in for every board, so level tags are left out) }
function buildBadges(report, info) {
    const tagged = report.ps_tagged;
    const lines = new Map();
    const game = [];
    const add = (line, badges) => {
        if (!line) { game.push(...badges); return; }
        if (!lines.has(line)) lines.set(line, []);
        lines.get(line).push(...badges);
    };
    const nameLines = info.nameLines || {};
    const objectLine = new Map(tagged.objects.map(object => [object.name, nameLines[object.canonical_name] || null]));

    // Rules, grouped by source line; groups mark their first line.
    const ruleLine = new Map(), rowsByLine = new Map(), groupLine = new Map();
    for (const section of tagged.rule_sections) {
        for (const group of section.groups) {
            groupLine.set(group.id, group.source_line_min);
            for (const rule of group.rules) {
                ruleLine.set(rule.id, rule.source_line);
                if (!rowsByLine.has(rule.source_line)) rowsByLine.set(rule.source_line, []);
                rowsByLine.get(rule.source_line).push(rule);
            }
        }
    }
    for (const section of tagged.rule_sections) {
        for (const group of section.groups) {
            // A one-line group's tags are its rule's tags.
            const groupLines = new Set(group.rules.map(rule => rule.source_line)).size;
            if (groupLines < 2 && !group.random) continue;
            const badges = [value('group', 'group', `${group.id} (${groupLines} lines, ${group.source_line_min}–${group.source_line_max})`)];
            badges.push(flag('group', 'random', !!group.random, 'group.random'));
            for (const badge of tagBadges('group', group.tags)) { badge.t = 'group.' + badge.t; add(group.source_line_min, [badge]); }
            add(group.source_line_min, badges);
        }
    }
    for (const [line, rows] of rowsByLine) add(line, mergedRuleBadges(rows));

    // Objects, legend names, layers, win conditions, levels.
    const scanned = lineNumbers(info.sourceText);
    const propertyMembers = new Map();
    for (const property of tagged.properties) {
        propertyMembers.set(property.canonical_name, property.members.map(member => member.toLowerCase()));
    }
    const levelPresence = new Set(info.anyBoard ? ['present_in_all_levels', 'present_in_some_levels', 'present_in_no_levels'] : []);
    for (const object of tagged.objects) {
        add(objectLine.get(object.name), [
            value('object', 'layer', String(object.layer)),
            ...tagBadges('object', object.tags, levelPresence),
        ].map(badge => objectLine.get(object.name) ? badge : Object.assign(badge, { t: `${object.name}: ${badge.t}` })));
    }
    for (const property of tagged.properties) {
        // A synonym given on its object's declaration line: "Player !".
        const target = property.kind === 'synonym' && property.members.length === 1 && property.members[0].toLowerCase();
        const declared = target && scanned.objectLines.find(entry => entry.words[0] === target && entry.words.indexOf(property.canonical_name) > 0);
        const line = scanned.legendLines.get(property.canonical_name) || (declared && declared.line) || nameLines[property.canonical_name];
        if (!line) continue;
        const onObjectLine = !scanned.legendLines.has(property.canonical_name) && declared && declared.line === line;
        add(line, [{ t: onObjectLine ? `${property.kind}: ${property.name}` : property.kind, k: 'val', d: tip(`${property.kind}: ${property.name}`, describe('legend', property.kind), ['Members: ' + listText(property.members)]) },
            ...tagBadges('legend', property.tags)]);
    }
    const layerLines = scanned.layerLines;
    const layerLineById = new Map();
    for (const layer of tagged.collision_layers) {
        const line = layerLine(layer, layerLines, propertyMembers);
        layerLineById.set(layer.id, line);
        add(line, [value('layer', 'layer', String(layer.id), ['Objects: ' + listText(layer.objects)]), ...tagBadges('layer', layer.tags)]);
    }
    const winLine = new Map();
    for (const win of tagged.winconditions) {
        winLine.set(win.id, win.source_line);
        add(win.source_line, tagBadges('win', win.tags));
    }
    const levelLines = info.anyBoard ? [] : (info.levelLines || []);
    for (const level of tagged.levels) {
        if (level.kind !== 'level' || !levelLines[level.index]) continue;
        add(levelLines[level.index], [value('level', 'level', `${level.index} (${level.width}×${level.height})`),
            list('level', 'objects_present', level.objects_present), ...tagBadges('level', level.tags)]);
    }

    // Facts.
    const subjectLines = f => {
        const s = f.subjects || {}, out = [];
        for (const name of s.objects || []) out.push({ line: objectLine.get(name), subject: name, prefix: `object_${name}_` });
        for (const id of s.layers || []) out.push({ line: layerLineById.get(id), subject: `layer ${id}`, prefix: `layer_${id}_` });
        for (const index of s.levels || []) out.push({ line: levelLines[index], subject: `level ${index}`, prefix: `level_${index}_` });
        for (const id of s.groups || []) out.push({ line: groupLine.get(id), subject: id, prefix: `${id}_` });
        for (const id of s.rules || []) out.push({ line: ruleLine.get(id), subject: id, prefix: `${id}_` });
        return out;
    };
    const perLine = new Map(); // line -> label -> facts
    const pushFact = (line, label, f, key) => {
        if (!perLine.has(line)) perLine.set(line, new Map());
        const labels = perLine.get(line);
        if (!labels.has(label)) labels.set(label, { facts: [], key });
        labels.get(label).facts.push(f);
    };
    for (const [family, facts] of Object.entries(report.facts || {})) {
        if (GAME_FAMILIES.has(family)) continue;
        for (const f of facts) {
            const targets = subjectLines(f);
            if (family === 'mergeability') {
                const [a, b] = (f.subjects.objects || []);
                pushFact(objectLine.get(a) || 0, `merge ↔ ${b}`, f, 'mergeable');
                pushFact(objectLine.get(b) || 0, `merge ↔ ${a}`, f, 'mergeable');
                continue;
            }
            if (family === 'linear_count_invariants') {
                const terms = f.value && f.value.terms;
                const label = 'Σ ' + (terms ? terms.map(term => `${term.coefficient === 1 ? '' : term.coefficient + '·'}${term.object}`).join(' + ') : (f.subjects.objects || []).join(' + '));
                for (const target of targets) pushFact(target.line || 0, label, f, 'count_sum');
                continue;
            }
            if (family === 'per_level_object_universe' && f.value) {
                const line = levelLines[f.value.level_index] || 0;
                pushFact(line, 'object_universe', f);
                continue;
            }
            if (!targets.length) { pushFact(0, f.id, f); continue; }
            for (const target of targets) {
                let label = f.id.startsWith(target.prefix) ? f.id.slice(target.prefix.length) : f.id;
                if (!target.line) label = `${target.subject}: ${label}`;
                pushFact(target.line || 0, label, f, label);
            }
        }
    }
    for (const [line, labels] of perLine) {
        for (const [label, entry] of labels) add(line, [factBadge(label, entry.facts, ruleLine, entry.key)]);
    }

    // Whole-program facts, projected onto rule and win-condition lines.
    const factsOf = family => (report.facts && report.facts[family]) || [];
    const linesOf = ids => [...new Set(ids.map(id => ruleLine.get(id) || winLine.get(id)).filter(Boolean))].sort((x, y) => x - y);
    const edgesBadge = (key, targets) => targets.length
        ? { t: targets.length <= 3 ? `${key}: ${targets.map(l => 'L' + l).join(' ')}` : `${key} ×${targets.length}`, k: 'list', d: tip(`${key} (${targets.length} lines)`, OWN[key], ['Lines: ' + listText(targets.map(String))]) }
        : { t: `${key}: none`, k: 'off', d: tip(`${key}: none`, OWN[key]), n: true };
    const flow = factsOf('program_flow')[0];
    if (flow && flow.value) {
        const out = new Map(), into = new Map();
        for (const edge of flow.value.wake_edges || []) {
            const from = ruleLine.get(edge.from), to = ruleLine.get(edge.to);
            if (!from || !to) continue;
            if (!out.has(from)) out.set(from, new Set());
            if (!into.has(to)) into.set(to, new Set());
            out.get(from).add(to); into.get(to).add(from);
        }
        for (const line of rowsByLine.keys()) {
            add(line, [edgesBadge('wakes', [...(out.get(line) || [])].sort((x, y) => x - y)),
                edgesBadge('woken_by', [...(into.get(line) || [])].sort((x, y) => x - y))]);
        }
        for (const line of linesOf(flow.value.again_rules || [])) add(line, [{ t: 'again_rule', k: 'on', d: tip('again_rule', OWN.again_rule) }]);
    }
    const winflow = factsOf('winflow')[0];
    if (winflow && winflow.value) {
        const out = new Map(), into = new Map();
        for (const edge of winflow.value.wake_edges || []) {
            const from = ruleLine.get(edge.from), to = winLine.get(edge.to);
            if (!from || !to) continue;
            if (!out.has(from)) out.set(from, new Set());
            if (!into.has(to)) into.set(to, new Set());
            out.get(from).add(to); into.get(to).add(from);
        }
        for (const line of rowsByLine.keys()) add(line, [edgesBadge('wakes_win', [...(out.get(line) || [])].sort((x, y) => x - y))]);
        for (const line of winLine.values()) add(line, [edgesBadge('woken_by_rules', [...(into.get(line) || [])].sort((x, y) => x - y))]);
    }
    const relevance = factsOf('win_relevance')[0];
    if (relevance && relevance.value) {
        const v = relevance.value;
        const mark = (ids, key, negative) => {
            for (const line of linesOf(ids || [])) {
                const n = ids.filter(id => ruleLine.get(id) === line).length, all = rowsByLine.get(line).length;
                add(line, [{ t: n === all ? key : `${key} ${n}/${all}`, k: negative ? 'off' : 'on', d: tip(key, OWN[key]), n: !!negative }]);
            }
        };
        mark(v.relevant_rule_ids, 'win_relevant');
        mark(v.irrelevant_rule_ids, 'win_irrelevant', false);
        mark(v.root_rule_ids, 'win_root');
        mark(v.semantic_root_rule_ids, 'semantic_root');
        mark(v.movement_root_rule_ids, 'movement_root');
        mark(v.movement_collision_root_rule_ids, 'movement_collision_root');
    }
    const profile = factsOf('mechanic_profile')[0];
    if (profile && profile.value && profile.value.rule_ids_by_schema) {
        for (const [schema, ids] of Object.entries(profile.value.rule_ids_by_schema)) {
            for (const line of linesOf(ids)) add(line, [{ t: `schema: ${schema}`, k: 'val', d: tip(`schema: ${schema}`, OWN.schema) }]);
        }
    }
    const hash = factsOf('solver_hash_projection')[0];
    if (hash && hash.value) {
        for (const name of hash.value.projected_objects || []) add(objectLine.get(name), [{ t: 'hash_projected', k: hash.status, d: tip('hash_projected', OWN.hash_projected, factDetails([hash], ruleLine)) }]);
        for (const name of hash.value.transient_objects || []) add(objectLine.get(name), [{ t: 'transient', k: hash.status, d: tip('transient', OWN.transient, factDetails([hash], ruleLine)) }]);
    }

    // Game strip: game tags and every whole-game fact.
    game.unshift(...tagBadges('game', tagged.game.tags, new Set(['mechanic_profile'])));
    if (tagged.game.tags.mechanic_profile) {
        const mp = tagged.game.tags.mechanic_profile;
        game.push(list('game', 'schemas', mp.schemas || [], 'mechanic schemas'));
    }
    for (const family of GAME_FAMILIES) for (const f of factsOf(family)) game.push(factBadge(f.id, [f], ruleLine, f.id));

    const order = { val: 0, on: 1, list: 2, proved: 3, candidate: 4, rejected: 5, off: 6 };
    const sorted = [...lines.entries()].sort((x, y) => x[0] - y[0]).map(([line, badges]) => [line,
        badges.map((badge, i) => [badge, i]).sort((x, y) => (order[x[0].k] - order[y[0].k]) || (x[1] - y[1])).map(pair => pair[0])]);
    return { game, lines: sorted, summary: report.summary };
}

module.exports = { buildBadges, describe };

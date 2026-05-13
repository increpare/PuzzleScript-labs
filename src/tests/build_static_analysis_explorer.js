#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { analyzeFile, discoverInputFiles } = require('./ps_static_analysis');

const DEFAULT_OUT = 'build/static-analysis-explorer/index.html';
const PARTITION_CLASSES = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
const MAX_RULEGROUPS_PER_GAME = 80;
const MAX_RULES_PER_GROUP = 120;
const MAX_RULE_TEXT = 260;
const MAX_INTERACTION_EDGES = 80;
const MAX_RERUN_MASKS = 80;
const MAX_RERUN_MASK_ENTRIES = 80;
const MAX_COMPONENT_RULE_IDS = 600;
const MAX_WINFLOW_EDGES = 80;

function usage(exitCode = 1) {
    const text = [
        'Usage: node src/tests/build_static_analysis_explorer.js <file-or-dir> [more paths]',
        '  [--out PATH] [--game SUBSTRING]',
    ].join('\n');
    (exitCode === 0 ? process.stdout : process.stderr).write(`${text}\n`);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const inputs = [];
    const options = {
        outPath: path.resolve(DEFAULT_OUT),
        gameFilter: null,
        repoRoot: path.resolve(__dirname, '..', '..'),
    };
    const args = argv.slice(2);
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) usage(args.length === 0 ? 1 : 0);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--out' && index + 1 < args.length) {
            options.outPath = path.resolve(args[++index]);
        } else if (arg === '--game' && index + 1 < args.length) {
            options.gameFilter = args[++index];
        } else if (arg.startsWith('--')) {
            throw new Error(`Unsupported argument: ${arg}`);
        } else {
            inputs.push(arg);
        }
    }
    if (inputs.length === 0) usage(1);
    return { inputs, options };
}

function relativeSourcePath(sourcePath, repoRoot) {
    const absolute = path.resolve(sourcePath);
    return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function editorHrefForSource(sourcePath, options = {}) {
    const repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..');
    const srcRoot = path.join(repoRoot, 'src');
    const relToSrc = path.relative(srcRoot, path.resolve(sourcePath)).split(path.sep).join('/');
    return `/src/editor.html?file=${encodeURIComponent(relToSrc)}`;
}

function facts(report, family) {
    return (report.facts && report.facts[family]) || [];
}

function truncateText(value, maxLength = MAX_RULE_TEXT) {
    const text = String(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function allRules(report) {
    const sections = report.ps_tagged ? report.ps_tagged.rule_sections || [] : [];
    return sections.flatMap(section =>
        section.groups.flatMap(group =>
            group.rules.map(rule => ({ section, group, rule }))
        )
    );
}

function termName(term) {
    const ref = term.ref || {};
    if (ref.type === 'object_set') return `{${truncateText(ref.source || `${(ref.objects || []).length} objects`, 80)}}`;
    if (ref.type === 'ellipsis') return '...';
    return ref.name || ref.canonical_name || '?';
}

function termText(term) {
    const parts = [];
    if (term.kind === 'absent') parts.push('no');
    if (term.kind === 'random_object') parts.push('random');
    if (term.movement) parts.push(term.movement);
    parts.push(termName(term));
    return parts.join(' ');
}

function sideText(side) {
    if (!Array.isArray(side) || side.length === 0) return '';
    return side.map(row => `[ ${row.map(cell => cell.map(termText).join(' ')).join(' | ')} ]`).join(' ');
}

function ruleText(rule) {
    const prefix = [];
    if (rule.late) prefix.push('late');
    if (rule.rigid) prefix.push('rigid');
    if (rule.random_rule) prefix.push('random');
    if (rule.direction && rule.direction !== '0') prefix.push(rule.direction);
    const replacement = rule.rhs && rule.rhs.length > 0 ? ` -> ${sideText(rule.rhs)}` : '';
    const commands = (rule.commands || []).map(command => command[0]).join(' ');
    return `${prefix.join(' ')} ${sideText(rule.lhs)}${replacement}${commands ? ` ${commands}` : ''}`.trim();
}

function flowForGroup(report, groupId) {
    return facts(report, 'rulegroup_flow').find(item => item.subjects.groups[0] === groupId) || null;
}

function mergeableGroupsFromPairs(pairs) {
    const parent = new Map();

    function find(name) {
        if (!parent.has(name)) parent.set(name, name);
        const current = parent.get(name);
        if (current === name) return name;
        const root = find(current);
        parent.set(name, root);
        return root;
    }

    function union(left, right) {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot === rightRoot) return;
        const [first, second] = [leftRoot, rightRoot].sort();
        parent.set(second, first);
    }

    for (const pair of pairs) {
        const objects = pair.objects || [];
        if (objects.length < 2) continue;
        for (const object of objects) find(object);
        union(objects[0], objects[1]);
    }

    const groupsByRoot = new Map();
    for (const object of parent.keys()) {
        const root = find(object);
        if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
        groupsByRoot.get(root).push(object);
    }

    return Array.from(groupsByRoot.values())
        .map(objects => objects.sort())
        .filter(objects => objects.length > 1)
        .sort((left, right) => left[0].localeCompare(right[0]) || left.length - right.length)
        .map((objects, index) => ({ id: `merge_group_${index}`, objects, label: objects.join(', ') }));
}

function componentIndexByRule(flow) {
    const index = new Map();
    if (!flow || !flow.value || !Array.isArray(flow.value.components)) return index;
    flow.value.components.forEach((component, componentIndex) => {
        for (const ruleId of component) index.set(ruleId, componentIndex);
    });
    return index;
}

function hasNonEmptyRerunMask(flow) {
    return Object.values((flow && flow.value && flow.value.rerun_masks) || {}).some(mask => mask.length > 0);
}

function quantityBehavior(object) {
    const quantity = (object.tags && object.tags.quantity) || {};
    const neverIncreases = quantity.never_increases === true;
    const neverDecreases = quantity.never_decreases === true;
    if (neverIncreases && neverDecreases) return 'constant';
    if (!neverIncreases && neverDecreases) return 'can_increase';
    if (neverIncreases && !neverDecreases) return 'can_decrease';
    return 'dynamic';
}

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

function factItem(label, value) {
    return {
        label,
        value: value == null || value === '' ? '-' : String(value),
    };
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

function summarizeQuantity(objects) {
    const groups = {
        constant: [],
        can_increase: [],
        can_decrease: [],
        dynamic: [],
    };
    for (const object of objects) {
        groups[quantityBehavior(object)].push(object.name);
    }
    return groups;
}

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
    if (programFlow.has_action_rules === false && programFlow.wake_edge_count === 0) return 'none';
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

function actionNoopSummary(report) {
    const actionNoop = facts(report, 'movement_action')
        .find(item => item.id === 'action_noop') || null;
    if (!actionNoop) {
        return { status: 'unknown', value: false, blockers: [] };
    }
    return {
        status: actionNoop.status,
        value: actionNoop.value === true,
        blockers: (actionNoop.blockers || []).slice(),
    };
}

function programFlowSummary(report) {
    const gameTags = report.ps_tagged && report.ps_tagged.game ? report.ps_tagged.game.tags || {} : {};
    const programFlow = facts(report, 'program_flow')[0] || null;
    const value = (programFlow && programFlow.value) || {};
    return {
        action_input: gameTags.has_action_input !== false,
        tick_noop: gameTags.has_autonomous_tick_rules !== true,
        no_again: gameTags.has_again !== true,
        no_random: gameTags.has_random !== true,
        has_action_rules: gameTags.has_action_rules === true,
        wake_edge_count: Array.isArray(value.wake_edges) ? value.wake_edges.length : 0,
        again_rule_count: Array.isArray(value.again_rules) ? value.again_rules.length : 0,
        tick_restart_possible: value.tick_restart_possible === true,
    };
}

function winconditionText(wincondition) {
    const quantifier = {
        [-1]: 'No',
        0: 'Some',
        1: 'All',
    }[wincondition.quantifier] || `Win ${wincondition.quantifier}`;
    const subjects = (wincondition.subjects || []).join(' or ') || '?';
    const targets = (wincondition.targets || []).join(' or ');
    return targets ? `${quantifier} ${subjects} On ${targets}` : `${quantifier} ${subjects}`;
}

function summarizeWinflow(report) {
    const winflow = facts(report, 'winflow')[0] || null;
    const value = (winflow && winflow.value) || {};
    const ruleById = new Map(allRules(report).map(entry => [entry.rule.id, entry]));
    const winById = new Map(((report.ps_tagged && report.ps_tagged.winconditions) || [])
        .map(wincondition => [wincondition.id, wincondition]));
    const wakeEdges = (value.wake_edges || []).slice(0, MAX_WINFLOW_EDGES).map(edge => {
        const ruleEntry = ruleById.get(edge.from);
        const wincondition = winById.get(edge.to);
        return {
            from: edge.from,
            to: edge.to,
            from_text: ruleEntry ? ruleText(ruleEntry.rule) : edge.from,
            to_text: wincondition ? winconditionText(wincondition) : edge.to,
            reasons: (edge.reasons || []).slice(),
        };
    });
    return {
        rule_count: Array.isArray(value.rule_ids) ? value.rule_ids.length : 0,
        win_count: Array.isArray(value.win_ids) ? value.win_ids.length : 0,
        wake_edge_count: Array.isArray(value.wake_edges) ? value.wake_edges.length : 0,
        wake_edges: wakeEdges,
        wake_edges_omitted: Math.max(0, ((value.wake_edges || []).length) - wakeEdges.length),
    };
}

function compactComponents(components) {
    const ruleIdCount = components.reduce((sum, component) => sum + component.length, 0);
    if (ruleIdCount > MAX_COMPONENT_RULE_IDS) return [];
    return components;
}

function compactRerunMasks(rerunMasks) {
    const entries = Object.entries(rerunMasks || {})
        .filter(([, mask]) => Array.isArray(mask) && mask.length > 0)
        .slice(0, MAX_RERUN_MASKS)
        .map(([ruleId, mask]) => [ruleId, mask.slice(0, MAX_RERUN_MASK_ENTRIES)]);
    return Object.fromEntries(entries);
}

function sortRulegroupInterest(left, right) {
    return Number(right.split_candidate) - Number(left.split_candidate)
        || right.component_count - left.component_count
        || right.rules_total - left.rules_total
        || right.interaction_edge_count - left.interaction_edge_count
        || left.id.localeCompare(right.id);
}

function summarizeObjectRows(report, mergeableGroups) {
    const objects = report.ps_tagged ? report.ps_tagged.objects || [] : [];
    const rules = allRules(report);
    const winconditions = report.ps_tagged ? report.ps_tagged.winconditions || [] : [];
    const mergeByObject = mergeGroupIdByObject(mergeableGroups);
    return objects.map(object => {
        const row = {
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
        };
        row.inspector = inspectorPayload(`Object ${object.name}`, [
            factItem('layer', row.layer),
            factItem('quantity', row.quantity),
            factItem('static', yesNo(row.static)),
            factItem('temporary', yesNo(row.temporary)),
            factItem('cosmetic', yesNo(row.cosmetic)),
            factItem('merge group', row.merge_group || '-'),
            factItem('rules touching object', row.rule_count),
            factItem('win role', row.win_role),
        ]);
        return row;
    });
}

function summarizeLayerRows(report) {
    const layers = report.ps_tagged ? report.ps_tagged.collision_layers || [] : [];
    return layers.map(layer => {
        const row = {
            id: layer.id,
            objects: layer.objects || [],
            object_count: (layer.objects || []).length,
            static: Boolean(layer.tags && layer.tags.static),
            inert: Boolean(layer.tags && layer.tags.inert),
        };
        row.inspector = inspectorPayload(`Layer ${layer.id}`, [
            factItem('objects', row.objects.join(', ') || '-'),
            factItem('object count', row.object_count),
            factItem('static', yesNo(row.static)),
            factItem('inert', yesNo(row.inert)),
        ]);
        return row;
    });
}

function summarizeRuleRows(report) {
    return allRules(report).map(entry => {
        const row = {
            compiled_id: entry.rule.id,
            group: entry.group.id,
            section: entry.section.name,
            source_line: entry.rule.source_line,
            text: ruleText(entry.rule),
            cosmetic: Boolean(entry.rule.tags && entry.rule.tags.cosmetic),
            inert_command: Boolean(entry.rule.tags && entry.rule.tags.inert_command_only),
            command_only: Boolean(entry.rule.tags && entry.rule.tags.command_only),
        };
        row.inspector = inspectorPayload(`Rule ${entry.rule.id}`, [
            factItem('line', Number.isFinite(entry.rule.source_line) ? entry.rule.source_line : 'compiled'),
            factItem('section', row.section),
            factItem('group', row.group),
            factItem('cosmetic', yesNo(row.cosmetic)),
            factItem('inert command', yesNo(row.inert_command)),
            factItem('command only', yesNo(row.command_only)),
        ], [row.text]);
        return row;
    });
}

function summarizeRulegroupRows(report) {
    if (!report.ps_tagged) return [];
    return (report.ps_tagged.rule_sections || []).flatMap(section =>
        (section.groups || []).map(group => {
            const flow = flowForGroup(report, group.id);
            const sourceLineMin = Number.isFinite(group.source_line_min) ? group.source_line_min : null;
            const sourceLineMax = Number.isFinite(group.source_line_max) ? group.source_line_max : null;
            const sourceLines = sourceLineMin == null
                ? 'compiled'
                : (sourceLineMin === sourceLineMax ? String(sourceLineMin) : `${sourceLineMin}-${sourceLineMax}`);
            const row = {
                id: group.id,
                section: section.name,
                source_lines: sourceLines,
                rule_count: group.rules.length,
                rule_preview: group.rules.slice(0, 3).map(rule => truncateText(ruleText(rule), 120)),
                splittable: Boolean(flow && flow.value && flow.value.split_candidate),
                status: flow ? flow.status : 'not_applicable',
                component_count: flow && flow.value && Array.isArray(flow.value.components) ? flow.value.components.length : 0,
                interaction_edge_count: flow && flow.value && Array.isArray(flow.value.interaction_edges) ? flow.value.interaction_edges.length : 0,
                rerun_mask_count: flow && flow.value && flow.value.rerun_masks
                    ? Object.values(flow.value.rerun_masks).filter(mask => Array.isArray(mask) && mask.length > 0).length
                    : 0,
            };
            row.inspector = inspectorPayload(`Rulegroup ${group.id}`, [
                factItem('source lines', sourceLines),
                factItem('section', section.name),
                factItem('rules', group.rules.length),
                factItem('splittable', yesNo(row.splittable)),
                factItem('flow status', row.status),
                factItem('components', row.component_count),
                factItem('interactions', row.interaction_edge_count),
                factItem('rerun masks', row.rerun_mask_count),
            ], group.rules.slice(0, 6).map(rule => ruleText(rule)));
            return row;
        })
    );
}

function summarizeWinconditionRows(report) {
    const winconditions = report.ps_tagged ? report.ps_tagged.winconditions || [] : [];
    const winflow = facts(report, 'winflow')[0] || null;
    const wakeEdges = winflow && winflow.value && Array.isArray(winflow.value.wake_edges)
        ? winflow.value.wake_edges
        : [];
    return winconditions.map(wincondition => {
        const row = {
            id: wincondition.id,
            source_line: wincondition.source_line,
            text: winconditionText(wincondition),
            subjects: wincondition.subjects || [],
            targets: wincondition.targets || [],
            wake_edge_count: wakeEdges.filter(edge => edge.to === wincondition.id).length,
        };
        row.inspector = inspectorPayload(`Wincondition ${wincondition.id}`, [
            factItem('line', Number.isFinite(wincondition.source_line) ? wincondition.source_line : 'compiled'),
            factItem('subjects', row.subjects.join(', ') || '-'),
            factItem('targets', row.targets.join(', ') || '-'),
            factItem('wake edges', row.wake_edge_count),
        ], [row.text]);
        return row;
    });
}

function summarizeSourceLines(report) {
    const text = report.source && typeof report.source.text === 'string' ? report.source.text : '';
    if (!text) return [];
    const ruleCounts = new Map();
    const ruleSummaries = new Map();
    const winconditionCounts = new Map();
    for (const entry of allRules(report)) {
        if (Number.isFinite(entry.rule.source_line)) {
            ruleCounts.set(entry.rule.source_line, (ruleCounts.get(entry.rule.source_line) || 0) + 1);
            if (!ruleSummaries.has(entry.rule.source_line)) ruleSummaries.set(entry.rule.source_line, []);
            ruleSummaries.get(entry.rule.source_line).push({
                compiled_id: entry.rule.id,
                group: entry.group.id,
                section: entry.section.name,
                text: truncateText(ruleText(entry.rule), 160),
            });
        }
    }
    for (const wincondition of (report.ps_tagged && report.ps_tagged.winconditions) || []) {
        if (Number.isFinite(wincondition.source_line)) {
            winconditionCounts.set(wincondition.source_line, (winconditionCounts.get(wincondition.source_line) || 0) + 1);
        }
    }
    const objectByName = new Map(((report.ps_tagged && report.ps_tagged.objects) || [])
        .map(object => [object.name, object]));
    return text.split(/\r?\n/).map((lineText, index) => {
        const line = index + 1;
        const object = objectByName.get(lineText.trim()) || null;
        const rulesForLine = ruleSummaries.get(line) || [];
        const groupAnnotations = Array.from(new Set(rulesForLine.map(rule => rule.group))).map(group => ({
            kind: 'rulegroup',
            label: group,
            title: rulesForLine
                .filter(rule => rule.group === group)
                .map(rule => `${rule.compiled_id}: ${rule.text}`)
                .join('\n'),
        }));
        const winconditionCount = winconditionCounts.get(line) || 0;
        const annotations = [
            ...groupAnnotations,
            ...(winconditionCount ? [{
                kind: 'wincondition',
                label: `${winconditionCount} wincondition${winconditionCount === 1 ? '' : 's'}`,
                title: 'Wincondition source line',
            }] : []),
        ];
        if (object) {
            annotations.push({
                kind: 'object',
                label: `object ${object.name}`,
                title: [
                    `quantity: ${quantityLabel(object)}`,
                    `static: ${yesNo(Boolean(object.tags && object.tags.static))}`,
                    `temporary: ${yesNo(Boolean(object.tags && object.tags.temporary))}`,
                    `cosmetic: ${yesNo(Boolean(object.tags && object.tags.cosmetic))}`,
                ].join('\n'),
            });
        }
        return {
            line,
            text: lineText,
            rule_count: ruleCounts.get(line) || 0,
            rule_summaries: rulesForLine,
            wincondition_count: winconditionCount,
            object_name: object ? object.name : null,
            object_traits: object ? {
                quantity: quantityLabel(object),
                static: Boolean(object.tags && object.tags.static),
                temporary: Boolean(object.tags && object.tags.temporary),
                cosmetic: Boolean(object.tags && object.tags.cosmetic),
            } : null,
            annotations,
        };
    });
}

function summarizeRuleGroups(report) {
    if (!report.ps_tagged) return { groups: [], total: 0, splitTotal: 0, omitted: 0 };
    const results = [];
    for (const section of report.ps_tagged.rule_sections || []) {
        for (const group of section.groups || []) {
            const flow = flowForGroup(report, group.id);
            if (!flow || (flow.status !== 'candidate' && !hasNonEmptyRerunMask(flow))) continue;
            const partition = componentIndexByRule(flow);
            const components = flow.value.components || [];
            const interactionEdges = flow.value.interaction_edges || [];
            const rerunMasks = flow.value.rerun_masks || {};
            const nonEmptyRerunMaskCount = Object.values(rerunMasks)
                .filter(mask => Array.isArray(mask) && mask.length > 0)
                .length;
            const rules = group.rules.slice(0, MAX_RULES_PER_GROUP).map(rule => ({
                id: rule.id,
                text: truncateText(ruleText(rule)),
                component: partition.has(rule.id) ? partition.get(rule.id) : null,
                tags: rule.tags,
            }));
            results.push({
                id: group.id,
                section: section.name,
                status: flow.status,
                split_candidate: Boolean(flow.value.split_candidate),
                component_count: components.length,
                components: compactComponents(components),
                interaction_edge_count: interactionEdges.length,
                interaction_edges: interactionEdges.slice(0, MAX_INTERACTION_EDGES),
                rerun_mask_count: nonEmptyRerunMaskCount,
                rerun_masks: compactRerunMasks(rerunMasks),
                rules_total: group.rules.length,
                rules_omitted: Math.max(0, group.rules.length - rules.length),
                rules,
            });
        }
    }
    results.sort(sortRulegroupInterest);
    const splitTotal = results.filter(group => group.split_candidate).length;
    return {
        groups: results.slice(0, MAX_RULEGROUPS_PER_GAME),
        total: results.length,
        splitTotal,
        omitted: Math.max(0, results.length - MAX_RULEGROUPS_PER_GAME),
    };
}

function summarizeReport(report, options = {}) {
    const repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..');
    const sourcePath = report.source && report.source.path ? report.source.path : '<memory>';
    const objects = report.ps_tagged ? report.ps_tagged.objects || [] : [];
    const layers = report.ps_tagged ? report.ps_tagged.collision_layers || [] : [];
    const rules = allRules(report);
    const mergeable = facts(report, 'mergeability')
        .filter(item => item.status === 'candidate')
        .map(item => ({ id: item.id, objects: item.subjects.objects || [] }));
    const mergeableGroups = mergeableGroupsFromPairs(mergeable);
    const transient = facts(report, 'transient_boundary')
        .filter(item => item.status === 'proved')
        .map(item => item.subjects.objects[0]);
    const staticObjects = objects.filter(object => object.tags && object.tags.static).map(object => object.name);
    const quantity = summarizeQuantity(objects);
    const neverInitialOrCreated = objects
        .filter(object => object.tags && object.tags.present_in_no_levels && !object.tags.may_be_created)
        .map(object => object.name);
    const staticLayers = layers
        .filter(layer => layer.tags && layer.tags.static)
        .map(layer => ({ id: layer.id, objects: layer.objects || [] }));
    const inertLayers = layers
        .filter(layer => layer.tags && layer.tags.inert)
        .map(layer => ({ id: layer.id, objects: layer.objects || [] }));
    const cosmeticObjects = objects
        .filter(object => object.tags && object.tags.cosmetic)
        .map(object => object.name);
    const inertRules = rules
        .filter(entry => entry.rule.tags && entry.rule.tags.inert_command_only)
        .map(entry => ({
            id: entry.rule.id,
            group: entry.group.id,
            source_line: entry.rule.source_line,
            text: ruleText(entry.rule),
        }));
    const commandOnlyRules = rules
        .filter(entry => entry.rule.tags && entry.rule.tags.command_only && !entry.rule.tags.inert_command_only)
        .map(entry => ({
            id: entry.rule.id,
            group: entry.group.id,
            source_line: entry.rule.source_line,
            text: ruleText(entry.rule),
        }));
    const rulegroupFlowSummary = summarizeRuleGroups(report);
    const rulegroupFlow = rulegroupFlowSummary.groups;
    const actionNoop = actionNoopSummary(report);
    const programFlow = programFlowSummary(report);
    const winflow = summarizeWinflow(report);
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
    const score = mergeable.length * 4
        + rulegroupFlowSummary.splitTotal * 5
        + inertRules.length * 2
        + quantity.can_increase.length * 2
        + quantity.can_decrease.length * 2
        + quantity.dynamic.length * 3
        + winflow.wake_edge_count
        + staticObjects.length
        + staticLayers.length
        + transient.length * 2
        + neverInitialOrCreated.length
        + cosmeticObjects.length;
    return {
        source_path: relativeSourcePath(sourcePath, repoRoot),
        display_name: path.basename(sourcePath),
        title: report.ps_tagged && report.ps_tagged.game ? report.ps_tagged.game.title || '' : '',
        status: report.status,
        editor_href: editorHrefForSource(sourcePath, { repoRoot }),
        score,
        mergeable,
        mergeable_groups: mergeableGroups,
        quantity,
        static_objects: staticObjects,
        static_objects_label: staticObjects.join(', '),
        never_initial_or_created: neverInitialOrCreated,
        static_layers: staticLayers,
        inert_layers: inertLayers,
        cosmetic_objects: cosmeticObjects,
        transient_objects: transient,
        inert_rules: inertRules,
        command_only_rules: commandOnlyRules,
        action_noop: actionNoop,
        program_flow: programFlow,
        winflow,
        corpus_metrics: corpusMetrics,
        object_rows: summarizeObjectRows(report, mergeableGroups),
        layer_rows: summarizeLayerRows(report),
        rule_rows: summarizeRuleRows(report),
        rulegroup_rows: summarizeRulegroupRows(report),
        wincondition_rows: summarizeWinconditionRows(report),
        source_lines: summarizeSourceLines(report),
        rulegroup_flow: rulegroupFlow,
        rulegroup_flow_total: rulegroupFlowSummary.total,
        rulegroup_flow_split_total: rulegroupFlowSummary.splitTotal,
        rulegroup_flow_omitted: rulegroupFlowSummary.omitted,
        summary: report.summary || {},
    };
}

function buildExplorerModel(reports, options = {}) {
    const games = reports
        .filter(report => report.status === 'ok')
        .map(report => summarizeReport(report, options))
        .sort((left, right) => right.score - left.score || left.display_name.localeCompare(right.display_name));
    return {
        schema: 'ps-static-analysis-explorer-v1',
        generated_at: new Date().toISOString(),
        games,
        totals: {
            games: games.length,
            mergeable: games.reduce((sum, game) => sum + game.mergeable.length, 0),
            merge_groups: games.reduce((sum, game) => sum + game.mergeable_groups.length, 0),
            split_groups: games.reduce((sum, game) => sum + game.rulegroup_flow_split_total, 0),
            inert_rules: games.reduce((sum, game) => sum + game.inert_rules.length, 0),
            quantity_constant: games.reduce((sum, game) => sum + game.quantity.constant.length, 0),
            quantity_can_increase: games.reduce((sum, game) => sum + game.quantity.can_increase.length, 0),
            quantity_can_decrease: games.reduce((sum, game) => sum + game.quantity.can_decrease.length, 0),
            quantity_dynamic: games.reduce((sum, game) => sum + game.quantity.dynamic.length, 0),
            static_objects: games.reduce((sum, game) => sum + game.static_objects.length, 0),
            static_layers: games.reduce((sum, game) => sum + game.static_layers.length, 0),
            inert_layers: games.reduce((sum, game) => sum + game.inert_layers.length, 0),
            cosmetic_objects: games.reduce((sum, game) => sum + game.cosmetic_objects.length, 0),
            transient_objects: games.reduce((sum, game) => sum + game.transient_objects.length, 0),
            mergable_objects: games.reduce((sum, game) => sum + game.corpus_metrics.objects.mergable, 0),
            temporary_objects: games.reduce((sum, game) => sum + game.corpus_metrics.objects.temporary, 0),
            cosmetic_rules: games.reduce((sum, game) => sum + game.corpus_metrics.rules.cosmetic, 0),
            inert_command_rules: games.reduce((sum, game) => sum + game.corpus_metrics.rules.inert_command, 0),
            splittable_rulegroups: games.reduce((sum, game) => sum + game.corpus_metrics.rulegroups.splittable, 0),
            action_noop: games.reduce((sum, game) => sum + (game.action_noop.status === 'proved' ? 1 : 0), 0),
            tick_noop: games.reduce((sum, game) => sum + (game.program_flow.tick_noop ? 1 : 0), 0),
            no_again: games.reduce((sum, game) => sum + (game.program_flow.no_again ? 1 : 0), 0),
            no_random: games.reduce((sum, game) => sum + (game.program_flow.no_random ? 1 : 0), 0),
            winflow_edges: games.reduce((sum, game) => sum + game.winflow.wake_edge_count, 0),
        },
    };
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function safeJsonForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

const CORPUS_COLUMNS = [
    { group: '', key: 'display_name', label: 'Game', kind: 'game', className: '' },
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

const OBJECT_COLUMNS = [
    { key: 'name', label: 'Object' },
    { key: 'layer', label: 'Layer' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'static', label: 'Static' },
    { key: 'temporary', label: 'Temporary' },
    { key: 'cosmetic', label: 'Cosmetic' },
    { key: 'merge_group', label: 'Merge' },
    { key: 'rule_count', label: 'Rules' },
    { key: 'win_role', label: 'Win role' },
];

function valueAtPath(object, pathText) {
    return pathText.split('.').reduce((current, key) => current == null ? undefined : current[key], object);
}

function corpusCellClassForHtml(column, value) {
    const classes = ['cell'];
    if (column.className) classes.push(column.className);
    if (column.kind === 'game') classes.push('name');
    if ((typeof value === 'number' && value === 0) || value === 'none') classes.push('quiet');
    if (['objects.mergable', 'objects.temporary', 'rules.cosmetic', 'rules.inert_command', 'rulegroups.splittable'].includes(column.kind) && Number(value) > 0) classes.push('hot');
    return classes.join(' ');
}

function renderCorpusMatrixHtml(games) {
    const groups = [
        ['', 1],
        ['Objects', 6],
        ['Layers', 3],
        ['Rules', 6],
        ['Rulegroups', 2],
        ['Winconditions', 1],
    ];
    const groupHtml = groups.map(([label, span]) =>
        `<div class="cell group" style="grid-column: span ${span}">${escapeHtml(label)}</div>`
    ).join('');
    const headHtml = CORPUS_COLUMNS.map(column =>
        `<button type="button" class="cell head sortable" data-sort-key="${escapeHtml(column.key)}" title="${escapeHtml(column.label)}">${escapeHtml(column.label)}</button>`
    ).join('');
    const rowHtml = games.map(game => CORPUS_COLUMNS.map(column => {
        const value = column.kind === 'game' ? game.display_name : valueAtPath(game, column.key);
        return `<button type="button" class="${escapeHtml(corpusCellClassForHtml(column, value))}" data-game="${escapeHtml(game.source_path)}" data-cell-kind="${escapeHtml(column.kind)}">${escapeHtml(value == null ? '' : value)}</button>`;
    }).join('')).join('');
    return `<div class="matrix-shell"><div class="matrix-scroll"><div class="matrix corpus-matrix" style="grid-template-columns: minmax(180px, 1.4fr) repeat(${CORPUS_COLUMNS.length - 1}, minmax(58px, 1fr))">${groupHtml}${headHtml}${rowHtml}</div></div></div>`;
}

function renderGameHeaderHtml(game) {
    return `<div class="detail-pane"><h2>${escapeHtml(game.display_name)}</h2>` +
        `<div class="path">${escapeHtml(game.source_path)}</div>` +
        `<p><a target="_blank" href="${escapeHtml(game.editor_href)}">Open in editor</a></p>` +
        `<div class="pill">objects ${escapeHtml(game.corpus_metrics.objects.total)}</div>` +
        `<div class="pill">source rules ${escapeHtml(game.corpus_metrics.rules.source)}</div>` +
        `<div class="pill">winconditions ${escapeHtml(game.corpus_metrics.winconditions.total)}</div></div>`;
}

function renderGameTabsHtml() {
    return '<div class="view-tabs">' +
        '<button class="view-tab active" type="button" data-game-tab="objects">Objects tab</button>' +
        '<button class="view-tab" type="button" data-game-tab="rules">Rules tab</button>' +
        '<button class="view-tab" type="button" data-game-tab="layers">Layers tab</button>' +
        '<button class="view-tab" type="button" data-game-tab="rulegroups">Rulegroups tab</button>' +
        '<button class="view-tab" type="button" data-game-tab="winconditions">Winconditions tab</button>' +
        '<button class="view-tab" type="button" data-game-tab="ruleflow">Rule Flow tab</button>' +
        '<button class="view-tab" type="button" data-game-tab="source">Source tab</button>' +
        '</div>';
}

function renderObjectMatrixHtml(game) {
    const head = OBJECT_COLUMNS.map(column =>
        `<button type="button" class="cell head sortable" data-object-sort-key="${escapeHtml(column.key)}" title="${escapeHtml(column.label)}">${escapeHtml(column.label)}</button>`
    ).join('');
    const rows = game.object_rows.map(row => OBJECT_COLUMNS.map(column => {
        const key = column.key;
        const value = row[key];
        const shown = typeof value === 'boolean' ? (value ? 'yes' : '-') : (value == null ? '-' : value);
        const quiet = shown === '-' || shown === 'none' ? ' quiet' : '';
        const name = key === 'name' ? ' name' : '';
        return `<button type="button" class="cell${name}${quiet}" data-object="${escapeHtml(row.name)}" data-object-cell="${escapeHtml(key)}">${escapeHtml(shown)}</button>`;
    }).join('')).join('');
    return `<div class="matrix-shell"><div class="matrix-scroll"><div class="matrix object-matrix">${head}${rows}</div></div></div>`;
}

function renderGameHtml(game) {
    if (!game) return '<div class="detail-pane">No game selected.</div>';
    return `${renderGameHeaderHtml(game)}${renderGameTabsHtml()}<section id="gameTabPanel">${renderObjectMatrixHtml(game)}</section>`;
}

function renderExplorerHtml(model) {
    const initialCorpusHtml = renderCorpusMatrixHtml(model.games);
    const initialGameHtml = renderGameHtml(model.games[0] || null);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PuzzleScript Static Analysis Explorer</title>
<style>
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
.object-matrix { grid-template-columns: minmax(160px, 1.4fr) repeat(8, minmax(72px, 1fr)); }
.cell { min-height: 24px; border: 1px solid transparent; border-radius: 3px; padding: 3px 5px; display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: var(--panel-soft); color: var(--text); }
.cell.name { justify-content: flex-start; font-weight: 650; background: #fff; }
button.cell.name[data-game] { cursor: pointer; color: #174d82; }
button.cell.name[data-game]:hover { text-decoration: underline; }
.cell.group { min-height: 20px; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; color: var(--muted); background: #fff; border-color: var(--line); }
.cell.head { min-height: 34px; font-size: 10px; font-weight: 650; line-height: 1.1; color: var(--muted); background: #fff; border-color: var(--line); text-align: center; white-space: normal; overflow: visible; text-overflow: clip; }
.cell.head.sortable { cursor: pointer; }
.cell.head.sorted { color: var(--text); border-color: #7b8796; background: #eef2f7; }
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
.analysis-summary { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
.analysis-block h3 { margin: 0 0 6px; font-size: 14px; }
.analysis-table { width: 100%; min-width: 920px; border-collapse: collapse; background: #fff; }
.analysis-table th, .analysis-table td { border-bottom: 1px solid var(--line); padding: 5px 6px; text-align: left; vertical-align: top; }
.analysis-table th { font-size: 10px; color: var(--muted); text-transform: uppercase; background: var(--panel-soft); }
.analysis-table tr:last-child td { border-bottom: 0; }
.analysis-table code { white-space: pre-wrap; }
.source-list { border: 1px solid var(--line); border-radius: 6px; background: #fff; overflow: hidden; }
.source-line { display: grid; grid-template-columns: 48px minmax(0, 1fr) minmax(180px, auto); gap: 8px; border-bottom: 1px solid var(--line); padding: 3px 6px; align-items: start; }
.source-line:last-child { border-bottom: 0; }
.line-no { color: var(--muted); text-align: right; user-select: none; }
.source-badges { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
.empty { color: var(--muted); }
code { white-space: pre-wrap; }
@media (max-width: 900px) { body { font-size: 11px; } main { padding: 6px; } }
</style>
</head>
<body>
<header>
<h1>PuzzleScript Static Analysis Explorer</h1>
<div class="toolbar">
<input id="search" placeholder="Filter games or traits" autofocus>
<select id="sort"><option value="score">Most interesting</option><option value="name">Name</option><option value="split">Splittable rulegroups</option><option value="merge">Mergable objects</option></select>
<span id="totals"></span>
</div>
</header>
<main>
  <div class="view-tabs">
    <button id="corpusTab" class="view-tab active" type="button">Corpus Explorer</button>
    <button id="gameTab" class="view-tab" type="button">Game Explorer</button>
  </div>
  <section id="corpusView" data-view="corpus">${initialCorpusHtml}</section>
  <section id="gameView" data-view="game" hidden>${initialGameHtml}</section>
  <aside id="inspector" class="inspector" aria-live="polite"></aside>
</main>
<script id="explorer-data" type="application/json">${safeJsonForScript(model)}</script>
<script>
const model = JSON.parse(document.getElementById('explorer-data').textContent);
let games = model.games.slice();
const corpusView = document.getElementById('corpusView');
const gameView = document.getElementById('gameView');
const inspector = document.getElementById('inspector');
const corpusTab = document.getElementById('corpusTab');
const gameTab = document.getElementById('gameTab');
const search = document.getElementById('search');
const sort = document.getElementById('sort');
let selected = model.games[0] || null;
let activeView = 'corpus';
let activeGameTab = 'objects';
let activeSortColumn = null;
let activeSortDirection = 'desc';
let activeObjectSortColumn = null;
let activeObjectSortDirection = 'asc';
document.getElementById('totals').textContent =
  model.totals.games + ' games | ' +
  model.totals.mergable_objects + ' mergable objects | ' +
  model.totals.quantity_constant + ' constant-count objects | ' +
  model.totals.temporary_objects + ' temporary objects | ' +
  model.totals.cosmetic_rules + ' cosmetic rules | ' +
  model.totals.splittable_rulegroups + ' splittable rulegroups';
function escapeText(value) {
  return String(value).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}
function searchable(game) {
  return [
    game.display_name, game.source_path, game.title,
    JSON.stringify(game.corpus_metrics),
    corpusColumns.map(column => column.label).join(' '),
    corpusColumns.map(column => valueAt(game, column.key)).join(' '),
    'winconditions',
    'mergable objects',
    'action ' + game.corpus_metrics.rules.action,
    'tick ' + game.corpus_metrics.rules.tick,
    game.mergeable_groups.flatMap(group => group.objects).join(' '),
    Object.entries(game.quantity).map(([key, values]) => key + ' ' + values.join(' ')).join(' '),
    game.static_objects.join(' '),
    game.static_layers.flatMap(layer => layer.objects).join(' '),
    game.inert_layers.flatMap(layer => layer.objects).join(' '),
    game.cosmetic_objects.join(' '),
    game.transient_objects.join(' '),
    game.action_noop.status,
    game.action_noop.blockers.join(' '),
    Object.entries(game.program_flow).map(([key, value]) => key + ' ' + value).join(' '),
    game.winflow.wake_edges.map(edge => edge.from_text + ' ' + edge.to_text + ' ' + edge.reasons.join(' ')).join(' '),
    game.rulegroup_flow.map(group => group.id).join(' '),
  ].join(' ').toLowerCase();
}
function visibleGames() {
  const q = search.value.trim().toLowerCase();
  let out = q ? games.filter(game => searchable(game).includes(q)) : games.slice();
  const mode = sort.value;
  out.sort((a, b) => {
    if (activeSortColumn) return compareByColumn(a, b, activeSortColumn, activeSortDirection);
    if (mode === 'name') return a.display_name.localeCompare(b.display_name);
    if (mode === 'split') return b.rulegroup_flow_split_total - a.rulegroup_flow_split_total || b.score - a.score;
    if (mode === 'merge') return b.corpus_metrics.objects.mergable - a.corpus_metrics.objects.mergable || b.score - a.score || a.display_name.localeCompare(b.display_name);
    return b.score - a.score || a.display_name.localeCompare(b.display_name);
  });
  return out;
}
const corpusColumns = [
  { group: '', key: 'display_name', label: 'Game', kind: 'game', className: '' },
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
const objectColumns = [
  { key: 'name', label: 'Object' },
  { key: 'layer', label: 'Layer' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'static', label: 'Static' },
  { key: 'temporary', label: 'Temporary' },
  { key: 'cosmetic', label: 'Cosmetic' },
  { key: 'merge_group', label: 'Merge' },
  { key: 'rule_count', label: 'Rules' },
  { key: 'win_role', label: 'Win role' },
];
function valueAt(object, path) {
  return path.split('.').reduce((current, key) => current == null ? undefined : current[key], object);
}
function compareScalar(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}
function compareByColumn(left, right, column, direction) {
  const leftValue = column.kind === 'game' ? left.display_name : valueAt(left, column.key);
  const rightValue = column.kind === 'game' ? right.display_name : valueAt(right, column.key);
  const base = compareScalar(leftValue, rightValue);
  const directed = direction === 'asc' ? base : -base;
  return directed || bScoreThenName(left, right);
}
function bScoreThenName(left, right) {
  return right.score - left.score || left.display_name.localeCompare(right.display_name);
}
function defaultDirectionForColumn(column) {
  return column.kind === 'game' ? 'asc' : 'desc';
}
function handleCorpusHeaderSort(column) {
  if (activeSortColumn && activeSortColumn.key === column.key) {
    activeSortDirection = activeSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    activeSortColumn = column;
    activeSortDirection = defaultDirectionForColumn(column);
  }
  renderCorpus();
  if (activeView === 'game') renderGame();
}
function defaultDirectionForObjectColumn(column) {
  return ['name', 'quantity', 'merge_group', 'win_role'].includes(column.key) ? 'asc' : 'desc';
}
function compareObjectRows(left, right, column, direction) {
  const base = compareScalar(left[column.key], right[column.key]);
  const directed = direction === 'asc' ? base : -base;
  return directed || String(left.name).localeCompare(String(right.name));
}
function sortedObjectRows(game) {
  const rows = game.object_rows.slice();
  if (!activeObjectSortColumn) return rows;
  rows.sort((left, right) => compareObjectRows(left, right, activeObjectSortColumn, activeObjectSortDirection));
  return rows;
}
function handleObjectHeaderSort(column) {
  if (activeObjectSortColumn && activeObjectSortColumn.key === column.key) {
    activeObjectSortDirection = activeObjectSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    activeObjectSortColumn = column;
    activeObjectSortDirection = defaultDirectionForObjectColumn(column);
  }
  renderGame();
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
  const previousSelected = selected;
  if (!shown.includes(selected)) selected = shown[0] || null;
  if (selected !== previousSelected) closeInspector();
  const groups = [
    ['', 1],
    ['Objects', 6],
    ['Layers', 3],
    ['Rules', 6],
    ['Rulegroups', 2],
    ['Winconditions', 1],
  ];
  const groupHtml = groups.map(([label, span]) => '<div class="cell group" style="grid-column: span ' + span + '">' + escapeText(label) + '</div>').join('');
  const headHtml = corpusColumns.map(column => {
    const sorted = activeSortColumn && activeSortColumn.key === column.key;
    const marker = sorted ? (activeSortDirection === 'asc' ? ' asc' : ' desc') : '';
    return '<button type="button" class="cell head sortable' + (sorted ? ' sorted' : '') + '" data-sort-key="' + escapeText(column.key) + '" title="' + escapeText(column.label) + '">' + escapeText(column.label + marker) + '</button>';
  }).join('');
  const rowHtml = shown.map(game => corpusColumns.map(column => {
    const value = column.kind === 'game' ? game.display_name : valueAt(game, column.key);
    return '<button type="button" class="' + corpusCellClass(column, value) + '" data-game="' + escapeText(game.source_path) + '" data-cell-kind="' + escapeText(column.kind) + '">' + escapeText(value == null ? '' : value) + '</button>';
  }).join('')).join('');
  corpusView.innerHTML = '<div class="matrix-shell"><div class="matrix-scroll"><div class="matrix corpus-matrix" style="grid-template-columns: minmax(180px, 1.4fr) repeat(' + (corpusColumns.length - 1) + ', minmax(58px, 1fr))">' + groupHtml + headHtml + rowHtml + '</div></div></div>';
  for (const head of corpusView.querySelectorAll('[data-sort-key]')) {
    head.addEventListener('click', () => {
      const column = corpusColumns.find(item => item.key === head.dataset.sortKey);
      if (column) handleCorpusHeaderSort(column);
    });
  }
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
    '<button class="view-tab" type="button" data-game-tab="winconditions">Winconditions tab</button>' +
    '<button class="view-tab" type="button" data-game-tab="ruleflow">Rule Flow tab</button>' +
    '<button class="view-tab" type="button" data-game-tab="source">Source tab</button>' +
    '</div>';
}

function renderObjectMatrix(game) {
  const head = objectColumns.map(column => {
    const sorted = activeObjectSortColumn && activeObjectSortColumn.key === column.key;
    const marker = sorted ? (activeObjectSortDirection === 'asc' ? ' asc' : ' desc') : '';
    return '<button type="button" class="cell head sortable' + (sorted ? ' sorted' : '') + '" data-object-sort-key="' + escapeText(column.key) + '" title="' + escapeText(column.label) + '">' + escapeText(column.label + marker) + '</button>';
  }).join('');
  const rows = sortedObjectRows(game).map(row => objectColumns.map(column => {
    const key = column.key;
    const value = row[key];
    const shown = typeof value === 'boolean' ? (value ? 'yes' : '-') : (value == null ? '-' : value);
    const quiet = shown === '-' || shown === 'none' ? ' quiet' : '';
    const name = key === 'name' ? ' name' : '';
    return '<button type="button" class="cell' + name + quiet + '" data-object="' + escapeText(row.name) + '" data-object-cell="' + escapeText(key) + '">' + escapeText(shown) + '</button>';
  }).join('')).join('');
  return '<div class="matrix-shell"><div class="matrix-scroll"><div class="matrix object-matrix">' + head + rows + '</div></div></div>';
}

function boolText(value) {
  return value ? 'yes' : '-';
}
function summaryPill(label, value) {
  return '<span class="pill">' + escapeText(label) + ' ' + escapeText(value) + '</span>';
}
function renderSummary(title, items) {
  return '<h4>' + escapeText(title) + '</h4><div class="analysis-summary">' + items.map(item => summaryPill(item[0], item[1])).join('') + '</div>';
}
function tableShell(html) {
  return '<div class="matrix-shell"><div class="matrix-scroll">' + html + '</div></div>';
}
function renderRulesTab(game) {
  const rows = game.rule_rows.map(row =>
    '<tr>' +
      '<td>' + escapeText(row.source_line == null ? 'compiled' : row.source_line) + '</td>' +
      '<td>' + escapeText(row.section) + '</td>' +
      '<td>' + escapeText(row.group) + '</td>' +
      '<td data-rule="' + escapeText(row.compiled_id) + '" data-rule-cell="cosmetic">' + escapeText(boolText(row.cosmetic)) + '</td>' +
      '<td data-rule="' + escapeText(row.compiled_id) + '" data-rule-cell="inert_command">' + escapeText(boolText(row.inert_command)) + '</td>' +
      '<td data-rule="' + escapeText(row.compiled_id) + '" data-rule-cell="command_only">' + escapeText(boolText(row.command_only)) + '</td>' +
      '<td><code>' + escapeText(row.text) + '</code></td>' +
    '</tr>'
  ).join('');
  return '<div class="analysis-block"><h3>Rule analysis</h3>' +
    renderSummary('Rules summary', [
      ['source lines', game.corpus_metrics.rules.source],
      ['compiled', game.corpus_metrics.rules.compiled],
      ['cosmetic', game.corpus_metrics.rules.cosmetic],
      ['inert commands', game.corpus_metrics.rules.inert_command],
      ['action', game.corpus_metrics.rules.action],
      ['tick', game.corpus_metrics.rules.tick],
    ]) +
    tableShell('<table class="analysis-table"><thead><tr><th>Line</th><th>Section</th><th>Group</th><th>Cosmetic</th><th>Inert command</th><th>Command only</th><th>Rule</th></tr></thead><tbody>' + rows + '</tbody></table>') + '</div>';
}

function renderLayersTab(game) {
  const rows = game.layer_rows.map(layer =>
    '<tr>' +
      '<td>' + escapeText(layer.id) + '</td>' +
      '<td>' + escapeText(layer.objects.join(', ')) + '</td>' +
      '<td data-layer="' + escapeText(layer.id) + '" data-layer-cell="object_count">' + escapeText(layer.objects.length) + '</td>' +
      '<td data-layer="' + escapeText(layer.id) + '" data-layer-cell="static">' + escapeText(boolText(layer.static)) + '</td>' +
      '<td data-layer="' + escapeText(layer.id) + '" data-layer-cell="inert">' + escapeText(boolText(layer.inert)) + '</td>' +
    '</tr>'
  ).join('');
  return '<div class="analysis-block"><h3>Layer analysis</h3>' +
    renderSummary('Layer summary', [
      ['layers', game.corpus_metrics.layers.total],
      ['static', game.corpus_metrics.layers.static],
      ['inert', game.corpus_metrics.layers.inert],
    ]) +
    tableShell('<table class="analysis-table"><thead><tr><th>Layer</th><th>Objects</th><th>Object count</th><th>Static</th><th>Inert</th></tr></thead><tbody>' + rows + '</tbody></table>') + '</div>';
}

function renderRulegroupsTab(game) {
  const rows = game.rulegroup_rows.map(group =>
    '<tr>' +
      '<td>' + escapeText(group.id) + '</td>' +
      '<td data-rulegroup="' + escapeText(group.id) + '" data-rulegroup-cell="source_lines">' + escapeText(group.source_lines) + '</td>' +
      '<td>' + escapeText(group.section) + '</td>' +
      '<td>' + escapeText(group.rule_count) + '</td>' +
      '<td data-rulegroup="' + escapeText(group.id) + '" data-rulegroup-cell="splittable">' + escapeText(boolText(group.splittable)) + '</td>' +
      '<td>' + escapeText(group.status) + '</td>' +
      '<td><code>' + escapeText(group.rule_preview.join('\\n') || '-') + '</code></td>' +
    '</tr>'
  ).join('');
  return '<div class="analysis-block"><h3>Rulegroup analysis</h3>' +
    renderSummary('Rulegroup summary', [
      ['rulegroups', game.corpus_metrics.rulegroups.total],
      ['splittable', game.corpus_metrics.rulegroups.splittable],
    ]) +
    tableShell('<table class="analysis-table"><thead><tr><th>Rulegroup</th><th>Source lines</th><th>Section</th><th>Rules</th><th>Splittable</th><th>Flow status</th><th>Preview</th></tr></thead><tbody>' + rows + '</tbody></table>') + '</div>';
}

function renderRuleFlowTab(game) {
  const groups = game.rulegroup_flow || [];
  if (groups.length === 0) {
    return '<div class="analysis-block"><h3>Rule flow analysis</h3><p class="empty">No splittable or rerun-sensitive rulegroups were reported for this game.</p></div>';
  }
  const rows = groups.map(group =>
    '<tr data-rule-flow-group="' + escapeText(group.id) + '">' +
      '<td>' + escapeText(group.id) + '</td>' +
      '<td>' + escapeText(group.section) + '</td>' +
      '<td>' + escapeText(boolText(group.split_candidate)) + '</td>' +
      '<td>' + escapeText(group.component_count) + '</td>' +
      '<td>' + escapeText(group.interaction_edge_count) + '</td>' +
      '<td>' + escapeText(group.rerun_mask_count) + '</td>' +
      '<td><code>' + escapeText(group.rules.map(rule => '[' + (rule.component == null ? '-' : rule.component) + '] ' + rule.text).join('\\n') || '-') + '</code></td>' +
    '</tr>'
  ).join('');
  return '<div class="analysis-block"><h3>Rule flow analysis</h3>' +
    renderSummary('Flow summary', [
      ['reported groups', game.rulegroup_flow_total],
      ['splittable', game.rulegroup_flow_split_total],
      ['shown', groups.length],
    ]) +
    tableShell('<table class="analysis-table"><thead><tr><th>Rulegroup</th><th>Section</th><th>Splittable</th><th>Components</th><th>Interactions</th><th>Rerun masks</th><th>Compiled rules by component</th></tr></thead><tbody>' + rows + '</tbody></table>') + '</div>';
}

function ruleSummariesTitle(rules) {
  if (!rules || rules.length === 0) return '';
  return rules.map(rule => rule.compiled_id + ': ' + rule.text).join('\\n');
}
function sourceBadges(row) {
  const badges = [];
  if (row.rule_summaries && row.rule_summaries.length) {
    const byGroup = new Map();
    for (const rule of row.rule_summaries) {
      if (!byGroup.has(rule.group)) byGroup.set(rule.group, []);
      byGroup.get(rule.group).push(rule);
    }
    for (const [group, rules] of byGroup.entries()) {
      badges.push({ text: group, title: ruleSummariesTitle(rules) });
    }
  } else if (row.rule_count) {
    badges.push({ text: row.rule_count + ' rule' + (row.rule_count === 1 ? '' : 's'), title: '' });
  }
  if (row.wincondition_count) badges.push({ text: row.wincondition_count + ' wincondition' + (row.wincondition_count === 1 ? '' : 's'), title: '' });
  if (row.object_name) {
    badges.push({ text: 'object ' + row.object_name, title: '' });
    if (row.object_traits && row.object_traits.static) badges.push({ text: 'static', title: '' });
    if (row.object_traits && row.object_traits.temporary) badges.push({ text: 'temporary', title: '' });
    if (row.object_traits && row.object_traits.cosmetic) badges.push({ text: 'cosmetic', title: '' });
    if (row.object_traits && row.object_traits.quantity) badges.push({ text: row.object_traits.quantity, title: '' });
  }
  return badges.map(badge => '<span class="chip"' + (badge.title ? ' title="' + escapeText(badge.title) + '"' : '') + '>' + escapeText(badge.text) + '</span>').join('');
}
function renderSourceTab(game) {
  if (!game.source_lines || game.source_lines.length === 0) {
    return '<div class="analysis-block"><h3>Best-effort source annotation</h3><p class="empty">Source text was not embedded in this explorer build.</p>' +
      '<p><a target="_blank" href="' + escapeText(game.editor_href) + '">Open source in editor</a></p></div>';
  }
  const rows = game.source_lines.map(row =>
    '<div class="source-line" data-source-line="' + escapeText(row.line) + '">' +
      '<span class="line-no">' + escapeText(row.line) + '</span>' +
      '<code>' + escapeText(row.text || ' ') + '</code>' +
      '<span class="source-badges">' + sourceBadges(row) + '</span>' +
    '</div>'
  ).join('');
  return '<div class="analysis-block"><h3>Best-effort source annotation</h3>' +
    '<p class="path">Source line annotations are best-effort because static analysis facts are produced after compilation, so source mappings can be one-to-many.</p>' +
    '<p><a target="_blank" href="' + escapeText(game.editor_href) + '">Open source in editor</a></p>' +
    '<div class="source-list">' + rows + '</div></div>';
}

function renderWinconditionsTab(game) {
  const rows = game.wincondition_rows.map(row =>
    '<tr>' +
      '<td>' + escapeText(row.source_line == null ? 'compiled' : row.source_line) + '</td>' +
      '<td>' + escapeText(row.text) + '</td>' +
      '<td data-wincondition="' + escapeText(row.id) + '" data-wincondition-cell="subjects">' + escapeText(row.subjects.join(', ') || '-') + '</td>' +
      '<td data-wincondition="' + escapeText(row.id) + '" data-wincondition-cell="targets">' + escapeText(row.targets.join(', ') || '-') + '</td>' +
      '<td data-wincondition="' + escapeText(row.id) + '" data-wincondition-cell="wake_edge_count">' + escapeText(row.wake_edge_count) + '</td>' +
    '</tr>'
  ).join('');
  return '<div class="analysis-block"><h3>Wincondition analysis</h3>' +
    renderSummary('Wincondition summary', [
      ['winconditions', game.corpus_metrics.winconditions.total],
      ['wake edges', game.winflow.wake_edge_count],
    ]) +
    tableShell('<table class="analysis-table"><thead><tr><th>Line</th><th>Wincondition</th><th>Subjects</th><th>Targets</th><th>Wake edges</th></tr></thead><tbody>' + rows + '</tbody></table>') + '</div>';
}

function renderGameTabPanel(game, tab) {
  if (tab === 'rules') return renderRulesTab(game);
  if (tab === 'layers') return renderLayersTab(game);
  if (tab === 'rulegroups') return renderRulegroupsTab(game);
  if (tab === 'ruleflow') return renderRuleFlowTab(game);
  if (tab === 'source') return renderSourceTab(game);
  if (tab === 'winconditions') return renderWinconditionsTab(game);
  return renderObjectMatrix(game);
}

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
  for (const head of gameView.querySelectorAll('[data-object-sort-key]')) {
    head.addEventListener('click', () => {
      const column = objectColumns.find(item => item.key === head.dataset.objectSortKey);
      if (column) handleObjectHeaderSort(column);
    });
  }
  for (const cell of gameView.querySelectorAll('[data-object]')) {
    cell.addEventListener('click', () => showInspector(game, 'object.' + cell.dataset.objectCell, cell.dataset.object));
  }
}
function setView(view) {
  activeView = view;
  corpusView.hidden = view !== 'corpus';
  gameView.hidden = view !== 'game';
  corpusTab.classList.toggle('active', view === 'corpus');
  gameTab.classList.toggle('active', view === 'game');
  if (view === 'game') renderGame();
}
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
  if (!game) return;
  inspector.innerHTML = '<button type="button" id="closeInspector">Close</button>' + inspectorContent(game, kind, objectName);
  inspector.classList.add('open');
  document.getElementById('closeInspector').addEventListener('click', () => inspector.classList.remove('open'));
}
function closeInspector() {
  inspector.classList.remove('open');
  inspector.innerHTML = '';
}
function render() {
  renderCorpus();
  renderGame();
  setView(activeView);
}
corpusTab.addEventListener('click', () => setView('corpus'));
gameTab.addEventListener('click', () => setView('game'));
search.addEventListener('input', () => { renderCorpus(); if (activeView === 'game') renderGame(); });
sort.addEventListener('change', () => {
  activeSortColumn = null;
  renderCorpus();
  if (activeView === 'game') renderGame();
});
render();
</script>
</body>
</html>
`;
}

function buildReports(inputs, options) {
    return discoverInputFiles(inputs)
        .filter(filePath => !options.gameFilter || filePath.toLowerCase().includes(options.gameFilter.toLowerCase()))
        .map(filePath => analyzeFile(filePath, { includePsTagged: true, includeSourceText: true }));
}

function main() {
    const { inputs, options } = parseArgs(process.argv);
    const reports = buildReports(inputs, options);
    const model = buildExplorerModel(reports, options);
    const html = renderExplorerHtml(model);
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    fs.writeFileSync(options.outPath, html, 'utf8');
    process.stdout.write(`static_analysis_explorer wrote ${options.outPath} games=${model.games.length} mergable_objects=${model.totals.mergable_objects} constant_count_objects=${model.totals.quantity_constant} cosmetic_rules=${model.totals.cosmetic_rules} splittable_rulegroups=${model.totals.splittable_rulegroups}\n`);
}

if (require.main === module) {
    main();
}

module.exports = {
    buildExplorerModel,
    editorHrefForSource,
    renderExplorerHtml,
    summarizeReport,
};

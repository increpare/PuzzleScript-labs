#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { compileSemanticSource, validateCompileSource } = require('../canonicalize');

const SCHEMA = 'ps-static-analysis-v1';
const INERT_COMMANDS = new Set(['message', 'sfx0', 'sfx1', 'sfx2', 'sfx3', 'sfx4', 'sfx5', 'sfx6', 'sfx7', 'sfx8', 'sfx9', 'sfx10']);
const SEMANTIC_COMMANDS = new Set(['cancel', 'again', 'restart', 'win', 'checkpoint']);
const DIRECTIONAL_MOVEMENTS = new Set(['up', 'down', 'left', 'right', 'moving', 'randomdir']);
const CARDINAL_MOVEMENTS = ['up', 'down', 'left', 'right'];
const MOVEMENT_BIT_MASKS = {
    up: 0x01,
    down: 0x02,
    left: 0x04,
    right: 0x08,
    action: 0x10,
};
const MOVEMENT_AGGREGATE_BIT_MASKS = {
    horizontal: MOVEMENT_BIT_MASKS.left | MOVEMENT_BIT_MASKS.right,
    horizontal_par: MOVEMENT_BIT_MASKS.left | MOVEMENT_BIT_MASKS.right,
    horizontal_perp: MOVEMENT_BIT_MASKS.left | MOVEMENT_BIT_MASKS.right,
    vertical: MOVEMENT_BIT_MASKS.up | MOVEMENT_BIT_MASKS.down,
    vertical_par: MOVEMENT_BIT_MASKS.up | MOVEMENT_BIT_MASKS.down,
    vertical_perp: MOVEMENT_BIT_MASKS.up | MOVEMENT_BIT_MASKS.down,
    moving: MOVEMENT_BIT_MASKS.up | MOVEMENT_BIT_MASKS.down | MOVEMENT_BIT_MASKS.left | MOVEMENT_BIT_MASKS.right | MOVEMENT_BIT_MASKS.action,
    orthogonal: MOVEMENT_BIT_MASKS.up | MOVEMENT_BIT_MASKS.down | MOVEMENT_BIT_MASKS.left | MOVEMENT_BIT_MASKS.right,
    randomdir: MOVEMENT_BIT_MASKS.up | MOVEMENT_BIT_MASKS.down | MOVEMENT_BIT_MASKS.left | MOVEMENT_BIT_MASKS.right,
};
const STATIC_INVALIDATING_MOVEMENT_AGGREGATES = new Set([
    'horizontal',
    'vertical',
    'orthogonal',
    'horizontal_par',
    'vertical_par',
    'horizontal_perp',
    'vertical_perp',
    'parallel',
    'perpendicular',
]);
const POSITIVE_MOVEMENT_STATES = CARDINAL_MOVEMENTS.concat(['action']);
const numericNameCollator = new Intl.Collator(undefined, { numeric: true });

function compareNumericNames(left, right) {
    return numericNameCollator.compare(left, right);
}

function uniqueSorted(values) {
    return Array.from(new Set(values)).sort(compareNumericNames);
}

function uniqueInOrder(values) {
    return Array.from(new Set(values));
}

function displayName(state, name) {
    return (state.original_case_names && state.original_case_names[name]) || name;
}

function objectInternalNamesFromMask(state, mask) {
    const bitMask = Array.isArray(mask) ? mask[1] : mask;
    const names = [];
    if (!bitMask || typeof bitMask.get !== 'function') {
        return names;
    }
    for (const [name, object] of Object.entries(state.objects)) {
        if (bitMask.get(object.id)) {
            names.push(name);
        }
    }
    return uniqueSorted(names);
}

function objectNamesFromMask(state, mask) {
    return objectInternalNamesFromMask(state, mask).map(name => displayName(state, name));
}

function buildObjects(state) {
    return Object.keys(state.objects)
        .map(name => ({
            id: state.objects[name].id,
            name: displayName(state, name),
            canonical_name: name,
            layer: state.objects[name].layer,
            colors: (state.objects[name].colors || []).slice(),
            spritematrix: (state.objects[name].spritematrix || []).map(row => row.slice()),
            tags: {},
        }))
        .sort((left, right) => left.id - right.id);
}

function buildProperties(state) {
    const properties = [];
    for (const [name, members] of Object.entries(state.propertiesDict || {})) {
        properties.push({
            name: displayName(state, name),
            canonical_name: name,
            kind: 'property',
            members: uniqueSorted(Array.from(members, member => displayName(state, member))),
            tags: {},
        });
    }
    for (const [name, target] of Object.entries(state.synonymsDict || {})) {
        properties.push({
            name: displayName(state, name),
            canonical_name: name,
            kind: 'synonym',
            members: [displayName(state, target)],
            tags: {},
        });
    }
    for (const [name, members] of Object.entries(state.aggregatesDict || {})) {
        properties.push({
            name: displayName(state, name),
            canonical_name: name,
            kind: 'aggregate',
            members: uniqueSorted(Array.from(members, member => displayName(state, member))),
            tags: {},
        });
    }
    return properties.sort((left, right) => compareNumericNames(left.name, right.name));
}

function buildCollisionLayers(state) {
    const canonicalLayerByObject = new Map(Object.entries(state.objects || {})
        .map(([name, object]) => [name, object.layer]));
    return Array.from(state.collisionLayers, (objects, id) => {
        const canonicalObjects = uniqueInOrder(Array.from(objects))
            .filter(name => canonicalLayerByObject.get(name) === id);
        return {
            id,
            objects: canonicalObjects.map(name => displayName(state, name)),
            canonical_objects: canonicalObjects,
            tags: {},
        };
    });
}

function buildWinconditions(state) {
    const objectCount = Object.keys(state.objects).length;
    return Array.from(state.winconditions, (condition, index) => {
        const targetNames = condition[2] ? objectInternalNamesFromMask(state, condition[2]) : [];
        const plainCondition = targetNames.length === objectCount;
        const subjects = objectNamesFromMask(state, condition[1]);
        const targets = plainCondition ? [] : targetNames.map(name => displayName(state, name));
        const isNo = condition[0] === -1;
        return {
            id: `win_${index}`,
            quantifier: condition[0],
            source_line: condition[3],
            subjects,
            targets,
            tags: {
                plain: plainCondition,
                objects_matched: uniqueSorted((isNo ? [] : subjects).concat(targets)),
                subjects_matched: isNo ? [] : uniqueSorted(subjects),
                targets_matched: uniqueSorted(targets),
                object_absences_matched: isNo ? uniqueSorted(subjects) : [],
            },
        };
    });
}

function buildLevels(state) {
    return Array.from(state.levels, (level, index) => {
        if (level.message !== undefined) {
            return { index, kind: 'message', objects_present: [], layers_present: [], tags: {} };
        }
        const objects = new Set();
        const layers = new Set();
        for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
            const cell = level.getCell(cellIndex);
            for (const name of objectInternalNamesFromMask(state, cell)) {
                objects.add(displayName(state, name));
                layers.add(state.objects[name].layer);
            }
        }
        return {
            index,
            kind: 'level',
            width: level.width,
            height: level.height,
            objects_present: uniqueSorted(Array.from(objects)),
            layers_present: Array.from(layers).sort((left, right) => left - right),
            tags: {},
        };
    });
}

function tagObjectLevelPresence(psTagged) {
    const playableLevels = psTagged.levels.filter(level => level.kind === 'level');
    for (const object of psTagged.objects) {
        const presentCount = playableLevels.filter(level => level.objects_present.includes(object.name)).length;
        object.tags.present_in_all_levels = playableLevels.length > 0 && presentCount === playableLevels.length;
        object.tags.present_in_some_levels = presentCount > 0 && presentCount < playableLevels.length;
        object.tags.present_in_no_levels = presentCount === 0;
    }
}

function directionName(direction) {
    if (typeof direction === 'string') return direction;
    if (direction === 1) return 'up';
    if (direction === 2) return 'down';
    if (direction === 4) return 'left';
    if (direction === 8) return 'right';
    if (direction === 15) return 'orthogonal';
    if (direction === 16) return 'action';
    return String(direction);
}

function refForName(state, name) {
    if (state.objects[name]) {
        return { type: 'object', name: displayName(state, name), canonical_name: name };
    }
    if (state.propertiesDict && state.propertiesDict[name]) {
        return {
            type: 'property',
            name: displayName(state, name),
            canonical_name: name,
            members: uniqueSorted(Array.from(state.propertiesDict[name], member => displayName(state, member))),
        };
    }
    if (state.synonymsDict && state.synonymsDict[name]) {
        return {
            type: 'synonym',
            name: displayName(state, name),
            canonical_name: name,
            members: [displayName(state, state.synonymsDict[name])],
        };
    }
    return { type: 'unknown', name };
}

function termFromPair(state, direction, name) {
    if (direction === '...' && name === '...') {
        return { kind: 'present', ref: { type: 'ellipsis' }, movement: null };
    }
    if (direction === 'no') {
        return { kind: 'absent', ref: refForName(state, name), movement: null };
    }
    if (direction === 'random') {
        return { kind: 'random_object', ref: refForName(state, name), movement: null };
    }
    if (direction === '') {
        return { kind: 'present', ref: refForName(state, name), movement: null };
    }
    return { kind: 'present', ref: refForName(state, name), movement: directionName(direction) };
}

function termsFromCell(state, cell) {
    const terms = [];
    for (let index = 0; index < cell.length; index += 2) {
        terms.push(termFromPair(state, cell[index], cell[index + 1]));
    }
    return terms;
}

function termsFromSide(state, side) {
    return Array.from(side || [], row =>
        Array.from(row, cell => termsFromCell(state, cell))
    );
}

function flattenTerms(side) {
    return side.flat(2);
}

function termHasInputMovementRequirement(term) {
    return term.movement !== null && term.movement !== 'stationary';
}

function ruleHasEmptyLhs(rule) {
    return rule.summary.lhs_terms.length === 0;
}

function summarizeRule(rule) {
    const lhsTerms = flattenTerms(rule.lhs);
    const rhsTerms = flattenTerms(rule.rhs);
    return {
        lhs_terms: lhsTerms,
        rhs_terms: rhsTerms,
        lhs_present: lhsTerms.filter(term => term.kind === 'present'),
        lhs_absent: lhsTerms.filter(term => term.kind === 'absent'),
        lhs_movement: lhsTerms.filter(term => term.movement !== null),
        rhs_present: rhsTerms.filter(term => term.kind === 'present'),
        rhs_absent: rhsTerms.filter(term => term.kind === 'absent'),
        rhs_random_objects: rhsTerms.filter(term => term.kind === 'random_object'),
        rhs_movement: rhsTerms.filter(term => term.movement !== null),
        semantic_commands: rule.commands.map(command => command[0]).filter(command => SEMANTIC_COMMANDS.has(command)),
        inert_commands: rule.commands.map(command => command[0]).filter(command => INERT_COMMANDS.has(command)),
    };
}

function objectTermSignature(terms) {
    return JSON.stringify(terms
        .filter(term => term.kind === 'present')
        .map(term => JSON.stringify(term.ref))
        .sort());
}

function movementTermSignature(terms) {
    return JSON.stringify(terms
        .filter(term => term.kind === 'present' && term.movement !== null)
        .map(term => `${JSON.stringify(term.ref)}:${term.movement}`)
        .sort());
}

function structuredObjectSignature(side) {
    return JSON.stringify((side || []).map(row =>
        row.map(cell =>
            cell
                .filter(term => term.kind === 'present')
                .map(term => JSON.stringify(term.ref))
                .sort()
        )
    ));
}

function structuredMovementSignature(side) {
    return JSON.stringify((side || []).map(row =>
        row.map(cell =>
            cell
                .filter(term => term.kind === 'present' && term.movement !== null)
                .map(term => `${JSON.stringify(term.ref)}:${term.movement}`)
                .sort()
        )
    ));
}

function tagRule(rule) {
    rule.summary = summarizeRule(rule);
    const commandNames = rule.commands.map(command => command[0]);
    const hasOnlyInertCommands = commandNames.length > 0
        && commandNames.every(command => INERT_COMMANDS.has(command));
    const hasReplacement = rule.rhs.length > 0;
    const objectMutating = hasReplacement
        && (structuredObjectSignature(rule.lhs) !== structuredObjectSignature(rule.rhs)
        || rule.summary.rhs_absent.length > 0
        || rule.summary.rhs_random_objects.length > 0);
    const writesMovement = hasReplacement
        && structuredMovementSignature(rule.lhs) !== structuredMovementSignature(rule.rhs);
    const hasSemanticCommand = rule.summary.semantic_commands.length > 0;

    rule.tags.command_only = commandNames.length > 0 && !objectMutating && !writesMovement;
    rule.tags.inert_command_only = hasOnlyInertCommands && rule.tags.command_only;
    rule.tags.object_mutating = objectMutating;
    rule.tags.writes_movement = writesMovement;
    rule.tags.movement_only = writesMovement && !objectMutating && !hasSemanticCommand;
    rule.tags.reads_action = rule.summary.lhs_movement.some(term => term.movement === 'action');
    rule.tags.has_again = rule.summary.semantic_commands.includes('again');
    rule.tags.force_always_run = ruleHasEmptyLhs(rule);
    const hasNonInertEffect = objectMutating || writesMovement || hasSemanticCommand;
    rule.tags.solver_state_active = !rule.tags.inert_command_only && hasNonInertEffect;
    if (rule.rigid && hasNonInertEffect) {
        rule.tags.rigid_active = true;
    }
}

function buildRuleSections(state) {
    const rules = Array.from(state.rules || []);
    return [
        buildRuleSection(state, 'early', rules.filter(rule => !rule.late)),
        buildRuleSection(state, 'late', rules.filter(rule => rule.late)),
    ];
}

function buildRuleSection(state, name, rules) {
    const groupNumbers = [];
    const groupMap = new Map();
    for (const rule of rules) {
        if (!groupMap.has(rule.groupNumber)) {
            groupMap.set(rule.groupNumber, []);
            groupNumbers.push(rule.groupNumber);
        }
        groupMap.get(rule.groupNumber).push(rule);
    }
    const groups = groupNumbers.map((groupNumber, index) =>
        buildRuleGroup(state, name, index, groupNumber, groupMap.get(groupNumber))
    );
    return {
        name,
        loops: buildLoopSummaries(state, groups),
        groups,
    };
}

function buildLoopSummaries(state, groups) {
    const loops = [];
    const stack = [];
    for (const loop of Array.from(state.loops || [])) {
        const line = loop[0];
        const bracket = loop[1];
        if (bracket === 1) {
            stack.push({ start_line: line, end_line: null });
        } else if (bracket === -1 && stack.length > 0) {
            const active = stack.pop();
            active.end_line = line;
            active.group_ids = groups
                .filter(group => group.source_line_min > active.start_line && group.source_line_max < active.end_line)
                .map(group => group.id);
            if (active.group_ids.length > 0) {
                active.id = `loop_${loops.length}`;
                loops.push(active);
            }
        }
    }
    return loops;
}

function buildRuleGroup(state, sectionName, groupIndex, groupNumber, sourceRules) {
    const rules = sourceRules.map((rule, ruleIndex) => buildRuleIr(state, sectionName, groupIndex, rule, ruleIndex));
    const group = {
        id: `${sectionName}_group_${groupIndex}`,
        group_index: groupIndex,
        group_number: groupNumber,
        source_line_min: Math.min(...sourceRules.map(rule => rule.lineNumber)),
        source_line_max: Math.max(...sourceRules.map(rule => rule.lineNumber)),
        random: sourceRules.some(rule => rule.randomRule),
        tags: {},
        rules,
    };
    for (const rule of rules) {
        tagRule(rule);
    }
    tagGroup(group);
    return group;
}

function buildRuleIr(state, sectionName, groupIndex, rule, ruleIndex) {
    return {
        id: `${sectionName}_group_${groupIndex}_rule_${ruleIndex}`,
        source_line: rule.lineNumber,
        direction: directionName(rule.direction),
        late: !!rule.late || sectionName === 'late',
        rigid: !!rule.rigid,
        random_rule: !!rule.randomRule,
        tags: {},
        commands: Array.from(rule.commands || [], command => Array.from(command)),
        lhs: termsFromSide(state, rule.lhs),
        rhs: termsFromSide(state, rule.rhs),
        summary: {},
    };
}

function tagGroup(group) {
    group.tags.has_again = group.rules.some(rule => rule.tags.has_again);
    group.tags.object_mutating = group.rules.some(rule => rule.tags.object_mutating);
    group.tags.movement_only = group.rules.some(rule => rule.tags.movement_only) && !group.tags.object_mutating;
    group.tags.command_only = group.rules.every(rule => rule.tags.command_only);
    group.tags.solver_state_active = group.rules.some(rule => rule.tags.solver_state_active);
}

function allRuleEntries(psTagged) {
    return psTagged.rule_sections.flatMap(section =>
        section.groups.flatMap(group =>
            group.rules.map(rule => ({ section, group, rule }))
        )
    );
}

function metadataHas(metadata, key) {
    if (Array.isArray(metadata)) {
        for (let index = 0; index < metadata.length; index += 2) {
            if (metadata[index] === key) return true;
        }
        return false;
    }
    return Object.prototype.hasOwnProperty.call(metadata || {}, key);
}

function tagGame(psTagged, metadata = {}) {
    const rules = allRuleEntries(psTagged).map(entry => entry.rule);
    psTagged.game.tags.has_action_input = !metadataHas(metadata, 'noaction');
    psTagged.game.tags.run_rules_on_level_start = metadataHas(metadata, 'run_rules_on_level_start');
    psTagged.game.tags.has_again = rules.some(rule => rule.tags.has_again);
    psTagged.game.tags.has_random = rules.some(rule => rule.random_rule
        || rule.summary.rhs_random_objects.length > 0
        || rule.summary.rhs_movement.some(term => term.movement === 'randomdir'));
    psTagged.game.tags.has_rigid = rules.some(rule => rule.rigid);
    psTagged.game.tags.has_action_rules = rules.some(rule => rule.tags.reads_action);
    psTagged.game.tags.has_autonomous_tick_rules = rules.some(rule =>
        rule.tags.solver_state_active && !rule.summary.lhs_movement.some(termHasInputMovementRequirement)
    );
}

function membersForRef(psTagged, ref) {
    if (ref.type === 'object') return [ref.name];
    if (ref.type === 'object_set') return ref.objects.slice();
    if (ref.type === 'property' || ref.type === 'synonym' || ref.type === 'unknown') {
        const property = psTagged.properties.find(item => item.name === ref.name || item.canonical_name === ref.canonical_name);
        return property ? property.members.slice() : [ref.name];
    }
    return [];
}

function refForObjectName(psTagged, objectName) {
    const object = psTagged.objects.find(item => item.name === objectName);
    if (!object) return { type: 'object', name: objectName };
    return { type: 'object', name: object.name, canonical_name: object.canonical_name };
}

function normalizeTermRefs(psTagged) {
    for (const { rule } of allRuleEntries(psTagged)) {
        for (const term of rule.summary.lhs_terms.concat(rule.summary.rhs_terms)) {
            const members = membersForRef(psTagged, term.ref);
            if (members.length === 1 && psTagged.objects.some(object => object.name === members[0])) {
                term.expanded_objects = members;
                term.ref = refForObjectName(psTagged, members[0]);
            } else if (members.length > 1) {
                term.expanded_objects = uniqueSorted(members);
                term.ref = { type: 'object_set', objects: uniqueSorted(members), source: term.ref.name || term.ref.type };
            } else {
                term.expanded_objects = [];
            }
        }
    }
}

// Objects that some solver-active rule can put into a cardinal-moving state,
// i.e. that can *originate* movement (plus players, who move from input). This
// counts movement *written* by a replacement, never movement merely read on a
// LHS — so a property member that only ever appears under a `> prop` read but is
// never itself set in motion (e.g. `wall` in `wallAndPlayer`) is excluded.
function computeObjectsOriginatingMovement(psTagged) {
    const movers = new Set(playerObjectNameSet(psTagged));
    for (const { rule } of allRuleEntries(psTagged)) {
        if (!rule.tags.solver_state_active) continue;
        for (const key of ruleMovementWriteTags(psTagged, rule)) {
            if (movementKeyInvalidatesStatic(key)) movers.add(movementKeyObjectName(key));
        }
    }
    return movers;
}

function buildPsTagged(state, options = {}) {
    const psTagged = {
        game: {
            title: state.metadata && state.metadata.title,
            source_path: options.sourcePath || '<memory>',
            tags: {},
        },
        objects: buildObjects(state),
        properties: buildProperties(state),
        collision_layers: buildCollisionLayers(state),
        winconditions: buildWinconditions(state),
        levels: buildLevels(state),
        rule_sections: buildRuleSections(state),
    };
    tagObjectLevelPresence(psTagged);
    tagGame(psTagged, state.metadata || {});
    normalizeTermRefs(psTagged);
    psTagged.objects_originating_movement = computeObjectsOriginatingMovement(psTagged);
    tagRuleObjectTags(psTagged);
    tagInertCollisionLayers(psTagged);
    tagCosmeticRules(psTagged);
    tagCosmeticObjects(psTagged);
    return psTagged;
}

function emptyFacts() {
    return {
        mergeability: [],
        movement_action: [],
        per_level_object_universe: [],
        linear_count_invariants: [],
        mechanic_profile: [],
        count_layer_invariants: [],
        transient_boundary: [],
        rulegroup_flow: [],
        certified_wake_masks: [],
        program_flow: [],
        winflow: [],
        win_relevance: [],
    };
}

function fact(family, id, status, fields) {
    return Object.assign({
        family,
        id,
        status,
        subjects: {},
        tags: {},
        proof: [],
        blockers: [],
        evidence: [],
    }, fields);
}

function sameArray(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function winRoleForObject(psTagged, objectName) {
    return psTagged.winconditions.map(win => ({
        id: win.id,
        in_subjects: win.subjects.includes(objectName),
        in_targets: win.targets.includes(objectName),
    }));
}

function directObservationsForObjects(psTagged, objects) {
    const observations = [];
    for (const { rule } of allRuleEntries(psTagged)) {
        if (rule.tags.inert_command_only) continue;
        for (const row of rule.lhs) {
            for (const cell of row) {
                const directTerms = cell.filter(term =>
                    term.ref.type === 'object' && objects.includes(term.ref.name)
                );
                if (directTerms.length === 0) continue;
                const observedObjects = uniqueSorted(directTerms.map(term => term.ref.name));
                const sameObservation = new Set(directTerms.map(term => `${term.kind}:${term.movement}`)).size === 1;
                if (sameArray(observedObjects, objects) && sameObservation) continue;
                observations.push(...directTerms.map(term => ({
                    rule_id: rule.id,
                    source_line: rule.source_line,
                    kind: term.kind,
                    movement: term.movement,
                    object: term.ref.name,
                })));
            }
        }
    }
    return observations;
}

function groupObservationIsShared(psTagged, objects) {
    for (const { rule } of allRuleEntries(psTagged)) {
        if (rule.tags.inert_command_only) continue;
        for (const term of rule.summary.lhs_terms) {
            if (term.ref.type !== 'object_set') continue;
            const overlap = objects.filter(objectName => term.expanded_objects.includes(objectName));
            if (overlap.length > 0 && overlap.length !== objects.length) {
                return false;
            }
        }
    }
    return true;
}

function mergePairKey(left, right) {
    return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function signatureFromSet(values) {
    return Array.from(values || []).sort().join('\u0000');
}

function addDirectMergeBlocker(indexes, left, right, ruleId) {
    const key = mergePairKey(left, right);
    indexes.directReadBlockers.add(key);
    if (!indexes.directReadEvidence.has(key)) {
        indexes.directReadEvidence.set(key, []);
    }
    const evidence = indexes.directReadEvidence.get(key);
    if (evidence[evidence.length - 1] !== ruleId) {
        evidence.push(ruleId);
    }
}

function buildMergeabilityIndexes(psTagged) {
    const layerObjectsById = new Map((psTagged.collision_layers || []).map(layer => [layer.id, layer.objects || []]));
    const layerByObject = new Map();
    const objectLayerMembership = new Map();
    const winRoleSignature = new Map();
    const objectSetMembership = new Map();
    const objectSetIds = new Map();
    const indexes = {
        directReadBlockers: new Set(),
        directReadEvidence: new Map(),
        winRoleSignature,
        layerMembershipSignature: new Map(),
        objectSetSignature: new Map(),
    };

    for (const object of psTagged.objects || []) {
        layerByObject.set(object.name, object.layer);
        objectLayerMembership.set(object.name, new Set());
        winRoleSignature.set(object.name, JSON.stringify(winRoleForObject(psTagged, object.name)));
        objectSetMembership.set(object.name, new Set());
    }

    for (const layer of psTagged.collision_layers || []) {
        for (const objectName of layer.objects || []) {
            if (!objectLayerMembership.has(objectName)) {
                objectLayerMembership.set(objectName, new Set());
            }
            objectLayerMembership.get(objectName).add(layer.id);
        }
    }

    function objectSetId(objects) {
        const key = uniqueSorted(objects || []).join('\u0000');
        if (!objectSetIds.has(key)) {
            objectSetIds.set(key, objectSetIds.size);
        }
        return objectSetIds.get(key);
    }

    for (const { rule } of allRuleEntries(psTagged)) {
        if (rule.tags.inert_command_only) continue;
        for (const term of rule.summary.lhs_terms) {
            if (term.ref.type !== 'object_set') continue;
            const id = objectSetId(term.expanded_objects || []);
            for (const objectName of term.expanded_objects || []) {
                if (!objectSetMembership.has(objectName)) {
                    objectSetMembership.set(objectName, new Set());
                }
                objectSetMembership.get(objectName).add(id);
            }
        }

        for (const row of rule.lhs) {
            for (const cell of row) {
                const directTermsByObject = new Map();
                for (const term of cell) {
                    if (term.ref.type !== 'object') continue;
                    if (!directTermsByObject.has(term.ref.name)) {
                        directTermsByObject.set(term.ref.name, []);
                    }
                    directTermsByObject.get(term.ref.name).push(`${term.kind}:${term.movement}`);
                }
                if (directTermsByObject.size === 0) continue;

                const mentionedByLayer = new Map();
                for (const objectName of directTermsByObject.keys()) {
                    const layer = layerByObject.get(objectName);
                    if (layer === undefined || layer === null) continue;
                    if (!mentionedByLayer.has(layer)) mentionedByLayer.set(layer, []);
                    mentionedByLayer.get(layer).push(objectName);
                }

                for (const [layer, mentionedObjects] of mentionedByLayer.entries()) {
                    const layerObjects = layerObjectsById.get(layer) || [];
                    const mentionedSet = new Set(mentionedObjects);
                    for (const mentioned of mentionedObjects) {
                        for (const other of layerObjects) {
                            if (mentionedSet.has(other)) continue;
                            addDirectMergeBlocker(indexes, mentioned, other, rule.id);
                        }
                    }
                    for (let left = 0; left < mentionedObjects.length; left++) {
                        for (let right = left + 1; right < mentionedObjects.length; right++) {
                            const signatures = new Set(directTermsByObject.get(mentionedObjects[left]));
                            addValues(signatures, directTermsByObject.get(mentionedObjects[right]));
                            if (signatures.size !== 1) {
                                addDirectMergeBlocker(indexes, mentionedObjects[left], mentionedObjects[right], rule.id);
                            }
                        }
                    }
                }
            }
        }
    }

    for (const object of psTagged.objects || []) {
        indexes.layerMembershipSignature.set(object.name, signatureFromSet(objectLayerMembership.get(object.name)));
        indexes.objectSetSignature.set(object.name, signatureFromSet(objectSetMembership.get(object.name)));
    }

    return indexes;
}

function deriveMergeabilityFacts(psTagged) {
    const indexes = buildMergeabilityIndexes(psTagged);
    const results = [];
    for (const layer of psTagged.collision_layers) {
        if (layer.objects.length < 2) continue;
        for (let left = 0; left < layer.objects.length; left++) {
            for (let right = left + 1; right < layer.objects.length; right++) {
                const objects = [layer.objects[left], layer.objects[right]].sort();
                const pairKey = mergePairKey(objects[0], objects[1]);
                const blockers = [];
                if (indexes.directReadBlockers.has(pairKey)) blockers.push('individual_lhs_read');
                if (indexes.winRoleSignature.get(objects[0]) !== indexes.winRoleSignature.get(objects[1])) {
                    blockers.push('different_win_roles');
                }
                if (indexes.layerMembershipSignature.get(objects[0]) !== indexes.layerMembershipSignature.get(objects[1])) {
                    blockers.push('different_collision_layer_membership');
                }
                if (indexes.objectSetSignature.get(objects[0]) !== indexes.objectSetSignature.get(objects[1])) {
                    blockers.push('partial_property_observation');
                }
                results.push(fact('mergeability', `merge_${objects.join('_')}`, blockers.length === 0 ? 'candidate' : 'rejected', {
                    subjects: { objects },
                    proof: blockers.length === 0 ? ['same_collision_layer', 'observed_only_through_shared_sets', 'same_win_roles'] : ['same_collision_layer'],
                    blockers,
                    evidence: (indexes.directReadEvidence.get(pairKey) || []).concat(`layer_${layer.id}`),
                }));
            }
        }
    }
    return results;
}

function layerForObject(psTagged, objectName) {
    const object = psTagged.objects.find(item => item.name === objectName);
    return object ? object.layer : null;
}

function playerActionMovementSeeds(psTagged) {
    const playerObjects = playerObjectNameSet(psTagged);
    return uniqueSorted(Array.from(playerObjects)
        .filter(objectName => layerForObject(psTagged, objectName) !== null)
        .map(objectName => `${objectName}:action`));
}

function movementRequirementsFromTerms(psTagged, terms) {
    const requirements = [];
    for (const term of terms) {
        if (term.kind !== 'present' || !termHasInputMovementRequirement(term)) continue;
        const alternatives = (term.expanded_objects || [])
            .filter(objectName => layerForObject(psTagged, objectName) !== null)
            .map(objectName => ({ object: objectName, movement: term.movement }));
        if (alternatives.length > 0) requirements.push(alternatives);
    }
    return requirements;
}

function movementEffectsFromTerms(psTagged, terms) {
    const movements = [];
    for (const term of terms) {
        if (term.kind !== 'present'
            || term.movement === null
            || term.movement === 'stationary') {
            continue;
        }
        for (const objectName of term.expanded_objects || []) {
            if (layerForObject(psTagged, objectName) === null) continue;
            if (term.movement === 'randomdir') {
                for (const movement of CARDINAL_MOVEMENTS) movements.push(`${objectName}:${movement}`);
                movements.push(`${objectName}:moving`);
            } else if (CARDINAL_MOVEMENTS.includes(term.movement)) {
                movements.push(`${objectName}:${term.movement}`);
                movements.push(`${objectName}:moving`);
            } else {
                movements.push(`${objectName}:${term.movement}`);
            }
        }
    }
    return movements;
}

function movementKeyMovementName(key) {
    return key.slice(key.lastIndexOf(':') + 1);
}

function movementKeyInvalidatesStatic(key) {
    const movement = movementKeyMovementName(key);
    return CARDINAL_MOVEMENTS.includes(movement)
        || movement === 'moving'
        || movement === 'randomdir'
        || STATIC_INVALIDATING_MOVEMENT_AGGREGATES.has(movement);
}

function playerDirectionalMovementSeeds(psTagged) {
    const playerObjects = playerObjectNameSet(psTagged);
    const movements = [];
    for (const objectName of playerObjects) {
        if (layerForObject(psTagged, objectName) === null) continue;
        for (const movement of CARDINAL_MOVEMENTS) {
            movements.push(`${objectName}:${movement}`);
        }
        movements.push(`${objectName}:moving`);
    }
    return uniqueSorted(movements);
}

function cosmeticObjectNameSet(psTagged) {
    return new Set((psTagged.objects || [])
        .filter(object => object && object.tags && object.tags.cosmetic)
        .map(object => object.name));
}

function cosmeticMutationProjectionForRule(psTagged, rule) {
    const cosmeticObjects = cosmeticObjectNameSet(psTagged);
    const mutatedObjects = new Set();
    let hasVisibleMutation = false;
    for (const objectName of rule.tags.objects_written || []) {
        if (cosmeticObjects.has(objectName)) mutatedObjects.add(objectName);
        else hasVisibleMutation = true;
    }
    for (const objectName of rule.tags.objects_erased || []) {
        if (cosmeticObjects.has(objectName)) mutatedObjects.add(objectName);
        else hasVisibleMutation = true;
    }

    const movementWrites = new Set(rule.tags.movements_written || []);
    const movementRemoves = new Set(rule.tags.movements_removed || []);
    const movementKeys = new Set([...movementWrites, ...movementRemoves]);
    for (const key of movementKeys) {
        if (movementWrites.has(key) && movementRemoves.has(key)) continue;
        const objectName = movementKeyObjectName(key);
        if (cosmeticObjects.has(objectName)) mutatedObjects.add(objectName);
        else hasVisibleMutation = true;
    }
    return { mutatedObjects, hasVisibleMutation };
}

function ruleProjectsToCosmeticMutationOnly(psTagged, rule) {
    if (!rule || rule.tags.solver_state_active !== true) return false;
    const projection = cosmeticMutationProjectionForRule(psTagged, rule);
    return projection.mutatedObjects.size > 0
        && projection.hasVisibleMutation === false
        && rule.random_rule !== true
        && rule.rigid !== true
        && rule.tags.has_again !== true
        && (!rule.summary || (
            rule.summary.semantic_commands.length === 0
            && rule.summary.rhs_random_objects.length === 0
        ));
}

function transientBoundaryStatusForObject(psTagged, objectName) {
    const creators = creatorsForObject(psTagged, objectName);
    const clearers = lateClearersForObject(psTagged, objectName);
    const blockers = [];
    if (creators.length === 0) blockers.push('not_created_before_end_cleanup');
    if (clearers.length === 0) blockers.push('no_late_cleanup_clear');
    if (creators.length > 0 && clearers.length > 0 && !allCreatorsHaveLaterClearer(creators, clearers)) {
        blockers.push('creator_not_followed_by_late_cleanup');
    }
    const object = psTagged.objects.find(item => item.name === objectName);
    if (!object || !object.tags.present_in_no_levels) blockers.push('present_in_some_initial_levels');
    if (objectInWincondition(psTagged, objectName)) blockers.push('appears_in_wincondition');
    if (creators.some(entry => entry.group.tags.has_again || entry.rule.tags.has_again)) blockers.push('has_again_taint');
    if (creators.some(entry => entry.rule.rigid) || clearers.some(entry => entry.rule.rigid)) blockers.push('rigid_rule');
    return {
        status: blockers.length === 0 ? 'proved' : 'rejected',
        blockers,
        evidence: creators.concat(clearers).map(entry => entry.rule.id),
    };
}

function actionUnnecessaryRuleDiagnostic(psTagged, entry, reasonsOverride = null) {
    const { section, group, rule } = entry;
    const movementEffects = uniqueSorted(movementEffectsFromTerms(psTagged, rule.summary.rhs_terms));
    const countEffects = ruleCountEffectObjects(psTagged, rule);
    const changedObjects = uniqueSorted(Array.from(countEffects.increases).concat(Array.from(countEffects.decreases)));
    const transientChangedObjects = changedObjects.filter(objectName =>
        transientBoundaryStatusForObject(psTagged, objectName).status === 'proved'
    );
    let reasons = reasonsOverride ? reasonsOverride.slice() : null;
    if (reasons === null) {
        reasons = [];
        if (rule.tags.reads_action) reasons.push('reads_action');
        if (rule.tags.has_again) reasons.push('queues_again');
        if (rule.summary.semantic_commands.some(command => command !== 'again')) reasons.push('semantic_command');
        if (rule.rigid) reasons.push('rigid_rule');
        if (!rule.summary.lhs_movement.some(termHasInputMovementRequirement)) reasons.push('autonomous_solver_active_rule');
        if (rule.tags.object_mutating) reasons.push('action_may_mutate_objects');
        if (movementEffects.some(movementTag => {
            const movement = movementKeyMovementName(movementTag);
            return DIRECTIONAL_MOVEMENTS.has(movement);
        })) {
            reasons.push('action_may_create_directional_movement');
        }
    }
    return {
        rule_id: rule.id,
        group_id: group.id,
        section: section.name,
        source_line: rule.source_line,
        late: !!rule.late,
        rigid: !!rule.rigid,
        reasons: uniqueSorted(reasons),
        changed_objects: changedObjects,
        transient_changed_objects: transientChangedObjects,
        movement_effects: movementEffects,
    };
}

function actionUnnecessaryDiagnosticHypotheses(uniqueBlockers, blockerRules, provedProof = null) {
    const blockers = new Set(uniqueBlockers);
    const hypotheses = [];
    if (uniqueBlockers.length === 0) {
        hypotheses.push(...(provedProof || ['no_reachable_action_effects']));
        return hypotheses;
    }
    if (blockers.has('reads_action')) {
        hypotheses.push('direct_action_reader_requires_runtime_or_level_proof');
    } else {
        hypotheses.push('no_direct_action_reader');
    }
    if (blockers.has('queues_again')) hypotheses.push('again_requires_wake_chain_proof');
    if (blockers.has('semantic_command')) hypotheses.push('semantic_command_requires_runtime_or_goal_proof');
    if (blockers.has('action_may_create_directional_movement')) hypotheses.push('directional_movement_requires_reachability_proof');
    if (blockers.has('rigid_rule')) hypotheses.push('rigid_rule_requires_runtime_proof');
    if (uniqueBlockers.every(blocker =>
        blocker === 'autonomous_solver_active_rule' || blocker === 'action_may_mutate_objects'
    )) {
        hypotheses.push('only_autonomous_object_mutation');
    }
    const changedObjects = uniqueSorted(blockerRules.flatMap(rule => rule.changed_objects || []));
    const transientChangedObjects = uniqueSorted(blockerRules.flatMap(rule => rule.transient_changed_objects || []));
    if (changedObjects.length > 0 && sameArray(changedObjects, transientChangedObjects)) {
        hypotheses.push('object_mutation_limited_to_transient_objects');
    }
    return uniqueSorted(hypotheses);
}

function actionUnnecessaryDiagnosticsFact(uniqueBlockers, blockerRules, provedProof = null) {
    const hypotheses = actionUnnecessaryDiagnosticHypotheses(uniqueBlockers, blockerRules, provedProof);
    const proof = uniqueBlockers.length === 0
        ? (provedProof || ['no_reachable_action_effects'])
        : [];
    return fact('movement_action', 'action_unnecessary_diagnostics', uniqueBlockers.length === 0 ? 'proved' : 'candidate', {
        value: {
            hypotheses,
            blockers: uniqueBlockers,
            blocker_rules: blockerRules,
        },
        blockers: uniqueBlockers,
        proof,
        evidence: blockerRules.map(rule => rule.rule_id),
    });
}

function combineMovementTaint(left, right) {
    if (left === 'exclusive' || right === 'exclusive') return 'exclusive';
    if (left === 'covered' || right === 'covered') return 'covered';
    return null;
}

function movementReachabilityTaint(psTagged, objectName, movementName, movementStates) {
    // Runtime movement matching is layer-based; keep object-level facts and derive
    // the layer view only at requirement-check time.
    const layerObjects = layerObjectsForObject(psTagged, objectName);
    let taint = null;
    const consider = key => {
        if (!movementStates.has(key)) return;
        taint = combineMovementTaint(taint, movementStates.get(key));
    };
    if (movementName === 'moving' || movementName === 'randomdir' || movementName === 'orthogonal') {
        for (const layerObject of layerObjects) {
            for (const movement of CARDINAL_MOVEMENTS) {
                consider(`${layerObject}:${movement}`);
            }
            if (movementName === 'moving') {
                consider(`${layerObject}:action`);
            }
            consider(`${layerObject}:moving`);
            consider(`${layerObject}:randomdir`);
        }
        return taint;
    }
    for (const layerObject of layerObjects) {
        consider(`${layerObject}:${movementName}`);
    }
    return taint;
}

function ruleMovementRequirementTaint(psTagged, rule, movementStates) {
    const requirements = movementRequirementsFromTerms(psTagged, rule.summary.lhs_terms);
    if (requirements.length === 0) return 'autonomous';
    let ruleTaint = null;
    for (const alternatives of requirements) {
        let requirementTaint = null;
        for (const requirement of alternatives) {
            requirementTaint = combineMovementTaint(
                requirementTaint,
                movementReachabilityTaint(psTagged, requirement.object, requirement.movement, movementStates)
            );
        }
        if (requirementTaint === null) return null;
        ruleTaint = combineMovementTaint(ruleTaint, requirementTaint);
    }
    return ruleTaint;
}

function setMovementState(movementStates, movementTag, taint) {
    const normalizedTaint = taint === 'autonomous' ? 'exclusive' : taint;
    const previous = movementStates.get(movementTag) || null;
    const next = combineMovementTaint(previous, normalizedTaint);
    if (previous === next) return false;
    movementStates.set(movementTag, next);
    return true;
}

function directionCoveredMovementStates(psTagged, activeEntries) {
    const movementStates = new Map(playerDirectionalMovementSeeds(psTagged).map(key => [key, 'covered']));
    let changed = true;
    while (changed) {
        changed = false;
        for (const entry of activeEntries) {
            const taint = ruleMovementRequirementTaint(psTagged, entry.rule, movementStates);
            if (taint === null) continue;
            for (const movementTag of movementEffectsFromTerms(psTagged, entry.rule.summary.rhs_terms)) {
                changed = setMovementState(movementStates, movementTag, 'covered') || changed;
            }
        }
    }
    return movementStates;
}

function visibleActionBranchObjectMutation(psTagged, rule) {
    const cosmeticObjects = cosmeticObjectNameSet(psTagged);
    return (rule.tags.objects_written || []).some(objectName => !cosmeticObjects.has(objectName))
        || (rule.tags.objects_erased || []).some(objectName => !cosmeticObjects.has(objectName));
}

function visibleActionBranchMovementEffects(psTagged, rule) {
    const cosmeticObjects = cosmeticObjectNameSet(psTagged);
    return movementEffectsFromTerms(psTagged, rule.summary.rhs_terms)
        .filter(movementTag => !cosmeticObjects.has(movementKeyObjectName(movementTag)));
}

function ambiguousActionDirectionSourceLines(psTagged, activeEntries) {
    const playerObjects = playerObjectNameSet(psTagged);
    const directionsBySourceLine = new Map();
    for (const entry of activeEntries) {
        const rule = entry.rule;
        if (!rule.tags.reads_action) continue;
        const directions = visibleActionBranchMovementEffects(psTagged, rule)
            .filter(movementTag => playerObjects.has(movementKeyObjectName(movementTag)))
            .map(movementKeyMovementName)
            .filter(movement => CARDINAL_MOVEMENTS.includes(movement));
        if (directions.length === 0) continue;
        if (!directionsBySourceLine.has(rule.source_line)) {
            directionsBySourceLine.set(rule.source_line, new Set());
        }
        addValues(directionsBySourceLine.get(rule.source_line), directions);
    }
    return new Set(Array.from(directionsBySourceLine.entries())
        .filter(([_line, directions]) => directions.size > 1)
        .map(([line]) => line));
}

function directionConsumedMovements(psTagged, activeEntries, directionMovementStates) {
    const consumed = new Set();
    for (const entry of activeEntries) {
        const rule = entry.rule;
        const taint = ruleMovementRequirementTaint(psTagged, rule, directionMovementStates);
        if (taint === null) continue;
        const written = new Set(rule.tags.movements_written || []);
        for (const movementTag of rule.tags.movements_removed || []) {
            if (written.has(movementTag)) continue;
            const objectName = movementKeyObjectName(movementTag);
            const movement = movementKeyMovementName(movementTag);
            for (const layerObject of layerObjectsForObject(psTagged, objectName)) {
                consumed.add(`${layerObject}:${movement}`);
            }
        }
    }
    return consumed;
}

function actionBranchMovementEffectsCoveredByDirectionInputs(psTagged, rule, movementEffects, directionMovements, directionConsumed, ambiguousSourceLines) {
    if (ambiguousSourceLines.has(rule.source_line)) return false;
    const playerObjects = playerObjectNameSet(psTagged);
    const cardinalDirections = new Set();
    const covered = movementEffects.every(movementTag => {
        if (!directionMovements.has(movementTag)) return false;
        if (directionConsumed.has(movementTag)) return false;
        const objectName = movementKeyObjectName(movementTag);
        const movement = movementKeyMovementName(movementTag);
        if (CARDINAL_MOVEMENTS.includes(movement)) {
            cardinalDirections.add(movement);
        }
        return playerObjects.has(objectName)
            && (CARDINAL_MOVEMENTS.includes(movement) || movement === 'moving');
    });
    return covered && cardinalDirections.size <= 1;
}

function actionExclusiveRuleReasons(psTagged, rule, reachabilityTaint, directionMovements, directionConsumed, ambiguousSourceLines) {
    const movementEffects = uniqueSorted(visibleActionBranchMovementEffects(psTagged, rule));
    const movementCovered = actionBranchMovementEffectsCoveredByDirectionInputs(
        psTagged,
        rule,
        movementEffects,
        directionMovements,
        directionConsumed,
        ambiguousSourceLines
    );
    const semanticCommand = rule.summary.semantic_commands.some(command => command !== 'again');
    const visibleObjectMutation = visibleActionBranchObjectMutation(psTagged, rule);
    const reasons = [];
    if (rule.tags.has_again) reasons.push('queues_again');
    if (semanticCommand) reasons.push('semantic_command');
    if (rule.rigid) reasons.push('rigid_rule');
    if (reachabilityTaint === 'autonomous') reasons.push('autonomous_solver_active_rule');
    if (visibleObjectMutation) reasons.push('action_may_mutate_objects');
    if (rule.tags.reads_action && (reasons.length > 0 || !movementCovered)) reasons.push('reads_action');
    if (!movementCovered) {
        if (movementEffects.some(movementTag => DIRECTIONAL_MOVEMENTS.has(movementKeyMovementName(movementTag)))) {
            reasons.push('action_may_create_directional_movement');
        }
    }
    return uniqueSorted(reasons);
}

function actionUnnecessaryProvedByInputIndependentTurnEffects(psTagged, uniqueBlockers, blockerRules) {
    const blockers = new Set(uniqueBlockers);
    void psTagged;
    if (blockers.size === 0) return true;
    if (blockers.has('reads_action') || blockers.has('rigid_rule')) return false;

    const changedObjects = uniqueSorted(blockerRules.flatMap(rule => rule.changed_objects || []));
    const transientChangedObjects = uniqueSorted(blockerRules.flatMap(rule => rule.transient_changed_objects || []));
    const movementEffects = uniqueSorted(blockerRules.flatMap(rule => rule.movement_effects || []));
    const changesOnlyTransientObjects = changedObjects.length > 0
        && sameArray(changedObjects, transientChangedObjects)
        && movementEffects.length === 0;
    if (changesOnlyTransientObjects) return true;

    return false;
}

function deriveMovementActionFacts(psTagged) {
    const activeEntries = allRuleEntries(psTagged).filter(entry =>
        entry.rule.tags.solver_state_active
        && !ruleProjectsToCosmeticMutationOnly(psTagged, entry.rule)
    );
    const activeRules = activeEntries.map(entry => entry.rule);
    if (psTagged.game.tags.has_action_input === false) {
        return [
            fact('movement_action', 'movements_reachable_from_action_input', 'proved', {
                value: [],
                proof: ['noaction_metadata_disables_action_input'],
            }),
            fact('movement_action', 'action_unnecessary', 'proved', {
                value: true,
                blockers: [],
                proof: ['noaction_metadata_disables_action_input'],
                evidence: [],
            }),
            fact('movement_action', 'action_unnecessary_diagnostics', 'proved', {
                value: {
                    hypotheses: ['already_noaction_metadata'],
                    blockers: [],
                    blocker_rules: [],
                },
                proof: ['noaction_metadata_disables_action_input'],
            }),
        ];
    }
    const directionMovementStates = directionCoveredMovementStates(psTagged, activeEntries);
    const directionMovements = new Set(directionMovementStates.keys());
    const directionConsumed = directionConsumedMovements(psTagged, activeEntries, directionMovementStates);
    const ambiguousSourceLines = ambiguousActionDirectionSourceLines(psTagged, activeEntries);
    const possibleMovements = new Set(playerActionMovementSeeds(psTagged));
    const movementStates = new Map(Array.from(possibleMovements, movementTag => [movementTag, 'exclusive']));
    const blockerRulesById = new Map();
    let actionEffectsCoveredByDirectionalInputs = false;
    let changed = true;
    while (changed) {
        changed = false;
        for (const entry of activeEntries) {
            const rule = entry.rule;
            const reachabilityTaint = ruleMovementRequirementTaint(psTagged, rule, movementStates);
            if (reachabilityTaint === null) continue;
            const reasons = reachabilityTaint === 'covered'
                ? []
                : actionExclusiveRuleReasons(psTagged, rule, reachabilityTaint, directionMovements, directionConsumed, ambiguousSourceLines);
            const diagnostic = actionUnnecessaryRuleDiagnostic(psTagged, entry, reasons);
            if (diagnostic && diagnostic.reasons.length > 0) {
                blockerRulesById.set(diagnostic.rule_id, diagnostic);
            }
            const movementEffects = reasons.length === 0
                ? visibleActionBranchMovementEffects(psTagged, rule)
                : movementEffectsFromTerms(psTagged, rule.summary.rhs_terms);
            if (reachabilityTaint !== 'covered'
                && reasons.length === 0
                && movementEffects.some(movementTag => directionMovements.has(movementTag))) {
                actionEffectsCoveredByDirectionalInputs = true;
            }
            for (const movementTag of movementEffects) {
                const nextTaint = reasons.length === 0 && directionMovements.has(movementTag)
                    ? 'covered'
                    : reachabilityTaint;
                if (!possibleMovements.has(movementTag)) {
                    possibleMovements.add(movementTag);
                    changed = true;
                }
                changed = setMovementState(movementStates, movementTag, nextTaint) || changed;
            }
        }
    }
    const blockerRules = Array.from(blockerRulesById.values())
        .sort((left, right) => left.source_line - right.source_line || compareNumericNames(left.rule_id, right.rule_id));
    const uniqueBlockers = uniqueSorted(blockerRules.flatMap(rule => rule.reasons));
    const provedByInputIndependentTurnEffects = actionUnnecessaryProvedByInputIndependentTurnEffects(
        psTagged,
        uniqueBlockers,
        blockerRules
    );
    const actionUnnecessaryProved = uniqueBlockers.length === 0 || provedByInputIndependentTurnEffects;
    const reportedBlockers = actionUnnecessaryProved ? [] : uniqueBlockers;
    const reportedBlockerRules = actionUnnecessaryProved ? [] : blockerRules;
    const actionUnnecessaryProof = uniqueBlockers.length === 0
        ? (actionEffectsCoveredByDirectionalInputs
            ? ['action_effects_covered_by_directional_inputs']
            : ['no_reachable_action_effects'])
        : (actionUnnecessaryProved ? ['input_independent_turn_effects_do_not_require_action_input'] : []);
    return [
        fact('movement_action', 'movements_reachable_from_action_input', 'proved', {
            value: Array.from(possibleMovements).sort(),
            proof: ['conservative_movement_reachability_fixpoint'],
        }),
        fact('movement_action', 'action_unnecessary', actionUnnecessaryProved ? 'proved' : 'rejected', {
            value: actionUnnecessaryProved,
            blockers: reportedBlockers,
            proof: actionUnnecessaryProof,
            evidence: activeRules.map(rule => rule.id),
        }),
        actionUnnecessaryDiagnosticsFact(
            reportedBlockers,
            reportedBlockerRules,
            actionUnnecessaryProved ? actionUnnecessaryProof : null
        ),
    ];
}

function termMentionsObject(term, objectName) {
    return (term.expanded_objects || []).includes(objectName);
}

function ruleMayAffectObject(psTagged, rule, objectName) {
    if (!rule.tags.solver_state_active || !rule.tags.object_mutating) return false;
    return objectWriteNames(psTagged, rule).has(objectName);
}

function ruleMayCreateObject(psTagged, rule, objectName) {
    if (!rule.tags.solver_state_active || !rule.tags.object_mutating) return false;
    return ruleFlowWrites(psTagged, rule).object_present.has(objectName);
}

function ruleMayDestroyObject(psTagged, rule, objectName) {
    if (!rule.tags.solver_state_active || !rule.tags.object_mutating) return false;
    return ruleFlowWrites(psTagged, rule).object_absent.has(objectName);
}

function ruleMayChangeObjectCount(psTagged, rule, objectName) {
    return ruleCountChangedObjects(psTagged, rule).has(objectName);
}

function incrementCount(map, objectName) {
    map.set(objectName, (map.get(objectName) || 0) + 1);
}

function addCountDelta(delta, objectName, amount) {
    const next = (delta.get(objectName) || 0) + amount;
    if (next === 0) {
        delta.delete(objectName);
    } else {
        delta.set(objectName, next);
    }
}

function concreteCellObjectsByLayer(psTagged, cell) {
    const byLayer = new Map();
    for (const term of cell || []) {
        if (term.kind !== 'present' || !term.ref || term.ref.type !== 'object') {
            return null;
        }
        const layer = layerForObject(psTagged, term.ref.name);
        if (byLayer.has(layer)) {
            return null;
        }
        byLayer.set(layer, term.ref.name);
    }
    return byLayer;
}

function exactRuleCountDelta(psTagged, rule) {
    if (!rule.tags.solver_state_active || !rule.tags.object_mutating) return new Map();

    const delta = new Map();
    const rowCount = Math.max(rule.lhs.length, rule.rhs.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const lhsRow = rule.lhs[rowIndex] || [];
        const rhsRow = rule.rhs[rowIndex] || [];
        const cellCount = maxCellsInRows(lhsRow, rhsRow);
        for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
            const lhsByLayer = concreteCellObjectsByLayer(psTagged, lhsRow[cellIndex] || []);
            const rhsByLayer = concreteCellObjectsByLayer(psTagged, rhsRow[cellIndex] || []);
            if (lhsByLayer === null || rhsByLayer === null) {
                return null;
            }

            const layers = new Set(lhsByLayer.keys());
            addValues(layers, rhsByLayer.keys());
            for (const layer of layers) {
                const lhsObject = lhsByLayer.get(layer) || null;
                const rhsObject = rhsByLayer.get(layer) || null;
                if (rhsObject !== null && lhsObject === null) {
                    return null;
                }
                if (lhsObject !== null && rhsObject !== null && lhsObject !== rhsObject) {
                    addCountDelta(delta, lhsObject, -1);
                    addCountDelta(delta, rhsObject, 1);
                } else if (lhsObject !== null && rhsObject === null) {
                    addCountDelta(delta, lhsObject, -1);
                }
            }
        }
    }
    return delta;
}

function exactDeltaTransformPair(delta) {
    const entries = Array.from(delta.entries()).filter(([_objectName, amount]) => amount !== 0);
    if (entries.length !== 2) return null;
    const decrements = entries.filter(([_objectName, amount]) => amount === -1);
    const increments = entries.filter(([_objectName, amount]) => amount === 1);
    if (decrements.length !== 1 || increments.length !== 1) return null;
    return [decrements[0][0], increments[0][0]];
}

function unionFindRoot(parents, objectName) {
    let parent = parents.get(objectName);
    if (parent === undefined) {
        parents.set(objectName, objectName);
        return objectName;
    }
    if (parent !== objectName) {
        parent = unionFindRoot(parents, parent);
        parents.set(objectName, parent);
    }
    return parent;
}

function unionFindUnion(parents, left, right) {
    const leftRoot = unionFindRoot(parents, left);
    const rightRoot = unionFindRoot(parents, right);
    if (leftRoot !== rightRoot) {
        parents.set(rightRoot, leftRoot);
    }
}

function linearCountCandidateComponents(deltaByRuleId, activeRules) {
    const parents = new Map();
    const ruleIdsByEdge = new Map();
    for (const rule of activeRules) {
        const delta = deltaByRuleId.get(rule.id);
        if (!delta) continue;
        const pair = exactDeltaTransformPair(delta);
        if (!pair) continue;
        unionFindUnion(parents, pair[0], pair[1]);
        const edgeKey = pair.slice().sort(compareNumericNames).join('\u0000');
        if (!ruleIdsByEdge.has(edgeKey)) ruleIdsByEdge.set(edgeKey, []);
        ruleIdsByEdge.get(edgeKey).push(rule.id);
    }

    const componentsByRoot = new Map();
    for (const objectName of parents.keys()) {
        const root = unionFindRoot(parents, objectName);
        if (!componentsByRoot.has(root)) componentsByRoot.set(root, new Set());
        componentsByRoot.get(root).add(objectName);
    }

    return Array.from(componentsByRoot.values())
        .map(component => uniqueSorted(component))
        .filter(component => component.length >= 2)
        .map(component => {
            const ruleIds = new Set();
            for (let left = 0; left < component.length; left++) {
                for (let right = left + 1; right < component.length; right++) {
                    const edgeKey = [component[left], component[right]].sort(compareNumericNames).join('\u0000');
                    addValues(ruleIds, ruleIdsByEdge.get(edgeKey) || []);
                }
            }
            return { objects: component, transform_rule_ids: uniqueSorted(ruleIds) };
        })
        .sort((left, right) => left.objects.join('\u0000').localeCompare(right.objects.join('\u0000'), undefined, { numeric: true }));
}

function ruleWritesAnyObject(psTagged, rule, objects) {
    const objectSet = new Set(objects);
    for (const objectName of objectWriteNames(psTagged, rule)) {
        if (objectSet.has(objectName)) return true;
    }
    return false;
}

function deriveLinearCountInvariantFacts(psTagged) {
    const activeRules = allRuleEntries(psTagged).map(entry => entry.rule).filter(rule => rule.tags.solver_state_active);
    const deltaByRuleId = new Map(activeRules.map(rule => [rule.id, exactRuleCountDelta(psTagged, rule)]));
    const components = linearCountCandidateComponents(deltaByRuleId, activeRules);
    const results = [];
    for (const component of components) {
        const componentSet = new Set(component.objects);
        const blockers = [];
        const evidence = new Set(component.transform_rule_ids);
        for (const rule of activeRules) {
            if (!rule.tags.object_mutating) continue;
            const delta = deltaByRuleId.get(rule.id);
            if (delta === null) {
                if (ruleWritesAnyObject(psTagged, rule, component.objects)) {
                    blockers.push('unknown_count_delta_rule');
                    evidence.add(rule.id);
                }
                continue;
            }
            let componentDelta = 0;
            for (const objectName of componentSet) {
                componentDelta += delta.get(objectName) || 0;
            }
            if (componentDelta !== 0) {
                blockers.push('component_sum_delta_nonzero');
                evidence.add(rule.id);
            }
        }
        const uniqueBlockers = uniqueSorted(blockers);
        const terms = component.objects.map(objectName => ({ object: objectName, coefficient: 1 }));
        const value = {
            invariant: 'count_sum_preserved',
            objects: component.objects,
            terms,
            transform_rule_ids: component.transform_rule_ids,
        };
        results.push(fact('linear_count_invariants', `count_sum_${component.objects.join('_')}_preserved`, uniqueBlockers.length === 0 ? 'proved' : 'rejected', {
            subjects: { objects: component.objects },
            value,
            proof: uniqueBlockers.length === 0 ? ['exact_count_delta_component_sum_zero'] : [],
            blockers: uniqueBlockers,
            evidence: uniqueSorted(evidence),
        }));
    }
    return results;
}

function cellPlayerMovements(cell, players) {
    const movements = new Set();
    for (const term of cell || []) {
        if (term.kind !== 'present' || !CARDINAL_MOVEMENTS.includes(term.movement)) continue;
        if ((term.expanded_objects || []).some(objectName => players.has(objectName))) {
            movements.add(term.movement);
        }
    }
    return movements;
}

function cellPushableObjects(cell, players) {
    const objects = new Set();
    for (const term of cell || []) {
        if (term.kind !== 'present' || term.movement !== null) continue;
        for (const objectName of term.expanded_objects || []) {
            if (!players.has(objectName)) objects.add(objectName);
        }
    }
    return objects;
}

function cellWritesObjectMovement(cell, objectName, movement) {
    return (cell || []).some(term =>
        term.kind === 'present'
        && term.movement === movement
        && (term.expanded_objects || []).includes(objectName)
    );
}

function adjacentCellsHavePusherSignature(playerCell, pushableCell, rhsPushableCell, players) {
    const playerMovements = cellPlayerMovements(playerCell, players);
    if (playerMovements.size === 0) return false;
    const pushables = cellPushableObjects(pushableCell, players);
    if (pushables.size === 0) return false;
    for (const movement of playerMovements) {
        for (const objectName of pushables) {
            if (cellWritesObjectMovement(rhsPushableCell, objectName, movement)) {
                return true;
            }
        }
    }
    return false;
}

function ruleHasPusherSignature(psTagged, rule) {
    if (!rule.tags.solver_state_active || !rule.tags.writes_movement) return false;
    const players = playerObjectNameSet(psTagged);
    if (players.size === 0) return false;

    for (let rowIndex = 0; rowIndex < rule.lhs.length; rowIndex++) {
        const lhsRow = rule.lhs[rowIndex] || [];
        const rhsRow = rule.rhs[rowIndex] || [];
        for (let cellIndex = 0; cellIndex + 1 < lhsRow.length; cellIndex++) {
            if (adjacentCellsHavePusherSignature(
                lhsRow[cellIndex],
                lhsRow[cellIndex + 1],
                rhsRow[cellIndex + 1] || [],
                players
            )) {
                return true;
            }
            if (adjacentCellsHavePusherSignature(
                lhsRow[cellIndex + 1],
                lhsRow[cellIndex],
                rhsRow[cellIndex] || [],
                players
            )) {
                return true;
            }
        }
    }
    return false;
}

function ruleMechanicSchemas(psTagged, rule) {
    const schemas = new Set();
    if (!rule.tags.solver_state_active) return schemas;

    const exactDelta = exactRuleCountDelta(psTagged, rule);
    const transformPair = exactDelta && exactDeltaTransformPair(exactDelta);
    if (transformPair) {
        schemas.add('transformer');
    }

    const countEffects = ruleCountEffectObjects(psTagged, rule);
    if (!transformPair && countEffects.increases.size > 0) {
        schemas.add('spawner');
    }

    if (ruleHasPusherSignature(psTagged, rule)) {
        schemas.add('pusher');
    }

    return schemas;
}

function deriveMechanicProfileFacts(psTagged) {
    const ruleSchemaCounts = new Map();
    const ruleIdsBySchema = new Map();
    const uncategorizedRuleIds = [];
    for (const { rule } of allRuleEntries(psTagged)) {
        if (!rule.tags.solver_state_active) continue;
        const schemas = ruleMechanicSchemas(psTagged, rule);
        if (schemas.size === 0) {
            uncategorizedRuleIds.push(rule.id);
            continue;
        }
        for (const schema of schemas) {
            ruleSchemaCounts.set(schema, (ruleSchemaCounts.get(schema) || 0) + 1);
            if (!ruleIdsBySchema.has(schema)) ruleIdsBySchema.set(schema, []);
            ruleIdsBySchema.get(schema).push(rule.id);
        }
    }

    const schemas = uniqueSorted(ruleSchemaCounts.keys());
    const blockers = [];
    if (psTagged.game.tags.has_random) blockers.push('random_mechanics');
    if (psTagged.game.tags.has_rigid) blockers.push('rigid_mechanics');
    if (psTagged.game.tags.has_autonomous_tick_rules) blockers.push('autonomous_tick_rules');
    if (uncategorizedRuleIds.length > 0) blockers.push('uncategorized_solver_active_rules');

    const ruleSchemaCountObject = {};
    const ruleIdsBySchemaObject = {};
    for (const schema of schemas) {
        ruleSchemaCountObject[schema] = ruleSchemaCounts.get(schema);
        ruleIdsBySchemaObject[schema] = uniqueSorted(ruleIdsBySchema.get(schema) || []);
    }
    psTagged.game.tags.mechanic_profile = {
        schemas,
        rule_schema_counts: ruleSchemaCountObject,
        blockers: uniqueSorted(blockers),
    };

    return [fact('mechanic_profile', 'mechanic_profile', 'candidate', {
        subjects: { rules: allRuleEntries(psTagged).map(entry => entry.rule.id) },
        value: {
            schemas,
            rule_schema_counts: ruleSchemaCountObject,
            rule_ids_by_schema: ruleIdsBySchemaObject,
            blockers: uniqueSorted(blockers),
            uncategorized_rule_ids: uniqueSorted(uncategorizedRuleIds),
        },
        proof: schemas.length > 0 ? ['syntactic_rule_mechanic_fingerprints'] : [],
        blockers: uniqueSorted(blockers),
        evidence: uniqueSorted(Object.values(ruleIdsBySchemaObject).flat().concat(uncategorizedRuleIds)),
    })];
}

function ruleCountEffectObjects(psTagged, rule) {
    const effects = {
        increases: new Set(),
        decreases: new Set(),
    };
    if (!rule.tags.solver_state_active || !rule.tags.object_mutating) return effects;

    const guaranteedCreates = new Map();
    const guaranteedDestroys = new Map();
    const rowCount = Math.max(rule.lhs.length, rule.rhs.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const lhsRow = rule.lhs[rowIndex] || [];
        const rhsRow = rule.rhs[rowIndex] || [];
        const cellCount = maxCellsInRows(lhsRow, rhsRow);
        for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
            const lhsCell = lhsRow[cellIndex] || [];
            const rhsCell = rhsRow[cellIndex] || [];
            const lhsPresent = presentObjectSet(lhsCell);
            const lhsAbsent = absentObjectSet(lhsCell);
            const rhsAbsent = absentObjectSet(rhsCell);
            const lhsRequiredPresent = requiredPresentObjectSet(lhsCell);
            const rhsRequiredPresent = requiredPresentObjectSet(rhsCell);
            const rhsInferredPresent = inferredRhsPropertyObjectSet(psTagged, lhsCell, rhsCell);
            const possibleCellObjects = new Set();
            addValues(possibleCellObjects, lhsPresent);
            addValues(possibleCellObjects, lhsRequiredPresent);
            addValues(possibleCellObjects, rhsRequiredPresent);
            addValues(possibleCellObjects, rhsInferredPresent);
            addValues(possibleCellObjects, rhsAbsent);

            for (const term of rhsCell) {
                if (term.kind !== 'present' && term.kind !== 'random_object') continue;
                addValues(possibleCellObjects, termObjects(term).flatMap(objectName =>
                    layerObjectsForObject(psTagged, objectName)
                ));
                if (term.kind === 'random_object') addValues(effects.increases, termObjects(term));
                if (term.kind === 'present'
                    && term.ref
                    && term.ref.type === 'object_set'
                    && !termObjects(term).every(objectName => rhsInferredPresent.has(objectName))) {
                    addValues(effects.increases, termObjects(term));
                }
            }

            for (const objectName of possibleCellObjects) {
                const lhsGuaranteesObject = lhsRequiredPresent.has(objectName);
                const rhsInferredObject = rhsInferredPresent.has(objectName);
                const rhsPreservesObject = !rhsAbsent.has(objectName)
                    && (rhsRequiredPresent.has(objectName) || rhsInferredObject);
                const couldContainObject = cellCouldContainObjectBefore(psTagged, lhsPresent, lhsAbsent, objectName);

                if (rhsPreservesObject) {
                    if (!couldContainObject) {
                        incrementCount(guaranteedCreates, objectName);
                    } else if (!lhsGuaranteesObject && !rhsInferredObject) {
                        effects.increases.add(objectName);
                    }
                    continue;
                }

                if (couldContainObject) {
                    if (lhsGuaranteesObject) {
                        incrementCount(guaranteedDestroys, objectName);
                    } else if (lhsPresent.has(objectName) || rhsAbsent.has(objectName)) {
                        effects.decreases.add(objectName);
                    }

                    const objectLayer = layerForObject(psTagged, objectName);
                    const writesSameLayerObject = rhsCell.some(term =>
                        (term.kind === 'present' || term.kind === 'random_object')
                        && !(term.kind === 'present'
                            && term.ref
                            && term.ref.type === 'object_set'
                            && termObjects(term).every(termObject => rhsInferredPresent.has(termObject)))
                        && termObjects(term).some(termObject =>
                            termObject !== objectName && layerForObject(psTagged, termObject) === objectLayer
                        )
                    );
                    if (writesSameLayerObject) effects.decreases.add(objectName);
                }
            }
        }
    }

    const guaranteedObjects = new Set(guaranteedCreates.keys());
    addValues(guaranteedObjects, guaranteedDestroys.keys());
    for (const objectName of guaranteedObjects) {
        const createCount = guaranteedCreates.get(objectName) || 0;
        const destroyCount = guaranteedDestroys.get(objectName) || 0;
        if (createCount > destroyCount) effects.increases.add(objectName);
        if (destroyCount > createCount) effects.decreases.add(objectName);
    }

    return effects;
}

function ruleCountChangedObjects(psTagged, rule) {
    const effects = ruleCountEffectObjects(psTagged, rule);
    const changed = new Set(effects.increases);
    addValues(changed, effects.decreases);
    return changed;
}

function playerObjectNameSet(psTagged) {
    const playerProperty = psTagged.properties.find(item =>
        item.canonical_name === 'player' || item.name.toLowerCase() === 'player'
    );
    if (playerProperty) return new Set(playerProperty.members);
    const playerObject = psTagged.objects.find(item =>
        item.canonical_name === 'player' || item.name.toLowerCase() === 'player'
    );
    return new Set(playerObject ? [playerObject.name] : []);
}

function ruleMovementMentionsObject(rule, objectName) {
    return rule.summary.lhs_terms.concat(rule.summary.rhs_terms).some(term =>
        term.movement !== null && termMentionsObject(term, objectName)
    );
}

function positiveObjectNamesFromTerms(terms) {
    return new Set(terms
        .filter(term => term.kind === 'present')
        .flatMap(term => term.expanded_objects || []));
}

function ruleMayCreateCollisionLayerObject(psTagged, rule, layer) {
    if (!rule.tags.solver_state_active || !rule.tags.object_mutating) return false;
    const lhsObjects = positiveObjectNamesFromTerms(rule.summary.lhs_terms);
    return rule.summary.rhs_terms.some(term => {
        if (term.kind !== 'present' && term.kind !== 'random_object') return false;
        return (term.expanded_objects || []).some(objectName =>
            layerForObject(psTagged, objectName) === layer
            && (term.kind === 'random_object' || !lhsObjects.has(objectName))
        );
    });
}

function addRuleForObject(map, objectName, rule) {
    if (!map.has(objectName)) map.set(objectName, []);
    map.get(objectName).push(rule);
}

function rulesForObject(map, objectName) {
    return map.get(objectName) || [];
}

function buildCountLayerRuleIndex(psTagged, activeRules) {
    const writersByObject = new Map();
    const creatorsByObject = new Map();
    const destroyersByObject = new Map();
    const movementRulesByObject = new Map();
    const layerCreateOverwritersByObject = new Map();
    const countChangersByObject = new Map();
    const countIncreasersByObject = new Map();
    const countDecreasersByObject = new Map();

    for (const rule of activeRules) {
        const writes = ruleFlowWrites(psTagged, rule);
        const writerObjects = new Set(writes.object_present);
        addValues(writerObjects, writes.object_absent);

        for (const objectName of writerObjects) addRuleForObject(writersByObject, objectName, rule);
        for (const objectName of writes.object_present) {
            addRuleForObject(creatorsByObject, objectName, rule);
        }
        for (const objectName of writes.object_absent) addRuleForObject(destroyersByObject, objectName, rule);

        const createdLayers = new Map();
        for (const objectName of writes.object_present) {
            const layer = layerForObject(psTagged, objectName);
            if (!createdLayers.has(layer)) createdLayers.set(layer, new Set());
            createdLayers.get(layer).add(objectName);
        }
        for (const objectName of writes.object_absent) {
            const createdOnLayer = createdLayers.get(layerForObject(psTagged, objectName));
            if (createdOnLayer && [...createdOnLayer].some(createdName => createdName !== objectName)) {
                addRuleForObject(layerCreateOverwritersByObject, objectName, rule);
            }
        }

        const countEffects = ruleCountEffectObjects(psTagged, rule);
        const countChangedObjects = new Set(countEffects.increases);
        addValues(countChangedObjects, countEffects.decreases);
        for (const objectName of countChangedObjects) {
            addRuleForObject(countChangersByObject, objectName, rule);
        }
        for (const objectName of countEffects.increases) addRuleForObject(countIncreasersByObject, objectName, rule);
        for (const objectName of countEffects.decreases) addRuleForObject(countDecreasersByObject, objectName, rule);

        const movementObjects = new Set((rule.tags.movements_written || [])
            .filter(movementKeyInvalidatesStatic)
            .map(movementKeyObjectName));
        for (const objectName of movementObjects) addRuleForObject(movementRulesByObject, objectName, rule);
    }

    return {
        writersByObject,
        creatorsByObject,
        destroyersByObject,
        movementRulesByObject,
        layerCreateOverwritersByObject,
        countChangersByObject,
        countIncreasersByObject,
        countDecreasersByObject,
    };
}

function deriveCountLayerInvariantFacts(psTagged) {
    const activeRules = allRuleEntries(psTagged).map(entry => entry.rule).filter(rule => rule.tags.solver_state_active);
    const ruleIndex = buildCountLayerRuleIndex(psTagged, activeRules);
    const playerObjects = playerObjectNameSet(psTagged);
    const results = [];
    for (const object of psTagged.objects) {
        const writers = rulesForObject(ruleIndex.writersByObject, object.name);
        const countChangers = rulesForObject(ruleIndex.countChangersByObject, object.name);
        const countIncreasers = rulesForObject(ruleIndex.countIncreasersByObject, object.name);
        const countDecreasers = rulesForObject(ruleIndex.countDecreasersByObject, object.name);
        const creators = rulesForObject(ruleIndex.creatorsByObject, object.name);
        const destroyers = rulesForObject(ruleIndex.destroyersByObject, object.name);
        const movementRules = rulesForObject(ruleIndex.movementRulesByObject, object.name);
        const layerCreateOverwriters = rulesForObject(ruleIndex.layerCreateOverwritersByObject, object.name);
        const staticBlockers = [];
        if (writers.length > 0) staticBlockers.push('object_written_by_solver_active_rule');
        if (layerCreateOverwriters.length > 0) staticBlockers.push('collision_layer_object_may_be_created');
        if (movementRules.length > 0 || playerObjects.has(object.name)) staticBlockers.push('object_may_receive_movement');
        object.tags.may_be_created = creators.length > 0;
        object.tags.may_be_destroyed = destroyers.length > 0;
        object.tags.quantity = {
            never_increases: countIncreasers.length === 0,
            never_decreases: countDecreasers.length === 0,
        };
        object.tags.static = staticBlockers.length === 0;
        results.push(fact('count_layer_invariants', `object_${object.name}_count_preserved`, countChangers.length === 0 ? 'proved' : 'rejected', {
            subjects: { objects: [object.name] },
            proof: countChangers.length === 0 ? ['no_solver_active_rule_changes_object_count'] : [],
            blockers: countChangers.length === 0 ? [] : ['object_written_by_solver_active_rule'],
            evidence: countChangers.map(rule => rule.id),
        }));
        results.push(fact('count_layer_invariants', `object_${object.name}_static`, staticBlockers.length === 0 ? 'proved' : 'rejected', {
            subjects: { objects: [object.name] },
            proof: staticBlockers.length === 0
                ? ['no_solver_active_rule_writes_object', 'no_movement_applied_to_object']
                : [],
            blockers: uniqueSorted(staticBlockers),
            evidence: uniqueSorted(writers.concat(layerCreateOverwriters, movementRules).map(rule => rule.id)),
        }));
    }
    for (const layer of psTagged.collision_layers) {
        const layerWriterIds = uniqueSorted(layer.objects.flatMap(objectName =>
            rulesForObject(ruleIndex.writersByObject, objectName).map(rule => rule.id)
        ));
        const nonStaticObjects = uniqueSorted(layer.objects.filter(objectName => {
            const object = psTagged.objects.find(item => item.name === objectName);
            return !object || !object.tags.static;
        }));
        const layerBlockers = [];
        if (layerWriterIds.length > 0) layerBlockers.push('layer_objects_may_change');
        if (nonStaticObjects.length > 0) layerBlockers.push('layer_contains_nonstatic_object');
        layer.tags.static = layerBlockers.length === 0;
        results.push(fact('count_layer_invariants', `layer_${layer.id}_static`, layerBlockers.length === 0 ? 'proved' : 'candidate', {
            subjects: { layers: [layer.id] },
            proof: layerBlockers.length === 0 ? ['all_layer_objects_static'] : [],
            blockers: layerBlockers,
            evidence: uniqueSorted(layerWriterIds.concat(nonStaticObjects)),
        }));
    }
    return results;
}

function rulesInSection(psTagged, sectionName) {
    const section = psTagged.rule_sections.find(item => item.name === sectionName);
    return section ? section.groups.flatMap(group => group.rules.map(rule => ({ section, group, rule }))) : [];
}

function ruleHasPositiveLhsObject(rule, objectName) {
    return rule.summary.lhs_terms.some(term => term.kind === 'present' && termMentionsObject(term, objectName));
}

function termIsConcreteObject(term, objectName) {
    return term
        && term.ref
        && term.ref.type === 'object'
        && term.ref.name === objectName;
}

function ruleHasPositiveConcreteLhsObject(rule, objectName) {
    return rule.summary.lhs_terms.some(term => term.kind === 'present' && termIsConcreteObject(term, objectName));
}

function rulePresentsObjectOnRhs(rule, objectName) {
    return rule.summary.rhs_terms.some(term =>
        (term.kind === 'present' || term.kind === 'random_object') && termMentionsObject(term, objectName)
    );
}

function ruleCreatesObject(rule, objectName) {
    return rule.tags.solver_state_active
        && rule.tags.object_mutating
        && rulePresentsObjectOnRhs(rule, objectName)
        && !ruleHasPositiveConcreteLhsObject(rule, objectName);
}

function creatorsForObject(psTagged, objectName) {
    return allRuleEntries(psTagged).filter(entry => ruleCreatesObject(entry.rule, objectName));
}

function lateClearersForObject(psTagged, objectName) {
    return rulesInSection(psTagged, 'late')
        .filter(entry => entry.rule.tags.solver_state_active)
        .filter(entry => ruleUnconditionallyClearsObject(entry.rule, objectName));
}

function ruleUnconditionallyClearsObject(rule, objectName) {
    if (rule.random_rule) {
        return false;
    }
    if (!rule.tags || !(rule.tags.objects_erased || []).includes(objectName)) {
        return false;
    }
    if (!Array.isArray(rule.lhs) || rule.lhs.length !== 1 || !Array.isArray(rule.lhs[0]) || rule.lhs[0].length !== 1) {
        return false;
    }
    const lhsTerms = rule.summary.lhs_terms;
    if (lhsTerms.length !== 1) return false;
    const lhsTerm = lhsTerms[0];
    if (lhsTerm.kind !== 'present' || lhsTerm.movement !== null || !termMentionsObject(lhsTerm, objectName)) {
        return false;
    }
    return !rule.summary.rhs_terms.some(term => term.kind === 'present' && termMentionsObject(term, objectName));
}

function ruleEntryBefore(left, right) {
    if (left.section.name === 'early' && right.section.name === 'late') return true;
    if (left.section.name === right.section.name) return left.group.group_index < right.group.group_index;
    return false;
}

function allCreatorsHaveLaterClearer(creators, clearers) {
    return creators.every(creator => clearers.some(clearer => ruleEntryBefore(creator, clearer)));
}

function objectInWincondition(psTagged, objectName) {
    return psTagged.winconditions.some(win => win.subjects.includes(objectName) || win.targets.includes(objectName));
}

function objectsMentionedInRules(psTagged) {
    const names = new Set();
    for (const { rule } of allRuleEntries(psTagged)) {
        for (const term of rule.summary.lhs_terms.concat(rule.summary.rhs_terms)) {
            for (const objectName of term.expanded_objects || []) {
                names.add(objectName);
            }
        }
    }
    return names;
}

function tagInertCollisionLayers(psTagged) {
    const mentioned = objectsMentionedInRules(psTagged);
    const players = playerObjectNameSet(psTagged);
    for (const layer of psTagged.collision_layers) {
        let inert = true;
        for (const objectName of layer.objects) {
            if (players.has(objectName) || mentioned.has(objectName) || objectInWincondition(psTagged, objectName)) {
                inert = false;
                break;
            }
        }
        layer.tags.inert = inert;
    }
}

function objectReadNames(rule) {
    const flow = ruleFlowReads(rule);
    const names = new Set(flow.object_present);
    addValues(names, flow.object_absent);
    for (const entry of flow.movement) {
        names.add(entry.object);
    }
    return names;
}

function objectWriteNames(psTagged, rule) {
    const flow = ruleFlowWrites(psTagged, rule);
    const names = new Set(flow.object_present);
    addValues(names, flow.object_absent);
    return names;
}

function tagCosmeticObjects(psTagged) {
    const nonCosmetic = new Set(playerObjectNameSet(psTagged));

    for (const win of psTagged.winconditions) {
        addValues(nonCosmetic, win.tags.objects_matched);
        addValues(nonCosmetic, win.tags.object_absences_matched);
    }

    for (const { rule } of allRuleEntries(psTagged)) {
        if (rule.tags.cosmetic) continue;
        addValues(nonCosmetic, rule.tags.objects_matched);
        addValues(nonCosmetic, rule.tags.object_absences_matched);
        for (const key of rule.tags.movements_matched) {
            nonCosmetic.add(movementKeyObjectName(key));
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const layer of psTagged.collision_layers || []) {
            const layerObjects = layer.objects || [];
            if (!layerObjects.some(obj => nonCosmetic.has(obj))) continue;
            for (const obj of layerObjects) {
                if (!nonCosmetic.has(obj)) {
                    nonCosmetic.add(obj);
                    changed = true;
                }
            }
        }
    }

    for (const object of psTagged.objects) {
        object.tags.cosmetic = !nonCosmetic.has(object.name);
    }
}

const NON_COSMETIC_COMMANDS = new Set(['again', 'restart', 'cancel', 'win']);

function movementTouchedObjectSet(rule) {
    const out = new Set();
    for (const key of rule.tags.movements_written || []) {
        out.add(movementKeyObjectName(key));
    }
    for (const key of rule.tags.movements_removed || []) {
        out.add(movementKeyObjectName(key));
    }
    return out;
}

function ruleCanAffectObjectReadSet(rule, readSet) {
    if ([...rule.tags.objects_written, ...rule.tags.objects_erased].some(obj => readSet.has(obj))) {
        return true;
    }
    return [...movementTouchedObjectSet(rule)].some(obj => readSet.has(obj));
}

function addRuleToIndex(index, key, rule) {
    if (!index.has(key)) {
        index.set(key, []);
    }
    index.get(key).push(rule);
}

function buildCosmeticRuleAffectIndex(rules) {
    const byObject = new Map();
    const byMovement = new Map();
    for (const rule of rules) {
        const objectKeys = new Set([...(rule.tags.objects_written || []), ...(rule.tags.objects_erased || [])]);
        addValues(objectKeys, movementTouchedObjectSet(rule));
        for (const objectName of objectKeys) {
            addRuleToIndex(byObject, objectName, rule);
        }
        for (const movement of rule.tags.movements_written || []) {
            addRuleToIndex(byMovement, movement, rule);
        }
        for (const movement of rule.tags.movements_removed || []) {
            addRuleToIndex(byMovement, movement, rule);
        }
    }
    return { byObject, byMovement };
}

function cosmeticRuleReadObjects(rule) {
    return new Set([...(rule.tags.objects_matched || []), ...(rule.tags.object_absences_matched || [])]);
}

function tagCosmeticRules(psTagged) {
    const allRules = allRuleEntries(psTagged).map(entry => entry.rule);
    const nonCosmetic = new Set();
    const pending = [];
    const playerObjects = playerObjectNameSet(psTagged);
    const affectIndex = buildCosmeticRuleAffectIndex(allRules);

    function markNonCosmetic(rule) {
        if (nonCosmetic.has(rule.id)) return;
        nonCosmetic.add(rule.id);
        pending.push(rule);
    }

    for (const rule of allRules) {
        if (rule.summary.semantic_commands.some(cmd => NON_COSMETIC_COMMANDS.has(cmd))) {
            markNonCosmetic(rule);
        } else if (ruleCanAffectObjectReadSet(rule, playerObjects)) {
            markNonCosmetic(rule);
        }
    }

    for (const rule of allRules) {
        if (nonCosmetic.has(rule.id)) continue;
        for (const win of psTagged.winconditions) {
            const winReadSet = new Set([...win.tags.objects_matched, ...win.tags.object_absences_matched]);
            if (ruleCanAffectObjectReadSet(rule, winReadSet)) {
                markNonCosmetic(rule);
                break;
            }
        }
    }

    const propagatedObjects = new Set();
    const propagatedMovements = new Set();
    for (let index = 0; index < pending.length; index++) {
        const rule = pending[index];
        for (const objectName of cosmeticRuleReadObjects(rule)) {
            if (propagatedObjects.has(objectName)) continue;
            propagatedObjects.add(objectName);
            for (const affectingRule of affectIndex.byObject.get(objectName) || []) {
                markNonCosmetic(affectingRule);
            }
        }
        for (const movement of rule.tags.movements_matched || []) {
            if (propagatedMovements.has(movement)) continue;
            propagatedMovements.add(movement);
            for (const affectingRule of affectIndex.byMovement.get(movement) || []) {
                markNonCosmetic(affectingRule);
            }
        }
    }

    for (const rule of allRules) {
        rule.tags.cosmetic = !nonCosmetic.has(rule.id);
    }
}

function deriveTransientBoundaryFacts(psTagged) {
    const results = [];
    for (const object of psTagged.objects) {
        const transient = transientBoundaryStatusForObject(psTagged, object.name);
        const status = transient.status;
        object.tags.temporary = status === 'proved';
        results.push(fact('transient_boundary', `object_${object.name}_end_turn_transient`, status, {
            subjects: { objects: [object.name] },
            tags: { single_turn_only: true },
            proof: status === 'proved' ? ['created_before_late_cleanup', 'cleared_in_late_rules', 'absent_from_initial_levels_and_winconditions'] : [],
            blockers: transient.blockers,
            evidence: transient.evidence,
        }));
    }
    return results;
}

function addValues(target, values) {
    for (const value of values) target.add(value);
}

function termObjects(term) {
    return term.expanded_objects || [];
}

function termObjectsExcept(term, excludedObjects) {
    if (!excludedObjects || excludedObjects.size === 0) return termObjects(term);
    return termObjects(term).filter(objectName => !excludedObjects.has(objectName));
}

function objectSetTermKind(psTagged, term) {
    if (!term || !term.ref || term.ref.type !== 'object_set') return null;
    const source = term.ref.source;
    const property = (psTagged.properties || []).find(item =>
        item.name === source || item.canonical_name === source
    );
    return property ? property.kind : null;
}

function rulePositiveObjectRequirementAlternatives(psTagged, rule) {
    const requirements = [];
    for (const row of rule.lhs || []) {
        for (const cell of row || []) {
            const absentInCell = absentObjectSet(cell);
            for (const term of cell || []) {
                if (term.kind !== 'present') continue;
                const objects = uniqueSorted(termObjectsExcept(term, absentInCell));
                if (objects.length === 0) continue;
                if (objectSetTermKind(psTagged, term) === 'aggregate') {
                    for (const objectName of objects) requirements.push([objectName]);
                } else {
                    requirements.push(objects);
                }
            }
        }
    }
    return requirements;
}

function ruleRequirementsReachable(requirements, reachableObjects) {
    return requirements.every(alternatives =>
        alternatives.some(objectName => reachableObjects.has(objectName))
    );
}

function computeLevelObjectUniverse(psTagged, level) {
    const initialObjects = new Set(level.objects_present || []);
    const reachableObjects = new Set(initialObjects);
    const creatorRuleIds = new Set();
    const activeEntries = allRuleEntries(psTagged).filter(entry =>
        entry.rule.tags.solver_state_active && entry.rule.tags.object_mutating
    );
    const ruleData = activeEntries.map(entry => ({
        rule: entry.rule,
        requirements: rulePositiveObjectRequirementAlternatives(psTagged, entry.rule),
        writes: uniqueSorted(ruleFlowWrites(psTagged, entry.rule).object_present),
    })).filter(entry => entry.writes.length > 0);

    let changed = true;
    while (changed) {
        changed = false;
        for (const entry of ruleData) {
            if (!ruleRequirementsReachable(entry.requirements, reachableObjects)) continue;
            let added = false;
            for (const objectName of entry.writes) {
                if (reachableObjects.has(objectName)) continue;
                reachableObjects.add(objectName);
                changed = true;
                added = true;
            }
            if (added) creatorRuleIds.add(entry.rule.id);
        }
    }

    const allObjects = uniqueSorted((psTagged.objects || []).map(object => object.name));
    const initial = uniqueSorted(initialObjects);
    const reachable = uniqueSorted(reachableObjects);
    const initialSet = new Set(initial);
    return {
        level_index: level.index,
        initial_objects: initial,
        reachable_objects: reachable,
        created_objects: uniqueSorted(reachable.filter(objectName => !initialSet.has(objectName))),
        unreachable_objects: uniqueSorted(allObjects.filter(objectName => !reachableObjects.has(objectName))),
        creator_rule_ids: uniqueSorted(creatorRuleIds),
    };
}

function derivePerLevelObjectUniverseFacts(psTagged) {
    const results = [];
    for (const level of psTagged.levels || []) {
        if (level.kind !== 'level') continue;
        const value = computeLevelObjectUniverse(psTagged, level);
        level.tags.reachable_objects = value.reachable_objects.slice();
        level.tags.unreachable_objects = value.unreachable_objects.slice();
        results.push(fact('per_level_object_universe', `level_${level.index}_object_universe`, 'proved', {
            subjects: { levels: [level.index] },
            value,
            proof: ['initial_level_objects', 'conservative_positive_requirement_creation_closure'],
            evidence: value.creator_rule_ids,
        }));
    }
    return results;
}

function movementExpansions(movement) {
    if (movement === 'randomdir') return CARDINAL_MOVEMENTS.concat(['moving', 'randomdir']);
    if (CARDINAL_MOVEMENTS.includes(movement)) return [movement, 'moving'];
    return [movement];
}

function ruleFlowReads(rule) {
    const objectPresent = new Set();
    const objectAbsent = new Set();
    const movement = [];
    for (const row of rule.lhs) {
        for (const cell of row) {
            const absentInCell = absentObjectSet(cell);
            for (const term of cell) {
                if (term.kind === 'present') {
                    const objects = termObjectsExcept(term, absentInCell);
                    addValues(objectPresent, objects);
                    if (term.movement !== null) {
                        for (const objectName of objects) {
                            movement.push({ object: objectName, movement: term.movement });
                        }
                    }
                } else if (term.kind === 'absent') {
                    addValues(objectAbsent, termObjects(term));
                }
            }
        }
    }
    return { object_present: objectPresent, object_absent: objectAbsent, movement };
}

function movementTermKeys(terms, excludedObjects = null) {
    const keys = new Set();
    for (const term of terms) {
        if (term.kind !== 'present' || term.movement === null) continue;
        for (const objectName of termObjectsExcept(term, excludedObjects)) {
            keys.add(`${objectName}:${term.movement}`);
        }
    }
    return keys;
}

function movementKeyObjectName(key) {
    return key.slice(0, key.lastIndexOf(':'));
}

function movementKeysContainObject(keys, objectName) {
    return Array.from(keys).some(key => movementKeyObjectName(key) === objectName);
}

function possibleMovementStateKeys(objectName) {
    return POSITIVE_MOVEMENT_STATES.map(movement => `${objectName}:${movement}`);
}

function presentObjectSet(terms, excludedObjects = null) {
    const objects = new Set();
    for (const term of terms) {
        if (term.kind === 'present' || term.kind === 'random_object') {
            addValues(objects, termObjectsExcept(term, excludedObjects));
        }
    }
    return objects;
}

function absentObjectSet(terms) {
    const objects = new Set();
    for (const term of terms) {
        if (term.kind === 'absent') {
            addValues(objects, termObjects(term));
        }
    }
    return objects;
}

function sameObjectSet(left, right, excludedObjects = null) {
    const leftObjects = uniqueSorted(termObjectsExcept(left, excludedObjects));
    const rightObjects = uniqueSorted(termObjectsExcept(right, excludedObjects));
    return JSON.stringify(leftObjects) === JSON.stringify(rightObjects);
}

function rhsTermIsSameLhsProperty(lhsProperties, rhsTerm, excludedObjects = null) {
    return rhsTerm.kind === 'present'
        && rhsTerm.ref
        && rhsTerm.ref.type === 'object_set'
        && lhsProperties.some(lhsTerm => sameObjectSet(lhsTerm, rhsTerm, excludedObjects));
}

function rhsNonPreservingWriteLayers(psTagged, lhsProperties, rhsCell, excludedObjects = null) {
    const layers = new Set();
    for (const rhsTerm of rhsCell) {
        if (rhsTerm.kind !== 'present' && rhsTerm.kind !== 'random_object') continue;
        if (rhsTermIsSameLhsProperty(lhsProperties, rhsTerm, excludedObjects)) continue;
        for (const objectName of termObjects(rhsTerm)) {
            layers.add(layerForObject(psTagged, objectName));
        }
    }
    return layers;
}

function inferredRhsPropertyObjectSet(psTagged, lhsCell, rhsCell) {
    const objects = new Set();
    const lhsAbsent = absentObjectSet(lhsCell);
    const lhsProperties = lhsCell.filter(term =>
        term.kind === 'present' && term.ref && term.ref.type === 'object_set'
    );
    const overwrittenLayers = rhsNonPreservingWriteLayers(psTagged, lhsProperties, rhsCell, lhsAbsent);
    for (const rhsTerm of rhsCell) {
        if (rhsTerm.kind !== 'present' || !rhsTerm.ref || rhsTerm.ref.type !== 'object_set') continue;
        if (rhsTermIsSameLhsProperty(lhsProperties, rhsTerm, lhsAbsent)) {
            for (const objectName of termObjectsExcept(rhsTerm, lhsAbsent)) {
                if (!overwrittenLayers.has(layerForObject(psTagged, objectName))) {
                    objects.add(objectName);
                }
            }
        }
    }
    return objects;
}

function layerObjectsForObject(psTagged, objectName) {
    const layer = layerForObject(psTagged, objectName);
    const collisionLayer = psTagged.collision_layers.find(item => item.id === layer);
    return collisionLayer ? collisionLayer.objects : [];
}

function objectsInLayer(psTagged, objectNames, layer) {
    return Array.from(objectNames).filter(objectName => layerForObject(psTagged, objectName) === layer);
}

function objectCanCoexistWithRequiredObjects(psTagged, requiredObjects, objectName) {
    const objectLayer = layerForObject(psTagged, objectName);
    for (const requiredObject of requiredObjects) {
        if (requiredObject !== objectName && layerForObject(psTagged, requiredObject) === objectLayer) {
            return false;
        }
    }
    return true;
}

function cellCouldContainObjectBefore(psTagged, lhsPresent, lhsAbsent, objectName) {
    if (lhsAbsent.has(objectName)) return false;
    const lhsPresentOnLayer = objectsInLayer(psTagged, lhsPresent, layerForObject(psTagged, objectName));
    return lhsPresentOnLayer.length === 0 || lhsPresentOnLayer.includes(objectName);
}

function maxCellsInRows(leftRow, rightRow) {
    return Math.max(leftRow ? leftRow.length : 0, rightRow ? rightRow.length : 0);
}

function objectSetSignature(objectNames) {
    return uniqueSorted(objectNames).join('|');
}

function isCardinalDeliveryMovement(movement) {
    return CARDINAL_MOVEMENTS.includes(movement) || movement === 'moving' || movement === 'randomdir';
}

// Object-set signatures of LHS present terms carrying a cardinal movement read
// (e.g. `> wallAndPlayer`). A fresh RHS write of the same object set is the sink
// of that moving property, so only members that can originate the movement can
// actually land there.
function cardinallyMovedLhsPropertySignatures(rule) {
    const signatures = new Set();
    for (const row of rule.lhs) {
        for (const cell of row) {
            const absent = absentObjectSet(cell);
            for (const term of cell) {
                if (term.kind !== 'present' || term.movement === null) continue;
                if (!isCardinalDeliveryMovement(term.movement)) continue;
                if (!term.ref || term.ref.type !== 'object_set') continue;
                signatures.add(objectSetSignature(termObjectsExcept(term, absent)));
            }
        }
    }
    return signatures;
}

function ruleFlowWrites(psTagged, rule) {
    const objectPresent = new Set();
    const objectAbsent = new Set();
    const movement = [];
    const rhsPresent = presentObjectSet(rule.summary.rhs_terms);
    const movedPropertySignatures = cardinallyMovedLhsPropertySignatures(rule);
    const movers = psTagged.objects_originating_movement;

    if (rule.tags.object_mutating) {
        const rowCount = Math.max(rule.lhs.length, rule.rhs.length);
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
            const lhsRow = rule.lhs[rowIndex] || [];
            const rhsRow = rule.rhs[rowIndex] || [];
            const cellCount = maxCellsInRows(lhsRow, rhsRow);
            for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
                const lhsCell = lhsRow[cellIndex] || [];
                const rhsCell = rhsRow[cellIndex] || [];
                const lhsAbsent = absentObjectSet(lhsCell);
                const lhsRequiredPresent = requiredPresentObjectSet(lhsCell, lhsAbsent);
                // Raw LHS-present objects, NOT minus the cell's `no` set. An
                // object that is required present on the LHS is preserved when the
                // RHS writes it back, even when the cell also forbids it (a dead
                // `X` + `no X` branch): the rule never fires, so it is not a fresh
                // write. Matches native's objectsPresent-based preserve check.
                const lhsPresentObjects = requiredPresentObjectSet(lhsCell);
                const lhsMatchedPresent = presentObjectSet(lhsCell, lhsAbsent);
                // Layer occupancy for "could this sibling have been here before?"
                // must use the raw present set (NOT minus the `no` set). In a dead
                // `X` + `no X` branch the slot is still occupied by X, so a
                // same-layer sibling could not also be there and is not overwritten.
                // Matches native's objectsPresent-based reachability gate.
                const lhsOccupiedPresent = presentObjectSet(lhsCell);
                const rhsInferredPresent = inferredRhsPropertyObjectSet(psTagged, lhsCell, rhsCell);
                const rhsCellDefinitePresent = requiredPresentObjectSet(rhsCell);
                const lhsProperties = lhsCell.filter(term =>
                    term.kind === 'present' && term.ref && term.ref.type === 'object_set'
                );
                addValues(rhsCellDefinitePresent, rhsInferredPresent);

                for (const term of rhsCell) {
                    if (term.kind === 'present' || term.kind === 'random_object') {
                        const termPreservesLhsProperty = term.kind === 'present'
                            && term.ref
                            && term.ref.type === 'object_set'
                            && rhsTermIsSameLhsProperty(lhsProperties, term, lhsAbsent);
                        let rhsTermObjects = termPreservesLhsProperty
                            ? termObjectsExcept(term, lhsAbsent)
                            : termObjects(term);
                        // A fresh write of a property that the rule moves in by
                        // cardinal movement only delivers members that can be in
                        // motion; non-movers (e.g. `wall` in `> wallAndPlayer`)
                        // never land, so they neither write nor overwrite here.
                        if (!termPreservesLhsProperty
                            && term.kind === 'present'
                            && term.ref
                            && term.ref.type === 'object_set'
                            && movers
                            && movedPropertySignatures.has(objectSetSignature(rhsTermObjects))) {
                            rhsTermObjects = rhsTermObjects.filter(objectName => movers.has(objectName));
                        }
                        const writtenObjects = rhsTermObjects.filter(objectName => {
                            if (term.kind === 'random_object') return true;
                            if (lhsRequiredPresent.has(objectName)) return false;
                            if (lhsPresentObjects.has(objectName)) return false;
                            if (term.ref && term.ref.type === 'object_set' && rhsInferredPresent.has(objectName)) return false;
                            return true;
                        });
                        addValues(objectPresent, writtenObjects);
                        if (term.kind === 'present'
                            && term.ref
                            && term.ref.type === 'object_set'
                            && rhsTermObjects.every(objectName => rhsInferredPresent.has(objectName))) {
                            continue;
                        }
                        for (const objectName of rhsTermObjects) {
                            for (const sibling of layerObjectsForObject(psTagged, objectName)) {
                                if (sibling === objectName || rhsCellDefinitePresent.has(sibling)) continue;
                                if (cellCouldContainObjectBefore(psTagged, lhsOccupiedPresent, lhsAbsent, sibling)) {
                                    objectAbsent.add(sibling);
                                }
                            }
                        }
                    } else if (term.kind === 'absent') {
                        for (const objectName of termObjects(term)) {
                            if (cellCouldContainObjectBefore(psTagged, lhsOccupiedPresent, lhsAbsent, objectName)) {
                                objectAbsent.add(objectName);
                            }
                        }
                    }
                }

                for (const objectName of lhsMatchedPresent) {
                    if (!rhsCellDefinitePresent.has(objectName)) {
                        objectAbsent.add(objectName);
                    }
                }
            }
        }
    }

    if (rule.tags.writes_movement) {
        const rowCount = Math.max(rule.lhs.length, rule.rhs.length);
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
            const lhsRow = rule.lhs[rowIndex] || [];
            const rhsRow = rule.rhs[rowIndex] || [];
            const cellCount = maxCellsInRows(lhsRow, rhsRow);
            for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
                const lhsCell = lhsRow[cellIndex] || [];
                const rhsCell = rhsRow[cellIndex] || [];
                const lhsAbsent = absentObjectSet(lhsCell);
                const lhsMovementKeys = movementTermKeys(lhsCell, lhsAbsent);
                const rhsMovementKeys = movementTermKeys(rhsCell);
                const rhsPresent = presentObjectSet(rhsCell);
                const rhsRequiredPresent = requiredPresentObjectSet(rhsCell);

                for (const term of rhsCell) {
                    if (term.kind !== 'present' || term.movement === null) continue;
                    for (const objectName of termObjects(term)) {
                        if (!objectCanCoexistWithRequiredObjects(psTagged, rhsRequiredPresent, objectName)) continue;
                        if (lhsMovementKeys.has(`${objectName}:${term.movement}`)) continue;
                        for (const movementName of movementExpansions(term.movement)) {
                            movement.push({ object: objectName, movement: movementName });
                        }
                    }
                }
                for (const key of lhsMovementKeys) {
                    if (rhsMovementKeys.has(key)) continue;
                    const objectName = movementKeyObjectName(key);
                    if (rhsPresent.has(objectName) && !movementKeysContainObject(rhsMovementKeys, objectName)) {
                        movement.push({ object: objectName, movement: 'stationary' });
                    }
                }
            }
        }
    }

    return { object_present: objectPresent, object_absent: objectAbsent, movement };
}

function requiredPresentObjectSet(terms, excludedObjects = null) {
    const objects = new Set();
    for (const term of terms) {
        if (term.kind === 'present' && term.ref && term.ref.type === 'object') {
            addValues(objects, termObjectsExcept(term, excludedObjects));
        }
    }
    return objects;
}

function ruleFlowReadTags(rule) {
    const objectsRequired = new Set();
    const objectsMatched = new Set();
    const objectAbsencesMatched = new Set();
    const movementsRequired = new Set();
    const movementsMatched = new Set();
    for (const row of rule.lhs) {
        for (const cell of row) {
            const absentInCell = absentObjectSet(cell);
            for (const term of cell) {
                if (term.kind === 'present') {
                    const objects = termObjectsExcept(term, absentInCell);
                    addValues(objectsMatched, objects);
                    if (term.ref && term.ref.type === 'object') {
                        addValues(objectsRequired, objects);
                    }
                    if (term.movement !== null) {
                        for (const objectName of objects) {
                            movementsMatched.add(`${objectName}:${term.movement}`);
                            if (term.ref && term.ref.type === 'object') {
                                movementsRequired.add(`${objectName}:${term.movement}`);
                            }
                        }
                    }
                } else if (term.kind === 'absent') {
                    addValues(objectAbsencesMatched, termObjects(term));
                }
            }
        }
    }
    return {
        objects_required: objectsRequired,
        objects_matched: objectsMatched,
        object_absences_matched: objectAbsencesMatched,
        movements_required: movementsRequired,
        movements_matched: movementsMatched,
    };
}

function ruleMovementWriteTags(psTagged, rule) {
    const movementsWritten = new Set();

    if (!rule.tags.writes_movement) return movementsWritten;

    const rowCount = Math.max(rule.lhs.length, rule.rhs.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const lhsRow = rule.lhs[rowIndex] || [];
        const rhsRow = rule.rhs[rowIndex] || [];
        const cellCount = maxCellsInRows(lhsRow, rhsRow);
        for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
            const lhsCell = lhsRow[cellIndex] || [];
            const rhsCell = rhsRow[cellIndex] || [];
            const lhsAbsent = absentObjectSet(lhsCell);
            const lhsMovementKeys = movementTermKeys(lhsCell, lhsAbsent);
            const rhsMovementKeys = movementTermKeys(rhsCell);
            const rhsPresent = presentObjectSet(rhsCell);
            const rhsRequiredPresent = requiredPresentObjectSet(rhsCell);

            for (const term of rhsCell) {
                if (term.kind !== 'present' || term.movement === null) continue;
                const writtenMovements = term.movement === 'randomdir' ? CARDINAL_MOVEMENTS : [term.movement];
                for (const objectName of termObjects(term)) {
                    if (!objectCanCoexistWithRequiredObjects(psTagged, rhsRequiredPresent, objectName)) continue;
                    for (const movement of writtenMovements) {
                        const key = `${objectName}:${movement}`;
                        if (!lhsMovementKeys.has(key)) {
                            movementsWritten.add(key);
                        }
                    }
                }
            }
            for (const key of lhsMovementKeys) {
                if (rhsMovementKeys.has(key)) continue;
                const objectName = movementKeyObjectName(key);
                if (rhsPresent.has(objectName) && !movementKeysContainObject(rhsMovementKeys, objectName)) {
                    movementsWritten.add(`${objectName}:stationary`);
                }
            }
        }
    }
    return movementsWritten;
}

function rhsMovementsForObject(rhsMovementKeys, objectName) {
    const movements = [];
    for (const key of rhsMovementKeys) {
        if (movementKeyObjectName(key) === objectName) {
            movements.push(key.slice(key.lastIndexOf(':') + 1));
        }
    }
    return movements;
}

function positiveStatesCoveredByRhsMovement(movement) {
    if (movement === 'randomdir') return [];
    if (CARDINAL_MOVEMENTS.includes(movement)) return [movement];
    if (movement === 'action') return ['action'];
    if (movement === 'stationary') return ['stationary'];
    return [];
}

function ruleMovementRemoveTags(rule) {
    const movementsRemoved = new Set();

    if (!rule.tags.writes_movement) return movementsRemoved;

    const rowCount = Math.max(rule.lhs.length, rule.rhs.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const lhsRow = rule.lhs[rowIndex] || [];
        const rhsRow = rule.rhs[rowIndex] || [];
        const cellCount = maxCellsInRows(lhsRow, rhsRow);
        for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
            const lhsCell = lhsRow[cellIndex] || [];
            const rhsCell = rhsRow[cellIndex] || [];
            const lhsAbsent = absentObjectSet(lhsCell);
            const lhsMovementKeys = movementTermKeys(lhsCell, lhsAbsent);
            const rhsMovementKeys = movementTermKeys(rhsCell);
            for (const key of lhsMovementKeys) {
                if (!rhsMovementKeys.has(key)) {
                    movementsRemoved.add(key);
                }
            }
            const lhsPresent = presentObjectSet(lhsCell, lhsAbsent);
            for (const objectName of lhsPresent) {
                if (movementKeysContainObject(lhsMovementKeys, objectName)) continue;
                const rhsMovements = rhsMovementsForObject(rhsMovementKeys, objectName);
                if (rhsMovements.length === 0) continue;
                const covered = new Set();
                for (const movement of rhsMovements) {
                    for (const state of positiveStatesCoveredByRhsMovement(movement)) {
                        covered.add(state);
                    }
                }
                for (const state of [...POSITIVE_MOVEMENT_STATES, 'stationary']) {
                    if (!covered.has(state)) {
                        movementsRemoved.add(`${objectName}:${state}`);
                    }
                }
            }
        }
    }
    return movementsRemoved;
}

function tagRuleObjectTags(psTagged) {
    for (const { rule } of allRuleEntries(psTagged)) {
        const reads = ruleFlowReadTags(rule);
        const writes = ruleFlowWrites(psTagged, rule);
        const movementsWritten = ruleMovementWriteTags(psTagged, rule);
        const movementsRemoved = ruleMovementRemoveTags(rule);
        rule.tags.objects_required = uniqueSorted(reads.objects_required);
        rule.tags.objects_matched = uniqueSorted(reads.objects_matched);
        rule.tags.object_absences_matched = uniqueSorted(reads.object_absences_matched);
        rule.tags.objects_written = uniqueSorted(writes.object_present);
        rule.tags.objects_erased = uniqueSorted(writes.object_absent);
        rule.tags.movements_required = uniqueSorted(reads.movements_required);
        rule.tags.movements_matched = uniqueSorted(reads.movements_matched);
        rule.tags.movements_written = uniqueSorted(movementsWritten);
        rule.tags.movements_removed = uniqueSorted(movementsRemoved);
    }
}

function objectMaskWordCount(psTagged) {
    const maxId = (psTagged.objects || []).reduce((maxValue, object) => {
        return Number.isInteger(object.id) ? Math.max(maxValue, object.id) : maxValue;
    }, -1);
    return Math.ceil(Math.max(1, maxId + 1) / 32) | 0;
}

function movementMaskWordCount(psTagged) {
    const maxLayer = (psTagged.collision_layers || []).reduce((maxValue, layer, index) => {
        const layerIndex = Number.isInteger(layer.id) ? layer.id : index;
        return Math.max(maxValue, layerIndex);
    }, -1);
    return Math.ceil(Math.max(1, maxLayer + 1) / 5) | 0;
}

function emptyWordMask(wordCount) {
    return Array(wordCount).fill(0);
}

function setWordMaskBit(words, bitIndex) {
    const wordIndex = bitIndex >> 5;
    const innerIndex = bitIndex & 31;
    if (wordIndex >= 0 && wordIndex < words.length) {
        words[wordIndex] = (words[wordIndex] | (1 << innerIndex)) | 0;
    }
}

function objectByName(psTagged, objectName) {
    return (psTagged.objects || []).find(object => object.name === objectName) || null;
}

function objectMaskForNames(psTagged, objectNames) {
    const words = emptyWordMask(objectMaskWordCount(psTagged));
    for (const objectName of objectNames || []) {
        const object = objectByName(psTagged, objectName);
        if (object && Number.isInteger(object.id)) {
            setWordMaskBit(words, object.id);
        }
    }
    return words;
}

function fullObjectMask(psTagged) {
    const words = emptyWordMask(objectMaskWordCount(psTagged));
    for (const object of psTagged.objects || []) {
        if (object && Number.isInteger(object.id)) {
            setWordMaskBit(words, object.id);
        }
    }
    return words;
}

function movementBitsForName(movementName) {
    if (Object.prototype.hasOwnProperty.call(MOVEMENT_BIT_MASKS, movementName)) {
        return MOVEMENT_BIT_MASKS[movementName];
    }
    if (Object.prototype.hasOwnProperty.call(MOVEMENT_AGGREGATE_BIT_MASKS, movementName)) {
        return MOVEMENT_AGGREGATE_BIT_MASKS[movementName];
    }
    if (movementName === 'stationary') {
        return 0x1f;
    }
    return 0x1f;
}

function orMovementLayerBits(words, layerIndex, bitMask) {
    for (let bit = 0; bit < 5; bit++) {
        if ((bitMask & (1 << bit)) !== 0) {
            setWordMaskBit(words, 5 * layerIndex + bit);
        }
    }
}

function movementMaskForEntries(psTagged, entries) {
    const words = emptyWordMask(movementMaskWordCount(psTagged));
    for (const entry of entries || []) {
        const objectName = typeof entry === 'string' ? movementKeyObjectName(entry) : entry.object;
        const movementName = typeof entry === 'string' ? movementKeyMovementName(entry) : entry.movement;
        const layer = layerForObject(psTagged, objectName);
        if (layer !== null) {
            orMovementLayerBits(words, layer, movementBitsForName(movementName));
        }
    }
    return words;
}

function fullMovementMask(psTagged) {
    const words = emptyWordMask(movementMaskWordCount(psTagged));
    for (const [index, layer] of (psTagged.collision_layers || []).entries()) {
        const layerIndex = Number.isInteger(layer.id) ? layer.id : index;
        orMovementLayerBits(words, layerIndex, 0x1f);
    }
    return words;
}

function movementMaskForObjectLayers(psTagged, objectNames) {
    const words = emptyWordMask(movementMaskWordCount(psTagged));
    for (const objectName of objectNames || []) {
        const layer = layerForObject(psTagged, objectName);
        if (layer !== null) {
            orMovementLayerBits(words, layer, 0x1f);
        }
    }
    return words;
}

function objectNamesForMovementLayers(psTagged, entries) {
    const names = new Set();
    for (const entry of entries || []) {
        const objectName = typeof entry === 'string' ? movementKeyObjectName(entry) : entry.object;
        for (const layerObject of layerObjectsForObject(psTagged, objectName)) {
            names.add(layerObject);
        }
    }
    return names;
}

function objectNamesWithLayerSiblings(psTagged, objectNames) {
    const names = new Set();
    for (const objectName of objectNames || []) {
        for (const layerObject of layerObjectsForObject(psTagged, objectName)) {
            names.add(layerObject);
        }
    }
    return names;
}

function rhsObjectNames(rule) {
    const names = new Set();
    for (const row of rule.rhs || []) {
        for (const cell of row || []) {
            for (const term of cell || []) {
                if (term.kind === 'present' || term.kind === 'absent' || term.kind === 'random_object') {
                    addValues(names, termObjects(term));
                }
            }
        }
    }
    return names;
}

function orWordMasks(left, right) {
    const result = left.slice();
    for (let index = 0; index < right.length; index++) {
        result[index] = ((result[index] || 0) | right[index]) | 0;
    }
    return result;
}

function movementEntryKey(entry) {
    return `${entry.object}:${entry.movement}`;
}

function splitReadMovements(reads) {
    const present = [];
    const absent = [];
    for (const movement of reads.movement || []) {
        if (movement.movement === 'stationary') {
            absent.push(movement);
        } else {
            present.push(movement);
        }
    }
    return { present, absent };
}

function certifiedWakeMaskForRule(psTagged, rule) {
    const reads = ruleFlowReads(rule);
    const writes = ruleFlowWrites(psTagged, rule);
    const readMovements = splitReadMovements(reads);
    const movementWrites = Array.from(ruleMovementWriteTags(psTagged, rule));
    const movementSet = movementWrites
        .filter(key => movementKeyMovementName(key) !== 'stationary');
    const movementClear = uniqueSorted(Array.from(ruleMovementRemoveTags(rule)).concat(
        movementWrites.filter(key => movementKeyMovementName(key) === 'stationary')
    ));
    const objectSet = uniqueSorted(writes.object_present);
    const objectClear = uniqueSorted(writes.object_absent);
    const movementWake = uniqueSorted((writes.movement || []).map(movementEntryKey));
    const rhsObjects = rhsObjectNames(rule);
    const objectWake = uniqueSorted(new Set([
        ...objectSet,
        ...objectClear,
        ...rhsObjects,
        ...objectNamesWithLayerSiblings(psTagged, rhsObjects),
        ...objectNamesForMovementLayers(psTagged, movementWake),
    ]));
    const movementSetMask = movementMaskForEntries(psTagged, movementSet);
    const movementClearMask = orWordMasks(
        movementMaskForEntries(psTagged, movementClear),
        movementMaskForObjectLayers(psTagged, objectWake)
    );
    const movementWakeMask = orWordMasks(
        movementMaskForEntries(psTagged, movementWake),
        movementClearMask
    );
    const runtimeObjectCoverMask = fullObjectMask(psTagged);
    const runtimeMovementCoverMask = fullMovementMask(psTagged);

    return {
        bitvec_format: {
            object_words: objectMaskWordCount(psTagged),
            movement_words: movementMaskWordCount(psTagged),
            movement_bits_per_layer: 5,
            movement_bit_names: ['up', 'down', 'left', 'right', 'action'],
        },
        reads: {
            object_present: uniqueSorted(reads.object_present),
            object_absent: uniqueSorted(reads.object_absent),
            movement: uniqueSorted((reads.movement || []).map(movementEntryKey)),
            movement_present: uniqueSorted(readMovements.present.map(movementEntryKey)),
            movement_absent: uniqueSorted(readMovements.absent.map(movementEntryKey)),
        },
        writes: {
            object_wake: objectWake,
            object_set: objectSet,
            object_clear: objectClear,
            movement_wake: movementWake,
            movement_set: uniqueSorted(movementSet),
            movement_clear: movementClear,
        },
        masks: {
            read_objects_present: objectMaskForNames(psTagged, reads.object_present),
            read_objects_absent: objectMaskForNames(psTagged, reads.object_absent),
            read_objects_wake: runtimeObjectCoverMask,
            read_movements_present: movementMaskForEntries(psTagged, readMovements.present),
            read_movements_absent: movementMaskForEntries(psTagged, readMovements.absent),
            read_movements_wake: movementMaskForEntries(psTagged, reads.movement || []),
            runtime_read_movements_wake: runtimeMovementCoverMask,
            write_objects_wake: objectMaskForNames(psTagged, objectWake),
            runtime_write_objects_wake: runtimeObjectCoverMask,
            write_objects_set: objectMaskForNames(psTagged, objectSet),
            write_objects_clear: objectMaskForNames(psTagged, objectClear),
            write_movements_wake: movementWakeMask,
            runtime_write_movements_wake: runtimeMovementCoverMask,
            write_movements_set: movementSetMask,
            write_movements_clear: movementClearMask,
        },
    };
}

function deriveCertifiedWakeMaskFacts(psTagged) {
    const results = [];
    for (const { rule } of allRuleEntries(psTagged)) {
        results.push(fact('certified_wake_masks', `${rule.id}_wake_masks`, 'proved', {
            subjects: { rules: [rule.id] },
            value: certifiedWakeMaskForRule(psTagged, rule),
            proof: ['rule_flow_reads_writes_with_polarity', 'engine_bitvec_masks_serialized'],
            evidence: [rule.id],
        }));
    }
    return results;
}

function movementWriteMayEnableRead(write, read) {
    if (write.object !== read.object) return false;
    if (write.movement === read.movement) return true;
    if (read.movement === 'moving' || read.movement === 'randomdir' || read.movement === 'orthogonal') {
        return CARDINAL_MOVEMENTS.includes(write.movement) || write.movement === 'moving' || write.movement === 'randomdir';
    }
    return false;
}

function ruleMayEnableRule(writes, reads) {
    const reasons = [];
    if (Array.from(writes.object_present).some(objectName => reads.object_present.has(objectName))) {
        reasons.push('object_presence');
    }
    if (Array.from(writes.object_absent).some(objectName => reads.object_absent.has(objectName))) {
        reasons.push('object_absence');
    }
    if (writes.movement.some(write => reads.movement.some(read => movementWriteMayEnableRead(write, read)))) {
        reasons.push('movement');
    }
    return reasons;
}

function movementWriteMayBlockRead(write, read) {
    return write.object === read.object && !movementWriteMayEnableRead(write, read);
}

function setIntersects(left, right) {
    return Array.from(left).some(value => right.has(value));
}

function ruleMayAffectRuleForWinRelevance(writes, reads) {
    const reasons = ruleMayEnableRule(writes, reads).slice();
    if (setIntersects(writes.object_present, reads.object_absent)) {
        reasons.push('object_presence_blocks_absence');
    }
    if (setIntersects(writes.object_absent, reads.object_present)) {
        reasons.push('object_absence_blocks_presence');
    }
    if (writes.movement.some(write => reads.movement.some(read => movementWriteMayBlockRead(write, read)))) {
        reasons.push('movement_blocks_read');
    }
    return uniqueSorted(reasons);
}

function wakeEdgesForRules(psTagged, rules) {
    const reads = new Map(rules.map(rule => [rule.id, ruleFlowReads(rule)]));
    const writes = new Map(rules.map(rule => [rule.id, ruleFlowWrites(psTagged, rule)]));
    const edges = [];
    for (const fromRule of rules) {
        const fromWrites = writes.get(fromRule.id);
        for (const toRule of rules) {
            const reasons = ruleMayEnableRule(fromWrites, reads.get(toRule.id));
            if (reasons.length === 0) continue;
            edges.push({ from: fromRule.id, to: toRule.id, reasons });
        }
    }
    return edges;
}

function relevanceEdgesForRules(psTagged, rules) {
    const reads = new Map(rules.map(rule => [rule.id, ruleFlowReads(rule)]));
    const writes = new Map(rules.map(rule => [rule.id, ruleFlowWrites(psTagged, rule)]));
    const edges = [];
    for (const fromRule of rules) {
        const fromWrites = writes.get(fromRule.id);
        for (const toRule of rules) {
            const reasons = ruleMayAffectRuleForWinRelevance(fromWrites, reads.get(toRule.id));
            if (reasons.length === 0) continue;
            edges.push({ from: fromRule.id, to: toRule.id, reasons });
        }
    }
    return edges;
}

function connectedComponents(ruleIds, edges) {
    const parent = new Map(ruleIds.map(id => [id, id]));
    function find(id) {
        const current = parent.get(id);
        if (current === id) return id;
        const root = find(current);
        parent.set(id, root);
        return root;
    }
    function union(left, right) {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    }
    for (const edge of edges) {
        union(edge.from, edge.to);
    }
    const components = new Map();
    for (const id of ruleIds) {
        const root = find(id);
        if (!components.has(root)) components.set(root, []);
        components.get(root).push(id);
    }
    return Array.from(components.values()).sort((left, right) =>
        ruleIds.indexOf(left[0]) - ruleIds.indexOf(right[0])
    );
}

function rulegroupSinglePassBlockers(group, interactionEdges, indexById) {
    const blockers = [];
    if (interactionEdges.some(edge => indexById.get(edge.to) <= indexById.get(edge.from))) {
        blockers.push('earlier_rule_may_be_enabled');
    }
    if (group.random) blockers.push('random_rule_group');
    if (group.rules.some(rule => rule.rigid)) blockers.push('rigid_rule');
    if (group.rules.some(rule => rule.summary.semantic_commands.length > 0)) blockers.push('semantic_command');
    if (group.rules.some(rule => rule.tags && rule.tags.force_always_run)) blockers.push('force_always_rule');
    return uniqueSorted(blockers);
}

function rulegroupSkipMaskBlockers(group) {
    const blockers = [];
    if (group.random) blockers.push('random_rule_group');
    if (group.rules.some(rule => rule.rigid)) blockers.push('rigid_rule');
    if (group.rules.some(rule => rule.summary.semantic_commands.length > 0)) blockers.push('semantic_command');
    if (group.rules.some(rule => rule.tags && rule.tags.force_always_run)) blockers.push('force_always_rule');
    return uniqueSorted(blockers);
}

function groupSkipMaskForRules(psTagged, group, blockers) {
    const objectPresent = new Set();
    const objectAbsent = new Set();
    const movement = [];
    for (const rule of group.rules || []) {
        const reads = ruleFlowReads(rule);
        addValues(objectPresent, reads.object_present || []);
        addValues(objectAbsent, reads.object_absent || []);
        movement.push(...(reads.movement || []));
    }
    const objectWake = uniqueSorted(new Set([...objectPresent, ...objectAbsent]));
    const readMovements = splitReadMovements({ movement });
    return {
        bitvec_format: {
            object_words: objectMaskWordCount(psTagged),
            movement_words: movementMaskWordCount(psTagged),
            movement_bits_per_layer: 5,
            movement_bit_names: ['up', 'down', 'left', 'right', 'action'],
        },
        skippable: blockers.length === 0,
        blockers,
        reads: {
            object_present: uniqueSorted(objectPresent),
            object_absent: uniqueSorted(objectAbsent),
            object_wake: objectWake,
            movement: uniqueSorted(movement.map(movementEntryKey)),
            movement_present: uniqueSorted(readMovements.present.map(movementEntryKey)),
            movement_absent: uniqueSorted(readMovements.absent.map(movementEntryKey)),
        },
        masks: {
            read_objects_wake: objectMaskForNames(psTagged, objectWake),
            read_movements_wake: movementMaskForEntries(psTagged, movement),
        },
    };
}

function deriveRulegroupFlowFacts(psTagged) {
    const results = [];
    for (const section of psTagged.rule_sections) {
        for (const group of section.groups) {
            if (group.rules.length <= 1) continue;
            const ruleIds = group.rules.map(rule => rule.id);
            const indexById = new Map(group.rules.map((rule, index) => [rule.id, index]));
            const interactionEdges = wakeEdgesForRules(psTagged, group.rules);
            const rerunMasks = Object.fromEntries(ruleIds.map(id => [id, []]));
            for (const edge of interactionEdges) {
                if (indexById.get(edge.to) <= indexById.get(edge.from)) {
                    rerunMasks[edge.from].push(edge.to);
                }
            }
            for (const ruleId of ruleIds) {
                rerunMasks[ruleId] = uniqueSorted(rerunMasks[ruleId]);
            }
            const components = connectedComponents(ruleIds, interactionEdges);
            const blockers = [];
            const singlePassBlockers = rulegroupSinglePassBlockers(group, interactionEdges, indexById);
            const groupSkipBlockers = rulegroupSkipMaskBlockers(group);
            if (components.length <= 1) blockers.push('single_component');
            if (group.random) blockers.push('random_rule_group');
            if (group.rules.some(rule => rule.rigid)) blockers.push('rigid_rule');
            if (group.rules.some(rule => rule.summary.semantic_commands.length > 0)) blockers.push('semantic_command');
            const status = blockers.length === 0 ? 'candidate' : 'rejected';
            results.push(fact('rulegroup_flow', `${group.id}_flow`, status, {
                subjects: { groups: [group.id] },
                value: {
                    rule_ids: ruleIds,
                    interaction_edges: interactionEdges,
                    rerun_masks: rerunMasks,
                    components,
                    split_candidate: status === 'candidate',
                    single_pass_safe: singlePassBlockers.length === 0,
                    single_pass_blockers: singlePassBlockers,
                    group_skip_mask: groupSkipMaskForRules(psTagged, group, groupSkipBlockers),
                },
                proof: status === 'candidate' ? ['multiple_independent_rule_components'] : [],
                blockers,
                evidence: ruleIds,
            }));
        }
    }
    return results;
}

function deriveWinflowFacts(psTagged) {
    const entries = allRuleEntries(psTagged);
    const rules = entries.map(entry => entry.rule);
    const ruleIds = rules.map(rule => rule.id);
    const wins = psTagged.winconditions;
    const winIds = wins.map(win => win.id);
    const wakeEdges = [];
    for (const rule of rules) {
        const writes = ruleFlowWrites(psTagged, rule);
        const lhsObjects = new Set(rule.tags.objects_matched);
        const movementObjects = new Set();
        for (const key of rule.tags.movements_written) {
            const obj = movementKeyObjectName(key);
            if (lhsObjects.has(obj)) movementObjects.add(obj);
        }
        for (const key of rule.tags.movements_removed) {
            const obj = movementKeyObjectName(key);
            if (lhsObjects.has(obj)) movementObjects.add(obj);
        }
        for (const win of wins) {
            const reasons = [];
            const winObjectsRead = new Set([...win.tags.objects_matched, ...win.tags.object_absences_matched]);
            for (const objectName of winObjectsRead) {
                if (writes.object_present.has(objectName)) { reasons.push('object_presence'); break; }
            }
            for (const objectName of winObjectsRead) {
                if (writes.object_absent.has(objectName)) { reasons.push('object_absence'); break; }
            }
            if (win.tags.targets_matched.length > 0) {
                for (const obj of movementObjects) {
                    if (winObjectsRead.has(obj)) { reasons.push('movement'); break; }
                }
            }
            if (reasons.length > 0) wakeEdges.push({ from: rule.id, to: win.id, reasons });
        }
    }
    return [fact('winflow', 'winflow', 'proved', {
        subjects: { rules: ruleIds, wins: winIds },
        value: {
            rule_ids: ruleIds,
            win_ids: winIds,
            wake_edges: wakeEdges,
        },
        proof: ['direct_wake_enablement'],
        evidence: ruleIds,
    })];
}

function deriveProgramFlowFacts(psTagged) {
    const entries = allRuleEntries(psTagged);
    const rules = entries.map(entry => entry.rule);
    const ruleIds = rules.map(rule => rule.id);
    const wakeEdges = wakeEdgesForRules(psTagged, rules);
    const againRules = rules.filter(rule => rule.tags.has_again).map(rule => rule.id);
    return [fact('program_flow', 'program_flow', 'proved', {
        subjects: { rules: ruleIds },
        value: {
            rule_ids: ruleIds,
            wake_edges: wakeEdges,
            again_rules: uniqueSorted(againRules),
            tick_restart_possible: againRules.length > 0,
        },
        proof: ['direct_wake_enablement', 'again_rules_listed'],
        evidence: ruleIds,
    })];
}

function semanticRootRuleIds(rules) {
    const ids = [];
    for (const rule of rules) {
        if ((rule.summary.semantic_commands || []).some(command => SEMANTIC_COMMANDS.has(command))) {
            ids.push(rule.id);
        }
    }
    return uniqueSorted(ids);
}

function backwardRelevantRuleIds(rootRuleIds, wakeEdges) {
    const relevant = new Set(rootRuleIds);
    let changed = true;
    while (changed) {
        changed = false;
        for (const edge of wakeEdges) {
            if (!relevant.has(edge.to) || relevant.has(edge.from)) continue;
            relevant.add(edge.from);
            changed = true;
        }
    }
    return uniqueSorted(relevant);
}

function deriveWinRelevanceFacts(psTagged) {
    const entries = allRuleEntries(psTagged);
    const rules = entries.map(entry => entry.rule);
    const ruleIds = rules.map(rule => rule.id);
    const programFlow = deriveProgramFlowFacts(psTagged)[0].value;
    const winflow = deriveWinflowFacts(psTagged)[0].value;
    const relevanceEdges = relevanceEdgesForRules(psTagged, rules);
    const directWinRoots = uniqueSorted((winflow.wake_edges || []).map(edge => edge.from));
    const semanticRoots = semanticRootRuleIds(rules);
    const rootRuleIds = uniqueSorted(directWinRoots.concat(semanticRoots));
    const relevantRuleIds = backwardRelevantRuleIds(rootRuleIds, relevanceEdges);
    const relevantSet = new Set(relevantRuleIds);
    const irrelevantRuleIds = uniqueSorted(rules
        .filter(rule => rule.tags.solver_state_active && !relevantSet.has(rule.id))
        .map(rule => rule.id));
    return [fact('win_relevance', 'win_relevance', 'proved', {
        subjects: { rules: ruleIds },
        value: {
            rule_ids: ruleIds,
            root_rule_ids: rootRuleIds,
            relevant_rule_ids: relevantRuleIds,
            irrelevant_rule_ids: irrelevantRuleIds,
            wake_edges: programFlow.wake_edges || [],
            win_wake_edges: winflow.wake_edges || [],
            relevance_edges: relevanceEdges,
            semantic_root_rule_ids: semanticRoots,
        },
        proof: ['backward_relevance_slice_from_winflow_semantic_roots_and_conservative_dependencies'],
        evidence: relevantRuleIds,
    })];
}

function factDerivers() {
    return {
        mergeability: deriveMergeabilityFacts,
        movement_action: deriveMovementActionFacts,
        per_level_object_universe: derivePerLevelObjectUniverseFacts,
        linear_count_invariants: deriveLinearCountInvariantFacts,
        mechanic_profile: deriveMechanicProfileFacts,
        count_layer_invariants: deriveCountLayerInvariantFacts,
        transient_boundary: deriveTransientBoundaryFacts,
        rulegroup_flow: deriveRulegroupFlowFacts,
        certified_wake_masks: deriveCertifiedWakeMaskFacts,
        program_flow: deriveProgramFlowFacts,
        winflow: deriveWinflowFacts,
        win_relevance: deriveWinRelevanceFacts,
    };
}

function deriveFacts(psTagged, familyFilter) {
    const derivers = factDerivers();
    if (familyFilter) {
        const familyNames = Array.isArray(familyFilter) ? familyFilter : [familyFilter];
        return Object.fromEntries(familyNames.map(family => [
            family,
            derivers[family] ? derivers[family](psTagged) : [],
        ]));
    }

    return Object.fromEntries(Object.entries(derivers).map(([family, derive]) => [
        family,
        derive(psTagged),
    ]));
}

function summarizeFacts(facts) {
    const summary = { proved: 0, candidate: 0, rejected: 0 };
    for (const familyFacts of Object.values(facts)) {
        for (const item of familyFacts) {
            if (Object.prototype.hasOwnProperty.call(summary, item.status)) {
                summary[item.status]++;
            }
        }
    }
    return summary;
}

function analyzeSource(source, options = {}) {
    const sourcePath = options.sourcePath || '<memory>';
    const sourceInfo = { path: sourcePath };
    if (options.includeSourceText === true) sourceInfo.text = source;
    let compiled;
    try {
        compiled = compileSemanticSource(source, {
            includeWinConditions: true,
            throwOnError: false,
        });
    } catch (error) {
        return {
            schema: SCHEMA,
            source: sourceInfo,
            status: 'compile_error',
            errors: [error && error.message ? error.message : String(error)],
            ps_tagged: null,
            facts: emptyFacts(),
            summary: { proved: 0, candidate: 0, rejected: 0 },
        };
    }

    if (compiled.errorCount > 0 || compiled.state === null || compiled.state.invalid) {
        return {
            schema: SCHEMA,
            source: sourceInfo,
            status: 'compile_error',
            errors: compiled.errorStrings.slice(),
            ps_tagged: null,
            facts: emptyFacts(),
            summary: { proved: 0, candidate: 0, rejected: 0 },
        };
    }

    // The semantic compile stops before rulesToMask, so it accepts some games
    // the real engine rejects (e.g. same-cell overlap writes). Run the
    // full-engine validation gate and refuse to analyze anything the engine
    // would reject at compile time. See STATIC_ANALYSIS_SOUNDNESS.md.
    let validation;
    try {
        validation = validateCompileSource(source, { includeWinConditions: true });
    } catch (error) {
        return {
            schema: SCHEMA,
            source: sourceInfo,
            status: 'compile_error',
            errors: [error && error.message ? error.message : String(error)],
            ps_tagged: null,
            facts: emptyFacts(),
            summary: { proved: 0, candidate: 0, rejected: 0 },
        };
    }
    if (!validation.ok) {
        return {
            schema: SCHEMA,
            source: sourceInfo,
            status: 'compile_error',
            errors: validation.errorStrings.slice(),
            ps_tagged: null,
            facts: emptyFacts(),
            summary: { proved: 0, candidate: 0, rejected: 0 },
        };
    }

    const psTagged = buildPsTagged(compiled.state, { sourcePath });
    const facts = deriveFacts(psTagged, options.familyFilter);
    const report = {
        schema: SCHEMA,
        source: sourceInfo,
        status: 'ok',
        ps_tagged: psTagged,
        facts,
        summary: summarizeFacts(facts),
    };

    if (options.includePsTagged === false) {
        delete report.ps_tagged;
    }
    return report;
}

function analyzeFile(filePath, options = {}) {
    const resolved = path.resolve(filePath);
    const source = fs.readFileSync(resolved, 'utf8');
    return analyzeSource(source, Object.assign({}, options, { sourcePath: filePath }));
}

function discoverInputFiles(inputs) {
    const files = [];
    for (const input of inputs) {
        const stat = fs.statSync(input);
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(input).sort()) {
                const fullPath = path.join(input, entry);
                if (fs.statSync(fullPath).isFile() && fullPath.endsWith('.txt')) {
                    files.push(fullPath);
                }
            }
        } else {
            files.push(input);
        }
    }
    return files;
}

function analyzePaths(inputs, options = {}) {
    return discoverInputFiles(inputs)
        .filter(filePath => !options.gameFilter || filePath.toLowerCase().includes(options.gameFilter.toLowerCase()))
        .map(filePath => analyzeFile(filePath, options));
}

module.exports = {
    SCHEMA,
    analyzeFile,
    analyzePaths,
    analyzeSource,
    discoverInputFiles,
};

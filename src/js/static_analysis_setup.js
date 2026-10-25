'use strict';

// Setup proofs intentionally use every rule's writes. Cosmetic projection and
// authored-level absence are solver conveniences, not permanence proofs.
function entriesOf(psTagged) {
    return psTagged.rule_sections.flatMap(section => section.groups.flatMap(group =>
        group.rules.map(rule => ({ rule, group }))
    ));
}

function sorted(values) {
    return Array.from(new Set(values)).sort();
}

function addIndex(index, object, id) {
    if (!index.has(object)) index.set(object, new Set());
    index.get(object).add(id);
}

function buildIndex(psTagged, entries) {
    const creators = new Map();
    const erasers = new Map();
    const writers = new Map();
    const layerByObject = new Map(psTagged.objects.map(object => [object.name, object.layer]));
    const movementWriters = new Map();
    const movingLayers = new Set(psTagged.objects
        .filter(object => psTagged.objects_originating_movement.has(object.name))
        .map(object => object.layer));
    const movementLayers = new Set(movingLayers);
    for (const { rule } of entries) {
        for (const name of rule.tags.objects_written) {
            addIndex(creators, name, rule.id);
            addIndex(writers, name, rule.id);
        }
        for (const name of rule.tags.objects_erased) {
            addIndex(erasers, name, rule.id);
            addIndex(writers, name, rule.id);
        }
        for (const key of rule.tags.movements_written) {
            const separator = key.lastIndexOf(':');
            if (key.slice(separator + 1) === 'stationary') continue;
            const layer = layerByObject.get(key.slice(0, separator));
            movementLayers.add(layer);
            addIndex(movementWriters, layer, rule.id);
        }
    }
    // Movement belongs to collision layers. Replacing Other with Mark on the
    // same layer can carry Other's movement into Mark even without an explicit
    // RHS movement write. Use a layer over-approximation, not object counts or
    // just explicit movement recipients.
    const movers = new Set(psTagged.objects.filter(object => movingLayers.has(object.layer)).map(object => object.name));
    return { creators, erasers, writers, movers, layerByObject, movementLayers, movementWriters };
}

function objectNames(cell, kind) {
    return new Set(cell.filter(term => term.kind === kind).map(term => term.ref.name));
}

function shapeBlockers(rule) {
    const blockers = [];
    if (rule.lhs.length !== 1 || rule.rhs.length !== 1
        || rule.lhs[0].length !== rule.rhs[0].length) blockers.push('unsupported_pattern_shape');
    const terms = rule.summary.lhs_terms.concat(rule.summary.rhs_terms);
    if (terms.some(term => term.ref.type !== 'object'
        || !['present', 'absent'].includes(term.kind))) blockers.push('non_concrete_or_variable_pattern');
    // The compiler supplies stationary on fresh, unguarded RHS objects. A
    // stationary assignment is idempotent; LHS movement gates and positive RHS
    // movement need a different proof.
    if (rule.summary.lhs_terms.some(term => term.movement !== null)
        || rule.summary.rhs_terms.some(term => term.movement !== null && term.movement !== 'stationary')) {
        blockers.push('movement_sensitive_rule');
    }
    return blockers;
}

function localProof(rule) {
    const blockers = shapeBlockers(rule);
    if (blockers.length > 0) return { blockers, effects: [], disablers: [], reads: [] };
    const effects = [];
    const disablers = [];
    const reads = [];
    for (let cell = 0; cell < rule.lhs[0].length; cell++) {
        const lhs = rule.lhs[0][cell];
        const rhs = rule.rhs[0][cell];
        const before = objectNames(lhs, 'present');
        const absentBefore = objectNames(lhs, 'absent');
        const after = objectNames(rhs, 'present');
        const absentAfter = objectNames(rhs, 'absent');
        const cellEffects = [];
        for (const object of before) {
            if (!after.has(object)) absentAfter.add(object);
        }
        for (const object of after) {
            if (!before.has(object)) cellEffects.push({ row: 0, cell, object, present: true });
        }
        for (const object of absentAfter) {
            if (!absentBefore.has(object)) cellEffects.push({ row: 0, cell, object, present: false });
        }
        effects.push(...cellEffects);
        for (const effect of cellEffects) {
            if (effect.present ? absentBefore.has(effect.object) : before.has(effect.object)) {
                disablers.push(effect);
            }
        }
        for (const term of lhs) {
            reads.push({ row: 0, cell, object: term.ref.name, present: term.kind === 'present' });
        }
    }
    return { blockers, effects, disablers, reads };
}

function permanence(effect, index) {
    const reversingRules = effect.present ? index.erasers : index.creators;
    return {
        ...effect,
        persistent: !index.movers.has(effect.object) && !(reversingRules.get(effect.object) || new Set()).size,
    };
}

function sameCellObject(left, right) {
    return left.row === right.row && left.cell === right.cell && left.object === right.object;
}

function eligibilityDependencies(reads, exemptGuards, index) {
    const dependencies = new Set();
    const blockers = [];
    for (const read of reads) {
        if (exemptGuards.some(guard => sameCellObject(read, guard))) continue;
        if (index.movers.has(read.object)) blockers.push(`eligibility_object_may_move:${read.object}`);
        for (const id of index.writers.get(read.object) || []) dependencies.add(id);
    }
    return { dependencies, blockers };
}

function retirementOptions(rule, local, guards, idempotent, index) {
    const options = [];
    const permanentDisablers = local.disablers.filter(disabler =>
        guards.some(guard => sameCellObject(guard, disabler) && guard.present === disabler.present && guard.persistent)
    );
    // Each of these reads can only go from true to false, so none can create a
    // later opportunity. Exempt all such reads, at their precise pattern cells.
    if (permanentDisablers.length > 0) options.push(eligibilityDependencies(local.reads, permanentDisablers, index));
    if (idempotent && guards.length > 0 && guards.every(guard => guard.persistent)) {
        const option = eligibilityDependencies(local.reads, [], index);
        option.evidence = new Set();
        // Even when every object write has saturated, stationary assignments
        // can keep clearing externally supplied action/cardinal movement. That
        // repeated transient effect may wake or suppress other rules.
        for (const term of rule.summary.rhs_terms) {
            if (term.movement !== 'stationary') continue;
            const layer = index.layerByObject.get(term.ref.name);
            if (!index.movementLayers.has(layer)) continue;
            option.blockers.push(`stationary_effect_may_be_rewritten:${term.ref.name}`);
            for (const id of index.movementWriters.get(layer) || []) option.evidence.add(id);
        }
        options.push(option);
    }
    return options;
}

function tagSetupRules(psTagged) {
    const entries = entriesOf(psTagged);
    const index = buildIndex(psTagged, entries);
    const rigidGroups = new Set(entries.filter(({ rule }) => rule.rigid).map(({ group }) => group.id));
    const analyses = entries.map(({ rule, group }) => {
        const local = localProof(rule);
        const guards = local.effects.map(effect => permanence(effect, index));
        const executionBlockers = [];
        if (rule.commands.length > 0) executionBlockers.push('rule_has_commands');
        if (group.random) executionBlockers.push('random_rule_group');
        if (rigidGroups.has(group.id)) executionBlockers.push('rigid_rule_group');
        // Concrete object replacements are assignments. Without new matches,
        // an exhaustive invocation leaves only already-assigned tuples (or
        // consumed tuples); another invocation cannot change the board.
        const idempotent = local.blockers.length === 0 && executionBlockers.length === 0
            && !rule.tags.may_enable_other_matches;
        rule.tags.self_disabling = local.disablers.length > 0;
        rule.tags.persistent_guard = guards.some(guard => guard.persistent);
        rule.tags.idempotent_effect = idempotent;
        rule.tags.setup_only = false;
        return {
            rule, local, guards, executionBlockers,
            options: retirementOptions(rule, local, guards, idempotent, index),
            chosen: null,
        };
    });

    // Least fixed point: only already-certified setup rules may change an
    // eligibility object. Cyclic dependencies remain unproved. No scheduling
    // claim is made: the dependency closure must actually reach quiescence.
    const proved = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const analysis of analyses) {
            if (proved.has(analysis.rule.id) || analysis.executionBlockers.length > 0) continue;
            const chosen = analysis.options.find(option => option.blockers.length === 0
                && Array.from(option.dependencies).every(id => proved.has(id)));
            if (!chosen) continue;
            analysis.chosen = chosen;
            analysis.rule.tags.setup_only = true;
            proved.add(analysis.rule.id);
            changed = true;
        }
    }

    for (const analysis of analyses) {
        const { rule, local, guards, executionBlockers, options, chosen } = analysis;
        const blockers = [...local.blockers, ...executionBlockers];
        if (!rule.tags.setup_only) {
            if (options.length === 0) blockers.push('no_persistent_retirement_condition');
            for (const option of options) {
                blockers.push(...option.blockers);
                if (Array.from(option.dependencies).some(id => !proved.has(id))) {
                    blockers.push('eligibility_changed_by_non_setup_rule');
                }
            }
        }
        const evidence = new Set();
        for (const guard of guards) {
            const reversers = guard.present ? index.erasers : index.creators;
            for (const id of reversers.get(guard.object) || []) evidence.add(id);
            if (index.movers.has(guard.object)) {
                for (const id of index.movementWriters.get(index.layerByObject.get(guard.object)) || []) evidence.add(id);
            }
        }
        for (const option of options) {
            for (const id of option.dependencies) evidence.add(id);
            for (const id of option.evidence || []) evidence.add(id);
        }
        rule.setup_analysis = {
            guards,
            setup_dependencies: chosen ? sorted(chosen.dependencies) : [],
            retirement: rule.tags.setup_only ? 'after_setup_quiescence' : null,
            scope: 'forward_play_between_state_restorations',
            blockers: rule.tags.setup_only ? [] : sorted(blockers),
            evidence: sorted(evidence),
        };
    }
}

function deriveRuleSetupFacts(psTagged) {
    return entriesOf(psTagged).map(({ rule }) => {
        const { blockers, evidence, ...value } = rule.setup_analysis;
        const tags = Object.fromEntries(['self_disabling', 'persistent_guard', 'idempotent_effect', 'setup_only']
            .map(name => [name, rule.tags[name]]));
        return {
            family: 'rule_setup', id: `${rule.id}_setup`,
            status: rule.tags.setup_only ? 'proved' : 'rejected',
            subjects: { rules: [rule.id] }, tags, value,
            proof: rule.tags.setup_only
                ? ['permanent_retirement_condition', 'eligibility_invariant_after_setup_dependencies', 'retirement_requires_committed_setup_quiescence']
                : [],
            blockers, evidence,
        };
    });
}

module.exports = { tagSetupRules, deriveRuleSetupFacts };

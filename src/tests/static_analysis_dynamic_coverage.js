'use strict';

// Explicit inventory, separate from pass/fail. Unknown names stay unchecked.
// "descriptive" means a compile-time classification, not an independently
// verified runtime invariant. "partial" records the narrower checker scope.
const registry = {};
function register(ids, status, checker, note = '', certifyingValue = true) {
    for (const id of ids.split(' ')) registry[id] = { status, checker, note, certifyingValue };
}
register('object.static', 'runtime', 'objectBoundaryChecks');
register('layer.static', 'runtime', 'staticLayerBoundaryChecks');
register('layer.inert', 'runtime', 'inertLayerBoundaryChecks');
register('object.quantity.never_increases object.quantity.never_decreases', 'runtime', 'quantityBoundaryChecks');
register('property.quantity.never_increases property.quantity.never_decreases', 'runtime', 'quantityBoundaryChecks');
register('object.quantity.exactly_zero object.quantity.exactly_one object.quantity.at_most_one property.quantity.exactly_zero property.quantity.exactly_one property.quantity.at_most_one', 'runtime', 'cardinalityBoundaryChecks');
register('object.temporary', 'runtime', 'temporaryBoundaryChecks');
register('level.unreachable_objects', 'runtime', 'perLevelObjectUniverseChecks');
register('level.reachable_objects', 'descriptive', null, 'Over-approximation; unreachable complement is checked.');
register('object.may_be_created object.may_be_destroyed', 'runtime', 'intra', 'Cell-local rule replacements before movement resolution.', false);
register('object.cosmetic', 'partial', 'cosmeticProjectionChecks', 'Forward, deterministic solver projection only.');
register('rule.cosmetic', 'partial', 'cosmeticRuleProjectionChecks', 'Forward, deterministic solver suppression only.');
register('rule.inert_command_only', 'partial', 'inertCommandRuleSuppressionChecks', 'Solver-state suppression, not UI/audio parity.');
register('game.has_again', 'runtime', 'noAgainBoundaryChecks', '', false);
register('game.has_random', 'partial', 'noRandomReplayChecks', 'Alternate-seed replay; explicit seeds currently excluded.', false);
register('game.has_autonomous_tick_rules', 'runtime', 'tickNoopBoundaryChecks', '', false);
register('rule.may_invalidate_other_matches rule.may_enable_other_matches', 'runtime', 'intra', 'Other tuples only; bounded tuple enumeration.', false);
register('rule.self_disabling rule.idempotent_effect', 'runtime', 'intra', 'Isolated replacement/invocation; bounded tuple enumeration.');
register('rule.persistent_guard rule.setup_only', 'partial', 'intra', 'Committed forward boundaries between restorations; rigid games excluded.');
register('group.split_candidate group.single_pass_safe group.group_skip_mask', 'runtime', 'intra', 'Actual group-entry states before movement resolution; bounded probes.');
register('object.present_in_all_levels object.present_in_some_levels object.present_in_no_levels', 'descriptive', null, 'Authored-level inventory.');
register('game.has_action_input game.run_rules_on_level_start game.can_win game.has_rigid game.has_action_rules', 'descriptive', null, 'Syntax/role classification; can_win is not a reachability proof.');
register('game.mechanic_profile.schemas game.mechanic_profile.rule_schema_counts game.mechanic_profile.blockers', 'descriptive', null, 'Heuristic schema classification.');
register('game.mechanic_profile.rule_schema_counts.*', 'descriptive', null, 'Counts by heuristic schema name.');
register('group.has_again group.object_mutating group.movement_only group.command_only group.solver_state_active', 'descriptive', null, 'Rollup of rule classifications.');
register('rule.command_only rule.object_mutating rule.writes_movement rule.movement_only rule.reads_action rule.has_again rule.force_always_run rule.solver_state_active rule.rigid_active', 'descriptive', null, 'Compiled rule classification.');
register('rule.objects_required rule.objects_matched rule.object_absences_matched rule.objects_written rule.objects_erased rule.movements_required rule.movements_matched rule.movements_written rule.movements_removed', 'partial', 'certifiedWakeMaskChecks', 'Lowered wake-mask coverage checks related resources, not each individual list.');
register('win.plain win.objects_matched win.subjects_matched win.targets_matched win.object_absences_matched', 'descriptive', null, 'Compiled win-condition reads.');
register('fact.count_layer_invariants', 'runtime', 'quantityBoundaryChecks', 'Also static object/layer boundary checks.');
register('fact.linear_count_invariants', 'runtime', 'linearCountInvariantChecks');
register('fact.transient_boundary', 'runtime', 'temporaryBoundaryChecks');
register('fact.per_level_object_universe', 'runtime', 'perLevelObjectUniverseChecks');
register('fact.certified_wake_masks', 'runtime', 'certifiedWakeMaskChecks', 'Lowered mask coverage, not an independent observed-write audit.');
register('fact.winflow', 'runtime', 'winflowCleanWinconditionChecks', 'Truth of cached clean winconditions after observed rule applications.');
register('fact.mergeability', 'partial', 'mergeProjectionChecks', 'Forward deterministic projection only.');
register('fact.movement_action', 'partial', 'actionUnnecessaryBoundaryChecks', 'Action-unnecessary probe, not every movement reachability fact.');
register('fact.solver_hash_projection', 'partial', 'cosmeticProjectionChecks', 'Cosmetic component only.');
register('fact.rulegroup_flow', 'partial', null, 'Split, single-pass and skip certificates checked separately; individual graph edges not checked.');
register('fact.rule_setup', 'partial', null, 'Four rule tags checked separately; dependency graph itself not independently checked.');
register('fact.mechanic_profile', 'descriptive', null, 'Heuristic classification.');
register('fact.program_flow fact.win_relevance', 'unchecked', null, 'No general independent playthrough oracle yet.');

function inventoryClaims(report) {
    const rows = new Map();
    function add(id, value, isFact = false) {
        const pattern = Object.keys(registry).find(key => key.endsWith('.*') && id.startsWith(key.slice(0, -1)));
        const spec = registry[id] || registry[pattern] || { status: 'unchecked', checker: null, note: 'Unregistered claim; coverage must be reviewed.', certifyingValue: true };
        if (!rows.has(id)) rows.set(id, { id, status: spec.status, checker: spec.checker,
            note: spec.note, emitted: 0, certificates: 0, checks: 0, failures: 0 });
        const row = rows.get(id);
        row.emitted++;
        if (isFact ? value === 'proved' : Array.isArray(value) ? value.length > 0 : value === spec.certifyingValue) row.certificates++;
    }
    function tags(scope, items) {
        function walk(prefix, value) {
            for (const [key, entry] of Object.entries(value || {})) {
                const id = `${prefix}.${key}`;
                if (entry && typeof entry === 'object' && !Array.isArray(entry)) walk(id, entry);
                else add(id, entry);
            }
        }
        for (const item of items || []) walk(scope, item.tags);
    }
    const tagged = report.ps_tagged || {};
    const sections = tagged.rule_sections || [], groups = sections.flatMap(section => section.groups || []);
    tags('game', tagged.game ? [tagged.game] : []);
    tags('object', tagged.objects); tags('property', tagged.properties);
    tags('layer', tagged.collision_layers); tags('level', tagged.levels);
    tags('section', sections); tags('group', groups);
    tags('rule', groups.flatMap(group => group.rules || [])); tags('win', tagged.winconditions);
    for (const [family, facts] of Object.entries(report.facts || {})) {
        for (const fact of facts) {
            add(`fact.${family}`, fact.status, true);
            if (family === 'rulegroup_flow' && fact.value) {
                add('group.split_candidate', fact.value.split_candidate);
                add('group.single_pass_safe', fact.value.single_pass_safe);
                add('group.group_skip_mask', fact.value.group_skip_mask && fact.value.group_skip_mask.skippable);
            }
        }
    }
    return [...rows.values()].sort((left, right) => left.id.localeCompare(right.id));
}
function addRuntimeCoverage(inventory, result) {
    for (const row of inventory) {
        if (row.checker === 'intra') row.checks += (result.intraTurn && result.intraTurn.checks[row.id]) || 0;
        else if (row.checker) row.checks += result[row.checker] || 0;
        row.failures += (result.intraTurn && result.intraTurn.failures && result.intraTurn.failures[row.id]) || 0;
        if ((result.failureClaims || []).includes(row.id)) row.failures++;
    }
    return inventory;
}
function runtimeFailureClaims(message) {
    const cardinality = message.match(/claim:\s*((?:object|property)\.quantity\.(?:exactly_zero|exactly_one|at_most_one))/);
    if (/cardinality claim violated/.test(message) && cardinality) return [cardinality[1]];
    const quantity = message.match(/claim:\s*(quantity\.(?:never_increases|never_decreases))/);
    if (/property quantity monotonicity claim violated/.test(message) && quantity) return [`property.${quantity[1]}`];
    if (/quantity monotonicity claim violated/.test(message) && quantity) {
        return ['fact.count_layer_invariants', `object.${quantity[1]}`];
    }
    const patterns = [
        [/static object occupancy changed/, ['object.static', 'fact.count_layer_invariants']],
        [/static layer occupancy changed/, ['layer.static', 'fact.count_layer_invariants']],
        [/inert layer occupancy changed/, ['layer.inert']],
        [/quantity monotonicity claim violated/, ['fact.count_layer_invariants']],
        [/linear count invariant violated/, ['fact.linear_count_invariants']],
        [/temporary object survived/, ['object.temporary', 'fact.transient_boundary']],
        [/never-appears object appeared/, ['object.may_be_created']],
        [/per-level unreachable object appeared/, ['level.unreachable_objects', 'fact.per_level_object_universe']],
        [/action-unnecessary claim violated/, ['fact.movement_action']],
        [/tick-noop claim violated/, ['game.has_autonomous_tick_rules']],
        [/no-again claim violated/, ['game.has_again']],
        [/no-random replay changed/, ['game.has_random']],
        [/winflow cache claim violated/, ['fact.winflow']],
        [/certified wake mask (under-covers|word layout mismatch)/, ['fact.certified_wake_masks']],
        [/inert command rule suppression replay diverged/, ['rule.inert_command_only']],
        [/merge-optimized replay diverged/, ['fact.mergeability']],
        [/cosmetic projection replay diverged/, ['object.cosmetic']],
        [/cosmetic rule suppression replay diverged|cosmetic-rule-optimized replay diverged/, ['rule.cosmetic']],
    ];
    return patterns.find(([pattern]) => pattern.test(message))?.[1] || [];
}
module.exports = { inventoryClaims, addRuntimeCoverage, runtimeFailureClaims };

'use strict';

// Test-only, deliberately slow reference execution. Never use tryApply's match
// recheck elision, group wake pruning, input specialization or rescan shortcut.
// Replacement/match code is shared with the real engine; scheduling is not.
function cloneData(value) {
    if (ArrayBuffer.isView(value)) return new value.constructor(value);
    if (Array.isArray(value)) return value.map(cloneData);
    if (value && typeof value.clone === 'function' && value.data) return value.clone();
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneData(item)]));
    }
    return value;
}
function cloneRng(generator) {
    if (!generator) return generator;
    const copy = Object.assign(Object.create(Object.getPrototypeOf(generator)), generator);
    if (generator._state) {
        copy._state = Object.assign(Object.create(Object.getPrototypeOf(generator._state)), generator._state);
        copy._state.s = generator._state.s.slice();
    }
    return copy;
}
const tupleKey = tuple => JSON.stringify(tuple);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function createIntraTurnOracle(report, options = {}) {
    const maxTuples = options.maxTuples ?? 128;
    const maxProbes = options.maxProbes ?? 2000;
    const counts = { checks: {}, failures: {}, skipped: {}, probes: 0, resets: 0, mappedRules: 0, unmappedRules: 0 };
    let suspended = 0;
    let mappings = new Map();
    let groups = new Map();
    let pendingGuards = [];
    let committedGuards = new Map();
    let retired = new Set();
    let retirementChanges = new Set();
    let cleanGroups = new Map();
    const originalMethods = new Map();
    const references = new WeakMap();
    let noCreate = [], noDestroy = [];
    const count = key => { counts.checks[key] = (counts.checks[key] || 0) + 1; };
    const skip = key => { counts.skipped[key] = (counts.skipped[key] || 0) + 1; };
    function fail(certificate, subject, detail) {
        counts.failures[certificate] = (counts.failures[certificate] || 0) + 1;
        const error = new Error(`Static certificate violated: ${certificate} (${subject}): ${detail}`);
        error.certificate = certificate;
        error.subject = subject;
        error.intraTurn = JSON.parse(JSON.stringify(counts));
        throw error;
    }
    function budget() {
        if (counts.probes >= maxProbes) { skip('probe_budget'); return false; }
        counts.probes++;
        return true;
    }
    function reset() {
        pendingGuards = [];
        committedGuards.clear();
        retired.clear();
        retirementChanges.clear();
        cleanGroups.clear();
        counts.resets++;
    }
    function runtimeSnapshot() {
        return {
            objects: Array.from(level.objects), movements: Array.from(level.movements),
            rigid: (level.rigidMovementAppliedMask || []).map(mask => Array.from(mask.data)),
            rigidGroups: (level.rigidGroupIndexMask || []).map(mask => Array.from(mask.data)),
            commands: (level.commandQueue || []).slice(),
            commandSources: (level.commandQueueSourceRules || []).map(rule => rule.lineNumber),
            message: messagetext,
            rng: RandomGen && RandomGen._state ? {
                s: RandomGen._state.s.slice(), i: RandomGen._state.i, j: RandomGen._state.j,
                normal: RandomGen._normal,
            } : null,
            created: sfxCreateMask ? Array.from(sfxCreateMask.data) : [],
            destroyed: sfxDestroyMask ? Array.from(sfxDestroyMask.data) : [],
            modified: turnObjectsModified,
        };
    }
    function shadow(fn) {
        const actualLevel = level;
        const probeLevel = Object.assign(Object.create(Object.getPrototypeOf(level)), level);
        for (const key of Object.keys(level)) {
            // Preserve Rule identities in command sources, clone all mutable
            // board arrays/masks, and leave immutable scalar/function fields.
            probeLevel[key] = key === 'commandQueueSourceRules' ? level[key].slice() : cloneData(level[key]);
        }
        const actualRng = RandomGen;
        const actualCreate = sfxCreateMask, actualDestroy = sfxDestroyMask;
        const actualMessage = messagetext, actualModified = turnObjectsModified;
        const captures = Array.from(mappings.keys(), rule => [rule, cloneData(rule.propertyCaptures), cloneData(rule.aggregateCaptures)]);
        level = probeLevel;
        RandomGen = cloneRng(RandomGen);
        if (sfxCreateMask) sfxCreateMask = sfxCreateMask.clone();
        if (sfxDestroyMask) sfxDestroyMask = sfxDestroyMask.clone();
        suspended++;
        try { return fn(); }
        finally {
            suspended--;
            level = actualLevel;
            RandomGen = actualRng;
            sfxCreateMask = actualCreate;
            sfxDestroyMask = actualDestroy;
            messagetext = actualMessage;
            turnObjectsModified = actualModified;
            for (const [rule, property, aggregate] of captures) {
                rule.propertyCaptures = property;
                rule.aggregateCaptures = aggregate;
            }
        }
    }
    function tuplesFor(rule) {
        state.calculateRowColMasks(level);
        const rows = rule.findMatches(level);
        if (rows.length === 0) return [];
        let size = 1;
        for (const row of rows) {
            size *= row.length;
            if (size > maxTuples) { skip('tuple_budget'); return null; }
        }
        return generateTuples(rows);
    }
    function referenceApplyAt(rule) {
        if (!references.has(rule)) references.set(rule, rule.generateApplyAt(
            rule.patterns, rule.ellipsisCount, STRIDE_OBJ, STRIDE_MOV, false));
        return references.get(rule);
    }
    function watchCellEffects(rule, staticRule, fn) {
        const originals = new Map();
        for (const cell of rule.patterns.flat()) {
            if (!cell || typeof cell.replace !== 'function' || originals.has(cell)) continue;
            const original = cell.replace;
            originals.set(cell, original);
            cell.replace = function (board, currentRule, index) {
                const offset = index * STRIDE_OBJ;
                const before = board.objects.slice(offset, offset + STRIDE_OBJ);
                const changed = original.call(this, board, currentRule, index);
                for (const [key, mask, additions] of [
                    ['object.may_be_created', noCreate, true], ['object.may_be_destroyed', noDestroy, false],
                ]) {
                    if (!mask.some(word => word !== 0)) continue;
                    count(key);
                    for (let word = 0; word < STRIDE_OBJ; word++) {
                        const after = board.objects[offset + word];
                        const changedBits = additions ? after & ~before[word] : before[word] & ~after;
                        if (changedBits & mask[word]) fail(key, staticRule.id, `uncertified cell-local ${additions ? 'creation' : 'destruction'} at cell ${index}`);
                    }
                }
                return changed;
            };
        }
        try { return fn(); }
        finally { for (const [cell, original] of originals) cell.replace = original; }
    }
    function replacement(rule, tuple, inspect) {
        const delta = (((rule.direction >> 3) & 1) - ((rule.direction >> 2) & 1)) * level.height
            + ((rule.direction >> 1) & 1) - (rule.direction & 1);
        const apply = () => referenceApplyAt(rule).call(rule, level, tuple, true, delta);
        return inspect ? watchCellEffects(rule, inspect, apply) : apply();
    }
    function guardInstances(rule, staticRule, tuple) {
        const guards = (staticRule.setup_analysis && staticRule.setup_analysis.guards) || [];
        if (!staticRule.tags.persistent_guard) return [];
        const delta = (((rule.direction >> 3) & 1) - ((rule.direction >> 2) & 1)) * level.height
            + ((rule.direction >> 1) & 1) - (rule.direction & 1);
        return guards.filter(guard => guard.persistent).map(guard => ({
            ...guard, cellIndex: tuple[guard.row] + guard.cell * delta, ruleId: staticRule.id,
            objectId: state.objects[guard.object.toLowerCase()].id,
        }));
    }
    function referenceRule(rule, inspect = null) {
        const tuples = tuplesFor(rule);
        if (tuples === null) return { skipped: true, changed: false, guards: [] };
        let changed = false;
        const guards = [];
        for (const tuple of tuples) {
            const beforeTuples = inspect ? tuplesFor(rule) : null;
            if (inspect && beforeTuples === null) return { skipped: true, changed, guards };
            if (inspect && !beforeTuples.some(candidate => tupleKey(candidate) === tupleKey(tuple))) continue;
            if (inspect) guards.push(...guardInstances(rule, inspect, tuple));
            const modified = rule.hasReplacements ? replacement(rule, tuple, inspect) : false;
            changed = modified || changed;
            if (inspect && rule.hasReplacements) {
                const afterTuples = tuplesFor(rule);
                if (afterTuples === null) return { skipped: true, changed, guards };
                const before = new Set(beforeTuples.map(tupleKey)), after = new Set(afterTuples.map(tupleKey));
                const own = tupleKey(tuple);
                for (const [tag, valid] of [
                    ['may_invalidate_other_matches', () => [...before].every(key => key === own || after.has(key))],
                    ['may_enable_other_matches', () => [...after].every(key => key === own || before.has(key))],
                ]) {
                    if (inspect.tags[tag] !== false) continue;
                    count(`rule.${tag}`);
                    if (!valid()) fail(`rule.${tag}`, inspect.id, `other tuples changed after ${own}`);
                }
                if (inspect.tags.self_disabling) {
                    count('rule.self_disabling');
                    if (after.has(own)) fail('rule.self_disabling', inspect.id, `tuple ${own} still matches`);
                }
            }
        }
        if (tuples.length) rule.queueCommands();
        return { changed, skipped: false, guards };
    }
    function referenceGroup(group, onePass = false) {
        let changed = false;
        for (let pass = 0; pass < 200; pass++) {
            let thisPass = false;
            for (const rule of group) {
                const result = referenceRule(rule);
                if (result.skipped) return { skipped: true };
                thisPass = result.changed || thisPass;
            }
            changed = thisPass || changed;
            if (!thisPass) return { changed, converged: true, skipped: false };
            if (onePass) return { changed, converged: false, skipped: false };
        }
        return { changed, converged: false, skipped: false };
    }
    function probeRule(rule, staticRule) {
        return shadow(() => {
            const result = referenceRule(rule, staticRule);
            if (result.skipped) return result;
            result.snapshot = runtimeSnapshot();
            if (staticRule.tags.idempotent_effect) {
                const next = referenceRule(rule);
                if (!next.skipped) {
                    count('rule.idempotent_effect');
                    if (next.changed) fail('rule.idempotent_effect', staticRule.id, 'second invocation still changes objects or movements');
                }
            }
            return result;
        });
    }
    function changedUnderMask(previous, words, stride, current) {
        for (let i = 0; i < current.length; i++) {
            if (((previous[i] ^ current[i]) & (words[i % stride] || 0)) !== 0) return true;
        }
        return false;
    }
    function checkGroup(group, entry) {
        const flow = entry.flow;
        if (!flow || group[0].isRandom
            || !(flow.single_pass_safe || flow.split_candidate || flow.group_skip_mask.skippable) || !budget()) return;
        const subject = entry.id;
        if (flow.single_pass_safe) shadow(() => {
            if (referenceGroup(group, true).skipped) return;
            const second = referenceGroup(group, true);
            if (second.skipped) return;
            count('group.single_pass_safe');
            if (second.changed) fail('group.single_pass_safe', subject, 'a second pass changes state before movement resolution');
        });
        if (flow.split_candidate) {
            const baseline = shadow(() => ({ result: referenceGroup(group), state: runtimeSnapshot() }));
            const split = shadow(() => {
                let converged = true, skipped = false;
                for (const component of flow.components) {
                    const subset = group.filter(rule => component.includes(mappings.get(rule).id));
                    const result = referenceGroup(subset);
                    converged = result.converged && converged;
                    skipped = result.skipped || skipped;
                }
                return { result: { converged, skipped }, state: runtimeSnapshot() };
            });
            if (!baseline.result.skipped && !split.result.skipped) {
                count('group.split_candidate');
                if (baseline.result.converged !== split.result.converged || !same(baseline.state, split.state)) {
                    fail('group.split_candidate', subject, 'split components change state, side effects or convergence');
                }
            }
        }
        const previous = cleanGroups.get(group), mask = flow.group_skip_mask;
        if (previous && mask && mask.skippable
            && !changedUnderMask(previous.objects, mask.masks.read_objects_wake, STRIDE_OBJ, level.objects)
            && !changedUnderMask(previous.movements, mask.masks.read_movements_wake, STRIDE_MOV, level.movements)) {
            const result = shadow(() => referenceGroup(group));
            if (!result.skipped) {
                count('group.group_skip_mask');
                if (result.changed) fail('group.group_skip_mask', subject, 'a previously clean group changes state without a masked resource change');
            }
        }
    }
    function boundary() {
        if (suspended || !level || !level.objects) return;
        if (textMode || titleScreen) { reset(); return; }
        if (state.rigid) { skip('rigid_lifetime_scope'); pendingGuards = []; retirementChanges.clear(); return; }
        for (const guard of committedGuards.values()) {
            count('rule.persistent_guard');
            if (Boolean(level.getCell(guard.cellIndex).get(guard.objectId)) !== guard.present) {
                fail('rule.persistent_guard', guard.ruleId, `${guard.object} reversed at cell ${guard.cellIndex}`);
            }
        }
        // Restorations discard pending speculative effects. Without a rollback,
        // even a guard reversed in its first committed turn violates permanence.
        for (const guard of pendingGuards) {
            count('rule.persistent_guard');
            if (Boolean(level.getCell(guard.cellIndex).get(guard.objectId)) === guard.present) {
                committedGuards.set(`${guard.cellIndex}:${guard.objectId}:${guard.present}`, guard);
            } else fail('rule.persistent_guard', guard.ruleId, `${guard.object} reversed before its first committed boundary`);
        }
        pendingGuards = [];
        for (const id of retirementChanges) fail('rule.setup_only', id, 'a retired rule changed state during a later committed turn');
        retirementChanges.clear();
        let progress = true;
        while (progress) {
            progress = false;
            for (const [rule, staticRule] of mappings) {
                if (!staticRule.tags.setup_only || retired.has(staticRule.id)) continue;
                if (!(staticRule.setup_analysis.setup_dependencies || []).every(id => retired.has(id)) || !budget()) continue;
                const result = shadow(() => referenceRule(rule));
                if (!result.skipped && !result.changed) { retired.add(staticRule.id); progress = true; count('rule.setup_only.quiescence'); }
            }
        }
    }
    function attach(runtimeState) {
        reset();
        mappings = new Map(); groups = new Map();
        noCreate = Array(runtimeState.STRIDE_OBJ).fill(0); noDestroy = noCreate.slice();
        for (const object of report.ps_tagged.objects) {
            const actual = runtimeState.objects[object.canonical_name];
            if (!actual) { skip('unmapped_object'); continue; }
            if (object.tags.may_be_created === false) noCreate[actual.id >> 5] |= 1 << (actual.id & 31);
            if (object.tags.may_be_destroyed === false) noDestroy[actual.id >> 5] |= 1 << (actual.id & 31);
        }
        const flowByGroup = new Map((report.facts.rulegroup_flow || []).map(fact => [fact.subjects.groups[0], fact.value]));
        for (const phase of ['early', 'late']) {
            const actual = phase === 'early' ? runtimeState.rules : runtimeState.lateRules;
            const tagged = report.ps_tagged.rule_sections.filter(section => section.name === phase).flatMap(section => section.groups);
            for (const group of actual) {
                const staticGroup = tagged.find(candidate => candidate.group_number === group[0].groupNumber);
                const complete = staticGroup && group.length === staticGroup.rules.length
                    && group.every((rule, j) => rule.lineNumber === staticGroup.rules[j].source_line
                        && dirMaskName[rule.direction] === staticGroup.rules[j].direction);
                if (!complete) { counts.unmappedRules += group.length; skip(`unmapped_${phase}_groups`); continue; }
                groups.set(group, { id: staticGroup.id, flow: flowByGroup.get(staticGroup.id) });
                for (let j = 0; j < group.length; j++) {
                    const rule = group[j], staticRule = staticGroup.rules[j];
                    mappings.set(rule, staticRule);
                    counts.mappedRules++;
                    const original = rule.tryApply;
                    rule.tryApply = function (currentLevel) {
                        if (suspended) return original.call(this, currentLevel);
                        if (!this.hasReplacements) { skip('no_replacement'); return original.call(this, currentLevel); }
                        if (this.findMatches(currentLevel).length === 0) { skip('no_matches'); return original.call(this, currentLevel); }
                        if (!budget()) return original.call(this, currentLevel);
                        const result = probeRule(this, staticRule);
                        const changed = original.call(this, currentLevel);
                        if (!result.skipped) {
                            count('runtime.rule_reference_parity');
                            if (changed !== result.changed || !same(runtimeSnapshot(), result.snapshot)) {
                                fail('runtime.rule_reference_parity', staticRule.id, 'optimized invocation differs from rechecked reference execution');
                            }
                            pendingGuards.push(...result.guards);
                            if (retired.has(staticRule.id)) {
                                count('rule.setup_only');
                                if (result.changed) retirementChanges.add(staticRule.id);
                            }
                        }
                        return changed;
                    };
                    originalMethods.set(rule, original);
                }
            }
        }
    }
    function install() {
        const originalSet = global.setGameState, originalGroup = global.applyRuleGroup, originalRestore = global.restoreLevel;
        const originalLoad = global.loadLevelFromState;
        const originalInput = global.processInput;
        global.setGameState = function (compiled, ...args) {
            if (compiled && compiled.rules) attach(compiled);
            return originalSet.call(this, compiled, ...args);
        };
        global.restoreLevel = function (...args) { if (!suspended) reset(); return originalRestore.apply(this, args); };
        if (originalLoad) global.loadLevelFromState = function (...args) {
            if (!suspended) reset();
            return originalLoad.apply(this, args);
        };
        global.processInput = function (...args) {
            // dontModify is the third argument. AGAIN probes are speculative;
            // processInput(-1, true) at startup is a real committed setup turn.
            if (suspended || args[2]) return suspend(() => originalInput.apply(this, args));
            const changed = originalInput.apply(this, args);
            boundary();
            return changed;
        };
        global.applyRuleGroup = function (group) {
            if (suspended || !groups.has(group)) return originalGroup.call(this, group);
            if (group[0].isRandom) skip('random_group_direct_application');
            const entry = groups.get(group);
            checkGroup(group, entry);
            const changed = originalGroup.call(this, group);
            if (entry.flow && entry.flow.group_skip_mask.skippable && !group[0].isRandom && budget()) {
                const result = shadow(() => referenceGroup(group, true));
                if (!result.skipped && !result.changed) cleanGroups.set(group, {
                    objects: new Int32Array(level.objects), movements: new Int32Array(level.movements),
                });
                else cleanGroups.delete(group);
            }
            return changed;
        };
        return () => {
            global.setGameState = originalSet;
            global.applyRuleGroup = originalGroup;
            global.restoreLevel = originalRestore;
            if (originalLoad) global.loadLevelFromState = originalLoad;
            global.processInput = originalInput;
            for (const [rule, original] of originalMethods) rule.tryApply = original;
        };
    }
    function suspend(fn) { suspended++; try { return fn(); } finally { suspended--; } }
    return { install, attach, boundary, reset, referenceRule, runtimeSnapshot, shadow, suspend,
        stats: () => JSON.parse(JSON.stringify(counts)) };
}

module.exports = { createIntraTurnOracle };

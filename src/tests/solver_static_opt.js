'use strict';

/**
 * Solver-only static optimizations for compiled PuzzleScript state.
 *
 * Five independent passes, all opt-in via createSolverOptimizationHook(report, passes):
 *
 *   inert    — drop rules whose only effect is firing a sound or showing a
 *              message (sfx0..sfx10, message). These can't change game state,
 *              so the solver doesn't need to evaluate them.
 *   cosmetic — delete objects flagged "cosmetic" by the static analyzer that
 *              don't appear in any rule, wincondition, or sound row.
 *   cosmeticRules — drop rules whose mutations are wholly cosmetic and whose
 *              removal has no projected solver-visible effect.
 *   merge    — fold mergeability-candidate object pairs into a single canonical
 *              name (alphabetically first). Identical objects are equivalent
 *              for the solver.
 *   action   — insert noaction metadata when static analysis proves ACTION
 *              input is unnecessary for the solver/generator. Game-facing
 *              callers can request stricter insertion that avoids changing
 *              action inputs with direction-covered in-game effects.
 *
 * Hook timing: pluginOptimizationHook fires from compiler.js loadFile() after
 * rule compilation but before generateSoundData / processWinConditions. Cosmetic
 * and merge passes mutate object identity (delete or rename), which invalidates
 * the compiled level bitmasks and object IDs — so each runs a structural rebuild
 * (rebuildAfterStructuralEdit) that re-runs generateExtraMembers and remaps
 * each level's bitmask buffer to the new IDs.
 *
 * Globals consumed (provided by combined_sources.js / compiler.js):
 *   STRIDE_OBJ, BitVec, generateExtraMembers, generateMasks,
 *   cacheAllRuleNames, removeDuplicateRules, commandwords_sfx
 */

// ---------- Constants ----------

const SFX_COMMAND_NAMES = (typeof commandwords_sfx !== 'undefined' && Array.isArray(commandwords_sfx))
    ? new Set(commandwords_sfx)
    : new Set(['sfx0', 'sfx1', 'sfx2', 'sfx3', 'sfx4', 'sfx5', 'sfx6', 'sfx7', 'sfx8', 'sfx9', 'sfx10']);
const INERT_COMMAND_NAMES = new Set([...SFX_COMMAND_NAMES, 'message']);

const TELEMETRY_KEYS = [
    'removed_inert_rules',
    'removed_cosmetic_objects',
    'removed_collision_layers',
    'removed_cosmetic_rules',
    'merged_object_aliases',
    'merged_object_groups',
    'inserted_noaction_metadata',
    'ms_inert',
    'ms_cosmetic',
    'ms_cosmetic_rules',
    'ms_merge',
    'ms_action',
];

function defaultTelemetry() {
    const t = {};
    for (const k of TELEMETRY_KEYS) t[k] = 0;
    return t;
}

const nowFn = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now()
    : () => Date.now();

// ---------- Rule-cell walking ----------
// Rule cells are flat arrays of [direction, name, direction, name, ...].
// '...' and 'random' are wildcards, not object names.

function isObjectNameTok(name) {
    return typeof name === 'string' && name !== '' && name !== '...' && name !== 'random';
}

function forEachRuleCellName(rule, fn) {
    if (!rule) return;
    for (const side of ['lhs', 'rhs']) {
        const rows = rule[side];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
            for (const cell of row) {
                if (!Array.isArray(cell)) continue;
                for (let i = 1; i < cell.length; i += 2) {
                    if (isObjectNameTok(cell[i])) fn(cell, i);
                }
            }
        }
    }
}

function collectNamesFromRules(rules, out) {
    if (!Array.isArray(rules)) return;
    for (const rule of rules) {
        forEachRuleCellName(rule, (cell, i) => out.add(cell[i]));
    }
}

// ---------- Reference collection ----------

function collectWinconditionLegendRefs(state) {
    // Wincondition rows look like: [verb, subject, ...optional 'on' object, lineNumber].
    // The trailing element is always a line number, not a name.
    const out = new Set();
    for (const wc of state.winconditions || []) {
        for (let i = 0; i < wc.length - 1; i++) {
            const tok = wc[i];
            if (typeof tok !== 'string') continue;
            if (tok in (state.objects || {})) { out.add(tok); continue; }
            if (state.aggregatesDict && Object.prototype.hasOwnProperty.call(state.aggregatesDict, tok)) {
                out.add(tok); continue;
            }
            if (state.propertiesDict && Object.prototype.hasOwnProperty.call(state.propertiesDict, tok)) {
                out.add(tok);
            }
        }
    }
    return out;
}

function collectSoundTargetNames(state) {
    const out = new Set();
    for (const sound of state.sounds || []) {
        if (Array.isArray(sound) && Array.isArray(sound[0]) && typeof sound[0][0] === 'string') {
            out.add(sound[0][0]);
        }
    }
    return out;
}

/** Object names that appear on any compiled non-message level map (bitset cells). */
function collectObjectNamesFromCompiledLevels(state) {
    const out = new Set();
    if (!state || !Array.isArray(state.levels)) return out;
    const strideObj = typeof STRIDE_OBJ !== 'undefined' ? STRIDE_OBJ : state.STRIDE_OBJ;
    const objectCount = state.objectCount | 0;
    const idDict = state.idDict;
    if (!strideObj || objectCount <= 0 || !idDict) return out;
    for (const level of state.levels) {
        if (!level || level.message !== undefined || !level.objects) continue;
        const buf = level.objects;
        const nTiles = level.n_tiles | 0;
        for (let t = 0; t < nTiles; t++) {
            const base = t * strideObj;
            for (let w = 0; w < strideObj; w++) {
                let word = buf[base + w] | 0;
                if (word === 0) continue;
                while (word !== 0) {
                    const bitIdx = 31 - Math.clz32(word & -word);
                    const oid = (w << 5) + bitIdx;
                    word &= word - 1;
                    if (oid >= objectCount) break;
                    const name = idDict[oid];
                    if (name) out.add(name);
                }
            }
        }
    }
    return out;
}

function expandLegendRefsToConcreteObjectNames(state, rawNames) {
    const out = new Set();
    const visiting = new Set();
    const objects = state.objects || {};
    const aggDict = state.aggregatesDict || {};
    const propDict = state.propertiesDict || {};
    function walk(name) {
        if (typeof name !== 'string' || visiting.has(name)) return;
        if (Object.prototype.hasOwnProperty.call(objects, name)) {
            out.add(name);
            return;
        }
        visiting.add(name);
        const expansion = aggDict[name] || propDict[name];
        if (Array.isArray(expansion)) for (const child of expansion) walk(child);
        visiting.delete(name);
    }
    for (const n of rawNames) walk(n);
    return out;
}

// ---------- Rename-map application ----------
// rename: Map<oldName, newName | null>
//   string newName → rewrite all references to newName, delete state.objects[old]
//   null           → drop references entirely (caller must guarantee object isn't
//                    referenced from rule cells, winconditions, or sound rows)
//
// Returns the number of collision layers that became empty and were dropped.

function rewriteRulesByRename(rules, rename) {
    if (!Array.isArray(rules)) return;
    for (const rule of rules) {
        forEachRuleCellName(rule, (cell, i) => {
            const target = rename.get(cell[i]);
            if (typeof target === 'string') cell[i] = target;
        });
    }
}

function rewriteWinconditionsByRename(state, rename) {
    const wcs = state.winconditions;
    if (!Array.isArray(wcs)) return;
    const kept = [];
    for (const wc of wcs) {
        if (!Array.isArray(wc) || wc.length < 2) {
            kept.push(wc);
            continue;
        }
        const next = wc.slice();
        let skip = false;
        for (let i = 0; i < next.length - 1; i++) {
            if (typeof next[i] !== 'string') continue;
            if (!rename.has(next[i])) continue;
            const target = rename.get(next[i]);
            if (target === null) {
                skip = true;
                break;
            }
            next[i] = target;
        }
        if (!skip) kept.push(next);
    }
    state.winconditions = kept;
}

function rewriteSoundsByRename(state, rename) {
    if (!Array.isArray(state.sounds)) return;
    const next = [];
    for (const sound of state.sounds) {
        if (!Array.isArray(sound) || !Array.isArray(sound[0]) || typeof sound[0][0] !== 'string') {
            next.push(sound);
            continue;
        }
        const old = sound[0][0];
        if (!rename.has(old)) {
            next.push(sound);
            continue;
        }
        const target = rename.get(old);
        if (target === null) continue; // sound row's target was deleted — drop the row
        sound[0][0] = target;
        next.push(sound);
    }
    state.sounds = next;
}

function rewriteCollisionLayersByRename(state, rename) {
    const before = state.collisionLayers.length;
    for (let li = 0; li < state.collisionLayers.length; li++) {
        const seen = new Set();
        const out = [];
        for (let n of state.collisionLayers[li]) {
            if (rename.has(n)) {
                const target = rename.get(n);
                if (target === null) continue;
                n = target;
            }
            if (seen.has(n)) continue;
            seen.add(n);
            out.push(n);
        }
        state.collisionLayers[li] = out;
    }
    state.collisionLayers = state.collisionLayers.filter(layer => layer.length > 0);
    return before - state.collisionLayers.length;
}

function rewriteLegendListByRename(rows, rename, isAggregate) {
    // legend_aggregates: AND of objects — if any member is pruned (rename→null),
    // drop the whole row; partial AND is invalid and breaks generateExtraMembers.
    // legend_properties: OR — omit pruned members only so e.g. player = uc|rc|p|lc
    // survives losing one cosmetic without dropping the entire player definition.
    const out = [];
    for (const row of rows || []) {
        if (!Array.isArray(row) || row.length < 2) continue;
        if (isAggregate) {
            let dropped = false;
            for (let j = 1; j < row.length; j++) {
                if (!rename.has(row[j])) continue;
                const target = rename.get(row[j]);
                if (target === null) {
                    dropped = true;
                    break;
                }
                row[j] = target;
            }
            if (dropped) continue;
            const seenAgg = new Set();
            let writeIdx = 1;
            for (let j = 1; j < row.length; j++) {
                if (seenAgg.has(row[j])) continue;
                seenAgg.add(row[j]);
                row[writeIdx++] = row[j];
            }
            row.length = writeIdx;
            if (row.length < 2) continue;
            out.push(row);
        } else {
            const head = row[0];
            const members = [];
            for (let j = 1; j < row.length; j++) {
                let m = row[j];
                if (rename.has(m)) {
                    const target = rename.get(m);
                    if (target === null) continue;
                    m = target;
                }
                members.push(m);
            }
            const seen = new Set();
            const deduped = [];
            for (const m of members) {
                if (seen.has(m)) continue;
                seen.add(m);
                deduped.push(m);
            }
            if (deduped.length === 0) continue;
            row.length = 0;
            row.push(head, ...deduped);
            out.push(row);
        }
    }
    return out;
}

function rewriteLegendSynonymsByRename(state, rename) {
    // legend_synonyms rows: [alias, target]. Drop self-aliases and dedup-by-key.
    const out = [];
    const seenKeys = new Set();
    for (const row of state.legend_synonyms || []) {
        if (!Array.isArray(row) || row.length < 2) continue;
        let key = row[0], val = row[1];
        if (rename.has(key)) {
            const target = rename.get(key);
            if (target === null) continue;
            key = row[0] = target;
        }
        if (rename.has(val)) {
            const target = rename.get(val);
            if (target === null) continue;
            val = row[1] = target;
        }
        if (key === val || seenKeys.has(key)) continue;
        seenKeys.add(key);
        out.push(row);
    }
    state.legend_synonyms = out;
}

/**
 * After cosmetic/merge renames, some legend OR-property definition rows are dropped
 * entirely (e.g. all members were deleted objects). Other rows may still reference
 * those property names as members; generateMasks then does val.ior(objectMask[name])
 * with undefined objectMask[name]. Remove legend rows whose members are no longer
 * resolvable to concrete objects or to a surviving property/aggregate definition.
 */
function pruneLegendRowsWithUnresolvedRefs(state) {
    if (!state) return;
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 64) {
        changed = false;
        const propDefs = new Set(
            (state.legend_properties || [])
                .filter((row) => Array.isArray(row) && row.length >= 2 && typeof row[0] === 'string')
                .map((row) => row[0])
        );
        const aggDefs = new Set(
            (state.legend_aggregates || [])
                .filter((row) => Array.isArray(row) && row.length >= 2 && typeof row[0] === 'string')
                .map((row) => row[0])
        );

        function memberOk(m) {
            if (typeof m !== 'string' || !m.length) return false;
            if (state.objects && Object.prototype.hasOwnProperty.call(state.objects, m)) return true;
            if (propDefs.has(m)) return true;
            if (aggDefs.has(m)) return true;
            return false;
        }

        const props = state.legend_properties || [];
        const propsNext = props.filter((row) => {
            if (!Array.isArray(row) || row.length < 2) return false;
            for (let j = 1; j < row.length; j++) {
                if (!memberOk(row[j])) return false;
            }
            return true;
        });
        if (propsNext.length !== props.length) {
            state.legend_properties = propsNext;
            changed = true;
            continue;
        }

        const syns = state.legend_synonyms || [];
        const synsNext = syns.filter((row) => {
            if (!Array.isArray(row) || row.length < 2) return false;
            return memberOk(row[1]);
        });
        if (synsNext.length !== syns.length) {
            state.legend_synonyms = synsNext;
            changed = true;
            continue;
        }

        const aggs = state.legend_aggregates || [];
        const aggsNext = aggs.filter((row) => {
            if (!Array.isArray(row) || row.length < 2) return false;
            for (let j = 1; j < row.length; j++) {
                const m = row[j];
                if (!state.objects || !Object.prototype.hasOwnProperty.call(state.objects, m)) return false;
            }
            return true;
        });
        if (aggsNext.length !== aggs.length) {
            state.legend_aggregates = aggsNext;
            changed = true;
        }
    }
}

function applyRenameMap(state, rename) {
    if (rename.size === 0) return 0;
    rewriteRulesByRename(state.rules, rename);
    rewriteRulesByRename(state.lateRules, rename);
    rewriteWinconditionsByRename(state, rename);
    rewriteSoundsByRename(state, rename);
    const droppedLayers = rewriteCollisionLayersByRename(state, rename);
    state.legend_aggregates = rewriteLegendListByRename(state.legend_aggregates, rename, true);
    state.legend_properties = rewriteLegendListByRename(state.legend_properties, rename, false);
    rewriteLegendSynonymsByRename(state, rename);
    pruneLegendRowsWithUnresolvedRefs(state);
    for (const oldName of rename.keys()) delete state.objects[oldName];
    return droppedLayers;
}

// ---------- Compiled-state rebuild after structural edits ----------
// generateExtraMembers expects spritematrix rows as parser glyph strings;
// the first compile pass rewrites them to numeric 5×5 grids. Convert back
// before re-running.

function restoreGlyphSpriteRows(state) {
    if (!state || !state.objects) return;
    for (const o of Object.values(state.objects)) {
        if (!o || !Array.isArray(o.spritematrix) || o.spritematrix.length === 0) continue;
        if (typeof o.spritematrix[0] === 'string') continue;
        o.spritematrix = o.spritematrix.map(row => {
            if (typeof row === 'string') return row;
            const chars = new Array(row.length);
            for (let c = 0; c < row.length; c++) {
                const cell = row[c];
                chars[c] = (cell === -1 || cell === undefined) ? '.' : String(Number(cell));
            }
            return chars.join('');
        });
    }
}

function snapshotLevels(state) {
    const strideObj = typeof STRIDE_OBJ !== 'undefined' ? STRIDE_OBJ : state.STRIDE_OBJ;
    const objectCount = state.objectCount | 0;
    const idDict = state.idDict ? state.idDict.slice() : [];
    const levels = [];
    for (const level of state.levels || []) {
        levels.push(level && level.objects && level.message === undefined
            ? new Int32Array(level.objects)
            : null);
    }
    return { strideObj, objectCount, idDict, levels };
}

function remapLevelsToNewIds(state, snapshot, rename) {
    if (!Array.isArray(state.levels)) return;
    const { strideObj: oldStride, objectCount: oldCount, idDict: oldDict, levels: oldLevels } = snapshot;
    const newStride = typeof STRIDE_OBJ !== 'undefined' ? STRIDE_OBJ : state.STRIDE_OBJ;
    const objects = state.objects || {};
    // Precompute per-old-id new bit position (-1 if dropped).
    const newIdForOldId = new Int32Array(oldCount).fill(-1);
    for (let oid = 0; oid < oldCount; oid++) {
        let name = oldDict[oid];
        if (!name) continue;
        if (rename.has(name)) {
            const target = rename.get(name);
            if (target === null) continue;
            name = target;
        }
        const obj = objects[name];
        if (obj && typeof obj.id === 'number') newIdForOldId[oid] = obj.id;
    }
    for (let i = 0; i < state.levels.length; i++) {
        const level = state.levels[i];
        const oldBuf = oldLevels[i];
        if (!level || !level.objects || level.message !== undefined || !oldBuf) continue;
        const next = new Int32Array(level.n_tiles * newStride);
        for (let t = 0; t < level.n_tiles; t++) {
            const oldBase = t * oldStride;
            const newBase = t * newStride;
            for (let w = 0; w < oldStride; w++) {
                let word = oldBuf[oldBase + w] | 0;
                while (word !== 0) {
                    const lsb = word & -word;
                    const bitIdx = 31 - Math.clz32(lsb >>> 0);
                    word ^= lsb;
                    const oid = (w << 5) + bitIdx;
                    if (oid >= oldCount) continue;
                    const newId = newIdForOldId[oid];
                    if (newId < 0) continue;
                    next[newBase + ((newId / 32) | 0)] |= 1 << (newId & 31);
                }
            }
        }
        level.objects = next;
        level.layerCount = state.collisionLayers.length;
    }
}

function rebuildAfterStructuralEdit(state, rename) {
    if (!state || state.invalid > 0) return;
    const snapshot = snapshotLevels(state);
    restoreGlyphSpriteRows(state);
    generateExtraMembers(state);
    remapLevelsToNewIds(state, snapshot, rename);
    generateMasks(state);
    cacheAllRuleNames(state);
    removeDuplicateRules(state);
}

// ---------- Inert pass ----------

function inertCommandOnlyRuleSourceLines(report) {
    const lines = new Set();
    if (!report || !report.ps_tagged || !Array.isArray(report.ps_tagged.rule_sections)) return lines;
    for (const section of report.ps_tagged.rule_sections) {
        if (!section || !Array.isArray(section.groups)) continue;
        for (const group of section.groups) {
            if (!group || !Array.isArray(group.rules)) continue;
            for (const rule of group.rules) {
                if (rule && rule.tags && rule.tags.inert_command_only && Number.isFinite(rule.source_line)) {
                    lines.add(rule.source_line);
                }
            }
        }
    }
    return lines;
}

function isInertCommandOnlyCompiledRule(rule, inertSourceLines) {
    if (!rule || !inertSourceLines.has(rule.lineNumber)) return false;
    if (rule.randomRule) return false;
    if (rule.hasReplacements) return false;
    if (!Array.isArray(rule.commands) || rule.commands.length === 0) return false;
    return rule.commands.every(command => INERT_COMMAND_NAMES.has(command[0]));
}

function dropInertCommandOnlyRulesFrom(rules, inertSourceLines) {
    if (!Array.isArray(rules)) return { kept: rules, removed: 0 };
    const kept = [];
    let removed = 0;
    for (const rule of rules) {
        if (isInertCommandOnlyCompiledRule(rule, inertSourceLines)) {
            removed++;
        } else {
            kept.push(rule);
        }
    }
    return { kept, removed };
}

function dropSolverInertCommandOnlyRules(state, inertSourceLines) {
    const main = dropInertCommandOnlyRulesFrom(state.rules, inertSourceLines);
    state.rules = main.kept;
    const late = dropInertCommandOnlyRulesFrom(state.lateRules, inertSourceLines);
    state.lateRules = late.kept;
    return main.removed + late.removed;
}

// ---------- Cosmetic rule pass ----------

function movementKeyObjectName(movementKey) {
    const text = String(movementKey);
    const separator = text.lastIndexOf(':');
    return separator === -1 ? text : text.slice(0, separator);
}

function movementTouchedObjectSet(rule) {
    const out = new Set();
    const tags = (rule && rule.tags) || {};
    for (const key of tags.movements_written || []) out.add(movementKeyObjectName(key));
    for (const key of tags.movements_removed || []) out.add(movementKeyObjectName(key));
    return out;
}

function addAll(target, values) {
    for (const value of values || []) target.add(value);
}

function ruleMutatedObjectSet(rule) {
    const tags = (rule && rule.tags) || {};
    const out = new Set();
    addAll(out, tags.objects_written);
    addAll(out, tags.objects_erased);
    for (const objectName of movementTouchedObjectSet(rule)) out.add(objectName);
    return out;
}

function cosmeticMutationProjection(rule, cosmeticObjects) {
    const tags = (rule && rule.tags) || {};
    const mutatedObjects = new Set();
    let hasVisibleMutation = false;
    for (const objectName of tags.objects_written || []) {
        if (cosmeticObjects.has(objectName)) mutatedObjects.add(objectName);
        else hasVisibleMutation = true;
    }
    for (const objectName of tags.objects_erased || []) {
        if (cosmeticObjects.has(objectName)) mutatedObjects.add(objectName);
        else hasVisibleMutation = true;
    }

    const movementWrites = new Set(tags.movements_written || []);
    const movementRemoves = new Set(tags.movements_removed || []);
    const movementKeys = new Set([...movementWrites, ...movementRemoves]);
    for (const key of movementKeys) {
        // The compiler can report an exact visible movement write/remove pair
        // for rules like `[ stationary X ] -> [ X cosmetic_marker ]`. That pair
        // is neutral after projecting cosmetic effects, so only net movement
        // changes count here.
        if (movementWrites.has(key) && movementRemoves.has(key)) {
            continue;
        }
        const objectName = movementKeyObjectName(key);
        if (cosmeticObjects.has(objectName)) mutatedObjects.add(objectName);
        else hasVisibleMutation = true;
    }
    return { mutatedObjects, hasVisibleMutation };
}

function ruleReadObjectSet(rule) {
    const tags = (rule && rule.tags) || {};
    const out = new Set();
    addAll(out, tags.objects_required);
    addAll(out, tags.objects_matched);
    addAll(out, tags.object_absences_matched);
    for (const key of tags.movements_required || []) out.add(movementKeyObjectName(key));
    for (const key of tags.movements_matched || []) out.add(movementKeyObjectName(key));
    return out;
}

function isCosmeticRuleOptimizationEligible(rule, cosmeticObjects) {
    const tags = (rule && rule.tags) || {};
    const projection = cosmeticMutationProjection(rule, cosmeticObjects);
    return rule
        && projection.mutatedObjects.size > 0
        && projection.hasVisibleMutation === false
        && rule.random_rule !== true
        && rule.rigid !== true
        && tags.has_again !== true
        && (!rule.summary || (
            rule.summary.semantic_commands.length === 0
            && rule.summary.rhs_random_objects.length === 0
        ));
}

function cosmeticRuleSourceLines(report) {
    const byLine = new Map();
    const allRules = [];
    const cosmeticObjects = collectCosmeticNames(report);
    const sections = report && report.ps_tagged && report.ps_tagged.rule_sections;
    if (!Array.isArray(sections)) return new Set();
    for (const section of sections) {
        for (const group of section.groups || []) {
            for (const rule of group.rules || []) {
                allRules.push(rule);
                if (!Number.isFinite(rule && rule.source_line)) continue;
                if (!byLine.has(rule.source_line)) {
                    byLine.set(rule.source_line, { total: 0, eligible: 0, mutatedObjects: new Set() });
                }
                const entry = byLine.get(rule.source_line);
                entry.total++;
                if (isCosmeticRuleOptimizationEligible(rule, cosmeticObjects)) {
                    entry.eligible++;
                    const projection = cosmeticMutationProjection(rule, cosmeticObjects);
                    for (const objectName of projection.mutatedObjects) entry.mutatedObjects.add(objectName);
                }
            }
        }
    }
    const candidateLines = new Set(Array.from(byLine.entries())
        .filter(([_line, entry]) => entry.total > 0 && entry.total === entry.eligible)
        .map(([line]) => line));
    let changed = true;
    while (changed) {
        changed = false;
        for (const rule of allRules) {
            if (candidateLines.has(rule && rule.source_line)) continue;
            const readObjects = ruleReadObjectSet(rule);
            const mutatedObjectsByKeptRule = ruleMutatedObjectSet(rule);
            if (readObjects.size === 0 && mutatedObjectsByKeptRule.size === 0) continue;
            for (const line of Array.from(candidateLines)) {
                const mutatedObjects = byLine.get(line).mutatedObjects;
                if (
                    [...readObjects].some(objectName => mutatedObjects.has(objectName))
                    || [...mutatedObjectsByKeptRule].some(objectName => mutatedObjects.has(objectName))
                ) {
                    candidateLines.delete(line);
                    changed = true;
                }
            }
        }
    }
    return candidateLines;
}

function dropRulesBySourceLineFrom(rules, sourceLines) {
    if (!Array.isArray(rules) || !sourceLines || sourceLines.size === 0) return { kept: rules, removed: 0 };
    const kept = [];
    let removed = 0;
    for (const rule of rules) {
        if (rule && sourceLines.has(rule.lineNumber) && rule.randomRule !== true) {
            removed++;
        } else {
            kept.push(rule);
        }
    }
    return { kept, removed };
}

function dropSolverCosmeticRules(state, sourceLines) {
    const main = dropRulesBySourceLineFrom(state.rules, sourceLines);
    state.rules = main.kept;
    const late = dropRulesBySourceLineFrom(state.lateRules, sourceLines);
    state.lateRules = late.kept;
    return main.removed + late.removed;
}

// ---------- Cosmetic pass ----------

function collectCosmeticNames(report) {
    const set = new Set();
    const objects = report && report.ps_tagged && report.ps_tagged.objects;
    if (!Array.isArray(objects)) return set;
    for (const o of objects) {
        if (o && o.tags && o.tags.cosmetic) set.add(o.name);
    }
    return set;
}

function collectStructuralObjectNames(state) {
    const out = new Set(['player']);
    if (!state || !state.objects) return out;
    if (state.objects.background) out.add('background');
    if (Number.isInteger(state.backgroundid) && state.idDict && state.idDict[state.backgroundid]) {
        out.add(state.idDict[state.backgroundid]);
    }
    if (Number.isInteger(state.backgroundlayer) && Array.isArray(state.collisionLayers)) {
        const layer = state.collisionLayers[state.backgroundlayer];
        if (Array.isArray(layer)) {
            for (const name of layer) out.add(name);
        }
    }
    return out;
}

function passCosmeticPrune(state, report, telemetry) {
    const cosmetic = runtimeObjectNameSetForStaticNames(state, collectCosmeticNames(report));
    if (cosmetic.size === 0) return;

    const raw = new Set();
    collectNamesFromRules(state.rules, raw);
    collectNamesFromRules(state.lateRules, raw);
    for (const n of collectWinconditionLegendRefs(state)) raw.add(n);
    for (const n of collectSoundTargetNames(state)) raw.add(n);
    // Intentionally omit compiled level maps: cosmetic objects may sit on tiles
    // only for display; remapLevelsToNewIds drops those bits during rebuild.
    const referenced = expandLegendRefsToConcreteObjectNames(state, raw);
    const structural = collectStructuralObjectNames(state);

    const rename = new Map();
    for (const name of cosmetic) {
        if (structural.has(name)) continue;
        if (!state.objects[name]) continue;
        if (referenced.has(name)) continue;
        rename.set(name, null);
    }
    if (rename.size === 0) return;

    telemetry.removed_cosmetic_objects += rename.size;
    telemetry.removed_collision_layers += applyRenameMap(state, rename);
    rebuildAfterStructuralEdit(state, rename);
}

// ---------- Merge pass ----------

function mergeabilityCandidatePairs(report) {
    const pairs = [];
    const facts = report && report.facts && report.facts.mergeability;
    if (!Array.isArray(facts)) return pairs;
    for (const f of facts) {
        if (!f || f.status !== 'candidate') continue;
        if (!f.subjects || !Array.isArray(f.subjects.objects)) continue;
        if (f.subjects.objects.length !== 2) continue;
        pairs.push([f.subjects.objects[0], f.subjects.objects[1]]);
    }
    return pairs;
}

function runtimeObjectNameForStaticName(state, staticName) {
    if (!state || !state.objects || typeof staticName !== 'string') return null;
    if (Object.prototype.hasOwnProperty.call(state.objects, staticName)) return staticName;
    if (state.original_case_names) {
        for (const [runtimeName, originalName] of Object.entries(state.original_case_names)) {
            if (originalName === staticName && Object.prototype.hasOwnProperty.call(state.objects, runtimeName)) {
                return runtimeName;
            }
        }
    }
    const lowerName = staticName.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(state.objects, lowerName)) return lowerName;
    return null;
}

function runtimeObjectNameSetForStaticNames(state, staticNames) {
    const out = new Set();
    for (const staticName of staticNames || []) {
        const runtimeName = runtimeObjectNameForStaticName(state, staticName);
        if (runtimeName) out.add(runtimeName);
    }
    return out;
}

function movementObjectName(movementKey) {
    return movementKeyObjectName(movementKey);
}

function mergeMutationObjectNames(report) {
    const out = new Set();
    const sections = report && report.ps_tagged && report.ps_tagged.rule_sections;
    if (!Array.isArray(sections)) return out;
    for (const section of sections) {
        for (const group of section.groups || []) {
            for (const rule of group.rules || []) {
                const tags = (rule && rule.tags) || {};
                for (const name of tags.objects_written || []) out.add(name);
                for (const name of tags.objects_erased || []) out.add(name);
                for (const key of tags.movements_written || []) out.add(movementObjectName(key));
                for (const key of tags.movements_removed || []) out.add(movementObjectName(key));
            }
        }
    }
    return out;
}

function buildMergeAliasMap(pairs, cosmeticNames, state, options = {}) {
    // Union-find over pairs whose endpoints both survive (not cosmetic-removed,
    // not engine-structural, not rule-mutated, still present in state.objects).
    // Each component's alphabetically-first member is the canonical name;
    // everyone else becomes an alias to it.
    const cosmeticRuntimeNames = runtimeObjectNameSetForStaticNames(state, cosmeticNames);
    const excludedRuntimeNames = runtimeObjectNameSetForStaticNames(state, options.excludedNames || []);
    const structuralNames = collectStructuralObjectNames(state);
    const present = new Set();
    const resolvedPairs = [];
    for (const [left, right] of pairs) {
        const a = runtimeObjectNameForStaticName(state, left);
        const b = runtimeObjectNameForStaticName(state, right);
        if (!a || !b || a === b) continue;
        if (cosmeticRuntimeNames.has(a) || cosmeticRuntimeNames.has(b)) continue;
        if (excludedRuntimeNames.has(a) || excludedRuntimeNames.has(b)) continue;
        if (structuralNames.has(a) || structuralNames.has(b)) continue;
        present.add(a);
        present.add(b);
        resolvedPairs.push([a, b]);
    }
    const parent = new Map();
    for (const n of present) parent.set(n, n);
    function find(x) {
        let p = parent.get(x);
        if (p === x) return x;
        const r = find(p);
        parent.set(x, r);
        return r;
    }
    for (const [a, b] of resolvedPairs) {
        if (!present.has(a) || !present.has(b)) continue;
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
    }
    const components = new Map();
    for (const n of present) {
        const r = find(n);
        if (!components.has(r)) components.set(r, []);
        components.get(r).push(n);
    }
    const alias = new Map();
    let groups = 0;
    for (const members of components.values()) {
        if (members.length < 2) continue;
        members.sort();
        const canon = members[0];
        groups++;
        for (let i = 1; i < members.length; i++) alias.set(members[i], canon);
    }
    return { alias, groups };
}

function passMerge(state, report, telemetry) {
    const cosmetic = collectCosmeticNames(report);
    const pairs = mergeabilityCandidatePairs(report);
    const { alias, groups } = buildMergeAliasMap(pairs, cosmetic, state, {
        excludedNames: mergeMutationObjectNames(report),
    });
    telemetry.merged_object_groups = groups;
    if (alias.size === 0) return;

    telemetry.merged_object_aliases += alias.size;
    telemetry.removed_collision_layers += applyRenameMap(state, alias);
    rebuildAfterStructuralEdit(state, alias);
}

function movementActionFact(report, id) {
    const facts = report && report.facts && report.facts.movement_action;
    if (!Array.isArray(facts)) return false;
    return facts.find(fact => fact && fact.id === id) || null;
}

function actionUnnecessaryFact(report) {
    return movementActionFact(report, 'action_unnecessary')
        || movementActionFact(report, 'action_noop');
}

function actionUnnecessaryProved(report) {
    const actionFact = actionUnnecessaryFact(report);
    return !!(actionFact && actionFact.status === 'proved');
}

function actionNoactionSafeForGame(report) {
    const actionFact = actionUnnecessaryFact(report);
    if (!actionFact || actionFact.status !== 'proved') return false;
    const proof = new Set(actionFact.proof || []);
    return !proof.has('action_effects_covered_by_directional_inputs');
}

function passActionNoop(state, report, telemetry, options = {}) {
    const actionMode = options.actionNoactionMode || 'solver';
    const canInsert = actionMode === 'game'
        ? actionNoactionSafeForGame(report)
        : actionUnnecessaryProved(report);
    if (!canInsert) return;
    if (Array.isArray(state.metadata)) {
        for (let index = 0; index < state.metadata.length; index += 2) {
            if (state.metadata[index] === 'noaction') return;
        }
        state.metadata.push('noaction', true);
        telemetry.inserted_noaction_metadata += 1;
        return;
    }
    if (!state.metadata || typeof state.metadata !== 'object') {
        state.metadata = {};
    }
    if (!Object.prototype.hasOwnProperty.call(state.metadata, 'noaction')) {
        state.metadata.noaction = true;
        telemetry.inserted_noaction_metadata += 1;
    }
}

// ---------- Pass orchestration ----------

function createSolverOptimizationHook(staticAnalysisReport, passes, options = {}) {
    const p = passes || {};
    return (compiledState) => {
        const telemetry = defaultTelemetry();
        if (!compiledState || compiledState.invalid > 0) {
            if (compiledState) compiledState.solverOptimizationTelemetry = telemetry;
            return;
        }
        if (p.inert) {
            const t0 = nowFn();
            const lines = inertCommandOnlyRuleSourceLines(staticAnalysisReport);
            if (lines.size > 0) {
                telemetry.removed_inert_rules += dropSolverInertCommandOnlyRules(compiledState, lines);
            }
            telemetry.ms_inert += nowFn() - t0;
        }
        if (p.cosmeticRules) {
            const t0 = nowFn();
            const lines = cosmeticRuleSourceLines(staticAnalysisReport);
            if (lines.size > 0) {
                telemetry.removed_cosmetic_rules += dropSolverCosmeticRules(compiledState, lines);
            }
            telemetry.ms_cosmetic_rules += nowFn() - t0;
        }
        if (p.cosmetic) {
            const t0 = nowFn();
            passCosmeticPrune(compiledState, staticAnalysisReport, telemetry);
            telemetry.ms_cosmetic += nowFn() - t0;
        }
        if (p.merge) {
            const t0 = nowFn();
            passMerge(compiledState, staticAnalysisReport, telemetry);
            telemetry.ms_merge += nowFn() - t0;
        }
        if (p.action) {
            const t0 = nowFn();
            passActionNoop(compiledState, staticAnalysisReport, telemetry, options);
            telemetry.ms_action += nowFn() - t0;
        }
        compiledState.solverOptimizationTelemetry = telemetry;
    };
}

// ---------- CLI / pass-list parsing ----------

function parseSolverOptPassList(arg) {
    const passes = { inert: false, cosmetic: false, cosmeticRules: false, merge: false, action: false };
    const aliases = {
        cosmeticrules: 'cosmeticRules',
        'cosmetic-rules': 'cosmeticRules',
        cosmetic_rules: 'cosmeticRules',
    };
    const parts = String(arg || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (parts.includes('all')) {
        passes.inert = passes.cosmetic = passes.cosmeticRules = passes.merge = passes.action = true;
        return passes;
    }
    for (const p of parts) {
        const key = aliases[p] || p;
        if (!(key in passes)) throw new Error(`Unknown solver optimization pass: ${p}`);
        passes[key] = true;
    }
    return passes;
}

function resolveSolverPasses(options) {
    if (options.solverOptParityBaseline) {
        return { inert: false, cosmetic: false, cosmeticRules: false, merge: false, action: false };
    }
    const passes = { inert: false, cosmetic: false, cosmeticRules: false, merge: false, action: false };
    if (options.solverOptPasses) Object.assign(passes, options.solverOptPasses);
    if (options.solverOptimizeStatic) passes.inert = true;
    return passes;
}

function solverPassesNeedFullStaticReport(passes) {
    return !!(passes && (passes.cosmetic || passes.cosmeticRules || passes.merge));
}

function effectiveSolverPassesForHook(staticAnalysisReport, passes) {
    const p = passes || { inert: false, cosmetic: false, cosmeticRules: false, merge: false, action: false };
    const reportOk = !!(staticAnalysisReport && staticAnalysisReport.status === 'ok');
    return {
        inert: !!p.inert,
        cosmetic: !!p.cosmetic && reportOk,
        cosmeticRules: !!p.cosmeticRules && reportOk,
        merge: !!p.merge && reportOk,
        action: !!p.action && reportOk,
    };
}

// ---------- Telemetry formatters ----------
// These read the runner's renamed totals (run_solver_tests_js.js maps
// telemetry.removed_inert_rules → totals.static_optimization_removed_rules,
// telemetry.ms_inert → totals.solver_opt_ms_inert, etc).

const FORMATTER_FIELDS = [
    ['static_optimization_removed_rules', 'inert_rules'],
    ['removed_cosmetic_objects',          'cosmetic_objs'],
    ['removed_collision_layers',          'empty_layers'],
    ['removed_cosmetic_rules',            'cosmetic_rules'],
    ['merged_object_aliases',             'merge_aliases'],
    ['merged_object_groups',              'merge_groups'],
    ['inserted_noaction_metadata',         'noaction'],
];
const FORMATTER_MS_FIELDS = [
    ['solver_opt_ms_inert',          'opt_ms_inert'],
    ['solver_opt_ms_cosmetic',       'opt_ms_cosmetic'],
    ['solver_opt_ms_cosmetic_rules', 'opt_ms_cosmetic_rules'],
    ['solver_opt_ms_merge',          'opt_ms_merge'],
    ['solver_opt_ms_action',         'opt_ms_action'],
];

function totalHookMs(t) {
    return (t.solver_opt_ms_inert || 0)
        + (t.solver_opt_ms_cosmetic || 0)
        + (t.solver_opt_ms_cosmetic_rules || 0)
        + (t.solver_opt_ms_merge || 0)
        + (t.solver_opt_ms_action || 0);
}

function formatSolverOptimizationHumanSuffixFromTotals(t) {
    if (!t) return '';
    const parts = [];
    for (const [key, label] of FORMATTER_FIELDS) {
        if ((t[key] || 0) > 0) parts.push(`${label}=${t[key]}`);
    }
    for (const [key, label] of FORMATTER_MS_FIELDS) {
        if ((t[key] || 0) > 0) parts.push(`${label}=${t[key].toFixed(3)}`);
    }
    const hookMs = totalHookMs(t);
    if (hookMs > 0) parts.push(`opt_hook_ms=${hookMs.toFixed(3)}`);
    if (t.solver_optimization_gated) parts.push('opt_gated=1');
    return parts.length > 0 ? `solver_optimization: ${parts.join(' ')}` : '';
}

function buildSolverOptimizationJsonTotals(t) {
    if (!t) return null;
    const removedInert = t.static_optimization_removed_rules || 0;
    const removedCos = t.removed_cosmetic_objects || 0;
    const removedLayers = t.removed_collision_layers || 0;
    const removedCosRules = t.removed_cosmetic_rules || 0;
    const mergedAliases = t.merged_object_aliases || 0;
    const mergedGroups = t.merged_object_groups || 0;
    const noaction = t.inserted_noaction_metadata || 0;
    const msInert = t.solver_opt_ms_inert || 0;
    const msCos = t.solver_opt_ms_cosmetic || 0;
    const msCosRules = t.solver_opt_ms_cosmetic_rules || 0;
    const msMrg = t.solver_opt_ms_merge || 0;
    const msAction = t.solver_opt_ms_action || 0;
    const hookMs = msInert + msCos + msCosRules + msMrg + msAction;
    const gated = !!t.solver_optimization_gated;
    if (removedInert + removedCos + removedLayers + removedCosRules + mergedAliases + mergedGroups + noaction + hookMs === 0 && !gated) {
        return null;
    }
    const out = {
        removed_inert_rules: removedInert,
        removed_cosmetic_objects: removedCos,
        removed_collision_layers: removedLayers,
        removed_cosmetic_rules: removedCosRules,
        merged_object_aliases: mergedAliases,
        merged_object_groups: mergedGroups,
        inserted_noaction_metadata: noaction,
        ms_inert: msInert,
        ms_cosmetic: msCos,
        ms_cosmetic_rules: msCosRules,
        ms_merge: msMrg,
        ms_action: msAction,
        ms_hook: hookMs,
    };
    if (gated) out.gated = true;
    return out;
}

module.exports = {
    INERT_COMMAND_NAMES,
    defaultTelemetry,
    inertCommandOnlyRuleSourceLines,
    isInertCommandOnlyCompiledRule,
    dropSolverInertCommandOnlyRules,
    cosmeticRuleSourceLines,
    isCosmeticRuleOptimizationEligible,
    dropSolverCosmeticRules,
    mergeabilityCandidatePairs,
    mergeMutationObjectNames,
    actionUnnecessaryProved,
    actionNoactionSafeForGame,
    runtimeObjectNameForStaticName,
    buildMergeAliasMap,
    applyNameSubstitutionToWinconditions: (state, renameFn) => {
        // Backwards-compatible shim for legacy callers (test runner).
        const rename = new Map();
        for (const wc of state.winconditions || []) {
            for (let i = 0; i < wc.length - 1; i++) {
                if (typeof wc[i] !== 'string') continue;
                const next = renameFn(wc[i]);
                if (next === null || next === undefined || next === wc[i]) continue;
                rename.set(wc[i], next);
            }
        }
        rewriteWinconditionsByRename(state, rename);
    },
    parseSolverOptPassList,
    resolveSolverPasses,
    solverPassesNeedFullStaticReport,
    effectiveSolverPassesForHook,
    formatSolverOptimizationHumanSuffixFromTotals,
    buildSolverOptimizationJsonTotals,
    createSolverOptimizationHook,
    collectWinconditionLegendRefs,
    collectObjectNamesFromCompiledLevels,
    expandLegendRefsToConcreteObjectNames,
};

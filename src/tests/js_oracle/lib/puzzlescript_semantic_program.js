'use strict';

function resolveLegendObjectIds(state, nameToId, name, visiting) {
    if (name in nameToId) {
        return [nameToId[name]];
    }
    if (visiting.has(name)) {
        return [];
    }
    visiting.add(name);
    let ids = [];
    if (state.synonymsDict && name in state.synonymsDict) {
        ids = ids.concat(resolveLegendObjectIds(state, nameToId, state.synonymsDict[name], visiting));
    } else if (state.aggregatesDict && name in state.aggregatesDict) {
        for (const member of state.aggregatesDict[name]) {
            ids = ids.concat(resolveLegendObjectIds(state, nameToId, member, visiting));
        }
    } else if (state.propertiesDict && name in state.propertiesDict) {
        for (const member of state.propertiesDict[name]) {
            ids = ids.concat(resolveLegendObjectIds(state, nameToId, member, visiting));
        }
    }
    visiting.delete(name);
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function legendList(state, nameToId, dict) {
    return Object.keys(dict || {})
        .map(function (name) {
            return { name: name, object_ids: resolveLegendObjectIds(state, nameToId, name, new Set()) };
        })
        .sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
}

function levelList(state) {
    return state.levels.map(function (level) {
        if (level.objects === undefined) {
            return { is_message: true, message: level.message || '', width: 0, height: 0, cells: [] };
        }
        const width = level.width;
        const height = level.height;
        const stride = level.objects.length / (width * height);
        const cells = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const base = (x * height + y) * stride;  // column-major
                const ids = [];
                for (let objectId = 0; objectId < state.idDict.length; objectId++) {
                    if ((level.objects[base + (objectId >> 5)] & (1 << (objectId & 31))) !== 0) {
                        ids.push(objectId);
                    }
                }
                cells.push(ids);
            }
        }
        return { is_message: false, message: '', width: width, height: height, cells: cells };
    });
}

function winConditionList(state) {
    function decodeMask(mask, objectCount) {
        const ids = [];
        if (mask && mask.data) {
            for (let id = 0; id < objectCount; id++) {
                if ((mask.data[id >> 5] & (1 << (id & 31))) !== 0) {
                    ids.push(id);
                }
            }
        }
        return ids;
    }
    const objectCount = state.idDict.length;
    return state.winconditions.map(function (condition) {
        return {
            quantifier: condition[0],
            object_ids_1: decodeMask(condition[1], objectCount),
            aggregate_1: condition[4],
            object_ids_2: decodeMask(condition[2], objectCount),
            aggregate_2: condition[5],
        };
    });
}

function ruleList(state) {
    function rowTerms(rows) {
        return rows.map(function (row) {
            return row.map(function (cell) {
                if (cell.length >= 2 && cell[0] === '...') {
                    return { ellipsis: true, terms: [] };
                }
                const terms = [];
                for (let i = 0; i < cell.length; i += 2) {
                    terms.push({ dir: cell[i] || '', name: cell[i + 1] });
                }
                return { ellipsis: false, terms: terms };
            });
        });
    }
    const authoredRules = state.semanticAuthoredRules || [];
    return authoredRules.map(function (rule) {
        return {
            line_number: rule.lineNumber,
            directions: rule.authoredDirections,
            rigid: !!rule.rigid,
            random: !!rule.randomRule,
            late: !!rule.late,
            group_number: rule.groupNumber,
            lhs: rowTerms(rule.lhs),
            rhs: rowTerms(rule.rhs),
            commands: (rule.commands || []).map(function (cmd) {
                return { name: cmd[0], argument: cmd.length > 1 ? String(cmd[1]) : '' };
            }),
        };
    });
}

function buildSemanticProgramSnapshot(state) {
    const nameToId = {};
    for (let id = 0; id < state.idDict.length; id++) {
        nameToId[state.idDict[id]] = id;
    }

    const objects = [];
    for (let id = 0; id < state.idDict.length; id++) {
        const name = state.idDict[id];
        const object = state.objects[name];
        objects.push({ id, name, layer: object.layer });
    }

    const collision_layers = state.collisionLayers.map(function (layer) {
        return layer.map(function (name) {
            return name in nameToId ? nameToId[name] : -1;
        });
    });

    const legends = {
        synonyms: legendList(state, nameToId, state.synonymsDict),
        aggregates: legendList(state, nameToId, state.aggregatesDict),
        properties: legendList(state, nameToId, state.propertiesDict),
    };

    const levels = levelList(state);
    const win_conditions = winConditionList(state);

    // Keep this in sync with the C++ metadata projection in semantic_program.cpp.
    // Two compiler.js passes rewrite metadata values: twiddleMetaData turns
    // flickscreen/zoomscreen into coord arrays (excluded here and on the C++
    // side), and formatHomePage strips the first http:// then https:// from
    // homepage (so it is already normalized here; C++ mirrors that in
    // normalizeMetadataHomepage). All other values are the raw parsed strings.
    const metadata = {};
    for (const key of Object.keys(state.metadata)) {
        if (key === 'flickscreen' || key === 'zoomscreen') {
            continue;
        }
        metadata[key] = state.metadata[key];
    }

    const soundEvents = {};
    for (const name of Object.keys(state.sfx_Events || {})) {
        soundEvents[name] = parseInt(state.sfx_Events[name], 10);
    }
    function decodeBitVec(mask, count) {
        const ids = [];
        if (mask && mask.data) {
            for (let id = 0; id < count; id++) {
                if ((mask.data[id >> 5] & (1 << (id & 31))) !== 0) ids.push(id);
            }
        }
        return ids;
    }
    function sfxEntry(e) {
        const names = ['up', 'down', 'left', 'right', 'action'];
        const dirs = [];
        const layer = (e.layer === undefined) ? -1 : e.layer;
        if (layer >= 0 && e.directionMask && e.directionMask.data) {
            for (let k = 0; k < 5; k++) {
                const bit = 5 * layer + k;
                if ((e.directionMask.data[bit >> 5] & (1 << (bit & 31))) !== 0) dirs.push(names[k]);
            }
        }
        return {
            object_ids: decodeBitVec(e.objectMask, state.idDict.length),
            directions: dirs,
            layer: layer,
            seed: parseInt(e.seed, 10),
        };
    }
    const sounds = {
        events: soundEvents,
        creation: (state.sfx_CreationMasks || []).map(sfxEntry),
        destruction: (state.sfx_DestructionMasks || []).map(sfxEntry),
        movement: (state.sfx_MovementMasks || []).reduce(function (acc, layerList) {
            return acc.concat(layerList.map(sfxEntry));
        }, []),
        movement_failure: (state.sfx_MovementFailureMasks || []).map(sfxEntry),
    };
    const rules = ruleList(state);

    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends, levels, win_conditions, metadata, sounds, rules },
    };
}

// Returns the list of single-layer-invariant violations for a SemanticProgram
// snapshot (empty list == conforming). The invariant: every object sits on
// exactly one collision layer, i.e. layer >= 0 and each object name maps to a
// single id. The engine only *warns* on violations (legacy games keep playing);
// the convergence contracts mandate it, so parity is asserted only over the
// conforming corpus.
function validateSingleLayerObjects(snapshot) {
    const violations = [];
    const objects = snapshot.semantic_program.objects;
    const idsByName = {};
    for (const object of objects) {
        if (object.layer < 0) {
            violations.push(`object "${object.name}" (id ${object.id}) is not on a collision layer`);
        }
        (idsByName[object.name] = idsByName[object.name] || []).push(object.id);
    }
    for (const name of Object.keys(idsByName)) {
        if (idsByName[name].length > 1) {
            violations.push(`object "${name}" spans multiple collision layers (ids ${idsByName[name].join(', ')})`);
        }
    }
    return violations;
}

module.exports = { buildSemanticProgramSnapshot, validateSingleLayerObjects };

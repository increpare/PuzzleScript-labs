'use strict';

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

    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers },
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

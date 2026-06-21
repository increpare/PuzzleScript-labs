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

module.exports = { buildSemanticProgramSnapshot };

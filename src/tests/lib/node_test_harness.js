'use strict';

// Shared scaffolding for the Node test harnesses
// (`run_layer_coupled_movement_node.js`, `run_property_rewrite_coalescing_node.js`,
// `run_inferred_rhs_property_bindings_node.js`).
//
// Callers must first invoke `loadPuzzleScript()` from
// `./js_oracle/lib/puzzlescript_node_env` so that `compile`, `errorCount`,
// `errorStrings`, `stripHTMLTags`, `processInput`, `level`, and `state` are
// available as globals.

const assert = require('assert');

function test(name, body) {
    try {
        body();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error && error.stack ? error.stack : String(error));
        process.exitCode = 1;
    }
}

function compileSource(source, randomseed) {
    compile(['loadLevel', 0], source, randomseed);
    assert.strictEqual(errorCount, 0, errorStrings.map(stripHTMLTags).join('\n'));
    return global.eval('state');
}

function compileSourceAllowingMessages(source) {
    compile(['loadLevel', 0], source);
    return {
        state: global.eval('state'),
        errorCount,
        messages: errorStrings.map(stripHTMLTags)
    };
}

function ruleCount(state) {
    return state.rules.reduce((sum, group) => sum + group.length, 0);
}

function lateRuleCount(state) {
    return state.lateRules.reduce((sum, group) => sum + group.length, 0);
}

function totalRuleCount(state) {
    return ruleCount(state) + lateRuleCount(state);
}

function makeCellInspector(objectNames) {
    function cellObjectNames(index) {
        const state = global.eval('state');
        const level = global.eval('level');
        const cell = level.getCell(index);
        const names = [];
        for (const name of objectNames) {
            if (cell.get(state.objects[name].id)) {
                names.push(name);
            }
        }
        return names;
    }
    function assertCell(index, expectedNames, message) {
        assert.deepStrictEqual(
            cellObjectNames(index).sort(),
            expectedNames.slice().sort(),
            message
        );
    }
    return { cellObjectNames, assertCell };
}

function runDirection(source, direction, randomseed) {
    compileSource(source, randomseed);
    processInput(direction);
}

function runTick(source, randomseed) {
    runDirection(source, -1, randomseed);
}

function runRight(source, randomseed) {
    runDirection(source, 3, randomseed);
}

module.exports = {
    test,
    compileSource,
    compileSourceAllowingMessages,
    ruleCount,
    lateRuleCount,
    totalRuleCount,
    makeCellInspector,
    runDirection,
    runTick,
    runRight,
};

"use strict";

var assert = require("assert");
var V;

try {
    V = require("./validate_connectivity.js");
} catch (error) {
    assert.fail("connectivity validator is required: " + error.message);
}

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

function clone(model) {
    return JSON.parse(JSON.stringify(model));
}

function connection(model, net) {
    return model.connections.filter(function (item) { return item.net === net; })[0];
}

function movePin(model, ref, pin, destinationNet) {
    var found = false;
    model.connections.forEach(function (item) {
        item.nodes = item.nodes.filter(function (node) {
            if (node[0] === ref && String(node[1]) === String(pin)) {
                found = true;
                return false;
            }
            return true;
        });
    });
    assert.ok(found, "test setup could not find " + ref + "." + pin);
    connection(model, destinationNet).nodes.push([ref, String(pin)]);
}

function assertRejected(model, pattern) {
    var errors = V.validateConnectivity(model);
    assert.ok(errors.length > 0, "expected connectivity validation to fail");
    assert.ok(errors.some(function (error) { return pattern.test(error); }), errors.join("; "));
}

var EXPECTED_COMPONENTS = {
    U1: ["MCP23017-E/SO", "Package_SO:SOIC-28W_7.5x17.9mm_P1.27mm", "f2abe43b-79ce-4f91-a34f-27e849a4046d", "MCP23017"],
    SW_UP: ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "0e4c7620-48d6-4920-a112-21a3249bfba7", "TACT"],
    SW_DOWN: ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "5abed186-9cb3-4286-abbb-e9d8339a14ad", "TACT"],
    SW_LEFT: ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "62cee17b-aa96-44b5-a818-d88c4d4bf07a", "TACT"],
    SW_RIGHT: ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "a1ddb411-d507-48b9-af26-f860c81613ad", "TACT"],
    SW_UNDO: ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "54709c66-66ed-4fc3-bb15-0ec33ecd272f", "TACT"],
    SW_ACTION: ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "2d954156-91bb-4370-a6cb-35be5c7ff576", "TACT"],
    SW_RESET: ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "366484ad-06ff-4a23-ab3f-f69d88ea88ca", "TACT"],
    SW_MENU: ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "82a0ed80-77a0-40cf-a208-39cca4201c6b", "TACT"],
    SW_PWR: ["PCM12SMTR", "Button_Switch_SMD:SW_SPDT_PCM12", "6ef5c169-59a4-41dd-a19c-3daf87f107fd", "SLIDE"],
    SW_MUTE: ["PCM12SMTR", "Button_Switch_SMD:SW_SPDT_PCM12", "3e016402-85c6-43ed-a254-0f878d988740", "SLIDE"],
    J_I2C: ["WAFER-GH1.25-4PWB", "Connector_JST:JST_GH_SM04B-GHS-TB_1x04-1MP_P1.25mm_Horizontal", "8448c040-e282-4175-89bf-5bdbe34ce139", "JST4"],
    J_EXP: ["WAFER-GH1.25-4PWB", "Connector_JST:JST_GH_SM04B-GHS-TB_1x04-1MP_P1.25mm_Horizontal", "46493532-cedd-425e-a83b-150b6baf58c7", "JST4"],
    J_BAT_IN: ["WAFER-GH1.25-2PWB", "Connector_JST:JST_GH_SM02B-GHS-TB_1x02-1MP_P1.25mm_Horizontal", "9b63372c-f11f-42f2-b30e-7cc0cd058c1f", "JST2"],
    J_BAT_OUT: ["WAFER-GH1.25-2PWB", "Connector_JST:JST_GH_SM02B-GHS-TB_1x02-1MP_P1.25mm_Horizontal", "57d0226d-8795-4ef7-a0c1-66e4f791f8c0", "JST2"],
    H1: ["MountingHole_2.7mm_M2.5", "MountingHole:MountingHole_2.7mm_M2.5", "3dd44c71-4aac-49f5-81ec-108b40379bb0", "MOUNT"],
    H2: ["MountingHole_2.7mm_M2.5", "MountingHole:MountingHole_2.7mm_M2.5", "023c2f5f-b5bd-4271-830c-e37e2934b255", "MOUNT"]
};

var EXPECTED_PIN_NETS = {
    "U1.1": "SIG_UP", "U1.9": "+3V3", "U1.10": "GND", "U1.12": "SCL",
    "U1.13": "SDA", "U1.15": "GND", "U1.16": "GND", "U1.17": "GND",
    "U1.18": "+3V3", "U1.20": "INT", "U1.21": "SIG_DOWN", "U1.22": "SIG_RESET",
    "U1.23": "SIG_MENU", "U1.24": "SIG_LEFT", "U1.25": "SIG_RIGHT",
    "U1.26": "SIG_UNDO", "U1.27": "SIG_MUTE", "U1.28": "SIG_ACTION",
    "J_I2C.1": "+3V3", "J_I2C.2": "GND", "J_I2C.3": "SCL", "J_I2C.4": "SDA",
    "J_I2C.MP": "GND", "J_EXP.1": "INT", "J_EXP.MP": "GND",
    "J_BAT_IN.1": "BAT_P", "J_BAT_IN.2": "GND", "J_BAT_IN.MP": "GND",
    "J_BAT_OUT.1": "BAT_SW", "J_BAT_OUT.2": "GND", "J_BAT_OUT.MP": "GND",
    "SW_UP.1": "SIG_UP", "SW_UP.2": "GND",
    "SW_DOWN.1": "SIG_DOWN", "SW_DOWN.2": "GND",
    "SW_LEFT.1": "SIG_LEFT", "SW_LEFT.2": "GND",
    "SW_RIGHT.1": "SIG_RIGHT", "SW_RIGHT.2": "GND",
    "SW_UNDO.1": "SIG_UNDO", "SW_UNDO.2": "GND",
    "SW_ACTION.1": "SIG_ACTION", "SW_ACTION.2": "GND",
    "SW_RESET.1": "SIG_RESET", "SW_RESET.2": "GND",
    "SW_MENU.1": "SIG_MENU", "SW_MENU.2": "GND",
    "SW_MUTE.1": "SIG_MUTE", "SW_MUTE.2": "GND", "SW_MUTE.3": "GND",
    "SW_PWR.1": "BAT_SW", "SW_PWR.2": "BAT_P"
};

var EXPECTED_NO_CONNECTS = {
    U1: ["2", "3", "4", "5", "6", "7", "8", "11", "14", "19"],
    J_EXP: ["2", "3", "4"],
    SW_PWR: ["3"]
};

test("canonical connectivity validates without errors", function () {
    assert.deepStrictEqual(V.validateConnectivity(V.model), []);
});

test("the exported canonical model is recursively frozen", function () {
    [
        V.model,
        V.model.meta,
        V.model.components,
        V.model.components[0],
        V.model.connections,
        V.model.connections[0],
        V.model.connections[0].nodes,
        V.model.connections[0].nodes[0],
        V.model.noConnects,
        V.model.noConnects.U1,
        V.model.boardOnlyPadRules,
        V.model.boardOnlyPadRules[0]
    ].forEach(function (value) {
        assert.ok(Object.isFrozen(value), "expected nested canonical model value to be frozen");
    });
});

test("nested canonical model mutations throw without changing shared state", function () {
    assert.throws(function () { V.model.meta.project = "mutated"; }, TypeError);
    assert.throws(function () { V.model.components[0].value = "mutated"; }, TypeError);
    assert.throws(function () { V.model.connections[0].nodes[0][1] = "99"; }, TypeError);
    assert.throws(function () { V.model.noConnects.U1.push("1"); }, TypeError);
    assert.throws(function () { V.model.boardOnlyPadRules.push({}); }, TypeError);
    assert.strictEqual(V.model.meta.project, "Pocket Card Controller");
    assert.strictEqual(V.model.components[0].value, "MCP23017-E/SO");
    assert.strictEqual(V.model.connections[0].nodes[0][1], "9");
});

test("metadata identifies the as-routed controller board", function () {
    assert.deepStrictEqual(V.model.meta, {
        project: "Pocket Card Controller",
        revision: "as-routed-2026-08-05",
        date: "2026-08-05",
        sourceBoard: "../case/out/pcb/pocket_card_controller.kicad_pcb"
    });
});

test("every canonical metadata field is enforced", function () {
    ["project", "revision", "date", "sourceBoard"].forEach(function (field) {
        var bad = clone(V.model);
        bad.meta[field] = "mutated";
        assertRejected(bad, new RegExp("meta\\." + field + ".*expected", "i"));
    });
});

test("unexpected metadata fields are rejected", function () {
    var bad = clone(V.model);
    bad.meta.unexpected = "value";
    assertRejected(bad, /unexpected meta field unexpected/i);
});

test("all 17 components preserve their routed-board identity", function () {
    var components = V.componentMap(V.model);
    assert.deepStrictEqual(Object.keys(components).sort(), Object.keys(EXPECTED_COMPONENTS).sort());
    Object.keys(EXPECTED_COMPONENTS).forEach(function (ref) {
        var component = components[ref];
        assert.ok(component, "missing " + ref);
        assert.deepStrictEqual(
            [component.value, component.footprint, component.uuid, component.symbol],
            EXPECTED_COMPONENTS[ref],
            ref
        );
    });
});

test("every component's canonical identity fields are enforced", function () {
    var fieldIndexes = { value: 0, footprint: 1, uuid: 2, symbol: 3 };
    Object.keys(EXPECTED_COMPONENTS).forEach(function (ref) {
        Object.keys(fieldIndexes).forEach(function (field) {
            var bad = clone(V.model);
            var component = bad.components.filter(function (item) { return item.ref === ref; })[0];
            component[field] = "mutated";
            assertRejected(bad, new RegExp("component " + ref + ".*" + field + ".*expected", "i"));
        });
    });
});

test("MCP23017 gameplay inputs use the routed pin order", function () {
    var pins = V.pinNetMap(V.model);
    assert.deepStrictEqual([
        pins["U1.1"], pins["U1.21"], pins["U1.22"], pins["U1.23"],
        pins["U1.24"], pins["U1.25"], pins["U1.26"], pins["U1.27"], pins["U1.28"]
    ], [
        "SIG_UP", "SIG_DOWN", "SIG_RESET", "SIG_MENU", "SIG_LEFT",
        "SIG_RIGHT", "SIG_UNDO", "SIG_MUTE", "SIG_ACTION"
    ]);
});

test("MCP23017 support pins and no-connects are exact", function () {
    var pins = V.pinNetMap(V.model);
    assert.deepStrictEqual([
        pins["U1.9"], pins["U1.18"], pins["U1.10"], pins["U1.15"],
        pins["U1.16"], pins["U1.17"], pins["U1.12"], pins["U1.13"], pins["U1.20"]
    ], ["+3V3", "+3V3", "GND", "GND", "GND", "GND", "SCL", "SDA", "INT"]);
    assert.deepStrictEqual(V.model.noConnects, EXPECTED_NO_CONNECTS);
});

test("connectors, switches, power path, and mechanical pads match the board", function () {
    assert.deepStrictEqual(Object.assign({}, V.pinNetMap(V.model)), EXPECTED_PIN_NETS);
    assert.deepStrictEqual(V.model.boardOnlyPadRules, [{
        ref: "SW_MUTE",
        pad: "",
        net: "GND",
        reason: "existing mechanical-pad grounding"
    }]);
});

test("duplicate component references are rejected", function () {
    var bad = clone(V.model);
    var duplicate = clone(bad.components[0]);
    duplicate.uuid = "00000000-0000-4000-8000-000000000001";
    bad.components.push(duplicate);
    assertRejected(bad, /duplicate component ref U1/i);
});

test("duplicate component UUIDs are rejected", function () {
    var bad = clone(V.model);
    bad.components[1].uuid = bad.components[0].uuid;
    assertRejected(bad, /duplicate component UUID/i);
});

test("a __proto__ component ref cannot bypass unexpected-ref validation", function () {
    var bad = clone(V.model);
    bad.components.push({
        ref: "__proto__",
        value: "MountingHole_2.7mm_M2.5",
        footprint: "MountingHole:MountingHole_2.7mm_M2.5",
        uuid: "00000000-0000-4000-8000-000000000099",
        symbol: "MOUNT"
    });
    assertRejected(bad, /unexpected component __proto__/i);
});

test("a __proto__ UUID cannot bypass duplicate-UUID validation", function () {
    var bad = clone(V.model);
    bad.components[0].uuid = "__proto__";
    bad.components[1].uuid = "__proto__";
    assertRejected(bad, /duplicate component UUID __proto__/i);
});

test("public component and pin maps have no object prototype", function () {
    var bad = clone(V.model);
    bad.components.push({
        ref: "__proto__",
        value: "MountingHole_2.7mm_M2.5",
        footprint: "MountingHole:MountingHole_2.7mm_M2.5",
        uuid: "00000000-0000-4000-8000-000000000099",
        symbol: "MOUNT"
    });
    var components = V.componentMap(bad);
    var pins = V.pinNetMap(V.model);
    assert.strictEqual(Object.getPrototypeOf(components), null);
    assert.strictEqual(components.__proto__.ref, "__proto__");
    assert.strictEqual(Object.getPrototypeOf(pins), null);
});

test("connections to unknown references are rejected", function () {
    var bad = clone(V.model);
    connection(bad, "SIG_UP").nodes[1][0] = "SW_MISSING";
    assertRejected(bad, /unknown component SW_MISSING/i);
});

test("connection references must be strings", function () {
    var bad = clone(V.model);
    connection(bad, "+3V3").nodes[0][0] = 1;
    assertRejected(bad, /net \+3V3 node 0 ref must be a string/i);
});

test("connection pins must be strings", function () {
    var bad = clone(V.model);
    connection(bad, "+3V3").nodes[0][1] = 9;
    assertRejected(bad, /net \+3V3 node 0 pin must be a string/i);
});

test("unknown pins are rejected for every symbol inventory", function () {
    [
        ["U1", "29"], ["SW_UP", "3"], ["SW_PWR", "4"],
        ["J_I2C", "5"], ["J_BAT_IN", "3"], ["H1", "1"]
    ].forEach(function (item) {
        var bad = clone(V.model);
        connection(bad, "GND").nodes.push(item);
        assertRejected(bad, new RegExp("unknown pin " + item[0] + "\\." + item[1], "i"));
    });
});

test("a pin connected to multiple nets is rejected", function () {
    var bad = clone(V.model);
    connection(bad, "SIG_DOWN").nodes.push(["U1", "1"]);
    assertRejected(bad, /U1\.1.*multiple nets/i);
});

test("a duplicate pin occurrence on the same net is rejected", function () {
    var bad = clone(V.model);
    connection(bad, "SIG_UP").nodes.push(["U1", "1"]);
    assertRejected(bad, /duplicate connection pin U1\.1.*SIG_UP/i);
});

test("a connected pin marked no-connect is rejected", function () {
    var bad = clone(V.model);
    bad.noConnects.U1.push("1");
    assertRejected(bad, /U1\.1.*connected.*no-connect/i);
});

test("duplicate no-connect entries are rejected", function () {
    var bad = clone(V.model);
    bad.noConnects.U1.push("2");
    assertRejected(bad, /duplicate no-connect U1\.2/i);
});

test("no-connect pins must be strings", function () {
    var bad = clone(V.model);
    bad.noConnects.U1[0] = 2;
    assertRejected(bad, /noConnects\.U1 pin 0 must be a string/i);
});

test("unknown no-connect component keys are rejected even without pins", function () {
    var bad = clone(V.model);
    bad.noConnects.SW_GHOST = [];
    assertRejected(bad, /noConnects.*unknown component SW_GHOST/i);
});

test("unexpected known no-connect component keys are rejected", function () {
    var bad = clone(V.model);
    bad.noConnects.SW_UP = [];
    assertRejected(bad, /unexpected noConnects key SW_UP/i);
});

test("unknown no-connect components produce one actionable diagnostic", function () {
    var bad = clone(V.model);
    bad.noConnects.SW_GHOST = ["1", "2"];
    assert.deepStrictEqual(V.validateConnectivity(bad), [
        "noConnects references unknown component SW_GHOST"
    ]);
});

test("nets with fewer than two nodes are rejected", function () {
    var bad = clone(V.model);
    connection(bad, "SCL").nodes.pop();
    assertRejected(bad, /net SCL.*fewer than two nodes/i);
});

test("duplicate connection net records are rejected even when their nodes are split", function () {
    var bad = clone(V.model);
    var gnd = connection(bad, "GND");
    var splitNodes = gnd.nodes.splice(10);
    bad.connections.push({ net: "GND", nodes: splitNodes });
    assertRejected(bad, /duplicate connection net GND/i);
});

test("every required reference is enforced and extras are rejected", function () {
    Object.keys(EXPECTED_COMPONENTS).forEach(function (ref) {
        var bad = clone(V.model);
        bad.components = bad.components.filter(function (component) { return component.ref !== ref; });
        assertRejected(bad, new RegExp("missing required component " + ref, "i"));
    });
    var extra = clone(V.model);
    extra.components.push({
        ref: "H3", value: "MountingHole_2.7mm_M2.5",
        footprint: "MountingHole:MountingHole_2.7mm_M2.5",
        uuid: "00000000-0000-4000-8000-000000000003", symbol: "MOUNT"
    });
    assertRejected(extra, /unexpected component H3/i);
});

test("every fixed MCP23017 pin assignment is enforced", function () {
    Object.keys(EXPECTED_PIN_NETS).filter(function (key) { return key.indexOf("U1.") === 0; })
        .forEach(function (key) {
            var parts = key.split(".");
            var bad = clone(V.model);
            var expected = EXPECTED_PIN_NETS[key];
            movePin(bad, parts[0], parts[1], expected === "GND" ? "+3V3" : "GND");
            assertRejected(bad, new RegExp(key.replace(".", "\\.") + ".*expected net " + expected.replace("+", "\\+"), "i"));
        });
});

test("every fixed connector, switch, and power pin assignment is enforced", function () {
    Object.keys(EXPECTED_PIN_NETS).filter(function (key) { return key.indexOf("U1.") !== 0; })
        .forEach(function (key) {
            var parts = key.split(".");
            var bad = clone(V.model);
            var expected = EXPECTED_PIN_NETS[key];
            movePin(bad, parts[0], parts[1], expected === "GND" ? "+3V3" : "GND");
            assertRejected(bad, new RegExp(key.replace(".", "\\.") + ".*expected net " + expected.replace("+", "\\+"), "i"));
        });
});

test("the exact no-connect inventory is enforced", function () {
    Object.keys(EXPECTED_NO_CONNECTS).forEach(function (ref) {
        EXPECTED_NO_CONNECTS[ref].forEach(function (pin) {
            var bad = clone(V.model);
            bad.noConnects[ref] = bad.noConnects[ref].filter(function (item) { return item !== pin; });
            assertRejected(bad, new RegExp(ref + "\\." + pin + ".*must be no-connect", "i"));
        });
    });
});

test("board-only pad rules require known refs and all fields", function () {
    ["ref", "pad", "net", "reason"].forEach(function (field) {
        var bad = clone(V.model);
        delete bad.boardOnlyPadRules[0][field];
        assertRejected(bad, new RegExp("boardOnlyPadRules.*" + field, "i"));
    });
    var unknown = clone(V.model);
    unknown.boardOnlyPadRules[0].ref = "SW_MISSING";
    assertRejected(unknown, /boardOnlyPadRules.*unknown component SW_MISSING/i);
});

test("board-only pad rule fields have the required types", function () {
    var invalidValues = { ref: 42, pad: [], net: {}, reason: null };
    Object.keys(invalidValues).forEach(function (field) {
        var bad = clone(V.model);
        bad.boardOnlyPadRules[0][field] = invalidValues[field];
        assertRejected(bad, new RegExp("boardOnlyPadRules.*" + field + ".*string", "i"));
    });
});

test("the canonical board-only pad rule is required exactly once", function () {
    var missing = clone(V.model);
    missing.boardOnlyPadRules = [];
    assertRejected(missing, /exactly one canonical board-only pad rule/i);

    var duplicated = clone(V.model);
    duplicated.boardOnlyPadRules.push(clone(duplicated.boardOnlyPadRules[0]));
    assertRejected(duplicated, /exactly one canonical board-only pad rule/i);
});

test("board parsing and comparison are explicitly deferred to Task 3", function () {
    assert.throws(function () { V.parseBoardFootprints(""); }, /Task 3/i);
    assert.throws(function () { V.compareBoard(V.model, {}); }, /Task 3/i);
});

console.log(passed + " tests passed");

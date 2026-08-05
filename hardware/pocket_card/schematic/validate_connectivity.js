"use strict";

var fs = require("fs");
var path = require("path");

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    Object.keys(value).forEach(function (key) {
        deepFreeze(value[key]);
    });
    return Object.freeze(value);
}

var connectivityPath = path.join(__dirname, "connectivity.json");
var model = deepFreeze(JSON.parse(fs.readFileSync(connectivityPath, "utf8")));

var REQUIRED_REFS = [
    "U1",
    "SW_UP", "SW_DOWN", "SW_LEFT", "SW_RIGHT", "SW_UNDO", "SW_ACTION", "SW_RESET", "SW_MENU",
    "SW_PWR", "SW_MUTE",
    "J_I2C", "J_EXP", "J_BAT_IN", "J_BAT_OUT",
    "H1", "H2"
];

var CANONICAL_META = {
    project: "Pocket Card Controller",
    revision: "as-routed-2026-08-05",
    date: "2026-08-05",
    sourceBoard: "../case/out/pcb/pocket_card_controller.kicad_pcb"
};
var CANONICAL_META_FIELDS = new Set(Object.keys(CANONICAL_META));

var CANONICAL_COMPONENTS = new Map([
    ["U1", ["MCP23017-E/SO", "Package_SO:SOIC-28W_7.5x17.9mm_P1.27mm", "f2abe43b-79ce-4f91-a34f-27e849a4046d", "MCP23017"]],
    ["SW_UP", ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "0e4c7620-48d6-4920-a112-21a3249bfba7", "TACT"]],
    ["SW_DOWN", ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "5abed186-9cb3-4286-abbb-e9d8339a14ad", "TACT"]],
    ["SW_LEFT", ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "62cee17b-aa96-44b5-a818-d88c4d4bf07a", "TACT"]],
    ["SW_RIGHT", ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "a1ddb411-d507-48b9-af26-f860c81613ad", "TACT"]],
    ["SW_UNDO", ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "54709c66-66ed-4fc3-bb15-0ec33ecd272f", "TACT"]],
    ["SW_ACTION", ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "2d954156-91bb-4370-a6cb-35be5c7ff576", "TACT"]],
    ["SW_RESET", ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "366484ad-06ff-4a23-ab3f-f69d88ea88ca", "TACT"]],
    ["SW_MENU", ["SKQGABE010", "Button_Switch_SMD:SW_SPST_SKQG_WithStem", "82a0ed80-77a0-40cf-a208-39cca4201c6b", "TACT"]],
    ["SW_PWR", ["PCM12SMTR", "Button_Switch_SMD:SW_SPDT_PCM12", "6ef5c169-59a4-41dd-a19c-3daf87f107fd", "SLIDE"]],
    ["SW_MUTE", ["PCM12SMTR", "Button_Switch_SMD:SW_SPDT_PCM12", "3e016402-85c6-43ed-a254-0f878d988740", "SLIDE"]],
    ["J_I2C", ["WAFER-GH1.25-4PWB", "Connector_JST:JST_GH_SM04B-GHS-TB_1x04-1MP_P1.25mm_Horizontal", "8448c040-e282-4175-89bf-5bdbe34ce139", "JST4"]],
    ["J_EXP", ["WAFER-GH1.25-4PWB", "Connector_JST:JST_GH_SM04B-GHS-TB_1x04-1MP_P1.25mm_Horizontal", "46493532-cedd-425e-a83b-150b6baf58c7", "JST4"]],
    ["J_BAT_IN", ["WAFER-GH1.25-2PWB", "Connector_JST:JST_GH_SM02B-GHS-TB_1x02-1MP_P1.25mm_Horizontal", "9b63372c-f11f-42f2-b30e-7cc0cd058c1f", "JST2"]],
    ["J_BAT_OUT", ["WAFER-GH1.25-2PWB", "Connector_JST:JST_GH_SM02B-GHS-TB_1x02-1MP_P1.25mm_Horizontal", "57d0226d-8795-4ef7-a0c1-66e4f791f8c0", "JST2"]],
    ["H1", ["MountingHole_2.7mm_M2.5", "MountingHole:MountingHole_2.7mm_M2.5", "3dd44c71-4aac-49f5-81ec-108b40379bb0", "MOUNT"]],
    ["H2", ["MountingHole_2.7mm_M2.5", "MountingHole:MountingHole_2.7mm_M2.5", "023c2f5f-b5bd-4271-830c-e37e2934b255", "MOUNT"]]
]);

var LEGAL_PINS = new Map([
    ["MCP23017", Array.from({ length: 28 }, function (_, index) { return String(index + 1); })],
    ["TACT", ["1", "2"]],
    ["SLIDE", ["1", "2", "3"]],
    ["JST4", ["1", "2", "3", "4", "MP"]],
    ["JST2", ["1", "2", "MP"]],
    ["MOUNT", []]
]);

var FIXED_PIN_NETS = {
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

var FIXED_NO_CONNECTS = {
    U1: ["2", "3", "4", "5", "6", "7", "8", "11", "14", "19"],
    J_EXP: ["2", "3", "4"],
    SW_PWR: ["3"]
};
var FIXED_NO_CONNECT_REFS = new Set(Object.keys(FIXED_NO_CONNECTS));

var CANONICAL_BOARD_ONLY_PAD_RULE = {
    ref: "SW_MUTE",
    pad: "",
    net: "GND",
    reason: "existing mechanical-pad grounding"
};

function componentMap(candidate) {
    var byRef = Object.create(null);
    var components = candidate && Array.isArray(candidate.components) ? candidate.components : [];
    components.forEach(function (component) {
        if (component && typeof component.ref === "string") {
            byRef[component.ref] = component;
        }
    });
    return byRef;
}

function pinKey(ref, pin) {
    return ref + "." + String(pin);
}

function pinNetMap(candidate) {
    var byPin = Object.create(null);
    var connections = candidate && Array.isArray(candidate.connections) ? candidate.connections : [];
    connections.forEach(function (connection) {
        var nodes = connection && Array.isArray(connection.nodes) ? connection.nodes : [];
        nodes.forEach(function (node) {
            if (Array.isArray(node) && node.length >= 2) {
                byPin[pinKey(node[0], node[1])] = connection.net;
            }
        });
    });
    return byPin;
}

function validateConnectivity(candidate) {
    var errors = [];
    if (!candidate || typeof candidate !== "object") {
        return ["connectivity model must be an object"];
    }

    Object.keys(CANONICAL_META).forEach(function (field) {
        var actual = candidate.meta && candidate.meta[field];
        if (actual !== CANONICAL_META[field]) {
            errors.push("meta." + field + " expected " + CANONICAL_META[field] +
                ", got " + (actual === undefined ? "missing" : actual));
        }
    });
    if (candidate.meta && typeof candidate.meta === "object") {
        Object.keys(candidate.meta).forEach(function (field) {
            if (!CANONICAL_META_FIELDS.has(field)) {
                errors.push("unexpected meta field " + field);
            }
        });
    }

    var components = Array.isArray(candidate.components) ? candidate.components : [];
    if (!Array.isArray(candidate.components)) {
        errors.push("components must be an array");
    }

    var byRef = new Map();
    var uuidOwner = new Map();
    components.forEach(function (component, index) {
        if (!component || typeof component !== "object") {
            errors.push("component at index " + index + " must be an object");
            return;
        }
        ["ref", "value", "footprint", "uuid", "symbol"].forEach(function (field) {
            if (!Object.prototype.hasOwnProperty.call(component, field) ||
                typeof component[field] !== "string" || component[field].length === 0) {
                errors.push("component at index " + index + " requires non-empty " + field);
            }
        });
        if (typeof component.ref === "string") {
            if (byRef.has(component.ref)) {
                errors.push("duplicate component ref " + component.ref);
            } else {
                byRef.set(component.ref, component);
            }
        }
        if (typeof component.uuid === "string" && component.uuid.length > 0) {
            if (uuidOwner.has(component.uuid)) {
                errors.push("duplicate component UUID " + component.uuid +
                    " used by " + uuidOwner.get(component.uuid) + " and " + component.ref);
            } else {
                uuidOwner.set(component.uuid, component.ref);
            }
        }
        if (typeof component.symbol === "string" &&
            !LEGAL_PINS.has(component.symbol)) {
            errors.push("component " + component.ref + " has unknown symbol " + component.symbol);
        }
    });

    var requiredSet = new Set();
    REQUIRED_REFS.forEach(function (ref) {
        requiredSet.add(ref);
        if (!byRef.has(ref)) {
            errors.push("missing required component " + ref);
        }
    });
    byRef.forEach(function (_, ref) {
        if (!requiredSet.has(ref)) {
            errors.push("unexpected component " + ref);
        }
    });
    CANONICAL_COMPONENTS.forEach(function (identity, ref) {
        var component = byRef.get(ref);
        if (!component) {
            return;
        }
        ["value", "footprint", "uuid", "symbol"].forEach(function (field, index) {
            if (component[field] !== identity[index]) {
                errors.push("component " + ref + " " + field + " expected " + identity[index] +
                    ", got " + component[field]);
            }
        });
    });

    function validateKnownPin(ref, pin, context) {
        if (!byRef.has(ref)) {
            errors.push(context + " references unknown component " + ref);
            return;
        }
        var component = byRef.get(ref);
        var inventory = LEGAL_PINS.get(component.symbol);
        if (!inventory || inventory.indexOf(pin) === -1) {
            errors.push(context + " uses unknown pin " + pinKey(ref, pin) +
                " for symbol " + component.symbol);
        }
    }

    var connections = Array.isArray(candidate.connections) ? candidate.connections : [];
    if (!Array.isArray(candidate.connections)) {
        errors.push("connections must be an array");
    }
    var pinNets = new Map();
    var seenNetNames = new Set();
    connections.forEach(function (connection, connectionIndex) {
        if (!connection || typeof connection !== "object") {
            errors.push("connection at index " + connectionIndex + " must be an object");
            return;
        }
        var net = typeof connection.net === "string" ? connection.net : "<missing>";
        if (net === "<missing>" || net.length === 0) {
            errors.push("connection at index " + connectionIndex + " requires a non-empty net");
        } else if (seenNetNames.has(net)) {
            errors.push("duplicate connection net " + net);
        } else {
            seenNetNames.add(net);
        }
        var nodes = Array.isArray(connection.nodes) ? connection.nodes : [];
        if (!Array.isArray(connection.nodes)) {
            errors.push("net " + net + " nodes must be an array");
        }
        if (nodes.length < 2) {
            errors.push("net " + net + " has fewer than two nodes");
        }
        nodes.forEach(function (node, nodeIndex) {
            if (!Array.isArray(node) || node.length !== 2) {
                errors.push("net " + net + " node " + nodeIndex + " must be [ref, pin]");
                return;
            }
            if (typeof node[0] !== "string") {
                errors.push("net " + net + " node " + nodeIndex + " ref must be a string");
                return;
            }
            if (typeof node[1] !== "string") {
                errors.push("net " + net + " node " + nodeIndex + " pin must be a string");
                return;
            }
            var ref = node[0];
            var pin = node[1];
            validateKnownPin(ref, pin, "net " + net);
            var key = pinKey(ref, pin);
            if (pinNets.has(key)) {
                if (pinNets.get(key) === net) {
                    errors.push("duplicate connection pin " + key + " on net " + net);
                } else {
                    errors.push("pin " + key + " is on multiple nets (" + pinNets.get(key) + " and " + net + ")");
                }
            } else {
                pinNets.set(key, net);
            }
        });
    });

    var noConnects = candidate.noConnects;
    if (!noConnects || typeof noConnects !== "object" || Array.isArray(noConnects)) {
        errors.push("noConnects must be an object keyed by component ref");
        noConnects = {};
    }
    var noConnectSet = new Set();
    Object.keys(noConnects).forEach(function (ref) {
        var pins = noConnects[ref];
        var knownRef = byRef.has(ref);
        if (!knownRef) {
            errors.push("noConnects references unknown component " + ref);
        } else if (!FIXED_NO_CONNECT_REFS.has(ref)) {
            errors.push("unexpected noConnects key " + ref);
        }
        if (!Array.isArray(pins)) {
            errors.push("noConnects." + ref + " must be an array");
            return;
        }
        if (!knownRef || !FIXED_NO_CONNECT_REFS.has(ref)) {
            return;
        }
        pins.forEach(function (pin, pinIndex) {
            if (typeof pin !== "string") {
                errors.push("noConnects." + ref + " pin " + pinIndex + " must be a string");
                return;
            }
            validateKnownPin(ref, pin, "noConnects");
            var key = pinKey(ref, pin);
            if (noConnectSet.has(key)) {
                errors.push("duplicate no-connect " + key);
            }
            noConnectSet.add(key);
            if (pinNets.has(key)) {
                errors.push("pin " + key + " is connected and also marked no-connect");
            }
        });
    });

    Object.keys(FIXED_PIN_NETS).forEach(function (key) {
        var expectedNet = FIXED_PIN_NETS[key];
        if (pinNets.get(key) !== expectedNet) {
            errors.push("pin " + key + " expected net " + expectedNet +
                ", got " + (pinNets.get(key) === undefined ? "unconnected" : pinNets.get(key)));
        }
    });

    var expectedNoConnectSet = new Set();
    Object.keys(FIXED_NO_CONNECTS).forEach(function (ref) {
        FIXED_NO_CONNECTS[ref].forEach(function (pin) {
            var key = pinKey(ref, pin);
            expectedNoConnectSet.add(key);
            if (!noConnectSet.has(key)) {
                errors.push("pin " + key + " must be no-connect");
            }
        });
    });
    noConnectSet.forEach(function (key) {
        if (!expectedNoConnectSet.has(key)) {
            errors.push("pin " + key + " is not an allowed no-connect");
        }
    });

    var boardOnlyPadRules = candidate.boardOnlyPadRules;
    if (!Array.isArray(boardOnlyPadRules)) {
        errors.push("boardOnlyPadRules must be an array");
        boardOnlyPadRules = [];
    }
    if (boardOnlyPadRules.length !== 1) {
        errors.push("boardOnlyPadRules must contain exactly one canonical board-only pad rule");
    }
    boardOnlyPadRules.forEach(function (rule, index) {
        if (!rule || typeof rule !== "object") {
            errors.push("boardOnlyPadRules[" + index + "] must be an object");
            return;
        }
        ["ref", "pad", "net", "reason"].forEach(function (field) {
            if (!Object.prototype.hasOwnProperty.call(rule, field)) {
                errors.push("boardOnlyPadRules[" + index + "] is missing field " + field);
            } else if (typeof rule[field] !== "string") {
                errors.push("boardOnlyPadRules[" + index + "] field " + field + " must be a string");
            }
        });
        if (Object.prototype.hasOwnProperty.call(rule, "ref") &&
            !byRef.has(rule.ref)) {
            errors.push("boardOnlyPadRules[" + index + "] references unknown component " + rule.ref);
        }
        if (Object.keys(CANONICAL_BOARD_ONLY_PAD_RULE).some(function (field) {
            return rule[field] !== CANONICAL_BOARD_ONLY_PAD_RULE[field];
        })) {
            errors.push("boardOnlyPadRules[" + index + "] must match the canonical SW_MUTE empty-pad GND rule");
        }
    });

    return errors;
}

function balancedBlock(text, start) {
    if (typeof text !== "string") {
        throw new TypeError("balancedBlock text must be a string");
    }
    if (!Number.isInteger(start) || start < 0 || start >= text.length || text[start] !== "(") {
        throw new Error("expected S-expression opening parenthesis at index " + start);
    }

    var depth = 0;
    var quoted = false;
    var escaped = false;
    for (var index = start; index < text.length; index++) {
        var character = text[index];
        if (quoted) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                quoted = false;
            }
            continue;
        }
        if (character === '"') {
            quoted = true;
        } else if (character === "(") {
            depth++;
        } else if (character === ")") {
            depth--;
            if (depth === 0) {
                return text.slice(start, index + 1);
            }
        }
    }
    throw new Error("unterminated S-expression starting at index " + start);
}

function readAtom(text, start) {
    var index = start;
    while (index < text.length && /\s/.test(text[index])) {
        index++;
    }
    if (index >= text.length || text[index] === "(" || text[index] === ")") {
        return null;
    }
    if (text[index] !== '"') {
        var atomStart = index;
        while (index < text.length && !/[\s()]/.test(text[index])) {
            index++;
        }
        return { value: text.slice(atomStart, index), end: index };
    }

    var quoteStart = index;
    var value = "";
    index++;
    while (index < text.length) {
        var character = text[index];
        if (character === "\\") {
            index++;
            if (index >= text.length) {
                break;
            }
            value += text[index];
            index++;
        } else if (character === '"') {
            return { value: value, end: index + 1 };
        } else {
            value += character;
            index++;
        }
    }
    throw new Error("unterminated quoted string starting at index " + quoteStart);
}

function expressionAtoms(expression, limit) {
    var atoms = [];
    var index = 1;
    while (atoms.length < limit) {
        var atom = readAtom(expression, index);
        if (!atom) {
            break;
        }
        atoms.push(atom.value);
        index = atom.end;
    }
    return atoms;
}

function directChildBlocks(block) {
    var children = [];
    var depth = 0;
    var quoted = false;
    var escaped = false;
    for (var index = 0; index < block.length; index++) {
        var character = block[index];
        if (quoted) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                quoted = false;
            }
            continue;
        }
        if (character === '"') {
            quoted = true;
        } else if (character === "(") {
            if (depth === 1) {
                var child = balancedBlock(block, index);
                var atoms = expressionAtoms(child, 1);
                children.push({ name: atoms[0], text: child });
                index += child.length - 1;
            } else {
                depth++;
            }
        } else if (character === ")") {
            depth--;
        }
    }
    return children;
}

function parseFootprintBlock(block, boardIndex) {
    var children = directChildBlocks(block);
    var uuid = null;
    var ref = null;
    var pads = [];

    children.forEach(function (child) {
        var atoms;
        if (child.name === "uuid" && uuid === null) {
            atoms = expressionAtoms(child.text, 2);
            uuid = atoms.length > 1 ? atoms[1] : null;
        } else if (child.name === "property" && ref === null) {
            atoms = expressionAtoms(child.text, 3);
            if (atoms[1] === "Reference") {
                ref = atoms.length > 2 ? atoms[2] : null;
            }
        } else if (child.name === "pad") {
            atoms = expressionAtoms(child.text, 2);
            var number = atoms.length > 1 ? atoms[1] : null;
            var net = null;
            directChildBlocks(child.text).some(function (padChild) {
                if (padChild.name !== "net") {
                    return false;
                }
                var netAtoms = expressionAtoms(padChild.text, 3);
                net = netAtoms.length > 1 ? netAtoms[netAtoms.length - 1] : null;
                return true;
            });
            if (number === null) {
                throw new Error("board footprint at index " + boardIndex + " has a pad without a number");
            }
            pads.push({ number: number, net: net });
        }
    });

    if (ref === null || ref.length === 0) {
        throw new Error("board footprint at index " + boardIndex + " is missing a top-level Reference property");
    }
    if (uuid === null || uuid.length === 0) {
        throw new Error("board footprint " + ref + " is missing a top-level UUID");
    }
    return { ref: ref, uuid: uuid, pads: pads };
}

function parseBoardFootprints(boardText) {
    if (typeof boardText !== "string") {
        throw new TypeError("board text must be a string");
    }

    var footprints = Object.create(null);
    var depth = 0;
    var quoted = false;
    var escaped = false;
    for (var index = 0; index < boardText.length; index++) {
        var character = boardText[index];
        if (quoted) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                quoted = false;
            }
            continue;
        }
        if (character === '"') {
            quoted = true;
        } else if (character === "(") {
            var head = readAtom(boardText, index + 1);
            if (head && head.value === "footprint" && (depth === 0 || depth === 1)) {
                var block = balancedBlock(boardText, index);
                var footprint = parseFootprintBlock(block, index);
                if (Object.prototype.hasOwnProperty.call(footprints, footprint.ref)) {
                    throw new Error("duplicate board footprint reference " + footprint.ref);
                }
                footprints[footprint.ref] = {
                    uuid: footprint.uuid,
                    pads: footprint.pads
                };
                index += block.length - 1;
            } else {
                depth++;
            }
        } else if (character === ")") {
            depth--;
        }
    }
    return footprints;
}

function boardPadLabel(number) {
    return number === "" ? "<empty>" : String(number);
}

function boardNetLabel(net) {
    return net === null || net === undefined ? "unconnected" : String(net);
}

function compareBoard(candidate, footprints) {
    var errors = [];
    var components = candidate && Array.isArray(candidate.components) ? candidate.components : [];
    var board = footprints && typeof footprints === "object" ? footprints : Object.create(null);
    var componentRefs = new Set();

    components.forEach(function (component) {
        if (component && typeof component.ref === "string") {
            componentRefs.add(component.ref);
            if (!Object.prototype.hasOwnProperty.call(board, component.ref)) {
                errors.push("missing board footprint " + component.ref);
            }
        }
    });
    Object.keys(board).forEach(function (ref) {
        if (!componentRefs.has(ref)) {
            errors.push("unexpected board footprint " + ref);
        }
    });

    var connectedByRef = new Map();
    var connections = candidate && Array.isArray(candidate.connections) ? candidate.connections : [];
    connections.forEach(function (connection) {
        var nodes = connection && Array.isArray(connection.nodes) ? connection.nodes : [];
        nodes.forEach(function (node) {
            if (!Array.isArray(node) || node.length < 2) {
                return;
            }
            var ref = node[0];
            var number = String(node[1]);
            if (!connectedByRef.has(ref)) {
                connectedByRef.set(ref, new Map());
            }
            connectedByRef.get(ref).set(number, connection.net);
        });
    });

    var boardOnlyByRef = new Map();
    var boardOnlyPadRules = candidate && Array.isArray(candidate.boardOnlyPadRules) ?
        candidate.boardOnlyPadRules : [];
    boardOnlyPadRules.forEach(function (rule) {
        if (!rule || typeof rule.ref !== "string") {
            return;
        }
        if (!boardOnlyByRef.has(rule.ref)) {
            boardOnlyByRef.set(rule.ref, new Map());
        }
        boardOnlyByRef.get(rule.ref).set(String(rule.pad), rule.net);
    });

    components.forEach(function (component) {
        if (!component || typeof component.ref !== "string" ||
            !Object.prototype.hasOwnProperty.call(board, component.ref)) {
            return;
        }
        var ref = component.ref;
        var footprint = board[ref];
        if (footprint.uuid !== component.uuid) {
            errors.push(ref + " UUID expected " + component.uuid + ", found " +
                (footprint.uuid === undefined || footprint.uuid === null ? "missing" : footprint.uuid));
        }
        var pads = Array.isArray(footprint.pads) ? footprint.pads : [];
        var connectedPads = connectedByRef.get(ref) || new Map();
        var boardOnlyPads = boardOnlyByRef.get(ref) || new Map();

        function enforceExpectedPads(expectedPads) {
            expectedPads.forEach(function (expectedNet, number) {
                var matching = pads.filter(function (pad) {
                    return pad && String(pad.number) === number;
                });
                if (matching.length === 0) {
                    errors.push(ref + " pad " + boardPadLabel(number) + " expected " +
                        expectedNet + ", found missing");
                    return;
                }
                matching.forEach(function (pad) {
                    if (pad.net !== expectedNet) {
                        errors.push(ref + " pad " + boardPadLabel(number) + " expected " +
                            expectedNet + ", found " + boardNetLabel(pad.net));
                    }
                });
            });
        }

        enforceExpectedPads(connectedPads);
        enforceExpectedPads(boardOnlyPads);
        pads.forEach(function (pad) {
            if (!pad) {
                return;
            }
            var number = String(pad.number);
            var mountingHole = ref === "H1" || ref === "H2";
            if (mountingHole && number !== "") {
                errors.push(ref + " pad " + boardPadLabel(number) +
                    " is not an allowed unnumbered mechanical pad");
            }
            if ((mountingHole || (!connectedPads.has(number) && !boardOnlyPads.has(number))) &&
                pad.net !== null && pad.net !== undefined) {
                errors.push(ref + " pad " + boardPadLabel(number) +
                    " expected unconnected, found " + boardNetLabel(pad.net));
            }
        });
    });

    return errors;
}

module.exports = {
    model: model,
    componentMap: componentMap,
    pinNetMap: pinNetMap,
    validateConnectivity: validateConnectivity,
    balancedBlock: balancedBlock,
    parseBoardFootprints: parseBoardFootprints,
    compareBoard: compareBoard
};

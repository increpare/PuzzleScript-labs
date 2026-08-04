"use strict";

var fs = require("fs");
var path = require("path");

var connectivityPath = path.join(__dirname, "connectivity.json");
var model = JSON.parse(fs.readFileSync(connectivityPath, "utf8"));

var REQUIRED_REFS = [
    "U1",
    "SW_UP", "SW_DOWN", "SW_LEFT", "SW_RIGHT", "SW_UNDO", "SW_ACTION", "SW_RESET", "SW_MENU",
    "SW_PWR", "SW_MUTE",
    "J_I2C", "J_EXP", "J_BAT_IN", "J_BAT_OUT",
    "H1", "H2"
];

var LEGAL_PINS = {
    MCP23017: Array.from({ length: 28 }, function (_, index) { return String(index + 1); }),
    TACT: ["1", "2"],
    SLIDE: ["1", "2", "3"],
    JST4: ["1", "2", "3", "4", "MP"],
    JST2: ["1", "2", "MP"],
    MOUNT: []
};

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

var CANONICAL_BOARD_ONLY_PAD_RULE = {
    ref: "SW_MUTE",
    pad: "",
    net: "GND",
    reason: "existing mechanical-pad grounding"
};

function componentMap(candidate) {
    var byRef = {};
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
    var byPin = {};
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

    var components = Array.isArray(candidate.components) ? candidate.components : [];
    if (!Array.isArray(candidate.components)) {
        errors.push("components must be an array");
    }

    var byRef = {};
    var uuidOwner = {};
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
            if (Object.prototype.hasOwnProperty.call(byRef, component.ref)) {
                errors.push("duplicate component ref " + component.ref);
            } else {
                byRef[component.ref] = component;
            }
        }
        if (typeof component.uuid === "string" && component.uuid.length > 0) {
            if (Object.prototype.hasOwnProperty.call(uuidOwner, component.uuid)) {
                errors.push("duplicate component UUID " + component.uuid +
                    " used by " + uuidOwner[component.uuid] + " and " + component.ref);
            } else {
                uuidOwner[component.uuid] = component.ref;
            }
        }
        if (typeof component.symbol === "string" &&
            !Object.prototype.hasOwnProperty.call(LEGAL_PINS, component.symbol)) {
            errors.push("component " + component.ref + " has unknown symbol " + component.symbol);
        }
    });

    var requiredSet = {};
    REQUIRED_REFS.forEach(function (ref) {
        requiredSet[ref] = true;
        if (!Object.prototype.hasOwnProperty.call(byRef, ref)) {
            errors.push("missing required component " + ref);
        }
    });
    Object.keys(byRef).forEach(function (ref) {
        if (!requiredSet[ref]) {
            errors.push("unexpected component " + ref);
        }
    });

    function validateKnownPin(ref, pin, context) {
        if (!Object.prototype.hasOwnProperty.call(byRef, ref)) {
            errors.push(context + " references unknown component " + ref);
            return;
        }
        var component = byRef[ref];
        var inventory = LEGAL_PINS[component.symbol];
        if (!inventory || inventory.indexOf(String(pin)) === -1) {
            errors.push(context + " uses unknown pin " + pinKey(ref, pin) +
                " for symbol " + component.symbol);
        }
    }

    var connections = Array.isArray(candidate.connections) ? candidate.connections : [];
    if (!Array.isArray(candidate.connections)) {
        errors.push("connections must be an array");
    }
    var pinNets = {};
    connections.forEach(function (connection, connectionIndex) {
        if (!connection || typeof connection !== "object") {
            errors.push("connection at index " + connectionIndex + " must be an object");
            return;
        }
        var net = typeof connection.net === "string" ? connection.net : "<missing>";
        if (net === "<missing>" || net.length === 0) {
            errors.push("connection at index " + connectionIndex + " requires a non-empty net");
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
            var ref = node[0];
            var pin = String(node[1]);
            validateKnownPin(ref, pin, "net " + net);
            var key = pinKey(ref, pin);
            if (Object.prototype.hasOwnProperty.call(pinNets, key)) {
                if (pinNets[key] === net) {
                    errors.push("duplicate connection pin " + key + " on net " + net);
                } else {
                    errors.push("pin " + key + " is on multiple nets (" + pinNets[key] + " and " + net + ")");
                }
            } else {
                pinNets[key] = net;
            }
        });
    });

    var noConnects = candidate.noConnects;
    if (!noConnects || typeof noConnects !== "object" || Array.isArray(noConnects)) {
        errors.push("noConnects must be an object keyed by component ref");
        noConnects = {};
    }
    var noConnectSet = {};
    Object.keys(noConnects).forEach(function (ref) {
        var pins = noConnects[ref];
        if (!Array.isArray(pins)) {
            errors.push("noConnects." + ref + " must be an array");
            return;
        }
        pins.forEach(function (pin) {
            pin = String(pin);
            validateKnownPin(ref, pin, "noConnects");
            var key = pinKey(ref, pin);
            if (noConnectSet[key]) {
                errors.push("duplicate no-connect " + key);
            }
            noConnectSet[key] = true;
            if (Object.prototype.hasOwnProperty.call(pinNets, key)) {
                errors.push("pin " + key + " is connected and also marked no-connect");
            }
        });
    });

    Object.keys(FIXED_PIN_NETS).forEach(function (key) {
        var expectedNet = FIXED_PIN_NETS[key];
        if (pinNets[key] !== expectedNet) {
            errors.push("pin " + key + " expected net " + expectedNet +
                ", got " + (pinNets[key] === undefined ? "unconnected" : pinNets[key]));
        }
    });

    var expectedNoConnectSet = {};
    Object.keys(FIXED_NO_CONNECTS).forEach(function (ref) {
        FIXED_NO_CONNECTS[ref].forEach(function (pin) {
            var key = pinKey(ref, pin);
            expectedNoConnectSet[key] = true;
            if (!noConnectSet[key]) {
                errors.push("pin " + key + " must be no-connect");
            }
        });
    });
    Object.keys(noConnectSet).forEach(function (key) {
        if (!expectedNoConnectSet[key]) {
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
            !Object.prototype.hasOwnProperty.call(byRef, rule.ref)) {
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

function parseBoardFootprints() {
    throw new Error("parseBoardFootprints is deferred to Task 3");
}

function compareBoard() {
    throw new Error("compareBoard is deferred to Task 3");
}

module.exports = {
    model: model,
    componentMap: componentMap,
    pinNetMap: pinNetMap,
    validateConnectivity: validateConnectivity,
    parseBoardFootprints: parseBoardFootprints,
    compareBoard: compareBoard
};

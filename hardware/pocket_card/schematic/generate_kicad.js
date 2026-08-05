"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var connectivity = require("./validate_connectivity.js");

var OUTPUT_PATH = path.join(
    __dirname,
    "../case/out/pcb/pocket_card_controller.kicad_sch"
);

var SYMBOL_NAMES = {
    MCP23017: "PocketCard:MCP23017",
    TACT: "PocketCard:Tact",
    SLIDE: "PocketCard:SlideSPDT",
    JST4: "PocketCard:JST4",
    JST2: "PocketCard:JST2",
    MOUNT: "PocketCard:Mount"
};

var POSITIONS = {
    J_I2C: [35, 35],
    J_EXP: [35, 75],
    U1: [105, 70],
    SW_UP: [185, 30],
    SW_DOWN: [185, 50],
    SW_LEFT: [185, 70],
    SW_RIGHT: [185, 90],
    SW_UNDO: [235, 30],
    SW_ACTION: [235, 50],
    SW_RESET: [235, 70],
    SW_MENU: [235, 90],
    SW_MUTE: [235, 115],
    J_BAT_IN: [35, 130],
    SW_PWR: [105, 130],
    J_BAT_OUT: [185, 130],
    H1: [255, 130],
    H2: [270, 130]
};

function pin(number, name, x, y, angle, outwardX, outwardY) {
    return {
        number: String(number),
        name: name || String(number),
        x: x,
        y: y,
        angle: angle,
        outward: [outwardX, outwardY]
    };
}

function mcpPins() {
    var pins = [];
    var names = [
        "GPB0", "GPB1", "GPB2", "GPB3", "GPB4", "GPB5", "GPB6", "GPB7",
        "VDD", "VSS", "NC", "SCL", "SDA", "NC",
        "A0", "A1", "A2", "RESET", "INTA", "INTB",
        "GPA0", "GPA1", "GPA2", "GPA3", "GPA4", "GPA5", "GPA6", "GPA7"
    ];
    var number;
    for (number = 1; number <= 14; number += 1) {
        pins.push(pin(number, names[number - 1], -12.7,
            -16.51 + (number - 1) * 2.54, 0, -1, 0));
    }
    for (number = 15; number <= 28; number += 1) {
        pins.push(pin(number, names[number - 1], 12.7,
            16.51 - (number - 15) * 2.54, 180, 1, 0));
    }
    return pins;
}

var SYMBOLS = {
    MCP23017: {
        libraryName: SYMBOL_NAMES.MCP23017,
        baseName: "MCP23017",
        reference: "U",
        value: "MCP23017",
        pins: mcpPins(),
        graphics: [
            "(rectangle (start -10.16 -17.78) (end 10.16 17.78) " +
                "(stroke (width 0.254) (type default)) (fill (type background)))"
        ],
        propertyY: [-20.32, 20.32]
    },
    TACT: {
        libraryName: SYMBOL_NAMES.TACT,
        baseName: "Tact",
        reference: "SW",
        value: "Tact",
        pins: [
            pin("1", "1", -7.62, 0, 0, -1, 0),
            pin("2", "2", 7.62, 0, 180, 1, 0)
        ],
        graphics: [
            "(rectangle (start -5.08 -3.81) (end 5.08 3.81) " +
                "(stroke (width 0.254) (type default)) (fill (type background)))",
            "(circle (center -2.54 0) (radius 0.635) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))",
            "(circle (center 2.54 0) (radius 0.635) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))",
            "(polyline (pts (xy -1.905 -0.254) (xy 1.905 -2.032)) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))"
        ],
        propertyY: [-5.08, 5.08]
    },
    SLIDE: {
        libraryName: SYMBOL_NAMES.SLIDE,
        baseName: "SlideSPDT",
        reference: "SW",
        value: "SlideSPDT",
        pins: [
            pin("1", "1", -7.62, -2.54, 0, -1, 0),
            pin("2", "2", 7.62, 0, 180, 1, 0),
            pin("3", "3", -7.62, 2.54, 0, -1, 0)
        ],
        graphics: [
            "(rectangle (start -5.08 -5.08) (end 5.08 5.08) " +
                "(stroke (width 0.254) (type default)) (fill (type background)))",
            "(circle (center -2.54 -2.54) (radius 0.508) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))",
            "(circle (center -2.54 2.54) (radius 0.508) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))",
            "(circle (center 2.54 0) (radius 0.508) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))",
            "(polyline (pts (xy 2.032 0) (xy -2.032 -2.286)) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))"
        ],
        propertyY: [-6.35, 6.35]
    },
    JST4: {
        libraryName: SYMBOL_NAMES.JST4,
        baseName: "JST4",
        reference: "J",
        value: "JST4",
        pins: [
            pin("1", "1", 7.62, -3.81, 180, 1, 0),
            pin("2", "2", 7.62, -1.27, 180, 1, 0),
            pin("3", "3", 7.62, 1.27, 180, 1, 0),
            pin("4", "4", 7.62, 3.81, 180, 1, 0),
            pin("MP", "MP", 0, 7.62, 270, 0, 1)
        ],
        graphics: [
            "(rectangle (start -5.08 -5.08) (end 5.08 5.08) " +
                "(stroke (width 0.254) (type default)) (fill (type background)))",
            "(polyline (pts (xy -3.81 -3.81) (xy -1.27 -3.81)) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))",
            "(polyline (pts (xy -3.81 -1.27) (xy -1.27 -1.27)) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))",
            "(polyline (pts (xy -3.81 1.27) (xy -1.27 1.27)) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))",
            "(polyline (pts (xy -3.81 3.81) (xy -1.27 3.81)) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))"
        ],
        propertyY: [-6.35, 10.16],
        referenceX: -8.89
    },
    JST2: {
        libraryName: SYMBOL_NAMES.JST2,
        baseName: "JST2",
        reference: "J",
        value: "JST2",
        pins: [
            pin("1", "1", 7.62, -1.27, 180, 1, 0),
            pin("2", "2", 7.62, 1.27, 180, 1, 0),
            pin("MP", "MP", 0, 7.62, 270, 0, 1)
        ],
        graphics: [
            "(rectangle (start -5.08 -3.81) (end 5.08 3.81) " +
                "(stroke (width 0.254) (type default)) (fill (type background)))",
            "(polyline (pts (xy -3.81 -1.27) (xy -1.27 -1.27)) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))",
            "(polyline (pts (xy -3.81 1.27) (xy -1.27 1.27)) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))"
        ],
        propertyY: [-5.08, 10.16],
        referenceX: -8.89
    },
    MOUNT: {
        libraryName: SYMBOL_NAMES.MOUNT,
        baseName: "Mount",
        reference: "H",
        value: "Mount",
        pins: [],
        graphics: [
            "(circle (center 0 0) (radius 3.81) " +
                "(stroke (width 0.5) (type default)) (fill (type none)))",
            "(circle (center 0 0) (radius 1.35) " +
                "(stroke (width 0.254) (type default)) (fill (type none)))"
        ],
        propertyY: [-5.08, 5.08],
        excludeFromSim: true,
        inBom: false,
        hideValue: true
    }
};

function stableUuid(key) {
    var hex = crypto.createHash("sha1").update("pocket-card-controller:" + key).digest("hex").slice(0, 32);
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        "4" + hex.slice(13, 16),
        ((parseInt(hex.charAt(16), 16) & 3) | 8).toString(16) + hex.slice(17, 20),
        hex.slice(20, 32)
    ].join("-");
}

function numberText(value) {
    var rounded = Number(Number(value).toFixed(6));
    return Object.is(rounded, -0) ? "0" : String(rounded);
}

function quote(value) {
    return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function flags(definition) {
    return "(exclude_from_sim " + (definition.excludeFromSim ? "yes" : "no") + ") " +
        "(in_bom " + (definition.inBom === false ? "no" : "yes") + ") (on_board yes)";
}

function renderLibrarySymbol(definition) {
    var lines = [];
    lines.push("  (symbol " + quote(definition.libraryName) +
        " (pin_names (offset 0.508)) " + flags(definition));
    lines.push("    (property \"Reference\" " + quote(definition.reference) +
        " (at " + numberText(definition.referenceX || 0) + " " +
        numberText(definition.propertyY[0]) +
        " 0) (effects (font (size 1.27 1.27))))");
    lines.push("    (property \"Value\" " + quote(definition.value) +
        " (at 0 " + numberText(definition.propertyY[1]) +
        " 0) (effects (font (size 1.27 1.27))))");
    lines.push("    (property \"Footprint\" \"\" (at 0 0 0) " +
        "(effects (font (size 1.27 1.27)) hide))");
    lines.push("    (property \"Datasheet\" \"~\" (at 0 0 0) " +
        "(effects (font (size 1.27 1.27)) hide))");
    lines.push("    (symbol " + quote(definition.baseName + "_0_1"));
    definition.graphics.forEach(function (graphic) {
        lines.push("      " + graphic);
    });
    lines.push("    )");
    if (definition.pins.length > 0) {
        lines.push("    (symbol " + quote(definition.baseName + "_1_1"));
        definition.pins.forEach(function (definitionPin) {
            lines.push("      (pin passive line (at " + numberText(definitionPin.x) + " " +
                numberText(definitionPin.y) + " " + definitionPin.angle + ") (length 2.54)");
            lines.push("        (name " + quote(definitionPin.name) +
                " (effects (font (size 1.27 1.27))))");
            lines.push("        (number " + quote(definitionPin.number) +
                " (effects (font (size 1.27 1.27)))))");
        });
        lines.push("    )");
    }
    lines.push("  )");
    return lines.join("\n");
}

function renderPlacedSymbol(component, noConnectPins) {
    var definition = SYMBOLS[component.symbol];
    var position = POSITIONS[component.ref];
    var x = numberText(position[0]);
    var y = numberText(position[1]);
    var lines = [];
    lines.push("  (symbol (lib_id " + quote(definition.libraryName) + ") " +
        "(at " + x + " " + y + " 0) (unit 1)");
    lines.push("    " + flags(definition) + " (dnp no)");
    lines.push("    (uuid " + quote(component.uuid) + ")");
    lines.push("    (property \"Reference\" " + quote(component.ref) +
        " (at " + numberText(position[0] + (definition.referenceX || 0)) + " " +
        numberText(position[1] + definition.propertyY[0]) + " 0)");
    lines.push("      (effects (font (size 1.27 1.27))))");
    lines.push("    (property \"Value\" " + quote(component.value) +
        " (at " + x + " " + numberText(position[1] + definition.propertyY[1]) + " 0)");
    lines.push("      (effects (font (size 1.27 1.27))" +
        (definition.hideValue ? " hide" : "") + "))");
    lines.push("    (property \"Footprint\" " + quote(component.footprint) +
        " (at " + x + " " + y + " 0)");
    lines.push("      (effects (font (size 1.27 1.27)) hide))");
    lines.push("    (property \"Datasheet\" \"~\" (at " + x + " " + y + " 0)");
    lines.push("      (effects (font (size 1.27 1.27)) hide))");
    noConnectPins.forEach(function (pinNumber) {
        lines.push("    (property " + quote("NC Audit " + pinNumber) + " " +
            quote("NC " + component.ref + "." + pinNumber) +
            " (at " + x + " " + y + " 0)");
        lines.push("      (effects (font (size 1.27 1.27)) hide))");
    });
    definition.pins.forEach(function (definitionPin) {
        lines.push("    (pin " + quote(definitionPin.number) + " (uuid " +
            quote(stableUuid("pin:" + component.ref + "." + definitionPin.number)) + "))");
    });
    lines.push("    (instances (project \"pocket_card_controller\"");
    lines.push("      (path \"/" + stableUuid("sheet") + "\" (reference " +
        quote(component.ref) + ") (unit 1))))");
    lines.push("  )");
    return lines.join("\n");
}

function pinEndpoint(component, pinNumber) {
    var definition = SYMBOLS[component.symbol];
    var definitionPin = definition.pins.find(function (candidate) {
        return candidate.number === String(pinNumber);
    });
    if (!definitionPin) {
        throw new Error("missing pin layout for " + component.ref + "." + pinNumber);
    }
    return {
        x: POSITIONS[component.ref][0] + definitionPin.x,
        y: POSITIONS[component.ref][1] - definitionPin.y,
        outward: [definitionPin.outward[0], -definitionPin.outward[1]]
    };
}

function connectedEndpoints(model) {
    var components = new Map(model.components.map(function (component) {
        return [component.ref, component];
    }));
    var records = [];
    model.connections.forEach(function (connection) {
        connection.nodes.forEach(function (node) {
            var endpoint = pinEndpoint(components.get(node[0]), node[1]);
            records.push({
                ref: node[0],
                pin: String(node[1]),
                net: connection.net,
                start: [endpoint.x, endpoint.y],
                end: [
                    endpoint.x + endpoint.outward[0] * 5.08,
                    endpoint.y + endpoint.outward[1] * 5.08
                ],
                outward: endpoint.outward
            });
        });
    });
    return records;
}

function renderWire(record) {
    var key = record.ref + "." + record.pin + ":" + record.net;
    return [
        "  (wire",
        "    (pts (xy " + numberText(record.start[0]) + " " + numberText(record.start[1]) +
            ") (xy " + numberText(record.end[0]) + " " + numberText(record.end[1]) + "))",
        "    (stroke (width 0) (type default))",
        "    (uuid " + quote(stableUuid("wire:" + key)) + ")",
        "  )"
    ].join("\n");
}

function renderLabel(record) {
    var key = record.ref + "." + record.pin + ":" + record.net;
    var justification = record.outward[0] < 0 ? "right" : "left";
    return [
        "  (label " + quote(record.net) + " (at " + numberText(record.end[0]) + " " +
            numberText(record.end[1]) + " 0) (fields_autoplaced)",
        "    (effects (font (size 1.27 1.27)) (justify " + justification + "))",
        "    (uuid " + quote(stableUuid("label:" + key)) + ")",
        "  )"
    ].join("\n");
}

function noConnectRecords(model) {
    var components = new Map(model.components.map(function (component) {
        return [component.ref, component];
    }));
    var records = [];
    Object.keys(model.noConnects).forEach(function (ref) {
        model.noConnects[ref].forEach(function (pinNumber) {
            var endpoint = pinEndpoint(components.get(ref), pinNumber);
            records.push({
                ref: ref,
                pin: String(pinNumber),
                x: endpoint.x,
                y: endpoint.y,
                outward: endpoint.outward
            });
        });
    });
    return records;
}

function renderNoConnect(record) {
    var endpoint = record.ref + "." + record.pin;
    return "  (no_connect (at " + numberText(record.x) + " " + numberText(record.y) + ") " +
        "(uuid " + quote(stableUuid("no-connect:" + endpoint)) + "))";
}

function generateSchematic(model) {
    var errors = connectivity.validateConnectivity(model);
    if (errors.length > 0) {
        throw new Error("invalid connectivity model:\n- " + errors.join("\n- "));
    }

    var lines = [];
    lines.push("(kicad_sch");
    lines.push("  (version 20250114)");
    lines.push("  (generator \"PuzzleScript generate_kicad.js\")");
    lines.push("  (generator_version \"1.0\")");
    lines.push("  (uuid " + quote(stableUuid("sheet")) + ")");
    lines.push("  (paper \"A4\")");
    lines.push("  (title_block");
    lines.push("    (title \"Pocket Card Controller\")");
    lines.push("    (date \"2026-08-05\")");
    lines.push("    (rev \"as-routed\")");
    lines.push("    (comment 1 \"Deterministically generated from schematic/connectivity.json\")");
    lines.push("    (comment 2 \"A4 landscape; local labels connect repeated net names\")");
    lines.push("    (comment 3 \"Canonical revision: as-routed-2026-08-05\")");
    lines.push("  )");
    lines.push("  (lib_symbols");
    Object.keys(SYMBOLS).forEach(function (symbolName) {
        lines.push(renderLibrarySymbol(SYMBOLS[symbolName]));
    });
    lines.push("  )");
    lines.push("");
    model.components.forEach(function (component) {
        lines.push(renderPlacedSymbol(component, model.noConnects[component.ref] || []));
    });
    lines.push("");
    connectedEndpoints(model).forEach(function (record) {
        lines.push(renderWire(record));
        lines.push(renderLabel(record));
    });
    lines.push("");
    noConnectRecords(model).forEach(function (record) {
        lines.push(renderNoConnect(record));
    });
    lines.push("  (sheet_instances (path \"/\" (page \"1\")))");
    lines.push(")");
    return lines.join("\n") + "\n";
}

function writeSchematic(outputPath) {
    var destination = outputPath || OUTPUT_PATH;
    var schematic = generateSchematic(connectivity.model);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, schematic, "utf8");
    return destination;
}

if (require.main === module) {
    writeSchematic(process.argv[2]);
}

module.exports = {
    stableUuid: stableUuid,
    generateSchematic: generateSchematic,
    connectedEndpoints: connectedEndpoints,
    noConnectRecords: noConnectRecords,
    writeSchematic: writeSchematic
};

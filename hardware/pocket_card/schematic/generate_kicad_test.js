"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");

var generatorPath = path.join(__dirname, "generate_kicad.js");
var outputPath = path.join(
    __dirname,
    "../case/out/pcb/pocket_card_controller.kicad_sch"
);
var model = require("./connectivity.json");

assert.ok(fs.existsSync(generatorPath), "generate_kicad.js must exist");

var generator = require(generatorPath);

function escaped(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function occurrences(source, expression) {
    return (source.match(expression) || []).length;
}

function enclosingExpression(source, offset) {
    var depth = 0;
    var quoted = false;
    var escapedCharacter = false;
    var index;

    for (index = offset; index < source.length; index += 1) {
        var character = source.charAt(index);
        if (escapedCharacter) {
            escapedCharacter = false;
        } else if (character === "\\" && quoted) {
            escapedCharacter = true;
        } else if (character === "\"") {
            quoted = !quoted;
        } else if (!quoted && character === "(") {
            depth += 1;
        } else if (!quoted && character === ")") {
            depth -= 1;
            if (depth === 0) {
                return source.slice(offset, index + 1);
            }
        }
    }
    throw new Error("unterminated s-expression at byte " + offset);
}

function expressionWithUuid(source, prefix, uuid) {
    var cursor = 0;
    while (true) {
        var offset = source.indexOf(prefix, cursor);
        if (offset === -1) {
            throw new Error("missing expression " + prefix + " with UUID " + uuid);
        }
        var expression = enclosingExpression(source, offset);
        if (expression.indexOf('(uuid "' + uuid + '")') !== -1) {
            return expression;
        }
        cursor = offset + prefix.length;
    }
}

function coordinatePair(expression) {
    var matches = Array.from(expression.matchAll(/\(xy (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)/g));
    assert.strictEqual(matches.length, 2, "wire must contain exactly two points");
    return matches.map(function (match) {
        return [Number(match[1]), Number(match[2])];
    });
}

function atCoordinate(expression) {
    var match = expression.match(/\(at (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (?:0|90|180|270)\)/);
    assert.ok(match, "expression must contain an (at x y rotation) coordinate");
    return [Number(match[1]), Number(match[2])];
}

function hiddenProperty(symbolBlock, name, value) {
    var prefix = "(property " + JSON.stringify(name) + " " + JSON.stringify(value);
    var offset = symbolBlock.indexOf(prefix);
    assert.notStrictEqual(offset, -1, "missing hidden property " + name + " = " + value);
    var property = enclosingExpression(symbolBlock, offset);
    assert.ok(
        /\(hide yes\)/.test(property) || /\(effects [\s\S]* hide\)/.test(property),
        name + " must remain semantically hidden"
    );
    return property;
}

function closeEnough(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) < 1e-9,
        message + ": expected " + expected + ", got " + actual);
}

assert.strictEqual(
    generator.stableUuid("sheet"),
    "2e13cb0c-6647-4fc9-a0db-5ca9b27d688a",
    "stableUuid must use the specified namespace and SHA-1 layout"
);
assert.strictEqual(
    generator.stableUuid("wire:U1.9:+3V3"),
    "6eb828bb-7cb4-4d8f-89dc-5076174aa6d7",
    "semantic keys must deterministically identify generated objects"
);

var firstPureGeneration = generator.generateSchematic(model);
var secondPureGeneration = generator.generateSchematic(model);
assert.strictEqual(secondPureGeneration, firstPureGeneration,
    "pure schematic generation must be byte-identical");

childProcess.execFileSync(process.execPath, [generatorPath], { stdio: "pipe" });
var firstFileGeneration = fs.readFileSync(outputPath);
childProcess.execFileSync(process.execPath, [generatorPath], { stdio: "pipe" });
var secondFileGeneration = fs.readFileSync(outputPath);
assert.ok(firstFileGeneration.equals(secondFileGeneration),
    "running generation twice must produce byte-identical output");
assert.strictEqual(secondFileGeneration.toString("utf8"), firstPureGeneration,
    "CLI and pure generation must agree");

var schematic = secondFileGeneration.toString("utf8");
var symbolNames = {
    MCP23017: "PocketCard:MCP23017",
    TACT: "PocketCard:Tact",
    SLIDE: "PocketCard:SlideSPDT",
    JST4: "PocketCard:JST4",
    JST2: "PocketCard:JST2",
    MOUNT: "PocketCard:Mount"
};
var positions = {
    J_I2C: [35, 35], J_EXP: [35, 75], U1: [105, 70],
    SW_UP: [185, 30], SW_DOWN: [185, 50], SW_LEFT: [185, 70], SW_RIGHT: [185, 90],
    SW_UNDO: [235, 30], SW_ACTION: [235, 50], SW_RESET: [235, 70], SW_MENU: [235, 90],
    SW_MUTE: [235, 115], J_BAT_IN: [35, 130], SW_PWR: [105, 130],
    J_BAT_OUT: [185, 130], H1: [255, 130], H2: [270, 130]
};

Object.keys(symbolNames).forEach(function (modelName) {
    var offset = schematic.indexOf('(symbol "' + symbolNames[modelName] + '"');
    assert.ok(
        offset !== -1,
        "embedded custom symbol must exist: " + symbolNames[modelName]
    );
    assert.ok(
        enclosingExpression(schematic, offset).indexOf('(property "Datasheet" "~"') !== -1,
        symbolNames[modelName] + " must include KiCad's mandatory Datasheet property"
    );
});
assert.strictEqual(occurrences(schematic, /\(symbol \(lib_id /g), model.components.length,
    "schematic must place exactly the modeled 17 components");

model.components.forEach(function (component) {
    var block = expressionWithUuid(schematic, "(symbol (lib_id ", component.uuid);
    assert.ok(block.indexOf('(lib_id "' + symbolNames[component.symbol] + '")') !== -1,
        component.ref + " must use its mapped custom symbol");
    assert.ok(block.indexOf('(property "Reference" "' + component.ref + '"') !== -1,
        component.ref + " reference must be exact");
    assert.ok(block.indexOf('(property "Value" "' + component.value + '"') !== -1,
        component.ref + " value must be exact");
    assert.ok(block.indexOf('(property "Footprint" "' + component.footprint + '"') !== -1,
        component.ref + " footprint must be exact");
    assert.ok(block.indexOf("(at " + positions[component.ref][0] + " " +
        positions[component.ref][1] + " 0)") !== -1,
    component.ref + " placement must be exact");
    assert.ok(block.indexOf('(path "/' + generator.stableUuid("sheet") + '"') !== -1,
        component.ref + " instance path must use the deterministic root-sheet UUID");
});

var connectedEndpointCount = model.connections.reduce(function (count, connection) {
    return count + connection.nodes.length;
}, 0);
assert.strictEqual(occurrences(schematic, /\(wire\n/g), connectedEndpointCount,
    "every electrically connected pin must have one wire stub");
assert.strictEqual(occurrences(schematic, /\(label "/g), connectedEndpointCount,
    "every electrically connected pin must have one local label");

model.connections.forEach(function (connection) {
    assert.strictEqual(
        occurrences(schematic, new RegExp("\\(label \\\"" + escaped(connection.net) + "\\\"", "g")),
        connection.nodes.length,
        "net " + connection.net + " must have one local label at every endpoint"
    );
    connection.nodes.forEach(function (node) {
        var endpointKey = node[0] + "." + node[1];
        var wire = expressionWithUuid(
            schematic,
            "(wire\n",
            generator.stableUuid("wire:" + endpointKey + ":" + connection.net)
        );
        var label = expressionWithUuid(
            schematic,
            '(label "' + connection.net + '"',
            generator.stableUuid("label:" + endpointKey + ":" + connection.net)
        );
        var points = coordinatePair(wire);
        var labelAt = atCoordinate(label);
        closeEnough(Math.hypot(
            points[1][0] - points[0][0],
            points[1][1] - points[0][1]
        ), 5.08, endpointKey + " wire stub length");
        assert.deepStrictEqual(labelAt, points[1],
            endpointKey + " local label must be at the free end of its stub");
    });
});

[
    ["U1.1", "SIG_UP", [92.3, 86.51]],
    ["J_I2C.1", "+3V3", [42.62, 38.81]],
    ["J_BAT_IN.1", "BAT_P", [42.62, 131.27]],
    ["SW_MUTE.1", "SIG_MUTE", [227.38, 117.54]]
].forEach(function (expectation) {
    var wire = expressionWithUuid(
        schematic,
        "(wire\n",
        generator.stableUuid("wire:" + expectation[0] + ":" + expectation[1])
    );
    assert.deepStrictEqual(coordinatePair(wire)[0], expectation[2],
        expectation[0] + " stub must start at its KiCad-transformed symbol pin endpoint");
});

var noConnectCount = 0;
Object.keys(model.noConnects).forEach(function (ref) {
    model.noConnects[ref].forEach(function (pin) {
        noConnectCount += 1;
        var endpoint = ref + "." + pin;
        var marker = expressionWithUuid(
            schematic,
            "(no_connect ",
            generator.stableUuid("no-connect:" + endpoint)
        );
        var component = model.components.find(function (candidate) {
            return candidate.ref === ref;
        });
        var symbolBlock = expressionWithUuid(schematic, "(symbol (lib_id ", component.uuid);
        hiddenProperty(symbolBlock, "NC Audit " + pin, "NC " + endpoint);
        assert.ok(marker.indexOf("(at ") !== -1, endpoint + " no-connect marker needs a position");
    });
});
assert.strictEqual(occurrences(schematic, /\(no_connect /g), noConnectCount,
    "schematic must contain exactly the declared no-connect markers");
assert.strictEqual(occurrences(schematic, /\(property "NC Audit /g), noConnectCount,
    "schematic must contain exactly one hidden audit property per no-connect");
assert.strictEqual(occurrences(schematic, /\(text "NC /g), 0,
    "NC audits must not use graphical text because KiCad 10 renders it despite hide effects");

["H1", "H2"].forEach(function (ref) {
    var component = model.components.find(function (candidate) { return candidate.ref === ref; });
    var block = expressionWithUuid(schematic, "(symbol (lib_id ", component.uuid);
    assert.ok(block.indexOf("(exclude_from_sim yes) (in_bom no) (on_board yes)") !== -1,
        ref + " must stay on-board while excluded from simulation and BOM");
});

var temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-card-kicad-test-"));
try {
    var upgradeCopy = path.join(temporaryDirectory, "pocket_card_controller.kicad_sch");
    fs.copyFileSync(outputPath, upgradeCopy);
    childProcess.execFileSync("kicad-cli", ["sch", "upgrade", "--force", upgradeCopy], {
        cwd: temporaryDirectory,
        stdio: "pipe"
    });
    assert.ok(fs.statSync(upgradeCopy).size > 0,
        "KiCad upgrade must leave a nonempty schematic");
    var upgraded = fs.readFileSync(upgradeCopy, "utf8");
    Object.keys(model.noConnects).forEach(function (ref) {
        var component = model.components.find(function (candidate) {
            return candidate.ref === ref;
        });
        var symbolBlock = expressionWithUuid(upgraded, "(symbol", component.uuid);
        model.noConnects[ref].forEach(function (pin) {
            hiddenProperty(symbolBlock, "NC Audit " + pin, "NC " + ref + "." + pin);
        });
    });

    childProcess.execFileSync("kicad-cli", [
        "sch", "export", "svg", "--output", temporaryDirectory, upgradeCopy
    ], { cwd: temporaryDirectory, stdio: "pipe" });
    var svgPath = path.join(temporaryDirectory, "pocket_card_controller.svg");
    assert.ok(fs.statSync(svgPath).size > 0, "KiCad must export a nonempty SVG");
    assert.ok(!/<desc>NC [^<]+<\/desc>/.test(fs.readFileSync(svgPath, "utf8")),
        "hidden NC audit text must not be rendered into KiCad SVG output");
} finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("generate_kicad_test: all tests passed");

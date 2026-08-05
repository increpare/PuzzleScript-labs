"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var V = require("./validate_connectivity.js");

var boardPath = process.env.POCKET_CARD_BOARD ||
    path.join(__dirname, "../case/out/pcb/pocket_card_controller.kicad_pcb");
var footprints = V.parseBoardFootprints(fs.readFileSync(boardPath, "utf8"));
var components = V.componentMap(V.model);

assert.strictEqual(Object.keys(footprints).length, 17,
    "expected exactly 17 parsed board references");
assert.deepStrictEqual(V.compareBoard(V.model, footprints), []);
Object.keys(components).forEach(function (ref) {
    assert.strictEqual(footprints[ref].uuid, components[ref].uuid,
        ref + " schematic UUID must exactly link to its PCB footprint UUID");
});

console.log("board parity OK (17 linked footprints)");

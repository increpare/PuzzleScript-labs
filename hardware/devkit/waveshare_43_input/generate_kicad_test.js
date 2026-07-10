"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var gen = require("./generate_kicad.js");
var OUT = __dirname;

function test(name, fn) {
    try {
        fn();
        console.log("ok - " + name);
    } catch (err) {
        console.error("FAIL - " + name);
        throw err;
    }
}

test("buildSwitchList has eight controls in card layout", function () {
    var switches = gen.buildSwitchList();
    assert.strictEqual(switches.length, 8);
    assert.strictEqual(switches[0].ref, "SW1");
    assert.strictEqual(switches[0].net, "GPIO28_UP");
    assert.strictEqual(switches[7].ref, "SW8");
    assert.strictEqual(switches[7].net, "GPIO49_MENU");
});

test("generateAll writes KiCad project files", function () {
    gen.generateAll();
    ["input_board.kicad_pro", "input_board.kicad_sch", "input_board.kicad_pcb", "bom_jlc.csv", "layout.json"].forEach(function (file) {
        assert.ok(fs.existsSync(path.join(OUT, file)), file);
    });
    var pcb = fs.readFileSync(path.join(OUT, "input_board.kicad_pcb"), "utf8");
    assert.strictEqual((pcb.match(/\(footprint "PSDevkit:TL3315NF160Q"/g) || []).length, 8);
    assert.ok(pcb.indexOf('(property "Reference" "J1"') !== -1);
    assert.ok(pcb.indexOf("GPIO32_ACTION") !== -1);
});

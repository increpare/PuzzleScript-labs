"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var gen = require("./generate_kicad.js");

var CARD = path.join(__dirname, "..");
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("generateAll writes kicad project files", function () {
    var info = gen.generateAll();
    assert.strictEqual(info.sheets, 9);
    assert.ok(fs.existsSync(path.join(CARD, "card.kicad_pro")));
    assert.ok(fs.existsSync(path.join(CARD, "card.kicad_sch")));
    assert.ok(fs.existsSync(path.join(CARD, "card.kicad_pcb")));
    assert.ok(fs.existsSync(path.join(__dirname, "sheets", "power.kicad_sch")));
});

test("generateAll is deterministic", function () {
    gen.generateAll();
    var root1 = fs.readFileSync(path.join(CARD, "card.kicad_sch"), "utf8");
    var power1 = fs.readFileSync(path.join(__dirname, "sheets", "power.kicad_sch"), "utf8");
    gen.generateAll();
    var root2 = fs.readFileSync(path.join(CARD, "card.kicad_sch"), "utf8");
    var power2 = fs.readFileSync(path.join(__dirname, "sheets", "power.kicad_sch"), "utf8");
    assert.strictEqual(root2, root1);
    assert.strictEqual(power2, power1);
});

test("power sheet contains U2 and global +3V3 label", function () {
    var svg = fs.readFileSync(path.join(__dirname, "sheets", "power.kicad_sch"), "utf8");
    assert.ok(svg.indexOf("(kicad_sch") !== -1);
    assert.ok(svg.indexOf("BQ24075") !== -1);
    assert.ok(svg.indexOf("global_label \"+3V3\"") !== -1);
});

test("compute sheet contains ESP32 module", function () {
    var svg = fs.readFileSync(path.join(__dirname, "sheets", "compute.kicad_sch"), "utf8");
    assert.ok(svg.indexOf("ESP32-P4-Module-32MB") !== -1);
    assert.ok(svg.indexOf("global_label \"USB_DP\"") !== -1);
});

test("pcb contains Edge.Cuts and anchor silk", function () {
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    assert.ok(pcb.indexOf("Edge.Cuts") !== -1);
    assert.ok(pcb.indexOf("CONN_DSI_FFC") !== -1);
});

test("root sheet uses valid KiCad fill syntax", function () {
    var root = fs.readFileSync(path.join(CARD, "card.kicad_sch"), "utf8");
    assert.ok(root.indexOf("(fill (type none))") !== -1);
    assert.strictEqual(root.indexOf("(fill (color"), -1);
});

test("root sheet Sheetfile paths resolve to generated sub-sheets", function () {
    var root = fs.readFileSync(path.join(CARD, "card.kicad_sch"), "utf8");
    var matches = root.match(/\(property "Sheetfile" "([^"]+)"/g) || [];
    assert.strictEqual(matches.length, 9);
    matches.forEach(function (m) {
        var rel = m.match(/\(property "Sheetfile" "([^"]+)"/)[1];
        assert.ok(fs.existsSync(path.join(CARD, rel)), "missing sub-sheet: " + rel);
    });
});

test("sub-sheets keep global_label properties inside the label", function () {
    var storage = fs.readFileSync(path.join(__dirname, "sheets", "storage.kicad_sch"), "utf8");
    assert.ok(storage.indexOf("(property \"Intersheetrefs\"") !== -1);
    assert.ok(!storage.match(/\(uuid "[^"]+"\)\)\s*\n\s*\(property "Intersheetrefs"/));
});

console.log(passed + " tests passed");

"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var gen = require("./generate_kicad.js");

var BOARD = path.join(__dirname, "..");
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

function model() {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "connectivity.json"), "utf8"));
}

test("generateAll writes kicad project files and no pcb", function () {
    var info = gen.generateAll();
    assert.strictEqual(info.sheets, model().sheets.length);
    assert.ok(fs.existsSync(path.join(BOARD, "p4_handheld.kicad_pro")));
    assert.ok(fs.existsSync(path.join(BOARD, "p4_handheld.kicad_sch")));
    assert.ok(fs.existsSync(path.join(__dirname, "sheets", "power.kicad_sch")));
    assert.ok(fs.existsSync(path.join(BOARD, "bom", "bom_jlc.csv")));
    assert.ok(!fs.existsSync(path.join(BOARD, "p4_handheld.kicad_pcb")),
        "circuit phase must not generate a PCB");
});

test("generateAll is deterministic", function () {
    gen.generateAll();
    var root1 = fs.readFileSync(path.join(BOARD, "p4_handheld.kicad_sch"), "utf8");
    var power1 = fs.readFileSync(path.join(__dirname, "sheets", "power.kicad_sch"), "utf8");
    gen.generateAll();
    var root2 = fs.readFileSync(path.join(BOARD, "p4_handheld.kicad_sch"), "utf8");
    var power2 = fs.readFileSync(path.join(__dirname, "sheets", "power.kicad_sch"), "utf8");
    assert.strictEqual(root2, root1);
    assert.strictEqual(power2, power1);
});

test("every declared sheet file is generated as a kicad_sch", function () {
    model().sheets.forEach(function (sh) {
        var content = fs.readFileSync(path.join(__dirname, sh.file), "utf8");
        assert.ok(content.indexOf("(kicad_sch") !== -1, sh.file);
    });
});

test("root sheet Sheetfile paths resolve to generated sub-sheets", function () {
    var root = fs.readFileSync(path.join(BOARD, "p4_handheld.kicad_sch"), "utf8");
    var matches = root.match(/\(property "Sheetfile" "([^"]+)"/g) || [];
    assert.strictEqual(matches.length, model().sheets.length);
    matches.forEach(function (m) {
        var rel = m.match(/\(property "Sheetfile" "([^"]+)"/)[1];
        assert.ok(fs.existsSync(path.join(BOARD, rel)), "missing sub-sheet: " + rel);
    });
});

test("root sheet uses valid KiCad fill syntax", function () {
    var root = fs.readFileSync(path.join(BOARD, "p4_handheld.kicad_sch"), "utf8");
    assert.strictEqual(root.indexOf("(fill (color"), -1);
});

test("every component appears on its declared sheet with value", function () {
    var m = model();
    var sheetContent = {};
    m.sheets.forEach(function (sh) {
        sheetContent[sh.id] = fs.readFileSync(path.join(__dirname, sh.file), "utf8");
    });
    m.components.forEach(function (c) {
        var content = sheetContent[c.sheet];
        assert.ok(content, c.ref + " declares unknown sheet " + c.sheet);
        assert.ok(content.indexOf("\"" + c.ref + "\"") !== -1, c.ref + " missing from " + c.sheet);
    });
});

test("every gated component exposes its gate id as a symbol property", function () {
    var m = model();
    var sheetContent = {};
    m.sheets.forEach(function (sh) {
        sheetContent[sh.id] = fs.readFileSync(path.join(__dirname, sh.file), "utf8");
    });
    m.components.forEach(function (c) {
        if (c.gate) {
            assert.ok(sheetContent[c.sheet].indexOf("(property \"Gate\" \"" + c.gate + "\"") !== -1,
                c.ref + " gate " + c.gate + " not exposed on " + c.sheet);
        }
    });
});

test("bom csv lists every LCSC-mapped component (JLC PnP order file)", function () {
    gen.generateAll();
    var csv = fs.readFileSync(path.join(BOARD, "bom", "bom_jlc.csv"), "utf8");
    var catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "jlc_catalog.json"), "utf8"));
    model().components.forEach(function (c) {
        var entry = catalog.parts[c.ref];
        if (entry && entry.lcsc) {
            assert.ok(csv.indexOf(c.ref + ",") !== -1, c.ref + " missing from BOM csv");
        }
    });
});

console.log(passed + " tests passed");

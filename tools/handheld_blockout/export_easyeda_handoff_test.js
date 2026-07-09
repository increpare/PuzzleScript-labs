"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var exporter = require("./export_easyeda_handoff.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

function read(file) {
    return fs.readFileSync(file, "utf8");
}

test("stripGeneratedCopper removes only routed copper records", function () {
    var source = [
        "(kicad_pcb",
        "  (net 1 \"A\")",
        "  (segment (start 0 0) (end 1 1) (width 0.18) (layer \"F.Cu\") (net 1) (uuid \"a\"))",
        "  (via (at 1 1) (size 0.8) (drill 0.4) (layers \"F.Cu\" \"B.Cu\") (net 1) (uuid \"b\"))",
        "  (footprint \"PSCard:X\")",
        ")"
    ].join("\n") + "\n";
    var stripped = exporter.stripGeneratedCopper(source);
    assert.strictEqual(stripped.indexOf("(segment "), -1);
    assert.strictEqual(stripped.indexOf("(via "), -1);
    assert.ok(stripped.indexOf("(net 1 \"A\")") !== -1);
    assert.ok(stripped.indexOf("(footprint \"PSCard:X\")") !== -1);
});

test("exportPackage writes EasyEDA handoff with clean import and routed reference", function () {
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-easyeda-handoff-"));
    var info = exporter.exportPackage(tmp);
    var importPcb = read(path.join(tmp, "import", "card_easyeda_unrouted.kicad_pcb"));
    var referencePcb = read(path.join(tmp, "reference", "card_routed_reference.kicad_pcb"));
    var readme = read(path.join(tmp, "README.md"));

    assert.strictEqual((importPcb.match(/\(segment /g) || []).length, 0);
    assert.strictEqual((importPcb.match(/\(via /g) || []).length, 0);
    assert.ok((referencePcb.match(/\(segment /g) || []).length > 100);
    assert.ok(fs.existsSync(path.join(tmp, "import", "card.kicad_pro")));
    assert.ok(fs.existsSync(path.join(tmp, "import", "card.kicad_sch")));
    assert.ok(fs.existsSync(path.join(tmp, "import", "card.net")));
    assert.ok(fs.existsSync(path.join(tmp, "import", "schematic", "connectivity.json")));
    assert.ok(fs.existsSync(path.join(tmp, "mechanical", "layout.svg")));
    assert.ok(fs.existsSync(path.join(tmp, "reference", "board_preview.html")));
    assert.ok(fs.existsSync(path.join(tmp, "docs", "DSI_PANEL_INTERFACE.md")));
    assert.ok(fs.existsSync(path.join(tmp, "ROUTING_NOTES.md")));
    assert.ok(readme.indexOf("Import `import/card_easyeda_unrouted.kicad_pcb`") !== -1);
    assert.ok(readme.indexOf("Do not order from this package") !== -1);
    assert.strictEqual(info.unroutedPcb, path.join(tmp, "import", "card_easyeda_unrouted.kicad_pcb"));
});

console.log(passed + " tests passed");

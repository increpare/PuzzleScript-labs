"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var blockout = require("./blockout.js");
var pcb = require("./pcb_layout.js");
var exporter = require("./export_pcb_layout.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("buildPcbLayout derives 116x106 PCB from 120x110 body", function () {
    var layout = pcb.buildPcbLayout(blockout.BLOCKOUT_PRESETS.card);
    assert.strictEqual(layout.pcb.w, 116);
    assert.strictEqual(layout.pcb.h, 106);
    assert.strictEqual(layout.pcb.r, 7);
    assert.strictEqual(layout.pcb.x, 2);
    assert.strictEqual(layout.pcb.y, 2);
});

test("dpadSwitchCenters place four switches on the rocker arms", function () {
    var centers = pcb.dpadSwitchCenters(blockout.BLOCKOUT_PRESETS.card.dpad);
    assert.strictEqual(centers.length, 4);
    assert.strictEqual(centers[0].id, "SW_DPAD_UP");
    assert.strictEqual(centers[0].y, 78.25);
    assert.strictEqual(centers[2].id, "SW_DPAD_LEFT");
    assert.strictEqual(centers[2].x, 13.25);
});

test("layout includes DSI FFC anchor in fpc keep-out span", function () {
    var layout = pcb.buildPcbLayout(blockout.BLOCKOUT_PRESETS.card);
    var ffc = layout.anchors.filter(function (a) { return a.id === "CONN_DSI_FFC"; })[0];
    assert.strictEqual(ffc.x, 60);
    assert.ok(ffc.x > blockout.BLOCKOUT_PRESETS.card.topEdge.fpcKeepOut[0]);
    assert.ok(ffc.x < blockout.BLOCKOUT_PRESETS.card.topEdge.fpcKeepOut[1]);
});

test("layout exports the centered raised piezo pad anchor", function () {
    var layout = pcb.buildPcbLayout(blockout.BLOCKOUT_PRESETS.card);
    var piezo = layout.anchors.filter(function (a) { return a.id === "PAD_PIEZO"; })[0];
    assert.deepStrictEqual(
        { x: piezo.x, y: piezo.y, d: piezo.d },
        { x: 60, y: 86, d: 18 }
    );
});

test("layout includes semantic back-side battery, ESP, and PMIC keep-outs", function () {
    var layout = pcb.buildPcbLayout(blockout.BLOCKOUT_PRESETS.card);
    var ids = layout.keepouts.map(function (k) { return k.id; });
    assert.ok(ids.indexOf("display_module") !== -1);
    assert.strictEqual(ids.indexOf("battery"), -1);
    assert.ok(ids.indexOf("back_bat_1s_pouch") !== -1);
    assert.ok(ids.indexOf("back_esp32_p4_module") !== -1);
    assert.ok(ids.indexOf("back_pmic_cluster") !== -1);
    var battery = layout.keepouts.filter(function (k) { return k.id === "back_bat_1s_pouch"; })[0];
    assert.strictEqual(battery.layer, "back");
    assert.strictEqual(battery.role, "battery");
    assert.deepStrictEqual(
        { x: battery.x, y: battery.y, w: battery.w, h: battery.h },
        { x: 31, y: 73, w: 58, h: 30 }
    );
    var esp = layout.keepouts.filter(function (k) { return k.id === "back_esp32_p4_module"; })[0];
    assert.strictEqual(esp.layer, "back");
    assert.strictEqual(esp.role, "compute");
    assert.deepStrictEqual(
        { x: esp.x, y: esp.y, w: esp.w, h: esp.h },
        { x: 47.5, y: 43, w: 25, h: 25 }
    );
    var pmic = layout.keepouts.filter(function (k) { return k.id === "back_pmic_cluster"; })[0];
    assert.strictEqual(pmic.role, "power");
});

test("layoutToSvg draws edge cuts and anchor labels", function () {
    var layout = pcb.buildPcbLayout(blockout.BLOCKOUT_PRESETS.card);
    var svg = pcb.layoutToSvg(layout);
    assert.ok(svg.indexOf("Edge.Cuts") !== -1);
    assert.ok(svg.indexOf("CONN_DSI_FFC") !== -1);
    assert.ok(svg.indexOf("SW_ACTION") !== -1);
    assert.ok(svg.indexOf('stroke="#c00"') !== -1);
});

test("export_pcb_layout writes json and svg to disk", function () {
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-pcb-export-"));
    var oldArgv = process.argv;
    process.argv = ["node", "export_pcb_layout.js", "--out", tmp];
    try {
        exporter.main();
    } finally {
        process.argv = oldArgv;
    }
    assert.ok(fs.existsSync(path.join(tmp, "layout.json")));
    assert.ok(fs.existsSync(path.join(tmp, "layout.svg")));
    var json = JSON.parse(fs.readFileSync(path.join(tmp, "layout.json"), "utf8"));
    assert.strictEqual(json.pcb.w, 116);
});

console.log(passed + " tests passed");

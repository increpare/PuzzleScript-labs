"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var { execSync } = require("child_process");

var ROOT = __dirname;
var CLI = path.join(ROOT, "node_modules", "tscircuit", "cli.mjs");
var passed = 0;

function test(name, fn) {
    fn();
    passed++;
    console.log("ok - " + name);
}

function runBuild() {
    execSync("bun \"" + CLI.replace(/\\/g, "/") + "\" build index.circuit.tsx", {
        cwd: ROOT,
        stdio: "pipe",
        encoding: "utf8"
    });
}

function exportNetlist() {
    execSync(
        "bun \"" + CLI.replace(/\\/g, "/") + "\" export index.circuit.tsx -f readable-netlist -o dist/card.netlist",
        { cwd: ROOT, stdio: "pipe", encoding: "utf8" }
    );
}

test("tscircuit build produces circuit.json", function () {
    runBuild();
    assert.ok(fs.existsSync(path.join(ROOT, "dist", "index", "circuit.json")));
});

test("netlist includes power path and SD SPI", function () {
    exportNetlist();
    var netlist = fs.readFileSync(path.join(ROOT, "dist", "card.netlist"), "utf8");
    assert.ok(netlist.indexOf("BQ24075RGTR") !== -1 || netlist.indexOf("U2") !== -1);
    assert.ok(netlist.indexOf("J1") !== -1);
    assert.ok(netlist.indexOf("KH_FG1_0_H2_0_15PIN") !== -1 || netlist.indexOf("J3") !== -1);
    assert.ok(netlist.indexOf("SW1") !== -1);
    assert.ok(netlist.indexOf("U1 GPIO46") !== -1);
    assert.ok(netlist.indexOf("J4 pin2") !== -1);
    assert.ok(netlist.indexOf("VCC_3V3") !== -1);
    assert.ok(netlist.indexOf("TPS62135") !== -1 || netlist.indexOf("U4") !== -1);
    assert.ok(netlist.indexOf("J3") !== -1);
    assert.ok(netlist.indexOf("U5") !== -1);
    assert.ok(netlist.indexOf("D1") !== -1);
    assert.ok(netlist.indexOf("Q1") !== -1);
});

test("circuit.json includes DSI and USB traces", function () {
    runBuild();
    var circuit = fs.readFileSync(path.join(ROOT, "dist", "index", "circuit.json"), "utf8");
    assert.ok(circuit.indexOf("DSI_D0_P") !== -1);
    assert.ok(circuit.indexOf("USB_DP") !== -1);
    assert.ok(circuit.indexOf("PIEZO_PWM") !== -1 || circuit.indexOf("GPIO41") !== -1);
});

test("piezo driver GPIO41 not shorted to GND", function () {
    exportNetlist();
    var netlist = fs.readFileSync(path.join(ROOT, "dist", "card.netlist"), "utf8");
    assert.ok(netlist.indexOf("NET: Q1_B") !== -1);
    assert.ok(netlist.indexOf("U1 GPIO41") !== -1);
    var gndBlock = netlist.split("NET: GND")[1].split("NET:")[0];
    assert.ok(gndBlock.indexOf("GPIO41") === -1);
});
test("layout preview SVG exists after export", function () {
    var layoutSvg = path.join(ROOT, "dist", "card-pcb-layout.svg");
    if (!fs.existsSync(layoutSvg)) {
        execSync("node export_layout_preview.js", { cwd: ROOT, stdio: "pipe" });
    }
    var svg = fs.readFileSync(layoutSvg, "utf8");
    assert.ok(svg.indexOf("PCB 116×106") !== -1);
    assert.ok(svg.indexOf("viewBox") !== -1);
});

test("SW9 power pill vs ESP_EN split", function () {
    exportNetlist();
    var netlist = fs.readFileSync(path.join(ROOT, "dist", "card.netlist"), "utf8");
    assert.ok(netlist.indexOf("GPIO38") !== -1);
    assert.ok(netlist.indexOf("ESP_EN") !== -1);
});

console.log(passed + " tests passed");

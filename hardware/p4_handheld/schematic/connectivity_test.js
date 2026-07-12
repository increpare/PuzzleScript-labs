"use strict";

var assert = require("assert");
var V = require("./validate_connectivity.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("connectivity validates without errors", function () {
    var errors = V.validateConnectivity(V.model);
    assert.deepStrictEqual(errors, [], errors.join("; "));
});

test("board has no radio, haptic, or RGB sheets", function () {
    var ids = V.model.sheets.map(function (s) { return s.id; });
    assert.strictEqual(ids.indexOf("haptic"), -1);
    assert.strictEqual(ids.indexOf("led"), -1);
});

test("power tree: charger, buck-boost, panel switch, gauge", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.VBUS_IN.some(function (n) { return n[0] === "J1"; }));
    assert.ok(byNet["BAT+"].some(function (n) { return n[0] === "J2"; }));
    assert.ok(byNet["BAT+"].some(function (n) { return n[0] === "U3"; }), "fuel gauge senses cell");
    assert.ok(byNet.SYS.some(function (n) { return n[0] === "U2"; }));
    assert.ok(byNet.SYS.some(function (n) { return n[0] === "U4"; }));
    assert.ok(byNet["+3V3"].some(function (n) { return n[0] === "U4"; }));
    assert.ok(byNet["+3V3_PANEL"].some(function (n) { return n[0] === "U6"; }));
});

test("slide switch gates buck-boost EN, not battery current", function () {
    var byNet = V.buildNetMap(V.model);
    var enNet = byNet.PWR_EN;
    assert.ok(enNet.some(function (n) { return n[0] === "SW9"; }));
    assert.ok(enNet.some(function (n) { return n[0] === "U4" && /EN/i.test(n[1]); }));
    assert.ok(!byNet["BAT+"].some(function (n) { return n[0] === "SW9"; }),
        "switch must not carry battery current");
});

test("charge LED works with power off (fed from VBUS via charger CHG)", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.VBUS_IN.some(function (n) { return n[0] === "R8"; }));
});

test("compute cluster: P4 + flash + crystal + DCDC L on 3V3", function () {
    var comps = {};
    V.model.components.forEach(function (c) { comps[c.ref] = c; });
    assert.strictEqual(comps.U1.value, "ESP32-P4NRW32X");
    assert.strictEqual(comps.U1.sheet, "compute");
    assert.ok(comps.U9 && comps.X1 && comps.L1);
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet["+3V3"].some(function (n) { return n[0] === "U1"; }));
    assert.ok(byNet.ESP_EN.some(function (n) { return n[0] === "U1"; }));
});

test("USB is a differential pair from J1 to U1", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.USB_DP.some(function (n) { return n[0] === "J1"; }));
    assert.ok(byNet.USB_DP.some(function (n) { return n[0] === "U1"; }));
    assert.ok(byNet.USB_DM.some(function (n) { return n[0] === "U1"; }));
    var pairs = V.model.requirements.differential_nets.map(function (p) { return p.join("/"); });
    assert.ok(pairs.indexOf("USB_DP/USB_DM") !== -1);
});

test("DSI panel interface locks the chosen panel pinout", function () {
    var iface = V.model.panelInterface;
    assert.ok(iface, "connectivity must carry panel evidence");
    assert.strictEqual(iface.panel, "Waveshare 2.8inch DSI LCD (480x640, GT911 touch)");
    assert.strictEqual(iface.connector, "15-pin 1.0 mm Raspberry-Pi-style DSI FFC");
    assert.deepStrictEqual(iface.pinout.map(function (p) { return [p.pin, p.net]; }), [
        [1, "GND"],
        [2, "DSI_D1_N"],
        [3, "DSI_D1_P"],
        [4, "GND"],
        [5, "DSI_CLK_N"],
        [6, "DSI_CLK_P"],
        [7, "GND"],
        [8, "DSI_D0_N"],
        [9, "DSI_D0_P"],
        [10, "GND"],
        [11, "I2C_SCL"],
        [12, "I2C_SDA"],
        [13, "GND"],
        [14, "+3V3_PANEL"],
        [15, "+3V3_PANEL"]
    ]);
    assert.strictEqual(iface.orientation.gate, "GATE-PANEL-FFC-CONTACT");
});

test("DSI lanes are differential pairs at U1 and J3", function () {
    var byNet = V.buildNetMap(V.model);
    ["DSI_D0_P", "DSI_D0_N", "DSI_D1_P", "DSI_D1_N", "DSI_CLK_P", "DSI_CLK_N"].forEach(function (net) {
        assert.ok(byNet[net] && byNet[net].some(function (n) { return n[0] === "U1"; }), net + " missing at U1");
        assert.ok(byNet[net].some(function (n) { return n[0] === "J3"; }), net + " missing at J3");
    });
    var pairs = V.model.requirements.differential_nets.map(function (p) { return p.join("/"); });
    ["DSI_D0_P/DSI_D0_N", "DSI_D1_P/DSI_D1_N", "DSI_CLK_P/DSI_CLK_N"].forEach(function (pair) {
        assert.ok(pairs.indexOf(pair) !== -1, "missing differential requirement " + pair);
    });
});

test("panel rail feeds FFC pins 14 and 15, and touch I2C rides the FFC", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet["+3V3_PANEL"].some(function (n) { return n[0] === "J3" && n[1] === "14"; }));
    assert.ok(byNet["+3V3_PANEL"].some(function (n) { return n[0] === "J3" && n[1] === "15"; }));
    assert.ok(!byNet.GND.some(function (n) { return n[0] === "J3" && n[1] === "15"; }),
        "pin 15 is 3V3, not GND");
    assert.ok(byNet.I2C_SCL.some(function (n) { return n[0] === "J3" && n[1] === "11"; }));
    assert.ok(byNet.I2C_SDA.some(function (n) { return n[0] === "J3" && n[1] === "12"; }));
});

console.log(passed + " tests passed");

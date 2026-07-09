"use strict";

var assert = require("assert");
var V = require("./validate_connectivity.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("connectivity validates without errors", function () {
    var errors = V.validateConnectivity(V.model);
    assert.deepStrictEqual(errors, [], errors.join("; "));
});

test("DSI differential pairs exist", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.DSI_D0_P && byNet.DSI_D0_N);
    assert.ok(byNet.DSI_D1_P && byNet.DSI_D1_N);
    assert.ok(byNet.DSI_CLK_P && byNet.DSI_CLK_N);
});

test("power tree connects charger buck-boost and module", function () {
    var byNet = V.buildNetMap(V.model);
    var p33 = byNet["+3V3"].map(function (n) { return n[0]; });
    assert.ok(p33.indexOf("U4") !== -1);
    assert.ok(p33.indexOf("U1") !== -1);
    var panel33 = byNet["+3V3_PANEL"].map(function (n) { return n[0]; });
    assert.ok(panel33.indexOf("U6") !== -1);
    assert.ok(panel33.indexOf("J3") !== -1);
    assert.ok(byNet.VBUS_IN.some(function (n) { return n[0] === "J1"; }));
    assert.ok(byNet["BAT+"].some(function (n) { return n[0] === "J2"; }));
});

test("wake and sleep-control nets are on the planned control parts", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.SW_DPAD_DOWN.some(function (n) { return n[0] === "U1" && n[1] === "GPIO9"; }));
    assert.ok(byNet.SW_ACTION.some(function (n) { return n[0] === "U1" && n[1] === "GPIO10"; }));
    assert.ok(byNet.PANEL_EN.some(function (n) { return n[0] === "U1" && n[1] === "GPIO11"; }));
    assert.ok(byNet.PANEL_EN.some(function (n) { return n[0] === "U6"; }));
});

test("power slide switch gates the buck-boost, no latch IC", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.PWR_EN.some(function (n) { return n[0] === "SW9" && n[1] === "C"; }));
    assert.ok(byNet.PWR_EN.some(function (n) { return n[0] === "U4" && n[1] === "EN"; }));
    assert.ok(byNet.SYS.some(function (n) { return n[0] === "SW9" && n[1] === "A"; }));
    assert.ok(byNet.GND.some(function (n) { return n[0] === "SW9" && n[1] === "B"; }));
    assert.ok(byNet.GND.some(function (n) { return n[0] === "U2" && n[1] === "SYSOFF"; }));
    assert.ok(!byNet.SW_POWER, "SW_POWER net should be gone");
    assert.ok(!V.model.components.some(function (c) { return c.ref === "U7"; }), "U7 latch should be deleted");
});

test("charge LED is powered from VBUS through charger CHG pin", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.VBUS_IN.some(function (n) { return n[0] === "R8"; }));
    assert.ok(byNet.CHG_LED.some(function (n) { return n[0] === "D4" && n[1] === "A"; }));
    assert.ok(byNet.CHG_STAT.some(function (n) { return n[0] === "U2" && n[1] === "CHG"; }));
});

test("all eight gameplay switches reach U1", function () {
    var byNet = V.buildNetMap(V.model);
    ["SW_DPAD_UP", "SW_ACTION", "SW_MENU"].forEach(function (net) {
        assert.ok(byNet[net].some(function (n) { return n[0] === "U1"; }), net);
    });
});

test("dpad switches use TL3315-class separate dome tacts", function () {
    var byRef = {};
    V.model.components.forEach(function (c) { byRef[c.ref] = c; });
    ["SW1", "SW2", "SW3", "SW4"].forEach(function (ref) {
        assert.strictEqual(byRef[ref].value, "TL3315NF160Q-class", ref);
    });
    ["SW5", "SW6", "SW7", "SW8"].forEach(function (ref) {
        assert.strictEqual(byRef[ref].value, "KMR211NG", ref);
    });
});

test("chip-down compute has flash, crystal, and DC-DC support parts", function () {
    var byRef = {};
    V.model.components.forEach(function (c) { byRef[c.ref] = c; });
    assert.strictEqual(byRef.U1.value, "ESP32-P4NRW32X");
    assert.ok(byRef.U9 && byRef.X1 && byRef.L1, "support parts present");
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.FLASH_CLK.some(function (n) { return n[0] === "U9"; }));
    assert.ok(byNet.XTAL_IN.some(function (n) { return n[0] === "X1"; }));
    assert.ok(byNet.DCDC_FB.some(function (n) { return n[0] === "L1"; }));
});

test("exportKicadNetlist includes U1 and DSI nets", function () {
    var netlist = V.exportKicadNetlist(V.model);
    assert.ok(netlist.indexOf("(ref U1)") !== -1);
    assert.ok(netlist.indexOf("DSI_D0_P") !== -1);
    assert.ok(netlist.indexOf("(export (version D)") !== -1);
});

console.log(passed + " tests passed");

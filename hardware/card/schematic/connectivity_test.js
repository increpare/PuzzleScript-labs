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
    assert.ok(p33.indexOf("J3") !== -1);
    assert.ok(byNet.VBUS_IN.some(function (n) { return n[0] === "J1"; }));
    assert.ok(byNet["BAT+"].some(function (n) { return n[0] === "J2"; }));
});

test("all eight gameplay switches reach U1", function () {
    var byNet = V.buildNetMap(V.model);
    ["SW_DPAD_UP", "SW_ACTION", "SW_MENU"].forEach(function (net) {
        assert.ok(byNet[net].some(function (n) { return n[0] === "U1"; }), net);
    });
});

test("exportKicadNetlist includes U1 and DSI nets", function () {
    var netlist = V.exportKicadNetlist(V.model);
    assert.ok(netlist.indexOf("(ref U1)") !== -1);
    assert.ok(netlist.indexOf("DSI_D0_P") !== -1);
    assert.ok(netlist.indexOf("(export (version D)") !== -1);
});

console.log(passed + " tests passed");

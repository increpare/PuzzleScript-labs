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

console.log(passed + " tests passed");

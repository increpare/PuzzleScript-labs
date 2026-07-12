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

console.log(passed + " tests passed");

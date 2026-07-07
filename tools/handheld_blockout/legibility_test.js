"use strict";
var assert = require("assert");
var L = require("./legibility.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("levels have the spec's p90 and median dimensions", function () {
    assert.strictEqual(L.LEVEL_P90.length, 17);
    L.LEVEL_P90.forEach(function (row) { assert.strictEqual(row.length, 21); });
    assert.strictEqual(L.LEVEL_MEDIAN.length, 9);
    L.LEVEL_MEDIAN.forEach(function (row) { assert.strictEqual(row.length, 11); });
});

test("every level char is in the legend", function () {
    L.LEVEL_P90.concat(L.LEVEL_MEDIAN).forEach(function (row) {
        for (var i = 0; i < row.length; i++) {
            assert.ok(L.LEGEND[row.charAt(i)], "legend entry for " + row.charAt(i));
        }
    });
});

test("renderLevelSvg emits per-pixel rects at true scale", function () {
    var r = L.renderLevelSvg([".P"], 5);
    assert.strictEqual(r.w, 10);
    assert.strictEqual(r.h, 5);
    // background cell: 1 base + 22 green pixels; player cell: 23 + 16 player pixels
    assert.strictEqual(r.svg.split("<rect").length - 1, 62);
    assert.ok(r.svg.indexOf("#eb8931") !== -1, "player orange");
    assert.ok(r.svg.indexOf("#1d57f7") !== -1, "player blue");
});

console.log(passed + " tests passed");

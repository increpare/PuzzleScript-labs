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

test("loadFont returns 5x12 bitmap glyphs from src/js/font.js", function () {
    var font = L.loadFont();
    var rows = font.a.trim().split("\n");
    assert.strictEqual(rows.length, 12);
    assert.strictEqual(rows[0].length, 5);
});

test("TITLE_LINES fits the 34x13 terminal", function () {
    assert.strictEqual(L.TITLE_LINES.length, 13);
    L.TITLE_LINES.forEach(function (line) { assert.ok(line.length <= 34); });
});

test("renderTextScreenSvg sizes to the 34x13 grid and draws white pixels on black", function () {
    var font = L.loadFont();
    var t = L.renderTextScreenSvg(["hi"], 2.541, 3.985, font);
    assert.ok(Math.abs(t.w - 34 * 2.541) < 1e-9);
    assert.ok(Math.abs(t.h - 13 * 3.985) < 1e-9);
    assert.ok(t.svg.indexOf('fill="#000000"') !== -1, "black background");
    assert.ok(t.svg.indexOf('fill="#ffffff"') !== -1, "white glyph pixels");
});

console.log(passed + " tests passed");

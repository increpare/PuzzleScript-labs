"use strict";
var assert = require("assert");
var B = require("./blockout.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("card preset carries the approved spec coordinates", function () {
    assert.deepStrictEqual(Object.keys(B.BLOCKOUT_PRESETS), ["card"]);
    var c = B.BLOCKOUT_PRESETS.card;
    assert.strictEqual(c.body.w, 100);
    assert.strictEqual(c.body.h, 100);
    assert.strictEqual(c.body.r, 9);
    assert.strictEqual(c.body.depth, 9);
    assert.strictEqual(c.screen.activeX, 6.8);
    assert.strictEqual(c.screen.activeY, 7);
    assert.strictEqual(c.screen.activeW, 86.4);
    assert.strictEqual(c.screen.activeH, 51.8);
    assert.strictEqual(c.dpad.cx, 22);
    assert.strictEqual(c.dpad.cy, 76);
    assert.strictEqual(c.dpad.size, 26);
    assert.strictEqual(c.buttons[0].label, "ACTION");
    assert.strictEqual(c.buttons[0].d, 14);
    assert.strictEqual(c.buttons[1].cx, 67);
    assert.strictEqual(c.buttons[2].cy, 91);
    assert.strictEqual(c.menu.angle, -20);
    assert.strictEqual(c.band.y0, 61);
    assert.strictEqual(c.band.y1, 96);
    assert.deepStrictEqual(c.zones[0], { label: "battery 2.5Wh", x: 38, y: 64, w: 32, h: 26 });
    assert.strictEqual(c.topEdge.usbX, 25);
    assert.strictEqual(c.rightEdge.volY, 18);
});

test("getParam and setParam address nested values by dot path", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.card);
    assert.strictEqual(B.getParam(p, "buttons.1.cx"), 67);
    B.setParam(p, "buttons.1.cx", 70);
    assert.strictEqual(p.buttons[1].cx, 70);
    assert.strictEqual(B.BLOCKOUT_PRESETS.card.buttons[1].cx, 67, "preset untouched");
});

test("fmt trims float noise", function () {
    assert.strictEqual(B.fmt(0.1 + 0.2), "0.3");
    assert.strictEqual(B.fmt(76 - 58.8 - 13), "4.2");
    assert.strictEqual(B.fmt(100), "100");
});

test("circleGap measures edge-to-edge distance", function () {
    assert.strictEqual(B.circleGap(0, 0, 5, 20, 0, 5), 10);
});

test("rectCircleClearance measures circle edge to rect edge", function () {
    assert.strictEqual(B.rectCircleClearance(10, 10, 20, 20, 0, 10, 4), 6);
    assert.strictEqual(B.rectCircleClearance(10, 10, 20, 20, 15, 15, 4), -4);
});

test("rectRectOverlap reports minimal penetration depth", function () {
    assert.strictEqual(B.rectRectOverlap(
        { x: 0, y: 0, w: 10, h: 10 }, { x: 8, y: 0, w: 10, h: 10 }), 2);
    assert.strictEqual(B.rectRectOverlap(
        { x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }), 0);
});

test("card preset reports exactly the spec's known conflicts", function () {
    assert.deepStrictEqual(B.spacingWarnings(B.BLOCKOUT_PRESETS.card), [
        "D-PAD-MENU gap 0.5 mm (< 7 mm)",
        "D-PAD is 4.2 mm from the lens (< 5 mm)",
        "UNDO switch footprint overlaps the battery 2.5Wh zone",
        "battery 2.5Wh overlaps speaker by 2.5 mm",
        "speaker extends 2.5 mm below the control band"
    ]);
});

test("shrinking the battery clears the Undo overlap", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.card);
    B.setParam(p, "zones.0.w", 24); // battery spans X 38-62, clear of Undo cap edge at 62
    assert.deepStrictEqual(B.spacingWarnings(p), [
        "D-PAD-MENU gap 0.5 mm (< 7 mm)",
        "D-PAD is 4.2 mm from the lens (< 5 mm)",
        "battery 2.5Wh overlaps speaker by 2.5 mm",
        "speaker extends 2.5 mm below the control band"
    ]);
});

test("crowding the cluster produces a gap warning", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.card);
    B.setParam(p, "buttons.1.cx", 76);
    var w = B.spacingWarnings(p);
    assert.ok(w.some(function (msg) { return msg.indexOf("ACTION-UNDO gap") === 0; }),
        JSON.stringify(w));
});

test("faceSvg draws body, active area, module, and d-pad at spec coordinates", function () {
    var svg = B.faceSvg(B.BLOCKOUT_PRESETS.card, { grid: true });
    assert.ok(svg.indexOf('viewBox="-12 -12 124 124"') !== -1, "viewBox");
    assert.ok(svg.indexOf('x="6.8" y="7" width="86.4" height="51.8"') !== -1, "active area");
    assert.ok(svg.indexOf('x="4" y="3.5" width="92" height="59"') !== -1, "module outline");
    assert.ok(svg.indexOf('x="9" y="71.75" width="26" height="8.5"') !== -1, "d-pad h-arm");
    assert.ok(svg.indexOf('rotate(-20 22 95)') !== -1, "menu tilt");
    assert.ok(svg.indexOf('url(#grid10)') !== -1, "grid fill on");
});

test("faceSvg draws the 5x5 grille", function () {
    var svg = B.faceSvg(B.BLOCKOUT_PRESETS.card, {});
    var count = svg.split('r="0.4"').length - 1;
    assert.strictEqual(count, 25, "25 grille dots");
});

test("faceSvg overlays draw internal zones only when asked", function () {
    var withO = B.faceSvg(B.BLOCKOUT_PRESETS.card, { overlays: true });
    assert.ok(withO.indexOf("battery 2.5Wh") !== -1);
    var withoutO = B.faceSvg(B.BLOCKOUT_PRESETS.card, {});
    assert.strictEqual(withoutO.indexOf("battery 2.5Wh"), -1);
});

test("edgesSvg draws USB-C, power, FPC keep-out, and volume", function () {
    var svg = B.edgesSvg(B.BLOCKOUT_PRESETS.card);
    assert.ok(svg.indexOf("USB-C") !== -1);
    assert.ok(svg.indexOf("PWR") !== -1);
    assert.ok(svg.indexOf("FPC") !== -1);
    assert.ok(svg.indexOf("VOL") !== -1);
});

test("sectionSvg layer heights sum to the body depth", function () {
    var svg = B.sectionSvg(B.BLOCKOUT_PRESETS.card);
    assert.ok(svg.indexOf("front shell + lens 1.8") !== -1);
    assert.ok(svg.indexOf("rear shell 1.0") !== -1);
    assert.ok(svg.indexOf('height="9"') !== -1, "9 mm slab");
});

console.log(passed + " tests passed");

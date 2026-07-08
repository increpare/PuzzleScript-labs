"use strict";
var assert = require("assert");
var B = require("./blockout.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("card preset carries the WS24773 no-touch display envelope", function () {
    assert.deepStrictEqual(Object.keys(B.BLOCKOUT_PRESETS), ["card"]);
    var c = B.BLOCKOUT_PRESETS.card;
    assert.strictEqual(c.body.w, 120);
    assert.strictEqual(c.body.h, 110);
    assert.strictEqual(c.body.r, 9);
    assert.strictEqual(c.body.depth, 9);
    assert.strictEqual(c.screen.moduleW, 105.42);
    assert.strictEqual(c.screen.moduleH, 67.07);
    assert.strictEqual(c.screen.activeX, 12.5);
    assert.strictEqual(c.screen.activeY, 10);
    assert.strictEqual(c.screen.activeW, 95);
    assert.strictEqual(c.screen.activeH, 54);
    assert.strictEqual(c.dpad.cx, 22);
    assert.strictEqual(c.dpad.cy, 87);
    assert.strictEqual(c.dpad.size, 26);
    assert.strictEqual(c.buttons[0].label, "ACTION");
    assert.strictEqual(c.buttons[0].d, 14);
    assert.strictEqual(c.buttons[1].cx, 75);
    assert.strictEqual(c.buttons[2].cy, 102);
    assert.strictEqual(c.menu.angle, -20);
    assert.strictEqual(c.band.y0, 72);
    assert.strictEqual(c.band.y1, 105);
    assert.deepStrictEqual(c.zones[0], { label: "battery 2.5Wh", x: 37, y: 73, w: 32, h: 30 });
    assert.deepStrictEqual(c.piezo, { cx: 53, cy: 99, d: 18 });
    assert.strictEqual(c.topEdge.usbX, 25);
    assert.strictEqual(c.topEdge.pwrX, 113);
    assert.strictEqual(c.rightEdge.volY, 18);
});

test("active area is centered in the display module outline", function () {
    var s = B.BLOCKOUT_PRESETS.card.screen;
    var mx = (s.moduleW - s.activeW) / 2;
    var my = (s.moduleH - s.activeH) / 2;
    assert.ok(Math.abs(s.activeX - (s.moduleX + mx)) < 0.05);
    assert.ok(Math.abs(s.activeY - (s.moduleY + my)) < 0.05);
});

test("getParam and setParam address nested values by dot path", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.card);
    assert.strictEqual(B.getParam(p, "buttons.1.cx"), 75);
    B.setParam(p, "buttons.1.cx", 70);
    assert.strictEqual(p.buttons[1].cx, 70);
    assert.strictEqual(B.BLOCKOUT_PRESETS.card.buttons[1].cx, 75, "preset untouched");
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

test("amended card preset carries only the D-pad circle-model warnings", function () {
    assert.deepStrictEqual(B.spacingWarnings(B.BLOCKOUT_PRESETS.card), [
        "D-PAD-MENU gap 2.315 mm (< 7 mm)"
    ]);
});

test("widening the battery into the Undo cap produces an overlap warning", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.card);
    B.setParam(p, "zones.0.w", 40);
    assert.deepStrictEqual(B.spacingWarnings(p), [
        "D-PAD-MENU gap 2.315 mm (< 7 mm)",
        "UNDO switch footprint overlaps the battery 2.5Wh zone"
    ]);
});

test("crowding the cluster produces a gap warning", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.card);
    B.setParam(p, "buttons.1.cx", 84);
    var w = B.spacingWarnings(p);
    assert.ok(w.some(function (msg) { return msg.indexOf("ACTION-UNDO gap") === 0; }),
        JSON.stringify(w));
});

test("faceSvg draws body, active area, module, and d-pad at spec coordinates", function () {
    var svg = B.faceSvg(B.BLOCKOUT_PRESETS.card, { grid: true });
    assert.ok(svg.indexOf('viewBox="-12 -12 144 134"') !== -1, "viewBox");
    assert.ok(svg.indexOf('x="12.5" y="10" width="95" height="54"') !== -1, "active area");
    assert.ok(svg.indexOf('x="7.29" y="3.5" width="105.42" height="67.07"') !== -1, "module outline");
    assert.ok(svg.indexOf('x="9" y="82.75" width="26" height="8.5"') !== -1, "d-pad h-arm");
    assert.ok(svg.indexOf('rotate(-20 30.5 106)') !== -1, "menu tilt");
    assert.ok(svg.indexOf('url(#grid10)') !== -1, "grid fill on");
});

test("faceSvg overlays draw the piezo in the shell layer", function () {
    var svg = B.faceSvg(B.BLOCKOUT_PRESETS.card, { overlays: true });
    assert.ok(svg.indexOf("piezo (shell layer)") !== -1);
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

test("printSheetSvg is A4 landscape 1:1 with calibration bar", function () {
    var svg = B.printSheetSvg(B.BLOCKOUT_PRESETS.card);
    assert.ok(svg.indexOf('width="297mm" height="210mm" viewBox="0 0 297 210"') !== -1, "A4 1:1");
    assert.ok(svg.indexOf('x1="162" y1="14" x2="262" y2="14"') !== -1, "100 mm bar");
    assert.ok(svg.indexOf("exactly 100 mm") !== -1);
    assert.ok(svg.indexOf('translate(24,40)') !== -1, "face placed");
    assert.ok(svg.indexOf('translate(160,45)') !== -1, "top edge placed");
});

test("printSheetSvg lists the current spacing warnings", function () {
    var svg = B.printSheetSvg(B.BLOCKOUT_PRESETS.card);
    assert.ok(svg.indexOf("D-PAD-MENU gap 2.315 mm") !== -1, "warnings printed on sheet");
});

console.log(passed + " tests passed");

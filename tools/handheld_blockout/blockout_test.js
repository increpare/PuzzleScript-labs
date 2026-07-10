"use strict";
var assert = require("assert");
var B = require("./blockout.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("card preset carries the WS24773 no-touch display envelope", function () {
    assert.deepStrictEqual(Object.keys(B.BLOCKOUT_PRESETS), ["card"]);
    var c = B.BLOCKOUT_PRESETS.card;
    assert.strictEqual(c.name, "PuzzleScript Card 4.3in (WS24773 no-touch, reset one-pouch)");
    assert.strictEqual(c.body.w, 120);
    assert.strictEqual(c.body.h, 110);
    assert.strictEqual(c.body.r, 9);
    assert.strictEqual(c.body.depth, 11.5);
    assert.strictEqual(c.depthProfile.display, 9.5);
    assert.strictEqual(c.depthProfile.band, 11.5);
    assert.strictEqual(c.architecture, "two_sided");
    assert.strictEqual(c.screen.moduleW, 105.42);
    assert.strictEqual(c.screen.moduleH, 67.07);
    assert.strictEqual(c.screen.activeX, 12.5);
    assert.strictEqual(c.screen.activeY, 10);
    assert.strictEqual(c.screen.activeW, 95);
    assert.strictEqual(c.screen.activeH, 54);
    assert.strictEqual(c.dpad.cx, 22);
    assert.strictEqual(c.dpad.cy, 87);
    assert.strictEqual(c.dpad.size, 26);
    assert.strictEqual(c.dpad.style, "separate_dome");
    assert.strictEqual(c.dpad.switch, "TL3315NF160Q-class");
    assert.strictEqual(c.dpad.spacing, 17.5);
    assert.strictEqual(c.dpad.openingD, 7);
    assert.strictEqual(c.dpad.switchH, 1.2);
    assert.strictEqual(c.buttons[0].label, "ACTION");
    assert.strictEqual(c.buttons[0].d, 14);
    assert.strictEqual(c.buttons[1].cx, 75);
    assert.strictEqual(c.buttons[2].cy, 102);
    assert.strictEqual(c.menu.cx, 58);
    assert.strictEqual(c.menu.cy, 101);
    assert.strictEqual(c.menu.angle, -20);
    assert.strictEqual(c.band.y0, 72);
    assert.strictEqual(c.band.y1, 105);
    assert.deepStrictEqual(c.zones[0], { label: "LRA", x: 96, y: 87, w: 8, h: 8, face: "front" });
    assert.strictEqual(c.backZones.length, 4);
    assert.deepStrictEqual(c.supports.map(function (z) { return z.label; }),
        ["DPAD_SUPPORT", "ACTION_SUPPORT"]);
    assert.deepStrictEqual(c.supports[0],
        { label: "DPAD_SUPPORT", x: 18, y: 83, w: 8, h: 8, face: "front", role: "center_standoff_pad" });
    assert.strictEqual(c.backZones[0].label, "BAT_1S_POUCH");
    assert.strictEqual(c.backZones[0].x, 31);
    assert.strictEqual(c.backZones[0].y, 73);
    assert.strictEqual(c.backZones[0].w, 58);
    assert.strictEqual(c.backZones[0].h, 30);
    assert.strictEqual(c.backZones[0].role, "battery");
    assert.ok(c.backZones[0].cell.indexOf("403048-class") !== -1);
    assert.deepStrictEqual(c.backZones[1], {
        label: "ESP32-P4 chip-down", x: 50, y: 45.5, w: 20, h: 20, role: "compute"
    });
    assert.deepStrictEqual(c.backZones[2], {
        label: "PMIC cluster", x: 76, y: 57, w: 22, h: 11, role: "power"
    });
    assert.deepStrictEqual(c.backZones[3], {
        label: "USB_C_BACK", x: 18, y: 2, w: 14, h: 9, role: "connector"
    });
    assert.ok(c.backZones[1].y + c.backZones[1].h < c.backZones[0].y);
    assert.strictEqual(c.backZones.some(function (z) { return z.label.indexOf("BAT_L") !== -1; }), false);
    assert.strictEqual(c.backZones.some(function (z) { return z.label.indexOf("BAT_R") !== -1; }), false);
    assert.deepStrictEqual(c.piezo, { cx: 60, cy: 86, d: 18 });
    assert.strictEqual(c.topEdge.usbX, 25);
    assert.strictEqual(c.topEdge.pwrX, 106);
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

test("dpad helpers describe separate dome button envelope", function () {
    var d = B.BLOCKOUT_PRESETS.card.dpad;
    assert.strictEqual(B.dpadOffset(d), 8.75);
    assert.strictEqual(B.dpadOuterRadius(d), 12.25);
    assert.deepStrictEqual(B.dpadButtonCenters(d), [
        { label: "DPAD_UP", cx: 22, cy: 78.25 },
        { label: "DPAD_DOWN", cx: 22, cy: 95.75 },
        { label: "DPAD_LEFT", cx: 13.25, cy: 87 },
        { label: "DPAD_RIGHT", cx: 30.75, cy: 87 }
    ]);
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

test("reset one-pouch preset has no front-face spacing warnings", function () {
    assert.deepStrictEqual(B.spacingWarnings(B.BLOCKOUT_PRESETS.card), []);
});

test("centered piezo shell pad clears the menu cap", function () {
    var c = B.BLOCKOUT_PRESETS.card;
    var menuProxyR = Math.max(c.menu.w, c.menu.h) / 2;
    var gap = B.circleGap(c.piezo.cx, c.piezo.cy, c.piezo.d / 2,
        c.menu.cx, c.menu.cy, menuProxyR);
    assert.strictEqual(c.piezo.cx, c.body.w / 2);
    assert.strictEqual(c.piezo.cy, 86);
    assert.deepStrictEqual(c.grille, { cx: c.piezo.cx, cy: c.piezo.cy });
    assert.ok(gap >= 0.5, "piezo/menu gap " + B.fmt(gap) + " mm");
});

test("reset back-side mass layout keeps one pouch low with compute above it", function () {
    var c = B.BLOCKOUT_PRESETS.card;
    var pouch = c.backZones.filter(function (z) { return z.role === "battery"; })[0];
    var esp = c.backZones.filter(function (z) { return z.role === "compute"; })[0];
    var pmic = c.backZones.filter(function (z) { return z.role === "power"; })[0];
    assert.ok(pouch.x < c.body.w / 2 && pouch.x + pouch.w > c.body.w / 2);
    assert.ok(pouch.y > c.band.y0);
    assert.ok(esp.y + esp.h < pouch.y);
    assert.ok(pmic.y + pmic.h < pouch.y);
    assert.strictEqual(c.backZones.filter(function (z) { return z.role === "battery"; }).length, 1);
});

test("raising the rear pouch into the ESP keep-out produces an overlap warning", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.card);
    B.setParam(p, "backZones.0.y", 64);
    var w = B.spacingWarnings(p);
    assert.ok(w.some(function (msg) {
        return msg.indexOf("BAT_1S_POUCH") !== -1 && msg.indexOf("ESP32-P4") !== -1;
    }), JSON.stringify(w));
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
    assert.ok(svg.indexOf('cx="22" cy="78.25" r="3.5"') !== -1, "d-pad up dome");
    assert.ok(svg.indexOf('cx="13.25" cy="87" r="3.5"') !== -1, "d-pad left dome");
    assert.ok(svg.indexOf("TL3315 dome d-pad") !== -1, "d-pad label");
    assert.ok(svg.indexOf('rotate(-20 58 101)') !== -1, "menu tilt");
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
    assert.ok(withO.indexOf("LRA") !== -1);
    assert.ok(withO.indexOf("BAT_1S_POUCH") !== -1);
    assert.ok(withO.indexOf("ESP32-P4 chip-down") !== -1);
    assert.ok(withO.indexOf("PMIC cluster") !== -1);
    assert.ok(withO.indexOf("DPAD_SUPPORT") !== -1);
    var withoutO = B.faceSvg(B.BLOCKOUT_PRESETS.card, {});
    assert.strictEqual(withoutO.indexOf("BAT_1S_POUCH"), -1);
    assert.strictEqual(withoutO.indexOf("ESP32-P4 chip-down"), -1);
    assert.strictEqual(withoutO.indexOf("PMIC cluster"), -1);
});

test("edgesSvg draws USB-C, power, FPC keep-out, and volume", function () {
    var svg = B.edgesSvg(B.BLOCKOUT_PRESETS.card);
    assert.ok(svg.indexOf("USB-C") !== -1);
    assert.ok(svg.indexOf("PWR") !== -1);
    assert.ok(svg.indexOf("FPC") !== -1);
    assert.ok(svg.indexOf("VOL") !== -1);
});

test("sectionSvg layer heights use stepped reset profile", function () {
    var svg = B.sectionSvg(B.BLOCKOUT_PRESETS.card);
    assert.ok(svg.indexOf("front shell + button guidance 1.5") !== -1);
    assert.ok(svg.indexOf("TL3315 dome tact 1.2") !== -1);
    assert.ok(svg.indexOf("403048 pouch baseline 4.0") !== -1);
    assert.ok(svg.indexOf('height="11.5"') !== -1, "11.5 mm band slab");
});

test("printSheetSvg is A4 landscape 1:1 with calibration bar", function () {
    var svg = B.printSheetSvg(B.BLOCKOUT_PRESETS.card);
    assert.ok(svg.indexOf('width="297mm" height="210mm" viewBox="0 0 297 210"') !== -1, "A4 1:1");
    assert.ok(svg.indexOf('x1="162" y1="14" x2="262" y2="14"') !== -1, "100 mm bar");
    assert.ok(svg.indexOf("exactly 100 mm") !== -1);
    assert.ok(svg.indexOf('translate(24,40)') !== -1, "face placed");
    assert.ok(svg.indexOf('translate(160,45)') !== -1, "top edge placed");
});

test("printSheetSvg lists spacing warnings when present", function () {
    var svg = B.printSheetSvg(B.BLOCKOUT_PRESETS.card);
    assert.ok(svg.indexOf("open geometry warnings") !== -1, "warnings section on sheet");
});

console.log(passed + " tests passed");

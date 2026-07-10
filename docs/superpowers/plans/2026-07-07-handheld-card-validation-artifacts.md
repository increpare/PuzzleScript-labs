# Handheld Card Validation Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the software-producible validation artifacts for the approved compact card spec: a parametric blockout tool with geometry warnings, a printable 1:1 card sheet, and a printable legibility sheet with real-sprite level renders and real-font text renders at true millimeter scale.

**Architecture:** Two pure-logic JS modules under `tools/handheld_blockout/` — `blockout.js` (card preset, geometry checks, face/edge/section SVG, 1:1 print sheet) and `legibility.js` (sokoban sprites, PuzzleScript font loader, level/text renders, legibility print sheet). Both use browser-global style plus a `module.exports` guard so plain Node can unit-test them with `assert`. `index.html` is a thin UI shell over `blockout.js` only (`legibility.js` is Node-only because it reads `src/js/font.js` from disk). A small Node script generates the two committed SVG sheets in `docs/superpowers/notes/`.

**Tech Stack:** Vanilla JS (ES5-style, matching repo idiom), SVG, Node `assert` for tests. No dependencies, no build step.

**Context:** All coordinates come verbatim from the approved spec
`docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`. The print
sheet format matches the committed 5-inch sheet
(`docs/superpowers/notes/2026-07-07-handheld-case-blockout-1to1.svg`): A4
landscape, 1:1, 100 mm calibration bar. This plan supersedes
`docs/superpowers/plans/2026-07-07-handheld-blockout-tool.md` (written for the
superseded 5-inch spec, never executed).

## Global Constraints

- Card geometry is copied verbatim from the card spec: body 100 x 100 x 9 mm r9; active area 86.4 x 51.8 at (6.8, 7); D-pad 26 mm at (22, 76); Action O14 (81, 72); Undo O10 (67, 85); Restart O10 (84, 91); Menu 11 x 4 pill at (22, 95) angled -20 deg; band Y 61-96; battery 32 x 26 at (38, 64); speaker 15 x 11 centered (50, 93); cap-gap minimum 7 mm.
- The card preset intentionally reproduces the spec's numbers **including known conflicts** (Menu clearance, battery/Undo overlap, speaker band overrun). The warning list is the deliverable. Do NOT adjust preset geometry to silence warnings; the tests lock the expected warning list.
- The tool lives in `tools/handheld_blockout/`, outside `src/` — `compile.js` copies `src/` to `bin/` and must not pick this up.
- Vanilla ES5-style JS, no dependencies, no build step. Tests are plain Node scripts using `assert`, run with `node <file>`.
- Print sheets are A4 landscape 1:1: `width="297mm" height="210mm" viewBox="0 0 297 210"` with a 100 mm calibration bar.
- All commands run from the repository root.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File Structure

- Create: `tools/handheld_blockout/blockout.js` — card preset, param helpers, geometry checks, SVG generation, 1:1 print sheet. Pure functions, no DOM, no `fs`.
- Create: `tools/handheld_blockout/blockout_test.js` — Node test script.
- Create: `tools/handheld_blockout/legibility.js` — sprite/palette data, font loader (`fs`, Node-only), level and text renderers, legibility print sheet.
- Create: `tools/handheld_blockout/legibility_test.js` — Node test script.
- Create: `tools/handheld_blockout/generate_sheets.js` — writes the two committed SVGs into `docs/superpowers/notes/`.
- Create: `tools/handheld_blockout/index.html` — UI shell; loads `blockout.js` via `<script>`; works from `file://`.
- Create: `tools/handheld_blockout/README.md`.
- Generate: `docs/superpowers/notes/2026-07-07-handheld-card-1to1.svg` and `docs/superpowers/notes/2026-07-07-handheld-card-legibility.svg`.
- Modify: `docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md` (Validation Plan step 1).
- Modify: `docs/superpowers/plans/2026-07-07-handheld-blockout-tool.md` (superseded note at top).

---

### Task 1: Card preset and param helpers

**Files:**
- Create: `tools/handheld_blockout/blockout.js`
- Create: `tools/handheld_blockout/blockout_test.js`

**Interfaces:**
- Produces: `BLOCKOUT_PRESETS.card` (shape shown in Step 3), `cloneParams(p)`, `getParam(obj, path)`, `setParam(obj, path, value)`, `fmt(n) -> string`.

- [ ] **Step 1: Write the failing test**

Create `tools/handheld_blockout/blockout_test.js`:

```js
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

console.log(passed + " tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: FAIL with `Cannot find module './blockout.js'`

- [ ] **Step 3: Write minimal implementation**

Create `tools/handheld_blockout/blockout.js`:

```js
"use strict";

// Parametric blockout model for the PuzzleScript Card handheld.
// Coordinates are millimeters from the top-left corner of the front face.
// Spec: docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md
// The card preset reproduces the spec verbatim, including its known
// conflicts (Menu clearance, battery/Undo overlap, speaker band overrun).
// Those conflicts are supposed to appear as warnings; do not tune them away.

var BLOCKOUT_PRESETS = {
    card: {
        name: "PuzzleScript Card (approved 2026-07-07)",
        body: { w: 100, h: 100, r: 9, depth: 9 },
        screen: {
            activeX: 6.8, activeY: 7, activeW: 86.4, activeH: 51.8,
            moduleX: 4, moduleY: 3.5, moduleW: 92, moduleH: 59
        },
        // 26 mm mascot cap (chevron tip to tip), one-piece rocker underneath
        dpad: { cx: 22, cy: 76, size: 26, arm: 8.5 },
        buttons: [
            { label: "ACTION", cx: 81, cy: 72, d: 14 },
            { label: "UNDO", cx: 67, cy: 85, d: 10 },
            { label: "RESTART", cx: 84, cy: 91, d: 10 }
        ],
        menu: { cx: 22, cy: 95, w: 11, h: 4, angle: -20 },
        band: { y0: 61, y1: 96 },
        zones: [
            { label: "battery 2.5Wh", x: 38, y: 64, w: 32, h: 26 },
            { label: "speaker", x: 42.5, y: 87.5, w: 15, h: 11 },
            { label: "LRA", x: 90, y: 76, w: 8, h: 8 }
        ],
        grille: { cx: 50, cy: 93 },
        topEdge: { usbX: 25, pwrX: 88, fpcKeepOut: [38, 66] },
        rightEdge: { volY: 18 }
    }
};

function cloneParams(p) {
    return JSON.parse(JSON.stringify(p));
}

function getParam(obj, path) {
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
        cur = cur[parts[i]];
    }
    return cur;
}

function setParam(obj, path, value) {
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

function fmt(n) {
    return String(Math.round(n * 1000) / 1000);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        BLOCKOUT_PRESETS: BLOCKOUT_PRESETS,
        cloneParams: cloneParams,
        getParam: getParam,
        setParam: setParam,
        fmt: fmt
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `3 tests passed` (3 `ok -` lines, exit code 0)

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/blockout.js tools/handheld_blockout/blockout_test.js
git commit -m "Add card blockout preset and param helpers" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Geometry checks and spacing warnings

**Files:**
- Modify: `tools/handheld_blockout/blockout.js`
- Modify: `tools/handheld_blockout/blockout_test.js`

**Interfaces:**
- Consumes: `BLOCKOUT_PRESETS`, `cloneParams`, `setParam`, `fmt` from Task 1.
- Produces: `circleGap(ax, ay, ar, bx, by, br) -> number`, `rectCircleClearance(rx, ry, rw, rh, cx, cy, r) -> number`, `rectRectOverlap(a, b) -> number` (rects are `{x, y, w, h}`), `spacingWarnings(params) -> string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tools/handheld_blockout/blockout_test.js`, immediately before the final `console.log` line:

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: FAIL with `B.circleGap is not a function`

- [ ] **Step 3: Implement geometry checks**

In `tools/handheld_blockout/blockout.js`, insert after `fmt`:

```js
var MIN_CAP_GAP = 7;          // mm between button cap edges (printed-shell assumption)
var MIN_LENS_CLEARANCE = 5;   // mm from any cap edge to the display active area
var MIN_EDGE_CLEARANCE = 3;   // mm from any cap edge to the body outline

function circleGap(ax, ay, ar, bx, by, br) {
    return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)) - ar - br;
}

function rectCircleClearance(rx, ry, rw, rh, cx, cy, r) {
    var dx = Math.max(rx - cx, 0, cx - (rx + rw));
    var dy = Math.max(ry - cy, 0, cy - (ry + rh));
    return Math.sqrt(dx * dx + dy * dy) - r;
}

function rectRectOverlap(a, b) {
    var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (ox > 0 && oy > 0) ? Math.min(ox, oy) : 0;
}

function spacingWarnings(params) {
    var warnings = [];
    var circles = [{ label: "D-PAD", cx: params.dpad.cx, cy: params.dpad.cy, r: params.dpad.size / 2 }];
    params.buttons.forEach(function (b) {
        circles.push({ label: b.label, cx: b.cx, cy: b.cy, r: b.d / 2 });
    });
    // Menu is a flush low-profile pill: it participates in cap-gap checks
    // (widest extent) but is exempt from lens/edge/zone checks.
    circles.push({
        label: "MENU", cx: params.menu.cx, cy: params.menu.cy,
        r: Math.max(params.menu.w, params.menu.h) / 2, flush: true
    });
    var i, j;
    for (i = 0; i < circles.length; i++) {
        for (j = i + 1; j < circles.length; j++) {
            var gap = circleGap(circles[i].cx, circles[i].cy, circles[i].r,
                circles[j].cx, circles[j].cy, circles[j].r);
            if (gap < MIN_CAP_GAP) {
                warnings.push(circles[i].label + "-" + circles[j].label + " gap " + fmt(gap) +
                    " mm (< " + MIN_CAP_GAP + " mm)");
            }
        }
    }
    var s = params.screen;
    circles.forEach(function (c) {
        if (c.flush) {
            return;
        }
        var clear = rectCircleClearance(s.activeX, s.activeY, s.activeW, s.activeH,
            c.cx, c.cy, c.r);
        if (clear < MIN_LENS_CLEARANCE) {
            warnings.push(c.label + " is " + fmt(clear) + " mm from the lens (< " +
                MIN_LENS_CLEARANCE + " mm)");
        }
        if (c.cx - c.r < MIN_EDGE_CLEARANCE || c.cx + c.r > params.body.w - MIN_EDGE_CLEARANCE ||
            c.cy - c.r < MIN_EDGE_CLEARANCE || c.cy + c.r > params.body.h - MIN_EDGE_CLEARANCE) {
            warnings.push(c.label + " is closer than " + MIN_EDGE_CLEARANCE + " mm to the body edge");
        }
    });
    // Switch footprints (caps) need clear PCB; internal zones cannot sit under them.
    circles.forEach(function (c) {
        if (c.flush) {
            return;
        }
        params.zones.forEach(function (z) {
            if (rectCircleClearance(z.x, z.y, z.w, z.h, c.cx, c.cy, c.r) < 0) {
                warnings.push(c.label + " switch footprint overlaps the " + z.label + " zone");
            }
        });
    });
    for (i = 0; i < params.zones.length; i++) {
        for (j = i + 1; j < params.zones.length; j++) {
            var depth = rectRectOverlap(params.zones[i], params.zones[j]);
            if (depth > 0) {
                warnings.push(params.zones[i].label + " overlaps " + params.zones[j].label +
                    " by " + fmt(depth) + " mm");
            }
        }
    }
    params.zones.forEach(function (z) {
        if (z.y < params.band.y0) {
            warnings.push(z.label + " extends " + fmt(params.band.y0 - z.y) +
                " mm above the control band");
        }
        if (z.y + z.h > params.band.y1) {
            warnings.push(z.label + " extends " + fmt(z.y + z.h - params.band.y1) +
                " mm below the control band");
        }
    });
    return warnings;
}
```

Add to the `module.exports` object:

```js
        circleGap: circleGap,
        rectCircleClearance: rectCircleClearance,
        rectRectOverlap: rectRectOverlap,
        spacingWarnings: spacingWarnings,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `9 tests passed`

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/blockout.js tools/handheld_blockout/blockout_test.js
git commit -m "Add card blockout geometry checks and spacing warnings" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Face, edge, and Z-section SVG generation

**Files:**
- Modify: `tools/handheld_blockout/blockout.js`
- Modify: `tools/handheld_blockout/blockout_test.js`

**Interfaces:**
- Consumes: `fmt`, preset shape from Task 1.
- Produces: `faceSvg(params, opts) -> string` (opts: `{grid, overlays, scale}`), `edgesSvg(params) -> string`, `sectionSvg(params) -> string`, and internal group builders `faceGroupSvg(params, opts)`, `topEdgeGroupSvg(params)`, `rightEdgeGroupSvg(params)`, `sectionGroupSvg(params)` reused by Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `tools/handheld_blockout/blockout_test.js`, before the final `console.log`:

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: FAIL with `B.faceSvg is not a function`

- [ ] **Step 3: Implement SVG generation**

In `tools/handheld_blockout/blockout.js`, insert after `spacingWarnings`:

```js
var GRID_DEF = '<defs><pattern id="grid10" width="10" height="10" patternUnits="userSpaceOnUse">' +
    '<path d="M 10 0 L 0 0 L 0 10" fill="none" stroke="#c8c8c8" stroke-width="0.12"/></pattern></defs>';

function svgRect(x, y, w, h, r, stroke, fill, dash) {
    return '<rect x="' + fmt(x) + '" y="' + fmt(y) + '" width="' + fmt(w) + '" height="' + fmt(h) +
        '" rx="' + fmt(r) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="0.4"' +
        (dash ? ' stroke-dasharray="2,1.5"' : "") + "/>";
}

function svgText(x, y, size, s, anchor) {
    return '<text x="' + fmt(x) + '" y="' + fmt(y) + '" font-size="' + size +
        '" font-family="sans-serif" fill="#444" text-anchor="' + (anchor || "middle") + '">' + s + "</text>";
}

function crosshair(cx, cy) {
    return '<path d="M ' + fmt(cx - 2.5) + " " + fmt(cy) + " H " + fmt(cx + 2.5) +
        " M " + fmt(cx) + " " + fmt(cy - 2.5) + " V " + fmt(cy + 2.5) +
        '" stroke="#000" stroke-width="0.2" fill="none"/>';
}

function faceGroupSvg(params, opts) {
    var b = params.body, s = params.screen;
    var out = [svgRect(0, 0, b.w, b.h, b.r, "#000", opts.grid ? "url(#grid10)" : "none")];
    out.push(svgRect(s.moduleX, s.moduleY, s.moduleW, s.moduleH, 1, "#999", "none", true));
    out.push(svgRect(s.activeX, s.activeY, s.activeW, s.activeH, 0, "#000", "none"));
    out.push('<line x1="0" y1="' + fmt(params.band.y0) + '" x2="' + fmt(b.w) + '" y2="' +
        fmt(params.band.y0) + '" stroke="#999" stroke-width="0.2" stroke-dasharray="1.5,1.5"/>');
    var d = params.dpad;
    out.push(svgRect(d.cx - d.size / 2, d.cy - d.arm / 2, d.size, d.arm, 1.5, "#000", "none"));
    out.push(svgRect(d.cx - d.arm / 2, d.cy - d.size / 2, d.arm, d.size, 1.5, "#000", "none"));
    out.push(crosshair(d.cx, d.cy));
    params.buttons.forEach(function (btn) {
        out.push('<circle cx="' + fmt(btn.cx) + '" cy="' + fmt(btn.cy) + '" r="' + fmt(btn.d / 2) +
            '" fill="none" stroke="#000" stroke-width="0.4"/>');
        out.push(crosshair(btn.cx, btn.cy));
        out.push(svgText(btn.cx, btn.cy + btn.d / 2 + 3, 2.4, btn.label + " Ø" + fmt(btn.d)));
    });
    var m = params.menu;
    out.push('<g transform="rotate(' + fmt(m.angle) + " " + fmt(m.cx) + " " + fmt(m.cy) + ')">' +
        svgRect(m.cx - m.w / 2, m.cy - m.h / 2, m.w, m.h, m.h / 2, "#000", "none") + "</g>");
    var g = params.grille;
    for (var gy = -2; gy <= 2; gy++) {
        for (var gx = -2; gx <= 2; gx++) {
            out.push('<circle cx="' + fmt(g.cx + gx * 2) + '" cy="' + fmt(g.cy + gy * 2) +
                '" r="0.4" fill="none" stroke="#000" stroke-width="0.2"/>');
        }
    }
    if (opts.overlays) {
        params.zones.forEach(function (z) {
            out.push(svgRect(z.x, z.y, z.w, z.h, 1.5, "#c77", "none", true));
            out.push(svgText(z.x + z.w / 2, z.y + z.h / 2 + 1, 2.4, z.label));
        });
    }
    return out.join("\n");
}

function topEdgeGroupSvg(params) {
    var b = params.body, t = params.topEdge;
    var out = [svgRect(0, 0, b.w, b.depth, 3, "#000", "none")];
    out.push(svgRect(t.usbX - 4.5, (b.depth - 3.2) / 2, 9, 3.2, 1.6, "#000", "none"));
    out.push(svgText(t.usbX, -1.5, 2.4, "USB-C"));
    out.push(svgRect(t.pwrX - 5, (b.depth - 3) / 2, 10, 3, 1.5, "#000", "none"));
    out.push(svgText(t.pwrX, -1.5, 2.4, "PWR"));
    if (t.fpcKeepOut) {
        for (var i = 0; i < 2; i++) {
            out.push('<line x1="' + fmt(t.fpcKeepOut[i]) + '" y1="1" x2="' + fmt(t.fpcKeepOut[i]) +
                '" y2="' + fmt(b.depth - 1) + '" stroke="#999" stroke-width="0.25" stroke-dasharray="1.5,1.5"/>');
        }
        out.push(svgText((t.fpcKeepOut[0] + t.fpcKeepOut[1]) / 2, -1.5, 2.4, "FPC keep-out"));
    }
    out.push(svgText(0, b.depth + 4, 2.2, "top edge", "start"));
    return out.join("\n");
}

function rightEdgeGroupSvg(params) {
    var b = params.body, e = params.rightEdge;
    var out = [svgRect(0, 0, b.h, b.depth, 3, "#000", "none")];
    out.push(svgRect(e.volY - 9, (b.depth - 3) / 2, 18, 3, 1.5, "#000", "none"));
    out.push(svgText(e.volY, -1.5, 2.4, "VOL -/+"));
    out.push(svgText(0, b.depth + 4, 2.2, "right edge (device top at left)", "start"));
    return out.join("\n");
}

function sectionGroupSvg(params) {
    // Z-stack side section, 1:1. X spans the card; Y is the 9 mm thickness.
    var b = params.body;
    var layers = [
        { y: 0, h: 1.8, label: "front shell + lens 1.8" },
        { y: 1.8, h: 1.0, label: "clearance 1.0" },
        { y: 2.8, h: 4.0, label: "components on PCB face: battery 4.0 / panel 2.5" },
        { y: 6.8, h: 1.2, label: "PCB 1.2" },
        { y: 8.0, h: 1.0, label: "rear shell 1.0" }
    ];
    var out = [svgRect(0, 0, b.w, b.depth, 2, "#000", "none")];
    layers.forEach(function (l) {
        out.push('<line x1="0" y1="' + fmt(l.y) + '" x2="' + fmt(b.w) + '" y2="' + fmt(l.y) +
            '" stroke="#888" stroke-width="0.15"/>');
        out.push(svgText(b.w + 3, l.y + l.h / 2 + 0.9, 2.2, l.label, "start"));
    });
    out.push(svgText(0, b.depth + 4, 2.2, "Z-stack section, 1:1", "start"));
    return out.join("\n");
}

function faceSvg(params, opts) {
    opts = opts || {};
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + fmt(124 * (opts.scale || 4)) +
        '" viewBox="-12 -12 124 124">'];
    out.push(GRID_DEF);
    out.push(faceGroupSvg(params, opts));
    out.push("</svg>");
    return out.join("\n");
}

function edgesSvg(params) {
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="496" viewBox="-12 -8 124 52">'];
    out.push(topEdgeGroupSvg(params));
    out.push('<g transform="translate(0,26)">' + rightEdgeGroupSvg(params) + "</g>");
    out.push("</svg>");
    return out.join("\n");
}

function sectionSvg(params) {
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="600" viewBox="-12 -6 150 24">'];
    out.push(sectionGroupSvg(params));
    out.push("</svg>");
    return out.join("\n");
}
```

Add to the `module.exports` object:

```js
        faceSvg: faceSvg,
        edgesSvg: edgesSvg,
        sectionSvg: sectionSvg,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `14 tests passed`

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/blockout.js tools/handheld_blockout/blockout_test.js
git commit -m "Add card blockout face, edge, and Z-section SVG generation" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Printable 1:1 sheet

**Files:**
- Modify: `tools/handheld_blockout/blockout.js`
- Modify: `tools/handheld_blockout/blockout_test.js`

**Interfaces:**
- Consumes: `faceGroupSvg`, `topEdgeGroupSvg`, `rightEdgeGroupSvg`, `sectionGroupSvg`, `spacingWarnings`, `fmt`, `GRID_DEF`, `svgText` from Tasks 2-3.
- Produces: `printSheetSvg(params) -> string` (A4 landscape, 1:1).

- [ ] **Step 1: Write the failing tests**

Append to `tools/handheld_blockout/blockout_test.js`, before the final `console.log`:

```js
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
    assert.ok(svg.indexOf("D-PAD-MENU gap 0.5 mm") !== -1, "warnings printed on sheet");
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: FAIL with `B.printSheetSvg is not a function`

- [ ] **Step 3: Implement the print sheet**

In `tools/handheld_blockout/blockout.js`, insert after `sectionSvg`:

```js
function printSheetSvg(params) {
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'];
    out.push(GRID_DEF);
    out.push(svgText(24, 10, 4.2, params.name +
        " — blockout 1:1. Print at 100% scale, A4 landscape.", "start"));
    out.push('<g stroke="#000" stroke-width="0.3">');
    out.push('<line x1="162" y1="14" x2="262" y2="14"/>');
    for (var t = 0; t <= 100; t += 10) {
        var tick = (t % 50 === 0) ? 3 : 1.5;
        out.push('<line x1="' + (162 + t) + '" y1="' + (14 - tick) + '" x2="' + (162 + t) +
            '" y2="' + (14 + tick) + '"/>');
    }
    out.push("</g>");
    out.push(svgText(212, 9.5, 3.2, "calibration: this bar must measure exactly 100 mm"));
    out.push('<g transform="translate(24,40)">' + faceGroupSvg(params, { grid: true, overlays: true }) + "</g>");
    out.push('<g transform="translate(160,45)">' + topEdgeGroupSvg(params) + "</g>");
    out.push('<g transform="translate(160,75)">' + rightEdgeGroupSvg(params) + "</g>");
    out.push('<g transform="translate(160,105)">' + sectionGroupSvg(params) + "</g>");
    var warnings = spacingWarnings(params);
    out.push(svgText(160, 135, 3.2, "open geometry warnings (spec risks, expected):", "start"));
    warnings.forEach(function (w, i) {
        out.push(svgText(160, 140 + i * 4.5, 2.8, "- " + w, "start"));
    });
    out.push("</svg>");
    return out.join("\n");
}
```

Add to the `module.exports` object (ensure no trailing-comma syntax error after the final entry):

```js
        printSheetSvg: printSheetSvg
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `16 tests passed`

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/blockout.js tools/handheld_blockout/blockout_test.js
git commit -m "Add card blockout printable 1:1 sheet" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Legibility module — sprites and level rendering

**Files:**
- Create: `tools/handheld_blockout/legibility.js`
- Create: `tools/handheld_blockout/legibility_test.js`

**Interfaces:**
- Produces: `PALETTE`, `SPRITES`, `LEGEND`, `LEVEL_P90` (17 rows x 21 chars), `LEVEL_MEDIAN` (9 rows x 11 chars), `renderLevelSvg(rows, cellMm) -> {svg, w, h}`.

**Background:** cell sizes come from the card spec: on the 4.0-inch 800x480
panel one pixel is 0.108 mm, so a 25 px tile is 2.7 mm; the retired 5-inch
panel had 0.13625 mm pixels, so the same tile was 3.4 mm — the sheet prints
both for A/B comparison. Sprites are the Simple Block Pushing Game objects
from `src/demo/sokoban_basic.txt`; colors are the `arnecolors` values from
`src/js/colors.js`. The level layouts are density proxies for legibility
testing, not solvable puzzles.

- [ ] **Step 1: Write the failing test**

Create `tools/handheld_blockout/legibility_test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/handheld_blockout/legibility_test.js`
Expected: FAIL with `Cannot find module './legibility.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/handheld_blockout/legibility.js`:

```js
"use strict";

// Legibility-sheet renderer for the PuzzleScript Card spec.
// Sprites: Simple Block Pushing Game (src/demo/sokoban_basic.txt).
// Colors: arnecolors palette (src/js/colors.js).
// Node-only: loadFont() reads src/js/font.js from disk.

var PALETTE = {
    black: "#000000", white: "#ffffff",
    lightgreen: "#a3ce27", green: "#44891a",
    darkblue: "#1B2632", brown: "#a46422", darkbrown: "#493c2b",
    orange: "#eb8931", blue: "#1d57f7"
};

var SPRITES = {
    background: { colors: ["lightgreen", "green"],
        rows: ["11111", "01111", "11101", "11111", "10111"] },
    target: { colors: ["darkblue"],
        rows: [".....", ".000.", ".0.0.", ".000.", "....."] },
    wall: { colors: ["brown", "darkbrown"],
        rows: ["00010", "11111", "01000", "11111", "00010"] },
    player: { colors: ["black", "orange", "white", "blue"],
        rows: [".000.", ".111.", "22222", ".333.", ".3.3."] },
    crate: { colors: ["orange"],
        rows: ["00000", "0...0", "0...0", "0...0", "00000"] }
};

var LEGEND = {
    ".": ["background"],
    "#": ["background", "wall"],
    "P": ["background", "player"],
    "*": ["background", "crate"],
    "@": ["background", "target", "crate"],
    "O": ["background", "target"]
};

// Density proxies for legibility testing, not solvable puzzles.
var LEVEL_P90 = [
    "#####################",
    "#...#....O....#.....#",
    "#.*.#..#####..#..*..#",
    "#...#..#O..#..#.....#",
    "##.###.#.*.#..###.###",
    "#..O...#...#....#...#",
    "#..#####.#######.#..#",
    "#..#...*.....O#..#..#",
    "#..#..#####...#..*..#",
    "#.....#O..#.#.##..###",
    "###.#.#.*.#.#..#....#",
    "#...#.#...#.##.####.#",
    "#.#.#.###.#..#....#.#",
    "#.#....O#.#..##.#.#.#",
    "#.#..*..#.#P..*.#...#",
    "#....#..#....O..#.#.#",
    "#####################"
];

var LEVEL_MEDIAN = [
    "###########",
    "#....#....#",
    "#.*..O..#.#",
    "#..#....*.#",
    "#.O.##P...#",
    "#....#..O.#",
    "#.*....#..#",
    "#......O*.#",
    "###########"
];

function fmt(n) {
    return String(Math.round(n * 1000) / 1000);
}

function renderLevelSvg(rows, cellMm) {
    var out = [];
    var px = cellMm / 5;
    for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].length; c++) {
            var stack = LEGEND[rows[r].charAt(c)];
            var x0 = c * cellMm, y0 = r * cellMm;
            out.push('<rect x="' + fmt(x0) + '" y="' + fmt(y0) + '" width="' + fmt(cellMm) +
                '" height="' + fmt(cellMm) + '" fill="' +
                PALETTE[SPRITES[stack[0]].colors[0]] + '"/>');
            for (var s = 0; s < stack.length; s++) {
                var sp = SPRITES[stack[s]];
                for (var y = 0; y < 5; y++) {
                    for (var x = 0; x < 5; x++) {
                        var ch = sp.rows[y].charAt(x);
                        if (ch === "." || (s === 0 && ch === "0")) {
                            continue;
                        }
                        out.push('<rect x="' + fmt(x0 + x * px) + '" y="' + fmt(y0 + y * px) +
                            '" width="' + fmt(px) + '" height="' + fmt(px) + '" fill="' +
                            PALETTE[sp.colors[+ch]] + '"/>');
                    }
                }
            }
        }
    }
    return { svg: out.join("\n"), w: rows[0].length * cellMm, h: rows.length * cellMm };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        PALETTE: PALETTE,
        SPRITES: SPRITES,
        LEGEND: LEGEND,
        LEVEL_P90: LEVEL_P90,
        LEVEL_MEDIAN: LEVEL_MEDIAN,
        renderLevelSvg: renderLevelSvg,
        fmt: fmt
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/handheld_blockout/legibility_test.js`
Expected: `3 tests passed`

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/legibility.js tools/handheld_blockout/legibility_test.js
git commit -m "Add legibility sprite data and true-scale level rendering" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Legibility module — font loading and text-screen rendering

**Files:**
- Modify: `tools/handheld_blockout/legibility.js`
- Modify: `tools/handheld_blockout/legibility_test.js`

**Interfaces:**
- Consumes: `fmt` from Task 5.
- Produces: `loadFont() -> object` (map of char to 12-row x 5-col glyph string, loaded from `src/js/font.js`), `TITLE_LINES` (13 strings), `renderTextScreenSvg(lines, cellW, cellH, font) -> {svg, w, h}`.

**Background:** `src/js/font.js` declares `let font = { 'a': "\n00000\n..." }`
with 5-wide, 12-tall bitmap glyphs. It is a browser-global script, so load it
by reading the file and evaluating it with `new Function(src + "; return font;")()`.
The 34x13 text grid on the 86.4 x 51.8 mm active area gives a char cell of
2.541 x 3.985 mm (86.4/34 x 51.8/13). The font has lowercase glyphs; keep
`TITLE_LINES` lowercase and fall back via `toLowerCase()` when a char is
missing. This is a print-legibility proxy for the engine's text screens, not
a pixel-exact replica of engine text scaling.

- [ ] **Step 1: Write the failing tests**

Append to `tools/handheld_blockout/legibility_test.js`, before the final `console.log`:

```js
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
```

(The file's existing final `console.log(passed + " tests passed")` line stays below the appended tests.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tools/handheld_blockout/legibility_test.js`
Expected: FAIL with `L.loadFont is not a function`

- [ ] **Step 3: Write the implementation**

In `tools/handheld_blockout/legibility.js`, add at the top after `"use strict";`:

```js
var fs = require("fs");
var path = require("path");
```

Insert after `renderLevelSvg`:

```js
function loadFont() {
    var p = path.join(__dirname, "..", "..", "src", "js", "font.js");
    var src = fs.readFileSync(p, "utf8");
    return new Function(src + "\n;return font;")();
}

// Representative title screen (approximates the engine's 34x13 terminal).
var TITLE_LINES = [
    "",
    "",
    "",
    "    simple block pushing game",
    "",
    "         by david skinner",
    "",
    "       www.puzzlescript.net",
    "",
    "",
    "    arrow keys to move, x to act",
    "      z to undo, r to restart",
    ""
];

function renderTextScreenSvg(lines, cellW, cellH, font) {
    var cols = 34, rows = 13;
    var out = ['<rect x="0" y="0" width="' + fmt(cols * cellW) + '" height="' +
        fmt(rows * cellH) + '" fill="#000000"/>'];
    var pw = cellW / 5, ph = cellH / 12;
    for (var r = 0; r < rows; r++) {
        var line = lines[r] || "";
        for (var c = 0; c < cols; c++) {
            var ch = line.charAt(c);
            if (!ch || ch === " ") {
                continue;
            }
            var glyph = font[ch] || font[ch.toLowerCase()];
            if (!glyph) {
                continue;
            }
            var g = glyph.trim().split("\n");
            for (var y = 0; y < g.length; y++) {
                for (var x = 0; x < 5; x++) {
                    if (g[y].charAt(x) === "1") {
                        out.push('<rect x="' + fmt(c * cellW + x * pw) + '" y="' +
                            fmt(r * cellH + y * ph) + '" width="' + fmt(pw) + '" height="' +
                            fmt(ph) + '" fill="#ffffff"/>');
                    }
                }
            }
        }
    }
    return { svg: out.join("\n"), w: cols * cellW, h: rows * cellH };
}
```

Add to the `module.exports` object:

```js
        loadFont: loadFont,
        TITLE_LINES: TITLE_LINES,
        renderTextScreenSvg: renderTextScreenSvg,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/handheld_blockout/legibility_test.js`
Expected: `6 tests passed`

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/legibility.js tools/handheld_blockout/legibility_test.js
git commit -m "Add PuzzleScript font loading and text-screen rendering" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Legibility sheet and committed artifacts

**Files:**
- Modify: `tools/handheld_blockout/legibility.js`
- Modify: `tools/handheld_blockout/legibility_test.js`
- Create: `tools/handheld_blockout/generate_sheets.js`
- Generate: `docs/superpowers/notes/2026-07-07-handheld-card-1to1.svg`
- Generate: `docs/superpowers/notes/2026-07-07-handheld-card-legibility.svg`

**Interfaces:**
- Consumes: `renderLevelSvg`, `renderTextScreenSvg`, `loadFont`, `TITLE_LINES`, `LEVEL_P90`, `LEVEL_MEDIAN`, `fmt` from Tasks 5-6; `printSheetSvg`, `BLOCKOUT_PRESETS` from Task 4.
- Produces: `legibilitySheetSvg() -> string`; the two committed SVG files.

- [ ] **Step 1: Write the failing test**

Append to `tools/handheld_blockout/legibility_test.js`, before the final `console.log`:

```js
test("legibilitySheetSvg is A4 landscape 1:1 with all four blocks", function () {
    var svg = L.legibilitySheetSvg();
    assert.ok(svg.indexOf('width="297mm" height="210mm" viewBox="0 0 297 210"') !== -1, "A4 1:1");
    assert.ok(svg.indexOf("exactly 100 mm") !== -1, "calibration bar");
    assert.ok(svg.indexOf("p90 21x17 at 2.7 mm cells (4.0-inch card)") !== -1);
    assert.ok(svg.indexOf("p90 21x17 at 3.4 mm cells (retired 5-inch, comparison)") !== -1);
    assert.ok(svg.indexOf("median 11x9 at 5.4 mm cells (4.0-inch card)") !== -1);
    assert.ok(svg.indexOf("34x13 text screen, 2.541 x 3.985 mm chars") !== -1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/handheld_blockout/legibility_test.js`
Expected: FAIL with `L.legibilitySheetSvg is not a function`

- [ ] **Step 3: Implement the sheet and the generator script**

In `tools/handheld_blockout/legibility.js`, insert after `renderTextScreenSvg`:

```js
function caption(x, y, s) {
    return '<text x="' + fmt(x) + '" y="' + fmt(y) + '" font-size="3" ' +
        'font-family="sans-serif" fill="#444">' + s + "</text>";
}

function legibilitySheetSvg() {
    var font = loadFont();
    var p90card = renderLevelSvg(LEVEL_P90, 2.7);
    var p90ref = renderLevelSvg(LEVEL_P90, 3.4);
    var median = renderLevelSvg(LEVEL_MEDIAN, 5.4);
    var text = renderTextScreenSvg(TITLE_LINES, 2.541, 3.985, font);
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'];
    out.push(caption(18, 10, "PuzzleScript Card legibility sheet — print at 100% scale, " +
        "A4 landscape. View at handheld distance (~35 cm)."));
    out.push('<g stroke="#000" stroke-width="0.3">');
    out.push('<line x1="180" y1="14" x2="280" y2="14"/>');
    for (var t = 0; t <= 100; t += 10) {
        var tick = (t % 50 === 0) ? 3 : 1.5;
        out.push('<line x1="' + (180 + t) + '" y1="' + (14 - tick) + '" x2="' + (180 + t) +
            '" y2="' + (14 + tick) + '"/>');
    }
    out.push("</g>");
    out.push(caption(180, 9.5, "calibration: this bar must measure exactly 100 mm"));
    out.push(caption(18, 26, "p90 21x17 at 2.7 mm cells (4.0-inch card)"));
    out.push('<g transform="translate(18,30)">' + p90card.svg + "</g>");
    out.push(caption(95, 26, "p90 21x17 at 3.4 mm cells (retired 5-inch, comparison)"));
    out.push('<g transform="translate(95,30)">' + p90ref.svg + "</g>");
    out.push(caption(190, 26, "median 11x9 at 5.4 mm cells (4.0-inch card)"));
    out.push('<g transform="translate(190,30)">' + median.svg + "</g>");
    out.push(caption(18, 116, "34x13 text screen, 2.541 x 3.985 mm chars (4.0-inch card)"));
    out.push('<g transform="translate(18,120)">' + text.svg + "</g>");
    out.push(caption(18, 182, "levels are density proxies (real Simple Block Pushing Game " +
        "sprites), not solvable puzzles"));
    out.push("</svg>");
    return out.join("\n");
}
```

Add to the `module.exports` object (ensure no trailing comma after the final entry):

```js
        legibilitySheetSvg: legibilitySheetSvg
```

Create `tools/handheld_blockout/generate_sheets.js`:

```js
"use strict";
// Regenerates the committed validation sheets for the card spec.
// Run from anywhere: node tools/handheld_blockout/generate_sheets.js
var fs = require("fs");
var path = require("path");
var B = require("./blockout.js");
var L = require("./legibility.js");

var notes = path.join(__dirname, "..", "..", "docs", "superpowers", "notes");
var oneToOne = path.join(notes, "2026-07-07-handheld-card-1to1.svg");
var legibility = path.join(notes, "2026-07-07-handheld-card-legibility.svg");

fs.writeFileSync(oneToOne, B.printSheetSvg(B.BLOCKOUT_PRESETS.card));
fs.writeFileSync(legibility, L.legibilitySheetSvg());
console.log("wrote " + oneToOne);
console.log("wrote " + legibility);
```

- [ ] **Step 4: Run tests and generate the artifacts**

Run: `node tools/handheld_blockout/legibility_test.js`
Expected: `7 tests passed`

Run: `node tools/handheld_blockout/generate_sheets.js`
Expected: two `wrote ...` lines; both SVG files exist under `docs/superpowers/notes/`.

- [ ] **Step 5: Visually verify both sheets**

Open both generated SVGs in a browser. Check:

1. The 1:1 sheet shows the card face with grid, module/active-area outlines, D-pad cross, three labeled buttons, menu pill, 25 grille dots, dashed zone overlays, top-edge and right-edge strips, the Z-section, and the five expected warnings listed on the sheet.
2. The legibility sheet shows three colored level blocks (two large, one small-celled) and a black text block with readable white pixel text, plus the calibration bar. Nothing overlaps or runs off the page.

If anything overlaps or runs off-page, adjust the translate coordinates in `printSheetSvg`/`legibilitySheetSvg`, re-run the tests and the generator, and re-check.

- [ ] **Step 6: Commit**

```bash
git add tools/handheld_blockout/legibility.js tools/handheld_blockout/legibility_test.js tools/handheld_blockout/generate_sheets.js docs/superpowers/notes/2026-07-07-handheld-card-1to1.svg docs/superpowers/notes/2026-07-07-handheld-card-legibility.svg
git commit -m "Add legibility sheet and committed card validation sheets" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: UI page, README, and spec/plan cross-links

**Files:**
- Create: `tools/handheld_blockout/index.html`
- Create: `tools/handheld_blockout/README.md`
- Modify: `docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md` (Validation Plan step 1)
- Modify: `docs/superpowers/plans/2026-07-07-handheld-blockout-tool.md` (superseded note)

**Interfaces:**
- Consumes: `BLOCKOUT_PRESETS`, `cloneParams`, `getParam`, `setParam`, `faceSvg`, `edgesSvg`, `sectionSvg`, `spacingWarnings`, `printSheetSvg` as browser globals from `blockout.js`.

- [ ] **Step 1: Create the page**

Create `tools/handheld_blockout/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PuzzleScript Card Blockout</title>
<style>
    body { font-family: sans-serif; margin: 0; display: flex; height: 100vh; }
    #panel { width: 300px; overflow-y: auto; padding: 12px; border-right: 1px solid #ccc;
             flex-shrink: 0; }
    #view { flex: 1; overflow: auto; padding: 12px; background: #f6f6f6; }
    #view svg { display: block; max-width: 100%; height: auto; background: #fff;
                border: 1px solid #ddd; margin-bottom: 12px; }
    fieldset { border: 1px solid #ddd; margin: 0 0 8px 0; padding: 6px 8px; }
    legend { font-size: 12px; font-weight: bold; }
    label { display: flex; justify-content: space-between; align-items: center;
            font-size: 12px; margin: 2px 0; }
    input[type=number] { width: 70px; }
    #warnings { color: #b00; font-size: 12px; white-space: pre-line; margin: 8px 0; }
    #warnings:empty::before { content: "no spacing warnings"; color: #080; }
    .rowctl { margin: 0 0 8px 0; font-size: 13px; }
    button { font-size: 13px; }
</style>
</head>
<body>
<div id="panel">
    <div class="rowctl">
        <label>mm grid <input type="checkbox" id="grid" checked></label>
        <label>internal zones <input type="checkbox" id="overlays" checked></label>
    </div>
    <div class="rowctl">
        <button id="reset">Reset to spec</button>
        <button id="export">Export 1:1 SVG</button>
    </div>
    <div id="warnings"></div>
    <div id="fields"></div>
</div>
<div id="view"></div>
<script src="blockout.js"></script>
<script>
"use strict";

var FIELD_GROUPS = [
    { title: "Body", fields: [["body.w", "width"], ["body.h", "height"],
        ["body.r", "corner radius"], ["body.depth", "depth"]] },
    { title: "Screen", fields: [["screen.activeX", "active X"], ["screen.activeY", "active Y"],
        ["screen.activeW", "active width"], ["screen.activeH", "active height"],
        ["screen.moduleX", "module X"], ["screen.moduleY", "module Y"],
        ["screen.moduleW", "module width"], ["screen.moduleH", "module height"]] },
    { title: "D-pad", fields: [["dpad.cx", "center X"], ["dpad.cy", "center Y"],
        ["dpad.size", "size"], ["dpad.arm", "arm width"]] },
    { title: "Action", fields: [["buttons.0.cx", "center X"], ["buttons.0.cy", "center Y"],
        ["buttons.0.d", "diameter"]] },
    { title: "Undo", fields: [["buttons.1.cx", "center X"], ["buttons.1.cy", "center Y"],
        ["buttons.1.d", "diameter"]] },
    { title: "Restart", fields: [["buttons.2.cx", "center X"], ["buttons.2.cy", "center Y"],
        ["buttons.2.d", "diameter"]] },
    { title: "Menu", fields: [["menu.cx", "center X"], ["menu.cy", "center Y"],
        ["menu.w", "width"], ["menu.h", "height"], ["menu.angle", "angle (deg)"]] },
    { title: "Band", fields: [["band.y0", "top Y"], ["band.y1", "bottom Y"]] },
    { title: "Grille", fields: [["grille.cx", "center X"], ["grille.cy", "center Y"]] },
    { title: "Top edge", fields: [["topEdge.usbX", "USB-C X"], ["topEdge.pwrX", "power X"]] },
    { title: "Right edge", fields: [["rightEdge.volY", "volume Y"]] }
];

var current = cloneParams(BLOCKOUT_PRESETS.card);

function render() {
    var opts = {
        grid: document.getElementById("grid").checked,
        overlays: document.getElementById("overlays").checked
    };
    document.getElementById("view").innerHTML =
        faceSvg(current, opts) + edgesSvg(current) + sectionSvg(current);
    document.getElementById("warnings").textContent = spacingWarnings(current).join("\n");
}

function addField(fs, path, name) {
    var label = document.createElement("label");
    label.textContent = name + " ";
    var input = document.createElement("input");
    input.type = "number";
    input.step = "0.5";
    input.value = getParam(current, path);
    input.addEventListener("input", function () {
        var v = parseFloat(input.value);
        if (!isNaN(v)) {
            setParam(current, path, v);
            render();
        }
    });
    label.appendChild(input);
    fs.appendChild(label);
}

function buildFields() {
    var container = document.getElementById("fields");
    container.innerHTML = "";
    FIELD_GROUPS.forEach(function (group) {
        var fs = document.createElement("fieldset");
        var lg = document.createElement("legend");
        lg.textContent = group.title;
        fs.appendChild(lg);
        group.fields.forEach(function (f) {
            addField(fs, f[0], f[1]);
        });
        container.appendChild(fs);
    });
    current.zones.forEach(function (z, i) {
        var fs = document.createElement("fieldset");
        var lg = document.createElement("legend");
        lg.textContent = "Zone: " + z.label;
        fs.appendChild(lg);
        addField(fs, "zones." + i + ".x", "x");
        addField(fs, "zones." + i + ".y", "y");
        addField(fs, "zones." + i + ".w", "width");
        addField(fs, "zones." + i + ".h", "height");
        container.appendChild(fs);
    });
}

function reset() {
    current = cloneParams(BLOCKOUT_PRESETS.card);
    buildFields();
    render();
}

document.getElementById("reset").addEventListener("click", reset);
document.getElementById("grid").addEventListener("change", render);
document.getElementById("overlays").addEventListener("change", render);
document.getElementById("export").addEventListener("click", function () {
    var blob = new Blob([printSheetSvg(current)], { type: "image/svg+xml" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "handheld-card-1to1.svg";
    a.click();
    URL.revokeObjectURL(a.href);
});

buildFields();
render();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the logic tests still pass**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `16 tests passed` (the page must not require changes to `blockout.js`)

- [ ] **Step 3: Manual verification in a browser**

Open `tools/handheld_blockout/index.html` directly in a browser (double-click works; the page uses no XHR, so `file://` is fine). Check each of:

1. The card face, edge strips, and Z-section all render; the warnings area lists the five expected spec warnings in red.
2. Setting the battery zone width to 24 removes the `UNDO switch footprint` warning; "Reset to spec" restores it.
3. Unchecking "mm grid" and "internal zones" removes the grid fill and the dashed zone rectangles.
4. "Export 1:1 SVG" downloads `handheld-card-1to1.svg`; opening the downloaded file shows the A4 sheet matching the committed artifact.

If any check fails, fix `index.html` (or `blockout.js` if the defect is in generation) before committing, and re-run the Step 2 test command after any `blockout.js` change.

- [ ] **Step 4: Write the README**

Create `tools/handheld_blockout/README.md`:

```markdown
# PuzzleScript Card Blockout Tool

Parametric blockout viewer for the PuzzleScript Card handheld
(`docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`). Open
`index.html` in a browser (no server or build step). Tweak millimeter
coordinates, watch geometry warnings, and export a printable 1:1 SVG sheet
(A4 landscape, 100 mm calibration bar).

The spec's known conflicts (Menu clearance, battery/Undo overlap, speaker
band overrun) appear as warnings on purpose — they are open risks the
physical mockup must resolve.

Regenerate the committed validation sheets (1:1 face sheet + legibility
sheet with real sprites and the real PuzzleScript font) with:

    node tools/handheld_blockout/generate_sheets.js

Run the logic tests with:

    node tools/handheld_blockout/blockout_test.js
    node tools/handheld_blockout/legibility_test.js
```

- [ ] **Step 5: Point the card spec's validation plan at the artifacts**

In `docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`, replace:

```markdown
1. Produce a 1:1 printable sheet of this face plan (companion to
   `2026-07-07-handheld-case-blockout-1to1.svg`, which is superseded with
   its spec) and verify at 100% scale.
```

with:

```markdown
1. Print the committed 1:1 sheet at 100% scale and verify with the printed
   calibration ruler:
   `docs/superpowers/notes/2026-07-07-handheld-card-1to1.svg`
   To test coordinate variations, use the parametric tool at
   `tools/handheld_blockout/index.html` (Export 1:1 SVG). The legibility
   sheet for validation step 4 is
   `docs/superpowers/notes/2026-07-07-handheld-card-legibility.svg`.
```

- [ ] **Step 6: Mark the old blockout-tool plan superseded**

In `docs/superpowers/plans/2026-07-07-handheld-blockout-tool.md`, insert directly under the `# Handheld Case Parametric Blockout Tool Implementation Plan` heading:

```markdown
> **Superseded 2026-07-07 (never executed):** the 5-inch form factor was
> retired by `docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`.
> The card equivalent of this tool is implemented by
> `docs/superpowers/plans/2026-07-07-handheld-card-validation-artifacts.md`.
```

- [ ] **Step 7: Run both test suites one more time**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `16 tests passed`

Run: `node tools/handheld_blockout/legibility_test.js`
Expected: `7 tests passed`

- [ ] **Step 8: Commit**

```bash
git add tools/handheld_blockout/index.html tools/handheld_blockout/README.md docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md docs/superpowers/plans/2026-07-07-handheld-blockout-tool.md
git commit -m "Add card blockout UI page and cross-link validation artifacts" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification Notes for the Executor

- The engine test suite (`node src/tests/run_tests_node.js`) is unaffected by
  this work (nothing under `src/` changes); running it is optional.
- The exact warning strings in Task 2's tests were computed from the spec
  coordinates (for example, D-pad tip to Menu: circle distance 19 − 13 − 5.5
  = 0.5 mm). If a test disagrees with the implementation by a float-noise
  digit, fix the expectation to the `fmt`-rounded value the implementation
  produces — do NOT change preset geometry.
- The battery/Undo overlap warning is a genuine spec finding (the usable gap
  between the D-pad and cluster fields is ~27 mm, not the 32 mm the spec's
  battery zone assumes). It stays in the committed sheet; resolving it is
  PCB-layout/spec-amendment work, not tooling work.
- `legibility.js` is Node-only (it reads `src/js/font.js` with `fs`); do not
  load it from `index.html`.

# Handheld Case Parametric Blockout Tool Implementation Plan

> **Superseded 2026-07-07 (never executed):** the 5-inch form factor was
> retired by `docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`.
> The card equivalent of this tool is implemented by
> `docs/superpowers/plans/2026-07-07-handheld-card-validation-artifacts.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, no-build HTML page for tweaking the PuzzleScript handheld case blockout parametrically, with layout presets, a millimeter grid, spacing warnings, and printable 1:1 SVG export.

**Architecture:** One pure-logic JS file (`blockout.js`) holds presets, geometry checks, and SVG-string generation; it uses browser globals plus a `module.exports` guard so plain Node can unit-test it (repo has no test framework dependency for tools — tests are a plain Node script using `assert`). `index.html` is a thin UI shell: schema-driven numeric inputs, preset selector, live re-render, and a Blob-download export that reuses the same SVG generator that produced the committed 1:1 sheet format.

**Tech Stack:** Vanilla JS (ES5-style, matching repo idiom), SVG, Node `assert` for tests. No dependencies, no build step.

**Context:** Coordinates and presets come from the approved spec
`docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md` (split-side default)
and the handoff `docs/superpowers/notes/2026-07-06-handheld-designer-handoff.md`
(Candidates B and C as comparison presets). The committed static sheet
`docs/superpowers/notes/2026-07-07-handheld-case-blockout-1to1.svg` defines the
print-sheet format this tool's export must match (A4 landscape, 100 mm
calibration bar, face + profile + top edge).

---

## File Structure

- Create: `tools/handheld_blockout/blockout.js` — presets, param path helpers, geometry checks, SVG generation. Pure functions only; no DOM access.
- Create: `tools/handheld_blockout/blockout_test.js` — plain Node test script, run with `node tools/handheld_blockout/blockout_test.js`.
- Create: `tools/handheld_blockout/index.html` — UI shell; loads `blockout.js` via `<script>`; works from `file://` (no XHR).
- Create: `tools/handheld_blockout/README.md` — usage notes.
- Modify: `docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md` — point validation step 1 at the tool.

The tool lives outside `src/` on purpose: `compile.js` copies `src/` to `bin/` and must not pick this up.

All commands run from the repository root.

---

### Task 1: Presets and param helpers

**Files:**
- Create: `tools/handheld_blockout/blockout.js`
- Create: `tools/handheld_blockout/blockout_test.js`

- [ ] **Step 1: Write the failing test**

Create `tools/handheld_blockout/blockout_test.js`:

```js
"use strict";
var assert = require("assert");
var B = require("./blockout.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("presets exist with approved split-side defaults", function () {
    assert.deepStrictEqual(Object.keys(B.BLOCKOUT_PRESETS), ["split", "under", "strip"]);
    var s = B.BLOCKOUT_PRESETS.split;
    assert.strictEqual(s.body.w, 228);
    assert.strictEqual(s.body.h, 105);
    assert.strictEqual(s.body.depthGrip, 31);
    assert.strictEqual(s.body.depthWaist, 22);
    assert.strictEqual(s.screen.lensW, 121);
    assert.strictEqual(s.dpad.cx, 27);
    assert.strictEqual(s.buttons[0].label, "ACTION");
    assert.strictEqual(s.buttons[0].d, 16);
    assert.strictEqual(s.buttons[1].cx, 187);
    assert.strictEqual(s.buttons[2].cy, 67);
    assert.strictEqual(s.menu.angle, -20);
    assert.strictEqual(s.topEdge.usbX, 68);
    assert.strictEqual(s.strip, null);
});

test("under preset is DMG-style controls-under", function () {
    var u = B.BLOCKOUT_PRESETS.under;
    assert.strictEqual(u.body.w, 160);
    assert.strictEqual(u.body.h, 145);
    assert.strictEqual(u.topEdge.fpcKeepOut, null);
});

test("strip preset has a center utility strip", function () {
    var c = B.BLOCKOUT_PRESETS.strip;
    assert.strictEqual(c.body.w, 232);
    assert.deepStrictEqual(c.strip, { x: 86, y: 3, w: 60, h: 9.5 });
});

test("getParam and setParam address nested values by dot path", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.split);
    assert.strictEqual(B.getParam(p, "buttons.1.cx"), 187);
    B.setParam(p, "buttons.1.cx", 190);
    assert.strictEqual(p.buttons[1].cx, 190);
    assert.strictEqual(B.BLOCKOUT_PRESETS.split.buttons[1].cx, 187, "preset untouched");
});

test("fmt trims float noise", function () {
    assert.strictEqual(B.fmt(65.8 / 2), "32.9");
    assert.strictEqual(B.fmt(0.1 + 0.2), "0.3");
    assert.strictEqual(B.fmt(228), "228");
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

// Parametric blockout model for the PuzzleScript handheld case.
// Coordinates are millimeters from the top-left corner of the front face.
// Spec: docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md

var BLOCKOUT_PRESETS = {
    split: {
        name: "Split-side (approved 2026-07-07)",
        body: { w: 228, h: 105, r: 14, depthGrip: 31, depthWaist: 22 },
        screen: { cx: 114, cy: 52.5, lensW: 121, lensH: 77, visW: 109, visH: 65.8 },
        // 34 mm mascot cap (chevron tip to tip), one-piece rocker underneath
        dpad: { cx: 27, cy: 52.5, size: 34, arm: 11 },
        buttons: [
            { label: "ACTION", cx: 202, cy: 44, d: 16 },
            { label: "UNDO", cx: 187, cy: 60, d: 12 },
            { label: "RESTART", cx: 205, cy: 67, d: 11 }
        ],
        menu: { cx: 27, cy: 90, w: 13, h: 4.5, angle: -20 },
        speaker: { cx: 114, cy: 96.5, w: 22, h: 7 },
        topEdge: { pwrX: 23, usbX: 68, volX: 201, fpcKeepOut: [108, 140] },
        grips: [
            { x: 10, y: 28, w: 36, h: 56, label: "battery a" },
            { x: 182, y: 28, w: 36, h: 56, label: "battery b" }
        ],
        strip: null
    },
    under: {
        name: "Controls under (DMG-style comparison)",
        body: { w: 160, h: 145, r: 10, depthGrip: 26, depthWaist: 26 },
        screen: { cx: 80, cy: 48.5, lensW: 121, lensH: 77, visW: 109, visH: 65.8 },
        dpad: { cx: 32, cy: 119, size: 26, arm: 8 },
        buttons: [
            { label: "ACTION", cx: 122, cy: 112, d: 15 },
            { label: "UNDO", cx: 104, cy: 126, d: 10 },
            { label: "RESTART", cx: 137, cy: 129, d: 10 }
        ],
        menu: { cx: 80, cy: 134.5, w: 13, h: 4.5, angle: 0 },
        speaker: { cx: 145, cy: 139, w: 14, h: 6 },
        topEdge: { pwrX: 20, usbX: 80, volX: 140, fpcKeepOut: null },
        grips: [{ x: 45, y: 98, w: 70, h: 40, label: "battery" }],
        strip: null
    },
    strip: {
        name: "Split + center utility strip",
        body: { w: 232, h: 108, r: 14, depthGrip: 31, depthWaist: 22 },
        screen: { cx: 116, cy: 54, lensW: 121, lensH: 77, visW: 109, visH: 65.8 },
        dpad: { cx: 28, cy: 54, size: 26, arm: 8 },
        buttons: [
            { label: "ACTION", cx: 206, cy: 46, d: 16 },
            { label: "UNDO", cx: 191, cy: 64, d: 12 },
            { label: "RESTART", cx: 210, cy: 69, d: 11 }
        ],
        menu: { cx: 99.5, cy: 7.75, w: 13, h: 4.5, angle: 0 },
        speaker: { cx: 133, cy: 7.75, w: 17, h: 4 },
        topEdge: { pwrX: 20, usbX: 60, volX: 205, fpcKeepOut: null },
        grips: [
            { x: 10, y: 30, w: 36, h: 56, label: "battery a" },
            { x: 186, y: 30, w: 36, h: 56, label: "battery b" }
        ],
        strip: { x: 86, y: 3, w: 60, h: 9.5 }
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
Expected: `5 tests passed` (5 `ok -` lines, exit code 0)

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/blockout.js tools/handheld_blockout/blockout_test.js
git commit -m "Add handheld blockout tool presets and param helpers" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Geometry checks and spacing warnings

**Files:**
- Modify: `tools/handheld_blockout/blockout.js`
- Modify: `tools/handheld_blockout/blockout_test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tools/handheld_blockout/blockout_test.js`, immediately before the final `console.log` line:

```js
test("circleGap measures edge-to-edge distance", function () {
    assert.strictEqual(B.circleGap(0, 0, 5, 20, 0, 5), 10);
});

test("rectCircleClearance measures circle edge to rect edge", function () {
    // circle centered 10 left of a rect spanning x 10..30, radius 4 -> 6 clear
    assert.strictEqual(B.rectCircleClearance(10, 10, 20, 20, 0, 10, 4), 6);
    // circle center inside the rect -> -radius (overlap)
    assert.strictEqual(B.rectCircleClearance(10, 10, 20, 20, 15, 15, 4), -4);
});

test("all shipped presets pass spacing checks", function () {
    assert.deepStrictEqual(B.spacingWarnings(B.BLOCKOUT_PRESETS.split), []);
    assert.deepStrictEqual(B.spacingWarnings(B.BLOCKOUT_PRESETS.under), []);
    assert.deepStrictEqual(B.spacingWarnings(B.BLOCKOUT_PRESETS.strip), []);
});

test("crowded cluster produces a gap warning", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.split);
    B.setParam(p, "buttons.1.cx", 196);
    B.setParam(p, "buttons.1.cy", 50);
    var w = B.spacingWarnings(p);
    assert.strictEqual(w.length, 1);
    assert.ok(w[0].indexOf("ACTION-UNDO") === 0, w[0]);
});

test("button hard against the lens produces a clearance warning", function () {
    var p = B.cloneParams(B.BLOCKOUT_PRESETS.split);
    B.setParam(p, "buttons.1.cx", 182); // UNDO left edge 176, lens right edge 174.5
    var w = B.spacingWarnings(p);
    assert.ok(w.some(function (msg) { return msg.indexOf("UNDO") === 0 && msg.indexOf("lens") !== -1; }),
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
var MIN_LENS_CLEARANCE = 5;   // mm from any cap edge to the display lens
var MIN_EDGE_CLEARANCE = 3;   // mm from any cap edge to the body outline

function circleGap(ax, ay, ar, bx, by, br) {
    return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)) - ar - br;
}

function rectCircleClearance(rx, ry, rw, rh, cx, cy, r) {
    var dx = Math.max(rx - cx, 0, cx - (rx + rw));
    var dy = Math.max(ry - cy, 0, cy - (ry + rh));
    return Math.sqrt(dx * dx + dy * dy) - r;
}

function spacingWarnings(params) {
    var warnings = [];
    var circles = [{ label: "D-PAD", cx: params.dpad.cx, cy: params.dpad.cy, r: params.dpad.size / 2 }];
    params.buttons.forEach(function (b) {
        circles.push({ label: b.label, cx: b.cx, cy: b.cy, r: b.d / 2 });
    });
    // Menu is a flush low-profile pill: it participates in cap-gap checks
    // (widest extent) but is exempt from lens/edge clearance checks.
    circles.push({
        label: "MENU", cx: params.menu.cx, cy: params.menu.cy,
        r: Math.max(params.menu.w, params.menu.h) / 2, flush: true
    });
    for (var i = 0; i < circles.length; i++) {
        for (var j = i + 1; j < circles.length; j++) {
            var gap = circleGap(circles[i].cx, circles[i].cy, circles[i].r,
                circles[j].cx, circles[j].cy, circles[j].r);
            if (gap < MIN_CAP_GAP) {
                warnings.push(circles[i].label + "-" + circles[j].label + " gap " + fmt(gap) +
                    " mm (< " + MIN_CAP_GAP + " mm)");
            }
        }
    }
    var lensX = params.screen.cx - params.screen.lensW / 2;
    var lensY = params.screen.cy - params.screen.lensH / 2;
    circles.forEach(function (c) {
        if (c.flush) {
            return;
        }
        var clear = rectCircleClearance(lensX, lensY, params.screen.lensW, params.screen.lensH,
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
    return warnings;
}
```

Add to the `module.exports` object:

```js
        circleGap: circleGap,
        rectCircleClearance: rectCircleClearance,
        spacingWarnings: spacingWarnings,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `10 tests passed`

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/blockout.js tools/handheld_blockout/blockout_test.js
git commit -m "Add blockout spacing warnings and geometry checks" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Face SVG generation

**Files:**
- Modify: `tools/handheld_blockout/blockout.js`
- Modify: `tools/handheld_blockout/blockout_test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tools/handheld_blockout/blockout_test.js`, before the final `console.log`:

```js
test("faceSvg draws body, lens, and d-pad at spec coordinates", function () {
    var svg = B.faceSvg(B.BLOCKOUT_PRESETS.split, { grid: true });
    assert.ok(svg.indexOf('viewBox="-12 -24 252 146"') !== -1, "viewBox");
    assert.ok(svg.indexOf('x="53.5" y="14" width="121" height="77"') !== -1, "lens rect");
    assert.ok(svg.indexOf('x="10" y="47" width="34" height="11"') !== -1, "d-pad h-arm");
    assert.ok(svg.indexOf('rotate(-20 27 90)') !== -1, "menu tilt");
    assert.ok(svg.indexOf('url(#grid10)') !== -1, "grid fill on");
});

test("faceSvg grid off leaves body unfilled", function () {
    var svg = B.faceSvg(B.BLOCKOUT_PRESETS.split, { grid: false });
    assert.strictEqual(svg.indexOf('url(#grid10)'), -1);
});

test("faceSvg renders strip and skips absent fpc keep-out", function () {
    var svg = B.faceSvg(B.BLOCKOUT_PRESETS.strip, {});
    assert.ok(svg.indexOf('x="86" y="3" width="60" height="9.5"') !== -1, "strip rect");
    assert.strictEqual(svg.indexOf('stroke-dasharray="1.5,1.5"'), -1, "no fpc lines");
    var split = B.faceSvg(B.BLOCKOUT_PRESETS.split, {});
    assert.ok(split.indexOf('stroke-dasharray="1.5,1.5"') !== -1, "split has fpc lines");
});

test("faceSvg overlays draw grip volumes", function () {
    var withO = B.faceSvg(B.BLOCKOUT_PRESETS.split, { overlays: true });
    assert.ok(withO.indexOf("battery a") !== -1);
    var withoutO = B.faceSvg(B.BLOCKOUT_PRESETS.split, {});
    assert.strictEqual(withoutO.indexOf("battery a"), -1);
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

function topEdgeGroupSvg(params) {
    var b = params.body, t = params.topEdge;
    var out = [svgRect(0, 0, b.w, 11, 4, "#000", "none")];
    out.push(svgRect(t.pwrX - 5, 3.25, 10, 4.5, 2.25, "#000", "none"));
    out.push(svgText(t.pwrX, -1.5, 2.6, "PWR"));
    out.push(svgRect(t.usbX - 5, 3, 10, 5, 2.5, "#000", "none"));
    out.push(svgText(t.usbX, -1.5, 2.6, "USB-C"));
    out.push(svgRect(t.volX - 9, 3.5, 18, 4, 2, "#000", "none"));
    out.push(svgText(t.volX, -1.5, 2.6, "VOL"));
    if (t.fpcKeepOut) {
        for (var i = 0; i < 2; i++) {
            out.push('<line x1="' + fmt(t.fpcKeepOut[i]) + '" y1="1.5" x2="' + fmt(t.fpcKeepOut[i]) +
                '" y2="9.5" stroke="#999" stroke-width="0.25" stroke-dasharray="1.5,1.5"/>');
        }
    }
    return out.join("\n");
}

function faceGroupSvg(params, opts) {
    var b = params.body, s = params.screen;
    var out = [svgRect(0, 0, b.w, b.h, b.r, "#000", opts.grid ? "url(#grid10)" : "none")];
    out.push(svgRect(s.cx - s.lensW / 2, s.cy - s.lensH / 2, s.lensW, s.lensH, 2, "#000", "none"));
    out.push(svgRect(s.cx - s.visW / 2, s.cy - s.visH / 2, s.visW, s.visH, 0, "#666", "none", true));
    var d = params.dpad;
    out.push(svgRect(d.cx - d.size / 2, d.cy - d.arm / 2, d.size, d.arm, 1.5, "#000", "none"));
    out.push(svgRect(d.cx - d.arm / 2, d.cy - d.size / 2, d.arm, d.size, 1.5, "#000", "none"));
    out.push(crosshair(d.cx, d.cy));
    params.buttons.forEach(function (btn) {
        out.push('<circle cx="' + fmt(btn.cx) + '" cy="' + fmt(btn.cy) + '" r="' + fmt(btn.d / 2) +
            '" fill="none" stroke="#000" stroke-width="0.4"/>');
        out.push(crosshair(btn.cx, btn.cy));
        out.push(svgText(btn.cx, btn.cy + btn.d / 2 + 3.5, 2.6, btn.label + " Ø" + fmt(btn.d)));
    });
    var m = params.menu;
    out.push('<g transform="rotate(' + fmt(m.angle) + " " + fmt(m.cx) + " " + fmt(m.cy) + ')">' +
        svgRect(m.cx - m.w / 2, m.cy - m.h / 2, m.w, m.h, m.h / 2, "#000", "none") + "</g>");
    out.push(svgText(m.cx, m.cy + 7, 2.6, "MENU"));
    var sp = params.speaker;
    out.push(svgRect(sp.cx - sp.w / 2, sp.cy - sp.h / 2, sp.w, sp.h, 1, "#000", "none", true));
    out.push(svgText(sp.cx, sp.cy + sp.h / 2 + 3, 2.6, "speaker"));
    if (params.strip) {
        out.push(svgRect(params.strip.x, params.strip.y, params.strip.w, params.strip.h, 3,
            "#000", "none", true));
    }
    if (opts.overlays) {
        params.grips.forEach(function (g) {
            out.push(svgRect(g.x, g.y, g.w, g.h, 3, "#c77", "none", true));
            out.push(svgText(g.x + g.w / 2, g.y + g.h / 2, 3, g.label));
        });
    }
    return out.join("\n");
}

function faceSvg(params, opts) {
    opts = opts || {};
    var b = params.body;
    var vbW = b.w + 24, vbH = b.h + 41;
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + fmt(vbW * (opts.scale || 3)) +
        '" viewBox="-12 -24 ' + fmt(vbW) + " " + fmt(vbH) + '">'];
    out.push(GRID_DEF);
    out.push('<g transform="translate(0,-18)">' + topEdgeGroupSvg(params) + "</g>");
    out.push(faceGroupSvg(params, opts));
    out.push("</svg>");
    return out.join("\n");
}
```

Add to the `module.exports` object:

```js
        faceSvg: faceSvg,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `14 tests passed`

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/blockout.js tools/handheld_blockout/blockout_test.js
git commit -m "Add blockout face SVG generation" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Profile path and printable 1:1 sheet

**Files:**
- Modify: `tools/handheld_blockout/blockout.js`
- Modify: `tools/handheld_blockout/blockout_test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tools/handheld_blockout/blockout_test.js`, before the final `console.log`:

```js
test("profilePath parameterizes the sculpted section", function () {
    var d = B.profilePath(B.BLOCKOUT_PRESETS.split.body);
    assert.ok(d.indexOf("M 4 0 L 224 0") === 0, d.slice(0, 30));
    assert.ok(d.indexOf(" 79.8 22") !== -1, "waist at 22 mm");
    assert.ok(d.indexOf(" 31 ") !== -1, "grip depth 31 mm");
    assert.ok(d.charAt(d.length - 1) === "Z");
});

test("printSheetSvg is A4 landscape 1:1 with calibration bar", function () {
    var svg = B.printSheetSvg(B.BLOCKOUT_PRESETS.split);
    assert.ok(svg.indexOf('width="297mm" height="210mm" viewBox="0 0 297 210"') !== -1, "A4 1:1");
    assert.ok(svg.indexOf('x1="162" y1="14" x2="262" y2="14"') !== -1, "100 mm bar");
    assert.ok(svg.indexOf('translate(34.5,22)') !== -1, "face centered for 228 mm body");
    assert.ok(svg.indexOf("exactly 100 mm") !== -1);
});

test("printSheetSvg centers narrower bodies", function () {
    var svg = B.printSheetSvg(B.BLOCKOUT_PRESETS.under);
    assert.ok(svg.indexOf('translate(68.5,22)') !== -1, "face centered for 160 mm body");
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: FAIL with `B.profilePath is not a function`

- [ ] **Step 3: Implement profile and print sheet**

In `tools/handheld_blockout/blockout.js`, insert after `faceSvg`:

```js
function profilePath(body) {
    var w = body.w, dg = body.depthGrip, dw = body.depthWaist;
    var gl = w * 0.12, gr = w * 0.88, wl = w * 0.35, wr = w * 0.65;
    return "M 4 0 L " + fmt(w - 4) + " 0 Q " + fmt(w) + " 0 " + fmt(w) + " 4 L " + fmt(w) + " 12" +
        " Q " + fmt(w - 3) + " " + fmt(dg) + " " + fmt(gr) + " " + fmt(dg) +
        " Q " + fmt((gr + wr) / 2) + " " + fmt(dg) + " " + fmt(wr) + " " + fmt(dw) +
        " L " + fmt(wl) + " " + fmt(dw) +
        " Q " + fmt((gl + wl) / 2) + " " + fmt(dg) + " " + fmt(gl) + " " + fmt(dg) +
        " Q 3 " + fmt(dg) + " 0 12 L 0 4 Q 0 0 4 0 Z";
}

function printSheetSvg(params) {
    var b = params.body;
    var mx = (297 - b.w) / 2;
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'];
    out.push(GRID_DEF);
    out.push(svgText(mx, 8, 4.2, params.name +
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
    out.push('<g transform="translate(' + fmt(mx) + ',22)">' +
        faceGroupSvg(params, { grid: true, overlays: true }) + "</g>");
    out.push(svgText(mx, 137.5, 3.4,
        "profile section through control line, 1:1 (front face at top)", "start"));
    out.push('<g transform="translate(' + fmt(mx) + ',140)"><path d="' + profilePath(b) +
        '" fill="none" stroke="#000" stroke-width="0.5"/></g>');
    out.push('<g transform="translate(' + fmt(mx) + ',183)">' + topEdgeGroupSvg(params) + "</g>");
    out.push("</svg>");
    return out.join("\n");
}
```

Add to the `module.exports` object:

```js
        profilePath: profilePath,
        printSheetSvg: printSheetSvg
```

(Ensure the export list has no trailing-comma syntax error after this final entry.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `17 tests passed`

- [ ] **Step 5: Commit**

```bash
git add tools/handheld_blockout/blockout.js tools/handheld_blockout/blockout_test.js
git commit -m "Add blockout profile path and printable 1:1 sheet export" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: UI page

**Files:**
- Create: `tools/handheld_blockout/index.html`

- [ ] **Step 1: Create the page**

Create `tools/handheld_blockout/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PuzzleScript Handheld Blockout</title>
<style>
    body { font-family: sans-serif; margin: 0; display: flex; height: 100vh; }
    #panel { width: 300px; overflow-y: auto; padding: 12px; border-right: 1px solid #ccc;
             flex-shrink: 0; }
    #view { flex: 1; overflow: auto; padding: 12px; background: #f6f6f6; }
    #view svg { max-width: 100%; height: auto; background: #fff; border: 1px solid #ddd; }
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
        <label>Preset
            <select id="preset">
                <option value="split">Split-side (approved)</option>
                <option value="under">Controls under (DMG-style)</option>
                <option value="strip">Split + center strip</option>
            </select>
        </label>
        <label>mm grid <input type="checkbox" id="grid" checked></label>
        <label>internal volumes <input type="checkbox" id="overlays" checked></label>
    </div>
    <div class="rowctl">
        <button id="reset">Reset preset</button>
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
    { title: "Body", fields: [["body.w", "width"], ["body.h", "height"], ["body.r", "corner radius"],
        ["body.depthGrip", "depth at grips"], ["body.depthWaist", "depth at waist"]] },
    { title: "Screen", fields: [["screen.cx", "center X"], ["screen.cy", "center Y"],
        ["screen.lensW", "lens width"], ["screen.lensH", "lens height"],
        ["screen.visW", "visible width"], ["screen.visH", "visible height"]] },
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
    { title: "Speaker zone", fields: [["speaker.cx", "center X"], ["speaker.cy", "center Y"],
        ["speaker.w", "width"], ["speaker.h", "height"]] },
    { title: "Top edge", fields: [["topEdge.pwrX", "power X"], ["topEdge.usbX", "USB-C X"],
        ["topEdge.volX", "volume X"]] }
];

var presetSelect = document.getElementById("preset");
var current = cloneParams(BLOCKOUT_PRESETS[presetSelect.value]);

function render() {
    document.getElementById("view").innerHTML = faceSvg(current, {
        grid: document.getElementById("grid").checked,
        overlays: document.getElementById("overlays").checked
    });
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
    current.grips.forEach(function (g, i) {
        var fs = document.createElement("fieldset");
        var lg = document.createElement("legend");
        lg.textContent = "Volume: " + g.label;
        fs.appendChild(lg);
        addField(fs, "grips." + i + ".x", "x");
        addField(fs, "grips." + i + ".y", "y");
        addField(fs, "grips." + i + ".w", "width");
        addField(fs, "grips." + i + ".h", "height");
        container.appendChild(fs);
    });
}

function loadPreset() {
    current = cloneParams(BLOCKOUT_PRESETS[presetSelect.value]);
    buildFields();
    render();
}

presetSelect.addEventListener("change", loadPreset);
document.getElementById("reset").addEventListener("click", loadPreset);
document.getElementById("grid").addEventListener("change", render);
document.getElementById("overlays").addEventListener("change", render);
document.getElementById("export").addEventListener("click", function () {
    var blob = new Blob([printSheetSvg(current)], { type: "image/svg+xml" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "handheld-blockout-" + presetSelect.value + "-1to1.svg";
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
Expected: `17 tests passed` (the page must not require changes to `blockout.js`)

- [ ] **Step 3: Manual verification in a browser**

Open `tools/handheld_blockout/index.html` directly in a browser (double-click works; the page uses no XHR, so `file://` is fine). Check each of:

1. Split-side preset renders with grid, top-edge bar, and battery overlays; warnings area shows "no spacing warnings".
2. Switching preset to "Controls under (DMG-style)" and "Split + center strip" re-renders and rebuilds the input fields with that preset's numbers, including one "Volume:" fieldset per grip/battery volume (two for split, one for under).
3. Setting Undo center X to 196 and center Y to 50 shows an `ACTION-UNDO gap` warning in red; "Reset preset" clears it.
4. Unchecking "mm grid" and "internal volumes" removes the grid fill and the dashed battery rectangles.
5. "Export 1:1 SVG" downloads `handheld-blockout-split-1to1.svg`; opening the downloaded file shows the A4 sheet with calibration bar, face, profile section, and top edge.

If any check fails, fix `index.html` (or `blockout.js` if the defect is in generation) before committing, and re-run the Step 2 test command after any `blockout.js` change.

- [ ] **Step 4: Commit**

```bash
git add tools/handheld_blockout/index.html
git commit -m "Add parametric handheld blockout UI page" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: README and spec cross-link

**Files:**
- Create: `tools/handheld_blockout/README.md`
- Modify: `docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md` (Validation Plan, step 1)

- [ ] **Step 1: Write the README**

Create `tools/handheld_blockout/README.md`:

```markdown
# Handheld Case Blockout Tool

Parametric blockout viewer for the PuzzleScript handheld case. Open
`index.html` in a browser (no server or build step needed). Pick a layout
preset, tweak millimeter coordinates, watch spacing warnings, and export a
printable 1:1 SVG sheet (A4 landscape, 100 mm calibration bar).

This is a concept blockout tool, not CAD. Presets and thresholds come from
`docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md`.

Run the logic tests with:

    node tools/handheld_blockout/blockout_test.js
```

- [ ] **Step 2: Point the spec's validation plan at the tool**

In `docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md`, replace:

```markdown
1. Print the companion 1:1 sheet at 100% scale and verify with the printed
   calibration ruler:
   `docs/superpowers/notes/2026-07-07-handheld-case-blockout-1to1.svg`
```

with:

```markdown
1. Print the companion 1:1 sheet at 100% scale and verify with the printed
   calibration ruler:
   `docs/superpowers/notes/2026-07-07-handheld-case-blockout-1to1.svg`
   To test coordinate variations, regenerate the sheet from the parametric
   tool at `tools/handheld_blockout/index.html` (Export 1:1 SVG).
```

- [ ] **Step 3: Run the full tool test suite one more time**

Run: `node tools/handheld_blockout/blockout_test.js`
Expected: `17 tests passed`

- [ ] **Step 4: Commit**

```bash
git add tools/handheld_blockout/README.md docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md
git commit -m "Document handheld blockout tool and link it from the case spec" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification Notes for the Executor

- The engine test suite (`node src/tests/run_tests_node.js`) is unaffected by
  this work (nothing under `src/` changes); running it is optional.
- The `under` and `strip` preset coordinates are comparison blockouts derived
  from handoff Candidates B and C, not approved designs; do not "fix" them to
  match the split preset.
- `spacingWarnings` treats the Menu pill as flush (exempt from lens/edge
  clearance); that is intentional, documented in the code comment, and
  required for the `strip` preset (menu sits 1.25 mm-equivalent from the lens
  top as a circle approximation but is a 4.5 mm-tall flush pill in reality).
```

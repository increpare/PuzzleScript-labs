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

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        BLOCKOUT_PRESETS: BLOCKOUT_PRESETS,
        cloneParams: cloneParams,
        getParam: getParam,
        setParam: setParam,
        fmt: fmt,
        circleGap: circleGap,
        rectCircleClearance: rectCircleClearance,
        rectRectOverlap: rectRectOverlap,
        spacingWarnings: spacingWarnings
    };
}

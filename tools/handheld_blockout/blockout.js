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

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
        spacingWarnings: spacingWarnings,
        faceSvg: faceSvg,
        edgesSvg: edgesSvg,
        sectionSvg: sectionSvg
    };
}

"use strict";

// Mechanical PCB layout derived from the handheld blockout preset.
// Coordinates: body frame, origin top-left, +X right, +Y down (matches blockout.js).

var DEFAULT_PCB_INSET = 2; // body inset -> PCB outline (e.g. 120x118 -> 116x114)

function roundedRectPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r === 0) {
        return "M " + x + " " + y + " H " + (x + w) + " V " + (y + h) +
            " H " + x + " Z";
    }
    return "M " + (x + r) + " " + y +
        " H " + (x + w - r) +
        " A " + r + " " + r + " 0 0 1 " + (x + w) + " " + (y + r) +
        " V " + (y + h - r) +
        " A " + r + " " + r + " 0 0 1 " + (x + w - r) + " " + (y + h) +
        " H " + (x + r) +
        " A " + r + " " + r + " 0 0 1 " + x + " " + (y + h - r) +
        " V " + (y + r) +
        " A " + r + " " + r + " 0 0 1 " + (x + r) + " " + y +
        " Z";
}

function dpadSwitchCenters(dpad) {
    var offset = dpad.spacing != null ? dpad.spacing / 2 : dpad.size / 2 - dpad.arm / 2;
    return [
        { id: "SW_DPAD_UP", x: dpad.cx, y: dpad.cy - offset, part: dpad.switch },
        { id: "SW_DPAD_DOWN", x: dpad.cx, y: dpad.cy + offset, part: dpad.switch },
        { id: "SW_DPAD_LEFT", x: dpad.cx - offset, y: dpad.cy, part: dpad.switch },
        { id: "SW_DPAD_RIGHT", x: dpad.cx + offset, y: dpad.cy, part: dpad.switch }
    ];
}

function keepoutIdForBackZone(z, i) {
    var base = String(z.label || ("back_" + i))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return "back_" + (base || String(i));
}

function buildPcbLayout(params, options) {
    options = options || {};
    var inset = options.pcbInset != null ? options.pcbInset : DEFAULT_PCB_INSET;
    var b = params.body;
    var pcb = {
        x: inset,
        y: inset,
        w: b.w - inset * 2,
        h: b.h - inset * 2,
        r: Math.max(0, b.r - inset)
    };
    var s = params.screen;
    var t = params.topEdge;
    var fpcX0 = t.fpcKeepOut[0];
    var fpcX1 = t.fpcKeepOut[1];

    var lraZone = params.zones.filter(function (z) { return z.label === "LRA"; })[0] ||
        { x: 96, y: 87, w: 8, h: 8 };

    var anchors = dpadSwitchCenters(params.dpad).concat(
        params.buttons.map(function (btn) {
            return {
                id: "SW_" + btn.label,
                x: btn.cx,
                y: btn.cy,
                padD: btn.d
            };
        }),
        [{
            id: "SW_MENU",
            x: params.menu.cx,
            y: params.menu.cy,
            w: params.menu.w,
            h: params.menu.h,
            angle: params.menu.angle
        }, {
            id: "CONN_DSI_FFC",
            x: (fpcX0 + fpcX1) / 2,
            y: pcb.y + 1.5,
            note: "15-pin 1.0 mm FFC, top edge; align with fpcKeepOut"
        }, {
            id: "CONN_USB_C_BACK",
            x: t.usbX,
            y: pcb.y,
            note: "back-mounted SMD USB-C on top edge (rear shell has local bump)"
        }, {
            id: "SW_PWR_SLIDE",
            x: t.pwrX,
            y: pcb.y + 1.5,
            note: "top-edge power slide switch (SPDT, gates 3V3 buck-boost EN)"
        }, {
            id: "SW_VOLUME",
            x: b.w - 1.5,
            y: params.rightEdge.volY,
            note: "right-edge volume rocker"
        }, {
            id: "ACT_LRA",
            x: lraZone.x + lraZone.w / 2,
            y: lraZone.y + lraZone.h / 2
        }, {
            id: "PAD_PIEZO",
            x: params.piezo.cx,
            y: params.piezo.cy,
            d: params.piezo.d,
            note: "shell-layer piezo; wire to these pads only"
        }]
    );

    var holeInset = options.mountingHoleInset != null ? options.mountingHoleInset : 5;
    var holeD = options.mountingHoleD != null ? options.mountingHoleD : 2.2;
    var mountingHoles = [
        { id: "MH_TL", x: pcb.x + holeInset, y: pcb.y + holeInset, d: holeD },
        { id: "MH_TR", x: pcb.x + pcb.w - holeInset, y: pcb.y + holeInset, d: holeD },
        { id: "MH_BL", x: pcb.x + holeInset, y: pcb.y + pcb.h - holeInset, d: holeD },
        { id: "MH_BR", x: pcb.x + pcb.w - holeInset, y: pcb.y + pcb.h - holeInset, d: holeD }
    ];
    var supportKeepouts = (params.supports || []).map(function (z) {
        return {
            id: String(z.label).toLowerCase(),
            layer: "mechanical",
            side: z.face || "front",
            x: z.x,
            y: z.y,
            w: z.w,
            h: z.h,
            role: z.role || "support",
            note: z.label + " shell support/standoff pad"
        };
    });
    var backKeepouts = (params.backZones || []).map(function (z, i) {
        return {
            id: keepoutIdForBackZone(z, i),
            layer: "back",
            side: "back",
            x: z.x,
            y: z.y,
            w: z.w,
            h: z.h,
            role: z.role || "service",
            note: z.label + " (PCB bottom / rear pocket)"
        };
    });

    return {
        meta: {
            name: params.name,
            source: "tools/handheld_blockout/blockout.js",
            coordinateSystem: "body_top_left_y_down_mm",
            architecture: params.architecture || "single_sided",
            depthProfile: params.depthProfile || null,
            kicadImportNote: "Flip Y when placing in KiCad (Y-up): kicad_y = pcb.h - (y - pcb.y) - pcb.y ... use body.h or pcb origin helper below",
            pcbInset: inset
        },
        body: { x: 0, y: 0, w: b.w, h: b.h, r: b.r, depth: b.depth },
        pcb: pcb,
        edgeCutsPath: roundedRectPath(pcb.x, pcb.y, pcb.w, pcb.h, pcb.r),
        keepouts: [
            {
                id: "display_module",
                layer: "front",
                side: "front",
                x: s.moduleX,
                y: s.moduleY,
                w: s.moduleW,
                h: s.moduleH,
                note: "front display stack envelope; rear parts here require Z-stack clearance"
            }, {
                id: "display_active",
                layer: "user",
                side: "front",
                x: s.activeX,
                y: s.activeY,
                w: s.activeW,
                h: s.activeH,
                note: "visible lens opening"
            }, {
                id: "fpc_top_keepout",
                layer: "front",
                side: "front",
                x: fpcX0,
                y: 0,
                w: fpcX1 - fpcX0,
                h: params.band.y0,
                note: "front-side no-tall-parts zone under display FPC fold"
            }, {
                id: "control_band",
                layer: "user",
                x: 0,
                y: params.band.y0,
                w: b.w,
                h: params.band.y1 - params.band.y0,
                note: "front: switches + piezo; back: one pouch low, ESP/PMIC above"
            }
        ].concat(supportKeepouts).concat(backKeepouts),
        anchors: anchors,
        mountingHoles: mountingHoles
    };
}

function toKicadY(bodyH, y) {
    return bodyH - y;
}

function layoutToJson(layout) {
    return JSON.stringify(layout, null, 2) + "\n";
}

function layoutToSvg(layout, opts) {
    opts = opts || {};
    var pad = opts.margin != null ? opts.margin : 4;
    var b = layout.body;
    var vw = b.w + pad * 2;
    var vh = b.h + pad * 2;
    var ox = pad;
    var oy = pad;
    var out = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + (vw * 4) +
            'px" viewBox="0 0 ' + vw + " " + vh + '">',
        '<rect x="0" y="0" width="' + vw + '" height="' + vh + '" fill="#f6f6f0"/>',
        '<g transform="translate(' + ox + "," + oy + ')">'
    ];

    out.push('<path d="' + layout.edgeCutsPath + '" fill="none" stroke="#c00" stroke-width="0.35"/>');
    out.push('<text x="2" y="-1.5" font-size="2.2" font-family="sans-serif" fill="#c00">Edge.Cuts (PCB outline)</text>');

    layout.keepouts.forEach(function (k) {
        var stroke = k.layer === "front" ? "#f80" :
            (k.layer === "back" ? "#08c" : (k.layer === "mechanical" ? "#090" : "#88a"));
        var dash = k.layer === "front" || k.layer === "back" || k.layer === "mechanical" ?
            ' stroke-dasharray="1.2,0.8"' : "";
        out.push('<rect x="' + k.x + '" y="' + k.y + '" width="' + k.w + '" height="' + k.h +
            '" fill="none" stroke="' + stroke + '" stroke-width="0.25"' + dash + "/>");
        out.push('<text x="' + (k.x + k.w / 2) + '" y="' + (k.y - 0.6) +
            '" font-size="1.8" text-anchor="middle" font-family="sans-serif" fill="' + stroke + '">' +
            k.id + "</text>");
    });

    layout.anchors.forEach(function (a) {
        out.push('<circle cx="' + a.x + '" cy="' + a.y + '" r="0.8" fill="#000"/>');
        out.push('<text x="' + a.x + '" y="' + (a.y - 1.2) +
            '" font-size="1.6" text-anchor="middle" font-family="sans-serif" fill="#222">' +
            a.id + "</text>");
    });

    layout.mountingHoles.forEach(function (h) {
        out.push('<circle cx="' + h.x + '" cy="' + h.y + '" r="' + (h.d / 2) +
            '" fill="none" stroke="#060" stroke-width="0.3"/>');
    });

    out.push("</g>");
    out.push('<text x="' + pad + '" y="' + (vh - 1) +
        '" font-size="2" font-family="sans-serif" fill="#444">' +
        layout.meta.name + " — mechanical export for KiCad</text>");
    out.push("</svg>");
    return out.join("\n") + "\n";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        DEFAULT_PCB_INSET: DEFAULT_PCB_INSET,
        roundedRectPath: roundedRectPath,
        dpadSwitchCenters: dpadSwitchCenters,
        keepoutIdForBackZone: keepoutIdForBackZone,
        buildPcbLayout: buildPcbLayout,
        toKicadY: toKicadY,
        layoutToJson: layoutToJson,
        layoutToSvg: layoutToSvg
    };
}

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var CARD_DIR = path.join(__dirname, "..");
var SCHEMATIC_DIR = __dirname;
var REPO_ROOT = path.join(__dirname, "..", "..", "..");
var boardPreview = require(path.join(REPO_ROOT, "tools", "handheld_blockout", "board_preview.js"));
var jlcParts = require("./jlc_parts.js");
var uuidCounter = 0;
var PCB_DRC_CLEARANCE_MM = 0.6;
var PCB_TEXT_DRC_CLEARANCE_MM = 2.0;
var EDGE_ARC_SEGMENTS = 6;

function uuid() {
    uuidCounter++;
    var hex = crypto.createHash("sha1")
        .update("pscard-kicad:" + uuidCounter)
        .digest("hex")
        .slice(0, 32);
    var variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        "4" + hex.slice(13, 16),
        variant + hex.slice(17, 20),
        hex.slice(20, 32)
    ].join("-");
}

function esc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function loadJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

function buildPinNetMap(connections) {
    var map = {};
    connections.forEach(function (conn) {
        conn.nodes.forEach(function (node) {
            var key = node[0] + "\0" + node[1];
            map[key] = conn.net;
        });
    });
    return map;
}

function netsBySheet(connections, components) {
    var refSheet = {};
    components.forEach(function (c) { refSheet[c.ref] = c.sheet; });
    var sheetNets = {};
    connections.forEach(function (conn) {
        var sheets = {};
        conn.nodes.forEach(function (node) {
            var sh = refSheet[node[0]];
            if (sh) {
                sheets[sh] = true;
            }
        });
        Object.keys(sheets).forEach(function (sh) {
            if (!sheetNets[sh]) {
                sheetNets[sh] = {};
            }
            sheetNets[sh][conn.net] = true;
        });
    });
    return sheetNets;
}

function crossSheetNets(connections, components) {
    var refSheet = {};
    components.forEach(function (c) { refSheet[c.ref] = c.sheet; });
    var netSheets = {};
    connections.forEach(function (conn) {
        var sheets = {};
        conn.nodes.forEach(function (node) {
            var sh = refSheet[node[0]];
            if (sh) {
                sheets[sh] = true;
            }
        });
        var keys = Object.keys(sheets);
        if (keys.length > 1) {
            netSheets[conn.net] = keys;
        }
    });
    return netSheets;
}

function libSymbolsBlock() {
    return [
        "(lib_symbols",
        "  (symbol \"PSCard:Block2\" (pin_numbers hide) (pin_names (offset 0.254)) (exclude_from_sim no) (in_bom yes) (on_board yes)",
        "    (property \"Reference\" \"U\" (at 0 6.35 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"Block2\" (at 0 -6.35 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"\" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))",
        "    (symbol \"Block2_0_1\"",
        "      (rectangle (start -7.62 -5.08) (end 7.62 5.08) (stroke (width 0.254) (type default)) (fill (type background)))",
        "    )",
        "    (symbol \"Block2_1_1\"",
        "      (pin passive line (at -10.16 2.54 0) (length 2.54) (name \"1\" (effects (font (size 1.27 1.27)))) (number \"1\" (effects (font (size 1.27 1.27)))))",
        "      (pin passive line (at -10.16 -2.54 0) (length 2.54) (name \"2\" (effects (font (size 1.27 1.27)))) (number \"2\" (effects (font (size 1.27 1.27)))))",
        "      (pin passive line (at 10.16 2.54 180) (length 2.54) (name \"3\" (effects (font (size 1.27 1.27)))) (number \"3\" (effects (font (size 1.27 1.27)))))",
        "      (pin passive line (at 10.16 -2.54 180) (length 2.54) (name \"4\" (effects (font (size 1.27 1.27)))) (number \"4\" (effects (font (size 1.27 1.27)))))",
        "    )",
        "  )",
        "  (symbol \"Device:R\" (pin_numbers hide) (pin_names (offset 0)) (exclude_from_sim no) (in_bom yes) (on_board yes)",
        "    (property \"Reference\" \"R\" (at 2.032 0 90) (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"R\" (at 0 0 90) (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"\" (at -1.778 0 90) (effects (font (size 1.27 1.27)) hide))",
        "    (symbol \"R_0_1\" (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254) (type default)) (fill (type none))))",
        "    (symbol \"R_1_1\"",
        "      (pin passive line (at 0 3.81 270) (length 1.27) (name \"~\" (effects (font (size 1.27 1.27)))) (number \"1\" (effects (font (size 1.27 1.27)))))",
        "      (pin passive line (at 0 -3.81 90) (length 1.27) (name \"~\" (effects (font (size 1.27 1.27)))) (number \"2\" (effects (font (size 1.27 1.27)))))",
        "    )",
        "  )",
        "  (symbol \"Device:C\" (pin_numbers hide) (pin_names (offset 0.254)) (exclude_from_sim no) (in_bom yes) (on_board yes)",
        "    (property \"Reference\" \"C\" (at 0.254 2.794 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"C\" (at 0.254 -2.794 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"\" (at 0.254 0 0) (effects (font (size 1.27 1.27)) hide))",
        "    (symbol \"C_0_1\"",
        "      (polyline (pts (xy -2.032 -0.762) (xy 2.032 -0.762)) (stroke (width 0.508) (type default)) (fill (type none)))",
        "      (polyline (pts (xy -2.032 0.762) (xy 2.032 0.762)) (stroke (width 0.508) (type default)) (fill (type none)))",
        "    )",
        "    (symbol \"C_1_1\"",
        "      (pin passive line (at 0 3.81 270) (length 2.794) (name \"~\" (effects (font (size 1.27 1.27)))) (number \"1\" (effects (font (size 1.27 1.27)))))",
        "      (pin passive line (at 0 -3.81 90) (length 2.794) (name \"~\" (effects (font (size 1.27 1.27)))) (number \"2\" (effects (font (size 1.27 1.27)))))",
        "    )",
        "  )",
        "  (symbol \"Switch:SW_Push\" (pin_numbers hide) (pin_names (offset 1.016) hide) (exclude_from_sim no) (in_bom yes) (on_board yes)",
        "    (property \"Reference\" \"SW\" (at 1.27 2.54 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"SW_Push\" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"\" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))",
        "    (symbol \"SW_Push_0_1\" (circle (center 2.032 0) (radius 0.635) (stroke (width 0.254) (type default)) (fill (type none))))",
        "    (symbol \"SW_Push_1_1\"",
        "      (pin passive line (at 0 2.54 270) (length 2.032) (name \"1\" (effects (font (size 1.27 1.27)))) (number \"1\" (effects (font (size 1.27 1.27)))))",
        "      (pin passive line (at 0 -2.54 90) (length 2.032) (name \"2\" (effects (font (size 1.27 1.27)))) (number \"2\" (effects (font (size 1.27 1.27)))))",
        "    )",
        "  )",
        "  (symbol \"Device:LED\" (pin_numbers hide) (pin_names (offset 1.016) hide) (exclude_from_sim no) (in_bom yes) (on_board yes)",
        "    (property \"Reference\" \"D\" (at 0 2.54 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"LED\" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"\" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))",
        "    (symbol \"LED_0_1\" (polyline (pts (xy -1.27 -1.27) (xy -1.27 1.27) (xy 1.27 0) (xy -1.27 -1.27)) (stroke (width 0.254) (type default)) (fill (type none))))",
        "    (symbol \"LED_1_1\"",
        "      (pin passive line (at -3.81 0 0) (length 2.54) (name \"K\" (effects (font (size 1.27 1.27)))) (number \"1\" (effects (font (size 1.27 1.27)))))",
        "      (pin passive line (at 3.81 0 180) (length 2.54) (name \"A\" (effects (font (size 1.27 1.27)))) (number \"2\" (effects (font (size 1.27 1.27)))))",
        "    )",
        "  )",
        "  (symbol \"power:GND\" (power) (pin_numbers hide) (pin_names (offset 0)) (exclude_from_sim no) (in_bom yes) (on_board yes)",
        "    (property \"Reference\" \"#PWR\" (at 0 -6.35 0) (effects (font (size 1.27 1.27)) hide))",
        "    (property \"Value\" \"GND\" (at 0 -3.81 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"\" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))",
        "    (symbol \"GND_0_1\" (polyline (pts (xy 0 0) (xy 0 -1.27) (xy 1.27 -1.27) (xy 0 -2.54) (xy -1.27 -1.27) (xy 0 -1.27)) (stroke (width 0) (type default)) (fill (type none))))",
        "    (symbol \"GND_1_1\" (pin power_in line (at 0 0 270) (length 0) (name \"GND\" (effects (font (size 1.27 1.27)))) (number \"1\" (effects (font (size 1.27 1.27))))))",
        "  )",
        "  (symbol \"power:+3V3\" (power) (pin_numbers hide) (pin_names (offset 0)) (exclude_from_sim no) (in_bom yes) (on_board yes)",
        "    (property \"Reference\" \"#PWR\" (at 0 -3.81 0) (effects (font (size 1.27 1.27)) hide))",
        "    (property \"Value\" \"+3V3\" (at 0 3.556 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"\" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))",
        "    (symbol \"+3V3_0_1\" (polyline (pts (xy -0.762 1.27) (xy 0 2.54)) (stroke (width 0) (type default)) (fill (type none)))",
        "      (polyline (pts (xy 0 0) (xy 0 2.54)) (stroke (width 0) (type default)) (fill (type none)))",
        "      (polyline (pts (xy 0 2.54) (xy 0.762 1.27)) (stroke (width 0) (type default)) (fill (type none)))",
        "    )",
        "    (symbol \"+3V3_1_1\" (pin power_out line (at 0 0 90) (length 0) (name \"+3V3\" (effects (font (size 1.27 1.27)))) (number \"1\" (effects (font (size 1.27 1.27))))))",
        "  )",
        ")"
    ].join("\n");
}

function symbolLibId(comp) {
    var ref = comp.ref;
    if (ref.charAt(0) === "R") {
        return "Device:R";
    }
    if (ref.charAt(0) === "C") {
        return "Device:C";
    }
    if (ref.indexOf("SW") === 0) {
        return "Switch:SW_Push";
    }
    if (ref.charAt(0) === "D") {
        return "Device:LED";
    }
    return "PSCard:Block2";
}

function symbolInstance(comp, atX, atY, projectPath) {
    var id = uuid();
    var lib = symbolLibId(comp);
    var rot = 0;
    var footprintName = comp.easyeda_footprint || comp.footprint || "";
    var lines = [
        "  (symbol (lib_id \"" + lib + "\") (at " + atX + " " + atY + " " + rot + ") (unit 1)",
        "    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (fields_autoplaced)",
        "    (uuid \"" + id + "\")",
        "    (property \"Reference\" \"" + esc(comp.ref) + "\" (at " + atX + " " + (atY - 6) + " 0)",
        "      (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"" + esc(comp.value) + "\" (at " + atX + " " + (atY + 6) + " 0)",
        "      (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"" + esc(footprintName) + "\" (at " + atX + " " + atY + " 0)",
        "      (effects (font (size 1.27 1.27)) hide))",
        "    (property \"Datasheet\" \"~\" (at " + atX + " " + atY + " 0)",
        "      (effects (font (size 1.27 1.27)) hide))"
    ];
    if (comp.gate) {
        lines.push(
            "    (property \"Gate\" \"" + esc(comp.gate) + "\" (at " + atX + " " + atY + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))"
        );
    }
    if (comp.lcsc) {
        lines.push(
            "    (property \"LCSC\" \"" + esc(comp.lcsc) + "\" (at " + atX + " " + atY + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))"
        );
    }
    if (comp.mpn) {
        lines.push(
            "    (property \"MPN\" \"" + esc(comp.mpn) + "\" (at " + atX + " " + atY + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))"
        );
    }
    lines.push(
        "    (instances (project \"card\" (path \"" + projectPath + "\" (reference \"" + esc(comp.ref) + "\") (unit 1))))",
        "  )"
    );
    return lines.join("\n");
}

function localLabel(net, x, y, rot) {
    return [
        "  (label \"" + esc(net) + "\" (at " + x + " " + y + " " + rot + ") (fields_autoplaced)",
        "    (effects (font (size 1.27 1.27)) (justify left)) (uuid \"" + uuid() + "\"))"
    ].join("\n");
}

function buildSheet(model, sheetId, sheetFile, projectPath) {
    var comps = model.components.filter(function (c) { return c.sheet === sheetId; });
    var pinNet = buildPinNetMap(model.connections);
    var cross = crossSheetNets(model.connections, model.components);
    var lines = [
        "(kicad_sch",
        "  (version 20250114)",
        "  (generator \"PuzzleScript generate_kicad.js\")",
        "  (generator_version \"1.0\")",
        "  (uuid \"" + uuid() + "\")",
        "  (paper \"A4\")",
        "  (title_block",
        "    (title \"PuzzleScript Card — " + esc(sheetId) + "\")",
        "    (date \"" + model.meta.date + "\")",
        "    (rev \"spin1\")",
        "    (comment 1 \"Auto-generated from connectivity.json\")",
        "    (comment 2 \"Same-net labels connect; globals cross sheets\")",
        "  )",
        libSymbolsBlock()
    ];

    comps.forEach(function (comp, i) {
        var col = i % 4;
        var row = Math.floor(i / 4);
        var x = 35 + col * 45;
        var y = 35 + row * 30;
        lines.push(symbolInstance(comp, x, y, projectPath));
        Object.keys(pinNet).forEach(function (key) {
            var parts = key.split("\0");
            if (parts[0] !== comp.ref) {
                return;
            }
            var pin = parts[1];
            var net = pinNet[key];
            var lx = x + 18;
            var ly = y + ((pin.charCodeAt(0) + (pin.length || 0)) % 5) * 2.5 - 5;
            lines.push(localLabel(net, lx, ly, 0));
        });
    });

    var netIndex = 0;
    Object.keys(cross).forEach(function (net) {
        if (cross[net].indexOf(sheetId) === -1) {
            return;
        }
        var gy = 20 + (netIndex % 12) * 6;
        netIndex++;
        lines.push([
            "  (global_label \"" + esc(net) + "\" (shape input) (at 280 " + gy + " 0) (fields_autoplaced)",
            "    (effects (font (size 1.27 1.27)) (justify left))",
            "    (uuid \"" + uuid() + "\")",
            "    (property \"Intersheetrefs\" \"${INTERSHEET_REFS}\" (at 280 " + gy + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))",
            "  )"
        ].join("\n"));
    });

    if (sheetId === "power") {
        lines.push("  (symbol (lib_id \"power:+3V3\") (at 280 260 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes)",
            "    (uuid \"" + uuid() + "\") (property \"Reference\" \"#PWR01\" (at 280 256 0) (effects (font (size 1.27 1.27)) hide))",
            "    (property \"Value\" \"+3V3\" (at 280 263 0) (effects (font (size 1.27 1.27))))",
            "    (instances (project \"card\" (path \"" + projectPath + "\" (reference \"#PWR01\") (unit 1)))))");
        lines.push("  (symbol (lib_id \"power:GND\") (at 280 270 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes)",
            "    (uuid \"" + uuid() + "\") (property \"Reference\" \"#PWR02\" (at 280 276 0) (effects (font (size 1.27 1.27)) hide))",
            "    (property \"Value\" \"GND\" (at 280 266 0) (effects (font (size 1.27 1.27))))",
            "    (instances (project \"card\" (path \"" + projectPath + "\" (reference \"#PWR02\") (unit 1)))))");
    }

    lines.push(")");
    return lines.join("\n") + "\n";
}

function buildRootSheet(model) {
    var lines = [
        "(kicad_sch",
        "  (version 20250114)",
        "  (generator \"PuzzleScript generate_kicad.js\")",
        "  (generator_version \"1.0\")",
        "  (uuid \"" + uuid() + "\")",
        "  (paper \"A3\")",
        "  (title_block",
        "    (title \"PuzzleScript Card\")",
        "    (date \"" + model.meta.date + "\")",
        "    (rev \"spin1\")",
        "  )",
        libSymbolsBlock()
    ];
    model.sheets.forEach(function (sh, i) {
        var col = i % 3;
        var row = Math.floor(i / 3);
        var x = 30 + col * 95;
        var y = 30 + row * 70;
        var sid = uuid();
        lines.push("  (sheet (at " + x + " " + y + ") (size 80 60) (fields_autoplaced)",
            "    (stroke (width 0.1524) (type solid)) (fill (type none)) (uuid \"" + sid + "\")",
            "    (property \"Sheetname\" \"" + esc(sh.title) + "\" (at " + x + " " + (y - 2) + " 0)",
            "      (effects (font (size 1.27 1.27)) (justify left bottom)))",
            "    (property \"Sheetfile\" \"" + esc("schematic/" + sh.file) + "\" (at " + x + " " + (y + 62) + " 0)",
            "      (effects (font (size 1.27 1.27)) (justify left top)))",
            "  )");
    });
    lines.push(")");
    return lines.join("\n") + "\n";
}

function bodyYToKicad(y, bodyH) {
    return bodyH - y;
}

function keepoutDrawingLayer(keepout) {
    if (keepout.layer === "back") {
        return "Eco2.User";
    }
    if (keepout.layer === "mechanical") {
        return "Dwgs.User";
    }
    if (keepout.layer === "user") {
        return "Cmts.User";
    }
    return "Eco1.User";
}

function fmt(n) {
    var out = Number(n).toFixed(3).replace(/\.?0+$/, "");
    return out === "-0" ? "0" : out;
}

function clamp(n, min, max) {
    if (min > max) {
        return n;
    }
    return Math.max(min, Math.min(max, n));
}

function pcbBounds(layout, bodyH) {
    return {
        minX: layout.pcb.x,
        maxX: layout.pcb.x + layout.pcb.w,
        minY: bodyYToKicad(layout.pcb.y + layout.pcb.h, bodyH),
        maxY: bodyYToKicad(layout.pcb.y, bodyH)
    };
}

function safeTextPosition(x, y, bounds, text, size) {
    var fontSize = size || 1;
    var halfW = String(text || "").length * fontSize * 0.33;
    var halfH = fontSize * 0.5;
    return {
        x: clamp(x, bounds.minX + PCB_TEXT_DRC_CLEARANCE_MM + halfW, bounds.maxX - PCB_TEXT_DRC_CLEARANCE_MM - halfW),
        y: clamp(y, bounds.minY + PCB_TEXT_DRC_CLEARANCE_MM + halfH, bounds.maxY - PCB_TEXT_DRC_CLEARANCE_MM - halfH)
    };
}

function safeFootprintPosition(component, bodyH, bounds, w, h) {
    return {
        x: clamp(component.cx, bounds.minX + PCB_DRC_CLEARANCE_MM + w / 2, bounds.maxX - PCB_DRC_CLEARANCE_MM - w / 2),
        y: clamp(bodyYToKicad(component.cy, bodyH), bounds.minY + PCB_DRC_CLEARANCE_MM + h / 2, bounds.maxY - PCB_DRC_CLEARANCE_MM - h / 2)
    };
}

function enumeratePcbNets(model) {
    var nets = [""];
    var byName = { "": 0 };
    model.connections.forEach(function (conn) {
        if (Object.prototype.hasOwnProperty.call(byName, conn.net)) {
            return;
        }
        byName[conn.net] = nets.length;
        nets.push(conn.net);
    });
    return { nets: nets, byName: byName };
}

function pinSortKey(pin) {
    if (/^\d+$/.test(pin)) {
        return "0:" + ("0000" + pin).slice(-5);
    }
    return "1:" + pin;
}

function componentPadMap(model) {
    var byRef = {};
    model.connections.forEach(function (conn) {
        conn.nodes.forEach(function (node) {
            var ref = node[0];
            if (!byRef[ref]) {
                byRef[ref] = [];
            }
            byRef[ref].push({ pin: node[1], net: conn.net });
        });
    });
    Object.keys(byRef).forEach(function (ref) {
        byRef[ref].sort(function (a, b) {
            return pinSortKey(a.pin).localeCompare(pinSortKey(b.pin));
        });
    });
    return byRef;
}

function padPosition(index, total, w, h) {
    if (total <= 1) {
        return { x: 0, y: 0 };
    }
    var topCount = Math.ceil(total / 2);
    var isTop = index < topCount;
    var sideIndex = isTop ? index : index - topCount;
    var sideCount = isTop ? topCount : total - topCount;
    var x = sideCount === 1 ? 0 : -w / 2 + (sideIndex + 0.5) * (w / sideCount);
    return {
        x: x,
        y: isTop ? -h / 2 : h / 2
    };
}

function padSize(component, padCount) {
    if (padCount > 12) {
        return 0.42;
    }
    if (component.w < 2 || component.h < 1) {
        return 0.36;
    }
    return 0.55;
}

function footprintIsOpen(component) {
    return jlcParts.footprintIsOpen(component);
}

function footprintLibraryName(component) {
    return jlcParts.footprintLibraryName(component);
}

function completePads(pads, pins) {
    var byPin = {};
    pads.forEach(function (pad) {
        byPin[pad.pin] = pad;
    });
    return pins.map(function (pin) {
        return byPin[pin] || { pin: pin, net: "" };
    });
}

function fitProfile(component) {
    var footprint = component.footprint || "";
    if (component.ref.indexOf("TP") === 0 || footprint === "TestPoint") {
        return {
            source: "TestPoint_Pad_D1.5mm",
            shape: "circle",
            bodyW: 1.5,
            bodyH: 1.5,
            padMode: "testpoint"
        };
    }
    if (footprint === "0402") {
        return {
            source: "R_0402_1005Metric",
            bodyW: 1.0,
            bodyH: 0.5,
            padMode: "two-terminal",
            padPins: ["1", "2"],
            padOffset: 0.45,
            padW: 0.45,
            padH: 0.55
        };
    }
    if (footprint === "0603") {
        return {
            source: component.ref.charAt(0) === "D" ? "LED_0603_1608Metric" : "C_0603_1608Metric",
            bodyW: 1.6,
            bodyH: 0.8,
            padMode: "two-terminal",
            padPins: component.ref.charAt(0) === "D" ? ["A", "K"] : ["1", "2"],
            padOffset: 0.75,
            padW: 0.75,
            padH: 0.95
        };
    }
    if (footprint === "EVPAK-side-push-3.9x2.9") {
        return {
            source: "Panasonic_EVPAK_side_push_3.9x2.9",
            bodyW: 3.9,
            bodyH: 2.9,
            padMode: "two-terminal",
            padPins: ["1", "2"],
            padOffset: 1.35,
            padW: 0.8,
            padH: 1.1
        };
    }
    if (footprint === "SOT23") {
        return {
            source: "SOT-23_logical",
            bodyW: 3.0,
            bodyH: 3.0,
            padMode: "sot23",
            padW: 0.65,
            padH: 0.9
        };
    }
    return {
        source: footprint,
        bodyW: component.w,
        bodyH: component.h,
        padMode: "perimeter"
    };
}

function padNetId(netByName, net) {
    if (Object.prototype.hasOwnProperty.call(netByName, net)) {
        return netByName[net];
    }
    return 0;
}

function footprintProperty(name, value, x, y, layer, size, thickness, hide) {
    return "    (property \"" + esc(name) + "\" \"" + esc(value) + "\" (at " + fmt(x) + " " + fmt(y) + " 0) (layer \"" + layer + "\")" +
        (hide ? " (hide yes)" : "") +
        "\n      (uuid \"" + uuid() + "\")" +
        "\n      (effects (font (size " + fmt(size) + " " + fmt(size) + ")" +
        (thickness ? " (thickness " + fmt(thickness) + ")" : "") + ")))";
}

function padLine(pad, spec, layers, netByName) {
    return "    (pad \"" + esc(pad.pin) + "\" smd " + spec.shape + " (at " + fmt(spec.x) + " " + fmt(spec.y) + " 0) (size " + fmt(spec.w) + " " + fmt(spec.h) + ")" +
        "\n      (layers \"" + layers.copper + "\" \"" + layers.paste + "\" \"" + layers.mask + "\") (net " + padNetId(netByName, pad.net) + " \"" + esc(pad.net) + "\") (pinfunction \"" + esc(pad.pin) + "\") (pintype \"passive\") (uuid \"" + uuid() + "\"))";
}

function fitPadSpecs(component, pads, profile) {
    var sourcePads = pads;
    if (profile.padPins) {
        sourcePads = completePads(pads, profile.padPins);
    }
    if (profile.padMode === "testpoint") {
        return completePads(pads, ["1"]).map(function (pad) {
            return {
                pad: pad,
                spec: { shape: "circle", x: 0, y: 0, w: 1.5, h: 1.5 }
            };
        });
    }
    if (profile.padMode === "two-terminal") {
        return sourcePads.map(function (pad, i) {
            return {
                pad: pad,
                spec: {
                    shape: "rect",
                    x: i === 0 ? -profile.padOffset : profile.padOffset,
                    y: 0,
                    w: profile.padW,
                    h: profile.padH
                }
            };
        });
    }
    if (profile.padMode === "sot23") {
        var positions = [
            { x: -0.95, y: 0.95 },
            { x: 0.95, y: 0.95 },
            { x: 0, y: -0.95 }
        ];
        return sourcePads.map(function (pad, i) {
            var pos = positions[i] || padPosition(i, sourcePads.length, profile.bodyW, profile.bodyH);
            return {
                pad: pad,
                spec: { shape: "rect", x: pos.x, y: pos.y, w: profile.padW, h: profile.padH }
            };
        });
    }
    return sourcePads.map(function (pad, i) {
        var pos = padPosition(i, sourcePads.length, profile.bodyW, profile.bodyH);
        var pSize = padSize(component, sourcePads.length);
        return {
            pad: pad,
            spec: { shape: "rect", x: pos.x, y: pos.y, w: pSize, h: pSize }
        };
    });
}

function jlcFootprintProperties(component, fabLayer, h) {
    var lines = [];
    if (component.lcsc) {
        lines.push(footprintProperty("LCSC", component.lcsc, 0, 0, fabLayer, 1.27, 0, true));
    }
    if (component.mpn) {
        lines.push(footprintProperty("MPN", component.mpn, 0, 0, fabLayer, 1.27, 0, true));
    }
    if (component.jlc_status) {
        lines.push(footprintProperty("JLC_Status", component.jlc_status, 0, h / 2 + 3.6, "Cmts.User", 0.65, 0.1, false));
    }
    return lines;
}

function fitFootprint(component, pads, netByName, bodyH, bounds) {
    var sidePrefix = component.side === "back" ? "B" : "F";
    var copperLayer = sidePrefix + ".Cu";
    var pasteLayer = sidePrefix + ".Paste";
    var maskLayer = sidePrefix + ".Mask";
    var silkLayer = sidePrefix + ".SilkS";
    var fabLayer = sidePrefix + ".Fab";
    var profile = fitProfile(component);
    var w = profile.bodyW;
    var h = profile.bodyH;
    var pos = safeFootprintPosition(component, bodyH, bounds, w, h);
    var x = pos.x;
    var y = pos.y;
    var lines = [
        "  (footprint \"" + esc(footprintLibraryName(component)) + "\" (layer \"" + copperLayer + "\")",
        "    (uuid \"" + uuid() + "\")",
        "    (at " + fmt(x) + " " + fmt(y) + " 0)",
        footprintProperty("Reference", component.ref, 0, -h / 2 - 1.2, silkLayer, 0.9, 0.12, false),
        footprintProperty("Value", component.value, 0, h / 2 + 1.2, fabLayer, 0.7, 0.1, false),
        footprintProperty("Datasheet", "", 0, 0, "F.Fab", 1.27, 0, true),
        footprintProperty("Description", "", 0, 0, "F.Fab", 1.27, 0, true)
    ];
    jlcFootprintProperties(component, fabLayer, h).forEach(function (line) {
        lines.push(line);
    });
    lines.push(
        "    (attr smd)",
        "    (duplicate_pad_numbers_are_jumpers no)",
        "    (fp_text user \"JLC footprint anchor\" (at 0 0 0) (layer \"Cmts.User\")",
        "      (effects (font (size 0.7 0.7) (thickness 0.1))) (uuid \"" + uuid() + "\"))",
        "    (fp_text user \"source footprint: " + esc(profile.source) + "\" (at 0 " + fmt(h / 2 + 2.4) + " 0) (layer \"Cmts.User\")",
        "      (effects (font (size 0.65 0.65) (thickness 0.1))) (uuid \"" + uuid() + "\"))"
    );
    if (profile.shape === "circle" || component.shape === "circle") {
        lines.push("    (fp_circle (center 0 0) (end " + fmt(w / 2) + " 0) (stroke (width 0.12) (type solid)) (fill no) (layer \"" + fabLayer + "\") (uuid \"" + uuid() + "\"))");
    } else {
        lines.push("    (fp_rect (start " + fmt(-w / 2) + " " + fmt(-h / 2) + ") (end " + fmt(w / 2) + " " + fmt(h / 2) + ") (stroke (width 0.12) (type solid)) (fill no) (layer \"" + fabLayer + "\") (uuid \"" + uuid() + "\"))");
    }
    fitPadSpecs(component, pads, profile).forEach(function (entry) {
        lines.push(padLine(entry.pad, entry.spec, {
            copper: copperLayer,
            paste: pasteLayer,
            mask: maskLayer
        }, netByName));
    });
    lines.push("    (embedded_fonts no)");
    lines.push("  )");
    return lines.join("\n");
}

function previewFootprint(component, pads, netByName, bodyH, bounds) {
    var sidePrefix = component.side === "back" ? "B" : "F";
    var copperLayer = sidePrefix + ".Cu";
    var pasteLayer = sidePrefix + ".Paste";
    var maskLayer = sidePrefix + ".Mask";
    var silkLayer = sidePrefix + ".SilkS";
    var fabLayer = sidePrefix + ".Fab";
    var w = component.w;
    var h = component.h;
    var pos = safeFootprintPosition(component, bodyH, bounds, w, h);
    var x = pos.x;
    var y = pos.y;
    var pSize = padSize(component, pads.length);
    var lines = [
        "  (footprint \"" + esc(footprintLibraryName(component)) + "\" (layer \"" + copperLayer + "\")",
        "    (uuid \"" + uuid() + "\")",
        "    (at " + fmt(x) + " " + fmt(y) + " 0)",
        footprintProperty("Reference", component.ref, 0, -h / 2 - 1.2, silkLayer, 0.9, 0.12, false),
        footprintProperty("Value", component.value, 0, h / 2 + 1.2, fabLayer, 0.7, 0.1, false),
        footprintProperty("Datasheet", "", 0, 0, "F.Fab", 1.27, 0, true),
        footprintProperty("Description", "", 0, 0, "F.Fab", 1.27, 0, true)
    ];
    jlcFootprintProperties(component, fabLayer, h).forEach(function (line) {
        lines.push(line);
    });
    lines.push(
        "    (attr smd)",
        "    (duplicate_pad_numbers_are_jumpers no)",
        "    (fp_text user \"layout placeholder\" (at 0 0 0) (layer \"Cmts.User\")",
        "      (effects (font (size 0.7 0.7) (thickness 0.1))) (uuid \"" + uuid() + "\"))"
    );
    if (component.shape === "circle") {
        lines.push("    (fp_circle (center 0 0) (end " + fmt(w / 2) + " 0) (stroke (width 0.12) (type solid)) (fill no) (layer \"" + fabLayer + "\") (uuid \"" + uuid() + "\"))");
    } else {
        lines.push("    (fp_rect (start " + fmt(-w / 2) + " " + fmt(-h / 2) + ") (end " + fmt(w / 2) + " " + fmt(h / 2) + ") (stroke (width 0.12) (type solid)) (fill no) (layer \"" + fabLayer + "\") (uuid \"" + uuid() + "\"))");
    }
    if (component.gate) {
        lines.push("    (fp_text user \"" + esc(component.gate) + "\" (at 0 " + fmt(h / 2 + 2.4) + " 0) (layer \"Cmts.User\")",
            "      (effects (font (size 0.65 0.65) (thickness 0.1))) (uuid \"" + uuid() + "\"))");
    }
    pads.forEach(function (pad, i) {
        var pos = padPosition(i, pads.length, w, h);
        lines.push(padLine(pad, {
            shape: "rect",
            x: pos.x,
            y: pos.y,
            w: pSize,
            h: pSize
        }, {
            copper: copperLayer,
            paste: pasteLayer,
            mask: maskLayer
        }, netByName));
    });
    lines.push("    (embedded_fonts no)");
    lines.push("  )");
    return lines.join("\n");
}

function componentPadCenters(component, pads, bodyH, bounds) {
    var w;
    var h;
    var entries;
    if (footprintIsOpen(component)) {
        w = component.w;
        h = component.h;
        entries = pads.map(function (pad, i) {
            var pos = padPosition(i, pads.length, w, h);
            return {
                pad: pad,
                spec: { x: pos.x, y: pos.y }
            };
        });
    } else {
        var profile = fitProfile(component);
        w = profile.bodyW;
        h = profile.bodyH;
        entries = fitPadSpecs(component, pads, profile);
    }
    var placed = safeFootprintPosition(component, bodyH, bounds, w, h);
    var sidePrefix = component.side === "back" ? "B" : "F";
    var centers = {};
    entries.forEach(function (entry) {
        centers[entry.pad.pin] = {
            x: Number((placed.x + entry.spec.x).toFixed(3)),
            y: Number((placed.y + entry.spec.y).toFixed(3)),
            layer: sidePrefix + ".Cu"
        };
    });
    return centers;
}

function placedPadCenters(placement, padMap, bodyH, bounds) {
    var byRef = {};
    placement.components.forEach(function (component) {
        byRef[component.ref] = componentPadCenters(component, padMap[component.ref] || [], bodyH, bounds);
    });
    return byRef;
}

function routeWidth(net) {
    if (net === "+3V3" || net === "+3V3_PANEL" || net === "VBUS_IN" || net === "BAT+" || net === "SYS") {
        return 0.45;
    }
    if (net.indexOf("DSI_") === 0 || net.indexOf("USB_") === 0) {
        return 0.14;
    }
    return 0.18;
}

function segmentLine(start, end, layer, netId, width) {
    if (start.x === end.x && start.y === end.y) {
        return null;
    }
    return "  (segment (start " + fmt(start.x) + " " + fmt(start.y) + ") (end " + fmt(end.x) + " " + fmt(end.y) +
        ") (width " + fmt(width) + ") (layer \"" + layer + "\") (net " + netId + ") (uuid \"" + uuid() + "\"))";
}

function viaLine(point, netId) {
    return "  (via (at " + fmt(point.x) + " " + fmt(point.y) +
        ") (size 0.8) (drill 0.4) (layers \"F.Cu\" \"B.Cu\") (net " + netId + ") (uuid \"" + uuid() + "\"))";
}

function routeCopperForPair(root, dest, netId, net, routeIndex) {
    var points = boardPreview.routePoints(root, dest, routeIndex);
    if (points.length < 2) {
        return [];
    }
    var lines = [];
    var viaIndex = root.layer === dest.layer ? -1 : Math.min(1, points.length - 1);
    if (viaIndex !== -1) {
        lines.push(viaLine(points[viaIndex], netId));
    }
    for (var i = 0; i < points.length - 1; i++) {
        var layer = root.layer;
        if (root.layer !== dest.layer && i >= viaIndex) {
            layer = dest.layer;
        }
        var line = segmentLine(points[i], points[i + 1], layer, netId, routeWidth(net));
        if (line) {
            lines.push(line);
        }
    }
    return lines;
}

function buildRouteCopper(model, placement, padMap, netByName, bodyH, bounds) {
    var centers = placedPadCenters(placement, padMap, bodyH, bounds);
    var lines = [];
    var routeIndex = 0;
    model.connections.forEach(function (conn) {
        if (!boardPreview.isGeneratedRouteNet(conn.net)) {
            return;
        }
        var nodes = [];
        var seen = {};
        conn.nodes.forEach(function (node) {
            var ref = node[0];
            var pin = node[1];
            var key = ref + "\0" + pin;
            if (seen[key] || !centers[ref] || !centers[ref][pin]) {
                return;
            }
            seen[key] = true;
            nodes.push(centers[ref][pin]);
        });
        if (nodes.length < 2) {
            return;
        }
        var root = nodes[0];
        var netId = padNetId(netByName, conn.net);
        nodes.slice(1).forEach(function (dest) {
            routeCopperForPair(root, dest, netId, conn.net, routeIndex).forEach(function (line) {
                lines.push(line);
            });
            routeIndex++;
        });
    });
    return lines;
}

function guideLine(start, end, bodyH) {
    return "  (gr_line (start " + fmt(start.x) + " " + fmt(bodyYToKicad(start.y, bodyH)) +
        ") (end " + fmt(end.x) + " " + fmt(bodyYToKicad(end.y, bodyH)) +
        ") (stroke (width 0.12) (type dash)) (layer \"Cmts.User\") (uuid \"" + uuid() + "\"))";
}

function buildGuidePolyline(points, bodyH) {
    var lines = [];
    for (var i = 0; i < points.length - 1; i++) {
        lines.push(guideLine(points[i], points[i + 1], bodyH));
    }
    return lines;
}

function buildDsiRouteGuides(model, placement, bodyH, bounds) {
    var plan = boardPreview.buildDsiRoutePlan(model, placement.byRef);
    if (!plan) {
        return [];
    }
    var lines = [];
    var title = safeTextPosition(60, bodyYToKicad(32, bodyH), bounds, "DSI route intent", 0.9);
    lines.push("  (gr_text \"DSI route intent: first-pass copper; still blocked by GATE-DSI-FFC-CONTACT\" (at " +
        fmt(title.x) + " " + fmt(title.y) + " 0) (layer \"Cmts.User\")",
        "    (effects (font (size 0.9 0.9) (thickness 0.12))) (uuid \"" + uuid() + "\"))");
    plan.pairs.forEach(function (pair) {
        buildGuidePolyline(pair.pPoints, bodyH).forEach(function (line) { lines.push(line); });
        buildGuidePolyline(pair.nPoints, bodyH).forEach(function (line) { lines.push(line); });
        var labelPoint = pair.pPoints[Math.floor(pair.pPoints.length / 2)];
        var label = safeTextPosition(labelPoint.x, bodyYToKicad(labelPoint.y, bodyH), bounds, pair.name + " route intent", 0.7);
        lines.push("  (gr_text \"" + esc(pair.name + " route intent") + "\" (at " + fmt(label.x) + " " + fmt(label.y) +
            " 0) (layer \"Cmts.User\")",
            "    (effects (font (size 0.7 0.7) (thickness 0.1))) (uuid \"" + uuid() + "\"))");
    });
    return lines;
}

function pathToGrLines(svgPath, bodyH) {
    var lines = [];
    var tokens = svgPath.replace(/([MHVAZ])/g, " $1 ").trim().split(/\s+/);
    var i = 0;
    var cx = 0;
    var cy = 0;
    var sx = 0;
    var sy = 0;
    while (i < tokens.length) {
        var cmd = tokens[i++];
        if (cmd === "M") {
            cx = parseFloat(tokens[i++]);
            cy = parseFloat(tokens[i++]);
            sx = cx;
            sy = cy;
        } else if (cmd === "H") {
            var nx = parseFloat(tokens[i++]);
            lines.push([cx, cy, nx, cy]);
            cx = nx;
        } else if (cmd === "V") {
            var ny = parseFloat(tokens[i++]);
            lines.push([cx, cy, cx, ny]);
            cy = ny;
        } else if (cmd === "A") {
            var rx = parseFloat(tokens[i++]);
            var ry = parseFloat(tokens[i++]);
            i += 2;
            var sweep = parseFloat(tokens[i++]);
            var ax = parseFloat(tokens[i++]);
            var ay = parseFloat(tokens[i++]);
            var dx = ax - cx;
            var dy = ay - cy;
            var center = dx * dy >= 0 ? { x: cx, y: ay } : { x: ax, y: cy };
            var startAngle = Math.atan2(cy - center.y, cx - center.x);
            var endAngle = Math.atan2(ay - center.y, ax - center.x);
            if (sweep) {
                while (endAngle <= startAngle) {
                    endAngle += Math.PI * 2;
                }
            } else {
                while (endAngle >= startAngle) {
                    endAngle -= Math.PI * 2;
                }
            }
            var lastX = cx;
            var lastY = cy;
            for (var step = 1; step <= EDGE_ARC_SEGMENTS; step++) {
                var t = step / EDGE_ARC_SEGMENTS;
                var angle = startAngle + (endAngle - startAngle) * t;
                var px = center.x + rx * Math.cos(angle);
                var py = center.y + ry * Math.sin(angle);
                lines.push([lastX, lastY, px, py]);
                lastX = px;
                lastY = py;
            }
            cx = ax;
            cy = ay;
        } else if (cmd === "Z") {
            if (cx !== sx || cy !== sy) {
                lines.push([cx, cy, sx, sy]);
            }
            cx = sx;
            cy = sy;
        }
    }
    return lines.map(function (seg) {
        return "  (gr_line (start " + fmt(seg[0]) + " " + fmt(bodyYToKicad(seg[1], bodyH)) +
            ") (end " + fmt(seg[2]) + " " + fmt(bodyYToKicad(seg[3], bodyH)) +
            ") (stroke (width 0.1) (type solid)) (layer \"Edge.Cuts\") (uuid \"" + uuid() + "\"))";
    });
}

function buildPcb(layout, model) {
    var bodyH = layout.body.h;
    var bounds = pcbBounds(layout, bodyH);
    var edgeLines = pathToGrLines(layout.edgeCutsPath, bodyH);
    var placement = boardPreview.buildPlacementMap(layout, model);
    var padMap = componentPadMap(model);
    var pcbNets = enumeratePcbNets(model);
    var lines = [
        "(kicad_pcb (version 20241229) (generator \"PuzzleScript generate_kicad.js\") (generator_version \"1.0\")",
        "  (general (thickness 1.2) (legacy_teardrops no))",
        "  (paper \"A4\")",
        "  (layers",
        "    (0 \"F.Cu\" signal) (4 \"In1.Cu\" signal) (6 \"In2.Cu\" signal) (2 \"B.Cu\" signal)",
        "    (9 \"F.Adhes\" user \"F.Adhesive\") (11 \"B.Adhes\" user \"B.Adhesive\")",
        "    (13 \"F.Paste\" user) (15 \"B.Paste\" user)",
        "    (5 \"F.SilkS\" user \"F.Silkscreen\") (7 \"B.SilkS\" user \"B.Silkscreen\")",
        "    (1 \"F.Mask\" user) (3 \"B.Mask\" user)",
        "    (17 \"Dwgs.User\" user \"User.Drawings\") (19 \"Cmts.User\" user \"User.Comments\")",
        "    (21 \"Eco1.User\" user \"User.Eco1\") (23 \"Eco2.User\" user \"User.Eco2\")",
        "    (25 \"Edge.Cuts\" user) (27 \"Margin\" user)",
        "    (31 \"F.CrtYd\" user \"F.Courtyard\") (29 \"B.CrtYd\" user \"B.Courtyard\")",
        "    (35 \"F.Fab\" user) (33 \"B.Fab\" user)",
        "  )",
        "  (setup (stackup",
        "    (layer \"F.SilkS\" (type \"Top Silk Screen\") (color \"White\"))",
        "    (layer \"F.Paste\" (type \"Top Solder Paste\"))",
        "    (layer \"F.Mask\" (type \"Top Solder Mask\") (color \"Green\") (thickness 0.01))",
        "    (layer \"F.Cu\" (type \"copper\") (thickness 0.035))",
        "    (layer \"dielectric 1\" (type \"core\") (thickness 0.2) (material \"FR4\") (epsilon_r 4.5) (loss_tangent 0.02))",
        "    (layer \"In1.Cu\" (type \"copper\") (thickness 0.035))",
        "    (layer \"dielectric 2\" (type \"core\") (thickness 0.75) (material \"FR4\") (epsilon_r 4.5) (loss_tangent 0.02))",
        "    (layer \"In2.Cu\" (type \"copper\") (thickness 0.035))",
        "    (layer \"dielectric 3\" (type \"core\") (thickness 0.2) (material \"FR4\") (epsilon_r 4.5) (loss_tangent 0.02))",
        "    (layer \"B.Cu\" (type \"copper\") (thickness 0.035))",
        "    (layer \"B.Mask\" (type \"Bottom Solder Mask\") (color \"Green\") (thickness 0.01))",
        "    (layer \"B.Paste\" (type \"Bottom Solder Paste\"))",
        "    (layer \"B.SilkS\" (type \"Bottom Silk Screen\") (color \"White\"))",
        "    (copper_finish \"None\") (dielectric_constraints no)))"
    ];
    pcbNets.nets.forEach(function (net, i) {
        lines.push("  (net " + i + " \"" + esc(net) + "\")");
    });
    edgeLines.forEach(function (l) { lines.push(l); });
    layout.anchors.forEach(function (a) {
        var kx = a.x;
        var ky = bodyYToKicad(a.y, bodyH);
        var label = safeTextPosition(kx, ky + 1.5, bounds, a.id, 1);
        lines.push("  (gr_circle (center " + kx + " " + ky + ") (end " + (kx + 0.5) + " " + ky +
            ") (stroke (width 0.12) (type solid)) (fill no) (layer \"F.Fab\") (uuid \"" + uuid() + "\"))");
        lines.push("  (gr_text \"" + esc(a.id) + "\" (at " + fmt(label.x) + " " + fmt(label.y) + " 0) (layer \"F.SilkS\")",
            "    (effects (font (size 1 1) (thickness 0.15))) (uuid \"" + uuid() + "\"))");
    });
    layout.keepouts.forEach(function (k) {
        var layer = keepoutDrawingLayer(k);
        var x = k.x;
        var y = bodyYToKicad(k.y + k.h, bodyH);
        var label = safeTextPosition(x + k.w / 2, bodyYToKicad(k.y, bodyH) + 1.5, bounds, k.id, 1);
        lines.push("  (gr_rect (start " + x + " " + y + ") (end " + (x + k.w) + " " + (y + k.h) +
            ") (stroke (width 0.12) (type dash)) (fill no) (layer \"" + layer + "\") (uuid \"" + uuid() + "\"))");
        lines.push("  (gr_text \"" + esc(k.id) + "\" (at " + fmt(label.x) + " " + fmt(label.y) + " 0) (layer \"" + layer + "\")",
            "    (effects (font (size 1 1) (thickness 0.12))) (uuid \"" + uuid() + "\"))");
    });
    buildDsiRouteGuides(model, placement, bodyH, bounds).forEach(function (l) {
        lines.push(l);
    });
    buildRouteCopper(model, placement, padMap, pcbNets.byName, bodyH, bounds).forEach(function (l) {
        lines.push(l);
    });
    placement.components.forEach(function (component) {
        if (footprintIsOpen(component)) {
            lines.push(previewFootprint(component, padMap[component.ref] || [], pcbNets.byName, bodyH, bounds));
        } else {
            lines.push(fitFootprint(component, padMap[component.ref] || [], pcbNets.byName, bodyH, bounds));
        }
    });
    lines.push(")");
    return lines.join("\n") + "\n";
}

function buildProject() {
    return JSON.stringify({
        board: { "3dviewports": [], layer_presets: [] },
        boards: [],
        csv: { formats: [] },
        libraries: { pinned_footprint_libs: [], pinned_symbol_libs: [] },
        meta: { filename: "card.kicad_pro", version: 3 },
        net_settings: {
            classes: [{
                bus_width: 12, clearance: 0.2, diff_pair_gap: 0.25, diff_pair_via_gap: 0.25,
                diff_pair_width: 0.2, line_style: 0, microvia_diameter: 0.3, microvia_drill: 0.1,
                name: "Default", pcb_color: "rgba(0, 0, 0, 0.000)", priority: 2147483647,
                schematic_color: "rgba(0, 0, 0, 0.000)", track_width: 0.25,
                via_diameter: 0.8, via_drill: 0.4, wire_width: 6
            }],
            meta: { version: 3 },
            net_colors: null,
            netclass_assignments: null,
            netclass_patterns: []
        },
        pcbnew: {
            last_paths: {
                gencad: "", idf: "", netlist: "", plot: "", pos_files: "",
                specctra_dsn: "", step: "", svg: "", vrml: ""
            },
            page_layout_descr_file: ""
        },
        schematic: { legacy_lib_dir: "", legacy_lib_list: [] },
        sheets: [["card.kicad_sch", "Root"]],
        text_variables: {}
    }, null, 2) + "\n";
}

function generateAll() {
    uuidCounter = 0;
    var applied = jlcParts.applyCatalog(loadJson(path.join(SCHEMATIC_DIR, "connectivity.json")));
    var model = applied.model;
    var layout = loadJson(path.join(CARD_DIR, "mechanical", "layout.json"));
    var sheetsDir = path.join(SCHEMATIC_DIR, "sheets");
    fs.mkdirSync(sheetsDir, { recursive: true });

    model.sheets.forEach(function (sh) {
        var projectPath = "/card/" + sh.file.replace(/\\/g, "/").replace(".kicad_sch", "");
        var content = buildSheet(model, sh.id, sh.file, projectPath);
        fs.writeFileSync(path.join(SCHEMATIC_DIR, sh.file), content, "utf8");
    });

    fs.writeFileSync(path.join(CARD_DIR, "card.kicad_sch"), buildRootSheet(model), "utf8");
    fs.writeFileSync(path.join(CARD_DIR, "card.kicad_pcb"), buildPcb(layout, model), "utf8");
    fs.writeFileSync(path.join(CARD_DIR, "card.kicad_pro"), buildProject(), "utf8");
    fs.writeFileSync(path.join(CARD_DIR, "bom_jlc.csv"), jlcParts.bomCsv(model), "utf8");

    return {
        sheets: model.sheets.length,
        components: model.components.length,
        jlc: jlcParts.catalogSummary(applied.catalog)
    };
}

module.exports = {
    generateAll: generateAll,
    buildSheet: buildSheet,
    footprintLibraryName: footprintLibraryName,
    footprintIsOpen: footprintIsOpen
};

if (require.main === module) {
    var info = generateAll();
    console.log("Generated KiCad project: " + info.sheets + " sheets, " + info.components + " components");
    console.log("Open: hardware/card/card.kicad_pro in KiCad 8");
}

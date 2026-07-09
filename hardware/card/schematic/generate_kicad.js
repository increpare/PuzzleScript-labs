"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var CARD_DIR = path.join(__dirname, "..");
var SCHEMATIC_DIR = __dirname;
var uuidCounter = 0;

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
    return [
        "  (symbol (lib_id \"" + lib + "\") (at " + atX + " " + atY + " " + rot + ") (unit 1)",
        "    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (fields_autoplaced)",
        "    (uuid \"" + id + "\")",
        "    (property \"Reference\" \"" + esc(comp.ref) + "\" (at " + atX + " " + (atY - 6) + " 0)",
        "      (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"" + esc(comp.value) + "\" (at " + atX + " " + (atY + 6) + " 0)",
        "      (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"" + esc(comp.footprint) + "\" (at " + atX + " " + atY + " 0)",
        "      (effects (font (size 1.27 1.27)) hide))",
        "    (property \"Datasheet\" \"~\" (at " + atX + " " + atY + " 0)",
        "      (effects (font (size 1.27 1.27)) hide))",
        "    (instances (project \"card\" (path \"" + projectPath + "\" (reference \"" + esc(comp.ref) + "\") (unit 1))))",
        "  )"
    ].join("\n");
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
            i += 5;
            cx = parseFloat(tokens[i++]);
            cy = parseFloat(tokens[i++]);
        } else if (cmd === "Z") {
            if (cx !== sx || cy !== sy) {
                lines.push([cx, cy, sx, sy]);
            }
            cx = sx;
            cy = sy;
        }
    }
    return lines.map(function (seg) {
        return "  (gr_line (start " + seg[0] + " " + bodyYToKicad(seg[1], bodyH) +
            ") (end " + seg[2] + " " + bodyYToKicad(seg[3], bodyH) +
            ") (stroke (width 0.1) (type default)) (layer \"Edge.Cuts\") (uuid \"" + uuid() + "\"))";
    });
}

function buildPcb(layout, model) {
    var bodyH = layout.body.h;
    var edgeLines = pathToGrLines(layout.edgeCutsPath, bodyH);
    var lines = [
        "(kicad_pcb (version 20241229) (generator \"PuzzleScript generate_kicad.js\") (generator_version \"1.0\")",
        "  (general (thickness 1.2) (legacy_teardrops no))",
        "  (paper \"A4\")",
        "  (layers",
        "    (0 \"F.Cu\" signal) (2 \"B.Cu\" signal) (1 \"In1.Cu\" signal) (3 \"In2.Cu\" signal)",
        "    (31 \"B.Adhes\" user) (33 \"F.Adhes\" user) (35 \"F.Paste\" user) (36 \"B.Paste\" user)",
        "    (37 \"F.SilkS\" user) (38 \"B.SilkS\" user) (39 \"F.Mask\" user) (40 \"B.Mask\" user)",
        "    (41 \"Dwgs.User\" user) (42 \"Cmts.User\" user) (43 \"Eco1.User\" user) (44 \"Eco2.User\" user)",
        "    (45 \"Edge.Cuts\" user) (46 \"Margin\" user) (47 \"F.CrtYd\" user) (48 \"B.CrtYd\" user)",
        "    (49 \"F.Fab\" user) (50 \"B.Fab\" user)",
        "  )",
        "  (setup (stackup (layer \"F.Cu\" (type \"copper\") (thickness 0.035))",
        "    (layer \"In1.Cu\" (type \"copper\") (thickness 0.035)) (layer \"In2.Cu\" (type \"copper\") (thickness 0.035))",
        "    (layer \"B.Cu\" (type \"copper\") (thickness 0.035)) (layer \"F.SilkS\" (type \"Bottom Silk Screen\"))",
        "    (copper_finish \"None\") (dielectric_constraints no)))",
        "  (net 0 \"\")",
        "  (net 1 \"+3V3\")",
        "  (net 2 \"GND\")"
    ];
    edgeLines.forEach(function (l) { lines.push(l); });
    layout.anchors.forEach(function (a) {
        var kx = a.x;
        var ky = bodyYToKicad(a.y, bodyH);
        lines.push("  (gr_circle (center " + kx + " " + ky + ") (end " + (kx + 0.5) + " " + ky +
            ") (stroke (width 0.12) (type default)) (fill none) (layer \"F.Fab\") (uuid \"" + uuid() + "\"))");
        lines.push("  (gr_text \"" + esc(a.id) + "\" (at " + kx + " " + (ky + 1.5) + " 0) (layer \"F.SilkS\")",
            "    (effects (font (size 1 1) (thickness 0.15)) (justify center)) (uuid \"" + uuid() + "\"))");
    });
    layout.keepouts.forEach(function (k) {
        var layer = keepoutDrawingLayer(k);
        var x = k.x;
        var y = bodyYToKicad(k.y + k.h, bodyH);
        lines.push("  (gr_rect (start " + x + " " + y + ") (end " + (x + k.w) + " " + (y + k.h) +
            ") (stroke (width 0.12) (type dash)) (fill none) (layer \"" + layer + "\") (uuid \"" + uuid() + "\"))");
        lines.push("  (gr_text \"" + esc(k.id) + "\" (at " + (x + k.w / 2) + " " +
            (bodyYToKicad(k.y, bodyH) + 1.5) + " 0) (layer \"" + layer + "\")",
            "    (effects (font (size 1 1) (thickness 0.12)) (justify center)) (uuid \"" + uuid() + "\"))");
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
    var model = loadJson(path.join(SCHEMATIC_DIR, "connectivity.json"));
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

    return {
        sheets: model.sheets.length,
        components: model.components.length
    };
}

module.exports = { generateAll: generateAll, buildSheet: buildSheet };

if (require.main === module) {
    var info = generateAll();
    console.log("Generated KiCad project: " + info.sheets + " sheets, " + info.components + " components");
    console.log("Open: hardware/card/card.kicad_pro in KiCad 8");
}

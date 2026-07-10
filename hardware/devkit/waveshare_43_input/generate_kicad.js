"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var REPO_ROOT = path.join(__dirname, "..", "..", "..");
var OUT_DIR = __dirname;
var blockout = require(path.join(REPO_ROOT, "tools", "handheld_blockout", "blockout.js"));
var gpioMap = require("./gpio_map.json");

var uuidCounter = 0;

function uuid() {
    uuidCounter++;
    var hex = crypto.createHash("sha1")
        .update("ps-devkit-input:" + uuidCounter)
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

function fmt(n) {
    return Number(n).toFixed(4).replace(/\.?0+$/, function (m) {
        return m === "." ? "" : m;
    }).replace(/\.$/, "");
}

function dpadCenters(dpad) {
    var offset = dpad.spacing / 2;
    return [
        { ref: "SW1", label: "UP", net: "GPIO28_UP", gpio: 28, x: dpad.cx, y: dpad.cy - offset },
        { ref: "SW2", label: "DOWN", net: "GPIO29_DOWN", gpio: 29, x: dpad.cx, y: dpad.cy + offset },
        { ref: "SW3", label: "LEFT", net: "GPIO30_LEFT", gpio: 30, x: dpad.cx - offset, y: dpad.cy },
        { ref: "SW4", label: "RIGHT", net: "GPIO31_RIGHT", gpio: 31, x: dpad.cx + offset, y: dpad.cy }
    ];
}

function buildSwitchList() {
    var preset = blockout.BLOCKOUT_PRESETS.card;
    var switches = dpadCenters(preset.dpad);
    var face = [
        { ref: "SW5", label: "ACTION", net: "GPIO32_ACTION", gpio: 32, x: preset.buttons[0].cx, y: preset.buttons[0].cy },
        { ref: "SW6", label: "UNDO", net: "GPIO34_UNDO", gpio: 34, x: preset.buttons[1].cx, y: preset.buttons[1].cy },
        { ref: "SW7", label: "RESTART", net: "GPIO35_RESTART", gpio: 35, x: preset.buttons[2].cx, y: preset.buttons[2].cy },
        { ref: "SW8", label: "MENU", net: "GPIO49_MENU", gpio: 49, x: preset.menu.cx, y: preset.menu.cy }
    ];
    return switches.concat(face);
}

function boardOutline(switches) {
    var xs = switches.map(function (s) { return s.x; });
    var ys = switches.map(function (s) { return s.y; });
    var margin = 6;
    var x0 = Math.min.apply(null, xs) - margin;
    var y0 = Math.min.apply(null, ys) - margin - 8;
    var x1 = Math.max.apply(null, xs) + margin;
    var y1 = Math.max.apply(null, ys) + margin;
    return { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2 };
}

function tl3315Footprint(ref, value, x, y, sigNet, netByName) {
    var lines = [
        "  (footprint \"PSDevkit:TL3315NF160Q\" (layer \"F.Cu\")",
        "    (uuid \"" + uuid() + "\")",
        "    (at " + fmt(x) + " " + fmt(y) + " 0)",
        "    (property \"Reference\" \"" + esc(ref) + "\" (at 0 -3.2 0) (layer \"F.SilkS\")",
        "      (uuid \"" + uuid() + "\") (effects (font (size 0.8 0.8) (thickness 0.12))))",
        "    (property \"Value\" \"" + esc(value) + "\" (at 0 3.2 0) (layer \"F.Fab\")",
        "      (uuid \"" + uuid() + "\") (effects (font (size 0.7 0.7) (thickness 0.1))))",
        "    (property \"LCSC\" \"C2886877\" (at 0 0 0) (layer \"F.Fab\") (hide yes)",
        "      (uuid \"" + uuid() + "\") (effects (font (size 1 1))))",
        "    (attr smd)",
        "    (fp_rect (start -2.4 -2.4) (end 2.4 2.4) (stroke (width 0.12) (type solid)) (fill no) (layer \"F.SilkS\") (uuid \"" + uuid() + "\"))",
        "    (fp_rect (start -2.25 -2.25) (end 2.25 2.25) (stroke (width 0.1) (type solid)) (fill no) (layer \"F.CrtYd\") (uuid \"" + uuid() + "\"))",
        "    (fp_rect (start -2.25 -2.25) (end 2.25 2.25) (stroke (width 0.1) (type solid)) (fill no) (layer \"F.Fab\") (uuid \"" + uuid() + "\"))"
    ];
    var pads = [
        { num: "1", x: -1.25, y: -0.725, net: "GND" },
        { num: "2", x: -1.25, y: 0.725, net: "GND" },
        { num: "3", x: 1.25, y: 0.725, net: sigNet },
        { num: "4", x: 1.25, y: -0.725, net: sigNet }
    ];
    pads.forEach(function (pad) {
        lines.push(
            "    (pad \"" + pad.num + "\" smd rect (at " + fmt(pad.x) + " " + fmt(pad.y) + " 0) (size 0.9 0.7)",
            "      (layers \"F.Cu\" \"F.Paste\" \"F.Mask\") (net " + netByName[pad.net] + " \"" + esc(pad.net) + "\") (uuid \"" + uuid() + "\"))"
        );
    });
    lines.push("  )");
    return lines.join("\n");
}

function headerFootprint(x, y, netByName) {
    var lines = [
        "  (footprint \"Connector_PinHeader_1x10_P2.54mm_Vertical\" (layer \"F.Cu\")",
        "    (uuid \"" + uuid() + "\")",
        "    (at " + fmt(x) + " " + fmt(y) + " 0)",
        "    (property \"Reference\" \"J1\" (at 0 -3 0) (layer \"F.SilkS\")",
        "      (uuid \"" + uuid() + "\") (effects (font (size 1 1) (thickness 0.15))))",
        "    (property \"Value\" \"To_Waveshare_40pin\" (at 0 14 0) (layer \"F.Fab\")",
        "      (uuid \"" + uuid() + "\") (effects (font (size 0.8 0.8) (thickness 0.1))))",
        "    (property \"LCSC\" \"C492421\" (at 0 0 0) (layer \"F.Fab\") (hide yes)",
        "      (uuid \"" + uuid() + "\") (effects (font (size 1 1))))",
        "    (attr through_hole)",
        "    (fp_text user \"dupont -> Waveshare 40-pin GPIO\" (at 0 16 0) (layer \"F.SilkS\")",
        "      (effects (font (size 0.7 0.7) (thickness 0.1))) (uuid \"" + uuid() + "\"))"
    ];
    gpioMap.header_j1.forEach(function (pin, index) {
        var py = index * 2.54;
        lines.push(
            "    (pad \"" + pin.pin + "\" thru_hole rect (at 0 " + fmt(py) + " 0) (size 1.7 1.7) (drill 1.0)",
            "      (layers \"*.Cu\" \"*.Mask\") (net " + netByName[pin.net] + " \"" + esc(pin.net) + "\") (uuid \"" + uuid() + "\"))"
        );
    });
    lines.push("  )");
    return lines.join("\n");
}

function routeSegment(x1, y1, x2, y2, net, width) {
    return "  (segment (start " + fmt(x1) + " " + fmt(y1) + ") (end " + fmt(x2) + " " + fmt(y2) + ")" +
        " (width " + fmt(width || 0.25) + ") (layer \"F.Cu\") (net " + net + ") (uuid \"" + uuid() + "\"))";
}

function generatePcb(switches, outline) {
    var nets = ["GND"];
    switches.forEach(function (sw) {
        if (nets.indexOf(sw.net) === -1) {
            nets.push(sw.net);
        }
    });
    var netByName = {};
    nets.forEach(function (name, i) {
        netByName[name] = i + 1;
    });

    var headerX = outline.cx;
    var headerY = outline.y0 + 4;
    var headerPinY = {};
    gpioMap.header_j1.forEach(function (pin, index) {
        headerPinY[pin.net] = headerY + index * 2.54;
    });

    var lines = [
        "(kicad_pcb (version 20240108) (generator \"ps-devkit-input\") (generator_version \"1.0\")",
        "  (general (thickness 1.6) (legacy_teardrops no))",
        "  (paper \"A4\")",
        "  (layers",
        "    (0 \"F.Cu\" signal) (31 \"B.Cu\" signal) (32 \"B.Adhes\" user) (33 \"F.Adhes\" user)",
        "    (34 \"B.Paste\" user) (35 \"F.Paste\" user) (36 \"B.SilkS\" user) (37 \"F.SilkS\" user)",
        "    (38 \"B.Mask\" user) (39 \"F.Mask\" user) (40 \"Dwgs.User\" user) (41 \"Cmts.User\" user)",
        "    (42 \"Eco1.User\" user) (43 \"Eco2.User\" user) (44 \"Edge.Cuts\" user) (45 \"Margin\" user)",
        "    (46 \"B.CrtYd\" user) (47 \"F.CrtYd\" user) (48 \"B.Fab\" user) (49 \"F.Fab\" user))",
        "  (setup (pad_to_mask_clearance 0) (allow_blind_buried_vias no) (allow_microvias no) (zone_45_only no))",
        "  (net 0 \"\")"
    ];
    nets.forEach(function (name, i) {
        lines.push("  (net " + (i + 1) + " \"" + esc(name) + "\")");
    });

    var x0 = outline.x0;
    var y0 = outline.y0;
    var x1 = x0 + outline.w;
    var y1 = y0 + outline.h;
    lines.push(
        "  (gr_rect (start " + fmt(x0) + " " + fmt(y0) + ") (end " + fmt(x1) + " " + fmt(y1) + ")",
        "    (stroke (width 0.12) (type default)) (fill none) (layer \"Edge.Cuts\") (uuid \"" + uuid() + "\"))",
        "  (gr_text \"PuzzleScript input daughterboard\" (at " + fmt(outline.cx) + " " + fmt(y0 + 2) + " 0)",
        "    (layer \"F.SilkS\") (uuid \"" + uuid() + "\") (effects (font (size 1 1) (thickness 0.15))))"
    );

    switches.forEach(function (sw) {
        lines.push(tl3315Footprint(sw.ref, sw.label, sw.x, sw.y, sw.net, netByName));
        var sigId = netByName[sw.net];
        var midX = (sw.x + headerX) / 2;
        lines.push(routeSegment(sw.x + 1.25, sw.y, midX, sw.y, sigId));
        lines.push(routeSegment(midX, sw.y, midX, headerPinY[sw.net], sigId));
        lines.push(routeSegment(midX, headerPinY[sw.net], headerX, headerPinY[sw.net], sigId));
    });

    lines.push(headerFootprint(headerX, headerY, netByName));

    var gndY = headerPinY.GND;
    lines.push(
        "  (zone (net 1) (net_name \"GND\") (layer \"F.Cu\") (uuid \"" + uuid() + "\") (hatch edge 0.5)",
        "    (connect_pads (clearance 0.2)) (min_thickness 0.2) (filled_areas_thickness no)",
        "    (fill yes (thermal_gap 0.2) (thermal_bridge_width 0.2))",
        "    (polygon",
        "      (pts",
        "        (xy " + fmt(x0 + 0.5) + " " + fmt(y0 + 0.5) + ")",
        "        (xy " + fmt(x1 - 0.5) + " " + fmt(y0 + 0.5) + ")",
        "        (xy " + fmt(x1 - 0.5) + " " + fmt(y1 - 0.5) + ")",
        "        (xy " + fmt(x0 + 0.5) + " " + fmt(y1 - 0.5) + ")",
        "      )",
        "    )",
        "  )"
    );

    switches.forEach(function (sw) {
        lines.push(routeSegment(sw.x - 1.25, sw.y, sw.x - 1.25, gndY, 1));
    });
    lines.push(routeSegment(headerX, gndY, headerX, headerY, 1));

    lines.push(")");
    return lines.join("\n") + "\n";
}

function generateSchematic(switches) {
    var lines = [
        "(kicad_sch (version 20250114) (generator \"ps-devkit-input\") (generator_version \"1.0\")",
        "  (uuid \"" + uuid() + "\")",
        "  (paper \"A4\")",
        "  (title_block",
        "    (title \"PuzzleScript Waveshare 4.3 Input Board\")",
        "    (date \"" + new Date().toISOString().slice(0, 10) + "\")",
        "    (comment 1 \"8x TL3315NF160Q + 1x10 header to Waveshare 40-pin GPIO\")",
        "    (comment 2 \"Layout from tools/handheld_blockout/blockout.js card preset\"))",
        "  (lib_symbols",
        "    (symbol \"Switch:SW_Push\" (pin_numbers hide) (in_bom yes) (on_board yes)",
        "      (property \"Reference\" \"SW\" (at 0 2.54 0) (effects (font (size 1.27 1.27))))",
        "      (property \"Value\" \"SW_Push\" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))",
        "      (symbol \"SW_Push_0_1\"",
        "        (circle (center 2.032 0) (radius 0.635) (stroke (width 0) (type default)) (fill (type none))))",
        "      (symbol \"SW_Push_1_1\"",
        "        (pin passive line (at 0 0 0) (length 2.54) (name \"1\" (effects (font (size 1.27 1.27)))) (number \"1\" (effects (font (size 1.27 1.27)))))",
        "        (pin passive line (at 5.08 0 180) (length 2.54) (name \"2\" (effects (font (size 1.27 1.27)))) (number \"2\" (effects (font (size 1.27 1.27)))))))",
        "    (symbol \"Connector_Generic:Conn_01x10\" (pin_names (offset 1.016) hide) (in_bom yes) (on_board yes)",
        "      (property \"Reference\" \"J\" (at 0 12.7 0) (effects (font (size 1.27 1.27))))",
        "      (property \"Value\" \"Conn_01x10\" (at 0 -15.24 0) (effects (font (size 1.27 1.27))))",
        "      (symbol \"Conn_01x10_1_1\""
    ];
    for (var p = 1; p <= 10; p++) {
        var y = (p - 1) * -2.54;
        lines.push(
            "        (pin passive line (at 0 " + fmt(y) + " 90) (length 5.08)",
            "          (name \"" + p + "\" (effects (font (size 1.27 1.27)))) (number \"" + p + "\" (effects (font (size 1.27 1.27)))))"
        );
    }
    lines.push("      )))");

    switches.forEach(function (sw, i) {
        var x = 25 + (i % 4) * 45;
        var y = 35 + Math.floor(i / 4) * 30;
        lines.push(
            "  (symbol (lib_id \"Switch:SW_Push\") (at " + x + " " + y + " 0) (unit 1)",
            "    (property \"Reference\" \"" + sw.ref + "\" (at " + x + " " + (y - 3.5) + " 0)",
            "      (effects (font (size 1.27 1.27))))",
            "    (property \"Value\" \"" + esc(sw.label) + "\" (at " + x + " " + (y + 3.5) + " 0)",
            "      (effects (font (size 1.27 1.27))))",
            "    (property \"Footprint\" \"PSDevkit:TL3315NF160Q\" (at " + x + " " + y + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))",
            "    (property \"LCSC\" \"C2886877\" (at " + x + " " + y + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))",
            "    (instances (project \"input_board\" (path \"/input_board\" (reference \"" + sw.ref + "\") (unit 1)))))"
        );
    });

    lines.push(
        "  (symbol (lib_id \"Connector_Generic:Conn_01x10\") (at 190 60 0) (unit 1)",
        "    (property \"Reference\" \"J1\" (at 190 45 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"To_Waveshare_40pin\" (at 190 78 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"Connector_PinHeader_1x10_P2.54mm_Vertical\" (at 190 60 0) (effects (font (size 1.27 1.27)) hide))",
        "    (instances (project \"input_board\" (path \"/input_board\" (reference \"J1\") (unit 1)))))",
        "  (sheet_instances (path \"/\" (page \"1\")))",
        ")"
    );
    return lines.join("\n") + "\n";
}

function generateProject() {
    return JSON.stringify({
        board: {
            design_settings: {
                defaults: { board_outline_line_width: 0.1, copper_line_width: 0.2, copper_text_size_h: 1.5, copper_text_size_v: 1.5, other_line_width: 0.15, other_text_size_h: 1.0, other_text_size_v: 1.0 },
                rules: { min_clearance: 0.2, min_track_width: 0.15, min_via_diameter: 0.5, min_via_drill: 0.3 }
            },
            layer_presets: []
        },
        boards: [{ name: "input_board.kicad_pcb" }],
        schematic: { sheets: [{ name: "input_board.kicad_sch", uuid: uuid() }] },
        meta: { filename: "input_board.kicad_pro", version: 1 }
    }, null, 2) + "\n";
}

function generateBom() {
    var rows = [
        "Designator,Value,MPN,LCSC,Footprint,Qty",
        "SW1-SW8,TL3315NF160Q,TL3315NF160Q,C2886877,PSDevkit:TL3315NF160Q,8",
        "J1,1x10 header,PinHeader-1x10,C492421,Connector_PinHeader_1x10_P2.54mm_Vertical,1"
    ];
    return rows.join("\n") + "\n";
}

function generateFootprintLib() {
    return [
        "(footprint \"TL3315NF160Q\" (version 20240108) (generator \"ps-devkit-input\") (layer \"F.Cu\")",
        "  (descr \"E-Switch TL3315NF160Q 4.5x4.5mm 160gf tact\")",
        "  (tags \"tact switch TL3315\")",
        "  (property \"Reference\" \"SW\" (at 0 -3 0) (layer \"F.SilkS\") (effects (font (size 1 1) (thickness 0.15))))",
        "  (property \"Value\" \"TL3315NF160Q\" (at 0 3 0) (layer \"F.Fab\") (effects (font (size 1 1) (thickness 0.15))))",
        "  (attr smd)",
        "  (fp_rect (start -2.25 -2.25) (end 2.25 2.25) (stroke (width 0.1) (type solid)) (fill no) (layer \"F.Fab\"))",
        "  (pad \"1\" smd rect (at -1.25 -0.725) (size 0.9 0.7) (layers \"F.Cu\" \"F.Paste\" \"F.Mask\"))",
        "  (pad \"2\" smd rect (at -1.25 0.725) (size 0.9 0.7) (layers \"F.Cu\" \"F.Paste\" \"F.Mask\"))",
        "  (pad \"3\" smd rect (at 1.25 0.725) (size 0.9 0.7) (layers \"F.Cu\" \"F.Paste\" \"F.Mask\"))",
        "  (pad \"4\" smd rect (at 1.25 -0.725) (size 0.9 0.7) (layers \"F.Cu\" \"F.Paste\" \"F.Mask\"))",
        ")"
    ].join("\n") + "\n";
}

function writeText(file, content) {
    fs.writeFileSync(file, content, "utf8");
}

function generateAll() {
    uuidCounter = 0;
    var switches = buildSwitchList();
    var outline = boardOutline(switches);
    var fpDir = path.join(OUT_DIR, "footprints", "PSDevkit.pretty");
    fs.mkdirSync(fpDir, { recursive: true });
    writeText(path.join(fpDir, "TL3315NF160Q.kicad_mod"), generateFootprintLib());
    writeText(path.join(OUT_DIR, "fp-lib-table"), "(fp_lib_table\n  (lib (name PSDevkit)(type KiCad)(uri \"${KIPRJMOD}/footprints/PSDevkit.pretty\")(options \"\")(descr \"Devkit footprints\"))\n)\n");
    writeText(path.join(OUT_DIR, "input_board.kicad_pro"), generateProject());
    writeText(path.join(OUT_DIR, "input_board.kicad_sch"), generateSchematic(switches));
    writeText(path.join(OUT_DIR, "input_board.kicad_pcb"), generatePcb(switches, outline));
    writeText(path.join(OUT_DIR, "bom_jlc.csv"), generateBom());
    writeText(path.join(OUT_DIR, "layout.json"), JSON.stringify({ switches: switches, outline: outline }, null, 2) + "\n");
    return { switches: switches.length, outline: outline };
}

if (require.main === module) {
    var result = generateAll();
    console.log("Generated Waveshare 4.3 input board: " + result.switches + " switches, " +
        fmt(result.outline.w) + " x " + fmt(result.outline.h) + " mm");
    console.log("Open: hardware/devkit/waveshare_43_input/input_board.kicad_pro");
}

module.exports = { generateAll: generateAll, buildSwitchList: buildSwitchList, boardOutline: boardOutline };

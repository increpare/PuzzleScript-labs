"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var BOARD_DIR = path.join(__dirname, "..");
var SCHEMATIC_DIR = __dirname;
var jlcParts = require("./jlc_parts.js");
var uuidCounter = 0;

function uuid() {
    uuidCounter++;
    var hex = crypto.createHash("sha1")
        .update("psp4h-kicad:" + uuidCounter)
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

function pinsForComponent(model, ref) {
    var pins = [];
    var seen = {};
    model.connections.forEach(function (conn) {
        conn.nodes.forEach(function (node) {
            if (node[0] !== ref || seen[node[1]]) {
                return;
            }
            seen[node[1]] = true;
            pins.push({ pin: node[1], net: conn.net });
        });
    });
    return pins;
}

// Symbol geometry: pins split left/right on a 2.54 grid, body wide enough
// for pin names, every coordinate a multiple of 1.27 so ERC's grid check
// passes. The pin "at" is its connection endpoint (KiCad lib convention).
var BODY_HALF_W = 12.7;
var PIN_LEN = 2.54;
var PIN_X = BODY_HALF_W + PIN_LEN;

function symbolGeometry(pins) {
    var leftN = Math.ceil(pins.length / 2);
    var rightN = pins.length - leftN;
    var rows = Math.max(leftN, rightN, 1);
    var topY = ((rows - 1) * 2.54) / 2;
    var left = pins.slice(0, leftN).map(function (p, i) {
        return { pin: p.pin, net: p.net, x: -PIN_X, y: topY - i * 2.54, angle: 0 };
    });
    var right = pins.slice(leftN).map(function (p, i) {
        return { pin: p.pin, net: p.net, x: PIN_X, y: topY - i * 2.54, angle: 180 };
    });
    return {
        pins: left.concat(right),
        halfH: topY + 2.54,
        rows: rows
    };
}

function symbolDefName(comp) {
    return "SYM_" + comp.ref;
}

function fmtNum(n) {
    return String(Number(n.toFixed(2)));
}

function componentSymbolDef(comp, geom) {
    var name = symbolDefName(comp);
    var lines = [
        "  (symbol \"PSP4H:" + name + "\" (pin_numbers hide) (pin_names (offset 0.254)) (exclude_from_sim no) (in_bom yes) (on_board yes)",
        "    (property \"Reference\" \"" + esc(comp.ref.replace(/[0-9].*$/, "")) + "\" (at 0 " + fmtNum(geom.halfH + 1.27) + " 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"" + esc(comp.value) + "\" (at 0 " + fmtNum(-(geom.halfH + 1.27)) + " 0) (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"\" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))",
        "    (symbol \"" + name + "_0_1\"",
        "      (rectangle (start " + fmtNum(-BODY_HALF_W) + " " + fmtNum(geom.halfH) + ") (end " + fmtNum(BODY_HALF_W) + " " + fmtNum(-geom.halfH) + ") (stroke (width 0.254) (type default)) (fill (type background)))",
        "    )",
        "    (symbol \"" + name + "_1_1\""
    ];
    geom.pins.forEach(function (p) {
        lines.push("      (pin passive line (at " + fmtNum(p.x) + " " + fmtNum(p.y) + " " + p.angle +
            ") (length " + PIN_LEN + ") (name \"" + esc(p.pin) + "\" (effects (font (size 1.27 1.27)))) (number \"" +
            esc(p.pin) + "\" (effects (font (size 1.27 1.27)))))");
    });
    lines.push("    )", "  )");
    return lines.join("\n");
}

function symbolInstance(comp, atX, atY, projectPath, geom) {
    var id = uuid();
    var footprintPlan = comp.easyeda_footprint || comp.footprint || "";
    var lines = [
        "  (symbol (lib_id \"PSP4H:" + symbolDefName(comp) + "\") (at " + fmtNum(atX) + " " + fmtNum(atY) + " 0) (unit 1)",
        "    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no)",
        "    (uuid \"" + id + "\")",
        "    (property \"Reference\" \"" + esc(comp.ref) + "\" (at " + fmtNum(atX) + " " + fmtNum(atY - geom.halfH - 2.54) + " 0)",
        "      (effects (font (size 1.27 1.27))))",
        "    (property \"Value\" \"" + esc(comp.value) + "\" (at " + fmtNum(atX) + " " + fmtNum(atY + geom.halfH + 2.54) + " 0)",
        "      (effects (font (size 1.27 1.27))))",
        "    (property \"Footprint\" \"\" (at " + fmtNum(atX) + " " + fmtNum(atY) + " 0)",
        "      (effects (font (size 1.27 1.27)) hide))",
        "    (property \"FootprintPlan\" \"" + esc(footprintPlan) + "\" (at " + fmtNum(atX) + " " + fmtNum(atY) + " 0)",
        "      (effects (font (size 1.27 1.27)) hide))",
        "    (property \"Datasheet\" \"~\" (at " + fmtNum(atX) + " " + fmtNum(atY) + " 0)",
        "      (effects (font (size 1.27 1.27)) hide))"
    ];
    if (comp.gate) {
        lines.push(
            "    (property \"Gate\" \"" + esc(comp.gate) + "\" (at " + fmtNum(atX) + " " + fmtNum(atY) + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))"
        );
    }
    if (comp.lcsc) {
        lines.push(
            "    (property \"LCSC\" \"" + esc(comp.lcsc) + "\" (at " + fmtNum(atX) + " " + fmtNum(atY) + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))"
        );
    }
    if (comp.mpn) {
        lines.push(
            "    (property \"MPN\" \"" + esc(comp.mpn) + "\" (at " + fmtNum(atX) + " " + fmtNum(atY) + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))"
        );
    }
    geom.pins.forEach(function (p) {
        lines.push("    (pin \"" + esc(p.pin) + "\" (uuid \"" + uuid() + "\"))");
    });
    lines.push(
        "    (instances (project \"p4_handheld\" (path \"" + projectPath + "\" (reference \"" + esc(comp.ref) + "\") (unit 1))))",
        "  )"
    );
    return lines.join("\n");
}

// A label placed exactly on a pin endpoint connects to it; globals are used
// for nets that span sheets, locals otherwise, never both for one net.
function pinLabel(net, x, y, side, isGlobal) {
    var rot = side === "left" ? 180 : 0;
    if (isGlobal) {
        return [
            "  (global_label \"" + esc(net) + "\" (shape input) (at " + fmtNum(x) + " " + fmtNum(y) + " " + rot + ") (fields_autoplaced)",
            "    (effects (font (size 1.27 1.27)) (justify " + (side === "left" ? "right" : "left") + "))",
            "    (uuid \"" + uuid() + "\")",
            "    (property \"Intersheetrefs\" \"${INTERSHEET_REFS}\" (at " + fmtNum(x) + " " + fmtNum(y) + " 0)",
            "      (effects (font (size 1.27 1.27)) hide))",
            "  )"
        ].join("\n");
    }
    return [
        "  (label \"" + esc(net) + "\" (at " + fmtNum(x) + " " + fmtNum(y) + " " + rot + ") (fields_autoplaced)",
        "    (effects (font (size 1.27 1.27)) (justify " + (side === "left" ? "right" : "left") + ")) (uuid \"" + uuid() + "\"))"
    ].join("\n");
}

function buildSheet(model, sheetId, sheetFile, projectPath) {
    var comps = model.components.filter(function (c) { return c.sheet === sheetId; });
    var cross = crossSheetNets(model.connections, model.components);
    var symbolDefs = [];
    var body = [];

    // Column-flow placement: advance down, wrap to a new column before the
    // page bottom. All origins on the 1.27 grid.
    var colX = 50.8;
    var cursorY = 25.4;
    var colWidth = 88.9;
    var pageBottom = 266.7;

    comps.forEach(function (comp) {
        var pins = pinsForComponent(model, comp.ref);
        var geom = symbolGeometry(pins);
        symbolDefs.push(componentSymbolDef(comp, geom));
        var need = geom.halfH * 2 + 12.7;
        if (cursorY + need > pageBottom && cursorY > 25.4) {
            colX += colWidth;
            cursorY = 25.4;
        }
        var atY = Math.round((cursorY + geom.halfH) / 1.27) * 1.27;
        body.push(symbolInstance(comp, colX, atY, projectPath, geom));
        geom.pins.forEach(function (p) {
            var absX = colX + p.x;
            var absY = atY - p.y;
            var side = p.x < 0 ? "left" : "right";
            body.push(pinLabel(p.net, absX, absY, side, !!cross[p.net]));
        });
        cursorY = atY + geom.halfH + 12.7;
    });

    var lines = [
        "(kicad_sch",
        "  (version 20250114)",
        "  (generator \"PuzzleScript generate_kicad.js\")",
        "  (generator_version \"1.0\")",
        "  (uuid \"" + uuid() + "\")",
        "  (paper \"A3\")",
        "  (title_block",
        "    (title \"" + esc(model.meta.project + " — " + sheetId) + "\")",
        "    (date \"" + model.meta.date + "\")",
        "    (rev \"" + esc(model.meta.revision) + "\")",
        "    (comment 1 \"Auto-generated from connectivity.json\")",
        "    (comment 2 \"Labels sit on pin endpoints; globals cross sheets\")",
        "  )",
        "(lib_symbols",
        symbolDefs.join("\n"),
        ")"
    ];
    body.forEach(function (b) { lines.push(b); });
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
        "    (title \"" + esc(model.meta.project) + "\")",
        "    (date \"" + model.meta.date + "\")",
        "    (rev \"" + esc(model.meta.revision) + "\")",
        "  )",
        "  (lib_symbols)"
    ];
    model.sheets.forEach(function (sh, i) {
        var col = i % 3;
        var row = Math.floor(i / 3);
        var x = 25.4 + col * 96.52;
        var y = 25.4 + row * 71.12;
        var sid = uuid();
        lines.push("  (sheet (at " + fmtNum(x) + " " + fmtNum(y) + ") (size 81.28 60.96) (fields_autoplaced)",
            "    (stroke (width 0.1524) (type solid)) (fill (type none)) (uuid \"" + sid + "\")",
            "    (property \"Sheetname\" \"" + esc(sh.title) + "\" (at " + fmtNum(x) + " " + fmtNum(y - 2.54) + " 0)",
            "      (effects (font (size 1.27 1.27)) (justify left bottom)))",
            "    (property \"Sheetfile\" \"" + esc("schematic/" + sh.file) + "\" (at " + fmtNum(x) + " " + fmtNum(y + 63.5) + " 0)",
            "      (effects (font (size 1.27 1.27)) (justify left top)))",
            "  )");
    });
    lines.push(")");
    return lines.join("\n") + "\n";
}

function footprintIsOpen(component) {
    return jlcParts.footprintIsOpen(component);
}

function footprintLibraryName(component) {
    return jlcParts.footprintLibraryName(component);
}

function buildSymbolLibrary(model) {
    var lines = [
        "(kicad_symbol_lib",
        "  (version 20241209)",
        "  (generator \"PuzzleScript generate_kicad.js\")",
        "  (generator_version \"1.0\")"
    ];
    model.components.forEach(function (comp) {
        var geom = symbolGeometry(pinsForComponent(model, comp.ref));
        lines.push(componentSymbolDef(comp, geom).replace("(symbol \"PSP4H:", "(symbol \""));
    });
    lines.push(")");
    return lines.join("\n") + "\n";
}

function buildSymLibTable() {
    return [
        "(sym_lib_table",
        "  (version 7)",
        "  (lib (name \"PSP4H\")(type \"KiCad\")(uri \"${KIPRJMOD}/PSP4H.kicad_sym\")(options \"\")(descr \"Generated from connectivity.json\"))",
        ")"
    ].join("\n") + "\n";
}

function buildProject() {
    return JSON.stringify({
        board: { "3dviewports": [], layer_presets: [] },
        boards: [],
        csv: { formats: [] },
        libraries: { pinned_footprint_libs: [], pinned_symbol_libs: [] },
        meta: { filename: "p4_handheld.kicad_pro", version: 3 },
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
        sheets: [["p4_handheld.kicad_sch", "Root"]],
        text_variables: {}
    }, null, 2) + "\n";
}

function generateAll() {
    uuidCounter = 0;
    var applied = jlcParts.applyCatalog(loadJson(path.join(SCHEMATIC_DIR, "connectivity.json")));
    var model = applied.model;
    var sheetsDir = path.join(SCHEMATIC_DIR, "sheets");
    fs.mkdirSync(sheetsDir, { recursive: true });

    model.sheets.forEach(function (sh) {
        var projectPath = "/p4_handheld/" + sh.file.replace(/\\/g, "/").replace(".kicad_sch", "");
        var content = buildSheet(model, sh.id, sh.file, projectPath);
        fs.writeFileSync(path.join(SCHEMATIC_DIR, sh.file), content, "utf8");
    });

    fs.writeFileSync(path.join(BOARD_DIR, "p4_handheld.kicad_sch"), buildRootSheet(model), "utf8");
    fs.writeFileSync(path.join(BOARD_DIR, "p4_handheld.kicad_pro"), buildProject(), "utf8");
    fs.writeFileSync(path.join(BOARD_DIR, "PSP4H.kicad_sym"), buildSymbolLibrary(model), "utf8");
    fs.writeFileSync(path.join(BOARD_DIR, "sym-lib-table"), buildSymLibTable(), "utf8");
    fs.mkdirSync(path.join(BOARD_DIR, "bom"), { recursive: true });
    fs.writeFileSync(path.join(BOARD_DIR, "bom", "bom_jlc.csv"), jlcParts.bomCsv(model), "utf8");

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
    console.log("Open: hardware/p4_handheld/p4_handheld.kicad_pro in KiCad 8");
}

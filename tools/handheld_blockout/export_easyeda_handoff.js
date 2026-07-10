"use strict";

var fs = require("fs");
var path = require("path");

var REPO_ROOT = path.join(__dirname, "..", "..");
var DEFAULT_OUT = path.join(REPO_ROOT, "hardware", "card", "easyeda_handoff");

function usage() {
    console.error("Usage: node tools/handheld_blockout/export_easyeda_handoff.js [--out DIR]");
    console.error("  default out: hardware/card/easyeda_handoff");
    process.exit(2);
}

function parseArgs(argv) {
    var outDir = DEFAULT_OUT;
    for (var i = 2; i < argv.length; i++) {
        if (argv[i] === "--out") {
            outDir = argv[++i];
        } else if (argv[i] === "-h" || argv[i] === "--help") {
            usage();
        } else {
            console.error("Unknown argument: " + argv[i]);
            usage();
        }
    }
    if (!outDir) {
        usage();
    }
    return { outDir: path.resolve(outDir) };
}

function mkdirp(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dst) {
    mkdirp(path.dirname(dst));
    fs.copyFileSync(src, dst);
}

function copyIfExists(src, dst) {
    if (fs.existsSync(src)) {
        copyFile(src, dst);
    }
}

function copyDirFiles(srcDir, dstDir, suffix) {
    mkdirp(dstDir);
    fs.readdirSync(srcDir).forEach(function (name) {
        if (suffix && name.slice(-suffix.length) !== suffix) {
            return;
        }
        copyFile(path.join(srcDir, name), path.join(dstDir, name));
    });
}

function stripGeneratedCopper(pcbText) {
    return pcbText.split(/\n/).filter(function (line) {
        return line.indexOf("  (segment ") !== 0 && line.indexOf("  (via ") !== 0;
    }).join("\n").replace(/\n?$/, "\n");
}

function writeText(file, text) {
    mkdirp(path.dirname(file));
    fs.writeFileSync(file, text, "utf8");
}

function routeSummary(previewJson) {
    return previewJson.routeStatus.map(function (item) {
        return "| " + item.family + " | " + item.status + " | " + item.routes + " | " + item.airwires + " | " +
            (item.gate || "") + " |";
    }).join("\n");
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function packageReadme(previewJson, jlcSummary) {
    return [
        "# EasyEDA Handoff - PuzzleScript Card",
        "",
        "This package is for manual PCB routing in EasyEDA Pro. It ships a full KiCad project",
        "with JLC/LCSC part numbers, EasyEDA footprint names, schematic sheets, placement anchors,",
        "and an unrouted PCB.",
        "",
        "**Important:** EasyEDA Pro's KiCad importer brings in placement, nets, and custom fields,",
        "but it does **not** auto-link parts to EasyEDA's LCSC library. That linking only happens",
        "when you place parts from EasyEDA's own library panel. The `LCSC` / `MPN` fields here are",
        "for procurement (JLCPCB BOM export from KiCad) and as a lookup table while you associate",
        "parts in EasyEDA — not for automatic import-time matching.",
        "",
        "## Start Here (EasyEDA Pro)",
        "",
        "1. **Import the full KiCad project**: `import/card.kicad_pro` (File → Import → KiCad).",
        "2. **Associate LCSC parts** (required, not automatic):",
        "   - Open **Left panel → Device Standardization** for flagged mismatches.",
        "   - Or **Tools → Device Manager**: select a component, choose **Assign LCSC Part**,",
        "     and search by the `LCSC` column from `import/bom_jlc.csv` (e.g. `C2765186`), not",
        "     by the generic KiCad value string.",
        "   - There are **" + jlcSummary.uniqueLcsc + " unique LCSC parts** for " +
            jlcSummary.designators + " designators — group identical values in",
        "     Device Manager so each LCSC number only needs to be assigned once per part type.",
        "3. Cross-check `import/bom_jlc.csv` and `import/schematic/jlc_catalog.json`.",
        "4. Keep `mechanical/layout.svg` open while verifying footprint placement.",
        "5. Route manually in this order: DSI, USB, power, storage, then low-speed controls/audio/haptics/LEDs.",
        "",
        "### Skip EasyEDA association entirely?",
        "",
        "If the goal is JLCPCB assembly rather than EasyEDA routing, you can stay in KiCad:",
        "pull real symbols/footprints with [easyeda2kicad](https://github.com/uPesy/easyeda2kicad.py)",
        "using the LCSC numbers in `bom_jlc.csv`, route in KiCad, and order with the JLCPCB",
        "Fabrication Toolkit. The LCSC fields are already in the right shape for that path.",
        "",
        "## JLC Catalog Coverage",
        "",
        "- Locked parts: " + jlcSummary.locked,
        "- Candidate parts (gate still open): " + jlcSummary.candidate,
        "- Open / off-board: " + jlcSummary.open,
        "",
        "Re-check LCSC stock and assembly tier immediately before ordering.",
        "",
        "## Current Generated Route Reference",
        "",
        "| Family | Status | Generated routes | Airwires | Gate |",
        "|---|---:|---:|---:|---|",
        routeSummary(previewJson),
        "",
        "The generated reference currently reports " + previewJson.routedTraceCount +
            " routed traces and " + previewJson.airwires.length + " airwires.",
        "Treat those traces as connectivity proof only, not a manufacturable layout.",
        "",
        "## Key Gates",
        "",
        "- `GATE-DSI-FFC-CONTACT`: do not finalize DSI routing until the real FFC contact side, latch side, cable exit, and pin 1 are confirmed.",
        "- `GATE-MICROSD-FOOTPRINT`: pick the actual internal service socket footprint before final SD routing.",
        "- `GATE-POWER-SLIDE-SLOT`: check switch travel/slot and OFF/ON orientation in the shell.",
        "- `GATE-BATTERY-SAMPLE`: measure protected 403048-class cells before final battery connector placement.",
        "- `GATE-ESP32-P4-REF-CAPTURE`: verify crystal load caps, flash voltage domain, and P4 DC-DC inductor against Espressif reference.",
        "",
        "## Contents",
        "",
        "- `import/`: KiCad project, JLC BOM, catalog JSON, schematic sheets, netlist.",
        "- `mechanical/`: layout JSON/SVG exported from the blockout tool.",
        "- `reference/`: generated preview HTML/SVG/JSON and routed-reference KiCad PCB.",
        "- `docs/`: gate, DSI, component, and pin-budget notes.",
        "",
        "## Fabrication Warning",
        "",
        "Do not order from this package without human routing review, DRC/ERC, footprint verification,",
        "JLC/LCSC availability review, and a mechanical check against the case.",
        ""
    ].join("\n");
}

function routingNotes() {
    return [
        "# Routing Notes",
        "",
        "## Priority",
        "",
        "1. DSI differential pairs: target 100 ohm differential on the selected stackup, short, length-matched, continuous reference plane.",
        "2. USB 2.0: route D+/D- as a pair from J1 to U1, keep stubs short, review connector orientation.",
        "3. Power: replace point-to-point generated routes with pours/planes and compact charger/buck-boost loops.",
        "4. Storage: route after selecting the exact microSD footprint.",
        "5. Low-speed controls, LEDs, haptic, and piezo can be routed last.",
        "",
        "## EasyEDA Library Association",
        "",
        "Each schematic symbol and PCB footprint carries an `LCSC` property when a JLC part is mapped.",
        "Footprint names use the EasyEDA package string (`easyeda:...`) from `jlc_catalog.json`.",
        "If EasyEDA does not auto-match a gated candidate part, search by LCSC number manually and replace the footprint.",
        "",
        "## DSI Physical Gate",
        "",
        "The schematic pinout is captured, but the card-end contact orientation is still gated.",
        "Confirm same-side/opposite-side cable parity, latch side, cable exit, and pin 1 before fabrication.",
        "",
        "## Generated Reference",
        "",
        "`reference/card_routed_reference.kicad_pcb` contains the generated first-pass traces.",
        "Use it only to see what nets need to connect; do not preserve those traces unless you deliberately reroute and review them.",
        ""
    ].join("\n");
}

function fpLibTable() {
    return [
        "(fp_lib_table",
        "  (version 7)",
        "  (lib (name \"easyeda\")(type \"KiCad\")(uri \"${KIPRJMOD}/easyeda.pretty\")(options \"\")(descr \"EasyEDA/JLC footprint names referenced by LCSC catalog\"))",
        ")"
    ].join("\n") + "\n";
}

function symLibTable() {
    return [
        "(sym_lib_table",
        "  (version 7)",
        "  (lib (name \"card\")(type \"KiCad\")(uri \"${KIPRJMOD}/card.kicad_sch\")(options \"\")(descr \"Embedded hierarchical schematic symbols\"))",
        ")"
    ].join("\n") + "\n";
}

function exportPackage(outDir) {
    var cardDir = path.join(REPO_ROOT, "hardware", "card");
    var importDir = path.join(outDir, "import");
    var referenceDir = path.join(outDir, "reference");
    var docsDir = path.join(outDir, "docs");
    var mechanicalDir = path.join(outDir, "mechanical");
    mkdirp(outDir);

    var pcbText = fs.readFileSync(path.join(cardDir, "card.kicad_pcb"), "utf8");
    writeText(path.join(importDir, "card_easyeda_unrouted.kicad_pcb"), stripGeneratedCopper(pcbText));
    copyFile(path.join(cardDir, "card.kicad_pcb"), path.join(importDir, "card.kicad_pcb"));
    copyFile(path.join(cardDir, "card.kicad_pro"), path.join(importDir, "card.kicad_pro"));
    copyFile(path.join(cardDir, "card.kicad_sch"), path.join(importDir, "card.kicad_sch"));
    copyFile(path.join(cardDir, "card.net"), path.join(importDir, "card.net"));
    copyIfExists(path.join(cardDir, "bom_jlc.csv"), path.join(importDir, "bom_jlc.csv"));
    copyIfExists(path.join(cardDir, "schematic", "jlc_catalog.json"), path.join(importDir, "schematic", "jlc_catalog.json"));
    copyIfExists(path.join(cardDir, "schematic", "connectivity.json"), path.join(importDir, "schematic", "connectivity.json"));
    copyDirFiles(path.join(cardDir, "schematic", "sheets"), path.join(importDir, "schematic", "sheets"), ".kicad_sch");
    writeText(path.join(importDir, "fp-lib-table"), fpLibTable());
    writeText(path.join(importDir, "sym-lib-table"), symLibTable());

    copyFile(path.join(cardDir, "mechanical", "layout.json"), path.join(mechanicalDir, "layout.json"));
    copyFile(path.join(cardDir, "mechanical", "layout.svg"), path.join(mechanicalDir, "layout.svg"));

    copyFile(path.join(cardDir, "card.kicad_pcb"), path.join(referenceDir, "card_routed_reference.kicad_pcb"));
    copyFile(path.join(cardDir, "preview", "index.html"), path.join(referenceDir, "board_preview.html"));
    copyFile(path.join(cardDir, "preview", "board_preview.svg"), path.join(referenceDir, "board_preview.svg"));
    copyFile(path.join(cardDir, "preview", "board_preview.json"), path.join(referenceDir, "board_preview.json"));

    [
        "DSI_PANEL_INTERFACE.md",
        "FOOTPRINT_LOCK_MATRIX.md",
        "COMPONENT_SELECTION.md",
        "PIN_BUDGET.md",
        "README.md"
    ].forEach(function (name) {
        copyIfExists(path.join(cardDir, name), path.join(docsDir, name));
    });

    var previewJson = readJson(path.join(cardDir, "preview", "board_preview.json"));
    var jlcSummary = readJson(path.join(cardDir, "schematic", "jlc_catalog.json"));
    var jlcParts = jlcSummary.parts;
    var lcscSet = {};
    Object.keys(jlcParts).forEach(function (ref) {
        var lcsc = jlcParts[ref].lcsc;
        if (lcsc) {
            lcscSet[lcsc] = true;
        }
    });
    writeText(path.join(outDir, "README.md"), packageReadme(previewJson, {
        locked: Object.keys(jlcParts).filter(function (ref) {
            return jlcParts[ref].status === "locked";
        }).length,
        candidate: Object.keys(jlcParts).filter(function (ref) {
            return jlcParts[ref].status === "candidate";
        }).length,
        open: Object.keys(jlcParts).filter(function (ref) {
            return jlcParts[ref].status === "open";
        }).length,
        uniqueLcsc: Object.keys(lcscSet).length,
        designators: Object.keys(jlcParts).length
    }));
    writeText(path.join(outDir, "ROUTING_NOTES.md"), routingNotes());

    return {
        outDir: outDir,
        unroutedPcb: path.join(importDir, "card_easyeda_unrouted.kicad_pcb"),
        routedReference: path.join(referenceDir, "card_routed_reference.kicad_pcb"),
        kicadProject: path.join(importDir, "card.kicad_pro")
    };
}

function main() {
    var args = parseArgs(process.argv);
    var info = exportPackage(args.outDir);
    var unrouted = fs.readFileSync(info.unroutedPcb, "utf8");
    console.log("Wrote " + info.outDir);
    console.log("KiCad project: " + info.kicadProject);
    console.log("Unrouted import PCB: " + (unrouted.match(/\(segment /g) || []).length + " segments, " +
        (unrouted.match(/\(via /g) || []).length + " vias");
    console.log("LCSC-tagged footprints: " + (unrouted.match(/\(property "LCSC"/g) || []).length);
}

if (require.main === module) {
    main();
}

module.exports = {
    parseArgs: parseArgs,
    stripGeneratedCopper: stripGeneratedCopper,
    exportPackage: exportPackage
};

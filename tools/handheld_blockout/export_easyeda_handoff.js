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

function packageReadme(previewJson) {
    return [
        "# EasyEDA Handoff - PuzzleScript Card",
        "",
        "This package is for manual PCB routing in EasyEDA Pro or another EDA editor.",
        "It keeps the current outline, footprint placeholders, pad nets, schematic sheets,",
        "mechanical references, and routing notes, but the import board is intentionally",
        "unrouted so the generated trace spaghetti is not treated as layout work.",
        "",
        "## Start Here",
        "",
        "1. Import `import/card_easyeda_unrouted.kicad_pcb` into EasyEDA Pro.",
        "2. Use `import/card.net` and `import/schematic/connectivity.json` as net references if needed.",
        "3. Keep `mechanical/layout.svg` open while placing final footprints.",
        "4. Use `reference/board_preview.html` only as a visual progress/reference artifact.",
        "5. Route manually in this order: DSI, USB, power, storage, then low-speed controls/audio/haptics/LEDs.",
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
        "",
        "## Contents",
        "",
        "- `import/`: clean KiCad board/project/schematic/netlist files for import.",
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

function exportPackage(outDir) {
    var cardDir = path.join(REPO_ROOT, "hardware", "card");
    var importDir = path.join(outDir, "import");
    var referenceDir = path.join(outDir, "reference");
    var docsDir = path.join(outDir, "docs");
    var mechanicalDir = path.join(outDir, "mechanical");
    mkdirp(outDir);

    var pcbText = fs.readFileSync(path.join(cardDir, "card.kicad_pcb"), "utf8");
    writeText(path.join(importDir, "card_easyeda_unrouted.kicad_pcb"), stripGeneratedCopper(pcbText));
    copyFile(path.join(cardDir, "card.kicad_pro"), path.join(importDir, "card.kicad_pro"));
    copyFile(path.join(cardDir, "card.kicad_sch"), path.join(importDir, "card.kicad_sch"));
    copyFile(path.join(cardDir, "card.net"), path.join(importDir, "card.net"));
    copyIfExists(path.join(cardDir, "schematic", "connectivity.json"), path.join(importDir, "schematic", "connectivity.json"));
    copyDirFiles(path.join(cardDir, "schematic", "sheets"), path.join(importDir, "schematic", "sheets"), ".kicad_sch");

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
    writeText(path.join(outDir, "README.md"), packageReadme(previewJson));
    writeText(path.join(outDir, "ROUTING_NOTES.md"), routingNotes());

    return {
        outDir: outDir,
        unroutedPcb: path.join(importDir, "card_easyeda_unrouted.kicad_pcb"),
        routedReference: path.join(referenceDir, "card_routed_reference.kicad_pcb")
    };
}

function main() {
    var args = parseArgs(process.argv);
    var info = exportPackage(args.outDir);
    var unrouted = fs.readFileSync(info.unroutedPcb, "utf8");
    console.log("Wrote " + info.outDir);
    console.log("Unrouted import PCB: " + (unrouted.match(/\(segment /g) || []).length + " segments, " +
        (unrouted.match(/\(via /g) || []).length + " vias");
}

if (require.main === module) {
    main();
}

module.exports = {
    parseArgs: parseArgs,
    stripGeneratedCopper: stripGeneratedCopper,
    exportPackage: exportPackage
};

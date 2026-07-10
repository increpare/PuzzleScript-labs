"use strict";

var fs = require("fs");
var path = require("path");
var preview = require("./board_preview.js");

function usage() {
    console.error("Usage: node tools/handheld_blockout/export_board_preview.js [--out DIR]");
    console.error("  default out: hardware/card/preview");
    process.exit(2);
}

function parseArgs(argv) {
    var outDir = path.join("hardware", "card", "preview");
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
    return { outDir: outDir };
}

function main() {
    var args = parseArgs(process.argv);
    var outDir = path.resolve(args.outDir);
    fs.mkdirSync(outDir, { recursive: true });

    var model = preview.buildPreview();
    var htmlPath = path.join(outDir, "index.html");
    var svgPath = path.join(outDir, "board_preview.svg");
    var jsonPath = path.join(outDir, "board_preview.json");
    fs.writeFileSync(htmlPath, preview.previewToHtml(model), "utf8");
    fs.writeFileSync(svgPath, preview.previewToSvg(model), "utf8");
    fs.writeFileSync(jsonPath, preview.previewToJson(model), "utf8");

    console.log("Wrote " + htmlPath);
    console.log("Wrote " + svgPath);
    console.log("Wrote " + jsonPath);
    console.log("Preview: " + model.components.length + " components, " +
        model.airwires.length + " airwires, routed traces=" + model.routedTraceCount);
}

if (require.main === module) {
    main();
}

module.exports = { parseArgs: parseArgs, main: main };

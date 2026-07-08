"use strict";

var fs = require("fs");
var path = require("path");
var blockout = require("./blockout.js");
var pcb = require("./pcb_layout.js");

function usage() {
    console.error("Usage: node tools/handheld_blockout/export_pcb_layout.js [--preset NAME] [--out DIR]");
    console.error("  default preset: card");
    console.error("  default out:    hardware/card/mechanical");
    process.exit(2);
}

function parseArgs(argv) {
    var preset = "card";
    var outDir = path.join("hardware", "card", "mechanical");
    for (var i = 2; i < argv.length; i++) {
        if (argv[i] === "--preset") {
            preset = argv[++i];
        } else if (argv[i] === "--out") {
            outDir = argv[++i];
        } else if (argv[i] === "-h" || argv[i] === "--help") {
            usage();
        } else {
            console.error("Unknown argument: " + argv[i]);
            usage();
        }
    }
    if (!preset || !outDir) {
        usage();
    }
    return { preset: preset, outDir: outDir };
}

function main() {
    var args = parseArgs(process.argv);
    var params = blockout.BLOCKOUT_PRESETS[args.preset];
    if (!params) {
        console.error("Unknown preset: " + args.preset);
        process.exit(1);
    }

    var layout = pcb.buildPcbLayout(params);
    var outDir = path.resolve(args.outDir);
    fs.mkdirSync(outDir, { recursive: true });

    var jsonPath = path.join(outDir, "layout.json");
    var svgPath = path.join(outDir, "layout.svg");
    fs.writeFileSync(jsonPath, pcb.layoutToJson(layout), "utf8");
    fs.writeFileSync(svgPath, pcb.layoutToSvg(layout), "utf8");

    console.log("Wrote " + jsonPath);
    console.log("Wrote " + svgPath);
    console.log("PCB outline: " + layout.pcb.w + " x " + layout.pcb.h +
        " mm, r=" + layout.pcb.r + " (inset " + layout.meta.pcbInset + " mm from body)");
    console.log("Anchors: " + layout.anchors.length + ", keep-outs: " + layout.keepouts.length +
        ", mounting holes: " + layout.mountingHoles.length);
}

if (require.main === module) {
    main();
}

module.exports = { parseArgs: parseArgs, main: main };

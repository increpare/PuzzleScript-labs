"use strict";

var fs = require("fs");
var path = require("path");
var L = require("./legibility.js");

var displayWidth = 800;
var displayHeight = 480;
if (process.argv[2]) {
    displayWidth = parseInt(process.argv[2], 10);
}
if (process.argv[3]) {
    displayHeight = parseInt(process.argv[3], 10);
}

var outDir = path.join(__dirname, "..", "..", "build");
fs.mkdirSync(outDir, { recursive: true });
var outPath = path.join(outDir, "text_stretch_compare.svg");
var svg = L.textStretchCompareSvg(displayWidth, displayHeight);
fs.writeFileSync(outPath, svg, "utf8");

var oldLayout = L.computeIntegerTextLayout(displayWidth, displayHeight);
var newLayout = L.computeFilledTextLayout(displayWidth, displayHeight);
console.log("Wrote " + outPath);
console.log("Display: " + displayWidth + "x" + displayHeight);
console.log("Before: scale " + oldLayout.scale + ", grid " + oldLayout.gridW + "x" + oldLayout.gridH +
    ", cells " + oldLayout.cellW + "x" + oldLayout.cellH);
console.log("After:  grid " + newLayout.gridW + "x" + newLayout.gridH +
    ", cells " + newLayout.cellW + "x" + newLayout.cellH +
    ", glyph scale " + newLayout.glyphScaleX + "x" + newLayout.glyphScaleY);

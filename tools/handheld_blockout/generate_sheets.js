"use strict";
// Regenerates the committed validation sheets for the card spec.
// Run from anywhere: node tools/handheld_blockout/generate_sheets.js
var fs = require("fs");
var path = require("path");
var B = require("./blockout.js");
var L = require("./legibility.js");

var notes = path.join(__dirname, "..", "..", "docs", "superpowers", "notes");
var oneToOne = path.join(notes, "2026-07-07-handheld-card-1to1.svg");
var legibility = path.join(notes, "2026-07-07-handheld-card-legibility.svg");

fs.writeFileSync(oneToOne, B.printSheetSvg(B.BLOCKOUT_PRESETS.card));
fs.writeFileSync(legibility, L.legibilitySheetSvg());
console.log("wrote " + oneToOne);
console.log("wrote " + legibility);

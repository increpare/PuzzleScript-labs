"use strict";

/**
 * Mechanical-fit PCB preview (116×106 mm + 120×110 mm body frame).
 * tscircuit's pcb-svg export uses a fixed 800×600 canvas and a content bbox —
 * use this SVG to verify placement against layout.json.
 */
var fs = require("fs");
var path = require("path");
var layout = require("../mechanical/layout.json");

var PCB_W_MM = 116;
var PCB_H_MM = 106;
var PCB_R_MM = 7;
var PCB_INSET_MM = 2;

var ROOT = __dirname;
var OUT = path.join(ROOT, "dist", "card-pcb-layout.svg");

function pcbLocal(bodyCoord) {
  return bodyCoord - PCB_INSET_MM;
}

function roundedRectPath(x, y, w, h, r) {
  var rr = Math.min(r, w / 2, h / 2);
  return (
    "M " + (x + rr) + " " + y +
    " H " + (x + w - rr) +
    " A " + rr + " " + rr + " 0 0 1 " + (x + w) + " " + (y + rr) +
    " V " + (y + h - rr) +
    " A " + rr + " " + rr + " 0 0 1 " + (x + w - rr) + " " + (y + h) +
    " H " + (x + rr) +
    " A " + rr + " " + rr + " 0 0 1 " + x + " " + (y + h - rr) +
    " V " + (y + rr) +
    " A " + rr + " " + rr + " 0 0 1 " + (x + rr) + " " + y +
    " Z"
  );
}

function keepoutRect(k) {
  var x = pcbLocal(k.x);
  var y = pcbLocal(k.y);
  var dash = k.layer === "keepout" ? ' stroke-dasharray="1.5,1"' : "";
  return (
    '<rect x="' + x + '" y="' + y + '" width="' + k.w + '" height="' + k.h + '"' +
    ' fill="none" stroke="#f80" stroke-width="0.2"' + dash + '/>' +
    '<text x="' + (x + k.w / 2) + '" y="' + (y - 0.6) + '" font-size="1.8"' +
    ' text-anchor="middle" font-family="sans-serif" fill="#f80">' + k.id + "</text>"
  );
}

function anchorDot(a) {
  var x = pcbLocal(a.x);
  var y = pcbLocal(a.y);
  return (
    '<circle cx="' + x + '" cy="' + y + '" r="0.7" fill="#ddd"/>' +
    '<text x="' + x + '" y="' + (y - 1.2) + '" font-size="1.4" text-anchor="middle"' +
    ' font-family="sans-serif" fill="#ccc">' + a.id + "</text>"
  );
}

/** Major parts from index.circuit.tsx (pcbX/pcbY = footprint center, mm). */
var PLACEMENTS = [
  { ref: "J3", label: "DSI FFC 15p (panel)", x: 58, y: 1.5, w: 20, h: 4 },
  { ref: "J1", label: "USB-C mid-mount", x: 23, y: 2, w: 12, h: 6 },
  { ref: "U1", label: "ESP32-P4-Module-32MB", x: 86, y: 88, w: 25, h: 25 },
  { ref: "J4", label: "microSD", x: 100, y: 88, w: 14, h: 12 },
  { ref: "U2", label: "BQ24075 charger", x: 70, y: 98, w: 6, h: 6 },
  { ref: "U4", label: "TPS62135 buck", x: 88, y: 98, w: 6, h: 6 },
  { ref: "U5", label: "DRV2605 haptic", x: 98, y: 89, w: 5, h: 5 },
];

function partBox(p) {
  var x = p.x - p.w / 2;
  var y = p.y - p.h / 2;
  return (
    '<rect x="' + x + '" y="' + y + '" width="' + p.w + '" height="' + p.h + '"' +
    ' fill="rgba(0,200,255,0.12)" stroke="#0cf" stroke-width="0.35"/>' +
    '<text x="' + p.x + '" y="' + (y - 0.8) + '" font-size="2" text-anchor="middle"' +
    ' font-family="sans-serif" fill="#0cf" font-weight="bold">' + p.ref + "</text>" +
    '<text x="' + p.x + '" y="' + (y + p.h + 2.2) + '" font-size="1.5" text-anchor="middle"' +
    ' font-family="sans-serif" fill="#8df">' + p.label + "</text>"
  );
}

function main() {
  var body = layout.body;
  var bodyX = -PCB_INSET_MM;
  var bodyY = -PCB_INSET_MM;
  var margin = 4;
  var vbX = bodyX - margin;
  var vbY = bodyY - margin;
  var vbW = body.w + margin * 2;
  var vbH = body.h + margin * 2;

  var holes = layout.mountingHoles.map(function (h) {
    var x = pcbLocal(h.x);
    var y = pcbLocal(h.y);
    return '<circle cx="' + x + '" cy="' + y + '" r="' + (h.d / 2) +
      '" fill="none" stroke="#6cf" stroke-width="0.25"/>';
  }).join("\n");

  var svg =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vbX + " " + vbY + " " + vbW + " " + vbH + '"' +
    ' width="' + vbW * 4 + '" height="' + vbH * 4 + '">\n' +
    '<rect x="' + vbX + '" y="' + vbY + '" width="' + vbW + '" height="' + vbH + '" fill="#1a1a1a"/>\n' +
    '<path d="' + roundedRectPath(bodyX, bodyY, body.w, body.h, body.r) + '"' +
    ' fill="none" stroke="#666" stroke-width="0.35"/>\n' +
    '<text x="' + (bodyX + body.w / 2) + '" y="' + (bodyY - 1.5) + '" font-size="2.2"' +
    ' text-anchor="middle" fill="#999" font-family="sans-serif">Case body ' + body.w + "×" + body.h + " mm</text>\n" +
    '<path d="' + roundedRectPath(0, 0, PCB_W_MM, PCB_H_MM, PCB_R_MM) + '"' +
    ' fill="none" stroke="#0f0" stroke-width="0.4"/>\n' +
    '<text x="' + (PCB_W_MM / 2) + '" y="3" font-size="2.2" text-anchor="middle"' +
    ' fill="#0f0" font-family="sans-serif">PCB ' + PCB_W_MM + "×" + PCB_H_MM + " mm (r=" + PCB_R_MM + ")</text>\n" +
    '<text x="' + (PCB_W_MM / 2) + '" y="' + (PCB_H_MM - 2) + '" font-size="1.6" text-anchor="middle"' +
    ' fill="#aaa" font-family="sans-serif">Cyan boxes = placed parts. Copper routes not autorouted yet.</text>\n' +
    layout.keepouts.map(keepoutRect).join("\n") + "\n" +
    holes + "\n" +
    PLACEMENTS.map(partBox).join("\n") + "\n" +
    layout.anchors.map(anchorDot).join("\n") + "\n" +
    "</svg>\n";

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, svg, "utf8");
  console.log("Wrote " + OUT);
}

main();

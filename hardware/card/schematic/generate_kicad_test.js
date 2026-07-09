"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");
var gen = require("./generate_kicad.js");

var CARD = path.join(__dirname, "..");
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("generateAll writes kicad project files", function () {
    var info = gen.generateAll();
    assert.strictEqual(info.sheets, 9);
    assert.ok(fs.existsSync(path.join(CARD, "card.kicad_pro")));
    assert.ok(fs.existsSync(path.join(CARD, "card.kicad_sch")));
    assert.ok(fs.existsSync(path.join(CARD, "card.kicad_pcb")));
    assert.ok(fs.existsSync(path.join(__dirname, "sheets", "power.kicad_sch")));
});

test("generateAll is deterministic", function () {
    gen.generateAll();
    var root1 = fs.readFileSync(path.join(CARD, "card.kicad_sch"), "utf8");
    var power1 = fs.readFileSync(path.join(__dirname, "sheets", "power.kicad_sch"), "utf8");
    gen.generateAll();
    var root2 = fs.readFileSync(path.join(CARD, "card.kicad_sch"), "utf8");
    var power2 = fs.readFileSync(path.join(__dirname, "sheets", "power.kicad_sch"), "utf8");
    assert.strictEqual(root2, root1);
    assert.strictEqual(power2, power1);
});

test("power sheet contains U2 and global +3V3 label", function () {
    var svg = fs.readFileSync(path.join(__dirname, "sheets", "power.kicad_sch"), "utf8");
    assert.ok(svg.indexOf("(kicad_sch") !== -1);
    assert.ok(svg.indexOf("BQ24075") !== -1);
    assert.ok(svg.indexOf("global_label \"+3V3\"") !== -1);
});

test("compute sheet contains ESP32 chip", function () {
    var svg = fs.readFileSync(path.join(__dirname, "sheets", "compute.kicad_sch"), "utf8");
    assert.ok(svg.indexOf("ESP32-P4NRW32X") !== -1);
    assert.ok(svg.indexOf("global_label \"USB_DP\"") !== -1);
});

test("pcb contains Edge.Cuts and anchor silk", function () {
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    assert.ok(pcb.indexOf("Edge.Cuts") !== -1);
    assert.ok(pcb.indexOf("CONN_DSI_FFC") !== -1);
});

test("pcb carries front back and mechanical keepout labels", function () {
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    assert.ok(pcb.indexOf("display_module") !== -1);
    assert.ok(pcb.indexOf("back_bat_1s_pouch") !== -1);
    assert.ok(pcb.indexOf("dpad_support") !== -1);
    assert.ok(pcb.indexOf("Eco1.User") !== -1);
    assert.ok(pcb.indexOf("Eco2.User") !== -1);
    assert.ok(pcb.indexOf("Dwgs.User") !== -1);
});

test("pcb layer table uses KiCad 10 layer ids", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    assert.ok(pcb.indexOf('(0 "F.Cu" signal)') !== -1);
    assert.ok(pcb.indexOf('(4 "In1.Cu" signal)') !== -1);
    assert.ok(pcb.indexOf('(6 "In2.Cu" signal)') !== -1);
    assert.ok(pcb.indexOf('(2 "B.Cu" signal)') !== -1);
    assert.ok(pcb.indexOf('(1 "F.Mask" user)') !== -1);
    assert.ok(pcb.indexOf('(3 "B.Mask" user)') !== -1);
    assert.strictEqual(pcb.indexOf('(1 "In1.Cu"'), -1);
    assert.strictEqual(pcb.indexOf('(3 "In2.Cu"'), -1);
});

test("pcb drawings use KiCad 10 fill flags", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    assert.ok(pcb.indexOf("(fill no)") !== -1);
    assert.strictEqual(pcb.indexOf("(fill none)"), -1);
});

test("pcb drawings use explicit stroke styles", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    assert.ok(pcb.indexOf("(type solid)") !== -1);
    assert.strictEqual(pcb.indexOf("(type default)"), -1);
    assert.strictEqual(pcb.indexOf("(justify center)"), -1);
});

test("pcb edge cuts are emitted as a closed contour", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    var edges = [];
    pcb.replace(/\(gr_line \(start ([\d.-]+) ([\d.-]+)\) \(end ([\d.-]+) ([\d.-]+)\)[^\n]+\(layer "Edge.Cuts"\)/g,
        function (_m, x1, y1, x2, y2) {
            edges.push([Number(x1), Number(y1), Number(x2), Number(y2)]);
        });
    assert.ok(edges.length > 4, "rounded corners should be approximated, not dropped");
    edges.forEach(function (edge, i) {
        var next = edges[(i + 1) % edges.length];
        assert.ok(Math.abs(edge[2] - next[0]) < 0.001, "edge x gap at segment " + i);
        assert.ok(Math.abs(edge[3] - next[1]) < 0.001, "edge y gap at segment " + i);
    });
});

test("pcb labels avoid exact board outline coordinates", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    var outlineYs = { "2": true, "108": true };
    pcb.replace(/\(gr_text "[^"]*" \(at [\d.-]+ ([\d.-]+) 0\)/g, function (_m, y) {
        assert.ok(!outlineYs[String(Number(y))], "label sits exactly on Edge.Cuts y=" + y);
    });
});

test("pcb label bounds stay inside the board outline", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    pcb.replace(/\(gr_text "([^"]*)" \(at ([\d.-]+) ([\d.-]+) 0\)[\s\S]*?\(font \(size ([\d.]+) ([\d.]+)\)/g,
        function (_m, text, x, y, sizeX, sizeY) {
            var halfW = text.length * Number(sizeX) * 0.33;
            var halfH = Number(sizeY) * 0.5;
            assert.ok(Number(x) - halfW > 2, text + " label extends past left Edge.Cuts");
            assert.ok(Number(x) + halfW < 118, text + " label extends past right Edge.Cuts");
            assert.ok(Number(y) - halfH > 2, text + " label extends past bottom Edge.Cuts");
            assert.ok(Number(y) + halfH < 108, text + " label extends past top Edge.Cuts");
        });
});

function footprintBlock(pcb, ref) {
    var marker = '(property "Reference" "' + ref + '"';
    var refText = pcb.indexOf(marker);
    if (refText === -1) {
        marker = '(fp_text reference "' + ref + '"';
        refText = pcb.indexOf(marker);
    }
    assert.ok(refText !== -1, "missing footprint reference " + ref);
    var start = pcb.lastIndexOf("\n  (footprint \"PSCard:", refText);
    assert.ok(start !== -1, "missing footprint " + ref);
    start += 1;
    var next = pcb.indexOf('\n  (footprint "PSCard:', start + 1);
    if (next === -1) {
        next = pcb.indexOf("\n)", start);
    }
    return pcb.slice(start, next);
}

function regexEscape(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function netId(pcb, name) {
    var match = pcb.match(new RegExp("\\(net (\\d+) \"" + regexEscape(name) + "\"\\)"));
    assert.ok(match, "missing net " + name);
    return match[1];
}

function segmentCountForNet(pcb, name) {
    var id = netId(pcb, name);
    var match = pcb.match(new RegExp("\\(segment [^\\n]+\\(net " + id + "\\)[^\\n]+\\)", "g"));
    return match ? match.length : 0;
}

test("pcb contains placed generated footprints for all components", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    var footprints = pcb.match(/\(footprint "PSCard:(Preview|Fit)_/g) || [];
    assert.strictEqual(footprints.length, 48);
    assert.ok(footprintBlock(pcb, "J3").indexOf('(property "Reference" "J3"') !== -1);
    assert.ok(footprintBlock(pcb, "U1").indexOf('(layer "B.Cu")') !== -1);
    assert.ok(footprintBlock(pcb, "SW1").indexOf('(layer "F.Cu")') !== -1);
    assert.ok(pcb.indexOf("layout placeholder") !== -1);
});

test("pcb promotes package locked parts to fit footprints", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    assert.strictEqual((pcb.match(/\(footprint "PSCard:Fit_/g) || []).length, 27);
    assert.strictEqual((pcb.match(/layout placeholder/g) || []).length, 21);
    assert.ok(footprintBlock(pcb, "R1").indexOf('(footprint "PSCard:Fit_R1"') !== -1);
    assert.ok(footprintBlock(pcb, "C1").indexOf('(footprint "PSCard:Fit_C1"') !== -1);
    assert.ok(footprintBlock(pcb, "D4").indexOf('(footprint "PSCard:Fit_D4"') !== -1);
    assert.ok(footprintBlock(pcb, "TP1").indexOf('(footprint "PSCard:Fit_TP1"') !== -1);
    assert.ok(footprintBlock(pcb, "J1").indexOf('(footprint "PSCard:Fit_J1"') !== -1);
    assert.ok(footprintBlock(pcb, "U2").indexOf('(footprint "PSCard:Fit_U2"') !== -1);
    assert.ok(footprintBlock(pcb, "SW10A").indexOf('(footprint "PSCard:Fit_SW10A"') !== -1);
    assert.ok(footprintBlock(pcb, "J3").indexOf('(footprint "PSCard:Preview_J3"') !== -1);
    assert.ok(footprintBlock(pcb, "J2").indexOf('(footprint "PSCard:Preview_J2"') !== -1);
    assert.ok(footprintBlock(pcb, "SW5").indexOf('(footprint "PSCard:Preview_SW5"') !== -1);
    assert.ok(footprintBlock(pcb, "J3").indexOf("GATE-DSI-FFC-CONTACT") !== -1);
});

test("pcb emits first-pass copper segments for all visible ratsnest families", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    var segments = pcb.match(/\(segment /g) || [];
    assert.ok(segments.length >= 180, "expected generated copper segments for every visible ratsnest family");
    assert.ok(segmentCountForNet(pcb, "SW_DPAD_UP") > 0);
    assert.ok(segmentCountForNet(pcb, "LED_R") > 0);
    assert.ok(segmentCountForNet(pcb, "PIEZO_PWM") > 0);
    assert.ok(segmentCountForNet(pcb, "DSI_D0_P") > 0);
    assert.ok(segmentCountForNet(pcb, "USB_DP") > 0);
    assert.ok(segmentCountForNet(pcb, "+3V3") > 0);
    assert.ok(segmentCountForNet(pcb, "SD_SPI_CLK") > 0);
});

test("pcb carries non-copper DSI route intent guides", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    assert.ok(pcb.indexOf("DSI route intent") !== -1);
    assert.ok(pcb.indexOf("DSI_D1 route intent") !== -1);
    assert.ok(pcb.match(/\(gr_line \(start [^)]+\) \(end [^)]+\) \(stroke \(width 0\.12\) \(type dash\)\) \(layer "Cmts\.User"\)/));
    assert.ok(segmentCountForNet(pcb, "DSI_D1_P") > 0);
});

test("pcb footprints use KiCad 10 property and pad metadata", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    var j1 = footprintBlock(pcb, "J1");
    assert.ok(j1.indexOf('(property "Reference" "J1"') !== -1);
    assert.ok(j1.indexOf('(property "Value" "HRO-TYPE-C-31-M-12"') !== -1);
    assert.ok(j1.indexOf("(duplicate_pad_numbers_are_jumpers no)") !== -1);
    assert.ok(j1.indexOf("(embedded_fonts no)") !== -1);
    assert.ok(j1.match(/\(pad "CC1" smd rect[\s\S]*\(uuid "[^"]+"\)/));
    assert.strictEqual(j1.indexOf("(fp_text reference "), -1);
    assert.strictEqual(j1.indexOf("(fp_text value "), -1);
});

test("fit passives and debug pads use package-shaped pads", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    var r1 = footprintBlock(pcb, "R1");
    assert.ok(r1.match(/\(pad "1" smd rect \(at -0\.45 0 0\) \(size 0\.45 0\.55\)/));
    assert.ok(r1.match(/\(pad "2" smd rect \(at 0\.45 0 0\) \(size 0\.45 0\.55\)/));
    var c1 = footprintBlock(pcb, "C1");
    assert.ok(c1.match(/\(pad "1" smd rect \(at -0\.75 0 0\) \(size 0\.75 0\.95\)/));
    assert.ok(c1.match(/\(pad "2" smd rect \(at 0\.75 0 0\) \(size 0\.75 0\.95\)/));
    var tp1 = footprintBlock(pcb, "TP1");
    assert.ok(tp1.match(/\(pad "1" smd circle \(at 0 0 0\) \(size 1\.5 1\.5\)/));
});

test("pcb preview footprints carry ratsnest pad nets", function () {
    gen.generateAll();
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    var j3 = footprintBlock(pcb, "J3");
    assert.ok(j3.match(/\(pad "14" smd rect[\s\S]*\(net \d+ "\+3V3_PANEL"\)/));
    assert.ok(j3.match(/\(pad "15" smd rect[\s\S]*\(net \d+ "\+3V3_PANEL"\)/));
    assert.ok(j3.match(/\(pad "9" smd rect[\s\S]*\(net \d+ "DSI_D0_P"\)/));
    assert.ok(j3.match(/\(pad "8" smd rect[\s\S]*\(net \d+ "DSI_D0_N"\)/));
});

test("root sheet uses valid KiCad fill syntax", function () {
    var root = fs.readFileSync(path.join(CARD, "card.kicad_sch"), "utf8");
    assert.ok(root.indexOf("(fill (type none))") !== -1);
    assert.strictEqual(root.indexOf("(fill (color"), -1);
});

test("root sheet Sheetfile paths resolve to generated sub-sheets", function () {
    var root = fs.readFileSync(path.join(CARD, "card.kicad_sch"), "utf8");
    var matches = root.match(/\(property "Sheetfile" "([^"]+)"/g) || [];
    assert.strictEqual(matches.length, 9);
    matches.forEach(function (m) {
        var rel = m.match(/\(property "Sheetfile" "([^"]+)"/)[1];
        assert.ok(fs.existsSync(path.join(CARD, rel)), "missing sub-sheet: " + rel);
    });
});

test("sub-sheets keep global_label properties inside the label", function () {
    var storage = fs.readFileSync(path.join(__dirname, "sheets", "storage.kicad_sch"), "utf8");
    assert.ok(storage.indexOf("(property \"Intersheetrefs\"") !== -1);
    assert.ok(!storage.match(/\(uuid "[^"]+"\)\)\s*\n\s*\(property "Intersheetrefs"/));
});

test("generated sheets expose open gate ids as symbol properties", function () {
    var power = fs.readFileSync(path.join(__dirname, "sheets", "power.kicad_sch"), "utf8");
    var compute = fs.readFileSync(path.join(__dirname, "sheets", "compute.kicad_sch"), "utf8");
    var display = fs.readFileSync(path.join(__dirname, "sheets", "display.kicad_sch"), "utf8");
    var controls = fs.readFileSync(path.join(__dirname, "sheets", "controls.kicad_sch"), "utf8");
    assert.ok(power.indexOf("(property \"Gate\" \"GATE-BATTERY-SAMPLE\"") !== -1);
    assert.ok(compute.indexOf("(property \"Gate\" \"GATE-ESP32-P4-REF-CAPTURE\"") !== -1);
    assert.ok(display.indexOf("(property \"Gate\" \"GATE-DSI-FFC-CONTACT\"") !== -1);
    assert.ok(controls.indexOf("(property \"Gate\" \"GATE-DPAD-MOCKUP\"") !== -1);
    assert.ok(controls.indexOf("(property \"Gate\" \"GATE-FACE-BUTTON-FEEL\"") !== -1);
});

test("generated PCB loads in KiCad CLI when kicad-cli is available", function () {
    gen.generateAll();
    var version = childProcess.spawnSync("kicad-cli", ["version"], { encoding: "utf8" });
    if (version.error && version.error.code === "ENOENT") {
        console.log("note - kicad-cli not found; skipping DRC smoke test");
        return;
    }
    assert.strictEqual(version.status, 0, (version.stderr || version.stdout || version.error || "").toString());
    var pcb = fs.readFileSync(path.join(CARD, "card.kicad_pcb"), "utf8");
    var pro = fs.readFileSync(path.join(CARD, "card.kicad_pro"), "utf8");
    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "puzzlescript-card-kicad-"));
    var tmpPcb = path.join(tmpDir, "card.kicad_pcb");
    var tmpSvg = path.join(tmpDir, "card-fcu.svg");
    fs.writeFileSync(tmpPcb, pcb, "utf8");
    fs.writeFileSync(path.join(tmpDir, "card.kicad_pro"), pro, "utf8");
    var exported = childProcess.spawnSync("kicad-cli", [
        "pcb", "export", "svg", "--layers", "F.Cu", "--page-size-mode", "2",
        "--output", tmpSvg, "--mode-single", tmpPcb
    ], { encoding: "utf8" });
    assert.strictEqual(exported.status, 0, (exported.stdout || "") + (exported.stderr || ""));
    assert.ok(fs.existsSync(tmpSvg), "expected KiCad SVG export");
});

console.log(passed + " tests passed");

"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var preview = require("./board_preview.js");
var exporter = require("./export_board_preview.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("buildPreview places anchored and clustered components", function () {
    var model = preview.buildPreview();
    var byRef = preview.componentsByRef(model.components);
    assert.strictEqual(model.status, "first-pass-route-preview");
    assert.deepStrictEqual(model.board, { x: 2, y: 2, w: 116, h: 106, r: 7 });
    assert.ok(byRef.J3 && byRef.J3.source === "anchor:CONN_DSI_FFC");
    assert.ok(byRef.J1 && byRef.J1.side === "back");
    assert.ok(byRef.U1 && byRef.U1.source === "keepout:back_esp32_p4_chip_down");
    assert.ok(byRef.U2 && byRef.U2.source === "keepout:back_pmic_cluster");
    assert.ok(byRef.SW1 && byRef.SW1.source === "anchor:SW_DPAD_UP");
    assert.ok(byRef.JP1 && byRef.JP1.source === "anchor:PAD_PIEZO");
});

test("buildPreview connects every visible ratsnest family with first-pass traces", function () {
    var model = preview.buildPreview();
    assert.ok(model.routedTraceCount >= 60, "expected first-pass routes for all visible airwire families");
    assert.strictEqual(model.traces.length, model.routedTraceCount);
    assert.strictEqual(model.airwires.length, 0);
    assert.ok(model.traces.some(function (t) { return t.net === "SW_DPAD_UP"; }));
    assert.ok(model.traces.some(function (t) { return t.net === "LED_R"; }));
    assert.ok(model.traces.some(function (t) { return t.net === "PIEZO_PWM"; }));
    assert.ok(model.traces.some(function (t) { return t.net === "DSI_D0_P"; }));
    assert.ok(model.traces.some(function (t) { return t.net === "USB_DP"; }));
    assert.ok(model.traces.some(function (t) { return t.net === "+3V3"; }));
    assert.ok(model.traces.some(function (t) { return t.net === "SD_SPI_CLK"; }));
});

test("buildPreview summarizes route status by routing family", function () {
    var model = preview.buildPreview();
    var byFamily = {};
    assert.ok(Array.isArray(model.routeStatus), "expected routeStatus array");
    model.routeStatus.forEach(function (item) {
        byFamily[item.family] = item;
    });
    assert.strictEqual(byFamily["Low-speed"].status, "routed-first-pass");
    assert.ok(byFamily["Low-speed"].routes > 0);
    assert.ok(byFamily["Low-speed"].nets.indexOf("SW_DPAD_UP") !== -1);
    assert.strictEqual(byFamily["DSI"].status, "routed-assumption-gated");
    assert.strictEqual(byFamily["DSI"].gate, "GATE-DSI-FFC-CONTACT");
    assert.strictEqual(byFamily["DSI"].routes, 6);
    assert.strictEqual(byFamily["DSI"].airwires, 0);
    assert.strictEqual(byFamily["USB"].status, "routed-first-pass-review");
    assert.strictEqual(byFamily["Power"].status, "routed-first-pass-review");
    assert.strictEqual(byFamily["Storage"].status, "routed-first-pass-gated");
    assert.strictEqual(byFamily["Storage"].gate, "GATE-MICROSD-FOOTPRINT");
});

test("buildPreview exposes DSI differential route intent alongside gated copper", function () {
    var model = preview.buildPreview();
    assert.ok(model.dsiRoutePlan);
    assert.strictEqual(model.dsiRoutePlan.status, "routed-assumption-gated");
    assert.strictEqual(model.dsiRoutePlan.gate, "GATE-DSI-FFC-CONTACT");
    assert.strictEqual(model.dsiRoutePlan.pairs.length, 3);
    assert.deepStrictEqual(model.dsiRoutePlan.pairs.map(function (pair) { return pair.name; }), [
        "DSI_D1",
        "DSI_CLK",
        "DSI_D0"
    ]);
    model.dsiRoutePlan.pairs.forEach(function (pair) {
        assert.strictEqual(pair.from, "U1");
        assert.strictEqual(pair.to, "J3");
        assert.strictEqual(pair.pPoints.length, pair.nPoints.length);
        assert.ok(pair.pPoints.length >= 2);
    });
    assert.ok(model.traces.some(function (t) { return t.net.indexOf("DSI_") === 0; }));
});

function traceSegments(model) {
    var segments = [];
    model.traces.forEach(function (trace) {
        for (var i = 0; i < trace.points.length - 1; i++) {
            segments.push({
                net: trace.net,
                from: trace.from,
                to: trace.to,
                x1: trace.points[i].x,
                y1: trace.points[i].y,
                x2: trace.points[i + 1].x,
                y2: trace.points[i + 1].y
            });
        }
    });
    return segments;
}

function overlap1d(a1, a2, b1, b2) {
    var lo = Math.max(Math.min(a1, a2), Math.min(b1, b2));
    var hi = Math.min(Math.max(a1, a2), Math.max(b1, b2));
    return hi - lo;
}

function collinearOverlapCount(model) {
    var segments = traceSegments(model);
    var overlaps = 0;
    segments.forEach(function (a, i) {
        segments.slice(i + 1).forEach(function (b) {
            if (a.net === b.net) {
                return;
            }
            if (a.y1 === a.y2 && b.y1 === b.y2 && a.y1 === b.y1 &&
                    overlap1d(a.x1, a.x2, b.x1, b.x2) > 0.01) {
                overlaps++;
            }
            if (a.x1 === a.x2 && b.x1 === b.x2 && a.x1 === b.x1 &&
                    overlap1d(a.y1, a.y2, b.y1, b.y2) > 0.01) {
                overlaps++;
            }
        });
    });
    return overlaps;
}

function pointKey(point) {
    return point.x + "," + point.y;
}

function largestSharedTraceEndpoint(model) {
    var starts = {};
    var ends = {};
    model.traces.forEach(function (trace) {
        starts[pointKey(trace.points[0])] = (starts[pointKey(trace.points[0])] || 0) + 1;
        ends[pointKey(trace.points[trace.points.length - 1])] =
            (ends[pointKey(trace.points[trace.points.length - 1])] || 0) + 1;
    });
    return Math.max.apply(null, Object.keys(starts).concat(Object.keys(ends)).map(function (key) {
        return Math.max(starts[key] || 0, ends[key] || 0);
    }));
}

test("buildPreview fans out first-pass traces instead of stacking them", function () {
    var model = preview.buildPreview();
    assert.strictEqual(collinearOverlapCount(model), 0);
    assert.ok(largestSharedTraceEndpoint(model) <= 3, "too many traces share one component-center endpoint");
});

test("buildPreview carries DSI gate evidence without closing the physical gate", function () {
    var model = preview.buildPreview();
    var evidence = model.gateEvidence.filter(function (g) {
        return g.gate === "GATE-DSI-FFC-CONTACT";
    })[0];
    assert.ok(evidence);
    assert.strictEqual(evidence.status, "open");
    assert.ok(evidence.confirmed.some(function (item) {
        return item.indexOf("pins 14 and 15 are 3V3") !== -1;
    }));
    assert.ok(evidence.missing.some(function (item) {
        return item.indexOf("contact side") !== -1;
    }));
});

test("buildPreview carries DSI physical closeout checklist", function () {
    var model = preview.buildPreview();
    assert.ok(model.dsiPanelInterface);
    assert.strictEqual(model.dsiPanelInterface.orientation.gate, "GATE-DSI-FFC-CONTACT");
    assert.strictEqual(model.dsiPanelInterface.orientation.assumedCableParity, "same-side");
    assert.ok(model.dsiPanelInterface.orientation.mustCheckBeforeRouting.some(function (item) {
        return item.indexOf("card-end photo") !== -1;
    }));
});

test("buildPreview separates unique open gates from gated parts", function () {
    var model = preview.buildPreview();
    assert.strictEqual(model.openGates.length, 10);
    assert.ok(model.openGates.some(function (g) {
        return g.gate === "GATE-DSI-FFC-CONTACT" && g.refs.indexOf("J3") !== -1;
    }));
    assert.ok(model.openGates.some(function (g) {
        return g.gate === "GATE-ESP32-P4-REF-CAPTURE" && g.refs.length === 3;
    }));
    assert.strictEqual(model.components.filter(function (c) { return c.gate; }).length, 21);
});

test("previewToSvg labels the artifact as a first-pass route preview", function () {
    var svg = preview.previewToSvg(preview.buildPreview());
    assert.ok(svg.indexOf("FIRST-PASS ROUTE PREVIEW") !== -1);
    assert.ok(svg.indexOf("generated first-pass copper traces") !== -1);
    assert.ok(svg.indexOf('class="trace signal trace-low-speed"') !== -1);
    assert.ok(svg.indexOf('data-family="low-speed"') !== -1);
    assert.ok(svg.indexOf('class="dsi-plan"') !== -1);
    assert.ok(svg.indexOf('data-layer="dsi-plan"') !== -1);
    assert.ok(svg.indexOf('data-layer="traces"') !== -1);
    assert.strictEqual(svg.indexOf("GATE-USB-C-BACK-FOOTPRINT"), -1);
    assert.ok(svg.indexOf("GATE-DSI-FFC-CONTACT") !== -1);
    assert.ok(svg.indexOf("DSI_D0_P") !== -1);
    assert.ok(svg.indexOf("SW1") !== -1);
});

test("previewToHtml builds a self-contained review dashboard", function () {
    var model = preview.buildPreview();
    var html = preview.previewToHtml(model);
    var routedMetric = html.match(/Routed traces<\/span><strong>(\d+)<\/strong>/);
    assert.ok(html.indexOf("PuzzleScript Card Board Preview") !== -1);
    assert.ok(html.indexOf("FIRST-PASS ROUTED") !== -1);
    assert.ok(html.indexOf("Routed traces") !== -1);
    assert.ok(routedMetric && Number(routedMetric[1]) > 0);
    assert.ok(html.indexOf("Route Status") !== -1);
    assert.ok(html.indexOf("DSI route intent") !== -1);
    assert.ok(html.indexOf("routed-first-pass") !== -1);
    assert.ok(html.indexOf("routed-first-pass-review") !== -1);
    assert.ok(html.indexOf("routed-assumption-gated") !== -1);
    assert.ok(html.indexOf("GATE-MICROSD-FOOTPRINT") !== -1);
    assert.ok(html.indexOf('data-layer="traces"') !== -1);
    assert.ok(html.indexOf('data-layer="trace-low-speed"') !== -1);
    assert.ok(html.indexOf('data-layer="trace-power"') !== -1);
    assert.ok(html.indexOf("hide-trace-low-speed") !== -1);
    assert.ok(html.indexOf('data-layer="front"') !== -1);
    assert.ok(html.indexOf('data-layer="dsi"') !== -1);
    assert.strictEqual(html.indexOf("GATE-USB-C-BACK-FOOTPRINT"), -1);
    assert.ok(html.indexOf("GATE-DSI-FFC-CONTACT") !== -1);
    assert.ok(html.indexOf("Open gates</span><strong>10</strong>") !== -1);
    assert.ok(html.indexOf("Gated parts</span><strong>21</strong>") !== -1);
    assert.ok(html.indexOf("Gate Summary") !== -1);
    assert.ok(html.indexOf("DSI Panel Interface") !== -1);
    assert.ok(html.indexOf("Working assumption") !== -1);
    assert.ok(html.indexOf("Same-side 15-pin FFC cable assumed") !== -1);
    assert.ok(html.indexOf("same-side or opposite-side 15-pin cable") !== -1);
    assert.ok(html.indexOf("card-end photo") !== -1);
    assert.ok(html.indexOf("DSI Gate Evidence") !== -1);
    assert.ok(html.indexOf("screen-side cable gold finger faces upward") !== -1);
    assert.ok(html.indexOf("Still missing") !== -1);
    assert.ok(html.indexOf("toggleLayer") !== -1);
});

test("export_board_preview writes html, svg, and json", function () {
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-board-preview-"));
    var oldArgv = process.argv;
    process.argv = ["node", "export_board_preview.js", "--out", tmp];
    try {
        exporter.main();
    } finally {
        process.argv = oldArgv;
    }
    assert.ok(fs.existsSync(path.join(tmp, "index.html")));
    assert.ok(fs.existsSync(path.join(tmp, "board_preview.svg")));
    assert.ok(fs.existsSync(path.join(tmp, "board_preview.json")));
    var html = fs.readFileSync(path.join(tmp, "index.html"), "utf8");
    assert.ok(html.indexOf("Board Preview") !== -1);
    var json = JSON.parse(fs.readFileSync(path.join(tmp, "board_preview.json"), "utf8"));
    assert.strictEqual(json.status, "first-pass-route-preview");
    assert.ok(json.routedTraceCount > 0);
    assert.ok(json.routeStatus.some(function (item) {
        return item.family === "DSI" && item.status === "routed-assumption-gated";
    }));
    assert.strictEqual(json.dsiRoutePlan.status, "routed-assumption-gated");
});

console.log(passed + " tests passed");

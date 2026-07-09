"use strict";

var fs = require("fs");
var path = require("path");

var REPO_ROOT = path.join(__dirname, "..", "..");
var DEFAULT_LAYOUT = path.join(REPO_ROOT, "hardware", "card", "mechanical", "layout.json");
var DEFAULT_CONNECTIVITY = path.join(REPO_ROOT, "hardware", "card", "schematic", "connectivity.json");

var FOOTPRINTS = {
    J1: { w: 14, h: 9, side: "back", shape: "rect" },
    J2: { w: 8, h: 4, side: "back", shape: "rect" },
    U1: { w: 10, h: 10, side: "back", shape: "rect" },
    U2: { w: 3, h: 3, side: "back", shape: "rect" },
    U3: { w: 2, h: 2, side: "back", shape: "rect" },
    U4: { w: 3, h: 2.5, side: "back", shape: "rect" },
    U5: { w: 3, h: 4.9, side: "back", shape: "rect" },
    U6: { w: 2, h: 2.1, side: "back", shape: "rect" },
    U8: { w: 5, h: 5, side: "back", shape: "rect" },
    U9: { w: 6, h: 5, side: "back", shape: "rect" },
    X1: { w: 3.2, h: 2.5, side: "back", shape: "rect" },
    L1: { w: 3, h: 3, side: "back", shape: "rect" },
    J3: { w: 22, h: 5, side: "front", shape: "rect" },
    J4: { w: 15, h: 14, side: "back", shape: "rect" },
    B1: { w: 10, h: 10, side: "back", shape: "circle" },
    Q1: { w: 3, h: 3, side: "back", shape: "rect" },
    JP1: { w: 12, h: 3, side: "back", shape: "rect" },
    SW9: { w: 8, h: 3.2, side: "front", shape: "rect" },
    SW10A: { w: 3.9, h: 2.9, side: "front", shape: "rect" },
    SW10B: { w: 3.9, h: 2.9, side: "front", shape: "rect" },
    D1: { w: 3.2, h: 2, side: "front", shape: "rect" },
    D2: { w: 3.2, h: 2, side: "front", shape: "rect" },
    D3: { w: 3.2, h: 2, side: "front", shape: "rect" },
    D4: { w: 1.6, h: 0.8, side: "back", shape: "rect" }
};

function loadJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function indexById(items) {
    var out = {};
    items.forEach(function (item) { out[item.id] = item; });
    return out;
}

function componentsByRef(items) {
    var out = {};
    items.forEach(function (item) { out[item.ref] = item; });
    return out;
}

function rectCenter(rect) {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function componentSize(ref, comp) {
    if (FOOTPRINTS[ref]) {
        return FOOTPRINTS[ref];
    }
    if (ref.indexOf("SW") === 0) {
        return { w: ref === "SW8" ? 11 : 4.6, h: ref === "SW8" ? 4 : 2.8, side: "front", shape: "rect" };
    }
    if (ref.charAt(0) === "R") {
        return { w: 1.0, h: 0.5, side: "back", shape: "rect" };
    }
    if (ref.charAt(0) === "C") {
        return { w: 1.6, h: 0.8, side: "back", shape: "rect" };
    }
    if (ref.indexOf("TP") === 0) {
        return { w: 1.5, h: 1.5, side: "back", shape: "circle" };
    }
    return { w: 3, h: 2, side: comp.sheet === "controls" ? "front" : "back", shape: "rect" };
}

function place(ref, comp, x, y, source, sideOverride) {
    var size = componentSize(ref, comp);
    var w = size.w;
    var h = size.h;
    return {
        ref: ref,
        value: comp.value,
        sheet: comp.sheet,
        footprint: comp.footprint,
        gate: comp.gate || null,
        side: sideOverride || size.side,
        shape: size.shape,
        x: Number((x - w / 2).toFixed(3)),
        y: Number((y - h / 2).toFixed(3)),
        w: w,
        h: h,
        cx: Number(x.toFixed(3)),
        cy: Number(y.toFixed(3)),
        source: source
    };
}

function buildPlacementMap(layout, connectivity) {
    var anchors = indexById(layout.anchors);
    var keepouts = indexById(layout.keepouts);
    var pmic = rectCenter(keepouts.back_pmic_cluster);
    var compute = rectCenter(keepouts.back_esp32_p4_chip_down);
    var battery = keepouts.back_bat_1s_pouch;
    var components = [];
    var byRef = {};

    function add(ref, x, y, source, sideOverride) {
        var comp = connectivity.components.filter(function (c) { return c.ref === ref; })[0];
        if (!comp) {
            return;
        }
        byRef[ref] = place(ref, comp, x, y, source, sideOverride);
        components.push(byRef[ref]);
    }

    add("J1", anchors.CONN_USB_C_BACK.x, anchors.CONN_USB_C_BACK.y + 4.5, "anchor:CONN_USB_C_BACK", "back");
    add("J2", battery.x + battery.w - 6, battery.y + 3, "keepout:back_bat_1s_pouch", "back");
    add("U1", compute.x, compute.y, "keepout:back_esp32_p4_chip_down", "back");
    add("U9", compute.x + 8, compute.y - 4.5, "keepout:back_esp32_p4_chip_down", "back");
    add("X1", compute.x - 7, compute.y - 5.5, "keepout:back_esp32_p4_chip_down", "back");
    add("L1", compute.x + 7, compute.y + 5.5, "keepout:back_esp32_p4_chip_down", "back");

    add("U2", pmic.x - 6, pmic.y - 2, "keepout:back_pmic_cluster", "back");
    add("U3", pmic.x - 1.5, pmic.y - 2.5, "keepout:back_pmic_cluster", "back");
    add("U4", pmic.x + 4.5, pmic.y - 2, "keepout:back_pmic_cluster", "back");
    add("U6", pmic.x + 8, pmic.y + 3, "keepout:back_pmic_cluster", "back");
    add("D4", pmic.x - 8, pmic.y + 3.5, "keepout:back_pmic_cluster", "back");
    add("R8", pmic.x - 5.5, pmic.y + 3.5, "keepout:back_pmic_cluster", "back");
    add("C1", pmic.x + 2, pmic.y + 3.5, "keepout:back_pmic_cluster", "back");
    add("C2", pmic.x + 5, pmic.y + 3.5, "keepout:back_pmic_cluster", "back");

    add("J3", anchors.CONN_DSI_FFC.x, anchors.CONN_DSI_FFC.y + 2.5, "anchor:CONN_DSI_FFC", "front");
    add("J4", compute.x + 26, compute.y - 5, "cluster:storage", "back");

    add("SW1", anchors.SW_DPAD_UP.x, anchors.SW_DPAD_UP.y, "anchor:SW_DPAD_UP", "front");
    add("SW2", anchors.SW_DPAD_DOWN.x, anchors.SW_DPAD_DOWN.y, "anchor:SW_DPAD_DOWN", "front");
    add("SW3", anchors.SW_DPAD_LEFT.x, anchors.SW_DPAD_LEFT.y, "anchor:SW_DPAD_LEFT", "front");
    add("SW4", anchors.SW_DPAD_RIGHT.x, anchors.SW_DPAD_RIGHT.y, "anchor:SW_DPAD_RIGHT", "front");
    add("SW5", anchors.SW_ACTION.x, anchors.SW_ACTION.y, "anchor:SW_ACTION", "front");
    add("SW6", anchors.SW_UNDO.x, anchors.SW_UNDO.y, "anchor:SW_UNDO", "front");
    add("SW7", anchors.SW_RESTART.x, anchors.SW_RESTART.y, "anchor:SW_RESTART", "front");
    add("SW8", anchors.SW_MENU.x, anchors.SW_MENU.y, "anchor:SW_MENU", "front");
    add("SW9", anchors.SW_PWR_SLIDE.x, anchors.SW_PWR_SLIDE.y + 1.6, "anchor:SW_PWR_SLIDE", "front");
    add("SW10A", anchors.SW_VOLUME.x - 2.5, anchors.SW_VOLUME.y - 2.2, "anchor:SW_VOLUME", "front");
    add("SW10B", anchors.SW_VOLUME.x - 2.5, anchors.SW_VOLUME.y + 2.2, "anchor:SW_VOLUME", "front");

    add("B1", anchors.ACT_LRA.x, anchors.ACT_LRA.y, "anchor:ACT_LRA", "back");
    add("JP1", anchors.PAD_PIEZO.x, anchors.PAD_PIEZO.y, "anchor:PAD_PIEZO", "back");
    add("Q1", anchors.PAD_PIEZO.x - 10, anchors.PAD_PIEZO.y - 6, "cluster:piezo", "back");
    add("U8", anchors.PAD_PIEZO.x + 10, anchors.PAD_PIEZO.y - 6, "cluster:piezo", "back");
    add("R7", anchors.PAD_PIEZO.x + 3, anchors.PAD_PIEZO.y - 5, "cluster:piezo", "back");

    add("U5", anchors.ACT_LRA.x - 12, anchors.ACT_LRA.y - 3, "cluster:haptic", "back");
    add("D1", 4, 42, "edge:case-led", "front");
    add("D2", 4, 48, "edge:case-led", "front");
    add("D3", 4, 54, "edge:case-led", "front");

    add("R1", 35, 7, "cluster:usb", "back");
    add("R2", 35, 10, "cluster:usb", "back");
    add("R3", compute.x - 9, compute.y + 8, "cluster:i2c", "back");
    add("R4", compute.x - 7, compute.y + 8, "cluster:i2c", "back");
    add("R5", compute.x - 9, compute.y + 5, "cluster:en-boot", "back");
    add("R6", compute.x - 7, compute.y + 5, "cluster:en-boot", "back");
    add("R10", anchors.SW_DPAD_UP.x + 10, anchors.SW_DPAD_UP.y - 4, "cluster:controls", "front");
    add("C3", anchors.CONN_DSI_FFC.x + 14, anchors.CONN_DSI_FFC.y + 5, "cluster:panel-bulk", "front");

    add("TP1", 102, 66, "cluster:debug", "back");
    add("TP2", 106, 66, "cluster:debug", "back");
    add("TP3", 110, 66, "cluster:debug", "back");
    add("TP4", 114, 66, "cluster:debug", "back");

    return { components: components, byRef: byRef };
}

function isPreviewNet(net) {
    return net.indexOf("DSI_") === 0 ||
        net.indexOf("USB_") === 0 ||
        net === "+3V3" ||
        net === "+3V3_PANEL" ||
        net === "VBUS_IN" ||
        net === "BAT+" ||
        net === "SYS" ||
        net === "PWR_EN" ||
        net === "ESP_EN" ||
        net === "PANEL_EN" ||
        net === "I2C_SDA" ||
        net === "I2C_SCL" ||
        net.indexOf("SW_") === 0 ||
        net.indexOf("VOL_") === 0 ||
        net.indexOf("PIEZO_") === 0 ||
        net.indexOf("LED_") === 0 ||
        net.indexOf("SD_SPI_") === 0;
}

function isFirstPassRouteNet(net) {
    return net === "I2C_SDA" ||
        net === "I2C_SCL" ||
        net === "ESP_EN" ||
        net === "PWR_EN" ||
        net === "CHG_LED" ||
        net === "CHG_STAT" ||
        net === "PANEL_EN" ||
        net === "BOOT" ||
        net === "BOOT_EN" ||
        net === "GAUGE_ALERT" ||
        net === "UART_TX" ||
        net === "UART_RX" ||
        net.indexOf("SW_") === 0 ||
        net.indexOf("VOL_") === 0 ||
        net.indexOf("PIEZO_") === 0 ||
        net.indexOf("LED_") === 0;
}

function isGeneratedRouteNet(net) {
    return isFirstPassRouteNet(net) || isPreviewNet(net);
}

function netClass(net) {
    if (net.indexOf("DSI_") === 0) {
        return "dsi";
    }
    if (net.indexOf("USB_") === 0) {
        return "usb";
    }
    if (net === "+3V3" || net === "+3V3_PANEL" || net === "VBUS_IN" || net === "BAT+" || net === "SYS") {
        return "power";
    }
    return "signal";
}

function traceFamily(net) {
    if (net.indexOf("DSI_") === 0) {
        return "dsi";
    }
    if (net.indexOf("USB_") === 0) {
        return "usb";
    }
    if (net.indexOf("SD_SPI_") === 0) {
        return "storage";
    }
    if (netClass(net) === "power") {
        return "power";
    }
    return "low-speed";
}

function traceSide(root, dest) {
    return root.side === "back" && dest.side === "back" ? "back" : "front";
}

function roundPoint(x, y) {
    return {
        x: Number(x.toFixed(3)),
        y: Number(y.toFixed(3))
    };
}

function compactPoints(points) {
    var out = [];
    points.forEach(function (point) {
        var last = out[out.length - 1];
        if (!last || last.x !== point.x || last.y !== point.y) {
            out.push(point);
        }
    });
    return out;
}

function stableHash(s) {
    var h = 2166136261;
    String(s).split("").forEach(function (ch) {
        h ^= ch.charCodeAt(0);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    });
    return h >>> 0;
}

function spread01(key) {
    return (stableHash(key) % 1000) / 999;
}

function pseudoPadPoint(component, pin, net, dest, legKey) {
    var dx = dest.cx - component.cx;
    var dy = dest.cy - component.cy;
    var horizontal = Math.abs(dx) >= Math.abs(dy);
    var spread = spread01(component.ref + ":" + pin + ":" + net + ":" + legKey) - 0.5;
    var insetX = Math.max(0.15, component.w * 0.08);
    var insetY = Math.max(0.15, component.h * 0.08);
    if (horizontal) {
        return roundPoint(
            component.cx + (dx >= 0 ? component.w / 2 + insetX : -component.w / 2 - insetX),
            component.cy + spread * component.h * 0.86
        );
    }
    return roundPoint(
        component.cx + spread * component.w * 0.86,
        component.cy + (dy >= 0 ? component.h / 2 + insetY : -component.h / 2 - insetY)
    );
}

function laneOffset(index, start, horizontal) {
    var magnitude = 1 + (index % 30) * 0.38 + Math.floor(index / 30) * 0.08;
    if (horizontal) {
        if (start.y < 25) {
            return magnitude;
        }
        if (start.y > 85) {
            return -magnitude;
        }
    } else {
        if (start.x < 25) {
            return magnitude;
        }
        if (start.x > 95) {
            return -magnitude;
        }
    }
    return (index % 2 === 0 ? -1 : 1) * magnitude;
}

function routePoints(start, end, index) {
    var dx = Math.abs(end.x - start.x);
    var dy = Math.abs(end.y - start.y);
    var xDir = end.x >= start.x ? 1 : -1;
    var yDir = end.y >= start.y ? 1 : -1;
    var exit = 1.4 + (index % 4) * 0.22;
    if (dx >= dy) {
        var laneY = laneOffset(index, start, true);
        return compactPoints([
            roundPoint(start.x, start.y),
            roundPoint(start.x + xDir * exit, start.y + laneY),
            roundPoint(end.x - xDir * exit, start.y + laneY),
            roundPoint(end.x, end.y)
        ]);
    }
    var laneX = laneOffset(index, start, false);
    return compactPoints([
        roundPoint(start.x, start.y),
        roundPoint(start.x + laneX, start.y + yDir * exit),
        roundPoint(start.x + laneX, end.y - yDir * exit),
        roundPoint(end.x, end.y)
    ]);
}

function buildTraces(connectivity, byRef) {
    var traces = [];
    connectivity.connections.forEach(function (conn) {
        if (!isGeneratedRouteNet(conn.net)) {
            return;
        }
        var nodes = [];
        conn.nodes.forEach(function (node) {
            var ref = node[0];
            if (!byRef[ref]) {
                return;
            }
            if (!nodes.some(function (existing) { return existing.ref === ref && existing.pin === node[1]; })) {
                nodes.push({ ref: ref, pin: node[1], component: byRef[ref] });
            }
        });
        if (nodes.length < 2) {
            return;
        }
        var root = nodes[0];
        nodes.slice(1).forEach(function (destNode) {
            var dest = destNode.component;
            var legKey = root.ref + ":" + root.pin + "->" + destNode.ref + ":" + destNode.pin + ":" + traces.length;
            var start = pseudoPadPoint(root.component, root.pin, conn.net, dest, legKey);
            var end = pseudoPadPoint(dest, destNode.pin, conn.net, root.component, legKey);
            var points = routePoints(
                start,
                end,
                traces.length
            );
            traces.push({
                net: conn.net,
                className: netClass(conn.net),
                family: traceFamily(conn.net),
                side: traceSide(root.component, dest),
                from: root.ref,
                to: dest.ref,
                points: points
            });
        });
    });
    return traces;
}

function uniqueSorted(items) {
    var seen = {};
    items.forEach(function (item) {
        seen[item] = true;
    });
    return Object.keys(seen).sort();
}

function airwiresForFamily(airwires, family) {
    return airwires.filter(function (wire) {
        if (family === "DSI") {
            return wire.net.indexOf("DSI_") === 0;
        }
        if (family === "USB") {
            return wire.net.indexOf("USB_") === 0;
        }
        if (family === "Power") {
            return wire.className === "power";
        }
        if (family === "Storage") {
            return wire.net.indexOf("SD_SPI_") === 0;
        }
        return false;
    });
}

function tracesForFamily(traces, family) {
    return traces.filter(function (trace) {
        if (family === "DSI") {
            return trace.net.indexOf("DSI_") === 0;
        }
        if (family === "USB") {
            return trace.net.indexOf("USB_") === 0;
        }
        if (family === "Power") {
            return trace.className === "power";
        }
        if (family === "Storage") {
            return trace.net.indexOf("SD_SPI_") === 0;
        }
        return trace.className === "signal" && trace.net.indexOf("SD_SPI_") !== 0;
    });
}

function buildRouteStatus(traces, airwires) {
    function row(family, status, routed, wires, gate, note) {
        return {
            family: family,
            status: status,
            routes: routed.length,
            airwires: wires.length,
            nets: uniqueSorted(routed.map(function (trace) { return trace.net; }).concat(wires.map(function (wire) { return wire.net; }))),
            gate: gate || null,
            note: note
        };
    }
    var lowSpeed = tracesForFamily(traces, "Low-speed");
    return [
        row("Low-speed", "routed-first-pass", lowSpeed, airwiresForFamily(airwires, "Low-speed"), null,
            "Generated copper routes for controls, LEDs, piezo, I2C, enable/status, and debug nets."),
        row("DSI", "routed-assumption-gated", tracesForFamily(traces, "DSI"), airwiresForFamily(airwires, "DSI"), "GATE-DSI-FFC-CONTACT",
            "First-pass DSI copper follows the same-side FFC assumption; physical contact side, latch side, cable exit, and pin 1 still need the real panel/cable check before fabrication."),
        row("USB", "routed-first-pass-review", tracesForFamily(traces, "USB"), airwiresForFamily(airwires, "USB"), null,
            "USB 2.0 and CC lines now have first-pass copper; they still need connector-adjacent cleanup and impedance review."),
        row("Power", "routed-first-pass-review", tracesForFamily(traces, "Power"), airwiresForFamily(airwires, "Power"), null,
            "Power nets now have first-pass copper; replace/refine with planes, pours, thermal/current review, and compact charger/buck-boost loops before fabrication."),
        row("Storage", "routed-first-pass-gated", tracesForFamily(traces, "Storage"), airwiresForFamily(airwires, "Storage"), "GATE-MICROSD-FOOTPRINT",
            "microSD has first-pass copper; final routing still waits on the exact socket footprint and service-socket placement.")
    ];
}

function dsiPairName(pair) {
    var first = pair[0] || "";
    if (first.indexOf("DSI_CLK_") === 0) {
        return "DSI_CLK";
    }
    return first.replace(/_[PN]$/, "");
}

function verticalGuidePoints(x, y1, y2) {
    return [
        roundPoint(x, y1),
        roundPoint(x, (y1 + y2) / 2),
        roundPoint(x, y2)
    ];
}

function buildDsiRoutePlan(connectivity, byRef) {
    var u1 = byRef.U1;
    var j3 = byRef.J3;
    if (!u1 || !j3) {
        return null;
    }
    var pairsByName = {};
    ((connectivity.requirements && connectivity.requirements.differential_nets) || []).forEach(function (pair) {
        if (pair[0].indexOf("DSI_") !== 0 || pair[1].indexOf("DSI_") !== 0) {
            return;
        }
        pairsByName[dsiPairName(pair)] = {
            p: pair[0],
            n: pair[1]
        };
    });
    var order = ["DSI_D1", "DSI_CLK", "DSI_D0"];
    var startY = u1.y;
    var endY = j3.y + j3.h;
    var laneSpacing = 2.6;
    var pairGap = 0.46;
    var pairs = order.map(function (name, i) {
        var nets = pairsByName[name];
        var laneX = j3.cx + (i - 1) * laneSpacing;
        return {
            name: name,
            p: nets ? nets.p : name + "_P",
            n: nets ? nets.n : name + "_N",
            from: "U1",
            to: "J3",
            targetDifferentialImpedance: "100 ohm",
            pPoints: verticalGuidePoints(laneX + pairGap / 2, startY, endY),
            nPoints: verticalGuidePoints(laneX - pairGap / 2, startY, endY)
        };
    });
    return {
        status: "routed-assumption-gated",
        gate: "GATE-DSI-FFC-CONTACT",
        targetDifferentialImpedance: "100 ohm",
        note: "First-pass copper follows this route intent. Confirm card-end contact side, latch side, cable exit, and pin 1 on the selected J3 footprint before fabrication.",
        pairs: pairs
    };
}

function buildAirwires(connectivity, byRef) {
    var wires = [];
    connectivity.connections.forEach(function (conn) {
        if (!isPreviewNet(conn.net)) {
            return;
        }
        if (isGeneratedRouteNet(conn.net)) {
            return;
        }
        var refs = [];
        conn.nodes.forEach(function (node) {
            var ref = node[0];
            if (byRef[ref] && refs.indexOf(ref) === -1) {
                refs.push(ref);
            }
        });
        if (refs.length < 2) {
            return;
        }
        var root = byRef[refs[0]];
        refs.slice(1).forEach(function (ref) {
            var dest = byRef[ref];
            wires.push({
                net: conn.net,
                className: netClass(conn.net),
                from: root.ref,
                to: dest.ref,
                x1: root.cx,
                y1: root.cy,
                x2: dest.cx,
                y2: dest.cy
            });
        });
    });
    return wires;
}

function buildPreview(options) {
    options = options || {};
    var layout = loadJson(options.layoutPath || DEFAULT_LAYOUT);
    var connectivity = loadJson(options.connectivityPath || DEFAULT_CONNECTIVITY);
    var placement = buildPlacementMap(layout, connectivity);
    var traces = buildTraces(connectivity, placement.byRef);
    var airwires = buildAirwires(connectivity, placement.byRef);
    var routeStatus = buildRouteStatus(traces, airwires);
    var dsiRoutePlan = buildDsiRoutePlan(connectivity, placement.byRef);
    var gates = openGates(placement.components);
    return {
        status: "first-pass-route-preview",
        note: "Generated first-pass copper traces for all currently visible ratsnest nets; review high-speed, power, and gated footprints before fabrication.",
        board: layout.pcb,
        edgeCutsPath: layout.edgeCutsPath,
        keepouts: layout.keepouts,
        mountingHoles: layout.mountingHoles,
        components: placement.components,
        traces: traces,
        airwires: airwires,
        routeStatus: routeStatus,
        dsiRoutePlan: dsiRoutePlan,
        openGates: gates,
        gateEvidence: connectivity.gateEvidence || [],
        dsiPanelInterface: connectivity.dsiPanelInterface || null,
        routedTraceCount: traces.length,
        source: {
            layout: path.relative(REPO_ROOT, options.layoutPath || DEFAULT_LAYOUT),
            connectivity: path.relative(REPO_ROOT, options.connectivityPath || DEFAULT_CONNECTIVITY)
        }
    };
}

function xml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function wireStyle(cls) {
    if (cls === "dsi") {
        return { stroke: "#d95f02", width: 0.28, dash: "1.2,0.7" };
    }
    if (cls === "usb") {
        return { stroke: "#1f78b4", width: 0.26, dash: "1.2,0.7" };
    }
    if (cls === "power") {
        return { stroke: "#cc2222", width: 0.34, dash: "1.8,0.9" };
    }
    return { stroke: "#777", width: 0.18, dash: "0.9,0.8" };
}

function traceStyle(side) {
    if (side === "back") {
        return { stroke: "#2457a6", width: 0.22 };
    }
    return { stroke: "#138a63", width: 0.24 };
}

function previewToSvg(model) {
    var pad = 6;
    var width = 120 + pad * 2;
    var height = 110 + pad * 2 + 16;
    var out = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + (width * 5) + 'px" viewBox="0 0 ' + width + " " + height + '">',
        '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#f7f5ef"/>',
        '<text x="' + pad + '" y="5" font-size="3.2" font-family="Arial, sans-serif" font-weight="700" fill="#222">PuzzleScript Card - FIRST-PASS ROUTE PREVIEW</text>',
        '<text x="' + pad + '" y="9" font-size="2.1" font-family="Arial, sans-serif" fill="#555">generated first-pass copper traces - routed copper tracks: ' + model.routedTraceCount + "</text>",
        '<g transform="translate(' + pad + "," + (pad + 6) + ')">'
    ];

    out.push('<path d="' + xml(model.edgeCutsPath) + '" fill="#fbfbf6" stroke="#111" stroke-width="0.35"/>');

    model.keepouts.forEach(function (k) {
        var color = k.layer === "back" ? "#7bb4d8" : (k.layer === "front" ? "#e6aa57" : "#9a9a9a");
        out.push('<rect class="keepout keepout-' + xml(k.layer) + '" data-layer="keepouts" x="' + k.x + '" y="' + k.y + '" width="' + k.w + '" height="' + k.h +
            '" fill="none" stroke="' + color + '" stroke-width="0.18" stroke-dasharray="1.3,0.9"/>');
    });

    model.traces.forEach(function (t) {
        var st = traceStyle(t.side);
        var points = t.points.map(function (p) { return p.x + "," + p.y; }).join(" ");
        out.push('<polyline class="trace ' + xml(t.className) + ' trace-' + xml(t.family) +
            '" data-layer="traces" data-family="' + xml(t.family) + '" data-side="' + xml(t.side) + '" data-net="' + xml(t.net) +
            '" points="' + points + '" fill="none" stroke="' + st.stroke + '" stroke-width="' + st.width +
            '" stroke-linecap="round" stroke-linejoin="round" opacity="0.86"><title>' + xml(t.net + " " + t.from + " to " + t.to) + "</title></polyline>");
    });

    if (model.dsiRoutePlan && model.dsiRoutePlan.pairs) {
        model.dsiRoutePlan.pairs.forEach(function (pair) {
            var pPoints = pair.pPoints.map(function (p) { return p.x + "," + p.y; }).join(" ");
            var nPoints = pair.nPoints.map(function (p) { return p.x + "," + p.y; }).join(" ");
            var label = pair.name + " route intent";
            var labelPoint = pair.pPoints[Math.floor(pair.pPoints.length / 2)];
            out.push('<polyline class="dsi-plan" data-layer="dsi-plan" data-net="' + xml(pair.p) +
                '" points="' + pPoints + '" fill="none" stroke="#d95f02" stroke-width="0.18" stroke-dasharray="0.8,0.45" opacity="0.75"><title>' +
                xml(pair.p + " " + label) + "</title></polyline>");
            out.push('<polyline class="dsi-plan" data-layer="dsi-plan" data-net="' + xml(pair.n) +
                '" points="' + nPoints + '" fill="none" stroke="#d95f02" stroke-width="0.18" stroke-dasharray="0.8,0.45" opacity="0.75"><title>' +
                xml(pair.n + " " + label) + "</title></polyline>");
            out.push('<text class="dsi-plan-label" data-layer="dsi-plan" x="' + labelPoint.x + '" y="' + labelPoint.y +
                '" font-size="1.25" text-anchor="middle" font-family="Arial, sans-serif" fill="#a34400">' + xml(pair.name) + "</text>");
        });
    }

    model.airwires.forEach(function (w, i) {
        var st = wireStyle(w.className);
        out.push('<line class="airwire ' + xml(w.className) + '" data-layer="' + xml(w.className) + '" x1="' + w.x1 + '" y1="' + w.y1 + '" x2="' + w.x2 + '" y2="' + w.y2 +
            '" stroke="' + st.stroke + '" stroke-width="' + st.width +
            '" stroke-dasharray="' + st.dash + '" opacity="0.58"/>');
        if (w.className === "dsi" || w.className === "usb" || w.className === "power") {
            out.push('<text class="airwire-label ' + xml(w.className) + '" data-layer="' + xml(w.className) + '" x="' + ((w.x1 + w.x2) / 2).toFixed(1) + '" y="' + ((w.y1 + w.y2) / 2).toFixed(1) +
                '" font-size="1.4" text-anchor="middle" font-family="Arial, sans-serif" fill="' + st.stroke + '">' +
                xml(w.net) + "</text>");
        }
    });

    model.components.forEach(function (c) {
        var fill = c.side === "front" ? "#ffe0a8" : "#b8d8ee";
        var stroke = c.gate ? "#c83a2d" : "#24485f";
        var dash = c.gate ? ' stroke-dasharray="1.2,0.6"' : "";
        out.push('<g class="component ' + xml(c.side) + (c.gate ? " gated" : "") + '" data-layer="' + xml(c.side) + '">');
        if (c.shape === "circle") {
            out.push('<ellipse cx="' + c.cx + '" cy="' + c.cy + '" rx="' + (c.w / 2) + '" ry="' + (c.h / 2) +
                '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="0.35"' + dash + "/>");
        } else {
            out.push('<rect x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h +
                '" rx="0.5" fill="' + fill + '" stroke="' + stroke + '" stroke-width="0.35"' + dash + "/>");
        }
        out.push('<text x="' + c.cx + '" y="' + (c.cy + 0.55) +
            '" font-size="1.8" text-anchor="middle" font-family="Arial, sans-serif" fill="#111">' +
            xml(c.ref) + "</text>");
        if (c.gate) {
            out.push('<title>' + xml(c.ref + " " + c.value + " " + c.gate) + "</title>");
        }
        out.push("</g>");
    });

    model.mountingHoles.forEach(function (h) {
        out.push('<circle class="mounting-hole" cx="' + h.x + '" cy="' + h.y + '" r="' + (h.d / 2) +
            '" fill="#f7f5ef" stroke="#333" stroke-width="0.25"/>');
    });

    out.push("</g>");
    out.push('<g transform="translate(' + pad + "," + (height - 12) + ')" font-family="Arial, sans-serif" font-size="2.1" fill="#333">');
    out.push('<rect x="0" y="-3" width="4" height="2.4" fill="#ffe0a8" stroke="#24485f"/><text x="5" y="-1">front packages</text>');
    out.push('<rect x="33" y="-3" width="4" height="2.4" fill="#b8d8ee" stroke="#24485f"/><text x="38" y="-1">back packages</text>');
    out.push('<line x1="66" y1="-2" x2="74" y2="-2" stroke="#138a63" stroke-width="0.24"/><text x="76" y="-1">trace</text>');
    out.push('<line x1="92" y1="-2" x2="100" y2="-2" stroke="#d95f02" stroke-width="0.28" stroke-dasharray="1.2,0.7"/><text x="102" y="-1">DSI airwire</text>');
    out.push('<text x="0" y="4">Gate-marked packages use dashed red outlines. Open SVG title tooltips show gate IDs for unresolved parts.</text>');
    out.push("</g>");
    out.push("</svg>");
    return out.join("\n") + "\n";
}

function previewToJson(model) {
    return JSON.stringify(model, null, 2) + "\n";
}

function countComponents(model, side) {
    return model.components.filter(function (c) { return c.side === side; }).length;
}

function countAirwires(model, className) {
    return model.airwires.filter(function (w) { return w.className === className; }).length;
}

function countTraces(model, family) {
    return model.traces.filter(function (t) { return t.family === family; }).length;
}

function gateComponents(model) {
    return model.components.filter(function (c) { return !!c.gate; });
}

function openGates(components) {
    var byGate = {};
    components.forEach(function (component) {
        if (!component.gate) {
            return;
        }
        if (!byGate[component.gate]) {
            byGate[component.gate] = {
                gate: component.gate,
                refs: [],
                sheets: []
            };
        }
        byGate[component.gate].refs.push(component.ref);
        if (byGate[component.gate].sheets.indexOf(component.sheet) === -1) {
            byGate[component.gate].sheets.push(component.sheet);
        }
    });
    return Object.keys(byGate).sort().map(function (gate) {
        byGate[gate].refs.sort();
        byGate[gate].sheets.sort();
        return byGate[gate];
    });
}

function layerToggle(layer, label, count, checked) {
    return '<label class="layer-toggle">' +
        '<input type="checkbox" data-layer="' + xml(layer) + '"' + (checked ? " checked" : "") + ">" +
        '<span>' + xml(label) + '</span><strong>' + count + "</strong></label>";
}

function evidenceList(items) {
    return "<ul>" + items.map(function (item) {
        return "<li>" + xml(item) + "</li>";
    }).join("") + "</ul>";
}

function gateEvidenceHtml(items) {
    if (!items || !items.length) {
        return "";
    }
    return items.map(function (item) {
        var sources = (item.sources || []).map(function (source) {
            return '<a href="' + xml(source.url) + '">' + xml(source.label) + "</a>";
        }).join(" ");
        return '<section class="panel gate-evidence">' +
            "<h2>DSI Gate Evidence</h2>" +
            '<p class="gate-status"><code>' + xml(item.gate) + "</code> " + xml(item.status.toUpperCase()) + "</p>" +
            '<p class="note">' + xml(item.summary) + "</p>" +
            '<h3>Confirmed</h3>' + evidenceList(item.confirmed || []) +
            '<h3>Still missing</h3>' + evidenceList(item.missing || []) +
            (sources ? '<p class="source">Sources: ' + sources + "</p>" : "") +
            "</section>";
    }).join("\n");
}

function dsiPanelInterfaceHtml(item) {
    if (!item) {
        return "";
    }
    var pinRows = item.pinout.map(function (pin) {
        return "<tr><td>" + pin.pin + "</td><td>" + xml(pin.label) + "</td><td><code>" + xml(pin.net) + "</code></td></tr>";
    }).join("\n");
    var sources = (item.sources || []).map(function (source) {
        return '<a href="' + xml(source.url) + '">' + xml(source.label) + "</a>";
    }).join(" ");
    return '<section class="panel dsi-interface">' +
        "<h2>DSI Panel Interface</h2>" +
        '<p class="gate-status"><code>' + xml(item.orientation.gate) + "</code> OPEN</p>" +
        '<p class="note">' + xml(item.panel + " - " + item.connector) + "</p>" +
        '<table class="gate-table"><thead><tr><th>Pin</th><th>Panel</th><th>Card net</th></tr></thead><tbody>' +
        pinRows +
        "</tbody></table>" +
        (item.orientation.workingAssumption ? '<h3>Working assumption</h3><p class="note">' + xml(item.orientation.workingAssumption) + "</p>" : "") +
        '<h3>Known</h3>' + evidenceList(item.orientation.known || []) +
        '<h3>Before routing</h3>' + evidenceList(item.orientation.mustCheckBeforeRouting || []) +
        (sources ? '<p class="source">Sources: ' + sources + "</p>" : "") +
        "</section>";
}

function routeStatusHtml(items) {
    if (!items || !items.length) {
        return "";
    }
    var rows = items.map(function (item) {
        var gate = item.gate ? "<br><code>" + xml(item.gate) + "</code>" : "";
        return "<tr><td>" + xml(item.family) + "</td><td><code>" + xml(item.status) + "</code>" + gate +
            "</td><td>" + item.routes + "</td><td>" + item.airwires +
            '</td><td class="route-note">' + xml(item.note) + "</td></tr>";
    }).join("\n");
    return '<section class="panel route-status">' +
        "<h2>Route Status</h2>" +
        '<table class="gate-table"><thead><tr><th>Family</th><th>Status</th><th>Traces</th><th>Airwires</th><th>Next action</th></tr></thead><tbody>' +
        rows +
        "</tbody></table>" +
        "</section>";
}

function previewToHtml(model) {
    var gatedParts = gateComponents(model);
    var gates = model.openGates || openGates(model.components);
    var signalCount = countAirwires(model, "signal");
    var gateSummaryRows = gates.map(function (gate) {
        return '<tr><td><code>' + xml(gate.gate) + '</code></td><td>' + gate.refs.length + '</td><td>' + xml(gate.refs.join(", ")) + "</td></tr>";
    }).join("\n");
    var gateRows = gatedParts.map(function (c) {
        return '<tr><td>' + xml(c.ref) + '</td><td>' + xml(c.value) + '</td><td><code>' + xml(c.gate) + "</code></td></tr>";
    }).join("\n");
    var sourceLabel = xml(model.source.layout + " + " + model.source.connectivity);
    var boardSvg = previewToSvg(model).replace("<svg ", '<svg role="img" aria-label="First-pass board route preview" ');
    var htmlClasses = [];
    if (signalCount) {
        htmlClasses.push("hide-signal");
    }
    ["low-speed", "dsi", "usb", "power", "storage"].forEach(function (family) {
        htmlClasses.push("hide-trace-" + family);
    });

    return [
        "<!doctype html>",
        '<html lang="en" class="' + htmlClasses.join(" ") + '">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>PuzzleScript Card Board Preview</title>",
        "<style>",
        ":root{color-scheme:light;--ink:#1b1d21;--muted:#5b616b;--line:#d6d8dc;--panel:#ffffff;--page:#f4f2ec;--front:#f0a336;--back:#2e83b8;--danger:#c83a2d;--power:#cc2222;--dsi:#d95f02;--usb:#1f78b4;--signal:#6b7280}",
        "*{box-sizing:border-box}",
        "body{margin:0;background:var(--page);color:var(--ink);font:14px/1.42 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
        ".topbar{display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:16px;align-items:end;padding:18px 22px 14px;border-bottom:1px solid var(--line);background:#fbfaf6}",
        "h1{margin:0;font-size:22px;line-height:1.1;font-weight:750;letter-spacing:0}",
        ".subtitle{margin:6px 0 0;color:var(--muted);max-width:820px}",
        ".status-strip{display:grid;grid-template-columns:repeat(5,minmax(84px,1fr));gap:8px;min-width:560px}",
        ".metric{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:8px 10px;min-height:58px}",
        ".metric span{display:block;color:var(--muted);font-size:12px}",
        ".metric strong{display:block;margin-top:2px;font-size:22px;line-height:1.1}",
        ".workspace{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;padding:16px 22px 22px}",
        ".board-pane{min-width:0;border:1px solid var(--line);border-radius:8px;background:#fffdf8;overflow:auto}",
        ".board-art{min-width:720px;padding:10px}",
        ".board-art svg{display:block;width:100%;height:auto}",
        ".side-panel{display:grid;gap:12px;align-content:start}",
        ".panel{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:12px}",
        ".panel h2{margin:0 0 10px;font-size:14px;line-height:1.2}",
        ".layers{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
        ".layer-toggle{display:flex;align-items:center;gap:8px;min-height:34px;border:1px solid var(--line);border-radius:7px;padding:6px 8px;background:#fbfbf8;cursor:pointer}",
        ".layer-toggle input{accent-color:#1f6f9f}",
        ".layer-toggle span{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".layer-toggle strong{font-size:12px;color:var(--muted);font-weight:650}",
        ".gate-table{width:100%;border-collapse:collapse;font-size:12px}",
        ".gate-table td,.gate-table th{border-top:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}",
        ".gate-table th{color:var(--muted);font-weight:650}",
        ".gate-table code{font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:normal}",
        ".route-note{color:var(--muted);font-size:11px}",
        ".gate-evidence h3{margin:12px 0 4px;font-size:12px;color:var(--muted);text-transform:uppercase}",
        ".dsi-interface h3{margin:12px 0 4px;font-size:12px;color:var(--muted);text-transform:uppercase}",
        ".dsi-interface ul{margin:0;padding-left:18px;font-size:12px}",
        ".dsi-interface li{margin:4px 0}",
        ".gate-evidence ul{margin:0;padding-left:18px;font-size:12px}",
        ".gate-evidence li{margin:4px 0}",
        ".gate-status{margin:0 0 8px;font-size:12px;color:var(--muted)}",
        ".source{margin:10px 0 0;color:var(--muted);font-size:12px}",
        ".source a{color:#1f6f9f;text-decoration:none}",
        ".component,.trace,.dsi-plan,.dsi-plan-label,.airwire,.airwire-label,.keepout{transition:opacity .12s ease}",
        ".hide-front .component.front,.hide-front .trace[data-side='front'],.hide-back .component.back,.hide-back .trace[data-side='back'],.hide-keepouts .keepout,.hide-traces .trace,.hide-trace-low-speed .trace[data-family='low-speed'],.hide-trace-dsi .trace[data-family='dsi'],.hide-trace-usb .trace[data-family='usb'],.hide-trace-power .trace[data-family='power'],.hide-trace-storage .trace[data-family='storage'],.hide-dsi-plan .dsi-plan,.hide-dsi-plan .dsi-plan-label,.hide-airwires .airwire,.hide-airwires .airwire-label,.hide-dsi .airwire.dsi,.hide-dsi .airwire-label.dsi,.hide-usb .airwire.usb,.hide-usb .airwire-label.usb,.hide-power .airwire.power,.hide-power .airwire-label.power,.hide-signal .airwire.signal{display:none}",
        ".hide-gates .gate-list{display:none}",
        ".hide-gates .component.gated rect,.hide-gates .component.gated ellipse{stroke:#24485f;stroke-dasharray:none}",
        ".note{margin:0;color:var(--muted)}",
        "@media (max-width:980px){.topbar{grid-template-columns:1fr}.status-strip{min-width:0}.workspace{grid-template-columns:1fr}.side-panel{grid-template-columns:1fr 1fr}.board-art{min-width:640px}}",
        "@media (max-width:720px){.topbar,.workspace{padding-left:12px;padding-right:12px}.status-strip{grid-template-columns:1fr 1fr}.side-panel{grid-template-columns:1fr}.layers{grid-template-columns:1fr}.board-art{min-width:560px}}",
        "</style>",
        "</head>",
        "<body>",
        '<header class="topbar">',
        "<div>",
        "<h1>PuzzleScript Card Board Preview</h1>",
        '<p class="subtitle">FIRST-PASS ROUTED preview. All currently visible ratsnest nets have generated copper; high-speed, power, and gated footprints still need review before fabrication.</p>',
        "</div>",
        '<div class="status-strip" aria-label="Preview summary">',
        '<div class="metric"><span>Components</span><strong>' + model.components.length + "</strong></div>",
        '<div class="metric"><span>Airwires</span><strong>' + model.airwires.length + "</strong></div>",
        '<div class="metric"><span>Routed traces</span><strong>' + model.routedTraceCount + "</strong></div>",
        '<div class="metric"><span>Open gates</span><strong>' + gates.length + "</strong></div>",
        '<div class="metric"><span>Gated parts</span><strong>' + gatedParts.length + "</strong></div>",
        "</div>",
        "</header>",
        '<main class="workspace">',
        '<section class="board-pane" aria-label="Board drawing"><div class="board-art">' + boardSvg + "</div></section>",
        '<aside class="side-panel">',
        '<section class="panel">',
        "<h2>Layers</h2>",
        '<div class="layers">',
        layerToggle("front", "Front", countComponents(model, "front"), true),
        layerToggle("back", "Back", countComponents(model, "back"), true),
        layerToggle("keepouts", "Keepouts", model.keepouts.length, true),
        layerToggle("traces", "Traces", model.traces.length, true),
        layerToggle("trace-low-speed", "Low-speed copper", countTraces(model, "low-speed"), false),
        layerToggle("trace-dsi", "DSI copper", countTraces(model, "dsi"), false),
        layerToggle("trace-usb", "USB copper", countTraces(model, "usb"), false),
        layerToggle("trace-power", "Power copper", countTraces(model, "power"), false),
        layerToggle("trace-storage", "Storage copper", countTraces(model, "storage"), false),
        layerToggle("dsi-plan", "DSI route intent", model.dsiRoutePlan ? model.dsiRoutePlan.pairs.length : 0, true),
        layerToggle("airwires", "Airwires", model.airwires.length, true),
        layerToggle("dsi", "DSI", countAirwires(model, "dsi"), true),
        layerToggle("usb", "USB", countAirwires(model, "usb"), true),
        layerToggle("power", "Power", countAirwires(model, "power"), true),
        layerToggle("signal", "Signal", signalCount, false),
        layerToggle("gates", "Gate markers", gatedParts.length, true),
        "</div>",
        '<p class="source">Source: <code>' + sourceLabel + "</code></p>",
        "</section>",
        routeStatusHtml(model.routeStatus),
        '<section class="panel gate-list gate-summary">',
        "<h2>Gate Summary</h2>",
        '<table class="gate-table"><thead><tr><th>Gate</th><th>Parts</th><th>Refs</th></tr></thead><tbody>',
        gateSummaryRows,
        "</tbody></table>",
        "</section>",
        '<section class="panel gate-list">',
        "<h2>Gated Parts</h2>",
        '<table class="gate-table"><thead><tr><th>Ref</th><th>Part</th><th>Gate</th></tr></thead><tbody>',
        gateRows,
        "</tbody></table>",
        "</section>",
        dsiPanelInterfaceHtml(model.dsiPanelInterface),
        gateEvidenceHtml(model.gateEvidence),
        '<section class="panel"><p class="note">This page is generated from the board preview model. It is a progress view, not a manufacturing package.</p></section>',
        "</aside>",
        "</main>",
        "<script>",
        "(function(){",
        "function toggleLayer(input){var layer=input.getAttribute('data-layer');document.documentElement.classList.toggle('hide-'+layer,!input.checked);}",
        "window.toggleLayer=toggleLayer;",
        "var inputs=document.querySelectorAll('[data-layer]');",
        "Array.prototype.forEach.call(inputs,function(input){if(input.tagName.toLowerCase()==='input'){input.addEventListener('change',function(){toggleLayer(input);});toggleLayer(input);}});",
        "}());",
        "</script>",
        "</body>",
        "</html>"
    ].join("\n") + "\n";
}

module.exports = {
    buildPreview: buildPreview,
    buildPlacementMap: buildPlacementMap,
    buildAirwires: buildAirwires,
    buildTraces: buildTraces,
    buildDsiRoutePlan: buildDsiRoutePlan,
    componentsByRef: componentsByRef,
    isFirstPassRouteNet: isFirstPassRouteNet,
    isGeneratedRouteNet: isGeneratedRouteNet,
    routePoints: routePoints,
    openGates: openGates,
    previewToSvg: previewToSvg,
    previewToJson: previewToJson,
    previewToHtml: previewToHtml
};

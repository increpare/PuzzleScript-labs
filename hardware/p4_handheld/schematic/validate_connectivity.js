"use strict";

var fs = require("fs");
var path = require("path");

var connectivityPath = path.join(__dirname, "connectivity.json");
var model = JSON.parse(fs.readFileSync(connectivityPath, "utf8"));

function nodeKey(node) {
    return node[0] + "." + node[1];
}

function buildNetMap(model) {
    var byNet = {};
    model.connections.forEach(function (conn) {
        byNet[conn.net] = conn.nodes.slice();
    });
    return byNet;
}

function allRefs(model) {
    return model.components.map(function (c) { return c.ref; });
}

function refsOnNet(byNet, net) {
    var nodes = byNet[net] || [];
    return nodes.map(function (n) { return n[0]; });
}

function validateConnectivity(model) {
    var errors = [];
    var byNet = buildNetMap(model);
    var refs = allRefs(model);
    var refSet = {};
    refs.forEach(function (r) {
        if (refSet[r]) {
            errors.push("duplicate ref: " + r);
        }
        refSet[r] = true;
    });

    Object.keys(byNet).forEach(function (net) {
        if (byNet[net].length < 2) {
            errors.push("net " + net + " has fewer than 2 nodes");
        }
    });

    // Board-policy checks activate once the owning component exists, so the
    // connectivity model can grow task-by-task while staying green.
    if (refSet.U1) {
        if (!byNet["+3V3"] || refsOnNet(byNet, "+3V3").indexOf("U1") === -1) {
            errors.push("U1 not on +3V3");
        }
    }
    if (refSet.J3) {
        if (!byNet["+3V3_PANEL"] || refsOnNet(byNet, "+3V3_PANEL").indexOf("J3") === -1) {
            errors.push("panel FFC not on switched +3V3_PANEL");
        }
        if (!byNet["DSI_D0_P"] || refsOnNet(byNet, "DSI_D0_P").indexOf("U1") === -1) {
            errors.push("DSI not routed to U1");
        }
    }
    if (refSet.U6) {
        if (!byNet.PANEL_EN || refsOnNet(byNet, "PANEL_EN").indexOf("U6") === -1) {
            errors.push("panel load switch missing PANEL_EN");
        }
    }
    if (refSet.J1 && refSet.U1) {
        if (!byNet.USB_DP || refsOnNet(byNet, "USB_DP").indexOf("J1") === -1) {
            errors.push("USB not routed to J1");
        }
    }
    if (refSet.U3) {
        if (refsOnNet(byNet, "I2C_SDA").indexOf("U3") === -1) {
            errors.push("I2C_SDA must reach the fuel gauge");
        }
    }
    if (refSet.SW9 && refSet.U4) {
        if (refsOnNet(byNet, "PWR_EN").indexOf("SW9") === -1 ||
            refsOnNet(byNet, "PWR_EN").indexOf("U4") === -1) {
            errors.push("power slide switch must gate buck-boost EN via PWR_EN");
        }
        if (refsOnNet(byNet, "BAT+").indexOf("SW9") !== -1) {
            errors.push("power slide switch must not carry battery current");
        }
    }
    if (refSet.U7) {
        ["I2S_BCLK", "I2S_LRCLK", "I2S_DIN"].forEach(function (net) {
            if (refsOnNet(byNet, net).indexOf("U7") === -1 ||
                refsOnNet(byNet, net).indexOf("U1") === -1) {
                errors.push("I2S net must link U1 and the amp: " + net);
            }
        });
    }

    model.requirements.differential_nets.forEach(function (pair) {
        if (!byNet[pair[0]] || !byNet[pair[1]]) {
            errors.push("missing differential pair: " + pair.join("/"));
        }
    });

    var buttonNets = [
        "BTN_UP", "BTN_DOWN", "BTN_LEFT", "BTN_RIGHT",
        "BTN_UNDO", "BTN_ACTION", "BTN_RESTART", "BTN_MENU"
    ];
    if (refSet.SW1) {
        buttonNets.forEach(function (net) {
            if (refsOnNet(byNet, net).indexOf("U1") === -1) {
                errors.push("button net missing U1: " + net);
            }
        });
    }

    var blockIds = model.sheets.map(function (s) { return s.id; });
    var blocksJson = JSON.parse(fs.readFileSync(path.join(__dirname, "blocks.json"), "utf8"));
    blocksJson.blocks.forEach(function (block) {
        if (blockIds.indexOf(block.id) === -1) {
            errors.push("blocks.json block missing sheet: " + block.id);
        }
    });

    var seen = {};
    model.connections.forEach(function (conn) {
        conn.nodes.forEach(function (node) {
            var key = nodeKey(node);
            if (seen[key]) {
                errors.push("node " + key + " on multiple nets (" + seen[key] + " and " + conn.net + ")");
            }
            seen[key] = conn.net;
        });
    });

    return errors;
}

function exportKicadNetlist(model) {
    var lines = [
        "(export (version D)",
        "  (design",
        "    (source connectivity.json)",
        "    (date \"" + model.meta.date + "\")",
        "    (tool \"PuzzleScript validate_connectivity.js\"))",
        "  (components"
    ];
    model.components.forEach(function (c) {
        lines.push("    (comp (ref " + c.ref + ")",
            "      (value " + c.value + ")",
            "      (footprint " + c.footprint + ")",
            "      (sheet " + c.sheet + ")))");
    });
    lines.push("  (nets");
    model.connections.forEach(function (conn, idx) {
        lines.push("    (net (code " + (idx + 1) + ") (name \"" + conn.net + "\")");
        conn.nodes.forEach(function (node) {
            lines.push("      (node (ref " + node[0] + ") (pin \"" + node[1] + "\"))");
        });
        lines.push("    )");
    });
    lines.push("  )", ")", ")");
    return lines.join("\n") + "\n";
}

module.exports = {
    model: model,
    buildNetMap: buildNetMap,
    validateConnectivity: validateConnectivity,
    exportKicadNetlist: exportKicadNetlist
};

if (require.main === module) {
    var cmd = process.argv[2] || "validate";
    if (cmd === "validate") {
        var errors = validateConnectivity(model);
        if (errors.length) {
            errors.forEach(function (e) { console.error("FAIL: " + e); });
            process.exit(1);
        }
        console.log("connectivity OK (" + model.connections.length + " nets, " +
            model.components.length + " components)");
    } else if (cmd === "export-netlist") {
        var out = process.argv[3] || path.join(__dirname, "..", "p4_handheld.net");
        fs.writeFileSync(out, exportKicadNetlist(model), "utf8");
        console.log("Wrote " + out);
    } else {
        console.error("Usage: node validate_connectivity.js [validate|export-netlist] [out.net]");
        process.exit(2);
    }
}

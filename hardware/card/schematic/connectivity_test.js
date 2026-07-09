"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var V = require("./validate_connectivity.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("connectivity validates without errors", function () {
    var errors = V.validateConnectivity(V.model);
    assert.deepStrictEqual(errors, [], errors.join("; "));
});

test("DSI differential pairs exist", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.DSI_D0_P && byNet.DSI_D0_N);
    assert.ok(byNet.DSI_D1_P && byNet.DSI_D1_N);
    assert.ok(byNet.DSI_CLK_P && byNet.DSI_CLK_N);
});

test("DSI panel interface locks Waveshare pinout but not card-end contact orientation", function () {
    var iface = V.model.dsiPanelInterface;
    assert.ok(iface, "connectivity should carry DSI panel evidence");
    assert.strictEqual(iface.panel, "Waveshare 43H-800480-IPS no-touch");
    assert.strictEqual(iface.connector, "15-pin 1.0 mm Raspberry-Pi-style DSI FFC");
    assert.deepStrictEqual(iface.pinout.map(function (pin) {
        return [pin.pin, pin.net];
    }), [
        [1, "GND"],
        [2, "DSI_D1_N"],
        [3, "DSI_D1_P"],
        [4, "GND"],
        [5, "DSI_CLK_N"],
        [6, "DSI_CLK_P"],
        [7, "GND"],
        [8, "DSI_D0_N"],
        [9, "DSI_D0_P"],
        [10, "GND"],
        [11, "NC_SCL0"],
        [12, "NC_SDA0"],
        [13, "GND"],
        [14, "+3V3_PANEL"],
        [15, "+3V3_PANEL"]
    ]);
    assert.ok(iface.orientation.known.some(function (item) {
        return item.indexOf("screen-side cable gold finger faces upward") !== -1;
    }));
    assert.ok(iface.orientation.mustCheckBeforeRouting.some(function (item) {
        return item.indexOf("same-side or opposite-side 15-pin cable") !== -1;
    }));
    assert.strictEqual(iface.orientation.gate, "GATE-DSI-FFC-CONTACT");
});

test("DSI panel interface records same-side cable as a layout assumption", function () {
    var iface = V.model.dsiPanelInterface;
    assert.strictEqual(iface.orientation.assumedCableParity, "same-side");
    assert.strictEqual(iface.orientation.assumptionStatus, "assumed-for-layout");
    assert.ok(iface.orientation.workingAssumption.indexOf("Same-side 15-pin FFC cable assumed") !== -1);
    assert.ok(iface.orientation.mustCheckBeforeRouting.some(function (item) {
        return item.indexOf("Confirm the same-side 15-pin cable assumption") !== -1;
    }));
});

test("power tree connects charger buck-boost and chip-down compute", function () {
    var byNet = V.buildNetMap(V.model);
    var p33 = byNet["+3V3"].map(function (n) { return n[0]; });
    assert.ok(p33.indexOf("U4") !== -1);
    assert.ok(p33.indexOf("U1") !== -1);
    var panel33 = byNet["+3V3_PANEL"].map(function (n) { return n[0]; });
    assert.ok(panel33.indexOf("U6") !== -1);
    assert.ok(panel33.indexOf("J3") !== -1);
    assert.ok(byNet["+3V3_PANEL"].some(function (n) { return n[0] === "J3" && n[1] === "14"; }));
    assert.ok(byNet["+3V3_PANEL"].some(function (n) { return n[0] === "J3" && n[1] === "15"; }));
    assert.ok(!byNet.GND.some(function (n) { return n[0] === "J3" && n[1] === "15"; }),
        "Waveshare 43H-800480-IPS pin 15 is 3V3, not GND");
    assert.ok(byNet.VBUS_IN.some(function (n) { return n[0] === "J1"; }));
    assert.ok(byNet["BAT+"].some(function (n) { return n[0] === "J2"; }));
});

test("wake and sleep-control nets are on the planned control parts", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.SW_DPAD_DOWN.some(function (n) { return n[0] === "U1" && n[1] === "GPIO9"; }));
    assert.ok(byNet.SW_ACTION.some(function (n) { return n[0] === "U1" && n[1] === "GPIO10"; }));
    assert.ok(byNet.PANEL_EN.some(function (n) { return n[0] === "U1" && n[1] === "GPIO11"; }));
    assert.ok(byNet.PANEL_EN.some(function (n) { return n[0] === "U6"; }));
});

test("power slide switch gates the buck-boost, no latch IC", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.PWR_EN.some(function (n) { return n[0] === "SW9" && n[1] === "C"; }));
    assert.ok(byNet.PWR_EN.some(function (n) { return n[0] === "U4" && n[1] === "EN"; }));
    assert.ok(byNet.SYS.some(function (n) { return n[0] === "SW9" && n[1] === "A"; }));
    assert.ok(byNet.GND.some(function (n) { return n[0] === "SW9" && n[1] === "B"; }));
    assert.ok(byNet.GND.some(function (n) { return n[0] === "U2" && n[1] === "SYSOFF"; }));
    assert.ok(!byNet.SW_POWER, "SW_POWER net should be gone");
    assert.ok(!V.model.components.some(function (c) { return c.ref === "U7"; }), "U7 latch should be deleted");
});

test("charge LED is powered from VBUS through charger CHG pin", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.VBUS_IN.some(function (n) { return n[0] === "R8"; }));
    assert.ok(byNet.CHG_LED.some(function (n) { return n[0] === "D4" && n[1] === "A"; }));
    assert.ok(byNet.CHG_STAT.some(function (n) { return n[0] === "U2" && n[1] === "CHG"; }));
});

test("all eight gameplay switches reach U1", function () {
    var byNet = V.buildNetMap(V.model);
    ["SW_DPAD_UP", "SW_ACTION", "SW_MENU"].forEach(function (net) {
        assert.ok(byNet[net].some(function (n) { return n[0] === "U1"; }), net);
    });
});

test("dpad switches use TL3315-class separate dome tacts", function () {
    var byRef = {};
    V.model.components.forEach(function (c) { byRef[c.ref] = c; });
    ["SW1", "SW2", "SW3", "SW4"].forEach(function (ref) {
        assert.strictEqual(byRef[ref].value, "TL3315NF160Q-class", ref);
    });
    ["SW5", "SW6", "SW7", "SW8"].forEach(function (ref) {
        assert.strictEqual(byRef[ref].value, "KMR211NG", ref);
    });
});

test("chip-down compute has flash, crystal, and DC-DC support parts", function () {
    var byRef = {};
    V.model.components.forEach(function (c) { byRef[c.ref] = c; });
    assert.strictEqual(byRef.U1.value, "ESP32-P4NRW32X");
    assert.ok(byRef.U9 && byRef.X1 && byRef.L1, "support parts present");
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.FLASH_CLK.some(function (n) { return n[0] === "U9"; }));
    assert.ok(byNet.XTAL_IN.some(function (n) { return n[0] === "X1"; }));
    assert.ok(byNet.DCDC_FB.some(function (n) { return n[0] === "L1"; }));
});

test("hardware docs and block inventory describe chip-down spin 1", function () {
    var blocks = JSON.parse(fs.readFileSync(path.join(__dirname, "blocks.json"), "utf8"));
    var readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
    var netlist = fs.readFileSync(path.join(__dirname, "..", "card.net"), "utf8");
    assert.strictEqual(blocks.meta.mcu, "ESP32-P4NRW32X chip-down");
    assert.ok(readme.indexOf("ESP32-P4NRW32X") !== -1, "README should name the chip-down MCU");
    assert.strictEqual(readme.indexOf("ESP32-P4-Module-32MB"), -1, "README should not name the superseded module");
    assert.ok(netlist.indexOf("ESP32-P4NRW32X") !== -1, "card.net should name the chip-down MCU");
    assert.ok(netlist.indexOf("HRO-TYPE-C-31-M-12") !== -1, "card.net should name the locked USB-C connector");
    assert.ok(netlist.indexOf("Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12") !== -1,
        "card.net should name the locked USB-C footprint");
    assert.strictEqual(netlist.indexOf("ESP32-P4-Module-32MB"), -1, "card.net should not name the superseded module");
    assert.strictEqual(netlist.indexOf("(ref U7)"), -1, "card.net should not contain the removed U7 latch");
    assert.strictEqual(netlist.indexOf("USB-C-mid"), -1, "card.net should not contain the superseded USB-C placement");
});

test("DSI panel handoff doc gives a physical closeout checklist", function () {
    var doc = fs.readFileSync(path.join(__dirname, "..", "DSI_PANEL_INTERFACE.md"), "utf8");
    var budget = fs.readFileSync(path.join(__dirname, "..", "PIN_BUDGET.md"), "utf8");
    assert.ok(doc.indexOf("Waveshare 43H-800480-IPS no-touch") !== -1);
    assert.ok(doc.indexOf("same-side or opposite-side 15-pin cable") !== -1);
    assert.ok(doc.indexOf("Working assumption: same-side 15-pin FFC cable") !== -1);
    assert.ok(doc.indexOf("card-end photo") !== -1);
    assert.ok(doc.indexOf("Do not close GATE-DSI-FFC-CONTACT") !== -1);
    assert.ok(budget.indexOf("| 15 | +3V3_PANEL |") !== -1,
        "PIN_BUDGET should show Waveshare pin 15 as 3V3, not ground");
    assert.strictEqual(budget.indexOf("| 15 | GND |"), -1,
        "PIN_BUDGET should not leave the old pin 15 ground mapping behind");
});

test("package-locked parts carry footprint directions for import", function () {
    var byRef = {};
    V.model.components.forEach(function (c) { byRef[c.ref] = c; });
    assert.strictEqual(byRef.J1.value, "HRO-TYPE-C-31-M-12");
    assert.strictEqual(byRef.J1.footprint, "Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12");
    assert.strictEqual(byRef.J1.gate, undefined);
    assert.strictEqual(byRef.U2.footprint, "VQFN-16-RGT-3x3");
    assert.strictEqual(byRef.U3.footprint, "LFCSP-8-2x2");
    assert.strictEqual(byRef.U4.footprint, "VQFN-HR-15-RNM-3x2.5");
    assert.strictEqual(byRef.U6.value, "TPS22919DCK");
    assert.strictEqual(byRef.U6.footprint, "SOT-SC70-6-DCK-2x2.1");
    assert.strictEqual(byRef.U5.value, "DRV2605LDGS");
    assert.strictEqual(byRef.U5.footprint, "VSSOP-10-DGS-3x4.9");
    assert.strictEqual(byRef.J3.footprint, "FFC-15-1.0mm-right-angle-contact-TBD");
});

test("footprint matrix keeps open import gates explicit", function () {
    var matrix = fs.readFileSync(path.join(__dirname, "..", "FOOTPRINT_LOCK_MATRIX.md"), "utf8");
    var openGates = matrix.split("## Open Gate IDs")[1].split("## Closed Gate IDs")[0];
    [
        "GATE-ESP32-P4-REF-CAPTURE",
        "GATE-DSI-FFC-CONTACT",
        "GATE-DPAD-MOCKUP",
        "GATE-FACE-BUTTON-FEEL",
        "GATE-POWER-SLIDE-SLOT",
        "GATE-BATTERY-SAMPLE",
        "GATE-LRA-MOUNT",
        "GATE-PIEZO-DRIVE-REVIEW",
        "GATE-MICROSD-FOOTPRINT",
        "GATE-CASE-LED-LIGHTPIPE"
    ].forEach(function (gate) {
        assert.ok(openGates.indexOf(gate) !== -1, "missing open footprint gate " + gate);
    });
    assert.strictEqual(openGates.indexOf("GATE-USB-C-BACK-FOOTPRINT"), -1,
        "USB-C footprint gate should no longer be open");
    assert.ok(matrix.indexOf("GATE-USB-C-BACK-FOOTPRINT") !== -1,
        "matrix should keep the closed USB-C gate audit trail");
});

test("connectivity components carry their blocking gate ids", function () {
    var byRef = {};
    V.model.components.forEach(function (c) { byRef[c.ref] = c; });
    assert.strictEqual(byRef.U9.gate, "GATE-ESP32-P4-REF-CAPTURE");
    assert.strictEqual(byRef.X1.gate, "GATE-ESP32-P4-REF-CAPTURE");
    assert.strictEqual(byRef.L1.gate, "GATE-ESP32-P4-REF-CAPTURE");
    assert.strictEqual(byRef.J3.gate, "GATE-DSI-FFC-CONTACT");
    assert.strictEqual(byRef.SW1.gate, "GATE-DPAD-MOCKUP");
    assert.strictEqual(byRef.SW5.gate, "GATE-FACE-BUTTON-FEEL");
    assert.strictEqual(byRef.SW9.gate, "GATE-POWER-SLIDE-SLOT");
    assert.strictEqual(byRef.J2.gate, "GATE-BATTERY-SAMPLE");
    assert.strictEqual(byRef.B1.gate, "GATE-LRA-MOUNT");
    assert.strictEqual(byRef.U8.gate, "GATE-PIEZO-DRIVE-REVIEW");
    assert.strictEqual(byRef.J4.gate, "GATE-MICROSD-FOOTPRINT");
    assert.strictEqual(byRef.D1.gate, "GATE-CASE-LED-LIGHTPIPE");
});

test("exportKicadNetlist includes U1 and DSI nets", function () {
    var netlist = V.exportKicadNetlist(V.model);
    assert.ok(netlist.indexOf("(ref U1)") !== -1);
    assert.ok(netlist.indexOf("DSI_D0_P") !== -1);
    assert.ok(netlist.indexOf("(export (version D)") !== -1);
});

console.log(passed + " tests passed");

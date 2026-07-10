"use strict";

var assert = require("assert");
var jlc = require("./jlc_parts.js");
var V = require("./validate_connectivity.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("catalog loads and covers every component ref", function () {
    var catalog = jlc.loadCatalog();
    V.model.components.forEach(function (comp) {
        assert.ok(catalog.parts[comp.ref], "missing catalog entry for " + comp.ref);
    });
});

test("applyCatalog adds LCSC to package-locked PMIC parts", function () {
    var applied = jlc.applyCatalog(V.model);
    var byRef = {};
    applied.model.components.forEach(function (comp) { byRef[comp.ref] = comp; });
    assert.strictEqual(byRef.U2.lcsc, "C15464");
    assert.strictEqual(byRef.U4.lcsc, "C964639");
    assert.strictEqual(byRef.J1.easyeda_footprint, "USB-C-SMD_TYPE-C-16PIN-2MD-073");
});

test("footprintLibraryName uses easyeda namespace when mapped", function () {
    var applied = jlc.applyCatalog(V.model);
    var u2 = applied.model.components.filter(function (c) { return c.ref === "U2"; })[0];
    assert.strictEqual(jlc.footprintLibraryName(u2), "easyeda:QFN-16_L3.0-W3.0-P0.50-TL-EP1.7");
});

test("bomCsv includes LCSC rows", function () {
    var applied = jlc.applyCatalog(V.model);
    var csv = jlc.bomCsv(applied.model);
    assert.ok(csv.indexOf("Designator,Value,MPN,LCSC") === 0);
    assert.ok(csv.indexOf("U2,BQ24075RGTR,BQ24075RGTR,C15464") !== -1);
    assert.ok(csv.indexOf("X1,40MHz-crystal,X322540MPB4SI,C9010") !== -1);
    assert.ok(csv.indexOf("L1,2.2uH,HPC4018BM-2R2M,C692155") !== -1);
});

console.log(passed + " tests passed");

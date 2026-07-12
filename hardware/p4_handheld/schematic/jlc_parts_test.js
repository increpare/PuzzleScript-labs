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

test("applyCatalog decorates mapped components with LCSC ids", function () {
    var applied = jlc.applyCatalog(V.model);
    var catalog = applied.catalog;
    applied.model.components.forEach(function (comp) {
        var entry = catalog.parts[comp.ref];
        if (entry && entry.lcsc) {
            assert.strictEqual(comp.lcsc, entry.lcsc, comp.ref + " should carry catalog LCSC id");
        }
    });
});

test("footprintLibraryName uses easyeda namespace when mapped", function () {
    var applied = jlc.applyCatalog(V.model);
    applied.model.components.forEach(function (comp) {
        if (comp.easyeda_footprint) {
            assert.strictEqual(jlc.footprintLibraryName(comp), "easyeda:" + comp.easyeda_footprint);
        }
    });
});

test("bomCsv has the JLC header and one row per component", function () {
    var applied = jlc.applyCatalog(V.model);
    var csv = jlc.bomCsv(applied.model);
    assert.ok(csv.indexOf("Designator,Value,MPN,LCSC") === 0);
    applied.model.components.forEach(function (comp) {
        assert.ok(csv.indexOf(comp.ref + ",") !== -1, comp.ref + " missing from BOM csv");
    });
});

console.log(passed + " tests passed");

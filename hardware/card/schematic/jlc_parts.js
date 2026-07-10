"use strict";

var fs = require("fs");
var path = require("path");

var CATALOG_PATH = path.join(__dirname, "jlc_catalog.json");

function loadCatalog(catalogPath) {
    return JSON.parse(fs.readFileSync(catalogPath || CATALOG_PATH, "utf8"));
}

function partForRef(catalog, ref) {
    return (catalog.parts && catalog.parts[ref]) || null;
}

function hasJlcFootprint(part) {
    return !!(part && part.easyeda_footprint);
}

function hasLcsc(part) {
    return !!(part && part.lcsc);
}

function applyCatalog(model, catalogPath) {
    var catalog = loadCatalog(catalogPath);
    var byRef = {};
    model.components.forEach(function (comp) {
        var part = partForRef(catalog, comp.ref);
        if (!part) {
            byRef[comp.ref] = comp;
            return;
        }
        var merged = Object.assign({}, comp);
        if (part.lcsc) {
            merged.lcsc = part.lcsc;
        }
        if (part.mpn) {
            merged.mpn = part.mpn;
        }
        if (part.easyeda_footprint) {
            merged.easyeda_footprint = part.easyeda_footprint;
        }
        if (part.status) {
            merged.jlc_status = part.status;
        }
        if (part.note) {
            merged.jlc_note = part.note;
        }
        byRef[comp.ref] = merged;
    });
    return {
        model: Object.assign({}, model, {
            components: model.components.map(function (comp) {
                return byRef[comp.ref] || comp;
            })
        }),
        catalog: catalog
    };
}

function footprintLibraryName(component) {
    if (component.easyeda_footprint) {
        return "easyeda:" + component.easyeda_footprint;
    }
    if (footprintIsOpen(component)) {
        return "PSCard:Preview_" + component.ref;
    }
    return "PSCard:Fit_" + component.ref;
}

function footprintIsOpen(component) {
    if (component.easyeda_footprint) {
        return false;
    }
    var footprint = component.footprint || "";
    return !!component.gate || footprint === "" || footprint === "TBD" || footprint.indexOf("TBD") !== -1;
}

function bomRows(model) {
    return model.components.filter(function (comp) {
        return comp.lcsc;
    }).map(function (comp) {
        return {
            ref: comp.ref,
            value: comp.value,
            lcsc: comp.lcsc,
            mpn: comp.mpn || comp.value,
            footprint: comp.easyeda_footprint || comp.footprint || "",
            status: comp.jlc_status || "",
            gate: comp.gate || ""
        };
    });
}

function bomCsv(model) {
    var lines = ["Designator,Value,MPN,LCSC,Footprint,Status,Gate"];
    bomRows(model).forEach(function (row) {
        lines.push([
            row.ref,
            csvCell(row.value),
            csvCell(row.mpn),
            row.lcsc,
            csvCell(row.footprint),
            row.status,
            row.gate
        ].join(","));
    });
    return lines.join("\n") + "\n";
}

function csvCell(text) {
    var s = String(text || "");
    if (s.indexOf(",") !== -1 || s.indexOf("\"") !== -1) {
        return "\"" + s.replace(/"/g, "\"\"") + "\"";
    }
    return s;
}

function catalogSummary(catalog) {
    var locked = 0;
    var candidate = 0;
    var open = 0;
    Object.keys(catalog.parts || {}).forEach(function (ref) {
        var part = catalog.parts[ref];
        if (part.status === "locked") {
            locked++;
        } else if (part.status === "candidate") {
            candidate++;
        } else {
            open++;
        }
    });
    return { locked: locked, candidate: candidate, open: open };
}

module.exports = {
    CATALOG_PATH: CATALOG_PATH,
    loadCatalog: loadCatalog,
    partForRef: partForRef,
    hasJlcFootprint: hasJlcFootprint,
    hasLcsc: hasLcsc,
    applyCatalog: applyCatalog,
    footprintLibraryName: footprintLibraryName,
    footprintIsOpen: footprintIsOpen,
    bomRows: bomRows,
    bomCsv: bomCsv,
    catalogSummary: catalogSummary
};

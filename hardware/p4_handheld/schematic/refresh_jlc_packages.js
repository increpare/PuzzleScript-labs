"use strict";

var fs = require("fs");
var https = require("https");
var path = require("path");

var CATALOG_PATH = path.join(__dirname, "jlc_catalog.json");

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function fetchEasyEda(lcscId) {
    return new Promise(function (resolve, reject) {
        var url = "https://easyeda.com/api/products/" + lcscId + "/components?version=6.4.7&fields=symboleda,symbol,kicad";
        https.get(url, function (res) {
            var data = "";
            res.on("data", function (chunk) { data += chunk; });
            res.on("end", function () {
                try {
                    var json = JSON.parse(data);
                    var head = json.result && json.result.dataStr && json.result.dataStr.head;
                    var cPara = head && head.c_para;
                    if (!cPara) {
                        resolve(null);
                        return;
                    }
                    resolve({
                        lcsc: cPara["Supplier Part"] || lcscId,
                        mpn: cPara["Manufacturer Part"] || cPara.name || "",
                        easyeda_footprint: cPara.package || ""
                    });
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
    });
}

async function refreshCatalog(catalogPath, delayMs) {
    var catalog = JSON.parse(fs.readFileSync(catalogPath || CATALOG_PATH, "utf8"));
    var refs = Object.keys(catalog.parts || {});
    var updated = 0;
    var failed = [];
    for (var i = 0; i < refs.length; i++) {
        var ref = refs[i];
        var part = catalog.parts[ref];
        if (!part.lcsc) {
            continue;
        }
        try {
            var info = await fetchEasyEda(part.lcsc);
            if (info && info.easyeda_footprint) {
                if (part.easyeda_footprint !== info.easyeda_footprint || part.mpn !== info.mpn) {
                    part.easyeda_footprint = info.easyeda_footprint;
                    if (info.mpn) {
                        part.mpn = info.mpn;
                    }
                    updated++;
                }
            } else {
                failed.push(ref + " (" + part.lcsc + ")");
            }
        } catch (err) {
            failed.push(ref + " (" + part.lcsc + "): " + err.message);
        }
        if (delayMs) {
            await sleep(delayMs);
        }
    }
    fs.writeFileSync(catalogPath || CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");
    return { updated: updated, failed: failed };
}

async function main() {
    var delayMs = 1200;
    var result = await refreshCatalog(CATALOG_PATH, delayMs);
    console.log("Updated " + result.updated + " catalog entries in " + CATALOG_PATH);
    if (result.failed.length) {
        console.log("Failed lookups:");
        result.failed.forEach(function (line) { console.log("  " + line); });
    }
}

if (require.main === module) {
    main().catch(function (err) {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    fetchEasyEda: fetchEasyEda,
    refreshCatalog: refreshCatalog
};

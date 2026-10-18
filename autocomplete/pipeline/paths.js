'use strict';
// Resolves the two directories the pipeline needs. Override with environment
// variables or with autocomplete/.env (git-ignored), one KEY=value per line:
//   PS_AC_CORPUS=D:\Projects\google_gist_scraper
//   PS_AC_DATA=D:\Projects\ps_autocomplete_data

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    PS_AC_CORPUS: 'D:\\Projects\\google_gist_scraper',
    PS_AC_DATA: 'D:\\Projects\\ps_autocomplete_data',
};

function loadDotEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    const out = {};
    if (!fs.existsSync(envPath)) return out;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m) out[m[1]] = m[2];
    }
    return out;
}

function resolvePaths() {
    const dotenv = loadDotEnv();
    const get = key => process.env[key] || dotenv[key] || DEFAULTS[key];
    const corpusDir = get('PS_AC_CORPUS');
    const dataDir = get('PS_AC_DATA');
    return {
        corpusDir,
        dataDir,
        dumpDir: path.join(corpusDir, 'dump'),
        dumpprocessedDir: path.join(corpusDir, 'dumpprocessed'),
        classifiedDir: path.join(corpusDir, 'dumpprocessed_classified'),
        repoRoot: path.resolve(__dirname, '..', '..'),
    };
}

module.exports = { resolvePaths, DEFAULTS };

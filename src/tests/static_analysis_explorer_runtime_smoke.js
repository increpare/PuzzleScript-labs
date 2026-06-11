#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const DEFAULT_HTML_PATH = path.join(rootDir, 'build/static-analysis-explorer/index.html');
const DEFAULT_BUILD_INPUT = 'src/tests/static_analysis_testdata/runtime_contracts';

function usage(exitCode = 1) {
    const text = [
        'Usage: node src/tests/static_analysis_explorer_runtime_smoke.js [path/to/index.html]',
        '',
        'If no HTML path is supplied and the default build artifact is missing,',
        `the smoke builds a fixture explorer from ${DEFAULT_BUILD_INPUT}.`,
    ].join('\n');
    (exitCode === 0 ? process.stdout : process.stderr).write(`${text}\n`);
    process.exit(exitCode);
}

function buildDefaultExplorer(htmlPath) {
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    const result = spawnSync(process.execPath, [
        path.join(rootDir, 'src/tests/build_static_analysis_explorer.js'),
        path.join(rootDir, DEFAULT_BUILD_INPUT),
        '--out',
        htmlPath,
    ], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
        throw new Error(`failed to build static analysis explorer: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error([
            `failed to build static analysis explorer (exit ${result.status})`,
            result.stderr,
            result.stdout,
        ].filter(Boolean).join('\n'));
    }
}

function resolveHtmlPath(argv) {
    const args = argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) usage(0);
    if (args.length > 1) usage(1);
    if (args.length === 1) {
        const htmlPath = path.resolve(args[0]);
        if (!fs.existsSync(htmlPath)) {
            throw new Error(`static analysis explorer HTML not found: ${htmlPath}`);
        }
        return htmlPath;
    }
    if (!fs.existsSync(DEFAULT_HTML_PATH)) {
        buildDefaultExplorer(DEFAULT_HTML_PATH);
    }
    return DEFAULT_HTML_PATH;
}

const htmlPath = resolveHtmlPath(process.argv);
const html = fs.readFileSync(htmlPath, 'utf8');
const dataMatch = html.match(/<script id="explorer-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!dataMatch) throw new Error('explorer data script missing');

const dataText = dataMatch[1];
const model = JSON.parse(dataText);
const scriptMatch = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
    .find(match => !match[0].includes('id="explorer-data"'));
if (!scriptMatch) throw new Error('explorer runtime script missing');

class FakeClassList {
    constructor() {
        this.names = new Set();
    }
    add(name) {
        this.names.add(name);
    }
    remove(name) {
        this.names.delete(name);
    }
    toggle(name, force) {
        if (force === undefined ? !this.names.has(name) : force) {
            this.add(name);
            return true;
        }
        this.remove(name);
        return false;
    }
    contains(name) {
        return this.names.has(name);
    }
}

function decodeAttribute(value) {
    return String(value)
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

class FakeNode {
    constructor(dataset = {}, attrs = {}) {
        this.dataset = dataset;
        this.title = attrs.title || '';
        this.classList = new FakeClassList();
        this.listeners = {};
    }
    addEventListener(name, fn) {
        this.listeners[name] = fn;
    }
    click() {
        if (this.listeners.click) this.listeners.click({ target: this });
    }
}

function toDatasetKey(name) {
    return name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function attrsToDataset(attrs) {
    const dataset = {};
    for (const match of attrs.matchAll(/\sdata-([a-z0-9-]+)="([^"]*)"/g)) {
        dataset[toDatasetKey(match[1])] = decodeAttribute(match[2]);
    }
    return dataset;
}

function nodesWithDataAttribute(htmlFragment, attribute) {
    const attr = attribute.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase());
    const nodes = [];
    const tagPattern = /<[^>]*\sdata-[a-z0-9-]+="[^"]*"[^>]*>/g;
    for (const match of htmlFragment.matchAll(tagPattern)) {
        if (new RegExp('\\sdata-' + attr + '="').test(match[0])) {
            const titleMatch = match[0].match(/\stitle="([^"]*)"/);
            nodes.push(new FakeNode(attrsToDataset(match[0]), {
                title: titleMatch ? decodeAttribute(titleMatch[1]) : '',
            }));
        }
    }
    return nodes;
}

class FakeElement extends FakeNode {
    constructor(id) {
        super({});
        this.id = id;
        this.value = '';
        this.hidden = false;
        this.textContent = id === 'explorer-data' ? dataText : '';
        this._html = '';
        this.cache = new Map();
    }
    set innerHTML(value) {
        this._html = String(value);
        this.cache.clear();
    }
    get innerHTML() {
        return this._html;
    }
    querySelectorAll(selector) {
        const attrMatch = selector.match(/^\[data-([a-z0-9-]+)\]$/) ||
            selector.match(/^[a-z]+\[data-([a-z0-9-]+)\]$/);
        if (!attrMatch) return [];

        const key = attrMatch[1];
        if (!this.cache.has(key)) {
            this.cache.set(key, nodesWithDataAttribute(this._html, key));
        }
        return this.cache.get(key);
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
}

const elements = new Map();
global.document = {
    getElementById(id) {
        if (!elements.has(id)) elements.set(id, new FakeElement(id));
        return elements.get(id);
    },
};

new Function(scriptMatch[1])();

const corpusView = document.getElementById('corpusView');
const staticHeader = corpusView.querySelectorAll('[data-sort-key]')
    .find(node => node.dataset.sortKey === 'corpus_metrics.objects.static');
if (!staticHeader) throw new Error('static corpus header missing');
if (!/No solver-active rule can move/.test(staticHeader.title || '')) {
    throw new Error('static corpus header description tooltip missing');
}
staticHeader.click();

const firstGame = (corpusView.innerHTML.match(/data-game="([^"]+)"[^>]*data-cell-kind="game"/) || [])[1];
if (!firstGame) throw new Error('first corpus game cell missing');

const maxStatic = Math.max(...model.games.map(game => game.corpus_metrics.objects.static));
const firstGameModel = model.games.find(game => game.source_path === firstGame);
if (!firstGameModel) throw new Error('first corpus game not found in model');
if (firstGameModel.corpus_metrics.objects.static !== maxStatic) {
    throw new Error(`corpus header sort failed: first static ${firstGameModel.corpus_metrics.objects.static}, max ${maxStatic}`);
}

const firstGameCell = corpusView.querySelectorAll('[data-game]')
    .find(node => node.dataset.game === firstGame && node.dataset.cellKind === 'game');
if (!firstGameCell) throw new Error('first corpus game click target missing');
firstGameCell.click();

const gameView = document.getElementById('gameView');
const reportHeader = gameView.querySelectorAll('[data-report-sort-key]')
    .find(node => node.dataset.reportSortKey === 'rule_count');
if (!reportHeader) throw new Error('object report rule_count sort header missing');

const cosmeticHeader = gameView.querySelectorAll('[data-report-sort-key]')
    .find(node => node.dataset.reportSortKey === 'cosmetic');
if (!cosmeticHeader) throw new Error('object cosmetic report header missing');
if (!/Object is not read by any win condition/.test(cosmeticHeader.title || '')) {
    throw new Error('object cosmetic report header description tooltip missing');
}

reportHeader.click();
if (!gameView.innerHTML.includes('report-shell')) throw new Error('game report shell missing');
if (!gameView.innerHTML.includes('sortable-table')) throw new Error('sortable table missing');
if (!gameView.querySelectorAll('[data-report-row]').length) throw new Error('report rows missing');
if (gameView.innerHTML.includes('object-matrix')) throw new Error('legacy object matrix still rendered');
if (!gameView.innerHTML.includes('sprite-thumb')) throw new Error('object sprite thumbnails missing');
if (!gameView.innerHTML.includes('boolean-badge yes')) throw new Error('boolean yes badge missing');
if (!gameView.innerHTML.includes('boolean-badge no')) throw new Error('boolean no badge missing');

console.log('static_analysis_explorer_runtime_smoke: ok');

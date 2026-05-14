#!/usr/bin/env node
'use strict';

const fs = require('fs');

const htmlPath = process.argv[2] || 'build/static-analysis-explorer/index.html';
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

class FakeNode {
    constructor(dataset = {}) {
        this.dataset = dataset;
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
        dataset[toDatasetKey(match[1])] = match[2]
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    }
    return dataset;
}

function nodesWithDataAttribute(htmlFragment, attribute) {
    const attr = attribute.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase());
    const nodes = [];
    const tagPattern = /<[^>]*\sdata-[a-z0-9-]+="[^"]*"[^>]*>/g;
    for (const match of htmlFragment.matchAll(tagPattern)) {
        if (new RegExp('\\sdata-' + attr + '="').test(match[0])) {
            nodes.push(new FakeNode(attrsToDataset(match[0])));
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

reportHeader.click();
if (!gameView.innerHTML.includes('report-shell')) throw new Error('game report shell missing');
if (!gameView.innerHTML.includes('sortable-table')) throw new Error('sortable table missing');
if (!gameView.querySelectorAll('[data-report-row]').length) throw new Error('report rows missing');
if (gameView.innerHTML.includes('object-matrix')) throw new Error('legacy object matrix still rendered');
if (!gameView.innerHTML.includes('sprite-thumb')) throw new Error('object sprite thumbnails missing');
if (!gameView.innerHTML.includes('boolean-badge yes')) throw new Error('boolean yes badge missing');
if (!gameView.innerHTML.includes('boolean-badge no')) throw new Error('boolean no badge missing');

console.log('static_analysis_explorer_runtime_smoke: ok');

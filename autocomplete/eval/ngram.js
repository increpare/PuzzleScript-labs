'use strict';
// Section-aware interpolated Kneser-Ney n-gram over whitespace tokens (newline is a token).
// One model per section; the highest order uses raw counts, lower orders continuation
// counts, with a single absolute discount. Plain Maps; big enough for the train split with
// a few GB of heap (run node with --max-old-space-size if needed).

const { lineSections } = require('../pipeline/context.js');

const DISCOUNT = 0.75;
const SEP = '\u0001';
const NL = '\n';

function tokenize(text) {
    const lines = text.split('\n');
    const secs = lineSections(text);
    const tokens = [];
    const sections = [];
    for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/).filter(Boolean);
        for (const p of parts) { tokens.push(p); sections.push(secs[i]); }
        if (i < lines.length - 1) { tokens.push(NL); sections.push(secs[i]); }
    }
    return { tokens, sections };
}

function detokenize(tokens) {
    let out = '';
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === NL) { out += NL; continue; }
        if (out.length && !out.endsWith(NL)) out += ' ';
        out += t;
    }
    return out;
}

class SectionModel {
    constructor(order) {
        this.order = order;
        // counts[n]: Map<historyKey, Map<token, count>> for n-grams (history = n-1 tokens)
        this.counts = [];
        for (let n = 0; n <= order; n++) this.counts.push(new Map());
        this.cont = [];     // continuation counts for orders 1..order-1, same shape
        this.totals = [];   // per order: Map<historyKey, {sum, distinct}>
        this.finalized = false;
    }
    static key(history, n) {
        if (n <= 1) return '';
        const h = history.length >= n - 1 ? history.slice(history.length - (n - 1)) : null;
        return h === null ? null : h.join(SEP);
    }
    addSequence(tokens) {
        const padded = ['<s>', ...tokens];
        for (let i = 1; i < padded.length; i++) {
            for (let n = 1; n <= this.order; n++) {
                if (i - (n - 1) < 0) break;
                const h = n === 1 ? '' : padded.slice(i - (n - 1), i).join(SEP);
                let m = this.counts[n].get(h);
                if (!m) { m = new Map(); this.counts[n].set(h, m); }
                m.set(padded[i], (m.get(padded[i]) || 0) + 1);
            }
        }
    }
    finalize() {
        // Continuation counts: cont[n-1][h'][w] = number of distinct u such that (u h' w) was seen.
        this.cont = [];
        for (let n = 0; n <= this.order; n++) this.cont.push(new Map());
        for (let n = this.order; n >= 2; n--) {
            // From RAW counts at every order: tokens near a sequence start only exist in
            // the lower-order raw tables, so deriving from cont[n] would lose them.
            const src = this.counts[n];
            for (const [h, m] of src) {
                const idx = h.indexOf(SEP);
                const shorter = idx < 0 ? '' : h.slice(idx + 1);
                let target = this.cont[n - 1].get(shorter);
                if (!target) { target = new Map(); this.cont[n - 1].set(shorter, target); }
                for (const w of m.keys()) target.set(w, (target.get(w) || 0) + 1);
            }
        }
        this.totals = [];
        for (let n = 0; n <= this.order; n++) this.totals.push(new Map());
        for (let n = 1; n <= this.order; n++) {
            const src = n === this.order ? this.counts[n] : this.cont[n];
            for (const [h, m] of src) {
                let sum = 0;
                for (const c of m.values()) sum += c;
                this.totals[n].set(h, { sum, distinct: m.size });
            }
        }
        const uni = this.counts[1].get('') || new Map();
        this.vocabSize = Math.max(1, uni.size);
        this.finalized = true;
    }
    table(n) { return n === this.order ? this.counts[n] : this.cont[n]; }
    vocab() {
        const uni = this.counts[1].get('');
        return uni ? [...uni.keys()] : [];
    }
    prob(history, w) {
        let p = 1 / this.vocabSize; // order 0: uniform
        for (let n = 1; n <= this.order; n++) {
            const key = SectionModel.key(history, n);
            if (key === null) break;
            const m = this.table(n).get(key);
            if (!m) continue; // unseen history at this order: keep lower-order estimate
            const t = this.totals[n].get(key);
            const c = m.get(w) || 0;
            p = Math.max(c - DISCOUNT, 0) / t.sum + (DISCOUNT * t.distinct / t.sum) * p;
        }
        return p;
    }
    // Candidate followers of the history at any order (raw counts), optionally filtered by prefix.
    candidates(history, prefix) {
        const set = new Set();
        for (let n = this.order; n >= 2; n--) {
            const key = SectionModel.key(history, n);
            if (key === null) continue;
            const m = this.counts[n].get(key);
            if (m) for (const w of m.keys()) set.add(w);
        }
        let list = [...set];
        if (prefix) {
            const lp = prefix.toLowerCase();
            list = list.filter(w => w.toLowerCase().startsWith(lp) && w.length > prefix.length);
            if (list.length === 0) list = this.vocab().filter(w => w.toLowerCase().startsWith(lp) && w.length > prefix.length);
        } else if (list.length === 0) {
            list = this.vocab();
        }
        return list;
    }
}

class KneserNey {
    constructor(order = 5) {
        this.order = order;
        this.models = new Map();
        this.finalized = false;
    }
    model(section) {
        if (!this.models.has(section)) this.models.set(section, new SectionModel(this.order));
        return this.models.get(section);
    }
    train(text) {
        const { tokens, sections } = tokenize(text);
        // Each section's token run is one sequence for that section's model.
        let start = 0;
        for (let i = 1; i <= tokens.length; i++) {
            if (i === tokens.length || sections[i] !== sections[start]) {
                this.model(sections[start]).addSequence(tokens.slice(start, i));
                start = i;
            }
        }
    }
    finalize() {
        for (const m of this.models.values()) m.finalize();
        this.finalized = true;
    }
    sectionModel(section) {
        return this.models.get(section) || this.models.get('rules') || [...this.models.values()][0];
    }
    vocab(section) { return this.sectionModel(section).vocab(); }
    prob(section, history, w) { return this.sectionModel(section).prob(history, w); }
    predictNext(section, history, prefix) {
        const m = this.sectionModel(section);
        const list = m.candidates(history, prefix);
        if (list.length === 0) return null;
        let best = null, bestP = -1;
        for (const w of list) {
            const p = m.prob(history, w);
            if (p > bestP) { bestP = p; best = w; }
        }
        return { token: best, prob: bestP };
    }
    generate(section, history, { stop = 'line', maxTokens = 40, prefix = null } = {}) {
        const hist = history.slice();
        const out = [];
        for (let step = 0; step < maxTokens; step++) {
            const next = this.predictNext(section, hist, step === 0 ? prefix : null);
            if (!next) break;
            const tok = next.token;
            if (stop === 'line' && tok === NL) break;
            if (stop === 'block' && tok === NL && out.length && out[out.length - 1] === NL) break;
            out.push(tok);
            hist.push(tok);
        }
        while (out.length && out[out.length - 1] === NL) out.pop();
        return { tokens: out, text: detokenize(out) };
    }
    sequenceLogProb(section, history, tokens) {
        const hist = history.slice();
        let lp = 0;
        for (const t of tokens) {
            lp += Math.log(this.prob(section, hist, t));
            hist.push(t);
        }
        return lp;
    }
}

module.exports = { KneserNey, SectionModel, tokenize, detokenize, NL };

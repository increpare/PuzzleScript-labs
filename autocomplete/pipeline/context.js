'use strict';
// The ONE context builder shared by training (build_samples.js), the eval harness and
// the editor. No dependencies: symbols are passed in (see symbols.js for the two ways
// to get them). Everything here is plain string work so it runs in a browser too.
//
// Contract
//   buildContext({text, from, to, symbols, config}) ->
//     {header, prefix, suffix, target, sectionAtCursor, prefixLines, suffixLines, targetLines}
//   - text: the whole document. [from, to) is the replacement range; from === to is a
//     pure insertion. For training and eval, [from, to) is the target to predict.
//   - The target is removed FIRST. The symbol header and the suffix are built from the
//     document without it, so a header can never leak a name the target declares.
//   - symbols: {objects, legend, sfx} or a function (docWithoutTarget) -> that shape.
//   - Levels are trimmed to the first config.keepLevels level blocks plus every message
//     line, except that the block containing the cursor is always kept.
//   - prefix: up to config.prefixLines lines ending at the cursor, in SOURCE order.
//     suffix: up to config.suffixLines lines starting at the cursor, in source order.
//   - Budget: header first, then suffix (capped at a third of what remains so a long
//     suffix cannot starve the prefix), then prefix fills what is left of
//     config.maxChars; the prefix is trimmed from its far (earliest) end.
//   - sectionAtCursor is the section of the target's first line in the original text
//     when there is a target, otherwise the section at the cursor.
//   render(ctx, mode, weightFn) -> {text, spans}
//   - mode 'psm': <SYM>header<PRE>prefix<SUF>suffix<MID>target<EOS>
//   - mode 'spm': <SYM>header<PRE><SUF>suffix<MID>prefix target<EOS>
//   - spans: contiguous {start, end, kind, section, line, weight} covering the text.
//     kind is marker | header | prefix | suffix | target; markers and header weigh 0.
//   - Generation stops at <EOS>; the caller cuts at the first newline for line tasks
//     and at a blank line for block tasks.

const SECTION_NAMES = ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'];
const SECTION_SET = new Set(SECTION_NAMES);

// maxChars must keep the rendered prompt under the model's 2048-token context with room
// to generate: with the 8k BPE (about 2.7 chars per token, under 2 on dense files) 6000
// chars overran it on long games; 4000 fits. Keep configs/context.json in step.
const DEFAULT_CONFIG = {
    prefixLines: 120,
    suffixLines: 40,
    maxChars: 4000,
    keepLevels: 3,
};

const MARK = { sym: '<SYM>', pre: '<PRE>', suf: '<SUF>', mid: '<MID>', eos: '<EOS>' };

// Section name for every line of the text (same length as text.split('\n')).
function lineSections(text) {
    const lines = text.split('\n');
    const out = new Array(lines.length);
    let section = 'prelude';
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim().toLowerCase();
        if (SECTION_SET.has(trimmed)) section = trimmed;
        out[i] = section;
    }
    return out;
}

// Level blocks in the LEVELS section: [{startLine, endLine (exclusive), isMessage}], where a
// block is a run of non-blank lines. The trailing blank line(s) belong to the block.
function levelBlocks(lines, sections) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        if (sections[i] !== 'levels' || lines[i].trim() === '' || lines[i].trim().toLowerCase() === 'levels' || /^=+$/.test(lines[i].trim())) { i++; continue; }
        const start = i;
        let allMessage = true;
        while (i < lines.length && sections[i] === 'levels' && lines[i].trim() !== '') {
            if (!/^\s*message\b/i.test(lines[i])) allMessage = false;
            i++;
        }
        let end = i;
        while (end < lines.length && sections[end] === 'levels' && lines[end].trim() === '') end++;
        blocks.push({ startLine: start, endLine: end, isMessage: allMessage });
        i = end;
    }
    return blocks;
}

// Returns {text, map} where map(offset) translates an offset in the original text to the
// trimmed text. Offsets inside a removed block are clamped to the block's start.
function trimLevels(text, { keep = DEFAULT_CONFIG.keepLevels, protectFrom = -1, protectTo = -1 } = {}) {
    const lines = text.split('\n');
    const sections = lineSections(text);
    const starts = new Array(lines.length);
    let pos = 0;
    for (let i = 0; i < lines.length; i++) { starts[i] = pos; pos += lines[i].length + 1; }
    const lineStart = i => starts[i];
    const lineEnd = i => (i < lines.length ? starts[i] + lines[i].length + (i < lines.length - 1 ? 1 : 0) : text.length);

    const removed = [];
    let kept = 0;
    for (const b of levelBlocks(lines, sections)) {
        if (b.isMessage) continue;
        const bStart = lineStart(b.startLine), bEnd = lineEnd(b.endLine - 1);
        const protectedBlock = protectFrom >= 0 && protectFrom < bEnd && protectTo >= bStart;
        if (kept < keep || protectedBlock) { kept++; continue; }
        removed.push([bStart, bEnd]);
    }
    if (removed.length === 0) return { text, map: o => o, removed };

    let out = '';
    let cursor = 0;
    for (const [s, e] of removed) { out += text.slice(cursor, s); cursor = e; }
    out += text.slice(cursor);
    const map = offset => {
        let shift = 0;
        for (const [s, e] of removed) {
            if (offset >= e) shift += e - s;
            else if (offset > s) { shift += offset - s; break; }
            else break;
        }
        return offset - shift;
    };
    return { text: out, map, removed };
}

function renderHeader(symbols) {
    if (!symbols) return '';
    const parts = [];
    if (symbols.objects && symbols.objects.length) parts.push('objects ' + symbols.objects.join(' '));
    if (symbols.legend && symbols.legend.length) parts.push('legend ' + symbols.legend.join(' '));
    if (symbols.sfx && symbols.sfx.length) parts.push('sfx ' + symbols.sfx.join(' '));
    if (parts.length === 0) return '';
    return MARK.sym + '\n' + parts.join('\n') + '\n';
}

// Split text into lines that keep their newline, so joining reproduces the text exactly.
function splitKeep(text) {
    if (text === '') return [];
    const out = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') { out.push(text.slice(start, i + 1)); start = i + 1; }
    }
    if (start < text.length) out.push(text.slice(start));
    return out;
}

function buildContext({ text, from, to, symbols, config }) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
    if (to === undefined) to = from;
    const target = text.slice(from, to);
    const doc = text.slice(0, from) + text.slice(to);
    const symbolTable = typeof symbols === 'function' ? symbols(doc) : symbols;
    const header = renderHeader(symbolTable);

    const trimmed = trimLevels(doc, { keep: cfg.keepLevels, protectFrom: from, protectTo: from });
    const tdoc = trimmed.text;
    const cursor = trimmed.map(from);
    const sections = lineSections(tdoc);
    const lineIndexAt = offset => tdoc.slice(0, offset).split('\n').length - 1;
    const cursorLine = lineIndexAt(cursor);
    // Section of the target's first line in the ORIGINAL text when there is a target (a
    // target that starts with a section header belongs to that section), else of the cursor.
    const origSections = lineSections(text);
    const targetStartLine = text.slice(0, from).split('\n').length - 1;
    const sectionAtCursor = (to > from ? origSections[targetStartLine] : sections[cursorLine]) || 'prelude';

    // Prefix lines: the partial current line is the last prefix line. When the cursor sits
    // at a line start, `before` ends with a newline and the last prefix line is cursorLine-1.
    const before = tdoc.slice(0, cursor);
    let prefixLines = splitKeep(before);
    const lastPrefixLine = before.endsWith('\n') ? cursorLine - 1 : cursorLine;
    let prefixSections = prefixLines.map((_, i) => sections[lastPrefixLine - (prefixLines.length - 1 - i)] || 'prelude');
    if (prefixLines.length > cfg.prefixLines) {
        prefixLines = prefixLines.slice(-cfg.prefixLines);
        prefixSections = prefixSections.slice(-cfg.prefixLines);
    }
    const after = tdoc.slice(cursor);
    let suffixLines = splitKeep(after);
    let suffixSections = suffixLines.map((_, i) => sections[cursorLine + i] || sections[sections.length - 1]);
    if (suffixLines.length > cfg.suffixLines) {
        suffixLines = suffixLines.slice(0, cfg.suffixLines);
        suffixSections = suffixSections.slice(0, cfg.suffixLines);
    }

    // Char budget: header, then suffix (capped to a third), then prefix from the far end.
    let budget = cfg.maxChars - header.length;
    let suffixChars = suffixLines.reduce((a, l) => a + l.length, 0);
    const suffixCap = Math.floor(budget / 3);
    while (suffixChars > suffixCap && suffixLines.length > 0) {
        suffixChars -= suffixLines[suffixLines.length - 1].length;
        suffixLines.pop();
        suffixSections.pop();
    }
    budget -= suffixChars;
    let prefixChars = prefixLines.reduce((a, l) => a + l.length, 0);
    while (prefixChars > budget && prefixLines.length > 0) {
        prefixChars -= prefixLines[0].length;
        prefixLines.shift();
        prefixSections.shift();
    }

    // Target lines with their sections (from the original text).
    const targetLines = splitKeep(target);
    const targetSections = targetLines.map((_, i) => origSections[targetStartLine + i] || 'prelude');

    return {
        header,
        prefix: prefixLines.join(''),
        suffix: suffixLines.join(''),
        target,
        sectionAtCursor,
        prefixLines: prefixLines.map((line, i) => ({ line, section: prefixSections[i] })),
        suffixLines: suffixLines.map((line, i) => ({ line, section: suffixSections[i] })),
        targetLines: targetLines.map((line, i) => ({ line, section: targetSections[i] })),
    };
}

function defaultWeight() { return 1; }

function render(ctx, mode = 'psm', weightFn = defaultWeight) {
    const spans = [];
    let text = '';
    const push = (piece, kind, section, line) => {
        if (piece === '') return;
        const weight = (kind === 'marker' || kind === 'header') ? 0 : weightFn(section, kind, line);
        spans.push({ start: text.length, end: text.length + piece.length, kind, section, line: line === undefined ? null : line.replace(/\n$/, ''), weight });
        text += piece;
    };
    const pushLines = (lines, kind) => { for (const { line, section } of lines) push(line, kind, section, line); };
    const marker = m => push(m, 'marker', 'marker');

    if (ctx.header) push(ctx.header, 'header', 'header');
    if (mode === 'spm') {
        marker(MARK.pre); marker(MARK.suf);
        pushLines(ctx.suffixLines, 'suffix');
        marker(MARK.mid);
        pushLines(ctx.prefixLines, 'prefix');
        pushLines(ctx.targetLines, 'target');
    } else {
        marker(MARK.pre);
        pushLines(ctx.prefixLines, 'prefix');
        marker(MARK.suf);
        pushLines(ctx.suffixLines, 'suffix');
        marker(MARK.mid);
        pushLines(ctx.targetLines, 'target');
    }
    marker(MARK.eos);
    return { text, spans };
}

// Prompt only (no target), for inference: everything up to and including <MID>.
function renderPrompt(ctx, mode = 'psm') {
    const full = render(Object.assign({}, ctx, { targetLines: [] }), mode);
    return full.text.slice(0, full.text.length - MARK.eos.length);
}

const CONTEXT_EXPORTS = { buildContext, render, renderPrompt, renderHeader, trimLevels, lineSections, levelBlocks, splitKeep, DEFAULT_CONFIG, MARK, SECTION_NAMES };
// Node (pipeline, eval) and the browser (editor, worker) load this same file.
if (typeof module !== 'undefined' && module.exports) module.exports = CONTEXT_EXPORTS;
else globalThis.PuzzleScriptAutocompleteContext = Object.freeze(CONTEXT_EXPORTS);

'use strict';
// Small text helpers shared by the pipeline. No dependencies.

const SECTION_NAMES = ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'];
const SECTION_SET = new Set(SECTION_NAMES);

// Remove PuzzleScript comments. They nest and may span lines.
function stripComments(text) {
    let out = '';
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') { depth++; continue; }
        if (ch === ')') { if (depth > 0) depth--; continue; }
        if (depth === 0) out += ch;
    }
    return out;
}

// First whitespace-separated word of a line, lowercased, comments already stripped.
function firstWord(line) {
    const t = line.trim();
    return t === '' ? '' : t.split(/\s+/)[0].toLowerCase();
}

function isSectionHeader(line) {
    return SECTION_SET.has(firstWord(line)) && line.trim().toLowerCase() === firstWord(line);
}

// Titles that say nothing about which game this is.
const GENERIC_TITLES = new Set([
    '', 'my game', 'game', 'test', 'untitled', 'puzzle', 'puzzles', 'simple block pushing game',
    'block pushing game', 'new game', 'puzzlescript', 'sokoban', 'demo', 'blank', 'blank template',
    'title', 'my first game', 'hello world', 'first game', 'a game', 'the game', 'game title',
]);

function normaliseTitle(title) {
    return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleOf(text) {
    const m = /^\s*title\s+(.*)$/im.exec(stripComments(text));
    return m ? m[1].trim() : '';
}

module.exports = { stripComments, firstWord, isSectionHeader, SECTION_NAMES, SECTION_SET, GENERIC_TITLES, normaliseTitle, titleOf };

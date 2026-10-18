'use strict';
// Symbol table for the context header. Two entry points with one output shape:
//   symbolsFromParserState(state)  pure; the editor feeds it the streaming parser state it already has
//   extractSymbols(text)           Node only; parses the text with the engine's streaming parser
// Output: {objects: [...], legend: [...], sfx: [...]} in declaration order. Objects keep their
// original casing; legend names are lowercase because the streaming parser lowercases the
// line before recording them (original_case_names only covers objects).

const path = require('path');

function cased(state, name) {
    return (state.original_case_names && state.original_case_names[name]) || name;
}

function symbolsFromParserState(state) {
    const objects = Object.keys(state.objects || {}).map(n => cased(state, n));
    const legend = [];
    for (const list of [state.legend_synonyms, state.legend_aggregates, state.legend_properties]) {
        for (const entry of list || []) {
            if (Array.isArray(entry) && entry.length) legend.push(cased(state, entry[0]));
        }
    }
    const sfx = [];
    for (const row of state.sounds || []) {
        const first = Array.isArray(row) && Array.isArray(row[0]) ? row[0][0] : null;
        const m = first && /^sfx(\d+)$/i.exec(first);
        if (m && !sfx.includes(m[1])) sfx.push(m[1]);
    }
    return { objects, legend, sfx };
}

let canonicalize = null;
function extractSymbols(text) {
    if (!canonicalize) canonicalize = require(path.resolve(__dirname, '..', '..', 'src', 'canonicalize.js'));
    const parsed = canonicalize.parseSourceState(text);
    return symbolsFromParserState(parsed.state || {});
}

module.exports = { symbolsFromParserState, extractSymbols };

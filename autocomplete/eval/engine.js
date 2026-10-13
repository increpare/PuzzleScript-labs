'use strict';
// Node access to the pieces of the editor the eval harness needs: the streaming parser
// state at a cursor and the deterministic completer (src/js/puzzlescript-autocomplete.js),
// loaded into the same vm context the compile pipeline uses.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
let loaded = false;
let canonicalize = null;

const HELPER = `
globalThis.__ps_ac_eval = (function() {
    const ABORT = "Too many errors/warnings; aborting compilation.";
    // Parser state after the complete lines before the cursor's line, then the cursor
    // line tokenised up to the cursor column (the same thing the CM6 plugin does).
    function stateAtCursor(text, offset) {
        resetParserErrorState();
        compiling = true;
        const processor = new codeMirrorFn();
        const state = processor.startState();
        const lines = text.split('\\n');
        let pos = 0, lineIndex = 0;
        while (lineIndex < lines.length && pos + lines[lineIndex].length + 1 <= offset) {
            pos += lines[lineIndex].length + 1;
            lineIndex++;
        }
        if (lineIndex >= lines.length) { lineIndex = lines.length - 1; pos = text.length - lines[lineIndex].length; }
        const column = offset - pos;
        let token = { start: column, end: column, string: '' };
        try {
            for (let i = 0; i < lineIndex; i++) {
                const ss = new CodeMirror.StringStream(lines[i], 4);
                do { processor.token(ss, state); } while (ss.eol() === false);
            }
            const ss = new CodeMirror.StringStream(lines[lineIndex], 4);
            while (ss.pos < column && !ss.eol()) {
                ss.start = ss.pos; // CodeMirror does this before every token call
                processor.token(ss, state);
                token = { start: ss.start, end: ss.pos, string: ss.current() };
            }
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            if (message !== ABORT) throw error;
        } finally {
            compiling = false;
        }
        return {
            state: state,
            token: token,
            line: lines[lineIndex],
            previousLine: lineIndex > 0 ? lines[lineIndex - 1] : '',
            cursor: column,
            lineStart: pos,
        };
    }
    function completeAt(text, offset) {
        const at = stateAtCursor(text, offset);
        const result = PuzzleScriptAutocomplete.complete({
            line: at.line, previousLine: at.previousLine, cursor: at.cursor, token: at.token, state: at.state,
        });
        return {
            from: at.lineStart + result.from,
            to: at.lineStart + result.to,
            section: at.state.section || 'prelude',
            list: (result.list || []).map(item => (typeof item === 'string' ? { text: item } : { text: item.text, extra: item.extra || '', tag: item.tag || null })),
        };
    }
    return { stateAtCursor, completeAt };
})();
`;

function ensureLoaded() {
    if (loaded) return;
    canonicalize = require(path.join(REPO, 'src', 'canonicalize.js'));
    for (const rel of ['js/codemirror/rule-transform.js', 'js/puzzlescript-autocomplete.js']) {
        const code = fs.readFileSync(path.join(REPO, 'src', rel), 'utf8');
        canonicalize.evalInRuntime(code, rel);
    }
    canonicalize.evalInRuntime(HELPER, 'autocomplete_eval_helper.js');
    loaded = true;
}

function stateAtCursor(text, offset) {
    ensureLoaded();
    return canonicalize.evalInRuntime('__ps_ac_eval').stateAtCursor(text, offset);
}

// Deterministic completer at an offset: {from, to, section, list: [{text, extra, tag}]}.
// Offsets are document offsets.
function completeAt(text, offset) {
    ensureLoaded();
    // JSON round-trip: values created inside the vm context have their own Array/Object
    // prototypes, which trips deepStrictEqual and friends on the host side.
    return JSON.parse(JSON.stringify(canonicalize.evalInRuntime('__ps_ac_eval').completeAt(text, offset)));
}

function validateCompileSource(text) {
    ensureLoaded();
    return canonicalize.validateCompileSource(text);
}

module.exports = { stateAtCursor, completeAt, validateCompileSource };

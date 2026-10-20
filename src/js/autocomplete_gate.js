// Gate for model-generated PuzzleScript completions. Shared by the editor (ghost text)
// and the eval harness, so the shipped filter and the measured filter are one piece of
// code. No DOM. Needs the engine's parser globals (codeMirrorFn, compiling, errorCount,
// errorStrings, consolePrint) and a CodeMirror-style StringStream constructor.
//
//   PuzzleScriptAutocompleteGate.parseIsolated(text, StringStream)
//     -> {state, errorCount, aborted}   fresh parser state over the whole text, errors
//        captured and the live editor's error state restored afterwards
//   PuzzleScriptAutocompleteGate.check({text, from, to, candidate, StringStream, baseline})
//     -> {ok, reason}   candidate spliced in at [from, to); rejected only for NEW parser
//        errors against `baseline` (parseIsolated of the document without the candidate),
//        bracket imbalance on the candidate line, unequal cell counts across ->,
//        or (in RULES, COLLISIONLAYERS, WINCONDITIONS, SOUNDS) a reference to an
//        undeclared name. OBJECTS and LEGEND may declare new names.
(function() {
    "use strict";

    const ABORT_MESSAGE = /Too many errors\/warnings/;
    const SECTION_NAMES = ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'];
    const REFERENCE_SECTIONS = new Set(['rules', 'collisionlayers', 'winconditions', 'sounds']);
    const KEYWORDS = new Set([
        'up', 'down', 'left', 'right', 'horizontal', 'vertical', 'orthogonal', 'parallel', 'perpendicular',
        'moving', 'stationary', 'no', 'randomdir', 'random', 'action', 'late', 'rigid', 'startloop', 'endloop',
        'checkpoint', 'again', 'cancel', 'restart', 'win', 'message', 'on', 'or', 'and', 'some', 'all', 'any',
        'global', 'move', 'create', 'destroy', 'cantmove', 'undo', 'titlescreen', 'startgame', 'endgame',
        'startlevel', 'endlevel', 'showmessage', 'closemessage', 'background', 'player', 'mouse', 'ltr',
        'rtl', 'ttb', 'btt', 'interact'
    ]);

    function sectionAt(text, offset) {
        let section = 'prelude';
        for (const line of text.slice(0, offset).split('\n')) {
            const t = line.trim().toLowerCase();
            if (SECTION_NAMES.includes(t)) section = t;
        }
        return section;
    }

    // Runs the streaming parser over `text` in a fresh state with error capture. The
    // editor's own compile state (errorCount/errorStrings) is saved and put back, and
    // console output is muted for the duration, so this never touches the live editor.
    function parseIsolated(text, StringStream) {
        const savedCompiling = compiling, savedCount = errorCount, savedStrings = errorStrings;
        const savedPrint = globalThis.consolePrint;
        globalThis.consolePrint = function() {};
        errorStrings = [];
        errorCount = 0;
        compiling = true;
        const processor = codeMirrorFn();
        const state = processor.startState();
        let aborted = false;
        try {
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const ss = new StringStream(lines[i], 4);
                if (ss.eol()) { if (processor.blankLine) processor.blankLine(state); continue; }
                while (!ss.eol()) {
                    ss.start = ss.pos;
                    processor.token(ss, state);
                    if (ss.pos === ss.start) ss.pos++;
                }
            }
        } catch (error) {
            aborted = true;
            const message = error && error.message ? error.message : String(error);
            if (!ABORT_MESSAGE.test(message)) errorCount++;
        }
        const result = { state, errorCount, aborted };
        compiling = savedCompiling;
        errorCount = savedCount;
        errorStrings = savedStrings;
        globalThis.consolePrint = savedPrint;
        return result;
    }

    function stripComments(line) {
        let out = '', depth = 0;
        for (const ch of line) {
            if (ch === '(') depth++;
            else if (ch === ')') { if (depth > 0) depth--; }
            else if (depth === 0) out += ch;
        }
        return out;
    }

    function bracketsBalanced(line) {
        let depth = 0;
        for (const ch of stripComments(line)) {
            if (ch === '[') depth++;
            else if (ch === ']') { depth--; if (depth < 0) return false; }
        }
        return depth === 0;
    }

    // In RULES: corresponding brackets on both sides of -> hold the same number of cells.
    function cellCountsMatch(line) {
        const code = stripComments(line);
        const arrow = code.indexOf('->');
        if (arrow < 0) return true;
        const count = side => (side.match(/\[[^\]]*\]/g) || []).map(b => b.split('|').length);
        const lhs = count(code.slice(0, arrow)), rhs = count(code.slice(arrow + 2));
        if (rhs.length === 0) return true;          // "[ ... ] -> message foo" style
        if (lhs.length !== rhs.length) return false;
        for (let i = 0; i < lhs.length; i++) if (lhs[i] !== rhs[i]) return false;
        return true;
    }

    function declaredNames(state) {
        const names = new Set();
        for (const n of Object.keys(state.objects || {})) names.add(n.toLowerCase());
        for (const list of [state.legend_synonyms, state.legend_aggregates, state.legend_properties]) {
            for (const entry of list || []) if (Array.isArray(entry) && entry.length) names.add(String(entry[0]).toLowerCase());
        }
        return names;
    }

    function isWordOk(w, names) {
        if (KEYWORDS.has(w) || names.has(w)) return true;
        if (/^sfx\d+$/.test(w)) return true;
        if (/^[\^v<>]/.test(w) && names.has(w.slice(1))) return true;
        return false;
    }

    function referencesResolve(candidateLine, section, names) {
        const code = stripComments(candidateLine).toLowerCase();
        if (section === 'sounds') {
            for (const w of code.split(/\s+/).filter(Boolean)) {
                if (/^\d+$/.test(w) || isWordOk(w, names)) continue;
                return { ok: false, reason: 'unknown name ' + w };
            }
            return { ok: true };
        }
        if (section === 'winconditions') {
            for (const w of code.split(/\s+/).filter(Boolean)) {
                if (isWordOk(w, names)) continue;
                return { ok: false, reason: 'unknown name ' + w };
            }
            return { ok: true };
        }
        if (section === 'collisionlayers') {
            for (const w of code.split(/[\s,]+/).filter(Boolean)) {
                if (names.has(w)) continue;
                return { ok: false, reason: 'unknown name ' + w };
            }
            return { ok: true };
        }
        // rules: a message command takes free text, everything else must resolve
        const msg = code.indexOf('message');
        const body = (msg >= 0 ? code.slice(0, msg) : code).replace(/->/g, ' ').replace(/\.\.\./g, ' ');
        for (const w of body.split(/[\s\[\]|]+/).filter(Boolean)) {
            if (w === '+' || w === '^' || w === 'v' || w === '<' || w === '>') continue;
            if (isWordOk(w, names)) continue;
            return { ok: false, reason: 'unknown name ' + w };
        }
        return { ok: true };
    }

    // text: whole document; [from, to) is replaced by candidate (usually from === to).
    function check({ text, from, to, candidate, StringStream, baseline }) {
        if (to === undefined) to = from;
        if (!candidate || candidate.trim() === '') return { ok: false, reason: 'empty' };
        const section = sectionAt(text, from);
        const spliced = text.slice(0, from) + candidate + text.slice(to);
        const lineStart = spliced.lastIndexOf('\n', from - 1) + 1;
        const lineEndRaw = spliced.indexOf('\n', from + candidate.length);
        const lineEnd = lineEndRaw < 0 ? spliced.length : lineEndRaw;
        const candidateLine = spliced.slice(lineStart, lineEnd);

        if (section === 'rules') {
            if (!bracketsBalanced(candidateLine)) return { ok: false, reason: 'brackets' };
            if (!cellCountsMatch(candidateLine)) return { ok: false, reason: 'cell count' };
        }

        const base = baseline || parseIsolated(text, StringStream);
        const after = parseIsolated(spliced, StringStream);
        if (after.aborted && !base.aborted) return { ok: false, reason: 'parser abort' };
        if (after.errorCount > base.errorCount) return { ok: false, reason: 'new parse errors' };

        if (REFERENCE_SECTIONS.has(section)) {
            const resolved = referencesResolve(candidateLine, section, declaredNames(base.state));
            if (!resolved.ok) return resolved;
        }
        return { ok: true, section };
    }

    const exportsObject = { parseIsolated, check, bracketsBalanced, cellCountsMatch, sectionAt, stripComments };
    if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
    globalThis.PuzzleScriptAutocompleteGate = Object.freeze(exportsObject);
})();

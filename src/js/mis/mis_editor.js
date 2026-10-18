// MIS's two independent CodeMirror 6 views. Reuses the main editor's runtime,
// PuzzleScript parser, token presentation, completions, search and key bindings.
(function () {
	'use strict';
	const R = PuzzleScriptCM6Runtime, P = PuzzleScriptCM6Plugins;
	const { createPuzzleScriptLanguage } = P.require('stream-language');
	const { exactPrefixExtensions } = P.require('exact-prefix');
	const { tokenPresentation } = P.require('token-presentation');
	const { puzzleScriptCompletionSource, puzzleScriptCompletionKeymap } = P.require('autocomplete');
	const { puzzleScriptCommandExtensions, puzzleScriptCoreKeymap, puzzleScriptKeymap } = P.require('commands');
	const { puzzleScriptSearch, puzzleScriptSearchKeymap } = P.require('search');

	function transformParser(source) {
		const parser = codeMirrorFn(), seed = parser.startState();
		// Parse the game's real definitions with the same parser used by the main
		// editor, stopping at RULES. Transform names and properties come from here.
		for (const line of source.split(/\r\n?|\n/)) {
			const stream = new R.StringStream(line, 4);
			if (stream.eol()) parser.blankLine(seed);
			while (!stream.eol()) { stream.start = stream.pos; parser.token(stream, seed); }
			if (seed.section === 'rules') break;
		}
		seed.section = 'rules'; seed.lineNumber = 0;
		return {
			...parser,
			startState() { return parser.copyState(seed); },
			copyState(state) { return Object.assign(parser.copyState(state), { misLineStart: state.misLineStart }); },
			token(stream, state) {
				if (stream.sol()) state.misLineStart = true;
				if (!state.commentLevel && !state.inside_cell) {
					if (stream.eatSpace()) return null;
					if (stream.match(/^(?:choose|option|or)\b/i)) return 'LOGICWORD';
					if (stream.match(/^\d+(?:-\d+|\.\d+)?\b/)) return 'number';
				}
				// Let the original parser initialize the rule after MIS's prefix.
				const sol = stream.sol, ruleStart = stream.pos;
				if (state.misLineStart) stream.sol = () => stream.pos === ruleStart;
				try { return parser.token(stream, state); }
				finally { stream.sol = sol; state.misLineStart = false; }
			}
		};
	}

	function transformCompletions(input) {
		const result = PuzzleScriptAutocomplete.complete(input);
		if (input.state.commentLevel > 0 || input.state.inside_cell) return result;
		const word = input.line.slice(0, input.cursor).match(/[\w]+$/);
		if (!word) return result;
		const keywords = ['choose', 'option', 'or'].filter(k => k.startsWith(word[0].toLowerCase()));
		const list = (result ? result.list : []).slice();
		keywords.forEach(text => { if (!list.some(item => item.text.toLowerCase() === text)) list.push({ text, tag: 'LOGICWORD' }); });
		return { from: input.cursor - word[0].length, to: input.cursor, list };
	}

	function create(textarea, { transform = false, lineWrapping = false } = {}) {
		const listeners = new Map(), markedLines = new Set();
		let source = '', view, language;
		const setMarks = R.StateEffect.define();
		const marks = R.StateField.define({
			create: () => R.Decoration.none,
			update(value, tr) {
				value = value.map(tr.changes);
				for (const effect of tr.effects) if (effect.is(setMarks)) {
					value = R.Decoration.set(effect.value.filter(line => line < tr.state.doc.lines).map(line =>
						R.Decoration.line({ class: 'err-line' }).range(tr.state.doc.line(line + 1).from)), true);
				}
				return value;
			},
			provide: field => R.EditorView.decorations.from(field)
		});
		function emit(event) { (listeners.get(event) || []).forEach(fn => fn(api)); }
		const updates = R.EditorView.updateListener.of(update => {
			if (update.docChanged) emit('change');
			if (update.docChanged || update.selectionSet) emit('cursorActivity');
		});
		function extensions() {
			language = createPuzzleScriptLanguage(transform ? transformParser(source) : codeMirrorFn());
			const completionSource = puzzleScriptCompletionSource({ language, complete: transform ? transformCompletions : PuzzleScriptAutocomplete.complete });
			return [
				R.EditorView.editorAttributes.of({ class: 'puzzlescript-editor mis-code-editor' }),
				R.EditorView.contentAttributes.of({ 'aria-label': transform ? 'Transform code' : 'Game source code' }),
				R.lineNumbers(), R.highlightActiveLine(), R.highlightActiveLineGutter(), R.drawSelection(), R.dropCursor(),
				R.history(), R.EditorState.tabSize.of(4), ...(lineWrapping ? [R.EditorView.lineWrapping] : []),
				language.extension, ...exactPrefixExtensions, tokenPresentation({ language }), marks, updates,
				R.autocompletion({
					activateOnTyping: true, activateOnTypingDelay: 0, defaultKeymap: false, interactionDelay: 0,
					icons: false, override: [completionSource],
					addToOptions: [{ position: 40, render(item) {
						const span = document.createElement('span'); span.textContent = item.label + (item.psExtra ? ' ' + item.psExtra : '');
						if (item.psTag) span.className = 'cm-' + item.psTag;
						return span;
					} }]
				}),
				puzzleScriptSearch(), puzzleScriptCommandExtensions,
				R.keymap.of([{ key: 'Ctrl-Space', run: R.startCompletion }, ...puzzleScriptCompletionKeymap,
					...puzzleScriptKeymap, ...puzzleScriptSearchKeymap, ...puzzleScriptCoreKeymap])
			];
		}
		function position(line, column = 0) {
			const found = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Number(line) + 1)));
			return found.from + Math.max(0, Math.min(found.length, column));
		}
		const api = {
			get view() { return view; },
			get language() { return language; },
			getValue: () => view.state.doc.toString(),
			setValue(text) {
				R.closeCompletion(view);
				markedLines.clear();
				view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text) }, selection: { anchor: 0 },
					effects: setMarks.of([]), annotations: R.isolateHistory.of('full') });
			},
			on(event, fn) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); },
			focus: () => view.focus(),
			refresh: () => view.requestMeasure(),
			getCursor() { const head = view.state.selection.main.head, line = view.state.doc.lineAt(head); return { line: line.number - 1, ch: head - line.from }; },
			setCursor(line, ch) { view.focus(); view.dispatch({ selection: { anchor: position(line, ch) }, scrollIntoView: true }); },
			scrollIntoView(where) { view.dispatch({ effects: R.EditorView.scrollIntoView(position(where.line, where.ch)) }); },
			getScrollInfo: () => ({ left: view.scrollDOM.scrollLeft, top: view.scrollDOM.scrollTop }),
			scrollTo(left, top) { view.scrollDOM.scrollTo(left, top); },
			addLineClass(line) { if (line >= 0) markedLines.add(line); view.dispatch({ effects: setMarks.of([...markedLines]) }); return line; },
			removeLineClass(line) { markedLines.delete(line); view.dispatch({ effects: setMarks.of([...markedLines]) }); },
			setGameSource(text) {
				if (!transform || text === source) return;
				source = text;
				view.dispatch({ effects: R.StateEffect.reconfigure.of(extensions()) });
			}
		};
		view = new R.EditorView({ state: R.EditorState.create({ doc: textarea.value, extensions: extensions() }), parent: textarea.parentNode });
		textarea.hidden = true; view.dom.misEditor = api;
		return api;
	}
	window.MISCodeEditor = Object.freeze({ create });
})();

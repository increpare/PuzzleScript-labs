// MIS's two independent CodeMirror 6 views. Reuses the main editor's runtime,
// PuzzleScript parser, token presentation, completions, search and key bindings.
(function () {
	'use strict';
	const R = PuzzleScriptCM6Runtime, P = PuzzleScriptCM6Plugins;
	const { createPuzzleScriptLanguage, wrapPuzzleScriptParser } = P.require('stream-language');
	const { exactPrefixExtensions, ensureExactPrefix } = P.require('exact-prefix');
	const { tokenPresentation } = P.require('token-presentation');
	const { puzzleScriptCompletionSource, puzzleScriptCompletionKeymap } = P.require('autocomplete');
	const { puzzleScriptCommandExtensions, puzzleScriptCoreKeymap, puzzleScriptKeymap } = P.require('commands');
	const { puzzleScriptSearch, puzzleScriptSearchKeymap } = P.require('search');
	const { puzzleScriptDefinitionLinks, puzzleScriptTokenAtPosition } = P.require('interactions');
	const { puzzleScriptSymbolInspector } = P.require('symbol-inspector');

	function transformParser(source) {
		const parser = codeMirrorFn(), wrapped = wrapPuzzleScriptParser(parser), parsed = wrapped.startState();
		// Parse the game's real definitions with the same parser used by the main
		// editor, stopping at RULES. Transform names and properties come from here.
		for (const line of source.split(/\r\n?|\n/)) {
			const stream = new R.StringStream(line, 4);
			if (stream.eol()) wrapped.blankLine(parsed);
			while (!stream.eol()) { stream.start = stream.pos; wrapped.token(stream, parsed); }
			if (parsed.inner.section === 'rules') break;
		}
		const seed = parsed.inner;
		seed.section = 'rules'; seed.lineNumber = 0; seed.commentLevel = 0;
		return {
			startState() { return parser.copyState(seed); },
			copyState: parser.copyState,
			blankLine() {}, // A blank line does not end a nested comment.
			token(stream, state) {
				// Transform rules are independent lines. An unfinished cell must
				// not swallow the next line's MIS prefix while the author types.
				if (stream.sol()) {
					state.lineNumber++;
					state.inside_cell = false; state.arrow_passed = false;
					state.lhs_rhs_rowcount_difference = 0; state.rhs_pattern_started = false;
					state.rule_prelude = true; state.tokenIndex = 0;
				}
				if (stream.eatSpace()) return null;
				if (state.commentLevel || stream.peek() === '(') {
					do {
						const ch = stream.next();
						if (ch === '(') state.commentLevel++;
						else if (ch === ')') state.commentLevel--;
					} while (!stream.eol() && state.commentLevel > 0);
					return 'comment';
				}
				// These optional headings are accepted by MISCore.parseTransform.
				if (state.tokenIndex === 0 && stream.match(/^(?:transform|generation)(?=\s*(?:\(|$))/i)) return 'HEADER';
				if (state.tokenIndex === 0 && stream.match(/^=+(?=\s*(?:\(|$))/)) return 'EQUALSBIT';
				state.tokenIndex++;
				if (stream.match('->')) { state.arrow_passed = true; return 'ARROW'; }
				const ch = stream.peek();
				if (ch === '[') {
					stream.next(); state.inside_cell = true; state.rule_prelude = false;
					if (state.arrow_passed) state.rhs_pattern_started = true;
					return 'BRACKET';
				}
				if (ch === ']') {
					stream.next(); state.inside_cell = false;
					state.lhs_rhs_rowcount_difference += state.arrow_passed ? -1 : 1;
					return 'BRACKET';
				}
				if (ch === '|') { stream.next(); return 'BRACKET'; }
				if (!state.inside_cell) {
					if (stream.match(/^(?:choose|option|or)(?=\s|[()[\]|]|$)/i)) return 'LOGICWORD';
					if (stream.match(/^(?:\d+-\d+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?=\s|[()[\]|]|$)/i)) return 'number';
					if (stream.match(/^(?:up|down|left|right|horizontal|vertical)(?=\s|[()[\]|]|$)/i)) return 'DIRECTION';
				} else if (stream.match(/^no(?=\s|[()[\]|]|$)/i)) return 'DIRECTION';
				const name = stream.match(/^(?:(?!->)[^\s()[\]|])+/);
				if (name) return state.inside_cell && state.names.has(name[0].toLowerCase()) ? 'NAME' : 'ERROR';
				stream.next();
				return 'ERROR';
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

	// Rule gutter: one marker per rule line (see mis_app.js renderRuleGutter),
	// a heat tint on lines that fired in the solution, and a flash on the lines
	// that fire on the step being watched. Info is keyed by 1-based line.
	// 9x9 pixel glyphs, drawn with currentColor ('#' = pixel).
	function bitmap(rows) {
		const top = Math.floor((9 - rows.length) / 2), left = Math.floor((9 - rows[0].length) / 2);
		let out = '';
		rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') out += '<rect x="' + (left + x) + '" y="' + (top + y) + '" width="1" height="1"/>'; });
		return out;
	}
	const GLYPHS = {
		dot: bitmap(['###', '###', '###']),
		bigdot: bitmap(['.###.', '#####', '#####', '#####', '.###.']),
		// The Windows 95 check box tick.
		need: bitmap(['......#', '.....##', '#...###', '##.###.', '#####..', '.###...', '..#....']),
		ban: bitmap(['##....##', '.##..##.', '..####..', '...##...', '..####..', '.##..##.', '##....##']),
		flower: bitmap(['.#.#.', '#####', '.###.', '..#..', '.##..', '..#..']),
	};
	class RuleMarker extends R.GutterMarker {
		constructor(info) { super(); this.info = info; }
		eq(other) { return ['mark', 'glyph', 'state', 'tip', 'toggle'].every(k => other.info[k] === this.info[k]); }
		toDOM() {
			const el = document.createElement('span');
			el.className = 'mis-rule-mark ' + this.info.mark + (this.info.state ? ' ' + this.info.state : '') + (this.info.toggle ? ' toggle' : '');
			el.innerHTML = '<svg viewBox="0 0 9 9" width="9" height="9" aria-hidden="true" fill="currentColor" shape-rendering="crispEdges">' + (GLYPHS[this.info.glyph || this.info.mark] || '') + '</svg>';
			return el;
		}
	}
	const spacer = new (class extends R.GutterMarker { toDOM() { const el = document.createElement('span'); el.className = 'mis-rule-mark'; return el; } })();

	// Breakpoint gutter (game source only): markers ride along with edits.
	// mis_console.js reads them when a playtest move fires a rule.
	const breakpointMarker = new (class extends R.GutterMarker { toDOM() { const el = document.createElement('span'); el.className = 'mis-bp'; return el; } })();
	const breakpointSpacer = new (class extends R.GutterMarker { toDOM() { const el = document.createElement('span'); el.className = 'mis-bp-space'; return el; } })();
	const pausedMarker = new (class extends R.GutterMarker { toDOM() { const el = document.createElement('span'); el.className = 'mis-paused-arrow'; return el; } })();

	function create(textarea, { transform = false, lineWrapping = false, ruleGutter = false, getDefinitionTarget } = {}) {
		const listeners = new Map(), markedLines = new Set();
		let source = '', view, language;
		const setRules = R.StateEffect.define(), setFlash = R.StateEffect.define();
		// { info: Map line -> info, markers: RangeSet, heat: DecorationSet, flash: DecorationSet }
		const rules = R.StateField.define({
			create: () => ({ info: new Map(), markers: R.RangeSet.empty, heat: R.Decoration.none, flash: R.Decoration.none }),
			update(value, tr) {
				if (tr.docChanged) {
					// Lines move until the app re-renders after recompiling.
					value = { info: new Map(), markers: value.markers.map(tr.changes), heat: value.heat.map(tr.changes), flash: R.Decoration.none };
				}
				for (const effect of tr.effects) {
					if (effect.is(setRules)) {
						const doc = tr.state.doc, markers = [], heat = [];
						const info = new Map([...effect.value].filter(([line]) => line >= 1 && line <= doc.lines));
						[...info.keys()].sort((a, b) => a - b).forEach(line => {
							const it = info.get(line), from = doc.line(line).from;
							markers.push(new RuleMarker(it).range(from));
							if (it.heat) heat.push(R.Decoration.line({ class: 'mis-rule-heat-' + it.heat }).range(from));
						});
						value = { info, markers: R.RangeSet.of(markers), heat: R.Decoration.set(heat), flash: value.flash };
					} else if (effect.is(setFlash)) {
						const doc = tr.state.doc;
						const lines = [...new Set(effect.value)].filter(l => l >= 1 && l <= doc.lines).sort((a, b) => a - b);
						value = Object.assign({}, value, { flash: R.Decoration.set(lines.map(l => R.Decoration.line({ class: 'mis-rule-flash' }).range(doc.line(l).from))) });
					}
				}
				return value;
			},
			provide: field => [R.EditorView.decorations.from(field, v => v.heat), R.EditorView.decorations.from(field, v => v.flash)]
		});
		let tip = null;
		function hideTip() { if (tip) { tip.remove(); tip = null; } }
		function showTip(line, target) {
			const it = view.state.field(rules).info.get(line);
			hideTip();
			if (!it || !it.tip) return;
			tip = document.createElement('div');
			tip.className = 'mis-rule-tip';
			tip.textContent = it.tip;
			document.body.appendChild(tip);
			const r = target.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
			const left = Math.min(window.innerWidth - w - 4, r.right + 6);
			const top = r.bottom + 4 + h < window.innerHeight ? r.bottom + 4 : r.top - h - 4;
			tip.style.left = Math.max(4, left) + 'px';
			tip.style.top = Math.max(4, top) + 'px';
		}
		const lineOfBlock = block => view.state.doc.lineAt(block.from).number;
		const ruleGutterExtension = R.gutter({
			class: 'mis-rule-gutter',
			markers: v => v.state.field(rules).markers,
			initialSpacer: () => spacer,
			domEventHandlers: {
				mousedown(v, block, event) {
					const line = lineOfBlock(block), it = v.state.field(rules).info.get(line);
					if (!it || !it.toggle || event.button !== 0) return false;
					event.preventDefault();
					hideTip();
					(listeners.get('ruleToggle') || []).forEach(fn => fn(line));
					return true;
				},
				mousemove(v, block, event) {
					const line = lineOfBlock(block);
					if (!tip || tip.dataset.line !== String(line)) { showTip(line, event.target.closest('.cm-gutterElement') || event.target); if (tip) tip.dataset.line = line; }
					return false;
				},
				mouseleave() { hideTip(); return false; }
			}
		});
		const toggleBreakpoint = R.StateEffect.define(), setBreakpoints = R.StateEffect.define(), setPaused = R.StateEffect.define();
		const breakpoints = R.StateField.define({
			create: () => R.RangeSet.empty,
			update(value, tr) {
				value = value.map(tr.changes);
				for (const effect of tr.effects) if (effect.is(toggleBreakpoint)) {
					const pos = effect.value;
					let has = false;
					value.between(pos, pos, from => { if (from === pos) has = true; });
					value = has ? value.update({ filter: from => from !== pos }) : value.update({ add: [breakpointMarker.range(pos)] });
				} else if (effect.is(setBreakpoints)) {
					value = R.RangeSet.of(effect.value.map(pos => breakpointMarker.range(pos)), true);
				}
				return value;
			}
		});
		// The paused line: a line tint plus a debugger arrow in the breakpoint margin.
		const pausedLine = R.StateField.define({
			create: () => ({ deco: R.Decoration.none, arrow: R.RangeSet.empty }),
			update(value, tr) {
				value = { deco: value.deco.map(tr.changes), arrow: value.arrow.map(tr.changes) };
				for (const effect of tr.effects) if (effect.is(setPaused)) {
					const line = effect.value;
					if (line >= 1 && line <= tr.state.doc.lines) {
						const from = tr.state.doc.line(line).from;
						value = { deco: R.Decoration.set([R.Decoration.line({ class: 'mis-paused-line' }).range(from)]), arrow: R.RangeSet.of([pausedMarker.range(from)]) };
					} else value = { deco: R.Decoration.none, arrow: R.RangeSet.empty };
				}
				return value;
			},
			provide: field => R.EditorView.decorations.from(field, v => v.deco)
		});
		const breakpointGutter = R.gutter({
			class: 'mis-bp-gutter',
			markers: v => R.RangeSet.join([v.state.field(breakpoints), v.state.field(pausedLine).arrow]),
			initialSpacer: () => breakpointSpacer,
			domEventHandlers: {
				mousedown(v, block, event) {
					if (event.button !== 0) return false;
					event.preventDefault();
					(listeners.get('breakpointClick') || []).forEach(fn => fn(lineOfBlock(block)));
					return true;
				},
				// Runs before the page's status-bar help, which reads [title].
				pointerover(v, block, event) {
					const margin = event.target.closest && event.target.closest('.mis-bp-gutter');
					if (margin && !margin.title) margin.title = 'Breakpoint margin: click beside a rule line, or press F9 on it';
					return false;
				}
			}
		});
		// F9 toggles a breakpoint on the cursor's line, as in Windows debuggers.
		const breakpointKeymap = R.keymap.of([{ key: 'F9', run: v => {
			const line = v.state.doc.lineAt(v.state.selection.main.head).number;
			(listeners.get('breakpointClick') || []).forEach(fn => fn(line));
			return true;
		} }]);
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
		const levelLinks = R.EditorView.domEventHandlers({
			mousedown(event, editor) {
				const modified = /^Mac/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
				if (event.button !== 0 || !modified) return false;
				const element = event.target.closest && event.target.closest('.cm-LEVEL');
				if (!element || !editor.contentDOM.contains(element)) return false;
				const position = editor.posAtDOM(element);
				if (!ensureExactPrefix(editor, editor.state.doc.lineAt(position).to)) return false;
				const token = puzzleScriptTokenAtPosition(editor.state, position);
				if (!token || !token.style.split(/\s+/).includes('LEVEL')) return false;
				event.preventDefault(); event.stopPropagation();
				R.closeCompletion(editor); editor.contentDOM.blur();
				(listeners.get('levelClick') || []).forEach(fn => fn(token.line));
				return true;
			}
		});
		function extensions() {
			language = createPuzzleScriptLanguage(transform ? transformParser(source) : codeMirrorFn());
			const completionSource = puzzleScriptCompletionSource({ language, complete: transform ? transformCompletions : PuzzleScriptAutocomplete.complete });
			return [
				R.EditorView.editorAttributes.of({ class: 'puzzlescript-editor mis-code-editor' }),
				R.EditorView.contentAttributes.of({ 'aria-label': transform ? 'Transform code' : 'Game source code' }),
				...(ruleGutter ? [breakpoints, pausedLine, breakpointGutter, breakpointKeymap] : []),
				R.lineNumbers(), ...(ruleGutter ? [rules, ruleGutterExtension] : []),
				R.highlightActiveLine(), R.highlightActiveLineGutter(), R.drawSelection(), R.dropCursor(),
				R.history(MISSpritePainting.historyConfig), R.EditorState.tabSize.of(4), ...(lineWrapping ? [R.EditorView.lineWrapping] : []),
				language.extension, ...exactPrefixExtensions, tokenPresentation({ language }), marks, updates,
				...(transform ? [] : MISSpritePainting.extension),
				...(transform ? [] : [levelLinks]),
				puzzleScriptDefinitionLinks({ language, getDefinitionTarget }),
				puzzleScriptSymbolInspector({ getDefinitionTarget }),
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
			documentState: () => view.state,
			restoreDocument(state) { R.closeCompletion(view); markedLines.clear(); view.setState(state); view.dispatch({ effects: setMarks.of([]) }); },
			newDocument(text) { R.closeCompletion(view); markedLines.clear(); view.setState(R.EditorState.create({ doc: String(text), extensions: extensions() })); },
			resetSpriteBrushes() { if (!transform) view.dispatch({ effects: MISSpritePainting.resetBrushes.of(true) }); },
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
			// Map line -> { mark, glyph?, state?, heat? (1-4), tip?, toggle? }
			setRuleInfo(info) { if (ruleGutter) view.dispatch({ effects: setRules.of(info) }); },
			setFlashLines(lines) { if (ruleGutter) view.dispatch({ effects: setFlash.of(lines || []) }); },
			// Breakpoints and the paused line, by 1-based line.
			toggleBreakpoint(line) { if (ruleGutter && line >= 1 && line <= view.state.doc.lines) view.dispatch({ effects: toggleBreakpoint.of(view.state.doc.line(line).from) }); },
			getBreakpoints() {
				if (!ruleGutter) return [];
				const out = [], doc = view.state.doc;
				for (let it = view.state.field(breakpoints).iter(); it.value; it.next()) out.push(doc.lineAt(it.from).number);
				return out;
			},
			setBreakpoints(lines) {
				if (!ruleGutter) return;
				const doc = view.state.doc;
				const positions = [...new Set(lines)].filter(l => l >= 1 && l <= doc.lines).sort((a, b) => a - b).map(l => doc.line(l).from);
				view.dispatch({ effects: setBreakpoints.of(positions) });
			},
			setPausedLine(line) { if (ruleGutter) view.dispatch({ effects: setPaused.of(line || 0) }); },
			// Like scrollLineIntoView, but moves only the editor's own scroller,
			// never the page (used while stepping, so the board stays in view).
			scrollLineQuietly(line) {
				if (!(line >= 1 && line <= view.state.doc.lines)) return;
				const block = view.lineBlockAt(view.state.doc.line(line).from), sd = view.scrollDOM;
				const top = block.top + view.documentPadding.top, bottom = block.bottom + view.documentPadding.top;
				if (top < sd.scrollTop || bottom > sd.scrollTop + sd.clientHeight) sd.scrollTop = Math.max(0, top - (sd.clientHeight - (bottom - top)) / 2);
			},
			scrollLineIntoView(line) {
				if (line >= 1 && line <= view.state.doc.lines) view.dispatch({ effects: R.EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'nearest' }) });
			},
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

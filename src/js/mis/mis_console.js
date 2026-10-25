'use strict';

// MIS95 - the console under the board (shown with the Game source tab):
// Output, Compiled and Trace, plus rule breakpoints and stepping.
//
// Nothing here needs the `verbose_logging` or `debug` prelude flags. The page
// switches the engine's own verbose_logging on only around playtest moves, and
// the engine's logging hooks (consolePrint, addToDebugTimeline, ...) are
// redirected here while a move is recorded. Workers never load this file, so
// solving and generation are unaffected.
//
// A move runs to completion before anything is shown. Pausing at a breakpoint
// is a cursor into that move's recorded snapshots, so stepping back is free;
// the app only commits the move (new board, win check) once the cursor leaves it.

(function () {
	const MAX_TURNS = 200;      // turns kept in the trace
	const SNAPSHOT_TURNS = 40;  // most recent turns that keep board snapshots

	/////////////////////////////////////////////////////////////////////
	// Engine capture
	/////////////////////////////////////////////////////////////////////

	let rec = null;       // { entries, snaps } while a move is being recorded
	let compiled = null;  // rules captured by the last compile

	const basePrint = window.consolePrint;
	const baseCacheAllRuleNames = window.cacheAllRuleNames;

	function plainText(html) {
		return String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/&nbsp;/g, ' ')
			.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
	}

	function snapshotOf(lv) {
		return {
			w: lv.width, h: lv.height, objects: new Int32Array(lv.objects), movements: new Int32Array(lv.movements),
			strideMov: STRIDE_MOV, layers: LAYER_COUNT
		};
	}

	window.addToDebugTimeline = function (lv, lineNumber) {
		// engine.js reads debug_visualisation_array[debugger_turnIndex].length.
		if (!debug_visualisation_array[debugger_turnIndex]) debug_visualisation_array[debugger_turnIndex] = [];
		debug_visualisation_array[debugger_turnIndex][lineNumber] = true;
		if (!rec) return null;
		rec.snaps.push(snapshotOf(lv));
		return rec.snaps.length - 1;
	};

	window.consolePrint = function (text, urgent, lineNumber, inspectId) {
		if (!rec) { basePrint(text); return; }
		const plain = plainText(text);
		const snap = typeof inspectId === 'number' ? inspectId : null;
		let m;
		if ((m = /^Rule (\d+)\s*(\w*)\s*applied/.exec(plain))) rec.entries.push({ kind: 'rule', line: +m[1], dir: m[2] || '', snap: snap });
		else if ((m = /^Rule (\d+) triggers command (\S+?)\.?$/.exec(plain))) rec.entries.push({ kind: 'command', line: +m[1], cmd: m[2], snap: null });
		else if ((m = /^Turn starts with (?:input of (\w+)|no input)/.exec(plain))) rec.entries.push({ kind: 'start', input: m[1] || null, snap: snap });
		else if (plain === 'Applying rules' || plain === 'Turn complete' || /^--- (undoing|restarting) ---$/.test(plain)) return;
		else if (plain === 'Applying late rules') rec.entries.push({ kind: 'phase', text: 'late rules', snap: null });
		else if (plain === 'Processed movements.') rec.entries.push({ kind: 'phase', text: 'movements resolved', full: plain, snap: snap });
		else rec.entries.push({ kind: 'note', text: shortNote(plain.replace(/^line \d+ : /, '')), full: plain, line: lineNumber || null, snap: snap });
	};

	window.consolePrintFromRule = function (text, rule) {
		if (!rec) return;
		const plain = plainText(text);
		rec.entries.push({ kind: 'note', text: shortNote(plain), full: plain, line: rule ? rule.lineNumber : null, snap: null });
	};

	// The engine's verbose_logging sentences, shortened to fit a trace row.
	// The full sentence stays in the row's tooltip.
	const SHORT_NOTES = [
		[/^AGAIN command executed, with changes detected/, 'again: another turn follows'],
		[/^AGAIN command not executed/, 'again skipped: it would change nothing'],
		[/^CANCEL command executed/, 'cancel: the turn is undone'],
		[/^RESTART command executed/, 'restart: back to the restart state'],
		[/^CHECKPOINT command executed/, 'checkpoint: restart state saved'],
		[/^Relooping through rules because of rigid/, 'rigid: rules run again'],
		[/^require_player_movement set, but no player movement/, 'player didn’t move: turn cancelled (require_player_movement)'],
	];
	function shortNote(text) {
		for (const [re, short] of SHORT_NOTES) if (re.test(text)) return short;
		return text;
	}

	// The compiler prints its rule assembly only under `debug`. Capture it for
	// every compile instead, as data rather than console text.
	window.cacheAllRuleNames = function (st) {
		baseCacheAllRuleNames(st);
		debugMode = true; // eslint-disable-line no-undef
	};
	window.printRules = function (st) {
		const kept = st.rules.filter(function (r) { return !r.hasOwnProperty('discard'); });
		const byLine = new Map();
		kept.forEach(function (r) {
			const text = String(r.stringRep || '').replace('(' + r.lineNumber + ') ', '').replace(/\s+/g, ' ').trim();
			if (!byLine.has(r.lineNumber)) byLine.set(r.lineNumber, []);
			byLine.get(r.lineNumber).push(text);
		});
		// state.loops: [line, 1] for startloop, [line, -1] for endloop.
		compiled = { lines: byLine, loops: (st.loops || []).map(function (l) { return { line: l[0], start: l[1] === 1 }; }), total: kept.length, removed: st.rules.length - kept.length };
	};

	/////////////////////////////////////////////////////////////////////
	// Panel
	/////////////////////////////////////////////////////////////////////

	function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
	const $ = function (id) { return document.getElementById(id); };
	const INPUT_NAMES = ['up', 'left', 'down', 'right', 'action'];

	// opts: { getBreakpoints(), isRuleLine(line), sourceLine(line), revealLine(line),
	//         setPausedLine(line|null), showSource(), render() }
	function create(opts) {
		const els = {
			panel: $('console'), tabs: Array.from(document.querySelectorAll('#console-tabs [data-ctab]')),
			output: $('console-output'), compiled: $('console-compiled'), trace: $('console-trace'),
			breakToggle: $('break-toggle'), clear: $('console-clear'),
			bar: $('debug-bar'), where: $('debug-where')
		};
		let tab = 'trace';
		try { tab = localStorage.getItem('mis-console-tab') || 'trace'; } catch (e) { /* storage blocked */ }
		if (!els[tab]) tab = 'trace';

		const compileOut = [];  // { kind: 'error'|'warn'|'ok', text, line }
		let sessionOut = [];    // { kind: 'event'|'message'|'sound', text, line, turn }
		let compiledView = null, compiledOpen = new Set(), compiledFocus = null;
		let turns = [], turnCount = 0;
		let hover = null;       // { turn, entry } under the mouse
		let focused = null;     // { turn, entry } with keyboard focus
		let focusBeforePause = null;
		let pinned = null;      // { turn, entry } clicked
		let paused = null;      // { turn, entry, commit }

		/////////////////////////////////////////////////////////////////
		// Recording moves

		function record(run, before) {
			rec = { entries: [], snaps: [] };
			debug_visualisation_array = []; debugger_turnIndex = 0; // eslint-disable-line no-undef
			before = before || snapshotOf(level);
			const oldVerbose = verbose_logging;
			verbose_logging = true;
			let result;
			try { result = run(); }
			finally {
				verbose_logging = oldVerbose;
				const captured = rec;
				rec = null;
				result = { result: result, captured: captured, before: before };
			}
			return result;
		}

		function buildTurn(label, input, captured, before) {
			const snaps = captured.snaps;
			const entries = [{ kind: 'begin', text: 'before the move', snap: snaps.push(before) - 1 }].concat(captured.entries);
			entries.push({ kind: 'end', text: 'end of turn', snap: snaps.push(snapshotOf(level)) - 1 });
			let rules = 0, starts = 0;
			entries.forEach(function (e) {
				if (e.kind === 'rule') rules++;
				if (e.kind === 'start') { starts++; e.again = starts > 1; }
			});
			return { n: ++turnCount, label: label, input: input, entries: entries, snaps: snaps, rules: rules, agains: Math.max(0, starts - 1), open: null };
		}

		function addTurn(t) {
			turns.push(t);
			if (turns.length > MAX_TURNS) turns.splice(0, turns.length - MAX_TURNS);
			for (let i = 0; i < turns.length - SNAPSHOT_TURNS; i++) turns[i].snaps = null;
			// Sounds, messages and commands also go to Output.
			t.entries.forEach(function (e) {
				if (e.kind !== 'command') return;
				if (/^sfx\d+$/.test(e.cmd)) sessionOut.push({ kind: 'sound', text: e.cmd, line: e.line, turn: t.n });
				else if (e.cmd !== 'message') sessionOut.push({ kind: 'event', text: e.cmd, line: e.line, turn: t.n });
			});
			if (typeof messagetext === 'string' && messagetext) { sessionOut.push({ kind: 'message', text: messagetext, line: null, turn: t.n }); messagetext = ''; }
		}

		// A board as it is before a level loads: no pending movements.
		function boardSnapshot(board) {
			return { w: board.w, h: board.h, objects: new Int32Array(board.cells), movements: new Int32Array(board.w * board.h * STRIDE_MOV), strideMov: STRIDE_MOV, layers: LAYER_COUNT };
		}

		// Records `run()` (one move, including any again turns) and then calls
		// commit(result) — straight away, or once the user leaves a paused turn.
		// stepOpts.before: the board `run` starts from, when it loads a level.
		// stepOpts.optional: add no turn when `run` printed nothing (a level
		// without run_rules_on_level_start, say).
		function step(input, run, commit, stepOpts) {
			stepOpts = stepOpts || {};
			if (paused) finish();
			hover = null; pinned = null; focused = null;
			const label = typeof input === 'number' ? INPUT_NAMES[input] || 'tick' : String(input);
			const r = record(run, stepOpts.before ? boardSnapshot(stepOpts.before) : null);
			if (stepOpts.optional && !r.captured.entries.length) { renderAll(); commit(r.result); return; }
			const t = buildTurn(label, input, r.captured, r.before);
			addTurn(t);
			const at = els.breakToggle && els.breakToggle.checked ? nextBreak(t, 0) : -1;
			if (at < 0) { renderAll(); commit(r.result); return; }
			paused = { turn: t, entry: at, commit: function () { commit(r.result); } };
			focusBeforePause = document.activeElement;
			t.open = true;
			opts.showSource();
			showTab('trace');
			renderAll();
			syncPaused();
			const e = t.entries[at];
			announce('Paused at the breakpoint on line ' + e.line + ', turn ' + t.n + '. ' + stepText() + ' N steps, B steps back, C continues, Escape finishes the move.');
		}

		function nextBreak(t, from) {
			const bps = new Set(opts.getBreakpoints());
			if (!bps.size) return -1;
			for (let i = from; i < t.entries.length; i++) if (t.entries[i].kind === 'rule' && bps.has(t.entries[i].line)) return i;
			return -1;
		}

		function snapEntries(t) {
			const out = [];
			t.entries.forEach(function (e, i) { if (e.snap !== null && e.snap !== undefined) out.push(i); });
			return out;
		}

		function stepBy(delta) {
			if (!paused) return;
			const list = snapEntries(paused.turn);
			let k = list.indexOf(paused.entry);
			if (k < 0) k = list.findIndex(function (i) { return i > paused.entry; }) - (delta > 0 ? 1 : 0);
			const next = k + delta;
			if (next >= list.length) { finish(); return; }
			paused.entry = list[Math.max(0, next)];
			syncPaused();
		}

		function cont() {
			if (!paused) return;
			const at = nextBreak(paused.turn, paused.entry + 1);
			if (at < 0) { finish(); return; }
			paused.entry = at;
			syncPaused();
		}

		function finish() {
			if (!paused) return;
			const p = paused;
			paused = null;
			leavePause();
			announce('Move finished.');
			p.commit();
		}

		// Leaving play mode: drop the paused move without committing it.
		function abort() {
			if (!paused) { hover = null; pinned = null; focused = null; return; }
			paused = null; hover = null; pinned = null; focused = null;
			leavePause();
		}

		// Hides the debug bar; focus inside it goes back where it was before.
		function leavePause() {
			const hadBarFocus = els.bar.contains(document.activeElement);
			syncPaused();
			if (hadBarFocus && focusBeforePause && focusBeforePause.isConnected && !focusBeforePause.closest('[hidden]')) focusBeforePause.focus();
			focusBeforePause = null;
		}

		function syncPaused() {
			els.bar.hidden = !paused;
			// The bar replaces the movement-key hint, which doesn't apply while paused.
			const hint = $('play-tools');
			if (hint) hint.hidden = !!paused;
			// The Run menu mirrors these buttons' disabled state.
			['dbg-back', 'dbg-step', 'dbg-continue', 'dbg-finish'].forEach(function (id) { $(id).disabled = !paused; });
			// As Visual C++ put [break] in its title: the designer caption says [Break].
			const caption = $('designer-mode'), mode = document.querySelector('#mode-seg .on');
			if (caption) caption.textContent = paused ? '[Break]' : '[' + (mode ? mode.textContent.trim() : 'Play') + ']';
			if (paused) {
				const t = paused.turn, e = t.entries[paused.entry];
				const list = snapEntries(t);
				els.where.textContent = 'turn ' + t.n + ' · step ' + (list.indexOf(paused.entry) + 1) + '/' + list.length;
				opts.setPausedLine(e.line || null);
				if (e.line) opts.revealLine(e.line, true);
			} else {
				opts.setPausedLine(null);
			}
			renderTrace();
			opts.render();
		}

		/////////////////////////////////////////////////////////////////
		// What the board shows

		function viewRef() { return hover || focused || pinned || (paused ? { turn: paused.turn, entry: paused.entry } : null); }
		function viewSnap() {
			const v = viewRef();
			if (!v || !v.turn.snaps) return null;
			const e = v.turn.entries[v.entry];
			return e && e.snap !== null && e.snap !== undefined ? v.turn.snaps[e.snap] : null;
		}

		function viewBoard() {
			const s = viewSnap();
			return s ? { w: s.w, h: s.h, cells: s.objects } : null;
		}

		function describe(t, e) {
			if (e.kind === 'rule') return 'after line ' + e.line;
			if (e.kind === 'start') return e.again ? 'again turn starts' : e.input ? 'movement applied' : 'rules run with no input';
			return e.text || e.kind;
		}

		function bannerHTML() {
			const v = viewRef();
			if (!v || !viewSnap()) return '';
			const e = v.turn.entries[v.entry];
			const head = paused && !hover && !focused && !pinned ? 'Paused' : 'Trace';
			return head + ' · turn <b>' + v.turn.n + '</b> (' + escapeHtml(v.turn.label) + ') · ' + escapeHtml(describe(v.turn, e)) +
				(pinned && !hover ? ' · <span class="faint">Esc to return</span>' : '');
		}

		// Pending movements as arrows (they are part of the engine state mid-turn).
		function decorateBoard(ctx, board, cell) {
			const s = viewSnap();
			if (!s || s.w !== board.w || s.h !== board.h) return;
			const bits = s.layers * 5;
			ctx.save();
			for (let tile = 0; tile < s.w * s.h; tile++) {
				const dirs = new Set();
				for (let b = 0; b < bits; b++) {
					if (s.movements[tile * s.strideMov + (b >> 5)] & (1 << (b & 31))) dirs.add(b % 5);
				}
				if (!dirs.size) continue;
				const cx = (Math.floor(tile / s.h) + 0.5) * cell, cy = (tile % s.h + 0.5) * cell, r = cell * 0.3;
				dirs.forEach(function (d) {
					ctx.beginPath();
					if (d === 4) ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
					else {
						const ang = [-Math.PI / 2, Math.PI / 2, Math.PI, 0][d];
						const tip = [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
						const back = [cx - Math.cos(ang) * r * 0.6, cy - Math.sin(ang) * r * 0.6];
						const px = -Math.sin(ang) * r * 0.7, py = Math.cos(ang) * r * 0.7;
						ctx.moveTo(tip[0], tip[1]); ctx.lineTo(back[0] + px, back[1] + py); ctx.lineTo(back[0] - px, back[1] - py); ctx.closePath();
					}
					ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
					ctx.lineWidth = Math.max(1, cell / 16); ctx.strokeStyle = '#000'; ctx.stroke();
				});
			}
			ctx.restore();
		}

		/////////////////////////////////////////////////////////////////
		// Rendering

		// Rows are laid out like a Windows 95 tree view: [+]/[−] boxes and dotted
		// connectors, an icon column (breakpoint, current step, error, warning), a
		// plain Line column, then the text. Click a row to select it; double-click
		// (or Enter on an Output row) opens the line in the source.
		function sourcePlain(line) { return (opts.sourceLine(line) || '').trim(); }
		function lineCol(line) { return '<span class="col-ln">' + (line || '') + '</span>'; }
		function box(open) { return '<span class="tv-box' + (open ? ' open' : '') + '" aria-hidden="true"></span>'; }
		function connector(last) { return '<span class="tv-line' + (last ? ' last' : '') + '" aria-hidden="true"></span>'; }
		function indent(depth) { return depth ? '<span class="tv-indent" style="width:' + (depth * 16) + 'px" aria-hidden="true"></span>' : ''; }
		function icon(kind) { return '<span class="col-icon' + (kind ? ' ic-' + kind : '') + '" aria-hidden="true"></span>'; }
		function text(html) { return '<span class="t-text">' + html + '</span>'; }

		function hasSnap(t, e) { return !!t.snaps && e.snap !== null && e.snap !== undefined; }

		function entryText(t, e) {
			// No direction: the engine stores left/up rules as reversed right/down
			// ones, so the direction it reports would often look wrong.
			if (e.kind === 'rule') return 'line ' + e.line + ': ' + sourcePlain(e.line);
			if (e.kind === 'command') return 'line ' + e.line + ' runs the ' + e.cmd + ' command';
			if (e.kind === 'start') return e.again ? 'again: a new turn starts' : e.input ? 'movement applied (' + e.input + ')' : 'rules run with no input';
			return (e.line ? 'line ' + e.line + ': ' : '') + (e.kind === 'note' ? e.full || e.text : e.text);
		}

		// The row text without its line number (that has its own column).
		function entryLabel(t, e) {
			if (e.kind === 'rule') return sourcePlain(e.line);
			if (e.kind === 'command') return 'command: ' + e.cmd;
			if (e.kind === 'start') return e.again ? 'again: new turn' : e.input ? 'movement applied (' + e.input + ')' : 'rules run with no input';
			return e.text;
		}

		function entryHTML(t, e, i, bps, last) {
			const cls = ['t-row', 'k-' + e.kind];
			const cur = paused && paused.turn === t && paused.entry === i;
			if (cur) cls.push('cur');
			if (!hasSnap(t, e)) cls.push('nosnap');
			const bp = e.kind === 'rule' && bps.has(e.line);
			const tip = entryText(t, e);
			const label = (cur ? 'Paused here. ' : '') + (bp ? 'Breakpoint. ' : '') + tip;
			return '<div class="' + cls.join(' ') + '" role="treeitem" aria-level="2" tabindex="-1" data-key="t' + t.n + ':' + i + '" data-turn="' + t.n + '" data-entry="' + i + '"' +
				(e.line ? ' data-line="' + e.line + '"' : '') + ' title="' + escapeHtml(tip) + '" aria-label="' + escapeHtml(label) + '"' + (cur ? ' aria-current="step"' : '') + '>' +
				connector(last) + icon(cur ? 'cur' : bp ? 'bp' : '') + lineCol(e.line) + text(escapeHtml(entryLabel(t, e))) + '</div>';
		}

		function turnSummary(t) {
			const parts = [t.rules ? t.rules + (t.rules === 1 ? ' rule' : ' rules') : 'no rules fired'];
			if (t.agains) parts.push(t.agains + ' again');
			return parts.join(', ');
		}

		function renderTrace() {
			if (tab !== 'trace' || els.panel.hidden) return;
			if (!turns.length) {
				els.trace.innerHTML = '<div class="c-empty">Play the level and every move is traced here: which rules fired and in what order. Point at a row, or move to it with the arrow keys, to see the board at that moment.<br><br>To stop a move when a rule fires, click the margin left of the rule’s line number in Game source, or press F9 on its line.</div>';
				return;
			}
			const stick = els.trace.scrollTop + els.trace.clientHeight >= els.trace.scrollHeight - 4;
			const hadFocus = els.trace.contains(document.activeElement);
			const bps = new Set(opts.getBreakpoints());
			const last = turns[turns.length - 1];
			let html = '<div class="tree" role="tree" aria-label="Trace of playtest moves">';
			turns.forEach(function (t) {
				const open = t.open === null ? t === last : t.open;
				const summary = turnSummary(t);
				html += '<div class="t-turn' + (open ? ' open' : '') + '" role="treeitem" aria-level="1" aria-expanded="' + open + '" tabindex="-1" data-key="t' + t.n + '" data-turn="' + t.n + '"' +
					' aria-label="Turn ' + t.n + ', ' + escapeHtml(t.label) + ', ' + summary + '">' + box(open) + text('Turn ' + t.n + ': ' + escapeHtml(t.label) + ' (' + summary + ')') + '</div>';
				if (open) t.entries.forEach(function (e, i) { html += entryHTML(t, e, i, bps, i === t.entries.length - 1); });
			});
			els.trace.innerHTML = html + '</div>';
			settleTree('trace', els.trace, hadFocus, '.t-row.cur');
			markShown();
			const cur = els.trace.querySelector('.t-row.cur');
			if (cur) scrollWithin(els.trace, cur);
			else if (stick && !hadFocus) els.trace.scrollTop = els.trace.scrollHeight;
		}

		// Scrolls a row into view inside its pane only. scrollIntoView would also
		// scroll the page, which in the stacked narrow layout hides the board.
		function scrollWithin(container, el) {
			const c = container.getBoundingClientRect(), r = el.getBoundingClientRect();
			if (r.top < c.top) container.scrollTop -= c.top - r.top + 4;
			else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom + 4;
		}

		// Output, Compiled and Trace each have one tab stop. The stop is kept by
		// row key across re-renders, as is keyboard focus.
		const treeKey = { trace: null, compiled: null, output: null };
		function settleTree(which, container, hadFocus, preferred) {
			const rows = Array.from(container.querySelectorAll('[role=treeitem]'));
			if (!rows.length) return;
			let el = treeKey[which] ? rows.find(function (r) { return r.dataset.key === treeKey[which]; }) : null;
			if (!el) el = container.querySelector(preferred) || (which === 'trace' ? rows.filter(function (r) { return r.classList.contains('t-turn'); }).pop() : rows[0]);
			el.tabIndex = 0;
			if (hadFocus) el.focus({ preventScroll: true });
		}
		function moveTreeFocus(which, row) {
			const container = els[which];
			container.querySelectorAll('[role=treeitem][tabindex="0"]').forEach(function (r) { r.tabIndex = -1; });
			row.tabIndex = 0;
			treeKey[which] = row.dataset.key;
			row.focus({ preventScroll: true });
			scrollWithin(container, row);
		}
		function treeKeydown(which, ev) {
			const container = els[which];
			const rows = Array.from(container.querySelectorAll('[role=treeitem]'));
			const at = rows.indexOf(ev.target);
			if (at < 0) return;
			const row = rows[at], expanded = row.getAttribute('aria-expanded'), level = +row.getAttribute('aria-level');
			let target = null;
			switch (ev.key) {
				case 'ArrowDown': target = rows[at + 1]; break;
				case 'ArrowUp': target = rows[at - 1]; break;
				case 'Home': target = rows[0]; break;
				case 'End': target = rows[rows.length - 1]; break;
				case 'ArrowRight':
					if (expanded === 'false') activateRow(which, row);
					else if (expanded === 'true') target = rows[at + 1];
					break;
				case 'ArrowLeft':
					if (expanded === 'true') activateRow(which, row);
					else for (let k = at - 1; k >= 0; k--) if (+rows[k].getAttribute('aria-level') < level) { target = rows[k]; break; }
					break;
				case 'Enter': case ' ': activateRow(which, row); break;
				default: return;
			}
			// Arrow keys would otherwise also move the player.
			ev.preventDefault(); ev.stopPropagation();
			if (target) moveTreeFocus(which, target);
		}

		// Click, Enter or Space on a row.
		function activateRow(which, row) {
			treeKey[which] = row.dataset.key;
			if (row.classList.contains('t-turn')) {
				const t = turns.find(function (x) { return x.n === +row.dataset.turn; });
				if (t) { t.open = row.getAttribute('aria-expanded') !== 'true'; renderTrace(); }
				return;
			}
			if (row.classList.contains('t-row')) {
				const t = turns.find(function (x) { return x.n === +row.dataset.turn; });
				const i = +row.dataset.entry;
				if (!t) return;
				const e = t.entries[i];
				if (e.line) opts.revealLine(e.line, true);
				if (paused && paused.turn === t && hasSnap(t, e)) { paused.entry = i; hover = null; focused = null; syncPaused(); announceStep(); return; }
				if (!hasSnap(t, e)) return;
				pinned = pinned && pinned.turn === t && pinned.entry === i ? null : { turn: t, entry: i };
				refreshView();
				return;
			}
			if (row.classList.contains('c-line')) {
				const line = +row.dataset.line;
				if (compiledOpen.has(line)) compiledOpen.delete(line); else compiledOpen.add(line);
				opts.revealLine(line, true);
				renderCompiled();
				return;
			}
			// Output: go and fix it.
			if (row.dataset.line) opts.revealLine(+row.dataset.line);
		}

		function renderOutput() {
			if (tab !== 'output' || els.panel.hidden) return;
			const hadFocus = els.output.contains(document.activeElement);
			const KIND = { error: 'Error', warn: 'Warning' };
			let key = 0;
			function row(o, body, label) {
				return '<div class="o-row k-' + o.kind + '" role="treeitem" aria-level="1" tabindex="-1" data-key="o' + (key++) + '"' + (o.line ? ' data-line="' + o.line + '"' : '') +
					' aria-label="' + escapeHtml(label) + '">' + icon(o.kind === 'error' || o.kind === 'warn' ? o.kind : '') + lineCol(o.line) + text(body) + '</div>';
			}
			let html = '<div class="tree" role="tree" aria-label="Output">';
			html += compileOut.map(function (o) {
				const label = (KIND[o.kind] ? KIND[o.kind] + ', ' : '') + (o.line ? 'line ' + o.line + ': ' : '') + o.text;
				return row(o, escapeHtml(o.text), label);
			}).join('');
			if (sessionOut.length) html += '<div class="o-sep" role="presentation">Playtest</div>';
			html += sessionOut.map(function (o) {
				const what = o.kind === 'message' ? 'message: “' + o.text + '”' : o.kind === 'sound' ? 'sound: ' + o.text : o.text;
				const full = (o.turn ? 'turn ' + o.turn + ': ' : '') + what;
				return row(o, escapeHtml(full), full + (o.line ? ', line ' + o.line : ''));
			}).join('');
			els.output.innerHTML = html + '</div>';
			settleTree('output', els.output, hadFocus, '.o-row.k-error');
			if (!hadFocus) els.output.scrollTop = els.output.scrollHeight;
		}

		function renderCompiled() {
			if (tab !== 'compiled' || els.panel.hidden) return;
			if (!compiledView) { els.compiled.innerHTML = '<div class="c-empty">No compiled rules: the game didn’t compile.</div>'; return; }
			const hadFocus = els.compiled.contains(document.activeElement);
			const lines = Array.from(compiledView.lines.keys()).sort(function (a, b) { return a - b; });
			let html = '<div class="c-head">' + compiledView.total + ' compiled rules from ' + lines.length + ' source lines' +
				(compiledView.removed ? ', ' + compiledView.removed + ' duplicates removed' : '') + '</div><div class="tree" role="tree" aria-label="Compiled rules by source line">';
			// Rule lines and loop markers in source order; loop bodies indented.
			const items = lines.map(function (line) { return { line: line }; })
				.concat(compiledView.loops.map(function (l) { return { line: l.line, loop: l.start ? 'startloop' : 'endloop' }; }))
				.sort(function (a, b) { return a.line - b.line; });
			let depth = 0;
			items.forEach(function (item) {
				const line = item.line;
				if (item.loop === 'endloop') depth = Math.max(0, depth - 1);
				const level = depth + 1;
				if (item.loop) {
					html += '<div class="c-loop" role="treeitem" aria-level="' + level + '" tabindex="-1" data-key="l' + line + '" data-line="' + line + '" aria-label="line ' + line + ': ' + item.loop + '">' +
						indent(depth) + '<span class="tv-gap" aria-hidden="true"></span>' + lineCol(line) + text(item.loop) + '</div>';
					if (item.loop === 'startloop') depth++;
					return;
				}
				const list = compiledView.lines.get(line), open = compiledOpen.has(line);
				const count = list.length + (list.length === 1 ? ' compiled rule' : ' compiled rules');
				html += '<div class="c-line' + (open ? ' open' : '') + (compiledFocus === line ? ' focus' : '') + '" style="--depth:' + depth + '" role="treeitem" aria-level="' + level + '" aria-expanded="' + open + '" tabindex="-1" data-key="c' + line + '" data-line="' + line + '"' +
					' title="' + escapeHtml('line ' + line + ': ' + sourcePlain(line)) + '" aria-label="' + escapeHtml('line ' + line + ': ' + sourcePlain(line) + ', ' + count) + '">' +
					indent(depth) + box(open) + lineCol(line) + text(escapeHtml(sourcePlain(line)) + '  (' + list.length + (list.length === 1 ? ' rule' : ' rules') + ')') + '</div>';
				if (open) list.forEach(function (rule, k) {
					html += '<div class="c-sub" role="treeitem" aria-level="' + (level + 1) + '" tabindex="-1" data-key="c' + line + ':' + k + '" data-line="' + line + '" title="' + escapeHtml(rule) + '">' +
						indent(depth) + connector(k === list.length - 1) + text(escapeHtml(rule)) + '</div>';
				});
			});
			els.compiled.innerHTML = html + '</div>';
			settleTree('compiled', els.compiled, hadFocus, '.c-line.focus');
			const focus = els.compiled.querySelector('.c-line.focus');
			if (focus && !hadFocus) scrollWithin(els.compiled, focus);
		}

		function renderTabs() {
			const problems = compileOut.filter(function (o) { return o.kind === 'error' || o.kind === 'warn'; }).length;
			els.tabs.forEach(function (b) {
				const on = b.dataset.ctab === tab;
				b.classList.toggle('on', on);
				b.setAttribute('aria-selected', String(on));
				b.tabIndex = on ? 0 : -1;
				if (b.dataset.ctab === 'output') {
					const bad = compileOut.some(function (o) { return o.kind === 'error'; });
					b.textContent = 'Output' + (problems ? ' (' + problems + ')' : '');
					b.classList.toggle('bad', bad);
					b.setAttribute('aria-label', 'Output' + (problems ? ', ' + problems + (bad ? ' with errors' : ' warnings') : ''));
				}
			});
			['output', 'compiled', 'trace'].forEach(function (k) { els[k].hidden = k !== tab; });
		}

		function renderAll() { renderTabs(); renderTrace(); renderOutput(); renderCompiled(); }

		function showTab(name) {
			tab = name;
			try { localStorage.setItem('mis-console-tab', name); } catch (e) { /* storage blocked */ }
			renderAll();
		}

		/////////////////////////////////////////////////////////////////
		// Events

		els.tabs.forEach(function (b, index) {
			b.onclick = function () { showTab(b.dataset.ctab); };
			// Same keys as the code tabs (mis_win95.js) and GUI95 property tabs.
			b.addEventListener('keydown', function (ev) {
				const n = els.tabs.length;
				const next = { ArrowRight: (index + 1) % n, ArrowLeft: (index + n - 1) % n, Home: 0, End: n - 1 }[ev.key];
				if (next === undefined) return;
				ev.preventDefault(); ev.stopPropagation();
				showTab(els.tabs[next].dataset.ctab);
				els.tabs[next].focus();
			});
		});
		els.clear.onclick = function () {
			if (paused) finish();
			turns = []; sessionOut = []; hover = null; pinned = null; focused = null;
			renderAll(); opts.render();
		};
		try { els.breakToggle.checked = localStorage.getItem('mis-break-enabled') !== 'false'; } catch (e) { /* storage blocked */ }
		els.breakToggle.onchange = function () {
			try { localStorage.setItem('mis-break-enabled', String(els.breakToggle.checked)); } catch (e) { /* storage blocked */ }
			renderTrace();
		};
		$('dbg-back').onclick = function () { stepBy(-1); announceStep(); };
		$('dbg-step').onclick = function () { stepBy(1); announceStep(); };
		$('dbg-continue').onclick = function () { cont(); announceStep(); };
		$('dbg-finish').onclick = finish;

		function paneOf(row) { return els.trace.contains(row) ? 'trace' : els.compiled.contains(row) ? 'compiled' : 'output'; }
		els.panel.addEventListener('click', function (ev) {
			const row = ev.target.closest('[role=treeitem]');
			if (!row) return;
			// A click on a [+]/[−] box, or anywhere on a header, opens or closes it.
			if (row.matches('.t-turn, .t-row, .c-line')) activateRow(paneOf(row), row);
		});
		// Double-click opens the row's line in the source, like a Win95 list.
		els.panel.addEventListener('dblclick', function (ev) {
			const row = ev.target.closest('[role=treeitem][data-line]');
			if (row) { ev.preventDefault(); opts.revealLine(+row.dataset.line); }
		});
		['trace', 'compiled', 'output'].forEach(function (which) {
			els[which].addEventListener('keydown', function (ev) { treeKeydown(which, ev); });
		});

		function refFor(row) {
			const t = row && row.classList.contains('t-row') && turns.find(function (x) { return x.n === +row.dataset.turn; });
			return t && hasSnap(t, t.entries[+row.dataset.entry]) ? { turn: t, entry: +row.dataset.entry } : null;
		}
		function sameRef(a, b) { return a === b || (!!a && !!b && a.turn === b.turn && a.entry === b.entry); }

		els.trace.addEventListener('mouseover', function (ev) {
			const next = refFor(ev.target.closest('.t-row'));
			if (sameRef(next, hover)) return;
			hover = next;
			refreshView();
		});
		els.trace.addEventListener('mouseleave', function () { if (hover) { hover = null; refreshView(); } });
		// Keyboard focus on a row previews it, as hovering does.
		els.trace.addEventListener('focusin', function (ev) {
			const row = ev.target.closest('[role=treeitem]');
			if (row) treeKey.trace = row.dataset.key;
			const next = row && row.matches(':focus-visible') ? refFor(row) : null;
			if (sameRef(next, focused)) return;
			focused = next;
			refreshView();
		});
		els.trace.addEventListener('focusout', function (ev) {
			if (els.trace.contains(ev.relatedTarget) || !focused) return;
			focused = null;
			refreshView();
		});
		['compiled', 'output'].forEach(function (which) {
			els[which].addEventListener('focusin', function (ev) {
				const row = ev.target.closest('[role=treeitem]');
				if (row) treeKey[which] = row.dataset.key;
			});
		});

		// The row whose board is on show is drawn as selected (navy).
		function markShown() {
			els.trace.querySelectorAll('.t-row.shown').forEach(function (r) { r.classList.remove('shown'); });
			const v = hover || focused || pinned;
			if (!v) return;
			const row = els.trace.querySelector('[data-key="t' + v.turn.n + ':' + v.entry + '"]');
			if (row) row.classList.add('shown');
		}
		function refreshView() { markShown(); opts.render(); }

		// Pauses and steps are announced to screen readers.
		function announce(text) {
			const live = $('console-live');
			if (!live) return;
			live.textContent = '';
			setTimeout(function () { live.textContent = text; }, 30);
		}
		function stepText() {
			const t = paused.turn, e = t.entries[paused.entry], list = snapEntries(t);
			return 'Step ' + (list.indexOf(paused.entry) + 1) + ' of ' + list.length + ': ' + entryText(t, e).replace(/\.$/, '') + '.';
		}
		function announceStep() { if (paused) announce(stepText()); }

		// Keys while paused or pinned; returns true when handled.
		function handleKey(e) {
			if (pinned && e.key === 'Escape') { pinned = null; refreshView(); return true; }
			if (!paused) return false;
			const k = e.key;
			if (k === 'n' || k === 'N' || k === 'F10') { stepBy(1); announceStep(); }
			else if (k === 'b' || k === 'B') { stepBy(-1); announceStep(); }
			else if (k === 'c' || k === 'C' || k === 'F8') { cont(); announceStep(); }
			else if (k === 'Escape') finish();
			else { els.bar.classList.remove('nudge'); void els.bar.offsetWidth; els.bar.classList.add('nudge'); }
			e.preventDefault();
			return true;
		}

		/////////////////////////////////////////////////////////////////
		// From the app

		function onCompile(res) {
			compileOut.length = 0;
			const errors = res.errors || [];
			errors.filter(function (e) { return e.isError; }).concat(errors.filter(function (e) { return !e.isError; })).forEach(function (e) {
				compileOut.push({ kind: e.isError ? 'error' : 'warn', text: e.message, line: e.line });
			});
			if (res.ok) compileOut.unshift({ kind: 'ok', text: (res.hasErrors ? 'Compiled with errors' : 'Compiled') + (compiled ? ' · ' + compiled.total + ' rules' : ''), line: null });
			else compileOut.unshift({ kind: 'error', text: 'Didn’t compile — the board shows the last version that did.', line: null });
			compiledView = res.ok ? compiled : null;
			compiled = null;
			renderAll();
		}

		// A new playtest: the trace and playtest output start over.
		function startSession(text) {
			if (paused) abort();
			turns = []; sessionOut = []; turnCount = 0; hover = null; pinned = null; focused = null;
			if (text) sessionOut.push({ kind: 'event', text: text, line: null, turn: 0 });
			renderAll();
		}

		function log(text) { sessionOut.push({ kind: 'event', text: text, line: null, turn: turnCount }); renderOutput(); }

		function followCursor(line) {
			if (!compiledView || !compiledView.lines.has(line)) return;
			compiledFocus = line;
			compiledOpen.add(line);
			renderCompiled();
		}

		function setVisible(on) {
			// Re-rendering an already visible panel would replace the row under
			// the pointer between the two clicks of a double-click.
			if (els.panel.hidden === !on) return;
			els.panel.hidden = !on;
			if (on) renderAll();
		}

		renderAll();
		syncPaused();

		return {
			step: step, startSession: startSession, log: log, onCompile: onCompile, abort: abort,
			isPaused: function () { return !!paused; }, handleKey: handleKey,
			viewBoard: viewBoard, bannerHTML: bannerHTML, decorateBoard: decorateBoard,
			followCursor: followCursor, setVisible: setVisible, renderTrace: renderTrace, showTab: showTab
		};
	}

	window.MISConsole = Object.freeze({ create: create });
})();

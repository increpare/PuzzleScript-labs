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
		else rec.entries.push({ kind: 'note', text: plain.replace(/^line \d+ : /, ''), line: lineNumber || null, snap: snap });
	};

	window.consolePrintFromRule = function (text, rule) {
		if (!rec) return;
		rec.entries.push({ kind: 'note', text: plainText(text), line: rule ? rule.lineNumber : null, snap: null });
	};

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
			hover = null; pinned = null;
			const label = typeof input === 'number' ? INPUT_NAMES[input] || 'tick' : String(input);
			const r = record(run, stepOpts.before ? boardSnapshot(stepOpts.before) : null);
			if (stepOpts.optional && !r.captured.entries.length) { renderAll(); commit(r.result); return; }
			const t = buildTurn(label, input, r.captured, r.before);
			addTurn(t);
			const at = els.breakToggle && els.breakToggle.checked ? nextBreak(t, 0) : -1;
			if (at < 0) { renderAll(); commit(r.result); return; }
			paused = { turn: t, entry: at, commit: function () { commit(r.result); } };
			t.open = true;
			opts.showSource();
			showTab('trace');
			renderAll();
			syncPaused();
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
			syncPaused();
			p.commit();
		}

		// Leaving play mode: drop the paused move without committing it.
		function abort() {
			paused = null; hover = null; pinned = null;
			syncPaused();
		}

		function syncPaused() {
			els.bar.hidden = !paused;
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

		function viewRef() { return hover || pinned || (paused ? { turn: paused.turn, entry: paused.entry } : null); }
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
			const head = paused && !hover && !pinned ? 'Paused' : 'Trace';
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

		function lineLink(line) { return line ? '<a class="ln" href="#" data-line="' + line + '">' + line + '</a>' : ''; }

		function ruleText(line) {
			const s = opts.sourceLine(line);
			return s ? '<span class="src">' + escapeHtml(s.trim()) + '</span>' : '';
		}

		function entryHTML(t, e, i, bps) {
			const cls = ['t-row', 'k-' + e.kind];
			const cur = paused && paused.turn === t && paused.entry === i;
			if (cur) cls.push('cur');
			if (pinned && pinned.turn === t && pinned.entry === i) cls.push('pin');
			if (e.snap === null || e.snap === undefined || !t.snaps) cls.push('nosnap');
			let body;
			const mark = e.kind === 'rule' && bps.has(e.line) ? '<span class="bp-dot" title="Breakpoint"></span>' : '<span class="bp-gap"></span>';
			// No direction: the engine stores left/up rules as reversed right/down
			// ones, so the direction it reports would often look wrong.
			if (e.kind === 'rule') body = mark + lineLink(e.line) + ' ' + ruleText(e.line);
			else if (e.kind === 'command') body = mark + lineLink(e.line) + ' <span class="cmd">' + escapeHtml(e.cmd) + '</span>';
			else if (e.kind === 'start') body = mark + (e.again ? '<b>again</b> · new turn' : e.input ? 'movement applied (' + escapeHtml(e.input) + ')' : 'rules run with no input');
			else body = mark + (e.line ? lineLink(e.line) + ' ' : '') + escapeHtml(e.text);
			return '<div class="' + cls.join(' ') + '" data-turn="' + t.n + '" data-entry="' + i + '">' + (cur ? '▶ ' : '') + body + '</div>';
		}

		function turnSummary(t) {
			const parts = [t.rules ? t.rules + (t.rules === 1 ? ' rule' : ' rules') : 'no rules fired'];
			if (t.agains) parts.push(t.agains + ' again');
			return parts.join(' · ');
		}

		function renderTrace() {
			if (tab !== 'trace' || els.panel.hidden) return;
			if (!turns.length) {
				els.trace.innerHTML = '<div class="c-empty">Play the level and every move is traced here: which rules fired and in what order. Hover a row to see the board at that moment.<br><br>Click the margin left of a rule line in Game source to set a breakpoint; play stops when that rule fires.</div>';
				return;
			}
			const stick = els.trace.scrollTop + els.trace.clientHeight >= els.trace.scrollHeight - 4;
			const bps = new Set(opts.getBreakpoints());
			const last = turns[turns.length - 1];
			let html = '';
			turns.forEach(function (t) {
				const open = t.open === null ? t === last : t.open;
				html += '<div class="t-turn' + (open ? ' open' : '') + '" data-turn="' + t.n + '"><span class="tw">' + (open ? '▾' : '▸') + '</span> Turn ' + t.n + ' · ' + escapeHtml(t.label) + ' <span class="faint">· ' + turnSummary(t) + '</span></div>';
				if (open) t.entries.forEach(function (e, i) { html += entryHTML(t, e, i, bps); });
			});
			els.trace.innerHTML = html;
			const cur = els.trace.querySelector('.t-row.cur');
			if (cur) cur.scrollIntoView({ block: 'nearest' });
			else if (stick) els.trace.scrollTop = els.trace.scrollHeight;
		}

		function renderOutput() {
			if (tab !== 'output' || els.panel.hidden) return;
			let html = compileOut.map(function (o) {
				return '<div class="o-row k-' + o.kind + '">' + (o.line ? lineLink(o.line) + ' ' : '') + escapeHtml(o.text) + '</div>';
			}).join('');
			if (sessionOut.length) html += '<div class="o-sep">Playtest</div>';
			html += sessionOut.map(function (o) {
				return '<div class="o-row k-' + o.kind + '"><span class="faint">' + (o.turn ? 'turn ' + o.turn : '') + '</span> ' +
					(o.kind === 'message' ? 'message: “' + escapeHtml(o.text) + '”' : escapeHtml(o.text)) + (o.line ? ' ' + lineLink(o.line) : '') + '</div>';
			}).join('');
			els.output.innerHTML = html;
			els.output.scrollTop = els.output.scrollHeight;
		}

		function renderCompiled() {
			if (tab !== 'compiled' || els.panel.hidden) return;
			if (!compiledView) { els.compiled.innerHTML = '<div class="c-empty">No compiled rules: the game didn’t compile.</div>'; return; }
			const lines = Array.from(compiledView.lines.keys()).sort(function (a, b) { return a - b; });
			let html = '<div class="c-head">' + compiledView.total + ' compiled rules from ' + lines.length + ' source lines' +
				(compiledView.removed ? ' · ' + compiledView.removed + ' duplicates removed' : '') + '</div>';
			// Rule lines and loop markers in source order; loop bodies indented.
			const items = lines.map(function (line) { return { line: line }; })
				.concat(compiledView.loops.map(function (l) { return { line: l.line, loop: l.start ? 'startloop' : 'endloop' }; }))
				.sort(function (a, b) { return a.line - b.line; });
			let depth = 0;
			items.forEach(function (item) {
				const line = item.line;
				if (item.loop === 'endloop') depth = Math.max(0, depth - 1);
				const indent = '<span class="c-indent" style="width:' + (depth * 14) + 'px"></span>';
				if (item.loop) {
					html += '<div class="c-loop">' + indent + '<span class="tw"></span>' + lineLink(line) + ' <b>' + item.loop + '</b></div>';
					if (item.loop === 'startloop') depth++;
					return;
				}
				const list = compiledView.lines.get(line), open = compiledOpen.has(line);
				html += '<div class="c-line' + (open ? ' open' : '') + (compiledFocus === line ? ' focus' : '') + '" data-line="' + line + '">' + indent + '<span class="tw">' + (open ? '▾' : '▸') + '</span>' +
					lineLink(line) + ' ' + ruleText(line) + ' <span class="faint">→ ' + list.length + (list.length === 1 ? ' rule' : ' rules') + '</span></div>';
				if (open) list.forEach(function (text) { html += '<div class="c-sub">' + indent + escapeHtml(text) + '</div>'; });
			});
			els.compiled.innerHTML = html;
			const focus = els.compiled.querySelector('.c-line.focus');
			if (focus) focus.scrollIntoView({ block: 'nearest' });
		}

		function renderTabs() {
			const problems = compileOut.filter(function (o) { return o.kind === 'error' || o.kind === 'warn'; }).length;
			els.tabs.forEach(function (b) {
				b.classList.toggle('on', b.dataset.ctab === tab);
				if (b.dataset.ctab === 'output') {
					b.textContent = 'Output' + (problems ? ' (' + problems + ')' : '');
					b.classList.toggle('bad', compileOut.some(function (o) { return o.kind === 'error'; }));
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

		els.tabs.forEach(function (b) { b.onclick = function () { showTab(b.dataset.ctab); }; });
		els.clear.onclick = function () {
			if (paused) finish();
			turns = []; sessionOut = []; hover = null; pinned = null;
			renderAll(); opts.render();
		};
		els.breakToggle.onchange = function () { renderTrace(); };
		$('dbg-back').onclick = function () { stepBy(-1); };
		$('dbg-step').onclick = function () { stepBy(1); };
		$('dbg-continue').onclick = cont;
		$('dbg-finish').onclick = finish;

		els.panel.addEventListener('click', function (ev) {
			const ln = ev.target.closest('a.ln');
			if (ln) { ev.preventDefault(); opts.revealLine(+ln.dataset.line); return; }
			const head = ev.target.closest('.t-turn');
			if (head) {
				const t = turns.find(function (x) { return x.n === +head.dataset.turn; });
				if (t) { t.open = !head.classList.contains('open'); renderTrace(); }
				return;
			}
			const row = ev.target.closest('.t-row');
			if (row) {
				const t = turns.find(function (x) { return x.n === +row.dataset.turn; });
				const i = +row.dataset.entry;
				if (!t) return;
				if (paused && paused.turn === t && t.entries[i].snap !== null && t.entries[i].snap !== undefined) { paused.entry = i; hover = null; syncPaused(); return; }
				pinned = pinned && pinned.turn === t && pinned.entry === i ? null : { turn: t, entry: i };
				renderTrace(); opts.render();
				return;
			}
			const cl = ev.target.closest('.c-line');
			if (cl) {
				const line = +cl.dataset.line;
				if (compiledOpen.has(line)) compiledOpen.delete(line); else compiledOpen.add(line);
				renderCompiled();
			}
		});
		els.trace.addEventListener('mouseover', function (ev) {
			const row = ev.target.closest('.t-row');
			const t = row && turns.find(function (x) { return x.n === +row.dataset.turn; });
			const next = t && t.snaps && t.entries[+row.dataset.entry].snap !== null && t.entries[+row.dataset.entry].snap !== undefined ? { turn: t, entry: +row.dataset.entry } : null;
			if ((next && hover && next.turn === hover.turn && next.entry === hover.entry) || (!next && !hover)) return;
			hover = next;
			opts.render();
		});
		els.trace.addEventListener('mouseleave', function () { if (hover) { hover = null; opts.render(); } });

		// Keys while paused or pinned; returns true when handled.
		function handleKey(e) {
			if (pinned && e.key === 'Escape') { pinned = null; renderTrace(); opts.render(); return true; }
			if (!paused) return false;
			const k = e.key;
			if (k === 'n' || k === 'N' || k === 'F10') stepBy(1);
			else if (k === 'b' || k === 'B') stepBy(-1);
			else if (k === 'c' || k === 'C' || k === 'F8') cont();
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
			turns = []; sessionOut = []; turnCount = 0; hover = null; pinned = null;
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

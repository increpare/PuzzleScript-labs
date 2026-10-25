'use strict';

// MIS95 - page controller.
//
// Owns the source text (the single source of truth), the compiled model, the
// board editor, the level strip, the transformer session and the workers.

(function () {

	const $ = function (id) { return document.getElementById(id); };
	const C = MISCore;
	const desktop = window.misDesktop;
	// The worker sits next to this script. Resolving against the script rather
	// than the page keeps it found in the release build, which serves js/source/.
	const WORKER_URL = new URL('mis_worker.js', document.currentScript.src).href;

	const DEMOS = [
		['Simple Block Pushing (Sokoban)', 'demo/sokoban_basic.txt'],
		['Microban', 'demo/microban.txt'],
		['Two Little Crates', 'demo/twolittlecrates1.txt'],
		['Ice Crates', 'demo/icecrates.txt'],
		['Heroes of Sokoban', 'demo/heroes_of_sokoban.txt'],
		['All Green to Blue', 'tests/good_games/ALL GREEN TO BLUE.txt'],
		['Lunar Lockout', 'demo/lunar_lockout.txt'],
		['Zokoban', 'demo/zokoban.txt'],
		['Castle Closet', 'demo/castlecloset.txt'],
	];

	// While generating, level-health solves pause and the focus worker is
	// idle, so all but one core (the page) can generate. ?genWorkers=N overrides.
	const GEN_WORKERS = (function () {
		const forced = parseInt(new URLSearchParams(location.search).get('genWorkers'), 10);
		if (forced > 0) return forced;
		return Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
	})();
	const SHOWN_CARDS = 8;

	/////////////////////////////////////////////////////////////////////
	// App state
	/////////////////////////////////////////////////////////////////////

	const app = {
		source: '',
		fileName: 'game.txt',
		filePath: null,
		model: null,             // last good compiled model
		rulesSig: 0,             // hash of source minus LEVELS
		levelIndex: 0,
		board: null,             // working copy of the current level
		mode: 'edit',
		brush: null,             // palette entry {ids, label}
		palette: [],
		locks: {},               // levelIndex -> Uint8Array (1 = locked)
		transform: '',
		presetId: null,
		preview: null,           // {board, label} shown instead of the level
		watching: null,          // {frames, i, timer}
		play: null,              // {history:[Int32Array], moves}
		blind: false,
		backendPref: 'native',   // 'native' (WebAssembly build of the C++ solver) or 'js'
		revealed: false,
		dirty: false,
		undo: [],
		redo: [],
		assessCache: new Map(),  // rulesSig|boardKey -> result
		lineage: {},             // levelIndex -> {nodes:[], cur}
		cards: [],               // pool of suggestions
		pinned: [],
		special: null,           // simplify/tighten result card
		gen: null,               // current level’s generation session
		rules: null,             // compiled rule lines: { lines, random, keyOf, lineOf }
		ruleTags: {},            // line -> 'cosmetic' | 'inert' (from the workers' analysis)
		ruleGoals: {},           // levelIndex -> { rule key: 'need' | 'ban' }
		breakpoints: new Set(),  // rule keys with a breakpoint (whole game)
	};

	// Selection changes the workspace aliases; background jobs keep their own
	// stable identity even when a new level is inserted before them.
	app.workspaces = {};
	app.defaultTransform = '';
	let nextWorkspaceId = 1;
	function workspace(index) {
		index = index === undefined ? app.levelIndex : index;
		if (!app.workspaces[index]) app.workspaces[index] = {
			id: 'level-' + nextWorkspaceId++, levelIndex: +index,
			transform: app.defaultTransform, presetId: null, cards: [], pinned: [], special: null, gen: null,
			boardKey: app.model && app.model.levels[index] && app.model.levels[index].board ? boardIdentity(app.model.levels[index].board) : null,
		};
		return app.workspaces[index];
	}
	['transform', 'presetId', 'cards', 'pinned', 'special', 'gen'].forEach(function (key) {
		Object.defineProperty(app, key, { configurable: true, get: function () { return workspace()[key]; }, set: function (value) { workspace()[key] = value; } });
	});
	function boardIdentity(board) { return board.w + 'x' + board.h + '|' + C.cellsKey(board.cells); }
	function hasGeneration() { return !!(app.generationPool && app.generationPool.activeCount()); }
	function copyLevelSettings(from, to) {
		const src = workspace(from), dst = workspace(to);
		dst.transform = src.transform; dst.presetId = src.presetId;
		if (app.locks[from]) app.locks[to] = app.locks[from].slice();
		if (app.ruleGoals[from]) app.ruleGoals[to] = Object.assign({}, app.ruleGoals[from]);
	}
	function shiftLevelSettings(after, amount) {
		[app.workspaces, app.locks, app.ruleGoals, app.lineage].forEach(function (map) {
			Object.keys(map).map(Number).filter(function (i) { return i > after; }).sort(function (a, b) { return b - a; }).forEach(function (i) {
				map[i + amount] = map[i]; delete map[i];
			});
		});
		Object.keys(app.workspaces).forEach(function (key) {
			const ws = app.workspaces[key]; ws.levelIndex = +key;
			if (ws.gen) ws.gen.levelIndex = +key;
			ws.cards.concat(ws.pinned).forEach(function (card) { card.levelIndex = +key; });
			if (ws.special) ws.special.levelIndex = +key;
		});
	}
	function syncWorkspaceEditor() {
		if (!transformCM) return;
		const ws = workspace();
		suppressTransformChange = true;
		if (app.editorWorkspace !== ws) {
			if (app.editorWorkspace) app.editorWorkspace.editorState = transformCM.documentState();
			if (ws.editorState && ws.editorState.doc.toString() === ws.transform) transformCM.restoreDocument(ws.editorState);
			else transformCM.newDocument(ws.transform);
			app.editorWorkspace = ws;
		} else if (transformCM.getValue() !== app.transform) transformCM.setValue(app.transform);
		suppressTransformChange = false;
		app.presetId = presetIdForText(app.transform);
		markPresets(); validateTransform(); updateGenButton(); updateMeter();
		$('transform-level').textContent = 'Level ' + (countPlayableBefore(app.levelIndex) + 1);
	}
	function invalidateWorkspace(ws, clearPins) {
		const running = ws.gen && ws.gen.running;
		if (ws.restartTransform) { clearTimeout(ws.restartTransform); ws.restartTransform = null; }
		if (ws.gen) ws.gen.running = false;
		if (app.generationPool) app.generationPool.pause(ws.id);
		ws.gen = null; ws.cards = []; ws.special = null;
		if (clearPins) ws.pinned = [];
		return running;
	}
	function invalidateAllWorkspaces() {
		Object.values(app.workspaces).forEach(function (ws) { invalidateWorkspace(ws, true); });
		if (app.generationPool) { app.generationPool.destroy(); app.generationPool = null; }
	}

	/////////////////////////////////////////////////////////////////////
	// Workers
	/////////////////////////////////////////////////////////////////////

	function spawnWorker(source) {
		const w = new Worker(WORKER_URL);
		const handle = { w: w, ready: false, busy: false, queue: [], handlers: {}, onReady: null, dead: false };
		w.onmessage = function (e) {
			const m = e.data;
			if (m.type === 'ready') {
				handle.ready = true;
				handle.backend = m.backend;
				if (m.ok) showBackend(m.backend, m.note);
				if (m.ok && (handle === focusWorker || handle === ruleWorker)) { app.ruleTags = m.ruleTags || {}; renderRuleGutter(); }
				if (handle.onReady) handle.onReady(m);
				pump(handle);
				return;
			}
			if (m.id !== undefined && handle.handlers[m.id]) {
				const h = handle.handlers[m.id];
				if (m.type === 'progress') { if (h.progress) h.progress(m); return; }
				delete handle.handlers[m.id];
				handle.busy = false;
				h.done(m);
				pump(handle);
				return;
			}
			if (handle.onMessage) handle.onMessage(m);
		};
		w.onerror = function (e) {
			console.error('MIS worker error', e.message);
			const job = handle.current;
			kill(handle);
			if (job && handle.handlers[job.msg.id]) {
				delete handle.handlers[job.msg.id];
				handle.busy = false;
				job.done({ type: 'error', message: e.message || 'Solver worker failed.' });
			} else if (handle.onMessage) handle.onMessage({ type: 'genError', message: e.message || 'Solver worker failed.' });
		};
		w.postMessage({ type: 'init', source: source, backend: app.backendPref });
		return handle;
	}

	let nextJobId = 1;
	function pump(handle) {
		if (!handle.ready || handle.busy || !handle.queue.length || handle.dead) return;
		// Background (level-health) jobs wait while the transformer runs, so the
		// generator workers get the CPU.
		let at = 0;
		if (hasGeneration()) {
			at = handle.queue.findIndex(function (j) { return !j.background; });
			if (at < 0) return;
		}
		const job = handle.queue.splice(at, 1)[0];
		handle.busy = true;
		handle.handlers[job.msg.id] = job;
		handle.current = job;
		handle.w.postMessage(job.msg);
	}
	function enqueue(handle, msg, done, progress, front, background) {
		msg.id = nextJobId++;
		const job = { msg: msg, done: done, progress: progress, background: !!background };
		if (front) handle.queue.unshift(job); else handle.queue.push(job);
		pump(handle);
		return msg.id;
	}
	function kill(handle) {
		if (!handle) return;
		handle.dead = true;
		handle.w.terminate();
	}

	let focusWorker = null;   // current-level analysis (restarted on every change)
	let bgWorker = null;      // level health + simplify
	let workerSourceSig = null;

	function ensureWorkers(force) {
		// Workers only need the rules; boards are always sent explicitly, so
		// level edits don't require a restart.
		if (!force && focusWorker && bgWorker && ruleWorker && workerSourceSig === app.rulesSig) return;
		kill(focusWorker); kill(bgWorker); kill(ruleWorker);
		focusWorker = spawnWorker(app.source);
		bgWorker = spawnWorker(app.source);
		ruleWorker = spawnWorker(app.source);
		ruleWorkerKey = null;
		workerSourceSig = app.rulesSig;
		healthQueued.clear();
		if (simplifyRunning) { simplifyRunning = false; $('simplify-btn').textContent = '✂ Simplify'; }
	}

	function packBoard(b) { return { w: b.w, h: b.h, cells: Array.from(b.cells) }; }
	function unpackBoard(b) { return { w: b.w, h: b.h, cells: new Int32Array(b.cells) }; }

	/////////////////////////////////////////////////////////////////////
	// Source, compile, model
	/////////////////////////////////////////////////////////////////////

	function rulesSignature(text) {
		const lines = text.split('\n');
		const found = C.findSections(lines);
		const lv = found.sections.levels;
		const keep = lv ? lines.slice(0, lv.start) : lines;
		return C.hashString(keep.join('\n'));
	}

	// Recompile `text`. Returns true if it compiled.
	function compileSource(text) {
		const res = misCompile(text);
		if (misConsole) misConsole.onCompile(res);
		document.title = 'MIS95';
		showSourceDiagnostics(res.errors, res.ok, res.hasErrors);
		if (!res.ok) return false;
		let model = null;
		try { model = C.extractModel(text); } catch (e) { console.error(e); }
		if (!model) return false;
		const oldModel = app.model;
		app.model = model;
		app.compiledText = text;
		app.rules = computeRules(text);
		if (!model.levelMapOK) $('source-diag').insertAdjacentHTML('afterbegin', '<div class="warn">Note: this LEVELS layout can\'t be edited from the board (read-only).</div>');
		const sig = rulesSignature(text);
		const rulesChanged = sig !== app.rulesSig;
		app.rulesSig = sig;
		if (rulesChanged) {
			app.editorWorkspace = null; Object.values(app.workspaces).forEach(function (ws) { delete ws.editorState; });
			if (oldModel) invalidateAllWorkspaces();
			app.ruleTags = {};
			transformCM.setGameSource(text);
			ensureWorkers(true);
			buildPalette();
			buildPresets();
			buildTighten();
		}
		$('game-title').textContent = (model.metadata.title || app.fileName) + (model.metadata.author ? ' — ' + model.metadata.author : '');
		return true;
	}

	function setSource(text, opts) {
		opts = opts || {};
		if (!opts.noUndo && app.source && text !== app.source) pushUndo(!!opts.levelEdit);
		app.source = text;
		if (!opts.fromEditor && sourceCM && sourceCM.getValue() !== text) {
			suppressSourceChange = true;
			const scroll = sourceCM.getScrollInfo();
			sourceCM.setValue(text);
			sourceCM.scrollTo(scroll.left, scroll.top);
			suppressSourceChange = false;
		}
		const oldModel = app.model, oldSig = app.rulesSig;
		const levelEditStates = opts.levelEdit ? Object.values(app.workspaces).map(function (ws) { return { ws: ws, cards: ws.cards, pinned: ws.pinned, running: !!((ws.gen && ws.gen.running) || ws.restartTransform) }; }) : [];
		const ok = compileSource(text);
		if (ok) {
			syncBreakpoints(!!opts.fromEditor);
			if (opts.fromEditor && oldModel && (oldModel.levels.length !== app.model.levels.length || app.model.levels.some(function (lv, i) { return lv.board && oldModel.levels[i] && oldModel.levels[i].board && !C.boardsEqual(lv.board, oldModel.levels[i].board) && oldModel.levels.some(function (old, j) { return j !== i && old.board && C.boardsEqual(old.board, lv.board); }); }))) {
				invalidateAllWorkspaces(); app.workspaces = {}; app.locks = {}; app.ruleGoals = {}; app.lineage = {};
				toast('Level order changed — generation paused. Check each level’s settings before restarting.');
			}
			const restart = [];
			if (opts.levelEdit && oldSig !== app.rulesSig) levelEditStates.forEach(function (state) {
				const lv = app.model.levels[state.ws.levelIndex];
				if (lv && lv.board && boardIdentity(lv.board) === state.ws.boardKey) { state.ws.cards = state.cards; state.ws.pinned = state.pinned; }
				if (state.running) restart.push(state.ws.levelIndex);
			});
			Object.values(app.workspaces).forEach(function (ws) {
				const lv = app.model.levels[ws.levelIndex];
				if (!lv || !lv.board) { invalidateWorkspace(ws, true); return; }
				const key = boardIdentity(lv.board);
				if (ws.boardKey && ws.boardKey !== key) { if (invalidateWorkspace(ws, false)) restart.push(ws.levelIndex); }
				ws.boardKey = key;
			});
			const n = app.model.levels.length;
			if (app.levelIndex >= n) app.levelIndex = n - 1;
			if (app.model.levels[app.levelIndex].message !== undefined && !opts.keepMessage) {
				const firstPlayable = nearestPlayable(app.levelIndex);
				if (firstPlayable >= 0) app.levelIndex = firstPlayable;
			}
			loadCurrentBoard();
			refreshLevelStrip();
			syncWorkspaceEditor();
			restart.forEach(function (i) { startGeneration(i); });
		}
		markDirty(!opts.clean);
		autosave();
		return ok;
	}

	function canonicalizeSource(options) {
		const input = sourceCM.getValue();
		let output;
		try { output = MISTools.canonicalize(input, options); }
		catch (error) { toast(error.message || String(error), true); return; }
		clearTimeout(initEditors.t);
		// Flush any typing still waiting on the compile debounce, so both undo
		// histories restore exactly the text the author saw before the command.
		if (input !== app.source) setSource(input, { fromEditor: true });
		setMode('edit');
		showTab('source');
		if (output !== input) setSource(output);
		sourceCM.focus();
		toast(output === input ? 'Already canonical.' : 'Canonicalized — undo with Ctrl+Z.');
	}

	function nearestPlayable(from) {
		const lv = app.model.levels;
		for (let d = 0; d < lv.length; d++) {
			if (lv[from + d] && lv[from + d].board) return from + d;
			if (lv[from - d] && lv[from - d].board) return from - d;
		}
		return -1;
	}

	function currentLevel() { return app.model && app.model.levels[app.levelIndex]; }

	function loadCurrentBoard() {
		const lv = currentLevel();
		app.board = lv && lv.board ? C.cloneBoard(lv.board) : null;
		if (app.board) {
			const locks = app.locks[app.levelIndex];
			if (!locks || locks.length !== app.board.w * app.board.h) app.locks[app.levelIndex] = new Uint8Array(app.board.w * app.board.h);
			ensureLineageRoot();
		}
		stopWatching();
		if (app.mode === 'play') enterPlay();
		layoutBoard();
		analyzeCurrent();
		renderLineage();
	}

	// Commit the working board into the source text.
	function commitBoard(label, opts) {
		if (!app.board || !app.model) return;
		if (!app.model.levelMapOK) {
			toast("Can't write this level back into the source (unusual LEVELS layout).", true);
			return;
		}
		let text;
		try { text = C.writeLevelToSource(app.model, app.source, app.levelIndex, app.board); }
		catch (e) { toast(e.message, true); return; }
		recordLineage(label || 'edit', app.board);
		setSource(text, Object.assign({ levelEdit: true }, opts));
	}

	function markDirty(on) {
		app.dirty = on;
		$('dirty-dot').classList.toggle('on', on);
	}

	/////////////////////////////////////////////////////////////////////
	// Undo / redo (whole-document snapshots)
	/////////////////////////////////////////////////////////////////////

	function snapshot(levelEdit) {
		const locks = {};
		Object.keys(app.locks).forEach(function (k) { locks[k] = Array.from(app.locks[k]); });
		return { levelEdit: !!levelEdit, source: app.source, levelIndex: app.levelIndex, locks: locks, ruleGoals: JSON.parse(JSON.stringify(app.ruleGoals)), lineage: Object.fromEntries(Object.entries(app.lineage).map(function (entry) { return [entry[0], { cur: entry[1].cur, nodes: entry[1].nodes.map(function (node) { return Object.assign({}, node); }) }]; })), workspaces: Object.fromEntries(Object.entries(app.workspaces).map(function (entry) { return [entry[0], Object.assign({}, entry[1], { wasGenerating: !!((entry[1].gen && entry[1].gen.running) || entry[1].restartTransform) })]; })) };
	}
	function restoreSnapshot(s) {
		const current = new Map(Object.values(app.workspaces).map(function (ws) { return [ws.id, ws]; }));
		const restored = {}, resume = [];
		Object.entries(s.workspaces || {}).forEach(function (entry) {
			const index = +entry[0], saved = entry[1], live = current.get(saved.id);
			const oldIndex = live ? live.levelIndex : index;
			const same = live && live.boardKey === saved.boardKey && live.transform === saved.transform &&
				JSON.stringify(Array.from(app.locks[oldIndex] || [])) === JSON.stringify(s.locks[index] || []) &&
				JSON.stringify(app.ruleGoals[oldIndex] || {}) === JSON.stringify((s.ruleGoals || {})[index] || {});
			if (same) restored[index] = live;
			else {
				const running = live && live.gen && live.gen.running;
				if (live) invalidateWorkspace(live, true);
				restored[index] = Object.assign({}, saved, { gen: null, special: null, restartTransform: null });
				if (running || saved.wasGenerating) resume.push(index);
			}
			const ws = restored[index]; ws.levelIndex = index;
			if (ws.gen) ws.gen.levelIndex = index;
			ws.cards.concat(ws.pinned).forEach(function (card) { card.levelIndex = index; });
			current.delete(saved.id);
		});
		current.forEach(function (ws) { invalidateWorkspace(ws, true); });
		app.workspaces = restored;
		app.locks = {};
		Object.keys(s.locks).forEach(function (k) { app.locks[k] = Uint8Array.from(s.locks[k]); });
		app.levelIndex = s.levelIndex; app.ruleGoals = s.ruleGoals || {}; app.lineage = s.lineage || {};
		setSource(s.source, { noUndo: true, levelEdit: s.levelEdit });
		resume.forEach(function (index) { startGeneration(index); });
		renderRuleGutter();
	}

	function pushUndo(levelEdit) {
		app.undo.push(snapshot(levelEdit));
		if (app.undo.length > 200) app.undo.shift();
		app.redo.length = 0;
		updateUndoButtons();
	}
	function doUndo() {
		if (!app.undo.length) return;
		const target = app.undo.pop();
		app.redo.push(snapshot(target.levelEdit));
		restoreSnapshot(target);
		updateUndoButtons();
	}
	function doRedo() {
		if (!app.redo.length) return;
		const target = app.redo.pop();
		app.undo.push(snapshot(target.levelEdit));
		restoreSnapshot(target);
		updateUndoButtons();
	}
	function updateUndoButtons() {
		$('undo-btn').disabled = !app.undo.length;
		$('redo-btn').disabled = !app.redo.length;
	}

	/////////////////////////////////////////////////////////////////////
	// Lineage (branching history per level)
	/////////////////////////////////////////////////////////////////////

	function lineageFor(i) {
		if (!app.lineage[i]) app.lineage[i] = { nodes: [], cur: -1 };
		return app.lineage[i];
	}
	function ensureLineageRoot() {
		const L = lineageFor(app.levelIndex);
		if (L.nodes.length === 0) {
			L.nodes.push({ id: 0, parent: -1, board: C.cloneBoard(app.board), label: 'start' });
			L.cur = 0;
			return;
		}
		// If the board changed outside the lineage (typing in the source), follow it.
		const cur = L.nodes[L.cur];
		if (cur && !C.boardsEqual(cur.board, app.board)) {
			const match = L.nodes.findIndex(function (n) { return C.boardsEqual(n.board, app.board); });
			if (match >= 0) L.cur = match;
			else addLineageNode(L, 'source edit', app.board);
		}
	}
	function addLineageNode(L, label, board) {
		const cur = L.nodes[L.cur];
		const hasKids = L.nodes.some(function (n) { return n.parent === L.cur; });
		// Consecutive hand edits collapse into one step.
		if (cur && label === 'edit' && cur.label === 'edit' && !hasKids) { cur.board = C.cloneBoard(board); return; }
		L.nodes.push({ id: L.nodes.length, parent: L.cur, board: C.cloneBoard(board), label: label });
		L.cur = L.nodes.length - 1;
	}
	function recordLineage(label, board) {
		addLineageNode(lineageFor(app.levelIndex), label, board);
	}
	function renderLineage() {
		const el = $('lineage');
		el.innerHTML = '';
		const L = app.lineage[app.levelIndex];
		if (!L || !L.nodes.length || !app.model) return;
		const path = [];
		for (let n = L.cur; n >= 0; n = L.nodes[n].parent) path.unshift(n);
		const onPath = {};
		path.forEach(function (n) { onPath[n] = true; });
		const leaves = L.nodes.filter(function (n) { return !onPath[n.id] && !L.nodes.some(function (m) { return m.parent === n.id; }); });
		const addNode = function (n, cls) {
			const d = document.createElement('div');
			d.className = 'node' + (n.id === L.cur ? ' cur' : '') + (cls ? ' ' + cls : '');
			d.title = n.label + (n.id === L.cur ? ' (current)' : ' — click to return here');
			d.appendChild(thumbCanvas(n.board, 26));
			d.onclick = function () { gotoLineage(n.id); };
			d.onmouseenter = function () { setPreview(n.board, n.label); };
			d.onmouseleave = function () { setPreview(null); };
			el.appendChild(d);
		};
		const shown = path.slice(-7);
		if (path.length > shown.length) { const s = document.createElement('span'); s.className = 'arrow'; s.textContent = '…'; el.appendChild(s); }
		shown.forEach(function (id, i) {
			if (i > 0) { const a = document.createElement('span'); a.className = 'arrow'; a.textContent = '›'; el.appendChild(a); }
			addNode(L.nodes[id]);
		});
		if (leaves.length) {
			const s = document.createElement('span'); s.className = 'arrow'; s.textContent = '  other branches:'; el.appendChild(s);
			leaves.slice(-4).forEach(function (n) { addNode(n); });
		}
	}
	function gotoLineage(id) {
		const L = lineageFor(app.levelIndex);
		const n = L.nodes[id];
		if (!n) return;
		L.cur = id;
		app.board = C.cloneBoard(n.board);
		const text = C.writeLevelToSource(app.model, app.source, app.levelIndex, app.board);
		setPreview(null);
		setSource(text);
	}

	/////////////////////////////////////////////////////////////////////
	// Rendering
	/////////////////////////////////////////////////////////////////////

	const spriteCache = new Map();
	function spriteFor(id) {
		const key = app.rulesSig + ':' + id;
		if (spriteCache.has(key)) return spriteCache.get(key);
		const o = app.model.objects[id];
		const m = o.sprite && o.sprite.length ? o.sprite : null;
		const h = m ? m.length : 1, w = m ? m[0].length : 1;
		const cv = document.createElement('canvas');
		cv.width = w; cv.height = h;
		const ctx = cv.getContext('2d');
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const ci = m ? m[y][x] : 0;
				if (ci < 0 || ci === '.' || ci === undefined) continue;
				const col = o.colors[ci];
				if (!col || col === 'transparent') continue;
				ctx.fillStyle = col;
				ctx.fillRect(x, y, 1, 1);
			}
		}
		spriteCache.set(key, cv);
		return cv;
	}

	let drawOrder = null;
	function objectDrawOrder() {
		if (drawOrder && drawOrder.sig === app.rulesSig) return drawOrder.ids;
		const ids = app.model.objects.filter(Boolean).map(function (o) { return o.id; });
		ids.sort(function (a, b) { return app.model.objects[a].layer - app.model.objects[b].layer || a - b; });
		drawOrder = { sig: app.rulesSig, ids: ids };
		return ids;
	}

	function drawBoard(ctx, board, ox, oy, cell) {
		const m = app.model;
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = m.bgcolor || '#000';
		ctx.fillRect(ox, oy, board.w * cell, board.h * cell);
		const order = objectDrawOrder();
		for (let x = 0; x < board.w; x++) {
			for (let y = 0; y < board.h; y++) {
				const tile = x * board.h + y;
				for (let k = 0; k < order.length; k++) {
					const id = order[k];
					if (C.hasBit(board.cells, tile, id, m.stride)) ctx.drawImage(spriteFor(id), ox + x * cell, oy + y * cell, cell, cell);
				}
			}
		}
	}

	function thumbCanvas(board, height) {
		const cell = Math.max(2, Math.floor(height / board.h));
		const cv = document.createElement('canvas');
		cv.width = board.w * cell; cv.height = board.h * cell;
		drawBoard(cv.getContext('2d'), board, 0, 0, cell);
		return cv;
	}

	function renderThumbInto(cv, board, maxW, maxH) {
		const cell = Math.max(2, Math.min(Math.floor(maxW / board.w), Math.floor(maxH / board.h)));
		cv.width = board.w * cell; cv.height = board.h * cell;
		drawBoard(cv.getContext('2d'), board, 0, 0, cell);
	}

	const boardCanvas = $('board');
	const view = { cell: 16, dpr: 1 };
	let hoverTile = -1;

	function layoutBoard() {
		const wrap = $('board-wrap');
		const b = displayedBoard();
		if (!b) {
			boardCanvas.width = 10; boardCanvas.height = 10;
			boardCanvas.style.width = '0px';
			return;
		}
		const padding = getComputedStyle(wrap);
		const aw = wrap.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight), ah = wrap.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
		const cell = Math.max(1, Math.floor(Math.min((aw - 24) / b.w, (ah - 24) / b.h)));
		const dpr = window.devicePixelRatio || 1;
		view.cell = cell; view.dpr = dpr;
		boardCanvas.style.width = (b.w * cell) + 'px';
		boardCanvas.style.height = (b.h * cell) + 'px';
		boardCanvas.width = Math.round(b.w * cell * dpr);
		boardCanvas.height = Math.round(b.h * cell * dpr);
		renderBoard();
		updateResizeHandles();
	}

	function displayedBoard() {
		if (app.watching) return app.watching.frames[app.watching.i];
		const traced = misConsole && misConsole.viewBoard(); // a trace row hovered, pinned or paused at
		if (traced) return traced;
		if (app.mode === 'play' && app.play) return app.play.board;
		if (app.preview) return app.preview.board;
		return app.board;
	}

	function renderBoard() {
		const b = displayedBoard();
		if (!b || !app.model) return;
		if (Math.round(b.w * view.cell * view.dpr) !== boardCanvas.width || Math.round(b.h * view.cell * view.dpr) !== boardCanvas.height) { layoutBoard(); return; }
		const ctx = boardCanvas.getContext('2d');
		ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		const cell = view.cell;
		drawBoard(ctx, b, 0, 0, cell);
		const locks = app.locks[app.levelIndex];
		const showLocks = locks && app.mode !== 'play' && !app.watching;
		if (showLocks) {
			for (let t = 0; t < locks.length; t++) {
				if (!locks[t]) continue;
				const x = Math.floor(t / b.h), y = t % b.h;
				ctx.fillStyle = app.mode === 'lock' ? 'rgba(120,70,220,0.42)' : 'rgba(120,70,220,0.18)';
				ctx.fillRect(x * cell, y * cell, cell, cell);
				if (app.mode === 'lock' || cell >= 16) {
					ctx.strokeStyle = 'rgba(200,170,255,0.55)';
					ctx.lineWidth = 1;
					ctx.beginPath();
					for (let k = -cell; k < cell; k += Math.max(4, cell / 4)) {
						ctx.moveTo(x * cell + Math.max(0, k), y * cell + Math.max(0, -k));
						ctx.lineTo(x * cell + Math.min(cell, cell + k), y * cell + Math.min(cell, cell - k));
					}
					ctx.stroke();
				}
			}
		}
		// Diff against the committed level (previews, watching).
		if ((app.preview || app.watching) && app.board && b.w === app.board.w && b.h === app.board.h) {
			const diff = C.diffTiles(app.board, b, app.model.stride);
			ctx.lineWidth = Math.max(2, cell / 10);
			ctx.strokeStyle = app.watching ? 'rgba(111,182,255,0.9)' : 'rgba(240,180,67,0.95)';
			for (let t = 0; t < diff.length; t++) {
				if (!diff[t]) continue;
				const x = Math.floor(t / b.h), y = t % b.h;
				ctx.strokeRect(x * cell + ctx.lineWidth / 2, y * cell + ctx.lineWidth / 2, cell - ctx.lineWidth, cell - ctx.lineWidth);
			}
		}
		if (hoverTile >= 0 && !app.preview && !app.watching && app.mode !== 'play') {
			const x = Math.floor(hoverTile / b.h), y = hoverTile % b.h;
			ctx.strokeStyle = app.mode === 'lock' ? '#c9a8ff' : '#ffffff';
			ctx.lineWidth = 1.5;
			ctx.strokeRect(x * cell + 0.75, y * cell + 0.75, cell - 1.5, cell - 1.5);
		}
		if (misConsole) misConsole.decorateBoard(ctx, b, cell);
		updateBanner(); updateResizeHandles();
	}

	function updateBanner() {
		const el = $('board-banner');
		let html = '';
		if (app.watching) html = 'Watching solution · move <b>' + app.watching.i + '</b> / ' + (app.watching.frames.length - 1) + ' · click to stop';
		else if (misConsole && misConsole.bannerHTML()) html = misConsole.bannerHTML();
		else if (app.preview) html = 'Preview: <b>' + escapeHtml(app.preview.label || '') + '</b> · changed tiles outlined';
		el.innerHTML = html;
		el.classList.toggle('on', !!html);
	}

	function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

	let toastTimer = null;
	function toast(text, bad) {
		const el = $('toast');
		el.textContent = text;
		el.style.background = bad ? '#3a1f24' : '';
		el.style.borderColor = bad ? '#6b2e36' : '';
		el.style.color = bad ? '#ffb3b3' : '';
		el.classList.add('on');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2600);
	}

	function setPreview(board, label) {
		if (app.mode === 'play') return;
		app.preview = board ? { board: board, label: label } : null;
		renderBoard();
	}

	/////////////////////////////////////////////////////////////////////
	// Palette & editing
	/////////////////////////////////////////////////////////////////////

	function buildPalette() {
		const m = app.model;
		const pal = [];
		const seen = {};
		m.glyphs.forEach(function (g) {
			if (seen[g.key] !== undefined) return;
			seen[g.key] = true;
			pal.push({ ids: g.ids.length ? g.ids : [m.backgroundId], label: g.ch + '  ' + g.ids.map(function (id) { return m.objects[id].display; }).join(' + '), ch: g.ch });
		});
		// Objects that have no single-glyph of their own.
		m.objects.forEach(function (o) {
			if (!o || o.layer === m.backgroundLayer) return;
			if (seen[String(o.id)] !== undefined) return;
			pal.push({ ids: [o.id], label: o.display, ch: '' });
		});
		app.palette = pal;
		const el = $('palette');
		el.innerHTML = '';
		pal.forEach(function (p, i) {
			const b = document.createElement('button');
			b.className = 'swatch';
			b.title = p.label + (i < 9 ? '  (' + (i + 1) + ')' : '');
			const cv = document.createElement('canvas');
			const sb = { w: 1, h: 1, cells: new Int32Array(m.stride) };
			C.setBit(sb.cells, 0, m.backgroundId, m.stride);
			p.ids.forEach(function (id) { C.placeObject(m, sb.cells, 0, id); });
			cv.width = 10; cv.height = 10;
			drawBoard(cv.getContext('2d'), sb, 0, 0, 10);
			b.appendChild(cv);
			if (i < 9) { const k = document.createElement('span'); k.className = 'k'; k.textContent = i + 1; b.appendChild(k); }
			b.onclick = function () { selectBrush(i); setMode('edit'); };
			el.appendChild(b);
		});
		const prevKey = app.brush ? app.brush.ids.join(',') : null;
		const keep = prevKey === null ? -1 : pal.findIndex(function (p) { return p.ids.join(',') === prevKey; });
		selectBrush(keep >= 0 ? keep : Math.min(pal.length - 1, pal.findIndex(function (p) { return p.ids.some(function (id) { return m.objects[id].layer !== m.backgroundLayer; }); })));
	}

	function selectBrush(i) {
		if (i < 0 || i >= app.palette.length) return;
		app.brush = app.palette[i];
		Array.from($('palette').children).forEach(function (el, k) { el.classList.toggle('on', k === i); el.setAttribute('aria-pressed', String(k === i)); el.setAttribute('aria-label', el.title); });
	}

	function paintTile(tile, how) {
		const m = app.model, cells = app.board.cells;
		const before = cells.slice(tile * m.stride, (tile + 1) * m.stride);
		if (how === 'erase') {
			C.eraseTop(m, cells, tile);
		} else {
			const ids = app.brush.ids;
			const onlyBg = ids.every(function (id) { return m.objects[id].layer === m.backgroundLayer; });
			if (how === 'replace' || onlyBg) {
				for (let k = 0; k < m.stride; k++) cells[tile * m.stride + k] = 0;
			}
			ids.forEach(function (id) { C.placeObject(m, cells, tile, id); });
			C.ensureBackground(m, cells, tile);
		}
		for (let k = 0; k < m.stride; k++) if (cells[tile * m.stride + k] !== before[k]) return true;
		return false;
	}

	function pickTile(tile) {
		const m = app.model;
		const ids = C.cellIds(m, app.board, tile).filter(function (id) { return id !== m.backgroundId; });
		const key = ids.join(',');
		let idx = app.palette.findIndex(function (p) { return p.ids.filter(function (id) { return id !== m.backgroundId; }).sort(function (a, b) { return a - b; }).join(',') === key; });
		if (idx < 0) {
			const top = ids.sort(function (a, b) { return m.objects[b].layer - m.objects[a].layer; })[0];
			idx = app.palette.findIndex(function (p) { return p.ids.length === 1 && p.ids[0] === top; });
		}
		if (idx >= 0) selectBrush(idx);
	}

	function tileAt(ev) {
		const b = app.board;
		if (!b) return -1;
		const r = boardCanvas.getBoundingClientRect();
		const x = Math.floor((ev.clientX - r.left) / view.cell), y = Math.floor((ev.clientY - r.top) / view.cell);
		if (x < 0 || y < 0 || x >= b.w || y >= b.h) return -1;
		return x * b.h + y;
	}

	let stroke = null;
	boardCanvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
	boardCanvas.addEventListener('pointerdown', function (e) {
		if (app.watching) { stopWatching(); return; }
		if (!app.board || app.mode === 'play') return;
		if (app.preview) setPreview(null);
		const tile = tileAt(e);
		if (tile < 0) return;
		boardCanvas.setPointerCapture(e.pointerId);
		if (app.mode === 'edit' && (e.altKey || e.button === 1)) { pickTile(tile); return; }
		const how = app.mode === 'lock' ? (e.button === 2 ? 'unlock' : 'lock') : (e.button === 2 ? 'erase' : (e.shiftKey ? 'replace' : 'paint'));
		stroke = { how: how, changed: false, lockBefore: app.mode === 'lock' ? Uint8Array.from(app.locks[app.levelIndex]) : null };
		applyStroke(tile);
	});
	boardCanvas.addEventListener('pointermove', function (e) {
		const t = tileAt(e);
		if (t !== hoverTile) { hoverTile = t; if (!stroke) renderBoard(); }
		if (stroke && t >= 0) applyStroke(t);
	});
	boardCanvas.addEventListener('pointerleave', function () { hoverTile = -1; renderBoard(); });
	window.addEventListener('pointerup', function () {
		if (!stroke) return;
		const s = stroke;
		stroke = null;
		if (!s.changed) return;
		if (s.how === 'lock' || s.how === 'unlock') {
			const now = app.locks[app.levelIndex];
			app.locks[app.levelIndex] = s.lockBefore;
			pushUndo();
			app.locks[app.levelIndex] = now;
			markDirty(true);
			autosave();
			restartGeneration();
			return;
		}
		commitBoard('edit');
	});

	function applyStroke(tile) {
		if (stroke.how === 'lock' || stroke.how === 'unlock') {
			const locks = app.locks[app.levelIndex];
			const v = stroke.how === 'lock' ? 1 : 0;
			if (locks[tile] !== v) { locks[tile] = v; stroke.changed = true; renderBoard(); }
			return;
		}
		if (paintTile(tile, stroke.how)) { stroke.changed = true; renderBoard(); }
	}

	/////////////////////////////////////////////////////////////////////
	// Level creation and direct resizing
	/////////////////////////////////////////////////////////////////////

	function insertBoardLevel(board, inherit, inheritLocks) {
		if (!app.model || !app.model.levelMapOK) { toast('This LEVELS layout is read-only.', true); return false; }
		try {
			const from = app.levelIndex, next = from + 1;
			const text = C.insertLevelInSource(app.model, app.source, from, board);
			pushUndo(true); shiftLevelSettings(from, 1);
			if (inherit) copyLevelSettings(from, next);
			if (!inheritLocks || !app.locks[next] || app.locks[next].length !== board.w * board.h) app.locks[next] = new Uint8Array(board.w * board.h);
			app.levelIndex = next;
			setSource(text, { noUndo: true, levelEdit: true });
			toast('Added Level ' + (countPlayableBefore(next) + 1) + ' — other levels keep generating.');
			return true;
		} catch (e) { toast(e.message, true); return false; }
	}
	let newDialogFocus = null;
	function newLevelDialog() {
		if (!app.model || !app.model.levelMapOK) return;
		newDialogFocus = document.activeElement;
		let dims = app.board ? [app.board.w, app.board.h] : [3, 3];
		try { const saved = JSON.parse(localStorage.getItem('mis-new-dimensions')); if (saved && saved.length === 2) dims = saved; } catch (e) { /* use current size */ }
		$('new-width').value = Math.max(1, Math.min(MISBoard.MAX_DIMENSION, dims[0]));
		$('new-height').value = Math.max(1, Math.min(MISBoard.MAX_DIMENSION, dims[1]));
		$('new-level-error').textContent = '';
		$('new-level-dialog').showModal(); $('new-width').focus(); $('new-width').select();
	}
	$('new-level-form').addEventListener('submit', function (e) {
		e.preventDefault();
		try {
			const w = Number($('new-width').value), h = Number($('new-height').value);
			const board = MISBoard.create(app.model, w, h);
			if (insertBoardLevel(board, true, false)) {
				try { localStorage.setItem('mis-new-dimensions', JSON.stringify([w, h])); } catch (e) { /* optional preference */ }
				$('new-level-dialog').close();
			}
		} catch (e) { $('new-level-error').textContent = e.message; }
	});
	$('cancel-new-level').onclick = function () { $('new-level-dialog').close(); };
	$('new-level-dialog').addEventListener('close', function () { if (newDialogFocus && newDialogFocus.isConnected) newDialogFocus.focus(); });

	let resizing = null;
	function canResize() { return !!(app.board && app.model && app.model.levelMapOK && app.mode === 'edit' && !app.preview && !app.watching); }
	function updateResizeHandles() {
		if (!$('board-frame')) return;
		$('board-frame').classList.toggle('resizable', canResize());
		$('board-dimensions').textContent = app.board ? app.board.w + ' × ' + app.board.h : '';
	}
	function resizeDeltas(edge, dx, dy, board) {
		const delta = { left: 0, right: 0, top: 0, bottom: 0 };
		if (edge.includes('left')) delta.left = Math.max(1 - board.w, Math.min(MISBoard.MAX_DIMENSION - board.w, -dx));
		if (edge.includes('right')) delta.right = Math.max(1 - board.w, Math.min(MISBoard.MAX_DIMENSION - board.w, dx));
		if (edge.includes('top')) delta.top = Math.max(1 - board.h, Math.min(MISBoard.MAX_DIMENSION - board.h, -dy));
		if (edge.includes('bottom')) delta.bottom = Math.max(1 - board.h, Math.min(MISBoard.MAX_DIMENSION - board.h, dy));
		return delta;
	}
	function applyResize(delta) {
		if (!canResize() || !Object.values(delta).some(Boolean)) return;
		try {
			const out = MISBoard.resize(app.model, app.board, delta, app.locks[app.levelIndex]);
			pushUndo(true); app.board = out.board; app.locks[app.levelIndex] = out.locks;
			commitBoard('resize', { noUndo: true });
		} catch (e) { toast(e.message, true); }
	}
	function cancelResize() {
		if (!resizing) return;
		resizing = null; $('resize-preview').hidden = true; updateResizeHandles();
	}
	document.querySelectorAll('[data-resize]').forEach(function (handle) {
		handle.addEventListener('pointerdown', function (e) {
			if (e.button !== 0 || !canResize()) return;
			e.preventDefault(); handle.focus(); handle.setPointerCapture(e.pointerId);
			resizing = { handle: handle, pointerId: e.pointerId, index: app.levelIndex, edge: handle.dataset.resize, x: e.clientX, y: e.clientY, cell: view.cell, board: app.board, delta: {} };
		});
		handle.addEventListener('pointermove', function (e) {
			if (!resizing || resizing.handle !== handle) return;
			const r = resizing;
			r.delta = resizeDeltas(r.edge, Math.round((e.clientX - r.x) / r.cell), Math.round((e.clientY - r.y) / r.cell), r.board);
			const w = r.board.w + r.delta.left + r.delta.right, h = r.board.h + r.delta.top + r.delta.bottom;
			const preview = $('resize-preview'); preview.hidden = false;
			preview.style.left = (-r.delta.left * r.cell) + 'px'; preview.style.top = (-r.delta.top * r.cell) + 'px';
			preview.style.width = (w * r.cell) + 'px'; preview.style.height = (h * r.cell) + 'px';
			preview.textContent = w + ' × ' + h;
		});
		handle.addEventListener('pointerup', function () {
			if (!resizing || resizing.handle !== handle) return;
			const r = resizing; cancelResize();
			if (r.index === app.levelIndex && r.board === app.board) applyResize(r.delta);
		});
		handle.addEventListener('pointercancel', cancelResize);
		handle.addEventListener('lostpointercapture', cancelResize);
		handle.addEventListener('keydown', function (e) {
			if (!canResize() || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
			e.preventDefault(); e.stopPropagation();
			applyResize(resizeDeltas(handle.dataset.resize, e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0, app.board));
		});
	});
	document.addEventListener('keydown', function (e) { if (resizing && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelResize(); } }, true);

	/////////////////////////////////////////////////////////////////////
	// Modes & play
	/////////////////////////////////////////////////////////////////////

	function setMode(mode) {
		if (mode === app.mode) return;
		if (app.mode === 'play') exitPlay();
		app.mode = mode;
		Array.from($('mode-seg').children).forEach(function (b) { b.classList.toggle('on', b.dataset.mode === mode); });
		$('palette').style.display = mode === 'edit' ? '' : 'none';
		$('lock-tools').classList.toggle('on', mode === 'lock');
		$('play-tools').classList.toggle('on', mode === 'play');
		$('simplify-btn').style.display = mode === 'play' ? 'none' : '';
		$('tighten-select').style.visibility = mode === 'play' ? 'hidden' : '';
		boardCanvas.style.cursor = mode === 'play' ? 'default' : 'crosshair';
		if (mode === 'play') enterPlay();
		stopWatching();
		setPreview(null);
		renderBoard();
	}

	function enterPlay() {
		if (!app.board) return;
		setPreview(null);
		misConsole.startSession('playtest started on level ' + (countPlayableBefore(app.levelIndex) + 1));
		// Traced (and breakable) when the game has run_rules_on_level_start.
		const board = app.board;
		misConsole.step('level start', function () { C.loadBoardIntoEngine(app.model, board, 'play'); }, function () {
			if (app.mode !== 'play' || app.board !== board) return;
			app.play = { history: [], moves: 0, board: engineBoard() };
			updatePlayMoves();
			layoutBoard();
		}, { before: board, optional: true });
	}
	function exitPlay() {
		app.play = null;
		misConsole.abort();
		renderRuleGutter();
	}
	function engineBoard() { return { w: level.width, h: level.height, cells: new Int32Array(level.objects) }; }
	function updatePlayMoves() { $('play-moves').textContent = app.play ? app.play.moves + ' moves' : ''; }

	function playInput(input) {
		const p = app.play;
		if (!p) return;
		if (input === 'undo') {
			if (!p.history.length) return;
			C.restoreTo(p.history.pop());
			p.moves = Math.max(0, p.moves - 1);
			misConsole.log('undo');
		} else if (input === 'restart') {
			misConsole.log('restart');
			misConsole.step('restart', function () { C.loadBoardIntoEngine(app.model, app.board, 'play'); }, function () {
				if (app.play !== p) return;
				p.history.length = 0; p.moves = 0;
				p.board = engineBoard();
				updatePlayMoves();
				renderBoard();
			}, { before: app.board, optional: true });
			return;
		} else {
			// The console records the move and may pause it at a breakpoint;
			// the move is committed once it isn't paused any more.
			const before = new Int32Array(level.objects);
			misConsole.step(input, function () { return C.engineStep(input); }, function (r) { commitMove(p, before, r); });
			return;
		}
		p.board = engineBoard();
		updatePlayMoves();
		renderBoard();
	}

	function commitMove(p, before, r) {
		if (app.play !== p) return;
		if (r.changed || r.won) {
			p.history.push(before);
			p.moves++;
			if (r.won || C.winconditionsNow()) {
				p.board = engineBoard();
				renderBoard();
				toast('Solved in ' + p.moves + ' moves!');
				misConsole.log('solved in ' + p.moves + ' moves');
				setTimeout(function () { if (app.play === p) { C.loadBoardIntoEngine(app.model, app.board, 'play'); p.history.length = 0; p.moves = 0; p.board = engineBoard(); updatePlayMoves(); renderBoard(); } }, 1200);
				updatePlayMoves();
				return;
			}
		}
		p.board = engineBoard();
		updatePlayMoves();
		renderBoard();
	}

	/////////////////////////////////////////////////////////////////////
	// Current-level analysis & level health
	/////////////////////////////////////////////////////////////////////

	let focusJob = 0;
	let currentResult = null;
	let provisional = null; // quick result (e.g. from a suggestion) shown while the deep solve runs
	let analyzeStarted = 0;
	let solving = false;

	// Backends measure effort differently, so results are cached per backend.
	function cacheKey(board) { return app.backendPref + '|' + app.rulesSig + '|' + boardIdentity(board); }

	function showBackend(backend, note) {
		const el = $('backend-note');
		el.textContent = backend === 'native' ? '● native' : '● JS';
		el.className = 'backend-note ' + backend;
		el.title = note || '';
	}

	// Result for every level of a game with no WINCONDITIONS and no `win` command.
	const NO_WIN = { status: 'unsolvable', reason: 'nowin', deep: true };

	function analyzeCurrent() {
		const job = ++focusJob;
		solving = false;
		clearTimeout(renderStatus.t);
		// Cancel before consulting the cache: switching to an already-solved
		// level must also stop an unlimited search on the previous board.
		if (focusWorker && (focusWorker.busy || focusWorker.queue.length || focusWorker.dead)) {
			kill(focusWorker);
			focusWorker = spawnWorker(app.source);
		}
		currentResult = null;
		provisional = null;
		renderRuleGutter();
		if (!app.board || !app.model) { renderStatus(); return; }
		if (!app.model.canWin) { currentResult = NO_WIN; renderStatus(); onCurrentResult(); return; }
		const key = cacheKey(app.board);
		const cached = app.assessCache.get(key);
		if (cached && cached.deep && (cached.status === 'solved' || cached.status === 'unsolvable')) { currentResult = cached; renderStatus(); onCurrentResult(); return; }
		provisional = cached && cached.status === 'solved' ? cached : null;
		ensureWorkers(false);
		analyzeStarted = Date.now();
		solving = true;
		renderStatus();
		// This is the selected-level solver, not a generator candidate. Search
		// until a result or explicit cancellation; only optional refinement is bounded.
		enqueue(focusWorker, { type: 'assess', board: packBoard(app.board), opts: { timeMs: -1, maxExpanded: 0, bfsFloor: 250000, bfsTimeMs: 8000, refineTimeMs: 1500 } }, function (m) {
			if (job !== focusJob) return;
			solving = false;
			const r = m.type === 'assessed' ? m.result : { status: 'error', error: m.message };
			r.deep = r.status === 'solved' || r.status === 'unsolvable';
			app.assessCache.set(key, r);
			currentResult = r;
			renderStatus();
			onCurrentResult();
			refreshLevelStrip();
		});
	}

	function stopCurrentSolve() {
		if (!solving) return;
		++focusJob;
		kill(focusWorker);
		focusWorker = spawnWorker(app.source);
		solving = false;
		currentResult = provisional || { status: 'stopped', deep: false };
		app.assessCache.set(cacheKey(app.board), currentResult);
		renderStatus();
		onCurrentResult();
		refreshLevelStrip();
	}

	function onCurrentResult() {
		renderCards();
		updateMeter();
		startRuleCheck();
		renderRuleGutter();
	}

	function effortScore(e) { return e > 0 ? Math.log2(e) : 0; }
	function effortLabel(e) {
		if (!(e > 0)) return '?';
		return e >= 10000 ? (e / 1000).toFixed(0) + 'k' : e >= 1000 ? (e / 1000).toFixed(1) + 'k' : String(e);
	}

	function renderStatus() {
		const dot = $('status-dot'), text = $('status-text'), eff = $('status-effort');
		clearTimeout(renderStatus.t);
		const solveButton = $('solve-btn');
		solveButton.hidden = !app.board || (!solving && (!currentResult || currentResult.status === 'solved' || currentResult.status === 'unsolvable'));
		solveButton.textContent = solving ? 'Stop solver' : 'Retry solve';
		$('watch-btn').style.display = 'none';
		eff.innerHTML = '';
		dot.className = 'dot';
		const lv = currentLevel();
		if (!lv) { text.textContent = 'No level'; return; }
		if (lv.message !== undefined) { text.textContent = 'Message: “' + lv.message + '”'; return; }
		if (app.blind && !app.revealed) {
			text.innerHTML = 'Solver info hidden <button class="ghost" id="reveal-btn">reveal</button>';
			$('reveal-btn').onclick = function () { app.revealed = true; renderStatus(); refreshLevelStrip(); renderRuleGutter(); };
			return;
		}
		const r = currentResult;
		if (!r) {
			dot.className = 'dot busy';
			const elapsed = ((Date.now() - analyzeStarted) / 1000).toFixed(0) + 's';
			text.textContent = provisional ? 'Solvable · ≈' + provisional.length + ' moves (refining · ' + elapsed + ')' : 'Solving… ' + elapsed;
			if (solving) renderStatus.t = setTimeout(renderStatus, 1000);
			return;
		}
		if (r.status === 'solved') {
			dot.className = 'dot good';
			text.textContent = 'Solvable · ' + (r.optimal ? '' : '≈') + r.length + ' moves';
			eff.innerHTML = 'effort <span class="effort-bar"><i style="width:' + Math.min(100, effortScore(r.effort) / 18 * 100).toFixed(0) + '%"></i></span> <span class="mono">' + effortLabel(r.effort) + '</span>';
			eff.title = 'States the solver explored (lower of: ' + Object.keys(r.lanes).map(function (k) { return k + ' ' + r.lanes[k]; }).join(', ') + ')' + (r.optimal ? '' : '\nShortest length not proven (BFS ran out of budget).');
			$('watch-btn').style.display = '';
		} else if (r.reason === 'nowin') {
			dot.className = 'dot bad';
			text.textContent = 'Can’t be won';
			eff.innerHTML = '<span class="faint">The game has no WINCONDITIONS and no rule with the win command.</span>';
		} else if (r.status === 'unsolvable') {
			dot.className = 'dot bad';
			text.textContent = 'Unsolvable';
			eff.innerHTML = '<span class="faint">Tip: lock what you like and let the transformer find a working version.</span>';
		} else if (r.status === 'error') {
			dot.className = 'dot warn';
			text.textContent = 'Solver error';
			eff.textContent = r.error || 'The solver could not complete this search.';
		} else if (r.status === 'stopped') {
			text.textContent = 'Solver stopped';
		} else {
			dot.className = 'dot warn';
			text.textContent = 'No solution found yet';
		}
	}

	let healthQueued = new Set();
	function refreshLevelStrip() {
		if (!app.model) return;
		const list = $('level-list');
		list.innerHTML = '';
		let solved = 0, bad = 0, total = 0;
		app.model.levels.forEach(function (lv, i) {
			if (lv.message !== undefined) {
				const d = document.createElement('div');
				d.className = 'level-msg';
				d.textContent = '“' + lv.message + '”';
				list.appendChild(d);
				return;
			}
			total++;
			const board = i === app.levelIndex && app.board ? app.board : lv.board;
			const item = document.createElement('div');
			item.className = 'level-item' + (i === app.levelIndex ? ' current' : '');
			item.dataset.levelIndex = i;
			const cv = document.createElement('canvas');
			renderThumbInto(cv, board, 150, 90);
			const thumbnail = document.createElement('div'); thumbnail.className = 'level-thumbnail'; thumbnail.appendChild(cv);
			const badge = document.createElement('button'); badge.type = 'button'; badge.className = 'generation-badge';
			badge.onclick = function (e) { e.stopPropagation(); const ws = workspace(i); if ((ws.gen && ws.gen.running) || ws.restartTransform) stopGeneration(false, i); else startGeneration(i); };
			thumbnail.appendChild(badge); item.appendChild(thumbnail);
			const meta = document.createElement('div');
			meta.className = 'level-meta';
			const r = app.model.canWin ? app.assessCache.get(cacheKey(board)) : NO_WIN;
			let chip = '<span class="chip busy">…</span>';
			if (r) {
				if (r.reason === 'nowin') { bad++; chip = '<span class="chip bad">can’t win</span>'; }
				else if (r.status === 'solved') { solved++; chip = '<span class="chip good" title="effort ' + r.effort + '">' + (r.optimal ? '' : '≈') + r.length + ' mv</span>'; }
				else if (r.status === 'unsolvable') { bad++; chip = '<span class="chip bad">unsolvable</span>'; }
				else chip = '<span class="chip warn">?</span>';
			}
			if (app.blind && !app.revealed) chip = '';
			meta.innerHTML = '<span>Level ' + (countPlayableBefore(i) + 1) + '</span>' + chip;
			item.appendChild(meta);
			item.onclick = function () { selectLevel(i); };
			list.appendChild(item);
			if (!r) queueHealth(board);
		});
		$('health-summary').textContent = app.blind && !app.revealed ? '' : (bad ? bad + ' broken' : solved + '/' + total + ' ✓');
		updateGenerationIndicators();
		const cur = list.querySelector('.current');
		if (cur && cur.scrollIntoViewIfNeeded) cur.scrollIntoViewIfNeeded(false);
	}

	function countPlayableBefore(i) {
		let n = 0;
		for (let k = 0; app.model && k < Math.min(i, app.model.levels.length); k++) if (app.model.levels[k].board) n++;
		return n;
	}

	function queueHealth(board) {
		const key = cacheKey(board);
		if (healthQueued.has(key)) return;
		healthQueued.add(key);
		ensureWorkers(false);
		const sig = app.rulesSig;
		enqueue(bgWorker, { type: 'assess', board: packBoard(board), opts: { timeMs: 1500, maxExpanded: 200000, bfsFloor: 20000, bfsTimeMs: 1500 } }, function (m) {
			healthQueued.delete(key);
			if (m.type !== 'assessed' || sig !== app.rulesSig) return;
			if (!app.assessCache.has(key)) app.assessCache.set(key, m.result);
			clearTimeout(queueHealth.t);
			queueHealth.t = setTimeout(refreshLevelStrip, 150);
		}, null, false, true);
	}

	function selectLevel(i) {
		if (!app.model || !app.model.levels[i] || i === app.levelIndex) return;
		setPreview(null);
		app.levelIndex = i;
		app.revealed = false;
		loadCurrentBoard();
		syncWorkspaceEditor();
		refreshLevelStrip();
		renderCards();
	}

	function selectSourceLevel(line) {
		const text = sourceCM.getValue();
		clearTimeout(initEditors.t);
		// A click can arrive before the source editor's compile debounce. Use
		// the current document, including message screens in the level order.
		if ((text !== app.source || text !== app.compiledText) && !setSource(text, { fromEditor: true })) return;
		if (!app.model || !app.model.levelMapOK || app.compiledText !== text) return;
		const index = C.findLevelBlocks(text.split('\n')).findIndex(block =>
			block.kind === 'level' && line >= block.start && line <= block.end);
		if (index >= 0) selectLevel(index);
	}

	function stepLevel(d) {
		const lv = app.model.levels;
		for (let i = app.levelIndex + d; i >= 0 && i < lv.length; i += d) {
			if (lv[i].board) { selectLevel(i); return; }
		}
	}

	/////////////////////////////////////////////////////////////////////
	// Watching solutions
	/////////////////////////////////////////////////////////////////////

	function watch(board, solution) {
		stopWatching();
		if (!solution || !solution.length) return;
		const frames = C.replayFrames(app.model, board, solution);
		let steps = null;
		try { steps = C.traceRules(app.model, board, solution); } catch (e) { console.error(e); }
		app.watching = { frames: frames, i: 0, steps: steps };
		app.watching.timer = setInterval(function () {
			const w = app.watching;
			if (!w) return;
			if (w.i < w.frames.length - 1) w.i++;
			else { stopWatching(); return; }
			renderBoard();
			flashWatchedRules();
		}, Math.max(60, Math.min(220, 5000 / frames.length)));
		renderBoard();
		flashWatchedRules();
	}
	function stopWatching() {
		if (!app.watching) return;
		clearInterval(app.watching.timer);
		app.watching = null;
		renderBoard();
		flashWatchedRules();
	}
	function flashWatchedRules() {
		const w = app.watching;
		if (sourceCM) sourceCM.setFlashLines(w && w.steps ? w.steps[w.i] || [] : []);
	}

	/////////////////////////////////////////////////////////////////////
	// Rule gutter and rule goals
	/////////////////////////////////////////////////////////////////////
	//
	// The Game source gutter shows what the current level's solution does
	// with each rule: never fires (faint dot), fires (grey dot, and the line
	// warms with how often), needed (black dot: every solution fires it).
	// Cosmetic and sound-only rules get a flower. Clicking a rule's marker
	// cycles its goal for this level: need it (tick: every solution fires it),
	// ban it (cross: no solution fires it), neither. Goals filter what the
	// generator suggests.

	let ruleWorker = null, ruleWorkerKey = null;
	const traceCache = new Map();  // board key + solution -> { steps, summary }
	const ruleChecks = new Map();  // board key + banned lines -> { lines: {line: result}, done }

	function normalizeRule(text) {
		let t = text, prev;
		do { prev = t; t = t.replace(/\([^()]*\)/g, ' '); } while (t !== prev);
		return t.replace(/\s+/g, ' ').trim().toLowerCase();
	}

	// Rule lines of the game just compiled on this page, keyed by their text so
	// goals follow a rule when lines above it move.
	function computeRules(text) {
		const compiled = C.compiledRuleLines();
		const src = text.split('\n');
		const keyOf = new Map(), lineOf = new Map(), seen = {};
		compiled.lines.forEach(function (line) {
			const base = normalizeRule(src[line - 1] || '');
			seen[base] = (seen[base] || 0) + 1;
			const key = seen[base] > 1 ? base + ' #' + seen[base] : base;
			keyOf.set(line, key);
			lineOf.set(key, line);
		});
		return { lines: compiled.lines, random: compiled.random, keyOf: keyOf, lineOf: lineOf };
	}

	// Breakpoints are kept as rule keys, like rule goals, so they survive the
	// source being rewritten (level edits, undo). After typing in the editor
	// its markers have moved with the text, which follows a rule whose text was
	// edited; keys whose rule still exists are kept too, since a marker is lost
	// when its whole line is replaced (select-all and paste, say).
	function syncBreakpoints(fromEditor) {
		if (!app.rules || !sourceCM) return;
		if (fromEditor) {
			const keys = new Set(sourceCM.getBreakpoints().map(function (l) { return app.rules.keyOf.get(l); }).filter(Boolean));
			app.breakpoints.forEach(function (key) { if (app.rules.lineOf.has(key)) keys.add(key); });
			app.breakpoints = keys;
		}
		const lines = [];
		app.breakpoints.forEach(function (key) { const line = app.rules.lineOf.get(key); if (line) lines.push(line); });
		sourceCM.setBreakpoints(lines);
	}

	function toggleBreakpoint(line) {
		if (!app.rules || !app.rules.keyOf.has(line)) { toast('Breakpoints go on rule lines.'); return; }
		const key = app.rules.keyOf.get(line);
		if (app.breakpoints.has(key)) app.breakpoints.delete(key); else app.breakpoints.add(key);
		syncBreakpoints(false);
		misConsole.renderTrace();
		markDirty(true);
		autosave();
	}

	function levelGoals(i) { return app.ruleGoals[i === undefined ? app.levelIndex : i] || {}; }

	// The current level's goals as rule lines of the current source.
	function goalLines() {
		const goals = levelGoals(), out = { need: [], ban: [] };
		if (!app.rules || app.rules.random) return out;
		Object.keys(goals).forEach(function (key) {
			const line = app.rules.lineOf.get(key);
			if (line && !app.ruleTags[line]) out[goals[key]].push(line);
		});
		return out;
	}

	function toggleRuleGoal(line) {
		if (!app.rules || app.rules.random || app.ruleTags[line]) return;
		const key = app.rules.keyOf.get(line);
		if (!key) return;
		pushUndo();
		const goals = Object.assign({}, levelGoals());
		const next = goals[key] === undefined ? 'need' : goals[key] === 'need' ? 'ban' : undefined;
		if (next) goals[key] = next; else delete goals[key];
		if (Object.keys(goals).length) app.ruleGoals[app.levelIndex] = goals;
		else delete app.ruleGoals[app.levelIndex];
		markDirty(true);
		autosave();
		startRuleCheck();
		renderRuleGutter();
		restartGeneration();
	}

	function solverInfoHidden() { return app.blind && !app.revealed; }

	// Which rules the shown solution fires, per step. Uses the page's engine,
	// so not while playtesting (that would replace the game being played).
	function currentTrace() {
		const r = currentResult;
		if (!r || r.status !== 'solved' || !r.solution || app.play || !app.board) return null;
		const k = cacheKey(app.board) + '|' + r.solution.join('');
		let t = traceCache.get(k);
		if (!t) {
			const steps = C.traceRules(app.model, app.board, r.solution);
			t = { steps: steps, summary: C.summarizeTrace(steps) };
			traceCache.set(k, t);
			if (traceCache.size > 200) traceCache.delete(traceCache.keys().next().value);
		}
		return t;
	}

	// Ask the rule worker what each rule means for this level (one worker,
	// current level only: an unfinished check for another level is abandoned).
	function startRuleCheck() {
		const r = currentResult;
		if (!app.rules || app.rules.random || !r || r.status !== 'solved' || !app.board) return;
		const banLines = goalLines().ban;
		const key = ruleCheckKey();
		if (ruleChecks.has(key)) return;
		ensureWorkers(false);
		if (ruleWorkerKey && ruleWorkerKey !== key && (ruleWorker.busy || ruleWorker.queue.length)) {
			kill(ruleWorker);
			ruleChecks.forEach(function (entry, k) { if (!entry.done) ruleChecks.delete(k); });
			ruleWorker = spawnWorker(app.source);
		}
		ruleWorkerKey = key;
		// Answers about needing a rule don't depend on the bans: reuse them.
		const entry = { lines: {}, done: false };
		const boardKey = cacheKey(app.board) + '|';
		ruleChecks.forEach(function (other, k) {
			if (!other.done || k.indexOf(boardKey) !== 0) return;
			Object.keys(other.lines).forEach(function (l) { if (other.lines[l].need !== 'unknown') entry.lines[l] = { need: other.lines[l].need }; });
		});
		ruleChecks.set(key, entry);
		const sig = app.rulesSig;
		const lines = app.rules.lines.filter(function (l) { return !app.ruleTags[l] && (!entry.lines[l] || banLines.indexOf(l) >= 0); });
		enqueue(ruleWorker, {
			type: 'ruleCheck', board: packBoard(app.board), solution: r.solution,
			lines: lines, banLines: banLines, timeMs: 3000, maxExpanded: 300000,
		}, function (m) {
			if (m.type === 'ruleChecked') Object.assign(entry.lines, m.result);
			else entry.failed = true;
			entry.done = true;
			if (sig === app.rulesSig) renderRuleGutter();
		}, function (m) {
			entry.lines[m.line] = m.result;
			if (sig === app.rulesSig) renderRuleGutter();
		});
	}

	// Checks depend on which rules are banned (each banned line gets a search).
	function ruleCheckKey() { return cacheKey(app.board) + '|' + goalLines().ban.join(','); }

	// What the check found, minus what the shown solution already says.
	function ruleFinding(res, goal, fired) {
		if (goal === 'ban') {
			if (res.ban === 'never') return 'No solution fires it.';
			if (res.ban === 'used') return fired ? '' : 'Some other solution fires it.';
			return res.ban === 'unknown' ? 'Couldn\u2019t check every solution: the search ran out of time.' : '';
		}
		if (res.need === 'required') return 'Needed: every solution fires it.';
		if (res.need === 'optional') return fired ? 'Not needed: some solution never fires it.' : '';
		return res.need === 'unknown' ? 'Couldn\u2019t tell whether every solution needs it: the search ran out of time.' : '';
	}

	// 'ok' | 'bad' | 'pending' for a goal, given that rule's check result.
	function goalState(goal, res) {
		const answer = res && (goal === 'need' ? res.need : res.ban);
		if (!answer || answer === 'unknown') return 'pending';
		return goal === 'need' ? (answer === 'required' ? 'ok' : 'bad') : (answer === 'never' ? 'ok' : 'bad');
	}

	function renderRuleGutter() {
		if (!sourceCM) return;
		const info = new Map();
		const summary = { goals: 0, bad: 0, pending: 0 };
		if (!app.rules || !app.board) { sourceCM.setRuleInfo(info); renderGoalSummary(summary); return; }
		const r = currentResult, hidden = solverInfoHidden();
		const solved = !hidden && r && r.status === 'solved';
		const trace = solved ? currentTrace() : null;
		const check = solved ? ruleChecks.get(ruleCheckKey()) : null;
		const goals = levelGoals();
		const moves = trace ? trace.steps.length - 1 : 0;
		let maxSteps = 0;
		if (trace) Object.keys(trace.summary).forEach(function (l) { maxSteps = Math.max(maxSteps, trace.summary[l].steps); });
		app.rules.lines.forEach(function (line) {
			const tag = app.ruleTags[line];
			if (tag) {
				info.set(line, { mark: 'flower', tip: tag === 'inert'
					? 'Only plays sounds or similar effects, so it can\u2019t change how a level is solved.'
					: 'Cosmetic: it only changes decoration that nothing else depends on, so it can\u2019t change how a level is solved.' });
				return;
			}
			if (app.rules.random) return;
			const goal = goals[app.rules.keyOf.get(line)];
			const fired = trace && trace.summary[line];
			const res = check && check.lines[line];
			const it = { toggle: true };
			if (fired && maxSteps) it.heat = Math.max(1, Math.min(4, Math.ceil(4 * fired.steps / maxSteps)));
			let facts;
			if (hidden) facts = 'Solver information is hidden (Blind mode).';
			else if (!r) facts = 'Waiting for the solver\u2026';
			else if (!solved) facts = r.status === 'unsolvable' ? 'This level is unsolvable.' : 'No solution yet.';
			else {
				facts = fired
					? 'Fires on ' + fired.steps + ' of the solution\u2019s ' + moves + ' moves' + (fired.first === 0 ? ', starting at level start.' : ', first on move ' + fired.first + '.')
					: 'Never fires in the solution.';
				const finding = res ? ruleFinding(res, goal, !!fired) : '';
				const waiting = check && !check.done && (!res || (goal === 'ban' && !res.ban));
				if (finding) facts += '\n' + finding;
				else if (waiting) facts += goal === 'ban' ? '\nChecking every solution\u2026' : '\nChecking whether every solution needs it\u2026';
			}
			if (goal) {
				it.mark = goal;
				it.state = solved ? goalState(goal, res) : 'pending';
				summary.goals++;
				if (it.state === 'bad') summary.bad++;
				if (it.state === 'pending') summary.pending++;
				const head = goal === 'need'
					? 'Needed here: every solution of a generated level must fire this rule.'
					: 'Banned here: no solution of a generated level may fire this rule.';
				const verdict = it.state === 'ok' ? ' This level meets it.' : it.state === 'bad' ? ' This level doesn\u2019t.' : '';
				it.tip = head + verdict + '\n' + facts + '\nClick to ' + (goal === 'need' ? 'ban it instead.' : 'clear.');
			} else {
				it.mark = res && res.need === 'required' ? 'required' : fired ? 'fired' : 'idle';
				it.glyph = it.mark === 'required' ? 'bigdot' : 'dot';
				it.tip = facts + '\nClick to require it in generated levels; click again to ban it.';
			}
			info.set(line, it);
		});
		sourceCM.setRuleInfo(info);
		renderGoalSummary(summary);
	}

	function renderGoalSummary(summary) {
		const el = $('rule-goals');
		if (!el) return;
		el.className = summary.bad ? 'bad' : '';
		if (!summary.goals) { el.textContent = ''; el.title = ''; return; }
		const n = summary.goals + ' rule goal' + (summary.goals > 1 ? 's' : '');
		el.textContent = summary.bad ? n + ': ' + summary.bad + ' not met' : summary.pending ? n + ': checking\u2026' : n + ' met';
		el.title = 'Set in the Game source gutter. Generated levels must meet them.';
	}

	/////////////////////////////////////////////////////////////////////
	// Transform editor & presets
	/////////////////////////////////////////////////////////////////////

	// Auto mode: the generator gets every preset and spends its time on
	// whichever finds harder levels on this level. It is written into the
	// transform editor as this text, so it survives save/reload and editing it
	// turns Auto off.
	const AUTO_HEADER = '(Auto: the generator tries each transform below and favours whichever finds harder levels here. Edit to write your own.)';
	function autoText(presets) {
		return AUTO_HEADER + '\n\n' + presets.map(function (p) { return '(' + p.label.replace(/[()]/g, '') + ')\n' + p.text.trim(); }).join('\n\n');
	}
	function isAuto() { return app.presetId === 'auto'; }
	function presetIdForText(text) {
		const presets = app.presets || [];
		if (presets.length > 1 && text === autoText(presets)) return 'auto';
		const p = presets.find(function (x) { return x.id === app.presetId && x.text === text; }) || presets.find(function (x) { return x.text === text; });
		return p ? p.id : null;
	}

	function buildPresets() {
		const el = $('presets');
		el.innerHTML = '';
		const presets = C.derivePresets(app.model);
		app.presets = presets;
		const buttons = presets.length > 1
			? [{ id: 'auto', label: 'Auto', hint: 'Try every transform below and favour whichever finds harder levels on this level.', text: autoText(presets) }].concat(presets)
			: presets;
		buttons.forEach(function (p) {
			const b = document.createElement('button');
			b.textContent = p.label;
			b.title = p.hint;
			b.dataset.id = p.id;
			b.onclick = function () {
				app.presetId = p.id;
				setTransformText(p.text, true);
				$('preset-hint').textContent = p.hint;
				markPresets();
			};
			el.appendChild(b);
		});
		if (!presets.length) el.innerHTML = '<span class="faint">No obvious starting points for this game — write a transform below (see Help).</span>';
		if (!app.transform.trim() && presets.length) {
			const first = buttons[0];
			app.presetId = first.id;
			setTransformText(first.text, true);
			$('preset-hint').textContent = first.hint;
		} else {
			app.presetId = presetIdForText(app.transform);
			validateTransform();
		}
		if (!app.defaultTransform) app.defaultTransform = app.transform;
		markPresets();
	}
	function markPresets() {
		Array.from($('presets').children).forEach(function (b) { b.classList.toggle('on', b.dataset.id === app.presetId); });
		const selected = (app.presets || []).find(function (p) { return p.id === app.presetId; });
		$('preset-hint').textContent = isAuto() ? 'Try each preset and favour whichever finds harder levels on this level.' : selected ? selected.hint : 'Custom transform: applied once, as written, to the starting level.';
	}

	let suppressTransformChange = false;
	function setTransformText(text, fromPreset, target, forceChanged) {
		const ws = target || workspace();
		if (!Object.values(app.workspaces).includes(ws)) return;
		const selected = ws === workspace(), changed = forceChanged || text !== ws.transform, pending = !!ws.restartTransform;
		const running = changed ? invalidateWorkspace(ws, true) : false;
		ws.transform = text;
		if (selected && transformCM.getValue() !== text) {
			suppressTransformChange = true; transformCM.setValue(text); suppressTransformChange = false;
		}
		if (!fromPreset) ws.presetId = presetIdForText(text);
		if (selected) { markPresets(); validateTransform(); }
		autosave();
		if (changed) {
			markDirty(true);
			if (selected) { renderCards(); updateGenButton(); updateMeter(); }
			updateGenerationIndicators();
		}
		if (running || pending) {
			clearTimeout(ws.restartTransform);
			ws.restartTransform = setTimeout(function () { ws.restartTransform = null; if (Object.values(app.workspaces).includes(ws)) startGeneration(ws.levelIndex); }, 500);
		}
		updateGenButton(); updateGenerationIndicators();
	}

	let transformMarks = [];
	function validateTransform() {
		const diag = $('transform-diag');
		transformMarks.forEach(function (l) { transformCM.removeLineClass(l, 'background', 'err-line'); });
		transformMarks = [];
		if (!app.model) { diag.innerHTML = ''; return null; }
		if (isAuto()) {
			const n = autoPrograms().length;
			diag.innerHTML = n ? '<div class="ok">✓ Auto: ' + n + ' transforms</div>' : '<div class="faint">No usable transforms.</div>';
			$('gen-btn').disabled = !n;
			$('peek-btn').disabled = !n;
			return n ? autoPrograms()[0].program : { errors: [], statements: [] };
		}
		const prog = C.parseTransform(app.transform, app.model);
		if (prog.errors.length) {
			diag.innerHTML = prog.errors.map(function (e) { return '<div class="err" data-line="' + e.line + '">line ' + (e.line + 1) + ': ' + escapeHtml(e.message) + '</div>'; }).join('');
			prog.errors.forEach(function (e) { transformMarks.push(transformCM.addLineClass(e.line, 'background', 'err-line')); });
			Array.from(diag.children).forEach(function (d) { d.onclick = function () { transformCM.setCursor(+d.dataset.line, 0); transformCM.focus(); }; });
		} else if (prog.statements.length) {
			diag.innerHTML = '<div class="ok">✓ ' + prog.statements.length + ' transform rule' + (prog.statements.length === 1 ? '' : 's') + ' ready</div>';
		} else {
			diag.innerHTML = '<div class="faint">Empty transform.</div>';
		}
		$('gen-btn').disabled = !!prog.errors.length || !prog.statements.length;
		$('peek-btn').disabled = $('gen-btn').disabled;
		return prog;
	}

	function autoPrograms() {
		return (app.presets || []).map(function (p) { return { id: p.id, text: p.text, program: C.parseTransform(p.text, app.model) }; })
			.filter(function (p) { return !p.program.errors.length && p.program.statements.length; });
	}

	let peekRng = C.makeRng(Date.now());
	function peekSample() {
		let prog = validateTransform();
		if (isAuto()) {
			const all = autoPrograms();
			if (all.length) prog = all[Math.floor(peekRng() * all.length)].program;
		}
		if (!prog || !prog.statements.length || !app.board) return;
		let b = null;
		for (let i = 0; i < 12; i++) {
			b = C.runTransform(app.model, prog, app.board, app.locks[app.levelIndex], peekRng);
			if (!C.boardsEqual(b, app.board)) break;
		}
		if (C.boardsEqual(b, app.board)) { toast('That transform changed nothing here (are the tiles it needs locked?)', true); return; }
		setPreview(b, 'one random sample of the transform (not solved)');
		clearTimeout(peekSample.t);
		peekSample.t = setTimeout(function () { if (app.preview && app.preview.board === b) setPreview(null); }, 2200);
	}

	/////////////////////////////////////////////////////////////////////
	// Generation session
	/////////////////////////////////////////////////////////////////////

	function ensureGenerationPool() {
		if (app.generationPool) return app.generationPool;
		app.generationPool = MISGenerationPool.create({
			size: GEN_WORKERS, spawn: function () { return spawnWorker(app.source); },
			onChange: function () { updateGenerationIndicators(); updateGenButton(); },
			onMessage: function (id, workerIndex, m) {
				const ws = Object.values(app.workspaces).find(function (w) { return w.id === id; });
				if (!ws || !ws.gen) return;
				const session = ws.gen;
				if (m.type === 'stats') {
					const key = workerIndex + ':' + m.generationEpoch;
					let at = session.statKeys.indexOf(key);
					if (at < 0) { at = session.statKeys.length; session.statKeys.push(key); }
					session.stats[at] = m.stats; session.arms[at] = m.arms; session.transforms[at] = m.transforms; session.exhausted[at] = m.exhausted;
					if (ws.levelIndex === app.levelIndex) scheduleMeter();
				} else if (m.type === 'candidate') addCandidate(session, unpackBoard(m.board), m.result, ws);
				else if (m.type === 'genError' || m.type === 'error') {
					session.running = false; session.error = m.message;
					toast('Level ' + (countPlayableBefore(ws.levelIndex) + 1) + ': ' + m.message, true);
					updateGenerationIndicators(); updateGenButton(); checkpointSoon();
				}
			},
		});
		return app.generationPool;
	}
	function startGeneration(index) {
		index = index === undefined ? app.levelIndex : index;
		const ws = workspace(index), lv = app.model && app.model.levels[index];
		if (ws.restartTransform) { clearTimeout(ws.restartTransform); ws.restartTransform = null; }
		if (!lv || !lv.board) return;
		ws.presetId = presetIdForText(ws.transform);
		const programs = ws.presetId === 'auto' ? autoPrograms() : null;
		const prog = programs ? programs[0] && programs[0].program : C.parseTransform(ws.transform, app.model);
		if (!prog || prog.errors.length || !prog.statements.length) { toast('Level ' + (countPlayableBefore(index) + 1) + ': choose or write a valid transform first.', true); return; }
		if (!app.model.canWin) { toast('This game can’t be won: add WINCONDITIONS or a rule with the win command.', true); return; }
		const base = index === app.levelIndex ? app.board : lv.board;
		const baseKey = boardIdentity(base);
		const session = {
			id: ws.id, running: true, workers: [], stats: [], statKeys: [], started: Date.now(),
			base: C.cloneBoard(base), baseKey: baseKey, levelIndex: index,
			exhausted: [], arms: [], transforms: [], interesting: 0, seen: new Set(),
		};
		ws.gen = session; ws.boardKey = baseKey;
		ws.cards = ws.cards.filter(function (c) { return c.baseKey === baseKey; });
		ws.cards.forEach(function (c) { session.seen.add(c.key); });
		const r = app.assessCache.get(cacheKey(base));
		session.baseEffort = r && r.status === 'solved' ? r.effort : 0;

		const selectedGoals = index === app.levelIndex ? goalLines() : goalsForLevel(index);
		ensureGenerationPool().start(ws.id, {
			type: 'generate', base: packBoard(base), frozen: Array.from(app.locks[index] || []),
			transform: ws.transform, seed: (Date.now() + nextGenerationSeed++) >>> 0, keep: SHOWN_CARDS,
			transforms: programs ? programs.map(function (p) { return { id: p.id, text: p.text }; }) : undefined,
			baseEffort: r && r.status === 'solved' ? r.effort : undefined,
			goals: selectedGoals,
		});
		updateGenButton(); updateGenerationIndicators();
		if (index === app.levelIndex) { renderCards(); updateMeter(); }
		checkpointSoon();
	}
	let nextGenerationSeed = 1;
	function goalsForLevel(index) {
		const goals = app.ruleGoals[index] || {}, out = { need: [], ban: [] };
		if (app.rules && !app.rules.random) Object.keys(goals).forEach(function (key) { const line = app.rules.lineOf.get(key); if (line && !app.ruleTags[line]) out[goals[key]].push(line); });
		return out;
	}
	function stopGeneration(silent, index) {
		index = index === undefined ? app.levelIndex : index;
		const ws = workspace(index), session = ws.gen;
		if (ws.restartTransform) { clearTimeout(ws.restartTransform); ws.restartTransform = null; }
		if (session) session.running = false;
		if (app.generationPool) app.generationPool.pause(ws.id);
		if (bgWorker && !hasGeneration()) pump(bgWorker);
		if (!silent) { updateGenButton(); updateGenerationIndicators(); updateMeter(); checkpointSoon(); }
	}
	function stopAllGeneration() {
		Object.values(app.workspaces).forEach(function (ws) { if (ws.restartTransform) { clearTimeout(ws.restartTransform); ws.restartTransform = null; } if (ws.gen) ws.gen.running = false; });
		if (app.generationPool) app.generationPool.stopAll();
		if (bgWorker) pump(bgWorker);
		updateGenerationIndicators(); updateGenButton(); updateMeter(); checkpointSoon();
	}
	function restartGeneration(index) {
		index = index === undefined ? app.levelIndex : index;
		const ws = workspace(index), running = invalidateWorkspace(ws, true);
		if (running) startGeneration(index);
		if (index === app.levelIndex) { renderCards(); updateMeter(); updateGenButton(); }
		updateGenerationIndicators(); checkpointSoon();
	}

	function updateGenerationIndicators() {
		if (!$('level-list')) return;
		$('level-list').querySelectorAll('.level-item').forEach(function (item) {
			const index = +item.dataset.levelIndex, ws = app.workspaces[index];
			const badge = item.querySelector('.generation-badge'); if (!badge) return;
			const running = !!(ws && ((ws.gen && ws.gen.running) || ws.restartTransform)), hasResults = !!(ws && (ws.gen || ws.cards.length));
			badge.classList.toggle('running', running); badge.classList.toggle('paused', !running && hasResults);
			badge.innerHTML = running ? '<span aria-hidden="true">⚙</span>' : '<span aria-hidden="true">▶</span>';
			badge.title = (running ? 'Generating — click to pause' : hasResults ? 'Paused — click to resume generation' : 'Generate this level') + ' · Level ' + (countPlayableBefore(index) + 1) + (ws && ws.cards.length ? ' · ' + ws.cards.length + ' suggestions' : '');
			badge.setAttribute('aria-label', badge.title); badge.setAttribute('aria-pressed', String(running));
		});
		const active = Object.values(app.workspaces).filter(function (ws) { return (ws.gen && ws.gen.running) || ws.restartTransform; }).length;
		$('generation-summary').textContent = active ? active + (active === 1 ? ' level generating' : ' levels generating') : '';
		$('stop-all-generation').disabled = !active;
	}
	function updateGenButton() {
		const on = !!((app.gen && app.gen.running) || workspace().restartTransform);
		const b = $('gen-btn');
		b.textContent = on ? '■ Pause' : '▶ Generate';
		b.className = on ? 'danger' : 'primary';
		b.title = (on ? 'Pause generation for' : 'Generate suggestions for') + ' Level ' + (countPlayableBefore(app.levelIndex) + 1) + ' (G)';
	}

	function addCandidate(session, board, result, ws) {
		ws = ws || workspace(session.levelIndex);
		if (ws.gen !== session || !session.running) return;
		const key = boardIdentity(board);
		if (session.seen.has(key)) return;
		session.seen.add(key);
		if (session.seen.size > Math.max(32, Math.min(10000, Math.floor(1048576 / Math.max(16, session.base.cells.byteLength))))) session.seen.delete(session.seen.values().next().value);
		const cur = session.baseEffort || 0;
		if (result.effort > cur) { session.interesting++; }
		ws.cards.push({
			id: key, key: key, board: board, result: result, baseKey: session.baseKey, levelIndex: ws.levelIndex,
			objects: C.countObjects(app.model, board), diff: C.boardDiffCount(session.base, board, app.model.stride),
		});
		if (ws.cards.length > 200) ws.cards = ws.cards.sort(function (a, b) { return b.result.effort - a.result.effort; }).slice(0, 100);
		if (ws.levelIndex === app.levelIndex) scheduleCards();
		updateGenerationIndicators(); checkpointSoon();
	}

	function scheduleCards() {
		if (scheduleCards.t) return;
		scheduleCards.t = setTimeout(function () { scheduleCards.t = null; renderCards(true); }, 200);
	}
	let meterTimer = null;
	function scheduleMeter() {
		if (meterTimer) return;
		meterTimer = setTimeout(function () { meterTimer = null; updateMeter(); }, 300);
	}

	function totals(session) {
		const t = { generated: 0, duplicates: 0, unchanged: 0, solved: 0, unsolvable: 0, timeout: 0, offGoal: 0, budgetMs: 0 };
		session.stats.forEach(function (s) {
			if (!s) return;
			Object.keys(t).forEach(function (k) { t[k] = k === 'budgetMs' ? Math.max(t[k], s[k]) : t[k] + (s[k] || 0); });
		});
		return t;
	}

	function updateMeter() {
		const el = $('meter');
		const s = app.gen;
		if (!s) { el.innerHTML = '<span class="faint">Generate works on this level. Other levels keep running when you switch.</span>'; return; }
		const t = totals(s);
		const secs = Math.max(1, (Date.now() - s.started) / 1000);
		const tried = t.solved + t.unsolvable + t.timeout;
		const samples = t.generated + t.duplicates + t.unchanged;
		const repeatFrac = samples ? (t.duplicates + t.unchanged) / samples : 0;
		const pct = function (n) { return tried ? (100 * n / tried).toFixed(1) : 0; };
		const perMin = s.interesting / (secs / 60);
		const running = s.running;
		const dry = running && s.exhausted.length > 0 && s.exhausted.every(Boolean);
		el.innerHTML =
			(running ? '<span class="dot busy"></span>' : '<span class="dot"></span>') +
			'<span><b>' + tried.toLocaleString() + '</b> tried · <b>' + (tried / secs).toFixed(1) + '</b>/s</span>' +
			'<span class="outcome-bar" title="solved / unsolvable / solver timed out"><i class="s" style="width:' + pct(t.solved) + '%"></i><i class="u" style="width:' + pct(t.unsolvable) + '%"></i><i class="t" style="width:' + pct(t.timeout) + '%"></i></span>' +
			'<span><span style="color:var(--good)">✓' + t.solved + '</span> <span style="color:var(--bad)">✗' + t.unsolvable + '</span> <span style="color:var(--warn)">⏱' + t.timeout + '</span></span>' +
			(t.offGoal ? '<span title="Solvable levels that missed this level\u2019s rule goals">' + t.offGoal.toLocaleString() + ' missed rule goals</span>' : '') +
			'<span title="Samples that repeated one already seen, or changed nothing">repeats ' + (100 * repeatFrac).toFixed(0) + '%</span>' +
			'<span class="interesting" title="Suggestions the solver rates harder than your current level, per minute (the MIS thesis\'s usefulness measure)"><b>' + s.interesting + '</b> harder than current · <b>' + perMin.toFixed(1) + '</b>/min</span>' +
			'<span title="Per-candidate solver time budget; grows as harder levels turn up">budget ' + (t.budgetMs / 1000).toFixed(1) + 's</span>' +
			stepSizeLabel(s) + favouredTransformLabel(s) +
			(dry ? '<span class="dry">⚠ running dry — thousands of repeats in a row; this transform has shown you most of what it can do here. Unlock tiles or loosen it.</span>' : '') +
			(running && tried > 40 && t.solved === 0 ? '<span class="dry">⚠ nothing solvable yet — try a gentler transform or a smaller level.</span>' : '') +
			(!running ? '<span class="faint">stopped</span>' : '');
	}
	setInterval(function () { if (app.gen && app.gen.running) updateMeter(); }, 1000);

	// Auto mode: which transform the workers currently favour (by time spent).
	function favouredTransformLabel(session) {
		const byId = {};
		let total = 0;
		session.transforms.forEach(function (list) {
			(list || []).forEach(function (t) { byId[t.id] = (byId[t.id] || 0) + t.ms; total += t.ms; });
		});
		const ids = Object.keys(byId);
		if (ids.length < 2 || !total) return '';
		ids.sort(function (a, b) { return byId[b] - byId[a]; });
		const label = function (id) { const p = (app.presets || []).find(function (x) { return x.id === id; }); return p ? p.label : id; };
		return '<span title="Auto: share of time per transform — ' + ids.map(function (id) { return escapeHtml(label(id)) + ' ' + Math.round(100 * byId[id] / total) + '%'; }).join(', ') +
			'">favouring <b>' + escapeHtml(label(ids[0])) + '</b> (' + Math.round(100 * byId[ids[0]] / total) + '%)</span>';
	}

	// Which `choose` scale the workers' bandits currently favour (by time spent).
	function stepSizeLabel(session) {
		const byScale = {};
		session.arms.forEach(function (arms) {
			(arms || []).forEach(function (a) { byScale[a.scale] = (byScale[a.scale] || 0) + a.ms; });
		});
		const scales = Object.keys(byScale);
		if (scales.length < 2) return '';
		let total = 0, top = scales[0];
		scales.forEach(function (k) { total += byScale[k]; if (byScale[k] > byScale[top]) top = k; });
		const share = total ? Math.round(100 * byScale[top] / total) : 0;
		const label = +top === 1 ? 'as written' : '×' + (+top < 1 ? '1/' + Math.round(1 / top) : top);
		return '<span title="Changes per sample adapt automatically: every choose count is scaled by the size that has been finding harder levels fastest (' +
			scales.map(function (k) { return '×' + k + ' ' + Math.round(100 * byScale[k] / Math.max(1, total)) + '%'; }).join(', ') + ')">step size <b>' + label + '</b> (' + share + '%)</span>';
	}

	function rankCards() {
		const mode = $('rank-select').value;
		const cards = app.cards.filter(function (c) { return c.baseKey === (app.gen ? app.gen.baseKey : c.baseKey); });
		if (mode === 'hard') cards.sort(function (a, b) { return b.result.effort - a.result.effort; });
		else if (mode === 'long') cards.sort(function (a, b) { return b.result.length - a.result.length || b.result.effort - a.result.effort; });
		else if (mode === 'elegant') cards.sort(function (a, b) { return b.result.effort / Math.max(1, b.objects) - a.result.effort / Math.max(1, a.objects); });
		else if (mode === 'diverse' && cards.length) {
			const pool = cards.slice().sort(function (a, b) { return b.result.effort - a.result.effort; }).slice(0, 80);
			const maxE = Math.log2(pool[0].result.effort + 1);
			const picked = [pool.shift()];
			while (pool.length && picked.length < SHOWN_CARDS) {
				let best = -1, bestScore = -Infinity;
				pool.forEach(function (c, i) {
					let minD = Infinity;
					picked.forEach(function (p) { minD = Math.min(minD, C.boardDiffCount(p.board, c.board, app.model.stride)); });
					const score = 0.65 * Math.log2(c.result.effort + 1) / maxE + 0.35 * Math.min(1, minD / 8);
					if (score > bestScore) { bestScore = score; best = i; }
				});
				picked.push(pool.splice(best, 1)[0]);
			}
			return picked;
		}
		return cards;
	}

	function renderCards(deferWhileInteracting) {
		const el = $('cards');
		if (deferWhileInteracting && (el.querySelector('.card:hover') || el.contains(document.activeElement))) {
			renderCards.pending = true;
			return;
		}
		renderCards.pending = false;
		const cur = currentResult && currentResult.status === 'solved' ? currentResult : null;
		const list = [];
		if (app.special && app.special.levelIndex === app.levelIndex) list.push(app.special);
		app.pinned.filter(function (c) { return c.levelIndex === app.levelIndex; }).forEach(function (c) { list.push(c); });
		const ranked = rankCards().filter(function (c) { return !app.pinned.some(function (p) { return p.key === c.key; }); });
		ranked.slice(0, SHOWN_CARDS).forEach(function (c) { list.push(c); });
		proveShown(list);
		if (!list.length) {
			setPreview(null);
			el.innerHTML = '<div class="empty-cards">' + (app.gen && app.gen.running ? 'Transforming… suggestions appear here as the solver verifies them.' : 'No suggestions yet. Choose a transform, then press Generate.') + '</div>';
			return;
		}
		// Reuse card nodes so proof/stat updates retain focus and hover targets.
		const existing = new Map(Array.from(el.querySelectorAll('.card')).map(function (d) { return [d.dataset.cardKey, d]; }));
		const keep = new Set();
		list.forEach(function (c, idx) {
			const key = workspace().id + ':' + (c.specialLabel ? 'special:' : 'candidate:') + boardIdentity(c.board);
			let d = existing.get(key);
			if (!d) {
				d = document.createElement('div'); d.dataset.cardKey = key;
				const label = document.createElement('div'); label.className = 'label'; d.appendChild(label);
				const cv = document.createElement('canvas'); renderThumbInto(cv, c.board, 220, 160); d.appendChild(cv);
				const meta = document.createElement('div'); meta.className = 'meta'; d.appendChild(meta);
				const tools = document.createElement('div'); tools.className = 'tools';
				const watchB = document.createElement('button'); watchB.textContent = 'Watch'; watchB.title = 'Watch the solution';
				watchB.onclick = function (e) { e.stopPropagation(); setPreview(null); watch(d.card.board, d.card.result.solution); };
				tools.appendChild(watchB);
				const pinB = document.createElement('button'); pinB.className = 'pin-card';
				pinB.onclick = function (e) { e.stopPropagation(); togglePin(d.card); };
				tools.appendChild(pinB);
				const addB = document.createElement('button'); addB.className = 'add-level-card'; addB.textContent = 'Add'; addB.title = 'Add this suggestion as a new level';
				addB.onclick = function (e) { e.stopPropagation(); insertBoardLevel(d.card.board, true); }; tools.appendChild(addB);
				d.appendChild(tools);
				d.onmouseenter = d.onfocus = function () {
					const card = d.card, r = card.result;
					if (!app.watching) setPreview(card.board, card.specialLabel || ('suggestion · ' + r.length + ' moves · effort ' + r.effort));
				};
				d.onmouseleave = d.onblur = function () { setPreview(null); flushPendingCards(); };
				d.onclick = function () { adopt(d.card); };
			}
			d.card = c;
			d.className = 'card' + (c.pinnedCard ? ' pinned' : '') + (c.specialLabel ? ' special' : '');
			const label = d.querySelector('.label'); label.textContent = c.specialLabel || ''; label.hidden = !c.specialLabel;
			const r = c.result;
			let delta = '';
			if (cur && r.effort) {
				const ratio = r.effort / cur.effort;
				delta = '<span class="delta ' + (ratio >= 1 ? 'up' : 'down') + '" title="effort vs. your current level">' + (ratio >= 1 ? '×' + (ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)) : '÷' + (1 / ratio).toFixed(1)) + '</span>';
			}
			d.querySelector('.meta').innerHTML = '<span title="effort ' + r.effort + ' — ' + Object.keys(r.lanes || {}).map(function (k) { return k + ' ' + r.lanes[k]; }).join(', ') + '">' + (r.optimal ? '' : '≈') + r.length + ' mv · ' + effortLabel(r.effort) + '</span>' + delta;
			const pin = d.querySelector('.pin-card'); pin.hidden = !!c.specialLabel;
			pin.textContent = c.pinnedCard ? 'Unpin' : 'Pin'; pin.title = c.pinnedCard ? 'Unpin suggestion' : 'Keep this suggestion while exploring';
			pin.setAttribute('aria-pressed', String(!!c.pinnedCard));
			keep.add(d);
			if (el.children[idx] !== d) el.insertBefore(d, el.children[idx] || null);
		});
		Array.from(el.children).forEach(function (d) { if (!keep.has(d)) d.remove(); });
	}

	function flushPendingCards() {
		setTimeout(function () {
			const el = $('cards');
			if (renderCards.pending && !el.querySelector('.card:hover') && !el.contains(document.activeElement)) renderCards();
		}, 0);
	}
	$('cards').addEventListener('pointerleave', flushPendingCards);
	$('cards').addEventListener('focusout', flushPendingCards);

	// The generator doesn't prove shortest solutions; prove the cards on screen
	// here, one at a time on the background worker (idle while generating),
	// showing ≈ until then.
	let proving = null; // { card, worker }
	function proveShown(list) {
		ensureWorkers(false);
		if (proving && proving.worker === bgWorker && !bgWorker.dead) return;
		const c = list.find(function (x) { return x.result && !x.result.optimal && !x.specialLabel && x.board && !x.proofTried; });
		if (!c) return;
		proving = { card: c, worker: bgWorker };
		enqueue(bgWorker, { type: 'prove', board: packBoard(c.board), opts: { maxExpanded: 20000, timeMs: 1500 } }, function (m) {
			proving = null;
			c.proofTried = true;
			if (m.type === 'proved' && m.result.solution) {
				c.result = Object.assign({}, c.result, { solution: m.result.solution, length: m.result.solution.length, optimal: true });
			}
			scheduleCards();
		});
	}

	function togglePin(c) {
		const i = app.pinned.findIndex(function (p) { return p.key === c.key; });
		if (i >= 0) app.pinned.splice(i, 1);
		else app.pinned.push(Object.assign({}, c, { pinnedCard: true, levelIndex: app.levelIndex }));
		renderCards(); checkpointSoon();
	}

	function adopt(c) {
		if (!app.model.levelMapOK) { toast("Can't write levels back for this game's LEVELS layout.", true); return; }
		stopWatching();
		setPreview(null);
		app.board = C.cloneBoard(c.board);
		if (c.result) app.assessCache.set(cacheKey(app.board), Object.assign({ deep: false }, c.result));
		if (c.specialLabel) app.special = null;
		const keepGoing = $('continue-toggle').checked;
		const wasRunning = app.gen && app.gen.running;
		commitBoard(c.specialLabel ? c.kind : 'suggestion');
		toast(c.specialLabel ? 'Applied.' : 'Adopted — ' + (keepGoing && wasRunning ? 'transforming from here.' : 'undo with Ctrl+Z.'));
		if (wasRunning && !keepGoing) stopGeneration();
	}

	/////////////////////////////////////////////////////////////////////
	// Simplify / Tighten
	/////////////////////////////////////////////////////////////////////

	function buildTighten() {
		const sel = $('tighten-select');
		sel.innerHTML = '<option value="">＋ Tighten…</option>';
		C.staticSolids(app.model).forEach(function (id) {
			const o = document.createElement('option');
			o.value = id;
			o.textContent = 'Add ' + app.model.objects[id].display + ' where harmless';
			sel.appendChild(o);
		});
		sel.style.display = sel.options.length > 1 ? '' : 'none';
	}

	let simplifyRunning = false;
	function runSimplify(mode, objectId) {
		if (!app.board || simplifyRunning) return;
		if (app.model.usesRandom) { toast("This game uses randomness, so 'same shortest solution' can't be checked.", true); return; }
		if (!app.model.canWin) { toast('This game can’t be won, so there is no solution to keep.', true); return; }
		simplifyRunning = true;
		ensureWorkers(false);
		const btn = mode === 'simplify' ? $('simplify-btn') : null;
		const label0 = btn ? btn.textContent : '';
		if (btn) btn.textContent = '✂ Checking…';
		const target = workspace(), sourceSig = app.rulesSig;
		const base = C.cloneBoard(app.board);
		// Jump the queue ahead of level-health checks.
		enqueue(bgWorker, { type: 'simplify', board: packBoard(base), opts: { mode: mode, objectId: objectId, budgetMs: 45000 } }, function (m) {
			simplifyRunning = false;
			if (btn) btn.textContent = label0;
			if (m.type === 'error') { toast(m.message, true); return; }
			if (app.rulesSig !== sourceSig || !Object.values(app.workspaces).includes(target) || !app.model.levels[target.levelIndex] || !C.boardsEqual(app.model.levels[target.levelIndex].board, base)) return;
			const r = m.result;
			if (!r.ok) { toast(r.reason, true); return; }
			if (!r.changed) { toast(mode === 'simplify' ? 'Nothing to remove — every object matters.' : 'No spot where that is harmless.'); return; }
			const board = unpackBoard(r.board);
			const what = mode === 'simplify' ? '−' + r.changed + ' object' + (r.changed === 1 ? '' : 's') : '+' + r.changed + ' ' + app.model.objects[objectId].display;
			target.special = {
				key: 'special', kind: mode, levelIndex: target.levelIndex, board: board,
				specialLabel: (mode === 'simplify' ? 'Simplified ' : 'Tightened ') + what + ', still ' + r.length + ' moves',
				result: { status: 'solved', effort: 0, length: r.length, optimal: true, lanes: {}, solution: null },
			};
			if (target.levelIndex === app.levelIndex) {
				renderCards();
				setPreview(board, target.special.specialLabel + ' — click the blue card to apply');
				setTimeout(function () { if (app.preview && app.preview.board === board) setPreview(null); }, 2500);
			}
			// The simplify card lacks a solution/effort until assessed.
			enqueue(bgWorker, { type: 'assess', board: packBoard(board), opts: { timeMs: 3000, bfsFloor: 100000 } }, function (a) {
				if (app.rulesSig === sourceSig && a.type === 'assessed' && target.special && target.special.board === board) { target.special.result = a.result; if (target.levelIndex === app.levelIndex) renderCards(); }
			}, null, true);
		}, function (p) {
			if (btn) btn.textContent = '✂ ' + Math.round(100 * p.done / p.total) + '%';
		}, true);
	}

	/////////////////////////////////////////////////////////////////////
	// Files: demos, open, save (with MIS metadata), autosave
	/////////////////////////////////////////////////////////////////////

	const META_RE = /\n?\(MIS transform\n([\s\S]*?)\nMIS end\)\n?|\n?\(MIS locks (\d+)\n([\s\S]*?)\nMIS end\)\n?|\n?\(MIS rule goals (\d+)\n([\s\S]*?)\nMIS end\)\n?/g;

	// PuzzleScript comments nest, so a block wrapped in ( ... ) is ignored by
	// the engine even though the transform text has its own parentheses.
	function embedMeta(text) {
		let out = stripMeta(text).replace(/\s*$/, '\n');
		if (app.defaultTransform.trim()) out += '\n(MIS transform\n' + app.defaultTransform.replace(/\s*$/, '') + '\nMIS end)\n';
		Object.keys(app.locks).forEach(function (k) {
			const locks = app.locks[k];
			const lv = app.model && app.model.levels[k];
			if (!lv || !lv.board || !locks.some(Boolean)) return;
			const rows = [];
			for (let y = 0; y < lv.board.h; y++) {
				let r = '';
				for (let x = 0; x < lv.board.w; x++) r += locks[x * lv.board.h + y] ? 'x' : '.';
				rows.push(r);
			}
			out += '(MIS locks ' + k + '\n' + rows.join('\n') + '\nMIS end)\n';
		});
		Object.keys(app.ruleGoals).forEach(function (k) {
			const goals = app.ruleGoals[k], keys = Object.keys(goals);
			if (!keys.length) return;
			out += '(MIS rule goals ' + k + '\n' + keys.map(function (key) { return goals[key] + ' ' + key; }).join('\n') + '\nMIS end)\n';
		});
		if (app.breakpoints.size) out += '(MIS breakpoints\n' + Array.from(app.breakpoints).join('\n') + '\nMIS end)\n';
		const transforms = {};
		Object.entries(app.workspaces).forEach(function (entry) { const ws = entry[1]; transforms[entry[0]] = { transform: ws.transform, presetId: ws.presetId }; });
		out += '(MIS level transforms\n' + JSON.stringify(transforms).replace(/\(/g, '\\u0028').replace(/\)/g, '\\u0029') + '\nMIS end)\n';
		return out;
	}
	const WORKSPACE_META_RE = /\n?\(MIS level transforms\n([^\n]*)\nMIS end\)\n?/g;
	const BREAKPOINT_META_RE = /\n?\(MIS breakpoints\n([\s\S]*?)\nMIS end\)\n?/g;
	function stripMeta(text) { return text.replace(META_RE, '\n').replace(WORKSPACE_META_RE, '\n').replace(BREAKPOINT_META_RE, '\n'); }
	function readMeta(text) {
		const meta = { transform: null, locks: {}, ruleGoals: {}, workspaces: {}, breakpoints: [] };
		text.replace(BREAKPOINT_META_RE, function (all, rows) { meta.breakpoints = rows.split('\n').map(function (r) { return r.trim(); }).filter(Boolean); return ''; });
		text.replace(WORKSPACE_META_RE, function (all, json) { try { meta.workspaces = JSON.parse(json); } catch (e) { /* ignore invalid optional metadata */ } return ''; });
		text.replace(META_RE, function (all, tr, lvl, rows, goalLvl, goalRows) {
			if (tr !== undefined) meta.transform = tr;
			else if (goalLvl !== undefined) {
				const goals = {};
				goalRows.split('\n').forEach(function (row) {
					const m = /^(need|ban) (.+)$/.exec(row.trim());
					if (m) goals[m[2]] = m[1];
				});
				if (Object.keys(goals).length) meta.ruleGoals[goalLvl] = goals;
			}
			else if (lvl !== undefined) {
				const rs = rows.split('\n');
				const h = rs.length, w = rs[0].length;
				const arr = new Uint8Array(w * h);
				for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) arr[x * h + y] = rs[y][x] === 'x' ? 1 : 0;
				meta.locks[lvl] = arr;
			}
			return '';
		});
		return meta;
	}

	function openText(text, name, filePath) {
		invalidateAllWorkspaces();
		app.workspaces = {}; app.editorWorkspace = null;
		const meta = readMeta(text);
		app.fileName = name || 'game.txt';
		app.filePath = filePath || null;
		app.levelIndex = 0;
		app.locks = meta.locks;
		app.ruleGoals = meta.ruleGoals;
		app.breakpoints = new Set(meta.breakpoints);
		app.lineage = {};
		app.cards = []; app.pinned = []; app.special = null;
		app.undo = []; app.redo = [];
		app.assessCache.clear();
		app.rulesSig = 0;
		app.defaultTransform = meta.transform || '';
		app.transform = app.defaultTransform;
		Object.keys(meta.workspaces || {}).forEach(function (index) { const saved = meta.workspaces[index]; if (!Number.isInteger(+index) || +index < 0 || !saved || typeof saved.transform !== 'string') return; const ws = workspace(+index); ws.transform = saved.transform; ws.presetId = saved.presetId || null; });
		app.presetId = null;
		suppressTransformChange = true;
		transformCM.setValue(app.transform);
		suppressTransformChange = false;
		const ok = setSource(stripMeta(text), { noUndo: true, clean: true });
		sourceCM.resetSpriteBrushes();
		updateUndoButtons();
		if (!ok) {
			toast('The game has compile errors — see the Game source tab.', true);
			showTab('source');
		}
		renderCards();
		$('meter').innerHTML = '<span class="faint">Pick a transform on the right (or write one), then press Generate.</span>';
		document.dispatchEvent(new Event('mis-recents-changed'));
	}

	function loadDemo(path, name) {
		return fetch(path).then(function (r) {
			if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
			return r.text();
		}).then(function (t) { openText(t, name || path.split('/').pop()); })
			.catch(function (e) { fatal('Could not load <code>' + escapeHtml(path) + '</code> (' + escapeHtml(e.message) + ').<br><br>MIS95 needs to be served over HTTP so it can start Web Workers — e.g. run <code>npx http-server src</code> from the repository root and open <code>/mis.html</code>.'); });
	}

	function fatal(html) {
		$('fatal-msg').innerHTML = html;
		$('fatal').classList.add('on');
	}

	let savingFile = false;
	async function saveFile(saveAs) {
		const text = embedMeta(app.source);
		if (desktop) {
			if (savingFile) return false;
			savingFile = true;
			try {
				const saved = await desktop.save({ text: text, name: app.fileName, path: app.filePath, saveAs: saveAs === true });
				if (!saved) return false;
				app.fileName = saved.name; app.filePath = saved.path;
				if (embedMeta(app.source) === text) markDirty(false);
				document.dispatchEvent(new Event('mis-recents-changed'));
				return !app.dirty;
			} catch (error) { toast(error.message, true); return false; }
			finally { savingFile = false; }
		}
		const blob = new Blob([text], { type: 'text/plain' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = app.fileName.replace(/(\.txt)?$/, '.txt');
		document.body.appendChild(a);
		a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
		markDirty(false);
		return true;
	}

	async function canReplace() {
		if (!app.dirty) return true;
		if (!desktop) return confirm('Discard unsaved changes to ' + app.fileName + '?');
		const answer = await desktop.confirmSave();
		return answer === 1 || (answer === 0 && await saveFile());
	}
	let openingFile = false;
	async function openNative(file) {
		if (!desktop || openingFile) return;
		openingFile = true;
		try {
			if (!await canReplace()) return;
			const opened = await desktop.open(file);
			if (opened) openText(opened.text, opened.name, opened.path);
		} catch (error) { toast(error.message, true); }
		finally { openingFile = false; }
	}

	let checkpointTimer = null, recovery = null, recoveryWarning = false;
	function checkpointSoon() {
		if (checkpointTimer || !recovery || !app.source) return;
		checkpointTimer = setTimeout(function () { checkpointTimer = null; checkpoint(); }, 2000);
	}
	function savedCard(card) {
		return { key: card.key, id: card.id, levelIndex: card.levelIndex, baseKey: card.baseKey, board: packBoard(card.board),
			result: card.result, objects: card.objects, diff: card.diff, pinnedCard: !!card.pinnedCard };
	}
	async function checkpoint() {
		if (!recovery || !app.model || !app.source) return false;
		const spaces = {};
		Object.entries(app.workspaces).forEach(function (entry) {
			const ws = entry[1], gen = ws.gen;
			spaces[entry[0]] = { transform: ws.transform, presetId: ws.presetId,
				cards: ws.cards.slice().sort(function (a,b) { return b.result.effort - a.result.effort; }).slice(0, 64).map(savedCard),
				pinned: ws.pinned.slice(-64).map(savedCard),
				gen: gen ? { base: packBoard(gen.base), baseKey: gen.baseKey, started: gen.started, interesting: gen.interesting, stats: gen.stats, wasRunning: gen.running } : null };
		});
		return recovery.save({ version: 1, text: embedMeta(app.source), compiledText: app.compiledText, name: app.fileName, levelIndex: app.levelIndex, backend: app.backendPref, workspaces: spaces });
	}
	function embedRecoveredMetadata(compiled, authored) {
		const comments = authored.match(META_RE) || [];
		const transforms = authored.match(WORKSPACE_META_RE) || [];
		const breakpoints = authored.match(BREAKPOINT_META_RE) || [];
		return compiled + '\n' + comments.concat(transforms, breakpoints).join('\n');
	}

	function restoreCollections(record) {
		if (!app.model) return;
		Object.entries(record.workspaces || {}).forEach(function (entry) {
			const index = +entry[0], saved = entry[1], lv = app.model.levels[index];
			if (!lv || !lv.board) return;
			const ws = workspace(index);
			function card(c) {
				const board = unpackBoard(c.board);
				if (board.cells.length !== board.w * board.h * app.model.stride || !c.result || !Array.isArray(c.result.solution)) return null;
				return Object.assign({}, c, { board: board, levelIndex: index });
			}
			try {
				ws.cards = (saved.cards || []).map(card).filter(Boolean);
				ws.pinned = (saved.pinned || []).map(card).filter(Boolean);
				if (saved.gen) ws.gen = { id: ws.id, running: false, recovered: true, base: unpackBoard(saved.gen.base), baseKey: saved.gen.baseKey,
					levelIndex: index, started: saved.gen.started, interesting: saved.gen.interesting || 0, stats: saved.gen.stats || [], statKeys: [], arms: [], transforms: [], exhausted: [], workers: [], seen: new Set(ws.cards.map(function (c) { return c.key; })) };
			} catch (e) { ws.cards = []; ws.pinned = []; ws.gen = null; }
		});
		if (record.levelIndex && app.model.levels[record.levelIndex] && app.model.levels[record.levelIndex].board) selectLevel(record.levelIndex);
		syncWorkspaceEditor(); refreshLevelStrip(); renderCards(); updateMeter();
	}

	function autosave() {
		checkpointSoon();
		clearTimeout(autosave.t);
		autosave.t = setTimeout(function () {
			try { localStorage.setItem('mis-autosave', JSON.stringify({ text: embedMeta(app.source), name: app.fileName, levelIndex: app.levelIndex })); } catch (e) { /* storage unavailable */ }
		}, 600);
	}

	/////////////////////////////////////////////////////////////////////
	// Source editor
	/////////////////////////////////////////////////////////////////////

	let sourceCM = null, transformCM = null, misConsole = null;
	let suppressSourceChange = false;
	let sourceMarks = [];

	function showSourceDiagnostics(errors, ok, hasErrors) {
		const diag = $('source-diag');
		if (!sourceCM) return;
		sourceMarks.forEach(function (l) { sourceCM.removeLineClass(l, 'background', 'err-line'); });
		sourceMarks = [];
		// One status line; the messages themselves are in the console's Output tab.
		const nErr = errors.filter(function (e) { return e.isError; }).length, nWarn = errors.length - nErr;
		const counts = [nErr ? nErr + (nErr === 1 ? ' error' : ' errors') : '', nWarn ? nWarn + (nWarn === 1 ? ' warning' : ' warnings') : ''].filter(Boolean).join(', ');
		diag.innerHTML = (ok ? (hasErrors ? '<div class="warn">Compiled with errors — the game may not work correctly.</div>' : '<div class="ok">✓ Compiled</div>') : '<div class="err">Errors — the board shows the last version that compiled.</div>') +
			(counts ? '<div class="diag-more"><a href="#">' + counts + ' — show in Output</a></div>' : '');
		errors.forEach(function (e) { if (e.isError && e.line) sourceMarks.push(sourceCM.addLineClass(e.line - 1, 'background', 'err-line')); });
		const more = diag.querySelector('.diag-more a');
		if (more) more.onclick = function (ev) { ev.preventDefault(); showTab('source'); misConsole.showTab('output'); };
		$('tabs').children[1].style.color = ok ? (hasErrors ? 'var(--warn)' : '') : 'var(--bad)';
	}

	function showTab(name) {
		Array.from($('tabs').children).forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
		['transform', 'source', 'help'].forEach(function (t) { $('tab-' + t).classList.toggle('on', t === name); });
		// The panel under the board follows the code tab: the generator for
		// Transform, the console for Game source. Help leaves it as it was.
		if (name !== 'help') {
			$('suggest').hidden = name !== 'transform';
			misConsole.setVisible(name === 'source');
		}
		if (name === 'source') sourceCM.refresh();
		if (name === 'transform') transformCM.refresh();
	}

	function initEditors() {
		sourceCM = MISCodeEditor.create($('source-text'), { ruleGutter: true });
		sourceCM.on('ruleToggle', function (line) { toggleRuleGoal(line); });
		sourceCM.on('levelClick', selectSourceLevel);
		transformCM = MISCodeEditor.create($('transform-text'), {
			transform: true, lineWrapping: true,
			getDefinitionTarget: () => ({ view: sourceCM.view, reveal: () => showTab('source') })
		});

		let compiledLines = { text: null, lines: [] };
		misConsole = MISConsole.create({
			getBreakpoints: function () { return sourceCM.getBreakpoints(); },
			sourceLine: function (n) {
				const text = app.compiledText || app.source || '';
				if (compiledLines.text !== text) compiledLines = { text: text, lines: text.split('\n') };
				return compiledLines.lines[n - 1] || '';
			},
			// Scroll only while paused, so the debugger keys keep working.
			revealLine: function (n, passive) {
				showTab('source');
				if (passive || misConsole.isPaused()) sourceCM.scrollLineQuietly(n);
				else { sourceCM.setCursor(n - 1, 0); sourceCM.scrollIntoView({ line: n - 1, ch: 0 }); }
			},
			setPausedLine: function (n) { sourceCM.setPausedLine(n); },
			showSource: function () { showTab('source'); },
			render: function () { renderBoard(); }
		});
		sourceCM.on('breakpointClick', toggleBreakpoint);
		sourceCM.on('cursorActivity', function () { misConsole.followCursor(sourceCM.getCursor().line + 1); });

		sourceCM.on('change', function () {
			if (suppressSourceChange) return;
			clearTimeout(initEditors.t);
			initEditors.t = setTimeout(function () {
				const text = sourceCM.getValue();
				if (text !== app.source) setSource(text, { fromEditor: true });
			}, 450);
		});
		transformCM.on('change', function () {
			if (suppressTransformChange) return;
			const ws = workspace(), text = transformCM.getValue();
			if (text === ws.transform) return;
			// Own the text immediately; decorate only after CodeMirror finishes its transaction.
			ws.transform = text;
			queueMicrotask(function () { if (ws.transform === text) setTransformText(text, false, ws, true); });
		});
	}

	/////////////////////////////////////////////////////////////////////
	// Wiring
	/////////////////////////////////////////////////////////////////////

	function isTyping(e) {
		const t = e.target;
		return t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || (t.closest && t.closest('.cm-editor')));
	}

	document.addEventListener('keydown', function (e) {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
		if (isTyping(e) || e.target.closest('dialog') || (e.target.closest('button, [role=button]') && (e.key === 'Enter' || e.key === ' '))) return;
		if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
		if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
		if (mod || e.altKey) return;
		if (misConsole.handleKey(e)) return; // paused at a breakpoint, or a trace row pinned
		if (app.mode === 'play') {
			const map = { ArrowUp: 0, w: 0, W: 0, ArrowLeft: 1, a: 1, A: 1, ArrowDown: 2, s: 2, S: 2, ArrowRight: 3, d: 3, D: 3, x: 4, X: 4, ' ': 4, Enter: 4, z: 'undo', Z: 'undo', u: 'undo', r: 'restart', R: 'restart' };
			if (map[e.key] !== undefined) { e.preventDefault(); playInput(map[e.key]); return; }
			if (e.key === 'Escape' || e.key === 'e' || e.key === 'E') { setMode('edit'); return; }
			return;
		}
		if (e.key >= '1' && e.key <= '9') { selectBrush(+e.key - 1); setMode('edit'); return; }
		switch (e.key) {
			case 'e': case 'E': setMode('edit'); break;
			case 'l': case 'L': setMode('lock'); break;
			case 'p': case 'P': setMode('play'); break;
			case 'g': case 'G': $('gen-btn').click(); break;
			case '[': stepLevel(-1); break;
			case ']': stepLevel(1); break;
			case 'Escape': stopWatching(); setPreview(null); break;
		}
	});

	Array.from($('mode-seg').children).forEach(function (b) { b.onclick = function () { setMode(b.dataset.mode); }; });
	Array.from($('tabs').children).forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
	$('help-btn').onclick = function () { showTab('help'); };
	$('undo-btn').onclick = doUndo;
	$('redo-btn').onclick = doRedo;
	$('gen-btn').onclick = function () { if ((app.gen && app.gen.running) || workspace().restartTransform) stopGeneration(); else startGeneration(); };
	$('rank-select').onchange = renderCards;
	$('clear-cards').onclick = function () { app.cards = []; if (app.gen) app.gen.seen.clear(); renderCards(); updateGenerationIndicators(); checkpointSoon(); };
	$('peek-btn').onclick = peekSample;
	$('watch-btn').onclick = function () { if (currentResult && currentResult.solution) watch(app.board, currentResult.solution); };
	$('solve-btn').onclick = function () { if (solving) stopCurrentSolve(); else analyzeCurrent(); };
	$('simplify-btn').onclick = function () { runSimplify('simplify'); };
	$('tighten-select').onchange = function (e) {
		const v = e.target.value;
		e.target.value = '';
		if (v !== '') runSimplify('tighten', +v);
	};
	$('lock-none').onclick = function () { pushUndo(); app.locks[app.levelIndex].fill(0); renderBoard(); markDirty(true); restartGeneration(); autosave(); };
	$('lock-invert').onclick = function () { pushUndo(); const l = app.locks[app.levelIndex]; for (let i = 0; i < l.length; i++) l[i] = l[i] ? 0 : 1; renderBoard(); markDirty(true); restartGeneration(); autosave(); };
	$('dup-level').onclick = function () { if (app.board) insertBoardLevel(app.board, true, true); };
	$('new-level').onclick = newLevelDialog;
	$('stop-all-generation').onclick = stopAllGeneration;
	$('share-transform').onclick = function () {
		const text = app.transform, preset = app.presetId; app.defaultTransform = text;
		app.model.levels.forEach(function (lv, index) { if (!lv.board || index === app.levelIndex) return; const ws = workspace(index); ws.transform = text; ws.presetId = preset; restartGeneration(index); });
		markDirty(true); autosave(); toast('Transform copied to every level.');
	};
	$('backend-select').onchange = function (e) {
		app.backendPref = e.target.value;
		try { localStorage.setItem('mis-backend', app.backendPref); } catch (err) { /* ignore */ }
		invalidateAllWorkspaces();
		ensureWorkers(true);
		analyzeCurrent();
		refreshLevelStrip();
		updateGenButton(); updateMeter(); renderCards(); updateGenerationIndicators();
	};
	$('blind-toggle').onchange = function (e) { app.blind = e.target.checked; app.revealed = false; renderStatus(); refreshLevelStrip(); renderRuleGutter(); };
	$('open-btn').onclick = function () { if (desktop) openNative(); else $('file-input').click(); };
	$('file-input').onchange = async function (e) {
		const f = e.target.files[0];
		e.target.value = '';
		if (!f) return;
		if (!await canReplace()) return;
		f.text().then(function (t) { openText(t, f.name); });
	};
	$('save-btn').onclick = function () { saveFile(); };
	const demoSel = $('demo-select');
	demoSel.innerHTML = '<option value="">Load a demo game…</option>' + DEMOS.map(function (d, i) { return '<option value="' + i + '">' + escapeHtml(d[0]) + '</option>'; }).join('');
	demoSel.onchange = async function () {
		const d = DEMOS[+demoSel.value];
		demoSel.value = '';
		if (!d) return;
		if (!await canReplace()) return;
		loadDemo(d[1], d[1].split('/').pop());
	};
	document.addEventListener('dragover', function (e) { e.preventDefault(); });
	document.addEventListener('drop', async function (e) {
		e.preventDefault();
		const f = e.dataTransfer.files[0];
		if (f && await canReplace()) f.text().then(function (t) { openText(t, f.name); });
	});
	// Re-fit the board whenever its area changes (window resize, suggestions appearing, ...).
	let lastWrapSize = '';
	new ResizeObserver(function () {
		const w = $('board-wrap');
		const size = w.clientWidth + 'x' + w.clientHeight;
		if (size === lastWrapSize) return;
		lastWrapSize = size;
		layoutBoard();
	}).observe($('board-wrap'));
	window.addEventListener('beforeunload', function (e) { if (!desktop && app.dirty) { e.preventDefault(); e.returnValue = ''; } });

	// Start.
	try { app.backendPref = new URLSearchParams(location.search).get('backend') || localStorage.getItem('mis-backend') || 'native'; } catch (e) { app.backendPref = 'native'; }
	if (app.backendPref !== 'js') app.backendPref = 'native';
	$('backend-select').value = app.backendPref;
	initEditors();
	updateUndoButtons();
	let restored = null;
	try { restored = JSON.parse(localStorage.getItem('mis-autosave') || 'null'); } catch (e) { restored = null; }
	const params = new URLSearchParams(location.search);
	recovery = MISRecovery.create({ onError: function () { if (!recoveryWarning) { recoveryWarning = true; toast('Could not save generation recovery. Save your game before closing.', true); } } });
	app.checkpoint = checkpoint;
	const initialLoad = (async function () {
		if (params.get('demo')) await loadDemo(params.get('demo'));
		else {
			const record = await recovery.load();
			if (record && record.version === 1 && record.text) {
				if (record.backend === 'native' || record.backend === 'js') app.backendPref = record.backend;
				$('backend-select').value = app.backendPref;
				openText(record.compiledText ? embedRecoveredMetadata(record.compiledText, record.text) : record.text, record.name);
				if (record.compiledText && stripMeta(record.text) !== record.compiledText) { if (!setSource(stripMeta(record.text), { noUndo: true, clean: true })) showTab('source'); }
				restoreCollections(record); markDirty(false);
			} else if (restored && restored.text) {
				openText(restored.text, restored.name);
				if (restored.levelIndex && app.model.levels[restored.levelIndex] && app.model.levels[restored.levelIndex].board) selectLevel(restored.levelIndex);
				markDirty(false);
			} else await loadDemo(DEMOS[0][1], 'sokoban_basic.txt');
		}
		app.recoveryReady = true;
	})();
	window.addEventListener('pagehide', function () { checkpoint(); });
	document.addEventListener('visibilitychange', function () { if (document.hidden) checkpoint(); });

	window.misDocument = { save: saveFile, open: openNative, canonicalize: canonicalizeSource,
		// Run ▸ Toggle breakpoint: the rule on the Game source cursor's line.
		toggleBreakpoint: function () { showTab('source'); toggleBreakpoint(sourceCM.getCursor().line + 1); } };
	if (desktop) {
		desktop.onOpen(async function (file) { try { await openNative(file); } finally { desktop.opened(); } });
		let confirmingClose = false;
		desktop.onClose(async function () {
			if (confirmingClose) return;
			confirmingClose = true;
			try { if (await canReplace()) { await checkpoint(); desktop.closeConfirmed(); } }
			finally { confirmingClose = false; }
		});
		Promise.resolve(initialLoad).then(function () { desktop.ready(); });
	}

	app.cacheKey = cacheKey;
	window.misApp = app; // for debugging from the console
})();

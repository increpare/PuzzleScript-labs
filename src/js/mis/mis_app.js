'use strict';

// PuzzleScript+MIS (web prototype) - page controller.
//
// Owns the source text (the single source of truth), the compiled model, the
// board editor, the level strip, the transformer session and the workers.

(function () {

	const $ = function (id) { return document.getElementById(id); };
	const C = MISCore;

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
		gen: null,               // generation session
	};

	/////////////////////////////////////////////////////////////////////
	// Workers
	/////////////////////////////////////////////////////////////////////

	function spawnWorker(source) {
		const w = new Worker('js/mis/mis_worker.js');
		const handle = { w: w, ready: false, busy: false, queue: [], handlers: {}, onReady: null, dead: false };
		w.onmessage = function (e) {
			const m = e.data;
			if (m.type === 'ready') {
				handle.ready = true;
				handle.backend = m.backend;
				if (m.ok) showBackend(m.backend, m.note);
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
		w.onerror = function (e) { console.error('MIS worker error', e.message); };
		w.postMessage({ type: 'init', source: source, backend: app.backendPref });
		return handle;
	}

	let nextJobId = 1;
	function pump(handle) {
		if (!handle.ready || handle.busy || !handle.queue.length || handle.dead) return;
		// Background (level-health) jobs wait while the transformer runs, so the
		// generator workers get the CPU.
		let at = 0;
		if (app.gen && app.gen.running) {
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
		if (!force && focusWorker && bgWorker && workerSourceSig === app.rulesSig) return;
		kill(focusWorker); kill(bgWorker);
		focusWorker = spawnWorker(app.source);
		bgWorker = spawnWorker(app.source);
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
		document.title = 'PuzzleScript+MIS';
		showSourceDiagnostics(res.errors, res.ok, res.hasErrors);
		if (!res.ok) return false;
		let model = null;
		try { model = C.extractModel(text); } catch (e) { console.error(e); }
		if (!model) return false;
		app.model = model;
		if (!model.levelMapOK) $('source-diag').insertAdjacentHTML('afterbegin', '<div class="warn">Note: this LEVELS layout can\'t be edited from the board (read-only).</div>');
		const sig = rulesSignature(text);
		const rulesChanged = sig !== app.rulesSig;
		app.rulesSig = sig;
		if (rulesChanged) {
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
		if (!opts.noUndo && app.source && text !== app.source) pushUndo();
		app.source = text;
		if (!opts.fromEditor && sourceCM && sourceCM.getValue() !== text) {
			suppressSourceChange = true;
			const scroll = sourceCM.getScrollInfo();
			sourceCM.setValue(text);
			sourceCM.scrollTo(scroll.left, scroll.top);
			suppressSourceChange = false;
		}
		const ok = compileSource(text);
		if (ok) {
			const n = app.model.levels.length;
			if (app.levelIndex >= n) app.levelIndex = n - 1;
			if (app.model.levels[app.levelIndex].message !== undefined && !opts.keepMessage) {
				const firstPlayable = nearestPlayable(app.levelIndex);
				if (firstPlayable >= 0) app.levelIndex = firstPlayable;
			}
			loadCurrentBoard();
			refreshLevelStrip();
		}
		markDirty(!opts.clean);
		autosave();
		return ok;
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
		if (app.gen && app.gen.running) restartGeneration();
	}

	// Commit the working board into the source text.
	function commitBoard(label) {
		if (!app.board || !app.model) return;
		if (!app.model.levelMapOK) {
			toast("Can't write this level back into the source (unusual LEVELS layout).", true);
			return;
		}
		let text;
		try { text = C.writeLevelToSource(app.model, app.source, app.levelIndex, app.board); }
		catch (e) { toast(e.message, true); return; }
		recordLineage(label || 'edit', app.board);
		setSource(text);
	}

	function markDirty(on) {
		app.dirty = on;
		$('dirty-dot').classList.toggle('on', on);
	}

	/////////////////////////////////////////////////////////////////////
	// Undo / redo (whole-document snapshots)
	/////////////////////////////////////////////////////////////////////

	function snapshot() {
		const locks = {};
		Object.keys(app.locks).forEach(function (k) { locks[k] = Array.from(app.locks[k]); });
		return { source: app.source, levelIndex: app.levelIndex, locks: locks };
	}
	function restoreSnapshot(s) {
		app.locks = {};
		Object.keys(s.locks).forEach(function (k) { app.locks[k] = Uint8Array.from(s.locks[k]); });
		app.levelIndex = s.levelIndex;
		setSource(s.source, { noUndo: true });
	}
	function pushUndo() {
		app.undo.push(snapshot());
		if (app.undo.length > 200) app.undo.shift();
		app.redo.length = 0;
		updateUndoButtons();
	}
	function doUndo() {
		if (!app.undo.length) return;
		app.redo.push(snapshot());
		restoreSnapshot(app.undo.pop());
		updateUndoButtons();
	}
	function doRedo() {
		if (!app.redo.length) return;
		app.undo.push(snapshot());
		restoreSnapshot(app.redo.pop());
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
		const aw = wrap.clientWidth - 20, ah = wrap.clientHeight - 20;
		const cell = Math.max(4, Math.floor(Math.min(aw / b.w, ah / b.h)));
		const dpr = window.devicePixelRatio || 1;
		view.cell = cell; view.dpr = dpr;
		boardCanvas.style.width = (b.w * cell) + 'px';
		boardCanvas.style.height = (b.h * cell) + 'px';
		boardCanvas.width = Math.round(b.w * cell * dpr);
		boardCanvas.height = Math.round(b.h * cell * dpr);
		renderBoard();
	}

	function displayedBoard() {
		if (app.watching) return app.watching.frames[app.watching.i];
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
		updateBanner();
	}

	function updateBanner() {
		const el = $('board-banner');
		let html = '';
		if (app.watching) html = 'Watching solution · move <b>' + app.watching.i + '</b> / ' + (app.watching.frames.length - 1) + ' · click to stop';
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
		Array.from($('palette').children).forEach(function (el, k) { el.classList.toggle('on', k === i); });
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
			if (app.gen && app.gen.running) restartGeneration();
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
		C.loadBoardIntoEngine(app.model, app.board, 'play');
		app.play = { history: [], moves: 0, board: engineBoard() };
		updatePlayMoves();
		layoutBoard();
	}
	function exitPlay() {
		app.play = null;
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
		} else if (input === 'restart') {
			C.loadBoardIntoEngine(app.model, app.board, 'play');
			p.history.length = 0; p.moves = 0;
		} else {
			const before = new Int32Array(level.objects);
			const r = C.engineStep(input);
			if (!r.changed && !r.won) return;
			p.history.push(before);
			p.moves++;
			if (r.won || C.winconditionsNow()) {
				p.board = engineBoard();
				renderBoard();
				toast('Solved in ' + p.moves + ' moves!');
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

	// Backends measure effort differently, so results are cached per backend.
	function cacheKey(board) { return app.backendPref + '|' + app.rulesSig + '|' + C.cellsKey(board.cells); }

	function showBackend(backend, note) {
		const el = $('backend-note');
		el.textContent = backend === 'native' ? '● native' : '● JS';
		el.className = 'backend-note ' + backend;
		el.title = note || '';
	}

	function analyzeCurrent() {
		currentResult = null;
		provisional = null;
		if (!app.board || !app.model) { renderStatus(); return; }
		const key = cacheKey(app.board);
		const cached = app.assessCache.get(key);
		if (cached && cached.deep) { currentResult = cached; renderStatus(); onCurrentResult(); return; }
		provisional = cached || null;
		// Restart the focus worker if it's chewing on a stale board.
		if (focusWorker && focusWorker.busy) {
			kill(focusWorker);
			focusWorker = spawnWorker(app.source);
		}
		ensureWorkers(false);
		const job = ++focusJob;
		analyzeStarted = Date.now();
		renderStatus();
		enqueue(focusWorker, { type: 'assess', board: packBoard(app.board), opts: { timeMs: 6000, maxExpanded: 600000, bfsFloor: 250000, bfsTimeMs: 8000 } }, function (m) {
			const r = m.type === 'assessed' ? m.result : { status: 'timeout', error: m.message };
			r.deep = true;
			app.assessCache.set(key, r);
			if (job !== focusJob) return;
			currentResult = r;
			renderStatus();
			onCurrentResult();
			refreshLevelStrip();
		});
	}

	function onCurrentResult() {
		renderCards();
		updateMeter();
	}

	function effortScore(e) { return e > 0 ? Math.log2(e) : 0; }
	function effortLabel(e) {
		if (!(e > 0)) return '?';
		return e >= 10000 ? (e / 1000).toFixed(0) + 'k' : e >= 1000 ? (e / 1000).toFixed(1) + 'k' : String(e);
	}

	function renderStatus() {
		const dot = $('status-dot'), text = $('status-text'), eff = $('status-effort');
		$('watch-btn').style.display = 'none';
		eff.innerHTML = '';
		dot.className = 'dot';
		const lv = currentLevel();
		if (!lv) { text.textContent = 'No level'; return; }
		if (lv.message !== undefined) { text.textContent = 'Message: “' + lv.message + '”'; return; }
		if (app.blind && !app.revealed) {
			text.innerHTML = 'Solver info hidden <button class="ghost" id="reveal-btn">reveal</button>';
			$('reveal-btn').onclick = function () { app.revealed = true; renderStatus(); refreshLevelStrip(); };
			return;
		}
		const r = currentResult;
		if (!r && provisional) {
			dot.className = 'dot busy';
			text.textContent = (provisional.status === 'solved' ? 'Solvable · ≈' + provisional.length + ' moves' : 'Checking…') + ' (refining)';
			return;
		}
		if (!r) {
			dot.className = 'dot busy';
			text.textContent = 'Solving…';
			clearTimeout(renderStatus.t);
			const tick = function () {
				if (currentResult || !app.board) return;
				text.textContent = 'Solving… ' + ((Date.now() - analyzeStarted) / 1000).toFixed(0) + 's';
				renderStatus.t = setTimeout(tick, 1000);
			};
			renderStatus.t = setTimeout(tick, 1000);
			return;
		}
		if (r.status === 'solved') {
			dot.className = 'dot good';
			text.textContent = 'Solvable · ' + (r.optimal ? '' : '≈') + r.length + ' moves';
			eff.innerHTML = 'effort <span class="effort-bar"><i style="width:' + Math.min(100, effortScore(r.effort) / 18 * 100).toFixed(0) + '%"></i></span> <span class="mono">' + effortLabel(r.effort) + '</span>';
			eff.title = 'States the solver explored (lower of: ' + Object.keys(r.lanes).map(function (k) { return k + ' ' + r.lanes[k]; }).join(', ') + ')' + (r.optimal ? '' : '\nShortest length not proven (BFS ran out of budget).');
			$('watch-btn').style.display = '';
		} else if (r.status === 'unsolvable') {
			dot.className = 'dot bad';
			text.textContent = 'Unsolvable';
			eff.innerHTML = '<span class="faint">Tip: lock what you like and let the transformer find a working version.</span>';
		} else {
			dot.className = 'dot warn';
			text.textContent = 'Unknown — solver gave up';
			eff.innerHTML = '<span class="faint">Too big for a quick proof; smaller levels work best.</span>';
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
			const cv = document.createElement('canvas');
			renderThumbInto(cv, board, 150, 90);
			item.appendChild(cv);
			const meta = document.createElement('div');
			meta.className = 'level-meta';
			const r = app.assessCache.get(cacheKey(board));
			let chip = '<span class="chip busy">…</span>';
			if (r) {
				if (r.status === 'solved') { solved++; chip = '<span class="chip good" title="effort ' + r.effort + '">' + (r.optimal ? '' : '≈') + r.length + ' mv</span>'; }
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
		const cur = list.querySelector('.current');
		if (cur && cur.scrollIntoViewIfNeeded) cur.scrollIntoViewIfNeeded(false);
	}

	function countPlayableBefore(i) {
		let n = 0;
		for (let k = 0; k < i; k++) if (app.model.levels[k].board) n++;
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
		app.special = null;
		loadCurrentBoard();
		refreshLevelStrip();
		renderCards();
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
		app.watching = { frames: frames, i: 0 };
		app.watching.timer = setInterval(function () {
			const w = app.watching;
			if (!w) return;
			if (w.i < w.frames.length - 1) w.i++;
			else { stopWatching(); return; }
			renderBoard();
		}, Math.max(60, Math.min(220, 5000 / frames.length)));
		renderBoard();
	}
	function stopWatching() {
		if (!app.watching) return;
		clearInterval(app.watching.timer);
		app.watching = null;
		renderBoard();
	}

	/////////////////////////////////////////////////////////////////////
	// Transform editor & presets
	/////////////////////////////////////////////////////////////////////

	function buildPresets() {
		const el = $('presets');
		el.innerHTML = '';
		const presets = C.derivePresets(app.model);
		app.presets = presets;
		presets.forEach(function (p) {
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
			b.onmouseenter = function () { $('preset-hint').textContent = p.hint; };
			el.appendChild(b);
		});
		if (!presets.length) el.innerHTML = '<span class="faint">No obvious starting points for this game — write a transform below (see Help).</span>';
		if (!app.transform.trim() && presets.length) {
			app.presetId = presets[0].id;
			setTransformText(presets[0].text, true);
			$('preset-hint').textContent = presets[0].hint;
		} else {
			validateTransform();
		}
		markPresets();
	}
	function markPresets() {
		Array.from($('presets').children).forEach(function (b) { b.classList.toggle('on', b.dataset.id === app.presetId); });
	}

	let suppressTransformChange = false;
	function setTransformText(text, fromPreset) {
		app.transform = text;
		if (transformCM.getValue() !== text) {
			suppressTransformChange = true;
			transformCM.setValue(text);
			suppressTransformChange = false;
		}
		if (!fromPreset) { app.presetId = (app.presets || []).some(function (p) { return p.id === app.presetId && p.text === text; }) ? app.presetId : null; markPresets(); }
		validateTransform();
		autosave();
		if (app.gen && app.gen.running) {
			clearTimeout(setTransformText.t);
			setTransformText.t = setTimeout(restartGeneration, 500);
		}
	}

	let transformMarks = [];
	function validateTransform() {
		const diag = $('transform-diag');
		transformMarks.forEach(function (l) { transformCM.removeLineClass(l, 'background', 'err-line'); });
		transformMarks = [];
		if (!app.model) { diag.innerHTML = ''; return null; }
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

	let peekRng = C.makeRng(Date.now());
	function peekSample() {
		const prog = validateTransform();
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

	function startGeneration() {
		const prog = validateTransform();
		if (!prog || !prog.statements.length || !app.board) return;
		stopGeneration(true);
		const session = {
			running: true, workers: [], stats: [], started: Date.now(),
			base: C.cloneBoard(app.board), baseKey: C.cellsKey(app.board.cells), levelIndex: app.levelIndex,
			exhausted: [], arms: [], interesting: 0, seen: new Set(), timeline: [],
		};
		app.gen = session;
		// Keep suggestions that still belong to this starting board; drop the rest.
		app.cards = app.cards.filter(function (c) { return c.baseKey === session.baseKey; });
		for (let i = 0; i < GEN_WORKERS; i++) {
			const h = spawnWorker(app.source);
			session.workers.push(h);
			session.stats.push(null);
			h.onReady = function (m) {
				if (!m.ok) return;
				h.w.postMessage({
					type: 'generate', base: packBoard(session.base), frozen: Array.from(app.locks[app.levelIndex] || []),
					transform: app.transform, seed: (Date.now() + i * 7919) >>> 0, keep: SHOWN_CARDS,
					baseEffort: currentResult && currentResult.status === 'solved' ? currentResult.effort : undefined,
				});
			};
			h.onMessage = (function (idx) {
				return function (m) {
					if (app.gen !== session) return;
					if (m.type === 'stats') { session.stats[idx] = m.stats; session.arms[idx] = m.arms; session.exhausted[idx] = m.exhausted; scheduleMeter(); }
					else if (m.type === 'candidate') addCandidate(session, unpackBoard(m.board), m.result);
					else if (m.type === 'genError') { toast(m.message, true); stopGeneration(); }
				};
			})(i);
		}
		updateGenButton();
		updateMeter();
	}

	function stopGeneration(silent) {
		const s = app.gen;
		if (!s) return;
		s.running = false;
		s.workers.forEach(kill);
		s.workers = [];
		if (bgWorker) pump(bgWorker); // resume level-health checks
		if (!silent) { updateGenButton(); updateMeter(); }
	}

	function restartGeneration() {
		if (!app.gen || !app.gen.running) return;
		startGeneration();
	}

	function updateGenButton() {
		const on = !!(app.gen && app.gen.running);
		const b = $('gen-btn');
		b.textContent = on ? '■ Stop' : '▶ Generate';
		b.className = on ? 'danger' : 'primary';
	}

	function addCandidate(session, board, result) {
		const key = C.cellsKey(board.cells);
		if (session.seen.has(key)) return;
		session.seen.add(key);
		const cur = currentResult && currentResult.status === 'solved' ? currentResult.effort : 0;
		if (result.effort > cur) { session.interesting++; session.timeline.push(Date.now()); }
		app.cards.push({
			id: key, key: key, board: board, result: result, baseKey: session.baseKey,
			objects: C.countObjects(app.model, board), diff: C.boardDiffCount(session.base, board, app.model.stride),
		});
		if (app.cards.length > 400) {
			rankCards();
			app.cards = app.cards.slice(0, 200);
		}
		scheduleCards();
	}

	function scheduleCards() {
		if (scheduleCards.t) return;
		scheduleCards.t = setTimeout(function () { scheduleCards.t = null; renderCards(); }, 200);
	}
	let meterTimer = null;
	function scheduleMeter() {
		if (meterTimer) return;
		meterTimer = setTimeout(function () { meterTimer = null; updateMeter(); }, 300);
	}

	function totals(session) {
		const t = { generated: 0, duplicates: 0, unchanged: 0, solved: 0, unsolvable: 0, timeout: 0, budgetMs: 0 };
		session.stats.forEach(function (s) {
			if (!s) return;
			Object.keys(t).forEach(function (k) { t[k] = k === 'budgetMs' ? Math.max(t[k], s[k]) : t[k] + s[k]; });
		});
		return t;
	}

	function updateMeter() {
		const el = $('meter');
		const s = app.gen;
		if (!s) return;
		const t = totals(s);
		const secs = Math.max(1, (Date.now() - s.started) / 1000);
		const tried = t.solved + t.unsolvable + t.timeout;
		const samples = t.generated + t.duplicates + t.unchanged;
		const repeatFrac = samples ? (t.duplicates + t.unchanged) / samples : 0;
		const pct = function (n) { return tried ? (100 * n / tried).toFixed(1) : 0; };
		const perMin = s.interesting / (secs / 60);
		const running = s.running;
		const dry = running && s.exhausted.length === s.workers.length && s.exhausted.every(Boolean);
		el.innerHTML =
			(running ? '<span class="dot busy"></span>' : '<span class="dot"></span>') +
			'<span><b>' + tried.toLocaleString() + '</b> tried · <b>' + (tried / secs).toFixed(1) + '</b>/s</span>' +
			'<span class="outcome-bar" title="solved / unsolvable / solver timed out"><i class="s" style="width:' + pct(t.solved) + '%"></i><i class="u" style="width:' + pct(t.unsolvable) + '%"></i><i class="t" style="width:' + pct(t.timeout) + '%"></i></span>' +
			'<span><span style="color:var(--good)">✓' + t.solved + '</span> <span style="color:var(--bad)">✗' + t.unsolvable + '</span> <span style="color:var(--warn)">⏱' + t.timeout + '</span></span>' +
			'<span title="Samples that repeated one already seen, or changed nothing">repeats ' + (100 * repeatFrac).toFixed(0) + '%</span>' +
			'<span class="interesting" title="Suggestions the solver rates harder than your current level, per minute (the MIS thesis\'s usefulness measure)"><b>' + s.interesting + '</b> harder than current · <b>' + perMin.toFixed(1) + '</b>/min</span>' +
			'<span title="Per-candidate solver time budget; grows as harder levels turn up">budget ' + (t.budgetMs / 1000).toFixed(1) + 's</span>' +
			stepSizeLabel(s) +
			(dry ? '<span class="dry">⚠ running dry — thousands of repeats in a row; this transform has shown you most of what it can do here. Unlock tiles or loosen it.</span>' : '') +
			(running && tried > 40 && t.solved === 0 ? '<span class="dry">⚠ nothing solvable yet — try a gentler transform or a smaller level.</span>' : '') +
			(!running ? '<span class="faint">stopped</span>' : '');
	}
	setInterval(function () { if (app.gen && app.gen.running) updateMeter(); }, 1000);

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

	function renderCards() {
		const el = $('cards');
		el.innerHTML = '';
		const cur = currentResult && currentResult.status === 'solved' ? currentResult : null;
		const list = [];
		if (app.special && app.special.levelIndex === app.levelIndex) list.push(app.special);
		app.pinned.filter(function (c) { return c.levelIndex === app.levelIndex; }).forEach(function (c) { list.push(c); });
		const ranked = rankCards().filter(function (c) { return !app.pinned.some(function (p) { return p.key === c.key; }); });
		ranked.slice(0, SHOWN_CARDS).forEach(function (c) { list.push(c); });
		if (!list.length) {
			el.innerHTML = '<div class="empty-cards">' + (app.gen && app.gen.running ? 'Transforming… suggestions appear here as the solver verifies them.' : 'No suggestions yet.') + '</div>';
			return;
		}
		list.forEach(function (c, idx) {
			const d = document.createElement('div');
			d.className = 'card' + (c.pinnedCard ? ' pinned' : '') + (c.specialLabel ? ' special' : '');
			if (c.specialLabel) { const l = document.createElement('div'); l.className = 'label'; l.textContent = c.specialLabel; d.appendChild(l); }
			const cv = document.createElement('canvas');
			renderThumbInto(cv, c.board, 220, 160);
			d.appendChild(cv);
			const meta = document.createElement('div');
			meta.className = 'meta';
			const r = c.result;
			let delta = '';
			if (cur && r.effort) {
				const ratio = r.effort / cur.effort;
				delta = '<span class="delta ' + (ratio >= 1 ? 'up' : 'down') + '" title="effort vs. your current level">' + (ratio >= 1 ? '×' + (ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)) : '÷' + (1 / ratio).toFixed(1)) + '</span>';
			}
			meta.innerHTML = '<span title="effort ' + r.effort + ' — ' + Object.keys(r.lanes || {}).map(function (k) { return k + ' ' + r.lanes[k]; }).join(', ') + '">' + (r.optimal ? '' : '≈') + r.length + ' mv · ' + effortLabel(r.effort) + '</span>' + delta;
			d.appendChild(meta);
			const tools = document.createElement('div');
			tools.className = 'tools';
			const watchB = document.createElement('button'); watchB.textContent = '▶'; watchB.title = 'Watch the solution';
			watchB.onclick = function (e) { e.stopPropagation(); setPreview(null); watch(c.board, r.solution); };
			tools.appendChild(watchB);
			if (!c.specialLabel) {
				const pinB = document.createElement('button'); pinB.textContent = c.pinnedCard ? '✕' : '📌'; pinB.title = c.pinnedCard ? 'Unpin' : 'Pin (keeps it while you explore)';
				pinB.onclick = function (e) { e.stopPropagation(); togglePin(c); };
				tools.appendChild(pinB);
			}
			d.appendChild(tools);
			d.onmouseenter = function () { if (!app.watching) setPreview(c.board, c.specialLabel || ('suggestion · ' + r.length + ' moves · effort ' + r.effort)); };
			d.onmouseleave = function () { setPreview(null); };
			d.onclick = function () { adopt(c); };
			el.appendChild(d);
		});
	}

	function togglePin(c) {
		const i = app.pinned.findIndex(function (p) { return p.key === c.key; });
		if (i >= 0) app.pinned.splice(i, 1);
		else app.pinned.push(Object.assign({}, c, { pinnedCard: true, levelIndex: app.levelIndex }));
		renderCards();
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
		simplifyRunning = true;
		ensureWorkers(false);
		const btn = mode === 'simplify' ? $('simplify-btn') : null;
		const label0 = btn ? btn.textContent : '';
		if (btn) btn.textContent = '✂ Checking…';
		const levelIndex = app.levelIndex;
		const base = C.cloneBoard(app.board);
		// Jump the queue ahead of level-health checks.
		enqueue(bgWorker, { type: 'simplify', board: packBoard(base), opts: { mode: mode, objectId: objectId, budgetMs: 45000 } }, function (m) {
			simplifyRunning = false;
			if (btn) btn.textContent = label0;
			if (m.type === 'error') { toast(m.message, true); return; }
			const r = m.result;
			if (!r.ok) { toast(r.reason, true); return; }
			if (!r.changed) { toast(mode === 'simplify' ? 'Nothing to remove — every object matters.' : 'No spot where that is harmless.'); return; }
			const board = unpackBoard(r.board);
			const what = mode === 'simplify' ? '−' + r.changed + ' object' + (r.changed === 1 ? '' : 's') : '+' + r.changed + ' ' + app.model.objects[objectId].display;
			app.special = {
				key: 'special', kind: mode, levelIndex: levelIndex, board: board,
				specialLabel: (mode === 'simplify' ? 'Simplified ' : 'Tightened ') + what + ', still ' + r.length + ' moves',
				result: { status: 'solved', effort: 0, length: r.length, optimal: true, lanes: {}, solution: null },
			};
			if (levelIndex === app.levelIndex) {
				renderCards();
				setPreview(board, app.special.specialLabel + ' — click the blue card to apply');
				setTimeout(function () { if (app.preview && app.preview.board === board) setPreview(null); }, 2500);
			}
			// The simplify card lacks a solution/effort until assessed.
			enqueue(bgWorker, { type: 'assess', board: packBoard(board), opts: { timeMs: 3000, bfsFloor: 100000 } }, function (a) {
				if (a.type === 'assessed' && app.special && app.special.board === board) { app.special.result = a.result; renderCards(); }
			}, null, true);
		}, function (p) {
			if (btn) btn.textContent = '✂ ' + Math.round(100 * p.done / p.total) + '%';
		}, true);
	}

	/////////////////////////////////////////////////////////////////////
	// Files: demos, open, save (with MIS metadata), autosave
	/////////////////////////////////////////////////////////////////////

	const META_RE = /\n?\(MIS transform\n([\s\S]*?)\nMIS end\)\n?|\n?\(MIS locks (\d+)\n([\s\S]*?)\nMIS end\)\n?/g;

	// PuzzleScript comments nest, so a block wrapped in ( ... ) is ignored by
	// the engine even though the transform text has its own parentheses.
	function embedMeta(text) {
		let out = stripMeta(text).replace(/\s*$/, '\n');
		if (app.transform.trim()) out += '\n(MIS transform\n' + app.transform.replace(/\s*$/, '') + '\nMIS end)\n';
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
		return out;
	}
	function stripMeta(text) { return text.replace(META_RE, '\n'); }
	function readMeta(text) {
		const meta = { transform: null, locks: {} };
		text.replace(META_RE, function (all, tr, lvl, rows) {
			if (tr !== undefined) meta.transform = tr;
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

	function openText(text, name) {
		stopGeneration();
		const meta = readMeta(text);
		app.fileName = name || 'game.txt';
		app.levelIndex = 0;
		app.locks = meta.locks;
		app.lineage = {};
		app.cards = []; app.pinned = []; app.special = null;
		app.undo = []; app.redo = [];
		app.assessCache.clear();
		app.rulesSig = 0;
		app.transform = meta.transform || '';
		app.presetId = null;
		suppressTransformChange = true;
		transformCM.setValue(app.transform);
		suppressTransformChange = false;
		const ok = setSource(stripMeta(text), { noUndo: true, clean: true });
		updateUndoButtons();
		if (!ok) {
			toast('The game has compile errors — see the Game source tab.', true);
			showTab('source');
		}
		renderCards();
		$('meter').innerHTML = '<span class="faint">Pick a transform on the right (or write one), then press Generate.</span>';
	}

	function loadDemo(path, name) {
		fetch(path).then(function (r) {
			if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
			return r.text();
		}).then(function (t) { openText(t, name || path.split('/').pop()); })
			.catch(function (e) { fatal('Could not load <code>' + escapeHtml(path) + '</code> (' + escapeHtml(e.message) + ').<br><br>PuzzleScript+MIS needs to be served over HTTP so it can start Web Workers — e.g. run <code>npx http-server src</code> from the repository root and open <code>/mis.html</code>.'); });
	}

	function fatal(html) {
		$('fatal-msg').innerHTML = html;
		$('fatal').classList.add('on');
	}

	function saveFile() {
		const text = embedMeta(app.source);
		const blob = new Blob([text], { type: 'text/plain' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = app.fileName.replace(/(\.txt)?$/, '.txt');
		document.body.appendChild(a);
		a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
		markDirty(false);
	}

	function autosave() {
		clearTimeout(autosave.t);
		autosave.t = setTimeout(function () {
			try { localStorage.setItem('mis-autosave', JSON.stringify({ text: embedMeta(app.source), name: app.fileName, levelIndex: app.levelIndex })); } catch (e) { /* storage unavailable */ }
		}, 600);
	}

	/////////////////////////////////////////////////////////////////////
	// Source editor
	/////////////////////////////////////////////////////////////////////

	let sourceCM = null, transformCM = null;
	let suppressSourceChange = false;
	let sourceMarks = [];

	function showSourceDiagnostics(errors, ok, hasErrors) {
		const diag = $('source-diag');
		if (!sourceCM) return;
		sourceMarks.forEach(function (l) { sourceCM.removeLineClass(l, 'background', 'err-line'); });
		sourceMarks = [];
		const shown = errors.filter(function (e) { return e.isError; }).concat(errors.filter(function (e) { return !e.isError; })).slice(0, 30);
		diag.innerHTML = (ok ? (hasErrors ? '<div class="warn">Compiled with errors — the game may not work correctly.</div>' : '<div class="ok">✓ Compiled</div>') : '<div class="err">Errors — the board shows the last version that compiled.</div>') +
			shown.map(function (e) { return '<div class="' + (e.isError ? 'err' : 'warn') + '" data-line="' + (e.line || '') + '">' + (e.line ? 'line ' + e.line + ': ' : '') + escapeHtml(e.message) + '</div>'; }).join('');
		shown.forEach(function (e) { if (e.isError && e.line) sourceMarks.push(sourceCM.addLineClass(e.line - 1, 'background', 'err-line')); });
		Array.from(diag.children).forEach(function (d) {
			if (!d.dataset.line) return;
			d.onclick = function () { const ln = +d.dataset.line - 1; sourceCM.setCursor(ln, 0); sourceCM.scrollIntoView({ line: ln, ch: 0 }, 80); sourceCM.focus(); };
		});
		$('tabs').children[1].style.color = ok ? (hasErrors ? 'var(--warn)' : '') : 'var(--bad)';
	}

	function showTab(name) {
		Array.from($('tabs').children).forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
		['transform', 'source', 'help'].forEach(function (t) { $('tab-' + t).classList.toggle('on', t === name); });
		if (name === 'source') sourceCM.refresh();
		if (name === 'transform') transformCM.refresh();
	}

	function initEditors() {
		if (typeof codeMirrorFn === 'function') CodeMirror.defineMode('puzzle', codeMirrorFn);
		sourceCM = CodeMirror.fromTextArea($('source-text'), { mode: 'puzzle', theme: 'midnight', lineNumbers: true, lineWrapping: false, styleActiveLine: true });
		transformCM = CodeMirror.fromTextArea($('transform-text'), { mode: 'puzzle', theme: 'midnight', lineNumbers: true, lineWrapping: true });
		// The PuzzleScript mode highlights by section; start the transform in RULES.
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
			clearTimeout(initEditors.tt);
			initEditors.tt = setTimeout(function () { setTransformText(transformCM.getValue()); }, 300);
		});
	}

	/////////////////////////////////////////////////////////////////////
	// Wiring
	/////////////////////////////////////////////////////////////////////

	function isTyping(e) {
		const t = e.target;
		return t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || (t.closest && t.closest('.CodeMirror')));
	}

	document.addEventListener('keydown', function (e) {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
		if (isTyping(e)) return;
		if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
		if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
		if (mod || e.altKey) return;
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
	$('gen-btn').onclick = function () { if (app.gen && app.gen.running) stopGeneration(); else startGeneration(); };
	$('rank-select').onchange = renderCards;
	$('clear-cards').onclick = function () { app.cards = []; if (app.gen) app.gen.seen.clear(); renderCards(); };
	$('peek-btn').onclick = peekSample;
	$('watch-btn').onclick = function () { if (currentResult && currentResult.solution) watch(app.board, currentResult.solution); };
	$('simplify-btn').onclick = function () { runSimplify('simplify'); };
	$('tighten-select').onchange = function (e) {
		const v = e.target.value;
		e.target.value = '';
		if (v !== '') runSimplify('tighten', +v);
	};
	$('lock-none').onclick = function () { pushUndo(); app.locks[app.levelIndex].fill(0); renderBoard(); markDirty(true); if (app.gen && app.gen.running) restartGeneration(); };
	$('lock-invert').onclick = function () { pushUndo(); const l = app.locks[app.levelIndex]; for (let i = 0; i < l.length; i++) l[i] = l[i] ? 0 : 1; renderBoard(); markDirty(true); if (app.gen && app.gen.running) restartGeneration(); };
	$('dup-level').onclick = function () {
		if (!app.board) return;
		const text = C.insertLevelInSource(app.model, app.source, app.levelIndex, app.board);
		const next = app.levelIndex + 1;
		setSource(text);
		selectLevel(next);
		toast('Duplicated — you are editing the copy.');
	};
	$('backend-select').onchange = function (e) {
		app.backendPref = e.target.value;
		try { localStorage.setItem('mis-backend', app.backendPref); } catch (err) { /* ignore */ }
		const wasRunning = app.gen && app.gen.running;
		stopGeneration(true);
		ensureWorkers(true);
		analyzeCurrent();
		refreshLevelStrip();
		if (wasRunning) startGeneration(); else updateGenButton();
	};
	$('blind-toggle').onchange = function (e) { app.blind = e.target.checked; app.revealed = false; renderStatus(); refreshLevelStrip(); };
	$('open-btn').onclick = function () { $('file-input').click(); };
	$('file-input').onchange = function (e) {
		const f = e.target.files[0];
		if (!f) return;
		f.text().then(function (t) { openText(t, f.name); });
		e.target.value = '';
	};
	$('save-btn').onclick = saveFile;
	const demoSel = $('demo-select');
	demoSel.innerHTML = '<option value="">Load a demo game…</option>' + DEMOS.map(function (d, i) { return '<option value="' + i + '">' + escapeHtml(d[0]) + '</option>'; }).join('');
	demoSel.onchange = function () {
		const d = DEMOS[+demoSel.value];
		demoSel.value = '';
		if (!d) return;
		if (app.dirty && !confirm('Discard unsaved changes to ' + app.fileName + '?')) return;
		loadDemo(d[1], d[1].split('/').pop());
	};
	document.addEventListener('dragover', function (e) { e.preventDefault(); });
	document.addEventListener('drop', function (e) {
		e.preventDefault();
		const f = e.dataTransfer.files[0];
		if (f) f.text().then(function (t) { openText(t, f.name); });
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
	window.addEventListener('beforeunload', function (e) { if (app.dirty) { e.preventDefault(); e.returnValue = ''; } });

	// Start.
	try { app.backendPref = new URLSearchParams(location.search).get('backend') || localStorage.getItem('mis-backend') || 'native'; } catch (e) { app.backendPref = 'native'; }
	if (app.backendPref !== 'js') app.backendPref = 'native';
	$('backend-select').value = app.backendPref;
	initEditors();
	updateUndoButtons();
	let restored = null;
	try { restored = JSON.parse(localStorage.getItem('mis-autosave') || 'null'); } catch (e) { restored = null; }
	const params = new URLSearchParams(location.search);
	if (params.get('demo')) loadDemo(params.get('demo'));
	else if (restored && restored.text) {
		openText(restored.text, restored.name);
		if (restored.levelIndex && app.model && app.model.levels[restored.levelIndex] && app.model.levels[restored.levelIndex].board) selectLevel(restored.levelIndex);
		markDirty(false);
	} else loadDemo(DEMOS[0][1], 'sokoban_basic.txt');

	window.misApp = app; // for debugging from the console
})();

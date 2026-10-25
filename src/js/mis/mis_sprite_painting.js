// Direct painting in MIS95's source editor. The ordinary editor does not load this file.
(function () {
'use strict';

const R = globalThis.PuzzleScriptCM6Runtime;
const P = globalThis.PuzzleScriptCM6Plugins;
const { exactPrefix, ensureExactPrefix } = P.require('exact-prefix');
const { decodeStyleToken, isStyleToken } = P.require('style-token');

const selectBrush = R.StateEffect.define();
const resetBrushes = R.StateEffect.define();
const paintStroke = R.StateEffect.define();
const brushes = R.StateField.define({
	create: () => new Map(),
	update(value, transaction) {
		for (const effect of transaction.effects) if (effect.is(selectBrush)) {
			const { name, index } = effect.value;
			if (typeof name !== 'string' || !Number.isInteger(index) || index < 0 || index > 9) continue;
			value = new Map(value).set(name, index);
		} else if (effect.is(resetBrushes)) value = new Map();
		return value;
	}
});

// Read the parser's exact styled spans, including its treatment of comments,
// aliases and incomplete sprites. No second PuzzleScript grammar is involved.
function spriteCatalog(state) {
	const prefix = state.field(exactPrefix, false) || 0;
	const sprites = [], cursor = R.syntaxTree(state).cursor();
	let inObjects = false, sprite = null;
	while (cursor.next()) {
		if (!isStyleToken(cursor.name)) continue;
		if (cursor.to > prefix) break;
		const style = decodeStyleToken(cursor.name).split(/\s+/);
		const raw = state.sliceDoc(cursor.from, cursor.to), text = raw.trim();
		if (style.includes('HEADER')) {
			if (inObjects) break;
			inObjects = text.toLowerCase() === 'objects';
			continue;
		}
		if (!inObjects || !text) continue;
		const from = cursor.from + raw.length - raw.trimStart().length;
		const to = from + text.length, line = state.doc.lineAt(from).number;
		if (style.includes('NAME')) {
			if (!sprite || sprite.nameLine !== line) {
				sprite = { name: text.toLowerCase(), nameLine: line, palette: [], pixels: [], rows: new Map() };
				sprites.push(sprite);
			}
			continue; // Further NAMEs on the declaration line are inline aliases.
		}
		if (!sprite) continue;
		const pixel = style.includes('BOLDCOLOR') || style.includes('FADECOLOR') ||
			(style.includes('ERROR') && sprite.palette.length && /^[.\d]$/.test(text));
		if (pixel && /^[.\d]$/.test(text)) {
			if (!sprite.rows.has(line)) sprite.rows.set(line, []);
			const row = sprite.rows.get(line);
			const target = { kind: 'pixel', name: sprite.name, from, to, row: sprite.rows.size - 1, column: row.length };
			row.push(target); sprite.pixels.push(target);
		} else if (style.includes('COLOR') || style.some(name => name.startsWith('MULTICOLOR'))) {
			sprite.palette.push({ kind: 'colour', name: sprite.name, from, to, index: sprite.palette.length });
		}
	}
	return sprites.filter(sprite => sprite.palette.length && sprite.pixels.length);
}

function brushIndex(sprite, selected) {
	const index = selected.get(sprite.name) || 0;
	return index < sprite.palette.length ? index : 0;
}

function pixelLine(start, end) {
	let x = start.column, y = start.row;
	const dx = Math.abs(end.column - x), dy = Math.abs(end.row - y);
	const sx = x < end.column ? 1 : -1, sy = y < end.row ? 1 : -1;
	let error = dx - dy;
	const points = [];
	for (;;) {
		points.push({ row: y, column: x });
		if (x === end.column && y === end.row) return points;
		const twice = 2 * error;
		if (twice > -dy) { error -= dy; x += sx; }
		if (twice < dx) { error += dx; y += sy; }
	}
}

class SpritePainting {
	constructor(view) {
		this.view = view;
		this.window = view.dom.ownerDocument.defaultView;
		this.mac = /^Mac/.test(this.window.navigator.platform);
		this.decorations = R.Decoration.none;
		this.catalog = []; this.targets = new Map(); this.catalogDoc = null;
		this.stroke = null; this.destroyed = false;
		this.onModifiers = event => {
			this.setModifier(this.modified(event));
			if (this.stroke && !this.stroke.erase && !this.modified(event)) this.finish();
		};
		this.onBlur = () => { this.setModifier(false); this.finish(); };
		this.onMove = event => {
			if (!this.stroke) return;
			if (!(event.buttons & (this.stroke.erase ? 2 : 1)) ||
				(!this.stroke.erase && !this.modified(event))) { this.finish(); return; }
			event.preventDefault(); event.stopPropagation();
			const target = this.hit(event);
			if (target && target.kind === 'pixel' && target.name === this.stroke.name) this.paint(target);
			else this.stroke.last = null;
		};
		this.onUp = event => {
			if (!this.stroke) return;
			event.preventDefault(); event.stopPropagation(); this.finish();
		};
		for (const type of ['keydown', 'keyup']) this.window.addEventListener(type, this.onModifiers);
		this.window.addEventListener('blur', this.onBlur);
		this.window.addEventListener('mousemove', this.onMove, true);
		this.window.addEventListener('mouseup', this.onUp, true);
		this.refresh();
	}

	modified(event) { return this.mac ? event.metaKey : event.ctrlKey; }
	setModifier(active) { this.view.dom.classList.toggle('mis-sprite-modifier', Boolean(active)); }

	refresh() {
		const view = this.view, prefix = view.state.field(exactPrefix);
		if (prefix < view.viewport.to || !R.syntaxTreeAvailable(view.state, view.viewport.to)) return;
		this.catalog = spriteCatalog(view.state);
		this.catalogDoc = view.state.doc;
		this.tree = R.syntaxTree(view.state); this.prefix = prefix;
		this.targets = new Map();
		const marks = [], selected = view.state.field(brushes);
		for (const sprite of this.catalog) {
			const index = brushIndex(sprite, selected);
			for (const target of [...sprite.palette.filter(colour => colour.index <= 9), ...sprite.pixels]) {
				this.targets.set(target.from, target);
				if (!view.visibleRanges.some(range => target.to > range.from && target.from < range.to)) continue;
				const palette = target.kind === 'colour';
				const attributes = { 'data-sprite': target.name };
				if (palette) attributes['data-colour'] = String(target.index);
				else { attributes['data-row'] = String(target.row); attributes['data-column'] = String(target.column); }
				marks.push(R.Decoration.mark({
					class: palette ? 'mis-sprite-colour' + (target.index === index ? ' mis-sprite-brush' : '') : 'mis-sprite-pixel',
					attributes
				}).range(target.from, target.to));
			}
		}
		this.decorations = R.Decoration.set(marks, true);
	}

	update(update) {
		if (update.transactions.some(tr => tr.effects.some(effect => effect.is(resetBrushes)))) this.stroke = null;
		if (update.docChanged) {
			this.decorations = this.decorations.map(update.changes);
			this.catalogDoc = null;
			if (this.stroke && update.transactions.some(tr => tr.docChanged && !tr.effects.some(effect => effect.is(paintStroke)))) this.stroke = null;
		}
		if (this.catalogDoc !== update.state.doc || this.tree !== R.syntaxTree(update.state) ||
			this.prefix !== update.state.field(exactPrefix) || update.viewportChanged ||
			update.startState.field(brushes) !== update.state.field(brushes)) this.refresh();
	}

	hit(event) {
		if (this.view.state.readOnly || !ensureExactPrefix(this.view, this.view.viewport.to)) return null;
		if (this.catalogDoc !== this.view.state.doc) return null;
		const at = this.view.dom.ownerDocument.elementFromPoint(event.clientX, event.clientY);
		const element = at && at.closest('.mis-sprite-colour, .mis-sprite-pixel');
		if (!element || !this.view.contentDOM.contains(element)) return null;
		return this.targets.get(this.view.posAtDOM(element)) || null;
	}

	down(event) {
		this.setModifier(this.modified(event));
		if (event.button !== 2 && (event.button !== 0 || !this.modified(event))) return false;
		const target = this.hit(event);
		if (!target || (target.kind === 'colour' && event.button !== 0)) return false;
		event.preventDefault(); event.stopPropagation();
		R.closeCompletion(this.view);
		if (target.kind === 'colour') {
			this.view.dispatch({ effects: selectBrush.of({ name: target.name, index: target.index }) });
		} else {
			const sprite = this.catalog.find(sprite => sprite.name === target.name);
			this.stroke = { name: target.name, erase: event.button === 2,
				value: event.button === 2 ? '.' : String(brushIndex(sprite, this.view.state.field(brushes))),
				time: Date.now(), changed: false, last: null };
			this.paint(target);
		}
		this.view.focus();
		return true;
	}

	paint(target) {
		const stroke = this.stroke, sprite = this.catalog.find(sprite => sprite.name === stroke.name);
		if (!sprite) { this.finish(); return; }
		const path = pixelLine(stroke.last || target, target), changes = [];
		for (const point of path) {
			const pixel = sprite.pixels.find(pixel => pixel.row === point.row && pixel.column === point.column);
			if (pixel && this.view.state.sliceDoc(pixel.from, pixel.to) !== stroke.value) {
				changes.push({ from: pixel.from, to: pixel.to, insert: stroke.value });
			}
		}
		stroke.last = target;
		if (!changes.length) return;
		changes.sort((a, b) => a.from - b.from);
		this.view.dispatch({ changes, effects: paintStroke.of(true), annotations: [
			R.Transaction.time.of(stroke.time),
			...(stroke.changed ? [] : [R.isolateHistory.of('before')])
		] });
		stroke.changed = true;
	}

	finish() {
		const stroke = this.stroke; this.stroke = null;
		if (stroke && stroke.changed && !this.destroyed) this.view.dispatch({ annotations: R.isolateHistory.of('after') });
	}

	destroy() {
		this.destroyed = true; this.stroke = null; this.setModifier(false);
		for (const type of ['keydown', 'keyup']) this.window.removeEventListener(type, this.onModifiers);
		this.window.removeEventListener('blur', this.onBlur);
		this.window.removeEventListener('mousemove', this.onMove, true);
		this.window.removeEventListener('mouseup', this.onUp, true);
	}
}

const painting = R.ViewPlugin.fromClass(SpritePainting, {
	decorations: plugin => plugin.decorations,
	eventHandlers: {
		mousemove(event) { this.setModifier(this.modified(event)); },
		mousedown(event) { return this.down(event); },
		contextmenu(event) {
			const target = this.hit(event);
			if (!target || (target.kind !== 'pixel' && !this.modified(event))) return false;
			event.preventDefault(); return true;
		}
	}
});

globalThis.MISSpritePainting = Object.freeze({
	extension: [brushes, painting],
	// Adjacent text edits keep their normal grouping; all changes within a
	// brush stroke join even when its pixels are on separate source lines.
	historyConfig: { joinToEvent: (transaction, adjacent) => transaction.effects.some(effect => effect.is(paintStroke)) || adjacent },
	spriteCatalog, pixelLine, brushIndex, brushes, selectBrush, resetBrushes
});
})();

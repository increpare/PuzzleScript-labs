// MIS95 Static analysis tab: a read-only copy of the analysed game source with
// every static-analysis tag as a badge at the end of its line. Hovering a
// badge shows what the tag means. Badges come from static_analysis_badges.js.
(function () {
	'use strict';
	const R = PuzzleScriptCM6Runtime, P = PuzzleScriptCM6Plugins;
	const { createPuzzleScriptLanguage } = P.require('stream-language');
	const { exactPrefixExtensions, ensureExactPrefix } = P.require('exact-prefix');
	const { tokenPresentation } = P.require('token-presentation');

	function badgeElement(badge) {
		const el = document.createElement('span');
		el.className = 'sa-badge sa-' + badge.k;
		el.textContent = badge.t;
		el.misTip = badge.d;
		return el;
	}

	class BadgesWidget extends R.WidgetType {
		constructor(badges, key) { super(); this.badges = badges; this.key = key; }
		eq(other) { return other.key === this.key; }
		toDOM() {
			const box = document.createElement('span');
			box.className = 'sa-badges';
			this.badges.forEach(function (badge) { box.appendChild(badgeElement(badge)); });
			return box;
		}
		ignoreEvent() { return false; }
	}

	function create(container) {
		const setBadges = R.StateEffect.define();
		const badgeField = R.StateField.define({
			create: () => R.Decoration.none,
			update(value, tr) {
				for (const effect of tr.effects) if (effect.is(setBadges)) value = effect.value;
				return tr.docChanged ? R.Decoration.none : value;
			},
			provide: field => R.EditorView.decorations.from(field)
		});
		let language = null, model = null, showNegatives = false, version = 0;

		function extensions() {
			language = createPuzzleScriptLanguage(codeMirrorFn());
			return [
				R.EditorView.editorAttributes.of({ class: 'puzzlescript-editor mis-code-editor sa-editor' }),
				R.EditorView.contentAttributes.of({ 'aria-label': 'Game source with static analysis tags' }),
				R.EditorState.readOnly.of(true), R.lineNumbers(), R.highlightActiveLine(), R.drawSelection(),
				R.EditorState.tabSize.of(4), R.EditorView.lineWrapping,
				language.extension, ...exactPrefixExtensions, tokenPresentation({ language }), badgeField
			];
		}
		const view = new R.EditorView({ state: R.EditorState.create({ doc: '', extensions: extensions() }), parent: container });

		const visible = badges => showNegatives ? badges : badges.filter(badge => !badge.n);
		function render() {
			version++;
			const doc = view.state.doc, ranges = [];
			if (model && model.lines) model.lines.forEach(function (entry) {
				const line = entry[0], badges = visible(entry[1]);
				if (!badges.length || line < 1 || line > doc.lines) return;
				ranges.push(R.Decoration.widget({ widget: new BadgesWidget(badges, version + ':' + line), side: 1 }).range(doc.line(line).to));
			});
			view.dispatch({ effects: setBadges.of(R.Decoration.set(ranges)) });
		}

		// One tooltip for every badge on the page (editor and game strip).
		let tip = null;
		function hideTip() { if (tip) { tip.remove(); tip = null; } }
		function showTip(target) {
			hideTip();
			if (!target.misTip) return;
			tip = document.createElement('div');
			tip.className = 'mis-rule-tip sa-tip';
			tip.textContent = target.misTip;
			document.body.appendChild(tip);
			const r = target.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
			tip.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left)) + 'px';
			tip.style.top = Math.max(4, r.bottom + 4 + h < window.innerHeight ? r.bottom + 4 : r.top - h - 4) + 'px';
		}
		function hover(root) {
			function track(event) {
				const badge = event.target.closest && event.target.closest('.sa-badge');
				if (badge && (!tip || tip.misFor !== badge)) { showTip(badge); if (tip) tip.misFor = badge; }
				else if (!badge) hideTip();
			}
			root.addEventListener('mouseover', track);
			root.addEventListener('mousemove', track);
			root.addEventListener('mouseleave', hideTip);
		}
		hover(view.dom);
		// Highlighting waits for an exact parse of the visible text. A document
		// swapped in with setState can miss the parser's idle kick, so kick it.
		function highlight() { requestAnimationFrame(function () { ensureExactPrefix(view, view.viewport.to, 50); }); }
		view.scrollDOM.addEventListener('scroll', hideTip, { passive: true });

		const api = {
			view,
			hover,
			badgeElement,
			// Show `text` with `result`'s badges (both from the same analysis).
			show(text, result) {
				hideTip();
				model = result;
				if (view.state.doc.toString() !== text) {
					const scroll = view.scrollDOM.scrollTop;
					view.setState(R.EditorState.create({ doc: text, extensions: extensions() }));
					view.scrollDOM.scrollTop = scroll;
				}
				render();
				highlight();
			},
			setShowNegatives(on) { showNegatives = !!on; render(); },
			visible,
			refresh() { view.requestMeasure(); highlight(); },
			scrollToLine(line) {
				if (line >= 1 && line <= view.state.doc.lines) view.dispatch({ effects: R.EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'start' }) });
			}
		};
		// mis_win95.js refreshes every code editor when the side pane resizes.
		view.dom.misEditor = api;
		return api;
	}
	window.MISAnalysisView = Object.freeze({ create });
})();

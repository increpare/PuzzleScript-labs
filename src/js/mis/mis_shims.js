// PuzzleScript+MIS (web prototype) - headless engine shims.
//
// The engine normally shares globals with graphics.js / inputoutput.js /
// console.js. MIS draws and handles input itself, so those scripts are not
// loaded; these stand-ins mirror the ones src/tests/run_tests_node.js uses.
// Load before the engine scripts (page and workers alike).

(function (g) {
	if (!g.window) g.window = g;
	if (!g.document) {
		g.document = {
			URL: 'mis://',
			title: '',
			body: { classList: { contains: function () { return false; } }, addEventListener: function () {}, removeEventListener: function () {} },
			createElement: function () { return { style: {}, innerHTML: '', textContent: '', getContext: function () { return null; } }; },
			getElementById: function () { return null; },
			addEventListener: function () {},
		};
	}
	if (!g.localStorage) {
		const store = {};
		g.localStorage = {
			getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
			setItem: function (k, v) { store[k] = String(v); },
			removeItem: function (k) { delete store[k]; },
		};
	}
})(typeof self !== 'undefined' ? self : this);

var lastDownTarget = null;
var canvas = null;
var input = { value: '' };
var forceRegenImages = false;
var levelString = '';
var inputString = '';
var outputString = '';
var PuzzleScriptTestAssertions = { push: function () {}, equal: function () {} };

// Compiler/engine chatter lands here; MIS reads errorStrings instead.
var misConsoleLog = [];
function consolePrint(text) { if (misConsoleLog.length < 400) misConsoleLog.push(String(text)); }
function consolePrintFromRule() {}
function consoleError(text) { consolePrint(text); }
function consoleCacheDump() {}
function console_print_raw() {}
function canvasResize() {}
function redraw() {}
function regenSpriteImages() {}
function addToDebugTimeline() { return 0; }
function killAudioButton() {}
function showAudioButton() {}
function jumpToLine() {}
function printLevel() {}
function UnitTestingThrow(error) { throw error; }

// Called after the engine scripts have loaded (they redefine some of these).
function misAfterEngineLoaded() {
	playSound = function () {};
	stripHTMLTags = function (html) { return String(html).replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim(); };
	IDE = false;
}

// Compile `text`; returns { ok, errors: [{line, message, isError}] }.
function misCompile(text) {
	misConsoleLog.length = 0;
	unitTesting = false;
	const before = typeof state !== 'undefined' ? state : null;
	let threw = null;
	try {
		compile(['loadLevel', 0], text + '\n', 'mis');
	} catch (e) {
		threw = e;
	}
	const errors = (typeof errorStrings !== 'undefined' ? errorStrings : []).map(function (html) {
		const m = /line\s+(\d+)/.exec(html);
		const plain = stripHTMLTags(html).replace(/^line\s+\d+\s*:\s*/, '');
		return { line: m ? parseInt(m[1], 10) : null, message: plain, isError: /errorText/.test(html) };
	});
	if (threw) errors.push({ line: null, message: String(threw.message || threw), isError: true });
	// Like the PuzzleScript editor: errors don't stop a game from running as long
	// as the compiler produced a fresh, playable state.
	const fresh = state !== before;
	const ok = !threw && fresh && state && state.levels && state.levels.length > 0 && !!state.objects && !!state.collisionLayers;
	return { ok: !!ok, errors: errors, hasErrors: errors.some(function (e) { return e.isError; }) };
}

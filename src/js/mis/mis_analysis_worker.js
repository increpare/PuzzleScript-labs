'use strict';

// MIS95 - Static analysis tab worker. Analysis of a large game takes seconds,
// so it runs off the page; the page terminates this worker to cancel.

importScripts('mis_shims.js');
importScripts(
	'../storagewrapper.js', '../bitvec.js', '../level.js', '../languageConstants.js',
	'../globalVariables.js', '../debug.js', '../plugin_header_on.js', '../font.js', '../rng.js',
	'../riffwave.js', '../sfxr.js', '../codemirror/stringstream.js', '../colorhelpers.js',
	'../colors.js', '../engine.js', '../parser.js', '../compiler.js', '../soundbar.js'
);
misAfterEngineLoaded();
importScripts('../semantic_compile.js', 'mis_analysis_bundle.js');

self.onmessage = function (e) {
	const m = e.data;
	let result;
	try { result = MISAnalysis.analyze(m.source, { anyBoard: m.anyBoard }); }
	catch (err) { result = { ok: false, error: String(err && err.message || err) }; }
	self.postMessage({ id: m.id, result: result });
};

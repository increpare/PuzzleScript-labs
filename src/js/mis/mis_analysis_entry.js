'use strict';

// Bundled for the Static analysis tab's worker by scripts/build-mis-optimizer.mjs.
const { analyzeCompiledState } = require('../static_analysis');
const { buildBadges } = require('../static_analysis_badges');

// anyBoard: analyse for every board the editor could make (what the solver
// and the Game source marks use), not just the levels in the source.
function analyze(source, options = {}) {
    const start = performance.now();
    const semantic = psCompileSemantic(source, true);
    if (semantic.errorCount || !semantic.state || semantic.state.invalid) {
        return { ok: false, error: 'The game source has compile errors.' };
    }
    const state = semantic.state;
    const report = analyzeCompiledState(state, { arbitraryBoards: options.anyBoard === true });
    const badges = buildBadges(report, {
        nameLines: state.original_line_numbers || {},
        levelLines: Array.from(state.levels || [], level => (level && level.lineNumber) || null),
        sourceText: source,
        anyBoard: options.anyBoard === true,
    });
    return Object.assign({ ok: true, ms: Math.round(performance.now() - start) }, badges);
}

module.exports = { analyze };

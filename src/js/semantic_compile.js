'use strict';

// Compiler-global semantic prefix. Keep rules as source arrays for analysis and
// canonicalization; callers validate the original source through the full compiler.
function psCompileSemantic(str, includeWinConditions = true, optimizationOptions, optimizerAPI) {
    resetParserErrorState();
    compiling = true;
    try {
        const optimizer = optimizationOptions && optimizationOptions.staticAnalysisReport
            ? optimizerAPI.createSolverOptimizationHook(
                optimizationOptions.staticAnalysisReport,
                optimizationOptions.passes || {},
                { actionNoactionMode: optimizationOptions.actionNoactionMode || 'solver' }
            )
            : null;
        const processor = new codeMirrorFn();
        const state = processor.startState();
        const lines = str.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const ss = new CodeMirror.StringStream(lines[i], 4);
            do {
                processor.token(ss, state);
            } while (ss.eol() === false);
        }

        if (!isObjectDefined(state, "player")) {
            logErrorNoLine("Error, didn't find any object called player, either in the objects section, or the legends section. There must be a player!");
        }
        if (!isObjectDefined(state, "background")) {
            logErrorNoLine("Error, didn't find any object called background, either in the objects section, or the legends section. There must be a background!");
        }
        if (state.collisionLayers.length === 0) {
            logError("No collision layers defined.  All objects need to be in collision layers.");
            return {
                state: null,
                errorCount: errorCount,
                errorStrings: errorStrings.slice()
            };
        }

        generateExtraMembers(state);
        generateMasks(state);
        state.backgroundMask = getMaskFromName(state, 'background');
        levelsToArray(state);
        rulesToArray(state);
        if (state.invalid > 0) {
            return {
                state: null,
                errorCount: errorCount,
                errorStrings: errorStrings.slice()
            };
        }
        if (optimizer) {
            cacheAllRuleNames(state);
            removeDuplicateRules(state);
            optimizer(state);
            state.backgroundMask = getMaskFromName(state, 'background');
        }
        if (includeWinConditions) {
            processWinConditions(state);
        }
        checkObjectsAreLayered(state);

        return {
            state: state,
            errorCount: errorCount,
            errorStrings: errorStrings.slice()
        };
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (message !== "Too many errors/warnings; aborting compilation.") {
            throw error;
        }
        const errors = errorStrings.slice();
        if (errors.indexOf(message) < 0) {
            errors.push(message);
        }
        return {
            state: null,
            errorCount: errorCount > 0 ? errorCount : errors.length,
            errorStrings: errors,
            thrown: true
        };
    } finally {
        compiling = false;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { psCompileSemantic };
}

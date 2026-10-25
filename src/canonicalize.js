#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourceFiles = [
    'js/storagewrapper.js',
    'js/bitvec.js',
    'js/level.js',
    'js/languageConstants.js',
    'js/globalVariables.js',
    'js/debug.js',
    'js/plugin_header_on.js',
    'js/font.js',
    'js/rng.js',
    'js/riffwave.js',
    'js/sfxr.js',
    'js/codemirror/stringstream.js',
    'js/colorhelpers.js',
    'js/colors.js',
    'js/engine.js',
    'js/parser.js',
    'js/compiler.js',
    'js/soundbar.js',
    'js/semantic_compile.js',
];

let runtime = null;

function createRuntime() {
    const srcDir = __dirname;
    const context = {
        console,
        require,
        process,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Buffer,
        performance,
    };

    const storage = {};
    context.localStorage = {
        getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
        setItem(key, value) { storage[key] = String(value); },
        removeItem(key) { delete storage[key]; }
    };

    context.document = {
        URL: 'canonicalize://',
        body: {
            classList: { contains() { return false; } },
            addEventListener() {},
            removeEventListener() {}
        },
        createElement() {
            return {
                style: {},
                innerHTML: '',
                textContent: '',
                getContext() { return null; }
            };
        },
        getElementById() { return null; }
    };

    context.window = context;
    context.global = context;
    context.globalThis = context;
    context.lastDownTarget = null;
    context.canvas = null;
    context.input = context.document.createElement('TEXTAREA');
    context.levelEditorOpened = false;
    context.canDump = false;
    context.compiledText = '';
    context.IDE = false;
    context.unitTesting = false;
    context.form1 = { code: { editorreference: { getValue() { return ''; } } } };

    context.canvasResize = function() {};
    context.redraw = function() {};
    context.forceRegenImages = function() {};
    context.consolePrintFromRule = function() {};
    context.consoleCacheDump = function() {};
    context.addToDebugTimeline = function() {};
    context.killAudioButton = function() {};
    context.showAudioButton = function() {};
    context.regenSpriteImages = function() {};
    context.jumpToLine = function() {};
    context.printLevel = function() {};
    context.playSound = function() {};

    context.Audio = function Audio() {
        return {
            src: '',
            play() { return Promise.resolve(); },
            cloneNode() { return new context.Audio(); }
        };
    };

    context.levelString = '';
    context.inputString = '';
    context.outputString = '';
    context.editor = { getValue() { return context.levelString; } };

    context.QUnit = {
        push() {},
        assert: { equal() {} }
    };

    context.consolePrint = function() {};
    context.consoleError = function() {};
    context.UnitTestingThrow = function(error) {
        throw error;
    };

    let allCode = '';
    for (const file of sourceFiles) {
        const code = fs.readFileSync(path.join(srcDir, file), 'utf8');
        allCode += `\n// ---- ${file} ----\n${code}\n`;
    }

    const solverStaticOptCode = fs.readFileSync(path.join(srcDir, 'tests/solver_static_opt.js'), 'utf8');
    allCode += `
globalThis.__ps_solver_static_opt = (function() {
    const module = { exports: {} };
    const exports = module.exports;
${solverStaticOptCode}
    return module.exports;
})();
`;

    allCode += `
globalThis.__ps_exports = {
    parseSource: function(str) {
        resetParserErrorState();
        compiling = true;
        const processor = new codeMirrorFn();
        const state = processor.startState();
        let aborted = false;
        try {
            const lines = str.split('\\n');
            for (let i = 0; i < lines.length; i++) {
                const ss = new CodeMirror.StringStream(lines[i], 4);
                do {
                    processor.token(ss, state);
                } while (ss.eol() === false);
            }
        } catch (error) {
            // The parser throws once MAX_ERRORS is exceeded; keep the partial state.
            const message = error && error.message ? error.message : String(error);
            if (message !== "Too many errors/warnings; aborting compilation.") {
                throw error;
            }
            aborted = true;
            // Mirror the sibling catches: an aborted parse is an error even when the
            // abort came from warnings alone, so canonicalizeSource still refuses it.
            if (errorStrings.indexOf(message) < 0) {
                errorStrings.push(message);
            }
            if (!(errorCount > 0)) {
                errorCount = errorStrings.length;
            }
        } finally {
            compiling = false;
        }
        return {
            state: processor.copyState(state),
            errorCount: errorCount,
            errorStrings: errorStrings.slice(),
            aborted: aborted
        };
    },
    compileSemantic: function(str, includeWinConditions, optimizationOptions) {
        return psCompileSemantic(str, includeWinConditions, optimizationOptions, __ps_solver_static_opt);
    },
    compileValidateState: function(str, includeWinConditions) {
        // Full-engine validation gate for the static analyzer. Mirrors
        // loadFile's validation prefix through checkObjectsAreLayered,
        // INCLUDING rulesToMask / collapseRules / generateRigidGroupList, which
        // compileSemantic skips and which are where the real engine rejects
        // several rule-level constructs (same-cell overlap, RANDOM on the LHS,
        // ellipsis pairing, unlayered objects, etc.). rulesToMask is destructive
        // (it overwrites rule cells with CellPattern objects), so this runs on
        // its own throwaway state; only errorCount/errorStrings are returned.
        // loadFile's diagnostic tail after checkObjectsAreLayered is
        // intentionally skipped (see the note at the end of this function),
        // which also means this never needs graphics or audio shims.
        resetParserErrorState();
        compiling = true;
        try {
            const processor = new codeMirrorFn();
            const state = processor.startState();
            const lines = str.split('\\n');
            for (let i = 0; i < lines.length; i++) {
                const ss = new CodeMirror.StringStream(lines[i], 4);
                do {
                    processor.token(ss, state);
                    if (errorCount > MAX_ERRORS) {
                        return { state: null, errorCount: errorCount, errorStrings: errorStrings.slice() };
                    }
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
                return { state: null, errorCount: errorCount, errorStrings: errorStrings.slice() };
            }
            generateExtraMembers(state);
            generateMasks(state);
            ensureNameMembershipSets(state);
            levelsToArray(state);
            rulesToArray(state);
            if (state.invalid > 0) {
                return { state: null, errorCount: errorCount, errorStrings: errorStrings.slice() };
            }
            cacheAllRuleNames(state);
            removeDuplicateRules(state);
            pluginOptimizationHook(state);
            rulesToMask(state);
            arrangeRulesByGroupNumber(state);
            collapseRules(state.rules, state);
            collapseRules(state.lateRules, state);
            generateRigidGroupList(state);
            if (includeWinConditions !== false) {
                processWinConditions(state);
            }
            checkObjectsAreLayered(state);
            // The gate stops here, at the last pass that can change the
            // rule/object/win-condition model the analyzer reasons about.
            // loadFile's remaining tail -- twiddleMetaData, generateLoopPoints,
            // generateSoundData, formatHomePage, addSpecializedFunctions -- is
            // intentionally NOT run. Those passes only diagnose presentation /
            // audio / metadata (dimensions, loop-bracket pairing, sound
            // declarations, homepage colors) and emit pure codegen; none of it
            // feeds the analyzer's model. Crucially, the real engine still PLAYS
            // a game whose only errors come from them (errorCount stays within
            // MAX_ERRORS and loadFile returns a non-null state), so running them
            // here would reject games the engine accepts and the analyzer can
            // soundly analyze. See STATIC_ANALYSIS_SOUNDNESS.md.
            return { state: state, errorCount: errorCount, errorStrings: errorStrings.slice() };
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
                errorCount: errorCount > 0 ? errorCount : errors.length,
                errorStrings: errors,
                thrown: true
            };
        } finally {
            compiling = false;
            // rulesToMask/collapseRules pushed every CellPattern/Rule onto the
            // global lazy-function worklist, but this gate never plays the game
            // so nothing ever drains it. Clear it on the way out so the shared
            // runtime context doesn't accumulate those objects (and the state
            // graphs they pin) across analyzeSource calls. compile() clears at
            // the start for the same reason; we clear on exit since there is
            // nothing to drain here.
            lazy_function_generation_clear_backlog();
        }
    },
    compileValidate: function(str, includeWinConditions) {
        const result = this.compileValidateState(str, includeWinConditions);
        return {
            errorCount: result.errorCount || 0,
            errorStrings: (result.errorStrings || []).slice(),
            thrown: result.thrown === true
        };
    },
    analyzeInputSpecialization: function(str) {
        const result = this.compileValidateState(str, true);
        const output = {
            ok: !(result.errorCount > 0) && result.state !== null,
            errorCount: result.errorCount || 0,
            errorStrings: (result.errorStrings || []).slice(),
            mainRules: [],
            lateRules: []
        };
        if (!result.state) {
            return output;
        }
        attachInputSpecializationMasks(result.state);
        function appendRules(groups, target) {
            for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
                const group = groups[groupIndex];
                for (let ruleIndex = 0; ruleIndex < group.length; ruleIndex++) {
                    const rule = group[ruleIndex];
                    target.push({
                        groupIndex: groupIndex,
                        ruleIndex: ruleIndex,
                        line: rule.lineNumber,
                        groupNumber: rule.groupNumber,
                        activeInputsMask: rule.activeInputsMask,
                        forceAlwaysRun: rule.forceAlwaysRun === true,
                        forceAlwaysRunReason: rule.forceAlwaysRunReason || null
                    });
                }
            }
        }
        appendRules(result.state.rules || [], output.mainRules);
        appendRules(result.state.lateRules || [], output.lateRules);
        return output;
    }
};
`;

    vm.createContext(context);
    vm.runInContext(allCode, context, { filename: 'canonicalize_runtime.js' });
    runtimeContext = context;
    return context.__ps_exports;
}

let runtimeContext = null;

function getRuntime() {
    if (runtime === null) {
        runtime = createRuntime();
    }
    return runtime;
}

// Run extra code inside the engine's vm context (e.g. to load src/js scripts that are
// not part of the compile pipeline, such as the autocomplete module) and return its value.
function evalInRuntime(code, filename = 'canonicalize_extra.js') {
    getRuntime();
    return vm.runInContext(code, runtimeContext, { filename });
}

const {
    analyzeInputSpecialization,
    canonicalizeCompiledLevelState,
    canonicalizeSemanticWithObjectMap,
    canonicalizeSemanticStateWithObjectMap,
    canonicalizeSource,
    compileSemanticSource,
    createCompiledLevelStateProjector,
    parseSourceState,
    validateCompileSource,
} = require('./js/canonicalize_core').createCanonicalizer({
    getRuntime,
    getOptimizerAPI() { return require('./tests/solver_static_opt'); },
    analyzeSource(source, options) { return require('./tests/ps_static_analysis').analyzeSource(source, options); },
});

function stableStringify(value) {
    return JSON.stringify(value, null, 2);
}

function hashCanonical(value) {
    return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function canonicalizeFile(inputPath, mode = 'structural', options = {}) {
    const source = fs.readFileSync(inputPath, 'utf8');
    if (mode && typeof mode === 'object') {
        return canonicalizeSource(source, Object.assign({ sourcePath: inputPath }, mode));
    }
    return canonicalizeSource(source, mode, Object.assign({ sourcePath: inputPath }, options));
}

function buildComparisonHashes(source, options = {}) {
    const modes = ['full', 'structural', 'no-levels', 'mechanics', 'ruleset', 'semantic', 'family'];
    const result = {};
    for (const mode of modes) {
        result[mode] = hashCanonical(canonicalizeSource(source, mode, options));
    }
    return result;
}

module.exports = {
    analyzeInputSpecialization,
    buildComparisonHashes,
    canonicalizeCompiledLevelState,
    canonicalizeFile,
    canonicalizeSemanticWithObjectMap,
    canonicalizeSemanticStateWithObjectMap,
    canonicalizeSource,
    compileSemanticSource,
    createCompiledLevelStateProjector,
    evalInRuntime,
    hashCanonical,
    parseSourceState,
    stableStringify,
    validateCompileSource,
};

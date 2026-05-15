#!/usr/bin/env node
'use strict';

const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

const INPUT_BY_TOKEN = new Map([
    ['up', 0],
    ['left', 1],
    ['down', 2],
    ['right', 3],
    ['action', 4],
]);

let runtimeLoaded = false;

function loadPuzzleScriptRuntime() {
    if (!runtimeLoaded) {
        loadPuzzleScript();
        runtimeLoaded = true;
    }
}

function stripCompilerMessages() {
    if (!Array.isArray(errorStrings)) {
        return '';
    }
    return errorStrings.map(message => {
        if (typeof stripHTMLTags === 'function') {
            return stripHTMLTags(message);
        }
        return String(message).replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
    }).join('\n');
}

function compileReplaySource(source, game) {
    loadPuzzleScriptRuntime();
    if (typeof resetParserErrorState === 'function') {
        resetParserErrorState();
    }
    unitTesting = true;
    lazyFunctionGeneration = false;
    compile(['loadLevel', 0], source, `canonical-replay:${game}:0`);
    if (errorCount > 0) {
        throw new Error(stripCompilerMessages());
    }
}

function settleAgainForReplay() {
    for (let pass = 0; pass < 500 && againing; pass++) {
        againing = false;
        processInput(-1, undefined, undefined, true);
    }
}

function stepReplayToken(token) {
    if (!INPUT_BY_TOKEN.has(token)) {
        throw new Error(`Unsupported solution token: ${token}`);
    }
    const beforeLevel = curlevel;
    const beforeTitle = titleScreen;
    const input = INPUT_BY_TOKEN.get(token);
    if (input === 4 && textMode && !titleScreen) {
        if (state.levels[curlevel] && state.levels[curlevel].message !== undefined) {
            nextLevel();
        } else {
            textMode = false;
            messagetext = '';
            messageselected = false;
        }
    } else {
        processInput(input, undefined, undefined, true);
    }
    settleAgainForReplay();
    return curlevel !== beforeLevel || (!beforeTitle && titleScreen);
}

function replaySolutionOnOriginal({ source, game, level, solution }) {
    try {
        compileReplaySource(source, game);
        if (!state.levels[level]) {
            return {
                game,
                level,
                solution,
                status: 'invalid_level',
                steps: 0,
                error: `Missing level ${level}`,
            };
        }
        if (state.levels[level].message !== undefined) {
            return {
                game,
                level,
                solution,
                status: 'skipped_message',
                steps: 0,
                error: `Level ${level} is a message level`,
            };
        }
        loadLevelFromState(state, level, `canonical-replay:${game}:${level}`);
        for (let index = 0; index < solution.length; index++) {
            if (stepReplayToken(solution[index])) {
                return {
                    game,
                    level,
                    solution,
                    status: 'solved',
                    steps: index + 1,
                };
            }
        }
        return {
            game,
            level,
            solution,
            status: 'not_solved',
            steps: solution.length,
            error: `Replay ended without satisfying the win condition`,
        };
    } catch (error) {
        return {
            game,
            level,
            solution,
            status: 'replay_error',
            steps: 0,
            error: error && error.stack ? error.stack : String(error),
        };
    }
}

function formatReplayFailure(result) {
    const solution = Array.isArray(result.solution) ? result.solution.join(',') : '';
    return [
        `canonical replay failed game=${result.game} level=${result.level}`,
        `  solution=${solution}`,
        `  replay_status=${result.status}`,
        `  error=${result.error || ''}`,
    ].join('\n');
}

function main() {
    process.stderr.write('run_canonical_solution_replay.js CLI is not implemented yet\n');
    process.exit(2);
}

module.exports = {
    formatReplayFailure,
    loadPuzzleScriptRuntime,
    replaySolutionOnOriginal,
};

if (require.main === module) {
    main();
}

'use strict';

const START_CONTEXT = '<start>';
const INPUT_TOKENS = new Set(['right', 'up', 'down', 'left', 'action']);

function transitionsFor(solution) {
    const transitions = new Map();
    let context = START_CONTEXT;
    for (const token of solution) {
        let counts = transitions.get(context);
        if (!counts) {
            counts = new Map();
            transitions.set(context, counts);
        }
        counts.set(token, (counts.get(token) || 0) + 1);
        context = token;
    }
    return transitions;
}

function createSiblingMarkovPriorStore(payload) {
    if (!payload || !Array.isArray(payload.results)) {
        throw new Error('solver sibling priors: expected top-level results array');
    }

    const games = new Map();
    const seenSolved = new Set();
    let ignoredRecords = 0;

    for (const result of payload.results) {
        if (!result || result.status !== 'solved'
            || typeof result.game !== 'string'
            || !Number.isInteger(result.level) || result.level < 0) {
            ignoredRecords++;
            continue;
        }

        const key = `${result.game}\u0000${result.level}`;
        if (seenSolved.has(key)) {
            throw new Error(`solver sibling priors: duplicate solved training record ${result.game}#${result.level}`);
        }
        seenSolved.add(key);

        if (!Array.isArray(result.solution) || result.solution.length === 0
            || result.solution.some((token) => !INPUT_TOKENS.has(token))) {
            ignoredRecords++;
            continue;
        }

        if (!games.has(result.game)) {
            games.set(result.game, new Map());
        }
        games.get(result.game).set(result.level, transitionsFor(result.solution));
    }

    return {
        ignoredRecords,
        forTarget(game, level, actions) {
            const levels = games.get(game);
            if (!levels) {
                return null;
            }

            const totals = new Map();
            let trainingLevels = 0;
            for (const [siblingLevel, transitions] of levels) {
                if (siblingLevel === level) {
                    continue;
                }
                trainingLevels++;
                for (const [context, counts] of transitions) {
                    if (!totals.has(context)) {
                        totals.set(context, new Map());
                    }
                    const target = totals.get(context);
                    for (const [token, count] of counts) {
                        target.set(token, (target.get(token) || 0) + count);
                    }
                }
            }
            if (trainingLevels === 0) {
                return null;
            }

            const orderedByContext = new Map();
            for (const [context, counts] of totals) {
                const ordered = actions.map((action, baselineIndex) => ({
                    action,
                    baselineIndex,
                    count: counts.get(action.token) || 0,
                })).sort((left, right) =>
                    right.count - left.count || left.baselineIndex - right.baselineIndex
                );
                if (ordered.some((entry) => entry.count > 0)) {
                    orderedByContext.set(context, ordered.map((entry) => entry.action));
                }
            }

            return {
                trainingLevels,
                contextCount: orderedByContext.size,
                actionsFor(context) {
                    return orderedByContext.get(context === null ? START_CONTEXT : context) || null;
                },
            };
        },
    };
}

module.exports = {
    START_CONTEXT,
    createSiblingMarkovPriorStore,
};

'use strict';

// PuzzleScriptPlus-style level solver (Auroriax/PuzzleScriptPlus solver.js).
// Greedy best-first search ordered by getScore() then path length.

function manhattanDistance(index1, index2, height) {
    return Math.abs(Math.floor(index1 / height) - Math.floor(index2 / height))
        + Math.abs((index1 % height) - (index2 % height));
}

function createDistanceTable(nTiles, height) {
    const table = new Array(nTiles);
    for (let i = 0; i < nTiles; i++) {
        const row = new Array(nTiles);
        for (let j = 0; j < nTiles; j++) {
            row[j] = manhattanDistance(i, j, height);
        }
        table[i] = row;
    }
    return table;
}

function createPsPlusGetScore(state, level, distanceTable, scratchCell) {
    const maxDistance = level.width + level.height;
    const winconditions = state.winconditions || [];

    function filterMatches(filter, tileIndex) {
        const cell = level.getCellInto(tileIndex, scratchCell);
        return !filter.bitsClearInArray(cell.data);
    }

    return function getScore() {
        let score = 0;
        if (winconditions.length === 0) {
            return score;
        }
        for (let wcIndex = 0; wcIndex < winconditions.length; wcIndex++) {
            const wincondition = winconditions[wcIndex];
            const filter1 = wincondition[1];
            const filter2 = wincondition[2];
            if (wincondition[0] === -1) {
                for (let i = 0; i < level.n_tiles; i++) {
                    if (filterMatches(filter1, i) && filterMatches(filter2, i)) {
                        score += 1;
                    }
                }
            } else {
                for (let i = 0; i < level.n_tiles; i++) {
                    if (!filterMatches(filter1, i)) {
                        continue;
                    }
                    let minDistance = maxDistance;
                    for (let j = 0; j < level.n_tiles; j++) {
                        if (filterMatches(filter2, j)) {
                            const dist = distanceTable[i][j];
                            if (dist < minDistance) {
                                minDistance = dist;
                            }
                        }
                    }
                    score += minDistance;
                }
            }
        }
        return score;
    };
}

function byScoreAndLength(a, b) {
    if (a[0] !== b[0]) {
        return a[0] < b[0];
    }
    return a[2].length < b[2].length;
}

class PsPlusQueue {
    constructor() {
        this.items = [];
    }

    get length() {
        return this.items.length;
    }

    isEmpty() {
        return this.items.length === 0;
    }

    add(item) {
        const items = this.items;
        items.push(item);
        let index = items.length - 1;
        while (index > 0) {
            const parent = (index - 1) >>> 1;
            if (!byScoreAndLength(item, items[parent])) {
                break;
            }
            items[index] = items[parent];
            index = parent;
        }
        items[index] = item;
    }

    poll() {
        const items = this.items;
        if (items.length === 0) {
            return null;
        }
        const first = items[0];
        const last = items.pop();
        const length = items.length;
        if (length === 0) {
            return first;
        }
        let index = 0;
        const half = length >>> 1;
        while (index < half) {
            let best = index * 2 + 1;
            const right = best + 1;
            let bestItem = items[best];
            if (right < length) {
                const rightItem = items[right];
                if (byScoreAndLength(rightItem, bestItem)) {
                    best = right;
                    bestItem = rightItem;
                }
            }
            if (!byScoreAndLength(bestItem, last)) {
                break;
            }
            items[index] = bestItem;
            index = best;
        }
        items[index] = last;
        return first;
    }
}

function shuffleALittle(array) {
    if (array.length < 2) {
        return;
    }
    const randomIndex = 1 + Math.floor(Math.random() * (array.length - 1));
    const temporaryValue = array[0];
    array[0] = array[randomIndex];
    array[randomIndex] = temporaryValue;
}

function stateKey(objects) {
    return objects.toString();
}

function runNaiveSolver(options) {
    const {
        deadline,
        actions,
        getScore,
        stepAction,
        restoreObjects,
        createObjectsSnapshot,
        result,
        searchStarted,
    } = options;

    const exploredStates = Object.create(null);
    const queue = new PsPlusQueue();
    const initialSnapshot = createObjectsSnapshot();
    exploredStates[stateKey(options.level.objects)] = true;
    queue.add([getScore(), initialSnapshot, []]);
    result.unique_states = 1;
    result.max_frontier = 1;

    const actionOrder = actions.map((_, index) => index);

    while (!queue.isEmpty()) {
        if (Date.now() >= deadline) {
            result.status = 'timeout';
            break;
        }
        const entry = queue.poll();
        const parentState = entry[1];
        const path = entry[2];
        result.expanded++;

        shuffleALittle(actionOrder);
        for (let orderIndex = 0; orderIndex < actionOrder.length; orderIndex++) {
            const action = actions[actionOrder[orderIndex]];
            restoreObjects(parentState);

            const stepResult = stepAction(action);
            result.generated++;
            if (!stepResult.changed) {
                result.step_no_op++;
                continue;
            }
            result.step_changed++;

            if (stepResult.solved) {
                result.solution = path.concat([action.token]);
                result.solution_length = result.solution.length;
                result.elapsed_ms = Date.now() - searchStarted;
                result.status = 'solved';
                return result;
            }

            const key = stateKey(options.level.objects);
            if (Object.prototype.hasOwnProperty.call(exploredStates, key)) {
                result.duplicates++;
                continue;
            }
            exploredStates[key] = true;
            result.unique_states++;
            queue.add([getScore(), createObjectsSnapshot(), path.concat([action.token])]);
            result.max_frontier = Math.max(result.max_frontier, queue.length);
        }
    }

    result.solution_length = result.solution.length;
    result.elapsed_ms = Date.now() - searchStarted;
    return result;
}

module.exports = {
    createDistanceTable,
    createPsPlusGetScore,
    runNaiveSolver,
};

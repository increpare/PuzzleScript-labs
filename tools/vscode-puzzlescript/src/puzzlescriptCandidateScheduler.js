'use strict';

function normalizeRows(cells) {
    if (!Array.isArray(cells)) {
        return [];
    }
    return cells.map(row => Array.isArray(row) ? row.map(String) : [...String(row)]);
}

function gridDifference(a, b) {
    const left = normalizeRows(a);
    const right = normalizeRows(b);
    const height = Math.max(left.length, right.length);
    let diff = 0;
    for (let y = 0; y < height; y++) {
        const rowA = left[y] || [];
        const rowB = right[y] || [];
        const width = Math.max(rowA.length, rowB.length);
        for (let x = 0; x < width; x++) {
            const hasA = x < rowA.length;
            const hasB = x < rowB.length;
            if (hasA !== hasB || (hasA && String(rowA[x]) !== String(rowB[x]))) {
                diff += 1;
            }
        }
    }
    return diff;
}

function effortScore(candidate) {
    if (candidate.unique_states != null) {
        return Number(candidate.unique_states) || 0;
    }
    if (candidate.uniqueStates != null) {
        return Number(candidate.uniqueStates) || 0;
    }
    if (candidate.generated != null) {
        return Number(candidate.generated) || 0;
    }
    return Number(candidate.expanded) || 0;
}

function candidateHash(candidate) {
    return String(candidate.level_hash != null ? candidate.level_hash : candidate.levelHash);
}

class CandidateBatchState {
    constructor(options = {}) {
        this.batchId = options.batchId || `batch-${Date.now()}`;
        this.topCount = options.topCount || 3;
        this.promotionBudgetsMs = options.promotionBudgetsMs || [1000, 5000, 30000, 120000];
        this.promotionQueueLimit = options.promotionQueueLimit || 64;
        this.byHash = new Map();
        this.loggedTopHashes = new Set();
        this.solved = [];
        this.timeouts = [];
        this.promoted = [];
    }

    normalize(candidate) {
        const normalized = { ...candidate };
        normalized.level_hash = candidate.level_hash != null ? candidate.level_hash : candidate.levelHash;
        normalized.effort_score = effortScore(candidate);
        normalized.cells = normalizeRows(candidate.cells || candidate.rows);
        normalized.solver_budget_ms = Number(candidate.solver_budget_ms || candidate.solverBudgetMs || this.promotionBudgetsMs[0]);
        return normalized;
    }

    recordEvaluation(candidate) {
        const normalized = this.normalize(candidate);
        const key = candidateHash(normalized);
        if (!key) {
            return { becameTopSolved: false };
        }
        this.byHash.set(key, normalized);
        if (normalized.status === 'solved') {
            const before = this.solvedTop().map(candidateHash).join(',');
            this.solved = this.solved.filter(entry => candidateHash(entry) !== key);
            this.solved.push(normalized);
            this.solved.sort((a, b) => b.effort_score - a.effort_score || String(a.level_hash).localeCompare(String(b.level_hash)));
            const afterTop = this.solvedTop();
            const after = afterTop.map(candidateHash).join(',');
            return {
                becameTopSolved: before !== after && afterTop.some(entry => candidateHash(entry) === key),
            };
        }
        if (normalized.status === 'timeout') {
            this.timeouts = this.timeouts.filter(entry => candidateHash(entry) !== key);
            this.timeouts.push(normalized);
            this.sortAndTrimTimeouts();
        }
        return { becameTopSolved: false };
    }

    solvedTop() {
        return this.solved.slice(0, this.topCount);
    }

    diversityScore(candidate) {
        const anchors = this.promoted.length > 0 ? this.promoted : [...this.solvedTop(), ...this.timeouts.slice(0, 3)];
        const distances = anchors
            .filter(entry => candidateHash(entry) !== candidateHash(candidate))
            .map(entry => gridDifference(candidate.cells, entry.cells));
        return distances.length === 0 ? 0 : Math.min(...distances);
    }

    promotionScore(candidate) {
        return candidate.effort_score + this.diversityScore(candidate);
    }

    sortAndTrimTimeouts() {
        this.timeouts.sort((a, b) => this.promotionScore(b) - this.promotionScore(a));
        if (this.timeouts.length > this.promotionQueueLimit) {
            this.timeouts.length = this.promotionQueueLimit;
        }
    }

    nextPromotion() {
        this.sortAndTrimTimeouts();
        while (this.timeouts.length > 0) {
            const candidate = this.timeouts.shift();
            const currentIndex = this.promotionBudgetsMs.findIndex(budget => budget > candidate.solver_budget_ms);
            if (currentIndex < 0) {
                continue;
            }
            const promoted = { ...candidate, next_budget_ms: this.promotionBudgetsMs[currentIndex] };
            this.promoted.push(promoted);
            return promoted;
        }
        return null;
    }

    timeoutQueue() {
        this.sortAndTrimTimeouts();
        return this.timeouts.slice();
    }

    shouldLogSolvedTop(levelHash) {
        const key = String(levelHash);
        if (this.loggedTopHashes.has(key)) {
            return false;
        }
        if (!this.solvedTop().some(entry => candidateHash(entry) === key)) {
            return false;
        }
        this.loggedTopHashes.add(key);
        return true;
    }
}

module.exports = {
    CandidateBatchState,
    effortScore,
    gridDifference,
};

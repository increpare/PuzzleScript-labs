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

function hasHashValue(value) {
    return value !== undefined && value !== null && String(value) !== '';
}

function normalizeExactHash(value) {
    if (typeof value !== 'string' || !/^(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{32})$/.test(value)) {
        return null;
    }
    return value.toLowerCase();
}

function normalizeLegacyHash(value) {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    }
    if (typeof value === 'string') {
        if (!/^\d+$/.test(value)) {
            return null;
        }
        const parsed = BigInt(value);
        if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
            return null;
        }
        return parsed.toString();
    }
    return null;
}

function candidateIdentity(candidate) {
    if (candidate && typeof candidate === 'object') {
        const exactHash = hasHashValue(candidate.levelHashHex) ? candidate.levelHashHex : candidate.level_hash_hex;
        if (hasHashValue(exactHash)) {
            const normalizedExactHash = normalizeExactHash(exactHash);
            if (!normalizedExactHash) {
                return null;
            }
            return { key: `exact:${normalizedExactHash}`, exactHash: normalizedExactHash };
        }
        const legacyHash = hasHashValue(candidate.levelHash) ? candidate.levelHash : candidate.level_hash;
        if (hasHashValue(legacyHash)) {
            const normalizedLegacyHash = normalizeLegacyHash(legacyHash);
            if (!normalizedLegacyHash) {
                return null;
            }
            return { key: `legacy:${normalizedLegacyHash}`, legacyHash: normalizedLegacyHash };
        }
        return null;
    }
    const normalizedLegacyHash = normalizeLegacyHash(candidate);
    return normalizedLegacyHash ? { key: `legacy:${normalizedLegacyHash}`, legacyHash: normalizedLegacyHash } : null;
}

function candidateHash(candidate) {
    const identity = candidateIdentity(candidate);
    return identity ? identity.key : null;
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
        candidate = candidate && typeof candidate === 'object' ? candidate : {};
        const normalized = { ...candidate };
        const identity = candidateIdentity(candidate);
        normalized.identity_key = identity ? identity.key : null;
        normalized.level_hash = candidate.level_hash != null ? candidate.level_hash : candidate.levelHash;
        normalized.effort_score = effortScore(candidate);
        normalized.cells = normalizeRows(candidate.cells || candidate.rows);
        const solverBudgetMs = candidate.solver_budget_ms != null
            ? candidate.solver_budget_ms
            : candidate.solverBudgetMs != null ? candidate.solverBudgetMs : this.promotionBudgetsMs[0];
        normalized.solver_budget_ms = Number(solverBudgetMs);
        return normalized;
    }

    recordEvaluation(candidate) {
        const normalized = this.normalize(candidate);
        const key = normalized.identity_key;
        if (!key) {
            return { becameTopSolved: false };
        }
        if (normalized.status === 'solved') {
            const wasInTop = this.solvedTop().some(entry => candidateHash(entry) === key);
            this.solved = this.solved.filter(entry => candidateHash(entry) !== key);
            this.timeouts = this.timeouts.filter(entry => candidateHash(entry) !== key);
            this.solved.push(normalized);
            this.solved.sort((a, b) => b.effort_score - a.effort_score || String(candidateHash(a)).localeCompare(String(candidateHash(b))));
            this.byHash.set(key, normalized);
            const afterTop = this.solvedTop();
            return {
                becameTopSolved: !wasInTop && afterTop.some(entry => candidateHash(entry) === key),
            };
        }
        if (normalized.status === 'timeout') {
            if (this.hasSolvedHash(key) || this.nextBudgetFor(normalized) == null) {
                return { becameTopSolved: false };
            }
            this.timeouts = this.timeouts.filter(entry => candidateHash(entry) !== key);
            this.timeouts.push(normalized);
            this.sortAndTrimTimeouts();
            this.byHash.set(key, normalized);
        }
        return { becameTopSolved: false };
    }

    solvedTop() {
        return this.solved.slice(0, this.topCount);
    }

    hasSolvedHash(key) {
        return this.solved.some(entry => candidateHash(entry) === key);
    }

    nextBudgetFor(candidate) {
        const nextBudget = this.promotionBudgetsMs.find(budget => budget > candidate.solver_budget_ms);
        return nextBudget == null ? null : nextBudget;
    }

    diversityAnchors() {
        return this.promoted.length > 0 ? this.promoted.slice() : [...this.solvedTop(), ...this.timeouts.slice(0, 3)];
    }

    diversityScore(candidate, anchors = this.diversityAnchors()) {
        const distances = anchors
            .filter(entry => candidateHash(entry) !== candidateHash(candidate))
            .map(entry => gridDifference(candidate.cells, entry.cells));
        return distances.length === 0 ? 0 : Math.min(...distances);
    }

    promotionScore(candidate, anchors) {
        return candidate.effort_score + this.diversityScore(candidate, anchors);
    }

    sortAndTrimTimeouts() {
        this.timeouts = this.timeouts.filter(entry => {
            const key = candidateHash(entry);
            return key && this.nextBudgetFor(entry) != null && !this.hasSolvedHash(key);
        });
        const anchors = this.diversityAnchors();
        const scores = new Map();
        for (const candidate of this.timeouts) {
            scores.set(candidateHash(candidate), this.promotionScore(candidate, anchors));
        }
        this.timeouts.sort((a, b) => {
            const keyA = candidateHash(a);
            const keyB = candidateHash(b);
            return scores.get(keyB) - scores.get(keyA) || String(keyA).localeCompare(String(keyB));
        });
        if (this.timeouts.length > this.promotionQueueLimit) {
            this.timeouts.length = this.promotionQueueLimit;
        }
    }

    nextPromotion() {
        this.sortAndTrimTimeouts();
        while (this.timeouts.length > 0) {
            const candidate = this.timeouts.shift();
            const nextBudget = this.nextBudgetFor(candidate);
            if (nextBudget == null) {
                continue;
            }
            const promoted = { ...candidate, next_budget_ms: nextBudget };
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
        const key = candidateHash(levelHash);
        if (!key) {
            return false;
        }
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

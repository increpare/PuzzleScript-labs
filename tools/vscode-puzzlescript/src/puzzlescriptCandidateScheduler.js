'use strict';

const DEFAULT_PROMOTION_BUDGETS_MS = [1000, 5000, 30000, 120000];
const DEFAULT_TOP_COUNT = 3;
const DEFAULT_PROMOTION_QUEUE_LIMIT = 64;

function normalizeRows(cells) {
    if (!Array.isArray(cells)) {
        return [];
    }
    return cells.map(row => Array.isArray(row) ? row.map(String) : [...String(row)]);
}

function copyCandidate(candidate) {
    const copy = { ...candidate };
    copy.cells = normalizeRows(candidate.cells);
    if (Array.isArray(candidate.rows)) {
        copy.rows = candidate.rows.slice();
    }
    if (Array.isArray(candidate.solution)) {
        copy.solution = candidate.solution.slice();
    }
    if (Array.isArray(candidate.identity_keys)) {
        copy.identity_keys = candidate.identity_keys.slice();
    }
    return copy;
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

function legacyHashFromExactHash(value) {
    const normalizedExactHash = normalizeExactHash(value);
    if (!normalizedExactHash) {
        return null;
    }
    const parsed = BigInt(`0x${normalizedExactHash}`);
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
        return null;
    }
    return parsed.toString();
}

function addUniqueKey(keys, key) {
    if (key && !keys.includes(key)) {
        keys.push(key);
    }
}

function candidateIdentity(candidate) {
    if (candidate && typeof candidate === 'object') {
        const keys = [];
        const exactHash = hasHashValue(candidate.levelHashHex) ? candidate.levelHashHex : candidate.level_hash_hex;
        let exactKey = null;
        let legacyAliasFromExactHash = null;
        if (hasHashValue(exactHash)) {
            const normalizedExactHash = normalizeExactHash(exactHash);
            if (!normalizedExactHash) {
                return null;
            }
            exactKey = `exact:${normalizedExactHash}`;
            legacyAliasFromExactHash = legacyHashFromExactHash(exactHash);
            addUniqueKey(keys, exactKey);
            addUniqueKey(keys, legacyAliasFromExactHash ? `legacy:${legacyAliasFromExactHash}` : null);
        }
        const legacyHash = hasHashValue(candidate.levelHash) ? candidate.levelHash : candidate.level_hash;
        let legacyKey = null;
        if (hasHashValue(legacyHash)) {
            const normalizedLegacyHash = normalizeLegacyHash(legacyHash);
            if (!normalizedLegacyHash && !exactKey) {
                return null;
            }
            if (normalizedLegacyHash && (!exactKey || legacyAliasFromExactHash === normalizedLegacyHash)) {
                legacyKey = `legacy:${normalizedLegacyHash}`;
                addUniqueKey(keys, legacyKey);
            }
        }
        if (exactKey || legacyKey) {
            return { key: exactKey || legacyKey, keys };
        }
        return null;
    }
    if (typeof candidate === 'string') {
        const normalizedExactHash = normalizeExactHash(candidate);
        if (normalizedExactHash) {
            const key = `exact:${normalizedExactHash}`;
            const keys = [key];
            const legacyAlias = legacyHashFromExactHash(candidate);
            if (legacyAlias) {
                addUniqueKey(keys, `legacy:${legacyAlias}`);
            }
            return { key, keys };
        }
    }
    const normalizedLegacyHash = normalizeLegacyHash(candidate);
    if (normalizedLegacyHash) {
        const key = `legacy:${normalizedLegacyHash}`;
        return { key, keys: [key] };
    }
    return null;
}

function candidateHash(candidate) {
    const identity = candidateIdentity(candidate);
    return identity ? identity.key : null;
}

function candidateKeys(candidate) {
    const identity = candidateIdentity(candidate);
    return identity ? identity.keys.slice() : [];
}

function keySetFor(candidateOrKeys) {
    if (candidateOrKeys instanceof Set) {
        return candidateOrKeys;
    }
    if (Array.isArray(candidateOrKeys)) {
        return new Set(candidateOrKeys);
    }
    return new Set(candidateKeys(candidateOrKeys));
}

function identitiesOverlap(candidate, candidateOrKeys) {
    const keys = keySetFor(candidateOrKeys);
    return candidateKeys(candidate).some(key => keys.has(key));
}

function normalizePromotionBudgets(budgets) {
    const source = Array.isArray(budgets) ? budgets : DEFAULT_PROMOTION_BUDGETS_MS;
    const normalized = source
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
        .filter((budget, index, values) => index === 0 || budget !== values[index - 1]);
    return normalized.length > 0 ? normalized : DEFAULT_PROMOTION_BUDGETS_MS.slice();
}

function normalizePositiveInteger(value, fallback) {
    const normalized = Number(value);
    return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

class CandidateBatchState {
    constructor(options = {}) {
        this.batchId = options.batchId || `batch-${Date.now()}`;
        this.topCount = normalizePositiveInteger(options.topCount, DEFAULT_TOP_COUNT);
        this.promotionBudgetsMs = normalizePromotionBudgets(options.promotionBudgetsMs);
        this.promotionQueueLimit = normalizePositiveInteger(options.promotionQueueLimit, DEFAULT_PROMOTION_QUEUE_LIMIT);
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
        normalized.identity_keys = identity ? identity.keys.slice() : [];
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
        const keys = new Set(normalized.identity_keys);
        if (normalized.status === 'solved') {
            const wasInTop = this._currentSolvedTopEntries().some(entry => identitiesOverlap(entry, keys));
            this.solved = this.solved.filter(entry => !identitiesOverlap(entry, keys));
            this.timeouts = this.timeouts.filter(entry => !identitiesOverlap(entry, keys));
            this.solved.push(normalized);
            this.solved.sort((a, b) => b.effort_score - a.effort_score || String(candidateHash(a)).localeCompare(String(candidateHash(b))));
            this.storeCandidate(normalized);
            const afterTop = this._currentSolvedTopEntries();
            return {
                becameTopSolved: !wasInTop && afterTop.some(entry => identitiesOverlap(entry, keys)),
            };
        }
        if (normalized.status === 'timeout') {
            if (this.hasSolvedIdentity(keys) || this.nextBudgetFor(normalized) == null) {
                return { becameTopSolved: false };
            }
            this.timeouts = this.timeouts.filter(entry => !identitiesOverlap(entry, keys));
            this.timeouts.push(normalized);
            this.sortAndTrimTimeouts();
            this.storeCandidate(normalized);
        }
        return { becameTopSolved: false };
    }

    storeCandidate(candidate) {
        for (const key of candidateKeys(candidate)) {
            this.byHash.set(key, candidate);
        }
    }

    _currentSolvedTopEntries() {
        return this.solved.slice(0, this.topCount);
    }

    currentSolvedTop() {
        return this._currentSolvedTopEntries().map(copyCandidate);
    }

    solvedTop() {
        return this.currentSolvedTop();
    }

    hasSolvedIdentity(candidateOrKeys) {
        const keys = keySetFor(candidateOrKeys);
        return this.solved.some(entry => identitiesOverlap(entry, keys));
    }

    nextBudgetFor(candidate) {
        const nextBudget = this.promotionBudgetsMs.find(budget => budget > candidate.solver_budget_ms);
        return nextBudget == null ? null : nextBudget;
    }

    diversityAnchors() {
        return this.promoted.length > 0 ? this.promoted.slice() : [...this._currentSolvedTopEntries(), ...this.timeouts.slice(0, 3)];
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
            const keys = candidateKeys(entry);
            return keys.length > 0 && this.nextBudgetFor(entry) != null && !this.hasSolvedIdentity(keys);
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
            const promoted = copyCandidate({ ...candidate, next_budget_ms: nextBudget });
            this.promoted.push(promoted);
            return copyCandidate(promoted);
        }
        return null;
    }

    timeoutQueue() {
        this.sortAndTrimTimeouts();
        return this.timeouts.map(copyCandidate);
    }

    shouldLogSolvedTop(levelHash) {
        const identity = candidateIdentity(levelHash);
        if (!identity) {
            return false;
        }
        const keys = new Set(identity.keys);
        if (identity.keys.some(key => this.loggedTopHashes.has(key))) {
            return false;
        }
        const matched = this._currentSolvedTopEntries().find(entry => identitiesOverlap(entry, keys));
        if (!matched) {
            return false;
        }
        for (const key of [...identity.keys, ...candidateKeys(matched)]) {
            this.loggedTopHashes.add(key);
        }
        return true;
    }
}

module.exports = {
    CandidateBatchState,
    effortScore,
    gridDifference,
};

'use strict';

const fs = require('fs');
const path = require('path');

function indentRecipe(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => `  ${line}`)
        .join('\n');
}

function hasHashValue(value) {
    return value !== undefined && value !== null && String(value) !== '';
}

function getHashIdentity(entry) {
    if (!entry) {
        return null;
    }
    const exactHash = hasHashValue(entry.levelHashHex) ? entry.levelHashHex : entry.level_hash_hex;
    if (hasHashValue(exactHash)) {
        return { key: `exact:${String(exactHash)}`, exactHash: String(exactHash) };
    }
    const legacyHash = hasHashValue(entry.levelHash) ? entry.levelHash : entry.level_hash;
    if (hasHashValue(legacyHash)) {
        return { key: `legacy:${String(legacyHash)}`, legacyHash };
    }
    return null;
}

function formatGeneratedLevelBlock(entry) {
    const timestamp = entry.timestamp || new Date().toISOString();
    const solution = (entry.solution || []).join(' ');
    const rows = (entry.rows || []).join('\n');
    const hashIdentity = getHashIdentity(entry);
    const legacyHash = hasHashValue(entry.levelHash) ? entry.levelHash : entry.level_hash;
    const lines = [
        `===== GENERATED LEVEL ${timestamp} =====`,
        `source_file: ${entry.sourceFile || ''}`,
        `batch_id: ${entry.batchId || ''}`,
        `source_level: ${entry.sourceLevel}`,
    ];
    if (hashIdentity && hashIdentity.exactHash) {
        lines.push(`level_hash_hex: ${hashIdentity.exactHash}`);
    }
    lines.push(
        `level_hash: ${hasHashValue(legacyHash) ? legacyHash : ''}`,
        `rank_when_logged: ${entry.rankWhenLogged}`,
        `effort_score: ${entry.effortScore}`,
        `solver_status: ${entry.solverStatus || 'solved'}`,
        `solver_strategy: ${entry.solverStrategy || ''}`,
        `solver_budget_ms: ${entry.solverBudgetMs}`,
        `solution_length: ${entry.solutionLength == null ? (entry.solution || []).length : entry.solutionLength}`,
        `solution: ${solution}`,
        `expanded: ${entry.expanded == null ? 0 : entry.expanded}`,
        `generated: ${entry.generated == null ? 0 : entry.generated}`,
        `unique_states: ${entry.uniqueStates == null ? entry.effortScore : entry.uniqueStates}`,
        'recipe:',
        indentRecipe(entry.recipeText || ''),
        'level:',
        rows,
        '',
        ''
    );
    return lines.join('\n');
}

class GeneratedLevelsLog {
    constructor(logPath) {
        this.logPath = logPath;
        this.loggedHashes = new Set();
    }

    appendIfNewTopSolved(entry) {
        if (!entry || entry.solverStatus !== 'solved') {
            return false;
        }
        const hashIdentity = getHashIdentity(entry);
        if (!hashIdentity || this.loggedHashes.has(hashIdentity.key)) {
            return false;
        }
        if (!path.dirname(this.logPath).match(/^\.?$/)) {
            fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
        }
        fs.appendFileSync(this.logPath, formatGeneratedLevelBlock(entry), 'utf8');
        this.loggedHashes.add(hashIdentity.key);
        return true;
    }
}

module.exports = {
    GeneratedLevelsLog,
    formatGeneratedLevelBlock,
};

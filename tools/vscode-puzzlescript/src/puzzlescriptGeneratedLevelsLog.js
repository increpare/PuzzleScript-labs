'use strict';

const fs = require('fs');
const path = require('path');

function indentRecipe(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => `  ${line}`)
        .join('\n');
}

function formatGeneratedLevelBlock(entry) {
    const timestamp = entry.timestamp || new Date().toISOString();
    const solution = (entry.solution || []).join(' ');
    const rows = (entry.rows || []).join('\n');
    return [
        `===== GENERATED LEVEL ${timestamp} =====`,
        `source_file: ${entry.sourceFile || ''}`,
        `batch_id: ${entry.batchId || ''}`,
        `source_level: ${entry.sourceLevel}`,
        `level_hash: ${entry.levelHash}`,
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
        '',
    ].join('\n');
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
        const key = String(entry.levelHash);
        if (!key || this.loggedHashes.has(key)) {
            return false;
        }
        this.loggedHashes.add(key);
        if (!path.dirname(this.logPath).match(/^\.?$/)) {
            fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
        }
        fs.appendFileSync(this.logPath, formatGeneratedLevelBlock(entry), 'utf8');
        return true;
    }
}

module.exports = {
    GeneratedLevelsLog,
    formatGeneratedLevelBlock,
};

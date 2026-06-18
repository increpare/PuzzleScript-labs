'use strict';

const path = require('path');
const { replacementForLevel } = require('./puzzlescriptGeneratorCore');

const SECTION_NAMES = new Set([
    'objects',
    'legend',
    'sounds',
    'collisionlayers',
    'rules',
    'winconditions',
    'levels',
]);

function stripLineComment(line) {
    const index = String(line).indexOf('(');
    return index >= 0 ? String(line).slice(0, index) : String(line);
}

function sectionNameForLine(line) {
    const trimmed = stripLineComment(line).trim().toLowerCase();
    if (/^=+$/.test(trimmed)) {
        return null;
    }
    return SECTION_NAMES.has(trimmed) ? trimmed : null;
}

function isPuzzleScriptCandidateDocument(source, filename) {
    if (/\.(ps|puzzlescript)$/i.test(String(filename || ''))) {
        return true;
    }
    if (!/\.txt$/i.test(String(filename || ''))) {
        return false;
    }
    return String(source || '').split(/\r?\n/).some(line => {
        const section = sectionNameForLine(line);
        return section === 'objects' || section === 'legend' || section === 'levels';
    });
}

function generatedLevelsLogPath(sourcePath) {
    const parsed = path.parse(sourcePath);
    return path.join(parsed.dir, `${parsed.name}.generatedlevels.txt`);
}

function glyphPaletteForSource(source) {
    const lines = String(source || '').split('\n');
    const entries = [];
    let section = '';
    for (const line of lines) {
        const nextSection = sectionNameForLine(line);
        if (nextSection) {
            section = nextSection;
            continue;
        }
        if (section !== 'legend') {
            continue;
        }
        const uncommented = stripLineComment(line).trim();
        const match = uncommented.match(/^(.+?)\s*=\s*(.+)$/);
        if (!match) {
            continue;
        }
        const glyph = match[1].trim();
        if ([...glyph].length !== 1) {
            continue;
        }
        if (/\s+or\s+/i.test(match[2])) {
            continue;
        }
        const objects = match[2]
            .split(/\s+and\s+/i)
            .map(part => part.trim().toLowerCase())
            .filter(Boolean);
        if (objects.length > 0) {
            entries.push({ glyph, objects, label: `${glyph} = ${objects.join(' and ')}` });
        }
    }
    return entries;
}

function boardFromLevel(level) {
    return (level && Array.isArray(level.rows) ? level.rows : [])
        .map(row => [...stripLineComment(row).trim()]);
}

function replaceGlyphAt(board, x, y, glyph) {
    return board.map((row, rowIndex) => row.map((cell, columnIndex) => {
        return rowIndex === y && columnIndex === x ? glyph : cell;
    }));
}

function rowsFromBoard(board) {
    return (board || []).map(row => (row || []).join(''));
}

function replaceLevelRowsInSource(source, level, rows) {
    const edit = replacementForLevel(source, level, { cells: [] });
    const sourceText = String(source || '');
    const newline = sourceText.includes('\r\n') ? '\r\n' : '\n';
    const lines = sourceText.split(newline);
    lines.splice(edit.startLine, edit.endLine - edit.startLine, ...rows);
    return lines.join(newline);
}

function statusLabel(result) {
    if (!result || !result.status) {
        return 'not run';
    }
    if (result.status === 'solved') {
        const length = result.solution_length == null ? 0 : result.solution_length;
        return `solved, ${length} moves`;
    }
    if (result.status === 'timeout') {
        const budget = Number(result.solver_budget_ms || result.timeout_ms || 0);
        if (budget >= 1000 && budget % 1000 === 0) {
            return `timeout @ ${budget / 1000}s`;
        }
        return budget > 0 ? `timeout @ ${budget}ms` : 'timeout';
    }
    return String(result.status).replace(/_/g, ' ');
}

module.exports = {
    boardFromLevel,
    generatedLevelsLogPath,
    glyphPaletteForSource,
    isPuzzleScriptCandidateDocument,
    replaceGlyphAt,
    replaceLevelRowsInSource,
    rowsFromBoard,
    statusLabel,
};

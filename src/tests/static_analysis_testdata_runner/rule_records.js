#!/usr/bin/env node
'use strict';

const assert = require('assert');

function termRefName(term) {
    const ref = term.ref || {};
    if (ref.type === 'object_set') return String(ref.source || ref.objects.join(' or ')).toLowerCase();
    if (ref.canonical_name) return String(ref.canonical_name).toLowerCase();
    if (ref.name) return String(ref.name).toLowerCase();
    if (ref.type === 'ellipsis') return '...';
    return '';
}

function renderRuleTerm(term) {
    if (term.kind === 'absent') return `no ${termRefName(term)}`;
    if (term.kind === 'random_object') return `random ${termRefName(term)}`;
    const name = termRefName(term);
    return term.movement === null ? name : `${term.movement} ${name}`;
}

function renderRuleCell(cell) {
    return cell.map(renderRuleTerm).join(' ');
}

function renderRuleSide(side) {
    return (side || []).map(row => {
        let text = '[';
        row.map(renderRuleCell).forEach((cell, index) => {
            if (index === 0) {
                if (cell.length > 0) text += ` ${cell}`;
            } else {
                text += cell.length > 0 ? ` | ${cell}` : ' |';
            }
        });
        return `${text} ]`;
    }).join(' ');
}

function ruleHasMultipleCells(rule) {
    return rule.lhs.concat(rule.rhs).some(row => row.length > 1);
}

function renderRuleCommands(rule) {
    return (rule.commands || [])
        .map(command => command.join(' '))
        .join(' ');
}

function renderRuleText(rule) {
    const lateMark = rule.late ? 'late ' : '';
    const prefix = ruleHasMultipleCells(rule) ? `${rule.direction} ` : '';
    const body = `${lateMark}${prefix}${renderRuleSide(rule.lhs)} -> ${renderRuleSide(rule.rhs)}`;
    const suffix = renderRuleCommands(rule);
    return suffix.length > 0 ? `${body} ${suffix}` : body;
}

function allRuleRecords(report, source) {
    const sourceLines = source.split(/\r?\n/);
    const records = [];
    for (const section of (report.ps_tagged && report.ps_tagged.rule_sections) || []) {
        for (const group of section.groups || []) {
            for (const rule of group.rules || []) {
                const text = (sourceLines[rule.source_line - 1] || '').trim();
                records.push({ rule, line: rule.source_line, text, canonicalText: renderRuleText(rule) });
            }
        }
    }
    return records;
}

function assertRuleRecordsIdempotent(filePath, records) {
    for (const record of records) {
        if (record.text !== record.canonicalText) {
            assert.fail([
                `${filePath}: non-idempotent rule text at line ${record.line}`,
                `  source:    ${record.text}`,
                `  canonical: ${record.canonicalText}`,
            ].join('\n'));
        }
    }
}

function findRuleRecord(filePath, records, expected) {
    const matches = records.filter(record => record.line === expected.line && record.text === expected.text);
    if (matches.length !== 1) {
        assert.fail(`${filePath}: ruleTag line ${expected.line} text ${JSON.stringify(expected.text)} matched ${matches.length} analyzed rules; expected exactly 1`);
    }
    return matches[0];
}

function recordById(records) {
    const byId = new Map();
    for (const record of records) {
        byId.set(record.rule.id, record);
    }
    return byId;
}

function compareEdgeRows(a, b) {
    if (a.from_line !== b.from_line) return a.from_line - b.from_line;
    if (a.from_text !== b.from_text) return a.from_text.localeCompare(b.from_text);
    if (a.to_line !== b.to_line) return a.to_line - b.to_line;
    return a.to_text.localeCompare(b.to_text);
}

function compareAgainRows(a, b) {
    if (a.line !== b.line) return a.line - b.line;
    return a.text.localeCompare(b.text);
}

function ruleLocator(record) {
    return {
        line: record.line,
        text: record.text,
    };
}

function compareRuleLocators(a, b) {
    if (a.line !== b.line) return a.line - b.line;
    return a.text.localeCompare(b.text);
}

function compareRuleLocatorEdges(a, b) {
    const from = compareRuleLocators(
        { line: a.from_line, text: a.from_text },
        { line: b.from_line, text: b.from_text }
    );
    if (from !== 0) return from;
    return compareRuleLocators(
        { line: a.to_line, text: a.to_text },
        { line: b.to_line, text: b.to_text }
    );
}

module.exports = {
    allRuleRecords,
    assertRuleRecordsIdempotent,
    compareAgainRows,
    compareEdgeRows,
    compareRuleLocatorEdges,
    compareRuleLocators,
    findRuleRecord,
    recordById,
    ruleLocator,
};

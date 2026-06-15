#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CLAIM_DESCRIPTIONS_PATH = path.join(__dirname, '..', 'static_analysis_claim_descriptions.json');
const FIXTURE_SCHEMA = 'ps-static-analysis-testdata-v1';

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isInlineJsonArray(value) {
    return value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item));
}

function formatJsonValue(value, depth) {
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        if (isInlineJsonArray(value)) {
            return `[${value.map(item => JSON.stringify(item)).join(', ')}]`;
        }
        return `[\n${value.map(item => `${childIndent}${formatJsonValue(item, depth + 1)}`).join(',\n')}\n${indent}]`;
    }

    if (value && typeof value === 'object') {
        const entries = Object.keys(value).map(key =>
            `${childIndent}${JSON.stringify(key)}: ${formatJsonValue(value[key], depth + 1)}`
        );
        return entries.length === 0 ? '{}' : `{\n${entries.join(',\n')}\n${indent}}`;
    }

    return JSON.stringify(value);
}

function formatFixtureJson(value) {
    return formatJsonValue(value, 0);
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${formatFixtureJson(value)}\n`, 'utf8');
}

function validateClaimDescriptionList(filePath, familyName, tags) {
    assert.ok(Array.isArray(tags), `${filePath}: ${familyName} must be an array`);
    const seen = new Set();
    for (const tag of tags) {
        assert.ok(tag && typeof tag.name === 'string' && tag.name.length > 0, `${filePath}: ${familyName} tag missing name`);
        assert.ok(!seen.has(tag.name), `${filePath}: duplicate ${familyName} tag ${tag.name}`);
        seen.add(tag.name);
        assert.ok(typeof tag.description === 'string' && tag.description.length > 0, `${filePath}: ${tag.name} missing description`);
        assert.ok(typeof tag.specification === 'string' && tag.specification.length > 0, `${filePath}: ${tag.name} missing specification`);
        if (tag.values !== undefined) {
            assert.ok(Array.isArray(tag.values) && tag.values.every(value => typeof value === 'string'), `${filePath}: ${tag.name}.values must be string[]`);
        }
        if (tag.fields !== undefined) {
            validateClaimDescriptionList(filePath, `${familyName}.${tag.name}.fields`, tag.fields);
        }
        if (tag.items !== undefined) {
            assert.ok(tag.items && typeof tag.items === 'object' && !Array.isArray(tag.items), `${filePath}: ${tag.name}.items must be an object`);
            if (tag.items.fields !== undefined) {
                validateClaimDescriptionList(filePath, `${familyName}.${tag.name}[].fields`, tag.items.fields);
            }
        }
    }
}

function loadClaimDescriptions(filePath = CLAIM_DESCRIPTIONS_PATH) {
    const claims = readJson(filePath);
    assert.strictEqual(claims.schema, 'ps-static-analysis-claim-descriptions-v1', `${filePath}: unsupported claim-description schema`);
    validateClaimDescriptionList(filePath, 'fixtureSchemas', claims.fixtureSchemas);
    return claims;
}

function fixtureSchemaByName(claimDescriptions, fixtureName) {
    const fixtureSchema = (claimDescriptions.fixtureSchemas || []).find(item => item.name === fixtureName) || null;
    assert.ok(fixtureSchema, `static analysis claim descriptions missing fixture schema ${fixtureName}`);
    return fixtureSchema;
}

function fieldByName(fields, fieldName) {
    return (fields || []).find(field => field.name === fieldName) || null;
}

function childFieldsForField(field) {
    if (!field) return [];
    if (field.fields) return field.fields;
    if (field.items && field.items.fields) return field.items.fields;
    return [];
}

function fixtureFieldsAtPath(fixtureSchema, pathParts) {
    let fields = fixtureSchema.fields || [];
    for (const part of pathParts) {
        const field = fieldByName(fields, part);
        assert.ok(field, `fixture schema ${fixtureSchema.name} missing path ${pathParts.join('.')}`);
        fields = childFieldsForField(field);
    }
    return fields;
}

function assertFixtureFieldsDocumented(filePath, fixtureSchema, value, pathPrefix = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (pathPrefix === '') {
        assert.ok(Object.prototype.hasOwnProperty.call(value, 'human_verified'), `${filePath}: missing human_verified`);
    }
    const fields = pathPrefix === ''
        ? (fixtureSchema.fields || [])
        : fixtureFieldsAtPath(fixtureSchema, pathPrefix.split('.').map(part => part.replace(/\[\]$/, '')));
    for (const key of Object.keys(value)) {
        const field = fieldByName(fields, key);
        const pathLabel = pathPrefix ? `${pathPrefix}.${key}` : key;
        assert.ok(field, `${filePath}: undocumented fixture field ${pathLabel}`);
        const childValue = value[key];
        if (pathLabel === 'human_verified') {
            assert.strictEqual(typeof childValue, 'boolean', `${filePath}: human_verified must be boolean`);
        }
        if (Array.isArray(childValue)) {
            for (const item of childValue) {
                assertFixtureFieldsDocumented(filePath, fixtureSchema, item, `${pathLabel}[]`);
            }
        } else if (childValue && typeof childValue === 'object') {
            assertFixtureFieldsDocumented(filePath, fixtureSchema, childValue, pathLabel);
        }
    }
}

function assertStringArray(filePath, label, value) {
    assert.ok(Array.isArray(value), `${filePath}: ${label} expected value must be string[]`);
    assert.ok(value.every(item => typeof item === 'string'), `${filePath}: ${label} expected value must be string[]`);
}

function sortedStringSet(value) {
    return Array.from(new Set(value)).sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true })
    );
}

function assertSameStringSet(filePath, label, expected, actual) {
    const expectedSet = sortedStringSet(expected);
    const actualSet = sortedStringSet(actual);
    if (JSON.stringify(expectedSet) !== JSON.stringify(actualSet)) {
        assert.fail(`${filePath}\n${label} expected ${JSON.stringify(expectedSet)}, got ${JSON.stringify(actualSet)}`);
    }
}

module.exports = {
    CLAIM_DESCRIPTIONS_PATH,
    FIXTURE_SCHEMA,
    assertFixtureFieldsDocumented,
    assertSameStringSet,
    assertStringArray,
    fieldByName,
    fixtureFieldsAtPath,
    fixtureSchemaByName,
    formatFixtureJson,
    loadClaimDescriptions,
    readJson,
    writeJson,
};

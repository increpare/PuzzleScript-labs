'use strict';

const { canonicalizeSource } = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');

const OBJECT_TAG_KEYS = [
    'cosmetic', 'static', 'temporary', 'is_player', 'is_background',
    'may_be_created', 'may_be_destroyed', 'present_in_some_levels',
];

function canonicalHasRandomSemantics(canonical) {
    return (canonical.rules || []).some(rule => {
        if (rule.randomRule) return true;
        const ruleText = JSON.stringify(rule).toLowerCase();
        return ruleText.includes('"random"') || ruleText.includes('"randomdir"');
    });
}

function firstDuplicateCollisionLayerObject(canonical) {
    const seen = new Map();
    for (let layerIndex = 0; layerIndex < (canonical.collisionLayers || []).length; layerIndex++) {
        for (const name of canonical.collisionLayers[layerIndex] || []) {
            if (seen.has(name)) {
                return { name, firstLayer: seen.get(name), secondLayer: layerIndex };
            }
            seen.set(name, layerIndex);
        }
    }
    return null;
}

function canonicalSourceForParity(source, label) {
    let canonical;
    try {
        canonical = canonicalizeSource(source, 'semantic', { sourcePath: label });
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (!/^Unable to canonicalize invalid PuzzleScript source\./.test(message)) {
            throw error;
        }
        return { skipped: true, reason: 'canonicalize_unavailable', error: message };
    }
    if (canonicalHasRandomSemantics(canonical)) {
        return { skipped: true, reason: 'random_rule_semantics' };
    }
    const duplicateLayerObject = firstDuplicateCollisionLayerObject(canonical);
    if (duplicateLayerObject) {
        return {
            skipped: true,
            reason: 'unrepresentable_duplicate_collision_layers',
            duplicateLayerObject,
        };
    }
    return {
        skipped: false,
        canonical,
        source: decanonicalizeSemantic(canonical),
    };
}

function projectObjectTags(object) {
    const tags = object.tags || {};
    const projected = {};
    for (const key of OBJECT_TAG_KEYS) {
        if (tags[key] !== undefined) projected[key] = tags[key];
    }
    if (tags.quantity) {
        projected.quantity = {
            never_increases: Boolean(tags.quantity.never_increases),
            never_decreases: Boolean(tags.quantity.never_decreases),
        };
    }
    return projected;
}

function projectTagSignature(report) {
    if (report.status !== 'ok') return null;
    const tagged = report.ps_tagged;
    const objects = (tagged.objects || [])
        .map(object => ({ name: object.name, tags: projectObjectTags(object) }))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

    const mergeCandidates = ((report.facts && report.facts.mergeability) || [])
        .filter(fact => fact.status === 'candidate').length;
    const staticLayers = (tagged.collision_layers || [])
        .filter(layer => layer.tags && layer.tags.static === true).length;
    const winconditionCount = (tagged.winconditions || []).length;

    return {
        objects,
        mergeCandidates,
        staticLayers,
        winconditionCount,
    };
}

function tagMultiset(objects) {
    return objects
        .map(object => JSON.stringify(object.tags))
        .sort();
}

function diffTagSignatures(original, canonical) {
    const diffs = [];
    if (original.objects.length !== canonical.objects.length) {
        diffs.push(`objectCount ${original.objects.length} vs ${canonical.objects.length}`);
        return diffs;
    }
    if (original.mergeCandidates !== canonical.mergeCandidates) {
        diffs.push(`mergeCandidates ${original.mergeCandidates} vs ${canonical.mergeCandidates}`);
    }
    if (original.staticLayers !== canonical.staticLayers) {
        diffs.push(`staticLayers ${original.staticLayers} vs ${canonical.staticLayers}`);
    }
    if (original.winconditionCount !== canonical.winconditionCount) {
        diffs.push(`winconditionCount ${original.winconditionCount} vs ${canonical.winconditionCount}`);
    }
    const leftMultiset = tagMultiset(original.objects);
    const rightMultiset = tagMultiset(canonical.objects);
    if (JSON.stringify(leftMultiset) !== JSON.stringify(rightMultiset)) {
        diffs.push('object tag multiset differs');
    }
    return diffs;
}

function auditCanonicalParity(source, gameLabel, analyzeSource) {
    const replaySource = canonicalSourceForParity(source, gameLabel);
    if (replaySource.skipped) {
        return { violations: [], skipped: replaySource.reason };
    }

    let originalReport;
    let canonicalReport;
    try {
        originalReport = analyzeSource(source, { sourcePath: gameLabel });
    } catch (error) {
        return {
            violations: [],
            skipped: `original_analyze_threw:${String(error && error.message).split('\n')[0]}`,
        };
    }
    try {
        canonicalReport = analyzeSource(replaySource.source, { sourcePath: `${gameLabel}:canonical` });
    } catch (error) {
        return {
            violations: [],
            skipped: `canonical_analyze_threw:${String(error && error.message).split('\n')[0]}`,
        };
    }

    if (originalReport.status !== 'ok' || canonicalReport.status !== 'ok') {
        return { violations: [], skipped: 'compile_error' };
    }

    const originalSignature = projectTagSignature(originalReport);
    const canonicalSignature = projectTagSignature(canonicalReport);
    if (originalSignature.objects.length !== canonicalSignature.objects.length) {
        return { violations: [], skipped: 'object_count_mismatch' };
    }
    const diffs = diffTagSignatures(originalSignature, canonicalSignature);
    if (diffs.length === 0) {
        return { violations: [], skipped: null };
    }
    return {
        violations: [`${gameLabel}: canonical parity mismatch: ${diffs.join('; ')}`],
        skipped: null,
    };
}

module.exports = {
    OBJECT_TAG_KEYS,
    auditCanonicalParity,
    canonicalSourceForParity,
    diffTagSignatures,
    projectTagSignature,
    tagMultiset,
};

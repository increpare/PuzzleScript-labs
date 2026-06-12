'use strict';

const { canonicalizeSemanticWithObjectMap } = require('../canonicalize');
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
    let objectMap = null;
    let displayNames = null;
    try {
        const mapped = canonicalizeSemanticWithObjectMap(source, { sourcePath: label });
        canonical = mapped.canonical;
        objectMap = mapped.objectMap;
        displayNames = mapped.displayNames;
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (/^Unable to (canonicalize|compile) (invalid )?PuzzleScript source\./.test(message)) {
            return { skipped: true, reason: 'canonicalize_unavailable', error: message };
        }
        throw error;
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
        objectMap,
        displayNames,
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

function objectTagsByName(report) {
    const byName = new Map();
    if (!report || report.status !== 'ok') return byName;
    for (const object of report.ps_tagged.objects || []) {
        byName.set(object.name, projectObjectTags(object));
    }
    return byName;
}

function compareMappedObjectTags(originalReport, canonicalReport, replaySource, gameLabel) {
    const violations = [];
    const stats = {
        mappedCompared: 0,
        droppedCosmetic: 0,
        droppedUnexpected: 0,
        tagMismatches: 0,
        missingCanonicalTarget: 0,
    };

    if (originalReport.status !== 'ok' || canonicalReport.status !== 'ok') {
        return { violations, stats, skipped: 'compile_error' };
    }

    const canonicalTagsByName = objectTagsByName(canonicalReport);
    const { objectMap, displayNames } = replaySource;

    for (const object of originalReport.ps_tagged.objects || []) {
        const compilerName = object.canonical_name || object.name;
        const displayName = displayNames && displayNames.get(compilerName)
            ? displayNames.get(compilerName)
            : object.name;
        const finalName = objectMap.get(compilerName);

        if (finalName === null || finalName === undefined) {
            if (object.tags && object.tags.cosmetic === true) {
                stats.droppedCosmetic++;
                continue;
            }
            stats.droppedUnexpected++;
            violations.push(
                `${gameLabel}: object ${displayName} dropped by canonicalizer but not tagged cosmetic`,
            );
            continue;
        }

        const originalTags = projectObjectTags(object);
        const canonicalTags = canonicalTagsByName.get(finalName);
        if (!canonicalTags) {
            stats.missingCanonicalTarget++;
            violations.push(
                `${gameLabel}: object ${displayName} maps to ${finalName} but canonical analysis has no such object`,
            );
            continue;
        }

        stats.mappedCompared++;
        const leftJson = JSON.stringify(originalTags);
        const rightJson = JSON.stringify(canonicalTags);
        if (leftJson !== rightJson) {
            stats.tagMismatches++;
            violations.push(
                `${gameLabel}: object ${displayName} -> ${finalName} tags differ: `
                + `original=${leftJson} canonical=${rightJson}`,
            );
        }
    }

    return { violations, stats, skipped: null };
}

function auditCanonicalParity(source, gameLabel, analyzeSource) {
    const replaySource = canonicalSourceForParity(source, gameLabel);
    if (replaySource.skipped) {
        return { violations: [], stats: null, skipped: replaySource.reason };
    }

    let originalReport;
    let canonicalReport;
    try {
        originalReport = analyzeSource(source, { sourcePath: gameLabel });
    } catch (error) {
        return {
            violations: [],
            stats: null,
            skipped: `original_analyze_threw:${String(error && error.message).split('\n')[0]}`,
        };
    }
    try {
        canonicalReport = analyzeSource(replaySource.source, { sourcePath: `${gameLabel}:canonical` });
    } catch (error) {
        return {
            violations: [],
            stats: null,
            skipped: `canonical_analyze_threw:${String(error && error.message).split('\n')[0]}`,
        };
    }

    return compareMappedObjectTags(originalReport, canonicalReport, replaySource, gameLabel);
}

module.exports = {
    OBJECT_TAG_KEYS,
    auditCanonicalParity,
    canonicalSourceForParity,
    compareMappedObjectTags,
    projectObjectTags,
};

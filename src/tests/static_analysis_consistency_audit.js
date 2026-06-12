'use strict';

function emptyInfoStats() {
    return {
        createdButNeverIncreases: 0,
        destroyedButNeverDecreases: 0,
        inertCountChangeDisagreements: 0,
    };
}

function auditAnalyzedReport(report, gameLabel) {
    const violations = [];
    const info = emptyInfoStats();
    if (report.status !== 'ok') {
        return { violations, info, skipped: 'compile_error' };
    }

    const tagged = report.ps_tagged;
    const objByName = new Map(tagged.objects.map(object => [object.name, object]));
    const winObjects = new Set();
    for (const win of tagged.winconditions || []) {
        for (const name of win.tags.objects_matched || []) winObjects.add(name);
        for (const name of win.tags.object_absences_matched || []) winObjects.add(name);
    }

    for (const object of tagged.objects) {
        const tags = object.tags || {};
        if (tags.cosmetic && winObjects.has(object.name)) {
            violations.push(`${gameLabel}: cosmetic object ${object.name} appears in win conditions`);
        }
        if (tags.temporary && tags.static && tags.present_in_some_levels) {
            violations.push(`${gameLabel}: object ${object.name} both temporary and static while present in levels`);
        }
        if (tags.quantity && tags.quantity.never_increases && tags.may_be_created === true) {
            info.createdButNeverIncreases++;
        }
        if (tags.quantity && tags.quantity.never_decreases && tags.may_be_destroyed === true) {
            info.destroyedButNeverDecreases++;
        }
        if (tags.may_be_created === false && tags.may_be_destroyed === false && tags.quantity
            && !(tags.quantity.never_increases && tags.quantity.never_decreases)) {
            info.inertCountChangeDisagreements++;
        }
    }

    for (const layer of tagged.collision_layers || []) {
        if (!layer.tags || layer.tags.static !== true) continue;
        for (const name of layer.objects || []) {
            const object = objByName.get(name);
            if (object && object.tags && object.tags.static !== true) {
                violations.push(`${gameLabel}: layer ${layer.id} static but member ${name} is not static`);
            }
        }
    }

    for (const fact of (report.facts && report.facts.mergeability) || []) {
        if (fact.status !== 'candidate') continue;
        const pair = fact.subjects.objects;
        const cosmetics = pair.map(name => {
            const object = objByName.get(name);
            return object && object.tags ? Boolean(object.tags.cosmetic) : null;
        });
        if (cosmetics[0] !== cosmetics[1]) {
            violations.push(`${gameLabel}: merge candidate ${pair.join('+')} mixes cosmetic and non-cosmetic`);
        }
    }

    return { violations, info, skipped: null };
}

function analyzeAndAudit(source, gameLabel, analyzeSource) {
    let report;
    try {
        report = analyzeSource(source, { sourcePath: gameLabel });
    } catch (error) {
        return {
            violations: [`${gameLabel}: analyzeSource threw: ${String(error && error.message).split('\n')[0]}`],
            info: emptyInfoStats(),
            skipped: 'threw',
        };
    }
    return auditAnalyzedReport(report, gameLabel);
}

function mergeInfoStats(target, info) {
    target.createdButNeverIncreases += info.createdButNeverIncreases || 0;
    target.destroyedButNeverDecreases += info.destroyedButNeverDecreases || 0;
    target.inertCountChangeDisagreements += info.inertCountChangeDisagreements || 0;
}

module.exports = {
    analyzeAndAudit,
    auditAnalyzedReport,
    emptyInfoStats,
    mergeInfoStats,
};

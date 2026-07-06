'use strict';

function certifiedWakeMaskFactsByRuleId(facts) {
    const byRuleId = new Map();
    for (const fact of facts || []) {
        const ruleId = fact && fact.subjects && fact.subjects.rules && fact.subjects.rules[0];
        if (ruleId) byRuleId.set(ruleId, fact);
    }
    return byRuleId;
}

function bitVecFromWords(words, stride) {
    const vec = new BitVec(stride);
    const source = Array.isArray(words) ? words : [];
    for (let index = 0; index < stride; index++) {
        vec.data[index] = source[index] | 0;
    }
    return vec;
}

function runtimeMovementStride(runtimeState) {
    if (runtimeState && Number.isInteger(runtimeState.STRIDE_MOV)) {
        return runtimeState.STRIDE_MOV;
    }
    return STRIDE_MOV;
}

function runtimeGroupsForSection(runtimeState, sectionName) {
    return sectionName === 'late' ? (runtimeState.lateRules || []) : (runtimeState.rules || []);
}

function attachCertifiedWakeMasksToRuntimeRules(runtimeState, staticAnalysisReport, certifiedWakeMaskFacts) {
    const out = {
        attachedRuleCount: 0,
        mappedRuleCount: 0,
        runtimeRuleCount: 0,
        staticRuleCount: 0,
        complete: false,
    };
    if (!runtimeState || !staticAnalysisReport || staticAnalysisReport.status !== 'ok') {
        return out;
    }
    const sections = staticAnalysisReport.ps_tagged && staticAnalysisReport.ps_tagged.rule_sections;
    if (!Array.isArray(sections)) {
        return out;
    }

    const factsByRuleId = certifiedWakeMaskFactsByRuleId(certifiedWakeMaskFacts);
    const strideMov = runtimeMovementStride(runtimeState);

    for (const section of sections) {
        const staticGroups = section && Array.isArray(section.groups) ? section.groups : [];
        const runtimeGroups = runtimeGroupsForSection(runtimeState, section && section.name);
        out.runtimeRuleCount += runtimeGroups.reduce((sum, group) => sum + group.length, 0);
        out.staticRuleCount += staticGroups.reduce((sum, group) => sum + ((group.rules && group.rules.length) || 0), 0);
        const groupCount = Math.min(runtimeGroups.length, staticGroups.length);
        for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
            const runtimeGroup = runtimeGroups[groupIndex] || [];
            const staticGroup = staticGroups[groupIndex] || {};
            const staticRules = staticGroup.rules || [];
            const ruleCount = Math.min(runtimeGroup.length, staticRules.length);
            for (let ruleIndex = 0; ruleIndex < ruleCount; ruleIndex++) {
                const runtimeRule = runtimeGroup[ruleIndex];
                const staticRule = staticRules[ruleIndex];
                if (!runtimeRule || !staticRule) continue;
                out.mappedRuleCount++;
                const fact = factsByRuleId.get(staticRule.id);
                const masks = fact && fact.value && fact.value.masks;
                if (!masks || !Array.isArray(masks.read_movements_wake) || !Array.isArray(masks.write_movements_wake)) {
                    continue;
                }
                runtimeRule.certifiedReadMovements = bitVecFromWords(masks.read_movements_wake, strideMov);
                runtimeRule.certifiedWriteMovements = bitVecFromWords(masks.write_movements_wake, strideMov);
                runtimeRule.hasCertifiedWakePruneMasks = true;
                out.attachedRuleCount++;
            }
        }
    }

    out.complete = out.runtimeRuleCount === out.staticRuleCount
        && out.mappedRuleCount === out.runtimeRuleCount
        && out.attachedRuleCount === out.runtimeRuleCount;
    return out;
}

module.exports = {
    attachCertifiedWakeMasksToRuntimeRules,
    bitVecFromWords,
    certifiedWakeMaskFactsByRuleId,
};

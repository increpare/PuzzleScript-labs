'use strict';

const { extractMechanic, stripComments } = require('./mechanic');

/**
 * Lightweight classification of PuzzleScript rule "kinds" for portfolio diversity
 * and smoke exercise heuristics.
 */
function ruleLines(source) {
  const { rules } = extractMechanic(source);
  return stripComments(rules)
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.includes('[') && l.includes('->'));
}

function classifyRuleKinds(source) {
  const lines = ruleLines(source);
  const kinds = new Set();
  let hasLate = false;
  let hasAction = false;
  let hasSlide = false;
  let hasPull = false;

  for (const line of lines) {
    const isLate = /^\s*late\b/.test(line) || line.includes('late [');
    if (isLate) {
      hasLate = true;
      kinds.add('late_transform');
    }
    if (/\baction\b/.test(line)) {
      hasAction = true;
      kinds.add('action');
    }
    // Pull: [< Player|Obj] or [< Octopus|Shell]
    if (/\[\s*<\s*\w+/.test(line)) {
      hasPull = true;
      kinds.add('pull');
    }
    // Slide / momentum: RHS clears the left cell and keeps movement on the object
    // e.g. [ > Shell | no Obstacle ] -> [ | > Shell ]
    if (/->\s*\[\s*\|\s*>\s*\w+/.test(line) || /->\s*\[\s*\|\s*<\s*\w+/.test(line)) {
      hasSlide = true;
      kinds.add('slide');
    }
    // Ordinary push
    if (/\[\s*>\s*\w+\s*\|\s*\w+\s*\]\s*->\s*\[\s*>\s*\w+\s*\|\s*>\s*\w+/.test(line)) {
      kinds.add('push');
    }
    // Magnet-ish: late bring object onto nest without player
    if (isLate && /\|\s*\w+\s*\]\s*->\s*\[/.test(line) && line.includes('|')) {
      kinds.add('field');
    }
  }

  if (kinds.size === 0 && lines.length > 0) {
    kinds.add('custom');
  }

  return {
    kinds: [...kinds].sort(),
    hasLate,
    hasAction,
    hasSlide,
    hasPull,
    ruleLineCount: lines.length,
  };
}

function portfolioKindCoverage(sources) {
  const union = new Set();
  const perSource = [];
  for (const entry of sources || []) {
    const source = typeof entry === 'string' ? entry : entry.source;
    const path = typeof entry === 'string' ? null : entry.path;
    const classified = classifyRuleKinds(source);
    perSource.push({ path, kinds: classified.kinds, ...classified });
    for (const kind of classified.kinds) {
      // push alone is the boring baseline; don't count it toward diversity
      if (kind !== 'push') {
        union.add(kind);
      }
    }
  }
  return { kinds: [...union].sort(), perSource, distinctNonPushKinds: union.size };
}

function evaluatePortfolioDiversity(sources, options = {}) {
  const minKinds = options.min_candidate_rule_kinds != null
    ? options.min_candidate_rule_kinds
    : 2;
  const coverage = portfolioKindCoverage(sources);
  const reasons = [];
  if ((sources || []).length >= 2 && coverage.distinctNonPushKinds < minKinds) {
    reasons.push(
      `portfolio_diversity: ${coverage.distinctNonPushKinds} non-push rule kinds `
      + `(${coverage.kinds.join(', ') || 'none'}), need >= ${minKinds}. `
      + 'Author candidates with distinct twists (slide, pull, action, late_transform, field), '
      + 'not four variants of the same push/slide loop.',
    );
  }
  return {
    ok: reasons.length === 0,
    reasons,
    ...coverage,
    minKinds,
  };
}

/**
 * Heuristic: does this smoke solution plausibly exercise novel rules?
 */
function solutionExercisesFeatures(features, solution, solutionLength) {
  const reasons = [];
  const moves = Array.isArray(solution) ? solution.map((m) => String(m).toLowerCase()) : [];
  const length = solutionLength != null ? solutionLength : moves.length;

  if (features.hasAction && !moves.includes('action')) {
    reasons.push('novel_rule: Action rules present but smoke solution never uses action');
  }
  // Keep thresholds low enough for tiny evening smoke levels, but still reject
  // "walk to nest" solutions that never need the twist.
  if (features.hasSlide && length < 4) {
    reasons.push(
      `novel_rule: slide rules present but smoke solution length ${length} < 4 `
      + '(likely no sliding needed)',
    );
  }
  if (features.hasLate && length < 4) {
    reasons.push(
      `novel_rule: late transform present but smoke solution length ${length} < 4`,
    );
  }
  if (features.hasPull && length < 3) {
    reasons.push(
      `novel_rule: pull rules present but smoke solution length ${length} < 3`,
    );
  }
  const interesting = features.kinds.filter((k) => k !== 'push');
  if (interesting.length > 0 && length < 3) {
    reasons.push(`novel_rule: interesting kinds [${interesting.join(',')}] but solution length ${length} < 3`);
  }
  return { ok: reasons.length === 0, reasons };
}

module.exports = {
  classifyRuleKinds,
  portfolioKindCoverage,
  evaluatePortfolioDiversity,
  solutionExercisesFeatures,
  ruleLines,
};

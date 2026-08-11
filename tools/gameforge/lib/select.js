'use strict';

const { evaluateCandidateMechanic } = require('./mechanic');
const { evaluatePortfolioDiversity, classifyRuleKinds } = require('./rule_features');

function tryCompileSmoke(srcPath, compileFile, smokeCheck, rejections, sourceTag) {
  const compileResult = compileFile(srcPath);
  if (!compileResult.ok) {
    rejections.push({
      path: srcPath,
      stage: 'compile',
      errors: compileResult.errors,
      source: sourceTag,
    });
    return null;
  }
  const smokeResult = smokeCheck(srcPath);
  if (!smokeResult.ok) {
    rejections.push({
      path: srcPath,
      stage: 'smoke',
      reasons: smokeResult.reasons,
      source: sourceTag,
    });
    return null;
  }
  return { compileResult, smokeResult };
}

function selectCandidate(deps) {
  const {
    jobDir,
    spec,
    candidatePaths,
    seedPaths,
    compileFile,
    smokeCheck,
    copyFile,
    readFile,
  } = deps;

  const rejections = [];
  const destPath = `${jobDir}/selected/game.txt`;
  const selectionPolicy = (spec && spec.selection_policy) || 'max_novelty';
  const allowSafeMode = spec && spec.allow_safe_mode === true
    ? true
    : !(spec && Array.isArray(spec.candidates) && spec.candidates.length > 0);
  const mechanicOpts = {
    reject_vanilla_sokoban: !(spec && spec.reject_vanilla_sokoban === false),
    reject_stock_sokoban_objects: !(spec && spec.reject_stock_sokoban_objects === false),
    require_structural_delta: !(spec && spec.require_structural_delta === false),
    min_novelty_score: spec && spec.min_novelty_score != null ? spec.min_novelty_score : 1,
    min_structural_score: spec && spec.min_structural_score != null ? spec.min_structural_score : 1,
  };

  const seedSources = (seedPaths || []).map((p) => ({
    path: p,
    source: readFile ? readFile(p) : '',
  }));

  const candidateSources = (candidatePaths || []).map((p) => ({
    path: p,
    source: readFile ? readFile(p) : '',
  }));

  if (candidateSources.length >= 2 && !(spec && spec.require_portfolio_diversity === false)) {
    const portfolio = evaluatePortfolioDiversity(candidateSources, {
      min_candidate_rule_kinds: spec && spec.min_candidate_rule_kinds != null
        ? spec.min_candidate_rule_kinds
        : 2,
    });
    if (!portfolio.ok) {
      return {
        status: 'failed_mutate',
        rejections: [{
          path: jobDir,
          stage: 'portfolio',
          reasons: portfolio.reasons,
          kinds: portfolio.kinds,
          source: 'portfolio',
        }],
        reason: 'portfolio_diversity',
        portfolio,
      };
    }
  }

  const viable = [];

  for (const srcPath of candidatePaths || []) {
    const passed = tryCompileSmoke(srcPath, compileFile, smokeCheck, rejections, 'candidate');
    if (!passed) {
      continue;
    }
    const source = readFile ? readFile(srcPath) : '';
    const mechanic = evaluateCandidateMechanic(source, seedSources, mechanicOpts);
    if (!mechanic.ok) {
      rejections.push({
        path: srcPath,
        stage: 'novelty',
        reasons: mechanic.reasons,
        noveltyScore: mechanic.noveltyScore,
        structuralScore: mechanic.structuralScore,
        newObjects: mechanic.newObjects,
        vanillaSokoban: mechanic.vanillaSokoban,
        stockSokobanObjects: mechanic.stockSokobanObjects,
        source: 'candidate',
      });
      continue;
    }
    const features = classifyRuleKinds(source);
    viable.push({
      path: srcPath,
      noveltyScore: mechanic.noveltyScore,
      structuralScore: mechanic.structuralScore,
      combinedScore: mechanic.combinedScore,
      vanillaSokoban: mechanic.vanillaSokoban,
      kinds: features.kinds,
    });
  }

  if (viable.length > 0) {
    let chosen = viable[0];
    if (selectionPolicy === 'max_novelty') {
      for (const item of viable) {
        if (item.combinedScore > chosen.combinedScore
          || (item.combinedScore === chosen.combinedScore
            && item.noveltyScore > chosen.noveltyScore)) {
          chosen = item;
        }
      }
    }
    // first_passing: keep array order (first viable)
    copyFile(chosen.path, destPath);
    return {
      status: 'selected',
      selectedPath: chosen.path,
      rejections,
      noveltyScore: chosen.noveltyScore,
      structuralScore: chosen.structuralScore,
      combinedScore: chosen.combinedScore,
      viableCount: viable.length,
    };
  }

  if (!allowSafeMode) {
    return {
      status: 'failed_mutate',
      rejections,
      reason: 'no_novel_candidate_safe_mode_disabled',
    };
  }

  for (const srcPath of seedPaths || []) {
    const passed = tryCompileSmoke(srcPath, compileFile, smokeCheck, rejections, 'seed');
    if (!passed) {
      continue;
    }
    copyFile(srcPath, destPath);
    return { status: 'safe_mode', selectedPath: srcPath, rejections };
  }

  return { status: 'failed_mutate', rejections };
}

module.exports = { selectCandidate };

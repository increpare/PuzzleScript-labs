'use strict';

const {
  filterNearDupes,
  distinctRecipeCount,
  countLevelsWithObstacles,
  levelDims,
  levelRecipeSignature,
} = require('./levels');

function countGlyphs(level, glyphs) {
  const want = new Set(glyphs);
  let count = 0;
  for (const row of levelDims(level).rows) {
    for (const ch of row) {
      if (want.has(ch)) {
        count += 1;
      }
    }
  }
  return count;
}

function levelMeetsBandContract(level, contract, obstacleGlyphs) {
  const minObstacles = contract.min_obstacles != null ? contract.min_obstacles : 0;
  if (countGlyphs(level, obstacleGlyphs) < minObstacles) {
    return false;
  }
  const minCounts = contract.min_glyph_counts || contract.min_counts || null;
  if (minCounts && typeof minCounts === 'object') {
    for (const [glyph, needed] of Object.entries(minCounts)) {
      if (countGlyphs(level, [glyph]) < Number(needed)) {
        return false;
      }
    }
  }
  return true;
}

function evaluateBandContracts(levels, contracts, options = {}) {
  const obstacleGlyphs = options.obstacle_glyphs || ['#'];
  const backgroundGlyphs = options.background_glyphs || ['.', ' '];
  const failures = [];
  if (!Array.isArray(contracts) || contracts.length === 0) {
    return { ok: true, failures };
  }

  for (const contract of contracts) {
    if (!contract || !contract.name) {
      failures.push('band_contracts: entry missing name');
      continue;
    }
    const bandLevels = levels.filter((level) => level.band === contract.name);
    const minLevels = contract.min_levels != null ? contract.min_levels : 1;
    if (bandLevels.length < minLevels) {
      failures.push(
        `band_contracts: band ${contract.name} has ${bandLevels.length} levels, need >= ${minLevels}`,
      );
      continue;
    }
    const satisfying = bandLevels.filter((level) => (
      levelMeetsBandContract(level, contract, obstacleGlyphs)
    ));
    if (satisfying.length < minLevels) {
      failures.push(
        `band_contracts: band ${contract.name} has ${satisfying.length} levels meeting `
        + `min_obstacles/min_glyph_counts, need >= ${minLevels}`,
      );
    }
    const minRecipes = contract.min_distinct_recipes;
    if (minRecipes != null) {
      const recipes = new Set(
        bandLevels.map((level) => levelRecipeSignature(level, backgroundGlyphs)),
      );
      if (recipes.size < minRecipes) {
        failures.push(
          `band_contracts: band ${contract.name} has ${recipes.size} distinct recipes, `
          + `need >= ${minRecipes}`,
        );
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

function evaluatePublishGates(input) {
  const spec = input.spec || {};
  const levels = input.levels || [];
  const theme = input.theme || {};
  const failures = [];
  const gateResults = {};

  gateResults.compile = !!input.compileOk;
  if (!gateResults.compile) {
    failures.push('compile: game does not compile');
  }

  if (!gateResults.compile && levels.length === 0) {
    let status;
    if (input.toolError) {
      status = 'error';
    } else if (input.selectedOk) {
      status = 'mechanic_only';
    } else {
      status = 'failed_mutate';
    }
    return { status, failures, gateResults };
  }

  gateResults.solved_set = levels.every(
    (level) => level.solved === true && level.solution && level.solution.length >= 1,
  );
  if (!gateResults.solved_set) {
    failures.push('solved_set: every level must be solved with a non-empty solution');
  }

  const minLevelsPerBand = spec.min_levels_per_band != null ? spec.min_levels_per_band : 1;
  const bands = spec.bands || [];
  let curriculumOk = true;
  for (const band of bands) {
    const count = levels.filter((level) => level.band === band.name).length;
    if (count < minLevelsPerBand) {
      curriculumOk = false;
      failures.push(
        `curriculum: band ${band.name} has ${count} levels, need min_levels_per_band ${minLevelsPerBand}`,
      );
    }
  }
  gateResults.curriculum = curriculumOk;

  const minSolutionLength = spec.min_solution_length != null ? spec.min_solution_length : 5;
  gateResults.non_trivial = levels.every(
    (level) => level.solution && level.solution.length >= minSolutionLength,
  );
  if (!gateResults.non_trivial) {
    failures.push(
      `min_solution_length: every solution must have length >= ${minSolutionLength}`,
    );
  }

  const threshold = spec.near_dupe_threshold != null ? spec.near_dupe_threshold : 0.92;
  const filtered = filterNearDupes(levels, threshold);
  gateResults.anti_dupe = filtered.length === levels.length;
  if (!gateResults.anti_dupe) {
    failures.push('anti_dupe: near-duplicate levels detected');
  }

  // Same pushable/nest counts with only empty padding grown across bands.
  const recipes = distinctRecipeCount(levels, spec.background_glyphs || ['.', ' ']);
  const minRecipes = spec.min_distinct_recipes != null
    ? spec.min_distinct_recipes
    : Math.max(bands.length || 1, Math.min(levels.length, 3));
  gateResults.recipe_diversity = levels.length === 0 ? false : recipes >= Math.min(minRecipes, levels.length);
  if (!gateResults.recipe_diversity) {
    failures.push(
      `recipe_diversity: ${recipes} distinct non-empty glyph recipes, need >= ${Math.min(minRecipes, levels.length)} `
      + '(levels that only change empty padding share one recipe)',
    );
  }

  const obstacleGlyphs = spec.obstacle_glyphs || ['#'];
  const withObstacles = countLevelsWithObstacles(levels, obstacleGlyphs);
  const minObstacleLevels = spec.min_levels_with_obstacles != null
    ? spec.min_levels_with_obstacles
    : Math.min(levels.length, Math.max(1, bands.length || 1));
  gateResults.obstacles = levels.length === 0 ? false : withObstacles >= Math.min(minObstacleLevels, levels.length);
  if (!gateResults.obstacles) {
    failures.push(
      `obstacles: ${withObstacles} levels contain obstacle glyphs ${JSON.stringify(obstacleGlyphs)}, `
      + `need >= ${Math.min(minObstacleLevels, levels.length)} (place walls/reefs in levels.spec.gen)`,
    );
  }

  gateResults.win_exercised = levels.every((level) => level.winExercised === true);
  if (!gateResults.win_exercised) {
    failures.push('win_exercised: every level must exercise win condition');
  }

  const contracts = Array.isArray(spec.band_contracts) ? spec.band_contracts : [];
  if (contracts.length > 0) {
    const contractResult = evaluateBandContracts(levels, contracts, {
      obstacle_glyphs: obstacleGlyphs,
      background_glyphs: spec.background_glyphs || ['.', ' '],
    });
    gateResults.band_contracts = contractResult.ok;
    if (!contractResult.ok) {
      for (const reason of contractResult.failures) {
        failures.push(reason);
      }
    }
  }

  gateResults.theme_shell =
    theme.hasTitle === true
    && theme.hasAuthorOrPreludeOrMessage === true
    && theme.legendCoversLevelGlyphs === true
    && theme.spritesForAllObjects === true;
  if (!gateResults.theme_shell) {
    failures.push('theme_shell: title, author/prelude/message, legend, and sprites required');
  }

  gateResults.design_log = !!input.designLogPresent;
  if (!gateResults.design_log) {
    failures.push('design_log: design log must be present');
  }

  const allPass = Object.values(gateResults).every((passed) => passed);
  if (allPass) {
    return { status: 'publishable', failures, gateResults };
  }

  if (levels.some((level) => level.solved)) {
    return { status: 'playable_incomplete', failures, gateResults };
  }

  if (input.selectedOk) {
    return { status: 'mechanic_only', failures, gateResults };
  }

  return { status: 'failed_mutate', failures, gateResults };
}

module.exports = {
  evaluatePublishGates,
  evaluateBandContracts,
  levelMeetsBandContract,
};

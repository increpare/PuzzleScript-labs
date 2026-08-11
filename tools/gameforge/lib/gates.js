'use strict';

const { filterNearDupes } = require('./levels');

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

  gateResults.win_exercised = levels.every((level) => level.winExercised === true);
  if (!gateResults.win_exercised) {
    failures.push('win_exercised: every level must exercise win condition');
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

module.exports = { evaluatePublishGates };

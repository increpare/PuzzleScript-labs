'use strict';

const DEFAULT_SPEC = {
  wall_clock_ms: 8 * 60 * 60 * 1000,
  max_rule_candidates: 8,
  max_rules_added: 3,
  max_rules_removed: 3,
  per_solve_timeout_ms: 2000,
  min_solution_length: 5,
  near_dupe_threshold: 0.92,
  min_distinct_recipes: null, // default: max(bandCount, min(levels, 3)) at gate time
  min_levels_with_obstacles: null, // default: max(1, bandCount) at gate time
  obstacle_glyphs: ['#'],
  background_glyphs: ['.', ' '],
  smoke_level_count: 1,
  min_levels_per_band: 1,
  generator_samples: 200,
  generator_jobs: 'auto',
  selection_policy: 'max_novelty',
  min_novelty_score: 1,
  min_structural_score: 1,
  reject_vanilla_sokoban: true,
  reject_stock_sokoban_objects: true,
  require_structural_delta: true,
  // When candidates are provided, default false (set true only for intentional seed remix).
  allow_safe_mode: null,
  bands: [
    { name: 'tiny', dimensions: '3x2' },
    { name: 'small', dimensions: '4x3' },
    { name: 'medium', dimensions: '5x4' },
  ],
};

function loadSpec(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('spec must be an object');
  }
  if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) {
    throw new Error('spec.prompt is required');
  }
  if (!Array.isArray(raw.seeds) || raw.seeds.length === 0) {
    throw new Error('spec.seeds must be a non-empty array');
  }
  if (!Array.isArray(raw.candidates)) {
    throw new Error('spec.candidates must be an array (may be empty for safe-mode)');
  }
  if (raw.candidates.length > 0) {
    if (typeof raw.mechanic_intent !== 'string' || !raw.mechanic_intent.trim()) {
      throw new Error(
        'spec.mechanic_intent is required when candidates are provided '
        + '(one sentence naming the rule/object/layer delta that fits the prompt)',
      );
    }
  }
  const spec = Object.assign({}, DEFAULT_SPEC, raw, {
    bands: Array.isArray(raw.bands) && raw.bands.length
      ? raw.bands
      : DEFAULT_SPEC.bands.map((b) => Object.assign({}, b)),
  });
  if (spec.allow_safe_mode === null || spec.allow_safe_mode === undefined) {
    spec.allow_safe_mode = spec.candidates.length === 0;
  }
  return spec;
}

function loadSpecFile(fs, filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return loadSpec(raw);
}

module.exports = { DEFAULT_SPEC, loadSpec, loadSpecFile };

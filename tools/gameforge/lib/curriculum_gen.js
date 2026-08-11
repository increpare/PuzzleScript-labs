'use strict';

function formatBandBlock(band, take, seed) {
  const lines = [
    `dimensions: ${band.dimensions}`,
    `take: ${take}`,
    `name: ${band.name}`,
  ];
  if (seed != null) {
    lines.push(`seed: ${seed}`);
  }
  lines.push(
    '',
    'choose 1 [ no wall no crate ] -> [ player ]',
    'choose 1-2 [ no wall no player no crate ] [ no wall no player no target ] -> [ crate ] [ target ]',
  );
  return lines.join('\n');
}

function writeDefaultSokobanGenSpec(spec, outPath, fs = require('fs')) {
  const bands = Array.isArray(spec.bands) ? spec.bands : [];
  const take = spec.min_levels_per_band != null ? spec.min_levels_per_band : 1;
  const baseSeed = spec.generator_seed != null
    ? spec.generator_seed
    : (spec.seed != null ? spec.seed : 42);

  const blocks = bands.map((band, index) => formatBandBlock(band, take, baseSeed + index));
  const text = blocks.length
    ? `${blocks.join('\n===\n===\n')}\n===\n`
    : '';
  fs.writeFileSync(outPath, text, 'utf8');
}

module.exports = { writeDefaultSokobanGenSpec };

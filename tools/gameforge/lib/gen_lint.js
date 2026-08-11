'use strict';

const { extractObjectNames } = require('./mechanic');

function splitGenBlocks(text) {
  return String(text || '')
    .split(/^\s*===\s*$/m)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

function parseBlockHeader(block) {
  const header = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^\s*([a-z_]+)\s*:\s*(.+)\s*$/i.exec(line);
    if (m) {
      header[m[1].toLowerCase()] = m[2].trim();
    }
  }
  return header;
}

function blockRuleLines(block) {
  return block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(prob|choose)\b/i.test(l));
}

function hasObstaclePlacement(ruleLine, obstacleNames) {
  const lower = ruleLine.toLowerCase();
  // RHS after ->
  const arrow = lower.indexOf('->');
  if (arrow < 0) {
    return false;
  }
  const rhs = lower.slice(arrow + 2);
  for (const name of obstacleNames) {
    if (rhs.includes(`[ ${name} ]`) || rhs.includes(`[${name}]`) || rhs.includes(` ${name} `)
      || new RegExp(`\\[\\s*${name}\\s*\\]`).test(rhs)) {
      return true;
    }
  }
  return false;
}

function extractChooseCountSignature(ruleLine) {
  const m = /^choose\s+(\d+(?:-\d+)?)/i.exec(ruleLine.trim());
  return m ? m[1] : null;
}

/**
 * Lint a levels.spec.gen before overnight mining.
 */
function lintGenSpec(genText, options = {}) {
  const reasons = [];
  const blocks = splitGenBlocks(genText);
  if (blocks.length === 0) {
    return { ok: false, reasons: ['gen_lint: levels.spec.gen has no blocks'] };
  }

  const obstacleNames = (options.obstacle_object_names || ['wall', 'reef']).map((n) => n.toLowerCase());
  const requiredObjects = (options.required_object_names || []).map((n) => n.toLowerCase());
  const requireObstacles = options.require_obstacle_placement !== false;
  const requireVariedCounts = options.require_varied_choose_counts !== false;

  let blocksWithObstacles = 0;
  const chooseSignatures = [];
  const allRhs = [];

  for (const block of blocks) {
    const header = parseBlockHeader(block);
    const rules = blockRuleLines(block);
    if (rules.length === 0) {
      reasons.push(`gen_lint: block ${header.name || header.dimensions || '?'} has no prob/choose rules`);
      continue;
    }
    let obstacle = false;
    for (const rule of rules) {
      if (hasObstaclePlacement(rule, obstacleNames)) {
        obstacle = true;
      }
      const chooseSig = extractChooseCountSignature(rule);
      if (chooseSig) {
        chooseSignatures.push(`${header.name || ''}:${chooseSig}`);
      }
      allRhs.push(rule.toLowerCase());
    }
    if (obstacle) {
      blocksWithObstacles += 1;
    } else if (requireObstacles) {
      reasons.push(
        `gen_lint: block ${header.name || header.dimensions || '?'} never places obstacles `
        + `(expected RHS object in ${JSON.stringify(obstacleNames)})`,
      );
    }
  }

  if (requireObstacles && blocksWithObstacles === 0) {
    reasons.push('gen_lint: no block places walls/reefs — empty-room curricula are rejected');
  }

  if (requireVariedCounts && blocks.length >= 2) {
    // Identical choose ranges across every band → padding-clone attractor.
    const chooseOnly = chooseSignatures.map((s) => s.replace(/^[^:]+:/, ''));
    const uniqueChoose = new Set(chooseOnly);
    if (uniqueChoose.size <= 1 && chooseOnly.length >= 2) {
      reasons.push(
        'gen_lint: all bands use the same choose N/N-M counts — vary nest/shell counts per band',
      );
    }
  }

  function objectPlacedOnRhs(obj) {
    return allRhs.some((rule) => {
      const arrow = rule.indexOf('->');
      if (arrow < 0) {
        return false;
      }
      const rhs = rule.slice(arrow + 2);
      return new RegExp(`\\[\\s*${obj}\\s*\\]`).test(rhs)
        || new RegExp(`\\[\\s*${obj}\\s+`).test(rhs);
    });
  }

  if (requiredObjects.length > 0) {
    const anyObstaclePlaced = obstacleNames.some((name) => objectPlacedOnRhs(name));
    for (const obj of requiredObjects) {
      // background is never a choose/prob target
      if (obj === 'background') {
        continue;
      }
      // Wall vs Reef: either obstacle family is enough if one is placed
      if (obstacleNames.includes(obj) && anyObstaclePlaced) {
        continue;
      }
      // Require placement on RHS (`-> [ octopus ]`), not merely `no octopus` guards.
      if (!objectPlacedOnRhs(obj)) {
        reasons.push(
          `gen_lint: object "${obj}" from selected game is never placed on a .gen RHS — `
          + 'align levels.spec.gen with candidate object names',
        );
      }
    }
  }

  return { ok: reasons.length === 0, reasons, blockCount: blocks.length, blocksWithObstacles };
}

function requiredObjectsFromGame(gameSource) {
  return extractObjectNames(gameSource).filter((n) => {
    const lower = n.toLowerCase();
    return lower !== 'background';
  });
}

module.exports = {
  splitGenBlocks,
  lintGenSpec,
  requiredObjectsFromGame,
  hasObstaclePlacement,
};

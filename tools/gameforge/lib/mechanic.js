'use strict';

/**
 * Mechanic fingerprinting for gameforge candidate selection.
 * Used to reject paint-jobs (theme-only Sokoban reskins) and to prefer novel rules.
 */

function sectionBody(source, headerName) {
  const lines = String(source || '').split(/\r?\n/);
  const header = headerName.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().toLowerCase() === header) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) {
    return '';
  }
  // Skip underline row of ===
  while (start < lines.length && /^=+$/.test(lines[start].trim())) {
    start += 1;
  }
  const body = [];
  for (let i = start; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^=+$/.test(trimmed)) {
      // next section header follows underline in PuzzleScript; stop before next ALLCAPS header
      const next = lines[i + 1] ? lines[i + 1].trim() : '';
      if (/^[A-Z][A-Z0-9_]*$/.test(next)) {
        break;
      }
    }
    if (/^[A-Z][A-Z0-9_]*$/.test(trimmed) && trimmed.toLowerCase() !== header) {
      break;
    }
    body.push(lines[i]);
  }
  return body.join('\n');
}

function stripComments(text) {
  return String(text || '').replace(/\([^)]*\)/g, ' ');
}

function normalizeMechanicText(text) {
  return stripComments(text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMechanic(source) {
  const rules = sectionBody(source, 'rules');
  const win = sectionBody(source, 'winconditions');
  const raw = `${rules}\n${win}`;
  return {
    rules,
    win,
    normalized: normalizeMechanicText(raw),
  };
}

function looksLikeSpriteRow(line) {
  const t = String(line || '').trim();
  return t.length > 0 && /^[0-9.]+$/.test(t);
}

function looksLikeColorRow(line) {
  const t = String(line || '').trim();
  if (!t || looksLikeSpriteRow(t)) {
    return false;
  }
  if (/#/.test(t)) {
    return true;
  }
  // named palette colors, possibly multiple: "lightgreen green"
  return /^[a-zA-Z]+(?:[ \t]+[a-zA-Z]+)*$/.test(t);
}

/** Object names declared in the OBJECTS section (name line followed by a color line). */
function extractObjectNames(source) {
  const body = sectionBody(source, 'objects');
  const names = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('(')) {
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      continue;
    }
    const next = lines[i + 1] ? lines[i + 1].trim() : '';
    if (looksLikeColorRow(next)) {
      names.push(trimmed);
    }
  }
  return names;
}

function extractCollisionLayerLines(source) {
  const body = sectionBody(source, 'collisionlayers');
  return stripComments(body)
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0 && !/^=+$/.test(l));
}

const STOCK_SOKOBAN_OBJECTS = new Set([
  'background',
  'player',
  'wall',
  'crate',
  'target',
]);

function isStockSokobanObjectSet(source) {
  const names = extractObjectNames(source).map((n) => n.toLowerCase());
  if (names.length === 0) {
    return false;
  }
  return names.every((n) => STOCK_SOKOBAN_OBJECTS.has(n));
}

/**
 * Structural delta vs nearest seed: new object names and/or collision-layer line changes.
 */
function structuralDeltaAgainstSeeds(candidateSource, seedEntries) {
  const candObjects = new Set(extractObjectNames(candidateSource).map((n) => n.toLowerCase()));
  const candLayers = new Set(extractCollisionLayerLines(candidateSource));
  let best = {
    score: Infinity,
    nearestSeedPath: null,
    newObjects: [],
    layerChanges: 0,
  };

  const entries = seedEntries && seedEntries.length
    ? seedEntries
    : [{ path: null, source: '' }];

  for (const entry of entries) {
    const seedSource = typeof entry === 'string' ? entry : entry.source;
    const seedPath = typeof entry === 'string' ? null : entry.path;
    const seedObjects = new Set(extractObjectNames(seedSource).map((n) => n.toLowerCase()));
    const seedLayers = new Set(extractCollisionLayerLines(seedSource));
    const newObjects = [...candObjects].filter((n) => !seedObjects.has(n));
    let layerChanges = 0;
    for (const line of candLayers) {
      if (!seedLayers.has(line)) {
        layerChanges += 1;
      }
    }
    for (const line of seedLayers) {
      if (!candLayers.has(line)) {
        layerChanges += 1;
      }
    }
    const score = newObjects.length + (layerChanges > 0 ? 1 : 0);
    if (score < best.score) {
      best = {
        score,
        nearestSeedPath: seedPath,
        newObjects,
        layerChanges,
      };
    }
  }
  if (best.score === Infinity) {
    best.score = candObjects.size;
    best.newObjects = [...candObjects];
  }
  return best;
}

function mechanicTokens(normalized) {
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/[^a-z0-9_><|\-\[\]]+/)
    .filter((t) => t.length > 0);
}

/**
 * True when rules+win look like classic single-push Sokoban:
 * one push rule of form [ > A | B ] -> [ > A | > B ] and win "all X on Y".
 */
function isVanillaSokoban(source) {
  const { rules, win, normalized } = extractMechanic(source);
  const winNorm = normalizeMechanicText(win);
  if (!/^all\s+\w+\s+on\s+\w+$/.test(winNorm)) {
    return false;
  }
  const ruleLines = stripComments(rules)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^=+$/.test(l));
  if (ruleLines.length !== 1) {
    return false;
  }
  // [ > player | crate ] -> [ > player | > crate ] (names may vary)
  return /^\[\s*>\s*\w+\s*\|\s*\w+\s*\]\s*->\s*\[\s*>\s*\w+\s*\|\s*>\s*\w+\s*\]$/.test(
    ruleLines[0].toLowerCase().replace(/\s+/g, ' ').trim(),
  ) || (
    normalized.includes('[ >')
    && normalized.includes('| >')
    && !normalized.includes('[ <')
    && ruleLines.length === 1
  );
}

/**
 * Novelty vs nearest seed: count of mechanic tokens in candidate absent from that seed.
 * Returns { score, nearestSeedPath, candidateTokens, missingFromNearest }.
 */
function noveltyAgainstSeeds(candidateSource, seedEntries) {
  const cand = extractMechanic(candidateSource);
  const candTokens = new Set(mechanicTokens(cand.normalized));
  if (candTokens.size === 0) {
    return { score: 0, nearestSeedPath: null, missingFromNearest: 0 };
  }
  let best = { score: Infinity, nearestSeedPath: null, missingFromNearest: 0 };
  for (const entry of seedEntries || []) {
    const seedSource = typeof entry === 'string' ? entry : entry.source;
    const seedPath = typeof entry === 'string' ? null : entry.path;
    const seedTok = new Set(mechanicTokens(extractMechanic(seedSource).normalized));
    let missing = 0;
    for (const t of candTokens) {
      if (!seedTok.has(t)) {
        missing += 1;
      }
    }
    // Also reward extra rule structure: if candidate has more distinct tokens, count surplus
    const score = missing;
    if (score < best.score) {
      best = { score, nearestSeedPath: seedPath, missingFromNearest: missing };
    }
  }
  if (best.score === Infinity) {
    return { score: candTokens.size, nearestSeedPath: null, missingFromNearest: candTokens.size };
  }
  return best;
}

function evaluateCandidateMechanic(candidateSource, seedEntries, options = {}) {
  const rejectVanilla = options.reject_vanilla_sokoban !== false;
  const rejectStockObjects = options.reject_stock_sokoban_objects !== false;
  const minNovelty = options.min_novelty_score != null ? options.min_novelty_score : 1;
  const requireStructural = options.require_structural_delta !== false;
  const minStructural = options.min_structural_score != null ? options.min_structural_score : 1;

  const novelty = noveltyAgainstSeeds(candidateSource, seedEntries);
  const structural = structuralDeltaAgainstSeeds(candidateSource, seedEntries);
  const vanilla = isVanillaSokoban(candidateSource);
  const stockObjects = isStockSokobanObjectSet(candidateSource);
  const reasons = [];

  if (rejectVanilla && vanilla) {
    reasons.push('vanilla_sokoban: single push rule + all X on Y (paint-job rejected)');
  }
  if (rejectStockObjects && stockObjects) {
    reasons.push(
      'stock_sokoban_objects: OBJECTS is only Background/Player/Wall/Crate/Target — '
      + 'invent prompt-native object names (and wire them through legend/layers/rules/win)',
    );
  }
  if (novelty.score < minNovelty) {
    reasons.push(
      `novelty: score ${novelty.score} < min_novelty_score ${minNovelty}`
      + (novelty.nearestSeedPath ? ` (nearest ${novelty.nearestSeedPath})` : ''),
    );
  }
  if (requireStructural && structural.score < minStructural) {
    reasons.push(
      `structural_delta: score ${structural.score} < min_structural_score ${minStructural} `
      + '(need new OBJECTS and/or changed COLLISIONLAYERS vs nearest seed)'
      + (structural.nearestSeedPath ? ` (nearest ${structural.nearestSeedPath})` : ''),
    );
  }

  const rulesText = extractMechanic(candidateSource).rules || '';
  const ruleLineCount = stripComments(rulesText)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('[')).length;
  const hasAction = /\baction\b/i.test(rulesText);
  const hasLate = /^\s*late\b/im.test(rulesText);

  // Prefer candidates that change rules+structure and add interactive depth.
  const combinedScore = novelty.score + structural.score * 2
    + (stockObjects ? 0 : 1) + (vanilla ? 0 : 1)
    + Math.min(3, ruleLineCount)
    + (hasAction ? 2 : 0)
    + (hasLate ? 1 : 0);

  return {
    ok: reasons.length === 0,
    reasons,
    noveltyScore: novelty.score,
    structuralScore: structural.score,
    combinedScore,
    ruleLineCount,
    hasAction,
    hasLate,
    newObjects: structural.newObjects,
    layerChanges: structural.layerChanges,
    vanillaSokoban: vanilla,
    stockSokobanObjects: stockObjects,
    nearestSeedPath: novelty.nearestSeedPath || structural.nearestSeedPath,
  };
}

module.exports = {
  sectionBody,
  extractMechanic,
  extractObjectNames,
  extractCollisionLayerLines,
  stripComments,
  normalizeMechanicText,
  isVanillaSokoban,
  isStockSokobanObjectSet,
  noveltyAgainstSeeds,
  structuralDeltaAgainstSeeds,
  evaluateCandidateMechanic,
  STOCK_SOKOBAN_OBJECTS,
};

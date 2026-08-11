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
  const minNovelty = options.min_novelty_score != null ? options.min_novelty_score : 1;
  const novelty = noveltyAgainstSeeds(candidateSource, seedEntries);
  const vanilla = isVanillaSokoban(candidateSource);
  const reasons = [];
  if (rejectVanilla && vanilla) {
    reasons.push('vanilla_sokoban: single push rule + all X on Y (paint-job rejected)');
  }
  if (novelty.score < minNovelty) {
    reasons.push(
      `novelty: score ${novelty.score} < min_novelty_score ${minNovelty}`
      + (novelty.nearestSeedPath ? ` (nearest ${novelty.nearestSeedPath})` : ''),
    );
  }
  return {
    ok: reasons.length === 0,
    reasons,
    noveltyScore: novelty.score,
    vanillaSokoban: vanilla,
    nearestSeedPath: novelty.nearestSeedPath,
  };
}

module.exports = {
  sectionBody,
  extractMechanic,
  normalizeMechanicText,
  isVanillaSokoban,
  noveltyAgainstSeeds,
  evaluateCandidateMechanic,
};

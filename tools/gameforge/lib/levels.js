'use strict';

const COMPACT_TO_TOKEN = {
  U: 'up',
  D: 'down',
  L: 'left',
  R: 'right',
  A: 'action',
};

function parseSolutionComment(line) {
  const match = line.match(/^\(solution:\s*([^)]+)\)$/);
  if (!match) {
    return null;
  }
  const compact = match[1].replace(/\s+/g, '');
  const solution = [];
  for (const ch of compact) {
    const token = COMPACT_TO_TOKEN[ch];
    if (!token) {
      throw new Error(`unknown compact solution character: ${ch}`);
    }
    solution.push(token);
  }
  return solution;
}

function parseParentheticalComment(line) {
  const match = line.match(/^\(([^:]+):\s*([^)]+)\)$/);
  if (!match) {
    return null;
  }
  return { key: match[1].trim().toLowerCase(), value: match[2].trim() };
}

function parsePlayableLevels(source) {
  const lines = source.split(/\r?\n/);
  const levelsIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'levels');
  if (levelsIndex < 0) {
    throw new Error('game should contain LEVELS section');
  }

  const levels = [];
  let index = levelsIndex + 1;
  while (index < lines.length && /^=+$/.test(lines[index].trim())) {
    index += 1;
  }

  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === '') {
      index += 1;
    }
    if (index >= lines.length) {
      break;
    }
    if (/^[A-Z_]+$/i.test(lines[index].trim()) && lines[index].trim().toLowerCase() !== 'message') {
      break;
    }

    if (lines[index].trim().toLowerCase().startsWith('message ')) {
      index += 1;
      continue;
    }

    let solution = null;
    let bandHint;
    while (index < lines.length) {
      const trimmed = lines[index].trim();
      if (trimmed === '') {
        index += 1;
        break;
      }
      if (trimmed.toLowerCase().startsWith('message ')) {
        break;
      }
      if (/^[A-Z_]+$/i.test(trimmed) && trimmed.toLowerCase() !== 'message') {
        break;
      }

      if (trimmed.startsWith('(')) {
        const comment = parseParentheticalComment(trimmed);
        if (comment && comment.key === 'solution') {
          solution = parseSolutionComment(trimmed);
        } else if (comment && comment.key === 'difficulty') {
          const numeric = Number(comment.value);
          bandHint = Number.isFinite(numeric) ? numeric : comment.value;
        }
        index += 1;
        continue;
      }

      break;
    }

    const rows = [];
    while (index < lines.length) {
      const row = lines[index];
      const trimmed = row.trim();
      if (trimmed === '') {
        index += 1;
        break;
      }
      if (trimmed.startsWith('(') || trimmed.toLowerCase().startsWith('message ')) {
        break;
      }
      if (/^[A-Z_]+$/i.test(trimmed) && trimmed.toLowerCase() !== 'message') {
        break;
      }
      rows.push(row);
      index += 1;
    }

    if (rows.length > 0) {
      const level = { rows, solution };
      if (bandHint !== undefined) {
        level.bandHint = bandHint;
      }
      levels.push(level);
    }
  }

  return levels;
}

function levelDims(level) {
  const rows = level.rows || [];
  const height = rows.length;
  let width = 0;
  for (const row of rows) {
    if (row.length > width) {
      width = row.length;
    }
  }
  return { width, height, rows };
}

function cellAgreement(a, b) {
  const da = levelDims(a);
  const db = levelDims(b);
  if (da.width !== db.width || da.height !== db.height) {
    return 0;
  }
  const total = da.width * da.height;
  if (total === 0) {
    return 1;
  }
  let matches = 0;
  for (let y = 0; y < da.height; y += 1) {
    const rowA = da.rows[y];
    const rowB = db.rows[y];
    for (let x = 0; x < da.width; x += 1) {
      if (rowA[x] === rowB[x]) {
        matches += 1;
      }
    }
  }
  return matches / total;
}

function filterNearDupes(levels, threshold) {
  const kept = [];
  for (const level of levels) {
    let isDupe = false;
    for (const existing of kept) {
      if (cellAgreement(level, existing) >= threshold) {
        isDupe = true;
        break;
      }
    }
    if (!isDupe) {
      kept.push(level);
    }
  }
  return kept;
}

module.exports = {
  parsePlayableLevels,
  levelDims,
  cellAgreement,
  filterNearDupes,
};

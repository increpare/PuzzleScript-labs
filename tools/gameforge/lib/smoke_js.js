'use strict';

const fs = require('fs');
const { spawnSync: defaultSpawnSync } = require('child_process');
const { classifyRuleKinds, solutionExercisesFeatures } = require('./rule_features');

function parseSolverJson(stdout) {
  const text = String(stdout || '').trim();
  for (let start = text.indexOf('{'); start >= 0;) {
    let nextStart = text.indexOf('{', start + 1);
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const ch = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(start, index + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              if (Object.prototype.hasOwnProperty.call(parsed, 'results')) {
                return parsed;
              }
              nextStart = text.indexOf('{', index + 1);
            }
          } catch (error) {
            // Keep scanning; noisy output can contain non-JSON brace groups.
          }
          break;
        }
      }
    }
    start = nextStart;
  }
  return null;
}

function solveLevel(gamePath, levelIndex, options) {
  const {
    per_solve_timeout_ms: timeoutMs,
    solverBin,
    spawnSync = defaultSpawnSync,
  } = options;

  const args = [
    gamePath,
    '--timeout-ms', String(timeoutMs),
    '--jobs', '1',
    '--strategy', 'bfs',
    '--json',
    '--level', String(levelIndex),
    '--quiet',
  ];

  const result = spawnSync(solverBin, args, { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error) {
    return { ok: false, reason: `solver spawn failed: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `solver exit ${result.status}: ${output.trim() || 'no output'}`,
    };
  }

  const payload = parseSolverJson(result.stdout);
  if (!payload || !Array.isArray(payload.results) || payload.results.length === 0) {
    return {
      ok: false,
      reason: `solver JSON missing results for level ${levelIndex}`,
    };
  }

  const entry = payload.results[0];
  if (!entry || entry.status !== 'solved') {
    const status = entry && entry.status != null ? entry.status : 'unknown';
    return {
      ok: false,
      reason: `level ${levelIndex} not solved (status=${status})`,
    };
  }

  const solution = Array.isArray(entry.solution) ? entry.solution : [];
  const solutionLength = entry.solution_length != null
    ? entry.solution_length
    : solution.length;
  if (solutionLength < 1) {
    return {
      ok: false,
      reason: `level ${levelIndex} solved with empty solution (already won?)`,
    };
  }

  return { ok: true, solutionLength, solution };
}

function smokeCheckJs(gamePath, options) {
  const smokeLevelCount = options.smoke_level_count != null ? options.smoke_level_count : 1;
  const requireNovelExercise = options.require_novel_rule_exercise !== false;
  const reasons = [];
  let winExercised = true;

  let features = null;
  if (requireNovelExercise) {
    try {
      const source = options.gameSource != null
        ? options.gameSource
        : fs.readFileSync(gamePath, 'utf8');
      features = classifyRuleKinds(source);
    } catch (error) {
      reasons.push(`novel_rule: could not read game for feature check (${error.message})`);
      features = null;
    }
  }

  for (let levelIndex = 0; levelIndex < smokeLevelCount; levelIndex += 1) {
    const solveResult = solveLevel(gamePath, levelIndex, options);
    if (!solveResult.ok) {
      reasons.push(solveResult.reason);
      winExercised = false;
      continue;
    }
    if (features && requireNovelExercise) {
      const exercise = solutionExercisesFeatures(
        features,
        solveResult.solution,
        solveResult.solutionLength,
      );
      if (!exercise.ok) {
        for (const reason of exercise.reasons) {
          reasons.push(`level ${levelIndex}: ${reason}`);
        }
      }
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    winExercised,
  };
}

module.exports = { smokeCheckJs, solveLevel };

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { loadSpecFile } = require('./lib/spec');
const { selectCandidate } = require('./lib/select');
const { compileFileNative } = require('./lib/compile');
const { smokeCheckJs } = require('./lib/smoke_js');
const { runLevelSetGenerator } = require('./lib/generate');
const { runSimplify } = require('./lib/simplify');
const { writeDefaultSokobanGenSpec } = require('./lib/curriculum_gen');
const { parsePlayableLevels, levelDims } = require('./lib/levels');
const { evaluatePublishGates } = require('./lib/gates');
const {
  writeArtifacts,
  createDesignLog,
  appendDesignLog,
  toMarkdown,
} = require('./lib/report');

function parseArgs(argv) {
  const args = { jobDir: null, cpp: null, generator: null, simplify: null, solver: null };
  const positional = [];
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cpp') {
      args.cpp = argv[++i];
    } else if (arg === '--generator') {
      args.generator = argv[++i];
    } else if (arg === '--simplify') {
      args.simplify = argv[++i];
    } else if (arg === '--solver') {
      args.solver = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      positional.push(arg);
    }
  }
  args.jobDir = positional[0];
  return args;
}

function usage() {
  return 'Usage: node tools/gameforge/run.js <jobDir> [--cpp BIN] [--generator BIN] [--simplify BIN] [--solver BIN]';
}

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'tools', 'gameforge'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(startDir);
    }
    dir = parent;
  }
}

function resolveBin(flag, defaultRel, repoRoot) {
  return flag ? path.resolve(flag) : path.join(repoRoot, defaultRel);
}

function parseBlockComments(source) {
  const lines = source.split(/\r?\n/);
  const levelsIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'levels');
  if (levelsIndex < 0) {
    return [];
  }

  const blocks = [];
  let index = levelsIndex + 1;
  while (index < lines.length && /^=+$/.test(lines[index].trim())) {
    index += 1;
  }

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('(block:')) {
      const nameMatch = trimmed.match(/^\(block:\s*([^\s(]+)/i);
      const dimMatch = trimmed.match(/(\d+)x(\d+)/);
      blocks.push({
        name: nameMatch ? nameMatch[1] : null,
        dimensions: dimMatch ? `${dimMatch[1]}x${dimMatch[2]}` : null,
      });
      index += 1;
      continue;
    }
    if (trimmed === '') {
      index += 1;
      continue;
    }
    if (/^[A-Z_]+$/i.test(trimmed) && trimmed.toLowerCase() !== 'message') {
      break;
    }
    if (trimmed.startsWith('(')) {
      index += 1;
      continue;
    }
    while (
      index < lines.length
      && lines[index].trim() !== ''
      && !lines[index].trim().startsWith('(')
      && !(/^[A-Z_]+$/i.test(lines[index].trim()) && lines[index].trim().toLowerCase() !== 'message')
    ) {
      index += 1;
    }
  }

  return blocks;
}

function assignBand(level, dims, blockMeta, spec) {
  const bands = spec.bands || [];
  if (blockMeta && blockMeta.name) {
    const byName = bands.find((band) => band.name === blockMeta.name);
    if (byName) {
      return byName.name;
    }
  }
  if (blockMeta && blockMeta.dimensions) {
    const byDim = bands.find((band) => band.dimensions === blockMeta.dimensions);
    if (byDim) {
      return byDim.name;
    }
  }
  const dimStr = `${dims.width}x${dims.height}`;
  const byDims = bands.find((band) => band.dimensions === dimStr);
  if (byDims) {
    return byDims.name;
  }
  if (typeof level.bandHint === 'string') {
    const byHint = bands.find((band) => band.name === level.bandHint);
    if (byHint) {
      return byHint.name;
    }
  }
  return undefined;
}

function enrichLevels(source, spec) {
  const parsed = parsePlayableLevels(source);
  const blockComments = parseBlockComments(source);
  return parsed.map((level, index) => {
    const dims = levelDims(level);
    const blockMeta = blockComments[index] || null;
    const solution = level.solution || null;
    const solved = !!(solution && solution.length);
    const winExercised = solved && solution.length >= 1;
    return {
      band: assignBand(level, dims, blockMeta, spec),
      width: dims.width,
      height: dims.height,
      rows: dims.rows,
      solution,
      solved,
      winExercised,
    };
  });
}

function scanTheme(source, levelsParsedOk) {
  const hasTitle = /^title\s+/mi.test(source);
  const hasAuthorOrPreludeOrMessage = /^(author|prelude|message)\s+/mi.test(source);
  const shellOk = hasTitle && hasAuthorOrPreludeOrMessage && levelsParsedOk;
  return {
    hasTitle,
    hasAuthorOrPreludeOrMessage,
    legendCoversLevelGlyphs: shellOk,
    spritesForAllObjects: shellOk,
  };
}

function relJobPath(jobDir, absolutePath) {
  return path.relative(jobDir, absolutePath).split(path.sep).join('/');
}

function exitCodeForStatus(status) {
  if (status === 'publishable') {
    return 0;
  }
  if (status === 'playable_incomplete' || status === 'mechanic_only') {
    return 1;
  }
  return 2;
}

function main() {
  const cli = parseArgs(process.argv);
  if (cli.help || !cli.jobDir) {
    console.error(usage());
    process.exit(cli.help ? 0 : 2);
  }

  const jobDir = path.resolve(cli.jobDir);
  const repoRoot = findRepoRoot(jobDir);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const log = createDesignLog();
  appendDesignLog(log, '# Gameforge run');
  appendDesignLog(log, `job: ${jobDir}`);

  const cppBin = resolveBin(cli.cpp, 'build/native/puzzlescript_cpp', repoRoot);
  const generatorBin = resolveBin(cli.generator, 'build/native/puzzlescript_generator', repoRoot);
  const simplifyBin = resolveBin(cli.simplify, 'build/native/puzzlescript_simplify', repoRoot);
  const solverBin = resolveBin(cli.solver, 'build/native/puzzlescript_solver', repoRoot);

  let spec;
  try {
    spec = loadSpecFile(fs, path.join(jobDir, 'spec.json'));
    appendDesignLog(log, `prompt: ${spec.prompt}`);
  } catch (error) {
    const report = {
      status: 'error',
      failures: [`spec: ${error.message}`],
      gateResults: {},
      selected: null,
      candidateRejections: [],
      levelSummaries: [],
      timestamps: { startedAt, finishedAt: new Date().toISOString() },
    };
    writeArtifacts(jobDir, {
      gameSource: '',
      report,
      designLogMarkdown: toMarkdown(appendDesignLog(log, `error: ${error.message}`)),
    });
    process.exit(2);
  }

  const remainingMs = () => Math.max(0, spec.wall_clock_ms - (Date.now() - startedAtMs));

  const candidatePaths = spec.candidates.map((rel) => path.join(jobDir, rel));
  const seedPaths = spec.seeds.map((rel) => path.join(jobDir, rel));

  fs.mkdirSync(path.join(jobDir, 'selected'), { recursive: true });

  appendDesignLog(log, '## Select candidate');
  const selectResult = selectCandidate({
    jobDir,
    candidatePaths,
    seedPaths,
    compileFile: (p) => compileFileNative(cppBin, p, spawnSync),
    smokeCheck: (p) => smokeCheckJs(p, {
      smoke_level_count: spec.smoke_level_count,
      per_solve_timeout_ms: spec.per_solve_timeout_ms,
      solverBin,
      spawnSync,
    }),
    copyFile: (src, dest) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    },
  });

  appendDesignLog(log, `select status: ${selectResult.status}`);
  if (selectResult.selectedPath) {
    appendDesignLog(log, `selected: ${relJobPath(jobDir, selectResult.selectedPath)}`);
  }
  if (selectResult.rejections.length) {
    appendDesignLog(log, `rejections: ${selectResult.rejections.length}`);
  }

  if (selectResult.status === 'failed_mutate') {
    const report = {
      status: 'failed_mutate',
      failures: ['select: no candidate or seed passed compile/smoke'],
      gateResults: {},
      selected: null,
      candidateRejections: selectResult.rejections.map((entry) => ({
        path: relJobPath(jobDir, entry.path),
        stage: entry.stage,
        errors: entry.errors,
        reasons: entry.reasons,
        source: entry.source,
      })),
      levelSummaries: [],
      timestamps: { startedAt, finishedAt: new Date().toISOString() },
    };
    writeArtifacts(jobDir, {
      gameSource: '',
      report,
      designLogMarkdown: toMarkdown(log),
    });
    process.exit(2);
  }

  const selectedGamePath = path.join(jobDir, 'selected/game.txt');
  const runDir = path.join(jobDir, 'run');
  fs.mkdirSync(runDir, { recursive: true });

  const genSpecPath = path.join(jobDir, 'levels.spec.gen');
  if (!fs.existsSync(genSpecPath)) {
    appendDesignLog(log, '## Write default levels.spec.gen');
    writeDefaultSokobanGenSpec(spec, genSpecPath, fs);
  }

  appendDesignLog(log, '## Generate levels');
  const generatedPath = path.join(runDir, 'generated_game.txt');
  const genTimeMs = Math.min(remainingMs(), spec.wall_clock_ms);
  const inactivityStartMs = genTimeMs <= 60000
    ? 500
    : Math.min(Math.max(500, Math.floor(genTimeMs / 4)), 10000);
  const exhaustPasses = genTimeMs <= 60000 ? 1 : undefined;
  const genSeed = spec.generator_seed != null
    ? spec.generator_seed
    : (spec.seed != null ? spec.seed : 1);
  const genResult = runLevelSetGenerator({
    generatorBin,
    gamePath: selectedGamePath,
    specPath: genSpecPath,
    outPath: generatedPath,
    timeMs: genTimeMs,
    samples: spec.generator_samples,
    jobs: spec.generator_jobs,
    seed: genSeed,
    inactivityStartMs,
    solverTimeoutMs: spec.per_solve_timeout_ms,
    exhaustPasses,
    spawnSync,
  });

  let toolError = false;
  let gameSource = fs.readFileSync(selectedGamePath, 'utf8');
  let generationOk = genResult.ok;

  if (!genResult.ok) {
    toolError = true;
    appendDesignLog(log, `generator failed (exit ${genResult.status})`);
    if (genResult.stderr) {
      appendDesignLog(log, genResult.stderr.trim().split('\n').slice(-3));
    }
  } else if (fs.existsSync(generatedPath)) {
    gameSource = fs.readFileSync(generatedPath, 'utf8');
    appendDesignLog(log, 'generator ok');
  } else {
    toolError = true;
    generationOk = false;
    appendDesignLog(log, 'generator exited ok but missing output file');
  }

  appendDesignLog(log, '## Simplify');
  const simplifiedPath = path.join(runDir, 'simplified_game.txt');
  let simplifyOk = false;
  if (generationOk && fs.existsSync(generatedPath)) {
    const simplifyTimeoutMs = Math.min(remainingMs(), 60000);
    const simplifyResult = runSimplify({
      simplifyBin,
      inPath: generatedPath,
      outPath: simplifiedPath,
      timeoutMs: simplifyTimeoutMs,
      spawnSync,
    });
    if (simplifyResult.ok && fs.existsSync(simplifiedPath)) {
      simplifyOk = true;
      gameSource = fs.readFileSync(simplifiedPath, 'utf8');
      appendDesignLog(log, 'simplify ok');
    } else {
      appendDesignLog(log, `simplify skipped or failed (exit ${simplifyResult.status})`);
    }
  } else {
    appendDesignLog(log, 'simplify skipped (no generated game)');
  }

  appendDesignLog(log, '## Evaluate gates');
  let levels = [];
  let levelsParsedOk = false;
  try {
    levels = enrichLevels(gameSource, spec);
    levelsParsedOk = true;
  } catch (error) {
    toolError = true;
    appendDesignLog(log, `level parse error: ${error.message}`);
  }

  const compileScratch = path.join(runDir, '_compile_scratch.txt');
  fs.writeFileSync(compileScratch, gameSource, 'utf8');
  const finalCompile = compileFileNative(cppBin, compileScratch, spawnSync);

  const theme = scanTheme(gameSource, levelsParsedOk);
  const gateInput = {
    spec,
    compileOk: finalCompile.ok,
    theme,
    designLogPresent: true,
    selectedOk: selectResult.status === 'selected' || selectResult.status === 'safe_mode',
    toolError,
    levels,
  };
  const gateReport = evaluatePublishGates(gateInput);

  const levelSummaries = levels.map((level) => ({
    band: level.band,
    solved: level.solved,
    width: level.width,
    height: level.height,
    solutionLength: level.solution ? level.solution.length : 0,
    winExercised: level.winExercised,
  }));

  const report = {
    status: gateReport.status,
    failures: gateReport.failures,
    gateResults: gateReport.gateResults,
    selected: {
      path: relJobPath(jobDir, selectResult.selectedPath),
      mode: selectResult.status,
    },
    candidateRejections: selectResult.rejections.map((entry) => ({
      path: relJobPath(jobDir, entry.path),
      stage: entry.stage,
      errors: entry.errors,
      reasons: entry.reasons,
      source: entry.source,
    })),
    levelSummaries,
    generation: {
      ok: generationOk,
      simplifyOk,
      timeMs: genTimeMs,
      samples: spec.generator_samples,
    },
    timestamps: { startedAt, finishedAt: new Date().toISOString() },
  };

  writeArtifacts(jobDir, {
    gameSource,
    report,
    designLogMarkdown: toMarkdown(log),
  });

  process.exit(exitCodeForStatus(report.status));
}

main();

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  writeArtifacts,
  createDesignLog,
  appendDesignLog,
  toMarkdown,
} = require('./report');

const jobDir = path.join(os.tmpdir(), `gameforge-report-test-${process.pid}`);
fs.rmSync(jobDir, { recursive: true, force: true });
fs.mkdirSync(jobDir, { recursive: true });

const log = createDesignLog();
appendDesignLog(log, '# Design log');
appendDesignLog(log, ['## Phase 1', '- selected seed']);

const report = {
  status: 'publishable',
  failures: [],
  gateResults: { compile: true },
  selected: { path: 'seeds/microban.txt' },
  candidateRejections: [],
  levelSummaries: [{ band: 'tiny', solved: true }],
  timestamps: { startedAt: '2026-08-11T00:00:00.000Z', finishedAt: '2026-08-11T01:00:00.000Z' },
};

writeArtifacts(jobDir, {
  gameSource: 'title Test Game\n',
  report,
  designLogMarkdown: toMarkdown(log),
});

const outDir = path.join(jobDir, 'out');
assert(fs.existsSync(path.join(outDir, 'game.txt')));
assert(fs.existsSync(path.join(outDir, 'report.json')));
assert(fs.existsSync(path.join(outDir, 'design_log.md')));
assert(!fs.existsSync(path.join(outDir, 'game.txt.tmp')));
assert.strictEqual(fs.readFileSync(path.join(outDir, 'game.txt'), 'utf8'), 'title Test Game\n');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8')), report);
assert.ok(fs.readFileSync(path.join(outDir, 'design_log.md'), 'utf8').includes('## Phase 1'));

fs.rmSync(jobDir, { recursive: true, force: true });
console.log('ok - writeArtifacts writes atomic out/ files');

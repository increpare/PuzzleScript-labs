'use strict';

const fs = require('fs');
const path = require('path');

function writeAtomic(outDir, fileName, content, fsImpl = fs) {
  const finalPath = path.join(outDir, fileName);
  const tmpPath = `${finalPath}.tmp`;
  fsImpl.writeFileSync(tmpPath, content, 'utf8');
  fsImpl.renameSync(tmpPath, finalPath);
}

function writeArtifacts(jobDir, { gameSource, report, designLogMarkdown }, fsImpl = fs) {
  const outDir = path.join(jobDir, 'out');
  fsImpl.mkdirSync(outDir, { recursive: true });
  writeAtomic(outDir, 'game.txt', gameSource, fsImpl);
  writeAtomic(outDir, 'report.json', `${JSON.stringify(report, null, 2)}\n`, fsImpl);
  writeAtomic(outDir, 'design_log.md', designLogMarkdown, fsImpl);
}

function createDesignLog() {
  return { lines: [] };
}

function appendDesignLog(log, lines) {
  const batch = Array.isArray(lines) ? lines : [lines];
  for (const line of batch) {
    log.lines.push(line);
  }
  return log;
}

function toMarkdown(log) {
  return log.lines.join('\n');
}

module.exports = {
  writeArtifacts,
  createDesignLog,
  appendDesignLog,
  toMarkdown,
};

'use strict';

function selectCandidate(deps) {
  const {
    jobDir,
    candidatePaths,
    seedPaths,
    compileFile,
    smokeCheck,
    copyFile,
  } = deps;

  const rejections = [];
  const destPath = `${jobDir}/selected/game.txt`;

  for (const srcPath of candidatePaths) {
    const compileResult = compileFile(srcPath);
    if (!compileResult.ok) {
      rejections.push({ path: srcPath, stage: 'compile', errors: compileResult.errors });
      continue;
    }
    const smokeResult = smokeCheck(srcPath);
    if (!smokeResult.ok) {
      rejections.push({ path: srcPath, stage: 'smoke', reasons: smokeResult.reasons });
      continue;
    }
    copyFile(srcPath, destPath);
    return { status: 'selected', selectedPath: srcPath, rejections };
  }

  for (const srcPath of seedPaths) {
    const compileResult = compileFile(srcPath);
    if (!compileResult.ok) {
      rejections.push({ path: srcPath, stage: 'compile', errors: compileResult.errors, source: 'seed' });
      continue;
    }
    const smokeResult = smokeCheck(srcPath);
    if (!smokeResult.ok) {
      rejections.push({ path: srcPath, stage: 'smoke', reasons: smokeResult.reasons, source: 'seed' });
      continue;
    }
    copyFile(srcPath, destPath);
    return { status: 'safe_mode', selectedPath: srcPath, rejections };
  }

  return { status: 'failed_mutate', rejections };
}

module.exports = { selectCandidate };

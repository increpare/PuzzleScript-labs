const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const generationSource = fs.readFileSync(
  path.join(repoRoot, 'tools/puzzlescriptmis-app/src/generation.cpp'),
  'utf8'
);
const editorSource = fs.readFileSync(
  path.join(repoRoot, 'tools/puzzlescriptmis-app/src/visualsandide.cpp'),
  'utf8'
);
const keyHandlingSource = fs.readFileSync(
  path.join(repoRoot, 'tools/puzzlescriptmis-app/src/keyHandling.cpp'),
  'utf8'
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  !/return\s*\{\s*levelSuccess\s*,\s*false\s*\}\s*;/.test(editorSource),
  'editor compile path must not hard-disable transform generation success'
);

assert(
  !/bool\s+stillTransforming\s*\([^)]*\)\s*\{\s*return\s+false\s*;\s*\}/.test(generationSource),
  'stillTransforming must reflect the running transformer instead of hard-returning false'
);

assert(
  !/#if\s+0\s*\nstatic\s+volatile\s+std::atomic_bool\s+requestGenerating/.test(generationSource),
  'transformer generation loop must not be compiled out'
);

assert(
  !/Native solve playback is not wired yet/.test(keyHandlingSource),
  'KEY_SOLVE must not be left as a native playback no-op'
);

assert(
  /playFont\.drawString\(" Show solution/.test(editorSource),
  'play screen must draw a Show solution button'
);

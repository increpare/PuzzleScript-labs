// Keep the desktop and browser builds on the same workbench assets. No engine rebuild
// or Emscripten is needed: the CodeMirror bundle and native wasm are checked in.
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildWeb(destination = path.join(root, 'build/mis-web')) {
  // Only the known generated web folders may be replaced.
  const allowed = ['build/mis-web', 'desktop/mis/web'].map(p => path.join(root, p));
  if (!allowed.includes(destination)) throw new Error('Unexpected MIS web output path');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const name of ['mis.html', 'css', 'js', 'demo', 'fonts', 'images',
    'Documentation/ico/favicon.ico', 'tests/good_games/ALL GREEN TO BLUE.txt']) {
    const target = path.join(destination, name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(root, 'src', name), target, { recursive: true,
      filter: p => !p.split(path.sep).some(part => part === 'node_modules' || part === '.git') });
  }
  // Static hosts open index.html for /mis/. Keep the old /mis/mis.html URL
  // working too; both entry points use the same relative worker/demo paths.
  await cp(path.join(destination, 'mis.html'), path.join(destination, 'index.html'));
  await cp(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
  console.log(`MIS95 web: ${destination}/index.html`);
  return destination;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWeb();

// Publish only the self-contained workbench, leaving the main site alone.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root } from './build-mis-web.mjs';

const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
// This builds the bundle and checks both entry points, demos and native workers.
run(process.execPath, ['src/tests/mis_web_browser.cjs']);
const backup = '/home/locus/backups/mis95/' + new Date().toISOString().replace(/[:.]/g, '-');
run('rsync', ['-az', '--delay-updates', '--delete-delay', '--backup',
  '--backup-dir=' + backup, '-e', 'ssh -o BatchMode=yes',
  path.join(root, 'build/mis-web') + '/', 'locus@ded.increpare.com:sites/puzzlescript/mis95/']);
console.log(`Previous and replaced files backed up on the host: ${backup}`);
run(process.execPath, ['src/tests/mis_web_browser.cjs', 'https://www.puzzlescript.net/mis95/']);
console.log('Published https://www.puzzlescript.net/mis95/ (also /mis95/mis.html).');

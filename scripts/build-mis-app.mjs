import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildWeb, root } from './build-mis-web.mjs';
import { generateIcons } from './gui95-icons.mjs';
const require = createRequire(path.join(root, 'desktop/mis/package.json'));
const { build, Platform, Arch } = require('electron-builder');
const platforms = { win32: Platform.WINDOWS, darwin: Platform.MAC, linux: Platform.LINUX };
if (!platforms[process.platform]) throw new Error(`Unsupported platform: ${process.platform}`);
await generateIcons(root);
const web = await buildWeb();
await rm(path.join(root, 'desktop/mis/web'), { recursive: true, force: true });
await cp(web, path.join(root, 'desktop/mis/web'), { recursive: true, force: true });
const icons = path.join(root, 'desktop/mis/icons');
await mkdir(icons, { recursive: true });
for (const ext of ['png', 'ico', 'icns']) await cp(path.join(root, `gui95-icons/mis.${ext}`), path.join(icons, `app.${ext}`));
require('electron'); // Ensure the runtime has been downloaded before packaging.
process.env.ELECTRON_BUILDER_CACHE ||= path.join(root, 'desktop/mis/.cache/builder');
// The GUI95 manifest deliberately targets Apple silicon, matching the other suite apps.
const arch = process.platform === 'darwin' ? Arch.arm64 : Arch[process.arch];
await build({ projectDir: path.join(root, 'desktop/mis'), targets: platforms[process.platform].createTarget('dir', arch) });
console.log(`PuzzleScript+MIS desktop: ${path.join(root, 'release/mis')}`);

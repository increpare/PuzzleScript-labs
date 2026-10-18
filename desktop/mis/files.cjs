const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function atomicWrite(file, text) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temp, 'wx');
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temp, file);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

class Files {
  constructor(profile) {
    this.settingsFile = path.join(profile, 'files.json');
    this.recent = []; this.directory = null; this.authorized = new Set();
  }
  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.settingsFile, 'utf8'));
      this.recent = (Array.isArray(data.recent) ? data.recent : []).filter(p => typeof p === 'string' && path.isAbsolute(p)).slice(0, 8);
      this.directory = typeof data.directory === 'string' && path.isAbsolute(data.directory) ? data.directory : null;
    } catch { /* First launch or damaged preferences: start with an empty history. */ }
  }
  async remember(file) {
    this.directory = path.dirname(file);
    this.recent = [file, ...this.recent.filter(p => process.platform === 'win32' ? p.toLowerCase() !== file.toLowerCase() : p !== file)].slice(0, 8);
    // A successful document save remains successful if preferences cannot be written.
    try {
      await fs.mkdir(path.dirname(this.settingsFile), { recursive: true });
      await atomicWrite(this.settingsFile, JSON.stringify({ recent: this.recent, directory: this.directory }));
    } catch { /* Document I/O has already succeeded; preferences are best effort. */ }
  }
  async open(file) {
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Choose a PuzzleScript text file smaller than 32 MB.');
    const text = await fs.readFile(file, 'utf8');
    this.authorized.add(file);
    await this.remember(file);
    return { text, name: path.basename(file), path: file };
  }
  async save(file, text) {
    if (!this.authorized.has(file)) throw new Error('Choose a save destination first.');
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 32 * 1024 * 1024) throw new Error('This game is too large to save.');
    await atomicWrite(file, text);
    await this.remember(file);
    return { name: path.basename(file), path: file };
  }
  saveLocation(name) { return this.directory ? path.join(this.directory, path.basename(name)) : path.basename(name); }
}
module.exports = { Files, atomicWrite };

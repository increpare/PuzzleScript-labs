const { app, BrowserWindow, Menu, ipcMain, protocol, dialog, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Files } = require('./files.cjs');
const ORIGIN = 'mis95://app/';
app.setName('MIS95');
if (process.env.MIS95_USER_DATA) app.setPath('userData', path.resolve(process.env.MIS95_USER_DATA));
app.commandLine.appendSwitch('disable-lcd-text');
protocol.registerSchemesAsPrivileged([{ scheme: 'mis95', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, files, ready = false, closing = false, opening = false;
const pending = [];
const delivered = new Set();
function addArguments(argv, cwd) {
  pending.push(...argv.filter(p => !p.startsWith('-') && /\.(txt|ps|puzzlescript)$/i.test(p)).map(p => path.resolve(cwd, p)));
}
addArguments(process.argv.slice(app.isPackaged ? 1 : 2), process.env.INIT_CWD || process.cwd());
const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();
app.on('second-instance', (_event, argv, cwd) => {
  addArguments(argv.slice(app.isPackaged ? 1 : 2), cwd);
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  dispatchNext();
});
app.on('open-file', (event, file) => { event.preventDefault(); pending.push(file); dispatchNext(); });
function dispatchNext() {
  if (!ready || opening || !pending.length || !win) return;
  opening = true;
  delivered.add(pending[0]);
  win.webContents.send('mis:open-pending', pending.shift());
}
const trusted = event => event.sender === win?.webContents && event.senderFrame?.url.startsWith(ORIGIN);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const filters = [{ name: 'PuzzleScript games', extensions: ['txt', 'ps', 'puzzlescript'] }, { name: 'All files', extensions: ['*'] }];
function handle(channel, action) {
  ipcMain.handle(channel, async (event, data) => {
    if (!trusted(event)) return { error: 'Unknown editor' };
    try { return await action(data); } catch (error) {
      const message = error.code === 'ENOENT' ? 'The file or folder could not be found. Choose another location.'
        : ['EACCES', 'EPERM', 'EBUSY'].includes(error.code) ? 'The file could not be accessed. Check its permissions or choose another location.'
        : error.message;
      return { error: message };
    }
  });
}
app.whenReady().then(async () => {
  if (!ownsProfile) return;
  files = new Files(app.getPath('userData')); await files.load();
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  const web = path.join(__dirname, 'web');
  protocol.handle('mis95', async request => {
    try {
      const url = new URL(request.url);
      const file = path.resolve(web, '.' + decodeURIComponent(url.pathname === '/' ? '/mis.html' : url.pathname));
      if (url.hostname !== 'app' || !file.startsWith(web + path.sep)) return new Response('Forbidden', { status: 403 });
      return new Response(await fs.readFile(file), { headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({ width: 1360, height: 900, minWidth: 600, minHeight: 420,
    frame: false, show: false, backgroundColor: '#c0c0c0', title: 'MIS95',
    ...(process.platform !== 'darwin' ? { icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'app.ico' : 'app.png') } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-prevent-unload', event => { if (closing) event.preventDefault(); });
  win.on('close', event => { if (!closing && ready) { event.preventDefault(); win.webContents.send('mis:confirm-close'); } });
  win.on('maximize', () => win.webContents.send('mis:maximized', true));
  win.on('unmaximize', () => win.webContents.send('mis:maximized', false));
  win.on('closed', () => { win = null; ready = false; });
  handle('mis:recents', () => files.recent.map(file => ({ path: file, name: path.basename(file) })));
  handle('mis:open', async requested => {
    let file;
    if (typeof requested === 'string') {
      // Only history and OS-delivered paths may bypass the native chooser.
      if (!files.recent.includes(requested) && !delivered.has(requested)) throw new Error('Choose a file with Open.');
      file = requested; delivered.delete(file);
    } else {
      const result = await dialog.showOpenDialog(win, { title: 'Open game', defaultPath: files.directory || undefined, filters, properties: ['openFile'] });
      if (result.canceled || !result.filePaths.length) return null;
      file = result.filePaths[0];
    }
    return files.open(file);
  });
  handle('mis:save', async options => {
    if (!options || typeof options.name !== 'string') throw new Error('Missing game name');
    let file = options.path;
    if (options.saveAs || !files.authorized.has(file)) {
      const result = await dialog.showSaveDialog(win, { title: 'Save game as', defaultPath: options.path && files.authorized.has(options.path) ? options.path : files.saveLocation(options.name), filters });
      if (result.canceled || !result.filePath) return null;
      file = result.filePath; files.authorized.add(file);
    }
    return files.save(file, options.text);
  });
  handle('mis:confirm-save', async () => (await dialog.showMessageBox(win, { type: 'question', message: 'Save changes to this game?', buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2 })).response);
  ipcMain.on('mis:ready', event => { if (trusted(event)) { ready = true; win.show(); dispatchNext(); } });
  ipcMain.on('mis:opened', event => { if (trusted(event)) { opening = false; dispatchNext(); } });
  ipcMain.on('mis:close-confirmed', event => { if (trusted(event)) { closing = true; win.close(); } });
  ipcMain.on('mis:window', (event, action) => {
    if (!trusted(event)) return;
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
    if (action === 'close') win.close();
  });
  win.webContents.on('did-fail-load', (_event, code, message) => { if (code !== -3) { win.show(); dialog.showErrorBox('MIS95 could not start', message); } });
  const showFallback = setTimeout(() => { if (win && !win.isDestroyed()) win.show(); }, 10000);
  showFallback.unref();
  await win.loadURL(ORIGIN + 'mis.html');
});
app.on('window-all-closed', () => app.quit());

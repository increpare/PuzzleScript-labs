const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, data) => ipcRenderer.invoke(channel, data).then(value => {
  if (value?.error) throw new Error(value.error);
  return value;
});
contextBridge.exposeInMainWorld('misDesktop', {
  platform: process.platform,
  open: recent => invoke('mis:open', recent),
  save: options => invoke('mis:save', options),
  exportHtml: options => invoke('mis:export-html', options),
  recentFiles: () => invoke('mis:recents'),
  confirmSave: () => invoke('mis:confirm-save'),
  ready: () => ipcRenderer.send('mis:ready'),
  close: () => ipcRenderer.send('mis:window', 'close'),
  closeConfirmed: () => ipcRenderer.send('mis:close-confirmed'),
  minimize: () => ipcRenderer.send('mis:window', 'minimize'),
  maximize: () => ipcRenderer.send('mis:window', 'maximize'),
  onOpen: callback => ipcRenderer.on('mis:open-pending', (_event, file) => callback(file)),
  opened: () => ipcRenderer.send('mis:opened'),
  onClose: callback => ipcRenderer.on('mis:confirm-close', () => callback()),
  onMaximize: callback => ipcRenderer.on('mis:maximized', (_event, on) => callback(on))
});

contextBridge.exposeInMainWorld('misNativeBackend', {
  open: data => invoke('mis:backend-open', data),
  command: data => invoke('mis:backend-command', data),
  close: id => invoke('mis:backend-close', id),
  diagnostics: () => invoke('mis:backend-info'),
  onEvent: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('mis:backend-event', listener); return () => ipcRenderer.removeListener('mis:backend-event', listener); }
});

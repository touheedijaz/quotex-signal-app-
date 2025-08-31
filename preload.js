const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('message', (event) => {
  if (!event.data || !event.data.__qsig) return;
  const { type, data } = event.data;
  if (type === 'signal') ipcRenderer.send('signal', data);
  else ipcRenderer.send('status', data);
});

contextBridge.exposeInMainWorld('qsig', {
  onSignal: (cb) => ipcRenderer.on('signal', (_e, payload) => cb(payload)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
  requestEval: () => ipcRenderer.invoke('request-eval')
});

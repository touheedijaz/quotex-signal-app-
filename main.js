const { app, BrowserWindow, BrowserView, ipcMain, Notification } = require('electron');
const path = require('path');

let mainWindow, webView, sidebarView;
const INJECT_CODE = require('./injector.js'); // injector.js exports a string

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    backgroundColor: '#0b0e12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Main trading site view (left)
  webView = new BrowserView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  mainWindow.setBrowserView(webView);
  webView.setBounds({ x: 0, y: 0, width: 1000, height: 820 });
  webView.webContents.loadURL('https://market-qx.pro/en'); // default; you can navigate inside the app

  // Sidebar UI (right)
  sidebarView = new BrowserView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  mainWindow.addBrowserView(sidebarView);
  sidebarView.setBounds({ x: 1000, y: 0, width: 360, height: 820 });
  sidebarView.webContents.loadFile(path.join(__dirname, 'sidebar.html'));

  mainWindow.on('resize', () => {
    const [w, h] = mainWindow.getContentSize();
    const sidebarWidth = 360;
    webView.setBounds({ x: 0, y: 0, width: Math.max(600, w - sidebarWidth), height: h });
    sidebarView.setBounds({ x: Math.max(600, w - sidebarWidth), y: 0, width: Math.min(sidebarWidth, w-600), height: h });
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Forward signals from injected page -> sidebar and show desktop notification
ipcMain.on('signal', (_evt, payload) => {
  try {
    sidebarView?.webContents.send('signal', payload);
    const title = payload.type === 'UP' ? 'UP signal' : 'DOWN signal';
    new Notification({ title: `Quotex: ${title}`, body: `${payload.reason} — ${Math.round(payload.accuracy||0)}%` }).show();
  } catch (e) {
    console.error('Signal forward error', e);
  }
});

ipcMain.on('status', (_evt, data) => {
  sidebarView?.webContents.send('status', data);
});

// Provide an on-demand evaluator trigger from sidebar
ipcMain.handle('request-eval', async () => {
  try {
    const res = await webView.webContents.executeJavaScript('window.__qsig_evaluate ? window.__qsig_evaluate() : { found:false, reason: \"no-evaluator\" }');
    sidebarView?.webContents.send('signal', res);
    return res;
  } catch (e) {
    console.error('request-eval error', e);
    return { found:false, reason:'execution-failed' };
  }
});

// Inject the code into any webcontents when they finish load
app.whenReady().then(() => {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('did-finish-load', () => {
      try {
        contents.executeJavaScript(INJECT_CODE).catch(()=>{});
      } catch (e) {}
    });
  });
});

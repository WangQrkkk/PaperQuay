const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { createBackend } = require('./backend.cjs');
const {
  registerLocalPdfProtocol,
  registerLocalPdfProtocolScheme,
} = require('./localPdfProtocol.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let backend = null;

registerLocalPdfProtocolScheme();

function getBackend() {
  if (!backend) {
    backend = createBackend({ app });
  }

  return backend;
}

function getAppIconPath() {
  const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconRoot = app.isPackaged ? 'dist' : 'public';

  return path.join(__dirname, '..', iconRoot, iconFileName);
}

function shouldIgnoreRendererConsoleMessage(level, message) {
  return (
    level === 'info' &&
    /^Warning: (Bad value, for custom key|TT: undefined function)/.test(message)
  );
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    title: 'PaperQuay',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    icon: getAppIconPath(),
    backgroundColor: '#eef2f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.webContents.on('console-message', (event) => {
      const message = String(event.message ?? '');

      if (shouldIgnoreRendererConsoleMessage(event.level, message)) {
        return;
      }

      const source = event.sourceId ? `${event.sourceId}:${event.lineNumber}` : `line ${event.lineNumber ?? '?'}`;
      console.log(`[renderer:${event.level ?? 'info'}] ${message} (${source})`);
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer] process gone', details);
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      console.error(`[renderer] failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedDevUrl = isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL);
    const allowedFileUrl = !isDev && url.startsWith('file://');

    if (allowedDevUrl || allowedFileUrl) {
      return;
    }

    event.preventDefault();

    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('paperquay:invoke', async (event, command, args) => {
  return getBackend().invoke(command, args ?? {}, event);
});

ipcMain.handle('paperquay:window-control', (event, action) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);

  if (!targetWindow) {
    return;
  }

  if (action === 'minimize') {
    targetWindow.minimize();
    return;
  }

  if (action === 'toggleMaximize') {
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
    return;
  }

  if (action === 'close') {
    targetWindow.close();
  }
});

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('dev.paperquay.app');
  }

  getBackend();
  registerLocalPdfProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  backend?.close();
});

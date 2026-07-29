const { app, Tray, Menu, nativeImage, BrowserWindow, shell, dialog, Notification } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
const BACKEND_PORT = 3001;
const BACKEND_ORIGIN = `http://localhost:${BACKEND_PORT}`;

let tray = null;
let statusWindow = null;
let updateAvailable = false;
let updateDownloaded = false;

// ── Backend lifecycle ──────────────────────────────────────────────

function startBackend() {
  if (isDev) return;

  process.env.PORT = String(BACKEND_PORT);
  process.env.NODE_ENV = 'production';

  // Point the GLiNER engine at the model bundled under Resources/ (extraResources).
  // Without this the backend looks in process.cwd()/models — which isn't the app
  // bundle — and silently falls back to regex-only detection.
  const modelDir = path.join(process.resourcesPath, 'models', 'gliner-pii-large');
  process.env.GLINER_MODEL_DIR = modelDir;
  process.env.GLINER_MODEL_PATH = path.join(modelDir, 'model.onnx');

  const entry = path.join(process.resourcesPath, 'backend', 'index.js');
  try {
    require(entry);
  } catch (e) {
    console.error('Backend start failed:', e);
  }
}

function waitForBackend(done, tries = 0) {
  const req = http.get(`${BACKEND_ORIGIN}/health`, (res) => {
    res.resume();
    done(true);
  });
  req.on('error', () => {
    if (tries > 60) return done(false);
    setTimeout(() => waitForBackend(done, tries + 1), 500);
  });
}

// ── Tray ───────────────────────────────────────────────────────────

function buildTrayIcon() {
  // macOS: a monochrome template image that auto-adapts to the light/dark menu
  // bar. Windows: that template renders invisibly on the taskbar tray, so use
  // the coloured app icon (.ico) instead.
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'trayTemplate.png';
  const iconPath = isDev
    ? path.join(__dirname, 'build', iconFile)
    : path.join(process.resourcesPath, iconFile);

  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  // Fallback: 16x16 filled circle
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      if (dx * dx + dy * dy <= 49) {
        const i = (y * size + x) * 4;
        canvas[i] = canvas[i + 1] = canvas[i + 2] = canvas[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function createTray() {
  const icon = buildTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Local Redactor AI');
  updateTrayMenu('Starting…');
}

function updateTrayMenu(status) {
  const menu = Menu.buildFromTemplate([
    { label: 'Local Redactor AI', enabled: false },
    { label: `Status: ${status}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => openStatusWindow(),
    },
    {
      label: 'Check Backend Health',
      click: () => {
        waitForBackend((ok) => {
          updateTrayMenu(ok ? 'Running' : 'Not responding');
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Open Chrome Web Store',
      click: () => shell.openExternal('https://chromewebstore.google.com/detail/local-redactor-ai-%E2%80%94-priva/dppllhhednkmbcchgldbbnaedfaidgpj'),
    },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: !isDev && app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    ...(updateDownloaded ? [
      { type: 'separator' },
      { label: 'Update ready — install & restart', click: () => autoUpdater.quitAndInstall() },
    ] : updateAvailable ? [
      { type: 'separator' },
      { label: 'Downloading update…', enabled: false },
    ] : []),
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        /* backend runs in-process, exits with app */
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// ── Status window (optional, shows backend info) ───────────────────

function openStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.focus();
    return;
  }

  statusWindow = new BrowserWindow({
    width: 480,
    height: 360,
    resizable: false,
    title: 'Local Redactor AI',
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  statusWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const html = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Local Redactor AI</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; color: #171525; background: #f8fafc; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .sub { color: #888; font-size: 13px; margin-bottom: 24px; }
  .status { display: flex; align-items: center; gap: 8px; padding: 14px 16px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: 12px; font-size: 13px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot.ok { background: #22c55e; }
  .dot.err { background: #ef4444; }
  .dot.loading { background: #f59e0b; }
  a { color: #6d3eea; text-decoration: none; font-size: 13px; }
  a:hover { text-decoration: underline; }
</style></head><body>
  <h1>Local Redactor AI</h1>
  <p class="sub">Backend engine running on localhost:${BACKEND_PORT}</p>
  <div class="status" id="s"><span class="dot loading"></span>Checking…</div>
  <p><a href="https://chromewebstore.google.com/detail/local-redactor-ai-%E2%80%94-priva/dppllhhednkmbcchgldbbnaedfaidgpj" target="_blank">Get the browser extension →</a></p>
</body></html>`)}`;

  // The health check runs in the MAIN process, not the page. This window is a
  // data: URL, so its origin is "null" — the backend's CORS allow-list rejects
  // that (correctly), which used to make the dashboard report "not responding"
  // even when the engine was healthy.
  const renderStatus = (ok) => {
    if (!statusWindow || statusWindow.isDestroyed()) return;
    const cls = ok ? 'ok' : 'err';
    const msg = ok ? 'Backend is running' : 'Backend is not responding';
    statusWindow.webContents
      .executeJavaScript(
        `document.getElementById('s').innerHTML='<span class="dot ${cls}"></span>${msg}'`
      )
      .catch(() => {});
  };

  statusWindow.webContents.once('did-finish-load', () => {
    const req = http.get(`${BACKEND_ORIGIN}/health`, (res) => {
      res.resume();
      renderStatus(res.statusCode === 200);
    });
    req.on('error', () => renderStatus(false));
  });

  statusWindow.loadURL(html);
  statusWindow.on('closed', () => { statusWindow = null; });
}

// ── Auto-updater ──────────────────────────────────────────────────

function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', () => {
    updateAvailable = true;
    updateTrayMenu('Running');
  });

  autoUpdater.on('update-downloaded', () => {
    updateDownloaded = true;
    updateTrayMenu('Running');
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Local Redactor AI',
        body: 'A new version has been downloaded. It will be installed when you quit.',
      });
      n.on('click', () => autoUpdater.quitAndInstall());
      n.show();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
  });

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

// ── App lifecycle ──────────────────────────────────────────────────

// Hide dock icon on macOS — tray-only
if (process.platform === 'darwin') {
  app.dock?.hide();
}

app.whenReady().then(() => {
  createTray();
  startBackend();
  setupAutoUpdater();

  // Auto-start at login (packaged builds only)
  if (!isDev) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  waitForBackend((ok) => {
    updateTrayMenu(ok ? 'Running' : 'Failed to start');
    if (ok) {
      openStatusWindow();
    } else {
      dialog.showErrorBox('Local Redactor AI', 'The backend engine failed to start. Please restart the app.');
    }
  });
});

app.on('activate', () => {
  openStatusWindow();
});

app.on('window-all-closed', (e) => {
  // Don't quit when status window is closed — keep tray alive
  e?.preventDefault?.();
});

app.on('before-quit', () => {
  /* backend runs in-process, exits with app */
});

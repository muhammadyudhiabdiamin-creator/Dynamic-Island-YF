const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell, clipboard, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { exec } = require('child_process');
const SpotifyAuth = require('./spotify');
const LyricsService = require('./lyrics');

let mainWindow;
let tray;
let refreshTrayMenu = () => {};
let spotify;
let lyrics;
let pollInterval;
let clipboardInterval;
let downloadWatcher;
let activityServer;

let clipboardHistory = [];
let lastClipText = '';
const seenDownloads = new Set();

let prevCpuInfo = null;
let prevNetBytes = null;

const ISLAND_STATES = {
  compact: { width: 410, height: 56 },
  hover: { width: 440, height: 64 },
  expanded: { width: 480, height: 340 }
};

function createFallbackIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="#1DB954"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else mainWindow.show();
  refreshTrayMenu();
}

function createTray() {
  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="4" width="14" height="8" rx="4" fill="#1DB954"/><circle cx="5" cy="8" r="1.5" fill="#0e0e10"/></svg>`;
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svgIcon).toString('base64')}`);
  tray = new Tray(icon);
  tray.setToolTip('Dynamic Island PC');

  refreshTrayMenu = () => {
    const loginSettings = app.getLoginItemSettings();
    const menu = Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() ? 'Hide Island (Ctrl+Alt+H)' : 'Show Island (Ctrl+Alt+H)',
        click: () => toggleWindowVisibility()
      },
      {
        label: 'Reset Position',
        click: () => {
          if (!mainWindow) return;
          const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
          const bounds = mainWindow.getBounds();
          mainWindow.setBounds({ x: Math.round((screenWidth - bounds.width) / 2), y: 0, width: bounds.width, height: bounds.height });
        }
      },
      { type: 'separator' },
      {
        label: 'Disconnect Spotify',
        enabled: spotify ? spotify.isAuthenticated() : false,
        click: () => {
          if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
          spotify.disconnect();
          lastTrackId = null;
          currentLyrics = null;
          updateSpotifyStatus();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('spotify-track', null);
          }
          refreshTrayMenu();
        }
      },
      {
        label: 'Auto-Start with Windows',
        type: 'checkbox',
        checked: loginSettings.openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({
            openAtLogin: item.checked,
            path: 'wscript.exe',
            args: [path.join(__dirname, 'start-silent.vbs')]
          });
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { cleanup(); app.quit(); } }
    ]);
    tray.setContextMenu(menu);
  };

  tray.on('click', () => toggleWindowVisibility());
  refreshTrayMenu();
}

function startActivityServer() {
  try {
    activityServer = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1:8889');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (url.pathname === '/activity') {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}');
              sendLiveActivity(payload);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
            }
          });
          return;
        }
        if (req.method === 'GET') {
          const payload = {
            title: url.searchParams.get('title') || 'Task running',
            progress: url.searchParams.has('progress') ? Number(url.searchParams.get('progress')) : null,
            status: url.searchParams.get('status') || 'running'
          };
          sendLiveActivity(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
      }
      res.writeHead(404);
      res.end('Not found');
    });

    activityServer.on('error', () => {});
    activityServer.listen(8889, '127.0.0.1');
  } catch (e) {}
}

function sendLiveActivity(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('live-activity', {
    title: String(payload.title || 'Process active').slice(0, 60),
    progress: typeof payload.progress === 'number' ? Math.max(0, Math.min(100, payload.progress)) : null,
    status: payload.status || 'running'
  });
}

function getCpuUsagePercent() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  }
  if (!prevCpuInfo) {
    prevCpuInfo = { idle, total };
    return 0;
  }
  const idleDiff = idle - prevCpuInfo.idle;
  const totalDiff = total - prevCpuInfo.total;
  prevCpuInfo = { idle, total };
  if (totalDiff <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
}

function getNetworkSpeed() {
  return new Promise((resolve) => {
    exec('netstat -e', { windowsHide: true, timeout: 1500 }, (err, stdout) => {
      if (err || !stdout) return resolve({ downKbps: 0, upKbps: 0 });
      const lines = stdout.split(/\r?\n/);
      const bytesLine = lines.find(l => /^\s*Bytes\s+\d+\s+\d+/i.test(l));
      if (!bytesLine) return resolve({ downKbps: 0, upKbps: 0 });
      const parts = bytesLine.trim().split(/\s+/);
      const rx = Number(parts[1]) || 0;
      const tx = Number(parts[2]) || 0;
      const now = Date.now();

      if (!prevNetBytes) {
        prevNetBytes = { rx, tx, ts: now };
        return resolve({ downKbps: 0, upKbps: 0 });
      }
      const dt = Math.max(0.2, (now - prevNetBytes.ts) / 1000);
      const downKbps = Math.max(0, Math.round(((rx - prevNetBytes.rx) / 1024) / dt));
      const upKbps = Math.max(0, Math.round(((tx - prevNetBytes.tx) / 1024) / dt));
      prevNetBytes = { rx, tx, ts: now };
      resolve({ downKbps, upKbps });
    });
  });
}

function startClipboardWatcher() {
  lastClipText = clipboard.readText().trim();
  if (lastClipText) clipboardHistory = [lastClipText];

  clipboardInterval = setInterval(() => {
    try {
      const text = clipboard.readText();
      if (!text || !text.trim()) return;
      if (text !== lastClipText) {
        lastClipText = text;
        clipboardHistory = [text, ...clipboardHistory.filter(item => item !== text)].slice(0, 5);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('clipboard-update', clipboardHistory);
        }
      }
    } catch (e) {}
  }, 1000);
}

function startDownloadWatcher() {
  try {
    const downloadsDir = app.getPath('downloads');
    if (!fs.existsSync(downloadsDir)) return;
    for (const file of fs.readdirSync(downloadsDir)) seenDownloads.add(file);
    const ignoredExt = ['.crdownload', '.tmp', '.part', '.opdownload', '.download'];

    downloadWatcher = fs.watch(downloadsDir, (_, filename) => {
      if (!filename || seenDownloads.has(filename)) return;
      const lower = filename.toLowerCase();
      if (ignoredExt.some(ext => lower.endsWith(ext))) return;

      const fullPath = path.join(downloadsDir, filename);
      setTimeout(() => {
        try {
          if (!fs.existsSync(fullPath)) return;
          const stat = fs.statSync(fullPath);
          if (!stat.isFile() || stat.size === 0) return;
          seenDownloads.add(filename);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-new', { name: filename, path: fullPath, size: stat.size });
          }
        } catch (e) {}
      }, 700);
    });
  } catch (e) {}
}

function createWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const startWidth = ISLAND_STATES.compact.width;
  const startHeight = ISLAND_STATES.compact.height;

  mainWindow = new BrowserWindow({
    width: startWidth,
    height: startHeight,
    x: Math.round((screenWidth - startWidth) / 2),
    y: 0,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    thickFrame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.setMenu(null);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.show();
    updateSpotifyStatus();
    mainWindow.webContents.send('clipboard-update', clipboardHistory);
    if (spotify.isAuthenticated()) startPolling();
  });
}

function updateSpotifyStatus() {
  if (!mainWindow) return;
  mainWindow.webContents.send('spotify-status', {
    configured: spotify.isConfigured(),
    connected: spotify.isAuthenticated()
  });
  refreshTrayMenu();
}

let lastTrackId = null;
let currentLyrics = null;

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    try {
      const track = await spotify.getCurrentlyPlaying();
      if (track) {
        mainWindow.webContents.send('spotify-track', track);
        if (track.trackId !== lastTrackId) {
          lastTrackId = track.trackId;
          currentLyrics = await lyrics.getLyrics(track.title, track.artist, track.album, track.durationMs / 1000);
          if (currentLyrics && currentLyrics.synced) {
            mainWindow.webContents.send('lyrics-data', { type: 'synced', lines: currentLyrics.synced });
          } else if (currentLyrics && currentLyrics.plain) {
            mainWindow.webContents.send('lyrics-data', { type: 'plain', text: currentLyrics.plain });
          } else {
            mainWindow.webContents.send('lyrics-data', { type: 'none' });
          }
        }
      } else if (lastTrackId !== null) {
        lastTrackId = null;
        currentLyrics = null;
        mainWindow.webContents.send('spotify-track', null);
      }
    } catch (e) {}
  }, 1500);
}

function cleanup() {
  globalShortcut.unregisterAll();
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (clipboardInterval) { clearInterval(clipboardInterval); clipboardInterval = null; }
  if (downloadWatcher) { downloadWatcher.close(); downloadWatcher = null; }
  if (activityServer) { activityServer.close(); activityServer = null; }
}

ipcMain.on('island-resize', (_, state) => {
  if (!mainWindow) return;
  const targetSize = ISLAND_STATES[state];
  if (!targetSize) return;
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const currentBounds = mainWindow.getBounds();
  mainWindow.setBounds({
    x: Math.round((screenWidth - targetSize.width) / 2),
    y: currentBounds.y,
    width: targetSize.width,
    height: targetSize.height
  });
});

ipcMain.on('island-drag', (_, { deltaX, deltaY }) => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({ x: bounds.x + deltaX, y: bounds.y + deltaY, width: bounds.width, height: bounds.height });
});

ipcMain.on('island-reset-position', () => {
  if (!mainWindow) return;
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({ x: Math.round((screenWidth - bounds.width) / 2), y: 0, width: bounds.width, height: bounds.height });
});

// Spotify IPC
ipcMain.handle('spotify-save-config', async (_, { clientId, clientSecret }) => {
  spotify.saveConfig(clientId, clientSecret);
  updateSpotifyStatus();
  return { success: true };
});
ipcMain.handle('spotify-connect', async () => {
  try {
    await spotify.startAuthFlow();
    updateSpotifyStatus();
    startPolling();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('spotify-disconnect', async () => {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  spotify.disconnect();
  lastTrackId = null;
  currentLyrics = null;
  updateSpotifyStatus();
  return { success: true };
});
ipcMain.handle('spotify-play-pause', async () => { await spotify.playPause(); });
ipcMain.handle('spotify-next', async () => { await spotify.nextTrack(); });
ipcMain.handle('spotify-prev', async () => { await spotify.prevTrack(); });
ipcMain.handle('spotify-seek', async (_, posMs) => { await spotify.seek(posMs); });
ipcMain.handle('spotify-set-volume', async (_, vol) => { await spotify.setVolume(vol); });
ipcMain.handle('spotify-get-status', () => ({ configured: spotify.isConfigured(), connected: spotify.isAuthenticated() }));

// File Shelf & Download IPC
ipcMain.handle('file-open', async (_, filePath) => {
  if (filePath && fs.existsSync(filePath)) await shell.openPath(filePath);
});
ipcMain.handle('file-show', async (_, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
});
ipcMain.on('file-start-drag', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' }).catch(() => createFallbackIcon());
    event.sender.startDrag({ file: filePath, icon: icon.isEmpty() ? createFallbackIcon() : icon });
  } catch (e) {}
});

// Clipboard IPC
ipcMain.handle('clipboard-get', () => clipboardHistory);
ipcMain.handle('clipboard-write', (_, text) => {
  lastClipText = text;
  clipboard.writeText(text);
  return true;
});
ipcMain.handle('clipboard-clear', () => {
  clipboardHistory = [];
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('clipboard-update', clipboardHistory);
  return true;
});

// System Stats & Brightness IPC
ipcMain.handle('system-get-stats', async () => {
  const cpu = getCpuUsagePercent();
  const totalMem = os.totalmem();
  const usedMem = totalMem - os.freemem();
  const ramPct = Math.round((usedMem / totalMem) * 100);
  const ramUsedGb = (usedMem / (1024 ** 3)).toFixed(1);
  const ramTotalGb = (totalMem / (1024 ** 3)).toFixed(0);
  const net = await getNetworkSpeed();
  return { cpu, ramPct, ramUsedGb, ramTotalGb, downKbps: net.downKbps, upKbps: net.upKbps };
});

ipcMain.handle('system-set-brightness', (_, level) => {
  const safe = Math.max(5, Math.min(100, Math.round(Number(level) || 50)));
  exec(`powershell -NoProfile -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${safe})"`, { windowsHide: true });
  return safe;
});

// Avatar / GIF Picker IPC
ipcMain.handle('avatar-pick-file', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Notch Avatar or GIF',
    properties: ['openFile'],
    filters: [{ name: 'Images & GIF', extensions: ['gif', 'png', 'jpg', 'jpeg', 'webp'] }]
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const filePath = res.filePaths[0];
  try {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const base64 = fs.readFileSync(filePath).toString('base64');
    return `data:${mime};base64,${base64}`;
  } catch (e) {
    return null;
  }
});

// Test Live Activity IPC
ipcMain.handle('activity-test', () => {
  let pct = 15;
  sendLiveActivity({ title: 'AI Task: Building preview', progress: pct, status: 'running' });
  const step = setInterval(() => {
    pct += 25;
    if (pct >= 100) {
      clearInterval(step);
      sendLiveActivity({ title: 'AI Task complete', progress: 100, status: 'done' });
    } else {
      sendLiveActivity({ title: 'AI Task: Building preview', progress: pct, status: 'running' });
    }
  }, 900);
  return true;
});

app.whenReady().then(() => {
  spotify = new SpotifyAuth();
  lyrics = new LyricsService();
  createWindow();
  createTray();
  startClipboardWatcher();
  startDownloadWatcher();
  startActivityServer();
  globalShortcut.register('CommandOrControl+Alt+H', () => toggleWindowVisibility());
});

app.on('window-all-closed', () => {
  cleanup();
  app.quit();
});

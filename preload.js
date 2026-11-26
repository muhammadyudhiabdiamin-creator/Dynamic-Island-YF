const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  resizeIsland: (state) => ipcRenderer.send('island-resize', state),
  dragIsland: (delta) => ipcRenderer.send('island-drag', delta),
  resetPosition: () => ipcRenderer.send('island-reset-position'),

  // Spotify
  spotifySaveConfig: (config) => ipcRenderer.invoke('spotify-save-config', config),
  spotifyConnect: () => ipcRenderer.invoke('spotify-connect'),
  spotifyDisconnect: () => ipcRenderer.invoke('spotify-disconnect'),
  spotifyPlayPause: () => ipcRenderer.invoke('spotify-play-pause'),
  spotifyNext: () => ipcRenderer.invoke('spotify-next'),
  spotifyPrev: () => ipcRenderer.invoke('spotify-prev'),
  spotifySeek: (positionMs) => ipcRenderer.invoke('spotify-seek', positionMs),
  spotifySetVolume: (volumePercent) => ipcRenderer.invoke('spotify-set-volume', volumePercent),
  spotifyGetStatus: () => ipcRenderer.invoke('spotify-get-status'),

  // File Drop Shelf & Downloads
  getPathForFile: (file) => webUtils.getPathForFile(file),
  fileOpen: (filePath) => ipcRenderer.invoke('file-open', filePath),
  fileShow: (filePath) => ipcRenderer.invoke('file-show', filePath),
  fileStartDrag: (filePath) => ipcRenderer.send('file-start-drag', filePath),

  // Clipboard History
  clipboardGet: () => ipcRenderer.invoke('clipboard-get'),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', text),
  clipboardClear: () => ipcRenderer.invoke('clipboard-clear'),

  // System Stats, Brightness, Avatar, Live Activity
  getSystemStats: () => ipcRenderer.invoke('system-get-stats'),
  setBrightness: (level) => ipcRenderer.invoke('system-set-brightness', level),
  pickAvatarFile: () => ipcRenderer.invoke('avatar-pick-file'),
  triggerTestActivity: () => ipcRenderer.invoke('activity-test'),

  // Listeners
  onSpotifyStatus: (callback) => ipcRenderer.on('spotify-status', (_, data) => callback(data)),
  onSpotifyTrack: (callback) => ipcRenderer.on('spotify-track', (_, data) => callback(data)),
  onLyricsData: (callback) => ipcRenderer.on('lyrics-data', (_, data) => callback(data)),
  onDownloadNew: (callback) => ipcRenderer.on('download-new', (_, data) => callback(data)),
  onClipboardUpdate: (callback) => ipcRenderer.on('clipboard-update', (_, data) => callback(data)),
  onLiveActivity: (callback) => ipcRenderer.on('live-activity', (_, data) => callback(data)),
});

contextBridge.exposeInMainWorld('mousePassThrough', {
  setIgnore: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore)
});

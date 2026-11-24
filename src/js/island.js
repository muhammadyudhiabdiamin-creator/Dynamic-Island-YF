class DynamicIsland {
  constructor() {
    this.island = document.getElementById('island');
    this.state = 'compact';
    this.activeTab = 'music';
    this.activeToolsSub = 'shelf';
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.hoverTimeout = null;
    this.leaveTimeout = null;
    this.toastTimeout = null;
    this.hudTimeout = null;
    this.toastActive = false;

    this.spotifyConnected = false;
    this.currentTrack = null;
    this.lastArtUrl = '';
    this.currentVolume = 50;
    this.currentBrightness = 80;
    this.lyricsMode = false;
    this.syncedLyrics = null;

    this.timerSeconds = 25 * 60;
    this.timerDefaultMinutes = 25;
    this.timerInterval = null;
    this.timerRunning = false;

    this.shelfFiles = [];
    this.clipboardItems = [];
    this.latestDownload = null;
    this.downloadTimeout = null;

    this.todos = this.loadStore('island_todos', []);
    this.agendas = this.loadStore('island_agendas', []);
    this.avatarDataUrl = localStorage.getItem('island_avatar') || '';

    this.statsInterval = null;
    this.cameraStream = null;

    this.init();
  }

  loadStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  init() {
    clock.start();
    visualizer = new AudioVisualizer('visualizer-canvas');

    this.setupMouseEvents();
    this.setupDragEvents();
    this.setupControlEvents();
    this.setupSpotifyEvents();
    this.setupSetupView();
    this.setupTabs();
    this.setupTimer();
    this.setupBattery();
    this.setupShelf();
    this.setupClipboard();
    this.setupDownloadWatcher();
    this.setupNotesAndAgenda();
    this.setupStatsAndHud();
    this.setupMirror();
    this.setupAvatar();
    this.setupWeather();
    this.setupLiveActivity();
  }

  // ===== HUD BAR (Volume / Brightness / Live Activity) =====
  showHud(label, percent, durationMs = 1800) {
    document.getElementById('hud-label').textContent = label;
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    document.getElementById('hud-fill').style.width = `${pct}%`;
    document.getElementById('hud-value').textContent = `${pct}%`;
    this.island.classList.add('has-hud');
    clearTimeout(this.hudTimeout);
    if (durationMs > 0) {
      this.hudTimeout = setTimeout(() => {
        this.island.classList.remove('has-hud');
      }, durationMs);
    }
  }

  // ===== ADAPTIVE COLOR =====
  resetAccentColor() {
    const root = document.documentElement;
    root.style.setProperty('--accent', '#1DB954');
    root.style.setProperty('--accent-soft', 'rgba(29, 185, 84, 0.22)');
    root.style.setProperty('--accent-border', 'rgba(255, 255, 255, 0.14)');
    if (this.spotifyConnected) document.getElementById('status-dot').style.background = '#1DB954';
    if (visualizer) visualizer.setColor(140);
  }

  applyAccentFromAlbumArt(imageUrl) {
    if (!imageUrl || imageUrl === this.lastArtUrl) return;
    this.lastArtUrl = imageUrl;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 24, 24);
        const { data } = ctx.getImageData(0, 0, 24, 24);

        let rSum = 0, gSum = 0, bSum = 0, weightSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (max + min) / 510;
          if (lum < 0.12 || lum > 0.92) continue;
          const weight = 0.25 + sat * 2.5;
          rSum += r * weight; gSum += g * weight; bSum += b * weight; weightSum += weight;
        }
        if (weightSum === 0) return this.resetAccentColor();

        const [h, s] = this.rgbToHsl(rSum / weightSum, gSum / weightSum, bSum / weightSum);
        const safeS = s < 12 ? 10 : Math.max(52, Math.min(82, Math.round(s)));
        const safeL = s < 12 ? 78 : 66;
        const hue = Math.round(h);

        const accent = `hsl(${hue}, ${safeS}%, ${safeL}%)`;
        const root = document.documentElement;
        root.style.setProperty('--accent', accent);
        root.style.setProperty('--accent-soft', `hsla(${hue}, ${safeS}%, ${safeL}%, 0.22)`);
        root.style.setProperty('--accent-border', `hsla(${hue}, ${safeS}%, ${safeL}%, 0.34)`);
        if (this.spotifyConnected) document.getElementById('status-dot').style.background = accent;
        if (visualizer) visualizer.setColor(hue);
      } catch (e) {
        this.resetAccentColor();
      }
    };
    img.onerror = () => this.resetAccentColor();
    img.src = imageUrl;
  }

  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }
    return [h, s * 100, l * 100];
  }

  showToast(text, durationMs = 2200) {
    const el = document.getElementById('compact-lyric');
    this.toastActive = true;
    el.textContent = text;
    this.island.classList.add('has-lyrics');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastActive = false;
      this.refreshCompactIdleText();
    }, durationMs);
  }

  refreshCompactIdleText() {
    if (this.toastActive) return;
    const el = document.getElementById('compact-lyric');
    if (this.currentTrack) {
      if (!this.syncedLyrics) {
        el.textContent = `${this.currentTrack.title} · ${this.currentTrack.artist}`;
        this.island.classList.add('has-lyrics');
      }
      return;
    }
    const nextEventText = this.getUpcomingAgendaLabel();
    if (nextEventText) {
      el.textContent = nextEventText;
      this.island.classList.add('has-lyrics');
    } else {
      el.textContent = '';
      this.island.classList.remove('has-lyrics');
    }
  }

  setState(newState) {
    if (this.state === newState) return;
    clearTimeout(this.hoverTimeout);
    clearTimeout(this.leaveTimeout);

    const oldState = this.state;
    this.state = newState;

    this.island.classList.remove('compact', 'hover', 'expanded');
    this.island.classList.add(newState);
    window.electronAPI.resizeIsland(newState);

    if (newState === 'expanded') this.onExpand();
    else if (oldState === 'expanded') this.onCollapse();
  }

  onExpand() {
    if (!this.lyricsMode && this.activeTab === 'music') {
      visualizer.setupCanvas();
      visualizer.start();
    }
    if (this.activeTab === 'stats') this.startStatsPolling();
    if (this.activeTab === 'mirror') this.startCamera();
    const vinyl = document.getElementById('vinyl-record');
    if (this.currentTrack?.isPlaying) vinyl.classList.add('spinning');
  }

  onCollapse() {
    visualizer.stop();
    this.stopStatsPolling();
    this.stopCamera();
    document.getElementById('vinyl-record').classList.remove('spinning');
  }

  isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  setupMouseEvents() {
    this.island.addEventListener('mouseenter', () => {
      clearTimeout(this.leaveTimeout);
      if (this.state === 'compact' && !this.island.classList.contains('has-download') && !this.island.classList.contains('has-hud')) {
        this.hoverTimeout = setTimeout(() => this.setState('hover'), 120);
      }
    });

    this.island.addEventListener('mouseleave', () => {
      clearTimeout(this.hoverTimeout);
      if (this.state === 'hover') {
        this.leaveTimeout = setTimeout(() => this.setState('compact'), 150);
      } else if (this.state === 'expanded' && !this.isTyping() && this.activeTab !== 'mirror') {
        this.leaveTimeout = setTimeout(() => this.setState('compact'), 350);
      }
    });

    window.addEventListener('blur', () => {
      if (this.state === 'expanded' && !this.isTyping()) {
        this.setState('compact');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state === 'expanded') this.setState('compact');
    });

    this.island.addEventListener('click', (e) => {
      if (this.isDragging) return;
      if (e.target.closest('button, input, label, .progress-bar, .shelf-item, .clip-item, .download-bar, .list-row')) return;
      if (this.state === 'compact' || this.state === 'hover') this.setState('expanded');
      else if (this.state === 'expanded') this.setState('compact');
    });

    // Scroll = Volume HUD | Shift + Scroll = Brightness HUD
    let volTimeout = null;
    let brightTimeout = null;
    this.island.addEventListener('wheel', (e) => {
      if (e.target.closest('.shelf-list, .clip-list, .scroll-list, .lyrics-container')) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 5 : -5;

      if (e.shiftKey) {
        this.currentBrightness = Math.max(10, Math.min(100, this.currentBrightness + delta));
        document.getElementById('slider-brightness').value = this.currentBrightness;
        document.getElementById('slider-brightness-val').textContent = `${this.currentBrightness}%`;
        this.showHud('Brightness', this.currentBrightness, 1500);
        clearTimeout(brightTimeout);
        brightTimeout = setTimeout(() => window.electronAPI.setBrightness(this.currentBrightness), 120);
      } else if (this.spotifyConnected) {
        this.currentVolume = Math.max(0, Math.min(100, this.currentVolume + delta));
        document.getElementById('slider-volume').value = this.currentVolume;
        document.getElementById('slider-volume-val').textContent = `${this.currentVolume}%`;
        this.showHud('Volume', this.currentVolume, 1500);
        clearTimeout(volTimeout);
        volTimeout = setTimeout(() => window.electronAPI.spotifySetVolume(this.currentVolume), 150);
      }
    }, { passive: false });
  }

  setupDragEvents() {
    const handle = document.getElementById('drag-handle');
    handle.addEventListener('mousedown', (e) => {
      this.isDragging = false;
      this.dragStartX = e.screenX;
      this.dragStartY = e.screenY;

      const onMove = (e) => {
        const dx = e.screenX - this.dragStartX;
        const dy = e.screenY - this.dragStartY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this.isDragging = true;
        if (this.isDragging) {
          window.electronAPI.dragIsland({ deltaX: dx, deltaY: dy });
          this.dragStartX = e.screenX;
          this.dragStartY = e.screenY;
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setTimeout(() => { this.isDragging = false; }, 100);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  setupControlEvents() {
    document.getElementById('btn-play').addEventListener('click', () => window.electronAPI.spotifyPlayPause());
    document.getElementById('btn-prev').addEventListener('click', () => window.electronAPI.spotifyPrev());
    document.getElementById('btn-next').addEventListener('click', () => window.electronAPI.spotifyNext());

    document.getElementById('progress-bar').addEventListener('click', (e) => {
      if (!this.currentTrack?.durationMs) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetMs = Math.round(ratio * this.currentTrack.durationMs);
      this.updateProgress(targetMs, this.currentTrack.durationMs);
      window.electronAPI.spotifySeek(targetMs);
    });
  }

  // ===== TABS =====
  switchTab(tabName) {
    if (this.activeTab === 'mirror' && tabName !== 'mirror') this.stopCamera();
    if (this.activeTab === 'stats' && tabName !== 'stats') this.stopStatsPolling();

    this.activeTab = tabName;
    const tabs = ['music', 'timer', 'notes', 'stats', 'mirror', 'tools'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-${t}`);
      const active = t === tabName;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    ['setup-view', 'music-view', 'timer-view', 'notes-view', 'stats-view', 'mirror-view', 'tools-view'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });

    if (tabName === 'music') {
      if (this.spotifyConnected) this.showMusicView();
      else this.showSetupView();
    } else {
      document.getElementById(`${tabName}-view`).style.display = 'flex';
      if (tabName === 'stats' && this.state === 'expanded') this.startStatsPolling();
      if (tabName === 'mirror' && this.state === 'expanded') this.startCamera();
    }
  }

  switchToolsSub(sub) {
    this.activeToolsSub = sub;
    ['shelf', 'clip', 'avatar'].forEach(name => {
      document.getElementById(`sub-${name}`).classList.toggle('active', name === sub);
      document.getElementById(`${name}-view`).style.display = name === sub ? 'flex' : 'none';
    });
  }

  setupTabs() {
    ['music', 'timer', 'notes', 'stats', 'mirror', 'tools'].forEach(tab => {
      document.getElementById(`tab-${tab}`).addEventListener('click', () => this.switchTab(tab));
    });
    ['shelf', 'clip', 'avatar'].forEach(sub => {
      document.getElementById(`sub-${sub}`).addEventListener('click', () => this.switchToolsSub(sub));
    });
  }

  // ===== NOTES & AGENDA =====
  setupNotesAndAgenda() {
    const subTodo = document.getElementById('sub-todo');
    const subAgenda = document.getElementById('sub-agenda');
    subTodo.addEventListener('click', () => {
      subTodo.classList.add('active'); subAgenda.classList.remove('active');
      document.getElementById('todo-panel').style.display = 'flex';
      document.getElementById('agenda-panel').style.display = 'none';
    });
    subAgenda.addEventListener('click', () => {
      subAgenda.classList.add('active'); subTodo.classList.remove('active');
      document.getElementById('todo-panel').style.display = 'none';
      document.getElementById('agenda-panel').style.display = 'flex';
    });

    document.getElementById('todo-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('todo-input');
      const text = input.value.trim();
      if (!text) return;
      this.todos.unshift({ text, done: false });
      localStorage.setItem('island_todos', JSON.stringify(this.todos));
      input.value = '';
      this.renderTodos();
    });

    document.getElementById('agenda-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const time = document.getElementById('agenda-time').value;
      const title = document.getElementById('agenda-title').value.trim();
      if (!time || !title) return;
      this.agendas.push({ time, title });
      this.agendas.sort((a, b) => a.time.localeCompare(b.time));
      localStorage.setItem('island_agendas', JSON.stringify(this.agendas));
      document.getElementById('agenda-title').value = '';
      this.renderAgendas();
      this.refreshCompactIdleText();
    });

    this.renderTodos();
    this.renderAgendas();
    setInterval(() => {
      this.renderAgendas();
      this.refreshCompactIdleText();
    }, 30000);
  }

  renderTodos() {
    const list = document.getElementById('todo-list');
    list.innerHTML = '';
    if (this.todos.length === 0) {
      list.innerHTML = '<div class="shelf-empty"><p class="shelf-empty-sub">No tasks yet. Type above and press Enter.</p></div>';
      return;
    }
    this.todos.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'todo-check';
      cb.checked = item.done;
      cb.addEventListener('change', () => {
        this.todos[idx].done = cb.checked;
        localStorage.setItem('island_todos', JSON.stringify(this.todos));
        this.renderTodos();
      });
      const txt = document.createElement('span');
      txt.className = `list-text ${item.done ? 'done' : ''}`;
      txt.textContent = item.text;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'dl-btn icon';
      del.setAttribute('aria-label', `Delete ${item.text}`);
      del.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      del.addEventListener('click', () => {
        this.todos.splice(idx, 1);
        localStorage.setItem('island_todos', JSON.stringify(this.todos));
        this.renderTodos();
      });
      row.append(cb, txt, del);
      list.appendChild(row);
    });
  }

  getUpcomingAgendaLabel() {
    if (this.agendas.length === 0) return '';
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const ev of this.agendas) {
      const [h, m] = ev.time.split(':').map(Number);
      const diff = (h * 60 + m) - nowMin;
      if (diff >= 0 && diff <= 60) {
        return diff === 0 ? `Now: ${ev.title}` : `${ev.title} in ${diff}m`;
      }
    }
    return '';
  }

  renderAgendas() {
    const list = document.getElementById('agenda-list');
    list.innerHTML = '';
    if (this.agendas.length === 0) {
      list.innerHTML = '<div class="shelf-empty"><p class="shelf-empty-sub">No events scheduled today. Add a time and title above.</p></div>';
      return;
    }
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    this.agendas.forEach((ev, idx) => {
      const [h, m] = ev.time.split(':').map(Number);
      const diff = (h * 60 + m) - nowMin;
      const badgeText = diff < 0 ? 'Past' : (diff === 0 ? 'Now' : (diff < 60 ? `in ${diff}m` : ev.time));

      const row = document.createElement('div');
      row.className = 'list-row';
      const badge = document.createElement('span');
      badge.className = 'agenda-badge';
      badge.textContent = badgeText;
      const txt = document.createElement('span');
      txt.className = 'list-text';
      txt.textContent = ev.title;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'dl-btn icon';
      del.setAttribute('aria-label', `Remove ${ev.title}`);
      del.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      del.addEventListener('click', () => {
        this.agendas.splice(idx, 1);
        localStorage.setItem('island_agendas', JSON.stringify(this.agendas));
        this.renderAgendas();
        this.refreshCompactIdleText();
      });
      row.append(badge, txt, del);
      list.appendChild(row);
    });
  }

  // ===== SYSTEM STATS & HUD SLIDERS =====
  setupStatsAndHud() {
    const volSlider = document.getElementById('slider-volume');
    const brSlider = document.getElementById('slider-brightness');

    volSlider.addEventListener('input', () => {
      this.currentVolume = Number(volSlider.value);
      document.getElementById('slider-volume-val').textContent = `${this.currentVolume}%`;
      if (this.spotifyConnected) window.electronAPI.spotifySetVolume(this.currentVolume);
    });

    brSlider.addEventListener('change', () => {
      this.currentBrightness = Number(brSlider.value);
      document.getElementById('slider-brightness-val').textContent = `${this.currentBrightness}%`;
      window.electronAPI.setBrightness(this.currentBrightness);
    });

    brSlider.addEventListener('input', () => {
      document.getElementById('slider-brightness-val').textContent = `${brSlider.value}%`;
    });

    document.getElementById('btn-test-activity').addEventListener('click', () => {
      window.electronAPI.triggerTestActivity();
      this.setState('compact');
    });
  }

  startStatsPolling() {
    const fetchStats = async () => {
      try {
        const s = await window.electronAPI.getSystemStats();
        document.getElementById('stat-cpu').textContent = `${s.cpu}%`;
        document.getElementById('bar-cpu').style.width = `${s.cpu}%`;
        document.getElementById('stat-ram').textContent = `${s.ramPct}%`;
        document.getElementById('bar-ram').style.width = `${s.ramPct}%`;
        const fmt = (kb) => kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB/s` : `${kb} KB/s`;
        document.getElementById('stat-net').textContent = `Dn ${fmt(s.downKbps)}`;
        document.getElementById('stat-net-up').textContent = `Up ${fmt(s.upKbps)}`;
      } catch (e) {}
    };
    fetchStats();
    this.stopStatsPolling();
    this.statsInterval = setInterval(fetchStats, 2000);
  }

  stopStatsPolling() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  // ===== LIVE ACTIVITY LISTENER =====
  setupLiveActivity() {
    window.electronAPI.onLiveActivity((data) => {
      if (data.status === 'done') {
        this.showHud(data.title, 100, 3000);
      } else if (data.status === 'error') {
        this.showToast(`Error: ${data.title}`, 3500);
      } else if (typeof data.progress === 'number') {
        this.showHud(data.title, data.progress, 6000);
      } else {
        this.showToast(data.title, 3500);
      }
    });
  }

  // ===== WEBCAM MIRROR =====
  setupMirror() {
    document.getElementById('btn-mirror-flip').addEventListener('click', () => {
      document.getElementById('mirror-video').classList.toggle('flipped');
    });
  }

  async startCamera() {
    const video = document.getElementById('mirror-video');
    const stateEl = document.getElementById('mirror-state');
    stateEl.textContent = 'Starting camera...';
    stateEl.style.display = 'block';
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 180 }, audio: false });
      video.srcObject = this.cameraStream;
      stateEl.style.display = 'none';
    } catch (e) {
      stateEl.textContent = 'Camera unavailable or permission denied';
      stateEl.style.display = 'block';
    }
  }

  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop());
      this.cameraStream = null;
    }
    const video = document.getElementById('mirror-video');
    if (video) video.srcObject = null;
  }

  // ===== CUSTOM GIF / AVATAR =====
  setupAvatar() {
    const applyAvatar = (dataUrl) => {
      this.avatarDataUrl = dataUrl || '';
      const compactImg = document.getElementById('compact-avatar');
      const previewImg = document.getElementById('avatar-preview');
      const emptyLabel = document.getElementById('avatar-empty-label');

      if (this.avatarDataUrl) {
        compactImg.src = this.avatarDataUrl;
        compactImg.style.display = 'block';
        previewImg.src = this.avatarDataUrl;
        previewImg.style.display = 'block';
        emptyLabel.style.display = 'none';
        this.island.classList.add('has-avatar');
      } else {
        compactImg.src = '';
        compactImg.style.display = 'none';
        previewImg.src = '';
        previewImg.style.display = 'none';
        emptyLabel.style.display = 'block';
        this.island.classList.remove('has-avatar');
      }
    };

    document.getElementById('btn-avatar-pick').addEventListener('click', async () => {
      const dataUrl = await window.electronAPI.pickAvatarFile();
      if (dataUrl) {
        try { localStorage.setItem('island_avatar', dataUrl); } catch (e) {}
        applyAvatar(dataUrl);
      }
    });

    document.getElementById('btn-avatar-clear').addEventListener('click', () => {
      localStorage.removeItem('island_avatar');
      applyAvatar('');
    });

    applyAvatar(this.avatarDataUrl);
  }

  // ===== WEATHER GLANCE (Open-Meteo, tanpa API key) =====
  setupWeather() {
    const loadWeather = async () => {
      try {
        let lat = -5.1477, lon = 119.4327;
        try {
          const geo = await fetch('https://ipwho.is/').then(r => r.json());
          if (geo && geo.success && geo.latitude && geo.longitude) {
            lat = geo.latitude;
            lon = geo.longitude;
          }
        } catch (e) {}

        const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`).then(r => r.json());
        if (!w?.current_weather) return;
        const temp = Math.round(w.current_weather.temperature);
        const code = w.current_weather.weathercode;
        const iconSvg = code <= 1
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/></svg>'
          : (code >= 51
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>');
        document.getElementById('weather-pill').innerHTML = `${iconSvg}<span>${temp}°C</span>`;
      } catch (e) {}
    };
    loadWeather();
    setInterval(loadWeather, 30 * 60 * 1000);
  }

  // ===== FILE DROP SHELF =====
  setupShelf() {
    this.island.addEventListener('dragenter', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        this.island.classList.add('drag-over');
        if (this.state !== 'expanded') this.setState('expanded');
        this.switchTab('tools');
        this.switchToolsSub('shelf');
      }
    });

    this.island.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    this.island.addEventListener('dragleave', (e) => {
      if (!this.island.contains(e.relatedTarget)) this.island.classList.remove('drag-over');
    });

    this.island.addEventListener('drop', (e) => {
      e.preventDefault();
      this.island.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer?.files || []);
      for (const file of files) {
        const filePath = window.electronAPI.getPathForFile(file);
        if (filePath && !this.shelfFiles.some(f => f.path === filePath)) {
          this.shelfFiles.unshift({ name: file.name, path: filePath });
        }
      }
      this.renderShelf();
    });

    document.getElementById('btn-shelf-clear').addEventListener('click', () => {
      this.shelfFiles = [];
      this.renderShelf();
    });
    this.renderShelf();
  }

  renderShelf() {
    const emptyEl = document.getElementById('shelf-empty');
    const listEl = document.getElementById('shelf-list');
    const footerEl = document.getElementById('shelf-footer');
    if (this.shelfFiles.length === 0) {
      emptyEl.style.display = 'flex'; listEl.style.display = 'none'; footerEl.style.display = 'none';
      listEl.innerHTML = ''; return;
    }
    emptyEl.style.display = 'none'; listEl.style.display = 'flex'; footerEl.style.display = 'flex';
    listEl.innerHTML = '';
    this.shelfFiles.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'shelf-item';
      row.draggable = true;
      row.title = item.path;
      row.addEventListener('dragstart', (e) => { e.preventDefault(); window.electronAPI.fileStartDrag(item.path); });
      const nameSpan = document.createElement('span');
      nameSpan.className = 'shelf-item-name';
      nameSpan.textContent = item.name;
      const actions = document.createElement('div');
      actions.className = 'shelf-item-actions';
      const openBtn = document.createElement('button');
      openBtn.type = 'button'; openBtn.className = 'dl-btn'; openBtn.textContent = 'Open';
      openBtn.addEventListener('click', (e) => { e.stopPropagation(); window.electronAPI.fileOpen(item.path); });
      const showBtn = document.createElement('button');
      showBtn.type = 'button'; showBtn.className = 'dl-btn'; showBtn.textContent = 'Folder';
      showBtn.addEventListener('click', (e) => { e.stopPropagation(); window.electronAPI.fileShow(item.path); });
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button'; removeBtn.className = 'dl-btn icon';
      removeBtn.setAttribute('aria-label', `Remove ${item.name}`);
      removeBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      removeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.shelfFiles.splice(index, 1); this.renderShelf(); });
      actions.append(openBtn, showBtn, removeBtn);
      row.append(nameSpan, actions);
      listEl.appendChild(row);
    });
  }

  // ===== CLIPBOARD =====
  setupClipboard() {
    window.electronAPI.onClipboardUpdate((items) => { this.clipboardItems = items || []; this.renderClipboard(); });
    window.electronAPI.clipboardGet().then((items) => { this.clipboardItems = items || []; this.renderClipboard(); });
    document.getElementById('btn-clip-clear').addEventListener('click', () => window.electronAPI.clipboardClear());
  }

  renderClipboard() {
    const emptyEl = document.getElementById('clip-empty');
    const listEl = document.getElementById('clip-list');
    const footerEl = document.getElementById('clip-footer');
    if (this.clipboardItems.length === 0) {
      emptyEl.style.display = 'flex'; listEl.style.display = 'none'; footerEl.style.display = 'none';
      listEl.innerHTML = ''; return;
    }
    emptyEl.style.display = 'none'; listEl.style.display = 'flex'; footerEl.style.display = 'flex';
    listEl.innerHTML = '';
    this.clipboardItems.forEach((text) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'clip-item';
      btn.textContent = text.replace(/\s+/g, ' ').trim();
      btn.title = text;
      btn.addEventListener('click', async () => {
        await window.electronAPI.clipboardWrite(text);
        const orig = btn.textContent;
        btn.textContent = 'Copied to clipboard';
        setTimeout(() => { btn.textContent = orig; }, 900);
      });
      listEl.appendChild(btn);
    });
  }

  // ===== DOWNLOAD WATCHER =====
  setupDownloadWatcher() {
    const dismiss = () => {
      clearTimeout(this.downloadTimeout);
      this.latestDownload = null;
      this.island.classList.remove('has-download');
    };
    window.electronAPI.onDownloadNew((file) => {
      this.latestDownload = file;
      document.getElementById('download-name').textContent = file.name;
      if (this.state === 'hover') this.setState('compact');
      this.island.classList.add('has-download');
      clearTimeout(this.downloadTimeout);
      this.downloadTimeout = setTimeout(dismiss, 8000);
    });
    document.getElementById('btn-dl-open').addEventListener('click', () => {
      if (this.latestDownload) window.electronAPI.fileOpen(this.latestDownload.path);
      dismiss();
    });
    document.getElementById('btn-dl-folder').addEventListener('click', () => {
      if (this.latestDownload) window.electronAPI.fileShow(this.latestDownload.path);
      dismiss();
    });
    document.getElementById('btn-dl-close').addEventListener('click', dismiss);
  }

  // ===== TIMER =====
  setupTimer() {
    const display = document.getElementById('timer-display');
    const badge = document.getElementById('compact-timer-badge');
    const toggleBtn = document.getElementById('btn-timer-toggle');
    const resetBtn = document.getElementById('btn-timer-reset');
    const renderTimer = () => {
      const m = String(Math.floor(this.timerSeconds / 60)).padStart(2, '0');
      const s = String(this.timerSeconds % 60).padStart(2, '0');
      display.textContent = `${m}:${s}`;
      badge.textContent = `${m}:${s}`;
    };
    const playChime = () => {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.8);
      } catch (e) {}
    };
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.timerRunning) return;
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.timerDefaultMinutes = parseInt(btn.dataset.minutes, 10);
        this.timerSeconds = this.timerDefaultMinutes * 60;
        renderTimer();
      });
    });
    toggleBtn.addEventListener('click', () => {
      if (this.timerRunning) {
        clearInterval(this.timerInterval); this.timerRunning = false; toggleBtn.textContent = 'Start';
      } else {
        this.timerRunning = true; toggleBtn.textContent = 'Pause';
        badge.style.display = 'inline'; this.island.classList.add('has-timer');
        this.timerInterval = setInterval(() => {
          if (this.timerSeconds > 0) { this.timerSeconds--; renderTimer(); }
          else {
            clearInterval(this.timerInterval); this.timerRunning = false; toggleBtn.textContent = 'Start';
            badge.style.display = 'none'; this.island.classList.remove('has-timer');
            playChime(); this.showToast('Timer finished', 3500);
          }
        }, 1000);
      }
    });
    resetBtn.addEventListener('click', () => {
      clearInterval(this.timerInterval); this.timerRunning = false;
      this.timerSeconds = this.timerDefaultMinutes * 60; toggleBtn.textContent = 'Start';
      badge.style.display = 'none'; this.island.classList.remove('has-timer'); renderTimer();
    });
    renderTimer();
  }

  // ===== BATTERY =====
  setupBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then((battery) => {
      const pill = document.getElementById('battery-pill');
      let warnedLow = false;
      const updatePill = () => {
        const pct = Math.round(battery.level * 100);
        pill.textContent = battery.charging ? `Chg ${pct}%` : `${pct}%`;
        if (!battery.charging && pct <= 20 && !warnedLow) {
          warnedLow = true; this.showToast(`Low battery ${pct}%`, 3000);
        } else if (pct > 20 || battery.charging) warnedLow = false;
      };
      battery.addEventListener('chargingchange', () => {
        const pct = Math.round(battery.level * 100);
        this.showToast(battery.charging ? `Charging ${pct}%` : `On battery ${pct}%`, 2500);
        updatePill();
      });
      battery.addEventListener('levelchange', updatePill);
      updatePill();
    }).catch(() => {});
  }

  // ===== SPOTIFY =====
  setupSetupView() {
    document.getElementById('btn-save-config').addEventListener('click', async () => {
      const clientId = document.getElementById('input-client-id').value.trim();
      const clientSecret = document.getElementById('input-client-secret').value.trim();
      if (!clientId || !clientSecret) return;
      const btn = document.getElementById('btn-save-config');
      btn.textContent = 'Connecting...'; btn.disabled = true;
      await window.electronAPI.spotifySaveConfig({ clientId, clientSecret });
      const result = await window.electronAPI.spotifyConnect();
      if (result.success) { btn.textContent = 'Connected'; setTimeout(() => this.showMusicView(), 1000); }
      else { btn.textContent = 'Failed - Try Again'; btn.disabled = false; }
    });
    document.getElementById('open-spotify-dev').addEventListener('click', () => {
      navigator.clipboard.writeText('https://developer.spotify.com/dashboard');
    });
  }

  setupSpotifyEvents() {
    window.electronAPI.onSpotifyStatus((status) => {
      this.spotifyConnected = status.connected;
      if (this.activeTab === 'music') {
        if (status.connected) this.showMusicView();
        else this.showSetupView();
      }
      document.getElementById('status-dot').style.background = status.connected ? 'var(--accent)' : '#8e8e93';
    });

    window.electronAPI.onSpotifyTrack((track) => {
      const iconPlay = document.getElementById('icon-play');
      const iconPause = document.getElementById('icon-pause');
      if (!track) {
        this.currentTrack = null; this.lastArtUrl = '';
        this.island.classList.remove('is-playing'); this.resetAccentColor();
        document.getElementById('song-title').textContent = 'Not playing';
        document.getElementById('song-artist').textContent = 'Play a track on Spotify';
        document.getElementById('vinyl-record').classList.remove('spinning');
        iconPlay.style.display = 'block'; iconPause.style.display = 'none';
        this.refreshCompactIdleText();
        return;
      }

      this.currentTrack = track;
      this.island.classList.toggle('is-playing', !!track.isPlaying);
      if (typeof track.volumePercent === 'number') {
        this.currentVolume = track.volumePercent;
        document.getElementById('slider-volume').value = this.currentVolume;
        document.getElementById('slider-volume-val').textContent = `${this.currentVolume}%`;
      }

      document.getElementById('song-title').textContent = track.title;
      document.getElementById('song-artist').textContent = `${track.artist} · ${track.album}`;
      iconPlay.style.display = track.isPlaying ? 'none' : 'block';
      iconPause.style.display = track.isPlaying ? 'block' : 'none';
      this.refreshCompactIdleText();

      const artUrl = track.albumArtSmall || track.albumArt;
      const art = document.getElementById('album-art');
      if (artUrl && art.src !== artUrl) art.src = artUrl;
      if (artUrl) this.applyAccentFromAlbumArt(artUrl);

      const vinyl = document.getElementById('vinyl-record');
      if (track.isPlaying && this.state === 'expanded') vinyl.classList.add('spinning');
      else vinyl.classList.remove('spinning');
      this.updateProgress(track.progressMs, track.durationMs);
    });

    window.electronAPI.onLyricsData((data) => {
      if (data.type === 'synced') { this.syncedLyrics = data.lines; document.getElementById('lyrics-container').classList.remove('plain-mode'); this.showLyricsMode(); }
      else if (data.type === 'plain') {
        this.syncedLyrics = null; const lc = document.getElementById('lyrics-container'); lc.classList.add('plain-mode'); lc.scrollTop = 0; this.showLyricsMode();
        document.getElementById('lyrics-scroll').innerHTML = `<div class="lyrics-line active">${data.text.replace(/\n/g, '<br>')}</div>`;
      } else { this.syncedLyrics = null; this.showVinylMode(); }
    });
  }

  showSetupView() {
    document.getElementById('setup-view').style.display = 'flex';
    document.getElementById('music-view').style.display = 'none';
  }

  showMusicView() {
    document.getElementById('setup-view').style.display = 'none';
    document.getElementById('music-view').style.display = 'flex';
  }

  showVinylMode() {
    this.lyricsMode = false;
    document.getElementById('vinyl-container').style.display = 'block';
    document.getElementById('visualizer-container').style.display = 'flex';
    document.getElementById('lyrics-container').style.display = 'none';
    if (this.state === 'expanded' && this.activeTab === 'music') {
      visualizer.setupCanvas(); visualizer.start();
    }
  }

  showLyricsMode() {
    this.lyricsMode = true;
    document.getElementById('vinyl-container').style.display = 'block';
    document.getElementById('visualizer-container').style.display = 'none';
    document.getElementById('lyrics-container').style.display = 'flex';
    visualizer.stop();
  }

  updateProgress(currentMs, totalMs) {
    if (!totalMs) return;
    const pct = (currentMs / totalMs) * 100;
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-current').textContent = this.formatTime(currentMs);
    document.getElementById('progress-total').textContent = this.formatTime(totalMs);
    if (this.syncedLyrics && this.lyricsMode) this.updateLyricsPosition(currentMs);
  }

  updateLyricsPosition(progressMs) {
    if (!this.syncedLyrics) return;
    let currentIdx = -1;
    for (let i = 0; i < this.syncedLyrics.length; i++) {
      if (this.syncedLyrics[i].time <= progressMs) currentIdx = i;
      else break;
    }
    if (!this.toastActive) {
      const compactLyric = document.getElementById('compact-lyric');
      if (currentIdx >= 0 && this.syncedLyrics[currentIdx].text) {
        compactLyric.textContent = this.syncedLyrics[currentIdx].text;
        this.island.classList.add('has-lyrics');
      }
    }
    const container = document.getElementById('lyrics-scroll');
    const start = Math.max(0, currentIdx - 1);
    const end = Math.min(this.syncedLyrics.length, currentIdx + 4);
    let html = '';
    for (let i = start; i < end; i++) {
      html += `<div class="lyrics-line ${i === currentIdx ? 'active' : ''}">${this.syncedLyrics[i].text}</div>`;
    }
    container.innerHTML = html;
  }

  formatTime(ms) {
    const secs = Math.floor(ms / 1000);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.dynamicIsland = new DynamicIsland();
});

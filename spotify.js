const http = require('http');
const { shell } = require('electron');
const fs = require('fs');
const path = require('path');

class SpotifyAuth {
  constructor() {
    this.clientId = '';
    this.clientSecret = '';
    this.redirectUri = 'http://127.0.0.1:8888/callback';
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
    this.server = null;
    this.configPath = path.join(__dirname, 'spotify-config.json');
    this.tokenPath = path.join(__dirname, 'spotify-tokens.json');

    this.scopes = [
      'user-read-currently-playing',
      'user-read-playback-state',
      'user-modify-playback-state'
    ].join(' ');

    this.loadConfig();
    this.loadTokens();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.clientId = data.clientId || '';
        this.clientSecret = data.clientSecret || '';
      }
    } catch (e) {}
  }

  saveConfig(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    fs.writeFileSync(this.configPath, JSON.stringify({ clientId, clientSecret }, null, 2));
  }

  loadTokens() {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const data = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
        this.refreshToken = data.refreshToken || null;
        this.accessToken = data.accessToken || null;
        this.tokenExpiry = data.tokenExpiry || 0;
      }
    } catch (e) {}
  }

  saveTokens() {
    fs.writeFileSync(this.tokenPath, JSON.stringify({
      refreshToken: this.refreshToken,
      accessToken: this.accessToken,
      tokenExpiry: this.tokenExpiry
    }, null, 2));
  }

  isConfigured() { return !!(this.clientId && this.clientSecret); }
  isAuthenticated() { return !!(this.refreshToken); }

  async startAuthFlow() {
    if (!this.isConfigured()) throw new Error('Spotify Client ID and Secret not configured');

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1:8888');
        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');
          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="background:#0e0e10;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh"><h2>Authorization denied. Close this tab.</h2></body></html>');
            this.server.close();
            reject(new Error('User denied authorization'));
            return;
          }
          if (code) {
            try {
              await this.exchangeCode(code);
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<html><body style="background:#0e0e10;color:#1DB954;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>Connected to Spotify!</h1><p style="color:#888">You can close this tab now.</p></body></html>');
              this.server.close();
              resolve(true);
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`<html><body style="background:#0e0e10;color:red;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh"><h2>Error: ${e.message}</h2></body></html>`);
              this.server.close();
              reject(e);
            }
          }
        }
      });

      this.server.listen(8888, () => {
        const authUrl = `https://accounts.spotify.com/authorize?client_id=${this.clientId}&response_type=code&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${encodeURIComponent(this.scopes)}&show_dialog=true`;
        shell.openExternal(authUrl);
      });

      setTimeout(() => {
        if (this.server) {
          this.server.close();
          reject(new Error('Auth timeout'));
        }
      }, 120000);
    });
  }

  async exchangeCode(code) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri
    });
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
      },
      body: params
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || 'Token exchange failed');
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
    this.saveTokens();
  }

  async refreshAccessToken() {
    if (!this.refreshToken) throw new Error('No refresh token');
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken
    });
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
      },
      body: params
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 400) {
        this.refreshToken = null;
        this.accessToken = null;
        this.saveTokens();
      }
      throw new Error('Token refresh failed');
    }
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.saveTokens();
  }

  async getValidToken() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry - 60000) {
      await this.refreshAccessToken();
    }
    return this.accessToken;
  }

  async getCurrentlyPlaying() {
    try {
      const token = await this.getValidToken();
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 204 || !response.ok) return null;
      const data = await response.json();
      if (!data || !data.item) return null;

      return {
        isPlaying: data.is_playing,
        trackId: data.item.id,
        title: data.item.name,
        artist: data.item.artists.map(a => a.name).join(', '),
        album: data.item.album.name,
        albumArt: data.item.album.images[0]?.url || '',
        albumArtSmall: data.item.album.images[2]?.url || data.item.album.images[0]?.url || '',
        progressMs: data.progress_ms,
        durationMs: data.item.duration_ms,
        volumePercent: typeof data.device?.volume_percent === 'number' ? data.device.volume_percent : null
      };
    } catch (e) {
      return null;
    }
  }

  async playPause() {
    try {
      const token = await this.getValidToken();
      const current = await this.getCurrentlyPlaying();
      const endpoint = current?.isPlaying
        ? 'https://api.spotify.com/v1/me/player/pause'
        : 'https://api.spotify.com/v1/me/player/play';
      await fetch(endpoint, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
    } catch (e) {}
  }

  async nextTrack() {
    try {
      const token = await this.getValidToken();
      await fetch('https://api.spotify.com/v1/me/player/next', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    } catch (e) {}
  }

  async prevTrack() {
    try {
      const token = await this.getValidToken();
      await fetch('https://api.spotify.com/v1/me/player/previous', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    } catch (e) {}
  }

  async seek(positionMs) {
    try {
      const token = await this.getValidToken();
      const pos = Math.max(0, Math.round(positionMs));
      await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${pos}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) {}
  }

  async setVolume(volumePercent) {
    try {
      const token = await this.getValidToken();
      const vol = Math.max(0, Math.min(100, Math.round(volumePercent)));
      await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${vol}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) {}
  }

  disconnect() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
    this.saveTokens();
  }
}

module.exports = SpotifyAuth;

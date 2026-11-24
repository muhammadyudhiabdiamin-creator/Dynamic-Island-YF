// ===== LRCLIB LYRICS MODULE =====
// Fetches synced lyrics from LRCLIB (free, no API key)

class LyricsService {
  constructor() {
    this.cache = new Map(); // cache lyrics by trackId
    this.userAgent = 'DynamicIslandPC/1.0 (https://github.com/aimotion/dynamic-island-pc)';
  }

  async getLyrics(title, artist, album, durationSec) {
    const cacheKey = `${title}-${artist}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // Try exact match first
      const params = new URLSearchParams({
        track_name: title,
        artist_name: artist,
        album_name: album || '',
        duration: Math.round(durationSec).toString()
      });

      let response = await fetch(`https://lrclib.net/api/get?${params}`, {
        headers: { 'User-Agent': this.userAgent }
      });

      let data = null;

      if (response.ok) {
        data = await response.json();
      }

      // If no exact match, try search
      if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
        const searchParams = new URLSearchParams({
          q: `${title} ${artist}`
        });

        response = await fetch(`https://lrclib.net/api/search?${searchParams}`, {
          headers: { 'User-Agent': this.userAgent }
        });

        if (response.ok) {
          const results = await response.json();
          if (results && results.length > 0) {
            // Pick best match (prefer synced lyrics)
            data = results.find(r => r.syncedLyrics) || results[0];
          }
        }
      }

      if (!data) {
        this.cache.set(cacheKey, null);
        return null;
      }

      const result = {
        synced: data.syncedLyrics ? this.parseLRC(data.syncedLyrics) : null,
        plain: data.plainLyrics || null,
        instrumental: data.instrumental || false
      };

      this.cache.set(cacheKey, result);
      return result;

    } catch (e) {
      console.error('[Lyrics] Error fetching:', e.message);
      return null;
    }
  }

  // Parse LRC format: [mm:ss.xx] lyric text
  parseLRC(lrcString) {
    const lines = lrcString.split('\n');
    const lyrics = [];

    for (const line of lines) {
      const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const ms = parseInt(match[3].padEnd(3, '0'));
        const timeMs = (minutes * 60 + seconds) * 1000 + ms;
        const text = match[4].trim();

        if (text) {
          lyrics.push({ time: timeMs, text });
        }
      }
    }

    return lyrics.sort((a, b) => a.time - b.time);
  }

  // Find current lyric line based on progress
  getCurrentLine(syncedLyrics, progressMs) {
    if (!syncedLyrics || syncedLyrics.length === 0) return { index: -1, line: null };

    let currentIndex = -1;
    for (let i = 0; i < syncedLyrics.length; i++) {
      if (syncedLyrics[i].time <= progressMs) {
        currentIndex = i;
      } else {
        break;
      }
    }

    return {
      index: currentIndex,
      line: currentIndex >= 0 ? syncedLyrics[currentIndex] : null,
      nextLine: currentIndex + 1 < syncedLyrics.length ? syncedLyrics[currentIndex + 1] : null
    };
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = LyricsService;

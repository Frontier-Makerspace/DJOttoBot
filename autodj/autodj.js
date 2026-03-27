const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Player } = require('./player');
const { Downloader } = require('./downloader');
const { getVibeForHour } = require('./vibe-schedules');
const { createAPI } = require('./api');
const { weightedPick, prefetchPopularity, saveCache } = require('./popularity');

const MUSIC_DIR = path.join(os.homedir(), 'Music', 'AutoDJ');
const CACHE_DIR = path.join(MUSIC_DIR, 'cache');
const STATE_FILE = path.join(MUSIC_DIR, 'autodj-state.json');
const LOG_FILE = path.join(MUSIC_DIR, 'autodj.log');
const WS_URL = 'ws://localhost:3000';
const API_PORT = 3001;
const TRACK_GAP_MS = 2000;
const RECENTLY_PLAYED_MAX = 50;

// Ensure directories exist
fs.mkdirSync(MUSIC_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

// Logging
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AutoDJ {
  constructor() {
    this.player = new Player();
    this.downloader = new Downloader();
    this.playbackQueue = [];
    this.mode = 'BOT';
    this.previousMode = 'BOT';
    this.startedAt = Date.now();
    this.currentVibe = getVibeForHour(new Date().getHours());
    this.vibeOverride = null;
    this.ws = null;
    this.wsConnected = false;
    this.running = false;
    this.predownloading = false;
    this.predownloadedTrack = null;

    // Track recently played files to avoid repeats
    this.recentlyPlayed = new Set();
    this.recentlyPlayedQueue = [];

    // Track artist play counts per hour (max 3 per artist per hour)
    this.artistPlayLog = []; // { artist, timestamp }
    this.ARTIST_HOURLY_LIMIT = 3;

    this.player.on('started', (track) => {
      log(`▶ Playing: ${track.title}`);
    });
    this.player.on('finished', (track) => {
      log(`✓ Finished: ${track ? track.title : 'unknown'}`);
    });
    this.player.on('error', (err) => {
      log(`✗ Player error: ${err.message}`);
    });
  }

  // --- Mode management ---

  setMode(mode) {
    if (mode !== this.mode) {
      this.previousMode = this.mode;
      this.mode = mode;
      log(`Mode changed: ${this.previousMode} → ${this.mode}`);
    }
  }

  overrideVibe(vibeName) {
    if (vibeName === 'auto' || vibeName === 'clear' || !vibeName) {
      this.vibeOverride = null;
      this.vibeOverrideExpires = null;
      this.currentVibe = getVibeForHour(new Date().getHours());
      log(`Vibe override cleared — back to schedule: ${this.currentVibe.name}`);
      return;
    }
    const vibeMap = {
      'Late Night': getVibeForHour(2),
      'Afternoon': getVibeForHour(9),
      'Antenna Club': getVibeForHour(14),
      'Evening': getVibeForHour(19),
      'Peak Hours': getVibeForHour(22),
    };
    const vibe = vibeMap[vibeName] || getVibeForHour(new Date().getHours());
    this.vibeOverride = vibe;
    // Auto-expire override after 2 hours
    this.vibeOverrideExpires = Date.now() + 2 * 60 * 60 * 1000;
    this.currentVibe = vibe;
    log(`Vibe override: ${vibeName} (tags: ${vibe.tags.join(', ')}) — expires in 2h`);
  }

  get effectiveVibe() {
    if (this.vibeOverride) {
      // Auto-expire vibe overrides
      if (this.vibeOverrideExpires && Date.now() > this.vibeOverrideExpires) {
        log(`Vibe override expired — returning to schedule`);
        this.vibeOverride = null;
        this.vibeOverrideExpires = null;
      } else {
        return this.vibeOverride;
      }
    }
    return getVibeForHour(new Date().getHours());
  }

  // --- Artist hourly limit ---

  isArtistOverLimit(artist) {
    if (!artist || artist === 'Unknown') return false;
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    // Prune old entries
    this.artistPlayLog = this.artistPlayLog.filter(e => e.timestamp > oneHourAgo);
    const count = this.artistPlayLog.filter(e => e.artist.toLowerCase() === artist.toLowerCase()).length;
    return count >= this.ARTIST_HOURLY_LIMIT;
  }

  logArtistPlay(artist) {
    if (!artist || artist === 'Unknown') return;
    this.artistPlayLog.push({ artist, timestamp: Date.now() });
  }

  // --- Recently played tracking ---

  markPlayed(filePath) {
    if (!filePath || this.recentlyPlayed.has(filePath)) return;
    this.recentlyPlayed.add(filePath);
    this.recentlyPlayedQueue.push(filePath);
    if (this.recentlyPlayedQueue.length > RECENTLY_PLAYED_MAX) {
      const evicted = this.recentlyPlayedQueue.shift();
      this.recentlyPlayed.delete(evicted);
    }
  }

  // --- SearchEngine-based track selection ---

  /**
   * Pick a random track from the local library matching a random tag from the current vibe.
   * Avoids recently played tracks. Returns track object or null.
   */
  pickLocalTrack(excludePath) {
    const vibe = this.effectiveVibe;
    if (!vibe.tags || vibe.tags.length === 0) {
      log(`Vibe "${vibe.name}" has no tags configured`);
      return null;
    }

    // Get the last played artist to avoid back-to-back same artist
    const lastArtist = this.lastPlayedArtist || null;

    // Shuffle tags so we try different ones if the first yields no fresh results
    const shuffledTags = [...vibe.tags].sort(() => Math.random() - 0.5);
    const searchEngine = this.downloader.searchEngine;

    for (const tag of shuffledTags) {
      // Search with a low threshold to cast a wide net, then filter
      const results = searchEngine.search(tag, 0.7);

      if (!results || results.length === 0) continue;

      // Filter out recently played, excluded track, same artist as last played,
      // AND artists that have hit their hourly limit (3 per hour)
      const fresh = results.filter(r =>
        !this.recentlyPlayed.has(r.path) &&
        (!excludePath || r.path !== excludePath) &&
        (!lastArtist || r.artist.toLowerCase() !== lastArtist.toLowerCase()) &&
        !this.isArtistOverLimit(r.artist)
      );

      // If filtering by artist left nothing, try without the back-to-back filter
      // but still respect the hourly limit
      const candidates = fresh.length > 0 ? fresh : results.filter(r =>
        !this.recentlyPlayed.has(r.path) &&
        (!excludePath || r.path !== excludePath) &&
        !this.isArtistOverLimit(r.artist)
      );

      // If all results for this tag are recently played, try the next tag
      if (candidates.length === 0) continue;

      // Weighted pick by popularity (popular tracks more likely)
      const poolSize = Math.min(candidates.length, 30);
      const pool = candidates.slice(0, poolSize);
      const pick = weightedPick(pool);

      if (!pick || !fs.existsSync(pick.path)) continue;

      const popStr = pick.popularity ? ` pop: ${pick.popularity.toLocaleString()} listeners` : '';
      log(`🎵 Selected: "${pick.artist} - ${pick.title}" (tag: ${tag}, confidence: ${(pick.confidence * 100).toFixed(0)}%, vibe: ${vibe.name}${popStr})`);

      return {
        title: `${pick.artist} - ${pick.title}`,
        artist: pick.artist || 'Unknown',
        filePath: pick.path,
        source: 'local-search',
        tag,
        duration: null,
      };
    }

    // All tags exhausted with no fresh results — fall back to any random track
    // from the full library to avoid repeats
    log(`All tags exhausted for vibe "${vibe.name}" — picking random from full library`);
    const allTracks = searchEngine.index.filter(t =>
      !this.recentlyPlayed.has(t.path) &&
      (!excludePath || t.path !== excludePath) &&
      (!lastArtist || t.artist.toLowerCase() !== lastArtist.toLowerCase()) &&
      !this.isArtistOverLimit(t.artist) &&
      fs.existsSync(t.path)
    );

    if (allTracks.length === 0) {
      log(`No fresh tracks available at all — clearing recently played`);
      this.recentlyPlayed.clear();
      this.recentlyPlayedQueue = [];
      return null;
    }

    const pick = weightedPick(allTracks);
    const popStr = pick.popularity ? ` pop: ${pick.popularity.toLocaleString()} listeners` : '';
    log(`🎵 Selected (random fallback): "${pick.artist} - ${pick.title}" (vibe: ${vibe.name}${popStr})`);

    return {
      title: `${pick.artist} - ${pick.title}`,
      artist: pick.artist || 'Unknown',
      filePath: pick.path,
      source: 'local-random',
      tag: 'random',
      duration: null,
    };
  }

  // --- Pre-load next track ---

  async preloadNext() {
    if (this.predownloading || this.predownloadedTrack) return;
    if (this.playbackQueue.length > 0) return;
    if (this.mode !== 'BOT') return;

    this.predownloading = true;
    try {
      // Exclude the currently playing track so preload never picks the same song
      const currentPath = this.player.currentTrack ? this.player.currentTrack.filePath : null;
      const track = this.pickLocalTrack(currentPath);
      if (track) {
        this.predownloadedTrack = track;
        log(`Pre-loaded next: "${track.title}"`);
      }
    } catch (err) {
      log(`Pre-load failed: ${err.message}`);
    } finally {
      this.predownloading = false;
    }
  }

  // --- WebSocket connection to dj-request-app ---

  connectWS() {
    const connect = () => {
      try {
        this.ws = new WebSocket(WS_URL);
      } catch (err) {
        log(`WebSocket connection error: ${err.message}`);
        setTimeout(connect, 5000);
        return;
      }

      this.ws.on('open', () => {
        this.wsConnected = true;
        log('Connected to dj-request-app');
        this.ws.send(JSON.stringify({ type: 'autodj', status: 'online' }));
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleWSMessage(msg);
        } catch {}
      });

      this.ws.on('close', () => {
        this.wsConnected = false;
        log('Disconnected from dj-request-app, reconnecting in 5s...');
        setTimeout(connect, 5000);
      });

      this.ws.on('error', (err) => {
        log(`WebSocket error: ${err.message}`);
        this.wsConnected = false;
      });
    };

    connect();
  }

  _handleWSMessage(msg) {
    // Single item with status "done" = downloaded & approved request
    if (msg.status === 'done' && msg.filePath) {
      const exists = this.playbackQueue.some(
        (t) => t.videoId === msg.videoId || t.filePath === msg.filePath
      );
      if (!exists) {
        this.playbackQueue.push({
          title: msg.title || 'Request',
          author: msg.author || 'Unknown',
          filePath: msg.filePath,
          videoId: msg.videoId,
          duration: msg.duration,
          source: 'request',
        });
        log(`Queued request: ${msg.title}`);
      }
    }

    // Handle queue arrays
    if (Array.isArray(msg.queue)) {
      for (const item of msg.queue) {
        if (item.status === 'done' && item.filePath) {
          const exists = this.playbackQueue.some(
            (t) => t.videoId === item.videoId || t.filePath === item.filePath
          );
          if (!exists) {
            this.playbackQueue.push({
              title: item.title || 'Request',
              author: item.author || 'Unknown',
              filePath: item.filePath,
              videoId: item.videoId,
              duration: item.duration,
              source: 'request',
            });
            log(`Queued request: ${item.title}`);
          }
        }
      }
    }
  }

  // --- Main playback loop ---

  async mainLoop() {
    this.running = true;
    log(`AutoDJ started in ${this.mode} mode`);
    log(`SearchEngine has ${this.downloader.searchEngine.index.length} tracks indexed`);

    while (this.running) {
      try {
        // OVERRIDE mode: do nothing, wait
        if (this.mode === 'OVERRIDE') {
          await sleep(1000);
          continue;
        }

        // ASSIST mode: only play from request queue
        if (this.mode === 'ASSIST') {
          if (this.playbackQueue.length === 0) {
            await sleep(2000);
            continue;
          }
        }

        // Update current vibe
        this.currentVibe = this.effectiveVibe;

        let track = null;

        // Priority 1: User request queue
        if (this.playbackQueue.length > 0) {
          track = this.playbackQueue.shift();
          log(`📋 Playing from request queue: "${track.title}"`);
        }
        // Priority 2: Pre-loaded track
        else if (this.predownloadedTrack) {
          track = this.predownloadedTrack;
          this.predownloadedTrack = null;
          log(`📦 Playing pre-loaded: "${track.title}"`);
        }
        // Priority 3: Pick fresh from SearchEngine
        else if (this.mode === 'BOT') {
          track = this.pickLocalTrack();

          if (!track) {
            log(`No matching tracks found, retrying in 5s...`);
            await sleep(5000);
            continue;
          }
        }

        // Play the track
        if (track && track.filePath) {
          if (!fs.existsSync(track.filePath)) {
            log(`File not found, skipping: ${track.filePath}`);
            continue;
          }

          // Mark as recently played, track artist for no-repeat logic, and log hourly count
          this.markPlayed(track.filePath);
          this.lastPlayedArtist = track.artist || null;
          this.logArtistPlay(track.artist);

          // Start pre-loading next track in background
          this.preloadNext();

          // Play and wait for completion
          try {
            await this.player.play(track.filePath, track.title, this.currentVibe.name);
          } catch (err) {
            log(`Playback error: ${err.message}`);
            await sleep(2000);
            continue;
          }

          // Gap between tracks
          await sleep(TRACK_GAP_MS);
        }

      } catch (err) {
        log(`Main loop error: ${err.message}`);
        await sleep(5000);
      }
    }
  }

  // --- State writer ---

  startStateWriter() {
    setInterval(() => {
      const state = {
        mode: this.mode,
        currentTrack: this.player.currentTrack,
        queue: this.playbackQueue.map((t) => ({
          title: t.title,
          author: t.author || t.artist,
          source: t.source,
          videoId: t.videoId,
        })),
        vibe: this.currentVibe,
        uptime: Math.floor((Date.now() - this.startedAt) / 1000),
        lastUpdated: new Date().toISOString(),
      };
      try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      } catch {}
    }, 30000);
  }

  // --- Start everything ---

  async start() {
    log('=== AutoDJ Starting ===');
    log(`Library: ${this.downloader.searchEngine.index.length} tracks indexed`);
    log(`Vibe: ${this.effectiveVibe.name} (tags: ${this.effectiveVibe.tags.join(', ')})`);

    // Prefetch popularity data in background (doesn't block playback)
    const searchEngine = this.downloader.searchEngine;
    prefetchPopularity(searchEngine.index).catch(err => {
      log(`Popularity prefetch error: ${err.message}`);
    });

    // Connect to request app
    this.connectWS();

    // Start API
    const app = createAPI(this);
    app.listen(API_PORT, () => {
      log(`API listening on port ${API_PORT}`);
    });

    // Start state writer
    this.startStateWriter();

    // Start main loop
    await this.mainLoop();
  }
}

// --- Run ---

const dj = new AutoDJ();
dj.start().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  dj.running = false;
  dj.player.stop();
  saveCache();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Shutting down...');
  dj.running = false;
  dj.player.stop();
  saveCache();
  process.exit(0);
});

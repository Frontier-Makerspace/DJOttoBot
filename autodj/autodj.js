const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Player } = require('./player');
const { Downloader } = require('./downloader');
const { getVibeForHour } = require('./vibe-schedules');
const { createAPI } = require('./api');

const MUSIC_DIR = path.join(os.homedir(), 'Music', 'AutoDJ');
const CACHE_DIR = path.join(MUSIC_DIR, 'cache');
const STATE_FILE = path.join(MUSIC_DIR, 'autodj-state.json');
const LOG_FILE = path.join(MUSIC_DIR, 'autodj.log');
const WS_URL = 'ws://localhost:3000';
const API_PORT = 3001;
const TRACK_GAP_MS = 2000;

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
    this.vibeQueryIndex = 0;
    this.ws = null;
    this.wsConnected = false;
    this.localFiles = [];
    this.localFileIndex = 0;
    this.ytFailCount = 0;
    this.running = false;
    this.predownloading = false;
    this.predownloadedTrack = null;

    this.player.on('started', (track) => {
      log(`Playing: ${track.title}`);
    });
    this.player.on('finished', (track) => {
      log(`Finished: ${track ? track.title : 'unknown'}`);
    });
    this.player.on('error', (err) => {
      log(`Player error: ${err.message}`);
    });
  }

  setMode(mode) {
    if (mode !== this.mode) {
      this.previousMode = this.mode;
      this.mode = mode;
      log(`Mode changed: ${this.previousMode} → ${this.mode}`);
    }
  }

  overrideVibe(vibeName) {
    const vibeMap = {
      'Late Night': { queries: ['dark ambient electronic', 'EBM industrial late night', 'cold wave minimal synth'] },
      'Morning': { queries: ['lo-fi hip hop chill', 'ambient electronic morning', 'downtempo chill beats'] },
      'Afternoon': { queries: ['house music mix', 'deep house electronic', 'nu disco funky house'] },
      'Evening': { queries: ['techno set', 'dark techno industrial', 'EBM electronic body music'] },
      'Peak Hours': { queries: ['hard techno peak hour', 'industrial techno set', 'dark electro peak'] },
    };
    this.vibeOverride = { name: vibeName, queries: vibeMap[vibeName].queries };
    this.currentVibe = this.vibeOverride;
    this.vibeQueryIndex = 0;
    log(`Vibe override: ${vibeName}`);
  }

  get effectiveVibe() {
    if (this.vibeOverride) return this.vibeOverride;
    return getVibeForHour(new Date().getHours());
  }

  // WebSocket connection to dj-request-app
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
    // Queue update: item with status "done" means downloaded & approved
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

    // Pre-fetch for "downloading" status
    if (msg.status === 'downloading' && msg.videoId && !this.downloader.cache.has(msg.videoId)) {
      log(`Pre-fetching: ${msg.title || msg.videoId}`);
      this.downloader.downloadTrack(msg.videoId, msg.title).catch(() => {});
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

  // Scan local music files (excluding cache dir)
  scanLocalFiles() {
    this.localFiles = [];
    const audioExts = ['.mp3', '.wav', '.aiff', '.m4a', '.flac'];
    try {
      const entries = fs.readdirSync(MUSIC_DIR);
      for (const entry of entries) {
        if (entry === 'cache' || entry === 'autodj-state.json' || entry === 'autodj.log') continue;
        const fullPath = path.join(MUSIC_DIR, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && audioExts.includes(path.extname(entry).toLowerCase())) {
          this.localFiles.push(fullPath);
        }
      }
      // Shuffle
      for (let i = this.localFiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.localFiles[i], this.localFiles[j]] = [this.localFiles[j], this.localFiles[i]];
      }
      this.localFileIndex = 0;
      log(`Found ${this.localFiles.length} local files`);
    } catch (err) {
      log(`Error scanning local files: ${err.message}`);
    }
  }

  getNextLocalFile() {
    if (this.localFiles.length === 0) return null;
    if (this.localFileIndex >= this.localFiles.length) {
      this.localFileIndex = 0;
      // Re-shuffle
      for (let i = this.localFiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.localFiles[i], this.localFiles[j]] = [this.localFiles[j], this.localFiles[i]];
      }
    }
    return this.localFiles[this.localFileIndex++];
  }

  // Pre-download next track while current one plays
  async predownloadNext() {
    if (this.predownloading || this.predownloadedTrack) return;
    if (this.playbackQueue.length > 0) return; // queue has items, no need
    if (this.mode !== 'BOT') return;

    this.predownloading = true;
    try {
      this.currentVibe = this.effectiveVibe;
      const queries = this.currentVibe.queries;
      const query = queries[this.vibeQueryIndex % queries.length];
      this.vibeQueryIndex++;

      const result = await this.downloader.searchAndDownload(query);
      this.predownloadedTrack = {
        title: result.title,
        author: result.author,
        filePath: result.filePath,
        videoId: result.videoId,
        duration: result.duration,
        source: 'auto',
      };
      this.ytFailCount = 0;
      log(`Pre-downloaded: ${result.title}`);
    } catch (err) {
      log(`Pre-download failed: ${err.message}`);
      this.ytFailCount++;
    }
    this.predownloading = false;
  }

  // Main playback loop
  async mainLoop() {
    this.running = true;
    log(`AutoDJ started in ${this.mode} mode`);

    while (this.running) {
      try {
        // OVERRIDE mode: do nothing
        if (this.mode === 'OVERRIDE') {
          await sleep(1000);
          continue;
        }

        // Update vibe
        this.currentVibe = this.effectiveVibe;

        let track = null;

        // 1. Check playback queue
        if (this.playbackQueue.length > 0) {
          track = this.playbackQueue.shift();
        }
        // 2. Check pre-downloaded track
        else if (this.predownloadedTrack) {
          track = this.predownloadedTrack;
          this.predownloadedTrack = null;
        }
        // 3. BOT mode: auto-pick from YouTube
        else if (this.mode === 'BOT') {
          if (this.ytFailCount >= 3) {
            // Fall back to local files
            log('YouTube failed 3x, falling back to local files');
            const localFile = this.getNextLocalFile();
            if (localFile) {
              track = {
                title: path.basename(localFile, path.extname(localFile)),
                filePath: localFile,
                source: 'local',
              };
            } else {
              log('No local files available, waiting...');
              await sleep(10000);
              continue;
            }
          } else {
            // Search YouTube
            try {
              const queries = this.currentVibe.queries;
              const query = queries[this.vibeQueryIndex % queries.length];
              this.vibeQueryIndex++;
              log(`Auto-picking: "${query}" (${this.currentVibe.name})`);

              const result = await this.downloader.searchAndDownload(query);
              track = {
                title: result.title,
                author: result.author,
                filePath: result.filePath,
                videoId: result.videoId,
                duration: result.duration,
                source: 'auto',
              };
              this.ytFailCount = 0;
            } catch (err) {
              log(`Auto-pick failed: ${err.message}`);
              this.ytFailCount++;
              await sleep(2000);
              continue;
            }
          }
        }
        // 4. ASSIST mode: wait for requests
        else if (this.mode === 'ASSIST') {
          await sleep(10000);
          continue;
        }

        // Play the track
        if (track && track.filePath) {
          if (!fs.existsSync(track.filePath)) {
            log(`File not found, skipping: ${track.filePath}`);
            continue;
          }

          // Start pre-downloading next track in background
          this.predownloadNext();

          await this.player.play(track.filePath, track.title);

          // Gap between tracks
          await sleep(TRACK_GAP_MS);
        }
      } catch (err) {
        log(`Main loop error: ${err.message}`);
        await sleep(2000);
      }
    }
  }

  // Write state file periodically
  startStateWriter() {
    setInterval(() => {
      const state = {
        mode: this.mode,
        currentTrack: this.player.currentTrack,
        queue: this.playbackQueue.map((t) => ({
          title: t.title,
          author: t.author,
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

  // Start everything
  async start() {
    log('=== AutoDJ Starting ===');

    // Scan local files
    this.scanLocalFiles();

    // Connect to request app
    this.connectWS();

    // Start API
    const app = createAPI(this);
    app.listen(API_PORT, () => {
      log(`API listening on port ${API_PORT}`);
    });

    // Start state writer
    this.startStateWriter();

    // Rescan local files every 5 minutes
    setInterval(() => this.scanLocalFiles(), 5 * 60 * 1000);

    // Start main loop
    await this.mainLoop();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run
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
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Shutting down...');
  dj.running = false;
  dj.player.stop();
  process.exit(0);
});

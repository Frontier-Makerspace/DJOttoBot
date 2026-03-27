const express = require('express');
const fs = require('fs');
const path = require('path');
const { getAlbumArt } = require('./popularity');

const SKIP_LOG_FILE = path.join(__dirname, 'skip-log.json');
const PARTY_STATE_FILE = path.join(__dirname, 'party-state.json');

function createAPI(autodj) {
  const app = express();
  app.use(express.json());

  const startTime = Date.now();

  // Enable CORS for DJ dashboard and visualizer
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // --- Party Mode State ---
  let partyMode = {
    active: false,
    name: '',
    tagline: '',
    vibe: '',
    startTime: null,
    endTime: null,
  };

  // Load persisted party state on startup
  try {
    if (fs.existsSync(PARTY_STATE_FILE)) {
      partyMode = JSON.parse(fs.readFileSync(PARTY_STATE_FILE, 'utf8'));
      console.log(`[Party] Loaded persisted party state: ${partyMode.active ? 'ACTIVE' : 'OFF'}`);
    }
  } catch {
    // Ignore load errors, use defaults
  }

  app.get('/party', (req, res) => {
    res.json(partyMode);
  });

  app.post('/party', (req, res) => {
    const { active, name, tagline, vibe, startTime, endTime } = req.body;
    partyMode = {
      active: active !== undefined ? active : partyMode.active,
      name: name !== undefined ? name : partyMode.name,
      tagline: tagline !== undefined ? tagline : partyMode.tagline,
      vibe: vibe !== undefined ? vibe : partyMode.vibe,
      startTime: startTime !== undefined ? startTime : partyMode.startTime,
      endTime: endTime !== undefined ? endTime : partyMode.endTime,
    };

    // If party mode is active and has a vibe, override it
    if (partyMode.active && partyMode.vibe) {
      autodj.overrideVibe(partyMode.vibe);
    }

    // Persist party state
    try {
      fs.writeFileSync(PARTY_STATE_FILE, JSON.stringify(partyMode, null, 2));
    } catch {}

    console.log(`[Party] ${partyMode.active ? 'ACTIVE' : 'OFF'}: "${partyMode.name}" ${partyMode.startTime || ''}-${partyMode.endTime || ''}`);
    res.json(partyMode);
  });

  app.get('/status', (req, res) => {
    const ct = autodj.player.currentTrack;
    let currentTrack = null;
    if (ct) {
      const basename = ct.filePath ? path.basename(ct.filePath, path.extname(ct.filePath)) : '';
      const videoId = ct.videoId || (basename ? basename.split('_')[0] : null);

      // Parse artist and title from ct.title if present (format: "Artist - Title")
      let artist = 'Unknown';
      let title = ct.title || '';

      if (title.includes(' - ')) {
        const parts = title.split(' - ');
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      } else {
        // fallback to ct.artist if title doesn't contain " - "
        artist = ct.artist || 'Unknown';
      }

      currentTrack = Object.assign({}, ct, {
        videoId,
        artist,
        title,
        name: title, // alias for compatibility
        author: artist, // alias for compatibility
        albumArt: getAlbumArt(artist, title) || null
      });
    }
    res.json({
      mode: autodj.mode,
      currentTrack,
      queueLength: autodj.playbackQueue.length,
      vibe: autodj.currentVibe,
      party: partyMode,
      uptime: Math.floor((Date.now() - autodj.startedAt) / 1000),
    });
  });

  // --- Health endpoint ---
  app.get('/health', (req, res) => {
    const searchEngine = autodj.downloader.searchEngine;
    const playerOk = autodj.player.isPlaying() || !!autodj.player.currentTrack;
    const wsOk = !!autodj.wsConnected;
    const trackCount = searchEngine.index.length;
    const lastRebuild = searchEngine.lastRebuild ? new Date(searchEngine.lastRebuild).toISOString() : null;

    // Count popularity cache entries
    let popularityCached = 0;
    try {
      const popCache = require('./popularity');
      // We can't directly access the cache variable, so count via the module's loadCache
      // Instead, read the cache file
      const cacheFile = path.join(__dirname, 'popularity-cache.json');
      if (fs.existsSync(cacheFile)) {
        const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        popularityCached = Object.keys(data).length;
      }
    } catch {}

    const status = (playerOk && trackCount > 0) ? 'ok' : 'degraded';

    res.json({
      status,
      services: {
        player: playerOk,
        library: {
          tracks: trackCount,
          lastRebuild,
        },
        popularity: {
          cached: popularityCached,
        },
        ws: wsOk,
        uptime: Math.floor((Date.now() - startTime) / 1000),
      },
    });
  });

  app.post('/mode', (req, res) => {
    const { mode } = req.body;
    if (!['BOT', 'ASSIST', 'OVERRIDE'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use BOT, ASSIST, or OVERRIDE.' });
    }
    autodj.setMode(mode);
    res.json({ mode: autodj.mode });
  });

  // --- Skip tracking ---
  app.post('/skip', (req, res) => {
    const ct = autodj.player.currentTrack;

    // Log skip info before stopping
    if (ct) {
      let artist = 'Unknown';
      let title = ct.title || '';
      if (title.includes(' - ')) {
        const parts = title.split(' - ');
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      } else {
        artist = ct.artist || 'Unknown';
      }

      const skipEntry = {
        artist,
        title,
        skippedAt: new Date().toISOString(),
        vibe: autodj.currentVibe ? autodj.currentVibe.name : null,
      };

      try {
        let skips = [];
        if (fs.existsSync(SKIP_LOG_FILE)) {
          skips = JSON.parse(fs.readFileSync(SKIP_LOG_FILE, 'utf8'));
        }
        skips.push(skipEntry);
        fs.writeFileSync(SKIP_LOG_FILE, JSON.stringify(skips, null, 2));
      } catch {}
    }

    autodj.player.stop();
    res.json({ skipped: true });
  });

  // --- Get recent skips ---
  app.get('/skips', (req, res) => {
    try {
      if (fs.existsSync(SKIP_LOG_FILE)) {
        const skips = JSON.parse(fs.readFileSync(SKIP_LOG_FILE, 'utf8'));
        res.json(skips.slice(-50));
      } else {
        res.json([]);
      }
    } catch {
      res.json([]);
    }
  });

  app.post('/vibe', (req, res) => {
    const { vibe } = req.body;
    const validVibes = ['Morning', 'Afternoon', 'Antenna Club', 'Evening', 'Peak Hours', 'Late Night', 'auto', 'clear'];
    if (!validVibes.includes(vibe)) {
      return res.status(400).json({ error: `Invalid vibe. Use one of: ${validVibes.join(', ')}` });
    }
    autodj.overrideVibe(vibe);
    res.json({ vibe: autodj.currentVibe });
  });

  app.post('/queue', async (req, res) => {
    const { query, filePath, title, author, videoId, duration } = req.body;

    // If filePath provided and file exists, inject directly — no re-download needed
    if (filePath && fs.existsSync(filePath)) {
      autodj.playbackQueue.unshift({
        title: title || path.basename(filePath, '.mp3'),
        author: author || 'Guest Request',
        filePath,
        videoId: videoId || null,
        duration: duration || null,
        source: 'request',
      });
      return res.json({ queued: title, position: 0, method: 'direct' });
    }

    if (!query) {
      return res.status(400).json({ error: 'query or filePath is required' });
    }
    try {
      const result = await autodj.downloader.searchAndDownload(query);
      autodj.playbackQueue.unshift({
        title: result.title,
        author: result.author,
        filePath: result.filePath,
        videoId: result.videoId,
        duration: result.duration,
        source: 'api',
      });
      res.json({ queued: result.title, position: 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/queue', (req, res) => {
    res.json({ queue: autodj.playbackQueue });
  });

  app.post('/stop', (req, res) => {
    autodj.player.stop();
    autodj.playbackQueue.length = 0;
    autodj.setMode('OVERRIDE');
    res.json({ stopped: true });
  });

  app.post('/resume', (req, res) => {
    if (autodj.mode === 'OVERRIDE') {
      autodj.setMode(autodj.previousMode || 'BOT');
      res.json({ resumed: true, mode: autodj.mode });
    } else {
      res.json({ resumed: false, mode: autodj.mode, message: 'Not in OVERRIDE mode' });
    }
  });

  // --- Vibe schedule editing API ---
  const { loadVibeConfig, saveVibeConfig } = require('./vibe-schedules');

  app.get('/vibes', (req, res) => {
    const config = loadVibeConfig();
    res.json(config);
  });

  app.post('/vibes', (req, res) => {
    const config = req.body;
    if (!config || !Array.isArray(config.schedules)) {
      return res.status(400).json({ error: 'Config must have a schedules array' });
    }
    for (const s of config.schedules) {
      if (typeof s.startHour !== 'number' || typeof s.endHour !== 'number' || !s.name || !Array.isArray(s.tags)) {
        return res.status(400).json({ error: 'Each schedule must have startHour (number), endHour (number), name (string), and tags (array)' });
      }
    }
    saveVibeConfig(config);
    res.json(loadVibeConfig());
  });

  app.post('/vibes/:name/tags', (req, res) => {
    const { name } = req.params;
    const { add, remove } = req.body;
    const config = loadVibeConfig();
    const schedule = config.schedules.find(s => s.name === name);
    if (!schedule) {
      return res.status(404).json({ error: `Vibe "${name}" not found` });
    }
    if (add && Array.isArray(add)) {
      for (const tag of add) {
        if (!schedule.tags.includes(tag)) {
          schedule.tags.push(tag);
        }
      }
    }
    if (remove && Array.isArray(remove)) {
      schedule.tags = schedule.tags.filter(t => !remove.includes(t));
    }
    saveVibeConfig(config);
    res.json(loadVibeConfig());
  });

  return app;
}

module.exports = { createAPI };

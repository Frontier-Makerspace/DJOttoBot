const express = require('express');

function createAPI(autodj) {
  const app = express();
  app.use(express.json());

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

    console.log(`[Party] ${partyMode.active ? 'ACTIVE' : 'OFF'}: "${partyMode.name}" ${partyMode.startTime || ''}-${partyMode.endTime || ''}`);
    res.json(partyMode);
  });

  app.get('/status', (req, res) => {
    const ct = autodj.player.currentTrack;
    let currentTrack = null;
    if (ct) {
      const path = require('path');
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
        author: artist // alias for compatibility
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

  app.post('/mode', (req, res) => {
    const { mode } = req.body;
    if (!['BOT', 'ASSIST', 'OVERRIDE'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use BOT, ASSIST, or OVERRIDE.' });
    }
    autodj.setMode(mode);
    res.json({ mode: autodj.mode });
  });

  app.post('/skip', (req, res) => {
    autodj.player.stop();
    res.json({ skipped: true });
  });

  app.post('/vibe', (req, res) => {
    const { vibe } = req.body;
    const validVibes = ['Morning', 'Afternoon', 'Evening', 'Peak Hours', 'Late Night'];
    if (!validVibes.includes(vibe)) {
      return res.status(400).json({ error: `Invalid vibe. Use one of: ${validVibes.join(', ')}` });
    }
    autodj.overrideVibe(vibe);
    res.json({ vibe: autodj.currentVibe });
  });

  app.post('/queue', async (req, res) => {
    const { query, filePath, title, author, videoId, duration } = req.body;

    // If filePath provided and file exists, inject directly — no re-download needed
    if (filePath && require('fs').existsSync(filePath)) {
      autodj.playbackQueue.unshift({
        title: title || require('path').basename(filePath, '.mp3'),
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

  return app;
}

module.exports = { createAPI };

const express = require('express');

function createAPI(autodj) {
  const app = express();
  app.use(express.json());

  app.get('/status', (req, res) => {
    const ct = autodj.player.currentTrack;
    let currentTrack = null;
    if (ct) {
      const path = require('path');
      const basename = ct.filePath ? path.basename(ct.filePath, path.extname(ct.filePath)) : '';
      const videoId = ct.videoId || (basename ? basename.split('_')[0] : null);
      currentTrack = Object.assign({}, ct, { videoId });
    }
    res.json({
      mode: autodj.mode,
      currentTrack,
      queueLength: autodj.playbackQueue.length,
      vibe: autodj.currentVibe,
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

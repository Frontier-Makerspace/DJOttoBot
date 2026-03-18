const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static('public'));

// --- Queue (in-memory) ---
const queue = [];

// --- Find yt-dlp ---
function findYtDlp() {
  try {
    return execSync('which yt-dlp', { encoding: 'utf-8' }).trim();
  } catch {
    const candidates = [
      '/opt/homebrew/bin/yt-dlp',
      path.join(os.homedir(), 'Library/Python/3.12/bin/yt-dlp'),
      path.join(os.homedir(), 'Library/Python/3.11/bin/yt-dlp'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    console.warn('yt-dlp not found — downloads will fail');
    return 'yt-dlp';
  }
}

const YT_DLP = findYtDlp();
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const OUTPUT_DIR = path.join(os.homedir(), 'Music', 'MP3');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log(`yt-dlp: ${YT_DLP}`);
console.log(`Output: ${OUTPUT_DIR}`);

// --- WebSocket ---
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  // Send current queue on connect
  ws.send(JSON.stringify({ type: 'queue', queue }));
});

// --- Routes ---

// Guest UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// DJ UI
app.get('/dj', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dj.html'));
});

// YouTube search via yt-dlp
app.get('/api/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);

  const args = [
    `ytsearch10:${q}`,
    '--dump-json',
    '--no-download',
    '--quiet',
    '--no-warnings',
  ];

  const proc = spawn(YT_DLP, args);
  let output = '';
  let errOutput = '';

  proc.stdout.on('data', (d) => { output += d.toString(); });
  proc.stderr.on('data', (d) => { errOutput += d.toString(); });

  proc.on('close', (code) => {
    try {
      const results = output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const d = JSON.parse(line);
          return {
            videoId: d.id,
            title: d.title,
            author: d.uploader || d.channel || '',
            duration: d.duration || 0,
            thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
          };
        });
      res.json(results);
    } catch (err) {
      console.error('Search parse error:', err.message, errOutput);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  proc.on('error', (err) => {
    console.error('yt-dlp spawn error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  });
});

// Submit request
app.post('/api/request', (req, res) => {
  const { videoId, title, author, duration, thumbnail, guestName } = req.body;
  if (!videoId || !title || !guestName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const item = {
    id: uuidv4(),
    videoId,
    title,
    author: author || 'Unknown',
    duration: duration || 0,
    thumbnail: thumbnail || '',
    guestName,
    status: 'pending',
    requestedAt: new Date().toISOString(),
  };

  queue.push(item);
  broadcast({ type: 'new_request', item });
  res.json({ success: true, id: item.id });
});

// Approve request
app.post('/api/approve/:id', (req, res) => {
  const item = queue.find((r) => r.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

  item.status = 'downloading';
  broadcast({ type: 'status_update', id: item.id, status: 'downloading', progress: 0 });

  // Start download
  const outputTemplate = path.join(OUTPUT_DIR, '%(title)s.%(ext)s');
  const videoUrl = `https://www.youtube.com/watch?v=${item.videoId}`;

  const proc = spawn(YT_DLP, [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--ffmpeg-location', FFMPEG,
    '--newline',
    '-o', outputTemplate,
    videoUrl,
  ]);

  proc.stdout.on('data', (data) => {
    const line = data.toString();
    const match = line.match(/(\d+\.?\d*)%/);
    if (match) {
      const progress = parseFloat(match[1]);
      broadcast({ type: 'status_update', id: item.id, status: 'downloading', progress });
    }
  });

  proc.stderr.on('data', (data) => {
    console.error(`yt-dlp stderr: ${data}`);
  });

  proc.on('close', (code) => {
    if (code === 0) {
      item.status = 'done';
      broadcast({ type: 'status_update', id: item.id, status: 'done', progress: 100 });
      console.log(`Downloaded: ${item.title}`);
    } else {
      item.status = 'error';
      broadcast({ type: 'status_update', id: item.id, status: 'error', progress: 0 });
      console.error(`Download failed for: ${item.title} (exit code ${code})`);
    }
  });

  res.json({ success: true });
});

// Reject request
app.post('/api/reject/:id', (req, res) => {
  const item = queue.find((r) => r.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

  item.status = 'rejected';
  broadcast({ type: 'status_update', id: item.id, status: 'rejected' });
  res.json({ success: true });
});

// Get queue
app.get('/api/queue', (req, res) => {
  res.json(queue);
});

// --- Start ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`DJ Request App running on http://localhost:${PORT}`);
  console.log(`Guest UI: http://localhost:${PORT}/`);
  console.log(`DJ Panel: http://localhost:${PORT}/dj`);
});

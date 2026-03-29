const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// QR code endpoint
app.get('/api/qr', async (req, res) => {
  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const dataUrl = await QRCode.toDataURL(url, {
      width: 200,
      margin: 1,
      color: { dark: '#ffffff', light: '#00000000' }
    });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connected browser clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// Connect to upstream WebSocket sources
function connectUpstream(url, label) {
  let ws;
  function connect() {
    ws = new WebSocket(url);
    ws.on('open', () => console.log(`Connected to ${label} (${url})`));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'nowPlaying' || msg.type === 'request' || msg.type === 'queue'
            || msg.type === 'otto_roast' || msg.type === 'vibe_shift') {
          broadcast(msg);
        }
      } catch (e) { /* ignore non-JSON */ }
    });
    ws.on('close', () => {
      console.log(`Disconnected from ${label}, reconnecting in 3s...`);
      setTimeout(connect, 3000);
    });
    ws.on('error', () => {
      ws.close();
    });
  }
  connect();
}

connectUpstream('ws://localhost:3000', 'dj-request-app');
connectUpstream('ws://localhost:3001', 'autodj');

// Fallback poll at 30s in case WS messages are missed
// Primary path is the upstream WebSocket 'nowPlaying' events above
setInterval(async () => {
  try {
    const res = await fetch('http://localhost:3001/status');
    const status = await res.json();
    if (status.currentTrack) {
      const ct = status.currentTrack;
      broadcast({
        type: 'nowPlaying',
        title: ct.title || ct.name,
        author: ct.author || ct.artist || ct.author,
        album: ct.album || null,
        year: ct.year || null,
        genre: ct.genre || null,
        albumArt: ct.albumArt || null,
        vibe: status.vibe && status.vibe.name,
        mode: status.mode,
        videoId: ct.videoId,
        bpm: ct.bpm,
        startedAt: ct.startedAt,
        duration: ct.duration,
      });
    }
  } catch (e) { /* autodj not available */ }
}, 30000);

const PORT = 3002;
server.listen(PORT, () => {
  console.log(`Visualizer running on http://localhost:${PORT}`);
});

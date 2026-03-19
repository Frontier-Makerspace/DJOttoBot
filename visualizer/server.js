const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
        if (msg.type === 'nowPlaying' || msg.type === 'request' || msg.type === 'queue') {
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

// Poll autodj status as fallback
setInterval(async () => {
  try {
    const res = await fetch('http://localhost:3001/status');
    const status = await res.json();
    if (status.currentTrack) {
      broadcast({
        type: 'nowPlaying',
        title: status.currentTrack.title || status.currentTrack.name,
        author: status.currentTrack.author || status.currentTrack.artist,
        vibe: status.vibe,
        mode: status.mode
      });
    }
  } catch (e) { /* autodj not available */ }
}, 5000);

const PORT = 3002;
server.listen(PORT, () => {
  console.log(`Visualizer running on http://localhost:${PORT}`);
});

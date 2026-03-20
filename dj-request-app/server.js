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

// --- Recent requests for pattern detection (Feature 4) ---
const recentRequests = [];
const MAX_RECENT = 5;

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

// --- Ollama helper ---
async function ollamaChat(systemPrompt, userMsg, numPredict = 80) {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3.2',
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ],
      options: { num_predict: numPredict }
    })
  });
  const data = await res.json();
  return (data.message && data.message.content || '').trim();
}

// --- Feature 3: Vibe check + roast ---
async function checkVibeAndRoast(item) {
  try {
    const statusRes = await fetch('http://localhost:3001/status');
    const status = await statusRes.json();
    const vibe = status.vibe;
    if (!vibe) return;

    const vibeName = vibe.name || 'unknown';
    const vibeQueries = (vibe.queries || []).join(', ');

    const checkAnswer = await ollamaChat(
      'You are a music expert. Reply with exactly YES or NO, nothing else.',
      `Is the song "${item.title}" by "${item.author}" consistent with the vibe "${vibeName}" which focuses on: ${vibeQueries}?`
    );

    if (checkAnswer.toUpperCase().startsWith('NO')) {
      // Generate roast
      const roast = await ollamaChat(
        'You are DJ Otto, the AI DJ at PROTO7YPE makerspace. You are funny, sarcastic, and cool. Keep replies to 1-2 sentences max. Do not break character.',
        `Someone named ${item.guestName} just requested "${item.title}" by "${item.author}" but the current vibe is ${vibeName}. Roast their request in a funny, playful way.`
      );
      broadcast({ type: 'otto_roast', reply: roast, guestName: item.guestName });
      console.log(`[Roast] ${item.guestName}: ${roast}`);
    }
  } catch (err) {
    console.error('Vibe check error:', err.message);
  }
}

// --- Feature 4: Pattern detection + auto vibe shift ---
const GENRE_TO_VIBE = {
  'darkwave': 'Evening', 'goth': 'Evening', 'industrial': 'Evening', 'ebm': 'Evening',
  'gothic': 'Evening', 'coldwave': 'Evening', 'synthwave': 'Evening',
  'house': 'Afternoon', 'disco': 'Afternoon', 'dance': 'Afternoon', 'funk': 'Afternoon',
  'pop': 'Afternoon', 'soul': 'Afternoon', 'funky': 'Afternoon',
  'ambient': 'Morning', 'chill': 'Morning', 'lofi': 'Morning', 'lo-fi': 'Morning',
  'jazz': 'Morning', 'acoustic': 'Morning', 'downtempo': 'Morning', 'beats': 'Morning',
  'techno': 'Peak Hours', 'hard': 'Peak Hours', 'aggrotech': 'Peak Hours',
  'metal': 'Peak Hours', 'hardcore': 'Peak Hours', 'trance': 'Peak Hours',
};

function detectVibeFromGenre(genre) {
  const g = (genre || '').toLowerCase();
  for (const [key, vibe] of Object.entries(GENRE_TO_VIBE)) {
    if (g.includes(key)) return vibe;
  }
  return null;
}

let vibeShiftInProgress = false;

async function checkPatternAndShiftVibe() {
  if (recentRequests.length < 3 || vibeShiftInProgress) return;
  vibeShiftInProgress = true;
  try {
    const songList = recentRequests.slice(-5).map(r => `"${r.title}" by ${r.author}`).join(', ');
    const genre = await ollamaChat(
      'You are a music expert. Reply with exactly ONE word: the genre that best fits the list of songs.',
      `What genre are these songs: ${songList}?`,
      20
    );

    const targetVibe = detectVibeFromGenre(genre);
    if (!targetVibe) { vibeShiftInProgress = false; return; }

    // Check current vibe
    const statusRes = await fetch('http://localhost:3001/status');
    const status = await statusRes.json();
    const currentVibeName = status.vibe && status.vibe.name;
    if (currentVibeName === targetVibe) { vibeShiftInProgress = false; return; }

    // Shift vibe
    await fetch('http://localhost:3001/vibe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vibe: targetVibe })
    });

    broadcast({
      type: 'vibe_shift',
      newVibe: targetVibe,
      reason: `Guest requests suggest ${genre} vibes`,
    });
    console.log(`[Vibe Shift] Detected ${genre} → ${targetVibe}`);
  } catch (err) {
    console.error('Pattern detection error:', err.message);
  }
  vibeShiftInProgress = false;
}

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

  // Feature 3: Vibe check + roast (async, non-blocking)
  checkVibeAndRoast(item).catch(() => {});

  // Auto-approve if AutoDJ is in BOT mode
  (async () => {
    try {
      const statusRes = await fetch('http://localhost:3001/status');
      const status = await statusRes.json();
      if (status.mode === 'BOT') {
        // Trigger approve flow after a short delay
        setTimeout(() => {
          // Find and trigger the download
          item.status = 'downloading';
          broadcast({ type: 'status_update', id: item.id, status: 'downloading', progress: 0 });
          const outputTemplate = path.join(OUTPUT_DIR, '%(title)s.%(ext)s');
          const videoUrl = 'https://www.youtube.com/watch?v=' + item.videoId;
          const proc = spawn(YT_DLP, ['-x', '--audio-format', 'mp3', '--audio-quality', '0',
            '--ffmpeg-location', FFMPEG, '--newline', '-o', outputTemplate, videoUrl]);
          proc.stdout.on('data', (data) => {
            const match = data.toString().match(/(\d+\.?\d*)%/);
            if (match) broadcast({ type: 'status_update', id: item.id, status: 'downloading', progress: parseFloat(match[1]) });
          });
          proc.on('close', (code) => {
            item.status = code === 0 ? 'done' : 'error';
            broadcast({ type: 'status_update', id: item.id, status: item.status, progress: code === 0 ? 100 : 0 });
            if (code === 0) {
              // Track for pattern detection (Feature 4)
              recentRequests.push({ title: item.title, author: item.author });
              if (recentRequests.length > MAX_RECENT) recentRequests.shift();
              // Check if we should shift vibe (when 3+ of 5 suggest a genre)
              if (recentRequests.length >= 3) checkPatternAndShiftVibe().catch(() => {});

              // Tell AutoDJ to queue this track
              fetch('http://localhost:3001/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: item.title, videoId: item.videoId, title: item.title,
                  author: item.author, duration: item.duration })
              }).catch(() => {});
            }
          });
        }, 500);
      }
    } catch {}
  })();

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
      // Track for pattern detection
      recentRequests.push({ title: item.title, author: item.author });
      if (recentRequests.length > MAX_RECENT) recentRequests.shift();
      if (recentRequests.length >= 3) checkPatternAndShiftVibe().catch(() => {});
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


// --- DJ Otto Chat (Ollama / llama3.2) ---
app.post('/api/otto', express.json(), async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message' });

  let nowPlaying = 'something groovy';
  try {
    const statusRes = await fetch('http://localhost:3001/status');
    const status = await statusRes.json();
    if (status.currentTrack && status.currentTrack.title) nowPlaying = status.currentTrack.title;
  } catch {}

  const pendingCount = queue.filter(r => r.status === 'pending').length;

  const systemPrompt = 'You are DJ Otto, the AI DJ at PROTO7YPE makerspace. You are cool, energetic, and concise. Right now you are playing: "' + nowPlaying + '". There are ' + pendingCount + ' requests in the queue. Keep replies very short (1-3 sentences max). Talk about music, the vibe, what is playing, or just be fun. Never break character.';

  try {
    const reply = await ollamaChat(systemPrompt, message, 100);
    const finalReply = reply || "Vibing too hard to respond right now 🎧";
    res.json({ reply: finalReply });
    broadcast({ type: 'otto_reply', reply: finalReply });
  } catch (e) {
    res.json({ reply: 'Lost the signal — try again! 🎵' });
  }
});

// --- Start ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`DJ Request App running on http://localhost:${PORT}`);
});

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

// --- Queue (in-memory, with pruning + persistence) ---
const queue = [];
const QUEUE_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const QUEUE_PRUNE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const QUEUE_STATE_FILE = path.join(__dirname, 'queue-state.json');

// Prune completed/rejected/error items older than QUEUE_MAX_AGE_MS
function pruneQueue() {
  const now = Date.now();
  const terminalStatuses = new Set(['done', 'rejected', 'error']);
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if (terminalStatuses.has(item.status)) {
      const age = now - new Date(item.requestedAt).getTime();
      if (age > QUEUE_MAX_AGE_MS) {
        queue.splice(i, 1);
      }
    }
  }
}
setInterval(pruneQueue, QUEUE_PRUNE_INTERVAL_MS);

// --- Queue persistence ---
let saveQueueTimer = null;
function saveQueueDebounced() {
  if (saveQueueTimer) return;
  saveQueueTimer = setTimeout(() => {
    saveQueueTimer = null;
    try {
      fs.writeFileSync(QUEUE_STATE_FILE, JSON.stringify(queue, null, 2));
    } catch (err) {
      console.error('Failed to save queue state:', err.message);
    }
  }, 2000);
}

// Load persisted queue on startup
function loadQueue() {
  try {
    if (!fs.existsSync(QUEUE_STATE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(QUEUE_STATE_FILE, 'utf-8'));
    if (!Array.isArray(data)) return;
    const now = Date.now();
    for (const item of data) {
      const age = now - new Date(item.requestedAt).getTime();
      if (age < QUEUE_MAX_AGE_MS) {
        queue.push(item);
      }
    }
    console.log(`[Queue] Restored ${queue.length} items from disk (pruned ${data.length - queue.length} old)`);
  } catch (err) {
    console.error('Failed to load queue state:', err.message);
  }
}
loadQueue();

// --- Search Cache ---
const searchCache = new Map();
const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
function getCached(q) {
  const hit = searchCache.get(q);
  if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL) return hit.results;
  return null;
}
function setCache(q, results) {
  searchCache.set(q, { results, ts: Date.now() });
  // Keep cache small
  if (searchCache.size > 50) {
    const oldest = [...searchCache.entries()].sort((a,b) => a[1].ts - b[1].ts)[0];
    searchCache.delete(oldest[0]);
  }
}

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
const LIBRARY_DIR = path.join(os.homedir(), 'Music', 'Library', 'Darren');

// Ensure output directories exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(LIBRARY_DIR)) {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
}

console.log(`yt-dlp: ${YT_DLP}`);
console.log(`Output: ${OUTPUT_DIR}`);

// --- Ollama availability check ---
let ollamaAvailable = false;
async function checkOllama() {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { timeout: 3000 });
    ollamaAvailable = res.ok;
  } catch {
    ollamaAvailable = false;
  }
  console.log(`[Ollama] ${ollamaAvailable ? 'Available' : 'Not available — vibe checks disabled'}`);
}
checkOllama();
// Re-check every 5 minutes
setInterval(checkOllama, 5 * 60 * 1000);

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
  if (!ollamaAvailable) return '';

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

// --- Shared download + queue function ---
// Extracts the duplicated download logic into one place
function sanitizeTitle(title, videoId) {
  return (title || videoId || 'track').replace(/[^a-zA-Z0-9_\- ]/g, '').substring(0, 80);
}

// Find the most recently modified .mp3 file in a directory
function findLatestMp3(dir, maxAgeMs = 30000) {
  try {
    const now = Date.now();
    let latest = null;
    let latestMtime = 0;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.mp3')) continue;
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      const age = now - stat.mtimeMs;
      if (age <= maxAgeMs && stat.mtimeMs > latestMtime) {
        latest = fullPath;
        latestMtime = stat.mtimeMs;
      }
    }
    return latest;
  } catch (err) {
    console.error('findLatestMp3 error:', err.message);
    return null;
  }
}

function downloadAndQueue(item) {
  item.status = 'downloading';
  saveQueueDebounced();
  broadcast({ type: 'status_update', id: item.id, status: 'downloading', progress: 0 });

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
    const match = data.toString().match(/(\d+\.?\d*)%/);
    if (match) {
      broadcast({ type: 'status_update', id: item.id, status: 'downloading', progress: parseFloat(match[1]) });
    }
  });

  proc.stderr.on('data', (data) => {
    console.error(`yt-dlp stderr: ${data}`);
  });

  proc.on('close', (code) => {
    if (code === 0) {
      item.status = 'done';
      saveQueueDebounced();
      broadcast({ type: 'status_update', id: item.id, status: 'done', progress: 100 });
      console.log(`Downloaded: ${item.title}`);

      // Track for pattern detection (Feature 4)
      recentRequests.push({ title: item.title, author: item.author });
      if (recentRequests.length > MAX_RECENT) recentRequests.shift();
      if (recentRequests.length >= 3) checkPatternAndShiftVibe().catch(() => {});

      // Find the actual downloaded file (yt-dlp may use a different filename than we'd guess)
      const actualPath = findLatestMp3(OUTPUT_DIR, 30000);
      const safeTitle = sanitizeTitle(item.title, item.videoId);
      let filePath = actualPath || path.join(OUTPUT_DIR, `${safeTitle}.mp3`);

      // Move downloaded file to library folder
      try {
        const destPath = path.join(LIBRARY_DIR, path.basename(filePath));
        fs.renameSync(filePath, destPath);
        filePath = destPath;
        console.log(`Moved to library: ${destPath}`);
      } catch (moveErr) {
        console.warn(`Could not move to library (queuing from original location): ${moveErr.message}`);
      }

      item.filePath = filePath;
      fetch('http://localhost:3001/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          author: item.author,
          videoId: item.videoId,
          duration: item.duration,
          filePath,
          query: item.title,
        })
      }).then(() => console.log(`Queued in AutoDJ: ${item.title}`))
        .catch(err => console.error(`AutoDJ queue failed: ${err.message}`));
    } else {
      item.status = 'error';
      saveQueueDebounced();
      broadcast({ type: 'status_update', id: item.id, status: 'error', progress: 0 });
      console.error(`Download failed for: ${item.title} (exit code ${code})`);
    }
  });

  proc.on('error', (err) => {
    item.status = 'error';
    saveQueueDebounced();
    broadcast({ type: 'status_update', id: item.id, status: 'error', progress: 0 });
    console.error(`yt-dlp spawn error for ${item.title}: ${err.message}`);
  });
}

// --- Feature 3: Vibe check + roast/reject ---
async function checkVibeAndRoast(item) {
  if (!ollamaAvailable) return;

  try {
    const statusRes = await fetch('http://localhost:3001/status');
    const status = await statusRes.json();
    const vibe = status.vibe;
    if (!vibe) return;

    const vibeName = vibe.name || 'unknown';

    // Fetch actual vibe schedule to get definitive tag list
    let vibeTags = [];
    try {
      const vibesRes = await fetch('http://localhost:3001/vibes');
      const vibesConfig = await vibesRes.json();
      if (vibesConfig && Array.isArray(vibesConfig.schedules)) {
        const currentSchedule = vibesConfig.schedules.find(s => s.name === vibeName);
        if (currentSchedule && Array.isArray(currentSchedule.tags)) {
          vibeTags = currentSchedule.tags;
        }
      }
    } catch (err) {
      console.error('Failed to fetch vibe tags:', err.message);
    }

    const vibeTagList = vibeTags.length > 0 ? vibeTags.join(', ') : 'unknown';

    // Hardcoded reject patterns — no LLM needed for obvious cases
    const ALWAYS_REJECT = [
      /baby shark/i, /pinkfong/i, /barney/i, /teletubbies/i, /cocomelon/i,
      /minecraft/i, /roblox/i, /fortnite/i, /macarena/i, /gangnam style/i,
      /cotton eye joe/i, /what does the fox say/i, /friday.*rebecca black/i,
      /call me maybe/i, /we built this city/i, /rock lobster/i,
      /chicken dance/i, /hokey cokey/i, /ymca/i, /party rock/i, /lmfao/i,
    ];
    const titleAndArtist = `${item.title} ${item.author}`;
    if (ALWAYS_REJECT.some(r => r.test(titleAndArtist))) {
      const hardReject = `I don't know who told ${item.guestName} this was acceptable, but "${item.title}" has been confiscated and destroyed. The DJ booth is a sacred space.`;
      broadcast({ type: 'otto_roast', reply: `❌ REJECTED — ${hardReject}`, guestName: item.guestName });
      broadcast({ type: 'status_update', id: item.id, status: 'rejected' });
      // FIX: use `queue` not `pendingQueue` (which didn't exist)
      const idx = queue.findIndex(q => q.id === item.id);
      if (idx !== -1) queue[idx].status = 'rejected';
      item.status = 'rejected';
      saveQueueDebounced();
      console.log(`[Hard Reject] ${item.title}`);
      return;
    }

    // Three-way decision: PLAY / ROAST / REJECT
    const checkAnswer = await ollamaChat(
      `You are a strict music vibe guardian. You must reply with EXACTLY one word: PLAY, ROAST, or REJECT. Current vibe: ${vibeName}. This vibe plays: ${vibeTagList}. REJECT any song that is not closely related to the genres and artists in that tag list. Pop, rock, hip-hop, country, R&B, classic rock, Afrobeats, Eurodance are automatic REJECT unless the artist is specifically in the tag list. If in doubt, REJECT. ONE WORD ONLY.`,
      `Song: "${item.title}" by "${item.author}". Is this artist in the tag list or closely related to the tagged genres? ONE WORD: PLAY, ROAST, or REJECT?`
    );

    // Parse decision robustly
    let decision = 'PLAY';
    const upper = checkAnswer.trim().toUpperCase();
    if (upper.includes('REJECT')) decision = 'REJECT';
    else if (upper.includes('ROAST')) decision = 'ROAST';
    else if (upper.includes('PLAY')) decision = 'PLAY';
    console.log(`[Vibe Check] ${item.title} → ${decision} (raw: "${checkAnswer.trim()}")`);

    if (decision === 'REJECT') {
      // FIX: use `queue` not `pendingQueue`
      const idx = queue.findIndex(q => q.id === item.id);
      if (idx !== -1) queue[idx].status = 'rejected';
      item.status = 'rejected';
      saveQueueDebounced();

      const roast = await ollamaChat(
        'You are DJ Otto, the most ruthless DJ in San Francisco. You have spent 20 years cultivating the perfect taste in music and you have ZERO patience for people who waste it. When someone requests something that ruins the vibe, you eviscerate them publicly and without mercy. Be savage, specific, and personal. No mercy, no softening. 1-2 sentences, end on the kill shot.',
        `Someone named ${item.guestName} just committed a CRIME against music by requesting "${item.title}" by "${item.author}" in the middle of a ${vibeName} set. This request has been REJECTED. Destroy them publicly. Be brutal.`
      );

      broadcast({ type: 'otto_roast', reply: `❌ REJECTED — ${roast}`, guestName: item.guestName });
      broadcast({ type: 'status_update', id: item.id, status: 'rejected' });
      console.log(`[Rejected] ${item.guestName}: ${item.title} — ${roast}`);

    } else if (decision === 'ROAST') {
      // Play it but shame them
      const roast = await ollamaChat(
        'You are DJ Otto, the most ruthless DJ in San Francisco. You have spent 20 years cultivating the perfect taste in music and you have ZERO patience for people who waste it. When someone requests something that ruins the vibe, you eviscerate them publicly and without mercy. Be savage, specific, and personal. Reference their terrible taste directly. No mercy, no softening, no "but hey". 1-2 sentences, end on the kill shot.',
        `Someone named ${item.guestName} just committed a crime against music by requesting "${item.title}" by "${item.author}" in the middle of a ${vibeName} set. Destroy them. Be specific about why this request is an abomination. No mercy.`
      );
      broadcast({ type: 'otto_roast', reply: roast, guestName: item.guestName });
      console.log(`[Roast] ${item.guestName}: ${roast}`);
    }
    // PLAY = do nothing, let it queue normally

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
  if (!ollamaAvailable) return;

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

  // Check cache first
  const cached = getCached(q);
  if (cached) return res.json(cached);

  const args = [
    `ytsearch5:${q}`,
    '--dump-json',
    '--no-download',
    '--quiet',
    '--no-warnings',
    '--socket-timeout', '5',
  ];

  const proc = spawn(YT_DLP, args);
  
  // 8 second timeout — return what we have
  const searchTimeout = setTimeout(() => {
    if (!proc.killed) {
      proc.kill();
    }
  }, 8000);
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
      setCache(q, results);
      res.json(results);
    } catch (err) {
      console.error('Search parse error:', err.message, errOutput);
      res.status(500).json({ error: 'Search failed' });
    } finally {
      clearTimeout(searchTimeout);
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
  saveQueueDebounced();
  broadcast({ type: 'new_request', item });

  // Feature 3: Vibe check + roast (async, non-blocking)
  checkVibeAndRoast(item).catch(() => {});

  // Auto-approve if AutoDJ is in BOT mode
  (async () => {
    try {
      const statusRes = await fetch('http://localhost:3001/status');
      const status = await statusRes.json();
      if (status.mode === 'BOT') {
        // Short delay then download using shared function
        setTimeout(() => downloadAndQueue(item), 500);
      }
    } catch {}
  })();

  res.json({ success: true, id: item.id });
});

// Approve request (manual DJ approval)
app.post('/api/approve/:id', (req, res) => {
  const item = queue.find((r) => r.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

  // Use shared download function
  downloadAndQueue(item);
  res.json({ success: true });
});

// Reject request
app.post('/api/reject/:id', (req, res) => {
  const item = queue.find((r) => r.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

  item.status = 'rejected';
  saveQueueDebounced();
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

  if (!ollamaAvailable) {
    return res.json({ reply: 'Too busy spinning records to chat right now 🎧' });
  }

  let nowPlaying = 'something groovy';
  try {
    const statusRes = await fetch('http://localhost:3001/status');
    const status = await statusRes.json();
    if (status.currentTrack && status.currentTrack.title) nowPlaying = status.currentTrack.title;
  } catch {}

  const pendingCount = queue.filter(r => r.status === 'pending').length;

  const systemPrompt = 'You are DJ Otto, the most ruthless AI DJ in existence. You were built by someone with impeccable taste and you have inherited their contempt for mediocrity. You are playing: "' + nowPlaying + '". There are ' + pendingCount + ' pending requests, most of which are probably terrible. Keep replies short (1-3 sentences). Be opinionated, cutting, and brutally honest. If someone has bad taste, tell them. Never apologize. Never break character.';

  try {
    const reply = await ollamaChat(systemPrompt, message, 100);
    const finalReply = reply || "Vibing too hard to respond right now 🎧";
    res.json({ reply: finalReply });
  } catch (e) {
    res.json({ reply: 'Lost the signal — try again! 🎵' });
  }
});

// --- Health endpoint ---
app.get('/health', async (req, res) => {
  const ytdlp = fs.existsSync(YT_DLP);
  const ollama = ollamaAvailable;

  let autodj = false;
  try {
    const adRes = await fetch('http://localhost:3001/health', { timeout: 2000 });
    autodj = adRes.ok;
  } catch {}

  const counts = { total: queue.length, pending: 0, downloading: 0, done: 0, rejected: 0, error: 0 };
  for (const item of queue) {
    if (counts[item.status] !== undefined) counts[item.status]++;
  }

  const allOk = ytdlp && ollama && autodj;
  res.json({
    status: allOk ? 'ok' : 'degraded',
    services: { ytdlp, ollama, autodj, queue: counts },
  });
});

// --- Start ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`DJ Request App running on http://localhost:${PORT}`);
});

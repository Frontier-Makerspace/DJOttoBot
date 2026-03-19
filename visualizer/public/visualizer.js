// ─── PROTO7YPE Visualizer — Waterfall Edition ───────────────────────────────

(() => {
  const canvas = document.getElementById('visualizer-canvas');
  const ctx = canvas.getContext('2d');
  const titleEl = document.getElementById('track-title');
  const artistEl = document.getElementById('track-artist');
  const vibeBadge = document.getElementById('vibe-badge');
  const modeIndicator = document.getElementById('mode-indicator');
  const clockEl = document.getElementById('clock');
  const toastEl = document.getElementById('request-toast');
  const venueEl = document.getElementById('venue-name');

  // ─── State ──────────────────────────────────────────────────────────────────
  let currentVibe = 'Afternoon';
  let currentTitle = '';
  let audioReactive = false;
  let analyser = null;
  let dataArray = null;

  // Waterfall: offscreen buffer we scroll
  let waterfallCanvas = document.createElement('canvas');
  let wtx = waterfallCanvas.getContext('2d');

  const VIBE_PALETTES = {
    'Late Night':  [[0,0,0],    [30,0,80],   [120,0,180], [180,0,100], [255,0,60]],
    'Morning':     [[0,0,0],    [0,20,60],   [0,80,160],  [0,180,220], [0,255,200]],
    'Afternoon':   [[0,0,0],    [0,40,40],   [0,140,140], [0,220,200], [0,255,204]],
    'Evening':     [[0,0,0],    [40,0,40],   [120,0,80],  [200,0,60],  [255,0,60]],
    'Peak Hours':  [[0,0,0],    [60,0,0],    [180,20,0],  [255,100,0], [255,220,0]],
  };

  function getPalette() {
    return VIBE_PALETTES[currentVibe] || VIBE_PALETTES['Afternoon'];
  }

  // Map 0-255 intensity to palette color
  function intensityToColor(v) {
    const palette = getPalette();
    const t = v / 255 * (palette.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    const c0 = palette[Math.min(i, palette.length - 1)];
    const c1 = palette[Math.min(i + 1, palette.length - 1)];
    const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
    const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
    const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
    return [r, g, b];
  }

  // ─── Canvas resize ──────────────────────────────────────────────────────────
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    waterfallCanvas.width = canvas.width;
    waterfallCanvas.height = canvas.height;
    wtx.fillStyle = 'black';
    wtx.fillRect(0, 0, waterfallCanvas.width, waterfallCanvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  // ─── Clock ──────────────────────────────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    clockEl.textContent =
      String(now.getHours()).padStart(2,'0') + ':' +
      String(now.getMinutes()).padStart(2,'0');
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ─── Venue name glitch ──────────────────────────────────────────────────────
  const VENUE_TEXT = 'PROTO7YPE';
  const GLITCH_CHARS = ['█','▓','░','▒','╳','◼'];

  function glitchVenue() {
    const chars = VENUE_TEXT.split('');
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      chars[Math.floor(Math.random() * chars.length)] =
        GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
    }
    venueEl.textContent = chars.join('');
    setTimeout(() => { venueEl.textContent = VENUE_TEXT; }, 120);
  }
  (function scheduleGlitch() {
    setTimeout(() => { glitchVenue(); scheduleGlitch(); }, 8000 + Math.random() * 7000);
  })();

  // ─── Track change ───────────────────────────────────────────────────────────
  function setTrack(title, artist) {
    if (title === currentTitle) return;
    currentTitle = title;
    titleEl.classList.add('fade-out');
    artistEl.classList.add('fade-out');
    setTimeout(() => {
      titleEl.textContent = title || '';
      artistEl.textContent = artist || '';
      titleEl.classList.remove('fade-out');
      titleEl.classList.add('fade-in');
      artistEl.classList.add('fade-in');
      void titleEl.offsetWidth;
      titleEl.classList.remove('fade-in');
      artistEl.classList.remove('fade-in');
    }, 400);
    triggerGlitch();
  }

  // ─── Request toast ──────────────────────────────────────────────────────────
  let toastTimeout = null;
  function showToast(guestName, title) {
    toastEl.textContent = `🎵 ${guestName} requested ${title}`;
    toastEl.classList.add('active');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.classList.remove('active'), 4000);
  }

  // ─── WebSocket ──────────────────────────────────────────────────────────────
  function connectWS() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'nowPlaying') {
          setTrack(msg.title, msg.author);
          if (msg.vibe) { currentVibe = msg.vibe; vibeBadge.textContent = msg.vibe; }
          if (msg.mode) modeIndicator.textContent = msg.mode;
        } else if (msg.type === 'request') {
          showToast(msg.guestName, msg.title);
        }
      } catch (_) {}
    };
    ws.onclose = () => setTimeout(connectWS, 3000);
    ws.onerror = () => ws.close();
  }
  connectWS();

  // ─── Audio ──────────────────────────────────────────────────────────────────
  async function initAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;          // more bins = better frequency resolution
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      audioReactive = true;
    } catch (_) {
      audioReactive = false;
    }
  }
  initAudio();

  // ─── Glitch on track change ─────────────────────────────────────────────────
  let glitchActive = false;
  let glitchEnd = 0;
  function triggerGlitch() { glitchActive = true; glitchEnd = performance.now() + 800; }

  function applyGlitch() {
    if (!glitchActive) return;
    if (performance.now() > glitchEnd) { glitchActive = false; return; }
    const slices = 6 + Math.floor(Math.random() * 6);
    const sh = Math.ceil(canvas.height / slices);
    for (let i = 0; i < slices; i++) {
      const y = i * sh;
      const shift = (Math.random() - 0.5) * 50;
      if (Math.random() > 0.5) {
        const img = ctx.getImageData(0, y, canvas.width, sh);
        ctx.putImageData(img, shift, y);
      }
    }
  }

  // ─── WATERFALL ──────────────────────────────────────────────────────────────
  // Each frame: scroll existing waterfall down 1-2px, draw new row at top
  const ROW_HEIGHT = 2; // px per frame — controls scroll speed

  // Generative fake spectrum when no audio
  let genTime = 0;
  function fakeSpectrum(bins) {
    const out = new Uint8Array(bins);
    const t = genTime;
    for (let i = 0; i < bins; i++) {
      const freq = i / bins;
      // Bass hump
      const bass = Math.max(0, 1 - freq * 6) * (0.5 + 0.5 * Math.sin(t * 1.1 + i * 0.05));
      // Mid presence
      const mid = Math.max(0, Math.sin(freq * Math.PI)) * (0.3 + 0.3 * Math.sin(t * 0.7 + i * 0.03));
      // High sparkle
      const hi = freq > 0.6 ? Math.max(0, Math.random() * 0.15 - 0.05) : 0;
      // Slow drift
      const drift = 0.15 + 0.15 * Math.sin(t * 0.3 + freq * 4);
      const v = Math.min(1, bass + mid * 0.6 + hi + drift);
      out[i] = Math.round(v * 255);
    }
    return out;
  }

  function drawWaterfall(freqData) {
    const w = canvas.width;
    const h = canvas.height;
    const bins = freqData.length;

    // Scroll existing waterfall down by ROW_HEIGHT
    wtx.drawImage(waterfallCanvas, 0, ROW_HEIGHT, w, h - ROW_HEIGHT);

    // Draw new row at top
    const imageData = wtx.createImageData(w, ROW_HEIGHT);
    const d = imageData.data;

    for (let x = 0; x < w; x++) {
      const binIdx = Math.floor((x / w) * bins);
      const v = freqData[binIdx];
      const [r, g, b] = intensityToColor(v);

      for (let row = 0; row < ROW_HEIGHT; row++) {
        const idx = (row * w + x) * 4;
        d[idx]     = r;
        d[idx + 1] = g;
        d[idx + 2] = b;
        d[idx + 3] = 255;
      }
    }

    wtx.putImageData(imageData, 0, 0);

    // Draw frequency axis labels (subtle, bottom of screen)
    // Copy waterfall to main canvas
    ctx.drawImage(waterfallCanvas, 0, 0);

    // Overlay: faint frequency grid lines
    const palette = getPalette();
    const gridColor = `rgba(${palette[2][0]},${palette[2][1]},${palette[2][2]},0.15)`;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    const gridLines = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    for (const f of gridLines) {
      const x = Math.round(f * w);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Freq labels at bottom
    ctx.fillStyle = `rgba(${palette[3][0]},${palette[3][1]},${palette[3][2]},0.4)`;
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    const labels = ['60Hz','120Hz','250Hz','500Hz','1kHz','2kHz','4kHz','8kHz','16kHz'];
    labels.forEach((label, i) => {
      const x = gridLines[i] * w;
      ctx.fillText(label, x, h - 8);
    });
  }

  // ─── Main loop ──────────────────────────────────────────────────────────────
  let lastFrame = 0;
  const TARGET_FPS = 30; // waterfall looks better at 30fps
  const FRAME_MS = 1000 / TARGET_FPS;

  function draw(timestamp) {
    requestAnimationFrame(draw);

    const delta = timestamp - lastFrame;
    if (delta < FRAME_MS) return;
    lastFrame = timestamp - (delta % FRAME_MS);

    genTime += delta * 0.001;

    let freqData;
    if (audioReactive && analyser) {
      analyser.getByteFrequencyData(dataArray);
      freqData = dataArray;
    } else {
      freqData = fakeSpectrum(512);
    }

    drawWaterfall(freqData);
    applyGlitch();
  }

  requestAnimationFrame(draw);
})();

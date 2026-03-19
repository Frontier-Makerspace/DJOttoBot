// ─── PROTO7YPE Visualizer ───────────────────────────────────────────────────

(() => {
  // ─── DOM refs ───────────────────────────────────────────────────────────────
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

  const VIBE_COLORS = {
    'Late Night':  { primary: '#7700ff', secondary: '#ff003c' },
    'Morning':     { primary: '#00aaff', secondary: '#00ffcc' },
    'Afternoon':   { primary: '#00ffcc', secondary: '#00e5ff' },
    'Evening':     { primary: '#ff003c', secondary: '#7700ff' },
    'Peak Hours':  { primary: '#ff003c', secondary: '#ffaa00' }
  };

  function vibeColors() {
    return VIBE_COLORS[currentVibe] || VIBE_COLORS['Afternoon'];
  }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }

  // ─── Canvas resize ──────────────────────────────────────────────────────────
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // ─── Clock ──────────────────────────────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    clockEl.textContent = `${h}:${m}`;
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ─── Venue name glitch ──────────────────────────────────────────────────────
  const VENUE_TEXT = 'PROTO7YPE';
  const GLITCH_CHARS = ['█', '▓', '░', '▒', '╳', '◼'];

  function glitchVenue() {
    const chars = VENUE_TEXT.split('');
    const numGlitch = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numGlitch; i++) {
      const idx = Math.floor(Math.random() * chars.length);
      chars[idx] = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
    }
    venueEl.textContent = chars.join('');
    setTimeout(() => { venueEl.textContent = VENUE_TEXT; }, 100);
  }

  function scheduleGlitch() {
    const delay = 8000 + Math.random() * 7000; // 8-15s
    setTimeout(() => {
      glitchVenue();
      scheduleGlitch();
    }, delay);
  }
  scheduleGlitch();

  // ─── Track change animation ─────────────────────────────────────────────────
  function setTrack(title, artist) {
    if (title === currentTitle) return;
    currentTitle = title;

    // Fade out
    titleEl.classList.add('fade-out');
    artistEl.classList.add('fade-out');

    setTimeout(() => {
      titleEl.textContent = title || '';
      artistEl.textContent = artist || '';
      titleEl.classList.remove('fade-out');
      artistEl.classList.remove('fade-in');
      titleEl.classList.add('fade-in');
      artistEl.classList.add('fade-in');

      // Force reflow then remove fade-in to trigger transition
      void titleEl.offsetWidth;
      titleEl.classList.remove('fade-in');
      artistEl.classList.remove('fade-in');
    }, 400);

    // Trigger canvas glitch
    triggerGlitch();
  }

  // ─── Request toast ──────────────────────────────────────────────────────────
  let toastTimeout = null;
  function showToast(guestName, title) {
    toastEl.textContent = `🎵 ${guestName} requested ${title}`;
    toastEl.classList.add('active');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove('active');
    }, 4000);
  }

  // ─── WebSocket ──────────────────────────────────────────────────────────────
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'nowPlaying') {
          setTrack(msg.title, msg.author);
          if (msg.vibe) {
            currentVibe = msg.vibe;
            vibeBadge.textContent = msg.vibe;
          }
          if (msg.mode) {
            modeIndicator.textContent = msg.mode;
          }
        } else if (msg.type === 'request') {
          showToast(msg.guestName, msg.title);
        }
      } catch (e) { /* ignore */ }
    };

    ws.onclose = () => {
      setTimeout(connectWS, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }
  connectWS();

  // ─── Audio setup ────────────────────────────────────────────────────────────
  let audioCtx;

  async function initAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      audioReactive = true;
      console.log('Audio-reactive mode active');
    } catch (e) {
      console.log('No audio access, using generative mode');
      audioReactive = false;
    }
  }
  initAudio();

  // ─── Particles ──────────────────────────────────────────────────────────────
  const PARTICLE_COUNT = 60;
  const particles = [];

  function createParticle() {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      size: 1.5 + Math.random() * 2.5,
      colorIdx: Math.random() > 0.5 ? 0 : 1 // 0=primary, 1=secondary
    };
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(createParticle());
  }

  function updateParticles(bassEnergy) {
    const speedMult = 1 + bassEnergy * 3;
    for (const p of particles) {
      p.x += p.vx * speedMult;
      p.y += p.vy * speedMult;

      // Bounce off edges
      if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
      if (p.x > canvas.width) { p.x = canvas.width; p.vx = -Math.abs(p.vx); }
      if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
      if (p.y > canvas.height) { p.y = canvas.height; p.vy = -Math.abs(p.vy); }
    }
  }

  function drawParticles() {
    const colors = vibeColors();
    const cols = [colors.primary, colors.secondary];
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = cols[p.colorIdx];
      ctx.globalAlpha = 0.6;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ─── Glitch effect ──────────────────────────────────────────────────────────
  let glitchActive = false;
  let glitchEnd = 0;

  function triggerGlitch() {
    glitchActive = true;
    glitchEnd = performance.now() + 800;
  }

  function drawGlitch() {
    if (!glitchActive) return;
    if (performance.now() > glitchEnd) {
      glitchActive = false;
      return;
    }

    const sliceCount = 8 + Math.floor(Math.random() * 8);
    const sliceHeight = Math.ceil(canvas.height / sliceCount);

    for (let i = 0; i < sliceCount; i++) {
      const y = i * sliceHeight;
      const shift = (Math.random() - 0.5) * 40;
      const imgData = ctx.getImageData(0, y, canvas.width, sliceHeight);
      ctx.putImageData(imgData, shift, y);
    }
  }

  // ─── Audio-reactive visualization ───────────────────────────────────────────
  function drawAudioReactive() {
    analyser.getByteFrequencyData(dataArray);

    const bufferLength = dataArray.length;
    const centerX = canvas.width / 2;
    const barWidth = (canvas.width / bufferLength) * 2.5;
    const colors = vibeColors();
    const primaryRgb = hexToRgb(colors.primary);
    const secondaryRgb = hexToRgb(colors.secondary);

    // Bass energy (first 8 bins)
    let bassSum = 0;
    for (let i = 0; i < 8; i++) bassSum += dataArray[i];
    const bassEnergy = bassSum / (8 * 255);

    updateParticles(bassEnergy);

    // Draw bars mirrored from center
    for (let i = 0; i < bufferLength; i++) {
      const amplitude = dataArray[i] / 255;
      const barHeight = amplitude * canvas.height * 0.6;

      // Gradient color based on amplitude
      const r = Math.round(primaryRgb.r + (secondaryRgb.r - primaryRgb.r) * amplitude);
      const g = Math.round(primaryRgb.g + (secondaryRgb.g - primaryRgb.g) * amplitude);
      const b = Math.round(primaryRgb.b + (secondaryRgb.b - primaryRgb.b) * amplitude);

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.globalAlpha = 0.7 + amplitude * 0.3;

      // Right side
      const xRight = centerX + i * barWidth * 0.5;
      ctx.fillRect(xRight, canvas.height - barHeight, barWidth * 0.4, barHeight);

      // Left side (mirrored)
      const xLeft = centerX - i * barWidth * 0.5 - barWidth * 0.4;
      ctx.fillRect(xLeft, canvas.height - barHeight, barWidth * 0.4, barHeight);
    }

    ctx.globalAlpha = 1;
    drawParticles();
  }

  // ─── Generative fallback visualization ──────────────────────────────────────
  let genTime = 0;

  function drawGenerative(timestamp) {
    genTime = timestamp * 0.001;

    const colors = vibeColors();
    const primaryRgb = hexToRgb(colors.primary);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Lissajous curve with morphing parameters
    const a = 3 + Math.sin(genTime * 0.13) * 2;
    const b = 2 + Math.cos(genTime * 0.17) * 1.5;
    const delta = genTime * 0.3;
    const scaleX = canvas.width * 0.3;
    const scaleY = canvas.height * 0.3;

    ctx.beginPath();
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 2;
    ctx.shadowColor = colors.primary;
    ctx.shadowBlur = 20;
    ctx.globalAlpha = 0.8;

    for (let t = 0; t < Math.PI * 2; t += 0.01) {
      const x = centerX + Math.sin(a * t + delta) * scaleX;
      const y = centerY + Math.sin(b * t) * scaleY;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Second Lissajous in secondary color
    ctx.beginPath();
    ctx.strokeStyle = colors.secondary;
    ctx.shadowColor = colors.secondary;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;

    const a2 = 5 + Math.cos(genTime * 0.11) * 2;
    const b2 = 3 + Math.sin(genTime * 0.19) * 1.5;
    const delta2 = genTime * 0.2 + Math.PI * 0.5;

    for (let t = 0; t < Math.PI * 2; t += 0.01) {
      const x = centerX + Math.sin(a2 * t + delta2) * scaleX * 0.7;
      const y = centerY + Math.sin(b2 * t) * scaleY * 0.7;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Pulse ring
    const pulseRadius = 80 + Math.sin(genTime * 2) * 30;
    const pulseAlpha = 0.15 + Math.sin(genTime * 2) * 0.1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 2;
    ctx.globalAlpha = pulseAlpha;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Simulated bass energy from sine for particles
    const fakeBass = 0.3 + Math.sin(genTime * 1.5) * 0.2;
    updateParticles(fakeBass);
    drawParticles();
  }

  // ─── Main render loop ──────────────────────────────────────────────────────
  function draw(timestamp) {
    // Motion blur trail
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (audioReactive && analyser) {
      drawAudioReactive();
    } else {
      drawGenerative(timestamp);
    }

    drawGlitch();

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
})();

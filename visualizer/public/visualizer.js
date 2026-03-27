// ─── PROTO7YPE Visualizer — Combined Edition ────────────────────────────────

(() => {
  const canvas = document.getElementById('visualizer-canvas');
  const ctx = canvas.getContext('2d');
  const titleEl = document.getElementById('track-title');
  const artistEl = document.getElementById('track-artist');
  const albumEl = document.getElementById('track-album');
  const vibeBadge = document.getElementById('vibe-badge');
  const modeIndicator = document.getElementById('mode-indicator');
  const clockEl = document.getElementById('clock');
  const topClockEl = document.getElementById('top-clock');
  const vibeBadgeTopEl = document.getElementById('vibe-badge-top');
  const partyOverlay = document.getElementById('party-overlay');
  const partyNameEl = document.getElementById('party-name');
  const partyTaglineEl = document.getElementById('party-tagline');
  const toastEl = document.getElementById('request-toast');
  const venueEl = document.getElementById('venue-name');
  const bpmNumber = document.getElementById('bpm-number');
  const albumArtBg = document.getElementById('album-art-bg');
  const qrContainer = document.getElementById('qr-container');
  const qrImg = document.getElementById('qr-img');
  const ytBg = document.getElementById('yt-bg');
  const roastToastEl = document.getElementById('roast-toast');

  // ─── State ──────────────────────────────────────────────────────────────────
  let currentVibe = 'Afternoon';
  let currentTitle = '';
  let currentVideoId = null;
  let audioReactive = false;
  let analyser = null;
  let dataArray = null;
  let genTime = 0;

  // Offscreen waterfall buffer
  const waterfallCanvas = document.createElement('canvas');
  const wtx = waterfallCanvas.getContext('2d');

  // ─── Vibe palettes ──────────────────────────────────────────────────────────
  const VIBE_PALETTES = {
    'Late Night':  { stops: [[0,0,0],[30,0,80],[120,0,180],[180,0,100],[255,0,60]],   primary:'#7700ff', secondary:'#ff003c' },
    'Morning':     { stops: [[0,0,0],[0,20,60],[0,80,160],[0,180,220],[0,255,200]],   primary:'#00aaff', secondary:'#00ffcc' },
    'Afternoon':   { stops: [[0,0,0],[0,40,40],[0,140,140],[0,220,200],[0,255,204]],  primary:'#00ffcc', secondary:'#00e5ff' },
    'Evening':     { stops: [[0,0,0],[40,0,40],[120,0,80],[200,0,60],[255,0,60]],     primary:'#ff003c', secondary:'#7700ff' },
    'Peak Hours':  { stops: [[0,0,0],[60,0,0],[180,20,0],[255,100,0],[255,220,0]],    primary:'#ff003c', secondary:'#ffaa00' },
  };

  function getPalette() { return VIBE_PALETTES[currentVibe] || VIBE_PALETTES['Afternoon']; }

  function intensityToColor(v) {
    const stops = getPalette().stops;
    const t = (v / 255) * (stops.length - 1);
    const i = Math.floor(t), f = t - i;
    const c0 = stops[Math.min(i, stops.length-1)];
    const c1 = stops[Math.min(i+1, stops.length-1)];
    return [
      Math.round(c0[0] + (c1[0]-c0[0])*f),
      Math.round(c0[1] + (c1[1]-c0[1])*f),
      Math.round(c0[2] + (c1[2]-c0[2])*f),
    ];
  }

  function hexToRgb(hex) {
    return {
      r: parseInt(hex.slice(1,3),16),
      g: parseInt(hex.slice(3,5),16),
      b: parseInt(hex.slice(5,7),16),
    };
  }

  // ─── Canvas resize ──────────────────────────────────────────────────────────
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    waterfallCanvas.width = canvas.width;
    waterfallCanvas.height = Math.floor(canvas.height * 0.45); // bottom 45%
    wtx.fillStyle = 'black';
    wtx.fillRect(0, 0, waterfallCanvas.width, waterfallCanvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  // ─── Clock ──────────────────────────────────────────────────────────────────
  function updateClock() {
    const n = new Date();
    const timeStr = String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
    clockEl.textContent = timeStr;
    if (topClockEl) topClockEl.textContent = timeStr;
  }
  updateClock(); setInterval(updateClock, 1000);

  // ─── Venue glitch ───────────────────────────────────────────────────────────
  const VENUE_TEXT = 'PROTO7YPE';
  const GLITCH_CHARS = ['█','▓','░','▒','╳','◼'];
  function glitchVenue() {
    const c = VENUE_TEXT.split('');
    for (let i = 0; i < 1+Math.floor(Math.random()*2); i++)
      c[Math.floor(Math.random()*c.length)] = GLITCH_CHARS[Math.floor(Math.random()*GLITCH_CHARS.length)];
    venueEl.textContent = c.join('');
    setTimeout(() => { venueEl.textContent = VENUE_TEXT; }, 120);
  }
  (function sg() { setTimeout(() => { glitchVenue(); sg(); }, 8000+Math.random()*7000); })();

  // ─── BPM display ────────────────────────────────────────────────────────────
  function updateBPM(bpm) {
    if (!bpmNumber) return;
    if (bpm) {
      bpmNumber.textContent = bpm;
      const pal = getPalette();
      bpmNumber.style.color = pal.primary;
      bpmNumber.style.textShadow = `0 0 18px ${pal.primary}, 0 0 6px ${pal.primary}`;
    } else {
      bpmNumber.textContent = '—';
      bpmNumber.style.color = '';
      bpmNumber.style.textShadow = '';
    }
  }

  // ─── Album art background ────────────────────────────────────────────────────
  function updateAlbumArt(videoId) {
    if (!albumArtBg || !videoId) return;
    if (videoId === currentVideoId) return;
    currentVideoId = videoId;

    // Fade out, swap, fade in
    albumArtBg.classList.remove('visible');
    setTimeout(() => {
      const maxUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
      const hqUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        albumArtBg.style.backgroundImage = `url('${img.src}')`;
        albumArtBg.classList.add('visible');
      };
      img.onerror = () => {
        // Try hq fallback
        const fallback = new Image();
        fallback.crossOrigin = 'anonymous';
        fallback.onload = () => {
          albumArtBg.style.backgroundImage = `url('${fallback.src}')`;
          albumArtBg.classList.add('visible');
        };
        fallback.src = hqUrl;
      };
      img.src = maxUrl;
    }, 800);
  }

  // ─── QR Code ────────────────────────────────────────────────────────────────
  let qrVideoId = null;
  async function updateQR(videoId) {
    if (!qrContainer || !qrImg || !videoId) return;
    if (videoId === qrVideoId) return;
    qrVideoId = videoId;
    try {
      const res = await fetch(`/api/qr?videoId=${encodeURIComponent(videoId)}`);
      const data = await res.json();
      if (data.dataUrl) {
        qrImg.src = data.dataUrl;
        qrContainer.style.display = 'block';
      }
    } catch(e) {
      console.warn('QR fetch failed', e);
    }
  }


  // ─── YouTube Video Background ─────────────────────────────────────────────
  let ytVideoId = null;
  function updateYTVideo(title, videoId) {
    const isVideoTrack = title && /official.*(video|mv|clip)|music video/i.test(title);
    if (isVideoTrack && videoId && videoId !== ytVideoId) {
      ytVideoId = videoId;
      ytBg.innerHTML = `<iframe
        src="https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&modestbranding=1&rel=0&playsinline=1"
        allow="autoplay; encrypted-media"
        allowfullscreen>
      </iframe>`;
      ytBg.classList.add('visible');
      canvas.classList.add('video-active');
      if (albumArtBg) albumArtBg.classList.remove('visible');
    } else if (!isVideoTrack) {
      if (ytVideoId) {
        ytBg.classList.remove('visible');
        canvas.classList.remove('video-active');
        ytVideoId = null;
        setTimeout(() => { ytBg.innerHTML = ''; }, 1500);
      }
    }
  }

  // ─── Track change ───────────────────────────────────────────────────────────
  function setTrack(title, artist, album, videoId, bpm, albumArt) {
    if (title === currentTitle && !videoId && !albumArt) return;
    currentTitle = title;
    console.log('[setTrack] Setting:', { title, artist, album, artistEl_exists: !!artistEl });
    titleEl.classList.add('fade-out'); 
    if (artistEl) artistEl.classList.add('fade-out');
    setTimeout(() => {
      titleEl.textContent = title || '';
      if (artistEl) {
        artistEl.textContent = artist || '';
        artistEl.style.display = artist ? 'block' : 'none';
      }
      if (albumEl) albumEl.textContent = album || '';
      console.log('[setTrack] DOM updated:', { 
        titleText: titleEl.textContent, 
        artistText: artistEl ? artistEl.textContent : 'NO_ELEMENT',
        artistDisplay: artistEl ? artistEl.style.display : 'N/A'
      });
      titleEl.classList.remove('fade-out'); titleEl.classList.add('fade-in');
      if (artistEl) {
        artistEl.classList.remove('fade-out');
        artistEl.classList.add('fade-in');
      }
      void titleEl.offsetWidth;
      titleEl.classList.remove('fade-in'); 
      if (artistEl) artistEl.classList.remove('fade-in');
    }, 400);
    triggerGlitch();

    if (videoId) {
      updateYTVideo(title, videoId);
      if (!ytBg.classList.contains('visible')) {
        updateAlbumArt(videoId);
      }
      updateQR(videoId);
    } else if (albumArt) {      loadAlbumArtImage(albumArt);
      // Use embedded album art from ID3 tags
      if (albumArtBg) {
        albumArtBg.classList.remove('visible');
        setTimeout(() => {
          albumArtBg.style.backgroundImage = `url('${albumArt}')`;
          albumArtBg.classList.add('visible');
        }, 800);
      }
      ytBg.classList.remove('visible');
      canvas.classList.remove('video-active');
    }
    if (bpm) updateBPM(bpm);
  }

  // ─── Toast ──────────────────────────────────────────────────────────────────
  let toastTO = null;
  function showToast(guestName, title) {
    toastEl.textContent = `🎵 ${guestName} requested ${title}`;
    toastEl.classList.add('active');
    if (toastTO) clearTimeout(toastTO);
    toastTO = setTimeout(() => toastEl.classList.remove('active'), 4000);
  }

  // ─── Roast Toast ────────────────────────────────────────────────────────────
  let roastTO = null;
  function showRoastToast(msg) {
    if (!roastToastEl) return;
    roastToastEl.textContent = `😈 ${msg}`;
    roastToastEl.classList.add('active');
    if (roastTO) clearTimeout(roastTO);
    roastTO = setTimeout(() => roastToastEl.classList.remove('active'), 7000);
  }

  // ─── Vibe Shift Toast ───────────────────────────────────────────────────────
  function showVibeShiftToast(newVibe) {
    showToast('Otto detected the vibe 🎵', `Shifting to ${newVibe}`);
  }

  // ─── WebSocket ──────────────────────────────────────────────────────────────
  function connectWS() {
    const ws = new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "nowPlaying") { console.log("[WS] nowPlaying albumArt:", msg.albumArt);
          const ytId = isYouTubeId(msg.videoId) ? msg.videoId : null;
          setTrack(msg.title, msg.author, msg.album, ytId, msg.bpm, msg.albumArt); if (msg.albumArt) loadAlbumArtImage(msg.albumArt);
          const vibeName = (typeof msg.vibe === 'string') ? msg.vibe : (msg.vibe && msg.vibe.name);
          if (vibeName) { currentVibe = vibeName; vibeBadge.textContent = vibeName; }
          if (msg.mode) modeIndicator.textContent = msg.mode;
          if (msg.bpm) updateBPM(msg.bpm);
          if (ytId) { updateAlbumArt(ytId); updateQR(ytId); }
          if (msg.startedAt) trackStartedAt = new Date(msg.startedAt).getTime();
          if (msg.duration) trackDuration = msg.duration;
        } else if (msg.type === 'request') {
          showToast(msg.guestName, msg.title);
        } else if (msg.type === 'otto_roast') {
          showRoastToast(msg.reply);
        } else if (msg.type === 'vibe_shift') {
          showVibeShiftToast(msg.newVibe);
        }
      } catch(_){}
    };
    ws.onclose = () => setTimeout(connectWS, 3000);
    ws.onerror = () => ws.close();
  }
  connectWS();

  // ─── Track Progress Bar ─────────────────────────────────────────────────────
  const progressFill = document.getElementById('track-progress-fill');
  const trackElapsed = document.getElementById('track-elapsed');
  const trackRemaining = document.getElementById('track-remaining');

  let trackStartedAt = null;
  let trackDuration = null;

  function fmt(secs) {
    if (!secs || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function updateProgressBar() {
    if (!trackStartedAt || !trackDuration || trackDuration <= 0) {
      if (progressFill) progressFill.style.width = '0%';
      return;
    }
    const elapsed = (Date.now() - trackStartedAt) / 1000;
    const pct = Math.min(100, (elapsed / trackDuration) * 100);
    const remaining = Math.max(0, trackDuration - elapsed);
    if (progressFill) progressFill.style.width = pct + '%';
    if (trackElapsed) trackElapsed.textContent = fmt(elapsed);
    if (trackRemaining) trackRemaining.textContent = '-' + fmt(remaining);
  }

  setInterval(updateProgressBar, 1000);

  // Poll autodj status for startedAt + duration + bpm + videoId
  // Is this a real YouTube video ID? (exactly 11 alphanumeric/dash/underscore chars)
  function isYouTubeId(id) {
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id);
  }

  async function pollAutoDJStatus() {
    try {
      const res = await fetch('http://' + location.hostname + ':3001/status');
      const data = await res.json();
      if (data.currentTrack) {
        const ct = data.currentTrack;
        trackStartedAt = ct.startedAt ? new Date(ct.startedAt).getTime() : null;
        trackDuration = ct.duration || null;
        if (ct.bpm) updateBPM(ct.bpm);

        // Only use videoId if it's a real YouTube ID
        const ytId = isYouTubeId(ct.videoId) ? ct.videoId : null;

        // Always update track display from poll (handles page reload mid-track)
        const artist = ct.artist || ct.author || 'Unknown';
        const title = ct.title || ct.name || 'Unknown';
        console.log('[Poll] Track:', { title, artist, artist_raw: ct.artist, author_raw: ct.author });
        setTrack(title, artist, ct.album, ytId, ct.bpm, ct.albumArt || null); if (ct.albumArt) loadAlbumArtImage(ct.albumArt);

        // Update vibe display in top bar
        if (data.vibe && vibeBadgeTopEl) {
          vibeBadgeTopEl.textContent = data.vibe.name || '—';
          vibeBadge.textContent = data.vibe.name || '—';
          currentVibe = data.vibe.name || 'Afternoon';
        }

        // Party mode overlay
        if (data.party && data.party.active && partyOverlay) {
          partyOverlay.style.display = 'block';
          if (partyNameEl) partyNameEl.textContent = data.party.name || '';
          if (partyTaglineEl) partyTaglineEl.textContent = data.party.tagline || '';
          // Override venue name with party name
          if (venueEl) venueEl.textContent = data.party.name || 'PROTO7YPE';
        } else if (partyOverlay) {
          partyOverlay.style.display = 'none';
          if (venueEl) venueEl.textContent = 'PROTO7YPE';
        }

        if (ytId) {
          updateAlbumArt(ytId);
          updateQR(ytId);
        }
      } else {
        trackStartedAt = null;
        trackDuration = null;
      }
    } catch(_) {}
  }
  pollAutoDJStatus();
  setInterval(pollAutoDJStatus, 2000);


  // ─── Audio ──────────────────────────────────────────────────────────────────
  async function initAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const actx = new AudioContext();
      const source = actx.createMediaStreamSource(stream);
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      audioReactive = true;
    } catch(_) { audioReactive = false; }
  }
  initAudio();

  // ─── Particles ──────────────────────────────────────────────────────────────
  const PARTICLE_COUNT = 80;
  const particles = Array.from({length: PARTICLE_COUNT}, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height * 0.55, // keep in upper zone
    vx: (Math.random()-0.5)*1.5,
    vy: (Math.random()-0.5)*1.5,
    size: 1.5+Math.random()*2.5,
    c: Math.random()>0.5?0:1,
  }));

  function updateParticles(bass) {
    const sm = 1 + bass * 4;
    const maxY = canvas.height * 0.55;
    for (const p of particles) {
      p.x += p.vx * sm; p.y += p.vy * sm;
      if (p.x < 0) { p.x=0; p.vx=Math.abs(p.vx); }
      if (p.x > canvas.width) { p.x=canvas.width; p.vx=-Math.abs(p.vx); }
      if (p.y < 0) { p.y=0; p.vy=Math.abs(p.vy); }
      if (p.y > maxY) { p.y=maxY; p.vy=-Math.abs(p.vy); }
    }
  }

  function drawParticles() {
    const { primary, secondary } = getPalette();
    const cols = [primary, secondary];
    ctx.globalAlpha = 0.55;
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
      ctx.fillStyle = cols[p.c];
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ─── Glitch ──────────────────────────────────────────────────────────────────
  let glitchActive = false, glitchEnd = 0;
  function triggerGlitch() { glitchActive = true; glitchEnd = performance.now()+800; }
  function applyGlitch() {
    if (!glitchActive) return;
    if (performance.now() > glitchEnd) { glitchActive=false; return; }
    const slices = 6+Math.floor(Math.random()*6);
    const sh = Math.ceil(canvas.height/slices);
    for (let i=0;i<slices;i++) {
      if (Math.random()>0.5) {
        const y=i*sh, shift=(Math.random()-0.5)*50;
        const img=ctx.getImageData(0,y,canvas.width,sh);
        ctx.putImageData(img,shift,y);
      }
    }
  }

  // ─── Generative fake spectrum ────────────────────────────────────────────────
  function fakeSpectrum(bins) {
    const out = new Uint8Array(bins);
    const t = genTime;
    for (let i=0;i<bins;i++) {
      const f = i/bins;
      const bass = Math.max(0, 1-f*5) * (0.5+0.5*Math.sin(t*1.1+i*0.05));
      const mid  = Math.max(0, Math.sin(f*Math.PI)) * (0.3+0.3*Math.sin(t*0.7+i*0.03));
      const hi   = f>0.6 ? Math.max(0,Math.random()*0.15-0.05):0;
      const drift= 0.15+0.15*Math.sin(t*0.3+f*4);
      out[i] = Math.round(Math.min(1, bass+mid*0.6+hi+drift)*255);
    }
    return out;
  }

  // ─── WATERFALL (bottom 45% of screen) ───────────────────────────────────────
  const ROW_HEIGHT = 2;

  function drawWaterfall(freqData) {
    const ww = waterfallCanvas.width;
    const wh = waterfallCanvas.height;
    const bins = freqData.length;
    const yOffset = Math.floor(canvas.height * 0.55); // where waterfall starts

    // Scroll down
    wtx.drawImage(waterfallCanvas, 0, ROW_HEIGHT, ww, wh-ROW_HEIGHT);

    // New row at top of waterfall buffer
    const imageData = wtx.createImageData(ww, ROW_HEIGHT);
    const d = imageData.data;
    for (let x=0; x<ww; x++) {
      const binIdx = Math.floor((x/ww)*bins);
      const [r,g,b] = intensityToColor(freqData[binIdx]);
      for (let row=0;row<ROW_HEIGHT;row++) {
        const idx=(row*ww+x)*4;
        d[idx]=r; d[idx+1]=g; d[idx+2]=b; d[idx+3]=255;
      }
    }
    wtx.putImageData(imageData, 0, 0);

    // Blit waterfall onto main canvas at yOffset
    ctx.drawImage(waterfallCanvas, 0, yOffset);

    // Freq grid + labels
    const { stops } = getPalette();
    const gc = `rgba(${stops[2][0]},${stops[2][1]},${stops[2][2]},0.2)`;
    ctx.strokeStyle = gc; ctx.lineWidth = 1;
    const gridPcts = [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9];
    const freqLabels = ['60Hz','120Hz','250Hz','500Hz','1kHz','2kHz','4kHz','8kHz','16kHz'];
    for (let i=0;i<gridPcts.length;i++) {
      const x = Math.round(gridPcts[i]*canvas.width);
      ctx.beginPath(); ctx.moveTo(x,yOffset); ctx.lineTo(x,canvas.height); ctx.stroke();
    }
    ctx.fillStyle = `rgba(${stops[3][0]},${stops[3][1]},${stops[3][2]},0.45)`;
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    freqLabels.forEach((lbl,i) => ctx.fillText(lbl, gridPcts[i]*canvas.width, canvas.height-8));

    // Divider line between sections
    const { primary } = getPalette();
    ctx.strokeStyle = primary+'55';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,yOffset); ctx.lineTo(canvas.width,yOffset); ctx.stroke();
  }

  // ─── CENTER VISUALIZER (top 55%) ─────────────────────────────────────────────
  function drawCenter(freqData, bass) {
    const { primary, secondary } = getPalette();
    const pRgb = hexToRgb(primary);
    const sRgb = hexToRgb(secondary);
    const w = canvas.width;
    const h = canvas.height * 0.55;
    const centerX = w / 2;
    const centerY = h / 2;

    if (audioReactive && analyser) {
      // ── Mirrored frequency bars centered ──
      const bins = freqData.length;
      const barW = (w / bins) * 2.5;
      for (let i=0; i<bins; i++) {
        const amp = freqData[i] / 255;
        const barH = amp * h * 0.65;
        const r = Math.round(pRgb.r + (sRgb.r-pRgb.r)*amp);
        const g = Math.round(pRgb.g + (sRgb.g-pRgb.g)*amp);
        const b = Math.round(pRgb.b + (sRgb.b-pRgb.b)*amp);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.globalAlpha = 0.65 + amp*0.35;
        const xR = centerX + i*barW*0.5;
        const xL = centerX - i*barW*0.5 - barW*0.4;
        ctx.fillRect(xR, h-barH, barW*0.4, barH);
        ctx.fillRect(xL, h-barH, barW*0.4, barH);
      }
      ctx.globalAlpha = 1;
    } else {
      // ── Lissajous fallback ──
      const t = genTime;
      const a  = 3+Math.sin(t*0.13)*2;
      const b  = 2+Math.cos(t*0.17)*1.5;
      const dl = t*0.3;
      const sx = w*0.28, sy = h*0.38;

      ctx.beginPath();
      ctx.strokeStyle = primary;
      ctx.lineWidth = 2;
      ctx.shadowColor = primary; ctx.shadowBlur = 18;
      ctx.globalAlpha = 0.85;
      for (let t2=0; t2<Math.PI*2; t2+=0.01) {
        const x = centerX+Math.sin(a*t2+dl)*sx;
        const y = centerY+Math.sin(b*t2)*sy;
        t2===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = secondary; ctx.lineWidth=1.5;
      ctx.shadowColor=secondary; ctx.globalAlpha=0.45;
      const a2=5+Math.cos(t*0.11)*2, b2=3+Math.sin(t*0.19)*1.5, dl2=t*0.2+Math.PI*0.5;
      for (let t2=0; t2<Math.PI*2; t2+=0.01) {
        const x=centerX+Math.sin(a2*t2+dl2)*sx*0.65;
        const y=centerY+Math.sin(b2*t2)*sy*0.65;
        t2===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }
      ctx.stroke();
      ctx.shadowBlur=0; ctx.globalAlpha=1;

      // Pulse ring
      const pr = 70+Math.sin(t*2)*25;
      ctx.beginPath(); ctx.arc(centerX,centerY,pr,0,Math.PI*2);
      ctx.strokeStyle=primary; ctx.lineWidth=1.5;
      ctx.globalAlpha=0.12+Math.sin(t*2)*0.08; ctx.stroke();
      ctx.globalAlpha=1;
    }
  }

  // ─── Main render loop ────────────────────────────────────────────────────────
  let lastFrame = 0;
  const FRAME_MS = 1000/30;


  // --- Album art on canvas ---
  let _albumArtImg = null;
  let _albumArtUrl = null;
  let _albumArtLoaded = false;

  function loadAlbumArtImage(url) {
    if (!url || url === _albumArtUrl) return;
    _albumArtUrl = url;
    _albumArtLoaded = false;
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function() { _albumArtImg = img; _albumArtLoaded = true; };
    img.onerror = function() { _albumArtImg = null; _albumArtLoaded = false; };
    img.src = url;
  }

  function draw(ts) {
    requestAnimationFrame(draw);
    const delta = ts - lastFrame;
    if (delta < FRAME_MS) return;
    lastFrame = ts - (delta % FRAME_MS);
    genTime += delta * 0.001;

    let freqData, bass = 0;
    if (audioReactive && analyser) {
      analyser.getByteFrequencyData(dataArray);
      freqData = dataArray;
      for (let i=0;i<8;i++) bass += dataArray[i];
      bass = bass / (8*255);
    } else {
      freqData = fakeSpectrum(512);
      bass = 0.3 + Math.sin(genTime*1.5)*0.2;
    }

    // Clear upper section with motion blur trail
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, canvas.width, canvas.height * 0.55);    // Draw album art background on canvas    if (_albumArtLoaded && _albumArtImg) {      var iw = _albumArtImg.width, ih = _albumArtImg.height;      var sc = Math.max(canvas.width / iw, canvas.height / ih);      var dw = iw * sc, dh = ih * sc;      var dx = (canvas.width - dw) / 2, dy = (canvas.height - dh) / 2;      ctx.save();      ctx.globalAlpha = 0.0;      ctx.drawImage(_albumArtImg, dx, dy, dw, dh);      ctx.restore();    }

    // Draw center visualizer (bars or Lissajous)
    drawCenter(freqData, bass);

    // Draw particles in upper zone
    updateParticles(bass);
    drawParticles();

    // Draw waterfall in lower zone
    drawWaterfall(freqData);

    // Glitch overlay
    applyGlitch();
  }

  requestAnimationFrame(draw);
})();

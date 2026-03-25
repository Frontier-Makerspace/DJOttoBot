(function () {
  const queueBody = document.getElementById('queueBody');
  const themeSelect = document.getElementById('themeSelect');
  const statPending = document.getElementById('statPending');
  const statDownloading = document.getElementById('statDownloading');
  const statDone = document.getElementById('statDone');
  const statRejected = document.getElementById('statRejected');
  const nowPlayingEl = document.getElementById('nowPlaying');
  const modeDesc = document.getElementById('modeDesc');

  let queue = [];
  let currentMode = 'BOT';

  const modeDescriptions = {
    BOT: '🤖 Otto is in full control — requests auto-approved',
    ASSIST: '🎧 Human DJ active — approve/reject requests manually',
    OVERRIDE: '🎤 Live DJ has the floor — Otto is paused',
  };

  // --- Vibe Control ---
  const vibeSelect = document.getElementById('vibeSelect');
  window.setVibe = async function(vibe) {
    try {
      if (!vibe) {
        // Empty string means auto
        console.log('Vibe set to auto (by time)');
        vibeSelect.value = '';
        return;
      }
      await fetch('http://' + location.hostname + ':3001/vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vibe })
      });
      console.log('Vibe changed to:', vibe);
    } catch (e) {
      console.error('Vibe change failed:', e);
    }
  };
  vibeSelect.addEventListener('change', () => {
    setVibe(vibeSelect.value);
  });

  // --- Party Mode (Time Blocking) ---
  const partyModeCheck = document.getElementById('partyModeCheck');
  const partyStartTime = document.getElementById('partyStartTime');
  const partyEndTime = document.getElementById('partyEndTime');
  const partyTimeSeparator = document.getElementById('partyTimeSeparator');
  const partySetBtn = document.getElementById('partySetBtn');

  // Load saved party mode from localStorage
  const savedPartyMode = localStorage.getItem('dj-party-mode');
  if (savedPartyMode) {
    const { enabled, start, end } = JSON.parse(savedPartyMode);
    if (enabled) {
      partyModeCheck.checked = true;
      partyStartTime.value = start;
      partyEndTime.value = end;
      togglePartyUI(true);
    }
  }

  partyModeCheck.addEventListener('change', () => {
    togglePartyUI(partyModeCheck.checked);
  });

  function togglePartyUI(enabled) {
    partyStartTime.style.display = enabled ? 'inline' : 'none';
    partyEndTime.style.display = enabled ? 'inline' : 'none';
    partyTimeSeparator.style.display = enabled ? 'inline' : 'none';
    partySetBtn.style.display = enabled ? 'inline-block' : 'none';
  }

  window.setPartyMode = async function() {
    if (!partyModeCheck.checked) {
      // Clear party mode
      localStorage.removeItem('dj-party-mode');
      console.log('Party mode disabled');
      return;
    }

    const start = partyStartTime.value;
    const end = partyEndTime.value;

    if (!start || !end) {
      alert('Please set both start and end times');
      return;
    }

    // Save to localStorage
    localStorage.setItem('dj-party-mode', JSON.stringify({
      enabled: true,
      start,
      end,
    }));

    console.log(`Party mode set: ${start} - ${end}`);
    alert(`Party mode activated: ${start} → ${end}`);
  };

  partySetBtn.addEventListener('click', setPartyMode);

  // --- Theme ---
  const savedTheme = localStorage.getItem('dj-theme') || 'theme-default';
  document.body.className = savedTheme;
  themeSelect.value = savedTheme;
  themeSelect.addEventListener('change', () => {
    document.body.className = themeSelect.value;
    localStorage.setItem('dj-theme', themeSelect.value);
  });

  // --- Mode ---
  window.setMode = async function(mode) {
    try {
      await fetch('http://' + location.hostname + ':3001/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      updateModeUI(mode);
    } catch (e) {
      console.error('Mode switch failed:', e);
    }
  };

  function updateModeUI(mode) {
    currentMode = mode;
    ['BOT', 'ASSIST', 'OVERRIDE'].forEach(m => {
      document.getElementById('btn' + m).className = 'mode-btn' + (m === mode ? ' active-' + m : '');
    });
    modeDesc.textContent = modeDescriptions[mode] || '';
    renderQueue();
  }

  // --- Skip ---
  window.skipTrack = async function() {
    await fetch('http://' + location.hostname + ':3001/skip', { method: 'POST' });
  };

  // --- Poll AutoDJ status ---
  async function pollStatus() {
    try {
      const res = await fetch('http://' + location.hostname + ':3001/status');
      const status = await res.json();
      if (status.mode) updateModeUI(status.mode);
      if (status.currentTrack && status.currentTrack.title) {
        nowPlayingEl.textContent = '▶ ' + status.currentTrack.title;
      } else {
        nowPlayingEl.textContent = '— nothing playing —';
      }
    } catch {}
  }
  pollStatus();
  setInterval(pollStatus, 5000);

  // --- Audio chime ---
  let audioCtx;
  function playChime() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
  }

  // --- Format duration ---
  function formatDuration(secs) {
    if (!secs) return '—';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // --- Stats ---
  function updateStats() {
    statPending.textContent = queue.filter(r => r.status === 'pending').length;
    statDownloading.textContent = queue.filter(r => r.status === 'downloading').length;
    statDone.textContent = queue.filter(r => r.status === 'done').length;
    statRejected.textContent = queue.filter(r => r.status === 'rejected').length;
  }

  // --- Render queue ---
  function renderQueue(highlightId) {
    if (!queue.length) {
      queueBody.innerHTML = '<tr class="empty-row"><td colspan="6">No requests yet — waiting for guests...</td></tr>';
      updateStats();
      return;
    }

    const sorted = [...queue].reverse();
    queueBody.innerHTML = sorted.map(item => {
      const rowClass = item.status === 'rejected' ? 'row-rejected' : item.status === 'done' ? 'row-done' : '';
      const flashClass = item.id === highlightId ? 'row-new' : '';

      let statusHtml = '';
      if (item.status === 'pending') statusHtml = '<span class="status-badge status-pending">Pending</span>';
      else if (item.status === 'downloading') {
        const pct = item._progress || 0;
        statusHtml = `<span class="status-badge status-downloading">Downloading</span>
          <div class="progress-bar-container"><div class="progress-bar" style="width:${pct}%"></div></div>`;
      } else if (item.status === 'done') statusHtml = '<span class="status-badge status-done">Done</span>';
      else if (item.status === 'rejected') statusHtml = '<span class="status-badge status-rejected">Rejected</span>';
      else if (item.status === 'error') statusHtml = '<span class="status-badge status-error">Error</span>';

      // Show approve/reject buttons only in ASSIST mode for pending items
      let actionsHtml = '';
      if (item.status === 'pending' && currentMode === 'ASSIST') {
        actionsHtml = `
          <button class="action-btn btn-approve" onclick="djAction('approve','${item.id}')">Approve</button>
          <button class="action-btn btn-reject" onclick="djAction('reject','${item.id}')">Reject</button>
        `;
      } else if (item.status === 'pending' && currentMode === 'BOT') {
        actionsHtml = '<span style="color:#555;font-size:0.75rem">auto</span>';
      }

      return `<tr class="${rowClass} ${flashClass}" data-id="${item.id}">
        <td class="guest-name">${esc(item.guestName)}</td>
        <td class="song-title">${esc(item.title)}</td>
        <td>${esc(item.author)}</td>
        <td>${formatDuration(item.duration)}</td>
        <td>${statusHtml}</td>
        <td>${actionsHtml}</td>
      </tr>`;
    }).join('');

    updateStats();
  }

  window.djAction = async function(action, id) {
    try {
      await fetch(`/api/${action}/${id}`, { method: 'POST' });
    } catch (err) {
      console.error(`${action} failed:`, err);
    }
  };

  // --- WebSocket ---
  function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'queue') {
        queue = data.queue;
        renderQueue();
      } else if (data.type === 'new_request') {
        queue.push(data.item);
        renderQueue(data.item.id);
        playChime();
      } else if (data.type === 'status_update') {
        const item = queue.find(r => r.id === data.id);
        if (item) {
          item.status = data.status;
          if (data.progress !== undefined) item._progress = data.progress;
        }
        renderQueue();
      }
    };

    ws.onclose = () => setTimeout(connectWS, 2000);
  }

  connectWS();
})();

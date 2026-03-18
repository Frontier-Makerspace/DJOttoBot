(function () {
  const queueBody = document.getElementById('queueBody');
  const themeSelect = document.getElementById('themeSelect');
  const statPending = document.getElementById('statPending');
  const statDownloading = document.getElementById('statDownloading');
  const statDone = document.getElementById('statDone');
  const statRejected = document.getElementById('statRejected');

  let queue = [];

  // --- Theme ---
  const savedTheme = localStorage.getItem('dj-theme') || 'theme-default';
  document.body.className = savedTheme;
  themeSelect.value = savedTheme;

  themeSelect.addEventListener('change', () => {
    document.body.className = themeSelect.value;
    localStorage.setItem('dj-theme', themeSelect.value);
  });

  // --- Audio chime (Web Audio API) ---
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

  // --- Escape HTML ---
  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // --- Update stats ---
  function updateStats() {
    statPending.textContent = queue.filter((r) => r.status === 'pending').length;
    statDownloading.textContent = queue.filter((r) => r.status === 'downloading').length;
    statDone.textContent = queue.filter((r) => r.status === 'done').length;
    statRejected.textContent = queue.filter((r) => r.status === 'rejected').length;
  }

  // --- Render queue ---
  function renderQueue(highlightId) {
    if (!queue.length) {
      queueBody.innerHTML = '<tr class="empty-row"><td colspan="6">No requests yet — waiting for guests...</td></tr>';
      updateStats();
      return;
    }

    // Show newest first
    const sorted = [...queue].reverse();

    queueBody.innerHTML = sorted
      .map((item) => {
        const rowClass = item.status === 'rejected' ? 'row-rejected' :
                         item.status === 'done' ? 'row-done' : '';
        const flashClass = item.id === highlightId ? 'row-new' : '';

        let statusHtml = '';
        if (item.status === 'pending') {
          statusHtml = '<span class="status-badge status-pending">Pending</span>';
        } else if (item.status === 'downloading') {
          const pct = item._progress || 0;
          statusHtml = `<span class="status-badge status-downloading">Downloading</span>
            <div class="progress-bar-container">
              <div class="progress-bar" style="width:${pct}%"></div>
            </div>`;
        } else if (item.status === 'done') {
          statusHtml = '<span class="status-badge status-done">Done</span>';
        } else if (item.status === 'rejected') {
          statusHtml = '<span class="status-badge status-rejected">Rejected</span>';
        } else if (item.status === 'error') {
          statusHtml = '<span class="status-badge status-error">Error</span>';
        }

        let actionsHtml = '';
        if (item.status === 'pending') {
          actionsHtml = `
            <button class="action-btn btn-approve" onclick="djAction('approve','${item.id}')">Approve</button>
            <button class="action-btn btn-reject" onclick="djAction('reject','${item.id}')">Reject</button>
          `;
        }

        return `<tr class="${rowClass} ${flashClass}" data-id="${item.id}">
          <td class="guest-name">${esc(item.guestName)}</td>
          <td class="song-title">${esc(item.title)}</td>
          <td>${esc(item.author)}</td>
          <td>${formatDuration(item.duration)}</td>
          <td>${statusHtml}</td>
          <td>${actionsHtml}</td>
        </tr>`;
      })
      .join('');

    updateStats();
  }

  // --- Actions ---
  window.djAction = async function (action, id) {
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
        const item = queue.find((r) => r.id === data.id);
        if (item) {
          item.status = data.status;
          if (data.progress !== undefined) item._progress = data.progress;
        }
        renderQueue();
      }
    };

    ws.onclose = () => {
      setTimeout(connectWS, 2000);
    };
  }

  connectWS();
})();

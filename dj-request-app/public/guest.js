(function () {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const resultsEl = document.getElementById('results');
  const loadingEl = document.getElementById('loading');
  const emptyState = document.getElementById('emptyState');
  const modal = document.getElementById('modal');
  const modalClose = document.getElementById('modalClose');
  const modalThumb = document.getElementById('modalThumb');
  const modalTitle = document.getElementById('modalTitle');
  const modalArtist = document.getElementById('modalArtist');
  const modalDuration = document.getElementById('modalDuration');
  const guestNameInput = document.getElementById('guestNameInput');
  const submitRequest = document.getElementById('submitRequest');
  const toast = document.getElementById('toast');
  const ticker = document.getElementById('ticker');
  const queueList = document.getElementById('queueList');
  const ottoMessages = document.getElementById('ottoMessages');
  const ottoInput = document.getElementById('ottoInput');
  const ottoSend = document.getElementById('ottoSend');

  let selectedSong = null;
  let pendingQueue = [];

  // --- Format duration ---
  function formatDuration(secs) {
    if (!secs) return '';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // --- Escape HTML ---
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Queue Display ---
  function updateQueueDisplay() {
    const active = pendingQueue.filter(r => r.status !== 'rejected');
    if (!active.length) {
      queueList.innerHTML = '<li><span class="queue-empty">No requests yet — be the first!</span></li>';
      return;
    }
    queueList.innerHTML = active.map((r, i) => `
      <li>
        <span class="q-num">${i + 1}</span>
        <span class="q-title">${escapeHtml(r.title)}</span>
        <span class="q-guest">— ${escapeHtml(r.guestName)}</span>
        <span class="q-status ${r.status}">${r.status}</span>
      </li>
    `).join('');
  }

  // --- Ticker ---
  function updateTicker() {
    const pending = pendingQueue.filter(r => r.status === 'pending' || r.status === 'downloading');
    if (!pending.length) {
      ticker.innerHTML = '<span style="color:var(--text-secondary)">No requests yet — be the first!</span>';
      return;
    }
    const text = pending.map(r => `"${r.title}" — ${r.guestName}`).join('   ·   ');
    ticker.innerHTML = `<span>${escapeHtml(text)}</span>`;
  }

  // --- Otto Chat ---
  function addOttoMessage(text, type) {
    const div = document.createElement('div');
    div.className = `otto-msg ${type}`;
    div.textContent = text;
    ottoMessages.appendChild(div);
    ottoMessages.scrollTop = ottoMessages.scrollHeight;
  }

  async function sendToOtto() {
    const msg = ottoInput.value.trim();
    if (!msg) return;
    ottoInput.value = '';
    ottoSend.disabled = true;

    addOttoMessage(msg, 'user');
    addOttoMessage('...', 'system');

    try {
      const res = await fetch('/api/otto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      // Remove the "..." typing indicator
      const typing = ottoMessages.querySelector('.otto-msg.system:last-child');
      if (typing && typing.textContent === '...') typing.remove();
      addOttoMessage(data.reply || "Vibe check failed 📻", 'otto');
    } catch {
      const typing = ottoMessages.querySelector('.otto-msg.system:last-child');
      if (typing && typing.textContent === '...') typing.remove();
      addOttoMessage('Lost the signal — try again!', 'system');
    } finally {
      ottoSend.disabled = false;
      ottoInput.focus();
    }
  }

  ottoSend.addEventListener('click', sendToOtto);
  ottoInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendToOtto(); });

  // --- Search ---
  async function doSearch() {
    const q = searchInput.value.trim();
    if (!q) return;

    resultsEl.innerHTML = '';
    emptyState.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const results = await res.json();

      loadingEl.classList.add('hidden');

      if (!results.length) {
        emptyState.textContent = 'No results found';
        emptyState.classList.remove('hidden');
        return;
      }

      results.forEach((song) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <img class="card-thumb" src="${escapeHtml(song.thumbnail)}" alt="" loading="lazy">
          <div class="card-info">
            <div class="card-title">${escapeHtml(song.title)}</div>
            <div class="card-meta">
              <span class="card-author">${escapeHtml(song.author)}</span>
              <span>${formatDuration(song.duration)}</span>
            </div>
          </div>
        `;
        card.addEventListener('click', () => openModal(song));
        resultsEl.appendChild(card);
      });
    } catch {
      loadingEl.classList.add('hidden');
      emptyState.textContent = 'Search failed — try again';
      emptyState.classList.remove('hidden');
    }
  }

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  // --- Modal ---
  function openModal(song) {
    selectedSong = song;
    modalThumb.src = song.thumbnail;
    modalTitle.textContent = song.title;
    modalArtist.textContent = song.author;
    modalDuration.textContent = formatDuration(song.duration);
    guestNameInput.value = '';
    modal.classList.remove('hidden');
    guestNameInput.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    selectedSong = null;
  }

  modalClose.addEventListener('click', closeModal);
  document.querySelector('.modal-overlay').addEventListener('click', closeModal);

  // --- Submit request ---
  submitRequest.addEventListener('click', async () => {
    const guestName = guestNameInput.value.trim();
    if (!guestName) {
      guestNameInput.style.borderColor = 'var(--danger)';
      guestNameInput.focus();
      return;
    }
    if (!selectedSong) return;

    submitRequest.disabled = true;
    submitRequest.textContent = 'Submitting...';

    try {
      await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: selectedSong.videoId,
          title: selectedSong.title,
          author: selectedSong.author,
          duration: selectedSong.duration,
          thumbnail: selectedSong.thumbnail,
          guestName,
        }),
      });
      closeModal();
      showToast();
    } catch {
      alert('Failed to submit request');
    } finally {
      submitRequest.disabled = false;
      submitRequest.textContent = 'Request This Song';
    }
  });

  guestNameInput.addEventListener('input', () => { guestNameInput.style.borderColor = ''; });

  // --- Toast ---
  function showToast() {
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2500);
  }

  // --- WebSocket ---
  function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'queue') {
        pendingQueue = data.queue;
        updateQueueDisplay();
        updateTicker();
      } else if (data.type === 'new_request') {
        pendingQueue.push(data.item);
        updateQueueDisplay();
        updateTicker();
      } else if (data.type === 'status_update') {
        const item = pendingQueue.find(r => r.id === data.id);
        if (item) item.status = data.status;
        updateQueueDisplay();
        updateTicker();
      } else if (data.type === 'otto_roast') {
        addOttoMessage('😈 ' + data.reply, 'otto');
      } else if (data.type === 'otto_reply') {
        // Otto replied via broadcast (e.g. from DJ panel trigger)
        addOttoMessage(data.reply, 'otto');
      }
    };

    ws.onclose = () => setTimeout(connectWS, 2000);
  }

  connectWS();

  // --- Vibe Schedule Highlighter ---
  function updateScheduleHighlight() {
    const hour = new Date().getHours();
    const rows = document.querySelectorAll('#scheduleGrid .schedule-row');
    rows.forEach(row => {
      const start = parseInt(row.dataset.start);
      const end = parseInt(row.dataset.end);
      const active = hour >= start && hour < end;
      row.classList.toggle('active', active);
      const nowEl = row.querySelector('.s-now');
      if (nowEl) nowEl.textContent = active ? '▶ NOW' : '';
    });
  }
  updateScheduleHighlight();
  setInterval(updateScheduleHighlight, 60000);

})();

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

  let selectedSong = null;
  let pendingQueue = [];

  // --- Format duration ---
  function formatDuration(secs) {
    if (!secs) return '';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

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
    } catch (err) {
      loadingEl.classList.add('hidden');
      emptyState.textContent = 'Search failed — try again';
      emptyState.classList.remove('hidden');
    }
  }

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

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
    } catch (err) {
      alert('Failed to submit request');
    } finally {
      submitRequest.disabled = false;
      submitRequest.textContent = 'Request This Song';
    }
  });

  guestNameInput.addEventListener('input', () => {
    guestNameInput.style.borderColor = '';
  });

  // --- Toast ---
  function showToast() {
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2500);
  }

  // --- Ticker ---
  function updateTicker() {
    const pending = pendingQueue.filter((r) => r.status === 'pending' || r.status === 'downloading');
    if (!pending.length) {
      ticker.innerHTML = '<span style="color:var(--text-secondary)">No requests yet — be the first!</span>';
      return;
    }
    const text = pending.map((r) => `"${r.title}" — ${r.guestName}`).join('   ·   ');
    ticker.innerHTML = `<span>${escapeHtml(text)}</span>`;
  }

  // --- WebSocket ---
  function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'queue') {
        pendingQueue = data.queue;
        updateTicker();
      } else if (data.type === 'new_request') {
        pendingQueue.push(data.item);
        updateTicker();
      } else if (data.type === 'status_update') {
        const item = pendingQueue.find((r) => r.id === data.id);
        if (item) item.status = data.status;
        updateTicker();
      }
    };

    ws.onclose = () => {
      setTimeout(connectWS, 2000);
    };
  }

  connectWS();

  // --- Escape HTML ---
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();

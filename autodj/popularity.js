const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const LASTFM_API_KEY = '66750419e224e3ee4433e46456e0e5b4';
const LASTFM_BASE = 'http://ws.audioscrobbler.com/2.0/';
const CACHE_FILE = path.join(__dirname, 'popularity-cache.json');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RATE_LIMIT_MS = 250; // Last.fm allows ~5 req/sec

let cache = {};
let lastRequest = 0;

// Load cache from disk
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      const count = Object.keys(cache).length;
      console.log(`[Popularity] Loaded cache: ${count} entries`);
    }
  } catch (err) {
    console.log(`[Popularity] Cache load failed: ${err.message}`);
    cache = {};
  }
}

// Save cache to disk
function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
}

// Rate-limited fetch
async function rateLimitedFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, RATE_LIMIT_MS - (now - lastRequest));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequest = Date.now();
  return fetch(url);
}

// Cache key from artist + title
function cacheKey(artist, title) {
  return `${artist.toLowerCase().trim()}::${title.toLowerCase().trim()}`;
}

/**
 * Look up track popularity from Last.fm.
 * Returns { listeners, playcount, popularity } where popularity is 0.0–1.0 normalized.
 * Uses cache to avoid hammering the API.
 */
async function getTrackPopularity(artist, title) {
  const key = cacheKey(artist, title);

  // Check cache
  if (cache[key] && (Date.now() - cache[key].fetchedAt) < CACHE_MAX_AGE_MS) {
    return cache[key];
  }

  try {
    const url = `${LASTFM_BASE}?method=track.getInfo&api_key=${LASTFM_API_KEY}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&format=json`;
    const resp = await rateLimitedFetch(url);
    const data = await resp.json();

    if (data.track) {
      const listeners = parseInt(data.track.listeners) || 0;
      const playcount = parseInt(data.track.playcount) || 0;
      const genre = (data.track.toptags && data.track.toptags.tag && data.track.toptags.tag[0] && data.track.toptags.tag[0].name) || null;

      const entry = {
        artist,
        title,
        listeners,
        playcount,
        genre,
        fetchedAt: Date.now(),
      };

      cache[key] = entry;
      // Batch save every 20 lookups
      if (Object.keys(cache).length % 20 === 0) saveCache();

      return entry;
    }
  } catch (err) {
    // Silent fail — return unknown popularity
  }

  // Not found or error — cache as zero so we don't keep retrying
  const entry = { artist, title, listeners: 0, playcount: 0, fetchedAt: Date.now() };
  cache[key] = entry;
  return entry;
}

/**
 * Pre-fetch popularity for an array of tracks (from search engine index).
 * Runs in background, doesn't block. Logs progress.
 */
async function prefetchPopularity(tracks) {
  let fetched = 0;
  let skipped = 0;

  for (const track of tracks) {
    const key = cacheKey(track.artist, track.title);
    if (cache[key] && (Date.now() - cache[key].fetchedAt) < CACHE_MAX_AGE_MS) {
      skipped++;
      continue;
    }

    if (track.artist === 'Unknown') {
      skipped++;
      continue;
    }

    await getTrackPopularity(track.artist, track.title);
    fetched++;

    if (fetched % 50 === 0) {
      console.log(`[Popularity] Prefetch progress: ${fetched} fetched, ${skipped} cached`);
      saveCache();
    }
  }

  saveCache();
  console.log(`[Popularity] Prefetch complete: ${fetched} fetched, ${skipped} cached, ${Object.keys(cache).length} total`);
}

/**
 * Given an array of candidate tracks, return them weighted by popularity.
 * Uses a weighted random selection — popular tracks are more likely but
 * less popular ones still have a chance.
 *
 * @param {Array} candidates - tracks with { artist, title, path, ... }
 * @returns {Object|null} selected track (with .popularity added)
 */
function weightedPick(candidates) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Get listener counts from cache
  const withPop = candidates.map(t => {
    const key = cacheKey(t.artist, t.title);
    const cached = cache[key];
    const listeners = (cached && cached.listeners) || 0;
    return { ...t, listeners };
  });

  // Use log scale so mega-hits don't completely dominate
  // Add a floor of 100 so uncached tracks still have a chance
  const withWeights = withPop.map(t => ({
    ...t,
    weight: Math.log10(Math.max(t.listeners, 100)),
  }));

  const totalWeight = withWeights.reduce((sum, t) => sum + t.weight, 0);

  // Weighted random selection
  let roll = Math.random() * totalWeight;
  for (const t of withWeights) {
    roll -= t.weight;
    if (roll <= 0) {
      return { ...t, popularity: t.listeners };
    }
  }

  // Fallback
  return withWeights[withWeights.length - 1];
}

/**
 * Get cached genre for a track, or null if not available.
 */
function getGenre(artist, title) {
  const key = cacheKey(artist, title);
  const cached = cache[key];
  return (cached && cached.genre) || null;
}

/**
 * Get how many times a track has been skipped (from skip-log.json).
 */
const SKIP_LOG_FILE = path.join(__dirname, 'skip-log.json');

function getSkipCount(artist, title) {
  try {
    if (!fs.existsSync(SKIP_LOG_FILE)) return 0;
    const skips = JSON.parse(fs.readFileSync(SKIP_LOG_FILE, 'utf8'));
    const a = artist.toLowerCase().trim();
    const t = title.toLowerCase().trim();
    return skips.filter(s =>
      s.artist && s.title &&
      s.artist.toLowerCase().trim() === a &&
      s.title.toLowerCase().trim() === t
    ).length;
  } catch {
    return 0;
  }
}

// Initialize cache on load
loadCache();

module.exports = { getTrackPopularity, prefetchPopularity, weightedPick, saveCache, loadCache, getGenre, getSkipCount };

const path = require('path');
const fs = require('fs');
const os = require('os');
const { SearchEngine } = require('./search-engine');

const RECENTLY_PLAYED_SIZE = 30;

class Downloader {
  constructor() {
    // Initialize SearchEngine with default library paths (it handles them internally)
    this.searchEngine = new SearchEngine();
    this.recentlyPlayed = new Set();
    this.recentlyPlayedQueue = [];
  }

  markPlayed(videoId) {
    if (!videoId) return;
    if (this.recentlyPlayed.has(videoId)) return;
    this.recentlyPlayed.add(videoId);
    this.recentlyPlayedQueue.push(videoId);
    if (this.recentlyPlayedQueue.length > RECENTLY_PLAYED_SIZE) {
      const evicted = this.recentlyPlayedQueue.shift();
      this.recentlyPlayed.delete(evicted);
    }
  }

  /**
   * REFACTORED: Local-only search. NO YouTube fallback.
   * Returns { path, artist, title, album, genre, confidence } or throws "Not found in library"
   */
  searchAndDownload(query) {
    return new Promise((resolve, reject) => {
      console.log(`[Downloader] LOCAL SEARCH: "${query}"`);

      try {
        const result = this.searchEngine.searchBest(query);

        if (result) {
          console.log(`[Downloader] Found locally (${(result.confidence * 100).toFixed(0)}%): ${result.artist} - ${result.title}`);
          resolve({
            videoId: null,
            title: result.title,
            artist: result.artist,
            album: result.album,
            genre: result.genre,
            duration: 0,
            filePath: result.path,
            source: 'local',
          });
        } else {
          console.log(`[Downloader] NOT FOUND LOCALLY: "${query}" (confidence threshold: 0.5)`);
          reject(new Error(`Not found in library: "${query}"`));
        }
      } catch (err) {
        console.error(`[Downloader] Search error: ${err.message}`);
        reject(err);
      }
    });
  }

  /**
   * DISABLED: YouTube download (no longer called)
   */
  downloadTrack(videoId, title) {
    return Promise.reject(new Error('YouTube download disabled. Use local library only.'));
  }
}

module.exports = { Downloader };

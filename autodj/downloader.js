const { execSync, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DOWNLOAD_DIR = path.join(os.homedir(), 'Music', 'AutoDJ', 'cache');
const MAX_CACHE_FILES = 500;

function findBinary(name, fallback) {
  try {
    return execSync(`which ${name}`, { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

class Downloader {
  constructor() {
    this.ytdlp = findBinary('yt-dlp', '/opt/homebrew/bin/yt-dlp');
    this.ffmpeg = findBinary('ffmpeg', '/opt/homebrew/bin/ffmpeg');
    this.cache = new Map(); // videoId -> filePath

    // Ensure download dir exists
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  downloadTrack(videoId, title) {
    return new Promise((resolve, reject) => {
      if (this.cache.has(videoId)) {
        const cached = this.cache.get(videoId);
        if (fs.existsSync(cached)) {
          return resolve(cached);
        }
        this.cache.delete(videoId);
      }

      const safeTitle = (title || videoId).replace(/[^a-zA-Z0-9_\- ]/g, '').substring(0, 80);
      const outputTemplate = path.join(DOWNLOAD_DIR, `${videoId}_${safeTitle}.%(ext)s`);

      const args = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', outputTemplate,
        '--ffmpeg-location', this.ffmpeg,
        '--no-playlist',
        '--quiet',
      ];

      execFile(this.ytdlp, args, { timeout: 120000 }, (err) => {
        if (err) {
          return reject(new Error(`yt-dlp download failed: ${err.message}`));
        }

        // Find the output file
        const expectedPath = path.join(DOWNLOAD_DIR, `${videoId}_${safeTitle}.mp3`);
        if (fs.existsSync(expectedPath)) {
          this.cache.set(videoId, expectedPath);
          this._cleanupCache();
          return resolve(expectedPath);
        }

        // Fallback: find any MP3 file matching the videoId
        const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.startsWith(videoId) && f.endsWith('.mp3'));
        if (files.length > 0) {
          const filePath = path.join(DOWNLOAD_DIR, files[0]);
          this.cache.set(videoId, filePath);
          this._cleanupCache();
          return resolve(filePath);
        }

        reject(new Error('Download completed but output file not found'));
      });
    });
  }

  searchAndDownload(query) {
    return new Promise((resolve, reject) => {
      const args = [
        `ytsearch1:${query}`,
        '--dump-json',
        '--no-download',
        '--quiet',
      ];

      execFile(this.ytdlp, args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          return reject(new Error(`yt-dlp search failed: ${err.message}`));
        }

        let info;
        try {
          info = JSON.parse(stdout);
        } catch (e) {
          return reject(new Error('Failed to parse yt-dlp search result'));
        }

        const videoId = info.id;
        const title = info.title || 'Unknown';
        const author = info.uploader || info.channel || 'Unknown';
        const duration = info.duration || 0;

        this.downloadTrack(videoId, title)
          .then(filePath => {
            resolve({ videoId, title, author, duration, filePath });
          })
          .catch(reject);
      });
    });
  }

  _cleanupCache() {
    try {
      const files = fs.readdirSync(DOWNLOAD_DIR)
        .map(f => {
          const fp = path.join(DOWNLOAD_DIR, f);
          const stat = fs.statSync(fp);
          return { name: f, path: fp, mtime: stat.mtimeMs };
        })
        .sort((a, b) => a.mtime - b.mtime);

      if (files.length > MAX_CACHE_FILES) {
        const toDelete = files.slice(0, files.length - MAX_CACHE_FILES);
        for (const f of toDelete) {
          fs.unlinkSync(f.path);
          // Remove from cache map
          for (const [key, val] of this.cache) {
            if (val === f.path) {
              this.cache.delete(key);
              break;
            }
          }
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

module.exports = { Downloader };

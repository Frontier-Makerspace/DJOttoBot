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
      // Search top 15, pick most-viewed result under 10 minutes
      const args = [
        `ytsearch15:${query}`,
        '--dump-json',
        '--no-download',
        '--quiet',
      ];

      execFile(this.ytdlp, args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          return reject(new Error(`yt-dlp search failed: ${err.message}`));
        }

        // Parse JSONL — pick most-viewed track under 10 min
        const lines = stdout.trim().split('\n').filter(Boolean);
        const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const under10 = all.filter(v => v.duration && v.duration <= 600);
        // Sort by view count descending (may be 0/null if not returned)
        under10.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));

        let info = under10[0] || all[0]; // fallback to first result if nothing under 10 min

        if (!info) {
          return reject(new Error('No suitable tracks found'));
        }

        const videoId = info.id;
        const title = info.title || 'Unknown';
        const author = info.uploader || info.channel || 'Unknown';
        const duration = info.duration || 0;

        // Skip tracks over 10 minutes (600 seconds)
        if (duration > 600) {
          const shortQuery = `${query} short track`;
          const retryArgs = [`ytsearch3:${shortQuery}`, "--dump-json", "--no-download", "--flat-playlist", "--quiet"];
          execFile(this.ytdlp, retryArgs, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err2, stdout2) => {
            if (err2) return reject(new Error(`retry failed: ${err2.message}`));
            const lines = stdout2.trim().split("\n").filter(Boolean);
            const candidate = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
              .filter(Boolean).find(v => v.duration && v.duration <= 600);
            if (!candidate) return this.downloadTrack(videoId, title).then(fp => resolve({ videoId, title, author, duration, filePath: fp })).catch(reject);
            this.downloadTrack(candidate.id, candidate.title || title)
              .then(fp => resolve({ videoId: candidate.id, title: candidate.title || title, author: candidate.uploader || author, duration: candidate.duration, filePath: fp }))
              .catch(reject);
          });
          return;
        }

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

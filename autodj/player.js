const { EventEmitter } = require('events');
const { spawn, execSync } = require('child_process');
const path = require('path');

const FFPROBE = '/opt/homebrew/bin/ffprobe';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';

// BPM estimation by vibe/genre
const VIBE_BPM = {
  'Late Night':  [110, 130],
  'Morning':     [75, 95],
  'Afternoon':   [118, 130],
  'Evening':     [120, 140],
  'Peak Hours':  [130, 150],
};

function estimateBPM(vibeName) {
  const range = VIBE_BPM[vibeName] || [100, 140];
  return Math.floor(range[0] + Math.random() * (range[1] - range[0]));
}

// Try to detect BPM using ffmpeg astats (tempo estimation is not available in basic ffmpeg)
// We use a combo: try aubiotrack if available, else fall back to vibe-based estimate
async function detectBPM(filePath, vibeName) {
  // Try aubio beat tracker
  try {
    const aubioBeat = execSync(`which aubiotrack 2>/dev/null || echo ""`, { encoding: 'utf8' }).trim();
    if (aubioBeat) {
      const out = execSync(`aubiotrack "${filePath}" 2>/dev/null | head -20`, { encoding: 'utf8', timeout: 10000 });
      const beats = out.trim().split('\n').map(Number).filter(n => !isNaN(n) && n > 0);
      if (beats.length >= 2) {
        const intervals = [];
        for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i-1]);
        const avgInterval = intervals.reduce((a,b)=>a+b,0) / intervals.length;
        if (avgInterval > 0) return Math.round(60 / avgInterval);
      }
    }
  } catch(_) {}

  // Fall back to vibe-based estimate
  return estimateBPM(vibeName);
}

class Player extends EventEmitter {
  constructor() {
    super();
    this._process = null;
    this._playing = false;
    this.currentTrack = null;
    this.crossfadeMs = 3000;
    this._afplayAvailable = this._checkCommand('afplay');
    this._ffplayAvailable = this._checkCommand('ffplay');
  }

  _checkCommand(cmd) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  play(filePath, title, vibeName) {
    return new Promise((resolve, reject) => {
      // Stop only THIS player's process (don't kill all afplay globally)
      if (this._process && this._playing) {
        this.stop();
      }

      const trackTitle = title || path.basename(filePath, path.extname(filePath));

      // Get duration via ffprobe
      let trackDuration = null;
      try {
        const probe = execSync(
          `${FFPROBE} -v quiet -print_format json -show_format "${filePath}"`,
          { timeout: 5000, encoding: 'utf8' }
        );
        const info = JSON.parse(probe);
        trackDuration = parseFloat(info.format && info.format.duration) || null;
      } catch(_) {}

      // Extract videoId from filename (format: VIDEOID_title.mp3)
      const basename = path.basename(filePath, path.extname(filePath));
      const videoId = basename.split('_')[0] || null;

      this.currentTrack = {
        title: trackTitle,
        filePath,
        startedAt: new Date(),
        duration: trackDuration,
        videoId,
        bpm: null, // will be filled async
      };

      // Detect BPM asynchronously
      detectBPM(filePath, vibeName || 'Afternoon').then(bpm => {
        if (this.currentTrack && this.currentTrack.filePath === filePath) {
          this.currentTrack.bpm = bpm;
        }
      }).catch(() => {
        if (this.currentTrack && this.currentTrack.filePath === filePath) {
          this.currentTrack.bpm = estimateBPM(vibeName || 'Afternoon');
        }
      });

      let proc;
      if (this._afplayAvailable) {
        proc = spawn('afplay', ['-q', '1', filePath], { stdio: 'ignore' });
      } else if (this._ffplayAvailable) {
        proc = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath], { stdio: 'ignore' });
      } else {
        const err = new Error('No audio player available (need afplay or ffplay)');
        this.emit('error', err);
        return reject(err);
      }

      this._process = proc;
      this._playing = true;
      const trackInfo = this.currentTrack;
      this.emit('started', trackInfo);

      proc.on('close', (code) => {
        // Only update state if this is still the active process
        // (crossfadeTo may have already replaced it)
        const wasActive = this._process === proc;
        if (wasActive) {
          this._playing = false;
          this._process = null;
          this.currentTrack = null;
        }
        if (wasActive) {
          if (code === 0 || code === null) {
            this.emit('finished', trackInfo);
          } else {
            this.emit('error', new Error(`Playback exited with code ${code}`));
          }
        }
        resolve(trackInfo);
      });

      proc.on('error', (err) => {
        if (this._process === proc) {
          this._playing = false;
          this._process = null;
          this.currentTrack = null;
        }
        this.emit('error', err);
        reject(err);
      });
    });
  }

  /**
   * Crossfade from the currently playing track to a new track.
   * Starts the next track at low volume overlapping the current one,
   * then kills the old track after crossfadeMs and continues at full volume.
   * Emits 'finished' for the old track and 'started' for the new track.
   * Returns a promise that resolves when the new track finishes playing.
   */
  crossfadeTo(nextFilePath, nextTitle, vibeName) {
    return new Promise((resolve, reject) => {
      const oldProcess = this._process;
      const oldTrack = this.currentTrack;

      // Nothing playing — fall back to normal play
      if (!oldProcess || !this._playing) {
        return this.play(nextFilePath, nextTitle, vibeName).then(resolve, reject);
      }

      const trackTitle = nextTitle || path.basename(nextFilePath, path.extname(nextFilePath));

      // Get duration via ffprobe
      let trackDuration = null;
      try {
        const probe = execSync(
          `${FFPROBE} -v quiet -print_format json -show_format "${nextFilePath}"`,
          { timeout: 5000, encoding: 'utf8' }
        );
        const info = JSON.parse(probe);
        trackDuration = parseFloat(info.format && info.format.duration) || null;
      } catch(_) {}

      const basename = path.basename(nextFilePath, path.extname(nextFilePath));
      const videoId = basename.split('_')[0] || null;

      const newTrack = {
        title: trackTitle,
        filePath: nextFilePath,
        startedAt: new Date(),
        duration: trackDuration,
        videoId,
        bpm: null,
      };

      // Detect BPM asynchronously
      detectBPM(nextFilePath, vibeName || 'Afternoon').then(bpm => {
        if (this.currentTrack && this.currentTrack.filePath === nextFilePath) {
          this.currentTrack.bpm = bpm;
        }
      }).catch(() => {});

      // Deactivate old process so its close handler won't emit events
      this._process = null;

      // Start preview of next track at low volume (overlap with current)
      let previewProc;
      if (this._afplayAvailable) {
        previewProc = spawn('afplay', ['-q', '1', '-v', '0.2', nextFilePath], { stdio: 'ignore' });
      } else if (this._ffplayAvailable) {
        previewProc = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', '20', nextFilePath], { stdio: 'ignore' });
      } else {
        return reject(new Error('No audio player available (need afplay or ffplay)'));
      }

      // After crossfade period: kill old, upgrade to full volume
      setTimeout(() => {
        // Kill old track
        oldProcess.kill('SIGTERM');
        this.emit('finished', oldTrack);

        // Kill low-volume preview, start full-volume playback
        previewProc.kill('SIGTERM');

        let fullProc;
        if (this._afplayAvailable) {
          fullProc = spawn('afplay', ['-q', '1', nextFilePath], { stdio: 'ignore' });
        } else {
          fullProc = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', nextFilePath], { stdio: 'ignore' });
        }

        this._process = fullProc;
        this._playing = true;
        this.currentTrack = newTrack;
        this.emit('started', newTrack);

        fullProc.on('close', (code) => {
          const wasActive = this._process === fullProc;
          if (wasActive) {
            this._playing = false;
            this._process = null;
            this.currentTrack = null;
          }
          if (wasActive) {
            if (code === 0 || code === null) {
              this.emit('finished', newTrack);
            } else {
              this.emit('error', new Error(`Playback exited with code ${code}`));
            }
          }
          resolve(newTrack);
        });

        fullProc.on('error', (err) => {
          if (this._process === fullProc) {
            this._playing = false;
            this._process = null;
            this.currentTrack = null;
          }
          this.emit('error', err);
          reject(err);
        });
      }, this.crossfadeMs);
    });
  }

  stop() {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
      this._playing = false;
      this.currentTrack = null;
    }
  }

  isPlaying() {
    return this._playing;
  }
}

module.exports = { Player, detectBPM, estimateBPM };

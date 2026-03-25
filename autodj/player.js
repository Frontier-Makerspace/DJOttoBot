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
        // Wait briefly for it to die
        const start = Date.now();
        while (this._playing && Date.now() - start < 1000) {
          require('child_process').execSync('sleep 0.1');
        }
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
      this.emit('started', this.currentTrack);

      proc.on('close', (code) => {
        this._playing = false;
        this._process = null;
        const track = this.currentTrack;
        this.currentTrack = null;
        if (code === 0 || code === null) {
          this.emit('finished', track);
          resolve(track);
        } else {
          const err = new Error(`Playback exited with code ${code}`);
          this.emit('error', err);
          resolve(track); // still resolve so main loop continues
        }
      });

      proc.on('error', (err) => {
        this._playing = false;
        this._process = null;
        this.currentTrack = null;
        this.emit('error', err);
        reject(err);
      });
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

module.exports = { Player };

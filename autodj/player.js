const { EventEmitter } = require('events');
const { spawn, execSync } = require('child_process');
const path = require('path');

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

  play(filePath, title) {
    return new Promise((resolve, reject) => {
      if (this._playing) {
        this.stop();
      }

      const trackTitle = title || path.basename(filePath, path.extname(filePath));
      this.currentTrack = {
        title: trackTitle,
        filePath,
        startedAt: new Date(),
        duration: null,
      };

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

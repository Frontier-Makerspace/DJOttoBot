# DJOttoBot 🎛️🤖

PROTO7YPE's 24/7 AI DJ system. Guest song requests + autonomous playback for the makerspace.

## Packages

### `dj-request-app/`
Guest-facing song request kiosk + DJ control panel.

- **Guest UI** (`/`) — Search YouTube, submit requests with your name. Designed for Android tablet in kiosk mode.
- **DJ Panel** (`/dj`) — Live request queue, approve/reject, triggers download to `~/Music/MP3/`
- Real-time via WebSockets
- Two themes: Default Dark + PROTO7YPE (glitch aesthetic)

**Run:**
```bash
cd dj-request-app && npm install && npm start
# Guest: http://[mac-ip]:3000
# DJ Panel: http://localhost:3000/dj
```

### `autodj/`
Autonomous DJ bot that runs 24/7 on the makerspace Mac Mini.

- Connects to `dj-request-app` via WebSocket — plays approved requests automatically
- Auto-picks songs from YouTube when queue is empty (time-based vibes)
- Falls back to local files in `~/Music/AutoDJ/`
- Pre-downloads next track during playback (no gaps)
- Control API on port 3001

**Vibe schedule:**
| Hours | Vibe | Style |
|-------|------|-------|
| 0–6 | Late Night | Dark ambient, EBM, cold wave |
| 7–11 | Morning | Lo-fi, downtempo, chill beats |
| 12–17 | Afternoon | House, deep house, nu disco |
| 18–21 | Evening | Techno, dark techno, EBM |
| 22–23 | Peak Hours | Hard techno, industrial |

**Modes:**
- `BOT` — Full auto (default)
- `ASSIST` — Requests only, no auto-picks
- `OVERRIDE` — Bot pauses, live DJ has the floor

**Run:**
```bash
cd autodj && npm install && npm start
```

**Control API:**
```bash
curl http://localhost:3001/status
curl -X POST http://localhost:3001/skip
curl -X POST http://localhost:3001/mode -H "Content-Type: application/json" -d '{"mode":"OVERRIDE"}'
curl -X POST http://localhost:3001/vibe -H "Content-Type: application/json" -d '{"vibe":"Peak Hours"}'
curl -X POST http://localhost:3001/queue -H "Content-Type: application/json" -d '{"query":"Aphex Twin"}'
```

### `visualizer/`
Full-screen TV visualizer for ambient display. Designed for landscape TV via Chrome kiosk mode.

- Audio-reactive canvas visualization (Web Audio API) with generative Lissajous fallback
- Real-time track info, vibe badge, mode indicator, and guest request toasts via WebSocket
- Vibe-aware color themes matching the autodj schedule
- Glitch effects on track changes + periodic venue name glitch
- PROTO7YPE branding with Share Tech Mono font

**Run:**
```bash
cd visualizer && npm install && npm start
# Open: http://localhost:3002
# Kiosk: chrome --kiosk --app=http://localhost:3002
```

**WebSocket events forwarded from autodj (3001) and dj-request-app (3000):**
- `nowPlaying` — `{ title, author, vibe, mode }`
- `request` — `{ guestName, title }`
- `queue` — queue array

Falls back to polling `http://localhost:3001/status` every 5s.

---

## Quick Setup (Mac Mini)

A setup script is included for fresh installs:

```bash
bash setup.sh
```

This will:
1. Install Xcode CLI tools, Homebrew, Node.js, yt-dlp, ffmpeg, Google Chrome
2. Clone the repo to `~/DJOttoBot/`
3. Install Node dependencies for all three packages
4. Create music directories (`~/Music/MP3/`, `~/Music/AutoDJ/`)
5. Install and load all four launchd services (auto-start on login)
6. Enable SSH (Remote Login)

Or manually:
1. Install dependencies: `brew install yt-dlp ffmpeg ollama`
2. Start request app: `cd dj-request-app && npm start`
3. Start AutoDJ bot: `cd autodj && npm start`
4. Start visualizer: `cd visualizer && npm start`
5. Point tablet browser to `http://[mac-mini-ip]:3000`
6. Open DJ panel at `http://localhost:3000/dj`
7. Open visualizer on TV: Chrome kiosk to `http://localhost:3002`

## Requirements
- macOS (uses `afplay` for audio)
- Node.js 18+
- yt-dlp + ffmpeg (`brew install yt-dlp ffmpeg`)
- [Ollama](https://ollama.com) with `llama3.2` (optional but recommended)

**Ollama** powers AI vibe checks, request roasting, and genre detection in the DJ panel. The system runs fine without it — those features are gracefully disabled if Ollama isn't available.

```bash
# Install Ollama
brew install ollama

# Pull the required model
ollama pull llama3.2

# Start the Ollama server (runs on localhost:11434)
ollama serve
```

Ollama can also be set to auto-start via launchd — see the [Ollama docs](https://ollama.com/download/mac) for details.

---

## launchd Services

Four services are installed to `~/Library/LaunchAgents/` by `setup.sh`:

| Label | Description | Port |
|---|---|---|
| `com.djottobot.requests` | Guest kiosk + DJ panel | 3000 |
| `com.djottobot.autodj` | Autonomous DJ bot | 3001 |
| `com.djottobot.visualizer` | TV visualizer | 3002 |
| `com.djottobot.kiosk` | Chrome kiosk launcher | — |

**Manage services:**
```bash
# Restart autodj
launchctl kickstart -k gui/$(id -u)/com.djottobot.autodj

# Stop a service
launchctl unload ~/Library/LaunchAgents/com.djottobot.autodj.plist

# Start a service
launchctl load ~/Library/LaunchAgents/com.djottobot.autodj.plist

# View logs
tail -f ~/Music/AutoDJ/autodj.log
tail -f ~/Music/AutoDJ/autodj-error.log
```

---

## Troubleshooting

### AutoDJ gets stuck repeating the same song
This is a known issue — the bot can get into a loop every 5–10 minutes. Restart the service to fix it:
```bash
launchctl kickstart -k gui/$(id -u)/com.djottobot.autodj
```
Root cause is under investigation (likely in `player.js` or `search-engine.js`).

### No audio
- Check that `afplay` is working: `afplay /System/Library/Sounds/Ping.aiff`
- Check autodj logs: `tail -f ~/Music/AutoDJ/autodj.log`
- Make sure the Mac Mini's audio output is set to the correct device in System Settings → Sound

### yt-dlp errors / no search results
- Update yt-dlp: `brew upgrade yt-dlp`
- Test manually: `yt-dlp --get-title "ytsearch1:Aphex Twin"`

### Visualizer blank / not updating
- Check that autodj is running: `curl http://localhost:3001/status`
- Hard-refresh Chrome: Cmd+Shift+R
- Check visualizer logs: `tail -f ~/Music/AutoDJ/visualizer.log`

### Guest kiosk not reachable from tablet
- Find the Mac Mini's IP: `ipconfig getifaddr en0`
- Make sure firewall allows port 3000: System Settings → Network → Firewall

---

## Music Directories

| Path | Purpose |
|---|---|
| `~/Music/AutoDJ/` | Local fallback tracks (MP3s) |
| `~/Music/MP3/` | Downloaded approved requests |
| `~/Music/AutoDJ/cache/` | yt-dlp download cache |

Drop local MP3s in `~/Music/AutoDJ/` for fallback playback when YouTube is unavailable.

---

## SSH Access

```bash
ssh otto@[mac-mini-ip]
```

Enable via: System Settings → General → Sharing → Remote Login

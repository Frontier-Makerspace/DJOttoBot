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

## Setup (Mac Mini)

1. Install dependencies: `brew install yt-dlp ffmpeg`
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

#!/bin/bash
# DJOttoBot Mac Mini Setup Script
# Run this on a fresh macOS install as your normal user (not root)
# Usage: bash setup.sh

set -e
echo "🎛️  DJOttoBot Setup Starting..."

# --- 1. Xcode CLI Tools ---
echo "\n[1/7] Installing Xcode CLI tools..."
xcode-select --install 2>/dev/null || echo "Already installed"
sudo xcodebuild -license accept 2>/dev/null || true

# --- 2. Homebrew ---
echo "\n[2/7] Installing Homebrew..."
if ! command -v brew &>/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  eval "$(/opt/homebrew/bin/brew shellenv)"
else
  echo "Homebrew already installed"
fi

# --- 3. Dependencies ---
echo "\n[3/7] Installing dependencies..."
brew install node yt-dlp ffmpeg

# --- 4. Clone repo ---
echo "\n[4/7] Cloning DJOttoBot..."
mkdir -p ~/DJOttoBot
cd ~/DJOttoBot
if [ ! -d ".git" ]; then
  git clone https://github.com/Frontier-Makerspace/DJOttoBot.git .
else
  git pull
fi

# --- 5. Install Node deps ---
echo "\n[5/7] Installing Node.js dependencies..."
cd ~/DJOttoBot/dj-request-app && npm install
cd ~/DJOttoBot/autodj && npm install

# --- 6. Create music dirs ---
echo "\n[6/7] Creating music directories..."
mkdir -p ~/Music/MP3
mkdir -p ~/Music/AutoDJ
mkdir -p ~/Music/AutoDJ/cache

# --- 7. Install launchd services ---
echo "\n[7/7] Installing launchd auto-start services..."

# dj-request-app service (port 3000)
cat > ~/Library/LaunchAgents/com.djottobot.requests.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.djottobot.requests</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>$(echo ~/DJOttoBot/dj-request-app/server.js)</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(echo ~/DJOttoBot/dj-request-app)</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(echo ~/Music/AutoDJ/requests.log)</string>
  <key>StandardErrorPath</key>
  <string>$(echo ~/Music/AutoDJ/requests-error.log)</string>
</dict>
</plist>
EOF

# autodj service (port 3001)
cat > ~/Library/LaunchAgents/com.djottobot.autodj.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.djottobot.autodj</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>$(echo ~/DJOttoBot/autodj/autodj.js)</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(echo ~/DJOttoBot/autodj)</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(echo ~/Music/AutoDJ/autodj.log)</string>
  <key>StandardErrorPath</key>
  <string>$(echo ~/Music/AutoDJ/autodj-error.log)</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.djottobot.requests.plist
launchctl load ~/Library/LaunchAgents/com.djottobot.autodj.plist

# --- Done ---
echo "\n✅ DJOttoBot setup complete!\n"
echo "Services started and will auto-restart on boot."
echo ""
echo "📡 Find your IP address:"
ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo "(check System Settings → Network)"
echo ""
echo "🎛️  URLs:"
echo "  Guest kiosk:  http://[your-ip]:3000"
echo "  DJ panel:     http://[your-ip]:3000/dj"
echo "  Bot status:   http://localhost:3001/status"
echo ""
echo "🎵 Drop local MP3s in: ~/Music/AutoDJ/"
echo "📥 Approved requests download to: ~/Music/MP3/"
echo ""
echo "🔧 Control commands:"
echo "  Skip track:      curl -X POST http://localhost:3001/skip"
echo "  Override mode:   curl -X POST http://localhost:3001/mode -H 'Content-Type: application/json' -d '{\"mode\":\"OVERRIDE\"}'"
echo "  Resume bot:      curl -X POST http://localhost:3001/mode -H 'Content-Type: application/json' -d '{\"mode\":\"BOT\"}'"
echo "  What's playing:  curl http://localhost:3001/status"

#!/bin/bash
# DJOttoBot Mac Mini Setup Script
# Run this on a fresh macOS install as your normal user (not root)
# Usage: bash setup.sh

set -e
echo "🎛️  DJOttoBot Setup Starting..."

# --- 1. Xcode CLI Tools ---
echo "\n[1/8] Installing Xcode CLI tools..."
xcode-select --install 2>/dev/null || echo "Already installed"
sudo xcodebuild -license accept 2>/dev/null || true

# --- 2. Homebrew ---
echo "\n[2/8] Installing Homebrew..."
if ! command -v brew &>/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  eval "$(/opt/homebrew/bin/brew shellenv)"
else
  echo "Homebrew already installed"
fi

# --- 3. Dependencies ---
echo "\n[3/8] Installing dependencies..."
brew install node yt-dlp ffmpeg

# Install Google Chrome if not present
if [ ! -d "/Applications/Google Chrome.app" ]; then
  echo "Installing Google Chrome..."
  brew install --cask google-chrome
else
  echo "Chrome already installed"
fi

# --- 4. Clone repo ---
echo "\n[4/8] Cloning DJOttoBot..."
mkdir -p ~/DJOttoBot
cd ~/DJOttoBot
if [ ! -d ".git" ]; then
  git clone https://github.com/Frontier-Makerspace/DJOttoBot.git .
else
  git pull
fi

# --- 5. Install Node deps ---
echo "\n[5/8] Installing Node.js dependencies..."
cd ~/DJOttoBot/dj-request-app && npm install
cd ~/DJOttoBot/autodj && npm install
cd ~/DJOttoBot/visualizer && npm install

# --- 6. Create music dirs ---
echo "\n[6/8] Creating music directories..."
mkdir -p ~/Music/MP3
mkdir -p ~/Music/AutoDJ
mkdir -p ~/Music/AutoDJ/cache

# --- 7. Install launchd services ---
echo "\n[7/8] Installing launchd auto-start services..."

NODE=/opt/homebrew/bin/node
DJROOT=$HOME/DJOttoBot
LOGDIR=$HOME/Music/AutoDJ

# dj-request-app (port 3000)
cat > ~/Library/LaunchAgents/com.djottobot.requests.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.djottobot.requests</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DJROOT/dj-request-app/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DJROOT/dj-request-app</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/requests.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/requests-error.log</string>
</dict>
</plist>
EOF

# autodj bot (port 3001)
cat > ~/Library/LaunchAgents/com.djottobot.autodj.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.djottobot.autodj</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DJROOT/autodj/autodj.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DJROOT/autodj</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/autodj.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/autodj-error.log</string>
</dict>
</plist>
EOF

# visualizer (port 3002)
cat > ~/Library/LaunchAgents/com.djottobot.visualizer.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.djottobot.visualizer</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DJROOT/visualizer/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DJROOT/visualizer</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/visualizer.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/visualizer-error.log</string>
</dict>
</plist>
EOF

# Chrome kiosk — opens visualizer on TV after 8s delay (services need time to start)
cat > ~/Library/LaunchAgents/com.djottobot.kiosk.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.djottobot.kiosk</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>sleep 8 &amp;&amp; /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-features=TranslateUI --check-for-update-interval=31536000 http://localhost:3002</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/kiosk.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/kiosk-error.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.djottobot.requests.plist
launchctl load ~/Library/LaunchAgents/com.djottobot.autodj.plist
launchctl load ~/Library/LaunchAgents/com.djottobot.visualizer.plist
launchctl load ~/Library/LaunchAgents/com.djottobot.kiosk.plist

# --- 8. Enable SSH ---
echo "\n[8/8] Enabling SSH (Remote Login)..."
sudo systemsetup -setremotelogin on 2>/dev/null || \
  echo "⚠️  Enable SSH manually: System Settings → General → Sharing → Remote Login"

# --- Done ---
MY_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "[your-ip]")

echo "\n✅ DJOttoBot setup complete!\n"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📡 This machine's IP: $MY_IP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎛️  URLs:"
echo "  Guest kiosk:   http://$MY_IP:3000"
echo "  DJ panel:      http://$MY_IP:3000/dj"
echo "  Visualizer TV: http://localhost:3002  (auto-launched in Chrome)"
echo "  Bot status:    http://localhost:3001/status"
echo ""
echo "🎵 Drop local MP3s in: ~/Music/AutoDJ/"
echo "📥 Approved requests land in: ~/Music/MP3/"
echo ""
echo "🔧 Quick controls:"
echo "  Skip:          curl -X POST http://localhost:3001/skip"
echo "  Override (live DJ): curl -X POST http://localhost:3001/mode -d '{\"mode\":\"OVERRIDE\"}' -H 'Content-Type: application/json'"
echo "  Resume bot:    curl -X POST http://localhost:3001/mode -d '{\"mode\":\"BOT\"}' -H 'Content-Type: application/json'"
echo "  What's playing: curl http://localhost:3001/status"
echo ""
echo "🔑 SSH access: ssh otto@$MY_IP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

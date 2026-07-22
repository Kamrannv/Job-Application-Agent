#!/bin/bash
# Registers the bot with macOS launchd so it starts at login and restarts if it crashes.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(which node)"
LABEL="com.kamran.iosjobbot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/src/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/data/bot.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/bot.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed. The bot now starts automatically at login."
echo
echo "  Logs:    tail -f $DIR/data/bot.log"
echo "  Stop:    launchctl unload $PLIST"
echo "  Restart: launchctl unload $PLIST && launchctl load $PLIST"

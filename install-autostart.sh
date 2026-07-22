#!/bin/bash
# Registers the bot with macOS launchd so it starts at login and restarts if it crashes.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(which node)"
LABEL="com.kamran.iosjobbot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# The log must live outside ~/Desktop, ~/Documents and ~/Downloads. macOS
# privacy protection (TCC) blocks launchd from creating files there, and it
# fails silently — the service just exits 78 with no output anywhere.
LOG="$HOME/Library/Logs/$LABEL.log"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$DIR/data"

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
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed. The bot now starts automatically at login."
echo
echo "  Logs:    tail -f $LOG"
echo "  Stop:    launchctl unload $PLIST"
echo "  Restart: launchctl unload $PLIST && launchctl load $PLIST"

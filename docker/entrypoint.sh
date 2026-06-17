#!/bin/bash
set -e

# ----------------------------------------------------------------
# Entrypoint for the Discord Tesla RPC Docker container
#
# Starts:
#   1. Xvfb  — virtual display for Discord
#   2. fluxbox — lightweight window manager
#   3. x11vnc + noVNC — browser-based VNC access (port 6080)
#   4. Discord — headless Discord client
#   5. Node.js RPC app — the actual Tesla RPC service
# ----------------------------------------------------------------

export DISPLAY=:99
export XDG_RUNTIME_DIR=/tmp/runtime
mkdir -p "$XDG_RUNTIME_DIR"

echo "╔══════════════════════════════════════════════════╗"
echo "║   Discord Tesla RPC — Docker Container          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# --- 1. Virtual display ---
echo "[1/5] Starting virtual display..."
Xvfb :99 -screen 0 1024x768x24 -ac &
sleep 1

# --- 2. Window manager ---
echo "[2/5] Starting window manager..."
fluxbox &
sleep 1

# --- 3. VNC + noVNC for browser access ---
echo "[3/5] Starting VNC server..."
x11vnc -display :99 -nopw -listen 0.0.0.0 -rfbport 5900 -forever -shared -bg
echo "[3/5] Starting noVNC web interface on port 6080..."
/opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &
sleep 1

# --- 4. Discord ---
echo "[4/5] Starting Discord..."
# Disable auto-update prompts and hardware acceleration
mkdir -p /root/.config/discord
cat > /root/.config/discord/settings.json <<EOF
{
  "SKIP_HOST_UPDATE": true,
  "IS_MAXIMIZED": false,
  "IS_MINIMIZED": false,
  "WINDOW_BOUNDS": {"x":0,"y":0,"width":1024,"height":768}
}
EOF

discord --no-sandbox &
DISCORD_PID=$!

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Discord is starting up...                      ║"
echo "║                                                 ║"
echo "║  If this is your FIRST RUN, open a browser to:  ║"
echo "║                                                 ║"
echo "║    http://<your-server-ip>:6080                 ║"
echo "║                                                 ║"
echo "║  to log into Discord via the web VNC interface. ║"
echo "║  After that, Discord stays logged in.           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Wait for Discord IPC socket to appear
echo "[4/5] Waiting for Discord IPC socket..."
ATTEMPTS=0
MAX_ATTEMPTS=60
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  # Check common socket locations
  if ls /tmp/discord-ipc-* 2>/dev/null 1>&2 || \
     ls "$XDG_RUNTIME_DIR/discord-ipc-*" 2>/dev/null 1>&2; then
    echo "[4/5] ✅ Discord IPC socket found!"
    break
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 2
done

if [ $ATTEMPTS -eq $MAX_ATTEMPTS ]; then
  echo "⚠ Discord IPC socket not found after ${MAX_ATTEMPTS} attempts."
  echo "  Make sure Discord is logged in via the VNC interface."
  echo "  The RPC app will keep retrying..."
fi

# --- 5. Node.js RPC app ---
echo "[5/5] Starting Tesla RPC service..."
echo ""

cd /app
exec node headless/index.js

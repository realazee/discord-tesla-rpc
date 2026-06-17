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
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset &>/dev/null &
sleep 1

# --- 2. Window manager (suppress config spam) ---
echo "[2/5] Starting window manager..."
fluxbox &>/dev/null &
sleep 1

# --- 3. VNC + noVNC for browser access ---
echo "[3/5] Starting VNC server..."
x11vnc -display :99 -nopw -listen 0.0.0.0 -rfbport 5900 -forever -shared -bg -q 2>/dev/null
/opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &>/dev/null &
sleep 1

# --- 4. Discord ---
echo "[4/5] Starting Discord..."

# Start D-Bus session bus (prevents dbus connection spam)
eval $(dbus-launch --sh-syntax) 2>/dev/null || true

# Disable auto-update prompts
mkdir -p /root/.config/discord
cat > /root/.config/discord/settings.json <<EOF
{
  "SKIP_HOST_UPDATE": true,
  "IS_MAXIMIZED": false,
  "IS_MINIMIZED": false,
  "WINDOW_BOUNDS": {"x":0,"y":0,"width":1024,"height":768}
}
EOF

# Clear GPU cache (prevents stale state from causing hangs)
rm -rf /root/.config/discord/GPUCache /root/.config/discord/Cache 2>/dev/null || true

discord --no-sandbox --disable-gpu --disable-software-rasterizer --disable-gpu-compositing &>/dev/null &

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

# Give Discord time to start and create its IPC socket
echo "[4/5] Waiting 15s for Discord to initialize..."
sleep 15

# --- 5. Node.js RPC app ---
echo "[5/5] Starting Tesla RPC service..."
echo ""

cd /app
exec node headless/index.js

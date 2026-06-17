# ═══════════════════════════════════════════════════════════════
# Discord Tesla RPC — All-in-One Docker Image
#
# Includes: Discord (headless) + Node.js RPC app + VNC access
# ═══════════════════════════════════════════════════════════════

FROM node:20-bookworm

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# ── System dependencies ──────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Virtual display
    xvfb \
    # Window manager (Discord needs one)
    fluxbox \
    # VNC server for browser-based access
    x11vnc \
    # noVNC dependencies
    python3 python3-numpy \
    # Discord dependencies
    libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils \
    libatspi2.0-0 libsecret-1-0 libgbm1 libasound2 libpulse0 \
    libdrm2 libxshmfence1 libgl1-mesa-glx \
    fonts-liberation fonts-noto-color-emoji \
    # Utilities
    wget curl ca-certificates procps dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# ── Install noVNC ────────────────────────────────────────────
RUN git clone --depth 1 https://github.com/novnc/noVNC.git /opt/noVNC && \
    git clone --depth 1 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify && \
    ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

# ── Install Discord ──────────────────────────────────────────
RUN wget -q -O /tmp/discord.deb "https://discord.com/api/download?platform=linux&format=deb" && \
    dpkg -i /tmp/discord.deb || apt-get -f install -y && \
    rm /tmp/discord.deb

# ── App setup ────────────────────────────────────────────────
WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source code
COPY src/ ./src/
COPY headless/ ./headless/

# Copy entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ── Volumes ──────────────────────────────────────────────────
# Persist Discord login and Tesla tokens across restarts
VOLUME ["/root/.config/discord", "/app/.tokens.json"]

# ── Ports ────────────────────────────────────────────────────
# 6080 = noVNC web interface (for Discord login)
# 8888 = Tesla OAuth callback
EXPOSE 6080 8888

# ── Health check ─────────────────────────────────────────────
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
    CMD pgrep -f "headless/index.js" > /dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]

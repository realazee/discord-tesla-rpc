# Discord Tesla RPC

Display real-time Tesla vehicle data on your Discord profile — speed, street name, battery, temperature, and more — like a FiveM or game server RPC.

![Preview](https://img.shields.io/badge/status-alpha-orange) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Docker-blue)

## Features

- **Real-time vehicle metrics** — Speed, gear, battery %, range, temperatures, odometer, sentry mode
- **Car model detection** — Automatically identifies your Tesla model
- **Street & location** — Reverse-geocoded from GPS coordinates via OpenStreetMap
- **Per-metric toggles** — Choose exactly what shows on your profile
- **Smart polling** — 30s while driving, 5min while parked, skips when car is asleep
- **Sleep presence** — Shows "Vehicle Asleep" on Discord when the car is sleeping
- **Auto token refresh** — Never re-authenticate manually
- **Two deployment modes:**
  - 🖥️ **Desktop App** — Electron GUI with system tray (macOS/Windows/Linux)
  - 🐳 **Docker** — Headless container with built-in Discord (for homelabs)

## Prerequisites

### 1. Tesla Developer Application

Tesla requires a **public HTTPS domain** for app registration. A small Cloudflare Worker is included to handle this — it serves the public key and bounces the OAuth callback to your local app.

#### a) Deploy the Cloudflare Worker

```bash
# Generate your Tesla key pair
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out com.tesla.3p.public-key.pem

# Deploy the worker (update wrangler.toml with your account)
cd worker
npx wrangler deploy

# Upload the public key as a secret
cat ../com.tesla.3p.public-key.pem | npx wrangler secret put TESLA_PUBLIC_KEY
```

Then add a custom domain in Cloudflare Dashboard:
**Workers & Pages → tesla-discord-rpc → Domains** → add `tesla-rpc.yourdomain.com`

#### b) Register the Tesla App

1. Go to [developer.tesla.com](https://developer.tesla.com) and sign in
2. Create a new application
3. Note your **Client ID** and **Client Secret**
4. Set the **Allowed Origin** to `https://tesla-rpc.yourdomain.com`
5. Set the **Redirect URI** to `https://tesla-rpc.yourdomain.com/callback`
6. Request scopes: `vehicle_device_data`, `vehicle_location`

### 2. Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create a new application — the **name** becomes "Playing _____" on your profile
3. Note the **Application ID** (Client ID)
4. Go to **Rich Presence → Art Assets** and upload images:
   - `tesla_logo` — Main large image (512×512)
   - `driving` — Small icon for driving state
   - `parked` — Small icon for parked state
   - `charging` — Small icon for charging state

---

## Option A: Desktop App (Electron)

```bash
git clone https://github.com/realazee/discord-tesla-rpc.git
cd discord-tesla-rpc
npm install

# Launch the app
npm start
```

All configuration is done in the Settings panel:

1. Enter your Tesla & Discord credentials
2. Sign in with Tesla — opens your browser for OAuth2
3. Select your vehicle from the dropdown
4. Toggle metrics on/off
5. Click **Start RPC**

---

## Option B: Docker (Headless Homelab)

Run the entire stack — Discord client + RPC service — in a single Docker container. Perfect for always-on homelabs.

### Quick Start

```bash
git clone https://github.com/realazee/discord-tesla-rpc.git
cd discord-tesla-rpc

# Configure
cp .env.example .env
# Edit .env with your Tesla & Discord credentials

# Build and start
docker compose up -d
```

### First-Time Setup

The container includes a browser-accessible VNC interface for the initial Discord login:

1. Open `http://<your-server-ip>:6080` in any browser
2. You'll see the Discord login screen — sign in with your account
3. Once logged in, Discord stays authenticated across container restarts

The Tesla OAuth flow prints a URL to the container logs:

```bash
docker compose logs -f
# Copy the Tesla auth URL and open it in any browser
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TESLA_CLIENT_ID` | ✅ | Tesla app Client ID |
| `TESLA_CLIENT_SECRET` | ✅ | Tesla app Client Secret |
| `DISCORD_CLIENT_ID` | ✅ | Discord app Client ID |
| `CALLBACK_DOMAIN` | ✅ | Your Cloudflare Worker domain (e.g. `https://tesla-rpc.yourdomain.com`) |
| `TESLA_REGION` | | `na` (default), `eu`, or `cn` |
| `TESLA_VIN` | | Specific VIN (auto-selects first vehicle if empty) |
| `SPEED_UNITS` | | `mph` (default) or `kph` |
| `TEMP_UNITS` | | `F` (default) or `C` |
| `DISABLE_METRICS` | | Comma-separated list of metrics to hide |

### Ports

| Port | Purpose |
|------|---------|
| `6080` | noVNC web interface (Discord login) |
| `8888` | Tesla OAuth callback |

### Managing

```bash
# View logs
docker compose logs -f

# Stop
docker compose down

# Restart
docker compose restart

# Rebuild after updates
docker compose up -d --build
```

---

## How It Works

```
Tesla Fleet API  →  Poller (30s/5min)  →  Geocoder  →  Discord RPC
                                           ↓
                                   Settings Panel (Electron)
                                   — or —
                                   Headless CLI (Docker)
```

1. The app polls the Tesla Fleet API for vehicle data
2. GPS coordinates are reverse-geocoded to street/city names
3. Enabled metrics are composed into Discord Rich Presence fields
4. Your Discord profile updates in real-time

## Tech Stack

- **Electron** — Desktop app with system tray (Option A)
- **Docker + Xvfb + noVNC** — Headless deployment (Option B)
- **Tesla Fleet API** — OAuth2 + vehicle data
- **Nominatim** (OpenStreetMap) — Reverse geocoding
- **@xhayper/discord-rpc** — Discord Rich Presence
- **Cloudflare Workers** — Public key hosting & OAuth callback relay

## License

MIT

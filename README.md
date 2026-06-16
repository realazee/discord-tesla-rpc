# Discord Tesla RPC

Display real-time Tesla vehicle data on your Discord profile — speed, street name, battery, temperature, and more — like a FiveM or game server RPC.

![Preview](https://img.shields.io/badge/status-alpha-orange) ![Platform](https://img.shields.io/badge/platform-macOS-blue)

## Features

- **Real-time vehicle metrics** — Speed, gear, battery %, range, temperatures, odometer, sentry mode
- **Street & location** — Reverse-geocoded from GPS coordinates via OpenStreetMap
- **Per-metric toggles** — Choose exactly what shows on your profile
- **Smart polling** — 30s while driving, 5min while parked, skips when car is asleep
- **System tray** — Runs in the background, configure via a sleek dark-themed settings panel
- **Auto token refresh** — Never re-authenticate manually

## Prerequisites

### 1. Tesla Developer Application

Tesla requires a **public HTTPS domain** for app registration. A small Cloudflare Worker is included to handle this — it serves the public key and bounces the OAuth callback to your local app.

#### a) Deploy the Cloudflare Worker

```bash
# Generate your Tesla key pair (already done if keys exist)
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out com.tesla.3p.public-key.pem

# Deploy the worker (update wrangler.toml with your account)
cd worker
npx wrangler deploy
```

Then add a custom domain in Cloudflare Dashboard:
**Workers & Pages → tesla-discord-rpc → Settings → Domains & Routes** → add `tesla-rpc.yourdomain.com`

#### b) Register the Tesla App

1. Go to [developer.tesla.com](https://developer.tesla.com) and sign in
2. Create a new application
3. Note your **Client ID** and **Client Secret**
4. Set the **Allowed Origin** to `https://tesla-rpc.yourdomain.com`
5. Set the **Redirect URI** to `https://tesla-rpc.yourdomain.com/callback`
6. Request scopes: `openid`, `offline_access`, `vehicle_device_data`, `vehicle_location`

### 2. Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create a new application — the **name** becomes "Playing _____" on your profile
3. Note the **Application ID** (Client ID)
4. Go to **Rich Presence → Art Assets** and upload images:
   - `tesla_logo` — Main large image (512×512)
   - `driving` — Small icon for driving state
   - `parked` — Small icon for parked state
   - `charging` — Small icon for charging state

## Setup

```bash
# Clone the repo
git clone https://github.com/your-user/discord-tesla-rpc.git
cd discord-tesla-rpc

# Install dependencies
npm install

# Copy env template and fill in your credentials
cp .env.example .env

# Launch the app
npm start
```

## Configuration

All configuration is done in the Settings panel:

1. **Enter your Tesla & Discord credentials** in the Configuration section
2. **Sign in with Tesla** — opens your browser for the OAuth2 flow
3. **Select your vehicle** from the dropdown
4. **Toggle metrics** on/off to customize what appears
5. **Click Start RPC** to go live on Discord!

## How It Works

```
Tesla Fleet API  →  Poller (30s/5min)  →  Geocoder  →  Discord RPC
                                           ↓
                                     Settings Panel (Electron)
```

1. The app polls the Tesla Fleet API for vehicle data
2. GPS coordinates are reverse-geocoded to street/city names
3. Enabled metrics are composed into Discord Rich Presence fields
4. Your Discord profile updates in real-time

## Tech Stack

- **Electron** — Desktop app with system tray
- **Tesla Fleet API** — OAuth2 + vehicle data
- **Nominatim** (OpenStreetMap) — Reverse geocoding
- **@xhayper/discord-rpc** — Discord Rich Presence
- **electron-store** — Encrypted config persistence

## License

MIT

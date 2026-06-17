#!/usr/bin/env node
/**
 * Discord Tesla RPC — Headless Service
 *
 * Standalone Node.js process that:
 *   1. Authenticates with Tesla (prints URL to console on first run)
 *   2. Polls Tesla Fleet API for vehicle data
 *   3. Sets Discord Rich Presence via the local Discord client
 *
 * Configuration via environment variables (see .env.example).
 * Designed to run inside a Docker container alongside Discord.
 */

const path = require('node:path');
const HeadlessAuth = require('./auth');
const TeslaAPI = require('../src/tesla/api');
const TeslaPoller = require('../src/tesla/poller');
const Geocoder = require('../src/geo/geocoder');
const { DiscordRPC, METRIC_KEYS } = require('../src/discord/rpc');

/* ------------------------------------------------------------------ */
/*  Configuration from environment                                    */
/* ------------------------------------------------------------------ */

const config = {
  teslaClientId:     process.env.TESLA_CLIENT_ID     || '',
  teslaClientSecret: process.env.TESLA_CLIENT_SECRET || '',
  teslaRegion:       process.env.TESLA_REGION         || 'na',
  callbackDomain:    process.env.CALLBACK_DOMAIN      || '',
  discordClientId:   process.env.DISCORD_CLIENT_ID    || '',
  selectedVin:       process.env.TESLA_VIN            || '', // empty = auto-select first
  speedUnits:        process.env.SPEED_UNITS           || 'mph', // 'mph' | 'kph'
  tempUnits:         process.env.TEMP_UNITS            || 'F',   // 'F' | 'C'
};

// All metrics enabled by default; override with DISABLE_METRICS=speed,sentry,...
const disabledMetrics = (process.env.DISABLE_METRICS || '').split(',').map(s => s.trim()).filter(Boolean);
const toggles = Object.fromEntries(METRIC_KEYS.map(k => [k, !disabledMetrics.includes(k)]));

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

function validateConfig() {
  const required = ['teslaClientId', 'teslaClientSecret', 'discordClientId'];
  const missing = required.filter(k => !config[k]);
  if (missing.length) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(k => {
      const envKey = k.replace(/([A-Z])/g, '_$1').toUpperCase();
      console.error(`   - ${envKey}`);
    });
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       Discord Tesla RPC — Headless Service      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  validateConfig();

  const auth = new HeadlessAuth();
  const geocoder = new Geocoder();
  let geoData = { street: null, city: null, state: null, full: '' };

  // --- Step 1: Tesla Auth ---
  if (!auth.isAuthenticated()) {
    console.log('[Auth] No saved tokens found. Starting OAuth login...');
    try {
      await auth.login(config.teslaClientId, config.teslaClientSecret, config.callbackDomain);
      console.log('[Auth] ✅ Tesla authenticated successfully\n');
    } catch (err) {
      console.error('[Auth] ❌ Login failed:', err.message);
      process.exit(1);
    }
  } else {
    console.log('[Auth] ✅ Using saved Tesla tokens');
    // Try to refresh on startup
    try {
      await auth.refreshTokens(config.teslaClientId, config.teslaClientSecret);
    } catch (err) {
      console.warn('[Auth] Token refresh failed, will re-login:', err.message);
      await auth.login(config.teslaClientId, config.teslaClientSecret, config.callbackDomain);
    }
  }

  // --- Step 2: Tesla API + Vehicle Selection ---
  const api = new TeslaAPI(() => auth.getAccessToken(), config.teslaRegion);

  let vehicles;
  try {
    vehicles = await api.getVehicles();
  } catch (err) {
    // Auto-register as partner if needed
    if (err.message.includes('412') && config.callbackDomain) {
      console.log('[Tesla] Registering as partner...');
      await api.register(config.callbackDomain, config.teslaClientId, config.teslaClientSecret);
      vehicles = await api.getVehicles();
    } else {
      throw err;
    }
  }

  if (!vehicles.length) {
    console.error('[Tesla] ❌ No vehicles found on this account');
    process.exit(1);
  }

  const vin = config.selectedVin || vehicles[0].vin;
  const vehicle = vehicles.find(v => v.vin === vin) || vehicles[0];
  console.log(`[Tesla] ✅ Selected: ${vehicle.display_name || 'Tesla'} (${vehicle.vin})\n`);

  // --- Step 3: Discord RPC ---
  const discord = new DiscordRPC(config.discordClientId);

  let discordConnected = false;
  const connectDiscord = async () => {
    try {
      await discord.connect();
      discordConnected = true;
      console.log('[Discord] ✅ Rich Presence connected');
    } catch (err) {
      console.warn('[Discord] ⚠ Not connected yet — retrying in 15s');
      console.warn('          Make sure Discord is running.');
      setTimeout(connectDiscord, 15_000);
    }
  };
  await connectDiscord();

  // --- Step 4: Start Polling ---
  const poller = new TeslaPoller(api, vehicle.vin);

  poller.on('data', async ({ vehicleData, isDriving }) => {
    const ds = vehicleData.drive_state || {};

    if (ds.latitude != null && ds.longitude != null) {
      try {
        geoData = await geocoder.reverse(ds.latitude, ds.longitude);
      } catch (err) {
        console.warn('[Geocoder]', err.message);
      }
    }

    const statusIcon = isDriving ? '🚗' : '🅿️';
    const speed = ds.speed != null ? `${ds.speed} mph` : '0 mph';
    const battery = vehicleData.charge_state?.battery_level ?? '?';
    console.log(`${statusIcon} ${speed} | 🔋 ${battery}% | 📍 ${geoData.city || 'Unknown'}`);

    discord.updatePresence(vehicleData, geoData, toggles, {
      speedUnits: config.speedUnits,
      tempUnits: config.tempUnits,
    });
  });

  poller.on('sleep', () => {
    console.log('💤 Vehicle is asleep. Waiting...');
    discord.setSleepPresence();
  });

  poller.on('error', (err) => {
    console.error('[Poller] ❌', err.message);
  });

  poller.start();
  console.log('[Poller] ✅ Started polling vehicle data\n');

  // --- Graceful shutdown ---
  const shutdown = () => {
    console.log('\n🛑 Shutting down...');
    poller.stop();
    discord.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  setInterval(() => {}, 60_000);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

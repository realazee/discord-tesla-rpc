/**
 * Discord Tesla RPC — Electron Main Process
 *
 * Orchestrates:
 *   - System tray with context menu
 *   - Settings window (BrowserWindow)
 *   - Tesla auth, API, poller
 *   - Geocoder
 *   - Discord RPC
 */

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const Store = require('electron-store');

const TeslaAuth = require('./tesla/auth');
const TeslaAPI = require('./tesla/api');
const TeslaPoller = require('./tesla/poller');
const Geocoder = require('./geo/geocoder');
const { DiscordRPC, METRIC_KEYS } = require('./discord/rpc');

/* ------------------------------------------------------------------ */
/*  Config defaults                                                   */
/* ------------------------------------------------------------------ */

const store = new Store({
  defaults: {
    tesla: {},
    discord: {},
    config: {
      teslaClientId: '',
      teslaClientSecret: '',
      teslaRegion: 'na',
      callbackDomain: '', // e.g. 'https://tesla-rpc.yourdomain.com'
      discordClientId: '',
      selectedVin: '',
      speedUnits: 'mph', // 'mph' | 'kph'
      tempUnits: 'F', // 'F' | 'C'
    },
    toggles: Object.fromEntries(METRIC_KEYS.map((k) => [k, true])),
  },
  encryptionKey: 'discord-tesla-rpc-v1', // basic at-rest encryption
});

/* ------------------------------------------------------------------ */
/*  Instances                                                         */
/* ------------------------------------------------------------------ */

let mainWindow = null;
let tray = null;

const auth = new TeslaAuth(store);
let api = null;
let poller = null;
const geocoder = new Geocoder();
let discord = null;

let rpcActive = false;
let latestVehicleData = null;
let latestGeoData = { street: null, city: null, state: null, full: '' };

/* ------------------------------------------------------------------ */
/*  Window                                                            */
/* ------------------------------------------------------------------ */

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 520,
    height: 780,
    minWidth: 420,
    minHeight: 600,
    title: 'Tesla Discord RPC',
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'ui', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWindow.on('close', (e) => {
    // Hide instead of quit so the tray keeps running
    e.preventDefault();
    mainWindow.hide();
  });
}

/* ------------------------------------------------------------------ */
/*  Tray                                                              */
/* ------------------------------------------------------------------ */

function createTray() {
  // Create a simple tray icon from a drawn image
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAjFJREFUWEftlr1Ow0AQhGcOB0JBgYSEREOBhERDgQQ0FEhI/Lz/z8sse+vYjn+SyI6LK6I4vrv9ZnZ27eif0cjro8GxjQXsuAK/BVqAHlAC1s/wvhTwXZoC1ADcAr7d5/17JFc28LoELCBqyuJDxAViACHg+hd8vwZgIJyXngn+3W0AUAENQE64FvAIwMBw3gMIgCJgiI9N8Kv2O9f9APrjvpcAbf2gDlQ70HaQ2kGfAHtW7yjLPAXQIzQ0sEBb5ZeJP8ZYgDqgDhAD+oIhL+2gcwB+Mv9o6oasgAxYHOlXzjm28D3ewBLATaLY+DvU6D7OwGMGcUF/EQNBNaCpPaZ2+j2bP8Z39Z/6gDpBQDLn9b+d+fJ1GgBuUAOQPpSHwKzHu/d1QLXABoAJtBB0gUIAY6AC+2j1kJf5dGHiIkZXOgCbEPIN0FUAJ1Kw67vp3gqS9TZZ0A5UE2A9gJRAJ8H+A8YB8gDHEX4xaAlZzNVWMHsCqgLGAMoYtlmhz2CTU8TF62AFYLqAfUA2YBFuNbNRqAeuAO0K9xz/OaBjLdgPTFFIDRDvQY0Kc2OVXOqL/YAW6uNFYAY4BMg/wF0kZ4AUb7nAJY/LOBvgE/1hSbYrZMqhKkGp2bglkLwm0BdgLbBPqEZd4jFvJtfC9AOiAdIA4gDRAFeAJxbVuvqEQf+C4wBbA1UACvPkh8k+5T/pwAoD5ADcC5DG+B9AvVTvFHEwdPjx07/X7ADvIqo+cLBwW6AAAAASUVORK5CYII='
  );

  tray = new Tray(icon.resize({ width: 18, height: 18 }));
  tray.setToolTip('Tesla Discord RPC');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Settings', click: () => createWindow() },
    { type: 'separator' },
    {
      label: 'Start RPC',
      click: () => startRPC(),
      id: 'start',
    },
    {
      label: 'Stop RPC',
      click: () => stopRPC(),
      id: 'stop',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        stopRPC();
        app.exit(0);
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => createWindow());
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Settings', click: () => createWindow() },
    { type: 'separator' },
    {
      label: 'Start RPC',
      click: () => startRPC(),
      enabled: !rpcActive,
    },
    {
      label: 'Stop RPC',
      click: () => stopRPC(),
      enabled: rpcActive,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        stopRPC();
        app.exit(0);
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

/* ------------------------------------------------------------------ */
/*  RPC lifecycle                                                     */
/* ------------------------------------------------------------------ */

async function startRPC() {
  const cfg = store.get('config');
  if (!cfg.teslaClientId || !cfg.discordClientId) {
    sendStatus('error', 'Missing Tesla or Discord Client ID — configure in Settings.');
    return;
  }

  if (!auth.isAuthenticated()) {
    sendStatus('error', 'Not signed in to Tesla. Please sign in first.');
    return;
  }

  const vin = cfg.selectedVin;
  if (!vin) {
    sendStatus('error', 'No vehicle selected. Please select a vehicle.');
    return;
  }

  // Initialize API
  api = new TeslaAPI(() => auth.getAccessToken(), cfg.teslaRegion);

  // Initialize Discord
  discord = new DiscordRPC(cfg.discordClientId);
  await discord.connect();

  // Start poller
  poller = new TeslaPoller(api, vin);

  poller.on('data', async ({ vehicleData, isDriving }) => {
    latestVehicleData = vehicleData;

    // Geocode if we have coordinates
    const ds = vehicleData.drive_state || {};
    if (ds.latitude != null && ds.longitude != null) {
      try {
        latestGeoData = await geocoder.reverse(ds.latitude, ds.longitude);
      } catch (err) {
        console.error('[Geocoder]', err.message);
      }
    }

    // Update Discord
    const toggles = store.get('toggles');
    const speedUnits = store.get('config.speedUnits', 'mph');
    const tempUnits = store.get('config.tempUnits', 'F');
    discord.updatePresence(vehicleData, latestGeoData, toggles, { speedUnits, tempUnits });

    // Push to UI
    sendToRenderer('vehicle-data', {
      vehicleData,
      geoData: latestGeoData,
      isDriving,
    });
  });

  poller.on('sleep', () => {
    sendStatus('info', 'Vehicle is asleep. Waiting…');
    discord.setSleepPresence();
  });

  poller.on('error', (err) => {
    console.error('[Poller]', err.message);
    sendStatus('error', `API error: ${err.message}`);
  });

  poller.start();
  rpcActive = true;
  updateTrayMenu();
  sendStatus('running', 'RPC active');
}

function stopRPC() {
  if (poller) { poller.stop(); poller = null; }
  if (discord) { discord.disconnect(); discord = null; }
  rpcActive = false;
  latestVehicleData = null;
  updateTrayMenu();
  sendStatus('stopped', 'RPC stopped');
}

/* ------------------------------------------------------------------ */
/*  IPC Handlers                                                      */
/* ------------------------------------------------------------------ */

function setupIPC() {
  ipcMain.handle('get-config', () => store.get('config'));
  ipcMain.handle('set-config', (_e, key, value) => {
    store.set(`config.${key}`, value);
    return true;
  });

  ipcMain.handle('tesla-login', async () => {
    const cfg = store.get('config');
    if (!cfg.teslaClientId || !cfg.teslaClientSecret) {
      throw new Error('Missing Tesla Client ID or Secret');
    }
    await auth.login(cfg.teslaClientId, cfg.teslaClientSecret, cfg.callbackDomain);
    return true;
  });

  ipcMain.handle('tesla-logout', () => {
    auth.logout();
    stopRPC();
    return true;
  });

  ipcMain.handle('get-auth-status', () => ({
    authenticated: auth.isAuthenticated(),
  }));

  ipcMain.handle('get-vehicles', async () => {
    const cfg = store.get('config');
    if (!auth.isAuthenticated()) throw new Error('Not authenticated');
    const tempApi = new TeslaAPI(() => auth.getAccessToken(), cfg.teslaRegion);

    try {
      return await tempApi.getVehicles();
    } catch (err) {
      // 412 = not registered as partner yet — auto-register and retry
      if (err.message.includes('412') && cfg.callbackDomain) {
        console.log('[Tesla] Registering as partner…');
        await tempApi.register(cfg.callbackDomain, cfg.teslaClientId, cfg.teslaClientSecret);
        return await tempApi.getVehicles();
      }
      throw err;
    }
  });

  ipcMain.handle('select-vehicle', (_e, vin) => {
    store.set('config.selectedVin', vin);
    if (poller) poller.setVin(vin);
    return true;
  });

  ipcMain.handle('start-rpc', () => startRPC());
  ipcMain.handle('stop-rpc', () => { stopRPC(); return true; });

  ipcMain.handle('set-toggle', (_e, metric, enabled) => {
    store.set(`toggles.${metric}`, enabled);
    // Immediately re-render with latest data
    if (rpcActive && discord && latestVehicleData) {
      const toggles = store.get('toggles');
      const speedUnits = store.get('config.speedUnits', 'mph');
      const tempUnits = store.get('config.tempUnits', 'F');
      discord.updatePresence(latestVehicleData, latestGeoData, toggles, { speedUnits, tempUnits });
    }
    return true;
  });

  ipcMain.handle('get-toggles', () => store.get('toggles'));
}

/* ------------------------------------------------------------------ */
/*  Renderer communication                                            */
/* ------------------------------------------------------------------ */

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function sendStatus(type, message) {
  sendToRenderer('status-change', { type, message });
}

/* ------------------------------------------------------------------ */
/*  App lifecycle                                                     */
/* ------------------------------------------------------------------ */

app.whenReady().then(() => {
  setupIPC();
  createTray();
  createWindow();

  // Auto-refresh tokens on startup if we have them
  const cfg = store.get('config');
  if (auth.isAuthenticated() && cfg.teslaClientId && cfg.teslaClientSecret) {
    auth.refreshTokens(cfg.teslaClientId, cfg.teslaClientSecret).catch(() => {});
  }
});

// Keep running in tray on macOS
app.on('window-all-closed', (e) => {
  e?.preventDefault?.();
});

app.on('activate', () => createWindow());

app.on('before-quit', () => {
  stopRPC();
});

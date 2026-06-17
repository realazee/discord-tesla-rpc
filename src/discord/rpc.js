/**
 * Discord Rich Presence Manager
 *
 * Uses @xhayper/discord-rpc to set the user's Discord activity based on
 * Tesla vehicle data and the user's toggle preferences.
 */

const { Client } = require('@xhayper/discord-rpc');

/**
 * Metric toggle keys — each corresponds to a user-togglable metric.
 * @type {string[]}
 */
const METRIC_KEYS = [
  'speed',
  'street',
  'location',
  'gear',
  'battery',
  'range',
  'charging',
  'insideTemp',
  'outsideTemp',
  'odometer',
  'sentry',
];

class DiscordRPC {
  /**
   * @param {string} clientId — Discord application Client ID
   */
  constructor(clientId) {
    this.clientId = clientId;
    this.client = new Client({ clientId });
    this._connected = false;
    this._sessionStart = null;

    this.client.on('ready', () => {
      this._connected = true;
      console.log('[Discord] RPC connected');
    });

    this.client.on('disconnected', () => {
      this._connected = false;
      console.log('[Discord] RPC disconnected');
    });
  }

  /** Connect to the local Discord client. */
  async connect() {
    try {
      await this.client.login();
      this._sessionStart = new Date();
    } catch (err) {
      console.error('[Discord] Failed to connect:', err.message);
      // Retry after 15 seconds
      setTimeout(() => this.connect(), 15_000);
    }
  }

  /** Disconnect cleanly. */
  async disconnect() {
    if (this._connected) {
      try {
        await this.client.user?.clearActivity();
        await this.client.destroy();
      } catch { /* ignore */ }
      this._connected = false;
    }
  }

  /**
   * Update Discord presence from vehicle data.
   *
   * @param {object} vehicleData — raw Tesla vehicle_data response
   * @param {object} geoData — { street, city, state } from geocoder
   * @param {Record<string, boolean>} toggles — which metrics are enabled
   * @param {object} opts — { speedUnits: 'mph'|'kph', tempUnits: 'F'|'C' }
   */
  updatePresence(vehicleData, geoData, toggles, opts = {}) {
    if (!this._connected || !this.client.user) return;

    const speedUnits = opts.speedUnits || 'mph';
    const tempUnits = opts.tempUnits || 'F';
    const ds = vehicleData.drive_state || {};
    const cs = vehicleData.charge_state || {};
    const cl = vehicleData.climate_state || {};
    const vs = vehicleData.vehicle_state || {};
    const vc = vehicleData.vehicle_config || {};

    const isDriving = !!ds.shift_state && ds.shift_state !== 'P';
    const isCharging = cs.charging_state === 'Charging';

    // --- Car model for tooltip ---
    const modelName = this._formatModel(vc.car_type);

    // --- Line 1: Speed, gear, street ---
    const line1Parts = [];

    if (toggles.speed && ds.speed != null) {
      const speed = speedUnits === 'kph'
        ? `${Math.round(ds.speed * 1.60934)} km/h`
        : `${ds.speed} mph`;
      line1Parts.push(speed);
    }

    if (toggles.gear) {
      const gearMap = { D: 'Drive', R: 'Reverse', N: 'Neutral', P: 'Parked' };
      const gear = gearMap[ds.shift_state] || 'Parked';
      line1Parts.push(gear);
    }

    if (toggles.street && geoData.street) {
      line1Parts.push(`on ${geoData.street}`);
    }

    // --- Line 2: Location, battery, temps ---
    const line2Parts = [];

    if (toggles.location && geoData.city) {
      const loc = geoData.state
        ? `${geoData.city}, ${geoData.state}`
        : geoData.city;
      line2Parts.push(`📍 ${loc}`);
    }

    if (toggles.battery && cs.battery_level != null) {
      line2Parts.push(`🔋 ${cs.battery_level}%`);
    }

    if (toggles.range && cs.battery_range != null) {
      const range = speedUnits === 'kph'
        ? `${Math.round(cs.battery_range * 1.60934)} km`
        : `${Math.round(cs.battery_range)} mi`;
      line2Parts.push(`⚡ ${range}`);
    }

    if (toggles.charging && isCharging) {
      const kw = cs.charger_power != null ? ` @ ${cs.charger_power} kW` : '';
      line2Parts.push(`🔌 Charging${kw}`);
    }

    if (toggles.insideTemp && cl.inside_temp != null) {
      const temp = tempUnits === 'C'
        ? `${Math.round(cl.inside_temp)}°C`
        : `${Math.round(cl.inside_temp * 9 / 5 + 32)}°F`;
      line2Parts.push(`🌡️ ${temp} in`);
    }

    if (toggles.outsideTemp && cl.outside_temp != null) {
      const temp = tempUnits === 'C'
        ? `${Math.round(cl.outside_temp)}°C`
        : `${Math.round(cl.outside_temp * 9 / 5 + 32)}°F`;
      line2Parts.push(`${temp} out`);
    }

    if (toggles.odometer && vs.odometer != null) {
      const odo = speedUnits === 'kph'
        ? `${Math.round(vs.odometer * 1.60934).toLocaleString()} km`
        : `${Math.round(vs.odometer).toLocaleString()} mi`;
      line2Parts.push(`📏 ${odo}`);
    }

    if (toggles.sentry && vs.sentry_mode) {
      line2Parts.push('🛡️ Sentry');
    }

    // Compose strings (Discord truncates at 128 chars)
    const details = line1Parts.join(' · ').slice(0, 128) || (isDriving ? 'Driving' : isCharging ? 'Charging' : 'Parked');
    const state = line2Parts.join(' · ').slice(0, 128) || undefined;

    // Pick status icon
    let smallImageKey = 'parked';
    let smallImageText = 'Parked';
    if (isDriving) { smallImageKey = 'driving'; smallImageText = 'Driving'; }
    else if (isCharging) { smallImageKey = 'charging'; smallImageText = 'Charging'; }

    const activity = {
      details,
      state,
      largeImageKey: 'tesla_logo',
      largeImageText: modelName || 'Tesla',
      smallImageKey,
      smallImageText,
      startTimestamp: this._sessionStart,
    };

    this.client.user.setActivity(activity);
  }

  /**
   * Map Tesla car_type strings to human-readable names.
   * @param {string} carType — e.g. 'modely', 'model3', 'models', 'modelx', 'cybertruck'
   */
  _formatModel(carType) {
    if (!carType) return null;
    const map = {
      models: 'Tesla Model S',
      model3: 'Tesla Model 3',
      modelx: 'Tesla Model X',
      modely: 'Tesla Model Y',
      cybertruck: 'Tesla Cybertruck',
      semi: 'Tesla Semi',
      roadster: 'Tesla Roadster',
    };
    return map[carType.toLowerCase()] || `Tesla ${carType}`;
  }

  /** Set a 'sleeping' presence instead of clearing entirely. */
  setSleepPresence() {
    if (!this._connected || !this.client.user) return;
    this.client.user.setActivity({
      details: '💤 Vehicle Asleep',
      state: 'Waiting for wake-up…',
      largeImageKey: 'tesla_logo',
      largeImageText: 'Tesla',
      smallImageKey: 'parked',
      smallImageText: 'Sleeping',
      startTimestamp: this._sessionStart,
    });
  }

  /** Clear the current activity. */
  clearPresence() {
    if (this._connected && this.client.user) {
      this.client.user.clearActivity();
    }
  }
}

module.exports = { DiscordRPC, METRIC_KEYS };

/**
 * Tesla Vehicle Data Poller
 *
 * EventEmitter that polls the Fleet API on a smart interval:
 *   - 30 seconds while driving (shift_state is not null)
 *   - 5 minutes while parked
 *   - Skips polling if the vehicle is asleep
 *
 * Emits:
 *   'data'  — { vehicleData, isDriving }
 *   'error' — Error
 *   'sleep' — vehicle is asleep
 */

const { EventEmitter } = require('node:events');

const POLL_DRIVING_MS = 30_000;   // 30 seconds
const POLL_PARKED_MS = 5 * 60_000; // 5 minutes

class TeslaPoller extends EventEmitter {
  /**
   * @param {import('./api')} api — TeslaAPI instance
   * @param {string} vin — vehicle VIN to poll
   */
  constructor(api, vin) {
    super();
    this.api = api;
    this.vin = vin;
    this._timer = null;
    this._running = false;
    this._lastDriving = false;
  }

  /** Start polling. */
  start() {
    if (this._running) return;
    this._running = true;
    this._poll(); // fire immediately
  }

  /** Stop polling. */
  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /** Change the target vehicle. */
  setVin(vin) {
    this.vin = vin;
  }

  /* ------------------------------------------------------------------ */
  /*  Internal                                                          */
  /* ------------------------------------------------------------------ */

  async _poll() {
    if (!this._running) return;

    try {
      const data = await this.api.getVehicleData(this.vin);

      if (data === null) {
        // Vehicle is asleep
        this.emit('sleep');
        this._schedule(POLL_PARKED_MS);
        return;
      }

      const isDriving = !!(data.drive_state && data.drive_state.shift_state);
      this._lastDriving = isDriving;

      this.emit('data', { vehicleData: data, isDriving });
      this._schedule(isDriving ? POLL_DRIVING_MS : POLL_PARKED_MS);
    } catch (err) {
      this.emit('error', err);

      // If rate-limited, respect the Retry-After header
      const delay = err.retryAfterMs || POLL_PARKED_MS;
      this._schedule(delay);
    }
  }

  _schedule(ms) {
    if (!this._running) return;
    this._timer = setTimeout(() => this._poll(), ms);
  }
}

module.exports = TeslaPoller;

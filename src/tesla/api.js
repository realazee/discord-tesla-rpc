/**
 * Tesla Fleet API — Vehicle Data Wrapper
 *
 * Provides typed access to Fleet API endpoints for fetching vehicle lists
 * and detailed vehicle data (drive state, charge state, climate, etc.).
 */

const REGION_HOSTS = {
  na: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
  eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
  cn: 'https://fleet-api.prd.cn.vn.cloud.tesla.com',
};

const DATA_ENDPOINTS = [
  'location_data',
  'drive_state',
  'charge_state',
  'climate_state',
  'vehicle_state',
  'vehicle_config',
].join('%3B'); // semicolons URL-encoded

class TeslaAPI {
  /**
   * @param {() => string} getToken — function returning the current access token
   * @param {string} region — 'na' | 'eu' | 'cn'
   */
  constructor(getToken, region = 'na') {
    this.getToken = getToken;
    this.host = REGION_HOSTS[region] || REGION_HOSTS.na;
  }

  /* ------------------------------------------------------------------ */
  /*  Core request                                                      */
  /* ------------------------------------------------------------------ */

  async _request(path, { method = 'GET', body = null } = {}) {
    const token = this.getToken();
    if (!token) throw new Error('Not authenticated');

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(`${this.host}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 408 || res.status === 504) {
      // Vehicle is asleep — not an error per se
      return { response: null, asleep: true };
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') || '60';
      throw Object.assign(new Error('Rate limited'), {
        retryAfterMs: parseInt(retryAfter, 10) * 1000,
      });
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tesla API ${res.status}: ${text}`);
    }

    return res.json();
  }

  /* ------------------------------------------------------------------ */
  /*  Endpoints                                                         */
  /* ------------------------------------------------------------------ */

  /** List all vehicles on the account. */
  async getVehicles() {
    const data = await this._request('/api/1/vehicles');
    return data.response || [];
  }

  /**
   * Get comprehensive vehicle data.
   * @param {string} vin
   * @returns {Promise<object|null>} parsed vehicle data or null if asleep
   */
  async getVehicleData(vin) {
    const data = await this._request(
      `/api/1/vehicles/${vin}/vehicle_data?endpoints=${DATA_ENDPOINTS}`
    );
    if (data.asleep) return null;
    return data.response;
  }

  /**
   * Wake up a vehicle.
   * @param {string} vin
   */
  async wakeUp(vin) {
    return this._request(`/api/1/vehicles/${vin}/wake_up`, { method: 'POST' });
  }

  /**
   * Register this application as a partner in the current region.
   * Must be called once before other API calls will work.
   * Requires a partner (client_credentials) token, NOT a user token.
   * @param {string} domain — the domain hosting the public key
   * @param {string} clientId
   * @param {string} clientSecret
   */
  async register(domain, clientId, clientSecret) {
    // 1. Get a partner token via client_credentials grant
    const tokenBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'openid vehicle_device_data vehicle_location',
      audience: this.host,
    });

    const tokenRes = await fetch('https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Partner token request failed (${tokenRes.status}): ${text}`);
    }

    const { access_token: partnerToken } = await tokenRes.json();

    // 2. Register with the partner token
    const regRes = await fetch(`${this.host}/api/1/partner_accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${partnerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: domain.replace(/^https?:\/\//, '').replace(/\/$/, '') }),
    });

    if (!regRes.ok) {
      const text = await regRes.text();
      throw new Error(`Partner registration failed (${regRes.status}): ${text}`);
    }

    return regRes.json();
  }
}

module.exports = TeslaAPI;

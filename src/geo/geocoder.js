/**
 * Reverse Geocoder — Nominatim (OpenStreetMap)
 *
 * Converts (lat, lon) → street name, city, state.
 * Rate-limited to 1 req/sec per Nominatim usage policy.
 * Caches recent lookups so we don't hammer the API when parked.
 */

const USER_AGENT = 'DiscordTeslaRPC/1.0 (https://github.com/discord-tesla-rpc)';
const CACHE_RADIUS = 0.0005; // ~55 m — if within this, reuse cached result

class Geocoder {
  constructor() {
    this._cache = null; // { lat, lon, result }
    this._lastRequestMs = 0;
  }

  /**
   * Reverse-geocode coordinates to an address.
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<{street: string|null, city: string|null, state: string|null, full: string}>}
   */
  async reverse(lat, lon) {
    if (lat == null || lon == null) {
      return { street: null, city: null, state: null, full: '' };
    }

    // Return cached result if we haven't moved much
    if (this._cache && this._isNearby(lat, lon, this._cache.lat, this._cache.lon)) {
      return this._cache.result;
    }

    // Enforce 1 req/sec rate limit
    await this._rateLimit();

    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!res.ok) {
      console.warn(`Geocoder HTTP ${res.status}`);
      return { street: null, city: null, state: null, full: '' };
    }

    const data = await res.json();
    const addr = data.address || {};

    const result = {
      street: addr.road || addr.pedestrian || addr.footway || null,
      city: addr.city || addr.town || addr.village || addr.hamlet || null,
      state: addr.state || null,
      full: data.display_name || '',
    };

    this._cache = { lat, lon, result };
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */

  _isNearby(lat1, lon1, lat2, lon2) {
    return (
      Math.abs(lat1 - lat2) < CACHE_RADIUS &&
      Math.abs(lon1 - lon2) < CACHE_RADIUS
    );
  }

  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this._lastRequestMs;
    if (elapsed < 1100) {
      await new Promise((r) => setTimeout(r, 1100 - elapsed));
    }
    this._lastRequestMs = Date.now();
  }
}

module.exports = Geocoder;

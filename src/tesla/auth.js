/**
 * Tesla Fleet API — OAuth2 Authentication
 *
 * Handles the full Authorization Code flow:
 *   1. Opens browser to Tesla auth page
 *   2. Captures callback on a local HTTP server
 *   3. Exchanges code for access + refresh tokens
 *   4. Persists tokens and auto-refreshes before expiry
 */

const http = require('node:http');
const { URL, URLSearchParams } = require('node:url');
const crypto = require('node:crypto');
const { shell } = require('electron');

const AUTH_HOST = 'https://auth.tesla.com';
const TOKEN_HOST = 'https://fleet-auth.prd.vn.cloud.tesla.com';
const CALLBACK_PORT = 8888;

// The redirect URI registered with Tesla (public Cloudflare Worker domain).
// The worker bounces the callback to localhost:8888/callback.
// This gets overridden by the store config 'config.callbackDomain' at login time.
const DEFAULT_REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;


const SCOPES = [
  'openid',
  'offline_access',
  'vehicle_device_data',
  'vehicle_location',
];

class TeslaAuth {
  /**
   * @param {import('electron-store').default} store — encrypted electron-store instance
   */
  constructor(store) {
    this.store = store;
    this._refreshTimer = null;
  }

  /* ------------------------------------------------------------------ */
  /*  Public helpers                                                     */
  /* ------------------------------------------------------------------ */

  /** @returns {string|null} current access token or null */
  getAccessToken() {
    return this.store.get('tesla.accessToken', null);
  }

  /** @returns {boolean} */
  isAuthenticated() {
    return !!this.getAccessToken();
  }

  /** Clear stored tokens and stop the refresh timer. */
  logout() {
    this.store.delete('tesla.accessToken');
    this.store.delete('tesla.refreshToken');
    this.store.delete('tesla.expiresAt');
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
  }

  /* ------------------------------------------------------------------ */
  /*  OAuth2 Authorization Code flow                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Start the full OAuth2 login flow.
   * Opens the browser and returns a promise that resolves once the tokens
   * have been exchanged and stored.
   *
   * @param {string} clientId
   * @param {string} clientSecret
   * @param {string} [callbackDomain] — public domain for the redirect (e.g. 'https://tesla-rpc.example.com')
   * @returns {Promise<{accessToken: string, refreshToken: string}>}
   */
  login(clientId, clientSecret, callbackDomain) {
    // Use public domain if provided, otherwise fall back to localhost
    const redirectUri = callbackDomain
      ? `${callbackDomain.replace(/\/$/, '')}/callback`
      : DEFAULT_REDIRECT_URI;

    return new Promise((resolve, reject) => {
      const state = crypto.randomBytes(16).toString('hex');

      // 1. Build the authorize URL — uses the PUBLIC redirect URI
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPES.join(' '),
        state,
      });
      const authorizeUrl = `${AUTH_HOST}/oauth2/v3/authorize?${params}`;

      // 2. Temporary HTTP server to catch the redirect
      const server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
          if (url.pathname !== '/callback') {
            res.writeHead(404);
            res.end();
            return;
          }

          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');

          if (!code || returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(this._htmlPage('Authentication Failed', 'State mismatch or missing code. Please try again.', false));
            server.close();
            reject(new Error('OAuth state mismatch'));
            return;
          }

          // 3. Exchange code → tokens
          const tokens = await this._exchangeCode(code, clientId, clientSecret, redirectUri);

          // 4. Persist
          this._storeTokens(tokens);

          // 5. Schedule auto-refresh
          this._scheduleRefresh(clientId, clientSecret, tokens.expires_in);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this._htmlPage('Success!', 'Tesla account connected. You can close this tab.', true));
          server.close();
          resolve({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
          });
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(this._htmlPage('Error', err.message, false));
          server.close();
          reject(err);
        }
      });

      server.listen(CALLBACK_PORT, () => {
        shell.openExternal(authorizeUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth login timed out'));
      }, 5 * 60 * 1000);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Token exchange & refresh                                          */
  /* ------------------------------------------------------------------ */

  /** Exchange authorization code for tokens. */
  async _exchangeCode(code, clientId, clientSecret, redirectUri) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri || DEFAULT_REDIRECT_URI,
    });

    const res = await fetch(`${TOKEN_HOST}/oauth2/v3/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }

    return res.json();
  }

  /** Refresh the access token using the stored refresh token. */
  async refreshTokens(clientId, clientSecret) {
    const refreshToken = this.store.get('tesla.refreshToken');
    if (!refreshToken) throw new Error('No refresh token stored');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const res = await fetch(`${TOKEN_HOST}/oauth2/v3/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }

    const tokens = await res.json();
    this._storeTokens(tokens);
    this._scheduleRefresh(clientId, clientSecret, tokens.expires_in);
    return tokens;
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                  */
  /* ------------------------------------------------------------------ */

  _storeTokens(tokens) {
    this.store.set('tesla.accessToken', tokens.access_token);
    this.store.set('tesla.refreshToken', tokens.refresh_token);
    this.store.set('tesla.expiresAt', Date.now() + tokens.expires_in * 1000);
  }

  _scheduleRefresh(clientId, clientSecret, expiresInSec) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    // Refresh 5 minutes before expiry
    const ms = Math.max((expiresInSec - 300) * 1000, 60_000);
    this._refreshTimer = setTimeout(() => {
      this.refreshTokens(clientId, clientSecret).catch(console.error);
    }, ms);
  }

  _htmlPage(title, message, success) {
    const color = success ? '#50e3c2' : '#e82127';
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>
        body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
             background:#0d0d0d;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff}
        .card{text-align:center;padding:3rem;border-radius:1rem;
              background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
        h1{color:${color};margin-bottom:.5rem}
        p{color:rgba(255,255,255,.7)}
      </style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
  }
}

module.exports = TeslaAuth;

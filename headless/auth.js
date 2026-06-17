/**
 * Tesla Fleet API — Headless OAuth2 Authentication
 *
 * Same flow as the Electron version but:
 *   - Prints the auth URL to console instead of opening a browser
 *   - Stores tokens in a JSON file instead of electron-store
 *   - No Electron dependency
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL, URLSearchParams } = require('node:url');
const crypto = require('node:crypto');

const AUTH_HOST = 'https://auth.tesla.com';
const TOKEN_HOST = 'https://fleet-auth.prd.vn.cloud.tesla.com';
const CALLBACK_PORT = 8888;

const SCOPES = [
  'openid',
  'offline_access',
  'vehicle_device_data',
  'vehicle_location',
];

const TOKEN_DIR = process.env.TOKEN_DIR || path.join(__dirname, '..', 'data');
const TOKEN_FILE = path.join(TOKEN_DIR, '.tokens.json');

class HeadlessAuth {
  constructor() {
    this._refreshTimer = null;
    this._tokens = this._loadTokens();
  }

  /* ------------------------------------------------------------------ */
  /*  Token persistence (JSON file)                                     */
  /* ------------------------------------------------------------------ */

  _loadTokens() {
    try {
      if (!fs.existsSync(TOKEN_DIR)) fs.mkdirSync(TOKEN_DIR, { recursive: true });
      if (fs.existsSync(TOKEN_FILE)) {
        return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      }
    } catch { /* ignore */ }
    return {};
  }

  _saveTokens() {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(this._tokens, null, 2), 'utf-8');
  }

  /* ------------------------------------------------------------------ */
  /*  Public helpers                                                     */
  /* ------------------------------------------------------------------ */

  getAccessToken() {
    return this._tokens.accessToken || null;
  }

  isAuthenticated() {
    return !!this.getAccessToken();
  }

  logout() {
    this._tokens = {};
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
  }

  /* ------------------------------------------------------------------ */
  /*  OAuth2 Authorization Code flow (headless)                         */
  /* ------------------------------------------------------------------ */

  login(clientId, clientSecret, callbackDomain) {
    const redirectUri = callbackDomain
      ? `${callbackDomain.replace(/\/$/, '')}/callback`
      : `http://localhost:${CALLBACK_PORT}/callback`;

    return new Promise((resolve, reject) => {
      const state = crypto.randomBytes(16).toString('hex');

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPES.join(' '),
        state,
      });
      const authorizeUrl = `${AUTH_HOST}/oauth2/v3/authorize?${params}`;

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
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Authentication failed — state mismatch.');
            server.close();
            reject(new Error('OAuth state mismatch'));
            return;
          }

          const tokens = await this._exchangeCode(code, clientId, clientSecret, redirectUri);
          this._storeTokens(tokens);
          this._scheduleRefresh(clientId, clientSecret, tokens.expires_in);

          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Success! Tesla account connected. You can close this tab.');
          server.close();
          resolve({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
          });
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Error: ${err.message}`);
          server.close();
          reject(err);
        }
      });

      server.listen(CALLBACK_PORT, () => {
        console.log('\n╔══════════════════════════════════════════════════╗');
        console.log('║           Tesla OAuth Login Required             ║');
        console.log('╠══════════════════════════════════════════════════╣');
        console.log('║ Open this URL in any browser to sign in:        ║');
        console.log('╚══════════════════════════════════════════════════╝');
        console.log(`\n  ${authorizeUrl}\n`);
        console.log('Waiting for callback on port', CALLBACK_PORT, '...\n');
      });

      setTimeout(() => {
        server.close();
        reject(new Error('OAuth login timed out (5 min)'));
      }, 5 * 60 * 1000);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Token exchange & refresh                                          */
  /* ------------------------------------------------------------------ */

  async _exchangeCode(code, clientId, clientSecret, redirectUri) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
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

  async refreshTokens(clientId, clientSecret) {
    const refreshToken = this._tokens.refreshToken;
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
    console.log('[Auth] Token refreshed successfully');
    return tokens;
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                  */
  /* ------------------------------------------------------------------ */

  _storeTokens(tokens) {
    this._tokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    this._saveTokens();
  }

  _scheduleRefresh(clientId, clientSecret, expiresInSec) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    const ms = Math.max((expiresInSec - 300) * 1000, 60_000);
    this._refreshTimer = setTimeout(() => {
      this.refreshTokens(clientId, clientSecret).catch(console.error);
    }, ms);
  }
}

module.exports = HeadlessAuth;

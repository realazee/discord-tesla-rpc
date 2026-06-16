/**
 * Tesla Fleet API — Cloudflare Worker
 *
 * Handles two things:
 *   1. Serves the public key at /.well-known/appspecific/com.tesla.3p.public-key.pem
 *   2. Redirects OAuth callbacks to localhost (bounces the auth code back to the Electron app)
 *
 * Setup:
 *   1. npx wrangler deploy
 *   2. Set your public key:  npx wrangler secret put TESLA_PUBLIC_KEY
 *      (paste the full PEM contents including BEGIN/END lines)
 */

const LOCAL_CALLBACK = 'http://localhost:8888/callback';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- Serve public key ---
    if (url.pathname === '/.well-known/appspecific/com.tesla.3p.public-key.pem') {
      if (!env.TESLA_PUBLIC_KEY) {
        return new Response('Public key not configured. Run: npx wrangler secret put TESLA_PUBLIC_KEY', { status: 500 });
      }
      return new Response(env.TESLA_PUBLIC_KEY, {
        headers: {
          'Content-Type': 'application/x-pem-file',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // --- OAuth callback redirect ---
    if (url.pathname === '/callback') {
      // Preserve all query params (code, state, etc.) and bounce to localhost
      const localUrl = `${LOCAL_CALLBACK}${url.search}`;

      // Return a page that redirects + shows a fallback link
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${localUrl}">
<style>
  body { margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0d0d0d; font-family: -apple-system, sans-serif; color: #fff; }
  .card { text-align: center; padding: 3rem; border-radius: 1rem;
          background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
  a { color: #e82127; }
</style></head><body>
<div class="card">
  <h2>Redirecting to Tesla RPC…</h2>
  <p>If nothing happens, <a href="${localUrl}">click here</a>.</p>
</div>
<script>window.location.replace("${localUrl}");</script>
</body></html>`;

      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // --- Root / health check ---
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('Tesla Discord RPC — Auth Relay', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

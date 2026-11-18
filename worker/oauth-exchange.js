// Token-exchange endpoint for the Repo Stats site (Cloudflare Worker syntax;
// the fetch handler is standard and ports to Deno Deploy, Vercel/Netlify
// edge functions or an Azure Function with minor changes).
//
// It does one thing: trades a one-time OAuth code (or a refresh token) for an
// access token, adding the client secret that must not ship to the browser.
// It stores nothing and logs nothing.
//
// Settings (set as secrets/vars on the worker, never in this file):
//   GITHUB_CLIENT_ID      the app's client ID
//   GITHUB_CLIENT_SECRET  the app's client secret
//   ALLOWED_ORIGIN        the site's origin, e.g. https://acme.github.io

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = origin === env.ALLOWED_ORIGIN;
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (request.method !== 'POST' || !allowed) return json({ error: 'forbidden' }, 403, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400, cors); }

    const params = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET });
    if (typeof body.code === 'string' && body.code.length < 100) {
      params.set('code', body.code);
      if (typeof body.code_verifier === 'string') params.set('code_verifier', body.code_verifier);
      if (typeof body.redirect_uri === 'string' && body.redirect_uri.startsWith(env.ALLOWED_ORIGIN)) params.set('redirect_uri', body.redirect_uri);
    } else if (typeof body.refresh_token === 'string' && body.refresh_token.length < 200) {
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', body.refresh_token);
    } else {
      return json({ error: 'bad_request' }, 400, cors);
    }

    const gh = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'repo-stats-auth' },
      body: params,
    });
    const data = await gh.json().catch(() => ({ error: 'bad_gateway' }));
    // Pass through only the fields the site needs.
    const out = {};
    for (const k of ['access_token', 'refresh_token', 'expires_in', 'refresh_token_expires_in', 'scope', 'token_type', 'error', 'error_description']) {
      if (data[k] != null) out[k] = data[k];
    }
    return json(out, data.error ? 400 : 200, cors);
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

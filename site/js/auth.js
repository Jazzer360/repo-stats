// GitHub sign-in for a static site: authorization-code flow with PKCE. The code
// is exchanged for a token by a tiny worker that holds the client secret
// (GitHub's token endpoint doesn't allow browser CORS calls). The token is kept
// in sessionStorage only: it's gone when the tab closes and is never written
// into the cached analysis data.

const cfg = () => window.REPO_STATS_CONFIG || {};
const KEY = 'repo-stats-auth';
const PENDING = 'repo-stats-oauth-pending';

export const loginConfigured = () => !!(cfg().clientId && cfg().exchangeUrl);

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(n = 32) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
async function sha256(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }

function redirectUri() { return location.origin + location.pathname; }

function read() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } }
function write(v) { try { v ? sessionStorage.setItem(KEY, JSON.stringify(v)) : sessionStorage.removeItem(KEY); } catch {} }

export async function startLogin() {
  const state = randomString(16);
  const verifier = randomString(48);
  const challenge = b64url(await sha256(verifier));
  sessionStorage.setItem(PENDING, JSON.stringify({ state, verifier, hash: location.hash }));
  const p = new URLSearchParams({
    client_id: cfg().clientId, redirect_uri: redirectUri(), state, scope: cfg().scopes || '',
    code_challenge: challenge, code_challenge_method: 'S256', allow_signup: 'false',
  });
  location.assign(`https://github.com/login/oauth/authorize?${p}`);
}

async function exchange(body) {
  const res = await fetch(cfg().exchangeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !data.access_token) throw new Error(data.error_description || data.error || `Token exchange failed (${res.status})`);
  return {
    token: data.access_token,
    refresh: data.refresh_token || null,
    expires: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    scope: data.scope || '',
  };
}

/** Call on page load. Completes a pending login if the URL carries ?code=. */
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return null;
  const pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
  sessionStorage.removeItem(PENDING);
  history.replaceState(null, '', location.pathname + (pending?.hash || ''));
  if (!pending || pending.state !== params.get('state')) throw new Error('Login state mismatch; please try again.');
  const auth = await exchange({ code, code_verifier: pending.verifier, redirect_uri: redirectUri() });
  write(auth);
  return auth;
}

export async function getToken() {
  const a = read();
  if (!a) return null;
  if (a.expires && a.refresh && a.expires - Date.now() < 5 * 60 * 1000) {
    try { const n = await exchange({ refresh_token: a.refresh }); write(n); return n.token; }
    catch { write(null); return null; }
  }
  return a.token;
}

export function isLoggedIn() { return !!read(); }
export function logout() { write(null); }

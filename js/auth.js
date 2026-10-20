// Google Identity Services – Token-Client (kein Backend, kein Refresh-Token).
// Access-Token lebt ~1 h im sessionStorage (nur dieser Tab), danach stiller Re-Login.
import { CONFIG } from './config.js';

const KEY = 'anlagen.token';
let tokenClient = null;
let pending = null;

function load() {
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (t && t.expires > Date.now() + 60_000) return t;
  } catch { /* ignore */ }
  return null;
}

function save(t) {
  try { sessionStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

export function clearToken() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

function waitForGis() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - t0 > 10_000) return reject(new Error('Google Identity Services nicht geladen'));
      setTimeout(poll, 100);
    })();
  });
}

async function init() {
  if (tokenClient) return;
  await waitForGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: () => {}, // wird pro Anfrage überschrieben
  });
}

export function hasValidToken() {
  return !!load();
}

// interactive=false → versucht stillen Login (kein Consent-Dialog, falls schon erteilt)
export async function getToken({ interactive = false } = {}) {
  const cached = load();
  if (cached) return cached.access_token;
  if (pending) return pending;
  await init();
  pending = new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      pending = null;
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, CONFIG.SCOPES)) {
        return reject(new Error('Sheets-Berechtigung wurde nicht erteilt'));
      }
      const t = { access_token: resp.access_token, expires: Date.now() + resp.expires_in * 1000 };
      save(t);
      resolve(t.access_token);
    };
    tokenClient.error_callback = (err) => {
      pending = null;
      reject(new Error(err?.message || err?.type || 'Login abgebrochen'));
    };
    // prompt '' → Consent nur beim ersten Mal. Das Popup muss aus einem Klick kommen,
    // sonst blockt der Browser es; interactive=false nur nutzen, wenn ein Token
    // gerade abgelaufen ist und die Seite bereits offen war.
    tokenClient.requestAccessToken({ prompt: '' });
  });
  return pending;
}

export function signOut() {
  const t = load();
  clearToken();
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t.access_token, () => {});
}

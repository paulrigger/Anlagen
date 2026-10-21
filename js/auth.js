// Google OAuth 2.0 – Redirect-Flow (response_type=token), ohne Popup.
// Grund: Popups funktionieren in einer vom Homescreen gestarteten App (iOS-Standalone)
// nicht zuverlässig. Der Redirect läuft im selben Fenster und kommt mit dem Token
// im URL-Fragment zurück. Kein Backend, kein Refresh-Token: Token gilt ~1 h,
// danach erneuter Redirect (bei bestehender Google-Sitzung ohne Eingabe).
import { CONFIG } from './config.js';

const KEY = 'anlagen.token';
const STATE_KEY = 'anlagen.oauth_state';
const SEEN_KEY = 'anlagen.loggedInBefore';

export class AuthError extends Error {}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function load() {
  try {
    const t = JSON.parse(store.get(KEY) || 'null');
    if (t && t.expires > Date.now() + 60_000) return t;
  } catch { /* ignore */ }
  return null;
}

// Muss exakt als „Authorized redirect URI“ im OAuth-Client eingetragen sein.
export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function hasValidToken() {
  return !!load();
}

export function wasLoggedInBefore() {
  return store.get(SEEN_KEY) === '1';
}

export function clearToken() {
  store.del(KEY);
}

/** Liefert gültiges Token oder wirft AuthError (dann login() aufrufen). */
export function getToken() {
  const t = load();
  if (!t) throw new AuthError('Anmeldung abgelaufen');
  return t.access_token;
}

/** Leitet zu Google weiter. returnHash = View, zu der danach zurückgesprungen wird. */
export function login(returnHash = location.hash) {
  const nonce = crypto.getRandomValues(new Uint32Array(4)).join('-');
  store.set(STATE_KEY, nonce);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: CONFIG.SCOPES,
    include_granted_scopes: 'true',
    state: `${nonce}|${returnHash || '#uebersicht'}`,
  }).toString();
  location.assign(u.toString());
}

/**
 * Beim Start aufrufen. Wertet die Rückkehr von Google aus (Token oder Fehler im Fragment),
 * räumt die URL auf. Rückgabe: null (kein Redirect) | { ok: true } | { error }.
 */
export function handleRedirect() {
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  const [nonce, returnHash = '#uebersicht'] = String(p.get('state') || '').split('|');
  const expected = store.get(STATE_KEY);
  store.del(STATE_KEY);
  history.replaceState(null, '', location.pathname + location.search + returnHash);

  if (p.get('error')) return { error: p.get('error') === 'access_denied' ? 'Anmeldung abgebrochen' : p.get('error') };
  if (!expected || nonce !== expected) return { error: 'Ungültige Anmeldeantwort (state). Bitte erneut anmelden.' };
  const scopes = String(p.get('scope') || '').split(' ');
  if (!CONFIG.SCOPES.split(' ').every((s) => scopes.includes(s))) {
    return { error: 'Sheets-Berechtigung wurde nicht erteilt – beim Login das Häkchen setzen.' };
  }
  store.set(KEY, JSON.stringify({
    access_token: p.get('access_token'),
    expires: Date.now() + Number(p.get('expires_in') || 3600) * 1000,
  }));
  store.set(SEEN_KEY, '1');
  return { ok: true };
}

export function signOut() {
  const t = load();
  clearToken();
  store.del(SEEN_KEY);
  if (t) {
    fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.access_token), {
      method: 'POST', mode: 'no-cors', keepalive: true,
    }).catch(() => {});
  }
}

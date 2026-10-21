// Kurshistorie on demand – nichts wird im Sheet gespeichert.
//   coingecko:<id>  → direkt aus dem Browser (CORS ok, ohne Key, Rate-Limit beachten)
//   yahoo:<symbol>  → über den Apps-Script-Kursproxy (Yahoo erlaubt kein CORS)
import { CONFIG } from './config.js';

const cache = new Map(); // Session-Cache: key → { ts, data }

function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data);
  return fn().then((data) => {
    cache.set(key, { ts: Date.now(), data });
    return data;
  });
}

// CoinGecko wählt die Auflösung selbst: 1 Tag → 5 min, 2–90 Tage → 1 h, darüber → 1 Tag
async function coingecko(id, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=eur&days=${days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}${res.status === 429 ? ' (Rate-Limit, kurz warten)' : ''}`);
  const j = await res.json();
  return j.prices.map(([ms, p]) => ({ t: ms, p }));
}

// Yahoo über den Proxy. Intraday für kurze Zeiträume, sonst Tageskurse.
function yahooParams(days) {
  if (days <= 1) return { range: '5d', interval: '30m' }; // 5d: Vortagesschluss deckt die Nacht ab
  if (days <= 31) return { range: '1mo', interval: '1h' };
  if (days <= 92) return { range: '3mo', interval: '1d' };
  if (days <= 183) return { range: '6mo', interval: '1d' };
  if (days <= 366) return { range: '1y', interval: '1d' };
  if (days <= 1830) return { range: '5y', interval: '1d' };
  return { range: 'max', interval: '1d' };
}

async function proxy(symbol, days) {
  if (!CONFIG.KURS_PROXY_URL) throw new Error('Kursproxy nicht konfiguriert');
  const { range, interval } = yahooParams(days);
  const u = new URL(CONFIG.KURS_PROXY_URL);
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('range', range);
  u.searchParams.set('interval', interval);
  if (CONFIG.KURS_PROXY_KEY) u.searchParams.set('key', CONFIG.KURS_PROXY_KEY);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Kursproxy ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`Kursproxy: ${j.error}`);
  return j.points.map(([ms, p]) => ({ t: ms, p })); // bereits EUR (KursProxy in Code.gs)
}

/** Quelle eines hist_symbol ('coingecko' | 'yahoo' | null). */
export function quelle(histSymbol) {
  const s = String(histSymbol || '').trim().split(/\s+/)[0];
  const [src, sym] = s.split(':');
  return sym ? src : null;
}

/** Ist für dieses Symbol aktuell eine Historie abrufbar? */
export function verfuegbar(histSymbol) {
  const q = quelle(histSymbol);
  return q === 'coingecko' || (q === 'yahoo' && !!CONFIG.KURS_PROXY_URL);
}

/** histSymbol z. B. 'coingecko:bitcoin' oder 'yahoo:IWDA.AS'. Liefert [{t, p}] in EUR. */
export function kursHistorie(histSymbol, days = 365) {
  const s = String(histSymbol || '').trim().split(/\s+/)[0];
  const [src, sym] = s.split(':');
  if (!sym) return Promise.reject(new Error('Kein hist_symbol im Tab „Kurse“'));
  const ttl = days <= 1 ? 5 * 60_000 : days <= 31 ? 15 * 60_000 : 60 * 60_000;
  return cached(`${s}|${days}`, ttl, () => {
    if (src === 'coingecko') return coingecko(sym, days);
    if (src === 'yahoo') return proxy(sym, days);
    return Promise.reject(new Error(`Unbekannte Quelle: ${src}`));
  });
}

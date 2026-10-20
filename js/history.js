// Kurshistorie on demand – nichts wird im Sheet gespeichert.
//   coingecko:<id>  → direkt aus dem Browser (CORS ok, ohne Key, Rate-Limit beachten)
//   yahoo:<symbol>  → über den Apps-Script-Kursproxy (Yahoo erlaubt kein CORS)
import { CONFIG } from './config.js';

const cache = new Map(); // Session-Cache: key → { ts, data }
const TTL = 30 * 60 * 1000;

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return Promise.resolve(hit.data);
  return fn().then((data) => {
    cache.set(key, { ts: Date.now(), data });
    return data;
  });
}

async function coingecko(id, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=eur&days=${days}&interval=daily`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}${res.status === 429 ? ' (Rate-Limit, kurz warten)' : ''}`);
  const j = await res.json();
  return j.prices.map(([ms, p]) => ({ t: ms, p }));
}

async function proxy(symbol, days) {
  if (!CONFIG.KURS_PROXY_URL) throw new Error('Kursproxy nicht konfiguriert (KURS_PROXY_URL in config.js)');
  const range = days <= 31 ? '1mo' : days <= 92 ? '3mo' : days <= 183 ? '6mo' : days <= 366 ? '1y' : days <= 1830 ? '5y' : 'max';
  const u = new URL(CONFIG.KURS_PROXY_URL);
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('range', range);
  if (CONFIG.KURS_PROXY_KEY) u.searchParams.set('key', CONFIG.KURS_PROXY_KEY);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Kursproxy ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`Kursproxy: ${j.error}`);
  // Proxy liefert bereits EUR (Umrechnung serverseitig, siehe KursProxy.gs)
  return j.points.map(([ms, p]) => ({ t: ms, p }));
}

/** histSymbol z. B. 'coingecko:bitcoin' oder 'yahoo:IWDA.AS'. Liefert [{t, p}] in EUR. */
export function kursHistorie(histSymbol, days = 365) {
  const s = String(histSymbol || '').trim().split(/\s+/)[0];
  const [src, sym] = s.split(':');
  if (!sym) return Promise.reject(new Error('Kein hist_symbol im Tab „Kurse“'));
  return cached(`${s}|${days}`, () => {
    if (src === 'coingecko') return coingecko(sym, days);
    if (src === 'yahoo') return proxy(sym, days);
    return Promise.reject(new Error(`Unbekannte Quelle: ${src}`));
  });
}

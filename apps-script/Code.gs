/**
 * Apps Script für das Sheet „Anlagen-DB“ (Erweiterungen → Apps Script, hier einfügen).
 *
 * 1) Kursproxy (Web-App)  – liefert Kurshistorien in EUR für das Frontend.
 *    Enthält KEINE Portfolio-Daten, nur öffentliche Marktkurse.
 * 2) updateEdelmetall()   – schreibt Gold/Silber-Kurs (EUR/oz) in Kurse!kurs_manuell_eur,
 *    weil GOOGLEFINANCE für XAU/XAG nichts liefert.
 * 3) dailySnapshot()      – schreibt täglich eine Zeile in „Snapshots“.
 *
 * Einrichtung: siehe README.md im Repo.
 */

// Optionaler Schlüssel gegen Fremdnutzung des Proxys (gleich wie KURS_PROXY_KEY in config.js).
// Leer lassen = kein Schlüssel nötig.
const PROXY_KEY = '';

// Gold/Silber: Yahoo-Futures (USD/oz). Leicht über Spot (Terminaufschlag, meist < 1 %).
const EDELMETALL = { XAU: 'GC=F', XAG: 'SI=F' };

// Spalten im Tab „Snapshots“ → Konten/Assets (identisch zu SNAPSHOT_MAP im Frontend)
const SNAPSHOT_MAP = {
  DKB: { konten: ['DKB'] },
  Flatex: { konten: ['FLATEX', 'FLATEX_CASH'] },
  Kraken: { konten: ['KRAKEN', 'KRAKEN_EUR'] },
  Ledger: { konten: ['LEDGER'] },
  Bausparer: { konten: ['BAUSPARER'] },
  N26: { konten: ['N26'] },
  Gold: { assets: ['GOLD'] },
  Silber: { assets: ['SILBER'] },
};

/* ───────────────────────── 1) Kursproxy ───────────────────────── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (PROXY_KEY && p.key !== PROXY_KEY) return json_({ error: 'unauthorized' });
    const symbol = String(p.symbol || '');
    if (!/^[A-Za-z0-9.=^\-]{1,20}$/.test(symbol)) return json_({ error: 'symbol ungültig' });
    const range = ['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'].indexOf(p.range) >= 0 ? p.range : '1y';

    const key = 'h|' + symbol + '|' + range;
    const cache = CacheService.getScriptCache();
    const hit = cache.get(key);
    if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

    const points = historieEur_(symbol, range);
    const body = JSON.stringify({ symbol: symbol, range: range, currency: 'EUR', points: points });
    if (body.length < 95000) cache.put(key, body, 6 * 3600);
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function yahoo_(symbol, range) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?range=' + range + '&interval=1d&includePrePost=false';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (res.getResponseCode() !== 200) throw new Error('Yahoo ' + res.getResponseCode() + ' für ' + symbol);
  const r = JSON.parse(res.getContentText()).chart.result;
  if (!r || !r[0]) throw new Error('keine Daten für ' + symbol);
  const ts = r[0].timestamp || [];
  const close = (r[0].indicators.adjclose && r[0].indicators.adjclose[0].adjclose) || r[0].indicators.quote[0].close;
  const out = [];
  for (let i = 0; i < ts.length; i++) if (close[i] != null) out.push([ts[i] * 1000, close[i]]);
  return { currency: r[0].meta.currency, price: r[0].meta.regularMarketPrice, points: out };
}

// Rechnet eine Yahoo-Historie in EUR um (GBp → GBP/100).
function historieEur_(symbol, range) {
  const h = yahoo_(symbol, range);
  let cur = h.currency || 'EUR';
  let faktor = 1;
  if (cur === 'GBp' || cur === 'GBX') { cur = 'GBP'; faktor = 0.01; }
  if (cur === 'EUR') return h.points.map(function (x) { return [x[0], round_(x[1] * faktor)]; });

  const fx = yahoo_(cur + 'EUR=X', range).points; // 1 cur = x EUR
  const byDay = {};
  fx.forEach(function (x) { byDay[day_(x[0])] = x[1]; });
  let last = fx.length ? fx[0][1] : null;
  return h.points.map(function (x) {
    const r = byDay[day_(x[0])];
    if (r != null) last = r;
    return [x[0], round_(x[1] * faktor * last)];
  });
}

function day_(ms) { return new Date(ms).toISOString().slice(0, 10); }
function round_(x) { return Math.round(x * 10000) / 10000; }

/* ───────────────────── 2) Gold/Silber-Kurs ───────────────────── */

function updateEdelmetall() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Kurse');
  const v = sh.getDataRange().getValues();
  const head = v[0];
  const cInst = head.indexOf('instrument');
  const cMan = head.indexOf('kurs_manuell_eur');
  const eurUsd = yahoo_('USDEUR=X', '1mo').price; // 1 USD = x EUR
  Object.keys(EDELMETALL).forEach(function (inst) {
    const row = v.findIndex(function (r) { return r[cInst] === inst; });
    if (row < 1) return;
    const usd = yahoo_(EDELMETALL[inst], '1mo').price;
    sh.getRange(row + 1, cMan + 1).setValue(round_(usd * eurUsd));
  });
  sh.getRange('L1').setValue('edelmetall_stand');
  sh.getRange('L2').setValue(new Date());
}

/* ─────────────────────── 3) Tages-Snapshot ─────────────────────── */

function tabelle_(name) {
  const v = SpreadsheetApp.getActive().getSheetByName(name).getDataRange().getValues();
  const head = v.shift();
  return v.filter(function (r) { return r.some(function (c) { return c !== ''; }); })
    .map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}

function dailySnapshot() {
  try { updateEdelmetall(); } catch (e) { console.warn('Edelmetall: ' + e); }
  SpreadsheetApp.flush();

  const kurse = {};
  tabelle_('Kurse').forEach(function (k) { kurse[k.instrument] = Number(k.kurs_eur) || 0; });
  const konten = {};
  tabelle_('Konten').forEach(function (k) { konten[k.konto_id] = k; });

  const menge = {};
  tabelle_('Transaktionen').forEach(function (t) {
    const m = Number(t.menge) || 0;
    if (['Basis', 'Kauf', 'Sparplan', 'Einlieferung'].indexOf(t.typ) >= 0) menge[t.asset_id] = (menge[t.asset_id] || 0) + m;
    if (['Verkauf', 'Auslieferung'].indexOf(t.typ) >= 0) menge[t.asset_id] = (menge[t.asset_id] || 0) - m;
  });

  const zeilen = []; // {konto, asset, risiko, wert}
  tabelle_('Assets').forEach(function (a) {
    if (a.aktiv !== true && String(a.aktiv).toUpperCase() !== 'TRUE') return;
    zeilen.push({ konto: a.konto_id, asset: a.asset_id, risiko: a.risiko, wert: (menge[a.asset_id] || 0) * (kurse[a.instrument] || 0) });
  });
  const saldo = {};
  tabelle_('Salden').forEach(function (s) {
    const d = new Date(s.datum).getTime();
    if (!saldo[s.konto_id] || d >= saldo[s.konto_id].d) saldo[s.konto_id] = { d: d, w: Number(s.saldo_eur) || 0 };
  });
  Object.keys(saldo).forEach(function (k) {
    zeilen.push({ konto: k, asset: null, risiko: (konten[k] && konten[k].risiko) || 'Sicher', wert: saldo[k].w });
  });

  const summe = zeilen.reduce(function (a, z) { return a + z.wert; }, 0);
  const risiko = {};
  zeilen.forEach(function (z) { risiko[z.risiko] = (risiko[z.risiko] || 0) + z.wert; });

  const sh = SpreadsheetApp.getActive().getSheetByName('Snapshots');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const heute = Utilities.formatDate(new Date(), 'Europe/Vienna', 'yyyy-MM-dd');
  const r2 = function (x) { return Math.round(x * 100) / 100; };
  const row = head.map(function (h) {
    if (h === 'Datum') return heute;
    if (h === 'Summe') return r2(summe);
    if (h === 'Quelle') return 'Snapshot auto';
    if (risiko[h] != null) return r2(risiko[h]);
    const def = SNAPSHOT_MAP[h];
    if (!def) return '';
    return r2(zeilen.filter(function (z) {
      return (def.konten && def.konten.indexOf(z.konto) >= 0) || (def.assets && def.assets.indexOf(z.asset) >= 0);
    }).reduce(function (a, z) { return a + z.wert; }, 0));
  });

  // Gleicher Tag schon vorhanden → überschreiben statt doppelt anhängen
  const last = sh.getLastRow();
  const lastDate = last > 1 ? sh.getRange(last, 1).getValue() : null;
  const lastIso = lastDate instanceof Date ? Utilities.formatDate(lastDate, 'Europe/Vienna', 'yyyy-MM-dd') : String(lastDate);
  if (lastIso === heute) sh.getRange(last, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

/* ─────────────────────────── Setup ─────────────────────────── */

// Einmal manuell ausführen: legt die Zeit-Trigger an (vorhandene werden ersetzt).
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['dailySnapshot', 'updateEdelmetall'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailySnapshot').timeBased().everyDays(1).atHour(22).inTimezone('Europe/Vienna').create();
  ScriptApp.newTrigger('updateEdelmetall').timeBased().everyHours(4).create();
}

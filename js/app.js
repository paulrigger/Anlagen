import { CONFIG, SNAPSHOT_MAP } from './config.js';
import { getToken, hasValidToken, signOut } from './auth.js';
import { readTables, appendRows } from './sheets.js';
import { berechne, snapshotZeile, sparplanUebersicht, naechsteTxId } from './model.js';
import { kursHistorie } from './history.js';
import { fmtEur, fmtPct, fmtNum, sign, plus, fmtDate, todaySerial, todayIso, serialToDate, esc } from './format.js';

const TABS = ['Assets', 'Kurse', 'Transaktionen', 'Sparplaene', 'Konten', 'Salden', 'Snapshots'];
const RISIKO_FARBE = { Sicher: '--r-sicher', 'Mäßig': '--r-maessig', Unsicher: '--r-unsicher' };
const $ = (sel) => document.querySelector(sel);

let db = null;
let erg = null;
const charts = {};

/* ───────────── Start / Login ───────────── */

async function start() {
  $('#btn-login').addEventListener('click', login);
  $('#btn-reload').addEventListener('click', () => laden());
  $('#btn-logout').addEventListener('click', () => { signOut(); location.reload(); });
  window.addEventListener('hashchange', zeigeView);

  if (CONFIG.CLIENT_ID.startsWith('HIER_')) {
    $('#login').hidden = false;
    $('#btn-login').disabled = true;
    $('#login-err').textContent = 'CLIENT_ID in js/config.js fehlt (siehe README).';
    return;
  }
  if (hasValidToken()) return laden();
  $('#login').hidden = false;
}

async function login() {
  $('#login-err').textContent = '';
  try {
    await getToken({ interactive: true });
    await laden();
  } catch (e) {
    $('#login-err').textContent = e.message;
  }
}

async function laden() {
  fehler(null);
  $('#login').hidden = true;
  $('#content').hidden = false;
  $('#tabs').hidden = false;
  $('#btn-reload').hidden = false;
  $('#btn-logout').hidden = false;
  if (!db) $('#view-uebersicht').innerHTML = '<div class="skeleton">Lade Daten …</div>';
  try {
    db = await readTables(TABS);
    erg = berechne(db, { heute: todaySerial() });
    $('#stand').textContent = 'Stand ' + new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
    renderUebersicht();
    renderPositionen();
    renderHistorie();
    renderErfassen();
    zeigeView();
  } catch (e) {
    fehler(e.message);
    if (/401|403|Login|Berechtigung/.test(e.message)) {
      $('#content').hidden = true;
      $('#login').hidden = false;
    }
  }
}

function zeigeView() {
  const v = (location.hash || '#uebersicht').slice(1);
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== `view-${v}`;
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('active', a.dataset.view === v);
  if (v === 'historie') zeichnePortfolioChart();
}

function fehler(msg) {
  const el = $('#global-err');
  el.hidden = !msg;
  el.textContent = msg || '';
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/* ───────────── Übersicht ───────────── */

function letzterSnapshot() {
  const s = db.Snapshots.filter((r) => typeof r.Datum === 'number' && r.Datum < todaySerial());
  return s.length ? s[s.length - 1] : null;
}

function snapshotVor(tage) {
  const ziel = todaySerial() - tage;
  let best = null;
  for (const r of db.Snapshots) if (typeof r.Datum === 'number' && r.Datum <= ziel) best = r;
  return best;
}

function deltaKpi(label, ref) {
  if (!ref) return '';
  const d = erg.summe - Number(ref.Summe);
  const p = d / Number(ref.Summe);
  return `<div class="kpi"><div class="l">${esc(label)} <span class="small">(${fmtDate(ref.Datum)})</span></div>
    <div class="v ${sign(d)}">${plus(fmtEur(d), d)} <span class="small">${plus(fmtPct(p), p)}</span></div></div>`;
}

function barListe(rows, farbe) {
  const max = Math.max(...rows.map((r) => r.anteil), 0.0001);
  return `<div class="bars">${rows
    .map((r) => `<div class="bar-row"><span>${esc(r.name)}</span>
      <div class="bar"><span style="width:${(r.anteil / max) * 100}%;background:${farbe ? `var(${farbe(r.name)})` : 'var(--accent)'}"></span></div>
      <span class="num">${fmtPct(r.anteil)} <span class="muted small">${fmtEur(r.wert)}</span></span></div>`)
    .join('')}</div>`;
}

function renderUebersicht() {
  const sp = sparplanUebersicht(db.Sparplaene);
  const ytdRef = (() => {
    const j = new Date().getFullYear();
    return db.Snapshots.find((r) => typeof r.Datum === 'number' && serialToDate(r.Datum).getUTCFullYear() === j) ?? null;
  })();

  const hinweise = [];
  for (const k of erg.klumpen) {
    if (k.anteil >= CONFIG.KLUMPEN_SCHWELLE) hinweise.push(`<span class="warn">▲</span> Klumpenrisiko <b>${esc(k.name)}</b>: ${fmtPct(k.anteil)} des Vermögens`);
  }
  if (erg.manuelleKurse.length) hinweise.push(`<span class="warn">●</span> Kein Live-Kurs (Fallback/Script): ${erg.manuelleKurse.map(esc).join(', ')}`);
  for (const c of erg.cash) {
    if (c.alterTage != null && c.alterTage > 30) hinweise.push(`<span class="warn">●</span> Saldo <b>${esc(c.name)}</b> ist ${c.alterTage} Tage alt (${fmtDate(c.datum)})`);
  }
  if (sp.inaktiv > 0) hinweise.push(`<span class="muted">○</span> Sparplan: ${fmtEur(sp.aktiv)}/Monat aktiv, ${fmtEur(sp.inaktiv)} geplant aber inaktiv`);
  const letzte = letzterSnapshot();
  if (letzte && todaySerial() - letzte.Datum > 8) hinweise.push(`<span class="warn">●</span> Letzter Snapshot ${fmtDate(letzte.Datum)} – Trigger prüfen`);

  const stack = erg.risiko
    .map((r) => `<span style="width:${r.anteil * 100}%;background:var(${RISIKO_FARBE[r.name] || '--muted'})" title="${esc(r.name)}"></span>`)
    .join('');

  $('#view-uebersicht').innerHTML = `
    <div class="card">
      <h2>Gesamtvermögen</h2>
      <div class="hero"><span class="big">${fmtEur(erg.summe)}</span>
        <span class="${sign(erg.gvSumme)}">G/V Positionen ${plus(fmtEur(erg.gvSumme), erg.gvSumme)}
        <span class="muted small">auf ${fmtEur(erg.einstandSumme)} Einstand (ohne Ledger/Edelmetall)</span></span></div>
      <div class="kpis">
        ${deltaKpi('Seit letztem Snapshot', letzte)}
        ${deltaKpi('~4 Wochen', snapshotVor(28))}
        ${deltaKpi('Seit Jahresbeginn', ytdRef)}
      </div>
    </div>
    <div class="grid two">
      <div class="card"><h2>Risiko</h2>
        <div class="stack">${stack}</div>
        ${barListe(erg.risiko, (n) => RISIKO_FARBE[n] || '--muted')}
      </div>
      <div class="card"><h2>Anlageklasse</h2>${barListe(erg.klasse)}</div>
    </div>
    <div class="card"><h2>Hinweise</h2>
      ${hinweise.length ? `<ul class="list">${hinweise.map((h) => `<li>${h}</li>`).join('')}</ul>` : '<p class="muted">Keine Auffälligkeiten.</p>'}
    </div>
    <div class="card"><h2>Sparpläne</h2>
      <table><thead><tr><th>Plan</th><th>Betrag</th><th>Tag</th><th>Status</th></tr></thead><tbody>
      ${sp.plaene.map((p) => `<tr><td>${esc(nameVon(p.asset_id))}<span class="sub">${esc(p.notiz)}</span></td>
        <td>${fmtEur(Number(p.betrag_eur))}</td><td>${esc(p.tag)}.</td>
        <td>${String(p.aktiv).toUpperCase() === 'TRUE' ? '<span class="pos">aktiv</span>' : '<span class="muted">inaktiv</span>'}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
}

const nameVon = (assetId) => db.Assets.find((a) => a.asset_id === assetId)?.bezeichnung || assetId;

/* ───────────── Positionen ───────────── */

function renderPositionen() {
  const nachKonto = {};
  for (const p of [...erg.positionen, ...erg.cash]) (nachKonto[p.konto] ??= []).push(p);
  const kontoName = (id) => db.Konten.find((k) => k.konto_id === id)?.bezeichnung || id;
  const reihenfolge = Object.keys(nachKonto).sort((a, b) =>
    nachKonto[b].reduce((s, p) => s + (p.wert ?? 0), 0) - nachKonto[a].reduce((s, p) => s + (p.wert ?? 0), 0));

  const zeilen = reihenfolge.map((k) => {
    const ps = nachKonto[k].sort((a, b) => (b.wert ?? 0) - (a.wert ?? 0));
    const sum = ps.reduce((s, p) => s + (p.wert ?? 0), 0);
    return `<tr class="group"><td>${esc(kontoName(k))}</td><td class="hide-sm"></td><td class="hide-sm"></td><td>${fmtEur(sum)}</td><td>${fmtPct(sum / erg.summe)}</td><td></td></tr>` +
      ps.map((p) => p.typ === 'cash'
        ? `<tr><td>${esc(p.name)}<span class="sub">Saldo vom ${fmtDate(p.datum)}</span></td><td class="hide-sm"></td><td class="hide-sm"></td>
            <td>${fmtEur(p.wert)}</td><td>${fmtPct(p.wert / erg.summe)}</td><td></td></tr>`
        : `<tr><td>${esc(p.name)}<span class="sub">${esc(p.isin || p.klasse)}${p.kursQuelle !== 'live' ? ' · <span class="warn">' + esc(p.kursQuelle) + '</span>' : ''}</span></td>
            <td class="hide-sm">${fmtNum(p.menge)} ${esc(p.einheit)}</td>
            <td class="hide-sm">${fmtEur(p.kurs, 2)}</td>
            <td>${fmtEur(p.wert)}</td><td>${fmtPct(p.wert / erg.summe)}</td>
            <td class="${sign(p.gv)}">${p.gv == null ? '<span class="muted">–</span>' : plus(fmtEur(p.gv), p.gv) + `<span class="sub">${plus(fmtPct(p.gvPct), p.gvPct)}</span>`}</td></tr>`).join('');
  }).join('');

  $('#view-positionen').innerHTML = `<div class="card"><h2>Positionen</h2><div class="table-wrap"><table>
    <thead><tr><th>Position</th><th class="hide-sm">Menge</th><th class="hide-sm">Kurs</th><th>Wert</th><th>Anteil</th><th>G/V</th></tr></thead>
    <tbody>${zeilen}</tbody>
    <tfoot><tr><td><b>Summe</b></td><td class="hide-sm"></td><td class="hide-sm"></td><td><b>${fmtEur(erg.summe)}</b></td><td></td>
      <td class="${sign(erg.gvSumme)}"><b>${plus(fmtEur(erg.gvSumme), erg.gvSumme)}</b></td></tr></tfoot>
  </table></div></div>`;
}

/* ───────────── Historie ───────────── */

let portfolioRange = 'max';
let portfolioMode = 'summe';
let assetDays = 365;

function renderHistorie() {
  const instrumente = db.Kurse.filter((k) => k.hist_symbol);
  $('#view-historie').innerHTML = `
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">Vermögensverlauf</h2>
        <div class="seg" id="seg-mode"><button data-v="summe">Summe</button><button data-v="risiko">Risiko</button></div>
        <div class="seg" id="seg-range"><button data-v="1">1J</button><button data-v="3">3J</button><button data-v="max">Max</button></div>
      </div>
      <div class="chart-box"><canvas id="ch-portfolio"></canvas></div>
      <p class="muted small">Aus dem Tab „Snapshots“ (${db.Snapshots.length} Einträge).</p>
    </div>
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">Kursverlauf</h2>
        <select id="sel-instr" style="max-width:240px">${instrumente.map((k) => `<option value="${esc(k.instrument)}">${esc(k.instrument)}</option>`).join('')}</select>
        <div class="seg" id="seg-days"><button data-v="30">1M</button><button data-v="90">3M</button><button data-v="365">1J</button><button data-v="1825">5J</button></div>
      </div>
      <div class="chart-box"><canvas id="ch-asset"></canvas></div>
      <p id="asset-info" class="muted small"></p>
    </div>`;

  seg('#seg-range', portfolioRange, (v) => { portfolioRange = v; zeichnePortfolioChart(); });
  seg('#seg-mode', portfolioMode, (v) => { portfolioMode = v; zeichnePortfolioChart(); });
  seg('#seg-days', String(assetDays), (v) => { assetDays = Number(v); zeichneAssetChart(); });
  $('#sel-instr').addEventListener('change', zeichneAssetChart);
  zeichneAssetChart();
}

function seg(sel, aktiv, onChange) {
  const box = $(sel);
  const set = (v) => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  set(aktiv);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    set(b.dataset.v);
    onChange(b.dataset.v);
  });
}

function chartBasis() {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: css('--muted'), boxWidth: 10 } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtEur(c.parsed.y)}` } },
    },
    scales: {
      x: { type: 'linear', ticks: { color: css('--muted'), maxTicksLimit: 6, callback: (v) => new Date(v).toLocaleDateString('de-AT', { month: 'short', year: '2-digit' }) }, grid: { color: css('--line') } },
      y: { ticks: { color: css('--muted'), callback: (v) => fmtEur(v) }, grid: { color: css('--line') } },
    },
  };
}

function zeichnePortfolioChart() {
  if (!window.Chart || !db || $('#view-historie').hidden) return;
  let rows = db.Snapshots.filter((r) => typeof r.Datum === 'number');
  if (portfolioRange !== 'max') {
    const ab = todaySerial() - Number(portfolioRange) * 365;
    rows = rows.filter((r) => r.Datum >= ab);
  }
  // heutiger Live-Wert als letzter Punkt
  const live = { Datum: todaySerial(), Summe: erg.summe, ...Object.fromEntries(erg.risiko.map((r) => [r.name, r.wert])) };
  rows = [...rows.filter((r) => r.Datum < live.Datum), live];
  const x = (r) => serialToDate(r.Datum).getTime();

  const datasets = portfolioMode === 'summe'
    ? [{ label: 'Summe', data: rows.map((r) => ({ x: x(r), y: Number(r.Summe) })), borderColor: css('--accent'), backgroundColor: 'transparent', cubicInterpolationMode: 'monotone', pointRadius: 2 }]
    : ['Sicher', 'Mäßig', 'Unsicher'].map((k) => ({
      label: k, data: rows.map((r) => ({ x: x(r), y: Number(r[k]) || 0 })),
      borderColor: css(RISIKO_FARBE[k]), backgroundColor: css(RISIKO_FARBE[k]) + '55', fill: true, cubicInterpolationMode: 'monotone', pointRadius: 0,
    }));

  const opts = chartBasis();
  if (portfolioMode === 'risiko') opts.scales.y.stacked = true;
  charts.portfolio?.destroy();
  charts.portfolio = new Chart($('#ch-portfolio'), { type: 'line', data: { datasets }, options: opts });
}

async function zeichneAssetChart() {
  const inst = $('#sel-instr')?.value;
  if (!inst || !window.Chart) return;
  const k = db.Kurse.find((r) => r.instrument === inst);
  const info = $('#asset-info');
  info.textContent = 'Lade …';
  try {
    const pts = await kursHistorie(k.hist_symbol, assetDays);
    // Durchschnittlicher Einstandskurs (alle Positionen dieses Instruments mit bekanntem Einstand)
    const pos = erg.positionen.filter((p) => p.instrument === inst && p.einstand != null && p.menge > 0);
    const m = pos.reduce((s, p) => s + p.menge, 0);
    const ek = m ? pos.reduce((s, p) => s + p.einstand, 0) / m : null;

    const datasets = [{ label: inst, data: pts.map((p) => ({ x: p.t, y: p.p })), borderColor: css('--accent'), backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5 }];
    if (ek) datasets.push({ label: 'Ø Einstand', data: [{ x: pts[0].t, y: ek }, { x: pts.at(-1).t, y: ek }], borderColor: css('--muted'), borderDash: [5, 5], pointRadius: 0 });

    charts.asset?.destroy();
    charts.asset = new Chart($('#ch-asset'), { type: 'line', data: { datasets }, options: chartBasis() });
    const first = pts[0].p;
    const last = pts.at(-1).p;
    info.innerHTML = `${esc(k.hist_symbol)} · Veränderung im Zeitraum <span class="${sign(last - first)}">${plus(fmtPct(last / first - 1), last - first)}</span> · nicht im Sheet gespeichert`;
  } catch (e) {
    charts.asset?.destroy();
    info.innerHTML = `<span class="err">${esc(e.message)}</span>`;
  }
}

/* ───────────── Erfassen ───────────── */

function renderErfassen() {
  const assets = db.Assets.filter((a) => String(a.aktiv).toUpperCase() === 'TRUE');
  const cashKonten = db.Konten.filter((k) => k.typ === 'Cash');
  $('#view-erfassen').innerHTML = `
    <div class="card"><h2>Transaktion</h2>
      <form id="f-tx">
        <div class="fields">
          <label>Datum<input type="date" name="datum" required value="${todayIso()}"></label>
          <label>Typ<select name="typ">${['Kauf', 'Sparplan', 'Verkauf', 'Einlieferung', 'Auslieferung'].map((t) => `<option>${t}</option>`).join('')}</select></label>
          <label>Asset<select name="asset_id">${assets.map((a) => `<option value="${esc(a.asset_id)}">${esc(a.bezeichnung)}</option>`).join('')}</select></label>
          <label>Menge<input name="menge" inputmode="decimal" required placeholder="z. B. 1,0624"></label>
          <label>Kurs € <input name="kurs_eur" inputmode="decimal" placeholder="optional"></label>
          <label>Betrag € (inkl. Gebühr)<input name="betrag_eur" inputmode="decimal" placeholder="Einstand"></label>
          <label>Gebühr €<input name="gebuehr_eur" inputmode="decimal" placeholder="0"></label>
          <label>Notiz<input name="notiz" placeholder="optional"></label>
        </div>
        <p class="muted small">Menge leer lassen und Kurs + Betrag angeben → Menge = (Betrag − Gebühr) / Kurs.</p>
        <div><button class="primary" type="submit">Speichern</button></div>
      </form>
    </div>
    <div class="card"><h2>Kontosaldo</h2>
      <form id="f-saldo">
        <div class="fields">
          <label>Datum<input type="date" name="datum" required value="${todayIso()}"></label>
          <label>Konto<select name="konto_id">${cashKonten.map((k) => `<option value="${esc(k.konto_id)}">${esc(k.bezeichnung)}</option>`).join('')}</select></label>
          <label>Saldo €<input name="saldo_eur" inputmode="decimal" required></label>
        </div>
        <div><button class="primary" type="submit">Speichern</button></div>
      </form>
    </div>
    <div class="card"><h2>Snapshot</h2>
      <p class="muted">Schreibt den aktuellen Stand als Zeile in „Snapshots“. Läuft sonst täglich automatisch per Apps Script.</p>
      <button class="secondary" id="btn-snap">Snapshot jetzt schreiben</button>
    </div>`;

  // Menge leichter erfassen: bei leerem Mengenfeld nicht blockieren
  $('#f-tx [name=menge]').required = false;
  $('#f-tx').addEventListener('submit', speichereTx);
  $('#f-saldo').addEventListener('submit', speichereSaldo);
  $('#btn-snap').addEventListener('click', schreibeSnapshot);
}

const dez = (s) => {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const n = Number(t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

async function sperre(form, fn) {
  const btn = form.querySelector('button[type=submit]') || form;
  btn.disabled = true;
  try { await fn(); } catch (e) { toast('Fehler: ' + e.message); } finally { btn.disabled = false; }
}

function speichereTx(e) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  sperre(e.target, async () => {
    const kurs = dez(f.kurs_eur);
    const betrag = dez(f.betrag_eur);
    const gebuehr = dez(f.gebuehr_eur) ?? 0;
    let menge = dez(f.menge);
    if (menge == null && kurs && betrag != null) menge = Math.round(((betrag - gebuehr) / kurs) * 1e6) / 1e6;
    if ([kurs, betrag, gebuehr, menge].some((v) => Number.isNaN(v))) throw new Error('Zahl nicht lesbar');
    if (!menge || menge <= 0) throw new Error('Menge fehlt');
    await appendRows('Transaktionen', [[naechsteTxId(db.Transaktionen), f.datum, f.asset_id, f.typ, menge, kurs ?? '', betrag ?? '', gebuehr, 'App', f.notiz || '']]);
    toast(`Gespeichert: ${fmtNum(menge)} × ${nameVon(f.asset_id)}`);
    e.target.reset();
    await laden();
    location.hash = '#erfassen';
  });
}

function speichereSaldo(e) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  sperre(e.target, async () => {
    const saldo = dez(f.saldo_eur);
    if (saldo == null || Number.isNaN(saldo)) throw new Error('Saldo nicht lesbar');
    await appendRows('Salden', [[f.datum, f.konto_id, saldo, 'App']]);
    toast('Saldo gespeichert');
    await laden();
    location.hash = '#erfassen';
  });
}

async function schreibeSnapshot(e) {
  const btn = e.target;
  btn.disabled = true;
  try {
    const heute = todaySerial();
    if (db.Snapshots.some((r) => r.Datum === heute) && !confirm('Für heute gibt es schon einen Snapshot. Trotzdem eine weitere Zeile anhängen?')) return;
    const row = snapshotZeile(erg, db.Snapshots.header, SNAPSHOT_MAP, todayIso(), 'App');
    await appendRows('Snapshots', [row]);
    toast('Snapshot geschrieben');
    await laden();
  } catch (err) {
    toast('Fehler: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

start();

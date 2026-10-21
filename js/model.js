// Reine Rechenlogik – keine DOM-/Netz-Abhängigkeiten (auch in Node testbar).

const ZUGANG = new Set(['Basis', 'Kauf', 'Sparplan', 'Einlieferung']);
const ABGANG = new Set(['Verkauf', 'Auslieferung']);

const num = (v) => (v === '' || v == null ? null : Number(v));
const isTrue = (v) => v === true || String(v).toUpperCase() === 'TRUE';

/**
 * Bestand und Einstand je Asset aus den Transaktionen (chronologisch).
 * Einstand: Zugänge addieren betrag_eur (inkl. Gebühr), Abgänge reduzieren
 * anteilig zum Durchschnittseinstand. Fehlt bei einem Zugang der Betrag,
 * ist der Einstand des Assets unbekannt (null).
 */
export function bestaende(transaktionen) {
  const sorted = [...transaktionen].sort((a, b) => (a.datum - b.datum) || String(a.tx_id).localeCompare(String(b.tx_id)));
  const out = {};
  for (const t of sorted) {
    const id = t.asset_id;
    if (!id) continue;
    const s = (out[id] ??= { menge: 0, einstand: 0, einstandBekannt: true, letzteTx: null });
    const m = num(t.menge) ?? 0;
    const betrag = num(t.betrag_eur);
    if (ZUGANG.has(t.typ)) {
      s.menge += m;
      if (betrag == null) s.einstandBekannt = false;
      else s.einstand += betrag;
    } else if (ABGANG.has(t.typ)) {
      if (s.menge > 0 && s.einstandBekannt) s.einstand -= s.einstand * Math.min(m / s.menge, 1);
      s.menge -= m;
    }
    s.letzteTx = t.datum;
  }
  for (const s of Object.values(out)) {
    s.menge = Math.round(s.menge * 1e8) / 1e8;
    if (!s.einstandBekannt) s.einstand = null;
  }
  return out;
}

/** Letzter Saldo je Konto (nach Datum). */
export function aktuelleSalden(salden) {
  const out = {};
  for (const s of salden) {
    const prev = out[s.konto_id];
    if (!prev || s.datum >= prev.datum) out[s.konto_id] = { saldo: num(s.saldo_eur) ?? 0, datum: s.datum, quelle: s.quelle };
  }
  return out;
}

/**
 * Gesamtrechnung. Erwartet die Tabs als Objektlisten (siehe sheets.readTables).
 * heute: Sheets-Seriennummer für Altersprüfung der Salden.
 */
export function berechne(db, { heute } = {}) {
  const kurse = Object.fromEntries(db.Kurse.map((k) => [k.instrument, k]));
  const konten = Object.fromEntries(db.Konten.map((k) => [k.konto_id, k]));
  const best = bestaende(db.Transaktionen);
  const salden = aktuelleSalden(db.Salden);

  const positionen = db.Assets.filter((a) => isTrue(a.aktiv)).map((a) => {
    const b = best[a.asset_id] ?? { menge: 0, einstand: null };
    const k = kurse[a.instrument] ?? {};
    const kurs = num(k.kurs_eur);
    const wert = kurs != null ? b.menge * kurs : null;
    const gv = wert != null && b.einstand != null ? wert - b.einstand : null;
    return {
      typ: 'position',
      id: a.asset_id,
      instrument: a.instrument,
      konto: a.konto_id,
      klasse: a.klasse,
      risiko: a.risiko,
      name: a.bezeichnung,
      isin: a.isin,
      einheit: a.einheit,
      menge: b.menge,
      kurs,
      kursQuelle: k.quelle || 'fehlt',
      wert,
      einstand: b.einstand,
      gv,
      gvPct: gv != null && b.einstand ? gv / b.einstand : null,
    };
  });

  const cash = Object.entries(salden).map(([id, s]) => ({
    typ: 'cash',
    id,
    konto: id,
    klasse: 'Cash',
    risiko: konten[id]?.risiko || 'Sicher',
    name: konten[id]?.bezeichnung || id,
    wert: s.saldo,
    datum: s.datum,
    alterTage: heute != null ? Math.floor(heute - s.datum) : null,
  }));

  const alle = [...positionen, ...cash];
  const summe = alle.reduce((acc, p) => acc + (p.wert ?? 0), 0);

  const gruppe = (key) => {
    const g = {};
    for (const p of alle) {
      const k = p[key] || '–';
      g[k] = (g[k] ?? 0) + (p.wert ?? 0);
    }
    return Object.entries(g)
      .map(([name, wert]) => ({ name, wert, anteil: summe ? wert / summe : 0 }))
      .sort((a, b) => b.wert - a.wert);
  };

  // Klumpen je Instrument (BTC Kraken + Ledger zusammen)
  const jeInstrument = {};
  for (const p of positionen) jeInstrument[p.instrument] = (jeInstrument[p.instrument] ?? 0) + (p.wert ?? 0);
  const klumpen = Object.entries(jeInstrument)
    .map(([name, wert]) => ({ name, wert, anteil: summe ? wert / summe : 0 }))
    .sort((a, b) => b.wert - a.wert);

  const einstandSumme = positionen.reduce((a, p) => a + (p.einstand ?? 0), 0);
  const gvSumme = positionen.reduce((a, p) => a + (p.gv ?? 0), 0);

  return {
    positionen,
    cash,
    summe,
    einstandSumme,
    gvSumme,
    risiko: gruppe('risiko'),
    klasse: gruppe('klasse'),
    konto: gruppe('konto'),
    klumpen,
    manuelleKurse: positionen.filter((p) => p.kursQuelle !== 'live').map((p) => p.id),
  };
}

/** Eine Snapshot-Zeile passend zur Kopfzeile des Tabs „Snapshots“. */
export function snapshotZeile(ergebnis, header, map, datumIso, quelle = 'App') {
  const alle = [...ergebnis.positionen, ...ergebnis.cash];
  const summeFuer = (def) =>
    alle
      .filter((p) => (def.konten && def.konten.includes(p.konto)) || (def.assets && p.typ === 'position' && def.assets.includes(p.id)))
      .reduce((a, p) => a + (p.wert ?? 0), 0);
  const risiko = Object.fromEntries(ergebnis.risiko.map((r) => [r.name, r.wert]));
  const r2 = (x) => Math.round(x * 100) / 100;
  return header.map((h) => {
    if (h === 'Datum') return datumIso;
    if (h === 'Summe') return r2(ergebnis.summe);
    if (h === 'Quelle') return quelle;
    if (h in risiko) return r2(risiko[h]);
    if (map[h]) return r2(summeFuer(map[h]));
    return '';
  });
}

/**
 * Rekonstruierter Vermögensverlauf: Bestand zum Zeitpunkt t × Kurs zum Zeitpunkt t + Cash.
 * - Bestand aus Transaktionen; „Basis“ gilt als seit jeher gehalten.
 * - Kurs: letzter bekannter Kurs ≤ t aus `serien` (sonst erster verfügbarer);
 *   Instrumente ohne Serie bleiben auf dem aktuellen Kurs (konstant).
 * - Cash: letzter Saldo ≤ t (sonst frühester).
 * grid: aufsteigende Zeitpunkte in ms. Liefert [{ t, v, risiko: {Sicher, …} }].
 */
export function portfolioKurve({ assets, transaktionen, salden, konten, kurseJetzt, serien, grid }) {
  const ms = (serial) => (serial - 25569) * 86400000;
  const aktiv = assets.filter((a) => isTrue(a.aktiv));

  const txBy = {};
  for (const t of transaktionen) (txBy[t.asset_id] ??= []).push(t);
  const menge = (id, t) => (txBy[id] || []).reduce((s, x) => {
    if (x.typ !== 'Basis' && ms(x.datum) > t) return s;
    const m = num(x.menge) ?? 0;
    return ZUGANG.has(x.typ) ? s + m : ABGANG.has(x.typ) ? s - m : s;
  }, 0);

  // Schrittfunktion je Serie; grid ist aufsteigend → Zeiger läuft nur vorwärts
  const stepper = (pts, wert) => {
    const s = [...pts].sort((a, b) => a.t - b.t);
    let i = 0;
    return (t) => {
      while (i + 1 < s.length && s[i + 1].t <= t) i++;
      return wert(s[i].t <= t ? s[i] : s[0]);
    };
  };

  const preis = {};
  for (const [inst, jetzt] of Object.entries(kurseJetzt)) {
    const s = (serien[inst] || []).filter((p) => Number.isFinite(p.p));
    preis[inst] = s.length ? stepper(s, (p) => p.p) : () => jetzt ?? 0;
  }

  const saldoBy = {};
  for (const s of salden) (saldoBy[s.konto_id] ??= []).push({ t: ms(s.datum), v: num(s.saldo_eur) ?? 0 });
  const saldo = Object.fromEntries(Object.entries(saldoBy).map(([k, pts]) => [k, stepper(pts, (p) => p.v)]));
  const kontoRisiko = Object.fromEntries(konten.map((k) => [k.konto_id, k.risiko || 'Sicher']));

  return grid.map((t) => {
    const risiko = {};
    let v = 0;
    for (const a of aktiv) {
      const w = menge(a.asset_id, t) * (preis[a.instrument]?.(t) ?? 0);
      v += w;
      risiko[a.risiko] = (risiko[a.risiko] ?? 0) + w;
    }
    for (const [k, f] of Object.entries(saldo)) {
      const w = f(t);
      v += w;
      const r = kontoRisiko[k] || 'Sicher';
      risiko[r] = (risiko[r] ?? 0) + w;
    }
    return { t, v, risiko };
  });
}

/** Zeitraster von `from` bis `to` (ms) in Schritten von `step` ms, Endpunkt inklusive. */
export function zeitraster(from, to, step) {
  const out = [];
  for (let t = from; t < to; t += step) out.push(t);
  out.push(to);
  return out;
}

/** Sparplan-Monatsrate (aktiv vs. geplant). */
export function sparplanUebersicht(sparplaene) {
  let aktiv = 0;
  let inaktiv = 0;
  for (const s of sparplaene) {
    const b = num(s.betrag_eur) ?? 0;
    if (isTrue(s.aktiv)) aktiv += b;
    else inaktiv += b;
  }
  return { aktiv, inaktiv, plaene: sparplaene };
}

/** Nächste freie tx_id (T0001 …). */
export function naechsteTxId(transaktionen) {
  const max = transaktionen.reduce((m, t) => Math.max(m, Number(String(t.tx_id).replace(/\D/g, '')) || 0), 0);
  return 'T' + String(max + 1).padStart(4, '0');
}

import { berechne, bestaende, snapshotZeile, naechsteTxId } from '../js/model.js';
import { SNAPSHOT_MAP } from '../js/config.js';
import assert from 'node:assert/strict';

const d = (iso) => Date.UTC(...iso.split('-').map((v, i) => i === 1 ? v - 1 : +v)) / 86400000 + 25569;
const A = (asset_id, instrument, konto_id, klasse, risiko) => ({ asset_id, instrument, konto_id, klasse, risiko, bezeichnung: asset_id, aktiv: true });
const db = {
  Assets: [A('AMUNDI_PAB','AMUNDI_PAB','FLATEX','ETF','Mäßig'),A('IWDA','IWDA','FLATEX','ETF','Mäßig'),A('CSPX','CSPX','FLATEX','ETF','Mäßig'),A('UBS_SRI','UBS_SRI','FLATEX','ETF','Mäßig'),A('VHYA','VHYA','FLATEX','ETF','Mäßig'),A('VFEM','VFEM','FLATEX','ETF','Mäßig'),
    A('BTC_KRAKEN','BTC','KRAKEN','Krypto','Unsicher'),A('ETH_KRAKEN','ETH','KRAKEN','Krypto','Unsicher'),A('BTC_LEDGER','BTC','LEDGER','Krypto','Unsicher'),A('ETH_LEDGER','ETH','LEDGER','Krypto','Unsicher'),
    A('GOLD','XAU','PHYSISCH','Edelmetall','Sicher'),A('SILBER','XAG','PHYSISCH','Edelmetall','Sicher')],
  Kurse: Object.entries({AMUNDI_PAB:122.16,IWDA:130.48,CSPX:741.48,UBS_SRI:185.0882748,VHYA:94.779675,VFEM:71.19,BTC:73661.29499,ETH:2180.374331,XAU:3670.54,XAG:51.61}).map(([instrument,kurs_eur])=>({instrument,kurs_eur,quelle:'live'})),
  Transaktionen: [
    ['T0001','AMUNDI_PAB',165,20634.41],['T0002','IWDA',46,5153.85],['T0003','CSPX',8,5133.55],['T0004','UBS_SRI',4.908486,872.25],['T0005','VHYA',93,8435.10],['T0006','VFEM',100,7137.68],
    ['T0007','BTC_KRAKEN',0.12353,12476.69],['T0008','ETH_KRAKEN',0.27904,1142.35],['T0009','BTC_LEDGER',1.64661,''],['T0010','ETH_LEDGER',4.7003,''],['T0011','GOLD',10,''],['T0012','SILBER',160.7507,''],
  ].map(([tx_id,asset_id,menge,betrag_eur])=>({tx_id,datum:d('2026-10-11'),asset_id,typ:'Basis',menge,betrag_eur}))
   .concat([{tx_id:'T0013',datum:d('2026-10-15'),asset_id:'UBS_SRI',typ:'Sparplan',menge:1.062403,betrag_eur:200}]),
  Konten: [{konto_id:'FLATEX_CASH',risiko:'Sicher'},{konto_id:'KRAKEN_EUR',risiko:'Sicher'},{konto_id:'N26',risiko:'Sicher'},{konto_id:'BAUSPARER',risiko:'Sicher'},{konto_id:'DKB',risiko:'Sicher'}],
  Salden: [[ '2026-10-11','FLATEX_CASH',486.63],['2026-10-11','KRAKEN_EUR',48698.51],['2026-08-11','N26',12392],['2026-08-11','BAUSPARER',8400],['2026-08-11','DKB',0]]
    .map(([dt,konto_id,saldo_eur])=>({datum:d(dt),konto_id,saldo_eur})),
};

const e = berechne(db, { heute: d('2026-10-20') });
console.log('Summe', e.summe.toFixed(2), 'Einstand', e.einstandSumme.toFixed(2), 'G/V', e.gvSumme.toFixed(2));
console.log('Risiko', e.risiko.map(r => `${r.name} ${r.wert.toFixed(0)} ${(r.anteil*100).toFixed(1)}%`).join(' | '));
console.log('Klumpen', e.klumpen.slice(0,2).map(r => `${r.name} ${(r.anteil*100).toFixed(1)}%`).join(' | '));
assert.ok(Math.abs(e.summe - 305355.48) < 1);
assert.ok(Math.abs(e.einstandSumme - 61185.88) < 0.01);
assert.equal(e.cash.find(c => c.id === 'N26').alterTage, 70);

const header = ['Datum','DKB','Flatex','Kraken','Ledger','Bausparer','N26','Gold','Silber','Summe','Sicher','Mäßig','Unsicher','Quelle'];
const row = snapshotZeile(e, header, SNAPSHOT_MAP, '2026-10-20');
console.log('Snapshot', row.join(' ; '));
const teil = row.slice(1, 9).reduce((a, b) => a + b, 0);
assert.ok(Math.abs(teil - row[9]) < 0.05, 'Spalten summieren sich zur Summe');
assert.ok(Math.abs(row[10] + row[11] + row[12] - row[9]) < 0.05, 'Risiko summiert sich');

// Verkauf: Einstand anteilig
const b = bestaende([{tx_id:'a',datum:1,asset_id:'X',typ:'Kauf',menge:10,betrag_eur:1000},{tx_id:'b',datum:2,asset_id:'X',typ:'Verkauf',menge:4}]);
assert.equal(b.X.menge, 6); assert.ok(Math.abs(b.X.einstand - 600) < 1e-9);
assert.equal(naechsteTxId(db.Transaktionen), 'T0014');
console.log('OK');

// ── portfolioKurve ──
import { portfolioKurve, zeitraster } from '../js/model.js';
{
  const H = 3600e3, T0 = Date.UTC(2026, 9, 20, 0);   // 20.10.2026 00:00 UTC
  const serial = (ms) => ms / 86400000 + 25569;
  const k = portfolioKurve({
    assets: [{ asset_id: 'B', instrument: 'BTC', risiko: 'Unsicher', aktiv: true }, { asset_id: 'E', instrument: 'ETF', risiko: 'Mäßig', aktiv: true }],
    transaktionen: [
      { asset_id: 'B', typ: 'Basis', datum: serial(T0 + 48 * H), menge: 2 },         // Basis gilt auch vorher
      { asset_id: 'E', typ: 'Basis', datum: serial(T0), menge: 10 },
      { asset_id: 'E', typ: 'Kauf', datum: serial(T0 + 24 * H), menge: 5, betrag_eur: 500 }, // erst ab 21.10.
    ],
    salden: [{ konto_id: 'C', datum: serial(T0), saldo_eur: 1000 }],
    konten: [{ konto_id: 'C', risiko: 'Sicher' }],
    kurseJetzt: { BTC: 110, ETF: 100 },
    serien: { BTC: [{ t: T0, p: 100 }, { t: T0 + 12 * H, p: 120 }] },               // ETF ohne Serie → konstant 100
    grid: zeitraster(T0 - H, T0 + 30 * H, 6 * H),
  });
  const at = (t) => k.find((p) => p.t === t).v;
  assert.equal(at(T0 - H), 2 * 100 + 10 * 100 + 1000);        // vor erster Kursnotiz → erster Kurs
  assert.equal(at(T0 + 11 * H), 2 * 100 + 1000 + 1000);
  assert.equal(at(T0 + 17 * H), 2 * 120 + 1000 + 1000);       // Schrittfunktion
  assert.equal(at(T0 + 29 * H), 2 * 120 + 15 * 100 + 1000);   // Kauf ab 21.10. wirksam
  assert.equal(k.at(-1).t, T0 + 30 * H);                      // Endpunkt inklusive
  const r = k.at(-1).risiko; assert.equal(r.Unsicher + r['Mäßig'] + r.Sicher, k.at(-1).v);
  console.log('portfolioKurve OK');
}

// Konfiguration – keine Geheimnisse. Client-ID und Sheet-ID sind nicht vertraulich:
// Zugriff auf die Daten hat nur, wer sich mit einem Google-Konto anmeldet,
// das das Sheet lesen darf.
export const CONFIG = {
  // Google Cloud Console → APIs & Services → Credentials → OAuth client (Web)
  CLIENT_ID: 'HIER_CLIENT_ID.apps.googleusercontent.com',

  // Sheet „Anlagen-DB“
  SPREADSHEET_ID: '1h7pLCOrXicLj4Mxtwo1qDp2FmUGzAAKrTmU6MyFOnq8',

  // Lesen + Schreiben (Erfassung, Snapshot)
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets',

  // Optional: Apps-Script-Kursproxy (Web-App-URL, endet auf /exec).
  // Leer lassen → Kurshistorie nur für Krypto (CoinGecko).
  KURS_PROXY_URL: '',
  KURS_PROXY_KEY: '',

  // Klumpenrisiko-Warnung ab diesem Anteil einer einzelnen Position (Instrument)
  KLUMPEN_SCHWELLE: 0.25,
};

// Spalten im Tab „Snapshots“ (Kopfzeile) → welche Konten/Assets einfließen.
// konten: Summe aller Positionen + Cash dieser konto_id
// assets: Summe dieser asset_id
export const SNAPSHOT_MAP = {
  DKB: { konten: ['DKB'] },
  Flatex: { konten: ['FLATEX', 'FLATEX_CASH'] },
  Kraken: { konten: ['KRAKEN', 'KRAKEN_EUR'] },
  Ledger: { konten: ['LEDGER'] },
  Bausparer: { konten: ['BAUSPARER'] },
  N26: { konten: ['N26'] },
  Gold: { assets: ['GOLD'] },
  Silber: { assets: ['SILBER'] },
};

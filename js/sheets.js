// Dünner Wrapper um die Sheets API v4 (REST, kein gapi nötig).
import { CONFIG } from './config.js';
import { getToken, clearToken } from './auth.js';

const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;

async function call(path, { method = 'GET', body } = {}, retry = true) {
  const token = await getToken();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) {
    clearToken();
    return call(path, { method, body }, false);
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg += ' ' + (await res.json()).error.message; } catch { /* ignore */ }
    throw new Error(`Sheets API: ${msg}`);
  }
  return res.json();
}

// Sheets-Seriennummer (Tage seit 1899-12-30) → 'YYYY-MM-DD'
export function serialToIso(serial) {
  if (typeof serial !== 'number') return serial ? String(serial) : '';
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

// Liest mehrere Tabs; liefert { Tab: [ {kopf: wert, ...}, ... ] }
export async function readTables(tabs) {
  const q = tabs.map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:Z`)}`).join('&');
  const data = await call(
    `/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  );
  const out = {};
  data.valueRanges.forEach((vr, i) => {
    const [head = [], ...rows] = vr.values || [];
    out[tabs[i]] = rows
      .filter((r) => r.some((c) => c !== '' && c != null))
      .map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ''])));
    out[tabs[i]].header = head;
  });
  return out;
}

// Hängt Zeilen an (Werte werden wie Tastatureingabe interpretiert → ISO-Datum wird Datum)
export async function appendRows(tab, rows) {
  return call(
    `/values/${encodeURIComponent(`'${tab}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: { values: rows } },
  );
}

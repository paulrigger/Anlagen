const eur0 = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = new Intl.NumberFormat('de-AT', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const numF = (d) => new Intl.NumberFormat('de-AT', { maximumFractionDigits: d });

export const fmtEur = (v, digits = 0) => (v == null || Number.isNaN(v) ? '–' : (digits ? eur2 : eur0).format(v));
export const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '–' : pct1.format(v));
export const fmtNum = (v, d = 4) => (v == null ? '–' : numF(d).format(v));
export const sign = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
export const plus = (s, v) => (v > 0 ? '+' + s : s);

export function serialToDate(serial) {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}
export function fmtDate(serial) {
  if (typeof serial !== 'number') return String(serial ?? '');
  return serialToDate(serial).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}
export function todaySerial() {
  const now = new Date();
  const utc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return utc / 86400000 + 25569;
}
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

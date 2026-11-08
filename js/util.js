// Formatting, colors, small DOM helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
export const f1 = v => (num(v) === null ? '–' : num(v).toFixed(1));
export const f0 = v => (num(v) === null ? '–' : Math.round(num(v)).toLocaleString());
export const pct = (v, d = 1) => (num(v) === null ? '–' : num(v).toFixed(d) + '%');
export const signed = (v, d = 1) => (num(v) === null ? '–' : (num(v) > 0 ? '+' : '') + num(v).toFixed(d));

export function ordinal(n) {
  n = Math.round(n);
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 14) return Math.round(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return iso ? new Date(iso).toLocaleDateString(undefined, opts) : '';
}
export function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
}
export function ymd(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}`;
}

// ---------- colors
function hexToRgb(h) {
  h = (h || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export function lum(h) {
  const rgb = hexToRgb(h);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function mix(h, target, t) {
  const a = hexToRgb(h), b = hexToRgb(target);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
}
export const onColor = h => (lum(h) > 0.36 ? '#111111' : '#ffffff');

/** Pick a team accent that stays readable on the current page background. */
export function teamAccent(color, alt, theme) {
  const bg = theme === 'dark' ? '#0f1216' : '#ffffff';
  const cands = [color, alt].filter(c => hexToRgb(c)).map(c => '#' + c.replace('#', ''));
  if (!cands.length) return theme === 'dark' ? '#7aa7ff' : '#1d4ed8';
  // prefer the primary color if it's readable, else the alternate, else adjust the primary
  for (const c of cands) if (contrast(c, bg) >= 3 && !(theme === 'dark' && lum(c) < 0.03)) return c;
  let c = cands[0];
  for (let i = 1; i <= 10 && contrast(c, bg) < 3; i++) c = mix(cands[0], theme === 'dark' ? '#ffffff' : '#000000', i * 0.08);
  return c;
}
/** Solid band color for headers (team primary; avoid pure white bands). */
export function teamBand(color, alt) {
  const c = '#' + String(color || '333333').replace('#', '');
  if (lum(c) > 0.85 && alt) return '#' + String(alt).replace('#', '');
  return c;
}

export function logoFor(team, theme) {
  if (!team) return '';
  return (theme === 'dark' && team.logoDark) ? team.logoDark : (team.logo || '');
}

export function stars(n) {
  n = Math.round(num(n) || 0);
  return n ? '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n)) : '';
}

export function heightStr(inches) {
  inches = num(inches);
  if (!inches) return '';
  return `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;
}

export function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '');
}

/** Small inline line chart (SVG) */
export function sparkline(values, { w = 220, h = 48, color = 'currentColor', mid = null, fill = false } = {}) {
  const v = values.filter(x => num(x) !== null);
  if (v.length < 2) return '';
  const min = Math.min(...v, mid ?? Infinity), max = Math.max(...v, mid ?? -Infinity);
  const sx = i => (i / (v.length - 1)) * (w - 4) + 2;
  const sy = x => h - 3 - ((x - min) / ((max - min) || 1)) * (h - 6);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(x).toFixed(1)}`).join('');
  const midLine = mid !== null ? `<line x1="0" x2="${w}" y1="${sy(mid)}" y2="${sy(mid)}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="3 3"/>` : '';
  const area = fill ? `<path d="${d}L${sx(v.length - 1)},${h}L${sx(0)},${h}Z" fill="${color}" fill-opacity=".12"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${midLine}${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function tierLabel(value, cuts, labels) {
  // cuts ascending; labels length cuts+1
  const v = num(value);
  if (v === null) return '';
  let i = 0; while (i < cuts.length && v >= cuts[i]) i++;
  return labels[i];
}

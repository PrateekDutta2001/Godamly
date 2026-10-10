/**
 * Shared formatting, escaping, and browser helpers.
 * Formatters read company settings once the app configures them.
 */

let settingsGetter = () => ({
  currencySymbol: '₹',
  dateFormat: 'DD/MM/YYYY',
  currency: 'INR',
});

/** @param {() => object} fn */
export function configureFormatters(fn) {
  settingsGetter = fn;
}

export function settings() {
  try {
    return settingsGetter() || {};
  } catch {
    return {};
  }
}

/** Escape text for safe HTML insertion. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid(prefix) {
  const raw = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${raw.replace(/-/g, '').slice(0, 10)}`;
}

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function roundQty(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

export function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function formatMoney(n) {
  const symbol = settings().currencySymbol || '₹';
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return symbol + safe.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function todayKey() {
  const d = new Date();
  return dateKey(d);
}

export function dateKey(value) {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(key, days) {
  const d = parseDate(key) || new Date();
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export function formatDate(value, withTime = false) {
  const d = parseDate(value);
  if (!d) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const fmt = settings().dateFormat || 'DD/MM/YYYY';
  let out = `${y}-${m}-${day}`;
  if (fmt === 'DD/MM/YYYY') out = `${day}/${m}/${y}`;
  else if (fmt === 'MM/DD/YYYY') out = `${m}/${day}/${y}`;
  if (!withTime) return out;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${out} ${hh}:${mm}`;
}

export function relativeTime(value) {
  const d = parseDate(value);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(d, true);
}

export function debounce(fn, wait = 200) {
  let t = 0;
  return (...args) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), wait);
  };
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(rows, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(',')).join('\r\n');
  return `${header}\r\n${body}`;
}

export function downloadCSV(filename, csv) {
  downloadBlob(filename, new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
}

export function downloadJSON(filename, data) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}

export function routeQuery() {
  const hash = location.hash || '';
  const i = hash.indexOf('?');
  if (i < 0) return new URLSearchParams();
  return new URLSearchParams(hash.slice(i + 1));
}

export function stripHashQuery(path) {
  const base = `${location.pathname}${location.search}#/${path}`;
  if (location.hash !== `#/${path}`) {
    history.replaceState(null, '', base);
  }
}

export function safeImageSrc(src) {
  return typeof src === 'string' && src.startsWith('data:image/') ? src : '';
}

export function safeHash(href) {
  return typeof href === 'string' && /^#\/[a-z0-9-]+(\?focus=[a-zA-Z0-9_-]+)?$/.test(href) ? href : '#/dashboard';
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('').toUpperCase() || '?';
}

export function sum(rows, fn) {
  return rows.reduce((acc, row) => acc + (Number(fn(row)) || 0), 0);
}

export function groupBy(rows, fn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = fn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

export function readImageFile(file, max = 480) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Choose an image file.'));
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    if (file.size > 5 * 1024 * 1024) return reject(new Error('Image must be under 5 MB.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  return `${part}, ${first}`;
}

export function printHtml(html) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  root.innerHTML = html;
  document.body.classList.add('is-printing');
  const cleanup = () => {
    document.body.classList.remove('is-printing');
    root.innerHTML = '';
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => window.print(), 40);
}

export function daysBetween(fromKey, toKey) {
  const a = parseDate(fromKey);
  const b = parseDate(toKey);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function eachDate(fromKey, toKey) {
  const out = [];
  let cursor = fromKey;
  let guard = 0;
  while (cursor <= toKey && guard < 400) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out;
}

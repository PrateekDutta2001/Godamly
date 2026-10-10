/** Hand-drawn SVG charts. */
import { esc, formatMoney, fmtQty } from '../core/utils.js';

const PALETTE = ['#0f766e', '#0284c7', '#d97706', '#7c3aed', '#be123c', '#4f46e5', '#059669', '#ea580c'];

export function donutChart(slices, { valueFormatter = formatMoney } = {}) {
  const data = (slices || []).filter((slice) => Number(slice.value) > 0);
  if (!data.length) return `<p class="muted chart-empty">No stock to chart yet.</p>`;
  const total = data.reduce((sum, slice) => sum + Number(slice.value), 0) || 1;
  const size = 210;
  const thickness = 28;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = data.map((slice, index) => {
    const frac = Number(slice.value) / total;
    const len = Math.max(0, frac * c);
    const color = slice.color || PALETTE[index % PALETTE.length];
    const dash = `${len} ${c - len}`;
    const circle = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${esc(color)}" stroke-width="${thickness}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})"></circle>`;
    offset += len;
    return circle;
  }).join('');
  const legend = data.map((slice, index) => {
    const color = slice.color || PALETTE[index % PALETTE.length];
    const pct = Math.round((Number(slice.value) / total) * 100);
    return `<li><i style="background:${esc(color)}"></i><span>${esc(slice.label)}</span><strong>${esc(valueFormatter(slice.value))} · ${pct}%</strong></li>`;
  }).join('');
  return `<div class="chart-split">
    <svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="Stock by category">${arcs}</svg>
    <ul class="legend">${legend}</ul>
  </div>`;
}

export function columnChart(categories, series) {
  if (!categories.length) return `<p class="muted chart-empty">No movement in this window.</p>`;
  const width = 640;
  const height = 240;
  const pad = { l: 36, r: 8, t: 16, b: 36 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(1, ...series.flatMap((item) => item.data));
  const groupW = innerW / categories.length;
  const barW = Math.min(10, (groupW - 8) / Math.max(1, series.length));
  const bars = series.map((item, sIndex) => item.data.map((value, i) => {
    const h = (Number(value) / max) * innerH;
    const x = pad.l + i * groupW + 6 + sIndex * (barW + 2);
    const y = pad.t + innerH - h;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(0, h)}" rx="2" fill="${esc(item.color)}"><title>${esc(item.name)} ${esc(categories[i])}: ${esc(value)}</title></rect>`;
  }).join('')).join('');
  const labels = categories.map((label, i) => {
    if (categories.length > 12 && i % 5 !== 0 && i !== categories.length - 1) return '';
    const x = pad.l + i * groupW + groupW / 2;
    return `<text x="${x}" y="${height - 12}" text-anchor="middle" class="chart-label">${esc(String(label).slice(5))}</text>`;
  }).join('');
  const legend = series.map((item) => `<li><i style="background:${esc(item.color)}"></i>${esc(item.name)}</li>`).join('');
  return `<div class="chart-block">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Inbound and outbound quantities">${bars}${labels}</svg>
    <ul class="legend legend-inline">${legend}</ul>
  </div>`;
}

export function horizontalBars(items, { valueFormatter = fmtQty } = {}) {
  const data = (items || []).filter((item) => Number(item.value) > 0).slice(0, 5);
  if (!data.length) return `<p class="muted chart-empty">No products to rank yet.</p>`;
  const max = Math.max(...data.map((item) => Number(item.value))) || 1;
  return `<ul class="hbars">${data.map((item) => {
    const pct = Math.max(4, Math.round((Number(item.value) / max) * 100));
    return `<li>
      <div class="hbar-label"><span>${esc(item.label)}</span><strong>${esc(valueFormatter(item.value))}</strong></div>
      <div class="hbar" role="meter" aria-valuenow="${esc(item.value)}" aria-valuemin="0" aria-valuemax="${esc(max)}"><span style="width:${pct}%"></span></div>
    </li>`;
  }).join('')}</ul>`;
}

export function utilisationBars(items) {
  if (!items.length) return `<p class="muted chart-empty">Add a warehouse to see utilisation.</p>`;
  return `<ul class="hbars">${items.map((item) => {
    const pct = Math.max(0, Number(item.pct) || 0);
    const width = Math.min(100, pct);
    const tone = pct >= 90 ? 'danger' : pct >= 75 ? 'warning' : 'ok';
    return `<li>
      <div class="hbar-label"><span>${esc(item.label)}</span><strong>${esc(Math.round(pct))}%</strong></div>
      <div class="hbar" role="meter" aria-valuenow="${esc(Math.round(pct))}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(item.label)} utilisation"><span class="bar-${tone}" style="width:${width}%"></span></div>
      <p class="field-hint">${esc(item.hint || '')}</p>
    </li>`;
  }).join('')}</ul>`;
}

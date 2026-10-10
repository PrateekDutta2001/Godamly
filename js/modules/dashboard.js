import { db } from '../core/db.js';
import { can, currentUser } from '../core/auth.js';
import { onHand, stockValue } from '../core/inventory.js';
import { buildAlerts } from '../core/notifications.js';
import { icon } from '../core/icons.js';
import { columnChart, donutChart, horizontalBars, utilisationBars } from '../components/charts.js';
import { categoryName } from '../core/lookup.js';
import { addDays, dateKey, eachDate, esc, formatDate, formatMoney, fmtQty, greeting, relativeTime, todayKey } from '../core/utils.js';
import { pageHeader } from '../core/ui.js';

function kpi(tone, iconName, label, value, hint) {
  return `<article class="kpi"><div class="kpi-icon ${tone}">${icon(iconName)}</div><div><p class="kpi-label">${esc(label)}</p><p class="kpi-value">${esc(value)}</p><p class="field-hint">${esc(hint)}</p></div></article>`;
}

export function render(root) {
  const user = currentUser();
  const settings = db.getSettings();
  const products = db.getAll('products').filter((p) => p.status !== 'inactive');
  const showMoney = can('po.manage') || can('reports.view');
  const low = products.filter((p) => onHand(p.id) <= Number(p.reorderLevel ?? settings.lowStockThreshold ?? 0));
  const pendingPo = db.getAll('purchase_orders').filter((p) => ['draft', 'ordered', 'partial'].includes(p.status));
  const pendingSo = db.getAll('sales_orders').filter((s) => ['draft', 'confirmed', 'packed'].includes(s.status));
  const today = todayKey();
  const txns = db.getAll('transactions');
  const isIn = (t) => t.type === 'in' || (t.type === 'adjustment' && Number(t.afterQty) > Number(t.beforeQty));
  const isOut = (t) => t.type === 'out' || (t.type === 'adjustment' && Number(t.afterQty) < Number(t.beforeQty));
  const todayTx = txns.filter((t) => dateKey(t.date) === today && t.type !== 'transfer');
  const inboundToday = todayTx.filter(isIn).reduce((sum, row) => sum + Number(row.quantity), 0);
  const outboundToday = todayTx.filter(isOut).reduce((sum, row) => sum + Number(row.quantity), 0);

  const byCat = new Map();
  products.forEach((product) => {
    const qty = onHand(product.id);
    const key = product.categoryId || 'none';
    const prev = byCat.get(key) || {
      label: categoryName(product.categoryId),
      value: 0,
      qty: 0,
      color: db.getById('categories', product.categoryId)?.color,
    };
    prev.value += qty * (Number(product.avgCost ?? product.costPrice) || 0);
    prev.qty += qty;
    byCat.set(key, prev);
  });
  const slices = [...byCat.values()].map((row) => ({
    label: row.label,
    value: showMoney ? row.value : row.qty,
    color: row.color,
  }));

  const start = addDays(today, -29);
  const days = eachDate(start, today);
  const windowTx = txns.filter((t) => {
    const key = dateKey(t.date);
    return key >= start && key <= today && t.type !== 'transfer';
  });
  const inSeries = days.map((day) => windowTx.filter((t) => dateKey(t.date) === day && isIn(t)).reduce((sum, row) => sum + Number(row.quantity), 0));
  const outSeries = days.map((day) => windowTx.filter((t) => dateKey(t.date) === day && isOut(t)).reduce((sum, row) => sum + Number(row.quantity), 0));
  const ranked = products.map((product) => ({
    label: product.name,
    value: showMoney ? onHand(product.id) * (Number(product.avgCost ?? product.costPrice) || 0) : onHand(product.id),
  })).sort((a, b) => b.value - a.value);
  const utilisation = db.getAll('warehouses').filter((w) => w.status !== 'inactive').map((warehouse) => {
    const qty = db.getAll('stock').filter((row) => row.warehouseId === warehouse.id).reduce((sum, row) => sum + Number(row.quantity), 0);
    const cap = Number(warehouse.capacity) || 1;
    return { label: warehouse.name, pct: (qty / cap) * 100, hint: `${fmtQty(qty)} of ${fmtQty(cap)} capacity units` };
  });
  const activity = db.getAll('audit_log').sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
  const alerts = buildAlerts().slice(0, 6);

  root.innerHTML = `<section class="page">
    ${pageHeader({ kicker: 'Overview', title: greeting(user?.fullName), subtitle: `Today is ${formatDate(new Date(), true)}` })}
    <section class="kpi-grid" aria-label="Key figures">
      ${kpi('teal', 'box', 'Total SKUs', products.length, 'Active catalogue')}
      ${showMoney ? kpi('amber', 'chart', 'Stock value', formatMoney(stockValue()), 'At weighted average cost') : ''}
      ${kpi('rose', 'alert', 'Low stock', low.length, 'At or below reorder point')}
      ${can('po.manage') ? kpi('blue', 'truck', 'Open purchases', pendingPo.length, 'Draft, ordered, or partial') : ''}
      ${kpi('teal', 'cart', 'Open sales', pendingSo.length, 'Not yet shipped')}
      ${kpi('amber', 'history', "Today's flow", `${fmtQty(inboundToday)} in · ${fmtQty(outboundToday)} out`, 'Units, transfers excluded')}
    </section>
    <section class="dash-grid">
      <article class="card"><h2>Stock by category</h2>${donutChart(slices, { valueFormatter: showMoney ? formatMoney : fmtQty })}</article>
      <article class="card"><h2>Inbound vs outbound</h2>${columnChart(days, [
        { name: 'Inbound', data: inSeries, color: '#0f766e' },
        { name: 'Outbound', data: outSeries, color: '#d97706' },
      ])}</article>
      <article class="card"><h2>Top 5 products</h2>${horizontalBars(ranked, { valueFormatter: showMoney ? formatMoney : fmtQty })}</article>
      <article class="card"><h2>Warehouse utilisation</h2>${utilisationBars(utilisation)}</article>
    </section>
    <section class="dash-grid">
      <article class="card">
        <h2>Recent activity</h2>
        ${activity.length ? `<ul class="activity">${activity.map((row) => `<li><span class="dot"></span><div><strong>${esc(row.userName)}</strong> ${esc(row.details || row.action)}<br><span class="muted">${esc(relativeTime(row.date))}</span></div></li>`).join('')}</ul>` : '<p class="muted">No activity yet.</p>'}
      </article>
      <article class="card">
        <h2>Alerts</h2>
        ${alerts.length ? `<div class="stack">${alerts.map((alert) => `<a class="notice ${alert.read ? 'read' : ''}" href="${esc(alert.href)}"><strong>${esc(alert.title)}</strong><span>${esc(alert.message)}</span></a>`).join('')}</div>` : '<p class="muted">No open alerts.</p>'}
        <p style="margin-top:12px"><a href="#/alerts">Open the alert centre</a></p>
      </article>
    </section>
  </section>`;
}

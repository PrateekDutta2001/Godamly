import { db } from '../core/db.js';
import { onHand } from '../core/inventory.js';
import { categoryName, customerName, productById, supplierName, unitAbbr } from '../core/lookup.js';
import { printReport } from '../core/print.js';
import { addDays, dateKey, downloadCSV, esc, formatDate, formatMoney, fmtQty, roundMoney, toCSV, todayKey } from '../core/utils.js';
import { pageHeader } from '../core/ui.js';
import { toast } from '../components/toast.js';

const TABS = [
  { id: 'valuation', label: 'Valuation' },
  { id: 'movements', label: 'Movements' },
  { id: 'low', label: 'Low stock' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'sales', label: 'Sales' },
  { id: 'abc', label: 'ABC analysis' },
  { id: 'slow', label: 'Dead & slow' },
];

export function render(root) {
  const state = { tab: 'valuation', from: addDays(todayKey(), -89), to: todayKey() };
  const draw = () => {
    const report = build(state);
    root.innerHTML = `<section class="page">
      ${pageHeader({
        kicker: 'Insight',
        title: 'Reports',
        subtitle: 'Date range applies to movements, purchases, sales, ABC, and slow stock.',
        actions: `<button type="button" class="btn btn-ghost" id="csv">Export CSV</button><button type="button" class="btn btn-primary" id="print">Print</button>`,
      })}
      <div class="card">
        <div class="tabs" role="tablist">${TABS.map((tab) => `<button type="button" class="btn btn-ghost btn-sm" role="tab" aria-selected="${tab.id === state.tab}" data-tab="${tab.id}">${esc(tab.label)}</button>`).join('')}</div>
        <div class="toolbar">
          <div class="field"><label for="from">From</label><input id="from" type="date" value="${esc(state.from)}" /></div>
          <div class="field"><label for="to">To</label><input id="to" type="date" value="${esc(state.to)}" /></div>
        </div>
        <h2>${esc(report.title)}</h2>
        <p class="muted">${esc(report.subtitle)}</p>
        <div class="table-wrap" style="margin-top:12px"><table class="data-table responsive report-table"><thead><tr>${report.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${report.rows.length ? report.rows.map((row) => `<tr>${report.columns.map((c) => `<td data-label="${esc(c.label)}">${esc(c.value(row))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${report.columns.length}">Nothing in this report.</td></tr>`}</tbody>
        </table></div>
      </div>
    </section>`;
    root.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => { state.tab = btn.dataset.tab; draw(); }));
    root.querySelector('#from').addEventListener('change', (e) => { state.from = e.target.value; draw(); });
    root.querySelector('#to').addEventListener('change', (e) => { state.to = e.target.value; draw(); });
    root.querySelector('#csv').addEventListener('click', () => {
      downloadCSV(`godamly-${state.tab}.csv`, toCSV(report.rows, report.columns));
      toast('Report exported.');
    });
    root.querySelector('#print').addEventListener('click', () => {
      const table = `<table class="sheet-table"><thead><tr>${report.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${report.rows.map((row) => `<tr>${report.columns.map((c) => `<td>${esc(c.value(row))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      printReport({ title: report.title, subtitle: `${formatDate(state.from)} – ${formatDate(state.to)}`, tableHtml: table });
    });
  };
  draw();
}

function inRange(value, from, to) {
  const key = String(value || '').slice(0, 10);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function build(state) {
  if (state.tab === 'valuation') return valuation();
  if (state.tab === 'movements') return movements(state);
  if (state.tab === 'low') return lowStock();
  if (state.tab === 'purchases') return purchases(state);
  if (state.tab === 'sales') return sales(state);
  if (state.tab === 'abc') return abc(state);
  return slow(state);
}

function valuation() {
  const products = db.getAll('products').map((product) => {
    const qty = onHand(product.id);
    const avg = Number(product.avgCost ?? product.costPrice) || 0;
    return { ...product, qty, avg, value: roundMoney(qty * avg) };
  }).filter((row) => row.qty !== 0 || row.status !== 'inactive');
  const total = products.reduce((sum, row) => sum + row.value, 0) || 1;
  return {
    title: 'Inventory valuation',
    subtitle: 'On-hand quantity × weighted average cost.',
    columns: [
      { label: 'SKU', value: (r) => r.sku },
      { label: 'Product', value: (r) => r.name },
      { label: 'On hand', value: (r) => fmtQty(r.qty) },
      { label: 'Avg cost', value: (r) => formatMoney(r.avg) },
      { label: 'Value', value: (r) => formatMoney(r.value) },
      { label: 'Share', value: (r) => `${Math.round((r.value / total) * 1000) / 10}%` },
    ],
    rows: products.sort((a, b) => b.value - a.value),
  };
}

function movements(state) {
  const rows = db.getAll('transactions').filter((row) => inRange(dateKey(row.date), state.from, state.to))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return {
    title: 'Stock movement history',
    subtitle: 'Immutable ledger for the selected dates.',
    columns: [
      { label: 'When', value: (r) => formatDate(r.date, true) },
      { label: 'Type', value: (r) => r.type },
      { label: 'SKU', value: (r) => productById(r.productId)?.sku || '' },
      { label: 'Qty', value: (r) => fmtQty(r.quantity) },
      { label: 'Before', value: (r) => fmtQty(r.beforeQty) },
      { label: 'After', value: (r) => fmtQty(r.afterQty) },
      { label: 'Reference', value: (r) => r.referenceNo || r.referenceType || '' },
      { label: 'User', value: (r) => r.userName || '' },
    ],
    rows,
  };
}

function lowStock() {
  const fallback = Number(db.getSettings().lowStockThreshold ?? 0);
  const rows = db.getAll('products').filter((p) => p.status !== 'inactive').map((p) => ({ ...p, qty: onHand(p.id) }))
    .filter((p) => p.qty <= Number(p.reorderLevel ?? fallback));
  return {
    title: 'Low stock',
    subtitle: 'Products at or below their reorder level, including items with none left.',
    columns: [
      { label: 'SKU', value: (r) => r.sku },
      { label: 'Product', value: (r) => r.name },
      { label: 'On hand', value: (r) => fmtQty(r.qty) },
      { label: 'Reorder at', value: (r) => r.reorderLevel },
      { label: 'Reorder qty', value: (r) => r.reorderQty },
      { label: 'Unit', value: (r) => unitAbbr(r.unitId) },
    ],
    rows,
  };
}

function purchases(state) {
  const map = new Map();
  db.getAll('purchase_orders').filter((po) => po.status !== 'cancelled' && inRange(po.orderDate, state.from, state.to)).forEach((po) => {
    const current = map.get(po.supplierId) || { supplier: supplierName(po.supplierId), orders: 0, ordered: 0, received: 0 };
    current.orders += 1;
    (po.lines || []).forEach((line) => {
      current.ordered += Number(line.qtyOrdered) * Number(line.unitCost);
      current.received += Number(line.qtyReceived || 0) * Number(line.unitCost);
    });
    map.set(po.supplierId, current);
  });
  return {
    title: 'Supplier purchases',
    subtitle: 'Order value by supplier. Tax is excluded.',
    columns: [
      { label: 'Supplier', value: (r) => r.supplier },
      { label: 'Orders', value: (r) => r.orders },
      { label: 'Ordered value', value: (r) => formatMoney(r.ordered) },
      { label: 'Received value', value: (r) => formatMoney(r.received) },
    ],
    rows: [...map.values()].sort((a, b) => b.ordered - a.ordered),
  };
}

function sales(state) {
  const rows = [];
  db.getAll('sales_orders').filter((so) => so.status !== 'cancelled' && inRange(so.orderDate, state.from, state.to)).forEach((so) => {
    (so.lines || []).forEach((line) => {
      const product = productById(line.productId);
      rows.push({
        number: so.number,
        customer: customerName(so.customerId),
        sku: product?.sku || '',
        name: product?.name || '',
        qty: line.qty,
        amount: Number(line.qty) * Number(line.unitPrice),
        status: so.status,
      });
    });
  });
  return {
    title: 'Sales',
    subtitle: 'Line-level sales, excluding cancelled orders.',
    columns: [
      { label: 'Order', value: (r) => r.number },
      { label: 'Customer', value: (r) => r.customer },
      { label: 'SKU', value: (r) => r.sku },
      { label: 'Product', value: (r) => r.name },
      { label: 'Qty', value: (r) => fmtQty(r.qty) },
      { label: 'Amount', value: (r) => formatMoney(r.amount) },
      { label: 'Status', value: (r) => r.status },
    ],
    rows,
  };
}

function consumption(state) {
  const map = new Map();
  db.getAll('transactions').forEach((txn) => {
    if (txn.type !== 'out') return;
    if (!inRange(dateKey(txn.date), state.from, state.to)) return;
    const prev = map.get(txn.productId) || { qty: 0, value: 0 };
    prev.qty += Number(txn.quantity) || 0;
    prev.value += (Number(txn.quantity) || 0) * (Number(txn.unitCost) || 0);
    map.set(txn.productId, prev);
  });
  return map;
}

function abc(state) {
  const use = consumption(state);
  const rows = db.getAll('products').map((product) => {
    const stat = use.get(product.id) || { qty: 0, value: 0 };
    return { sku: product.sku, name: product.name, category: categoryName(product.categoryId), qty: stat.qty, value: stat.value };
  }).sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  let cursor = 0;
  rows.forEach((row) => {
    const before = cursor / total;
    cursor += row.value;
    row.className = row.value <= 0 ? 'C' : before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C';
    row.share = row.value <= 0 ? '0%' : `${Math.round((cursor / total) * 1000) / 10}%`;
  });
  return {
    title: 'ABC analysis',
    subtitle: 'A is the first 80% of issue value, B the next 15%, C the rest.',
    columns: [
      { label: 'Class', value: (r) => r.className },
      { label: 'SKU', value: (r) => r.sku },
      { label: 'Product', value: (r) => r.name },
      { label: 'Category', value: (r) => r.category },
      { label: 'Qty issued', value: (r) => fmtQty(r.qty) },
      { label: 'Value', value: (r) => formatMoney(r.value) },
      { label: 'Cumulative', value: (r) => r.share },
    ],
    rows,
  };
}

function slow(state) {
  const use = consumption(state);
  const rows = db.getAll('products').map((product) => ({
    sku: product.sku,
    name: product.name,
    qty: onHand(product.id),
    issued: use.get(product.id)?.qty || 0,
  })).filter((row) => row.qty > 0).map((row) => ({
    ...row,
    band: row.issued <= 0 ? 'Dead' : row.issued <= 5 ? 'Slow' : 'Moving',
  })).filter((row) => row.band !== 'Moving');
  return {
    title: 'Dead and slow-moving stock',
    subtitle: 'Dead means no issues in the range. Slow means five units or fewer issued, with stock still on hand.',
    columns: [
      { label: 'Band', value: (r) => r.band },
      { label: 'SKU', value: (r) => r.sku },
      { label: 'Product', value: (r) => r.name },
      { label: 'On hand', value: (r) => fmtQty(r.qty) },
      { label: 'Issued in range', value: (r) => fmtQty(r.issued) },
    ],
    rows,
  };
}

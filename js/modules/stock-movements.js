import { db } from '../core/db.js';
import { postStockChange } from '../core/inventory.js';
import { activeProducts, locationLabel, productById, warehouseName } from '../core/lookup.js';
import { dateKey, downloadCSV, esc, formatDate, fmtQty, toCSV } from '../core/utils.js';
import { applyErrors, options, pageHeader, selectField, textareaField } from '../core/ui.js';
import { toast } from '../components/toast.js';
import { mountTable } from '../components/table.js';

const REASONS = [
  { value: 'damage', label: 'Damage' },
  { value: 'loss', label: 'Loss' },
  { value: 'correction', label: 'Correction' },
  { value: 'other', label: 'Other' },
];

export function render(root) {
  const products = activeProducts();
  const warehouses = db.getAll('warehouses').filter((w) => w.status !== 'inactive');
  root.innerHTML = `<section class="page">
    ${pageHeader({ kicker: 'Ledger', title: 'Stock movements', subtitle: 'Every change is permanent. Stock cannot go negative.' })}
    <div class="card" style="margin-bottom:16px">
      <form id="move-form" novalidate>
        <div class="grid-3">
          ${selectField({ id: 'type', label: 'Movement', required: true, optionsHtml: options([
            { value: 'in', label: 'Stock in' },
            { value: 'out', label: 'Stock out' },
            { value: 'transfer', label: 'Transfer' },
            { value: 'adjustment', label: 'Adjustment' },
          ], 'in') })}
          ${selectField({ id: 'productId', label: 'Product', required: true, optionsHtml: options(products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` })), '', 'Select product') })}
          ${selectField({ id: 'warehouseId', label: 'Warehouse', required: true, optionsHtml: options(warehouses.map((w) => ({ value: w.id, label: w.name })), '', 'Select warehouse') })}
          ${selectField({ id: 'locationId', label: 'Location', required: true, optionsHtml: '<option value="">Select location</option>' })}
          <div id="dest-fields" class="span-2" hidden>
            <div class="grid-2">
              ${selectField({ id: 'toWarehouseId', label: 'Destination warehouse', optionsHtml: options(warehouses.map((w) => ({ value: w.id, label: w.name })), '', 'Select warehouse') })}
              ${selectField({ id: 'toLocationId', label: 'Destination location', optionsHtml: '<option value="">Select location</option>' })}
            </div>
          </div>
          <div class="field" id="direction-wrap" hidden><label for="direction">Direction</label><select id="direction"><option value="out">Decrease stock</option><option value="in">Increase stock</option></select></div>
          <div class="field" id="reason-wrap" hidden><label for="reason">Reason<span class="req">*</span></label><select id="reason">${options(REASONS, '', 'Select reason')}</select><p class="field-error" id="reason-error" role="alert" hidden></p></div>
          <div class="field"><label for="quantity">Quantity<span class="req">*</span></label><input id="quantity" type="number" min="0.001" step="any" /><p class="field-error" id="quantity-error" role="alert" hidden></p></div>
          <div class="field" id="cost-wrap"><label for="unitCost">Unit cost</label><input id="unitCost" type="number" min="0" step="0.01" /><p class="field-hint">Used for weighted average on stock in.</p></div>
        </div>
        ${textareaField({ id: 'notes', label: 'Notes', value: '' })}
        <p class="field-hint" id="avail"></p>
        <button class="btn btn-primary" type="submit">Post movement</button>
      </form>
    </div>
    <div class="card">
      <div class="page-head"><h2>Transaction ledger</h2><button type="button" class="btn btn-ghost btn-sm" id="export">Export CSV</button></div>
      <div class="toolbar">
        <div class="field"><label for="fq">Search</label><input id="fq" placeholder="SKU, reference, user" /></div>
        <div class="field"><label for="ftype">Type</label><select id="ftype"><option value="all">All</option><option value="in">In</option><option value="out">Out</option><option value="transfer">Transfer</option><option value="adjustment">Adjustment</option></select></div>
        <div class="field"><label for="from">From</label><input id="from" type="date" /></div>
        <div class="field"><label for="to">To</label><input id="to" type="date" /></div>
      </div>
      <div id="table-host"></div>
    </div>
  </section>`;

  const form = root.querySelector('#move-form');
  const fillLocs = (select, warehouseId) => {
    const wh = db.getById('warehouses', warehouseId);
    select.innerHTML = options((wh?.locations || []).map((loc) => ({ value: loc.id, label: loc.code })), '', 'Select location');
  };
  const sync = () => {
    const type = form.querySelector('#type').value;
    form.querySelector('#dest-fields').hidden = type !== 'transfer';
    form.querySelector('#direction-wrap').hidden = type !== 'adjustment';
    form.querySelector('#reason-wrap').hidden = type !== 'adjustment';
    form.querySelector('#cost-wrap').hidden = type === 'out' || type === 'transfer' || (type === 'adjustment' && form.querySelector('#direction').value === 'out');
    fillLocs(form.querySelector('#locationId'), form.querySelector('#warehouseId').value);
    fillLocs(form.querySelector('#toLocationId'), form.querySelector('#toWarehouseId').value);
    const product = productById(form.querySelector('#productId').value);
    if (product && form.querySelector('#unitCost').value === '') form.querySelector('#unitCost').value = product.costPrice;
    const wh = form.querySelector('#warehouseId').value;
    const productId = form.querySelector('#productId').value;
    form.querySelector('#avail').textContent = productId && wh ? `On hand in this warehouse: ${fmtQty(db.getAll('stock').filter((s) => s.productId === productId && s.warehouseId === wh).reduce((sum, s) => sum + Number(s.quantity), 0))}` : '';
  };
  form.querySelector('#type').addEventListener('change', sync);
  form.querySelector('#warehouseId').addEventListener('change', sync);
  form.querySelector('#toWarehouseId').addEventListener('change', sync);
  form.querySelector('#productId').addEventListener('change', () => { form.querySelector('#unitCost').value = ''; sync(); });
  form.querySelector('#direction').addEventListener('change', sync);
  sync();

  const ledgerState = { q: '', type: 'all', from: '', to: '' };
  const filtered = () => db.getAll('transactions').filter((row) => {
    const product = productById(row.productId);
    const blob = `${product?.sku || ''} ${product?.name || ''} ${row.referenceNo || ''} ${row.userName || ''} ${row.notes || ''}`.toLowerCase();
    if (ledgerState.q && !blob.includes(ledgerState.q.trim().toLowerCase())) return false;
    if (ledgerState.type !== 'all' && row.type !== ledgerState.type) return false;
    const key = dateKey(row.date);
    if (ledgerState.from && key < ledgerState.from) return false;
    if (ledgerState.to && key > ledgerState.to) return false;
    return true;
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const type = form.querySelector('#type').value;
    const productId = form.querySelector('#productId').value;
    const warehouseId = form.querySelector('#warehouseId').value;
    const locationId = form.querySelector('#locationId').value;
    const quantity = Number(form.querySelector('#quantity').value);
    const errors = {};
    if (!productId) errors.productId = 'Choose a product.';
    if (!warehouseId) errors.warehouseId = 'Choose a warehouse.';
    if (!locationId) errors.locationId = 'Choose a location.';
    if (!(quantity > 0)) errors.quantity = 'Quantity must be greater than zero.';
    const reason = form.querySelector('#reason').value;
    const notes = form.querySelector('#notes').value.trim();
    if (type === 'adjustment' && !reason) errors.reason = 'Choose a reason.';
    if (type === 'adjustment' && reason === 'other' && !notes) errors.notes = 'Describe the other reason.';
    if (type === 'transfer') {
      if (!form.querySelector('#toWarehouseId').value || !form.querySelector('#toLocationId').value) errors.toLocationId = 'Choose a destination.';
    }
    if (!applyErrors(form, errors)) return;
    try {
      db.batch(() => {
        postStockChange({
          type: type === 'adjustment' ? 'adjustment' : type,
          direction: type === 'adjustment' ? form.querySelector('#direction').value : undefined,
          productId, warehouseId, locationId, quantity,
          toWarehouseId: form.querySelector('#toWarehouseId').value,
          toLocationId: form.querySelector('#toLocationId').value,
          unitCost: form.querySelector('#unitCost').value === '' ? undefined : Number(form.querySelector('#unitCost').value),
          revalue: type === 'in' || (type === 'adjustment' && form.querySelector('#direction').value === 'in'),
          updateLastCost: type === 'in',
          reason: type === 'adjustment' ? reason : type === 'transfer' ? 'transfer' : type === 'in' ? 'purchase' : 'issue',
          notes, referenceType: type === 'transfer' ? 'TRF' : 'MANUAL',
        });
      });
      toast('Movement posted to the ledger.');
      form.querySelector('#quantity').value = '';
      form.querySelector('#notes').value = '';
      paint();
    } catch (error) {
      toast(error.message || 'Could not post the movement.', 'error');
    }
  });

  const table = mountTable(root.querySelector('#table-host'), {
    columns: [
      { key: 'date', label: 'When', sortable: true, render: (row) => esc(formatDate(row.date, true)) },
      { key: 'type', label: 'Type', sortable: true, render: (row) => esc(row.type) },
      { key: 'product', label: 'Product', sortValue: (row) => productById(row.productId)?.name || '', sortable: true, render: (row) => esc(productById(row.productId) ? `${productById(row.productId).sku} · ${productById(row.productId).name}` : '—') },
      { key: 'quantity', label: 'Qty', align: 'right', sortable: true, sortValue: (row) => Number(row.quantity), render: (row) => esc(fmtQty(row.quantity)) },
      { key: 'where', label: 'Where', render: (row) => esc(whereText(row)) },
      { key: 'beforeQty', label: 'Before → after', render: (row) => esc(beforeAfter(row)) },
      { key: 'referenceNo', label: 'Reference', render: (row) => esc(row.referenceNo || row.referenceType || '—') },
      { key: 'userName', label: 'User', sortable: true, render: (row) => esc(row.userName || '—') },
    ],
    rows: filtered(),
    rowId: (row) => row.id,
    sortKey: 'date',
    sortDir: 'desc',
    emptyTitle: 'No movements yet',
    emptyText: 'Post a stock in, stock out, transfer, or adjustment.',
  });
  function paint() { table.setRows(filtered()); }
  ['fq', 'ftype', 'from', 'to'].forEach((id) => {
    root.querySelector(`#${id}`).addEventListener('input', (event) => {
      ledgerState[id === 'fq' ? 'q' : id === 'ftype' ? 'type' : id] = event.target.value;
      table.setRows(filtered(), true);
    });
  });
  root.querySelector('#export').addEventListener('click', () => {
    const csv = toCSV(filtered(), [
      { label: 'Date', value: (r) => formatDate(r.date, true) },
      { label: 'Type', value: (r) => r.type },
      { label: 'SKU', value: (r) => productById(r.productId)?.sku || '' },
      { label: 'Product', value: (r) => productById(r.productId)?.name || '' },
      { label: 'Quantity', value: (r) => r.quantity },
      { label: 'Before', value: (r) => r.beforeQty },
      { label: 'After', value: (r) => r.afterQty },
      { label: 'Reference', value: (r) => r.referenceNo || '' },
      { label: 'Reason', value: (r) => r.reason || '' },
      { label: 'User', value: (r) => r.userName || '' },
      { label: 'Notes', value: (r) => r.notes || '' },
    ]);
    downloadCSV('godamly-movements.csv', csv);
    toast('Ledger exported.');
  });
}

function whereText(row) {
  const from = `${warehouseName(row.warehouseId)} / ${locationLabel(row.warehouseId, row.locationId)}`;
  if (row.type !== 'transfer') return from;
  return `${from} → ${warehouseName(row.toWarehouseId)} / ${locationLabel(row.toWarehouseId, row.toLocationId)}`;
}

function beforeAfter(row) {
  const source = `${fmtQty(row.beforeQty)} → ${fmtQty(row.afterQty)}`;
  if (row.type !== 'transfer') return source;
  return `${source}; dest ${fmtQty(row.toBeforeQty)} → ${fmtQty(row.toAfterQty)}`;
}

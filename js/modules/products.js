import { db } from '../core/db.js';
import { can } from '../core/auth.js';
import { logAudit } from '../core/audit.js';
import { onHand } from '../core/inventory.js';
import { categoryName, locationLabel, unitAbbr, warehouseName } from '../core/lookup.js';
import { productLinked } from '../core/rules.js';
import { downloadCSV, esc, formatDate, formatMoney, fmtQty, readImageFile, routeQuery, safeImageSrc, stripHashQuery, toCSV } from '../core/utils.js';
import { applyErrors, avatar, emptyState, field, options, pageHeader, pill, selectField, textareaField } from '../core/ui.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { mountTable } from '../components/table.js';
import { toast } from '../components/toast.js';
import { icon } from '../core/icons.js';

let refreshList = () => {};

export function render(root) {
  const state = { q: '', category: 'all', status: 'all' };
  const editable = can('products.edit');
  root.innerHTML = `<section class="page">
    ${pageHeader({
      kicker: 'Inventory',
      title: 'Products',
      subtitle: 'Catalogue, cost, and reorder points.',
      actions: `${editable ? '<button type="button" class="btn btn-primary" id="add-product">Add product</button>' : ''}<button type="button" class="btn btn-ghost" id="export-csv">Export CSV</button>`,
    })}
    <div class="card">
      <div class="toolbar">
        <div class="field"><label for="q">Search</label><input id="q" placeholder="Name, SKU, or barcode" /></div>
        <div class="field"><label for="category">Category</label><select id="category"><option value="all">All categories</option>${db.getAll('categories').map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="status">Status</label><select id="status"><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="low">Low stock</option><option value="out">Out of stock</option></select></div>
      </div>
      <div id="bulk" class="callout" hidden>
        <span id="bulk-label"></span>
        ${editable ? '<button type="button" class="btn btn-danger btn-sm" id="bulk-delete">Delete selected</button>' : ''}
      </div>
      <div id="table-host"></div>
    </div>
  </section>`;

  const table = mountTable(root.querySelector('#table-host'), {
    columns: [
      { key: 'sku', label: 'SKU', sortable: true, render: (row) => `<div class="product-cell">${avatar(row.name, row.image, '')}<div><strong>${esc(row.sku)}</strong><br><span>${esc(row.name)}</span></div></div>` },
      { key: 'category', label: 'Category', sortable: true, sortValue: (row) => categoryName(row.categoryId), render: (row) => esc(categoryName(row.categoryId)) },
      { key: 'onHand', label: 'On hand', sortable: true, align: 'right', sortValue: (row) => onHand(row.id), render: (row) => qtyCell(row) },
      { key: 'costPrice', label: 'Cost', sortable: true, align: 'right', sortValue: (row) => Number(row.costPrice) || 0, render: (row) => esc(formatMoney(row.costPrice)) },
      { key: 'sellingPrice', label: 'Price', sortable: true, align: 'right', sortValue: (row) => Number(row.sellingPrice) || 0, render: (row) => esc(formatMoney(row.sellingPrice)) },
      { key: 'status', label: 'Status', sortable: true, render: (row) => pill(row.status || 'active') },
      { key: 'actions', label: 'Actions', render: (row) => `<div class="row-actions">
          <button type="button" class="icon-btn" data-action="view" data-id="${esc(row.id)}" aria-label="View ${esc(row.name)}">${icon('eye')}</button>
          ${editable ? `<button type="button" class="icon-btn" data-action="edit" data-id="${esc(row.id)}" aria-label="Edit ${esc(row.name)}">${icon('edit')}</button>` : ''}
          ${editable ? `<button type="button" class="icon-btn" data-action="delete" data-id="${esc(row.id)}" aria-label="Delete ${esc(row.name)}">${icon('trash')}</button>` : ''}
        </div>` },
    ],
    rows: filtered(),
    rowId: (row) => row.id,
    selectable: editable,
    sortKey: 'sku',
    emptyTitle: 'No products match',
    emptyText: 'Change the filters or add a product.',
    onAction: (action, id) => {
      if (action === 'view') openView(id);
      if (action === 'edit') openEditor(id);
      if (action === 'delete') removeOne(id);
    },
    onSelect: (ids) => {
      const bar = root.querySelector('#bulk');
      bar.hidden = ids.length === 0;
      root.querySelector('#bulk-label').textContent = `${ids.length} selected`;
    },
  });

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return db.getAll('products').filter((row) => {
      const qty = onHand(row.id);
      const blob = `${row.sku} ${row.name} ${row.barcode || ''} ${row.description || ''}`.toLowerCase();
      if (q && !blob.includes(q)) return false;
      if (state.category !== 'all' && row.categoryId !== state.category) return false;
      if (state.status === 'active' && row.status === 'inactive') return false;
      if (state.status === 'inactive' && row.status !== 'inactive') return false;
      if (state.status === 'low' && !(qty > 0 && qty <= Number(row.reorderLevel || 0))) return false;
      if (state.status === 'out' && qty !== 0) return false;
      return true;
    });
  }

  function refresh() { refreshList = refresh; table.setRows(filtered()); }
  refreshList = refresh;
  root.querySelector('#q').addEventListener('input', (event) => { state.q = event.target.value; table.setRows(filtered(), true); });
  root.querySelector('#category').addEventListener('change', (event) => { state.category = event.target.value; table.setRows(filtered(), true); });
  root.querySelector('#status').addEventListener('change', (event) => { state.status = event.target.value; table.setRows(filtered(), true); });
  root.querySelector('#export-csv').addEventListener('click', () => exportCsv(filtered()));
  root.querySelector('#add-product')?.addEventListener('click', () => openEditor(null, refresh));
  root.querySelector('#bulk-delete')?.addEventListener('click', () => bulkRemove(table, refresh));

  const focus = routeQuery().get('focus');
  if (focus) {
    stripHashQuery('products');
    openView(focus);
  }

  function openEditor(id) { editProduct(id, refresh); }
  function removeOne(id) { deleteProducts([id], refresh); }
}

function qtyCell(row) {
  const qty = onHand(row.id);
  const cls = qty <= 0 ? 'qty-out' : qty <= Number(row.reorderLevel || 0) ? 'qty-low' : '';
  return `<span class="${cls}">${esc(fmtQty(qty))} ${esc(unitAbbr(row.unitId))}</span>`;
}

function peekSku() {
  const counters = db.getById('counters', 'main');
  const prefix = db.getSettings().skuPrefix || 'GDM';
  return `${prefix}-${String(Number(counters?.sku || 1000) + 1).padStart(4, '0')}`;
}

function editProduct(id, refresh) {
  const row = id ? db.getById('products', id) : null;
  const settings = db.getSettings();
  const categories = db.getAll('categories').filter((c) => c.status !== 'inactive' || c.id === row?.categoryId);
  const units = db.getAll('units').filter((u) => u.status !== 'inactive' || u.id === row?.unitId);
  openModal({
    title: row ? `Edit ${row.sku}` : 'New product',
    size: 'lg',
    body: `<form id="product-form" novalidate>
      <div class="grid-2">
        ${field({ id: 'sku', label: 'SKU', value: row?.sku || '', placeholder: peekSku(), hint: 'Leave blank to generate on save.' })}
        ${field({ id: 'name', label: 'Name', value: row?.name || '', required: true })}
        ${selectField({ id: 'categoryId', label: 'Category', required: true, optionsHtml: options(categories.map((c) => ({ value: c.id, label: c.name })), row?.categoryId || '', 'Select category') })}
        ${selectField({ id: 'unitId', label: 'Unit', required: true, optionsHtml: options(units.map((u) => ({ value: u.id, label: `${u.name} (${u.abbreviation})` })), row?.unitId || '', 'Select unit') })}
        ${field({ id: 'costPrice', label: 'Cost price', type: 'number', value: row?.costPrice ?? '', required: true, attrs: 'min="0" step="0.01"' })}
        ${field({ id: 'sellingPrice', label: 'Selling price', type: 'number', value: row?.sellingPrice ?? '', required: true, attrs: 'min="0" step="0.01"' })}
        ${field({ id: 'reorderLevel', label: 'Reorder level', type: 'number', value: row?.reorderLevel ?? settings.lowStockThreshold ?? 10, required: true, attrs: 'min="0" step="1"' })}
        ${field({ id: 'reorderQty', label: 'Reorder quantity', type: 'number', value: row?.reorderQty ?? 1, required: true, attrs: 'min="0" step="1"' })}
        ${field({ id: 'barcode', label: 'Barcode', value: row?.barcode || '' })}
        ${field({ id: 'expiryDate', label: 'Expiry date', type: 'date', value: row?.expiryDate || '' })}
        <div class="field"><label for="status">Status</label><select id="status"><option value="active">Active</option><option value="inactive" ${row?.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
        <div class="field"><label for="image">Image</label><input id="image" type="file" accept="image/*" /><div id="preview" style="margin-top:8px">${row?.image ? `<img class="thumb" alt="" src="${safeImageSrc(row.image)}" />` : ''}</div><p class="field-error" id="image-error" role="alert" hidden></p></div>
      </div>
      ${textareaField({ id: 'description', label: 'Description', value: row?.description || '' })}
      ${row ? `<p class="field-hint">Weighted average cost is ${esc(formatMoney(row.avgCost ?? row.costPrice))}. Editing the cost price does not revalue existing stock.</p>` : ''}
    </form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="button" class="btn btn-ghost" id="gen-sku">Generate SKU</button><button type="submit" form="product-form" class="btn btn-primary">Save product</button>`,
    onMount(dialog) {
      let image = row?.image || '';
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#gen-sku').addEventListener('click', () => { dialog.querySelector('#sku').value = peekSku(); });
      dialog.querySelector('#image').addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          image = await readImageFile(file);
          dialog.querySelector('#preview').innerHTML = `<img class="thumb" alt="" src="${image}" />`;
          applyErrors(dialog, {});
        } catch (error) {
          image = row?.image || '';
          applyErrors(dialog, { image: error.message });
        }
      });
      dialog.querySelector('#product-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const data = readProductForm(dialog, image);
        const errors = validateProduct(data, id);
        if (!applyErrors(dialog, errors)) return;
        let sku = data.sku.trim();
        if (!sku) sku = db.nextNumber('sku');
        else syncSkuCounter(sku);
        const payload = { ...data, sku, image, barcode: data.barcode || sku };
        if (id) {
          const prev = db.getById('products', id);
          db.update('products', id, { ...payload, avgCost: prev.avgCost ?? prev.costPrice });
          logAudit('update', 'product', id, `Updated ${sku}`);
        } else {
          const created = db.add('products', { ...payload, avgCost: Number(payload.costPrice) || 0 });
          logAudit('create', 'product', created.id, `Created ${sku}`);
        }
        closeModal();
        toast('Product saved.');
        refresh();
      });
    },
  });
}

function readProductForm(dialog, image) {
  const read = (id) => dialog.querySelector(`#${id}`).value;
  return {
    sku: read('sku'),
    name: read('name').trim(),
    categoryId: read('categoryId'),
    unitId: read('unitId'),
    costPrice: read('costPrice'),
    sellingPrice: read('sellingPrice'),
    reorderLevel: read('reorderLevel'),
    reorderQty: read('reorderQty'),
    barcode: read('barcode').trim(),
    expiryDate: read('expiryDate'),
    status: read('status'),
    description: read('description').trim(),
    image,
  };
}

function validateProduct(data, id) {
  const errors = {};
  if (!data.name) errors.name = 'Name is required.';
  if (!data.categoryId) errors.categoryId = 'Choose a category.';
  if (!data.unitId) errors.unitId = 'Choose a unit.';
  if (!(Number(data.costPrice) >= 0)) errors.costPrice = 'Enter a cost of zero or more.';
  if (!(Number(data.sellingPrice) >= 0)) errors.sellingPrice = 'Enter a price of zero or more.';
  if (!(Number(data.reorderLevel) >= 0)) errors.reorderLevel = 'Reorder level cannot be negative.';
  if (!(Number(data.reorderQty) >= 0)) errors.reorderQty = 'Reorder quantity cannot be negative.';
  const sku = data.sku.trim().toLowerCase();
  if (sku && db.getAll('products').some((p) => p.sku.toLowerCase() === sku && p.id !== id)) errors.sku = 'That SKU already exists.';
  const barcode = (data.barcode || '').trim().toLowerCase();
  if (barcode && db.getAll('products').some((p) => String(p.barcode || '').toLowerCase() === barcode && p.id !== id)) errors.barcode = 'That barcode already exists.';
  return errors;
}

function syncSkuCounter(sku) {
  const prefix = db.getSettings().skuPrefix || 'GDM';
  const match = sku.match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
  if (!match) return;
  const counters = db.getById('counters', 'main');
  if (Number(match[1]) > Number(counters.sku || 0)) db.update('counters', 'main', { sku: Number(match[1]) });
}

function openView(id) {
  const row = db.getById('products', id);
  if (!row) { toast('That product is no longer available.', 'error'); return; }
  const stocks = db.getAll('stock').filter((s) => s.productId === id && Number(s.quantity) > 0);
  const lines = stocks.length ? stocks.map((s) => `<tr><td>${esc(warehouseName(s.warehouseId))}</td><td>${esc(locationLabel(s.warehouseId, s.locationId))}</td><td class="num">${esc(fmtQty(s.quantity))}</td></tr>`).join('') : `<tr><td colspan="3">No stock on hand.</td></tr>`;
  openModal({
    title: row.name,
    size: 'lg',
    body: `<div class="product-cell" style="margin-bottom:12px">${avatar(row.name, row.image, row.name)}<div><strong>${esc(row.sku)}</strong><br>${pill(row.status || 'active')}</div></div>
      <dl class="detail-list">
        <dt>Category</dt><dd>${esc(categoryName(row.categoryId))}</dd>
        <dt>Unit</dt><dd>${esc(unitAbbr(row.unitId))}</dd>
        <dt>On hand</dt><dd>${esc(fmtQty(onHand(row.id)))}</dd>
        <dt>Cost / average</dt><dd>${esc(formatMoney(row.costPrice))} / ${esc(formatMoney(row.avgCost ?? row.costPrice))}</dd>
        <dt>Selling price</dt><dd>${esc(formatMoney(row.sellingPrice))}</dd>
        <dt>Reorder</dt><dd>${esc(row.reorderLevel)} / order ${esc(row.reorderQty)}</dd>
        <dt>Barcode</dt><dd>${esc(row.barcode || '—')}</dd>
        <dt>Expiry</dt><dd>${row.expiryDate ? esc(formatDate(row.expiryDate)) : '—'}</dd>
        <dt>Description</dt><dd>${esc(row.description || '—')}</dd>
      </dl>
      <h3 style="margin:14px 0 8px">Stock by location</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Warehouse</th><th>Location</th><th>Qty</th></tr></thead><tbody>${lines}</tbody></table></div>`,
    footer: `${can('products.edit') ? `<button type="button" class="btn btn-primary" id="edit-from-view">Edit</button>` : ''}<button type="button" class="btn btn-ghost" id="close-view">Close</button>`,
    onMount(dialog) {
      dialog.querySelector('#close-view').addEventListener('click', closeModal);
      dialog.querySelector('#edit-from-view')?.addEventListener('click', () => { closeModal(); editProduct(id, () => refreshList()); });
    },
  });
}

async function deleteProducts(ids, refresh) {
  if (!ids.length) return;
  const ok = await confirmDialog({
    title: ids.length > 1 ? `Remove ${ids.length} products?` : 'Remove this product?',
    message: 'Products with stock or document history will be deactivated instead of deleted.',
    confirmText: 'Continue',
    danger: true,
  });
  if (!ok) return;
  let removed = 0;
  let deactivated = 0;
  ids.forEach((id) => {
    const row = db.getById('products', id);
    if (!row) return;
    if (productLinked(id)) {
      if (row.status !== 'inactive') {
        db.update('products', id, { status: 'inactive' });
        logAudit('deactivate', 'product', id, `Deactivated ${row.sku}`);
        deactivated += 1;
      }
    } else {
      db.getAll('stock').filter((s) => s.productId === id).forEach((s) => db.remove('stock', s.id));
      db.remove('products', id);
      logAudit('delete', 'product', id, `Deleted ${row.sku}`);
      removed += 1;
    }
  });
  toast(`Deleted ${removed}. Deactivated ${deactivated}.`);
  refresh();
}

async function bulkRemove(table, refresh) {
  await deleteProducts(table.getSelected(), () => { table.clear(); refresh(); });
}

function exportCsv(rows) {
  const csv = toCSV(rows, [
    { label: 'SKU', value: (r) => r.sku },
    { label: 'Name', value: (r) => r.name },
    { label: 'Category', value: (r) => categoryName(r.categoryId) },
    { label: 'Unit', value: (r) => unitAbbr(r.unitId) },
    { label: 'On hand', value: (r) => onHand(r.id) },
    { label: 'Cost', value: (r) => r.costPrice },
    { label: 'Average cost', value: (r) => r.avgCost ?? r.costPrice },
    { label: 'Selling price', value: (r) => r.sellingPrice },
    { label: 'Reorder level', value: (r) => r.reorderLevel },
    { label: 'Barcode', value: (r) => r.barcode || '' },
    { label: 'Expiry', value: (r) => r.expiryDate || '' },
    { label: 'Status', value: (r) => r.status || 'active' },
  ]);
  downloadCSV(`godamly-products-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  toast('CSV downloaded.');
}

void emptyState;

import { db } from '../core/db.js';
import { can, currentUser } from '../core/auth.js';
import { logAudit } from '../core/audit.js';
import { assertAvailable, available, planIssue, postStockChange } from '../core/inventory.js';
import { activeProducts, customerName, productById, warehouseName } from '../core/lookup.js';
import { documentTotals, printInvoice, printPackingSlip } from '../core/print.js';
import { esc, formatDate, formatMoney, routeQuery, stripHashQuery, todayKey, uid } from '../core/utils.js';
import { applyErrors, field, options, pageHeader, pill, selectField, textareaField } from '../core/ui.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { mountTable } from '../components/table.js';
import { toast } from '../components/toast.js';
import { icon } from '../core/icons.js';

export function render(root) {
  const state = { q: '', status: 'all' };
  root.innerHTML = `<section class="page">
    ${pageHeader({
      kicker: 'Outbound',
      title: 'Sales orders',
      subtitle: 'Confirm, pack, and ship without going below available stock.',
      actions: can('so.create') ? '<button type="button" class="btn btn-primary" id="add">New sales order</button>' : '',
    })}
    <div class="card">
      <div class="toolbar">
        <div class="field"><label for="q">Search</label><input id="q" placeholder="Order number or customer" /></div>
        <div class="field"><label for="status">Status</label><select id="status">
          <option value="all">All statuses</option>
          ${['draft', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'].map((s) => `<option value="${s}">${s}</option>`).join('')}
        </select></div>
      </div>
      <div id="table-host"></div>
    </div>
  </section>`;
  const rows = () => db.getAll('sales_orders').filter((so) => {
    const blob = `${so.number} ${customerName(so.customerId)}`.toLowerCase();
    if (state.q && !blob.includes(state.q.trim().toLowerCase())) return false;
    if (state.status !== 'all' && so.status !== state.status) return false;
    return true;
  });
  const table = mountTable(root.querySelector('#table-host'), {
    columns: [
      { key: 'number', label: 'Order', sortable: true, render: (row) => `<strong>${esc(row.number)}</strong>` },
      { key: 'customer', label: 'Customer', sortable: true, sortValue: (row) => customerName(row.customerId), render: (row) => esc(customerName(row.customerId)) },
      { key: 'orderDate', label: 'Date', sortable: true, render: (row) => esc(formatDate(row.orderDate)) },
      { key: 'total', label: 'Total', align: 'right', sortable: true, sortValue: (row) => documentTotals(row.lines, row.taxRate, 'qty', 'unitPrice').total, render: (row) => esc(formatMoney(documentTotals(row.lines, row.taxRate, 'qty', 'unitPrice').total)) },
      { key: 'status', label: 'Status', sortable: true, render: (row) => pill(row.status) },
      { key: 'actions', label: '', render: (row) => `<button type="button" class="icon-btn" data-action="view" data-id="${esc(row.id)}" aria-label="Open ${esc(row.number)}">${icon('eye')}</button>` },
    ],
    rows: rows(),
    rowId: (row) => row.id,
    sortKey: 'orderDate',
    sortDir: 'desc',
    onAction: (_a, id) => openSo(id, () => table.setRows(rows())),
  });
  const refresh = () => table.setRows(rows());
  root.querySelector('#q').addEventListener('input', (e) => { state.q = e.target.value; table.setRows(rows(), true); });
  root.querySelector('#status').addEventListener('change', (e) => { state.status = e.target.value; table.setRows(rows(), true); });
  root.querySelector('#add')?.addEventListener('click', () => editSo(null, refresh));
  const focus = routeQuery().get('focus');
  if (focus) { stripHashQuery('sales-orders'); openSo(focus, refresh); }
}

function lineRow(line, products, warehouseId) {
  const id = line?.id || uid('sol');
  const free = line?.productId && warehouseId ? available(line.productId, warehouseId) : null;
  return `<tr data-line="${esc(id)}">
    <td><select data-field="product">${options(products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` })), line?.productId || '', 'Product')}</select><p class="field-hint" data-avail>${free == null ? '' : `${esc(free)} available`}</p></td>
    <td><input data-field="qty" type="number" min="0.001" step="any" value="${esc(line?.qty ?? 1)}" aria-label="Quantity" /></td>
    <td><input data-field="price" type="number" min="0" step="0.01" value="${esc(line?.unitPrice ?? '')}" aria-label="Unit price" /></td>
    <td class="num" data-field="amount">—</td>
    <td><button type="button" class="icon-btn" data-remove-line aria-label="Remove line">${icon('trash')}</button></td>
  </tr>`;
}

function editSo(id, refresh) {
  if (!can('so.create')) { toast('You cannot create sales orders.', 'error'); return; }
  const existing = id ? db.getById('sales_orders', id) : null;
  if (existing && existing.status !== 'draft') { toast('Only draft orders can be edited.', 'error'); return; }
  const customers = db.getAll('customers').filter((c) => c.status !== 'inactive' || c.id === existing?.customerId);
  const warehouses = db.getAll('warehouses').filter((w) => w.status !== 'inactive' || w.id === existing?.warehouseId);
  const products = activeProducts();
  (existing?.lines || []).forEach((line) => {
    if (!products.some((p) => p.id === line.productId)) {
      const extra = productById(line.productId);
      if (extra) products.push(extra);
    }
  });
  openModal({
    title: existing ? existing.number : 'New sales order',
    size: 'lg',
    body: `<form id="so-form" novalidate>
      <div class="grid-2">
        ${selectField({ id: 'customerId', label: 'Customer', required: true, optionsHtml: options(customers.map((c) => ({ value: c.id, label: c.name })), existing?.customerId || '', 'Select customer') })}
        ${selectField({ id: 'warehouseId', label: 'Ship from', required: true, optionsHtml: options(warehouses.map((w) => ({ value: w.id, label: w.name })), existing?.warehouseId || '', 'Select warehouse') })}
        ${field({ id: 'orderDate', label: 'Order date', type: 'date', value: existing?.orderDate || todayKey(), required: true })}
        ${field({ id: 'taxRate', label: 'Tax rate %', type: 'number', value: existing?.taxRate ?? db.getSettings().taxRate ?? 0, attrs: 'min="0" step="0.01"' })}
      </div>
      ${textareaField({ id: 'notes', label: 'Notes', value: existing?.notes || '' })}
      <div class="lines"><table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Amount</th><th></th></tr></thead><tbody id="so-lines">${(existing?.lines?.length ? existing.lines : [{}]).map((line) => lineRow(line, products, existing?.warehouseId)).join('')}</tbody></table></div>
      <button type="button" class="btn btn-ghost btn-sm" id="add-line" style="margin-top:8px">Add line</button>
      <div class="totals" id="totals"></div>
      <p class="field-error" id="lines-error" role="alert" hidden></p>
    </form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="so-form" class="btn btn-ghost" value="draft">Save draft</button><button type="submit" form="so-form" class="btn btn-primary" value="confirmed">Save and confirm</button>`,
    onMount(dialog) {
      const body = dialog.querySelector('#so-lines');
      const paint = () => {
        const warehouseId = dialog.querySelector('#warehouseId').value;
        let sub = 0;
        body.querySelectorAll('[data-line]').forEach((tr) => {
          const productId = tr.querySelector('[data-field="product"]').value;
          const qty = Number(tr.querySelector('[data-field="qty"]').value) || 0;
          const price = Number(tr.querySelector('[data-field="price"]').value) || 0;
          sub += qty * price;
          tr.querySelector('[data-field="amount"]').textContent = formatMoney(qty * price);
          const hint = tr.querySelector('[data-avail]');
          hint.textContent = productId && warehouseId ? `${available(productId, warehouseId, existing?.id)} available` : '';
        });
        const rate = Number(dialog.querySelector('#taxRate').value) || 0;
        const tax = sub * rate / 100;
        dialog.querySelector('#totals').innerHTML = `<p>Subtotal <strong>${esc(formatMoney(sub))}</strong></p><p>Tax <strong>${esc(formatMoney(tax))}</strong></p><p class="grand">Total <strong>${esc(formatMoney(sub + tax))}</strong></p>`;
      };
      body.addEventListener('input', paint);
      dialog.querySelector('#warehouseId').addEventListener('change', paint);
      body.addEventListener('change', (event) => {
        const select = event.target.closest('[data-field="product"]');
        if (!select) return paint();
        const product = productById(select.value);
        const price = select.closest('tr').querySelector('[data-field="price"]');
        if (product && price && price.value === '') price.value = product.sellingPrice;
        paint();
      });
      dialog.querySelector('#add-line').addEventListener('click', () => { body.insertAdjacentHTML('beforeend', lineRow({}, products, dialog.querySelector('#warehouseId').value)); paint(); });
      body.addEventListener('click', (event) => {
        if (!event.target.closest('[data-remove-line]')) return;
        if (body.querySelectorAll('[data-line]').length === 1) { toast('An order needs at least one line.', 'error'); return; }
        event.target.closest('tr').remove();
        paint();
      });
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#so-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const status = event.submitter?.value === 'confirmed' ? 'confirmed' : 'draft';
        const customerId = dialog.querySelector('#customerId').value;
        const warehouseId = dialog.querySelector('#warehouseId').value;
        const errors = {};
        if (!customerId) errors.customerId = 'Choose a customer.';
        if (!warehouseId) errors.warehouseId = 'Choose a warehouse.';
        if (!dialog.querySelector('#orderDate').value) errors.orderDate = 'Order date is required.';
        const seen = new Set();
        const lines = [...body.querySelectorAll('[data-line]')].map((tr) => ({
          id: tr.dataset.line,
          productId: tr.querySelector('[data-field="product"]').value,
          qty: Number(tr.querySelector('[data-field="qty"]').value),
          qtyShipped: 0,
          unitPrice: Number(tr.querySelector('[data-field="price"]').value),
        }));
        lines.forEach((line) => {
          if (!line.productId) errors.lines = 'Every line needs a product.';
          else if (seen.has(line.productId)) errors.lines = 'Each product can appear only once.';
          else seen.add(line.productId);
          if (!(line.qty > 0)) errors.lines = 'Quantity must be greater than zero.';
          if (!(line.unitPrice >= 0)) errors.lines = 'Price cannot be negative.';
        });
        if (!errors.lines && status === 'confirmed') {
          try { lines.forEach((line) => assertAvailable(line.productId, warehouseId, line.qty, existing?.id)); }
          catch (error) { errors.lines = error.message; }
        }
        if (!applyErrors(dialog, errors)) return;
        const payload = {
          customerId, warehouseId, status,
          orderDate: dialog.querySelector('#orderDate').value,
          taxRate: Number(dialog.querySelector('#taxRate').value) || 0,
          notes: dialog.querySelector('#notes').value.trim(),
          lines, stockPosted: false, shipments: existing?.shipments || [],
        };
        if (existing) {
          db.update('sales_orders', existing.id, payload);
          logAudit('update', 'sales_order', existing.id, `Updated ${existing.number}`);
        } else {
          const number = db.nextNumber('so');
          const created = db.add('sales_orders', { ...payload, number, createdBy: currentUser()?.id || '' });
          logAudit('create', 'sales_order', created.id, `Created ${number}`);
        }
        closeModal();
        toast(status === 'confirmed' ? 'Sales order confirmed. Stock is reserved until shipment.' : 'Draft saved.');
        refresh();
      });
      paint();
    },
  });
}

function openSo(id, refresh) {
  const so = db.getById('sales_orders', id);
  if (!so) { toast('That sales order no longer exists.', 'error'); return; }
  const totals = documentTotals(so.lines, so.taxRate, 'qty', 'unitPrice');
  const rows = (so.lines || []).map((line) => {
    const product = productById(line.productId);
    return `<tr><td>${esc(product?.sku || '')}</td><td>${esc(product?.name || '')}</td><td class="num">${esc(line.qty)}</td><td class="num">${esc(formatMoney(line.unitPrice))}</td><td class="num">${esc(formatMoney(line.qty * line.unitPrice))}</td></tr>`;
  }).join('');
  const flow = can('so.create');
  openModal({
    title: so.number,
    size: 'lg',
    body: `<p>${pill(so.status)} · ${esc(customerName(so.customerId))} · ${esc(warehouseName(so.warehouseId))}</p>
      <p class="muted">${esc(formatDate(so.orderDate))}</p>
      <div class="table-wrap" style="margin-top:12px"><table class="data-table"><thead><tr><th>SKU</th><th>Product</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="totals"><p>Subtotal <strong>${esc(formatMoney(totals.subtotal))}</strong></p><p>Tax <strong>${esc(formatMoney(totals.tax))}</strong></p><p class="grand">Total <strong>${esc(formatMoney(totals.total))}</strong></p></div>`,
    footer: `
      <button type="button" class="btn btn-ghost" id="invoice">Invoice</button>
      <button type="button" class="btn btn-ghost" id="slip">Packing slip</button>
      ${flow && so.status === 'draft' ? '<button type="button" class="btn btn-ghost" id="edit">Edit</button><button type="button" class="btn btn-primary" id="confirm">Confirm</button>' : ''}
      ${flow && so.status === 'confirmed' ? '<button type="button" class="btn btn-primary" id="pack">Mark packed</button>' : ''}
      ${flow && so.status === 'packed' ? '<button type="button" class="btn btn-primary" id="ship">Ship</button>' : ''}
      ${flow && so.status === 'shipped' ? '<button type="button" class="btn btn-primary" id="deliver">Mark delivered</button>' : ''}
      ${flow && !['cancelled', 'delivered'].includes(so.status) ? '<button type="button" class="btn btn-danger" id="cancel">Cancel</button>' : ''}
      ${flow && so.status === 'delivered' ? '<button type="button" class="btn btn-danger" id="cancel">Cancel and reverse</button>' : ''}
      <button type="button" class="btn btn-ghost" id="close">Close</button>`,
    onMount(dialog) {
      dialog.querySelector('#close').addEventListener('click', closeModal);
      dialog.querySelector('#invoice').addEventListener('click', () => printInvoice(db.getById('sales_orders', id)));
      dialog.querySelector('#slip').addEventListener('click', () => printPackingSlip(db.getById('sales_orders', id)));
      dialog.querySelector('#edit')?.addEventListener('click', () => { closeModal(); editSo(id, refresh); });
      dialog.querySelector('#confirm')?.addEventListener('click', () => transition(id, 'confirmed', refresh));
      dialog.querySelector('#pack')?.addEventListener('click', () => transition(id, 'packed', refresh));
      dialog.querySelector('#ship')?.addEventListener('click', () => ship(id, refresh));
      dialog.querySelector('#deliver')?.addEventListener('click', () => transition(id, 'delivered', refresh));
      dialog.querySelector('#cancel')?.addEventListener('click', () => cancelSo(id, refresh));
    },
  });
}

function transition(id, status, refresh) {
  const so = db.getById('sales_orders', id);
  try {
    if (status === 'confirmed') so.lines.forEach((line) => assertAvailable(line.productId, so.warehouseId, line.qty, so.id));
    const patch = { status };
    if (status === 'delivered') patch.deliveredAt = new Date().toISOString();
    db.update('sales_orders', id, patch);
    logAudit('update', 'sales_order', id, `${so.number} marked ${status}`);
    closeModal();
    toast(`Order marked ${status}.`);
    refresh();
  } catch (error) {
    toast(error.message || 'Could not update the order.', 'error');
  }
}

async function ship(id, refresh) {
  const so = db.getById('sales_orders', id);
  try {
    so.lines.forEach((line) => assertAvailable(line.productId, so.warehouseId, Number(line.qty), so.id));
  } catch (error) {
    toast(error.message, 'error');
    return;
  }
  const ok = await confirmDialog({
    title: `Ship ${so.number}?`,
    message: `This deducts stock from ${warehouseName(so.warehouseId)} and cannot be undone without cancelling the order.`,
    confirmText: 'Ship and deduct stock',
  });
  if (!ok) return;
  try {
    db.batch(() => {
      const current = db.getById('sales_orders', id);
      const allocations = [];
      current.lines.forEach((line) => {
        assertAvailable(line.productId, current.warehouseId, Number(line.qty), current.id);
        const plan = planIssue(line.productId, current.warehouseId, Number(line.qty));
        plan.forEach((pick) => {
          postStockChange({
            type: 'out', productId: line.productId, warehouseId: current.warehouseId, locationId: pick.locationId,
            quantity: pick.qty, reason: 'sale', referenceType: 'SO', referenceId: current.id, referenceNo: current.number,
            excludeSoId: current.id,
          });
          allocations.push({ productId: line.productId, locationId: pick.locationId, qty: pick.qty });
        });
        line.qtyShipped = line.qty;
      });
      db.update('sales_orders', id, {
        status: 'shipped', stockPosted: true, lines: current.lines, shippedAt: new Date().toISOString(),
        shipments: [...(current.shipments || []), { id: uid('shp'), date: new Date().toISOString(), userName: currentUser()?.fullName || '', lines: allocations }],
      });
      logAudit('ship', 'sales_order', id, `Shipped ${current.number}`);
    });
    closeModal();
    toast('Order shipped and stock deducted.');
    refresh();
  } catch (error) {
    toast(error.message || 'Shipment failed. Stock was not changed.', 'error');
  }
}

async function cancelSo(id, refresh) {
  const so = db.getById('sales_orders', id);
  const ok = await confirmDialog({
    title: `Cancel ${so.number}?`,
    message: so.stockPosted ? 'Stock already left the warehouse. Cancelling will put those units back.' : 'The order will be cancelled and any reservation released.',
    confirmText: 'Cancel order',
    danger: true,
  });
  if (!ok) return;
  try {
    db.batch(() => {
      const current = db.getById('sales_orders', id);
      if (current.stockPosted) {
        const picks = (current.shipments || []).flatMap((s) => s.lines || []);
        const source = picks.length ? picks : current.lines.map((line) => ({
          productId: line.productId,
          qty: line.qtyShipped || line.qty,
          locationId: db.getById('warehouses', current.warehouseId)?.locations?.[0]?.id,
        }));
        source.forEach((pick) => {
          if (!pick.locationId) throw new Error('No bin is available to return this stock.');
          postStockChange({
            type: 'in', productId: pick.productId, warehouseId: current.warehouseId, locationId: pick.locationId,
            quantity: pick.qty, revalue: false, updateLastCost: false, reason: 'return',
            referenceType: 'SO', referenceId: current.id, referenceNo: current.number,
          });
        });
      }
      db.update('sales_orders', id, { status: 'cancelled', stockPosted: false });
      logAudit('cancel', 'sales_order', id, `Cancelled ${current.number}`);
    });
    closeModal();
    toast('Sales order cancelled.');
    refresh();
  } catch (error) {
    toast(error.message || 'Could not cancel the order.', 'error');
  }
}

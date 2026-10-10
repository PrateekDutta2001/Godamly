import { db } from '../core/db.js';
import { currentUser } from '../core/auth.js';
import { logAudit } from '../core/audit.js';
import { postStockChange } from '../core/inventory.js';
import { activeProducts, productById, supplierName, warehouseName } from '../core/lookup.js';
import { documentTotals, printPurchaseOrder } from '../core/print.js';
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
      kicker: 'Inbound',
      title: 'Purchase orders',
      subtitle: 'Draft, order, and receive goods into a bin.',
      actions: '<button type="button" class="btn btn-primary" id="add">New purchase order</button>',
    })}
    <div class="card">
      <div class="toolbar">
        <div class="field"><label for="q">Search</label><input id="q" placeholder="PO number or supplier" /></div>
        <div class="field"><label for="status">Status</label><select id="status">
          <option value="all">All statuses</option>
          ${['draft', 'ordered', 'partial', 'received', 'cancelled'].map((s) => `<option value="${s}">${s}</option>`).join('')}
        </select></div>
      </div>
      <div id="table-host"></div>
    </div>
  </section>`;
  const rows = () => db.getAll('purchase_orders').filter((po) => {
    const blob = `${po.number} ${supplierName(po.supplierId)}`.toLowerCase();
    if (state.q && !blob.includes(state.q.trim().toLowerCase())) return false;
    if (state.status !== 'all' && po.status !== state.status) return false;
    return true;
  });
  const table = mountTable(root.querySelector('#table-host'), {
    columns: [
      { key: 'number', label: 'PO', sortable: true, render: (row) => `<strong>${esc(row.number)}</strong>` },
      { key: 'supplier', label: 'Supplier', sortable: true, sortValue: (row) => supplierName(row.supplierId), render: (row) => esc(supplierName(row.supplierId)) },
      { key: 'orderDate', label: 'Ordered', sortable: true, render: (row) => esc(formatDate(row.orderDate)) },
      { key: 'expectedDate', label: 'Expected', sortable: true, render: (row) => esc(formatDate(row.expectedDate)) },
      { key: 'total', label: 'Total', sortable: true, align: 'right', sortValue: (row) => documentTotals(row.lines, row.taxRate, 'qtyOrdered', 'unitCost').total, render: (row) => esc(formatMoney(documentTotals(row.lines, row.taxRate, 'qtyOrdered', 'unitCost').total)) },
      { key: 'status', label: 'Status', sortable: true, render: (row) => pill(row.status) },
      { key: 'actions', label: '', render: (row) => `<button type="button" class="icon-btn" data-action="view" data-id="${esc(row.id)}" aria-label="Open ${esc(row.number)}">${icon('eye')}</button>` },
    ],
    rows: rows(),
    rowId: (row) => row.id,
    sortKey: 'orderDate',
    sortDir: 'desc',
    onAction: (_action, id) => openPo(id, () => table.setRows(rows())),
  });
  root.querySelector('#q').addEventListener('input', (e) => { state.q = e.target.value; table.setRows(rows(), true); });
  root.querySelector('#status').addEventListener('change', (e) => { state.status = e.target.value; table.setRows(rows(), true); });
  root.querySelector('#add').addEventListener('click', () => editPo(null, () => table.setRows(rows(), true)));
  const focus = routeQuery().get('focus');
  if (focus) { stripHashQuery('purchase-orders'); openPo(focus, () => table.setRows(rows())); }
}

function productChoices(existingIds = []) {
  const list = activeProducts();
  existingIds.forEach((id) => {
    if (id && !list.some((p) => p.id === id)) {
      const extra = productById(id);
      if (extra) list.push(extra);
    }
  });
  return list;
}

function lineRow(line, products) {
  const id = line?.id || uid('pol');
  return `<tr data-line="${esc(id)}">
    <td><select data-field="product">${options(products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` })), line?.productId || '', 'Product')}</select></td>
    <td><input data-field="qty" type="number" min="0.001" step="any" value="${esc(line?.qtyOrdered ?? 1)}" aria-label="Quantity" /></td>
    <td><input data-field="cost" type="number" min="0" step="0.01" value="${esc(line?.unitCost ?? '')}" aria-label="Unit cost" /></td>
    <td class="num" data-field="amount">—</td>
    <td><button type="button" class="icon-btn" data-remove-line aria-label="Remove line">${icon('trash')}</button></td>
  </tr>`;
}

function editPo(id, refresh) {
  const existing = id ? db.getById('purchase_orders', id) : null;
  if (existing && existing.status !== 'draft') { toast('Only draft orders can be edited.', 'error'); return; }
  const suppliers = db.getAll('suppliers').filter((s) => s.status !== 'inactive' || s.id === existing?.supplierId);
  const warehouses = db.getAll('warehouses').filter((w) => w.status !== 'inactive' || w.id === existing?.warehouseId);
  const products = productChoices((existing?.lines || []).map((l) => l.productId));
  const tax = existing?.taxRate ?? db.getSettings().taxRate ?? 0;
  openModal({
    title: existing ? existing.number : 'New purchase order',
    size: 'lg',
    body: `<form id="po-form" novalidate>
      <div class="grid-2">
        ${selectField({ id: 'supplierId', label: 'Supplier', required: true, optionsHtml: options(suppliers.map((s) => ({ value: s.id, label: s.name })), existing?.supplierId || '', 'Select supplier') })}
        ${selectField({ id: 'warehouseId', label: 'Deliver to', required: true, optionsHtml: options(warehouses.map((w) => ({ value: w.id, label: w.name })), existing?.warehouseId || '', 'Select warehouse') })}
        ${field({ id: 'orderDate', label: 'Order date', type: 'date', value: existing?.orderDate || todayKey(), required: true })}
        ${field({ id: 'expectedDate', label: 'Expected date', type: 'date', value: existing?.expectedDate || '', required: true })}
        ${field({ id: 'taxRate', label: 'Tax rate %', type: 'number', value: tax, attrs: 'min="0" step="0.01"' })}
      </div>
      ${textareaField({ id: 'notes', label: 'Notes', value: existing?.notes || '' })}
      <div class="lines"><table><thead><tr><th>Product</th><th>Qty</th><th>Unit cost</th><th>Amount</th><th></th></tr></thead><tbody id="po-lines">${(existing?.lines || [{ qtyOrdered: 1 }]).map((line) => lineRow(line, products)).join('')}</tbody></table></div>
      <button type="button" class="btn btn-ghost btn-sm" id="add-line" style="margin-top:8px">Add line</button>
      <div class="totals" id="totals"></div>
      <p class="field-error" id="lines-error" role="alert" hidden></p>
    </form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="po-form" class="btn btn-ghost" value="draft">Save draft</button><button type="submit" form="po-form" class="btn btn-primary" value="ordered">Save and mark ordered</button>`,
    onMount(dialog) {
      const body = dialog.querySelector('#po-lines');
      const paint = () => {
        let sub = 0;
        body.querySelectorAll('[data-line]').forEach((tr) => {
          const qty = Number(tr.querySelector('[data-field="qty"]').value) || 0;
          const cost = Number(tr.querySelector('[data-field="cost"]').value) || 0;
          const amount = qty * cost;
          sub += amount;
          tr.querySelector('[data-field="amount"]').textContent = formatMoney(amount);
        });
        const rate = Number(dialog.querySelector('#taxRate').value) || 0;
        const taxAmt = sub * rate / 100;
        dialog.querySelector('#totals').innerHTML = `<p>Subtotal <strong>${esc(formatMoney(sub))}</strong></p><p>Tax <strong>${esc(formatMoney(taxAmt))}</strong></p><p class="grand">Total <strong>${esc(formatMoney(sub + taxAmt))}</strong></p>`;
      };
      body.addEventListener('input', paint);
      body.addEventListener('change', (event) => {
        const select = event.target.closest('[data-field="product"]');
        if (!select) return;
        const product = productById(select.value);
        const cost = select.closest('tr').querySelector('[data-field="cost"]');
        if (product && cost && cost.value === '') cost.value = product.costPrice;
        paint();
      });
      dialog.querySelector('#add-line').addEventListener('click', () => {
        body.insertAdjacentHTML('beforeend', lineRow({ qtyOrdered: 1 }, products));
        paint();
      });
      body.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-remove-line]');
        if (!btn) return;
        if (body.querySelectorAll('[data-line]').length === 1) { toast('An order needs at least one line.', 'error'); return; }
        btn.closest('tr').remove();
        paint();
      });
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#po-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const status = event.submitter?.value === 'ordered' ? 'ordered' : 'draft';
        const supplierId = dialog.querySelector('#supplierId').value;
        const warehouseId = dialog.querySelector('#warehouseId').value;
        const orderDate = dialog.querySelector('#orderDate').value;
        const expectedDate = dialog.querySelector('#expectedDate').value;
        const errors = {};
        if (!supplierId) errors.supplierId = 'Choose a supplier.';
        if (!warehouseId) errors.warehouseId = 'Choose a warehouse.';
        if (!orderDate) errors.orderDate = 'Order date is required.';
        if (!expectedDate) errors.expectedDate = 'Expected date is required.';
        const seen = new Set();
        const lines = [...body.querySelectorAll('[data-line]')].map((tr) => ({
          id: tr.dataset.line,
          productId: tr.querySelector('[data-field="product"]').value,
          qtyOrdered: Number(tr.querySelector('[data-field="qty"]').value),
          qtyReceived: existing?.lines?.find((l) => l.id === tr.dataset.line)?.qtyReceived || 0,
          unitCost: Number(tr.querySelector('[data-field="cost"]').value),
        }));
        if (!lines.length) errors.lines = 'Add at least one line.';
        lines.forEach((line) => {
          if (!line.productId) errors.lines = 'Every line needs a product.';
          else if (seen.has(line.productId)) errors.lines = 'Each product can appear only once. Update the quantity instead.';
          else seen.add(line.productId);
          if (!(line.qtyOrdered > 0)) errors.lines = 'Quantity must be greater than zero.';
          if (!(line.unitCost >= 0)) errors.lines = 'Unit cost cannot be negative.';
        });
        if (!applyErrors(dialog, errors)) return;
        const payload = {
          supplierId, warehouseId, orderDate, expectedDate, status,
          taxRate: Number(dialog.querySelector('#taxRate').value) || 0,
          notes: dialog.querySelector('#notes').value.trim(),
          lines,
          receipts: existing?.receipts || [],
        };
        if (existing) {
          db.update('purchase_orders', existing.id, payload);
          logAudit('update', 'purchase_order', existing.id, `Updated ${existing.number}`);
        } else {
          const number = db.nextNumber('po');
          const created = db.add('purchase_orders', { ...payload, number, createdBy: currentUser()?.id || '' });
          logAudit('create', 'purchase_order', created.id, `Created ${number}`);
        }
        closeModal();
        toast(status === 'ordered' ? 'Purchase order marked as ordered.' : 'Draft saved.');
        refresh();
      });
      paint();
    },
  });
}

function openPo(id, refresh) {
  const po = db.getById('purchase_orders', id);
  if (!po) { toast('That purchase order no longer exists.', 'error'); return; }
  const totals = documentTotals(po.lines, po.taxRate, 'qtyOrdered', 'unitCost');
  const rows = (po.lines || []).map((line) => {
    const product = productById(line.productId);
    return `<tr><td>${esc(product?.sku || '')}</td><td>${esc(product?.name || '')}</td><td class="num">${esc(line.qtyOrdered)}</td><td class="num">${esc(line.qtyReceived || 0)}</td><td class="num">${esc(formatMoney(line.unitCost))}</td></tr>`;
  }).join('');
  const canReceive = ['ordered', 'partial'].includes(po.status) && (po.lines || []).some((l) => Number(l.qtyReceived) < Number(l.qtyOrdered));
  openModal({
    title: po.number,
    size: 'lg',
    body: `<p>${pill(po.status)} · ${esc(supplierName(po.supplierId))} · ${esc(warehouseName(po.warehouseId))}</p>
      <p class="muted">Ordered ${esc(formatDate(po.orderDate))} · Expected ${esc(formatDate(po.expectedDate))}</p>
      <div class="table-wrap" style="margin-top:12px"><table class="data-table"><thead><tr><th>SKU</th><th>Product</th><th>Ordered</th><th>Received</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="totals"><p>Subtotal <strong>${esc(formatMoney(totals.subtotal))}</strong></p><p>Tax ${esc(po.taxRate)}% <strong>${esc(formatMoney(totals.tax))}</strong></p><p class="grand">Total <strong>${esc(formatMoney(totals.total))}</strong></p></div>
      ${(po.receipts || []).length ? `<h3>Receipts</h3><ul>${po.receipts.map((r) => `<li>${esc(r.number)} · ${esc(formatDate(r.date, true))}</li>`).join('')}</ul>` : ''}`,
    footer: `
      <button type="button" class="btn btn-ghost" id="print">Print</button>
      ${po.status === 'draft' ? '<button type="button" class="btn btn-ghost" id="edit">Edit</button><button type="button" class="btn btn-primary" id="order">Mark ordered</button>' : ''}
      ${canReceive ? '<button type="button" class="btn btn-primary" id="receive">Receive goods</button>' : ''}
      ${['draft', 'ordered'].includes(po.status) ? '<button type="button" class="btn btn-danger" id="cancel">Cancel order</button>' : ''}
      <button type="button" class="btn btn-ghost" id="close">Close</button>`,
    onMount(dialog) {
      dialog.querySelector('#close').addEventListener('click', closeModal);
      dialog.querySelector('#print').addEventListener('click', () => printPurchaseOrder(db.getById('purchase_orders', id)));
      dialog.querySelector('#edit')?.addEventListener('click', () => { closeModal(); editPo(id, refresh); });
      dialog.querySelector('#order')?.addEventListener('click', () => {
        db.update('purchase_orders', id, { status: 'ordered' });
        logAudit('update', 'purchase_order', id, `Ordered ${po.number}`);
        closeModal();
        toast('Purchase order is now ordered.');
        refresh();
      });
      dialog.querySelector('#receive')?.addEventListener('click', () => { closeModal(); receivePo(id, refresh); });
      dialog.querySelector('#cancel')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Cancel purchase order?', message: `${po.number} will be cancelled. Received goods are not reversed.`, confirmText: 'Cancel order', danger: true });
        if (!ok) return;
        db.update('purchase_orders', id, { status: 'cancelled' });
        logAudit('cancel', 'purchase_order', id, `Cancelled ${po.number}`);
        closeModal();
        toast('Purchase order cancelled.');
        refresh();
      });
    },
  });
}

function receivePo(id, refresh) {
  const po = db.getById('purchase_orders', id);
  const warehouse = db.getById('warehouses', po.warehouseId);
  const locations = warehouse?.locations || [];
  if (!locations.length) { toast('Add a location to the warehouse before receiving.', 'error'); return; }
  const rows = (po.lines || []).filter((line) => Number(line.qtyOrdered) > Number(line.qtyReceived || 0)).map((line) => {
    const product = productById(line.productId);
    const remain = Number(line.qtyOrdered) - Number(line.qtyReceived || 0);
    return `<tr data-line="${esc(line.id)}">
      <td>${esc(product?.sku || '')}<br><span class="muted">${esc(product?.name || '')}</span></td>
      <td class="num">${esc(remain)}</td>
      <td><input data-field="qty" type="number" min="0" max="${remain}" step="any" value="${remain}" aria-label="Receive quantity" /></td>
      <td><select data-field="location">${options(locations.map((loc) => ({ value: loc.id, label: loc.code })), locations[0].id)}</select></td>
    </tr>`;
  }).join('');
  openModal({
    title: `Receive ${po.number}`,
    size: 'lg',
    body: `<form id="grn-form"><p class="muted">Stock increases only for the quantities you receive now.</p>
      <div class="lines"><table><thead><tr><th>Product</th><th>Remaining</th><th>Receive</th><th>Bin</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="field-error" id="grn-error" role="alert" hidden></p></form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="grn-form" class="btn btn-primary">Post receipt</button>`,
    onMount(dialog) {
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#grn-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const picks = [...dialog.querySelectorAll('[data-line]')].map((tr) => ({
          lineId: tr.dataset.line,
          qty: Number(tr.querySelector('[data-field="qty"]').value) || 0,
          locationId: tr.querySelector('[data-field="location"]').value,
        })).filter((pick) => pick.qty > 0);
        if (!picks.length) { applyErrors(dialog, { grn: 'Enter a quantity to receive.' }); return; }
        try {
          db.batch(() => {
            const current = db.getById('purchase_orders', id);
            const number = db.nextNumber('grn');
            const receiptLines = [];
            picks.forEach((pick) => {
              const line = current.lines.find((item) => item.id === pick.lineId);
              const remain = Number(line.qtyOrdered) - Number(line.qtyReceived || 0);
              if (pick.qty - remain > 0.0001) throw new Error(`You cannot receive more than ${remain} for this line.`);
              postStockChange({
                type: 'in', productId: line.productId, warehouseId: current.warehouseId, locationId: pick.locationId,
                quantity: pick.qty, unitCost: line.unitCost, revalue: true, updateLastCost: true, reason: 'purchase',
                referenceType: 'GRN', referenceId: current.id, referenceNo: number,
              });
              line.qtyReceived = Number(line.qtyReceived || 0) + pick.qty;
              receiptLines.push({ lineId: line.id, productId: line.productId, qty: pick.qty, locationId: pick.locationId, unitCost: line.unitCost });
            });
            const done = current.lines.every((line) => Number(line.qtyReceived) >= Number(line.qtyOrdered));
            db.update('purchase_orders', id, {
              lines: current.lines,
              status: done ? 'received' : 'partial',
              receipts: [...(current.receipts || []), { id: uid('grn'), number, date: new Date().toISOString(), userId: currentUser()?.id || '', userName: currentUser()?.fullName || '', lines: receiptLines }],
            });
            logAudit('receive', 'purchase_order', id, `Received goods on ${number}`);
          });
          closeModal();
          toast('Goods received and stock updated.');
          refresh();
        } catch (error) {
          applyErrors(dialog, { grn: error.message || 'Could not post the receipt.' });
        }
      });
    },
  });
}

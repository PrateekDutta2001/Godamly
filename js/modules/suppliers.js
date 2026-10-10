import { db } from '../core/db.js';
import { logAudit } from '../core/audit.js';
import { supplierName } from '../core/lookup.js';
import { supplierLinked } from '../core/rules.js';
import { documentTotals } from '../core/print.js';
import { esc, formatDate, formatMoney } from '../core/utils.js';
import { applyErrors, field, pageHeader, pill, stars, textareaField } from '../core/ui.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { mountTable } from '../components/table.js';
import { toast } from '../components/toast.js';
import { icon } from '../core/icons.js';
import { routeQuery, stripHashQuery } from '../core/utils.js';

export function render(root) {
  const state = { q: '' };
  root.innerHTML = `<section class="page">
    ${pageHeader({
      kicker: 'Purchasing',
      title: 'Suppliers',
      subtitle: 'Contacts, terms, and purchase history.',
      actions: '<button type="button" class="btn btn-primary" id="add">Add supplier</button>',
    })}
    <div class="card">
      <div class="toolbar"><div class="field"><label for="q">Search</label><input id="q" placeholder="Name, city, or email" /></div></div>
      <div id="table-host"></div>
    </div>
  </section>`;
  const rows = () => {
    const q = state.q.trim().toLowerCase();
    return db.getAll('suppliers').filter((row) => !q || `${row.name} ${row.city || ''} ${row.email || ''} ${row.contactName || ''}`.toLowerCase().includes(q));
  };
  const table = mountTable(root.querySelector('#table-host'), {
    columns: [
      { key: 'name', label: 'Supplier', sortable: true, render: (row) => `<strong>${esc(row.name)}</strong><br><span class="muted">${esc(row.contactName || '')}</span>` },
      { key: 'city', label: 'City', sortable: true, render: (row) => esc(row.city || '—') },
      { key: 'paymentTerms', label: 'Terms', sortable: true, render: (row) => esc(row.paymentTerms || '—') },
      { key: 'rating', label: 'Rating', sortable: true, sortValue: (row) => Number(row.rating) || 0, render: (row) => stars(row.rating) },
      { key: 'status', label: 'Status', sortable: true, render: (row) => pill(row.status || 'active') },
      { key: 'actions', label: '', render: (row) => `<div class="row-actions">
        <button type="button" class="icon-btn" data-action="view" data-id="${esc(row.id)}" aria-label="View ${esc(row.name)}">${icon('eye')}</button>
        <button type="button" class="icon-btn" data-action="edit" data-id="${esc(row.id)}" aria-label="Edit ${esc(row.name)}">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-action="delete" data-id="${esc(row.id)}" aria-label="Remove ${esc(row.name)}">${icon('trash')}</button>
      </div>` },
    ],
    rows: rows(),
    rowId: (row) => row.id,
    sortKey: 'name',
    onAction: (action, id) => {
      if (action === 'view') openSupplier(id);
      if (action === 'edit') editSupplier(id, () => table.setRows(rows()));
      if (action === 'delete') removeSupplier(id, () => table.setRows(rows()));
    },
  });
  root.querySelector('#q').addEventListener('input', (event) => { state.q = event.target.value; table.setRows(rows(), true); });
  root.querySelector('#add').addEventListener('click', () => editSupplier(null, () => table.setRows(rows(), true)));
  const focus = routeQuery().get('focus');
  if (focus) { stripHashQuery('suppliers'); openSupplier(focus); }
}

function formBody(row) {
  return `<form id="sup-form" novalidate>
    <div class="grid-2">
      ${field({ id: 'name', label: 'Company name', value: row.name || '', required: true })}
      ${field({ id: 'contactName', label: 'Contact', value: row.contactName || '' })}
      ${field({ id: 'email', label: 'Email', type: 'email', value: row.email || '' })}
      ${field({ id: 'phone', label: 'Phone', value: row.phone || '' })}
      ${field({ id: 'address', label: 'Address', value: row.address || '' })}
      ${field({ id: 'city', label: 'City', value: row.city || '' })}
      ${field({ id: 'state', label: 'State', value: row.state || '' })}
      ${field({ id: 'postalCode', label: 'Postal code', value: row.postalCode || '' })}
      ${field({ id: 'paymentTerms', label: 'Payment terms', value: row.paymentTerms || 'Net 30' })}
      ${field({ id: 'rating', label: 'Rating (0–5)', type: 'number', value: row.rating ?? 0, attrs: 'min="0" max="5" step="0.5"' })}
      ${field({ id: 'gstin', label: 'Tax ID', value: row.gstin || '' })}
      <div class="field"><label for="status">Status</label><select id="status"><option value="active">Active</option><option value="inactive" ${row.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
    </div>
    ${textareaField({ id: 'notes', label: 'Notes', value: row.notes || '' })}
  </form>`;
}

function read(dialog) {
  const v = (id) => dialog.querySelector(`#${id}`).value.trim();
  return {
    name: v('name'), contactName: v('contactName'), email: v('email'), phone: v('phone'),
    address: v('address'), city: v('city'), state: v('state'), postalCode: v('postalCode'),
    country: 'India', paymentTerms: v('paymentTerms'), rating: Number(dialog.querySelector('#rating').value),
    gstin: v('gstin'), status: dialog.querySelector('#status').value, notes: v('notes'),
  };
}

function editSupplier(id, refresh) {
  const row = id ? db.getById('suppliers', id) : {};
  openModal({
    title: id ? 'Edit supplier' : 'New supplier',
    size: 'lg',
    body: formBody(row),
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="sup-form" class="btn btn-primary">Save</button>`,
    onMount(dialog) {
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#sup-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const data = read(dialog);
        const errors = {};
        if (!data.name) errors.name = 'Company name is required.';
        if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'Enter a valid email.';
        if (Number.isNaN(data.rating) || data.rating < 0 || data.rating > 5) errors.rating = 'Rating must be between 0 and 5.';
        if (!applyErrors(dialog, errors)) return;
        if (id) {
          db.update('suppliers', id, data);
          logAudit('update', 'supplier', id, `Updated ${data.name}`);
        } else {
          const created = db.add('suppliers', data);
          logAudit('create', 'supplier', created.id, `Created ${data.name}`);
        }
        closeModal();
        toast('Supplier saved.');
        refresh();
      });
    },
  });
}

function openSupplier(id) {
  const row = db.getById('suppliers', id);
  if (!row) return;
  const orders = db.getAll('purchase_orders').filter((po) => po.supplierId === id);
  const history = orders.map((po) => {
    const totals = documentTotals(po.lines, po.taxRate, 'qtyOrdered', 'unitCost');
    return `<tr><td>${esc(po.number)}</td><td>${esc(formatDate(po.orderDate))}</td><td>${pill(po.status)}</td><td class="num">${esc(formatMoney(totals.total))}</td></tr>`;
  }).join('') || '<tr><td colspan="4">No purchase orders yet.</td></tr>';
  openModal({
    title: row.name,
    size: 'lg',
    body: `<p>${stars(row.rating)} ${pill(row.status || 'active')}</p>
      <dl class="detail-list" style="margin-top:12px">
        <dt>Contact</dt><dd>${esc(row.contactName || '—')}</dd>
        <dt>Email</dt><dd>${esc(row.email || '—')}</dd>
        <dt>Phone</dt><dd>${esc(row.phone || '—')}</dd>
        <dt>Address</dt><dd>${esc([row.address, row.city, row.state, row.postalCode].filter(Boolean).join(', ') || '—')}</dd>
        <dt>Terms</dt><dd>${esc(row.paymentTerms || '—')}</dd>
        <dt>Tax ID</dt><dd>${esc(row.gstin || '—')}</dd>
      </dl>
      <h3 style="margin:14px 0 8px">Purchase history</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>PO</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>${history}</tbody></table></div>`,
    footer: '<button type="button" class="btn btn-ghost" id="close">Close</button>',
    onMount(dialog) { dialog.querySelector('#close').addEventListener('click', closeModal); },
  });
  void supplierName;
}

async function removeSupplier(id, refresh) {
  const row = db.getById('suppliers', id);
  if (!row) return;
  if (supplierLinked(id)) {
    const ok = await confirmDialog({ title: 'Deactivate supplier?', message: `${row.name} has purchase orders, so it cannot be deleted. Deactivate it instead?`, confirmText: 'Deactivate', danger: true });
    if (!ok) return;
    db.update('suppliers', id, { status: 'inactive' });
    logAudit('deactivate', 'supplier', id, `Deactivated ${row.name}`);
    toast('Supplier deactivated.');
  } else {
    const ok = await confirmDialog({ title: 'Delete supplier?', message: `Delete ${row.name}?`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    db.remove('suppliers', id);
    logAudit('delete', 'supplier', id, `Deleted ${row.name}`);
    toast('Supplier deleted.');
  }
  refresh();
}

import { db } from '../core/db.js';
import { logAudit } from '../core/audit.js';
import { customerLinked } from '../core/rules.js';
import { documentTotals } from '../core/print.js';
import { esc, formatDate, formatMoney, routeQuery, stripHashQuery } from '../core/utils.js';
import { addressText, applyErrors, field, pageHeader, pill, textareaField } from '../core/ui.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { mountTable } from '../components/table.js';
import { toast } from '../components/toast.js';
import { icon } from '../core/icons.js';

const EMPTY_ADDRESS = { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'India' };

export function render(root) {
  const state = { q: '' };
  root.innerHTML = `<section class="page">
    ${pageHeader({
      kicker: 'Sales',
      title: 'Customers',
      subtitle: 'Billing, shipping, and order history.',
      actions: '<button type="button" class="btn btn-primary" id="add">Add customer</button>',
    })}
    <div class="card">
      <div class="toolbar"><div class="field"><label for="q">Search</label><input id="q" placeholder="Name, city, or email" /></div></div>
      <div id="table-host"></div>
    </div>
  </section>`;
  const rows = () => {
    const q = state.q.trim().toLowerCase();
    return db.getAll('customers').filter((row) => !q || `${row.name} ${row.email || ''} ${row.billing?.city || ''}`.toLowerCase().includes(q));
  };
  const table = mountTable(root.querySelector('#table-host'), {
    columns: [
      { key: 'name', label: 'Customer', sortable: true, render: (row) => `<strong>${esc(row.name)}</strong><br><span class="muted">${esc(row.contactName || '')}</span>` },
      { key: 'city', label: 'City', sortable: true, sortValue: (row) => row.billing?.city || '', render: (row) => esc(row.billing?.city || '—') },
      { key: 'email', label: 'Email', sortable: true, render: (row) => esc(row.email || '—') },
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
      if (action === 'view') openCustomer(id);
      if (action === 'edit') editCustomer(id, () => table.setRows(rows()));
      if (action === 'delete') removeCustomer(id, () => table.setRows(rows()));
    },
  });
  root.querySelector('#q').addEventListener('input', (event) => { state.q = event.target.value; table.setRows(rows(), true); });
  root.querySelector('#add').addEventListener('click', () => editCustomer(null, () => table.setRows(rows(), true)));
  const focus = routeQuery().get('focus');
  if (focus) { stripHashQuery('customers'); openCustomer(focus); }
}

function addressFields(prefix, address, title) {
  const a = address || EMPTY_ADDRESS;
  return `<h3 style="margin:8px 0">${esc(title)}</h3><div class="grid-2">
    ${field({ id: `${prefix}-line1`, label: 'Address line 1', value: a.line1 || '' })}
    ${field({ id: `${prefix}-line2`, label: 'Address line 2', value: a.line2 || '' })}
    ${field({ id: `${prefix}-city`, label: 'City', value: a.city || '' })}
    ${field({ id: `${prefix}-state`, label: 'State', value: a.state || '' })}
    ${field({ id: `${prefix}-postalCode`, label: 'Postal code', value: a.postalCode || '' })}
    ${field({ id: `${prefix}-country`, label: 'Country', value: a.country || 'India' })}
  </div>`;
}

function readAddress(dialog, prefix) {
  const v = (key) => dialog.querySelector(`#${prefix}-${key}`).value.trim();
  return { line1: v('line1'), line2: v('line2'), city: v('city'), state: v('state'), postalCode: v('postalCode'), country: v('country') || 'India' };
}

function editCustomer(id, refresh) {
  const row = id ? db.getById('customers', id) : { billing: EMPTY_ADDRESS, shipping: EMPTY_ADDRESS, status: 'active' };
  openModal({
    title: id ? 'Edit customer' : 'New customer',
    size: 'lg',
    body: `<form id="cus-form" novalidate>
      <div class="grid-2">
        ${field({ id: 'name', label: 'Customer name', value: row.name || '', required: true })}
        ${field({ id: 'contactName', label: 'Contact', value: row.contactName || '' })}
        ${field({ id: 'email', label: 'Email', type: 'email', value: row.email || '' })}
        ${field({ id: 'phone', label: 'Phone', value: row.phone || '' })}
        ${field({ id: 'gstin', label: 'Tax ID', value: row.gstin || '' })}
        <div class="field"><label for="status">Status</label><select id="status"><option value="active">Active</option><option value="inactive" ${row.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
      </div>
      ${addressFields('bill', row.billing, 'Billing address')}
      <label class="switch"><input type="checkbox" id="same" /> Shipping address is the same as billing</label>
      <div id="ship-block">${addressFields('ship', row.shipping, 'Shipping address')}</div>
      ${textareaField({ id: 'notes', label: 'Notes', value: row.notes || '' })}
    </form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="cus-form" class="btn btn-primary">Save</button>`,
    onMount(dialog) {
      const same = dialog.querySelector('#same');
      const block = dialog.querySelector('#ship-block');
      same.addEventListener('change', () => { block.hidden = same.checked; });
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#cus-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const name = dialog.querySelector('#name').value.trim();
        const email = dialog.querySelector('#email').value.trim();
        const errors = {};
        if (!name) errors.name = 'Customer name is required.';
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email.';
        if (!applyErrors(dialog, errors)) return;
        const billing = readAddress(dialog, 'bill');
        const payload = {
          name,
          contactName: dialog.querySelector('#contactName').value.trim(),
          email,
          phone: dialog.querySelector('#phone').value.trim(),
          gstin: dialog.querySelector('#gstin').value.trim(),
          status: dialog.querySelector('#status').value,
          notes: dialog.querySelector('#notes').value.trim(),
          billing,
          shipping: same.checked ? billing : readAddress(dialog, 'ship'),
        };
        if (id) {
          db.update('customers', id, payload);
          logAudit('update', 'customer', id, `Updated ${name}`);
        } else {
          const created = db.add('customers', payload);
          logAudit('create', 'customer', created.id, `Created ${name}`);
        }
        closeModal();
        toast('Customer saved.');
        refresh();
      });
    },
  });
}

function openCustomer(id) {
  const row = db.getById('customers', id);
  if (!row) return;
  const orders = db.getAll('sales_orders').filter((so) => so.customerId === id);
  const history = orders.map((so) => {
    const totals = documentTotals(so.lines, so.taxRate, 'qty', 'unitPrice');
    return `<tr><td>${esc(so.number)}</td><td>${esc(formatDate(so.orderDate))}</td><td>${pill(so.status)}</td><td class="num">${esc(formatMoney(totals.total))}</td></tr>`;
  }).join('') || '<tr><td colspan="4">No sales orders yet.</td></tr>';
  openModal({
    title: row.name,
    size: 'lg',
    body: `<p>${pill(row.status || 'active')}</p>
      <dl class="detail-list" style="margin-top:12px">
        <dt>Contact</dt><dd>${esc(row.contactName || '—')}</dd>
        <dt>Email</dt><dd>${esc(row.email || '—')}</dd>
        <dt>Phone</dt><dd>${esc(row.phone || '—')}</dd>
        <dt>Billing</dt><dd>${esc(addressText(row.billing))}</dd>
        <dt>Shipping</dt><dd>${esc(addressText(row.shipping))}</dd>
      </dl>
      <h3 style="margin:14px 0 8px">Sales history</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>${history}</tbody></table></div>`,
    footer: '<button type="button" class="btn btn-ghost" id="close">Close</button>',
    onMount(dialog) { dialog.querySelector('#close').addEventListener('click', closeModal); },
  });
}

async function removeCustomer(id, refresh) {
  const row = db.getById('customers', id);
  if (!row) return;
  if (customerLinked(id)) {
    const ok = await confirmDialog({ title: 'Deactivate customer?', message: `${row.name} has sales orders, so it cannot be deleted. Deactivate it instead?`, confirmText: 'Deactivate', danger: true });
    if (!ok) return;
    db.update('customers', id, { status: 'inactive' });
    logAudit('deactivate', 'customer', id, `Deactivated ${row.name}`);
    toast('Customer deactivated.');
  } else {
    const ok = await confirmDialog({ title: 'Delete customer?', message: `Delete ${row.name}?`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    db.remove('customers', id);
    logAudit('delete', 'customer', id, `Deleted ${row.name}`);
    toast('Customer deleted.');
  }
  refresh();
}

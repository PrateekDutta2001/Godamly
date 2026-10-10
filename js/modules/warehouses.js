import { db } from '../core/db.js';
import { logAudit } from '../core/audit.js';
import { onHand } from '../core/inventory.js';
import { locationLinked, warehouseLinked } from '../core/rules.js';
import { productById } from '../core/lookup.js';
import { esc, fmtQty, uid } from '../core/utils.js';
import { applyErrors, field, pageHeader, pill, textareaField } from '../core/ui.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';

export function render(root) {
  const draw = () => {
    const warehouses = db.getAll('warehouses').sort((a, b) => a.name.localeCompare(b.name));
    root.innerHTML = `<section class="page">
      ${pageHeader({
        kicker: 'Network',
        title: 'Warehouses',
        subtitle: 'Zones, racks, bins, and how full each building is.',
        actions: '<button type="button" class="btn btn-primary" id="add">Add warehouse</button>',
      })}
      <div class="grid-2">
        ${warehouses.map((warehouse) => card(warehouse)).join('') || '<p class="muted">No warehouses yet.</p>'}
      </div>
    </section>`;
    root.querySelector('#add')?.addEventListener('click', () => editWarehouse(null, draw));
    root.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => editWarehouse(btn.dataset.edit, draw)));
    root.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => removeWarehouse(btn.dataset.del, draw)));
    root.querySelectorAll('[data-stock]').forEach((btn) => btn.addEventListener('click', () => showStock(btn.dataset.stock)));
  };
  draw();
}

function card(warehouse) {
  const qty = db.getAll('stock').filter((row) => row.warehouseId === warehouse.id).reduce((sum, row) => sum + Number(row.quantity), 0);
  const cap = Number(warehouse.capacity) || 0;
  const pct = cap ? Math.round((qty / cap) * 100) : 0;
  const locs = warehouse.locations || [];
  return `<article class="card wh-card">
    <div class="page-head"><div><h2>${esc(warehouse.name)}</h2><p class="muted">${esc(warehouse.code || '')} · ${esc(warehouse.city || '')}</p></div>${pill(warehouse.status || 'active')}</div>
    <p>${esc(fmtQty(qty))} units stored · ${esc(pct)}% of ${esc(fmtQty(cap))} capacity</p>
    <div class="hbar" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(warehouse.name)} utilisation"><span class="${pct >= 90 ? 'bar-danger' : pct >= 75 ? 'bar-warning' : ''}" style="width:${Math.min(pct, 100)}%"></span></div>
    <p class="field-hint">${locs.length} location${locs.length === 1 ? '' : 's'}: ${esc(locs.map((loc) => loc.code).join(', ') || 'none')}</p>
    <div class="page-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-stock="${esc(warehouse.id)}">Stock</button>
      <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(warehouse.id)}">Edit</button>
      <button type="button" class="btn btn-ghost btn-sm" data-del="${esc(warehouse.id)}">Remove</button>
    </div>
  </article>`;
}

function locationRow(loc = {}) {
  return `<div class="loc-row">
    <input data-k="zone" placeholder="Zone" value="${esc(loc.zone || '')}" aria-label="Zone" />
    <input data-k="rack" placeholder="Rack" value="${esc(loc.rack || '')}" aria-label="Rack" />
    <input data-k="bin" placeholder="Bin" value="${esc(loc.bin || '')}" aria-label="Bin" />
    <input data-k="capacity" type="number" min="0" placeholder="Capacity" value="${esc(loc.capacity ?? '')}" aria-label="Location capacity" />
    <button type="button" class="btn btn-ghost btn-sm" data-remove-loc>Remove</button>
    <input type="hidden" data-k="id" value="${esc(loc.id || '')}" />
  </div>`;
}

function editWarehouse(id, draw) {
  const row = id ? db.getById('warehouses', id) : { locations: [], status: 'active', country: 'India' };
  openModal({
    title: id ? 'Edit warehouse' : 'New warehouse',
    size: 'lg',
    body: `<form id="wh-form" novalidate>
      <div class="grid-2">
        ${field({ id: 'name', label: 'Name', value: row.name || '', required: true })}
        ${field({ id: 'code', label: 'Code', value: row.code || '', required: true })}
        ${field({ id: 'address', label: 'Address', value: row.address || '' })}
        ${field({ id: 'city', label: 'City', value: row.city || '' })}
        ${field({ id: 'capacity', label: 'Capacity (units)', type: 'number', value: row.capacity ?? '', required: true, attrs: 'min="1" step="1"' })}
        <div class="field"><label for="status">Status</label><select id="status"><option value="active">Active</option><option value="inactive" ${row.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
      </div>
      ${textareaField({ id: 'notes', label: 'Notes', value: row.notes || '' })}
      <div class="page-head"><h3>Locations</h3><button type="button" class="btn btn-ghost btn-sm" id="add-loc">Add location</button></div>
      <div id="locs">${(row.locations || []).map(locationRow).join('') || locationRow()}</div>
      <p class="field-error" id="locs-error" role="alert" hidden></p>
    </form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="wh-form" class="btn btn-primary">Save</button>`,
    onMount(dialog) {
      const locs = dialog.querySelector('#locs');
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#add-loc').addEventListener('click', () => locs.insertAdjacentHTML('beforeend', locationRow()));
      locs.addEventListener('click', async (event) => {
        const btn = event.target.closest('[data-remove-loc]');
        if (!btn) return;
        const wrap = btn.closest('.loc-row');
        const locId = wrap.querySelector('[data-k="id"]').value;
        if (id && locId && locationLinked(id, locId)) {
          toast('That bin still has stock. Move it before removing the location.', 'error');
          return;
        }
        if (locs.querySelectorAll('.loc-row').length === 1) {
          toast('A warehouse needs at least one location.', 'error');
          return;
        }
        wrap.remove();
      });
      dialog.querySelector('#wh-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const name = dialog.querySelector('#name').value.trim();
        const code = dialog.querySelector('#code').value.trim();
        const capacity = Number(dialog.querySelector('#capacity').value);
        const errors = {};
        if (!name) errors.name = 'Name is required.';
        if (!code) errors.code = 'Code is required.';
        else if (db.getAll('warehouses').some((w) => w.code.toLowerCase() === code.toLowerCase() && w.id !== id)) errors.code = 'That code is already used.';
        if (!(capacity > 0)) errors.capacity = 'Capacity must be greater than zero.';
        const locations = [...locs.querySelectorAll('.loc-row')].map((wrap) => {
          const read = (key) => wrap.querySelector(`[data-k="${key}"]`).value.trim();
          const zone = read('zone');
          const rack = read('rack');
          const bin = read('bin');
          return {
            id: read('id') || uid('loc'),
            zone, rack, bin,
            capacity: Number(read('capacity')) || 0,
            code: [zone, rack, bin].filter(Boolean).join('-'),
          };
        }).filter((loc) => loc.zone || loc.rack || loc.bin);
        if (!locations.length) errors.locs = 'Add at least one zone, rack, and bin.';
        if (locations.some((loc) => !loc.zone || !loc.rack || !loc.bin)) errors.locs = 'Each location needs a zone, rack, and bin.';
        const codes = locations.map((loc) => loc.code.toLowerCase());
        if (new Set(codes).size !== codes.length) errors.locs = 'Location codes must be unique.';
        if (!applyErrors(dialog, errors)) return;
        const payload = {
          name, code, capacity,
          address: dialog.querySelector('#address').value.trim(),
          city: dialog.querySelector('#city').value.trim(),
          notes: dialog.querySelector('#notes').value.trim(),
          status: dialog.querySelector('#status').value,
          locations,
        };
        if (id) {
          db.update('warehouses', id, payload);
          logAudit('update', 'warehouse', id, `Updated ${name}`);
        } else {
          const created = db.add('warehouses', payload);
          logAudit('create', 'warehouse', created.id, `Created ${name}`);
        }
        closeModal();
        toast('Warehouse saved.');
        draw();
      });
    },
  });
}

function showStock(id) {
  const warehouse = db.getById('warehouses', id);
  const rows = db.getAll('stock').filter((row) => row.warehouseId === id && Number(row.quantity) > 0);
  const body = rows.map((row) => {
    const product = productById(row.productId);
    const loc = (warehouse.locations || []).find((item) => item.id === row.locationId);
    return `<tr><td>${esc(product?.sku || '')}</td><td>${esc(product?.name || 'Unknown')}</td><td>${esc(loc?.code || row.locationId)}</td><td class="num">${esc(fmtQty(row.quantity))}</td></tr>`;
  }).join('') || '<tr><td colspan="4">No stock in this warehouse.</td></tr>';
  openModal({
    title: `${warehouse.name} stock`,
    size: 'lg',
    body: `<div class="table-wrap"><table class="data-table"><thead><tr><th>SKU</th><th>Product</th><th>Location</th><th>Qty</th></tr></thead><tbody>${body}</tbody></table></div>`,
    footer: '<button type="button" class="btn btn-ghost" id="close">Close</button>',
    onMount(dialog) { dialog.querySelector('#close').addEventListener('click', closeModal); },
  });
  void onHand;
}

async function removeWarehouse(id, draw) {
  const row = db.getById('warehouses', id);
  if (!row) return;
  if (warehouseLinked(id)) {
    const ok = await confirmDialog({ title: 'Deactivate warehouse?', message: `${row.name} still has stock or documents. Deactivate it instead of deleting?`, confirmText: 'Deactivate', danger: true });
    if (!ok) return;
    db.update('warehouses', id, { status: 'inactive' });
    logAudit('deactivate', 'warehouse', id, `Deactivated ${row.name}`);
    toast('Warehouse deactivated.');
  } else {
    const ok = await confirmDialog({ title: 'Delete warehouse?', message: `Delete ${row.name}?`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    db.getAll('stock').filter((s) => s.warehouseId === id).forEach((s) => db.remove('stock', s.id));
    db.remove('warehouses', id);
    logAudit('delete', 'warehouse', id, `Deleted ${row.name}`);
    toast('Warehouse deleted.');
  }
  draw();
}

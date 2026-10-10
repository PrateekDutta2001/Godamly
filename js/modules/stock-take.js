import { db } from '../core/db.js';
import { currentUser } from '../core/auth.js';
import { logAudit } from '../core/audit.js';
import { onHand, postStockChange } from '../core/inventory.js';
import { locationLabel, productById, warehouseName } from '../core/lookup.js';
import { esc, fmtQty, uid } from '../core/utils.js';
import { options, pageHeader, pill } from '../core/ui.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';

export function render(root) {
  const draw = () => {
    const rows = db.getAll('stock_takes').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    root.innerHTML = `<section class="page">
      ${pageHeader({
        kicker: 'Counts',
        title: 'Stock take',
        subtitle: 'Count a warehouse, review the variance, then post adjustments.',
        actions: '<button type="button" class="btn btn-primary" id="add">New count</button>',
      })}
      <div class="card">
        ${rows.length ? `<div class="table-wrap"><table class="data-table responsive"><thead><tr><th>Number</th><th>Warehouse</th><th>Lines</th><th>Status</th><th></th></tr></thead><tbody>
          ${rows.map((row) => `<tr>
            <td data-label="Number">${esc(row.number)}</td>
            <td data-label="Warehouse">${esc(warehouseName(row.warehouseId))}</td>
            <td data-label="Lines">${row.lines?.length || 0}</td>
            <td data-label="Status">${pill(row.status)}</td>
            <td data-label="Actions"><button type="button" class="btn btn-ghost btn-sm" data-open="${esc(row.id)}">${row.status === 'approved' ? 'View' : 'Count'}</button></td>
          </tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No count sheets yet.</p>'}
      </div>
    </section>`;
    root.querySelector('#add').addEventListener('click', () => createSheet(draw));
    root.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => openSheet(btn.dataset.open, draw)));
  };
  draw();
}

function createSheet(draw) {
  const warehouses = db.getAll('warehouses').filter((w) => w.status !== 'inactive');
  openModal({
    title: 'New count sheet',
    body: `<form id="st-form"><div class="field"><label for="warehouseId">Warehouse<span class="req">*</span></label><select id="warehouseId">${options(warehouses.map((w) => ({ value: w.id, label: w.name })), '', 'Select warehouse')}</select><p class="field-error" id="warehouseId-error" role="alert" hidden></p></div><p class="field-hint">Lines are created for every bin that currently holds stock. You can add unexpected items on the sheet.</p></form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="st-form" class="btn btn-primary">Create sheet</button>`,
    onMount(dialog) {
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#st-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const warehouseId = dialog.querySelector('#warehouseId').value;
        if (!warehouseId) { dialog.querySelector('#warehouseId-error').hidden = false; dialog.querySelector('#warehouseId-error').textContent = 'Choose a warehouse.'; return; }
        const lines = db.getAll('stock').filter((row) => row.warehouseId === warehouseId && Number(row.quantity) > 0).map((row) => ({
          id: uid('stl'), productId: row.productId, locationId: row.locationId, systemQty: Number(row.quantity), countedQty: null,
        }));
        if (!lines.length) { toast('That warehouse has no stock to count. Receive goods first.', 'error'); return; }
        const number = db.nextNumber('st');
        const created = db.add('stock_takes', { number, warehouseId, status: 'counting', lines, createdBy: currentUser()?.id || '' });
        logAudit('create', 'stock_take', created.id, `Opened ${number}`);
        closeModal();
        toast('Count sheet created.');
        draw();
        openSheet(created.id, draw);
      });
    },
  });
}

function openSheet(id, draw) {
  const sheet = db.getById('stock_takes', id);
  if (!sheet) return;
  const locked = sheet.status === 'approved' || sheet.status === 'cancelled';
  const warehouse = db.getById('warehouses', sheet.warehouseId);
  const bodyRows = (sheet.lines || []).map((line) => rowHtml(sheet, line, locked)).join('');
  openModal({
    title: sheet.number,
    size: 'lg',
    body: `<p>${pill(sheet.status)} · ${esc(warehouseName(sheet.warehouseId))}</p>
      <div class="table-wrap" style="margin-top:12px"><table class="data-table"><thead><tr><th>Product</th><th>Bin</th><th>System</th><th>Counted</th><th>Variance</th></tr></thead>
      <tbody id="count-body">${bodyRows}</tbody></table></div>
      ${locked ? '' : `<div class="toolbar" style="margin-top:12px">
        <div class="field"><label for="add-product">Add item</label><select id="add-product">${options(db.getAll('products').filter((p) => p.status !== 'inactive').map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` })), '', 'Product')}</select></div>
        <div class="field"><label for="add-loc">Bin</label><select id="add-loc">${options((warehouse?.locations || []).map((l) => ({ value: l.id, label: l.code })), '', 'Bin')}</select></div>
        <button type="button" class="btn btn-ghost" id="add-line">Add</button>
      </div>`}
      <p class="field-error" id="count-error" role="alert" hidden></p>`,
    footer: `${locked ? '' : '<button type="button" class="btn btn-ghost" id="save">Save draft</button><button type="button" class="btn btn-primary" id="approve">Approve and post</button>'}<button type="button" class="btn btn-ghost" id="close">Close</button>`,
    onMount(dialog) {
      const tbody = dialog.querySelector('#count-body');
      const paintVar = () => {
        tbody.querySelectorAll('[data-line]').forEach((tr) => {
          const system = Number(tr.dataset.system);
          const raw = tr.querySelector('[data-counted]').value;
          const cell = tr.querySelector('[data-var]');
          if (raw === '') { cell.textContent = '—'; return; }
          const variance = Number(raw) - system;
          cell.textContent = `${variance > 0 ? '+' : ''}${fmtQty(variance)}`;
        });
      };
      tbody.addEventListener('input', paintVar);
      dialog.querySelector('#close').addEventListener('click', closeModal);
      dialog.querySelector('#add-line')?.addEventListener('click', () => {
        const productId = dialog.querySelector('#add-product').value;
        const locationId = dialog.querySelector('#add-loc').value;
        if (!productId || !locationId) { toast('Choose a product and a bin.', 'error'); return; }
        if ([...tbody.querySelectorAll('[data-line]')].some((tr) => tr.dataset.product === productId && tr.dataset.location === locationId)) {
          toast('That product is already on this bin.', 'error');
          return;
        }
        const line = { id: uid('stl'), productId, locationId, systemQty: onHand(productId, sheet.warehouseId, locationId), countedQty: null };
        tbody.insertAdjacentHTML('beforeend', rowHtml(sheet, line, false));
      });
      const collect = () => [...tbody.querySelectorAll('[data-line]')].map((tr) => ({
        id: tr.dataset.line,
        productId: tr.dataset.product,
        locationId: tr.dataset.location,
        systemQty: Number(tr.dataset.system),
        countedQty: tr.querySelector('[data-counted]').value === '' ? null : Number(tr.querySelector('[data-counted]').value),
      }));
      dialog.querySelector('#save')?.addEventListener('click', () => {
        db.update('stock_takes', id, { lines: collect(), status: 'counting' });
        logAudit('update', 'stock_take', id, `Saved ${sheet.number}`);
        toast('Count sheet saved.');
        closeModal();
        draw();
      });
      dialog.querySelector('#approve')?.addEventListener('click', async () => {
        const lines = collect();
        if (lines.some((line) => line.countedQty == null || Number.isNaN(line.countedQty) || line.countedQty < 0)) {
          dialog.querySelector('#count-error').hidden = false;
          dialog.querySelector('#count-error').textContent = 'Enter a counted quantity of zero or more on every line.';
          return;
        }
        const ok = await confirmDialog({ title: 'Post this count?', message: 'Variances will be written to the ledger as adjustments. This cannot be edited afterwards.', confirmText: 'Approve and post' });
        if (!ok) return;
        try {
          db.batch(() => {
            const posted = lines.map((line) => {
              const system = onHand(line.productId, sheet.warehouseId, line.locationId);
              const variance = Number(line.countedQty) - system;
              if (variance > 0) {
                const product = productById(line.productId);
                postStockChange({
                  type: 'adjustment', direction: 'in', productId: line.productId, warehouseId: sheet.warehouseId, locationId: line.locationId,
                  quantity: variance, unitCost: product?.avgCost ?? product?.costPrice, revalue: true, updateLastCost: false,
                  reason: 'correction', notes: `Stock take ${sheet.number}`, referenceType: 'COUNT', referenceId: sheet.id, referenceNo: sheet.number,
                });
              } else if (variance < 0) {
                postStockChange({
                  type: 'adjustment', direction: 'out', productId: line.productId, warehouseId: sheet.warehouseId, locationId: line.locationId,
                  quantity: Math.abs(variance), reason: 'correction', notes: `Stock take ${sheet.number}`,
                  referenceType: 'COUNT', referenceId: sheet.id, referenceNo: sheet.number,
                });
              }
              return { ...line, systemQty: system, variance };
            });
            db.update('stock_takes', id, { lines: posted, status: 'approved', approvedAt: new Date().toISOString(), approvedBy: currentUser()?.id || '' });
            logAudit('approve', 'stock_take', id, `Approved ${sheet.number}`);
          });
          closeModal();
          toast('Count approved and adjustments posted.');
          draw();
        } catch (error) {
          dialog.querySelector('#count-error').hidden = false;
          dialog.querySelector('#count-error').textContent = error.message || 'Could not post the count.';
        }
      });
    },
  });
}

function rowHtml(sheet, line, locked) {
  const product = productById(line.productId);
  const variance = line.countedQty == null ? '—' : fmtQty(Number(line.countedQty) - Number(line.systemQty));
  return `<tr data-line="${esc(line.id)}" data-product="${esc(line.productId)}" data-location="${esc(line.locationId)}" data-system="${esc(line.systemQty)}">
    <td>${esc(product ? `${product.sku} · ${product.name}` : 'Unknown')}</td>
    <td>${esc(locationLabel(sheet.warehouseId, line.locationId))}</td>
    <td class="num">${esc(fmtQty(line.systemQty))}</td>
    <td>${locked ? esc(line.countedQty ?? '—') : `<input data-counted type="number" min="0" step="any" value="${line.countedQty ?? ''}" aria-label="Counted quantity" />`}</td>
    <td class="num" data-var>${esc(variance)}</td>
  </tr>`;
}

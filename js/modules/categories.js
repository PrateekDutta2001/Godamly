import { db } from '../core/db.js';
import { logAudit } from '../core/audit.js';
import { categoryLinked, unitLinked } from '../core/rules.js';
import { applyErrors, field, pageHeader, pill, textareaField } from '../core/ui.js';
import { confirmDialog, openModal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { esc } from '../core/utils.js';

export function render(root) {
  const draw = () => {
    const categories = db.getAll('categories').sort((a, b) => a.name.localeCompare(b.name));
    const units = db.getAll('units').sort((a, b) => a.name.localeCompare(b.name));
    root.innerHTML = `<section class="page">
      ${pageHeader({ kicker: 'Catalogue', title: 'Categories & units', subtitle: 'Group products and keep units consistent.' })}
      <div class="split">
        <article class="card">
          <div class="page-head"><h2>Categories</h2><button type="button" class="btn btn-primary btn-sm" id="add-cat">Add category</button></div>
          ${list(categories, 'cat')}
        </article>
        <article class="card">
          <div class="page-head"><h2>Units</h2><button type="button" class="btn btn-primary btn-sm" id="add-unit">Add unit</button></div>
          ${units.length ? `<div class="table-wrap"><table class="data-table responsive"><thead><tr><th>Name</th><th>Abbrev.</th><th>Status</th><th></th></tr></thead><tbody>
            ${units.map((unit) => `<tr><td data-label="Name">${esc(unit.name)}</td><td data-label="Abbrev.">${esc(unit.abbreviation)}</td><td data-label="Status">${pill(unit.status || 'active')}</td><td data-label="Actions" class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-edit-unit="${esc(unit.id)}">Edit</button><button type="button" class="btn btn-ghost btn-sm" data-del-unit="${esc(unit.id)}">Remove</button></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">No units yet.</p>'}
        </article>
      </div>
    </section>`;
    root.querySelector('#add-cat').addEventListener('click', () => editCategory(null, draw));
    root.querySelector('#add-unit').addEventListener('click', () => editUnit(null, draw));
    root.querySelectorAll('[data-edit-cat]').forEach((btn) => btn.addEventListener('click', () => editCategory(btn.dataset.editCat, draw)));
    root.querySelectorAll('[data-del-cat]').forEach((btn) => btn.addEventListener('click', () => removeCategory(btn.dataset.delCat, draw)));
    root.querySelectorAll('[data-edit-unit]').forEach((btn) => btn.addEventListener('click', () => editUnit(btn.dataset.editUnit, draw)));
    root.querySelectorAll('[data-del-unit]').forEach((btn) => btn.addEventListener('click', () => removeUnit(btn.dataset.delUnit, draw)));
  };
  draw();
}

function list(categories) {
  if (!categories.length) return '<p class="muted">No categories yet.</p>';
  return `<div class="table-wrap"><table class="data-table responsive"><thead><tr><th>Name</th><th>Products</th><th>Status</th><th></th></tr></thead><tbody>
    ${categories.map((cat) => {
      const count = db.query('products', (p) => p.categoryId === cat.id).length;
      return `<tr><td data-label="Name"><span class="dot" style="background:${esc(cat.color || '#0f766e')};display:inline-block;margin-right:6px"></span>${esc(cat.name)}</td><td data-label="Products">${count}</td><td data-label="Status">${pill(cat.status || 'active')}</td><td data-label="Actions" class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-edit-cat="${esc(cat.id)}">Edit</button><button type="button" class="btn btn-ghost btn-sm" data-del-cat="${esc(cat.id)}">Remove</button></td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

function editCategory(id, draw) {
  const row = id ? db.getById('categories', id) : { name: '', description: '', color: '#0f766e', status: 'active' };
  openModal({
    title: id ? 'Edit category' : 'New category',
    body: `<form id="cat-form" novalidate>
      ${field({ id: 'name', label: 'Name', value: row.name, required: true })}
      ${textareaField({ id: 'description', label: 'Description', value: row.description || '' })}
      ${field({ id: 'color', label: 'Colour', type: 'color', value: row.color || '#0f766e' })}
      <div class="field"><label for="status">Status</label><select id="status"><option value="active" ${row.status !== 'inactive' ? 'selected' : ''}>Active</option><option value="inactive" ${row.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
    </form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="cat-form" class="btn btn-primary">Save</button>`,
    onMount(dialog) {
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#cat-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const name = dialog.querySelector('#name').value.trim();
        if (!applyErrors(dialog, name ? {} : { name: 'Name is required.' })) return;
        const payload = {
          name,
          description: dialog.querySelector('#description').value.trim(),
          color: dialog.querySelector('#color').value,
          status: dialog.querySelector('#status').value,
        };
        if (db.getAll('categories').some((cat) => cat.name.toLowerCase() === name.toLowerCase() && cat.id !== id)) {
          applyErrors(dialog, { name: 'A category with that name already exists.' });
          return;
        }
        if (id) {
          db.update('categories', id, payload);
          logAudit('update', 'category', id, `Updated category ${name}`);
        } else {
          const created = db.add('categories', payload);
          logAudit('create', 'category', created.id, `Created category ${name}`);
        }
        closeModal();
        toast('Category saved.');
        draw();
      });
    },
  });
}

async function removeCategory(id, draw) {
  const row = db.getById('categories', id);
  if (!row) return;
  if (categoryLinked(id)) {
    const ok = await confirmDialog({ title: 'Deactivate category?', message: `${row.name} is used by products, so it cannot be deleted. Deactivate it instead?`, confirmText: 'Deactivate', danger: true });
    if (!ok) return;
    db.update('categories', id, { status: 'inactive' });
    logAudit('deactivate', 'category', id, `Deactivated ${row.name}`);
    toast('Category deactivated.');
  } else {
    const ok = await confirmDialog({ title: 'Delete category?', message: `Delete ${row.name}? This cannot be undone.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    db.remove('categories', id);
    logAudit('delete', 'category', id, `Deleted ${row.name}`);
    toast('Category deleted.');
  }
  draw();
}

function editUnit(id, draw) {
  const row = id ? db.getById('units', id) : { name: '', abbreviation: '', status: 'active' };
  openModal({
    title: id ? 'Edit unit' : 'New unit',
    body: `<form id="unit-form" novalidate>
      ${field({ id: 'name', label: 'Name', value: row.name, required: true, placeholder: 'Kilogram' })}
      ${field({ id: 'abbreviation', label: 'Abbreviation', value: row.abbreviation || '', required: true, placeholder: 'kg' })}
      <div class="field"><label for="status">Status</label><select id="status"><option value="active" ${row.status !== 'inactive' ? 'selected' : ''}>Active</option><option value="inactive" ${row.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
    </form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="unit-form" class="btn btn-primary">Save</button>`,
    onMount(dialog) {
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#unit-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const name = dialog.querySelector('#name').value.trim();
        const abbreviation = dialog.querySelector('#abbreviation').value.trim();
        const errors = {};
        if (!name) errors.name = 'Name is required.';
        if (!abbreviation) errors.abbreviation = 'Abbreviation is required.';
        if (!applyErrors(dialog, errors)) return;
        const payload = { name, abbreviation, status: dialog.querySelector('#status').value };
        if (id) {
          db.update('units', id, payload);
          logAudit('update', 'unit', id, `Updated unit ${name}`);
        } else {
          const created = db.add('units', payload);
          logAudit('create', 'unit', created.id, `Created unit ${name}`);
        }
        closeModal();
        toast('Unit saved.');
        draw();
      });
    },
  });
}

async function removeUnit(id, draw) {
  const row = db.getById('units', id);
  if (!row) return;
  if (unitLinked(id)) {
    const ok = await confirmDialog({ title: 'Deactivate unit?', message: `${row.name} is used by products. Deactivate it instead of deleting?`, confirmText: 'Deactivate', danger: true });
    if (!ok) return;
    db.update('units', id, { status: 'inactive' });
    logAudit('deactivate', 'unit', id, `Deactivated ${row.name}`);
    toast('Unit deactivated.');
  } else {
    const ok = await confirmDialog({ title: 'Delete unit?', message: `Delete ${row.name}?`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    db.remove('units', id);
    logAudit('delete', 'unit', id, `Deleted ${row.name}`);
    toast('Unit deleted.');
  }
  draw();
}

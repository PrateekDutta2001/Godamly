import { db } from '../core/db.js';
import { currentUser, logout } from '../core/auth.js';
import { logAudit } from '../core/audit.js';
import { downloadJSON, esc, readImageFile, safeImageSrc } from '../core/utils.js';
import { applyErrors, field, pageHeader, textareaField } from '../core/ui.js';
import { confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';

const CURRENCIES = [
  { code: 'INR', symbol: '₹', label: 'INR ₹' },
  { code: 'USD', symbol: '$', label: 'USD $' },
  { code: 'EUR', symbol: '€', label: 'EUR €' },
  { code: 'GBP', symbol: '£', label: 'GBP £' },
];

export function render(root) {
  const settings = db.getSettings();
  const company = settings.company || {};
  root.innerHTML = `<section class="page">
    ${pageHeader({ kicker: 'Workspace', title: 'Settings', subtitle: 'Company profile, defaults, and the data stored in this browser.' })}
    <form id="settings-form" class="card" novalidate>
      <h2>Company</h2>
      <div class="grid-2">
        ${field({ id: 'name', label: 'Company name', value: company.name || '', required: true })}
        ${field({ id: 'legalName', label: 'Legal name', value: company.legalName || '' })}
        ${field({ id: 'phone', label: 'Phone', value: company.phone || '' })}
        ${field({ id: 'email', label: 'Email', type: 'email', value: company.email || '' })}
        ${field({ id: 'taxId', label: 'Tax ID', value: company.taxId || '' })}
        ${field({ id: 'website', label: 'Website', value: company.website || '' })}
      </div>
      ${textareaField({ id: 'address', label: 'Address', value: company.address || '' })}
      <div class="field"><label for="logo">Logo</label><input id="logo" type="file" accept="image/*" />
        <div id="logo-preview" style="margin-top:8px">${safeImageSrc(company.logo) ? `<img class="thumb" alt="Company logo" src="${safeImageSrc(company.logo)}" />` : ''}</div>
        <p class="field-error" id="logo-error" role="alert" hidden></p>
      </div>
      <h2>Defaults</h2>
      <div class="grid-2">
        <div class="field"><label for="currency">Currency</label><select id="currency">${CURRENCIES.map((c) => `<option value="${c.code}" ${settings.currency === c.code ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select><p class="field-hint">Changing the symbol does not convert existing amounts.</p></div>
        ${field({ id: 'taxRate', label: 'Default tax rate %', type: 'number', value: settings.taxRate ?? 0, attrs: 'min="0" step="0.01"' })}
        <div class="field"><label for="dateFormat">Date format</label><select id="dateFormat">
          ${['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((fmt) => `<option ${settings.dateFormat === fmt ? 'selected' : ''}>${fmt}</option>`).join('')}
        </select></div>
        ${field({ id: 'lowStockThreshold', label: 'Default low-stock level', type: 'number', value: settings.lowStockThreshold ?? 10, attrs: 'min="0" step="1"' })}
        ${field({ id: 'skuPrefix', label: 'SKU prefix', value: settings.skuPrefix || 'GDM', required: true })}
      </div>
      <h2>Theme</h2>
      <div class="theme-choice">
        <label><input type="radio" name="theme" value="light" ${settings.theme !== 'dark' ? 'checked' : ''} /> Light</label>
        <label><input type="radio" name="theme" value="dark" ${settings.theme === 'dark' ? 'checked' : ''} /> Dark</label>
      </div>
      <button class="btn btn-primary" type="submit" style="margin-top:16px">Save settings</button>
    </form>
    <div class="card">
      <h2>Backup</h2>
      <p class="muted">Godamly keeps data in this browser. Export a file before you clear site data.</p>
      <div class="page-actions" style="margin-top:12px">
        <button type="button" class="btn btn-ghost" id="export">Export all data as JSON</button>
        <label class="btn btn-ghost">Import JSON<input id="import" type="file" accept="application/json,.json" hidden /></label>
        <button type="button" class="btn btn-danger" id="reset">Reset to seed data</button>
      </div>
    </div>
  </section>`;

  let logo = company.logo || '';
  root.querySelector('#logo').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      logo = await readImageFile(file, 320);
      root.querySelector('#logo-preview').innerHTML = `<img class="thumb" alt="Company logo" src="${logo}" />`;
    } catch (error) {
      applyErrors(root, { logo: error.message });
    }
  });
  root.querySelector('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = root.querySelector('#name').value.trim();
    const errors = {};
    if (!name) errors.name = 'Company name is required.';
    const taxRate = Number(root.querySelector('#taxRate').value);
    if (!(taxRate >= 0)) errors.taxRate = 'Tax rate cannot be negative.';
    const low = Number(root.querySelector('#lowStockThreshold').value);
    if (!(low >= 0)) errors.lowStockThreshold = 'Threshold cannot be negative.';
    const skuPrefix = root.querySelector('#skuPrefix').value.trim();
    if (!/^[A-Za-z0-9-]{2,8}$/.test(skuPrefix)) errors.skuPrefix = 'Use 2–8 letters, numbers, or hyphens.';
    if (!applyErrors(root, errors)) return;
    const currency = CURRENCIES.find((item) => item.code === root.querySelector('#currency').value) || CURRENCIES[0];
    const theme = root.querySelector('input[name="theme"]:checked').value;
    db.saveSettings({
      company: {
        name,
        legalName: root.querySelector('#legalName').value.trim(),
        phone: root.querySelector('#phone').value.trim(),
        email: root.querySelector('#email').value.trim(),
        taxId: root.querySelector('#taxId').value.trim(),
        website: root.querySelector('#website').value.trim(),
        address: root.querySelector('#address').value.trim(),
        logo,
      },
      currency: currency.code,
      currencySymbol: currency.symbol,
      taxRate,
      dateFormat: root.querySelector('#dateFormat').value,
      lowStockThreshold: low,
      skuPrefix: skuPrefix.toUpperCase(),
      theme,
    });
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('godamly_theme', theme);
    logAudit('update', 'settings', 'settings', 'Updated company settings');
    toast('Settings saved.');
  });
  root.querySelector('#export').addEventListener('click', () => {
    downloadJSON(`godamly-backup-${new Date().toISOString().slice(0, 10)}.json`, db.exportAll());
    toast('Backup downloaded.');
  });
  root.querySelector('#import').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ok = await confirmDialog({ title: 'Replace all local data?', message: 'Importing overwrites products, stock, orders, and users stored in this browser.', confirmText: 'Import backup', danger: true });
      if (!ok) return;
      const me = currentUser()?.id;
      db.importAll(data);
      logAudit('import', 'settings', 'settings', `Imported ${file.name}`);
      if (!db.getById('users', me)) logout('manual');
      else { toast('Backup imported.'); location.reload(); }
    } catch (error) {
      toast(error.message || 'That file could not be imported.', 'error');
    }
  });
  root.querySelector('#reset').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Reset to seed data?', message: 'This replaces everything in this browser with the original sample warehouse. Export a backup first if you need it.', confirmText: 'Reset data', danger: true });
    if (!ok) return;
    try {
      await db.reset();
      logAudit('reset', 'settings', 'settings', 'Reset to seed data');
      toast('Sample data restored.');
      const theme = db.getSettings().theme || 'light';
      localStorage.setItem('godamly_theme', theme);
      location.reload();
    } catch (error) {
      toast(error.message || 'Reset failed.', 'error');
    }
  });
}

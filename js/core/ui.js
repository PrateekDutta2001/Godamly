/** HTML snippets shared by pages. Callers must pass already-safe attribute values through these helpers. */
import { esc, initials, safeImageSrc } from './utils.js';
import { icon } from './icons.js';

const STATUS_LABELS = {
  draft: 'Draft',
  ordered: 'Ordered',
  partial: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
  confirmed: 'Confirmed',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  active: 'Active',
  inactive: 'Inactive',
  approved: 'Approved',
  counting: 'In progress',
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
};

export function pill(status) {
  const key = String(status || 'draft').toLowerCase();
  const label = STATUS_LABELS[key] || status || '—';
  return `<span class="pill pill-${esc(key)}">${esc(label)}</span>`;
}

export function pageHeader({ kicker = '', title, subtitle = '', actions = '' }) {
  return `<header class="page-head">
    <div>
      ${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}
      <h1>${esc(title)}</h1>
      ${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ''}
    </div>
    <div class="page-actions">${actions}</div>
  </header>`;
}

export function emptyState({ title, text, iconName = 'package' }) {
  return `<div class="empty">
    <div class="empty-art" aria-hidden="true">${icon(iconName)}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(text)}</p>
  </div>`;
}

export function field({ id, label, type = 'text', value = '', required = false, placeholder = '', hint = '', attrs = '' }) {
  return `<div class="field">
    <label for="${esc(id)}">${esc(label)}${required ? '<span class="req">*</span>' : ''}</label>
    <input id="${esc(id)}" name="${esc(id)}" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'aria-required="true"' : ''} ${attrs} />
    ${hint ? `<p class="field-hint">${esc(hint)}</p>` : ''}
    <p class="field-error" id="${esc(id)}-error" role="alert" hidden></p>
  </div>`;
}

export function selectField({ id, label, optionsHtml, required = false, hint = '' }) {
  return `<div class="field">
    <label for="${esc(id)}">${esc(label)}${required ? '<span class="req">*</span>' : ''}</label>
    <select id="${esc(id)}" name="${esc(id)}" ${required ? 'aria-required="true"' : ''}>${optionsHtml}</select>
    ${hint ? `<p class="field-hint">${esc(hint)}</p>` : ''}
    <p class="field-error" id="${esc(id)}-error" role="alert" hidden></p>
  </div>`;
}

export function textareaField({ id, label, value = '', required = false, placeholder = '', rows = 3 }) {
  return `<div class="field">
    <label for="${esc(id)}">${esc(label)}${required ? '<span class="req">*</span>' : ''}</label>
    <textarea id="${esc(id)}" name="${esc(id)}" rows="${rows}" placeholder="${esc(placeholder)}" ${required ? 'aria-required="true"' : ''}>${esc(value)}</textarea>
    <p class="field-error" id="${esc(id)}-error" role="alert" hidden></p>
  </div>`;
}

export function options(items, selected = '', placeholder = '') {
  const head = placeholder ? `<option value="">${esc(placeholder)}</option>` : '';
  return head + items.map((item) => {
    const value = item.value ?? item.id;
    const label = item.label ?? item.name;
    const isOn = String(value) === String(selected);
    return `<option value="${esc(value)}"${isOn ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

export function applyErrors(scope, errors) {
  scope.querySelectorAll('.field-error').forEach((el) => {
    el.hidden = true;
    el.textContent = '';
  });
  scope.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  scope.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  const entries = Object.entries(errors).filter(([, message]) => message);
  entries.forEach(([id, message]) => {
    const input = scope.querySelector(`#${CSS.escape(id)}`);
    const err = scope.querySelector(`#${CSS.escape(id)}-error`);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.classList.add('invalid');
    }
    if (err) {
      err.hidden = false;
      err.textContent = message;
    }
  });
  if (entries.length) {
    const first = scope.querySelector(`#${CSS.escape(entries[0][0])}`);
    first?.focus();
  }
  return entries.length === 0;
}

export function avatar(name, image, alt = '') {
  const src = safeImageSrc(image);
  if (src) return `<img class="avatar" alt="${esc(alt || name || '')}" src="${src}" />`;
  return `<span class="avatar avatar-fallback" aria-hidden="true">${esc(initials(name))}</span>`;
}

export function stars(rating) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  const full = Math.round(value);
  const glyphs = `${'★'.repeat(full)}${'☆'.repeat(5 - full)}`;
  return `<span class="stars" aria-label="${esc(value)} out of 5">${glyphs}</span>`;
}

export function addressText(address) {
  if (!address) return '—';
  return [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ') || '—';
}

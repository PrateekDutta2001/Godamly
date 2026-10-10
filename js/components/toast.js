/** Toasts for success and failure. Messages are escaped. */
import { esc } from '../core/utils.js';
import { icon } from '../core/icons.js';

const ICONS = { success: 'check', error: 'alert', warning: 'alert', info: 'bell' };

export function toast(message, type = 'success', timeout = 4200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-icon">${ICONS[type] ? icon(ICONS[type]) : ''}</span><p>${esc(message)}</p><button type="button" class="toast-close" aria-label="Dismiss notification">${icon('x')}</button>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('button').addEventListener('click', close);
  setTimeout(close, timeout);
}

/** Modal dialog and confirmation prompt. */
import { icon } from '../core/icons.js';
import { esc } from '../core/utils.js';

let lastFocus = null;
let onKey = null;

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = '';
  root.classList.remove('open');
  document.body.classList.remove('modal-open');
  if (onKey) {
    document.removeEventListener('keydown', onKey);
    onKey = null;
  }
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  lastFocus = null;
}

export function openModal({ title, body, footer = '', size = 'md', onMount }) {
  const root = document.getElementById('modal-root');
  lastFocus = document.activeElement;
  root.classList.add('open');
  document.body.classList.add('modal-open');
  root.innerHTML = `<div class="modal-backdrop" data-close="1"></div>
    <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header class="modal-head">
        <h2 id="modal-title">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close="1" aria-label="Close dialog">${icon('x')}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`;
  const dialog = root.querySelector('.modal');
  root.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', (event) => {
      if (event.currentTarget === event.target || event.currentTarget.dataset.close) closeModal();
    });
  });
  onKey = (event) => {
    if (event.key === 'Escape') {
      if (document.getElementById('confirm-root')?.classList.contains('open')) return;
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  onMount?.(dialog);
  const focusable = dialog.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-foot .btn-primary, button');
  focusable?.focus();
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('confirm-root');
    const finish = (value) => {
      root.innerHTML = '';
      root.classList.remove('open');
      document.removeEventListener('keydown', onConfirmKey);
      resolve(value);
    };
    const onConfirmKey = (event) => {
      if (event.key === 'Escape') finish(false);
    };
    root.classList.add('open');
    root.innerHTML = `<div class="modal-backdrop"></div>
      <div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
        <header class="modal-head"><h2 id="confirm-title"></h2></header>
        <div class="modal-body"><p id="confirm-text"></p></div>
        <footer class="modal-foot">
          <button type="button" class="btn btn-ghost" id="confirm-cancel">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok"></button>
        </footer>
      </div>`;
    root.querySelector('#confirm-title').textContent = title;
    root.querySelector('#confirm-text').textContent = message;
    root.querySelector('#confirm-ok').textContent = confirmText;
    root.querySelector('#confirm-cancel').addEventListener('click', () => finish(false));
    root.querySelector('.modal-backdrop').addEventListener('click', () => finish(false));
    root.querySelector('#confirm-ok').addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onConfirmKey);
    root.querySelector('#confirm-ok').focus();
  });
}

import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../core/notifications.js';
import { esc, relativeTime, safeHash } from '../core/utils.js';
import { pageHeader } from '../core/ui.js';

export function render(root) {
  const draw = () => {
    const items = listNotifications();
    root.innerHTML = `<section class="page">
      ${pageHeader({
        kicker: 'Watchlist',
        title: 'Alerts',
        subtitle: 'Low stock, expiry, overdue purchases, and notices.',
        actions: `<button type="button" class="btn btn-ghost" id="mark-all">Mark all read</button>`,
      })}
      <div class="card">
        ${items.length ? `<div class="stack">${items.map((item) => `
          <a class="notice ${item.read ? 'read' : ''}" href="${safeHash(item.href)}" data-id="${esc(item.id)}">
            <strong>${esc(item.title)}</strong>
            <span>${esc(item.message)}</span>
            <small class="muted">${item.kind === 'notice' ? esc(relativeTime(item.createdAt)) : 'Live check'}</small>
          </a>`).join('')}</div>` : '<p class="muted">Nothing needs attention.</p>'}
      </div>
    </section>`;
    root.querySelector('#mark-all').addEventListener('click', () => {
      markAllNotificationsRead();
      draw();
    });
    root.querySelectorAll('[data-id]').forEach((link) => {
      link.addEventListener('click', () => markNotificationRead(link.dataset.id));
    });
  };
  draw();
}

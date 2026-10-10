/**
 * Stored notices plus live operational alerts.
 * Low stock, expiry, and overdue orders are computed so they stay current.
 */
import { db } from './db.js';
import { dateKey, todayKey, parseDate } from './utils.js';

const DISMISS_KEY = 'godamly_dismissed_alerts';

function onHand(productId) {
  return db.getAll('stock')
    .filter((row) => row.productId === productId)
    .reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
}

function dismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveDismissed(set) {
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...set]));
}

function pruneDismissed(activeIds) {
  const set = dismissed();
  let changed = false;
  [...set].forEach((id) => {
    if (!activeIds.has(id)) {
      set.delete(id);
      changed = true;
    }
  });
  if (changed) saveDismissed(set);
  return set;
}

export function buildAlerts() {
  const settings = db.getSettings();
  const fallback = Number(settings.lowStockThreshold ?? 10);
  const today = todayKey();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 30);
  const alerts = [];

  db.getAll('products').filter((p) => p.status !== 'inactive').forEach((product) => {
    const qty = onHand(product.id);
    const reorder = Number(product.reorderLevel ?? fallback);
    if (qty <= 0) {
      alerts.push({
        id: `out:${product.id}`,
        kind: 'alert',
        level: 'danger',
        title: 'Out of stock',
        message: `${product.sku} · ${product.name} has no units on hand.`,
        href: `#/products?focus=${product.id}`,
        createdAt: new Date().toISOString(),
      });
    } else if (qty <= reorder) {
      alerts.push({
        id: `low:${product.id}`,
        kind: 'alert',
        level: 'warning',
        title: 'Low stock',
        message: `${product.sku} · ${product.name} has ${qty} on hand (reorder at ${reorder}).`,
        href: `#/products?focus=${product.id}`,
        createdAt: new Date().toISOString(),
      });
    }
    if (product.expiryDate) {
      const exp = parseDate(product.expiryDate);
      if (exp && exp <= horizon) {
        const expired = dateKey(exp) < today;
        alerts.push({
          id: `exp:${product.id}`,
          kind: 'alert',
          level: expired ? 'danger' : 'warning',
          title: expired ? 'Expired stock' : 'Near expiry',
          message: `${product.sku} · ${product.name} ${expired ? 'expired' : 'expires'} on ${product.expiryDate}.`,
          href: `#/products?focus=${product.id}`,
          createdAt: new Date().toISOString(),
        });
      }
    }
  });

  db.getAll('purchase_orders').forEach((po) => {
    if (!['ordered', 'partial'].includes(po.status)) return;
    if (po.expectedDate && po.expectedDate < today) {
      alerts.push({
        id: `overdue:${po.id}`,
        kind: 'alert',
        level: 'danger',
        title: 'Overdue purchase order',
        message: `${po.number} was expected on ${po.expectedDate} and is still open.`,
        href: `#/purchase-orders?focus=${po.id}`,
        createdAt: new Date().toISOString(),
      });
    }
  });

  const hidden = pruneDismissed(new Set(alerts.map((alert) => alert.id)));
  return alerts.map((alert) => ({ ...alert, read: hidden.has(alert.id) }));
}

export function listNotifications() {
  const stored = db.getAll('notifications')
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((item) => ({
      id: item.id,
      kind: 'notice',
      level: item.type || 'info',
      title: item.title,
      message: item.message,
      href: item.href || '#/alerts',
      createdAt: item.createdAt,
      read: Boolean(item.read),
    }));
  const alerts = buildAlerts().sort((a, b) => Number(a.read) - Number(b.read));
  return [...alerts, ...stored];
}

export function unreadCount() {
  return listNotifications().filter((item) => !item.read).length;
}

export function markNotificationRead(id) {
  if (String(id).startsWith('ntf_') || db.getById('notifications', id)) {
    const row = db.getById('notifications', id);
    if (row && !row.read) db.update('notifications', id, { read: true });
    return;
  }
  const set = dismissed();
  set.add(id);
  saveDismissed(set);
  window.dispatchEvent(new CustomEvent('godamly:data'));
}

export function markAllNotificationsRead() {
  const set = dismissed();
  buildAlerts().forEach((alert) => set.add(alert.id));
  saveDismissed(set);
  db.getAll('notifications').forEach((item) => {
    if (!item.read) db.update('notifications', item.id, { read: true });
  });
}

export function pushNotice({ title, message, href, type = 'info' }) {
  return db.add('notifications', {
    title,
    message,
    href: href || '#/alerts',
    type,
    read: false,
    createdAt: new Date().toISOString(),
  });
}

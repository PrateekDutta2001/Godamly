/** Hash router with role guards. */
import { can } from './auth.js';
import { esc } from './utils.js';
import { toast } from '../components/toast.js';
import * as dashboard from '../modules/dashboard.js';
import * as products from '../modules/products.js';
import * as categories from '../modules/categories.js';
import * as suppliers from '../modules/suppliers.js';
import * as customers from '../modules/customers.js';
import * as warehouses from '../modules/warehouses.js';
import * as purchaseOrders from '../modules/purchase-orders.js';
import * as salesOrders from '../modules/sales-orders.js';
import * as stockMovements from '../modules/stock-movements.js';
import * as stockTake from '../modules/stock-take.js';
import * as reports from '../modules/reports.js';
import * as users from '../modules/users.js';
import * as audit from '../modules/audit.js';
import * as settings from '../modules/settings.js';
import * as profile from '../modules/profile.js';
import * as alerts from '../modules/alerts.js';

export const ROUTES = {
  dashboard: { title: 'Dashboard', perm: 'dashboard.view', render: dashboard.render },
  products: { title: 'Products', perm: 'products.view', render: products.render },
  categories: { title: 'Categories & units', perm: 'catalog.manage', render: categories.render },
  suppliers: { title: 'Suppliers', perm: 'suppliers.manage', render: suppliers.render },
  customers: { title: 'Customers', perm: 'customers.manage', render: customers.render },
  warehouses: { title: 'Warehouses', perm: 'warehouses.manage', render: warehouses.render },
  'purchase-orders': { title: 'Purchase orders', perm: 'po.manage', render: purchaseOrders.render },
  'sales-orders': { title: 'Sales orders', perm: 'so.view', render: salesOrders.render },
  'stock-movements': { title: 'Stock movements', perm: 'stock.move', render: stockMovements.render },
  'stock-take': { title: 'Stock take', perm: 'stocktake.manage', render: stockTake.render },
  reports: { title: 'Reports', perm: 'reports.view', render: reports.render },
  alerts: { title: 'Alerts', perm: 'alerts.view', render: alerts.render },
  users: { title: 'Users', perm: 'users.manage', render: users.render },
  audit: { title: 'Audit log', perm: 'audit.view', render: audit.render },
  settings: { title: 'Settings', perm: 'settings.manage', render: settings.render },
  profile: { title: 'Profile', perm: 'profile.view', render: profile.render },
};

function skeleton() {
  return `<div class="skeleton-page" aria-hidden="true">
    <div class="skeleton sk-title"></div>
    <div class="skeleton-grid">${'<div class="skeleton sk-card"></div>'.repeat(4)}</div>
  </div>`;
}

export function currentPath() {
  const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  return (raw.split('?')[0] || 'dashboard').toLowerCase();
}

export function startRouter(onRoute) {
  let view = document.getElementById('view');
  async function resolve() {
    const path = currentPath();
    const route = ROUTES[path];
    const next = document.createElement('main');
    next.id = 'view';
    next.className = 'view';
    next.tabIndex = -1;
    view.replaceWith(next);
    view = next;
    if (!route) {
      next.innerHTML = `<section class="page"><div class="card empty"><h1>Page not found</h1><p class="muted">That address is not part of Godamly.</p><a class="btn btn-primary" href="#/dashboard">Back to dashboard</a></div></section>`;
      onRoute?.('dashboard', ROUTES.dashboard);
      next.focus();
      return;
    }
    if (!can(route.perm)) {
      toast('You do not have access to that page.', 'error');
      location.hash = '#/dashboard';
      return;
    }
    document.title = `${route.title} · Godamly`;
    onRoute?.(path, route);
    next.innerHTML = skeleton();
    try {
      await route.render(next);
      next.focus();
    } catch (error) {
      next.innerHTML = `<section class="page"><div class="card"><h1>Something went wrong</h1><p class="muted">${esc(error?.message || 'Please reload Godamly.')}</p></div></section>`;
    }
  }
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.hash = '#/dashboard';
  else resolve();
}

import { db } from './core/db.js';
import { configureFormatters, debounce, esc, initials, safeHash } from './core/utils.js';
import { can, currentUser, logout, requireSession, startSessionWatch } from './core/auth.js';
import { icon } from './core/icons.js';
import { pill } from './core/ui.js';
import { listNotifications, markAllNotificationsRead, markNotificationRead, unreadCount } from './core/notifications.js';
import { startRouter } from './core/router.js';
import { store } from './core/store.js';

const NAV = [
  { section: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', perm: 'dashboard.view' },
  ]},
  { section: 'Inventory', items: [
    { id: 'products', label: 'Products', icon: 'box', perm: 'products.view' },
    { id: 'categories', label: 'Categories', icon: 'tag', perm: 'catalog.manage' },
    { id: 'warehouses', label: 'Warehouses', icon: 'warehouse', perm: 'warehouses.manage' },
    { id: 'stock-movements', label: 'Movements', icon: 'history', perm: 'stock.move' },
    { id: 'stock-take', label: 'Stock take', icon: 'clipboard', perm: 'stocktake.manage' },
  ]},
  { section: 'Operations', items: [
    { id: 'purchase-orders', label: 'Purchases', icon: 'truck', perm: 'po.manage' },
    { id: 'sales-orders', label: 'Sales', icon: 'cart', perm: 'so.view' },
    { id: 'suppliers', label: 'Suppliers', icon: 'building', perm: 'suppliers.manage' },
    { id: 'customers', label: 'Customers', icon: 'users', perm: 'customers.manage' },
  ]},
  { section: 'Insight', items: [
    { id: 'reports', label: 'Reports', icon: 'chart', perm: 'reports.view' },
    { id: 'alerts', label: 'Alerts', icon: 'bell', perm: 'alerts.view' },
    { id: 'audit', label: 'Audit log', icon: 'shield', perm: 'audit.view' },
  ]},
  { section: 'Admin', items: [
    { id: 'users', label: 'Users', icon: 'users', perm: 'users.manage' },
    { id: 'settings', label: 'Settings', icon: 'settings', perm: 'settings.manage' },
  ]},
];

function bootMessage(text) {
  const el = document.getElementById('boot-msg');
  if (el) el.textContent = text;
}

function applyTheme(theme, persistSettings) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('godamly_theme', next);
  store.set('theme', next);
  if (persistSettings && can('settings.manage')) {
    const current = db.getSettings();
    if (current.theme !== next) db.saveSettings({ theme: next });
  }
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = icon(next === 'dark' ? 'sun' : 'moon');
    btn.setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
}

function searchItems(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  const push = (href, label, hint) => out.push({ href, label, hint });
  if (can('products.view')) {
    db.getAll('products').forEach((row) => {
      if (`${row.sku} ${row.name} ${row.barcode || ''}`.toLowerCase().includes(q)) push(`#/products?focus=${row.id}`, row.name, row.sku);
    });
  }
  if (can('suppliers.manage')) {
    db.getAll('suppliers').forEach((row) => {
      if (`${row.name} ${row.email || ''}`.toLowerCase().includes(q)) push(`#/suppliers?focus=${row.id}`, row.name, 'Supplier');
    });
  }
  if (can('customers.manage')) {
    db.getAll('customers').forEach((row) => {
      if (`${row.name} ${row.email || ''}`.toLowerCase().includes(q)) push(`#/customers?focus=${row.id}`, row.name, 'Customer');
    });
  }
  if (can('po.manage')) {
    db.getAll('purchase_orders').forEach((row) => {
      if (row.number.toLowerCase().includes(q)) push(`#/purchase-orders?focus=${row.id}`, row.number, 'Purchase order');
    });
  }
  if (can('so.view')) {
    db.getAll('sales_orders').forEach((row) => {
      if (row.number.toLowerCase().includes(q)) push(`#/sales-orders?focus=${row.id}`, row.number, 'Sales order');
    });
  }
  return out.slice(0, 8);
}

function renderShell() {
  const user = currentUser();
  const collapsed = localStorage.getItem('godamly_sidebar') === '1';
  const nav = NAV.map((group) => {
    const items = group.items.filter((item) => can(item.perm));
    if (!items.length) return '';
    return `<p class="nav-section">${esc(group.section)}</p>${items.map((item) => `
      <a class="nav-link" href="#/${item.id}" data-route="${item.id}" title="${esc(item.label)}">
        ${icon(item.icon)}<span class="nav-label">${esc(item.label)}</span>
      </a>`).join('')}`;
  }).join('');
  const app = document.getElementById('app');
  app.className = `app${collapsed ? ' collapsed' : ''}`;
  app.hidden = false;
  app.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">${icon('warehouse')}</div>
        <div class="brand-text"><strong>Godamly</strong><span>Beautifully organised</span></div>
      </div>
      <nav class="side-nav" aria-label="Primary">${nav}</nav>
    </aside>
    <div class="backdrop" id="backdrop"></div>
    <div class="app-main">
      <header class="topbar">
        <button type="button" class="icon-btn" id="nav-toggle" aria-label="Toggle navigation">${icon('menu')}</button>
        <div class="search menu-wrap">
          <span class="search-icon">${icon('search')}</span>
          <input id="global-search" type="search" placeholder="Search products, orders, people" aria-label="Global search" aria-controls="search-results" aria-expanded="false" autocomplete="off" />
          <div id="search-results" class="search-results" hidden role="listbox"></div>
        </div>
        <div class="top-actions">
          <button type="button" class="icon-btn" id="theme-toggle" aria-label="Toggle theme"></button>
          <div class="menu-wrap">
            <button type="button" class="icon-btn icon-wrap" id="bell" aria-label="Notifications" aria-expanded="false" aria-controls="bell-panel">${icon('bell')}<span class="badge" id="bell-badge" hidden>0</span></button>
            <div id="bell-panel" class="dropdown" hidden>
              <header><strong>Notifications</strong><button type="button" class="linkish" id="mark-read">Mark all read</button></header>
              <div class="notice-list" id="notice-list"></div>
              <footer><a href="#/alerts">View all alerts</a></footer>
            </div>
          </div>
          <div class="menu-wrap">
            <button type="button" class="user-chip" id="user-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu">
              <span class="avatar avatar-fallback">${esc(initials(user?.fullName))}</span>
              <span class="user-meta desktop-only"><strong>${esc(user?.fullName || '')}</strong><small>${esc(user?.role || '')}</small></span>
            </button>
            <div id="user-menu" class="dropdown user-menu" hidden role="menu">
              <a href="#/profile" role="menuitem">${icon('user')} Profile</a>
              <button type="button" id="logout" role="menuitem">${icon('logout')} Sign out</button>
            </div>
          </div>
        </div>
      </header>
      <main id="view" class="view" tabindex="-1"></main>
      <footer class="app-footer">© 2026 Prateek Dutta. All rights reserved.</footer>
    </div>`;
  applyTheme(store.get('theme') || localStorage.getItem('godamly_theme') || 'light', false);
  bindShell();
  refreshChrome();
}

function closePopovers() {
  document.getElementById('search-results').hidden = true;
  document.getElementById('global-search').setAttribute('aria-expanded', 'false');
  document.getElementById('bell-panel').hidden = true;
  document.getElementById('bell').setAttribute('aria-expanded', 'false');
  document.getElementById('user-menu').hidden = true;
  document.getElementById('user-btn').setAttribute('aria-expanded', 'false');
}

function refreshChrome() {
  const badge = document.getElementById('bell-badge');
  const count = unreadCount();
  badge.hidden = count === 0;
  badge.textContent = String(count);
  document.getElementById('bell').setAttribute('aria-label', count ? `${count} unread notifications` : 'Notifications');
  const items = listNotifications().slice(0, 8);
  const list = document.getElementById('notice-list');
  list.innerHTML = items.length ? items.map((item) => `
    <a class="notice ${item.read ? 'read' : ''}" href="${safeHash(item.href)}" data-note="${esc(item.id)}">
      <strong>${esc(item.title)}</strong>
      <span>${esc(item.message)}</span>
    </a>`).join('') : `<p class="muted" style="padding:14px">You are all caught up.</p>`;
  const user = currentUser();
  const chip = document.querySelector('#user-btn strong');
  if (chip && user) chip.textContent = user.fullName;
}

function bindShell() {
  const app = document.getElementById('app');
  document.getElementById('nav-toggle').addEventListener('click', () => {
    const mobile = window.matchMedia('(max-width: 960px)').matches;
    if (mobile) app.classList.toggle('nav-open');
    else {
      app.classList.toggle('collapsed');
      localStorage.setItem('godamly_sidebar', app.classList.contains('collapsed') ? '1' : '0');
    }
  });
  document.getElementById('backdrop').addEventListener('click', () => app.classList.remove('nav-open'));
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  });
  document.getElementById('bell').addEventListener('click', (event) => {
    event.stopPropagation();
    const panel = document.getElementById('bell-panel');
    panel.hidden = !panel.hidden;
    document.getElementById('bell').setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    document.getElementById('user-menu').hidden = true;
  });
  document.getElementById('user-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = document.getElementById('user-menu');
    menu.hidden = !menu.hidden;
    document.getElementById('user-btn').setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    document.getElementById('bell-panel').hidden = true;
  });
  document.getElementById('mark-read').addEventListener('click', () => {
    markAllNotificationsRead();
    refreshChrome();
  });
  document.getElementById('notice-list').addEventListener('click', (event) => {
    const link = event.target.closest('[data-note]');
    if (!link) return;
    markNotificationRead(link.dataset.note);
    closePopovers();
    app.classList.remove('nav-open');
  });
  document.getElementById('logout').addEventListener('click', () => logout('manual'));
  const search = document.getElementById('global-search');
  const results = document.getElementById('search-results');
  const paintSearch = () => {
    const items = searchItems(search.value);
    results.hidden = !search.value.trim() || document.activeElement !== search && results.hidden;
    if (search.value.trim().length < 2) {
      results.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      return;
    }
    results.hidden = false;
    search.setAttribute('aria-expanded', 'true');
    results.innerHTML = items.length ? items.map((item) => `
      <a href="${safeHash(item.href)}"><span>${esc(item.label)}<small>${esc(item.hint)}</small></span></a>`).join('') : `<p class="muted" style="padding:12px">No matches.</p>`;
  };
  search.addEventListener('input', debounce(paintSearch, 150));
  search.addEventListener('focus', paintSearch);
  results.addEventListener('click', () => {
    closePopovers();
    app.classList.remove('nav-open');
    search.value = '';
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-wrap') && !event.target.closest('.search')) closePopovers();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopovers();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      search.focus();
    }
  });
  window.addEventListener('godamly:data', refreshChrome);
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => app.classList.remove('nav-open'));
  });
}

function highlight(path) {
  document.querySelectorAll('.nav-link').forEach((link) => {
    const on = link.dataset.route === path;
    link.classList.toggle('active', on);
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  refreshChrome();
}

if (location.protocol === 'file:') {
  bootMessage('Run start.bat in the wms folder, then open http://localhost:5500');
} else {
  try {
    await db.init();
    configureFormatters(() => db.getSettings());
    if (!requireSession()) {
      location.replace('login.html');
    } else {
      const settings = db.getSettings();
      const theme = localStorage.getItem('godamly_theme') || settings.theme || 'light';
      store.set('theme', theme);
      applyTheme(theme, false);
      document.getElementById('boot')?.remove();
      renderShell();
      startSessionWatch();
      startRouter(highlight);
    }
  } catch (error) {
    bootMessage(error.message || 'Godamly could not start. Use start.bat so seed data can load.');
  }
}

void pill;

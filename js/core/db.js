/**
 * Godamly data access.
 * Seed JSON is fetched once and stored in localStorage. Every later read and
 * write goes through this module. Transactions and the audit log are immutable.
 */
import { uid } from './utils.js';

const STORAGE_KEY = 'godamly_db_v1';

const SEED_FILES = {
  users: 'users.json',
  products: 'products.json',
  categories: 'categories.json',
  units: 'units.json',
  suppliers: 'suppliers.json',
  customers: 'customers.json',
  warehouses: 'warehouses.json',
  stock: 'stock.json',
  purchase_orders: 'purchase_orders.json',
  sales_orders: 'sales_orders.json',
  transactions: 'transactions.json',
  audit_log: 'audit_log.json',
  notifications: 'notifications.json',
  stock_takes: 'stock_takes.json',
  counters: 'counters.json',
  settings: 'settings.json',
};

const ARRAY_KEYS = Object.keys(SEED_FILES).filter((k) => k !== 'settings');
const IMMUTABLE = new Set(['transactions', 'audit_log']);
const PREFIX = {
  users: 'usr',
  products: 'prd',
  categories: 'cat',
  units: 'unt',
  suppliers: 'sup',
  customers: 'cus',
  warehouses: 'wh',
  stock: 'stk',
  purchase_orders: 'po',
  sales_orders: 'so',
  transactions: 'txn',
  audit_log: 'aud',
  notifications: 'ntf',
  stock_takes: 'st',
  counters: 'ctr',
};

let memory = null;
let batchDepth = 0;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function emit() {
  window.dispatchEvent(new CustomEvent('godamly:data'));
}

function persist() {
  if (batchDepth > 0) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    throw new Error('Browser storage is full. Export a backup, then remove large images or reset to seed data.');
  }
  emit();
}

function ensureShape() {
  ARRAY_KEYS.forEach((key) => {
    if (!Array.isArray(memory[key])) memory[key] = [];
  });
  if (!memory.settings || typeof memory.settings !== 'object' || Array.isArray(memory.settings)) {
    memory.settings = {};
  }
  if (!memory.meta || typeof memory.meta !== 'object') memory.meta = { version: 1 };
  if (!memory.counters.some((row) => row.id === 'main')) {
    memory.counters.push({ id: 'main', sku: 1030, po: 1006, so: 1006, st: 1002, grn: 1002 });
  }
}

async function loadSeed() {
  const entries = await Promise.all(
    Object.entries(SEED_FILES).map(async ([key, file]) => {
      const url = new URL(`../../data/${file}`, import.meta.url);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load seed file data/${file}.`);
      return [key, await res.json()];
    }),
  );
  const data = Object.fromEntries(entries);
  data.meta = { version: 1, seededAt: new Date().toISOString() };
  return data;
}

function assertArray(name) {
  if (!ARRAY_KEYS.includes(name)) throw new Error(`Unknown collection "${name}".`);
  if (!Array.isArray(memory[name])) memory[name] = [];
}

export const db = {
  async init() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        memory = JSON.parse(raw);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        memory = null;
      }
    }
    if (!memory) memory = await loadSeed();
    ensureShape();
    persist();
    return this;
  },

  exportAll() {
    return clone(memory);
  },

  importAll(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('That file is not a Godamly backup.');
    }
    ARRAY_KEYS.forEach((key) => {
      if (!Array.isArray(data[key])) throw new Error(`Backup is missing a ${key.split('_').join(' ')} list.`);
    });
    if (!data.settings || typeof data.settings !== 'object') throw new Error('Backup is missing settings.');
    const admins = data.users.filter((u) => u.role === 'admin' && u.status !== 'inactive' && u.passwordHash && u.salt);
    if (!admins.length) throw new Error('Backup must include an active admin with a password hash.');
    const snap = clone(memory);
    try {
      memory = clone(data);
      memory.meta = { ...(memory.meta || {}), version: 1, importedAt: new Date().toISOString() };
      ensureShape();
      persist();
    } catch (error) {
      memory = snap;
      persist();
      throw error;
    }
  },

  async reset() {
    memory = await loadSeed();
    ensureShape();
    persist();
  },

  getAll(name) {
    assertArray(name);
    return clone(memory[name]);
  },

  getById(name, id) {
    assertArray(name);
    const row = memory[name].find((item) => item.id === id);
    return row ? clone(row) : null;
  },

  query(name, predicate) {
    return this.getAll(name).filter(predicate);
  },

  add(name, record) {
    assertArray(name);
    const now = new Date().toISOString();
    const row = { ...clone(record) };
    if (!row.id) row.id = uid(PREFIX[name] || 'id');
    if (IMMUTABLE.has(name)) {
      if (!row.createdAt) row.createdAt = now;
      if (!row.date) row.date = now;
    } else {
      if (!row.createdAt) row.createdAt = now;
      row.updatedAt = now;
    }
    memory[name].push(row);
    persist();
    return clone(row);
  },

  update(name, id, patch) {
    assertArray(name);
    if (IMMUTABLE.has(name)) throw new Error('Ledger entries cannot be changed.');
    const index = memory[name].findIndex((item) => item.id === id);
    if (index < 0) throw new Error('Record not found.');
    const prev = memory[name][index];
    memory[name][index] = {
      ...prev,
      ...clone(patch),
      id: prev.id,
      createdAt: prev.createdAt,
      updatedAt: new Date().toISOString(),
    };
    persist();
    return clone(memory[name][index]);
  },

  remove(name, id) {
    assertArray(name);
    if (IMMUTABLE.has(name)) throw new Error('Ledger entries cannot be deleted.');
    const index = memory[name].findIndex((item) => item.id === id);
    if (index < 0) throw new Error('Record not found.');
    const [removed] = memory[name].splice(index, 1);
    persist();
    return clone(removed);
  },

  getSettings() {
    return clone(memory.settings);
  },

  saveSettings(patch) {
    const next = { ...memory.settings, ...clone(patch) };
    if (patch && patch.company) {
      next.company = { ...(memory.settings.company || {}), ...clone(patch.company) };
    }
    memory.settings = next;
    persist();
    return clone(memory.settings);
  },

  /**
   * Run several writes as one change. A thrown error restores the previous data.
   * Do not nest batches.
   */
  batch(fn) {
    if (batchDepth > 0) return fn();
    const snap = JSON.stringify(memory);
    batchDepth = 1;
    try {
      const result = fn();
      batchDepth = 0;
      persist();
      return result;
    } catch (error) {
      batchDepth = 0;
      memory = JSON.parse(snap);
      try {
        persist();
      } catch {
        /* storage full while restoring */
      }
      throw error;
    }
  },

  nextNumber(kind) {
    const counters = memory.counters.find((row) => row.id === 'main');
    if (!counters) throw new Error('Number sequence is missing.');
    const current = Number(counters[kind] || 1000) + 1;
    counters[kind] = current;
    counters.updatedAt = new Date().toISOString();
    persist();
    const year = new Date().getFullYear();
    const n = String(current).padStart(4, '0');
    const prefix = memory.settings.skuPrefix || 'GDM';
    if (kind === 'sku') return `${prefix}-${n}`;
    if (kind === 'po') return `PO-${year}-${n}`;
    if (kind === 'so') return `SO-${year}-${n}`;
    if (kind === 'st') return `ST-${year}-${n}`;
    if (kind === 'grn') return `GRN-${year}-${n}`;
    return `${String(kind).toUpperCase()}-${year}-${n}`;
  },
};

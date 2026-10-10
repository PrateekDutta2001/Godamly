/**
 * Session, password hashing, lockout, and role checks.
 * Passwords are SHA-256(salt + ":" + password) via Web Crypto. Plain text is never stored.
 */
import { db } from './db.js';
import { logAudit } from './audit.js';
import { passwordIssues, isEmail, isUsername } from './validators.js';

const SESSION_KEY = 'godamly_session';
const LOCK_KEY = 'godamly_lockout';
const IDLE_MS = 30 * 60 * 1000;
const LOCK_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const MATRIX = {
  'dashboard.view': ['admin', 'manager', 'staff'],
  'products.view': ['admin', 'manager', 'staff'],
  'products.edit': ['admin', 'manager'],
  'catalog.manage': ['admin', 'manager'],
  'suppliers.manage': ['admin', 'manager'],
  'customers.manage': ['admin', 'manager'],
  'warehouses.manage': ['admin', 'manager'],
  'po.manage': ['admin', 'manager'],
  'so.view': ['admin', 'manager', 'staff'],
  'so.create': ['admin', 'manager', 'staff'],
  'stock.move': ['admin', 'manager', 'staff'],
  'stocktake.manage': ['admin', 'manager'],
  'reports.view': ['admin', 'manager'],
  'alerts.view': ['admin', 'manager', 'staff'],
  'users.manage': ['admin'],
  'audit.view': ['admin', 'manager'],
  'settings.manage': ['admin'],
  'profile.view': ['admin', 'manager', 'staff'],
};

function readStore(remember) {
  return remember ? localStorage : sessionStorage;
}

export function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(session) {
  const raw = JSON.stringify(session);
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  readStore(session.remember).setItem(SESSION_KEY, raw);
}

function lockMap() {
  try {
    return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLocks(map) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(map));
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
  return sha256(`${salt}:${password}`);
}

export function currentUser() {
  const session = readSession();
  if (!session?.userId) return null;
  if (Date.now() - Number(session.lastActivity || 0) > IDLE_MS) return null;
  const user = db.getById('users', session.userId);
  if (!user || user.status === 'inactive') return null;
  return user;
}

export function can(permission) {
  const user = currentUser();
  if (!user) return false;
  const roles = MATRIX[permission];
  return Array.isArray(roles) && roles.includes(user.role);
}

export function findUserByLogin(identifier) {
  const key = String(identifier || '').trim().toLowerCase();
  return db.getAll('users').find((u) => u.username.toLowerCase() === key || u.email.toLowerCase() === key) || null;
}

function lockStatus(identifier) {
  const key = String(identifier || '').trim().toLowerCase();
  const map = lockMap();
  const rec = map[key] || { attempts: 0, lockedUntil: 0 };
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
    return { locked: true, seconds: Math.ceil((rec.lockedUntil - Date.now()) / 1000), map, key, rec };
  }
  if (rec.lockedUntil && Date.now() >= rec.lockedUntil) {
    rec.attempts = 0;
    rec.lockedUntil = 0;
    map[key] = rec;
    saveLocks(map);
  }
  return { locked: false, seconds: 0, map, key, rec };
}

export function loginLockSeconds(identifier) {
  return lockStatus(identifier).seconds;
}

export async function login({ identifier, password, remember }) {
  const id = String(identifier || '').trim();
  const status = lockStatus(id);
  if (status.locked) {
    throw new Error(`Too many attempts. Try again in ${status.seconds} seconds.`);
  }
  const user = findUserByLogin(id);
  const hash = user ? await hashPassword(password, user.salt) : '';
  const ok = Boolean(user && user.status !== 'inactive' && hash === user.passwordHash);
  if (!ok) {
    status.rec.attempts = Number(status.rec.attempts || 0) + 1;
    if (status.rec.attempts >= MAX_ATTEMPTS) {
      status.rec.lockedUntil = Date.now() + LOCK_MS;
      status.rec.attempts = 0;
      status.map[status.key] = status.rec;
      saveLocks(status.map);
      logAudit('login_failed', 'session', user?.id || '', `Locked sign-in after repeated failures for "${id}"`);
      throw new Error('Too many attempts. Try again in 60 seconds.');
    }
    status.map[status.key] = status.rec;
    saveLocks(status.map);
    logAudit('login_failed', 'session', user?.id || '', `Failed sign-in for "${id}"`);
    const left = MAX_ATTEMPTS - status.rec.attempts;
    throw new Error(user && user.status === 'inactive'
      ? 'This account is disabled. Ask an admin to reactivate it.'
      : `Invalid username or password. ${left} attempt${left === 1 ? '' : 's'} left.`);
  }
  delete status.map[status.key];
  saveLocks(status.map);
  const session = {
    token: crypto.randomUUID(),
    userId: user.id,
    remember: Boolean(remember),
    lastActivity: Date.now(),
  };
  writeSession(session);
  db.update('users', user.id, { lastLogin: new Date().toISOString() });
  logAudit('login', 'session', user.id, 'Signed in', user);
  return db.getById('users', user.id);
}

export function logout(reason = 'manual') {
  const user = (() => {
    try {
      const session = readSession();
      return session ? db.getById('users', session.userId) : null;
    } catch {
      return null;
    }
  })();
  if (user) logAudit('logout', 'session', user.id, reason === 'timeout' ? 'Signed out after inactivity' : 'Signed out', user);
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  if (reason === 'timeout') sessionStorage.setItem('godamly_flash', 'You were signed out after 30 minutes of inactivity.');
  location.href = 'login.html';
}

export function consumeFlash() {
  const message = sessionStorage.getItem('godamly_flash');
  sessionStorage.removeItem('godamly_flash');
  return message || '';
}

export async function registerUser({ fullName, email, username, password, role, actor }) {
  const name = String(fullName || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const userName = String(username || '').trim().toLowerCase();
  const issues = passwordIssues(password);
  if (!name) throw new Error('Full name is required.');
  if (!isEmail(mail)) throw new Error('Enter a valid email address.');
  if (!isUsername(userName)) throw new Error('Username must be 3–24 characters and use letters, numbers, dots, underscores, or hyphens.');
  if (issues.length) throw new Error(`Password needs ${issues.join(', ')}.`);
  const users = db.getAll('users');
  if (users.some((u) => u.username.toLowerCase() === userName)) throw new Error('That username is already in use.');
  if (users.some((u) => u.email.toLowerCase() === mail)) throw new Error('That email is already in use.');
  const resolvedRole = users.length === 0 ? 'admin' : role;
  if (!['admin', 'manager', 'staff'].includes(resolvedRole)) throw new Error('Choose a valid role.');
  const salt = makeSalt();
  const passwordHash = await hashPassword(password, salt);
  const created = db.add('users', {
    fullName: name,
    email: mail,
    username: userName,
    passwordHash,
    salt,
    role: resolvedRole,
    status: 'active',
    phone: '',
    lastLogin: null,
  });
  logAudit('create', 'user', created.id, `Created user ${created.username} (${created.role})`, actor || created);
  return created;
}

export async function setPassword(userId, password, actor) {
  const issues = passwordIssues(password);
  if (issues.length) throw new Error(`Password needs ${issues.join(', ')}.`);
  const salt = makeSalt();
  const passwordHash = await hashPassword(password, salt);
  const updated = db.update('users', userId, { salt, passwordHash });
  logAudit('password', 'user', userId, `Password reset for ${updated.username}`, actor || updated);
  return updated;
}

let watchStarted = false;

export function startSessionWatch() {
  if (watchStarted) return;
  watchStarted = true;
  let lastWrite = Date.now();
  const bump = () => {
    const now = Date.now();
    if (now - lastWrite < 10000) return;
    const session = readSession();
    if (!session) return;
    if (now - Number(session.lastActivity || 0) > IDLE_MS) {
      logout('timeout');
      return;
    }
    session.lastActivity = now;
    lastWrite = now;
    writeSession(session);
  };
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach((eventName) => {
    window.addEventListener(eventName, bump, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkIdle();
  });
  window.setInterval(checkIdle, 15000);
}

function checkIdle() {
  const session = readSession();
  if (!session) return;
  if (Date.now() - Number(session.lastActivity || 0) > IDLE_MS) logout('timeout');
}

export function requireSession() {
  const session = readSession();
  if (!session) return false;
  if (Date.now() - Number(session.lastActivity || 0) > IDLE_MS) {
    logout('timeout');
    return false;
  }
  const user = db.getById('users', session.userId);
  if (!user || user.status === 'inactive') {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    return false;
  }
  session.lastActivity = Date.now();
  writeSession(session);
  return true;
}

import { db } from './core/db.js';
import { registerUser, requireSession } from './core/auth.js';
import { applyErrors } from './core/ui.js';
import { isEmail, isUsername, passwordIssues, passwordScore, passwordLabel } from './core/validators.js';

const form = document.getElementById('signup-form');
const password = document.getElementById('password');
const meter = document.getElementById('meter');
const strength = document.getElementById('strength-label');
const toggle = document.getElementById('toggle-password');

toggle.addEventListener('click', () => {
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  toggle.textContent = show ? 'Hide' : 'Show';
  toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
  toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

password.addEventListener('input', () => {
  const score = passwordScore(password.value);
  meter.dataset.score = String(score);
  const issues = passwordIssues(password.value);
  strength.textContent = password.value
    ? `${passwordLabel(score)}.${issues.length ? ` Still need ${issues.join(', ')}.` : ''}`
    : 'Use 8+ characters with upper, lower, number, and symbol.';
});

if (location.protocol === 'file:') {
  document.getElementById('submit').disabled = true;
}

try {
  await db.init();
  if (requireSession()) location.replace('app.html');
  if (!db.getAll('users').length) {
    document.getElementById('first-note').hidden = false;
    document.getElementById('role-field').hidden = true;
  }
} catch (error) {
  applyErrors(form, { role: error.message || 'Seed data could not be loaded.' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fullName = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim().toLowerCase();
  const username = document.getElementById('username').value.trim().toLowerCase();
  const confirm = document.getElementById('confirm').value;
  const role = form.querySelector('input[name="role"]:checked')?.value || 'staff';
  const users = db.getAll('users');
  const errors = {};
  if (!fullName) errors.fullName = 'Full name is required.';
  if (!isEmail(email)) errors.email = 'Enter a valid email address.';
  else if (users.some((user) => user.email.toLowerCase() === email)) errors.email = 'That email is already in use.';
  if (!isUsername(username)) errors.username = 'Use 3–24 letters, numbers, dots, underscores, or hyphens.';
  else if (users.some((user) => user.username.toLowerCase() === username)) errors.username = 'That username is already in use.';
  const issues = passwordIssues(password.value);
  if (issues.length) errors.password = `Password needs ${issues.join(', ')}.`;
  if (confirm !== password.value) errors.confirm = 'Passwords do not match.';
  if (!applyErrors(form, errors)) return;
  const button = document.getElementById('submit');
  button.disabled = true;
  try {
    await registerUser({ fullName, email, username, password: password.value, role });
    sessionStorage.setItem('godamly_flash', 'Account created. Sign in with your new username.');
    location.href = 'login.html';
  } catch (error) {
    applyErrors(form, { role: error.message || 'Could not create the account.' });
    button.disabled = false;
  }
});

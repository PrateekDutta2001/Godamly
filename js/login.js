import { db } from './core/db.js';
import { requireSession, login, loginLockSeconds, consumeFlash } from './core/auth.js';
import { applyErrors } from './core/ui.js';
import { toast } from './components/toast.js';

const form = document.getElementById('login-form');
const toggle = document.getElementById('toggle-password');
const password = document.getElementById('password');

toggle.addEventListener('click', () => {
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  toggle.textContent = show ? 'Hide' : 'Show';
  toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
  toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

if (location.protocol === 'file:') {
  form.querySelector('button[type="submit"]').disabled = true;
  applyErrors(form, { form: 'Run start.bat in the wms folder, then open http://localhost:5500' });
}

try {
  await db.init();
  if (requireSession()) location.replace('app.html');
} catch (error) {
  applyErrors(form, { form: error.message || 'Seed data could not be loaded.' });
}

const flash = consumeFlash();
if (flash) toast(flash, 'info', 6000);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const identifier = document.getElementById('identifier').value.trim();
  const errors = {};
  if (!identifier) errors.identifier = 'Enter your username or email.';
  if (!password.value) errors.password = 'Enter your password.';
  const locked = identifier ? loginLockSeconds(identifier) : 0;
  if (locked) errors.form = `Too many attempts. Try again in ${locked} seconds.`;
  if (!applyErrors(form, errors)) return;
  const button = document.getElementById('submit');
  button.disabled = true;
  try {
    await login({
      identifier,
      password: password.value,
      remember: document.getElementById('remember').checked,
    });
    location.href = 'app.html';
  } catch (error) {
    applyErrors(form, { form: error.message || 'Sign-in failed.' });
    button.disabled = false;
  }
});

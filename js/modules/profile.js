import { db } from '../core/db.js';
import { currentUser, hashPassword } from '../core/auth.js';
import { logAudit } from '../core/audit.js';
import { applyErrors, field, pageHeader } from '../core/ui.js';
import { toast } from '../components/toast.js';
import { isEmail, passwordIssues } from '../core/validators.js';

export function render(root) {
  const user = currentUser();
  root.innerHTML = `<section class="page">
    ${pageHeader({ kicker: 'Account', title: 'Your profile', subtitle: user.email })}
    <div class="split">
      <form class="card" id="profile-form" novalidate>
        <h2>Details</h2>
        ${field({ id: 'fullName', label: 'Full name', value: user.fullName, required: true })}
        ${field({ id: 'email', label: 'Email', type: 'email', value: user.email, required: true })}
        ${field({ id: 'phone', label: 'Phone', value: user.phone || '' })}
        ${field({ id: 'username', label: 'Username', value: user.username, required: true })}
        <button class="btn btn-primary" type="submit">Save profile</button>
      </form>
      <form class="card" id="password-form" novalidate>
        <h2>Change password</h2>
        ${field({ id: 'current', label: 'Current password', type: 'password', required: true })}
        ${field({ id: 'next', label: 'New password', type: 'password', required: true })}
        ${field({ id: 'confirm', label: 'Confirm new password', type: 'password', required: true })}
        <button class="btn btn-primary" type="submit">Update password</button>
      </form>
    </div>
  </section>`;

  root.querySelector('#profile-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fullName = form.querySelector('#fullName').value.trim();
    const email = form.querySelector('#email').value.trim().toLowerCase();
    const phone = form.querySelector('#phone').value.trim();
    const username = form.querySelector('#username').value.trim().toLowerCase();
    const errors = {};
    if (!fullName) errors.fullName = 'Full name is required.';
    if (!isEmail(email)) errors.email = 'Enter a valid email.';
    else if (db.getAll('users').some((row) => row.email === email && row.id !== user.id)) errors.email = 'That email is already in use.';
    if (!/^[a-zA-Z0-9._-]{3,24}$/.test(username)) errors.username = 'Use 3–24 letters, numbers, dots, underscores, or hyphens.';
    else if (db.getAll('users').some((row) => row.username === username && row.id !== user.id)) errors.username = 'That username is already in use.';
    if (!applyErrors(form, errors)) return;
    db.update('users', user.id, { fullName, email, phone, username });
    logAudit('update', 'user', user.id, 'Updated own profile');
    toast('Profile saved.');
    const chip = document.querySelector('#user-btn strong');
    if (chip) chip.textContent = fullName;
  });

  root.querySelector('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const current = form.querySelector('#current').value;
    const next = form.querySelector('#next').value;
    const confirm = form.querySelector('#confirm').value;
    const errors = {};
    const fresh = db.getById('users', user.id);
    const currentHash = await hashPassword(current, fresh.salt);
    if (currentHash !== fresh.passwordHash) errors.current = 'Current password is incorrect.';
    const issues = passwordIssues(next);
    if (issues.length) errors.next = `Password needs ${issues.join(', ')}.`;
    if (next !== confirm) errors.confirm = 'Passwords do not match.';
    if (!applyErrors(form, errors)) return;
    const { makeSalt } = await import('../core/auth.js');
    const salt = makeSalt();
    const passwordHash = await hashPassword(next, salt);
    db.update('users', user.id, { salt, passwordHash });
    logAudit('password', 'user', user.id, 'Changed own password');
    form.reset();
    toast('Password updated.');
  });
}

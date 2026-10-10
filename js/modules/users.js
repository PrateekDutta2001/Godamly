import { db } from '../core/db.js';
import { currentUser, registerUser, setPassword } from '../core/auth.js';
import { logAudit } from '../core/audit.js';
import { esc, formatDate } from '../core/utils.js';
import { applyErrors, field, pageHeader, pill, selectField } from '../core/ui.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { isEmail, isUsername, passwordIssues } from '../core/validators.js';

export function render(root) {
  const draw = () => {
    const users = db.getAll('users').sort((a, b) => a.fullName.localeCompare(b.fullName));
    root.innerHTML = `<section class="page">
      ${pageHeader({
        kicker: 'Access',
        title: 'Users',
        subtitle: 'Admins can add people, change roles, and reset passwords.',
        actions: '<button type="button" class="btn btn-primary" id="add">Add user</button>',
      })}
      <div class="card"><div class="table-wrap"><table class="data-table responsive"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
        ${users.map((user) => `<tr>
          <td data-label="Name"><strong>${esc(user.fullName)}</strong><br><span class="muted">${esc(user.email)}</span></td>
          <td data-label="Username">${esc(user.username)}</td>
          <td data-label="Role">${pill(user.role)}</td>
          <td data-label="Status">${pill(user.status || 'active')}</td>
          <td data-label="Last login">${user.lastLogin ? esc(formatDate(user.lastLogin, true)) : '—'}</td>
          <td data-label="Actions" class="row-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(user.id)}">Edit</button>
            <button type="button" class="btn btn-ghost btn-sm" data-reset="${esc(user.id)}">Reset password</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div></div>
    </section>`;
    root.querySelector('#add').addEventListener('click', () => editUser(null, draw));
    root.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => editUser(btn.dataset.edit, draw)));
    root.querySelectorAll('[data-reset]').forEach((btn) => btn.addEventListener('click', () => resetPassword(btn.dataset.reset)));
  };
  draw();
}

function activeAdmins(exceptId) {
  return db.getAll('users').filter((user) => user.role === 'admin' && user.status !== 'inactive' && user.id !== exceptId);
}

function editUser(id, draw) {
  const row = id ? db.getById('users', id) : { role: 'staff', status: 'active' };
  const me = currentUser();
  openModal({
    title: id ? 'Edit user' : 'New user',
    body: `<form id="user-form" novalidate>
      ${field({ id: 'fullName', label: 'Full name', value: row.fullName || '', required: true })}
      ${field({ id: 'email', label: 'Email', type: 'email', value: row.email || '', required: true })}
      ${field({ id: 'username', label: 'Username', value: row.username || '', required: true })}
      ${field({ id: 'phone', label: 'Phone', value: row.phone || '' })}
      ${id ? '' : field({ id: 'password', label: 'Temporary password', type: 'password', required: true })}
      ${selectField({ id: 'role', label: 'Role', optionsHtml: ['admin', 'manager', 'staff'].map((role) => `<option value="${role}" ${row.role === role ? 'selected' : ''}>${role}</option>`).join('') })}
      ${selectField({ id: 'status', label: 'Status', optionsHtml: `<option value="active" ${row.status !== 'inactive' ? 'selected' : ''}>Active</option><option value="inactive" ${row.status === 'inactive' ? 'selected' : ''}>Inactive</option>` })}
    </form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="user-form" class="btn btn-primary">Save</button>`,
    onMount(dialog) {
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#user-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const fullName = dialog.querySelector('#fullName').value.trim();
        const email = dialog.querySelector('#email').value.trim().toLowerCase();
        const username = dialog.querySelector('#username').value.trim().toLowerCase();
        const phone = dialog.querySelector('#phone').value.trim();
        const role = dialog.querySelector('#role').value;
        const status = dialog.querySelector('#status').value;
        const errors = {};
        if (!fullName) errors.fullName = 'Full name is required.';
        if (!isEmail(email)) errors.email = 'Enter a valid email.';
        else if (db.getAll('users').some((user) => user.email === email && user.id !== id)) errors.email = 'That email is already in use.';
        if (!isUsername(username)) errors.username = 'Use 3–24 letters, numbers, dots, underscores, or hyphens.';
        else if (db.getAll('users').some((user) => user.username === username && user.id !== id)) errors.username = 'That username is already in use.';
        if (!id) {
          const issues = passwordIssues(dialog.querySelector('#password').value);
          if (issues.length) errors.password = `Password needs ${issues.join(', ')}.`;
        }
        if (id && me.id === id && status === 'inactive') errors.status = 'You cannot disable your own account.';
        if (id && row.role === 'admin' && (role !== 'admin' || status === 'inactive') && activeAdmins(id).length === 0) {
          errors.role = 'Keep at least one active admin.';
        }
        if (!applyErrors(dialog, errors)) return;
        try {
          if (!id) {
            await registerUser({ fullName, email, username, password: dialog.querySelector('#password').value, role, actor: me });
            const created = db.getAll('users').find((user) => user.username === username);
            if (created) db.update('users', created.id, { phone, status });
          } else {
            db.update('users', id, { fullName, email, username, phone, role, status });
            logAudit('update', 'user', id, `Updated ${username} (${role}, ${status})`);
          }
          closeModal();
          toast('User saved.');
          draw();
        } catch (error) {
          toast(error.message || 'Could not save the user.', 'error');
        }
      });
    },
  });
}

function resetPassword(id) {
  const row = db.getById('users', id);
  openModal({
    title: `Reset password · ${row.fullName}`,
    body: `<form id="reset-form" novalidate>
      ${field({ id: 'password', label: 'New password', type: 'password', required: true })}
      ${field({ id: 'confirm', label: 'Confirm password', type: 'password', required: true })}
    </form>`,
    footer: `<button type="button" class="btn btn-ghost" id="cancel">Cancel</button><button type="submit" form="reset-form" class="btn btn-primary">Reset</button>`,
    onMount(dialog) {
      dialog.querySelector('#cancel').addEventListener('click', closeModal);
      dialog.querySelector('#reset-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = dialog.querySelector('#password').value;
        const confirm = dialog.querySelector('#confirm').value;
        const errors = {};
        const issues = passwordIssues(password);
        if (issues.length) errors.password = `Password needs ${issues.join(', ')}.`;
        if (password !== confirm) errors.confirm = 'Passwords do not match.';
        if (!applyErrors(dialog, errors)) return;
        const ok = await confirmDialog({ title: 'Reset this password?', message: `${row.fullName} will need the new password on the next sign-in.`, confirmText: 'Reset password' });
        if (!ok) return;
        await setPassword(id, password, currentUser());
        closeModal();
        toast('Password reset.');
      });
    },
  });
}

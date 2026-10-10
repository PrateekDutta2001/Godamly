import { db } from '../core/db.js';
import { dateKey, downloadCSV, esc, formatDate, toCSV } from '../core/utils.js';
import { pageHeader } from '../core/ui.js';
import { mountTable } from '../components/table.js';
import { toast } from '../components/toast.js';

export function render(root) {
  const users = db.getAll('users');
  const state = { q: '', user: 'all', action: 'all', from: '', to: '' };
  root.innerHTML = `<section class="page">
    ${pageHeader({
      kicker: 'Trace',
      title: 'Audit log',
      subtitle: 'Who signed in, and who created, changed, or removed a record.',
      actions: '<button type="button" class="btn btn-ghost" id="export">Export CSV</button>',
    })}
    <div class="card">
      <div class="toolbar">
        <div class="field"><label for="q">Search</label><input id="q" placeholder="Details or record" /></div>
        <div class="field"><label for="user">User</label><select id="user"><option value="all">Everyone</option>${users.map((u) => `<option value="${esc(u.id)}">${esc(u.fullName)}</option>`).join('')}</select></div>
        <div class="field"><label for="action">Action</label><select id="action"><option value="all">All actions</option>
          ${[...new Set(db.getAll('audit_log').map((row) => row.action))].sort().map((action) => `<option value="${esc(action)}">${esc(action)}</option>`).join('')}
        </select></div>
        <div class="field"><label for="from">From</label><input id="from" type="date" /></div>
        <div class="field"><label for="to">To</label><input id="to" type="date" /></div>
      </div>
      <div id="table-host"></div>
    </div>
  </section>`;
  const rows = () => db.getAll('audit_log').filter((row) => {
    const blob = `${row.details} ${row.entity} ${row.userName} ${row.action}`.toLowerCase();
    if (state.q && !blob.includes(state.q.trim().toLowerCase())) return false;
    if (state.user !== 'all' && row.userId !== state.user) return false;
    if (state.action !== 'all' && row.action !== state.action) return false;
    const key = dateKey(row.date);
    if (state.from && key < state.from) return false;
    if (state.to && key > state.to) return false;
    return true;
  });
  const table = mountTable(root.querySelector('#table-host'), {
    columns: [
      { key: 'date', label: 'When', sortable: true, render: (row) => esc(formatDate(row.date, true)) },
      { key: 'userName', label: 'User', sortable: true, render: (row) => esc(row.userName || 'System') },
      { key: 'action', label: 'Action', sortable: true, render: (row) => esc(row.action) },
      { key: 'entity', label: 'Area', sortable: true, render: (row) => esc(row.entity) },
      { key: 'details', label: 'Details', render: (row) => esc(row.details || '—') },
    ],
    rows: rows(),
    rowId: (row) => row.id,
    sortKey: 'date',
    sortDir: 'desc',
    emptyTitle: 'No audit events',
    emptyText: 'Actions will appear here as people use Godamly.',
  });
  const bind = (id, key) => root.querySelector(`#${id}`).addEventListener('input', (event) => { state[key] = event.target.value; table.setRows(rows(), true); });
  bind('q', 'q'); bind('user', 'user'); bind('action', 'action'); bind('from', 'from'); bind('to', 'to');
  root.querySelector('#export').addEventListener('click', () => {
    downloadCSV('godamly-audit.csv', toCSV(rows(), [
      { label: 'When', value: (r) => formatDate(r.date, true) },
      { label: 'User', value: (r) => r.userName },
      { label: 'Action', value: (r) => r.action },
      { label: 'Area', value: (r) => r.entity },
      { label: 'Details', value: (r) => r.details },
    ]));
    toast('Audit log exported.');
  });
}

/** Sortable, paginated data table with optional multi-select. */
import { esc } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { emptyState } from '../core/ui.js';

export function mountTable(container, config) {
  const state = {
    page: 1,
    pageSize: config.pageSize || 10,
    sortKey: config.sortKey || '',
    sortDir: config.sortDir || 'asc',
    selected: new Set(),
    rows: config.rows || [],
  };

  function sorted() {
    const rows = [...state.rows];
    const column = (config.columns || []).find((col) => col.key === state.sortKey);
    if (!column) return rows;
    const dir = state.sortDir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const av = column.sortValue ? column.sortValue(a) : a[column.key];
      const bv = column.sortValue ? column.sortValue(b) : b[column.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true }) * dir;
    });
    return rows;
  }

  function draw() {
    const rows = sorted();
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.pageSize;
    const slice = rows.slice(start, start + state.pageSize);
    const columns = config.columns || [];
    if (!rows.length) {
      container.innerHTML = emptyState({
        title: config.emptyTitle || 'Nothing here yet',
        text: config.emptyText || 'Try another search or add a new record.',
        iconName: config.emptyIcon || 'package',
      });
      return;
    }
    const head = `${config.selectable ? '<th class="check-col"><input type="checkbox" class="js-select-all" aria-label="Select all matching rows" /></th>' : ''}${columns.map((col) => {
      const active = state.sortKey === col.key;
      const aria = !col.sortable ? 'none' : active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" ${col.sortable ? `data-sort="${esc(col.key)}" aria-sort="${aria}"` : ''}>
        ${col.sortable ? `<button type="button" class="th-btn" data-sort="${esc(col.key)}">${esc(col.label)} ${active ? (state.sortDir === 'asc' ? '↑' : '↓') : ''}</button>` : esc(col.label)}
      </th>`;
    }).join('')}`;
    const body = slice.map((row) => {
      const id = config.rowId(row);
      const checked = state.selected.has(id) ? 'checked' : '';
      const cells = columns.map((col) => {
        const html = col.render ? col.render(row) : esc(row[col.key] ?? '');
        return `<td data-label="${esc(col.label)}"${col.align === 'right' ? ' class="num"' : ''}>${html}</td>`;
      }).join('');
      return `<tr data-id="${esc(id)}">
        ${config.selectable ? `<td class="check-col" data-label="Select"><input type="checkbox" class="js-row-check" data-id="${esc(id)}" ${checked} aria-label="Select row" /></td>` : ''}
        ${cells}
      </tr>`;
    }).join('');
    const from = rows.length ? start + 1 : 0;
    const to = Math.min(rows.length, start + state.pageSize);
    container.innerHTML = `<div class="table-wrap">
      <table class="data-table responsive">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="pager">
      <p>Showing ${from}–${to} of ${rows.length}</p>
      <div class="pager-controls">
        <label>Rows
          <select class="js-page-size" aria-label="Rows per page">
            ${[10, 25, 50].map((n) => `<option value="${n}" ${n === state.pageSize ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="btn btn-ghost btn-sm" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>${icon('chevron')} Prev</button>
        <span>Page ${state.page} of ${pages}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-page="next" ${state.page >= pages ? 'disabled' : ''}>Next</button>
      </div>
    </div>`;
    const allBox = container.querySelector('.js-select-all');
    if (allBox) allBox.checked = rows.length > 0 && rows.every((row) => state.selected.has(config.rowId(row)));
  }

  container.addEventListener('click', (event) => {
    const sortBtn = event.target.closest('[data-sort]');
    if (sortBtn && container.contains(sortBtn)) {
      const key = sortBtn.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        state.sortKey = key;
        state.sortDir = 'asc';
      }
      draw();
      return;
    }
    const pageBtn = event.target.closest('[data-page]');
    if (pageBtn && container.contains(pageBtn)) {
      state.page += pageBtn.dataset.page === 'next' ? 1 : -1;
      draw();
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action && container.contains(action)) {
      config.onAction?.(action.dataset.action, action.dataset.id, action);
    }
  });

  container.addEventListener('change', (event) => {
    const target = event.target;
    if (target.classList.contains('js-page-size')) {
      state.pageSize = Number(target.value) || 10;
      state.page = 1;
      draw();
      return;
    }
    if (target.classList.contains('js-select-all')) {
      sorted().forEach((row) => {
        const id = config.rowId(row);
        if (target.checked) state.selected.add(id);
        else state.selected.delete(id);
      });
      draw();
      config.onSelect?.(getSelected());
      return;
    }
    if (target.classList.contains('js-row-check')) {
      if (target.checked) state.selected.add(target.dataset.id);
      else state.selected.delete(target.dataset.id);
      config.onSelect?.(getSelected());
      const allBox = container.querySelector('.js-select-all');
      if (allBox) {
        const rows = sorted();
        allBox.checked = rows.length > 0 && rows.every((row) => state.selected.has(config.rowId(row)));
      }
    }
  });

  function getSelected() {
    return [...state.selected];
  }

  function setRows(rows, resetPage = false) {
    state.rows = rows || [];
    const ids = new Set(state.rows.map((row) => config.rowId(row)));
    [...state.selected].forEach((id) => {
      if (!ids.has(id)) state.selected.delete(id);
    });
    if (resetPage) state.page = 1;
    draw();
  }

  draw();
  return {
    setRows,
    getSelected,
    clear() {
      state.selected.clear();
      draw();
    },
    redraw: draw,
  };
}

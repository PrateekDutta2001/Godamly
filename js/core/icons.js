/** Small inline icon set. Stroke icons inherit currentColor. */

function svg(inner) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

const ICONS = {
  dashboard: svg('<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>'),
  box: svg('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
  tag: svg('<path d="M20 13l-7 7-9-9V4h7l9 9z"/><circle cx="7.5" cy="7.5" r="1"/>'),
  warehouse: svg('<path d="M3 10l9-6 9 6"/><path d="M5 10v9h14v-9"/><path d="M9 19v-5h6v5"/>'),
  truck: svg('<path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>'),
  cart: svg('<circle cx="8" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2l2.2 11h11.3l2-7H7"/>'),
  users: svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-2.8 2.8-4 5.5-4s4.9 1.2 5.5 4"/><circle cx="17" cy="9" r="2.2"/><path d="M16.2 15c1.8.2 3.2 1.2 3.8 3"/>'),
  building: svg('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 7h2M12 7h2M16 7h0M8 11h2M12 11h2M8 15h2M12 15h2M10 21v-3h4v3"/>'),
  chart: svg('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/>'),
  bell: svg('<path d="M6 9a6 6 0 1 1 12 0c0 7 2 7 2 7H4s2 0 2-7"/><path d="M10 19a2 2 0 0 0 4 0"/>'),
  clipboard: svg('<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4.5h6v2H9z"/><path d="M9 11h6M9 15h4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.4 7.6-8 9-4.6-1.4-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-3.5-3.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  download: svg('<path d="M12 4v10"/><path d="M8 10l4 4 4-4"/><path d="M5 19h14"/>'),
  upload: svg('<path d="M12 16V6"/><path d="M8 9l4-4 4 4"/><path d="M5 19h14"/>'),
  printer: svg('<path d="M6 9V4h12v5"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M8 17h8v3H8z"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>'),
  edit: svg('<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M12 6l4 4"/>'),
  eye: svg('<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.5 6.2A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8"/><path d="M6.1 6.8C3.7 8.5 2 12 2 12s4 6 10 6c1.1 0 2.1-.2 3-.5"/><path d="M9.9 9.9a2.5 2.5 0 0 0 3.2 3.2"/>'),
  moon: svg('<path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  logout: svg('<path d="M9 6H6v12h3"/><path d="M10 12h9"/><path d="M16 8l4 4-4 4"/>'),
  user: svg('<circle cx="12" cy="8" r="3.2"/><path d="M5 19c1-3 3.2-4.5 7-4.5S18 16 19 19"/>'),
  alert: svg('<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'),
  check: svg('<path d="M5 12l5 5L20 7"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  filter: svg('<path d="M4 5h16l-6 7v6l-4 2v-8L4 5z"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 16l9 5 9-5"/>'),
  history: svg('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/><path d="M12 8v5l3 2"/>'),
  file: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
  package: svg('<path d="M4 8l8-4 8 4-8 4-8-4z"/><path d="M4 8v8l8 4 8-4V8"/><path d="M12 12v8"/>'),
  arrow: svg('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
};

export function icon(name) {
  return ICONS[name] || '';
}

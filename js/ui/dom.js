// Piccoli helper DOM, icone e formattazione.

export const $ = (s, r = document) => r.querySelector(s);

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** append che ignora null/undefined/false (il metodo nativo li scriverebbe come testo). */
export const put = (el, ...kids) => el.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

const P = {
  jump: '<circle cx="12" cy="4" r="2"/><path d="M12 7v6M12 9l-5-3M12 9l5-6M12 13l-3 4-2 4M12 13l3 3 2 5"/>',
  cmj: '<circle cx="12" cy="4" r="2"/><path d="M12 7v5M12 9l-4 3M12 9l4 3M12 12l-3 4v5M12 12l3 4v5"/>',
  arms: '<circle cx="12" cy="6" r="2"/><path d="M12 9v5M12 10L6 4M12 10l6-6M12 14l-3 4v3M12 14l3 4v3"/>',
  sj: '<circle cx="12" cy="5" r="2"/><path d="M12 8v4M12 9l-4 2M12 9l4 2M12 12l-5 2v6M12 12l5 2v6"/>',
  dj: '<path d="M3 21h18M5 21v-7h6v7"/><circle cx="16" cy="4" r="2"/><path d="M16 7v5M16 9l-3-1M16 9l3-1M16 12l-2 4M16 12l2 4"/>',
  rebound: '<path d="M3 20c2-12 4-12 6 0s4-12 6 0 4-12 6 0"/>',
  free: '<path d="M5 12h14M12 5v14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  rec: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  pause: '<path d="M7 4v16M17 4v16" stroke-width="3"/>',
  prev: '<path d="M15 5l-8 7 8 7M6 5v14"/>',
  next: '<path d="M9 5l8 7-8 7M18 5v14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  check: '<path d="M4 12l6 6L20 6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  flip: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
};
export const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${P[n] || ''}</svg>`;
export const ic = (n, cls) => h('span', { html: icon(n, cls), style: { display: 'inline-flex' } });

export const fmt = {
  num: (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—'),
  ms: (s) => (Number.isFinite(s) ? Math.round(s * 1000) + '' : '—'),
  time: (s) => {
    if (!Number.isFinite(s)) return '—';
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${String(m).padStart(2, '0')}:${r.toFixed(3).padStart(6, '0')}`;
  },
  date: (d) => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
  len: (cm, units) => (units === 'in' ? { v: cm / 2.54, u: 'in' } : { v: cm, u: 'cm' }),
};

let toastTimer;
export function toast(msg, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export function sheet(build) {
  const close = () => scrim.remove();
  const body = h('div', { class: 'sheet' });
  const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(); } }, body);
  build(body, close);
  document.body.append(scrim);
  return close;
}

export function confirmSheet({ title, text, ok = 'Conferma', danger = false }) {
  return new Promise((resolve) => {
    sheet((b, close) => {
      b.append(
        h('h2', { style: { fontSize: '20px', marginBottom: '8px' } }, title),
        h('p', { class: 'muted', style: { margin: '0 0 18px' } }, text),
        h('div', { class: 'grid2' },
          h('button', { class: 'btn', onclick: () => { close(); resolve(false); } }, 'Annulla'),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { close(); resolve(true); } }, ok)),
      );
    });
  });
}

export function downloadFile(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

import { h, icon, ic, sheet, put } from './dom.js';
import { store } from '../store.js';
import { TEST_TYPES } from '../engine/jumps.js';
import { openCamera } from './camera.js';

const TEST_INFO = {
  cmj: { icon: 'cmj', sub: 'Flessione rapida e salto, mani sui fianchi' },
  cmj_arms: { icon: 'arms', sub: 'Con spinta delle braccia' },
  sj: { icon: 'sj', sub: 'Parti da fermo in squat, senza contromovimento' },
  dj: { icon: 'dj', sub: 'Caduta dalla pedana e salto subito: contatto e RSI' },
  rebound: { icon: 'rebound', sub: 'Serie di balzi reattivi: RSI per ogni salto' },
  free: { icon: 'free', sub: 'Qualsiasi salto: rileva tutto' },
};

export const home = {
  render(root, app) {
    const s = store.s, ath = store.athlete();
    root.className = '';
    const grid = h('div', { class: 'tests' });
    const drawTests = () => {
      grid.replaceChildren(...Object.entries(TEST_TYPES).map(([k, t]) =>
        h('button', { class: 'test' + (s.testType === k ? ' sel' : ''), onclick: () => { s.testType = k; store.save(); drawTests(); drawOpts(); } },
          h('span', { html: icon(TEST_INFO[k].icon), style: { display: 'inline-flex' } }),
          h('div', {}, h('b', {}, t.label), h('span', {}, TEST_INFO[k].sub)))));
    };
    const opts = h('div', { class: 'stack', style: { marginTop: '12px' } });
    const drawOpts = () => {
      opts.replaceChildren();
      const legs = h('div', { class: 'seg' }, ...[['both', 'Due gambe'], ['left', 'Sinistra'], ['right', 'Destra']].map(([k, l]) =>
        h('button', { class: s.leg === k ? 'on' : '', onclick: () => { s.leg = k; store.save(); drawOpts(); } }, l)));
      opts.append(legs);
      if (s.testType === 'dj') {
        opts.append(h('div', { class: 'field' }, h('label', {}, 'Altezza pedana (cm) — facoltativa, altrimenti stimata'),
          h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: 'es. 40', value: s.boxCm || '', oninput: (e) => { s.boxCm = Number(e.target.value) || 0; store.save(); } })));
      }
    };
    drawTests(); drawOpts();

    const file = h('input', { type: 'file', accept: 'video/*,.mov,.mp4,.m4v,.webm', class: 'hide', onchange: (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) app.startAnalysis(f); } });
    const last = s.sessions[0];

    put(root,
      h('div', { class: 'top' },
        h('div', { class: 'brand' }, h('i'), 'Jump Lab'),
        h('button', { class: 'chip', onclick: () => app.go('#/profile') }, ic('user'), ath.name)),
      h('div', { class: 'sec', style: { marginTop: 0 } }, 'Tipo di test'),
      grid, opts,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', style: { minHeight: '56px' }, onclick: () => file.click() }, ic('upload'), 'Importa video'),
        h('button', { class: 'btn', style: { minHeight: '56px' }, onclick: () => openCamera(app) }, ic('rec'), 'Registra')),
      file,
      h('div', { class: 'card', style: { marginTop: '16px' } },
        h('h3', {}, 'Per la massima precisione'),
        h('ul', { class: 'tips' },
          h('li', { html: '<b>Slow-motion 240 fps</b> dalla Fotocamera iPhone (Slo-mo) poi “Importa”. A 30 fps l’errore è di diversi cm.' }),
          h('li', { html: '<b>Telefono fermo</b> su un appoggio, all’altezza del bacino, a 2–3 m, <b>ripresa laterale</b>.' }),
          h('li', { html: '<b>Tutto il corpo e i piedi</b> sempre in inquadratura, anche in volo. Scarpe visibili, buona luce.' }),
          h('li', { html: 'Una sola persona nell’inquadratura. Pavimento in contrasto con le scarpe.' })),
        h('button', { class: 'btn sm ghost', style: { marginTop: '10px' }, onclick: () => guide() }, ic('info'), 'Guida alla ripresa')),
      last ? h('div', {},
        h('div', { class: 'sec' }, 'Ultima sessione'),
        h('button', { class: 'item', onclick: () => app.go('#/history/' + last.id) },
          h('div', { class: 'thumb', style: { backgroundImage: last.thumb ? `url(${last.thumb})` : '' } }),
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, TEST_TYPES[last.testType]?.label || last.testType),
            h('div', { class: 'small muted' }, new Date(last.date).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), ' · ', last.jumps.length, last.jumps.length === 1 ? ' salto' : ' salti')),
          h('div', { class: 'val num' }, last.best?.toFixed(1), h('small', {}, ' cm')))) : null,
    );
  },
};

function guide() {
  sheet((b, close) => {
    b.append(
      h('h2', { style: { fontSize: '21px', marginBottom: '12px' } }, 'Come filmare'),
      h('div', { html: `<svg viewBox="0 0 320 150" style="width:100%;border-radius:12px;background:#0b0f13">
        <rect x="0" y="118" width="320" height="32" fill="#182027"/>
        <circle cx="160" cy="34" r="9" fill="#c6f24e"/><path d="M160 44v34M160 52l-14 14M160 52l14 14M160 78l-10 40M160 78l10 40" stroke="#c6f24e" stroke-width="5" stroke-linecap="round" fill="none"/>
        <rect x="262" y="82" width="22" height="36" rx="4" fill="#33404c"/><circle cx="273" cy="100" r="4" fill="#5ec8ff"/>
        <path d="M262 100H178" stroke="#5ec8ff" stroke-dasharray="4 4"/><text x="196" y="94" fill="#8d9aa8" font-size="10">2–3 m</text>
        <text x="262" y="136" fill="#8d9aa8" font-size="9">altezza bacino</text></svg>` }),
      h('ul', { class: 'tips', style: { marginTop: '14px' } },
        h('li', { html: '<b>Slo-mo iPhone:</b> Fotocamera → Slo-mo → 240 fps. Importa il file dalla libreria. Se compare “Opzioni”, scegli <b>Formato: Attuale</b> per non perdere i fotogrammi originali.' }),
        h('li', { html: '<b>Posizione:</b> telefono in orizzontale o verticale, <b>fermo</b>, ripresa di lato (il piano del salto è perpendicolare all’obiettivo).' }),
        h('li', { html: '<b>Inquadratura:</b> lascia margine sopra la testa (braccia alzate) e sotto i piedi. Non zoomare durante il salto.' }),
        h('li', { html: '<b>Abbigliamento:</b> scarpe e pantaloncini ben visibili, niente abiti larghi che coprono ginocchia e caviglie.' }),
        h('li', { html: '<b>Protocollo:</b> resta fermo 1–2 s, poi salta. Atterra sul punto di stacco, con le gambe tese.' })),
      h('button', { class: 'btn primary block', style: { marginTop: '14px' }, onclick: close }, 'Ho capito'),
    );
  });
}

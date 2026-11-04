import { h, icon, ic, put } from './dom.js';
import { store, VERSION } from '../store.js';
import { TEST_TYPES } from '../engine/jumps.js';
import { openCamera } from './camera.js';
import { openGuide } from './guide.js';

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
        h('div', { class: 'testwrap' },
          h('button', { class: 'test' + (s.testType === k ? ' sel' : ''), onclick: () => { s.testType = k; store.save(); drawTests(); drawOpts(); } },
            h('span', { html: icon(TEST_INFO[k].icon), style: { display: 'inline-flex' } }),
            h('div', { style: { paddingRight: '30px' } }, h('b', {}, t.label), h('span', {}, TEST_INFO[k].sub))),
          h('button', { class: 'infobtn', 'aria-label': `Come registrare: ${t.label}`, onclick: () => openGuide(k) }, 'i'))));
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
        h('div', { class: 'brand' }, h('i'), 'Jump Lab', h('small', { class: 'faint', style: { marginLeft: '8px', fontSize: '11px', fontWeight: 600, letterSpacing: '.02em' } }, `v${VERSION}`)),
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
        h('div', { class: 'row', style: { marginTop: '10px', gap: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'btn sm ghost', onclick: () => openGuide('general') }, ic('info'), 'Guida alla ripresa'),
          h('button', { class: 'btn sm ghost', onclick: () => openGuide('slomo') }, ic('info'), 'Registrare a 120/240 fps'))),
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


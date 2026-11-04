import { h, icon, ic, sheet, toast, confirmSheet, downloadFile } from './dom.js';
import { store, VERSION, BUILD } from '../store.js';
import { MODELS, isIOS } from '../engine/pose.js';

export const profile = {
  render(root, app) {
    root.className = '';
    const S = store.s;
    const list = h('div', { class: 'stack' });
    const drawList = () => {
      list.replaceChildren(...S.athletes.map((a) => h('div', { class: 'item' },
        h('button', { class: 'grow', style: { textAlign: 'left' }, onclick: () => { S.currentAthlete = a.id; store.save(); drawList(); } },
          h('div', { style: { fontWeight: 700 } }, a.name, S.currentAthlete === a.id ? h('span', { class: 'chip sel', style: { marginLeft: '8px', padding: '2px 8px', fontSize: '11px' } }, 'attivo') : null),
          h('div', { class: 'small muted' }, `${a.heightCm} cm${a.massKg ? ' · ' + a.massKg + ' kg' : ''}`)),
        h('button', { class: 'iconbtn', onclick: () => editAthlete(a, drawList), html: icon('chev') }))),
        h('button', { class: 'btn ghost block', onclick: () => editAthlete(null, drawList) }, ic('plus'), 'Nuovo atleta'));
    };
    const st = S.settings;
    const select = (label, key, opts, note) => h('div', { class: 'field' }, h('label', {}, label),
      h('select', { class: 'input', onchange: (e) => { st[key] = e.target.value; store.save(); } },
        ...opts.map(([v, l]) => h('option', { value: v, selected: st[key] === v }, l))), note ? h('span', { class: 'tiny faint' }, note) : null);
    root.append(
      h('div', { class: 'top' }, h('div', { class: 'brand' }, 'Profilo')),
      h('div', { class: 'sec', style: { marginTop: 0 } }, 'Atleti'), list,
      h('div', { class: 'sec' }, 'Preferenze'),
      h('div', { class: 'card stack' },
        select('Unità di misura', 'units', [['cm', 'Centimetri'], ['in', 'Pollici']]),
        select('Modello di postura', 'model', Object.entries(MODELS).map(([k, m]) => [k, `${m.label} · ${m.hint}`]), 'Full è il compromesso migliore. Heavy è più lento ma può essere più stabile sui piedi.'),
        select('Acceleratore', 'delegate', [['auto', isIOS() ? 'Automatico (CPU su iPhone)' : 'Automatico (GPU se disponibile)'], ['gpu', 'Forza GPU'], ['cpu', 'Forza CPU']], 'Se l’analisi dà errori, prova CPU.'),
        h('div', { class: 'row between' }, h('div', {}, h('div', { style: { fontWeight: 600 } }, 'Rifinitura stacco/atterraggio'), h('div', { class: 'small muted' }, 'Rianalizza con Heavy e immagine specchiata solo attorno ai due istanti: tempi più stabili, qualche minuto in più')),
          h('button', { class: 'chip ' + (st.refine !== false ? 'sel' : ''), onclick: (e) => { st.refine = st.refine === false; store.save(); e.currentTarget.className = 'chip ' + (st.refine !== false ? 'sel' : ''); e.currentTarget.textContent = st.refine !== false ? 'Sì' : 'No'; } }, st.refine !== false ? 'Sì' : 'No')),
        h('div', { class: 'row between' }, h('div', {}, h('div', { style: { fontWeight: 600 } }, 'Mostra scheletro'), h('div', { class: 'small muted' }, 'Sovrapposto al video nella revisione')),
          h('button', { class: 'chip ' + (st.skeleton ? 'sel' : ''), onclick: (e) => { st.skeleton = !st.skeleton; store.save(); e.currentTarget.className = 'chip ' + (st.skeleton ? 'sel' : ''); e.currentTarget.textContent = st.skeleton ? 'Sì' : 'No'; } }, st.skeleton ? 'Sì' : 'No'))),
      h('div', { class: 'sec' }, 'Dati'),
      h('div', { class: 'card stack' },
        h('button', { class: 'btn', onclick: () => downloadFile('jumplab-backup.json', JSON.stringify(S), 'application/json') }, ic('download'), 'Esporta backup (JSON)'),
        h('label', { class: 'btn', style: { cursor: 'pointer' } }, ic('upload'), 'Importa backup',
          h('input', { type: 'file', accept: 'application/json', class: 'hide', onchange: async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { const j = JSON.parse(await f.text()); if (!Array.isArray(j.sessions) || !Array.isArray(j.athletes)) throw 0; Object.assign(S, j); store.save(); toast('Backup importato'); app.go('#/profile'); app.route(); }
            catch { toast('File di backup non valido'); }
          } })),
        h('button', { class: 'btn danger', onclick: async () => { if (await confirmSheet({ title: 'Cancellare tutti i dati?', text: 'Atleti, sessioni e preferenze verranno eliminati da questo dispositivo.', ok: 'Cancella tutto', danger: true })) { try { localStorage.removeItem('jumplab.v4'); } catch {} location.reload(); } } }, ic('trash'), 'Cancella tutti i dati')),
      h('div', { class: 'sec' }, 'Informazioni'),
      h('div', { class: 'small faint', style: { margin: '0 0 8px' } }, `Jump Lab v${VERSION} · compilazione ${BUILD}`),
      h('div', { class: 'card small muted', html: 'Jump Lab elabora i video <b>solo sul tuo dispositivo</b>: niente upload, nessun account. Stima l’altezza dal tempo di volo (h = g·t²/8). I risultati sono stime: non sostituiscono una pedana di forza o un sistema certificato.' }),
    );
    drawList();
  },
};

function editAthlete(a, done) {
  const S = store.s;
  const rec = a ? { ...a } : { id: store.uid(), name: '', heightCm: 175, massKg: 0 };
  sheet((b, close) => {
    const inp = (label, key, type = 'text', ph = '') => h('div', { class: 'field' }, h('label', {}, label),
      h('input', { class: 'input', type, inputmode: type === 'number' ? 'decimal' : undefined, value: rec[key] || '', placeholder: ph, oninput: (e) => { rec[key] = type === 'number' ? Number(e.target.value) || 0 : e.target.value; } }));
    b.append(h('h2', { style: { fontSize: '20px', marginBottom: '14px' } }, a ? 'Modifica atleta' : 'Nuovo atleta'),
      h('div', { class: 'stack' }, inp('Nome', 'name', 'text', 'Nome'), inp('Altezza (cm)', 'heightCm', 'number'),
        inp('Peso (kg) — facoltativo, per forza e potenza', 'massKg', 'number', 'es. 75'),
        h('p', { class: 'small muted', style: { margin: 0 } }, 'L’altezza serve a convertire pixel in cm (profondità del dip, pedana) e a verificare la calibrazione del tempo; l’altezza del salto da tempo di volo non la usa.')),
      h('div', { class: 'grid2', style: { marginTop: '16px' } },
        a && S.athletes.length > 1 ? h('button', { class: 'btn danger', onclick: () => { S.athletes = S.athletes.filter((x) => x.id !== a.id); if (S.currentAthlete === a.id) S.currentAthlete = S.athletes[0].id; store.save(); close(); done(); } }, 'Elimina') : h('button', { class: 'btn', onclick: close }, 'Annulla'),
        h('button', { class: 'btn primary', onclick: () => {
          if (!rec.name.trim()) { toast('Inserisci un nome'); return; }
          rec.heightCm = Math.min(230, Math.max(120, rec.heightCm || 175));
          if (a) Object.assign(a, rec); else { S.athletes.push(rec); S.currentAthlete = rec.id; }
          store.save(); close(); done();
        } }, 'Salva')));
  });
}

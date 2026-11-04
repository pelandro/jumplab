import { h, icon, ic, fmt, toast, confirmSheet, downloadFile, put } from './dom.js';
import { store } from '../store.js';
import { TEST_TYPES } from '../engine/jumps.js';

const csvRows = (sessions) => {
  const head = ['data', 'atleta', 'test', 'salto', 'altezza_cm', 'volo_ms', 'contatto_ms', 'rsi', 'rsi_flight', 'rsi_mod', 'dip_cm', 'v_stacco_ms', 'pedana_cm', 'forza_N', 'potenza_W', 'affidabilita'];
  const n = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '');
  const rows = [head.join(',')];
  for (const s of sessions) s.jumps.forEach((j, i) => rows.push([
    new Date(s.date).toISOString(), JSON.stringify(s.athleteName || ''), s.testType, i + 1, n(j.heightCm, 1), n(j.T * 1000, 0),
    n(j.contact * 1000, 0), n(j.rsi), n(j.rsiFlight), n(j.rsiMod), n(j.dipCm, 1), n(j.v0), n(j.boxCm, 0), n(j.forceN, 0), n(j.powerW, 0), j.confidence,
  ].join(',')));
  return rows.join('\n');
};

function lineChart(points, units) {
  const W = 520, H = 150, pad = 26;
  const ys = points.map((p) => p.v), lo = Math.min(...ys), hi = Math.max(...ys);
  const span = Math.max(hi - lo, 1), l = lo - span * 0.2, u = hi + span * 0.2;
  const X = (i) => pad + (points.length === 1 ? (W - 2 * pad) / 2 : (i / (points.length - 1)) * (W - 2 * pad));
  const Y = (v) => H - 20 - ((v - l) / (u - l)) * (H - 40);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const best = points.reduce((a, b) => (b.v > a.v ? b : a));
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <path d="${d}" fill="none" stroke="#c6f24e" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.v)}" r="${p === best ? 5 : 3.5}" fill="${p === best ? '#c6f24e' : '#11161b'}" stroke="#c6f24e" stroke-width="2"/>`).join('')}
    <text x="${X(points.indexOf(best))}" y="${Y(best.v) - 10}" fill="#c6f24e" font-size="12" font-weight="800" text-anchor="middle">${best.v.toFixed(1)}</text>
    <text x="${pad}" y="${H - 2}" fill="#5d6a77" font-size="10">${points[0].d}</text>
    <text x="${W - pad}" y="${H - 2}" fill="#5d6a77" font-size="10" text-anchor="end">${points[points.length - 1].d}</text></svg>`;
}

export const history = {
  render(root, app, param) {
    root.className = '';
    if (param) return detail(root, app, param);
    const S = store.s, units = S.settings.units;
    let fAth = 'all', fTest = 'all';
    const body = h('div');
    const draw = () => {
      const list = S.sessions.filter((s) => (fAth === 'all' || s.athleteId === fAth) && (fTest === 'all' || s.testType === fTest));
      body.replaceChildren();
      if (!list.length) {
        body.append(h('div', { class: 'empty' }, h('span', { html: icon('history') }), h('b', {}, 'Ancora nessuna sessione'), 'Le misure salvate compariranno qui, con andamento e confronto nel tempo.'));
        return;
      }
      const L = (cm) => fmt.len(cm, units);
      const best = Math.max(...list.map((s) => s.best)), avg = list.reduce((a, s) => a + s.best, 0) / list.length;
      const pts = [...list].reverse().map((s) => ({ v: L(s.best).v, d: new Date(s.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) }));
      put(body,
        h('div', { class: 'grid2' },
          h('div', { class: 'metric' }, h('span', {}, 'Record'), h('b', { class: 'num', style: { color: 'var(--accent)', fontSize: '26px' } }, L(best).v.toFixed(1), h('small', {}, ' ' + L(0).u))),
          h('div', { class: 'metric' }, h('span', {}, 'Media migliori'), h('b', { class: 'num', style: { fontSize: '26px' } }, L(avg).v.toFixed(1), h('small', {}, ' ' + L(0).u)))),
        pts.length > 1 ? h('div', { class: 'card', style: { marginTop: '12px' }, html: lineChart(pts, units) }) : null,
        h('div', { class: 'sec' }, `${list.length} sessioni`),
        h('div', { class: 'stack' }, ...list.map((s) => h('button', { class: 'item', onclick: () => app.go('#/history/' + s.id) },
          h('div', { class: 'thumb', style: { backgroundImage: s.thumb ? `url(${s.thumb})` : '' } }),
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, TEST_TYPES[s.testType]?.label || s.testType, s.leg && s.leg !== 'both' ? ` · ${s.leg === 'left' ? 'sx' : 'dx'}` : ''),
            h('div', { class: 'small muted' }, fmt.date(s.date), ' · ', s.athleteName, ' · ', s.jumps.length, s.jumps.length === 1 ? ' salto' : ' salti')),
          h('div', { class: 'val num' }, L(s.best).v.toFixed(1), h('small', {}, ' ' + L(0).u))))),
        h('button', { class: 'btn block', style: { marginTop: '16px' }, onclick: () => downloadFile('jumplab.csv', csvRows(list)) }, ic('download'), 'Esporta CSV'));
    };
    const aSel = h('select', { class: 'input', style: { minHeight: '40px', flex: 1 }, onchange: (e) => { fAth = e.target.value; draw(); } },
      h('option', { value: 'all' }, 'Tutti gli atleti'), ...S.athletes.map((a) => h('option', { value: a.id }, a.name)));
    const tSel = h('select', { class: 'input', style: { minHeight: '40px', flex: 1 }, onchange: (e) => { fTest = e.target.value; draw(); } },
      h('option', { value: 'all' }, 'Tutti i test'), ...Object.entries(TEST_TYPES).map(([k, t]) => h('option', { value: k }, t.label)));
    root.append(h('div', { class: 'top' }, h('div', { class: 'brand' }, 'Storico')),
      h('div', { class: 'row', style: { marginBottom: '14px' } }, aSel, tSel), body);
    draw();
  },
};

function detail(root, app, id) {
  const S = store.s, s = S.sessions.find((x) => x.id === id);
  if (!s) { app.go('#/history'); return; }
  const L = (cm) => fmt.len(cm, S.settings.units);
  const hasContact = s.jumps.some((j) => Number.isFinite(j.contact));
  put(root,
    h('div', { class: 'top' }, h('button', { class: 'back', onclick: () => app.go('#/history') }, ic('back')),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 800, fontSize: '18px' } }, TEST_TYPES[s.testType]?.long || s.testType), h('div', { class: 'small muted' }, fmt.date(s.date), ' · ', s.athleteName)),
      h('button', { class: 'iconbtn', onclick: async () => { if (await confirmSheet({ title: 'Eliminare la sessione?', text: 'L’operazione non si può annullare.', ok: 'Elimina', danger: true })) { store.removeSession(s.id); app.go('#/history'); } }, html: icon('trash') })),
    s.thumb ? h('div', { class: 'stagebox', style: { height: '150px', marginBottom: '12px' } }, h('img', { src: s.thumb, style: { height: '100%' } })) : null,
    h('div', { class: 'card' }, h('div', { class: 'small muted', style: { fontWeight: 700 } }, 'MIGLIOR SALTO'),
      h('div', { class: 'hero' }, h('div', { class: 'big num' }, L(s.best).v.toFixed(1), h('small', {}, L(0).u)),
        h('div', { class: 'small muted', style: { textAlign: 'right' } }, `${s.fps?.toFixed(0) || '?'} fps`, h('br'), s.fileName || ''))),
    h('div', { class: 'card', style: { marginTop: '12px', overflowX: 'auto' } },
      h('table', { class: 't num' },
        h('tr', {}, ...['#', L(0).u, 'Volo ms', hasContact ? 'GCT ms' : null, hasContact ? 'RSI' : 'Dip', 'Aff.'].filter(Boolean).map((x) => h('th', {}, x))),
        ...s.jumps.map((j, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, L(j.heightCm).v.toFixed(1)), h('td', {}, fmt.ms(j.T)),
          hasContact ? h('td', {}, fmt.ms(j.contact)) : null,
          h('td', {}, hasContact ? fmt.num(j.rsi, 2) : fmt.num(L(j.dipCm).v, 1)),
          h('td', {}, j.confidence || '')))),
    ),
    h('button', { class: 'btn block', style: { marginTop: '14px' }, onclick: () => downloadFile('jumplab-sessione.csv', csvRows([s])) }, ic('download'), 'Esporta CSV'));
}

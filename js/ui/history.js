import { h, icon, ic, fmt, toast, confirmSheet, downloadFile, put } from './dom.js';
import { store } from '../store.js';
import { TEST_TYPES } from '../engine/jumps.js';

const csvRows = (sessions) => {
  const head = ['data', 'atleta', 'test', 'salto', 'altezza_cm', 'volo_ms', 'contatto_ms', 'rsi', 'rsi_flight', 'rsi_mod', 'dip_cm', 'v_stacco_ms', 'pedana_cm', 'forza_N', 'potenza_W', 'affidabilita', 'incertezza_cm', 'altezza_corretta_cm', 'rifinito', 'ftct', 'forza_N_kg', 'potenza_W_kg', 'inquadratura', 'gamba', 'versione', 'eventi', 'altezza_vel_stacco_cm', 'inc_vel_stacco_cm', 'baricentro_culmine', 'v_stacco_culmine_ms', 'altezza_geometrica_cm', 'altezza_balistica_cm', 'spostamento_da_inizio_cm', 'validazione', 'metodo_consigliato', 'livelli_volo_spazio_parabola', 'altezza_volo_cm', 'altezza_integrata_cm', 'inc_integrata_cm', 'baricentro_atterraggio_cm', 'fonte_altezza', 'delta_traiettoria_cm', 'delta_statico_cm'];
  const n = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '');
  const rows = [head.join(',')];
  for (const s of sessions) s.jumps.forEach((j, i) => rows.push([
    new Date(s.date).toISOString(), JSON.stringify(s.athleteName || ''), s.testType, i + 1, n(j.heightCm, 1), n(j.T * 1000, 0),
    n(j.contact * 1000, 0), n(j.rsi), n(j.rsiFlight), n(j.rsiMod), n(j.dipCm, 1), n(j.v0), n(j.boxCm, 0), n(j.forceN, 0), n(j.powerW, 0), j.confidence, n(j.uncCm, 1), n(j.heightCorrCm, 1), j.refined ? 1 : 0, n(j.ftct, 2), n(j.forceRel, 1), n(j.powerRel, 1), s.view || '', s.leg || 'both', s.ver || '', j.ev || '', n(j.apexCm, 1), n(j.apexUncCm, 1), j.apexProxy || '', n(j.apexV0, 2), n(j.geoCm, 1), n(j.ballisticCm, 1), n(j.riseFromStartCm, 1), j.val || '', j.rec || '', j.lvl || '', n(j.heightFlightCm, 1), n(j.bestCm, 1), n(j.bestUncCm, 1), n(j.landDeltaCm, 1), j.hSource || '', n(j.landDeltaMeasCm, 1), n(j.landDeltaStaticCm, 1),
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

const SRC = { pixel: 'pixel del piede', misto: 'pixel + landmark', landmark: 'landmark del modello' };
const SRC_HEIGHT = { integrata: 'stima integrata', volo: 'tempo di volo' };

/** Un valore con la sua incertezza, o null se non disponibile (le sessioni salvate con versioni vecchie hanno meno dati). */
const val = (L, cm, unc) => (Number.isFinite(cm) ? `${fmt.num(L(cm).v, 1)}${Number.isFinite(unc) ? ' ± ' + fmt.num(L(unc).v, 1) : ''}` : null);
const num = (v, d = 2) => (Number.isFinite(v) ? fmt.num(v, d) : null);

/** Gruppi di valori di un salto, solo quelli presenti. [titolo, [[etichetta, valore, unità]]] */
function jumpGroups(j, L, s) {
  const u = L(0).u, fl = Number.isFinite(j.heightFlightCm) ? j.heightFlightCm : j.heightCm;
  const g = [];
  g.push(['Altezza', [
    ['Altezza mostrata', val(L, j.heightCm, j.hSource === 'integrata' ? j.bestUncCm : j.uncCm), u],
    ['Stima integrata', val(L, j.bestCm, j.bestUncCm), u],
    ['Dal tempo di volo', val(L, fl, j.uncCm), u],
    ['Parabola del baricentro', val(L, j.apexCm, j.apexUncCm), u],
    ['Spostamento del baricentro (scala)', val(L, j.geoCm, j.geoUncCm), u],
    ['Altezza balistica', val(L, j.ballisticCm), u],
    ['Spostamento dal punto iniziale', val(L, j.riseFromStartCm, j.riseFromStartUncCm), u],
    ['Baricentro allo stacco sopra il punto iniziale', val(L, j.takeoffRiseCm), u],
    ['Altezza corretta (postura bacino-piedi)', val(L, j.heightCorrCm), u],
  ]]);
  g.push(['Tempi', [
    ['Tempo di volo', Number.isFinite(j.T) ? fmt.ms(j.T) : null, 'ms'],
    ['Stacco · atterraggio', Number.isFinite(j.to) ? `${j.to.toFixed(3)} · ${j.td.toFixed(3)}` : null, 's'],
    ['Contatto al suolo', Number.isFinite(j.contact) ? fmt.ms(j.contact) : null, 'ms'],
    ['Tempo al decollo', Number.isFinite(j.timeToTakeoff) ? fmt.ms(j.timeToTakeoff) : null, 'ms'],
    ['FT:CT', num(j.ftct, 2), ''],
    ['Culmine rispetto a metà volo', Number.isFinite(j.apexAsymMs) ? `${j.apexAsymMs >= 0 ? '+' : ''}${fmt.num(j.apexAsymMs, 0)}` : null, 'ms'],
  ]]);
  g.push(['Indici e fasi', [
    ['RSI (h/GCT)', num(j.rsi, 2), ''], ['RSI-flight (TV/GCT)', num(j.rsiFlight, 2), ''], ['RSI mod (h/tempo)', num(j.rsiMod, 2), ''],
    ['Profondità del dip', Number.isFinite(j.dipCm) ? fmt.num(L(j.dipCm).v, 1) : null, u],
    ['Spostamento di spinta', Number.isFinite(j.hpoM) ? fmt.num(L(j.hpoM * 100).v, 1) : null, u],
    ['Pedana', Number.isFinite(j.boxCm) ? fmt.num(L(j.boxCm).v, 0) : null, u],
  ]]);
  g.push(['Velocità, forza e potenza', [
    ['Velocità di stacco (stima integrata)', Number.isFinite(j.bestV0) ? `${fmt.num(j.bestV0, 2)}${Number.isFinite(j.bestV0Unc) ? ' ± ' + fmt.num(j.bestV0Unc, 2) : ''}` : null, 'm/s'],
    ['Velocità di stacco (dal tempo di volo)', num(j.v0, 2), 'm/s'],
    ['Velocità di stacco (dal culmine)', Number.isFinite(j.apexV0) ? `${fmt.num(j.apexV0, 2)}${Number.isFinite(j.apexV0Unc) ? ' ± ' + fmt.num(j.apexV0Unc, 2) : ''}` : null, 'm/s'],
    ['Velocità media di spinta', num(j.vMean, 2), 'm/s'],
    ['Forza media (Samozino)', num(j.forceN, 0), 'N'], ['Forza per kg', num(j.forceRel, 1), 'N/kg'],
    ['Potenza media (Samozino)', num(j.powerW, 0), 'W'], ['Potenza per kg', num(j.powerRel, 1), 'W/kg'],
    ['Potenza di picco (Sayers, eq. SJ)', num(j.sayersW, 0), 'W'], ['Sayers per kg', num(j.sayersRel, 1), 'W/kg'],
  ]]);
  g.push(['Baricentro all’atterraggio più basso dello stacco', [
    ['Stima finale', val(L, j.landDeltaCm, j.landDeltaUncCm), u],
    ['Dalla traiettoria', val(L, j.landDeltaMeasCm), u],
    ['Dalla posizione statica (versioni 4.7.0–4.7.1)', val(L, j.landDeltaStaticCm), u],
    ['Peso della misura dalla traiettoria', Number.isFinite(j.bestW) ? `${fmt.num(j.bestW * 100, 0)}${Number.isFinite(j.bestWStatic) && j.bestWStatic > 0 ? ' · statico ' + fmt.num(j.bestWStatic * 100, 0) : ''}` : null, '%'],
    ['Tensione tra le due misure', Number.isFinite(j.deltaTension) && j.deltaTension > 0 ? num(j.deltaTension, 1) : null, '×'],
  ]]);
  return g.map(([t, rows]) => [t, rows.filter((r) => r[1] != null)]).filter(([, rows]) => rows.length);
}

function jumpCard(j, i, L, s, open) {
  const lv = { alta: 'alta', media: 'media', bassa: 'bassa' }[j.confidence] || '';
  const groups = jumpGroups(j, L, s);
  const box = ([label, v, unit]) => h('div', { class: 'metric' }, h('span', {}, label), h('b', { class: 'num', style: { fontSize: '17px' } }, v, unit ? h('small', {}, ' ' + unit) : null));
  const methods = Array.isArray(j.methods) && j.methods.length ? h('div', { style: { marginTop: '10px' } },
    h('div', { class: 'sec', style: { margin: '0 0 6px' } }, 'Validazione dei metodi'),
    j.verdict ? h('div', { class: 'small', style: { marginBottom: '6px' } }, h('b', {}, j.verdict.titolo || ''), j.verdict.why ? ' · ' + j.verdict.why : '') : null,
    ...j.methods.map((m) => h('div', { class: 'row between small', style: { padding: '3px 0' } },
      h('span', {}, m.nome, j.rec === m.id ? h('i', { class: 'vrec' }, 'consigliato') : null),
      h('span', { class: 'num' }, Number.isFinite(m.cm) ? `${fmt.num(L(m.cm).v, 1)}${Number.isFinite(m.uncCm) ? ' ± ' + fmt.num(L(m.uncCm).v, 1) : ''} ${L(0).u}` : 'non disponibile', ' ', h('em', { class: 'conf ' + m.level, style: { padding: '2px 8px', fontSize: '10px', fontStyle: 'normal' } }, m.level))))) : null;
  const flags = j.verdict?.flags?.length ? j.verdict.flags.map((t) => h('div', { class: 'qrow warn' }, h('b', {}, '!'), h('div', {}, t))) : [];
  const issues = (j.issues || []).filter((x) => x.text).map((x) => h('div', { class: 'qrow ' + (x.level === 'bad' ? 'bad' : x.level === 'warn' ? 'warn' : 'info') }, h('b', {}, x.level === 'bad' ? '✕' : x.level === 'warn' ? '!' : 'i'), h('div', {}, x.text)));
  const meta = [j.manual ? 'istanti corretti a mano' : null, j.ev ? 'istanti da ' + (SRC[j.ev] || j.ev) : null, j.refined ? 'rifinito (Heavy + specchio)' : null, j.apexProxy ? 'baricentro: ' + j.apexProxy : null, j.hSource ? 'altezza principale: ' + (SRC_HEIGHT[j.hSource] || j.hSource) : null].filter(Boolean).join(' · ');
  return h('details', { class: 'acc jd', open: open ? '' : null, style: { padding: '10px 0' } },
    h('summary', {}, h('span', { style: { fontWeight: 700 } }, `Salto ${i + 1}`, h('span', { class: 'muted num', style: { fontWeight: 500 } }, `  ·  ${fmt.num(L(j.heightCm).v, 1)} ${L(0).u}  ·  volo ${fmt.ms(j.T)} ms`)),
      lv ? h('span', { class: 'conf ' + lv, style: { padding: '3px 9px', fontSize: '10px' } }, lv) : null, ic('chev')),
    h('div', { style: { marginTop: '10px' } },
      ...groups.map(([t, rows]) => h('div', { style: { marginBottom: '12px' } }, h('div', { class: 'sec', style: { margin: '0 0 6px' } }, t), h('div', { class: 'metrics' }, ...rows.map(box)))),
      methods, ...flags, ...issues,
      meta ? h('p', { class: 'tiny faint', style: { margin: '10px 0 0' } }, meta) : null));
}

function detail(root, app, id) {
  const S = store.s, s = S.sessions.find((x) => x.id === id);
  if (!s) { app.go('#/history'); return; }
  const L = (cm) => fmt.len(cm, S.settings.units);
  const hasContact = s.jumps.some((j) => Number.isFinite(j.contact));
  const calTxt = s.cal ? (s.cal.mode === 'manual' ? `manuale ×${s.cal.value}` : s.cal.mode === 'auto' ? 'automatica' : s.cal.mode) : null;
  const info = [['Frame rate', s.fps ? s.fps.toFixed(0) + ' fps' : null], ['Inquadratura', s.view || null], ['Gamba', s.leg && s.leg !== 'both' ? (s.leg === 'left' ? 'sinistra' : 'destra') : null],
    ['Statura atleta', Number.isFinite(s.heightCm) ? s.heightCm + ' cm' : null], ['Massa', s.massKg ? s.massKg + ' kg' : null], ['Calibrazione del tempo', calTxt],
    ['Versione dell’app', s.ver || null], ['File', s.fileName || null]].filter(([, v]) => v);
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
        h('tr', {}, ...['#', L(0).u, `Volo ${L(0).u}`, 'Volo ms', hasContact ? 'GCT ms' : null, hasContact ? 'RSI' : 'Dip', 'Aff.'].filter(Boolean).map((x) => h('th', {}, x))),
        ...s.jumps.map((j, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, L(j.heightCm).v.toFixed(1)),
          h('td', {}, L(Number.isFinite(j.heightFlightCm) ? j.heightFlightCm : j.heightCm).v.toFixed(1)), h('td', {}, fmt.ms(j.T)),
          hasContact ? h('td', {}, fmt.ms(j.contact)) : null,
          h('td', {}, hasContact ? fmt.num(j.rsi, 2) : fmt.num(L(j.dipCm).v, 1)),
          h('td', {}, j.confidence || '')))),
    ),
    h('div', { class: 'sec', style: { marginTop: '16px' } }, 'Dettaglio dei salti'),
    h('div', { class: 'card' }, ...s.jumps.map((j, i) => jumpCard(j, i, L, s, s.jumps.length === 1))),
    info.length ? h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'sec', style: { margin: '0 0 8px' } }, 'Sessione'), ...info.map(([k, v]) => h('div', { class: 'kv' }, h('span', {}, k), h('span', {}, v)))) : null,
    h('button', { class: 'btn block', style: { marginTop: '14px' }, onclick: () => downloadFile('jumplab-sessione.csv', csvRows([s])) }, ic('download'), 'Esporta CSV'));
}

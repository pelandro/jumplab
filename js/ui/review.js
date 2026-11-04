// Schermata risultati: lettore frame-accurate, grafico con cursori, metriche, qualità e correzione manuale.

import { h, icon, ic, fmt, toast, confirmSheet } from './dom.js';
import { store } from '../store.js';
import { TEST_TYPES, summarizeSeries } from '../engine/jumps.js';
import { openGuide } from './guide.js';
import { VERSION } from '../store.js';
import { reanalyze, editJump, addJump } from '../engine/pipeline.js';
import { FramePlayer } from './player.js';
import { TrajectoryChart } from './chart.js';

const mean2 = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? a : b);

export const review = {
  render(root, app) {
    const session = app.session;
    root.className = '';
    if (!session) { app.go('#/'); return; }
    const S = store.s, ath = store.athlete();
    const testLabel = TEST_TYPES[session.params?.testType || session.opts.testType]?.label || '';
    const units = S.settings.units;
    const L = (cm) => fmt.len(cm, units);

    const header = h('div', { class: 'top' },
      h('button', { class: 'back', 'aria-label': 'Indietro', onclick: async () => { if (!session.saved && session.jumps?.length && !(await confirmSheet({ title: 'Uscire senza salvare?', text: 'Il risultato di questa analisi andrà perso.', ok: 'Esci', danger: true }))) return; app.session = null; app.go('#/'); } }, ic('back')),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 800, fontSize: '18px', letterSpacing: '-.02em' } }, testLabel + ' · ' + ath.name),
        h('div', { class: 'small muted' }, `${session.meta.name || 'video'} · ${session.meta.fps.toFixed(0)} fps`)));
    root.append(header);

    // --------- nessun salto
    if (session.error || !session.windows.length || !session.jumps?.length) {
      root.append(emptyState(app, session, session.error ? 'Corpo non rilevato' : 'Nessun salto rilevato', session.error || 'Il motore non ha trovato una fase di volo. Controlla che si vedano i piedi, o prova l’analisi completa (più lenta, tutti i fotogrammi).'));
      return;
    }

    let selIdx = 0, player = null, chart = null;
    const jumps = () => session.jumps;
    const cur = () => jumps()[selIdx];
    const resOf = (j) => session.results[j.win];
    const heightM = () => (session.params?.heightCm || 175) / 100;
    const uncal = (x) => !!x.timeScaleHint && (session.cal?.mode || 'auto') === 'auto';

    // --------- DOM
    const badge = h('div', { class: 'badge ground' }, 'A TERRA');
    const tcode = h('div', { class: 'tcode num' });
    const canvas = h('canvas');
    const stage = h('div', { class: 'stagebox' }, canvas, badge, tcode);
    const pills = h('div', { class: 'pills' });
    const hero = h('div', { class: 'card' });
    const metricsBox = h('div', { class: 'metrics' });
    const issuesBox = h('div');
    const seriesBox = h('div', { class: 'card hide' });
    const qualityBox = h('div', { class: 'card hide' });
    const drawQuality = () => {
      const q = session.quality;
      if (!q || !q.items?.length) { qualityBox.classList.add('hide'); return; }
      const mark = { ok: '✓', info: 'i', warn: '!', bad: '✕' };
      const issues = q.items.filter((x) => x.level === 'warn' || x.level === 'bad').length;
      qualityBox.classList.remove('hide');
      qualityBox.replaceChildren(
        h('details', { class: 'acc', open: issues > 0, style: { borderTop: 0, padding: 0 } },
          h('summary', {}, h('span', {}, 'Qualità della ripresa' + (q.view ? ` · ${q.view}` : '') + (issues ? ` · ${issues} ${issues === 1 ? 'avviso' : 'avvisi'}` : ' · ottima')), ic('chev')),
          ...q.items.map((x) => h('div', { class: 'qrow ' + x.level }, h('b', {}, mark[x.level]), h('div', {}, x.text))),
          h('button', { class: 'btn sm ghost', style: { marginTop: '10px' }, onclick: () => openGuide(session.params?.testType || 'general') }, ic('info'), 'Come migliorare la ripresa')));
    };
    const chartBox = h('div', { class: 'chartbox' });
    const frameInfo = h('div', { class: 'small muted num', style: { textAlign: 'center', margin: '8px 0 2px' } });
    const bannerBox = h('div');

    let speed = 0.25;
    const playBtn = h('button', { class: 'btn primary', 'aria-label': 'Riproduci', onclick: () => player.toggle(speed) });
    const setPlayIcon = (on) => { playBtn.innerHTML = icon(on ? 'pause' : 'play'); };
    setPlayIcon(false);
    const ctrl = h('div', { class: 'ctrl' },
      h('button', { class: 'btn', onclick: () => player.step(-10), html: icon('prev') + '' , 'aria-label': '−10 frame' }),
      h('button', { class: 'btn', onclick: () => player.step(-1), html: icon('back'), 'aria-label': '−1 frame' }),
      playBtn,
      h('button', { class: 'btn', onclick: () => player.step(1), html: icon('chev'), 'aria-label': '+1 frame' }),
      h('button', { class: 'btn', onclick: () => player.step(10), html: icon('next'), 'aria-label': '+10 frame' }));
    const speedSeg = h('div', { class: 'seg' }, ...[[0.1, '0.1×'], [0.25, '0.25×'], [1, 'Reale']].map(([v, l]) =>
      h('button', { class: v === speed ? 'on' : '', onclick: (e) => { speed = v; player.speed = v; [...speedSeg.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, l)));
    const evBtns = h('div', { class: 'grid2' },
      h('button', { class: 'btn sm', onclick: () => setEvent('to', player.time) }, ic('target'), 'Stacco qui'),
      h('button', { class: 'btn sm', onclick: () => setEvent('td', player.time) }, ic('target'), 'Atterraggio qui'));

    // --------- player & chart
    player = new FramePlayer(canvas, {
      onTime: (t, i) => { chart?.setPlayhead(t); updateBadge(); },
    });
    player.showSkeleton = S.settings.skeleton;
    player.onPlay = setPlayIcon;
    chart = new TrajectoryChart(chartBox, {
      onSeek: (t) => { player.pause(); player.seekTime(t); },
      onEdit: (which, t) => setEvent(which, t, true),
    });

    function updateBadge() {
      const j = cur();
      if (!j) return;
      const t = player.time, air = t >= j.to - 1e-9 && t < j.td - 1e-9;
      badge.className = 'badge ' + (air ? 'air' : 'ground');
      badge.textContent = air ? 'IN VOLO' : 'A TERRA';
      tcode.textContent = fmt.time(t);
      frameInfo.textContent = `Frame ${player.i + 1}/${player.win.frames.length} · idx ${player.frame?.idx} · Δ ${((j.td - j.to) * 1000).toFixed(1)} ms in volo`;
    }

    function setEvent(which, t, fromChart = false) {
      const j = cur();
      if (!j) return;
      const frames = player.times;
      const idx = player.indexAt(t);
      const ft = frames[idx];
      let to = which === 'to' ? ft : j.to, td = which === 'td' ? ft : j.td;
      const dt = frames.length > 1 ? (frames[frames.length - 1] - frames[0]) / (frames.length - 1) : 0.01;
      if (td - to < Math.max(dt * 2, 0.06)) return;
      editJump(session, j, to, td);
      refresh(false);
      if (!fromChart) player.seekTime(ft);
      session.saved = false;
    }

    function chartData(j) {
      const res = resOf(j), sig = res.sig;
      const fhPerM = sig.bodyH / heightM();
      const G = mean2(j.ground?.pre, j.ground?.post);
      const base = Number.isFinite(G) ? G : Math.min(...res.det.us.filter(Number.isFinite));
      const foot = Array.from(res.det.us, (v) => ((v - base) / fhPerM) * 100);
      const i0 = Math.max(0, Math.round((j.to - 1.0 - sig.t[0]) / sig.dt)), i1 = Math.max(i0 + 1, Math.round((j.to - 0.5 - sig.t[0]) / sig.dt));
      const refArr = Array.from(res.hip.sm.slice(i0, i1 + 1)).filter(Number.isFinite).sort((a, b) => a - b);
      const ref = refArr.length ? refArr[refArr.length >> 1] : res.hip.sm[0];
      const hip = Array.from(res.hip.sm, (v) => ((v - ref) / fhPerM) * 100);
      return { t: sig.t, foot, hip, from: Math.max(sig.t[0], j.to - 1.3), to: Math.min(sig.t[sig.t.length - 1], j.td + 0.9), jump: { to: j.to, td: j.td }, playhead: player.time, frames: player.times, base };
    }

    function select(i, seek = true) {
      selIdx = Math.max(0, Math.min(jumps().length - 1, i));
      const j = cur();
      if (!j) return;
      const win = session.windows[j.win];
      if (player.win !== win) player.setWindow(win);
      if (seek) player.seekTime(j.to);
      refresh(true);
    }

    function refresh(full = true) {
      const j = cur();
      if (!j) return;
      player.ground = mean2(j.ground?.pre, j.ground?.post);
      player.draw();
      chart.set(chartData(j));
      // pills
      pills.replaceChildren(...jumps().map((x, i) => h('button', { class: 'pill' + (i === selIdx ? ' sel' : '') + (x.excluded ? ' off' : ''), onclick: () => select(i) },
        `Salto ${i + 1}`, h('small', { class: 'num' }, `${uncal(x) ? '—' : L(x.heightCm).v.toFixed(1) + ' ' + L(x.heightCm).u}${x.manual ? ' · man.' : ''}`))),
        h('button', { class: 'pill', style: { minWidth: '56px', color: 'var(--accent)' }, onclick: addManual }, ic('plus'), h('small', {}, 'Aggiungi')));
      // hero
      const hh = L(j.heightCm);
      hero.replaceChildren(
        h('div', { class: 'hero' },
          h('div', {}, h('div', { class: 'small muted', style: { fontWeight: 700, marginBottom: '6px' } }, 'ALTEZZA SALTO (tempo di volo)'),
            // video rallentato non calibrato: il numero sarebbe assurdo (es. 800 cm) e potrebbe essere letto o salvato per errore
            uncal(j) ? h('div', { class: 'big num' }, '—', h('small', {}, 'calibra il tempo'))
              : h('div', { class: 'big num' }, hh.v.toFixed(1), h('small', {}, hh.u)),
            Number.isFinite(j.uncCm) && !uncal(j) ? h('div', { class: 'small muted num', style: { marginTop: '4px' } }, `± ${L(j.uncCm).v.toFixed(1)} ${hh.u} (1σ)${j.refined ? ' · rifinito' : ''}`) : null,
            Number.isFinite(j.apexCm) && !uncal(j) ? h('div', { class: 'small muted num', style: { marginTop: '2px' } }, `Da velocità di stacco: ${L(j.apexCm).v.toFixed(1)} ± ${L(j.apexUncCm).v.toFixed(1)} ${hh.u}`) : null),
          h('div', { style: { textAlign: 'right' } }, h('span', { class: 'conf ' + j.confidence }, 'Affidabilità ' + j.confidence),
            h('div', { class: 'num', style: { fontSize: '22px', fontWeight: 800, marginTop: '8px' } }, fmt.ms(j.T), h('small', { class: 'muted', style: { fontSize: '13px' } }, ' ms'))),
        ),
        h('div', { class: 'row', style: { marginTop: '14px', gap: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'btn sm ghost', onclick: () => { j.excluded = !j.excluded; refresh(); } }, ic(j.excluded ? 'plus' : 'close'), j.excluded ? 'Includi nel risultato' : 'Escludi salto'),
          jumps().length > 1 ? h('button', { class: 'btn sm ghost', onclick: () => removeJump() }, ic('trash'), 'Elimina') : null));
      // metriche
      const m = [];
      const add = (label, v, unit = '', show = true) => { if (show && v !== '—' && v !== undefined) m.push(h('div', { class: 'metric' }, h('span', {}, label), h('b', { class: 'num' }, v, unit ? h('small', {}, ' ' + unit) : null))); };
      add('Tempo di volo', fmt.ms(j.T), 'ms');
      add('Contatto al suolo', fmt.ms(j.contact), 'ms', Number.isFinite(j.contact));
      add('RSI (h/GCT)', fmt.num(j.rsi, 2), '', Number.isFinite(j.rsi));
      add('RSI-flight (TV/GCT)', fmt.num(j.rsiFlight, 2), '', Number.isFinite(j.rsiFlight));
      add('RSI mod (h/tempo)', fmt.num(j.rsiMod, 2), '', Number.isFinite(j.rsiMod));
      add('Profondità dip', fmt.num(L(j.dipCm).v, 1), L(0).u, Number.isFinite(j.dipCm) && TEST_TYPES[session.params.testType]?.needsDip);
      add('Tempo al decollo', fmt.ms(j.timeToTakeoff), 'ms', Number.isFinite(j.timeToTakeoff) && TEST_TYPES[session.params.testType]?.needsDip);
      add('Velocità di stacco', fmt.num(j.v0, 2), 'm/s');
      add('Pedana (stima)', fmt.num(L(j.boxCm).v, 0), L(0).u, Number.isFinite(j.boxCm));
      add('Forza media spinta', fmt.num(j.forceN, 0), 'N', Number.isFinite(j.forceN));
      add('Potenza media', fmt.num(j.powerW, 0), 'W', Number.isFinite(j.powerW));
      add('Forza media (per kg)', fmt.num(j.forceRel, 1), 'N/kg', Number.isFinite(j.forceRel));
      add('Potenza media (per kg)', fmt.num(j.powerRel, 1), 'W/kg', Number.isFinite(j.powerRel));
      add('Velocità media di spinta', fmt.num(j.vMean, 2), 'm/s', Number.isFinite(j.vMean) && Number.isFinite(j.forceN));
      add('FT:CT (volo / tempo al decollo)', fmt.num(j.ftct, 2), '', Number.isFinite(j.ftct) && TEST_TYPES[session.params.testType]?.needsDip);
      add('Potenza di picco (Sayers 1999, equazione SJ)', fmt.num(j.sayersW, 0), 'W', Number.isFinite(j.sayersW));
      add('Altezza da velocità di stacco (stima)', `${fmt.num(L(j.apexCm).v, 1)} ± ${fmt.num(L(j.apexUncCm).v, 1)}`, L(0).u, Number.isFinite(j.apexCm) && !uncal(j));
      add('Culmine rispetto a metà volo', `${j.apexAsymMs >= 0 ? '+' : ''}${fmt.num(j.apexAsymMs, 0)}`, 'ms', Number.isFinite(j.apexAsymMs) && !uncal(j));
      add('Risoluzione ±1 frame', '±' + fmt.num(L(j.frameCm).v, 1), L(0).u);
      if (Number.isFinite(j.uncCm) && Number.isFinite(j.frameCm) && !uncal(j)) {
        // errore atteso diviso per origine: frame rate (quantizzazione, σ = 0,41·(±1 fotogramma)), rilevazione (modello/pixel, residuo), sistematico (postura)
        const sFr = 0.408 * j.frameCm, sDet = Math.sqrt(Math.max(0, j.uncCm * j.uncCm - sFr * sFr));
        const sys = Number.isFinite(j.heightCorrCm) ? Math.max(0, j.heightCm - j.heightCorrCm) : NaN;
        m.push(h('div', { class: 'metric', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Errore atteso (1σ) per origine'),
          h('b', { class: 'num', style: { fontSize: '13px', lineHeight: 1.5 } },
            `frame rate ±${fmt.num(L(sFr).v, 1)} · rilevazione ±${fmt.num(L(sDet).v, 1)} ${L(0).u}`, Number.isFinite(sys) && sys > 0.3 ? ` · sistematico: fino a +${fmt.num(L(sys).v, 1)} ${L(0).u} (postura)` : '')));
      }
      add('Stacco / atterraggio rilevati da', j.flow ? `${j.flow.src.to === 'pixel' ? 'pixel' : 'landmark'} / ${j.flow.src.td === 'pixel' ? 'pixel' : 'landmark'}` : 'landmark', '', !j.manual);
      add('Altezza corretta per postura', fmt.num(L(j.heightCorrCm).v, 1), L(0).u, Number.isFinite(j.heightCorrCm) && (j.issues || []).some((x) => x.code === 'landflex'));
      const notes = [];
      if (Number.isFinite(j.rsi)) notes.push('RSI = altezza (da tempo di volo) / contatto: confronta atleti diversi con cautela (sovrastima sotto 1,0, sottostima sopra 1,0 rispetto al calcolo da velocità di stacco).');
      if (Number.isFinite(j.forceN)) notes.push('Forza e potenza sono stime (Samozino 2008): dipendono da massa, altezza dell\'atleta e corsa di spinta misurata dal bacino. Utili per confrontare nel tempo, non come misura di laboratorio.');
      metricsBox.replaceChildren(...m, ...(notes.length ? [h('p', { class: 'tiny faint', style: { margin: '10px 0 0' } }, notes.join(' '))] : []));
      issuesBox.replaceChildren(...j.issues.map((x) => h('div', { class: 'issue ' + x.level, html: icon(x.level === 'info' ? 'info' : 'alert') }, h('div', {}, x.text))));
      if (!j.issues.length) issuesBox.append(h('div', { class: 'issue info', html: icon('check') }, h('div', {}, 'Nessuna anomalia: tempi, traiettoria e visibilità dei piedi sono coerenti.')));
      // banner calibrazione
      bannerBox.replaceChildren();
      const hint = jumps().find((x) => x.timeScaleHint)?.timeScaleHint;
      if (hint) bannerBox.append(h('div', { class: 'issue bad', style: { marginBottom: '12px', alignItems: 'center' } }, ic('alert'),
        h('div', { class: 'grow' }, `Il video sembra rallentato ${hint}× (la gravità misurata è troppo bassa). Il risultato non è affidabile finché non imposti la calibrazione.`),
        h('button', { class: 'btn sm primary', onclick: () => recalibrate({ mode: 'scale', value: hint }) }, `Applica ${hint}×`)));
      // serie
      const active = jumps().filter((x) => !x.excluded);
      if (active.length > 1) {
        const sum = summarizeSeries(active);
        seriesBox.classList.remove('hide');
        seriesBox.replaceChildren(h('h3', {}, 'Serie'),
          h('table', { class: 't num' },
            h('tr', {}, ...['#', 'H ' + L(0).u, 'Volo', 'Contatto', 'RSI'].map((x) => h('th', {}, x))),
            ...jumps().map((x, i) => h('tr', { style: { opacity: x.excluded ? 0.4 : 1, cursor: 'pointer', color: i === selIdx ? 'var(--accent)' : '' }, onclick: () => select(i) },
              h('td', {}, i + 1), h('td', {}, L(x.heightCm).v.toFixed(1)), h('td', {}, fmt.ms(x.T)), h('td', {}, fmt.ms(x.contact)), h('td', {}, fmt.num(x.rsi, 2)))),
            h('tr', { class: 'faint', style: { fontSize: '12px' } }, h('td', { colSpan: 5 }, `Variabilità (CV): ${fmt.num(sum.cvPct, 1)} %` + (Number.isFinite(sum.declinePct) ? ` · calo di altezza primo→ultimo terzo: ${fmt.num(sum.declinePct, 1)} %` : ''))),
            h('tr', { style: { fontWeight: 800 } }, h('td', {}, 'Media'), h('td', {}, L(sum.meanCm).v.toFixed(1)), h('td', {}, fmt.ms(mean(active.map((x) => x.T)))), h('td', {}, fmt.ms(sum.meanContact)), h('td', {}, fmt.num(sum.meanRsi, 2)))));
      } else seriesBox.classList.add('hide');
      updateBadge();
    }

    const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };

    function recalibrate(cal) {
      reanalyze(session, { cal });
      session.saved = false;
      selIdx = Math.min(selIdx, Math.max(0, session.jumps.length - 1));
      if (!session.jumps.length) { app.go('#/result'); return; }
      player.setWindow(session.windows[cur().win]);
      select(selIdx);
      toast('Analisi ricalcolata con la nuova calibrazione');
      drawSettings();
    }

    function addManual() {
      const win = session.windows[cur().win];
      const t = player.time;
      const frames = player.times, dt = (frames[frames.length - 1] - frames[0]) / (frames.length - 1);
      const to = frames[player.indexAt(t)], td = frames[Math.min(frames.length - 1, player.indexAt(t + Math.max(0.35, dt * 6)))];
      if (td - to < dt * 3) { toast('Spostati su un punto con almeno mezzo secondo di video dopo.'); return; }
      const nj = addJump(session, cur().win, to, td);
      selIdx = session.jumps.indexOf(nj);
      session.saved = false;
      select(selIdx, false);
      toast('Salto aggiunto: sposta stacco e atterraggio sul grafico');
    }

    async function removeJump() {
      if (!(await confirmSheet({ title: 'Eliminare questo salto?', text: 'Verrà rimosso dalla sessione.', ok: 'Elimina', danger: true }))) return;
      const j = cur();
      const res = resOf(j);
      res.jumps = res.jumps.filter((x) => x !== j);
      session.jumps = session.results.flatMap((r) => r.jumps);
      selIdx = Math.max(0, selIdx - 1);
      select(selIdx);
    }

    // --------- impostazioni analisi
    const settingsBox = h('div', { class: 'card' });
    // Riepilogo per confrontare due analisi dello stesso video (versione, modello, lettura, impostazioni, risultato)
    function copyReport() {
      const m = session.meta, p = session.params || {}, j = jumps()[selIdx] || jumps()[0];
      const cal = session.cal || { mode: 'auto' };
      const lines = [
        `Jump Lab v${VERSION}`, `File: ${m.name}`, `Lettura: ${m.kind} · ${m.codec || ''} · ${m.width}×${m.height} · ${m.fps?.toFixed(2)} fps${m.variableRate ? ' (variabile)' : ''}`,
        `Test: ${p.testType} · gamba: ${p.leg || 'both'} · statura: ${p.heightCm} cm · massa: ${p.massKg || '-'} kg`,
        `Modello: ${m.model?.model}/${m.model?.delegate} · rifinitura: ${m.refined ? 'sì' : 'no'} · calibrazione: ${cal.mode}${cal.value ? ' ' + cal.value : ''}`,
        `Ripresa: ${session.quality?.view || '?'} · persone: ${session.people || 1}`,
        j ? `Salto: stacco ${j.to.toFixed(3)} s · atterraggio ${j.td.toFixed(3)} s · volo ${(j.T * 1000).toFixed(0)} ms · altezza ${j.heightCm.toFixed(1)} ± ${(j.uncCm || 0).toFixed(1)} cm` : 'Nessun salto',
      ];
      const text = lines.join('\n');
      (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast('Riepilogo copiato'), () => { prompt('Copia il riepilogo', text); });
    }

    function drawSettings() {
      const cal = session.cal || { mode: 'auto' };
      const calVal = cal.mode === 'auto' ? 'auto' : cal.mode + ':' + cal.value;
      const sel = h('select', { class: 'input', onchange: (e) => {
        const v = e.target.value;
        recalibrate(v === 'auto' ? { mode: 'auto' } : { mode: v.split(':')[0], value: Number(v.split(':')[1]) });
      } },
        ...[['auto', 'Automatica (timestamp del file)'], ['scale:2', 'Video rallentato 2×'], ['scale:4', 'Video rallentato 4×'], ['scale:8', 'Video rallentato 8×'],
          ['fps:60', 'Frame a passo fisso · 60 fps reali'], ['fps:120', 'Frame a passo fisso · 120 fps reali'], ['fps:240', 'Frame a passo fisso · 240 fps reali']]
          .map(([v, l]) => h('option', { value: v, selected: v === calVal }, l)));
      const tsel = h('select', { class: 'input', onchange: (e) => { S.testType = e.target.value; store.save(); reanalyze(session, { testType: e.target.value }); select(0); drawSettings(); } },
        ...Object.entries(TEST_TYPES).map(([k, t]) => h('option', { value: k, selected: k === session.params.testType }, t.long)));
      const m = session.meta;
      settingsBox.replaceChildren(h('h3', {}, 'Analisi'),
        h('div', { class: 'stack' },
          h('div', { class: 'field' }, h('label', {}, 'Tipo di test'), tsel),
          h('div', { class: 'field' }, h('label', {}, 'Calibrazione del tempo'), sel,
            h('span', { class: 'tiny faint' }, 'Usa “Automatica” per i file originali. Cambia solo se il video è stato rallentato/ricodificato (es. Slo-mo esportato a 30 fps).'))),
        h('details', { class: 'acc', style: { marginTop: '12px' } }, h('summary', {}, 'Dettagli tecnici', ic('chev')),
          h('div', { class: 'kv' }, h('span', {}, 'Decodifica'), h('span', {}, m.kind === 'webcodecs' ? 'WebCodecs (timestamp reali)' : 'Elemento video (tempi stimati)')),
          h('div', { class: 'kv' }, h('span', {}, 'Frequenza fotogrammi'), h('span', {}, `${m.fps.toFixed(1)} fps${m.variableRate ? ' · variabile' : ''}`)),
          h('div', { class: 'kv' }, h('span', {}, 'Risoluzione'), h('span', {}, `${m.width}×${m.height}${m.rotation ? ' · rot ' + m.rotation + '°' : ''}`)),
          h('div', { class: 'kv' }, h('span', {}, 'Modello'), h('span', {}, m.model ? `${m.model.model} · ${m.model.delegate}` : '—')),
          h('div', { class: 'kv' }, h('span', {}, 'Rifinitura Heavy + specchio'), h('span', {}, m.refined ? 'Sì (attorno a stacco e atterraggio)' : 'No')),
          h('div', { class: 'kv' }, h('span', {}, 'Eventi dai pixel del piede'), h('span', {}, m.flow ? 'Sì' : 'No')),
          h('div', { class: 'kv' }, h('span', {}, 'Fotogrammi analizzati'), h('span', {}, session.windows.reduce((s, w) => s + w.frames.length, 0))),
          h('div', { class: 'kv' }, h('span', {}, 'Altezza atleta usata'), h('span', {}, `${session.params.heightCm || 175} cm`)),
          h('div', { class: 'kv' }, h('span', {}, 'Versione app'), h('span', {}, 'v' + VERSION)),
          h('div', { class: 'row', style: { marginTop: '10px' } },
            h('button', { class: 'btn sm', onclick: () => copyReport() }, ic('download'), 'Copia riepilogo'),
            h('button', { class: 'btn sm', onclick: () => app.startAnalysis(session.file, { fullScan: true }) }, 'Analisi completa del video'),
            h('button', { class: 'btn sm', onclick: () => app.startAnalysis(session.file, { model: 'heavy' }) }, 'Rifai con Heavy'))));
    }
    drawSettings();

    // --------- salvataggio
    async function save() {
      const used = jumps().filter((x) => !x.excluded);
      if (!used.length) { toast('Nessun salto da salvare'); return; }
      if (used.some(uncal)) { toast('Video rallentato: applica prima la calibrazione del tempo'); return; }
      const best = used.reduce((a, b) => (b.heightCm > a.heightCm ? b : a));
      let thumb = '';
      try {
        const w = session.windows[best.win];
        const mid = (best.to + best.td) / 2;
        let k = 0;
        while (k < w.frames.length - 1 && w.frames[k].tc < mid) k++;
        const f = w.frames[k];
        const bmp = await createImageBitmap(f.blob);
        const c = document.createElement('canvas'); c.height = 120; c.width = Math.round(120 * bmp.width / bmp.height);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        thumb = c.toDataURL('image/jpeg', 0.7);
      } catch { /* miniatura facoltativa */ }
      const pick = (j) => ({ to: j.to, td: j.td, T: j.T, heightCm: j.heightCm, contact: j.contact, rsi: j.rsi, rsiFlight: j.rsiFlight, rsiMod: j.rsiMod, dipCm: j.dipCm, v0: j.v0, boxCm: j.boxCm, forceN: j.forceN, powerW: j.powerW, sayersW: j.sayersW, confidence: j.confidence, manual: !!j.manual, uncCm: j.uncCm, heightCorrCm: j.heightCorrCm, apexCm: j.apexCm, apexUncCm: j.apexUncCm, refined: !!j.refined, ev: j.flow ? (j.flow.src.to === 'pixel' && j.flow.src.td === 'pixel' ? 'pixel' : 'misto') : 'landmark', ftct: j.ftct, forceRel: j.forceRel, powerRel: j.powerRel });
      const rec = {
        id: store.uid(), date: Date.now(), athleteId: ath.id, athleteName: ath.name, testType: session.params.testType, leg: S.leg, view: session.quality?.view || null, ver: VERSION,
        fileName: session.meta.name, fps: session.meta.fps, cal: session.cal, heightCm: session.params.heightCm,
        jumps: used.map(pick), best: best.heightCm, thumb,
      };
      store.addSession(rec);
      session.saved = true;
      toast('Sessione salvata');
      app.go('#/history/' + rec.id);
    }

    // --------- layout
    const left = h('div', { class: 'stack' }, stage, frameInfo, ctrl, speedSeg, evBtns,
      h('div', { class: 'card' }, h('h3', {}, 'Traiettoria · trascina i cursori per correggere'), chartBox,
        h('div', { class: 'row small muted', style: { marginTop: '8px', gap: '14px' } },
          h('span', {}, h('b', { style: { color: 'var(--accent)' } }, '━ '), 'piedi sopra il suolo'),
          h('span', {}, h('b', { style: { color: '#fff' } }, '━ '), 'bacino'))));
    const right = h('div', { class: 'stack' }, bannerBox, qualityBox, hero, h('div', { class: 'card' }, h('h3', {}, 'Metriche'), metricsBox, issuesBox), seriesBox, settingsBox);
    root.append(pills, h('div', { class: 'cols', style: { marginTop: '12px' } }, left, right),
      h('div', { class: 'sticky' }, h('div', { class: 'in' },
        h('button', { class: 'btn', style: { flex: 1 }, onclick: async () => { if (await confirmSheet({ title: 'Scartare l’analisi?', text: 'Il risultato non verrà salvato.', ok: 'Scarta', danger: true })) { app.session = null; app.go('#/'); } } }, 'Scarta'),
        h('button', { class: 'btn primary', style: { flex: 2 }, onclick: save }, ic('check'), 'Salva sessione'))));
    document.getElementById('app').classList.add('wide');

    this._key = (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') { player.step(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { player.step(1); e.preventDefault(); }
      else if (e.key === ' ') { player.toggle(speed); e.preventDefault(); }
    };
    addEventListener('keydown', this._key);
    this._player = player;
    drawQuality();
    select(0);
  },
  dispose() { removeEventListener('keydown', this._key); this._player?.dispose(); document.getElementById('app')?.classList.remove('wide'); },
};

function emptyState(app, session, title, text) {
  return h('div', { class: 'empty' },
    h('span', { html: icon('alert'), style: { color: 'var(--amber)' } }),
    h('b', {}, title), h('p', {}, text),
    h('div', { class: 'stack', style: { maxWidth: '320px', margin: '16px auto 0' } },
      session.file ? h('button', { class: 'btn primary', onclick: () => app.startAnalysis(session.file, { fullScan: true }) }, 'Analisi completa del video') : null,
      h('button', { class: 'btn', onclick: () => { app.session = null; app.go('#/'); } }, 'Torna indietro')));
}

// Schermata risultati: lettore frame-accurate, grafico con cursori, metriche, qualità e correzione manuale.

import { h, icon, ic, fmt, toast, confirmSheet } from './dom.js';
import { store } from '../store.js';
import { TEST_TYPES, summarizeSeries, finalizeJump, jumpCurve } from '../engine/jumps.js';
import { agreementPlot, velocityPlot } from './viz.js';
import { rangeText, reliabilityText, historyContext, keyMetrics } from './explain.js';
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

    let selIdx = Math.max(0, session.jumps.findIndex((x) => !x.excluded)), player = null, chart = null; // si parte dal primo salto non escluso (i falsi voli sono esclusi in automatico)
    const jumps = () => session.jumps;
    const cur = () => jumps()[selIdx];
    const resOf = (j) => session.results[j.win];
    const heightM = () => (session.params?.heightCm || 175) / 100;
    const hd = (x) => (Number.isFinite(x.hUseCm) ? x.hUseCm : x.heightCm); // altezza mostrata: stima integrata o tempo di volo, secondo l'impostazione
    const uncal = (x) => !!x.timeScaleHint && (session.cal?.mode || 'auto') === 'auto';

    // --------- DOM
    const badge = h('div', { class: 'badge ground' }, 'A TERRA');
    const tcode = h('div', { class: 'tcode num' });
    const canvas = h('canvas');
    const stage = h('div', { class: 'stagebox' }, canvas, badge, tcode);
    const pills = h('div', { class: 'pills' });
    const hero = h('div', { class: 'card' });
    const metricsBox = h('div');
    const keyBox = h('div', { class: 'card' });
    const infoBox = h('div');
    const headlineBtn = h('div');
    const fin = Number.isFinite;
    const issuesBox = h('div', { class: 'card hide' });
    const seriesBox = h('div', { class: 'card hide' });
    const qualityBox = h('div', { class: 'card hide' });
    const valBox = h('div', { class: 'card hide' });
    // Validazione ibrida: tre metodi confrontati (mai mediati), livello di affidabilità motivato, incoerenze e metodo consigliato
    const drawValidation = (j) => {
      if (!j?.methods || uncal(j)) { valBox.classList.add('hide'); return; }
      valBox.classList.remove('hide');
      const v = j.verdict, lv = { coerenti: 'alta', parziale: 'media', incoerenti: 'bassa' }[v.status];
      const val = (m) => (Number.isFinite(m.cm) ? `${L(m.cm).v.toFixed(1)}${Number.isFinite(m.uncCm) ? ' ± ' + L(m.uncCm).v.toFixed(1) : ''} ${L(0).u}` : 'non disponibile');
      const row = (m) => h('details', { class: 'acc vm', style: { padding: '8px 0' } },
        h('summary', {}, h('span', { class: 'vmn' }, m.nome, v.recommended === m.id ? h('i', { class: 'vrec' }, 'consigliato') : null),
          h('span', { class: 'vmv num' }, val(m), h('em', { class: 'conf ' + m.level }, m.level)), ic('chev')),
        h('div', { class: 'tiny', style: { margin: '6px 0 2px', lineHeight: 1.5 } },
          ...m.pro.map((t) => h('div', { class: 'vpro' }, '✓ ' + t)), ...m.contro.map((t) => h('div', { class: 'vcon' }, '− ' + t))));
      const rows = ['integrato', 'volo', 'baricentro', 'parabola'].filter((id) => j.methods.some((m) => m.id === id)).map((id) => row(j.methods.find((m) => m.id === id)));
      const ball = Number.isFinite(j.ballisticCm) ? L(j.ballisticCm) : null;
      valBox.replaceChildren(...[
        h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
          h('h3', { style: { margin: 0 } }, 'Validazione dei metodi'), h('span', { class: 'conf ' + lv }, v.titolo)),
        h('p', { class: 'tiny muted', style: { margin: '0 0 6px' } }, 'La stima integrata non è una media: corregge il tempo di volo con la parte misurabile della traiettoria del baricentro, pesata per affidabilità; gli altri metodi la controllano.' + (v.recommended ? ` Da usare: ${j.methods.find((m) => m.id === v.recommended).nome.toLowerCase()} (${v.why}).` : ` ${v.why ? v.why[0].toUpperCase() + v.why.slice(1) + '.' : ''}`)),
        h('div', { class: 'plotbox', html: agreementPlot(j.methods, { conv: (x) => L(x).v, unit: L(0).u, recommended: v.recommended }) }),
        ...rows,
        ...v.flags.map((f) => h('div', { class: 'qrow warn' }, h('b', {}, '!'), h('div', {}, f.text))),
        v.status !== 'coerenti' ? h('p', { class: 'tiny', style: { margin: '8px 0 0' } }, 'Per correggere: scorri i fotogrammi e usa «Stacco qui» / «Atterraggio qui»; tutto viene ricalcolato.') : null,
        h('div', { class: 'vdist' },
          h('div', {}, h('span', {}, 'Altezza balistica'), h('b', { class: 'num' }, ball ? `${ball.v.toFixed(1)} ${ball.u}` : '—'), h('small', {}, 'sopra la posizione dello stacco (v²/2g)')),
          Number.isFinite(j.riseFromStartCm) ? h('div', {}, h('span', {}, 'Spostamento dal punto iniziale'), h('b', { class: 'num' }, `${L(j.riseFromStartCm).v.toFixed(1)} ${L(0).u}`),
            h('small', {}, `baricentro massimo rispetto alla posizione in piedi (allo stacco è già +${L(j.takeoffRiseCm).v.toFixed(0)} ${L(0).u}); stima ±${L(j.riseFromStartUncCm).v.toFixed(0)}`)) : null)].filter(Boolean));
    };
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
    const velBox = h('div', { class: 'card hide' });
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
      frameInfo.textContent = `Fotogramma ${player.i + 1} di ${player.win.frames.length} · in aria ${Math.round((j.td - j.to) * 1000)} ms`;
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

    // Velocità verticale del baricentro con le fasi e la caduta libera attesa (controllo visivo della balistica)
    const drawVelocity = (j) => {
      const res = resOf(j);
      let svg = '', curve = null;
      try { curve = !uncal(j) && res ? jumpCurve(res, j, heightM()) : null; svg = curve ? velocityPlot(curve, j) : ''; } catch { svg = ''; }
      if (!svg) { velBox.classList.add('hide'); return; }
      velBox.classList.remove('hide');
      velBox.replaceChildren(h('h3', {}, 'Velocità verticale e fasi'), h('div', { class: 'plotbox', html: svg }),
        h('div', { class: 'row small muted', style: { gap: '14px', flexWrap: 'wrap' } },
          h('span', {}, h('b', { style: { color: '#fff' } }, '━ '), `velocità misurata (baricentro: ${curve.name})`),
          h('span', {}, h('b', { style: { color: 'var(--accent)' } }, '╍ '), 'caduta libera attesa in volo (v₀ − g·t)')),
        h('p', { class: 'tiny faint', style: { margin: '8px 0 0' } }, 'Velocità verticale ricostruita dai landmark (busto e arti) e lisciata: serve a vedere le fasi e a controllare che in volo la pendenza sia −g. Attorno allo stacco può superare la velocità del baricentro (anche di ~1 m/s: il busto si raddrizza) e non è una curva di forza; il valore da usare è il punto verde, ricavato dalla fase di volo.'));
    };

    function refresh(full = true) {
      const j = cur();
      if (!j) return;
      drawVelocity(j);
      player.ground = mean2(j.ground?.pre, j.ground?.post);
      player.draw();
      chart.set(chartData(j));
      // pills
      pills.replaceChildren(...jumps().map((x, i) => h('button', { class: 'pill' + (i === selIdx ? ' sel' : '') + (x.excluded ? ' off' : ''), onclick: () => select(i) },
        `Salto ${i + 1}`, h('small', { class: 'num' }, x.excluded && x.autoExcluded ? 'escluso' : `${uncal(x) ? '—' : L(hd(x)).v.toFixed(1) + ' ' + L(hd(x)).u}${x.manual ? ' · man.' : ''}`))),
        h('button', { class: 'pill', style: { minWidth: '56px', color: 'var(--accent)' }, onclick: addManual }, ic('plus'), h('small', {}, 'Aggiungi')));
      // risultato principale: numero, intervallo detto a parole, confronto con le volte precedenti, motivo dell'affidabilità
      const hh = L(hd(j));
      const integ = j.hUseSource === 'integrata';
      const sig = integ ? j.bestUncCm : j.uncCm;
      const past = S.sessions.filter((x) => x.athleteId === ath?.id && x.testType === session.params.testType && fin(x.best))
        .sort((a, b) => b.date - a.date).map((x) => { const bj = (x.jumps || []).reduce((a, q) => (!a || q.heightCm > a.heightCm ? q : a), null); return { date: x.date, best: x.best, unc: bj ? (bj.hSource === 'integrata' && fin(bj.bestUncCm) ? bj.bestUncCm : bj.uncCm) : NaN, rep: bj ? bj.repCm : NaN }; });
      const ctxItems = uncal(j) || j.excluded ? [] : historyContext(past, hd(j), sig, hh.u, (x) => L(x).v, j.repCm);
      hero.replaceChildren(...[
        h('div', { class: 'hero' },
          h('div', {}, h('div', { class: 'small muted', style: { fontWeight: 700, marginBottom: '6px' } }, 'ALTEZZA DEL SALTO'),
            // video rallentato non calibrato: il numero sarebbe assurdo (es. 800 cm) e potrebbe essere letto o salvato per errore
            uncal(j) ? h('div', { class: 'big num' }, '—', h('small', {}, 'calibra il tempo'))
              : h('div', { class: 'big num' }, hh.v.toFixed(1), h('small', {}, hh.u)),
            fin(sig) && !uncal(j) ? h('div', { class: 'small muted num', style: { marginTop: '6px' } }, fin(j.repCm) ? `precisione ±${L(j.repCm).v.toFixed(1)} ${hh.u}` : `± ${L(sig).v.toFixed(1)} ${hh.u}`) : null),
          h('div', { style: { textAlign: 'right' } }, h('span', { class: 'conf ' + j.confidence }, 'Affidabilità ' + j.confidence))),
        !uncal(j) && fin(sig) ? h('p', { class: 'small', style: { margin: '12px 0 0', lineHeight: 1.5 } }, rangeText(L(hd(j)).v, L(sig).v, hh.u, fin(j.repCm) ? L(j.repCm).v : NaN)) : null,
        h('p', { class: 'small muted', style: { margin: '6px 0 0', lineHeight: 1.5 } }, reliabilityText(j, { uncal: uncal(j) })),
        ...ctxItems.map((c) => h('div', { class: 'ctx ' + c.tone }, c.text)),
        j.excluded ? h('div', { class: 'ctx bad' }, 'Questo volo è escluso dal risultato della sessione.') : null,
        h('div', { class: 'row', style: { marginTop: '14px', gap: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'btn sm ghost', onclick: () => { j.excluded = !j.excluded; j.userSet = true; j.autoExcluded = false; refresh(); } }, ic(j.excluded ? 'plus' : 'close'), j.excluded ? 'Includi nel risultato' : 'Escludi salto'),
          jumps().length > 1 ? h('button', { class: 'btn sm ghost', onclick: () => removeJump() }, ic('trash'), 'Elimina') : null)].filter(Boolean));
      // i pochi valori che servono a capire il salto, con una frase ciascuno
      const km = uncal(j) ? [] : keyMetrics(j, session.params.testType, L);
      keyBox.classList.toggle('hide', !km.length);
      keyBox.replaceChildren(h('h3', {}, 'Cosa dice il salto'),
        h('div', { class: 'keym' }, ...km.map((x) => h('div', { class: 'kmi' }, h('div', { class: 'kmh' }, h('span', {}, x.label), h('b', { class: 'num' }, String(x.value), x.unit ? h('small', {}, ' ' + x.unit) : null)), h('p', {}, x.help)))));
      // dati per esperti: fonte degli istanti, incertezze, baricentro, forza media (valida nei confronti con pedane); niente valori di validità scarsa
      // (velocità media e potenza di Samozino, potenza di picco di Sayers, ricavata per lo squat jump) né doppioni
      const T = [];
      const add = (label, v, unit = '', show = true) => { if (show && v !== '—' && v !== undefined) T.push(h('div', { class: 'metric' }, h('span', {}, label), h('b', { class: 'num', style: String(v).length > 7 ? { fontSize: '16px', lineHeight: 1.25 } : null }, v, unit ? h('small', {}, ' ' + unit) : null))); };
      add('Altezza dal solo tempo di volo', fmt.num(L(j.heightCm).v, 1), L(0).u, !uncal(j) && integ);
      add('Stima integrata', fin(j.bestCm) ? `${fmt.num(L(j.bestCm).v, 1)} ± ${fmt.num(L(j.bestUncCm).v, 1)}` : '—', L(0).u, fin(j.bestCm) && !uncal(j) && !integ);
      add('Velocità di stacco', fin(j.bestV0) ? `${fmt.num(j.bestV0, 2)} ± ${fmt.num(j.bestV0Unc, 2)}` : '—', 'm/s', fin(j.bestV0) && !uncal(j));
      add('Forza media di spinta (stima)', fmt.num(j.forceN, 0), 'N', fin(j.forceN));
      add('Forza media per kg', fmt.num(j.forceRel, 1), 'N/kg', fin(j.forceRel));
      add('Baricentro all\'atterraggio più basso dello stacco', fin(j.landDeltaCm) ? `${fmt.num(L(j.landDeltaCm).v, 1)} ± ${fmt.num(L(j.landDeltaUncCm).v, 1)}` : '—', L(0).u, fin(j.landDeltaCm) && !uncal(j));
      add('Culmine rispetto a metà volo', `${j.apexAsymMs >= 0 ? '+' : ''}${fmt.num(j.apexAsymMs, 0)}`, 'ms', fin(j.apexAsymMs) && !uncal(j));
      add('Baricentro usato', j.apexProxy ?? '—', '', fin(j.apexCm) && !uncal(j));
      add('Stacco / atterraggio letti da', j.flow ? `${j.flow.src.to === 'pixel' ? 'pixel' : 'modello'} / ${j.flow.src.td === 'pixel' ? 'pixel' : 'modello'}` : 'modello', '', !j.manual);
      add('Frame rate', fin(j.dt) ? Math.round(1 / j.dt) : '—', 'fps');
      add('Risoluzione ±1 fotogramma', '±' + fmt.num(L(j.frameCm).v, 1), L(0).u);
      const m = T.length ? [h('div', { class: 'metrics' }, ...T)] : [];
      const notes = [];
      if (fin(j.forceN)) notes.push('La forza media è stimata (Samozino 2008) da altezza, massa e corsa di spinta; nei confronti con pedane di app simili è risultata valida. Velocità media e potenza con lo stesso metodo hanno validità scarsa e non sono mostrate.');
      if (fin(j.bestCm) && !uncal(j)) notes.push(`Altezza mostrata: ${integ ? 'stima integrata (corregge il tempo di volo quando si atterra più piegati di come si è staccato)' : 'solo tempo di volo (come le app classiche)'}.`);
      drawValidation(j);
      metricsBox.replaceChildren(...m, ...(notes.length ? [h('p', { class: 'tiny faint', style: { margin: '10px 0 0' } }, notes.join(' '))] : []));
      const warnIss = j.issues.filter((x) => x.level === 'warn' || x.level === 'bad'), infoIss = j.issues.filter((x) => !(x.level === 'warn' || x.level === 'bad'));
      issuesBox.classList.toggle('hide', !warnIss.length);
      issuesBox.replaceChildren(h('h3', {}, warnIss.length === 1 ? 'Un avviso' : `${warnIss.length} avvisi`), ...warnIss.map((x) => h('div', { class: 'issue ' + x.level, html: icon('alert') }, h('div', {}, x.text))));
      infoBox.replaceChildren(...infoIss.map((x) => h('div', { class: 'issue info', html: icon('info') }, h('div', {}, x.text))));
      headlineBtn.replaceChildren();
      if (fin(j.bestCm)) headlineBtn.append(h('button', { class: 'btn sm ghost', style: { marginTop: '10px' }, onclick: () => { const to = integ ? 'flight' : 'integrated'; store.s.settings.headline = to; store.save(); for (const x of session.jumps) { x.headline = to; finalizeJump(x); } refresh(); } }, ic('info'), integ ? 'Mostra l\'altezza dal solo tempo di volo' : 'Mostra la stima integrata'));
      // banner calibrazione
      bannerBox.replaceChildren();
      const hint = jumps().find((x) => x.timeScaleHint && !x.excluded)?.timeScaleHint; // un falso volo escluso non deve proporre di ricalibrare il video
      if (hint) bannerBox.append(h('div', { class: 'issue bad', style: { marginBottom: '12px', alignItems: 'center' } }, ic('alert'),
        h('div', { class: 'grow' }, `Il video sembra rallentato ${hint}× (la gravità misurata è troppo bassa). Il risultato non è affidabile finché non imposti la calibrazione.`),
        h('button', { class: 'btn sm primary', onclick: () => recalibrate({ mode: 'scale', value: hint }) }, `Applica ${hint}×`)));
      // serie
      const active = jumps().filter((x) => !x.excluded);
      if (active.length > 1) {
        const sum = summarizeSeries(active);
        seriesBox.classList.remove('hide');
        const hasC = active.some((x) => fin(x.contact));
        const best = active.reduce((a, x) => (hd(x) > hd(a) ? x : a));
        seriesBox.replaceChildren(h('h3', {}, `Serie di ${active.length} salti`),
          h('p', { class: 'small', style: { margin: '6px 0 10px', lineHeight: 1.5 } }, `Media ${L(sum.meanCm).v.toFixed(1)} ${L(0).u}, migliore ${L(hd(best)).v.toFixed(1)} ${L(0).u} (salto ${jumps().indexOf(best) + 1}). `,
            fin(sum.cvPct) ? `I salti differiscono tra loro del ${fmt.num(sum.cvPct, 1)} % in media: più è basso, più sono costanti.` : '',
            fin(sum.declinePct) && active.length >= 4 ? ` Dal primo all\u2019ultimo terzo l\u2019altezza ${sum.declinePct > 0 ? 'cala' : 'cresce'} del ${fmt.num(Math.abs(sum.declinePct), 0)} %${sum.declinePct > 5 ? ': possibile affaticamento' : ''}.` : ''),
          h('table', { class: 't num' },
            h('tr', {}, ...['#', 'Altezza ' + L(0).u, 'In aria ms', hasC ? 'A terra ms' : null, hasC ? 'RSI' : null].filter(Boolean).map((x) => h('th', {}, x))),
            ...jumps().map((x, i) => h('tr', { style: { opacity: x.excluded ? 0.4 : 1, cursor: 'pointer', color: i === selIdx ? 'var(--accent)' : '' }, onclick: () => select(i) },
              h('td', {}, i + 1), h('td', {}, x.excluded ? 'escluso' : L(hd(x)).v.toFixed(1)), h('td', {}, fmt.ms(x.T)), hasC ? h('td', {}, fmt.ms(x.contact)) : null, hasC ? h('td', {}, fmt.num(x.rsi, 2)) : null))));
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
        j ? `Salto: stacco ${j.to.toFixed(3)} s · atterraggio ${j.td.toFixed(3)} s · volo ${(j.T * 1000).toFixed(0)} ms · altezza ${hd(j).toFixed(1)} cm (${j.hUseSource || 'volo'}${Number.isFinite(j.bestUncCm) && j.hUseSource === 'integrata' ? ' ± ' + j.bestUncCm.toFixed(1) : ''}) · tempo di volo ${j.heightCm.toFixed(1)} ± ${(j.uncCm || 0).toFixed(1)} cm` : 'Nessun salto',
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
      const tsel = h('select', { class: 'input', onchange: (e) => { S.testType = e.target.value; store.save(); reanalyze(session, { testType: e.target.value }); select(Math.max(0, session.jumps.findIndex((x) => !x.excluded))); drawSettings(); } },
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
      const best = used.reduce((a, b) => (hd(b) > hd(a) ? b : a));
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
      const pick = (j) => ({
        to: j.to, td: j.td, T: j.T, heightCm: hd(j), heightFlightCm: j.heightCm, uncCm: j.uncCm, hSource: j.hUseSource,
        bestCm: j.bestCm, bestUncCm: j.bestUncCm, bestV0: j.bestV0, bestV0Unc: j.bestV0Unc,
        landDeltaCm: j.landDeltaCm, landDeltaUncCm: j.landDeltaUncCm, landDeltaMeasCm: j.landDeltaMeasCm, landDeltaStaticCm: j.landDeltaStaticCm, deltaTension: j.deltaTension,
        bestW: j.bestW, bestWStatic: j.bestWStatic,
        heightCorrCm: j.heightCorrCm, repCm: j.repCm, apexCm: j.apexCm, apexUncCm: j.apexUncCm, apexAsymMs: j.apexAsymMs, apexProxy: j.apexProxy, apexSpreadCm: j.apexSpreadCm, apexV0: j.apexV0, apexV0Unc: j.apexV0Unc,
        geoCm: j.geoCm, geoUncCm: j.geoUncCm, ballisticCm: j.ballisticCm, riseFromStartCm: j.riseFromStartCm, riseFromStartUncCm: j.riseFromStartUncCm, takeoffRiseCm: j.takeoffRiseCm,
        contact: j.contact, rsi: j.rsi, rsiFlight: j.rsiFlight, rsiMod: j.rsiMod, dipCm: j.dipCm, timeToTakeoff: j.timeToTakeoff, hpoM: j.hpoM, phaseProxy: j.phaseProxy,
        v0: j.v0, vMean: j.vMean, boxCm: j.boxCm, forceN: j.forceN, powerW: j.powerW, sayersW: j.sayersW, ftct: j.ftct, forceRel: j.forceRel, powerRel: j.powerRel, sayersRel: j.sayersRel,
        confidence: j.confidence, manual: !!j.manual, refined: !!j.refined,
        val: j.verdict?.status, rec: j.verdict?.recommended, lvl: j.methods ? j.methods.map((m) => m.level[0]).join('') : '',
        verdict: j.verdict ? { titolo: j.verdict.titolo, why: j.verdict.why, flags: (j.verdict.flags || []).map((f) => f.text) } : null,
        methods: j.methods ? j.methods.map((m) => ({ id: m.id, nome: m.nome, cm: m.cm, uncCm: m.uncCm, level: m.level })) : null,
        issues: (j.issues || []).filter((x) => x.level !== 'ok').map((x) => ({ level: x.level, text: x.text })),
        ev: j.flow ? (j.flow.src.to === 'pixel' && j.flow.src.td === 'pixel' ? 'pixel' : 'misto') : 'landmark',
      });
      const rec = {
        id: store.uid(), date: Date.now(), athleteId: ath.id, athleteName: ath.name, testType: session.params.testType, leg: S.leg, view: session.quality?.view || null, ver: VERSION,
        fileName: session.meta.name, fps: session.meta.fps, cal: session.cal, heightCm: session.params.heightCm, massKg: session.params.massKg || null,
        jumps: used.map(pick), best: hd(best), thumb,
      };
      store.addSession(rec);
      session.saved = true;
      toast('Sessione salvata');
      app.go('#/history/' + rec.id);
    }

    // --------- layout
    const left = h('div', { class: 'stack' },
      h('div', { class: 'sec', style: { margin: '4px 2px 0' } }, 'Rivedi il salto'),
      stage, frameInfo, ctrl, speedSeg, evBtns,
      h('p', { class: 'tiny faint', style: { margin: '-4px 2px 0' } }, 'Se lo stacco o l\u2019atterraggio non sono giusti, porta il video sul fotogramma corretto e tocca «Stacco qui» o «Atterraggio qui»: tutto viene ricalcolato.'),
      h('div', { class: 'card' }, h('h3', {}, 'Piedi e bacino nel tempo'), chartBox,
        h('div', { class: 'row small muted', style: { marginTop: '8px', gap: '14px', flexWrap: 'wrap' } },
          h('span', {}, h('b', { style: { color: 'var(--accent)' } }, '━ '), 'piedi sopra il suolo'),
          h('span', {}, h('b', { style: { color: '#fff' } }, '━ '), 'bacino'),
          h('span', {}, 'la fascia evidenziata è il volo; trascina i bordi per correggerlo'))));
    const expert = h('details', { class: 'card expert' },
      h('summary', {}, h('span', {}, 'Dati per esperti e come è stato misurato'), ic('chev')),
      h('div', { class: 'stack', style: { marginTop: '12px' } }, valBox, velBox, h('div', {}, metricsBox, headlineBtn), infoBox));
    const right = h('div', { class: 'stack res' }, bannerBox, hero, keyBox, issuesBox, seriesBox, expert, qualityBox, settingsBox);
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
    select(selIdx);
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

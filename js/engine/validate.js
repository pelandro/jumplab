// Validazione ibrida dei tre metodi di altezza. Funzioni pure sui campi di un salto (nessuna dipendenza dal resto del motore).
//
//   1. Tempo di volo         h = g·T²/8                      (tempo; dipende dai due istanti, sovrastima se si atterra più flessi)
//   2. Baricentro nello spazio  h = spostamento del baricentro tra stacco e culmine, in metri con la scala dell'atleta
//                                                            (spazio; dipende dalla scala/prospettiva, non da g)
//   3. Parabola del baricentro  h = g·(t_culmine − t_stacco)²/2   (tempo; non dipende dalla scala né dall'atterraggio)
//
// I tre numeri NON si mediano: si confrontano due a due con tolleranze fisiche, si assegna a ciascuno un livello di affidabilità con i
// motivi, si segnalano le incoerenze e si indica quale usare. Nessuna soglia è stata calibrata contro una pedana: derivano dalla letteratura
// (volo − velocità di stacco ≈ 2,5 cm, fino ~18 %) e dai 4 salti reali analizzati (curvatura/g = 0,98–1,14 con la scala dell'app).

import { integrate } from './fusion.js';

const G = 9.80665;
const fin = Number.isFinite;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const levelOf = (s) => (s >= 0.75 ? 'alta' : s >= 0.5 ? 'media' : 'bassa');

// tolleranze (documentate in VALIDAZIONE.md)
export const TOL = {
  FP_LOW: 0.8, FP_HIGH: 1.03, // apice / volo atteso tra 0,80 e 1,03 (atterraggio più basso dello stacco ⇒ apice < volo)
  PG_LOW: 0.75, PG_HIGH: 1.33, // altezza geometrica / apice: scala e prospettiva entro −25…+33 %
  ASYM_LOW: -40, ASYM_HIGH: 15, // culmine rispetto a metà volo (ms): −40 = baricentro ~13 cm più basso all'atterraggio
};

function srcOf(j) {
  if (j.manual) return 'manuale';
  if (j.flow) return j.flow.pixelBoth ? 'pixel' : 'misto';
  return 'landmark';
}

function flightMethod(j) {
  const m = { id: 'volo', nome: 'Tempo di volo', cm: j.heightCm, uncCm: j.uncCm, score: 1, pro: [], contro: [] };
  const dt = j.dt || 1 / 30, fps = 1 / dt, src = srcOf(j);
  const pen = (p, t) => { m.score -= p; m.contro.push(t); };
  if (src === 'pixel') m.pro.push('stacco e atterraggio misurati sui pixel del piede');
  else if (src === 'manuale') m.pro.push('istanti scelti a mano fotogramma per fotogramma');
  else if (src === 'misto') pen(0.2, 'uno dei due istanti viene dai landmark del modello');
  else pen(fps >= 95 ? 0.35 : 0.15, fps >= 95 ? 'istanti dai landmark: ad alta frequenza sbagliano di decine di ms' : 'istanti dai landmark del modello');
  if (dt > 0.034) pen(0.3, `solo ${fps.toFixed(0)} fps: ±1 fotogramma ≈ ${(((G * j.T * dt) / 4) * 100).toFixed(1)} cm`);
  else if (dt > 0.0175) pen(0.1, `${fps.toFixed(0)} fps: risoluzione limitata`);
  else m.pro.push(`${fps.toFixed(0)} fps`);
  if (fin(j.uncT) && j.uncT > 0.02) pen(0.35, `incertezza sugli istanti ±${(j.uncT * 1000).toFixed(0)} ms`);
  else if (fin(j.uncT) && j.uncT > 0.012) pen(0.2, `incertezza sugli istanti ±${(j.uncT * 1000).toFixed(0)} ms`);
  else if (fin(j.uncT)) m.pro.push(`incertezza istanti ±${(j.uncT * 1000).toFixed(0)} ms`);
  if (j.fitFailed && src !== 'pixel' && src !== 'manuale') pen(0.2, 'rampa del piede non adattata con sicurezza');
  if (fin(j.groundShiftCm) && Math.abs(j.groundShiftCm) > 15) pen(0.1, `suolo a livelli diversi (${Math.abs(j.groundShiftCm).toFixed(0)} cm)`);
  if (fin(j.postureDropCm) && j.postureDropCm > 8) pen(0.1, `atterraggio più flesso (bacino −${j.postureDropCm.toFixed(0)} cm): il volo sovrastima`);
  m.score = clamp01(m.score); m.level = levelOf(m.score);
  return m;
}

// il culmine e lo spostamento dipendono dall'istante di stacco quanto il volo: ne ereditano la qualità
function takeoffPenalty(j) {
  const src = j.manual ? 'manuale' : j.flow ? j.flow.src.to : 'landmark';
  if (src === 'pixel') return { pen: 0, pro: 'stacco misurato sui pixel del piede' };
  if (src === 'manuale') return { pen: 0, pro: 'stacco scelto a mano' };
  return { pen: (j.fps || 30) >= 95 ? 0.35 : 0.15, contro: 'stacco dai landmark del modello (±decine di ms ad alta frequenza)' };
}

function comMethods(j) {
  const out = [];
  const have = fin(j.apexCm) && fin(j.apexT);
  const proxyPen = j.apexProxy === 'corpo intero' ? 0 : j.apexProxy === 'tronco' ? 0.1 : 0.25;
  const proxyTxt = j.apexProxy === 'corpo intero' ? 'baricentro a corpo intero (de Leva)' : j.apexProxy === 'tronco' ? 'solo tronco (arti non osservabili)' : 'solo bacino (tronco non osservabile)';

  // 3. parabola
  const p = { id: 'parabola', nome: 'Parabola del baricentro', cm: j.apexCm, uncCm: j.apexUncCm, v0: j.apexV0, v0Unc: j.apexV0Unc, score: 1, pro: [], contro: [] };
  if (!have) {
    p.score = 0; p.level = 'bassa'; p.nonDisponibile = true; p.contro.push('traiettoria del baricentro non adattabile (poche misure, fotogrammi o punti mancanti)');
  } else {
    const pen = (x, t) => { p.score -= x; p.contro.push(t); };
    const dt = j.dt || 1 / 30;
    if (proxyPen) pen(proxyPen, proxyTxt); else p.pro.push(proxyTxt);
    { const tp = takeoffPenalty(j); if (tp.pen) pen(tp.pen, tp.contro); else p.pro.push(tp.pro); }
    if (dt > 0.034) pen(0.3, 'pochi campioni in volo'); else if (dt > 0.0175) pen(0.15, 'frequenza bassa per il vertice');
    const rel = j.apexUncCm / Math.max(j.apexCm, 1);
    if (rel > 0.12) pen(0.3, `incertezza ±${j.apexUncCm.toFixed(1)} cm (${(rel * 100).toFixed(0)} %)`);
    else if (rel > 0.08) pen(0.15, `incertezza ±${j.apexUncCm.toFixed(1)} cm (${(rel * 100).toFixed(0)} %)`);
    else p.pro.push(`incertezza ±${j.apexUncCm.toFixed(1)} cm`);
    const sp = fin(j.apexSpreadCm) ? j.apexSpreadCm / Math.max(j.apexCm, 1) : 0;
    if (sp > 0.2) pen(0.3, `i modi di stimare il baricentro divergono di ${j.apexSpreadCm.toFixed(1)} cm`);
    else if (sp > 0.12) pen(0.15, `i modi di stimare il baricentro divergono di ${j.apexSpreadCm.toFixed(1)} cm`);
    if (fin(j.apexAsymMs) && (j.apexAsymMs < TOL.ASYM_LOW || j.apexAsymMs > TOL.ASYM_HIGH)) pen(0.3, `culmine ${j.apexAsymMs > 0 ? '+' : ''}${j.apexAsymMs.toFixed(0)} ms rispetto a metà volo: fuori dal plausibile`);
    if (fin(j.apexRmseRel) && j.apexRmseRel > 0.012) pen(0.15, 'la traiettoria si scosta dalla parabola');
    else p.pro.push('traiettoria ben descritta da una parabola');
    p.score = clamp01(p.score); p.level = levelOf(p.score);
  }
  // 2. spostamento del baricentro con la scala (spazio)
  const g = { id: 'baricentro', nome: 'Spostamento del baricentro (scala)', cm: j.geoCm, uncCm: j.geoUncCm, score: 0.9, pro: [], contro: [] };
  if (!have || !fin(j.geoCm)) {
    g.score = 0; g.level = 'bassa'; g.nonDisponibile = true; g.contro.push('traiettoria del baricentro non disponibile');
  } else {
    const pen = (x, t) => { g.score -= x; g.contro.push(t); };
    const r = j.geoCm / j.apexCm;
    const lr = Math.abs(Math.log(r));
    if (lr <= 0.15) g.pro.push(`scala coerente con la gravità (curvatura/g = ${r.toFixed(2)})`);
    else if (lr <= 0.29) pen(0.2, `scala poco coerente con la gravità (curvatura/g = ${r.toFixed(2)})`);
    else pen(0.45, `scala incoerente con la gravità (curvatura/g = ${r.toFixed(2)}): altezza dell'atleta, distanza o inclinazione della camera?`);
    if (j.scaleAssumed) pen(0.3, 'altezza dell\'atleta non impostata: scala presunta (175 cm)');
    else g.pro.push('scala dall\'altezza dell\'atleta');
    if (j.timeScaleHint) pen(0.5, 'video rallentato non calibrato');
    if (proxyPen) pen(proxyPen, proxyTxt); else g.pro.push(proxyTxt);
    { const tp = takeoffPenalty(j); if (tp.pen) pen(tp.pen, tp.contro); else g.pro.push(tp.pro); }
    g.contro.push('prospettiva non corretta (distanza e inclinazione della camera ignote)');
    g.score = clamp01(g.score - 0.05); g.level = levelOf(g.score);
  }
  out.push(g, p);
  return out;
}

function integratedMethod(j, fu, F, P) {
  // La stima integrata poggia su due catene di evidenza: gli istanti (tempo di volo) e il baricentro (correzione Δ). Il livello segue la catena
  // più debole in proporzione al peso della misura; la parte che si appoggia alla prior non può superare 0,7 (assunzione di popolazione).
  const m = { id: 'integrato', nome: 'Stima integrata', cm: fu.cm, uncCm: fu.uncCm, v0: fu.v0, v0Unc: fu.v0Unc, pro: [], contro: [] };
  m.score = clamp01(fu.wMeas * Math.min(F.score, P.score) + (1 - fu.wMeas) * Math.min(F.score, 0.7));
  m.level = levelOf(m.score);
  m.pro.push(`tempo di volo corretto con l'atterraggio ${fu.deltaCm.toFixed(1)} ± ${fu.deltaUncCm.toFixed(1)} cm più basso dello stacco`);
  m.pro.push(`evidenza su Δ: traiettoria ${fu.deltaMeasCm.toFixed(1)} ± ${fu.deltaMeasUncCm.toFixed(1)} cm (peso ${(fu.wMeas * 100).toFixed(0)} %)${fin(fu.deltaStaticCm) ? `, posizione statica ${fu.deltaStaticCm.toFixed(1)} ± ${fu.deltaStaticUncCm.toFixed(1)} cm (peso ${(fu.wStatic * 100).toFixed(0)} %)` : ''}, prior di popolazione (peso ${(fu.wPrior * 100).toFixed(0)} %)`);
  if (fu.tension > 1.5) { m.score = clamp01(m.score - (fu.tension > 2.5 ? 0.3 : 0.15)); m.level = levelOf(m.score); m.contro.push(`le due misure di Δ divergono (${fu.deltaMeasCm.toFixed(1)} contro ${fu.deltaStaticCm.toFixed(1)} cm): evidenza in conflitto, incertezza aumentata di ${fu.tension.toFixed(1)}×`); }
  for (const t of F.contro) m.contro.push('istanti: ' + t);
  for (const t of P.contro) if (!/^prospettiva/.test(t)) m.contro.push('baricentro: ' + t);
  return m;
}

/**
 * Valida un salto: riempie j.methods, j.verdict e adegua punteggio/avvisi. Idempotente (si può richiamare dopo i pixel, la rifinitura
 * o una correzione manuale: ricalcola le incertezze che dipendono da j.uncT e sostituisce i propri avvisi).
 */
export function validateJump(j) {
  // incertezze che dipendono dall'incertezza sugli istanti (aggiornata dopo i pixel e la rifinitura)
  if (fin(j.apexT) && fin(j.apexSigTa)) {
    const sT = Math.hypot(j.apexSigTa, 0.7 * (j.uncT || 0));
    j.apexUncCm = G * j.apexT * sT * 100;
    j.apexV0Unc = G * sT;
    if (fin(j.geoCm)) j.geoUncCm = j.geoCm * Math.hypot(0.1, (2 * sT) / j.apexT);
  }
  // stima integrata (fusion.js): ricalcolata qui perché dipende dall'incertezza sugli istanti, che cambia dopo i pixel e la rifinitura
  // incertezza del Δ statico: istanti (la posizione del baricentro cambia di ~g·T/2 al secondo), rumore dei punti del piede (~2,5 cm, dallo scarto tra
  // modelli sullo stesso salto) e scala (8 %)
  const sStat = fin(j.staticDeltaM) ? Math.hypot((G * j.T * (j.uncT || 0)) / 2, 0.025, 0.08 * Math.abs(j.staticDeltaM)) : NaN;
  const fu = integrate({ T: j.T, uncT: j.uncT, apexAsymMs: j.apexAsymMs, apexSigTa: j.apexSigTa, staticDeltaM: j.staticDeltaM, staticSigM: sStat });
  j.bestCm = fu ? fu.cm : NaN; j.bestUncCm = fu ? fu.uncCm : NaN; j.bestV0 = fu ? fu.v0 : NaN; j.bestV0Unc = fu ? fu.v0Unc : NaN;
  j.landDeltaCm = fu ? fu.deltaCm : NaN; j.landDeltaUncCm = fu ? fu.deltaUncCm : NaN; j.landDeltaMeasCm = fu ? fu.deltaMeasCm : NaN; j.bestW = fu ? fu.wMeas : NaN;
  j.landDeltaStaticCm = fu ? fu.deltaStaticCm : NaN; j.bestWStatic = fu ? fu.wStatic : NaN; j.deltaTension = fu ? fu.tension : NaN;
  const F = flightMethod(j);
  const [Gm, P] = comMethods(j);
  const I = fu ? integratedMethod(j, fu, F, P) : null;
  const methods = I ? [I, F, Gm, P] : [F, Gm, P];
  const flags = [];
  const hF = j.heightCm, hP = j.apexCm, hG = j.geoCm;
  const okP = fin(hP) && !P.nonDisponibile, okG = fin(hG) && !Gm.nonDisponibile;

  let okFP = null, okPG = null, okFG = null;
  if (okP) {
    const sc = Math.hypot(j.uncCm || 0, j.apexUncCm || 0);
    okFP = hP >= TOL.FP_LOW * hF - 2 * sc && hP <= TOL.FP_HIGH * hF + 2 * sc;
    if (!okFP) {
      flags.push({
        code: 'volo_vs_parabola', metodo: 'volo',
        text: hP > hF
          ? `La parabola dà ${hP.toFixed(1)} cm, più alto del tempo di volo (${hF.toFixed(1)} cm): impossibile se non si atterra più in alto che allo stacco. Istanti o tracciamento da controllare.`
          : `La parabola dà ${hP.toFixed(1)} cm, il ${(((hF - hP) / hF) * 100).toFixed(0)} % sotto il tempo di volo (${hF.toFixed(1)} cm): oltre il massimo plausibile per un atterraggio flesso (~20 %).`,
      });
    }
  }
  if (okP && okG) {
    const r = hG / hP;
    okPG = r >= TOL.PG_LOW && r <= TOL.PG_HIGH;
    if (!okPG) flags.push({ code: 'scala', metodo: 'baricentro', text: `Lo spostamento del baricentro in metri (${hG.toFixed(1)} cm) non concorda con la parabola (${hP.toFixed(1)} cm): la scala in pixel (altezza dell'atleta, distanza, inclinazione) o la prospettiva non sono affidabili. I metodi basati sul tempo non ne dipendono.` });
    okFG = hG >= 0.7 * hF && hG <= 1.12 * hF + (j.geoUncCm || 0);
  }
  if (okP && fin(j.apexAsymMs) && (j.apexAsymMs < TOL.ASYM_LOW || j.apexAsymMs > TOL.ASYM_HIGH)) {
    flags.push({ code: 'asimmetria', metodo: 'parabola', text: `Il culmine cade ${j.apexAsymMs > 0 ? '+' : ''}${j.apexAsymMs.toFixed(0)} ms rispetto a metà volo: il baricentro sarebbe ${Math.abs(G * j.T * (j.apexAsymMs / 1000) * 100).toFixed(0)} cm ${j.apexAsymMs < 0 ? 'più basso' : 'più alto'} all'atterraggio che allo stacco. Controlla i due istanti.` });
  }

  // stato complessivo. Prima la fisica del tempo (culmine impossibile ⇒ istanti sospetti), poi la scala.
  let status = 'coerenti', recommended = null, why = '';
  const asymBad = flags.some((f) => f.code === 'asimmetria');
  const rank = { bassa: 0, media: 1, alta: 2 };
  if (!okP) {
    status = 'parziale';
    recommended = F.level !== 'bassa' ? 'volo' : null;
    flags.push({ code: 'solo_volo', metodo: 'parabola', text: 'La traiettoria del baricentro non è adattabile: resta il solo tempo di volo, senza controllo incrociato.' });
    why = 'unico metodo disponibile';
  } else if (asymBad || okFP === false) {
    status = 'incoerenti';
    why = okPG === false ? 'i metodi non concordano: correggi gli istanti e controlla la scala' : 'prima correggi gli istanti di stacco e atterraggio';
    F.score = clamp01(F.score - 0.25); F.level = levelOf(F.score);
  } else if (okPG === false) {
    status = 'parziale';
    recommended = rank[P.level] > rank[F.level] ? 'parabola' : 'volo';
    why = 'i due metodi basati sul tempo concordano; quello spaziale non è affidabile';
    Gm.score = clamp01(Gm.score - 0.3); Gm.level = levelOf(Gm.score);
  } else {
    status = 'coerenti';
    recommended = rank[P.level] > rank[F.level] ? 'parabola' : 'volo';
    why = recommended === 'volo' ? 'metodo standard, confermato dagli altri' : 'livello di affidabilità superiore al tempo di volo, confermato dagli altri';
  }
  if (I && status !== 'incoerenti') { recommended = 'integrato'; why = 'combina il tempo di volo e la traiettoria del baricentro con pesi proporzionali all\'affidabilità (non è una media)'; }
  const titolo = status === 'coerenti' ? 'I metodi concordano' : status === 'parziale' ? 'Concordanza parziale' : 'Misura da verificare';
  j.methods = methods;
  j.verdict = { status, titolo, recommended, why, flags, okFP, okPG, okFG };

  // distinzione: altezza balistica (sopra la posizione di stacco) / spostamento rispetto alla posizione iniziale
  j.ballisticCm = fu ? fu.cm : okP ? hP : hF;
  j.ballisticSource = fu ? 'integrata' : okP ? 'parabola' : 'volo';
  if (fin(j.takeoffRiseCm) && fin(j.ballisticCm)) { j.riseFromStartCm = j.takeoffRiseCm + j.ballisticCm; j.riseFromStartUncCm = Math.hypot(0.1 * Math.abs(j.takeoffRiseCm), fu ? fu.uncCm : j.apexUncCm || 0); }

  // punteggio complessivo e avvisi: una sola penalità di validazione alla volta
  const pen = status === 'incoerenti' ? 0.3 : status === 'parziale' && okP ? 0.1 : 0;
  j.score = clamp01((fin(j.score) ? j.score : 1) + (j.valPen || 0) - pen);
  j.valPen = pen;
  j.confidence = levelOf(j.score);
  j.issues = (j.issues || []).filter((x) => !String(x.code).startsWith('val_'));
  if (status === 'incoerenti') j.issues.push({ level: 'warn', code: 'val_incoerente', text: `Misura da verificare: ${flags.map((f) => f.text).join(' ') || 'i metodi non concordano.'} ${why ? why[0].toUpperCase() + why.slice(1) + '.' : ''}` });
  else if (status === 'parziale' && okP) j.issues.push({ level: 'info', code: 'val_parziale', text: flags.map((f) => f.text).join(' ') });
  return j;
}

/**
 * Anomalie dentro una serie (≥ 4 salti): altezza lontana dalla mediana in modo robusto. Segna j.seriesOutlier; non esclude nulla.
 */
export function flagSeries(jumps) {
  const hOf = (j) => (fin(j.hUseCm) ? j.hUseCm : j.heightCm);
  const act = jumps.filter((j) => !j.excluded && fin(hOf(j)));
  for (const j of jumps) {
    j.seriesOutlier = null;
    j.issues = (j.issues || []).filter((x) => x.code !== 'val_serie');
  }
  if (act.length < 4) return;
  const s = act.map(hOf).sort((a, b) => a - b);
  const med = s[s.length >> 1];
  const mad = [...act.map((j) => Math.abs(hOf(j) - med))].sort((a, b) => a - b)[act.length >> 1];
  const sig = Math.max(1.4826 * mad, 0.03 * med);
  for (const j of act) {
    const z = (hOf(j) - med) / sig;
    if (Math.abs(z) > 3.5 && Math.abs(hOf(j) - med) > 0.2 * med) {
      j.seriesOutlier = { z, medianCm: med };
      j.issues.push({ level: 'warn', code: 'val_serie', text: `Altezza ${Math.abs(hOf(j) - med).toFixed(1)} cm ${hOf(j) > med ? 'sopra' : 'sotto'} la mediana della serie (${med.toFixed(1)} cm): salto anomalo o istanti da correggere.` });
    }
  }
}

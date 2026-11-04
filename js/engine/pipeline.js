// Pipeline di analisi in due passate:
//  1. SCANSIONE: tutto il video a ~30 fps su fotogramma intero -> dove sono i salti e dov'è l'atleta;
//  2. ALTA PRECISIONE: solo attorno ai salti, a TUTTI i fotogrammi nativi (es. 240 fps), sul ritaglio
//     stretto dell'atleta (più pixel sul corpo = landmark dei piedi più stabili).
// I fotogrammi analizzati sono conservati come JPEG per la revisione frame-per-frame.

import { openVideo } from './video.js';
import { pose } from './pose.js';
import { analyze, remeasure } from './jumps.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const FULL = { x: 0, y: 0, w: 1, h: 1 };

/** Mappa il tempo del media sul tempo reale secondo la calibrazione scelta dall'utente. */
export function calibratedTime(frame, cal) {
  if (!cal || cal.mode === 'auto') return frame.t;
  if (cal.mode === 'scale') return frame.t / cal.value;
  if (cal.mode === 'fps') return frame.idx / cal.value;
  return frame.t;
}

function bboxOf(kps) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0, n = 0;
  for (const kp of kps) {
    if (!kp) continue;
    for (let i = 0; i < 33; i++) {
      if (kp[i * 3 + 2] < 0.3) continue;
      const x = kp[i * 3], y = kp[i * 3 + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; n++;
    }
  }
  return n ? { x0, y0, x1, y1 } : null;
}

function cropFromBox(b, aspect) {
  if (!b) return { ...FULL };
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  // margini: braccia alzate sopra la testa, salto verso l'alto, oscillazione laterale
  const padX = Math.max(0.12 * bh / aspect, 0.06), padTop = 0.2 * bh + 0.03, padBot = 0.07 * bh + 0.02;
  let x0 = b.x0 - padX, x1 = b.x1 + padX, y0 = b.y0 - padTop, y1 = b.y1 + padBot;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1, x1); y1 = Math.min(1, y1);
  // larghezza minima (viste frontali strette)
  const minW = 0.35 * (y1 - y0) / aspect;
  if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = Math.max(0, c - minW / 2); x1 = Math.min(1, c + minW / 2); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function toBlob(canvas, q = 0.82) {
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', q));
}

/**
 * Esegue l'analisi completa. cb: { onStage(name, progress0to1, label), onPreview(canvas, kp, info), onLog(s) }
 * opts: { model, delegate, testType, heightCm, massKg, boxCm, cal, signal, fullScan, fpsHint }
 */
export async function runAnalysis(file, opts, cb = {}) {
  const log = cb.onLog || (() => {});
  const stage = (name, p, label) => cb.onStage?.(name, p, label);
  const signal = opts.signal;
  const aborted = () => { if (signal?.aborted) throw Object.assign(new Error('Analisi annullata'), { name: 'AbortError' }); };

  stage('open', 0, 'Apro il video…');
  const src = await openVideo(file, { onLog: log, preferFallback: opts.preferFallback, fpsHint: opts.fpsHint });
  const meta = src.describe();
  meta.name = file.name;
  aborted();

  stage('model', 0.02, 'Carico il modello di postura…');
  const engine = await pose.init({ model: opts.model || 'full', delegate: opts.delegate || 'auto', onStatus: (s) => stage('model', 0.03, s) });
  meta.model = engine;
  aborted();

  const W = src.width, H = src.height, aspect = W / H;
  const session = { meta, opts: { ...opts, signal: undefined }, windows: [], coarse: null, scanOnly: false };

  // ---------------- 1. scansione grossolana
  const step = Math.max(1, Math.round(meta.fps / 30));
  const cs = Math.min(1, 720 / Math.max(W, H));
  const cv = document.createElement('canvas');
  cv.width = Math.max(64, Math.round(W * cs)); cv.height = Math.max(64, Math.round(H * cs));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const coarse = { idx: [], t: [], kp: [] };
  let last = null, n = 0;
  stage('scan', 0.05, 'Cerco i salti nel video…');
  for await (const { idx, t, frame } of src.frames({ step, signal })) {
    aborted();
    src.drawCrop(frame, ctx, FULL, cv.width, cv.height);
    const kp = pose.detect(cv, { multi: true, near: last });
    if (kp) { const b = bboxOf([kp]); if (b) last = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }
    coarse.idx.push(idx); coarse.t.push(t); coarse.kp.push(kp);
    if (n++ % 2 === 0) {
      stage('scan', 0.05 + 0.3 * (idx / meta.frameCount), `Cerco i salti · ${Math.round((100 * idx) / meta.frameCount)}%`);
      cb.onPreview?.(cv, kp, { crop: FULL, t });
      await tick();
    }
  }
  session.coarse = coarse;
  const found = coarse.kp.filter(Boolean).length;
  log(`Scansione: ${found}/${coarse.kp.length} fotogrammi con corpo rilevato`);
  if (found < Math.max(6, coarse.kp.length * 0.15)) {
    session.error = 'Corpo non rilevato: inquadra tutta la persona (testa e piedi), di lato o di fronte, con buona luce.';
    src.dispose();
    return session;
  }

  // ---------------- finestre dei salti
  const track = { t: coarse.t, kp: coarse.kp, aspect };
  const loose = { testType: opts.testType, heightCm: opts.heightCm, minPromBH: 0.03, minFlight: 0.06, maxFlight: 12 };
  const coarseRes = analyze(track, loose);
  let wins = [];
  const dur = meta.duration;
  if (opts.fullScan || !coarseRes.jumps.length) {
    if (!opts.fullScan) session.noCoarseJump = true;
    if (opts.fullScan) wins.push({ t0: 0, t1: dur });
  } else {
    for (const j of coarseRes.jumps) {
      const T = j.td - j.to;
      const before = Math.max(opts.testType === 'dj' || opts.testType === 'rebound' ? 2.6 : 2.2, 3 * T);
      const after = Math.max(1.0, 1.5 * T);
      wins.push({ t0: Math.max(0, j.to - before), t1: Math.min(dur, j.td + after) });
    }
    wins.sort((a, b) => a.t0 - b.t0);
    const merged = [];
    for (const w of wins) {
      const l = merged[merged.length - 1];
      if (l && w.t0 <= l.t1) l.t1 = Math.max(l.t1, w.t1); else merged.push({ ...w });
    }
    wins = merged;
  }
  session.coarseJumps = coarseRes.jumps.length;
  if (!wins.length) { session.scanOnly = true; src.dispose(); return session; }

  // ---------------- 2. passata ad alta precisione
  const totalFrames = wins.reduce((s, w) => s + meta.fps * (w.t1 - w.t0), 0);
  let done = 0;
  const dcv = document.createElement('canvas'), dctx = dcv.getContext('2d', { willReadFrequently: true });
  for (const w of wins) {
    const inWin = coarse.kp.filter((_, i) => coarse.t[i] >= w.t0 && coarse.t[i] <= w.t1);
    const crop = cropFromBox(bboxOf(inWin), aspect);
    const cpx = crop.w * W, cpy = crop.h * H;
    const s = Math.min(1, 560 / Math.max(cpx, cpy));
    dcv.width = Math.max(32, Math.round(cpx * s)); dcv.height = Math.max(32, Math.round(cpy * s));
    const win = { t0: w.t0, t1: w.t1, crop, frames: [], cw: dcv.width, ch: dcv.height };
    let miss = 0;
    for await (const { idx, t, frame } of src.frames({ from: w.t0, to: w.t1, signal })) {
      aborted();
      dctx.imageSmoothingQuality = 'high';
      src.drawCrop(frame, dctx, crop, dcv.width, dcv.height);
      let kp = pose.detect(dcv);
      if (kp) {
        for (let i = 0; i < 33; i++) { kp[i * 3] = crop.x + kp[i * 3] * crop.w; kp[i * 3 + 1] = crop.y + kp[i * 3 + 1] * crop.h; }
        miss = 0;
      } else if (++miss >= 2) {
        // persa nel ritaglio: riprova a fotogramma intero (poi mappa sul fotogramma)
        src.drawCrop(frame, ctx, FULL, cv.width, cv.height);
        kp = pose.detect(cv);
      }
      const blob = await toBlob(dcv);
      win.frames.push({ idx, t, kp, blob });
      done++;
      if (done % 3 === 0) {
        stage('dense', 0.38 + 0.57 * Math.min(1, done / totalFrames), `Tracciamento ad alta precisione · ${Math.min(99, Math.round((100 * done) / totalFrames))}%`);
        cb.onPreview?.(dcv, kp ? remapToCrop(kp, crop) : null, { crop, t, fps: meta.fps });
        await tick();
      }
    }
    session.windows.push(win);
  }
  src.dispose();
  stage('analyze', 0.96, 'Calcolo stacchi e atterraggi…');
  reanalyze(session, { cal: opts.cal, testType: opts.testType, heightCm: opts.heightCm, massKg: opts.massKg, boxCm: opts.boxCm });
  stage('done', 1, 'Completato');
  return session;
}

function remapToCrop(kp, crop) {
  const o = new Float32Array(kp.length);
  for (let i = 0; i < 33; i++) {
    o[i * 3] = (kp[i * 3] - crop.x) / crop.w; o[i * 3 + 1] = (kp[i * 3 + 1] - crop.y) / crop.h; o[i * 3 + 2] = kp[i * 3 + 2];
  }
  return o;
}

/** Ricalcola i risultati dai landmark già salvati (cambio calibrazione, atleta, tipo di test). */
export function reanalyze(session, p = {}) {
  const { meta } = session;
  const aspect = meta.width / meta.height;
  const cal = p.cal || session.opts.cal || { mode: 'auto' };
  session.cal = cal;
  session.params = {
    testType: p.testType ?? session.opts.testType, heightCm: p.heightCm ?? session.opts.heightCm,
    massKg: p.massKg ?? session.opts.massKg, boxCm: p.boxCm ?? session.opts.boxCm,
  };
  session.results = [];
  let id = 1;
  for (const win of session.windows) {
    for (const f of win.frames) f.tc = calibratedTime(f, cal);
    const track = { t: win.frames.map((f) => f.tc), kp: win.frames.map((f) => f.kp), aspect };
    const aopts = { ...session.params };
    let res = analyze(track, aopts);
    // voli lunghissimi = quasi sempre video rallentato non calibrato: li si mostra comunque, con avviso.
    // Se la fisica (curvatura del bacino) conferma un rallentamento, il volo lungo ha la precedenza sui
    // piccoli falsi voli (oscillazioni dei piedi) che altrimenti lo oscurerebbero.
    const slow = analyze(track, { ...aopts, maxFlight: 12 });
    if (slow.jumps.some((j) => j.T > 1.45 && j.timeScaleHint)) res = slow;
    else if (!res.jumps.length && slow.jumps.length) res = slow;
    for (const j of res.jumps) { j.id = id++; j.win = session.windows.indexOf(win); }
    session.results.push(res);
  }
  session.jumps = session.results.flatMap((r) => r.jumps);
  return session;
}

export { remapToCrop };

function paramsOf(session) {
  return session.params || { testType: session.opts.testType, heightCm: session.opts.heightCm, massKg: session.opts.massKg, boxCm: session.opts.boxCm };
}

/** Correzione manuale di stacco/atterraggio: ricalcola metriche e il contatto del salto successivo. */
export function editJump(session, jump, newTo, newTd) {
  const res = session.results[jump.win];
  const params = paramsOf(session);
  const oldTd = jump.td;
  const contact = jump.contactStart != null ? newTo - jump.contactStart : null;
  const nj = remeasure(res, newTo, newTd, params, contact);
  const keep = { id: jump.id, win: jump.win, contactStart: jump.contactStart, contactSource: jump.contactSource, excluded: jump.excluded, ground: nj.ground };
  Object.assign(jump, nj, keep, { manual: true });
  const next = res.jumps.find((j) => j !== jump && j.contactStart != null && Math.abs(j.contactStart - oldTd) < 1e-6);
  if (next) {
    next.contactStart = newTd;
    const nn = remeasure(res, next.to, next.td, params, next.to - newTd);
    Object.assign(next, nn, { id: next.id, win: next.win, contactStart: newTd, contactSource: next.contactSource, excluded: next.excluded, manual: next.manual });
  }
  return jump;
}

/** Aggiunge un salto manuale (non rilevato automaticamente). */
export function addJump(session, winIdx, to, td) {
  const res = session.results[winIdx];
  const nj = remeasure(res, to, td, paramsOf(session), null);
  nj.id = Math.max(0, ...session.jumps.map((j) => j.id)) + 1;
  nj.win = winIdx; nj.manual = true; nj.contactStart = null;
  res.jumps.push(nj);
  res.jumps.sort((a, b) => a.to - b.to);
  session.jumps = session.results.flatMap((r) => r.jumps);
  return nj;
}

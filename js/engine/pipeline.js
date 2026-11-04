// Pipeline di analisi in due passate:
//  1. SCANSIONE: tutto il video a ~30 fps su fotogramma intero -> dove sono i salti e dov'è l'atleta;
//  2. ALTA PRECISIONE: solo attorno ai salti, a TUTTI i fotogrammi nativi (es. 240 fps), sul ritaglio
//     stretto dell'atleta (più pixel sul corpo = landmark dei piedi più stabili).
// I fotogrammi analizzati sono conservati come JPEG per la revisione frame-per-frame.

import { openVideo } from './video.js';
import { pose, PoseEngine } from './pose.js';
import { analyze, remeasure } from './jumps.js';
import { assessRecording } from './quality.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const FULL = { x: 0, y: 0, w: 1, h: 1 };

/** Mappa il tempo del media sul tempo reale secondo la calibrazione scelta dall'utente. */
export function calibratedTime(frame, cal) {
  if (!cal || cal.mode === 'auto') return frame.t;
  if (cal.mode === 'scale') return frame.t / cal.value;
  if (cal.mode === 'fps') return frame.idx / cal.value;
  return frame.t;
}

function areaOf(kp) { const b = bboxOf([kp]); return b ? (b.x1 - b.x0) * (b.y1 - b.y0) : 0; }
function heightOf(kp) { const b = bboxOf([kp]); return b ? b.y1 - b.y0 : 0; }
function centerOf(kp) { const b = bboxOf([kp]); return b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [0.5, 0.5]; }

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

function toBlob(canvas, q = 0.9) {
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
  // Una traccia per persona: ogni posa viene assegnata alla traccia più vicina; a fine scansione si segue la persona che salta
  // (maggiore escursione verticale del bacino), non quella più grande o più vicina alla camera.
  const tracks = [];
  let n = 0;
  stage('scan', 0.05, 'Cerco i salti nel video…');
  for await (const { idx, t, frame } of src.frames({ step, signal })) {
    aborted();
    src.drawCrop(frame, ctx, FULL, cv.width, cv.height);
    const poses = pose.detectAll(cv);
    const fi = coarse.idx.length;
    const used = new Set();
    for (const kp of poses.sort((a, b) => areaOf(b) - areaOf(a))) {
      const c = centerOf(kp);
      let best = null, bd = Infinity;
      for (const tr of tracks) { if (used.has(tr)) continue; const d = Math.hypot(c[0] - tr.c[0], c[1] - tr.c[1]); if (d < bd) { bd = d; best = tr; } }
      if (!best || bd > Math.max(0.2, 0.7 * heightOf(kp))) { best = { c, kps: new Map() }; tracks.push(best); }
      best.c = c; best.kps.set(fi, kp); used.add(best);
    }
    // anteprima: la traccia più lunga finora
    const lead = tracks.reduce((a, b) => (!a || b.kps.size > a.kps.size ? b : a), null);
    coarse.idx.push(idx); coarse.t.push(t); coarse.kp.push(null);
    if (n++ % 2 === 0) {
      stage('scan', 0.05 + 0.3 * (idx / meta.frameCount), `Cerco i salti · ${Math.round((100 * idx) / meta.frameCount)}%`);
      cb.onPreview?.(cv, lead?.kps.get(fi) || null, { crop: FULL, t });
      await tick();
    }
  }
  // scelta della persona: tracce con almeno il 15 % dei fotogrammi; punteggio = copertura × (escursione verticale del bacino + 0,2)
  const nFrames = coarse.idx.length;
  const real = tracks.filter((tr) => tr.kps.size >= Math.max(5, 0.15 * nFrames));
  const scoreOf = (tr) => {
    const hy = [], hh = [];
    for (const k of tr.kps.values()) { hy.push((k[23 * 3 + 1] + k[24 * 3 + 1]) / 2); hh.push(heightOf(k)); }
    hy.sort((a, b) => a - b); const rng = hy.length > 4 ? hy[Math.floor(0.95 * (hy.length - 1))] - hy[Math.floor(0.05 * (hy.length - 1))] : 0;
    const bh = hh.sort((a, b) => a - b)[hh.length >> 1] || 0.3;
    return (tr.kps.size / nFrames) * (rng / bh + 0.2);
  };
  const pool = real.length ? real : tracks;
  const chosen = pool.reduce((a, b) => (!a || scoreOf(b) > scoreOf(a) ? b : a), null);
  if (chosen) for (const [i, kp] of chosen.kps) coarse.kp[i] = kp;
  session.people = real.length || (tracks.length ? 1 : 0);
  if (session.people > 1) log(`Persone rilevate: ${session.people}. Seguita quella con più movimento verticale.`);
  session.coarse = coarse;
  session.quality = assessRecording(meta, coarse, { aspect, tracks: session.people });
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
    // più persone: si segue l'atleta per continuità di posizione (coordinate del ritaglio) invece di prendere la posa più grande
    const multi = (session.people || 1) > 1;
    let prevC = null;
    if (multi) {
      const near = coarse.kp.map((k, i) => ({ k, d: Math.abs(coarse.t[i] - w.t0) })).filter((x) => x.k).sort((a, b) => a.d - b.d)[0];
      if (near) { const c = centerOf(near.k); prevC = [(c[0] - crop.x) / crop.w, (c[1] - crop.y) / crop.h]; }
    }
    for await (const { idx, t, frame } of src.frames({ from: w.t0, to: w.t1, signal })) {
      aborted();
      dctx.imageSmoothingQuality = 'high';
      src.drawCrop(frame, dctx, crop, dcv.width, dcv.height);
      let kp = pose.detect(dcv, multi ? { multi: true, near: prevC } : {});
      if (kp && multi) prevC = centerOf(kp);
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
        stage('dense', 0.38 + 0.42 * Math.min(1, done / totalFrames), `Tracciamento ad alta precisione · ${Math.min(99, Math.round((100 * done) / totalFrames))}%`);
        cb.onPreview?.(dcv, kp ? remapToCrop(kp, crop) : null, { crop, t, fps: meta.fps });
        await tick();
      }
    }
    session.windows.push(win);
  }
  src.dispose();
  stage('analyze', 0.8, 'Calcolo stacchi e atterraggi…');
  const params = { cal: opts.cal, testType: opts.testType, heightCm: opts.heightCm, massKg: opts.massKg, boxCm: opts.boxCm, leg: opts.leg };
  reanalyze(session, params);
  if (opts.refine !== false && session.jumps.some((j) => !j.manual)) {
    try { await refineEvents(session, opts, { stage, onPreview: cb.onPreview, log }, aborted); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      log('Rifinitura saltata: ' + (e.message || e));
      // senza rifinitura il risultato resta valido ma con ~1–2 cm di incertezza in più (misurato tra Full e Heavy): lo si dice
      session.quality?.items.push({ level: 'info', code: 'refine', text: `La rifinitura con il modello Heavy non è stata eseguita (${String(e.message || e).slice(0, 80)}): il risultato può differire di 1–2 cm da quello di un dispositivo che la esegue.` });
    }
  }
  stage('done', 1, 'Completato');
  return session;
}

/**
 * Rifinitura: rianalizza con il modello Heavy e la media immagine-normale/specchiata SOLO i fotogrammi attorno a stacco e
 * atterraggio (i soli che decidono il tempo di volo), usando i ritagli già salvati. Su video reale a 60 fps: rumore sui
 * piedi -30 %, volo 0,556 -> 0,535 s; basta ±0,15 s (la miscela di modelli non crea artefatti).
 */
async function refineEvents(session, opts, cb, aborted) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const plan = [];
  let total = 0;
  session.windows.forEach((win, wi) => {
    const tc = win.frames.map((f) => f.tc);
    const diffs = []; for (let i = 1; i < tc.length; i++) if (tc[i] > tc[i - 1]) diffs.push(tc[i] - tc[i - 1]);
    const dtc = diffs.length ? diffs.sort((a, b) => a - b)[diffs.length >> 1] : 1 / 30;
    const R = clamp(0.2, 8 * dtc, 40 * dtc);
    const want = new Set();
    for (const j of session.jumps) {
      if (j.win !== wi || j.manual) continue;
      for (const ev of [j.to, j.td]) for (let i = 0; i < tc.length; i++) if (Math.abs(tc[i] - ev) <= R) want.add(i);
    }
    if (want.size) { plan.push({ win, idx: [...want].sort((a, b) => a - b) }); total += want.size; }
  });
  if (!total) return;
  const before = session.jumps.map((j) => ({ win: j.win, to: j.to, T: j.T }));
  cb.stage('refine', 0.8, 'Carico il modello Heavy per la rifinitura…');
  pose.close(); // libera la memoria del modello usato per la scansione
  const rp = new PoseEngine();
  try {
    await rp.init({ model: 'heavy', delegate: opts.delegate || 'auto', onStatus: (s) => cb.stage('refine', 0.81, s) });
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    let done = 0, changed = 0;
    for (const { win, idx } of plan) {
      cv.width = win.cw; cv.height = win.ch;
      for (const i of idx) {
        aborted();
        const f = win.frames[i];
        const bmp = await createImageBitmap(f.blob);
        ctx.drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
        let opt = { flip: true };
        if ((session.people || 1) > 1 && f.kp) opt = { flip: true, multi: true, near: centerOf(remapToCrop(f.kp, win.crop)) };
        const kp = rp.detect(cv, opt);
        if (kp) {
          const crop = win.crop;
          const view = new Float32Array(kp);
          for (let q = 0; q < 33; q++) { kp[q * 3] = crop.x + kp[q * 3] * crop.w; kp[q * 3 + 1] = crop.y + kp[q * 3 + 1] * crop.h; }
          f.kp = kp; changed++;
          if (done % 2 === 0) cb.onPreview?.(cv, view, { crop, t: f.t });
        }
        if (++done % 2 === 0) { cb.stage('refine', 0.82 + 0.13 * (done / total), `Rifinitura stacco e atterraggio · ${Math.round((100 * done) / total)}%`); await tick(); }
      }
    }
    cb.log?.(`Rifinitura Heavy+specchio: ${changed}/${total} fotogrammi`);
  } finally { rp.close(); }
  cb.stage('analyze', 0.96, 'Calcolo stacchi e atterraggi…');
  reanalyze(session, {});
  session.meta.refined = true;
  // quanto il tempo di volo si è mosso con la rifinitura (relativo, così resta valido se cambia la calibrazione)
  session.refineInfo = session.windows.map(() => []);
  for (const j of session.jumps) {
    const b = before.find((x) => x.win === j.win && Math.abs(x.to - j.to) < 0.15);
    session.refineInfo[j.win].push(b ? { rel: Math.abs(j.T - b.T) / j.T, to: j.to } : { rel: 0, to: j.to });
  }
  applyRefineInfo(session);
}

/** Aggiunge all'incertezza di ogni salto lo spostamento dovuto alla rifinitura e lo segna come rifinito. */
function applyRefineInfo(session) {
  if (!session.refineInfo) return;
  session.results.forEach((res, wi) => {
    const info = session.refineInfo[wi] || [];
    res.jumps.forEach((j, k) => {
      if (!info[k]) return;
      j.refined = true;
      j.uncT = Math.hypot(j.uncT || 0, 0.5 * info[k].rel * j.T);
      j.uncCm = ((9.80665 * j.T * j.uncT) / 4) * 100;
    });
  });
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
    massKg: p.massKg ?? session.opts.massKg, boxCm: p.boxCm ?? session.opts.boxCm, leg: p.leg ?? session.opts.leg,
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
  applyRefineInfo(session);
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

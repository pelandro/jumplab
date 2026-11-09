// Pipeline di analisi in due passate:
//  1. SCANSIONE: tutto il video a ~30 fps su fotogramma intero -> dove sono i salti e dov'è l'atleta;
//  2. ALTA PRECISIONE: solo attorno ai salti, a TUTTI i fotogrammi nativi (es. 240 fps), sul ritaglio
//     stretto dell'atleta (più pixel sul corpo = landmark dei piedi più stabili).
// I fotogrammi analizzati sono conservati come JPEG per la revisione frame-per-frame.

import { openVideo } from './video.js';
import { pose, PoseEngine } from './pose.js';
import { analyze, remeasure, finalizeJump } from './jumps.js';
import { assessRecording } from './quality.js';
import { flagSeries, flagImplausible } from './validate.js';
import { planFlowRuns, aggregateFlowRuns, mergeFlowFallback } from './footflow.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const FULL = { x: 0, y: 0, w: 1, h: 1 };

/** Mappa il tempo del media sul tempo reale secondo la calibrazione scelta dall'utente. */
export function calibratedTime(frame, cal) {
  if (!cal || cal.mode === 'auto') return frame.t;
  if (cal.mode === 'scale') return frame.t / cal.value;
  if (cal.mode === 'fps') return frame.idx / cal.value;
  return frame.t;
}

/** Luminanza media del fotogramma e contrasto (deviazione standard della luminanza) attorno ai piedi: servono a segnalare video bui o piedi poco distinguibili. */
function sampleLight(ctx, w, h, kp, out) {
  const px = ctx.getImageData(0, 0, w, h).data;
  let sum = 0, cnt = 0;
  for (let o = 0; o < px.length; o += 16) { sum += (px[o] * 299 + px[o + 1] * 587 + px[o + 2] * 114) / 1000; cnt++; }
  out.luma.push(sum / cnt);
  if (!kp) return;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const q of [27, 28, 29, 30, 31, 32]) if (kp[q * 3 + 2] > 0.4) { x0 = Math.min(x0, kp[q * 3]); x1 = Math.max(x1, kp[q * 3]); y0 = Math.min(y0, kp[q * 3 + 1]); y1 = Math.max(y1, kp[q * 3 + 1]); }
  if (x1 <= x0 || y1 <= y0) return;
  const xa = Math.max(0, Math.floor((x0 - 0.03) * w)), xb = Math.min(w - 1, Math.ceil((x1 + 0.03) * w)), ya = Math.max(0, Math.floor((y0 - 0.04) * h)), yb = Math.min(h - 1, Math.ceil((y1 + 0.02) * h));
  let s1 = 0, s2 = 0, c = 0;
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const o = (y * w + x) * 4, l = (px[o] * 299 + px[o + 1] * 587 + px[o + 2] * 114) / 1000; s1 += l; s2 += l * l; c++; }
  if (c > 30) out.foot.push(Math.sqrt(Math.max(0, s2 / c - (s1 / c) ** 2)));
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
  const light = { luma: [], foot: [] };
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
    if (n % 6 === 0) sampleLight(ctx, cv.width, cv.height, lead?.kps.get(fi), light);
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
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN);
  session.quality = assessRecording(meta, coarse, { aspect, tracks: session.people, luma: med(light.luma), footContrast: med(light.foot) });
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
    // falso negativo della scansione rapida (salto non rilevato a ~30 fps): su video brevi si analizza tutto a frequenza piena
    if (opts.fullScan || dur <= 20) {
      wins.push({ t0: 0, t1: dur });
      if (!opts.fullScan) log('Nessun salto nella scansione rapida: analisi completa automatica (video breve).');
    }
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
  const totalFrames = wins.reduce((s, w) => s + (meta.fps * (w.t1 - w.t0)) / Math.max(1, Math.ceil(((w.t1 - w.t0) * meta.fps) / 500)), 0);
  let done = 0;
  const dcv = document.createElement('canvas'), dctx = dcv.getContext('2d', { willReadFrequently: true });
  for (const w of wins) {
    const inWin = coarse.kp.filter((_, i) => coarse.t[i] >= w.t0 && coarse.t[i] <= w.t1);
    const crop = cropFromBox(bboxOf(inWin), aspect);
    const cpx = crop.w * W, cpy = crop.h * H;
    const s = Math.min(1, 560 / Math.max(cpx, cpy));
    dcv.width = Math.max(32, Math.round(cpx * s)); dcv.height = Math.max(32, Math.round(cpy * s));
    const win = { t0: w.t0, t1: w.t1, crop, frames: [], cw: dcv.width, ch: dcv.height, dstep: 1 };
    let miss = 0;
    // Con 240 fps una finestra ha ~800 fotogrammi: oltre ~500 si analizza un fotogramma ogni `dstep` (240 → 120 fps effettivi). Misurato su video
    // reale: dimezzare i fps (120 → 60) sposta il volo di 1–2 ms, quindi il costo di precisione è trascurabile e il tempo di calcolo si dimezza.
    const dstep = Math.max(1, Math.ceil(((w.t1 - w.t0) * meta.fps) / 500));
    win.dstep = dstep;
    if (dstep > 1) log(`Finestra di ${Math.round((w.t1 - w.t0) * meta.fps)} fotogrammi: analizzo 1 ogni ${dstep} (${(meta.fps / dstep).toFixed(0)} fps effettivi)`);
    meta.denseStep = Math.max(meta.denseStep || 1, dstep);
    // più persone: si segue l'atleta per continuità di posizione (coordinate del ritaglio) invece di prendere la posa più grande
    const multi = (session.people || 1) > 1;
    let prevC = null;
    if (multi) {
      const near = coarse.kp.map((k, i) => ({ k, d: Math.abs(coarse.t[i] - w.t0) })).filter((x) => x.k).sort((a, b) => a.d - b.d)[0];
      if (near) { const c = centerOf(near.k); prevC = [(c[0] - crop.x) / crop.w, (c[1] - crop.y) / crop.h]; }
    }
    for await (const { idx, t, frame } of src.frames({ from: w.t0, to: w.t1, step: dstep, signal })) {
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
  stage('analyze', 0.8, 'Calcolo stacchi e atterraggi…');
  try {
    const params = { cal: opts.cal, testType: opts.testType, heightCm: opts.heightCm, massKg: opts.massKg, boxCm: opts.boxCm, leg: opts.leg, headline: opts.headline };
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
    if (opts.refine !== false && session.jumps.some((j) => !j.manual)) {
      try { await flowRefine(session, { stage, src, signal, debug: !!opts.debugDense }); }
      catch (e) { if (e.name === 'AbortError') throw e; session.flowError = String(e.stack || e.message || e).slice(0, 400); log('Eventi dai pixel saltati: ' + (e.message || e)); }
    }
  } finally { src.dispose(); }
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
          f.kpBase ??= f.kp; // landmark del modello di base: servono come seconda partenza del tracciamento dei pixel se quelli rifiniti falliscono
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

// posizione frazionaria (indice) di un tempo sulla linea dei fotogrammi, e inverso: permettono di conservare un evento anche se cambia la calibrazione
function posOf(tc, t) {
  if (!tc.length) return NaN;
  if (t <= tc[0]) return 0;
  for (let i = 0; i < tc.length - 1; i++) if (t < tc[i + 1]) return i + (t - tc[i]) / (tc[i + 1] - tc[i]);
  return tc.length - 1;
}
function timeAt(tc, pos) {
  const i = Math.max(0, Math.min(tc.length - 2, Math.floor(pos)));
  return tc[i] + (pos - i) * (tc[i + 1] - tc[i]);
}

/**
 * Fotogrammi NATIVI (passo 1) tra due tempi del file, ritagliati come la finestra (stessa scala) e in grigi. Con 240 fps la finestra principale è
 * campionata 1 su 2–3 (≤ ~500 fotogrammi): un singolo tracciamento a passo 12,5 ms oscilla di ±3–17 ms sugli istanti (misurato su video reale: stesso salto,
 * 529 ms a passo 4,2 ms contro 544 ms nell'app), mentre a passo nativo `flowEventsRobust` può ripetere la misura su sottocampionamenti e prendere la mediana.
 * Servono pochi fotogrammi (≈ 1,1 s attorno al volo) e nessuna posa: i landmark servono solo come punto di partenza della zona da seguire.
 */
async function denseGray(src, win, tFrom, tTo, cal, sc, signal) {
  const cv = document.createElement('canvas'); cv.width = win.cw; cv.height = win.ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  const out = { gray: [], t: [], tc: [] };
  for await (const { idx, t, frame } of src.frames({ from: tFrom, to: tTo, step: 1, signal })) {
    src.drawCrop(frame, ctx, win.crop, cv.width, cv.height);
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const g = new Uint8Array(cv.width * cv.height);
    for (let q = 0, o = 0; q < g.length; q++, o += 4) g[q] = (px[o] * 299 + px[o + 1] * 587 + px[o + 2] * 114) / 1000;
    out.gray.push(g); out.t.push(t); out.tc.push(calibratedTime({ t, idx }, cal) / sc);
  }
  return out;
}

/**
 * Landmark (coordinate del ritaglio) ai tempi `ts` del file, interpolati linearmente tra i due fotogrammi campionati che li racchiudono (o il più vicino se
 * uno dei due non ha il corpo). `which` = 'kp' (rifiniti) oppure 'kpBase' (modello di base, se esistono).
 */
function seedKps(frames, crop, ts, which) {
  const cache = new Map();
  const kpOf = (i) => {
    if (!cache.has(i)) { const f = frames[i], k = (which === 'kpBase' && f.kpBase) || f.kp; cache.set(i, k ? remapToCrop(k, crop) : null); }
    return cache.get(i);
  };
  let lo = 0;
  return ts.map((t) => {
    while (lo < frames.length - 2 && frames[lo + 1].t <= t) lo++;
    const hi = Math.min(frames.length - 1, lo + 1);
    const a = kpOf(lo), b = kpOf(hi);
    if (a && b && hi !== lo && frames[hi].t > frames[lo].t) {
      const u = Math.max(0, Math.min(1, (t - frames[lo].t) / (frames[hi].t - frames[lo].t)));
      const o = new Float32Array(a.length);
      for (let q = 0; q < a.length; q++) o[q] = q % 3 === 2 ? Math.min(a[q], b[q]) : a[q] + (b[q] - a[q]) * u;
      return o;
    }
    return a || b;
  });
}

/**
 * Stacco e atterraggio dai PIXEL del piede (footflow.js) sui ritagli già salvati. Si usano al posto dei landmark quando il tracciamento è
 * affidabile e non si discosta di più di 120 ms: verificato su video reale a 120 fps, dove i landmark erano in ritardo di 25 ms allo
 * stacco e 46 ms al primo contatto (o in anticipo di 87 ms con Heavy + specchio).
 */
export async function flowRefine(session, cb) {
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
  session.flowInfo = session.windows.map(() => []);
  const leg = session.params?.leg;
  const jumps = session.jumps.filter((j) => !j.manual);
  let nDense = 0;
  cb.stage('refine', 0.955, 'Tracciamento dei pixel del piede…');
  for (const [jk, j] of jumps.entries()) {
    cb.stage('refine', 0.955 + 0.04 * (jk / jumps.length), `Tracciamento dei pixel del piede · salto ${jk + 1}/${jumps.length}`);
    const win = session.windows[j.win];
    // Video rallentato non ancora calibrato: i secondi del file sono ×N più lenti di quelli reali e le finestre di tracciamento (in secondi)
    // risulterebbero troppo corte. Si lavora nel tempo fisico stimato (suggerimento di gravità); gli eventi si salvano come posizione di
    // fotogramma, quindi restano validi qualunque calibrazione scelga poi l'utente.
    const sc = j.timeScaleHint || 1;
    const tcAll = win.frames.map((f) => f.tc / sc);
    const jTo = j.to / sc, jTd = j.td / sc;
    let iA = tcAll.findIndex((t) => t >= jTo - 0.30), iB = -1;
    for (let i = 0; i < tcAll.length; i++) if (tcAll[i] <= jTd + 0.26) iB = i;
    if (iA < 0 || iB - iA < 12) { (session.flowSkip ||= []).push({ iA, iB, n: tcAll.length, to: j.to, td: j.td, tc0: tcAll[0], tc1: tcAll[tcAll.length - 1] }); continue; }
    cv.width = win.cw; cv.height = win.ch;
    let gray = [], kp = [], kpB = [], tc = [], dense = false;
    // Passo nativo: se la finestra principale è campionata più rada del video (240 fps → 1 su 2–3), i fotogrammi attorno al volo si rileggono tutti dal video.
    if (cb.src?.kind === 'webcodecs' && win.dstep > 1 && nDense < 8) {
      try {
        nDense++;
        const d = await denseGray(cb.src, win, win.frames[Math.max(0, iA - 1)].t, win.frames[Math.min(win.frames.length - 1, iB + 1)].t, session.cal || { mode: 'auto' }, sc, cb.signal);
        if (d.gray.length >= 2 * (iB - iA)) {
          gray = d.gray; tc = d.tc; dense = true;
          kp = seedKps(win.frames, win.crop, d.t, 'kp'); kpB = seedKps(win.frames, win.crop, d.t, 'kpBase');
        }
      } catch (e) { if (e.name === 'AbortError') throw e; (session.denseError ||= []).push(String(e.message || e).slice(0, 120)); }
    }
    if (!dense) {
      for (let i = iA; i <= iB; i++) {
        const f = win.frames[i];
        const bmp = await createImageBitmap(f.blob);
        ctx.drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
        const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const g = new Uint8Array(cv.width * cv.height);
        for (let q = 0, o = 0; q < g.length; q++, o += 4) g[q] = (px[o] * 299 + px[o + 1] * 587 + px[o + 2] * 114) / 1000;
        gray.push(g); tc.push(f.tc / sc); kp.push(f.kp ? remapToCrop(f.kp, win.crop) : null);
        kpB.push(f.kpBase || f.kp ? remapToCrop(f.kpBase || f.kp, win.crop) : null);
      }
    }
    if (cb.debug) (session.denseDebug ||= []).push({ jk, w: cv.width, h: cv.height, gray, tc, kp, kpB, jTo, jTd }); // solo per le prove: conserva i fotogrammi usati dai pixel
    const dts = []; for (let i = 1; i < tc.length; i++) if (tc[i] > tc[i - 1]) dts.push(tc[i] - tc[i - 1]);
    const dtPx = dts.length ? dts.sort((x, y) => x - y)[dts.length >> 1] : null;
    const fopts = { leg: leg === 'left' || leg === 'right' ? leg : undefined };
    // le stime (≈ 18 a passo nativo) si eseguono una alla volta cedendo il controllo all'interfaccia: la barra di avanzamento resta viva anche su telefono
    const runFlow = async (seeds) => {
      const plan = planFlowRuns(gray, cv.width, cv.height, tc, seeds, { to: jTo, td: jTd }, fopts), runs = [];
      for (const [q, f] of plan.entries()) {
        runs.push(f());
        if (q % 3 === 2) { cb.stage('refine', 0.955 + 0.04 * ((jk + (q + 1) / plan.length) / jumps.length), `Tracciamento dei pixel del piede · salto ${jk + 1}/${jumps.length}`); await tick(); }
      }
      return aggregateFlowRuns(runs);
    };
    let r = await runFlow(kp);
    // Se un evento manca con i landmark rifiniti (Heavy + specchio) si riprova con quelli di base (Full): su 8 prove reali con due modelli, in 1 caso Heavy
    // posizionava male la punta del piede (rampa a 88 px/s contro ~600) e l'app ricadeva sui landmark, che sbagliano di +40…+110 ms; con Full l'evento si trovava.
    if ((r.to == null || r.td == null) && win.frames.slice(iA, iB + 1).some((f) => f.kpBase && f.kp && f.kpBase !== f.kp)) {
      r = mergeFlowFallback(r, await runFlow(kpB), 'base');
    }
    session.flowInfo[j.win].push({
      leg: leg || 'both', posToLm: posOf(tcAll, jTo), posTdLm: posOf(tcAll, jTd),
      posTo: r.to != null ? posOf(tcAll, r.to) : null, posTd: r.td != null ? posOf(tcAll, r.td) : null, qTo: r.qTo, qTd: r.qTd,
      repTo: r.repeat?.to?.range ?? null, repTd: r.repeat?.td?.range ?? null, scale: sc, dense, dtPx,
      dbg: { n: gray.length, w: cv.width, h: cv.height, d: r.detail, kp0: kp[0] ? Array.from(kp[0].slice(93, 99)).map((v) => +v.toFixed(3)) : null },
    });
    await tick();
  }
  session.meta.flow = session.flowInfo.some((w) => w.some((x) => x.posTo != null || x.posTd != null));
  reanalyze(session, {});
}

/**
 * Istanti solo dai landmark (i pixel del piede non sono utilizzabili: frame rate sotto ~25 fps, poco contrasto, piede fuori ritaglio, ripetibilità
 * insufficiente). Su video reali, a qualsiasi frame rate, i landmark hanno ALLUNGATO il volo in tutti i casi osservati: +14…+30 ms (2 atleti, 240/120 fps),
 * +37…+110 ms (terzo atleta, 240 fps), +116 ms con lo stesso video ridotto a ~22 fps (+17 cm, che la validazione non vedeva perché tutti i metodi
 * dipendono dallo stesso istante di stacco). Quindi: avviso, incertezza degli istanti di 35 ms (1σ) e affidabilità al massimo «media».
 */
function noPixel(j, dt) {
  if (j.manual) return;
  const low = dt > 0.0105;
  j.issues.push({ level: 'warn', code: 'lmonly', text: low
    ? `Frame rate basso (${(1 / dt).toFixed(0)} fps): stacco e atterraggio sono stati stimati solo dai landmark del modello, che sui nostri video reali hanno allungato il volo di 15–115 ms (fino a +17 cm). Il valore è indicativo: registra in slow-motion (almeno 60 fps, meglio 240) o correggi i due fotogrammi a mano.`
    : 'Stacco e atterraggio sono stati stimati solo dai landmark del modello (il tracciamento dei pixel del piede non era affidabile: poco contrasto, piede fuori ritaglio, ripetibilità insufficiente o movimento). Sui nostri video reali i landmark hanno allungato il volo di 15–115 ms: controlla i due fotogrammi a mano.' });
  // σ degli istanti: 35 ms, e almeno 2,5 fotogrammi a frame rate basso (a ~22 fps l'errore osservato è stato +116 e +170 ms)
  j.lmOnly = true;
  j.scorePreLm = j.score; // affidabilità prima della penalità dovuta ai landmark: serve a riconoscere i falsi voli
  j.uncT = Math.hypot(j.uncT || 0, Math.max(0.035, 2.5 * dt));
  j.uncCm = ((9.80665 * j.T * j.uncT) / 4) * 100;
  j.score = Math.max(0, Math.min(j.score, low && dt > 0.02 ? 0.45 : 0.7) - 0.1);
  j.confidence = j.score >= 0.75 ? 'alta' : j.score >= 0.5 ? 'media' : 'bassa';
}

/** Applica gli eventi dai pixel salvati (se plausibili) ai salti calcolati dai landmark. */
function applyFlowInfo(session) {
  if (!session.flowInfo) return;
  const MAXD = 0.16; // landmark in ritardo di ~100 ms all'atterraggio (video reali: +37…+110 ms) e in anticipo fino a ~87 ms allo stacco; il tracciamento dei pixel ora è robusto a questi errori
  session.results.forEach((res, wi) => {
    const win = session.windows[wi], tc = win.frames.map((f) => f.tc);
    const infos = session.flowInfo[wi] || [];
    const dtc = res.sig?.dt || 1 / 30;
    for (const j of [...res.jumps]) {
      if (j.manual) continue;
      const pTo = posOf(tc, j.to), pTd = posOf(tc, j.td);
      // abbinamento in tempo fisico (non in fotogrammi): dopo una nuova calibrazione l'analisi dei landmark cambia (finestre in secondi) e gli eventi
      // si spostano; si sceglie il salto salvato più vicino entro 150 ms
      let info = null, bestD = Infinity;
      for (const x of infos) {
        if (x.leg !== (session.params?.leg || 'both')) continue;
        const d = (Math.abs(x.posToLm - pTo) + Math.abs(x.posTdLm - pTd)) * dtc;
        if (d < bestD && Math.abs(x.posToLm - pTo) * dtc <= 0.15 && Math.abs(x.posTdLm - pTd) * dtc <= 0.15) { bestD = d; info = x; }
      }
      if (!info) { noPixel(j, dtc); continue; }
      let to = j.to, td = j.td, srcTo = 'landmark', srcTd = 'landmark';
      const toPx = info.posTo != null ? timeAt(tc, info.posTo) : null, tdPx = info.posTd != null ? timeAt(tc, info.posTd) : null;
      // tolleranza in tempo fisico: con un video rallentato non calibrato i secondi del file sono ×N più lenti
      const maxd = MAXD * (j.timeScaleHint && (session.cal?.mode || 'auto') === 'auto' ? j.timeScaleHint : 1);
      if (toPx != null && Math.abs(toPx - j.to) <= maxd) { to = toPx; srcTo = 'pixel'; }
      if (tdPx != null && Math.abs(tdPx - j.td) <= maxd) { td = tdPx; srcTd = 'pixel'; }
      if (srcTo === 'landmark' && srcTd === 'landmark') { noPixel(j, dtc); continue; }
      const toLm = j.to, tdLm = j.td;
      editJump(session, j, to, td, false);
      // incertezza: floor di ±0,35 fotogrammi per evento + metà della discordanza tra i due stimatori e dispersione tra i piedi
      const sp = (q) => (q ? q.spread / 2 : 0);
      const both = srcTo === 'pixel' && srcTd === 'pixel';
      if (both) {
        // entrambi gli eventi dai pixel: il landmark non entra (è il metodo scartato). Per evento: passo temporale (±0,25 fotogrammi), dispersione
        // tra i due piedi e un minimo di 5 ms per la definizione stessa di contatto (inizio della frenata vs arresto della punta, misurato 5–8 ms).
        // Stima euristica, non validata contro una pedana.
        // + metà dell'intervallo tra i sottocampionamenti (ripetibilità misurata dentro l'app: ~2 ms in frontale, 10–16 ms allo stacco in laterale)
        const rp = (x) => (Number.isFinite(x) ? (x * ((j.timeScaleHint && (session.cal?.mode || 'auto') === 'auto') ? j.timeScaleHint : 1)) / 2 : 0); // x è in secondi fisici
        const dtp = Number.isFinite(info.dtPx) && (info.scale || 1) === 1 ? info.dtPx : dtc; // passo dei fotogrammi usati per i pixel (nativo se riletti dal video)
        // atleta piccolo nell'immagine: istanti meno ripetibili (misurato: fino a 8–18 ms con ~120 px, ≤ 4 ms con ~240 px)
        const bpx = session.quality?.bodyPx, sPx = bpx < 250 ? 0.010 : bpx < 400 ? 0.003 : 0;
        const ev = (q, r) => Math.hypot(0.25 * dtp, 0.005, sp(q), rp(r), sPx);
        j.uncT = Math.hypot(ev(info.qTo, info.repTo), ev(info.qTd, info.repTd));
      } else {
        // un istante dai pixel e l'altro dai landmark: quello dai landmark porta il loro errore tipico (vedi noPixel: σ 35 ms, almeno 2,5 fotogrammi).
        // Misurato con rumore forte su video reali: volo −13 e +60 ms (−2 e +9 cm) con un istante dai landmark.
        const sLm = Math.max(0.035, 2.5 * dtc);
        j.uncT = Math.hypot(Math.SQRT2 * 0.35 * dtc, 0.5 * (to - toLm), 0.5 * (td - tdLm), sp(info.qTo), sp(info.qTd), sLm);
        j.lmOnly = true;
        j.scorePreLm = j.score;
        j.score = Math.min(j.score, 0.7);
        j.confidence = j.score >= 0.75 ? 'alta' : j.score >= 0.5 ? 'media' : 'bassa';
        j.issues.push({ level: 'warn', code: 'lmhalf', text: `${srcTo === 'landmark' ? 'Lo stacco' : 'L\'atterraggio'} è stato stimato dai landmark del modello (il tracciamento dei pixel del piede non era affidabile: rumore, poco contrasto o piede coperto), l'altro istante dai pixel. Sui nostri video i landmark hanno allungato il volo di 15–115 ms: controlla quel fotogramma a mano.` });
      }
      j.uncCm = ((9.80665 * j.T * j.uncT) / 4) * 100;
      j.flow = { toLm, tdLm, dTo: to - toLm, dTd: td - tdLm, src: { to: srcTo, td: srcTd }, pixelBoth: both };
      // ripetibilità misurata (non l'accuratezza): dispersione delle 18 stime di ciascun istante, intervallo 10°–90° percentile ≈ 2,56σ
      j.repT = both && Number.isFinite(info.repTo) && Number.isFinite(info.repTd) ? Math.hypot(info.repTo, info.repTd) / 2.56 : NaN;
      const big = Math.max(Math.abs(to - toLm), Math.abs(td - tdLm));
      if (big > Math.max(0.03, 3 * dtc)) {
        j.issues.push({ level: 'info', code: 'flowdiff', text: `Il tracciamento dei pixel del piede e i landmark del modello differiscono (stacco ${((to - toLm) * 1000).toFixed(0)} ms, atterraggio ${((td - tdLm) * 1000).toFixed(0)} ms): usati i pixel, che seguono il piede reale.` });
        // gli stimatori non concordano: si abbassa un po' la confidenza (la correzione, anche se plausibile, non è confermata da un secondo metodo)
        j.score = Math.max(0, j.score - 0.1);
        j.confidence = j.score >= 0.75 ? 'alta' : j.score >= 0.5 ? 'media' : 'bassa';
      }
      j.flow.agree = big <= Math.max(0.03, 3 * dtc);
    }
  });
}

/** Validazione ibrida (volo / baricentro nello spazio / parabola) dopo che pixel e rifinitura hanno aggiornato istanti e incertezze; anomalie di serie. */
export function finalizeValidation(session) {
  session.jumps = session.results.flatMap((r) => r.jumps);
  for (const j of session.jumps) finalizeJump(j);
  flagImplausible(session.jumps);
  flagSeries(session.jumps);
}

/** Aggiunge all'incertezza di ogni salto lo spostamento dovuto alla rifinitura e lo segna come rifinito. */
function applyRefineInfo(session) {
  if (!session.refineInfo) return;
  session.results.forEach((res, wi) => {
    const info = session.refineInfo[wi] || [];
    res.jumps.forEach((j, k) => {
      if (!info[k]) return;
      j.refined = true;
      if (j.flow?.pixelBoth) return; // la rifinitura dei landmark non riguarda gli eventi presi dai pixel
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
    headline: p.headline ?? session.opts.headline,
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
  applyFlowInfo(session);
  session.jumps = session.results.flatMap((r) => r.jumps);
  applyRefineInfo(session);
  finalizeValidation(session);
  return session;
}

export { remapToCrop };

function paramsOf(session) {
  return session.params || { testType: session.opts.testType, heightCm: session.opts.heightCm, massKg: session.opts.massKg, boxCm: session.opts.boxCm };
}

/** Correzione manuale di stacco/atterraggio: ricalcola metriche e il contatto del salto successivo. */
export function editJump(session, jump, newTo, newTd, mark = true) {
  const res = session.results[jump.win];
  const params = paramsOf(session);
  const oldTd = jump.td;
  const contact = jump.contactStart != null ? newTo - jump.contactStart : null;
  const nj = remeasure(res, newTo, newTd, params, contact);
  const keep = { id: jump.id, win: jump.win, contactStart: jump.contactStart, contactSource: jump.contactSource, excluded: jump.excluded, ground: nj.ground };
  Object.assign(jump, nj, keep, { manual: mark });
  finalizeJump(jump);
  const next = res.jumps.find((j) => j !== jump && j.contactStart != null && Math.abs(j.contactStart - oldTd) < 1e-6);
  if (next) {
    next.contactStart = newTd;
    const nn = remeasure(res, next.to, next.td, params, next.to - newTd);
    Object.assign(next, nn, { id: next.id, win: next.win, contactStart: newTd, contactSource: next.contactSource, excluded: next.excluded, manual: next.manual });
    finalizeJump(next);
  }
  if (mark) flagSeries(session.jumps);
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
  flagSeries(session.jumps);
  return nj;
}

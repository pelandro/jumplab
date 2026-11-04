// Motore di analisi dei salti: da serie di pose a stacco/atterraggio, altezza, contatto, RSI.
//
// Idea di base (sostituisce la ricerca a soglia fissa della v3):
//  1. segnale "punto più basso dei piedi" (talloni/punte) a frequenza nativa del video;
//  2. i salti sono i picchi prominenti di quel segnale (robusto, non dipende da un "livello suolo" globale,
//     quindi funziona anche per drop jump dalla pedana);
//  3. stacco e atterraggio sono rifiniti con un fit "a cerniera" (piatto -> rampa) con risoluzione
//     sub-frame invece di una soglia, eliminando il bias sistematico della soglia;
//  4. ogni salto ha controlli fisici di coerenza (la curva del bacino in volo deve essere una parabola
//     con curvatura g) che rivelano anche slow-motion non calibrato.

import {
  isNum, clamp, median, percentile, mean, robustSigma, medianFilter, fillGaps,
  smooth, derivative, resampleUniform, findPeaks, hingeFit, hingeFit2, parabolaFit,
} from './signal.js';

export const G = 9.80665;

export const LM = {
  NOSE: 0, LSH: 11, RSH: 12, LHIP: 23, RHIP: 24, LKNEE: 25, RKNEE: 26,
  LANK: 27, RANK: 28, LHEEL: 29, RHEEL: 30, LTOE: 31, RTOE: 32,
};

export const TEST_TYPES = {
  cmj: { label: 'CMJ', long: 'Countermovement jump', needsDip: true },
  cmj_arms: { label: 'CMJ braccia', long: 'CMJ con spinta delle braccia', needsDip: true },
  sj: { label: 'Squat jump', long: 'Squat jump (partenza da fermo)', needsDip: true },
  dj: { label: 'Drop jump', long: 'Drop jump da pedana', needsDip: false },
  rebound: { label: 'Rimbalzi', long: 'Salti ripetuti / rebound', needsDip: false },
  free: { label: 'Libero', long: 'Salto libero', needsDip: false },
};

const VIS = 0.3;

/**
 * track: { t: number[] (secondi reali), kp: (Float32Array(33*3)|null)[], aspect: larghezza/altezza }
 * Le coordinate dei landmark sono normalizzate sul fotogramma orientato (0..1), y verso il basso.
 */
export function buildSignals(track, tune = {}) {
  const { t: tRaw, kp, aspect = 16 / 9 } = track;
  const N = tRaw.length;
  if (N < 6) return null;
  const col = () => new Float64Array(N).fill(NaN);
  const raw = {
    heelL: col(), heelR: col(), toeL: col(), toeR: col(), ankL: col(), ankR: col(),
    hip: col(), hipX: col(), sh: col(), nose: col(), kneeL: col(), kneeR: col(), vis: col(),
  };
  const get = (p, i) => (p && p[i * 3 + 2] >= VIS ? p[i * 3 + 1] : NaN);
  const getX = (p, i) => (p && p[i * 3 + 2] >= VIS ? p[i * 3] * aspect : NaN);
  const avgOf = (...v) => mean(v);
  for (let k = 0; k < N; k++) {
    const p = kp[k];
    if (!p) continue;
    raw.heelL[k] = get(p, LM.LHEEL); raw.heelR[k] = get(p, LM.RHEEL);
    raw.toeL[k] = get(p, LM.LTOE); raw.toeR[k] = get(p, LM.RTOE);
    raw.ankL[k] = get(p, LM.LANK); raw.ankR[k] = get(p, LM.RANK);
    raw.hip[k] = avgOf(get(p, LM.LHIP), get(p, LM.RHIP));
    raw.hipX[k] = avgOf(getX(p, LM.LHIP), getX(p, LM.RHIP));
    raw.sh[k] = avgOf(get(p, LM.LSH), get(p, LM.RSH));
    raw.nose[k] = get(p, LM.NOSE);
    raw.kneeL[k] = get(p, LM.LKNEE); raw.kneeR[k] = get(p, LM.RKNEE);
    raw.vis[k] = avgOf(p[LM.LHEEL * 3 + 2], p[LM.RHEEL * 3 + 2], p[LM.LTOE * 3 + 2], p[LM.RTOE * 3 + 2]);
  }

  // scala corporea: distanza naso-caviglie nei fotogrammi in piedi (unità: altezza fotogramma)
  const ext = [];
  for (let k = 0; k < N; k++) {
    const a = avgOf(raw.ankL[k], raw.ankR[k]);
    if (isNum(a) && isNum(raw.nose[k]) && a > raw.nose[k]) ext.push(a - raw.nose[k]);
  }
  if (ext.length < 5) return null;
  const bodyH = percentile(ext, 0.85) / 0.885;

  // griglia uniforme alla frequenza nativa (mediana)
  const diffs = [];
  for (let k = 1; k < N; k++) if (tRaw[k] > tRaw[k - 1]) diffs.push(tRaw[k] - tRaw[k - 1]);
  const dt = median(diffs);
  if (!(dt > 0)) return null;
  const grid = {};
  let tGrid = null;
  for (const key of Object.keys(raw)) {
    const r = resampleUniform(tRaw, raw[key], dt, dt * 3.5);
    grid[key] = r.y; tGrid = r.t;
  }
  const n = tGrid.length;
  const fw = tune.fw ?? (dt < 0.008 ? 5 : 3);
  const f = (a) => medianFilter(fillGaps(a, Math.max(1, Math.round(0.05 / dt))), fw);
  const foot = [f(grid.heelL), f(grid.toeL), f(grid.heelR), f(grid.toeR)];
  const ank = [f(grid.ankL), f(grid.ankR)];
  const footLow = new Float64Array(n).fill(NaN);
  const footLowAnkle = new Float64Array(n).fill(NaN);
  let validFoot = 0;
  for (let k = 0; k < n; k++) {
    let m = -Infinity;
    for (const s of foot) if (isNum(s[k]) && s[k] > m) m = s[k];
    let am = -Infinity;
    for (const s of ank) if (isNum(s[k]) && s[k] > am) am = s[k];
    if (am > -Infinity) footLowAnkle[k] = am + 0.035 * bodyH;
    if (m > -Infinity) { footLow[k] = m; validFoot++; }
    else if (am > -Infinity) footLow[k] = am + 0.035 * bodyH; // ripiego sulle caviglie
  }
  // Buchi lunghi sui piedi (sfocatura, occlusione): si colma con il bacino (che segue il corpo) + scarto piedi-bacino
  // interpolato tra prima e dopo il buco. È un ripiego: la copertura reale resta in footLowRaw e abbassa l'affidabilità.
  const footLowRaw = Float64Array.from(footLow);
  const hipS = f(grid.hip), maxGap = Math.round(0.25 / dt);
  for (let k = 0; k < n;) {
    if (isNum(footLow[k])) { k++; continue; }
    let e = k; while (e < n && !isNum(footLow[e])) e++;
    if (e - k <= maxGap && k > 0 && e < n) {
      const off = (a, b) => { const v = []; for (let i = a; i <= b; i++) if (isNum(footLow[i]) && isNum(hipS[i])) v.push(footLow[i] - hipS[i]); return v.length ? median(v) : NaN; };
      const o0 = off(Math.max(0, k - 4), k - 1), o1 = off(e, Math.min(n - 1, e + 3));
      if (isNum(o0) && isNum(o1)) for (let i = k; i < e; i++) if (isNum(hipS[i])) footLow[i] = hipS[i] + o0 + (o1 - o0) * ((i - k + 1) / (e - k + 1));
    }
    k = e;
  }
  return {
    t: tGrid, dt, n, fps: 1 / dt, bodyH, aspect,
    footLow, footLowRaw, footLowAnkle,
    hip: f(grid.hip), hipX: fillGaps(grid.hipX, 3), sh: f(grid.sh), nose: f(grid.nose),
    vis: fillGaps(grid.vis, 3),
    kneeL: f(grid.kneeL), kneeR: f(grid.kneeR),
    footCoverage: validFoot / n,
  };
}

function footSignal(sig) {
  const { t, dt } = sig;
  const filled = fillGaps(Float64Array.from(sig.footLow, (v) => -v), Math.round(0.08 / dt) + 1);
  const med = medianFilter(filled, dt < 0.008 ? 5 : 3);
  const half = clamp(Math.round(0.02 / dt), 1, 4);
  const us = smooth(t, med, half, 2);
  // rumore per campione stimato dalle differenze prime (insensibile a rampe lente)
  const d1 = [];
  for (let i = 1; i < filled.length; i++) d1.push(filled[i] - filled[i - 1]);
  const sigma = Math.max((robustSigma(d1) || 0) / Math.SQRT2, 0.0007);
  return { u: med, us, sigma };
}

/** Trova tutti i voli. Restituisce eventi grezzi con stacco/atterraggio sub-frame. */
export function detectFlights(sig, opts = {}) {
  const { t, dt, n, bodyH } = sig;
  const minFlight = opts.minFlight ?? 0.1, maxFlight = opts.maxFlight ?? 1.45;
  const minPromBH = opts.minPromBH ?? 0.04;
  const { u, us, sigma } = footSignal(sig);
  const minProm = Math.max(minPromBH * bodyH, 6 * sigma);
  const peaks = findPeaks(us, minProm, Math.max(1, Math.round(0.1 / dt)));
  const thC = Math.max(4 * sigma, 0.025 * bodyH);
  const flights = [];
  let lb = 0;
  for (const pk of peaks) {
    const p = pk.i;
    if (p <= lb) continue;
    // livello del suolo: percentile basso (robusto al rumore) delle finestre prima e dopo il picco;
    // il minimo tra i due gestisce la pedana del drop jump (il suolo è il livello più basso).
    const wl = Array.from(us.subarray(Math.max(lb, p - Math.round(2.5 / dt)), p + 1));
    const sideLevels = opts.testType !== 'dj' && opts.testType !== 'rebound';
    const wr = Array.from(us.subarray(p, Math.min(n, p + Math.round((sideLevels ? 3.0 : 1.5) / dt) + 1)));
    const gL = percentile(wl, 0.15), gR = percentile(wr, 0.15);
    const g0 = Math.min(gL, gR);
    // Il suolo può "scivolare" nell'immagine tra prima e dopo il salto (atleta ripreso di fronte che si
    // avvicina/allontana dalla camera, camera a mano): con un solo livello (il minimo) lo stacco viene cercato
    // contro un suolo che per quel lato non esiste e finisce all'inizio del segnale. Per i salti singoli
    // si usa quindi il suolo di ciascun lato; per drop jump e rimbalzi (pedana, serie di salti) resta il minimo.
    const search = (levA, levB) => {
      let a = p; while (a > lb && us[a] > levA + thC) a--;
      let b = p; while (b < n - 1 && us[b] > levB + thC) b++;
      return [a, b];
    };
    // Suolo LOCALE di ciascun lato: i bordi della rampa a metà altezza (robusti alla deriva, che è ≪ altezza
    // del volo) dicono dove guardare; il suolo è poi il livello basso appena prima dello stacco / dopo
    // l'atterraggio, non quello di tutta la finestra (che con la deriva è molto più basso a fine clip).
    let gA = g0, gB = g0;
    if (sideLevels) {
      const half = (g0 + us[p]) / 2;
      let hA = p; while (hA > lb && us[hA] > half) hA--;
      let hB = p; while (hB < n - 1 && us[hB] > half) hB++;
      gA = gL; gB = gR;
      if (hA > lb && hB < n - 1) {
        const loc = (a, b, fb) => (b - a >= 2 ? percentile(Array.from(us.subarray(a, b + 1)), 0.25) : fb);
        const rA = (p - hA) * dt, rB = (hB - p) * dt;
        const eA = hA - Math.round((0.6 * rA + 0.05) / dt), sA = Math.max(lb, eA - Math.round(Math.max(0.3, 0.8 * rA) / dt));
        const sB = hB + Math.round((0.6 * rB + 0.05) / dt), eB = Math.min(n - 1, sB + Math.round(Math.max(0.3, 0.8 * rB) / dt));
        gA = loc(sA, eA, gL); gB = loc(sB, eB, gR);
      }
    }
    let [iA, iB] = search(gA, gB);
    if (sideLevels && (iA <= lb || iB >= n - 1)) { [iA, iB] = search(g0, g0); gA = g0; gB = g0; }
    if (iA <= lb || iB >= n - 1) continue; // volo incompleto o senza contatto con il suolo
    const m = Math.max(3, Math.round(0.1 / dt));
    const tune = opts.tune || {};
    const Kb = Math.max(4, Math.round((tune.kb ?? 0.14) / dt)), Ka = 0; // lato suolo
    const Kp = Math.max(3, Math.round((tune.kp ?? 0.12) / dt)); // lato rampa
    // suolo inclinato (fit a due rette): robusto a deriva e passi dopo l'atterraggio; il piatto resta il ripiego
    const flat1 = tune.hinge === 1;
    const fitTo = (!flat1 && hingeFit2(t, u, Math.max(lb, iA - Kb), Math.min(p, iA + Kp), +1)) || hingeFit(t, u, Math.max(lb, iA - Math.round(0.08 / dt)), Math.min(p, iA + Math.round(0.05 / dt)), +1);
    const fitTd = (!flat1 && hingeFit2(t, u, Math.max(p, iB - Kp), Math.min(n - 1, iB + Kb), -1)) || hingeFit(t, u, Math.max(p, iB - Math.round(0.05 / dt)), Math.min(n - 1, iB + Math.round(0.08 / dt)), -1);
    // ripiego: attraversamento di soglia con interpolazione lineare
    const crossTo = () => {
      const level = gA + thC, a = us[iA], b = us[iA + 1];
      return t[iA] + ((level - a) / (b - a || 1e-9)) * dt;
    };
    const crossTd = () => {
      const level = gB + thC, a = us[iB - 1], b = us[iB];
      return t[iB - 1] + ((a - level) / (a - b || 1e-9)) * dt;
    };
    let to = fitTo ? fitTo.tau : crossTo();
    let td = fitTd ? fitTd.tau : crossTd();
    // sanità: la cerniera deve cadere vicino alla soglia grossolana
    if (!(to >= t[Math.max(0, iA - Kb)] && to <= t[Math.min(n - 1, iA + Kp + 1)]) && !(flat1)) to = crossTo();
    if (!(td >= t[Math.max(0, iB - Kp - 1)] && td <= t[Math.min(n - 1, iB + Kb)])) td = crossTd();
    const T = td - to;
    if (!(T >= minFlight && T <= maxFlight)) continue;
    const Gpre = percentile(Array.from(u.slice(Math.max(lb, iA - m), iA + 1)), 0.4);
    const Gpost = percentile(Array.from(u.slice(iB, Math.min(n, iB + m + 1))), 0.4);
    flights.push({
      to, td, T, iA, iB, p, Gpre, Gpost, sigma, thC,
      fitTo: fitTo ? { rmse: fitTo.rmse, v: fitTo.v } : null,
      fitTd: fitTd ? { rmse: fitTd.rmse, v: fitTd.v } : null,
      prom: pk.prom, vTo: fitTo ? fitTo.v : NaN, vTd: fitTd ? fitTd.v : NaN,
    });
    lb = iB;
  }
  return { flights, us, u, sigma };
}

function idxAt(sig, time) { return clamp(Math.round((time - sig.t[0]) / sig.dt), 0, sig.n - 1); }

function hipUpSignal(sig) {
  const filled = fillGaps(Float64Array.from(sig.hip, (v) => -v), Math.round(0.1 / sig.dt) + 1);
  const half = clamp(Math.round(0.03 / sig.dt), 1, 6);
  const sm = smooth(sig.t, filled, half, 2);
  const vel = derivative(sig.t, filled, clamp(Math.round(0.05 / sig.dt), 2, 12), 2);
  return { sm, vel };
}

/** Caduta da pedana (drop jump): cerca l'atterraggio precedente al volo e il livello della pedana. */
function findDropContact(sig, fl, us, sigma) {
  const { t, dt, bodyH } = sig;
  const thD = Math.max(5 * sigma, 0.03 * bodyH);
  let j = fl.iA;
  while (j > 0 && us[j] <= fl.Gpre + thD) j--;
  if (j <= 3) return null;
  const w0 = Math.max(0, j - Math.round(1.2 / dt)), w1 = Math.max(0, j - Math.round(0.06 / dt));
  const seg = Array.from(us.slice(w0, w1 + 1));
  const box = percentile(seg, 0.85) - fl.Gpre;
  if (!(box > 0.07 * bodyH)) return null;
  const Ka = Math.max(3, Math.round(0.05 / dt)), Kb = Math.max(4, Math.round(0.08 / dt));
  const { u } = footSignal(sig);
  const fit = hingeFit(t, u, j - Ka, j + Kb, -1);
  const td = fit ? fit.tau : t[j];
  if (!(td < fl.to)) return null;
  return { td, boxFh: box };
}

function phaseMetrics(sig, hip, toIdx, to) {
  const { t, dt, bodyH } = sig;
  const sigH = 0.003; // rumore tipico bacino in altezza-fotogramma
  const half = clamp(Math.round(0.05 / dt), 2, 12);
  let sumk2 = 0; for (let k = -half; k <= half; k++) sumk2 += k * k;
  const eps = Math.max(2.5 * sigH / (dt * Math.sqrt(sumk2)), 0.03 * bodyH);
  const lo = Math.max(0, toIdx - Math.round(2.5 / dt));
  let bottom = toIdx, minv = Infinity;
  for (let i = toIdx; i >= lo; i--) if (isNum(hip.sm[i]) && hip.sm[i] < minv) { minv = hip.sm[i]; bottom = i; }
  // inizio spinta: ultimo istante, risalendo dallo stacco, in cui il bacino non sale più
  let riseStart = toIdx, run = 0;
  const need = Math.max(2, Math.round(0.03 / dt));
  for (let i = toIdx; i > lo; i--) {
    if (hip.vel[i] > eps) { run = 0; riseStart = i; } else if (++run >= need) break;
  }
  // inizio contromovimento: risalendo dal fondo finché il bacino scende
  // (si attraversa prima la sosta in fondo, poi la discesa, finché il bacino non è di nuovo fermo)
  let onset = bottom, seenDescent = false;
  run = 0;
  const holdMax = Math.round(1.2 / dt), needDown = Math.max(2, Math.round(0.06 / dt));
  for (let i = bottom; i > lo; i--) {
    if (hip.vel[i] < -eps) { seenDescent = true; run = 0; onset = i; }
    else if (seenDescent ? ++run >= needDown : bottom - i > holdMax) break;
  }
  const refUp = median(Array.from(hip.sm.slice(Math.max(lo, onset - Math.round(0.1 / dt)), onset + 1)));
  const dip = isNum(refUp) ? refUp - hip.sm[bottom] : NaN;
  const back = Math.max(0, riseStart - Math.round(0.3 / dt));
  const cmDrop = hip.sm[back] - hip.sm[riseStart];
  const pushDist = hip.sm[toIdx] - hip.sm[bottom];
  return {
    dipFh: dip, cmDropFh: cmDrop, pushFh: pushDist,
    onsetT: t[onset], bottomT: t[bottom], riseStartT: t[riseStart],
    timeToTakeoff: to - t[onset], holdMoving: onset === bottom,
  };
}

/**
 * Calcola metriche e qualità per un volo con istanti (stacco/atterraggio) dati.
 * ctx: { heightCm, massKg, testType, contact?, boxFh?, boxCm? }
 */
export function describeJump(sig, cache, to, td, ctx = {}) {
  const { t, dt, bodyH } = sig;
  const T = td - to;
  const hM = (G * T * T) / 8;
  const heightCm = hM * 100;
  const v0 = (G * T) / 2;
  const userH = (ctx.heightCm || 175) / 100;
  const fhPerM = bodyH / (userH * 1.0);
  const issues = [];
  let score = 1;
  const add = (level, code, text, pen) => { issues.push({ level, code, text }); score -= pen; };

  const i0 = idxAt(sig, to), i1 = idxAt(sig, td);
  const hip = cache.hip;
  // quota massima dei piedi rispetto al suolo
  const gAvg = mean([cache.Gpre, cache.Gpost]);
  let peakU = -Infinity;
  for (let i = i0; i <= i1; i++) if (isNum(cache.us[i]) && cache.us[i] > peakU) peakU = cache.us[i];
  const riseFh = isNum(gAvg) && isFinite(peakU) ? peakU - gAvg : NaN;
  const riseCm = (riseFh / fhPerM) * 100;

  // coerenza balistica del bacino: curvatura = g
  const margin = Math.max(1, Math.round(0.08 * T / dt));
  const par = parabolaFit(t, hip.sm, i0 + margin, i1 - margin);
  let gRatio = NaN, timeScaleHint = null;
  if (par && par.c2 < 0) {
    gRatio = (-2 * par.c2) / (G * fhPerM);
    if (gRatio < 0.4) {
      const s = Math.sqrt(1 / gRatio);
      const near = [2, 3, 4, 6, 8, 10].reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a));
      if (Math.abs(near - s) / near < 0.35) timeScaleHint = near;
    }
  }
  if (timeScaleHint) add('bad', 'timescale', `La caduta libera misurata e' troppo lenta: il video sembra rallentato ${timeScaleHint}x. Imposta la calibrazione del tempo.`, 0.55);
  else if (isNum(gRatio) && (gRatio < 0.5 || gRatio > 2)) add('warn', 'ballistic', 'La traiettoria del bacino in volo non è coerente con la gravità: controlla i frame di stacco e atterraggio.', 0.25);

  if (isNum(riseCm) && heightCm > 8) {
    const r = riseCm / heightCm;
    if (r < 0.3 || r > 2.4) add('warn', 'footrise', 'L\'altezza dei piedi in volo non corrisponde al tempo di volo: possibile errore sui contatti.', 0.2);
  }
  // copertura dati sui piedi attorno agli eventi
  const cov = (() => {
    let ok = 0, tot = 0;
    const a = idxAt(sig, to - 0.2), b = idxAt(sig, td + 0.2);
    for (let i = a; i <= b; i++) { tot++; if (isNum(sig.footLowRaw[i])) ok++; }
    return tot ? ok / tot : 0;
  })();
  if (cov < 0.6) add('warn', 'coverage', 'Piedi poco visibili nel tracciamento attorno a stacco/atterraggio.', 0.3);
  else if (cov < 0.85) add('info', 'coverage', 'Alcuni fotogrammi senza piedi tracciati: risultato interpolato.', 0.1);

  if (ctx.fitFailed) add('info', 'fit', 'Stacco o atterraggio stimati a soglia (fit non convergente).', 0.15);
  const frameCm = (G * T * dt / 4) * 100; // errore di ±1 fotogramma su un contatto
  const rel = frameCm / Math.max(heightCm, 1);
  if (rel > 0.15) add('warn', 'fps', `Frequenza fotogrammi bassa: ±1 frame ≈ ±${frameCm.toFixed(1)} cm. Usa slow-motion 120/240 fps.`, 0.3);
  else if (rel > 0.07) add('info', 'fps', `±1 frame ≈ ±${frameCm.toFixed(1)} cm. Con 240 fps l'errore scenderebbe sotto 1 cm.`, 0.1);
  if (T > 1.1) add('info', 'long', 'Tempo di volo molto lungo: verifica che sia un salto singolo.', 0.1);

  // Incertezza (1σ) sul tempo di volo e sull'altezza: dh = g·T·dT/4
  const uncT = ctx.uncT ?? Math.SQRT2 * 0.35 * dt * 1.3;
  const uncCm = ((G * T * uncT) / 4) * 100;

  // Postura: il tempo di volo vale solo se bacino-piedi sono uguali allo stacco e all'atterraggio. Se si atterra più
  // flessi (bacino più basso) il volo si allunga e l'altezza è sovrastimata (letteratura: 2–11 %, ~2,5 cm).
  let postureDropCm = NaN, heightCorrCm = NaN;
  if (T < 1.5) {
    const nS = Math.max(1, Math.round(0.04 / dt));
    const hf = (a, b) => {
      const v = [];
      for (let i = Math.max(0, a); i <= Math.min(sig.n - 1, b); i++) if (isNum(sig.footLow[i]) && isNum(sig.hip[i])) v.push(sig.footLow[i] - sig.hip[i]);
      return v.length ? median(v) : NaN;
    };
    // finestre simmetriche attorno agli istanti: lo stacco ha le gambe estese e l'atterraggio il primo contatto; una finestra
    // solo "dopo" il contatto includerebbe già l'ammortizzazione e gonfierebbe la differenza
    const hTO = hf(i0 - nS, i0 + nS), hTD = hf(i1 - nS, i1 + nS);
    const dM = (hTO - hTD) / fhPerM;
    if (isNum(dM) && Math.abs(dM) < 0.3) {
      postureDropCm = dM * 100;
      // altezza h dal culmine tale che T = sqrt(2h/g) + sqrt(2(h+d)/g)
      let lo = 0, hi = 2;
      for (let q = 0; q < 50; q++) {
        const hm = (lo + hi) / 2;
        const fT = Math.sqrt((2 * hm) / G) + Math.sqrt((2 * Math.max(0, hm + dM)) / G);
        if (fT < T) lo = hm; else hi = hm;
      }
      heightCorrCm = lo * 100;
      // il rumore sui landmark è ~±2,5 cm (da 3 a 8 cm sullo stesso salto tra Heavy e Lite): solo differenze nette sono segnalate
      const over = heightCm - heightCorrCm;
      if (postureDropCm > 8) add('warn', 'landflex', `Atterraggio più flesso dello stacco (bacino circa ${postureDropCm.toFixed(0)} cm più basso): il tempo di volo può sovrastimare l'altezza di circa ${over.toFixed(1)} cm (stima corretta ${heightCorrCm.toFixed(1)} cm). Atterra con le gambe tese per confrontare i salti.`, 0.1);
      else if (postureDropCm < -8) add('info', 'tuck', 'Bacino più alto all\'atterraggio che allo stacco: possibile atterraggio sulle punte o gambe raccolte in volo.', 0);
    }
  }

  const ph = TEST_TYPES[ctx.testType]?.needsDip || !ctx.contact ? phaseMetrics(sig, hip, i0, to) : null;
  const j = {
    to, td, T, heightCm, v0, flightMs: T * 1000, uncT, uncCm, postureDropCm, heightCorrCm,
    contact: ctx.contact ?? null, contactSource: ctx.contactSource ?? null,
    riseCm, gRatio, timeScaleHint, frameCm, coverage: cov,
    dipCm: NaN, timeToTakeoff: NaN, rsiMod: NaN, rsi: NaN, rsiFlight: NaN, boxCm: ctx.boxCm ?? null,
    forceN: NaN, powerW: NaN, sayersW: NaN, cmDetected: false,
    onsetT: null, bottomT: null,
    ground: { pre: cache.Gpre, post: cache.Gpost },
  };
  if (isNum(j.contact) && j.contact > 0.04) {
    j.rsi = hM / j.contact;
    j.rsiFlight = T / j.contact;
  }
  if (ph) {
    j.dipCm = (ph.dipFh / fhPerM) * 100;
    j.onsetT = ph.onsetT; j.bottomT = ph.bottomT;
    j.timeToTakeoff = ph.timeToTakeoff;
    if (!isNum(j.contact)) j.rsiMod = hM / ph.timeToTakeoff;
    j.cmDetected = ph.cmDropFh / fhPerM > 0.04;
    const d = ph.pushFh / fhPerM;
    if (ctx.massKg > 0 && d > 0.05) {
      j.forceN = ctx.massKg * (G + (v0 * v0) / (2 * d));
      j.powerW = j.forceN * (v0 / 2);
    }
    if (ctx.testType === 'sj' && j.cmDetected) add('warn', 'cm_in_sj', 'Squat jump: rilevato un contromovimento prima della spinta (fermati 2 s nella posizione bassa).', 0.1);
    if ((ctx.testType === 'cmj' || ctx.testType === 'cmj_arms') && isNum(j.dipCm) && j.dipCm < 4) add('info', 'nodip', 'Contromovimento molto piccolo: il salto sembra partire da fermo.', 0);
  }
  if (ctx.massKg > 0) j.sayersW = 60.7 * heightCm + 45.3 * ctx.massKg - 2055;
  j.score = clamp(score, 0, 1);
  j.confidence = j.score >= 0.75 ? 'alta' : j.score >= 0.5 ? 'media' : 'bassa';
  j.issues = issues;
  return j;
}

/**
 * Analisi completa di una traccia. opts: { testType, heightCm, massKg, boxCm }
 */
export function analyze(track, opts = {}) {
  const sig = buildSignals(track, opts.tune || {});
  if (!sig) return { sig: null, jumps: [], error: 'Traccia troppo corta o corpo non rilevato' };
  const det = detectFlights(sig, opts);
  const hip = hipUpSignal(sig);
  const testType = opts.testType || 'free';
  const jumps = [];
  const wantsContacts = testType === 'dj' || testType === 'rebound';
  det.flights.forEach((fl, k) => {
    const prev = det.flights[k - 1];
    let contact = null, contactSource = null, boxCm = opts.boxCm ?? null;
    if (prev && fl.to - prev.td <= 1.5) { contact = fl.to - prev.td; contactSource = 'rimbalzo'; }
    else if (wantsContacts) {
      const fall = findDropContact(sig, fl, det.us, det.sigma);
      if (fall) {
        contact = fl.to - fall.td; contactSource = 'caduta';
        const userH = (opts.heightCm || 175) / 100;
        boxCm = boxCm ?? (fall.boxFh / (sig.bodyH / userH)) * 100;
      }
    }
    // incertezza (1σ) sugli istanti di stacco/atterraggio: ±0,35 fotogrammi (spread osservato tra modelli e risoluzioni
    // su video reale) combinata con il rumore dei piedi diviso la velocità della rampa
    const sE = (v) => Math.hypot(0.35 * sig.dt, isNum(v) && v > 0 ? det.sigma / v : 0) * (fl.fitTo && fl.fitTd ? 1 : 1.5);
    const jump = describeJump(sig, { ...det, hip, Gpre: fl.Gpre, Gpost: fl.Gpost }, fl.to, fl.td, {
      ...opts, contact, contactSource, boxCm, fitFailed: !fl.fitTo || !fl.fitTd, uncT: Math.hypot(sE(fl.vTo), sE(fl.vTd)),
    });
    jump.id = k + 1;
    jump.auto = true;
    jump.contactStart = contact != null ? fl.to - contact : null;
    jump.ground = { pre: fl.Gpre, post: fl.Gpost };
    jumps.push(jump);
  });
  return { sig, det, hip, jumps };
}

/** Ricalcola un salto dopo la correzione manuale degli eventi. */
export function remeasure(result, to, td, opts = {}, contact = null) {
  const { sig, det, hip } = result;
  const i0 = idxAt(sig, to), i1 = idxAt(sig, td);
  const m = Math.max(3, Math.round(0.1 / sig.dt));
  const Gpre = percentile(Array.from(det.u.slice(Math.max(0, i0 - m), i0 + 1)), 0.4);
  const Gpost = percentile(Array.from(det.u.slice(i1, Math.min(sig.n, i1 + m + 1))), 0.4);
  return describeJump(sig, { ...det, hip, Gpre, Gpost }, to, td, { ...opts, contact, contactSource: contact != null ? 'manuale' : null });
}

/** Riepilogo per serie di rimbalzi. */
export function summarizeSeries(jumps) {
  const withC = jumps.filter((j) => isNum(j.contact) && j.contact > 0);
  return {
    count: jumps.length,
    bestCm: Math.max(...jumps.map((j) => j.heightCm)),
    meanCm: mean(jumps.map((j) => j.heightCm)),
    meanContact: mean(withC.map((j) => j.contact)),
    meanRsi: mean(withC.map((j) => j.rsi)),
    bestRsi: withC.length ? Math.max(...withC.map((j) => j.rsi)) : NaN,
  };
}

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
import { validateJump } from './validate.js';

export const G = 9.80665;

// ---- Formule di riferimento (esportate per poterle verificare con valori noti) ----------------------------------------
/** Altezza dal tempo di volo: h = g·T²/8 (m). Valida se posizione del corpo allo stacco e all'atterraggio coincide. */
export const heightFromFlight = (T) => (G * T * T) / 8;
/** Samozino et al. 2008 (validato su pedana): F media = m·g·(h/hpo + 1); v media = sqrt(g·h/2); P media = F·v. h = altezza (m), hpo = corsa di spinta (m). */
export function samozino(mass, h, hpo) {
  const F = mass * G * (h / hpo + 1), v = Math.sqrt((G * h) / 2);
  return { F, v, P: F * v };
}
/** Sayers et al. 1999, equazione per squat jump: potenza di picco (W) da altezza (cm) e massa (kg). */
export const sayersPeakPower = (hCm, mass) => 60.7 * hCm + 45.3 * mass - 2055;
/** RSI = altezza del rimbalzo / tempo di contatto (m/s). Convenzionale: confronti tra atleti con cautela (Healy et al. 2019). */
export const rsiOf = (h, gct) => h / gct;

export const LM = {
  NOSE: 0, LSH: 11, RSH: 12, LHIP: 23, RHIP: 24, LKNEE: 25, RKNEE: 26,
  LANK: 27, RANK: 28, LHEEL: 29, RHEEL: 30, LTOE: 31, RTOE: 32,
};

// Segmenti di braccia e gambe (de Leva 1996, maschi): massa %, punti BlazePose prossimale/distale, frazione dal prossimale.
// Il tronco con la testa (50,4 % della massa) è il segnale di riferimento; qui solo ciò che se ne discosta.
const LIMB_SEGS = [
  ['arm', 0, 2.71, 11, 13, 0.5772], ['arm', 0, 1.62, 13, 15, 0.4574], ['arm', 0, 0.61, 15, 19, 0.5],
  ['arm', 1, 2.71, 12, 14, 0.5772], ['arm', 1, 1.62, 14, 16, 0.4574], ['arm', 1, 0.61, 16, 20, 0.5],
  ['leg', 0, 14.16, 23, 25, 0.4095], ['leg', 0, 4.33, 25, 27, 0.4459], ['leg', 0, 1.37, 29, 31, 0.4415],
  ['leg', 1, 14.16, 24, 26, 0.4095], ['leg', 1, 4.33, 26, 28, 0.4459], ['leg', 1, 1.37, 30, 32, 0.4415],
];

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
  // Salto su una gamba: la gamba libera può restare più in basso di quella d'appoggio e accorcia il volo misurato,
  // quindi si usano solo i punti del piede che salta ('left'/'right' = sinistra/destra della persona).
  const leg = tune.leg;
  const foot = leg === 'left' ? [f(grid.heelL), f(grid.toeL)] : leg === 'right' ? [f(grid.heelR), f(grid.toeR)] : [f(grid.heelL), f(grid.toeL), f(grid.heelR), f(grid.toeR)];
  const ank = leg === 'left' ? [f(grid.ankL)] : leg === 'right' ? [f(grid.ankR)] : [f(grid.ankL), f(grid.ankR)];
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
  const limb = buildLimb(tRaw, kp, dt, n, tGrid);
  return {
    t: tGrid, dt, n, fps: 1 / dt, bodyH, aspect, limb,
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

/**
 * Posizione verticale (coordinate immagine, giù = positivo) di ogni segmento di braccia e gambe RELATIVA AL TRONCO, sulla griglia
 * uniforme: buchi colmati (≤ 0,25 s) e lisciata (mediana su 5 campioni + media mobile 0,25 s): gli arti si spostano lentamente rispetto
 * al tronco e i loro punti sono rumorosi, quindi serve solo la loro deriva. `cov` ricorda dove il dato era vero.
 */
function buildLimb(tRaw, kp, dt, n, tGrid) {
  const N = tRaw.length, ok = (p, i) => p && p[i * 3 + 2] >= VIS;
  const trunk = new Float64Array(N).fill(NaN);
  for (let k = 0; k < N; k++) {
    const p = kp[k]; if (!p) continue;
    const sh = mean([ok(p, 11) ? p[34] : NaN, ok(p, 12) ? p[37] : NaN]), hp = mean([ok(p, 23) ? p[70] : NaN, ok(p, 24) ? p[73] : NaN]);
    if (isNum(sh) && isNum(hp)) trunk[k] = 0.53 * sh + 0.47 * hp;
  }
  const half = Math.max(1, Math.round(0.125 / dt));
  const segs = [];
  for (const [g, side, m, a, b, f] of LIMB_SEGS) {
    const rel = new Float64Array(N).fill(NaN);
    for (let k = 0; k < N; k++) {
      const p = kp[k];
      if (p && isNum(trunk[k]) && ok(p, a) && ok(p, b)) rel[k] = p[a * 3 + 1] + f * (p[b * 3 + 1] - p[a * 3 + 1]) - trunk[k];
    }
    const r = resampleUniform(tRaw, rel, dt, dt * 3.5).y;
    const cov = Uint8Array.from(r, (v) => (isNum(v) ? 1 : 0));
    const filled = medianFilter(fillGaps(r, Math.round(0.25 / dt)), 5);
    const sm = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      let sum = 0, c = 0;
      for (let q = Math.max(0, i - half); q <= Math.min(n - 1, i + half); q++) if (isNum(filled[q])) { sum += filled[q]; c++; }
      if (c) sm[i] = sum / c;
    }
    segs.push({ g, side, ty: segs.filter((q) => q.g === g && q.side === side).length, m, rel: sm, cov });
  }
  return { segs };
}

/**
 * Offset del baricentro del corpo intero rispetto al tronco (coordinate immagine, giù = positivo), nella finestra [i0, i1].
 * Formula additiva: tronco + testa (50,4 %) sono il riferimento, ogni tipo di segmento (braccio, avambraccio, mano, coscia, gamba, piede)
 * aggiunge m·(posizione − tronco). Per ciascun tipo si fa la media dei lati utilizzabili (dato continuo nella finestra dopo il colmare
 * dei buchi e almeno il 35 % di fotogrammi veri); se ne manca uno solo si assume il movimento simmetrico (salti bilaterali).
 * Braccio, coscia e gamba sono obbligatori (grosso della massa), mano, avambraccio e piede si omettono se non osservabili: senza
 * rinormalizzare, quindi senza salti quando un punto compare o scompare. Se mancano i segmenti obbligatori restituisce null (si resta sul tronco).
 */
function limbOffset(sig, i0, i1) {
  if (!sig.limb || sig.dt > 0.03) return null; // sotto ~33 fps pochi campioni per lisciare gli arti
  const out = new Float64Array(sig.n), len = i1 - i0 + 1;
  const lo = Math.max(0, i0 - 2), hi = Math.min(sig.n - 1, i1 + 2);
  const usable = (q) => {
    let c = 0;
    for (let i = i0; i <= i1; i++) { if (!isNum(q.rel[i])) return false; c += q.cov[i]; }
    return c >= 0.35 * len;
  };
  const types = [['arm', 0, true], ['arm', 1, false], ['arm', 2, false], ['leg', 0, true], ['leg', 1, true], ['leg', 2, false]]; // [gruppo, indice del segmento, obbligatorio]
  for (const [grp, ty, must] of types) {
    const segs = sig.limb.segs.filter((q) => q.g === grp && q.ty === ty && usable(q));
    if (!segs.length) { if (must) return null; continue; }
    for (let i = lo; i <= hi; i++) {
      let v = 0, c = 0;
      for (const q of segs) if (isNum(q.rel[i])) { v += q.rel[i]; c++; }
      if (c) out[i] += (2 * segs[0].m * (v / c)) / 100;
    }
  }
  return out;
}

/** Baricentro del tronco (de Leva: 47 % dalle spalle verso le anche), "su" positivo. Più ballistico del solo bacino. */
function trunkUpSignal(sig) {
  const raw = Float64Array.from(sig.hip, (h, i) => (isNum(h) && isNum(sig.sh[i]) ? -(0.53 * sig.sh[i] + 0.47 * h) : NaN));
  const filled = fillGaps(raw, Math.round(0.1 / sig.dt) + 1);
  const half = clamp(Math.round(0.03 / sig.dt), 1, 6);
  return { sm: smooth(sig.t, filled, half, 2), vel: derivative(sig.t, filled, clamp(Math.round(0.05 / sig.dt), 2, 12), 2), filled };
}

/**
 * Baricentro a corpo intero ("su" positivo) come serie continua sulla finestra [a, b], con velocità, per le fasi del salto (contromovimento,
 * spinta): include braccia e gambe, che il solo bacino non vede (con le braccia in spinta il baricentro sale più del bacino). null se gli arti non
 * sono osservabili in tutta la finestra.
 */
function comSignal(sig, trunk, a, b) {
  const off = limbOffset(sig, a, b);
  if (!off) return null;
  const filled = Float64Array.from(trunk.filled, (v, i) => v - off[i]);
  const half = clamp(Math.round(0.03 / sig.dt), 1, 6);
  return { sm: smooth(sig.t, filled, half, 2), vel: derivative(sig.t, filled, clamp(Math.round(0.05 / sig.dt), 2, 12), 2) };
}

/**
 * Altezza da VELOCITÀ DI STACCO: tra stacco e atterraggio il baricentro è in caduta libera, quindi il tempo che impiega ad arrivare al
 * culmine dà la velocità di stacco: v0 = g·(t_culmine − t_stacco), h = v0²/(2g). Come il metodo impulso-quantità di moto delle pedane, non
 * dipende da come si atterra (il tempo di volo sovrastima se si atterra più flessi) né dalla scala in pixel (il culmine è il vertice di
 * una parabola a curvatura libera). `series` = proxy del baricentro in ordine di preferenza ({name, sm}, "su" positivo).
 *
 * Il baricentro vero non è osservabile: si usa il tronco (spalle+anche, ~50 % della massa), meno rumoroso e più ripetibile del solo
 * bacino (su 4 salti reali: residuo balistico 0,2–0,5 cm contro 0,4–0,8 cm; differenza tra modelli 0,1–0,2 cm contro 0,3–1,0 cm;
 * intervallo al variare della finestra 0,1–0,9 cm contro 0,5–3,2 cm). L'incertezza viene dai dati: rumore dell'adattamento, finestra,
 * differenza tra proxy e istante di stacco (il culmine dipende da lui quasi quanto il tempo di volo).
 */
export function apexEstimate({ t, dt, series, to, td, uncT = 0 }) {
  const T = td - to;
  if (!(T > 0.1 && T < 1.5)) return null;
  const fitWith = (sm, cut) => {
    const m = Math.max(1, Math.round((cut * T) / dt));
    const i0 = Math.max(0, Math.round((to - t[0]) / dt)) + m, i1 = Math.min(t.length - 1, Math.round((td - t[0]) / dt)) - m;
    const pf = parabolaFit(t, sm, i0, i1);
    if (!pf || !(pf.c2 < 0) || pf.n < 12 || pf.n < 0.7 * (i1 - i0 + 1)) return null;
    const ta = pf.t0 - pf.c1 / (2 * pf.c2);
    if (!(ta > to + 0.2 * T && ta < td - 0.2 * T)) return null;
    const W = ((i1 - i0) * dt) / 2; // semi-ampiezza della finestra (s)
    const sigFit = pf.rmse / (W * Math.sqrt(pf.n / 3)) / (2 * -pf.c2); // errore casuale del vertice (s)
    return { ta, rmse: pf.rmse, sigFit, c0: pf.c0, c1: pf.c1, c2: pf.c2, t0: pf.t0, n: pf.n };
  };
  const res = [];
  for (const sr of series) {
    if (!sr?.sm) continue;
    const base = fitWith(sr.sm, 0.12);
    if (!base) continue;
    const alt = [0.08, 0.2].map((c) => fitWith(sr.sm, c)).filter(Boolean).map((f) => f.ta);
    res.push({ name: sr.name, ...base, alt: [base.ta, ...alt] });
  }
  if (!res.length) return null;
  const p = res[0];
  const sigWin = (Math.max(...p.alt) - Math.min(...p.alt)) / 2;
  // sistematico: i proxy del baricentro (corpo intero, tronco, bacino) danno culmini diversi; metà della distanza massima dal principale.
  // Con un solo proxy disponibile si assume lo scarto tipico osservato (6 ms)
  const sigProxy = res.length > 1 ? Math.max(...res.slice(1).map((r) => Math.abs(r.ta - p.ta))) / 2 : 0.006;
  const hOf = (ta) => ((G * (ta - to) ** 2) / 2) * 100, hs = res.map((r) => hOf(r.ta));
  const sigTa = Math.hypot(p.sigFit, sigWin, sigProxy, 0.003);
  const apexT = p.ta - to;
  const yAt = (tt) => p.c0 + p.c1 * (tt - p.t0) + p.c2 * (tt - p.t0) ** 2; // traiettoria adattata ("su" positivo, altezze di fotogramma)
  return {
    cm: ((G * apexT * apexT) / 2) * 100,
    uncCm: G * apexT * Math.hypot(sigTa, 0.7 * uncT) * 100,
    ta: p.ta, apexT, sigTa, c2: p.c2, yApex: yAt(p.ta), yTo: yAt(to), n: p.n,
    asymMs: (p.ta - (to + td) / 2) * 1000, // < 0: il culmine arriva prima della metà del volo (atterraggio più basso dello stacco)
    proxy: p.name,
    spreadCm: Math.max(...hs) - Math.min(...hs), // intervallo tra proxy (diagnostica)
    rmse: p.rmse,
  };
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

  // Altezza da velocità di stacco (culmine del tronco/bacino): vedi apexEstimate. Misurato su 4 salti reali: da 0,9 a 6,6 cm sotto
  // il tempo di volo, nel verso atteso dalla letteratura (volo − velocità di stacco ≈ 2,5 cm in media, fino al 18 % con caviglie flesse).
  const trunk = cache.trunk ?? trunkUpSignal(sig);
  let apexCm = NaN, apexUncCm = NaN, apexAsymMs = NaN, apexProxy = null, apexSpreadCm = NaN, apexV0 = NaN, apexV0Unc = NaN;
  let apexT = NaN, apexSigTa = NaN, apexRmseRel = NaN, geoCm = NaN, geoUncCm = NaN, apexInfo = null, standOf = null;
  {
    // baricentro a corpo intero = tronco + deriva delle braccia e delle gambe; se non osservabili si ripiega su tronco e bacino
    const off = limbOffset(sig, i0, i1);
    const series = off
      ? [{ name: 'corpo intero', sm: Float64Array.from(trunk.sm, (v, i) => v - off[i]) }, { name: 'tronco', sm: trunk.sm }, { name: 'bacino', sm: cache.hip?.sm }]
      : [{ name: 'tronco', sm: trunk.sm }, { name: 'bacino', sm: cache.hip?.sm }];
    const ae = apexEstimate({ t, dt, to, td, uncT, series });
    if (ae && !(ae.rmse > 0.02 * bodyH)) {
      apexInfo = ae; apexT = ae.apexT; apexSigTa = ae.sigTa; apexRmseRel = ae.rmse / bodyH;
      // metodo 2 (spazio): spostamento del baricentro tra stacco e culmine in metri con la scala dell'atleta (curvatura misurata, non g)
      geoCm = ((-ae.c2 * ae.apexT * ae.apexT) / fhPerM) * 100;
      geoUncCm = geoCm * Math.hypot(0.1, (2 * Math.hypot(ae.sigTa, 0.7 * uncT)) / ae.apexT);
      // riferimento della posizione iniziale con lo stesso baricentro usato per il culmine
      standOf = (a, b) => {
        if (b <= a + 3) return NaN;
        const o = ae.proxy === 'corpo intero' ? limbOffset(sig, a, b) : null;
        if (ae.proxy === 'corpo intero' && !o) return NaN;
        const base = ae.proxy === 'bacino' ? cache.hip?.sm : trunk.sm;
        const v = [];
        for (let i = a; i <= b; i++) { const x = base?.[i] - (o ? o[i] : 0); if (isNum(x)) v.push(x); }
        return v.length >= 3 ? median(v) : NaN;
      };
      apexCm = ae.cm; apexUncCm = ae.uncCm; apexAsymMs = ae.asymMs; apexProxy = ae.proxy; apexSpreadCm = ae.spreadCm;
      apexV0 = Math.sqrt(2 * G * (apexCm / 100)); // v = √(2·g·h); incertezza: dv = g·dh / v
      apexV0Unc = (G * (apexUncCm / 100)) / Math.max(apexV0, 0.1);
      if (heightCm > 8 && (heightCm - apexCm) / heightCm > 0.15) {
        add('info', 'apexdiff', `L'altezza da velocità di stacco (${apexCm.toFixed(1)} cm) è inferiore del ${(((heightCm - apexCm) / heightCm) * 100).toFixed(0)} % a quella da tempo di volo (${heightCm.toFixed(1)} cm): tipico di un atterraggio più flesso dello stacco (il tempo di volo sovrastima). Il valore reale sta probabilmente tra i due.`, 0);
      }
    }
  }

  // NOTA (v4.7.2): una misura "statica" di Δ (altezza del baricentro sopra il piede allo stacco meno all'atterraggio) NON è usata. Provata su 15 analisi di
  // 3 atleti: (a) senza riferimento al suolo coincide algebricamente con l'asimmetria del culmine (Δ = −b·T per una parabola), quindi non è indipendente;
  // (b) riferita al landmark del piede ha un bias di −7 ± 4,5 cm (a terra il landmark risulta già 8–14 cm sopra il suolo allo stacco e 4–8 cm al contatto);
  // (c) riferita al suolo stimato dai landmark dà −2 ± 7 cm, perché lo "spostamento del suolo" (fino a 13 cm) è la postura del piede e non un movimento reale;
  // (d) riferita al punto del piede tracciato dai pixel dà +2 ± 8 cm (zone diverse del piede allo stacco e all'atterraggio). Il canale resta in fusion.js.

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

  // Contromovimento e spinta (dip, spostamento di spinta per Samozino) dal baricentro a corpo intero; ripiego sul tronco, poi sul bacino
  let phSrc = hip, phName = 'bacino';
  const needsPh = TEST_TYPES[ctx.testType]?.needsDip || !ctx.contact;
  if (needsPh) {
    const lo = Math.max(0, i0 - Math.round(2.5 / dt));
    const cs = comSignal(sig, trunk, lo, i0);
    if (cs) { phSrc = cs; phName = 'corpo intero'; }
    else { let fin = 0; for (let i = lo; i <= i0; i++) if (isNum(trunk.sm[i])) fin++; if (fin >= 0.9 * (i0 - lo + 1)) { phSrc = trunk; phName = 'tronco'; } }
  }
  const ph = needsPh ? phaseMetrics(sig, phSrc, i0, to) : null;
  const j = {
    to, td, T, heightCm, v0, flightMs: T * 1000, uncT, uncCm, postureDropCm, heightCorrCm, apexCm, apexUncCm, apexAsymMs, apexProxy, apexSpreadCm, apexV0, apexV0Unc, apexT, apexSigTa, apexRmseRel, geoCm, geoUncCm,
    dt, fps: 1 / dt, fitFailed: !!ctx.fitFailed, scaleAssumed: !ctx.heightCm, testType: ctx.testType || null,
    riseFromStartCm: NaN, riseFromStartUncCm: NaN, takeoffRiseCm: NaN, ballisticCm: NaN,
    bestCm: NaN, bestUncCm: NaN, bestV0: NaN, bestV0Unc: NaN, landDeltaCm: NaN, landDeltaUncCm: NaN, bestW: NaN, hUseCm: heightCm, hUseSource: 'volo',
    massKg: ctx.massKg || 0, hpoM: NaN, headline: ctx.headline === 'flight' ? 'flight' : 'integrated',
    contact: ctx.contact ?? null, contactSource: ctx.contactSource ?? null,
    riseCm, gRatio, timeScaleHint, frameCm, coverage: cov,
    dipCm: NaN, timeToTakeoff: NaN, rsiMod: NaN, rsi: NaN, rsiFlight: NaN, boxCm: ctx.boxCm ?? null,
    forceN: NaN, powerW: NaN, sayersW: NaN, ftct: NaN, vMean: NaN, forceRel: NaN, powerRel: NaN, sayersRel: NaN, groundShiftCm: NaN, cmDetected: false,
    onsetT: null, bottomT: null,
    ground: { pre: cache.Gpre, post: cache.Gpost },
  };
  if (isNum(j.contact) && j.contact > 0.04) {
    j.rsiFlight = T / j.contact;
  }
  if (ph) {
    j.dipCm = (ph.dipFh / fhPerM) * 100;
    j.onsetT = ph.onsetT; j.bottomT = ph.bottomT;
    j.timeToTakeoff = ph.timeToTakeoff;
    j.cmDetected = ph.cmDropFh / fhPerM > 0.04;
    const d = ph.pushFh / fhPerM;
    j.phaseProxy = phName;
    j.hpoM = d; // spostamento di spinta (dal punto più basso allo stacco): serve a Samozino, calcolato in refreshDerived
    if (ctx.testType === 'sj' && j.cmDetected) add('warn', 'cm_in_sj', 'Squat jump: rilevato un contromovimento prima della spinta (fermati 2 s nella posizione bassa).', 0.1);
    if ((ctx.testType === 'cmj' || ctx.testType === 'cmj_arms') && isNum(j.dipCm) && j.dipCm < 4) add('info', 'nodip', 'Contromovimento molto piccolo: il salto sembra partire da fermo.', 0);
  }
  // Spostamento verticale del baricentro rispetto alla POSIZIONE INIZIALE (in piedi prima del contromovimento): diverso dall'altezza
  // balistica (sopra la posizione dello stacco), perché al decollo il baricentro è già più in alto (piedi sulle punte, braccia).
  if (apexInfo && standOf && isNum(j.onsetT)) {
    const ys = standOf(idxAt(sig, j.onsetT - 0.2), idxAt(sig, j.onsetT));
    if (isNum(ys)) {
      // spostamento = (stacco − posizione iniziale, in metri con la scala: piccolo) + (altezza balistica, da g: senza scala). Sommare in pixel
      // anche il volo porterebbe l'errore di scala (~6–14 %) su tutto lo spostamento.
      j.takeoffRiseCm = ((apexInfo.yTo - ys) / fhPerM) * 100;
      j.riseFromStartCm = j.takeoffRiseCm + apexCm;
      j.riseFromStartUncCm = Math.hypot(0.1 * Math.abs(j.takeoffRiseCm), apexUncCm);
    }
  }
  // Sayers et al. 1999 (equazione per squat jump; applicata a dati CMJ sovrastima il picco di potenza del ~2,7 %)
  if (ctx.massKg > 0) j.sayersW = sayersPeakPower(heightCm, ctx.massKg);
  // Rapporti utili: tempo di volo / tempo di contrazione (FT:CT) e velocità media di spinta (Samozino: v = sqrt(g·h/2))
  if (isNum(j.timeToTakeoff) && j.timeToTakeoff > 0.05) j.ftct = T / j.timeToTakeoff;
  if (ctx.massKg > 0) j.sayersRel = j.sayersW / ctx.massKg;
  // Suolo: differenza di livello tra stacco e atterraggio (positivo = il suolo appare più in basso all'atterraggio)
  j.groundShiftCm = isNum(cache.Gpre) && isNum(cache.Gpost) ? ((cache.Gpre - cache.Gpost) / fhPerM) * 100 : NaN;
  if (isNum(j.groundShiftCm) && Math.abs(j.groundShiftCm) > 15 && ctx.testType !== 'dj' && ctx.testType !== 'rebound') {
    add('info', 'groundshift', `Il suolo appare ${Math.abs(j.groundShiftCm).toFixed(0)} cm ${j.groundShiftCm > 0 ? 'più in basso' : 'più in alto'} all'atterraggio che allo stacco: l'atleta si è spostato verso/lontano dalla camera, la camera si è mossa o la superficie è diversa. Atterrare su un piano più alto o basso rende il tempo di volo non valido.`, 0);
  }
  j.score = clamp(score, 0, 1);
  j.confidence = j.score >= 0.75 ? 'alta' : j.score >= 0.5 ? 'media' : 'bassa';
  j.issues = issues;
  finalizeJump(j);
  return j;
}

/**
 * Curva del baricentro per il grafico delle fasi: posizione (cm, rispetto alla posizione in piedi) e velocità verticale (m/s, su = positivo) dal
 * contromovimento fino a dopo l'atterraggio, con il baricentro a corpo intero se gli arti sono osservabili (altrimenti tronco). È una
 * ricostruzione dai landmark, lisciata: serve a vedere le fasi e a controllare a colpo d'occhio che in volo la velocità scenda con pendenza −g (caduta
 * libera). NON dà la velocità di stacco: attorno allo stacco i punti del busto salgono più del baricentro (nei 4 salti reali il picco è ~1 m/s sopra il
 * valore balistico; coerente con la testa degli AirPods, 3,5–3,8 m/s contro ~2,7) e nel sintetico la lisciatura lo abbassa del 12 %. Il valore da usare
 * è quello ricavato dalla fase di volo (stima integrata).
 */
export function jumpCurve(result, j, heightM) {
  const { sig, trunk } = result || {};
  if (!sig || !trunk || !(heightM > 0)) return null;
  const { t, dt } = sig, i0 = idxAt(sig, j.to), i1 = idxAt(sig, j.td);
  const lo = Math.max(0, i0 - Math.round(2.5 / dt)), hi = Math.min(sig.n - 1, i1 + Math.round(0.6 / dt));
  const cs = comSignal(sig, trunk, lo, hi);
  const src = cs || trunk, name = cs ? 'corpo intero' : 'tronco';
  const fhPerM = sig.bodyH / heightM;
  const refI = idxAt(sig, isNum(j.onsetT) ? j.onsetT - 0.15 : j.to - 1.0), refJ = idxAt(sig, isNum(j.onsetT) ? j.onsetT : j.to - 0.5);
  const ref = median(Array.from(src.sm.slice(refI, Math.max(refI + 1, refJ) + 1)).filter(isNum));
  const out = { t: [], y: [], v: [], name, from: t[lo], to: t[hi] };
  for (let i = lo; i <= hi; i++) { out.t.push(t[i]); out.y.push(isNum(src.sm[i]) ? ((src.sm[i] - ref) / fhPerM) * 100 : NaN); out.v.push(isNum(src.vel[i]) ? src.vel[i] / fhPerM : NaN); }
  return out;
}

/** Valori che dipendono dall'altezza scelta come principale (integrata o tempo di volo): RSI, forza e potenza di Samozino, velocità media. */
export function refreshDerived(j) {
  const useBest = Number.isFinite(j.bestCm) && j.headline !== 'flight';
  j.hUseCm = useBest ? j.bestCm : j.heightCm;
  j.hUseSource = useBest ? 'integrata' : 'volo';
  const h = j.hUseCm / 100;
  if (isNum(j.contact) && j.contact > 0.04) j.rsi = rsiOf(h, j.contact);
  if (!isNum(j.contact) && isNum(j.timeToTakeoff) && j.timeToTakeoff > 0) j.rsiMod = h / j.timeToTakeoff;
  j.vMean = Math.sqrt((G * h) / 2);
  if (j.massKg > 0 && isNum(j.hpoM) && j.hpoM > 0.05) {
    // Samozino et al. 2008: F = m·g·(h/hpo + 1) = m·(g + v0²/(2·hpo)); P = F·v0/2. hpo = spostamento del baricentro dal punto più basso allo stacco
    const sz = samozino(j.massKg, h, j.hpoM);
    j.forceN = sz.F; j.powerW = sz.P; j.forceRel = sz.F / j.massKg; j.powerRel = sz.P / j.massKg;
  }
  return j;
}

/** Validazione ibrida, stima integrata e valori derivati: da richiamare ogni volta che istanti o incertezze cambiano. */
export function finalizeJump(j) {
  validateJump(j);
  return refreshDerived(j);
}

/**
 * Analisi completa di una traccia. opts: { testType, heightCm, massKg, boxCm }
 */
export function analyze(track, opts = {}) {
  const sig = buildSignals(track, { ...(opts.tune || {}), leg: opts.leg === 'left' || opts.leg === 'right' ? opts.leg : undefined });
  if (!sig) return { sig: null, jumps: [], error: 'Traccia troppo corta o corpo non rilevato' };
  const det = detectFlights(sig, opts);
  const hip = hipUpSignal(sig);
  const trunk = trunkUpSignal(sig);
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
    const jump = describeJump(sig, { ...det, hip, trunk, Gpre: fl.Gpre, Gpost: fl.Gpost }, fl.to, fl.td, {
      ...opts, contact, contactSource, boxCm, fitFailed: !fl.fitTo || !fl.fitTd, uncT: Math.hypot(sE(fl.vTo), sE(fl.vTd)),
    });
    jump.id = k + 1;
    jump.auto = true;
    jump.contactStart = contact != null ? fl.to - contact : null;
    jump.ground = { pre: fl.Gpre, post: fl.Gpost };
    jumps.push(jump);
  });
  return { sig, det, hip, trunk, jumps };
}

/** Ricalcola un salto dopo la correzione manuale degli eventi. */
export function remeasure(result, to, td, opts = {}, contact = null) {
  const { sig, det, hip, trunk } = result;
  const i0 = idxAt(sig, to), i1 = idxAt(sig, td);
  const m = Math.max(3, Math.round(0.1 / sig.dt));
  const Gpre = percentile(Array.from(det.u.slice(Math.max(0, i0 - m), i0 + 1)), 0.4);
  const Gpost = percentile(Array.from(det.u.slice(i1, Math.min(sig.n, i1 + m + 1))), 0.4);
  return describeJump(sig, { ...det, hip, trunk, Gpre, Gpost }, to, td, { ...opts, contact, contactSource: contact != null ? 'manuale' : null });
}

/** Riepilogo per serie di rimbalzi. */
export function summarizeSeries(jumps) {
  const withC = jumps.filter((j) => isNum(j.contact) && j.contact > 0);
  const hs = jumps.map((j) => (isNum(j.hUseCm) ? j.hUseCm : j.heightCm)), mh = mean(hs);
  const sd = hs.length > 1 ? Math.sqrt(hs.reduce((a, x) => a + (x - mh) ** 2, 0) / (hs.length - 1)) : NaN;
  const k = Math.max(1, Math.floor(hs.length / 3));
  const first = mean(hs.slice(0, k)), lastM = mean(hs.slice(-k));
  return {
    sdCm: sd, cvPct: (sd / mh) * 100,
    // calo di altezza tra il primo e l'ultimo terzo della serie (indice di fatica), solo con almeno 4 salti
    declinePct: hs.length >= 4 ? ((first - lastM) / first) * 100 : NaN,
    count: jumps.length,
    bestCm: Math.max(...jumps.map((j) => (isNum(j.hUseCm) ? j.hUseCm : j.heightCm))),
    meanCm: mean(jumps.map((j) => (isNum(j.hUseCm) ? j.hUseCm : j.heightCm))),
    meanContact: mean(withC.map((j) => j.contact)),
    meanRsi: mean(withC.map((j) => j.rsi)),
    bestRsi: withC.length ? Math.max(...withC.map((j) => j.rsi)) : NaN,
  };
}

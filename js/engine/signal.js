// Utility numerici per le serie temporali delle pose. Tutte le funzioni tollerano NaN.

export const isNum = Number.isFinite;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function median(arr) {
  const v = [];
  for (const x of arr) if (isNum(x)) v.push(x);
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function percentile(arr, p) {
  const v = [];
  for (const x of arr) if (isNum(x)) v.push(x);
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  const pos = clamp(p, 0, 1) * (v.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function mean(arr) {
  let s = 0, n = 0;
  for (const x of arr) if (isNum(x)) { s += x; n++; }
  return n ? s / n : NaN;
}

/** Deviazione standard robusta (1.4826 * MAD). */
export function robustSigma(arr) {
  const m = median(arr);
  if (!isNum(m)) return NaN;
  return 1.4826 * median(Array.from(arr, (x) => (isNum(x) ? Math.abs(x - m) : NaN)));
}

/** Filtro mediano mobile (finestra dispari w), ignora i NaN. */
export function medianFilter(y, w) {
  const n = y.length, h = w >> 1, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!isNum(y[i])) { out[i] = NaN; continue; }
    const win = [];
    for (let k = Math.max(0, i - h); k <= Math.min(n - 1, i + h); k++) if (isNum(y[k])) win.push(y[k]);
    win.sort((a, b) => a - b);
    out[i] = win[win.length >> 1];
  }
  return out;
}

/** Interpola linearmente i buchi (NaN) lunghi al massimo maxGap campioni. */
export function fillGaps(y, maxGap) {
  const n = y.length, out = Float64Array.from(y);
  let i = 0;
  while (i < n) {
    if (isNum(out[i])) { i++; continue; }
    let j = i;
    while (j < n && !isNum(out[j])) j++;
    if (i > 0 && j < n && j - i <= maxGap) {
      const a = out[i - 1], b = out[j];
      for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }
  return out;
}

/**
 * Regressione polinomiale locale (Savitzky-Golay su griglia non uniforme).
 * Restituisce il valore (deriv=0), la derivata prima (1) o seconda (2) in t[i].
 */
export function localPoly(t, y, i, half, order, deriv) {
  const n = y.length;
  const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
  const m = order + 1;
  const A = Array.from({ length: m }, () => new Float64Array(m));
  const b = new Float64Array(m);
  let cnt = 0;
  for (let k = lo; k <= hi; k++) {
    if (!isNum(y[k])) continue;
    cnt++;
    const x = t[k] - t[i];
    const p = [1];
    for (let q = 1; q < 2 * m; q++) p[q] = p[q - 1] * x;
    for (let r = 0; r < m; r++) {
      b[r] += y[k] * p[r];
      for (let c = 0; c < m; c++) A[r][c] += p[r + c];
    }
  }
  if (cnt < m) return NaN;
  const sol = solve(A, b);
  if (!sol) return NaN;
  return deriv === 0 ? sol[0] : deriv === 1 ? sol[1] : 2 * (sol[2] || 0);
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-18) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function smooth(t, y, half, order = 2) {
  const out = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = isNum(y[i]) ? localPoly(t, y, i, half, order, 0) : NaN;
  return out;
}

export function derivative(t, y, half, order = 2) {
  const out = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = localPoly(t, y, i, half, order, 1);
  return out;
}

/** Ricampiona (t,y) su griglia uniforme; NaN se il buco supera maxGapSec. */
export function resampleUniform(t, y, dt, maxGapSec) {
  const n = t.length;
  if (n < 2) return { t: Float64Array.from(t), y: Float64Array.from(y), dt };
  const count = Math.floor((t[n - 1] - t[0]) / dt) + 1;
  const gt = new Float64Array(count), gy = new Float64Array(count);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const tk = t[0] + k * dt;
    gt[k] = tk;
    while (j < n - 2 && t[j + 1] < tk) j++;
    const a = j, b = j + 1;
    if (Math.abs(t[a] - tk) < dt * 0.02 && isNum(y[a])) { gy[k] = y[a]; continue; }
    if (isNum(y[a]) && isNum(y[b]) && t[b] - t[a] <= maxGapSec) {
      const f = (tk - t[a]) / (t[b] - t[a]);
      gy[k] = y[a] + (y[b] - y[a]) * clamp(f, 0, 1);
    } else gy[k] = NaN;
  }
  return { t: gt, y: gy, dt };
}

/** Massimi locali con prominenza (come scipy.signal.find_peaks). */
export function findPeaks(y, minProm, minDist = 1) {
  const n = y.length, peaks = [];
  for (let i = 1; i < n - 1; i++) {
    if (!isNum(y[i]) || !(y[i] > y[i - 1] || !isNum(y[i - 1]))) continue;
    let j = i;
    while (j + 1 < n && y[j + 1] === y[i]) j++;
    if (j + 1 < n && !(y[j + 1] < y[i])) continue;
    const p = Math.round((i + j) / 2);
    let lmin = y[p], k = p - 1;
    while (k >= 0 && !(y[k] > y[p])) { if (isNum(y[k]) && y[k] < lmin) lmin = y[k]; k--; }
    let rmin = y[p]; k = p + 1;
    while (k < n && !(y[k] > y[p])) { if (isNum(y[k]) && y[k] < rmin) rmin = y[k]; k++; }
    const prom = y[p] - Math.max(lmin, rmin);
    if (prom >= minProm) peaks.push({ i: p, prom, lmin, rmin });
    i = j;
  }
  // distanza minima: tiene il picco più alto
  peaks.sort((a, b) => y[b.i] - y[a.i]);
  const kept = [];
  for (const pk of peaks) if (kept.every((q) => Math.abs(q.i - pk.i) >= minDist)) kept.push(pk);
  return kept.sort((a, b) => a.i - b.i);
}

/**
 * Fit "a cerniera": y = G + v*max(0, ±(t - tau)). Restituisce l'istante tau con
 * risoluzione sub-frame che minimizza l'errore quadratico.
 * dir=+1: il segnale sale dopo tau (stacco); dir=-1: il segnale scende fino a tau (atterraggio).
 */
export function hingeFit(t, y, i0, i1, dir, fixedG = NaN) {
  const lo = Math.max(0, i0), hi = Math.min(y.length - 1, i1);
  const idx = [];
  for (let k = lo; k <= hi; k++) if (isNum(y[k])) idx.push(k);
  if (idx.length < 5) return null;
  const dt = (t[hi] - t[lo]) / Math.max(1, hi - lo);
  const tA = t[idx[1]], tB = t[idx[idx.length - 2]];
  const steps = Math.max(20, Math.round((tB - tA) / (dt / 16)));
  let best = null;
  for (let s = 0; s <= steps; s++) {
    const tau = tA + ((tB - tA) * s) / steps;
    let n = 0, sb = 0, sbb = 0, sy = 0, sby = 0;
    for (const k of idx) {
      const bb = dir > 0 ? Math.max(0, t[k] - tau) : Math.max(0, tau - t[k]);
      n++; sb += bb; sbb += bb * bb; sy += y[k]; sby += bb * y[k];
    }
    let G, v;
    if (isNum(fixedG)) {
      G = fixedG;
      v = sbb > 1e-18 ? (sby - G * sb) / sbb : 0;
    } else {
      const det = n * sbb - sb * sb;
      if (Math.abs(det) < 1e-18) continue;
      v = (n * sby - sb * sy) / det;
      G = (sy - v * sb) / n;
    }
    if (v <= 0) continue;
    let sse = 0;
    for (const k of idx) {
      const bb = dir > 0 ? Math.max(0, t[k] - tau) : Math.max(0, tau - t[k]);
      const e = y[k] - (G + v * bb);
      sse += e * e;
    }
    if (!best || sse < best.sse) best = { tau, G, v, sse };
  }
  if (best) best.rmse = Math.sqrt(best.sse / idx.length);
  return best;
}

/**
 * Fit "suolo inclinato -> rampa" a due rette continue in tau, con pendenza libera sul lato del suolo (|a| <= ratio·v).
 * dir>0 = stacco (suolo prima, rampa verso l'alto dopo); dir<0 = atterraggio (rampa prima, suolo dopo).
 * Il suolo reale non è piatto: dopo l'atterraggio l'atleta può avvicinarsi alla camera o fare un passo, e con un
 * plateau piatto il punto di contatto scivola in avanti anche di 0,1 s.
 */
export function hingeFit2(t, y, i0, i1, dir, ratio = 0.35) {
  const lo = Math.max(0, i0), hi = Math.min(y.length - 1, i1);
  const idx = [];
  for (let k = lo; k <= hi; k++) if (isNum(y[k])) idx.push(k);
  if (idx.length < 7) return null;
  const dt = (t[hi] - t[lo]) / Math.max(1, hi - lo);
  const tA = t[idx[2]], tB = t[idx[idx.length - 3]];
  const steps = Math.max(24, Math.round((tB - tA) / (dt / 16)));
  let best = null;
  for (let st = 0; st <= steps; st++) {
    const tau = tA + ((tB - tA) * st) / steps;
    // features: 1, suolo (u su lato suolo), rampa (|u| su lato rampa)
    let n = 0, Sf = 0, Sr = 0, Sff = 0, Srr = 0, Sfr = 0, Sy = 0, Sfy = 0, Sry = 0;
    for (const k of idx) {
      const u = t[k] - tau;
      const f = dir > 0 ? Math.min(0, u) : Math.max(0, u);
      const r = dir > 0 ? Math.max(0, u) : Math.max(0, -u);
      n++; Sf += f; Sr += r; Sff += f * f; Srr += r * r; Sfr += f * r; Sy += y[k]; Sfy += f * y[k]; Sry += r * y[k];
    }
    const sol = solve3([[n, Sf, Sr], [Sf, Sff, Sfr], [Sr, Sfr, Srr]], [Sy, Sfy, Sry]);
    if (!sol) continue;
    let [G, a, v] = sol;
    if (!(v > 0)) continue;
    if (Math.abs(a) > ratio * v) a = Math.sign(a) * ratio * v; // pendenza del suolo limitata: ricalcolo G e v con a fissata
    if (Math.abs(a) >= ratio * v - 1e-12) {
      // con a fissata: minimi quadrati su (G, v) di y - a·f
      let m = 0, mr = 0, mrr = 0, my = 0, mry = 0;
      for (const k of idx) {
        const u = t[k] - tau;
        const f = dir > 0 ? Math.min(0, u) : Math.max(0, u);
        const r = dir > 0 ? Math.max(0, u) : Math.max(0, -u);
        const yy = y[k] - a * f;
        m++; mr += r; mrr += r * r; my += yy; mry += r * yy;
      }
      const det = m * mrr - mr * mr;
      if (Math.abs(det) < 1e-18) continue;
      v = (m * mry - mr * my) / det; G = (my - v * mr) / m;
      if (!(v > 0)) continue;
    }
    let sse = 0;
    for (const k of idx) {
      const u = t[k] - tau;
      const f = dir > 0 ? Math.min(0, u) : Math.max(0, u);
      const r = dir > 0 ? Math.max(0, u) : Math.max(0, -u);
      const e = y[k] - (G + a * f + v * r);
      sse += e * e;
    }
    if (!best || sse < best.sse) best = { tau, G, v, a, sse };
  }
  if (best) best.rmse = Math.sqrt(best.sse / idx.length);
  return best;
}

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < 3; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) { let sum = M[r][3]; for (let c = r + 1; c < 3; c++) sum -= M[r][c] * x[c]; x[r] = sum / M[r][r]; }
  return x;
}

/** Fit parabolico y = c0 + c1 x + c2 x^2 con x = t - t0. */
export function parabolaFit(t, y, i0, i1) {
  const pts = [];
  for (let k = Math.max(0, i0); k <= Math.min(y.length - 1, i1); k++) if (isNum(y[k])) pts.push(k);
  if (pts.length < 5) return null;
  const t0 = t[pts[Math.floor(pts.length / 2)]];
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const k of pts) {
    const x = t[k] - t0, p = [1, x, x * x];
    for (let r = 0; r < 3; r++) { b[r] += y[k] * p[r]; for (let c = 0; c < 3; c++) A[r][c] += p[r] * p[c] * (1); }
  }
  const sol = solve(A, b);
  if (!sol) return null;
  let sse = 0, sst = 0;
  const my = mean(pts.map((k) => y[k]));
  for (const k of pts) {
    const x = t[k] - t0, e = y[k] - (sol[0] + sol[1] * x + sol[2] * x * x);
    sse += e * e; sst += (y[k] - my) ** 2;
  }
  return { c0: sol[0], c1: sol[1], c2: sol[2], t0, r2: sst > 0 ? 1 - sse / sst : 0, rmse: Math.sqrt(sse / pts.length), n: pts.length };
}

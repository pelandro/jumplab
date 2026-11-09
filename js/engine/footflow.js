// Stacco e atterraggio dai PIXEL del piede (indipendente dal modello di postura).
//
// Perché: i landmark di BlazePose seguono il "modello" del piede, non i pixel. Misurato su video reale a 120 fps (verifica visiva
// dei fotogrammi): la punta del piede resta ferma per ~90 ms mentre il landmark sale di 30 px (il tallone si alza), e all'atterraggio
// il landmark si assesta 46 ms dopo il primo contatto delle punte. Sul pixel l'evento è netto: la zona del piede è ferma (suolo),
// poi parte una rampa ripida (volo), e viceversa all'atterraggio.
//
// Metodo: template matching (correlazione normalizzata a media zero, sub-pixel con parabola) di una zona attorno ai landmark di punte e
// talloni da un fotogramma al successivo; si integra lo spostamento verticale e si fitta "suolo inclinato → rampa" (hingeFit2).
// Stacco = ultimo piede che lascia il suolo; atterraggio = primo contatto, entrambi sull'avampiede (punte). Funzione pura: lavora su
// fotogrammi in scala di grigi, senza DOM.

import { hingeFit2, hingeQuad } from './signal.js';

const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
const median = (a) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

/** Spostamento (dx, dy, sub-pixel) della zona (cx, cy) tra il fotogramma A e B. Restituisce {dx, dy, cor} o null. */
export function matchStep(A, B, w, h, cx, cy, P, SX, SY) {
  const xi = Math.round(cx), yi = Math.round(cy);
  if (xi - P - SX < 0 || yi - P - SY < 0 || xi + P + SX >= w || yi + P + SY >= h) return null;
  const n = (2 * P + 1) * (2 * P + 1);
  const T = new Float32Array(n);
  let sT = 0, sTT = 0, q = 0;
  for (let y = -P; y <= P; y++) for (let x = -P; x <= P; x++) { const v = A[(yi + y) * w + xi + x]; T[q++] = v; sT += v; sTT += v * v; }
  const mT = sT / n; let vT = sTT - n * mT * mT;
  if (vT < 1e-3 * n) return null; // zona senza texture
  for (let i = 0; i < n; i++) T[i] -= mT;
  const nx = 2 * SX + 1, ny = 2 * SY + 1;
  const score = new Float32Array(nx * ny);
  let best = -2, bx = 0, by = 0;
  for (let oy = -SY; oy <= SY; oy++) {
    for (let ox = -SX; ox <= SX; ox++) {
      let sB = 0, sBB = 0, sTB = 0, k = 0;
      for (let y = -P; y <= P; y++) {
        const row = (yi + oy + y) * w + xi + ox;
        for (let x = -P; x <= P; x++) { const v = B[row + x]; sB += v; sBB += v * v; sTB += T[k++] * v; }
      }
      const vB = sBB - (sB * sB) / n;
      const c = vB > 1e-3 * n ? sTB / Math.sqrt(vT * vB) : -1;
      score[(oy + SY) * nx + ox + SX] = c;
      if (c > best) { best = c; bx = ox; by = oy; }
    }
  }
  const sub = (a, b2, c) => { const d = a - 2 * b2 + c; return Math.abs(d) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)); };
  const at = (ox, oy) => score[(oy + SY) * nx + ox + SX];
  const dx = bx > -SX && bx < SX ? sub(at(bx - 1, by), at(bx, by), at(bx + 1, by)) : 0;
  const dy = by > -SY && by < SY ? sub(at(bx, by - 1), at(bx, by), at(bx, by + 1)) : 0;
  return { dx: bx + dx, dy: by + dy, cor: best };
}

/** Segue una zona dal fotogramma i0 al fotogramma i1; restituisce lo spostamento verticale cumulato (px) e la correlazione. */
export function trackPatch(frames, w, h, c0, P, SX, SY, i0, i1, minCor = 0.45) {
  let cx = c0[0], cy = c0[1], y = 0;
  const dy = [0], cor = [1];
  for (let i = i0; i < i1; i++) {
    const m = matchStep(frames[i], frames[i + 1], w, h, cx, cy, P, SX, SY);
    if (!m || m.cor < minCor) break; // zona persa: la traccia si ferma qui
    cx += m.dx; cy += m.dy; y += m.dy;
    dy.push(y); cor.push(m.cor);
  }
  return { dy, cor };
}

/**
 * Raffinamento locale dell'evento: l'adattamento globale (suolo → rampa) usa tutta la traccia e, se il piede ruota o accelera in volo, la
 * posizione della cerniera dipende da quanta rampa c'è nella finestra. Misurato su 4 salti reali (240 fps): spostando di 0,10 s l'inizio
 * della finestra del contatto il volo variava di 25–80 ms (fino a 4–14 cm), perché l'atterraggio dei landmark può essere in ritardo di
 * ~100 ms e la finestra parte troppo tardi. Ripetendo l'adattamento in un intorno dell'evento (0,08 s dal lato suolo, 0,12 s dal lato rampa),
 * fino a convergenza, la variazione scende a 5–25 ms (mediana su finestre diverse: 3–12 ms).
 */
function refineLocal(t, u, f0, dir) {
  const dt = (t[t.length - 1] - t[0]) / Math.max(1, t.length - 1);
  const gnd = Math.max(0.08, 5 * dt), rmp = Math.max(0.12, 7 * dt); // almeno ~5 campioni dal lato suolo e ~7 dal lato rampa anche con passi lunghi (sottocampionamenti)
  const [before, after] = dir > 0 ? [gnd, rmp] : [rmp, gnd]; // durata prima / dopo l'evento (lato rampa più lungo)
  let tau = f0.tau, last = null;
  for (let it = 0; it < 4; it++) {
    let i0 = 0, i1 = t.length - 1;
    while (i0 < t.length - 1 && t[i0] < tau - before) i0++;
    while (i1 > 0 && t[i1] > tau + after) i1--;
    if (i1 - i0 < 8) break;
    const g = hingeQuad(t, u, i0, i1, dir) || hingeFit2(t, u, i0, i1, dir);
    if (!g) break;
    const moved = Math.abs(g.tau - tau);
    tau = g.tau; last = g;
    if (moved < 0.0005) break;
  }
  return last;
}

/** Fit dell'evento su una traccia verticale (su = positivo). dir>0 stacco, dir<0 atterraggio. */
function fitTrack(t, dy, cor, dir, hPx, dt, mode) {
  if (dy.length < 8) return null;
  const u = dy.map((v) => -v);
  let f = (mode === 'linear' ? null : hingeQuad(t, u, 0, u.length - 1, dir)) || hingeFit2(t, u, 0, u.length - 1, dir);
  if (!f) return null;
  if (mode !== 'global') f = refineLocal(t, u, f, dir) || f;
  const meanCor = cor.reduce((a, b) => a + b, 0) / cor.length;
  const vRel = f.v / hPx; // altezze-ritaglio al secondo
  // dopo l'evento servono almeno 3 fotogrammi realmente tracciati (plateau a terra per l'atterraggio, rampa per lo stacco) e prima almeno 3
  // (rampa / suolo): una traccia troncata da una zona persa darebbe un "contatto" falso
  const span = Math.max(2.2 * dt, 0.025); // con passi irregolari/lunghi 3 fotogrammi era troppo rigido (stacco valido scartato con 33 ms di rampa tracciata)
  const covered = t[t.length - 1] - f.tau >= span && f.tau - t[0] >= span;
  // qualità indipendente dal frame rate: residuo del fit piccolo rispetto alla salita attesa in 60 ms (v·0,06 s) e in assoluto
  const ok = covered && meanCor > 0.7 && vRel > 0.12 && f.rmse < 0.006 * f.v + 0.3;
  return { tau: f.tau, v: f.v, rmse: f.rmse, cor: meanCor, ok, gate: { covered, before: f.tau - t[0], after: t[t.length - 1] - f.tau, span, vRel } };
}

/**
 * gray: fotogrammi in grigi (Uint8/Float32Array w*h) per ogni indice; tc: tempi; kp: landmark in coordinate del ritaglio (0..1) o null;
 * rough: {to, td} dai landmark. opts: { leg: 'left'|'right'|undefined }.
 * Restituisce { to, td, qTo, qTd, detail } con null dove l'evidenza dei pixel non è affidabile.
 */
export function flowEvents(gray, w, h, tc, kp, rough, opts = {}) {
  const diffs = []; for (let i = 1; i < tc.length; i++) if (tc[i] > tc[i - 1]) diffs.push(tc[i] - tc[i - 1]);
  const dt = median(diffs) || 1 / 30;
  // zona più grande = stacco laterale più ripetibile (intervallo tra sottocampionamenti 16→8 ms e 10→7 ms) senza spostare le stime; 20 px peggiora il frontale
  const P = opts.P ?? clampInt(0.03 * h, 10, 18);
  const vmax = 1.5 * h * dt; // spostamento massimo plausibile per fotogramma
  const SY = clampInt(vmax * 1.3 + 3, 6, 48), SX = clampInt(vmax * 0.4 + 3, 4, 20);
  const side = (q) => (opts.leg === 'left' ? q % 2 === 1 : opts.leg === 'right' ? q % 2 === 0 : true); // 29,31 = sinistra; 30,32 = destra
  const idxAt = (t, dir) => { let k = -1; for (let i = 0; i < tc.length; i++) if (dir > 0 ? tc[i] >= t : tc[i] <= t) { k = i; if (dir > 0) break; } return k; };
  const point = (i, q) => { for (let d = 0; d < 4; d++) for (const j of [i + d, i - d]) { const k = kp[j]; if (k && k[q * 3 + 2] > 0.3) return [k[q * 3] * w + (opts.dx || 0), k[q * 3 + 1] * h + (opts.dy || 0)]; } return null; };
  const run = (tFrom, tTo, joints, dir) => {
    const i0 = idxAt(tFrom, 1), i1 = idxAt(tTo, -1);
    if (i0 < 0 || i1 - i0 < 8) return [];
    const out = [];
    for (const q of joints) {
      if (!side(q)) continue;
      const c0 = point(i0, q);
      if (!c0) continue;
      const tr = trackPatch(gray, w, h, c0, P, SX, SY, i0, i1);
      const t = tr.dy.map((_, k) => tc[i0 + k]);
      const fit = fitTrack(t, tr.dy, tr.cor, dir, h, dt, opts.fitMode);
      if (fit) out.push({ joint: q, ...fit, n: tr.dy.length });
    }
    return out;
  };
  const res = { to: null, td: null, qTo: null, qTd: null, detail: { P, SX, SY, dt } };
  // sotto ~25 fps lo spostamento per fotogramma è troppo grande e la rampa troppo corta: errori fino a 86 ms misurati a 15 fps equivalenti
  if (dt > 0.04) { res.detail.skipped = 'fps'; return res; }
  if (Number.isFinite(rough.to)) {
    const r = run(rough.to - Math.max(0.22, 7 * dt), rough.to + Math.max(opts.toPost ?? 0.12, 5 * dt), [31, 32], +1);
    const good = r.filter((x) => x.ok);
    res.detail.to = r;
    if (good.length) { res.to = Math.max(...good.map((x) => x.tau)); res.qTo = { n: good.length, cor: median(good.map((x) => x.cor)), spread: Math.max(...good.map((x) => x.tau)) - Math.min(...good.map((x) => x.tau)) }; }
  }
  if (Number.isFinite(rough.td)) {
    const r = run(rough.td - Math.max(opts.tdPre ?? 0.15, 5 * dt), rough.td + Math.max(0.22, 7 * dt), [31, 32], -1); // solo avampiede: le zone del tallone danno falsi plateau (verificato su video reale)
    const good = r.filter((x) => x.ok);
    res.detail.td = r;
    if (good.length) { res.td = Math.min(...good.map((x) => x.tau)); res.qTd = { n: good.length, cor: median(good.map((x) => x.cor)), spread: Math.max(...good.map((x) => x.tau)) - Math.min(...good.map((x) => x.tau)) }; }
  }
  return res;
}

/**
 * Versione robusta. Ogni evento è la MEDIANA di molte stime dello stesso video, ottenute variando ciò che non dovrebbe contare:
 *   · i fotogrammi usati (con passo ≤ ~10 ms: tutti, 1 su 2 in due fasi, 1 su 3 in tre fasi);
 *   · la finestra di tracciamento (inizio della finestra del contatto 0,15 / 0,25 / 0,35 s prima della stima dei landmark; fine di quella dello stacco
 *     0,12 / 0,20 / 0,16 s dopo). Con landmark in ritardo di ~100 ms all'atterraggio la finestra standard lascia poca discesa prima del contatto.
 * L'intervallo tra il 10° e il 90° percentile misura la ripetibilità (quanto l'evento dipende da quelle scelte): serve soprattutto allo stacco in
 * ripresa laterale, dove il piede ruota e una singola stima oscilla di ±9–17 ms (misurato). Servono almeno metà delle stime valide; intervallo
 * > 30 ms = non affidabile (evento non usato). Con passo > 10,5 ms si varia solo la finestra (3 stime).
 */
const WINDOWS = [{ tdPre: 0.15, toPost: 0.12 }, { tdPre: 0.25, toPost: 0.20 }, { tdPre: 0.35, toPost: 0.16 }];

/**
 * Media 3×3 (separabile) di un fotogramma in grigi. Misurato su 4 salti reali degradati: con poca luce e rumore del sensore (luminanza ×0,3 e rumore σ≈6)
 * il volo si spostava di 12–18 ms in 2 salti su 4 (e un atterraggio era perso); con questo filtro lo scarto resta entro 3 ms, e sul video pulito il volo
 * cambia di non più di 0,6 ms. Una media 5×5 o una zona più grande peggiorano il caso pulito (fino a 4–6 ms).
 */
export function smooth3(g, w, h) {
  const t = new Uint16Array(g.length), o = new Uint8Array(g.length);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) t[r + x] = g[r + Math.max(0, x - 1)] + g[r + x] + g[r + Math.min(w - 1, x + 1)];
  }
  for (let y = 0; y < h; y++) {
    const a = Math.max(0, y - 1) * w, b = y * w, c = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) o[b + x] = (t[a + x] + t[b + x] + t[c + x] + 4) / 9;
  }
  return o;
}

/** Elenco delle singole stime da eseguire (funzioni senza argomenti): permette al chiamante di cedere il controllo all'interfaccia tra una e l'altra. */
export function planFlowRuns(gray, w, h, tc, kp, rough, opts = {}) {
  if (opts.pre !== false) gray = gray.map((g) => smooth3(g, w, h));
  const diffs = []; for (let i = 1; i < tc.length; i++) if (tc[i] > tc[i - 1]) diffs.push(tc[i] - tc[i - 1]);
  const dt = median(diffs) || 1 / 30;
  const subs = dt > 0.0105 ? [[1, [0]]] : [[1, [0]], [2, [0, 1]], [3, [0, 1, 2]]];
  const plan = [];
  for (const [step, phases] of subs) {
    for (const ph of phases) {
      const idx = []; for (let i = ph; i < tc.length; i += step) idx.push(i);
      const g = step === 1 ? gray : idx.map((i) => gray[i]), t = step === 1 ? tc : idx.map((i) => tc[i]), k = step === 1 ? kp : idx.map((i) => kp[i]);
      for (const win of WINDOWS) plan.push(() => flowEvents(g, w, h, t, k, rough, { ...opts, ...win }));
    }
  }
  return plan;
}

/** Combina le stime: mediana per evento, ripetibilità = intervallo 10°–90° percentile, rifiuto se meno di metà valide o intervallo > 30 ms. */
export function aggregateFlowRuns(runs) {
  const base = runs[0];
  const agg = (key) => {
    const v = runs.map((r) => r[key]).filter((x) => x != null).sort((a, b) => a - b);
    if (v.length < Math.max(2, Math.ceil(0.5 * runs.length))) return { val: null, n: v.length, range: NaN };
    const at = (q) => v[Math.round(q * (v.length - 1))];
    return { val: v[v.length >> 1], n: v.length, range: at(0.9) - at(0.1) };
  };
  const a = agg('to'), b = agg('td');
  const out = { ...base, to: null, td: null, repeat: { to: a, td: b } };
  if (a.val != null && a.range <= 0.03) { out.to = a.val; out.qTo = base.qTo || { n: 1, cor: NaN, spread: 0 }; }
  if (b.val != null && b.range <= 0.03) { out.td = b.val; out.qTd = base.qTd || { n: 1, cor: NaN, spread: 0 }; }
  return out;
}

export function flowEventsRobust(gray, w, h, tc, kp, rough, opts = {}) {
  return aggregateFlowRuns(planFlowRuns(gray, w, h, tc, kp, rough, opts).map((f) => f()));
}

/**
 * Completa gli eventi mancanti di `r` con quelli di `r2` (stessa misura, altri landmark di partenza). `r.repeat` può essere null (passo > 10,5 ms:
 * nessun sottocampionamento) o avere un solo evento: il risultato ha sempre `repeat` nullo oppure con entrambe le chiavi.
 */
export function mergeFlowFallback(r, r2, tag = 'base') {
  const out = { ...r, seed: { ...(r.seed || {}) } };
  for (const [ev, q] of [['to', 'qTo'], ['td', 'qTd']]) {
    if (out[ev] != null || r2[ev] == null) continue;
    out[ev] = r2[ev]; out[q] = r2[q]; out.seed[ev] = tag;
    if (r2.repeat && r2.repeat[ev]) out.repeat = { to: out.repeat?.to ?? r2.repeat.to, td: out.repeat?.td ?? r2.repeat.td, [ev]: r2.repeat[ev] };
  }
  return out;
}

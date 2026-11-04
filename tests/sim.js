// Simulatore fisico di atleti per testare il motore di analisi senza video.
// Produce "pose" sintetiche (33 landmark) con rumore, buchi e outlier realistici.
// ATTENZIONE: valida la matematica del motore, NON la qualità del modello di postura reale.

const g = 9.80665;

export function rng(seed) {
  let s = seed >>> 0;
  const u = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, gauss };
}

// Interpolazione di Hermite cubica tra chiavi (t, valore, velocità)
function hermite(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, y0, v0] = keys[i], [t1, y1, v1] = keys[i + 1];
    if (t <= t1) {
      const h = t1 - t0, s = (t - t0) / h;
      const s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * h * v0 + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * h * v1;
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * Scenario: lista di fasi. Restituisce funzioni hip(t), toe(t), heel(t) (m dal suolo) e verità
 * [{to, td}] per ogni volo.
 */
export function buildScenario(kind, p = {}) {
  const H0 = 0.95, L = 1.0; // altezza bacino in piedi, lunghezza gamba estesa
  const truth = [];
  const segs = []; // {t0,t1,hip(t),foot:'contact'|'flight', info}
  const T = p.T ?? 0.5, v0 = (g * T) / 2;
  const Hto = L + 0.0;
  const flightSeg = (to, T_) => {
    const v = (g * T_) / 2;
    truth.push({ to, td: to + T_ });
    return {
      t0: to, t1: to + T_, flight: true,
      hip: (t) => Hto + v * (t - to) - 0.5 * g * (t - to) ** 2,
      tuck: (t) => 0.13 * Math.sin((Math.PI * (t - to)) / T_) ** 2,
    };
  };
  if (kind === 'cmj' || kind === 'sj') {
    const depth = p.depth ?? 0.3, tPush = 0.28, tDown = kind === 'sj' ? 0.7 : 0.5;
    const t1 = 1.0, tb = t1 + tDown, to = tb + tPush;
    const keys = kind === 'sj'
      ? [[0, H0, 0], [t1, H0, 0], [tb - 0.9, H0 - depth, 0], [tb, H0 - depth, 0], [to, Hto, v0]]
      : [[0, H0, 0], [t1, H0, 0], [tb, H0 - depth, 0], [to, Hto, v0]];
    segs.push({ t0: 0, t1: to, hip: (t) => hermite(keys, t), flight: false });
    const f = flightSeg(to, T);
    segs.push(f);
    const td = to + T;
    const k2 = [[td, Hto, -v0], [td + 0.25, H0 - 0.25, 0], [td + 0.8, H0, 0], [td + 3, H0, 0]];
    segs.push({ t0: td, t1: td + 3, hip: (t) => hermite(k2, t), flight: false });
  } else if (kind === 'dj') {
    const hb = p.box ?? 0.4, c = p.contact ?? 0.2, ts = 0.9;
    const sf = Math.sqrt((2 * hb) / g), vin = g * sf;
    segs.push({ t0: 0, t1: ts, hip: () => H0 + hb, flight: false, foot: () => hb });
    segs.push({
      t0: ts, t1: ts + sf, flight: false, fall: true,
      hip: (t) => H0 + hb - 0.5 * g * (t - ts) ** 2,
      foot: (t) => hb - 0.5 * g * (t - ts) ** 2,
    });
    const tc = ts + sf, to = tc + c;
    truth.push({ contactStart: tc, contact: c });
    const keys = [[tc, H0, -vin], [tc + c * 0.45, H0 - 0.2, 0], [to, Hto, v0]];
    segs.push({ t0: tc, t1: to, hip: (t) => hermite(keys, t), flight: false });
    segs.push(flightSeg(to, T));
    const td = to + T;
    const k2 = [[td, Hto, -v0], [td + 0.25, H0 - 0.25, 0], [td + 0.8, H0, 0], [td + 3, H0, 0]];
    segs.push({ t0: td, t1: td + 3, hip: (t) => hermite(k2, t), flight: false });
  } else if (kind === 'rebound') {
    const n = p.n ?? 5, c = p.contact ?? 0.2;
    let t = 1.0;
    segs.push({ t0: 0, t1: t, hip: () => H0, flight: false });
    // primo salto da fermo con piccolo dip
    const tb = t + 0.4, to0 = tb + 0.25;
    const k0 = [[t, H0, 0], [tb, H0 - 0.2, 0], [to0, Hto, v0]];
    segs.push({ t0: t, t1: to0, hip: (tt) => hermite(k0, tt), flight: false });
    let to = to0;
    for (let i = 0; i < n; i++) {
      segs.push(flightSeg(to, T));
      const td = to + T, tn = td + c;
      const k = [[td, Hto, -v0], [td + c * 0.5, Hto - 0.16, 0], [tn, Hto, v0]];
      if (i < n - 1) {
        segs.push({ t0: td, t1: tn, hip: (tt) => hermite(k, tt), flight: false });
        truth.push({ contactStart: td, contact: c });
        to = tn;
      } else {
        const k2 = [[td, Hto, -v0], [td + 0.25, H0 - 0.25, 0], [td + 0.8, H0, 0], [td + 3, H0, 0]];
        segs.push({ t0: td, t1: td + 3, hip: (tt) => hermite(k2, tt), flight: false });
      }
    }
  }
  const end = segs[segs.length - 1].t1;
  const seg = (t) => segs.find((s) => t >= s.t0 && t <= s.t1) || segs[segs.length - 1];
  const state = (t) => {
    const s = seg(t);
    const hip = s.hip(t);
    let toe, heel;
    if (s.flight) {
      const leg = L - s.tuck(t);
      toe = hip - leg; heel = toe + 0.05;
    } else if (s.fall) {
      toe = s.foot(t); heel = toe + 0.04;
    } else {
      toe = s.foot ? s.foot(t) : 0;
      // il tallone si alza nella spinta
      const next = segs[segs.indexOf(s) + 1];
      let hl = 0.03;
      if (next && next.flight) hl = 0.03 + 0.07 * Math.max(0, 1 - (next.t0 - t) / 0.2);
      heel = toe + hl;
    }
    return { hip, toe, heel };
  };
  return { state, end, truth, H0, L };
}

/**
 * Genera una traccia { t, kp, aspect } a un certo fps. noise = sigma in altezza-fotogramma.
 */
export function renderTrack(scn, { fps = 240, noise = 0.0025, seed = 1, dropout = 0.02, outlier = 0.01, heightM = 1.75, bodyFrac = 0.55 } = {}) {
  const r = rng(seed);
  const phase = r.u() / fps;
  const mPerFh = heightM / bodyFrac;
  const floorY = 0.9, aspect = 9 / 16; // ripresa verticale
  const t = [], kp = [];
  const fh = (m) => floorY - m / mPerFh;
  const put = (a, i, x, y, v = 0.95) => { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = v; };
  for (let k = 0; ; k++) {
    const tk = k / fps + phase;
    if (tk > scn.end) break;
    const s = scn.state(tk);
    const a = new Float32Array(33 * 3);
    const n = (sc = 1) => r.gauss() * noise * sc;
    const spike = () => (r.u() < outlier ? (r.u() - 0.5) * 0.08 : 0);
    const hipY = fh(s.hip), cx = 0.5;
    put(a, 0, cx, fh(s.hip + 0.78) + n());
    put(a, 11, cx - 0.02, fh(s.hip + 0.5) + n()); put(a, 12, cx + 0.02, fh(s.hip + 0.5) + n());
    put(a, 23, cx - 0.01, hipY + n()); put(a, 24, cx + 0.01, hipY + n());
    const kneeH = s.hip - 0.45 + Math.max(0, (s.hip - s.toe - 0.95)) * 0;
    put(a, 25, cx, fh(kneeH) + n()); put(a, 26, cx, fh(kneeH) + n());
    const ank = s.toe + 0.085;
    put(a, 27, cx - 0.02, fh(ank) + n()); put(a, 28, cx + 0.02, fh(ank) + n());
    put(a, 29, cx - 0.04, fh(s.heel) + n(1.4) + spike()); put(a, 30, cx - 0.04, fh(s.heel) + n(1.4) + spike());
    put(a, 31, cx + 0.04, fh(s.toe) + n(1.4) + spike()); put(a, 32, cx + 0.04, fh(s.toe) + n(1.4) + spike());
    for (const i of [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) if (r.u() < dropout) a[i * 3 + 2] = 0.05;
    t.push(tk); kp.push(a);
  }
  return { t, kp, aspect };
}

// Scena sintetica per verificare gli eventi dai pixel del piede (footflow.js) con verità nota.
// Due piedi con texture che seguono una traiettoria balistica: suolo fermo, volo parabolico, atterraggio con piccolo assestamento.
// Parametri realistici: dimensioni del fotogramma 280×400, salita del piede 0,11 altezze-fotogramma (nel video reale ≈0,13),
// velocità di stacco ≈0,8 altezze-fotogramma/s (reale ≈0,55–0,65). Landmark iniziali con errore ±10 px, rumore ≈ gaussiano σ≈3/255.

export const FLOW = { W: 280, H: 400, rise: 45 };

const tex = (x, y, k) => 128 + 38 * Math.sin(0.33 * x + k) * Math.cos(0.27 * y + 2 * k) + 30 * Math.sin(0.11 * x + 0.19 * y + k)
  + 24 * Math.sin(0.63 * x - 0.41 * y + k * 3) + 20 * Math.sin(1.1 * x + 0.9 * y + k) + 16 * Math.sin(1.7 * x - 1.3 * y + 2 * k) + 14 * Math.cos(0.9 * x + 1.9 * y);
const floorCache = new Map();
const floorOf = (flat) => {
  if (floorCache.has(flat)) return floorCache.get(flat);
  const { W, H } = FLOW, f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = flat ? 120 : tex(x, y, 1) * 0.5 + 60;
  floorCache.set(flat, f); return f;
};

export function makeFlowScene(rng, fps, T, seed, flat = false) {
  const { W, H, rise } = FLOW;
  const r = rng(seed), to = 1.2 + r.u() * 0.3, td = to + T, g = (8 * rise) / (T * T), v0 = (g * T) / 2;
  const yUp = (t) => (t <= to ? 0 : t < td ? v0 * (t - to) - 0.5 * g * (t - to) ** 2 : -2 * Math.min(1, (t - td) / 0.08)); // dopo il contatto il piede si assesta di 2 px
  const feet = [95, 185], dt = 1 / fps, phase = r.u() * dt, floor = floorOf(flat);
  const gray = [], tc = [], kp = [];
  for (let t = phase; t < td + 0.55; t += dt) {
    const f = new Uint8Array(W * H), cy = 300 - yUp(t), cyi = Math.round(cy);
    for (let p = 0; p < f.length; p++) f[p] = floor[p] + (r.u() + r.u() + r.u() - 1.5) * 6;
    for (const [fi, fx] of feet.entries()) {
      for (let y = Math.max(0, cyi - 33); y < Math.min(H, cyi + 34); y++) for (let x = fx - 34; x < fx + 34; x++) {
        const dy = y - cy, cov = Math.max(0, Math.min(1, 0.5 + 30 - Math.abs(dy)));
        if (cov <= 0) continue;
        const tv = flat ? 200 : tex(x - fx + 40, dy + 17, 4 + fi); // texture dipendente da dy continuo: il moto è sub-pixel
        const p = y * W + x; f[p] = Math.max(0, Math.min(255, f[p] * (1 - cov) + cov * (tv + (r.u() + r.u() + r.u() - 1.5) * 6)));
      }
    }
    const k = new Float32Array(99);
    for (const [fi, fx] of feet.entries()) { const q = 31 + fi; k[q * 3] = (fx + (r.u() - 0.5) * 20) / W; k[q * 3 + 1] = (cy + (r.u() - 0.5) * 20) / H; k[q * 3 + 2] = 0.9; }
    gray.push(f); tc.push(t); kp.push(k);
  }
  return { gray, tc, kp, to, td, rough: { to: to + (r.u() - 0.5) * 0.1, td: td + (r.u() - 0.5) * 0.1 } };
}

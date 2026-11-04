// Lettore frame-accurate sui fotogrammi analizzati (JPEG in memoria) con scheletro e linea del suolo.
// Non usa <video>: nessun seek, quindi ±1 frame è sempre esatto e indipendente dal browser.

const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];
const LEG = new Set([23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);

/** Scheletro semplice su un canvas (anteprima durante l'analisi). kp normalizzato sul canvas. */
export function drawPose(ctx, kp, w, h) {
  if (!kp) return;
  const lw = Math.max(2, w / 170);
  ctx.lineCap = 'round'; ctx.lineWidth = lw;
  for (const [a, b] of BONES) {
    if (kp[a * 3 + 2] < 0.3 || kp[b * 3 + 2] < 0.3) continue;
    ctx.strokeStyle = LEG.has(a) && LEG.has(b) ? '#c6f24e' : '#ffffffb0';
    ctx.beginPath(); ctx.moveTo(kp[a * 3] * w, kp[a * 3 + 1] * h); ctx.lineTo(kp[b * 3] * w, kp[b * 3 + 1] * h); ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const i of [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) {
    if (kp[i * 3 + 2] < 0.3) continue;
    ctx.beginPath(); ctx.arc(kp[i * 3] * w, kp[i * 3 + 1] * h, lw * 1.2, 0, 7); ctx.fill();
  }
}

export class FramePlayer {
  constructor(canvas, { onTime } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.onTime = onTime;
    this.win = null; this.i = 0; this.cache = new Map(); this.playing = false;
    this.showSkeleton = true; this.marks = null; this.ground = null; this.token = 0;
  }

  setWindow(win) {
    this.win = win; this.cache.forEach((b) => b.close?.()); this.cache.clear();
    this.cv.width = win.cw; this.cv.height = win.ch;
    this.times = win.frames.map((f) => f.tc);
    this.i = Math.min(this.i, win.frames.length - 1);
  }

  get time() { return this.times?.[this.i] ?? 0; }
  get frame() { return this.win?.frames[this.i]; }

  indexAt(t) {
    const a = this.times; let lo = 0, hi = a.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < t) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(a[lo - 1] - t) <= Math.abs(a[lo] - t)) lo--;
    return lo;
  }

  seekTime(t) { this.seekIndex(this.indexAt(t)); }

  seekIndex(i) {
    if (!this.win) return;
    this.i = Math.max(0, Math.min(this.win.frames.length - 1, i));
    this.draw();
    this.onTime?.(this.time, this.i);
  }

  step(n) { this.pause(); this.seekIndex(this.i + n); }

  async bitmap(i) {
    if (this.cache.has(i)) return this.cache.get(i);
    const f = this.win.frames[i];
    if (!f?.blob) return null;
    const bmp = await createImageBitmap(f.blob);
    this.cache.set(i, bmp);
    if (this.cache.size > 90) { const k = this.cache.keys().next().value; this.cache.get(k)?.close?.(); this.cache.delete(k); }
    return bmp;
  }

  async draw() {
    const my = ++this.token, i = this.i;
    const bmp = await this.bitmap(i);
    if (my !== this.token || !bmp) return;
    const { ctx, cv } = this;
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    this._overlay(this.win.frames[i]);
    for (const k of [i + 1, i + 2, i - 1]) if (k >= 0 && k < this.win.frames.length && !this.cache.has(k)) this.bitmap(k);
  }

  _overlay(f) {
    const { ctx, cv, win } = this;
    const { crop } = win;
    const X = (x) => ((x - crop.x) / crop.w) * cv.width, Y = (y) => ((y - crop.y) / crop.h) * cv.height;
    const lw = Math.max(2, cv.width / 170);
    if (this.ground != null) {
      const y = Y(-this.ground);
      ctx.save();
      ctx.setLineDash([lw * 3, lw * 2.5]); ctx.strokeStyle = '#5ec8ffcc'; ctx.lineWidth = lw * 0.7;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); ctx.restore();
    }
    const kp = f?.kp;
    if (!kp || !this.showSkeleton) return;
    ctx.lineCap = 'round'; ctx.lineWidth = lw;
    for (const [a, b] of BONES) {
      if (kp[a * 3 + 2] < 0.3 || kp[b * 3 + 2] < 0.3) continue;
      ctx.strokeStyle = LEG.has(a) && LEG.has(b) ? '#c6f24e' : '#ffffffb0';
      ctx.beginPath(); ctx.moveTo(X(kp[a * 3]), Y(kp[a * 3 + 1])); ctx.lineTo(X(kp[b * 3]), Y(kp[b * 3 + 1])); ctx.stroke();
    }
    let low = null;
    for (const i of [29, 30, 31, 32]) {
      if (kp[i * 3 + 2] < 0.3) continue;
      const x = X(kp[i * 3]), y = Y(kp[i * 3 + 1]);
      ctx.fillStyle = i < 31 ? '#ffd166' : '#c6f24e';
      ctx.beginPath(); ctx.arc(x, y, lw * 1.5, 0, 7); ctx.fill();
      if (!low || y > low.y) low = { x, y };
    }
    for (const i of [11, 12, 23, 24, 25, 26, 27, 28]) {
      if (kp[i * 3 + 2] < 0.3) continue;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(kp[i * 3]), Y(kp[i * 3 + 1]), lw * 1.1, 0, 7); ctx.fill();
    }
    if (low) { ctx.strokeStyle = '#5ec8ff'; ctx.lineWidth = lw * 0.8; ctx.beginPath(); ctx.arc(low.x, low.y, lw * 3, 0, 7); ctx.stroke(); }
  }

  play(speed = 0.25) {
    if (!this.win) return;
    this.playing = true; this.speed = speed;
    let last = performance.now(), t = this.time;
    const end = this.times[this.times.length - 1];
    if (t >= end - 1e-6) t = this.times[0];
    const loop = (now) => {
      if (!this.playing) return;
      t += ((now - last) / 1000) * this.speed; last = now;
      if (t >= end) { this.pause(); this.seekIndex(this.times.length - 1); this.onEnd?.(); return; }
      const idx = this.indexAt(t);
      if (idx !== this.i) this.seekIndex(idx);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.onPlay?.(true);
  }

  pause() { if (!this.playing) return; this.playing = false; cancelAnimationFrame(this.raf); this.onPlay?.(false); }
  toggle(speed) { this.playing ? this.pause() : this.play(speed); }
  dispose() { this.pause(); this.cache.forEach((b) => b.close?.()); this.cache.clear(); }
}

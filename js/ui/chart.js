// Grafico interattivo: quota dei piedi e del bacino nel tempo, fase di volo, cursori trascinabili
// di stacco e atterraggio (agganciati ai fotogrammi) e testina di riproduzione.

const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };

export class TrajectoryChart {
  constructor(box, { onSeek, onEdit }) {
    this.box = box; this.onSeek = onSeek; this.onEdit = onEdit;
    this.svg = el('svg', { viewBox: '0 0 600 170', preserveAspectRatio: 'none' });
    box.append(this.svg);
    box.addEventListener('pointerdown', (e) => this._down(e));
    addEventListener('pointermove', (e) => this._move(e));
    addEventListener('pointerup', () => {
      if (this.drag && this.drag !== 'seek' && this.lastT != null) this.onEdit(this.drag, this.lastT, true);
      this.drag = null; this.lastT = null;
    });
    this.W = 600; this.H = 170;
  }

  /** data: { t[], foot[] (cm), hip[] (cm), from, to, jump:{to,td}, playhead, frames:[tc...] } */
  set(data) { this.d = data; this.render(); }

  setPlayhead(t) { if (this.d) { this.d.playhead = t; if (this.ph) this.ph.setAttribute('x1', this.X(t)), this.ph.setAttribute('x2', this.X(t)); } }

  X(t) { const { from, to } = this.d; return 12 + ((t - from) / (to - from)) * (this.W - 24); }
  T(x) { const { from, to } = this.d; return from + ((x - 12) / (this.W - 24)) * (to - from); }

  render() {
    const d = this.d, svg = this.svg;
    svg.replaceChildren();
    if (!d) return;
    const idx = [];
    for (let i = 0; i < d.t.length; i++) if (d.t[i] >= d.from && d.t[i] <= d.to) idx.push(i);
    let lo = Infinity, hi = -Infinity;
    for (const i of idx) for (const arr of [d.foot, d.hip]) { const v = arr[i]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (!isFinite(lo)) return;
    lo = Math.min(lo, -3); hi = Math.max(hi, 10);
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const Y = (v) => 14 + (1 - (v - lo) / (hi - lo)) * (this.H - 28);
    this.Y = Y;
    // fase di volo
    if (d.jump) svg.append(el('rect', { x: this.X(d.jump.to), y: 0, width: Math.max(1, this.X(d.jump.td) - this.X(d.jump.to)), height: this.H, fill: '#c6f24e', 'fill-opacity': 0.1 }));
    svg.append(el('line', { x1: 0, x2: this.W, y1: Y(0), y2: Y(0), stroke: '#5ec8ff', 'stroke-opacity': 0.5, 'stroke-dasharray': '4 4' }));
    const path = (arr, color, w, op) => {
      let s = '';
      for (const i of idx) if (Number.isFinite(arr[i])) s += `${s ? 'L' : 'M'}${this.X(d.t[i]).toFixed(1)},${Y(arr[i]).toFixed(1)}`;
      svg.append(el('path', { d: s, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-opacity': op, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    };
    path(d.hip, '#ffffff', 1.6, 0.55);
    path(d.foot, '#c6f24e', 2.4, 1);
    // tacche dei fotogrammi quando sono poche
    if (d.frames && d.frames.length < 400) {
      for (const t of d.frames) if (t >= d.from && t <= d.to) svg.append(el('line', { x1: this.X(t), x2: this.X(t), y1: this.H - 6, y2: this.H, stroke: '#ffffff', 'stroke-opacity': 0.18, 'vector-effect': 'non-scaling-stroke' }));
    }
    if (d.jump) {
      for (const [k, t, c, label] of [['to', d.jump.to, '#c6f24e', 'STACCO'], ['td', d.jump.td, '#5ec8ff', 'ATTERR.']]) {
        const x = this.X(t);
        svg.append(el('line', { x1: x, x2: x, y1: 0, y2: this.H, stroke: c, 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' }));
        svg.append(el('rect', { x: x - 5, y: 0, width: 10, height: 22, rx: 3, fill: c }));
      }
    }
    this.ph = el('line', { x1: this.X(d.playhead ?? d.from), x2: this.X(d.playhead ?? d.from), y1: 0, y2: this.H, stroke: '#fff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' });
    svg.append(this.ph);
  }

  _pt(e) { const r = this.box.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * this.W, t: null }; }

  _down(e) {
    if (!this.d) return;
    const { x } = this._pt(e);
    const j = this.d.jump;
    this.drag = 'seek';
    if (j && this.d.editable !== false) {
      const near = (t) => Math.abs(this.X(t) - x);
      const a = near(j.to), b = near(j.td);
      if (Math.min(a, b) < 16) this.drag = a <= b ? 'to' : 'td';
    }
    this.box.setPointerCapture?.(e.pointerId);
    this._move(e);
  }

  _move(e) {
    if (!this.drag || !this.d) return;
    const t = Math.max(this.d.from, Math.min(this.d.to, this.T(this._pt(e).x)));
    this.lastT = t;
    if (this.drag === 'seek') this.onSeek(t);
    else this.onEdit(this.drag, t, false);
  }
}

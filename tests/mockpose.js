// "Modello di postura" finto per i test: legge dai pixel i marcatori colorati dei video sintetici
// (tests/make_video.py). Serve solo a collaudare decodifica, finestre, mappatura e interfaccia.
import { pose } from '../js/engine/pose.js';

const COLORS = { toe: [255, 0, 0], heel: [0, 255, 0], hip: [0, 0, 255], sh: [255, 255, 0], nose: [255, 0, 255], knee: [0, 255, 255], ank: [255, 128, 0] };
const LMS = { toe: [31, 32], heel: [29, 30], hip: [23, 24], sh: [11, 12], nose: [0], knee: [25, 26], ank: [27, 28] };

export function installMock() {
  pose.init = async () => ({ model: 'mock', delegate: 'none' });
  pose.detect = (canvas) => {
    const { width: w, height: h } = canvas;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const acc = {};
    for (const k in COLORS) acc[k] = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      for (const k in COLORS) {
        const c = COLORS[k];
        if (Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]) < 110) { const p = i / 4; acc[k][0] += p % w; acc[k][1] += Math.floor(p / w); acc[k][2]++; }
      }
    }
    const kp = new Float32Array(99);
    let ok = 0;
    for (const k in COLORS) {
      const a = acc[k];
      if (a[2] < 4) continue;
      ok++;
      for (const i of LMS[k]) { kp[i * 3] = a[0] / a[2] / w; kp[i * 3 + 1] = a[1] / a[2] / h; kp[i * 3 + 2] = 0.95; }
    }
    return ok >= 5 ? kp : null;
  };
}

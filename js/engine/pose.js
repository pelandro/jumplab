// Wrapper MediaPipe Pose Landmarker (BlazePose GHUM, 33 punti con talloni e punte dei piedi).
// Tutto locale: libreria, WASM e modelli sono serviti dal proprio dominio (cartelle vendor/ e models/).

const BASE = new URL('../../', import.meta.url);

export const MODELS = {
  lite: { file: 'models/pose_landmarker_lite.task', label: 'Lite', hint: 'Il più veloce' },
  full: { file: 'models/pose_landmarker_full.task', label: 'Full', hint: 'Bilanciato (consigliato)' },
  heavy: { file: 'models/pose_landmarker_heavy.task', label: 'Heavy', hint: 'Massima precisione, più lento' },
};

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let modPromise = null;
async function loadMediaPipe() {
  modPromise ??= import(new URL('vendor/vision_bundle.mjs', BASE).href);
  return modPromise;
}

// scambio sinistra/destra dei 33 punti BlazePose (per l'immagine specchiata)
const FLIP = Array.from({ length: 33 }, (_, i) => i);
for (const [a, b] of [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]]) { FLIP[a] = b; FLIP[b] = a; }

export class PoseEngine {
  constructor() { this.lm = null; this.info = null; this.key = ''; }

  /**
   * delegate: 'auto' (GPU se disponibile, tranne iOS), 'gpu', 'cpu'. Se la GPU fallisce ripiega sulla CPU.
   */
  async init({ model = 'full', delegate = 'auto', onStatus = () => {} } = {}) {
    const wantGpu = delegate === 'gpu' || (delegate === 'auto' && !isIOS());
    const key = `${model}|${wantGpu ? 'gpu' : 'cpu'}`;
    if (this.lm && this.key === key) return this.info;
    this.close();
    onStatus('Carico il motore MediaPipe…');
    const mp = await loadMediaPipe();
    if (!mp?.PoseLandmarker) throw new Error('Libreria MediaPipe incompleta (vendor/vision_bundle.mjs)');
    onStatus('Inizializzo WebAssembly…');
    const wasm = await mp.FilesetResolver.forVisionTasks(new URL('vendor/wasm', BASE).href);
    const modelUrl = new URL(MODELS[model].file, BASE).href;
    const attempts = wantGpu ? ['GPU', 'CPU'] : ['CPU'];
    let lastErr = null;
    for (const dev of attempts) {
      try {
        onStatus(`Carico il modello ${MODELS[model].label} (${dev})…`);
        const lm = await mp.PoseLandmarker.createFromOptions(wasm, {
          baseOptions: { modelAssetPath: modelUrl, delegate: dev },
          runningMode: 'IMAGE', numPoses: 1,
          minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
        });
        // prova a vuoto: scopre subito GPU non funzionanti
        const probe = document.createElement('canvas'); probe.width = 64; probe.height = 64;
        lm.detect(probe);
        this.lm = lm; this.key = key; this.numPoses = 1;
        this.info = { model, delegate: dev };
        onStatus(`Modello ${MODELS[model].label} pronto (${dev})`);
        return this.info;
      } catch (e) { lastErr = e; }
    }
    throw new Error('Impossibile avviare il modello di postura: ' + (lastErr?.message || lastErr));
  }

  close() { try { this.lm?.close(); } catch { /* noop */ } this.lm = null; this.key = ''; }

  /**
   * Rileva la posa su un canvas. Restituisce Float32Array(33*3) con x,y normalizzati sul canvas e visibilità,
   * oppure null. Con più persone sceglie la più grande (o la più vicina a `near`).
   */
  detect(canvas, { multi = false, near = null, flip = false } = {}) {
    const a = this._detect(canvas, multi, near);
    if (!flip || !a) return a;
    // Media tra immagine normale e specchiata: gli errori sistematici sinistra/destra del modello si annullano e il
    // rumore sui piedi cala del 20–30 % (misurato su video reale a 60 fps). Costa il doppio: solo per la rifinitura.
    const w = canvas.width, h = canvas.height;
    if (!this._fc) this._fc = document.createElement('canvas');
    const fc = this._fc;
    if (fc.width !== w || fc.height !== h) { fc.width = w; fc.height = h; }
    const c = fc.getContext('2d');
    c.setTransform(-1, 0, 0, 1, w, 0); c.drawImage(canvas, 0, 0, w, h); c.setTransform(1, 0, 0, 1, 0, 0);
    const b = this._detect(fc, multi, near ? [1 - near[0], near[1]] : null);
    if (!b) return a;
    const out = new Float32Array(33 * 3);
    for (let i = 0; i < 33; i++) {
      const j = FLIP[i];
      const bx = 1 - b[j * 3], by = b[j * 3 + 1], bv = b[j * 3 + 2];
      const wa = a[i * 3 + 2] + 1e-6, wb = bv + 1e-6;
      out[i * 3] = (a[i * 3] * wa + bx * wb) / (wa + wb);
      out[i * 3 + 1] = (a[i * 3 + 1] * wa + by * wb) / (wa + wb);
      out[i * 3 + 2] = Math.min(a[i * 3 + 2], bv);
    }
    return out;
  }

  /** Tutte le persone trovate (fino a 3), ciascuna come Float32Array(33*3) con almeno 8 punti visibili. */
  detectAll(canvas) {
    if (this.numPoses !== 3) { this.lm.setOptions({ numPoses: 3 }); this.numPoses = 3; }
    const res = this.lm.detect(canvas);
    const out = [];
    for (const lms of res?.landmarks || []) {
      let vis = 0;
      for (const p of lms) if ((p.visibility ?? 1) > 0.4) vis++;
      if (vis < 8) continue;
      const kp = new Float32Array(33 * 3);
      lms.forEach((p, i) => { kp[i * 3] = p.x; kp[i * 3 + 1] = p.y; kp[i * 3 + 2] = p.visibility ?? 0.9; });
      out.push(kp);
    }
    return out;
  }

  _detect(canvas, multi, near) {
    const want = multi ? 3 : 1;
    if (this.numPoses !== want) { this.lm.setOptions({ numPoses: want }); this.numPoses = want; }
    const res = this.lm.detect(canvas);
    const poses = res?.landmarks || [];
    if (!poses.length) return null;
    let best = null, bestScore = -Infinity;
    for (const lms of poses) {
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0, vis = 0;
      for (const p of lms) { if ((p.visibility ?? 1) > 0.4) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); vis++; } }
      if (vis < 8) continue;
      const area = (x1 - x0) * (y1 - y0);
      const c = [(x0 + x1) / 2, (y0 + y1) / 2];
      const score = near ? -Math.hypot(c[0] - near[0], c[1] - near[1]) + area * 0.5 : area;
      if (score > bestScore) { bestScore = score; best = lms; }
    }
    if (!best) return null;
    const kp = new Float32Array(33 * 3);
    best.forEach((p, i) => { kp[i * 3] = p.x; kp[i * 3 + 1] = p.y; kp[i * 3 + 2] = p.visibility ?? 0.9; });
    return kp;
  }
}

export const pose = new PoseEngine();

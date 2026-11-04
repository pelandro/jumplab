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
  detect(canvas, { multi = false, near = null } = {}) {
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

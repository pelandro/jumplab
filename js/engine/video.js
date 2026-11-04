// Lettura video frame-accurate.
//
// Percorso principale: demux MP4/MOV con mp4box + decodifica WebCodecs. Ogni fotogramma esce con il suo
// timestamp di *acquisizione* (cts nella timeline del media), quindi un MOV Slo-mo a 240 fps ha passo reale
// 1/240 s indipendentemente dalle edit list di riproduzione. Niente seek, niente stima degli fps.
//
// Ripiego: elemento <video> con seek per fotogramma (WebM da MediaRecorder, codec non supportati da
// WebCodecs). La precisione temporale dipende dal browser e viene segnalata.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

let mp4boxPromise = null;
function loadMp4Box() {
  if (window.MP4Box) return Promise.resolve(window.MP4Box);
  mp4boxPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/mp4box.all.min.js', import.meta.url).href;
    s.onload = () => (window.MP4Box ? resolve(window.MP4Box) : reject(new Error('mp4box non disponibile')));
    s.onerror = () => reject(new Error('Impossibile caricare vendor/mp4box.all.min.js'));
    document.head.append(s);
  });
  return mp4boxPromise;
}

function rotationFromMatrix(m) {
  if (!m || m.length < 5) return 0;
  const a = m[0] / 65536, b = m[1] / 65536;
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI / 90) * 90;
  return ((deg % 360) + 360) % 360;
}

const ROT = {
  0: (cw, ch) => [1, 0, 0, 1, 0, 0],
  90: (cw, ch) => [0, 1, -1, 0, ch, 0],
  180: (cw, ch) => [-1, 0, 0, -1, cw, ch],
  270: (cw, ch) => [0, -1, 1, 0, 0, cw],
};

export class VideoSource {
  /** Metadati comuni: kind, width/height (orientati), rotation, times (s, ordine di presentazione), fps. */
  describe() {
    const t = this.times;
    const dts = [];
    for (let i = 1; i < t.length; i++) dts.push(t[i] - t[i - 1]);
    const dt = median(dts);
    let peak = Infinity;
    for (const d of dts) if (d > 1e-6 && d < peak) peak = d;
    const near = dts.filter((d) => Math.abs(d - dt) / dt < 0.15).length / Math.max(1, dts.length);
    return {
      kind: this.kind, width: this.width, height: this.height, rotation: this.rotation,
      frameCount: t.length, duration: t[t.length - 1] - t[0], fps: 1 / dt, variableRate: near < 0.9,
      codec: this.codec || '', ...this.extra,
    };
  }
}

// ------------------------------------------------------------------ WebCodecs
export class WebCodecsSource extends VideoSource {
  static supported() { return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined'; }

  static async open(file, onLog = () => {}) {
    if (!WebCodecsSource.supported()) throw new Error('WebCodecs non disponibile in questo browser');
    const MP4Box = await loadMp4Box();
    const mp4 = MP4Box.createFile();
    const ready = new Promise((res, rej) => { mp4.onReady = res; mp4.onError = (e) => rej(new Error('Container non valido: ' + e)); });
    const buf = await file.arrayBuffer();
    buf.fileStart = 0;
    mp4.appendBuffer(buf);
    mp4.flush();
    const info = await Promise.race([ready, sleep(8000).then(() => { throw new Error('Il file non è un MP4/MOV leggibile'); })]);
    const track = info.videoTracks?.[0];
    if (!track) throw new Error('Nessuna traccia video');
    const trak = mp4.getTrackById(track.id);
    const entry = trak.mdia.minf.stbl.stsd.entries[0];
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    let description;
    if (box) {
      const DS = window.DataStream || MP4Box.DataStream;
      const ds = new DS(undefined, 0, DS.BIG_ENDIAN);
      box.write(ds);
      description = new Uint8Array(ds.buffer, 8);
    }
    const cw = entry.width || track.video.width, ch = entry.height || track.video.height;
    const cfg = { codec: track.codec, codedWidth: cw, codedHeight: ch, description };
    const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (!sup.supported) throw new Error(`Codec ${track.codec} non supportato da WebCodecs`);

    const samples = [];
    await new Promise((resolve, reject) => {
      const total = track.nb_samples;
      mp4.onSamples = (id, user, list) => {
        for (const s of list) samples.push({ cts: s.cts, dts: s.dts, dur: s.duration, sync: s.is_sync, data: s.data, ts: s.timescale });
        if (samples.length >= total) resolve();
      };
      mp4.setExtractionOptions(track.id, null, { nbSamples: Math.max(1, total) });
      mp4.start();
      setTimeout(() => (samples.length ? resolve() : reject(new Error('Estrazione campioni scaduta'))), 20000);
    });
    mp4.stop?.();

    const src = new WebCodecsSource();
    src.kind = 'webcodecs';
    src.cfg = cfg;
    src.codec = track.codec;
    src.rotation = rotationFromMatrix(track.matrix);
    src.cw = cw; src.ch = ch;
    const swap = src.rotation === 90 || src.rotation === 270;
    src.width = swap ? ch : cw;
    src.height = swap ? cw : ch;
    src.samples = samples; // ordine di decodifica
    const ts = samples[0].ts;
    const order = samples.map((s, i) => i).sort((a, b) => samples[a].cts - samples[b].cts);
    const c0 = samples[order[0]].cts;
    src.times = Float64Array.from(order, (i) => (samples[i].cts - c0) / ts);
    src.idxOfSample = new Int32Array(samples.length);
    order.forEach((si, rank) => { src.idxOfSample[si] = rank; });
    src.keyIdx = samples.map((s, i) => (s.sync ? i : -1)).filter((i) => i >= 0);
    src.ts = ts; src.c0 = c0;
    src.extra = { fileMB: file.size / 1048576, timescale: ts };
    onLog(`WebCodecs · ${track.codec} · ${cw}×${ch} · rot ${src.rotation}° · ${samples.length} frame`);
    return src;
  }

  /** Indice (decode order) del keyframe da cui partire per ottenere il tempo t. */
  _startSample(t) {
    const target = t * this.ts + this.c0;
    let best = this.keyIdx[0];
    for (const k of this.keyIdx) { if (this.samples[k].cts <= target) best = k; else break; }
    return best;
  }

  /**
   * Generatore asincrono di fotogrammi tra from e to (secondi); `step` salta fotogrammi (gli indici
   * multipli di step sono restituiti, gli altri scartati subito).
   */
  async *frames({ from = 0, to = Infinity, step = 1, signal } = {}) {
    const queue = []; let wake = null, error = null, done = false, stopped = false;
    const decoder = new VideoDecoder({
      output: (f) => { queue.push(f); wake?.(); },
      error: (e) => { error = e; wake?.(); },
    });
    decoder.configure({ ...this.cfg, optimizeForLatency: true });
    const start = this._startSample(from);
    const endCts = Number.isFinite(to) ? (to + 0.25) * this.ts + this.c0 : Infinity;
    const feeder = (async () => {
      try {
        for (let i = start; i < this.samples.length && !stopped; i++) {
          const s = this.samples[i];
          if (s.cts > endCts && s.sync === false) break;
          while ((decoder.decodeQueueSize > 6 || queue.length > 6) && !stopped) await sleep(1);
          if (stopped) break;
          decoder.decode(new EncodedVideoChunk({ type: s.sync ? 'key' : 'delta', timestamp: Math.round((s.cts / this.ts) * 1e6), duration: Math.round((s.dur / this.ts) * 1e6), data: s.data }));
        }
        if (!stopped) await decoder.flush();
      } catch (e) { error = e; }
      done = true; wake?.();
    })();
    // mappa timestamp(µs) -> indice di presentazione
    const byTs = new Map();
    for (let i = start; i < this.samples.length; i++) byTs.set(Math.round((this.samples[i].cts / this.ts) * 1e6), this.idxOfSample[i]);
    try {
      while (true) {
        if (signal?.aborted) return;
        if (queue.length) {
          const frame = queue.shift();
          const idx = byTs.get(frame.timestamp);
          const t = idx !== undefined ? this.times[idx] : NaN;
          if (idx === undefined || t < from - 1e-6 || idx % step !== 0) { frame.close(); continue; }
          if (t > to + 1e-6) { frame.close(); return; }
          yield { idx, t, frame };
          frame.close();
        } else if (error) throw error;
        else if (done) return;
        else await new Promise((r) => { wake = r; setTimeout(r, 50); });
      }
    } finally {
      stopped = true;
      for (const f of queue) f.close();
      try { decoder.close(); } catch { /* già chiuso */ }
      await feeder;
    }
  }

  /** Disegna una regione (coordinate normalizzate del fotogramma orientato) su ctx, scalandola a dw×dh. */
  drawCrop(frame, ctx, crop, dw, dh) {
    const W = this.width, H = this.height;
    const [a, b, c, d, e, f] = ROT[this.rotation](this.cw, this.ch);
    const sx = dw / (crop.w * W), sy = dh / (crop.h * H);
    ctx.save();
    ctx.setTransform(sx * a, sy * b, sx * c, sy * d, sx * (e - crop.x * W), sy * (f - crop.y * H));
    ctx.drawImage(frame, 0, 0, this.cw, this.ch);
    ctx.restore();
  }
  dispose() { this.samples = null; }
}

// ------------------------------------------------------------------ <video> + seek
export class ElementSource extends VideoSource {
  static async open(file, { fps: fpsHint, onLog = () => {} } = {}) {
    const src = new ElementSource();
    src.kind = 'element';
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => {
      v.onloadedmetadata = res;
      v.onerror = () => rej(new Error('Questo browser non riesce a leggere il video'));
      setTimeout(() => rej(new Error('Metadati video non letti (timeout)')), 15000);
    });
    src.video = v; src.url = url;
    src.width = v.videoWidth; src.height = v.videoHeight; src.rotation = 0;
    let fps = fpsHint || 0, probed = false;
    if (!fps && 'requestVideoFrameCallback' in v) {
      fps = await ElementSource._probeFps(v).catch(() => 0);
      probed = !!fps;
    }
    fps = fps || 30;
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    const n = Math.max(2, Math.floor(dur * fps));
    src.times = Float64Array.from({ length: n }, (_, i) => i / fps);
    src.extra = { assumedFps: fps, fpsProbed: probed, fileMB: file.size / 1048576, approximateTiming: true };
    onLog(`Fallback <video> · ${v.videoWidth}×${v.videoHeight} · ${fps.toFixed(1)} fps ${probed ? '(misurati)' : '(assunti)'}`);
    return src;
  }

  static async _probeFps(v) {
    v.currentTime = 0;
    const stamps = [];
    await new Promise((resolve) => {
      const cb = (now, md) => {
        stamps.push(md.mediaTime);
        if (stamps.length < 14) v.requestVideoFrameCallback(cb); else { v.pause(); resolve(); }
      };
      v.requestVideoFrameCallback(cb);
      v.play().catch(resolve);
      setTimeout(resolve, 1500);
    });
    v.pause(); v.currentTime = 0;
    const d = [];
    for (let i = 1; i < stamps.length; i++) if (stamps[i] > stamps[i - 1]) d.push(stamps[i] - stamps[i - 1]);
    const dt = median(d);
    return dt > 0 ? Math.round((1 / dt) * 10) / 10 : 0;
  }

  async _seek(t) {
    const v = this.video;
    await new Promise((resolve, reject) => {
      const done = () => { v.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { v.removeEventListener('seeked', done); reject(new Error('Seek scaduto')); }, 4000);
      v.addEventListener('seeked', done);
      v.currentTime = t;
    });
    if ('requestVideoFrameCallback' in v) await new Promise((r) => { v.requestVideoFrameCallback(() => r()); setTimeout(r, 120); });
  }

  async *frames({ from = 0, to = Infinity, step = 1, signal } = {}) {
    for (let idx = 0; idx < this.times.length; idx++) {
      if (signal?.aborted) return;
      const t = this.times[idx];
      if (t < from - 1e-6 || idx % step !== 0) continue;
      if (t > to + 1e-6) return;
      await this._seek(Math.min(t + 0.5 / (this.extra.assumedFps || 30), this.video.duration - 0.001));
      yield { idx, t, frame: this.video };
    }
  }

  drawCrop(frame, ctx, crop, dw, dh) {
    const W = this.width, H = this.height;
    ctx.drawImage(frame, crop.x * W, crop.y * H, crop.w * W, crop.h * H, 0, 0, dw, dh);
  }
  dispose() { URL.revokeObjectURL(this.url); this.video.removeAttribute('src'); this.video.load(); }
}

export async function openVideo(file, { onLog = () => {}, preferFallback = false, fpsHint } = {}) {
  const looksIso = /\.(mp4|mov|m4v)$/i.test(file.name || '') || /mp4|quicktime/.test(file.type || '');
  if (!preferFallback && WebCodecsSource.supported() && looksIso) {
    try { return await WebCodecsSource.open(file, onLog); }
    catch (e) { onLog('WebCodecs non utilizzabile: ' + e.message + ' → ripiego su <video>'); }
  }
  return ElementSource.open(file, { fps: fpsHint, onLog });
}

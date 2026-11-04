// Registrazione dalla fotocamera del dispositivo (MediaRecorder). Il browser limita la frequenza di
// fotogrammi (di solito 30–60 fps): per 120/240 fps usare la modalità Slo-mo dell'app Fotocamera (vedi guida «slomo»).

import { h, ic, toast } from './dom.js';
import { openGuide } from './guide.js';

export async function openCamera(app) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Fotocamera non disponibile qui: registra con l’app Fotocamera (Slo-mo) e usa “Importa video”.', 4200);
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 240 } },
    });
  } catch {
    toast('Permesso fotocamera negato o non disponibile. Usa “Importa video”.', 3800);
    return;
  }
  // Frame rate più alto che il browser concede: si prova 240 → 120 → 60 con vincolo esatto, entro il massimo dichiarato dal dispositivo.
  // Le modalità Slo-mo 120/240 dell'iPhone sono dell'app Fotocamera e i siti web non le vedono: di solito il tetto è 30–60 fps.
  const track = stream.getVideoTracks()[0];
  const capMax = track.getCapabilities?.().frameRate?.max;
  for (const f of [240, 120, 60]) {
    if (capMax && f > capMax + 0.5) continue;
    try {
      await track.applyConstraints({ frameRate: { exact: f } });
      if ((track.getSettings().frameRate || 0) >= f * 0.9) break;
    } catch { /* il dispositivo non offre questo frame rate */ }
  }
  const trackSettings = track.getSettings();
  const fps = Math.round(trackSettings.frameRate || 30);
  const fpsLabel = fps >= 100 ? `${fps} fps · ottimo` : fps >= 50 ? `${fps} fps · buono per l'altezza` : `${fps} fps · pochi`;
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  video.srcObject = stream;
  const status = h('div', { class: 'small', style: { position: 'absolute', top: 'calc(var(--safe-t) + 14px)', left: '14px', right: '14px', textAlign: 'center', textShadow: '0 1px 6px #000' } },
    `${trackSettings.width || '?'}×${trackSettings.height || '?'} · ${fpsLabel}${capMax ? ` (max del dispositivo: ${Math.round(capMax)})` : ''}`);
  const slomoHint = fps < 100 ? h('button', { class: 'chip', style: { position: 'absolute', top: 'calc(var(--safe-t) + 58px)', left: '50%', transform: 'translateX(-50%)', background: 'rgba(11,15,19,.75)', whiteSpace: 'nowrap' }, onclick: () => openGuide('slomo') }, ic('info'), 'Per 120/240 fps: come fare') : null;
  const count = h('div', { class: 'num', style: { fontSize: '96px', fontWeight: 800, color: '#c6f24e', textShadow: '0 2px 20px #000' } });
  const guide = h('div', { class: 'guide', html: `<svg viewBox="0 0 100 160" style="height:78%;opacity:.35" fill="none" stroke="#c6f24e" stroke-width=".8" stroke-dasharray="3 3"><rect x="22" y="6" width="56" height="148" rx="10"/><line x1="0" y1="96" x2="100" y2="96"/></svg>` }, count);
  const recBtn = h('button', { class: 'rec', 'aria-label': 'Avvia registrazione' }, h('i'));
  const close = () => { stream.getTracks().forEach((t) => t.stop()); overlay.remove(); };
  const overlay = h('div', { class: 'cam' }, video, guide, status, slomoHint,
    h('div', { class: 'bottom' },
      h('button', { class: 'iconbtn', onclick: close, 'aria-label': 'Chiudi' }, ic('close')),
      recBtn,
      h('div', { style: { width: '42px' } })));
  document.body.append(overlay);

  let rec = null, chunks = [], timer = null;
  const stopRec = () => { if (rec && rec.state === 'recording') rec.stop(); };
  recBtn.onclick = () => {
    if (rec?.state === 'recording') { stopRec(); return; }
    if (timer) { clearInterval(timer); timer = null; count.textContent = ''; return; }
    let n = 5; count.textContent = n; status.textContent = 'Mettiti in posizione: la registrazione parte tra…';
    timer = setInterval(() => {
      n--; count.textContent = n || '';
      if (n > 0) return;
      clearInterval(timer); timer = null;
      const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 16e6 } : { videoBitsPerSecond: 16e6 });
      chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const type = rec.mimeType || mime || 'video/webm';
        const blob = new Blob(chunks, { type });
        close();
        if (!blob.size) { toast('Registrazione vuota'); return; }
        app.startAnalysis(new File([blob], 'registrazione.' + (type.includes('mp4') ? 'mp4' : 'webm'), { type }), { fpsHint: fps });
      };
      rec.start(250);
      recBtn.classList.add('on'); status.textContent = 'Registrazione… salta, poi tocca per fermare.';
    }, 1000);
  };
}

// Qualità della ripresa: riconosce l'inquadratura (frontale/obliqua/laterale) e controlla che il video permetta una misura
// affidabile (frame rate, risoluzione, piedi visibili, atleta né troppo piccolo né tagliato, più persone, ...).
// Funziona sulla scansione grossolana, prima del calcolo dei salti, e produce suggerimenti pratici per il prossimo video.

const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

/**
 * Inquadratura dal rapporto tra larghezza delle spalle e lunghezza del busto (spalle→bacino), in pixel.
 * La larghezza apparente scala con cos(θ), θ = angolo tra la direzione di ripresa e la frontale: su video reale frontale il
 * rapporto vale 0,68 (0,66–0,69 con Lite/Full/Heavy). Soglie: frontale ≥ 0,50 (θ ≲ 42°), laterale < 0,22 (θ ≳ 71°).
 * Nota: le soglie frontali sono calibrate su un video reale; quella laterale è geometrica, non verificata su video laterali reali.
 */
export function detectView(kps, aspect) {
  const rs = [];
  for (const k of kps) {
    if (!k) continue;
    if (Math.min(k[11 * 3 + 2], k[12 * 3 + 2], k[23 * 3 + 2], k[24 * 3 + 2]) < 0.5) continue;
    const sx = (k[11 * 3] + k[12 * 3]) / 2, sy = (k[11 * 3 + 1] + k[12 * 3 + 1]) / 2;
    const hx = (k[23 * 3] + k[24 * 3]) / 2, hy = (k[23 * 3 + 1] + k[24 * 3 + 1]) / 2;
    const torso = Math.hypot((sx - hx) * aspect, sy - hy);
    if (!(torso > 0.02)) continue;
    rs.push((Math.abs(k[11 * 3] - k[12 * 3]) * aspect) / torso);
  }
  if (rs.length < 5) return { view: null, ratio: NaN, n: rs.length };
  const ratio = median(rs);
  const view = ratio >= 0.5 ? 'frontale' : ratio < 0.22 ? 'laterale' : 'obliqua';
  return { view, ratio, n: rs.length };
}

/**
 * meta: { fps, width, height }, coarse: { t, kp }, extra: { aspect, tracks }
 * Restituisce { items: [{level:'ok'|'info'|'warn'|'bad', code, text}], view, ratio, fps, footVis, sizeFrac, detected }
 */
export function assessRecording(meta, coarse, extra = {}) {
  const aspect = extra.aspect || meta.width / meta.height;
  const items = [];
  const add = (level, code, text) => items.push({ level, code, text });
  const total = coarse.kp.length, kps = coarse.kp.filter(Boolean);
  const detected = total ? kps.length / total : 0;

  // frame rate e risoluzione
  const fps = meta.fps;
  if (fps >= 200) add('ok', 'fps', `${fps.toFixed(0)} fps: ottimo, un fotogramma vale circa ${(1000 / fps).toFixed(0)} ms.`);
  else if (fps >= 100) add('ok', 'fps', `${fps.toFixed(0)} fps: buono (±1 fotogramma ≈ ${(1000 / fps).toFixed(0)} ms).`);
  else if (fps >= 50) add('info', 'fps', `${fps.toFixed(0)} fps: sufficiente per l'altezza (±1 fotogramma ≈ ±3 cm a 35 cm). Per contatti e RSI usa slow-motion 120/240 fps.`);
  else add('warn', 'fps', `${fps.toFixed(0)} fps nel file: pochi (±1 fotogramma ≈ ±${(1000 / fps).toFixed(0)} ms). Registra in slow-motion 120/240 fps. Se è già uno slow-motion esportato a 30 fps i fotogrammi reali sono di più: applica la calibrazione suggerita.`);
  // Percorso di lettura del video: con WebCodecs i tempi sono quelli reali del file; con l'elemento <video> sono stimati
  // (passo costante assunto), e due dispositivi/browser possono dare risultati diversi sullo stesso file.
  if (meta.kind === 'element') {
    add('warn', 'timing', `Questo browser non supporta la lettura precisa dei fotogrammi: i tempi sono stimati a ${(meta.assumedFps || fps).toFixed(1)} fps${meta.fpsProbed ? ' (misurati)' : ' (assunti)'}. I risultati possono differire da quelli ottenuti con un browser recente (Safari 16.4+, Chrome, Edge): per misure confrontabili usa lo stesso dispositivo.`);
  } else if (meta.variableRate) {
    add('info', 'vfr', 'Il video ha frame rate variabile (tipico dei video ricodificati da app di messaggistica): i tempi reali del file sono rispettati.');
  }
  const side = Math.min(meta.width, meta.height);
  if (side < 700) add('warn', 'res', `Risoluzione bassa (${meta.width}×${meta.height}): i piedi hanno pochi pixel. Registra almeno in 1080p.`);

  if (detected < 0.3) add('bad', 'detect', 'Corpo rilevato in meno del 30 % dei fotogrammi: inquadra tutta la persona, con buona luce.');
  else if (detected < 0.6) add('warn', 'detect', `Corpo rilevato solo nel ${Math.round(detected * 100)} % dei fotogrammi: controlla luce, sfondo e che sia inquadrato intero.`);

  if (kps.length >= 5) {
    // piedi visibili
    const fv = kps.map((k) => (k[29 * 3 + 2] + k[30 * 3 + 2] + k[31 * 3 + 2] + k[32 * 3 + 2]) / 4);
    const footVis = median(fv);
    if (footVis < 0.5) add('warn', 'feet', `Piedi poco visibili (${Math.round(footVis * 100)} %): evita scarpe scure su pavimento scuro e metti più luce.`);
    else if (footVis < 0.75) add('info', 'feet', `Piedi visibili al ${Math.round(footVis * 100)} %: un contrasto maggiore con il pavimento migliora i tempi di stacco e atterraggio.`);
    else add('ok', 'feet', 'Piedi ben visibili.');

    // dimensione dell'atleta (nel primo 40 % dei fotogrammi con corpo intero, cioè in piedi)
    const early = kps.slice(0, Math.max(5, Math.round(kps.length * 0.4)));
    const hs = early.map((k) => Math.max(k[27 * 3 + 1], k[28 * 3 + 1]) - k[1]).filter((v) => v > 0);
    const sizeFrac = median(hs) / 0.885;
    if (Number.isFinite(sizeFrac)) {
      if (sizeFrac < 0.3) add('warn', 'size', `Atleta piccolo nel fotogramma (${Math.round(sizeFrac * 100)} % dell'altezza): avvicinati o usa lo zoom, ideale 50–70 %.`);
      else if (sizeFrac > 0.92) add('warn', 'size', `Atleta troppo grande nel fotogramma (${Math.round(sizeFrac * 100)} %): allontanati, in volo testa o piedi rischiano di uscire.`);
    }

    // parti del corpo tagliate dal bordo
    let clip = 0;
    for (const k of kps) {
      let c = false;
      for (const i of [0, 27, 28, 29, 30, 31, 32]) if (k[i * 3 + 2] > 0.4 && (k[i * 3 + 1] < 0.012 || k[i * 3 + 1] > 0.988)) c = true;
      if (c) clip++;
    }
    if (clip / kps.length > 0.05) add('warn', 'clip', 'Testa o piedi toccano il bordo del fotogramma in diversi momenti: lascia margine sopra e sotto, anche durante il volo.');

    // inquadratura
    const v = detectView(kps, aspect);
    if (v.view === 'laterale') add('ok', 'view', 'Ripresa laterale: la migliore per contatti, profondità del contromovimento e flessione.');
    else if (v.view === 'frontale') add('info', 'view', 'Ripresa frontale: va bene per altezza e tempo di volo. Per contatto, dip e RSI è meglio di lato; di fronte il suolo "scivola" se l\'atleta si avvicina alla camera.');
    else if (v.view === 'obliqua') add('info', 'view', 'Ripresa obliqua: i risultati sono utilizzabili, ma per massima affidabilità riprendi di lato (90°) o di fronte.');
    extra.view = v;
    extra.footVis = footVis; extra.sizeFrac = sizeFrac;
  }

  if ((extra.tracks || 1) > 1) add('info', 'people', `Rilevate ${extra.tracks} persone: è stata seguita quella che salta. Meglio una sola persona nell'inquadratura.`);
  const worst = items.some((i) => i.level === 'bad') ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok';
  return { items, level: worst, view: extra.view?.view || null, ratio: extra.view?.ratio ?? NaN, fps, footVis: extra.footVis ?? NaN, sizeFrac: extra.sizeFrac ?? NaN, detected, people: extra.tracks || 1 };
}

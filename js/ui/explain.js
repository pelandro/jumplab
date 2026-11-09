// Spiegazioni in linguaggio semplice dei risultati: cosa significa il numero, quanto è preciso, se è cambiato rispetto alle volte precedenti,
// quali valori contano per il tipo di test. Funzioni pure (nessun DOM), usate dalla schermata dei risultati e dallo storico.

const fin = Number.isFinite;
const n1 = (v) => v.toFixed(1).replace('.', ',');

/** Intervallo al 95 % (±2σ) detto a parole. */
export function rangeText(v, s, u) {
  if (!fin(v) || !fin(s) || s <= 0) return null;
  return `Con buona probabilità (95 %) il valore vero è tra ${n1(v - 2 * s)} e ${n1(v + 2 * s)} ${u}.`;
}

/** Perché l'affidabilità è alta, media o bassa: i motivi principali, senza gergo. */
export function reliabilityText(j, { uncal = false } = {}) {
  if (uncal) return 'Il video sembra rallentato: imposta la calibrazione del tempo prima di leggere il risultato.';
  const why = [];
  const pix = j.flow?.pixelBoth;
  if (j.manual) why.push('stacco e atterraggio sono stati corretti a mano');
  else if (pix) why.push('stacco e atterraggio sono stati letti dal movimento dei piedi, fotogramma per fotogramma');
  else if (j.flow && !pix) why.push('uno dei due istanti (stacco o atterraggio) è stato stimato dal modello del corpo, meno preciso dei piedi');
  else why.push('stacco e atterraggio sono stati stimati dal modello del corpo, meno preciso del movimento dei piedi');
  if (fin(j.dt) && j.dt > 0.021) why.push(`il video ha pochi fotogrammi al secondo (${Math.round(1 / j.dt)})`);
  const st = j.verdict?.status;
  if (st === 'coerenti') why.push('i metodi di controllo danno lo stesso risultato');
  else if (st === 'incoerenti') why.push('i metodi di controllo non concordano');
  const warns = (j.issues || []).filter((x) => x.level === 'warn' || x.level === 'bad').length;
  if (warns) why.push(`${warns === 1 ? 'c’è un avviso' : `ci sono ${warns} avvisi`} qui sotto`);
  const head = { alta: 'Misura affidabile', media: 'Misura da prendere con cautela', bassa: 'Misura poco affidabile' }[j.confidence] || 'Misura';
  return `${head}: ${why.join('; ')}.`;
}

/**
 * Confronto con le sessioni precedenti dello stesso atleta e dello stesso test. Una differenza conta come reale solo se supera ~2 volte l'incertezza
 * combinata delle due misure (criterio prudente: parte dell'errore è comune alle due misure e si annullerebbe).
 * past: [{ date, best, unc }] ordinate dalla più recente; h, s: valore e incertezza (1σ) di questa misura.
 */
export function historyContext(past, h, s, u, conv = (x) => x) {
  if (!fin(h)) return [];
  if (!past.length) return [{ tone: 'info', text: 'È la prima misura di questo test per questo atleta: le prossime verranno confrontate con questa.' }];
  const out = [];
  const real = (d, s2) => Math.abs(d) > 2 * Math.hypot(fin(s) ? s : 1.5, fin(s2) ? s2 : 1.5);
  const date = (t) => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const best = past.reduce((a, b) => (b.best > a.best ? b : a));
  const d = h - best.best;
  if (d > 0) out.push({ tone: real(d, best.unc) ? 'good' : 'info', text: `Nuovo record personale: +${n1(conv(d))} ${u} sul precedente (${date(best.date)})${real(d, best.unc) ? '.' : ', ma la differenza è entro l’errore di misura.'}` });
  else out.push({ tone: 'info', text: `Record personale: ${n1(conv(best.best))} ${u} (${date(best.date)}), ${n1(conv(-d))} ${u} sopra questa misura.` });
  const last = past[0];
  if (last !== best || d <= 0) {
    const dl = h - last.best, r = real(dl, last.unc);
    out.push({ tone: r ? (dl > 0 ? 'good' : 'bad') : 'info', text: `Rispetto all'ultima volta (${date(last.date)}): ${dl >= 0 ? '+' : '−'}${n1(conv(Math.abs(dl)))} ${u}, ${r ? (dl > 0 ? 'un miglioramento reale' : 'un calo reale') : 'differenza entro l’errore di misura (non distinguibile da una misura uguale)'}.` });
  }
  return out;
}

/**
 * I pochi valori utili per capire il salto, scelti in base al tipo di test, ciascuno con una frase su cosa significa.
 * Restituisce [{ label, value, unit, help }] solo per i valori disponibili.
 */
export function keyMetrics(j, testType, L) {
  const out = [], add = (ok, label, value, unit, help) => { if (ok) out.push({ label, value: value(), unit, help }); }; // value è una funzione: si valuta solo se il dato c'è
  const u = L(0).u, cm = testType === 'cmj' || testType === 'cmj_arms', drop = testType === 'dj' || testType === 'rebound';
  const v0 = fin(j.bestV0) ? j.bestV0 : j.v0;
  add(fin(j.T), 'Tempo in aria', () => Math.round(j.T * 1000), 'ms', 'Da stacco ad atterraggio: è il dato da cui si ricava l’altezza. 10 ms in più ≈ 1,5–2 cm.');
  add(fin(v0) && !drop, 'Velocità di stacco', () => v0.toFixed(2).replace('.', ','), 'm/s', 'Quanto veloce lasci il suolo: decide l’altezza (raddoppiarla quadruplica il salto).');
  add(cm && fin(j.dipCm), 'Profondità del piegamento', () => n1(L(j.dipCm).v), u, 'Quanto scendi prima di spingere. Per confrontare i salti nel tempo cerca di tenerla simile.');
  add(cm && fin(j.timeToTakeoff), 'Durata della spinta', () => Math.round(j.timeToTakeoff * 1000), 'ms', 'Dall’inizio del piegamento allo stacco. A parità di altezza, più è breve più il salto è esplosivo.');
  add(cm && fin(j.rsiMod), 'Indice di esplosività (RSI mod)', () => j.rsiMod.toFixed(2).replace('.', ','), '', 'Altezza ÷ durata della spinta. Più alto = più esplosivo: utile per confrontarti con te stesso nel tempo.');
  add(drop && fin(j.contact), 'Tempo a terra', () => Math.round(j.contact * 1000), 'ms', 'Quanto resti a terra prima di risaltare: più è breve, più sei reattivo.');
  add(drop && fin(j.rsi), 'Indice di reattività (RSI)', () => j.rsi.toFixed(2).replace('.', ','), '', 'Altezza ÷ tempo a terra. Più alto = più reattivo: salti alto restando poco a terra.');
  add(testType === 'dj' && fin(j.boxCm), 'Altezza della pedana (stima)', () => Math.round(L(j.boxCm).v), u, 'Da dove ti sei lasciato cadere, stimata dal video.');
  return out;
}

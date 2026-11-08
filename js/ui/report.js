// Report condivisibile di una sessione salvata: immagine PNG 1080 px con risultato, incertezza, accordo tra i metodi e tabella dei salti.
// Si disegna su canvas (nessun invio a server): si condivide con il foglio di condivisione del telefono o si scarica.

import { agreementPlot } from './viz.js';
import { TEST_TYPES } from '../engine/jumps.js';
import { VERSION } from '../store.js';

const ACC = '#c6f24e', BG = '#0b1014', CARD = '#11161b', CARD2 = '#182027', LINE = '#252f39', TXT = '#eef3f8', MUT = '#8d9aa8', FAINT = '#5d6a77';
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Inter, sans-serif';
const fin = Number.isFinite;

const bestJump = (s) => (s.jumps || []).reduce((a, j) => (!a || j.heightCm > a.heightCm ? j : a), null);
const uncOf = (j) => (j ? (j.hSource === 'integrata' && fin(j.bestUncCm) ? j.bestUncCm : fin(j.uncCm) ? j.uncCm : null) : null);
const SRC_H = { integrata: 'stima integrata', volo: 'tempo di volo' };

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

async function svgImage(svg, width) {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) return null;
  const w = +m[1], h = +m[2], H = Math.round((width * h) / w);
  const src = svg.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" font-family='${FONT.replace(/"/g, '')}' `).replace(/style="[^"]*"/, '');
  const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return { img, h: H };
  } finally { URL.revokeObjectURL(url); }
}

/** Disegna il report e restituisce un Blob PNG. s = sessione salvata, units = 'cm' | 'in'. */
export async function makeReport(s, units = 'cm') {
  const conv = (cm) => (units === 'in' ? cm / 2.54 : cm), u = units === 'in' ? 'in' : 'cm';
  const bj = bestJump(s), unc = uncOf(bj);
  const W = 1080, pad = 48;
  const jumps = (s.jumps || []).slice(0, 8);
  // misura dell'altezza: l'accordo dei metodi ha un'altezza che dipende dal rapporto del suo SVG
  const plotSvg = bj?.methods ? agreementPlot(bj.methods, { conv, unit: u, recommended: bj.rec }) : '';
  const plot = plotSvg ? await svgImage(plotSvg, W - 2 * pad - 40).catch(() => null) : null;
  const H = 120 + 96 + 300 + 2 * 150 + 40 + (plot ? plot.h + 100 : 0) + 100 + jumps.length * 58 + 210;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const text = (t, x, y, { size = 32, weight = 600, color = TXT, align = 'left' } = {}) => { ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(t, x, y); };
  const card = (x, y, w, h, fill = CARD) => { rrect(ctx, x, y, w, h, 28); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = LINE; ctx.stroke(); };
  let y = 78;
  // intestazione
  ctx.beginPath(); ctx.arc(pad + 12, y - 14, 12, 0, 7); ctx.fillStyle = ACC; ctx.shadowColor = ACC; ctx.shadowBlur = 18; ctx.fill(); ctx.shadowBlur = 0;
  text('Jump Lab', pad + 36, y, { size: 44, weight: 800 });
  text(new Date(s.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' }), W - pad, y, { size: 28, color: MUT, align: 'right' });
  y += 62;
  text(TEST_TYPES[s.testType]?.long || s.testType || 'Salto', pad, y, { size: 40, weight: 800 });
  y += 44;
  text([s.athleteName, Number.isFinite(s.heightCm) ? `${s.heightCm} cm` : null, s.massKg ? `${s.massKg} kg` : null, s.fps ? `${Math.round(s.fps)} fps` : null, s.view].filter(Boolean).join(' · '), pad, y, { size: 26, color: MUT });
  y += 40;
  // risultato
  card(pad, y, W - 2 * pad, 270);
  text(`MIGLIOR SALTO${bj?.hSource ? ' · ' + (SRC_H[bj.hSource] || bj.hSource).toUpperCase() : ''}`, pad + 36, y + 56, { size: 24, weight: 800, color: MUT });
  text(conv(s.best).toFixed(1), pad + 36, y + 190, { size: 150, weight: 800, color: ACC });
  ctx.font = `800 150px ${FONT}`; const vw = ctx.measureText(conv(s.best).toFixed(1)).width;
  text(u, pad + 36 + vw + 14, y + 190, { size: 54, weight: 700, color: MUT });
  if (fin(unc)) text(`± ${conv(unc).toFixed(1)} ${u} (1σ)`, pad + 40, y + 240, { size: 32, weight: 600, color: TXT });
  if (bj?.confidence) { const lab = 'Affidabilità ' + bj.confidence, col = { alta: '#7bf0a4', media: '#ffc15e', bassa: '#ff6b6b' }[bj.confidence] || MUT; ctx.font = `800 26px ${FONT}`; const w = ctx.measureText(lab).width + 44; rrect(ctx, W - pad - 36 - w, y + 36, w, 54, 27); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); text(lab, W - pad - 36 - w / 2, y + 73, { size: 26, weight: 800, color: col, align: 'center' }); }
  y += 270 + 26;
  // metriche principali
  const metrics = [
    ['Tempo di volo', fin(bj?.T) ? `${Math.round(bj.T * 1000)}` : null, 'ms'],
    ['Altezza dal tempo di volo', fin(bj?.heightFlightCm) ? conv(bj.heightFlightCm).toFixed(1) : null, u],
    ['Velocità di stacco', fin(bj?.bestV0) ? bj.bestV0.toFixed(2) : fin(bj?.v0) ? bj.v0.toFixed(2) : null, 'm/s'],
    [fin(bj?.rsi) ? 'RSI' : fin(bj?.dipCm) ? 'Profondità del dip' : 'Potenza media', fin(bj?.rsi) ? bj.rsi.toFixed(2) : fin(bj?.dipCm) ? conv(bj.dipCm).toFixed(1) : fin(bj?.powerW) ? Math.round(bj.powerW) + '' : null, fin(bj?.rsi) ? '' : fin(bj?.dipCm) ? u : 'W'],
  ].filter((m) => m[1] != null);
  const cw = (W - 2 * pad - 24) / 2;
  metrics.forEach(([lab, v, un], i) => {
    const x = pad + (i % 2) * (cw + 24), yy = y + Math.floor(i / 2) * 150;
    card(x, yy, cw, 126, CARD2);
    text(lab, x + 30, yy + 44, { size: 24, weight: 600, color: MUT });
    text(v, x + 30, yy + 102, { size: 60, weight: 800 });
    ctx.font = `800 60px ${FONT}`; const w = ctx.measureText(v).width;
    if (un) text(un, x + 30 + w + 10, yy + 102, { size: 28, weight: 600, color: FAINT });
  });
  y += Math.ceil(metrics.length / 2) * 150 + 10;
  // accordo tra i metodi
  if (plot) {
    card(pad, y, W - 2 * pad, plot.h + 100);
    text('Accordo tra i metodi (barra = ±1σ)', pad + 30, y + 52, { size: 26, weight: 800, color: MUT });
    ctx.drawImage(plot.img, pad + 20, y + 70, W - 2 * pad - 40, plot.h);
    y += plot.h + 100 + 26;
  }
  // tabella dei salti
  card(pad, y, W - 2 * pad, 70 + jumps.length * 58 + 16);
  const cols = [pad + 40, pad + 150, pad + 400, pad + 640, W - pad - 40];
  ['#', `Altezza ${u}`, `Volo ${u}`, 'Volo ms', 'Aff.'].forEach((t, i) => text(t, cols[i], y + 50, { size: 22, weight: 800, color: FAINT, align: i === 4 ? 'right' : 'left' }));
  jumps.forEach((j, i) => {
    const yy = y + 70 + (i + 1) * 58 - 14;
    ctx.fillStyle = LINE; ctx.fillRect(pad + 30, yy - 42, W - 2 * pad - 60, 2);
    const col = j === bj ? ACC : TXT;
    text(String(i + 1), cols[0], yy, { size: 30, weight: 700, color: col });
    text(conv(j.heightCm).toFixed(1), cols[1], yy, { size: 30, weight: 700, color: col });
    text(conv(fin(j.heightFlightCm) ? j.heightFlightCm : j.heightCm).toFixed(1), cols[2], yy, { size: 30, weight: 500 });
    text(fin(j.T) ? String(Math.round(j.T * 1000)) : '—', cols[3], yy, { size: 30, weight: 500 });
    text(j.confidence || '', cols[4], yy, { size: 28, weight: 600, color: MUT, align: 'right' });
  });
  y += 70 + jumps.length * 58 + 16 + 34;
  // nota (a capo automatico)
  const note = 'Misura da video: tempo di volo dai pixel del piede e baricentro dalla posa; nessuna pedana è stata usata. L\u2019incertezza è 1σ calcolata dai dati; l\u2019errore assoluto rispetto a una pedana non è stato verificato.';
  ctx.font = `400 22px ${FONT}`;
  let line = '', ny = y;
  for (const wd of note.split(' ')) { const t = line ? line + ' ' + wd : wd; if (ctx.measureText(t).width > W - 2 * pad && line) { text(line, pad, ny, { size: 22, color: FAINT }); ny += 32; line = wd; } else line = t; }
  if (line) { text(line, pad, ny, { size: 22, color: FAINT }); ny += 32; }
  text(`Jump Lab v${s.ver || VERSION}`, W - pad, ny + 10, { size: 22, color: FAINT, align: 'right' });
  y = ny - 2 * 34 + 10;
  const out = document.createElement('canvas'); out.width = W; out.height = Math.min(H, Math.round(y + 2 * 34 + 60));
  out.getContext('2d').drawImage(c, 0, 0);
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Immagine non creata'))), 'image/png'));
}

/** Condivide il report (foglio di condivisione) o lo scarica. Restituisce 'condiviso' | 'scaricato'. */
export async function shareReport(s, units = 'cm') {
  const blob = await makeReport(s, units);
  const name = `jumplab-${new Date(s.date).toISOString().slice(0, 10)}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Jump Lab' }); return 'condiviso'; } catch (e) { if (e?.name === 'AbortError') return 'annullato'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'scaricato';
}

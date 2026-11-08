// Grafici in SVG (stringhe) per i risultati: accordo tra i metodi e velocità del baricentro con le fasi del salto.
// Nessuna dipendenza dal DOM: funzioni pure, usabili anche dallo storico e dal report.

const ACC = '#c6f24e', MUT = '#5d6a77', TXT = '#aab6c2', GRID = '#1d252d', BLUE = '#7fa8ff', G = 9.80665;
const fin = Number.isFinite;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Passo "pulito" per le tacche di un asse (1, 2, 5 × 10^k) con circa n intervalli. */
function niceStep(span, n = 5) {
  const raw = span / n, k = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / k;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * k;
}

/**
 * Accordo tra i metodi: una riga per metodo con barra ±1σ e punto, su un asse comune, così si vede subito se concordano.
 * methods: [{ id, nome, cm, uncCm, level }]; conv: cm → unità mostrata; unit: 'cm' | 'in'; recommended: id del metodo consigliato.
 */
export function agreementPlot(methods, { conv = (x) => x, unit = 'cm', recommended = null } = {}) {
  const order = ['integrato', 'volo', 'baricentro', 'parabola'];
  const short = { integrato: 'Stima integrata', volo: 'Tempo di volo', baricentro: 'Baricentro (spazio)', parabola: 'Parabola' };
  const rows = order.map((id) => methods?.find((m) => m.id === id)).filter((m) => m && fin(m.cm));
  if (rows.length < 2) return '';
  const val = (m) => conv(m.cm), unc = (m) => (fin(m.uncCm) ? conv(m.uncCm) : 0);
  let lo = Math.min(...rows.map((m) => val(m) - 1.6 * unc(m))), hi = Math.max(...rows.map((m) => val(m) + 1.6 * unc(m)));
  const minSpan = unit === 'in' ? 2.4 : 6;
  if (hi - lo < minSpan) { const c = (hi + lo) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; }
  const step = niceStep(hi - lo, 5);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const W = 400, rowH = 32, top = 8, left = 116, right = 14, H = top + rows.length * rowH + 26;
  const X = (v) => left + ((v - lo) / (hi - lo)) * (W - left - right);
  const ticks = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const dec = step < 1 ? 1 : 0;
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Accordo tra i metodi di stima dell'altezza">`;
  for (const v of ticks) svg += `<line x1="${X(v).toFixed(1)}" y1="${top}" x2="${X(v).toFixed(1)}" y2="${H - 22}" stroke="${GRID}" stroke-width="1"/><text x="${X(v).toFixed(1)}" y="${H - 8}" fill="${MUT}" font-size="11" text-anchor="middle">${v.toFixed(dec)}</text>`;
  svg += `<text x="${left - 10}" y="${H - 8}" fill="${MUT}" font-size="11" text-anchor="end">${esc(unit)}</text>`;
  rows.forEach((m, i) => {
    const y = top + i * rowH + rowH / 2, main = m.id === 'integrato', col = main ? ACC : BLUE, v = val(m), u = unc(m);
    svg += `<text x="${left - 10}" y="${y + 4}" fill="${main ? '#fff' : TXT}" font-size="12.5" font-weight="${main ? 800 : 600}" text-anchor="end">${short[m.id]}${recommended === m.id ? ' ★' : ''}</text>`;
    if (u > 0) svg += `<line x1="${X(v - u).toFixed(1)}" y1="${y}" x2="${X(v + u).toFixed(1)}" y2="${y}" stroke="${col}" stroke-width="${main ? 6 : 4}" stroke-linecap="round" opacity="0.45"/>`;
    svg += `<circle cx="${X(v).toFixed(1)}" cy="${y}" r="${main ? 5.5 : 4.5}" fill="${col}" stroke="#0b1014" stroke-width="2"/>`;
    const lab = `${v.toFixed(1)}${u > 0 ? ` ± ${u.toFixed(1)}` : ''}`;
    const x = X(v + u) + 8, anchor = x + lab.length * 6.9 > W - 2 ? 'end' : 'start';
    svg += `<text x="${anchor === 'end' ? (X(v - u) - 8).toFixed(1) : x.toFixed(1)}" y="${y + 4}" fill="${main ? ACC : TXT}" font-size="12" font-weight="700" text-anchor="${anchor}">${lab}</text>`;
  });
  return svg + '</svg>';
}

/**
 * Velocità verticale del baricentro con le fasi (discesa, spinta, volo). La linea tratteggiata è la caduta libera attesa in volo
 * (v₀ − g·t): se la curva misurata la segue, la traiettoria è balistica e gli istanti di stacco e atterraggio sono coerenti.
 * curve: { t[], v[] } da jumpCurve; j: { to, td, onsetT, bottomT, bestV0 / v0 }.
 */
export function velocityPlot(curve, j, { fromT = null } = {}) {
  if (!curve || !curve.t?.length) return '';
  const to = j.to, td = j.td, T = td - to;
  const t0 = fromT ?? Math.max(curve.t[0], (fin(j.onsetT) ? j.onsetT : to - 0.9) - 0.25), t1 = Math.min(curve.t[curve.t.length - 1], td + 0.4);
  const idx = []; for (let i = 0; i < curve.t.length; i++) if (curve.t[i] >= t0 && curve.t[i] <= t1 && fin(curve.v[i])) idx.push(i);
  if (idx.length < 8) return '';
  const v0 = fin(j.bestV0) ? j.bestV0 : (j.v0 ?? G * T / 2), vEnd = v0 - G * T;
  const vs = idx.map((i) => curve.v[i]);
  let lo = Math.min(...vs, vEnd) - 0.3, hi = Math.max(...vs, v0) + 0.5;
  const step = niceStep(hi - lo, 5); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const W = 520, H = 190, L = 40, R = 12, Tp = 20, B = 26;
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), Y = (v) => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Velocità verticale del baricentro con le fasi del salto">`;
  const band = (a, b, col, label) => {
    if (!fin(a) || !fin(b) || b <= a) return '';
    const x0 = Math.max(L, X(a)), x1 = Math.min(W - R, X(b));
    if (x1 <= x0) return '';
    return `<rect x="${x0.toFixed(1)}" y="${Tp}" width="${(x1 - x0).toFixed(1)}" height="${H - Tp - B}" fill="${col}"/>` + (x1 - x0 > 34 ? `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${Tp - 6}" fill="${TXT}" font-size="10" font-weight="700" text-anchor="middle">${label}</text>` : '');
  };
  if (fin(j.onsetT) && fin(j.bottomT)) svg += band(j.onsetT, j.bottomT, 'rgba(127,168,255,0.10)', 'DISCESA');
  if (fin(j.bottomT)) svg += band(j.bottomT, to, 'rgba(198,242,78,0.12)', 'SPINTA');
  svg += band(to, td, 'rgba(255,255,255,0.05)', 'VOLO');
  for (let v = lo; v <= hi + 1e-9; v += step) svg += `<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${W - R}" y2="${Y(v).toFixed(1)}" stroke="${Math.abs(v) < 1e-9 ? '#3a4652' : GRID}" stroke-width="1"/><text x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" fill="${MUT}" font-size="10" text-anchor="end">${v.toFixed(step < 1 ? 1 : 0)}</text>`;
  const tick = step2(t1 - t0);
  for (let r = Math.ceil((t0 - to) / tick) * tick; to + r <= t1 + 1e-9; r += tick) svg += `<text x="${X(to + r).toFixed(1)}" y="${H - 8}" fill="${MUT}" font-size="10" text-anchor="middle">${r > 1e-9 ? '+' : ''}${r.toFixed(tick < 0.5 ? 2 : 1)} s</text>`;
  svg += `<text x="${W - R}" y="${Tp - 6}" fill="${MUT}" font-size="10" text-anchor="end">m/s</text>`;
  svg += `<line x1="${X(to).toFixed(1)}" y1="${Tp}" x2="${X(to).toFixed(1)}" y2="${H - B}" stroke="${ACC}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`;
  svg += `<line x1="${X(td).toFixed(1)}" y1="${Tp}" x2="${X(td).toFixed(1)}" y2="${H - B}" stroke="${ACC}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`;
  svg += `<path d="M${X(to).toFixed(1)},${Y(v0).toFixed(1)} L${X(td).toFixed(1)},${Y(vEnd).toFixed(1)}" stroke="${ACC}" stroke-width="1.6" stroke-dasharray="5 4" fill="none"/>`;
  svg += `<path d="${idx.map((i, k) => `${k ? 'L' : 'M'}${X(curve.t[i]).toFixed(1)},${Y(curve.v[i]).toFixed(1)}`).join('')}" stroke="#fff" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
  svg += `<circle cx="${X(to).toFixed(1)}" cy="${Y(v0).toFixed(1)}" r="4.5" fill="${ACC}" stroke="#0b1014" stroke-width="2"/>`;
  const lx = X(to) + 8, lab = `${v0.toFixed(2)} m/s`;
  svg += `<text x="${(lx + lab.length * 6.6 > W - R ? X(to) - 8 : lx).toFixed(1)}" y="${(Y(v0) - 7).toFixed(1)}" fill="${ACC}" font-size="11" font-weight="800" text-anchor="${lx + lab.length * 6.6 > W - R ? 'end' : 'start'}">${lab}</text>`;
  return svg + '</svg>';
}

function step2(span) { return span > 1.6 ? 0.5 : span > 0.8 ? 0.25 : 0.1; }

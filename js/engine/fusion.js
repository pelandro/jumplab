// Stima integrata dell'altezza balistica del salto (quella che riportano le pedane con il metodo impulso-quantità di moto):
//   h = v0² / (2g),  v0 = velocità verticale del baricentro allo stacco.
//
// Modello fisico. Il baricentro è in caduta libera tra stacco e atterraggio. Se all'atterraggio è più basso di Δ rispetto allo stacco,
//   T = (v0 + √(v0² + 2gΔ)) / g   ⇒   v0 = g·T/2 − Δ/T.
// Il tempo di volo T è misurato con precisione (istanti dai pixel del piede) ma ignora Δ (bias +Δ/2 sull'altezza: 2,5 cm con Δ = 5 cm).
// Δ si misura dalla traiettoria del baricentro come asimmetria del culmine: Δ̂ = −g·T·(t_culmine − metà volo), indipendente dalla scala.
//
// Combinazione (non è una media dei tre risultati): v0 = g·T/2 − Δ*/T con Δ* = media pesata per precisione di
//   · la misura dal baricentro Δ̂, con la sua incertezza (rumore dell'adattamento, finestra, scarto tra i baricentri, istanti);
//   · una prior debole sulla popolazione (letteratura: volo − velocità di stacco ≈ 2,5 cm in media, fino a ~10 cm ⇒ Δ ≈ 5 ± 4,5 cm).
// Se la misura è incerta (proxy discordi, istanti rumorosi) pesa di più la prior; se è precisa prevale la misura. Il peso è esposto.
//
// Errori (propagazione al primo ordine; i due istanti hanno la stessa incertezza σ_ev/√2 ciascuno):
//   var(v0*) = (g·σ_ev/2)²                      istanti nella parte g·T/2
//            + w²·g²·(σ_ev²/4 + σ_culmine²)      errore della misura di Δ (istanti + vertice)
//            + (1−w)²·σ_prior²/T²                 scostamento della popolazione dalla prior
// Validata con Monte Carlo (tests/index.html): bias ≤ 0,6 cm e RMSE inferiore al volo (2,5–3,4 cm) e, nelle condizioni realistiche, all'apice.
// NON validata contro una pedana: la prior e le incertezze di ingresso sono stime.

export const G = 9.80665;
export const PRIOR = { muM: 0.05, sigM: 0.045 }; // Δ atteso (m) e dispersione della popolazione

const fin = Number.isFinite;

/**
 * T: tempo di volo (s); uncT: incertezza (1σ) di T (s); apexAsymMs: culmine − metà volo (ms, < 0 se l'atterraggio è più basso);
 * apexSigTa: incertezza del solo vertice (s: adattamento, finestra, scarto tra proxy), senza gli istanti.
 * Restituisce null se mancano i dati del baricentro.
 */
export function integrate({ T, uncT, apexAsymMs, apexSigTa, prior = PRIOR }) {
  if (!(T > 0.1 && T < 1.5) || !fin(apexAsymMs) || !fin(apexSigTa)) return null;
  const sEv = Math.max(0, uncT || 0);
  const dHat = -G * T * (apexAsymMs / 1000); // Δ misurato (m); < 0 se il baricentro è più alto all'atterraggio
  const sD = G * T * Math.hypot(apexSigTa, sEv / 2); // 1σ della misura di Δ (m)
  const sP = prior.sigM;
  const w = (sP * sP) / (sP * sP + sD * sD); // peso della misura
  const dStar = w * dHat + (1 - w) * prior.muM;
  const v0 = (G * T) / 2 - dStar / T;
  if (!(v0 > 0)) return null;
  const varV = (G * sEv / 2) ** 2 + w * w * G * G * (sEv * sEv / 4 + apexSigTa * apexSigTa) + ((1 - w) * sP / T) ** 2;
  const sV = Math.sqrt(varV);
  const h = (v0 * v0) / (2 * G);
  return {
    cm: h * 100,
    uncCm: ((v0 * sV) / G) * 100,
    v0, v0Unc: sV,
    deltaCm: dStar * 100, deltaUncCm: Math.sqrt(1 / (1 / (sD * sD) + 1 / (sP * sP))) * 100, // posteriori del baricentro più basso all'atterraggio
    deltaMeasCm: dHat * 100, deltaMeasUncCm: sD * 100, wMeas: w,
    ftCm: ((G * T * T) / 8) * 100, // tempo di volo (Δ = 0), per confronto
  };
}

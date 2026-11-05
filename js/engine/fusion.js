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
//   · una prior debole sulla popolazione (letteratura: volo − velocità di stacco ≈ 1,1–2,5 cm in media, fino a ~10 cm ⇒ Δ ≈ 3,5 ± 4 cm).
// Seconda tecnica (opzionale): Δ statico = altezza del baricentro sopra il piede allo stacco − all'atterraggio. Se le due misure divergono oltre le loro incertezze
// l'incertezza a posteriori si gonfia in proporzione (evidenza in conflitto). Se la misura è incerta pesa di più la prior; i pesi sono esposti.
//
// Errori (propagazione al primo ordine; i due istanti hanno la stessa incertezza σ_ev/√2 ciascuno):
//   var(v0*) = (g·σ_ev/2)²                      istanti nella parte g·T/2
//            + w²·g²·(σ_ev²/4 + σ_culmine²)      errore della misura di Δ (istanti + vertice)
//            + (1−w)²·σ_prior²/T²                 scostamento della popolazione dalla prior
// Validata con Monte Carlo (tests/index.html): bias ≤ 0,6 cm e RMSE inferiore al volo (2,5–3,4 cm) e, nelle condizioni realistiche, all'apice.
// NON validata contro una pedana: la prior e le incertezze di ingresso sono stime.

export const G = 9.80665;
// Δ atteso (m) e dispersione della popolazione. Evidenza (letta): pedane, 12 partecipanti × 5 CMJ a mani sui fianchi (Aleksic et al., MMPose vs pedane):
// altezza da tempo di volo 0,286 m contro 0,275 m da velocità di stacco ⇒ volo − velocità di stacco ≈ 1,1 cm ⇒ Δ ≈ 2,2 cm; un altro studio (riassunto, non letto
// nel testo) riporta ≈ 2,5 cm ⇒ Δ ≈ 5 cm; la letteratura segnala sovrastime fino a ~10 cm in casi estremi. Prior debole: 3,5 ± 4 cm.
export const PRIOR = { muM: 0.035, sigM: 0.04 };

const fin = Number.isFinite;

/**
 * T: tempo di volo (s); uncT: incertezza (1σ) di T (s); apexAsymMs: culmine − metà volo (ms, < 0 se l'atterraggio è più basso);
 * apexSigTa: incertezza del solo vertice (s: adattamento, finestra, scarto tra proxy), senza gli istanti.
 * Opzionali: staticDeltaM/staticSigM = Δ misurato in modo statico (altezza del baricentro sopra il piede allo stacco meno all'atterraggio), con la sua
 * incertezza: seconda tecnica, indipendente dall'asimmetria del culmine. Se le due misure divergono, l'incertezza a posteriori si gonfia (rapporto di Birge).
 * Restituisce null se mancano i dati del baricentro.
 */
export function integrate({ T, uncT, apexAsymMs, apexSigTa, staticDeltaM, staticSigM, prior = PRIOR }) {
  if (!(T > 0.1 && T < 1.5) || !fin(apexAsymMs) || !fin(apexSigTa)) return null;
  const sEv = Math.max(0, uncT || 0);
  const dHat = -G * T * (apexAsymMs / 1000); // Δ dalla traiettoria (m); < 0 se il baricentro è più alto all'atterraggio
  const sD = G * T * Math.hypot(apexSigTa, sEv / 2); // 1σ della misura dinamica di Δ (m)
  const sP = prior.sigM;
  const hasStatic = fin(staticDeltaM) && fin(staticSigM) && staticSigM > 0;
  let prec = 1 / (sD * sD) + 1 / (sP * sP), num = dHat / (sD * sD) + prior.muM / (sP * sP);
  if (hasStatic) { prec += 1 / (staticSigM * staticSigM); num += staticDeltaM / (staticSigM * staticSigM); }
  const dStar = num / prec;
  // tensione tra le due misure (dinamica e statica): > 1 se divergono oltre le loro incertezze ⇒ evidenza in conflitto, incertezza maggiore
  const tension = hasStatic ? Math.abs(dHat - staticDeltaM) / Math.hypot(sD, staticSigM) : 0;
  const kappa = Math.max(1, tension);
  const sPost = kappa / Math.sqrt(prec);
  const v0 = (G * T) / 2 - dStar / T;
  if (!(v0 > 0)) return null;
  const sV = Math.hypot((G * sEv) / 2, sPost / T); // istanti nella parte g·T/2 + incertezza a posteriori di Δ
  const h = (v0 * v0) / (2 * G);
  return {
    cm: h * 100,
    uncCm: ((v0 * sV) / G) * 100,
    v0, v0Unc: sV,
    deltaCm: dStar * 100, deltaUncCm: sPost * 100, // posteriori del baricentro più basso all'atterraggio
    deltaMeasCm: dHat * 100, deltaMeasUncCm: sD * 100, // misura dinamica (asimmetria del culmine)
    deltaStaticCm: hasStatic ? staticDeltaM * 100 : NaN, deltaStaticUncCm: hasStatic ? staticSigM * 100 : NaN,
    wMeas: 1 / (sD * sD) / prec, wStatic: hasStatic ? 1 / (staticSigM * staticSigM) / prec : 0, wPrior: 1 / (sP * sP) / prec,
    tension,
    ftCm: ((G * T * T) / 8) * 100, // tempo di volo (Δ = 0), per confronto
  };
}

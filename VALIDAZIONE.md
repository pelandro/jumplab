# Jump Lab 4.0 — stato della validazione

## Verificato (in questo ambiente)

- **Motore di analisi su dati sintetici** (`tests/index.html`): 16 scenari (CMJ/SJ/DJ/rimbalzi × 30/60/120/240 fps),
  tutti i voli trovati, nessun falso positivo; errore medio sul tempo di volo 2–4 ms (120/240 fps), 5–10 ms (30/60 fps);
  errore sull'altezza ≈ 1–2% a 240 fps, ≈ 3–4% a 30–60 fps; contatto (DJ/rimbalzi) 3–11 ms.
- **Rilevamento slow-motion non calibrato** tramite gravità: riconosce 2×, 4×, 8× nei test sintetici.
- **Pipeline end-to-end** (`tests/pipeline.html`) su MP4 H.264 con B-frame a 240 e 60 fps: demux, WebCodecs,
  timestamp, ritaglio e finestre corretti; errore sul tempo di volo ≈ 1 ms (con modello finto).
- **MediaPipe 1.2.2 locale** (WASM + modello Full) si carica e rileva pose con landmark di talloni e punte su
  fotografie reali (GPU delegate, Chromium).
- **Interfaccia**: avvio analisi, revisione, correzione manuale, calibrazione, salvataggio e storico provati nel browser.

## NON verificato (serve test con video reali)

- **Accuratezza del modello di postura sui piedi in video reali di salti** (motion blur, scarpe, pavimenti,
  angoli). I test sintetici validano la matematica, non la rete neurale.
- Confronto con **piattaforma di forza** o con misure manuali a 240 fps: non eseguito. Nessuna dichiarazione di
  errore (cm) sull'app reale è quindi giustificata finché non lo si fa.
- **Safari/iPhone**: WebCodecs con HEVC, delegate CPU di MediaPipe, MediaRecorder, tempi di analisi.
  Il codice è scritto per iOS 16.4+, ma va provato su dispositivo.
- Video **Slo-mo importati dal selettore foto di iOS**: se Safari li ricodifica a 30 fps, la calibrazione
  automatica del tempo non è possibile; l'app lo segnala tramite il controllo di gravità e propone 2×/4×/8×.
- Drop jump e rimbalzi su video reali (la logica è collaudata solo su sintetici).

## Come validare in modo serio

1. Registra 20–30 salti in Slo-mo 240 fps con una persona nota e misura lo stesso tempo di volo a mano
   (frame-per-frame nella schermata di revisione) → errore dell'automatismo sugli eventi.
2. Se hai una pedana di forza o un sistema tipo Optojump, confronta altezza e contatto sugli stessi salti.
3. Segnala i casi con affidabilità "alta" ma errore grande: sono quelli da correggere nei controlli di qualità.

## Video reali (iPhone 16, ripresa frontale) — v4.1

Due video dello stesso atleta, provati nell'app (Chromium, modello Full) e in Node sul motore.

| Video | Cosa contiene | v4.0 | v4.1 |
|---|---|---|---|
| IMG_0181 (60 fps, normale) | 1 CMJ con braccia | stacco 1,92 s, volo 1,31 s, **210 cm** (errato) | stacco 2,64 s, atterraggio 3,19 s, volo 0,555 s, **37,8 cm**, confidenza alta |
| IMG_0180 (slow-mo esportato a 30 fps) | 1 CMJ con braccia, rallentato | «Nessun salto rilevato» | salto trovato, volo 2,67 s in tempo-video, **suggerimento ×4** dal controllo di gravità (→ circa 0,67 s reali, circa 54 cm) |

### Bug corretti
1. **Deriva del suolo.** Con atleta ripreso di fronte che si avvicina alla camera, i piedi dopo l'atterraggio stanno più in basso
   nell'immagine di prima dello stacco. Il vecchio livello unico del suolo (minimo prima/dopo) faceva cercare lo stacco all'inizio
   del segnale o scartava il volo. Ora per i salti singoli il suolo è stimato localmente su ciascun lato; drop jump e rimbalzi
   mantengono il comportamento precedente.
2. **Falsi voli che oscurano il volo vero** nei video rallentati: se la fisica conferma un rallentamento, il volo lungo ha la precedenza.

### Test aggiunti
`tests/index.html` → «Deriva del suolo»: 6 scenari (30/60/240 fps, deriva 0,02 e 0,04 altezze-fotogramma). La v4.0 ne falliva 1;
la v4.1 li supera tutti con errore sul tempo di volo 2–13 ms. Nessuna regressione sugli altri 16 scenari.

### Limiti
- Solo un atleta, due video, nessun confronto con pedana o TrackJump: l'accuratezza assoluta resta non validata.
- Il fattore di rallentamento (IMG_0180) è stimato dalla fisica (×4, cioè 120 fps); non coincide con i 180 fps indicati dall'utente.
  Va confermato con il file originale o con TrackJump.
- Nel video rallentato l'atterraggio ha un'incertezza di circa ±0,1 s di tempo-video, cioè circa ±5 cm dopo la calibrazione.

### Confronto con TrackJump (IMG_0181, salto non rallentato)
- TrackJump: **34,9 cm** (volo equivalente 0,534 s). JumpLab v4.1: **37,8 cm** (volo 0,555 s). Differenza 2,9 cm (+8 %),
  cioè circa 1,3 fotogrammi a 60 fps: nell'ordine dell'errore di ±1 fotogramma (≈ ±3 cm a questa altezza).
- Controllo indipendente dalla posizione dei piedi: la parabola del bacino in volo ha curvatura coerente con g in tempo reale
  (scala da g: 430–520 px/m; scala dal corpo: 450–475 px/m) e culmine a 2,90 s. Con stacco a 2,64 s dà un volo di circa 0,51 s
  (≈ 32 cm); i piedi danno 0,555 s (≈ 38 cm). TrackJump cade nel mezzo.
- Un solo confronto: non basta per dire se JumpLab sovrastimi in modo sistematico. Servono altri salti dello stesso atleta.

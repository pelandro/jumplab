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

## v4.2 — affidabilità di stacco e atterraggio

### Cosa dice la letteratura (base delle modifiche)
- Il **tempo di volo sovrastima l'altezza** quando si atterra con più flessione di caviglie/ginocchia che allo stacco
  (baricentro più basso all'atterraggio): in media 2–11 %, circa 2,5 cm in uno studio su 27 persone, fino a +60 % in simulazione con
  differenze di caviglia di 20°. Fonti: PMC11368081, PMC10483722, Kibele.
- Le app da smartphone validate (My Jump, iPhone 240 fps) hanno ICC 0,997 e bias di +1,1 ± 0,5 cm rispetto alla pedana,
  ma con scelta **manuale** dei fotogrammi di stacco e atterraggio.
- Con pose estimation da smartphone l'altezza è buona (ICC 0,84–0,99), mentre **tempo di volo e di contatto sono la parte più debole**
  (da scarsi a moderati, arXiv 2312.11340). Piedi tesi allo stacco/atterraggio distorcono il tempo (Webering & Blume, CVPRW 2021).
- **Non esistono validazioni pubblicate di BlazePose sui punti del piede nei salti**: l'errore assoluto va misurato con una pedana.

### Misure su video reale (IMG_0181, 60 fps, iPhone 16, stesso atleta; riferimento TrackJump 34,9 cm = 32 fotogrammi)
Nove configurazioni (modello Lite/Full/Heavy × normale/specchio/ritaglio grande), volo con motore v4.1 → v4.2:

| | v4.1 | v4.2 |
|---|---|---|
| intervallo del volo tra le 9 configurazioni | 0,535–0,556 s (21 ms) | **0,521–0,537 s (16 ms; Full/Heavy 0,530–0,537)** |
| altezza | 35,1–37,9 cm | **33,3–35,4 cm** |
| distanza da TrackJump (34,9 cm) | fino a +3,0 cm | **entro ±1,6 cm** |

- Rumore dei piedi da fermi (σ per landmark): Lite 1,04 px, Full 1,08, Heavy 1,00; con media immagine normale + specchiata:
  0,76 / 0,86 / **0,67** (−20…−30 %). Risoluzione più alta del ritaglio (960 px) non migliora.
- Media di più modelli: nessun vantaggio rispetto a Heavy + specchio.
- Rifinire con Heavy + specchio solo ±0,15 s attorno a stacco e atterraggio dà lo stesso risultato che su tutto il video.

### Modifiche
1. **Fit a due rette con suolo inclinato** (`hingeFit2`) per stacco e atterraggio, con finestre ottimizzate (0,12 s lato rampa, 0,14 s lato
   suolo; finestre più larghe peggiorano). Il suolo dopo l'atterraggio non è piatto: passo, avvicinamento alla camera, assestamento.
2. **Suolo locale** per ciascun lato (v4.1) + **ripiego sul bacino** per buchi fino a 0,25 s nei piedi (la copertura reale resta nella valutazione).
3. **Rifinitura Heavy + specchio** attorno a stacco e atterraggio (impostazione «Rifinitura», attiva di default).
4. **Incertezza (1σ)** su ogni salto: ±0,35 fotogrammi per evento (spread osservato) + rumore/pendenza + spostamento dovuto alla rifinitura.
5. **Avviso di postura**: bacino ≥ 8 cm più basso all'atterraggio che allo stacco (stima corretta mostrata). La stima varia di 3–8 cm sullo
   stesso salto tra i modelli (rumore ±2,5 cm): per questo avvisa solo su differenze nette e non corregge in automatico.

### Test sintetici v4.1 → v4.2 (errore medio sul tempo di volo, ms)
| | v4.1 | v4.2 |
|---|---|---|
| CMJ 30 / 60 / 240 fps | 7,6 / 7,3 / 3,7 | 7,8 / **5,2** / **3,0** |
| SJ 30 / 60 / 240 fps | 6,9 / 4,5 / 2,6 | **5,4** / 5,4 / 3,9 |
| DJ 30 / 60 fps | 7,4 / 7,1 | **4,6 / 5,4** |
| Rimbalzi 60 fps | 7,7 | **6,8** |
| piedi che scivolano dopo l'atterraggio (60 fps) | 93 | **7,0** |
| piedi non rilevati 3,5 fotogrammi dopo l'atterraggio (30 fps) | volo perso (0/8) | **8/8, 18 ms** |
| rumore forte + valori anomali ai contatti (60 fps) | 22,0 | **15,6** |

SJ a 60 e 240 fps sono leggermente peggiori (+0,9 e +1,3 ms), restano sotto 1 fotogramma. Tutti i test automatici passano.

Limite noto: camera che trema (3 Hz, ±11 px) a 240 fps → 8,8 ms. Usare un supporto fermo.

### Resta non validato
- Un solo atleta, due video, un confronto con TrackJump (che conta fotogrammi interi: ±1 fotogramma = ±3 cm a 60 fps).
- Nessun confronto con pedana di forza: l'errore assoluto resta sconosciuto.
- Nessuna prova su Safari/iPad. La rifinitura con Heavy gira su CPU nei dispositivi Apple: tempi da misurare.

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

## v4.3 — pavimento, vista laterale, qualità della ripresa, formule

### Cosa è stato verificato e come
| Funzione | Verifica | Esito |
|---|---|---|
| Atterraggio in un punto diverso dallo stacco | gradino del suolo di ±0,03 e ±0,06 altezze-fotogramma (≈ ±9 e ±19 cm) a metà volo, 30/60/240 fps | errore sul volo invariato (5–6 ms); il tracciamento locale del suolo della v4.2 lo gestiva già |
| Suolo diverso: avviso | la differenza di livello suolo stacco/atterraggio è misurata e segnalata oltre 15 cm (non per DJ/rimbalzi) | solo su sintetico |
| **Salto su una gamba** | il selettore Sinistra/Destra era solo un'etichetta; ora usa solo i landmark del piede che salta. Gamba libera 0,07 più in basso in volo: due gambe 65–91 ms di errore, una gamba **7–10 ms** | verificato su sintetico |
| Riconoscimento inquadratura | rapporto larghezza spalle / lunghezza busto: **0,68 su video frontale reale** (Lite 0,66, Full 0,69, Heavy 0,68). Frontale ≥ 0,50, laterale < 0,22, obliqua in mezzo | frontale reale; laterale/obliqua solo con scheletri stilizzati |
| Controllo qualità della ripresa | fps, risoluzione, piedi visibili, atleta piccolo/grande/tagliato, più persone, inquadratura | su casi costruiti |
| Più persone | una traccia per persona; si segue quella con maggiore escursione verticale del bacino | vedi sotto |
| Formule | Samozino, Sayers, RSI, altezza da volo, statistiche di serie con valori calcolati a mano | 9 su 9 |

### Formule (e fonti)
- Altezza da tempo di volo: `h = g·T²/8`. Sovrastima se si atterra più flessi che allo stacco (2–11 %, ~2,5 cm).
- Forza, velocità e potenza medie di spinta: **Samozino et al. 2008** (validato su pedana): `F = m·g·(h/hpo + 1)`, `v = √(g·h/2)`,
  `P = F·v`, con `hpo` = spostamento del bacino dal punto più basso allo stacco. Identico al calcolo precedente, ora esplicito, con valori per kg.
- Potenza di picco **Sayers et al. 1999, equazione per squat jump** (`60,7·h + 45,3·m − 2055`). Applicata a dati CMJ sovrastima ~2,7 %.
  I coefficienti «CMJ» che si trovano in giro non sono stati confermati da una fonte primaria e non sono usati.
- RSI = altezza / tempo di contatto. Il calcolo da tempo di volo tende a sovrastimare sotto 1,0 e sottostimare sopra 1,0 rispetto a quello
  da velocità di stacco (Healy et al. 2019): confronti tra atleti con cautela.
- Nuovi: FT:CT (volo / tempo al decollo), velocità media di spinta, forza e potenza per kg, variabilità (CV) e calo di altezza nelle serie.

### Limiti dichiarati
- **Nessun video laterale reale è stato provato.** Il codice funziona su dati sintetici laterali, ma l'accuratezza di stacco/atterraggio da
  vista laterale non è misurata.
- Forza e potenza sono stime con scala dalla statura dichiarata (errore di scala plausibile ±5 %): non sono misure da pedana.
- Le schede di ripresa sono buone pratiche. Distanza e altezza della camera non sono state validate da nessuno studio trovato.
- Non esiste un dataset pubblico accessibile con video + pedana (Zenodo, IEEE DataPort, Figshare controllati): BioCV (Università di Bath) è su richiesta.

### Perché due persone possono ottenere risultati diversi sullo stesso video (verifica v4.3)
Salto IMG_0181 (60 fps, TrackJump 34,9 cm), modello Heavy + specchio, volo e altezza dopo la condivisione simulata:

| Variante del file | Volo | Altezza |
|---|---|---|
| Originale (1072×1904, 60 fps) | 0,530 s | 34,5 cm |
| 720p, CRF 28 (~0,6 Mbit/s) | 0,530 s | 34,5 cm |
| 480p, 0,8 Mbit/s | 0,530 s | 34,5 cm |
| Qualità molto bassa (CRF 30, 1,1 Mbit/s) | 0,527 s | 34,1 cm |
| Ridotto a 30 fps (1072×1904) | 0,529 s | 34,3 cm (±2,2) |
| 480p a 30 fps | 0,527 s | 34,1 cm (±2,1) |
| Frame rate variabile, 20 % dei fotogrammi eliminati | 0,527 s | 34,1 cm |
| Frame rate variabile, 40 % eliminati | 0,530 s | 34,5 cm (avviso di copertura) |

→ **La ricompressione, la risoluzione, il bitrate e il frame rate variabile da soli non spiegano differenze di più di ~1 cm.**

Cause che invece possono dare differenze grandi:
1. **Versione dell'app**: sullo stesso video la v4.0 dava 210 cm, la v4.1 37,8 cm, la v4.2/v4.3 33,7 cm. Ora la versione è visibile in Home e nel Profilo.
2. **Slow-motion**: un file «appiattito» a 30 fps ha una calibrazione che cambia l'altezza di molte volte (×4 → 53 cm, ×6 → 21 cm, ×8 → 12 cm). Due persone con calibrazioni diverse sullo stesso file ottengono numeri molto diversi.
3. **Percorso di lettura del video**: con WebCodecs si usano i tempi reali; altrimenti (browser/codec non supportati) si usa `<video>` con tempi stimati. Corretto in v4.3: la misura degli fps ora riproduce a 1/4 di velocità (prima, su un video a 60 fps, misurava 30 fps e analizzava un fotogramma su due: stesso risultato ma incertezza raddoppiata).
4. **Impostazioni**: modello (Lite/Full/Heavy) e rifinitura: ±0,5–1 cm; tipo di test, gamba, calibrazione.
5. **Rifinitura non eseguita** (Heavy non caricato per memoria): ora segnalato nei risultati.
6. **Video diversi**: stessa ripresa ma non lo stesso file, o un frame rate diverso all'origine.

Per confrontare due analisi: Dettagli tecnici → «Copia riepilogo» (versione, lettura, modello, calibrazione, risultato).

### Fotogrammi sintetici (interpolazione) e registrazione 120/240 fps — v4.3
**Domanda:** generare un fotogramma intermedio tra due reali migliora stacco e atterraggio?
**Esperimento** (IMG_0181, 60 fps veri come riferimento; un fotogramma su due eliminato, quelli mancanti ricostruiti dai vicini con flusso ottico DIS bidirezionale
+ rimappatura; modello Heavy + specchio; due fasi di decimazione):

| | errore landmark piedi nei fotogrammi mancanti (px) | volo, fase pari / dispari (rif. 0,530 s) | incertezza dichiarata |
|---|---|---|---|
| solo 30 fps | – | 0,531 / 0,525 s | ±2,2 cm |
| + fotogrammi sintetici (immagine) | **3,51** | 0,535 / 0,522 s | ±1,1 cm (non reale) |
| + landmark interpolati (media o cubica) | 3,10–3,11 | 0,533 / 0,527 s | ±1,1 cm |

PSNR del fotogramma generato sui piedi: 38,5 dB, ma il modello vi trova i piedi peggio che interpolando direttamente le coordinate. Il fit sub-fotogramma già in uso
estrae la temporizzazione tra due fotogrammi: generare immagini **non aggiunge informazione**, introduce artefatti e farebbe dichiarare una precisione non reale.
**Non implementato.** Limiti dell'esperimento: un solo salto, interpolazione non appresa (flusso ottico classico); un modello appreso (RIFE/FILM) rende meglio le immagini
ma non può aggiungere informazione sul contatto reale.

**Registrazione 120/240 fps dall'app:** non possibile da un sito web. Le modalità Slo-mo dell'iPhone appartengono all'app Fotocamera; non esiste (fonti consultate) una
API web per la registrazione ad alta velocità, e getUserMedia resta tipicamente a 30–60 fps. La fotocamera dell'app prova 240 → 120 → 60 fps entro il massimo dichiarato
dal dispositivo, mostra quanto ottiene e rimanda alla guida Slo-mo. Per registrare 120/240 fps dentro l'app servirebbe un'app nativa (non realizzabile né verificabile qui).
Non provato su iPhone reale: solo con dispositivi video finti da 30/60/120 fps in Chromium.

## v4.4 — stacco e atterraggio dai pixel del piede, alta frequenza

### Ricerca (sintesi delle decisioni)
| Tecnologia | Esito |
|---|---|
| **BlazePose (MediaPipe)** | Resta il modello di postura: unico con talloni e punte utilizzabile in browser senza dipendenze. Limite scoperto: i landmark del piede **non coincidono con i pixel del piede** (vedi sotto). |
| RTMPose/RTMW (133 punti, 6 sul piede) via ONNX Runtime Web | Fattibile in browser (WebGPU) ma senza benchmark pubblici sulla precisione dei piedi e con pesi non raggiungibili da qui: non adottato. |
| Apple Vision (2D: caviglie, niente tallone/punta; 3D iOS 17: 17 giunti) / Core ML | Solo app nativa, senza punti del piede: non utile per un'app web. |
| YOLO-pose | 17 punti COCO senza piedi (e licenza AGPL per YOLO11): scartato. |
| Segmentazione del pavimento | Non necessaria: il tracciamento dei pixel del piede dà il contatto senza modello del suolo. |
| Interpolazione di fotogrammi | Misurata e scartata (v4.3): non aggiunge informazione. |
| **Tracciamento dei pixel del piede (template matching sub-pixel + fit a rampa quadratica)** | **Adottato** (nessuna dipendenza, ~100 ms per salto). |
Riferimenti: Evans et al. 2018 (contatti entro 1,5 fotogrammi a 180 fps rispetto a pedana); letteratura sul tempo di volo (sovrastima con atterraggio flesso).

### Il problema trovato (video reale a 120 fps, IMG_0180 con calibrazione ×4)
Verifica visiva fotogramma per fotogramma: le punte bianche restano ferme fino a ~1,34 s e toccano terra a ~1,978 s.

| Stimatore | Stacco | Atterraggio | Volo | Altezza |
|---|---|---|---|---|
| Landmark Full | 1,368 s (+25 ms) | 2,024 s (+46 ms) | 0,656 s | 52,7 cm |
| Landmark Heavy + specchio | **1,256 s (−87 ms)** | 2,026 s | **0,771 s** | **72,8 cm** |
| **Pixel del piede** | 1,347 s | 1,975 s | **0,627–0,630 s** | **48,3–48,7 cm** |
A 60/30 fps l'errore dei landmark si nasconde (non si risolve la fase di rotolamento del piede); ad alta frequenza emerge. Cause: la punta del modello segue la gamba mentre il tallone si alza (30 px di deriva in 150 ms senza che il piede si muova) e all'atterraggio si assesta quando il tallone si abbassa.

### Come funziona il nuovo stimatore (`js/engine/footflow.js`)
1. Template matching (correlazione normalizzata a media zero, sub-pixel con parabola) di una zona attorno alla punta di ciascun piede, da un fotogramma al successivo, sui ritagli già salvati.
2. Si integra lo spostamento verticale e si fitta «suolo inclinato → rampa quadratica» (`hingeQuad`): una rampa retta anticipa lo stacco di b·L²/6 ÷ pendenza (≈6 ms) perché il moto è parabolico.
3. Stacco = ultimo piede che parte; atterraggio = primo contatto, **solo avampiede** (le zone del tallone danno falsi plateau: verificato guardando i fotogrammi del salto a 60 fps).
4. Controlli: correlazione media > 0,7; almeno 3 fotogrammi tracciati prima e dopo l'evento; residuo del fit piccolo; non sotto 25 fps; plausibilità (±120 ms dai landmark). Se non passano, si usano i landmark e si segnala.
5. Incertezza: floor ±0,35 fotogrammi per evento + metà della discordanza pixel/landmark + dispersione tra i due piedi. Confidenza ridotta se gli stimatori discordano o se ad alta frequenza restano solo i landmark.

### Verifiche eseguite
| Test | Risultato |
|---|---|
| Scene sintetiche con verità nota (texture, rumore σ≈3/255, landmark iniziali ±10 px, stima iniziale sbagliata fino a 50 ms, 30/60/120/240 fps, 24 salti) | 48/48 eventi trovati; errore stacco **≤ 0,7 ms**, atterraggio **2–4 ms** |
| Zona senza texture | rifiuta (nessun evento) |
| 20 fps | non usato |
| Tuo salto a 60 fps (IMG_0181) | stacco 2,6406 s, atterraggio 3,1740 s → volo 0,5333 s (34,9 cm). **Questo non è una validazione**: TrackJump conta fotogrammi interi (32 a 60 fps, ±1 fotogramma = ±3 cm) e non è una verità; la concordanza dice solo che non c'è una discrepanza grande. Lo stesso salto con i landmark dava 0,524–0,536 s. |
| Video a 120 fps decimato (120 → 60 → 40 → 30 fps equivalenti) | volo cambia al massimo di **5,7 ms** (i landmark: fino a 213 ms) |
| Stesso salto a 60 fps decimato a 30 fps | cambia di 1–2 ms |
| Stima iniziale volutamente sbagliata di 90 ms | stesso risultato |
| Suite sintetica esistente (landmark, 49 scenari) | nessuna regressione |

### Alta frequenza (120/240 fps)
- Limite di 500 fotogrammi per finestra di analisi: a 240 fps si analizza 1 fotogramma su 2 (120 effettivi). Misurato: 120 → 60 fps sposta il volo di 1–2 ms. Dimezza il tempo di calcolo.
- Gli errori dei landmark a 120 fps sono maggiori che a 30–60 fps: senza evidenza dai pixel l'app avvisa (confidenza ridotta, invito al controllo manuale).

### Limiti (non dichiarare di più)
- **Nessuna verità da pedana.** I riferimenti sono: due eventi controllati a occhio su fotogrammi a 120 fps (±1 fotogramma ≈ 8 ms; una volta ho letto male un atterraggio a occhio, quindi va preso con cautela) e il conteggio di fotogrammi di TrackJump su un salto a 60 fps.
- Un solo atleta, due video veri; il video «a 120 fps» è uno slow-mo esportato a 30 fps con fattore ×4 stimato dalla fisica, non letto dal file.
- **Nessun video a 240 fps reale**: il percorso del codice è stato provato con fotogrammi duplicati, non con dati reali.
- Presuppone atterraggio sull'avampiede. Con atterraggio a tallone il contatto sulle punte arriva dopo (la differenza con i landmark, se grande, è segnalata).
- Le zone sono centrate sui landmark iniziali; scarpe scure su pavimento scuro a bassa risoluzione possono non dare un tracciamento affidabile (in quel caso si ricade sui landmark).
- Non provato su iPhone/iPad: tempi di calcolo e supporto codec da misurare.
- Il movimento della camera non è compensato (il tracciamento misura il movimento nell'immagine): usare un supporto fermo.


### Su cosa si fonda (e su cosa NO) la validazione degli eventi
TrackJump (o qualunque app) **non è una verità**: quantizza a fotogrammi interi e ha i propri bias. L'obiettivo è misurare meglio di lei, quindi le evidenze usate sono indipendenti:
1. **Scene sintetiche con verità esatta** (30–240 fps, rumore, landmark errati): errore ≤ 0,7 ms stacco, 2–4 ms atterraggio.
2. **Verifica visiva fotogramma per fotogramma** su un video reale a 120 fps (±1 fotogramma ≈ 8 ms; limite: la lettura è mia e già una volta mi sono sbagliato a occhio).
3. **Ripetibilità**: dimezzando/riducendo i fps dello stesso video reale il volo cambia di 1–6 ms (landmark: fino a 213 ms). Misura la precisione, non l'assenza di errore sistematico.
4. **Coerenza fisica**: parabola del bacino in volo, controlli di postura e di gravità.
**Non dimostrato**: l'errore assoluto rispetto a una misura strumentale (pedana, interruttori a contatto, accelerometro). Protocollo economico proposto per ottenerlo: un secondo telefono con un'app di accelerometro (es. Phyphox, ~100 Hz) legato alla vita registra l'atterraggio e il volo libero (accelerazione ≈ 0 in volo) in contemporanea al video; inoltre un test di **caduta di una palla** da altezza nota (t = √(2h/g)) a 240 fps per verificare tutta la catena dei tempi.

### Video vero ad alta frequenza a frame rate variabile (IMG_0180 originale, iPhone 16, 1080p, 447 fotogrammi in 2,46 s, passo 4,2–8,3 ms ≈ 240/120 fps, tempi reali del file)
È la prima misura con fotogrammi veri a 4–8 ms (le precedenti a 120 fps erano uno slow-mo appiattito con fattore stimato).

| Stimatore | Stacco | Atterraggio | Volo | Altezza |
|---|---|---|---|---|
| Landmark Heavy + specchio | 1,557 s | 2,207 s | 0,650 s | 51,8 cm |
| Landmark Full | 1,560 s | 2,213 s | 0,653 s | 52,3 cm |
| **Pixel del piede** (inizializzato da Heavy o da Full) | **1,544 s** | **2,162 s** | **0,618–0,620 s** | **46,8–47,1 cm** |
| App completa (WebCodecs, VFR, 223 fotogrammi analizzati) | 1,544 s | 2,163 s | 0,619 s | 47,0 cm |

- I pixel danno lo stesso volo con Heavy e Full e decimando a 120 e 60 fps (±1 ms) e a 30 fps (0,625 s); i landmark da 0,636 a 0,695 s (fino a 59,3 cm con Heavy a 40 fps).
- Evidenza fisica: all'atterraggio le punte scendono di ~36 px e **restano ferme dal 2,17 s** (36,6 px a 2,175 s, 36,7 px a 2,26 s); i landmark indicavano 2,207 s, cioè 35–45 ms dopo che il piede era fermo. Allo stacco le punte sono ferme fino a 1,533 s e partono a 1,542 s; i landmark 1,557–1,570 s.
- Lo slow-mo appiattito dello stesso gesto (fattore ×4 suggerito dalla gravità) dà con i pixel 0,627 s (48,2 cm): 8 ms di differenza, compatibili con un fattore reale di ~4,05. Con i landmark dava 55,4 cm.
- Errore dei landmark su questo atleta/scarpe (punte bianche, calze nere, pavimento scuro, atterraggio sulle punte): stacco +13…+26 ms, atterraggio +35…+50 ms in ritardo, quindi volo sovrastimato di circa 30 ms (+5 cm). Può dipendere dall'atleta e dalle scarpe: **non generalizzabile** senza altri atleti.
- Limite: il «contatto» dai pixel è l'intersezione rampa-plateau (~5–8 ms prima dell'arresto completo della punta); l'incertezza dichiarata include almeno 5 ms per evento. È una stima, non validata contro una pedana.


### Secondo atleta e ripresa laterale (IMG_0207, IMG_0208: 170 cm, CMJ, laterale, 240/120 fps VFR, tempi reali; app v4.4.1)
Prima ripresa **laterale** reale e primo atleta diverso. L'app riconosce la vista come «laterale».

| Video | Landmark (offline, Heavy+specchio / Full) | Pixel (offline) | App completa (pixel) |
|---|---|---|---|
| IMG_0207 | volo 0,612–0,630 s (45,9–48,7 cm) | 0,599–0,609 s (44,0–45,5 cm) | **0,606 s, 45,0 ± 1,2 cm** |
| IMG_0208 | volo 0,597–0,609 s (43,7–45,4 cm) | 0,581–0,597 s (41,4–43,7 cm) | **0,580 s, 41,3 ± 1,6 cm** |

- I landmark danno un volo **più lungo di 14–30 ms (+3–5 cm)** dei pixel anche su questo atleta; ma con **segno diverso** sugli eventi: qui anticipano lo stacco (−9…−21 ms) e atterrano 2–19 ms in anticipo, mentre nell'atleta 1 ritardavano entrambi. Non esiste una correzione fissa.
- Tracce dei pixel: la punta è ferma fino a ~1,29 s e parte con rampa ripida da ~1,30 s (IMG_0207); all'atterraggio scende di ~21 px e resta ferma dal 1,904 s. Pixel 1,3004 / 1,9011 s; landmark 1,281–1,291 / 1,906–1,911 s.
- **Ripetibilità** (stesso video, fotogrammi diversi): atterraggio ±1–3 ms in entrambe le viste; **stacco ±2 ms in frontale, ±10–16 ms in laterale** (il piede ruota e il template matching segue peggio; un caso a 30 fps equivalenti: +27 ms). Per questo l'app misura la ripetibilità su 6 sottocampionamenti, usa la mediana, scarta l'evento se l'intervallo supera 30 ms e include metà dell'intervallo nell'incertezza.
- Un controllo di copertura troppo rigido scartava lo stacco valido con campionamento irregolare (33 ms di rampa tracciata contro 37,5 richiesti): corretto.
- **Vista e atleta sono confusi**: l'atleta 1 è stato ripreso solo frontalmente (suole bianche, calze nere), l'atleta 2 solo lateralmente (calze e scarpe bianche). La differenza di ripetibilità dello stacco (±2 ms contro ±10–16 ms) può dipendere dalla vista, dall'atleta o dalle scarpe: con questi dati **non si può attribuire alla vista**. Serve lo stesso atleta ripreso nelle due viste, nella stessa sessione, su più salti.

Limiti: 2 atleti, 5 salti reali; nessuna verità da pedana; stacco nei video laterali meno ripetibile (±10–16 ms ≈ ±1,5–2,4 cm), causa non attribuibile (vista/atleta/scarpe); non provato su iPhone/iPad.

### Riferimento di letteratura più vicino (letto dal PDF): Chiu et al., J Biomech 186 (2025) 112695
77 atleti d'élite (170 ± 9 cm), iPhone 12 mini a **120 fps** (e 30 fps simulati prendendo 1 fotogramma su 4), camera a 2,5 m perpendicolare al piano sagittale, **pedana Hawkin Dynamics a 1000 Hz** come riferimento (decollo = primo punto con forza < 10 N). Metodo: segmentazione (PointRend) + posa (ViTPose); il punto più basso della sagoma, filtrato passa-basso a 4 Hz, dà decollo e atterraggio dai punti critici dell'accelerazione; `h = g·T²/8`.

| | MAE | R | Limiti di accordo 95 % | Media (rif. 547 ms / 36,2 cm) |
|---|---|---|---|---|
| Tempo di volo, 120 fps | **17 ms** | 0,92 | −43 … +59 ms | 555 ms (+8 ms) |
| Tempo di volo, 30 fps | 20 ms | 0,89 | −71 … +44 ms | 533 ms (−14 ms) |
| Altezza, 120 fps | 3,0 cm | 0,91 | −4,8 … +8,8 cm | 38,2 cm (+2,0 cm) |
| Altezza, 30 fps | 2,6 cm | 0,88 | −8,3 … +6,6 cm | 35,4 cm (−0,8 cm) |

Lettura: è il metro esterno con verità da pedana a cui confrontarci. Un buon metodo da video arriva a un errore medio assoluto di ~17 ms sul volo (±50 ms al 95 %) e a una piccola sovrastima a 120 fps. Le differenze che abbiamo misurato tra landmark e pixel (14–30 ms sul volo, eventi singoli fino a 87 ms) hanno la stessa scala di quegli errori; **non sappiamo ancora** se il nostro tracciamento dei pixel sia più vicino alla pedana di quel 17 ms: servirebbero dati con pedana.

### Dove stanno i dati con verità (verificato)
| Fonte | Esito |
|---|---|
| Chiu 2025 | il PDF e la scheda SHURA non riportano alcun deposito dati. Contatto: c.chiu@shu.ac.uk, jameschang@mail.cmu.edu.tw. |
| ND-Jump (Blanchard, 89 atleti, CMJ e drop jump) | i **video si ottengono su richiesta** da cvrl.nd.edu (ND-Jump Analysis Video Dataset). Il repository [Blanchard-lab/ape-v](https://github.com/Blanchard-lab/ape-v) contiene solo scheletri OpenPose (anca, ginocchio, caviglia in pixel) ed etichette di errori tecnici: **nessuna forza né istanti di stacco/atterraggio**. |
| ForcePose (Michigan) | forza a 600 Hz + mocap + pose 2D, CMJ inclusi, ma i dati sono nei tarball di prism.eecs.umich.edu con **certificato scaduto dal 20/06/2025**: non scaricabili in modo sicuro. Il repository GitHub ha solo il codice. Non contiene immagini. |
| BioCV (Bath) | su richiesta. |

## v4.5 — verifica incrociata dei dati, patch di tracciamento, altezza da velocità di stacco

Cosa è stato provato in questa versione, con esito (inclusi i risultati negativi).

### Esperimenti su video reali (5 salti, 2 atleti, tempi reali del file)
| Prova | Esito | Decisione |
|---|---|---|
| **Baricentro a segmenti** (de Leva 1996, 33 punti BlazePose) al posto del bacino, valutato con il residuo balistico (la traiettoria in volo deve essere una parabola con g = 9,81) | **peggiore** del bacino: più rumore, i segmenti degli arti (braccia in oscillazione) disturbano l'apice | si resta sul bacino come proxy del baricentro |
| **Dimensione della finestra di confronto** (patch ZNCC) | 0,018·h → 0,03·h (10–18 px): ripetibilità dello stacco laterale da ±16 → ±8 ms (0207) e ±10 → ±7 ms (0208); frontale ±2 → ±4 ms; stime centrali spostate di soli 1–3 ms | adottato `0,03·h` |
| **Parte del piede seguita** (punta/tallone, spostamento di 1–3 px del punto iniziale) | sposta gli eventi di **6–14 ms** | resta un errore sistematico di ~±7 ms, incluso nell'incertezza dichiarata |
| Decimazione dei fotogrammi sui video veri (240/120 → 120, 60, 40, 30 fps equivalenti) | volo stabile entro pochi ms fino a ~60 fps equivalenti; sotto, l'evento viene scartato o cade sui landmark | invariato (soglia 25 fps, intervallo ≤ 30 ms) |

### Nuovo: altezza da velocità di stacco (apice del baricentro) — *poi migliorata nella v4.6, vedi sotto*
Seconda stima dell'altezza, indipendente dalla posizione di atterraggio: dal bacino si ricava l'istante dell'apice (vertice della parabola, finestra centrale del volo) e si calcola `h = g·(t_apice − t_stacco)²/2`. Non dipende dalla scala in pixel né dal fatto che si atterri più flessi (che gonfia l'altezza da tempo di volo del 2–11 % in letteratura).
- **Test sintetici** (CMJ con fisica balistica, 12 salti per frequenza): rapporto apice/volo **1,010 (60 fps), 1,006 (120 fps), 0,999 (240 fps)**; asimmetria dell'apice 2,6 / 1,0 / 0,7 ms. Fa parte della suite (`tests/index.html`).
- **Video reali** (apice − volo): −0,9, −2,8, −3,2, −6,6 cm sui quattro salti dell'esperimento offline. App completa su IMG_0181 (60 fps): volo 34,9 cm, apice **32,0 ± 2,7 cm** (−2,9 cm, asimmetria −11 ms).
- **Cosa NON è provato**: non c'è una verità da pedana, quindi non si sa quale delle due stime sia più vicina al vero. Il bacino di BlazePose non è il baricentro (con le braccia che si muovono può sbagliare di qualche cm). Per questo l'app **mostra l'apice come controllo e non lo sostituisce al tempo di volo**; se le due stime differiscono più del 15 % compare un'informazione.
- Compare nei risultati («Da velocità di stacco: X ± Y cm»), nelle metriche e nell'export CSV (`altezza_vel_stacco_cm`). Solo per voli < 1,5 s.

### Controlli di funzionamento (v4.5.0)
- Suite sintetica completa (scenari CMJ/SJ/DJ/rimbalzi a 30–240 fps, deriva, robustezza, formule, vista, qualità, suolo, singola gamba, pixel del piede): **tutti entro soglia**.
- Percorso completo nel browser reale (WebCodecs → posa → pixel → rifinitura → risultati) sul video IMG_0181 (taglio breve): nessun errore di pagina, risultati e nuove righe presenti.
- Cache offline: ora comprende anche `quality.js`, `footflow.js`, `guide.js`.

### Limiti (invariati e nuovi)
- 2 atleti, 5 salti reali: nessuna verità da pedana, quindi **errore assoluto non dimostrato**; solo ripetibilità e coerenza fisica.
- Riferimento di letteratura per un metodo da video a 120 fps: MAE 17 ms sul volo, 3,0 cm sull'altezza (Chiu 2025). Non affermiamo di fare meglio.
- Errore sistematico del punto seguito sul piede ~±7 ms (≈ ±1 cm); stacco laterale meno ripetibile (±7–8 ms) di quello frontale.

## v4.6 — altezza da velocità di stacco: baricentro a corpo intero e incertezza misurata

Richiesta: migliorare il calcolo della velocità di stacco usato come controllo. Prima (v4.5) si adattava una parabola al **solo bacino** (landmark 23/24) e l'incertezza era una soglia fissa di 8 ms scelta a mano.

### Dove stava l'errore (misurato, non supposto)
- Il rumore casuale non è il problema: con residui di ~1 cm l'istante del culmine ha ~1 ms di incertezza casuale. Il problema è **sistematico**: il bacino non è il baricentro.
- Il culmine dipende dall'istante di stacco quasi come il tempo di volo: 4 ms di errore sullo stacco danno ±1,1 cm. Non eliminabile (è la velocità *a quell'istante*).
- La g stimata dalla curvatura (9,3–12,6 m/s² sui 4 salti, a seconda di come si misura la scala) **non** è un controllo affidabile: la scala dall'altezza dell'atleta ha ±15–25 %. Il calcolo resta quindi indipendente dalla scala (vertice di una parabola a curvatura libera), e non si usa g come criterio di scarto.

### Confronto dei baricentri sui video reali (app completa, istanti dai pixel; altezza da tempo di volo → culmine, cm)
| Video | Volo | Bacino (v4.5) | Tronco | **Corpo intero (v4.6)** |
|---|---|---|---|---|
| 0181 frontale 60 fps | 34,9 | 32,0 | 29,3 | **28,9** |
| 0180 frontale 240/120 (Heavy+specchio / Full) | 46,9 | 45,9 / 45,1 | 43,6 / 43,2 | **41,2 / 41,1** |
| 0207 laterale | 44,7 | 41,4 / 41,8 | 41,4 / 41,5 | **41,2 / 41,7** |
| 0208 laterale | 42,4 | 35,9 / 36,0 | 35,9 / 35,9 | **35,8 / 35,9** |

- **Ripetibilità tra i due modelli** (media su 0180/0207/0208): bacino 0,43 cm, tronco 0,17 cm, corpo intero 0,23 cm.
- **Sensibilità alla finestra** (taglio 4–30 % del volo): bacino 0,5–3,2 cm, tronco 0,1–0,9 cm. **Residuo balistico**: bacino 0,43–0,80 cm, tronco 0,22–0,51 cm. L'adattamento robusto (Tukey) non cambia nulla di misurabile: non adottato.
- **Scomposizione** (atleta 1, frontale, con oscillazione delle braccia): le braccia abbassano il culmine di 2,6–3,9 cm (scendono in volo, il baricentro si abbassa rispetto al tronco), le gambe lo alzano di 0,8–1,6 cm. Nell'atleta 2 (laterale, braccia ferme) contano ≤ 0,2 cm. Il solo tronco/bacino sovrastima l'altezza proprio quando le braccia oscillano.
- Il primo tentativo a segmenti (v4.4) era peggiore perché i punti comparivano e sparivano e la massa visibile cambiava a ogni fotogramma. Ora si usa una formula additiva: tronco+testa (50,4 %) come riferimento, e per ogni tipo di segmento (de Leva 1996) la media dei lati utilizzabili; i segmenti leggeri non osservabili si omettono senza rinormalizzare. Braccio, coscia e gamba sono obbligatori; senza di essi si ripiega su tronco, poi su bacino. Sotto ~33 fps gli arti non si usano.

### Cosa è stato verificato con verità nota (simulazione)
- **Atleta con braccia che oscillano** (scenario costruito perché il baricentro a corpo intero sia esattamente balistico): il solo tronco/bacino sovrastima di **+2,2…+2,4 cm** (braccia orizzontali → giù) e **+4,2…+4,4 cm** (braccia in alto → giù); il corpo intero sbaglia di **0,1–0,5 cm** (60 e 240 fps). Senza braccia i due coincidono (0,01–0,02 cm). Verifica segno, masse e finestre, ma è un test del metodo contro il suo stesso modello di corpo, **non** del rumore dei landmark reali.
- **Monte Carlo** (200 prove × 30/120/240 fps; proxy con rumore 1 cm e deriva; istanti con errore 4 ms; atterraggio 6 cm più basso dello stacco): bias ≤ 0,3 cm, errore assoluto medio ≈ 1,0 cm, **copertura a 2σ ≥ 95 %** (a 1σ 70–87 %: l'incertezza è leggermente prudente).
- **Sottocampionamento sui video veri** (240 → 120 → 60 fps equivalenti): corpo intero stabile entro 0,1 cm sui laterali e 41,0–41,2 cm sul frontale (0180, prima 40,8–43,6 per l'insieme di segmenti che cambiava con la fase dei fotogrammi: corretto). Sotto ~33 fps si ripiega sul tronco.

### Incertezza (ora dai dati, non da una soglia fissa)
σ(culmine − stacco) = √(σ_adattamento² + σ_finestra² + σ_proxy² + σ_stacco²): rumore del vertice, differenza tra tagli di finestra, **metà della distanza massima tra i tre baricentri** (corpo intero, tronco, bacino), incertezza dello stacco (0,7·σ_volo). Passa da ±2,7 cm fisso a ±1,4–2,7 cm (±1,4/1,5 laterale, ±2,0 e ±2,5/2,7 frontale: dove i baricentri divergono di più).

### Nei risultati
«Da velocità di stacco: X ± Y cm», velocità di stacco dal culmine (m/s), baricentro usato, scarto tra i modi di stimarlo, culmine rispetto a metà volo; CSV: `altezza_vel_stacco_cm`, `inc_vel_stacco_cm`, `baricentro_culmine`, `v_stacco_culmine_ms`.

### Cosa NON è provato (non dichiarare di più)
- **Nessuna verità da pedana**: non si sa se il corpo intero sia più vicino al vero del tronco o del bacino; si sa che è più coerente con la fisica (arti inclusi), ripetibile e senza il bias da braccia dimostrato in simulazione.
- Il deficit rispetto al tempo di volo è **3,0–6,5 cm (media 5,2 cm, 12 %)**: sopra la media di letteratura (volo − velocità di stacco ≈ 2,5 cm; fino a ~18 % in simulazione con caviglie flesse all'atterraggio). Non si può escludere che una parte derivi da un istante di stacco in ritardo (8 ms = −2 cm sul culmine) o dai punti degli arti.
- La stima di postura bacino-piedi (altezza «corretta») sullo stesso salto cambia di 6 cm tra un modello e l'altro (0180: −0,9 e 5,4 cm): troppo rumorosa per arbitrare tra i due metodi.
- Resta il **tempo di volo l'altezza principale**; il culmine è un controllo con la sua incertezza.

### Validazione ibrida a tre metodi (v4.6, `js/engine/validate.js`)
Tre misure dell'altezza, confrontate e **mai mediate**:

| Metodo | Come | Dipende da | Si rompe quando |
|---|---|---|---|
| 1. Tempo di volo | h = g·T²/8, istanti dai pixel del piede con i tempi reali del file | i due istanti | si atterra più flessi (sovrastima 2–18 %); istanti sbagliati |
| 2. Baricentro nello spazio | spostamento del baricentro tra stacco e culmine in metri, con la scala dell'altezza dell'atleta | scala, prospettiva | altezza dell'atleta sbagliata, camera inclinata o lontana |
| 3. Parabola del baricentro | v₀ = g·(t_culmine − t_stacco), h = v₀²/2g, adattamento a curvatura libera | lo stacco | baricentro mal stimato; stacco sbagliato |

Il metodo 2 e il 3 usano la stessa traiettoria (corpo intero, tronco o bacino): **non sono indipendenti**; il loro rapporto equivale a «curvatura / g», cioè verifica che la scala sia coerente con la gravità. Sui 4 salti reali vale 0,96–1,13 con la scala dell'app.

**Coerenza a coppie** (tolleranze fisiche, non calibrate con una pedana): parabola/volo tra 0,80 e 1,03 (atterraggio più basso dello stacco: letteratura fino a ~18 %); spazio/parabola tra 0,75 e 1,33; culmine rispetto a metà volo tra −40 e +15 ms (−40 ms ≈ baricentro 13 cm più basso all'atterraggio). **Affidabilità per metodo** (alta/media/bassa) con i motivi: fonte degli istanti (pixel/misti/landmark/manuali), fps, incertezza, baricentro usato (corpo intero > tronco > bacino), scarto tra i tre baricentri, adattamento, coerenza della scala, altezza dell'atleta impostata. **Metodo consigliato**: il tempo di volo, salvo che la parabola abbia un livello strettamente superiore; nessuno se gli istanti sono sospetti (si chiede la correzione manuale a fotogramma, che ricalcola tutto). **Anomalie di serie**: salto oltre 3,5 σ robuste e >20 % dalla mediana (≥ 4 salti).

**Risultati sui 4 salti reali** (istanti dai pixel; altezze in cm):
| Video | Volo | Spazio | Parabola | Verdetto |
|---|---|---|---|---|
| 0181 frontale 60 fps | 34,9 | 28,9 | 28,9 | coerenti |
| 0180 frontale 240/120 | 46,9 | 39,7 | 41,2 | coerenti |
| 0207 laterale | 44,7 | 46,4 | 41,2 | coerenti |
| 0208 laterale | 42,4 | 40,2 | 35,8 | coerenti |

I tre metodi dello stesso salto differiscono fino a 5–6 cm (0181: 6 cm; 0207: 5 cm): è la dispersione reale tra i metodi, non un errore dichiarato di uno di essi. **Nessuna verità da pedana**: non sappiamo quale dei tre sia il più vicino al vero.

**Errori iniettati** (salto sintetico a 240 fps con verità, più 0207 reale): cosa viene segnalato
| Errore | Sintetico | Reale (0207) |
|---|---|---|
| stacco anticipato di 40 ms | **segnalato** | non segnalato (la dispersione naturale del culmine, −10…−24 ms, lo nasconde) |
| atterraggio anticipato di 40 ms | **segnalato** | non segnalato |
| atterraggio in ritardo di 60 ms | non segnalato (parabola/volo 0,81) | **segnalato** (culmine fuori dal plausibile) |
| atterraggio in ritardo di 30 ms, stacco in ritardo di 40 ms | non segnalati | non segnalati |
| altezza atleta 140 invece di 175 cm | **segnalata** (scala) | non segnalata (rapporto 0,90) |
| altezza atleta 210 invece di 175 cm | non segnalata (rapporto 1,13) | **segnalata** |

**Limite misurato**: un atterraggio in ritardo di 30–60 ms o uno stacco in ritardo di 40 ms danno un rapporto parabola/volo di 0,81–0,90, **indistinguibile** da un atterraggio molto flesso. La validazione incrociata sul solo baricentro coglie errori grossolani (≥ ~40–60 ms, scala ≥ ~30 %), non quelli piccoli. Gli istanti restano affidati ai pixel del piede (concordanza pixel/landmark) e alla correzione manuale.

**Altezza balistica e spostamento dalla posizione iniziale** (sono grandezze diverse): la balistica è l'altezza del baricentro *sopra la posizione dello stacco* (v²/2g); lo spostamento è il massimo del baricentro *rispetto alla posizione in piedi iniziale* = (baricentro allo stacco − in piedi) + balistica. Il primo termine si misura con la scala, il secondo con g: sommare tutto in pixel porterebbe l'errore di scala sull'intera altezza (verificato: −2,5 cm con la scala sbagliata del 6 %, −0,3…+0,4 cm con la somma corretta). Test sintetici con verità: balistica ±0,3 cm, baricentro allo stacco +5,0 vero → errore −0,3…+0,2 cm. **Sui video reali**: baricentro allo stacco +23,7 cm (0180, frontale con oscillazione delle braccia) e +14,1 cm (0207, laterale), spostamento massimo 64,9 e 55,3 cm; plausibili (corpo esteso, braccia in alto, punte) ma **non verificati**. Disponibile solo se il video mostra la posizione in piedi prima del contromovimento (non in 0181 e 0208).

**Modelli di postura (valutazione, non sostituzione)**: l'app resta su MediaPipe BlazePose (Heavy con immagine specchiata attorno agli eventi, Full altrove) perché gira nel browser senza caricare i video. RTMPose/RTMW (ONNX Runtime Web, anche con punti di piede) e ViTPose sono alternative serie, ma **non sono state provate**: richiedono rilevatore + modello (decine di MB), integrazione e un confronto sugli stessi video. Gli errori dominanti trovati qui non vengono dal rumore dei punti (ripetibilità del baricentro 0,2–0,5 cm tra modelli) ma da cosa si intende per baricentro e dagli istanti: per questo la prima mossa sono stati pixel del piede e baricentro a corpo intero. Un cambio di modello è utile solo se verificato con lo stesso banco (`apex_exp`) e, meglio, con una pedana.

### Confronto con RTMPose-x, RTMW-x/m e ViTPose-L (ONNX Runtime, v4.6)
Prova richiesta: valutare RTMPose/RTMW/ViTPose al posto di BlazePose. Pesi ufficiali OpenMMLab: **RTMPose-x halpe26** (384×288, 26 punti con tallone e alluce) e **RTMW-x** (cocktail14, 384×288, 133 punti con piedi); **ViTPose-L COCO-25** (256×192, 25 punti con piedi; ONNX della raccolta easy_ViTPose, non distribuito dagli autori di ViTPose, provenienza non verificabile con un checksum ufficiale). Eseguiti con `onnxruntime` sugli **stessi ritagli** dell'app (riquadro = intero ritaglio, senza rilevatore; pre-elaborazione verificata sul `pipeline.json` dei modelli: media/dev. standard, 288×384, nessun flip), punti mappati sul formato a 33 landmark e analizzati con il **codice reale dell'app** con gli istanti dai pixel. 3 video (0181, 0207, 0208), 5 analisi. La mappa dei punti è stata controllata contro BlazePose (scarti 0,1–6 cm, nessuno scambio destra/sinistra).

**Eventi dai landmark** (errore rispetto ai pixel del piede, ms, stacco / atterraggio; media dei valori assoluti su 3 video):
| Modello | passaggi | stacco | atterraggio |
|---|---|---|---|
| BlazePose Heavy + specchio | 2 × Heavy | 5 | 5 |
| BlazePose Full | 1 | 12 | 5 |
| RTMPose-x halpe26 | 1 | 5 | 4 |
| RTMW-x | 1 | 3 | 6 |
| ViTPose-L (COCO-25) | 1 | 5 | 6 |
| RTMW-m (256×192, taglia ridotta) | 1 | 3 | 6 |
(a 120 fps equivalenti: 4/5, 12/6, 6/4, 3/7, 4/6). Per video, firmato: 0181 Heavy −5/−3, Full +5/0, halpe +9/−5, RTMW +4/−3; 0207 −7/+5, −17/+9, −4/+7, +3/+6; 0208 −4/+7, −15/+5, −2/0, +2/+9; ViTPose-L +3/0, +4/+8, +7/+9 (0181, 0207, 0208).

**Culmine del baricentro a corpo intero** (cm; Heavy / Full / halpe / RTMW / ViTPose-L): 0181 28,8 / 28,3 / 29,3 / 28,0 / 28,9 · 0207 41,3 / 41,7 / 42,7 / 42,0 / 42,2 · 0208 35,8 / 35,9 / 35,8 / 35,7 / 36,4; RTMW-m 27,9 · 42,4 · 35,9. **Intervallo tra i 6 modelli** ≈ 1,4 · 1,5 · 0,7 cm (tra i soli due BlazePose 0,5 · 0,4 · 0,1). **Residuo balistico** (cm): Heavy 0,18–0,24, Full 0,25–0,30, halpe 0,34–0,40, RTMW 0,23–0,32, ViTPose-L 0,30–0,46 (heatmap a passo di 4 px), RTMW-m 0,53–0,79. In frontale (0181) il bacino di BlazePose dista 3,1 cm dal corpo intero, quello di RTMW 1,3 cm.

**ONNX Runtime Web** (Chromium headless, WASM, 4 thread, isolamento cross-origin; ort-web 1.22): stesso ingresso reale di Python → uscite identiche (differenza massima 3,5·10⁻⁶ per RTMPose-x e 2,3·10⁻⁵ per RTMW-x; 26/26 e 133/133 punti identici). **Latenza 336 ms (RTMPose-x), 357 ms (RTMW-x) e 1041 ms (ViTPose-L) per fotogramma**, caricamento 2–4 s per i primi due e **22,8 s per ViTPose-L** (uscite identiche anche per ViTPose-L: differenza massima 5,1·10⁻⁷, 25/25 punti); in Python nativo su CPU 80–86 ms (RTMPose), 281–358 ms (ViTPose-L). RTMW-m: 107 ms, caricamento 1,2 s, uscite identiche (3,0·10⁻⁶, 133/133), 28–30 ms in Python. **Dimensione 200 MB, 229 MB, 129 MB (RTMW-m) e 1,23 GB**, contro 5,8 / 9,4 / 30,7 MB di BlazePose Lite / Full / Heavy.

**Lettura e decisione** (3 video, 2 atleti: nessuna verità da pedana):
- Sugli eventi i modelli RTMPose a passaggio singolo equivalgono a Heavy+specchio (che costa due passaggi) e battono Full allo stacco (3–5 ms contro 12 ms). Le differenze di 1–2 ms tra i migliori sono dentro il rumore di 3 video.
- Sul culmine i sei modelli concordano entro 1,5 cm: **il contributo della scelta del modello all'incertezza è ≲ 1,5 cm**, coerente con le incertezze dichiarate (±1,4–2,0 cm). È un'indicazione di robustezza, non di esattezza.
- **Non si sostituisce BlazePose**: nessun guadagno misurabile oltre il rumore, in cambio di 7–40 volte la dimensione (ViTPose-L: 130–210 volte, 1,23 GB), 340–1040 ms/fotogramma nel browser desktop (non misurato su iPhone/iPad, dove memoria e prestazioni WASM sono i rischi principali) e un'integrazione top-down. Nota di merito per RTMW-x: bacino più coerente col tronco in frontale.
- Gli istanti restano comunque affidati ai pixel del piede, indipendenti dal modello: la scelta del modello incide solo sul ripiego e sul baricentro.
- ViTPose-L non dà vantaggi (eventi 5/6 ms, residuo balistico più alto) e con 1,23 GB e 22,8 s di caricamento è impraticabile su un telefono (non misurato).
- RTMW-m è l'unico con un costo nel browser vicino a quello di BlazePose Heavy (129 MB, 107 ms), ma è il più rumoroso (residuo 0,53–0,79 cm) e non migliora gli eventi rispetto a RTMW-x.
- **Scelta finale (criterio: minor errore misurato, a parità di risultato il più semplice): si resta su BlazePose Heavy + specchio.** Ha il residuo balistico più basso su tutti e tre i video (0,18–0,24 cm contro 0,23–0,79 cm degli altri) e un errore sugli eventi (4–5 ms) a pari merito con i migliori (3–6 ms); nessuna alternativa riduce l'errore oltre il rumore. Gli errori che contano (istanti, definizione del baricentro, atterraggio flesso) non dipendono dal modello.
- **Non provati**: RTMPose/RTMW di taglia l, versioni quantizzate INT8, WebGPU, iPhone/iPad, ViTPose di altre taglie.

## v4.7 — modello integrato, audit dei tre metodi e dei parametri

Richiesta: ricontrollare la correttezza dei tre metodi e dei parametri, raffinarli e combinarli in un modello a errore minimo. Qui sotto: cosa è stato verificato (con i numeri), il modello e i suoi limiti, senza dichiarare accuratezze non dimostrate.

### Audit: cosa si è scoperto
| Elemento | Verifica | Esito |
|---|---|---|
| Tempo di volo, h = g·T²/8 | propagazione degli errori (Monte Carlo, 120 fps, istanti 3–8 ms) | corretto per atterraggio simmetrico (errore casuale 0,64–1,74 cm) ma **bias +Δ/2** se il baricentro all'atterraggio è più basso dello stacco di Δ: +2,5 cm con Δ = 5 cm, +4,9 cm con Δ = 10 cm |
| Parabola del baricentro | stessa simulazione | **senza bias** (salvo la deriva del proxy), ma errore casuale ≈ 1,5× quello del volo: v₀ dipende dall'istante di stacco con peso g invece di g/2 (0,96–2,5 cm) |
| Spazio (scala) | curvatura/g con la scala dell'app sui 4 salti | 0,96–1,13 (media +5 %, dev. st. ≈ 8 %): si assume σ_scala = 8 %. Prospettiva (distanza e inclinazione) non corretta |
| Masse dei segmenti | de Leva maschile → femminile sui 4 salti | apice ≤ 0,3 cm, stima integrata ≤ 0,05 cm: trascurabile, nessuna impostazione del sesso |
| Dip e spinta (Samozino) | ricavati dal solo bacino | ora dal **baricentro a corpo intero** (ripiego tronco, poi bacino); sul sintetico dip 28,5–29,0 cm (vero 30) |
| RSI, forza/potenza di Samozino, velocità media | usavano l'altezza dal tempo di volo | usano l'**altezza principale** (integrata o volo, secondo l'impostazione); Sayers resta sul volo (equazione ricavata per squat jump) |
| Errore dominante della catena | propagazione | l'**istante di stacco**: 5 ms ⇒ ±1,4 cm sull'altezza da velocità di stacco; il modello non può eliminarlo |

### Il modello integrato (`js/engine/fusion.js`)
Fisica: tra stacco e atterraggio il baricentro è in caduta libera; se all'atterraggio è più basso di Δ, **v₀ = g·T/2 − Δ/T** e h = v₀²/2g (l'altezza delle pedane con impulso-quantità di moto). Il volo ha T preciso ma ignora Δ. Δ si misura **dalla traiettoria** del baricentro: Δ̂ = −g·T·(t_culmine − metà volo), indipendente dalla scala.

> **Correzione (v4.7.2).** La versione 4.7.0–4.7.1 usava anche una seconda misura «statica» di Δ (altezza del baricentro sopra il piede allo stacco meno all'atterraggio) e la presentava come indipendente. **Non lo è e non è affidabile sui video reali**, vedi «La misura statica di Δ» più sotto: è stata tolta dall'app. In 4.7.2 Δ\* è la media pesata per precisione di **due** evidenze: la misura dinamica e una **prior debole di popolazione, Δ = 3,5 ± 4 cm** (vedi sotto). Non è una media dei tre metodi. L'incertezza è (g·σ_ev/2)² + (σ_Δ\*/T)². I pesi sono mostrati nei risultati; i tre metodi restano come controlli, con affidabilità motivata. Il canale per una seconda misura di Δ resta in `fusion.js` (con test) per quando ci sarà un riferimento davvero indipendente, ma l'app non lo alimenta.

**Monte Carlo** (simulazione autonoma, 120 fps, rumore del baricentro 1 cm, istanti 5 ms; solo la tecnica dinamica + prior; RMSE su h in cm, volo / apice / **integrata**):
| Popolazione di Δ | senza deriva del proxy | con deriva 2 cm |
|---|---|---|
| tipica N(3,5; 3) cm (= prior) | 2,51 / 1,57 / **1,39** | 2,52 / 1,88 / **1,51** |
| atterraggio rigido N(1, 1) | 1,31 / 1,61 / 1,40 | 1,30 / 1,89 / **1,28** |
| molto flesso N(10, 3) (prior sbagliata) | 5,24 / 1,56 / 2,17 | 5,24 / 1,84 / 2,51 |
| mista N(6, 5) | 3,97 / 1,55 / 1,77 | 3,91 / 1,85 / 1,99 |
**Costo dichiarato della prior**: con popolazioni molto più flesse della prior la stima integrata ha un bias di +1,6…+2,1 cm e perde 0,6–0,7 cm rispetto alla sola parabola; rispetto alla sola parabola guadagna 0,2–0,6 cm con popolazioni tipiche o rigide; rispetto al tempo di volo l'errore è 1,7–1,8 volte inferiore con popolazioni tipiche, 2,0–2,2 volte con popolazioni miste e **uguale** (nessun vantaggio) con atterraggi rigidi.

**Pipeline completa con verità nota** (simulatore con atterraggio più basso dello stacco di Δ, 240 fps, eventi automatici, 3 semi; ricontrollata con il codice 4.7.2, solo traiettoria + prior): errore della stima integrata **+0,4 / +0,5 / +0,7 / +0,8 / +1,1 cm** con Δ = 0 / 3 / 5 / 8 / 12 cm (il solo volo sovrastima di 0,5 / 2,0 / 3,0 / 4,4 / 6,3 cm; la sola parabola di 0,4–0,7 cm). Nel simulatore la misura statica funzionava (−0,05 / 4,6 / 9,5 cm su Δ = 0 / 5 / 10) perché il suolo e il piede sono noti esattamente: è proprio ciò che manca nei video reali.

### La misura statica di Δ: cosa avevo detto, cosa era sbagliato (correzione v4.7.2)
La v4.7.0 riportava «le due misure di Δ non concordano sui video reali» (traiettoria 12–14 cm contro statica 4–5 cm in 3 salti su 4) e lasciava intendere che una delle due avesse un errore sistematico non identificabile. Con i quattro CMJ del terzo atleta (5 nov, 181 cm / 76 kg) ho analizzato **15 analisi su 3 atleti** e trovato che **il difetto era della misura statica**, non una discordanza tra due misure buone:
- **(a) Non è indipendente**: senza un riferimento al suolo, «altezza del baricentro allo stacco meno all'atterraggio» coincide algebricamente con l'asimmetria del culmine (per una parabola Δ = −b·T). Le due misure erano la stessa grandezza vista due volte con rumori diversi.
- **(b) Riferita al landmark del piede**: bias −7 ± 4,5 cm (a terra il landmark del piede risulta già 8–14 cm sopra il suolo allo stacco e 4–8 cm al contatto, per la postura del piede).
- **(c) Riferita al suolo stimato dai landmark**: −2 ± 7 cm; lo «spostamento del suolo» (fino a 13 cm) è la postura del piede, non un movimento reale.
- **(d) Riferita al punto del piede tracciato dai pixel**: +2 ± 8 cm (lo stesso punto del piede non è sulla stessa zona dell'appoggio allo stacco e all'atterraggio).
Nessun riferimento esaminato ha dato un errore piccolo e stabile: la misura è stata **tolta dall'app**. Il valore negativo (−2…−13 cm, fisicamente impossibile) sul terzo atleta era il segnale che qualcosa non andava. **Resta vero e non verificato** che un ritardo comune di entrambi gli istanti sposta Δ̂ di +5,4 cm ogni +10 ms senza essere visibile al modello.
Controllo di plausibilità (non una validazione): con la **stessa pipeline** (stessi pixel, stesso baricentro, 240 fps) il terzo atleta, con atterraggio rigido, dà Δ̂ tra −1,4 e +2,9 cm, mentre atleti 1 e 2 danno 7–14 cm. Se l'ampia Δ̂ degli atleti 1 e 2 fosse un artefatto di ritardo comune degli istanti, comparirebbe anche nel terzo; non c'è. Non esclude un ritardo comune piccolo (pochi ms, ≲2 cm).

### Sui 4 salti reali dei primi due atleti (istanti dai pixel; altezze in cm; codice 4.7.2: traiettoria + prior)
| Video | Volo | Parabola | **Integrata** | Δ traiettoria | Δ a posteriori | Peso traiettoria |
|---|---|---|---|---|---|---|
| 0181 frontale | 34,9 | 28,9 ± 2,0 | **31,0 ± 1,5** | 12,6 | 7,9 | 49 % |
| 0180 frontale | 46,9 | 41,2 ± 2,7 | **43,8 ± 1,8** | 11,8 | 6,3 | 34 % |
| 0207 laterale | 44,7 | 41,2 ± 1,5 | **41,7 ± 1,3** | 7,0 | 6,0 | 72 % |
| 0208 laterale | 42,4 | 35,8 ± 1,4 | **37,1 ± 1,3** | 13,9 | 11,0 | 72 % |
Con la v4.7.0 (con evidenza statica) le integrate erano 31,9 / 44,1 / 41,2 / 38,0: la differenza di togliere la misura statica è 0,3–0,9 cm. **Nessuna evidenza di questi salti è stata usata per ritoccare la prior** (sarebbe circolare): la prior viene dalla letteratura.

### Altezza principale
Ora l'app mostra come cifra principale la **stima integrata** (equivalente all'impulso-quantità di moto delle pedane), con il tempo di volo sempre visibile accanto; si può tornare al solo tempo di volo (come le app a 240 fps) dal pulsante nei risultati o dalle impostazioni. RSI, Samozino e velocità media seguono la scelta.

### Letteratura letta (testi completi via l'API BioC di NCBI) e cosa ne ricavo
**Aleksic et al., markerless MMPose vs pedane (PMC11677309)**: 12 partecipanti × 5 CMJ a mani sui fianchi, iPhone 13 a 240 fps a 2 m, vista laterale, MMPose con la statura per la calibrazione, baricentro a segmenti di Dempster; pedane AMTI a 1000 Hz.
- Altezza dal **tempo di volo**: 0,285 m contro 0,286 m delle pedane, differenza −0,001 m (IC −0,005…0,003), ICC 0,985 ⇒ gli istanti da pose a 240 fps non introducono bias sul volo.
- Altezza come **spostamento del baricentro dalla posizione iniziale**, non corretta: 0,363 contro 0,295 m (**+0,068 m**, ICC 0,787); corretta per l'altezza della caviglia allo stacco: 0,270 contro 0,275 m (−0,005 m, n.s., ICC 0,864). È la distinzione tra spostamento dal punto iniziale e altezza balistica implementata qui.
- Traccia di velocità del baricentro: bias +0,005 m/s, limiti di accordo −0,253…+0,263 m/s, RMSE 0,138 m/s, r = 0,992; velocità di stacco 2,346 contro 2,299 m/s (+0,047 m/s, ICC 0,944).
- Dalle medie e dalla deviazione standard riportate (mio calcolo): altezza da velocità di stacco delle pedane ≈ 27,5 cm contro 28,6 cm dal tempo di volo ⇒ **volo − velocità di stacco ≈ 1,1 cm ⇒ Δ ≈ 2,2 cm** su questi partecipanti.

**Meta-analisi su My Jump (PMC10656545)**: 21 studi, 839 partecipanti; punteggi grezzi non diversi dai criteri (Hedges g = −0,047; p = 0,21), correlazione r = 0,989, affidabilità r = 0,986. **Solo misure basate sul tempo di volo**: gli autori dichiarano che servono ulteriori studi contro i metodi di riferimento con velocità di stacco; molti criteri sono a loro volta calcolati con il tempo di volo, anche dalle pedane.

**Non verificato**: il comunicato dell'Università Keio (sovrastima del volo fino a ~10 cm; sito non raggiungibile da questo ambiente) e un altro studio che riporterebbe volo − velocità di stacco ≈ 2,5 cm (visto solo in un riassunto di ricerca). **Correzione**: in una versione precedente di questo documento e nella risposta in chat avevo attribuito a PMC10656545 l'affermazione che una versione del volo corretta con il movimento dell'anca non differisse dall'impulso-quantità di moto; quell'articolo è la meta-analisi su My Jump e non dice questo. L'affermazione veniva da un riassunto di ricerca di cui non ho identificato la fonte e **non la uso**. Non ho trovato una validazione OpenCap del CMJ.

**Prior scelta**: Δ = 3,5 ± 4 cm, tra i ~2,2 cm ricavati dai dati delle pedane e i ~5 cm del secondo studio, con dispersione che include sovrastime fino a ~10 cm.

### Limiti (invariati e nuovi)
- **Nessuna verità da pedana**: il modello è validato con simulazione e coerenza fisica, non con misure di riferimento. L'errore assoluto sui video reali resta non dimostrato.
- **Δ è misurato in un solo modo** (traiettoria) più la prior: la seconda misura «statica» della 4.7.0–4.7.1 è stata tolta perché non indipendente e con bias di segno diverso a seconda del riferimento (vedi sopra). Un ritardo comune degli istanti (+5,4 cm di Δ̂ ogni +10 ms) resta invisibile al modello.
- La prior (3,5 ± 4 cm) e le incertezze di ingresso sono stime; con atterraggi molto più flessi della prior la stima ha un bias positivo di 1–2 cm.
- I partecipanti dello studio con pedane sono 12, a mani sui fianchi, con salti di ~28 cm: non rappresentano atleti con oscillazione delle braccia.
- L'istante di stacco domina l'errore (±1,4 cm per 5 ms) e la sua definizione (pixel contro soglia di forza) può differire di alcuni ms in modo sistematico.
- Per verificare: una pedana, o un accelerometro sincronizzato (vedi sopra).

## Prova con gli AirPods Pro 2 come accelerometro (v4.7.1)

**Dati**: Sensor Logger, una registrazione continua di 43,6 s con 4 CMJ a mani sui fianchi di un atleta di 181 cm e 76 kg (2 frontali, 2 laterali; battiti di tallone prima del secondo e del quarto), ritagliati in 4 clip a 240/120 fps. Colonne: accelerazione utente (in **g**), gravità, rotazione, quaternioni.
- **Frequenza reale: 50 Hz esatti** (20 ms tra i campioni, due soli buchi di ~145 ms) anche chiedendone 100: risoluzione ±6 ms per evento.
- **Il segnale è pulito**: in volo la forza specifica scende a 0,0–0,2 g per 0,45–0,52 s e finisce con un picco d'impatto; l'accelerazione verticale in volo vale −1,005 / −1,020 / −1,017 / −0,994 g (entro il 2 % della caduta libera) e la velocità integrata ha pendenza −9,98 / −10,06 / −10,42 / −9,70 m/s² (±6 % su −9,81). I colpi di tallone compaiono come picchi di 2,2–3,7 g (3 prima del salto 2, 2 prima del salto 4).

**Risultato principale (negativo): la testa a 50 Hz non è un riferimento per il tempo di volo né per l'altezza.**
| Salto | Volo dai pixel | Volo dagli AirPods (|f| < 0,5 g) | Differenza |
|---|---|---|---|
| 1 frontale | 530 ms | 451 ms | −79 |
| 2 laterale | 573 ms | 505 ms | −68 |
| 3 laterale | 566 ms | 517 ms | −49 |
| 4 frontale | 568 ms | 462 ms | −106 |
Media −76 ± 23 ms ⇒ altezza sottostimata del ~24 % (−6…−13 cm). **Causa**: la finestra di caduta libera della testa inizia 54 ± 18 ms **dopo** lo stacco visto dal video (assumendo l'impatto come sincronismo): nei primi istanti di volo la testa subisce ancora forze interne del busto (decelerazione fino a −1,6 g) prima di entrare in vera caduta libera.
- **Velocità di stacco per integrazione**: picco di 3,5–3,8 m/s (altezza 63–74 cm) contro ~2,7 m/s del baricentro: la testa si muove più del baricentro nel finale della spinta (il busto si raddrizza). Non usabile.
- **Coerenza degli istanti**: il picco di velocità della testa cade 56 ± 4 ms prima dello stacco dal video (dispersione di 4 ms sui 4 salti), fisiologicamente plausibile; è un controllo di coerenza, non una validazione (il ritardo dell'impatto verso la testa non è misurato).
- **Cosa resta utile**: l'impatto all'atterraggio come marcatore (±20 ms), i colpi di tallone per sincronizzare, il fatto che gli istanti dai pixel siano coerenti con il sensore. Per un riferimento indipendente serve un sensore sul **bacino o sul tronco a ≥ 100 Hz** (non provato).

**Gli stessi 4 salti con l'app** (statura 181 cm, massa 76 kg, tutti i fotogrammi; Heavy+specchio / Full; altezze in cm; codice 4.7.2, senza misura statica):
| Salto | T dai pixel (ms) | Volo | Parabola | **Integrata** | Δ traiettoria | curvatura/g (scala) |
|---|---|---|---|---|---|---|
| 1 frontale | 529 / 532 | 34,3 / 34,7 | 34,1 / 34,5 | **33,4 / 33,5** | 0,4 / 0,3 | 0,97 / 1,00 |
| 2 laterale | 575 / 571 | 40,5 / 39,9 | 39,3 / 38,5 | **39,1 / 38,3** | 2,4 / 2,9 | 1,16 / 1,17 |
| 3 laterale | — / 566 | — / 39,2 | — / 38,7 | **— / 37,9** | — / 1,0 | — / 1,08 |
| 4 frontale | 566 / 570 | 39,2 / 39,8 | 39,8 / 40,5 | **38,8 / 38,7** | −1,1 / −1,4 | 0,95 / 1,00 |
- **Con atterraggi rigidi i tre metodi concordano entro ~1 cm** (volo − parabola −0,7…+1,4 cm): dove Δ è davvero piccolo, volo, parabola e integrata coincidono; sul primo atleta (atterraggio flesso) il volo era 3–7 cm sopra la parabola. La stima integrata è 0,4–1,6 cm **sotto** il volo perché la prior (Δ = 3,5 cm) trascina Δ\* a 0,8–3,2 cm: è il costo dichiarato della prior con atterraggi rigidi (≈ −Δ/2), non un errore nascosto.
- **Scala dell'app verificata con altezza e massa note** (curvatura/g della parabola, atteso 1,00): 0,95 – 1,17 su 8 analisi (media 1,05, dev. st. 8 %), in linea con l'8 % assunto come incertezza di scala (atleti 1–2: 0,96–1,13). Il valore 1,16–1,17 del salto 2 (laterale) è il più lontano: la prospettiva non è corretta.
- **Eventi dai pixel**: Heavy e Full danno lo stesso T entro 3–4 ms (salto 1: 529/532; 2: 575/571; 4: 566/570). I **landmark** sovrastimano il volo di +37…+110 ms sulle 7 analisi con entrambi gli eventi (stacco in anticipo di 44–72 ms e/o atterraggio in ritardo di 3–64 ms): i pixel sono indispensabili, come già visto sui primi due atleti.
- **Salto 3 con Heavy**: il tracciamento dei pixel non trovava l'atterraggio e l'app ripiegava sui landmark (volo 650 ms, 51,8 cm); la validazione lo segnalava «incoerente» (Δ dalla traiettoria 27 cm). **Correzione 4.7.2**: se i pixel non trovano uno degli istanti con i landmark raffinati, l'app riprova con i landmark di base (prima del raffinamento) prima di ripiegare; vedi sotto l'esito nell'app.
- **Passo di campionamento**: a passo 2 (12,5 ms) il tracciamento dei pixel perdeva eventi (salto 1 con Full, salto 3 con Heavy); a tutti i fotogrammi (4,2 ms) solo il salto 3 con Heavy. Limite noto: sotto i ~10,5 ms l'app ripete la misura per valutarne la stabilità.

## v4.7.2 — prova dell'app intera sui quattro video grezzi (correzioni trovate)

Fino a qui i quattro CMJ del terzo atleta erano stati analizzati con script esterni su finestre già ritagliate attorno al salto. Questa è la prima prova **dell'app vera, sul video intero**, un file alla volta (Chromium senza GPU; il Chromium del sandbox non decodifica l'HEVC, quindi i .mov sono stati ricodificati in H.264 conservando i tempi dei fotogrammi; statura 181 cm, massa 76 kg). Ha trovato tre difetti che le prove sulle finestre non potevano vedere.

**1. Un errore mio (4.7.2 iniziale) disattivava i pixel.** Il ripiego sui landmark di base, scritto per recuperare il salto 3, andava in errore (`TypeError`) quando la misura ripetuta non esisteva (passo > 10,5 ms) o ne aveva solo uno dei due eventi: l'app saltava **tutto** il passo dei pixel e ricadeva sui landmark (volo 664 ms, 54 cm, contro 569 ms, 39,6 cm). Corretto con una funzione pura (`mergeFlowFallback`) e tre test che coprono proprio quei casi.

**2. Falsi voli.** I video iniziano con l'atleta fermo per ~1 s e, in due, con i colpi di tallone: il rilevatore di voli (che si basa solo sull'altezza dei piedi) ha trovato **6 voli che non sono salti** accanto ai 4 veri: persona ferma (0,62 s, bacino fermo: curvatura 0,01·g), un volo a fine clip (0,40 s), un volo di 1,42 s / 247 cm, colpi di tallone/saltelli (0,14, 0,33 e 0,37 s). In una prima prova con la GPU un falso volo di 0,89 s (96 cm) era stato dato «affidabilità alta» (landmark diversi da quelli della CPU: gli esiti dipendono dal modello e dal delegato). Ora `flagImplausible` (in `validate.js`) segna come «probabile falso rilevamento», con il motivo, un volo che soddisfa uno di questi criteri: bacino che non segue la caduta libera (curvatura fuori da 0,5–2 g o parabola non adattabile) con misura debole; parabola non adattabile con altezza dei piedi incoerente; affidabilità < 30 %; nei test a salto singolo (CMJ, SJ) volo < 60 % di quello principale senza evidenza piena. **Si esclude in automatico solo se esiste un altro volo plausibile**, mai se è l'unico, mai se l'utente l'ha incluso a mano o ne ha corretto gli istanti; i voli restano visibili e si includono con un tocco. Sui 4 video: 10 voli rilevati, 4 veri tenuti, 6 falsi esclusi (0 veri persi). **Limite dichiarato**: soglie e criteri sono stati messi a punto su questi 4 video di un solo atleta; con altri atleti e riprese possono sbagliare in entrambi i sensi (per questo l'esclusione è reversibile e motivata).

**3. Campionamento dei pixel.** Con 240 fps la finestra principale viene campionata 1 fotogramma su 2–3 (12,5 ms): un singolo tracciamento a quel passo sul salto 1 dava 544 ms contro 529–532 ms a passo nativo (4,2 ms), e provando passi 1–4 su quel video una singola stima oscilla di 527–547 ms. L'app ora **rilegge dal video tutti i fotogrammi nativi attorno al volo** (≈ 1,1 s, ritagliati come la finestra, senza ripetere la posa: i landmark servono solo come punto di partenza della zona da seguire, interpolati nel tempo) e `flowEventsRobust` ripete la misura su 6 sottocampionamenti prendendo la mediana. Vale solo con il decodificatore WebCodecs e finestre campionate più rade del video (240 fps); per i video a 120 fps o con il ripiego `<video>` non cambia nulla. Effetto sui 4 salti rispetto al passo rado dell'app: T cambia di 0–3,5 ms (nessun bias evidente); l'incertezza dichiarata sull'integrata sale di 0,2–0,5 cm in tre salti su quattro (±1,8–2,2 contro ±1,6–2,2 cm) e scende nel quarto, perché ora la ripetibilità (intervallo tra sottocampionamenti, 4–14 ms) è **misurata** invece che assente: è un'informazione in più, non una perdita di precisione.

**Risultati dell'app sui 4 salti** (altezze in cm; incertezza 1σ; confronto con la tabella sopra, ottenuta con script esterni a passo 4,2 ms con landmark Heavy+specchio / Full):
| Salto | T app (ms) | Volo | Parabola | **Integrata** | Δ traiettoria | T script hf / fb (ms) |
|---|---|---|---|---|---|---|
| 1 frontale | 540,3 | 35,8 | 34,1 | **34,1 ± 2,2** | 3,5 | 529 / 532 |
| 2 laterale | 564,3 | 39,0 | 38,6 | **38,1 ± 1,8** | 0,9 | 575 / 571 |
| 3 laterale | 568,7 | 39,7 | 38,5 | **38,3 ± 1,9** | 2,3 | — / 566 |
| 4 frontale | 569,6 | 39,8 | 40,2 | **39,3 ± 1,8** | −0,8 | 566 / 570 |
Le due catene (app e script, che differiscono per ritaglio, ricampionamento, compressione JPEG, landmark di partenza) danno tempi di volo che **differiscono di +11, −8, +3, +2 ms (scarto quadratico medio 7 ms)** sugli stessi quattro salti. Non è un bias: è la **ripetibilità del metodo dei pixel rispetto a scelte di preelaborazione** e coincide con l'incertezza che l'app dichiara sul tempo di volo (≈ 9 ms, cioè ±1,2 cm sull'altezza da volo). Quale delle due sia più vicina al vero **non è noto**: senza pedana la verità non c'è, e un controllo a occhio sui fotogrammi dell'atterraggio del salto 1 (a passo di 4–8 ms, VFR) non ha permesso di decidere.
Da questi 4 salti (rigidi, Δ ≈ 0–3 cm) volo, parabola e integrata concordano entro ~2 cm; l'integrata è 0,3–1,7 cm sotto il volo per effetto della prior (vedi sopra).

**Resta non provato**: l'errore assoluto (nessuna pedana), le soglie dei falsi voli su altri atleti, il comportamento su iPhone (qui solo Chromium su CPU con video ricodificato; gli istanti reali dei file originali HEVC passano dallo stesso decodificatore WebCodecs in Safari ma non l'ho potuto provare).

## v4.8 — istanti dai pixel robusti alla finestra, fonti nuove, risultati più leggibili

Richiesta: rendere i modelli il più precisi possibile, cercare fonti, migliorare grafica e dati mostrati. Ordine seguito: prima **misurare dove sta l'errore**, poi intervenire solo dove i dati lo giustificano.

### 1. Dove sta l'errore (misurato sui 4 salti reali, 8 analisi)
Componenti dell'incertezza sul tempo del culmine (ms): rumore dell'adattamento **0,2–0,4**, scelta della finestra **0,3–1,2**, scarto tra i modi di stimare il baricentro **0,1–1,4**; l'incertezza dichiarata (3,0–3,5 ms) è dominata dal minimo fisso di 3 ms. Quindi **il rumore del baricentro non è il fattore limitante** e un tracciamento del busto dai pixel (che stavo valutando di costruire) non servirebbe: l'incertezza di Δ (2–3 cm) viene dagli istanti di stacco e atterraggio, che entrano con peso g·T/2. L'errore da ridurre è quello degli istanti.

### 2. Difetto trovato: gli istanti dai pixel dipendevano da dove cadeva la finestra
Il video 4 (frontale) in app dava 540 ms contro 527–532 ms nelle prove con script esterni sullo stesso salto: +12 ms (≈ 2 cm). Causa: i landmark davano l'atterraggio a 2,306 s (100 ms oltre il vero ≈ 2,20 s) e la finestra del tracciamento partiva da 150 ms prima di quella stima: restava solo ~45 ms di discesa prima del contatto, un piede su due non superava i controlli e l'atterraggio veniva dall'altro piede. Provando su 4 salti × 2 insiemi di landmark, **spostando di 0,10–0,20 s l'inizio della finestra l'adattamento globale dava voli diversi di 25–80 ms (4–14 cm)**, anche con tutti i controlli superati. Le prove precedenti (script con la finestra standard) avevano la stima dei landmark abbastanza vicina e non lo mostravano.
Correzioni (`footflow.js`):
- **Raffinamento locale** dell'evento: dopo l'adattamento globale si ripete l'adattamento in un intorno (0,08 s dal lato suolo, 0,12 s dal lato rampa, almeno 5–7 campioni anche a passo lungo), fino a convergenza. Spostando l'inizio della finestra il volo varia di 5–25 ms invece di 25–80.
- **Mediana su 18 stime** (3 finestre × passo nativo / 1 su 2 / 1 su 3): l'intervallo tra 10° e 90° percentile è la ripetibilità. Con passo > 10,5 ms si varia solo la finestra (3 stime). Le stime si eseguono una alla volta cedendo il controllo all'interfaccia.
- Tolleranza tra pixel e landmark portata da 120 a 160 ms (landmark osservati in ritardo fino a +110 ms; non validato oltre).

Effetto (tempo di volo in ms; script esterni a passo 4,2 ms con landmark Heavy+specchio / Full e app sul video intero):
| Salto | script hf / fb | |hf−fb| | app 4.7.2 | **app 4.8** | app − script |
|---|---|---|---|---|---|
| 1 frontale | 525,6 / 524,8 | 0,8 | 540,3 | **528,5** | +3,3 |
| 2 laterale | 569,8 / 568,8 | 1,0 | 564,3 | **567,6** | −1,7 |
| 3 laterale | 569,1 / 565,9 | 3,2 | 568,7 | **566,4** | −1,1 |
| 4 frontale | 561,7 / 562,6 | 0,9 | 569,6 | **565,2** | +3,0 |
- Scarto tra app e script: **da 7 ms (rms) a 2,5 ms**; tra i due insiemi di landmark da 2,9–4,3 ms a 0,8–3,2 ms; il salto 3 con Heavy, prima senza atterraggio dai pixel, ora è trovato. Falsi voli (persona ferma, colpi di tallone): i pixel non trovano eventi, come deve.
- **Verità nota (simulazione)**: nessun bias introdotto (errore 0,1–0,2 ms a 60–240 fps); con landmark sbagliati di −80…+130 ms gli istanti sono trovati con errore ≤ 0,4 ms a 120 e 240 fps (nuovo test).
- **Non è noto quale valore sia il più vicino al vero** (nessuna pedana): la versione 4.8 è più riproducibile, non dimostrata più accurata. Rispetto alla 4.7.2 le altezze integrate in app cambiano di −0,1…−0,9 cm (34,1→33,2; 38,1→38,0; 38,3→37,9; 39,3→38,8), perché il volo misurato è più breve nei salti 1, 3 e 4 (4.8: 528,5 / 567,6 / 566,4 / 565,2 ms contro 540,3 / 564,3 / 568,7 / 569,6).
Risultati dell'app (4.8) sui 4 salti: volo 34,2 / 39,5 / 39,3 / 39,2 cm; parabola 33,6 / 38,1 / 38,1 / 39,7; **integrata 33,2 ± 1,9 / 38,0 ± 1,7 / 37,9 ± 1,5 / 38,8 ± 1,8 cm**; Δ dalla traiettoria 1,3 / 2,8 / 2,5 / −1,1 cm.

### 3. Fonti nuove (testi completi letti via l'API BioC di NCBI, salvo dove indicato)
- **Xu et al., revisione sistematica (Sports Med 2023, PMC10115716)**: distingue l'altezza **dal punto di stacco** (tempo di volo e impulso-quantità di moto, JH-2) da quella **dalla posizione in piedi** (doppia integrazione, spostamento del baricentro, JH-1): la seconda è più alta perché al decollo il baricentro è già più in alto (flessione plantare). È la distinzione già presente nell'app (altezza balistica contro spostamento dal punto iniziale). Il tempo di volo sovrastima perché si atterra con il baricentro più basso (gambe flesse): differenze volo − impulso riportate: Moir 3–4 % (uomini 0,36 contro 0,35 m, donne 0,22 contro 0,21 m), Reeve e Tyler **+2,42 ± 0,31 cm**, Aragón 0,402 contro 0,361 m (**+4,1 cm**). Con Aleksic (+1,1 cm) le cinque differenze danno **Δ = 2 × differenza = 2,0 / 2,0 / 2,2 / 4,8 / 8,2 cm** (media 3,8, mediana 2,2, dev. st. 2,7 tra studi): **la prior Δ = 3,5 ± 4 cm resta coerente** e non è stata modificata (valori dei primi tre studi di seconda mano, dal testo della revisione).
- **Aderinola et al. (smartphone singolo, OpenPose a 30 fps, PMC10249733)**: altezza da spostamento del metatarso, scala dalla caduta libera (la stessa idea del nostro controllo curvatura/g); limiti di accordo contro le pedane **−6,7…+3,1 cm**, e i tempi di volo e di contatto «da scarsi a moderati» a 30 fps. Nessun confronto diretto con i nostri 240 fps e istanti dai pixel.
- **Solo riassunti (non letti nel testo)**: Wade et al. 2020 (miglioramento del volo con una costante di sollevamento del tallone scalata sull'antropometria, per l'altezza dalla posizione in piedi: non implementato), Eythorsdottir et al. 2024 (le quattro equazioni delle pedane possono differire di ~15 cm sullo stesso salto: coerente con il mostrare due definizioni).

### 4. Interfaccia e dati mostrati
- **Metriche in sezioni** (altezza e velocità, fasi, forza e potenza, reattività) e **dettagli tecnici richiudibili** (Δ, baricentro usato, risoluzione, errore per origine, fonte degli istanti).
- **Grafico dell'accordo tra i metodi** (barre ±1σ su un asse comune) nei risultati e nelle schede dello storico.
- **Velocità verticale con le fasi** (discesa, spinta, volo) e la caduta libera attesa tratteggiata: controllo visivo che in volo la pendenza sia −g (sul sintetico lo scarto a un quarto del volo è < 0,3 m/s). **Limite dichiarato**: attorno allo stacco la curva dei landmark supera la velocità del baricentro (sui 4 salti reali il picco è ~1 m/s sopra il valore balistico, come la testa degli AirPods), quindi non è una curva di forza né dà la velocità di stacco: questa è il punto verde, ricavato dal volo.
- **Storico**: grafico con griglia, media, barre di incertezza e incertezza accanto a ogni valore; **report condivisibile** (immagine con risultato ± incertezza, accordo tra i metodi, tabella dei salti e avvertenza che non c'è confronto con pedana).
- Test: 194 controlli, nessun KO (nuovi: finestra/landmark sbagliati, fusione degli eventi, curva del baricentro, grafici).


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

### Nuovo: altezza da velocità di stacco (apice del baricentro)
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


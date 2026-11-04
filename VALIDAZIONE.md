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
| Tuo salto a 60 fps (IMG_0181) | stacco 2,6406 s, atterraggio 3,1740 s → volo **0,5333 s = 32 fotogrammi: identico a TrackJump** (34,9 cm) |
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

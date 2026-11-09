# Jump Lab 4.0

Web app (PWA, nessun server, nessuna build) che misura **altezza del salto, tempo di volo, contatto al suolo e RSI**
da un video, con tracciamento del corpo che gira sul dispositivo. Pensata per iPhone/Safari, funziona anche su
Chrome/Edge desktop e Android.

Test supportati: **CMJ**, CMJ con braccia, **Squat jump**, **Drop jump** (contatto, RSI, altezza pedana stimata),
**Rimbalzi** (RSI per ogni salto + medie), salto libero. Gamba sinistra/destra come etichetta.

## Avvio

Serve un server HTTP qualsiasi (la fotocamera e il service worker richiedono HTTPS o `localhost`):

```bash
python -m http.server 8080
```

poi apri `http://localhost:8080`. **Non c'è nessun `npm install` né build**: libreria MediaPipe (WASM) e modelli
(`lite`, `full`, `heavy`) sono già nelle cartelle `vendor/` e `models/`. Questo elimina il problema della v3
(download dei modelli in fase di build che non andava a buon fine).

**Pubblicazione:** carica l'intera cartella su GitHub Pages (c'è già `.github/workflows/pages.yml`), Netlify,
Cloudflare Pages o Vercel come sito statico. Apri l'URL HTTPS su iPhone con Safari → Condividi → *Aggiungi a Home*.

## Cosa è cambiato rispetto alla v3

| Area | v3 | v4 |
|---|---|---|
| Lettura video | `<video>` + seek a ~12 campioni/s, frame stimati da `fps` | **WebCodecs + demux MP4/MOV**: ogni fotogramma con il suo timestamp reale di acquisizione (240 fps = passo 1/240 s), niente seek |
| Analisi | scansione a 12 fps + bisezione | **2 passate**: scansione a ~30 fps per trovare i salti, poi **tutti i fotogrammi nativi** attorno al salto sul **ritaglio stretto dell'atleta** |
| Stacco/atterraggio | soglia fissa sull'altezza dei piedi (errore sistematico per difetto) | **fit a cerniera sub-frame** sul segnale "punto più basso dei piedi" (talloni + punte), nessun bias di soglia |
| Livello del suolo | percentile globale del video (fallisce con pedana/rimbalzi) | picchi prominenti con suolo locale: funziona per **drop jump** e serie di rimbalzi |
| Controlli | solo euristiche | **coerenza fisica**: la traiettoria del bacino in volo deve avere curvatura g → rileva automaticamente **video rallentati non calibrati** (suggerisce 2×/4×/8×) e contatti sbagliati |
| Tempo reale | stima da edit list/fps | timestamp di acquisizione + override manuale (rallentato N× / fps fissi) |
| Metriche | solo altezza | altezza, volo, **contatto (GCT), RSI, RSI-flight, RSI mod, profondità del dip**, velocità di stacco, altezza pedana, forza/potenza stimate (con peso), qualità per salto |
| Revisione | `<video>` con ±1 frame dipendente dal decoder | **lettore proprio sui fotogrammi analizzati**: ±1 frame esatto, scheletro, riproduzione 0.1×/0.25×, grafico con cursori trascinabili |
| UI | pagina unica | home per test, analisi con anteprima live, revisione, storico con grafico e CSV, atleti, backup |

## Come funziona la misura

1. **Decodifica** (`js/engine/video.js`): mp4box estrae i campioni, `VideoDecoder` li decodifica; rotazione (iPhone
   verticale) applicata al disegno. Ripiego su `<video>` per WebM/codec non supportati.
2. **Posa** (`js/engine/pose.js`): MediaPipe Pose Landmarker (BlazePose, 33 punti inclusi **talloni e punte**), GPU con
   ripiego su CPU (su iPhone parte in CPU per affidabilità). Modello selezionabile Lite/Full/Heavy.
3. **Segnale piedi**: punto più basso tra talloni e punte di entrambi i piedi (= ultimo appoggio / primo contatto,
   come fa TrackJump con le punte), filtro mediano + regressione locale.
4. **Voli** (`js/engine/jumps.js`): picchi prominenti del segnale; stacco e atterraggio con fit "piatto → rampa"
   a risoluzione sub-frame; altezza `h = g·T²/8`.
5. **Contatto/RSI**: tra atterraggio precedente (o caduta dalla pedana) e stacco; `RSI = h / GCT`.
6. **Qualità**: copertura dei piedi, coerenza balistica del bacino, quota dei piedi vs tempo di volo, risoluzione ±1 frame.

## Novità v4.2 (affidabilità di stacco e atterraggio)

- Fit a due rette con suolo inclinato per stacco e atterraggio: robusto a deriva, passi e assestamento dopo il contatto.
- Rifinitura con Heavy + immagine specchiata solo attorno ai due istanti (impostazione «Rifinitura stacco/atterraggio»).
- Incertezza (1σ) mostrata accanto all'altezza; avviso quando l'atterraggio è nettamente più flesso dello stacco.
- Ripiego sul bacino quando i piedi non sono rilevati per brevi tratti.
- Dettagli, misure e limiti in `VALIDAZIONE.md`.

## Novità v4.10 (risultati comprensibili da chiunque)

- **Il risultato si legge in parole**: altezza, intervallo in cui sta con buona probabilità il valore vero, perché la misura è affidabile o no, e confronto con le volte precedenti dello stesso test, con l'indicazione se la differenza è reale o entro l'errore di misura.
- **«Cosa dice il salto»**: solo i valori utili per quel tipo di test (tempo in aria, velocità di stacco, piegamento, durata della spinta, esplosività; per drop jump e rimbalzi tempo a terra e reattività), ognuno con una frase che spiega cosa significa.
- **Tolti i valori che non servono o sono poco affidabili**: velocità media e potenza di Samozino, potenza di picco di Sayers (equazione dello squat jump), doppioni e misure ritirate (restano nell'esportazione CSV). Tutto il resto (metodi di controllo, grafici, incertezze, forza media) è in «Dati per esperti», chiuso di default.
- Sul telefono il risultato viene prima del video; avvisi in evidenza, note informative tra i dati per esperti; serie spiegata a parole; storico e report con gli stessi criteri.

## Novità v4.9 (robustezza verificata su video reali degradati)

- **Prova su 26 varianti dei video reali** (buio, rumore, sfocatura, compressione, bassa risoluzione, atleta lontano, inclinazione, 120/60/50/30/25 fps). Da 50 fps in su la stima integrata resta entro −0,3…+1,6 cm dal video pulito, salvo inclinazione 8° in frontale (+3,5 cm). Sotto ~50 fps la misura non è affidabile (fino a +29 cm) e **ora l'app lo dice**: affidabilità bassa, incertezza ampia, verdetto non più «coerenti».
- **Poca luce**: filtro 3×3 prima del tracciamento dei piedi. Con buio + rumore lo scarto passa da 12–18 ms a ≤ 2,3 ms; sul video pulito il volo cambia di ≤ 0,7 ms.
- **Errori sicuri di sé corretti**: istanti dai landmark o misti non danno più affidabilità alta; avviso se l'atleta è troppo piccolo in pixel; i salti veri a basso frame rate non vengono più etichettati come falsi voli.
- Velocità media e potenza di Samozino ora sono **marcate come di validità scarsa**: lo studio PMC9884043 le trova poco valide rispetto alle pedane, a differenza della forza media.
- Dettagli in `VALIDAZIONE.md` (v4.9). Il riferimento della prova è il video pulito, non una pedana.

## Novità v4.8 (istanti più ripetibili, risultati più leggibili)

- **Istanti di stacco e atterraggio dai pixel robusti alla finestra di tracciamento**: prima il volo poteva cambiare di 25–80 ms (4–14 cm) spostando l'inizio della finestra, e nell'app un salto dava +12 ms rispetto allo stesso salto in uno script esterno. Ora raffinamento locale + mediana su 18 stime: scarto app–script da 7 a 2,5 ms (rms), nessun bias sul sintetico. **Non è dimostrato che sia più accurato di una pedana** (nessuna pedana): è più riproducibile.
- **Risultati**: metriche in sezioni con dettagli tecnici richiudibili; grafico dell'accordo tra i metodi; velocità verticale con le fasi e controllo della caduta libera; nello storico grafico con incertezza e **report condivisibile (immagine)**.
- Fonti nuove lette (revisione di Xu et al. 2023, Aderinola et al.): la prior di Δ resta coerente con cinque studi. Dettagli e limiti in `VALIDAZIONE.md` (v4.8).

## Novità v4.7.2 (correzione e atterraggio dai pixel)

- **Tolta la misura «statica» di Δ** (introdotta in 4.7.0): sui video reali non era indipendente dalla traiettoria e il suo errore dipendeva dal riferimento scelto (−7…+2 cm, fino a valori fisicamente impossibili). Il «risultato scomodo» riportato in 4.7.0 (due misure di Δ che divergono) era un difetto di quella misura, non dei dati: correzione completa in `VALIDAZIONE.md`. Ora Δ = traiettoria del baricentro + prior di popolazione; sui 4 salti del terzo atleta e sulla simulazione i numeri cambiano di meno di 1,5 cm.
- **Istanti dai pixel più robusti**: con 240 fps l'app rilegge dal video i fotogrammi nativi attorno al volo (prima: 1 su 2–3) e ripete la misura prendendo la mediana; se con i landmark raffinati manca un istante riprova con quelli di base prima di ripiegare sui landmark (che sovrastimano il volo di 37–110 ms nei salti verificati). Corretto anche un errore che, in quel ripiego, disattivava tutto il passo dei pixel.
- **Falsi voli** (persona ferma, colpi di tallone, saltelli, passi): segnalati con il motivo ed esclusi in automatico dalla serie solo se c'è almeno un altro volo plausibile; si includono con un tocco. Sui 4 video di prova: 4 salti veri tenuti, 6 falsi esclusi; soglie tarate su un solo atleta.
- Verifica della scala con statura e massa note (atleta di 181 cm / 76 kg): curvatura/g 0,95–1,17 (media 1,05, dev. st. 8 %), in linea con l'8 % di incertezza assunta. **Nessuna verità da pedana.**

## Novità v4.7.1 (storico completo)

- **Lo storico mostra tutti i valori dei risultati**, non solo altezza e volo: per ogni salto una scheda con altezze (integrata, tempo di volo, parabola, spostamento, balistica), tempi, RSI, dip, velocità di stacco, forza e potenza, baricentro all'atterraggio, validazione dei metodi con livelli e avvisi, fonte degli istanti. Le sessioni salvate con versioni precedenti mostrano i dati che hanno.
- Salvate anche statura, massa e tutti i valori di validazione.

## Novità v4.7 (modello integrato)

- **Stima integrata dell'altezza** (equivalente all'impulso-quantità di moto delle pedane): corregge il tempo di volo con il baricentro più basso all'atterraggio, misurato dalla traiettoria più una prior dalla letteratura, pesati per precisione (non è una media). Simulazione con verità nota: errore 0,4–1,1 cm dove il solo volo sovrastima di 2–6 cm. (La versione 4.7.0 aggiungeva una seconda misura «statica» di Δ: tolta in 4.7.2, vedi sopra.)
- Altezza principale = stima integrata, con il tempo di volo sempre accanto (commutabile). RSI, Samozino e velocità media la seguono.
- Contromovimento e spinta dal baricentro a corpo intero invece che dal bacino.
- Incertezza propagata con il modello fisico; calibrata con Monte Carlo (copertura a 2σ 95 %).
- Audit dei tre metodi e dei parametri con numeri e limiti in `VALIDAZIONE.md` (sezione v4.7). **Nessuna verità da pedana.**

## Novità v4.6 (controllo dell'altezza da velocità di stacco)

- **Baricentro a corpo intero** (tronco + braccia + gambe, de Leva) al posto del solo bacino: con braccia che oscillano il bacino sovrastimava il culmine di 2–4 cm (dimostrato in simulazione, osservato nei video frontali).
- **Incertezza misurata**, non fissa: rumore dell'adattamento, finestra, scarto tra tre baricentri (corpo intero/tronco/bacino) e istante di stacco. Calibrata con Monte Carlo (copertura 95 % a 2σ).
- **Velocità di stacco dal culmine** (m/s) accanto a quella dal tempo di volo, baricentro usato e scarto tra i metodi nei risultati e nel CSV.
- Ripiego automatico su tronco/bacino se gli arti non sono osservabili o sotto ~33 fps.
- **Validazione ibrida dei tre metodi** (tempo di volo · baricentro nello spazio · parabola del baricentro): si confrontano con tolleranze fisiche, mai mediati; ciascuno ha un livello di affidabilità motivato, le incoerenze vengono segnalate e si indica quale usare. Gli istanti si correggono a mano fotogramma per fotogramma e tutto si ricalcola.
- **Altezza balistica** (sopra lo stacco) distinta dallo **spostamento rispetto alla posizione iniziale** (in piedi).
- Anomalie di serie (salto lontano dalla mediana). Limiti misurati con errori iniettati in `VALIDAZIONE.md`.
- Misure, risultati negativi e limiti in `VALIDAZIONE.md` (sezione v4.6). Nessuna verità da pedana: la stima resta un controllo.

## Novità v4.5 (controlli incrociati e seconda stima dell'altezza)

- **Altezza da velocità di stacco** (apice del baricentro; v4.6: corpo intero) accanto a quella da tempo di volo: non dipende dall'atterraggio più flesso. È un controllo, non un sostituto: mostrata con la sua incertezza, inclusa nel CSV.
- Finestra di tracciamento del piede più ampia: stacco laterale più ripetibile (±16 → ±8 ms nei video di prova).
- Provato e scartato: baricentro a segmenti al posto del bacino (peggiore sui dati reali).
- Cache offline completa; test di regressione per la nuova stima.
- Misure, numeri e limiti in `VALIDAZIONE.md` (sezione v4.5).

## Novità v4.4 (precisione di stacco e atterraggio)

- **Eventi dai pixel del piede**: stacco e primo contatto si misurano seguendo i pixel dell'avampiede (template matching sub-pixel, fit a rampa quadratica), indipendentemente dal modello di postura. Su un video reale a 120 fps i landmark sbagliavano di −87…+46 ms (verifica visiva dei fotogrammi); su scene con verità nota l'errore del nuovo metodo è ≤ 0,7 ms allo stacco e 2–4 ms all'atterraggio.
- Se l'evidenza dei pixel non è affidabile si ricade sui landmark e lo si segnala (confidenza ridotta, controllo manuale consigliato ad alta frequenza).
- **Errore atteso per origine** (frame rate, rilevazione, sistematico) nei risultati; controllo di luce e contrasto sui piedi; analisi completa automatica nei video brevi se la scansione rapida non trova salti.
- A 240 fps si analizza un fotogramma su due (120 effettivi): dimezza il tempo con perdita misurata di 1–2 ms.
- Dettagli, ricerca e limiti in `VALIDAZIONE.md`.

## Novità v4.3

- **Info per ogni test** (tasto «i» su ogni tipo): come registrare, vista frontale o laterale, frame rate, errori da evitare.
- **Qualità della ripresa** nei risultati: inquadratura riconosciuta, fps, piedi visibili, atleta tagliato o piccolo, più persone.
- **Più persone nell'inquadratura**: si segue chi salta, non la persona più grande o più vicina.
- **Salto su una gamba** (Sinistra/Destra): usa solo il piede che salta.
- **Suolo**: segnalata la differenza di livello tra stacco e atterraggio.
- **Formule**: Samozino (forza, velocità, potenza), per kg; FT:CT; serie con variabilità e calo di altezza.

## Come filmare (la parte che conta di più)

- **Slo-mo 240 fps** dell'app Fotocamera iPhone, poi *Importa*. A 30 fps ±1 frame vale ~4 cm; a 240 fps <1 cm.
- Nel selettore foto di Safari tocca **Opzioni → Formato: Attuale** per non far ricodificare il video.
- Telefono **fermo**, ripresa **laterale**, all'altezza del bacino, 2–3 m, tutto il corpo (piedi inclusi) sempre in quadro.
- Fermo 1–2 s, poi salta. Una sola persona nell'inquadratura.
- La registrazione dentro l'app è limitata dal browser (30–60 fps): comoda, ma meno precisa della Slo-mo.

## Test

- `tests/index.html` — **motore su dati sintetici** (atleta con fisica balistica, rumore, buchi, outlier) a 30/60/120/240 fps
  per CMJ, SJ, DJ, rimbalzi, più il rilevamento di video rallentati. Apri con il server avviato.
- `tests/pipeline.html` — **pipeline end-to-end** su video MP4 sintetici (H.264 con B-frame, 240 e 60 fps) con un
  "modello" finto che legge marcatori colorati: verifica demux, WebCodecs, timestamp, ritaglio, finestre.
- `tests/make_video.py` rigenera i video di prova (richiede `numpy` e `imageio-ffmpeg`).

Risultati ottenuti (sintetici): errore medio sul tempo di volo ≈ 2–4 ms a 120/240 fps e 5–10 ms a 30/60 fps;
errore sull'altezza ≈ 1–2% a 240 fps. Vedi `VALIDAZIONE.md` per cosa **non** è stato verificato.

## Struttura

```
index.html  manifest.webmanifest  sw.js
css/app.css
js/main.js            router e avvio analisi
js/store.js           atleti, impostazioni, sessioni (localStorage)
js/engine/            video.js · pose.js · pipeline.js · jumps.js · signal.js
js/ui/                home · analyze · review · history · profile · camera · player · chart · dom
vendor/               MediaPipe tasks-vision 1.2.2 (Apache-2.0) + mp4box 0.5.4 (BSD-3)
models/               pose_landmarker lite/full/heavy (Google, Apache-2.0)
tests/                test e generatore di video sintetici
```

## Privacy

I video non lasciano il dispositivo. Vengono salvati solo le misure (e una miniatura) nel `localStorage`.

## Alternative valutate per il modello

MediaPipe BlazePose è l'unico modello pronto per browser con **talloni e punte dei piedi** (33 punti); RTMPose
(ONNX Runtime Web), MoveNet e YOLO11-pose hanno 17 punti COCO senza piedi (YOLO11 anche con licenza AGPL).
Per i salti i punti del piede sono la parte critica, quindi si resta su BlazePose e si migliora tutto il resto
(frame nativi, ritaglio sull'atleta, fit sub-frame, controlli fisici). Un futuro passo naturale è un
modello dedicato al contatto piede-suolo addestrato su video reali con piattaforma di forza.

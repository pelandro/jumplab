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

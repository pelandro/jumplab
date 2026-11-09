// Schede «Come registrare» per ogni tipo di test e guida generale alla ripresa.
// Fonti: dove la letteratura è chiara è indicato (240 fps, atterraggio a gambe tese); distanza e altezza della camera sono
// buone pratiche, NON protocolli validati: nessuno studio trovato le ha confrontate.

import { h, sheet } from './dom.js';

const svgSide = `<svg viewBox="0 0 320 150" style="width:100%;border-radius:12px;background:#0b0f13" role="img" aria-label="Schema ripresa laterale">
  <rect x="0" y="118" width="320" height="32" fill="#182027"/>
  <circle cx="110" cy="34" r="9" fill="#c6f24e"/><path d="M110 44v34M110 52l-14 14M110 52l14 14M110 78l-10 40M110 78l10 40" stroke="#c6f24e" stroke-width="5" stroke-linecap="round" fill="none"/>
  <rect x="262" y="82" width="22" height="36" rx="4" fill="#33404c"/><circle cx="273" cy="100" r="4" fill="#5ec8ff"/>
  <path d="M262 100H126" stroke="#5ec8ff" stroke-dasharray="4 4"/><text x="170" y="94" fill="#8d9aa8" font-size="10">2,5–3,5 m</text>
  <text x="228" y="136" fill="#8d9aa8" font-size="9">altezza bacino (~1 m)</text>
</svg>`;

const svgTop = `<svg viewBox="0 0 320 130" style="width:100%;border-radius:12px;background:#0b0f13" role="img" aria-label="Vista dall'alto: laterale 90° e frontale">
  <circle cx="110" cy="62" r="11" fill="#c6f24e"/><path d="M110 62l22 0" stroke="#0b0f13" stroke-width="3"/><text x="94" y="92" fill="#8d9aa8" font-size="9">atleta (dall'alto)</text>
  <rect x="262" y="52" width="22" height="20" rx="4" fill="#5ec8ff"/><path d="M262 62H126" stroke="#5ec8ff" stroke-dasharray="4 4"/><text x="196" y="52" fill="#5ec8ff" font-size="10" text-anchor="middle">laterale 90° ✔</text>
  <rect x="99" y="8" width="22" height="20" rx="4" fill="#8d9aa8"/><path d="M110 28V50" stroke="#8d9aa8" stroke-dasharray="4 4"/><text x="128" y="22" fill="#8d9aa8" font-size="10">frontale (ok per l'altezza)</text>
  <text x="196" y="112" fill="#ffd9a0" font-size="10" text-anchor="middle">evita angoli intermedi (45°)</text></svg>`;

const COMMON = [
  ['Telefono', [
    '<b>Fermo</b> su un supporto (treppiede o appoggio stabile), mai in mano: il tremolio sposta i piedi nell\'immagine e peggiora stacco e atterraggio.',
    'All\'<b>altezza del bacino</b> (circa 1 m), dritto, non inclinato. Verticale (portrait) va bene: più pixel sull\'altezza del corpo.',
  ]],
  ['Distanza e inquadratura', [
    'A <b>2,5–3,5 m</b>: l\'atleta deve occupare circa il <b>50–70 %</b> dell\'altezza del fotogramma, con margine sopra (braccia alzate) e sotto i piedi, <b>anche in volo</b>.',
    'Non zoomare e non muovere il telefono durante il salto. Una sola persona nell\'inquadratura.',
  ]],
  ['Frame rate', [
    '<b>Slow-motion 240 fps</b> (o 120): ogni fotogramma vale 4 ms (8 ms). La letteratura valida le app da smartphone a 240 fps. Nei nostri test sugli stessi salti ridotti a 120/60/50 fps il volo cambia di 1–8 ms; a 25–30 fps il tracciamento dei pixel spesso non è possibile e i landmark allungano il volo fino a 120–180 ms (+18–29 cm).',
    'Importa il video dalla libreria con <b>Formato: Attuale</b> (Opzioni nel selettore di Safari) per non ricodificarlo. Se è già rallentato a 30 fps, l\'app lo riconosce e propone la calibrazione (×4, ×8…).',
    '60 fps va bene per l\'altezza (±1 fotogramma ≈ ±3 cm a 35 cm) ma non per contatto e RSI.',
  ]],
  ['Luce e contrasto', [
    'Luce uniforme, senza controluce. <b>Scarpe in contrasto col pavimento</b>: scarpe o calze nere su pavimento nero fanno perdere i piedi al tracciamento.',
    'Pantaloncini o leggings aderenti: ginocchia e caviglie devono vedersi. Sfondo il più semplice possibile.',
  ]],
  ['Atterraggio', [
    'Atterra <b>con le gambe tese, sulle punte</b>, come allo stacco. Se atterri più piegato il tempo di volo si allunga e l\'altezza viene <b>sovrastimata del 2–11 %</b> (circa 2,5 cm in uno studio su 27 persone). L\'app avvisa quando la differenza è netta.',
    'Non serve atterrare nello stesso punto: l\'app segue il livello del pavimento allo stacco e all\'atterraggio. Evita però di atterrare su una superficie più alta o più bassa (tappeto, gradino).',
  ]],
];

const VIEW = ['Frontale o laterale?', [
  '<b>Laterale (90°)</b>: la migliore. Si vedono flessione di ginocchia e anche, profondità del contromovimento, talloni e punte, la pedana nei drop jump, e l\'atleta non si avvicina alla camera.',
  '<b>Frontale</b>: va bene per <b>altezza e tempo di volo</b>. Nei nostri video lo stacco dai pixel è risultato più ripetibile in frontale (≈2 ms, atleta 1) che in laterale (10–16 ms, atleta 2), ma <b>vista e atleta/scarpe non sono separabili</b> con questi dati: da confermare filmando lo stesso atleta nelle due viste. L\'atterraggio ≈1–3 ms in entrambe. Contatto, profondità e flessione sono meno precisi, e se l\'atleta si avvicina alla camera il pavimento "scivola" (l\'app lo compensa, ma con più incertezza).',
  '<b>Obliqua</b>: utilizzabile, ma evitala se puoi.',
]];

const TESTS = {
  cmj: {
    title: 'Come registrare il CMJ', what: 'Salto con contromovimento, mani sui fianchi. Misura altezza da tempo di volo, profondità del contromovimento, tempo al decollo, RSI mod e FT:CT; con la massa anche forza e potenza medie (stima).',
    steps: ['In piedi fermo 1–2 s, <b>mani sui fianchi</b> per tutto il salto.', 'Scendi veloce (ginocchia a circa 90° o dove ti viene naturale) e salta <b>il più in alto possibile</b>, senza pause in basso.', 'Stacca a gambe tese, tieni le gambe tese in volo e atterra sulle punte.', 'Fermo 1 s dopo l\'atterraggio. Fai 3 salti con 30–60 s di recupero.'],
    cam: 'Laterale a 90°, 240 o 120 fps. Frontale accettabile per l\'altezza.',
    avoid: ['Gambe raccolte in volo o atterraggio molto flesso (altezza sovrastimata).', 'Mani che si staccano dai fianchi (usa il CMJ con braccia).'],
  },
  cmj_arms: {
    title: 'Come registrare il CMJ con braccia', what: 'Come il CMJ ma con lo slancio delle braccia: i valori sono più alti e <b>non confrontabili</b> con il CMJ a mani sui fianchi.',
    steps: ['In piedi fermo 1–2 s.', 'Contromovimento con slancio delle braccia e salto massimo.', 'Braccia libere in alto durante il volo e atterraggio a gambe tese.'],
    cam: 'Laterale a 90°: lascia margine sopra la testa per le braccia alzate.',
    avoid: ['Inquadratura che taglia le mani in alto.', 'Confrontare i risultati con quelli del CMJ senza braccia.'],
  },
  sj: {
    title: 'Come registrare lo Squat Jump', what: 'Salto da posizione di squat <b>senza contromovimento</b>. Misura altezza e spinta; l\'app segnala se rileva un contromovimento.',
    steps: ['Scendi in squat con le ginocchia a circa 90° e <b>fermati 2 s</b> (mani sui fianchi).', 'Spingi verso l\'alto <b>senza scendere prima</b>.', 'Gambe tese in volo, atterraggio sulle punte.'],
    cam: 'Laterale a 90°: serve per vedere l\'angolo del ginocchio e la fermata in basso.',
    avoid: ['Un piccolo rimbalzo prima della spinta (squat jump non valido).', 'Meno di 1,5 s di pausa: l\'inerzia della discesa aiuta il salto.'],
  },
  dj: {
    title: 'Come registrare il Drop Jump', what: 'Caduta da una pedana e rimbalzo immediato. Misura altezza, <b>tempo di contatto</b> e RSI (altezza / contatto).',
    steps: ['Pedana di 30–40 cm (inserisci l\'altezza in Home; altrimenti viene stimata dall\'immagine).', '<b>Scendi</b> dalla pedana, non saltare giù, e atterra su entrambi i piedi.', 'Rimbalza <b>subito</b> con il minimo contatto e il massimo di altezza, gambe tese in volo.', 'Fai 3 salti con recupero completo (1–2 min).'],
    cam: 'Laterale a 90° con pedana e pavimento nell\'inquadratura. <b>240 o 120 fps</b>: a 60 fps ±1 fotogramma sul contatto vale ±17 ms, circa l\'8 % di un contatto da 0,2 s.',
    avoid: ['Pedana fuori inquadratura (contatto stimato peggio).', 'RSI convenzionale: confronta atleti diversi con cautela, tende a sovrastimare sotto 1,0 e a sottostimare sopra 1,0 (Healy et al. 2019).'],
  },
  rebound: {
    title: 'Come registrare i Rimbalzi', what: 'Serie di balzi reattivi consecutivi. Per ogni salto altezza, contatto e RSI; poi medie, variabilità e calo di altezza (fatica).',
    steps: ['Mani sui fianchi, 5–10 balzi consecutivi.', 'Contatto breve, flessione di ginocchia minima, gambe quasi tese.', 'Non fermarti tra un balzo e l\'altro.'],
    cam: 'Laterale a 90°, <b>240 o 120 fps</b>. L\'atleta resta nello stesso punto: inquadra con margine laterale.',
    avoid: ['Flettere molto le ginocchia (diventano CMJ ripetuti).', 'Inquadratura troppo stretta: l\'atleta si sposta nella serie.'],
  },
  free: {
    title: 'Come registrare un salto libero', what: 'Qualsiasi salto singolo: l\'app rileva il volo e misura altezza e tempo. Nessuna metrica di fase.',
    steps: ['Fermo 1–2 s all\'inizio.', 'Salta come preferisci.', 'Fermo 1 s dopo l\'atterraggio.'],
    cam: 'Laterale a 90° se possibile. Con spostamenti ampi lascia margine laterale.',
    avoid: ['Atterrare su un piano diverso dallo stacco.'],
  },
};

const li = (items) => h('ul', { class: 'tips' }, ...items.map((t) => h('li', { html: t })));
const block = (title, items) => h('div', { style: { marginTop: '14px' } }, h('div', { class: 'small muted', style: { fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: '4px' } }, title), li(items));

const SLOMO = {
  title: 'Registrare a 120/240 fps',
  what: 'Più fotogrammi veri = tempi di stacco e atterraggio più precisi. Con 240 fps un fotogramma vale 4 ms; con 60 fps 17 ms. <b>Un fotogramma generato al computer non aggiunge informazione</b> (l\'abbiamo misurato): servono fotogrammi reali.',
  steps: [
    '<b>iPhone:</b> Impostazioni → Fotocamera → <b>Registra slo-mo</b> → scegli 1080p a <b>240 fps</b> (o 120). Poi nell\'app <b>Fotocamera</b> scegli la modalità <b>Slo-mo</b>.',
    'Alternativa sui modelli recenti: Impostazioni → Fotocamera → Registra video → <b>4K a 120 fps</b> (verifica sul tuo modello): è un video normale, non va calibrato. I file sono molto grandi.',
    '<b>Android:</b> modalità «Slow motion» dell\'app Fotocamera (di solito 120 o 240 fps).',
    'Telefono <b>fermo</b> su un supporto. Serve <b>molta luce</b>: a 240 fps ogni fotogramma è esposto pochissimo, con luce scarsa il video è scuro e rumoroso.',
    'Poi in Jump Lab: <b>Importa video</b> e scegli il file. Nel selettore, se compare «Opzioni», imposta <b>Formato: Attuale</b>.',
    '<b>Non condividere il file con app di messaggistica</b> prima di importarlo: spesso li riducono a 30 fps e perdono i fotogrammi veri. Usa AirDrop, iCloud, cavo, o importa direttamente dalla libreria.',
    'Se il video risulta rallentato a 30 fps, l\'app lo riconosce e propone la calibrazione (×4, ×8…).',
  ],
  cam: 'Perché non registra direttamente l\'app? Le modalità 120/240 fps sono dell\'app Fotocamera e i siti web non le possono usare (di solito il tetto è 30–60 fps). Per registrarle dentro l\'app servirebbe un\'app nativa iOS.',
  avoid: ['Importare un file già ricodificato a 30 fps.', 'Luce scarsa a 240 fps.'],
};

/** Apre la scheda del test (cmj, sj, dj, rebound, free, cmj_arms) o la guida generale ('general'). */
export function openGuide(key = 'general') {
  const slomo = key === 'slomo';
  const t = slomo ? SLOMO : TESTS[key];
  sheet((b, close) => {
    b.append(...[
      h('h2', { style: { fontSize: '21px', marginBottom: '6px' } }, t ? t.title : 'Come filmare'),
      t ? h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '14px' }, html: t.what }) : null,
      slomo ? null : h('div', { html: svgSide }),
      t ? block(slomo ? 'Come fare' : 'Come eseguirlo', t.steps) : null,
      t ? block(slomo ? 'Perché non registra direttamente l\'app?' : 'Ripresa consigliata', [slomo ? t.cam.replace(/^Perché non registra direttamente l'app\? /, '') : t.cam]) : null,
      ...(t || slomo ? [] : [h('div', { style: { marginTop: '12px' }, html: svgTop })]),
      ...(slomo ? [] : [block(VIEW[0], VIEW[1]), ...COMMON.map(([ti, items]) => block(ti, items))]),
      t ? block('Errori da evitare', t.avoid) : null,
      h('p', { class: 'small faint', style: { margin: '16px 0 0' }, html: 'Evidenze: 240 fps e atterraggio a gambe tese sono supportati dalla letteratura (validazione di My Jump, errore del metodo del tempo di volo). Distanza e altezza della camera sono buone pratiche: nessuno studio le ha validate. Se salti su <b>una gamba</b>, scegli Sinistra/Destra in Home: l\'app usa solo il piede che salta.' }),
      h('button', { class: 'btn primary block', style: { marginTop: '16px' }, onclick: close }, 'Ho capito'),
    ].filter(Boolean));
  });
}

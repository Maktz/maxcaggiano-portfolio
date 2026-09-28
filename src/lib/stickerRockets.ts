/**
 * Navicelle "sticker" dentro al canvas della nebulosa.
 *
 * Perche' stanno li' e non nel DOM: dovendo subire l'avanzata in Z della camera
 * durante la planata, devono condividere con le particelle la stessa proiezione
 * e lo stesso Circle of Confusion. Un elemento DOM non puo' essere proiettato,
 * quindi l'unico modo perche' davvero "viaggino con la camera" e' che facciano
 * parte del renderer.
 *
 * Il ritorno al piano 2D non e' un trucco: il piano focale vive a
 * z = FOCUS_TARGET_Z, lo stesso piano dove e' ancorata la griglia Works.
 * Portando l'escursione a zero quando la camera e' arrivata, i razzi tornano
 * su quel piano e sono quindi COPLANARI alla griglia: ci passano sopra senza
 * attraversarla. L'impenetrabilita' della materia e' rispettata per costruzione.
 */

// Piano focale: coincide con la griglia Works, cosi i razzi le sono coplanari.

import { paletteRgb, type PaletteToken } from './palette';
import { entryState } from './entryState';
import { ENTRY_CONFIG } from './entryConfig';

const PORTHOLE_GLASS = '#2B1030';

/** Altezza/larghezza del viewBox del razzo. */
const ROCKET_ASPECT = 210 / 100;

/**
 * Lato lungo della sprite rasterizzata, in px. Il razzo che si vede al Works
 * occupa ~60px, quindi 200px di sprite regge ampiamente anche il massimo
 * ingrandimento prospettico: resta nitido senza disegnare a ogni frame.
 */
const ROCKET_SAMPLE_EDGE_PX = 200;

export type StickerTint = 'yellow' | 'pink' | 'violet' | 'orchid' | 'amber';

/**
 * Ogni tinta del razzo e' un token della palette: l'esadecimale vive solo in
 * src/index.css, quindi cambiarlo aggiorna il disegno senza toccare qui.
 */
const TINT_TOKEN = {
  yellow: 'accent',
  pink: 'pink',
  violet: 'violet',
  orchid: 'orchid',
  amber: 'amber',
} as const satisfies Record<StickerTint, PaletteToken>;

/**
 * Arte del razzo, reference mid-century: alette arrotondate, scafo a capsula,
 * cupola staccata, oblò con anello e vetro scuro. Piatta per definizione: solo
 * riempimenti e un tratto di penna, nessun gradiente, ombra o filtro.
 */
const rocketSvg = (tint: StickerTint) => {
  const accent = paletteRgb(TINT_TOKEN[tint]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 210"><path d="M34 152 C23 156 16 168 13 186 C11.5 195 15 200 21 198 C30 194 34 180 39 164 Z" fill="${accent}"/><path d="M66 152 C77 156 84 168 87 186 C88.5 195 85 200 79 198 C70 194 66 180 61 164 Z" fill="${accent}"/><path d="M44 164 L56 164 L56 196 C56 201 44 201 44 196 Z" fill="${accent}"/><path d="M50 22 C63 22 71 37 71 56 L71 152 C71 163 62 170 50 170 C38 170 29 163 29 152 L29 56 C29 37 37 22 50 22 Z" fill="#FFF4EF" stroke="${accent}" stroke-width="4"/><path d="M50 6 C60 6 67 16 67 27 C67 32 62 34 50 34 C38 34 33 32 33 27 C33 16 40 6 50 6 Z" fill="${accent}"/><circle cx="50" cy="66" r="16" fill="${accent}"/><circle cx="50" cy="66" r="10.5" fill="${PORTHOLE_GLASS}"/><path d="M44 72 L56 60" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="3.5" stroke-linecap="round"/><path d="M50 84 L50 150" stroke="${accent}" stroke-width="3" stroke-linecap="round"/></svg>`;
};

/** Rasterizza l'arte in una sprite offscreen, una volta sola per tinta. */
export const createRocketSprite = (
  tint: StickerTint,
): HTMLCanvasElement | null => {
  const sprite = document.createElement('canvas');
  sprite.width = ROCKET_SAMPLE_EDGE_PX;
  sprite.height = Math.round(ROCKET_SAMPLE_EDGE_PX * ROCKET_ASPECT);
  const ctx = sprite.getContext('2d');
  if (!ctx) return null;
  const image = new Image();
  image.onload = () => {
    ctx.clearRect(0, 0, sprite.width, sprite.height);
    ctx.drawImage(image, 0, 0, sprite.width, sprite.height);
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rocketSvg(tint))}`;
  return sprite;
};

/**
 * Altezza nominale del razzo, in pixel di viewport, a profondita' neutra.
 *
 * Vive qui perche' e' un fatto della sprite, non del renderer: sia il canvas
 * ambient sia il razzo coreografato di rocketManager.ts lo prendono da questo
 * numero. Due costanti uguali in due file sono un numero che un giorno
 * divergerebbe, e la divergenza si vedrebbe solo come "il razzo scripted e'
 * piu' piccolo di quelli ambient" senza che nessuno saprebbe dire quando e'
 * successo.
 */
export const ROCKET_BASE_HEIGHT_PX = 80;

export { ROCKET_ASPECT, ROCKET_SAMPLE_EDGE_PX };

// ---------------------------------------------------------------------------
// Rotte di volo
// ---------------------------------------------------------------------------

/**
 * Ogni razzo vive una rotta indipendente: parte da un lato casuale dello
 * schermo, esce da un altro, con una lieve incurvatura. La rotta e' definita
 * in SCREEN SPACE (frazioni 0..1) perche' l'ingresso deve sempre essere da un
 * bordo, qualunque sia la camera; il movimento in profondita' e' invece
 * un'oscillazione di z separata, che e' cio' che produce scala e bokeh.
 */

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

type Side = 'left' | 'right' | 'top' | 'bottom';

interface Route {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Controllo di Bezier: incurvatura perpendicolare alla corda. */
  ctrlX: number;
  ctrlY: number;
  /** true = la rotta scende, quindi accelera (gravita'). */
  descends: boolean;
  durationMs: number;
  startedAt: number;
}

/**
 * Punto su un lato della viewport, SEMPRE fuori campo.
 *
 * Il punto e' in frazioni di viewport: 0 = bordo sinistro/alto, 1 = destro/basso.
 * `outside` spinge oltre il bordo di una frazione fissa, cosi' il razzo non
 * appare mai gia' dentro lo schermo: quando lo si vede e' perche' e' entrato
 * dal bordo, non perche' e' stato creato li'. L'overshoot era casuale e poteva
 * essere positivo, quindi meta' delle rotte nascevano dentro.
 */
/**
 * Punto su un lato della viewport, SEMPRE fuori campo.
 *
 * Il punto e' in frazioni di viewport: 0 = bordo sinistro/alto, 1 = destro/basso.
 * `OUTSIDE_FRACTION` spinge oltre il bordo di poco, cosi' il razzo non appare mai
 * gia' dentro lo schermo (compare quando entra dal bordo) e al tempo stesso la
 * fase fuori campo resta breve: con 0.25 i razzi restavano fuori 1.5s, piu' della
 * prima animazione del volto (0.96s), quindi potevano mancare proprio quando
 * l'utente entrava nell'hero.
 */
const OUTSIDE_FRACTION = 0.1;

/**
 * 0 = prospettiva rigorosa, che darebbe all'hero 0.158 contro 0.6 alla Works
 * (rapporto 0.26: razzo 4 volte piu' piccolo di quanto serve).
 * 0.75 = dimensioni coerenti mantenendo un guadagno di scala reale del 14%
 * durante la planata. E' un compromesso di presentazione: il BOKEH resta
 * ottico e rigoroso, cambia solo la scala apparente.
 */
const STICKER_SCALE_GAIN = 0.75;

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

const pointOnSide = (side: Side): { x: number; y: number } => {
  const margin = randomBetween(0.08, 0.92);
  switch (side) {
    case 'left':
      return { x: -OUTSIDE_FRACTION, y: margin };
    case 'right':
      return { x: 1 + OUTSIDE_FRACTION, y: margin };
    case 'top':
      return { x: margin, y: -OUTSIDE_FRACTION };
    default:
      return { x: margin, y: 1 + OUTSIDE_FRACTION };
  }
};

/**
 * Sceglie due lati distinti a caso e costruisce una rotta morbida fra loro.
 *
 * `startPhase` e' la posizione iniziale lungo la rotta, da 0 a 1. Deve valere 0
 * per qualsiasi rotta che nasce DOPO un volo finito: altrimenti il razzo
 * ricomparirebbe gia' a meta' percorso, cioe' in mezzo allo schermo, invece di
 * entrare da un bordo. Il valore diverso da 0 serve solo alla creazione
 * iniziale, per non avere entrambi i razzi fermi sullo stesso bordo.
 */
const createRoute = (now: number, startPhase = 0): Route => {
  const sides: Side[] = ['left', 'right', 'top', 'bottom'];
  const fromSide = sides[Math.floor(Math.random() * sides.length)];
  const pool = sides.filter((side) => side !== fromSide);
  const toSide = pool[Math.floor(Math.random() * pool.length)];
  const from = pointOnSide(fromSide);
  const to = pointOnSide(toSide);
  const descends = to.y >= from.y;
  // Curvatura perpendicolare alla corda, contenuta: un raggio troppo ampio
  // fa leggere il moto come un'orbita invece che come un passaggio.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = randomBetween(-0.16, 0.16) * length;
  return {
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
    ctrlX: (from.x + to.x) / 2 + (-dy / length) * bend,
    ctrlY: (from.y + to.y) / 2 + (dx / length) * bend,
    descends,
    // Voli brevi: i razzi devono attraversare la scena mentre il volto fa la
    // sua prima animazione (0.96s totali), non svaporare dopo. 11-17s li
    // rendeva 2.5 volte troppo lenti rispetto a quella finestra.
    durationMs: randomBetween(4500, 7000),
    // Partenza: 0 = sul bordo esterno (entra), 1 = in volo (solo creazione
    // iniziale). Con 0 il razzo e' fuori campo al t0 ed entra dopo ~0.7s.
    startedAt: now - startPhase * randomBetween(4500, 7000),
  };
};

/**
 * Bezier quadratica. L'easing entra nel PARAMETRO, non nel valore: applicarlo
 * al valore produrrebbe una velocita' infinita al centro della curva, cioe'
 * l'opposto di un moto morbido. La legge e' posizione ~ t^1.8 come per i razzi
 * DOM: se la rotta scende accelera, se sale frena.
 */
const sampleRoute = (route: Route, progress: number) => {
  const t = clamp01(progress);
  // Esponente 1.4 (non 1.8): con 1.8 il razzo partiva quasi fermo, il che su
  // un volo di 4.5-7s significava metà dello schermo perso in accelerazione.
  // La legge resta "chi scende accelera, chi sale frena", solo piu' decisa.
  const ease = route.descends ? t ** 1.4 : 1 - (1 - t) ** 1.4;
  const mt = 1 - ease;
  return {
    x: mt * mt * route.fromX + 2 * mt * ease * route.ctrlX + ease * ease * route.toX,
    y: mt * mt * route.fromY + 2 * mt * ease * route.ctrlY + ease * ease * route.toY,
  };
};

/**
 * Tangente alla curva in `progress`, per orientare il muso sul moto.
 *
 * La tangente va calcolata in PIXEL, non in frazioni di viewport: i due assi
 * non sono equivalenti (1440x813 contro 1024x1366) e la differenza produce
 * un errore costante di 15-25 gradi sull'angolo del muso.
 */
const routeTangent = (
  route: Route,
  progress: number,
  width: number,
  height: number,
) => {
  const h = 0.004;
  const a = sampleRoute(route, Math.max(0, progress - h));
  const b = sampleRoute(route, Math.min(1, progress + h));
  return Math.atan2((b.x - a.x) * width, -(b.y - a.y) * height);
};

// ---------------------------------------------------------------------------
// Stato dei razzi
// ---------------------------------------------------------------------------

export interface StickerRocket {
  tint: StickerTint;
  route: Route;
  /** Oscillazione di profondita': periodo, fase e ampieza, tutti personali. */
  depthPeriodMs: number;
  depthPhase: number;
  depthAmplitude: number;
  /** Galleggiamento lento, indipendente dalla rotta. */
  bobPeriodMs: number;
  bobPhase: number;
  alpha: number;
}

/**
 * Ordine di rotazione delle tinte. Ogni volo completo fa avanzare il razzo
 * nella sequenza, cosi' col tempo sulla scena passano tutti i colori della
 * palette invece di restare fissi su due.
 */
const TINT_ROTATION = [
  'yellow',
  'violet',
  'orchid',
  'amber',
  'pink',
] as const satisfies readonly StickerTint[];

/** Tinta successiva a quella corrente, saltando quelle gia' in scena. */
const nextTint = (
  current: StickerTint,
  taken: ReadonlySet<StickerTint>,
): StickerTint => {
  const start = TINT_ROTATION.indexOf(current as (typeof TINT_ROTATION)[number]);
  const from = start < 0 ? 0 : start;
  for (let step = 1; step <= TINT_ROTATION.length; step += 1) {
    const candidate = TINT_ROTATION[(from + step) % TINT_ROTATION.length];
    if (!taken.has(candidate)) return candidate;
  }
  // La rotazione ne ha sempre cinque e al massimo due sono occupate: questo
  // ramo non e' raggiungibile, ma chiude il tipo.
  return TINT_ROTATION[from];
};

/**
 * Assegna la tinta successiva ai razzi che hanno finito il volo, evitando che
 * due razzi sulla scena abbiano lo stesso colore nello stesso momento.
 *
 * `finished` marca chi sta cambiando rotta: solo loro rirotano. Gli altri
 * mantengono la tinta corrente e vengono "occupati", cosi' il nuovo colore non
 * puo' coincidere con quello di un razzo ancora in volo.
 */
const assignTints = (
  rockets: StickerRocket[],
  finished: boolean[],
): StickerRocket[] => {
  const taken = new Set<StickerTint>();
  rockets.forEach((rocket, i) => {
    if (!finished[i]) taken.add(rocket.tint);
  });
  return rockets.map((rocket, i) => {
    if (!finished[i]) return rocket;
    const tint = nextTint(rocket.tint, taken);
    taken.add(tint);
    return tint === rocket.tint ? rocket : { ...rocket, tint };
  });
};

const ROCKET_COUNT = 2;

const createRocket = (
  tint: StickerTint,
  now: number,
  startPhase = 0,
): StickerRocket => ({
  tint,
  // startPhase 0 (il default) = rotta che parte ADESSO sul bordo: il razzo
  // entra. Valori alti servono solo alla creazione iniziale, per non avere
  // entrambi i razzi fermi sullo stesso bordo al primo frame.
  route: createRoute(now, startPhase),
  depthPeriodMs: randomBetween(5200, 11000),
  depthPhase: Math.random() * Math.PI * 2,
  depthAmplitude: randomBetween(0.55, 1),
  bobPeriodMs: randomBetween(7000, 13000),
  bobPhase: Math.random() * Math.PI * 2,
  alpha: 1,
});

// ---------------------------------------------------------------------------
// IL GATE DEI RAZZI AMBIENT
// ---------------------------------------------------------------------------
//
// I razzi ambient non devono esistere durante il preloader e l'ingresso: e' il
// momento in cui lo sguardo e' tutto sul viso e sul testo, e un razzo che
// attraversa lo schermo ruberebbe la lettura a entrambi. Ripartono quando la
// pagina e' diventata 'hero' e sono passati `ambientRocketDelay` millisecondi.
//
// Il gate sta qui, in advanceRockets, e non nel renderer perche' qui e' l'unico
// posto in cui una rotta viene rilasciata: il renderer riceve gia' l'elenco dei
// razzi e lo disegna, e filtrarlo li' lascerebbe libero di riciclare il primo
// che capita.

let heroEnteredAt = 0;

// Elenco vuoto condiviso: restituito a ogni frame chiuso deve essere lo stesso
// riferimento, altrimenti il renderer riceverebbe un array nuovo 60 volte al
// secondo e non potrebbe nemmeno accorgersi che i razzi sono spariti.
const EMPTY: StickerRocket[] = [];

/** true se lo stato e' 'hero' e il ritardo e' passato. */
export const ambientRocketsAllowed = (): boolean =>
  entryState.get() === 'hero' && Date.now() - heroEnteredAt >= ENTRY_CONFIG.ambientRocketDelay;

/**
 * Segna l'ingresso nello stato 'hero': da questo istante scorre il ritardo che
 * lascia respirare i razzi ambient.
 */
export const markHeroForAmbientRockets = (): void => {
  heroEnteredAt = Date.now();
};

/**
 * Nuove rotte che partono ADESSO, al bordo.
 *
 * Usate quando l'utente entra nell'hero: senza questo, se un razzo stava per
 * uscire proprio in quel momento non si vedeva nulla, e la richiesta e' che i
 * due razzi ARRIVINO subito. Con startedAt = now il razzo e' sul bordo esterno e
 * entra entro ~0.7s, quindi dentro la finestra della prima animazione del volto
 * (0.96s).
 */
export const restartRockets = (
  rockets: StickerRocket[],
  now: number,
): StickerRocket[] => {
  // Se il gate e' chiuso non si rilascia nessuna rotta nuova. Non e' un no-op
  // difensivo: restartRockets viene chiamato anche dall'ingresso in hero, e
  // chiamarlo li' durante il ritardo rifarebbe partire i razzi subito, azzerando
  // proprio la pausa che il ritardo serve a creare.
  if (!ambientRocketsAllowed()) return rockets;
  // Anche il rientro nell'hero cambia tinta: e' un volo nuovo, non una
  // ripresa di quello interrotto.
  const next = rockets.map((rocket) => {
    const reborn = createRocket(rocket.tint, now, 0);
    reborn.depthPhase = rocket.depthPhase + 0.7;
    reborn.bobPhase = rocket.bobPhase;
    return reborn;
  });
  return assignTints(next, rockets.map(() => true));
};

/**
 * Stato iniziale dei razzi. `now` e' il clock condiviso del renderer: le
 * rotte devono essere campionate sullo stesso tempo delle particelle, altrimenti
 * il razzo si muoverebbe mentre il frame e' fermo.
 */
export const createStickerRockets = (now: number): StickerRocket[] =>
  (['yellow', 'violet'] as StickerTint[]).slice(0, ROCKET_COUNT).map((tint) =>
    createRocket(tint, now),
  );

export { ROCKET_COUNT };

/**
 * Avanza le rotte alla fine di ogni volo e restituisce lo stato aggiornato.
 * Il cambio rotta avviene a catena dentro il RAF del renderer, quindi non crea
 * alcun ciclo aggiuntivo.
 */
export const advanceRockets = (
  rockets: StickerRocket[],
  now: number,
): StickerRocket[] => {
  // Gate chiuso: l'elenco si svuota, e con esso il renderer non ha piu' niente da
  // disegnare. Non e' "fermare i razzi dove sono": un razzo fermo a meta' schermo
  // e' un razzo che l'utente vede, e la richiesta e' che durante il preloader e
  // l'ingresso non ce ne sia nessuno. Fermarli avrebbe reso il distratto
  // soddisfatto e il distratto disturbato.
  if (!ambientRocketsAllowed()) return EMPTY;
  // Gate appena aperto: l'elenco e' vuoto perche' durante l'ingresso i razzi non
  // esistevano, quindi vanno rilasciati ora. Il riciclo e' qui e non nel renderer
  // perche' questo e' l'unico posto in cui si decide se una rotta nasce.
  if (rockets.length === 0) return createStickerRockets(now);
  // Prima si registra chi ha finito: la nuova rotta nasce dal bordo.
  const finished = rockets.map(
    (rocket) => (now - rocket.route.startedAt) / rocket.route.durationMs >= 1,
  );
  const next = rockets.map((rocket, i) => {
    if (!finished[i]) return rocket;
    const reborn = createRocket(rocket.tint, now);
    // La profondita' non si resetta: altrimenti il razzo darebbe uno scatto di
    // scala proprio nel cambio rotta, che e' il momento piu' osservabile.
    reborn.depthPhase = rocket.depthPhase + 0.7;
    reborn.bobPhase = rocket.bobPhase;
    return reborn;
  });
  return assignTints(next, finished);
};

/**
 * Stato di un razzo al tempo `now`, gia' proiettato in coordinate schermo.
 *
 * `flyIntensity` e' 0 all'inizio e alla fine del viaggio Z, 1 a meta': e' la
 * campana che tiene i razzi sul piano focale (2D) nelle due soste e li stacca
 * durante la planata, dove devono seguire la camera.
 */
export interface StickerFrame {
  x: number;
  y: number;
  /** Fattore di scala prospettica, gia' moltiplicato per la dimensione. */
  scale: number;
  /** Radianti, 0 = muso in alto. */
  heading: number;
  /** Circle of Confusion con segno: |CoC| > soglia = bokeh. */
  signedCoC: number;
  alpha: number;
}

export const sampleRocket = (
  rocket: StickerRocket,
  now: number,
  width: number,
  height: number,
  focalLength: number,
  cameraZ: number,
  focusDistance: number,
  aperture: number,
  flyIntensity: number,
  groundedZ: number,
  baseSizePx: number,
): StickerFrame => {
  const elapsed = now - rocket.route.startedAt;
  const progress = elapsed / rocket.route.durationMs;
  const p = clamp01(progress);

  // Nessuna dissolvenza: la rotta parte e finisce FUORI viewport (vedi
  // OUTSIDE_FRACTION), quindi il razzo compare quando il suo bordo tocca lo
  // schermo e scompare quando l'altro bordo lo lascia. Un fade lo farebbe
  // "apparire e spegnersi" invece di entrare e uscire.
  const point = sampleRoute(rocket.route, p);
  const heading = routeTangent(rocket.route, p, width, height);

  // Oscillazione in profondita': e' la componente che produce scala e bokeh
  // durante la planata. Fuori dal viaggio Z vale zero, quindi il razzo resta
  // ancorato al piano focale e appare 2D.
  const depthWave =
    Math.sin((now / rocket.depthPeriodMs) * Math.PI * 2 + rocket.depthPhase);
  const z = groundedZ + depthWave * rocket.depthAmplitude * flyIntensity;

  // Stessa proiezione delle particelle: il denominatore e' la distanza
  // effettiva dell'oggetto dalla camera, e il fuoco insegue il piano.
  const denominator = focalLength + z - cameraZ;
  if (denominator <= focalLength * 0.1) {
    return { x: 0, y: 0, scale: 0, heading: 0, signedCoC: 0, alpha: 0 };
  }
  // Guadagno di scala: vedi STICKER_SCALE_GAIN. La prospettiva pura darebbe
  // 0.158 all'hero contro 0.6 alla Works (4x piu' piccolo); il guadagno
  // riporta le dimensioni a valori coerenti mantenendo un avvicinamento
  // reale durante la planata. Il CoC qui sotto resta ottico e rigoroso.
  const perspective = lerp(focalLength / denominator, 1, STICKER_SCALE_GAIN);
  const signedCoC = ((denominator - focusDistance) / Math.max(denominator, 1)) * aperture;

  // Il razzo e' centrato sul suo punto di rotta, quindi la proiezione non
  // sposta il centro: la scala agisce sulla dimensione, non sulla posizione.
  const bob =
    Math.sin((now / rocket.bobPeriodMs) * Math.PI * 2 + rocket.bobPhase) * 9;

  return {
    x: point.x * width,
    y: point.y * height + bob,
    scale: perspective * baseSizePx,
    heading,
    signedCoC,
    alpha: rocket.alpha,
  };
};



import { useEffect, useRef } from 'react';
import {
  CAMERA_SETTLED_RATIO,
  CARD_REVEAL_RATIO,
  HERO_PORTRAIT_HEIGHT_PX,
  HERO_PORTRAIT_HEIGHT_VH,
  SHAPE_SETTLED_RATIO,
  clamp01,
  phase,
  portraitRevealWindow,
  readPortraitGeometry,
  shapeRecenterPhase,
  smoothstep,
} from '@/lib/scrollMath';
import { useSmoothScroll } from '@/providers/smoothScrollContext';
import { getPortraitAspect, loadPortraitImage } from '@/lib/portraitAsset';
import {
  ROCKET_ASPECT,
  ROCKET_COUNT,
  advanceRockets,
  ambientRocketsAllowed,
  createRocketSprite,
  createStickerRockets,
  restartRockets,
  sampleRocket,
  type StickerRocket,
  type StickerTint,
} from '@/lib/stickerRockets';
import { paletteRgb, paletteRgba } from '@/lib/palette';
import { reducedMotion } from '@/lib/motionPreference';

const IMG_URL = '/max.svg';
// Lato lungo del raster di campionamento, in px. Costa una sola volta al
// caricamento: piu' alto risolve meglio i contorni sottili del disegno.
const SAMPLE_LONG_EDGE_PX = 160;



export const PARTICLE_COUNT = 4750;
// Densità del volume davanti alla griglia Works. I tre gruppi hanno un ruolo
// ottico diverso (dischi grandi = volume, punti = sharp, medi = scala
// intermedia) e vengono aumentati proportionally: si raddoppia la densità
// senza sbilanciare il mix che era già bilanciato.
const FOREGROUND_LARGE_PARTICLE_COUNT = 28;
const FOREGROUND_POINT_PARTICLE_COUNT = 12;
const FOREGROUND_MEDIUM_PARTICLE_COUNT = 10;
const FOREGROUND_PARTICLE_COUNT =
  FOREGROUND_LARGE_PARTICLE_COUNT +
  FOREGROUND_POINT_PARTICLE_COUNT +
  FOREGROUND_MEDIUM_PARTICLE_COUNT;
// Griglia di distribuzione nello stop Works: le colonne e le righe sono derivate
// dal conteggio reale, non cablate a 5. Con un numero fisso di colonne e 50
// particelle l'indice di riga avrebbe spinto metà volume fuori viewport
// (workY fino a ~1.7 della height).
const FOREGROUND_WORK_COLUMNS = 6;

const DEEP_PARTICLE_RATIO = 0.62;
const FOCAL_LENGTH = 900;
const CAMERA_TRAVEL_Z = 4200;
const MAX_CANVAS_DPR = 1.5;
// 4/3 + 25% = 5/3: il nuovo ingrandimento è un quarto più ampio
// rispetto alla scala precedente.
const SHAPE_SCALE = 25 / 12;
// Spring che apre la sagoma verso la nebulosa: SMORZAMENTO CRITICO.
//
// Prima era sottosmorzato (D=3.2, F=8): la curva 1 - e^(-Dt)cos(Ft) passa il
// bersaglio e TORNARE indietro. Misurato: picco 1.872 a y=1658, minimo 1.608 a
// y=1727, e le scritte laterali spariscono fra 1659 e 1732: il rimpicciolimento
// era quindi visibile proprio quando la sagoma restava sola.
//
// La soluzione critica 1 - (1 + Dt)e^(-Dt) ha la STESSA velocita iniziale e lo
// STESSO arrivo, ma non supera mai il bersaglio: la molla si sente nella
// decelerazione, non nel rimbalzo. Monotona verificata su 400 campioni.
const SHAPE_SPRING_DAMPING = 3.2;
const AUTONOMOUS_BASE_GAIN = 0.45;
const AUTONOMOUS_CAMERA_GAIN = 2.4;
const AUTONOMOUS_Z_AMPLITUDE_MULTIPLIER = 4.4;
const AUTONOMOUS_Z_SPEED_MULTIPLIER = 0.2;
const POINT_LIKE_RATIO = 0.26;
const POINT_TRAIL_DELAYS = [0.045, 0.09, 0.14];
const POINT_TRAIL_OPACITIES = [0.16, 0.1, 0.055];

// DOF fotografico-inspired: il fuoco resta davanti alla camera mentre avanza
// nello spazio. Il CoC cresce con la distanza dal piano focale, come in un
// obiettivo con apertura ridotta.
const FOCUS_TARGET_Z = 4800;
const FOCUS_APERTURE_START = 30;
// Il diaframma non si chiude più a metà viaggio: la rampa finisce con la
// camera (0.82 = dallo 0.18 dello shape settle allo stop Works) e resta
// aperta, così anche alle spalle della griglia i dischi conservano un vero
// fuori fuoco invece di diventare puntini nitidi. Più alto = dischi più ampi
// nella coda Works (profondità), più basso = fondale più discreto.
const FOCUS_APERTURE_END = 30;
const FOCUS_APERTURE_END_PROGRESS = 0.82;
const FOCUS_THRESHOLD = 0.8;
const BOKEH_MAX_RADIUS = 18;
const BOKEH_ALPHA_BOOST = 1.25;
const BOKEH_SPRITE_SIZE = 96;
// Il cloud Nebula usa un tetto più stretto del foreground: durante il viaggio
// Z i dischi vicini si ingrandiscono e si sovrappongono, quindi un raggio
// minore evita che l'inchiostro si accumuli fino a saturare il rosa. Il tetto
// viene però restituito al valore pieno mentre la camera si ferma, così la
// griglia Works ritrova il bokeh della nube alle sue spalle.
const NEBULA_BOKEH_MAX_RADIUS = 14;
// L'ottica conserva il flusso: un disco che si gonfia è anche più tenue. I
// dischi fino a questo raggio (il fondale Works, i puntini della sagoma)
// restano intatti; quelli che si dilatano durante la traversata perdono
// luminosità, ed è questo che spegne il picco di metà viaggio senza svuotare
// la nebulosa alle spalle della griglia.
const BOKEH_FLUX_REFERENCE_RADIUS = 7.5;
const BOKEH_FLUX_FALLOFF = 1.6;
// Il foreground Works non condivide il tetto del cloud: sono dischi vicini
// all'obiettivo e devono restare grandi e morbidi davanti alle card.
const FOREGROUND_BOKEH_MAX_RADIUS = 46;

// Navicelle 3D. Vivono sul piano focale (FOCUS_TARGET_Z) durante le soste e si
// staccano in profondita' solo durante la planata: e' la stessa ottica delle
// particelle, quindi razzi e nuvola condividono un solo materiale fotografico.
// Altezza a fuoco (scala 1). Con il guadagno di STICKER_SCALE_GAIN: 80 danno
// ~63px all hero e ~72px alla Works, quindi i razzi restano della taglia di
// prima e ingrandiscono del 14% durante la planata.
const STICKER_BASE_HEIGHT_PX = 80;
const STICKER_ALPHA = 0.92;

/**
 * Quanto il canvas continua a ridipingere dopo l'apertura del gate dei razzi
 * ambient, con movimento ridotto. Deve superare il tempo che un razzo impiega a
 * entrare dal bordo (~0.7s), altrimenti si vedrebbe il vuoto in cui dovrebbe
 * comparire e poi il layer congelerebbe vuoto per sempre.
 */
const AMBIENT_WAKE_MS = 2500;
// Soglia oltre la quale il razzo e' considerato fuori fuoco. Stessa di ogni
// altra particella: sotto questa soglia il CoC e' troppo piccolo per vedersi.
const STICKER_FOCUS_THRESHOLD = 0.8;
// L'alone bokeh che sta sotto al razzo sfocato. Il disco e' un po' piu' ampio
// del raggio perche' il fotografo vede l'alone, non solo il nucleo.
const STICKER_HALO_FACTOR = 1.35;

type BokehSpriteKind = 'soft' | 'far' | 'near';

type ParticleLayer = 'deep' | 'medium';
type ForegroundSide = 0 | 1 | 2 | 3 | 4;

interface Particle {
  worldX: number;
  worldY: number;
  z: number;
  radius: number;
  alpha: number;
  layer: ParticleLayer;
  sizeScale: number;
  flowSeed: number;
  driftX: number;
  driftY: number;
  autonomousPhaseX: number;
  autonomousPhaseY: number;
  autonomousPhaseZ: number;
  autonomousSpeedX: number;
  autonomousSpeedY: number;
  autonomousSpeedZ: number;
  autonomousAmplitude: number;
  autonomousAmplitudeZ: number;
  releaseSeed: number;
  pointLike: boolean;
}

type ForegroundSize = 'large' | 'point' | 'medium';

interface ForegroundParticle {
  side: ForegroundSide;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  speed: number;
  radius: number;
  alpha: number;
  driftX: number;
  driftY: number;
  offsetSeed: number;
  blurPhase: number;
  workX: number;
  workY: number;
  workPhase: number;
  size: ForegroundSize;
}

const lerp = (start: number, end: number, amount: number) =>
  start + (end - start) * amount;
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const hash01 = (value: number) => {
  const hashed = Math.sin(value * 12.9898 + 78.233) * 43758.5453123;
  return hashed - Math.floor(hashed);
};

type BokehSprites = Record<BokehSpriteKind, HTMLCanvasElement>;

// Le sprite sono costruite una sola volta. Non applichiamo un filtro Gaussian
// a ogni particella: il kernel ottico è pre-renderizzato e il Canvas sceglie
// solo l'anello adatto alla profondità della particella.
const createBokehSprite = (kind: BokehSpriteKind) => {
  const sprite = document.createElement('canvas');
  sprite.width = BOKEH_SPRITE_SIZE;
  sprite.height = BOKEH_SPRITE_SIZE;
  const spriteCtx = sprite.getContext('2d');
  if (!spriteCtx) return sprite;

  const center = BOKEH_SPRITE_SIZE / 2;
  const radius = center * (kind === 'near' ? 0.92 : kind === 'far' ? 0.86 : 0.72);
  const pink = (alpha: number) => paletteRgba('pink', alpha);
  const gradient = spriteCtx.createRadialGradient(center, center, 0, center, center, radius);
  // Il centro non è mai completamente pieno: conserva un piccolo highlight,
  // mentre il bordo resta morbido. Il near-field è più denso, come un
  // disco di confusione vicino all'obiettivo.
  gradient.addColorStop(0, pink(0.58));
  gradient.addColorStop(0.28, kind === 'near' ? pink(0.48) : pink(0.34));
  gradient.addColorStop(0.58, kind === 'far' ? pink(0.32) : pink(0.22));
  gradient.addColorStop(0.82, pink(0.11));
  gradient.addColorStop(1, pink(0));
  spriteCtx.fillStyle = gradient;
  spriteCtx.fillRect(0, 0, BOKEH_SPRITE_SIZE, BOKEH_SPRITE_SIZE);
  return sprite;
};

const createBokehSprites = (): BokehSprites => ({
  soft: createBokehSprite('soft'),
  far: createBokehSprite('far'),
  near: createBokehSprite('near'),
});

const createForegroundParticles = (): ForegroundParticle[] => {
  const sides: ForegroundSide[] = [0, 1, 2, 3, 4];
  while (sides.length < FOREGROUND_PARTICLE_COUNT) {
    sides.push(Math.floor(Math.random() * 5) as ForegroundSide);
  }
  for (let index = sides.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [sides[index], sides[swapIndex]] = [sides[swapIndex], sides[index]];
  }

  // I gruppi hanno un ruolo ottico diverso: i grandi dischi danno volume,
  // i punti restano sharp e i medi costruisano la scala intermedia.
  const sizes: ForegroundSize[] = [
    ...Array<ForegroundSize>(FOREGROUND_LARGE_PARTICLE_COUNT).fill('large'),
    ...Array<ForegroundSize>(FOREGROUND_POINT_PARTICLE_COUNT).fill('point'),
    ...Array<ForegroundSize>(FOREGROUND_MEDIUM_PARTICLE_COUNT).fill('medium'),
  ];
  for (let index = sizes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [sizes[index], sizes[swapIndex]] = [sizes[swapIndex], sizes[index]];
  }

  // Passi derivati dal conteggio: la copertura resta uniforme a qualunque
  // densità, e il jitter (che è più ampio del passo con 50 particelle) impedisce
  // che si legga un reticolo davanti alle card.
  const workRows = Math.ceil(FOREGROUND_PARTICLE_COUNT / FOREGROUND_WORK_COLUMNS);
  const workStepX = 0.76 / Math.max(1, FOREGROUND_WORK_COLUMNS - 1);
  const workStepY = 0.66 / Math.max(1, workRows - 1);

  return sides.map((side, index) => {
    const fromBehind = side === 4;
    const size = sizes[index];
    const edgeNoise = randomBetween(-0.12, 0.12);
    const startX = side === 0
      ? -0.12 + edgeNoise
      : side === 1
        ? 1.12 + edgeNoise
        : fromBehind
          ? 0.5 + randomBetween(-0.18, 0.18)
          : randomBetween(0.12, 0.88);
    const startY = side === 2
      ? -0.12 + edgeNoise
      : side === 3
        ? 1.12 + edgeNoise
        : fromBehind
          ? 0.5 + randomBetween(-0.18, 0.18)
          : randomBetween(0.12, 0.88);
    const radius = size === 'large'
      ? randomBetween(5, 9)
      : size === 'point'
        ? randomBetween(1.2, 2.2)
        : randomBetween(2.8, 4.2);
    const alpha = size === 'large'
      ? randomBetween(0.12, 0.19)
      : size === 'point'
        ? randomBetween(0.45, 0.7)
        : randomBetween(0.25, 0.4);

    return {
      side,
      size,
      startX,
      startY,
      targetX: fromBehind ? randomBetween(0.24, 0.76) : randomBetween(0.08, 0.92),
      targetY: fromBehind ? randomBetween(0.24, 0.76) : randomBetween(0.1, 0.9),
      speed: randomBetween(0.78, 1.28),
      radius,
      alpha,
      driftX: randomBetween(-0.2, 0.2),
      driftY: randomBetween(-0.16, 0.16),
      offsetSeed: Math.random(),
      blurPhase: Math.random() * Math.PI * 2,
      // Distribuzione stratificata con jitter: riempie l'intera Works senza
      // formare una griglia riconoscibile davanti alle card. I passi sono
      // proporzionali al conteggio, quindi il volume resta entro viewport.
      workX: 0.12 + (index % FOREGROUND_WORK_COLUMNS) * workStepX +
        randomBetween(-0.035, 0.035),
      workY: 0.16 + Math.floor(index / FOREGROUND_WORK_COLUMNS) * workStepY +
        randomBetween(-0.04, 0.04),
      workPhase: Math.random() * Math.PI * 2,
    };
  });
};

export default function ParticleNebulaCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const foregroundCanvasRef = useRef<HTMLCanvasElement>(null);
  // Terza tela: i razzi. Sta su una tela a se' perche' il foreground usa
  // mixBlendMode 'screen' (fatto per i dischi bokeh additivi), che sbiancherebbe
  // i bordi scuri del disegno del razzo. Qui si disegna normalmente.
  const stickerCanvasRef = useRef<HTMLCanvasElement>(null);
  // Stessa sorgente di scroll di tutte le altre scene: la MotionValue alimentata
  // da Lenis. Il canvas non ha più un proprio loop né un listener sullo scroll
  // nativo, quindi non può desincronizzarsi dalle card o dalla camera.
  const { scrollY: scrollYMotion, subscribeFrame } = useSmoothScroll();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    const foregroundCanvas = foregroundCanvasRef.current;
    const foregroundCtx = foregroundCanvas?.getContext('2d');
    const stickerCanvas = stickerCanvasRef.current;
    const stickerCtx = stickerCanvas?.getContext('2d');
    if (!canvas || !ctx || !foregroundCanvas || !foregroundCtx || !stickerCanvas || !stickerCtx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let image: HTMLImageElement | null = null;
    let particles: Particle[] = [];
    // Razzi: rotte autonome campionate sullo stesso clock del renderer, e
    // sprite rasterizzate una volta sola (niente path ricostruiti per frame).
    let rockets: StickerRocket[] = createStickerRockets(0);
    // Armato quando l utente e dentro l hero: al varco si forzano rotte
    // fresche, cosi i due razzi stanno entrando proprio in quel momento.
    let heroArmed = false;
    // Una sprite per ogni tinta della palette: i razzi rirotano a ogni volo, e
    // senza la sprite corrispondente il razzo non verrebbe disegnato. Il tipo
    // e' StickerTint, quindi se un domani si aggiunge una tinta l'errore arriva
    // qui invece di lasciare un razzo invisibile.
    const rocketSprites: Record<StickerTint, HTMLCanvasElement | null> = {
      yellow: createRocketSprite('yellow'),
      pink: createRocketSprite('pink'),
      violet: createRocketSprite('violet'),
      orchid: createRocketSprite('orchid'),
      amber: createRocketSprite('amber'),
    };
    // Origine del campionamento: il CENTRO del ritratto. Le coordinate world
    // sono espresse rispetto a questo punto, non al centro della viewport: cosi'
    // la sagoma e' "seduta" sull'SVG. Lo spostamento al centro e' un offset
    // separato applicato al disegno (shapeShift), e non finisce dentro i dati.
    // Se fosse il contrario, l'offset verrebbe contato due volte e la sagoma
    // finirebbe fuori centro.
    let buildOriginX = 0;
    let buildOriginY = 0;
    let frameId: number | null = null;
    let lastRenderedScrollY = Number.NaN;
    let disposed = false;
    // `reducedMotion` arriva da `@/lib/motionPreference`: e' la stessa lettura
    // che fanno la sequenza, lo scramble e i magneti, letta una volta sola.
    // Con movimento ridotto il canvas smette di ridipingere quando lo scroll non
    // si muove, e i razzi ambient finiscono per esistere senza mai essere
    // dipinti: il gate li rilascia una volta sola, e quel frame capita per
    // forza mentre lo scroll e' fermo. Si tiene il tempo in cui il gate e'
    // appena aperto e per un breve periodo si continua a ridipingere, cosi' i
    // razzi entrano davvero e poi il layer congela come tutto il resto. La
    // finestra e' corta e non si ripete: il risparmio di frame che il
    // movimento ridotto porta non viene perso, solo spostato di qualche secondo.
    let ambientOpenedAt = ambientRocketsAllowed() ? performance.now() : null;
    const foregroundParticles = createForegroundParticles();
    const bokehSprites = createBokehSprites();

    const heroSection = document.querySelector<HTMLElement>('[data-scene="hero"]');
    const nebulaSection = document.querySelector<HTMLElement>('[data-scene="nebula"]');
    const worksSection = document.querySelector<HTMLElement>('[data-scene="works"]');
    const contactSection = document.querySelector<HTMLElement>('[data-scene="contact"]');
    const particleSprite = document.createElement('canvas');
    const particleSpriteSize = 48;
    particleSprite.width = particleSpriteSize;
    particleSprite.height = particleSpriteSize;
    const particleSpriteCtx = particleSprite.getContext('2d');
    if (particleSpriteCtx) {
      particleSpriteCtx.fillStyle = paletteRgb('pink');
      particleSpriteCtx.beginPath();
      particleSpriteCtx.arc(particleSpriteSize / 2, particleSpriteSize / 2, 22, 0, Math.PI * 2);
      particleSpriteCtx.fill();
    }

    // Geometria del ritratto. La fonte primaria e' la geometria di RIPOSO
    // pubblicata da HeroScene: e' l'unica copia del fatto, quindi non puo'
    // divergere dall'SVG. Il fallback con le costanti serve solo nei primi
    // frame, prima che HeroScene abbia pubblicato qualcosa.
    // x/y sono il CENTRO a riposo, non il bordo.
    const getPortrait = () => {
      const published = readPortraitGeometry();
      if (published && published.width > 0 && published.height > 0) {
        return published;
      }
      const portraitHeight = Math.min(
        (HERO_PORTRAIT_HEIGHT_VH / 100) * height,
        HERO_PORTRAIT_HEIGHT_PX,
      );
      const portraitWidth = Math.min(
        portraitHeight * getPortraitAspect(),
        width * 0.48,
      );
      return {
        x: (width - portraitWidth) / 2,
        y: (height - portraitHeight) / 2,
        width: portraitWidth,
        height: portraitHeight,
      };
    };

    // IL RECT REALE DELL'AVATAR.
    //
    // La sagoma deve nascere DOVE STA l'SVG e alla SUA scala, quindi serve il
    // rettangolo reale, non una costante: `getBoundingClientRect` sul nodo
    // dell'avatar, letto dal vivo. E' anche il posto giusto per il fallback —
    // se il nodo non c'e' (primi frame, o un layout senza ritratto) si ricade
    // sulla geometria pubblicata da HeroScene, che a sua volta ha un proprio
    // fallback a costanti. Nessun px scritto a mano: la posizione segue il DOM.
    const readAvatarRect = (): { x: number; y: number; width: number; height: number } => {
      // Si cercano TUTTE le istanze e si prende la prima con un rettangolo
      // reale, non la prima che esiste nel DOM.
      //
      // Il nodo nascosto esiste comunque: su mobile l'istanza desktop e' in
      // `display: none`, quindi `querySelector` la trova e restituisce un rect a
      // zero. Con il solo `??` — che scatta solo quando il nodo non esiste — la
      // sagoma leggeva quel rect vuoto e non passava MAI all'istanza mobile, che
      // e' quella visibile: il fallback finiva sulla geometria pubblicata, che
      // descrive l'altra colonna. Risultato misurato: su 390x844 la sagoma nasceva
      // a (35, 97) invece che a (195, 422), cioe' 160px a sinistra e 325px in
      // alto rispetto all'avatar, mentre su desktop e 1512 era corretta.
      for (const node of document.querySelectorAll<HTMLElement>('[data-face-host]')) {
        const box = node.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }
      }
      const published = readPortraitGeometry();
      if (published && published.width > 0 && published.height > 0) {
        // `published.x/y` sono il CENTRO a riposo: si riportano al bordo perche'
        // il chiamante lavora con un rect in stile DOM.
        return {
          x: published.x - published.width / 2,
          y: published.y - published.height / 2,
          width: published.width,
          height: published.height,
        };
      }
      return { x: 0, y: 0, width: 0, height: 0 };
    };

    const makeParticle = (
      index: number,
      x: number,
      y: number,
      brightness: number,
    ): Particle => {
      const isDeep = hash01(index * 4.91 + 1.7) < DEEP_PARTICLE_RATIO;
      const depthNoise = hash01(index * 7.13 + 6.2);
      const z = isDeep
        ? 3600 + depthNoise * 4000
        : 650 + depthNoise * 3550;
      const startPerspective = FOCAL_LENGTH / (FOCAL_LENGTH + z);
      const baseRadius = isDeep
        ? 0.3 + hash01(index * 3.71 + 2.4) * 0.38
        : 0.58 + brightness / 510 + hash01(index * 5.17 + 8.1) * 0.7;
      // La dimensione è personale: durante il viaggio Z ogni particella
      // ingrandisce diversamente, evitando l'effetto "stampo" di una griglia.
      const sizeScale = isDeep
        ? 0.72 + hash01(index * 11.73 + 9.8) * 0.72
        : 0.55 + hash01(index * 11.73 + 9.8) * 1.12;
      const flowSeed = hash01(index * 2.17 + 5.4);
      const pointLike = hash01(index * 14.31 + 5.7) < POINT_LIKE_RATIO;
      return {
        worldX: (x - buildOriginX) / startPerspective,
        worldY: (y - buildOriginY) / startPerspective,
        z,
        radius: (baseRadius * sizeScale) / startPerspective,
        alpha: pointLike
          ? 0.94 + hash01(index * 15.91 + 2.1) * 0.06
          : isDeep
            ? 0.2 + hash01(index * 8.37 + 4.8) * 0.18
            : 0.46 + hash01(index * 2.87 + 3.5) * 0.36,
        layer: isDeep ? 'deep' : 'medium',
        sizeScale,
        flowSeed,
        driftX: (hash01(index * 4.33 + 1.1) - 0.5) * 2,
        driftY: (hash01(index * 6.19 + 3.6) - 0.5) * 2,
        autonomousPhaseX: hash01(index * 3.17 + 8.9) * Math.PI * 2,
        autonomousPhaseY: hash01(index * 5.41 + 4.3) * Math.PI * 2,
        autonomousPhaseZ: hash01(index * 7.83 + 6.7) * Math.PI * 2,
        autonomousSpeedX: 0.32 + hash01(index * 8.73 + 1.8) * 0.76,
        autonomousSpeedY: 0.3 + hash01(index * 9.61 + 7.2) * 0.8,
        autonomousSpeedZ: (0.24 + hash01(index * 10.27 + 3.9) * 0.62) *
          AUTONOMOUS_Z_SPEED_MULTIPLIER,
        autonomousAmplitude: 3.2 + hash01(index * 10.83 + 2.6) * 5.8,
        autonomousAmplitudeZ: (3.2 + hash01(index * 10.83 + 2.6) * 5.8) *
          AUTONOMOUS_Z_AMPLITUDE_MULTIPLIER,
        releaseSeed: hash01(index * 12.19 + 9.4),
        pointLike,
      };
    };

    const buildFallbackParticles = () => {
      const portrait = getPortrait();
      // portrait.x/y sono gia' il CENTRO a riposo, quindi l'origine coincide
      // con loro: niente meta' dimensione da sommare.
      buildOriginX = portrait.x;
      buildOriginY = portrait.y;
      particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
        const angle = (index / PARTICLE_COUNT) * Math.PI * 2;
        const ring = (index % 60) / 60;
        const x = portrait.x + portrait.width * (Math.cos(angle * 7) * (0.22 + ring * 0.25));
        const y = portrait.y + portrait.height * (Math.sin(angle * 5) * (0.3 + ring * 0.18));
        return makeParticle(index, x, y, 210);
      });
    };

    const buildParticles = () => {
      if (!width || !height) return;
      if (!image) {
        buildFallbackParticles();
        return;
      }

      const portrait = getPortrait();
      buildOriginX = portrait.x;
      buildOriginY = portrait.y;
      const sample = document.createElement('canvas');
      // Il raster conserva il rapporto d'aspetto REALE del file: disegnare
      // l'SVG in un raster di forma fissa lo stirerebbe, e la sagoma delle
      // particelle smetterebbe di combaciare con il ritratto che copre.
      // Il lato lungo e' normalizzato a 160px: abbastanza risoluzione per i
      // contorni sottili, e il costo di campionamento resta una tantum.
      const srcW = image.naturalWidth || 258;
      const srcH = image.naturalHeight || 332;
      if (srcW >= srcH) {
        sample.width = SAMPLE_LONG_EDGE_PX;
        sample.height = Math.max(1, Math.round((srcH / srcW) * SAMPLE_LONG_EDGE_PX));
      } else {
        sample.height = SAMPLE_LONG_EDGE_PX;
        sample.width = Math.max(1, Math.round((srcW / srcH) * SAMPLE_LONG_EDGE_PX));
      }
      const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
      if (!sampleCtx) {
        buildFallbackParticles();
        return;
      }
      sampleCtx.clearRect(0, 0, sample.width, sample.height);
      sampleCtx.drawImage(image, 0, 0, sample.width, sample.height);

      let pixels: Uint8ClampedArray;
      try {
        pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;
      } catch {
        buildFallbackParticles();
        return;
      }

      const opaquePixels: Array<{ x: number; y: number; brightness: number }> = [];
      for (let sy = 0; sy < sample.height; sy += 1) {
        for (let sx = 0; sx < sample.width; sx += 1) {
          const pixelIndex = (sy * sample.width + sx) * 4;
          if (pixels[pixelIndex + 3] <= 24) continue;
          opaquePixels.push({
            x: sx,
            y: sy,
            brightness:
              (pixels[pixelIndex] + pixels[pixelIndex + 1] + pixels[pixelIndex + 2]) / 3,
          });
        }
      }
      if (!opaquePixels.length) {
        buildFallbackParticles();
        return;
      }

      particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
        // Distribuzione pseudo-casuale ma riproducibile: con 4750 particelle
        // non si ripete sempre lo stesso passo sul catalogo dei pixel SVG.
        const source = opaquePixels[
          Math.floor(hash01(index * 2.17 + 5.4) * opaquePixels.length)
        ];
        const jitterX = hash01(index * 13.17 + 4.2) - 0.5;
        const jitterY = hash01(index * 19.31 + 7.8) - 0.5;
        // portrait.x/y sono il CENTRO a riposo, quindi il campione va
        // ricentrato sul box: -0.5 riporta la frazione [0,1] sul box centrato
        // invece che ancorato al bordo sinistro.
        const x = portrait.x + ((source.x + jitterX) / sample.width - 0.5) * portrait.width;
        const y = portrait.y + ((source.y + jitterY) / sample.height - 0.5) * portrait.height;
        return makeParticle(index, x, y, source.brightness);
      });
    };

    const drawForeground = (
      scrollY: number,
      journeyLength: number,
      worksTop: number,
      contactTop: number,
      elapsedSeconds: number,
      autonomyStrength: number,
    ) => {
      foregroundCtx.clearRect(0, 0, width, height);
      // Il foreground mantiene il suo anchor condiviso; le sorgenti delle
      // card hanno un reveal dedicato, leggermente più anticipato in ProjectsScene.
      const entranceStart = worksTop - journeyLength * (1 - CARD_REVEAL_RATIO);
      const entranceEnd = entranceStart + journeyLength * 0.12;
      const entrance = smoothstep(phase(scrollY, entranceStart, entranceEnd));
      const exit = 1 - smoothstep(
        phase(scrollY, contactTop - height * 0.2, contactTop + height * 0.08),
      );
      const strength = entrance * exit;
      if (strength <= 0.001) return;

      foregroundCtx.save();
      foregroundCtx.globalCompositeOperation = 'screen';

      foregroundParticles.forEach((particle) => {
        // L'ingresso è scroll-driven; dopo il Works il moto locale resta
        // autonomo e leggero, così le 25 particelle accompagnano la griglia.
        const travel = Math.max(0, scrollY - entranceStart);
        const cycle = (
          particle.offsetSeed + travel / Math.max(900, journeyLength) * particle.speed
        ) % 1;
        const fromX = particle.side === 0
          ? -0.14
          : particle.side === 1
            ? 1.14
            : particle.startX;
        const fromY = particle.side === 2
          ? -0.14
          : particle.side === 3
            ? 1.14
            : particle.startY;
        const entry = smoothstep(clamp01(cycle / 0.32));
        const drift = Math.max(0, cycle - 0.32) / 0.68;
        const pathX = width * (
          lerp(fromX, particle.targetX, entry) + particle.driftX * drift +
          Math.sin(elapsedSeconds * particle.speed * 0.8 + particle.blurPhase) *
            0.008 * autonomyStrength
        );
        const pathY = height * (
          lerp(fromY, particle.targetY, entry) + particle.driftY * drift +
          Math.cos(elapsedSeconds * particle.speed * 0.65 + particle.blurPhase * 0.7) *
            0.006 * autonomyStrength
        );

        // Ogni foreground particle trova una posizione interna alla Works.
        // Il blend è completo al Works stop, quindi nessuna delle 25 può
        // sparire sul bordo proprio quando la griglia è pronta.
        const worksPresence = smoothstep(
          phase(scrollY, entranceStart, worksTop - 8),
        );
        const workDriftX = Math.sin(
          elapsedSeconds * particle.speed * 0.55 + particle.workPhase,
        ) * 0.012;
        const workDriftY = Math.cos(
          elapsedSeconds * particle.speed * 0.47 + particle.workPhase * 0.73,
        ) * 0.01;
        const workX = width * (particle.workX + workDriftX);
        const workY = height * (particle.workY + workDriftY);
        const x = lerp(pathX, workX, worksPresence);
        const y = lerp(pathY, workY, worksPresence);

        const edgeFade = lerp(
          clamp01(Math.min(cycle, 1 - cycle) * 12),
          1,
          worksPresence,
        );
        const blurWave = 0.5 + 0.5 * Math.sin(cycle * Math.PI * 2 + particle.blurPhase);
        const opticalRadius = particle.side === 4
          ? particle.radius * lerp(0.28, 1, entry)
          : particle.radius;
        const alpha = particle.alpha * strength * edgeFade;
        if (alpha <= 0.004) return;

        if (particle.size === 'point') {
          // Sei nuclei compatti: non dischi di bokeh, ma punti luminosi con
          // un alone minimo che restano leggibili davanti alle card.
          const pointRadius = Math.max(0.9, Math.min(2.4, opticalRadius));
          foregroundCtx.globalAlpha = Math.min(0.96, alpha * 1.12);
          foregroundCtx.drawImage(
            particleSprite,
            x - pointRadius,
            y - pointRadius,
            pointRadius * 2,
            pointRadius * 2,
          );
          return;
        }

        // I dischi grandi restano morbidi; i cinque medi occupano la scala
        // intermedia senza rubare leggibilità al testo.
        const bokehRadius = particle.size === 'medium'
          ? Math.min(12, opticalRadius * 0.85 + 1.5 + blurWave * 1.5)
          : Math.min(
            FOREGROUND_BOKEH_MAX_RADIUS,
            opticalRadius * 1.2 + 6 + blurWave * 7,
          );
        const bokehKind: BokehSpriteKind = particle.side === 4
          ? 'near'
          : blurWave > 0.66 ? 'soft' : 'near';
        foregroundCtx.globalAlpha = Math.min(0.96, alpha * BOKEH_ALPHA_BOOST);
        foregroundCtx.drawImage(
          bokehSprites[bokehKind],
          x - bokehRadius,
          y - bokehRadius,
          bokehRadius * 2,
          bokehRadius * 2,
        );
      });

      foregroundCtx.restore();
      foregroundCtx.filter = 'none';
      foregroundCtx.globalAlpha = 1;
    };

    /**
     * Navicelle 3D: condividono con le particelle proiezione e Circle of
     * Confusion, quindi il bokeh e' quello vero, non un filtro.
     *
     * `flyIntensity` e' una campana: vale 0 all'inizio e alla fine del viaggio Z
     * e 1 a meta'. Fuori dal viaggio l'escursione e' zero, il razzo resta ancorato
     * al piano focale (che e' dove vive la griglia) e appare 2D: e' la chiave
     * dell'impenetrabilita'. Durante la planata si stacca in profondita', prende
     * bokeh reale e pulsa con la camera.
     */
    const drawStickers = (
      time: number,
      cameraProgress: number,
      cameraZ: number,
      focusDistance: number,
      aperture: number,
      scrollY: number,
      heroTop: number,
    ) => {
      stickerCtx.clearRect(0, 0, width, height);
      if (width <= 0 || height <= 0) return;

      rockets = advanceRockets(rockets, time);

      const flyIntensity = Math.sin(cameraProgress * Math.PI);
      // I razzi devono comparire dall'ingresso dell'hero e restare fino in
      // fondo. La soglia e' ancorata all'hero, NON a cameraProgress: la camera
      // parte molto piu' in la', quindi legare la presenza a lei mostrerebbe
      // i razzi gia' nel preloader e li spegnerebbe a meta' del viaggio.
      const presence = clamp01((scrollY - heroTop + height * 0.5) / (height * 0.5));
      // Sync d'ingresso: al varco dell'hero i due razzi prendono rotte
      // fresche, con partenza al bordo. Cosi' sono garantiti in ARRIVO nel
      // momento in cui l'utente entra, invece di poter essere gia' in uscita
      // o fuori campo. Si riarma solo uscendo dall'hero, cosi' rientrare
      // ripete l'effetto.
      if (presence > 0.12 && !heroArmed) {
        rockets = restartRockets(rockets, time);
        heroArmed = true;
      } else if (presence <= 0.02) {
        heroArmed = false;
      }
      if (presence <= 0.01) return;

      rockets.forEach((rocket, index) => {
        const sprite = rocketSprites[rocket.tint];
        if (!sprite) return;
        // Il giallo passa davanti, il rosa dietro. Il dislivello e' pero' legato
        // alla planata: alla Works deve valere ZERO, altrimenti i razzi non
        // sarebbero coplanari alla griglia (CoC ~4.4 = bokeh largo) e potrebbero
        // leggermente scavalcare le card. Solo in viaggio si staccano in z.
        const depthBias = (index === 0 ? 260 : -260) * flyIntensity;
        const frame = sampleRocket(
          rocket,
          time,
          width,
          height,
          FOCAL_LENGTH,
          cameraZ,
          focusDistance,
          aperture,
          flyIntensity,
          FOCUS_TARGET_Z + depthBias,
          STICKER_BASE_HEIGHT_PX,
        );
        if (frame.scale <= 0.5 || frame.alpha <= 0.004) return;

        const alpha = frame.alpha * STICKER_ALPHA * presence;
        const conf = Math.abs(frame.signedCoC);
        // Sotto soglia il CoC non si vede, ma l'oggetto e' in fuoco: si disegna
        // nitido. Sopra, il nucleo si spegne con un alone che si allarga: e'
        // l'approssimazione di un disco di confusione, che un singolo
        // drawImage non puo' produrre.
        const defocus = clamp01((conf - STICKER_FOCUS_THRESHOLD) / 6);
        const drawHeight = frame.scale;
        const drawWidth = drawHeight / ROCKET_ASPECT;

        if (defocus > 0.02) {
          const halo = 1 + defocus * STICKER_HALO_FACTOR;
          stickerCtx.globalAlpha = alpha * 0.22 * defocus;
          stickerCtx.drawImage(
            sprite,
            frame.x - (drawWidth * halo) / 2,
            frame.y - (drawHeight * halo) / 2,
            drawWidth * halo,
            drawHeight * halo,
          );
        }

        stickerCtx.save();
        stickerCtx.translate(frame.x, frame.y);
        stickerCtx.rotate(frame.heading);
        stickerCtx.globalAlpha = alpha * (1 - defocus * 0.72);
        stickerCtx.drawImage(sprite, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        stickerCtx.restore();
      });

      stickerCtx.globalAlpha = 1;
    };

    const render = (time = performance.now()) => {
      if (disposed || !width || !height) return;

      const elapsedSeconds = time * 0.001;

      // Posizione fluida di Lenis: stessa MotionValue usata da header, card e
      // paging. Nessuna lettura di window.scrollY.
      const scrollY = scrollYMotion.get();
      const heroTop = heroSection?.offsetTop ?? 0;
      const nebulaTop = nebulaSection?.offsetTop ?? heroTop;
      const worksTop = worksSection?.offsetTop ?? nebulaTop + height;
      const contactTop = contactSection?.offsetTop ?? worksTop + height;
      // Finestra CONDIVISA con il fade del ritratto: se il rilascio delle
      // particelle e la dissoluzione dell'SVG usassero due finestre diverse, il
      // ritratto svanirebbe mentre i puntini non ci sono ancora.
      const { start: revealStart, end: revealEnd } = portraitRevealWindow(heroTop, nebulaTop);
      const genesis = smoothstep(phase(scrollY, revealStart, revealEnd));
      // La curva mantiene lo STEMPO della dissoluzione, ma evita che i punti piu
      // profondi spariiscano troppo tardi rispetto ai punti in primo piano.
      // Resta rigorosamente annullata prima di revealStart e vale 1 al
      // completo stop NEBULA: e il crossfade fra il ritratto che svanisce e la
      // sagoma di particelle che affiora sotto.
      const revealStrength = Math.pow(genesis, 0.62);
      const journeyLength = Math.max(1, worksTop - nebulaTop);
      const shapeScaleStart = revealEnd;
      const shapeScaleEnd = nebulaTop + journeyLength * SHAPE_SETTLED_RATIO;
      // Appena l'SVG è scomparso, la sagoma ancora ferma si allarga di 1/4.
      // La curva spring è scroll-linked: il picco e il rientro dipendono dai
      // pixel percorsei, quindi l'utente può invertire il gesto senza snap.
      const shapeScaleLinear = phase(scrollY, shapeScaleStart, shapeScaleEnd);
      const shapeScaleProgress = shapeScaleLinear >= 1
        ? 1
        : 1 - (1 + SHAPE_SPRING_DAMPING * shapeScaleLinear) *
          Math.exp(-SHAPE_SPRING_DAMPING * shapeScaleLinear);
      // ── LA CAMERA: PARTE SULL'AVATAR, POI RICENTRA ───────────────────────
      //
      // Il difetto che questo blocco corregge: la scena partiva gia' CENTRATA e
      // alla scala finale, quindi le particelle comparivano al centro dello
      // schermo mentre l'avatar stava a sinistra — un salto visibile fra l'uno e
      // l'altro. Lo spostamento al centro era un offset applicato DOPO, a
      // `recenterLinear`, cioe' cresceva da 0 a 1 durante l'allargamento: la
      // sagoma quindi non era "sull'avatar che svanisce" ma "una nuvola che
      // nasce al centro e si allarga".
      //
      // Ora la camera parte gia' spostata sul ritratto. `cameraOffsetX/Y` e' lo
      // scarto fra il CENTRO DELL'AVATAR e il centro della viewport, e la camera lo
      // applica inizialmente: a progress 0 la sagoma e' esattamente dove sta
      // l'SVG, alla sua scala, e il passaggio avatar → particelle non ha salti.
      // Poi lo scarto va a 0 mentre la scala cresce, e la scena si ricentra con
      // uno zoom verso sinistra — che e' il movimento richiesto, e non piu' uno
      // spostamento secco a meta' percorso.
      //
      // Il centro dell'avatar viene letto dal RECT REALE (`getBoundingClientRect`)
      // del nodo, non da costanti: cosi' la sagoma segue l'avatar anche quando il
      // layout lo sposta (breakpoint, font, larghezza). Il rettangolo e' in
      // coordinate di viewport, che e' lo spazio in cui la camera ragiona.
      const portraitRect = readAvatarRect();
      const avatarCenterX = portraitRect.x + portraitRect.width / 2;
      const avatarCenterY = portraitRect.y + portraitRect.height / 2;
      // Il delta richiesto: centro avatar MENO centro viewport, su X e Y. La camera
      // lo applica inizialmente, cosi' la sagoma nasce sull'avatar.
      const cameraOffsetX = avatarCenterX - width / 2;
      const cameraOffsetY = avatarCenterY - height / 2;
      // `recenterLinear` adesso guida solo il passaggio "dall'avatar al centro",
      // non l'intera posizione: a 0 la camera e' sull'avatar, a 1 e' centrata.
      // Il ricentraggio e' una funzione del SOLO progress dello scroll: a 0 la
      // camera e' sull'avatar (la sagoma nasce sul disegno), a 1 e' centrata sulla
      // viewport. Easing ease-in-out esplicito con smoothstep: parte lenta,
      // accelera, finisce lenta, quindi il ricentraggio non parte di scatto appena
      // l'SVG sparisce. Non c'e' nessun clock: lo scrub e' gia' il progress.
      // La finestra NON e' piu' quella del ricentraggio: e' la stessa del VOLO
      // dell'avatar, letta da `portraitFlightWindow`. Il parametro `height` non
      // serve piu' e l'argomento e' sparito dalla firma perche' una finestra in
      // quota di viewport non puo' coincidere con una in quota di dissoluzione:
      // e' proprio li' che i due movimenti si disfacevano al ritorno.
      const recenterLinear = shapeRecenterPhase(scrollY, heroTop, nebulaTop);
      const recenterCurve = recenterLinear * recenterLinear * (3 - 2 * recenterLinear);
      // LO SCARTO RESIDUO DEL DISEGNO e' l'INVERSO dello scarto della camera, e va
      // da 0 a `-cameraOffset`.
      //
      // Il centro di partenza e' gia' quello dell'avatar (ogni particella e'
      // disegnata attorno ad `avatarCenterX/Y`), quindi all'inizio non si sposta
      // niente: `shapeShift` e' 0 e la sagoma nasce esattamente sul disegno
      // dell'SVG, alla sua scala, senza salti. Man mano che la camera si ricentra
      // (`recenterCurve` 0 → 1) il disegno slitta della quantita' opposta, cosi'
      // alla fine il centro della sagoma e' quello della viewport:
      // centro avatar + (centro viewport − centro avatar) = centro viewport.
      //
      // Il SEGNO e' la parte che conta, e il commento qui sotto diceva il
      // contrario di quello che il codice faceva: con `+cameraOffset × (1 −
      // curve)` la sagoma partiva da `2 × centro avatar − centro viewport` e
      // finiva ferma sul centro dell'avatar — cioe' non nasceva sull'avatar e non
      // si ricentrava. Il delta richiesto e' proprio l'opposto di quello che
      // veniva sommato.
      const shapeShiftX = -cameraOffsetX * recenterCurve;
      const shapeShiftY = -cameraOffsetY * recenterCurve;
      // La scala: parte a 1 (la scala REALE dell'avatar, perche' le particelle
      // nascono sul suo disegno alla sua dimensione) e cresce fino a riempire il
      // viewport. `SHAPE_SCALE` e' il fattore finale, invariato.
      const shapeScale = 1 + (SHAPE_SCALE - 1) * shapeScaleProgress;
      // Camera Z = funzione lineare esclusiva dello scroll. Non esiste un clock
      // nel renderer e non viene applicato smoothing: scroll fermo => camera ferma.
      const cameraProgress = phase(
        scrollY,
        shapeScaleEnd,
        nebulaTop + journeyLength * CAMERA_SETTLED_RATIO,
      );
      const cameraZ = cameraProgress * CAMERA_TRAVEL_Z;
      // La polvere cosmica comincia a vibrare quando comincia l'allargamento
      // della sagoma, quindi cresce insieme alla preparazione e alla camera.
      // Le traiettorie sono funzioni deterministiche dei pixel di scroll:
      // nessun clock, nessuna memoria temporale, reversal perfetto.
      const flowStrength = smoothstep(
        phase(scrollY, shapeScaleStart, shapeScaleEnd + journeyLength * 0.12),
      );
      const flowClock = Math.max(0, scrollY - shapeScaleStart) / Math.max(1, height);
      // Il DOF entra dopo l'allargamento della sagoma, così il reveal resta
      // leggibile. Il piano focale si sposta con la camera: non viene usato
      // alcun clock, solo la geometria corrente del renderer.
      const bokehStrength = smoothstep(
        phase(scrollY, shapeScaleEnd, shapeScaleEnd + journeyLength * 0.18),
      );
      // Autofocus: il piano insegue una fascia centrale della nuvola.
      // Nella coda lo stop-down riduce l'apertura, aumentando la profondità
      // di campo senza creare un salto di fuoco.
      const focusDistance = FOCAL_LENGTH + FOCUS_TARGET_Z - cameraZ;
      const focusAperture = lerp(
        FOCUS_APERTURE_START,
        FOCUS_APERTURE_END,
        smoothstep(phase(scrollY, shapeScaleEnd, shapeScaleEnd + journeyLength * FOCUS_APERTURE_END_PROGRESS)),
      );
      // Il tetto del disco bokeh si riapre mentre la camera si ferma: stretto
      // durante il viaggio (nessun accumulo di inchiostro nel picco), pieno
      // allo stop Works per restituire profondità alla griglia.
      const nebulaBokehMaxRadius = lerp(
        NEBULA_BOKEH_MAX_RADIUS,
        BOKEH_MAX_RADIUS,
        cameraProgress,
      );
      // Le particelle entrano nel renderer mentre il reveal è già in corso:
      // moto X/Y/Z e point-like trail sono quindi contemporanei, non fasi
      // successive. Dopo il reveal l'intensità resta stabile e cresce con Z.
      const autonomyStrength = reducedMotion
        ? 0
        : smoothstep(phase(scrollY, revealStart, revealEnd)) *
          (AUTONOMOUS_BASE_GAIN + cameraProgress * AUTONOMOUS_CAMERA_GAIN);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = paletteRgb('canvas');
      ctx.fillRect(0, 0, width, height);
      ctx.filter = 'none';
      ctx.fillStyle = paletteRgb('pink');
      foregroundCtx.clearRect(0, 0, width, height);

      if (revealStrength > 0.001) {
        for (const particle of particles) {
          const autonomousX = Math.sin(
            elapsedSeconds * particle.autonomousSpeedX + particle.autonomousPhaseX,
          ) * particle.autonomousAmplitude * autonomyStrength;
          const autonomousY = Math.cos(
            elapsedSeconds * particle.autonomousSpeedY + particle.autonomousPhaseY,
          ) * particle.autonomousAmplitude * autonomyStrength;
          const autonomousZ = Math.sin(
            elapsedSeconds * particle.autonomousSpeedZ + particle.autonomousPhaseZ,
          ) * particle.autonomousAmplitudeZ * autonomyStrength;
          const particleZ = Math.max(
            particle.z + autonomousZ,
            cameraZ + FOCAL_LENGTH * 0.35,
          );
          const denominator = FOCAL_LENGTH + particleZ - cameraZ;
          if (denominator <= FOCAL_LENGTH * 0.1) continue;
          const perspective = FOCAL_LENGTH / denominator;
          const flowFrequency = 1.8 + particle.flowSeed * 3.4;
          const flowPhase = flowClock * flowFrequency + particle.flowSeed * Math.PI * 2;
          // worldX/worldY sono coordinate world-space: questi valori devono
          // essere molto più grandi di 1px per creare una vibrazione visibile.
          const flowAmplitude = flowStrength * (particle.layer === 'deep' ? 18 : 34);
          const flowX = (
            Math.sin(flowPhase + particle.driftY * 1.7) * 0.72 +
            Math.sin(flowPhase * 0.47 + particle.driftX * 2.1) * 0.28
          ) * flowAmplitude;
          const flowY = (
            Math.cos(flowPhase * 0.83 + particle.driftX * 1.4) * 0.72 +
            Math.cos(flowPhase * 0.61 + particle.driftY * 2.4) * 0.28
          ) * flowAmplitude;
          const worldX = particle.worldX + flowX + autonomousX;
          const worldY = particle.worldY + flowY + autonomousY;
          // Il centro di partenza e' quello dell'AVATAR e resta tale finche' la
          // camera non ricentra: per questo qui si somma solo lo scarto residuo
          // `shapeShift`, che a progress 0 e' 0 — la sagoma e' gia' sull'SVG, alla
          // sua scala — e a fine percorso vale il delta richiesto, cioe' il
          // ricentraggio. Nessun ricalcolo delle particelle: cambiano solo i due
          // numeri della camera, quindi il costo per frame e' lo stesso.
          const x = avatarCenterX + shapeShiftX + worldX * perspective * shapeScale;
          const y = avatarCenterY + shapeShiftY + worldY * perspective * shapeScale;
          const radius = particle.radius * perspective * shapeScale;
          // Una particella resta a fuoco finché non viene rilasciata dalla
          // sagoma. Il seed distribuisce il rilascio durante il viaggio Z.
          const releaseProgress = smoothstep(clamp01(
            (cameraProgress - 0.08 - particle.releaseSeed * 0.28) / 0.72,
          ));
          const particleBokeh = releaseProgress * bokehStrength;
          // Circle of Confusion: la distanza dal piano focale produce un
          // disco più grande, con segno near/far solo per scegliere il kernel.
          const signedCoC =
            ((denominator - focusDistance) / Math.max(denominator, 1)) * focusAperture;
          const bokehRadius = Math.min(
            nebulaBokehMaxRadius,
            Math.max(radius, Math.abs(signedCoC) * particleBokeh),
          );
          const useBokeh = particleBokeh > 0.001 && Math.abs(signedCoC) > FOCUS_THRESHOLD;
          // Conservazione del flusso: solo i dischi dilatati perdono alpha,
          // quelli del fondale Works (e i puntini della sagoma) restano pieni.
          const fluxDamp = Math.pow(
            Math.min(1, BOKEH_FLUX_REFERENCE_RADIUS / Math.max(bokehRadius, 1)),
            BOKEH_FLUX_FALLOFF,
          );
          const padding = bokehRadius + 2;
          if (
            x < -padding ||
            x > width + padding ||
            y < -padding ||
            y > height + padding
          ) continue;

          const approachFade = smoothstep(
            clamp01(
              (denominator - FOCAL_LENGTH * 0.1) / (FOCAL_LENGTH * 0.45),
            ),
          );
          const alpha = Math.min(
            particle.pointLike ? 1 : 0.86,
            particle.alpha * revealStrength * (1 - cameraProgress * 0.1) *
              approachFade * fluxDamp,
          );
          if (alpha <= 0.008) continue;

          ctx.globalAlpha = useBokeh
            ? Math.min(0.96, alpha * BOKEH_ALPHA_BOOST)
            : alpha;
          if (particle.pointLike) {
            // Point-like e scia condividono lo stesso modello ottico: la
            // particella resta nitida finché è a fuoco, poi diventa bokeh.
            const pointRadius = Math.max(0.65, Math.min(1.8, radius * 0.72));
            // Scia analitica: nessun buffer di posizioni, solo tre campioni
            // del passato della stessa traiettoria X/Y/Z.
            for (let trailIndex = 0; trailIndex < POINT_TRAIL_DELAYS.length; trailIndex += 1) {
              const sampleTime = elapsedSeconds - POINT_TRAIL_DELAYS[trailIndex];
              const sampleAutonomousX = Math.sin(
                sampleTime * particle.autonomousSpeedX + particle.autonomousPhaseX,
              ) * particle.autonomousAmplitude * autonomyStrength;
              const sampleAutonomousY = Math.cos(
                sampleTime * particle.autonomousSpeedY + particle.autonomousPhaseY,
              ) * particle.autonomousAmplitude * autonomyStrength;
              const sampleAutonomousZ = Math.sin(
                sampleTime * particle.autonomousSpeedZ + particle.autonomousPhaseZ,
              ) * particle.autonomousAmplitudeZ * autonomyStrength;
              const sampleZ = Math.max(
                particle.z + sampleAutonomousZ,
                cameraZ + FOCAL_LENGTH * 0.35,
              );
              const sampleDenominator = FOCAL_LENGTH + sampleZ - cameraZ;
              if (sampleDenominator <= FOCAL_LENGTH * 0.1) continue;
              const samplePerspective = FOCAL_LENGTH / sampleDenominator;
              // Stessa origine del nucleo, altrimenti la scia si staccherebbe
              // dalla particella che la genera durante il ricentraggio: qui il
              // centro e' quello dell'avatar piu' lo scarto residuo, identico
              // al calcolo sopra e per le stesse ragioni.
              const sampleX = avatarCenterX + shapeShiftX + (
                particle.worldX + flowX + sampleAutonomousX
              ) * samplePerspective * shapeScale;
              const sampleY = avatarCenterY + shapeShiftY + (
                particle.worldY + flowY + sampleAutonomousY
              ) * samplePerspective * shapeScale;
              const sampleRadius = particle.radius * samplePerspective * shapeScale;
              const sampleSignedCoC =
                ((sampleDenominator - focusDistance) / Math.max(sampleDenominator, 1)) *
                focusAperture;
              const sampleBokehRadius = Math.min(
                nebulaBokehMaxRadius,
                Math.max(sampleRadius, Math.abs(sampleSignedCoC) * particleBokeh),
              );
              const sampleUseBokeh = particleBokeh > 0.001 && Math.abs(sampleSignedCoC) > FOCUS_THRESHOLD;
              const samplePadding = sampleBokehRadius + 2;
              if (
                sampleX < -samplePadding ||
                sampleX > width + samplePadding ||
                sampleY < -samplePadding ||
                sampleY > height + samplePadding
              ) continue;
              const sampleApproachFade = smoothstep(
                clamp01((sampleDenominator - FOCAL_LENGTH * 0.1) / (FOCAL_LENGTH * 0.45)),
              );
              const sampleAlpha = Math.min(
                particle.pointLike ? 1 : 0.86,
                particle.alpha * revealStrength * (1 - cameraProgress * 0.1) *
                  sampleApproachFade * fluxDamp *
                  POINT_TRAIL_OPACITIES[trailIndex],
              );
              if (sampleAlpha <= 0.002) continue;
              if (sampleUseBokeh) {
                const sampleKind: BokehSpriteKind = sampleSignedCoC < 0 ? 'near' : 'far';
                ctx.globalAlpha = Math.min(0.96, sampleAlpha * BOKEH_ALPHA_BOOST);
                ctx.drawImage(
                  bokehSprites[sampleKind],
                  sampleX - sampleBokehRadius,
                  sampleY - sampleBokehRadius,
                  sampleBokehRadius * 2,
                  sampleBokehRadius * 2,
                );
              } else {
                const samplePointRadius = Math.max(0.45, Math.min(1.35, sampleRadius * 0.56));
                ctx.globalAlpha = sampleAlpha;
                ctx.fillStyle = paletteRgb('pink');
                ctx.fillRect(
                  sampleX - samplePointRadius / 2,
                  sampleY - samplePointRadius / 2,
                  samplePointRadius,
                  samplePointRadius,
                );
              }
            }
            if (useBokeh) {
              const trailKind: BokehSpriteKind = signedCoC < 0 ? 'near' : 'far';
              ctx.globalAlpha = Math.min(0.96, alpha * BOKEH_ALPHA_BOOST);
              ctx.drawImage(
                bokehSprites[trailKind],
                x - bokehRadius,
                y - bokehRadius,
                bokehRadius * 2,
                bokehRadius * 2,
              );
            } else {
              ctx.globalAlpha = alpha;
              ctx.fillStyle = paletteRgb('pink');
              ctx.fillRect(
                x - pointRadius / 2,
                y - pointRadius / 2,
                pointRadius,
                pointRadius,
              );
            }
          } else if (useBokeh) {
            const bokehKind: BokehSpriteKind = signedCoC < 0 ? 'near' : 'far';
            ctx.drawImage(
              bokehSprites[bokehKind],
              x - bokehRadius,
              y - bokehRadius,
              bokehRadius * 2,
              bokehRadius * 2,
            );
          } else if (particle.layer === 'deep') {
            // La polvere profonda resta minuscola ma conserva una piccola
            // variazione di diametro, anche durante l'avvicinamento.
            // Nessun cap superiore: durante l'avvicinamento la polvere
            // profonda mantiene diametri diversi, senza diventare una griglia
            // di punti identici.
            const dot = Math.max(0.38, radius * 0.82);
            ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
          } else if (particleSpriteCtx) {
            const diameter = radius * 2;
            ctx.drawImage(particleSprite, x - radius, y - radius, diameter, diameter);
          }
        }
      }

      ctx.globalAlpha = 1;
      drawForeground(
        scrollY,
        journeyLength,
        worksTop,
        contactTop,
        elapsedSeconds,
        autonomyStrength,
      );
      drawStickers(
        time,
        cameraProgress,
        cameraZ,
        focusDistance,
        focusAperture,
        scrollY,
        heroTop,
      );

      // Il disegno è pilotato dal RAF condiviso del provider (più sotto), non da
      // un loop autonomo: camera e particelle non possono disallinearsi.
    };

    // Con reduced-motion non c'è moto autonomo, quindi ridisegniamo solo quando la
    // posizione cambia davvero invece di consumare un frame su 60.
    const renderOnFrame = (time: number) => {
      if (reducedMotion) {
        const open = ambientRocketsAllowed();
        if (open && ambientOpenedAt === null) ambientOpenedAt = time;
        // La finestra di risveglio: finche' e' aperta si ridipinge comunque.
        const waking = ambientOpenedAt !== null && time - ambientOpenedAt < AMBIENT_WAKE_MS;
        if (!waking && lastRenderedScrollY === scrollYMotion.get()) return;
        lastRenderedScrollY = scrollYMotion.get();
        render(time);
        return;
      }
      render(time);
    };

    const scheduleRender = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(renderOnFrame);
    };

    const resize = () => {
      dpr = Math.min(MAX_CANVAS_DPR, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      foregroundCanvas.width = canvas.width;
      foregroundCanvas.height = canvas.height;
      stickerCanvas.width = canvas.width;
      stickerCanvas.height = canvas.height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      foregroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stickerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildParticles();
      scheduleRender();
    };

    const loadImage = () => {
      // Immagine condivisa con HeroScene: cosi' entrambi leggono lo stesso
      // file e ne ricavano lo stesso rapporto d'aspetto, e il campionamento
      // delle particelle non puo' divergere dalla maschera CSS.
      void loadPortraitImage(IMG_URL).then((loaded) => {
        if (disposed) return;
        if (!loaded || !loaded.naturalWidth) {
          // File non caricato: la sagoma resta approssimata, ma la pagina
          // continua a funzionare.
          image = null;
          buildFallbackParticles();
          scheduleRender();
          return;
        }
        image = loaded;
        buildParticles();
        scheduleRender();
      });
    };

    // Un solo listener per il disegno: il RAF condiviso del provider, che ha
    // già fatto avanzare Lenis. Niente listener sullo scroll nativo, altrimenti
    // il canvas verrebbe ridisegnato con la posizione grezza del browser.
    const unsubscribeFrame = subscribeFrame(renderOnFrame);
    window.addEventListener('resize', resize);
    resize();
    loadImage();
    // Un primo disegno anche se il frame non è ancora arrivato.
    scheduleRender();

    return () => {
      disposed = true;
      unsubscribeFrame();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };

  }, [scrollYMotion, subscribeFrame]);

  return (
    <>
      <canvas
        ref={canvasRef}
        data-particle-layer="deep-medium"
        data-medium-blur="0px"
        data-dof="optical-bokeh-sprites"
        data-autonomous-motion="scroll-plus-raf"
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 h-screen w-screen"
      />
      <canvas
        ref={foregroundCanvasRef}
        data-particle-layer="foreground"
        data-foreground-count={FOREGROUND_PARTICLE_COUNT}
        data-foreground-large-count={FOREGROUND_LARGE_PARTICLE_COUNT}
        data-foreground-point-count={FOREGROUND_POINT_PARTICLE_COUNT}
        data-foreground-medium-count={FOREGROUND_MEDIUM_PARTICLE_COUNT}
        data-dof="optical-bokeh-sprites"
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-30 h-screen w-screen"
        style={{ mixBlendMode: 'screen' }}
      />
      {/* Navicelle: sopra la griglia Works (z-10) e sotto i dischi bokeh del
          foreground (z-30), che devono restare il layer ottico piu' vicino. */}
      <canvas
        ref={stickerCanvasRef}
        data-sticker-rockets={ROCKET_COUNT}
        data-sticker-plane={FOCUS_TARGET_Z}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[25] h-screen w-screen"
      />
    </>
  );
}

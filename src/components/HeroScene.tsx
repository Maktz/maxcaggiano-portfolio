import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'framer-motion';
import ScrollHint from './ScrollHint';
import { HEADLINE_ROWS, SUBHEADLINE } from '@/lib/entryCopy';
import * as avatarController from '@/lib/avatarController';
import { unlockScroll } from '@/lib/scrollLock';
import { reducedMotion } from '@/lib/motionPreference';
import {
  HERO_COLUMN_GAP_PX,
  HERO_PORTRAIT_HEIGHT_PX,
  HERO_PORTRAIT_HEIGHT_VH,
  clamp01,
  portraitRevealPhase,
  portraitRevealWindow,
  publishPortraitGeometry,
  readSceneTop,
  shapeRecenterPhase,
  smoothstep,
  viewportPhase,
} from '@/lib/scrollMath';
import {
  IMG_URL,
  PORTRAIT_ASPECT_BOOTSTRAP,
  getPortraitAspect,
  loadPortraitImage,
} from '@/lib/portraitAsset';
import {
  BROW_PATH_INDEXES,
  EYE_PARTS,
  EYE_WHITE_INDEXES,
  MOUTH_LOWER_LIP_INDEX,
  MOUTH_PATH_INDEXES,
  PIERCING_PATH_INDEXES,
  buildPath,
  easedWave,
  flattenNumbers,
  levelSmileCorners,
  lerpPath,
  mouthLoopK,
  pathCenter,
  pathNumbers,
} from '@/lib/faceRig';

// Il ritratto e' mostrato come IMMAGINE, non come maschera: l'SVG porta colori
// propri e vengono rispettati. Usando il canale alfa come maschera su un div
// colorato, quelli sarebbero stati cancellati tutti e il disegno ridotto a un
// blocco unico giallo che poi virava al rosa. Qui l'unica animazione resta
// l'opacita', che e' quella che serve al reveal verso le particelle.
// Il ritratto e' iniettato come SVG INLINE, non referenziato come immagine di
// sfondo. Serve perche' un'immagine e' un disegno piatto: non ha selettori, e
// occhi, sopracciglia e bocca non potrebbero essere animati. Inline, ogni path
// diventa un elemento trasformabile e interpolabile.
//
// I colori sono quelli del file e vengono rispettati: non viene applicato
// nessun colore al contenitore, l'SVG disegna quello che ha.
const SVG_FIT_CLASSES = '[&>svg]:block [&>svg]:h-full [&>svg]:w-full';

// Ritmo della bocca. Non e' un'onda continua: il viso posa su ciascuno dei due
// stati e poi scorre verso l'altro. Le quattro fasi e i loro tempi stanno in
// mouthLoopK, in faceRig: l'apertura occupa meno tempo della chiusura.
const MOUTH_CYCLE_SECONDS = 8.4; // un giro completo: sorriso -> chiuso -> sorriso

// Sguardo e sopracciglia: due oscillazioni con periodi coprimi, cosi' non
// risultano mai periodiche. STAY e' la permanenza su ciascun estremo: e' la
// parte che fa l'occhio "posare" lo sguardo prima di cambiarlo.
const LOOK_PERIOD_A = 6.3;
const LOOK_PERIOD_B = 11.7;
const LOOK_STAY = 0.3;
const BROW_PERIOD_A = 4.7;
const BROW_PERIOD_B = 9.1;
const BROW_STAY = 0.26;

// Dieci particelle puntiformi nella hero, identiche nel linguaggio a quelle
// della nebulosa: nucleo minuscolo e netto, alone minimo, scia di tre campioni
// con opacita' decrescente. Vengono disegnate dentro il rAF del volto, non in
// un loop nuovo: cosi' resta un solo ciclo di rendering per tutta la scena.
const HERO_POINT_COUNT = 20;
const HERO_POINT_TRAIL_DELAYS = [0.05, 0.1, 0.16];
const HERO_POINT_TRAIL_OPACITIES = [0.14, 0.085, 0.045];
const HERO_POINT_TRAVEL_PERIOD = 17.3; // attraversamento orizzontale
const HERO_POINT_TRAVEL_STAY = 0.22;

// Quanto si livella il sorriso nello stato intermedio e quanto si chiude.
// Lo stato di partenza e' una posa DAVVERO a meta' fra bocca chiusa e sorriso:
// non solo gli angoli, ma anche l'apertura. Senza questo sembrerebbe il sorriso.
const MOUTH_HALF_SMILE = 0.85;
const MOUTH_HALF_FLATTEN = 0.55;

// Occhi: quanto resta aperto l'occhio a bocca chiusa. 1 = aperto (stato del
// file). Iride, pupilla e riflesso si rimpiccioliscono con lo stesso fattore,
// altrimenti uscirebbero dal bianco compresso.
const EYE_CLOSED_SCALE = 0.1;

// Sopracciglia: quanto si alzano quando la bocca e' sorridente. Si somma
// all'oscillazione autonoma, che resta indipendente.
const BROW_RAISE = 1.35;

// Labret: quota del movimento del labbro inferiore che il piercing segue, e
// quanto si allunga la pelle. La pelle non percorre quanto il labbro, ma il
// piercing e' ancorato al mento: quando la bocca si chiude sale parecchio.
const PIERCING_FOLLOW = 0.55;
const PIERCING_STRETCH = 0.1;

// Sequenza d'ingresso. All'arrivo dall'hero il viso mostra appena la terza
// posa e subito sorride: la sensazione deve essere "mi ha visto e mi sta
// sorridendo", quindi la posa di attesa e' breve. Parte una volta sola per
// caricamento di pagina: tornare nel preloader non la riapre.
//
// I tre tempi misurati sul DOM (opacita' piena, proiezione della bocca sul
// segmento delle due pose estreme) dicevano: terza posa 288ms, sorriso 2800ms,
// chiusa 960ms. La terza posa esisteva su tutte le viewport, quindi non era un
// bug di logica: e' dieci volte piu' breve del sorriso e l'occhio non la
// registrava come una posa. Il ciclo delle quattro fasi del sorriso copre
// 8.4s, e su quel tempo un lampo da 0.3s non ha peso.
//
// La correzione e' sulla RIPRESA, non sulla posa: si allunga il tempo in cui
// il viso e' gia' arrivato e immobile, cosi' la terza posa smette di essere un
// lampo e diventa una posa, e si accorcia la corsa al sorriso. Il sorriso non
// si allunga: resta il punto di arrivo, e arriva prima.
const INTRO_HOLD_SECONDS = 0.34; // posa di attesa: 0.16 + 0.18 perche' si legga
const INTRO_MOVE_SECONDS = 0.12; // al sorriso, deciso ma rapido
const INTRO_SETTLE_SECONDS = 0.5; // il sorriso si fa vedere

// Frazione di larghezza che il ritratto puo' occupare da solo. Sul desktop il
// blocco e' a due colonne e il testo ne vuole fino al 42%: l'avatar non puo'
// quindi rubare tutta la larghezza o il blocco sborda. Su mobile, dove il
// ritratto e' da solo, il limite e' molto piu' generoso.
const PORTRAIT_MAX_VW_DESKTOP = 46;
const PORTRAIT_MAX_VW_MOBILE = 88;

// L'headline intera per gli screen reader: le tre righe unite, perche' un
// lettore vocale deve sentire una frase e non tre frammenti tagliati dal
// <br>. Vive qui come stringa a se' perche' i tre <span> animati sono
// aria-hidden: se il testo accessibile fosse ricavato da quelli, durante lo
// scramble annuncerebbe i simboli per qualche secondo.
const HEADLINE_ACCESSIBLE = HEADLINE_ROWS.join(' ');

// ─────────────────────────────────────────────────────────────────────────────
// IL RITRATTO CHE DIVENTA LOGO
//
// Il ritratto non sfuma piu': quando il ricentraggio e' quasi finito si stacca e
// vola nella fascia dell'header, come un marchio. Il volo e' a TEMPO e non a
// scroll: lo scroll lo INNESCA e basta, poi il marchio arriva da solo.
//
// Il dato che governa tutto e' questo: il logo NON e' una copia dell'SVG, e' lo
// stesso nodo che sta nell'hero. Non si duplica nulla, quindi il rig del viso
// continua a girare sul marchio (occhi, sopracciglia e boccha vivi anche a
// 50px) e qualsiasi modifica futura all'SVG vale per l'hero e per l'header
// insieme, senza replicare niente in due posti.
//
// Per poterlo spostare senza toccare il layout si agisce sul `transform` del
// contenitore INTERNO (quello che porta l'SVG), mai sul wrapper: il wrapper
// resta un flex item identico, quindi l'h2 non salta. E i `offset*` usati dalla
// geometria pubblicata per la sagoma del canvas sono, per definizione, immuni ai
// transform: la sagoma resta esattamente dove e', senza ricalcoli.
// ─────────────────────────────────────────────────────────────────────────────

// Quanti px PRIMA del completamento del ricentraggio il ritratto si stacca.
// Sono i "pochi pixel" richiesti: piu' piccoli e il marchio si stacca mentre la
// sagoma sta ancora completando gli ultimi pixel (si vede il doppio profilo),
// piu' grandi e il distacco si legge come un ritardo.
const PORTRAIT_LOGO_LEAD_PX = 4;
// Quota dell'altezza dell'header occupata dal marchio. 54% di 96px = 52px: resta
// aria sopra e sotto, e il rapporto col nome della sezione resta quello di un
// logo, non quello di un'icona.
const PORTRAIT_LOGO_HEIGHT_RATIO = 0.54;
// Allineamento a sinistra: il marchio sta sul FILO della pagina, lo stesso
// della telemetria in basso a sinistra e del blocco geografico in alto a
// destra. Il valore NON e' scritto qui: viene MISURATO dalla telemetria, che il
// browser ha gia' posizionato con `--page-gutter`. Il motivo e' che quel filo e'
// un clamp in vw, quindi cambia con la larghezza: copiarlo qui in px lo
// congelerebbe alla larghezza del primo render e i tre elementi si
// disallineerebbero al primo resize. Sotto md la telemetria e' hidden e non ha
// un rect, e in quel caso si legge la custom property da :root, che a quelle
// larghezze e' gia' il minimo del clamp (24px).
const PORTRAIT_LOGO_FALLBACK_PX = 24;
const measurePageGutter = () => {
  // Sotto md la telemetria e' `hidden` e non ha un rect, quindi non puo' essere
  // il riferimento: e la custom property va letta da un elemento che esiste
  // SEMPRE. Si usa un probe appoggiato a `body` e non visibile, dichiarato con
  // `width: var(--page-gutter)`: il browser lo risolve e il suo rect e' il filo
  // reale, gia' calcolato dal clamp per la larghezza corrente. Leggere
  // `getPropertyValue` non basterebbe: restituisce la formula
  // `clamp(24px, 4.9vw, 88px)` e non il numero, che su `::root` non e' risolto.
  const telemetria = document.querySelector('[data-anchor="telemetry"]');
  const rect = telemetria?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.left > 0) return rect.left;
  let probe = document.getElementById('page-gutter-probe');
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'page-gutter-probe';
    // `position: fixed` con `left: 0` e altezza 0: occupa il filo in orizzontale
    // e non sposta nulla ne' interferisce con i selettori del resto della pagina.
    probe.style.cssText =
      'position:fixed;left:0;top:0;height:0;width:var(--page-gutter);pointer-events:none;';
    document.body.appendChild(probe);
  }
  const larghezza = probe.getBoundingClientRect().width;
  return larghezza > 0 ? larghezza : PORTRAIT_LOGO_FALLBACK_PX;
};
// Il tetto dell'header e' a z-50, quindi il marchio deve stare sopra: ma solo
// quando e' ormai piccolo. Finche' il ritratto e' grande deve restare sotto le
// navicelle (z-25) e la nebulosa in primo piano (z-30), come adesso.
const PORTRAIT_LOGO_Z_INDEX = 60;
const PORTRAIT_LOGO_Z_LIFT = 0.02;
// Uscita decisa (ease-out expo: partenza netta, posata lunga) e rientro piu'
// morbido, perche' il ritorno avviene mentre l'h2 sta riaccendendo e non deve
//UMBERlo coprire.
const PORTRAIT_LOGO_FLY_SECONDS = 0.9;
const PORTRAIT_LOGO_RETURN_SECONDS = 0.55;
const PORTRAIT_LOGO_EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Layer radice in cui il ritratto viene spostato quando parte.
 *
 * Finche' il nodo sta dentro la sezione hero, il suo `z-index` vale solo rispetto
 * ai FRATELLI: la sezione non crea un contesto di impilamento, ma la colonna
 * editoriale che lo contiene e' `position: fixed`, e in Chrome un elemento fixed
 * ne crea uno. Quindi `z-60` non bastava a farlo emergere sopra l'header
 * (z-50, con sfondo opaco): misurato, il marchio era al posto giusto
 * (24, 22.1) ma completamente coperto.
 *
 * Il layer e' figlio diretto di `body`, quindi fuori da ogni contesto della
 * pagina, e i suoi figli competono davvero con l'header. Non viene creato a mano
 * nel markup perche' deve esistere gia' al primo render, quando il trigger
 * potrebbe gia' essere scattato.
 */
const PORTRAIT_LOGO_LAYER_ID = 'portrait-logo-layer';

const ensureLogoLayer = () => {
  const existing = document.getElementById(PORTRAIT_LOGO_LAYER_ID);
  if (existing) return existing as HTMLDivElement;
  const created = document.createElement('div');
  created.id = PORTRAIT_LOGO_LAYER_ID;
  // `fixed inset-0` con `pointer-events-none`: il marchio non deve intercettare
  // nessun click, e il layer non deve mai interferire con i selettori del resto
  // della pagina, che cercano i propri contenitori per sezione.
  created.style.cssText =
    'position:fixed;inset:0;z-index:60;pointer-events:none;';
  document.body.appendChild(created);
  return created;
};

/**
 * Punto di arrivo del marchio, MISURATO sul DOM e non calcolato a mano.
 *
 * L'altezza dell'header arriva dalla misura: se `h-24` cambia domani, il
 * marchio lo segue da solo invece di restare a 52px e sbordare.
 */
const measureLogoSlot = () => {
  const header = document.querySelector('header');
  const headerHeight = header?.offsetHeight ?? 0;
  if (!headerHeight) return null;
  const logoHeight = headerHeight * PORTRAIT_LOGO_HEIGHT_RATIO;
  return {
    left: measurePageGutter(),
    // Centrato nella fascia: l'header e' h-24 con items-center, quindi il
    // marchio si mette al centro esattamente dove sta il nome della sezione.
    top: (headerHeight - logoHeight) / 2,
    height: logoHeight,
  };
};

/**
 * Volo del ritratto verso la fascia dell'header.
 *
 * `flight` e' l'unico stato (0 = fermo nell'hero, 1 = marchio a posto) e guida
 * tre canali insieme, cosi' x, y e scala non possono disaccordarsi fra loro.
 * L'origine del transform e' `0 0`: e' il vertice in alto a sinistra a fare da
 * ancora, quindi l'atterraggio e' esatto e basta sapere DOVE sta quel vertice,
 * senza dover misurare la larghezza della box (che su mobile non e' nemmeno
 * nota in anticipo).
 *
 * L'unico paio di estremi governa sia l'andata sia il ritorno, perche' la
 * posizione e' la STESSA interpolazione: cambia solo il verso in cui `flight`
 * cammina. Sul ritorno gli estremi dell'hero vengono rimisurati, perche' nel
 * frattempo il ricentraggio si e' disfatto e il ritratto non e' piu' dove
 * era; gli estremi del marchio restano, e siccome il volo parte da `flight = 1`
 * l'aggiornamento e' invisibile (a flight 1 la posizione dipende solo dal
 * marchio).
 */
const usePortraitLogo = (flight: MotionValue<number>) => {
  // `xTarget` e `yTarget` sono la TRASLAZIONE che il nodo deve avere a flight 1,
  // cioe' uno scarto, non una coordinata assoluta. La distinzione conta: se
  // fossero coordinate, al primo set degli estremi il nodo partirebbe gia'
  // translato di tutta la sua distanza dall'origine invece di partire fermo.
  const xTarget = useMotionValue(0);
  const yTarget = useMotionValue(0);
  const heroHeight = useMotionValue(1);
  const slotHeight = useMotionValue(1);
  const x = useTransform<number, number>([flight, xTarget], ([f, t]) => t * f);
  const y = useTransform<number, number>([flight, yTarget], ([f, t]) => t * f);
  // La scala e' gia' relativa (1 all'hero, slotHeight/heroHeight al marchio) e
  // non dipende dal wrapper, quindi non ha bisogno di essere uno scarto.
  const scale = useTransform<number, number>(
    [flight, heroHeight, slotHeight],
    ([f, h, s]) => 1 + (s / h - 1) * f,
  );
  // Sollevamento tardivo e non immediato: per i primi istanti del volo il
  // ritratto e' ancora grande e deve restare sotto navicelle e foreground.
  // Alzarlo subito gli passerebbe addosso per un frame, il tempo di un lampo.
  const zIndex = useTransform(flight, (value) =>
    value > PORTRAIT_LOGO_Z_LIFT ? PORTRAIT_LOGO_Z_INDEX : 10,
  );
  // L'oggetto e' MEMORIZZATO: senza, `usePortraitLogo` restituisce un oggetto
  // nuovo a ogni render, e chi lo usa nelle dipendenze di useCallback o
  // useEffect si ri-scrivre a ogni frame. Il volo ricalcola gli estremi a ogni
  // chiamata di startFlight, quindi ricreare i canali a ogni render non
  // cambiava il risultato: costava solo lavoro.
  return useMemo(
    () => ({ xTarget, yTarget, heroHeight, slotHeight, x, y, scale, zIndex }),
    [xTarget, yTarget, heroHeight, slotHeight, x, y, scale, zIndex],
  );
};

export default function HeroScene({ scrollY }: { scrollY: MotionValue<number> }) {
  // USCITA DEL TESTO DELL'HERO. Finestra CONDIVISA con il rilascio delle
  // particelle e con la dissoluzione del ritratto: `1 - portraitRevealPhase(...)`,
  // la stessa funzione e gli stessi estremi, non una curva nuova. Se l'erosione,
  // le particelle e il testo usassero tre finestre diverse, l'hero si aprirebbe
  // a pezzi con il titolo ancora acceso dentro Works.
  //
  // Il fattore d'ingresso non c'e': l'ingresso del testo non e' piu' una
  // dissolvenza pilotata dallo scroll ma lo scramble che risolve i caratteri sul
  // posto, quindi il testo parte a opacita' 1 e resta 1 fino all'inizio di
  // questa finestra. Solo l'uscita e' qui.
  const copyDissolve = useTransform(scrollY, (value) =>
    1 -
    portraitRevealPhase(
      value,
      readSceneTop('hero'),
      readSceneTop('nebula'),
      window.innerHeight,
    ),
  );
  // VOLO VERSO L'HEADER. `flight` e' l'unica sorgente di verita' del movimento:
  // lo guida sia l'andata sia il ritorno, quindi i due non possono disaccordarsi.
  const flight = useMotionValue(0);
  // UN SET DI CANALI PER ISTANZA, non uno condiviso.
  //
  // Le due istanze dell'SVG (desktop e mobile) sono due nodi distinti, ma
  // `xTarget`, `yTarget`, `heroHeight` e `slotHeight` erano gli stessi
  // MotionValue per entrambe: ogni volta che il volo scriveva un estremo, li
  // scriveva per le due. Se il volo parte sul desktop e poi la viewport scende
  // sotto `md`, l'istanza mobile (che da nascosta diventa visibile) eredita la
  // traslazione e la scala del marchio: misurato, il doppio avatar a 508px con
  // il nodo mobile a scala 0.172, uguale al marchio a 0.172, mentre a 1440 la
  // stessa scala era 0.106. Era lo stesso valore, letto due volte.
  //
  // Con un set per istanza, l'istanza che non vola resta a x=0 y=0 scala=1: il
  // doppio avatar non e' evitato da una condizione, non puo' accadere.
  const logoDesktop = usePortraitLogo(flight);
  const logoMobile = usePortraitLogo(flight);
  // Il set in uso segue il nodo che sta volando. Il volo scrive SOLO su questo,
  // quindi l'altra istanza non riceve nessun valore.
  const logoPhaseRef = useRef<'idle' | 'away' | 'home'>('idle');
  // Dove il nodo del ritratto sta nel markup, per poterlo rimettere a posto al
  // rientro. Serve perche' il volo lo sposta in un layer radice (vedi
  // `ensureLogoLayer`): senza questo, tornare all'hero lascerebbe il volto nel
  // layer e l'hero sembrerebbe senza ritratto.
  const logoOriginRef = useRef<{ parent: HTMLElement; next: ChildNode | null } | null>(
    null,
  );
  const controlsRef = useRef<AnimationPlaybackControls | null>(null);

  // Il ritratto entra su una finestra propria e POI VOLA: non si dissolve piu'.
  // L'opacita' resta a 1 per tutto il viaggio, e' la scala a toglierlo dalla
  // scena. Il fattore di dissoluzione resta pero' su h2 e hint, che devono
  // spegnersi nella finestra condivisa con il rilascio delle particelle.
  //
  // Se il ritratto si spegnesse insieme alle particelle, al trigger ci sarebbe
  // un buco: la sagoma e' ancora in formazione e il disegno che copriva
  // l'avrebbe gia' abbandonata.
  const portraitEntrance = useTransform(
    scrollY,
    (value) => viewportPhase(value, 0.82, 1),
  );
  const avatarOpacity = portraitEntrance;

  // ── IL VOLO ───────────────────────────────────────────────────────────────
  // Il ritratto non segue lo scroll nel viaggio verso l'header: lo scroll lo
  // INNESCA e poi il volo va da solo, a tempo. E' la richiesta, e la ragione e'
  // che seguire il scroll qui significherebbe legare la posizione del marchio a
  // quanti pixel mancano alla fine della pagina: tornare indietro di uno stop
  // farebbe scivolare il logo fuori dall'header mentre l'hero riprende.
  //
  // Il trigger e' UNA soglia di scroll, non un'animazione: si arma a 4px dalla
  // fine del ricentraggio. La posizione di partenza e' misurata sul DOM in
  // quell'istante, non calcolata: se l'SVG cambia dimensione, o il layout si
  // muove, il volo parte comunque da dove il ritratto sta davvero.
  //
  // portraitRef e' dichiarato qui e non piu' in giu': il volo ha bisogno di
  // misurare l'elemento, quindi la ref deve esistere prima del callback che la
  // usa, non trecento righe dopo.
  const portraitRef = useRef<HTMLDivElement>(null);
  const mobilePortraitRef = useRef<HTMLDivElement>(null);
  // Ricentraggio in px, non in percentuale: serve al volo per sapere quanto il
  // wrapper abbia ancora da scivolare quando scatta il trigger (a quel punto la
  // ricentratura non e' finita).
  //
  // Il punto di riposo viene da un REF e non da uno stato: `recenterDelta` nasce
  // qui, molto prima che la misura del layout sia disponibile, e uno stato
  // usato in quel punto darebbe un errore a runtime (la variabile non esiste
  // ancora), che TypeScript non segnala. Con un ref il valore si legge quando
  // serve, e il primo render legge semplicemente 0.
  const portraitRestXRef = useRef(0);
  const recenterPhase = useTransform(scrollY, (value) => {
    const nebulaTop = readSceneTop('nebula');
    // readSceneTop restituisce 0 quando la sezione non c'e': con 0 la formula
    // darebbe una fase gia' a 1 e il ritratto partirebbe gia' centrato.
    if (!nebulaTop) return 0;
    return shapeRecenterPhase(value, nebulaTop, window.innerHeight);
  });
  const recenterDelta = useTransform(recenterPhase, (t) =>
    (window.innerWidth / 2 - portraitRestXRef.current) * t,
  );
  const startFlight = useCallback(
    (direction: 1 | -1) => {
      controlsRef.current?.stop();
      const node = portraitRef.current;
      const mobileNode = mobilePortraitRef.current;
      // ── SCELTA DEL NODO, UNA REGOLA SOLA ────────────────────────────────────
      // La regola precedente era `node.offsetWidth > 0 ? node : mobileNode`, che
      // e' ambigua per costruzione: il nodo in volo sta dentro il layer radice,
      // che e' `position: fixed`, quindi ha SEMPRE offsetWidth > 0 anche quando il
      // layout e' mobile. Dopo un cambio di larghezza la selezione tornava
      // quindi su "desktop" e il nodo sbagliato veniva rimesso in volo:
      // misurato, a 508px finivano DUE nodi dentro il layer.
      //
      // Ora decide il BREAKPOINT, e il breakpoint e' l'unica cosa che decide
      // quale istanza e' visibile: e' la stessa condizione dei `md:` del JSX, letta
      // con matchMedia, quindi selezione e layout non possono divergere.
      const layer = ensureLogoLayer();
      const desktop = window.matchMedia('(min-width: 768px)').matches;
      const active = desktop ? node : mobileNode;
      const inattivo = desktop ? mobileNode : node;
      if (!active) return;
      // Il set di canali segue il nodo: il volo scrive solo sul suo, quindi
      // l'altra istanza resta a x=0 y=0 scala=1 e non viene trascinata.
      const canali = active === node ? logoDesktop : logoMobile;
      const canaliInattivo = active === node ? logoMobile : logoDesktop;

      // Se l'istanza dell'ALTRO layout e' rimasta nel layer (e' successo cambiando
      // larghezza mentre il volo era gia' partito) va rimandata a casa PRIMA di
      // tutto: e' un nodo che non esiste piu' dal punto di vista del layout, e
      // lasciarlo li' farebbe due ritratti in scena. I suoi canali si azzerano
      // perche', una volta a casa, `flight` a 1 non deve piu' traslarla: con
      // xTarget 0 e slot/hero entrambi a 1 la scala vale esattamente 1.
      if (inattivo && inattivo.parentElement === layer) {
        const via = logoOriginRef.current;
        if (via) via.parent.insertBefore(inattivo, via.next);
        canaliInattivo.xTarget.set(0);
        canaliInattivo.yTarget.set(0);
        canaliInattivo.heroHeight.set(1);
        canaliInattivo.slotHeight.set(1);
        logoOriginRef.current = null;
      }

      if (direction === 1) {
        const slot = measureLogoSlot();
        if (!slot) return;
        // Punto di RIPOSO del ritratto: la sua posizione di LAYOUT, cioe'
        // ripulita da tutti i transform che il DOM sta mostrando in questo frame.
        //
        // Non si azzera `flight` per rileggerla: `jump(0)` aggiorna il
        // MotionValue ma NON il DOM in modo sincrono, quindi il rect letto subito
        // dopo e' ancora quello a meta' volo. E non si usa neppure
        // `recenterDelta.get()`: e' un MotionValue, puo' essere indietro di un
        // frame rispetto al DOM, e i due sistemi non combaciano. Mescolarli
        // faceva atterrare il marchio fuori posto (misurato: 116.7 / 47.7
        // invece di 24 / 22.1, con uno scarto che cambiava a seconda di come si
        // arrivava alla quota).
        //
        // Sottraendo le matrici EFFETTIVAMENTE applicate la posizione di layout
        // e' esatta a qualunque punto del volo, senza dover azzerare nulla: e
        // `transform-origin: 0 0` fa si che la scala non sposti il vertice in
        // alto a sinistra, che e' l'unico punto che serve.
        //
        // Il padre si sottrae sempre, e serve al mobile: li' il contenitore ha
        // `x/y: -50%`, cioe' un transform che sposta il nodo di metta box.
        // Se il padre manca non c'e' nulla da sottrarre: si usa una matrice
        // identita', cosi' la formula resta valida.
        // La posizione di RIPOSO si misura PRIMA di spostare il nodo, quando
        // e' ancora nella colonna dell'hero: e' li' che il nodo ha una posizione
        // di layout che sposta qualcosa (la colonna flex, e sul mobile il
        // `x/y: -50%` del contenitore). Sottraendo le matrici EFFETTIVAMENTE
        // applicate la si ricava a qualunque punto del volo, senza dover azzerare
        // `flight`: `jump(0)` aggiorna il MotionValue ma NON il DOM in modo
        // sincrono, quindi il rect letto subito dopo sarebbe ancora quello a
        // meta' volo.
        //
        // Poi il nodo entra nel layer, e li' la sua posizione di LAYOUT e' (0, 0)
        // per costruzione: il layer e' `position: fixed; inset: 0` e il nodo vi
        // entra come primo figlio, quindi il suo box parte dall'origine della
        // viewport. E' questo il punto che non si poteva misurare, perche' dopo
        // lo spostamento non c'e' piu' nulla da misurare.
        //
        // Lo scarto del volo e' quindi la differenza fra il punto di arrivo e
        // l'ORIGINE, non fra il punto di arrivo e la posizione nell'hero:
        // misurato, togliendo la posizione dell'hero il marchio atterrava a
        // x = -111.9 invece che sul filo, perche' gli veniva sottratto uno scarto
        // di 182.47 che nel layer non esiste (e che a 1440 coincideva per caso
        // con il filo vecchio di 24px, il difetto restava nascosto).
        // Nel layer il riposo e' l'origine: nessuna misura, per costruzione.
        const restLeft = 0;
        const restTop = 0;
        // Il nodo viene spostato nel layer radice PRIMA di fissare gli estremi:
        // li' non e' piu' sottoposto al contesto della colonna editoriale, quindi
        // emerge davvero sopra l'header. La posizione di riposo e' gia' stata
        // misurata sopra, quando il nodo era ancora nel suo contesto, quindi lo
        // spostamento non cambia nulla: il layer e' `inset: 0` e il nodo vi
        // entra con lo stesso punto in alto a sinistra.
        //
        // Il padre e il fratello successivo vengono ricordati per il rientro:
        // senza, il nodo resterebbe nel layer e l'hero perderebbe il volto.
        const host = active.parentElement;
        if (host && host !== layer) {
          logoOriginRef.current = { parent: host, next: active.nextSibling };
          layer.appendChild(active);
        }
        canali.xTarget.set(slot.left - restLeft);
        canali.yTarget.set(slot.top - restTop);
        // `offsetHeight` e' l'altezza di layout, quindi non risente della scala
        // del volo: e' la base giusta per la scala anche al rientro.
        canali.heroHeight.set(active.offsetHeight);
        canali.slotHeight.set(slot.height);
        controlsRef.current = animate(flight, 1, {
          duration: PORTRAIT_LOGO_FLY_SECONDS,
          ease: PORTRAIT_LOGO_EASE_OUT,
        });
        return;
      }
      // ── RIENTRO ────────────────────────────────────────────────────────────
      // Ritorno DIRETTO, senza passaggio per il centro: era cosi' prima ed e' la
      // forma che regge. Il centro e' stato escluso per una ragione strutturale,
      // non estetica, e vale la pena scriverla perche' si rifa' volentieri.
      //
      // Il centro della viewport e' prodotto dal RICENTRAGGIO, che e' un canale
      // SCROLL sul wrapper (portraitX = recenterDelta * (1 - flight)). Sul
      // ritorno, quando scatta la soglia, recenterPhase e' GIA' a 0 — misurato:
      // 0 per tutta la zona da y=1045 a y=625. Quindi al ritorno il centro non
      // esiste come punto di quel canale, e farlo attraversare vorrebbe dire
      // pilotarlo a mano dal canale del nodo.
      //
      // E li' c'e' l'impedimento, misurato: il nodo nel LAYER a x = 0 cade a
      // 182.2, lo stesso nodo nel WRAPPER a x = 0 cade a 372.5. Due punti diversi
      // di 190.3px, perche' il layer ha base nell'origine del viewport e il
      // wrapper base nella colonna dell'hero. Su mobile la differenza e' di
      // nuovo 182px ma per un motivo diverso: il padre ha x:-50% (matrix
      // -182.164) che nel layer non lo segue.
      //
      // Quindi un ritorno che attraversa il centro deve per forza attraversare
      // anche quel salto, nell'unico frame in cui il nodo rientra nel wrapper. E
      // non si riesce a toglierlo: riordinare le due operazioni non basta, perche'
      // il transform viene riscritto al frame successivo (misurato: il nodo e'
      // gia' nel wrapper con x ancora vecchio per un frame), e l'unico modo di
      // forzare l'azzeramento — `MotionValue.jump` — c'e' a runtime ma non nelle
      // .d.ts, quindi non e' tipizzato e non si puo' usare.
      //
      // Si e' provata anche la strada di tenere il nodo nel layer tutta la
      // discesa: il salto resta identico, perche' non dipende da dove sta il
      // nodo in quel frame ma dal fatto che i due sistemi non coincidono.
      //
      // Conclusione: attraversare il centro costerebbe un lampo di ~200px a
      // meta' ritorno, nel punto esatto in cui l'occhio guarda. Il ritorno
      // diretto e' lineare e senza scarti, e il centro resta comunque
      // attraversato in ANDATA, dove lo porta il ricentraggio e lo fa per
      // costruzione.
      //
      // Non serve rimisurare nulla: gli estremi sono gia' quelli giusti, perche'
      // lo scarto e' calcolato sulla posizione di LAYOUT, che non cambia andando
      // su e giu'. A flight 0 il nodo torna esattamente dove lo mette il
      // ricentraggio di quel momento, cioe' nell'hero come se non fosse mai
      // partito, e il rientro insegue quindi il ritratto mentre si ricentra al
      // contrario senza dover inseguirlo a mano.
      //
      // Prima di animare il nodo torna nel suo posto nel markup: il layer serve
      // solo mentre il marchio e' in header, e lasciarlo li' priverebbe l'hero
      // del volto al ritorno.
      const via = logoOriginRef.current;
      if (via && active.parentElement === layer) {
        via.parent.insertBefore(active, via.next);
        logoOriginRef.current = null;
      }
      controlsRef.current = animate(flight, 0, {
        duration: PORTRAIT_LOGO_RETURN_SECONDS,
        ease: PORTRAIT_LOGO_EASE_OUT,
      });
    },
    [flight, logoDesktop, logoMobile, portraitRef, mobilePortraitRef],
  );

  // Sottoscrizione unica che scatta solo ai cambi di stato, non a ogni frame.
  // Lo stato vive in una ref perche' qui non deve provocare un render: e' una
  // macchina a stati che governa il volo, non un dato da mostrare.
  //
  // La soglia di rientro e' DIVERSA da quella di andata, e piu' in basso: si torna
  // nell'hero solo quando il ricentraggio si e' disfatto del tutto (sotto
  // `portraitRevealStart`). Tornando alla soglia di andata il marchio si
  // riaprirebbe a meta' ricentratura, cioe' dentro la sagoma, e ogni passaggio
  // avanti-indietro attorno a quella quota farebbe partire e fermare il volo di
  // continuo. La banda fra le due soglie e' l'isteresi.
  useMotionValueEvent(scrollY, 'change', (value) => {
    const heroTop = readSceneTop('hero');
    const nebulaTop = readSceneTop('nebula');
    if (!heroTop || !nebulaTop) return;
    const { start, end } = portraitRevealWindow(heroTop, nebulaTop, window.innerHeight);
    const flyAt = end - PORTRAIT_LOGO_LEAD_PX;
    const phase = logoPhaseRef.current;
    if (value >= flyAt) {
      // 'home' e' inclusa: senza questo, tornati indietro e poi avanti di
      // nuovo il marchio restava a terra perche' nessuno riarmava il volo.
      if (phase !== 'away') {
        logoPhaseRef.current = 'away';
        startFlight(1);
      }
    } else if (value < start && phase === 'away') {
      logoPhaseRef.current = 'home';
      startFlight(-1);
    }
  });

  // ── IL CAMBIO DI BREAKPOINT MENTRE IL MARCHIO E' IN VOLO ───────────────────
  // Il volo sposta UNA delle due istanze dell'SVG nel layer radice, e quella
  // scelta dipende dal breakpoint. Se la larghezza attraversa 768px mentre il
  // marchio e' a terra, l'istanza giusta cambia ma il nodo nel layer no: senza
  // un intervento qui restano due ritratti in scena, perche' quello appena
  // diventato visibile appartiene all'altra griglia.
  //
  // Il gestore non deve ricostruire il volo da capo: rimanda a casa l'istanza
  // sbagliata e rilancia quello giusto sugli estremi gia' misurati, che al
  // breakpoint nuovo sono comunque da rimisurare (il filo cambia con la
  // larghezza). Percio' chiama lo stesso startFlight: una sola via per far
  // partire il volo, e nessuna logica di volo duplicata qui.
  //
  // `matchMedia` e' il listener giusto perche' e' l'unica cosa che decide quale
  // istanza e' visibile (la stessa condizione dei `md:` del JSX). Un listener su
  // window.resize avrebbe scattato a ogni micro-spostamento della finestra
  // senza sapere se il layout era davvero cambiato.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const onCambio = () => {
      // Solo se il marchio e' in volo: a terra nessun nodo e' nel layer e non
      // c'e' nulla da comporre.
      if (logoPhaseRef.current !== 'away') return;
      startFlight(1);
    };
    query.addEventListener('change', onCambio);
    return () => query.removeEventListener('change', onCambio);
  }, [startFlight]);

  // Se il layout cambia a marchio gia' posato (resize, font), il volo viene
  // rilanciato da zero con le estremi rimisurate: senza questo il logo
  // resterebbe sulla griglia vecchia dopo un cambio di altezza header.
  useEffect(() => {
    const node = portraitRef.current;
    if (!node || logoPhaseRef.current !== 'away') return;
    const observer = new ResizeObserver(() => {
      if (logoPhaseRef.current === 'away') startFlight(1);
    });
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [startFlight]);
  // Il rig del viso legge l'opacita' per capire l'arrivo dall'hero, e usa quel
  // valore per decidere quando il ritratto e' a posto e far partire la sequenza
  // (posa -> sorriso -> loop). Rilegge questo valore e non uno moltiplicato:
  // un'ulteriore dissolvenza azzererebbe l'arrivo e la sequenza ripartirebbe.
  // L'hint segue l'h2 e ne condivide il valore: dice "scorri per dissolvere", e
  // deve spegnersi con la stessa cosa che si dissolve. Percio' l'hint riceve
  // `copyDissolve` e non piu' `handoffFade * (1 - dissolve)`: il fattore
  // d'ingresso non vale piu' per nessun testo dell'hero (l'ingresso e' lo
  // scramble), e lasciarlo sull'hint lo faceva sparire a scroll 0 e riapparire
  // solo al fermo magnetico, disaccordato dal titolo che era gia' a 1.
  const dissolveOpacity = copyDissolve;

  // Lo scroll si sblocca quando il prompt ha finito di comporsi. Il passaggio
  // avviene qui e non nella sequenza perche' e' l'hint a sapere quando e'
  // completo, e la sequenza non deve tenersi il conto di un testo che non le
  // appartiene.
  const onHintResolved = useCallback(() => {
    unlockScroll();
  }, []);

  // Il rapporto d'aspetto arriva dal FILE, non da una classe scritta a mano:
  // l'altezza del ritratto e' fissata dal clamp, quindi e' la larghezza che
  // dipende da questo numero. Hardcodarlo legava la resa a un solo SVG, e al
  // primo file con proporzioni diverse la sagoma delle particelle (che usa lo
  // stesso rapporto) non avrebbe piu' coperto il ritratto.
  const [portraitAspect, setPortraitAspect] = useState(PORTRAIT_ASPECT_BOOTSTRAP);
  const [svgMarkup, setSvgMarkup] = useState('');
  useEffect(() => {
    let alive = true;
    void loadPortraitImage(IMG_URL).then(() => {
      if (alive) setPortraitAspect(getPortraitAspect());
    });
    // Lo stesso file viene iniettato inline per poter animare i path. Il fetch
    // e' separato dal loader dell'immagine: i due usano lo stesso URL ma
    // formati diversi.
    void fetch(IMG_URL)
      .then((res) => res.text())
      .then((text) => {
        if (alive && text.trim()) setSvgMarkup(text);
      })
      .catch(() => {
        // Senza markup il ritratto semplicemente non si vede: la pagina non
        // si rompe e il fallback del canvas fa comunque la sua parte.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Geometria del ritratto, MISURATA e pubblicata per il canvas: e' l'unica
  // sorgente di verita' su posizione e dimensione, quindi il canvas non puo'
  // disallineare la sagoma dall'SVG.
  //
  // Si pubblicano gli offset di LAYOUT, non la rect: sono immuni ai transform,
  // quindi descrivono il ritratto a RIPOSO anche se il publish scatta mentre
  // l'SVG e' gia' a meta' ricentraggio. Il canvas ci somma sopra il proprio
  // spostamento, e se i valori includessero quel movimento verrebbe contato due
  // volte.
  const portraitWrapRef = useRef<HTMLDivElement>(null);
  // Il ref e' l'unico contenitore del punto di riposo: viene letto sia dal
  // ricentraggio (che nasce prima della misura) sia dal volo, e non provoca
  // nessun render. Lo stato non servirebbe a nulla qui e costerebbe un render
  // a ogni micro-aggiustamento del layout.
  const syncPortraitRect = useCallback(() => {
    const node = portraitRef.current;
    const wrap = portraitWrapRef.current;
    if (!node || !wrap) return;
    // Il wrapper e' nel flusso (nessuna `left` in percentuale, nessun
    // translate(-50%)), quindi il centro a riposo si calcola dal suo box:
    // sarebbe altrimenti il bordo sinistro.
    const centerX = wrap.offsetLeft + wrap.offsetWidth / 2;
    publishPortraitGeometry({
      x: centerX,
      y: wrap.offsetTop + wrap.offsetHeight / 2,
      width: node.offsetWidth,
      height: node.offsetHeight,
    });
    portraitRestXRef.current = centerX;
  }, []);
  useLayoutEffect(() => {
    syncPortraitRect();
    const node = portraitRef.current;
    if (!node) return;
    // Cambiano dimensione, layout e contenuto: la geometria va ricalcolata.
    // document.fonts.ready copre il caso in cui i font arrivano dopo.
    const observer = new ResizeObserver(syncPortraitRect);
    observer.observe(node);
    window.addEventListener('resize', syncPortraitRect);
    void document.fonts?.ready.then(syncPortraitRect);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncPortraitRect);
    };
  }, [syncPortraitRect]);

  // Dimensione del ritratto, governata dalla LARGHEZZA e non dall'altezza.
  //
  // Il riquadro deve avere esattamente il rapporto del disegno: se il box
  // deformasse, la maschera/immagine mostrerebbe il ritratto in un modo e le
  // particelle campionate sull'SVG in un altro, e la sagoma smetterebbe di
  // combaciare. Con `aspect-ratio` e larghezza impostata, l'altezza segue da
  // sola e il rapporto e' garantito. La larghezza e' il minimo fra tre tetti:
  // altezza massima in vh, altezza massima in px, e spazio orizzontale
  // disponibile (che sul desktop deve lasciare posto al testo).
  const portraitWidth = (maxVw: number) =>
    `min(calc(${HERO_PORTRAIT_HEIGHT_VH}vh * ${portraitAspect}), ` +
    `calc(${HERO_PORTRAIT_HEIGHT_PX}px * ${portraitAspect}), ` +
    `${maxVw}vw)`;

  // Espressione del viso: movimento autonomo, non legato allo scroll.
  //
  // La bocca parte dal file (sorriso) e viene appiattita verso una versione
  // neutra; il ciclo fra le due e' continuo. Occhi e sopracciglia hanno
  // oscillazioni proprie, con fasi diverse per non sembrare sincronizzati.
  //
  // Il loop gira solo mentre il ritratto e' in scena e si ferma altrimenti:
  // fuori dall'hero non c'e' niente da animare e il lavoro sarebbe sprecato.
  // L'SVG e' montato due volte, una per layout (desktop e mobile): uno solo dei
  // due e' visibile a seconda della viewport. Gli host si registrano in una
  // lista e il ciclo aggiorna solo quello realmente in scena.
  const faceHostsRef = useRef<HTMLDivElement[]>([]);
  // Canvas delle particelle puntiformi. E' disegnato dentro il rAF del volto, non
  // in un loop separato: un solo ciclo di rendering per tutta la hero.
  const pointCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // L'opacita' del ritratto serve per capire l'arrivo dall'hero, ma non puo'
  // stare nelle dipendenze dell'effetto: ricreerebbe il rig a ogni render e
  // ripartirebbe l'animazione da capo. Per questo va letta da un ref.
  const opacityRef = useRef(avatarOpacity);
  opacityRef.current = avatarOpacity;
  const registerFaceHost = useCallback((node: HTMLDivElement | null) => {
    const list = faceHostsRef.current;
    if (node) {
      if (!list.includes(node)) list.push(node);
    }
  }, []);
  useEffect(() => {
    if (!svgMarkup) return;
    const hosts = faceHostsRef.current.filter(Boolean);
    if (!hosts.length) return;

    if (reducedMotion) return;

    // Sprite delle particelle puntiformi, disegnati una volta sola: alone
    // radiale stretto con il nucleo piu' luminoso. Disegnarli ogni frame
    // costerebbe un gradiente per particella, quindi si pre-renderizzano.
    // Sono due tinte perche' il rosa da solo sul magenta di fondo ha un
    // contrasto di appena 3.56 e un punto da 2px sparisirebbe: il giallo ne
    // ha 4.27. La miscela richiama anche le due navicelle.
    const SPRITE = 32;
    const makeSprite = (rgb: string) => {
      const c = document.createElement('canvas');
      c.width = SPRITE;
      c.height = SPRITE;
      const ctx = c.getContext('2d');
      if (ctx) {
        const g = ctx.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
        g.addColorStop(0, `rgba(${rgb}, 1)`);
        g.addColorStop(0.22, `rgba(${rgb}, 0.8)`);
        g.addColorStop(0.5, `rgba(${rgb}, 0.24)`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, SPRITE, SPRITE);
      }
      return c;
    };
    const sprites = {
      pink: makeSprite('252, 178, 188'),
      yellow: makeSprite('255, 212, 0'),
    };

    // Parametri fissi per particella, deterministici: stessa scena a ogni
    // caricamento, niente disposizione casuale che cambia da una volta all'altra.
    // Per la posizione si usa la sequenza a bassa discrepanza (numero aureo):
    // con un hash normale la sequenza si addensa (molti campioni finivano
    // nello stesso 20% di larghezza) e le particelle si leggono come un gruppo
    // invece che come pulviscolo sparso.
    const PHI = 0.6180339887;
    const spread = (i: number) => (i * PHI) % 1;
    const hash = (v: number) => {
      const x = Math.sin(v * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const points = Array.from({ length: HERO_POINT_COUNT }, (_, i) => ({
      // L'attraversamento e' uno scarto intorno alla posizione base, non un
      // offset che si somma a essa: con la somma le due quantita' erano
      // correlate (stesso valore di spread) e le particelle agli estremi
      // finivano fuori viewport, lasciando il centro vuoto.
      // spread con indici diversi: baseX, baseY e travel sono scorrelati.
      travel: spread(i + 17),
      travelRange: 0.1 + hash(i * 4.7) * 0.1,
      baseX: 0.08 + spread(i + 1) * 0.84,
      baseY: 0.08 + spread(i + 3) * 0.84,
      driftX: 0.02 + hash(i * 9.1 + 4.1) * 0.05,
      driftY: 0.02 + hash(i * 11.3 + 6.5) * 0.05,
      // due tempi coprimi per il galleggiamento: non sembrano sincronizzati
      bobA: 4.9 + hash(i * 13.7) * 5.5,
      bobB: 8.3 + hash(i * 17.9) * 6.1,
      radius: 1.1 + hash(i * 19.1 + 0.3) * 1.5,
      alpha: 0.62 + hash(i * 23.3 + 1.1) * 0.38,
      // due terzi giallo, un terzo rosa
      sprite: hash(i * 29.7 + 2.2) < 0.66 ? sprites.yellow : sprites.pink,
    }));

    const pointCtx = pointCanvasRef.current?.getContext('2d') ?? null;

    // Un "rig" per host: le liste di path sono indici sull'elenco globale, quindi
    // vanno risolte dentro ciascuna istanza dell'SVG.
    type MouthRig = {
      el: SVGPathElement;
      template: string;
      closed: number[];
      half: number[];
      smile: number[];
    };
    type Scalable = { el: SVGPathElement; cx: number; cy: number };
    type EyeRig = { white: Scalable; parts: Scalable[] };
    const faces = hosts.map((host) => {
      const paths = host.querySelectorAll('path');
      if (paths.length < 40) return null;

      // LA BOCCA ha tre pose, tutte derivate dal file:
      //   smile  = il disegno originale
      //   half   = angoli livellati E apertura dimezzata: la posa di mezzo
      //   closed = anse tirate sulla corda: diventa una linea
      //
      // 'closed' e 'smile' hanno gli ANGOLI IDENTICI (flattenPath non tocca i
      // punti sul tracciato, solo i punti di controllo delle cubiche). Per questo
      // nel loop la bocca si apre e si chiude SEMPRE dagli stessi angoli: e' la
      // condizione perché non sembri ruotare. La posa 'half', che invece ha gli
      // angoli livellati, compare solo una volta all'arrivo e mai nel loop.
      const mouth: MouthRig[] = MOUTH_PATH_INDEXES.map((index) => {
        const el = paths[index] as SVGPathElement;
        const smile = el.getAttribute('d') ?? '';
        const nums = pathNumbers(smile);
        return {
          el,
          template: smile,
          closed: flattenNumbers(nums, 1),
          half: flattenNumbers(levelSmileCorners(nums, MOUTH_HALF_SMILE), MOUTH_HALF_FLATTEN),
          smile: nums,
        };
      });

      // OCCHI: il bianco si stringe solo in verticale (sopra e sotto), mentre
      // iride, pupilla e riflesso si rimpiccioliscono in modo uniforme, cosi'
      // restano cerchi. Ognuno scala attorno al PROPRIO centro.
      const eyes: EyeRig[] = (Object.keys(EYE_PARTS) as Array<'left' | 'right'>).map((side) => {
        const whiteEl = paths[EYE_WHITE_INDEXES[side]] as SVGPathElement;
        const toScalable = (el: SVGPathElement): Scalable => ({
          el,
          ...pathCenter(el.getAttribute('d') ?? ''),
        });
        return {
          white: toScalable(whiteEl),
          parts: EYE_PARTS[side].map((i) => toScalable(paths[i] as SVGPathElement)),
        };
      });

      // LABRET: segue il labbro inferiore, quindi gli serve il centro per
      // scalare attorno a se' mentre si sposta.
      const piercing: Scalable[] = PIERCING_PATH_INDEXES.map(
        (i) => paths[i] as SVGPathElement,
      ).map((el) => ({ el, ...pathCenter(el.getAttribute('d') ?? '') }));

      // Il labbro inferiore e il suo viaggio: serve al labret per capire
      // di quanto e' sceso e quanto la pelle si allunga. Il viaggio e' misurato
      // sul file, non indovinato, quindi se l'SVG cambia si ricalcola da solo.
      const lowerIndex = MOUTH_PATH_INDEXES.indexOf(MOUTH_LOWER_LIP_INDEX);
      const lowerLip = mouth[lowerIndex] ?? mouth[mouth.length - 1];
      const maxY = (nums: number[]) => Math.max(...nums.filter((_, i) => i % 2 === 1));
      const lowerLipRestY = maxY(lowerLip.smile);
      const lowerLipClosedY = maxY(lowerLip.closed);
      const lowerLipTravel = lowerLipRestY - lowerLipClosedY;
      const brows = BROW_PATH_INDEXES.map((i) => paths[i] as SVGPathElement);
      return {
        host,
        mouth,
        eyes,
        piercing,
        lowerIndex,
        lowerNums: lowerLip.smile,
        lowerLipRestY,
        lowerLipTravel,
        brows,
        onScreen: false,
        // Le sentinelle sono PER FACCIA, non del ciclo. Erano dichiarate una
        // volta sola fuori dal `for (const face of faces)`, quindi condivise fra
        // le due istanze: la seconda non veniva mai aggiornata, perche' la
        // sentinella conteneva gia' il suo valore, e restava ferma sul `d`
        // originale del file. Con due istanze a schermo insieme (il doppio
        // avatar) si vedeva un viso animato e uno congelato.
        //
        // Infinity e non NaN: Math.abs(x - NaN) e' sempre false, quindi con
        // NaN i rami non entrerebbero mai e quei path resterebbero fermi.
        sent: {
          mouth: -1,
          loop: -1,
          lookX: Number.POSITIVE_INFINITY,
          lookY: Number.POSITIVE_INFINITY,
          brow: Number.POSITIVE_INFINITY,
          open: Number.POSITIVE_INFINITY,
          pierce: Number.POSITIVE_INFINITY,
        },
      };
    }).filter((face): face is NonNullable<typeof face> => face !== null);
    if (!faces.length) return;

    let frame = 0;
    let last = 0;
    // Le sentinelle vivono dentro ogni oggetto `face` (vedi `sent`, sopra):
    // dichiararle qui le avrebbe condivise fra le due istanze, e la seconda
    // non sarebbe mai stata aggiornata.
    // La sequenza d'ingresso parte una volta sola: tornare nel preloader non
    // la riapre, altrimenti il viso ripartirebbe da zero a ogni scroll.
    //
    // `introElapsed` e' TEMPO ACCUMULATO, non differenza fra due istanti
    // assoluti. Con `t - arrived` un singolo frame perso (una scheda in secondo
    // piano, un GC, un layout lungo) faceva saltare la posa di mezzo e parte
    // della corsa al sorriso, perche' il clock era gia' andato avanti mentre
    // nessun frame era stato disegnato. Qui il tempo avanza solo quando un
    // frame avanza davvero, e il delta e' limitato a 100ms: oltre, e' una
    // pausa dell'utente e non un movimento del viso.
    const INTRO_MAX_STEP = 0.1;
    let introStarted = false;
    let introElapsed = 0;
    let running = true;

    const tick = (time: number) => {
      if (!running) return;
      frame = window.requestAnimationFrame(tick);
      const t = time * 0.001;
      // Sotto i 40ms dal frame precedente non si tocca nulla: evita lavoro
      // quando la scheda e' ferma o quando il frame e' saltato.
      if (last && time - last < 40) return;
      // Il clock dell'intro avanza QUI, una volta sola per frame e solo se il
      // ritratto e' gia' arrivato: e' il punto in cui il tempo "disegnato" e il
      // tempo "trascorso" coincidono. Il delta e' limitato a INTRO_MAX_STEP
      // cosi' una pausa lunga non fa saltare la posa di mezzo.
      const step = Math.min((time - last) * 0.001, INTRO_MAX_STEP);
      last = time;

      // Non animare quando il ritratto non e' in scena: si aggiorna solo
      // l'host realmente dentro il viewport (l'altro layout e' nascosto).
      let anyOnScreen = false;
      for (const face of faces) {
        const rect = face.host.getBoundingClientRect();
        const onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
        face.onScreen = onScreen;
        if (!onScreen) continue;
        // Il ritratto e' in scena: le particelle puntiformi possono restare
        // accese. Il flag serve a non disegnarle due volte se per qualche
        // motivo entrambe le istanze dell'SVG fossero visibili insieme.
        anyOnScreen = true;

        // SEQUENZIA. All'arrivo il ritratto e' a piena opacita': e' il momento
        // in cui si parte. Prima la terza posa (bocca aperta ma meno
        // sorridente, occhi a meta'), poi il sorriso, e solo allora il loop.
        // L'attesa e' ancorata all'ARRIVO, non a un istante assoluto, cosi'
        // funziona anche se l'hero si sposta: `introElapsed` riparte da zero
        // quando l'opacita' supera la soglia, e da li' cresce solo dei frame
        // effettivamente disegnati.
        //
        // CON L'INGRESSO NUOVO questa sequenza non parte: e' il controller a
        // decidere l'espressione durante l'ingresso (riposo, blink, sorpresa,
        // sorriso) e, se partisse anche qui, i due sistemi si pesterebbero i
        // piedi sullo stesso numero. Con `?skip` non c'e' nessuna sequenza e
        // questa fa da sola, quindi il viso si presenta subito come prima.
        if (!avatarController.isSuspended()) {
          if (!introStarted && opacityRef.current.get() >= 0.999) introStarted = true;
          else if (introStarted) introElapsed += step;
        }
        const since = introStarted ? introElapsed : -1;

        // Il centro del viso a schermo: serve a `lookAt`, che mira a un punto
        // in coordinate di viewport. Si pubblica qui, e solo per la faccia
        // realmente in scena: con due istanze dell'SVG nel DOM (desktop e
        // mobile) l'altra ha un rect a zero e falserebbe la mira.
        avatarController.setFaceCenter(
          rect.x + rect.width / 2,
          rect.y + rect.height * 0.42,
        );

        // k = 0 bocca chiusa | 0.5 terza posa | 1 sorridente
        // phase distingue la sequenza d'ingresso dal loop: usano due percorsi
        // diversi. Nell'intro si parte dalla terza posa e si arriva al sorriso;
        // nel loop si va direttamente da chiusa a sorriso, senza passare dalla
        // posa con gli angoli livellati (che li farebbe sembrare di ruotare).
        let k: number;
        let inLoop = false;
        if (!introStarted || since < INTRO_HOLD_SECONDS) {
          k = 0.5; // non ancora arrivato, oppure posa di attesa
        } else if (since < INTRO_HOLD_SECONDS + INTRO_MOVE_SECONDS) {
          const p = (since - INTRO_HOLD_SECONDS) / INTRO_MOVE_SECONDS;
          k = 0.5 + 0.5 * smoothstep(clamp01(p));
        } else if (since < INTRO_HOLD_SECONDS + INTRO_MOVE_SECONDS + INTRO_SETTLE_SECONDS) {
          k = 1;
        } else {
          inLoop = true;
          // Loop a quattro fasi. Parte dal SORRISO, che e' dove finisce la
          // sequenza d'ingresso: e' mouthLoopK a garantire la continuita',
          // perche' la sua prima fase e' la permanenza sul sorriso.
          // `introElapsed - SOMMA` e' il tempo trascorso DOPO la fine della
          // sequenza, quindi il loop parte senza scarto dal sorriso.
          const loopT = since - (INTRO_HOLD_SECONDS + INTRO_MOVE_SECONDS + INTRO_SETTLE_SECONDS);
          k = mouthLoopK(loopT / MOUTH_CYCLE_SECONDS);
        }

        // ── IL PUNTO D'INNESTO DEL CONTROLLER ──
        //
        // Qui il rig calcolava i propri numeri (intro, ciclo della bocca,
        // sguardo vagante) e li disegnava. Ora li CALCOLA ANCORA, ma non li
        // usa: chiede al controller cosa disegnare e usa la risposta.
        //
        // Il rig non e' stato riscritto, e' stato solo spostato di un passo:
        // il codice che produce `k` e i valori di sguardo e' intatto e serve
        // ancora, perche' e' il ciclo autonomo che ripartira' a fine
        // sequenza. Quello che cambia e' solo quale dei due sistemi ha la
        // parola, e lo decide il controller: durante la sequenza e' lui, dopo
        // e' il rig.
        const frame = avatarController.sample(step, {
          k,
          openness: null,
          lookX: null,
          lookY: null,
          brow: null,
          loopT: 0,
          inLoop,
        });
        k = frame.k;
        inLoop = frame.inLoop;

        if (Math.abs(k - face.sent.mouth) > 0.002 || Math.abs(Number(inLoop) - face.sent.loop) > 0) {
          face.sent.mouth = k;
          face.sent.loop = Number(inLoop);
          for (const path of face.mouth) {
            const nums = inLoop
              ? lerpPath(path.closed, path.smile, k)
              : lerpPath(path.half, path.smile, clamp01((k - 0.5) * 2));
            path.el.setAttribute('d', buildPath(nums, path.template));
          }
          // Il labret segue lo stesso blend della bocca, altrimenti durante
          // l'intro si muoverebbe su una curva diversa da quella disegnata.
          const lower = face.mouth[face.lowerIndex];
          face.lowerNums = inLoop
            ? lerpPath(lower.closed, lower.smile, k)
            : lerpPath(lower.half, lower.smile, clamp01((k - 0.5) * 2));
        }

        // OCCHIO: apertura legata alla bocca. Bocca chiusa = occhi socchiusi,
        // terza posa = meta' strada, sorriso = occhi aperti. Bianco e cerchi
        // condividono lo stesso fattore, cosi' l'iride resta dentro il bianco.
        // OCCHIO: apertura legata alla bocca. Bocca chiusa = occhi socchiusi,
        // terza posa = meta' strada, sorriso = occhi aperti. Bianco e cerchi
        // condividono lo stesso fattore, cosi' l'iride resta dentro il bianco.
        //
        // Con l'idle sospeso l'apertura arriva dalla POSA, non dalla bocca: e'
        // l'unico modo per poter spalancare gli occhi nella sorpresa senza
        // aprire anche la bocca, che qui devono poter andare separati.
        const openness = frame.openness ?? EYE_CLOSED_SCALE + (1 - EYE_CLOSED_SCALE) * k;

        // Sguardo: due oscillazioni con periodi coprimi, ognuna con permanenza
        // agli estremi. Non e' piu' una somma di sinusoidi a velocita' costante:
        // l'occhio posa lo sguardo e solo dopo si sposta sul successivo.
        //
        // Il controller ha la precedenza: se e' lui a comandare (sequenza, o
        // sguardo su un bersaglio) i suoi valori vincono, e questa oscillazione
        // resta la sorgente solo quando l'idle e' libero.
        const lookX =
          frame.lookX ??
          easedWave(t, LOOK_PERIOD_A, LOOK_STAY) * 0.62 +
            easedWave(t, LOOK_PERIOD_B, LOOK_STAY) * 0.3;
        const lookY =
          frame.lookY ?? easedWave(t, LOOK_PERIOD_B * 0.61, LOOK_STAY) * 0.34;
        if (
          Math.abs(lookX - face.sent.lookX) > 0.01 ||
          Math.abs(lookY - face.sent.lookY) > 0.01 ||
          Math.abs(openness - face.sent.open) > 0.002
        ) {
          face.sent.lookX = lookX;
          face.sent.lookY = lookY;
          face.sent.open = openness;
          face.eyes.forEach((eye, i) => {
            const dx = lookX * 2.6 * (i === 0 ? 1 : -1);
            const dy = lookY * 1.8;
            // Il bianco si stringe solo in verticale: sopra e sotto.
            const w = eye.white;
            w.el.setAttribute(
              'transform',
              `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) translate(0 ${w.cy.toFixed(2)}) scale(1 ${openness.toFixed(3)}) translate(0 ${(-w.cy).toFixed(2)})`,
            );
            // Iride, pupilla e riflesso si rimpiccioliscono in modo uniforme,
            // quindi restano cerchi, ciascuno attorno al proprio centro.
            for (const part of eye.parts) {
              part.el.setAttribute(
                'transform',
                `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) translate(${part.cx.toFixed(2)} ${part.cy.toFixed(2)}) scale(${openness.toFixed(3)}) translate(${(-part.cx).toFixed(2)} ${(-part.cy).toFixed(2)})`,
              );
            }
          });
        }

        // Sopracciglia: salgono e scendono con due tempi diversi, e in piu'
        // si alzano quando la bocca e' sorridente. Anche qui il segnale posa
        // agli estremi; l'alzata si somma, non sostituisce l'oscillazione.
        //
        // Sospeso l'idle, l'alzata viene dalla posa e non dalla bocca: e'
        // l'unico modo per avere la sorpresa (sopracciglia in su, bocca
        // socchiusa) senza che le due cose siano legate a un unico numero.
        const browWave =
          easedWave(t, BROW_PERIOD_A, BROW_STAY) * 0.6 +
          easedWave(t, BROW_PERIOD_B, BROW_STAY) * 0.4;
        const brow = frame.brow ?? browWave + BROW_RAISE * k;
        if (Math.abs(brow - face.sent.brow) > 0.005) {
          face.sent.brow = brow;
          face.brows.forEach((el, i) => {
            const dy = -brow * (i === 0 ? 3.1 : 2.6);
            el.setAttribute('transform', `translate(0 ${dy.toFixed(2)})`);
          });
        }

        // LABRET: segue il labbro inferiore, quindi gli serve il centro per
        // scalare attorno a se' mentre si sposta.
        const pierce = (Math.max(...face.lowerNums.filter((_, i) => i % 2 === 1)) - face.lowerLipRestY) * PIERCING_FOLLOW;
        if (Math.abs(pierce - face.sent.pierce) > 0.01) {
          face.sent.pierce = pierce;
          const travel = face.lowerLipTravel || 1;
          const stretch = 1 + (pierce / (PIERCING_FOLLOW * travel)) * PIERCING_STRETCH;
          for (const gem of face.piercing) {
            gem.el.setAttribute(
              'transform',
              `translate(0 ${pierce.toFixed(2)}) translate(${gem.cx.toFixed(2)} ${gem.cy.toFixed(2)}) scale(1 ${stretch.toFixed(4)}) translate(${(-gem.cx).toFixed(2)} ${(-gem.cy).toFixed(2)})`,
            );
          }
        }
      }

      // PARTICELLE PUNTIFORMI. Stesso linguaggio di quelle della nebulosa:
      // nucleo minuscolo e netto, alone minimo, scia di tre campioni con opacita'
      // decrescente. Il moto usa easedWave anche lui, quindi rallenta e accelera
      // come tutto il resto del volto. Fuori scena non si disegna nulla.
      const canvas = pointCanvasRef.current;
      if (pointCtx && canvas && anyOnScreen) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        pointCtx.clearRect(0, 0, w, h);

        const place = (p: (typeof points)[number], time: number) => {
          // scarto lento attorno alla posizione base, con permanenza agli
          // estremi: la particella si ferma, poi riparte
          const travel = (easedWave(time, HERO_POINT_TRAVEL_PERIOD, HERO_POINT_TRAVEL_STAY) + 1) / 2;
          const x =
            (p.baseX + (travel - 0.5) * p.travelRange * 2 +
              easedWave(time, p.bobA, 0.25) * p.driftX) * w;
          const y = (p.baseY + easedWave(time, p.bobB, 0.3) * p.driftY) * h;
          return { x, y };
        };

        for (const p of points) {
          // scia: tre istanti precedenti lungo la stessa traiettoria
          for (let s = 0; s < HERO_POINT_TRAIL_DELAYS.length; s += 1) {
            const at = place(p, t - HERO_POINT_TRAIL_DELAYS[s]);
            const r = p.radius * 0.62;
            pointCtx.globalAlpha = p.alpha * HERO_POINT_TRAIL_OPACITIES[s];
            pointCtx.drawImage(p.sprite, at.x - r, at.y - r, r * 2, r * 2);
          }
          // nucleo
          const head = place(p, t);
          pointCtx.globalAlpha = Math.min(1, p.alpha);
          pointCtx.drawImage(
            p.sprite,
            head.x - p.radius,
            head.y - p.radius,
            p.radius * 2,
            p.radius * 2,
          );
        }
        pointCtx.globalAlpha = 1;
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };
  }, [svgMarkup]);

  // Ricentraggio: l'SVG scivola al centro insieme alla sagoma, non resta fermo a
  // sinistra. Stessa finestra e stesso punto di partenzo del canvas, quindi i due
  // viaggiano in sincrono e restano sovrapposti per tutto lo scorrimento. In
  // verticale non si sposta nulla: il blocco e' gia' centrato, il delta sarebbe
  // ~0. La finestra e il delta sono definiti piu' su, dove servono anche al volo.
  //
  // Il wrapper e' nel flesso e non ha piu' il -50%: il transform e' solo il
  // delta del ricentraggio, nient'altro.
  //
  // Il delta si spegne CON IL VOLO, perche' altrimenti continuerebbe a
  // trascinare il wrapper per tutta la durata del volo (0.9s): la ricentratura
  // non e' finita al trigger (mancano 4px) e senza questo il marchio arriverebbe
  // nell'header con uno scarto di qualche px. La correzione non va pero' sommata
  // qui dentro: e' gia' dentro `xTarget`, che e' uno scarto ASSOLUTO calcolato
  // sulla posizione a riposo. Sommarla qui la conterebbe due volte.
  const portraitX = useTransform<number, string>(
    [recenterDelta, flight],
    ([delta, f]) => `${(delta * (1 - f)).toFixed(2)}px`,
  );

  return (
    <div className="h-screen w-full bg-transparent relative overflow-hidden">
      {/* Particelle puntiformi: stesso z della nebulosa, sopra il canvas ma
          sotto tutto il blocco editoriale. pointer-events-none, quindi non
          rubano un click.
          z-35 e' il valore che RIPRODUCE i rapporti di prima: il canvas stava
          dentro lo stacking context della sezione (z-10), quindi sopra i canvas
          della nebulosa (z-0 profondo, z-25 navicelle, z-30 foreground) e sotto
          l'header (z-50). Ora che la sezione non e' piu' un contesto, il
          canvas compete al livello radice e z-35 gli restituisce esattamente
          quelle relazioni: sopra la nebulosa, sotto l'header. Il disegno non
          cambia, perche' il canvas e' `fixed inset-0` e non dipende dal padre. */}
      <canvas
        ref={pointCanvasRef}
        data-hero-point-count={HERO_POINT_COUNT}
        className="pointer-events-none fixed inset-0 z-[35] h-screen w-screen"
      />

      {/* Due navicelle "sticker": una dietro al blocco, una davanti. */}
      {/* Blocco editoriale a due colonne, centrato in entrambi gli assi come
          un'unita' sola: il contenitore centra la riga, quindi i due gutter
          laterali vengono fuori uguali. Prima ciascuna colonna aveva una `left`
          calcolata a mano e il blocco risultava spostato a sinistra (piu' aria a
          sinistra che a destra).
          Sotto md le due colonne non ci starebbero (il ritratto da solo occupa
          il 41vh): si torna allo stack centrato di prima. */}
      <div className="pointer-events-none fixed inset-0 hidden items-center justify-center md:flex">
        <div className="flex items-center" style={{ gap: `${HERO_COLUMN_GAP_PX}px` }}>
          {/* Ritratto: prima colonna. Riceve solo il delta del ricentraggio; i
              ref alimentano la geometria che il canvas usa per la sagoma. */}
          <motion.div
            ref={portraitWrapRef}
            style={{ x: portraitX }}
            className="relative z-10 min-w-0"
          >
            {/* Il VOLO avviene qui, sul contenitore che porta l'SVG, e non sul
                wrapper: il wrapper resta un flex item identico, quindi l'h2 non
                salta, e i suoi `offset*` (da cui dipende la sagoma del canvas)
                sono immuni ai transform. Lo stesso nodo che era nell'hero
                diventa il marchio dell'header: nessuna copia, quindi il rig del
                viso continua a girarci sopra e ogni modifica futura all'SVG vale
                per entrambi. L'origine `0 0` fa del vertice in alto a sinistra
                l'ancora, cosi' l'atterraggio e' esatto senza misurare la larghezza.
                I canali sono quelli DI QUESTA istanza: il set e' per nodo, quindi
                l'istanza che non vola non riceve nulla e resta al suo posto. */}
            <motion.div
              ref={portraitRef}
              style={{
                opacity: avatarOpacity,
                aspectRatio: portraitAspect,
                width: portraitWidth(PORTRAIT_MAX_VW_DESKTOP),
                x: logoDesktop.x,
                y: logoDesktop.y,
                scale: logoDesktop.scale,
                zIndex: logoDesktop.zIndex,
                transformOrigin: '0 0',
              }}
              className="relative h-auto"
            >
              <div
                ref={registerFaceHost}
                data-face-host="desktop"
                // Il ritratto e' un'immagine che si muove, non testo: senza questi
                // attributi uno screen reader ci troverebre dentro centinaia di
                // path SVG e direbbe "gruppo", "percorso", "gruppo", per quello che
                // e' un volto. `role="img"` con l'etichetta lo collassa a una
                // cosa sola e dicibile.
                role="img"
                aria-label="Ritratto animato di Max Caggiano"
                className={SVG_FIT_CLASSES}
                dangerouslySetInnerHTML={{ __html: svgMarkup }}
              />
            </motion.div>
          </motion.div>

          {/* Testo: seconda colonna, allineato a sinistra (bandiera). Il
              posizionamento orizzontale non e' calcolato: la riga flex collega
              le due colonne con il gap e il contenitore centra il tutto. Resta
              solo l'opacita' e il piccolo scorrimento in ingresso.
              max-w 42vw contiene la riga piu' lunga senza farla andare a capo,
              ed e' proporzionale al clamp del corpo, quindi su viewport minori
              testo e contenitore scalano insieme. */}
          {/* Il contenitore dei testi.

              L'opacita' qui governa l'USCITA e non l'ingresso: l'ingresso non
              e' piu' una dissolvenza pilotata dallo scroll ma uno scramble che
              risolve i caratteri sul posto. Tenere l'opacita' animata in ingresso
              significava che, a meta' ingresso, il giallo #FFD400 si mescolava al
              fondo magenta e virava all'arancio: era l'opacita' a produrre quel
              colore, non il testo. Quindi il testo parte a opacita' 1 e ci resta
              fino all'inizio della finestra di uscita, che e' quella del
              ritratto (`copyDissolve`). E' la finestra che mancava: senza, il
              titolo restava dipinto a piena opacita' dentro Works, sopra le
              card, per tutta la pagina. */}
          <motion.div
            style={{ opacity: copyDissolve }}
            className="relative z-20 shrink-0 text-left antialiased max-w-[42vw]"
          >
            {/* `tabIndex={-1}` rende l'<h2> raggiungibile dal focus senza
                metterlo nel Tab order: e' il punto di arrivo del focus a fine
                sequenza (vedi `focusHeadline`), e deve esserci senza che l'utente
                ci passi sopra con il Tab a ogni giro. Il testo accessibile e' gia'
                quello finale: i nodi di scramble sono `aria-hidden` e i gemelli
                invisibili lo sono per costruzione, quindi l'albero di
                accessibilita' contiene l'unica versione del titolo. */}
            <h2
              tabIndex={-1}
              className="font-display font-medium leading-[1.016] tracking-tight text-accent [font-size:clamp(38px,5.47vw,82.67px)]"
            >
              {/* Il testo per gli screen reader vive qui, intero e in chiaro
                  fin dal primo frame. I tre `<span>` sotto mostrano i simboli
                  e sono `aria-hidden`: se non lo fossero, un lettore vocale
                  annuncerebbe "# % _ &" per qualche secondo prima del testo
                  vero. Il risultato e' che l'etichetta accessibile e' sempre
                  quella giusta, animazione o no. */}
              <span className="sr-only">{HEADLINE_ACCESSIBLE}</span>
              {HEADLINE_ROWS.map((row, index) => (
                <span key={row} className="contents">
                  {/* Il contenitore e' `relative` e non ha larghezza propria: la
                      prende dal gemello, che e' il testo finale reso invisibile.
                      Il nodo animato e' `absolute`, quindi esce dal flusso e non
                      partecipa al calcolo della larghezza.

                      Il gemello e' la garanzia che la larghezza non dipenda dai
                      simboli: i simboli sono piu' larghi delle lettere in Clab
                      (proporzionale), e senza il gemello la colonna si
                      allargava e si restringeva a ogni tick.

                      `invisible` e non `opacity:0`: non dipinge nulla, non
                      cattura il puntatore e non entra nell'albero di
                      accessibilita'. Il nodo animato puo' sporgere di qualche px
                      oltre il gemello durante lo scramble, e va bene: sporge
                      verso destra, non sposta niente e non viene ritagliato. */}
                  <span className="relative inline-block whitespace-nowrap align-top">
                    <span className="invisible select-none" aria-hidden="true">
                      {row}
                    </span>
                    <span
                      aria-hidden="true"
                      data-scramble-row={index}
                      // VUOTO e `visibility: hidden` fino al primo giro del
                      // controller. Il testo finale qui non ci deve stare: il
                      // nodo si sovrappone al gemello ed e' quello che si
                      // vede, quindi con il testo dentro l'utente leggeva
                      // l'headline intera per qualche decimo di secondo, e poi
                      // la riga si cancellava e si ricomponeva da capo. Il vuoto
                      // da solo basterebbe — un nodo senza contenuto non
                      // disegna — ma `visibility: hidden` rende la cosa
                      // esplicita e indipendente da come il nodo viene
                      // inizializzato. Il controller toglie l'attributo nel
                      // primo giro di `start()`, che e' l'istante giusto.
                      style={{ visibility: 'hidden' }}
                      className="absolute left-0 top-0 whitespace-nowrap select-none"
                    />
                  </span>
                  {index < HEADLINE_ROWS.length - 1 ? <br /> : null}
                </span>
              ))}
            </h2>
            {/* La sub-headline sta DOVE STAVA l'h3 e ne eredita il compito: e'
                la riga che dice di cosa si occupa il sito. Prima qui c'era
                "Creo il mood e lo mantengo consistente", che e' sparito: due
                righe di testo sotto il titolo non erano una sub-headline e una
                didascalia, erano due messaggi in concorrenza.

                Space Mono e non Clab: e' il corpo con cui il sito scrive le sue
                etichette (le quote geografiche, la telemetria, le label dei
                form), e la riga fra parentesi quadre appartiene a quella
                famiglia, non ai titoli gialli.

                `data-scramble-row="subheadline"` e lo stesso attributo che il
                blocco mobile dichiara: l'orchestratore li trova entrambi e li
                anima insieme, quindi i due layout mostrano lo stesso testo
                nello stesso momento. */}
            <h3 className="mt-6 font-mono text-lg font-normal leading-[1.3] tracking-widest text-swiss-pink md:text-2xl">
              <span className="sr-only">{SUBHEADLINE}</span>
              {/* Stessa costruzione delle righe del titolo: il gemello invisibile
                  fissa la larghezza al testo finale e il nodo scramble ci passa
                  sopra in `absolute`. Qui la difesa serve meno, perche' Space Mono
                  e' monospaziata e ogni carattere occupa lo stesso spazio, ma la
                  riga deve essere larga uguale quando la sequenza non c'e'
                  (`?skip`, movimento ridotto) e larga uguale quando c'e'. */}
              <span className="relative inline-block whitespace-nowrap align-top">
                <span className="invisible select-none" aria-hidden="true">
                  {SUBHEADLINE}
                </span>
                <span
                  aria-hidden="true"
                  data-scramble-row="subheadline"
                  // Come le righe dell'headline: vuota e nascosta, e il
                  // controller la riempie di simboli al suo primo giro.
                  style={{ visibility: 'hidden' }}
                  className="absolute left-0 top-0 whitespace-nowrap select-none"
                />
              </span>
            </h3>
          </motion.div>
        </div>
      </div>

      {/* Mobile: comportamento verticale di prima, testo sopra il ritratto. */}
      <div className="flex h-full flex-col items-center justify-start md:hidden">
        {/* Mobile: stesso testo e stesso trattamento del desktop. Qui il titolo
            e' su una riga sola, perche' il layout mobile e' diverso: la
            sub-headline prende il posto del titolo e non si aggiunge un
            blocco che non c'era. Il nodo ha lo stesso `data-scramble-row`, e
            l'orchestratore li scramblea entrambi perche' ne trova due per lo
            stesso attributo. */}
        <motion.div
          style={{ opacity: copyDissolve }}
          className="pointer-events-none fixed left-0 right-0 top-[146px] z-20 text-center font-display text-[1.40625rem] font-medium tracking-tight text-accent antialiased"
        >
          <span className="sr-only">{SUBHEADLINE}</span>
          <span className="relative inline-block whitespace-nowrap align-top">
            <span className="invisible select-none" aria-hidden="true">
              {SUBHEADLINE}
            </span>
            <span
              aria-hidden="true"
              data-scramble-row="subheadline"
              style={{ visibility: 'hidden' }}
              className="absolute left-0 top-0 whitespace-nowrap select-none"
            />
          </span>
        </motion.div>
        <motion.div
          style={{ x: '-50%', y: '-50%' }}
          className="pointer-events-none fixed left-1/2 top-1/2 z-10"
        >
          {/* Stesso volo del desktop e stessi estremi: le due istanze dell'SVG
              sono gia' due nodi distinti perche' il layout mobile e' diverso, ma
              il Marchio e' uno solo per viewport, e questa e' l'istanza visibile
              sotto md. Anche qui i canali sono quelli dell'istanza: senza, il
              volo del desktop scriveva su questo nodo e il layout mobile mostrava
              un secondo ritratto trascinato fuori posto. */}
          <motion.div
            ref={mobilePortraitRef}
            style={{
              opacity: avatarOpacity,
              aspectRatio: portraitAspect,
              width: portraitWidth(PORTRAIT_MAX_VW_MOBILE),
              x: logoMobile.x,
              y: logoMobile.y,
              scale: logoMobile.scale,
              zIndex: logoMobile.zIndex,
              transformOrigin: '0 0',
            }}
            className="relative h-auto"
          >
            <div
              ref={registerFaceHost}
              data-face-host="mobile"
              // Stessa etichetta della versione desktop: le due istanze non
              // possono descriversi diversi, altrimenti un screen reader
              // riceverebbe due nomi per lo stesso volto e uno dei due
              // cambierebbe in base alla larghezza della finestra.
              role="img"
              aria-label="Ritratto animato di Max Caggiano"
              className={SVG_FIT_CLASSES}
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          </motion.div>
        </motion.div>
      </div>

      <ScrollHint
        opacity={dissolveOpacity}
        autoStart={false}
        scrambleText="[SCORRI PER DISSOLVERE ↓]"
        onResolved={onHintResolved}
      >[SCORRI PER DISSOLVERE ↓]</ScrollHint>
    </div>
  );
}


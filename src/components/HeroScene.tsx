import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
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
import { announceHeroReady, settleHero, scrollToHero } from '@/lib/heroEntryControl';
import { entryState } from '@/lib/entryState';
import { reducedMotion } from '@/lib/motionPreference';
import {
  HERO_COLUMN_GAP_PX,
  HERO_PORTRAIT_HEIGHT_PX,
  HERO_PORTRAIT_HEIGHT_VH,
  clamp01,
  portraitFlightWindow,
  portraitRevealPhase,
  publishPortraitGeometry,
  readSceneTop,
  smoothstep,
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

// Due nomi per lo stesso nodo, perche' e' lo stesso nodo in due posti diversi.
// Nell'hero il ritratto e' un'immagine e si presenta come tale; nell'header e' il
// marchio, e li' quello che conta non e' che cosa si vede ma che cosa succede
// quando lo si preme. Le due stringhe sono costanti e non state perche' descrivono
// il RUOLO del ritratto, che non cambia nel tempo: cambia solo il posto in cui il
// ritratto si trova.
const PORTRAIT_LABEL = 'Ritratto animato di Max Caggiano';
const HEADER_MARK_LABEL = 'Torna alla prima pagina';
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
// QUANTO SCORRE IL VOLO.
//
// La quota e' `PORTRAIT_LOGO_FLIGHT_RATIO`, che vive in scrollMath e non qui:
// la legge anche `shapeRecenterPhase`, e i due movimenti devono arrivare insieme.
// Tenere qui il numero e' stato quello che li ha disaccoppiati.
//
// Il volo ha quindi un suo spazio, ancorato a un QUOTA della finestra di
// dissoluzione e non a un numero di px: cosi' non dipende dalla viewport e resta
// proporzionato a quanto deve durare la salita. Prima `PORTRAIT_LOGO_LEAD_PX`
// era 4: il volo partiva 4px prima della fine della dissoluzione e disponeva
// quindi di 4px di viaggio, e il ritratto letteralmente non poteva salire —
// misurato: centro invariato a 426,390 per tutto il primo 70% della finestra, e
// un salto finale di 406px nell'ultimo 10%. I difetti "passa dal centro" e
// "ritorno diagonale" venivano entrambi da un tratto troppo corto per contenere
// una traiettoria.
//
// Parte prima che l'SVG termini di dissolversi, cosi' l'occhio vede l'avatar
// che sale mentre si affiora la sagoma sulla sua stessa posizione — i due si
// sostituiscono invece di scomparire e ricomparire altrove. Nessun numero
// magico: e' una quota della finestra, come gli altri confini di navigazione in
// scrollMath.
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
// IL VOLO NON HA PIU' UNA DURATA.
//
// Prima era un'animazione a tempo (`animate(flight, 1, { duration })`): partiva
// al superamento della soglia e saliva per 0.9s INDIPENDENTEMENTE da quanto
// l'utente scrollasse. Da qui i due difetti segnalati: il ritratto attraversava
// il centro dello schermo — perche' la sua traiettoria era una retta fra due
// punti lontani — e il ritorno rientrava in diagonale tagliando la pagina. Inoltre
// a durata fissa un'inversione a meta' viaggio produceva uno scatto: l'animazione
// andava avanti mentre il ritratto tornava indietro.
//
// Ora `flight` e' una funzione del PROGRESS dello scroll: l'andata e il ritorno
// sono lo stesso moto letto al contrario, e valgono a qualunque velocita' di
// gesto. Non esiste piu' nessun tempo, esiste solo la posizione.
//
// Gli esponenti delle due curve sono la FORMA del percorso, e vanno letti con
// attenzione perche' la curva Y e' `1 - (1 - f)^exp`.
//
// Con l'esponente MAGGIORE di 1 la Y sale subito e piano alla fine (ease-out:
// parte al massimo pendio e decelera), quindi ANTICIPA. Con l'esponente minore di
// 1 la farebbe rallentare all'inizio — cioe' il contrario di una salita: e'
// esattamente il difetto che c'era, con 0.55 Y e 2.2 X, dove a meta' viaggio Y
// aveva percorso il 32% e non il 70% che si credeva.
//
// I valori sono quindi di lettura, non estetici: con Y = 2.2 e X = 3.6, a poco
// piu' di meta' volo Y ha percorso l'83% della strada e X il 13%, e al 30% Y
// e' al 54% mentre X e' al 2% — il ritratto e' gia' in alto mentre l'orizzontale
// e' quasi tutto da fare, cioe' il primo 60% del movimento si legge come una
// salita. L'orizzontale chiude negli ultimi due quinti, quando il ritratto e'
// gia' piccolo e l'attenzione e' sul marchio.
const Y_EASE_OUT_EXP = 2.2;
const X_EASE_IN_EXP = 3.6;

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
  // `restX/restY` sono la posizione REALE dell'avatar a riposo, in coordinate di
  // viewport: il punto in cui il nodo sta quando `flight` e' a 0.
  //
  // Sono una base, non uno scarto, e questa e' la differenza che elimina il salto
  // all'ingresso nel layer. Prima `xTarget` era lo SCARTO (dove sta lo slot meno
  // dove siamo), e `x = xTarget * ease(f)`: a `flight` appena maggiore di 0 la
  // trasformazione era praticamente zero, quindi il nodo — entrato nel layer, che
  // ha base nell'origine della viewport — si posizionava li' invece che dove
  // stava. Misurato: un salto di 239px nel primo frame del volo.
  //
  // Ora `x` e' un'INTERPOLAZIONE fra due posizioni reali: a flight 0 vale
  // `restX` (dove sta l'avatar) e a flight 1 vale `xTarget` (lo slot dell'header).
  // Il nodo entra nel layer gia' nella posizione giusta, e da li' sale. Non c'e'
  // piu' nessun istante in cui i due contesti non coincidono.
  const restX = useMotionValue(0);
  const restY = useMotionValue(0);
  // `xTarget` e `yTarget` sono le coordinate ASSOLUTE dello slot dell'header,
  // non piu' scarti: e' la fine dell'interpolazione.
  const xTarget = useMotionValue(0);
  const yTarget = useMotionValue(0);
  const heroHeight = useMotionValue(1);
  const slotHeight = useMotionValue(1);
  // LA SALITA, non la diagonale.
  //
  // Y e X camminano su due curve DIVERSE dello stesso `flight`: Y parte subito e
  // arriva presto (ease-out), X aspetta e poi chiude (ease-in). Il ritratto cosi'
  // sale quasi in verticale per i primi ~60% del viaggio e l'orizzontale lo
  // raggiunge solo dopo, e il movimento si legge come "sale verso l'alto a
  // sinistra" invece che come "taglia il centro dello schermo".
  //
  // Le due curve hanno gli STESSI estremi di `flight` (0 e 1), quindi il nodo
  // parte e atterra esattamente dove deve: e' la posizione finale a essere
  // garantita, non la forma del percorso.
  const yEase = useTransform(flight, (f) => 1 - Math.pow(1 - f, Y_EASE_OUT_EXP));
  const xEase = useTransform(flight, (f) => Math.pow(f, X_EASE_IN_EXP));
  // Interpolazione fra le due posizioni reali: `da + (a - da) * ease`.
  const x = useTransform<number, number>(
    [xEase, restX, xTarget],
    ([f, from, to]) => from + (to - from) * f,
  );
  const y = useTransform<number, number>(
    [yEase, restY, yTarget],
    ([f, from, to]) => from + (to - from) * f,
  );
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
    () => ({ restX, restY, xTarget, yTarget, heroHeight, slotHeight, x, y, scale, zIndex }),
    [restX, restY, xTarget, yTarget, heroHeight, slotHeight, x, y, scale, zIndex],
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
    ),
  );
  // VOLO VERSO L'HEADER. `flight` e' l'unica sorgente di verita' del movimento:
  // lo guida sia l'andata sia il ritorno, quindi i due non possono disaccordarsi.
  //
  // E' un `useTransform` sullo SCROLL, non un valore animato a mano. Prima era un
  // `useMotionValue(0)` che un `animate(..., { duration })` portava a 1: il volo
  // aveva una durata propria e non obbediva al gesto, quindi un'inversione a
  // meta' viaggio non produceva il ritorno ma uno scatto, e una sosta a meta'
  // lasciava il ritratto fermo a mezz'aria mentre la pagina andava avanti.
  //
  // Ora `flight` e' il progress della finestra di volo letto sullo scroll: a
  // ogni posizione corrisponde UN ritratto, e basta. Lo stato non e' accumulato,
  // quindi scroll veloce, inversioni e salti di sezione non possono produrre
  // glitch: non c'e' niente da "dimenticare", si ricalcola tutto da capo ogni
  // frame. Lo 0 e l'1 coincidono con i due estremi della finestra, quindi alle
  // estremita' il ritratto e' esattamente al suo posto o esattamente nel marchio.
  const flight = useTransform(scrollY, (value) => {
    const heroTop = readSceneTop('hero');
    const nebulaTop = readSceneTop('nebula');
    if (!heroTop || !nebulaTop) return 0;
    // Il volo occupa gli ultimi due terzi della dissoluzione e finisce con lei,
    // e la finestra e' la STESSA che legge il ricentraggio della sagoma: quando
    // tornano in hero i due arrivano insieme, e non uno di corsa davanti all'altro.
    const { start: flyAt, end } = portraitFlightWindow(heroTop, nebulaTop);
    if (end <= flyAt) return 0;
    // CON MOVIMENTO RIDOTTO: NESSUN VOLO.
    //
    // L'utente che ha chiesto meno animazione non deve vedere un ritratto che
    // attraversa lo schermo. Qui `flight` resta 0 e il ritratto non si muove: si
    // spegne semplicemente nel momento in cui la sagoma affiora, e la sagoma —
    // essendo generata sulla sua posizione e alla sua scala — appare dove lui
    // era. E' un crossfade, cioe' due immagini che si sostituiscono, e non un
    // movimento mascherato.
    //
    // Resta una funzione dello scroll come tutto il resto, quindi l'inversione a
    // meta' e' senza glitch anche qui: non c'e' nessuno stato da ricordare.
    if (reducedMotion) return 0;
    return clamp01((value - flyAt) / (end - flyAt));
  });
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
  // Il ritratto E' il marchio dell'header: quando e' a terra, e' un pulsante che
  // riporta alla prima pagina; quando e' nella colonna dell'hero, e' solo
  // un'immagine e non deve nemmeno essere nel tab order.
  //
  // Lo stato segue `logoPhaseRef` per TRANSIZIONE e non a ogni frame: la ref
  // cambia una volta per andata e una per ritorno, quindi il render di React
  // accade due volte e non accompagna il volo.
  //
  // Va tenuto in uno stato e non letto dalla ref al render perche' il DOM e' gia'
  // altrove quando `logoPhaseRef` cambia: al render la ref direbbe "marchio"
  // mentre il nodo e' ancora in volo, e il pulsante accetterebbe i click
  // nell'istante in cui non e' ancora cliccabile.
  const [inHeader, setInHeader] = useState(false);
  // Il click non fa nient'altro che chiedere alla pagina di tornare su: lo scroll
  // lo possiede il provider, quindi la richiesta passa dal ponte.
  //
  // Il guard `inHeader` non e' paranoia. Il nodo viene spostato nel layer radice
  // durante il volo e i click possono arrivare mentre e' li' appoggiato: senza,
  // una pressione durante l'atterraggio rimanderebbe a una prima pagina che si
  // sta ancora riaprendo sotto gli occhi di chi ha premuto.
  const handleMarkClick = useCallback(() => {
    if (!inHeader) return;
    scrollToHero();
  }, [inHeader]);
  // Dove il nodo del ritratto sta nel markup, per poterlo rimettere a posto al
  // Il click del marchio e' un listener NATIVO e non un `onClick` di React, perche'
  // il nodo quando il marchio e' a terra sta FUORI da `#root`: il layer radice e' un
  // figlio di `document.body` e React dalla 17 delega alla radice dell'app, non a
  // `document`. Un `onClick` non lo vedrebbe piu', e il click arriverebbe al nodo
  // senza risalire. Il listener e' agganciato al nodo stesso, quindi lo segue nel
  // volo e vale in entrambi i posti.
  //
  // Vive qui e non vicino a `handleMarkClick` perche' usa i due ref del ritratto,
  // che sono dichiarati sotto.
  useEffect(() => {
    const attach = (node: HTMLElement | null) => {
      node?.addEventListener('click', handleMarkClick);
      return () => node?.removeEventListener('click', handleMarkClick);
    };
    const detachDesktop = attach(portraitRef.current);
    const detachMobile = attach(mobilePortraitRef.current);
    return () => {
      detachDesktop();
      detachMobile();
    };
  }, [handleMarkClick]);

  // rientro. Serve perche' il volo lo sposta in un layer radice (vedi
  // `ensureLogoLayer`): senza questo, tornare all'hero lascerebbe il volto nel
  // layer e l'hero sembrerebbe senza ritratto.
  const logoOriginRef = useRef<{ parent: HTMLElement; next: ChildNode | null } | null>(
    null,
  );
  const controlsRef = useRef<AnimationPlaybackControls | null>(null);

  // Il ritratto entra con l'INGRESSO e POI VOLA: non si dissolve piu'.
  //
  // L'opacita' dipende dallo STATO D'INGRESSO: non da un valore costante e non
  // da soglie di scroll. Entrambe le altre forme erano sbagliate, ognuna per un
  // motivo diverso e per un caso diverso.
  //
  // Costante 1: al mount lo stato e' `preloader` e nessuno ha ancora chiamato
  // `prepareAvatar` (che agisce quando la sequenza parte, non prima), quindi il
  // ritratto era dipinto dietro il preloader — un viso immobile sotto il titolo.
  // Prima lo nascondeva per CASO la formula di scroll, non per progetto.
  //
  // Soglie di scroll: a scroll 0 — la posizione di riposo dopo il preloader, e il
  // punto in cui il magnete riporta la pagina al ritorno dalla Works — davano
  // ZERO, quindi al ritorno l'avatar spariva. E' il difetto che il valore
  // costante correggeva, e che non si puo' correggere tornando indietro.
  //
  // Lo stato e' l'unica sorgente che risponde a entrambe le domande: se il
  // ritratto deve esserci, e in che momento. Da `entering` in poi l'opacita'
  // resta 1 e la visibilita' la governa `avatarEntry`: `prepareAvatar` nasconde
  // prima della partitura, `enterAvatar` mostra al suo istante.
  //
  // Il ritratto non si dissolve: se si spegnesse insieme alle particelle, al
  // trigger ci sarebbe un buco, perche' la sagoma e' ancora in formazione e il
  // disegno che copriva l'avrebbe gia' abbandonata. Il fattore di dissoluzione
  // resta su h2 e hint, che devono spegnersi nella finestra condivisa con il
  // rilascio delle particelle.
  const stageOpacity = useMotionValue(entryState.get() === 'preloader' ? 0 : 1);
  useEffect(
    () =>
      // Sottoscrizione, non lettura una volta sola: senza, un ingresso che
      // riparte lascerebbe l'opacita' ferma al valore del mount, che e' 0
      // quando la pagina e' gia' in hero.
      entryState.subscribe((state) => {
        stageOpacity.set(state === 'preloader' ? 0 : 1);
      }),
    [stageOpacity],
  );
  const avatarOpacity = stageOpacity;

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
  // `HTMLButtonElement` e non `HTMLDivElement`: il nodo che riceve questo ref e'
  // il marchio, che e' un `motion.button`. Il tipo segue il tag, altrimenti
  // `tsc -p tsconfig.app.json` segnala un RefObject non assegnabile — ed e'
  // l'unico dei due type-check che lo vede, perche' quello di radice non
  // comprende i .tsx.
  const portraitRef = useRef<HTMLButtonElement>(null);
  const mobilePortraitRef = useRef<HTMLButtonElement>(null);
  // Il punto di riposo in X, in un REF e non in uno stato: nasce qui, molto prima
  // che la misura del layout sia disponibile, e uno stato usato in quel punto
  // darebbe un errore a runtime che TypeScript non segnala. Serve solo a pubblicare
  // la geometria del ritratto al canvas, che campiona la sagoma su questa posizione.
  //
  // Il ricentraggio che stava qui e' sparito: e' la camera a ricentrarsi (vedi
  // ParticleNebulaCanvas) e il wrapper non deve piu' scivolare al centro, altrimenti
  // il ritratto attraverserebbe lo schermo invece di salire. Non restano canali di
  // ricentraggio qui, quindi il wrapper non ha trasformazioni da applicare.
  const portraitRestXRef = useRef(0);
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
        // IL RIPOSO SI MISURA SOLO QUI, e solo una volta.
        //
        // Il nodo e' ancora nella colonna dell'hero quando questa funzione gira per
        // la prima volta, quindi il suo rect e' la posizione a riposo vera. Dopo lo
        // spostamento nel layer la stessa lettura restituirebbe la posizione rispetto
        // all'origine della viewport, cioe' prossima a zero: rileggerla allora
        // azzererebbe la base e il ritratto entrerebbe nel layer a coordinate
        // sbagliate. Percio' la condizione `parentElement !== layer` e' la difesa,
        // non un dettaglio.
        if (active.parentElement !== layer) {
          const restRect = active.getBoundingClientRect();
          canali.restX.set(restRect.x);
          canali.restY.set(restRect.y);
        }
        canali.xTarget.set(slot.left);
        canali.yTarget.set(slot.top);
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
        // LA BASE DEL VOLO: DUE POSIZIONI REALI, NON UNO SCARTO.
        //
        // Il layer e' `position: fixed; inset: 0`, quindi suo figlio ha base
        // nell'origine della viewport; l'avatar a riposo sta invece nella colonna
        // editoriale. Se il volo fosse stato uno scarto misurato dall'origine (come
        // era, `restLeft = restTop = 0`), entrare nel layer avrebbe spostato il
        // ritratto di tutta la differenza fra le due basi: misurato, 237px in X e
        // 148px in Y nel primo frame del volo — l'istante in cui l'occhio e' gia'
        // sul ritratto.
        //
        // Quindi `x` e `y` interpolano fra DUE posizioni reali: `restX/restY` (dove
        // sta l'avatar, letti dal DOM mentre il nodo e' ancora nella colonna) e lo
        // slot dell'header. Il nodo entra nel layer con la base gia' scritta e si
        // posiziona dove stava: il salto non esiste piu' perche' non c'e' piu' una
        // base da riconoscere.
        //
        // E' una misura, non un numero: cambia con il breakpoint, con la larghezza
        // e con il font, quindi non si puo' scrivere a mano.
        // La base e' gia' stata misurata e scritta qui sopra, PRIMA che il nodo
        // entrasse nel layer: e' l'unico momento in cui la sua posizione di riposo
        // e' leggibile, perche' nella colonna ha una base di layout e nel layer ha
        // l'origine della viewport. Rileggerla ora la azzererebbe.
        //
        // Lo spostamento nel layer avviene qui, DOPO la misura: li' il nodo non e'
        // piu' sottoposto al contesto della colonna editoriale e emerge davvero
        // sopra l'header, ma la base gia' scritta lo tiene esattamente dove stava,
        // quindi non c'e' nessun salto — misurato, senza questo erano 237px in X e
        // 148px in Y, cioe' l'istante in cui l'occhio e' gia' sul ritratto.
        //
        // Il padre e il fratello successivo vengono ricordati per il rientro:
        // senza, il nodo resterebbe nel layer e l'hero perderebbe il volto.
        const host = active.parentElement;
        if (host && host !== layer) {
          logoOriginRef.current = { parent: host, next: active.nextSibling };
          layer.appendChild(active);
        }
        canali.yTarget.set(slot.top);
        // L'altezza di LAYOUT per la scala, non quella del rect: il rect include
        // la scala corrente, e a meta' volo la userebbe per raddoppiarla. La base
        // deve essere la dimensione a riposo, che e' cio' che la colonna occupa.
        canali.heroHeight.set(active.offsetHeight);
        canali.slotHeight.set(slot.height);
        // NESSUNA ANIMAZIONE: `flight` è già la posizione, calcolata dallo
        // scroll. Qui si misurano solo gli ESTREMI (dove sta il marchio, quanto è
        // alto), che restano fermi per tutta la sessione finché il layout non
        // cambia. Il moto lo fa lo scroll, non un clock.
        return;
      }
      // ── RIENTRO ────────────────────────────────────────────────────────────
      // Il ritorno non e' un caso separato: e' lo stesso moto dell'andata letto al
      // contrario, perche' `flight` e' una funzione dello scroll e non un valore
      // animato. Scendendo il ritratto ripercorre esattamente la salita al
      // contrario — nessun caso speciale, nessuna durata diversa.
      //
      // Il problema che questo codice aveva una volta — e che la nota sotto
      // descriveva — era il cambio di CONTESTO: il nodo vive nella colonna dell'hero
      // e durante il volo vive in un layer radice, e i due hanno basi diverse
      // (misurato: 190px di scarto), quindi rientrare attraversava un salto. Lo
      // salto c'era perche' il nodo veniva rimesso nel markup DOPO che il canale
      // aveva gia' cominciato a rientrare.
      //
      // Ora il trigger e' `flight` che torna a 0, quindi il nodo torna nel markup
      // nell'ISTANTE in cui il ritratto e' al suo posto e non un frame dopo: il
      // salto non e' piu' visibile perche' non c'e' piu' un frame in cui i due
      // sistemi non coincidono.
      //
      // Prima di rimisurare il nodo torna nel suo posto nel markup: il layer serve
      // solo mentre il marchio e' in header, e lasciarlo li' priverebbe l'hero
      // del volto al ritorno.
      //
      // Tornando nel markup il nodo riacquisisce la sua posizione di colonna,
      // quindi i canali di interpolazione vanno rimessi a zero: `restX/restY` a 0
      // e gli estremi dell'header a 0. Cosi', con `flight` che torna a 0, la
      // trasformazione vale `0 + (0 - 0) * 0 = 0` — il nodo e' esattamente nella
      // posizione che il layout gli assegna, senza correzioni da applicare.
      const via = logoOriginRef.current;
      if (via && active.parentElement === layer) {
        via.parent.insertBefore(active, via.next);
        logoOriginRef.current = null;
      }
      canali.restX.set(0);
      canali.restY.set(0);
      canali.xTarget.set(0);
      canali.yTarget.set(0);
      canali.heroHeight.set(1);
      canali.slotHeight.set(1);
      // NESSUNA ANIMAZIONE ANCHE QUI: il ritorno e' lo stesso moto dell'andata
      // letto al contrario, e lo produce lo scroll scendendo. Un `animate` verso 0
      // avrebbe potuto far concorrenza al gesto, ed e' esattamente il doppio
      // canale che questo intervento elimina.
    },
    [logoDesktop, logoMobile, portraitRef, mobilePortraitRef],
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
  // IL RITORNO DALLA SEZIONE LAVORI.
  //
  // Qui si RIPRISTINA la prima pagina, e il motivo e' che senza questo richiamo il
  // ritorno non riproduceva l'ingresso: la sequenza partiva una volta sola, al
  // click del preloader, e niente la richiamava, quindi tornati dalla Works la
  // pagina si ritrovava a meta' ingresso — solo titolo e sottotitolo, avatar e
  // coordinate assenti. Non era un flag che non veniva riletto: era che l'ingresso
  // non aveva un'uscita.
  //
  // Si chiama `settleHero` e NON l'ingresso. La differenza e' tutta la questione
  // del ritorno: l'ingresso riproduce l'ARRIVO dal preloader (il viso che entra,
  // il testo che si compone, l'attesa della sorpresa) e ci mette secondi. Sul
  // ritorno l'utente sta tornando a una pagina che CONOSCE, e un ritardo si
  // legge come un difetto: il testo che si ricompone e il ritratto che sale da
  // sotto sono esattamente il lag segnalato. `settleHero` mette tutto a posto
  // di colpo — testo in forma finale, ritratto al suo posto, coordinate e
  // prompt accesi — ed e' idempotente.
  //
  // L'arma parte DISARMATA di proposito. Armata, il richiamo sarebbe scattato al
  // primo micro-scroll della pagina: `runHeroEntry` riavviava l'intera partitura
  // e `prepareAvatar` rimetteva il ritratto a `translateY(12px) scale(0.96)` con
  // `clip-path: inset(6% 0 0 0)` — cioe' tagliato in alto — mentre le righe si
  // riaprivano. Perche' scatti solo al ritorno vero, l'arma si carica soltanto
  // quando la pagina e' SALITA oltre la soglia di dissoluzione (`value >= start`,
  // il ramo qui sotto), e si scarica quando torna sotto. Ogni andata e ritorno
  // consecutivi cosi' produce un ripristino e uno solo, e non uno a ogni frame.
  // IL RIPRISTINO AL RITORNO.
  //
  // Va agganciato allo STESSO istante in cui il volo si azzera, perche' e' li'
  // che la prima pagina e' di nuovo la scena corrente. Non ha timer e non
  // ricompone nulla: rimette a posto testo, ritratto, coordinate e prompt di
  // colpo, quindi non introduce alcun ritardo (vedi `settleHero` in
  // EntrySequence, che spiega perche' il ritorno non richiami l'ingresso).
  const wasFlyingRef = useRef(false);
  useMotionValueEvent(flight, 'change', (f) => {
    if (f > 0) {
      wasFlyingRef.current = true;
      return;
    }
    if (!wasFlyingRef.current) return;
    wasFlyingRef.current = false;
    settleHero();
  });

  // DOVE STA IL NODO: il layer radice quando il volo e' in corso, la colonna
  // dell'hero quando non lo e'.
  //
  // Anche questo e' derivato da `flight` e non da una soglia propria: il nodo e
  // lo stato del volo non possono quindi trovarsi discordi. E' la condizione che
  // rende il ritorno speculare — quando `flight` torna a 0 il nodo e' gia' nella
  // colonna, nell'istante in cui il ritratto arriva al suo posto, e non un
  // frame dopo (che era il lampo che si vedeva tornandogli sopra).
  useMotionValueEvent(flight, 'change', (f) => {
    const phase = logoPhaseRef.current;
    if (f > 0) {
      if (phase !== 'away') {
        logoPhaseRef.current = 'away';
        setInHeader(true);
        startFlight(1);
      }
    } else if (phase === 'away') {
      logoPhaseRef.current = 'home';
      setInHeader(false);
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
  //
  // Qui si dichiara anche CHE LA PRIMA PAGINA E' COMPLETA. E' lo stesso
  // istante: quando il prompt ha finito di comporsi, l'avatar ha gia' finito
  // l'ingresso (la sorpresa e' finita da un pezzo, e' l'ingresso che viene
  // prima), le coordinate sono scritte, e da qui l'utente puo' andare avanti.
  // Le coordinate accendono la propria opacita' su questo segnale invece che
  // su una soglia di scroll, cosi' tornano anche al richiamo dell'ingresso
  // dalla sezione lavori.
  const onHintResolved = useCallback(() => {
    announceHeroReady();
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
    // Il wrapper e' nel flusso (nessuna `left` in percentuale, nessuna
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
    // LA BASE DEL VOLO NON SI SCRIVE QUI.
    //
    // Questa funzione gira al mount, a ogni ResizeObserver e a ogni resize, quindi
    // anche mentre il nodo e' nel layer — e li' il rect non e' la posizione a
    // riposo ma quella rispetto all'origine della viewport, gia' traslata dal volo
    // in corso. Scriverla sposterebbe la base, e il ritratto entrerebbe nel layer a
    // coordinate sbagliate al volo successivo: misurato, la base finiva a 472,145
    // invece di 236,145, cioe' la posizione corrente sommata due volte.
    //
    // La base si misura in un SOLO punto, dentro `startFlight`, e solo se il nodo
    // non e' ancora nel layer: li' e' l'unico istante in cui la posizione di riposo
    // e' davvero leggibile. Qui si pubblica solo la geometria per il canvas, che
    // usa `offsetLeft/offsetTop` — valori di layout, immuni ai transform.
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

  // DOVE STA IL WRAPPER.
  //
  // Il wrapper NON ricentra piu': e' la camera a portare la scena al centro
  // (vedi ParticleNebulaCanvas), quindi l'SVG deve restare dov'e' nell'hero per
  // tutta la dissoluzione e salire dritto verso lo slot dell'header.
  //
  // Prima il wrapper scivolava al centro della viewport e il ritratto
  // attraversava lo schermo: era quello il "passa dal centro" segnalato, e veniva
  // da qui e non dalla forma della traiettoria. Con il ricentraggio spostato
  // alla camera il wrapper non ha piu' nulla da fare, e la sua trasformazione
  // sparisce: nessun px da correggere, nessun doppio canale, nessun lampo.
  const portraitX = '0px';

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
            <motion.button
              ref={portraitRef}
              type="button"
              data-header-mark
              tabIndex={inHeader ? 0 : -1}
              // Le due etichette stanno QUI e non sull'elemento interno: se
              // stessero piu' in basso, il pulsante non avrebbe nessun nome e uno
              // screen reader direbbe solo "pulsante" a voce, che per il marchio
              // dell'header significa non dire nulla.
              //
              // Nell'hero il ruolo e' quello di immagine, cosi' il nodo si presenta
              // come prima del pulsante; nell'header e' un comando e l'etichetta
              // diventa la sua azione. L'attributo `role` sull'interno, insieme a
              // questa etichetta, farebbe dire al marchio "Torna alla prima pagina,
              // immagine Ritratto animato": due nomi sovrapposti che non sono
              // nessuna delle due cose.
              role={inHeader ? undefined : 'img'}
              aria-label={inHeader ? HEADER_MARK_LABEL : PORTRAIT_LABEL}
              style={{
                opacity: avatarOpacity,
                aspectRatio: portraitAspect,
                width: portraitWidth(PORTRAIT_MAX_VW_DESKTOP),
                x: logoDesktop.x,
                y: logoDesktop.y,
                scale: logoDesktop.scale,
                zIndex: logoDesktop.zIndex,
                transformOrigin: '0 0',
                // Il layer radice che ospita il marchio ha `pointer-events: none`
                // per non intercettare nulla, ma un discendente che li riaccende
                // continua a riceverli: basta il figlio, il layer resta intatto.
                pointerEvents: inHeader ? 'auto' : 'none',
              }}
              // `block` esplicitamente: il nodo era un `div` e il `button` che lo
              // sostituisce nasce `inline-block`. Il preflight azzera padding e
              // bordi, ma non il display, e da inline il ritratto si appoggerebbe
              // sulla baseline aggiungendo sotto di se' lo spazio del descender:
              // qualche pixel che sposterebbe l'hero e la sagoma del canvas.
              className={`relative block h-auto ${inHeader ? 'cursor-pointer' : ''}`}
            >
              <div
                ref={registerFaceHost}
                data-face-host="desktop"
                // Il nome e il ruolo sono sul pulsante che avvolge questo div,
                // non qui dentro: due etichette sovrapposte farebbero
                // descrivere il ritratto due volte. Qui resta solo il volto.
                className={SVG_FIT_CLASSES}
                dangerouslySetInnerHTML={{ __html: svgMarkup }}
              />
            </motion.button>
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
          <motion.button
            ref={mobilePortraitRef}
            type="button"
            data-header-mark
            tabIndex={inHeader ? 0 : -1}
            // Stessa etichetta e stessa logica della versione desktop, e per lo
            // stesso motivo le due istanze non possono descriversi diverse: uno
            // screen reader riceverebbe due nomi per lo stesso volto e uno dei due
            // cambierebbe in base alla larghezza della finestra.
            role={inHeader ? undefined : 'img'}
            aria-label={inHeader ? HEADER_MARK_LABEL : PORTRAIT_LABEL}
            style={{
              opacity: avatarOpacity,
              aspectRatio: portraitAspect,
              width: portraitWidth(PORTRAIT_MAX_VW_MOBILE),
              x: logoMobile.x,
              y: logoMobile.y,
              scale: logoMobile.scale,
              zIndex: logoMobile.zIndex,
              transformOrigin: '0 0',
              pointerEvents: inHeader ? 'auto' : 'none',
            }}
            // `block` per lo stesso motivo della versione desktop: il nodo era un
            // `div` e il preflight non azzera il display di un `button`.
            className={`relative block h-auto ${inHeader ? 'cursor-pointer' : ''}`}
          >
            <div
              ref={registerFaceHost}
              data-face-host="mobile"
              // Il nome e il ruolo sono sul pulsante che avvolge questo div,
              // non qui dentro: due etichette sovrapposte farebbero descrivere
              // il marchio due volte. Qui resta solo il volto, che e il contenuto.
              className={SVG_FIT_CLASSES}
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          </motion.button>
        </motion.div>
      </div>

      {/* Il prompt di scorrimento dell'hero: si ACCENDE e resta animato in idle,
          non si compone. Il cambio caratteri e' la tecnica per un titolo che
          arriva (le righe dell'headline), mentre qui il testo e' gia' noto e deve
          solo comparire quando la pagina e' pronta: entrarlo con i simboli lo
          faceva leggere come un altro titolo che si sta scrivendo.

          Resta `autoStart={false}` perche' l'ordine richiesto e' che il prompt
          compaia DOPO l'ingresso dell'avatar: a chiamarlo e' la sequenza, al suo
          tempo (ENTRY_CONFIG.scrollHintStart), non il componente al mount. E'
          esattamente il modello degli altri hint della pagina (vedi NebulaScene),
          con la stessa classe `.scroll-hint-pulse` che li tiene animati in idle. */}
      <ScrollHint opacity={dissolveOpacity} autoStart={false} onResolved={onHintResolved}>
        [SCORRI PER DISSOLVERE ↓]
      </ScrollHint>
    </div>
  );
}


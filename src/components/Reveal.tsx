import type { MotionValue } from 'framer-motion';
import { motion, useTransform } from 'framer-motion';
import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { phase, smoothstep } from '@/lib/scrollMath';
import { reducedMotion } from '@/lib/motionPreference';

// L'INGRESSO DELLE SEZIONI DI TESTO.
//
// Non è un'animazione a orologio: è SCRUBBATA, come quella delle card lavori.
// Il moto è una funzione diretta dei pixel di scroll, quindi è reversibile e non
// ha stato accumulato — riscorrendo indietro la sezione si riapre esattamente al
// contrario, e con `prefers-reduced-motion` non resta che spegnerla.
//
// I quattro canali sono quelli delle card: OPACITÀ (accende), Y (sale dal
// basso), ROTAZIONE (si raddrizza) e SCALA (da leggermente più piccola a 1).
// La rotazione è alternata secondo la posizione del blocco nella sezione, come
// il ventaglio della Works: due blocchi consecutivi che si raddrizzano nella
// stessa direzione sembrerebbero un treno, non una serie.
//
// L'easing è `smoothstep`, lo stesso degli altri movimenti scrubbati del sito:
// posizione e velocità sono continue, quindi nessun gradino all'accodamento.
//
// LA PROMESSA DI FINE SCROLL: quando l'utente si ferma sullo stop magnetico
// della sezione, ogni blocco INQUADRATO è al 100% — opacità piena, nessuna
// traslazione, nessuna rotazione, scala 1. Non è una scelta estetica ma una
// condizione verificabile: una card «quasi entrata» a scroll fermo sembra un
// difetto, non un effetto.
//
// La finestra di ogni blocco è quindi CHIUSA DA SOPRA dallo stop della sezione
// (`band.to`), non dal blocco stesso: vedi `revealProgress`. Il ritmo fra un
// blocco e l'altro può stringere la corsia e ritardare l'inizio, ma non mai
// spingere la FINE oltre lo stop.

/**
 * Oltre questo indice il ritardo non cresce più.
 *
 * È il tetto della SEQUENZA, non un dettaglio: deve corrispondere all'indice
 * più alto che le sezioni passano davvero, altrimenti gli ultimi blocchi
 * collassano tutti sullo stesso ritardo e la sequenza si appiattisce. La Method
 * è quella più lunga — etichetta 0, titolo 1, quattro card da `index + 2` (2-5),
 * chiusura 6 e bottone 7 — quindi il tetto è 7. L'About si ferma a 4 (tre
 * paragrafi) e non lo raggiunge.
 *
 * Il tetto serve anche a dare un significato all'indice: se il ritardo
 * seguisse l'indice senza fine, aggiungere un blocco a una sezione cambierebbe
 * il ritmo di tutti quelli dopo. Così il ritardo è un effetto di sequenza entro
 * una finestra nota, e i blocchi oltre il tetto condividono l'ultimo gradino
 * invece di accendersi di scatto.
 */
const MAX_STAGGERED_INDEX = 7;

/**
 * Quanto in basso nel viewport il blocco deve essere salito perché il suo
 * ingresso sia considerato finito, in frazione di viewport.
 *
 * È il TRAGUARDO del blocco: non uno stop magnetico (quello è `band.to`), ma
 * la posizione a cui il blocco è comodamente inquadrato. Un blocco finisce
 * il suo ingresso quando è salito fin qui, e da lì in poi non gli resta niente
 * da fare.
 *
 * Il valore è volutamente generoso (oltre metà viewport): è il tetto che
 * rende vera la promessa di fine scroll. Con il vecchio `0.3` le card in fondo
 * alla sezione avevano il traguardo DOPO lo stop, e a scroll fermo erano
 * ancora ruotate e accese a metà.
 */
const REVEAL_SETTLE_SHARE = 0.55;

/**
 * Quanta parte della banda della sezione guadagna l'indice, come ritardo fra
 * due blocchi consecutivi (non in secondi).
 *
 * Serve a due cose insieme, ed è per questo che è qui e non è un `index *
 * costante` sparito dentro la formula: i quattro blocchi della griglia Method
 * stanno nella STESSA riga e hanno quindi lo stesso `top`, senza questo
 * ritardo finirebbero tutti nello stesso istante e la sequenza diventerebbe un
 * accendersi collettivo. Con il ritardo l'ultimo chiude la corsia.
 */
const REVEAL_STAGGER_SHARE = 0.1;

/**
 * Quanta parte della BANDA DELLA SEZIONE il blocco ci mette a entrare.
 *
 * È una frazione della banda, non una quota di viewport: la corsia si accorcia
 * da sola quando la sezione è bassa (poco scroll fra il suo arrivo e il suo
 * fermo) e si allunga quando è alta, quindi la velocità apparente dell'ingresso
 * è la stessa a 720px come a 1440px.
 */
const REVEAL_SPAN_SHARE = 0.42;

/**
 * Quanto la corsia si accorcia passando dal primo blocco all'ultimo.
 *
 * Gli ultimi blocchi hanno poco spazio davanti, quindi la corsia si stringe;
 * ma solo a metà, perché azzerarla li renderebbe un lampo. Un lampo non è un
 * ingresso.
 */
const REVEAL_SPAN_TIGHTENING = 0.5;

/** Y da cui il blocco arriva, in px. */
const REVEAL_RISE_PX = 34;

/** Rotazione da cui il blocco arriva, in gradi (il segno lo dà `index`). */
const REVEAL_ROTATION_DEG = 5;

/** Scala da cui il blocco arriva. */
const REVEAL_START_SCALE = 0.97;

interface RevealProps {
  /** La sorgente unica di posizione: la MotionValue di Lenis. */
  scrollY: MotionValue<number>;
  /** Nome della sezione che contiene il blocco: `data-scene`. */
  scene: string;
  /** Indice del blocco nella sezione: ritmo della sequenza e segno della rotazione. */
  index?: number;
  className?: string;
  children: ReactNode;
}

/**
 * La banda di scorrimento che una sezione attraversa, in px di pagina.
 *
 * Sono i due estremi della finestra in cui la sezione è sullo schermo: entra
 * quando il suo bordo superiore è al livello del fondo della viewport (`from`)
 * e l'utente si ferma sul suo bordo superiore (`to`, lo stop magnetico).
 */
interface SceneBand {
  /** Scroll in cui la sezione comincia a entrare dal basso. */
  from: number;
  /** Lo STOP magnetico della sezione: il tetto di ogni blocco. */
  to: number;
}

/** Dove si trova il blocco, in px di pagina, se la misura c'è già. */
interface BlockAnchor {
  /** Bordo superiore del blocco, in px di pagina. */
  top: number;
  /** La banda di scorrimento della sezione che lo contiene. */
  band: SceneBand;
}

export default function Reveal({
  scrollY,
  scene,
  index = 0,
  className = '',
  children,
}: RevealProps) {
  const blockRef = useRef<HTMLDivElement>(null);
  // La misura sta in un ref e non nello stato: ricalcolarla a ogni scroll
  // farebbe un render per frame, e qui il moto deve restare al solo motore
  // delle MotionValue. Le trasformazioni leggono il ref al momento del frame,
  // quindi vedono sempre la misura più recente senza alcun render.
  // Il valore iniziale è una banda già satura: se la misura non arrivasse per
  // un motivo qualunque, il blocco si mostra già al posto invece di restare
  // invisibile per tutta la visita. Un elemento che non si vede è un difetto;
  // uno che non si muove è solo un effetto che non parte.
  const anchorRef = useRef<BlockAnchor>({ top: 0, band: { from: 0, to: 0 } });

  const measure = useCallback(() => {
    const block = blockRef.current;
    const section = document.querySelector<HTMLElement>(`section[data-scene="${scene}"]`);
    if (!block || !section) return;
    const viewport = window.innerHeight;
    // `getBoundingClientRect` segue i TRASFORMA: un blocco già entrato a metà
    // si misurerebbe spostato. Il layout vero si legge dagli offset, che i
    // transform non toccano mai.
    //
    // Se la catena degli `offsetParent` non risalisse fino alla sezione, il
    // ricorso è la misura a schermo: meno precisa, ma sempre nel segno giusto,
    // che è ciò che serve alla finestra.
    const relative = offsetTopWithin(block, section);
    const top =
      relative === null
        ? section.getBoundingClientRect().top + window.scrollY + block.offsetTop
        : section.offsetTop + relative;
    const sceneTop = section.offsetTop;
    // La banda è l'ultimo viewport di scroll PRIMA dello stop magnetico.
    //
    // Lo stop è il bordo superiore della sezione: `SmoothScrollProvider` aggancia
    // ogni sezione senza marker con `align: 'start'`, quindi l'utente si ferma
    // esattamente a `sceneTop`. È l'unico riferimento che conta, ed è anche
    // l'ultimo punto in cui la sezione si può fermare: da lì in poi si entra
    // nella sezione successiva.
    //
    // Non si usa «la sezione è tutta inquadrata» (`sceneTop + height - viewport`)
    // perché su una sezione più alta di una viewport quel numero non esiste:
    // cadrebbe oltre lo stop, e i blocchi in fondo — le card 03 e 04, la riga di
    // chiusura e il bottone — avrebbero la fine DOPO il fermo. A scroll fermo
    // sarebbero ancora accese a metà e ruotate, cioè invisibili: è il difetto
    // segnalato. Ancorando al fermo, l'ultimo blocco è a posto esattamente lì.
    anchorRef.current = {
      top,
      band: {
        from: sceneTop - viewport,
        to: sceneTop,
      },
    };
  }, [scene]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (blockRef.current) observer.observe(blockRef.current);
    const section = document.querySelector<HTMLElement>(`section[data-scene="${scene}"]`);
    if (section) observer.observe(section);
    // Anche il BODY, e non solo la sezione: la Works dichiara la propria
    // altezza in px DOPO il primo paint, e con quella sposta il bordo superiore
    // della Method che viene dopo senza cambiarne la dimensione. Un
    // ResizeObserver sulla sola sezione non si accorgerebbe di nulla e la banda
    // resterebbe ancorata a uno `offsetTop` vecchio di centinaia di pixel.
    observer.observe(document.body);
    window.addEventListener('resize', measure);
    // I font display cambiano l'altezza delle righe: senza questa attesa la
    // misura sarebbe quella del fallback e la finestra starebbe nel posto
    // sbagliato per tutta la visita.
    void document.fonts?.ready.then(measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, scene]);

  // I quattro canali derivano dallo STESSO progresso: quattro letture di layout
  // e quattro trasformazioni potrebbero valutare posizioni diverse dentro lo
  // stesso frame, e il blocco si staccherebbe da sé.
  const opacity = useTransform(scrollY, (y) => {
    if (reducedMotion) return 1;
    return revealProgress(y, anchorRef.current, index);
  });
  const y = useTransform(opacity, (t) => (1 - t) * REVEAL_RISE_PX);
  const rotate = useTransform(opacity, (t) =>
    (1 - t) * REVEAL_ROTATION_DEG * (index % 2 === 0 ? -1 : 1),
  );
  const scale = useTransform(opacity, (t) => REVEAL_START_SCALE + (1 - REVEAL_START_SCALE) * t);

  return (
    <motion.div ref={blockRef} style={{ opacity, y, rotate, scale }} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * Distanza del blocco dal bordo superiore della sezione, in px di layout.
 *
 * `offsetTop` è relativo all'`offsetParent`, quindi la somma sale di parent in
 * parent finché non incontra la sezione: `null` se la catena si spezza prima
 * (un `position: fixed`, o un futuro elemento fuori dal flusso della sezione) e
 * il chiamante deve allora prendere la via breve.
 */
const offsetTopWithin = (element: HTMLElement, container: HTMLElement): number | null => {
  let total = 0;
  let node: HTMLElement | null = element;
  while (node) {
    if (node === container) return total;
    total += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return null;
};

/**
 * Progresso di ingresso di un blocco, 0 → 1, in funzione dei pixel di scroll.
 *
 * LA FINESTRA È DELLA SEZIONE, NON DEL BLOCCO. È la correzione che mancava: la
 * fine era ancorata a `blockTop - 0.3 * viewportHeight`, cioè al momento in cui
 * il blocco sarebbe salito vicino al bordo superiore dello schermo. Ma le
 * sezioni hanno uno STOP magnetico al proprio bordo superiore
 * (`SmoothScrollProvider`, `align: 'start'`): l'utente non scorre mai tanto da
 * portare i blocchi bassi a `0.3` viewport dalla cima. Le quattro card della
 * Method stanno 400-800px dentro la sezione, quindi la loro fine cadeva
 * 100-500px DOPO lo stop, e a scroll fermo erano ancora ruotate e accese a
 * metà — l'ultima tappa e il bottone di chiusura spariti del tutto.
 *
 * Qui la finestra sta dentro `band`: `from` è l'arrivo della sezione dal basso e
 * `to` è lo stop magnetico. `settled` non può superarlo, e il tetto è la
 * promessa resa verificabile: allo stop ogni blocco inquadrato è a posto,
 * l'ultimo compreso, senza eccezioni.
 *
 * L'indice ritarda la fine e stringe la corsia, perché gli ultimi blocchi hanno
 * poco spazio davanti. Ma il ritardo non può MAI spingere la fine oltre il
 * tetto: è il ritmo che si cede, non la promessa.
 */
const revealProgress = (y: number, anchor: BlockAnchor, index: number): number => {
  const { top, band } = anchor;
  const viewport = window.innerHeight;
  const travel = Math.max(1, band.to - band.from);
  const capped = Math.min(Math.max(0, index), MAX_STAGGERED_INDEX);
  const ordered = capped / MAX_STAGGERED_INDEX;
  // Il ritardo dell'indice spinge il traguardo in avanti di una fetta di banda.
  // Serve ai quattro blocchi della griglia Method, che stanno nella STESSA riga
  // e quindi hanno lo stesso `top`: senza ritardo finirebbero tutti nello stesso
  // istante e la sequenza diventerebbe un accendersi collettivo.
  const stagger = travel * REVEAL_STAGGER_SHARE * ordered;
  // Il traguardo naturale: il blocco è a posto quando è salito fin qui.
  const natural = top - viewport * REVEAL_SETTLE_SHARE + stagger;
  // Il blocco entra nel viewport a questo scroll: sotto, è ancora dietro il
  // bordo inferiore e l'utente non lo vede.
  const seen = top - viewport;
  // DOVE FINISCE.
  //
  // IL SOFFITTO è la correzione del difetto. Lo stop magnetico non è
  // un'approssimazione: nessun blocco inquadrato può aspettare oltre
  // `band.to`, altrimenti a scroll fermo sarebbe ancora ruotato e acceso a metà.
  // Prima questo soffitto non esisteva e le card in fondo chiudevano il loro
  // ingresso 100-500px DOPO il fermo, con la chiusura e il bottone che non
  // arrivavano mai.
  //
  // Il soffitto vale solo per i blocchi INQUADRATI allo stop. Un blocco più in
  // basso della viewport non si vede nemmeno lì: forzarlo avrebbe spento metà
  // degli ingressi delle sezioni alte (About), che è un difetto peggiore di
  // quello che si sta correggendo.
  const framed = seen < band.to;
  const settled = framed ? Math.min(natural, band.to) : natural;
  // DOVE COMINCIA. Tre vincoli e vince il maggiore, e la corsia si misura da
  // `settled` — cioè dalla fine EFFETTIVA, non da quella naturale: se la fine
  // è stata abbassata dal soffitto, misurare la corsia dalla fine naturale
  // la spingerebbe oltre `settled` e il blocco risulterebbe già pronto senza
  // animazione. È il caso della chiusura e del bottone in viewport stretta.
  //
  // La corsia si accorcia con l'indice perché gli ultimi blocchi hanno poco
  // spazio davanti, ma solo a metà (azzerarla li renderebbe un lampo).
  const lane = travel * REVEAL_SPAN_SHARE * (1 - REVEAL_SPAN_TIGHTENING * ordered);
  const start = Math.max(band.from, settled - lane, seen);
  // Una corsia non positiva non è un ingresso: il blocco entra a schermo solo
  // quando ha già finito, e il giusto è mostrarlo subito al suo posto.
  if (settled <= start) return 1;
  return smoothstep(phase(y, start, settled));
};

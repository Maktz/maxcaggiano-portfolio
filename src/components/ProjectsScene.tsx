import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import {
  clamp01,
  invalidateSceneTops,
  smoothstep,
} from '@/lib/scrollMath';
import { useSmoothScroll } from '@/providers/smoothScrollContext';
import type { Project } from '@/data/projects';
import ProjectCard from './ProjectCard';

interface ProjectsSceneProps {
  projects: Project[];
  onOpenProject: (index: number) => void;
  scrollY: MotionValue<number>;
}

// Planata della camera: la card entra da una profondità reale (translateZ) e la
// sua dimensione cresce da un punto (CARD_POINT_SCALE) con una curva che
// accelera al centro e si posa senza scatto nell'ultimo tratto. Una legge 1/z
// pura sarebbe più "fotografica" ma fa esplodere la dimensione nell'ultimo 1%
// dello scroll: il risultato è uno scatto, non una planata.
const CARD_POINT_SCALE = 0.05;
const CARD_GROWTH_EXPONENT = 1.9;
const CARD_START_DEPTH = 950;
// Deve restare allineata alla perspective inline della scena (ProjectsScene,
// style={{ perspective: '1200px' }}): il blur in px di schermo la usa per
// compensare il rimpicciolimento prospettico del filter.
const CARD_PERSPECTIVE_PX = 1200;
// Il fuori fuoco è espresso in pixel di SCHERMO: il blur CSS è locale e la
// proiezione prospettica lo rimpicciolirebbe, quindi va diviso per la
// proiezione corrente (con un tetto locale di sicurezza).
const CARD_COC_SCREEN_PX = 26;
const CARD_MAX_LOCAL_BLUR_PX = 64;
// Crossfade disco bokeh -> card: la card prende fuoco dall'inizio del suo
// volo, così il contenuto segue la comparsa del disco senza ulteriore attesa.
const CARD_FOCUS_START = 0;
const CARD_FOCUS_END = 0.52;
const CARD_DISC_MIN_PX = 22;
const CARD_DISC_MAX_PX = 54;
const CARD_DISC_ALPHA = 0.48;
// Il disco ha una componente iniziale già visibile: il punto che genera la
// card deve esserci prima che il contenuto inizi il suo stagger.
const CARD_DISC_INITIAL_ALPHA = 0.38;
const CARD_DISC_FADE_IN = 0.035;
// Lato FISSO del disco bokeh. Il disco non viene più ridimensionato: la
// dimensione voluta si ottiene con transform: scale(), e il gradiente radiale
// scala con l'elemento quindi a occhio è identico. Il motivo è che width/height
// sono proprietà di LAYOUT: riscriverle a ogni frame su sei elementi
// invalidava il layout sessanta volte al secondo per un puro effetto di
// disegno che la GPU può fare da sola. 200px è la base più grande che serve
// (il disco locale arriva a ~790px quando la card è un punto al centro di
// fuga) e tiene la scala sotto 4, con il raggio di sfocatura ben oltre la
// risoluzione del gradiente.
const CARD_DISC_BASE_PX = 200;
// Stesse stop della sprite bokeh del canvas: il disco lontano e le particelle
// della nebulosa sono lo stesso materiale fotografico.
const CARD_BOKEH_GRADIENT =
  'radial-gradient(circle, rgba(252,178,188,0.58) 0%, rgba(252,178,188,0.48) 28%, rgba(252,178,188,0.32) 58%, rgba(252,178,188,0.11) 82%, rgba(252,178,188,0) 100%)';
const CARD_DEPTH_JITTER = 0.18;
// Quota del viaggio Nebula → Works in cui i DISCHI bokeh delle card diventano
// visibili. Anticipa l'ingresso della Works: i dischi sono gia' li' mentre la
// scena non e' ancora entrata, e la griglia si compone dentro Works.
const CARD_SOURCE_REVEAL_RATIO = 0.34;
// Stagger fra i voli delle card che nascono in anticipo. E' una frazione della
// distanza fra il reveal delle sorgenti e l'ingresso del Works, divisa per il
// numero di slot: ogni card in volo parte un pezzettino dopo della precedente,
// cosi' la composizione si scioglie a ondate invece che insieme.
const CARD_STAGGER_RATIO = 0.22;
// Il contenuto della card parte un filo DOPO il suo disco sorgente: il punto
// bokeh deve gia' essere li' quando la card comincia a prendere fuoco, altrimenti
// si vedrebbe una card che si materializza dal nulla.
const CARD_FLIGHT_START_OFFSET_PX = 6;
// Quota del viaggio Nebula → Works in cui la card 1 INIZIA a materializzarsi
// dal punto di fuga. Non parte dal primo pixel: prima arrivava al Works gia'
// perfettamente composta, quindi il viaggio in cui la camera esplode finiva con
// una griglia ferma che non spiegava da dove fosse venuta. Partendo a meta'
// strada la si vede crescere DENTRO la nebulosa e la Works la accoglie gia' a
// meta' formazione.
const IN_BIRTH_START_RATIO = 0.45;
// Quota della sezione Works entro cui le card nate in anticipo chiudono il
// volo: dentro i primi pixel della sezione, quindi si compongono mentre lo
// strip comincia gia' a scorrere. Il valore e' volutamente piccolo: se le card
// chiudessero troppo tardi, al fermo del Works la griglia sarebbe ancora in
// formazione e non si leggerebbe comeWORKS finito.
const IN_BIRTH_END_RATIO = 0.08;
// Una card non nasce "fuori campo": il disco bokeh piu' piccolo deve essere gia'
// dentro lo schermo quando il volo parte, altrimenti si vedrebbe un salto.
const CARD_ENTRY_MARGIN_PX = 8;

// ---------------------------------------------------------------------------
// Il nastro: UNA card per step
// ---------------------------------------------------------------------------
// Tutte e sei le card nascono dallo STESSO punto di fuga (il perspectiveOrigin
// della scena) e atterrano sullo slot reale. Non esistono più due famiglie di
// percorso: l'escape che le divideva era costruito per NON far passare la card
// per il centro, ma adesso il centro è occupato di proposito — è lì che atterra
// la card precedente e da lì la nuova esce dietro. Per questo l'escape è stato
// rimosso: escape = 0 per tutte e sei.
//
// La posizione resta quella di sempre, e da sola fa già quanto chiesto:
//
//   position = originX · (1 − smoothstep(flight)/k)   con originX = fuga − slot
//
// A flight = 0 vale position = originX, cioè la card nasce LETTERALMENTE dal
// punto di fuga. La divisione per k (fattore di proiezione prospettica) è
// quella che tiene la traiettoria retta a schermo: senza di essa il percorso
// si incurva, con scarto misurato fino a 56px a metà volo.
//
// Il ritmo è quello di un nastro che avanza di uno step per ogni card che
// atterra: ogni volo copre esattamente uno step della corsa, quindi la card i
// nasce quando atterra la card i−1 e atterra quando nasce la card i+1. C'è
// sempre una sola card in volo, e quella appena atterrata è al centro mentre la
// nuova le cresce dentro.

// ---------------------------------------------------------------------------
// Timeline della Works: NASCITA → CORSA → SALITA → SBLOCCO
// ---------------------------------------------------------------------------
// L'altezza della sezione NON è un multiplo fisso di viewport: è la somma delle
// quattro fasi in px, calcolata in JS dalla striscia reale (391 + 1954 + 883 +
// 813 = 4041px a 1440×813). Con un `h-[300vh]` fisso i tratti non starebbero: o
// la corsa si accorcerebbe, o la decelerazione finirebbe dentro lo sblocco.
//
//   0. NASCITA  worksTop → birthEndY : lo strip è FERMO a birthOffset e la card 1
//      è sola al centro. Non ha un ramo dedicato: a birthOffset il suo slot di
//      arrivo coincide con il punto di fuga, quindi originX = 0 e la stessa
//      formula degli altri la fa crescere in loco, per sola scala e blur.
//   1. CORSA    birthEndY → raceEndY : lo strip va da birthOffset a travel, cioè
//      ogni card che atterra spinge il nastro di uno step, a VELOCITÀ COSTANTE.
//   2. SALITA   raceEndY → riseEndY : lo strip è FERMO a travel — le card salgono
//      e NON cambiano la loro posizione orizzontale — mentre la scena sale di un
//      viewport, accelerando da ferma a velocità piena (1:1).
//   3. SBLOCCO  riseEndY → fine : scroll naturale 1:1, la Works esce TAGLIATA dal
//      bordo superiore e la sezione successiva sale dal basso. Nessuna
//      sovrapposizione, per costruzione e non per accordo.
//
// I confini sono scelti sulla geometria: la nascita finisce quando la card 1 è
// a posto, la corsa quando l'ultima card arriva al centro, la salita quando la
// scena ha salito un viewport intero.
//
// La corsa è definita come RAPPORTO con la corsa utile e non in px assoluti: la
// corsa utile è (card−1)·step, cioè 5·360 = 1800px a 1440, e la corsa dura
// 1.0854·1800 = 1954px. Sul rapporto la velocità laterale resta la stessa a
// qualunque viewport (0.921 px di strip per px di scroll), che è l'unica cosa
// che l'occhio registra come "velocità".
const RACE_SPAN_RATIO = 1.0854;
// Durata della nascita come QUOTA di un volo di corsa. Ogni volo di corsa copre
// uno step, e la card 1 deve durare esattamente come gli altri: è la stessa
// planata, con lo strip fermo al posto che in corsa avanza. 1 ⇒ birthSpan =
// raceSpan/(card−1) = 391px.
const BIRTH_SPAN_RATIO = 1;
// Span della salita = 1.5·vh. La scena sale di UN viewport PARTENDO DA FERMA
// (in nascita e corsa è ferma a schermo: v = 0) e deve arrivare a velocità
// piena (1:1, come nello sblocco) senza strappare al confine, quindi la finestra
// è più lunga di un viewport: v(e) = e^K con area vh dà K = span/vh − 1, e
// K = 0.5 ⇒ metà velocità a metà salita.
//
// Il valore di K è una scelta, non un dettaglio: con K = 0.086 (span = 1.086·vh,
// il valore che c'era prima) la salita raggiunge il 73% della velocità piena dopo
// 21px di scroll. Non è un raccordo, è uno strappo travestito da raccordo.
// K = 0.5 mette metà velocità a ~270px e il 90% a ~780: si sente che la Works
// si mette in moto, che è quello che deve succedere dopo che le card si sono
// ferme. Costa 0.4 viewport in più di sezione.
const RISE_SPAN_RATIO = 1.5;
// Tetto inferiore dell'esponente, solo per il caso degenere riseSpan ≤ vh dove
// K → 0 e la salita diventerebbe lineare. Con 1.5 non scatta mai.
const RISE_EXPONENT_FLOOR = 0.05;

// RAMP-E DI ACCELERAZIONE E DECELERAZIONE DELLA CORSA, in frazione di corsa.
// La corsa era lineare nello scroll, e la sua velocita' laterale partiva da 0
// e finiva a 0 con un GRADINO: a birthEndY lo strip balzava da fermo a
// 0.921 px per px di scroll, a raceEndY si fermava di colpo dalla stessa
// velocita'. Sono discontinuita' della DERIVATA prima, e l'occhio le legge
// come un'accelerazione a gradino.
//
// La salita verticale aveva gia' un suo raccordo (v(e) = e^K, vedi RISE): era
// la verticale ad essere stata trattata, le due seam orizzontali no.
//
// Il profilo qui sotto e' un trapezio a rampe smoothstep: velocita' 0 -> 1 ->
// 0 con v e v' continue, quindi posizione, velocita' E accelerazione non hanno
// nessun gradino. Il corpo del profilo e' a velocita' costante, cioe' la
// corsa resta un NASTRO: cambia solo come si entra e come si esce.
//
// Il rapporto conta piu' della forma: ∫smoothstep = 0.5 esatto, quindi le due
// rampe valgono a/2 ciascuna e l'area totale e' (1 - a), NON 1. Per questo
// raceSpan viene diviso per (1 - a) in stripMetrics: e' il compensatore che
// tiene la velocita' laterale di CORSA utilita' esattamente quella di prima
// (0.921 px di strip per px di scroll a 1440). Senza quella divisione la
// velocita' di crociera salirebbe a 1.22x e la corsa sembrerebbe piu' veloce:
// un'altra decisione, non questa.
const RACE_RAMP_RATIO = 0.18;

/**
 * Corsa normalizzata: 0 -> 1 dalla nascita alla fine corsa, con velocita' e
 * accelerazione continue (C2). Profilo trapezoidale a rampe smoothstep, con
 * area normalizzata a 1.
 *
 * Le tre formule sono l'integrale della velocita' nei tre tratti, e il
 * denominatore (1 - a) e' l'area grezza delle rampe: e' lui che rende
 * P(0) = 0 e P(1) = 1, cioe' la corsa utile esatta.
 *
 * Fuori da [0, 1] si congela: il chiamante passa gia' clamp01, ma il clamp
 * qui e' la garanzia che la funzione non possa mai uscire da [0, 1] neanche
 * per un valore fuori intervallo, cosa che romperebbe l'atterraggio.
 */
const raceProfile = (t: number): number => {
  const a = RACE_RAMP_RATIO;
  // Difensivo: a >= 1/2 farebbe le rampe toccarsi e il profilo non avrebbe
  // piu' un tratto a velocita' costante. Il valore e' fisso e molto sotto,
  // quindi questo ramo non dovrebbe mai entrare: resta perche' un giorno
  // RACE_RAMP_RATIO potrebbe essere ritoccato e il profilo deve degradare in
  // lineare, non in un NaN che sposterebbe le card fuori dai loro slot.
  if (a <= 0 || a >= 0.5) return t;
  const c = Math.max(0, Math.min(1, t));
  const raw = c < a
    ? (c * c * c) / (a * a) - (c * c * c * c) / (2 * a * a * a)
    : c <= 1 - a
      ? c - a / 2
      : 1 - a - Math.pow(1 - c, 3) / (a * a)
        + Math.pow(1 - c, 4) / (2 * a * a * a);
  return raw / (1 - a);
};

export default function ProjectsScene({
  projects,
  onOpenProject,
  scrollY,
}: ProjectsSceneProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const cardDepthRefs = useRef<Array<HTMLDivElement | null>>([]);
  const cardBlurRefs = useRef<Array<HTMLDivElement | null>>([]);
  const cardDiscRefs = useRef<Array<HTMLSpanElement | null>>([]);
  // Ultimo stato di atterraggio noto per card. Serve a non riscrivere
  // willChange a ogni frame: la commutazione 'transform' -> 'auto' avviene una
  // volta sola per card, e scriverla sessanta volte al secondo è lavoro
  // buttato (il valore è quasi sempre identico, quindi Chrome lo scarta, ma il
  // parsing della stringa no).
  const landedRef = useRef<boolean[]>([]);
  // Slot in coordinate LOCALI della scena, misurati con lo strip a offset 0.
  // Devono essere locali perche' lo strip si sposta: se fossero in coordinate
  // documento, a ogni frame servirebbe riaggiungere lo scorrimento, e la posizione
  // di partenza (punto di fuga) andrebbe ricalcolata di continuo.
  const slotCentersRef = useRef<Array<{ x: number; y: number } | null>>([]);
  const cameraCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Punto di fuga in coordinate locali della scena: coincide con il
  // perspectiveOrigin che il CSS proietta davvero.
  const perspectiveOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Geometria della corsa orizzontale, tutta letta dal DOM. Le tre fasi
  // (raceSpan / riseSpan) e l'altezza della sezione vivono QUI e non nel
  // render loop: se ciascuno dei due li ricalcolasse, l'altezza della sezione,
  // il marker data-snap e la posizione dello strip potrebbero divergere di un
  // px e i due non potrebbero più "non può divergere" per costruzione.
  const stripMetricsRef = useRef({
    /** Corsa utile: porta l'ultima card al centro della scena. */
    travel: 0,
    /** Scorrimento totale: porta l'intero strip fuori a sinistra. */
    fullTravel: 0,
    cardWidth: 0,
    sceneWidth: 0,
    /**
     * Offset a cui lo strip è già quando la PRIMA card atterra al centro.
     * È negativo (−510px a 1440) perché il centro è a destra del primo slot:
     * senza questo offset iniziale la card 1 partirebbe dal bordo sinistro e
     * non atterrerebbe mai al centro, che è il punto da cui tutto il resto si
     * misura. Lo strip parte dunque "indietro" di mezzo slot e mezzo.
     */
    birthOffset: 0,
    /** Corsa utile reale = travel − birthOffset = (card−1)·step = 1800px a 1440. */
    raceTravel: 0,
    /** Scroll della nascita, in px: la card 1 che arriva da sola al centro. */
    birthSpan: 0,
    /** Scroll della corsa, in px: corsa utile · RACE_SPAN_RATIO. */
    raceSpan: 0,
    /** Scroll della salita, in px: vh · RISE_SPAN_RATIO. */
    riseSpan: 0,
    /** Altezza della sezione: nascita + corsa + salita + un viewport di sblocco. */
    sectionHeight: 0,
  });
  // Vero punto medio fra i due elementi di riferimento della pagina (indicazione
  // geografica in alto, telemetria in basso): il box delle card va centrato li',
  // non nel centro geometrico della viewport. Misurato dal DOM perche' le due
  // scritte possono andare a capo o cambiare altezza.
  const boxCenterOffsetRef = useRef(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const { subscribeFrame, lenis } = useSmoothScroll();
  useLayoutEffect(() => {
    const worksSection = document.querySelector<HTMLElement>('[data-scene="works"]');
    const measureSlots = () => {
      // La scena viene rimessa nel flusso naturale solo per misurare il
      // layout. Il renderer riapplica subito dopo la compensazione viewport.
      if (sceneRef.current) {
        sceneRef.current.style.transform = '';
        sceneRef.current.style.willChange = 'auto';
      }
      const worksTop = worksSection?.offsetTop ?? window.scrollY;
      // Punto di fuga = CENTRO DELLA PAGINA, non il centro del box della scena.
      //
      // Sul piano x window.innerWidth include la scrollbar (che abbiamo
      // ripristinato e che occupa ~10px), quindi il centro si spostava a destra
      // rispetto all'area di contenuto: il CSS proietta attorno a 715px mentre il
      // calcolo credeva in 720px. Sul piano y il box della scena sta 96px sotto
      // la sezione (pt-24), quindi il suo centro finiva 96px sotto il centro
      // della viewport: da li la "leggera" deriva verso il basso.
      //
      // Per far coincidere il punto di fuga con quello vero si allineano due
      // cose: il centro usato dal calcolo e il perspectiveOrigin CSS, che
      // altrimenti proietterebbe attorno a un punto diverso da quello in cui
      // calcoliamo la partenza delle card.
      const viewportWidth = document.documentElement.clientWidth;
      // worksTop è lo scroll a cui la scena è nella sua posizione naturale: è
      // l'ancoraggio con cui il centro della viewport va convertito in
      // coordinate documento, indipendentemente dallo scroll corrente.
      cameraCenterRef.current = {
        x: window.scrollX + viewportWidth / 2,
        y: worksTop + window.innerHeight / 2,
      };
      const scene = sceneRef.current;
      const strip = stripRef.current;
      if (scene) {
        // perspectiveOrigin in coordinate LOCALI del box della scena. offsetTop
        // è relativo alla sezione (position: relative), quindi l'offset del
        // padding superiore è già dentro: qui si esclude per far cadere il punto
        // di fuga al centro della viewport.
        const localX = viewportWidth / 2 - (scene.offsetLeft ?? 0);
        const localY = window.innerHeight / 2 - (scene.offsetTop ?? 0);
        scene.style.perspectiveOrigin = `${localX}px ${localY}px`;
        perspectiveOriginRef.current = { x: localX, y: localY };
      }
      // Centro del box fra i due riferimenti fissi della pagina. Il box delle
      // card deve avere la STESSA distanza dall'indicazione geografica in alto
      // e dalla telemetria in basso: si prende il punto medio dei due bordi
      // (basso del primo, alto del secondo) e lo si usa come centro della scena.
      // Sotto md i due elementi sono hidden e hanno rect vuoto: in quel caso
      // non si tocca nulla e vale il centraggio normale.
      const geoEl = document.querySelector<HTMLElement>('[data-anchor="geo"]');
      const telemetryEl =
        document.querySelector<HTMLElement>('[data-anchor="telemetry"]');
      if (geoEl && telemetryEl) {
        const geoRect = geoEl.getBoundingClientRect();
        const telemetryRect = telemetryEl.getBoundingClientRect();
        if (geoRect.height > 0 && telemetryRect.height > 0) {
          const bandCenter = (geoRect.bottom + telemetryRect.top) / 2;
          boxCenterOffsetRef.current = bandCenter - window.innerHeight / 2;
        }
      }

      // Geometria della corsa: lo strip si sposta quanto basta a portare
      // la sua coda al CENTRO della scena. Lo strip viene riportato a zero
      // prima di misurare, altrimenti la corsa risulterebbe gia' consumata.
      if (scene && strip) {
        strip.style.transform = '';
        const sceneRect = scene.getBoundingClientRect();
        const stripW = strip.scrollWidth;
        // Gli slot sono letti per PRIMI, in coordinate locali della SCENA
        // (origine: bordo sinistro della scena), non del documento: sono questi
        // i valori che il render loop usa per la posizione corrente della card.
        // L'ordine e' obbligatorio: `travel` (e da lui birthOffset, raceSpan e
        // l'altezza della sezione) si ricava dagli slot, quindi misurare la
        // geometria prima degli slot dava travel = 0 al primo giro — corsa
        // lunga 1px, sezione alta 1px, strip fermo. Errore silenzioso: nessuna
        // eccezione, solo una Works che non scorreva.
        cardRefs.current.forEach((card, index) => {
          if (!card) return;
          const rect = card.getBoundingClientRect();
          slotCentersRef.current[index] = {
            x: rect.left - sceneRect.left + rect.width / 2,
            y: rect.top - sceneRect.top + rect.height / 2,
          };
        });
        // Corsa utile: l'ultima card deve finire al CENTRO, non al suo bordo
        // destro. Ma il centro di riferimento è il vero PUNTO DI FUGA (il
        // perspectiveOrigin calcolato qui sopra), non scene.clientWidth/2: se i
        // due differissero di qualche px la card 1 nascerebbe e atterrerebbe in
        // due punti diversi, e il primo non sarebbe il centro. Usando lo stesso
        // valore, nascita e atterraggio coincidono per costruzione — ed è
        // l'unica cosa che rende automatico lo zero di origine della card 1.
        const centerX = perspectiveOriginRef.current.x > 0
          ? perspectiveOriginRef.current.x
          : scene.clientWidth / 2;
        const firstSlotX = slotCentersRef.current.find((slot) => slot)?.x;
        const lastSlotX = slotCentersRef.current[slotCentersRef.current.length - 1]?.x;
        const cardTotal = Math.max(1, slotCentersRef.current.length - 1);
        // birthOffset è la posizione dello strip a cui la PRIMA card ha il suo
        // slot di arrivo sul centro; travel è quella a cui ce l'ha l'ULTIMA. La
        // differenza è la corsa utile, e vale (card−1)·step per costruzione:
        // non è un numero tarato, è la conta degli step da percorrere.
        const birthOffset = firstSlotX !== undefined
          ? firstSlotX - centerX
          : 0;
        const travel = lastSlotX !== undefined ? lastSlotX - centerX : 0;
        stripMetricsRef.current = {
          travel,
          // Uscita completa: lo strip esce interamente a sinistra quando il suo
          // bordo destro ha superato il bordo sinistro della scena.
          fullTravel: Math.max(0, stripW),
          cardWidth: cardRefs.current[0]?.getBoundingClientRect().width ?? 0,
          sceneWidth: scene.clientWidth,
          birthOffset,
          raceTravel: Math.max(1, travel - birthOffset),
          birthSpan: 0,
          // Le tre fasi, derivate dalla striscia REALE appena misurata. Sono
          // qui e non nel render loop perché l'altezza della sezione e il
          // marker data-snap devono leggere esattamente gli stessi numeri.
          //
          // La divisione per (1 - RACE_RAMP_RATIO) e' il compensatore delle
          // rampe: il profilo di corsa ha area (1 - a) invece di 1, quindi
          // senza questo la corsa utile finirebbe prima e la velocita' laterale
          // salirebbe a 1.22x. Con la divisione la velocita' laterale resta
          // raceTravel/raceSpan = 0.921 px per px di scroll a 1440, identica
          // alla corsa lineare di prima: si allunga solo la FINESTRA di scroll
          // entro cui la stessa distanza viene percorsa.
          raceSpan: Math.max(1, Math.max(0, travel - birthOffset) * RACE_SPAN_RATIO
            / (1 - RACE_RAMP_RATIO)),
          riseSpan: Math.max(1, window.innerHeight * RISE_SPAN_RATIO),
          sectionHeight: 0,
        };
        // La nascita dura esattamente un volo di corsa: ogni volo copre uno
        // step, e la card 1 deve planare per lo stesso tempo degli altri, con
        // lo strip fermo al posto che in corsa avanza. cardTotal = 1 (una card
        // sola) non ha divisioni da fare: la nascita è tutta la corsa.
        const metrics = stripMetricsRef.current;
        metrics.birthSpan = cardTotal > 0
          ? (metrics.raceSpan / cardTotal) * BIRTH_SPAN_RATIO
          : metrics.raceSpan;
        metrics.sectionHeight = metrics.birthSpan + metrics.raceSpan +
          metrics.riseSpan + window.innerHeight;
        // L'altezza della sezione è SCRITTA in px, non lasciata a un multiplo di
        // viewport: i quattro tratti sono in px e solo in px possono stare
        // nello spazio giusto. Senza questo, o la corsa si accorcerebbe, o la
        // salita finirebbe dentro lo sblocco.
        if (worksSection) {
          const nextHeight = `${Math.round(metrics.sectionHeight)}px`;
          if (worksSection.style.height !== nextHeight) {
            worksSection.style.height = nextHeight;
            // Lenis aveva calcolato maxScroll sull'altezza VECCHIA (quella del
            // fallback in CSS): senza un resize il documento resterebbe
            // scrollabile fino al vecchio fondo e gli ultimi pixel dell Works
            // — cioè l'ingresso della sezione dopo — sarebbero irraggiungibili.
            lenis.resize();
            // La cache degli offset di sezione lege il DOM, quindi va annullata
            // insieme al resize: dopo questo write la quota della sezione
            // successiva è cambiata e chi la legge deve rivederla.
            invalidateSceneTops();
          }
          // Il marker works-raced è lo stop magnetico di fine corsa. Va
          // posizionato in px, non in percentuale della sezione: l'altezza
          // della sezione è adesso calcolata in JS, quindi una percentuale
          // fissa in App.tsx punterebbe al posto sbagliato. Sta a
          // birthSpan + raceSpan perché la corsa non parte da worksTop ma da
          // birthEndY: legendo gli stessi numeri della corsa, i due non
          // possono divergere per costruzione.
          const racedMarker = worksSection.querySelector<HTMLElement>('[data-snap="works-raced"]');
          if (racedMarker) {
            racedMarker.style.top =
              `${Math.round(metrics.birthSpan + metrics.raceSpan)}px`;
          }
        }
        // Gli slot sono letti in coordinate locali della SCENA (origine: bordo
        // sinistro della scena), non del documento: sono questi i valori che il
        // render loop usa per la posizione corrente della card.
        cardRefs.current.forEach((card, index) => {
          if (!card) return;
          const rect = card.getBoundingClientRect();
          slotCentersRef.current[index] = {
            x: rect.left - sceneRect.left + rect.width / 2,
            y: rect.top - sceneRect.top + rect.height / 2,
          };
        });
      }
      cardRefs.current.forEach((card, index) => {
        if (!card) return;
        // Rimuoviamo temporaneamente la trasformazione corrente per leggere
        // lo slot del layout, non la posizione animata precedente.
        card.style.transform = '';
        card.style.filter = 'none';
        card.style.opacity = '1';
        const depthLayer = cardDepthRefs.current[index];
        if (depthLayer) {
          depthLayer.style.transform = '';
          depthLayer.style.filter = 'none';
        }
        const blurLayer = cardBlurRefs.current[index];
        if (blurLayer) {
          blurLayer.style.filter = 'none';
          blurLayer.style.opacity = '1';
        }
        const disc = cardDiscRefs.current[index];
        if (disc) {
          disc.style.width = '0px';
          disc.style.height = '0px';
          disc.style.opacity = '0';
        }
      });
      setLayoutVersion((version) => version + 1);
    };

    measureSlots();
    const fontsReady = document.fonts?.ready;
    fontsReady?.then(measureSlots);
    // Si osserva la SCENA, non la sezione: la sezione è l'elemento che
    // measureSlots appena ha RIDIMENSIONATO, e osservarla significherebbe
    // ricevere una notifica a ogni nostra modifica (loop). La scena è alta
    // h-screen e non cambia mai da sola, ma cambia quando cambia la viewport,
    // ed è la sua larghezza a governare --works-card-w e quindi gli slot.
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && sceneRef.current
        ? new ResizeObserver(measureSlots)
        : null;
    if (sceneRef.current) resizeObserver?.observe(sceneRef.current);
    window.addEventListener('resize', measureSlots);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureSlots);
    };
    // lenis è l'istanza unica del provider (creata nel useState initializer, non
    // ricreata mai), quindi elencarla non riapre l'effetto: serve solo a
    // dichiarare la dipendenza che measureSlots usa per rimisurare maxScroll
    // quando l'altezza della sezione cambia da 300vh al valore calcolato.
  }, [lenis]);

  useEffect(() => {
  // Frame condiviso con il canvas: stessa sorgente di clock, cosi card e
  // nebulosa vengono disegnate nello stesso identico frame.
    const worksSection = document.querySelector<HTMLElement>('[data-scene="works"]');
    // Serve al reveal delle sorgenti bokeh: le card compaiono dentro il
    // viaggio Nebula → Works, quindi servono i due estremi del viaggio.
    const nebulaSection = document.querySelector<HTMLElement>('[data-scene="nebula"]');

    const render = () => {
      const y = scrollY.get();
      const worksTop = worksSection?.offsetTop ?? window.innerHeight * 2;
      const nebulaTop = nebulaSection?.offsetTop ?? worksTop - window.innerHeight;
      const journeyLength = worksTop - nebulaTop;
      // Le sorgenti bokeh delle card compaiono DENTRO il viaggio Nebula → Works,
      // non al suo arrivo: sono i dischi che generano le card, e vederli
      // crescere mentre la camera ancora viaggia in Z e' cio' che lega la Works
      // alla nebulosa. Sotto questa quota non c'e' niente da disegnare.
      const cardRevealAt = nebulaTop + journeyLength * CARD_SOURCE_REVEAL_RATIO;
      // Distanza che il viaggio offre alle card nate in anticipo, e lo stagger
      // che ne segue. Ripristinati insieme: senza di essi le card partivano
      // tutte insieme e la composizione si scioglieva come un blocco unico.
      const cardTravel = Math.max(1, worksTop - cardRevealAt - CARD_FLIGHT_START_OFFSET_PX);
      const cardCount = Math.max(1, projects.length - 1);
      const cardStagger = cardTravel * CARD_STAGGER_RATIO / cardCount;
      const cardsVisible = y >= cardRevealAt - 1;
      // ---------------------------------------------------------------------
      // Timeline della Works: NASCITA → CORSA → SALITA → SBLOCCO
      // ---------------------------------------------------------------------
      // I quattro tratti sono in PX ASSOLUTI e arrivano tutti da stripMetricsRef,
      // che li ha calcolati sulla striscia reale: è la stessa fonte da cui
      // nascono l'altezza della sezione e il marker data-snap, quindi sezione,
      // magnete e animazione non possono divergere.
      const stripMetrics = stripMetricsRef.current;
      const travel = stripMetrics.travel;
      const birthOffset = stripMetrics.birthOffset;
      const raceTravel = stripMetrics.raceTravel;
      const birthSpan = Math.max(1, stripMetrics.birthSpan);
      const raceSpan = Math.max(1, stripMetrics.raceSpan);
      const riseSpan = Math.max(1, stripMetrics.riseSpan);
      const viewportHeight = window.innerHeight;
      // Tetto all'atterraggio della card 1. birthEndY arriva dalla striscia
      // reale, ma la NASCITA non puo' protrarsi oltre i primi pixel della
      // sezione: se lo facesse, allo stop Works la card 1 sarebbe ancora in
      // formazione e la Works non si leggerebbe come conclusa. Il tetto e' un
      // minimo, quindi su viewport bassi dove birthSpan e' gia' piccolo vince
      // la striscia e il nastro resta intatto.
      const birthCeilY = worksTop + stripMetrics.sectionHeight * IN_BIRTH_END_RATIO;
      const birthEndY = Math.min(worksTop + birthSpan, birthCeilY);
      const raceEndY = birthEndY + raceSpan;
      const riseEndY = raceEndY + riseSpan;

      // FASE 0 — NASCITA: lo strip è FERMO a birthOffset e la card 1 è sola al
      // centro. Non serve un ramo dedicato per lei: a birthOffset il suo slot
      // di arrivo coincide con il punto di fuga, quindi originX = 0 e la stessa
      // formula degli altri la fa crescere in loco, per sola scala e blur.
      //
      // FASE 1 — CORSA: lo strip va da birthOffset a travel. Non è più una lerp
      // lineare nello scroll: il moto è il profilo raceProfile, cioè velocità
      // costante nel corpo e rampe smoothstep ai due confini. La velocità
      // laterale di crociera resta 0.921 px per px di scroll (compensatore in
      // stripMetrics): ogni card che atterra corrisponde a uno step avanti
      // dello strip, il nastro non cambia, cambiano solo la partenza e l'arrivo.
      //
      // FASE 2 — SALITA: lo strip è FERMO a `travel`. Le card salgono e NON
      // cambiano la loro posizione orizzontale, mentre la scena sale di un
      // viewport.
      //
      // FASE 3 — SBLOCCO: la scena esce tagliata dal bordo superiore con lo
      // scroll naturale 1:1, la sezione successiva sale dal basso. Nessuna
      // sovrapposizione.
      let stripOffset: number;
      // Progresso della CORSA nello spazio in cui la STRISCIA si muove davvero
      // (0 -> 1, vedi raceProfile). È la stessa grandezza che dà il movimento
      // allo strip, e i voli delle card si misurano qui: leggerli nello scroll
      // significherebbe che la card atterra quando la striscia è altrove.
      let raceProgress = 0;
      // Quanto la scena è salita rispetto alla sua posizione a schermo (px).
      // 0 in nascita e corsa, 0 → viewportHeight in salita, poi cresce con lo
      // scroll.
      let sceneRise = 0;
      if (y <= birthEndY) {
        stripOffset = birthOffset;
      } else if (y <= raceEndY) {
        raceProgress = raceProfile(clamp01((y - birthEndY) / raceSpan));
        stripOffset = birthOffset + raceTravel * raceProgress;
      } else if (y < riseEndY) {
        raceProgress = 1;
        stripOffset = travel;
        // La scena sale di UN viewport dentro la stessa finestra, con una legge
        // che parte da FERMA (v = 0, come in corsa, dove è ferma) e arriva a
        // velocità piena (v = 1:1, come nello sblocco). È l'unico modo di non
        // avere nessuno dei due strappi: una salita lineare arriverebbe a
        // 1.086:1 e accelererebbe verso la fine, una smoothstep decelererebbe a
        // 0 e strapperebbe con lo sblocco. Con v(e) = e^K l'area totalizzata è
        // vh e la velocità finale è vh·(K+1): perché valga esattamente
        // riseSpan — cioè 1:1 — serve K = riseSpan/vh − 1.
        const K = Math.max(RISE_EXPONENT_FLOOR, riseSpan / viewportHeight - 1);
        const e = clamp01((y - raceEndY) / riseSpan);
        sceneRise = viewportHeight * Math.pow(e, K + 1);
      } else {
        // Sblocco: lo strip resta FERMO (la salita è finita, non riprende: se
        // ripartisse qui il confine si sentirebbe) e la scena sale con lo
        // scroll naturale. Il max(0, …) è ciò che rende lo sblocco reversibile:
        // riscorrendo sotto riseEndY si rientra esattamente nella salita.
        raceProgress = 1;
        stripOffset = travel;
        sceneRise = viewportHeight + Math.max(0, y - riseEndY);
      }
      if (stripRef.current) {
        stripRef.current.style.transform = `translate3d(${-stripOffset.toFixed(2)}px, 0, 0)`;
        // !== 0 e non > 0: birthOffset è NEGATIVO (lo strip parte indietro di
        // mezzo slot e mezzo per portare la card 1 al centro), quindi il test
        // positivo lo lasciava a 'auto' proprio mentre la Works è ferma a
        // schermo e una variazione costerebbe un reflow.
        stripRef.current.style.willChange = stripOffset !== 0 ? 'transform' : 'auto';
      }
      const cardHalf = stripMetrics.cardWidth / 2;
      // La Works viene compensata per tutto il suo corso: il riposo naturale
      // soltanto a worksTop, così la scena è ferma a schermo per nascita e
      // corsa.
      //
      // Poi SALITA e SBLOCCO la fanno SALIRE: `sceneRise` e' 0 in nascita e
      // corsa, arriva a un viewport in salita e poi cresce di 1 px per px di
      // scroll, quindi la Works esce TAGLIATA dal bordo superiore mentre la
      // sezione successiva sale dal basso. Nessuna sovrapposizione: a fine
      // sezione la scena e' salita di due viewport ed e' gia' sparita prima che
      // la sezione dopo arrivi a schermo.
      //
      // Infine il box viene centrato fra i due riferimenti fissi della pagina
      // (indicazione geografica in alto, telemetria in basso): l'offset si
      // somma alla compensazione perche' lo spostamento verticale della scena
      // e' gia' tutto su quella stessa translate.
      const pinned = cardsVisible ? y - worksTop : 0;
      const sceneShift = pinned + boxCenterOffsetRef.current - sceneRise;
      // Quota di salita raggiunta, usata per il clip della sezione e per la
      // visibilità delle card: sotto 1 la scena è ancora dentro lo schermo.
      const riseRatio = sceneRise / Math.max(1, viewportHeight);

      if (sceneRef.current) {
        sceneRef.current.style.visibility = cardsVisible ? 'visible' : 'hidden';
        sceneRef.current.style.opacity = '1';
        sceneRef.current.style.pointerEvents =
          y >= worksTop - 0.5 && riseRatio < 0.02 ? 'auto' : 'none';
        sceneRef.current.style.willChange = sceneShift !== 0 ? 'transform' : 'auto';
        sceneRef.current.style.transform = sceneShift !== 0
          ? `translate3d(0, ${sceneShift.toFixed(2)}px, 0)`
          : '';
      }
      // La sezione deve permettere alle card di uscire dal proprio box durante
      // il volo e la corsa (nascono fuori campo, a destra), E durante la
      // salita e lo sblocco: la scena sale e i suoi bordi escono dal
      // rettangolo della sezione, e con overflow hidden verrebbe tagliata a
      // meta' salita. Il clip torna quando la scena e' uscita del tutto, cosi'
      // la sezione dopo non eredita mai card sovrapposte.
      if (worksSection) {
        worksSection.style.overflow = riseRatio < 1 - 0.0006 ? 'visible' : 'hidden';
      }

      // Telemetria delle traiettorie del frame corrente: una voce per card, con
      // i due termini che separano le famiglie (retta compensata + escape) e
      // il volo. Si pubblica a FINE loop, quando è popolata, e serve alle
      // verifiche headless per controllare l'escape senza stimarlo dai rect.
      const trajTelemetry: Array<Record<string, number>> = [];

      // Espone i confini di fase in dev: le verifiche headless (CDP) devono
      // etichettare i campioni con i valori REALI, che derivano dalla striscia
      // misurata e non si ricavano dal solo scroll. In produzione il ramo
      // sparisce e la build non contiene l'assegnazione.
      if (import.meta.env.DEV) {
        (window as unknown as { __worksPhases?: unknown }).__worksPhases = {
          worksTop, birthEndY, raceEndY, riseEndY, birthSpan, raceSpan, riseSpan,
          birthOffset, raceTravel, travel, vh: viewportHeight,
          // Punti di riferimento delle traiettorie: il punto di fuga e gli slot a
          // riposo. Servono alle verifiche per ricavare la retta di ogni card e
          // confrontarla con la posizione realmente dipinta.
          vanish: perspectiveOriginRef.current,
          slots: slotCentersRef.current.map((s) => (s ? { x: s.x, y: s.y } : null)),
        };
      }

      cardRefs.current.forEach((card, index) => {
        if (!card) return;
        const slot = slotCentersRef.current[index];
        // getBoundingClientRect forza un layout sincronizzato: se lo si chiama per
        // ogni card a ogni frame si pagano 6 reflow inutili per frame, e il
        // risultato verrebbe comunque buttato quando lo slot esiste gia.
        // Si misura quindi solo nel ramo di fallback.
        const restCenterX = slot?.x ?? (() => {
          const rect = card.getBoundingClientRect();
          const sceneRect = sceneRef.current?.getBoundingClientRect();
          return rect.left - (sceneRect?.left ?? 0) + rect.width / 2;
        })();
        const restCenterY = slot?.y ?? (() => {
          const rect = card.getBoundingClientRect();
          const sceneRect = sceneRef.current?.getBoundingClientRect();
          return rect.top - (sceneRect?.top ?? 0) + rect.height / 2;
        })();
        // Posizione CORRENTE della card: lo slot a riposo meno lo scorrimento
        // dello strip. E' da qui che si misura la distanza dal punto di fuga.
        const finalCenterX = restCenterX - stripOffset;
        const finalCenterY = restCenterY;

        // Finestra di nascita: IL NASTRO, una card per step.
        //
        //  - la card 1 vola nella fase di NASCITA, con lo strip fermo: e' sola
        //    al centro e non ha nessuna card davanti da cui spingersi.
        //  - le altre cinque volano una per step della corsa: la card i nasce
        //    quando atterra la card i-1 e atterra quando nasce la card i+1.
        //
        // Ogni volo copre quindi esattamente 1/(card-1) della corsa, e i voli
        // NON si sovrappongono: c'e' sempre una sola card in aria, e quella
        // appena atterrata e' al centro mentre la nuova le cresce dentro. Non e'
        // una scelta estetica ma la conseguenza di due requisiti insieme: la
        // card i nasce al centro (punto occupato dalla card i-1, quindi la nuova
        // esce DA DIETRO) e ogni nuova card spinge le precedenti di uno step.
        // Con voli sovrapposti due card sarebbero in aria insieme e si
        // incrocerebbero proprio sul centro.
        // Piano di volo. Nella NASCITA lo strip è FERMO, quindi lo scroll è
        // già la grandiezza giusta e il volo si legge su di esso. Nella CORSA
        // invece si legge in RACE PROGRESS, la posizione lineare normalizzata
        // dello strip: lì la finestra di volo e il moto dello strip sono la
        // stessa grandiezza, e l'atterraggio è esatto per costruzione.
        //
        // `voloIniziato` è la stessa condizione in entrambi i rami, perché la
        // soglia di visibilità della card più in basso deve coincidere con
        // l'inizio del volo: se le due grandezze divergessero, la card
        // apparirebbe come disco bokeh prima di partire, o resterebbe invisibile
        // dopo aver iniziato.
        let voloIniziato: boolean;
        let flight: number;
        if (index === 0) {
          // NASCITA, con due estremi. La card 1 parte dal punto di fuga dentro
          // la nebulosa, al 45% del viaggio Nebula → Works, e atterra a
          // birthEndY. Non parte da worksTop: così durante l'esplosione delle
          // particelle si vede già il disco che sta per diventare card, e la
          // Works accoglie una card a metà formazione invece di una griglia già
          // perfetta che non spiega da dove venga. L'atterraggio resta a
          // birthEndY, quindi il nastro e i suoi 5 step non cambiano.
          //
          // CARD_FLIGHT_START_OFFSET_PX: il disco sorgente e' gia' visibile da
          // cardRevealAt, quindi il contenuto parte un filo dopo, non insieme.
          const birthStart =
            cardRevealAt + (worksTop - cardRevealAt) * IN_BIRTH_START_RATIO;
          const flightStartY = birthStart + CARD_FLIGHT_START_OFFSET_PX;
          const flightEndY = birthEndY;
          voloIniziato = y >= flightStartY - 1;
          flight = clamp01(
            (y - flightStartY) / Math.max(1, flightEndY - flightStartY),
          );
        } else {
          // Un volo per step, misurato sulla corsa e non sulla sezione:
          // index 1 occupa [0, 1/5], index 5 occupa [4/5, 1].
          const steps = Math.max(1, projects.length - 1);
          const from = (index - 1) / steps;
          const to = index / steps;
          // CARD_ENTRY_MARGIN_PX tiene il punto sorgente DENTRO lo schermo
          // quando il volo parte: a quest'altezza la card e' un disco di pochi
          // pixel, e se il centro sorgente stasse oltre il bordo durante la
          // crescita si vedrebbe il disco rientrare dal nulla invece di essere
          // gia' li' che si allarga. Se la sorgente non e' ancora in campo lo
          // stagger non serve: la card entra comunque piu' tardi, quando la
          // corsa la porta dentro, e un ritardo la lascerebbe sporgere dal bordo.
          const cardHalf = stripMetrics.cardWidth / 2;
          const sourceVisible =
            finalCenterX - cardHalf - CARD_ENTRY_MARGIN_PX <= stripMetrics.sceneWidth;
          // Il ritardo e' in px di scroll e viene portato in raceProgress con
          // la velocita' di CROCIERA, cosi' vale lo stesso numero di px di
          // prima. Il denominatore si riduce dello stesso ritardo: la finestra
          // si accorcia da sinistra e NON si sposta, quindi flight = 1 arriva
          // esattamente a raceProgress = to e l'atterraggio non si muove. Il
          // denominatore resta positivo per costruzione (i voli restano
          // disgiunti anche col ritardo: il nastro non si spacca).
          const ritardo = sourceVisible
            ? (index * cardStagger) / ((1 - RACE_RAMP_RATIO) * raceSpan)
            : 0;
          const ampiezza = Math.max(1e-6, to - from - ritardo);
          voloIniziato = raceProgress >= from + ritardo;
          flight = clamp01((raceProgress - from - ritardo) / ampiezza);
        }
        // Planata nello scroll: la dimensione cresce con una curva a potenza
        // (parte da un punto, accelera al centro, si posa alla fine), mentre la
        // profondità e il fuori fuoco restano quelli di una camera.
        const growth = Math.pow(flight, CARD_GROWTH_EXPONENT);
        const sizeFactor = CARD_POINT_SCALE + (1 - CARD_POINT_SCALE) * growth;
        const seed = Math.sin(index * 19.17 + 4.2) * 43758.5453;
        const seedUnit = seed - Math.floor(seed);
        // Tutte le card nascono dal vero perspectiveOrigin della scena Works.
        // La divergenza avviene quindi lungo raggi prospettici reali, senza
        // ereditare il moto verticale della sezione che scorre sotto.
        // La sorgente nasce dal vero perspectiveOrigin della scena Works, letto
        // in coordinate LOCALI: è lo stesso punto attorno a cui il CSS proietta,
        // quindi l'origine coincide con la posizione schermo della card a
        // riposo e il punto di fuga cade dove l'utente lo vede. Con lo strip in
        // movimento questo punto si sposta a ogni frame, ed è la ragione per cui
        // si usa finalCenterX (posizione corrente) e non quella a riposo.
        const origin = perspectiveOriginRef.current;
        const opticalCenterX = origin.x > 0
          ? origin.x
          : document.documentElement.clientWidth / 2;
        const opticalCenterY = origin.y > 0
          ? origin.y
          : window.innerHeight / 2;
        // Tutte le sorgenti nascono dallo stesso punto di fuga prospettico.
        // Non aggiungiamo jitter o bend: la divergenza verso gli slot avviene
        // lungo la traiettoria radiale della singola card.
        const originX = opticalCenterX - finalCenterX;
        const originY = opticalCenterY - finalCenterY;
        const depth = CARD_START_DEPTH * (1 - flight) *
          (1 + (seedUnit - 0.5) * CARD_DEPTH_JITTER);
        // Proiezione prospettica della card: scala locale × divide della
        // perspective del contenitore. Serve anche al blur, che è locale.
        const projection = sizeFactor *
          (CARD_PERSPECTIVE_PX / (CARD_PERSPECTIVE_PX + depth));
        // Messa a fuoco: la card si risolve solo nella coda del volo, mentre il
        // disco bokeh la rappresenta da lontano.
        const focus = smoothstep(clamp01(
          (flight - CARD_FOCUS_START) / (CARD_FOCUS_END - CARD_FOCUS_START),
        ));
        const screenBlur = CARD_COC_SCREEN_PX * Math.pow(1 - focus, 1.4);
        const localBlur = Math.min(
          CARD_MAX_LOCAL_BLUR_PX,
          screenBlur / Math.max(projection, 0.05),
        );
        const discScreen = CARD_DISC_MIN_PX +
          (CARD_DISC_MAX_PX - CARD_DISC_MIN_PX) *
            smoothstep(clamp01(flight / 0.55));
        const discLocal = discScreen / Math.max(projection, 0.05);
        const discOpacity = CARD_DISC_ALPHA *
          (CARD_DISC_INITIAL_ALPHA +
            (1 - CARD_DISC_INITIAL_ALPHA) *
              smoothstep(clamp01(flight / CARD_DISC_FADE_IN))) *
          (1 - focus);
        // Fattore di proiezione della scena: k = perspective / (perspective + depth).
        // Cresce da ~0.56 a 1.0 durante il volo, quindi la posizione LOCALE
        // applicata non coincide con quella a schermo: senza compensazione la
        // traiettoria risultava curva, con scarto misurato fino a 56px a meta volo.
        const perspectiveK = CARD_PERSPECTIVE_PX / (CARD_PERSPECTIVE_PX + depth);
        // Dividere per k riporta la traiettoria a schermo su quella disegnata.
        const positionProgress = smoothstep(flight) / Math.max(perspectiveK, 0.05);
        const positionX = originX * (1 - positionProgress);
        const positionY = originY * (1 - positionProgress);
        // ---------------------------------------------------------------------
        // LA TRAIETTORIA
        // ---------------------------------------------------------------------
        // Un solo percorso per tutte e sei: la retta dal punto di fuga allo slot
        // corrente, compensata di 1/k dalla proiezione prospettica. A flight = 0
        // vale positionX = originX, cioe' la card nasce LETTERALMENTE dal centro.
        //
        // Non c'e' piu' nessun termine di escape: esisteva per non far passare la
        // card per il centro, ma adesso il centro e' occupato di proposito - e'
        // li' che atterra la card precedente e da li' la nuova esce dietro.
        // escapeX resta 0 e resta pubblicato in telemetria per poterlo
        // verificare a misura invece di dedurlo dai rect.
        const escapeX = 0;
        const complete = flight >= 0.999;
        const depthLayer = cardDepthRefs.current[index];
        const blurLayer = cardBlurRefs.current[index];
        const disc = cardDiscRefs.current[index];
        card.style.opacity = '1';
        // La card è visibile solo per la sua finestra di nascita. Prima che il
        // volo cominci resterebbe un dischetto fermo al punto di fuga, dove si
        // sovrapporrebbe a quello delle card che nascono dopo: senza questo
        // controllo, allo stop Works si vedrebbe un unico punto con tre card
        // sovrapposte invece del solo bokeh di quella che sta davvero arrivando.
        //
        // Nella salita e nello sblocco vale l'altro estremo: la card esce a
        // sinistra insieme allo strip e la scena sale, quindi quando e' finita
        // oltre il bordo sinistro (o quando la scena e' uscita del tutto) non
        // deve piu' essere disegnata. Senza questo le card resterebbero
        // visibili mentre la scena esce, e si sovrapporrebbero alla sezione
        // dopo.
        const slotOnScreen = restCenterX - stripOffset;
        const onScreen = slotOnScreen + cardHalf >= 0 && slotOnScreen - cardHalf <= stripMetrics.sceneWidth;
        card.style.visibility =
          voloIniziato && onScreen && riseRatio < 0.999 ? 'visible' : 'hidden';
        // Una card in volo occupa comunque tutta la sua box 360px: anche quando
        // e' solo un disco bokeh di 22px al punto di fuga, se restasse cliccabile
        // ruberebbe i click alle card gia' composte che gli stanno dietro
        // (misurato: il click sul centro della card 1 finiva sulla card 3).
        //
        // La soglia e' sulla POSIZIONE, non sulla curva di focus: quello che
        // distingue una card cliccabile da una che ruba i click e' l'aver
        // lasciato il punto di fuga, non la nitidezza. Con la curva di focus la
        // card 2 risultava gia' nitida e composta ma non cliccabile.
        card.style.pointerEvents = positionProgress >= 0.5 ? 'auto' : 'none';
        // willChange si commuta UNA volta per card, all'atterraggio: si scrive
        // solo allora (vedi landedRef).
        if (landedRef.current[index] !== complete) {
          landedRef.current[index] = complete;
          card.style.willChange = complete ? 'auto' : 'transform';
          if (depthLayer) depthLayer.style.willChange = complete ? 'auto' : 'transform';
          if (blurLayer) {
            blurLayer.style.willChange = complete ? 'auto' : 'filter, opacity';
          }
        }
        // Non azzeriamo lo stile al completamento: già a flight=1 i valori
        // sono identici al layout naturale, quindi il passaggio resta continuo.
        // L'escape entra qui, sommato alla posizione della retta: a flight 1
        // vale 0 e la card è già al centro del suo box, quindi la posizione
        // finale è la stessa delle due famiglie.
        card.style.transform = `translate3d(${(positionX + escapeX).toFixed(2)}px, ${positionY.toFixed(2)}px, 0)`;
        // Telemetria di traiettoria in dev: i due termini che separano le
        // famiglie (retta compensata + escape) e il volo, così le verifiche
        // headless possono controllarli senza ricavarli da una stima.
        trajTelemetry[index] = { flight, positionX, escapeX, positionY, k: perspectiveK };
        if (depthLayer) {
          // Manteniamo anche a flight=1 una trasformazione esplicita e
          // coincidente con il layout naturale: evita il reset di stile che
          // faceva ricomparire la griglia nell'ultimo frame.
          depthLayer.style.opacity = '1';
          depthLayer.style.transform = `translate3d(0, 0, ${(-depth).toFixed(2)}px) scale(${sizeFactor.toFixed(5)}) rotateX(${((seedUnit - 0.5) * 9 * (1 - flight)).toFixed(3)}deg) rotateY(${((0.5 - seedUnit) * 7 * (1 - flight)).toFixed(3)}deg)`;
        }
        if (blurLayer) {
          blurLayer.style.opacity = String(focus);
          blurLayer.style.filter = localBlur > 0.12
            ? `blur(${localBlur.toFixed(2)}px) saturate(1.08)`
            : 'none';
        }
        if (disc) {
          // SCALA e non width/height: vedi CARD_DISC_BASE_PX. Il gradiente
          // radiale è definito in percentuale della box, quindi riscala
          // insieme all'elemento e il disco resta identico a occhio.
          const discScale = complete ? 0 : discLocal / CARD_DISC_BASE_PX;
          disc.style.transform =
            `translate(-50%, -50%) scale(${discScale.toFixed(4)})`;
          disc.style.opacity = complete ? '0' : discOpacity.toFixed(3);
        }
      });

      // La telemetria si pubblica a FINE loop: dentro il forEach è ancora in
      // costruzione, e un export letto a metà darebbe l'array del frame
      // precedente (o vuoto al primo giro).
      if (import.meta.env.DEV) {
        const phases = (window as unknown as { __worksPhases?: Record<string, unknown> }).__worksPhases;
        if (phases) phases.traj = trajTelemetry;
      }
    };

    // Frame condiviso con il canvas (subscribeFrame): il provider fa avanzare
    // Lenis PRIMA dei consumer, quindi qui la MotionValue e gia quella corrente.
    // Con un RAF proprio le card venivano disegnate un frame indietro rispetto
    // alla nebulosa, e con la densita della scena si leggeva come sfarfallio.
    const unsubscribeFrame = subscribeFrame(() => {
      render();
    });
    render();
    return unsubscribeFrame;
  }, [layoutVersion, projects.length, scrollY, subscribeFrame]);

  return (
    <div
      ref={sceneRef}
      // perspectiveOrigin NON è impostato qui: viene calcolato in
      // useLayoutEffect (centro pagina esclusa la scrollbar, compensato del
      // padding superiore della sezione). Un valore inline '50% 50%'
      // sovrascriverebbe quel calcolo e riporterebbe il punto di fuga al centro
      // del BOX della scena, cioè 96px sotto il centro della viewport.
      style={{ opacity: 1, visibility: 'hidden', perspective: '1200px', transformStyle: 'preserve-3d' }}
      className="h-screen w-full bg-transparent relative overflow-hidden flex flex-col"
    >
      {/* Nessuna riga di intestazione: le indicazioni MILANO / POTENZA in alto a
          destra e la telemetria in basso a sinistra sono gli unici elementi di
          testo fuori dalle card. La vecchia riga [06 PROJECTS] e' stata
          eliminata insieme al suo codice di animazione. */}
      {/* flex in riga: lo strip prende l'altezza disponibile e centra le card,
          lo spacer assorbe la larghezza eccedente. Il padding orizzontale a
          md+ è 60px = un gap esatto: così la prima card ha il centro a 210px
          (60 + 300/2) e la composizione di tre card parte da un bordo pulito
          invece di affacciare la prima card al filo dello schermo. Sotto md
          resta px-4 perché a quella larghezza 60px mangerebbe troppa striscia. */}
      <div className="relative z-10 flex-1 flex overflow-visible px-4 md:px-[60px]">
        {/* STRIP: la fila orizzontale delle card. Lo scroll verticale comanda il
            suo spostamento in X (impostato nel render loop), quindi non c'e' uno
            overflow orizzontale nativo: nessuna barra di scorrimento laterale e
            nessun conflitto con Lenis. Lo strip e' piu' largo della scena di
            quanto serve a portare tutte le card in campo. */}
        <div
          ref={stripRef}
          className="flex h-full items-center will-change-transform"
          style={{
            transformStyle: 'preserve-3d',
            gap: 'var(--works-gap)',
            width: 'max-content',
          }}
        >
          {projects.map((project, index) => (
            <div
              key={project.code}
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              // Card VERTICALE 3:4: la larghezza è fissa e l'altezza deriva
              // dall'aspect. È la larghezza a pilotare la corsa dello strip,
              // mentre l'altezza deve stare dentro la scena (100vh meno il
              // padding della sezione) senza sforare.
              // data-card-root identifica la card radice: i suoi figli (depth
              // layer, disco, blur layer) hanno anch'essi classi di layout, quindi
              // un selettore per classe li conterrebbe insieme a lei.
              data-card-root={index}
              className="shrink-0"
              style={{
                flex: '0 0 var(--works-card-w)',
                // minWidth 0 disattiva la dimensione minima automatica del flex
                // item (che vale min-content). Senza, un figlio più largo della
                // card — il titolo, che KineticText tiene su una riga sola —
                // farebbe CRESCERE la card oltre i 300px e romperebbe insieme
                // l'aspect 3:4 e il passo di 360px fra gli slot, cioè tutta la
                // geometria della corsa. Qui la larghezza è un contratto: il
                // contenuto deve starci dentro, e non il contrario.
                minWidth: 0,
                opacity: 0,
                visibility: 'hidden',
                transformOrigin: '50% 50%',
                willChange: 'transform',
                // z-order INVERTO: le card sono flex item quindi z-index vale,
                // ma nell'ordine del DOM l'ultima sta SOPRA. Servono invece
                // le prime davanti, perche' la card appena atterrata occupa il
                // centro e la nuova deve crescere DIETRO di lei ed emergere
                // dal suo bordo. Cura anche i click: pointerEvents mette
                // 'auto' a meta' volo, quindi la card in aria e' gia'
                // cliccabile mentre e' dentro la precedente, e senza questo
                // z-index il click prenderebbe quella sbagliata.
                zIndex: projects.length - index,
              }}
            >
              <div
                ref={(element) => {
                  cardDepthRefs.current[index] = element;
                }}
                className="relative h-full w-full aspect-[3/4]"
                style={{
                  opacity: 0,
                  transformOrigin: '50% 50%',
                  transformStyle: 'preserve-3d',
                  willChange: 'transform',
                }}
              >
                {/* Disco bokeh: è la card quando è lontana. Sta dentro la depth
                    layer, quindi eredita la stessa proiezione della card (il
                    centro resta sempre coincidente) ma non il suo blur. */}
                <span
                  ref={(element) => {
                    cardDiscRefs.current[index] = element;
                  }}
                  aria-hidden="true"
                  data-card-bokeh={index}
                  className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
                  style={{
                    width: CARD_DISC_BASE_PX,
                    height: CARD_DISC_BASE_PX,
                    opacity: 0,
                    backgroundImage: CARD_BOKEH_GRADIENT,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
                <div
                  ref={(element) => {
                    cardBlurRefs.current[index] = element;
                  }}
                  className="h-full w-full"
                  style={{
                    opacity: 0,
                    transformOrigin: '50% 50%',
                    willChange: 'filter, opacity',
                  }}
                >
                  <ProjectCard
                    project={project}
                    index={index}
                    onOpen={() => onOpenProject(index)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* Lo spacer tiene larga la scena quanto la viewport: senza di lui il
            prospettiva del CSS si riferirebbe a una scena larga tutta la
            striscia e le card apparirebbero decentrate rispetto al punto di
            fuga. */}
        <div aria-hidden="true" className="works-spacer" />
      </div>
    </div>
  );
}

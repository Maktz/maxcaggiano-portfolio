import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import {
  clamp01,
  invalidateSceneTops,

} from '@/lib/scrollMath';
import { useSmoothScroll } from '@/providers/smoothScrollContext';
import { reducedMotion } from '@/lib/motionPreference';
import type { Project } from '@/data/projects';
import ProjectCard from './ProjectCard';
import AddProjectCard from './AddProjectCard';

interface ProjectsSceneProps {
  projects: Project[];
  onOpenProject: (index: number) => void;
  scrollY: MotionValue<number>;
}

// IL RESPIRO ATTORNO AGLI HUD, e il tetto di altezza della card.
//
// `SAFE_AREA_GAP` è la distanza che le card mantengono dagli elementi HUD: 16px,
// ed è l'unico px di questa sezione che non viene misurato dal DOM, perché è un
// margine di cortesia e non una posizione.
//
// `CARD_MAX_HEIGHT_RATIO` è il rapporto massimo fra altezza e larghezza della
// card. Serve a mantenere le proporzioni su viewport alte e larghe: senza, la
// banda sicura potrebbe imporre card alte 1.9 volte la larghezza, che non hanno
// più niente a che fare con una card.
const SAFE_AREA_GAP = 16;
const CARD_MAX_HEIGHT_RATIO = 1.5;

// Quota del viaggio Nebula → Works in cui i DISCHI bokeh delle card diventano
// visibili. Anticipa l'ingresso della Works: i dischi sono gia' li' mentre la
// scena non e' ancora entrata, e la griglia si compone dentro Works.
const CARD_SOURCE_REVEAL_RATIO = 0.34;
// Quota della sezione Works entro cui le card nate in anticipo chiudono il
// volo: dentro i primi pixel della sezione, quindi si compongono mentre lo
// strip comincia gia' a scorrere. Il valore e' volutamente piccolo: se le card
// chiudessero troppo tardi, al fermo del Works la griglia sarebbe ancora in
// formazione e non si leggerebbe comeWORKS finito.
const IN_BIRTH_END_RATIO = 0.08;
// ── L'INGRESSO DELLE CARD: DA FUORI BORDO DESTRO ─────────────────────────
//
// Prima le card crescevano da un punto centrale (CARD_POINT_SCALE, la planata):
// tutte e sei nascevano nello stesso punto e si aprivano come un'iris. È il
// difetto da correggere — l'ingresso deve venire da FUORI, dal bordo destro, e
// non da un punto in mezzo allo schermo.
//
// Quindi qui non c'è nessuna profondità e nessuna scala: le card sono già nella
// loro posizione finale (lo strip le mette in fila) e l'ingresso le TRAE dentro
// dallo spazio che sta oltre il bordo destro della viewport. Tre cose si muovono
// insieme, tutte funzione del tempo:
//
//   offsetX : da (larghezza viewport) a 0 — parte fuori campo, arriva al posto
//   rotazione: da CARD_ENTER_ROTATION a 0 — arriva dritta
//   opacità : da 0 a 1 — accende mentre entra
//
// I tre numeri sono tempi in secondi, non pixel: è un'animazione che parte
// quando la Works entra in scena, non qualcosa che segue i pixel di scroll.
// IL VENTAGLIO: le card nascono impilate al CENTRO e si aprono ai loro slot.
//
// Non più un ingresso da fuori bordo destro, e non più un orologio: il moto è
// una funzione del PROGRESS dello scroll della fase di nascita, quindi è
// scrubbato, reversibile e non ha nessuno stato accumulato.
//
//   scala     : da CARD_FAN_START_SCALE a 1 — la mazzetta si apre
//   posizione : dal centro della viewport al suo slot reale
//   rotazione : da ±CARD_FAN_ROTATION gradi a 0 — le carte si raddrizzano
//   opacità   : da 0 a 1 — accendono mentre si aprono
//
// Lo STAGGER è una frazione della finestra di nascita, non un tempo in ms: il
// moto è scrubbato, e in un moto scrubbato un ritardo ha senso solo in px di
// scroll. CARD_FAN_STAGGER_RATIO = 0.12 vuol dire che ogni card aspetta circa
// un ottavo della finestra prima di partire — circa 60-90ms alla velocità con
// cui la sezione viene percorsa normalmente. Il valore non può superare 1/(card−1):
// oltre, l'ultima card avrebbe un ritardo maggiore della finestra stessa e non
// si aprirebbe mai.
const CARD_FAN_START_SCALE = 0.25;
const CARD_FAN_ROTATION = 4;
const CARD_FAN_STAGGER_RATIO = 0.12;
// L'ease del ventaglio: parte subito e si posa in fondo (ease-out cubico), così
// la card si stacca dal centro e si ferma al suo posto invece di frenare.
const cardFanEase = (t: number) => 1 - Math.pow(1 - t, 3);
// Il trameggio in uscita: la card che esce a sinistra si spegne nell'ultima
// CARD_EXIT_FADE_SPAN mezza card, e non sotto CARD_EXIT_FADE_MIN. Il minimo
// serve perché una card già fuori campo resti accennata invece di flickering.
const CARD_EXIT_FADE_SPAN = 1.1;
const CARD_EXIT_FADE_MIN = 0.12;



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
  // I ref delle card: uno per slot, e l'ultimo slot è la card «+». Gli altri
  // tre ref che c'erano (depth, blur, disco bokeh) sono spariti con la planata:
  // senza profondità non c'è più niente da simulare dentro la card.
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
  // LO SCARTO VERTICALE DELLA SAFE AREA: quanto il centro delle card deve
  // salire (o scendere) rispetto al centro della scena, perché stanno nella
  // banda fra gli HUD e non nello schermo. Vive in un ref perché cambia solo
  // al resize e non deve provocare un render.
  const safeCenterOffsetRef = useRef(0);
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
      // Il marchio in alto è il terzo riferimento fisso che le card non devono
      // coprire, insieme alla coppia geografica e alla telemetria. È un
      // elemento `fixed` della pagina, quindi il suo rect è già in coordinate
      // di viewport.
      const headerEl = document.querySelector<HTMLElement>('header');
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
        const firstSlotX = slotCentersRef.current.find((slot) => slot)?.x;
        const lastSlotX = slotCentersRef.current[slotCentersRef.current.length - 1]?.x;
        const cardTotal = Math.max(1, slotCentersRef.current.length - 1);
        // LA LARGHEZZA va letta da `offsetWidth`, NON da `getBoundingClientRect`.
        //
        // Il rect e' la larghezza VISIVA, cioe' quella dopo i transform: mentre la
        // Works e' in transizione il render loop tiene le card nel ventaglio, con
        // `scale(CARD_FAN_START_SCALE)` = 0.25, e il rect vale 408 × 0.25 = 102
        // invece di 408. La misura alimentava quindi il proprio risultato: da 102
        // nasceva `cardHeight = min(safeHeight, 102 × 1.5) = 153`, la card si
        // accorciava, e la misura successiva la trovava piu' stretta ancora.
        //
        // Misurato in `vite preview` a 1512×780: la larghezza letta alternava
        // 408 → 107 → 103 → 103px nelle varie chiamate, e `--works-card-h`
        // restava a 155px invece dei 547px che la banda sicura dichiara. Da li le
        // card a 408×155, cioe' schiacciate a un terzo con brief e CTA tagliati.
        //
        // `offsetWidth` e' la larghezza di LAYOUT: ignora i transform, ed e' quindi
        // la grandezza che il contratto `flex: 0 0 var(--works-card-w)` fissa.
        const measuredCardWidth =
          cardRefs.current[0]?.offsetWidth ?? 0;
        const cardHalf = measuredCardWidth / 2;
        // LA SAFE AREA VERTICALE, misurata dal DOM.
        //
        // Le card non possono coprire i tre riferimenti fissi della pagina: il
        // marchio in alto, la coppia geografica in alto a destra e la
        // telemetria in basso a sinistra. Prima l'altezza delle card veniva dal
        // loro contenuto e arrivava fin sotto le etichette, toccandole.
        //
        // La banda sicura va dal fondo del riferimento PIÙ ALTO al tetto del
        // PIÙ BASSO, con un respiro di SAFE_AREA_GAP attorno. Si misura tutto con
        // `getBoundingClientRect`, senza un solo px scritto a mano: le due
        // etichette HUD sono `hidden` sotto md, quindi il loro rect è vuoto e la
        // safe area si allarga da sola alle viewport strette — che è la richiesta
        // per il mobile, ottenuta senza un ramo dedicato.
        //
        // I riferimenti sono in ordine di esistenza: `max` per il soffitto e
        // `min` per il pavimento, così se un HUD è nascosto non si crea mai una
        // banda a rovescio.
        const safeGap = SAFE_AREA_GAP;
        // La banda sicura parte dalla VIEWPORT, non da `scene.clientHeight`.
        //
        // I tre HUD sono `position: fixed`, quindi i loro rect sono in coordinate
        // di viewport: `bottom = 96` significa "96px dal bordo alto dello
        // schermo", sempre. `scene.clientHeight` e' invece una misura del
        // DOCUMENTO, che cambia con il layout della sezione e non ha nessun
        // rapporto con la posizione degli HUD. Mescolare le due grandezze
        // produceva una banda che dipendeva dall'ordinamento del layout, e in
        // produzione — dove i font arrivano in un ordine diverso — la misura
        // partiva da una banda falsata: `safeHeight` crollava e
        // `--works-card-h` finiva a 155px invece dei 547px che la formula
        // dichiara. Le card risultavano schiacciate con il contenuto tagliato
        // sotto il KPI.
        //
        // Il riferimento e' la viewport perche' e' l'unico sistema in cui
        // vivono i rect degli HUD: e' l'unica base con cui sono confrontabili.
        const viewportBox = window.innerHeight;
        // La banda parte dalla viewport intera e si RESTRINGE per ogni HUD. Non
        // si prende `max(bottom)` e `min(top)` su tutti gli elementi insieme:
        // sotto md esiste solo l'header, e il suo `top` (0) verrebbe preso come
        // PAVIMENTO, producendo una banda a roverscio — misurato: 96px di
        // sovrapposizione fra card e header su 390×844. Un HUD decide se
        // spinge il soffitto o il pavimento in base a metà della viewport in cui
        // si trova, che è la definizione stessa di «banda libera».
        let safeTop = 0;
        let safeBottom = viewportBox;
        const mid = viewportBox / 2;
        for (const node of [headerEl, geoEl, telemetryEl]) {
          if (!node) continue;
          const rect = node.getBoundingClientRect();
          // Un HUD nascosto sotto md ha rect vuoto: va ignorato, ed è quello
          // che fa allargare da sola la banda sulle viewport strette.
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (rect.bottom <= mid) {
            safeTop = Math.max(safeTop, rect.bottom + safeGap);
          } else {
            safeBottom = Math.min(safeBottom, rect.top - safeGap);
          }
        }
        const safeHeight = Math.max(120, safeBottom - safeTop);
        // L'ALTEZZA DELLA CARD è il minimo fra la banda sicura e il rapporto
        // della card. Il cap a 1.5× la larghezza serve oltre: senza, su una
        // viewport molto larga le card diventerebbero altissime e uscirebbero
        // dalla banda; con, restano proporzionate e dentro.
        const cardHeight = Math.min(safeHeight, measuredCardWidth * CARD_MAX_HEIGHT_RATIO);
        strip.style.setProperty('--works-card-h', `${Math.round(cardHeight)}px`);
        // LO SPOSTAMENTO VERTICALE: le card sono centrate nella SAFE AREA fra gli
        // HUD, non nella viewport. La banda è misurata in coordinate di
        // VIEWPORT (gli HUD sono `fixed`), ma lo strip vive dentro la scena, che
        // a sua volta è già traslata di `boxCenterOffset` per centrarsi fra le
        // due etichette. Perciò il centro di riferimento non è il centro
        // geometrico della viewport ma quello EFFETTIVO della scena: senza
        // questa correzione le card venivano spinte indietro di quello stesso
        // scarto e finivano dentro le etichette (misurato: 16px di
        // sovrapposizione a 1512×780).
        const sceneCenterY = viewportBox / 2 + boxCenterOffsetRef.current;
        safeCenterOffsetRef.current = (safeTop + safeBottom) / 2 - sceneCenterY;
        // IL GUTTER, misurato e non scritto.
        //
        // È il padding orizzontale della scena, cioè la distanza fra il bordo
        // sinistro della Works e il bordo sinistro della prima card. Si legge
        // dagli slot già misurati (`primo slot − mezza card`) invece che dal
        // CSS: i due non possono divergere, perché il CSS è ciò che ha prodotto
        // quegli slot. Da questo numero dipende l'estremo della corsa.
        const gutterX = firstSlotX !== undefined ? firstSlotX - cardHalf : 0;
        // NASCITA: LA PRIMA CARD È ANCORATA A SINISTRA, non al centro.
        //
        // Prima lo strip partiva "indietro" di mezzo slot e mezzo (`birthOffset`
        // negativo, misurato a −510px a 1440) per portare la card 1 al centro
        // della scena, e da lì la corsa la riportava a sinistra. Adesso la
        // Works si apre come una parete di lavori: la prima card parte dal suo
        // posto, con il gutter davanti, e non c'è più nessuno "indietro" da
        // recuperare. Lo zero è il layout naturale, quindi `birthOffset` è 0 e
        // la nascita non consuma nessuno scarto.
        const birthOffset = 0;
        // FINE TRACK: L'ULTIMA CARD SI FERMA AL GUTTER DESTRO.
        //
        // Prima `travel` portava l'ultima card al CENTRO della scena, e da lì
        // metà schermo a destra restava vuota per tutta la coda: è la «metà
        // destra vuota» del difetto. Ora il riferimento è il gutter destro, lo
        // stesso numero del gutter sinistro, quindi a fine corsa il margine
        // destro della card finale è uguale a quello della prima: la striscia
        // finisce dove è cominciata, e non c'è buco da nessuna parte.
        const travel = lastSlotX !== undefined
          ? lastSlotX + cardHalf - (scene.clientWidth - gutterX)
          : 0;
        stripMetricsRef.current = {
          travel,
          // Uscita completa: lo strip esce interamente a sinistra quando il suo
          // bordo destro ha superato il bordo sinistro della scena.
          fullTravel: Math.max(0, stripW),
          cardWidth: measuredCardWidth,
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
      cardRefs.current.forEach((card) => {
        if (!card) return;
        // Rimuoviamo temporaneamente la trasformazione corrente per leggere
        // lo slot del layout, non la posizione animata precedente. L'opacità
        // torna a 1 perché l'ingresso spegne la card: senza, il rect sarebbe
        // quello di un elemento invisibile e la misura degli slot sarebbe
        // quella di una Works non ancora formata.
        card.style.transform = '';
        card.style.opacity = '1';
      });
      setLayoutVersion((version) => version + 1);
    };

    measureSlots();
    const fontsReady = document.fonts?.ready;
    fontsReady?.then(measureSlots);

    // GLI HUD SONO UNA DIPENDENZA DELLA MISURA, E FINORA NON ERANO OSSERVATI.
    //
    // `measureSlots` legge i rect di header, indicazione geografica e telemetria
    // per costruire la banda sicura da cui nasce `--works-card-h`. Ma i suoi
    // trigger erano solo tre: il mount, i font, e il resize della scena. Nessuno
    // di questi copre il momento in cui gli HUD si ASSESTANO, che in produzione
    // avviene dopo il primo paint e in un ordine diverso dal dev.
    //
    // Il risultato era una banda falsata, non un valore assente: la misura gira
    // una volta sola con rect non ancora al loro posto e non torna piu'. Misurato
    // in `vite preview`: `--works-card-h` restava a 155px a 1512x780, mentre la
    // formula dichiarata a 547px — la card risultava 408x155 invece di
    // 409x547, cioe' schiacciata a un terzo con il brief e la CTA tagliati.
    // Basta un resize di 1px e il valore saliva a 547px: la formula era gia'
    // corretta, mancava solo la sua convergence.
    //
    // Si osservano i TRE HUD e non la sezione per la stessa ragione per cui non si
    // osserva la sezione: gli HUD sono `fixed` e non cambiano da soli, quindi non
    // possono generare il loop di notifiche che si evita guardando gli elementi
    // che il codice stesso modifica.
    const hudNodes = [
      document.querySelector<HTMLElement>('header'),
      document.querySelector<HTMLElement>('[data-anchor="geo"]'),
      document.querySelector<HTMLElement>('[data-anchor="telemetry"]'),
    ].filter((node): node is HTMLElement => node !== null);
    const hudObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureSlots) : null;
    hudNodes.forEach((node) => hudObserver?.observe(node));

    // Come ultimo richiamo, un frame dopo i font: `document.fonts.ready` puo'
    // risolversi PRIMA che gli HUD siano al loro posto, e allora la misura fatta
    // a quel punto resta quella falsata. Un secondo richiamo differito copre
    // quella finestra senza dipendere da quale dei due eventi arriva per primo.
    const settle = window.requestAnimationFrame(() => window.requestAnimationFrame(measureSlots));
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
      hudObserver?.disconnect();
      window.cancelAnimationFrame(settle);
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
      const cardsVisible = y >= cardRevealAt - 1;
      // L'OROLOGIO DELL'INGRESSO.
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
      // IL PROGRESSO DELLA NASCITA: la frazione di scroll su cui le card si
      // aprono a ventaglio. È la sola grandezza che il ventaglio legge, ed è
      // una funzione diretta dei pixel di scroll: nessun orologio, nessuno stato
      // accumulato, e il ritorno è lo stesso moto letto al contrario.
      // Fuori dalla sezione il valore è 0 (card chiuse) o 1 (card aperte), quindi
      // il moto è chiuso anche prima e dopo.
      const birthProgress = clamp01((y - worksTop) / birthSpan);
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
        // La Y non è 0: è lo scarto che centra le card nella SAFE AREA fra gli
        // HUD. Le card stanno centrate lì dentro, non nello schermo, e senza
        // questo scarto tornerebbero a toccare l'etichetta più bassa. Lo scarto
        // è misurato in `measureSlots` e vale 0 se gli HUD non esistono.
        const safeY = safeCenterOffsetRef.current;
        stripRef.current.style.transform =
          `translate3d(${-stripOffset.toFixed(2)}px, ${safeY.toFixed(2)}px, 0)`;
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
        // L'ingresso della card è in tempo e non in scroll, quindi qui non
        // serve nessuna posizione "corrente": la card sta al suo slot e da lì
        // viene tirata dentro. `restCenterX` basta, e serve più sotto per
        // l'uscita a sinistra.
        // L'INGRESSO: da fuori bordo destro, con stagger, in TEMPO.
        //
        // Non c'è più la planata né il nastro: nessuna profondità, nessuna
        // scala da un punto centrale, nessuna card che nasce al centro per poi
        // farsi spingere a sinistra. Ogni card è già al suo slot (lo strip le
        // mette in fila) e l'unica cosa che la fa entrare è un offset orizzontale
        // che la tiene fuori campo e la porta al posto.
        //
        // IL VENTAGLIO DAL CENTRO.
        //
        // Il moto è il PROGRESSO DELLA FASE DI NASCITA, cioè la porzione di
        // scroll in cui lo strip è fermo. Non c'è nessun orologio: la stessa
        // funzione che apre le card le richiude riscorrendo, quindi il ritorno è
        // speculare per costruzione e non per una simmetria scritta a mano.
        //
        // Lo STAGGER è la frazione di finestra che ogni card lascia alle
        // precedenti. Le carte si aprono da SINISTRA a DESTRA, che è l'ordine
        // in cui sono negli slot, e la finestra utile si restringe di conseguenza
        // per farle finire tutte entro la nascita: se l'ultima card partisse
        // dopo la fine della fase, il track inizierebbe a scorrere con le carte
        // ancora chiuse — ed è esattamente quello che succedeva contando i
        // ritardi sui PROGETTI (6) invece che sulle CARD (7): l'ultimo ritardo
        // superava 1 e quella card non si apriva mai.
        //
        // L'ultima card chiude esattamente a fine finestra: il suo ritardo più la
        // sua finestra deve fare 1, ed è quello che dà `fanWindow`.
        const cardCount = Math.max(1, cardRefs.current.length);
        const staggerStep = CARD_FAN_STAGGER_RATIO;
        const staggerSpan = staggerStep * Math.max(0, cardCount - 1);
        const fanDelay = index * staggerStep;
        const fanWindow = Math.max(0.05, 1 - staggerSpan);
        const fanT = clamp01((birthProgress - fanDelay) / fanWindow);
        const fanEased = cardFanEase(fanT);
        // LA ROTAZIONE INIZIALE è fissa per card, non casuale a ogni frame: un
        // `Math.random` qui farebbe tremare la composizione e romperebbe il
        // ritorno speculare. Il seed deriva dall'indice, quindi la stessa card ha
        // sempre la stessa inclinazione e il segno è alternato: si legge come un
        // mazzo di carte, non come un errore di arrotondamento.
        const fanSeed = Math.sin(index * 12.9898) * 43758.5453;
        const fanSeedUnit = fanSeed - Math.floor(fanSeed);
        const fanStartRot = (index % 2 === 0 ? 1 : -1) * CARD_FAN_ROTATION * (0.55 + fanSeedUnit * 0.45);
        // IL CENTRO DI PARTENZA è il centro della scena, cioè della viewport:
        // tutte le card partono impilate lì, e da lì ognuna raggiunge il proprio
        // slot. La traslazione è calcolata sullo slot corrente, così la mazzetta
        // resta al centro anche mentre lo strip è già in parte scorsso.
        const fanCenterX = stripMetrics.sceneWidth / 2;
        const fanDx = (1 - fanEased) * (fanCenterX - restCenterX);
        const fanScale = CARD_FAN_START_SCALE + (1 - CARD_FAN_START_SCALE) * fanEased;
        const fanRot = (1 - fanEased) * fanStartRot;
        // CON MOVIMENTO RIDOTTO: solo dissolvenza, niente ventaglio. Le card
        // appaiono già ai loro posti e si accendono: è la via che chiede la
        // specifica, e mantiene l'unico moto ammesso — l'opacità.
        const fanVisible = reducedMotion ? clamp01(birthProgress / 0.35) : fanEased;
        const fanDxUsed = reducedMotion ? 0 : fanDx;
        const fanScaleUsed = reducedMotion ? 1 : fanScale;
        const fanRotUsed = reducedMotion ? 0 : fanRot;
        // La card è visibile solo mentre le tocca: lungo il track esce a
        // sinistra, e nella salita/sblocco la scena sale fuori campo.
        const slotOnScreen = restCenterX - stripOffset;
        const onScreen = slotOnScreen + cardHalf >= 0 && slotOnScreen - cardHalf <= stripMetrics.sceneWidth;
        card.style.visibility = onScreen && riseRatio < 0.999 ? 'visible' : 'hidden';
        // LA SFUMATURA IN USCITA.
        //
        // Durante la corsa orizzontale le card che escono a sinistra non
        // spariscono di colpo al bordo: si spengono mentre lo attraversano. La
        // finestra è l'ultima CARD_EXIT_FADE_SPAN mezza card di schermo, e il
        // minimo non è 0 ma CARD_EXIT_FADE_MIN: la card che ha già superato il
        // bordo resta accennata invece di accendersi e spegnersi a intermittenza
        // davanti all'occhio. Il valore minimo esiste per quello, non per
        // risparmiare un canale alpha.
        //
        // È funzione del SOLO `stripOffset`: nessun orologio e nessuna memoria,
        // quindi riscorrere la corsa all'indietro riaccende ogni card
        // esattamente nel punto in cui si era spenta.
        const exitT = clamp01(slotOnScreen / Math.max(1, cardHalf * CARD_EXIT_FADE_SPAN));
        const exitFade = CARD_EXIT_FADE_MIN + (1 - CARD_EXIT_FADE_MIN) * exitT;
        // L'opacità finale è il PRODOTTO dei due fattori, non una media: finché
        // la card non è entrata non c'è niente da sfumare, e una volta entrata
        // non c'è più niente da accendere. Moltiplicare tiene le due condizioni
        // indipendenti — con una media, una card a metà ingresso che esce a
        // sinistra tornerebbe visibile per un istante.
        card.style.opacity = String(fanVisible * exitFade);
        // Il click è legato alla POSIZIONE e non alla curva di focus: ciò che
        // distingue una card cliccabile da una che ruberebbe i click alle
        // vicine è l'aver lasciato il bordo, non la nitidezza.
        card.style.pointerEvents = exitT > 0.02 ? 'auto' : 'none';
        // Il ventaglio è finito quando la card è al suo slot: da lì `willChange`
        // torna ad 'auto' e il browser libera il livello di composizione che il
        // moto si era tenuto. Scritto una volta per card, non ogni frame.
        const complete = fanT >= 1;
        if (landedRef.current[index] !== complete) {
          landedRef.current[index] = complete;
          card.style.willChange = complete ? 'auto' : 'transform';
        }
        // A `fanT = 1` traslazione e rotazione sono 0 e la scala è 1: la card è
        // esattamente nel suo slot, quindi si azzera lo stile e la trasformazione
        // sparisce senza discontinuità.
        card.style.transform = complete
          ? ''
          : `translate3d(${fanDxUsed.toFixed(2)}px, 0, 0) rotate(${fanRotUsed.toFixed(3)}deg) scale(${fanScaleUsed.toFixed(4)})`;
        // Telemetria in dev: lo stato di ventaglio di questa card in questo
        // frame, per le verifiche headless.
        trajTelemetry[index] = {
          fanT, fanDx: fanDxUsed, fanRot: fanRotUsed, fanScale: fanScaleUsed,
          opacity: fanVisible * exitFade, exitFade,
        };
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
          lo spacer assorbe la larghezza eccedente.

          Il padding laterale è `--page-gutter`, lo stesso token del marchio
          dell'header, della coppia geografica in alto a destra e della
          telemetria in basso a sinistra. Prima era un `md:px-[60px]` scritto a
          mano: le card partivano da un filo diverso da quello degli altri elementi
          della pagina, e in più il valore era fermo mentre il gutter cresce con
          la viewport. Leggendo il token, la prima card parte dalla stessa
          griglia di tutto il resto — che è anche il motivo per cui a fine track
          l'ultima card si ferma con lo stesso margine: `travel` in
          `measureSlots` è calcolato su questo stesso numero. */}
      <div
        className="relative z-10 flex-1 flex overflow-visible"
        style={{ paddingLeft: 'var(--page-gutter)', paddingRight: 'var(--page-gutter)' }}
      >
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
              className="works-card-shell shrink-0"
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
              {/* La card è un solo elemento ora: niente depth layer, niente disco
                  bokeh, niente blur layer. Esistevano per la planata — la card
                  che cresceva da un punto centrale diventando prima un disco
                  sfocato e poi nitida. Con l'ingresso da fuori bordo destro non
                  c'è più nessuna profondità da simulare: la card entra già nella
                  sua dimensione finale, e un disco bokeh al centro dello schermo
                  sarebbe proprio il difetto che si sta correggendo. Il wrapper
                  serve solo a fissare l'aspect 3:4 ereditato dalle card vere. */}
              <div className="relative h-full w-full">
                <ProjectCard
                  project={project}
                  index={index}
                  onOpen={() => onOpenProject(index)}
                />
              </div>
            </div>
          ))}
          {/* L'ULTIMA CARD: «+», uno slot vuoto.
              Non sta dentro `projects` perché NON è un progetto: non ha codice,
              anno, cliente, tag, kpi né brief, e inventarli per farlo entrare
              nello stesso array avrebbe finito per mostrare dati falsi in un
              elenco che legge davvero da Sanity. Renderizzata qui, dopo la mappa,
              eredita comunque tutto quello che conta: la larghezza (la stessa
              `flex`), il gap, e soprattutto l'ingresso da fuori bordo destro,
              perché anche lei riceve un ref in `cardRefs` e viene quindi
              animata dal render loop come le altre. */}
          <div
            ref={(element) => {
              cardRefs.current[projects.length] = element;
            }}
            data-card-root={projects.length}
            data-card-role="add"
            className="works-card-shell shrink-0"
            style={{
              flex: '0 0 var(--works-card-w)',
              minWidth: 0,
              opacity: 0,
              visibility: 'hidden',
              transformOrigin: '50% 50%',
              willChange: 'transform',
              // z-index 0: sta in fondo a tutte, e non per umiltà ma per
              // correttezza — è l'ultima della corsa, quindi è l'unica che non
              // ha nessuna card davanti da cui uscire.
              zIndex: 0,
            }}
          >
            <div className="relative h-full w-full">
              <AddProjectCard />
            </div>
          </div>
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

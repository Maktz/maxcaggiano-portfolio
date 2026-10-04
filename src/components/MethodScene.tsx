import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import TransmissionButton from './TransmissionButton';
import Reveal from './Reveal';
import {
  METHOD_CLOSING,
  METHOD_HEADLINE,
  METHOD_LABEL,
  METHOD_PHASES,
} from '@/data/method';
import { openAddProjectModal } from '@/lib/addProjectControl';
import { useSmoothScroll } from '@/providers/smoothScrollContext';
import { clamp01, phase, smoothstep } from '@/lib/scrollMath';
import { readSceneHeight, readSceneTopPx } from '@/lib/scrollScene';
import { reducedMotion } from '@/lib/motionPreference';
import { finePointer } from '@/lib/pointerCapability';
import { createRocketSprite, ROCKET_ASPECT } from '@/lib/stickerRockets';

// LA SEZIONE «IL MIO METODO».
//
// Quattro stazioni su un tracciato e un razzo che lo percorre. Il razzo non e'
// un'animazione a orologio: la sua posizione e' una FUNZIONE DELLO SCROLL della
// sezione, quindi la rotta e' coreografata — nessuna casualita', nessun reset — e
// il ritorno all'indietro ripercorre esattamente lo stesso cammino.
//
// IL RAZZO RIUSA LA SPRITE ESISTENTE: `createRocketSprite` rasterizza la stessa
// identica arte che disegna i razzi ambienti della nebulosa, e la appende qui
// come canvas. Non e' un svg nuovo, e' lo stesso disegno con un motore diverso,
// come il razzo scripted di `rocketManager`.
//
// La rotazione NON e' un valore scritto a mano: e' l'orientamento del tracciato
// MISURATO dal layout (orizzontale su desktop, verticale sotto `lg`). Con un
// angolo fisso, una delle due orientazioni avrebbe il razzo di traverso.

/** Altezza del razzo sulla rotta, in px. */
const ROCKET_HEIGHT_PX = 56;

/** Diametro del nodo di stazione, in px. */
const NODE_SIZE_PX = 10;

/** Quanta viewport di scroll il viaggio dura PRIMA del bordo superiore. */
const TRAVEL_LEAD_VH = 0.5;

/** Quanta dopo il bordo INFERIORE della sezione il viaggio e' finito. */
const TRAVEL_TAIL_VH = 0.5;

/**
 * Quanta interpolate il razzo verso la stazione puntata, a ogni frame.
 *
 * Non e' un tempo in secondi: e' una frazione della distanza che manca, quindi
 * la velocita' si smorza da sola avvicinandosi e il razzo non arriva mai
 * scattando. Un valore alto inseguirebbe il puntatore come un moscerino; uno
 * basso lo lascerebbe indietro di mezzo secondo a ogni spostamento.
 */
const ROCKET_FOLLOW = 0.14;

/**
 * Isteresi sul bordo fra due card, in px.
 *
 * Le card sono separate da un vuoto, e il vuoto ha una larghezza sua: senza
 * questa banda, passando da una card all'altra il razzo entrerebbe e uscirebbe
 * dalla stessa stazione a ogni frame di attraversamento e tremolerebbe sul
 * confine. Con la banda, una stazione NON corrente si considera toccata solo
 * quando il puntatore e' entrato per bene: la stazione corrente invece si
 * considera con il bordo pieno, altrimenti il razzo non uscirebbe mai da
 * quella su cui si trova e resterebbe incollato sotto al puntatore.
 */
const STATION_HYSTERESIS_PX = 18;

/** Sotto questa distanza il verso di marcia non viene ricalcolato. */
const FACING_DEADBAND_PX = 0.5;

interface Point {
  x: number;
  y: number;
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

interface MethodSceneProps {
  scrollY: MotionValue<number>;
}

export default function MethodScene({ scrollY }: MethodSceneProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const rocketRef = useRef<HTMLDivElement>(null);
  const rocketTiltRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  // I nodi misurati, in coordinate LOCALI del tracciato: sono la rotta del
  // razzo. Vengono riletti solo al cambio di layout, mai a ogni frame.
  const routeRef = useRef<Point[]>([]);
  // Quante stazioni sono accese. Un ref e non uno stato: cambia quattro volte in
  // tutta la sezione e non deve provocare un render di React.
  const litRef = useRef(0);
  // ── IL RAZZO COME SEGUE IL PUNTATORE ─────────────────────────────────────
  //
  // Le quattro memorie sotto sono lo stato del moto, e sono tutte REF e non
  // `useState` per lo stesso motivo di `litRef`: cambiano a ogni frame e non
  // devono provocare un render di React. Il puntatore viene letto e basta.
  //
  // Il puntatore vive in coordinate di PAGINA, non di tracciato: e' l'unica
  // forma che l'evento `pointermove` ci da'. Lo si riporta al tracciato nel
  // frame loop, sommando lo scroll — cosi' nessuna operazione qui dentro
  // provoca un reflow, che a ogni frame e per sette letture sarebbe il costo
  // piu' grosso che questa sezione si potrebbe permettere.
  const pointerRef = useRef({ pageX: 0, pageY: 0, seen: false });
  /** La stazione sotto il puntatore: l'unico obiettivo del razzo. */
  const targetRef = useRef(0);
  /** Dove il razzo e' ADESSO: la posizione inseguita, che arriva sempre tardi. */
  const rocketPosRef = useRef<Point>({ x: 0, y: 0 });
  /** +1 verso destra, -1 verso sinistra. Determina il verso di marcia. */
  const facingRef = useRef(1);
  // La posizione del tracciato in coordinate di PAGINA, e i rettangoli delle
  // card nelle coordinate del tracciato. Riletti solo al cambio di layout.
  const trackPageRef = useRef<{ left: number; top: number } | null>(null);
  const cardBoxesRef = useRef<Array<{ x0: number; y0: number; x1: number; y1: number }>>([]);
  // L'orientamento del tracciato e l'ultimo angolo scritto: il tracciato puo'
  // essere orizzontale o verticale, e nel primo caso il razzo ha anche un verso.
  const horizontalRef = useRef(true);
  const tiltRef = useRef(0);
  /** Il razzo e' gia' stato posizionato almeno una volta. */
  const placedRef = useRef(false);
  const { subscribeFrame } = useSmoothScroll();

  // ACCENDERE LE CARD. Il valore non torna mai indietro: la stazione illuminata
  // resta illuminata per tutta la visita alla sezione. Costa quattro
  // `classList.toggle` e una sola esecuzione per cambiamento, quindi il "latch"
  // non ha prezzo da pagare.
  //
  // `useCallback` con ref vuote: la funzione legge solo ref e constanti del
  // modulo, quindi la sua identità non cambia mai e gli effetti che la
  // dipendono non si ri-aprono a ogni render. Senza, il `useEffect` del layout
  // si ripeterebbe a ogni render e rimisurerebbe la rotta per niente.
  const lightUp = useCallback((lit: number) => {
    if (lit <= litRef.current) return;
    litRef.current = lit;
    cardRefs.current.forEach((card, index) => {
      card?.classList.toggle('is-lit', index < lit);
    });
  }, []);

  // IL RAZZO. `translate` e non `left/top`: quelle sono proprieta' di layout, e
  // scriverle a ogni frame farebbe un reflow per frame. La traslazione parte dal
  // punto del tracciato MENO meta' razzo, altrimenti la coda passerebbe sulla
  // stazione invece della testa.
  const placeRocket = useCallback((point: Point) => {
    const rocket = rocketRef.current;
    if (!rocket) return;
    const x = point.x - ROCKET_HEIGHT_PX / ROCKET_ASPECT / 2;
    const y = point.y - ROCKET_HEIGHT_PX / 2;
    rocket.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
  }, []);

  // LA MISURA. I centri dei nodi danno tre cose: la rotta, l'orientamento del
  // tracciato e la posizione della linea tratteggiata. Tutte lette dal DOM, nessun
  // numero scritto a mano: sotto `lg` la linea diventa verticale e senza misurare
  // il layout resterebbe un tratteggio che non tocca le stazioni.
  // Stessa ragione di `lightUp` per il `useCallback`: `measure` dipende solo da
  // ref e costanti, quindi può avere una identità stabile ed essere elencata
  // nelle dipendenze senza riaprire l'effetto a ogni render.
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const trackRect = track.getBoundingClientRect();
    const points: Point[] = [];
    for (const node of nodeRefs.current) {
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      points.push({
        x: rect.left - trackRect.left + rect.width / 2,
        y: rect.top - trackRect.top + rect.height / 2,
      });
    }
    if (points.length < 2) return;
    routeRef.current = points;

    const first = points[0];
    const last = points[points.length - 1];
    // L'orientamento non e' un breakpoint: e' la direzione misurata fra il primo
    // e l'ultimo nodo. Se il layout cambiasse senza che cambi la viewport, il
    // ramo giusto resterebbe quello giusto.
    const horizontal = Math.abs(last.x - first.x) >= Math.abs(last.y - first.y);
    horizontalRef.current = horizontal;

    // Dove STA il tracciato, in coordinate di pagina: e' il ponte fra il
    // puntatore, che arriva in coordinate di viewport, e i nodi, che stanno in
    // coordinate di tracciato. Senza questo, per sapere su quale card e' il
    // puntatore il frame loop dovrebbe misurare il tracciato a ogni frame — e
    // una lettura di layout per frame e' il costo che questo loop ha sempre
    // evitato. Il tracciato non si muove da solo (il razzo si muove DENTRO),
    // quindi questa misura resta valida finche' il layout non cambia, ed e'
    // esattamente quando viene riletta.
    trackPageRef.current = {
      left: trackRect.left + window.scrollX,
      top: trackRect.top + window.scrollY,
    };

    // I rettangoli delle card nelle stesse coordinate del tracciato: sono le
    // zone che il puntatore puo' occupare. Sono i bordi della CARD e non del
    // nodo, perche' e' la card che l'utente indica col mouse, e il nodo e' una
    // macchia di dieci pixel sopra di lei.
    const boxes = cardRefs.current.map((card) => {
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return {
        x0: r.left - trackRect.left,
        y0: r.top - trackRect.top,
        x1: r.right - trackRect.left,
        y1: r.bottom - trackRect.top,
      };
    });
    cardBoxesRef.current = boxes.filter((b): b is NonNullable<typeof b> => b !== null);

    const line = lineRef.current;
    if (line) {
      line.style.left = `${first.x}px`;
      line.style.top = `${first.y}px`;
      // La linea parte e finisce CENTRATA sui nodi: senza i due meta' il
      // tratteggio si fermerebbe sul bordo del primo nodo e l'ultimo resterebbe
      // scoperto, cioe' la stazione finale sembrerebbe fuori rotta.
      line.style.width = horizontal ? `${Math.max(0, last.x - first.x)}px` : '0px';
      line.style.height = horizontal ? '0px' : `${Math.max(0, last.y - first.y)}px`;
      line.style.borderTopWidth = horizontal ? '1px' : '0px';
      line.style.borderLeftWidth = horizontal ? '0px' : '1px';
    }

    // L'angolo si scrive qui e non nel loop: nel loop cambierebbe a ogni frame
    // insieme alla posizione, e la transizione su `rotate` — che serve a coprire
    // il cambio di orientamento — comincerebbe a inseguire il frame.
    const tilt = rocketTiltRef.current;
    if (tilt) tilt.style.rotate = `${horizontal ? 90 : 0}deg`;
    // L'ultimo angolo scritto: nel ramo del puntatore l'angolo cambia a meta'
    // viaggio, e senza questo segno l'assegnazione partirebbe da un valore
    // sbagliato al primo frame e il razzo si raddrizzerebbe con un salto.
    tiltRef.current = horizontal ? 90 : 0;
    facingRef.current = 1;

    const rocket = rocketRef.current;
    if (rocket) {
      rocket.style.width = `${ROCKET_HEIGHT_PX / ROCKET_ASPECT}px`;
      rocket.style.height = `${ROCKET_HEIGHT_PX}px`;
    }

    // A movimento ridotto il viaggio non esiste: il razzo e' gia' arrivato e le
    // quattro stazioni sono accese. La sezione si legge intera e immobile.
    if (reducedMotion) {
      placeRocket(last);
      lightUp(points.length);
    }
  }, [placeRocket, lightUp]);

  useLayoutEffect(() => {
    measure();
    // I font arrivano dopo il primo paint e cambiano l'altezza delle card,
    // quindi i nodi si spostano: senza questo richiamo la rotta sarebbe quella
    // del fallback e il razzo atterrerebbe fuori dalla quarta stazione.
    const settle = window.requestAnimationFrame(() => window.requestAnimationFrame(measure));
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(measure).catch(() => undefined);
    const observer =
      typeof ResizeObserver !== 'undefined' && trackRef.current
        ? new ResizeObserver(measure)
        : null;
    if (trackRef.current) observer?.observe(trackRef.current);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(settle);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  // LA SPRITE. Lo stesso disegno dei razzi ambienti, appendo come canvas. Se il
  // contesto 2d non esistesse il nodo resterebbe vuoto e la rotta sarebbe
  // comunque leggibile: la sprite e' un ornamento, il tracciato no.
  useEffect(() => {
    const sprite = createRocketSprite('yellow');
    const holder = rocketTiltRef.current;
    if (!sprite || !holder) return;
    holder.appendChild(sprite);
    sprite.style.width = '100%';
    sprite.style.height = '100%';
    return () => {
      sprite.remove();
    };
  }, []);

  // IL PUNTATORE. Un solo ascoltatore su `window`, che scrive TRE numeri e non
  // fa nient'altro: nessun render, nessuna misura, nessun accesso al DOM. Il
  // lavoro vero — capire su quale card e' e muovere il razzo — avviene nel frame
  // loop, che e' gia' in funzione: cosi' il moto resta legato al clock della
  // pagina e non a quanti eventi il mouse manda.
  //
  // `pointermove` e non `mousemove`: il primo arriva anche per tocco e penna.
  // Sotto `finePointer` questa sezione non legge comunque nulla, ma l'ascolto
  // senza filtro costerebbe una lettura per frame su un telefono.
  useEffect(() => {
    if (!finePointer) return;
    const onMove = (event: PointerEvent) => {
      const p = pointerRef.current;
      // `clientX` e' gia' relativo alla viewport: per passare alle coordinate di
      // pagina basta sommare lo scroll corrente.
      p.pageX = event.clientX + window.scrollX;
      p.pageY = event.clientY + window.scrollY;
      p.seen = true;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // IL LOOP. Un solo abbonamento al frame condiviso del provider: la posizione
  // del razzo e l'accensione delle card leggono lo stesso `scrollY` che muove
  // tutto il resto della pagina, quindi non possono essere fuori passo con le
  // Works o con la camera della nebulosa.
  useEffect(
    () =>
      subscribeFrame(() => {
        const points = routeRef.current;
        if (points.length < 2) return;
        const rocket = rocketRef.current;
        // Sotto `prefers-reduced-motion` il viaggio NON esiste: `measure` ha
        // gia' messo il razzo all'ultima stazione e acceso le quattro card, e il
        // commento qui sotto lo dichiarava — ma il ramo esisteva solo per
        // l'opacita'. Il resto del loop continuava a interpolare la rotta e a
        // scrivere il transform a ogni frame, per un nodo invisibile: il moto che
        // l'utente aveva chiesto di non vedere c'era, solo che non si vedeva.
        // (Misurato: sotto reduced-motion il razzo passava da tre posizioni
        // distinte muovendosi col scroll invece di restare fermo all'arrivo.)
        if (reducedMotion) {
          if (rocket) rocket.style.opacity = '0';
          return;
        }
        if (rocket) rocket.style.opacity = '1';

        const top = readSceneTopPx('method');
        const height = readSceneHeight('method');
        if (height <= 0) return;

        // ── IL RAMO DEL PUNTATORE ─────────────────────────────────────────
        //
        // Sul desktop il razzo non e' piu' funzione dello scroll ma di DOVE sta
        // il puntatore, e i due difetti che avevamo sono la stessa cosa vista da
        // due lati: il viaggio finiva quando la sezione era gia' scorsa per
        // meta', e la sezione non entrava in una viewport. Se il razzo segue il
        // mouse l'arrivo si vede perche' l'utente e' li' a guardarlo; e per
        // guardare le card serve che ci stiano, che e' l'altro capo.
        //
        // Il ramo dello scroll qui sotto non e' una via di riserva provvisoria:
        // e' la strada del tocco, dove non esiste puntatore e il viaggio col
        // scroll e' l'unico racconto che ha senso.
        if (finePointer) {
          const track = trackPageRef.current;
          const boxes = cardBoxesRef.current;
          if (!track || boxes.length === 0) return;

          const pointer = pointerRef.current;
          const current = targetRef.current;
          const localX = pointer.pageX - track.left;
          const localY = pointer.pageY - track.top;
          // La stazione sotto il puntatore. Il -1 non e' un errore: vuol dire che
          // il puntatore e' nel vuoto fra due card o fuori dalla sezione, e in
          // quel caso il razzo tiene la sua ultima destinazione invece di
          // tornare indietro — altrimenti oscillerebbe sul bordo.
          let hit = -1;
          for (let i = 0; i < boxes.length; i += 1) {
            const b = boxes[i];
            const m = i === current ? 0 : STATION_HYSTERESIS_PX;
            if (
              localX >= b.x0 + m && localX <= b.x1 - m &&
              localY >= b.y0 + m && localY <= b.y1 - m
            ) {
              hit = i;
              break;
            }
          }
          if (hit >= 0) targetRef.current = hit;

          const station = points[targetRef.current];
          const pos = rocketPosRef.current;
          if (!placedRef.current) {
            pos.x = station.x;
            pos.y = station.y;
            placedRef.current = true;
          }
          // L'ISEGUIMENTO e' una frazione della distanza che manca, non uno
          // spostamento fisso: il razzo rallenta da solo e arrivando non
          // scatta, e non sborda e torna indietro.
          pos.x += (station.x - pos.x) * ROCKET_FOLLOW;
          pos.y += (station.y - pos.y) * ROCKET_FOLLOW;

          // IL VERSO. Il razzo guarda dove va: se la stazione e' a sinistra si
          // mette di faccia. Sotto una soglia il segno non si ricalcola, perche'
          // a meta' strada la distanza e' gia' minima e oscillerebbe.
          const dx = station.x - pos.x;
          if (Math.abs(dx) > FACING_DEADBAND_PX) facingRef.current = dx > 0 ? 1 : -1;
          const angle = horizontalRef.current ? (facingRef.current > 0 ? 90 : -90) : 0;
          if (angle !== tiltRef.current) {
            tiltRef.current = angle;
            const tilt = rocketTiltRef.current;
            if (tilt) tilt.style.rotate = `${angle}deg`;
          }

          placeRocket(pos);
          // L'ACCENSIONE e' quella di sempre — il latch che non torna mai
          // indietro — ma alimentata dalla stazione puntata invece che dal
          // progresso dello scroll. Passando dalla quarta alla prima restano
          // accese tutte: una volta percorso, il viaggio non si disfa.
          lightUp(targetRef.current + 1);
          return;
        }

        const start = top - window.innerHeight * TRAVEL_LEAD_VH;
        const end = top + height - window.innerHeight * TRAVEL_TAIL_VH;
        // `smoothstep` alle due estremita', come l'ingresso delle sezioni: il
        // razzo parte e atterra piano invece di scattare fuori e dentro.
        const travel = smoothstep(phase(scrollY.get(), start, end));

        // Il tracciato ha N-1 tratti: moltiplicare per `N-1` fa arrivare
        // `travel = 1` sulla QUARTA stazione, non sul prolungamento della linea.
        const stops = points.length - 1;
        const position = clamp01(travel) * stops;
        const index = Math.min(stops - 1, Math.floor(position));
        const t = position - index;
        // La posizione inseguita viene riallineata a quella scroll-driven: se il
        // ramo del puntatore si disattiva (resize, cambio di capability) il razzo
        // riparte senza saltare dal punto in cui si trova a quello calcolato.
        const point = {
          x: lerp(points[index].x, points[index + 1].x, t),
          y: lerp(points[index].y, points[index + 1].y, t),
        };
        rocketPosRef.current = point;
        placedRef.current = true;
        placeRocket(point);

        // L'accensione e' la stessa rotta arrotondata: la card N si accende
        // quando il razzo ha RAGGIUNTO il suo nodo, non quando gli e' passato
        // vicino. Il `+1` e' l'unico posto in cui una stazione risulta accesa.
        lightUp(Math.min(points.length, Math.round(travel * stops) + 1));
      }),
    [subscribeFrame, scrollY, placeRocket, lightUp],
  );

  // IL CONTENITORE. `lg:max-w-[1560px]` e non il `max-w-6xl` delle altre sezioni:
  // qui quattro card stanno in fila, e in 1152px ciascuna veniva larga 250px — il
  // 64% della card Works, che a 1440px larga 389px. Lo squilibrio non era nel
  // disegno della card ma nello spazio concesso: stringere quattro card in un
  // contenitore pensato per una le faceva sembrare piu' piccole di quanto fossero.
  // Con 1560px le quattro arrivano a ~307px, che e' il 79% della Works: il massimo
  // possibile a 1440px, dove il gutter di pagina lascia 1299px utili.
  //
  // `py-14` al posto di `py-20 md:py-28`: la sezione era 1113px alta in una
  // viewport da 900 e quindi non entrava mai. I 224px di padding erano il secondo
  // pezzo piu' grosso di quella eccedenza, dopo l'headline.
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--page-gutter)] py-14 lg:max-w-[1560px]">
      <div className="flex flex-col gap-5">
        <Reveal scrollY={scrollY} scene="method" index={0}>
          <span className="font-mono text-[10px] tracking-widest text-swiss-pink/70">
            {METHOD_LABEL}
          </span>
        </Reveal>
        <Reveal scrollY={scrollY} scene="method" index={1}>
          {/* `max-w-[26ch]`: a `16ch` e con un font da 70px il titolo andava su
            cinque righe e da solo occupava 238px, un quarto della viewport.
            Allargato sta su due righe (~130px) e la sezione rientra. */}
          <h2 className="max-w-[26ch] font-display font-extrabold leading-[0.92] tracking-tight text-accent [font-size:clamp(1.9rem,5.6vw,3.8rem)]">
            {METHOD_HEADLINE}
          </h2>
        </Reveal>
      </div>

      {/* IL TRACCIATO. `relative` e' cio' che rende locale il sistema di
          coordinate del razzo e della linea: senza, le loro posizioni sarebbero
          relative alla sezione e il razzo inseguirebbe la pagina invece della
          stazione. */}
      <div ref={trackRef} className="relative">
        {/* La linea tratteggiata: posizione e orientamento sono scritti dalla
            misura, non dal markup. Tratteggiata perche' una rotta non e' un
            riquadro — la stessa grammatica del bordo della card «+». */}
        <div
          ref={lineRef}
          aria-hidden="true"
          className="pointer-events-none absolute border-dashed border-swiss-pink/35"
        />

        {/* `lg:gap-7` (28px) invece di `lg:gap-6`: e' il gap della Works, che e' 28.8px.
            Le due sezioni mostrano card affiancate e il divario si vedeva. */}
        <div className="grid gap-8 lg:grid-cols-4 lg:gap-7">
          {METHOD_PHASES.map((step, index) => (
            <div key={step.code} className="relative flex flex-col gap-3 lg:pt-8">
              {/* IL NODO: il punto che il razzo attraversa e su cui la linea
                  passa. Sotto `lg` sta a sinistra (linea verticale), da `lg` in
                  alto centrato (linea orizzontale). */}
              <span
                ref={(element) => {
                  nodeRefs.current[index] = element;
                }}
                aria-hidden="true"
                className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-canvas lg:left-1/2"
                style={{ height: NODE_SIZE_PX, width: NODE_SIZE_PX }}
              />

              <Reveal scrollY={scrollY} scene="method" index={index + 2}>
                <div
                  ref={(element) => {
                    cardRefs.current[index] = element;
                  }}
                  className="method-card grid-wireframe flex h-full flex-col gap-3 bg-dark-green p-5"
                >
                  <span className="font-mono text-[9px] tracking-widest text-swiss-pink/70">
                    [FASE {step.code} / 04]
                  </span>
                  <span className="font-mono text-[9px] tracking-widest text-accent/80">
                    {step.name}
                  </span>
                  <h3 className="font-display font-extrabold leading-[0.95] tracking-tight text-accent [font-size:clamp(1.3rem,2.5vw,1.85rem)]">
                    {step.title}
                  </h3>
                  <p className="font-mono text-[11px] leading-[1.65] text-swiss-pink md:text-[12px]">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            </div>
          ))}
        </div>

        {/* IL RAZZO. Ruota il nodo INTERNO: se a ruotare fosse quello esterno, la
            rotazione si sommerebbe alla traslazione e l'angolo dipenderebbe dalla
            posizione invece che dalla direzione del tracciato. */}
        <div
          ref={rocketRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 opacity-0"
        >
          <div ref={rocketTiltRef} className="h-full w-full" />
        </div>
      </div>

      {/* LA CHIUSURA. Il bottone apre lo stesso modal della card «+» e gli passa
          il proprio rettangolo come `origin`: senza, il pannello comparirebbe al
          centro dello schermo e il legame fra la cosa premuta e il dialog che si
          apre andrebbe perso — che e' il motivo per cui la card «+» fa lo stesso. */}
      <div className="flex flex-col items-center gap-4 pt-2 text-center">
        <Reveal scrollY={scrollY} scene="method" index={6}>
          <span className="font-mono text-[11px] tracking-widest text-swiss-pink">
            {METHOD_CLOSING}
          </span>
        </Reveal>
        <Reveal scrollY={scrollY} scene="method" index={7}>
          <TransmissionButton
            label="AVVIA UN PROGETTO"
            onClick={(event) =>
              // `currentTarget` e' il bottone premuto, non il testo dentro: e' il
              // bottone che si espande, quindi e' il suo rettangolo l'origine.
              openAddProjectModal(event.currentTarget.getBoundingClientRect())
            }
            className="max-sm:gap-2 max-sm:px-5 max-sm:py-3 max-sm:text-[11px]"
          />
        </Reveal>
      </div>
    </div>
  );
}

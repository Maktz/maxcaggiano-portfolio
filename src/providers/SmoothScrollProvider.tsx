import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Lenis from 'lenis';
import Snap from 'lenis/snap';
import { motionValue } from 'framer-motion';
import 'lenis/dist/lenis.css';
import { ATTRITION_RADIUS_PX, SCROLL_GAIN } from '@/lib/scrollMath';
import { registerLenis } from '@/lib/scrollLock';
import { SmoothScrollContext, type SmoothScrollContextValue } from './smoothScrollContext';

// Coda dello scroll, l'unico parametro che lo governa.
//
// Nel motore di Lenis vale `if (duration && easing)` PRIMA del ramo lerp: passare
// entrambi fa vincere `duration`, e lo scroll diventava un'eco TEMPORALE da 1.2s
// riavviata a ogni evento di rotellina, con la pagina che rincorreva sempre il
// dito. Il commento precedente dichiarava il contrario di cio' che il codice
// faceva. Ora `duration` non viene passato: il moto e' la coda esponenziale.
//
// 0.075 era il valore di planetono.space, verificato leggendo il suo bundle:
// `new Lenis({ lerp: .075 })`, senza duration. Poi e' stato portato a 0.05, e
// infine a 0.04.
//
// I tempi sotto sono MISURATI, non calcolati. La tabella precedente dichiarava
// 0.77s al 90% e 1.00s al 95%, ma la coda reale -- Chrome headless, 1440x813,
// cinque colpi di rotellina da 120px, partendo a 1000px da uno stop cosi' che il
// magnete restasse disarmato -- era 1.24s e 1.48s: la tabella sottostimava la
// coda del 40%. I valori qui sotto vengono da quella misura e vanno rimisurati
// ogni volta che LERP viene toccato.
//
//   90% del percorso     1.45s -> 1.57s
//   95%                  1.74s -> 1.91s
//   poso (0.05px/frame)  3.37s -> 3.77s
//
// Il "poso" e' il numero piu' grande di questa coda ed e' voluto: e' la
// "carezza", cioe' il foglio che arriva e si posa invece di fermarsi di scatto.
// Non puo' superare la destinazione, per costruzione dell'esponenziale:
// l'overshoot che produceva il "torna indietro come la molla" resta escluso
// per costruzione e non per taratura.
//
// Il rovescio della medaglia, detto per onesta': una coda piu' lunga tiene il
// foglio in moto piu' a lungo, quindi ritarda anche l'arrivo degli stop di
// preloader e hero, dove il ritratto e l'h2 devono poter essere letti. E
// prolunga la corsa della Works in TEMPO, non in velocita' laterale: li' la
// velocita' della striscia resta un rapporto costante fra scroll e spazio.
const LERP = 0.035;

// Effetto magnetico agli stop. 'proximity' (e non 'mandatory') è la differenza
// chiave: il magnetismo agisce solo entro la soglia, mentre 'mandatory' è lo
// snap rigido che prima spezzava l'inerzia.
//
// La soglia è quella della calamita (ATTRITION_RADIUS_PX), non un numero
// dedicato: uno stop deve comportarsi allo stesso modo nella fascia calamitata e
// in quella libera, altrimenti il passaggio si sente come un cambio di texture.
//
// La soglia è stata abbassata a 90px ipotizzando che nella Works il magnete
// riportasse indietro chi si ferma durante la nascita, e poi RIPRISTINATA:
// l'ipotesi si reggeva solo sulla geometria (la banda di 240px copriva metà
// della nascita di 476px) e non si è mai riprodotta. Misurato con soglia 240
// com'era prima, con rotellina vera: scorrere fino a fine corsa non dà alcun
// salto indietro, e fermarsi al 10%, 30% e 60% della nascita non dà alcun
// richiamo — la deriva in avanti che si misura è la coda di Lenis, cioè il
// comportamento voluto. Restare a 240 evita di indebolire lo stop della Works
// per un difetto che non esiste.
const SNAP_DISTANCE_PX = ATTRITION_RADIUS_PX;
// Il richiamo usa la coda esponenziale dell'istanza (lerp 0.04), non un moto
// temporale: `duration` non viene passato, quindi nel motore vale il ramo
// `damp`. Con `duration` + `easing` la precedenza sarebbe di `duration` (vedi
// la nota su LERP) e il richiamo avrebbe un carattere diverso dallo scroll che
// lo precede, che è esattamente il difetto segnalato.
// Il debounce deve essere CORTO rispetto alla coda (~3.8s al poso): lo snap
// valuta la distanza dal bersaglio sul valore corrente, e con un debounce lungo
// la pagina è già uscita dalla banda magnetica quando la valutazione arriva.
// Per questo è legato a LERP per RAPPORTO e non per un numero assoluto: la
// coda si allunga a ogni abbassamento di lerp (posa misurata: 2.79s a 0.05,
// 3.37s a 0.04, 3.77s a 0.035) e un debounce invariato indebolirebbe lo snap
// della fascia libera. 225 × (0.04/0.035) = 257.
const SNAP_DEBOUNCE_MS = 257;

export default function SmoothScrollProvider({ children }: { children: ReactNode }) {
  // L'istanza nasce durante il render (useState initializer) e non dentro un
  // effetto: gli effetti dei figli girano PRIMA di quelli del padre, quindi se
  // Lenis fosse creato nell'effetto del provider i consumer (canvas incluso)
  // lo troverebbero null al primo montaggio.
  //
  // Viene anche mantenuta viva per tutta la sessione invece di essere distrutta
  // nel cleanup: con StrictMode l'effecto viene smontato e rimontato, e
  // un destroy + ricreazione lascerebbe i consumer agganciati a un'istanza
  // diversa da quella in uso. La sola cosa smontata è il RAF, che è privato.
  // Ripristino scroll disattivato: al refresh il browser riporta a metra pagina e
  // il preloader (scroll 0) non verrebbe mai mostrato. Si riparte sempre da capo.
  if (typeof history !== "undefined") history.scrollRestoration = "manual";

  const [lenis] = useState(() => new Lenis({
    // autoRaf disattivato: il RAF è gestito qui, così canvas e Lenis condividono
    // lo stesso frame e la MotionValue è aggiornata prima del disegno.
    autoRaf: false,
    // Solo `lerp`: vedi la nota su LERP. Passare anche `duration` farebbe
    // vincere il ramo temporale del motore e la coda morbida andrebbe persa.
    lerp: LERP,
    // Guadagno sotto 1: ogni gesto vale 0.85 di quanto valeva. E' la leva del
    // "feedback", cioe' di quanti pixel di pagina si percorre per un colpo. Va
    // letto da scrollMath perche' il motore applica il moltiplicatore PRIMA di
    // emettere `virtual-scroll`: senza la fonte unica, abbassarlo renderebbe
    // silenziosamente piu' rigido il pavimento di gesto della calamita.
    wheelMultiplier: SCROLL_GAIN,
    smoothWheel: true,
    // Il touch resta nativo: syncTouch attivo rovinerebbe i gesti su mobile.
    syncTouch: false,
    autoResize: true,
    anchors: false,
  }));

  // L'istanza viene pubblicata SUBITO, durante il render e non in un effetto:
  // il blocco dello scroll parte al mount di App, che è un figlio e quindi ha
  // già eseguito i propri effetti quando il padre li esegue. Registrandola
  // dentro l'effetto qui, `lockScroll()` troverebbe `null` e bloccherebbe solo
  // l'overflow nativo, lasciando Lenis libero di muovere la pagina al primo
  // colpo di rotella.
  registerLenis(lenis);

  // Solo in sviluppo: espone l'istanza sulla finestra così le verifiche
  // headless (CDP) possono pilotare lo scroll in modo deterministico. In
  // produzione il ramo sparisce e la build non contiene l'assegnazione.
  if (import.meta.env.DEV) {
    (window as unknown as { __lenis?: Lenis }).__lenis = lenis;
  }

  const scrollY = useMemo(() => motionValue(lenis.scroll), [lenis]);
  // Non esiste un progress globale: ogni finestra e' ancorata alla sezione che
  // governa (heroTop, worksTop, i tratti della Works in px). Un progress
  // sull'intero documento legava ogni sogola alla lunghezza della pagina, che
  // cambia con la Works: e' la ragione per cui l'handoff finiva dopo lo stop
  // magnetico dell'hero.
  // I callback del frame vivono in una ref: il provider non deve ricreare il
  // contesto a ogni render, altrimenti ogni consumer si risoscriverbe.
  const frameCallbacksRef = useRef(new Set<(time: number) => void>());
  // Rifiuta allo stesso posto: il controller calamitato sospende lo Snap
  // mentre la navigazione è "a fermo" e lo riattiva dopo l'esplosione.
  const snapRef = useRef<Snap | null>(null);
  // Il reset iniziale dello scroll e' una volta sola per istanza Lenis: vedi
  // la nota nell'effetto qui sotto.
  const didResetScroll = useRef(false);

  useEffect(() => {
    // Reset esplicito a 0: senza questo, se il browser ha già riportato il
    // documento a metra pagina prima che Lenis si inizializzasse, l istanza
    // partirebbe da li e il preloader (scroll 0) non verrebbe mai visto.
    // Reset esplicito a 0, una volta sola per istanza. Senza questo, se il
    // browser ha gia' riportato il documento a meta' pagina prima che Lenis
    // si inizializzasse, l'istanza partirebbe da li' e il preloader (scroll 0)
    // non verrebbe mai visto.
    //
    // Il flag serve perche' in StrictMode questo effetto gira due volte, e la
    // seconda trova il documento gia' posizionato: senza flag il rimontaggio
    // rimetteva a zero anche una posizione LEGITTIMA, come quella di ?skip,
    // che porta l'utente diretti sulla prima pagina. Il flag distingue
    // "l'utente ha scrollato per conto suo" (da azzerare) da "qualcuno ha gia'
    // posizionato la pagina di proposito" (da lasciare stare).
    if (!didResetScroll.current && window.scrollY !== 0) {
      lenis.scrollTo(0, { immediate: true });
    }
    didResetScroll.current = true;

    const publish = () => {
      scrollY.set(lenis.scroll);
    };

    const unsubscribeScroll = lenis.on('scroll', publish);
    // L'istanza viene creata nel useState initializer, quindi PRIMA che React
    // committi il DOM: al quel momento il documento non e' ancora impaginato e
    // il limite di scroll di Lenis e' sbagliato (0 o negativo). Il primo publish
    // legge quindi un progress corrotto e le scene partono gia' oltre la
    // finestra di handoff (il preloader risulta invisibile a scroll 0).
    // resize() ril misura sul DOM reale, e un secondo publish sul frame
    // successivo cattura anche il layout dei font.
    lenis.resize();
    publish();
    const settleId = window.requestAnimationFrame(() => {
      lenis.resize();
      publish();
    });

    // Set letto una volta sola: il cleanup non lo svuota (i consumer si
    // disiscrivono da soli), quindi non serve nemmeno la copia locale.
    const frameCallbacks = frameCallbacksRef.current;

    let frameId = 0;
    const frame = (time: number) => {
      frameId = window.requestAnimationFrame(frame);
      // Lenis avanza PRIMA dei consumer: nel frame corrente il canvas vede già
      // la posizione fluida, non quella del frame precedente.
      lenis.raf(time);
      frameCallbacks.forEach((callback) => callback(time));
    };
    frameId = window.requestAnimationFrame(frame);

    return () => {
      // I consumer si disiscrivono da soli nel proprio cleanup: qui si cancella
      // solo il RAF. Svuotare il set dal provider sarebbe fragile: l'ordine dei
      // cleanup in StrictMode potrebbe desregistrare i consumer già montati.
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(settleId);
      unsubscribeScroll();
    };
  }, [lenis, scrollY]);

  // Effetto magnetico: uno stop per sezione, agganciato dalla cima dell'elemento.
  // addElements misura i rect e li rivalida al resize, quindi le stop restano
  // corrette anche cambiando viewport o contenuto.
  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('main > section[data-scene]'),
    );
    // Solo le sezioni DOPO la nebulosa. La nebulosa è un percorso continuo e le
    // sezioni a monte sono già governate dalla calamita: registrarle qui
    // ricreerebbe proprio il richiamo a 1800 che è stato eliminato, e
    // dipenderebbe solo dalla coincidenza che la sua banda di prossimità cade
    // sotto il confine dell'esplosione.
    const nebulaIndex = sections.findIndex(
      (section) => section.dataset.scene === 'nebula',
    );
    const snapSections = nebulaIndex === -1
      ? sections
      : sections.slice(nebulaIndex + 1);
    if (snapSections.length === 0) return;

    // La Works porta dei marcatori data-snap: sono quelli i suoi veri punti di
    // aggancio — agganciare il bordo della sezione darebbe un solo richiamo a
    // inizio Works e nessuno a fine corsa, dove le card vanno lette. works-raced
    // è posizionato in PX dalla ProjectsScene, che scrive l'altezza della
    // sezione e i due confini di fase: leggendo gli stessi numeri della corsa i
    // due non possono divergere per costruzione.
    const anchors = Array.from(
      document.querySelectorAll<HTMLElement>('[data-snap]'),
    );
    // Ogni sezione che NON ha un marker aggancia dal proprio bordo superiore,
    // come prima. Serve a chi aggiunge una sezione fra Works e Let's Build: con
    // il vecchio ternario (solo anchors se presenti) la nuova sezione non
    // avrebbe nessuno stop magnetico, e il comportamento dipenderebbe dal
    // fatto che la Works ne abbia. Le sezioni che hanno un marker restano
    // agganciate ai marker: la Works non cambia nulla.
    const anchoredSections = new Set(
      anchors.map((anchor) => anchor.closest('[data-scene]')),
    );
    const snapTargets = [
      ...anchors,
      ...snapSections.filter((section) => !anchoredSections.has(section)),
    ];

    const snap = new Snap(lenis, {
      type: 'proximity',
      // Nessuna `duration`: vedi la nota su SNAP_DISTANCE_PX. Senza duration il
      // richiamo eredita la coda dell'istanza e si posa come lo scroll.
      distanceThreshold: SNAP_DISTANCE_PX,
      debounce: SNAP_DEBOUNCE_MS,
    });
    const removeElements = snap.addElements(snapTargets, { align: 'start' });
    snapRef.current = snap;

    return () => {
      snapRef.current = null;
      removeElements();
      snap.destroy();
    };
  }, [lenis]);

  const value = useMemo<SmoothScrollContextValue>(() => ({
    lenis,
    scrollY,
    getSnap: () => snapRef.current,
    subscribeFrame: (callback) => {
      frameCallbacksRef.current.add(callback);
      return () => {
        frameCallbacksRef.current.delete(callback);
      };
    },
  }), [lenis, scrollY]);

  return (
    <SmoothScrollContext.Provider value={value}>
      {children}
    </SmoothScrollContext.Provider>
  );
}

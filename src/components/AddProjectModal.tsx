import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import ContactForm from './ContactForm';
import { reducedMotion } from '@/lib/motionPreference';
import { lockScroll, unlockScroll } from '@/lib/scrollLock';

interface AddProjectModalProps {
  onClose: () => void;
  /**
   * Da dove parte l'espansione: il rettangolo della card «+» al momento del
   * click. `null` apre il pannello già centrato, senza animazione di posizione.
   */
  origin: DOMRect | null;
}

// Il FLIP dura 400ms. Il limite del requisito è 350–450ms e il valore è al
// centro: sotto i 350ms l'espansione non si legge come espansione, sopra i 450ms
// il dialog sembra esitare prima di aprirsi.
const FLIP_DURATION = 0.4;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// IL MODAL «AGGIUNGI IL TUO PROGETTO».
//
// Apre dalla card «+» della Works e chiede esattamente le stesse cose della
// sezione "Let's build": lo stesso form, montato dallo stesso `ContactForm`.
// Qui ci sono solo il contorno e il comportamento da dialog — contenitore,
// intestazione, chiusura, blocco dello scroll, trappola del focus — perché il
// contenuto non deve esistere in due versioni.
//
// IL FLIP. Il pannello non appare al centro: parte dal rettangolo della card e
// ci arriva. Si fa con la tecnica FLIP (First, Last, Invert, Play): il pannello
// viene posizionato al suo posto finale dal layout, si calcola di quanto il
// rettangolo della card si discosti da quel posto finale, si applica quella
// differenza come `transform` iniziale, e si annima verso zero. Il vantaggio è
// che la posizione finale non è scritta a mano: è quella che il layout ha
// deciso, quindi non può divergere dal vero posto del pannello.
//
// Lo `scale` è separato su X e Y perché il rapporto fra la card e il pannello
// non è quadrato: con una scala unica il pannello si deformerebbe troppo o
// rimpicciolirebbe. Due scale diverse durante 400ms stirano il contenuto, ed è
// esattamente l'effetto di «una card che si espande».
export default function AddProjectModal({ onClose, origin }: AddProjectModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // I controlli del moto stanno in una transizione CSS dichiarata nel markup,
  // non in framer: vedi la nota sul FLIP più in basso.
  // Il rettangolo del FLIP è conservato in un ref e non in uno stato: serve
  // solo alla chiusura, dove lo rilegge `requestClose`, e farlo passare da uno
  // stato aggiungerebbe un render che non disegna niente.
  const flipRef = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);
  // `closing` distingue il dialog aperto dal dialog che sta rientrando. Serve
  // al markup per spegnere il backdrop mentre il pannello torna indietro, e
  // `closingRef` fa la stessa cosa per la logica, che deve poter fermare una
  // seconda chiusura senza aspettare un render.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  // Gli stadi del FLIP: 0 = da misurare, 1 = sulla card senza transizione,
  // 2 = transizione in corso verso il centro, 3 = nessun FLIP (niente origine,
  // oppure movimento ridotto) e il pannello è semplicemente al suo posto.
  const [flipStage, setFlipStage] = useState(0);
  // L'elemento che aveva il focus prima dell'apertura: a quel focus si torna
  // alla chiusura. Senza, l'utente da tastiera verrebbe lasciato su `body` e
  // dovrebbe ripartire da capo con Tab.
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // IL BLOCCO DELLO SCROLL è suo, e non un riuso cieco di quello d'ingresso:
  // qui la pagina deve restare ferma anche con la prima pagina già completa,
  // cosa che il blocco d'ingresso non fa — dopo l'ingresso lascia scorrere i
  // tasti, ed è il comportamento giusto per lì, non per un dialog.
  useEffect(() => {
    lockScroll('modal');
    return () => unlockScroll('modal');
  }, []);

  // IL FOCUS. All'apertura va al primo campo — è un form, e l'utente che lo
  // apre di solito vuole scrivere — e non al bottone di chiusura, che è la
  // prima cosa che si vede ma non la prima che serve.
  useLayoutEffect(() => {
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>('input:not([type="hidden"])');
    first?.focus();
    return () => {
      // Alla chiusura il focus torna dove era. `preventScroll` perché riportare
      // il focus su un elemento fuori campo scorrerebbe la pagina, e la pagina
      // appena sbloccata si troverebbe a saltare.
      restoreFocusTo.current?.focus?.({ preventScroll: true });
    };
  }, []);

  // LA TRAPPOLA DEL FOCUS.
  //
  // Un dialog modale deve tenere il focus dentro di sé: senza, Tab uscendo
  // dall'ultimo campo finirebbe sulla pagina di sotto, che è anche bloccata —
  // cioè l'utente perderebbe il filo del form. Si intercetta Tab e Shift+Tab
  // agli estremi e si riciclano. Gli altri tasti passano: scrivere una `e` deve
  // poter mettere una `e` nel campo.

  // IL FLIP, SENZA FRAMER.
  //
  // Prima provavo con `initial` e poi con `useAnimationControls`, e in entrambi i
  // casi il pannello partiva già centrato (`inline: none`, nessuna espansione).
  // Il motivo è una corsa: framer risolve i valori iniziali in un effetto che
  // gira PRIMA di `useLayoutEffect`, quindi quando questo scrive il transform
  // della card l'animazione è già partita dall'identità e lo sovrascrive al
  // frame dopo. Scrivere il transform a mano non basta, perché è framer a
  // decidere da dove si parte.
  //
  // Quindi il moto è una TRANSIZIONE CSS e framer non c'entra. Il vantaggio è
  // che la transizione parte da ciò che è già nel DOM, che è esattamente il
  // punto da cui vogliamo partire: nessuna corsa fra effetti, e lo stesso
  // codice regge apertura e chiusura.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!origin || reducedMotion) {
      // Senza origine (o senza FLIP) il pannello è semplicemente già al suo
      // posto: si accende e basta.
      panel.style.opacity = '1';
      return;
    }
    const target = panel.getBoundingClientRect();
    const f = {
      x: origin.left - target.left,
      y: origin.top - target.top,
      sx: origin.width / Math.max(1, target.width),
      sy: origin.height / Math.max(1, target.height),
    };
    flipRef.current = f;
    // IL PASSAGGIO ALL'IDENTITÀ AVVIENE IN UN RENDER SUCCESSIVO, e non qui.
    //
    // Scrivere il transform e rilasciarlo nella stessa fase di layout non
    // produce nessuna transizione: il browser registra il valore iniziale e lo
    // abbandona senza mai dipingere lo stato intermedio (misurato: 22 frame
    // campionati con `scaleX` sempre 1, benché il FLIP calcolasse `sx: 0.607` e
    // `x: 610` corretti). Lo stesso accade con `requestAnimationFrame` e con il
    // reflow forzato: nessuno dei tre fa da separatore.
    //
    // Qui si passa solo allo stadio 1, che React rende applicando il transform
    // della card SENZA transizione: quello stato viene dipinto, perché è un
    // render vero. Poi l'effetto successivo attiva la transizione e rilascia.
    setFlipStage(1);
  }, [origin]);

  // Dallo stadio 1 allo stadio 2 il pannello esiste già con il transform della
  // card applicato e senza transizione: qui si accende la transizione e si
  // rilascia il transform verso l'identità, e da qui parte il moto. Il frame di
  // attesa serve a dare al browser il tempo di dipingere lo stadio 1.
  useLayoutEffect(() => {
    if (flipStage !== 1) return;
    const raf = requestAnimationFrame(() => setFlipStage(2));
    return () => cancelAnimationFrame(raf);
  }, [flipStage]);

  // LA CHIUSURA è l'inverso, e la fa partire il componente stesso.
  //
  // Il genitore non smonta niente finché il moto non è finito: se lo facesse
  // lui, l'elemento sparirebbe dal primo frame e la chiusura non si vedrebbe.
  // Qui si scrive il transform di partenza e solo al termine si chiama
  // `onClose`. Il tempo è quello dichiarato in `FLIP_DURATION`, più un piccolo
  // margine: se lo smontaggio arrivasse prima della fine della transizione,
  // l'ultimo fotogramma verrebbe tagliato.
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const panel = panelRef.current;
    const f = flipRef.current;
    if (panel && f && !reducedMotion) {
      panel.style.transformOrigin = 'top left';
      panel.style.transform = `translate(${f.x}px, ${f.y}px) scale(${f.sx}, ${f.sy})`;
    } else if (panel) {
      panel.style.opacity = '0';
    }
    setClosing(true);
    window.setTimeout(onClose, (reducedMotion ? 0.15 : FLIP_DURATION) * 1000 + 40);
  }, [onClose]);

  // ESC si ascolta a livello di FINESTRA, non con una prop React sul pannello:
  // durante l'uscita il focus può tornare al documento, e l'ascolto su `window`
  // è l'unico posto dove l'evento arriva comunque. È anche il posto giusto per
  // una trappola del focus, che per definizione riguarda tutto ciò che c'è fuori.
  useEffect(() => {
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
        .filter((node) => node.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [requestClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 md:p-8"
      // Il backdrop è un elemento a sé, e non lo sfondo del contenitore: deve
      // essere cliccabile per chiudere, ma NON deve rubare i click a ciò che c'è
      // dentro il pannello. Con lo sfondo sul contenitore, chiuderebbe anche
      // premendo sul form.
      onClick={requestClose}
    >
      {/* Il backdrop è un elemento a sé, e non lo sfondo del contenitore: deve
          essere cliccabile per chiudere, ma NON deve rubare i click a ciò che c'è
          dentro il pannello. Con lo sfondo sul contenitore, chiuderebbe anche
          premendo sul form. Il click fuori è l'unica via di chiusura col
          mouse; ESC e il bottone sono le altre due.

          `top-24` e non `inset-0`: il backdrop non parte dalla fascia in alto, ma
          da SOTTO l'header. Non è una questione estetica. Il `backdrop-blur`
          sfoca tutto ciò che sta sotto di lui, e sotto lui ci sono l'header
          (z-50) e il marchio con l'avatar (LogoLayer, z-60): il dialog è aperto
          proprio mentre parte una reazione, quindi l'animazione dell'avatar
          accadeva dietro una sfocatura e non si vedeva. Con il bordo superiore
          a 96px — l'altezza `h-24` dell'header — fascia e ritratto restano
          netti, e la reazione si vede.

          Non si perde nulla sul click fuori: il contenitore `z-[70]` copre tutta
          la viewport e ha gia' `onClick={requestClose}`, quindi premere
          sull'header chiude esattamente come prima. Qui sotto il pannello
          cliccabile e' ridotto, ma il pannello stesso ferma la propagazione. */}
      <div
        onClick={requestClose}
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 top-24 bg-canvas/60 backdrop-blur-sm transition-opacity"
        style={{ opacity: closing ? 0 : 1, transitionDuration: `${FLIP_DURATION}s` }}
      />

      {/* IL PANNELLO. È un `div` semplice e non un `motion.div`: il moto è la
          transizione CSS dichiarata qui sotto, che parte da ciò che è già nel DOM
          — cioè dal transform che il FLIP ha appena scritto — mentre framer
          risolverebbe i valori iniziali per conto suo, in un effetto che gira
          prima, e la partirebbe sbagliata (vedi la nota sul FLIP).

          La transizione è su `transform`, non su `left/top/width`: sono proprietà
          di layout e durante 400ms costerebbero un reflow per frame. Con il solo
          transform il pannello si muove sulla GPU.

          `will-change` è dichiarata qui e non aggiornata a mano: segnalava il
          caso in cui la transizione era già finita, ma a quel punto non serve
          più — è il browser a poterlo togliere da solo. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        // data-lenis-prevent: lo scroll interno del pannello (su mobile il
        // contenuto è più alto dello schermo) resta nativo e non viene
        // impaginato dal motore di smooth scroll, che è fermo comunque.
        data-lenis-prevent
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto overscroll-contain grid-wireframe bg-dark-green"
        style={{
          transformOrigin: 'top left',
          // Il transform è un valore DI REACT, non una scrittura imperativa: è
          // questo che garantisce che lo stato sulla card venga dipinto prima
          // che la transizione venga attivata (vedi la nota sul FLIP).
          transform: flipStage === 1 && flipRef.current
            ? `translate(${flipRef.current.x}px, ${flipRef.current.y}px) scale(${flipRef.current.sx}, ${flipRef.current.sy})`
            : undefined,
          willChange: 'transform',
          transitionProperty: 'transform',
          // La transizione c'è solo dallo stadio 2: nello stadio 1 il pannello
          // deve essere sulla card SENZA animare, altrimenti arriverebbe al
          // centro saltando la posizione di partenza.
          transitionDuration: flipStage >= 2 ? (reducedMotion ? '0.15s' : `${FLIP_DURATION}s`) : '0s',
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div ref={dialogRef}>
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-dark-green px-5 md:px-8 pt-5 md:pt-7 pb-4">
            <div className="min-w-0">
              <div className="font-mono text-[10px] tracking-widest text-swiss-pink mb-2">
                [NUOVA MISSIONE]
              </div>
              <h2
                id="add-project-title"
                className="font-display font-extrabold text-2xl md:text-4xl leading-[0.9] tracking-tight text-accent"
              >
                Aggiungi il tuo progetto
              </h2>
              <p className="font-mono text-[10px] md:text-xs tracking-widest text-swiss-pink/70 mt-2">
                Raccontami di cosa ha bisogno il tuo brand.
              </p>
            </div>
            {/* Stile dei pulsanti già codificati: stesso mono, stesso tracking
                largo, stesso colore dei bordi e delle etichette. Cambia solo il
                simbolo, perché qui l'azione è chiudere e non andare avanti. */}
            <button
              onClick={requestClose}
              className="group shrink-0 flex items-center gap-1 font-mono text-[10px] md:text-xs tracking-widest text-swiss-pink border border-swiss-pink px-3 py-2 transition-colors hover:bg-swiss-pink hover:text-dark-green"
            >
              [CHIUDI
              <X className="w-3 h-3" />
              ]
            </button>
          </div>

          {/* Lo stesso form della sezione "Let's build", con `source` diverso:
              qui la richiesta arriva dalla card, e il backend potrà distinguerla
              da un contatto normale senza dover indovinare dalla pagina. */}
          <div className="px-5 md:px-8 pb-5 md:pb-7">
            <ContactForm source="add-project-card" />
          </div>
        </div>
      </div>
    </div>
  );
}
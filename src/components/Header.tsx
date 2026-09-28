import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
import KineticText from './KineticText';
import { entryState, isSkipEntry } from '@/lib/entryState';
import { ENTRY_CONFIG } from '@/lib/entryConfig';
import {
  BRAND_TITLE_HEADER_CLASS,
  BRAND_TITLE_TEXT,
} from '@/lib/brandTitle';

interface HeaderProps {
  activeSection: number;
}

const TITLES = [
  BRAND_TITLE_TEXT,
  BRAND_TITLE_TEXT,
  BRAND_TITLE_TEXT,
  'SELECTED WORKS',
  'TRANSMISSION',
];

export default function Header({ activeSection }: HeaderProps) {
  const title = TITLES[activeSection] ?? TITLES[0];
  // La fascia e' governata dallo stato d'ingresso e NON dallo scroll.
  //
  // Prima compariva con una finestra di scroll ancorata a heroTop, cioe'
  // mentre l'utente ci arrivava. Con il pulsante non esiste piu' un arrivo da
  // misurare: la fascia deve comparire quando parte la sequenza, perche' e'
  // li' che il nome atterra, e restare su tutta la pagina. Legarla ancora
  // allo scroll la lascerebbe invisibile a scroll 0, che e' esattamente dove
  // il nome va a posarsi.
  //
  // Con `?skip` lo stato e' `hero` fin dall'inizio e la fascia e' gia' su:
  // si entra diretti nella prima pagina, che e' l'unica cosa che quel flag
  // deve fare.
  const [state, setState] = useState(() => entryState.get());
  useEffect(() => entryState.subscribe(setState), []);
  const visible = state !== 'preloader';

  // La linea si disegna una volta sola, quando la sequenza parte: ripartire da
  // zero a ogni cambio di stato la farebbe lampeggiare. E' una MotionValue e
  // non uno stato perche' il valore cambia a ogni frame durante 0.7s, e uno
  // stato farebbe un render di React per frame.
  const headerLine = useMotionValue(0);
  const linePlayedRef = useRef(false);
  useEffect(() => {
    // Con `?skip` la sequenza non parte: nessuno disegnerebbe la linea e
    // l'header resterebbe senza bordo per sempre, che e' peggio del
    // preloader. In quel caso la linea e' gia' al suo posto.
    if (isSkipEntry()) {
      headerLine.set(1);
      linePlayedRef.current = true;
      return;
    }
    if (state !== 'entering' || linePlayedRef.current) return;
    linePlayedRef.current = true;
    // Il ritardo e' l'unico accordo fra i due movimenti: senza, la linea e il
    // nome partirebbero insieme e sembrerebbero un gesto solo invece di due.
    const controls = animate(headerLine, 1, {
      duration: ENTRY_CONFIG.headerLineDuration,
      ease: ENTRY_CONFIG.headerLineEasing,
      delay: ENTRY_CONFIG.headerLineDelay,
    });
    return () => controls.stop();
  }, [state, headerLine]);

  return (
    <motion.header
      initial={false}
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
      aria-hidden={!visible}
      // `pb-px` al posto di `border-b`, e un elemento dedicato sotto. Motivo: un
      // bordo CSS non e' animabile con scaleX (la sua larghezza non e'
      // trasformabile), quindi per disegnare la linea serve un nodo. Sostituito
      // il bordo con 1px di padding, l'altezza totale resta IDENTICA: `h-24`
      // e' border-box, quindi i due pixel si scambiano e il contenuto centrato
      // non si sposta nemmeno di mezzo pixel. L'elemento e' `absolute`, quindi
      // non aggiunge nulla al layout.
      className="fixed left-0 top-0 z-50 flex h-24 w-full items-center justify-center pb-px bg-canvas px-4 text-center"
    >
      {/* La linea dell'header: si disegna da sinistra a destra mentre il nome
          vola, e parte con un ritardo rispetto al viaggio perche' i due
          gesti devono restare distinguibili. `transformOrigin: left` e'
          l'ancora del disegno: senza, la scala si aprirebbe dal centro.

          `aria-hidden`: e' un ornamento grafico. Il testo che il marchio
          annuncia e' gia' nell'header, e una riga decorativa non deve finire
          nel nome accessibile del banner. */}
      <motion.div
        aria-hidden="true"
        style={{ scaleX: headerLine, transformOrigin: 'left' }}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-swiss-pink/20"
      />
      <div className="w-full h-full flex items-center justify-center">
        <AnimatePresence mode="wait">
          {/* `data-logo-target` e' l'estremo di ARRIVO della FLIP del nome.
              Come per la sorgente, sta sull'involucro e non sull'h1: e' la sua
              scatola che il viaggio deve riprodurre al pixel, ed e' l'involucro
              che resta identico fra l'ingresso e l'uscita del titolo dalla
              scena, quindi la destinazione non si sposta sotto i piedi del
              volo. */}
          <motion.div
            key={title}
            data-logo-target=""
            initial={title === BRAND_TITLE_TEXT ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex items-center justify-center"
          >
            <KineticText
              as="h1"
              idle
              intensity={0.28}
              className={title === BRAND_TITLE_TEXT ? BRAND_TITLE_HEADER_CLASS : 'font-display text-2xl font-extrabold leading-none tracking-tight text-accent antialiased md:text-4xl'}
            >
              {title}
            </KineticText>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.header>
  );
}

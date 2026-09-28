import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import KineticText from './KineticText';
import TransmissionButton from './TransmissionButton';
import {
  BRAND_TITLE_PRELOADER_CLASS,
  BRAND_TITLE_PRELOADER_TRACKING_EM,
  BRAND_TITLE_TEXT,
  getBrandTitleStartSize,
} from '@/lib/brandTitle';
import { audio } from '@/lib/audioLayer';
import { entryState } from '@/lib/entryState';
import { reducedMotion } from '@/lib/motionPreference';

// IL PRELOADER.
//
// Il titolo e' qui fermo, alla sua dimensione e alla sua posizione di partenza:
// prima si spostava e si spegneva pilotando una MotionValue di scroll, e con
// lo scroll bloccato quella finestra non avrebbe mai aperto. Lo spostamento
// vero e proprio lo fa il Passo 2, con la tecnica FLIP: un solo elemento
// che parte da qui e arriva nell'header, letto nelle sue coordinate reali.
//
// La dimensione non puo' restare un numero scritto qui: dipende dalla
// larghezza della finestra, e va riletta al resize. Un listener e' il costo
// minimo, e vale una volta sola per un elemento che vive pochi secondi.

/** Come `CROSSFADE_MS` in EntrySequence: due moduli, uno stesso numero. */
const CROSSFADE_MS = 200;

export default function PreloaderScene({ onHero }: { onHero?: () => void }) {
  const [fontSize, setFontSize] = useState(() => getBrandTitleStartSize(window.innerWidth));
  const [state, setState] = useState(() => entryState.get());
  // Il nodo radice serve per la pulizia finale: `aria-hidden`, `inert` e
  // `visibility` si possono mettere solo dall'esterno, e qui l'esterno non
  // esiste — chi chiama questa funzione e' App, che non ha il nodo.
  const rootRef = useRef<HTMLDivElement>(null);
  // Il contenuto si spegne DOPO il crossfade con movimento ridotto, non insieme.
  const [contentOff, setContentOff] = useState(() => entryState.get() !== 'preloader');

  useEffect(() => {
    const onResize = () => setFontSize(getBrandTitleStartSize(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Lo stato vive in uno `useState` invece che in una MotionValue perche'
  // governa una cosa che si accende e si spegne, non un movimento continuo da
  // interpolare a ogni frame.
  useEffect(() => entryState.subscribe(setState), []);

  // Lo spegnimento del contenuto, con la sua temporizzazione.
  //
  // In movimento normale non si aspetta: il titolo deve restare in scena fino
  // all'istante in cui la FLIP lo solleva, e un ritardo di 200ms significherebbe
  // un titolo che scompare e ricompare. Con movimento ridotto la FLIP non c'e',
  // quindi l'attesa serve a qualcos'altro: a dare al dissolvimento dell'hero il
  // tempo di esistere. E' l'unico ramo in cui il ritardo e' un guadagno.
  useEffect(() => {
    if (state === 'preloader') {
      setContentOff(false);
      return;
    }
    if (!reducedMotion) {
      setContentOff(true);
      return;
    }
    const id = window.setTimeout(() => setContentOff(true), CROSSFADE_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  // LA PULIZIA A FINE SEQUENZA.
  //
  // Tre passi, in quest'ordine, e l'ordine non e' una scelta estetica:
  // `aria-hidden` toglie il preloader dagli alberi di accessibilita', `inert`
  // toglie tutto quello che c'e' dentro dal focus e dal puntatore, e solo alla
  // fine `visibility: hidden` lo toglie dal paint. Inversi, si avrebbe una
  // finestra in cui il nodo e' invisibile ma ancora leggibile e ancora
  // cliccabile, e un screen reader che in quel momento fa una lettura del
  // documento troverebbe un pulsante che sparisce.
  //
  // Il nodo NON viene rimosso dal DOM: la sezione che lo contiene e' alta un
  // viewport e regge l'offset di tutte le sezioni successive. Rimuoverla
  // sposterebbe l'hero in cima alla pagina e ogni trigger di scroll che ne
  // deriva si troverebbe a guardare il vuoto.
  useEffect(() => {
    if (state !== 'hero') return;
    const root = rootRef.current;
    if (root) {
      root.setAttribute('aria-hidden', 'true');
      // `inert` e' quello che chiede la specifica, ma non e' in tutti i
      // browser. Il pulsante sotto ha comunque `disabled` e `tabIndex={-1}`,
      // quindi anche dove l'attributo manca l'interno e' gia' irraggiungibile:
      // `inert` e' la difesa, non l'unica difesa.
      root.setAttribute('inert', '');
      root.style.visibility = 'hidden';
    }
    onHero?.();
  }, [state, onHero]);

  const handleEnter = () => {
    // `unlock()` PRIMA di qualunque altra cosa: e' il click, quindi e' l'unico
    // momento in cui il browser consente di avviare l'audio. Dopo questo
    // istante non ci sara' piu' nessun gesto utente da cui ripartire.
    audio.unlock();
    // Il solo gesto che avvia la sequenza. Chi la orchestra (EntrySequence) si
    // iscrive a questo stesso valore, quindi qui non si chiama nessuno: due
    // canali di avvio potrebbero far partire la sequenza due volte.
    entryState.set('entering');
  };

  // Il preloader e' "di scena" finche' il suo contenuto non si e' spento. Sono
  // due domande diverse: sotto `?skip` lo stato e' gia' `hero` al mount ma il
  // titolo non c'e' mai stato, e con movimento ridotto il titolo se ne va 200ms
  // DOPO lo stato. Misurare la scena sullo stato sbaglierebbe i due casi.
  const shown = !contentOff;

  // Con movimento ridotto il preloader dissolve invece di spegnersi. Il
  // passaggio e' sull'opacita' dell'involucro e non sul testo giallo
  // dell'headline: spegnere il titolo significherebbe togliere all'utente la
  // prima riga che sta per leggere, e un titolo che scompare non e' un
  // dissolvimento, e' un errore di caricamento.
  const crossfade = reducedMotion ? 'opacity 200ms linear' : 'none';

  return (
    <motion.div
      ref={rootRef}
      style={{ opacity: contentOff ? 0 : 1, transition: crossfade }}
      className="pointer-events-none fixed inset-0 z-40 flex h-screen w-full flex-col items-center justify-center overflow-hidden bg-transparent"
    >
      {/* `data-logo-source` e' l'estremo di PARTENZA della FLIP del nome. Va
          sull'involucro e non sull'h1 perche' e' l'involucro a portare il
          `fontSize` della fase di partenza: e' la sua scatola che il viaggio
          deve riprodurre al pixel.

          `visibility` e' dichiarato qui, e non solo imposto a mano dalla FLIP:
          con `?skip` la sequenza non parte e nessuno passerebbe di qui, ma il
          titolo deve sparire lo stesso perche' lo stato e' gia' `hero`.

          `hidden` e non `display:none`: il titolo deve continuare a occupare
          il suo spazio, altrimenti il contenitore del preloader si
          ricentrerebbe e il pulsante salirebbe a meta' schermata. Lo spazio
          resta cosi' identico a quello che occupa il marchio volante. */}
      <motion.div
        data-logo-source=""
        style={{
          fontSize,
          letterSpacing: `${BRAND_TITLE_PRELOADER_TRACKING_EM}em`,
          visibility: shown ? 'visible' : 'hidden',
        }}
        className="origin-center will-change-transform"
      >
        <KineticText
          as="h1"
          idle
          intensity={0.28}
          className={BRAND_TITLE_PRELOADER_CLASS}
        >
          {BRAND_TITLE_TEXT}
        </KineticText>
      </motion.div>

      {/* Il pulsante sta dove stava il vecchio prompt "[SCORRI PER INIZIARE ↓]",
          cioe' fermo al fondo, al centro. E' l'unico modo per uscire dal
          preloader adesso: il prompt e' sparito e non tornera'.

          `visibility` e non `display`: il pulsante esce dal flusso con
          `display:none` e il contenitore del preloader tornerebbe centrato
          su se stesso, spostando il titolo di mezzo schermata proprio
          mentre la sequenza sta per partire. Così lo spazio resta occupato e
          il titolo non si muove.

          `pointer-events: none` accompagna il nascondimento: senza, un click
          di troppo nei frame fra il cambio di stato e lo spegnimento dei
          passi successivi rientrerebbe e ripartirebbe la sequenza. */}
      <div
        className="pointer-events-auto fixed bottom-10 left-1/2 z-50 -translate-x-1/2"
        style={{
          visibility: shown ? 'visible' : 'hidden',
          pointerEvents: shown ? 'auto' : 'none',
        }}
      >
        <TransmissionButton
          label="AVVIA TRASMISSIONE"
          onClick={handleEnter}
          // Fuori scena il pulsante e' disabilitato e fuori dal Tab order PRIMA
          // che il contenitore diventi `inert`. Sono due difese e non una: `inert`
          // non e' ancora onnipresente, e in un browser che non lo supporta il
          // pulsante resterebbe cliccabile — e un click di troppo rientrerebbe
          // ripartire la sequenza da capo.
          disabled={!shown}
          tabIndex={shown ? 0 : -1}
          ariaLabel="Avvia trasmissione"
        />
      </div>
    </motion.div>
  );
}

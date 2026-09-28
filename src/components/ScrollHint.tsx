import { useCallback, useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, type MotionValue } from 'framer-motion';
import type { ReactNode } from 'react';
import { ScrambleController } from '@/lib/scramble';
import { clearScrollHint, registerScrollHint } from '@/lib/scrollHintControl';
import { AUDIO_EVENTS, audio } from '@/lib/audioLayer';
import { entryState } from '@/lib/entryState';

export default function ScrollHint({
  opacity,
  children,
  autoStart = true,
  scrambleText,
  onResolved,
}: {
  opacity: MotionValue<number>;
  children?: ReactNode;
  /**
   * Se `false` l'hint non parte da solo e resta spento finche' la sequenza non
   * lo chiama: nell'ingresso deve comparire DOPO le coordinate, non al primo
   * frame come in pagina.
   */
  autoStart?: boolean;
  /** Se valori, l'hint si compone una volta sola con lo scramble. */
  scrambleText?: string;
  /** Chiamata quando l'hint ha finito di comporsi. */
  onResolved?: () => void;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);
  // La rivelazione e' un MotionValue e non uno stato: l'opacita' finale e' il
  // prodotto fra questa e quella che arriva dalla scena, e Fr Motion deve poter
  // leggerla a ogni frame senza un render.
  const reveal = useMotionValue(0);

  // L'hint e' pronto fin dal mount e aspetta: la sequenza lo avvia quando e'
  // l'ora, e con `?skip` o movimento ridotto non e' mai la sequenza a farlo, ma
  // l'hint deve comunque comparire. In tutti e tre i casi la sua funzione e'
  // "comparire", e la differenza e' solo se il testo si compone o no.
  const revealNow = useCallback(() => {
    reveal.set(1);
  }, [reveal]);

  useEffect(() => {
    // Con `autoStart` l'hint si rivela da solo al mount: e' il comportamento
    // delle sezioni interne, che non hanno una sequenza d'ingresso.
    if (autoStart) {
      revealNow();
      return;
    }
    // Sotto `?skip` e con movimento ridotto lo stato e' gia' `hero` quando la
    // pagina monta, e non passera' mai da `entering`: nessuno chiamerebbe
    // `startScrollHint` e il prompt resterebbe spento per sempre. Si rivela
    // quindi subito, guardando lo stato invece che aspettando una transizione
    // che in quel caso non avverra'.
    if (entryState.get() !== 'preloader') {
      revealNow();
      if (scrambleText && textRef.current) {
        textRef.current.style.removeProperty('visibility');
      }
      return;
    }
    if (!scrambleText) return;
    if (textRef.current) textRef.current.style.visibility = 'hidden';
    registerScrollHint(() => {
      revealNow();
      if (startedRef.current) return;
      startedRef.current = true;
      new ScrambleController({
        target: scrambleText,
        node: textRef.current as HTMLElement,
        // La sequenza tiene lo scroll fermo finche' l'hint non ha finito di
        // comporsi: e' l'unico testo che spiega all'utente che puo' andare
        // avanti, quindi non e' un dettaglio di grafica.
        onComplete: () => {
          textRef.current?.style.removeProperty('visibility');
          audio.play(AUDIO_EVENTS.TRANSITION_END);
          onResolved?.();
        },
      }).start(0);
    });
    return () => clearScrollHint();
  }, [autoStart, scrambleText, revealNow, onResolved]);

  // L'opacita' finale: la rivelazione AND la dissolvenza della scena. Cosi' l'hint
  // resta acceso dopo l'ingresso e si spegne con il ritratto quando la scena
  // si dissolve, che e' il comportamento che aveva prima.
  const visibleOpacity = useTransform<number, number>(
    [opacity, reveal] as MotionValue<number>[],
    (values) => values[0] * values[1],
  );

  return (
    <motion.span
      style={{ opacity: visibleOpacity, x: '-50%' }}
      // Il prompt e' l'unico testo che spiega all'utente che puo' andare avanti,
      // quindi deve essere annunciato quando compare. La regione e' `polite` e
      // non `assertive` perche' non e' un allarme: interromperebbe la lettura di
      // quello che l'utente sta gia' leggendo per dire una cosa che puo' anche
      // aspettare la fine della frase.
      //
      // Durante la composizione il testo ha `visibility: hidden`, che lo tiene
      // gia' fuori dall'albero di accessibilita': lo screen reader non puo'
      // quindi leggere i simboli dello scramble, che e' il motivo per cui la
      // regione si dichiara qui e non sul nodo interno.
      aria-live="polite"
      className="pointer-events-none fixed bottom-10 left-1/2 z-50 whitespace-nowrap font-mono text-[15px] font-bold tracking-widest text-swiss-pink"
    >
      <span ref={textRef} className="scroll-hint-pulse inline-block">{children}</span>
    </motion.span>
  );
}

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

interface TransmissionButtonProps {
  /**
   * Testo del pulsante, SENza parentesi e senza la freccia: sono quelle due
   * cose a far parte del componente, non della stringa. Cosi' il pulsante del
   * preloader e quello del form contatti non possono divergere nella resa
   * nemmeno per un refuso.
   */
  label: string;
  onClick?: () => void;
  // 'button' e' il default deliberato: il pulsante vive anche fuori da un
  // form e, con 'submit' ereditato, un Invio su un modulo qualsiasi lo
  // invierebbe per sbaglio.
  type?: 'button' | 'submit';
  className?: string;
  /**
   * Nome accessibile, quando il testo visibile non basta.
   *
   * Serve al pulsante del preloader, non a quello dei contatti: la sua etichetta
   * e' gia' un'azione. Qui la stringa visibile e' `[AVVIA TRASMISSIONE]` piu'
   * una freccia disegnata, e quello che uno screen reader ne ricava e' "avvia
   * trasmissione, freccia destra" — la freccia e' un segnale di destinazione che
   * qui non indica nessuna destinazione, dice solo "avanti".
   */
  ariaLabel?: string;
  /** Fuori scena: non cliccabile e fuori dal Tab order. Vedi PreloaderScene. */
  disabled?: boolean;
  tabIndex?: number;
}

// IL PULSANTE DI TRASMISSIONE.
//
// Componente unico per il preloader e per il form contatti. Le classi sono
// esattamente quelle che stavano inline nel pulsante del form, rimosso senza
// modificarne una: se qui ne comparisse una diversa, il preloader e il
// contatto mostrerebbero due pulsanti diversi.
//
// Il focus visibile non e' stilato qui dentro ma nel foglio di stile: e' una
// scelta di colore della pagina e vive accanto agli altri elementi di quel
// linguaggio.

export default function TransmissionButton({
  label,
  onClick,
  type = 'button',
  className = '',
  ariaLabel,
  disabled = false,
  tabIndex,
}: TransmissionButtonProps) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      tabIndex={tabIndex}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      className={`transmission-button group flex items-center gap-3 bg-dark-green text-swiss-pink font-mono text-sm tracking-widest px-8 py-4 hover:bg-dark-green hover:text-swiss-pink border border-swiss-pink transition-colors ${className}`}
    >
      [{label}
      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
      ]
    </motion.button>
  );
}
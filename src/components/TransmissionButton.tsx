import { motion } from 'framer-motion';
import type { MouseEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { reactAvatar } from '@/lib/avatarReactions';

interface TransmissionButtonProps {
  /**
   * Testo del pulsante, SENza parentesi e senza la freccia: sono quelle due
   * cose a far parte del componente, non della stringa. Cosi' il pulsante del
   * preloader e quello del form contatti non possono divergere nella resa
   * nemmeno per un refuso.
   */
  label: string;
  /**
   * Il click, con il suo evento.
   *
   * Il parametro è opzionale per chi chiama: i due usi esistenti (preloader,
   * form contatti) passano una funzione senza argomenti, e continua a
   * compilare. Serve a un terzo uso — il bottone che apre il modal e gli
   * passa il proprio rettangolo come origine della sua apertura — che ha
   * bisogno di `currentTarget` per misurare il bottone premuto e non il testo
   * dentro. Dichiarare qui `() => void` e misurare dal fuori con un ref
   * sarebbe stato possibile, ma avrebbe misurato il contenitore del bottone
   * invece del bottone, e il FLIP del modal sarebbe partito da un punto
   * leggermente diverso da quello che l'utente ha premuto.
   */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
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
  /**
   * La reazione dell'avatar al click, o `null` per nessuna.
   *
   * `null` e' un caso reale e non una dimenticanza: il pulsante di INVIO del
   * form reagisce con i CUORI, e quel trigger non e' questo click ma
   * l'invio andato a buon fine. Dichiarare `null` qui e mettere i cuori dove
   * la validazione passa e' l'unico modo che i due non si sommino: se il
   * pulsante dicesse "stelline" da solo, un invio sbagliato farebbe ugualmente
   * reagire il viso, e la reazione direbbe che e' andato tutto bene mentre i
   * campi sono ancora vuoti.
   */
  reaction?: 'stars' | 'hearts' | null;
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
  // Le STELLINE sono il default e non un caso particolare: questo pulsante e' il
  // bottone di avvio della pagina (preloader), il bottone di chiusura del metodo
  // e quello di contatto, e la specifica li mette tutti fra i trigger
  // "azione compiuta". Dichiararlo come default e non come valore da passare a
  // ogni uso evita che il prossimo bottone di questo tipo nasca senza
  // reazione — che e' il difetto che un default previene.
  reaction = 'stars',
}: TransmissionButtonProps) {
  return (
    <motion.button
      type={type}
      // La reazione parte PRIMA di `onClick`, non dentro: `onClick` puo' portare
      // via l'utente (il preloader apre la sequenza, il contatto scorre alla
      // sezione) e una reazione che parte dopo una navigazione non si vede piu'.
      // Con il click che non fa niente — il bottone disabilitato del preloader,
      // per esempio — il click non arriva affatto e quindi nemmeno la
      // reazione: il `disabled` nativo fa da guardia senza che qui si debba
      // ricontrollarlo.
      onClick={(event) => {
        if (reaction) reactAvatar(reaction);
        onClick?.(event);
      }}
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
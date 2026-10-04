import { ArrowUpRight } from 'lucide-react';
import { openAddProjectModal } from '@/lib/addProjectControl';
import { reactAvatar } from '@/lib/avatarReactions';

/**
 * L'ultima card della Works: uno SLOT VUOTO da riempire, non un progetto.
 *
 * Ha la stessa geometria delle altre — stessa larghezza da `--works-card-w`,
 * stesso aspect 3:4, stesso spessore di contenuto — e cambia solo il linguaggio:
 * dove le altre sono casi chiusi, questa è un invito. Per questo non riusa
 * `ProjectCard`: quella ha dentro kpi, brief, tag e cliente, cioè un contenuto
 * che qui non esiste e che inventare sarebbe falso. Qui si costruisce a mano lo
 * scheletro, prendendo pezzi di markup dalle card vere (intestazione mono, piè
 * con freccia) così le due grammatiche restano identiche.
 *
 * Il '+' al centro è il segnale: è la sagoma di un'area di caricamento, e
 * grande quanto basta per essere l'elemento dominante. In idle respira, in
 * hover ruota: sono i due gesti che distinguono un campo interattivo da un
 *'immagine, e servono anche a chi non può passare sopra col mouse ma ci arriva
 * col focus.
 */
export default function AddProjectCard() {
  // Nessuno stato, nessun effetto, nessun `useReducedMotion` in JS: i gesti
  // del '+' sono animazioni CSS dichiarate in index.css, e li' la
  // `prefers-reduced-motion` le disattiva tutte e tre con un'unica regola. Un
  // controllo in JavaScript avrebbe diviso la stessa decisione in due posti,
  // che è il difetto che `motionPreference` esiste per evitare.
  return (
    <button
      type="button"
      // Il rettangolo della card è ciò che fa partire il FLIP del modal: senza,
      // il pannello comparirebbe al centro dello schermo e il legame fra la
      // card premuta e il dialog che si apre si perderebbe. `currentTarget` è la
      // card stessa, non il '+' dentro: è lei che si espande.
      onClick={(event) => {
        // Le STELLINE partono dal click, non dall'apertura del modal: il viso
        // reagisce a un'azione compiuta, e il click e' l'azione. Metterlo
        // dentro `openAddProjectModal` sembrerebbe piu' pulito — un solo punto
        // invece di due — ma allora reagirebbe anche quando il modal si apre
        // dalla sezione metodo, dove la specifica non lo chiede, e il click su
        // un'altra card che pure apre il form non avrebbe risposta.
        reactAvatar('stars');
        openAddProjectModal(event.currentTarget.getBoundingClientRect());
      }}
      aria-haspopup="dialog"
      aria-label="Aggiungi il tuo progetto"
      data-add-project-card=""
      // La label del cursore e' `[AGGIUNGI]` e non `[VAI]`: `VAI` su questa
      // card sarebbe una promessa di una destinazione che qui non c'e' — qui si
      // apre un form, e la parola giusta e' quella che ci mette dentro.
      data-reticle-label="AGGIUNGI"
      className="add-project-card group relative flex h-full w-full flex-col gap-2.5 overflow-hidden bg-transparent p-4 text-left md:p-5"
    >
      {/* Intestazione: stesso marcapunto `[…]` e stesso mono 9px delle card
          vere. A destra non c'è un anno ma `[ORA]`, che dice la stessa cosa in
          un altro modo — questa card non è ancora databile. */}
      <span className="flex shrink-0 items-center justify-between gap-2 font-mono text-[9px] tracking-widest text-swiss-pink">
        <span>[EXP.07]</span>
        <span>[ORA]</span>
      </span>

      {/* Il corpo cresce per mettere il '+' al centro vero del box, non a un
          terzo: `flex-1` sul blocco centrale e `justify-center` dentro. Il
          '+' è sottile (`font-light`) e enormous: 32% della larghezza della
          card, così da lontano è una forma e da vicino è un segno. */}
      <span className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
        <span
          aria-hidden="true"
          className="add-project-card__plus block select-none font-display font-light leading-none text-accent"
        >
          +
        </span>
        <span className="add-project-card__lead block font-display font-extrabold leading-[0.95] tracking-tight text-accent">
          Aggiungi il tuo progetto qui
        </span>
        <span className="add-project-card__sub block font-mono text-[9px] leading-[1.4] text-swiss-pink/55">
          Il prossimo case study potrebbe essere il tuo.
        </span>
      </span>

      {/* Piè di card: stessa grammatica di `[ESPLORA IL CASO ↗]`, stessa classe
          di grouping sulla freccia, così l'hover sposta l'icona esattamente
          come nelle card vere. Il testo cambia, la forma no. */}
      <span className="flex shrink-0 items-center gap-1 self-start font-mono text-[10px] tracking-widest text-swiss-pink">
        [AVVIA UN PROGETTO
        <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        ]
      </span>
    </button>
  );
}
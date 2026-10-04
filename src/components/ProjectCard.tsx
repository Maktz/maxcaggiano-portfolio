import type { Project } from '@/data/projects';
import { ArrowUpRight } from 'lucide-react';
import KineticText from './KineticText';
import { reactAvatar } from '@/lib/avatarReactions';

interface ProjectCardProps {
  project: Project;
  index: number;
  onOpen: () => void;
}

// Card presentabili, in formato VERTICALE 3:4 (larghezza guida l'altezza via
// aspect-ratio impostato dal wrapper in ProjectsScene). L'entrata è
// scroll-driven e gestita dal wrapper genitore: qui vivono solo i contenuti.
export default function ProjectCard({ project, onOpen }: ProjectCardProps) {
  return (
    <div
      // `data-reticle-label`: la micro-label del cursore su questa card. Vive
      // qui e non in un foglio di stile perche' e' contenuto, non stile — e il
      // reticolo la legge con `closest`, quindi dichiararla sull'elemento che
      // si clicca e' l'unico modo che resti vero anche se la card cambia
      // aspetto. `[ESPLORA]` e non `[VAI]`: la card non porta da nessuna
      // parte, apre il case study, ed e' quello che il testo dice gia' in
      // fondo.
      data-reticle-label="ESPLORA"
      // Le STELLINE stanno sul click della card intera, non solo sul bottone in
      // fondo: la card e' cliccabile per tutta la sua superficie, e reagire solo
      // al bottone direbbe che il resto non e' un bersaglio mentre lo e'. Il
      // bottone chiama `onOpen` e ferma la propagazione, quindi senza questa
      // riga reagirebbe due volte — e con la regola del timer, due volte vuol
      // dire un allungamento invece di una reazione sola.
      onClick={() => {
        reactAvatar('stars');
        onOpen();
      }}
      // `works-card`: la stessa regola che accende le stazioni del metodo, qui
      // applicata a `is-lit` quando la card atterra al suo slot (vedi
      // `ProjectsScene`). Il bordo parte da `grid-wireframe` come tutte le
      // card chiuse e diventa giallo quando è arrivata — stesso gesto del razzo
      // che raggiunge una tappa, non un colore nuovo.
      className="works-card grid-wireframe bg-dark-green p-4 md:p-5 flex flex-col gap-2.5 cursor-pointer hover:bg-dark-green transition-colors h-full overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 font-mono text-[9px] tracking-widest text-swiss-pink shrink-0">
        <span>[{project.code}]</span>
        <span className="truncate">[{project.year}]</span>
      </div>

      {/* KineticText tiene il titolo su UNA riga sola (ogni lettera è un
          inline-block dentro un nowrap): il min-content del titolo è quindi
          l'intera riga, e su una card da 300px il titolo più lungo
          (CHROMATIC PROTOCOL, 293px a 25.6px) farebbe crescere il flex item
          oltre la larghezza contratta, portando la card a 335px e rompendo
          l'aspect 3:4 e il passo di 360px fra gli slot.
          Per questo la misura è la classe .works-card-title, che legge la
          LARGHEZZA DELLA CARD invece di un breakpoint dello schermo: sta sotto
          la larghezza utile a ogni viewport (a 1440 → 21.6px → 247px in 258px
          utili; a 900, dove la card è al minimo 260px → 18.7px → 214px in
          226px). Un font-size fisso andrebbe bene solo a una delle due
          estremità, e il problema ricomparirebbe a ogni viewport nuova. */}
      <KineticText
        as="h3"
        className="works-card-title font-display font-extrabold leading-[0.9] tracking-tight text-accent cursor-pointer"
      >
        {project.title}
      </KineticText>

      {/* In card verticale il respiro verticale è la risorsa scarsa: i tag
          scendono a una riga sola e il brief accorcia, così la gerarchia resta
          leggibile senza far crescere la card oltre il suo aspect. */}
      <div className="flex flex-wrap gap-1 shrink-0">
        {project.tags.map((tag) => (
          <span key={tag} className="font-mono text-[8px] border border-swiss-pink/40 px-1.5 py-0.5 text-swiss-pink">
            [{tag}]
          </span>
        ))}
      </div>

      <div className="bg-dark-green px-3 py-2 inline-block self-start shrink-0">
        <span className="font-mono text-sm font-bold tracking-wider text-swiss-pink">
          {project.kpi}
        </span>
      </div>

      <p className="font-mono text-[10px] leading-[1.5] text-swiss-pink flex-1 min-h-0 overflow-hidden">
        {project.brief}
      </p>

      {/* `stopPropagation` ferma l'evento prima che arrivi alla card, e quindi
          anche la sua reazione: il click sul bottone non deve far reagire il
          viso due volte. Lo stesso gesto arriva al bus una volta sola, dal
          bottone. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          reactAvatar('stars');
          onOpen();
        }}
        className="group/btn flex items-center gap-1 font-mono text-[10px] tracking-widest text-swiss-pink transition-colors self-start shrink-0"
      >
        [ESPLORA IL CASO
        <ArrowUpRight className="w-3 h-3 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" />
        ]
      </button>
    </div>
  );
}

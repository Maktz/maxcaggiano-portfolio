import type { Project } from '@/data/projects';
import { ArrowUpRight } from 'lucide-react';
import KineticText from './KineticText';

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
      className="grid-wireframe bg-dark-green p-4 md:p-5 flex flex-col gap-2.5 cursor-pointer hover:bg-dark-green transition-colors h-full overflow-hidden"
      onClick={onOpen}
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

      <button
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className="group/btn flex items-center gap-1 font-mono text-[10px] tracking-widest text-swiss-pink transition-colors self-start shrink-0"
      >
        [ESPLORA IL CASO
        <ArrowUpRight className="w-3 h-3 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" />
        ]
      </button>
    </div>
  );
}

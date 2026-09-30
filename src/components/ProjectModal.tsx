import { motion } from 'framer-motion';
import { useEffect } from 'react';
import type { Project } from '@/data/projects';
import { ArrowLeft, ArrowUpRight, X } from 'lucide-react';
import KineticText from './KineticText';

interface ProjectModalProps {
  project: Project;
  onClose: () => void;
}

export default function ProjectModal({ project, onClose }: ProjectModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      // data-lenis-prevent: lo scroll interno della scheda resta nativo e non
      // viene né intercettato da Lenis né impaginato dal paging.
      data-lenis-prevent
      className="fixed inset-0 z-[70] bg-canvas overflow-y-auto"
    >
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="sticky top-0 z-50 bg-dark-green px-4 md:px-8 py-4 flex items-center justify-between"
      >
        <button onClick={onClose} className="group flex items-center gap-2 font-mono text-xs md:text-sm tracking-widest text-swiss-pink hover:text-swiss-pink transition-colors">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          [TORNA AI PROGETTI]
        </button>
        <button onClick={onClose} className="text-swiss-pink hover:text-swiss-pink transition-colors">
          <X className="w-5 h-5" />
        </button>
      </motion.div>

      <div className="px-4 md:px-8 py-8 md:py-16">
        <div className="grid-master mb-8 md:mb-12">
          <div className="col-span-4 md:col-span-12 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <div className="font-mono text-xs tracking-widest text-swiss-pink mb-2">
                [{project.code} // {project.year} // {project.client}]
              </div>
              <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6 }}>
                <KineticText as="h1" className="font-display font-extrabold text-5xl md:text-7xl lg:text-8xl leading-[0.85] tracking-tight text-accent cursor-pointer">
                  {project.title}
                </KineticText>
              </motion.div>
            </div>
            <div className="bg-dark-green px-5 py-4 inline-block self-start md:self-end">
              <span className="font-mono text-base md:text-lg font-bold tracking-wider text-swiss-pink">{project.kpi}</span>
            </div>
          </div>
        </div>

        <div className="grid-master mb-12 md:mb-16">
          {[
            { label: 'CLIENTE', value: project.client },
            { label: 'RUOLO', value: project.role },
            { label: 'TEMPISTICA', value: project.timeline },
            { label: 'CONSEGNE', value: project.deliverables.join(', ') },
          ].map((row, i) => (
            <motion.div key={row.label} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.08, duration: 0.5 }}
              className="col-span-4 md:col-span-12 grid grid-cols-2 md:grid-cols-12 gap-4 border-b border-swiss-pink/20 py-4">
              <span className="col-span-1 md:col-span-2 font-mono text-[10px] md:text-xs tracking-widest text-swiss-pink">{row.label}:</span>
              <span className="col-span-1 md:col-span-10 font-mono text-xs md:text-sm text-swiss-pink font-bold">{row.value}</span>
            </motion.div>
          ))}
        </div>

        <div className="grid-master mb-12 md:mb-16">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.6 }} className="col-span-4 md:col-span-8">
            <div className="font-mono text-xs tracking-widest text-swiss-pink mb-4">[DICHIARAZIONE DI DIREZIONE ARTISTICA]</div>
            <p className="font-display text-xl md:text-2xl leading-relaxed text-accent">{project.strategy}</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.6 }} className="col-span-4 md:col-span-4 md:col-start-9">
            <div className="font-mono text-xs tracking-widest text-swiss-pink mb-4">[TAG]</div>
            <div className="flex flex-wrap gap-2">
              {project.tags.map((tag) => (
                <span key={tag} className="font-mono text-[10px] tracking-widest border border-swiss-pink/40 px-2 py-1 text-swiss-pink">[{tag}]</span>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="grid-master mb-12 md:mb-16">
          <div className="col-span-4 md:col-span-12 font-mono text-xs tracking-widest text-swiss-pink mb-6">[GALLERIA]</div>
          {project.galleryImages.map((img, i) => (
            <motion.div key={i} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 + i * 0.15, duration: 0.6 }}
              className={`col-span-4 ${i === 0 ? 'md:col-span-8' : i === 1 ? 'md:col-span-4' : 'md:col-span-12'} grid-wireframe overflow-hidden bg-dark-green/30`}>
              <img src={img} alt={`${project.title} visual ${i + 1}`} loading="lazy" className="w-full h-full object-cover aspect-[16/10] md:aspect-auto" />
            </motion.div>
          ))}
        </div>

        <div className="grid-master mb-12 md:mb-16">
          <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.6 }} className="col-span-4 md:col-span-12 bg-dark-green p-8 md:p-16">
            <div className="font-mono text-xs tracking-widest text-swiss-pink mb-6 md:mb-8">[METRICHE]</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
              {project.metrics.map((m, i) => (
                <div key={i}>
                  <div className="font-display font-extrabold text-5xl md:text-7xl lg:text-8xl leading-none text-accent">{m.value}</div>
                  <div className="font-mono text-[10px] md:text-xs tracking-widest text-swiss-pink mt-3">{m.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="grid-master">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.5 }} className="col-span-4 md:col-span-12 flex justify-center">
            <a href={project.liveUrl} target="_blank" rel="noopener noreferrer"
              className="group flex items-center gap-3 bg-dark-green text-swiss-pink font-mono text-sm md:text-base tracking-widest px-8 md:px-12 py-4 md:py-5 hover:bg-dark-green hover:text-swiss-pink border border-swiss-pink transition-colors">
              [APRI L'ESPERIENZA LIVE
              <ArrowUpRight className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
              ]
            </a>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

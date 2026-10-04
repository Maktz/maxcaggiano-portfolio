import type { MotionValue } from 'framer-motion';
import TransmissionButton from './TransmissionButton';
import Reveal from './Reveal';
import {
  MISSION_CARD_LABEL,
  MISSION_HEADLINE,
  MISSION_LABEL,
  MISSION_PARAGRAPHS,
  MISSION_ROWS,
} from '@/data/mission';
import { useSmoothScroll } from '@/providers/smoothScrollContext';
import { readSceneTop } from '@/lib/scrollMath';

// LA SEZIONE «CHI SONO».
//
// Due colonne su schermo largo, impilate sotto `md` con il testo PRIMA e la
// scheda dopo: su 360px la griglia a due colonne darebbe due righe di 150px, e
// il testo in mono a quella larghezza diventerebbe un muro. L'ordine inverso
// (scheda prima) metterebbe una tabella prima di sapere di chi si parla.
//
// La scheda è `bg-dark-green` con `grid-wireframe`, cioè lo stesso fondale e lo
// stesso bordo delle card lavori: è un riquadro chiuso dello stesso genere, e
// un'altra resa renderebbe la pagina meno coerente di quanto sembri.
//
// IL TITOLO NON USA `KineticText`, e la ragione sta nel componente: ogni
// lettera è un `inline-block` dentro un `whitespace-nowrap`, quindi il titolo
// resterebbe su UNA riga sola e su 360px uscirebbe dal riquadro. Works e
// Let's Build hanno titoli corti e possono permetterselo; qui il titolo è una
// frase e deve andare a capo. Il resto della grammatica — slab, extrabold,
// giallo, `tracking-tight` — è identica.
//
// Il bottone in fondo è `TransmissionButton`, lo stesso componente del preloader
// e del form: il testo passa come `PARLIAMONE` e il componente aggiunge le
// parentesi e la freccia, quindi qui non può esserci un refuso.
export default function AboutScene({ scrollY }: { scrollY: MotionValue<number> }) {
  const { lenis } = useSmoothScroll();

  // Il bottone scorre la pagina fino a COSTRUIAMO con LENIS e non con
  // `window.scrollTo`: il moto lo governa l'istanza unica del provider, e un
  // scroll nativo taglierebbe la coda a metà e lascerebbe la pagina indietro di
  // qualche decina di pixel rispetto a dove Lenis crede di essere.
  const scrollToContact = () => {
    const contactTop = readSceneTop('contact');
    if (contactTop > 0) lenis.scrollTo(contactTop);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-[var(--page-gutter)] py-20 md:py-28 lg:flex-row lg:items-start lg:gap-16">
      {/* COLONNA DI TESTO. `lg:flex-1` e non una griglia con `1fr 1fr`: il testo
          è l'elemento che non deve mai essere stretto, e con due colonne
          uguali la scheda — che ha una riga lunga in DISCIPLINE — finirebbe
          per deciderla lei. */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Reveal scrollY={scrollY} scene="about" index={0}>
          <span className="font-mono text-[10px] tracking-widest text-swiss-pink/70">
            {MISSION_LABEL}
          </span>
        </Reveal>

        <Reveal scrollY={scrollY} scene="about" index={1}>
          {/* `clamp` e non una vw: il titolo sta su due righe in desktop e su
              tre a 360px, e una vw sola farebbe o un titolo minuscolo o un
              titolo che sfora dagli schermi. I due estremi sono i viewport
              reali del progetto, non dei numeri arrotondati. */}
          <h2 className="text-left font-display font-extrabold leading-[0.92] tracking-tight text-accent [font-size:clamp(2rem,7.2vw,4.4rem)]">
            {MISSION_HEADLINE}
          </h2>
        </Reveal>

        {MISSION_PARAGRAPHS.map((paragraph, index) => (
          <Reveal key={paragraph} scrollY={scrollY} scene="about" index={index + 2}>
            <p className="max-w-[54ch] font-mono text-[12px] leading-[1.75] text-swiss-pink md:text-[13px]">
              {paragraph}
            </p>
          </Reveal>
        ))}
      </div>

      {/* LA SCHEDA MISSIONE. `lg:w-[22rem] lg:shrink-0`: larghezza fissa in
          desktop, così le righe chiave/valore hanno sempre la stessa lunghezza
          e la scheda non respira a ogni parola. Sotto `lg` è larga quanto
          il contenitore. */}
      <Reveal
        scrollY={scrollY}
        scene="about"
        index={2}
        className="w-full lg:w-[22rem] lg:shrink-0"
      >
        <div className="grid-wireframe flex flex-col bg-dark-green">
          <span className="shrink-0 border-b border-swiss-pink/20 px-5 py-3 font-mono text-[9px] tracking-widest text-swiss-pink/70 md:px-6">
            {MISSION_CARD_LABEL}
          </span>

          {/* Le righe: chiave sopra, valore sotto, separate da un filetto. Il
              filetto è `border-b` e non una riga disegnata, perché su una
              scheda che cambia larghezza è il bordo a restare fermo mentre il
              testo va a capo. `last:` lo toglie dall'ultima riga: una riga
              finale con un filetto sotto chiuderebbe la scheda due volte. */}
          <dl className="flex flex-col">
            {MISSION_ROWS.map((row, index) => (
              <div
                key={row.key}
                className={`flex flex-col gap-1.5 px-5 py-4 md:px-6 ${
                  index === MISSION_ROWS.length - 1 ? '' : 'border-b border-swiss-pink/15'
                }`}
              >
                <dt className="font-mono text-[9px] tracking-widest text-swiss-pink/60">
                  {row.key}
                </dt>
                <dd className="font-mono text-[12px] leading-[1.5] text-swiss-pink md:text-[13px]">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex justify-start border-t border-swiss-pink/20 px-5 py-5 md:px-6">
            {/* Le varianti `max-sm:` e NON le classi semplici: il bottone porta
                già `px-8 py-4 text-sm` nella sua stringa, e due utility dello
                stesso gruppo nella stessa stringa si risolvono nell'ordine in
                cui sono state generate, non in quello in cui sono scritte.
                Le varianti con media query sono regole a sé e vincono. */}
            <TransmissionButton
              label="PARLIAMONE"
              onClick={scrollToContact}
              className="max-sm:gap-2 max-sm:px-5 max-sm:py-3 max-sm:text-[11px]"
            />
          </div>
        </div>
      </Reveal>
    </div>
  );
}

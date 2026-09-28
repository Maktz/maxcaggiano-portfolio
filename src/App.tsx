import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useTransform,
} from 'framer-motion';
import Header from '@/components/Header';
import EntrySequence from '@/components/EntrySequence';
import LogoLayer from '@/components/LogoLayer';
import PreloaderScene from '@/components/PreloaderScene';
import HeroScene from '@/components/HeroScene';
import ParticleNebulaCanvas from '@/components/ParticleNebulaCanvas';
import NebulaScene from '@/components/NebulaScene';
import ProjectsScene from '@/components/ProjectsScene';
import ContactScene from '@/components/ContactScene';
import ProjectModal from '@/components/ProjectModal';
import { useMagnetStages } from '@/hooks/useMagnetStages';
import { useSmoothScroll } from '@/providers/smoothScrollContext';
import {
  clamp01,
  phase,
  readSceneTop,
  smoothstep,
} from '@/lib/scrollMath';
import { isSkipEntry } from '@/lib/entryState';
import { lockScroll } from '@/lib/scrollLock';
import { useProjects } from '@/hooks/useProjects';
import { COORD_MILANO, COORD_POTENZA, COORD_VIA_LATTEA } from '@/lib/entryCopy';

// Telemetria, valori in gradi.
// VIA LATTEA = Sagittarius A*, il nucleo galattico. Coordinate prese da
// Wikipedia (epoch J2000, ICRS): RA 17h 45m 40.0409s e Dec -29 0' 28.118",
// convertite in gradi decimali.
// PIANETA TERRA = posizione eliocentrica della Terra all'equinozio J2000.0,
// che e' l'origine del sistema equatoriale: da li' i numeri convergono a zero,
// che e' esattamente la lettura dello zoom (dalla galassia al pianeta).
const GALAXY_RA = 266.4168;
const GALAXY_DEC = -29.0078;
const EARTH_RA = 0;
const EARTH_DEC = 0;
const GALAXY_LABEL = 'VIA LATTEA';
const EARTH_LABEL = 'PIANETA TERRA';

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

// Scena attiva: l'ultima il cui bordo superiore e' gia' superato, quindi i
// confronti vanno dal fondo alla testa. readSceneTop restituisce 0 per una
// sezione assente e 0 vincerebbe il confronto, quindi la guardia serve:
// senza, una sezione mancante collasserebbe la scena attiva sull'ultima.
const stageIndexAt = (scrollY: number) => {
  const contact = readSceneTop('contact');
  const works = readSceneTop('works');
  const nebula = readSceneTop('nebula');
  const hero = readSceneTop('hero');
  if (!contact || !works || !nebula || !hero) return 0;
  if (scrollY >= contact - 1) return 4;
  if (scrollY >= works - 1) return 3;
  if (scrollY >= nebula - 1) return 2;
  if (scrollY >= hero - 1) return 1;
  return 0;
};

export default function App() {
  const [activeStage, setActiveStage] = useState(0);
  const [activeProject, setActiveProject] = useState<number | null>(null);
  // I progetti arrivano da Sanity, ma l'app continua a non saperne nulla: qui
  // sotto ci sono gli stessi `Project` di prima, con la stessa forma. Finche'
  // Sanity non risponde restano i dati statici, quindi la Works si compone
  // esattamente come prima e non c'e' nessun salto di layout al primo arrivo.
  const { projects } = useProjects();
  // Sorgente unica di verità: la posizione fluida di Lenis, non il
  // window.scrollY nativo. Tutte le scene ricevono questi stessi valori.
  const { scrollY, lenis } = useSmoothScroll();
  // Segnale di 'posizionamento gia' fatto' per l'ingresso diretto (?skip).
  // Vive in una ref perche' deve sopravvivere al doppio montaggio di
  // StrictMode: con uno useState, il cleanup del primo effetto azzererebbe il
  // flag proprio mentre il secondo mount sta per sistemare la pagina.
  const doneRef = useRef(false);
  // La visibilita' dell'header non e' piu' qui: la fascia e' governata dallo
  // stato d'ingresso dentro Header, perche' dipende dal pulsante e non dallo
  // scroll. Qui resta solo la scena attiva, che invece e' ancora una funzione
  // della quota e vive nel RAF condiviso con le altre scene.

  // Visibilita' dell'header e scena attiva stavano nello stesso ascoltatore:
  // entrambe sono una funzione della quota, quindi due cambi della stessa
  // MotionValue avrebbero solo fatto due letture e due confronti in piu'.
  // Adesso ne resta uno solo.
  useMotionValueEvent(scrollY, 'change', (value) => {
    const nextStage = stageIndexAt(value);
    setActiveStage((current) => (current === nextStage ? current : nextStage));
  });

  // BLOCCO DELLO SCROLL FINO A FINE SEQUENZA.
  //
  // Finche' lo stato e' `preloader` lo scroll resta fermo: non si esce piu'
  // scrollando, si esce premendo il pulsante. Il blocco parte qui, al mount di
  // App, e non dentro il preloader perche' e' una condizione della pagina
  // intera e deve valere anche se il preloader non e' ancora impaginato.
  //
  // Con `?skip` non si blocca niente: lo stato e' gia' `hero` (lo mette
  // entryState all'import del modulo, vedi isSkipEntry) e si entra diretti
  // nella prima pagina. Serve in sviluppo per non attendere la sequenza a
  // ogni reload mentre si lavora a una sezione a valle.
  useEffect(() => {
    if (!isSkipEntry()) {
      lockScroll();
      // Niente cleanup: lo sblocco NON e' la fine del montaggio, e' la fine
      // della sequenza. Smontare qui lascerebbe lo scroll congelato per sempre.
      return;
    }
    // Anche in skip il preloader resta nel flusso (l'offset delle sezioni
    // successive deve restare quello di sempre), ma il suo contenuto e'
    // nascosto: senza questo l'utente si troverebbe davanti a una banda vuota
    // invece che sulla prima pagina, che e' l'unica cosa che il flag deve fare.
    //
    // La quota si rilettura sul frame successivo e non subito: quando questo
    // effetto gira React ha appena committato il DOM, ma `main` non e' ancora
    // impaginato e `readSceneTop` restituisce 0. Con 0 lo spostamento non
    // verrebbe eseguito e l'utente resterebbe davanti al preloader vuoto,
    // cioe' esattamente cio' che il flag deve evitare.
    const settle = () => {
      const heroTop = readSceneTop('hero');
      if (heroTop <= 0) return false;
      lenis.scrollTo(heroTop, { immediate: true });
      return true;
    };
    // `lenis.resize()` prima di leggere: e' lui che rimisura i limiti dello
    // scroll sul DOM appaginato, altrimenti si leggerebbe il massimo vecchio
    // (il solo preloader) e lo zero sarebbe fuori bersaglio.
    lenis.resize();
    if (settle()) return;

    // Si riprova per qualche frame e poi su un timeout: in sviluppo React
    // monta due volte (StrictMode) e i font possono arrivare dopo, quindi la
    // sezione puo' avere la sua altezza definitiva solo piu' tardi.
    //
    // Lo stato dei tentativi vive in una REF, non in una variabile del
    // montaggio. In StrictMode il primo effetto viene ripulito e il secondo
    // rimontato: con una variabile locale, il cleanup cancellerebbe i frame
    // appena schedulati e il secondo mount ripartirebbe da `done = false`
    // senza sapere che l'altro aveva gia' concluso. Con la ref il lavoro e'
    // uno solo ed e' visibile a entrambi i montaggi.
    doneRef.current = false;
    const attempt = () => {
      if (doneRef.current) return;
      doneRef.current = settle();
    };
    const frames = [
      window.requestAnimationFrame(attempt),
      window.requestAnimationFrame(attempt),
      window.setTimeout(attempt, 120),
      window.setTimeout(attempt, 400),
    ];
    // Il cleanup annulla SOLO i frame di questo montaggio, e non azzera il
    // flag: annullarli e' obbligatorio (sennon uno arriva quando il
    // componente non c'e' piu'), azzerare il flag no (perche' al rimonto la
    // pagina potrebbe essere ancora da sistemare).
    return () => {
      window.cancelAnimationFrame(frames[0]);
      window.cancelAnimationFrame(frames[1]);
      window.clearTimeout(frames[2]);
      window.clearTimeout(frames[3]);
    };
  }, [lenis]);

  const handleOpenProject = useCallback((index: number) => setActiveProject(index), []);
  const handleCloseProject = useCallback(() => setActiveProject(null), []);

  // Coppia geografica: entra sull'ingresso dell'Hero (il fade e' sulla coda del
  // preloader) e resta per tutta la pagina, Works e Transmission incluse: e'
  // l'unico riferimento geografico del sito, quindi non ha senso farla sparire.
  const geoOpacity = useTransform(scrollY, (value) => {
    const hero = document.querySelector<HTMLElement>('[data-scene="hero"]');
    if (!hero) return 0;
    const lead = hero.offsetHeight * 0.12;
    return smoothstep(phase(value, hero.offsetTop - lead, hero.offsetTop));
  });

  // Telemetria: la posizione si scioglie dalla Via Lattea alla Terra mentre si
  // attraversa la nebulosa. Finestra ancorata agli stop reali (fine dello SVG ->
  // griglia completa): a nebulaTop l'SVG e' sparito e la sagoma e' centrata, a
  // worksTop la griglia e' composta. Finche' l'SVG c'e', si mostra la Via Lattea.
  const telemetryMix = useTransform(scrollY, (value) => {
    const nebula = document.querySelector<HTMLElement>('[data-scene="nebula"]');
    const works = document.querySelector<HTMLElement>('[data-scene="works"]');
    if (!nebula || !works) return 0;
    return phase(value, nebula.offsetTop, works.offsetTop);
  });
  // Telemetria: un solo elemento, nessun fade. Le cifre scorrono in continuo
  // lungo tutto il viaggio nella nebulosa e l'etichetta cambia una volta sola,
  // a meta' percorso, dentro lo stesso testo. Prima le due etichette erano due
  // span sovrapposti con opacita' complementari: a meta' scorrimento nessuna
  // delle due era piena, e quel passaggio si leggeva come un fade.
  const telemetryOpacity = useTransform(scrollY, (value) => {
    const hero = document.querySelector<HTMLElement>('[data-scene="hero"]');
    if (!hero) return 0;
    const lead = hero.offsetHeight * 0.12;
    return smoothstep(phase(value, hero.offsetTop - lead, hero.offsetTop));
  });
  // I numeri si interpolano scrivendo direttamente textContent: un setState per
  // frame farebbe un render di React a ogni frame dello scroll, e qui il valore
  // cambia a ogni pixel.
  const telemetryLineRef = useRef<HTMLSpanElement>(null);
  useMotionValueEvent(telemetryMix, 'change', (mix) => {
    const node = telemetryLineRef.current;
    if (!node) return;
    const m = clamp01(mix);
    const a = lerp(GALAXY_RA, EARTH_RA, m);
    const b = lerp(GALAXY_DEC, EARTH_DEC, m);
    const label = m < 0.5 ? GALAXY_LABEL : EARTH_LABEL;
    node.textContent = `[${label} - ${a.toFixed(4)}, ${b.toFixed(4)}]`;
  });

  // Calamita: sotto l'esplosione delle particelle la transizione fra stop va
  // guadagnata con un gesto deciso (un colpo debole rimbalza indietro); da lì in
  // poi lo scroll è libero. Tutte le scene, canvas fisso incluso, leggono la
  // stessa MotionValue e vengono aggiornate dall'unico RAF del provider.
  useMagnetStages();

  return (
    <div className="w-full bg-canvas">
      <Header activeSection={activeStage} />

      {/* Marchio volante e orchestratore, qui subito dopo l'header e prima di
          tutto il resto. Lo stesso posto che occupa #portrait-logo-layer: un
          nodo che attraversa la pagina non puo' vivere dentro una sezione con
          transform o overflow, perche' quelli lo trasformerebbero insieme a
          lui invece di restare fermi.

          L'ordine conta solo per la lettura del DOM: l'header e' z-50, il
          layer del marchio z-60, quindi il nome viaggia SOPRA la fascia e non
          dietro il suo sfondo opaco. */}
      <LogoLayer />
      <EntrySequence />

      <ParticleNebulaCanvas />

      <main>
        {/* Il preloader occupa ancora una viewport nel flusso, come prima: e' la
            sezione che il Passo 7 rimuoverà dal DOM a fine sequenza. Finché
            resta, il suo offset è ciò che tiene l'hero a una viewport da zero,
            e i trigger delle sezioni successive continuano a misurarlo senza
            cambiare nulla. */}
        <section
          data-scene="preloader"
          className="relative z-10 h-screen w-full overflow-hidden bg-transparent"
        >
          {/* Nessun `onEnter`: la sequenza si avvia quando lo stato passa a
              `entering`, e lo stato lo imposta il click del pulsante dentro
              PreloaderScene. Un secondo canale di avvio sarebbe una seconda
              fonte di verita' su quando la sequenza parte. */}
          <PreloaderScene />
        </section>

        {/* Il secondo viewport contiene esclusivamente l'SVG e il suo reveal pulito.
            NESSUN z-index su questa sezione, ed e' deliberato: `relative z-10`
            creerebbe uno stacking context che sigilla l'intero hero sotto
            l'header (z-50), e il ritratto che diventa marchio non potrebbe mai
            arrivare nella fascia dell'header senza finire dietro al suo sfondo
            opaco. Tolto lo z-index, i figli competono al livello radice e il
            ritratto puo' alzarsi a z-60 quando e' ormai un logo. Il contenitore
            del ritratto e' gia' `fixed inset-0` e la sezione non ha transform,
            quindi il suo `overflow-hidden` non clippa nulla. */}
        <section
          data-scene="hero"
          className="relative h-screen w-full overflow-hidden bg-transparent"
        >
          <HeroScene scrollY={scrollY} />
        </section>

        {/* Un solo viewport di esperienza: dalla sagoma stabile al Works la camera
            percorre Z e tutto il movimento dipende 1:1 dai pixel di scroll. */}
        <section
          data-scene="nebula"
          className="relative z-10 h-screen w-full overflow-hidden bg-transparent"
        >
          <NebulaScene scrollY={scrollY} />
        </section>

        {/* La Works contiene quattro fasi consecutive: la NASCITA (lo strip
            e' fermo a birthOffset e la card 1 arriva da sola al centro), la
            CORSA (lo strip avanza di uno step per ogni card che atterra, a
            velocita' costante), la SALITA (lo strip e' fermo a `travel`: le
            card salgono e NON cambiano la loro posizione orizzontale, la scena
            sale di un viewport) e lo SBLOCCO, in cui la Works esce tagliata
            dal bordo superiore e la sezione successiva sale dal basso.
            L'altezza NON e' un multiplo di viewport: e' la somma dei quattro
            tratti in px, calcolata in JS dalla striscia reale (ProjectsScene,
            RACE_SPAN_RATIO / RISE_SPAN_RATIO), perche' i tratti sono definiti
            in px e solo in px possono stare nello spazio giusto. Qui h-[300vh]
            e' solo il fallback del primo paint, prima che la misura sia
            disponibile.
            I marcatori data-snap sono lo stop magnetico: works-start e'
            l'ingresso in Works, works-raced il punto in cui tutte e sei le card
            sono a fuoco (a birthSpan + raceSpan, non a raceSpan: la corsa non
            parte da worksTop). Entrambi sono posizionati in px da
            ProjectsScene, che scrive l'altezza della sezione e i due confini
            di fase: i due non possono divergere per costruzione.
            Questa sezione non sa nulla di quella dopo: calcola solo il proprio
            offsetTop e la propria altezza, quindi aggiungere una sezione fra
            Works e Let's Build non ne cambia il comportamento. L'unica cosa da
            tenere d'occhio e' lo stop magnetico, gestito in
            SmoothScrollProvider: le sezioni senza marker agganciano dal proprio
            bordo superiore. */}
        <section
          data-scene="works"
          className="relative z-10 h-[300vh] w-full overflow-hidden bg-transparent"
        >
          <div aria-hidden="true" data-snap="works-start" className="absolute left-0 top-0 h-0 w-0" />
          <div aria-hidden="true" data-snap="works-raced" className="absolute left-0 top-0 h-0 w-0" />
          <ProjectsScene
            projects={projects}
            onOpenProject={handleOpenProject}
            scrollY={scrollY}
          />
        </section>

        <section
          data-scene="contact"
          className="relative z-10 h-screen w-full overflow-hidden bg-transparent pt-24"
        >
          <ContactScene />
        </section>
      </main>

      {/* Unica indicazione di sezione: la coppia geografica. Niente piu'
          [00 // PRELOADER] / [01 // HERO] / [02 // NEBULA] ne contatori. */}
      <motion.div
        style={{ opacity: geoOpacity }}
        data-anchor="geo"
        className="pointer-events-none fixed right-[var(--page-gutter)] top-[112px] z-50 hidden text-right font-mono text-xs font-normal leading-[1.35] tracking-widest text-swiss-pink md:block"
        aria-hidden="true"
      >
        <div data-coord="milano">{COORD_MILANO}</div>
        <div data-coord="potenza">{COORD_POTENZA}</div>
      </motion.div>
      {/* Telemetria: stessa grammatica del blocco in alto a destra, ma in basso a
          sinistra e allineata alla base degli hint (bottom-10, come loro).
          Un solo <span>: le cifre scorrono in continuo e l'etichetta si
          sostituisce una volta sola a meta' percorso, senza dissolvenze.

          `var(--page-gutter)` e non un numero: telemetria, blocco geografico e
          marchio dell'header stanno sulla stessa griglia, e solo se il valore
          e' uno solo restano allineati. Sotto md questo blocco e' hidden, ma il
          filo dichiarato in index.css vale comunque per il marchio. */}
      <motion.div
        style={{ opacity: telemetryOpacity }}
        data-anchor="telemetry"
        className="pointer-events-none fixed bottom-10 left-[var(--page-gutter)] z-50 hidden whitespace-nowrap font-mono text-xs font-normal leading-[1.35] tracking-widest text-swiss-pink md:block"
        aria-hidden="true"
      >
        <span ref={telemetryLineRef} data-coord="via-lattea">{COORD_VIA_LATTEA}</span>
      </motion.div>
      <AnimatePresence>
        {/* La guardia sull'indice serve perché l'array dei progetti non è più
            una costante: se Sanity restituisce meno voci di quelle che la Works
            ha mostrato, l'indice salvato potrebbe non esistere più, e
            `projects[i]` undefined farebbe esplodere il render del modal. In
            quel caso non si apre nulla. */}
        {activeProject !== null && projects[activeProject] && (
          <ProjectModal project={projects[activeProject]} onClose={handleCloseProject} />
        )}
      </AnimatePresence>
    </div>
  );
}

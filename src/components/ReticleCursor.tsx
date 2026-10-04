// IL RETICOLO.
//
// Un cursore che e' un pezzetto di strumento di bordo: un punto, due parentesi
// quadre che lo seguono con ritardo, e una micro-label che dice cosa sta
// guardando. La stessa grammatica delle label `[…]` gia' sparse nella pagina,
// che e' il motivo per cui non sembra un elemento estraneo.
//
// TRE PEZZI, TRE FILE.
//
// Il DOM e' qui, il CSS e' in index.css (come tutti gli altri gesti della
// pagina) e la polvere del click e' in reticleDust. Nessuno dei tre conosce gli
// altri due: il componente parla al CSS con classi e al canvas con una funzione,
// e non ha bisogno di sapere come sono fatti dentro.
//
// LA MOLLA.
//
// Le parentesi inseguono il mouse con un ritardo piccolo e costante, e quando
// inquadrano un elemento passano a una molla vera. Il ritardo e' un lerp e la
// molla e' un'integrazione: due sistemi diversi per due comportamenti diversi,
// non un ease unico che fa entrambi male.
//
// IL CURSORE NATIVO.
//
// `cursor: none` e' dichiarato in index.css sotto `html[data-reticle='on']`, e
// l'attributo c'e' SOLO quando il reticolo e' davvero vivo e dentro la finestra.
// Se il mouse esce, se la tab perde il focus o se il dispositivo non ha un
// puntatore fine, l'attributo sparisce e il cursore nativo torna: un reticolo che
// sparisce e si lascia dietro un'area senza cursore e' un difetto peggiore di non
// avere il reticolo.

import { useEffect, useRef, useState } from 'react';
import { reducedMotion } from '@/lib/motionPreference';
import { burst } from '@/lib/reticleDust';

/** Lato del reticolo a riposo, in px. Le parentesi quadre grandi quanto questo. */
const IDLE_SIZE = 36;
/** Lato del punto centrale, in px. */
const DOT_SIZE = 8;
/**
 * Quanto le parentesi stringono l'elemento sotto il mouse.
 *
 * Sono px, non una percentuale: su una card da 300px e su un pulsante da 200px
 * la cornice deve stare a distanza uguale dai bordi, e una percentuale
 * allargherebbe la cornice sulle card grandi e la taglierebbe su quelle piccole.
 */
const FRAME_INSET = 10;
/** Quanto il click stringe la cornice sotto il dito, in px. */
const PRESS_INSET = 4;
/** L'altezza della barra del terminale, in px. */
const TERMINAL_BAR_HEIGHT = 22;
/** Quanto la label sta staccata dal bordo destro della cornice, in px. */
const LABEL_GAP = 12;

type HitKind = 'frame' | 'terminal';

interface Hit {
  kind: HitKind;
  /** Il testo della label, gia' con le parentesi. Vuoto = nessuna label. */
  label: string;
  /**
   * L'elemento da incorniciare, o null per lo stato terminale e per lo stato
   * a riposo.
   *
   * E' l'ELEMENTO e non il suo rettangolo, perche' il rettangolo va riletto
   * ogni frame: mentre la Works scorre sotto il mouse, una misura presa al
   * momento del `pointermove` invecchierebbe di decine di pixel e la cornice
   * inseguirebbe un elemento che e' gia' andato via. Il bersaglio invece non
   * cambia, e misurarlo costa una lettura di layout che il frame puo' fare.
   */
  el: HTMLElement | null;
}

/**
 * Che cosa c'e' sotto il mouse, e con che' nome.
 *
 * Si interroga il bersaglio con `closest` invece di elencare i selettori dei
 * bottoni: `closest` sale fino alla radice e restituisce il primo antenato che
 * soddisfa la lista, quindi il bottone dentro la card vince sulla card senza
 * che qui ci sia scritto "controlla prima il bottone".
 *
 * Il campo del form e' un caso a parte e non una variante: su un campo il
 * reticolo non e' piu' un puntatore ma il cursore di un terminale, quindi non
 * ha ne' parentesi ne' label, ha una barra. Viene prima di ogni altra regola
 * perche' dentro un form ci sono anche i bottoni, e li si raggiunge col mouse
 * mentre si scrive.
 */
const readHit = (target: EventTarget | null): Hit => {
  const node = target instanceof Element ? target : null;
  if (!node) return { kind: 'frame', label: '', el: null };

  // Il terminale PRIMA di tutto il resto: dentro un form un input e' un input,
  // e nessun'altra regola deve poterlo trasformare in cornice. Un pulsante
  // dentro un form resta pero' un pulsante, quindi la seconda parte della
  // condizione serve a non spegnere la label dei pulsanti che stanno nella
  // stessa zona.
  const field = node.closest('input, textarea, [data-reticle="terminal"]');
  if (field && !node.closest('button, a[href]')) {
    return { kind: 'terminal', label: '', el: null };
  }

  const found = node.closest<HTMLElement>('[data-reticle-label], a[href], button');
  if (!found) return { kind: 'frame', label: '', el: null };
  // `disabled` si controlla sul bersaglio trovato, non sull'antenato: un
  // bottone disabilitato dentro una card cliccabile e' comunque un bottone che
  // non riceve il click, e dirgli `[VAI]` sarebbe una promessa che il click non
  // mantiene.
  if (found instanceof HTMLButtonElement && found.disabled) {
    return { kind: 'frame', label: '', el: null };
  }
  const explicit = found.dataset.reticleLabel;
  return {
    kind: 'frame',
    label: explicit ? `[${explicit}]` : '[VAI]',
    el: found,
  };
};

/**
 * Un passo di molla su un valore.
 *
 * E' un integratore con attrito esplicito, non una formula chiusa: serve perche'
 * la stessa molla deve poter inseguire un bersaglio che si sposta (il mouse) e
 * uno che e' fermo (una card), e con una formula chiusa i due casi avrebbero due
 * costanti diverse. Con l'integratore basta cambiare il bersaglio.
 *
 * Le costanti sono scelte per un inserimento elastico ma NON rimbalzante: la
 * specifica chiede una "transizione elastica leggera", e una molla vera
 * (sottocritica) a 60fps su un elemento di 300px sborda di 4px e torna in 0.35s
 * — si vede. Qui lo smorzamento e' vicino al critico, quindi arriva veloce e si
 * ferma.
 */
const SPRING_STIFFNESS = 0.24;
const SPRING_DAMPING = 0.74;

interface Spring {
  pos: number;
  vel: number;
}

const stepSpring = (s: Spring, target: number, instant: boolean): void => {
  if (instant) {
    s.pos = target;
    s.vel = 0;
    return;
  }
  s.vel = (s.vel + (target - s.pos) * SPRING_STIFFNESS) * SPRING_DAMPING;
  s.pos += s.vel;
};

const makeSpring = (initial: number): Spring => ({ pos: initial, vel: 0 });

export default function ReticleCursor() {
  // Il punto centrale segue il mouse per INTERO, senza ritardo, ed e' un
  // elemento separato dalle parentesi perche' i due hanno due compiti diversi:
  // il punto e' la posizione esatta, le parentesi sono il reticolo. Metterli
  // nello stesso nodo imporrebbe di scegliere fra esattezza e fluidita'. Il punto
  // e' piccolo, quindi la differenza si vede appena, ma e' quella che rende il
  // punto un punto e non una macchia.
  const dotRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  // Le molle stanno in un ref e non in uno stato: cambiano a ogni frame e uno
  // stato farebbe un render di React per frame, che e' esattamente il costo che
  // un cursore non puo' avere. Il DOM si aggiorna scrivendo il transform.
  const springs = useRef({
    x: makeSpring(0),
    y: makeSpring(0),
    w: makeSpring(IDLE_SIZE),
    h: makeSpring(IDLE_SIZE),
  });
  const mouse = useRef({ x: 0, y: 0 });
  const hit = useRef<Hit>({ kind: 'frame', label: '', el: null });
  const pressing = useRef(false);
  // La label e' l'unica cosa che cambia di testo, e cambia poche volte per
  // visita: merita uno stato, perche' il testo vive nel DOM e il DOM non si
  // aggiorna scrivendogli dentro da un loop.
  const [label, setLabel] = useState('');

  // L'attivazione e' uno stato perche' decide SE il componente esiste, e
  // decidere l'esistenza di un nodo e' lavoro di React. Tutto il resto — la
  // posizione, la molla — non produce mai un render.
  const [active, setActive] = useState(false);
  // `live` e' false quando il mouse esce dalla finestra o la tab perde il
  // focus. Serve a togliere `cursor: none`: senza, il cursore nativo resterebbe
  // nascosto mentre il reticolo non c'e' piu', e la pagina diventerebbe
  // inutilizzabile col mouse.
  const [live, setLive] = useState(false);

  // LA GATE. Il reticolo esiste solo su un puntatore vero: un touchscreen ha un
  // puntatore "coarse" e nessun hover, quindi il reticolo seguirebbe un dito che
  // non c'e' e resterebbe fermo nell'angolo mentre l'utente tocca la pagina. La
  // domanda e' `(hover: hover) and (pointer: fine)` e non due interrogazioni
  // separate: un laptop con touchscreen soddisfa la prima, e con la prima sola
  // si accenderebbe su un dispositivo che non ha un mouse.
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setActive(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // `cursor: none` e' una dichiarazione sul documento, non sul componente: il
  // cursore nativo e' un'affermazione della pagina intera, e metterla sul
  // reticolo la renderebbe dipendente dal fatto che il reticolo sia montato.
  // L'attributo segue `active && live`, quindi si spegne da solo in tutti i casi
  // in cui il reticolo non e' sul mouse.
  useEffect(() => {
    if (!active || !live) {
      delete document.documentElement.dataset.reticle;
      return;
    }
    document.documentElement.dataset.reticle = 'on';
  }, [active, live]);


  // GLI ASCOLTATORI. `pointermove` e non `mousemove`: il primo arriva anche per
  // il contatto e il secondo no, quindi su un ibrido il reticolo seguirebbe
  // l'ultimo dei due eventi senza sapere quale sia stato.
  useEffect(() => {
    if (!active) return;

    const onMove = (event: PointerEvent) => {
      mouse.current.x = event.clientX;
      mouse.current.y = event.clientY;
      // Il bersaglio si sa qui, non nel loop: e' l'evento a dire CHE cosa c'e'
      // sotto il mouse, e farlo nel loop significherebbe interrogare il DOM
      // sessanta volte al secondo. Il RETTANGOLO invece si rilegge nel loop — se
      // la Works sta scorrendo sotto il mouse, la copia ferma fatta qui
      // incornierebbe il vuoto.
      const found = readHit(event.target);
      hit.current = found;
      setLabel((prev) => (prev === found.label ? prev : found.label));
      setLive(true);
    };

    const onDown = () => {
      pressing.current = true;
    };

    const onUp = (event: PointerEvent) => {
      pressing.current = false;
      // La polvere parte sul RILASCIO e non alla pressione: alla pressione il
      // mouse e' ancora fermo sul bersaglio e l'effetto esploderebbe sopra
      // l'elemento per metterlo in evidenza. Al rilascio l'azione e' compiuta,
      // ed e' li' che l'anello deve stare.
      burst(event.clientX, event.clientY);
    };

    // Il mouse che esce dal documento e la tab che perde il focus sono la
    // STESSA cosa per il reticolo: non c'e' piu' nessun puntatore dentro la
    // pagina, quindi il cursore nativo deve tornare. Senza questo, uscire dalla
    // finestra lascerebbe il cursore nascosto e la pagina inutilizzabile.
    const onLeave = () => setLive(false);
    const onEnter = () => setLive(true);
    const onBlur = () => setLive(false);

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    document.documentElement.addEventListener('pointerenter', onEnter);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.documentElement.removeEventListener('pointerenter', onEnter);
      window.removeEventListener('blur', onBlur);
    };
  }, [active]);


  // IL LOOP. Un solo rAF, e gira SOLO mentre il reticolo e' vivo: continuare a
  // scrivere transform su un nodo che non si vede costerebbe un ciclo di
  // rendering a vuoto su una tab in secondo piano, che e' esattamente la spesa
  // che chi ha chiesto meno animazione vuole evitare.
  useEffect(() => {
    if (!active || !live) return;
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const instant = reducedMotion;
      const { x, y, w, h } = springs.current;
      const { el, kind } = hit.current;

      // Il punto segue il mouse per intero, sempre e senza eccezioni: e' la
      // parte che dice dove sta il puntatore, e un punto in ritardo non e' un
      // punto, e' una stima.
      const dot = dotRef.current;
      if (dot) {
        dot.style.transform =
          `translate3d(${mouse.current.x}px, ${mouse.current.y}px, 0) translate(-50%, -50%)`;
      }

      // Il bersaglio delle parentesi: a riposo e' il mouse, su un elemento e' il
      // suo rettangolo — rilesso ADESSO, non memorizzato all'evento.
      const rect = el ? el.getBoundingClientRect() : null;
      const tx = rect ? rect.left + rect.width / 2 : mouse.current.x;
      const ty = rect ? rect.top + rect.height / 2 : mouse.current.y;
      // Sul campo del form le parentesi non esistono: la cornice va a zero e la
      // barra prende il loro posto. Non e' una dissolvenza, e' uno swap, e a
      // farlo e' la molla che riceve gia' il bersaglio giusto, senza che il loop
      // debba conoscere la regola del terminale.
      const terminal = kind === 'terminal';
      const inset = FRAME_INSET - (pressing.current ? PRESS_INSET : 0);
      const tw = rect ? Math.max(IDLE_SIZE, rect.width + inset * 2) : IDLE_SIZE;
      const th = rect ? Math.max(IDLE_SIZE, rect.height + inset * 2) : IDLE_SIZE;

      stepSpring(x, tx, instant);
      stepSpring(y, ty, instant);
      stepSpring(w, terminal ? 0 : tw, instant);
      stepSpring(h, terminal ? 0 : th, instant);

      // La cornice e' un elemento solo, posizionato per il CENTRO, e le due
      // parentesi ne sono i bordi. Quindi non serve un nodo per lato: bastano la
      // larghezza e l'altezza correnti, e la posizione si ottiene sottraendo
      // mezza cornice al centro.
      const frame = frameRef.current;
      if (frame) {
        frame.style.width = `${Math.max(0, w.pos).toFixed(2)}px`;
        frame.style.height = `${Math.max(0, h.pos).toFixed(2)}px`;
        frame.style.transform =
          `translate3d(${(x.pos - w.pos / 2).toFixed(2)}px, ${(y.pos - h.pos / 2).toFixed(2)}px, 0)`;
      }
      // La barra del terminale segue il mouse e non la cornice: e' un cursore
      // di testo, quindi sta DOVE si scrive, non dove sta una cornice che non
      // c'e' piu'. L'altezza e' 0 FUORI dai campi, ed e' questo spegnimento a
      // fare da stato: senza, la barra resterebbe accesa sopra il punto in ogni
      // pagina e il reticolo sembrerebbe sempre un cursore di terminale invece
      // che un puntatore con due parentesi.
      const bar = barRef.current;
      if (bar) {
        bar.style.height = terminal ? `${TERMINAL_BAR_HEIGHT}px` : '0px';
        bar.style.transform =
          `translate3d(${mouse.current.x}px, ${mouse.current.y}px, 0) translate(-50%, -50%)`;
      }
      // La label sta all'angolo della cornice e la segue: ferma sul mouse
      // sembrerebbe un testo appeso al puntatore, ferma sulla cornice sembra
      // parte del reticolo. E la molla la rende fluidissima perche' la muove
      // con gli stessi numeri della cornice, non con un secondo ritardo.
      const label = labelRef.current;
      if (label) {
        label.style.transform =
          `translate3d(${(x.pos + w.pos / 2 + LABEL_GAP).toFixed(2)}px, ${y.pos.toFixed(2)}px, 0) translateY(-50%)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, live]);


  // Il componente non esiste affatto su un dispositivo senza puntatore fine: non
  // un nodo nascosto. Su touch il reticolo non avrebbe niente da seguire, e un
  // nodo `fixed` in cima alla pagina costerebbe comunque una composizione a ogni
  // scroll, per un elemento che non si vede mai.
  if (!active) return null;

  return (
    // `fixed` e `pointer-events: none`: il reticolo non deve mai rubare un click,
    // e non deve mai far scorrere la pagina. Lo `z` e' il piu' alto della pagina
    // di proposito: il reticolo deve restare visibile SOPRA il preloader, sopra
    // i modal e sopra il marchio volante, altrimenti sparirebbe esattamente dove
    // l'utente lo sta usando.
    <div
      aria-hidden="true"
      data-reticle=""
      className="pointer-events-none fixed inset-0 z-[9999]"
      style={{ opacity: live ? 1 : 0 }}
    >
      {/* IL PUNTO. Sempre presente, anche quando la cornice sparisce sul
          terminale: e' la posizione esatta, e senza di lei il mouse non ha un
          riferimento visivo. */}
      <div
        ref={dotRef}
        data-reticle-dot=""
        className="reticle-dot absolute left-0 top-0"
        style={{ width: DOT_SIZE, height: DOT_SIZE }}
      />
      {/* LA CORNICE. Due parentesi quadre disegnate con i bordi, non due
          caratteri: un `[` di Space Mono ha lo spessore del testo e la sua
          dimensione dipende dalla stringa, mentre un bordo e' un pixel esatto e la
          sua lunghezza e' la lunghezza della cornice — che e' il numero che la
          molla sta animando. */}
      <div
        ref={frameRef}
        data-reticle-frame=""
        className="reticle-frame absolute left-0 top-0"
        style={{ width: IDLE_SIZE, height: IDLE_SIZE }}
      >
        <span className="reticle-bracket reticle-bracket--left" />
        <span className="reticle-bracket reticle-bracket--right" />
      </div>
      {/* LA LABEL. Il contenitore ha gia' `aria-hidden`, e qui il testo e' per
          chi guarda: dichiararlo a uno screen reader farebbe leggere "[VAI]" a
          ogni passaggio del mouse su un bottone — un rumore che non aggiunge
          niente a chi naviga da tastiera e non usa il mouse affatto. */}
      <span ref={labelRef} className="reticle-label absolute left-0 top-0">
        {label}
      </span>
      {/* LA BARRA DEL TERMINE. Nasce senza altezza e la prende nel loop: e'
          l'altezza zero a fare da spegnimento, cosi' il CSS non deve conoscere
          lo stato del reticolo. */}
      <span ref={barRef} className="reticle-bar absolute left-0 top-0" />
    </div>
  );
}


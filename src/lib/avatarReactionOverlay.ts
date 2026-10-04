// LE FORME DELLE REAZIONI: STELLE E CUORI.
//
// IL PERCH'E' UN SVG SEPARATO E NON DEI `<g>` NELL'SVG BASE.
//
// L'SVG di /max.svg non si tocca, e non per principio ma perche' e' da li' che
// nasce la sagoma di particelle: ParticleNebulaCanvas campiona i PIXEL del
// file, e se le stelle fossero dentro, quando il viso le mostrerebbe la sagoma
// le conterrebbe — la nuvola cosmica avrebbe due occhi gialli che pulsano al
// ritmo del mouse. Quindi qui si disegna in un secondo `<svg>` sovrapposto, con
// lo stesso viewBox: allineamento gratuito (le due sculture hanno lo stesso
// sistema di coordinate) e file base intatto.
//
// I `<g>` nascono con `display: none`. Non e' una scorciatoia: il rig chiama
// `apply` solo quando c'e' una reazione, e senza il `display` i gruppi
// spenderebbero un frame di rendering per restare spenti.

import { EYE_WHITE_INDEXES, pathCenter } from './faceRig';
import type { ReactionFrame } from './avatarReactions';

const NS = 'http://www.w3.org/2000/svg';

// Il viewBox e' quello dichiarato nel file (258x332). Vive qui come costante e
// non viene letto a runtime perche' l'overlay deve poter essere creato prima
// che l'SVG base sia iniettato nel DOM: senza base non c'e' niente da leggere.
const VIEW_BOX = '0 0 258 332';

// LE DUE FORME SONO GRANDI, E NON PER CASO.
//
// La lente nel file misura 44 per 32 unita'. Qui le forme la superano di molto:
// la stella ha un raggio esterno di 34 e il cuore 66 per 60. Sono numeri
// misurati sul viso, non scelti a occhio, e sono il punto in cui la reazione si
// vede davvero.
// motivo è che a 28 unita' la stella passava in mezzo alla lente senza arrivare
// sta centrato a (183.8, 158.2). La forma al CULMINE dell'animazione e' piu'
// grande di quella a riposo, e va guardata al culmine: l'overshoot dell'ingresso
// e la pulsazione si sommano e arrivano a 1.13 volte (misurato sulle curve, non
//
// IL RAPPORTO INTERNO DI OGNI FORMA E' INVARIATO — stella 2.281, cuore 1.100 —
// perche' ingrandire cambia quanto pesa il segno, non la sua figura. Alzare
// solo il raggio esterno darebbe una stella col centro pieno, che non e' piu'
// una stella ma un disco. I due rapporti sono `STAR_OUTER / STAR_INNER` e
// `HEART_W / HEART_H`, e i numeri qui sotto li rispettano: e' l'unico modo
// perche' un ingrandimento futuro non debba ricontrollare la figura a mano.
//
// LA GEOMETRIA E' DEL FILE. La stella a cinque punte alta 1,809*R e larga
// 1,902*R, e l'occhio destro — il piu' alto — sta centrato a (183.85, 158.19).
// La forma va guardata al CULMINE, non a riposo: l'overshoot dell'ingresso e la
// pulsazione si sommano e arrivano a 1.130 (misurato sulle curve di
// `avatarReactions`, non sul prodotto dei loro massimi, che darebbe 1.29 e non
// accadde mai).
//
// A R = 34 e picco 1.130 la stella va da y 123 a y 193: copre la visiera del
// cappello (che finisce a y 132) e le sopracciglia (y 125-135), e il fondo si
// ferma a 193 con il naso che comincia a y 202.
//
// IL SOVRAPPOSO E' VOLUTO, ed e' la ragione di questi numeri. A R = 25 la stella
// finiva a y 132.6: mezzo punto di margine dalla visiera, quindi stava DRITTO
// dentro la lente e non si faceva guardare — il segnale piu' forte della
// reazione era anche il piu' silenzioso. Il disegno del ritratto si rispetta,
// ma non al prezzo di una reazione invisibile: la stella deve leggersi come un
// segnale, non come un accessorio attorno all'occhio.
//
// IL CONTORNO SCURO non e' decorazione, e senza di esso l'ingrandimento serve a
// poco. Il giallo della stella (#FFD400 → #E18A0E) cade su una pelle #FCB2BC e
// su un cappello crema #EDDEC1/#DAC9A6: senza bordo la forma si rende solo piu'
// grande e non piu' leggibile. Il bordo scuro e' cio' che la stacca dal fondo.
//
// Il contorno e' CENTRATO sul path, quindi sporge di meta' `MARK_OUTLINE` fuori
// dal raggio dichiarato: R = 34 arriva davvero a 34.7. Il calcolo qui sopra usa
// 34 e resta entro il margio, ma se un giorno si tocca questo numero il raggio
// vero e' quello piu' il mezzo bordo.
// sul prodotto dei loro massimi, che darebbe 1.20 e non accadde mai).
//
const STAR_OUTER = 34;
const STAR_INNER = 14.9;
const HEART_W = 66;
const HEART_H = 60;

/**
 * Spessore del bordo scuro, in unita' del viewBox.
 *
 * `2` e' il minimo che al culmine della stella (100px nell'hero) resta un bordo
 * e non un accenno. Piu' sottile e la forma si sbiadisce nel fondo; molto
 * piu' spesso e la stella sembra un francobollo.
 */
const MARK_OUTLINE = 2;

/** Il colore del bordo: il marrone scuro che il file usa gia' per la bocca. */
const MARK_OUTLINE_COLOR = '#3B1115';

/**
 * La stella a cinque punte, centrata nell'origine.
 *
 * Generata e non scritta a mano perche' una stella a cinque punte ha una sola
 * forma: scriverne le dieci cifre a mano sarebbe un numero che si puo' sbagliare
 * silenziosamente, mentre la formula e' verificabile a occhio.
 */
const starPath = (outer: number, inner: number, points = 5): string => {
  const step = Math.PI / points;
  let d = '';
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + i * step;
    d += `${i === 0 ? 'M' : 'L'}${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
};

/**
 * Il cuore, centrato nell'origine, come due cubiche.
 *
 * Come la stella e' una geometria fissa, ma non si puo' generare con una formula
 * come la stella: un cuore e' due archi, e scriverli e' il modo piu' onesto di
 * averlo. Il vertice in basso e' a +H/2 e le due spalle a -H/2, quindi il
 * centro geometrico cade gia' un filo sotto il centro della lente, ed e' quello
 * che fa l'occhio sembrare guardare in basso mentre sorride.
 */
const heartPath = (w: number, h: number): string => {
  const x = w / 2;
  const y = h / 2;
  return (
    `M0 ${y}` +
    `C${(-x * 1.32).toFixed(2)} ${(y * 0.18).toFixed(2)} ${(-x * 1.06).toFixed(2)} ${(-y * 1.16).toFixed(2)} 0 ${(-y * 0.42).toFixed(2)}` +
    `C${(x * 1.06).toFixed(2)} ${(-y * 1.16).toFixed(2)} ${(x * 1.32).toFixed(2)} ${(y * 0.18).toFixed(2)} 0 ${y}Z`
  );
};

/**
 * I tre cuoricini che salgono sopra la testa.
 *
 * `x` e `y` sono nel viewBox del ritratto: la testa sta fra y 20 e y 90, quindi
 * i cuori partono intorno a y 70 — sopra le sopracciglia, dentro l'aria sopra
 * il cranio — e salgono fino a circa y 10, dove il ritratto finisce. Partire
 * piu' in alto li metterebbe fuori dal disegno; partire piu' in basso li
 * nasconderebbe fra i capelli.
 *
 * `phase` sfalsa la scia: e' la ragione per cui non salgono in fila.
 */
const BUBBLES = [
  { x: 96, y: 74, size: 9, rise: 58, sway: 6, scale: 1, phase: 0 },
  { x: 128, y: 82, size: 7, rise: 46, sway: -8, scale: 0.9, phase: 1.9 },
  { x: 154, y: 70, size: 8, rise: 64, sway: 5, scale: 0.95, phase: 3.4 },
] as const;

const el = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

export interface ReactionOverlay {
  /** Applica un frame della reazione. */
  apply: (frame: ReactionFrame) => void;
  /** Spegne tutto e rimette la testa com'era. */
  reset: () => void;
  /** Rimuove l'overlay dal DOM. */
  destroy: () => void;
}

type EyeMark = {
  group: SVGGElement;
  highlight: SVGEllipseElement;
  /**
   * Il centro della lente. `pathCenter` restituisce `cx`/`cy` perche' il rig
   * usa quei due numeri per scalare attorno al centro di un path, e qui si
   * riusa lo stesso ritorno senza rinominarlo: i due significati sono lo
   * stesso numero, quindi una coppia di nomi diversi sarebbe una traduzione
   * gratuita da mantenere.
   */
  center: { cx: number; cy: number };
};

/**
 * Costruisce l'overlay dentro `host`.
 *
 * `host` e' il div che contiene l'SVG del ritratto: l'overlay entra li' come
 * FRATELLO dell'SVG, non come figlio, per due motivi. Il primo e' che il rig
 * conta i `<path>` dell'host per indice (`paths[9]`, `paths[23]`, ...) e i path
 * delle stelle verrebbero contati come se fossero bocca e occhi. Il secondo e'
 * che l'host si puo' inclinare come un corpo unico, e cosi' l'inclinazione
 * della testa prende insieme disegno e overlay senza che i due debbano
 * accordarsi sullo stesso angolo.
 */
export const createReactionOverlay = (host: HTMLElement): ReactionOverlay | null => {
  // L'host non e' posizionato nel CSS, e un overlay `absolute` dentro un
  // elemento statico si posizionerebbe rispetto all'antenato piu' vicino che lo
  // e': l'overlay salirebbe sull'intera pagina invece che sugli occhi. Si
  // dichiara `relative` una volta sola e solo se non c'e' gia', perche' il
  // valore corrente non viene toccato: qualcun altro potrebbe averlo messo a
  // mano per un motivo suo.
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  // DOVE SONO GLI OCCHI.
  //
  // Non sono scritti qui: si leggono dal file, con lo stesso `pathCenter` che
  // usa il rig per gli occhi stessi. Il centro viene dalla SCLERA — l'unico
  // path che e' davvero un occhio chiuso — e non dall'iride: e' il bordo
  // dell'occhio che dice "dentro la lente", e se l'SVG cambia proporzioni le
  // stelle restano dentro invece di andare a spasso.
  const paths = host.querySelectorAll('path');
  if (paths.length < 30) return null;
  const seeds = (['left', 'right'] as const).map((side) =>
    pathCenter(paths[EYE_WHITE_INDEXES[side]].getAttribute('d') ?? ''),
  );

  // NESSUN `preserveAspectRatio`. Il default (`xMidYMid meet`) e' esattamente
  // quello dell'SVG base, ed e' la ragione per cui l'overlay e' allineato
  // all'occhio. Dichiararlo `none` stirerebbe l'overlay per riempirlo a
  // qualsiasi rapporto, e su una viewport il cui contenitore ha un rapporto
  // leggermente diverso le stelle cadrebbero fuori dalla lente.
  const svg = el('svg', { viewBox: VIEW_BOX, 'aria-hidden': 'true', 'data-reaction-overlay': '' });
  svg.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none';

  // I gradienti sono per ISTANZA, non condivisi: due `<linearGradient>` con lo
  // stesso id nello stesso documento non sono lo stesso gradiente, e il secondo
  // che lo chiede per id prende il primo. Un id univoco per host e' l'unico
  // modo che regga con le due istanze dell'avatar montate insieme.
  const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const defs = el('defs');
  // Stella: giallo pieno che vira all'arancio in basso. Il bordo arancio e' un
  // gradiente e non uno `stroke`: a 36px sull'marchio dell'header uno stroke
  // finirebbe sotto il pixel e la stella sembrerebbe un disco.
  const starGrad = el('linearGradient', { id: `rg-star-${uid}`, x1: '0', y1: '0', x2: '0', y2: '1' });
  starGrad.append(
    el('stop', { offset: '0', 'stop-color': 'rgb(var(--color-accent))' }),
    el('stop', { offset: '1', 'stop-color': 'rgb(var(--color-amber))' }),
  );
  // Cuore: la palette non ha un rosso. Orchidea e viola sono la coppia piu'
  // calda che c'e', e il contrasto con il giallo delle stelle tiene i due stati
  // distinguibili anche a 36px, dove la forma dice gia' tutto e il colore e'
  // solo aiuto.
  const heartGrad = el('radialGradient', {
    id: `rg-heart-${uid}`,
    cx: '0.36',
    cy: '0.3',
    r: '0.82',
  });
  heartGrad.append(
    el('stop', { offset: '0', 'stop-color': 'rgb(var(--color-orchid))' }),
    el('stop', { offset: '1', 'stop-color': 'rgb(var(--color-violet))' }),
  );
  defs.append(starGrad, heartGrad);

  // La stella: il path e l'highlight. L'highlight e' un disco bianco DENTRO la
  // stella, non un bordo attorno — un bordo bianco su una stella a 36px non si
  // vede, un disco acceso si vede perche' cambia il peso del segno.
  const makeEyeMark = (shape: SVGPathElement, w: number, h: number): EyeMark => {
    const g = el('g');
    g.append(shape);
    const highlight = el('ellipse', {
      cx: (-w * 0.23).toFixed(2),
      cy: (-h * 0.24).toFixed(2),
      rx: (w * 0.19).toFixed(2),
      ry: (h * 0.15).toFixed(2),
      fill: '#fff',
    });
    g.append(highlight);
    return { group: g, highlight, center: { cx: 0, cy: 0 } };
  };

  // ── stelle ─────────────────────────────────────────────────────────────────
  const starGroup = el('g', { 'data-reaction': 'stars' });
  starGroup.style.display = 'none';
  const starMarks: EyeMark[] = seeds.map((center) => {
    const mark = makeEyeMark(
      el(
        'path',
        {
          d: starPath(STAR_OUTER, STAR_INNER),
          fill: `url(#rg-star-${uid})`,
          // Il bordo scuro e' la meta' del lavoro di questa forma. Vedi il
          // commento sui numeri: il giallo su un cappello crema, da solo,
          // sbiadisce nel fondo.
          stroke: MARK_OUTLINE_COLOR,
          'stroke-width': String(MARK_OUTLINE),
          // Arrotondato perche' a `miter` la punta della stella diventa uno
          // spigolo che arriva il doppio del bordo: con cinque punte in gioco
          // l'angolo e' acuto e `miter` lo moltiplica per un fattore che qui
          // supererebbe di gran lunga il limite di default. Le punte
          // diventerebbero frecce.
          'stroke-linejoin': 'round',
        },
      ),
      STAR_OUTER * 2,
      STAR_OUTER * 2,
    );
    mark.center = center;
    starGroup.append(mark.group);
    return mark;
  });

  // ── cuori ──────────────────────────────────────────────────────────────────
  const heartGroup = el('g', { 'data-reaction': 'hearts' });
  heartGroup.style.display = 'none';
  const heartMarks: EyeMark[] = seeds.map((center) => {
    const mark = makeEyeMark(
      el(
        'path',
        {
          d: heartPath(HEART_W, HEART_H),
          fill: `url(#rg-heart-${uid})`,
          // Come la stella: il bordo e' cio' che stacca il rosso dalla pelle e
          // dal cappello. Sul cuore `round` serve anche perche' la cuspide in
          // basso e' acuta esattamente come le punte della stella.
          stroke: MARK_OUTLINE_COLOR,
          'stroke-width': String(MARK_OUTLINE),
          'stroke-linejoin': 'round',
        },
      ),
      HEART_W,
      HEART_H,
    );
    mark.center = center;
    heartGroup.append(mark.group);
    return mark;
  });

  // ── i cuoricini che salgono ────────────────────────────────────────────────
  //
  // Tre, non uno: uno sembra un effetto, tre sembrano un pensiero. Partono
  // sfalsati in orizzonte perche' tre cuori perfettamente incolonnati sembrano
  // un grafico, e ognuno ha un tempo suo — se salissero insieme, l'uno dietro
  // l'altro sembrerebbero un'immagine che si ripete.
  const bubbleGroup = el('g', { 'data-reaction': 'bubbles' });
  bubbleGroup.style.display = 'none';
  const bubbles = BUBBLES.map((seed) => {
    const g = el('g');
    g.append(
      el('path', {
        d: heartPath(seed.size, seed.size * 0.92),
        fill: `url(#rg-heart-${uid})`,
        opacity: '0.9',
      }),
    );
    bubbleGroup.append(g);
    return { node: g, seed };
  });

  svg.append(defs, starGroup, heartGroup, bubbleGroup);
  host.append(svg);

  /**
   * Il transform di un occhio: posizione, rotazione d'ingresso, scala e
   * pulsazione in una stringa sola.
   *
   * `rotate` viene PRIMA dello `scale`, e l'ordine conta: la rotazione parte da
   * -15° e si spegne con l'ingresso, quindi la stella arriva storta e si
   * raddrizza, che e' il movimento che chiede la specifica. Se fosse prima dello
   * scale, la rotazione verrebbe moltiplicata dalla scala e a `shape` = 1.25
   * l'inclinazione iniziale sarebbe gia' il doppio.
   */
  const eyeTransform = (mark: EyeMark, frame: ReactionFrame) => {
    const rotation = -15 * (1 - frame.enter);
    const scale = frame.shape * frame.pulse;
    return (
      `translate(${mark.center.cx.toFixed(2)} ${mark.center.cy.toFixed(2)}) ` +
      `rotate(${rotation.toFixed(2)}) scale(${scale.toFixed(3)})`
    );
  };

  const apply = (frame: ReactionFrame): void => {
    const stars = frame.kind === 'stars';
    starGroup.style.display = stars ? '' : 'none';
    heartGroup.style.display = stars ? 'none' : '';

    const marks = stars ? starMarks : heartMarks;
    marks.forEach((mark) => {
      // Le due forme entrano in contr ADDITO, non sfasate: due stelle una dietro
      // l'altra sembrerebbero sbagliate, e la simmetria del viso e' una delle cose
      // che fa leggere un volto come un volto.
      mark.group.setAttribute('transform', eyeTransform(mark, frame));
      mark.highlight.setAttribute('opacity', (0.45 + frame.twinkle * 0.55).toFixed(2));
      // L'opacita' segue l'uscita e basta: dentro l'ingresso la stella deve
      // crescere DA ZERO, e una forma che cresce con opacita' costante e' piu'
      // facile da leggere di una che sbiadisce mentre si allarga.
      mark.group.setAttribute('opacity', (1 - frame.exit).toFixed(2));
    });

    // CUORICINI. Ognuno parte quando il precedente e' gia' salito di un terzo:
    // il ritardo e' la coda di lancio, senza la quale i tre cuori salgono come
    // un blocco unico.
    const bubblesOn = frame.bubble >= 0;
    bubbleGroup.style.display = bubblesOn ? '' : 'none';
    if (bubblesOn) {
      bubbles.forEach(({ node, seed }, i) => {
        const p = (frame.bubble - i * 0.18) / (1 - i * 0.18);
        if (p <= 0 || p >= 1) {
          node.setAttribute('opacity', '0');
          return;
        }
        const rise = p * seed.rise;
        const sway = Math.sin(p * Math.PI * 1.4 + seed.phase) * seed.sway;
        node.setAttribute(
          'transform',
          `translate(${(seed.x + sway).toFixed(2)} ${(seed.y - rise).toFixed(2)}) ` +
            `scale(${(seed.scale * (0.6 + p * 0.4)).toFixed(3)})`,
        );
        // Appare subito, sparisce piano: un cuore che si accende mentre sale
        // sembra una scintilla, e la scintilla non era richiesta.
        node.setAttribute('opacity', (Math.min(1, p * 6) * (1 - p) * 0.9).toFixed(2));
      });
    }

    // La TESTA. L'inclinazione e' un `rotate` in gradi CSS sul nodo che contiene
    // l'SVG, non un transform SVG: cosi' vale anche per l'istanza dell'header,
    // dove la testa e' 52px e un transform in unita' del viewBox sarebbe venti
    // volte piu' piccolo del dovuto.
    //
    // `scale(a, b)` con la VIRGOLA, e non `scale(a b)` con lo spazio. La forma
    // con lo spazio e' quella della specifica CSS e sembra equivalente, ma il
    // CSSOM di Chrome la rifiuta quando i due numeri hanno lo stesso valore
    // decimale — `scale(1.000 1.000)` viene scartato SILENZIOSAMENTE, senza
    // eccezione: la dichiarazione semplicemente non viene applicata. Il sintomo
    // era la testa che non si inclinava mai, con le stelle che invece
    // comparivano, perche' la stessa funzione scriveva le due cose e solo la
    // seconda veniva persa. Con la virgola la stessa stringa viene accettata,
    // ed e' anche la forma che framer-motion produce.
    const stretch = frame.stretch;
    host.style.transform =
      `rotate(${frame.tiltDeg.toFixed(2)}deg) ` +
      `scale(${(2 - stretch).toFixed(3)}, ${stretch.toFixed(3)})`;
  };

  return {
    apply,
    reset: () => {
      starGroup.style.display = 'none';
      heartGroup.style.display = 'none';
      bubbleGroup.style.display = 'none';
      // Anche il transform della testa va via: senza, alla fine della reazione
      // il ritratto resterebbe inclinato, e non perche' lo abbia deciso ma
      // perche' nessuno lo ha tolto.
      host.style.transform = '';
    },
    destroy: () => {
      svg.remove();
      host.style.transform = '';
    },
  };
};


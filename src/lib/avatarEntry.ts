import { animate, type AnimationPlaybackControls } from 'framer-motion';

// L'INGRESSO DELL'AVATAR.
//
// Il contenitore che porta l'SVG entra in scena con una scala e una risalita,
// mascherato da `clip-path`. Qui la maschera e' una difesa, non un effetto:
// senza, l'avatar si vedrebbe gia' alla sua dimensione finale e si limiterebbe
// a restringersi, mentre cosi' emerge dal bordo.
//
// `clip-path` e non `opacity`: l'opacita' produrrebbe esattamente il difetto
// che questo passo deve evitare, cioe' un viso SEMITRASPARENTE che si vede
// attraverso se stesso mentre cresce. Con la maschera l'avatar e' o intero o
// assente, e durante l'ingresso e' semplicemente piu' piccolo del suo spazio.
//
// Due istanze dell'SVG vivono nel DOM (desktop e mobile), e l'ingresso le
// muove entrambe: si animano solo quelle realmente in scroma, perche' animare
// l'istanza nascosta costerebbe frame senza mostrarne uno.

const SELECTOR = '[data-face-host]';

const hosts = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

/**
 * Prepara l'avatar per l'ingresso: nascosto ma con il suo spazio.
 *
 * `visibility: hidden` e non `display: none`: il nodo deve conservare il suo
 * rect, perche' il layout della colonna non puo' spostarsi quando l'avatar
 * entra. E la ragione per cui si puo' misurare il suo centro viso (che serve
 * a `lookAt`) anche mentre e' invisibile.
 */
export const prepareAvatar = (): void => {
  hosts().forEach((el) => {
    el.style.visibility = 'hidden';
  });
};

/** Rende visibile l'avatar e lo porta alla sua posizione di partenza. */
const armEntry = (): void => {
  hosts().forEach((el) => {
    el.style.visibility = 'visible';
    el.style.transformOrigin = 'center center';
    el.style.transform = 'translateY(12px) scale(0.96)';
    // La maschera parte stretta in basso: e' l'emersione vera, la scala e' solo
    // l'accompagnamento. Si scrive in forma lunga perche' `clip-path` accetta
    // l'animazione solo come lista di valori, e le scorciatoie (`inset(0)`)
    // non sono interpolabili.
    el.style.clipPath = 'inset(6% 0% 0% 0% round 2px)';
  });
};

/** Rimuove la trasformazione d'ingresso: il nodo torna al layout naturale. */
const settleEntry = (): void => {
  hosts().forEach((el) => {
    el.style.transform = '';
    el.style.transformOrigin = '';
    el.style.clipPath = '';
  });
};

let controls: AnimationPlaybackControls | null = null;

/**
 * Fa entrare l'avatar e restituisce i controlli dell'animazione.
 *
 * La posizione di partenza e' applicata in un colpo solo, senza transizione:
 * e' il primo e l'ultimo frame dell'animazione, e devono essere identici per
 * costruzione, non per approssimazione.
 *
 * La maschera parte un filo piu' stretta del necessario e si apre insieme alla
 * scala: cosi' l'avatar emerge dal bordo inferiore mentre sale, e il bordo
 * tagliato segue il movimento. Con `inset` a 0 dal primo frame la maschera non
 * mascherebbe niente e l'effetto sarebbe un ritratto che si rimpicciolisce e
 * basta.
 */
export const enterAvatar = (options: {
  duration: number;
  easing: [number, number, number, number];
  onComplete: () => void;
}): void => {
  const nodes = hosts();
  if (!nodes.length) {
    options.onComplete();
    return;
  }
  armEntry();
  controls = animate(
    nodes,
    {
      y: 0,
      scale: 1,
      clipPath: 'inset(0% 0% 0% 0% round 2px)',
    },
    { duration: options.duration, ease: options.easing, onComplete: options.onComplete },
  );
};

/** Applica solo la posizione di partenza, senza animare: serve a `?skip`. */
export const showAvatarImmediately = (): void => {
  controls?.stop();
  hosts().forEach((el) => {
    el.style.visibility = 'visible';
  });
  settleEntry();
};

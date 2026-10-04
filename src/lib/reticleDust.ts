// LA POLVERE DEL CLICK.
//
// L'anello e le particelle che nascono quando si preme. Sono in un canvas e non
// in nodi DOM perche' sono 6-8 elementi che vivono 600ms e poi muoiono: creare
// e distruggere nodi a ogni click fa lavorare il layout, mentre un canvas che
// disegna sprite gia' prerenderizzati e' la stessa tecnica che gia' usa la
// nebulosa e le particelle dell'hero (vedi ParticleNebulaCanvas e lo
// `makeSprite` in HeroScene).
//
// L'ANELLO E' QUI E NON IN CSS, e questa e' una scelta controintuitiva: un
// anello che si espande e svanisce e' esattamente quello che un `div` con
// `animation` fa senza nessun JavaScript. Ma l'anello deve nascere nel punto del
// click e morire da solo, e farlo con un nodo significa creare un elemento,
// aspettare `animationend` e rimuoverlo: con due click rapidi si avrebbero due
// nodi e due timer da tenere d'accordo. Qui il click e' una voce in un array e
// la sua fine e' una condizione sul tempo, quindi due click rapidi sono due voci
// e basta.

import { reducedMotion } from './motionPreference';

/** Quante particelle per click. La specifica chiede 6-8: sette e' il centro. */
const PARTICLE_COUNT = 7;
/** Velocita' iniziale, in px al secondo. */
const SPEED_MIN = 46;
const SPEED_MAX = 128;
/** Fattore di frenata per passo. */
const DRAG = 1.9;
/** Vita di una particella, in secondi. */
const LIFE_MIN = 0.42;
const LIFE_MAX = 0.78;
/** Lato dello sprite, in px. */
const SPRITE = 32;
/** L'anello dura piu' della particella: si espande mentre il pulviscolo esce. */
const RING_LIFE = 0.52;
/**
 * Il massimo delta fra due frame, in secondi.
 *
 * Copre il caso estremo: una scheda in secondo piano che torna avanti con tre
 * secondi di clock. Senza, tutte le particelle salterebbero fuori dallo schermo
 * in un solo frame e l'anello finirebbe a meta' — un difetto che si vede solo
 * tornando sulla scheda, e quindi solo in una parte delle prove.
 */
const MAX_STEP = 0.05;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  sprite: HTMLCanvasElement;
}

interface Ring {
  x: number;
  y: number;
  age: number;
  life: number;
}

// Il canvas e' creato al primo click e tenuto: ricrearlo a ogni click costerebbe
// una superficie nuova da allocare ogni volta, e il nodo deve stare FUORI da
// React perche' React non deve sapere che esiste.
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let spritePink: HTMLCanvasElement | null = null;
let spriteYellow: HTMLCanvasElement | null = null;
let raf = 0;
let last = 0;
const particles: Particle[] = [];
const rings: Ring[] = [];

/**
 * Gli sprite. Due tinte, due terzi giallo e un terzo rosa, come nell'hero.
 *
 * Le stesse due tinte per una ragione che non e' "coerenza": e' leggibilita'.
 * Sul magenta di fondo il rosa da solo ha un contrasto di 3.56 e un punto da
 * 2px sparisce; il giallo ne ha 4.27. La miscela serve a questo, e riusare le
 * costanti dell'hero e' il modo piu' economico per ottenerlo.
 */
const makeSprite = (rgb: string): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = SPRITE;
  c.height = SPRITE;
  const g2 = c.getContext('2d');
  if (g2) {
    const grad = g2.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    grad.addColorStop(0, `rgba(${rgb}, 1)`);
    grad.addColorStop(0.22, `rgba(${rgb}, 0.8)`);
    grad.addColorStop(0.5, `rgba(${rgb}, 0.24)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    g2.fillStyle = grad;
    g2.fillRect(0, 0, SPRITE, SPRITE);
  }
  return c;
};

const ensure = (): boolean => {
  if (ctx) return true;
  if (typeof document === 'undefined') return false;
  const c = document.createElement('canvas');
  c.setAttribute('data-reticle-dust', '');
  // `fixed inset-0` con uno `z` sotto quello del reticolo: se il canvas fosse
  // sopra, i pixel dell'anello coprirebbero il punto centrale del mouse. Sotto,
  // l'anello si vede attorno al punto e non davanti.
  c.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9998';
  document.body.append(c);
  canvas = c;
  ctx = c.getContext('2d');
  spritePink = makeSprite('252, 178, 188');
  spriteYellow = makeSprite('255, 212, 0');
  return ctx !== null;
};

/** Il passo di disegno. Gira finche' non resta piu' niente da disegnare. */
const tick = (now: number): void => {
  raf = 0;
  if (!ctx || !canvas) return;
  const dt = Math.min((now - last) / 1000, MAX_STEP);
  last = now;

  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);

  // ANELLI. Un anello e' un cerchio che cresce e svanisce, e lo spessore si
  // stringe con l'eta': un anello che resta sottile, raddoppiando, sfora sul
  // bordo e si spezza — e il risultato e' un cerchio tratteggiato, che e'
  // esattamente l'effetto da evitare su una pagina che e' tutta griglia.
  for (let i = rings.length - 1; i >= 0; i -= 1) {
    const ring = rings[i];
    ring.age += dt;
    const p = ring.age / ring.life;
    if (p >= 1) {
      rings.splice(i, 1);
      continue;
    }
    const radius = 6 + p * 30;
    const fade = (1 - p) * (1 - p);
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 212, 0, ${(0.85 * fade).toFixed(3)})`;
    ctx.lineWidth = 1.5 - p * 0.9;
    ctx.stroke();
  }

  // PARTICELLE. Il moto e' un getto che si spegne: la velocita' si divide per un
  // fattore fisso a ogni passo e la gravita' e' costante, quindi la particella
  // curva. Un moto lineare sembrerebbe un proiettile, e qui non deve: e' polvere.
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.age += dt;
    const t = p.age / p.life;
    if (t >= 1) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 34 * dt;
    p.vx /= DRAG;
    p.vy /= DRAG;
    const fade = (1 - t) * (1 - t);
    const r = p.size * (1 - t * 0.45);
    ctx.globalAlpha = fade;
    ctx.drawImage(p.sprite, p.x - r, p.y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;

  if (particles.length || rings.length) {
    raf = requestAnimationFrame(tick);
    return;
  }
  // Il loop si spegne quando non resta niente: un rAF che gira a vuoto
  // costerebbe un frame di composizione per sempre, e questa pagina ne ha gia'
  // due di suo.
  ctx.clearRect(0, 0, w, h);
};

/**
 * L'esplosione al click: un anello e sette particelle.
 *
 * Sotto `prefers-reduced-motion` non succede niente e il ritorno e' esplicito:
 * la specifica vuole che il click resti un click, e il reticolo si muove gia'
 * col puntatore, quindi questo e' solo un'aggiunta. Il ritorno anticipato e'
 * anche cio' che tiene `burst` onesto come un `void`: chi lo chiama non deve
 * dover chiedersi se l'utente ha chiesto meno animazione.
 */
export const burst = (x: number, y: number): void => {
  if (reducedMotion) return;
  if (!ensure() || !spritePink || !spriteYellow) return;

  rings.push({ x, y, age: 0, life: RING_LIFE });
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    // L'angolo e' distribuito su tutto il cerchio ma a passo fisso piu' una
    // perturbazione: a passo fisso puro le particelle escono a raggiera e
    // sembrano un sole, che e' l'opposto della polvere.
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + (i % 3) * 0.42;
    const speed = SPEED_MIN + ((i * 0.37) % 1) * (SPEED_MAX - SPEED_MIN);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: LIFE_MIN + ((i * 0.53) % 1) * (LIFE_MAX - LIFE_MIN),
      size: 3 + ((i * 0.29) % 1) * 4,
      sprite: i % 3 === 2 ? spritePink : spriteYellow,
    });
  }

  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
};

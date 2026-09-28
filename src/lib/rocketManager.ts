// IL RAZZO COREOGRAFATO.
//
// Perche' un elemento DOM dedicato e non una rotta dentro il canvas esistente.
//
// I razzi ambient vivono dentro una CAMERA: proiezione con lunghezza focale,
// profondita' in Z, Circle of Confusion e bokeh, il tutto in frazioni della
// viewport con una camera che si muove. Una traiettoria scripted e' il
// contrario esatto: percorso in pixel di viewport, corsia letta dal layout,
// profondita' zero. Infilarla in quel renderer significa combattere a ogni
// frame la sua proiezione per ottenere un movimento che e' gia' in coordinate
// schermo.
//
// Il razzo scripted quindi ha un elemento suo. NON cambia aspetto: riusa la
// stessa identica sprite che disegna il canvas (stessa funzione, stessa tinta,
// stesso aspetto 210/100, stessa altezza di base). Cambia solo il motore che la
// posiziona.
//
// Il gate dei razzi ambient sta invece in stickerRockets.ts: e' li' che una
// rotta viene rilasciata, e un controllo messo qui lascerebbe un cancello
// aperto da un'altra parte.

import {
  createRocketSprite,
  ROCKET_ASPECT,
  ROCKET_BASE_HEIGHT_PX,
  type StickerTint,
} from './stickerRockets';
import { ENTRY_CONFIG } from './entryConfig';

/** Stessa tinta del primo razzo ambient: la famiglia di colori e' gia' scelta. */
const SCRIPTED_TINT: StickerTint = 'yellow';

/** Stessa opacita' degli ambient: il razzo non deve essere piu' o meno forte. */
const SCRIPTED_ALPHA = 0.92;

/** Respiro fra la corsia e i bordi che la delimitano (header e blocco di testo). */
const LANE_PADDING_PX = 8;

/** Quanta aria sopra il binario, e quanto il razzo si alza a meta' percorso. */
const ARC_PX = 20;

/** Quanto il razzo nasce oltre il bordo, cosi' entra ed esce senza comparire. */
const START_OFFSET_PX = 60;

/** Quota del binario lungo la corsia: 0 = sotto l'header, 1 = sopra il testo. */
const LANE_RATIO = 0.3;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export type PositionListener = (x: number, y: number, angle: number) => void;
export type ExitListener = () => void;

/** La corsia, letta dal layout reale e non da numeri scritti qui. */
export interface Lane {
  top: number;
  bottom: number;
  /** Il binario: la quota a cui il razzo parte e a cui torna. */
  y: number;
}

const readLane = (): Lane => {
  const header = document.querySelector<HTMLElement>('header');
  const headline = document.querySelector<HTMLElement>('[data-scene="hero"] h2');

  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  // Il blocco di testo puo' essere fuori viewport: durante la sequenza la
  // sezione hero e' ancora sotto il pie' di finestra, perche' lo scroll non e'
  // sbloccato. Senza il limite la corsia arriverebbe a metri e il razzo
  // attraverserebbe la pagina invece di passare davanti al cappello. Il fondo
  // e' quindi il minimo fra il testo e il bordo dello schermo: la corsia
  // finisce dove finisce cio' che si vede.
  const textTop = headline ? headline.getBoundingClientRect().top : window.innerHeight;

  const top = headerBottom + LANE_PADDING_PX;
  const bottom = Math.min(textTop, window.innerHeight) - LANE_PADDING_PX;

  // Il binario non puo' stare dove vuole, e il vincolo non e' la quota del
  // razzo ma la quota PIU' ALTA che raggiunge: la traiettoria sale di ARC_PX a
  // meta' percorso. Il centro viene quindi bloccato tenendo conto sia del mezzo
  // razzo sia del vertice dell'arco, altrimenti su uno schermo basso il razzo
  // sporgerebbe sopra l'header proprio nel punto piu' in alto del suo volo.
  // Se i due limiti si incrociano (corsia piu' corta del razzo piu' arco) si
  // tiene il piu' basso: e' l'unica scelta che rispetta l'header, e coprire
  // l'header sarebbe peggio che graffiare il cappello.
  const half = ROCKET_BASE_HEIGHT_PX / 2;
  const lowest = top + half + ARC_PX;
  const highest = bottom - half;
  const wanted = top + Math.max(0, bottom - top) * LANE_RATIO;
  const y = Math.min(Math.max(wanted, lowest), Math.max(lowest, highest));
  return { top, bottom, y };
};

class RocketManager {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private sprite: HTMLCanvasElement | null = null;
  private raf: number | null = null;
  private onPosition: PositionListener | null = null;
  private onExit: ExitListener | null = null;
  private running = false;

  private ensureElement(): boolean {
    if (this.canvas && this.ctx) return true;
    if (typeof document === 'undefined') return false;
    if (!this.sprite) this.sprite = createRocketSprite(SCRIPTED_TINT);
    if (!this.sprite) return false;

    const dpr = window.devicePixelRatio || 1;
    const width = ROCKET_BASE_HEIGHT_PX / ROCKET_ASPECT;
    const height = ROCKET_BASE_HEIGHT_PX;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.rocketScripted = 'layer';
    // Sopra i razzi ambient (z-25) e sotto i dischi bokeh del foreground
    // (z-30), che devono restare il layer ottico piu' vicino. Sotto l'header
    // (z-50), che non si lascia coprire.
    canvas.style.cssText =
      'position:fixed;left:0;top:0;pointer-events:none;z-index:28;opacity:0;' +
      `width:${width}px;height:${height}px;will-change:transform;`;
    document.body.appendChild(canvas);

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return !!this.ctx;
  }

  /**
   * Lancia il razzo coreografato e lo disegna a ogni frame.
   *
   * La traiettoria e' una Bézier quadratica con i due estremi alla stessa
   * quota: sale di `ARC_PX` a meta' percorso e ci torna. Il vertice e' a meta'
   * perche' in una quadratica il punto medio sta fra gli estremi e il controllo:
   * per ottenere +20px serve un controllo a +40px.
   */
  private startScripted = () => {
    this.stopScripted();
    if (!this.ensureElement()) return;

    const lane = readLane();
    const p0 = { x: window.innerWidth + START_OFFSET_PX, y: lane.y };
    const p2 = { x: -START_OFFSET_PX, y: lane.y };
    const p1 = { x: (p0.x + p2.x) / 2, y: lane.y - ARC_PX * 2 };

    this.running = true;
    // Il nodo viene posizionato PRIMA di diventare visibile. Se l'opacita' salisse
    // per prima, il primo frame mostrerebbe un canvas vuoto fermo nell'angolo
    // dello schermo: invisibile all'occhio, ma un.rect che misura 0,0 e che
    // farebbe pensare che il razzo parta dal basso a sinistra.
    const width = ROCKET_BASE_HEIGHT_PX / ROCKET_ASPECT;
    const height = ROCKET_BASE_HEIGHT_PX;
    if (this.canvas) {
      this.canvas.style.transform = `translate(${p0.x - width / 2}px, ${p0.y - height / 2}px)`;
      this.canvas.style.opacity = '1';
    }

    const t0 = performance.now();
    const total = ENTRY_CONFIG.rocketScriptedDuration * 1000;

    const tick = () => {
      if (!this.running || !this.canvas || !this.ctx || !this.sprite) return;
      const t = clamp01((performance.now() - t0) / total);
      const mt = 1 - t;
      const x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
      const y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;

      // Velocita' istantanea: serve per orientare il razzo lungo il moto.
      const vx = 2 * mt * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
      const vy = 2 * mt * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
      // Il naso della sprite punta in su, quindi l'angolo che lo allinea alla
      // velocita' e' preso dall'asse verticale, non da x: senza questa inversione
      // il razzo volerebbe a coda.
      const angle = Math.atan2(vx, -vy);

      this.ctx.clearRect(0, 0, width, height);
      this.ctx.save();
      this.ctx.globalAlpha = SCRIPTED_ALPHA;
      // Il centro del disegno e' il centro del canvas: si va al centro e da li' si
      // disegna a partire da -meta', cosi' la sprite finisce centrata. I due
      // segni NON si sommano: traslare di -meta' e poi disegnare a -meta' metterebbe
      // la sprite per tre quarti fuori dal canvas, e il quarto che entra e' un
      // angolo di contorno quasi trasparente. Il nodo sembrerebbe vuoto.
      this.ctx.translate(width / 2, height / 2);
      this.ctx.rotate(angle);
      this.ctx.drawImage(this.sprite, -width / 2, -height / 2, width, height);
      this.ctx.restore();
      // Il nodo segue il razzo, cosi' il confine del DOM coincide con quello
      // del disegno: e' da li' che si misura, e i bordi del canvas non
      // farebbero da schermo a quello che ci ha dentro.
      this.canvas.style.transform = `translate(${x - width / 2}px, ${y - height / 2}px)`;

      this.onPosition?.(x, y, angle);

      if (t >= 1) {
        this.running = false;
        // Il razzo ha lasciato lo schermo: si spegne e si svuota il canvas. Non si
        // aspetta il dispose: da qui in avanti il nodo resterebbe in pagina per
        // tutta la visita, con l'ultimo fotogramma disegnato dentro.
        this.hide();
        this.onExit?.();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  /** Spegne il nodo e lo lascia vuoto: nessun fotogramma resta in pagina. */
  private hide = () => {
    if (!this.canvas) return;
    this.canvas.style.opacity = '0';
    const width = ROCKET_BASE_HEIGHT_PX / ROCKET_ASPECT;
    this.ctx?.clearRect(0, 0, width, ROCKET_BASE_HEIGHT_PX);
  };

  private stopScripted = () => {
    this.running = false;
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.hide();
  };

  /**
   * Avvia il razzo coreografato e collega le due callback che la sequenza usa
   * per pilotare il viso: una a ogni frame (`onPosition`) e una all'uscita dal
   * bordo sinistro (`onExit`).
   */
  launchScripted(options: {
    onPosition: PositionListener;
    onExit: ExitListener;
  }): void {
    this.onPosition = options.onPosition;
    this.onExit = options.onExit;
    this.startScripted();
  }

  /**
   * Rimuove l'elemento dal DOM. Va chiamato quando l'ingresso e' finito e il
   * razzo scripted non tornera': lasciarlo li' significherebbe un canvas vuoto e
   * fermo per tutta la visita, che e' spazzatura.
   */
  dispose(): void {
    this.stopScripted();
    this.onPosition = null;
    this.onExit = null;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.sprite = null;
  }
}

export const rocketManager = new RocketManager();


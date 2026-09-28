// IL TEXT-SCRAMBLE.
//
// Il testo non appare: il testo si RISOLVE. Ogni posizione parte da un
// simbolo casuale e, una alla volta da sinistra a destra, si sostituisce con
// il carattere vero. Le posizioni non ancora risolte continuano a cambiare
// simbolo, e cosi' il lettore vede il testo che si compone invece di un testo
// che sfuma in.
//
// Non e' un componente e non e' un hook: e' un controller che scrive
// DIRETTAMENTE sul nodo. Il motivo e' lo stesso della FLIP del nome: il
// contenuto cambia ogni 50ms su quattro righe, e farlo passare da uno
// `useState` produrrebbe un render di React ogni 50ms per righe che non hanno
// bisogno di essere re-renderizzate ma solo di un `textContent` diverso.

import { reducedMotion } from './motionPreference';

/**
 * Simboli con cui un carattere puo' mascherarsi.
 *
 * Niente spazio: uno spazio che cicla diventerebbe un simbolo, e la riga
 * cambierebbe larghezza a ogni tick. Gli spazi del testo target si risolvono
 * subito come spazi (vedi `scrambleCharAt`), quindi la larghezza visibile della
 * riga resta costante per tutto lo scramble.
 */
const SYMBOLS = '*#/&!^@\\-_%$<>?';

const randomSymbol = (): string => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

/**
 * Classe dei caratteri NON ancora risolti: il rosa del sito, ma tenuto su.
 *
 * Il contrasto col testo risolto e' cio' che rende il reveal leggibile: senza,
 * i simboli e le lettere sarebbero dello stesso giallo e si vedrebbe solo il
 * testo che si cancella e si riscrive, non il momento in cui si compone.
 *
 * La stessa classe vale per l'headline e per la sub-headline, e pero' in entrambi
 * i casi con un effetto diverso: sull'headline il testo risolto e' giallo e il
 * contrasto e' pieno, sulla sub-headline il testo risolto e' gia' rosa e il
 * passaggio e' piu' tenue. Usare il rosa pieno anche li' avrebbe reso i due
 * identici, cioe' nessun contrasto: e il rosa al 55% e' l'unico modo che
 * funziona con le due destinazioni senza duplicare la regola.
 */
const SYMBOL_CLASS = 'scramble-symbol';

/** Classe dei caratteri risolti: `color: inherit` prende il colore finale. */
const CHAR_CLASS = 'scramble-char';

/** Il carattere da mostrare alla posizione `index` con `resolved` gia' risolti. */
const scrambleCharAt = (target: string, index: number, resolved: number, write: boolean): string => {
  // Gli spazi sono gia' al loro posto: non si scramblano, e cosi' la larghezza
  // della riga non balla.
  if (target[index] === ' ') return ' ';
  // Prima di `resolved` il carattere e' ancora da scoprire: ci mettiamo un
  // simbolo nuovo. Da `resolved` in poi e' definitivo e non cambia piu'.
  if (index < resolved) return target[index];
  // In modalita' `write` le posizioni non risolte restano VUOTE, non simbolo:
  // e' quello che distingue un terminale che scrive da un testo che si compone.
  return write ? '' : randomSymbol();
};

/** Compone la riga per uno stato di risoluzione dato. */
const scrambledAt = (target: string, resolved: number, write = false): string => {
  let out = '';
  for (let i = 0; i < target.length; i += 1) {
    out += scrambleCharAt(target, i, resolved, write);
  }
  return out;
};

export interface ScrambleOptions {
  /** Testo finale: noto dall'inizio, e' la cosa che si deve raggiungere. */
  target: string;
  /** Nodo su cui scrivere il testo mascherato. */
  node: HTMLElement;
  /**
   * `scramble` maschera con simboli casuali, `write` non maschera nulla e
   * limita a comporre il testo carattere per carattere.
   *
   * La seconda modalita' serve alle coordinate: sono una riga di dati, e
   * metterci sopra i simboli trasformerebbe un terminale in un videogioco. Il
   * ritmo e' lo stesso, cambia solo che cosa appare nelle posizioni non
   * ancora risolte: lo spazio, che e' il vuoto giusto per un cursore che
   * scrive.
   */
  mode?: 'scramble' | 'write';
  /** Millisecondi per carattere risolto. */
  interval?: number;
  /** Varianza casuale, in millisecondi, applicata a ogni carattere. */
  variance?: number;
  /** Millisecondi fra un cambio di simboli e il successivo. */
  tick?: number;
  /** Chiamata quando la riga e' completamente risolta. */
  onComplete?: () => void;
  /** Se forzata, ignora la media query di sistema. Serve ai test. */
  reducedMotion?: boolean;
}

export class ScrambleController {
  private target: string;
  private node: HTMLElement;
  private interval: number;
  private variance: number;
  private tick: number;
  private onComplete?: () => void;
  private reducedMotion: boolean;
  /** true = scrittura terminale, false = mascheramento con simboli. */
  private write: boolean;

  /** Caratteri gia' risolti, contati da sinistra. Cresce, non torna indietro. */
  private resolvedCount = 0;
  private timer: number | null = null;
  private running = false;
  private done = false;
  /**
   * Ritardo di ognuno dei caratteri, in ms, nello stesso ordine di `target`.
   *
   * Lo riempie `scheduleDelays()`, che sorteggia una volta sola per avvio. Il
   * campo si dichiara qui come array vuoto e non come semplice `number[]`
   * senza inizializzatore: `useDefineForClassFields` (attivo in questo progetto)
   * definisce comunque la proprieta' alla costruzione, quindi una dichiarazione
   * senza valore iniziale la lascerebbe `undefined` fino al primo sorteggio —
   * e il ciclo in `start()` la legge subito, ricevendo `undefined` nel
   * confronto con `elapsed` invece di un numero.
   */
  private delays: number[] = [];
  /**
   * Scrive lo stato corrente sul nodo, carattere per carattere.
   *
   * E' l'unico posto che sa scrivere: `settle`, `reset` e il ciclo chiamano
   * tutti qui, cosi' non esiste un percorso che mostri il testo finale senza
   * passare da qui — e quindi senza passare dai simboli.
   *
   * Rimuove anche il `visibility: hidden` che il nodo porta dalla nascita: e'
   * il momento esatto in cui il testo diventa visibile, e deve coincidere con
   * il primo simbolo. Senza, il nodo resterebbe nascosto per sempre.
   */
  private render(): void {
    const node = this.node;
    if (this.spans.length !== this.target.length) {
      node.textContent = '';
      this.spans = Array.from({ length: this.target.length }, () => {
        const span = document.createElement('span');
        span.className = SYMBOL_CLASS;
        node.appendChild(span);
        return span;
      });
    }
    for (let i = 0; i < this.target.length; i += 1) {
      // Gli spazi sono gia' al loro posto e non si mascherano, quindi valgono
      // come risolti: e' cio' che tiene ferma la larghezza della riga.
      const resolved = this.target[i] === ' ' || i < this.resolvedCount;
      const char = resolved
        ? this.target[i]
        : (this.write ? '' : randomSymbol());
      const span = this.spans[i];
      if (span.textContent !== char) span.textContent = char;
      const className = resolved ? CHAR_CLASS : SYMBOL_CLASS;
      if (span.className !== className) span.className = className;
    }
    if (node.style.visibility === 'hidden') node.style.removeProperty('visibility');
  }
  /**
   * Gli `<span>` dei caratteri, creati una volta sola.
   *
   * Sono uno per posizione e non si ricreano a ogni giro: il testo cambia
   * ogni 50ms su righe da una quarantina di caratteri, e ricreare i nodi
   * produrrebbe una caterna di mutazioni del DOM che il browser deve
   * elaborare tutta, piu' il costo di Smear su ogni riga a ogni tick. Qui si
   * tocca solo il `textContent` delle caselle che cambiano, e sono poche: quelle
   * risolte in questo giro piu' le non ancora scoperte.
   */
  private spans: HTMLSpanElement[] = [];

  constructor(options: ScrambleOptions) {
    this.target = options.target;
    this.node = options.node;
    this.interval = options.interval ?? 45;
    this.variance = options.variance ?? 10;
    this.tick = options.tick ?? 50;
    this.onComplete = options.onComplete;
    this.write = options.mode === 'write';
    this.reducedMotion = options.reducedMotion ?? reducedMotion;
  }

  /** Il testo attualmente mostrato: simboli e caratteri gia' risolti. */
  get output(): string {
    return scrambledAt(this.target, this.resolvedCount, this.write);
  }

  get isComplete(): boolean {
    return this.done;
  }

  /**
   * Il ritardo di ogni carattere e' sorteggiato UNA volta, all'avvio.
   *
   * Sorteggiarlo a ogni giro cambierebbe la velocita' di risoluzione mentre il
   * testo si compone: una riga potrebbe essere a meta' dopo 200ms e finita
   * dopo 300ms, e lo stagger fra le righe diventerebbe casuale. Qui la somma
   * dei ritardi e' deterministica e le righe restano sincronizzate.
   */
  private scheduleDelays(): void {
    this.delays = Array.from({ length: this.target.length }, () => {
      const jitter = this.variance === 0 ? 0 : (Math.random() * 2 - 1) * this.variance;
      return Math.max(0, this.interval + jitter);
    });
  }

  /** Torna allo stato iniziale: nessun carattere risolto, nessun timer vivo. */
  reset(): void {
    this.stop();
    this.resolvedCount = 0;
    this.done = false;
    this.scheduleDelays();
    this.render();
  }

  /** Ferma l'animazione lasciando il testo dove si trova. */
  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Mostra subito il testo finale, senza animazione. */
  settle(): void {
    this.stop();
    this.resolvedCount = this.target.length;
    this.render();
    this.done = true;
  }

  /**
   * Parte lo scramble, eventualmente dopo un ritardo.
   *
   * Il ritardo serve allo stagger fra le righe: senza, ogni riga partirebbe
   * insieme e l'effetto si leggerebbe come un blocco unico invece che come un
   * testo che si compone riga per riga.
   */
  start(delayMs = 0): void {
    if (this.running || this.done) return;
    this.scheduleDelays();

    // Con movimento ridotto non si scrambla: il testo e' gia' nella sua forma
    // finale e la funzione si dichiara completa. Il testo non deve MAI
    // restare a meta' perche' l'animazione non parte.
    if (this.reducedMotion) {
      this.running = true;
      window.setTimeout(() => {
        // `stop()` non azzera `done`, quindi il nodo resta dichiarato
        // completo: `settle()` lo fa apposta. Qui il controllo serve solo a
        // non scrivere e non notificare se il controller e' stato fermato nel
        // frattempo (smontaggio, nuova sequenza).
        if (!this.running) return;
        this.settle();
        this.onComplete?.();
      }, delayMs);
      return;
    }

    this.running = true;

    let elapsed = 0;
    const step = () => {
      if (!this.running) return;
      // La mascheratura va fatta QUI, dentro il primo giro, e non subito
      // dopo `start()`: il ritardo dello stagger deve posticipare anche
      // l'APPARIRE dei simboli, non solo la loro risoluzione. Mascherando
      // fuori, le quattro righe mostravano i simboli tutte insieme al primo
      // giro di quella che partiva per prima, e lo stagger si vedeva solo
      // nella risoluzione: mezzo effetto, e il testo lampeggiava due volte.
      //
      // `render()` e' anche il momento in cui il nodo perde il
      // `visibility: hidden` di partenza: il testo spunta qui, e solo qui.
      if (elapsed === 0) this.render();
      elapsed += this.tick;

      // Avanza finche' il tempo passato copre il ritardo del carattere
      // successivo. Il ciclo serve perche' a ogni giro possono scadere piu'
      // ritardi insieme: un frame perso o una scheda in secondo piano
      // lascerebbero indietro il resto della riga.
      while (
        this.resolvedCount < this.target.length &&
        elapsed >= this.delays[this.resolvedCount]
      ) {
        elapsed -= this.delays[this.resolvedCount];
        this.resolvedCount += 1;
      }

      this.render();

      if (this.resolvedCount >= this.target.length) {
        this.running = false;
        this.done = true;
        this.timer = null;
        this.onComplete?.();
        return;
      }
      this.timer = window.setTimeout(step, this.tick);
    };

    this.timer = window.setTimeout(step, delayMs > 0 ? delayMs : this.tick);
  }
}

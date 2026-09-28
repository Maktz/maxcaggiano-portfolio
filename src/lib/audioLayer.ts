// LAYER AUDIO.
//
// La macchina e' accesa ma non suona. Tutti gli eventi della sequenza passano
// di qui, il throttle e' gia' al suo posto, il log di sviluppo e' gia' formattato
// e i buffer hanno gia' il registro che li accolgera': quando arrivera' un file
// audio l'unica cosa che resta da fare e' riempirlo e togliere i TODO.
//
// Perche' un modulo cosi' vuoto e' utile. Un suono che si sente solo a meta'
// lavoro si corregge, ma un suono che interrompe una sequenza gia' tarata si
// corregge male: qui la timeline non dipende dal suono, e il suono dipende dalla
// timeline. Perci' l'ordine e' fissato qui dentro, non ai call site.
//
// `unlock()` esiste perche' i browser richiedono un gesto utente prima di
// lasciare suonare qualcosa: il click sul pulsante del preloader e' quel
// gesto, ed e' l'unico momento in cui sara' disponibile.

import { isAudioDebug } from './entryState';


/**
 * Gli eventi della sequenza, ognuno emesso in un punto preciso della timeline.
 *
 * La lista vive qui come costante e il tipo ne deriva: due elenchi separati
 * (uno per il type-check, uno per i call site) possono divergere senza che
 * niente se ne accorga, e un evento emesso ma assente dal tipo semantizza
 * `undefined` senza errori. Derivando l'uno dall'altro non e' possibile.
 */
export const AUDIO_EVENTS = {
  ENTER_CLICK: 'ENTER_CLICK',
  TRANSITION_START: 'TRANSITION_START',
  NAME_TRAVEL: 'NAME_TRAVEL',
  AVATAR_LANDED: 'AVATAR_LANDED',
  SCRAMBLE_START: 'SCRAMBLE_START',
  SCRAMBLE_RESOLVE: 'SCRAMBLE_RESOLVE',
  POSE_CHANGE: 'POSE_CHANGE',
  ROCKET_PASS: 'ROCKET_PASS',
  TRANSITION_END: 'TRANSITION_END',
  BUTTON_HOVER: 'BUTTON_HOVER',
  BUTTON_PRESS: 'BUTTON_PRESS',
} as const;

export type AudioEvent = (typeof AUDIO_EVENTS)[keyof typeof AUDIO_EVENTS];

/** I tasti ammessi, derivati dalla lista: vedi la nota sopra `AUDIO_EVENTS`. */
export type AudioEventKey = keyof typeof AUDIO_EVENTS;

export interface AudioOptions {
  /** Riga di scramble, nome posa, o altro dettaglio utile all'evento. */
  detail?: string | number;
  [key: string]: unknown;
}

/**
 * Come si riproduce un suono, indipendentemente da COSA lo descrive.
 *
 * `AudioOptions` resta accettata perche' i call site di oggi passano gia' un
 * dettaglio (`{ row }`, `{ pose }`) e nessuno deve tornare a modificarli: e'
 * un'intersezione, non una sostituzione, quindi i due usi convivono e nessun
 * modulo cambia i propri import.
 */
export type AudioPlayOptions = AudioOptions & {
  /** 0–1. */
  volume?: number;
  /** playbackRate: 2 raddoppia la velocita', 0.5 la dimezza. */
  pitch?: number;
  /** Secondi di attesa prima di far partire il suono. */
  delay?: number;
};

const isKnownEvent = (event: string): event is AudioEvent =>
  Object.values(AUDIO_EVENTS).includes(event as AudioEvent);

/** I buffer, per evento. La chiave e' il VALORE dell'evento, non il suo nome. */
const buffers = new Map<AudioEvent, AudioBuffer>();

/**
 * L'ultimo istante in cui un evento e' passato dal throttle, per TIPO di evento.
 *
 * Una mappa e non un numero solo: il limite vale per ciascun suono, non per il
 * layer. Con un unico orologio, il viaggio del nome (che ripete ogni 100ms)
 * mangerebbe il budget degli altri eventi e il passaggio si sentirebbe a
 * vuoto solo perche' il logo e' passato un secondo prima.
 */
const lastPlayedAt = new Map<AudioEvent, number>();

/** Distanza minima fra due riproduzioni dello stesso evento, in millisecondi. */
const THROTTLE_MS = 80;

/**
 * L'origine dei timestamp: il click.
 *
 * Si ancora da sola a ENTER_CLICK, che e' il primo evento di ogni sequenza e il
 * suo t=0. Non serve che qualcuno la reimposti da fuori: arriva sempre, e a ogni
 * nuova sequenza arriva di nuovo, quindi il reset e' gratis e non puo' dimenticarsi
 * di farlo. Senza questo, "relativo all'inizio della sequenza" sarebbe un numero
 * che qualcuno deve ricordarsi di azzerare, e prima o poi non lo farebbe.
 */
let sequenceStartedAt: number | null = null;

const debugOn = (): boolean => isAudioDebug();

export const audio = {
  /**
   * Il context. `null` finche' `unlock()` non viene chiamata: e' la condizione
   * che tiene spento tutto il layer, e un context creato prima del gesto utente
   * resterebbe sospeso per sempre in Safari e iOS.
   */
  ctx: null as AudioContext | null,

  /** Chiamato dal click del pulsante: è il gesto utente che i browser pretendono. */
  unlock(): void {
    if (this.state.unlocked) return;
    // TODO: creare l'AudioContext qui, e SOLO qui:
    //   this.ctx = new AudioContext({ sampleRate: 44100 })
    // Va fatto una volta sola e solo dopo il gesto utente.
    this.state.unlocked = true;
    if (debugOn()) console.info('[audio] unlocked');
    // L'evento serve al debug e a un eventuale toggle UI che debba sapere
    // quando il layer e' diventato utilizzabile senza interrogarlo ogni frame.
    window.dispatchEvent(new CustomEvent('audio:unlocked'));
  },

  /**
   * Registra il suono di un evento. Chiamato quando gli asset arriveranno.
   *
   * Il buffer non si tocca: entra nel registro e basta. Il giorno in cui
   * `play()` riprodurra' davvero, il suono sara' gia' decodificato qui dentro
   * e non nel mezzo di una sequenza.
   */
  register(event: AudioEventKey, buffer: AudioBuffer): void {
    if (!isKnownEvent(event)) {
      console.warn(`[audio] evento sconosciuto in register(): ${event}`);
      return;
    }
    buffers.set(AUDIO_EVENTS[event], buffer);
  },

  /**
   * Riproduce un evento. Silenzioso finche' non ci sono asset.
   *
   * L'ordine conta, e non e' una scelta di stile. Il log sta PRIMA del controllo
   * sul context, perche' il context oggi non esiste e deve continuare a non
   * esistere: se il controllo venisse prima, `play()` uscirebbe sempre e in
   * `?debug=audio` non comparirebbe una riga, rendendo lo strumento di debug
   * useless proprio mentre si sta preparando il terreno ai suoni.
   *
   * Sbloccato e acceso stanno invece davanti a tutto, perche' quelli sono
   * rumore vero: un evento audio che arriva prima del gesto utente, o a layer
   * spento, non e' un suono che l'utente si aspetta e non deve nemmeno essere
   * annunciato.
   */
  play(event: AudioEventKey, options?: AudioPlayOptions): void {
    if (!this.state.unlocked || !this.state.enabled) return;

    const key = AUDIO_EVENTS[event];
    const now = performance.now();
    // L'ancoraggio al click avviene qui, non in un setter: ENTER_CLICK e' il
    // primo evento che passa di qui in ogni sequenza, quindi non si puo' perdere.
    if (key === AUDIO_EVENTS.ENTER_CLICK) sequenceStartedAt = now;

    // Il throttle viene DOPO i rifiuti e PRIMA del log: se un evento e'
    // soppresso non lo si annuncia, altrimenti il log direbbe la verita' sul
    // suono e la menzogna sul timestamp.
    const previous = lastPlayedAt.get(key);
    if (previous !== undefined && now - previous < THROTTLE_MS) return;
    lastPlayedAt.set(key, now);

    if (debugOn()) {
      const rel = sequenceStartedAt === null ? 0 : Math.round(now - sequenceStartedAt);
      const volume = options?.volume ?? 1;
      const pitch = options?.pitch ?? 1;
      const missing = buffers.has(key) ? '' : ' (no buffer)';
      console.info(`[audio:${rel}] ${key} vol=${volume} pitch=${pitch}${missing}`);
    }

    // Da qui in giu' comincia il suono vero, e senza context non c'e' niente da
    // suonare. Il ramo resta silenzioso perche' un evento audio non deve mai
    // fermare la sequenza: un suono che manca e' un suono che non c'e'.
    if (this.ctx === null) return;
    const buffer = buffers.get(key);
    if (!buffer) return;
    // TODO: riproduzione vera.
    //   const source = this.ctx.createBufferSource();
    //   source.buffer = buffer;
    //   source.playbackRate.value = options?.pitch ?? 1;
    //   const gain = this.ctx.createGain();
    //   gain.gain.value = options?.volume ?? 1;
    //   source.connect(gain).connect(this.ctx.destination);
    //   source.start(this.ctx.currentTime + (options?.delay ?? 0));
  },

  /** Accende o spegne l'intero layer. */
  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    // L'evento parte SEMPRE, anche quando si spegne: e' l'unico modo che ha
    // una UI per sapere di essere stata spenta, dato che `play()` da spento
    // tace e non lascia traccia.
    window.dispatchEvent(new CustomEvent('audio:enabled-changed', { detail: { enabled } }));
  },

  /**
   * Stato esposto per il debug e per i test.
   *
   * E' un oggetto vivo, non una copia: `audio.state.unlocked` letto dopo
   * `unlock()` deve dire `true`, quindi non si puo' restituire `{ ...state }`.
   */
  state: {
    unlocked: false,
    enabled: true,
  },
};

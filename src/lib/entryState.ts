// MACCHINA A STATI DELLA SEQUENZA D'INGRESSO.
//
// Unica fonte di verità dell'ingresso: `preloader -> entering -> hero`.
// Nessun'altra parte dell'app deve ricavare la fase da uno scroll, da un
// timeout o da una variabile locale: qui c'è il solo posto in cui la fase
// cambia, e chiunque vi si iscrive viene avvisato.
//
// Non è Redux né Zustand: sono una variabile, un Set di ascoltati e tre
// metodi. Lo stato è una macchina a tre valori e non una gerarchia di reducer,
// quindi la struttura che lo rende complicato non servirebbe a niente.

export type EntryState = 'preloader' | 'entering' | 'hero';

/**
 * true se l'URL porta il flag indicato.
 *
 * `URLSearchParams` invece di un `indexOf` sulla query: `?skip` non deve
 * accendere `?skipper`, e `?debug=audio` è una chiave sola (`debug`), non
 * due parametri. Lo stesso lettore serve per i flag di sviluppo e per il
 * log degli eventi audio, quindi le due cose non possono divergere.
 */
export const hasUrlFlag = (flag: string): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has(flag);
};

/**
 * Come `hasUrlFlag`, ma per i flag che portano un valore: `?debug=audio`.
 *
 * `has()` NON va bene per quelli: cerca un NOME di chiave, e `debug=audio` non
 * ne e' uno, quindi `has('debug=audio')` risponderebbe sempre `false` e il log
 * non partirebbe mai. Un flag con valore si riconosce dalla chiave col valore
 * letto accanto: `get('debug') === 'audio'`.
 */
export const hasUrlValue = (key: string, value: string): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(key) === value;
};

/** Sviluppo: salta preloader e sequenza, si parte dalla prima pagina. */
export const isSkipEntry = (): boolean => hasUrlFlag('skip');

/** Sviluppo: log in console degli eventi con timestamp relativo. */
export const isAudioDebug = (): boolean => hasUrlValue('debug', 'audio');

// Con `?skip` lo stato iniziale è già `hero`: saltare il preloader NON è una
// transizione, è il punto di partenza. Farlo qui e non in un effetto evita
// che il primo render dipinga un frame di preloader prima di corregersi.
let current: EntryState = isSkipEntry() ? 'hero' : 'preloader';

// Copia locale: durante un `set` un listener potrebbe disiscriversi, e
// iterare il Set mentre cambia size salterebbe il secondo ascoltato.
const listeners = new Set<(state: EntryState) => void>();

if (isAudioDebug()) {
  console.info(`[entry] stato iniziale: ${current}`);
}

export const entryState = {
  /** Fase corrente. */
  get: (): EntryState => current,

  /**
   * Porta a una nuova fase. Una transizione verso lo stesso valore non e'
   * un evento: senza questo guard, `unlockScroll()` chiamato due volte
   * ripeterebbe il lavoro e ripeterebbe il log.
   */
  set: (next: EntryState): void => {
    if (next === current) return;
    const previous = current;
    current = next;
    if (isAudioDebug()) console.info(`[entry] ${previous} -> ${next}`);
    [...listeners].forEach((notify) => notify(next));
  },

  /** Sottoscrizione: ritorna la funzione di disiscrizione. */
  subscribe: (notify: (state: EntryState) => void): (() => void) => {
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  },
};
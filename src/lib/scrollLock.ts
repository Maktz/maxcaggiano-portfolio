import type Lenis from 'lenis';
import { entryState } from './entryState';
import { invalidateSceneTops } from './scrollMath';

// BLOCCO DELLO SCROLL FINO A FINE SEQUENZA.
//
// Lo scroll e' congelato in due modi indipendenti, perche' ognuno copre un
// buco dell'altro:
//
//   1. Lenis: `stop()` sospende il motore, quindi rotella, touch e la coda
//      esponenziale non producono piu' nessun movimento.
//   2. overflow nascosto + tastiera: `lenis.stop()` da solo NON basta. Il
//      documento resta scorrevole in modo nativo (tasti, selezione,accessibilita')
//      e sui browser che non toccano Lenis — o se l'istanza non e' ancora nata
//      quando arriva il primo gesto — lo scroll passerebbe.
//
// La compensazione della scrollbar e' la parte che va fatta bene: nascondere
// l'overflow toglie dalla viewport la colonna della barra, il contenuto si
// allarga di quegli stessi pixel e TUTTO il layout si sposta di un colpo. Il
// padding equivalente sul body riapre lo spazio, quindi il documento resta
// identico prima e dopo il blocco.
//
// L'istanza di Lenis la registra il provider che la crea. Non viene importata
// qui: un import diretto creerebbe un ciclo (scrollLock -> provider ->
// scrollMath), e inoltre l'istanza vive in un `useState` del provider, quindi
// non e' esportabile come valore.

let lenisInstance: Lenis | null = null;

/** Chiamato dal provider all'atto della creazione dell'istanza. */
export const registerLenis = (instance: Lenis): void => {
  lenisInstance = instance;
};

// Le chiavi che fanno scorrire la pagina. `Space` e' scritto anche come
// 'Spacebar' per i browser che non hanno adottato il nome moderno: senza,
// la barra spaziatrice — la scorciatoia piu' naturale — resterebbe attiva.
const SCROLL_KEYS = new Set([
  'Space',
  'Spacebar',
  'PageDown',
  'PageUp',
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
]);

let locked = false;
let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

/**
 * Tastiera bloccata solo durante preloader ed entering.
 *
 * Lo stato si legge a ogni pressione invece di essere chiuso dentro
 * `lockScroll`: e' `unlockScroll` a rimuovere il listener, ma la lettura
 * rende la condizione esplicita anche per chi legge il file, e lascia il
 * listener innocuo se per un errore sopravvivesse allo sblocco.
 */
const onKeyDown = (event: KeyboardEvent) => {
  if (entryState.get() === 'hero') return;
  if (!SCROLL_KEYS.has(event.key)) return;
  // preventDefault, non stopPropagation: il tasto deve proprio non arrivare
  // al documento, altrimenti il browser lo tradurrebbe in scroll nativo
  // annullando il blocco.
  event.preventDefault();
};

let compensationPx = 0;

/**
 * Blocca lo scroll. Idempotente: chiamarla due volte non applica due volte la
 * compensazione, che sommerebbe due padding e stringerebbe il layout.
 */
export const lockScroll = (): void => {
  if (typeof window === 'undefined' || locked) return;
  locked = true;

  // La misura va PRIMA di nascondere l'overflow: dopo, `clientWidth` coincide
  // con `innerWidth` e la differenza vale sempre zero, cioè nessuna
  // compensazione per un blocco che in realtà sposta il layout.
  compensationPx = Math.max(0, window.innerWidth - document.documentElement.clientWidth);

  lenisInstance?.stop();

  if (compensationPx > 0) {
    document.body.style.paddingRight = `${compensationPx}px`;
  }
  // `html` e non solo `body`: è l'elemento che scorre, e bloccando il padre
  // il figlio non eredita nulla da fermare da solo.
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  keydownHandler = onKeyDown;
  window.addEventListener('keydown', keydownHandler, { passive: false });
};

/**
 * Sblocca lo scroll e rimette le misure al posto.
 *
 * L'ordine conta: prima si rimuove il blocco e si ripristina il layout, POI
 * si rimisura. Rilevare prima dell'unlock misurerebbe un documento fuori
 * vista, e la barra ricomparirebbe con la larghezza sbagliata.
 *
 * `lenis.resize()` e `invalidateSceneTops()` rimettono al passo i trigger di
 * scroll esistenti (gli stop magnetici delle sezioni successive): senza, le
 * quote sarebbero quelle misurate col preloader ancora a schermo.
 */
export const unlockScroll = (): void => {
  if (typeof window === 'undefined') return;
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
  if (!locked) {
    // Idempotente come il blocco: senza questo guard, una seconda chiamata
    // rimisurerebbe la pagina due volte.
    entryState.set('hero');
    return;
  }
  locked = false;

  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  if (compensationPx > 0) {
    document.body.style.paddingRight = '';
    compensationPx = 0;
  }

  lenisInstance?.start();
  lenisInstance?.resize();
  invalidateSceneTops();

  entryState.set('hero');
};

/** Stato del blocco, per il debug e per i test. */
export const isScrollLocked = (): boolean => locked;
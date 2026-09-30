// IL PONTE DELL'INGRESSO DELLA PRIMA PAGINA.
//
// L'orchestratore (EntrySequence) e' un componente che non rende nulla: vive
// in un effetto, e un effetto non puo' essere chiamato da un altro effetto se
// non attraverso qualcosa di condiviso. Qui c'e' quel qualcosa di condiviso:
// due funzioni e non un oggetto di stato, perche' lo stato vero e' gia' in
// `entryState` e duplicarlo qui significherebbe avere due verita'.
//
// Un file suo e non dentro EntrySequence perche' un modulo che esporta sia un
// componente sia funzioni fa saltare il fast refresh: in sviluppo ogni
// salvataggio ricaricherebbe l'intera pagina.
//
// IL CONTRATTO E' UNA SOLA FUNZIONE. Il ritorno dalla sezione lavori non passa
// dallo stato d'ingresso — quello e' gia' `hero` e non cambia piu' — quindi il
// chiamante ha bisogno di una via che dica "riporta la prima pagina al suo stato
// completo". Il difetto che questo file risolve e' proprio che l'ingresso non
// aveva un'uscita: la sequenza partiva una volta sola e niente la richiamava,
// quindi al ritorno dalla Works la pagina si ritrovava a meta' ingresso, con
// solo titolo e sottotitolo. Qui si richiama L'INGRESSO STESSO, non una
// scorciatoia: e' la stessa funzione che il click sul preloader usa.

import { isHeroReady, setHeroReady } from './entryState';

type EntryRunner = () => void;
type HeroSettler = () => void;
type HeroNavigator = () => void;

let runner: EntryRunner | null = null;
let settler: HeroSettler | null = null;
let navigator: HeroNavigator | null = null;

/**
 * Chiamato dalla pagina per pubblicare il «torna alla prima pagina».
 *
 * Vive in questo file e non in `HeroScene` perché a muovere lo scroll serve
 * l'istanza di Lenis, che appartiene al provider e non a nessun componente: è
 * la stessa separazione che giustifica `runner` e `settler` — chi sa fare la
 * cosa lo dichiara, chi ha bisogno di farlo chiama.
 */
export const registerHeroNavigation = (fn: HeroNavigator): void => {
  navigator = fn;
};

/** Chiamato dalla pagina allo smontaggio, per lo stesso motivo di `clearHeroEntry`. */
export const clearHeroNavigation = (): void => {
  navigator = null;
};

/**
 * Riporta lo scroll alla prima pagina: è l'azione del marchio dell'header, che
 * quando è a posto è lo stesso ritratto dell'hero.
 *
 * NON chiama `settleHero`, e non deve: tornando indietro `flight` rientra a 0 da
 * sé e il richiamo automatico che è già in `HeroScene` rimette la pagina a
 * posto. Chiamarlo anche qui la rimetterebbe a posto due volte, e il doppio
 * richiamo si tradurrebbe in un lampo a metà dello scroll di ritorno.
 */
export const scrollToHero = (): void => {
  navigator?.();
};

/** Chiamato dall'orchestratore per pubblicare il proprio ingresso. */
export const registerHeroEntry = (fn: EntryRunner): void => {
  runner = fn;
};

/** Chiamato dall'orchestratore per pubblicare il proprio ripristino. */
export const registerHeroSettle = (fn: HeroSettler): void => {
  settler = fn;
};

/** Chiamato dall'orchestratore allo smontaggio. */
export const clearHeroEntry = (): void => {
  runner = null;
  settler = null;
};

/**
 * Riporta la prima pagina al suo stato completo, riavviando l'ingresso.
 *
 * E' il percorso dell'ARRIVO dal preloader: viso che entra, testo che si compone,
 * attesa della sorpresa. Non lo si usa sul ritorno, perche' l'utente non sta
 * arrivando da capo e quei secondi si leggono come un lag. Per il ritorno c'e'
 * `settleHero`.
 *
 * Se l'orchestratore non e' ancora montato e' un no-op silenzioso, non un
 * errore: il ritorno dalla Works non puo' accadere prima che l'ingresso sia
 * esistito, quindi la condizione indica un problema altrove e non vale la pena
 * interromperlo qui.
 */
export const runHeroEntry = (): void => {
  runner?.();
};

/**
 * RIPRISTINA la prima pagina sul ritorno dalla sezione lavori, di colpo.
 *
 * La differenza rispetto a `runHeroEntry` e' tutta la questione del ritorno: qui
 * non si riproduce l'arrivo, si rimette a posto cio' che c'era gia'. Il testo va
 * nella sua forma finale senza ricomporsi, il ritratto torna al suo posto senza
 * salire dal bordo, coordinate e prompt si accendono. Nessun timer e nessuna
 * attesa, quindi niente lag.
 *
 * Idempotente: chiamarla quando la pagina e' gia' intera non fa nulla di
 * osservabile, quindi un richiamo in piu' non lascia la pagina in uno stato
 * diverso.
 */
export const settleHero = (): void => {
  settler?.();
};

// ── IL REGISTRO DEI LISTENER DELLA FINE INGRESSO ───────────────────────────
//
// Vive qui e non in EntrySequence perche' quel modulo esporta anche un
// componente, e un file con piu' tipi di export fa saltare il fast refresh: in
// sviluppo ogni salvataggio ricaricherebbe l'intera pagina. Lo stesso motivo
// per cui `runHeroEntry` sta gia' in questo file.

const heroReadyListeners = new Set<() => void>();

/**
 * Iscrizione alla fine dell'ingresso. Ritorna la funzione di disiscrizione.
 *
 * Se la prima pagina e' GIA' completa quando ci si iscrive, l'avviso parte
 * subito: chi arriva tardi (per esempio un rimontaggio) non puo' aspettare un
 * evento che e' gia' passato, e senza questo la pagina resterebbe a meta'
 * ingresso per sempre.
 *
 * Sono un Set e non un singolo campo perche' a ognuno serve la stessa cosa
 * (sapere che la prima pagina e' completa) e nessuno deve poter impedire
 * l'avviso agli altri. Ogni chiamante si cancella da solo nel proprio cleanup.
 */
export const onHeroReady = (notify: () => void): (() => void) => {
  heroReadyListeners.add(notify);
  if (isHeroReady()) notify();
  return () => {
    heroReadyListeners.delete(notify);
  };
};

/**
 * Dice che la prima pagina e' completa, a chi aspetta.
 *
 * Idempotente per costruzione: la guardia e' dentro `setHeroReady`, quindi un
 * secondo richiamo quando la pagina e' gia' intera non ripete nulla. E' la
 * parte che rende l'ingresso riutilizzabile dal ritorno dalla Works: la
 * seconda volta parte, mette su tutto quello che manca e non tocca quello che
 * e' gia' a posto.
 */
export const announceHeroReady = (): void => {
  setHeroReady(true);
  [...heroReadyListeners].forEach((notify) => notify());
};

/** Svuota il registro: va chiamato allo smontaggio dell'orchestratore. */
export const clearHeroReady = (): void => {
  heroReadyListeners.clear();
};

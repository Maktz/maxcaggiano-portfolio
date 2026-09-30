// IL CONTRATTO DEL MODAL "AGGIUNGI IL TUO PROGETTO".
//
// Vive in un file suo, e non dentro AddProjectCard né dentro il modal, per la
// stessa ragione che ha spinto `heroEntryControl` fuori da EntrySequence: un
// modulo che esporta insieme un componente e funzioni fa saltare il fast
// refresh, e in sviluppo ogni salvataggio ricaricherebbe l'intera pagina.
//
// Il ponte è a due pezzi, ed è la stessa forma di `heroEntryControl`: chi apre
// (`registerAddProjectModal`) e chi chiude (`openAddProjectModal`). Non è una
// semplificazione: il card non può rendersi conto dell'esistenza del modal, e il
// modal non deve sapere nulla delle card.
//
// `origin` è il rettangio della card al momento del click, e serve al FLIP: il
// pannello non appare dal nulla al centro, ma CRESCE da dove l'utente ha
// toccato. Chi chiama senza rettangio (per esempio un test, o la tastiera) non
// rompe niente: il modal parte semplicemente già centrato.
type AddProjectModalOpener = (origin: DOMRect | null) => void;

let opener: AddProjectModalOpener | null = null;

/** Chiamato dal modal al montaggio per pubblicare l'apertura. */
export const registerAddProjectModal = (fn: AddProjectModalOpener): void => {
  opener = fn;
};

/** Chiamato allo smontaggio del modal. */
export const clearAddProjectModal = (): void => {
  opener = null;
};

/**
 * Apre il modal «Aggiungi il tuo progetto», indicando da dove si parte.
 *
 * `origin` è opzionale di proposito: la card passa il proprio rettangolo, ma
 * un chiamante che non ce l'ha (o un rettangolo già nullo perché la card è stata
 * rimossa) apre comunque il dialog, solo senza l'espansione. Un dialog che non
 * si apre è un difetto molto peggio di un dialog che si apre in modo semplice.
 */
export const openAddProjectModal = (origin: DOMRect | null = null): void => {
  opener?.(origin);
};
// IL COPY DELLA PRIMA PAGINA.
//
// Il testo e' l'unica cosa che HeroScene (che lo disegna) ed EntrySequence (che
// lo fa apparire) devono concordare. Se le due copie dell'headline vivessero
// in due file, un refuso in una lascerebbe lo scramble a risolvere una stringa
// diversa da quella realmente scritta, e l'errore non si vedrebbe: il testo
// si comporre lo stesso, solo con un carattere sbagliato.
//
// I selettori sono qui per lo stesso motivo: EntrySequence deve trovare esattamente
// i nodi che HeroScene ha creato, e l'unico modo perche' non possano divergere
// e' che nessuno dei due li scriva a mano.

/** Le tre righe dell'headline. Tre scramble indipendenti, tre tempi diversi. */
export const HEADLINE_ROWS = ['Ogni brand', 'merita il', 'suo universo.'] as const;

/**
 * La sub-headline, che arriva per ultima.
 *
 * Senza parentesi quadre: le parentesi erano un richiamo alle etichette del
 * sito (le quote geografiche, la telemetria), ma qui la riga non e' un
 * valore di sistema, e' la descrizione di quello che si fa. Con le parentesi
 * sembrava una quarta etichetta tecnica e non un sottotitolo.
 */
export const SUBHEADLINE = 'Creative direction & Brand design';

/** Nodo su cui il testo viene scritto durante lo scramble. */
export const SCRAMBLE_ROW_SELECTORS = [
  '[data-scramble-row="0"]',
  '[data-scramble-row="1"]',
  '[data-scramble-row="2"]',
] as const;

/** Nodo della sub-headline. */
export const SCRAMBLE_SUBHEADLINE_SELECTOR = '[data-scramble-row="subheadline"]';

/**
 * Il testo finale di ogni riga, nell'ordine in cui le righe vengono scrambleate.
 *
 * L'indice 3 e' la sub-headline, che non e' una riga dell'headline ma condivide
 * lo stesso meccanismo e lo stesso evento audio: le due cose insieme permettono
 * all'orchestratore di trattarle con un unico ciclo, senza un caso speciale.
 */
export const SCRAMBLE_ROWS = [...HEADLINE_ROWS, SUBHEADLINE] as const;

/** Identificatore di una riga, usato dagli eventi audio. */
export const SCRAMBLE_ROW_IDS = [0, 1, 2, 'subheadline'] as const;

// ── LE COORDINATE ─────────────────────────────────────────────────────────
//
// Sono gia' nel DOM fin dall'inizio, ma durante l'ingresso non devono esserci:
// il lettore deve incontrare i testi che la pagina sta announcing, non un
// elenco di coordinate che si scrive da solo.
//
// Vengono scritte in modalita' `write`, carattere per carattere, e senza
// simboli: sono dati, non un titolo, e mascherarli sembrerebbe un errore.

/** Il blocco geografico in alto a destra: due righe, Milano e Potenza. */
export const COORD_MILANO = '[MILANO - 45.4642 N, 9.1900 E]';
export const COORD_POTENZA = '[POTENZA - 40.6398 N, 15.8054 E]';
/** La telemetria in basso a sinistra. */
export const COORD_VIA_LATTEA = '[VIA LATTEA - 266.4168, -29.0078]';

/** I tre nodi da scrivere, nell'ordine in cui compaiono. */
/** I tre testi, nell'ordine dei selettori. */
export const COORD_TEXTS = [COORD_MILANO, COORD_POTENZA, COORD_VIA_LATTEA] as const;

export const COORD_SELECTORS = [
  '[data-coord="milano"]',
  '[data-coord="potenza"]',
  '[data-coord="via-lattea"]',
] as const;

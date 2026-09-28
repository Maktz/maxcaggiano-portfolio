// PREFERENZA DI MOVIMENTO RIDOTTO — UNICA FONTE DI VERITA'.
//
// Prima questa domanda aveva cinque risposte indipendenti, tutte uguali e tutte
// in un punto diverso. Cinque copie di una domanda che non cambia durante la
// visita sono cinque occasioni di rispondere in modo diverso: e se una sola
// rispondesse "no", la sequenza avrebbe un pezzo animato dentro una pagina che
// l'utente ha chiesto di non muovere, e il difetto sarebbe invisibile in tutti
// i test che non controllano proprio quel pezzo.
//
// Il valore e' letto una volta sola, all'import. Non e' una scelta di pigrizia:
// e' quello che chiede la specifica, e ha un vantaggio concreto — l'intera
// pagina parte da una decisione coerente, e un modulo che legge il valore non
// puo' beccare la risposta nel mezzo di una sequenza. Il prezzo e' noto: chi
// cambia l'impostazione del sistema a meta' visita non vede effetti fino al
// ricaricamento. Per questa pagina e' il taio giusto: cambiare la preferenza
// e' un gesto raro, e ricaricare perche' l'ha fatto cambiare una pagina web
// sarebbe una sorpresa peggiore.

/**
 * true se l'utente ha chiesto meno animazione.
 *
 * Esportato come costante e non come funzione perche' il chiamante non deve
 * poter dimenticarsi di invocarlo: `if (reducedMotion)` e' un controllo che si
 * legge, `if (prefersReducedMotion())` e' una chiamata che si puo' saltare per
 * distrazione, e la distrazione in un `if` di questo genere e' esattamente il
 * difetto che il modulo vuole impedire.
 */
export const reducedMotion: boolean =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

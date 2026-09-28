// IL REGISTRO DEGLI HINT DI SCROLL.
//
// Un hint e' un elemento di React e la sequenza e' un modulo: senza un ponte
// fra i due, l'orchestratore dovrebbe tenere un ref a un elemento che non e'
// un pulsante, che e' il modo piu' fragile di agganciare due cose. Qui basta una
// funzione: l'hint si registra quando e' pronto, la sequenza la chiama quando
// e' l'ora.
//
// Vive in un file suo e non dentro ScrollHint perche' un file di componente che
// esporta anche funzioni fa saltare il fast refresh: in sviluppo ogni salvataggio
// ricaricarebbe l'intera pagina. Il componente e' il solo consumatore, e il
// modulo non sa nulla di React.
//
// Uno solo, non una lista: l'ingresso ne ha un hint. Se un giorno ce ne fossero
// due, saprei quale si deve muovere e gli altri restare fermi, quindi una lista
// sarebbe una scelta che oggi non ha motivo di esistere.
let starter: (() => void) | null = null;

export const registerScrollHint = (fn: () => void): void => {
  starter = fn;
};

export const clearScrollHint = (): void => {
  starter = null;
};

/**
 * Avvia lo scramble dell'hint.
 *
 * Non fa niente se l'hint non e' ancora pronto: e' un no-op silenzioso perche'
 * l'ordine dei due e' un dettaglio di montaggio, non un errore da segnalare.
 * Con `?skip` e con movimento ridotto e' l'unico modo in cui l'hint compare,
 * perche' in entrambi i casi la sequenza non arriva a chiamarlo dal suo elenco.
 */
export const startScrollHint = (): void => {
  starter?.();
};
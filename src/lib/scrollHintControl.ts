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

/** true se l'hint ha gia' pubblicato il suo starter e puo' essere avviato. */
export const isScrollHintReady = (): boolean => starter !== null;

/**
 * Avvia lo scramble dell'hint. Restituisce false se l'hint non e' ancora pronto.
 *
 * Il ritorno serve perche' questo e' un no-op SILENZIOSO quando il ponte non e'
 * stato costruito: e' gia' un difetto noto, e prima accettarlo in silenzio ha
 * reso invisibile un blocco pagina intero.
 *
 * Il caso reale, misurato in `vite preview` su 1512x780, 1280x720 e 390x844:
 * dopo 10 secondi la pagina era ancora `lenis lenis-stopped` con
 * `overflow: hidden`, l'hint era `0x0 visibility: hidden`, e lo scroll non
 * rispondeva a nessun gesto. La sequenza agganciava lo SBLOCCO a questo
 * richiamo (vedi `EntrySequence`), che in quel ramo e' l'unico: un no-op vuoto
 * lasciava la pagina congelata per sempre, con la Works che non si apriva e le
 * card che non comparivano piu'.
 *
 * Chi ascolta puo' cosi' distinguere "l'hint e' partito" da "l'hint non esiste
 * ancora", e sbloccare comunque: e' un'animazione, non un prerequisito.
 */
export const startScrollHint = (): boolean => {
  if (!starter) return false;
  starter();
  return true;
};
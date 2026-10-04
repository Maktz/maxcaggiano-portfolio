/**
 * IL COPY DI «IL MIO METODO».
 *
 * Le quattro fasi sono una lista, non quattro JSX: il tracciato le mette in
 * fila, il razzo le attraversa nell'ordine in cui sono dichiarate qui, e
 * l'ordine è anche quello in cui le card si accendono. Se l'array e il tracciato
 * contenessero i numeri ciascuno per conto proprio, il razzo atterrerebbe sulla
 * card sbagliata.
 */

export interface MethodPhase {
  /** Numero della tappa, due cifre: 01…04. */
  code: string;
  /** Etichetta breve della tappa: ciò che la stazione dichiara. */
  name: string;
  /** Titolo slab della card. */
  title: string;
  /** Testo mono della card. */
  body: string;
}

export const METHOD_LABEL = '[ROTTA DI VOLO]';
export const METHOD_HEADLINE = 'Quattro tappe. Nessun salto nel vuoto.';

export const METHOD_PHASES: MethodPhase[] = [
  {
    code: '01',
    name: 'ANALISI DI MERCATO',
    title: 'Mappo il territorio.',
    body: 'Studio settore, concorrenti e pubblico prima di toccare un pixel. Capire dove si trova il tuo brand e dove c’è spazio libero.',
  },
  {
    code: '02',
    name: 'OBIETTIVI E TOUCH POINT',
    title: 'Fisso la rotta.',
    body: 'Definiamo cosa deve ottenere il progetto e in quali punti il brand incontra le persone: sito, social, packaging, suono. Ogni punto di contatto ha un ruolo.',
  },
  {
    code: '03',
    name: 'PROGETTAZIONE E REVISIONI',
    title: 'Costruisco. Poi aggiustiamo insieme.',
    body: 'Disegno, animo, scrivo. Presento, ascolto, rifinisco. Le revisioni fanno parte del viaggio, non sono un imprevisto.',
  },
  {
    code: '04',
    name: 'PUBBLICAZIONE E REPORTISTICA',
    title: 'Atterriamo. E misuriamo.',
    body: 'Il progetto va online, poi leggiamo i numeri insieme: cosa funziona, cosa migliorare, dove andare dopo.',
  },
];

/** L'etichetta HUD della sezione, in basso a sinistra. */
export const COORD_ROTTA = '[ROTTA - 4 TAPPE]';

/** La riga di chiusura, sopra al bottone. */
export const METHOD_CLOSING = '[PRONTO AL DECOLLO?]';

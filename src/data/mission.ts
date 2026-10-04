/**
 * IL COPY DI «CHI SONO».
 *
 * Vive in un file suo, come `projects.ts`, per un motivo pratico: la scheda
 * missione è una lista di righe chiave/valore, e tenere l'array dentro il
 * componente significherebbe che la griglia, le chiavi e i valori possono
 * crescere senza che nessuno li legga come un blocco. Il testo è l'unica cosa
 * che qui non è token.
 */

/** Le righe della «scheda missione», nell'ordine in cui sono mostrate. */
export interface MissionRow {
  key: string;
  value: string;
}

export const MISSION_LABEL = '[IDENTIFICATIVO PILOTA]';
export const MISSION_HEADLINE = 'Disegno universi. E li faccio suonare.';

export const MISSION_PARAGRAPHS = [
  "Sono Max, creative director e brand designer. Prendo un marchio e gli costruisco attorno un mondo: identità, motion, suono. Tutto coerente, tutto riconoscibile.",
  "Vengo dall'audio. A Potenza faccio parte di ADA.lab: sala di registrazione, sala prove, studio di mix & mastering. Lì ho imparato che un'identità si sente prima ancora di vedersi: ritmo, calore, dettagli analogici che restano addosso. Oggi unisco le due metà in un unico flusso, con un solo interlocutore.",
] as const;

/** L'etichetta in alto alla scheda: una sola scheda, quindi un solo numero. */
export const MISSION_CARD_LABEL = '[SCHEDA 01 / 01]';

export const MISSION_ROWS: MissionRow[] = [
  { key: 'RUOLO', value: 'Creative direction & Brand design' },
  { key: 'BASE', value: 'Milano / Potenza' },
  { key: 'STUDIO', value: 'ADA.lab' },
  {
    key: 'DISCIPLINE',
    value: 'Brand identity · Motion design · Audio production · Mix & mastering',
  },
];

/** L'etichetta HUD della sezione, in basso a sinistra. */
export const COORD_BASE_OPERATIVA = '[BASE OPERATIVA - 40.6398, 15.8054]';

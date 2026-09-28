export const BRAND_TITLE_TEXT = 'MAX CAGGIANO';

export const BRAND_TITLE_COMMON_CLASS =
  'font-display font-extrabold !leading-none tracking-tight text-accent antialiased';

/**
 * Classe del titolo nel preloader. Uguale a quella comune ma SENZA
 * `tracking-tight`: la spaziatura qui e' pilotata da una MotionValue (inline,
 * quindi priorita' assoluta) e la classe ne annullerebbe l'effetto. Il titolo
 * dell'header invece continua a usare il tracking statico.
 */
export const BRAND_TITLE_PRELOADER_CLASS =
  'font-display font-extrabold !leading-none text-accent antialiased';

export const BRAND_TITLE_HEADER_CLASS =
  `${BRAND_TITLE_COMMON_CLASS} text-2xl md:text-4xl`;

/**
 * Spaziatura fra le lettere nel preloader, espressa in em come il tracking
 * dell'header. `tracking-tight` (Tailwind) vale -0.025em: partire da 0 rende il
 * titolo piu' aperto e disteso, coerente con la dimensione +1/4.
 *
 * Non puo' restare cosi' fino all'arrivo: l'handoff deve sovrapporre il titolo
 * del preloader a quello dell'header al pixel, quindi la spaziatura torna
 * linearmente al valore dell'header (BRAND_TITLE_HEADER_TRACKING_EM) prima che
 * i due titoli si sovrappongano.
 */
export const BRAND_TITLE_PRELOADER_TRACKING_EM = 0;

export const BRAND_TITLE_HEADER_TRACKING_EM = -0.025;

/**
 * Dimensione del titolo nel preloader a scroll 0.
 *
 * +1/4 applicato due volte rispetto al valore di partenza: 96/72/48 -> 120/90/60 -> 150/90/60.
 *
 * I breakpoint NON sono piu' una semplice scalata dello stesso fattore: il
 * titolo e largo ~8.09px per ogni px di font-size (misurato a 120px: 970.41px
 * di larghezza), quindi la dimensione massima dipende dalla viewport disponibile.
 * Con 150px servono >= 1319px: su viewport piu strette il titolo verrebbe
 * tagliato dal bordo. Le soglie sono quindi ricalcolate perch ogni fascia
 * tenga il titolo entro il ~92% della larghezza utile.
 *
 * La dimensione di arrivo resta invariata: e' il valore che deve combaciare
 * con il titolo dell'header, quindi aumentarla romperebbe il raccordo.
 */
export const getBrandTitleStartSize = (width: number) =>
  width >= 1319 ? 150 : width >= 1055 ? 120 : width >= 792 ? 90 : width >= 560 ? 60 : 45;

export const getBrandTitleTargetSize = (width: number) =>
  width >= 768 ? 36 : 24;

export const BRAND_HEADER_CENTER_Y = 47.5;

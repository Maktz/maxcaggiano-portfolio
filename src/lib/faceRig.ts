// Rig facciale del ritratto.
//
// L'SVG e' un disegno piatto: i path sono identificati per INDICE, non per
// id, perche' il file non ne dichiara. Gli indici sono stati ricavati dal bbox
// di ogni path (il file e' un viewBox 258x332), non a occhio:
//
//   7, 8   sopracciglia   (stroke #8D5B3A, y 125..140)
//   10,11,12 occhio SX    iride #5C4033, pupilla #111827, riflesso bianco
//   14,15,16 occhio DX    idem
//   23     labbro         (fill #3B1115, y 243..283)
//   24     denti          (fill bianco, dentro il labbro)
//   25,26  linee labbro   (stroke #CB7D6A, sopra e sotto)
//
// Attenzione: i path #222222 / #F4EFEA NON sono la bocca. Sono ai lati estremi
// del viso (x 13..55 e x 203..238) e vanno lasciati fermi.

/** Path che compongono la bocca, nell'ordine in cui vanno interpolati. */
export const MOUTH_PATH_INDEXES = [23, 24, 25, 26] as const;

/** Parti che si muovono insieme per ogni occhio: iride, pupilla, riflesso. */
export const EYE_PARTS: Record<'left' | 'right', readonly number[]> = {
  left: [10, 11, 12],
  right: [14, 15, 16],
};

/**
 * Il bianco dell'occhio (sclera). E' l'unico path che si COMPRIME in verticale
 * per chiudere l'occhio: iride, pupilla e riflesso non si stringono da soli,
 * vengono rimpiccioliti insieme a lui condividendo lo stesso fattore.
 */
export const EYE_WHITE_INDEXES: Record<'left' | 'right', number> = {
  left: 9,
  right: 13,
};

/**
 * I path 17, 18, 19, 20, 21 sono gli OCCHIALI: montature, ponte e aste.
 * Non compaiono in nessuna lista di questo rig apposta: restano immobili.
 * (Sono stati scambiati per palpebre e animati di conseguenza.)
 */

/** Il labret sotto il labbro inferiore, che segue la bocca. */
export const PIERCING_PATH_INDEXES = [27, 28, 29] as const;

/** Il labbro inferiore: serve da riferimento per il movimento del labret. */
export const MOUTH_LOWER_LIP_INDEX = 26;

/** Sopracciglia. */
export const BROW_PATH_INDEXES: [number, number] = [7, 8];

const NUMBER_RE = /-?\d+\.?\d*(?:e-?\d+)?/g;

export const pathNumbers = (d: string): number[] =>
  (d.match(NUMBER_RE) ?? []).map(Number);

export const buildPath = (numbers: number[], template: string): string => {
  let i = 0;
  return template.replace(NUMBER_RE, () => {
    const value = numbers[i];
    i += 1;
    return String(Math.round(value * 1000) / 1000);
  });
};

/**
 * Versione "neutra" di un path: le anse di controllo delle cubiche vengono
 * tirate verso il punto medio della corda, quindi la curva si appiattisce fino a
 * diventare una retta.
 *
 * Non serve inventare un path neutro a mano: la struttura dei comandi resta
 * identica per costruzione (si toccano solo i numeri), quindi l'interpolazione
 * e' garantita e il risultato si adatta da solo a qualunque disegno con sole
 * curve M/C/Z.
 *
 * amount 0 = com'era (sorriso), amount 1 = piatto (neutro).
 */
export const flattenPath = (d: string, amount: number): number[] =>
  flattenNumbers(pathNumbers(d), amount);

/** Come flattenPath, ma su numeri gia' estratti: serve per comporre piu' trasformazioni (livellare gli angoli e poi appiattire). */
export const flattenNumbers = (nums: number[], amount: number): number[] => {
  // Ricostruisce la posizione corrente mentre scorre la stringa, cosi' da
  // sapere l'origine di ogni cubica.
  const out = nums.slice();
  let curX = nums[0];
  let curY = nums[1];
  let i = 2;
  // I comandi sono M, C e Z: dopo M(2 numeri) ogni cubica occupa 6.
  // Il file non ha altri comandi, quindi si avanza a gruppi di 6.
  while (i + 5 < nums.length) {
    const c1x = nums[i], c1y = nums[i + 1];
    const c2x = nums[i + 2], c2y = nums[i + 3];
    const p1x = nums[i + 4], p1y = nums[i + 5];
    const midX = (curX + p1x) / 2;
    const midY = (curY + p1y) / 2;
    out[i] = c1x + (midX - c1x) * amount;
    out[i + 1] = c1y + (midY - c1y) * amount;
    out[i + 2] = c2x + (midX - c2x) * amount;
    out[i + 3] = c2y + (midY - c2y) * amount;
    curX = p1x;
    curY = p1y;
    i += 6;
  }
  return out;
};

// --- Ritmo del viso -------------------------------------------------------
// Queste funzioni producono segnali con lo stesso carattere del resto del
// movimento del volto: partono piano, accelerano, si fermano, ripartono.
// E' il slow-in/slow-out applicato alla FASE, non al valore.

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep01 = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/**
 * Oscillazione fra -1 e +1 che si FERMA ai due estremi e si muove nel mezzo.
 *
 * L'easing e' applicato alla fase (treno d'onda + smoothstep) e non al valore:
 * applicato al valore, la curva avrebbe velocita' infinita al centro, che e'
 * l'opposto di un movimento morbido. Cosi' l'occhio posa uno sguardo e solo
 * dopo si sposta sul successivo.
 */
export const easedWave = (t: number, period: number, stay: number): number => {
  const phase = (((t / period) % 1) + 1) % 1;
  const triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return smoothstep01((triangle - stay) / (1 - stay * 2)) * 2 - 1;
};

/**
 * Quota di giro destinata a ciascuna fase del ciclo della bocca.
 * L'apertura (chiuso -> sorriso) occupa meno tempo della chiusura: il viso
 * si chiude con piu' calma di quanto si apra.
 */
export const MOUTH_LOOP_RATIOS = {
  staySmile: 0.2, // fermo sul sorriso
  close: 0.32, // sorriso -> bocca chiusa
  stayClosed: 0.24, // fermo a bocca chiusa
  open: 0.24, // bocca chiusa -> sorriso (il 25% piu' rapido della chiusura)
} as const;

/**
 * Ciclo della bocca in quattro fasi. Parte dal sorriso, quindi si aggancia
 * senza scatto alla sequenza d'ingresso che finisce sul sorriso.
 * Restituisce k: 0 bocca chiusa, 1 sorriso.
 */
export const mouthLoopK = (cyclePhase: number): number => {
  const p = (((cyclePhase % 1) + 1) % 1);
  const R = MOUTH_LOOP_RATIOS;
  const afterSmile = R.staySmile;
  const afterClose = afterSmile + R.close;
  const afterStayClosed = afterClose + R.stayClosed;
  if (p < afterSmile) return 1;
  if (p < afterClose) return 1 - smoothstep01((p - afterSmile) / R.close);
  if (p < afterStayClosed) return 0;
  return smoothstep01((p - afterStayClosed) / R.open);
};

/** Interpola due path con la stessa struttura di comandi. */
export const lerpPath = (from: number[], to: number[], t: number): number[] => {
  const out = new Array<number>(from.length);
  for (let i = 0; i < from.length; i += 1) {
    out[i] = from[i] + (to[i] - from[i]) * t;
  }
  return out;
};

/**
 * STATO INTERMEDIO DELLA BOCCA, derivato dal file.
 *
 * In tutti e quattro i path della bocca i due angoli sono i numeri 1 e 7
 * (inizio del tracciato e fine della prima cubica). Il sorriso e' l'inclinazione
 * fra quei due angoli; l'apertura e' invece data dai punti di controllo delle
 * cubiche, che stanno molto piu' in basso (y ~281) rispetto al bordo superiore
 * (y ~247).
 *
 * Qui si spostano SOLO gli angoli verso la loro media, lasciando i punti di
 * controllo dove sono: il sorriso si appiattisce, l'apertura resta identica.
 * E' esattamente "bocca aperta ma meno sorridente".
 *
 * amount 0 = com'era nel file, amount 1 = angoli in orizzontale.
 */
export const levelSmileCorners = (nums: number[], amount: number): number[] => {
  // Servono almeno 8 numeri per avere entrambi gli angoli.
  if (nums.length < 8) return nums.slice();
  const out = nums.slice();
  const meanY = (nums[1] + nums[7]) / 2;
  out[1] = nums[1] + (meanY - nums[1]) * amount;
  out[7] = nums[7] + (meanY - nums[7]) * amount;
  return out;
};

export const pathCenter = (d: string): { cx: number; cy: number } => {
  const nums = pathNumbers(d);
  if (nums.length < 2) return { cx: 0, cy: 0 };
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return {
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
};

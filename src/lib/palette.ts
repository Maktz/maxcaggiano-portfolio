/**
 * Lettura della palette da CSS.
 *
 * I colori vivono come custom properties in src/index.css: il Canvas non può
 * usare classi Tailwind, quindi li recupera dal CSS calcolato e si ricostruisce
 * i formati che servono (`rgb(...)` e `rgba(...)`). Cosi Canvas, DOM e classi
 * utility dipendono dalla stessa sorgente: cambiare l'esadecimale in index.css
 * aggiorna tutto, senza toccare il TypeScript.
 */

/** Nome dei token esposti in `:root`. */
export type PaletteToken =
  | 'canvas'
  | 'deep'
  | 'pink'
  | 'accent'
  | 'violet'
  | 'orchid'
  | 'amber';

/**
 * Tripleti RGB ("182 25 127") di un token, con fallback: se il CSS non è ancora
 * applicato il valore hardcoded evita che il renderer diventi trasparente.
 */
const FALLBACKS: Record<PaletteToken, string> = {
  canvas: '182 25 127',
  deep: '100 14 70',
  pink: '252 178 188',
  accent: '255 212 0',
  violet: '112 59 217',
  orchid: '178 59 202',
  amber: '225 138 14',
};

const cache = new Map<PaletteToken, string>();

const readToken = (token: PaletteToken): string => {
  const cached = cache.get(token);
  if (cached) return cached;
  let value = FALLBACKS[token];
  if (typeof window !== 'undefined') {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(`--color-${token}`)
      .trim();
    if (raw) value = raw;
  }
  cache.set(token, value);
  return value;
};

/** Svuota la cache: da chiamare se i token cambiano a runtime (HMR). */
export const clearPaletteCache = () => cache.clear();

/** Colore pieno, es. `rgb(182 25 127)`. */
export const paletteRgb = (token: PaletteToken): string =>
  `rgb(${readToken(token)})`;

/** Colore con alpha 0..1, es. `rgba(182, 25, 127, 0.2)`. */
export const paletteRgba = (token: PaletteToken, alpha: number): string => {
  const [r, g, b] = readToken(token).split(/\s+/).map(Number);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

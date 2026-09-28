// Caricatore unico del ritratto SVG.
//
// Il file viene letto UNA volta sola e condiviso fra il DOM (che lo usa come
// maschera CSS) e il canvas (che ne campiona i pixel per la sagoma). Serve
// anche a conoscere il rapporto d'aspetto REALE del disegno: hardcodarlo nel
// codice legava la resa a un solo file, e al primo SVG con proporzioni diverse
// la sagoma sarebbe stata stirata rispetto all'SVG che copre.
/** Percorso del ritratto: unico per la maschera CSS e per il campionamento. */
export const IMG_URL = '/max.svg';

let image: HTMLImageElement | null = null;
let loading: Promise<HTMLImageElement> | null = null;

/** Rapporto larghezza/altezza del disegno, o null se il file non e' ancora noto. */
let aspect: number | null = null;

/**
 * Valore di partenza usato solo per il primo frame, prima che l'immagine sia
 * caricata. La larghezza del ritratto dipende da questo rapporto (l'altezza e'
 * fissata dal clamp), quindi serve un valore plausibile: dopo il caricamento
 * viene sostituito da quello vero, letto dal file.
 */
export const PORTRAIT_ASPECT_BOOTSTRAP = 258 / 332;

export const getPortraitAspect = () => aspect ?? PORTRAIT_ASPECT_BOOTSTRAP;

export const loadPortraitImage = (url: string): Promise<HTMLImageElement> => {
  if (image) return Promise.resolve(image);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        aspect = img.naturalWidth / img.naturalHeight;
        image = img;
      }
      resolve(img);
    };
    // Se il file non si carica, l'immagine resta null e chi chiama ricade sui
    // propri fallback: meglio una sagoma approssimata che una pagina ferma.
    img.onerror = () => resolve(img);
    img.src = url;
  });
  return loading;
};

// LE POSE DELL'AVATAR.
//
// Un viso e' quattro numeri. Ogni posa e' un set di quei numeri, e il
// controller sa applicarli ai path dell'SVG passandoli dal linguaggio delle
// pose (positivo = "di piu'", "occhi spalancati") al linguaggio del rig
// (apertura 0..1, offset in unita' dell'XML).
//
// I valori vivono in ENTRY_CONFIG, non qui: le pose sono parte della
// sequenza e devono essere ritoccabili senza toccare il codice che le
// esegue. Questo file dichiara solo il TIPO e la forma del dato.

export type PoseName = 'riposo' | 'sveglio' | 'sorpresa' | 'sorriso';

/** Una posa: quattro parametri, nessuno opzionale. */
export interface Pose {
  /**
   * Apertura degli occhi. 0 = chiuso, 1 = normale, > 1 = spalancato.
   *
   * Sopra l'1 la sclera viene schiacciata in verticale perche' il rig la
   * scala con lo stesso fattore di iride, pupilla e riflesso: e' l'unico
   * modo che l'SVG consente di aprire un occhio, non avendo palpebre.
   */
  eyeOpenness: number;
  /** Spostamento delle pupille in px di viewport, limitato dai massimi del rig. */
  pupilOffset: { x: number; y: number };
  /** Alzata delle sopracciglia: positivo verso l'alto, in unita' del rig. */
  browOffset: number;
  /** Apertura della bocca: 0 = linea piatta, 1 = sorriso pieno. */
  mouthOpenness: number;
}

/** I limiti oltre i quali le pupille escono dall'occhio. Vengono dal rig. */
export const MAX_PUPIL_X = 2.6;
export const MAX_PUPIL_Y = 1.8;

/** L'orecchio non si scalda: una posa si ottiene MIXANDO due pose. */
export const blendPoses = (from: Pose, to: Pose, t: number): Pose => ({
  eyeOpenness: from.eyeOpenness + (to.eyeOpenness - from.eyeOpenness) * t,
  pupilOffset: {
    x: from.pupilOffset.x + (to.pupilOffset.x - from.pupilOffset.x) * t,
    y: from.pupilOffset.y + (to.pupilOffset.y - from.pupilOffset.y) * t,
  },
  browOffset: from.browOffset + (to.browOffset - from.browOffset) * t,
  mouthOpenness: from.mouthOpenness + (to.mouthOpenness - from.mouthOpenness) * t,
});

/** Copia difensiva: le pose sono oggetti condivisi in ENTRY_CONFIG. */
export const clonePose = (pose: Pose): Pose => ({
  eyeOpenness: pose.eyeOpenness,
  pupilOffset: { x: pose.pupilOffset.x, y: pose.pupilOffset.y },
  browOffset: pose.browOffset,
  mouthOpenness: pose.mouthOpenness,
});

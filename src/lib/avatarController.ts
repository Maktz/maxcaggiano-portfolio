import { AUDIO_EVENTS, audio } from './audioLayer';
import { ENTRY_CONFIG } from './entryConfig';
import {
  MAX_PUPIL_X,
  MAX_PUPIL_Y,
  blendPoses,
  clonePose,
  type Pose,
  type PoseName,
} from './avatarPoses';

// IL CONTROLLER DELL'AVATAR.
//
// Non disegna: il disegno e' del rig di HeroScene, che ha gia' tutto il
// vocabolario (le sentinelle, il ciclo della bocca, i path giusti). Questo
// controller ha un solo compito: produrre i NUMERI che il rig usa al posto
// dei suoi, e accettare che qualcun altro li produca.
//
// Il patto con il rig e' una sola funzione, `sample()`. Il rig chiama
// `sample()` ogni frame e usa cio' che torna. Il rig non sa se il valore
// viene dal suo ciclo autonomo o da una posa: per lui e' sempre "quello che
// devo disegnare adesso". E' il patto piu' piccolo possibile, ed e' per
// questo che `suspendIdle` non riscrive l'idle: lo silenzia, e basta.
//
// Non usa uno stato React perche' non produce markup: produce numeri, e i
// numeri non hanno bisogno di un render.

/** Cosa il rig deve disegnare in questo frame. */
export interface AvatarFrame {
  /** 0 = bocca chiusa, 1 = sorriso pieno. Guida anche occhi e sopracciglia. */
  k: number;
  /**
   * Apertura degli occhi, se il controller la comanda.
   *
   * `null` significa "lascia fare al rig": l'apertura si deduce dalla bocca,
   * com'e' sempre stato. E' un campo a se' e non un valore di default perche'
   * durante l'idle la apertura NON deve venire dalla posa ma dalla bocca, e i
   * due sistemi devono poter governarla in momenti diversi senza che nessuno
   * dei due abbia a tacere l'altro.
   */
  openness: number | null;
  /**
   * Sguardo orizzontale nel linguaggio del rig, o `null` per lasciarlo all'idle
   * vagante. Come `openness`: durante la sequenza il controller comanda, dopo
   * torna l'oscillazione del rig.
   */
  lookX: number | null;
  /** Sguardo verticale nel linguaggio del rig, o `null` per l'idle. */
  lookY: number | null;
  /**
   * Alzata delle sopracciglia nel linguaggio del rig, o `null` per l'idle.
   *
   * Stessa logica di `openness`: la posa e il ciclo devono poter comandare
   * le sopracciglia in momenti diversi, e nella sorpresa servono su (4)
   * mentre la bocca e' solo socchiusa: legate a un numero solo non potrebbero.
   */
  brow: number | null;
  /** Fase del ciclo autonomo della bocca. */
  loopT: number;
  /** true se il ciclo della bocca deve girare da solo. */
  inLoop: boolean;
}

export interface SetPoseOptions {
  /** Durata in ms. 0 = salto istantaneo, usato per il primo posizionamento. */
  duration?: number;
  /** Curva dell'interpolazione. */
  easing?: string;
}

/**
 * Il frame neutro: bocca piatta, occhi aperti, sguardo al centro, e i campi di
 * comando tutti `null`, che vuol dire "il rig faccia da solo".
 */
const NEUTRAL: AvatarFrame = {
  k: 0,
  openness: null,
  lookX: null,
  lookY: null,
  brow: null,
  loopT: 0,
  inLoop: false,
};

// ── stato interno ──────────────────────────────────────────────────────────
//
// Tutto qui dentro un solo oggetto, perche' e' uno stato e non una
// collezione: due oggetti che si correggono a vicenda sono due metà di uno.
const state = {
  /** true fra suspendIdle() e resumeIdle(). */
  idleSuspended: false,
  /** La posa di partenza dell'interpolazione in corso. */
  from: null as Pose | null,
  /** La posa da raggiungere. */
  to: null as Pose | null,
  /** La posa corrente, interpolata. */
  current: clonePose(ENTRY_CONFIG.poses.riposo),
  /** 0..1 della transizione in corso, 1 quando fermo. */
  t: 1,
  /** Durata della transizione in ms. */
  duration: 0,
  /** Curva della transizione in corso. */
  easing: 'easeOut',
  /** Istante di partenza della transizione, sul clock delle POSE. */
  startedAt: 0,
  /** Sorriso a schermo, 0..1: il ciclo della bocca riparte da qui. */
  loopAnchor: 0,
  /**
   * Clock del CICLO autonomo, in secondi. Congelato durante la sequenza.
   *
   * Serve a una cosa sola: che il ciclo della bocca e lo sguardo vagante non
   * perdano tempo mentre l'avatar e' in scena. Riprendendo ripartono da
   * dove si erano fermati, e non dal fondo del ciclo.
   */
  idleTime: 0,
  frozen: false,
  /**
   * Clock delle POSE, in secondi. Non si congela MAI.
   *
   * Sono due orologi perche' i due compiti sono opposti: il ciclo deve
   * fermarsi con l'avatar in scena, le pose invece devono poter DURARE
   * mentre e' fermo. Con un orologio solo, o il ciclo riparte dopo un
   * secondo di sequenza e salta, o le pose restano congelate a meta' strada.
   */
  poseTime: 0,
  /** Destinazione dello sguardo in px di viewport, null = sguardo libero. */
  lookTarget: null as { x: number; y: number } | null,
  /** Sguardo corrente, in unita' del rig, smorzato verso il bersaglio. */
  lookNow: { x: 0, y: 0 },
  /** Centro del viso in px di viewport: serve per lookAt(). */
  faceCenter: null as { x: number; y: number } | null,
};

/**
 * Conversione fra le due unita' di sguardo.
 *
 * Solo in una direzione: le pose parlano in px di viewport, il rig in unita'
 * dell'SVG. Non serve mai tornare indietro perche' il controller conosce
 * l'unita' del rig solo quando gli serve (disegnare), e in quel momento la
 * posa e' gia' stata convertita.
 */
const toRigX = (px: number) => px / MAX_PUPIL_X;
const toRigY = (py: number) => py / MAX_PUPIL_Y;

/** Curva di easing: nome -> funzione su 0..1. */
const EASINGS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
};
const ease = (name: string) => EASINGS[name] ?? EASINGS.easeOut;

/** Quanto lo sguardo insegue il bersaglio a ogni frame. */
const LOOK_SMOOTHING = 0.12;

/**
 * Dice al rig cosa disegnare in questo frame.
 *
 * E' l'unico punto in cui i due sistemi si toccano. Il rig chiama questa
 * funzione e usa il risultato: non sa se i numeri vengono dal suo ciclo
 * autonomo, da una posa della sequenza o da uno sguardo che segue un razzo.
 *
 * `deltaSeconds` e' il tempo realmente passato. Da qui nascono i due
 * orologi: quello delle pose, che gira sempre, e quello del ciclo, che si
 * ferma con l'idle sospeso.
 */
export const sample = (deltaSeconds: number, autonomous: AvatarFrame): AvatarFrame => {
  // Il clock delle pose corre sempre: e' il tempo che misura la durata di un
  // setPose, e una posa che non avanza mentre l'avatar e' in scena non
  // esisterebbe.
  state.poseTime += deltaSeconds;
  // Il clock del ciclo si ferma invece con l'idle sospeso: cosi' il ciclo
  // della bocca e lo sguardo vagante non perdono secondi e riprendono da
  // dove si erano fermati, senza saltare a meta' giro.
  if (!state.frozen) state.idleTime += deltaSeconds;

  // Il frame di base dipende solo da chi comanda il CICLO. Il bersaglio, se c'e',
  // si applica dopo e sopra a entrambi: e' la parte importante di questa
  // funzione, perche' il ciclo e' il movimento autonomo (sguardo vagante, bocca)
  // e il bersaglio e' una decisione. Sospendere l'idle deve congelare il primo e
  // non annullare il secondo: con l'ordine inverso, guardare un razzo durante
  // l'ingresso non avrebbe fatto nulla, perche' il razzo passa proprio mentre
  // l'idle e' sospeso.
  const base = state.idleSuspended ? poseFrame() : autonomous;

  // Sguardo: se c'e' un bersaglio, si vince sul ciclo autonomo. Il
  // movimento e' smorzato a ogni frame invece che istantaneo, perche' l'occhio
  // che scatta su un punto si legge come un difetto, mentre quello che ci
  // scorre sembra vivo.
  if (state.lookTarget && state.faceCenter) {
    const dx = state.lookTarget.x - state.faceCenter.x;
    const dy = state.lookTarget.y - state.faceCenter.y;
    const wantX = Math.max(-MAX_PUPIL_X, Math.min(MAX_PUPIL_X, toRigX(dx)));
    const wantY = Math.max(-MAX_PUPIL_Y, Math.min(MAX_PUPIL_Y, toRigY(dy)));
    state.lookNow.x += (wantX - state.lookNow.x) * LOOK_SMOOTHING;
    state.lookNow.y += (wantY - state.lookNow.y) * LOOK_SMOOTHING;
    // `openness: null`: anche con un bersaglio l'apertura resta quella del
    // rig, dedotta dalla bocca. Trattenere il viso non significa aprire gli
    // occhi.
    return { ...base, lookX: state.lookNow.x, lookY: state.lookNow.y };
  }

  // Senza bersaglio non c'e' piu' niente da inseguire: il ciclo vagante del
  // rig riprende il comando dello sguardo. `null` e' esattamente quel segnale,
  // ed e' perche' il campo e' dichiarato come `number | null` e non come
  // numero: qui "nessuno comanda" e' un valore, non un'assenza.
  return base;
};

/** Il frame che disegna la posa corrente, con il ciclo della bocca fermo. */
const poseFrame = (): AvatarFrame => {
  advance();
  const p = state.current;
  return {
    k: p.mouthOpenness,
    // Sospeso l'idle, l'apertura la comanda la posa e non la bocca: e' l'unico
    // modo per spalancare gli occhi nella sorpresa tenendo la bocca a meta'.
    openness: p.eyeOpenness,
    lookX: toRigX(p.pupilOffset.x),
    lookY: toRigY(p.pupilOffset.y),
    // La posa esprime l'alzata in unita' del rig, quindi si passa gia' cosi':
    // il rig moltiplica per 3.1 e 2.6 i due occhi, ed e' il suo vocabolario.
    brow: p.browOffset,
    loopT: state.idleTime,
    inLoop: false,
  };
};

/** Il frame neutro: bocca piatta, occhi aperti, sguardo al centro. */
export const neutralFrame = (): AvatarFrame => ({ ...NEUTRAL });

/**
 * Avanza l'interpolazione della posa, se c'e' una in corso.
 *
 * Usa il clock delle POSE, che gira anche a ciclo fermo: e' l'unico modo per
 * che una posa dichiarata in millisecondi duri davvero quei millisecondi
 * invece di dipendere da quanti frame sono passati.
 */
const advance = (): void => {
  if (!state.from || !state.to) return;
  const t =
    state.duration <= 0
      ? 1
      : Math.min(1, (state.poseTime - state.startedAt) / (state.duration / 1000));
  const eased = ease(state.easing)(t);
  state.current = blendPoses(state.from, state.to, eased);
  state.t = t;
  if (t >= 1) {
    state.current = clonePose(state.to);
    state.from = null;
    state.to = null;
  }
};

/**
 * Interpola dalla posa corrente alla posa `name`.
 *
 * Il punto di partenza e' SEMPRE `current`, mai una posa scritta a mano: e'
 * questo che rende `resumeIdle` e le pose successive continue l'una dopo
 * l'altra, senza scatti, perche' non si riparte mai da un riferimento che
 * non sia lo stato realmente a schermo.
 */
export const setPose = (name: PoseName, options: SetPoseOptions = {}): void => {
  const target = ENTRY_CONFIG.poses[name];
  if (!target) {
    console.warn(`[AVATAR] posa sconosciuta: ${name}`);
    return;
  }
  const duration = options.duration ?? 300;
  state.from = clonePose(state.current);
  state.to = clonePose(target);
  state.duration = duration;
  state.easing = options.easing ?? 'easeOut';
  // L'origine e' il clock delle POSE, che gira sempre: e' l'unico modo perche'
  // una posa di 300ms duri 300ms anche mentre il ciclo e' congelato, e perche'
  // non dipenda da quanti frame sono passati.
  state.startedAt = state.poseTime;
  // A durata zero si applica subito: il primo posizionamento dell'avatar deve
  // essere gia' nella sua posa al primo frame, non dopo un frame.
  if (duration <= 0) {
    state.current = clonePose(target);
    state.from = null;
    state.to = null;
  }
  audio.play(AUDIO_EVENTS.POSE_CHANGE, { pose: name });
};

/** Lo stato interno, per il debug e per chi deve sapere se il rig ha la parola. */
export const isSuspended = (): boolean => state.idleSuspended;

/** Sospende l'idle senza toccare lo stato: la posa resta dov'e'. */
export const suspendIdle = (): void => {
  if (state.idleSuspended) return;
  state.idleSuspended = true;
  // Congela il clock dell'idle: e' questo che ferma insieme il ciclo della
  // bocca e l'interpolazione della posa, e garantisce che riprendendo non
  // sia saltato un secondo di ciclo.
  state.frozen = true;
};

/**
 * Riprende l'idle dalla posa corrente.
 *
 * Non reimposta occhi e bocca: il ciclo autonomo riparte dal valore che
 * `loopAnchor` ha raccolto dalla posa, quindi la prima cosa che fa e'
 * continuare da li'. Se ripartisse dai valori di riposo del ciclo, l'avatar
  // si aprirebbe gli occhi di scatto al termine della sequenza.
 */
export const resumeIdle = (): void => {
  if (!state.idleSuspended) return;
  state.idleSuspended = false;
  state.frozen = false;
  // L'ancora e' l'apertura della bocca attuale: il ciclo riparte da li' e non
  // salta al sorriso pieno nel primo giro. E' il pezzo che evita lo scatto
  // fra l'ultima posa della sequenza e l'avvio dell'idle.
  state.loopAnchor = state.current.mouthOpenness;
};

/** Sguardo verso un punto in coordinate di viewport, con limiti di rotazione. */
export const lookAt = (x: number, y: number): void => {
  state.lookTarget = { x, y };
};

/** Interrompe il lookAt: le pupille tornano al centro della posa corrente. */
export const releaseLook = (): void => {
  state.lookTarget = null;
};

/**
 * Battito di ciglia: chiude e riapre gli occhi.
 *
 * Non e' una posa, e' un impulso: parte dalla posa corrente, scende a quasi
 * chiuso e TORNIA indietro al valore di prima. Se fosse una posa, l'occhio
 * resterebbe semichiuso fino alla posa successiva, che non e' quello che un
 * battito di ciglia fa.
 */
export const blink = (durationMs = 150): void => {
  const base = state.current;
  const half = durationMs / 2;
  // L'occhio non si chiude del tutto: a 0 la pupilla sparisce dentro la
  // sclera e la chiusura si legge come un difetto, non come un blink.
  const shut: Pose = { ...base, eyeOpenness: 0.05 };
  // La riapertura torna a un valore LEGGERMENTE maggiore di quello di prima:
  // un occhio che si riapre esattamente sul valore di partenza sembra un
  // video, uno che si riapre un filo di piu' sembra un riflesso.
  const open: Pose = { ...base, eyeOpenness: base.eyeOpenness + 0.06 };

  state.from = clonePose(base);
  state.to = clonePose(shut);
  state.duration = half;
  state.easing = 'easeIn';
  state.startedAt = state.poseTime;

  // La riapertura e' schedulata a meta' blink. Non usa `setPose`: quello
  // ripartirebbe dalla posa corrente, che a quel punto e' quella chiusa, e
  // perderebbe il valore di partenza del ciclo.
  window.setTimeout(() => {
    if (!state.idleSuspended) return;
    state.from = clonePose(shut);
    state.to = clonePose(open);
    state.duration = half;
    state.easing = 'easeOut';
    state.startedAt = state.poseTime;
  }, half);
};

/** Il centro del viso a schermo: lo registra il rig, che ha il nodo. */
export const setFaceCenter = (x: number, y: number): void => {
  state.faceCenter = { x, y };
};

/** La posa corrente: per chi vuole leggere senza interpolare. */
export const currentPose = (): Pose => clonePose(state.current);

/** Il nome della posa corrente, per il debug. */
export const currentPoseState = () => ({ suspended: state.idleSuspended, pose: state.current });

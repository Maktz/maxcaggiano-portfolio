// IL BUS DELLE REAZIONI DELL'AVATAR.
//
// Un modulo solo, senza React e senza markup: produce NUMERI (quanto e' attiva
// la reazione, a che punto della sua linea temporale, di quanto si riducono gli
// occhi) e li mette a disposizione di chi disegna. Il disegno e' nel rig di
// HeroScene e qui dentro non c'e' nemmeno un path.
//
// IL CONTRATTO CON CHI DISEGNA
//
// `react(kind)` apre una reazione, `sample(now, k)` la legge nel frame. Non e'
// `setPose` come in avatarController perche' una reazione non e' una posa: e'
// una posa PIU' un'animazione (entrata a molla, pulsazione, uscita) e il
// controller non ha tempo.
//
// LA PRIORIT' E' UNA REGOLA, NON UN CODICE DI USCITA.
//
// Cuori battono stelline, e i due non possono interrompersi a vicino. Quindi
// un evento non riavvia MAI l'animazione corrente: se arriva mentre una
// reazione e' in corso, allunga il timer. Se e' di priorita' maggiore cambia
// anche il disegno — le stelline diventano cuori — ma NON riparte da capo: il
// nuovo disegno adotta lo stesso tempo trascorso, e cio' non si vede il
// riavvio che la specifica vieta.
//
// IL SUONO.
//
// Ogni `react` emette anche un CustomEvent su window. Il suono non e' un
// requisito di oggi ed e' esattamente per questo che il canale esiste: quando
// arrivera', si aggancia un ascoltatore e non si tocca niente di qui.

import { reducedMotion } from './motionPreference';

export type AvatarReactionKind = 'stars' | 'hearts';

/** Quanto dura ogni reazione, in secondi. */
const DURATION: Record<AvatarReactionKind, number> = { stars: 1.6, hearts: 2.4 };

/**
 * Ordine di precedenza. Il numero non serve a nient'altro: serve a rendere la
 * regola "chi vince" leggibile in un colpo d'occhio.
 */
const PRIORITY: Record<AvatarReactionKind, number> = { stars: 1, hearts: 2 };

/** Il CustomEvent con cui la reazione esce verso l'esterno (suono, analisi). */
export const AVATAR_REACTION_EVENT = 'avatar:reaction';

export interface ReactionFrame {
  kind: AvatarReactionKind;
  /**
   * Fattore degli occhi: 1 = come li disegna il file, 0.18 = quasi chiusi.
   * Sotto i 0.2 la pupilla sparisce dentro la sclera, e la stella deve
   * prendere il suo posto: e' il numero che produce lo scambio.
   */
  eyeScale: number;
  /** Scala di stelle/cuori, con l'overshoot della molla gia' dentro. */
  shape: number;
  /** 0..1 lineare della fase d'ingresso: serve alla rotazione iniziale. */
  enter: number;
  /** 0..1 lineare della fase d'uscita. */
  exit: number;
  /** Battito in corso (stelle che scintillano, cuori che pulsano): 1 = fermo. */
  pulse: number;
  /** 0..1 quanta luce prende l'highlight bianco. */
  twinkle: number;
  /** Gradi di inclinazione della testa. */
  tiltDeg: number;
  /** `k` della bocca: sorriso pieno, denti visibili. */
  mouth: number;
  /** Alzata delle sopracciglia, nelle unita' del rig. */
  brow: number;
  /** Scala verticale della testa (squash & stretch). 1 = neutro. */
  stretch: number;
  /** Avanzamento dei cuoricini che salgono, 0..1. -1 = non attivi. */
  bubble: number;
}

const state = {
  kind: null as AvatarReactionKind | null,
  startedAt: 0,
  endsAt: 0,
};

const listeners = new Set<(kind: AvatarReactionKind) => void>();

const nowSeconds = () =>
  typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;

// ── aritmetica della linea temporale ────────────────────────────────────────
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};
const easeInCubic = (t: number) => clamp01(t) ** 3;

/**
 * Una gobba gaussiana centrata in `at`: un impulso che sale e scende da solo.
 *
 * Serve per il mini blink e per i battiti, che non sono interpolazioni da 0 a 1
 * ma un colpo e il suo ritorno. Una curva con due capi morbili li racconta
 * meglio di qualsiasi ease con tre segmenti.
 */
const bump = (t: number, at: number, width: number) => {
  const d = (t - at) / width;
  return Math.exp(-d * d);
};

// ── le due linee temporali ───────────────────────────────────────────────────
//
// Non sono la stessa funzione con due numeri: le stelle sono un colpo secco e
// breve, i cuori sono lunghi e hanno i cuoricini che salgono. Un'unica formula
// con dei parametri sarebbe stata illeggibile per entrambe, e le due durate
// sono diverse per scelta.

const starsFrame = (t: number, baseK: number): ReactionFrame => {
  const enter = clamp01((t - 0.18) / 0.34);
  const exit = clamp01((t - 1.28) / 0.3);
  const back = smoothstep((t - 1.3) / 0.28);
  const shrink = smoothstep((t - 0.16) / 0.22);
  const tilt = 3.5 * smoothstep((t - 0.2) / 0.3) * (1 - smoothstep((t - 1.32) / 0.24));
  const smile = smoothstep((t - 0.2) / 0.28) * (1 - smoothstep((t - 1.34) / 0.26));
  // Due scintille ravvicinate, non una sola: una sola sembrerebbe un lampo di
  // caricamento, due sembrano un occhio che si accende e si riaccende.
  const twinkle = Math.max(bump(t, 0.72, 0.06), bump(t, 1.04, 0.06));
  return {
    kind: 'stars',
    eyeScale: lerp(lerp(1, 0.18, shrink) * (1 - bump(t, 0.08, 0.05) * 0.92), 1, back),
    shape: easeOutBack(enter) * (1 - easeInCubic(exit)),
    enter,
    exit,
    pulse: 1 + twinkle * 0.13,
    twinkle,
    tiltDeg: tilt,
    mouth: lerp(baseK, 1, smile),
    brow: 0.85 * smile,
    stretch: 1,
    bubble: -1,
  };
};

const heartsFrame = (t: number, baseK: number): ReactionFrame => {
  const enter = clamp01((t - 0.18) / 0.32);
  const exit = clamp01((t - 2.08) / 0.3);
  const back = smoothstep((t - 2.1) / 0.28);
  const shrink = smoothstep((t - 0.16) / 0.2);
  const tilt = 4 * smoothstep((t - 0.2) / 0.3) * (1 - smoothstep((t - 2.12) / 0.26));
  const smile = smoothstep((t - 0.18) / 0.26) * (1 - smoothstep((t - 2.14) / 0.26));
  // Due battiti, come chiede la specifica: un cuore che pulsa una volta sola
  // sembra un rimbalzo, due volte sembra vivo.
  const beat = bump(t, 0.78, 0.1) + bump(t, 1.24, 0.1);
  // Lo squash parte subito e si assesta: la testa arriva un filo piu' alta e
  // poi torna, ed e' quello che rende l'ingresso morbido invece che rigido.
  const squash = 1 + 0.06 * (1 - smoothstep((t - 0.2) / 0.34));
  return {
    kind: 'hearts',
    eyeScale: lerp(lerp(1, 0.18, shrink) * (1 - bump(t, 0.08, 0.05) * 0.92), 1, back),
    shape: easeOutBack(enter) * (1 - easeInCubic(exit)),
    enter,
    exit,
    pulse: 1 + beat * 0.15,
    twinkle: beat * 0.5,
    tiltDeg: tilt,
    mouth: lerp(baseK, 1, smile),
    brow: 0.7 * smile,
    stretch: squash,
    bubble: t < 0.55 || t > 1.85 ? -1 : clamp01((t - 0.55) / 1.3),
  };
};

/**
 * Il frame STATO, quello che si disegna sotto `prefers-reduced-motion`.
 *
 * Vive qui e non dentro `sampleReaction` perche' serve anche a chi NON ha un
 * rAF che gli chieda un frame ogni 16ms: sotto motion ridotto il rig del viso
 * non gira affatto, e l'unico modo che l'overlay si accenda e si spenga e' che
 * qualcuno lo faccia al posto suo. Questo e' quel qualcuno.
 */
export const staticOverlayFrame = (kind: AvatarReactionKind): ReactionFrame => ({
  kind,
  eyeScale: 0.18,
  shape: 1,
  enter: 1,
  exit: 0,
  pulse: 1,
  twinkle: 0.4,
  tiltDeg: 0,
  mouth: 1,
  brow: 0.8,
  stretch: 1,
  bubble: -1,
});

/**
 * Apre una reazione. E' l'unico ingresso: chiunque puo' chiamarla, e non e' un
 * errore.
 *
 * Se una reazione e' gia' in corso il comportamento dipende dalla priorita'.
 * Con priorita' uguale o minore — una seconda stellina mentre le stelline sono
 * gia' accese — si allunga solo il timer: e' il caso esplicito della specifica,
 * "estendi il timer senza riavviare". Con priorita' maggiore si cambia anche il
 * disegno, ma il tempo trascorso resta quello che era: si vede il disegno nuovo
 * comparire sopra quello vecchio, non un'animazione che riparte.
 */
export const reactAvatar = (kind: AvatarReactionKind): void => {
  const now = nowSeconds();
  if (state.kind !== null && now >= state.endsAt) state.kind = null;
  if (state.kind === null) {
    state.kind = kind;
    state.startedAt = now;
  } else if (PRIORITY[kind] >= PRIORITY[state.kind]) {
    state.kind = kind;
  }
  state.endsAt = Math.max(state.endsAt, now + DURATION[state.kind ?? kind]);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AVATAR_REACTION_EVENT, { detail: { kind } }));
  }
  listeners.forEach((fn) => fn(state.kind ?? kind));
};

/** La reazione in corso, o null. Per chi deve decidere prima di disegnare. */
export const activeReactionKind = (): AvatarReactionKind | null => {
  if (state.kind !== null && nowSeconds() >= state.endsAt) state.kind = null;
  return state.kind;
};

/** Iscrizione alla sola notifica di apertura, senza numeri. */
export const subscribeAvatarReaction = (
  fn: (kind: AvatarReactionKind) => void,
): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/**
 * Il frame della reazione, o `null` se non c'e' reazione.
 *
 * `baseK` e' il valore di bocca che il rig aveva calcolato da solo: la
 * reazione non sa com'e' fatto il sorriso e non deve indovinarlo, quindi lo
 * riceve e ci torna dentro. E' il rispetto del ciclo autonomo, che altrimenti
 * verrebbe schiacciato a 1 e ripartirebbe di scatto alla fine.
 */
export const sampleReaction = (now: number, baseK: number): ReactionFrame | null => {
  if (state.kind === null) return null;
  if (now >= state.endsAt) {
    state.kind = null;
    return null;
  }
  if (reducedMotion) return staticOverlayFrame(state.kind);
  const t = now - state.startedAt;
  return state.kind === 'stars' ? starsFrame(t, baseK) : heartsFrame(t, baseK);
};

/**
 * La facciata pubblica: `avatar.react('stars')`.
 *
 * Un nome solo per la cosa, cosi' chi chiama non deve sapere come si chiama
 * questa pagina: `reactAvatar` e' il nome interno del motore, `avatar.react`
 * e' il nome con cui se ne parla.
 */
export const avatar = {
  react: reactAvatar,
  subscribe: subscribeAvatarReaction,
  sample: sampleReaction,
  active: activeReactionKind,

};

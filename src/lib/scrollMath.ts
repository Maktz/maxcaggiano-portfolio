export interface PortraitGeometry {
  /** Centro orizzontale del ritratto a RIPOSO, in px di viewport. */
  x: number;
  /** Centro verticale del ritratto a RIPOSO, in px di viewport. */
  y: number;
  width: number;
  height: number;
}

// Geometria del ritratto, MISURATA sul DOM e pubblicata da HeroScene.
//
// Perche' una copia sola e non due calcolate a mano: il canvas deve disegnare
// la sagoma esattamente dove sta l'SVG. Se i due ricavano il riquadro dai
// propri numeri divergono al primo ritocco di layout.
//
// I valori sono di RIPOSO, cioe' la posizione del ritratto PRIMA che il
// ricentraggio lo sposti al centro: se pubblicassimo la rect letta a meta'
// animazione, il canvas ci sommerebbe sopra il proprio spostamento e
// l'offset verrebbe contato due volte. Per questo si pubblicano offsetLeft /
// offsetTop / offsetWidth / offsetHeight, che sono valori di LAYOUT e non
// cambiano mai con i transform.
//
// x e y sono gia' il CENTRO, non il bordo: il wrapper del ritratto ha
// translate(-50%, -50%), quindi il -50% cancella esattamente meta' dimensione
// e offsetLeft/offsetTop coincidono con il centro a riposo. Nessuna correzione
// manuale serve.
//
// Le coordinate sono in px di viewport: valgono sia per il posizionamento DOM
// sia per il disegno del canvas (che e' fixed a schermo intero). Finche'
// HeroScene non ha pubblicato nulla il lettore restituisce null e chi chiama
// ricade sul proprio fallback.
let geometry: PortraitGeometry | null = null;

export const publishPortraitGeometry = (next: PortraitGeometry) => {
  geometry = next;
};

export const readPortraitGeometry = (): PortraitGeometry | null => geometry;

// offsetTop e' una lettura di layout: rileggerlo dentro una trasformazione che
// gira a ogni frame forza un reflow, e le sezioni sono cinque. Gli offset si
// rileggono solo quando cambiano le dimensioni della viewport, oppure quando
// qualcuno dichiara che il layout e' cambiato (invalidateSceneTops, chiamata
// dalla Works quando scrive la propria altezza in px).
let sceneTopsCache: { viewport: string; tops: Map<string, number> } | null = null;

/** Da chiamare dopo che una sezione ha cambiato altezza: la cache offsets e' nulla. */
export const invalidateSceneTops = () => {
  sceneTopsCache = null;
};

/**
 * Quota in px di ogni sezione `main > section[data-scene]`, per nome. Fonte
 * unica: se un punto dell'app calcolasse la quota per conto proprio, le
 * finestre che devono combaciare con lo stop magnetico potrebbero divergere di
 * un px e i tre titoli si separerebbero.
 *
 * Rilettura a ogni cambio di dimensioni della viewport, non a ogni frame: le
 * sezioni non si spostano da sole. Il chiamante che cambia il layout in
 * proprio deve annullare la cache con invalidateSceneTops.
 */
export const readSceneTops = (): ReadonlyMap<string, number> => {
  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  if (!sceneTopsCache || sceneTopsCache.viewport !== viewport) {
    const tops = new Map<string, number>();
    document
      .querySelectorAll<HTMLElement>('main > section[data-scene]')
      .forEach((section) => {
        const name = section.dataset.scene;
        if (name) tops.set(name, section.offsetTop);
      });
    // Una misura vuota NON viene memorizzata. readSceneTop viene chiamata anche
    // dal primo render di App, quando React non ha ancora committato il DOM e
    // `main` non esiste: memorizzando quegli zero, la cache resterebbe valida
    // per tutta la sessione (la chiave e' la viewport, che non cambia) e ogni
    // sezione risulterebbe a quota 0. Il prezzo e' una rilettura finche' il
    // DOM non e' impaginato, cioe' il solo primo render.
    if (tops.size === 0) return tops;
    sceneTopsCache = { viewport, tops };
  }
  return sceneTopsCache.tops;
};

/** Quota in px di una sezione, per nome. 0 se non esiste. */
export const readSceneTop = (scene: string): number => readSceneTops().get(scene) ?? 0;

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));


export const phase = (value: number, start: number, end: number) => {
  const duration = end - start;
  if (Math.abs(duration) < Number.EPSILON) return value >= end ? 1 : 0;
  return clamp01((value - start) / duration);
};

export const smoothstep = (value: number) => value * value * (3 - 2 * value);

/**
 * HANDOFF preloader -> hero: finestra unica condivisa dal titolo del preloader,
 * dal titolo dell'header e dalla salita dell'h2.
 *
 * Le tre soglie sono ancorate a `heroTop` in px e NON al progress globale. Il
 * progress si sposta se la Works cambia altezza (i suoi tratti sono calcolati in
 * JS dalla striscia reale), quindi non puo' essere l'unita' di due finestre che
 * devono combaciare con lo stop magnetico: quello e' a `heroTop`. Con il
 * progress la crossfade finiva intorno a 1635px mentre il fermo magnetico
 * dell'hero e' a 813px: al fermo il titolo era a meta' viaggio e l'h2 era ancora
 * a 0%.
 *
 * Il viaggio occupa piu' scroll del crossfade perche' muove 358px e cambia corpo
 * del carattere, mentre la crossfade e' un sincronismo: stretta si legge come un
 * incrocio, non come uno stacco.
 */
/**
 * Quota di viaggio del titolo del preloader, in frazioni di viewport.
 *
 * La funzione che la consumava, `heroHandoffTravelPhase`, e' stata tolta: il
 * preloader non si pilota piu' con lo scroll (il pulsante lo sostituisce, e lo
 * scroll resta bloccato finche' la sequenza non finisce). Il numero resta
 * perche' fa parte della finestra condivisa con l'header e con l'h2 dell'hero,
 * che continuano a usare `heroHandoffFadePhase` e `heroHandoffStarted` e devono
 * combaciare al pixel fra loro.
 */
export const HERO_HANDOFF_TRAVEL_VH = 0.5;
export const HERO_HANDOFF_FADE_VH = 0.36;
/** Quanto prima di `heroTop` comincia l'handoff: e' anche la soglia di visibilita' dell'header. */
export const HERO_HANDOFF_LEAD_VH = HERO_HANDOFF_TRAVEL_VH + HERO_HANDOFF_FADE_VH;

/**
 * Crossfade: compare il titolo dell'header e sale l'h2 dell'hero.
 *
 * Resta ancorata allo scroll di proposito: governa l'ARRIVO sulla prima pagina
 * quando l'utente ci arriva scrollando, non l'uscita dal preloader (quella e'
 * un pulsante, e `heroHandoffTravelPhase` che la pilotava e' stata tolta).
 * Va tenuta in accordo con `heroHandoffStarted`, che condivide la soglia
 * d'avvio: i tre titoli devono combaciare al pixel.
 */
export const heroHandoffFadePhase = (
  scrollY: number,
  heroTop: number,
  viewportHeight: number,
) => {
  if (heroTop <= 0) return 0;
  return phase(scrollY, heroTop - HERO_HANDOFF_FADE_VH * viewportHeight, heroTop);
};

/**
 * L'handoff e' iniziato: da qui l'header e' visibile e cliccabile. Si apre
 * all'INIZIO e non alla fine perche' durante la crossfade i due titoli sono
 * entrambi a meta' opacita' e nessuno dei due deve risultare hidden.
 */
export const heroHandoffStarted = (
  scrollY: number,
  heroTop: number,
  viewportHeight: number,
) => heroTop > 0 && scrollY > heroTop - HERO_HANDOFF_LEAD_VH * viewportHeight;

/**
 * Guadagno dello scroll: quanti pixel di pagina vale un'unita' di gesto.
 *
 * Vive qui, e non scritto a mano nelle opzioni dell'istanza, perche' il motore
 * di Lenis applica `wheelMultiplier` PRIMA di emettere `virtual-scroll`:
 * nel sorgente, `deltaY *= wheelMultiplier` avviene dentro `onWheel`, quindi
 * il delta che arriva alla calamita e' gia' moltiplicato. Ne segue che ogni
 * soglia espressa in px di GESTO va divisa per questo numero per continuare a
 * valere la stessa quantita' di input reale: senza la divisione, abbassare il
 * guadagno rende automaticamente piu' rigido il pavimento di gesto, perche'
 * la soglia resta ferma mentre l'input che deve superarla si e' accorciato.
 *
 * Con 0.85 un click da 100px porta ~85px di pagina: attraversare una viewport
 * libera costa ~9.5 click invece di ~8. Sugli stop calamitati non cambia nulla,
 * perche' li conta il magnete e non il guadagno.
 *
 * Non esiste un equivalente per il touch: con `syncTouch: false` il ramo
 * nativo scatta prima che il delta venga applicato e il magnete ignora i
 * non-wheel, quindi `touchMultiplier` qui non governerebbe nulla. Per questo
 * esiste una leva sola invece di due.
 */
export const SCROLL_GAIN = 0.85;

/**
 * Raggio di attrito: distanza entro la quale ci si POSA su uno stop.
 *
 * È la soglia unica del magnetismo di tutto il sito, usata sia dalla calamita
 * (fascia preloader → nebulosa) sia dallo `Snap` di Lenis (fascia libera, dalla
 * Works in poi). Due numeri diversi facevano sentire il passaggio da una fascia
 * all'altra come un cambio di carattere: lo stesso stop si comportava in due
 * modi a seconda di dove si incontrava.
 *
 * 240px è volutamente MENO di metà la distanza fra stop consecutivi (813px a
 * 813 di viewport): sopra la metà, da metà percorso verso la nebulosa ci si
 * riporterebbe all'hero, che è il "torna indietro" che il sito deve evitare.
 *
 * Resta in px di PAGINA e non viene diviso per `SCROLL_GAIN`: e' una soglia di
 * posizione, e dividerla allargherebbe anche la banda magnetica della fascia
 * libera, rendendola piu' appiccicosa. Il prezzo e' che uscire dalla calamita
 * costa ~282px di gesto reale invece di 240.
 */
export const ATTRITION_RADIUS_PX = 240;

/**
 * Viaggio minimo perché un gesto venga preso in considerazione.
 *
 * Sotto questa soglia non è un gesto ma il rumore delle dita sul trackpad, e la
 * decisione è semplicemente "non fare niente": nessuna animazione, nessun
 * rimbalzo. Sta sopra le micro-correzioni (≤15px) e sotto un click di rotellina
 * (~100px).
 */
export const COMMIT_TRAVEL_PX = 40;

/** Quota della navigazione Nebula → Works in cui il viaggio Z è completo. */
export const CAMERA_SETTLED_RATIO = 0.52;

/**
 * Quota della navigazione Nebula → Works in cui finisce l'allargamento della
 * sagoma. È anche l'istante in cui la camera comincia a viaggiare in Z e le
 * particelle vengono rilasciate: l'esplosione.
 *
 * Vive qui (e non nel canvas) perché è un confine di NAVIGAZIONE, non di
 * disegno: sotto questa quota le scene sono a fermo e la transizione fra stop
 * è calamitata, sopra la quota lo scroll è libero.
 */
export const SHAPE_SETTLED_RATIO = 0.18;

/**
 * Quota della navigazione Nebula → Works in cui il layer foreground e la
 * Works entrano insieme. Le sorgenti che generano le card usano un anchor
 * dedicato, leggermente anticipato, definito in ProjectsScene.
 */
export const CARD_REVEAL_RATIO = 0.38;

/** Converte scrollY in una fase locale espressa in viewport. */
export const viewportPhase = (
  scrollY: number,
  startViewport: number,
  endViewport: number,
) => phase(scrollY, startViewport * window.innerHeight, endViewport * window.innerHeight);

/**
 * Posizione orizzontale del ritratto nella Hero editoriale, espressa come
 * frazione della larghezza della viewport (0 = bordo sinistro, 0.5 = centro).
 *
 * Vive qui, e non nel solo DOM, perché il canvas deve disegnare la sagoma
 * esattamente dove sta l'SVG: se le due copie del valore divergono, le
 * particelle del rivelamento compaiono disallineate dal ritratto.
 */
export const HERO_PORTRAIT_X_RATIO = 0.29;

/**
 * Quota della finestra di allargamento durante la quale la sagoma resta
 * ferma nella sua posizione editoriale prima di scivolare al centro.
 *
 * Serve a far succedere, e non sovrapporre, i due eventi: prima la scritta a
 * destra svanisce, POI la sagoma parte. Senza questa sosta le due animazioni
 * partirebiano insieme e l'utente non leggerebbe la sequenza.
 */
/**
 * Quanto inizia prima della fine del reveal il ricentraggio della sagoma, in
 * frazioni di viewport.
 *
 * La traslazione termina esattamente a `revealEnd`, cioe' quando l'SVG ha
 * finito il fade: cosi', quando rimane visibile solo la sagoma, questa e'
 * gia' al centro e ferma, pronta a dissolversi al prossimo scroll. Prima la
 * finestra partiva DOPO la fine del fade e finiva 175px piu' in la', quindi la
 * sagoma si spostava a vista.
 *
 * Il ritratto diventa completamente rosa a opacita' residua 0.35, ovvero poco
 * prima di questo valore: viraggio e scorrimento partono insieme.
 */
export const SHAPE_RECENTER_LEAD_RATIO = 0.18;

/**
 * Fase del ricentraggio della sagoma E del ritratto SVG, da 0 (posizione
 * editoriale, a sinistra) a 1 (centro esatto).
 *
 * Vive qui e non nei due rispettivi componenti perche' finestra e' la stessa
 * finestra: se l'SVG e la sagoma la calcolassero separatamente, un px di
 * differenza li separerebbe durante tutto lo scorrimento, e la particella
 * smetterebbe di combaciare con il ritratto che copre.
 *
 * La finestra termina a `revealEnd`, cioe' quando l'SVG ha finito il fade:
 * cosi', quando rimane visibile solo la sagoma, questa e' gia' al centro e
 * ferma, pronta a dissolversi al prossimo scroll.
 */
export const shapeRecenterPhase = (
  scrollY: number,
  nebulaTop: number,
  viewportHeight: number,
) => {
  const end = portraitRevealEnd(nebulaTop, viewportHeight);
  return phase(scrollY, end - SHAPE_RECENTER_LEAD_RATIO * viewportHeight, end);
};

/**
 * Distanza fra le due colonne del blocco editoriale della Hero.
 *
 * Le colonne sono in fila dentro un contenitore centrato: il gap e' l'unica
 * cosa che le separa e il posizionamento orizzontale non e' calcolato a mano.
 * Prima ciascuna colonna aveva una `left` propria (una in percentuale di
 * viewport, l'altra un max fra percentuale e bordo del ritratto) e il blocco
 * risultava spostato a sinistra.
 */
export const HERO_COLUMN_GAP_PX = 96;

/** Dimensione del ritratto: 41.33vh / 313px, aumentata di 1/4 due volte. */
export const HERO_PORTRAIT_HEIGHT_VH = 41.33 * 1.25 * 1.25;
export const HERO_PORTRAIT_HEIGHT_PX = 313 * 1.25 * 1.25;

/**
 * Quota del viaggio Hero -> Nebula in cui comincia a dissolversi il ritratto.
 * Sostituisce il 1.44vh che stava scritto a mano in HeroScene: finche i due
 * modi di scrivere la finestra hanno prodotto lo stesso numero, coincidevano
 * solo perche le tre sezioni sono tutte h-screen.
 */
export const PORTRAIT_REVEAL_START_RATIO = 0.44;
/**
 * Fine della dissoluzione: 28px, o il 3.5% della viewport se il piu piccolo dei
 * due, PRIMA della nebulosa. Vive qui perche tre consumatori ne hanno bisogno e
 * devono concordare al pixel.
 */
export const portraitRevealEnd = (nebulaTop: number, viewportHeight: number) =>
  nebulaTop - Math.min(28, viewportHeight * 0.035);

/**
 * Inizio e fine della dissoluzione, in px di pagina.
 *
 * UNICA sorgente per tre consumatori che DEVONO marciare insieme: il fade del
 * ritratto in HeroScene, il rilascio delle particelle in ParticleNebulaCanvas e
 * il ricentraggio in shapeRecenterPhase. La finestra era scritta due volte in
 * due sistemi diversi (una quota di viewport e una distanza fra sezioni): i
 * numeri coincidevano solo finche heroTop coincideva con una viewport.
 */
export const portraitRevealWindow = (
  heroTop: number,
  nebulaTop: number,
  viewportHeight: number,
) => {
  const end = portraitRevealEnd(nebulaTop, viewportHeight);
  const start = heroTop + (nebulaTop - heroTop) * PORTRAIT_REVEAL_START_RATIO;
  return { start, end };
};

/** Fase 0..1 della dissoluzione, sulla finestra condivisa. */
export const portraitRevealPhase = (
  scrollY: number,
  heroTop: number,
  nebulaTop: number,
  viewportHeight: number,
) => {
  const { start, end } = portraitRevealWindow(heroTop, nebulaTop, viewportHeight);
  return phase(scrollY, start, end);
};

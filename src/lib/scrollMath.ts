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
 * Quota della dissoluzione da cui parte il VOLO del ritratto verso l header.
 *
 * Il volo e il ricentraggio della sagoma condividono questa finestra: e il
 * patto che li tiene sincroni, perche' quando tornano all'hero devono arrivare
 * insieme e non uno di corsa davanti all altro.
 *
 * Parte prima che l'SVG termini di dissolversi, cosi l'occhio vede l'avatar
 * che sale mentre si affiora la sagoma sulla sua stessa posizione: i due si
 * sostituiscono invece di scomparire e ricomparire altrove. Il valore 0.72 fa
 * occupare la salita agli ultimi due terzi della dissoluzione: inizio col
 * ritratto fermo al suo posto, che e' cio' che l'utente vede nei primi scorsi
 * di scroll, e ultimi scorsi la salita vera.
 *
 * Vive qui e non in HeroScene perche a leggerlo serve anche a
 * `shapeRecenterPhase`, che sta nell'altro componente: se la quota restasse
 * dentro HeroScene, la sagoma dovrebbe importarla da li' o copiare il numero,
 * ed e esattamente la copia che ha fatto divergere i due movimenti.
 */
export const PORTRAIT_LOGO_FLIGHT_RATIO = 0.72;

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
 *
 * L'INIZIO e' quello del VOLO, ed e' la correzione che allinea i due movimenti.
 * Prima partiva da `end - SHAPE_RECENTER_LEAD_RATIO * viewportHeight`, cioe' da
 * una quota di viewport: una finestra che al variare dello schermo non
 * coincideva con quella del ritratto, e i due arrivavano sfalsati. Misurato a
 * 1512x780: il volo finiva a 932px e la sagoma a 850px, cioe' 82px di dislivello —
 * tornando in hero l'avatar era gia' al suo posto mentre la nebulosa stava
 * ancora scorrendo, e il doppio profilo restava in campo per un tratto.
 *
 * Ora entrambe leggono `portraitFlightWindow`: stessa funzione, stessi estremi,
 * quindi non possono disaccordarsi. La perdita e' voluta: il ricentraggio
 * occupa 59px invece di 140px, quindi la sagoma si centra piu' in fretta. E' il
 * prezzo della sincronizzazione, e la sagoma arriva prima che il lettore abbia
 * il tempo di accorgersi che si e' mossa.
 */
export const shapeRecenterPhase = (
  scrollY: number,
  heroTop: number,
  nebulaTop: number,
) => {
  const { start, end } = portraitFlightWindow(heroTop, nebulaTop);
  return phase(scrollY, start, end);
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
 * LE TRE COSTANTI DELLA SEQUENZA HERO → LAVORI.
 *
 * La sequenza (headline che sfuma, avatar che sale, sagoma che nasce, camera
 * che ricentra) è UNA sola finestra di scroll, e queste tre cifre la
 * governano. Sono in alto e sole perché ritoccarle non deve richiedere di
 * leggere la timeline: ogni volta che la sequenza sembrava «troppo lunga» o
 * «troppo lenta» il numero da cambiare era uno di questi tre, non una formula
 * sparsa fra quattro file.
 *
 * HERO_SCROLL_LENGTH — la DURATA della sequenza, come frazione della distanza
 * fra la prima pagina e la nebulosa. Prima la finestra andava da 0.44 a ~1 di
 * quella distanza, cioè partiva a metà strada: i primi due terzi di scroll non
 * movevano niente, e avatar e titolo restavano fermi a piena opacità. Ora è
 * 0.27, poco più della metà della precedente (0.54 → 0.27 del viaggio totale):
 * è il valore che chiede «concludersi in circa metà dello scroll attuale».
 * Alzarlo allunga la sequenza, abbassarlo la accorcia.
 *
 * DISSOLVE_START e DISSOLVE_END — INIZIO e FINE della dissoluzione, in
 * frazione del progresso della sequenza (0 = appena comincia, 1 = finisce).
 * Il trucco per togliere il tratto morto è DISSOLVE_START a 0: il ritratto e il
 * testo reagiscono dal PRIMO pixel di scroll invece di aspettare. Alzarlo
 * reintroduce l'attesa; abbassare DISSOLVE_END finisce la dissoluzione prima,
 * lasciando un tratto finale in cui la pagina è già vuota.
 */
export const HERO_SCROLL_LENGTH = 0.27;
export const DISSOLVE_START = 0;
export const DISSOLVE_END = 1;

/**
 * La lunghezza della sequenza in px, cioè il tratto di scroll che la copre.
 *
 * È proporzionale alla distanza fra le due sezioni e non un numero fisso: le
 * due sono entrambe alte una viewport, quindi su qualunque schermo la
 * sequenza occupa la stessa frazione del viaggio, e i pixel si adattano da
 * soli.
 */
const heroSequenceLength = (heroTop: number, nebulaTop: number) =>
  (nebulaTop - heroTop) * HERO_SCROLL_LENGTH;

/** Inizio della dissoluzione, in px di pagina. */
export const portraitRevealStart = (heroTop: number, nebulaTop: number) =>
  heroTop + heroSequenceLength(heroTop, nebulaTop) * DISSOLVE_START;

/** Fine della dissoluzione, in px di pagina. */
export const portraitRevealEnd = (heroTop: number, nebulaTop: number) =>
  heroTop + heroSequenceLength(heroTop, nebulaTop) * DISSOLVE_END;

/**
 * La finestra del VOLO, cioe' gli ultimi `PORTRAIT_LOGO_FLIGHT_RATIO` della
 * dissoluzione: parte dove comincia a salire l'avatar e finisce con la fine
 * della dissoluzione.
 *
 * UNICA sorgente per i due movimenti che DEVONO arrivare insieme: la salita
 * dell'avatar verso l'header e il ricentraggio della sagoma al centro. Se i due
 * calcolassero la finestra per conto proprio, un px di differenza li separerebbe
 * per tutta la transizione, e tornandone uno prima dell'altro l'occhio vedrebbe
 * il doppio profilo: l'avatar gia' al suo posto mentre la nebulosa scorre ancora.
 */
export const portraitFlightWindow = (heroTop: number, nebulaTop: number) => {
  const { start, end } = portraitRevealWindow(heroTop, nebulaTop);
  return { start: start + (end - start) * PORTRAIT_LOGO_FLIGHT_RATIO, end };
};

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
) => {
  const end = portraitRevealEnd(heroTop, nebulaTop);
  const start = portraitRevealStart(heroTop, nebulaTop);
  return { start, end };
};

/** Fase 0..1 della dissoluzione, sulla finestra condivisa. */
export const portraitRevealPhase = (
  scrollY: number,
  heroTop: number,
  nebulaTop: number,
) => {
  const { start, end } = portraitRevealWindow(heroTop, nebulaTop);
  return phase(scrollY, start, end);
};

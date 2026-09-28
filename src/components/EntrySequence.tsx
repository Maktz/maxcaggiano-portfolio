import { useEffect, useRef } from 'react';
import { animate, type AnimationPlaybackControls } from 'framer-motion';
import { AUDIO_EVENTS, audio } from '@/lib/audioLayer';
import { ENTRY_CONFIG } from '@/lib/entryConfig';
import { entryState, isSkipEntry, type EntryState } from '@/lib/entryState';
import { ScrambleController } from '@/lib/scramble';
import * as avatarController from '@/lib/avatarController';
import { enterAvatar, prepareAvatar, showAvatarImmediately } from '@/lib/avatarEntry';
import { startScrollHint } from '@/lib/scrollHintControl';
import { COORD_SELECTORS, COORD_TEXTS } from '@/lib/entryCopy';
import {
  SCRAMBLE_ROW_IDS,
  SCRAMBLE_ROW_SELECTORS,
  SCRAMBLE_ROWS,
  SCRAMBLE_SUBHEADLINE_SELECTOR,
} from '@/lib/entryCopy';
import { unlockScroll } from '@/lib/scrollLock';
import { rocketManager } from '@/lib/rocketManager';
import { markHeroForAmbientRockets } from '@/lib/stickerRockets';
import { reducedMotion } from '@/lib/motionPreference';

// ORCHESTRAZIONE DELLA SEQUENZA D'INGRESSO.
//
// Un solo posto che sa cosa succede e in che ordine. Ogni fase aggiunta nei
// passi successivi entra qui, in sequenza, e non in un componente a se' stante:
// cosi' i tempi si leggono come una lista e non si distribuiscono su tre file.
//
// La fase non tiene lo stato in React. Il viaggio del nome e' una misura di
// layout seguita da una trasformazione: farlo con uno `useState` significherebbe
// un render a ogni frame. Si scrive direttamente sul nodo, che e' anche il
// modo in cui una FLIP deve funzionare: il primo e l'ultimo frame devono essere
// identici per costruzione, non per approssimazione di un render.

const LOGO_LAYER_ID = 'logo-layer';
// I due estremi del viaggio. Sono selettori e non ref perche' i due titoli
// vivono in due componenti diversi (PreloaderScene e Header) e non hanno un
// antenato in comune che possa passargli un ref: gli attributi sul DOM sono
// l'unico riferimento condiviso che non costringa a cambiarne le firme.
const SOURCE_SELECTOR = '[data-logo-source]';
const TARGET_SELECTOR = '[data-logo-target]';

// Ogni quanti millisecondi arriva un NAME_TRAVEL durante il viaggio. E' un
// campione, non un evento per frame: 100ms e' la granularita' con cui un suono
// di passaggio si legge come un rumore che accompagna, e non come una
// macchinetta che scandisce i frame.
const NAME_TRAVEL_TICK_MS = 100;

/**
 * Ogni quanti millisecondi lo scheduler controlla se e' l'ora di una fase.
 *
 * 16ms e' un frame a 60Hz: la partitura viene quindi letta con la granularita'
 * della risoluzione, e una fase non puo' partire piu' di un frame dopo il suo
 * istante. Piu' basso (per dire 50ms) risparmerebbe qualche wakeup e
 * peggiorerebbe la precisione: le fasi da 150ms diventerebbero imprecise di un
 * terzo del loro valore.
 */
const FRAME_MS = 16;

// La partitura e i suoi timer vivono a livello di modulo, non dentro l'effetto.
//
// Il cleanup dello smontaggio sta in un SECONDO effetto, e un effetto non
// vede le variabili di un altro. Dentro il primo, il cleanup avrebbe potuto
// uscire dalla funzione che lo dichiara, ma qui la struttura e' piu' semplice
// e il motivo e' lo stesso che vale per il resto del modulo: lo stato della
// sequenza e' uno solo, e vive accanto a chi lo usa.
const timers: number[] = [];
const pending: Array<{ at: number; run: () => void; fired: boolean }> = [];

// Il razzo parte una volta sola. Sono due flag e non uno solo perche' coprono
// due domande diverse: se e' gia' partito, e se il suo passaggio e' stato
// annunciato. Con un unico flag, annunciare il passaggio farebbe ripartire
// il razzo, o ripartire il razzo ripeterebbe il suono.
let rocketLaunched = false;
let rocketPassAnnounced = false;

/**
 * Sposta il focus sull'headline, che e' la prima cosa che l'utente deve
 * incontrare della pagina.
 *
 * `tabIndex={-1}` e' sul nodo stesso, non qui: un elemento che si rende
 * focusabile solo al momento giusto e' un elemento che il Tab order non
 * contiene, ed e' esattamente quello che si vuole per un punto di arrivo.
 *
 * `preventScroll` non e' un dettaglio: senza, il browser porterebbe l'<h2> in
 * cima alla viewport e la pagina si troverebbe a meta' dell'hero, che e' la cosa
 * piu' lontana da quello che l'utente ha appena finito di fare.
 */
const HEADLINE_SELECTOR = '[data-scene="hero"] h2';

/**
 * `onlyIfIdle` serve al solo caso `?skip`, dove il focus viene spostato al
 * mount senza che nessuno abbia chiesto niente. Chi e' arrivato con il Tab o ha
 * cliccato qualcosa ha gia' un punto in cui si trova, e strapirglielo sarebbe un
 * intervento arbitrario.
 *
 * Nel flusso normale la guardia sarebbe invece un danno: il click sul pulsante
 * del preloader lascia il focus su quel pulsante, quindi senza guardia il focus
 * non si sposterebbe MAI — cioe' esattamente l'opposto di quello che si vuole.
 */
const focusHeadline = (onlyIfIdle = false): void => {
  const node = document.querySelector<HTMLElement>(HEADLINE_SELECTOR);
  if (!node) return;
  if (onlyIfIdle && document.activeElement !== document.body) return;
  node.focus({ preventScroll: true });
};

/**
 * Durata del crossfade con movimento ridotto, in millisecondi.
 *
 * Piu' che sufficiente a non far sembrare il taglio un errore, meno di quanto
 * servirebbe per farlo notare come animazione. Sopra i ~300ms un utente che ha
 * chiesto meno moto inizia a chiedersi perche' la pagina sta aspettando.
 */
const CROSSFADE_MS = 200;

export default function EntrySequence() {
  // L'animazione in corso, per poterla fermare se il componente smonta o se la
  // sequenza venisse riavviata. Senza, un viaggio interrotto a meta' lascerebbe
  // il logo a mezz'aria con l'opacita' a zero e l'header ancora nascosto.
  const flightRef = useRef<AnimationPlaybackControls | null>(null);

  useEffect(() => {
    /**
     * FASE 1 - IL NOME VOLA NELL'HEADER (tecnica FLIP).
     *
     * FIRST: le due misure sono lette insieme e subito, prima di toccare
     * qualcosa. Se il layout cambiasse fra le due letture (un font che
     * arriva, un resize) i numeri non combacierebbero e il nome atterrerebbe
     * fuori posto: e' l'unico errore che la tecnica non perdona.
     *
     * LAST: il nodo volante viene impaginato nella sua DESTINAZIONE reale,
     * cioe' sul rect dell'header, e da li' riceve la trasformazione inversa
     * che lo riporta a dove stava il titolo del preloader. Finche' la
     * trasformazione e' applicata l'utente vede esattamente il preloader di
     * prima: nessun lampo, nessun doppio testo, nessun salto.
     *
     * PLAY: si toglie la trasformazione. Il nodo scivola nella sua posizione
     * naturale, che e' gia' quella dell'header, e li' resta perche' a fine
     * animazione si azzera: da li' in poi e' l'header a mostrare il titolo.
     */
    const nameTravel = () => {
      const layer = document.getElementById(LOGO_LAYER_ID);
      const source = document.querySelector<HTMLElement>(SOURCE_SELECTOR);
      const target = document.querySelector<HTMLElement>(TARGET_SELECTOR);

      // Se un estremo manca non si puo' fare una FLIP: si salta la fase e si
      // va comunque allo stato successivo, altrimenti la pagina resterebbe
      // bloccata per sempre. Fallire qui deve essere visibile in console.
      if (!layer || !source || !target) {
        console.warn('[ENTRY] name-travel: layer, sorgente o destinazione mancante');
        return;
      }

      // FIRST
      const first = source.getBoundingClientRect();
      // LAST
      const last = target.getBoundingClientRect();

      // Larghezza o altezza nulle: la destinazione non e' impaginata (header
      // ancora nascosto, font non caricato). Un rect a zero produrrebbe una
      // divisione per zero e una scala infinita.
      if (last.width === 0 || last.height === 0) {
        console.warn('[ENTRY] name-travel: destinazione non misurabile');
        return;
      }

      // LAST - il nodo e' gia' nella sua posizione d'arrivo. Da qui in poi la
      // trasformazione e' l'unica cosa che lo tiene "indietro".
      layer.style.left = `${last.left}px`;
      layer.style.top = `${last.top}px`;
      layer.style.opacity = '1';

      // Nasconde la copia di partenza e quella d'arrivo. Senza questo si
      // vedrebbero tre nomi durante il viaggio: quello che vola, quello del
      // preloader e quello dell'header. Il testo d'arrivo resta nascosto FINO
      // AL TERMINE, perche' durante il volo coprirebbe quello volante.
      //
      // `visibility` e non `display`: il nodo deve conservare il suo rect per
      //che le misure successive (i passi 4-5) continuino a trovarlo, e perche'
      // toglierlo dal flusso sposterebbe il contenuto circostante.
      source.style.visibility = 'hidden';
      target.style.visibility = 'hidden';

      // INVERT - la trasformazione che porta il nodo dalla destinazione al
      // punto di partenza. `transform-origin: top left` e' la chiave: con il
      // centro la scala agirebbe attorno a un punto diverso e il testo
      // oscillerebbe invece di restare ancorato al suo angolo.
      const scaleX = first.width / last.width;
      const scaleY = first.height / last.height;
      layer.style.transformOrigin = 'top left';
      layer.style.transform =
        `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${scaleX}, ${scaleY})`;

      audio.play(AUDIO_EVENTS.TRANSITION_START);
      const ticker = window.setInterval(
        () => audio.play(AUDIO_EVENTS.NAME_TRAVEL),
        NAME_TRAVEL_TICK_MS,
      );

      // PLAY - si toglie la trasformazione. Framer-motion accetta i valori
      // singoli (x, y, scaleX, scaleY) invece della stringa `transform`: li
      // compone lui nella matrice, quindi non si rischia di interpolare due
      // stringhe strutturalmente diverse.
      const controls = animate(
        layer,
        { x: 0, y: 0, scaleX: 1, scaleY: 1 },
        {
          duration: ENTRY_CONFIG.nameTravelDuration,
          ease: ENTRY_CONFIG.nameTravelEasing,
          onComplete: () => {
            window.clearInterval(ticker);

            // Azzerare a mano e' quello che rende il nodo indistinguibile
            // dall'header: senza, resterebbe con una matrice applicata e si
            // continuerebbe a dipendere dal layer.
            controls.stop();
            layer.style.transform = '';
            layer.style.transformOrigin = '';
            layer.style.opacity = '0';
            layer.style.left = '';
            layer.style.top = '';

            // Adesso il titolo vero dell'header riprende il suo posto.
            target.style.visibility = '';
            flightRef.current = null;

            // TODO (Passo 7): con prefers-reduced-motion non si vola, si fa
            // un crossfade breve fra preloader e prima pagina. Qui la fase
            // andrebbe saltata e sostituita, non solo accorciata.

            console.log('[ENTRY] name-travel completo');

            // La sequenza CONTINUA: da qui in poi lo scroll resta bloccato e
            // si sblocca solo alla fine dell'ultima fase, non qui.
            //
            // Niente viene pero' avviato da questo punto. Tutte le fasi
            // successive sono gia' state schedulate dal click, e ognuna ha il
            // suo istante assoluto: avviarle da qui le farebbe partire tutte
            // dopo la fine del viaggio, cioe' mezzo secondo dopo.
          },
        },
      );
      flightRef.current = controls;
    };

        // I tempi di partenza delle quattro righe, nell'ordine in cui compaiono in
    // ENTRY_CONFIG. Sono in una lista perche' le righe si somigliano fra loro e
    // differiscono solo per tempo e testo: elencarle rende visibile a colpo
    // d'occhio che lo stagger e' una scala.
    const starts = [
      ENTRY_CONFIG.scrambleHeadlineRow1Start,
      ENTRY_CONFIG.scrambleHeadlineRow2Start,
      ENTRY_CONFIG.scrambleHeadlineRow3Start,
      ENTRY_CONFIG.scrambleSubheadlineStart,
    ];
    const selectors = [
      ...SCRAMBLE_ROW_SELECTORS,
      SCRAMBLE_SUBHEADLINE_SELECTOR,
    ];

    /**
     * FASE 2 - LO SCRAMBLE DI HEADLINE E SUB-HEADLINE.
     *
     * Ogni riga ha il suo istante ASSOLUTO dal click, e lo scheduler la
     * chiama li'. Non si usa un ritardo concatenato ("dopo 0.9s dalla fine
     * del viaggio") perche' i due non coincidono: il viaggio finisce a 0.8s,
     * quindi un offset relativo manderebbe la riga 1 a 1.7s e tutto lo
     * stagger sarebbe sbagliato di mezzo secondo.
     *
     * Il click e' l'unico istante che tutte le fasi condividono, ed e' su
     * quello che sono scritti i tempi in ENTRY_CONFIG: se la base fosse
     * "quando parte la fase", un ritardo in una fase sposterebbe tutte le
     * altre, e i tempi dichiarati non sarebbero piu' quelli veri.
     */
    // Quattro righe, ognuna con i suoi tempi. Uno START per riga e uno
    // RESOLVE per riga: i due insiemi sono separati perche' mescolarli
    // farebbe sommare anche i marker di partenza, e la condizione di fine
    // scatterebbe al primo giro invece che all'ultima riga.
    //
    // Vivono FUORI dalla funzione perche' le righe partono in momenti diversi
    // e ognuna deve poter contare le altre: se fossero locali, ogni riga
    // ripartirebbe da zero e nessuna saprebbe di aver finito per prima.
    const started = new Set<string>();
    const resolvedRows = new Set<string>();

    /**
     * I nodi di una riga, in tutte le istanze del testo.
     *
     * Sotto `md` esiste una seconda istanza dello stesso testo con lo stesso
     * attributo. Scrivere su tutte e' quello che fa si' che il testo giusto
     * venga animato nella viewport giusta, senza duplicare qui la logica del
     * breakpoint che HeroScene gia' conosce.
     */
    const scrambleNodes = (rowIndex: number): HTMLElement[] => {
      const selector = selectors[rowIndex];
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
      if (!nodes.length) console.warn(`[ENTRY] scramble: nessun nodo per ${selector}`);
      return nodes;
    };

    /**
     * Mette le righe nella loro forma finale, senza animazione.
     *
     * Serve ai due rami in cui la partitura non gira — `?skip` e movimento
     * ridotto — dove `runScramble` non viene mai chiamata. Non e' una scorciatoia:
     * i nodi scramble nascono VUOTI e con `visibility: hidden`, quindi senza una
     * scrittura esplicita l'headline sarebbe semplicemente assente invece che
     * "gia' pronta". E' la stessa via che il controller prende da solo con
     * movimento ridotto, chiamata qui perche' sotto `?skip` nessun controller
     * nasce.
     */
    const settleRow = (rowIndex: number): void => {
      const target = SCRAMBLE_ROWS[rowIndex];
      scrambleNodes(rowIndex).forEach((node) => {
        new ScrambleController({ target, node }).settle();
      });
    };

    const runScramble = (rowIndex: number) => {
      const target = SCRAMBLE_ROWS[rowIndex];
      const rowId = SCRAMBLE_ROW_IDS[rowIndex];
      const nodes = scrambleNodes(rowIndex);
      if (!nodes.length) return;

      nodes.forEach((node) => {
          const controller = new ScrambleController({
            target,
            node,
            interval: ENTRY_CONFIG.scrambleCharInterval,
            variance: ENTRY_CONFIG.scrambleCharVariance,
            tick: ENTRY_CONFIG.scrambleTickInterval,
            onComplete: () => {
              // L'evento audio si emette una volta sola per riga: emetterlo per
              // istanza lo raddoppierebbe sotto `md`, dove lo stesso testo esiste
              // due volte.
              if (resolvedRows.has(String(rowId))) return;
              resolvedRows.add(String(rowId));
              audio.play(AUDIO_EVENTS.SCRAMBLE_RESOLVE, { row: rowId });
              // L'ultima riga risolta chiude la fase. Lo sblocco dello scroll
              // NON avviene qui: lo fa la partitura, all'istante dell'ultima
              // fase, cosi' le coordinate e il prompt hanno il tempo di
              // comparire prima che l'utente possa muovere la pagina.
              if (resolvedRows.size >= starts.length) {
                console.log('[ENTRY] scramble completo');
              }
            },
          });
          // Lo scheduler ha gia' aspettato il suo istante: qui si parte subito.
          // Il nodo aveva il testo FINALE e si maschera ora: se partisse gia'
          // mascherato, con `?skip` o se la fase non partisse, il visitatore
          // leggerebbe simboli al posto del titolo.
          controller.start(0);
          if (!started.has(String(rowId))) {
            started.add(String(rowId));
            audio.play(AUDIO_EVENTS.SCRAMBLE_START, { row: rowId });
          }
        });
    };

    /**
     * LO SCHEDULER DELLA SEQUENZA.
     *
     * Un solo orologio per tutte le fasi, con l'istante del click come zero.
     * Ogni fase chiede "fammi partire a 0.9 secondi dal click" e lo scheduler
     * calcola quanto manca: e' l'unico modo perche' i tempi scritti in
     * ENTRY_CONFIG siano davvero quelli che si vedono.
     *
     * Senza questo, ogni fase che nasce da un'altra (lo scramble nasceva dalla
     * fine del viaggio del nome) eredita il ritardo di quella che l'ha
     * generata, e mezzo secondo di differenza in una fase sposta tutte le
     * successive. I tempi dichiarati sarebbero allora falsi, e correggere un
     * ritardo significherebbe ripiombrare dentro ogni fase a valle.
     *
     * Il confronto e' `elapsed >= seconds` e non un timeout per fase: se un
     * frame salta, un timeout partirebbe tardi e inafferrabile, mentre il
     * confronto si riallinea da solo al frame dopo. Il ritardo che si perde e'
     * la durata del frame perso, che e' il minimo che si possa perdere.
     */
    let timelineStart = 0;

    const schedule = (seconds: number, run: () => void) => {
      pending.push({ at: seconds, run, fired: false });
    };

    const pump = () => {
      if (!timelineStart) return;
      const elapsed = (performance.now() - timelineStart) / 1000;
      for (const item of pending) {
        if (item.fired || elapsed < item.at) continue;
        item.fired = true;
        item.run();
      }
    };

    /**
     * FASE 5 - LE COORDINATE si scrivono carattere per carattere.
     *
     * Riusa lo stesso controller dello scramble ma in modalita' `write`: le
     * posizioni non ancora risolte restano VUOTE invece di diventare simboli.
     * E' la differenza fra un terminale che scrive un dato e un titolo che si
     * compone, e su tre righe di numeri la differenza si sente subito.
     */
    const writeCoord = (index: number) => {
      if (isSkipEntry()) return;
      const node = document.querySelector<HTMLElement>(COORD_SELECTORS[index]);
      if (!node) return;
      new ScrambleController({
        target: COORD_TEXTS[index],
        node,
        mode: 'write',
        // Le coordinate non hanno varianza: sono dati, e un numero che arriva
        // con tempi irregolari sembra una lettura instabile.
        variance: 0,
        interval: ENTRY_CONFIG.coordCharDelay,
        tick: ENTRY_CONFIG.coordCharDelay,
      }).start(0);
    };

    /**
     * LA PARTITURA.
     *
     * Ogni riga e' un istante ASSOLUTO dal click e quello che deve accadere li'.
     * Si legge dall'alto come una scala, ed e' l'unica lista di tempi della
     * sequenza: ENTRY_CONFIG dice QUANTO dura ogni cosa, questa tabella dice
     * QUANDO.
     */
    const buildTimeline = () => {
      // t=0.00 — IL PULSANTE. L'inversione arriva nel Passo 5, qui si registra
      // solo l'evento: il click e' il vero zero di tutta la partitura.
      schedule(0, () => {
        audio.play(AUDIO_EVENTS.ENTER_CLICK);
      });

      // t=0.30 — IL NOME VOLA NELL'HEADER.
      //
      // Il viaggio parte a 0 e non a 0.30: dura 0.8s, quindi partirlo a 0.30 lo
      // farebbe finire a 1.10 e la riga 1 dell'headline partirebbe mentre il
      // nome e' ancora in volo. Il valore in tabella e' quello dichiarato nella
      // specifica, e il viaggio e' l'unica cosa che parte davvero al click:
      // spostarlo per allinearlo alla tabella romperebbe proprio lo stagger che
      // la tabella prescrive.
      schedule(0, () => {
        nameTravel();
      });

      // t=0.90 / 1.20 / 1.50 / 1.80 — LE QUATTRO RIGHE DEL TESTO
      starts.forEach((startSeconds, index) => {
        schedule(startSeconds, () => runScramble(index));
      });

      // t=1.00 — L'AVATAR ENTRA IN SCENA
      schedule(ENTRY_CONFIG.avatarEntryStart, () => {
        // L'idle si sospende PRIMA che l'avatar diventi visibile: sospendendolo
        // dopo, per un frame il viso mostrerebbe il ciclo autonomo al posto
        // della posa di riposo che sta per arrivare.
        avatarController.suspendIdle();
        avatarController.setPose('riposo', { duration: 0 });
        enterAvatar({
          duration: ENTRY_CONFIG.avatarEntryDuration,
          easing: ENTRY_CONFIG.avatarEntryEasing,
          onComplete: () => {
            audio.play(AUDIO_EVENTS.AVATAR_LANDED);
          },
        });
      });

      // t=1.50 — IL BLINK, e subito dopo il ritorno
      schedule(ENTRY_CONFIG.avatarBlinkStart, () => {
        avatarController.blink(ENTRY_CONFIG.avatarBlinkDuration);
        // Il ritorno non e' una posa ma la fine dell'impulso, e il controller
        // ci torna da solo chiudendo il ciclo. La chiamata esplicita mette in
        // sicurezza il caso in cui il blink venga interrotto a meta': senza,
        // la posa resterebbe socchiusa fino alla fase successiva.
        schedule(
          ENTRY_CONFIG.avatarBlinkStart + ENTRY_CONFIG.avatarBlinkDuration / 1000,
          () => avatarController.setPose('riposo', { duration: 100 }),
        );
      });

      // t=2.00 — IL RAZZO, e con lui la sorpresa e il sorriso.
      //
      // Sorpresa e sorriso non hanno piu' un orario: nascono dagli eventi reali
      // del razzo. Il viso reagisce a una cosa che sta accadendo, non a un
      // secondo che e' passato. E' l'unica parte della partitura che ascolta
      // il mondo invece di scandire il tempo, ed e' per questo che sta qui e non
      // dentro l'avatar.
      schedule(ENTRY_CONFIG.rocketScriptedStart, () => {
        if (rocketLaunched) return;
        rocketLaunched = true;
        rocketManager.launchScripted({
          onPosition: (x, y) => {
            // Lo sguardo segue il razzo a ogni frame: e' la stessa coordinata
            // che il manager ha usato per disegnarlo, quindi non si puo' disallineare
            // dall'immagine nemmeno per un frame.
            avatarController.lookAt(x, y);
            // Il suono arriva a meta' schermo, una volta sola: e' il momento in cui
            // il razzo e' davanti al viso e copre meno testo.
            //
            // ROCKET_PASS e' emesso qui e NON dentro rocketManager, anche se il
            // passaggio e' suo. La meta' dello schermo si conosce solo dal
            // callback di posizione, che riceve la coordinata a ogni frame:
            // dentro il manager si saprebbe solo "un razzo e' partito", che non
            // distingue il passaggio dal semplice lancio. Emetterlo anche li'
            // farebbe suonare l'evento due volte, una al posto giusto e una
            // fuori tempo.
            if (!rocketPassAnnounced && x <= window.innerWidth / 2) {
              rocketPassAnnounced = true;
              audio.play(AUDIO_EVENTS.ROCKET_PASS);
            }
          },
          onExit: () => {
            // Il razzo e' uscito dal bordo sinistro: si rilascia lo sguardo e si
            // sorride. Si rilascia PRIMA che il sorriso arrivi a meta', cosi' le
            // pupille tornano al centro mentre il viso si scioglie, e non dopo,
            // quando l'occhio avrebbe gia' cambiato espressione.
            avatarController.releaseLook();
            avatarController.setPose('sorriso', {
              duration: ENTRY_CONFIG.avatarSmileDuration,
            });
          },
        });
        // La sorpresa e' l'entrata del razzo: parte insieme al lancio, non a un
        // secondo fisso che cascherebbe vicino ma non per causa del razzo.
        avatarController.setPose('sorpresa', {
          duration: ENTRY_CONFIG.avatarSurpriseDuration,
        });
      });

      // t=3.10 — L'IDLE RIPARTE.
      //
      // Non riparte da una posa scritta qui: riparte da quella che l'avatar sta
      // dicendo, e il controller la conosce perche' la tiene come punto di
      // partenza di ogni transizione. E' l'ultimo gesto della sequenza: dopo
      // questo il ciclo autonomo e' di nuovo lui e non va piu' disturbato.
      schedule(ENTRY_CONFIG.avatarIdleStart, () => {
        avatarController.resumeIdle();
      });

      // t=3.00 / 3.15 — LE COORDINATE si scrivono, carattere per carattere.
      //
      // Partono mentre l'avatar e' ancora in sorriso: sono l'ultima cosa che il
      // lettore legge e non hanno bisogno di competere con lui per l'attenzione.
      // Milano e la Via Lattea insieme, Potenza subito dopo: il blocco geografico
      // e' un unico elemento in due righe, e scriverlo riga per riga evita che
      // la seconda compaia staccata dalla prima.
      schedule(ENTRY_CONFIG.coordMilanoStart, () => writeCoord(0));
      schedule(ENTRY_CONFIG.coordPotenzaStart, () => writeCoord(1));
      schedule(ENTRY_CONFIG.coordViaLattea, () => writeCoord(2));

      // t=3.50 — IL PROMPT DI SCORRIMENTO.
      //
      // E' l'ultimo atto, e non un caso: e' il testo che sblocca la pagina. Finche'
      // non e' comparso, l'utente non sa che puo' continuare, quindi lo scroll
      // resta fermo anche se la sequenza e' finita.
      schedule(ENTRY_CONFIG.scrollHintStart, () => {
        startScrollHint();
        // Lo sblocco avviene quando l'hint ha finito di comporsi, non qui:
        // sbloccare mentre il prompt si scrive lascerebbe l'utente libero di
        // scorrere via prima di averlo letto.
      });
    };

    // La sequenza parte quando lo stato passa a `entering`, e non quando il
    // componente monta: il click sul pulsante e' l'evento, e questo modulo deve
    // poter essere montato in qualsiasi momento senza perdere un passo.
    const onState = (state: EntryState) => {
      // I razzi ambient ripartono qui e non altrove: questo e' l'unico punto in
      // cui la pagina diventa utilizzabile, quindi e' l'unico posto in cui ha
      // senso far scattare il ritardo che li tiene fermi durante l'ingresso.
      //
      // Vale anche sotto `?skip` e con movimento ridotto, e li' la scelta e'
      // deliberata: quei due casi non hanno sequenza, ma hanno comunque un
      // momento in cui la pagina diventa viva, e applicare la stessa regola
      // ovunque vale piu' che inventare un secondo comportamento solo per loro.
      if (state === 'hero') {
        markHeroForAmbientRockets();
        // Il focus segue lo sblocco, non lo precede: `unlockScroll()` e' cio' che
        // rende la pagina interagibile, e spostare il focus mentre lo scroll e'
        // ancora fermo lascerebbe il focus su un nodo che l'utente non puo'
        // ancora raggiungere con la tastiera. Con `?skip` lo sblocco e'
        // avvenuto al mount, quindi qui arriva gia' nella situazione giusta.
        focusHeadline();
        return;
      }
      if (state !== 'entering') return;
      // Sotto `?skip` non c'e' sequenza: l'avatar e' gia' a posto e l'idle gira
      // da solo, quindi non si schedula niente. Senza questo controllo l'`?skip`
      // riprodurrebbe qui tutta la coreografia che il flag serve a evitare.
      //
      // Sblocca comunque: lo sblocco normale aspetta che il prompt si componga,
      // e qui il prompt non esiste affatto, quindi se non sblocchesse qui la
      // pagina resterebbe congelata per sempre.
      if (isSkipEntry()) {
        showAvatarImmediately();
        startScrollHint();
        unlockScroll();
        return;
      }
      // Con movimento ridotto l'avatar e' gia' al suo posto, in sorriso, e
      // l'idle gira: non c'e' ingresso da animare ne' espressioni da seguire.
      // Il viso non resta sospeso in mezzo a una sequenza che non esiste, e i
      // path restano quelli del ciclo autonomo. Come sopra, lo sblocco e'
      // qui perche' l'hint non parte e nessun altro lo farebbe.
      //
      // Il crossfade e' l'unico moto che resta: 200ms in cui il preloader
      // dissolve sull'hero gia' pronto. Non e' un ornamento, e' la differenza
      // fra "meno animazione" e "nessuna animazione": a quest'ultima si arriva
      // togliendo tutto, e l'utente si troverebbe davanti a un cambio di scena
      // istantaneo che non e' piu' accessibile di una dissolvenza, solo piu'
      // brusco. L'opacita' e' sull'involucro del preloader e non sul testo
      // dell'headline: se il titolo si spegnesse, l'utente perderebbe la
      // prima cosa che sta per leggere.
      if (reducedMotion) {
        showAvatarImmediately();
        avatarController.setPose('sorriso', { duration: 0 });
        // Le righe vanno messe in forma finale qui: sotto movimento ridotto la
        // partitura non parte, e i nodi scramble nascono vuoti e nascosti.
        starts.forEach((_, index) => settleRow(index));
        // Hint e sblocco aspettano il crossfade, e vanno insieme. L'hint, da
        // solo, non puo' decidere: la sua composizione finirebbe subito e
        // porterebbe con se' lo sblocco, sbloccando a zero millisecondi. Qui si
        // comanda il momento, e il doppio `unlockScroll()` che ne segue e'
        // innocuo perche' e' idempotente.
        timers.push(window.setTimeout(() => {
          startScrollHint();
          unlockScroll();
        }, CROSSFADE_MS));
        return;
      }
      timelineStart = performance.now();
      // L'avatar viene nascosto PRIMA che la partitura cominci: senza, il
      // preloader che copre lo schermo farebbe da schermo all'avatar, che
      // diventerebbe visibile un frame o due prima dell'ingresso vero e
      // mostrerebbe il viso gia' nella sua posizione finale, cioe' il
      // restringimento che l'ingresso doveva evitare.
      prepareAvatar();
      buildTimeline();

      // Il pump gira finche' la partitura non e' vuota. Lo sblocco NON avviene
      // qui: aspetta che l'hint abbia finito di comporsi, e lo fa lui.
      //
      // Un pump che continua per tutta la vita della pagina costerebbe un
      // wakeup ogni 16ms per niente, quindi si stacca appena la tabella e' stata
      // esaurita e passa il compito allo sblocco.
      const tick = () => {
        pump();
        if (pending.some((item) => !item.fired)) {
          timers.push(window.setTimeout(tick, FRAME_MS));
        }
      };
      timers.push(window.setTimeout(tick, FRAME_MS));

      // Lo sblucco e' agganciato all'hint: quando il prompt ha finito di
      // comporsi, la sequenza e' davvero finita. Con `?skip` o movimento ridotto
      // l'hint non passa dallo scheduler, quindi ci pensa il ramo che le
      // gestisce: senza questo, in quei due casi la pagina resterebbe
      // congelata per sempre.
      // Qui dentro il movimento ridotto e' gia' escluso: il ramo ridotto e'
      // tornato indietro piu' sopra. Il controllo che resta e' solo `?skip`, e
      // tenerlo avrebbe lasciato in giro una condizione che non puo' essere
      // vera, cioe' un ramo che nessuno puo' verificare.
      if (isSkipEntry()) {
        startScrollHint();
        unlockScroll();
      }
    };

    const unsubscribe = entryState.subscribe(onState);
    // Sotto `?skip` lo stato iniziale e' GIA' `hero`: non e' una transizione,
    // quindi nessun ascolto la vedra' passare, e il clock del gate dei razzi
    // ambient resterebbe fermo sull'epoca, cioe' sempre scaduto. Senza questa
    // chiamata i razzi comparirebbero sul primo frame invece che dopo il ritardo.
    // Sotto `?skip` lo stato iniziale e' GIA' `hero`: non e' una transizione,
    // quindi nessun ascolto la vedra' passare, e il clock del gate dei razzi
    // ambient resterebbe fermo sull'epoca, cioe' sempre scaduto. Senza questa
    // chiamata i razzi comparirebbero sul primo frame invece che dopo il ritardo.
    //
    // Il `true` e' la guardia "solo se la pagina e' ferma": al mount non e'
    // l'utente ad aver chiesto lo spostamento del focus, e se ha gia' toccato
    // qualcosa non gli si toglie.
    if (entryState.get() === 'hero') {
      markHeroForAmbientRockets();
      focusHeadline(true);
      // Sotto `?skip` non c'e' click, quindi nessuna partitura e nessuna
      // `runScramble`: le righe resterebbero nei loro nodi vuoti e nascosti, e
      // l'headline sarebbe assente. Una passata sola, qui, le mette in forma
      // finale — che e' l'unica forma che `?skip` deve mostrare.
      if (isSkipEntry()) starts.forEach((_, index) => settleRow(index));
    }
    return unsubscribe;
  }, []);

  // Smontaggio: un viaggio a meta' lascerebbe il logo fuori posto, l'header
  // senza titolo e la partitura a metà. Fermare tutto e riportare le cose al
  // loro stato di riposo e' l'unico modo in cui lo smontaggio non si vede.
  useEffect(
    () => () => {
      // I timer della partitura: senza questo, un componente che smonta a
      // meta' sequenza lascerebbe il pump vivo e le sue fasi continuerebbero a
      // scrivere su nodi che non esistono piu'.
      timers.forEach((id) => window.clearTimeout(id));
      timers.length = 0;
      pending.length = 0;
      // Il razzo scripted: si stacca il suo ciclo e si toglie il canvas dal DOM.
      // Senza, un componente che smonta a meta' sequenza lascerebbe un elemento
      // fermo in pagina per tutta la visita.
      rocketManager.dispose();
      // L'avatar torna visibile e fermo: se lo si lasciasse sospeso, il rig
      // resterebbe congelato su una posa che nessuno piu' governa.
      showAvatarImmediately();
      avatarController.resumeIdle();
      flightRef.current?.stop();
      const layer = document.getElementById(LOGO_LAYER_ID);
      if (layer) {
        layer.style.transform = '';
        layer.style.transformOrigin = '';
        layer.style.opacity = '0';
        layer.style.left = '';
        layer.style.top = '';
      }
      document
        .querySelector<HTMLElement>(TARGET_SELECTOR)
        ?.style.removeProperty('visibility');
    },
    [],
  );

  // Non renderizza nulla: e' solo un orchestratore. La timeline vive nei suoi
  // effetti, non nel markup.
  return null;
}

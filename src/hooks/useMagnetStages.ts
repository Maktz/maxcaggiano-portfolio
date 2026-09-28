import { useEffect } from 'react';
import { useSmoothScroll } from '@/providers/smoothScrollContext';
import { reducedMotion } from '@/lib/motionPreference';
import {
  ATTRITION_RADIUS_PX,
  COMMIT_TRAVEL_PX,
  readSceneTops,
  SCROLL_GAIN,
  SHAPE_SETTLED_RATIO,
} from '@/lib/scrollMath';

// CALAMITA: transizione fra stop per ATTRITO, non per BLOCCO.
//
// Il modello è quello di planetono.space, verificato leggendo il suo bundle:
// `new Lenis({ lerp: .075 })` e basta, nessun handler su `virtual-scroll`, nessun
// rifiuto del delta, nessuno Snap. Su quel sito lo scroll è libero e la coda
// lunga e' l'unica cosa che fa posare il foglio: uno scroll intenso arriva
// "quasi in fondo alla scena" e si ferma dolcemente.
//
// Qui gli stop esistono e servono, perche' il preloader e l'hero sono scene a
// fermo: il ritratto e l'h2 devono poter essere letti a schermo intero. La
// differenza rispetto al modello precedente e' UNA sola, ed e' la causa dei tre
// difetti segnalati:
//
//   PRIMA (cancello): il delta veniva RIFIUTATO con preventDefault quando
//   proiettava oltre lo stop di destinazione, e una sessione sotto soglia
//   rimbalzava indietro con easeOutBack, che oltrepassa il bersaglio. Da li' i
//   tre sintomi: il dito si muove e la pagina no ("rimane bloccato, bisogna
//   insistere"), il ritorno a molla, e il passo unico tassativo che vietava di
//   attraversare piu' di una scena per gesto.
//
//   ADESSO (attrito): il delta NON viene mai rifiutato e la pagina segue il dito
//   1:1, sempre. Alla fine del gesto si guarda solo DOVE si e' arrivati: se si
//   e' entro ATTRITION_RADIUS_PX da uno stop, ci si posa sopra con la coda
//   dell'istanza; se si e' piu' lontano, non si fa nulla. Il magnete e' un
//   PAVIMENTO che attira, non un soffitto che trattiene.
//
// Il criterio di arresto NON e' stato sbloccato: la calamita continua a valere
// una sezione alla volta. E' cambiato il modo in cui si decide, non la regola.
//
// Nessun `lock: true`: e' la causa del deadlock precedente (scrollTo diventava
// un no-op silenzioso mentre il lock interno era ancora attivo). Il nuovo
// scrollTo parte dalla posizione corrente e un gesto in arrivo lo sovrascrive
// in modo pulito, quindi l'utente resta sempre libero di interrompere.

// SESSIONE di scroll: gli eventi si accumulano finché l'utente non fa una
// pausa, e la decisione si prende UNA volta sola.
//
// Valutare ogni gesto singolarmente non funziona con il mouse: ogni scatto di
// rotellina è un gesto a sé (100px, e i giri arrivano a oltre 200ms di distanza),
// quindi più gesti ravvicinati non raggiungerebbero mai la soglia e ogni scatto
// produrrebbe una decisione separata. La coda d'inerzia dello stesso colpo, in
//oltre, arriva come gesto successivo e farebbe decidere due volte.
const SESSION_QUIET_MS = 300;
// Soglia di commessa: COMMIT_TRAVEL_PX, in scrollMath. Sotto non è un gesto.
// Non c'è più nessun'altra soglia di forza: non esiste un "pavolo" oltre il quale
// il gesto diventa automaticamente un passo intero, perché quello era il motivo
// per cui una sfioratura di pochi pixel su trackpad faceva saltare una viewport.
// DIVISA per il guadagno, e la divisione non e' un dettaglio estetico. Il
// motore moltiplica il delta PRIMA di emettere `virtual-scroll`, quindi
// `sessionSum` e' gia' in px di pagina: a gain 0.85 un click da 100px vale 85.
// Confrontando 85 (o 40) con una soglia scritta in input reale, la soglia
// diventerebbe di fatto piu' rigida a ogni ribasso del guadagno, perche'
// resterebbe ferma mentre l'input che deve superarla si accorcia. Dividendo, il
// pavimento continua a valere 40px di GESTO vero, che e' il numero commentato
// in COMMIT_TRAVEL_PX (sopra le micro-correzioni, sotto il click).
const JITTER_FLOOR_PX = COMMIT_TRAVEL_PX / SCROLL_GAIN;
// Smorzamento esponenziale per le posate, indipendente dalla distanza.
// `programmatic: false` azzera i default di durata ed easing dell'istanza, e nel
// motore vale `if (duration && easing)` PRIMA del ramo lerp: senza quel flag il
// lerp verrebbe proprio ignorato e la posata tornerebbe temporale.
const MAGNET_LERP = 0.115;
// Entro questa distanza da uno stop calamitato il magnete si arma. Serve a non
// riportare indietro chi è nel mezzo del percorso, mentre chi è fermo sullo
// stop resta calamitato.
const ARM_TOLERANCE_PX = 80;

// easeOutBack e easeOutQuint sono state rimossa insieme al rimbalzo: la molla
// era la causa diretta del "torna indietro come una molla". easeOutBack
// oltrepassava il bersaglio di un 10% (c1 = 1.70158) e rientrava, quindi anche
// un errore di 15px veniva restituito con un movimento che si vedeva. Tutte le
// posate passano ora da commitTo, che usa la coda esponenziale: quella non può
// oltrepassare il bersaglio, per costruzione.

interface VirtualScrollData {
  deltaY: number;
  event: WheelEvent | TouchEvent;
}

// Gesto nato dentro un contenitore scrollabile (modale): non lo toccare.
const isInsideNestedScroll = (target: EventTarget | null, delta: number) => {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    if (node.hasAttribute('data-lenis-prevent')) return true;
    const { overflowY } = window.getComputedStyle(node);
    const scrollable =
      (overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;
    const hasRoom = delta > 0
      ? node.scrollTop + node.clientHeight < node.scrollHeight - 1
      : node.scrollTop > 0;
    if (scrollable && hasRoom) return true;
    node = node.parentElement;
  }
  return false;
};

/**
 * Stop calamitati e confine dell'esplosione, riletti dal DOM a ogni gesto: le
 * sezioni sono la fonte unica delle posizioni, quindi resize e contenuto restano
 * coerenti senza duplicare numeri nel codice.
 *
 * Gli stop calamitati sono le sezioni fino alla nebulosa INCLUSA: Preloader,
 * Hero e la cima della Nebula (1800), dove la sagoma comincia ad allargarsi.
 * La nebulosa è anche l'inizio del percorso continuo che porta all'esplosione:
 * superato l'ultimo stop lo scroll diventa libero e oltre l'esplosione torna il
 * richiamo magnetico su Works/Transmission.
 */
const readStage = () => {
  // Unica lettura, e cache: prima questa funzione faceva 2 querySelector piu'
  // una querySelectorAll e cinque offsetTop A OGNI EVENTO WHEEL, cioe' un layout
  // forzato per evento del mouse. Ora le quote arrivano dalla cache dei offsets
  // di scrollMath, che si invalida da sola al resize e quando la Works scrive
  // la propria altezza: stessi numeri, costo nullo.
  const tops = readSceneTops();
  const nebula = tops.get('nebula');
  const works = tops.get('works');
  if (nebula === undefined || works === undefined) return null;
  const journeyLength = works - nebula;
  if (journeyLength <= 0) return null;
  const explosionAt = nebula + journeyLength * SHAPE_SETTLED_RATIO;
  const stops = Array.from(tops.values())
    .filter((top) => top <= nebula)
    .sort((a, b) => a - b);
  if (stops.length === 0) return null;
  return { stops, explosionAt };
};

export function useMagnetStages() {
  const { lenis, scrollY, getSnap } = useSmoothScroll();

  useEffect(() => {
    let sessionSum = 0;
    // true se la sessione e partita calamitata. Serve a non far produrre ALCUNA
    // animazione a closeSession per una sessione libera, che altrimenti
    // riporterebbe il foglio a uno stop arbitrario.
    let sessionArmed = false;
    // La posizione di partenza serve perché il controllo sul confine
    // (esplosione) valga da DOVE si è partiti: usare la posizione di fine
    // sessione darebbe a un colpo forte la via d'uscita, perché trascinando la
    // pagina oltre il confine il magnete si auto-disarmerebbe prima ancora di
    // aver deciso.
    let sessionStartY = 0;
    // L'indice dello stop di partenza e la velocità della sessione sono stati
    // rimossi insieme al modello a cancello: il bersaglio si sceglie dalla
    // posizione REALE e il rimbalzo non esiste piu', quindi nessuno dei due
    // aveva più un uso. Resta solo l'accumulato, che serve a distinguere un
    // gesto dal rumore delle dita.
    let lastEventAt = 0;
    let closeTimer = 0;
    // true = magnete armato, false = percorso libero.
    let armed: boolean | null = null;
    let snapRunning: boolean | null = null;
    // Vero fra la chiamata di commit e l'arrivo sullo stop. Serve a tenere il
    // magnete armato mentre il foglio è in volo: a metà fra due stop la
    // distanza da entrambi supera ARM_TOLERANCE_PX, quindi ricalcolare `armed`
    // dalla posizione corrente lo disarmava e il gesto successivo veniva
    // buttato — la pagina sembrava morta mentre si posava.
    let inFlight = false;
    // Destinazione del volo in corso. Una sessione che si apre mentre il foglio
    // e' in mezzo riparte da QUI e non dalla posizione corrente: altrimenti
    // ripartirebbe dal fermo che sta lasciando alle spalle, il limite di stop
    // punterebbe a quel fermo e il gesto verrebbe assorbito senza produrre
    // nulla — la pagina sembrerebbe bloccata per tutta la durata del volo.
    let flightTarget: number | null = null;
    // CODA D'INERZIA. Difetto segnalato: un solo colpo di rotellina dal
    // preloader attraversava DUE scene (ferma un istante sull'hero con h2 e
    // ritratto, poi schiacciata subito sulla sagoma). La coda d'inerzia dello
    // stesso colpo arriva DOPO che la sessione si e' chiusa e, trovando il
    // foglio fermo sullo stop, il magnete la leggeva come una sessione NUOVA e
    // committava il passo successivo. Finche' `settling` e' vero la coda viene
    // assorbita dalla sessione che ha gia' consegnato il suo passo: non puo'
    // committarne un secondo e non puo' trascinare il foglio oltre lo stop,
    // che e' esattamente la fermata che l'utente si aspetta. Il gesto
    // successivo, quello vero, riparte da li'.
    let settling = false;
    // Lo stop a cui la coda viene inchiodata. Resta valido anche a volo
    // finito, perche' a quel punto flightTarget e' gia' stato azzerato.
    let settleStop: number | null = null;
    let settleTimer = 0;

    // L'armamento si decide UNA VOLTA PER SESSIONE, al suo primo evento, non a ogni
    // evento: durante il viaggio la pagina si allontana dallo stop, e se
    // l'allontanamento spegnesse il magnete a metà gesto la molla non
    // scatterebbe più.
    const syncEngagement = (y: number) => {
      const stage = readStage();
      if (!stage) return;
      // Il richiamo magnetico torna solo oltre l'esplosione: nel percorso della
      // nebulosa non deve esserci nessuno stop che tiri indietro.
      const shouldRunSnap = y >= stage.explosionAt;
      if (snapRunning !== shouldRunSnap) {
        snapRunning = shouldRunSnap;
        const snap = getSnap();
        if (snap) {
          if (shouldRunSnap) snap.start();
          else snap.stop();
        }
      }
      // Il magnete è armato solo se il gesto COMINCIA presso uno stop calamitato:
      // chi è nel mezzo del percorso non viene più richiamato all'hero. Fa
      // eccezione il volo in corso: l'utente sta già andando verso uno stop, e
      // disarmarlo a metà significa che il gesto che segue non produce nulla.
      const shouldArm = y < stage.explosionAt && (
        inFlight || stage.stops.some((stop) => Math.abs(y - stop) <= ARM_TOLERANCE_PX)
      );
      if (armed !== shouldArm) armed = shouldArm;
    };

    // Programma la chiusura dell'assorbimento della coda. Chiamata da `onComplete`
    // e, soprattutto, a ogni evento della coda: vedi il blocco in onVirtualScroll.
    // Senza il riarma per evento la finestra era una DURATA FISSA, e la coda
    // lunga di un trackpad (oltre un secondo di eventi) la attraversava,
    // committando un passo in piu': era il difetto dell'attraversamento doppio.
    const armSettle = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settling = false;
        settleStop = null;
        syncEngagement(scrollY.get());
      }, SESSION_QUIET_MS);
    };

    // Commessa verso uno stop calamitato, con smorzamento esponenziale.
    //
    // `programmatic: false` non è un dettaglio: azzera i valori di default di
    // durata ed easing che scrollTo eredita dall'istanza, e nel motore di Lenis
    // vale `if (duration && easing)` PRIMA del ramo lerp. Senza questo flag il
    // lerp passato qui verrebbe proprio ignorato e la commessa tornerebbe
    // temporale.
    //
    // Effetto collaterale VOLUTO: con programmatic false, `targetScroll` smette
    // di seguire l'animazione e resta sul bersaglio. E la proiezione giusta per
    // il limite di stop, che prima inseguiva la posizione reale e quindi non
    // limitava mai nulla.
    const commitTo = (target: number) => {
      if (reducedMotion) {
        lenis.scrollTo(target, { immediate: true });
        return;
      }
      inFlight = true;
      flightTarget = target;
      // Da qui la coda dello stesso colpo viene assorbita: vedi la nota di
      // `settling`. Si chiude quando il volo arriva E il colpo tace, cosi'
      // l'utente non resta con il magnete incollato addosso.
      settling = true;
      settleStop = target;
      lenis.scrollTo(target, {
        programmatic: false,
        lerp: MAGNET_LERP,
        onComplete: () => {
          inFlight = false;
          flightTarget = null;
          // Si chiude quando il colpo tace, non a tempo: vedi armSettle.
          armSettle();
        },
      });
    };

    // Uscita dal percorso calamitato: da qui in poi lo scroll è libero e torna il
    // richiamo magnetico.
    const releaseToFreeScroll = () => {
      armed = false;
      snapRunning = false;
      getSnap()?.start();
    };

    const decideSession = () => {
      const stage = readStage();
      if (!stage) return;
      // Sessione non calamitata (scroll libero): nessuna animazione.
      if (sessionArmed !== true) return;
      const y = scrollY.get();
      // Il confine si valida sulla posizione di PARTENZA della sessione, non su
      // quella di fine: durante un colpo forte la pagina segue il dito e può
      // superare l'esplosione da sola, ma a quel punto il magnete deve comunque
      // aver consegnato il gesto.
      if (sessionStartY >= stage.explosionAt) {
        releaseToFreeScroll();
        return;
      }

      // Sotto il pavimento non è un gesto ma il rumore delle dita: NON SI FA
      // NULLA. Il modello precedente qui chiamava springBack, che è la causa
      // diretta del "torna indietro come una molla": 15px di micro-correzione
      // venivano annullati con easeOutBack, che oltrepassa il bersaglio e
      // rientra. Lasciare la pagina dov'è è l'unico comportamento che non
      // corregge l'utente mentre sta correggendo sé stesso.
      if (Math.abs(sessionSum) < JITTER_FLOOR_PX) return;

      // Bersaglio: prossimita' DIREZIONALE rispetto al fermo da cui il gesto e'
      // partito, non rispetto alla posizione finale.
      //
      // La distanza dalla posizione finale, da sola, non funziona: dal preloader
      // un click da 100px finiva a y=100, a 100px dal preloader STESSO, e la
      // prossimita' secca lo sceglieva riportando la pagina a 0 (misurato: 1
      // click -> 0.0, l'hero irraggiungibile). Sono i due estremi opposti del
      // difetto: sul sito di riferimento non esiste, e qui non deve esistere.
      //
      // La direzione risolve entrambi: si sceglie fra gli stop DAVANTI al fermo
      // di partenza rispetto al verso del gesto. Dal preloader in giù il
      // candidato e' l'hero; un colpo forte gia' passato oltre l'hero si posa
      // sullo stop successivo invece di essere tirato indietro.
      const direction = Math.sign(sessionSum) || 1;
      let target = -1;
      let targetDistance = Infinity;
      for (let i = 0; i < stage.stops.length; i++) {
        const ahead = (stage.stops[i] - sessionStartY) * direction;
        if (ahead <= 0) continue;
        const d = Math.abs(stage.stops[i] - y);
        if (d < targetDistance) { targetDistance = d; target = stage.stops[i]; }
      }
      // Nessuno stop davanti: la calamita ha finito il suo compito e da qui in poi
      // e' percorso libero, con l'attrito magnetico dello Snap a fare da rete.
      if (target === -1) { releaseToFreeScroll(); return; }

      // Fuori dal raggio di attrito: il gesto ha portato lontano dal bersaglio e
      // la pagina resta DOVE IL DITO L'HA PORTATA. Nessuna animazione, nessun
      // richiamo indietro. E' la differenza fra un pavimento che attira e un
      // cancello che trattiene: il gesto e' stato consegnato per intero.
      // Distingue i due casi, che hanno risposte opposte e sono la sostanza del
      // modello ad attrito:
      //
      //  - il gesto NON ha ancora raggiunto lo stop: vuol dire che l'utente ha
      //    chiesto di arrivarci e il foglio e' rimasto indietro per la coda. Qui
      //    si POSA sullo stop, per quanto la distanza sia grande: e' il caso di un
      //    singolo click di rotellina dal preloader (100px, ben sotto i 240px di
      //    attrito, che non si fermava affatto), ed e' l'attesa esplicita: uno
      //    scroll dal preloader deve fermarsi sull'hero.
      //
      //  - il gesto ha SUPERATO lo stop di piu' del raggio di attrito: l'utente
      //    voleva andare oltre, e riportarlo indietro sarebbe il "torna indietro
      //    come una molla". Qui non si fa nulla e la pagina resta dove il dito
      //    l'ha portata.
      const overshot = (target - y) * direction < 0;
      if (overshot && targetDistance > ATTRITION_RADIUS_PX) return;

      commitTo(target);
    };

    const closeSession = () => { decideSession(); lastEventAt = 0; sessionSum = 0; sessionArmed = false; };

    const onVirtualScroll = ({ deltaY, event }: VirtualScrollData) => {
      // Solo la rotellina è calamitata: touch e tastiera restano nativi.
      if (event.type !== 'wheel') return;
      if (isInsideNestedScroll(event.target, deltaY)) return;

      const now = performance.now();
      // ------------------------------------------------------------------------
      // CODA D'INERZIA: la coda dello stesso colpo che ha appena prodotto una
      // commessa. Va ASSORBITA, non trattata come gesto nuovo: e' la ragione
      // per cui un solo click attraversava due scene. Il foglio segue il dito
      // fino allo stop e si ferma li' (la molla resta visibile, il confine si
      // sente), ma nessun delta viene accumulato e nessuna sessione si apre.
      // La coda si chiude col silenzio: vedi closeSettle in commitTo.
      // ------------------------------------------------------------------------
      if (settling && settleStop !== null) {
        lastEventAt = now;
        // La coda non viene piu' bloccata: il blocco (preventDefault + stop
        // propagation) e' stato tolto insieme a quello sul delta, perche' insieme
        // erano il difetto segnalato. Ora la coda e' un gesto come tutti gli
        // altri e viene ASSORBITA solo nel senso che non apre una sessione nuova:
        // altrimenti gli eventi che arrivano dopo la posata aprirebbero una
        // sessione NUOVA dal fermo raggiunto e produrrebbero un secondo passo.
        //
        // IL FIX: la coda va tenuta chiusa FINCHE' ARRIVA, non per un tempo
        // fisso. Prima `settling` si chiudiva 300ms dopo l'arrivo allo stop, e su
        // una coda vera (un colpo di trackpad emette eventi per oltre un secondo)
        // quei 300ms scadevano a meta' coda: gli eventi successivi trovavano il
        // foglio fermo e produrrebbero il passo dopo. Il risultato misurato era
        // esattamente il difetto: un colpo dal preloader attraversava due scene,
        // fermandosi un attimo sull'hero e poi schiacciandosi sulla sagoma
        // (0 -> 1626 invece che 0 -> 813). Riarma il timer a ogni evento: la coda
        // si chiude quando TACE, non quando scadono dei millisecondi.
        armSettle();
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(closeSession, SESSION_QUIET_MS);
        return;
      }
      // La sessione prosegue finché gli eventi arrivano entro la finestra di
      // silenzio E vanno nella stessa direzione. Invertire è un gesto nuovo:
      // l'accumulato riparte da zero, altrimenti un down-up si sommerebbe come
      // se fosse stata una spinta in giù.
      const continues =
        lastEventAt > 0 &&
        now - lastEventAt <= SESSION_QUIET_MS &&
        sessionSum !== 0 &&
        Math.sign(deltaY) === Math.sign(sessionSum);

      if (!continues) {
        // Punto d'ancoraggio della sessione: la destinazione del volo in corso
        // se c'e', altrimenti la posizione reale. SyncEngagement va chiamata
        // PRIMA di azzerare inFlight, altrimenti il magnete si disarmerebbe
        // proprio nel momento in cui il gesto serve.
        const anchor = inFlight && flightTarget !== null ? flightTarget : scrollY.get();
        syncEngagement(anchor);
        // Un gesto nuovo chiude il volo precedente, arrivato o troncato che sia.
        // `onComplete` da solo non basta: se un gesto interrompe la
        // commutazione Lenis non lo chiama mai, e il magnete resterebbe armato
        // per sempre. Il gesture clock e' l'unico segnale che qui e' garantito.
        inFlight = false;
        flightTarget = null;
        sessionSum = 0;
        // Fermo di partenza congelato qui, mentre il magnete e' armato: e' la
        // posizione da cui il gesto e' partito, usata per il solo controllo del
        // confine dell'esplosione.
        sessionArmed = armed === true;
        if (sessionArmed) sessionStartY = anchor;
      }
      if (sessionArmed !== true) return;
      lastEventAt = now;
      // NESSUN LIMITE AL DELTA. Il blocco che stava qui (projected > limit =>
      // preventDefault + lenisStopPropagation) e' la causa diretta del "rimane
      // bloccato e bisogna insistere sul trackpad": l'utente muoveva il dito, la
      // pagina non rispondeva, e l'unica reazione era insistere. Il delta ora
      // passa SEMPRE e la pagina segue il gesto 1:1, esattamente come su
      // planetono.space, dove nessun handler su virtual-scroll esiste.
      //
      // Non serve nemmeno un margine di sicurezza al posto del blocco: se il
      // gesto va oltre l'ultimo stop, decideSession trova la distanza dagli stop
      // superiore al raggio di attrito e lascia la pagina dove il dito l'ha
      // portata. Il vincolo di una sezione alla volta e' conservato, ma e' un
      // vincolo di POSIZIONE, non un divieto di movimento.
      sessionSum += deltaY;

      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(closeSession, SESSION_QUIET_MS);
    };

    const unsubscribe = lenis.on('virtual-scroll', onVirtualScroll);
    // Gli effetti dei figli girano prima di quelli del provider, quindi lo Snap
    // non esiste ancora al montaggio: il primo allineamento va differito al
    // frame successivo.
    const raf = window.requestAnimationFrame(() => syncEngagement(scrollY.get()));

    return () => {
      unsubscribe();
      window.cancelAnimationFrame(raf);
      window.clearTimeout(closeTimer);
      window.clearTimeout(settleTimer);
      getSnap()?.start();
    };
  }, [lenis, scrollY, getSnap]);
}

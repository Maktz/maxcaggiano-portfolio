// FONDAMENTA DELLA SEQUENZA D'INGRESSO.
//
// Un solo oggetto con TUTTI i tempi, le durate e gli easing della sequenza.
// La logica di orchestrazione non contiene numeri: legge questo, quindi
// ritoccare i tempi non richiede di toccare il codice che li consuma.
//
// I valori sono in SECONDI dal click sul pulsante. `0` è il click, e i tempi
// sono crescenti in modo che la tabella si legga dall'alto come una scala.

// Curva cubic-bezier per framer-motion.
//
// Il tipo e' dichiarato qui perche' dentro un oggetto `as const` una tupla
// diventerebbe `readonly`, e `readonly` non e' assegnabile al tipo che
// framer-motion si aspetta per `ease`: senza questa annotazione il typecheck
// fallirebbe proprio sull'animazione.
export type BezierEasing = [number, number, number, number];

export const ENTRY_CONFIG = {
  // -- t=0.00 - IL PULSANTE ---------------------------------------------
  // Inversione del colore del pulsante al click (riempimento giallo, testo
  // plum). Breve e secca: conferma il gesto, non attract attention.
  buttonInvertDuration: 0.15,

  // Spegnimento del pulsante dopo il click. Parte insieme all'inversione e
  // finisce quando la sequenza ha gia' preso il campo.
  buttonFadeOutDuration: 0.3,

  // Accelerazione delle particelle del fondo subito dopo il click, poi
  // ritorno alla velocita' normale. Ancora non fa niente: il Passo 5 la
  // collega al RocketManager, quando i razzi avranno un gestore unico.
  particleBoostDuration: 0.4,

  // -- t=0.30 - IL NOME VOLA VERSO L'HEADER -----------------------------
  // Durata del viaggio di "MAX CAGGIANO" dal centro del preloader alla riga
  // dell'header. E' l'unico elemento che si muove: niente copia e niente
  // crossfade, quindi la durata e' quella di un movimento, non di una
  // sfumatura, e puo' essere piu' corta senza sembrare un salto.
  nameTravelDuration: 0.8,

  // Curva del viaggio: morbida in ingresso e in uscita. Il nome parte deciso
  // e si posa piano, senza rimbalzo.
  nameTravelEasing: [0.4, 0, 0.2, 1] as BezierEasing,

  // -- t=0.30 - LA LINEA DELL'HEADER ------------------------------------
  // La linea sotto l'header si disegna da sinistra a destra mentre il nome
  // viaggia, e finisce un filo di tempo prima: la fascia e' gia' al suo posto
  // quando il testo arriva.
  headerLineDuration: 0.7,

  // Ritardo della linea rispetto all'inizio del viaggio. Se partisse
  // insieme, le due cose sembrerebbero un unico movimento invece di due gesti
  // distinti.
  headerLineDelay: 0.1,

  // Stessa curva del viaggio: i due movimenti devono sembrare imparentati.
  headerLineEasing: [0.4, 0, 0.2, 1] as BezierEasing,

  // -- LO SCRAMBLE ---------------------------------------------------------
  // Le quattro righe entrano in scena una alla volta. Sono tempi ASSOLUTI dal
  // click, non offset dalla fine del viaggio del nome: e' l'unico modo per
  // spostare una riga senza spostare anche tutte le altre. Il viaggio del nome
  // dura 0.8s, quindi la riga 1 parte 0.1s dopo che il nome e' atterrato.
  scrambleHeadlineRow1Start: 0.9,
  scrambleHeadlineRow2Start: 1.2,
  scrambleHeadlineRow3Start: 1.5,

  // La sub-headline arriva per ultima: e' la riga che chiude la lettura, e
  // parte dopo che le tre del titolo hanno gia' cominciato a comporsi.
  scrambleSubheadlineStart: 1.8,

  // Velocita' di risoluzione: quanti millisecondi fra un carattere e il
  // successivo. Piu' basso del tick qui sotto, cosi' nella maggior parte dei
  // giri almeno un carattere si risolve.
  scrambleCharInterval: 45,

  // Varianza casuale sul ritardo di ogni carattere. Tolta, la riga si
  // risolverebbe a scatti perfettamente regolari e si leggerebbe come una
  // macchina; con la varianza, due righe vicine non finiscono mai insieme.
  scrambleCharVariance: 10,

  // Ogni quanti millisecondi le posizioni non ancora risolte cambiano simbolo.
  // Piu' lento del carattere: il lettore deve vedere i simboli girare, non
  // sostituirsi a ogni lettera.
  scrambleTickInterval: 50,

  // -- LE POSE DELL'AVATAR -------------------------------------------------
  // Quattro numeri per posa, e nient'altro da sapere sul viso: come si
  // applicano ai path lo sa il controller, non questa tabella.
  //
  // `mouthOpenness` e' l'unico parametro che va letto con attenzione: non e'
  // "quanto e' aperta" ma "dove si trova fra bocca chiusa e sorriso", e lo
  // 0.4 e' apposta la piccola apertura tonda della sorpresa, non un sorriso
  // al 40%.
  poses: {
    // Bocca piatta, occhi normali, sguardo al centro. La posa in cui l'avatar
    // si trova appena arrivato in scena.
    riposo: { eyeOpenness: 1, pupilOffset: { x: 0, y: 0 }, browOffset: 0, mouthOpenness: 0 },
    // Identica a riposo: la differenza e' nel passaggio, non nel risultato.
    // Ilblink e' un impulso e non una posa, quindi questa voce serve al
    // ritorno dopo il blink.
    sveglio: { eyeOpenness: 1, pupilOffset: { x: 0, y: 0 }, browOffset: 0, mouthOpenness: 0 },
    // Occhi spalancati sopra l'1 e sopracciglia alzate: e' l'unica posa in
    // cui l'SVG viene stirato oltre la sua scala naturale, perche' non ha
    // palpebre e l'unico modo di aprire l'occhio e' allargare la sclera.
    sorpresa: { eyeOpenness: 1.3, pupilOffset: { x: 0, y: -1 }, browOffset: 4, mouthOpenness: 0.4 },
    // Il punto d'arrivo della sequenza: e da li' che riparte l'idle, quindi
    // il sorriso e' anche l'ancora del ciclo.
    sorriso: { eyeOpenness: 1, pupilOffset: { x: 0, y: 0 }, browOffset: 0, mouthOpenness: 1 },
  },

  // -- L'INGRESSO DELL'AVATAR ----------------------------------------------
  // Parte mentre la riga 1 dell'headline si sta ancora risolvendo: l'avatar
  // entra sotto gli occhi del lettore mentre il titolo si compone, e i due
  // gesti non si pestano i piedi perche' occupano parti diverse dello schermo.
  avatarEntryStart: 1.0,

  // Mezzo secondo di salita. Piu' corto sembra uno scatto dal nulla, piu'
  // lungo tiene l'avatar in attesa per un tempo che il lettore non spiega.
  avatarEntryDuration: 0.5,

  avatarEntryEasing: [0.4, 0, 0.2, 1] as BezierEasing,

  // -- LA SEQUENZA DI ESPRESSIONI -------------------------------------------
  // Il blink segue subito l'atterraggio: arriva, guarda, e batte le ciglia
  // come farebbe una persona appena rivista.
  avatarBlinkStart: 1.5,
  avatarBlinkDuration: 150,

  // La sorpresa e' la risposta al razzo, e non ha un orario suo: parte quando il
  // razzo entra. Resta solo la durata, che e' quanto il viso tiene l'espressione
  // prima che il sorriso la sciolga.
  //
  // Il vecchio `avatarSurpriseStart` e' sparito perche' niente lo leggeva piu':
  // lasciare in tabella un tempo che sembra comandare qualcosa ma non
  // comanda niente e' il modo piu' economico di far tornare questo difetto fra
  // sei mesi.
  avatarSurpriseDuration: 200,

  // Il sorriso dura idem, e come la sorpresa non ha un orario: parte quando il
  // razzo esce dal bordo sinistro, insieme al rilascio dello sguardo.
  avatarSmileDuration: 300,

  // -- IL RAZZO COREIOGRAFATO ------------------------------------------------
  // Il razzo parte a 2.00 e mette un secondo ad attraversare lo schermo, quindi
  // esce a 3.00. La sorpresa parte con lui e il sorriso alla sua uscita: da qui
  // i tempi delle due espressioni, che non sono piu' scritti a mano.
  rocketScriptedStart: 2.0,
  rocketScriptedDuration: 1.0,

  // Quanto i razzi ambient restano fermi dopo che la pagina e' diventata 'hero'.
  // Non e' un semplice ritardo di comodo: e' la coda dell'ingresso. Durante quei
  // 1500ms lo sguardo e' ancora sulla scena appena montata, e un razzo che
  // attraversa lo schermo in quel momento compete con l'ultima riga di testo e
  // con il viso. Dopo, la pagina e' sua e i razzi possono rientrare.
  ambientRocketDelay: 1500,

  // -- OCCHIATA AI RAZZI AMBIENT (spento) ------------------------------------
  // spento: un'occhiata a ogni razzo che passa davanti al viso diventa un tic
  // che l'utente impara a ignorare, e smette di significare qualcosa. Restano i
  // numeri gia' tarati, cosi' accenderlo e' una riga.
  glanceEnabled: false,
  glanceThresholdPx: 120,
  glanceDurationMs: 600,

  // L'idle riparte da QUI, e da quello che l'avatar sta dicendo in quel
  // momento. Non riparte subito dopo il sorriso: il sorriso dura 300ms e un idle
  // che riparte dopo 100ms lo mangerebbe a meta', e l'utente non vedrebbe mai la
  // posa per cui l'ha fatta reagire al razzo.
  avatarIdleStart: 4.0,

  // -- LE COORDINATE E IL PROMPT ---------------------------------------------
  // Le tre righe di dati si scrivono dopo le espressioni, mentre l'avatar e'
  // ancora in sorriso. Nessun simbolo: sono dati, non un titolo.
  coordMilanoStart: 3.0,
  coordPotenzaStart: 3.15,
  coordViaLattea: 3.0,

  // Millisecondi per carattere. Piu' lento dei 45ms del titolo: un numero
  // scritto troppo in fretta non si legge, e la riga esiste apposta per essere
  // letta.
  coordCharDelay: 30,

  // Il prompt di scorrimento parte per ultimo e sblocca la pagina quando ha
  // finito di comporsi: e' l'unico testo che spiega all'utente che puo' andare
  // avanti, quindi finche' non c'e' lo scroll resta fermo.
  scrollHintStart: 3.5,
} as const;

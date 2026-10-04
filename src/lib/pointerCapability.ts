// LA CAPACITA' DI PUNTARE — UNA SOLA RISPOSTA PER TUTTA LA PAGINA.
//
// Stessa ragione di `motionPreference`: se due moduli chiedessero a modo loro
// «qui si puo' puntare qualcosa?» e rispondessero in momenti diversi, la pagina
// avrebbe una meta' che ascolta il mouse e una meta' che no — e il difetto
// sarebbe invisibile finche' nessuno mette i due pezzi uno accanto all'altro.
//
// `(pointer: fine)` e non `(hover: hover)`: la seconda chiede se il puntatore
// PUO' passare sopra, la prima se esiste ed e' posizionabile. E' la seconda la
// domanda che serve al razzo, perche' lui ha bisogno di sapere DOVE si trova
// il puntatore, non soltanto che ci sia.
//
// Come `reducedMotion`, il valore e' letto una volta sola all'import: e' la
// risposta che dava il dispositivo all'avvio, e cambiare hardware a meta'
// visita non e' un gesto che accade.

/**
 * true se l'utente ha un puntatore che sa indicare una posizione esatta.
 */
export const finePointer: boolean =
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: fine)').matches;
import KineticText from './KineticText';
import { BRAND_TITLE_HEADER_CLASS, BRAND_TITLE_TEXT } from '@/lib/brandTitle';

// IL MARCHIO VOLANTE.
//
// Un solo elemento che attraversa la pagina: il nome del preloader e il
// titolo dell'header NON sono due copie che si incrociano, sono lo stesso
// testo che si sposta. Il nodo sta in un layer radice (figlio di App, fuori
// dalla sezione preloader e fuori dall'header) perche' un elemento dentro
// l'header non potrebbe salire sopra l'header stesso, che ha uno sfondo
// opaco e z-50: finirebbe dietro.
//
// Questo e' lo stesso trucco che gia' usa il ritratto con
// `#portrait-logo-layer`, e per la stessa ragione: un transform applicato a
// un nodo dentro un contesto di impilamento non puo' uscirne.
//
// Il layer e' SEMPRE presente nel DOM, solo nascosto. Se venisse montato al
// momento del volo, il primo frame avrebbe gia' il nome nella posizione
// sbagliata: montarlo subito e spegnerlo con l'opacita' e' l'unico modo in
// cui la posizione di partenza e' sempre misurabile.
//
// Il testo prende la classe dell'header, non quella del preloader: il
// viaggio finisce nell'header, quindi deve essere gia' identico a com'e'
// l'arrivo, e non dover correggere nulla a meta' percorso.

export default function LogoLayer() {
  return (
    <div
      id="logo-layer"
      aria-hidden="true"
      // `pointer-events-none` sempre: il layer attraversa pulsanti e testo, e
      // non deve intercettare nessun gesto. `inert` non serve perche' non ha
      // contenuto interattivo, solo testo duplicato di quello vero.
      className="pointer-events-none fixed left-0 top-0 z-[60] opacity-0"
    >
      <KineticText
        as="h1"
        idle
        intensity={0.28}
        className={BRAND_TITLE_HEADER_CLASS}
      >
        {BRAND_TITLE_TEXT}
      </KineticText>
    </div>
  );
}
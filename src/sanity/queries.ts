import type { SanityImageSource } from '@sanity/image-url';

// FORMA DEL DOCUMENTO SANITY.
//
// Sono i campi così come arrivano da Sanity, cioè NON come la UI li vuole:
// `projectCode` qui si chiama `code`, lo `statement` qui si chiama `strategy`,
// `keyMetrics` qui si chiama `metrics`. Il rename non avviene in GROQ ma in
// mapProject, e la ragione è che i nomi delle due parti possono divergere
// senza che nessuno se ne accorga: tenere qui i nomi grezzi rende evidente
// quale dei due è il nome dello schema e quale è quello scelto dal design.
//
// Tutto è opzionale e ammette il vuoto, perché un campo in Sanity è sempre
// "non ancora compilato" finché l'editor non lo riempie. Un documento senza
// `title` o senza immagini è un caso reale, non un errore da far esplodere.
export interface SanityKeyMetric {
  value?: string | null;
  label?: string | null;
}

export interface SanityProject {
  _id: string;
  _type?: string;
  projectCode?: string | null;
  title?: string | null;
  year?: string | number | null;
  client?: string | null;
  role?: string | null;
  timeline?: string | null;
  deliverables?: string[] | null;
  /** Testo lungo, mostrato nel modal come dichiarazione d'art direction. */
  statement?: string | null;
  /** Alias di `statement`: usato se il primo è vuoto. */
  rationale?: string | null;
  tags?: string[] | null;
  liveUrl?: string | null;
  /** Opzionale: se assente, derivato dal primo keyMetric. */
  kpi?: string | null;
  /** Opzionale: se assente, derivato da `statement` troncato. */
  brief?: string | null;
  mainImage?: SanityImageSource | null;
  gallery?: SanityImageSource[] | null;
  keyMetrics?: SanityKeyMetric[] | null;
}

/**
 * Query dei progetti: tutto quello che serve a card e modal, in una volta sola.
 *
 * Le proiezioni sono esplicite anche dove il campo ha lo stesso nome (`title`,
 * `client`, `role`...): senza, la query restituirebbe l'intero documento, cioè
 * ogni campo presente nello schema anche se non richiesto. Oggi sembra
 * inutile, ma è il modo in cui un campo nuovo entra nel payload — e nel
 * bundle — senza che nessuno lo decida.
 *
 * Gli alias (`"statement": coalesce(statement, rationale)`) tengono qui la
 * sola logica di campo, e sono una tantum: a valle il codice ne vede uno solo.
 *
 * `gallery` NON è dereferenziato (`asset->`): ogni dereferenziazione è una
 * richiesta API per documento, mentre l'URL si può costruire dal solo `_ref`
 * dell'asset con @sanity/image-url, che è il modo economico di ottenerlo.
 */
export const PROJECTS_QUERY = /* groq */ `
  *[_type == "project" && !(_id in path("drafts.**"))] | order(year desc, projectCode asc) {
    _id,
    projectCode,
    title,
    year,
    client,
    role,
    timeline,
    deliverables,
    "statement": coalesce(statement, rationale),
    tags,
    liveUrl,
    kpi,
    brief,
    mainImage,
    gallery,
    keyMetrics[] { value, label }
  }
`;

/**
 * Un solo progetto, per un eventuale caricamento puntuale.
 * Stessa proiezione della lista: due query diverse per lo stesso documento
 * finirebbero per restituire campi diversi, e il caso si romperebbe in modo
 * difficile da diagnosticare (funziona in lista, non in dettaglio).
 */
export const PROJECT_BY_ID_QUERY = /* groq */ `
  *[_type == "project" && _id == $id][0] {
    _id,
    projectCode,
    title,
    year,
    client,
    role,
    timeline,
    deliverables,
    "statement": coalesce(statement, rationale),
    tags,
    liveUrl,
    kpi,
    brief,
    mainImage,
    gallery,
    keyMetrics[] { value, label }
  }
`;

import type { Project } from '@/data/projects';
import { imageUrlBuilder } from './client';
import type { SanityKeyMetric, SanityProject } from './queries';

// NORMALIZZAZIONE: SANITY -> Project.
//
// È l'unico punto in cui la forma dello schema incontra la forma della UI.
// Tutto ciò che segue è difensivo per una ragione sola: un campo in Sanity non
// è "mancante" per un errore, è "non ancora compilato" per un lavoro in corso.
// Il risultato deve quindi essere SEMPRE un Project valido, perché i componenti
// sotto non hanno (e non devono avere) controlli di null: metterli tutti in
// `project.titolo` senza verifica trasformerebbe ogni campo opzionale dello
// schema in un ternario sparso in tre componenti animati.
//
// La regola è sempre la stessa: un campo assente in Sanity diventa un valore
// di default sensato, mai `undefined`.
//
// `Project` resta l'unico tipo che la UI conosce: questo file non cambia la
// forma dei dati, cambia solo il modo in cui vengono ottenuti.

// ---------------------------------------------------------------------------
// Testi
// ---------------------------------------------------------------------------

/** Spazi (inclusi a capo e tab) ridotti a uno singolo, testo ripulito. */
const squish = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Testo obbligatorio con riserva: '' non è un valore ammesso dalla UI. */
const text = (value: string | null | undefined, fallback = ''): string =>
  value?.trim() || fallback;

/**
 * `year` come stringa.
 *
 * In Sanity `year` può essere un number (2026) o una stringa. La UI lo stampa
 * in uno `span` e lo confronta con stringhe, quindi qui si uniforma: senza,
 * un number romperebbe i confronti nel layout in silenzio.
 */
const year = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

/**
 * Array di stringhe pulito: via i buchi, via i non-stringhe.
 *
 * `null` diventa `[]` e non il contrario: la UI itera e chiama `.join()` su
 * `deliverables` (ProjectModal, riga CLIENT/DELIVERABLES), e `undefined.map` è
 * un errore a runtime che blocca l'apertura del modal — il guasto più costoso
 * possibile per un campo che l'editor non ha ancora compilato.
 */
const stringList = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return values
    .filter((item): item is string => typeof item === 'string')
    .map(squish)
    .filter(Boolean);
};

/**
 * Il `kpi` del badge, es. "+180% ENGAGEMENT".
 *
 * Se l'editor ha compilato il campo `kpi` in Sanity, quello vince: è testo
 * scritto per essere mostrato lì e non va riformattato. Altrimenti si deriva
 * dal PRIMO keyMetrics, concatenando valore ed etichetta, perché il badge in
 * alto e il primo numero delle "[METRICHE]" in fondo sono lo stesso dato detto
 * due volte e devono dire la stessa cosa.
 */
const deriveKpi = (project: SanityProject, keyMetrics: SanityKeyMetric[]): string => {
  const explicit = project.kpi?.trim();
  if (explicit) return explicit;

  const first = keyMetrics[0];
  if (!first) return '';
  const value = first.value?.trim() ?? '';
  const label = first.label?.trim() ?? '';
  // Se l'etichetta è già dentro il valore (es. value "+180% ENGAGEMENT",
  // label "ENGAGEMENT") non va raddoppiata: altrimenti il badge mostrerebbe
  // "+180% ENGAGEMENT ENGAGEMENT".
  if (!label || value.toUpperCase().includes(label.toUpperCase())) return value;
  return value ? `${value} ${label}` : label;
};

/**
 * Il testo breve della card.
 *
 * Lo `statement` del modal è scritto per essere letto per intero, e su una card
 * alta 3:4 verrebbe tagliato dal bordo senza che nessuno lo notasse: serve un
 * riassunto. Se l'editor ha compilato `brief`, quello vince; altrimenti si
 * tronca lo statement.
 */
const deriveBrief = (project: SanityProject, maxLength = 120): string => {
  const explicit = project.brief?.trim();
  if (explicit) return squish(explicit);

  const statement = squish(project.statement ?? '');
  if (!statement) return '';
  if (statement.length <= maxLength) return statement;

  // Taglio a CONFINO DI PAROLA: a metà parola ("esperienz…") il riassunto si
  // leggerebbe come un errore di battitura. Si arretra quindi all'ultimo
  // spazio e si aggiunge il puntini di sospensione che segnala l'abbreviazione.
  const cut = statement.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  // Se l'ultimo spazio è troppo indietro (testo senza spazi) meglio troncare
  // secco che restituire quasi nulla.
  const head = lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${head.replace(/[\s,;:.!?-]+$/, '')}…`;
};

/** `keyMetrics` -> `metrics`, scartando le voci senza valore. */
const toMetrics = (list: SanityKeyMetric[] | null | undefined) => {
  if (!Array.isArray(list)) return [];
  return list
    .map((metric) => ({
      value: text(metric?.value),
      label: text(metric?.label),
    }))
    // Una metrica senza valore mostrerebbe un buco grande quanto le altre,
    // che nel riquadro da 8xl è più rumore che informazione.
    .filter((metric) => metric.value !== '');
};

// ---------------------------------------------------------------------------
// Immagini
// ---------------------------------------------------------------------------

/**
 * URL di un'immagine Sanity, o '' se non c'è.
 *
 * Larghezza limitata a 1400px e formato automatico: la galleria del modal è
 * un contenuto a larghezza di pagina, quindi 1400 coprono un monitor grande
 * senza scaricare l'originale (che su Sanity può essere di 6000px).
 * `fit('max')` scala SENZA ritagliare, a differenza di `fill`/`crop`, che
 * cambierebbero il rapporto e quindi l'aspetto dei riquadri: la griglia della
 * galleria si regge su ratio fissi (8/4/12 colonne).
 */
const imageUrl = (source: unknown): string => {
  if (!source) return '';
  // Una stringa che è già un URL assoluto va usata così com'è: è il caso dei
  // dati storici, che puntano a immagini ospitate altrove.
  if (typeof source === 'string') {
    return source.startsWith('http') ? source : '';
  }
  if (!imageUrlBuilder) return '';
  try {
    return imageUrlBuilder.image(source as never).width(1400).fit('max').auto('format').url();
  } catch {
    // Un asset corrotto o cancellato non deve far cadere l'intero progetto:
    // si salta l'immagine e si mostra tutto il resto.
    return '';
  }
};

/**
 * La galleria del modal: `gallery`, con `mainImage` come primo elemento.
 *
 * `mainImage` è l'anteprima del progetto in Sanity, non un'immagine della
 * galleria, quindi entra solo se la galleria non ce l'ha già: con l'immagine
 * principale in testa si evita che l'anteprima compaia due volte. Se la
 * galleria è vuota, la mainImage la sostituisce interamente, così il progetto
 * non resta senza immagini.
 *
 * NON va usata sulle card: sono composizioni SOLO TESTO (nessuna immagine),
 * e aggiungerne una cambierebbe l'aspetto della griglia, che è la UI da non
 * toccare.
 */
const toGallery = (project: SanityProject): string[] => {
  const gallery = Array.isArray(project.gallery) ? project.gallery : [];
  const urls = gallery.map(imageUrl).filter(Boolean);
  const main = imageUrl(project.mainImage);
  if (main && !urls.includes(main)) urls.unshift(main);
  return urls;
};

// ---------------------------------------------------------------------------
// Documento -> Project
// ---------------------------------------------------------------------------

/**
 * Converte un documento Sanity nel `Project` che la UI già consuma.
 *
 * `fallbackCode` serve solo se `projectCode` manca: `code` è la chiave React
 * delle card (ProjectsScene, `key={project.code}`), quindi non può essere
 * vuota. Con chiavi duplicate, React riuserebbe il DOM di una card in un'altra
 * spostando i ref che la scena imperniama a ogni frame: l'effetto è una card
 * che mostra il contenuto del progetto precedente.
 */
export const toProject = (source: SanityProject, fallbackCode: string): Project => {
  const rawMetrics = Array.isArray(source.keyMetrics) ? source.keyMetrics : [];

  return {
    code: text(source.projectCode, fallbackCode),
    year: year(source.year),
    client: text(source.client),
    // `title` è l'unico campo senza riserva reale: è il contenuto stesso del
    // portfolio, e un progetto anonimo è un errore di compilazione, non uno
    // stato legittimo da mostrare.
    title: text(source.title, 'UNTITLED'),
    tags: stringList(source.tags),
    kpi: deriveKpi(source, rawMetrics),
    brief: deriveBrief(source),
    role: text(source.role),
    timeline: text(source.timeline),
    deliverables: stringList(source.deliverables),
    // `statement` e `rationale` sono lo stesso campo con due nomi: la query
    // GROQ li ha già uniti in `statement`.
    strategy: squish(source.statement ?? ''),
    galleryImages: toGallery(source),
    liveUrl: text(source.liveUrl),
    metrics: toMetrics(rawMetrics),
  };
};

/**
 * Converte l'intera lista, garantendo `code` univoci.
 *
 * Due progetti con lo stesso `projectCode` sono un errore di compilazione
 * plausibile (si duplica un progetto e non si cambia il codice), con
 * conseguenze visibili: stessa chiave React, ref sovrapposti, card che si
 * scambiano contenuto. Il suffisso numerico non serve a segnalare nulla
 * all'utente: serve solo a non far collidere le card.
 */
export const toProjects = (sources: SanityProject[]): Project[] => {
  if (!Array.isArray(sources)) return [];
  const used = new Set<string>();
  return sources
    .filter((source): source is SanityProject => Boolean(source))
    .map((source, index) => toProject(source, `EXP_${String(index + 1).padStart(2, '0')}`))
    .map((project) => {
      if (!used.has(project.code)) {
        used.add(project.code);
        return project;
      }
      let suffix = 2;
      while (used.has(`${project.code}_${suffix}`)) suffix += 1;
      const unique = `${project.code}_${suffix}`;
      used.add(unique);
      return { ...project, code: unique };
    });
};

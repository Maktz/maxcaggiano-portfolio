import { createClient } from '@sanity/client';
import { createImageUrlBuilder } from '@sanity/image-url';

// CONFIGURAZIONE SANITY.
//
// Le due variabili arrivano da `.env.local`, che Vite sostituisce in fase di
// build: sono quindi LITERAL nel bundle. È il comportamento voluto, perché
// projectId e dataset sono pubblici per costruzione (sono nell'URL di ogni
// immagine e di ogni chiamata API). Nessun token entra qui: il dataset
// production è in sola lettura e pubblico, quindi i dati dei progetti sono
// richiedibili dal browser senza credenziali.
export const SANITY_PROJECT_ID = import.meta.env.VITE_SANITY_PROJECT_ID?.trim() ?? '';
export const SANITY_DATASET = import.meta.env.VITE_SANITY_DATASET?.trim() || 'production';

// Data di blocco dell'API. Sanity la tratta come versione del RISPOSTATO e non
// come semplice metadato: le chiamate con date diverse possono dare risultati
// diversi sullo stesso dataset. Fissarla rende la build riproducibile — senza,
// uno stesso deploy a distanza di mesi potrebbe vedere la forma dei dati
// cambiata sotto i piedi. Va alzata di proposito, mai per abitudine.
const API_VERSION = '2024-01-01';

/**
 * true se il progetto può parlare con Sanity.
 *
 * `createClient` non va mai chiamato con un projectId vuoto: fallirebbe solo
 * al primo fetch, con un errore che parla di rete mentre il problema è la
 * configurazione. Il client nasce quindi già condizionato, e il resto del
 * codice legge questo flag per decidere se esistere.
 */
export const isSanityConfigured = SANITY_PROJECT_ID !== '' && SANITY_DATASET !== '';

/**
 * Client di sola lettura, o `null` se il progetto non è configurato.
 *
 * `useCdn` serve perché qui non c'è nulla da proteggere: i dati sono pubblici
 * e non cambiano fra una visita e l'altra, quindi li si legge dalla CDN (più
 * vicina e con cache) invece che dall'API. `perspective: 'published'` esclude
 * i draft: senza, una bozza in lavorazione comparirebbe sul sito pubblico.
 */
export const sanityClient = isSanityConfigured
  ? createClient({
      projectId: SANITY_PROJECT_ID,
      dataset: SANITY_DATASET,
      apiVersion: API_VERSION,
      useCdn: true,
      perspective: 'published',
    })
  : null;

/**
 * Costruttore di URL per le immagini di Sanity.
 *
 * Riceve projectId e dataset espliciti invece del client: il builder vuole i
 * due identificativi, non l'oggetto che li sa, e passargli il solo
 * `{ projectId, dataset }` evita di legare i tipi interni delle due librerie
 * (che sono versionate fra loro). `null` a sua volta se non configurato.
 */
export const imageUrlBuilder = isSanityConfigured
  ? createImageUrlBuilder({ projectId: SANITY_PROJECT_ID, dataset: SANITY_DATASET })
  : null;

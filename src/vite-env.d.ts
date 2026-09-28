/// <reference types="vite/client" />

// Tipi delle variabili di Sanity. Vite le espone solo con prefisso VITE_, e
// senza questa dichiarazione resterebbero `any`: `npm run typecheck`
// continuerebbe a passare anche se il nome di una variabile venisse scritto
// male, che è esattamente il tipo di errore che in `.env.local` nessuno vede.
interface ImportMetaEnv {
  /** ID del progetto Sanity, es. "iu3awpfi". Stringa vuota se non impostato. */
  readonly VITE_SANITY_PROJECT_ID: string;
  /** Dataset Sanity da cui leggere, es. "production". */
  readonly VITE_SANITY_DATASET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}


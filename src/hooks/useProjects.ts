import { useEffect, useState } from 'react';
import { projects as fallbackProjects } from '@/data/projects';
import type { Project } from '@/data/projects';
import { isSanityConfigured, sanityClient } from '@/sanity/client';
import { toProjects } from '@/sanity/mapProject';
import { PROJECTS_QUERY } from '@/sanity/queries';
import type { SanityProject } from '@/sanity/queries';

// CARICAMENTO DEI PROGETTI DA SANITY.
//
// Una richiesta sola, al montaggio di App. Il resto dell'app non sa che
// esista Sanity: riceve un array di Project e lavora come prima, quindi i
// dati sono l'unica cosa che è cambiato, non la UI.
//
// Tre regole governano il fallback ai mock in `src/data/projects.ts`:
//
//  1. STATO INIZIALE = MOCK. La Works entra nello stesso identico di prima,
//     senza scarti né salti di layout mentre la risposta è in volo. Un
//     array vuoto durante il caricamento, invece, cambierebbe la geometria
//     della scena (ProjectsScene calcola strip, slot e altezza su
//     `projects.length`) e le card comparirebbero a scatti.
//  2. SE SANITY NON RISPODE, I MOCK RESTANO. Un portfolio che si svuota per
//     un problema di rete è peggio di uno con dati di esempio.
//  3. SE SANITY NON HA PROGETTI, I MOCK RESTANO. Dataset vuoto e rete
//     rotta si trattano allo stesso modo: in entrambi i casi non abbiamo
//     nulla di meglio da mostrare.

export type ProjectsStatus = 'mock' | 'loading' | 'live' | 'error';

interface ProjectsState {
  projects: Project[];
  status: ProjectsStatus;
}

// La promise vive FUORI dal componente, in un modulo.
//
// Senza, StrictMode monta ogni effetto due volte (React 18 development) e i
// due montaggi partirebbero due richieste identiche. Inoltre, se l'utente
// riapre il portfolio in un'altra scheda, il risultato è già in memoria: la
// seconda visita non paga la rete. È una cache a vita di pagina, il minimo
// indispensabile per non duplicare il lavoro.
let inflight: Promise<Project[]> | null = null;
let cache: Project[] | null = null;

const loadProjects = (): Promise<Project[]> => {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  if (!sanityClient) return Promise.resolve([]);

  inflight = sanityClient
    .fetch<SanityProject[]>(PROJECTS_QUERY)
    .then((raw) => {
      const mapped = toProjects(raw);
      // Si mette in cache solo un esito UTILIZZABILE. Una lista vuota o
      // corrotta non deve diventare la risposta definitiva: così, al prossimo
      // tentativo, si riprova.
      if (mapped.length > 0) cache = mapped;
      inflight = null;
      return mapped;
    })
    .catch((error: unknown) => {
      // Il messaggio va in console e non nello stato: la UI non ha un posto
      // dove mostrarlo senza aggiungere un pezzo di UI che prima non c'era.
      console.warn('[sanity] caricamento progetti fallito, uso i dati di riserva:', error);
      inflight = null;
      return [] as Project[];
    });

  return inflight;
};

/**
 * I progetti, da Sanity, con riserva sui dati statici.
 *
 * Lo stato parte dai mock per non avere un primo render vuoto, e viene
 * sostituito solo quando Sanity ha restituito qualcosa di utilizzabile.
 */
export const useProjects = (): ProjectsState => {
  const [state, setState] = useState<ProjectsState>({
    projects: fallbackProjects,
    // `loading` solo se Sanity esiste: altrimenti non ci sarà mai nessun
    // arrivo, e dichiarare un caricamento che non finisce sarebbe falso.
    status: isSanityConfigured ? 'loading' : 'mock',
  });

  useEffect(() => {
    if (!isSanityConfigured) return undefined;

    // Il guard `active` evita il setState su un componente smontato: in
    // StrictMode il primo effetto viene smontato subito, e la sua risposta
    // arriverebbe su uno stato che non esiste più.
    let active = true;
    loadProjects().then((loaded) => {
      if (!active) return;
      if (loaded.length > 0) {
        setState({ projects: loaded, status: 'live' });
      } else {
        // Nessun dato utilizzabile: restano i mock, ma si registra che il
        // sito sta mostrando un fallback e non il contenuto reale.
        setState((prev) => ({
          projects: prev.projects.length > 0 ? prev.projects : fallbackProjects,
          status: 'error',
        }));
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return state;
};

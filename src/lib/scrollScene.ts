/**
 * MISURE DI SEZIONE: bordo superiore e altezza.
 *
 * `readSceneTop` (scrollMath) dà solo il `offsetTop`. Le sezioni nuove hanno
 * bisogno anche dell'ALTEZZA, perché la loro animazione è una funzione dello
 * scroll che le attraversa: senza l'altezza non c'è la fine della finestra, e il
 * moto finirebbe o non finirebbe mai.
 *
 * La cache è doppia chiave — viewport E versione di `scrollMath` — per il
 * motivo dichiarato lì: la Works scrive la propria altezza in px dopo il primo
 * paint senza che la viewport cambi, quindi una cache keyed solo dalla viewport
 * continuerebbe a servire il fallback `h-[300vh]` per tutta la sessione.
 *
 * `offsetHeight` è una lettura di layout: qui non gira mai dentro un
 * ciclo per frame, ma solo quando la chiave cambia.
 */
import { readSceneTopsVersion } from './scrollMath';

let measuresCache: { key: string; measures: Map<string, { top: number; height: number }> } | null =
  null;

const measure = (scene: string) => {
  const key = `${window.innerWidth}x${window.innerHeight}:${readSceneTopsVersion()}`;
  if (!measuresCache || measuresCache.key !== key) {
    const measures = new Map<string, { top: number; height: number }>();
    document
      .querySelectorAll<HTMLElement>('main > section[data-scene]')
      .forEach((section) => {
        const name = section.dataset.scene;
        if (name) measures.set(name, { top: section.offsetTop, height: section.offsetHeight });
      });
    // Una misura vuota NON viene memorizzata: le sezioni non esistono ancora al
    // primo render (React non ha committato il DOM) e memorizzare zero farebbe
    // valere la cache per tutta la sessione.
    if (measures.size > 0) measuresCache = { key, measures };
  }
  return measuresCache?.measures.get(scene) ?? { top: 0, height: 0 };
};

/** Bordo superiore della sezione, in px di pagina. */
export const readSceneTopPx = (scene: string): number => measure(scene).top;

/** Altezza della sezione, in px. */
export const readSceneHeight = (scene: string): number => measure(scene).height;
import { createContext, useContext } from 'react';
import type Lenis from 'lenis';
import type Snap from 'lenis/snap';
import type { MotionValue } from 'framer-motion';

export interface SmoothScrollContextValue {
  lenis: Lenis;
  scrollY: MotionValue<number>;
  // Lo Snap viene creato in un effetto del provider, cioè DOPO gli effetti dei
  // figli: si espone come getter pigro, non come valore, così chi lo usa non
  // legge mai null al montaggio.
  getSnap: () => Snap | null;
  // Sottoscrizione al frame condiviso: il canvas fisso renderizza una sola
  // volta per frame, dopo che Lenis ha già aggiornato le MotionValue.
  subscribeFrame: (callback: (time: number) => void) => () => void;
}

export const SmoothScrollContext = createContext<SmoothScrollContextValue | null>(null);

export function useSmoothScroll() {
  const context = useContext(SmoothScrollContext);
  if (!context) {
    throw new Error('useSmoothScroll deve essere usato dentro <SmoothScrollProvider>');
  }
  return context;
}

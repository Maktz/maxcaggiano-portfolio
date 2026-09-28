import { useCallback, useEffect, useState } from 'react';
import { audio } from './audioLayer';

// AGGANCIO PER UN FUTURO TOGGLE DELL'AUDIO.
//
// Oggi nessuno lo usa, e va bene: un hook che non ha consumatori non costa
// niente finche' resta in un file. Il giorno in cui l'audio avra' un interruttore
// questo e' il posto naturale per metterlo, perche' lo stato e' gia' nel layer e
// non va ricopiato in un secondo posto che potrebbe divergere.
//
// Lo stato vive nel layer e non qui dentro: questo hook non e' la sorgente, e'
// uno specchio. Se tenesse la verita' lui, `audio.setEnabled()` chiamata da un
// toggle UI e da un test produrrebbero due stati in disaccordo, e il bug
// arriverebbe al primo utente che spegne e riaccende l'audio.

export interface UseAudio {
  /** Il layer e' acceso? */
  enabled: boolean;
  /** Accende o spegne. Passa attraverso `audio.setEnabled`, non aggira il layer. */
  setEnabled: (enabled: boolean) => void;
  /** Il gesto utente e' gia' avvenuto, quindi l'audio puo' partire? */
  unlocked: boolean;
}

export const useAudio = (): UseAudio => {
  const [enabled, setEnabledState] = useState(audio.state.enabled);
  const [unlocked, setUnlocked] = useState(audio.state.unlocked);

  useEffect(() => {
    // Lo stato iniziale e' gia' dentro `audio.state` e puo' essere cambiato
    // prima che il componente monti (per esempio sotto `?skip`): si rilegge
    // all'avvio, altrimenti il toggle mostrerebbe "spentissimo" per un audio
    // che e' gia' acceso da un secondo.
    const sync = () => {
      setEnabledState(audio.state.enabled);
      setUnlocked(audio.state.unlocked);
    };
    sync();
    // I due CustomEvent sono l'unico canale: il layer non deve sapere che
    // React esiste, altrimenti un test che lo usa dal terminale dovrebbe
    // montare un componente solo per cambiare un booleano.
    const onEnabled = (event: Event) => {
      setEnabledState((event as CustomEvent<{ enabled: boolean }>).detail.enabled);
    };
    window.addEventListener('audio:enabled-changed', onEnabled);
    window.addEventListener('audio:unlocked', sync);
    return () => {
      window.removeEventListener('audio:enabled-changed', onEnabled);
      window.removeEventListener('audio:unlocked', sync);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    audio.setEnabled(next);
  }, []);

  return { enabled, setEnabled, unlocked };
};

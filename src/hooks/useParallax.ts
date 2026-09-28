import { useTransform, type MotionValue } from 'framer-motion';
import { useSmoothScroll } from '@/providers/smoothScrollContext';
import { readSceneTop } from '@/lib/scrollMath';

/**
 * Parallasse dichiarativo, l'equivalente del `data-speed` che planetono mette
 * sugli strati: l'elemento scorre a una velocità pari a quella dello scroll,
 * con speed = 1 per il moto normale e speed < 1 per uno strato che arriva da
 * piu' lontano.
 *
 * Si appoggia alla MotionValue condivisa del provider, quindi non aggiunge
 * listener ne' cicli: il valore e' derivato dentro il RAF che aggiorna gia' lo
 * scroll. Il riferimento e' il bordo superiore della sezione indicata, cosi' il
 * drift si misura solo dentro quella sezione e non su tutta la pagina; senza
 * `scene` si usa la prima viewport.
 *
 * AVVERTENZA, non ignorarla: non applicarlo a un elemento che gia' scrive una
 * trasformazione, pilotata dallo scroll o da un'animazione Framer. Framer e
 * questo hook scriverebbero lo stesso attributo `style.transform` e uno dei due
 * vincerebbe a ogni frame, con il movimento contato due volte o perso. E' la
 * stessa ragione per cui publishPortraitGeometry pubblica gli offset di LAYOUT
 * del ritratto e non la sua rect: se i valori includessero gia' il movimento,
 * il canvas lo conterebbe una seconda volta.
 */
export const useParallax = (speed: number, scene?: string): MotionValue<number> => {
  const { scrollY } = useSmoothScroll();
  return useTransform(scrollY, (value) => {
    const anchor = scene ? readSceneTop(scene) : window.innerHeight;
    return -(value - anchor) * (1 - speed);
  });
};

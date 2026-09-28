import { useTransform, type MotionValue } from 'framer-motion';
import ScrollHint from './ScrollHint';
import { viewportPhase } from '@/lib/scrollMath';

export default function NebulaScene({ scrollY }: { scrollY: MotionValue<number> }) {
  // Nebula occupa scrollY 2vh → 3vh. Il volto è già completo al suo stop e
  // [SCORRI ANCORA ↓] compare nel brevissimo passaggio dopo la dissoluzione SVG.
  const keepOpacity = useTransform(
    scrollY,
    (value) =>
      viewportPhase(value, 1.965, 2) *
      (1 - viewportPhase(value, 2.5, 2.62)),
  );

  return (
    <>
      {/* Nessuna etichetta di posizione: la sola indicazione di sezione e' la
          coppia MILANO / POTENZA in App.tsx. Resta solo l'hint di scroll. */}
      <ScrollHint opacity={keepOpacity}>[SCORRI ANCORA ↓]</ScrollHint>
    </>
  );
}

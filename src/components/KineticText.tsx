import { motion, useMotionValue, useTransform, type MotionValue } from 'framer-motion';

interface KineticTextProps {
  children: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'span' | 'button' | 'div';
  scrollProgress?: MotionValue<number>;
  idle?: boolean;
  intensity?: number;
}

function AnimatedLetter({ char, index, scrollProgress, idle, intensity }: { char: string; index: number; scrollProgress: MotionValue<number>; idle: boolean; intensity: number }) {
  const letterY = useTransform(scrollProgress, [0, 0.5 + index * 0.05, 1], [0, -40, 0]);
  const letterScaleY = useTransform(scrollProgress, [0, 0.5, 1], [1, 1.45, 1]);
  const letterSkew = useTransform(scrollProgress, [0, 0.5, 1], [0, -16, 0]);

  return (
    <motion.span
      key={index}
      className="inline-block whitespace-pre"
      initial={{ y: 0, scaleY: 1, skewX: 0, opacity: 1 }}
      animate={idle ? { y: [0, -18 * intensity, 0], scaleY: [1, 1 + 0.25 * intensity, 1], skewX: [0, -10 * intensity, 0] } : undefined}
      whileHover={{ scaleY: 1 + 0.4 * intensity, skewX: -12 * intensity, y: -6 * intensity }}
      transition={idle ? { duration: 1.8, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut', delay: index * 0.08 } : { type: 'spring', stiffness: 400, damping: 15 }}
      style={{
        display: 'inline-block',
        willChange: 'transform',
        // Colore ereditato dal Tag: la classe del chiamante decide (giallo per i
        // titoli display, rosa per gli altri). Non forzare qui: uno style inline
        // batterebbe sempre la classe Tailwind.
        opacity: 1,
        ...(idle ? {} : { y: letterY, scaleY: letterScaleY, skewX: letterSkew }),
      }}
    >
      <motion.span
        style={{ display: 'inline-block', willChange: 'transform', opacity: 1 }}
        whileHover={{ scaleY: 1 + 0.7 * intensity, skewX: -20 * intensity, y: -12 * intensity }}
        transition={{ type: 'spring', stiffness: 500, damping: 15 }}
      >
        {char === ' ' ? '\u00a0' : char}
      </motion.span>
    </motion.span>
  );
}

export default function KineticText({ children, className = '', as = 'span', scrollProgress, idle = false, intensity = 1 }: KineticTextProps) {
  const Tag = as;
  const fallbackProgress = useMotionValue(0);
  const progress = scrollProgress ?? fallbackProgress;

  return (
    <Tag className={className} style={{ opacity: 1, pointerEvents: 'auto' }}>
      <span className="inline-flex flex-nowrap items-center justify-center whitespace-nowrap">
        {children.split('').map((char, index) => (
          <AnimatedLetter key={`${char}-${index}`} char={char} index={index} scrollProgress={progress} idle={idle} intensity={intensity} />
        ))}
      </span>
    </Tag>
  );
}
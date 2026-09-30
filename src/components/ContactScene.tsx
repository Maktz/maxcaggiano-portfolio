import { motion } from 'framer-motion';
import KineticText from './KineticText';
import ContactForm from './ContactForm';

// LA SEZIONE "LET'S BUILD".
//
// Il form non è qui: è in `ContactForm`, lo stesso che monta il modal aperto
// dalla card «+» della Works. I due posti chiedono le stesse cose e devono
// restare identici — stessi campi, stessa validazione, stesso invio, stesso
// stato di successo — quindi il modulo sta in un componente solo e questa
// sezione ne decide solo il contorno: il titolo, il richiamo sopra il form e la
// riga di crediti in fondo.
//
// `source` distingue le due provenienze: da qui arriva un contatto, dal modal
// una proposta di progetto. È l'unica differenza, ed è voluta.
export default function ContactScene() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="h-screen w-full bg-transparent relative overflow-hidden flex flex-col items-center justify-center px-4"
    >
      <div className="relative z-10 w-full max-w-3xl">
        <div className="text-center mb-8 md:mb-10">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            {/* intensity 0.4: a 5vw la stessa intensità del titolo (0.8) stirava le
                lettere fino a 2.06x, facendole sbattere contro l'etichetta sopra e il form
                sotto. Con 0.4 lo stiramento scende a 1.48x e il sollevamento a 7.2px. */}
            <KineticText as="h2" intensity={0.4} className="font-display font-extrabold text-[10vw] md:text-[5vw] leading-[0.85] tracking-tight text-accent cursor-pointer">
              COSTRUIAMO.
            </KineticText>
          </motion.div>
        </div>

        <ContactForm source="contact-section" />

        <div className="mt-8 text-center font-mono text-[10px] tracking-widest text-swiss-pink">
          [MAX CAGGIANO // ART DIRECTION // © 2026]
        </div>
      </div>
    </motion.div>
  );
}

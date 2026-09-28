import { useState } from 'react';
import { motion } from 'framer-motion';
import KineticText from './KineticText';
import TransmissionButton from './TransmissionButton';

export default function ContactScene() {
  const [form, setForm] = useState({ name: '', email: '', brief: '' });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  // NOTA: questo blocco e' l'unico di tutta la pagina senza una trasformazione
  // gia' pilotata (porta solo opacita'), quindi l'unico dove useParallax
  // potrebbe andare senza conflitto. Non e' applicato perche' qui non si
  // vedrebbe: la sezione e' alta esattamente una viewport e sta in fondo
  // pagina, quindi maxScroll coincide con il suo bordo superiore e il blocco
  // risulta visibile a un solo valore di scroll (misurato: 5 sonde a partire
  // dal suo bordo, tutte clampate a 6813). Serve quando il contatto verra'
  // allungato, o su un HUD che abbia range reale.

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.brief) { setError('ALL FIELDS REQUIRED'); return; }
    setError('');
    setSubmitted(true);
  };

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
              LET'S BUILD.
            </KineticText>
          </motion.div>
        </div>

        {submitted ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="grid-wireframe bg-dark-green p-8 md:p-12 text-center">
            <div className="font-display font-extrabold text-2xl md:text-4xl text-accent mb-3">TRANSMISSION RECEIVED</div>
            <p className="font-mono text-sm text-swiss-pink">Thank you, {form.name}. I'll respond within 48 hours.</p>
            <button onClick={() => { setSubmitted(false); setForm({ name: '', email: '', brief: '' }); }} className="mt-5 font-mono text-xs tracking-widest text-swiss-pink hover:text-swiss-pink transition-colors">
              [SEND ANOTHER →]
            </button>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="grid-wireframe bg-canvas p-6 md:p-10">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 mb-5 items-center border-b border-swiss-pink/20 pb-5">
              <label className="md:col-span-2 font-mono text-xs tracking-widest text-swiss-pink">NAME:</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="md:col-span-10 bg-transparent font-mono text-base text-swiss-pink border-b border-swiss-pink/20 pb-2 focus:outline-none focus:border-swiss-pink transition-colors" placeholder="Your name" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 mb-5 items-center border-b border-swiss-pink/20 pb-5">
              <label className="md:col-span-2 font-mono text-xs tracking-widest text-swiss-pink">EMAIL:</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="md:col-span-10 bg-transparent font-mono text-base text-swiss-pink border-b border-swiss-pink/20 pb-2 focus:outline-none focus:border-swiss-pink transition-colors" placeholder="your@email.com" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 mb-6 items-start">
              <label className="md:col-span-2 font-mono text-xs tracking-widest text-swiss-pink pt-2">PROJECT BRIEF:</label>
              <textarea value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} rows={3}
                className="md:col-span-10 bg-transparent font-mono text-base text-swiss-pink border border-swiss-pink/20 p-3 focus:outline-none focus:border-swiss-pink transition-colors resize-none" placeholder="Tell me about your project..." />
            </div>
            {error && <div className="font-mono text-xs tracking-widest text-swiss-pink mb-4">[{error}]</div>}
            <div className="flex justify-end">
              {/* Stesso componente del pulsante del preloader: la classe, l'hover,
                  la freccia e la scala al click sono le stesse, e il CSS del
                  pulsante non esiste in due posti. */}
              <TransmissionButton type="submit" label="SEND TRANSMISSION" />
            </div>
          </form>
        )}

        <div className="mt-8 text-center font-mono text-[10px] tracking-widest text-swiss-pink">
          [MAX CAGGIANO // ART DIRECTION // © 2026]
        </div>
      </div>
    </motion.div>
  );
}

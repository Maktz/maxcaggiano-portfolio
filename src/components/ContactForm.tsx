import { useId, useState } from 'react';
import { motion } from 'framer-motion';
import TransmissionButton from './TransmissionButton';

// IL FORM DI CONTATTO, UNICO PER TUTTA LA PAGINA.
//
// Prima viveva dentro ContactScene, che è la sezione "Let's build". La card «+»
// della Works ha bisogno esattamente delle stesse cose — stessi campi, stessa
// validazione, stesso invio, stesso stato di successo — e havingcelo ricopiato
// avrebbe prodotto due form che divergono alla prima modifica. Quindi qui c'è il
// form, e sia la sezione sia il modal lo montano.
//
// L'unica differenza fra i due usi è `source`: il campo nascosto che dichiara
// da dove è arrivata la richiesta. Non è decorativo — è l'unico modo di
// distinguere un progetto nuovo da un contatto normale quando le due richieste
// arrivano insieme e prendono la stessa strada.
interface ContactFormProps {
  /** Valore del campo nascosto `source`. */
  source: string;
}

interface ContactValues {
  name: string;
  email: string;
  brief: string;
}

const EMPTY: ContactValues = { name: '', email: '', brief: '' };

export default function ContactForm({ source }: ContactFormProps) {
  const [form, setForm] = useState<ContactValues>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  // Gli id dei campi sono generati, non scritti: lo stesso form è montato due
  // volte nella pagina (sezione e modal) e due `id` fissi sarebbero duplicati,
  // con `label for` che punta al campo sbagliato in uno dei due casi.
  const nameId = useId();
  const emailId = useId();
  const briefId = useId();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.brief) {
      setError('TUTTI I CAMPI SONO OBBLIGATORI');
      return;
    }
    setError('');
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="grid-wireframe bg-dark-green p-8 md:p-12 text-center"
      >
        <div className="font-display font-extrabold text-2xl md:text-4xl text-accent mb-3">
          TRASMISSIONE RICEVUTA
        </div>
        <p className="font-mono text-sm text-swiss-pink">
          Grazie, {form.name}. Rispondo entro 48 ore.
        </p>
        <button
          onClick={() => {
            setSubmitted(false);
            setForm(EMPTY);
          }}
          className="mt-5 font-mono text-xs tracking-widest text-swiss-pink hover:text-swiss-pink transition-colors"
        >
          [INVIA UN'ALTRA →]
        </button>
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid-wireframe bg-canvas p-6 md:p-10">
      {/* Da dove arriva la richiesta. Nascosto e non readonly: un campo
          `hidden` non viene inviato, quindi non arriverebbe mai da nessuna
          parte — qui serve proprio il contrario. */}
      <input type="hidden" name="source" value={source} readOnly />
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 mb-5 items-center border-b border-swiss-pink/20 pb-5">
        <label htmlFor={nameId} className="md:col-span-2 font-mono text-xs tracking-widest text-swiss-pink">
          NOME:
        </label>
        <input
          id={nameId}
          name="name"
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="md:col-span-10 bg-transparent font-mono text-base text-swiss-pink border-b border-swiss-pink/20 pb-2 focus:outline-none focus:border-swiss-pink transition-colors"
          placeholder="Il tuo nome"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 mb-5 items-center border-b border-swiss-pink/20 pb-5">
        <label htmlFor={emailId} className="md:col-span-2 font-mono text-xs tracking-widest text-swiss-pink">
          EMAIL:
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="md:col-span-10 bg-transparent font-mono text-base text-swiss-pink border-b border-swiss-pink/20 pb-2 focus:outline-none focus:border-swiss-pink transition-colors"
          placeholder="la-tua@email.it"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 mb-6 items-start">
        <label htmlFor={briefId} className="md:col-span-2 font-mono text-xs tracking-widest text-swiss-pink pt-2">
          BRIEF DEL PROGETTO:
        </label>
        <textarea
          id={briefId}
          name="brief"
          value={form.brief}
          onChange={(e) => setForm({ ...form, brief: e.target.value })}
          rows={3}
          className="md:col-span-10 bg-transparent font-mono text-base text-swiss-pink border border-swiss-pink/20 p-3 focus:outline-none focus:border-swiss-pink transition-colors resize-none"
          placeholder="Raccontami il tuo progetto..."
        />
      </div>
      {error && (
        <div role="alert" className="font-mono text-xs tracking-widest text-swiss-pink mb-4">
          [{error}]
        </div>
      )}
      <div className="flex justify-end">
        {/* Stesso componente del pulsante del preloader: la classe, l'hover,
            la freccia e la scala al click sono le stesse, e il CSS del
            pulsante non esiste in due posti. */}
        <TransmissionButton type="submit" label="INVIA TRASMISSIONE" />
      </div>
    </form>
  );
}
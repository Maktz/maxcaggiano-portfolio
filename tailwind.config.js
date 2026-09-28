/**
 * @type {import('tailwindcss').Config}
 *
 * I colori NON sono scritti qui: leggono le custom properties definite in
 * src/index.css, che sono l'unica sorgente di verità. Il formato
 * `rgb(var(--x) / <alpha-value>)` mantiene funzionanti gli opacity modifier
 * (bg-pink/20, text-accent/70).
 */
const token = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sfondo pagina: magenta.
        canvas: token('canvas'),
        // Fondale scuro delle card e dei pulsanti: magenta scurito, derivato
        // dal canvas per non far saltare il contrasto del testo.
        'dark-green': token('deep'),
        // Rosa chiaro: testi mono piccoli, indicazioni, bordi, particelle.
        'swiss-pink': token('pink'),
        'light-green': token('pink'),
        // Giallo: riservato alla tipografia display (i testi grandi).
        accent: token('accent'),
        // Palette aggiuntiva, usata oggi dalle navicelle e disponibile per
        // qualunque altro elemento abbia bisogno di queste tinte.
        violet: token('violet'),
        orchid: token('orchid'),
        amber: token('amber'),
      },
      fontFamily: {
        display: ['Clab', 'sans-serif'],
        mono: ['"Space Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};

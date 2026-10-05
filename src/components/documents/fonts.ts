import {
  Arimo,
  Caveat,
  Cousine,
  Dancing_Script,
  EB_Garamond,
  Fira_Code,
  Lora,
  Merriweather,
  Montserrat,
  Nunito,
  Open_Sans,
  Oswald,
  Playfair_Display,
  Raleway,
  Roboto,
  Roboto_Mono,
  Roboto_Slab,
  Source_Serif_4,
  Tinos,
  Work_Sans,
} from 'next/font/google';

const arimo = Arimo({
  variable: '--font-doc-arimo',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const tinos = Tinos({
  variable: '--font-doc-tinos',
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const cousine = Cousine({
  variable: '--font-doc-cousine',
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const roboto = Roboto({
  variable: '--font-doc-roboto',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const openSans = Open_Sans({
  variable: '--font-doc-open-sans',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const montserrat = Montserrat({
  variable: '--font-doc-montserrat',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const nunito = Nunito({
  variable: '--font-doc-nunito',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const raleway = Raleway({
  variable: '--font-doc-raleway',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const workSans = Work_Sans({
  variable: '--font-doc-work-sans',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const merriweather = Merriweather({
  variable: '--font-doc-merriweather',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const lora = Lora({
  variable: '--font-doc-lora',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const playfairDisplay = Playfair_Display({
  variable: '--font-doc-playfair-display',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const eBGaramond = EB_Garamond({
  variable: '--font-doc-eb-garamond',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const sourceSerif4 = Source_Serif_4({
  variable: '--font-doc-source-serif',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const robotoSlab = Roboto_Slab({
  variable: '--font-doc-roboto-slab',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  preload: false,
});

const robotoMono = Roboto_Mono({
  variable: '--font-doc-roboto-mono',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

const firaCode = Fira_Code({
  variable: '--font-doc-fira-code',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  preload: false,
});

const oswald = Oswald({
  variable: '--font-doc-oswald',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  preload: false,
});

const caveat = Caveat({
  variable: '--font-doc-caveat',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  preload: false,
});

const dancingScript = Dancing_Script({
  variable: '--font-doc-dancing-script',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  preload: false,
});

export const DOCUMENT_FONT_VARIABLES = [
  arimo.variable,
  tinos.variable,
  cousine.variable,
  roboto.variable,
  openSans.variable,
  montserrat.variable,
  nunito.variable,
  raleway.variable,
  workSans.variable,
  merriweather.variable,
  lora.variable,
  playfairDisplay.variable,
  eBGaramond.variable,
  sourceSerif4.variable,
  robotoSlab.variable,
  robotoMono.variable,
  firaCode.variable,
  oswald.variable,
  caveat.variable,
  dancingScript.variable,
].join(' ');

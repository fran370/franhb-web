export const SITIO = {
  url: 'https://franhb.com',
  nombre: 'Fran Hidalgo-Barquero',
  rol: 'Socio en Albia IMAP',
  rolUrl: 'https://www.albiacapital.com',
  lema: 'Empresa, M&A y Private Equity, filosofía, tecnología',
  ciudad: 'Madrid',
};

export const SOCIAL = [
  { nombre: 'Email', url: 'mailto:fcojosehbj@gmail.com' },
  { nombre: 'Podcast', url: 'https://open.spotify.com/show/tu-podcast' },
  { nombre: 'LinkedIn', url: 'https://www.linkedin.com/in/hidalgobarquero/' },
  { nombre: 'X', url: 'https://x.com/franhbj' },
];

/**
 * Los tipos de entrada. El orden aquí es el orden de los filtros.
 * `etiqueta` es lo que se graba en la cinta junto a cada entrada.
 */
export const TIPOS = {
  ensayo: { plural: 'ensayos', ruta: 'ensayos', etiqueta: 'ENSAYO', completo: false },
  resena: { plural: 'reseñas', ruta: 'resenas', etiqueta: 'RESEÑA', completo: false },
  post: { plural: 'posts', ruta: 'posts', etiqueta: 'POST', completo: true },
  podcast: { plural: 'podcasts', ruta: 'podcasts', etiqueta: 'PODCAST', completo: true } ,
  maweekly: { plural: 'MAweekly', ruta: 'maweekly', etiqueta: 'MAWEEKLY', completo: false },
  cita: { plural: 'citas', ruta: 'citas', etiqueta: 'CITA', completo: true },
  video: { plural: 'vídeos', ruta: 'videos', etiqueta: 'VÍDEO', completo: true },
} as const;

export type Tipo = keyof typeof TIPOS;
export const LISTA_TIPOS = Object.keys(TIPOS) as Tipo[];

/**
 * Fila de formato del menú principal: ensayo y reseña se aglutinan bajo
 * "Artículos" (no es un tipo nuevo, solo una agrupación a efectos de
 * navegación — ver src/pages/articulos/[...page].astro). MAweekly no tiene
 * hueco propio aquí: se navega desde el tema "M&A y Private Equity".
 */
export const MENU_FORMATOS = [
  { clave: 'articulos', ruta: 'articulos', etiqueta: 'Artículos' },
  { clave: 'post', ruta: TIPOS.post.ruta, etiqueta: 'Posts' },
  { clave: 'podcast', ruta: TIPOS.podcast.ruta, etiqueta: 'Podcasts' },
  { clave: 'video', ruta: TIPOS.video.ruta, etiqueta: 'Vídeos' },
  { clave: 'cita', ruta: TIPOS.cita.ruta, etiqueta: 'Citas' },
] as const;

export type ClaveFormato = (typeof MENU_FORMATOS)[number]['clave'];

/**
 * Los grandes temas del sitio: eje de navegación independiente de `tipo`
 * (que describe el formato, no el contenido). Las citas quedan fuera de
 * este sistema a propósito.
 */
export const TEMAS = {
  'ma-y-pe': { ruta: 'ma-y-pe', etiqueta: 'M&A y Private Equity' },
  filosofia: { ruta: 'filosofia', etiqueta: 'Filosofía' },
  lecturas: { ruta: 'lecturas', etiqueta: 'Lecturas' },
} as const;

export type Tema = keyof typeof TEMAS;
export const LISTA_TEMAS = Object.keys(TEMAS) as Tema[];

/** Series dentro de un tema (p.ej. "M&A Weekly" dentro de "M&A y PE"). */
export const SERIES = {
  'ma-weekly': { ruta: 'ma-weekly', etiqueta: 'M&A Weekly', tema: 'ma-y-pe' },
  'ma-private-circle': { ruta: 'ma-private-circle', etiqueta: 'M&A and Private Equity Circle', tema: 'ma-y-pe' },
  'club-lectura': { ruta: 'club-lectura', etiqueta: 'Club de lectura', tema: 'lecturas' },
  'solapa-libro': { ruta: 'solapa-libro', etiqueta: 'La solapa de un libro', tema: 'lecturas' },
} as const satisfies Record<string, { ruta: string; etiqueta: string; tema: Tema }>;

export type Serie = keyof typeof SERIES;
export const LISTA_SERIES = Object.keys(SERIES) as Serie[];

/** Cuántas entradas se muestran por página en portada y listados por tipo. */
export const TAMANO_PAGINA = 10;

/** A partir de cuántas palabras un post/podcast/vídeo se recorta en la cinta
 * y pide "Seguir leyendo" para abrir la página completa. */
export const PALABRAS_MAX_EN_CINTA = 150;

export const NAVEGACION = [
  { nombre: 'Sobre mí', url: '/sobre-mi/' },
  { nombre: 'Ahora', url: '/ahora/' },
  { nombre: 'Newsletters', url: '/newsletters/' },
];

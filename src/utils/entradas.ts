import { getCollection, type CollectionEntry } from 'astro:content';
import { TIPOS, type Tema, type Serie, type ClaveFormato } from '../consts';

export type Entrada = CollectionEntry<'entradas'>;

/** Todas las entradas publicadas, de más reciente a más antigua. */
export async function todasLasEntradas(): Promise<Entrada[]> {
  const entradas = await getCollection('entradas', ({ data }) => !data.borrador);
  return entradas.sort((a, b) => b.data.fecha.valueOf() - a.data.fecha.valueOf());
}

/** El slug público de una entrada (sin barras). MAweekly lleva el prefijo
 * "maweekly-" para distinguirse a simple vista en la URL; el resto usa
 * directamente el id del archivo. */
export function slugDe(entrada: Entrada): string {
  if (entrada.data.tipo === 'maweekly') return `maweekly-${entrada.id}`;
  return entrada.id;
}

/** La ruta pública de una entrada: /mi-post/ o /maweekly-31-2026/ */
export function rutaDe(entrada: Entrada): string {
  return `/${slugDe(entrada)}/`;
}

/** A qué listado de formato lleva la insignia de tipo de una entrada.
 * Ensayo y reseña van a "Artículos" y MAweekly a "Posts" (agrupados en el
 * menú, ver MENU_FORMATOS en consts.ts); el resto usa su propio listado. */
export function rutaFormatoDe(entrada: Entrada): string {
  if (entrada.data.tipo === 'ensayo' || entrada.data.tipo === 'resena') return '/articulos/';
  if (entrada.data.tipo === 'maweekly') return '/posts/';
  return `/${TIPOS[entrada.data.tipo].ruta}/`;
}

/** Filtra por la fila de formato del menú (ver MENU_FORMATOS en consts.ts):
 * "articulos" agrupa ensayo+resena, "post" agrupa post+maweekly, el resto
 * coincide 1:1 con `tipo`. */
export function entradasDeFormato(entradas: Entrada[], clave: ClaveFormato): Entrada[] {
  if (clave === 'articulos') {
    return entradas.filter((e) => e.data.tipo === 'ensayo' || e.data.tipo === 'resena');
  }
  if (clave === 'post') {
    return entradas.filter((e) => e.data.tipo === 'post' || e.data.tipo === 'maweekly');
  }
  return entradas.filter((e) => e.data.tipo === clave);
}

/** Los temas de una entrada (puede pertenecer a varios), con MAweekly
 * cayendo en "M&A y PE" por defecto (fijo en código: sus 178 archivos no
 * llevan `tema` en el frontmatter). */
export function temasDe(entrada: Entrada): Tema[] {
  if (entrada.data.tema?.length) return entrada.data.tema;
  if (entrada.data.tipo === 'maweekly') return ['ma-y-pe'];
  return [];
}

/** La serie de una entrada, con el mismo valor por defecto para MAweekly. */
export function serieDe(entrada: Entrada): Serie | undefined {
  if (entrada.data.serie) return entrada.data.serie;
  if (entrada.data.tipo === 'maweekly') return 'ma-weekly';
  return undefined;
}

/** Título para listados y RSS. Los posts y citas no lo tienen: se deriva. */
export function tituloDe(entrada: Entrada): string {
  if (entrada.data.titulo) return entrada.data.titulo;
  if (entrada.data.tipo === 'cita' && entrada.data.autor) {
    return `Cita de ${entrada.data.autor}`;
  }
  return `${TIPOS[entrada.data.tipo].etiqueta} · ${fechaLarga(entrada.data.fecha)}`;
}

export function fechaLarga(fecha: Date): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(fecha);
}

export function fechaCinta(fecha: Date): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
    .format(fecha)
    .replace('.', '')
    .toUpperCase();
}

export function iso(fecha: Date): string {
  return fecha.toISOString();
}

/** El dominio de un enlace externo, para mostrarlo bajo el titular. */
export function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Extracto en texto plano del cuerpo, para el índice de búsqueda. */
export function extractoDe(entrada: Entrada, longitud = 160): string {
  const limpio = (entrada.body ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio.length > longitud ? `${limpio.slice(0, longitud).trim()}…` : limpio;
}

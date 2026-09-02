import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Páginas fijas del sitio (Sobre mí, Ahora...) cuyo cuerpo se edita en Notion
// para no tener que dar formato a mano en el .astro. Ver scripts/importar-paginas.mjs.
const paginas = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/paginas' }),
  schema: z.object({
    titulo: z.string(),
  }),
});

const entradas = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/entradas' }),
  schema: z.object({
    tipo: z.enum(['ensayo', 'resena', 'post', 'maweekly', 'podcast', 'cita', 'video']),
    fecha: z.coerce.date(),
    titulo: z.string().optional(),
    resumen: z.string().optional(),

    // A qué grandes temas pertenece (M&A y PE / Filosofía / Lecturas —
    // puede ser más de uno) y, si procede, a qué serie dentro de esos
    // temas. Opcionales: las citas y algunos posts sueltos no se
    // categorizan. maweekly no necesita rellenarlos — su tema/serie por
    // defecto vive en utils/entradas.ts.
    tema: z.array(z.enum(['ma-y-pe', 'filosofia', 'lecturas'])).optional(),
    serie: z.enum(['ma-weekly', 'ma-private-circle', 'club-lectura', 'solapa-libro']).optional(),

    // imagen de portada/cabecera: ruta en /public (p.ej. /imagenes/foto.jpg) o URL externa
    portada: z.string().optional(),

    // podcasts / enlace de fuente en citas sin autor
    url: z.string().url().optional(),

    // citas
    autor: z.string().optional(),
    autorUrl: z.string().url().optional(),
    obra: z.string().optional(),
    obraUrl: z.string().url().optional(),

    // maweekly
    semana: z.number().optional(),
    anio: z.number().optional(),

    // POSSE: dónde se republicó
    sindicado: z
      .array(z.object({ red: z.string(), url: z.string().url() }))
      .optional(),

    borrador: z.boolean().default(false),
  }),
});

export const collections = { entradas, paginas };

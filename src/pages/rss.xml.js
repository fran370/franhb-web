import rss from '@astrojs/rss';
import { SITIO } from '../consts';
import { todasLasEntradas, rutaDe, tituloDe } from '../utils/entradas';

export async function GET(context) {
  const entradas = await todasLasEntradas();

  return rss({
    title: SITIO.nombre,
    description: SITIO.lema,
    site: context.site,
    trailingSlash: true,
    items: entradas.map((entrada) => ({
      title: tituloDe(entrada),
      pubDate: entrada.data.fecha,
      description: entrada.data.resumen ?? '',
      link: rutaDe(entrada),
    })),
    customData: '<language>es-ES</language>',
  });
}

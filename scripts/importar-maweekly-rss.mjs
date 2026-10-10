// Sincroniza los últimos números de MAweekly desde el feed RSS público de
// Substack. A diferencia de importar-maweekly.mjs (que parte de un export ZIP
// para el histórico completo), este script no necesita ningún export manual:
// lee https://maweekly.substack.com/feed, que Substack mantiene con los ~20
// posts más recientes. Por eso sirve para mantener el sitio al día número a
// número, pero no reemplaza al importador de ZIP para recuperar números más
// antiguos que ya hayan salido del feed.
//
// Uso:
//   node scripts/importar-maweekly-rss.mjs [--forzar]
//
// Como el nombre de archivo de salida es siempre el mismo para un número dado
// (p.ej. 34-2026.md), no hace falta manifiesto: si el archivo ya existe se
// omite, salvo que se pase --forzar (igual que importar-maweekly.mjs).
//
// Si algún número se sale de los patrones "Week N (YYYY)" / "Summer recap
// (YYYY)" / "YYYY recap" (p.ej. un número especial con otro título), se lista
// al final como omitido para crearlo a mano.

import { writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import TurndownService from 'turndown';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(__dirname, '../src/content/entradas');
const FEED_URL = 'https://maweekly.substack.com/feed';

const forzar = process.argv.slice(2).includes('--forzar');

/** Extrae el contenido de la primera etiqueta <tag>, con o sin CDATA. */
function campo(bloque, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`);
  return bloque.match(re)?.[1] ?? null;
}

// Escribe en el Job Summary de la ejecución de Actions (pestaña "Summary",
// visible sin iniciar sesión), para poder diagnosticar fallos del feed sin
// tener que entrar a los logs completos del job.
function resumenCI(texto) {
  const ruta = process.env.GITHUB_STEP_SUMMARY;
  if (ruta) appendFileSync(ruta, texto + '\n');
}

const CABECERAS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
};

/** Trocea un RSS en items normalizados: { titulo, html, pubDate, subtitulo }. */
function itemsDeXml(xml) {
  return xml
    .split('<item>')
    .slice(1)
    .map((bloque) => bloque.split('</item>')[0])
    .map((item) => ({
      titulo: campo(item, 'title'),
      html: campo(item, 'content:encoded'),
      pubDate: campo(item, 'pubDate'),
      subtitulo: campo(item, 'description'),
    }));
}

// Cloudflare (delante de Substack) devuelve un desafío anti-bot a las IPs de
// datacenter, como las de los runners de GitHub Actions, así que pedir el feed
// directamente desde Actions falla casi siempre. Por eso se prueban varias
// fuentes en orden: el feed directo (funciona desde una IP doméstica) y, si
// falla, servicios públicos que leen el feed por nosotros desde sus propias
// IPs. Gana la primera que devuelva items.
const FUENTES = [
  {
    nombre: 'feed directo',
    url: FEED_URL,
    leer: async (r) => itemsDeXml(await r.text()),
  },
  {
    nombre: 'rss2json',
    url: `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(FEED_URL)}`,
    leer: async (r) => {
      const datos = await r.json();
      if (datos.status !== 'ok') throw new Error(`rss2json: ${datos.message || datos.status}`);
      return datos.items.map((i) => ({
        titulo: i.title,
        html: i.content,
        // rss2json da "YYYY-MM-DD HH:mm:ss" en UTC, sin zona.
        pubDate: i.pubDate ? `${i.pubDate.replace(' ', 'T')}Z` : null,
        subtitulo: i.description,
      }));
    },
  },
  {
    nombre: 'allorigins',
    url: `https://api.allorigins.win/raw?url=${encodeURIComponent(FEED_URL)}`,
    leer: async (r) => itemsDeXml(await r.text()),
  },
];

async function leerItems() {
  const fallos = [];
  for (const fuente of FUENTES) {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const respuesta = await fetch(fuente.url, {
          headers: CABECERAS,
          signal: AbortSignal.timeout(30_000),
        });
        if (!respuesta.ok) throw new Error(`status ${respuesta.status}`);
        const items = (await fuente.leer(respuesta)).filter((i) => i.titulo);
        if (items.length === 0) throw new Error('respuesta sin items');
        console.log(`Feed leído vía ${fuente.nombre} (${items.length} items)`);
        return items;
      } catch (error) {
        const motivo = `${fuente.nombre}, intento ${intento}: ${error.message}`;
        console.error(motivo);
        fallos.push(motivo);
        await new Promise((r) => setTimeout(r, 2000 * intento));
      }
    }
  }
  resumenCI(
    ['### MAweekly: no se pudo leer el feed por ninguna fuente', '', ...fallos.map((f) => `- ${f}`), ''].join('\n')
  );
  process.exit(1);
}

const items = await leerItems();

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });

const RE_SEMANA = /week\s+(\d+)\s*\((\d{4})\)/i;
const RE_VERANO = /summer\s+recap\s*\((\d{4})\)/i;
const RE_ANUAL = /^(\d{4})\s+recap/i;
const RE_MURO_DE_PAGO = /subscribe to keep reading|this post is for paying subscribers|this post is for paid subscribers/i;

let importados = 0;
let yaExistian = 0;
const omitidos = [];

for (const item of items) {
  const titulo = (item.titulo || '').trim();
  if (!titulo) continue;

  const coincidenciaSemana = titulo.match(RE_SEMANA);
  const coincidenciaVerano = titulo.match(RE_VERANO);
  const coincidenciaAnual = titulo.match(RE_ANUAL);

  let semana, anio, rutaSalida;
  if (coincidenciaSemana) {
    semana = Number(coincidenciaSemana[1]);
    anio = Number(coincidenciaSemana[2]);
    rutaSalida = join(DESTINO, `${semana}-${anio}.md`);
  } else if (coincidenciaVerano) {
    anio = Number(coincidenciaVerano[1]);
    rutaSalida = join(DESTINO, `verano-${anio}.md`);
  } else if (coincidenciaAnual) {
    anio = Number(coincidenciaAnual[1]);
    rutaSalida = join(DESTINO, `recap-${anio}.md`);
  } else {
    omitidos.push(`${titulo} (no sigue ningún patrón conocido)`);
    continue;
  }

  if (existsSync(rutaSalida) && !forzar) {
    yaExistian++;
    continue;
  }

  const html = item.html;
  if (!html) {
    omitidos.push(`${titulo} (sin content:encoded en el feed)`);
    continue;
  }
  if (RE_MURO_DE_PAGO.test(html)) {
    omitidos.push(`${titulo} (parece de pago: el feed solo trae un fragmento)`);
    continue;
  }

  const cuerpo = turndown.turndown(html).trim();

  const pubDate = item.pubDate;
  const fecha = pubDate ? new Date(pubDate).toISOString().slice(0, 10) : null;
  if (!fecha) {
    omitidos.push(`${titulo} (sin pubDate en el feed)`);
    continue;
  }

  const subtitulo = (item.subtitulo || '').trim();

  const lineas = ['---', 'tipo: maweekly'];
  if (semana) lineas.push(`semana: ${semana}`);
  lineas.push(`anio: ${anio}`, `titulo: "${titulo.replace(/"/g, '\\"')}"`);
  if (subtitulo) lineas.push(`resumen: "${subtitulo.replace(/"/g, '\\"')}"`);
  lineas.push(`fecha: ${fecha}`, '---', '', cuerpo, '');

  writeFileSync(rutaSalida, lineas.join('\n'), 'utf-8');
  importados++;
  console.log(`Importado: ${rutaSalida}`);
}

console.log(`\nImportados: ${importados}`);
console.log(`Ya existían (usa --forzar para sobrescribir): ${yaExistian}`);
if (omitidos.length > 0) {
  console.log('\nOmitidos (revisar a mano):');
  for (const t of omitidos) console.log(`  - ${t}`);
}

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

// Sin cabeceras, Substack devuelve 403 a peticiones que no parecen venir de
// un navegador (pasa sobre todo desde IPs de datacenter, como los runners de
// GitHub Actions; en local, con otra IP, a veces cuela sin este añadido). El
// añadido de estas cabeceras (commit c9101e3) no ha bastado para que el feed
// se lea de forma fiable desde Actions, así que además reintenta unas
// cuantas veces y, si al final falla, vuelca el motivo (status, cabeceras y
// el arranque del cuerpo de la respuesta) al Job Summary para poder verlo
// sin necesidad de iniciar sesión en GitHub.
async function leerFeed(intentos = 3) {
  for (let intento = 1; intento <= intentos; intento++) {
    let respuesta;
    let errorRed;
    try {
      respuesta = await fetch(FEED_URL, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        },
      });
    } catch (error) {
      errorRed = error;
    }

    if (respuesta?.ok) return respuesta;

    const esUltimoIntento = intento === intentos;
    if (errorRed) {
      console.error(`Intento ${intento}/${intentos}: error de red al pedir el feed: ${errorRed.message}`);
      if (esUltimoIntento) {
        resumenCI(
          `### MAweekly: error de red tras ${intentos} intentos\n\n\`${errorRed.message}\`\n`
        );
        process.exit(1);
      }
    } else {
      console.error(`Intento ${intento}/${intentos}: el feed devolvió ${respuesta.status}`);
      if (esUltimoIntento) {
        const cabeceras = [...respuesta.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
        const cuerpo = await respuesta.text();
        resumenCI(
          [
            '### MAweekly: no se pudo leer el feed',
            '',
            `Status \`${respuesta.status} ${respuesta.statusText}\` tras ${intentos} intentos contra ${FEED_URL}.`,
            '',
            '<details><summary>Cabeceras de la respuesta</summary>',
            '',
            '```',
            cabeceras,
            '```',
            '',
            '</details>',
            '',
            '<details><summary>Primeros 1000 caracteres del cuerpo</summary>',
            '',
            '```html',
            cuerpo.slice(0, 1000),
            '```',
            '',
            '</details>',
            '',
          ].join('\n')
        );
        process.exit(1);
      }
    }

    await new Promise((r) => setTimeout(r, 2000 * intento));
  }
}

const respuesta = await leerFeed();
const xml = await respuesta.text();
const items = xml.split('<item>').slice(1).map((bloque) => bloque.split('</item>')[0]);

if (items.length === 0) {
  console.error('El feed no devolvió ningún item. ¿Sigue siendo la URL correcta?');
  resumenCI('### MAweekly: el feed respondió OK pero sin items\n\n¿Sigue siendo la URL correcta?\n');
  process.exit(1);
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });

const RE_SEMANA = /week\s+(\d+)\s*\((\d{4})\)/i;
const RE_VERANO = /summer\s+recap\s*\((\d{4})\)/i;
const RE_ANUAL = /^(\d{4})\s+recap/i;
const RE_MURO_DE_PAGO = /subscribe to keep reading|this post is for paying subscribers|this post is for paid subscribers/i;

let importados = 0;
let yaExistian = 0;
const omitidos = [];

for (const item of items) {
  const titulo = (campo(item, 'title') || '').trim();
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

  const html = campo(item, 'content:encoded');
  if (!html) {
    omitidos.push(`${titulo} (sin content:encoded en el feed)`);
    continue;
  }
  if (RE_MURO_DE_PAGO.test(html)) {
    omitidos.push(`${titulo} (parece de pago: el feed solo trae un fragmento)`);
    continue;
  }

  const cuerpo = turndown.turndown(html).trim();

  const pubDate = campo(item, 'pubDate');
  const fecha = pubDate ? new Date(pubDate).toISOString().slice(0, 10) : null;
  if (!fecha) {
    omitidos.push(`${titulo} (sin pubDate en el feed)`);
    continue;
  }

  const subtitulo = (campo(item, 'description') || '').trim();

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

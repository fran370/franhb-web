// Importa el histórico de MAweekly desde un export de Substack.
//
// Cómo generar el export en Substack:
//   Panel de Substack → Configuración → Exportar y transferir → Exportar
//   Substack te enviará un email con un ZIP. Descomprímelo en tu ordenador.
//
// Uso:
//   node scripts/importar-maweekly.mjs <carpeta-descomprimida> [--forzar]
//
// El script busca dentro de esa carpeta:
//   - un CSV con metadatos de los posts (posts.csv)
//   - una carpeta con los posts en HTML (posts/)
// y genera un .md por post en src/content/entradas/, con el slug (nombre de
// archivo, que determina la URL /maweekly/<slug>/) según el tipo de post:
//   - semanal "Week 34 (2026) in M&A and Private Equity...": 34-2026.md
//   - "Summer recap (2026) in M&A and Private Equity...":    verano-2026.md
//   - "2026 recap in M&A and Private Equity...":             recap-2026.md
//
// Cada archivo generado tiene este formato:
//
//   ---
//   tipo: maweekly
//   semana: 34
//   anio: 2026
//   titulo: "Week 34 (2026) in M&A and Private Equity 🛰️🇪🇸"
//   resumen: "Transactions of the Week (August 17 - August 23)"
//   fecha: 2026-08-24
//   ---
//
//   <cuerpo del post convertido de HTML a Markdown>
//
// Los posts cuyo título no siga ninguno de esos tres patrones se listan al
// final como omitidos, para revisarlos a mano.

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname } from 'node:path';
import TurndownService from 'turndown';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(__dirname, '../src/content/entradas');

const [, , carpetaArg, ...flags] = process.argv;
const forzar = flags.includes('--forzar');

if (!carpetaArg) {
  console.error('Uso: node scripts/importar-maweekly.mjs <carpeta-descomprimida> [--forzar]');
  process.exit(1);
}

const carpeta = resolve(carpetaArg);
if (!existsSync(carpeta)) {
  console.error(`No existe la carpeta: ${carpeta}`);
  process.exit(1);
}

/** Recorre un directorio recursivamente y devuelve todas las rutas de archivo. */
function listarArchivos(dir) {
  const resultado = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    const info = statSync(ruta);
    if (info.isDirectory()) resultado.push(...listarArchivos(ruta));
    else resultado.push(ruta);
  }
  return resultado;
}

const archivos = listarArchivos(carpeta);

/** Parser CSV mínimo: soporta comillas, comas y saltos de línea dentro de campos. */
function parsearCSV(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let dentroComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const siguiente = texto[i + 1];

    if (dentroComillas) {
      if (c === '"' && siguiente === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        dentroComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\r') {
      // ignorar
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  const cabecera = filas.shift().map((h) => h.trim().toLowerCase());
  return filas
    .filter((f) => f.length === cabecera.length)
    .map((f) => Object.fromEntries(cabecera.map((h, idx) => [h, f[idx]])));
}

// 1. Localizar el CSV de posts
const csvCandidatos = archivos.filter((f) => extname(f).toLowerCase() === '.csv');
const csvPosts = csvCandidatos.find((f) => {
  const primeraLinea = readFileSync(f, 'utf-8').split('\n', 1)[0].toLowerCase();
  return primeraLinea.includes('title') && primeraLinea.includes('post_date');
});

if (!csvPosts) {
  console.error(
    `No encuentro un CSV de posts (con columnas title/post_date) dentro de ${carpeta}.\n` +
      `CSVs encontrados: ${csvCandidatos.join(', ') || '(ninguno)'}`
  );
  process.exit(1);
}

console.log(`CSV de posts: ${csvPosts}`);
const filas = parsearCSV(readFileSync(csvPosts, 'utf-8'));

// 2. Localizar los HTML de cada post
const htmls = archivos.filter((f) => extname(f).toLowerCase() === '.html');
console.log(`Encontrados ${filas.length} posts en el CSV y ${htmls.length} archivos HTML.\n`);

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buscarHtml(fila) {
  const postId = fila.post_id || fila.id;
  const slug = fila.slug ? normalizar(fila.slug) : normalizar(fila.title || '');

  if (postId) {
    const porId = htmls.find((f) => f.includes(`${postId}.`) || f.includes(`/${postId}`) || f.includes(`\\${postId}`));
    if (porId) return porId;
  }
  if (slug) {
    const porSlug = htmls.find((f) => normalizar(f).includes(slug));
    if (porSlug) return porSlug;
  }
  return null;
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });

const RE_SEMANA = /week\s+(\d+)\s*\((\d{4})\)/i;
const RE_VERANO = /summer\s+recap\s*\((\d{4})\)/i;
const RE_ANUAL = /^(\d{4})\s+recap/i;

let importados = 0;
let yaExistian = 0;
const omitidos = [];

for (const fila of filas) {
  const titulo = (fila.title || '').trim();
  if (!titulo) continue;

  // Solo posts publicados (si la columna existe)
  if ('is_published' in fila && !/true|1/i.test(fila.is_published)) continue;

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
    omitidos.push(titulo);
    continue;
  }

  if (existsSync(rutaSalida) && !forzar) {
    yaExistian++;
    continue;
  }

  const rutaHtml = buscarHtml(fila);
  if (!rutaHtml) {
    omitidos.push(`${titulo} (sin HTML asociado)`);
    continue;
  }

  const html = readFileSync(rutaHtml, 'utf-8');
  const cuerpo = turndown.turndown(html).trim();

  const fechaRaw = fila.post_date || fila.created || '';
  const fecha = fechaRaw.slice(0, 10); // YYYY-MM-DD

  // Se mantiene el título original de Substack tal cual (p.ej. "Week 34
  // (2026) in M&A and Private Equity 🛰️🇪🇸"). El subtítulo de Substack
  // (rango de fechas, p.ej. "Transactions of the Week (August 17 - 23)")
  // se guarda en `resumen`.
  const subtitulo = (fila.subtitle || fila.podcast_subtitle || '').trim();

  const lineasFrontmatter = ['---', 'tipo: maweekly'];
  if (semana) lineasFrontmatter.push(`semana: ${semana}`);
  lineasFrontmatter.push(`anio: ${anio}`, `titulo: "${titulo.replace(/"/g, '\\"')}"`);
  if (subtitulo) {
    lineasFrontmatter.push(`resumen: "${subtitulo.replace(/"/g, '\\"')}"`);
  }
  lineasFrontmatter.push(`fecha: ${fecha}`, '---', '', cuerpo, '');

  const frontmatter = lineasFrontmatter.join('\n');

  writeFileSync(rutaSalida, frontmatter, 'utf-8');
  importados++;
  console.log(`Importado: ${rutaSalida}`);
}

console.log(`\nImportados: ${importados}`);
console.log(`Ya existían (omitidos, usa --forzar para sobrescribir): ${yaExistian}`);
if (omitidos.length > 0) {
  console.log(`\nPosts omitidos (no siguen el patrón "Week N (YYYY)" o sin HTML asociado):`);
  for (const t of omitidos) console.log(`  - ${t}`);
}

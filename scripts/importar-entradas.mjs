// Importa ensayos, reseñas, posts y vídeos desde una base de datos de Notion
// a los tipos de entrada "ensayo", "resena", "post" y "video".
//
// A diferencia de importar-citas.mjs (que solo lee propiedades de la fila),
// aquí cada página de Notion tiene:
//   - un primer bloque de código (lenguaje "yaml") con el frontmatter que se
//     quiere usar de partida (titulo/fecha/resumen — tipo y fecha reales se
//     toman de las columnas de la base de datos, más fiables),
//   - opcionalmente una imagen (se usa como `portada`, se descarga a
//     public/imagenes/),
//   - el resto de bloques (párrafos, negrita/cursiva, títulos, citas en
//     bloque de código, separadores "---"...) que forman el cuerpo.
//
// Preparación (una vez):
//   1. https://www.notion.so/my-integrations → New integration → copia el secret.
//   2. En tu base de datos de Notion: ··· → Connections → conecta la integración.
//   3. Copia el ID de la base de datos (32 caracteres en la URL, antes de "?v=").
//   4. Copia .env.example a .env y rellena NOTION_TOKEN y NOTION_DATABASE_ID_ENTRADAS.
//   Nota: la sindicación (POSSE) se lee de hasta dos parejas de columnas
//   "Sindicado 1 (red)"/"Sindicado 1 (url)" y "Sindicado 2 (red)"/"Sindicado 2 (url)".
//   Nota: "Tema" (multi_select — una entrada puede tener más de un tema) y
//   "Serie" (select) son opcionales — solo se escriben en el frontmatter
//   los valores reconocidos (ver TEMAS_NOTION/SERIES_NOTION más abajo).
//   "URL" (columna url) es el enlace externo que necesita el tipo "Vídeo"
//   (mismo campo `url` que ya usa podcast).
//
// Uso:
//   node --env-file=.env scripts/importar-entradas.mjs --inspeccionar
//     → lista las propiedades reales de tu base de datos.
//
//   node --env-file=.env scripts/importar-entradas.mjs
//     → genera un .md por cada página marcada como "Publicar" que aún no se
//       haya importado (lleva registro en importadas-entradas.json). Si el
//       slug de una página ya corresponde a un archivo existente (por
//       ejemplo, entradas que ya estaban publicadas antes de usar este
//       flujo), se vincula sin sobrescribirlo.
//
//   node --env-file=.env scripts/importar-entradas.mjs --forzar
//     → además, regenera (sobrescribe) el .md de páginas ya importadas o
//       vinculadas previamente, por si ha cambiado el texto en Notion.
//
// Si una página que ya se había importado deja de aparecer (se borra en
// Notion o se desmarca "Publicar"), su archivo NO se borra: se marca como
// `borrador: true` (oculto, igual que el resto del flujo de "ocultar sin
// eliminar"). Si vuelve a marcarse "Publicar", se recupera automáticamente
// en la siguiente ejecución, sin necesidad de --forzar.

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(__dirname, '../src/content/entradas');
const IMAGENES = resolve(__dirname, '../public/imagenes');
const MANIFIESTO = resolve(__dirname, 'importadas-entradas.json');

const TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID_ENTRADAS;

if (!TOKEN || !DATABASE_ID) {
  console.error(
    'Faltan NOTION_TOKEN y/o NOTION_DATABASE_ID_ENTRADAS.\n' +
      'Copia .env.example a .env, rellénalo, y ejecuta con: node --env-file=.env scripts/importar-entradas.mjs'
  );
  process.exit(1);
}

// Ajusta estos nombres a como se llaman de verdad las columnas en tu base de
// datos de Notion (usa --inspeccionar para verlos).
const PROPIEDADES = {
  titulo: 'Título', // title
  tipo: 'Tipo', // select: Ensayo / Reseña / Post / Podcast / Vídeo
  fecha: 'Fecha', // date
  slug: 'Slug', // rich_text — nombre de archivo deseado
  publicar: 'Publicar', // checkbox — solo se importan las filas marcadas
  tema: 'Tema', // select: M&A y PE / Filosofía / Lecturas (opcional)
  serie: 'Serie', // select: M&A Weekly / M&A and Private Circle / Club de lectura / La solapa de un libro (opcional)
  url: 'URL', // url — enlace externo del episodio/vídeo (opcional, no aplica a ensayo/reseña/post)
  // Hasta dos parejas red/url de sindicación (POSSE). Añade más pares aquí
  // si en el futuro hay una "Sindicado 3 (red)" / "Sindicado 3 (url)".
  sindicado: [
    { red: 'Sindicado 1  (red)', url: 'Sindicado 1 (url)' },
    { red: 'Sindicado 2 (red)', url: 'Sindicado 2 (url)' },
  ],
};

const TIPOS = { Ensayo: 'ensayo', Reseña: 'resena', Post: 'post', Podcast: 'podcast', Vídeo: 'video' };

// Mapeo de las opciones de Notion a los slugs internos de tema/serie
// (ver TEMAS/SERIES en src/consts.ts). Un valor no reconocido se omite
// (se avisa por consola) en vez de romper la importación.
const TEMAS_NOTION = { 'M&A y PE': 'ma-y-pe', Filosofía: 'filosofia', Lecturas: 'lecturas' };
const SERIES_NOTION = {
  'M&A Weekly': 'ma-weekly',
  'M&A and Private Equity Circle': 'ma-private-circle',
  'Club de lectura': 'club-lectura',
  'La solapa de un libro': 'solapa-libro',
};

const flags = process.argv.slice(2);
const forzar = flags.includes('--forzar');
const inspeccionar = flags.includes('--inspeccionar');

async function notion(path, options = {}, reintentos = 5) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (res.status === 429 && reintentos > 0) {
    const espera = Number(res.headers.get('retry-after')) || 1;
    await new Promise((r) => setTimeout(r, espera * 1000));
    return notion(path, options, reintentos - 1);
  }
  if (!res.ok) {
    const texto = await res.text();
    throw new Error(`Notion API ${res.status}: ${texto}`);
  }
  return res.json();
}

if (inspeccionar) {
  const db = await notion(`/databases/${DATABASE_ID}`);
  console.log(`Base de datos: ${db.title?.[0]?.plain_text ?? '(sin título)'}\n`);
  console.log('Propiedades encontradas:');
  for (const [nombre, prop] of Object.entries(db.properties)) {
    const extra = prop.type === 'select' ? ` ${JSON.stringify(prop.select.options.map((o) => o.name))}` : '';
    console.log(`  - "${nombre}" (${prop.type})${extra}`);
  }
  console.log(
    '\nAjusta el objeto PROPIEDADES en scripts/importar-entradas.mjs con estos nombres exactos y vuelve a ejecutar sin --inspeccionar.'
  );
  process.exit(0);
}

/** Envuelve un fragmento en un marcador Markdown (** o *) sin dejar espacios
 * pegados al marcador, ya que eso puede impedir que se interprete como
 * énfasis (p.ej. "texto. *" en vez de "texto *"). */
function envolver(texto, marcador) {
  const coincidencia = texto.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const [, inicio, nucleo, fin] = coincidencia;
  if (!nucleo) return texto;
  return `${inicio}${marcador}${nucleo}${marcador}${fin}`;
}

/** Convierte un array de rich_text de Notion a texto plano en Markdown. */
function textoEnriquecido(richText) {
  if (!richText) return '';
  return richText
    .map((t) => {
      let texto = t.plain_text;
      if (t.annotations.code) texto = envolver(texto, '`');
      if (t.annotations.bold) texto = envolver(texto, '**');
      if (t.annotations.italic) texto = envolver(texto, '*');
      // Si el enlace apunta a la misma URL que el texto (autodetectado por
      // Notion al pegar una URL suelta), se deja como texto plano en vez de
      // envolverlo en [url](url).
      if (t.href && t.href !== t.plain_text) texto = `[${texto}](${t.href})`;
      return texto;
    })
    .join('');
}

/** Concatena un array de rich_text de Notion como texto plano, sin negrita,
 * cursiva ni enlaces — para valores de propiedades (título, slug...), donde
 * el formato de Notion no debe colarse en el frontmatter. */
function textoPlano(richText) {
  if (!richText) return '';
  return richText.map((t) => t.plain_text).join('');
}

/** Extrae un valor de propiedad de Notion, sea cual sea su tipo. */
function valorDe(pagina, nombrePropiedad) {
  if (!nombrePropiedad) return null;
  const prop = pagina.properties[nombrePropiedad];
  if (!prop) return null;

  switch (prop.type) {
    case 'title':
      return textoPlano(prop.title) || null;
    case 'rich_text':
      return textoPlano(prop.rich_text) || null;
    case 'url': {
      const valor = prop.url?.trim();
      if (!valor) return null;
      // Notion permite guardar URLs sin protocolo (p.ej. "linkedin.com");
      // el esquema del sitio exige URLs completas.
      return /^https?:\/\//i.test(valor) ? valor : `https://${valor}`;
    }
    case 'date':
      return prop.date?.start || null;
    case 'select':
      return prop.select?.name || null;
    case 'checkbox':
      return prop.checkbox;
    default:
      return null;
  }
}

/** Extrae todos los valores de una propiedad de opción múltiple ("Tema"
 * puede llevar más de una etiqueta). Admite tanto multi_select como select
 * (para no romper si algún día se cambia el tipo de columna en Notion). */
function valoresDe(pagina, nombrePropiedad) {
  if (!nombrePropiedad) return [];
  const prop = pagina.properties[nombrePropiedad];
  if (!prop) return [];
  if (prop.type === 'multi_select') return prop.multi_select.map((o) => o.name);
  if (prop.type === 'select') return prop.select ? [prop.select.name] : [];
  return [];
}

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Trae todos los bloques hijos de una página/bloque, paginando. */
async function obtenerBloques(blockId) {
  const bloques = [];
  let cursor;
  do {
    const query = cursor ? `?page_size=100&start_cursor=${cursor}` : '?page_size=100';
    const respuesta = await notion(`/blocks/${blockId}/children${query}`);
    bloques.push(...respuesta.results);
    cursor = respuesta.has_more ? respuesta.next_cursor : undefined;
  } while (cursor);
  return bloques;
}

/** Extrae el campo `resumen` del bloque de código YAML inicial (si existe). */
function resumenDeFrontmatter(textoYaml) {
  if (!textoYaml) return null;
  const conComillas = textoYaml.match(/^resumen:\s*"((?:[^"\\]|\\.)*)"/m);
  if (conComillas) return conComillas[1].replace(/\\"/g, '"');
  const sinComillas = textoYaml.match(/^resumen:\s*(.+)$/m);
  return sinComillas ? sinComillas[1].trim() : null;
}

/** Descarga una imagen de Notion (URL firmada, caduca) a public/imagenes/. */
async function descargarPortada(url, slug) {
  const yaExiste = existsSync(IMAGENES)
    ? readdirSync(IMAGENES).find((f) => f.startsWith(`${slug}.`))
    : null;
  if (yaExiste) return `/imagenes/${yaExiste}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar la portada: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tipoContenido = res.headers.get('content-type') || '';
  const ext = tipoContenido.includes('png')
    ? '.png'
    : tipoContenido.includes('webp')
      ? '.webp'
      : tipoContenido.includes('gif')
        ? '.gif'
        : '.jpg';

  if (!existsSync(IMAGENES)) mkdirSync(IMAGENES, { recursive: true });
  const nombre = `${slug}${ext}`;
  writeFileSync(join(IMAGENES, nombre), buffer);
  return `/imagenes/${nombre}`;
}

/** Convierte un bloque de Notion (que no sea el frontmatter ni la portada) a Markdown. */
async function bloqueAMarkdown(bloque, slug, contadorImagenes) {
  switch (bloque.type) {
    case 'paragraph':
      return textoEnriquecido(bloque.paragraph.rich_text);
    case 'heading_1':
      return `# ${textoEnriquecido(bloque.heading_1.rich_text)}`;
    case 'heading_2':
      return `## ${textoEnriquecido(bloque.heading_2.rich_text)}`;
    case 'heading_3':
      return `### ${textoEnriquecido(bloque.heading_3.rich_text)}`;
    case 'divider':
      return '---';
    case 'quote':
      return `> ${textoEnriquecido(bloque.quote.rich_text)}`;
    case 'bulleted_list_item':
      return `- ${textoEnriquecido(bloque.bulleted_list_item.rich_text)}`;
    case 'numbered_list_item':
      return `1. ${textoEnriquecido(bloque.numbered_list_item.rich_text)}`;
    case 'code':
      // Bloques de código que no son el frontmatter YAML se usan para citas
      // en bloque (texto suelto, sin valla de código en el Markdown final).
      return textoEnriquecido(bloque.code.rich_text);
    case 'image': {
      // Imágenes adicionales (más allá de la portada) se insertan en línea.
      contadorImagenes.n++;
      const url = bloque.image.file?.url || bloque.image.external?.url;
      if (!url) return '';
      const ruta = await descargarPortada(url, `${slug}-${contadorImagenes.n}`);
      return `![](${ruta})`;
    }
    case 'bookmark':
      return bloque.bookmark.url || '';
    default:
      console.log(`  (bloque de tipo "${bloque.type}" no soportado, se omite)`);
      return '';
  }
}

if (!existsSync(DESTINO)) mkdirSync(DESTINO, { recursive: true });

const manifiesto = existsSync(MANIFIESTO) ? JSON.parse(readFileSync(MANIFIESTO, 'utf-8')) : {};

/** ¿Tiene este archivo `borrador: true` en su frontmatter? */
function estaOculta(ruta) {
  if (!existsSync(ruta)) return false;
  return /^borrador:\s*true\s*$/m.test(readFileSync(ruta, 'utf-8'));
}

/** Inserta `borrador: true` en el frontmatter de un archivo ya existente,
 * para ocultarlo sin borrarlo (p.ej. si su página de Notion se eliminó o se
 * desmarcó "Publicar"). No hace nada si ya está oculto. */
function ocultar(ruta) {
  const contenido = readFileSync(ruta, 'utf-8');
  const lineas = contenido.split('\n');
  if (lineas[0]?.trim() !== '---') return; // sin frontmatter reconocible
  const cierre = lineas.indexOf('---', 1);
  if (cierre === -1) return;
  lineas.splice(cierre, 0, 'borrador: true');
  writeFileSync(ruta, lineas.join('\n'), 'utf-8');
}

let importadas = 0;
let vinculadas = 0;
let omitidas = 0;
let ocultadas = 0;
let cursor;
const vistas = new Set();

do {
  const respuesta = await notion(`/databases/${DATABASE_ID}/query`, {
    method: 'POST',
    body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
  });

  for (const pagina of respuesta.results) {
    if (PROPIEDADES.publicar && !valorDe(pagina, PROPIEDADES.publicar)) {
      console.log(`Omitida (Publicar sin marcar): ${pagina.id}`);
      omitidas++;
      continue;
    }
    vistas.add(pagina.id);

    const tipoNotion = valorDe(pagina, PROPIEDADES.tipo);
    const tipo = TIPOS[tipoNotion];
    if (!tipo) {
      console.log(`Omitida (tipo "${tipoNotion ?? '(vacío)'}" no soportado por este script): ${pagina.id}`);
      omitidas++;
      continue;
    }

    const titulo = valorDe(pagina, PROPIEDADES.titulo);
    if (!titulo) {
      console.log(`Omitida (sin título): ${pagina.id}`);
      omitidas++;
      continue;
    }

    const fecha = valorDe(pagina, PROPIEDADES.fecha) || pagina.created_time.slice(0, 10);
    const slugPropiedad = valorDe(pagina, PROPIEDADES.slug);
    const slug = normalizar(slugPropiedad || titulo).slice(0, 60);

    const temasNotion = valoresDe(pagina, PROPIEDADES.tema);
    const temas = temasNotion.map((t) => TEMAS_NOTION[t]).filter(Boolean);
    for (const t of temasNotion) {
      if (!TEMAS_NOTION[t]) console.log(`  Aviso: tema "${t}" no reconocido, se omite`);
    }

    const serieNotion = valorDe(pagina, PROPIEDADES.serie);
    const serie = serieNotion ? SERIES_NOTION[serieNotion] : null;
    if (serieNotion && !serie) console.log(`  Aviso: serie "${serieNotion}" no reconocida, se omite`);

    const url = valorDe(pagina, PROPIEDADES.url);

    const sindicado = PROPIEDADES.sindicado
      .map(({ red, url }) => ({
        red: valorDe(pagina, red),
        url: valorDe(pagina, url),
      }))
      .filter((s) => s.red && s.url);

    // Decide el archivo de salida y si hay que regenerarlo.
    let rutaSalida;
    let esNueva = false;
    if (manifiesto[pagina.id]) {
      const rutaExistente = join(DESTINO, manifiesto[pagina.id]);
      // Si estaba oculta (borrador: true) por una ejecución anterior en la
      // que esta página no tenía "Publicar" marcado, se regenera igualmente
      // para recuperarla, aunque no se pase --forzar.
      if (!forzar && !estaOculta(rutaExistente)) {
        console.log(`Omitida (ya importada antes): ${pagina.id}`);
        omitidas++;
        continue;
      }
      rutaSalida = rutaExistente;
    } else {
      const candidato = join(DESTINO, `${slug}.md`);
      if (existsSync(candidato)) {
        // El slug coincide con un archivo ya existente (p.ej. entradas que
        // ya estaban publicadas antes de usar este flujo de Notion): se
        // vincula en el manifiesto sin sobrescribir, salvo --forzar.
        manifiesto[pagina.id] = `${slug}.md`;
        if (!forzar) {
          console.log(`Vinculada sin sobrescribir (ya existía ${slug}.md): ${pagina.id}`);
          vinculadas++;
          continue;
        }
        rutaSalida = candidato;
      } else {
        esNueva = true;
        rutaSalida = candidato;
        let sufijo = 2;
        while (existsSync(rutaSalida)) {
          rutaSalida = join(DESTINO, `${slug}-${sufijo}.md`);
          sufijo++;
        }
      }
    }

    const bloques = await obtenerBloques(pagina.id);

    let resumen = null;
    let inicio = 0;
    if (bloques[0]?.type === 'code' && bloques[0].code.language === 'yaml') {
      resumen = resumenDeFrontmatter(textoPlano(bloques[0].code.rich_text));
      inicio = 1;
    }

    // La primera imagen encontrada se trata como portada (se extrae del
    // cuerpo); el resto de imágenes se insertan en línea donde aparezcan.
    let portada = null;
    const bloquesCuerpo = [];
    for (const bloque of bloques.slice(inicio)) {
      if (!portada && bloque.type === 'image') {
        const url = bloque.image.file?.url || bloque.image.external?.url;
        if (url) {
          try {
            portada = await descargarPortada(url, slug);
            continue;
          } catch (error) {
            console.log(`  Aviso: no se pudo descargar la portada (${error.message})`);
          }
        }
      }
      bloquesCuerpo.push(bloque);
    }

    const contadorImagenes = { n: 0 };
    const parrafos = [];
    for (const bloque of bloquesCuerpo) {
      const md = await bloqueAMarkdown(bloque, slug, contadorImagenes);
      if (md) parrafos.push(md);
    }
    const cuerpo = parrafos.join('\n\n');

    const lineas = ['---', `tipo: ${tipo}`, `titulo: "${titulo.replace(/"/g, '\\"')}"`, `fecha: ${fecha}`];
    if (temas.length > 0) {
      lineas.push('tema:');
      for (const t of temas) lineas.push(`  - ${t}`);
    }
    if (serie) lineas.push(`serie: ${serie}`);
    if (url) lineas.push(`url: "${url}"`);
    if (resumen) lineas.push(`resumen: "${resumen.replace(/"/g, '\\"')}"`);
    if (portada) lineas.push(`portada: ${portada}`);
    if (sindicado.length > 0) {
      lineas.push('sindicado:');
      for (const s of sindicado) {
        lineas.push(`  - red: "${s.red.replace(/"/g, '\\"')}"`, `    url: "${s.url}"`);
      }
    }
    lineas.push('---', '', cuerpo, '');

    writeFileSync(rutaSalida, lineas.join('\n'), 'utf-8');
    manifiesto[pagina.id] = basename(rutaSalida);
    importadas++;
    console.log(`${esNueva ? 'Importada' : 'Regenerada'}: ${rutaSalida}`);
  }

  cursor = respuesta.has_more ? respuesta.next_cursor : undefined;
} while (cursor);

// Páginas que estaban en el manifiesto pero no han aparecido en esta
// consulta (se borraron en Notion o se desmarcó "Publicar"): se ocultan sin
// borrar el archivo, igual que el resto del flujo de "ocultar sin eliminar".
for (const [id, archivo] of Object.entries(manifiesto)) {
  if (vistas.has(id)) continue;
  const ruta = join(DESTINO, archivo);
  if (!existsSync(ruta) || estaOculta(ruta)) continue;
  ocultar(ruta);
  ocultadas++;
  console.log(`Ocultada (ya no está en Notion o "Publicar" desmarcado): ${archivo}`);
}

writeFileSync(MANIFIESTO, JSON.stringify(manifiesto, null, 2) + '\n', 'utf-8');

console.log(`\nImportadas/regeneradas: ${importadas}`);
console.log(`Vinculadas sin sobrescribir: ${vinculadas}`);
console.log(`Ocultadas: ${ocultadas}`);
console.log(`Omitidas: ${omitidas}`);

// Importa el cuerpo de páginas fijas del sitio (Sobre mí, Ahora...) desde una
// base de datos de Notion, para poder editarlas ahí en vez de a mano en HTML.
//
// A diferencia de importar-entradas.mjs, aquí no se genera contenido nuevo ni
// se enruta por slug: cada página de Notion tiene un destino fijo en PAGINAS
// (más abajo), y su .astro correspondiente ya sabe cargar esa entrada de la
// colección `paginas`. Añadir una página nueva de este tipo es: crear la
// página en Notion, añadir una entrada en PAGINAS, y hacer que el .astro
// nuevo renderice `paginas/<slug>`.
//
// A diferencia también de importar-entradas.mjs, las listas con sub-elementos
// (habituales en "Sobre mí") sí se seleccionan de forma recursiva y se
// vuelcan como listas anidadas en Markdown.
//
// Preparación (una vez):
//   1. En la base de datos de Notion: ··· → Connections → conecta la misma
//      integración que ya usan importar-entradas.mjs / importar-citas.mjs.
//   2. Copia el ID de la base de datos (32 caracteres en la URL) a
//      NOTION_DATABASE_ID_PAGINAS en .env.
//
// Uso:
//   node --env-file=.env scripts/importar-paginas.mjs --inspeccionar
//     → lista las páginas de la base de datos y sus propiedades.
//
//   node --env-file=.env scripts/importar-paginas.mjs
//     → vuelca el cuerpo de cada página listada en PAGINAS a
//       src/content/paginas/<slug>.md, sobrescribiendo siempre: Notion es la
//       fuente de verdad para estas páginas, no hay edición manual que proteger.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(__dirname, '../src/content/paginas');

const TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID_PAGINAS;

if (!TOKEN || !DATABASE_ID) {
  console.error(
    'Faltan NOTION_TOKEN y/o NOTION_DATABASE_ID_PAGINAS.\n' +
      'Rellena .env (mira .env.example) y ejecuta con: node --env-file=.env scripts/importar-paginas.mjs'
  );
  process.exit(1);
}

// El nombre de la página en Notion (columna "Name"/título) → slug de salida
// en src/content/paginas/. Añade aquí cualquier página nueva de este tipo.
const PAGINAS = {
  'Sobre mí': 'sobre-mi',
  Ahora: 'ahora',
};

const flags = process.argv.slice(2);
const inspeccionar = flags.includes('--inspeccionar');

async function notion(path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const texto = await res.text();
    throw new Error(`Notion API ${res.status}: ${texto}`);
  }
  return res.json();
}

/** Envuelve un fragmento en un marcador Markdown sin pegarlo a espacios. */
function envolver(texto, marcador) {
  const coincidencia = texto.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const [, inicio, nucleo, fin] = coincidencia;
  if (!nucleo) return texto;
  return `${inicio}${marcador}${nucleo}${marcador}${fin}`;
}

/** Convierte un array de rich_text de Notion a texto plano en Markdown. Los
 * saltos de línea sueltos dentro de un mismo bloque (shift+intro en Notion)
 * se conservan como <br /> porque Markdown los ignoraría si no. */
function textoEnriquecido(richText) {
  if (!richText) return '';
  return richText
    .map((t) => {
      let texto = t.plain_text.replace(/\n/g, '<br />\n');
      if (t.annotations.code) texto = envolver(texto, '`');
      if (t.annotations.bold) texto = envolver(texto, '**');
      if (t.annotations.italic) texto = envolver(texto, '*');
      if (t.href && t.href !== t.plain_text) texto = `[${texto}](${t.href})`;
      return texto;
    })
    .join('');
}

function textoPlano(richText) {
  if (!richText) return '';
  return richText.map((t) => t.plain_text).join('');
}

function valorDe(pagina, nombrePropiedad) {
  const prop = pagina.properties[nombrePropiedad];
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
      return textoPlano(prop.title) || null;
    case 'rich_text':
      return textoPlano(prop.rich_text) || null;
    default:
      return null;
  }
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

/** Convierte un bloque de Notion a Markdown, recursivamente para las listas
 * con sub-elementos (indentación de 4 espacios por nivel). */
async function bloqueAMarkdown(bloque, nivel = 0) {
  const sangria = '    '.repeat(nivel);
  let linea;
  switch (bloque.type) {
    case 'paragraph':
      linea = textoEnriquecido(bloque.paragraph.rich_text);
      break;
    case 'heading_1':
      linea = `# ${textoEnriquecido(bloque.heading_1.rich_text)}`;
      break;
    case 'heading_2':
      linea = `## ${textoEnriquecido(bloque.heading_2.rich_text)}`;
      break;
    case 'heading_3':
      linea = `### ${textoEnriquecido(bloque.heading_3.rich_text)}`;
      break;
    case 'divider':
      linea = '---';
      break;
    case 'quote':
      linea = `> ${textoEnriquecido(bloque.quote.rich_text)}`;
      break;
    case 'bulleted_list_item':
      linea = `${sangria}- ${textoEnriquecido(bloque.bulleted_list_item.rich_text)}`;
      break;
    case 'numbered_list_item':
      linea = `${sangria}1. ${textoEnriquecido(bloque.numbered_list_item.rich_text)}`;
      break;
    case 'bookmark':
      linea = bloque.bookmark.url || '';
      break;
    default:
      console.log(`  (bloque de tipo "${bloque.type}" no soportado, se omite)`);
      return [];
  }

  const partes = linea ? [linea] : [];
  if (bloque.has_children) {
    const hijos = await obtenerBloques(bloque.id);
    const esItemDeLista = bloque.type === 'bulleted_list_item' || bloque.type === 'numbered_list_item';
    for (const hijo of hijos) {
      partes.push(...(await bloqueAMarkdown(hijo, esItemDeLista ? nivel + 1 : nivel)));
    }
  }
  return partes;
}

if (!existsSync(DESTINO)) mkdirSync(DESTINO, { recursive: true });

if (inspeccionar) {
  const db = await notion(`/databases/${DATABASE_ID}`);
  console.log(`Base de datos: ${db.title?.[0]?.plain_text ?? '(sin título)'}\n`);
  const respuesta = await notion(`/databases/${DATABASE_ID}/query`, { method: 'POST', body: '{}' });
  for (const pagina of respuesta.results) {
    const tituloProp = Object.entries(pagina.properties).find(([, p]) => p.type === 'title');
    const titulo = tituloProp ? textoPlano(tituloProp[1].title) : '(sin título)';
    const mapeada = PAGINAS[titulo] ? ` → paginas/${PAGINAS[titulo]}.md` : ' (sin destino en PAGINAS, se ignora)';
    console.log(`  - "${titulo}" (${pagina.id})${mapeada}`);
  }
  process.exit(0);
}

const respuesta = await notion(`/databases/${DATABASE_ID}/query`, { method: 'POST', body: '{}' });

let importadas = 0;
for (const pagina of respuesta.results) {
  const tituloProp = Object.entries(pagina.properties).find(([, p]) => p.type === 'title');
  const titulo = tituloProp ? textoPlano(tituloProp[1].title) : null;
  const slug = titulo && PAGINAS[titulo];
  if (!slug) {
    console.log(`Omitida (sin destino en PAGINAS): ${titulo ?? pagina.id}`);
    continue;
  }

  const bloques = await obtenerBloques(pagina.id);
  const partes = [];
  for (const bloque of bloques) {
    partes.push(...(await bloqueAMarkdown(bloque)));
  }
  const cuerpo = partes.join('\n\n');

  const contenido = ['---', `titulo: "${titulo.replace(/"/g, '\\"')}"`, '---', '', cuerpo, ''].join('\n');
  writeFileSync(join(DESTINO, `${slug}.md`), contenido, 'utf-8');
  importadas++;
  console.log(`Importada: paginas/${slug}.md`);
}

console.log(`\nImportadas: ${importadas} de ${Object.keys(PAGINAS).length} páginas esperadas.`);

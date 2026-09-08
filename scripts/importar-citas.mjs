// Importa citas desde una base de datos de Notion al tipo de entrada "cita".
//
// Preparación (una vez):
//   1. https://www.notion.so/my-integrations → New integration → copia el secret.
//   2. En tu base de datos de Notion: ··· → Connections → conecta la integración.
//   3. Copia el ID de la base de datos (32 caracteres en la URL, antes de "?v=").
//   4. Copia .env.example a .env y rellena NOTION_TOKEN y NOTION_DATABASE_ID.
//
// Uso:
//   node --env-file=.env scripts/importar-citas.mjs --inspeccionar
//     → lista las propiedades reales de tu base de datos (nombre y tipo),
//       para ajustar el mapeo de abajo (PROPIEDADES) a tus nombres exactos.
//
//   node --env-file=.env scripts/importar-citas.mjs
//     → genera un .md solo para las páginas de Notion que aún no se hayan
//       importado (lleva registro en importadas-citas.json, junto a este
//       script). Ejecutarlo varias veces es seguro: no duplica nada.
//
//   node --env-file=.env scripts/importar-citas.mjs --forzar
//     → además, regenera (sobrescribe) el .md de páginas ya importadas
//       previamente, por si ha cambiado el texto en Notion.
//
// Si una cita que ya se había importado deja de aparecer (se borra en
// Notion o se desmarca "Publicar"), su archivo NO se borra: se marca como
// `borrador: true` (oculto, igual que el resto del flujo de "ocultar sin
// eliminar"). Si vuelve a marcarse "Publicar", se recupera automáticamente
// en la siguiente ejecución, sin necesidad de --forzar.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(__dirname, '../src/content/entradas');
const MANIFIESTO = resolve(__dirname, 'importadas-citas.json');

const TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!TOKEN || !DATABASE_ID) {
  console.error(
    'Faltan NOTION_TOKEN y/o NOTION_DATABASE_ID.\n' +
      'Copia .env.example a .env, rellénalo, y ejecuta con: node --env-file=.env scripts/importar-citas.mjs'
  );
  process.exit(1);
}

// Ajusta estos nombres a como se llaman de verdad las columnas en tu base de
// datos de Notion (usa --inspeccionar para verlos). `cita` es obligatorio;
// el resto son opcionales (déjalos en null si no aplican).
const PROPIEDADES = {
  cita: 'Idea', // texto de la cita/idea (title)
  autor: 'Autor', // relation → autores (base de datos separada)
  autorUrl: null,
  obra: 'Libros', // relation → libros (base de datos separada)
  obraUrl: null,
  url: 'URL', // enlace genérico de fuente, cuando esté disponible
  fecha: null, // no existe; se usa la fecha de creación de la página
  publicar: 'Publicar', // checkbox — solo se importan las filas marcadas
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
    console.log(`  - "${nombre}" (${prop.type})`);
  }
  console.log(
    '\nAjusta el objeto PROPIEDADES en scripts/importar-citas.mjs con estos nombres exactos y vuelve a ejecutar sin --inspeccionar.'
  );
  process.exit(0);
}

/** Envuelve un fragmento en un marcador Markdown (** o `) sin dejar espacios
 * pegados al marcador, ya que eso impide que se interprete como énfasis
 * (p.ej. "texto. **" en vez de "texto **" con el asterisco pegado). */
function envolver(texto, marcador) {
  const coincidencia = texto.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const [, inicio, nucleo, fin] = coincidencia;
  if (!nucleo) return texto;
  return `${inicio}${marcador}${nucleo}${marcador}${fin}`;
}

/** Cuando dos fragmentos consecutivos de Notion comparten el mismo formato
 * (p.ej. dos runs seguidos en negrita), envolverlos por separado deja un
 * cierre pegado a una apertura del mismo marcador ("**text1****text2**"),
 * que no es Markdown válido. Como cerrar y volver a abrir inmediatamente el
 * mismo marcador no tiene efecto visual, se colapsan (a "**text1text2**"). */
function colapsarMarcadoresAdyacentes(texto) {
  return texto.replace(/\*\*\*\*/g, '').replace(/__/g, '').replace(/``/g, '');
}

/** Convierte un array de rich_text de Notion a texto plano en Markdown. */
function richTextAMarkdown(richText) {
  if (!richText) return '';
  const texto = richText
    .map((t) => {
      let texto = t.plain_text;
      if (t.annotations.code) texto = envolver(texto, '`');
      if (t.annotations.bold) texto = envolver(texto, '**');
      if (t.annotations.italic) texto = envolver(texto, '_');
      if (t.href) texto = `[${texto}](${t.href})`;
      return texto;
    })
    .join('');
  return colapsarMarcadoresAdyacentes(texto);
}

/** Extrae un valor de texto plano de una propiedad de Notion, sea cual sea su tipo. */
function valorDe(pagina, nombrePropiedad) {
  if (!nombrePropiedad) return null;
  const prop = pagina.properties[nombrePropiedad];
  if (!prop) return null;

  switch (prop.type) {
    case 'title':
      return richTextAMarkdown(prop.title) || null;
    case 'rich_text':
      return richTextAMarkdown(prop.rich_text) || null;
    case 'url':
      return prop.url || null;
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

/** Título de una página (busca la propiedad de tipo "title", sea cual sea su nombre). */
function tituloDePagina(pagina) {
  const prop = Object.values(pagina.properties).find((p) => p.type === 'title');
  return prop ? richTextAMarkdown(prop.title) || null : null;
}

const cachePaginas = new Map();

/** Resuelve una propiedad de tipo "relation": pide cada página relacionada y
 * devuelve los títulos unidos por coma. Requiere que la base de datos de
 * destino esté también compartida con la integración. */
async function resolverRelacion(pagina, nombrePropiedad) {
  if (!nombrePropiedad) return null;
  const prop = pagina.properties[nombrePropiedad];
  if (!prop || prop.type !== 'relation' || prop.relation.length === 0) return null;

  const titulos = [];
  for (const { id } of prop.relation) {
    if (!cachePaginas.has(id)) {
      cachePaginas.set(id, notion(`/pages/${id}`).then(tituloDePagina));
    }
    const titulo = await cachePaginas.get(id);
    if (titulo) titulos.push(titulo);
  }
  return titulos.length > 0 ? titulos.join(', ') : null;
}

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

if (!existsSync(DESTINO)) mkdirSync(DESTINO, { recursive: true });

const manifiesto = existsSync(MANIFIESTO)
  ? JSON.parse(readFileSync(MANIFIESTO, 'utf-8'))
  : {};

let importadas = 0;
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

    const rutaExistente = manifiesto[pagina.id]
      ? join(DESTINO, manifiesto[pagina.id])
      : null;
    // Si estaba oculta por una ejecución anterior en la que esta página no
    // tenía "Publicar" marcado, se regenera igualmente para recuperarla,
    // aunque no se pase --forzar.
    if (rutaExistente && !forzar && !estaOculta(rutaExistente)) {
      console.log(`Omitida (ya importada antes): ${pagina.id}`);
      omitidas++;
      continue;
    }

    const cita = valorDe(pagina, PROPIEDADES.cita);
    if (!cita) {
      console.log(`Omitida (sin texto de cita): ${pagina.id}`);
      omitidas++;
      continue;
    }

    const autor = await resolverRelacion(pagina, PROPIEDADES.autor);
    const autorUrl = valorDe(pagina, PROPIEDADES.autorUrl);
    const obra = await resolverRelacion(pagina, PROPIEDADES.obra);
    const obraUrl = valorDe(pagina, PROPIEDADES.obraUrl);
    const url = valorDe(pagina, PROPIEDADES.url);
    const fecha =
      valorDe(pagina, PROPIEDADES.fecha) || pagina.created_time.slice(0, 10);

    // Si ya importamos esta página antes (--forzar), reutiliza el mismo
    // archivo en vez de generar uno nuevo con sufijo.
    let rutaSalida;
    if (manifiesto[pagina.id]) {
      rutaSalida = join(DESTINO, manifiesto[pagina.id]);
    } else {
      const base = autor ? normalizar(autor) : normalizar(cita).slice(0, 40);
      let slug = base;
      rutaSalida = join(DESTINO, `${slug}.md`);
      let sufijo = 2;
      while (existsSync(rutaSalida)) {
        // Nombre ya usado por otra cita (misma persona u otra fila): añade sufijo.
        rutaSalida = join(DESTINO, `${slug}-${sufijo}.md`);
        sufijo++;
      }
    }

    const lineas = ['---', 'tipo: cita', `fecha: ${fecha}`];
    if (autor) lineas.push(`autor: "${autor.replace(/"/g, '\\"')}"`);
    if (autorUrl) lineas.push(`autorUrl: "${autorUrl}"`);
    if (obra) lineas.push(`obra: "${obra.replace(/"/g, '\\"')}"`);
    if (obraUrl) lineas.push(`obraUrl: "${obraUrl}"`);
    if (url) lineas.push(`url: "${url}"`);
    lineas.push('---', '', cita, '');

    writeFileSync(rutaSalida, lineas.join('\n'), 'utf-8');
    manifiesto[pagina.id] = rutaSalida.split(/[/\\]/).pop();
    importadas++;
    console.log(`Importada: ${rutaSalida}`);
  }

  cursor = respuesta.has_more ? respuesta.next_cursor : undefined;
} while (cursor);

// Citas que estaban en el manifiesto pero no han aparecido en esta consulta
// (se borraron en Notion o se desmarcó "Publicar"): se ocultan sin borrar
// el archivo, igual que el resto del flujo de "ocultar sin eliminar".
for (const [id, archivo] of Object.entries(manifiesto)) {
  if (vistas.has(id)) continue;
  const ruta = join(DESTINO, archivo);
  if (!existsSync(ruta) || estaOculta(ruta)) continue;
  ocultar(ruta);
  ocultadas++;
  console.log(`Ocultada (ya no está en Notion o "Publicar" desmarcado): ${archivo}`);
}

writeFileSync(MANIFIESTO, JSON.stringify(manifiesto, null, 2) + '\n', 'utf-8');

console.log(`\nImportadas: ${importadas}`);
console.log(`Ocultadas: ${ocultadas}`);
console.log(`Omitidas: ${omitidas}`);

// Borra los metadatos (EXIF, GPS, XMP, IPTC, comentarios...) de las imágenes
// que se publican en la web, para que nadie pueda sacar de ellas la ubicación
// donde se hizo la foto, la fecha o el modelo del móvil.
//
// No vuelve a comprimir la imagen: quita solo los bloques de metadatos, así
// que la calidad no cambia. Conserva lo que afecta a cómo se ve:
//   - el perfil de color (ICC),
//   - la orientación de las fotos del móvil (se reescribe un EXIF mínimo que
//     solo lleva ese dato, sin nada más).
// En los JPEG también descarta las imágenes secundarias que el iPhone añade
// tras el final de la principal (mapa de ganancia HDR, profundidad...).
//
// Formatos: JPEG, PNG y WebP (se reconocen por su contenido, no por la
// extensión). Los demás se dejan como están.
//
// Uso:
//   node scripts/limpiar-metadatos.mjs              → limpia public/
//   node scripts/limpiar-metadatos.mjs --comprobar  → solo avisa; termina con
//                                                     error si alguna imagen
//                                                     tiene metadatos
//   node scripts/limpiar-metadatos.mjs ruta1 ruta2  → limpia esas rutas
//
// Se ejecuta solo: al descargar portadas desde Notion (importar-entradas.mjs),
// antes de cada commit automático (publicar.mjs) y antes de construir la web
// en el despliegue (.github/workflows/deploy.yml).

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '../public');

// ---------------------------------------------------------------- JPEG

/** Lee la orientación (1-8) de un bloque APP1 Exif, o null si no hay. */
function orientacionExif(segmento) {
  // segmento = contenido del APP1 sin el marcador ni la longitud.
  if (segmento.toString('latin1', 0, 6) !== 'Exif\0\0') return null;
  const tiff = segmento.subarray(6);
  if (tiff.length < 8) return null;
  const le = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > tiff.length) return null;
    if (u16(e) === 0x0112) {
      const valor = u16(e + 8);
      return valor >= 1 && valor <= 8 ? valor : null;
    }
  }
  return null;
}

/** APP1 Exif mínimo que solo contiene la etiqueta Orientation. */
function app1SoloOrientacion(orientacion) {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // primer IFD
  tiff.writeUInt16BE(1, 8); // una entrada
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // un valor
  tiff.writeUInt16BE(orientacion, 18);
  tiff.writeUInt32BE(0, 22); // no hay más IFD
  const cuerpo = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const cabecera = Buffer.from([0xff, 0xe1, 0, 0]);
  cabecera.writeUInt16BE(cuerpo.length + 2, 2);
  return Buffer.concat([cabecera, cuerpo]);
}

function limpiarJpeg(datos) {
  const partes = [datos.subarray(0, 2)]; // SOI
  let orientacion = null;
  // El EXIF mínimo con la orientación va justo tras el SOI, o tras el APP0
  // JFIF si lo hay (el estándar lo quiere el primero).
  let posicionExif = 1;
  let p = 2;

  while (p < datos.length) {
    if (datos[p] !== 0xff) throw new Error('JPEG mal formado');
    const marcador = datos[p + 1];
    if (marcador === 0xff) {
      p++; // relleno
      continue;
    }
    if (marcador === 0xd9) {
      // EOI: fin de la imagen principal. Lo que venga detrás (imágenes
      // secundarias del iPhone, cada una con su propio EXIF) se descarta.
      partes.push(datos.subarray(p, p + 2));
      break;
    }
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      partes.push(datos.subarray(p, p + 2));
      p += 2;
      continue;
    }

    const longitud = datos.readUInt16BE(p + 2);
    const fin = p + 2 + longitud;
    const contenido = datos.subarray(p + 4, fin);
    const firma = contenido.toString('latin1', 0, 14);

    let conservar = true;
    if (marcador === 0xe1) {
      // Exif o XMP
      orientacion ??= orientacionExif(contenido);
      conservar = false;
    } else if (marcador === 0xe2) {
      conservar = firma.startsWith('ICC_PROFILE'); // fuera MPF / FlashPix
    } else if (marcador >= 0xe3 && marcador <= 0xef && marcador !== 0xee) {
      conservar = false; // APP3-APP13 (IPTC/Photoshop), APP15. APP14 (Adobe) se queda.
    } else if (marcador === 0xfe) {
      conservar = false; // COM
    }
    if (conservar) {
      partes.push(datos.subarray(p, fin));
      if (marcador === 0xe0 && firma.startsWith('JFIF') && partes.length === 2) {
        posicionExif = 2;
      }
    }
    p = fin;

    if (marcador === 0xda) {
      // SOS: datos comprimidos hasta el siguiente marcador que no sea
      // relleno (FF00) ni de reinicio (FFD0-FFD7).
      let q = p;
      while (q < datos.length - 1) {
        if (datos[q] === 0xff) {
          const siguiente = datos[q + 1];
          if (siguiente !== 0x00 && !(siguiente >= 0xd0 && siguiente <= 0xd7)) break;
        }
        q++;
      }
      partes.push(datos.subarray(p, q));
      p = q;
    }
  }

  if (orientacion && orientacion !== 1) {
    partes.splice(posicionExif, 0, app1SoloOrientacion(orientacion));
  }
  return Buffer.concat(partes);
}

// ---------------------------------------------------------------- PNG

const PNG_FUERA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function limpiarPng(datos) {
  const partes = [datos.subarray(0, 8)];
  let p = 8;
  while (p + 8 <= datos.length) {
    const longitud = datos.readUInt32BE(p);
    const tipo = datos.toString('latin1', p + 4, p + 8);
    const fin = p + 12 + longitud;
    if (!PNG_FUERA.has(tipo)) partes.push(datos.subarray(p, fin));
    p = fin;
    if (tipo === 'IEND') break;
  }
  return Buffer.concat(partes);
}

// ---------------------------------------------------------------- WebP

function limpiarWebp(datos) {
  const partes = [];
  let p = 12;
  while (p + 8 <= datos.length) {
    const tipo = datos.toString('latin1', p, p + 4);
    const longitud = datos.readUInt32LE(p + 4);
    const fin = p + 8 + longitud + (longitud % 2);
    if (tipo !== 'EXIF' && tipo !== 'XMP ') {
      const trozo = Buffer.from(datos.subarray(p, fin));
      // VP8X: quitar las marcas de "tiene EXIF" (0x08) y "tiene XMP" (0x04).
      if (tipo === 'VP8X') trozo[8] &= ~0x0c;
      partes.push(trozo);
    }
    p = fin;
  }
  const cuerpo = Buffer.concat(partes);
  const cabecera = Buffer.alloc(12);
  cabecera.write('RIFF', 0, 'latin1');
  cabecera.writeUInt32LE(cuerpo.length + 4, 4);
  cabecera.write('WEBP', 8, 'latin1');
  return Buffer.concat([cabecera, cuerpo]);
}

// ---------------------------------------------------------------- común

/** Devuelve los bytes sin metadatos, o null si el formato no se reconoce. */
export function limpiarDatos(datos) {
  if (datos[0] === 0xff && datos[1] === 0xd8) return limpiarJpeg(datos);
  if (datos.toString('latin1', 1, 4) === 'PNG') return limpiarPng(datos);
  if (
    datos.toString('latin1', 0, 4) === 'RIFF' &&
    datos.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return limpiarWebp(datos);
  }
  return null;
}

/**
 * Limpia un archivo en su sitio. Devuelve true si tenía metadatos (y, salvo
 * con soloComprobar, los ha quitado).
 */
export function limpiarArchivo(ruta, { soloComprobar = false } = {}) {
  const datos = readFileSync(ruta);
  const limpio = limpiarDatos(datos);
  if (!limpio || limpio.equals(datos)) return false;
  if (!soloComprobar) writeFileSync(ruta, limpio);
  return true;
}

function* recorrer(ruta) {
  if (statSync(ruta).isDirectory()) {
    for (const nombre of readdirSync(ruta)) yield* recorrer(join(ruta, nombre));
  } else if (/\.(jpe?g|png|webp)$/i.test(ruta)) {
    yield ruta;
  }
}

/** Limpia todas las imágenes de las rutas dadas (por defecto, public/). */
export function limpiarImagenes(rutas = [PUBLIC], opciones = {}) {
  const tocadas = [];
  for (const raiz of rutas) {
    for (const ruta of recorrer(raiz)) {
      if (limpiarArchivo(ruta, opciones)) tocadas.push(relative(process.cwd(), ruta));
    }
  }
  return tocadas;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const soloComprobar = args.includes('--comprobar');
  const rutas = args.filter((a) => !a.startsWith('--')).map((a) => resolve(a));
  const tocadas = limpiarImagenes(rutas.length ? rutas : undefined, { soloComprobar });

  if (!tocadas.length) {
    console.log('Ninguna imagen tiene metadatos.');
  } else if (soloComprobar) {
    console.error('Imágenes con metadatos (ejecuta npm run limpiar:imagenes):');
    for (const t of tocadas) console.error(`  - ${t}`);
    process.exit(1);
  } else {
    console.log('Metadatos borrados de:');
    for (const t of tocadas) console.log(`  - ${t}`);
  }
}

// Genera public/og.png: la imagen que se muestra al compartir el sitio en
// redes sociales (og:image / twitter:image). Se ejecuta a mano, no en cada
// build, porque depende de fuentes del sistema — así el resultado es
// predecible sin importar dónde se despliegue el sitio.
//
// Si cambias nombre, rol o lema en src/consts.ts, actualiza los valores de
// abajo y vuelve a ejecutar: node scripts/generar-og.mjs

import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NOMBRE = 'Fran Hidalgo-Barquero';
const ROL = 'Socio en Albia IMAP · Madrid';
const LEMA = 'Empresa, filosofía y tecnología';

const PAPEL = '#f1f2ef';
const TINTA = '#14181a';
const APAGADO = '#6e7671';
const LINEA = '#d7dad4';
const VERDIN = '#1e5c4f';

const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="${PAPEL}" />
  <rect x="90" y="0" width="1" height="630" fill="${LINEA}" />
  <rect x="86" y="132" width="8" height="24" fill="${VERDIN}" />
  <text x="130" y="152" font-family="Courier New, monospace" font-size="20" letter-spacing="4" fill="${APAGADO}">FRANHB.COM</text>
  <text x="128" y="296" font-family="Georgia, 'Times New Roman', serif" font-size="72" font-weight="700" fill="${TINTA}">${NOMBRE}</text>
  <text x="130" y="346" font-family="Arial, sans-serif" font-size="28" fill="${APAGADO}">${ROL}</text>
  <text x="130" y="420" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-style="italic" fill="${TINTA}">${LEMA}</text>
</svg>
`;

const salida = resolve(__dirname, '../public/og.png');
const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(salida, buffer);
console.log(`Generado ${salida} (${buffer.length} bytes)`);

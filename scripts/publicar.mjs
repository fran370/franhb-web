import { execSync } from 'node:child_process';
import { limpiarImagenes } from './limpiar-metadatos.mjs';

function git(comando) {
  return execSync(`git ${comando}`, { encoding: 'utf8' }).trim();
}

// Ninguna imagen se sube con metadatos (ubicación GPS, fecha, móvil...).
for (const ruta of limpiarImagenes()) console.log(`Metadatos borrados: ${ruta}`);

git('add -A');

const cambios = git('status --porcelain');
if (!cambios) {
  console.log('Nada nuevo que publicar.');
  process.exit(0);
}

const fecha = new Date().toISOString().slice(0, 16).replace('T', ' ');
git(
  `commit -q -m "Importa contenido desde Notion/Substack (${fecha})"`
);
git('push origin main');

console.log('Publicado: https://franhb.com');

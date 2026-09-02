import { execSync } from 'node:child_process';

function git(comando) {
  return execSync(`git ${comando}`, { encoding: 'utf8' }).trim();
}

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

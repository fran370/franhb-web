# franhb.com

Web personal en Astro. Un solo flujo cronológico con cinco tipos de entrada
(artículo, nota, MAweekly, enlace, cita), como joel.is, pero con identidad
propia. Contenido en markdown, sin base de datos, sin CMS.

---

## Arrancar en local

Necesitas Node 18.20 o superior.

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # genera dist/
npm run preview    # sirve dist/ para revisar antes de desplegar
```

---

## Escribir

Cada entrada es un archivo `.md` en `src/content/entradas/`. El nombre del
archivo es la URL: `multiplo-no-es-valoracion.md` → `/notas/multiplo-no-es-valoracion/`.

El campo `tipo` decide cómo se pinta la entrada y en qué sección aparece.

### Artículo

Ensayo largo. En el flujo se ve solo el titular y el resumen; se abre aparte.

```yaml
---
tipo: articulo
titulo: "Por qué se caen los procesos en la recta final"
fecha: 2026-08-18
resumen: "Una línea que enganche. Es lo que se ve en el índice y en el RSS."
sindicado:
  - red: LinkedIn
    url: https://www.linkedin.com/feed/update/urn:li:share:...
---
```

### Nota

El post corto que hoy publicarías directamente en LinkedIn. Se lee entero en el
índice. No lleva título.

```yaml
---
tipo: nota
fecha: 2026-08-21
---
```

### MAweekly

El número semanal. `operaciones` pinta la placa de operaciones; puedes omitirlo.

```yaml
---
tipo: maweekly
numero: 34
titulo: "MAweekly nº 34"
fecha: 2026-08-24
resumen: "..."
operaciones:
  - objetivo: "Grupo Ejemplo"
    comprador: "Fondo Ejemplo"
    sector: "Software industrial"
    importe: "≈ 45 M€"
---
```

### Enlace

Algo que has leído, con tu comentario debajo. El titular apunta fuera.

```yaml
---
tipo: enlace
titulo: "What Is Strategy?"
url: https://hbr.org/1996/11/what-is-strategy
fecha: 2026-08-05
---
```

### Cita

Del club de lectura o de lo que estés leyendo. El cuerpo va como `> blockquote`.

```yaml
---
tipo: cita
fecha: 2026-07-28
autor: "Peter F. Drucker"
obra: "The Effective Executive"
obraUrl: https://...
---
```

### Borradores

`borrador: true` en el frontmatter y la entrada desaparece del sitio publicado
sin salir del repositorio.

---

## El flujo desde Obsidian

Es exactamente lo que hace Joel, y encaja con cómo ya trabajas:

1. Abre `src/content/entradas/` como una bóveda de Obsidian (o crea un enlace
   simbólico desde tu bóveda actual a esa carpeta).
2. Escribes ahí en markdown, con las propiedades del frontmatter.
3. `git commit && git push`. Cloudflare reconstruye y publica en un minuto.

Con Claude Code puedes automatizar el último paso: un comando que valide el
frontmatter, haga commit y push, y te devuelva la URL publicada para pegarla en
LinkedIn.

---

## Publicar (Cloudflare Pages)

1. Sube el repositorio a GitHub.
2. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Configuración de build:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Output directory: `dist`
4. Despliega. Tendrás una URL `*.pages.dev` para validar.

### Mover franhb.com desde Notion

Ahora mismo `franhb.com` es un dominio personalizado apuntando a
`franhbj.notion.site`. Para cambiarlo sin ventana de caída:

1. Comprueba primero que el sitio funciona en la URL `*.pages.dev`.
2. En Notion, quita el dominio personalizado de la página.
3. En Cloudflare Pages → **Custom domains** → añade `franhb.com` y `www.franhb.com`.
4. Si el dominio ya está en Cloudflare, el DNS se configura solo. Si está en otro
   registrador, cambia los nameservers a Cloudflare o añade el CNAME que te indique.

La propagación suele tardar minutos. El contenido que tengas en Notion cópialo
antes a markdown: se pierde el acceso al ponerlo privado.

---

## La newsletter

El bloque de suscripción está en `src/components/Boletin.astro`. Cambia la
constante `ACCION` por la URL del formulario de tu proveedor:

- **Kit** (antes ConvertKit): gratis hasta 10.000 suscriptores, buena
  automatización. Recomendado para MAweekly.
- **Beehiiv**: mejor si algún día quieres monetizar o hacer referidos.
- **Buttondown**: el más simple y barato, escribes en markdown.

Todos te dan una URL de formulario que acepta un POST con el campo `email`.
Comprueba el nombre exacto del campo (`email_address` en Kit, `email` en la
mayoría) y ajústalo en el `<input name="...">`.

---

## POSSE: publicar aquí, replicar fuera

El campo `sindicado` guarda dónde has republicado cada entrada, y se pinta como
"También en LinkedIn" al pie. El orden importa: publica primero aquí, coge la
URL, y luego pega el texto en LinkedIn. Así el original vive en tu dominio y no
en la plataforma.

---

## Estructura

```
src/
  consts.ts             identidad, navegación, tipos de entrada
  content.config.ts     esquema del frontmatter (Zod: valida al construir)
  content/entradas/     tus .md — esto es todo el contenido del sitio
  components/           Cabecera, Filtros, Entrada, Boletin, Pie
  layouts/Base.astro    head, metadatos, fuentes
  pages/
    index.astro         el flujo completo
    [tipo]/index.astro  el flujo filtrado (/notas/, /articulos/...)
    [tipo]/[slug].astro la página de cada entrada
    rss.xml.js          el feed
  styles/global.css     todo el sistema visual, en tokens
```

## Pendientes antes de publicar

- [ ] Sustituir `public/fran.svg` por tu foto (`fran.jpg`, 400×400) y
      actualizar `SITIO.foto` en `src/consts.ts`
- [ ] Revisar URLs de `SOCIAL` en `src/consts.ts`
- [ ] Poner la URL real del formulario en `Boletin.astro`
- [ ] Borrar las seis entradas de ejemplo de `src/content/entradas/`
- [ ] Migrar de Notion los textos que quieras conservar

---

## Sistema visual

Todo el color y la tipografía sale de tokens en `:root`, al principio de
`global.css`. Cambiar la identidad es cambiar seis valores.

| Token       | Valor     | Uso                                       |
| ----------- | --------- | ----------------------------------------- |
| `--papel`   | `#F1F2EF` | fondo, blanco frío                        |
| `--tinta`   | `#14181A` | texto                                     |
| `--apagado` | `#6E7671` | metadatos, resúmenes                      |
| `--linea`   | `#D7DAD4` | reglas y bordes                           |
| `--verdin`  | `#1E5C4F` | acento: enlaces activos, artículos, botón |
| `--laton`   | `#B08D57` | la marca grabada de notas, enlaces, citas |

Tipografías: **Spectral** para el cuerpo, **IBM Plex Sans** para navegación,
**IBM Plex Mono** para fechas, etiquetas e importes. El modo oscuro va por
`prefers-color-scheme` y solo redefine los seis tokens.

# Importa los numeros nuevos de MAweekly desde el feed RSS de Substack y los
# publica (commit + push). Existe porque Cloudflare bloquea con un desafio
# anti-bot las peticiones al feed desde los runners de GitHub Actions, pero no
# desde una IP domestica.
#
# Trabaja en un clon propio (%LOCALAPPDATA%\franhb-web-sync) para no tocar los
# cambios sin commitear del repo de desarrollo. El push a main dispara solo el
# workflow "Publicar en GitHub Pages".
#
# Se ejecuta desde una tarea programada de Windows llamada
# "franhb-web MAweekly sync". Log (append): %LOCALAPPDATA%\franhb-web-sync.log

$ErrorActionPreference = 'Continue'

# El log es un transcript en modo append: la tarea corre sin ventana y, en ese
# contexto, escribir con Add-Content no llegaba a persistir; el transcript si.
$log = Join-Path $env:LOCALAPPDATA 'franhb-web-sync.log'
Start-Transcript -Path $log -Append | Out-Null

$remoto = 'https://github.com/fran370/franhb-web.git'
$clon = Join-Path $env:LOCALAPPDATA 'franhb-web-sync'

function Escribir($mensaje) {
  Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $mensaje"
}

# Ejecuta un comando nativo y aborta si termina con error.
function Ejecutar($descripcion, [scriptblock]$comando) {
  $salida = & $comando 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Escribir "ERROR en '$descripcion' (codigo $LASTEXITCODE): $salida"
    exit 1
  }
  return $salida
}

Escribir 'Inicio'

if (-not (Test-Path (Join-Path $clon '.git'))) {
  Ejecutar 'git clone' { git clone --quiet $remoto $clon } | Out-Null
}
Set-Location $clon

# El repo guarda LF; sin conversion no hay avisos de CRLF ni diffs falsos.
git config core.autocrlf false

Ejecutar 'git pull' { git pull --rebase --quiet origin main } | Out-Null

if (-not (Test-Path (Join-Path $clon 'node_modules'))) {
  Ejecutar 'npm ci' { npm ci --silent } | Out-Null
}

$salida = Ejecutar 'importar MAweekly' { node scripts/importar-maweekly-rss.mjs --forzar }
Escribir ($salida -split "`n" | Where-Object { $_ -match '^(Importados|Omitidos|  - )' } | Out-String).Trim()

git add src/content/entradas
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Escribir 'Sin cambios'
  exit 0
}

$fecha = Get-Date -Format 'yyyy-MM-dd HH:mm'
Ejecutar 'git commit' { git commit -q -m "Importa MAweekly desde Substack ($fecha)" } | Out-Null
Ejecutar 'git push' { git push --quiet origin main } | Out-Null
Escribir 'Publicado'

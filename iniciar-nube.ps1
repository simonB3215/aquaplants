# AquaPlants sin Docker: Supabase (PostgreSQL principal) + Neon (payloads crudos).
#   .\iniciar-nube.ps1 -Preparar   # primera vez: migraciones + datos de prueba en Supabase
#   .\iniciar-nube.ps1             # abre API (+worker), simulador y web en ventanas separadas
# Configuración en .env.nube (no se sube a git).
param([switch]$Preparar)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path .env.nube)) { throw 'Falta .env.nube' }
foreach ($linea in Get-Content .env.nube) {
  if ($linea -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}

npm run build:shared
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de @aquaplants/shared' }

if ($Preparar) {
  npm run db:migrate
  if ($LASTEXITCODE -ne 0) { throw 'Fallaron las migraciones' }
  npm run db:seed
  if ($LASTEXITCODE -ne 0) { throw 'Falló el seed' }
  Write-Host 'Base preparada. Ahora ejecute .\iniciar-nube.ps1' -ForegroundColor Green
  return
}

# Las ventanas heredan las variables de entorno cargadas arriba.
Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle='AquaPlants API'; npm run dev:api"
Start-Sleep 5
Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle='AquaPlants simulador'; npm run sim"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle='AquaPlants web'; npm run dev:web"
Write-Host 'Listo: abra http://localhost:5173 (cierre las 3 ventanas para detener)' -ForegroundColor Green

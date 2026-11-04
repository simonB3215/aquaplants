# (PowerShell 5.1: la salida de los ejecutables se envía a Out-Host para que quede en la transcripción.)
# Verificación de AquaPlants con Docker Desktop (Windows).
# Uso (PowerShell, dentro de esta carpeta):
#   powershell -ExecutionPolicy Bypass -File .\verificar.ps1
# Genera verificacion-docker.log y docs\evidencias\escenarios-e2e.json
Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot 'verificacion-docker.log'
Start-Transcript -Path $log -Force | Out-Null
"== AquaPlants: verificación Docker $(Get-Date -Format s) =="
if (-not (Test-Path .env)) { Copy-Item .env.example .env; "Se creó .env a partir de .env.example (cambie los secretos antes de producción)." }
docker version | Out-Host
docker compose version | Out-Host
"== Construyendo e iniciando (puede tardar varios minutos la primera vez) =="
docker compose --profile demo up -d --build 2>&1 | ForEach-Object { "$_" } | Out-Host
"== Esperando a la API =="
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $r = Invoke-RestMethod http://localhost:8080/api/v1/health -TimeoutSec 3; $r | ConvertTo-Json -Depth 5; if ($r.estado -eq 'ok') { $ok = $true; break } }
  catch { "esperando API... intento $i" }
  Start-Sleep -Seconds 5
}
docker compose --profile demo ps | Out-Host
"== Migraciones y seed =="
docker compose logs migrate --tail 40 | Out-Host
"== TimescaleDB =="
docker compose exec -T postgres psql -U aquaplants -d aquaplants -c "select extname, extversion from pg_extension;" -c "select hypertable_name from timescaledb_information.hypertables;" | Out-Host
if ($ok) {
  "== Escenarios E2E A-G (esperando 40 s a que el simulador envíe datos) =="
  Start-Sleep -Seconds 40
  docker run --rm --network aquaplants_edge -v "${PWD}\tests:/t" -v "${PWD}\docs:/docs" node:22-bookworm-slim node /t/e2e/escenarios.mjs http://web:8080/api/v1 | Out-Host
}
"== Registros recientes =="
docker compose logs api worker simulador web --tail 60 | Out-Host
"== Fin. Abra http://localhost:8080 =="
Stop-Transcript | Out-Null

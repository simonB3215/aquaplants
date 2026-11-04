#!/bin/sh
# Prueba de restauración CP-29 (ES2 Tabla 16) en contenedores LIMPIOS y efímeros
# (pg-prueba y mongo-prueba, perfil «restauracion»): nunca toca la base de producción.
#   docker compose --profile restauracion run --rm restaurar [carpeta_del_respaldo]
# 1) verifica SHA256SUMS; 2) descifra con la clave PRIVADA age (montada solo aquí);
# 3) pg_restore (con timescaledb_pre/post_restore) y mongorestore;
# 4) compara el conteo de filas por tabla y la última medición con los conteos
#    tomados en la misma instantánea del respaldo; 5) mide el tiempo frente al
#    RTO de 2 h y escribe el acta en /respaldos/actas/.
set -eu

: "${AGE_IDENTITY:=/claves/age-respaldo.key}"
[ -r "$AGE_IDENTITY" ] || { echo "No se encuentra la clave privada age en $AGE_IDENTITY" >&2; exit 2; }
RAIZ=/respaldos
DIR="${1:-}"
if [ -z "$DIR" ]; then DIR="$RAIZ/diario/$(ls -1 "$RAIZ/diario" | sort | tail -n 1)"; fi
case "$DIR" in /*) ;; *) DIR="$RAIZ/$DIR" ;; esac
[ -f "$DIR/SHA256SUMS" ] || { echo "No hay respaldo en $DIR" >&2; exit 2; }

T0=$(date +%s)
INICIO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "[restaurar] respaldo: $DIR"

echo "[restaurar] 1/4 suma SHA-256"
( cd "$DIR" && sha256sum -c SHA256SUMS )

echo "[restaurar] 2/4 PostgreSQL → pg-prueba"
export PGHOST=pg-prueba PGUSER=postgres PGDATABASE=aquaplants
for i in $(seq 1 60); do pg_isready -q -h pg-prueba && break; sleep 1; done
psql -q -X -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS aquaplants" -c "CREATE DATABASE aquaplants"
# Los roles son globales del servidor (no viajan en pg_dump) y los trabajos de TimescaleDB
# guardan su propietario: se crean sin LOGIN para restaurar también propietarios y permisos.
for rol in "${ROL_PROPIETARIO:?Defina ROL_PROPIETARIO}" app_rw app_ro backup_ro; do
  psql -q -X -d postgres -v ON_ERROR_STOP=1 -v rol="$rol" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN', :'rol') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'rol') \gexec
SQL
done
psql -q -X -d postgres -v ON_ERROR_STOP=1 -c "GRANT pg_read_all_data TO backup_ro"
psql -q -X -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS timescaledb" -c "SELECT timescaledb_pre_restore()" > /dev/null
age -d -i "$AGE_IDENTITY" "$DIR/postgres.dump.age" | pg_restore --exit-on-error -d aquaplants
psql -q -X -v ON_ERROR_STOP=1 -c "SELECT timescaledb_post_restore()" > /dev/null

echo "[restaurar] 3/4 MongoDB → mongo-prueba"
age -d -i "$AGE_IDENTITY" "$DIR/mongo.archive.gz.age" | mongorestore --uri="mongodb://mongo-prueba:27017" --archive --gzip --drop 2> /tmp/mongo.log
tail -n 2 /tmp/mongo.log
MONGO_RES=$(grep -o '[0-9]* document(s) restored successfully. [0-9]* document(s) failed to restore.' /tmp/mongo.log | tail -n 1)

echo "[restaurar] 4/4 comparación de conteos"
T1=$(date +%s)
DUR=$((T1 - T0))
mkdir -p "$RAIZ/actas"
ACTA="$RAIZ/actas/CP-29_$(date -u +%Y%m%dT%H%M%SZ).md"
ok=0; total=0; difs=0
TABLA=$(mktemp)
while IFS="$(printf '\t')" read -r tabla esperado; do
  case "$tabla" in '#ultima_medicion')
    obtenido=$(psql -X -At -c "SELECT COALESCE(max(ts)::text, '') FROM medicion")
    [ "$obtenido" = "$esperado" ] && r="OK" || { r="DIFERENTE"; difs=$((difs + 1)); }
    ULTIMA="| Última medición | $esperado | $obtenido | $r |"
    continue ;;
  esac
  obtenido=$(psql -X -At -c "SELECT count(*) FROM public.\"$tabla\"")
  total=$((total + 1))
  if [ "$obtenido" = "$esperado" ]; then ok=$((ok + 1)); r="OK"; else difs=$((difs + 1)); r="DIFERENTE"; fi
  echo "| $tabla | $esperado | $obtenido | $r |" >> "$TABLA"
done < "$DIR/conteos.tsv"

HIPER=$(psql -X -At -c "SELECT string_agg(hypertable_name, ', ') FROM timescaledb_information.hypertables")
JOBS=$(psql -X -At -c "SELECT string_agg(DISTINCT proc_name, ', ') FROM timescaledb_information.jobs WHERE proc_name LIKE 'policy%'")
[ "$difs" -eq 0 ] && [ "$DUR" -le 7200 ] && RES="APROBADA" || RES="RECHAZADA"

{
  echo "# Acta de prueba de restauración — CP-29"
  echo
  echo "- Fecha (UTC): $INICIO"
  echo "- Respaldo: \`$(basename "$DIR")\` (suma SHA-256 verificada)"
  echo "- Destino: contenedores limpios y efímeros \`pg-prueba\` (TimescaleDB 2.17.2-pg16) y \`mongo-prueba\` (MongoDB 7)"
  echo "- Tiempo total de restauración y verificación: **${DUR} s** (RTO objetivo: 7200 s = 2 h)"
  echo "- Tablas con conteo idéntico: **$ok / $total**"
  echo "- Hipertablas restauradas: $HIPER"
  echo "- Políticas TimescaleDB restauradas: $JOBS"
  echo "- MongoDB: ${MONGO_RES:-ver registro de mongorestore}"
  echo "- **Resultado: $RES**"
  echo
  echo "| Tabla | Filas en el respaldo | Filas restauradas | Resultado |"
  echo "|---|---:|---:|---|"
  cat "$TABLA"
  echo "${ULTIMA:-}"
} > "$ACTA"
rm -f "$TABLA"
cat "$ACTA"
echo "[restaurar] acta: $ACTA"
[ "$RES" = "APROBADA" ]

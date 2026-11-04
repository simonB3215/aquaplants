#!/bin/sh
# Respaldo lógico diario (ES2 §3.4, Tabla 16). Lo ejecuta el contenedor «backup»:
#   docker compose --profile backup run --rm backup
# · PostgreSQL: pg_dump -Fc con el rol backup_ro (solo lectura), dentro de una
#   instantánea REPEATABLE READ en la que también se cuentan las filas por tabla
#   (conteos.tsv): la prueba de restauración (CP-29) compara contra esos conteos.
# · MongoDB: mongodump --gzip con un usuario de solo lectura.
# · Todo se cifra con age (clave PÚBLICA AGE_RECIPIENT) en tubería: nunca se
#   escribe un respaldo sin cifrar en disco.
# · SHA256SUMS de los archivos cifrados; resultado en respaldo_registro (el worker
#   avisa por correo al Administrador si falla).
# · Rotación local: 7 diarios, 4 semanales (domingo) y 3 mensuales (día 1).
set -eu

: "${AGE_RECIPIENT:?Defina AGE_RECIPIENT (clave pública age) en .env: no se generan respaldos sin cifrar}"
: "${MONGO_BACKUP_URI:?Defina MONGO_BACKUP_URI}"
RAIZ=/respaldos
INICIO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SELLO=$(date -u +%Y%m%dT%H%M%SZ)
DIR="$RAIZ/diario/$SELLO"
TMP=$(mktemp -d)
ERR="$TMP/errores.log"
: > "$ERR"

registrar() { # $1 estado  $2 archivos(json)  $3 detalle
  psql -v ON_ERROR_STOP=1 -q -X \
    -v estado="$1" -v archivos="$2" -v detalle="$3" -v inicio="$INICIO" <<'SQL' || echo "[respaldo] AVISO: no se pudo escribir respaldo_registro" >&2
INSERT INTO respaldo_registro (iniciado_en, estado, archivos, detalle)
VALUES (:'inicio', :'estado', :'archivos'::jsonb, NULLIF(:'detalle', ''));
SQL
}

fallar() {
  FALLADO=1
  # Nunca registrar credenciales: se ocultan «usuario:clave@» de cualquier URI.
  detalle="$1: $(tail -c 400 "$ERR" | tr '\n' ' ' | sed -E 's#://[^/@ ]+@#://***@#g')"
  echo "[respaldo] FALLÓ — $detalle" >&2
  rm -rf "$DIR" "$TMP"
  registrar fallido '[]' "$detalle"
  exit 1
}
# Cualquier otro error (set -e) también queda registrado como fallido.
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ -z "${FALLADO:-}" ]; then fallar "error inesperado (código $rc)"; fi' EXIT

mkdir -p "$DIR"
echo "[respaldo] inicio $INICIO → $DIR"

# --- PostgreSQL: conteos y pg_dump en la MISMA instantánea --------------------
psql -v ON_ERROR_STOP=1 -q -X -At 2>>"$ERR" <<SQL || fallar "pg_dump"
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS snap \gset
\setenv SNAP :snap
\o $DIR/conteos.tsv
SELECT t.table_name, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.table_name), false, true, '')))[1]::text
  FROM information_schema.tables t
 WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
 ORDER BY 1;
SELECT '#ultima_medicion', COALESCE(max(ts)::text, '') FROM medicion;
\o
\! sh -c 'set -o pipefail; pg_dump -Fc --snapshot="\$SNAP" | age -r "\$AGE_RECIPIENT" > "$DIR/postgres.dump.age"; echo \$? > "$TMP/pg_status"' 2>>"$ERR"
COMMIT;
SQL
[ "$(cat "$TMP/pg_status" 2>/dev/null)" = "0" ] || fallar "pg_dump"
sed -i 's/|/\t/' "$DIR/conteos.tsv"
: > "$ERR"   # pg_dump terminó bien: sus avisos (FK circulares del catálogo de TimescaleDB) no son errores

# --- MongoDB ------------------------------------------------------------------
( set -o pipefail; mongodump --uri="$MONGO_BACKUP_URI" --archive --gzip 2>>"$ERR" | age -r "$AGE_RECIPIENT" > "$DIR/mongo.archive.gz.age" ) || fallar "mongodump"

# --- Integridad ---------------------------------------------------------------
( cd "$DIR" && sha256sum postgres.dump.age mongo.archive.gz.age conteos.tsv > SHA256SUMS )
archivos=$(cd "$DIR" && for f in postgres.dump.age mongo.archive.gz.age conteos.tsv; do
  printf '{"nombre":"%s","bytes":%s,"sha256":"%s"}\n' "$f" "$(wc -c < "$f" | tr -d ' ')" "$(grep " $f\$" SHA256SUMS | cut -d' ' -f1)"
done | paste -sd, -)
registrar ok "[$archivos]" "$SELLO"

# --- Rotación (Tabla 16: 7 diarios, 4 semanales, 3 mensuales) ------------------
[ "$(date -u +%u)" = "7" ] && mkdir -p "$RAIZ/semanal" && cp -r "$DIR" "$RAIZ/semanal/"
[ "$(date -u +%d)" = "01" ] && mkdir -p "$RAIZ/mensual" && cp -r "$DIR" "$RAIZ/mensual/"
podar() { # $1 carpeta  $2 cuántos conservar
  [ -d "$1" ] || return 0
  ls -1 "$1" | sort -r | tail -n +"$(($2 + 1))" | while read -r d; do rm -rf "${1:?}/$d"; done
}
podar "$RAIZ/diario" 7; podar "$RAIZ/semanal" 4; podar "$RAIZ/mensual" 3

rm -rf "$TMP"
echo "[respaldo] OK $SELLO"
cat "$DIR/SHA256SUMS"
du -sh "$DIR" | cut -f1 | sed 's/^/[respaldo] tamaño: /'

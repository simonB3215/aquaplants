#!/bin/sh
# Restauración en una base LIMPIA: ./restaurar.sh /respaldos/archivo.dump
# Verifica la suma SHA-256 y compara conteos (CP-29).
set -eu
f="$1"
sha256sum -c "$f.sha256"
createdb aquaplants_restaurada 2>/dev/null || true
pg_restore --no-owner -d aquaplants_restaurada "$f"
psql -d aquaplants_restaurada -c "SELECT (SELECT count(*) FROM medicion) AS mediciones, (SELECT max(ts) FROM medicion) AS ultima, (SELECT count(*) FROM log_auditoria) AS auditoria"

#!/bin/sh
# Respaldo lógico de PostgreSQL (pg_dump -Fc) con suma SHA-256 (Tabla 16).
# El respaldo de MongoDB (payload crudo, TTL 90 días) se documenta en docs/RESPALDOS.md.
set -eu
f="/respaldos/aquaplants_$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump -Fc -f "$f"
sha256sum "$f" > "$f.sha256"
echo "Respaldo creado: $f ($(du -h "$f" | cut -f1))"; cat "$f.sha256"

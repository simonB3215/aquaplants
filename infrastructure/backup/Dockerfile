# Imagen de respaldo/restauración: mismas herramientas cliente que el servidor
# (pg_dump 16 + TimescaleDB 2.17.2), mongodump/mongorestore y age (cifrado).
FROM timescale/timescaledb:2.17.2-pg16
RUN apk add --no-cache age mongodb-tools

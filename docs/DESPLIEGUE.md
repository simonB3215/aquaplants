# Despliegue, respaldos y restauración

> «Preparado para desplegar» ≠ «desplegado». Este proyecto **no** ha sido desplegado en la nube en esta sesión.

## Cloud (estrategia ES2: droplet DigitalOcean + Docker Compose)
1. Droplet Ubuntu LTS (2 vCPU / 4 GiB), firewall: 443 y 80 públicos, 22 solo desde la IP del administrador.
2. Instalar Docker Engine + Compose; clonar el repositorio; crear `.env` con secretos nuevos, `NODE_ENV=production`, `DEMO_MODE=false`, `SEMBRAR_DATOS_PRUEBA=false`.
3. `docker compose up -d --build` (sin perfil `demo`).
4. TLS: colocar delante un Nginx/Caddy con certificado Let's Encrypt (TLS 1.3 preferido, HSTS) que haga proxy a `web:8080`, o agregar un bloque `listen 443 ssl` en `infrastructure/nginx/aquaplants.conf` con los certificados montados.
5. Crear el primer Administrador: ejecutar el seed solo en un entorno controlado o insertar el usuario con un hash bcrypt y `debe_cambiar_password = true`.
6. Configurar SMTP para alertas críticas (opcional, RF-11).

## Roles de base de datos (ES2 §3.4)
| Rol | Lo usa | Privilegios |
|---|---|---|
| superusuario del compose (`POSTGRES_USER`) | **solo** el servicio `migrate` | crea el esquema y asigna LOGIN a los roles |
| `app_rw` | API y worker (`DB_APP_PASSWORD`) | SELECT/INSERT/UPDATE; DELETE solo en `usuario_instalacion`; **sin** UPDATE/DELETE en `log_auditoria` ni `medicion_evidencia`; sin CREATE |
| `app_ro` | consultas de solo lectura (opcional, `DB_RO_PASSWORD`) | SELECT |
| `backup_ro` | contenedor de respaldo (`DB_BACKUP_PASSWORD`) | `pg_read_all_data` + INSERT en `respaldo_registro` |

`database/permisos.sql` se aplica al final de **cada** migración (idempotente), así cubre también las tablas nuevas. MongoDB: usuario `MONGO_APP_USER` (readWrite en `aquaplants`) y `MONGO_BACKUP_USER` (read en `aquaplants`); el servicio `mongo-usuarios` los asegura en cada arranque.

## Respaldo cifrado (ES2 Tabla 16)
1. **Una sola vez**: generar el par de claves age y dejar en el servidor solo la pública.
   ```bash
   docker compose --profile backup build backup
   docker compose --profile backup run --rm --entrypoint age-keygen backup -o /respaldos/age-respaldo.key
   ```
   Copiar la línea `# public key: age1…` a `AGE_RECIPIENT` en `.env` y **mover `age-respaldo.key` fuera del servidor** (gestor de contraseñas). Sin la clave privada los respaldos no se pueden leer; si se pierde, los respaldos son irrecuperables.
2. Respaldo (cron del host, 02:00):
   ```bash
   docker compose --profile backup run --rm backup
   ```
   Crea `respaldos/diario/<fecha>/` con `postgres.dump.age` (pg_dump -Fc), `mongo.archive.gz.age` (mongodump --gzip), `conteos.tsv` (filas por tabla en la **misma instantánea** del pg_dump) y `SHA256SUMS`. El cifrado es en tubería: nunca hay un respaldo sin cifrar en disco. Rotación local: 7 diarios, 4 semanales (domingo) y 3 mensuales (día 1).
3. Cada ejecución queda en la tabla `respaldo_registro` (tamaño y SHA-256 por archivo). Si falla, el worker programa un correo a cada Administrador activo (`respaldo_fallido`).
4. **Pendiente de la nube**: subir la carpeta a un bucket privado (DigitalOcean Spaces en el ES2) con regla de ciclo de vida. Requiere el despliegue, aún no autorizado.

## Restauración (prueba CP-29)
```bash
docker compose --profile restauracion run --rm restaurar            # último respaldo diario
docker compose --profile restauracion run --rm restaurar diario/<fecha>
docker compose --profile restauracion down                            # elimina los contenedores de prueba
```
Restaura en contenedores **limpios y efímeros** (`pg-prueba`, `mongo-prueba`: tmpfs, red interna propia; nunca toca la base real): verifica `SHA256SUMS`, descifra con la clave privada (`AGE_IDENTITY_DIR`, por defecto `./secretos`, montada solo en este servicio), ejecuta `pg_restore` entre `timescaledb_pre_restore()` y `timescaledb_post_restore()`, `mongorestore`, compara las filas de cada tabla con `conteos.tsv` y la última medición, mide el tiempo frente al RTO de 2 h y escribe el acta en `respaldos/actas/CP-29_<fecha>.md`.

**Restaurar en producción** (recuperación ante caída, Tabla 16): con la base vacía, `docker compose up -d postgres mongo`, luego en un contenedor `restaurar` apuntado a `postgres`/`mongo` (variables `PGHOST`, `PGUSER` superusuario) seguir los mismos pasos 2–3 del script; después `docker compose up -d` (las migraciones detectan el esquema ya aplicado y reasignan permisos).

## TimescaleDB: políticas (Tabla 40)
- `002_timescale.sql`: `medicion` es hipertabla (chunks de 7 días).
- `005_evidencia_alertas.sql`: al generarse una alerta, su medición se copia a `medicion_evidencia` (inmutable) en la misma transacción; la FK de `alerta` apunta a la evidencia (D-24).
- `008_timescale_politicas.sql`: compresión de chunks con más de 7 días (segmentados por sensor), retención de 2 años, agregado continuo `medicion_hora` (promedio/mín/máx por sensor y hora, refresco horario de los últimos 3 días) con retención de 5 años.
- `006_anonimizacion_usuarios.sql` + worker: nombre y email de usuarios desactivados se anonimizan al año (Ley 19.628); se conserva el id para la auditoría.
- Consultar los trabajos: `SELECT * FROM timescaledb_information.jobs;` y su última ejecución en `timescaledb_information.job_stats`.

## Dispositivo físico futuro
El simulador implementa la cola como archivos con `fsync` + `rename` atómico. En un AquaBrain real (ESP32 u otro compatible) la misma lógica se adapta a **LittleFS** en flash: un archivo por lote, borrar solo tras 201/200-duplicado, registro de descartes, NTP antes de enviar, reinicio seguro validando la cola. La cifra de 512 KB ≈ 40 h es un supuesto a verificar con el tamaño real del lote.

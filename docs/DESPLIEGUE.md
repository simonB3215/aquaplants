# Despliegue, respaldos y restauración

> Desde la sesión 4 (D-29) el proyecto **no usa Docker**: la base principal está en **Supabase** y los payloads crudos en **Neon**; la API (+ worker), el simulador y la web se ejecutan con `iniciar-nube.ps1` (ver README). En la sesión 5 se **eliminaron del repositorio** `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `verificar.ps1` e `infrastructure/` (Nginx, usuarios de MongoDB, contenedores de respaldo y restauración). Siguen en el historial de git (commit `885105d`) por si el equipo los necesita.

## Bases de datos
- **Supabase** (PostgreSQL 17): esquema con `npm run db:migrate` (`.\iniciar-nube.ps1 -Preparar` la primera vez). Sin TimescaleDB: `002` y `008` se omiten y quedan registradas como omitidas en `schema_migraciones`.
- **Neon** (PostgreSQL): `PgPayloadStore` crea sus tablas (`payload_telemetria`, `detalle_evento`) al conectarse y borra los payloads de más de 90 días.
- TLS verificado (`sslmode=verify-full`); la CA de Supabase va en `secretos/supabase-ca.crt` (fuera de git).

## Roles de base de datos (ES2 §3.4)
| Rol | Lo usa | Privilegios |
|---|---|---|
| superusuario | **solo** `npm run db:migrate` | crea el esquema y asigna LOGIN a los roles |
| `app_rw` | API y worker (`DB_APP_PASSWORD`) | SELECT/INSERT/UPDATE; DELETE solo en `usuario_instalacion` y `registro_pendiente`; **sin** UPDATE/DELETE en `log_auditoria` ni `medicion_evidencia`; sin CREATE |
| `app_ro` | consultas de solo lectura (opcional, `DB_RO_PASSWORD`) | SELECT |
| `backup_ro` | respaldos (`DB_BACKUP_PASSWORD`) | `pg_read_all_data` + INSERT en `respaldo_registro` |

`database/permisos.sql` se aplica al final de **cada** migración (idempotente). **Pendiente**: `.env.nube.example` conecta la API con el usuario `postgres` de Supabase; para cumplir D-27 la API debería usar `app_rw`.

## Respaldo y restauración (ES2 Tabla 16, CP-29)
El respaldo cifrado con `age` y la prueba de restauración (D-26, CP-29 aprobada en la sesión 3) se ejecutaban en contenedores Docker y **se retiraron**. Con Supabase + Neon queda **pendiente** definir el respaldo (copias del proveedor según el plan contratado, o `pg_dump` cifrado programado desde un PC/servidor) y repetir la prueba de restauración. El aviso por correo `respaldo_fallido` del worker sigue disponible si se registra un respaldo fallido en `respaldo_registro`.

## TimescaleDB: políticas (Tabla 40)
Solo aplican en un PostgreSQL con TimescaleDB (Supabase no la ofrece):
- `002_timescale.sql`: `medicion` es hipertabla (chunks de 7 días).
- `008_timescale_politicas.sql`: compresión de chunks con más de 7 días, retención de 2 años, agregado continuo `medicion_hora` con retención de 5 años.

Aplican siempre:
- `005_evidencia_alertas.sql`: al generarse una alerta, su medición se copia a `medicion_evidencia` (inmutable) en la misma transacción (D-24).
- `006_anonimizacion_usuarios.sql` + worker: nombre y email de usuarios desactivados se anonimizan al año (Ley 19.628); se conserva el id para la auditoría.

## Dispositivo físico futuro
El simulador implementa la cola como archivos con `fsync` + `rename` atómico. En un AquaBrain real (ESP32 u otro compatible) la misma lógica se adapta a **LittleFS** en flash: un archivo por lote, borrar solo tras 201/200-duplicado, registro de descartes, NTP antes de enviar, reinicio seguro validando la cola. La cifra de 512 KB ≈ 40 h es un supuesto a verificar con el tamaño real del lote.

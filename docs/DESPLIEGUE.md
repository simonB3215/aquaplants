# Despliegue, respaldos y restauración

> Desde la sesión 4 (D-29) el proyecto **no usa Docker**: la base principal está en **Supabase** y los payloads crudos en **Neon**; la API (+ worker), el simulador y la web se ejecutan con `iniciar-nube.ps1` (ver README). En la sesión 5 se **eliminaron del repositorio** `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `verificar.ps1` e `infrastructure/` (Nginx, usuarios de MongoDB, contenedores de respaldo y restauración). Siguen en el historial de git (commit `885105d`) por si el equipo los necesita.

## Publicación: Render + Supabase + Netlify (D-30)
| Pieza | Dónde | Archivo |
|---|---|---|
| Web (PWA) | **Netlify** | `netlify.toml`: compila `packages/frontend` y reenvía `/api/*` a Render (mismo origen para el navegador) |
| API + worker | **Render** (`aquaplants-api`) | `render.yaml` |
| Simulador (AquaBrain virtuales) | **Render** (`aquaplants-simulador`) | `render.yaml` |
| Base principal | **Supabase** | ya preparada con `.\iniciar-nube.ps1 -Preparar` |
| Payloads crudos | **Neon** | tablas creadas por la API al conectarse |

Pasos (cada uno con la cuenta del equipo; las claves nunca se suben a git):
1. **Render** → New → **Blueprint** → este repositorio. Completar las variables `sync: false`:
   - `DATABASE_URL`: la de Supabase (**Session pooler**, no «Direct») terminada en `?sslmode=verify-full&sslrootcert=certificados/supabase-ca.crt`; `PAYLOADS_DATABASE_URL`: la de Neon.
   - `CORS_ORIGIN` y `APP_URL`: la URL de Netlify (p. ej. `https://aquaplants-app.netlify.app`).
   - `DEMO_ENCARGADO_PASSWORD`, `NOTIFICACIONES_SOLO_A` y `RESEND_API_KEY`. **Render free bloquea la salida SMTP** (puertos 25/465/587: los avisos fallaban con «Connection timeout»), así que en Render el correo sale por la API HTTP de Resend (resend.com, plan gratuito 100 correos/día). Sin dominio propio el remitente es `onboarding@resend.dev` y Resend solo entrega al correo con el que se creó la cuenta: crearla con el mismo correo de `NOTIFICACIONES_SOLO_A`. `SMTP_*` sigue sirviendo en local.
   - Simulador: `API_URL` = `https://aquaplants-api.onrender.com/api/v1` (directo a la API de Render).
2. **Secret File** en Render (Environment → Secret Files): en `aquaplants-simulador` el archivo `dispositivos.json` (el que generó el seed en `packages/simulador/data/`). El certificado de Supabase ya viene en el repositorio.
3. **Netlify** → Add new site → Import from Git → este repositorio (toma `netlify.toml`). Si Render asignó otra URL a la API, cambiarla en el `[[redirects]]` de `/api/*`.
4. Comprobar: `https://<netlify>/api/v1/health` = ok; iniciar sesión; menú Demostración → escenario A.

Límites del plan gratuito (a tener en cuenta en la presentación):
- Los servicios de Render se **duermen tras 15 min sin tráfico** y tardan ~1 min en despertar: abrir la app y la página Demostración unos minutos antes. Mientras duerme la API tampoco corre el worker (alertas, «sin señal»).
- **Día de presentación:** GitHub → Actions → «Mantener despierto» → *Run workflow* con las horas (1–24). Llama al simulador y al API cada 10 min y se detiene solo al cumplirlas (para cortar antes, cancelar la ejecución). Un día completo consume ~48 h de las 750 h/mes de Render y ~27 MB de Supabase (sin TimescaleDB no hay retención automática: no dejarlo prendido semanas, el plan free tiene 500 MB).
- El disco de Render no es permanente: si reinicia el simulador, su cola local se pierde (en la demo, el escenario E/F se hace con los botones, no reiniciando el servicio).
- Render gratis da 750 h al mes para todos los servicios: dos servicios despiertos todo el mes no alcanzan.
- `NODE_ENV=development` porque `DEMO_MODE` se niega a correr en producción (demo aislada). Para una instalación real: `NODE_ENV=production`, `DEMO_MODE=false` y sin simulador.
- `TRUST_PROXY=2` (Netlify + Render) para que los límites por IP vean al cliente real. Quien llame directo a la URL de Render podría falsear su IP ante esos límites; el bloqueo por cuenta (`LOGIN_MAX_INTENTOS`) sigue aplicando.

## Bases de datos
- **Supabase** (PostgreSQL 17): esquema con `npm run db:migrate` (`.\iniciar-nube.ps1 -Preparar` la primera vez). Sin TimescaleDB: `002` y `008` se omiten y quedan registradas como omitidas en `schema_migraciones`.
- **Neon** (PostgreSQL): `PgPayloadStore` crea sus tablas (`payload_telemetria`, `detalle_evento`) al conectarse y borra los payloads de más de 90 días.
- TLS verificado (`sslmode=verify-full`) con el certificado **público** de Supabase en `certificados/supabase-ca.crt` (raíz «Supabase Root 2021 CA», sin clave privada; vence en 2031). La ruta es relativa: el backend la resuelve desde la raíz del repositorio, así funciona en cualquier computador y en Render. Supabase tiene activado «Enforce SSL».
- Usar el **Session pooler** (`aws-0-us-east-1.pooler.supabase.com`, usuario `postgres.<ref>`): la conexión «Direct» (`db.<ref>.supabase.co`) es solo IPv6 y no resuelve desde muchas redes ni desde Render.

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

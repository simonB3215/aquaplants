# Registro de pruebas

## Sesión 2 — 2026-11-03, PC Windows 11 del usuario (Docker Desktop 29.9.2)

Primera ejecución con las bases reales: **TimescaleDB 2.17.2 (PostgreSQL 16) y MongoDB 7.0**, tanto en CI como en Docker Compose. Las limitaciones de la sesión 1 (sin TimescaleDB, FerretDB en vez de MongoDB, Compose nunca construido) quedan resueltas.

| Verificación | Dónde | Resultado | Evidencia |
|---|---|---|---|
| CI GitHub Actions (`npm ci`, typecheck, `npm test`, build frontend, audit) | `simonB3215/aquaplants` (privado), servicios `timescale/timescaledb:2.17.2-pg16` + `mongo:7.0` | 1.ª ejecución ✖ (48/48 backend fallaron, defecto 6); tras la corrección **✔ verde** en los commits `c94b0f6` y `f749ffd` | `gh run list` (runs 41748189521, 41751252016) |
| `npm test` local contra TimescaleDB 2.17.2 + MongoDB 7.0 (contenedores) | PC del usuario | **66/66 ✔** (shared 6, backend 50 = 48 + 2 nuevas del notificador, simulador 6, frontend 4) | `evidencias/pruebas-backend.json` |
| CP-28 Despliegue desde cero con Docker Compose | `docker compose --profile demo down -v` + `verificar.ps1` | **✔** build de las 3 imágenes, `migrate` aplica 001 y 002 + seed, los 7 servicios arriba, `/health` = ok (PostgreSQL ok, MongoDB ok, `timescaledb: true`) | `verificacion-docker.log` (local, no versionado) |
| Hipertabla TimescaleDB con FK desde `alerta` | `timescaledb_information.hypertables` | **✔** extensión 2.17.2, hipertabla `medicion` | idem |
| Usuario de aplicación de MongoDB (`init-usuario.js`) | API conectada con `aquaplants_app` | **✔** `mongodb: ok` en `/health`, telemetría almacenada | idem |
| Simulador lee `/simconfig/dispositivos.json` | contenedor `simulador` | **✔** 3 dispositivos enviando (escenario A) | idem |
| Escenarios E2E A–G dentro de la red Docker | `tests/e2e/escenarios.mjs` vía `http://web:8080/api/v1` | **8/8 ✔** (tras corregir defectos 7–9) | `evidencias/escenarios-e2e.json` |
| App en http://localhost:8080 | navegador integrado | **✔** login de Administrador y panel con datos reales del simulador | — |
| PWA (Service Worker) en Docker | navegador integrado | **No verificada**: `sw.js` se sirve bien (200, `application/javascript`, `no-cache`) pero el navegador integrado no permite registrar Service Workers | — |
| CP-12 Correo de alerta crítica | Docker, worker → `smtp.gmail.com:587` (STARTTLS, contraseña de aplicación) | **✔ envío aceptado por Gmail**: autenticación verificada; escenario B → alerta crítica #7 generada 01:19:59 UTC y `notificacion_estado = enviada` al 1.er intento (~16 s, límite 5 min). Destino único `simon.bueguenio@gmail.com`. **Recepción confirmada por el usuario** el 2026-11-03 | tabla `alerta` (#7); confirmación del usuario |
| `npm audit --omit=dev` | local | **9 vulnerabilidades (1 moderada, 8 altas)** en express/qs/path-to-regexp y zod; no corregidas (requieren actualizaciones mayores) | — |

### Preparación de CP-12 (SMTP)
- Nueva variable solo de demo `NOTIFICACIONES_SOLO_A`: si se define, **todos** los avisos van únicamente a esa dirección (asunto con prefijo `[DEMO]` y el texto indica a quién habría correspondido). Motivo: los usuarios sembrados tienen correos ficticios `@aquaplants.cl`; con SMTP real los avisos saldrían a un dominio ajeno. Prueba unitaria en `packages/backend/test/notificador.test.ts`.
- En el `.env` local (no versionado): `NOTIFICACIONES_SOLO_A=simon.bueguenio@gmail.com`; remitente la misma cuenta. La contraseña de aplicación la puso el usuario (nunca pasó por el chat ni por archivos versionados).
- Procedimiento ejecutado: `docker compose up -d api worker` → `transport.verify()` OK → el Supervisor resuelve la alerta crítica activa #1 (una alerta por situación) → escenario B en AquaBrain-B (pH, sensor 6) → alerta #7 `enviada` → escenario A para volver a la normalidad.

### Aviso por correo al cambiar la contraseña (nuevo, sesión 2)
| Prueba | Resultado |
|---|---|
| Integración (Jest): cambio de contraseña → 200 `{aviso_correo}`; un aviso `pendiente` con el nombre del titular y **sin** la contraseña nueva ni la anterior | ✔ |
| Integración: dos procesos del worker en paralelo → el aviso se envía **una sola vez** (`FOR UPDATE SKIP LOCKED`) y queda `enviada` | ✔ |
| Integración: contraseña actual incorrecta → 422 y ningún aviso nuevo | ✔ |
| Integración: sin SMTP → `no_configurada`, nunca `enviada` | ✔ |
| Real (Docker + Gmail): migración `003` aplicada sobre la base existente; usuario temporal `prueba-aviso@aquaplants.cl` cambia su contraseña desde la UI (Perfil) → aviso en pantalla, `notificacion_correo` #1 `enviada` al 1.er intento, redirigido a simon.bueguenio@gmail.com por `NOTIFICACIONES_SOLO_A`. El usuario temporal se desactivó después | ✔ (envío aceptado por Gmail; recepción por confirmar) |

Total `npm test`: **68/68** (shared 6, backend 52, simulador 6, frontend 4).

## Sesión 1 — 2026-11-03 (entorno de desarrollo de la sesión anterior)

Entorno de ejecución: contenedor Linux, Node 22.23, **PostgreSQL 16.15 sin TimescaleDB** (no descargable en ese entorno) y **FerretDB 1.24** como servidor compatible con el protocolo MongoDB (la imagen oficial de MongoDB no era descargable). Evidencias en `docs/evidencias/` (los archivos `escenarios-e2e.json` y `pruebas-backend.json` fueron reemplazados por los de la sesión 2).

## Resumen (sesión 1)
| Suite | Herramienta | Resultado | Evidencia |
|---|---|---|---|
| Contratos y matriz Tabla 48 | node:test | 6/6 ✔ | salida de `npm test` |
| Integración API ↔ PostgreSQL ↔ MongoDB | Jest + Supertest | **48/48 ✔** | `evidencias/pruebas-backend.json` |
| Simulador: cola, red, energía, backoff | node:test + API HTTP de prueba | 6/6 ✔ | salida de `npm test` |
| Componentes de interfaz | Vitest + Testing Library | 4/4 ✔ | salida de `npm test` |
| Escenarios A–G contra el stack real | `tests/e2e/escenarios.mjs` | **8/8 ✔** | `evidencias/escenarios-e2e.json` |
| Responsive 360/390/768/1024/1440 + errores de consola | Playwright | 0 px de desborde, 0 errores | `evidencias/responsive.json`, `evidencias/capturas/` |
| PWA sin conexión | Playwright | SW activo, shell offline, `/api` nunca en caché | `evidencias/pwa-offline.json` |

## Trazabilidad con el plan del ES2 (cap. 7)
| ID ES2 | Objetivo | Resultado obtenido | Estado |
|---|---|---|---|
| CP-01 | Lote válido → 201 y almacenado con su ts | 201, valor y ts verificados en BD | Aprobada |
| CP-02 | Campo inválido 422 / JSON roto 400 | 422 con `campos`, 400 | Aprobada |
| CP-03 | Credencial inválida → 401 | 401, nada persistido | Aprobada |
| CP-04 | Estado actual con valor, unidad, clasificación | Clasificación del servicio verificada | Aprobada (≤ 5 s: refresco de 5 s implementado; latencia no medida con k6) |
| CP-05 / CC-07 | Fuera de rango → una alerta, ocurrencias acumuladas | 6 lecturas → 1 alerta, ocurrencias = 6 | Aprobada |
| CP-06 | Umbral modificado, auditado y aplicado | Auditoría anterior/nuevo; siguiente lectura usa el nuevo; versión obsoleta → 409 | Aprobada |
| CP-07 / CP-20 / NEG-01…12 | RBAC y RN-10 | 12 casos 403, 405, 409, 401 | Aprobada |
| CP-08 | Torre + dispositivo → mediciones en la torre | Alta con credencial única, telemetría 201 | Aprobada (automatizada; acta manual pendiente) |
| CP-09 / CP-21 | «Sin señal» y reconexión | Evento con causa «desconocida» y reconexión | Aprobada |
| CP-10 / CC-04 | Corte de red y sincronización | Orden FIFO, ts original, sin duplicados (simulador y E2E) | Aprobada (corte de 35 s, no de 30 min) |
| CP-11 / CC-03 | Resolución y concurrencia | 200 + 409, responsable y auditoría | Aprobada |
| CP-12 | Correo crítico ≤ 5 min | Sin SMTP: «no_configurada» (alerta #1). Con Gmail SMTP: alerta #7 «enviada» en ~16 s | **Aprobada** (envío y recepción confirmada por el usuario) |
| CP-13 | Histórico 30 días ≤ 3 s | Agregación, umbrales, huecos, >90 días → 422 | Funcional aprobada; **rendimiento no medido** |
| CP-14 / CP-15 | Comparar y exportar CSV | Series comparables; CSV «;», BOM UTF-8, auditado con nº de filas | Aprobada |
| CP-16 / CP-17 / CP-18 / CP-19 / CP-22 / CP-23 | Usuarios, auditoría, bajas, cultivos, salud | Ver `pruebas-backend.json` | Aprobadas |
| CP-24 | testssl.sh / TLS 1.3 | — | **No ejecutada** (sin despliegue con TLS) |
| CP-25 | Usabilidad SUS | — | **No ejecutada** (requiere usuarios reales) |
| CP-26 | Pantallas sin desplazamiento horizontal | 360, 390, 768, 1024, 1440 px | Aprobada |
| CP-27 | Carga 50 dispositivos (k6) | — | **No ejecutada** |
| CP-28 | Despliegue desde cero (local, Docker Compose) | Volúmenes vacíos → build, migraciones, seed, salud ok, E2E 8/8 | **Aprobada en local** (sesión 2); despliegue en servidor/nube no realizado (sin autorización) |
| CP-29 | Restauración de respaldo | Respaldo cifrado → contenedores limpios → conteos por tabla y última medición frente al respaldo; tiempo frente a RTO 2 h | **Aprobada en local** (sesión 3): 22/22 tablas idénticas, última medición idéntica, 1 736 documentos MongoDB, políticas TimescaleDB restauradas, 2 s. Acta `respaldos/actas/CP-29_20261104T161127Z.md` (local, no versionada). Subida a Spaces: pendiente (nube) |
| CC-01 | Mismo lote ×10 en paralelo | 1×201 + 9×200 duplicado, una copia | Aprobada |
| CC-02 | Dos workers sobre el outbox | Una alerta, outbox vacío | Aprobada |
| CC-05 / CC-09 | BD caída durante envío | MongoDB caído → 503 + Retry-After, nada en PostgreSQL; simulador reintenta | Aprobada (MongoDB); PostgreSQL caído probado indirectamente (arranque del simulador antes que la API) |
| CC-06 | Reconciliación | Documento «recibido» reprocesado | Aprobada |
| CC-08 | Reloj desfasado | 422 RELOJ_DESFASADO + evento | Aprobada |
| CC-10 / CC-11 | Corte eléctrico (con y sin red) | Sin mediciones al apagar, cola sobrevive al reinicio, evento «reinicio», hueco visible, sin duplicados | Aprobada (simulado, no en hardware) |
| CC-12 | Cola llena | Descarta los más antiguos y registra el periodo | Aprobada (unitaria) |

## Defectos encontrados y corregidos durante las pruebas
1. Lote en cuarentena cuando una lectura violaba advertencia y crítico a la vez (D-05).
2. Faltaba el evento «reconexión» cuando el primer contacto tras «sin señal» era un evento del dispositivo.
3. Historial sintético con paso distinto del intervalo generaba falsos «huecos» en el gráfico.
4. Saludo truncado en 360/390 px; texto central del donut descentrado.
5. El simulador mantenía visible el último error después de un envío exitoso.

Sesión 2 (al ejecutar por primera vez con TimescaleDB, MongoDB 7 y Docker Compose reales):

6. **Migración con `--reset` sobre TimescaleDB**: `DROP SCHEMA public CASCADE` elimina la extensión pero su biblioteca queda cargada en la sesión; `CREATE EXTENSION` fallaba («already been loaded with another version») y caían las 48 pruebas de integración en CI. Corrección: `migrate.ts` abre una sesión nueva tras el reset.
7. **Compose: `migrate` arrancaba antes de tiempo** (`ECONNREFUSED`): el healthcheck `pg_isready` por socket daba «sano» durante el servidor temporal de inicialización. Corrección: healthcheck por TCP (`-h 127.0.0.1`); en Mongo, `mongosh --host $(hostname)` por la misma razón.
8. **Compose: el seed nunca se ejecutaba**: `"$SEMBRAR"` en el `command` lo interpolaba Compose (vacío). Corrección: `$$SEMBRAR`.
9. **Escenario D sin eventos `sin_senal`/`reconexion`**: con `WORKER_SIN_SENAL_CADA_S=60` el corte de ~50 s terminaba antes de la revisión del worker. Corrección: 10 s en `.env.example` (debe ser menor que 3 × intervalo de muestreo).
10. **Falso positivo en E/F (prueba)**: el corte eléctrico duraba 12 s, menos que el umbral de hueco (3 × 10 s), y la prueba aprobaba con cualquier hueco de la ventana. Corrección: corte de 35 s y el hueco debe solaparse con el periodo sin energía.
11. `verificar.ps1` no registraba en `verificacion-docker.log` la salida de `docker` (PowerShell 5.1); ahora sí.

### «¿Olvidó su contraseña?» (nuevo, sesión 2)
- Integración (Jest, 5 casos): misma respuesta 202 exista o no el email; solo se guarda el SHA-256 del token; máximo 1 enlace/min por cuenta; restablecer aplica la política, desbloquea la cuenta, revoca sesiones, es de un solo uso; enlace vencido/anterior/inventado → 422; el worker envía y borra el texto con el enlace. Frontend (Vitest, 2 casos). Total `npm test`: **75/75**.
- Real (Docker + Gmail, migración 004): usuario temporal `prueba-olvido@aquaplants.cl` → enlace en el login → «Enviar enlace» → pantalla «Revise su correo» → enlace abierto (el token se quita de la barra) → contraseña nueva → «Contraseña actualizada» → login con la nueva = 200. Correos `restablecer_password` y `cambio_password` `enviada` (redirigidos a simon.bueguenio@gmail.com); recepción por confirmar. El usuario temporal sigue activo (desactivarlo en Usuarios).

## Sesión 3 — 2026-11-04 (dependencias y CI)
| Verificación | Resultado |
|---|---|
| `npm audit --omit=dev` | Antes 9 (8 altas, incl. nodemailer «correo a dominio no deseado»); **ahora 2 moderadas** (react-router, requiere v7) |
| `npm run typecheck` (4 paquetes) con zod 4.6.7, express 4.22.3, nodemailer 10.3.1, react-router-dom 6.30.6, tsx 4.23.15, vitest 2.1.9 | ✔ |
| `npm test` contra TimescaleDB 2.17.2 + MongoDB 7 | **75/75 ✔** |
| Build del frontend (Vite) | ✔ |
| `verificar.ps1` (imágenes reconstruidas, datos conservados) | Salud ok, hipertabla `medicion`, **E2E A–G 8/8 ✔** |
| SMTP con nodemailer 10 (`transport.verify()` contra Gmail) | ✔ |

## Sesión 3 — bloque 2: base de datos (2026-11-04)
| Verificación | Cómo | Resultado |
|---|---|---|
| Migraciones 005–008 sobre la base **con datos** del usuario | `docker compose up -d --build` (copia previa `respaldos/pre-bloque2.dump`) | ✔ aplicadas; permisos con LOGIN para `app_rw` y `backup_ro`; `/health` ok |
| API y worker sin superusuario | `pg_stat_activity` | ✔ conexiones como `app_rw` (el superusuario solo en `migrate`) |
| Evidencia de alertas (Tabla 40, D-24) | Jest `datos.test.ts` | ✔ la alerta copia su medición a `medicion_evidencia`; FK hacia la evidencia; evidencia inmutable (P0001); alerta sin medición → 23503 |
| Compresión / retención / agregado (Tabla 40) | Jest + prueba manual en base desechable | ✔ trabajos: compresión 7 d, retención 2 años, `medicion_hora` 5 años. Al ejecutar la retención, un chunk de hace 3 años se elimina y su alerta conserva el valor en la evidencia. Chunks comprimidos (104 kB → 64 kB) siguen aceptando inserciones y `ON CONFLICT` de `app_rw` |
| Roles de mínimo privilegio (ES2 §3.4) | Jest (`SET ROLE`) | ✔ `app_rw` no puede modificar auditoría/evidencia ni borrar mediciones/usuarios ni crear tablas (42501); `backup_ro` lee todo y solo inserta en `respaldo_registro`; `app_ro` solo lee |
| Anonimización (Tabla 40, D-25) | Jest | ✔ desactivado hace 13 meses → anonimizado (id conservado, auditoría `anonimizar_usuario`), desactivado hace 1 mes → intacto; idempotente; login 401; reactivar → 409 `USUARIO_ANONIMIZADO` |
| Respaldo cifrado (Tabla 16) | `docker compose --profile backup run --rm backup` | ✔ `postgres.dump.age` + `mongo.archive.gz.age` (cabecera `age-encryption.org/v1`), `conteos.tsv` en la misma instantánea, `SHA256SUMS`, fila `ok` en `respaldo_registro` (2,3 MB) |
| Respaldo fallido → aviso | credencial MongoDB incorrecta | ✔ fila `fallido` con el error real; el worker programó y envió `respaldo_fallido` al Administrador (redirigido a simon.bueguenio@gmail.com) |
| CP-29 restauración | `docker compose --profile restauracion run --rm restaurar` | ✔ **APROBADA** (ver tabla de trazabilidad) |
| `npm test` (4 paquetes) | TimescaleDB 2.17.2 + MongoDB 7 | **84/84 ✔**: shared 6, backend 66 (57 + 9 nuevas), simulador 6, frontend 6 |
| Build del frontend (Vite) | `npm run build -w packages/frontend` | ✔ |
| `verificar.ps1` con la API como `app_rw` | Docker Compose | Salud ok, **E2E A–G 8/8 ✔** |

Defectos encontrados y corregidos en el bloque 2:

12. **Scripts de respaldo con CRLF** (escritos en Windows): `set: illegal option -`. Corregido a LF (`.gitattributes` ya lo fuerza al versionar).
13. **Restauración en contenedor limpio**: la imagen de TimescaleDB ya crea la extensión (`CREATE EXTENSION IF NOT EXISTS`), y `bgw_job` guarda el rol propietario de los trabajos: hay que crear los roles antes de `pg_restore`. Se restauran también propietarios y permisos.
14. **Detalle del fallo de respaldo**: incluía avisos inocuos de `pg_dump` y, sin `--quiet`, la URI de MongoDB **con la contraseña**. Ahora el registro se limpia por etapa y se ocultan `usuario:clave@` antes de guardar o enviar.

## Sesión 3 — enlaces de invitación (D-28, 2026-11-04)
| Verificación | Cómo | Resultado |
|---|---|---|
| Solo el Administrador crea/lista/anula enlaces (Tabla 48) | Jest `invitaciones.test.ts` | ✔ Supervisor y Encargado → 403; torres vacías o inexistentes → 422; enviar `rol: administrador` se ignora (siempre Encargado) |
| Flujo completo | Jest | ✔ consultar → registrarse (202) → sin confirmar el login da 401 → confirmar (201, un solo uso) → Encargado solo de las torres del enlace (RN-10: otra torre → 403); auditoría sin email; hash de la contraseña borrado de la solicitud; el texto del correo con el enlace se borra tras el envío |
| Email ya registrado | Jest | ✔ misma respuesta 202, no se crea cuenta, aviso `cuenta_existente` al titular (uno cada 10 min) |
| Cupo, anulación, vencimiento, tokens inválidos, política de contraseña | Jest | ✔ cupo 1: la 2.ª confirmación → 422 `INVITACION_NO_DISPONIBLE`; anulada/vencida/inventada → 422; contraseña débil → 422 |
| Minimización | Jest | ✔ solicitudes no confirmadas se borran un día después de vencer, con su email en los correos |
| `npm test` (4 paquetes) | TimescaleDB 2.17.2 + MongoDB 7 | **89/89 ✔**: shared 6, backend 71 (66 + 5 nuevas), simulador 6, frontend 6. Una 1.ª corrida dio 55 *timeouts* del `beforeAll` por correr a la vez que `docker compose up --build` (CPU); repetida sin carga: verde |
| Build del frontend | Vite | ✔ |
| Migración 009 sobre la base con datos | `docker compose --profile demo up -d --build` | ✔ aplicada; permisos reaplicados |
| Prueba real en el navegador (stack Docker) | Admin crea enlace «Torre C» → pestaña nueva abre `/registro#invitacion=…` (el token se quita de la barra) → formulario → «Revise su correo» → `/confirmar-registro#token=…` → «Activar mi cuenta» → «Cuenta activada» | ✔ la cuenta nueva entra como Encargado y solo ve Torre C; reusar la confirmación → 422; panel: 1/20. Correo `confirmar_registro` **enviado** (redirigido a simon.bueguenio@gmail.com). Luego se anuló el enlace y se desactivó `prueba-invitacion@aquaplants.cl` |
| E2E A–G | `escenarios.mjs` en la red Docker | **8/8 ✔** |

## Sesión 5 — sesión al refrescar (D-31) y preferencia de avisos (D-32), 2026-11-08
| Verificación | Cómo | Resultado |
|---|---|---|
| Cookie de sesión | Jest `sesion.test.ts` | ✔ HttpOnly, SameSite=Strict, Path=/api/v1/auth, con vencimiento; el token no va en el cuerpo; en la BD solo el SHA-256 |
| Reanudar al refrescar | Jest | ✔ `POST /auth/sesion` con la cookie → JWT nuevo que funciona y vence a la misma hora; sin cookie o con una inventada → 401 |
| Revocación | Jest | ✔ cerrar sesión borra la cookie y la invalida; cambiar la contraseña invalida las sesiones abiertas; sesión vencida → 401 y se purga al día |
| Preferencia de avisos | Jest | ✔ Encargado no puede elegir «ninguna» (422); «urgentes» queda guardado y auditado; Administrador parte en «ninguna» |
| Correos de alerta crítica | Jest con notificador falso | ✔ al momento solo a «todas» (admin + supervisor); a los 31 min, un único aviso URGENTE al encargado con «solo urgentes»; si nadie tiene «todas» → `sin_destinatarios` |
| `npm test` en CI | GitHub Actions (TimescaleDB + MongoDB) | **backend 86/86 ✔** (71 + config 5 + conexión 3 + sesión 7), shared 6, simulador 6, frontend 6 |
| Migración 010 en Supabase | `npm run db:migrate` con `.env.nube` | ✔ aplicada; permisos reaplicados; la API publicada (versión anterior) siguió respondiendo |
| Navegador (API y web locales contra Supabase, worker apagado) | Encargado inicia sesión → recarga → sigue dentro; Perfil → «Solo las urgentes» → recarga → se conserva → vuelve a «Todas»; «Cerrar sesión» → recarga → pide iniciar sesión; `document.cookie` no muestra `aq_sesion` | ✔ |


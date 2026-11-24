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
| CP-27 | Carga 50 dispositivos × 10 min | 2.999/2.999 lotes 201, 0 errores, p95 276 ms (ver sesión 5, D-35) | **Aprobada** (2026-11-10, script Node equivalente a k6) |
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

## Sesión 5 — D-33 correo por Resend en Render (2026-11-09)
| Prueba | Resultado |
|---|---|
| Causa: alertas críticas 1 y 2 en Render | `fallida` tras 3 intentos, error «Connection timeout» (SMTP bloqueado en Render free); el mismo SMTP desde el PC: OK |
| `notificador.test.ts` + `config.test.ts` (local) | 9/9 aprobadas |
| Producción: aviso de la alerta 2 reencolado con `RESEND_API_KEY` en Render | `enviada` al primer intento (~40 s, ciclo del worker) |

## Sesión 5 — Asignación de torres con buscador y selección en bloque (2026-11-10)
Prueba manual en navegador (web local + API local contra Supabase, sin worker), como Administrador; nada se guardó.
| Prueba | Resultado |
|---|---|
| Editar usuario Encargado: buscador «albahaca» deja 1 visible; «Quitar visibles» desmarca solo esa; contador «1 de 3 seleccionadas» | OK |
| «Seleccionar todas» marca las 3 y se deshabilita; «Ninguna» habilitada | OK |
| Nuevo enlace de invitación: mismo selector (0 de 3) | OK |
| Infraestructura → Responsables de Torre A: selector de encargados con textos en masculino («Seleccionar todos», «Ninguno») | OK |
| `npm run build -w packages/frontend` | OK |

## Sesión 5 — D-35 variables de la empresa, calidad del enlace y retención (2026-11-10)
| Prueba | Resultado |
|---|---|
| CI (rama `variables-enlace`): suite backend con 11 pruebas nuevas en `variablesEnlace.test.ts` (catálogo, telemetría de caudal, `GET /telemetria/configuracion` 200/401, RSSI buena/aceptable/débil, RSSI fuera de rango → 422, retención 0 = no borra, retención 30 d con y sin TimescaleDB, mínimo 7 días → 22023) | 97/97 aprobadas |
| Primera corrida del CI | 1 fallo **detectado por la suite existente**: `app_rw` no debe poder borrar mediciones (ES2 §3.4). Corregido con `fn_purgar_mediciones` (SECURITY DEFINER, mínimo 7 días) en vez de `GRANT DELETE` |
| Frontend `npm test` / shared `npm test` | 6/6 y 6/6 |
| Producción: migración 011 en Supabase | aplicada; la versión anterior siguió funcionando (solo agrega columnas/filas) |
| Producción: 9 sensores nuevos (caudal, consumo hídrico, fotoperiodo × 3 torres) con umbrales desde el rango de la especie | creados (ids 14–22), auditados en `log_auditoria` |
| Producción: el simulador descubre los sensores nuevos sin editar `dispositivos.json` | a los ~10 min (ciclo de sincronización) llegan las 9 variables: caudal 3,1–3,7 L/min, consumo 25–28 L/día, fotoperiodo ≈ 14 h/día |
| Producción: RSSI | AquaBrain-A −68, B −73, C −66 dBm (aceptable/buena) |
| Producción: web con insignia de señal | publicada en Netlify (desde D-36 en Vercel) |
| Retención en producción | sin datos de más de 30 días todavía (la más antigua es del 2026-11-06): se verificará cuando existan |

## Sesión 5 — CP-27 prueba de carga contra la publicación (2026-11-10)
Escenario: 50 dispositivos AquaBrain virtuales (torre temporal, 5 sensores c/u, sin umbrales) envían **1 lote cada 10 s durante 10 min** a `POST /api/v1/telemetria` de la API publicada (Render free, región Virginia; Supabase + Neon). Arranque escalonado; cliente desde Chile. Scripts en `pruebas/carga/` (Node, equivalente a k6, que no está instalado).

| Indicador | Esperado | Obtenido | Estado |
|---|---|---|---|
| Solicitudes | ≈ 3.000 (50 × 6/min × 10 min) | 2.999 (4,92 /s; 14.995 lecturas) | OK |
| Respuestas | todas 201, sin errores | 2.999 × 201; 0 errores de red; 0 rechazos por límite de tasa | OK |
| Latencia (incluye ~180 ms de red Chile → Virginia) | p95 < 1 s | mín 177 · p50 214 · p90 240 · **p95 276** · p99 449 · máx 1.271 ms | OK |
| Estabilidad por minuto | sin degradación | media 214–245 ms en los 10 minutos; pico aislado de 1,27 s en el minuto 4 | OK |
| Consistencia PostgreSQL | lotes = 201 recibidos | 2.999 = 2.999; 0 duplicados | OK |
| Mediciones | 5 × lotes | 14.995 = 14.995 | OK |
| Payloads originales en Neon | = lotes | 2.999 = 2.999 | OK |
| Limpieza | sin restos | torre, 50 dispositivos, 250 sensores, 14.995 mediciones, 2.999 lotes y payloads borrados; auditoría conservada | OK |

Observaciones: la latencia está dominada por la distancia de red (la mínima ya es 177 ms); el servidor procesó la carga sin errores en el plan gratuito (0,1 CPU). Tras detener la carga el worker marcó 12 dispositivos «sin señal» (comportamiento esperado, RN-04). Volumen simulado: 50 equipos ≈ 17 veces los 3 de la demostración. **CP-13** (histórico de 30 días ≤ 3 s) sigue sin medición de rendimiento.


## Sesión 7 — Escenario B y correo cuando ya hay una alerta activa (2026-11-10)

Síntoma: «en la simulación hay para mandar alertas al correo pero no me llegan». Causa: el escenario B altera el pH del dispositivo elegido (por defecto la Torre A), que ya tenía la alerta crítica #2 **activa**. Por diseño (índice `alerta_activa_uq`) una violación repetida solo suma ocurrencias: no crea alerta ni correo nuevos. El envío funcionaba: la alerta #2 se reencoló y quedó `enviada` por Resend (2026-11-10 15:32 UTC, sin error).

Cambio: antes de ejecutar B, la API revisa si ese sensor ya tiene una alerta crítica activa y la página Demostración lo muestra («No se enviará correo: … resuélvala en Alertas o elija otro dispositivo»). Si no hay ninguna, indica que se creará una alerta nueva con correo.

| Prueba | Resultado |
|---|---|
| `test/demoEscenarioB.test.ts` (3 casos: sin alerta previa, con alerta previa #2, otros escenarios sin aviso) | 3/3 OK |
| Tipos backend y frontend (`tsc --noEmit`) | OK |
| Correo real tras ejecutar B en producción sobre una torre sin alerta activa | **✔ Recepción confirmada por el usuario** el 2026-11-10 |

## Sesión 7 — Revisión del simulador para la demostración (2026-11-10)

| Revisión | Resultado |
|---|---|
| 3 AquaBrain en producción comunicando (intervalo 10 s, RSSI −64 a −68 dBm) | OK |
| 22 sensores con mediciones en los últimos 15 min (93 c/u) | OK |
| Valores simulados durante 24 h frente a la advertencia de cada sensor | 21/22 siempre dentro. **Fotoperiodo de la Torre B (albahaca, 14–16 h) fuera el 50 % del tiempo**: el simulador usaba 14 h para todas las especies → alerta de advertencia #3. Corregido: base 15 h (dentro de 12–16 y 14–16); nueva simulación 0 % fuera |
| Escenarios C/D/E/F ejecutados por el usuario hoy | OK: eventos `sin_senal` y `reconexion` con lotes en cola, 249 lotes recuperados, 1 duplicado descartado (reenvío del escenario D), `reinicio` del escenario F |
| Escenario B con correo | OK (confirmado por el usuario) |
| Reinicios del simulador (13 en 2 h) | No son caídas: coinciden con cada `git push` (Render redespliega). Se agregó `buildFilter.ignoredPaths` en `render.yaml` para que los cambios de documentación, web o pruebas no reinicien la API ni el simulador |
| `npm test -w packages/simulador` | 6/6 OK |

## Sesión 8 — Sugerencia 1: indicador de alertas (2026-11-22)

Cambio solo de interfaz (además, el mismo número junto a «Alertas» en el menú lateral y en la barra inferior del celular; no se muestra con 0): campana en la barra superior de todas las páginas con el total de alertas activas (`GET /alertas?estado=activa&por_pagina=1`, que ya filtra por rol y ordena las críticas primero). Neutra con 0, ámbar con advertencias, roja con «Hay críticas» si hay alguna.

| Prueba | Resultado |
|---|---|
| `npm test -w packages/frontend` (14 casos nuevos en `indicadorAlertas.test.tsx`: 9 de campana y 5 del menú; + 6 existentes) | 20/20 OK |
| `npm test -w packages/shared` | 6/6 OK |
| `npm run typecheck` y `npm run build -w packages/frontend` (Node 26.13.1) | OK |
| Navegador con web compilada y **API simulada**: 11 rutas como Administrador a 360 px | Campana en las 11, sin scroll horizontal **con tablas vacías** (corrección: con filas, Usuarios sí desbordaba; ver Sugerencia 3) |
| Navegador (API simulada): 360, 768, 1024 y 1440 px; casos 0, 3 con crítica y 120 | OK: «0», «3 · Hay críticas», «99+»; 44 px de alto; el clic lleva a /alertas |
| Navegador (API simulada): resolver la única crítica | OK: baja a 2 y pasa a ámbar sin esperar el refresco |
| Navegador (API simulada): número del menú lateral, 11 rutas como Administrador a 1280 px | «3» en las 11, sin scroll horizontal |
| Navegador (API simulada): número de la barra inferior, página Alertas; 3 roles × 4 casos (0, 2, 3 con crítica, 120) × 4 anchos (320, 360, 390, 768 px) | 48/48 OK: dentro de su botón, oculto con 0, sin scroll horizontal. Antes del arreglo el «99+» invadía 20 px el botón «Más» a 360 px |
| Publicación `98b34bd`: https://aquaplants.vercel.app | OK: sirve el JS y CSS nuevos; el login abre sin errores de consola; `/api/v1/health` por Vercel 200 y `/api/v1/alertas` sin sesión 401 |
| Render tras el push | OK: sin despliegue nuevo en GitHub para `98b34bd` (el filtro de `render.yaml` funcionó); API y simulador siguieron respondiendo |
| Campana y número con sesión iniciada y datos reales | **No ejecutado** |
| Pruebas del backend | No ejecutadas en este equipo (sin PostgreSQL de pruebas); CI de GitHub en `98b34bd` OK (`npm test` completo, tipos, compilación y auditoría) |

Observado, sin corregir: en la página Alertas el fondo oscuro del modal «Resolver» cubre solo la tarjeta y no toda la pantalla (defecto anterior a este cambio).

Nota: correr una sola suite del backend reescribe `docs/evidencias/pruebas-backend.json` con solo esa suite. No confirmar ese archivo salvo tras una ejecución completa.

## Sesión 8 — Sugerencia 3: filtros de usuarios (2026-11-22)

Cambio solo de interfaz en Usuarios: buscador por nombre o email (sin tildes ni mayúsculas, palabras en cualquier orden), filtros por rol y por estado, contador y «Limpiar filtros». Filtra en el navegador la lista que ya entrega `GET /usuarios` (solo Administrador). Sin paginación.

| Prueba | Resultado |
|---|---|
| `npm test -w packages/frontend` (14 casos nuevos en `filtrosUsuarios.test.tsx`) | 34/34 OK |
| `npm test -w packages/shared` | 6/6 OK |
| `npm run typecheck` y `npm run build -w packages/frontend` | OK |
| Navegador con **API simulada** (12 usuarios): 4 roles × 4 estados, contando «Todos», a 1280 px | 16/16 coinciden contador y filas; la tabla no salta |
| Navegador (API simulada): 320, 360, 375, 390, 768, 1024 y 1440 px × (sin filtro, con resultado, sin resultado) | 21/21 sin scroll horizontal; controles de 44 px o más |
| Navegador (API simulada): limpiar, editar desde la lista, buscador de torres del formulario | OK |
| Publicación `fcb33e9`: https://aquaplants.vercel.app | OK: sirve el JS y CSS nuevos; el login abre sin errores de consola; `/api/v1/usuarios` sin sesión 401 |
| Render tras el push | OK: sin redespliegue; API y simulador siguieron respondiendo |
| Con sesión, API y datos reales | **No ejecutado** |
| Pruebas del backend | No ejecutadas en este equipo (sin cambios en backend); CI de GitHub en `fcb33e9` OK |

Defecto anterior encontrado y corregido: con filas, Usuarios medía 720 px en una pantalla de 360 porque el `.sr-only` de «Acciones» escapaba de la tabla. Se agregó `position: relative` a `.tabla-contenedor` (lo usan también las demás tablas; con datos solo se volvió a probar Usuarios).

## Sesión 8 — Filtros de torres (2026-11-22, pedido del usuario)

Cambio solo de interfaz en Torres / Mis torres: buscador (nombre, cultivo, tipo, ubicación, dispositivo), Estado (el de la tarjeta, o «Con alertas activas») y Conexión (basta un dispositivo). Filtra lo que ya entrega `GET /torres/estado`, que respeta RN-10. Se recuerda por usuario mientras dure la pestaña. La barra se comparte con Usuarios (`BarraFiltros`).

| Prueba | Resultado |
|---|---|
| `npm test -w packages/frontend` (25 casos nuevos en `filtrosTorres.test.tsx`) | 59/59 OK. La primera ejecución falló: «torre b» calzaba con «AquaBrain»; corregido (un carácter suelto exige palabra completa) |
| `npm run typecheck` y `npm run build -w packages/frontend` | OK |
| Navegador con **API simulada** (8 torres): 7 estados × 5 conexiones, a 1280 px | 35/35 contador igual a tarjetas |
| Navegador (API simulada): Torres y Usuarios × 7 anchos (320–1440 px) × 4 búsquedas | 56/56 sin scroll horizontal; controles de 44 px o más |
| Navegador (API simulada): entrar a una ficha y volver | Conserva el filtro |
| Publicación `e181077`: https://aquaplants.vercel.app | OK: sirve el JS y CSS nuevos; el login abre sin errores de consola; `/api/v1/torres/estado` sin sesión 401 |
| Render tras el push | OK: sin redespliegue; API y simulador siguieron respondiendo |
| Con sesión, API y datos reales | Revisión visual del usuario (2026-11-22): «se ven bien». Las combinaciones no se probaron con datos reales |
| Pruebas del backend | No ejecutadas en este equipo (sin cambios en backend); CI de GitHub en `e181077` OK |

## Sesión 8 — Estructura del Anexo C: clientes, Técnico, incidencias, GPS (2026-11-22, D-37)
Rama local `estructura-clientes`, sin commit ni publicación. Ejecutado en el PC del usuario (Node 26, sin PostgreSQL local).

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (shared, backend, simulador, frontend) | **✔** sin errores |
| shared (`permisos.test.ts`: 5 roles, 16 funcionalidades, RN-12) | **8/8 ✔** |
| backend sin base de datos: `rolesAnexoC` (88), `demoEscenarioB`, `notificador`, `config`, `conexion` | **103/103 ✔** |
| backend con base de datos: `api`, `datos`, `sesion`, `invitaciones`, `variablesEnlace`, `estructura` (nueva) | **No ejecutadas**: 97 fallan por `ECONNREFUSED 127.0.0.1:5432` (no hay PostgreSQL en este PC). Quedan para el CI |
| simulador | **6/6 ✔** |
| frontend (incluye `rolesPantallas.test.tsx`: menú por rol, Incidencias del Técnico, Supervisor en solo lectura) | **66/66 ✔** |
| `npm run build -w packages/frontend` | **✔** |
| Pantallas en el navegador integrado con una API simulada local (datos ficticios, sin Supabase) | **✔** Técnico: Inicio, Incidencias (solo sus clientes, «Atender», GPS), Infraestructura en lectura, sin Alertas; Supervisor: «Mis Encargados» solo de su cliente; Administrador: Clientes. Sin errores en la consola |
| CI de GitHub Actions en la rama `estructura-clientes` (TimescaleDB + MongoDB de prueba: migraciones con la 012, typecheck, `npm test`, build, audit) | 1.ª ejecución ✖: backend 199/200; falló `estructura.test.ts` porque la prueba esperaba que la sesión se revocara al instante tras el script `admin:principal`, y la API guarda la versión de sesión 30 s. Se corrigió la prueba (no el código). **Ejecución 45074918100 sobre `e5102bb`: ✔ verde** (migración 012 aplicada y todas las suites, incluidas las de aislamiento entre clientes) |
| Migración 012 en Supabase (autorizada por el usuario el 2026-11-22) | **✔ aplicada** con `npm run migrate` y `.env.nube` (solo faltaba la 012). Verificado: «Cliente inicial» (id 1) con las 3 torres; 5 roles; Supervisor y Encargados con cliente 1, Administrador sin cliente; 3 incidencias abiertas creadas para los 3 dispositivos que estaban sin señal (simulador detenido). Los roles `app_*` siguen sin login, igual que antes. Producción con el código anterior: `/health` ok después de migrar |

Ajustes en pruebas existentes: `invitaciones.test.ts` (el Supervisor ahora puede invitar Encargados de su cliente: 201), fixtures del frontend con `id_cliente`, `cliente`, `latitud` y `longitud`, y el usuario simulado de `filtrosUsuarios.test.tsx` con rol Administrador (las acciones ahora dependen del rol).

### Anexo C en producción con sesión de Administrador (2026-11-22, 23:58)
El usuario inició sesión él mismo en el navegador integrado; Claude solo leyó las pantallas (sin crear ni modificar datos; el formulario de GPS se abrió y se canceló). API despertada antes con `/api/v1/health` (ok).

| Pantalla | Resultado |
|---|---|
| Menú del Administrador | **✔** Inicio, Torres, Históricos, Alertas, Incidencias, Continuidad, Infraestructura, Umbrales, Usuarios, Clientes, Auditoría, Demostración, Perfil; sin «Mis Encargados» |
| Inicio | **✔** 3 torres, 3/3 conectados, 0 sin señal, 0 alertas, 22 variables normales; cada torre muestra «Cliente inicial» |
| Incidencias | **✔** 3 activas de «Cliente inicial» (AquaBrain-A y C sin atender, B en atención por la Administradora), cada una «Se repitió 2 veces» y «Volvió a comunicarse», «Cerrar» habilitado. No se cerró ninguna |
| Clientes | **✔** «Cliente inicial»: 3 torres, 3 usuarios, 0 técnicos, activo; acciones Renombrar y Dar de baja |
| Usuarios | **✔** 4 usuarios con columna Alcance (Administradora: todos los clientes; Supervisor: Cliente inicial · todas sus torres; Encargados con sus torres); filtro de rol con los 5 roles; las invitaciones entran como Encargado del cliente de la torre |
| Infraestructura | **✔** cliente en cada torre, «Sin ubicación GPS» en los 3 AquaBrain, el botón «Ubicación» abre el formulario de latitud y longitud |
| Torres | **✔** «Cliente inicial» en las 3 tarjetas |
| Consola | **✔** sin errores de la aplicación (solo los 401 de la verificación de sesión antes de iniciar sesión y avisos de CSP por scripts de la herramienta de inspección) |

No probado aún: pantallas de Supervisor, Encargado y Técnico con sesión real (no hay Técnico creado), crear un cliente, guardar un GPS y cerrar una incidencia en producción.

### Personas de muestra en Supabase (2026-11-23)
`demoPersonas.ts`: typecheck **✔**; ensayo `--seco` contra Supabase **✔** (todo en una transacción con ROLLBACK); carga real **✔** (autorizada por el usuario). Verificado con una consulta de solo lectura: 2 clientes con sus torres, 10 usuarios con rol, cliente y clientes atendidos correctos, GPS en AquaBrain-A y B. La sesión abierta de Ana se cerró sola al pasar a Administrador principal (esperado). Pendiente: revisar las pantallas con cada rol.

### Anexo C en producción con sesión de cada rol (2026-11-23)
El usuario inició cada sesión en el navegador integrado; Claude solo leyó las pantallas (sin crear ni modificar datos). Consola sin errores de la aplicación en todas.

| Cuenta | Resultado |
|---|---|
| Teo Técnico (atiende ambos clientes) | **✔** «Equipos de mis clientes», 3 torres de los 2 clientes, KPI «Incidencias activas» en vez de alertas, campana de incidencias; 3 incidencias con cliente, GPS, «Atender» y «Cerrar» (bloqueado mientras sigue sin señal); Infraestructura y Umbrales «Solo lectura»; `/alertas` y `/usuarios` → «Sin acceso» |
| Paula Soto (Técnica, solo Huerta Norte) | **✔** solo Torre C y 1 incidencia (AquaBrain-C) con «Atender» y «Cerrar»; no ve torres A ni B |
| Rodrigo Rojas (Administrador) | **✔** 10 cuentas con su alcance; Ana (Administrador principal) en «Solo lectura» (RN-12: solo el principal gestiona Administradores) |
| Carla Muñoz (Supervisora, Huerta Norte) | **✔** «Supervisión · Huerta Norte», solo Torre C; «Mis Encargados» con solo Diego Pérez y Tomás; incidencia de AquaBrain-C sin botones; `/clientes` → «Sin acceso». Detalle menor: el filtro de rol muestra los 5 roles (**corregido**: ver abajo) |
| Marcela Díaz (Encargada, Torre B) | **✔** «Mis cultivos», solo Torre B; `/incidencias` y `/usuarios` → «Sin acceso» |

### Filtro de rol según la lista (2026-11-23)
`FiltrosUsuarios` ofrece solo los roles presentes y oculta el selector si hay uno solo. frontend **68/68 ✔** (2 pruebas nuevas en `filtrosUsuarios.test.tsx`), typecheck y build **✔**; con la API simulada local: Supervisor sin selector de rol (solo Buscar y Estado), Administrador con los roles de su lista.

### CP-13, CP-24 y fondo del modal (2026-11-23)
| Verificación | Resultado |
|---|---|
| **CP-13** histórico de 30 días ≤ 3 s, en producción (Vercel → Render → Supabase), sesión de Paula Soto (Técnica), 5 sensores de la Torre C × 3 intentos | **✔ APROBADA**: máximo 1.273 ms (primera llamada en frío), resto 228–548 ms; respuesta agregada por hora (77 y 15 puntos, 2–10 KB). Limitación: Supabase solo tiene ~77 h con datos en esos 30 días (el simulador no corre continuo), no 30 días llenos |
| Aislamiento en la API: la misma Técnica pide el histórico de un sensor de la Torre A (otro cliente) | **✔** 403 `TORRE_NO_ASIGNADA` |
| **CP-24** TLS | **✔ APROBADA**: certificado válido en `aquaplants.vercel.app` y `aquaplants-api.onrender.com`; HSTS `max-age=31536000`; `http://` → 308 a `https://` |
| Fondo del modal (defecto «Resolver» en Alertas) | **Corregido**: `Modal` se monta en `<body>` con `createPortal` (dentro de una tarjeta con `backdrop-filter` el fondo quedaba limitado a la tarjeta). Prueba nueva `modal.test.tsx`; frontend **69/69 ✔**, typecheck y build **✔**; con la API simulada local el fondo mide lo mismo que la ventana y el modal queda centrado |

### Acciones de incidencias en producción (2026-11-23, sesión de Paula Soto)
| Acción | Resultado |
|---|---|
| «Atender» la incidencia de AquaBrain-C desde la pantalla | **✔** pasa a «En atención», «Atiende Paula Soto desde 23-nov, 01:37» |
| Cerrar mientras el equipo sigue sin señal (API) | **✔** 409 `SIN_SENAL_PERSISTE` (API.md decía 422: corregido) |
| Atender otra vez la misma incidencia (API) | **✔** 409 `INCIDENCIA_EN_ATENCION` |

Sin probar en producción: cerrar con comentario (requiere que el simulador esté enviando), guardar un GPS desde la pantalla y crear un cliente (requieren sesión de Administrador).

## Sesión 8 — CRUD completo: Especies y corregir cultivo (2026-11-23, D-38)
| Verificación | Resultado |
|---|---|
| Revisión de CRUD por entidad (API y pantallas) | Clientes, torres, dispositivos (GPS, credencial), sensores, umbrales, usuarios, invitaciones e incidencias ya tenían crear/ver/editar/baja. Faltaban **Especies** (catálogo fijo) y **corregir el cultivo en curso** en la pantalla (la API existía) |
| `npm run typecheck` (shared, backend, frontend) | **✔** |
| shared (`permisos.test.ts`, 17 funcionalidades) | **8/8 ✔** |
| backend sin base de datos (`rolesAnexoC`) | **88/88 ✔** |
| backend con base de datos: `especies.test.ts` (nueva: permisos, crear con rangos, duplicado 409, mín ≥ máx 422, fuera del rango físico 422, editar y auditoría, baja con cultivos en curso 409, la de baja no aparece en `/catalogos` ni se acepta en cultivos, reactivar) | **No ejecutada en local** (sin PostgreSQL): queda para el CI |
| frontend (incluye `especies.test.tsx` 3 pruebas) | **72/72 ✔** |
| `npm run build -w packages/frontend` | **✔** |
| Pantallas con la API simulada local | **✔** Especies: tabla con rangos, cultivos en curso y estado; formulario con mínimo y máximo por variable. Torre: «Corregir» abre el cultivo en curso con su especie y fecha |
| Migración `013_especies.sql` | **Sin probar** (correrá en el CI antes de aplicarla en Supabase) |

## Sesión 8 — Apartado «CRUD» para la demostración (2026-11-23)
Página única `/crud` (menú Gestión → CRUD, solo Administrador) con una pestaña por entidad: Clientes, Especies, Torres y equipos, Umbrales, Cultivos, Usuarios, Incidencias y Auditoría. Reutiliza las pantallas existentes; la pestaña **Cultivos** es nueva y muestra los cultivos de todas las torres.
| Verificación | Resultado |
|---|---|
| `tsc --noEmit` y `npm run build -w packages/frontend` | **✔** |
| frontend completo (incluye `crud.test.tsx`, 4 pruebas nuevas: pestañas según permisos, `?tab=`, un solo h1, flechas del teclado; nuevo cultivo solo en torres activas sin cultivo en curso; corregir y cerrar con validación de fecha) | **76/76 ✔** |
| Con la API simulada local (Administrador) | **✔** Las 8 pestañas cargan sin errores, cada una con su título h2 y una sola barra superior. «Nuevo cultivo» ofrece solo torres sin cultivo en curso. Móvil 375 px: las pestañas se desplazan en horizontal (44 px de alto), sin desplazamiento horizontal de la página |
| Backend | Sin cambios (usa `GET /cultivos`, `/torres`, `/catalogos` ya existentes) |
| En producción | **Pendiente** de publicar |

### Defecto: el foco saltaba a la «X» al escribir en un formulario (2026-11-23)
Reportado por el usuario al revisar el CRUD en producción: al escribir un número en un campo de una ventana (modal), el cursor pasaba al botón «X» y no se podía seguir escribiendo. Afectaba a **todos** los formularios en ventana (especies, cultivos, usuarios, torres, etc.).
Causa: el efecto del `Modal` dependía de `onCerrar`, que es una función nueva en cada render; cada tecla volvía a ejecutarlo y enfocaba el primer botón (la «X»). Corrección: `onCerrar` se guarda en una referencia, el efecto solo depende de `abierto` y el foco inicial va al primer campo.
| Verificación | Resultado |
|---|---|
| `modal.test.tsx`: foco en el primer campo y se mantiene al escribir; Escape usa la función más reciente | **✔** (la primera **falla sin la corrección**, comprobado) |
| frontend completo | **78/78 ✔** |
| API simulada: «Nueva especie», escribir «Tomate» y «5,8» en pH mín. | **✔** el texto queda completo y el foco sigue en el campo |
| En producción | **Pendiente** de publicar |

### Especies: rango permitido visible en el formulario (2026-11-23)
Pedido del usuario: ver el mínimo (y máximo) posible al escribir los rangos de una especie. Bajo cada variable se muestra «Permitido: mín a máx unidad» (límites físicos de `tipo_variable`, los mismos que valida el backend) y el formulario avisa antes de enviar si un valor queda fuera.
| Verificación | Resultado |
|---|---|
| `especies.test.tsx` (nueva: muestra «Permitido: 0 a 14 pH» y rechaza pH máx. 15 sin llamar a la API) | **4/4 ✔** |
| API simulada: «Nueva especie» | **✔** «Permitido: 0 a 14 pH» y «Permitido: 0 a 10 mS/cm» bajo cada variable |
| En producción | **Pendiente** de publicar |

## Sesión 8 — Informe de gestión (2026-11-23, D-39)
| Verificación | Resultado |
|---|---|
| `npm run typecheck` (shared, backend, frontend) | **✔** |
| shared (`permisos.test.ts`, 18 funcionalidades) | **8/8 ✔** |
| backend sin base de datos (`rolesAnexoC`, `config`, `notificador`) | **97/97 ✔** |
| backend con base de datos: `informe.test.ts` (nueva: Encargado 403; Administrador ve inventario, 30 días en la serie y auditoría; Supervisor no ve la torre de otro cliente ni aunque lo pida por parámetro, y no ve auditoría; Administrador filtra por cliente; periodo invertido, mayor a un año o mal escrito → 422) | **No ejecutada en local** (sin PostgreSQL): queda para el CI |
| Consulta del servicio contra **Supabase real** (solo lectura, últimos 30 días) | **✔** 2,6 s; 3 torres, 22 sensores, 327.112 lecturas, 6 alertas (100 % resueltas, 101,4 h promedio), 3 incidencias abiertas, 3 cultivos; Supervisor: solo «Torre A» y «Torre B» de su cliente, sin auditoría |
| frontend (incluye `informe.test.tsx`, 3 pruebas: 30 días al entrar, indicadores, gráfico, torres y actividad; filtro por cliente y validación del periodo; Supervisor sin cliente ni actividad) | **82/82 ✔** |
| API simulada: Administrador | **✔** 6 indicadores en 3×2, gráfico de barras por día con leyenda, tablas; «7 días» regenera con 7 filas |
| API simulada: Supervisor / Encargado | **✔** Supervisor ve el menú y el informe sin selector de cliente; Encargado: sin menú y «Sin acceso» |
| Móvil 375 px | **✔** sin desplazamiento horizontal de la página |
| Colores del gráfico (`validate_palette.js`, #0369a1 y #a16207 sobre blanco) | **✔** todas las verificaciones (CVD ΔE 20,1; contraste ≥ 3:1) |
| Impresión real a PDF | **Sin probar** (los estilos de impresión ocultan menú, filtros y botones) |
| En producción | **Pendiente** de publicar |

## Sesión 8 — Nombre automático de torre (2026-11-23, D-40)
| Verificación | Resultado |
|---|---|
| `npm run typecheck` | **✔** |
| shared (nueva prueba `siguienteNombreTorre`: vacío → Torre 1; A,B → C; a,C → D; 1,2 → 3; Z → Torre 1; 2,3,4 → 5) | **9/9 ✔** |
| frontend | **82/82 ✔** |
| backend sin base de datos | **97/97 ✔** |
| backend con base: `estructura.test.ts` (nombre vacío → «Torre 1» con ID nuevo; sin nombre → «Torre 2») | **✔ en el CI** (commit d110fc9; el primer intento falló porque la prueba del Técnico esperaba una sola torre en el cliente y se ajustó) |
| API simulada (Administrador): «+ Torre» propone «Torre 1», ayuda «El ID lo asigna el sistema», guardar avisa «Torre «Torre 1» creada con ID 9»; tarjetas muestran «ID 1», «ID 2»… | **✔** |
| En producción | **Publicado** (Vercel con el formulario nuevo; no se creó una torre de prueba en producción) |

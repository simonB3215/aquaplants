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
| CP-12 Correo de alerta crítica | Docker, worker → `smtp.gmail.com:587` (STARTTLS, contraseña de aplicación) | **✔ envío aceptado por Gmail**: autenticación verificada; escenario B → alerta crítica #7 generada 01:19:59 UTC y `notificacion_estado = enviada` al 1.er intento (~16 s, límite 5 min). Destino único `simon.bueguenio@gmail.com`. **Recepción en la bandeja: por confirmar por el usuario** | tabla `alerta` (#7) |
| `npm audit --omit=dev` | local | **9 vulnerabilidades (1 moderada, 8 altas)** en express/qs/path-to-regexp y zod; no corregidas (requieren actualizaciones mayores) | — |

### Preparación de CP-12 (SMTP)
- Nueva variable solo de demo `NOTIFICACIONES_SOLO_A`: si se define, **todos** los avisos van únicamente a esa dirección (asunto con prefijo `[DEMO]` y el texto indica a quién habría correspondido). Motivo: los usuarios sembrados tienen correos ficticios `@aquaplants.cl`; con SMTP real los avisos saldrían a un dominio ajeno. Prueba unitaria en `packages/backend/test/notificador.test.ts`.
- En el `.env` local (no versionado): `NOTIFICACIONES_SOLO_A=simon.bueguenio@gmail.com`; remitente la misma cuenta. La contraseña de aplicación la puso el usuario (nunca pasó por el chat ni por archivos versionados).
- Procedimiento ejecutado: `docker compose up -d api worker` → `transport.verify()` OK → el Supervisor resuelve la alerta crítica activa #1 (una alerta por situación) → escenario B en AquaBrain-B (pH, sensor 6) → alerta #7 `enviada` → escenario A para volver a la normalidad.

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
| CP-12 | Correo crítico ≤ 5 min | Sin SMTP: «no_configurada» (alerta #1). Con Gmail SMTP: alerta #7 «enviada» en ~16 s | **Aprobada (envío)**; recepción en bandeja por confirmar por el usuario |
| CP-13 | Histórico 30 días ≤ 3 s | Agregación, umbrales, huecos, >90 días → 422 | Funcional aprobada; **rendimiento no medido** |
| CP-14 / CP-15 | Comparar y exportar CSV | Series comparables; CSV «;», BOM UTF-8, auditado con nº de filas | Aprobada |
| CP-16 / CP-17 / CP-18 / CP-19 / CP-22 / CP-23 | Usuarios, auditoría, bajas, cultivos, salud | Ver `pruebas-backend.json` | Aprobadas |
| CP-24 | testssl.sh / TLS 1.3 | — | **No ejecutada** (sin despliegue con TLS) |
| CP-25 | Usabilidad SUS | — | **No ejecutada** (requiere usuarios reales) |
| CP-26 | Pantallas sin desplazamiento horizontal | 360, 390, 768, 1024, 1440 px | Aprobada |
| CP-27 | Carga 50 dispositivos (k6) | — | **No ejecutada** |
| CP-28 | Despliegue desde cero (local, Docker Compose) | Volúmenes vacíos → build, migraciones, seed, salud ok, E2E 8/8 | **Aprobada en local** (sesión 2); despliegue en servidor/nube no realizado (sin autorización) |
| CP-29 | Restauración de respaldo | Scripts entregados | **No ejecutada** |
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

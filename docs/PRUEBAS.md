# Registro de pruebas (ejecutadas el 2026-11-03)

Entorno de ejecución: contenedor Linux, Node 22.23, **PostgreSQL 16.15 sin TimescaleDB** (no descargable en ese entorno) y **FerretDB 1.24** como servidor compatible con el protocolo MongoDB (la imagen oficial de MongoDB no era descargable). En CI (`.github/workflows/ci.yml`) las mismas pruebas corren contra `timescale/timescaledb:2.17.2-pg16` y `mongo:7.0`, **pero ese pipeline aún no se ha ejecutado**. Evidencias en `docs/evidencias/`.

## Resumen
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
| CP-12 | Correo crítico ≤ 5 min | Sin SMTP: estado «no_configurada», nunca «enviada» | **No ejecutada** (sin proveedor SMTP) |
| CP-13 | Histórico 30 días ≤ 3 s | Agregación, umbrales, huecos, >90 días → 422 | Funcional aprobada; **rendimiento no medido** |
| CP-14 / CP-15 | Comparar y exportar CSV | Series comparables; CSV «;», BOM UTF-8, auditado con nº de filas | Aprobada |
| CP-16 / CP-17 / CP-18 / CP-19 / CP-22 / CP-23 | Usuarios, auditoría, bajas, cultivos, salud | Ver `pruebas-backend.json` | Aprobadas |
| CP-24 | testssl.sh / TLS 1.3 | — | **No ejecutada** (sin despliegue con TLS) |
| CP-25 | Usabilidad SUS | — | **No ejecutada** (requiere usuarios reales) |
| CP-26 | Pantallas sin desplazamiento horizontal | 360, 390, 768, 1024, 1440 px | Aprobada |
| CP-27 | Carga 50 dispositivos (k6) | — | **No ejecutada** |
| CP-28 / CP-29 | Despliegue desde cero / restauración | Scripts entregados | **No ejecutadas** (Docker Hub inaccesible en el entorno de la sesión) |
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

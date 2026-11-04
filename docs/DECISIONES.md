# Decisiones y divergencias respecto del informe ES2

Precedencia aplicada: desafío original (contexto) → ES2 corregido (diseño) → prompt maestro (implementación). Cada divergencia se documenta con su motivo.

| # | Tema | ES2 | Implementado | Motivo |
|---|------|-----|--------------|--------|
| D-01 | Node.js | 20 LTS | **22 LTS** | Node 20 terminó su soporte en abril de 2026; el prompt exige una versión LTS mantenida. |
| D-02 | Rutas de históricos | `GET /mediciones/historico`, `GET /historicos/export` | Ambas + alias `GET /historicos` y `GET /mediciones/export` | El prompt nombra `/historicos`; el ES2 nombra `/mediciones/historico`. Se implementan las dos sin romper el contrato. |
| D-03 | Resolver alerta | `PATCH /alertas/{id}/resolver` (CU-04) y `PATCH /alertas/{id}` (NEG-01) | Ambas rutas, mismo controlador | Contradicción interna del ES2; se aceptan ambas. |
| D-04 | Umbrales | `PUT /sensores/{id}/umbrales` (CU-07) y `PUT /umbrales/{id}` (NEG-04) | Ambas + `PATCH /umbrales/{id}/desactivar` | Igual que D-03. |
| D-05 | Medición–Alerta 1:0..1 con dos umbrales | Una lectura puede violar advertencia y crítico | Se aplica **solo el umbral más severo** violado | Respeta la cardinalidad 1:0..1 y la restricción única `(id_medicion, ts_medicion)`. Detectado en prueba real (lotes en cuarentena) y corregido. |
| D-06 | Unicidad `(id_sensor, severidad)` en umbral | Única | Índice único **parcial** `WHERE activo` | El ES2 exige además baja lógica de umbrales (las alertas los referencian); una restricción total impediría crear un nuevo umbral tras desactivar uno. |
| D-07 | Idempotencia | Índice único `id_lote` en MongoDB | Tabla `lote_ingesta` en PostgreSQL (PK `id_lote`) **y** índice único en MongoDB | La fuente de verdad es PostgreSQL; la reconciliación (§3.2) necesita saber si el `id_lote` existe en PostgreSQL. |
| D-08 | Eventos del dispositivo | No definidos como endpoint | `POST /telemetria/eventos` (reinicio, datos_descartados, reconexion_local), idempotente por `id_evento_local` | ES2 pide registrar `datos_descartados` con el periodo perdido y el reinicio tras volver la energía; hacía falta un canal autenticado del dispositivo. |
| D-09 | Lote: campo `meta` | No existe | `meta` **opcional** (`pendientes`, `recuperado`, `firmware`) | Permite el estado «Sincronizando» y contar lotes recuperados. Compatible hacia atrás. |
| D-10 | Caché de umbrales en el motor | Caché invalidada al cambiar umbral | El motor lee los umbrales vigentes en cada evaluación | Cumple la poscondición de CU-07 sin coordinación de caché entre procesos. Optimizable si la carga lo exige. |
| D-11 | Capas | Repositorio por entidad | Repos dedicados para ingesta/alertas/outbox; los servicios CRUD usan el puerto `IBaseDatos` con SQL parametrizado | Reduce código sin acoplar servicios a `pg`: siguen dependiendo de interfaces. |
| D-12 | Límite de tasa por dispositivo | Nginx por `X-Device-Id` | En la API **después** de autenticar la credencial; Nginx solo por IP | Indicado en el propio ES2 §6.1 y el prompt (no confiar en `X-Device-Id`). |
| D-13 | Sesión en el navegador | JWT en memoria | JWT en memoria (al recargar se vuelve a iniciar sesión) | Se respeta el ES2. Implica que la PWA no conserva sesión al cerrarse. |
| D-14 | TimescaleDB | Hipertabla | Migración `002_timescale.sql` condicional; las consultas usan `date_bin` (funciona con y sin Timescale) | En el entorno de desarrollo de esta sesión no se pudo descargar TimescaleDB; en Docker Compose sí se usa la imagen `timescale/timescaledb`. Políticas de compresión/retención **no activadas** (ver ESTADO_PROYECTO). |
| D-15 | «Sin señal» | 3 × intervalo | `SIN_SENAL_FACTOR` (defecto 3) y revisión del worker configurable | Supuesto del ES2, ahora parametrizable. |
| D-16 | Causa de la falta de datos | — | Siempre «desconocida»; el dispositivo puede informar después un **reinicio**, que tampoco prueba un corte eléctrico | Prompt §11. |
| D-17 | Seeds | — | Historial sintético marcado `lote_ingesta.origen = 'seed'` | Datos de prueba identificados; nunca se presentan como del simulador. |
| D-18 | Tipografía | Google Fonts (MASTER.md) | Fira Sans / Fira Code **auto-alojadas** (@fontsource) | Funciona sin conexión (PWA) y evita solicitudes a terceros. |
| D-19 | Comentario al resolver | Opcional (CU-04) / obligatorio en críticas (Tabla 29) | Obligatorio solo en críticas | Tabla 29 es más específica. |
| D-20 | Destinatarios de avisos en demo | Supervisor y Encargados de la torre | Igual; `NOTIFICACIONES_SOLO_A` (solo demo) redirige **todos** los avisos a una única dirección | Los usuarios sembrados tienen correos ficticios `@aquaplants.cl`; con SMTP real los avisos saldrían a un dominio ajeno. |

## Supuestos a verificar con hardware real
- 512 KB de cola ≈ 40 h sin conexión: depende del tamaño de lote y del intervalo (en el simulador, ~ 360 B por lote de 4–5 lecturas).
- Compatibilidad TLS 1.3 de la placa AquaBrain.
- Autonomía de una UPS/batería: requiere medición física; **no se simula hardware inexistente**.

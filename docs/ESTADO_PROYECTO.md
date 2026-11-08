# Estado del proyecto — AquaPlants / AquaBrain

_Última actualización: 2026-11-08 (sesión 4, PC Windows de Jesus). Abrir este archivo al comenzar cada sesión._

## Sesión 4 — opción sin Docker (Supabase + Neon) para la presentación
- **D-29**: base principal en **Supabase** (PostgreSQL 17, sin TimescaleDB: 002 y 008 omitidas) y payloads crudos en **Neon** (`PgPayloadStore`, reemplaza a MongoDB cuando existe `PAYLOADS_DATABASE_URL`). TLS `verify-full`; la CA de Supabase va en `secretos/supabase-ca.crt`.
- Configuración: copiar `.env.nube.example` a `.env.nube` (fuera de git). Primera vez: `.\iniciar-nube.ps1 -Preparar` (migraciones + seed); luego `.\iniciar-nube.ps1` (API + worker, simulador y web en http://localhost:5173).
- **Verificado manualmente** contra Supabase y Neon reales: `/health` ok, login, simulador → 39 mediciones en Supabase y 9 lotes procesados en Neon en 2 min; adaptador probado aparte (idempotencia, pendientes, procesado, detalle de evento). Supabase ocupa 58 MB con 48 h de historial (plan gratuito: 500 MB).
- **No ejecutado**: la suite automatizada (`npm test`) con `PgPayloadStore`; sigue usando MongoDB y PostgreSQL locales.
- Pendiente menor: en `/health` el almacén de payloads se sigue llamando `mongodb`.

## Sesión 2 — resultado
- **Repositorio**: https://github.com/simonB3215/aquaplants (privado, rama `main`). `.env`, `node_modules`, `packages/simulador/data` y `*.log` excluidos; `.gitattributes` fuerza LF (los scripts de contenedor no se rompen en Windows).
- **CI**: verde desde el commit `c94b0f6` (1.ª ejecución falló por el defecto 6 de `PRUEBAS.md`, corregido).
- **Docker Compose**: verificado **desde cero** con `verificar.ps1` (TimescaleDB 2.17.2 con hipertabla `medicion`, MongoDB 7 con usuario de app, simulador, Nginx en http://localhost:8080, E2E A–G 8/8). Defectos 7–11 corregidos.
- **Pruebas**: 66/66 automatizadas contra TimescaleDB + MongoDB reales (local y CI).
- **SMTP (CP-12)**: **aprobado** con Gmail (alerta crítica #7 `enviada` en ~16 s; el usuario confirmó la recepción). Los avisos van solo a `simon.bueguenio@gmail.com` mediante `NOTIFICACIONES_SOLO_A` (solo demo).
- **Nuevo: aviso por correo al cambiar la contraseña**. Migración `003_notificacion_correo.sql` (tabla `notificacion_correo`); `AuthService.cambiarPassword` programa el aviso en la misma transacción (sin la contraseña) y el worker lo envía (`CorreosCuentaService`, ciclo `correos_cuenta` cada 15 s, 3 intentos, `SKIP LOCKED`). `POST /auth/cambiar-password` ahora responde **200 `{ aviso_correo }`** (antes 204). Probado con Gmail real. El cambio cierra **todas** las sesiones, también la actual (comportamiento previo, ahora explicado en el aviso y en el correo).
- Catálogo de especies (Lechuga, Albahaca, Frutilla, Espinaca, Rúcula) fijo por el seed: **no hay pantalla ni endpoint para agregar especies**; una torre admite un solo cultivo en curso (`cultivo_en_curso_uq`).
- Detalle en `docs/PRUEBAS.md`.

## Arquitectura y stack reales
- Monorepo npm workspaces: `shared` (Zod, Tabla 48) → `backend` (Express 4, pg, mongodb, JWT, bcryptjs) / `simulador` (Node, sin dependencias externas) / `frontend` (React 18, Vite 5, Chart.js 4, React Router 6, Lucide).
- Persistencia: PostgreSQL 16 (+ TimescaleDB 2.17 en Docker), MongoDB 7 (payload crudo TTL 90 d, detalle de eventos).
- Procesos: API (`server.ts`), worker (`worker.ts`: outbox de alertas con SKIP LOCKED, notificaciones, «sin señal», reconciliación), simulador (proceso aparte con API de control), Nginx (web + proxy).
- Capas: rutas → middleware (authJWT, authDispositivo, permitir, validar) → servicios → puertos → adaptadores; composición en `contenedor.ts`.

## Implementado y probado
- CU-01…CU-10 completos en API y UI (ver `docs/API.md`), con alias de rutas para las contradicciones del ES2.
- Autenticación: bcrypt, bloqueo 5 intentos/15 min, JWT 8 h con revocación (versión + jti), cambio de contraseña obligatorio para temporales.
- RBAC en backend según Tabla 48 + filtrado de filas RN-10.
- Ingesta idempotente MongoDB→PostgreSQL con outbox y reconciliación; validación todo-o-nada; tolerancia de reloj; plausibilidad; límite por dispositivo autenticado.
- Motor de alertas (una por situación, contador de ocurrencias, límites copiados), resolución por rol, notificación honesta.
- Continuidad: «sin señal» configurable (causa desconocida), reconexión, reinicio informado, lotes recuperados, descartes, panel dedicado.
- Simulador: cola en disco atómica, capacidad con registro de pérdidas, backoff exponencial con jitter/Retry-After, cortes de red y de energía, reinicio, prueba de credencial inválida, escenarios A–F.
- Frontend: dashboards por rol (Encargado, Supervisor, Administrador) con el mismo sistema visual de UI UX Pro Max; gestión de usuarios, infraestructura, umbrales, auditoría, cultivos; históricos con banda de umbral y huecos; comparar/exportar; modo demo; responsive; PWA (manifest, íconos, SW, actualización, offline).
- Base de datos (bloque 2): migraciones 005–008, roles de mínimo privilegio, respaldo cifrado y restauración CP-29 con acta.
- Registro con **enlace de invitación por torre** (D-28): el Administrador comparte un enlace (vence, tiene cupo, se puede anular); la persona crea su cuenta, confirma su email y queda como Encargado de esas torres.
- Pruebas: 89 automatizadas + 8 E2E aprobadas contra TimescaleDB y MongoDB reales (`docs/PRUEBAS.md`).

## Pendiente (por prioridad)
1. **Dependencias**: resuelto en sesión 3 (D-23): producción sin vulnerabilidades altas/críticas; quedan **2 moderadas** en react-router (corrección = React Router 7, cambio mayor). En desarrollo quedan vite 5 y vitest 2 con avisos que solo afectan al servidor de desarrollo/pruebas (corrección = vite 8 / vitest 5, cambios mayores).
2. CP-27/CP-13 rendimiento con k6; CP-24 TLS; CP-25 SUS; PWA offline re-verificada sobre el stack Docker (con Chrome/Playwright, no el navegador integrado).
3. Despliegue en la nube: **no autorizado aún** por el usuario.
4. CI: resuelto en sesión 3 (`checkout@v7`, `setup-node@v7` con Node 24; `npm audit --omit=dev --audit-level=high` ahora hace fallar el CI).
5. Resuelto en sesión 3 (D-24): compresión 7 d, retención 2 años, agregado horario 5 años, evidencia inmutable de mediciones con alerta; anonimización de usuarios desactivados tras 1 año (D-25).
6. Parcial (D-26): respaldo cifrado con age de PostgreSQL + MongoDB, SHA-256, rotación 7/4/3, aviso por correo si falla y CP-29 aprobado en local. **Falta**: subida a almacenamiento externo (Spaces u otro, depende de la nube) y programar el cron 02:00 en el servidor.
7. Resuelto en sesión 3 (D-27): API y worker usan `app_rw`, respaldo `backup_ro`; superusuario solo en `migrate`. `database/permisos.sql` se reaplica en cada migración.
8. Sugerencias: dependency-cruiser/ESLint/Semgrep/gitleaks en CI; sesión persistente opcional (refresh token httpOnly) si se aprueba cambiar el ES2.

## Problemas y riesgos conocidos
- (Resuelto en sesión 2) Las pruebas ya corren con MongoDB 7 y TimescaleDB 2.17.2 reales.
- `WORKER_SIN_SENAL_CADA_S` debe ser menor que `SIN_SENAL_FACTOR × intervalo` o los cortes breves no se registran.
- Al recargar la página se pierde la sesión (JWT en memoria, decisión del ES2).
- En red local por HTTP la PWA no se instala (requiere HTTPS).
- `npm audit` no revisado en detalle.

## Decisiones / divergencias
Ver `docs/DECISIONES.md` (D-01…D-29). **D-28 diverge del ES2 (CU-09)** y **D-29 del §4.4** (si se usa en la entrega): mencionarlos en el informe. Punto abierto D-25: `log_auditoria.detalle` de crear/editar usuario conserva nombre y email (inmutable por RN-07); el equipo debe decidir.

## UI UX Pro Max
Skill instalada en `.claude/skills/ui-ux-pro-max/` (sin modificar). Sistema de diseño persistido en `design-system/aquaplants/` y aplicado vía `packages/frontend/src/estilos/tokens.css`. Detalle en `docs/DISENO.md`.

## Comandos
```bash
npm install && npm run build:shared
npm run db:migrate && npm run db:seed
npm run dev:api | npm run dev:worker | npm run sim | npm run dev:web
npm test
node tests/e2e/escenarios.mjs
docker compose --profile demo up -d --build
```

## Próximo paso concreto
**Sesión 3 (2026-11-04)**: bloque 1 (seguridad y calidad) y **bloque 2 (base de datos)** terminados. Resultados en `docs/PRUEBAS.md` (84/84, E2E 8/8, CP-29 APROBADA). La clave privada age está en `secretos/age-respaldo.key` (fuera de git; en producción debe guardarse **fuera del servidor**). Copia previa a las migraciones: `respaldos/pre-bloque2.dump`.

Comandos nuevos:
```bash
docker compose --profile backup run --rm backup
docker compose --profile restauracion run --rm restaurar
```

Además: **enlaces de invitación (D-28)** probados con Jest (5 nuevas, 89/89) y en el navegador sobre Docker (migración 009 aplicada).

**Siguiente: bloque 3** (k6 CP-27 con 50 dispositivos × 10 min y CP-13 histórico de 30 días ≤ 3 s; PWA offline re-verificada). Luego bloque 4 (CP-08, documentación final, pantalla de especies opcional). Despliegue en la nube: solo con autorización del usuario.

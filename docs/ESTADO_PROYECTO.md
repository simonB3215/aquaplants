# Estado del proyecto — AquaPlants / AquaBrain

_Última actualización: 2026-11-03 (sesión 2, PC Windows del usuario). Abrir este archivo al comenzar cada sesión._

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
- Pruebas: 66 automatizadas + 8 E2E aprobadas contra TimescaleDB y MongoDB reales (`docs/PRUEBAS.md`).

## Pendiente (por prioridad)
1. **Dependencias**: resuelto en sesión 3 (D-23): producción sin vulnerabilidades altas/críticas; quedan **2 moderadas** en react-router (corrección = React Router 7, cambio mayor). En desarrollo quedan vite 5 y vitest 2 con avisos que solo afectan al servidor de desarrollo/pruebas (corrección = vite 8 / vitest 5, cambios mayores).
2. CP-27/CP-13 rendimiento con k6; CP-24 TLS; CP-25 SUS; CP-29 restauración con acta; PWA offline re-verificada sobre el stack Docker (con Chrome/Playwright, no el navegador integrado).
3. Despliegue en la nube: **no autorizado aún** por el usuario.
4. CI: resuelto en sesión 3 (`checkout@v7`, `setup-node@v7` con Node 24; `npm audit --omit=dev --audit-level=high` ahora hace fallar el CI).
5. Políticas Timescale de compresión/retención + tabla de evidencia de mediciones con alerta antes de borrar chunks (Tabla 40).
6. Respaldo automático cifrado de MongoDB y subida a almacenamiento externo.
7. Roles PostgreSQL de mínimo privilegio con LOGIN (hoy se crean como NOLOGIN y la app usa el usuario del compose).
8. Sugerencias: dependency-cruiser/ESLint/Semgrep/gitleaks en CI; sesión persistente opcional (refresh token httpOnly) si se aprueba cambiar el ES2.

## Problemas y riesgos conocidos
- (Resuelto en sesión 2) Las pruebas ya corren con MongoDB 7 y TimescaleDB 2.17.2 reales.
- `WORKER_SIN_SENAL_CADA_S` debe ser menor que `SIN_SENAL_FACTOR × intervalo` o los cortes breves no se registran.
- Al recargar la página se pierde la sesión (JWT en memoria, decisión del ES2).
- En red local por HTTP la PWA no se instala (requiere HTTPS).
- `npm audit` no revisado en detalle.

## Decisiones / divergencias
Ver `docs/DECISIONES.md` (D-01…D-23).

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
**Sesión 3 (2026-11-04)**: bloque 1 (seguridad y calidad) terminado: dependencias (D-23), CI con acciones v7, D-21/D-22 registradas. Usuario de prueba `prueba-olvido@aquaplants.cl` desactivado e imagen web reconstruida. Pendiente: confirmar en simon.bueguenio@gmail.com los correos de prueba «Tu contraseña fue cambiada» y «Restablecer tu contraseña».

**Siguiente: bloque 2** (políticas TimescaleDB de compresión/retención con evidencia de alertas — Tabla 40; roles PostgreSQL de mínimo privilegio; respaldo cifrado + CP-29 en local). Luego bloque 3 (k6 CP-27/CP-13, PWA offline) y bloque 4 (cierre).

Después: planificar la actualización de dependencias por `npm audit` (pendiente 1) y decidir el despliegue en la nube (requiere autorización del usuario). Para repetir CP-12: resolver la alerta crítica activa del sensor (una alerta por situación) y lanzar de nuevo el escenario B.

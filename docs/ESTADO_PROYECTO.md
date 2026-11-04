# Estado del proyecto — AquaPlants / AquaBrain

_Última actualización: 2026-11-03 (sesión 1). Abrir este archivo al comenzar cada sesión._

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
- Pruebas: 64 automatizadas + 8 E2E aprobadas (`docs/PRUEBAS.md`).

## Pendiente (por prioridad)
1. **Ejecutar en Docker Compose real** (`docker compose --profile demo up --build`): Dockerfile y compose están escritos pero no se pudieron construir aquí (Docker Hub bloqueado). Verificar también que `002_timescale.sql` crea la hipertabla con la FK de `alerta`.
2. Ejecutar CI en GitHub (requiere crear el repositorio remoto).
3. CP-27/CP-13 rendimiento con k6; CP-24 TLS; CP-25 SUS; CP-28/29 despliegue y restauración con acta.
4. Políticas Timescale de compresión/retención + tabla de evidencia de mediciones con alerta antes de borrar chunks (Tabla 40).
5. Respaldo automático cifrado de MongoDB y subida a almacenamiento externo.
6. Roles PostgreSQL de mínimo privilegio con LOGIN (hoy se crean como NOLOGIN y la app usa el usuario del compose).
7. Sugerencias: dependency-cruiser/ESLint/Semgrep/gitleaks en CI; sesión persistente opcional (refresh token httpOnly) si se aprueba cambiar el ES2.

## Problemas y riesgos conocidos
- Pruebas ejecutadas con FerretDB en lugar de MongoDB y sin TimescaleDB (ver PRUEBAS.md).
- Al recargar la página se pierde la sesión (JWT en memoria, decisión del ES2).
- En red local por HTTP la PWA no se instala (requiere HTTPS).
- `npm audit` no revisado en detalle.

## Decisiones / divergencias
Ver `docs/DECISIONES.md` (D-01…D-19).

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
En el PC del usuario: `cp .env.example .env`, ajustar secretos, `docker compose --profile demo up -d --build`, abrir http://localhost:8080, ejecutar `node tests/e2e/escenarios.mjs http://localhost:8080/api/v1` y registrar el resultado aquí. Dependencia: Docker Desktop instalado.

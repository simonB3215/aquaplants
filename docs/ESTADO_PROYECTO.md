# Estado del proyecto — AquaPlants / AquaBrain

_Última actualización: 2026-11-23 (sesión 8, PC Windows del usuario). Abrir este archivo al comenzar cada sesión._

## Sesión 9 — Menú lateral con desplazamiento y filtro por mes (2026-11-24)
Filtro **por mes** (últimos 12 meses) además del filtro por fechas en Informe de gestión, Históricos y Comparar/Exportar; y en **CRUD → Cultivos** filtro por fecha de inicio (mes o rango) y especie; en **Torres** y **CRUD → Torres y equipos** filtro por lectura actual (temperatura, pH…: más alta/baja primero, mayor/menor o igual que). **Tiempo de cosecha** (días de cultivo) en tarjetas, ficha de torre y filtro de Torres (solo app principal); aviso «un cultivo por torre: otro lote = otra torre»; **cosecha estimada y duración por especie** (promedio del historial, opción A; la opción B con días por especie queda como posible mejora). Solo frontend.
Con muchas opciones (Administrador) el menú lateral de escritorio no se desplazaba y «Perfil» y «Cerrar sesión» quedaban fuera de la pantalla. Ahora solo la lista se desplaza y el logo y «Cerrar sesión» quedan fijos (`app.css`). Pruebas en `docs/PRUEBAS.md` (sesión 9).

## Sesión 8 — Nombre automático de torre (2026-11-23, D-40)
- Al crear una torre el nombre es automático y de solo lectura («Torre C») y el ID lo da la base; se muestra «ID n» en cada torre. Probado: typecheck, shared 9/9, frontend 82/82, backend sin base 97/97, pantalla con la API simulada. 

## Sesión 8 — Evaluación 3: informe de gestión y presentación (2026-11-23, D-39)
- **Informe de gestión** (`/informe`, Supervisor y Administradores): periodo, cliente, 6 indicadores, gráfico diario de alertas e incidencias, detalle por torre, cultivos por especie, actividad de usuarios (solo Administrador); «Imprimir o PDF» y CSV. API `GET /informes/gestion`.
- **Probado**: typecheck; shared 8/8; backend sin base 97/97; frontend 82/82 (nueva `informe.test.tsx`); la consulta corrió contra **Supabase real** (solo lectura, 2,6 s para 30 días; el Supervisor ve solo las 2 torres de su cliente); pantallas con la API simulada (escritorio, móvil 375 px y por rol). **Sin probar en local**: `test/informe.test.ts` (con PostgreSQL, corre en el CI) y la impresión real a PDF.
- **Presentación**: guion de 9 minutos y plan de contingencia (hotspot, «Mantener despierto», sesiones abiertas) en `docs/PRESENTACION.md`.
- **Pendiente del equipo**: informe Word de la Evaluación 3 (entrega 24-11-2026 13:00).

## Sesión 8 — CRUD completo para la demostración final (2026-11-23, D-38)
- **Especies**: el formulario muestra el rango permitido de cada variable («Permitido: 0 a 14 pH») y avisa si un valor queda fuera.
- **Corregido**: en los formularios en ventana el cursor saltaba a la «X» con cada tecla (afectaba a todos los modales). Prueba de regresión en `modal.test.tsx`.
- **Apartado «CRUD»** (`/crud`, menú Gestión → CRUD, solo Administrador): una pestaña por entidad (Clientes, Especies, Torres y equipos, Umbrales, Cultivos, Usuarios, Incidencias, Auditoría). La pestaña elegida queda en la dirección (`?tab=`). Cultivos de todas las torres en una tabla (nuevo, corregir, cerrar). Probado: frontend 76/76, build, API simulada en escritorio y móvil. Sin cambios en backend ni base de datos.
- **Especies** con CRUD (migración **013**, `GET/POST/PATCH /especies`, pantalla Gestión → Especies) y botón **«Corregir»** del cultivo en curso. Con esto todas las entidades tienen crear, ver, editar y dar de baja (baja lógica). Guion paso a paso: `docs/GUION_CRUD.md`.
- **Probado en local**: typecheck; shared 8/8; backend sin base 88/88 (`rolesAnexoC`); frontend 72/72 (nuevas `especies.test.tsx`, `modal.test.tsx`); build; pantallas con la API simulada. **Sin probar**: `test/especies.test.ts` y la migración 013 (necesitan PostgreSQL: correrán en el CI).
- **Orden para publicar** (cada paso con autorización): 1) subir rama y CI verde; 2) migración 013 en Supabase (el código anterior sigue funcionando: la columna tiene DEFAULT); 3) unir a `main`.

## Sesión 8 — Sugerencias recibidas (2026-11-22)
- **1. Indicador de alertas (campana + número en el menú y en la barra del celular): publicado el 2026-11-22 (`98b34bd`); visto en producción con sesión de Administrador el 2026-11-22 (campana en 0, sin alertas activas)** (`componentes/IndicadorAlertas.tsx`; ver PRUEBAS, sesión 8).
- **3. Filtros de usuarios (texto, rol, estado): publicados el 2026-11-22 (`fcb33e9`); vistos en producción con sesión de Administrador el 2026-11-22 (no se probó filtrar).** Incluye el arreglo del desborde de tablas en celular. Sin paginación.
- **Filtros de torres (texto, estado, conexión), pedido del usuario: publicados el 2026-11-22 (`e181077`); el usuario confirmó que se ven bien con su sesión.**
- **2. GPS por dispositivo, 4. rol Técnico con incidencias, 5. clientes → Supervisor → Encargados + Administrador principal (Anexo C, D-37): **publicadas el 2026-11-22** (`main` = `ee62381`; Render sirve las rutas nuevas y Vercel la web nueva; **vistas en producción con sesión de Administrador el 2026-11-22**, ver PRUEBAS; falta verlas como Supervisor, Encargado y Técnico).** Cambian la Tabla 48 (5 roles, 16 funcionalidades), RN-10 y CU-09.
  - **Probado**: typecheck completo; shared 8/8; backend sin base de datos 103/103 (incluye `rolesAnexoC.test.ts`, 88 casos de la matriz de permisos y alcance); simulador 6/6; frontend 66/66 (incluye `rolesPantallas.test.tsx`); build del frontend; pantallas vistas en el navegador con una API simulada local (Técnico, Supervisor, Administrador).
  - **CI verde** en la rama `estructura-clientes` subida a GitHub (ejecución 45074918100, `e5102bb`): migración 012, SQL y aislamiento entre clientes probados en las bases de prueba del CI. **Migración 012 aplicada en Supabase y código publicado el 2026-11-22.** **Datos de muestra cargados en Supabase el 2026-11-23** con `npm run demo:personas -w packages/backend` (autorizado por el usuario; el proyecto es de muestra pero con varias personas): clientes «Agrícola Los Aromos» (ex «Cliente inicial», torres A y B) y «Huerta Norte» (torre C); 10 cuentas: Ana (Administrador principal), Rodrigo Rojas (Administrador), Sergio y Carla Muñoz (Supervisores), Elena, Marcela Díaz, Tomás y Diego Pérez (Encargados), Teo Técnico (ambos clientes) y Paula Soto (Huerta Norte); GPS de muestra en AquaBrain-A y B. Las cuentas nuevas copian el hash de la cuenta del seed de su rol (técnicos: la del Supervisor). Contraseñas propias para las 6 cuentas nuevas, generadas a pedido del usuario y guardadas solo en `secretos/cuentas-demo.txt` (fuera de git). **Revisado en producción con sesión de cada rol el 2026-11-23** (Administrador principal, Administrador, Supervisor, Encargado y los 2 Técnicos): aislamiento entre clientes correcto (ver PRUEBAS). El filtro de rol de Usuarios ahora ofrece solo los roles presentes en la lista y se oculta si hay uno solo (Supervisor): corregido el 2026-11-23, sin publicar. Sin probar en producción: crear un cliente, guardar un GPS desde la pantalla y cerrar una incidencia. Tras `admin:principal`, la sesión abierta de esa cuenta deja de servir en a lo sumo 30 s.
  - **Orden para publicar** (cada paso requiere autorización): 1) CI verde en la rama; 2) aplicar la migración 012 en Supabase (Render no migra solo; el `DEFAULT 1` deja funcionando el código anterior mientras tanto); 3) unir a `main` (Render y Vercel se actualizan); 4) designar a los Administradores principales con `npm run admin:principal -w packages/backend -- --email <correo>` (con la conexión de Supabase en el entorno); 5) crear los clientes reales y mover sus torres desde «Cliente inicial».
- Corregido el 2026-11-23: el fondo del modal «Resolver» cubría solo la tarjeta (ahora se monta en `<body>`).

## Sesión 5 — Docker eliminado del repositorio; publicación en Render + Supabase + Vercel (D-30, D-36)
- **D-36** (2026-11-10): la web pasó de Netlify a **Vercel** (`https://aquaplants.vercel.app`, `vercel.json`); `netlify.toml` eliminado. `CORS_ORIGIN` y `APP_URL` en Render ya apuntan a Vercel (CORS verificado el 2026-11-10). Sitio de Netlify deshabilitado por el usuario (404); la web queda solo en Vercel.
- **CP-27** aprobada (50 dispositivos × 10 min: 2.999/2.999 lotes, p95 276 ms). Escenario B ahora avisa si la alerta crítica ya está activa y no habrá correo nuevo (correo confirmado por el usuario el 2026-11-10).
- **D-31**: la sesión ya no se pierde al refrescar (cookie httpOnly `aq_sesion` + `POST /auth/sesion`, 8 h). **D-32**: en Perfil cada usuario elige «Todas las alertas críticas» o «Solo las urgentes» (activa tras 30 min); el Administrador también «No recibir alertas». Migración 010. Ambas divergen del ES2: mencionarlas en el informe.
- **Publicación elegida por el usuario**: web en **Netlify**, API (+ worker) y simulador en **Render**, bases en **Supabase** + **Neon**. Preparados `render.yaml` y `netlify.toml` (pasos en `docs/DESPLIEGUE.md`). **Publicado** (2026-11-08): web https://aquaplants-app.netlify.app, API https://aquaplants-api.onrender.com, simulador https://aquaplants-simulador.onrender.com (región Virginia). `aquaplants.netlify.app` pertenece a un tercero: no usarlo. El simulador envía directo a la API de Render.
- El certificado público de Supabase va en el repositorio (`certificados/supabase-ca.crt`) y `sslrootcert` acepta rutas relativas al proyecto: `.env.nube` sirve igual en cualquier computador. Supabase con «Enforce SSL» activado; conexión por Session pooler.
- **D-33** (2026-11-09): los correos de alerta fallaban en Render («Connection timeout»: Render free bloquea SMTP). Nuevo `ResendNotificador` (API HTTPS); activo en Render con `RESEND_API_KEY`: aviso de alerta crítica `enviada` al primer intento (verificado en producción). Pruebas `notificador.test.ts` 4/4 (local).
- Asignación de torres (usuario, invitación) y de responsables (torre) con **buscador, «Seleccionar todas/visibles», «Ninguna» y contador** (`componentes/SeleccionMultiple.tsx`). Solo interfaz; respuesta a «¿y con miles de torres?». Trabajo futuro para el informe: agrupar torres por zona/sitio y asignar zonas, paginación/filtros en el panel y avisos agrupados.
- **D-35** (2026-11-10, publicado): caudal, consumo hídrico y fotoperiodo (migración 011 + 9 sensores en producción); calidad del enlace (RSSI) en tarjetas y Continuidad; el simulador sincroniza sus sensores con `GET /telemetria/configuracion`; retención de 30 días sin TimescaleDB (`RETENCION_MEDICIONES_DIAS`, `fn_purgar_mediciones`). CI 97/97. **CP-27 aprobada** (50 dispositivos × 10 min contra la publicación: 2.999/2.999 lotes, p95 276 ms, consistencia exacta; `pruebas/carga/`). Pendiente: CP-13 rendimiento del histórico.
- **D-34** (diseño, 2026-11-10): base de datos física principal con réplica en la nube; qué pasa si falla, conmutación y regreso en `docs/BD_FISICA_Y_NUBE.md`. No implementado (hoy no hay servidor físico).
- Render free duerme los servicios tras 15 min sin tráfico. Para el día de la presentación: workflow manual **«Mantener despierto»** (`.github/workflows/mantener-despierto.yml`, 1–24 h, llama cada 10 min). Medido 2026-11-09: con el simulador activo entran ~5.400 mediciones/h ≈ 27 MB/día en Supabase (61 MB usados de 500 MB, sin retención automática por falta de TimescaleDB): sirve para días sueltos, no para dejarlo prendido semanas.
- `TRUST_PROXY` ahora acepta un número de proxies (Netlify → Render = 2); prueba nueva `config.test.ts` (5/5).
- **Decisión del usuario**: se borraron `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `verificar.ps1` e `infrastructure/` (Nginx, usuarios de MongoDB, respaldo/restauración). Quedan en el historial de git (commit `885105d`). Las variables de SMTP y `NOTIFICACIONES_SOLO_A` pasaron a `.env.nube.example`.
- Se conservan: el adaptador de MongoDB (si no hay `PAYLOADS_DATABASE_URL`) y el CI de GitHub Actions, que levanta PostgreSQL/TimescaleDB y MongoDB de prueba en los servidores de GitHub para correr la suite.
- Consecuencias: **sin respaldo cifrado ni prueba de restauración** (D-26/CP-29) hasta definir uno para Supabase + Neon; la suite ya no se puede correr en este PC sin bases de prueba locales.

## Sesión 4 — Supabase + Neon (configuración vigente; Docker ya no se usa)
- **Decisión del usuario**: el proyecto se ejecuta **solo** con Supabase + Neon. En la sesión 4 los archivos de Docker quedaron como referencia; **en la sesión 5 se eliminaron** (ver arriba). Consecuencias: el respaldo cifrado y la prueba de restauración CP-29 (D-26) y la suite automatizada / CI no están adaptados a la nube (pendiente si el equipo los necesita).
- **D-29**: base principal en **Supabase** (PostgreSQL 17, sin TimescaleDB: 002 y 008 omitidas) y payloads crudos en **Neon** (`PgPayloadStore`, reemplaza a MongoDB cuando existe `PAYLOADS_DATABASE_URL`). TLS `verify-full`; certificado público en `certificados/supabase-ca.crt` (sesión 5).
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
> Lo siguiente describe la arquitectura hasta la sesión 3. Desde la sesión 4 la persistencia es Supabase (PostgreSQL 17, sin TimescaleDB) + Neon (payloads) y no se usa Docker ni Nginx (ver arriba y D-29).

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
2. **CP-13 aprobada** (2026-11-23, en producción: 30 días ≤ 1,3 s, ver PRUEBAS; con el volumen real de Supabase, no con 30 días continuos). **CP-24 aprobada** (2026-11-23: HTTPS válido en Vercel y Render, HSTS de 1 año, HTTP → 308 a HTTPS). Pendientes: CP-25 SUS (encuesta con personas, la hace el equipo) y PWA offline re-verificada (con Chrome/Playwright, no el navegador integrado).
3. Publicación: **hecha** (D-30, D-36): web en Vercel, API + worker y simulador en Render, bases en Supabase + Neon. Cada push a `main` despliega solo; las migraciones en Supabase se aplican a mano.
4. CI: resuelto en sesión 3 (`checkout@v7`, `setup-node@v7` con Node 24; `npm audit --omit=dev --audit-level=high` ahora hace fallar el CI).
5. Resuelto en sesión 3 (D-24): compresión 7 d, retención 2 años, agregado horario 5 años, evidencia inmutable de mediciones con alerta; anonimización de usuarios desactivados tras 1 año (D-25).
6. **Cerrado por decisión del usuario** (D-26b, 2026-11-10): no se hará respaldo propio de Supabase + Neon; queda como divergencia y trabajo futuro. Antes (D-26): el respaldo cifrado y CP-29 funcionaban con contenedores Docker y se retiraron en la sesión 5. Falta definir el respaldo de Supabase + Neon y repetir la prueba de restauración.
7. Resuelto en sesión 3 (D-27): API y worker usan `app_rw`, respaldo `backup_ro`; superusuario solo en `migrate`. `database/permisos.sql` se reaplica en cada migración.
8. Sugerencias: dependency-cruiser/ESLint/Semgrep/gitleaks en CI. (Sesión persistente: hecha en D-31.)

## Problemas y riesgos conocidos
- (Resuelto en sesión 2) Las pruebas ya corren con MongoDB 7 y TimescaleDB 2.17.2 reales.
- `WORKER_SIN_SENAL_CADA_S` debe ser menor que `SIN_SENAL_FACTOR × intervalo` o los cortes breves no se registran.
- (Resuelto en sesión 5, D-31) Al recargar la página ya no se pierde la sesión.
- Supabase no tiene TimescaleDB: las mediciones no se comprimen ni se borran solas (~27 MB/día con el simulador activo; límite free 500 MB).
- En red local por HTTP la PWA no se instala (requiere HTTPS).
- `npm audit` no revisado en detalle.

## Decisiones / divergencias
Ver `docs/DECISIONES.md` (D-01…D-40). **Divergencias del ES2 a mencionar en el informe**: D-28 (CU-09, registro por invitación), D-29 (§4.4, Supabase + Neon), D-30 (infraestructura: Render + Netlify), D-31 (§6.1, sesión persistente), D-32 (RF-11, preferencia de avisos), D-36 (web en Vercel) y D-37 (Anexo C: clientes, 5 roles, incidencias, GPS). Punto abierto D-25: `log_auditoria.detalle` de crear/editar usuario conserva nombre y email (inmutable por RN-07); el equipo debe decidir.

## UI UX Pro Max
Skill instalada en `.claude/skills/ui-ux-pro-max/` (sin modificar). Sistema de diseño persistido en `design-system/aquaplants/` y aplicado vía `packages/frontend/src/estilos/tokens.css`. Detalle en `docs/DISENO.md`.

## Comandos
```bash
npm install && npm run build:shared
npm run db:migrate && npm run db:seed
npm run dev:api | npm run dev:worker | npm run sim | npm run dev:web
npm test
node tests/e2e/escenarios.mjs
.\iniciar-nube.ps1            # API + worker, simulador y web (Supabase + Neon)
```

## Próximo paso concreto
**Sesión 8 (2026-11-22/23)**: sugerencias 1–5 del Anexo C publicadas y revisadas en producción con sesión de cada rol; personas de muestra cargadas (`npm run demo:personas`, contraseñas en `secretos/cuentas-demo.txt`, fuera de git); CP-13 y CP-24 aprobadas; modal con fondo a pantalla completa.

Siguiente: «Atender» ya probado en producción; faltan cerrar una incidencia con el simulador enviando, guardar un GPS y crear un cliente (sesión de Administrador); PWA offline con Chrome.

Decisiones del equipo: CP-25 SUS; D-25 (nombre y email en la auditoría); quitar las contraseñas por defecto del código (el usuario dijo «todavía no»); dominio de los correos de muestra (`@aquaplants.cl` podría existir; hoy no reciben nada por `NOTIFICACIONES_SOLO_A`).

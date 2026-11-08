# AquaPlants / AquaBrain

Plataforma web (responsive + PWA) para monitorear cultivos hidropónicos y aeropónicos: autenticación y roles, gestión de torres, dispositivos, sensores, umbrales y cultivos, telemetría por API, históricos, alertas, auditoría y **continuidad operativa** ante cortes de Internet y de energía.

Flujo: **AquaBrain (o simulador) → API REST → Supabase (PostgreSQL) + Neon (payloads crudos) → dashboard → acciones del usuario.**

> Estado real, pruebas ejecutadas y pendientes: [`docs/ESTADO_PROYECTO.md`](docs/ESTADO_PROYECTO.md). Divergencias con el ES2: [`docs/DECISIONES.md`](docs/DECISIONES.md).

## Estructura

```
packages/shared      Contratos Zod, matriz de autorización (Tabla 48), tipos
packages/backend     API Express + worker (motor de alertas, «sin señal», reconciliación)
packages/simulador   AquaBrain virtual con cola persistente en disco y API de control
packages/frontend    SPA React + Vite + Chart.js, PWA
database/migrations  Esquema SQL versionado (001 base, 002 TimescaleDB condicional)
design-system/       Sistema de diseño generado con UI UX Pro Max (MASTER.md + overrides)
.claude/skills/      Skill UI UX Pro Max (copia original, sin modificar, licencia MIT)
infrastructure/      Nginx, inicialización de MongoDB, respaldo/restauración
tests/e2e            Escenarios de demostración A–G contra el stack real
docs/                Estado, decisiones, API, pruebas, demo y evidencias
```

## Cómo ejecutarlo — Supabase + Neon (configuración vigente)

Desde la sesión 4 (D-29) el proyecto **no usa Docker**: la base principal está en **Supabase** (PostgreSQL) y los payloads crudos en **Neon** (PostgreSQL, en lugar de MongoDB). La API (+ worker), el simulador y la web se ejecutan con npm en el PC.

Requisitos: Node 22+ y conexión a Internet.

```powershell
npm install
copy .env.nube.example .env.nube      # completar DATABASE_URL (Supabase) y PAYLOADS_DATABASE_URL (Neon)
# Certificado de Supabase (Project Settings → Database → SSL Configuration → Download certificate):
#   guardarlo como secretos\supabase-ca.crt
.\iniciar-nube.ps1 -Preparar          # SOLO la primera vez con una base vacía: migraciones + datos de prueba
.\iniciar-nube.ps1                    # abre API, simulador y web → http://localhost:5173
```

- `.env.nube`, `secretos/` y `packages/simulador/data/` (credenciales de los dispositivos) están fuera de git: se comparten por privado.
- Supabase no tiene TimescaleDB: las migraciones 002 y 008 se omiten (sin compresión, retención de 2 años ni agregado horario).
- Usuarios de prueba: los de la sección siguiente, con las contraseñas `SEED_PASSWORD_*` de `.env.nube`.

> Las secciones siguientes (Docker Compose, MongoDB, desarrollo con bases locales) describen la **configuración anterior**. Se conservan como referencia pero **ya no se usan**.

## (Anterior, no se usa) Opción A — Docker Compose

Requisitos: Docker Desktop (Windows/macOS) o Docker Engine + Compose v2.

```bash
cp .env.example .env          # Windows: copy .env.example .env  — cambie TODOS los secretos
docker compose --profile demo up -d --build
```

- Aplicación: http://localhost:8080
- Usuarios de prueba (solo si `SEMBRAR_DATOS_PRUEBA=true`): `admin@aquaplants.cl`, `supervisor@aquaplants.cl`, `encargado@aquaplants.cl` (torres A y B), `encargado2@aquaplants.cl` (torre C); contraseñas en `.env` (`SEED_PASSWORD_*`).
- Sin el perfil `demo` no se inicia el simulador.
- Los datos persisten en volúmenes (`pgdata`, `mongodata`, `simdatos`): `docker compose down` los conserva; `docker compose down -v` los borra.

### Desde un teléfono en la misma red
1. Averigüe la IP del computador (`ipconfig` en Windows, p. ej. `192.168.1.20`).
2. En `.env`: `CORS_ORIGIN=http://192.168.1.20:8080` y reinicie (`docker compose up -d`).
3. En el teléfono abra `http://192.168.1.20:8080`. Permita el puerto 8080 en el firewall de Windows si es necesario.
4. La instalación como app (PWA) y el service worker requieren **HTTPS** salvo en `localhost`; en red local por HTTP la app funciona pero no se instala. Para instalarla use HTTPS (ver `docs/DESPLIEGUE.md`).

## (Anterior, no se usa) Opción B — Desarrollo con bases locales

Requisitos: Node 22 LTS, PostgreSQL 16 (TimescaleDB opcional) y MongoDB 7 accesibles.

```bash
npm install
npm run build:shared
# variables (ver .env.example): DATABASE_URL, MONGO_URL, JWT_SECRET, …
npm run db:migrate
SEED_INTERVALO_S=10 npm run db:seed          # crea usuarios/torres y packages/simulador/data/dispositivos.json
WORKER_EN_API=true DEMO_MODE=true SIM_CONTROL_TOKEN=x npm run dev:api
SIM_CONTROL_TOKEN=x npm run sim               # otra terminal
npm run dev:web                               # http://localhost:5173 (también desde el teléfono: http://IP:5173)
```

## Pruebas

```bash
npm test                                   # shared + backend (Jest/Supertest con BD reales) + simulador + frontend
node tests/e2e/escenarios.mjs              # escenarios A–G contra el stack en ejecución (DEMO_MODE)
```
La suite automatizada todavía usa la configuración anterior (PostgreSQL/TimescaleDB y MongoDB locales); no se ha ejecutado contra Supabase + Neon. Las pruebas de backend usan `TEST_DATABASE_URL` (por defecto `postgres://postgres@127.0.0.1:5432/aquaplants_test`) y `TEST_MONGO_URL`; **reinician el esquema de esa base**.

## Documentación
- [Estado del proyecto](docs/ESTADO_PROYECTO.md) · [Decisiones](docs/DECISIONES.md) · [API](docs/API.md) · [Pruebas](docs/PRUEBAS.md) · [Demostración](docs/DEMO.md) · [Despliegue y respaldos](docs/DESPLIEGUE.md) · [Diseño](docs/DISENO.md)
- OpenAPI en vivo: `GET /api/v1/openapi.json`

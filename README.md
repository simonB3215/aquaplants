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
tests/e2e            Escenarios de demostración A–G contra el stack real
docs/                Estado, decisiones, API, pruebas, demo y evidencias
```

## Cómo ejecutarlo — Supabase + Neon (configuración vigente)

El proyecto **no usa Docker** (D-29): la base principal está en **Supabase** (PostgreSQL) y los payloads crudos en **Neon** (PostgreSQL, en lugar de MongoDB). La API (+ worker), el simulador y la web se ejecutan con npm en el PC.

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

### Desde un teléfono en la misma red
1. Averigüe la IP del computador (`ipconfig` en Windows, p. ej. `192.168.1.20`).
2. En `.env.nube`: `CORS_ORIGIN=http://192.168.1.20:5173` y vuelva a ejecutar `.\iniciar-nube.ps1`.
3. En el teléfono abra `http://192.168.1.20:5173`. Permita el puerto 5173 en el firewall de Windows si es necesario.
4. La instalación como app (PWA) y el service worker requieren **HTTPS** salvo en `localhost`; en red local por HTTP la app funciona pero no se instala.

## Pruebas

```bash
npm test                                   # shared + backend (Jest/Supertest con BD reales) + simulador + frontend
node tests/e2e/escenarios.mjs              # escenarios A–G contra la API en ejecución (DEMO_MODE, http://localhost:3000/api/v1)
```
La suite automatizada necesita un PostgreSQL (TimescaleDB opcional) y un MongoDB de prueba: en GitHub Actions los levanta el CI; no se ha ejecutado contra Supabase + Neon. Las pruebas de backend usan `TEST_DATABASE_URL` (por defecto `postgres://postgres@127.0.0.1:5432/aquaplants_test`) y `TEST_MONGO_URL`; **reinician el esquema de esa base**.

## Documentación
- [Estado del proyecto](docs/ESTADO_PROYECTO.md) · [Decisiones](docs/DECISIONES.md) · [API](docs/API.md) · [Pruebas](docs/PRUEBAS.md) · [Demostración](docs/DEMO.md) · [Despliegue y respaldos](docs/DESPLIEGUE.md) · [Diseño](docs/DISENO.md)
- OpenAPI en vivo: `GET /api/v1/openapi.json`

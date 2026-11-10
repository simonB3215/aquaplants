# API REST v1

Base: `/api/v1`. Contrato OpenAPI 3 en `GET /api/v1/openapi.json`; validación real con los esquemas Zod de `packages/shared`.
Errores uniformes (Tabla 11): `{ "codigo": "...", "mensaje": "...", "campos": [{ "campo", "mensaje" }] }`.

## Autenticación
- **Usuarios**: `POST /auth/login` → JWT (8 h) en `Authorization: Bearer`. Bloqueo de 15 min tras 5 intentos (423). Revocación por `version_token` (desactivar, cambiar rol o contraseña) y por `jti` al cerrar sesión.
- **Dispositivos**: credencial de 256 bits en `Authorization: Bearer`; el servidor guarda solo su SHA-256. Un JWT de usuario **no** sirve para telemetría (401).

## Endpoints y permisos (Tabla 48 aplicada en el backend)

| Método y ruta | CU | Encargado | Supervisor | Admin |
|---|---|---|---|---|
| `POST /telemetria`, `POST /telemetria/eventos` | 01 | — (solo dispositivo) | — | — |
| `GET /telemetria/configuracion` (D-35) | 01 | — (solo dispositivo: sensores activos e intervalo) | — | — |
| `POST /auth/login`, `/auth/logout`, `GET /auth/me`, `POST /auth/cambiar-password` (200 `{aviso_correo}`; programa aviso por correo al titular) | 02 | ✔ | ✔ | ✔ |
| `POST /auth/sesion` (D-31: reanuda la sesión con la cookie httpOnly `aq_sesion`; pública, 60/min por IP) | 02 | ✔ | ✔ | ✔ |
| `PATCH /auth/avisos` (D-32: `todas` \| `urgentes` \| `ninguna`; `ninguna` solo Administrador → 422 para los demás) | 02 | ✔ | ✔ | ✔ |
| `GET /torres/estado`, `GET /torres/{id}/estado` | 03 | sus torres | ✔ | ✔ |
| `GET /alertas` | 04 | sus torres | ✔ | ✔ |
| `PATCH /alertas/{id}/resolver` (alias `PATCH /alertas/{id}`) | 04 | advertencias | ✔ (crítica: comentario obligatorio) | ✔ |
| `GET /mediciones/historico` (alias `GET /historicos`) | 05 | sus torres | ✔ | ✔ |
| `GET /mediciones/comparar`, `GET /historicos/export` (CSV) | 06 | 403 | ✔ | ✔ |
| `GET /sensores/{id}/umbrales` | 07 | lectura | lectura | ✔ |
| `PUT /sensores/{id}/umbrales`, `PUT /umbrales/{id}`, `PATCH /umbrales/{id}/desactivar` | 07 | 403 | 403 | ✔ |
| `GET /torres`, `GET /dispositivos`, `GET /catalogos` | 08 | lectura (sus torres) | lectura | ✔ |
| `POST/PATCH /torres…`, `/dispositivos…` (alta con credencial, baja, regenerar), `POST /sensores`, `PATCH /sensores/{id}/baja`, `PUT /torres/{id}/usuarios` | 08 | 403 | 403 | ✔ |
| `GET/POST /usuarios`, `PATCH /usuarios/{id}`, `POST /usuarios/{id}/restablecer-password`, `GET /roles` | 09 | 403 | 403 | ✔ |
| `GET/POST /invitaciones`, `PATCH /invitaciones/{id}/anular` (D-28) | 09 | 403 | 403 | ✔ |
| `POST /auth/invitacion`, `POST /auth/registro`, `POST /auth/registro/confirmar` (D-28, públicas, límite por IP) | 09 | ✔ | ✔ | ✔ |
| `GET /auditoria` | 09 | 403 | 403 | ✔ |
| `PUT/DELETE /auditoria/{id}` | 09 | 405 | 405 | 405 (RN-07) |
| `GET /cultivos`, `POST /cultivos`, `PATCH /cultivos/{id}`, `PATCH /cultivos/{id}/cerrar` | 10 | sus torres | lectura | ✔ |
| `GET /eventos`, `GET /continuidad` | — | sus torres | ✔ | ✔ |
| `GET /health` | RF-14 | público | | |
| `GET /demo/estado`, `POST /demo/escenarios/{A..G}` | demo | — | — | ✔ (solo `DEMO_MODE=true`) |

## Telemetría (CU-01)

```http
POST /api/v1/telemetria
Authorization: Bearer <credencial del dispositivo>
Content-Type: application/json

{ "id_lote": "3b1f7c2e-8a4d-4c1e-9b7a-1f2d3c4b5a69", "id_dispositivo": 7,
  "lecturas": [ { "id_sensor": 31, "ts": "2026-11-03T14:04:00Z", "valor": 6.12 } ],
  "meta": { "pendientes": 0, "recuperado": false } }
```

| Respuesta | Significado | Acción del dispositivo |
|---|---|---|
| 201 `{recibidas, duplicado:false}` | Persistido (MongoDB «recibido» → transacción PostgreSQL) | Libera el lote |
| 200 `{duplicado:true}` | Lote ya procesado | Libera el lote |
| 400 | JSON malformado | Rechaza |
| 401 | Credencial inválida o dispositivo de baja | Mueve a rechazados |
| 422 | Esquema/RN-01/RN-09 (todo o nada) | Rechaza |
| 422 `RELOJ_DESFASADO` | > 2 min en el futuro o > 48 h de antigüedad | Futuro: conserva y reintenta · Antiguo: descarta e informa |
| 429 | Límite por dispositivo (tras autenticar) | Reintento con `Retry-After` |
| 503 + `Retry-After` | PostgreSQL o MongoDB no disponible | Conserva y reintenta con espera exponencial |

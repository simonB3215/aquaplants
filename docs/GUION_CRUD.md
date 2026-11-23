# Guion de demostración — CRUD completo

Web: https://aquaplants.vercel.app · Cuentas y contraseñas: `secretos/cuentas-demo.txt` (fuera de git, no proyectar).

**Antes de empezar** (unos 10 minutos antes):
1. Abrir `https://aquaplants.vercel.app/api/v1/health` para despertar la API de Render (tarda ~20 s la primera vez).
2. En GitHub, lanzar el workflow **«Mantener despierto»** por el tiempo de la presentación.
3. Si se mostrarán datos en vivo, encender el simulador (Render).

En todas las entidades **«eliminar» es una baja lógica**: el registro queda «De baja», deja de usarse y se conserva el histórico y la auditoría (RN-07). Todo cambio queda en **Auditoría**.

Entrar como **Ana Administradora** (`admin@aquaplants.cl`, Administrador principal) y abrir **Gestión → CRUD** (`/crud`): todas las entidades están en pestañas en una sola pantalla. Cada pestaña tiene su propia dirección (por ejemplo `/crud?tab=especies`), útil para abrirlas de antemano.

| # | Entidad | Pantalla | Crear | Ver | Editar | Eliminar (baja) |
|---|---|---|---|---|---|---|
| 1 | Clientes | Gestión → Clientes | «Nuevo cliente» | tabla con torres, usuarios y técnicos | «Renombrar» | «Dar de baja» (solo sin torres ni usuarios activos) · «Reactivar» |
| 2 | Especies | Gestión → Especies | «Nueva especie» con rangos por variable | tabla con rangos y cultivos en curso | «Editar» (nombre, descripción, rangos) | «Dar de baja» (no con cultivos en curso) · «Reactivar» |
| 3 | Torres | Gestión → Infraestructura | «Torre» (elegir cliente) | árbol torre → dispositivo → sensores | «Editar», «Responsables» | «Dar de baja» |
| 4 | Dispositivos AquaBrain | Infraestructura, dentro de la torre | «Dispositivo» (muestra la credencial una sola vez) | estado, última comunicación, GPS | «Ubicación» (GPS), «Credencial» (regenerar) | «Dar de baja» |
| 5 | Sensores | Infraestructura, dentro del dispositivo | «Sensor» (elegir variable) | lista #id · variable | — (se da de baja y se crea otro) | «Dar de baja» |
| 6 | Umbrales | Gestión → Umbrales | elegir sensor, escribir mínimo y máximo, «Guardar» | vigente con versión y fecha; rangos de referencia de la especie | volver a guardar (nueva versión) | «Desactivar» |
| 7 | Cultivos | CRUD → Cultivos (todas las torres) o la ficha de cada torre | «Nuevo cultivo» (solo especies activas) | historial de cultivos de la torre | «Corregir» (especie o fecha de inicio del cultivo en curso) | «Cerrar cultivo» (fecha de fin) |
| 8 | Usuarios | Gestión → Usuarios | «Nuevo usuario» (rol, cliente, torres o clientes del Técnico) | tabla con rol, alcance y estado; filtros | «Editar» | «Desactivar» · «Reactivar» |
| 9 | Invitaciones | Usuarios → «Enlaces de invitación» | «Nuevo enlace» | vigencia, usos, por confirmar | — | «Anular» |
| 10 | Incidencias | Incidencias | se abren solas al perder señal un AquaBrain | lista por estado | «Atender» | «Cerrar» con comentario (cuando vuelve la señal) |

## Recorrido sugerido (≈ 8 min)
1. **Especies**: crear «Tomate» con pH 5,8–6,3 y CE 2–3,5 → aparece en la tabla. Editar su descripción. Intentar dar de baja «Lechuga» → botón deshabilitado (tiene cultivo en curso).
2. **Clientes**: crear «Invernaderos del Sur» → «Renombrar».
3. **Infraestructura**: «Torre» → «Torre D · Tomate» del cliente nuevo → «Dispositivo» (copiar la credencial) → «Ubicación» con `-33.45, -70.66` → «Sensor» pH.
4. **Umbrales**: elegir el sensor nuevo → se ven los rangos de referencia de las especies → guardar advertencia 5,8–6,3 y crítico 5,3–6,8.
5. **Cultivos**: «Nuevo cultivo» → torre «Torre D», especie «Tomate» (aparece en la lista porque está activa).
6. **Usuarios**: «Nuevo usuario» Supervisor de «Invernaderos del Sur» → «Editar» → «Desactivar».
7. **Auditoría**: filtrar por acción y mostrar todo lo anterior registrado con usuario y hora.
8. **Eliminar (bajas)**: cerrar el cultivo de «Torre D» → dar de baja el sensor, el dispositivo y la torre → dar de baja «Tomate» → dar de baja el cliente. Mostrar que todo sigue visible como «De baja» y en Auditoría.

## Por rol (si preguntan por permisos)
Cerrar sesión y entrar con `supervisor2@` (Carla, solo «Huerta Norte»), `encargado3@` (Marcela, solo Torre B) o `tecnico2@` (Paula, incidencias de «Huerta Norte»): los menús cambian y las secciones ajenas dicen «Sin acceso»; la API responde 403 aunque se escriba la dirección.

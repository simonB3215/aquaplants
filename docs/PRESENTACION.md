# Presentación y demostración — Evaluación 3 (máx. 10 minutos)

Requisitos de la pauta: **CRUD** sobre la base de datos en la nube e **informe de gestión** generado y visto desde el software. Si el software no funciona en la presentación, no se evalúa el informe escrito; por eso esta guía incluye un plan de contingencia **probado antes**.

Web: https://aquaplants.vercel.app · Cuentas: `secretos/cuentas-demo.txt` (fuera de git; no proyectar).

## Por qué la red del instituto no debería bloquearla
- El navegador solo usa **HTTPS (puerto 443)** hacia `aquaplants.vercel.app`; Vercel reenvía `/api/*` a Render.
- La conexión a la base de datos (Supabase PostgreSQL y Neon) la hace **el servidor de Render**, no el computador de la sala. Un firewall que bloquee los puertos 5432/6543 no afecta la demostración.
- No hace falta instalar nada en el computador de la sala: basta un navegador actualizado.

## Día anterior (ensayo completo, con cronómetro)
1. En la red de la casa **y** con el celular como hotspot: abrir la web, iniciar sesión como Administrador y recorrer el guion completo (abajo).
2. **CRUD → cada pestaña** abre sin errores. **Informe de gestión →** «30 días» → «Imprimir o PDF» (guardar el PDF como respaldo) y «CSV».
3. Revisar en GitHub → Actions que el último CI de `main` esté en verde y que la web muestre la última versión.
4. Cargar el celular y revisar que el plan de datos permita hotspot.

## 30 minutos antes
1. GitHub → Actions → **«Mantener despierto»** → *Run workflow* (2 horas). Evita los ~20–50 s de arranque en frío de Render.
2. Abrir `https://aquaplants.vercel.app/api/v1/health`: debe responder `200` en menos de 1 s.
3. Conectar el computador a la red del instituto y repetir el paso 2. **Si falla o tarda**, cambiar de inmediato al hotspot del celular.
4. Dejar abiertas dos pestañas con sesión de **Administrador**: `/crud` y `/informe`. Si se mostrarán permisos por rol, una tercera pestaña privada con un **Supervisor**.

## Guion (≈ 9 min)
| Min | Qué se muestra | Dónde |
|---|---|---|
| 0:00 | Contexto: AquaPlants monitorea torres de cultivo; datos en PostgreSQL en la nube (Supabase) | Inicio |
| 1:00 | **Crear**: especie «Tomate» con pH 5,8–6,3 (se ve el «Permitido: 0 a 14 pH») | CRUD → Especies |
| 2:00 | **Crear**: cliente nuevo; torre del cliente; nuevo cultivo «Tomate» en esa torre | CRUD → Clientes, Torres y equipos, Cultivos |
| 4:00 | **Consultar y actualizar**: editar la especie, «Corregir» el cultivo, renombrar el cliente | mismas pestañas |
| 5:30 | **Eliminar (baja lógica)**: cerrar el cultivo, dar de baja la torre, la especie y el cliente; siguen visibles «De baja» | mismas pestañas |
| 6:30 | Todo quedó registrado con usuario y hora | CRUD → Auditoría |
| 7:00 | **Informe de gestión**: «30 días», indicadores, gráfico por día, detalle por torre; «Imprimir o PDF» y «CSV» | Gestión → Informe de gestión |
| 8:30 | (Si hay tiempo) Supervisor: el mismo informe solo con su cliente; el Encargado no tiene acceso | pestaña privada |

Detalle de cada pantalla: `docs/GUION_CRUD.md`.

## Plan de contingencia (en este orden)
| Problema | Qué hacer |
|---|---|
| La red del instituto bloquea o es lenta | Hotspot del celular (probado el día anterior) |
| La API tarda en responder (arranque en frío) | Esperar 30 s y recargar; ya debería estar despierta por «Mantener despierto» |
| El computador de la sala falla | Usar el notebook de un integrante con el hotspot; las sesiones ya están iniciadas |
| No se puede iniciar sesión | Usar otra cuenta de Administrador de `secretos/cuentas-demo.txt` |
| Render o Supabase caídos (externo) | Mostrar el estado en sus páginas de estado y el PDF del informe y las capturas guardadas el día anterior (solo como respaldo; la pauta exige el software funcionando) |

## Todos los integrantes deben saber responder
- Dónde está la base de datos (Supabase, PostgreSQL) y cómo se conecta (servidor en Render, HTTPS desde el navegador).
- Por qué «eliminar» es una baja lógica (se conserva el histórico y la auditoría, RN-07).
- Quién puede hacer qué (matriz de permisos en el backend: `packages/shared/src/permisos.ts`); ocultar un botón no protege nada.
- Cómo se calcula el informe: consulta en el momento sobre la base en la nube, filtrado por el alcance del usuario.

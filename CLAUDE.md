# AquaPlants — instrucciones para Claude Code
1. Lee primero `docs/ESTADO_PROYECTO.md` (estado, pendientes, próximo paso) y `docs/DECISIONES.md`.
2. Frontend: usar la skill `.claude/skills/ui-ux-pro-max` y respetar `design-system/aquaplants/MASTER.md` + `pages/dashboard.md`. No modificar la skill.
3. La autorización vive en el backend (`packages/shared/src/permisos.ts` = Tabla 48). Nunca confiar en ocultar botones.
4. No declarar pruebas aprobadas sin ejecutarlas; registrar resultados en `docs/PRUEBAS.md` y actualizar `docs/ESTADO_PROYECTO.md` al terminar.

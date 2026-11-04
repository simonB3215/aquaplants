# Diseño visual — integración de UI UX Pro Max

- Skill oficial: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (commit `713eef5`, licencia MIT). Copiada **sin modificaciones** en `.claude/skills/ui-ux-pro-max/` para que futuras sesiones de Claude Code la tengan disponible.
- Metodología seguida (SKILL.md): Paso 1 análisis (producto: dashboard IoT agrícola; stack React detectado) → Paso 2 `--design-system` → Paso 2b `--persist` con `--page dashboard` → Paso 3 búsquedas por dominio → «Pre-Delivery Checklist».
- Resultado persistido: `design-system/aquaplants/MASTER.md` (fuente global) y `design-system/aquaplants/pages/dashboard.md` (overrides documentados con las búsquedas que los respaldan).
- Implementación: `packages/frontend/src/estilos/tokens.css` traduce el MASTER + overrides a variables CSS; los componentes no usan colores sueltos.
- Imagen de referencia del usuario: usada **solo** como referencia de estilo (tarjetas amplias, fila de KPIs, gráfico grande + panel lateral, barra lateral discreta, barra inferior en píldora, vidrio sutil sobre fondo claro). No se copiaron métricas financieras ni controles.

## Checklist de entrega (skill) — verificación
| Ítem | Estado |
|---|---|
| Sin emojis como íconos (Lucide SVG) | ✔ |
| `cursor: pointer` en clicables | ✔ |
| Transiciones 150–300 ms, sin desplazar el layout | ✔ |
| Contraste ≥ 4.5:1 (texto sobre vidrio con opacidad 74 % + fondo claro) | ✔ revisado visualmente; sin auditoría automática de contraste |
| Foco visible | ✔ `:focus-visible` 3 px |
| `prefers-reduced-motion` | ✔ |
| Responsive 360/390/768/1024/1440 sin scroll horizontal | ✔ medido con Playwright (desborde 0 px) |
| Estados nunca solo por color (ícono + texto) | ✔ |
| Touch ≥ 44 px | ✔ botones y navegación |

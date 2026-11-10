# Prueba de carga CP-27 (50 dispositivos × 10 min)

Requiere `.env.nube` en la raíz (conexiones a Supabase y Neon). Ejecuta contra la API publicada.

```bash
node pruebas/carga/crear.mjs 50      # torre temporal con 50 dispositivos × 5 sensores (sin umbrales)
node pruebas/carga/carga.mjs 600     # cada dispositivo envía 1 lote cada 10 s durante 600 s
node pruebas/carga/verificar.mjs     # lotes 201 = lotes en PostgreSQL = payloads en Neon; mediciones = 5 × lotes
node pruebas/carga/limpiar.mjs       # borra la torre temporal y todo lo que generó (la auditoría se conserva)
```

Resultados en `resultado.json` y `consistencia.json` (no versionados; el resumen está en `docs/PRUEBAS.md`).

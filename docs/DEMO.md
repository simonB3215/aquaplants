# Modo demostración académico

Requiere `DEMO_MODE=true` (se **niega a arrancar** con `NODE_ENV=production`) y el simulador en ejecución. Entre como Administrador → menú **Demostración**. Cada botón ejecuta un escenario **real** del simulador o de la API.

| Esc. | Qué hace realmente | Qué observar |
|---|---|---|
| A | Enciende todos los AquaBrain virtuales, con red y valores normales | «Dispositivos conectados» al día; valores actualizados cada 5 s |
| B | Desplaza el pH del dispositivo elegido fuera del umbral crítico | Alerta crítica activa; contador de ocurrencias sube; el Encargado ve «Requiere Supervisor» |
| C | Corta la red del dispositivo: sigue midiendo y **persiste lotes en disco** | Cola local crece en «Simulador en vivo»; tras 3 intervalos la torre pasa a «Sin señal» (causa desconocida) |
| D | Restablece la red: envía la cola en orden y reenvía a propósito un lote ya confirmado | Cola en 0, evento «Reconexión», lotes recuperados; el reenvío responde `duplicado: true` |
| E | Corte eléctrico: detiene el dispositivo (no mide); lo no persistido se pierde | Ninguna medición nueva; la cola en disco se conserva |
| F | Retorno de energía: reabre la cola desde disco, informa «reinicio» y reanuda | Evento «Reinicio informado»; el periodo apagado queda como **hueco** en el histórico |
| G | Inicia sesión como Encargado y llama `POST /usuarios` | Resultado 403 |

Secuencia recomendada para la defensa: **A → B → C → E → F → D → G** (corte de Internet y luego de energía, como CC-11).

También se puede simular un corte eléctrico “de verdad” cerrando la ventana «AquaPlants simulador» (o Ctrl+C) y volviendo a ejecutar `npm run sim` (la cola vive en disco, en `packages/simulador/data/`).

Prueba automatizada de los mismos escenarios: `node tests/e2e/escenarios.mjs http://localhost:3000/api/v1` (genera `docs/evidencias/escenarios-e2e.json`).

API de control del simulador (solo red interna/localhost, con `SIM_CONTROL_TOKEN`): `GET /estado`, `POST /escenario {codigo, id_dispositivo}`, `POST /dispositivos/{id}/red|energia|intervalo|credencial-invalida`.

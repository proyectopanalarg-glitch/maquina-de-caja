# La Máquina de Caja — guía para Claude Code

Juego educativo de flujo de caja para dueños de Pymes argentinas: un taller metalmecánico durante 12 meses desde hoy, con la economía real (cada día usa los datos públicos del día anterior; lo futuro se proyecta con el REM del BCRA). Dos superficies, un solo motor. Todo en español rioplatense (textos, nombres, mensajes).

## Reglas del proyecto
- **Cero dependencias y cero servicios pagos.** Solo Node.js ≥ 18 con módulos integrados. No agregues paquetes npm. Publicación: GitHub Actions + GitHub Pages.
- `motor/motor.mjs` es la única fuente de verdad: puro, sin DOM, estado JSON serializable. Los datos reales entran solo por `cargarEconomia(datos)`; nunca los metas en el estado de la partida.
- **Datos reales:** solo fuentes públicas y gratuitas. Cada fuente es opcional y si falla se conservan los datos anteriores. Mostrar siempre si un número es *dato real* o *proyección*, con fecha y fuente.
- `test/fixtures/economia-prueba.json` son datos **sintéticos**: solo para pruebas. Nunca los incrustes en `web/index.html` ni los publiques.
- Lo que muestra una pieza de la máquina tiene que salir del mismo modelo que la mueve (principio de github.com/wheresryan22/anatomy).
- `web/index.html` es generado: editá `web/juego.src.html` y corré `node build.mjs`.
- **Todo lo visual es responsive** (celular ~360 px, tablet ~768 px y escritorio). Cada cambio en `web/` se prueba en los tres anchos (`test/ui.py`, `test/comp.py`, con `W`/`H`).
- El MCP habla JSON-RPC por stdio: **nunca** escribas a stdout salvo mensajes del protocolo (logs → stderr).
- Si una novedad pide decisión, el tiempo se pausa: no agregues decisiones automáticas en el juego.

## Comandos
- `node datos/actualizar.mjs` — baja los datos reales a `datos/economia.json`.
- `node build.mjs` — arma `web/index.html` con el motor y la última foto de datos (`DATOS=ruta` para otra).
- `node test/motor.test.mjs` y `node test/mcp.test.mjs` — pruebas (usan datos sintéticos). `npm test` corre ambas.
- `node test/balance.mjs [N] [inicio] [modo] [datos.json]` — balance. Objetivo arrancando hoy: "no tocar nada" ≈ −10/−15% real; buena gestión ≈ +10/+20%; cobrar a 90 días casi siempre quiebra.

## Dónde tocar
- Economía real: `cargarEconomia`, `realEn`, `inflacionDelMes`, `datosDelDia` (correcciones INDEC/IPIM y novedades reales), `indicadores`, `resumenEconomia`.
- Calendario: `fechaDe(s, dia)`, `habil`, `habilBancario`, `temporadas`, `aguinaldos`, `VENCIMIENTOS`, `ESTACIONALIDAD`.
- Simulación: `procesarDia`, `cerrarMes`, `avanzarDias`. Novedades sorteadas: `EVENTOS` y `SORTEABLES` por modo; modos en `MODOS_NOVEDADES`.
- Comparación: `resumenPartida` (web: comparador en localStorage; MCP: `comparar_partidas`).
- Juego web: reloj (`VELOCIDADES`, `tick`, `avanzar`), máquina (`render()`, `P(x,y,z)`, `box`, `cil`, `tubo`, `textoCara`, `globito`), monedas (`RUTAS`), línea de tiempo (`pintarLinea`), economía (`pintarEconomia`), comparador (`pintarComparador`).
- Publicación diaria: `.github/workflows/actualizar.yml`.

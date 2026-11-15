# La Máquina de Caja: edición metalmecánica

**Jugalo:** https://proyectopanalarg-glitch.github.io/maquina-de-caja/

Un juego educativo para dueños de Pymes de Argentina y Latinoamérica. Llevás un **taller metalmecánico de 14 operarios** durante 12 meses **desde hoy**, con la **economía real de Argentina**. Cada día del juego usa los datos públicos del día anterior: dólar oficial y MEP, inflación de INDEC, tasas del BCRA, precios mayoristas de productos metálicos, índice de salarios y feriados nacionales.

La pregunta que enseña es una sola: **¿por qué un taller rentable se puede quedar sin caja?**

Inspirado en [anatomy](https://github.com/wheresryan22/anatomy). La idea se explica construyéndola como una máquina que funciona: la plata entra por un embudo de pedidos, pasa por el torno, viaja en una **cinta de cobro** cuyo largo es tu plazo, cae en un **tanque de caja** y sale por caños hacia el acero, los sueldos, ARCA y la energía. Si el tanque se vacía, se infla un **globo de deuda**.

Todo es **gratis y open source**: Node.js sin dependencias, GitHub Actions y GitHub Pages. No necesita claves de API ni servicios pagos.

---

## Cómo funciona la economía real

- **Datos del día anterior:** cada día del juego usa los datos publicados el día anterior. El juego publicado se actualiza solo todas las mañanas (07:15) con GitHub Actions.
- **Lo que todavía no pasó:** si corrés el tiempo más rápido que la realidad, el juego proyecta. Usa la **inflación esperada del REM del BCRA** y el ritmo reciente del dólar.
- **Corrección con INDEC:** cuando INDEC publica la inflación de un mes, el juego corrige lo que había proyectado. Lo mismo hace con los precios mayoristas metálicos (costo del acero) y con el índice de salarios (ajuste trimestral de sueldos).
- **Tasas:** la reserva rinde la tasa real de plazo fijo y el descubierto cuesta la tasa real de adelantos en cuenta corriente.
- **Feriados:** los nacionales reales no se producen y corren los vencimientos al día hábil siguiente.
- **A la vista:** el panel **Economía real** muestra cada dato con su fecha y si es *dato real* o *proyección*.

| Dato | Fuente pública |
|---|---|
| Dólar oficial (BNA) y MEP | [ArgentinaDatos](https://argentinadatos.com) |
| Inflación mensual | INDEC, vía ArgentinaDatos |
| Inflación esperada (REM), tasas, dólar mayorista | [BCRA, API de Estadísticas Monetarias v4.0](https://www.bcra.gob.ar/apis-banco-central/) |
| Plazo fijo a 30 días (mediana de bancos) | ArgentinaDatos |
| Precios mayoristas de productos metálicos, índice de salarios | INDEC, vía la [API de Series de Tiempo](https://datos.gob.ar/series) |
| Feriados nacionales | ArgentinaDatos |

Si una fuente falla un día, se conservan los últimos datos buenos y el panel lo indica.

## Modos de novedades

Al empezar una partida elegís cómo aparecen las novedades:

| Modo | Qué pasa |
|---|---|
| **Mixtas** | Las del mercado salen de los datos reales (salto del dólar, inflación de INDEC, cambio de tasas); las del taller se sortean (torno roto, cliente grande, e-cheq rechazado…) |
| **Solo reales** | Solo lo que muestran los datos públicos. Sin sorteo |
| **Al azar** | Todas se sortean, como en un simulador clásico. Los datos reales igual mueven precios y tasas |

Si una novedad pide decisión, **el tiempo se pausa hasta que elegís**. Al terminar, podés **repetir la misma partida** (misma fecha y semilla) con otro modo y verla en el **comparador**. Así se ve cuánto del resultado vino de tus decisiones y cuánto de los imprevistos.

## Juego web

- **Reloj:** pausa, *tiempo real* (un día del juego dura un día de verdad; si cerrás la página, al volver se pone al día), *1 día = 10 s*, *1 semana = 10 s* y *1 mes = 10 s*. También hay botones de **+1 día** y **⏭ fin de mes**.
- **Ver pasar el tiempo:** las monedas viajan por la máquina el día de cada cobro y pago.
- **Línea de tiempo:** los meses de la partida con feriados, vacaciones, cosecha y siembra, aguinaldos, novedades y el resultado de cada mes.
- **Palancas:** se mueven en cualquier momento.
- **Comparador:** cada partida terminada queda guardada en tu navegador, con su curva mes a mes.
- **Pantallas:** es responsive, para celular, tablet y compu.

Para abrirlo sin internet: `node build.mjs` y abrí `web/index.html`. Va a usar la última foto de datos que tenga el repositorio.

## MCP server (jugar desde el chat de una IA)

```bash
claude mcp add maquina-caja -- node /RUTA/COMPLETA/maquina-de-caja/mcp/server.mjs
```

O en `claude_desktop_config.json` (Claude Desktop, LM Studio, Goose, Cursor):

```json
{ "mcpServers": { "maquina-caja": { "command": "node", "args": ["/RUTA/COMPLETA/maquina-de-caja/mcp/server.mjs"] } } }
```

Al arrancar baja los datos del día desde GitHub Pages. Si no hay internet, usa la copia local `datos/economia.json`.

| Herramienta | Para qué |
|---|---|
| `nueva_partida` | Empieza hoy con `modo_novedades` (mixtas, reales o azar). Con `repetir_de` repite otra partida para comparar |
| `ver_tablero` | Muestra la máquina en texto con la economía del día y su fuente |
| `economia_real` | Muestra los datos públicos que usa el juego, con fecha y fuente |
| `probar_palancas` | Simula 30 días con otras palancas sin avanzar |
| `avanzar` | Hace correr el tiempo por día, semana o mes. Se detiene en las novedades que piden decisión |
| `linea_de_tiempo` | Muestra los meses con feriados, aguinaldos, novedades y resultados |
| `comparar_partidas` | Muestra partidas lado a lado, mes a mes |
| `diagnostico`, `explicar`, `listar_partidas` | Muestran las fugas, explican conceptos y listan las partidas guardadas |

**Prompts:** `jugar` (partida guiada) y `taller_grupal` (capacitación de 60 minutos comparando modos).

## Desarrollar con Claude Code

```powershell
copy mcp-claude-code.ejemplo.json .mcp.json   # o: claude mcp add maquina-caja --scope project -- node mcp/server.mjs
claude
```

`CLAUDE.md` le explica a Claude las reglas del proyecto.

## Comandos

```bash
npm run datos     # baja los datos reales a datos/economia.json
npm run build     # arma web/index.html con el motor y la última foto de datos
npm test          # pruebas del motor y del MCP (con datos sintéticos de prueba)
npm run balance   # 200 partidas por estrategia para calibrar
```

## Balance (100-150 partidas por estrategia, arrancando hoy, todo proyectado)

| Estrategia | Patrimonio real (mediana) | Quiebras |
|---|---|---|
| No tocar nada | −12% | casi ninguna |
| Pasar el cobro a 90 días | −27% | casi todas |
| Cobrar a 30 y remarcar todos los meses | −3% | 0 |
| Cobrar a 30 y 30% del taller en reparaciones | +14% | 0 |

Con novedades "solo reales" y una economía tranquila, el año es más fácil. Ese contraste es el que muestra el comparador.

## Estructura

```
motor/motor.mjs            Modelo día por día con economía real (sin DOM ni dependencias), compartido por todo
datos/actualizar.mjs       Baja los datos públicos y escribe datos/economia.json (lo corre GitHub Actions)
web/juego.src.html         Juego web; build.mjs le incrusta el motor y los datos → web/index.html
mcp/server.mjs             MCP server por stdio (JSON-RPC 2.0)
.github/workflows/         Actualización diaria y publicación en GitHub Pages
test/                      Pruebas del motor, del MCP y del juego web (Playwright); fixtures/ = datos SINTÉTICOS
```

Son números aproximados para aprender. **No es asesoramiento contable ni financiero.** Licencia MIT.

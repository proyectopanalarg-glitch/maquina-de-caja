#!/usr/bin/env node
// La Máquina de Caja — MCP server (stdio)
// Gratis y sin dependencias: solo Node.js 18+. Implementa el protocolo MCP (JSON-RPC 2.0 por stdin/stdout,
// un mensaje por línea). Funciona con Claude Desktop, Claude Code, Cursor, VS Code, LM Studio, Goose, etc.
//
// Datos reales: al arrancar (y cada 6 horas) baja datos/economia.json de GitHub Pages, que se actualiza
// todas las mañanas con fuentes públicas (BCRA, INDEC, ArgentinaDatos). Si no hay internet, usa la copia local.
// Variables: MAQUINA_CAJA_DATOS (ruta o URL de otro economia.json), MAQUINA_CAJA_DIR (dónde guardar partidas).

import { createInterface } from "node:readline";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  VERSION, EMPRESA, EVENTOS, DESCRIPCION_PALANCAS, DIAS_TOTALES, VENCIMIENTOS, MODOS_NOVEDADES, crearPartida, avanzarDias,
  lectura, diagnostico, lineaDeTiempo, validarPalancas, fechaDe, diasDelMes, textoFecha, millones, pesos,
  cargarEconomia, resumenEconomia, resumenPartida, economiaCargada,
} from "../motor/motor.mjs";

const PROTOCOLOS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const URL_DATOS = "https://proyectopanalarg-glitch.github.io/maquina-de-caja/datos/economia.json";
const DATOS_LOCAL = fileURLToPath(new URL("../datos/economia.json", import.meta.url));
function log(...a) { process.stderr.write("[maquina-caja] " + a.join(" ") + "\n"); }

// ---------- datos reales ----------
let datosInfo = { origen: "ninguno", cargado: 0 };
async function cargarDatos(forzar = false) {
  if (!forzar && Date.now() - datosInfo.cargado < 6 * 3600e3) return;
  const candidatos = [process.env.MAQUINA_CAJA_DATOS, URL_DATOS, DATOS_LOCAL].filter(Boolean);
  for (const c of candidatos) {
    try {
      let d;
      if (/^https?:/.test(c)) { const r = await fetch(c, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error("HTTP " + r.status); d = await r.json(); }
      else if (existsSync(c)) d = JSON.parse(readFileSync(c, "utf8"));
      else continue;
      if (!d || !d.fechaDatos) continue;
      cargarEconomia(d);
      datosInfo = { origen: c, cargado: Date.now(), fechaDatos: d.fechaDatos };
      log(`datos reales al ${d.fechaDatos} desde ${c}`);
      return;
    } catch (e) { log(`no pude leer datos de ${c}: ${e.message}`); }
  }
  datosInfo = { origen: "ninguno", cargado: Date.now() };
}

// ---------- persistencia ----------
const DIR = process.env.MAQUINA_CAJA_DIR || join(homedir(), ".maquina-caja");
const ARCHIVO = join(DIR, "partidas.json");
let partidas = {};
try {
  if (existsSync(ARCHIVO)) {
    partidas = JSON.parse(readFileSync(ARCHIVO, "utf8"));
    for (const [id, p] of Object.entries(partidas)) if (!p.estado || p.estado.version !== VERSION) delete partidas[id]; // versiones viejas no son compatibles
  }
} catch (e) { log("No pude leer partidas:", e.message); }
function guardar() {
  try { mkdirSync(DIR, { recursive: true }); writeFileSync(ARCHIVO + ".tmp", JSON.stringify(partidas)); renameSync(ARCHIVO + ".tmp", ARCHIVO); }
  catch (e) { log("No pude guardar partidas:", e.message); }
}
function obtener(id) { const p = partidas[id]; if (!p) throw new Error(`No existe la partida "${id}". Creá una con nueva_partida.`); return p; }

// ---------- textos ----------
const barra = (v, n = 12) => { const k = Math.max(0, Math.min(n, Math.round(v * n))); return "█".repeat(k) + "░".repeat(n - k); };
const pct = (v, d = 0) => (v * 100).toFixed(d).replace(".", ",") + "%";
const fCorta = (iso) => (iso ? `${+iso.slice(8, 10)}/${+iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");

function lineaEconomia(L) {
  const e = L.economia, t = (x) => (x ? (x.fuente === "real" ? "real" : x.fuente) : "sin dato");
  return [
    `ECONOMÍA   ${e.esReal ? "📡 datos reales del día anterior" : e.hayDatos ? "🔮 proyección (REM del BCRA)" : "🔮 sin datos reales: todo proyectado"}${e.fechaDatos ? ` · datos al ${fCorta(e.fechaDatos)}` : ""}`,
    `           dólar oficial ${e.dolarOficial ? pesos(e.dolarOficial.valor) : "—"} (${t(e.dolarOficial)})` +
      (e.dolarMEP ? ` · MEP ${pesos(e.dolarMEP.valor)}` : "") +
      ` · inflación del mes ${pct(e.inflacionMes.valor, 1)} (${e.inflacionMes.fuente})` +
      (e.remAnual ? ` · REM 12 m ${pct(e.remAnual.valor, 1)}` : "") +
      (e.tasaPlazoFijo ? ` · plazo fijo ${pct(e.tasaPlazoFijo.valor, 1)} TNA` : "") +
      (e.tasaDescubierto ? ` · descubierto ${pct(e.tasaDescubierto.valor, 1)} TNA` : "") +
      (e.feriado ? ` · 🇦🇷 hoy es feriado: ${e.feriado}` : ""),
  ].join("\n");
}

function tablero(s) {
  const L = lectura(s), esc = 160e6 * s.indice;
  const semana = (k) => { let a = 0; for (let d = s.dia + 7 * k; d < s.dia + 7 * k + 7; d++) a += s.cobros[d] || 0; return a; };
  const cinta = Array.from({ length: 13 }, (_, k) => (semana(k) > 0 ? "▇" : k * 7 < s.palancas.plazoCobro + 7 ? "·" : " ")).join("");
  const cambio = L.patrimonioReal / L.patrimonioInicialReal - 1, v = L.vencimientosProximos30;
  const venc = [["acero", v.acero], ["sueldos (día 5)", v.sueldos], ["💰 aguinaldo", v.aguinaldo], ["ARCA (día 20)", v.impuestos], ["alquiler, luz y gas", v.alquiler + v.energia], ["cuota crédito", v.cuotaCredito]]
    .filter(([, x]) => x > 0).map(([n, x]) => `${n} ${millones(x)}`).join(" · ");
  return [
    `🏭 ${s.nombre} — ${s.terminada ? "partida terminada" : `📅 ${L.fechaLarga} (día ${Math.min(s.dia + 1, DIAS_TOTALES)} de ${DIAS_TOTALES})`} · patrimonio real ${cambio >= 0 ? "+" : ""}${pct(cambio, 1)}`,
    `Novedades: ${MODOS_NOVEDADES[s.modoNovedades].nombre.toLowerCase()}${L.temporada.length ? ` · temporada: ${L.temporada.join(", ")}` : ""}`,
    lineaEconomia(L),
    "",
    `PRECIO     lista ${pesos(s.precio)} · costo ${pesos(s.costoUnit)} · margen real ${pct(L.markupReal)} (objetivo ${pct(s.palancas.markup)}) · remarcás cada ${s.palancas.actualizarCada} mes(es), el día 1`,
    `PEDIDOS    ${barra(L.usoCapacidad)} ${L.pedidosEstimados.toLocaleString("es-AR")} piezas/mes (taller al ${pct(L.usoCapacidad)})`,
    `REPARAC.   ${barra(s.palancas.reparaciones / 0.5)} ${pct(s.palancas.reparaciones)} del taller → ${millones(L.reparacionesProximos30)}/mes contado`,
    `COBRO      hoy [${cinta}] 90 d ← plazo ${s.palancas.plazoCobro} días · ${millones(L.porCobrar)} en la calle (cada ▇ = una semana por cobrar)`,
    `CAJA       ${barra(s.caja / esc)} ${millones(s.caja)} (fijos del mes ${millones(L.costosFijos)} · ${L.diasDeCaja} días de caja)`,
    `RESERVA    ${barra(s.reserva / (90e6 * s.indice))} ${millones(s.reserva)} (válvula ${pct(s.palancas.reservaPct)}, se carga al cerrar cada mes)`,
    `DEUDA      ${barra(s.descubierto / s.limiteDescubierto)} ${millones(s.descubierto)} de ${millones(s.limiteDescubierto)} de límite`,
    "",
    `PRÓXIMOS 30 DÍAS: entran ~${millones(L.cobrosProximos30 + L.reparacionesProximos30)} · vencen ~${millones(v.total)} (${venc}) → ${millones(L.cobrosProximos30 + L.reparacionesProximos30 - v.total)}`,
    L.eventoPendiente
      ? `\n⏸️ EL TIEMPO ESTÁ EN PAUSA — ${L.eventoPendiente.real ? "📡 NOVEDAD REAL" : "🎲 NOVEDAD"}: ${L.eventoPendiente.icono} ${L.eventoPendiente.titulo}. ${L.eventoPendiente.texto}${L.eventoPendiente.fuente ? ` (fuente: ${L.eventoPendiente.fuente})` : ""}\n   Para seguir, avanzar con decision = ` + L.eventoPendiente.opciones.map((o) => `"${o.id}" (${o.label})`).join(" | ")
      : "",
  ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
}

function textoInforme(i) {
  const e = i.egresos;
  return [
    `📊 Cierre de ${i.mesNombre} · inflación ${pct(i.inflacion, 1)} (${i.inflacionFuente}) · ${i.diasReales} días con datos reales, ${i.diasProyectados} proyectados`,
    ...i.eventos.map((x) => `${x.real ? "📡" : "🎲"} ${x.titulo}${x.label ? ` → ${x.label}` : ""}`),
    `Facturaste ${millones(i.facturado)} (serie ${millones(i.facturadoSerie)} + reparaciones ${millones(i.facturadoReparaciones)}) · ${i.piezas.toLocaleString("es-AR")} piezas · taller al ${pct(i.usoCapacidad)}${i.remarcaste ? " · actualizaste la lista" : ""}`,
    `Cobraste ${millones(i.cobrado)}. Pagaste: acero ${millones(e.acero)}, sueldos ${millones(e.sueldos)}${e.aguinaldo ? `, aguinaldo ${millones(e.aguinaldo)}` : ""}, impuestos ${millones(e.impuestos)}, energía+alquiler ${millones(e.energia + e.alquiler)}` +
      (e.cuotaCredito ? `, cuota crédito ${millones(e.cuotaCredito)}` : "") + (e.imprevistos ? `, imprevistos ${millones(e.imprevistos)}` : "") + (e.intereses ? `, intereses ${millones(e.intereses)}` : ""),
    `Resultado de caja del mes: ${millones(i.resultadoCaja)}` + (i.rescateReserva ? ` · sacaste ${millones(i.rescateReserva)} de la reserva` : "") +
      (i.nuevoDescubierto ? ` · usaste ${millones(i.nuevoDescubierto)} de descubierto` : "") + (i.deudaPagada ? ` · pagaste ${millones(i.deudaPagada)} de deuda` : "") +
      (i.aReserva ? ` · mandaste ${millones(i.aReserva)} a la reserva` : ""),
    ...i.alertas.map((a) => `🔴 ${a}`),
  ].join("\n");
}
function textoDiagnostico(d) {
  return [`🏁 ${d.titulo} — patrimonio real ${d.cambioPatrimonioReal >= 0 ? "+" : ""}${pct(d.cambioPatrimonioReal, 1)} · ${d.puntaje} puntos`,
    d.fugas.length ? "Dónde pierde la máquina:" : "No se ven fugas importantes.", ...d.fugas.map((f) => `• [${f.gravedad}] ${f.pieza}: ${f.texto}`)].join("\n");
}

// ---------- herramientas ----------
const palancasSchema = {
  markup: { type: "number", minimum: 0, maximum: 3, description: DESCRIPCION_PALANCAS.markup },
  plazoCobro: { type: "integer", enum: [0, 30, 60, 90], description: DESCRIPCION_PALANCAS.plazoCobro },
  plazoPago: { type: "integer", enum: [0, 30, 60], description: DESCRIPCION_PALANCAS.plazoPago },
  actualizarCada: { type: "integer", enum: [1, 2, 3], description: DESCRIPCION_PALANCAS.actualizarCada },
  reservaPct: { type: "number", minimum: 0, maximum: 1, description: DESCRIPCION_PALANCAS.reservaPct },
  reparaciones: { type: "number", minimum: 0, maximum: 0.5, description: DESCRIPCION_PALANCAS.reparaciones },
};
const idSchema = { partida_id: { type: "string", description: "Id que devolvió nueva_partida" } };
const avanzarSchema = {
  unidad: { type: "string", enum: ["dia", "semana", "mes"], description: "Cuánto avanzar: un día, una semana (7 días) o hasta el cierre del mes en curso. Default: mes." },
  cantidad: { type: "integer", minimum: 1, maximum: 13, description: "Cuántas unidades (default 1). Siempre se detiene antes si aparece una novedad que pide decisión." },
  decision: { type: "string", description: "Id de la opción elegida para la novedad pendiente (ver ver_tablero). Obligatorio si el tiempo está en pausa." },
};
const RO = { readOnlyHint: true };

const TOOLS = [
  { name: "nueva_partida", title: "Nueva partida",
    description: "Empieza una partida de 'La Máquina de Caja': el jugador lleva un taller metalmecánico argentino durante 12 meses desde HOY, con la economía real (dólar, inflación INDEC, tasas, feriados: cada día usa los datos del día anterior) y proyección del REM del BCRA para lo que todavía no pasó. Se elige cómo aparecen las novedades: mixtas, solo reales o al azar. Con repetir_de se repite otra partida (misma fecha y semilla) para comparar modos o estrategias.",
    inputSchema: { type: "object", properties: {
      nombre: { type: "string", description: "Nombre del taller" },
      modo_novedades: { type: "string", enum: Object.keys(MODOS_NOVEDADES), description: Object.entries(MODOS_NOVEDADES).map(([k, m]) => `${k}: ${m.texto}`).join(" ") },
      semilla: { type: "integer", description: "Opcional. Misma fecha + misma semilla = mismas novedades sorteadas." },
      inicio: { type: "string", description: "Opcional, YYYY-MM-DD. Por defecto, hoy. Una fecha pasada permite jugar con más datos reales." },
      repetir_de: { type: "string", description: "Opcional: partida_id a repetir (toma su fecha de inicio, semilla y nombre)." },
    } } },
  { name: "ver_tablero", title: "Ver tablero", description: "La máquina en texto: fecha, economía real del día (con fuente), precio, pedidos, cinta de cobro, caja, reserva, deuda, vencimientos de los próximos 30 días y la novedad pendiente.", inputSchema: { type: "object", properties: idSchema, required: ["partida_id"] }, annotations: RO },
  { name: "economia_real", title: "Economía real", description: "Los datos públicos que usa el juego: dólar oficial y MEP, inflación INDEC, inflación esperada (REM), tasas de plazo fijo y descubierto, con fecha y fuente; y qué es real y qué es proyección en el día de la partida.", inputSchema: { type: "object", properties: { partida_id: { type: "string", description: "Opcional: para ver los datos del día de esa partida" } } }, annotations: RO },
  { name: "probar_palancas", title: "Probar palancas (sin avanzar)", description: "Simula qué pasaría con otras palancas ANTES de confirmar: pedidos, reparaciones, ciclo de caja y cómo quedaría la caja en 30 días. No modifica la partida.", inputSchema: { type: "object", properties: { ...idSchema, ...palancasSchema }, required: ["partida_id"] }, annotations: RO },
  { name: "avanzar", title: "Avanzar el tiempo", description: "Aplica las palancas indicadas (corren desde el día siguiente), resuelve la novedad pendiente con 'decision' y hace correr el tiempo por días, semanas o meses. Se detiene si aparece una novedad que pide decisión (sorteada o real). Devuelve lo que pasó y el tablero. Al terminar los 12 meses devuelve el diagnóstico.", inputSchema: { type: "object", properties: { ...idSchema, ...palancasSchema, ...avanzarSchema }, required: ["partida_id"] } },
  { name: "avanzar_mes", title: "Avanzar hasta fin de mes", description: "Atajo de avanzar con unidad 'mes'.", inputSchema: { type: "object", properties: { ...idSchema, ...palancasSchema, decision: avanzarSchema.decision }, required: ["partida_id"] } },
  { name: "linea_de_tiempo", title: "Línea de tiempo", description: "Los meses de la partida con temporadas, aguinaldos, feriados, novedades (reales y sorteadas), decisiones y resultado de caja. Con 'mes' (YYYY-MM o número de orden) muestra el detalle de ese mes.", inputSchema: { type: "object", properties: { ...idSchema, mes: { type: "string", description: "Opcional: YYYY-MM o posición (1 = primer mes)" } }, required: ["partida_id"] }, annotations: RO },
  { name: "comparar_partidas", title: "Comparar partidas", description: "Compara partidas lado a lado: modo de novedades, fecha de inicio, palancas, decisiones, días con datos reales y resultado mes a mes. Sirve para contrastar escenarios (por ejemplo, la misma partida con novedades mixtas, solo reales y al azar).", inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "Opcional: partida_id a comparar. Por defecto, todas las terminadas." } } }, annotations: RO },
  { name: "diagnostico", title: "Diagnóstico", description: "Dónde pierde plata la máquina (fugas por pieza, con gravedad) y el veredicto parcial o final.", inputSchema: { type: "object", properties: idSchema, required: ["partida_id"] }, annotations: RO },
  { name: "explicar", title: "Explicar un concepto", description: "Explica un concepto con el contexto de una Pyme metalmecánica argentina.", inputSchema: { type: "object", properties: { tema: { type: "string", enum: Object.keys(GLOSARIO()), description: "Concepto" } }, required: ["tema"] }, annotations: RO },
  { name: "listar_partidas", title: "Listar partidas", description: "Lista las partidas guardadas con su fecha, modo y resultado.", inputSchema: { type: "object", properties: {} }, annotations: RO },
];

function GLOSARIO() {
  return {
    ciclo_de_caja: "Ciclo de caja = días que tardás en cobrar − días que tardás en pagar. Si cobrás a 60 y pagás el acero a 30, durante 30 días la producción la financiás vos. Con inflación, esa plata vuelve devaluada. Achicarlo libera caja sin vender una pieza más.",
    margen_real: "El margen que fijás se aplica cuando actualizás la lista. Entre una actualización y la siguiente el costo sigue subiendo (acero atado al dólar, el resto a la inflación), así que el margen real cae. Remarcar más seguido lo protege, pero algunos clientes se van.",
    capacidad_ociosa: "La metalmecánica opera con mucha capacidad parada. Los sueldos, la luz y el alquiler se pagan igual: cada pieza que no hacés es costo hundido. Por eso muchos talleres se vuelcan a reparaciones y mantenimiento.",
    reparaciones: "Tornería, mantenimiento y reparaciones: se cobran contado y tienen buen margen, pero el mercado es chico y le quitan foco a la producción en serie.",
    impuestos_sobre_facturado: "Ingresos Brutos, el saldo de IVA y el impuesto al cheque se pagan sobre lo facturado, aunque no hayas cobrado. Vender a 90 días te obliga a adelantar impuestos con plata propia.",
    echeq: "El e-cheq permite cobrar a plazo y también descontarlo en el banco (cobrás hoy, menos una tasa). Sirve para cerrar el hueco del ciclo de caja, con costo financiero.",
    descubierto: "El descubierto (adelanto en cuenta corriente) es la plata más cara que puede tomar una Pyme. El juego usa la tasa real de adelantos del BCRA cuando la tiene. Pasado el límite, el banco corta y el taller cierra.",
    reserva_fci: "La reserva rinde la tasa real de plazo fijo a 30 días (mediana de los bancos). Sirve para que el excedente no se licúe; pero si mandás todo, te quedás sin caja operativa.",
    acero_dolarizado: "Más de la mitad del costo de una pieza sigue al dólar. El juego usa el dólar oficial real del día anterior y, cuando INDEC publica los precios mayoristas de productos metálicos, corrige el costo del acero con ese dato.",
    paritaria_uom: "Los sueldos se ajustan cada 3 meses con el índice de salarios del INDEC (sector privado registrado) cuando está publicado; si no, con la inflación.",
    importados: "La apertura de importaciones pone un techo al precio: si tu margen sube mucho, el cliente compra la pieza importada.",
    aguinaldo: "El aguinaldo (SAC) es medio sueldo extra que se paga el 30 de junio y antes del 18 de diciembre. Si no lo vas apartando (1/12 de la masa salarial por mes), en esos meses la caja se queda corta.",
    vencimientos: "Calendario del taller: alquiler el 1, sueldos del mes anterior el 5, cuota del crédito el 10, luz/gas/ART el 15 e impuestos el 20. Si cae en fin de semana o feriado nacional, se paga el día hábil siguiente.",
    estacionalidad: "El año no es parejo: vacaciones colectivas del 4 al 15 de enero, cosecha gruesa de abril a junio (+15% de pedidos) y siembra de septiembre a noviembre (+10%). Los feriados nacionales reales restan días de producción.",
    datos_reales: "Cada día del juego toma los datos públicos del día anterior: dólar oficial (BNA) y MEP, tasas (BCRA), inflación (INDEC), precios mayoristas metálicos e índice de salarios (INDEC) y feriados. Lo que todavía no pasó se proyecta con la inflación esperada del REM del BCRA y el ritmo reciente del dólar. Cuando INDEC publica la inflación del mes, el juego corrige lo proyectado.",
    modos_novedades: Object.entries(MODOS_NOVEDADES).map(([k, m]) => `${m.nombre}: ${m.texto}`).join(" ") + " Jugar la misma partida con los tres modos muestra cuánto del resultado depende de tus decisiones y cuánto de los imprevistos.",
  };
}

function diasHastaFinDeMeses(s, cantidad) {
  let d = s.dia, total = 0;
  for (let i = 0; i < cantidad && d < DIAS_TOTALES; i++) { const f = fechaDe(s, d); const n = diasDelMes(f.anio, f.mes) - f.dia + 1; total += n; d += n; }
  return total;
}

async function llamar(nombre, a = {}) {
  await cargarDatos();
  switch (nombre) {
    case "nueva_partida": {
      const base = a.repetir_de ? obtener(a.repetir_de).estado : null;
      const id = randomUUID().slice(0, 8);
      const s = crearPartida({ nombre: a.nombre || base?.nombre || "Don Chatarrin", semilla: a.semilla ?? base?.semilla, inicio: a.inicio || base?.inicio, modoNovedades: a.modo_novedades || "mixtas" });
      partidas[id] = { estado: s, creada: new Date().toISOString() };
      guardar();
      const txt = `Partida creada: ${id} · inicio ${fCorta(s.inicio)} · semilla ${s.semilla} · novedades ${MODOS_NOVEDADES[s.modoNovedades].nombre.toLowerCase()}${base ? ` (repite ${a.repetir_de})` : ""}.\n${economiaCargada() ? "" : "⚠️ No hay datos reales cargados (sin conexión): el juego proyecta todo.\n"}\n${EMPRESA.descripcion}\n\n${tablero(s)}\n\nPalancas:\n${Object.entries(DESCRIPCION_PALANCAS).map(([k, v]) => `${k} — ${v}`).join("\n")}`;
      return ok(txt, { partida_id: id, semilla: s.semilla, inicio: s.inicio, modoNovedades: s.modoNovedades, lectura: lectura(s) });
    }
    case "ver_tablero": { const s = obtener(a.partida_id).estado; return ok(tablero(s), { lectura: lectura(s) }); }
    case "economia_real": {
      const R = resumenEconomia();
      const filas = [
        R.hayDatos ? `Datos reales al ${fCorta(R.fechaDatos)} (actualizados ${R.actualizado ? new Date(R.actualizado).toLocaleString("es-AR") : "—"}; origen: ${datosInfo.origen})` : "No hay datos reales cargados: el juego proyecta todo con supuestos.",
        R.dolarOficial ? `• Dólar oficial: ${pesos(R.dolarOficial.valor)} (${fCorta(R.dolarOficial.fecha)})` : null,
        R.dolarMEP ? `• Dólar MEP: ${pesos(R.dolarMEP.valor)} (${fCorta(R.dolarMEP.fecha)})` : null,
        R.inflacionUltima ? `• Última inflación INDEC: ${R.inflacionUltima.mes} = ${pct(R.inflacionUltima.valor, 1)}` : null,
        R.remAnual ? `• Inflación esperada 12 meses (REM BCRA): ${pct(R.remAnual.valor, 1)} → ${pct(R.inflacionProyectadaMensual, 2)} mensual para proyectar` : null,
        R.tasaPlazoFijo ? `• Plazo fijo 30 días: ${pct(R.tasaPlazoFijo.valor, 1)} TNA (${fCorta(R.tasaPlazoFijo.fecha)})` : null,
        R.tasaAdelantos ? `• Adelantos en cuenta corriente: ${pct(R.tasaAdelantos.valor, 1)} TNA (${fCorta(R.tasaAdelantos.fecha)})` : null,
        R.deslizamientoMensual != null ? `• Ritmo reciente del dólar oficial: ${pct(R.deslizamientoMensual, 2)} mensual` : null,
        "", "Fuentes:", ...R.fuentes.map((f) => `${f.ok ? "✅" : "⚠️"} ${f.nombre}${f.nota ? ` — ${f.nota}` : ""}`),
      ].filter((x) => x !== null);
      if (a.partida_id) { const L = lectura(obtener(a.partida_id).estado); filas.push("", `En la partida ${a.partida_id} (${L.fecha}): ${L.usoDatos.reales} días con datos reales y ${L.usoDatos.proyectados} proyectados.`, lineaEconomia(L)); }
      return ok(filas.join("\n"), { resumen: R, origen: datosInfo.origen });
    }
    case "probar_palancas": {
      const s = obtener(a.partida_id).estado, t = structuredClone(s);
      Object.assign(t.palancas, validarPalancas(a));
      const A = lectura(s), B = lectura(t), dif = (x) => (x >= 0 ? "+" : "") + Math.round(x).toLocaleString("es-AR");
      const filas = [
        `Pedidos/mes: ${A.pedidosEstimados.toLocaleString("es-AR")} → ${B.pedidosEstimados.toLocaleString("es-AR")} (${dif(B.pedidosEstimados - A.pedidosEstimados)})`,
        `Reparaciones contado: ${millones(A.reparacionesProximos30)} → ${millones(B.reparacionesProximos30)}`,
        `Ciclo de caja: ${A.cicloDeCajaDias} → ${B.cicloDeCajaDias} días`,
      ];
      if (t.palancas.markup !== s.palancas.markup) filas.push(`Margen objetivo ${pct(s.palancas.markup)} → ${pct(t.palancas.markup)}: se aplica la próxima vez que actualices la lista.`);
      if (t.palancas.plazoCobro > s.palancas.plazoCobro) filas.push(`⚠️ Alargar el plazo deja un hueco: lo que vendas desde mañana recién se cobra en ${t.palancas.plazoCobro} días, y los impuestos se pagan igual.`);
      if (t.palancas.plazoCobro < s.palancas.plazoCobro) filas.push("✅ Acortar el plazo hace que dos tandas de cobro se superpongan: entra más plata en las próximas semanas.");
      try {
        let c = t, dias = 30, dec = s.eventoPendiente ? lectura(s).eventoPendiente.opciones[0].id : undefined;
        while (dias > 0 && !c.terminada) { const r = avanzarDias(c, dias, { decision: dec }); c = r.estado; dias -= r.diasAvanzados; dec = r.pausa ? r.pausa.opciones[0].id : undefined; if (!r.pausa) break; }
        filas.push(`Simulación de los próximos 30 días con estas palancas: caja ${millones(c.caja)}, reserva ${millones(c.reserva)}, descubierto ${millones(c.descubierto)} (hoy: caja ${millones(s.caja)}, descubierto ${millones(s.descubierto)}).`);
      } catch { /* nada */ }
      return ok(filas.join("\n"), { antes: A, despues: B });
    }
    case "avanzar_mes":
    case "avanzar": {
      const p = obtener(a.partida_id);
      const { partida_id, decision, unidad = "mes", cantidad = 1, ...resto } = a;
      const s = p.estado, dias = unidad === "dia" ? cantidad : unidad === "semana" ? 7 * cantidad : diasHastaFinDeMeses(s, cantidad);
      const desde = s.dia;
      const r = avanzarDias(s, Math.max(0, dias), { palancas: validarPalancas(resto), decision });
      p.estado = r.estado; guardar();
      const hechos = r.bitacora.filter((b) => b.tipo !== "cierre").map((b) => `• ${b.fecha}: ${b.icono ? b.icono + " " : ""}${b.texto}${b.fuente ? ` (${b.fuente})` : ""}`);
      let txt = `⏩ Avanzaste ${r.diasAvanzados} día(s): del ${textoFecha(r.estado, desde)} al ${textoFecha(r.estado, Math.min(r.estado.dia, DIAS_TOTALES - 1))}.` +
        (r.eventoResuelto ? `\nDecisión: ${r.eventoResuelto.titulo} → ${r.eventoResuelto.label}.` : "") +
        (hechos.length ? "\n" + hechos.slice(-18).join("\n") : "") +
        (r.cierres.length ? "\n\n" + r.cierres.map(textoInforme).join("\n\n") : "") +
        (r.pausa ? `\n\n⏸️ Se detuvo el ${textoFecha(r.estado, r.estado.dia)} por una ${r.pausa.real ? "novedad real" : "novedad"}: ${r.pausa.icono} ${r.pausa.titulo}. Decidí con decision = ${r.pausa.opciones.map((o) => `"${o.id}"`).join(" | ")}.` : "") +
        "\n\n" + tablero(r.estado);
      const extra = { diasAvanzados: r.diasAvanzados, pausa: r.pausa, cierres: r.cierres, bitacora: r.bitacora, lectura: lectura(r.estado) };
      if (r.estado.terminada) {
        const d = diagnostico(r.estado);
        txt += "\n\n" + textoDiagnostico(d) + `\n\nPara contrastar: nueva_partida con repetir_de = "${a.partida_id}" y otro modo_novedades, y después comparar_partidas.`;
        extra.diagnostico = { ...d, lectura: undefined };
      }
      return ok(txt, extra);
    }
    case "linea_de_tiempo": {
      const s = obtener(a.partida_id).estado, lt = lineaDeTiempo(s);
      if (a.mes) {
        const m = /^\d{4}-\d{2}$/.test(a.mes) ? lt.meses.find((x) => x.clave === a.mes) : lt.meses[+a.mes - 1];
        if (!m) throw new Error(`No encuentro el mes "${a.mes}". Meses: ${lt.meses.map((x) => x.clave).join(", ")}`);
        const h = s.historial.find((x) => x.clave === m.clave);
        const txt = [`📅 ${m.nombreLargo}` + (m.temporadas.length ? ` · ${m.temporadas.map((id) => lt.temporadas.find((x) => x.id === id).texto).join(" ")}` : "") + (m.aguinaldo ? " · 💰 mes de aguinaldo" : "") + (m.feriados.length ? ` · feriados: ${m.feriados.map((f) => `${textoFecha(s, f.dia)} (${f.nombre})`).join(", ")}` : ""),
          ...m.entradas.filter((e) => e.tipo !== "cierre").map((e) => `• ${e.fecha}: ${e.icono ? e.icono + " " : ""}${e.texto}${e.fuente ? ` (${e.fuente})` : ""}`),
          h ? "\n" + textoInforme(h.informe) : s.dia >= m.desde && s.dia <= m.hasta ? "\n(mes en curso)" : "\n(todavía no llegó)"].join("\n");
        return ok(txt, { mes: m });
      }
      const filas = lt.meses.map((m) => {
        const marcas = [m.aguinaldo ? "💰" : "", ...m.temporadas.map((id) => (id === "vacaciones" ? "🏖️" : "🌾")), m.feriados.length ? `🇦🇷×${m.feriados.length}` : "", ...m.entradas.filter((e) => (e.tipo === "novedad" || e.tipo === "real") && e.icono).map((e) => e.icono)].join("");
        const est = m.cerrado ? `${m.resultadoCaja >= 0 ? "🟢" : "🔴"} ${millones(m.resultadoCaja)}` : s.dia >= m.desde && s.dia <= m.hasta ? "▶ en curso" : "·";
        return `${m.clave}  ${est.padEnd(16)} ${marcas}`;
      });
      return ok(`Línea de tiempo — inicio ${fCorta(s.inicio)} · hoy: ${lt.fecha}\n` + filas.join("\n") +
        `\n\n💰 aguinaldo · 🏖️ vacaciones (4 al 15 de enero) · 🌾 cosecha (abr-jun) y siembra (sep-nov) · 🇦🇷 feriados nacionales\nVencimientos: ${VENCIMIENTOS.map((v) => `día ${v.dia} ${v.texto.toLowerCase()}`).join("; ")} (si caen en fin de semana o feriado, el día hábil siguiente).\nPedí linea_de_tiempo con mes = YYYY-MM para ver el detalle.`,
        { hoy: lt.hoy, meses: lt.meses.map(({ entradas, ...m }) => ({ ...m, novedades: entradas.filter((e) => ["novedad", "real", "decision"].includes(e.tipo)) })) });
    }
    case "comparar_partidas": {
      const ids = a.ids && a.ids.length ? a.ids : Object.keys(partidas).filter((k) => partidas[k].estado.terminada);
      if (!ids.length) return ok("No hay partidas terminadas para comparar. Terminá una y repetila con nueva_partida + repetir_de usando otro modo_novedades.");
      const rs = ids.map((id) => ({ id, ...resumenPartida(obtener(id).estado) }));
      const meses = Math.max(...rs.map((r) => r.curva.length));
      const txt = [
        "Comparación de partidas (patrimonio real vs. inicio):",
        ...rs.map((r) => `• ${r.id} · ${r.nombre} · inicio ${fCorta(r.inicio)} · semilla ${r.semilla} · novedades ${MODOS_NOVEDADES[r.modoNovedades].nombre.toLowerCase()}${r.terminada ? "" : " (en curso)"} → ${r.cambioPatrimonioReal >= 0 ? "+" : ""}${pct(r.cambioPatrimonioReal, 1)} · ${r.titulo}\n   palancas: cobro ${r.palancas.plazoCobro} d, pago ${r.palancas.plazoPago} d, margen ${pct(r.palancas.markup)}, reparaciones ${pct(r.palancas.reparaciones)}, lista c/${r.palancas.actualizarCada} · ${r.decisiones.length} decisiones, ${r.novedades} novedades · ${r.diasConDatosReales} días con datos reales`),
        "", "Mes a mes:", "mes   " + rs.map((r) => r.id.padStart(9)).join(""),
        ...Array.from({ length: meses }, (_, i) => (rs.find((r) => r.curva[i])?.curva[i].clave || String(i + 1)).padEnd(8) + rs.map((r) => (r.curva[i] ? (r.curva[i].cambio >= 0 ? "+" : "") + pct(r.curva[i].cambio, 1) : "—").padStart(9)).join("")),
      ].join("\n");
      return ok(txt, { partidas: rs });
    }
    case "diagnostico": { const s = obtener(a.partida_id).estado, d = diagnostico(s); return ok((s.terminada ? "" : `(Parcial, ${textoFecha(s, s.dia)})\n`) + textoDiagnostico(d), { ...d, lectura: undefined }); }
    case "explicar": { const g = GLOSARIO(); if (!g[a.tema]) throw new Error(`Tema desconocido. Opciones: ${Object.keys(g).join(", ")}`); return ok(g[a.tema]); }
    case "listar_partidas": {
      const items = Object.entries(partidas).map(([id, p]) => { const L = lectura(p.estado); return { partida_id: id, nombre: p.estado.nombre, inicio: p.estado.inicio, modo: p.estado.modoNovedades, fecha: L.fecha, terminada: p.estado.terminada, semilla: p.estado.semilla, patrimonioReal: L.patrimonioReal / L.patrimonioInicialReal - 1 }; });
      return ok(items.length ? items.map((i) => `${i.partida_id} · ${i.nombre} · inicio ${fCorta(i.inicio)} · ${MODOS_NOVEDADES[i.modo].nombre.toLowerCase()} · ${i.terminada ? "terminada" : `en curso (${i.fecha})`} · patrimonio real ${pct(i.patrimonioReal, 1)} · semilla ${i.semilla}`).join("\n") : "No hay partidas guardadas.", { partidas: items });
    }
    default: throw Object.assign(new Error(`Herramienta desconocida: ${nombre}`), { code: -32602 });
  }
}
function ok(text, structured) { const r = { content: [{ type: "text", text }] }; if (structured) r.structuredContent = JSON.parse(JSON.stringify(structured)); return r; }

// ---------- prompts y recursos ----------
const PROMPT_JUGAR = `Sos el anfitrión de "La Máquina de Caja", un juego educativo para dueños de Pymes de Argentina y Latinoamérica. El jugador maneja un taller metalmecánico durante 12 meses desde hoy, con la economía real del país.

Cómo conducir la partida:
1. Preguntá qué modo de novedades prefiere (mixtas, solo reales o al azar; explicá en una línea cada uno) y llamá a nueva_partida. Presentá el taller en 3-4 líneas, en español rioplatense, cálido y directo. Mencioná los datos reales del día (economia_real) y su fuente.
2. Preguntá a qué ritmo quiere avanzar (por día, semana o mes) y usá avanzar. Mostrá lo esencial: fecha, caja, cobros vs. vencimientos de los próximos 30 días, margen real y si los datos son reales o proyectados.
3. Si el tiempo se detiene por una novedad, presentá las opciones y pedí que elija. Si es una novedad real, aclarálo y citá la fuente.
4. Antes de mover palancas, ofrecé probar_palancas. No digas la jugada óptima: hacé una pregunta que lo haga pensar.
5. Contá cada cierre de mes como una historia corta con una sola lección práctica para su Pyme real.
6. Al terminar, mostrá el diagnóstico y proponé repetir la partida con otro modo de novedades (nueva_partida con repetir_de) y comparar_partidas para ver cuánto pesaron sus decisiones y cuánto los imprevistos.

Los números son una simulación educativa; no es asesoramiento contable ni financiero.`;
const PROMPTS = [
  { name: "jugar", title: "Jugar La Máquina de Caja", description: "Conduce una partida guiada de 12 meses con la economía real.", arguments: [{ name: "nombre_taller", description: "Nombre del taller (opcional)", required: false }] },
  { name: "taller_grupal", title: "Taller grupal (capacitación)", description: "Guion para un facilitador que corre el juego con un grupo, comparando modos de novedades.", arguments: [{ name: "semilla", description: "Semilla común del grupo", required: false }] },
];
function getPrompt(name, args = {}) {
  if (name === "jugar") return { description: PROMPTS[0].description, messages: [{ role: "user", content: { type: "text", text: PROMPT_JUGAR + (args.nombre_taller ? `\n\nEl taller se llama "${args.nombre_taller}".` : "") + "\n\nArrancá." } }] };
  if (name === "taller_grupal") return { description: PROMPTS[1].description, messages: [{ role: "user", content: { type: "text", text: `Vas a facilitar una sesión de 60 minutos con dueños de Pymes industriales usando "La Máquina de Caja". Todas las mesas usan la semilla ${args.semilla || 2026} y la misma fecha de inicio.\n\nArmá: (1) 5 minutos sobre por qué una empresa rentable puede quedarse sin caja, mostrando economia_real; (2) tres rondas de 4 meses: antes de cada ronda cada mesa elige palancas, usá probar_palancas para mostrar el efecto y avanzar (unidad mes, cantidad 4), frenando en cada novedad para que las mesas voten; (3) repetí la partida con novedades solo reales y al azar (repetir_de) y usá comparar_partidas para discutir qué fue decisión y qué fue suerte; (4) cerrá con 5 preguntas para llevar a la empresa el lunes.` } }] };
  throw Object.assign(new Error(`Prompt desconocido: ${name}`), { code: -32602 });
}
const RECURSOS = [{ uri: "maquina-caja://reglas", name: "reglas", title: "Reglas, supuestos y fuentes del juego", mimeType: "text/markdown" }];
function leerRecurso(uri) {
  if (uri !== "maquina-caja://reglas") throw Object.assign(new Error("Recurso desconocido"), { code: -32002 });
  const g = GLOSARIO();
  const txt = `# La Máquina de Caja — reglas (v${VERSION})\n\n${EMPRESA.descripcion}\n\n## Palancas\n${Object.entries(DESCRIPCION_PALANCAS).map(([k, v]) => `- **${k}**: ${v}`).join("\n")}\n\n## Modos de novedades\n${Object.entries(MODOS_NOVEDADES).map(([k, m]) => `- **${k}** (${m.nombre}): ${m.texto}`).join("\n")}\n\n## Supuestos\n- La partida arranca hoy y dura 365 días sobre el calendario real (feriados nacionales incluidos).\n- Cada día usa los datos públicos del día anterior; lo futuro se proyecta con el REM del BCRA y el ritmo reciente del dólar.\n- 55% del costo por pieza sigue al dólar (corregido con precios mayoristas metálicos de INDEC).\n- Sueldos el 5 (mes anterior), aguinaldo 30/6 y antes del 18/12; ajuste trimestral con el índice de salarios INDEC.\n- Impuestos: 7% de lo facturado, el 20 del mes siguiente.\n- Reserva: tasa real de plazo fijo. Descubierto: tasa real de adelantos; límite 3 masas salariales.\n\n## Conceptos\n${Object.entries(g).map(([k, v]) => `- **${k}**: ${v}`).join("\n")}\n`;
  return { contents: [{ uri, mimeType: "text/markdown", text: txt }] };
}

// ---------- JSON-RPC por stdio ----------
const enviar = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const responder = (id, result) => enviar({ jsonrpc: "2.0", id, result });
const error = (id, code, message) => enviar({ jsonrpc: "2.0", id, error: { code, message } });
async function manejar(msg) {
  const { id, method, params = {} } = msg, notif = id === undefined || id === null;
  try {
    switch (method) {
      case "initialize": {
        const pv = PROTOCOLOS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLOS[0];
        return responder(id, { protocolVersion: pv, capabilities: { tools: {}, prompts: {}, resources: {} },
          serverInfo: { name: "maquina-caja", title: "La Máquina de Caja — Pyme metalmecánica", version: VERSION },
          instructions: "Juego educativo de flujo de caja para dueños de Pymes argentinas (taller metalmecánico, 12 meses desde hoy con la economía real: cada día usa los datos públicos del día anterior). Empezá con nueva_partida (preguntá el modo de novedades: mixtas, reales o azar), mostrá ver_tablero y economia_real, dejá que el jugador decida palancas (probar_palancas) y hacé correr el tiempo con avanzar. Si se pausa por una novedad, pedí la decisión. Al final ofrecé repetir con otro modo y comparar_partidas. Hablá en español rioplatense." });
      }
      case "notifications/initialized": case "notifications/cancelled": return;
      case "ping": return responder(id, {});
      case "tools/list": return responder(id, { tools: TOOLS });
      case "tools/call":
        try { return responder(id, await llamar(params.name, params.arguments || {})); }
        catch (e) { if (e.code === -32602) return error(id, e.code, e.message); return responder(id, { content: [{ type: "text", text: e.message }], isError: true }); }
      case "prompts/list": return responder(id, { prompts: PROMPTS });
      case "prompts/get": return responder(id, getPrompt(params.name, params.arguments));
      case "resources/list": return responder(id, { resources: RECURSOS });
      case "resources/templates/list": return responder(id, { resourceTemplates: [] });
      case "resources/read": return responder(id, leerRecurso(params.uri));
      default: if (!notif) error(id, -32601, `Método no soportado: ${method}`);
    }
  } catch (e) { if (!notif) error(id, e.code || -32603, e.message); }
}
const rl = createInterface({ input: process.stdin });
rl.on("line", (linea) => {
  if (!linea.trim()) return;
  let msg; try { msg = JSON.parse(linea); } catch { return error(null, -32700, "JSON inválido"); }
  if (Array.isArray(msg)) msg.forEach(manejar); else manejar(msg);
});
cargarDatos(true).catch(() => {});
log(`v${VERSION} listo. Partidas en ${ARCHIVO}`);

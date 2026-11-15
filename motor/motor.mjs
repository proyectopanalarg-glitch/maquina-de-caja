// La Máquina de Caja — edición metalmecánica
// Motor de simulación puro (sin dependencias, sin DOM). Lo usan el juego web y el MCP server.
//
// v3: la partida arranca HOY y dura 365 días sobre el calendario real (feriados nacionales incluidos).
// Cada día del juego toma los datos reales del DÍA ANTERIOR (dólar, tasas, inflación publicada por INDEC,
// precios mayoristas metálicos, salarios). Para las fechas que todavía no pasaron, proyecta con las
// expectativas del BCRA (REM). Las novedades pueden ser mixtas, solo reales o al azar.
// El estado es JSON serializable.

export const VERSION = "3.0.0";
export const DIAS_TOTALES = 365;
export const NOMBRES_MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_SEM = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIA_MS = 86400000;

function rnd(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------- fechas ----------
export const isoHoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const msDe = (iso) => Date.parse(iso + "T00:00:00Z");
export const sumarDias = (iso, n) => new Date(msDe(iso) + n * DIA_MS).toISOString().slice(0, 10);
export function fechaDe(s, dia) {
  const d = new Date(msDe(s.inicio) + dia * DIA_MS);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth(), dia: d.getUTCDate(), semana: d.getUTCDay(), iso: d.toISOString().slice(0, 10), serial: d.getUTCFullYear() * 12 + d.getUTCMonth() };
}
export const diaDeIso = (s, iso) => Math.round((msDe(iso) - msDe(s.inicio)) / DIA_MS);
const isoDe = (anio, mes, dia) => new Date(Date.UTC(anio, mes, dia)).toISOString().slice(0, 10);
export const diasDelMes = (anio, mes) => new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
const claveMes = (anio, mes) => `${anio}-${String(mes + 1).padStart(2, "0")}`;
export function textoFecha(s, dia, largo = false) {
  const f = fechaDe(s, dia);
  return largo ? `${DIAS_SEM[f.semana]} ${f.dia} de ${MESES_LARGOS[f.mes]} de ${f.anio}` : `${DIAS_SEM[f.semana]} ${f.dia} ${NOMBRES_MES[f.mes].toLowerCase()}`;
}

// ---------- economía real ----------
// Se carga una vez (juego web: datos/economia.json; MCP: lo baja de GitHub Pages). Sin datos, todo se proyecta.
let ECO = null;
const FERIADOS_FIJOS = ["01-01", "03-24", "04-02", "05-01", "05-25", "06-20", "07-09", "12-08", "12-25"];
export function cargarEconomia(d) {
  if (!d) { ECO = null; return null; }
  const mapa = (arr) => new Map((arr || []).filter((x) => Array.isArray(x) && Number.isFinite(+x[1])).map(([f, v]) => [f, +v]));
  const ordenada = (arr) => (arr || []).filter((x) => Array.isArray(x)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  ECO = {
    crudo: d,
    fechaDatos: d.fechaDatos || null,
    actualizado: d.actualizado || null,
    fuentes: d.fuentes || [],
    oficial: mapa(d.dolarOficial), oficialArr: ordenada(d.dolarOficial),
    mayorista: mapa(d.dolarMayorista), mep: mapa(d.dolarMEP), mepArr: ordenada(d.dolarMEP),
    inflacion: new Map((d.inflacion || []).map(([m, v]) => [m, +v / 100])),
    remAnual: d.remAnual && Number.isFinite(+d.remAnual.valor) ? { ...d.remAnual, valor: +d.remAnual.valor / 100 } : null,
    pf: ordenada(d.tasaPlazoFijo).map(([f, v]) => [f, +v / 100]),
    adel: ordenada(d.tasaAdelantos).map(([f, v]) => [f, +v / 100]),
    ipim: new Map((d.ipimMetal || []).map(([m, v]) => [m, +v])),
    salarios: new Map((d.salarios || []).map(([m, v]) => [m, +v])),
    feriados: new Map((d.feriados || []).map((f) => [f.fecha, f.nombre || "Feriado"])),
    deslizamiento: Number.isFinite(+d.deslizamientoMensual) ? +d.deslizamientoMensual / 100 : null,
  };
  return resumenEconomia();
}
export const economiaCargada = () => !!(ECO && ECO.fechaDatos);

// valor real en una fecha o el último anterior (hasta `atras` días), solo si ya ocurrió
function realEn(map, iso, atras = 7) {
  if (!ECO || !map || !ECO.fechaDatos || iso > ECO.fechaDatos) return null;
  for (let i = 0; i <= atras; i++) { const f = sumarDias(iso, -i); if (map.has(f)) return { fecha: f, valor: map.get(f) }; }
  return null;
}
function ultimoArr(arr, iso) { let r = null; for (const x of arr || []) { if (x[0] <= iso) r = x; else break; } return r ? { fecha: r[0], valor: r[1] } : null; }
const remMensual = () => (ECO && ECO.remAnual ? Math.pow(1 + ECO.remAnual.valor, 1 / 12) - 1 : null);
function ultimaInflacionReal() { if (!ECO) return null; const ks = [...ECO.inflacion.keys()].sort(); return ks.length ? { mes: ks.at(-1), valor: ECO.inflacion.get(ks.at(-1)) } : null; }
function inflacionProyectada() { return remMensual() ?? ultimaInflacionReal()?.valor ?? EMPRESA.inflacion; }
const esFeriado = (iso) => (ECO && ECO.feriados.size ? ECO.feriados.has(iso) : FERIADOS_FIJOS.includes(iso.slice(5)));
const nombreFeriado = (iso) => (ECO && ECO.feriados.get(iso)) || "Feriado nacional";

export function resumenEconomia(s) {
  const iso = ECO?.fechaDatos;
  const ofi = ECO ? ultimoArr(ECO.oficialArr, iso || "9999") : null;
  const mep = ECO ? ultimoArr(ECO.mepArr, iso || "9999") : null;
  const inf = ultimaInflacionReal();
  const pf = ECO ? ultimoArr(ECO.pf, iso || "9999") : null;
  const ad = ECO ? ultimoArr(ECO.adel, iso || "9999") : null;
  return {
    hayDatos: economiaCargada(), fechaDatos: iso || null, actualizado: ECO?.actualizado || null,
    dolarOficial: ofi, dolarMEP: mep,
    inflacionUltima: inf, remAnual: ECO?.remAnual || null, inflacionProyectadaMensual: inflacionProyectada(),
    tasaPlazoFijo: pf, tasaAdelantos: ad, deslizamientoMensual: ECO?.deslizamiento ?? null,
    fuentes: ECO?.fuentes || [],
  };
}

// ---------- calendario del juego ----------
const enVacaciones = (f) => f.mes === 0 && f.dia >= 4 && f.dia <= 15;
function habil(s, dia) { const f = fechaDe(s, dia); return f.semana !== 0 && f.semana !== 6 && !enVacaciones(f) && !esFeriado(f.iso); }
export function habilBancario(s, dia) { let d = dia; for (;;) { const f = fechaDe(s, d); if (f.semana !== 0 && f.semana !== 6 && !esFeriado(f.iso)) return d; d++; } }
function habilBancarioAntes(s, dia) { let d = dia; for (;;) { const f = fechaDe(s, d); if (f.semana !== 0 && f.semana !== 6 && !esFeriado(f.iso)) return d; d--; } }
function habilesDelMes(s, anio, mes) {
  let n = 0; const d0 = diaDeIso(s, isoDe(anio, mes, 1));
  for (let i = 0; i < diasDelMes(anio, mes); i++) if (habil(s, d0 + i)) n++;
  return Math.max(1, n);
}
const finDeMes = (s, dia) => { const f = fechaDe(s, dia); return diaDeIso(s, isoDe(f.anio, f.mes, diasDelMes(f.anio, f.mes))); };
const vencimiento = (s, dia, diaDelMes) => { const f = fechaDe(s, dia); return habilBancario(s, diaDeIso(s, isoDe(f.anio, f.mes + 1, diaDelMes))); };

export function temporadas(s) {
  const out = [], a0 = fechaDe(s, 0).anio, a1 = fechaDe(s, DIAS_TOTALES - 1).anio;
  for (let a = a0; a <= a1; a++) {
    out.push({ id: "vacaciones", nombre: "Vacaciones colectivas", desde: diaDeIso(s, isoDe(a, 0, 4)), hasta: diaDeIso(s, isoDe(a, 0, 15)), texto: "El taller cierra del 4 al 15 de enero: no se produce, pero los sueldos se pagan igual." });
    out.push({ id: "cosecha", nombre: "Cosecha gruesa", desde: diaDeIso(s, isoDe(a, 3, 1)), hasta: diaDeIso(s, isoDe(a, 5, 30)), texto: "Abril a junio: los fabricantes de maquinaria agrícola piden más repuestos (+15%)." });
    out.push({ id: "siembra", nombre: "Siembra", desde: diaDeIso(s, isoDe(a, 8, 1)), hasta: diaDeIso(s, isoDe(a, 10, 30)), texto: "Septiembre a noviembre: segunda ola de pedidos del agro (+10%)." });
  }
  return out.filter((t) => t.hasta >= 0 && t.desde < DIAS_TOTALES).map((t) => ({ ...t, desde: Math.max(0, t.desde), hasta: Math.min(DIAS_TOTALES - 1, t.hasta) }));
}
export function aguinaldos(s) {
  const out = [], a0 = fechaDe(s, 0).anio, a1 = fechaDe(s, DIAS_TOTALES - 1).anio;
  for (let a = a0; a <= a1; a++) for (const [m, d] of [[5, 30], [11, 18]]) {
    const dia = habilBancarioAntes(s, diaDeIso(s, isoDe(a, m, d)));
    if (dia >= 0 && dia < DIAS_TOTALES) out.push(dia);
  }
  return out;
}
export const ESTACIONALIDAD = [0.75, 0.9, 1, 1.15, 1.15, 1.15, 0.95, 0.95, 1.1, 1.1, 1.1, 0.9];
export const VENCIMIENTOS = [
  { id: "alquiler", dia: 1, texto: "Alquiler del galpón" },
  { id: "sueldos", dia: 5, texto: "Sueldos del mes anterior" },
  { id: "cuota", dia: 10, texto: "Cuota del crédito (si tomaste uno)" },
  { id: "energia", dia: 15, texto: "Luz, gas, ART y seguros" },
  { id: "impuestos", dia: 20, texto: "ARCA e Ingresos Brutos sobre lo facturado el mes anterior" },
];

// ---------- la empresa ----------
export const EMPRESA = {
  descripcion:
    "Taller metalmecánico de 14 operarios (UOM) en el conurbano. Fabrica piezas mecanizadas y subconjuntos " +
    "para maquinaria agrícola y autopartistas, y hace tornería y reparaciones. Usa la mitad de su capacidad.",
  unidad: "piezas", costoBase: 21000, partAcero: 0.55, markup: 0.8,
  demandaBase: 2060, capacidad: 3600, elasticidad: 2.6,
  sueldos: 20000000, alquiler: 2500000, servicios: 3600000, cajaInicial: 32000000,
  reparacionesMax: 17000000, inflacion: 0.02, deslizamientoDolar: 0.015,
  spreadDescubierto: 0.035, // si no hay tasa real de adelantos: inflación + 3,5% mensual
};
export const PALANCAS_DEFAULT = { markup: EMPRESA.markup, plazoCobro: 60, plazoPago: 30, actualizarCada: 2, reservaPct: 0.3, reparaciones: 0.1 };
export const DESCRIPCION_PALANCAS = {
  markup: "Margen sobre el costo cuando actualizás la lista, el día 1 del mes que toca (0 a 3; 0.8 = 80%). Más margen = menos pedidos, sobre todo con importados.",
  plazoCobro: "Días que das a tus clientes: 0, 30, 60 o 90. Más plazo = más pedidos, pero la plata llega tarde y devaluada.",
  plazoPago: "Días que te da el distribuidor de acero: 0 (3% de descuento), 30, o 60 (recarga inflación + 1%).",
  actualizarCada: "Cada cuántos meses actualizás la lista de precios: 1, 2 o 3. Remarcar todos los meses espanta un poco.",
  reservaPct: "Qué parte del excedente de caja mandás a la reserva (FCI / plazo fijo) al cerrar cada mes. 0 a 1.",
  reparaciones: "Parte del taller dedicada a tornería y reparaciones (0 a 0.5): se cobra contado, pero quita foco a la serie.",
};
export const MODOS_NOVEDADES = {
  mixtas: { nombre: "Mixtas", texto: "Las novedades del mercado salen de los datos reales (dólar, inflación, tasas); las del taller se sortean." },
  reales: { nombre: "Solo reales", texto: "Solo lo que muestran los datos públicos. Sin sorteo: si la economía está tranquila, el año también." },
  azar: { nombre: "Al azar", texto: "Todas las novedades se sortean, como en un simulador clásico. Los datos reales igual mueven precios y tasas." },
};
const TASA_IMPUESTOS = 0.07;

// ---------- novedades sorteadas ----------
export const EVENTOS = {
  devaluacion: { tipo: "mercado", titulo: "Salta el dólar", icono: "💵",
    texto: "El tipo de cambio sube 15% en una semana. El acero y los insumos importados se remarcan y la inflación se acelera dos meses.",
    aplicar(s) { s.dolarExtra *= 1.15; s.dolar *= 1.15; s.inflacionExtra = { meses: 2, pp: 0.02 }; s.inflMes += 0.02; } },
  acero: { tipo: "mercado", titulo: "La siderúrgica sube la lista", icono: "🔩", texto: "Tu distribuidor te avisa que la chapa y la barra suben 8% desde hoy.", aplicar(s) { s.costoAceroExtra *= 1.08; } },
  paritaria_uom: { tipo: "mercado", titulo: "Cierra la paritaria UOM", icono: "🤝", texto: "La UOM firmó un aumento extra de 6% más una suma fija. Tu masa salarial sube 7%.", aplicar(s) { s.sueldos *= 1.07; } },
  tarifas: { tipo: "mercado", titulo: "Tarifazo de luz industrial", icono: "⚡", texto: "Se reducen subsidios: la luz del taller sube 35% y tus gastos de energía, ART y seguros suben 25% en total.", aplicar(s) { s.servicios *= 1.25; } },
  cosecha_record: { tipo: "taller", titulo: "Cosecha récord", icono: "🌾", texto: "Los fabricantes de maquinaria agrícola aceleran pedidos de repuestos. Tu demanda sube 30% hasta fin de mes.", aplicar(s, _o, c) { s.efectos.push({ tipo: "demanda", mult: 1.3, hasta: c.hastaFinDeMes }); } },
  vaca_muerta: { tipo: "taller", titulo: "Llamado de una petrolera", icono: "🛢️", texto: "Una contratista de Vaca Muerta busca talleres para mantenimiento. La demanda de reparaciones se duplica por 60 días.", aplicar(s) { s.efectos.push({ tipo: "reparaciones", mult: 2, hasta: s.dia + 60 }); } },
  importados: { tipo: "taller", titulo: "Entran piezas importadas más baratas", icono: "🚢",
    texto: "Un autopartista empieza a traer piezas de Asia 30% más baratas. Si no hacés nada, perdés 20% de pedidos por 90 días.",
    opciones: [{ id: "bajar_precio", label: "Bajar 15 puntos el margen ya mismo para retenerlo" }, { id: "reconvertir", label: "Reconvertir: más reparaciones, aceptar la pérdida en serie" }, { id: "nada", label: "No hacer nada y esperar" }],
    aplicar(s, op) {
      if (op === "bajar_precio") { s.palancas.markup = Math.max(0.1, s.palancas.markup - 0.15); remarcar(s); s.efectos.push({ tipo: "demanda", mult: 0.95, hasta: s.dia + 90 }); }
      else { s.efectos.push({ tipo: "demanda", mult: 0.8, hasta: s.dia + 90 }); if (op === "reconvertir") s.efectos.push({ tipo: "reparaciones", mult: 1.4, hasta: s.dia + 90 }); }
    } },
  cliente_grande: { tipo: "taller", titulo: "Una terminal te ofrece un pedido grande", icono: "🚗",
    texto: "Una automotriz te ofrece un pedido extra del 40% de tu producción mensual. Paga con e-cheq a 120 días.",
    opciones: [{ id: "aceptar", label: "Aceptar el e-cheq a 120 días" }, { id: "descontar", label: "Aceptar y descontar el e-cheq en el banco (te queda 88% hoy)" }, { id: "rechazar", label: "Rechazar el pedido" }],
    aplicar(s, op) {
      if (op === "rechazar") return;
      const u = EMPRESA.demandaBase * 0.4, venta = u * s.precio;
      s.acum.facturado += venta; s.acum.facturadoSerie += venta; s.acum.piezas += u;
      if (op === "aceptar") agendar(s.cobros, s.dia + 120, venta * 0.96); else s.ingresoHoy += venta * 0.88;
      agendar(s.pagos, s.dia + s.palancas.plazoPago, u * s.costoUnit);
    } },
  echeq_rechazado: { tipo: "taller", titulo: "Te rechazan un e-cheq", icono: "❌",
    texto: "Un concesionario de maquinaria agrícola te rechazó un e-cheq: es el 30% de lo que ibas a cobrar en los próximos 30 días.",
    opciones: [{ id: "renegociar", label: "Renegociar: cobrás 75% en 60 días" }, { id: "financiera", label: "Ceder la deuda a una financiera: cobrás 50% ahora" }],
    aplicar(s, op) {
      let monto = 0;
      for (let d = s.dia; d < s.dia + 30; d++) if (s.cobros[d]) { const q = s.cobros[d] * 0.3; s.cobros[d] -= q; monto += q; }
      if (op === "financiera") s.ingresoHoy += monto * 0.5; else agendar(s.cobros, s.dia + 60, monto * 0.75);
    } },
  cnc_roto: { tipo: "taller", titulo: "Se rompe el torno CNC", icono: "🔧", texto: "El centro de mecanizado principal se quema la placa. El repuesto viene de afuera.",
    opciones: [{ id: "arreglar", label: "Arreglarlo bien: 20% de la masa salarial, hoy" }, { id: "parche", label: "Parche: 5%, pero perdés 40% de capacidad por 30 días" }],
    aplicar(s, op) { if (op === "arreglar") s.gastoHoy += s.sueldos * 0.2; else { s.gastoHoy += s.sueldos * 0.05; s.efectos.push({ tipo: "capacidad", mult: 0.6, hasta: s.dia + 30 }); } } },
  credito: { tipo: "taller", titulo: "Línea de crédito para bienes de capital", icono: "🏦",
    texto: "Un banco público ofrece crédito para un CNC nuevo: baja 6% tu costo por pieza y suma 20% de capacidad. Cuota: 9% de la masa salarial durante 12 meses, el día 10.",
    opciones: [{ id: "tomar", label: "Tomar el crédito y comprar el CNC" }, { id: "no", label: "No endeudarse" }],
    aplicar(s, op) { if (op !== "tomar") return; s.mejoraCosto *= 0.94; s.capacidadExtra *= 1.2; s.credito = { cuota: s.sueldos * 0.09, restantes: 12 }; } },
  caida_pedidos: { tipo: "taller", titulo: "Se frenan los pedidos", icono: "📉", texto: "Dos clientes postergan órdenes. La demanda cae 25% durante 60 días.",
    opciones: [{ id: "mantener", label: "Mantener a todo el personal" }, { id: "suspender", label: "Suspensiones acordadas con la UOM (sueldos -20% por 60 días)" }],
    aplicar(s, op) { s.efectos.push({ tipo: "demanda", mult: 0.75, hasta: s.dia + 60 }); if (op === "suspender") s.efectos.push({ tipo: "sueldos", mult: 0.8, hasta: s.dia + 60 }, { tipo: "capacidad", mult: 0.8, hasta: s.dia + 60 }); } },
  moratoria: { tipo: "taller", titulo: "ARCA lanza un plan de pagos", icono: "📄", texto: "Podés pasar el próximo vencimiento de impuestos a 6 cuotas mensuales con 3% de interés mensual.",
    opciones: [{ id: "adherir", label: "Adherir al plan (6 cuotas)" }, { id: "no", label: "Pagar normal" }],
    aplicar(s, op) {
      if (op !== "adherir") return;
      const prox = Object.keys(s.impuestos).map(Number).filter((d) => d >= s.dia).sort((a, b) => a - b)[0];
      if (prox === undefined) { s.moratoriaPendiente = true; return; }
      diferirImpuesto(s, prox);
    } },
  acero_contado: { tipo: "taller", titulo: "El distribuidor de acero corta el crédito", icono: "🧾", texto: "Por la cadena de pagos, te exige pago contado hasta fin de mes.",
    opciones: [{ id: "aceptar", label: "Aceptar: pagás contado hasta fin de mes" }, { id: "cambiar", label: "Cambiar a otro distribuidor 5% más caro que te da 30 días" }],
    aplicar(s, op, c) { if (op === "aceptar") s.efectos.push({ tipo: "pagoContado", mult: 1, hasta: c.hastaFinDeMes }); else s.costoAceroExtra *= 1.05; } },
};
// novedades que se sortean en cada modo
const SORTEABLES = {
  azar: Object.keys(EVENTOS),
  mixtas: Object.keys(EVENTOS).filter((k) => !["devaluacion"].includes(k)), // el dólar lo mueven los datos reales
  reales: [],
};

// novedades que salen de los datos reales (se arman con los números del día)
const OPCIONES_REMARCAR = [{ id: "remarcar", label: "Actualizar la lista de precios hoy mismo" }, { id: "esperar", label: "Esperar a la próxima actualización programada" }];
function aplicarReal(s, ev, op) { if (ev.accion === "remarcar" && op === "remarcar") remarcar(s); }

function diferirImpuesto(s, dia) {
  const total = s.impuestos[dia] || 0; delete s.impuestos[dia];
  for (let k = 0; k < 6; k++) agendar(s.impuestos, vencimiento(s, dia + 31 * (k - 1) + 1, 20) + 0, (total / 6) * Math.pow(1.03, k + 1));
}
function remarcar(s) { s.precio = s.costoUnit * (1 + s.palancas.markup); s.mesUltimaLista = fechaDe(s, s.dia).serial; s.acum.remarcaste = true; }

// ---------- utilidades ----------
function agendar(cola, dia, monto) { if (monto) cola[dia] = (cola[dia] || 0) + monto; }
const sumaEntre = (cola, desde, hasta) => Object.entries(cola).reduce((a, [k, v]) => (+k >= desde && +k < hasta ? a + v : a), 0);
const efecto = (s, tipo) => s.efectos.filter((e) => e.tipo === tipo && e.hasta >= s.dia).reduce((a, e) => a * e.mult, 1);
const hayEfecto = (s, tipo) => s.efectos.some((e) => e.tipo === tipo && e.hasta >= s.dia);

// ---------- crear partida ----------
export function crearPartida({ semilla, nombre = "Don Chatarrin", inicio, modoNovedades = "mixtas" } = {}) {
  const E = EMPRESA;
  const seed = Number.isFinite(+semilla) && semilla !== null && semilla !== "" ? +semilla | 0 : (Math.random() * 2 ** 31) | 0;
  if (!MODOS_NOVEDADES[modoNovedades]) throw new Error(`Modo de novedades desconocido: ${modoNovedades}. Opciones: ${Object.keys(MODOS_NOVEDADES).join(", ")}`);
  const ini = inicio && /^\d{4}-\d{2}-\d{2}$/.test(inicio) ? inicio : isoHoyAR();
  const precio = E.costoBase * (1 + E.markup), ventasMes = E.demandaBase * precio, comprasMes = E.demandaBase * E.costoBase;
  const s = {
    version: VERSION, nombre, semilla: seed, rng: seed, inicio: ini, modoNovedades,
    dia: 0, terminada: false, quiebra: false,
    inflacion: E.inflacion, inflacionExtra: null, inflMes: E.inflacion, inflMesFuente: "supuesto", indice: 1,
    dolar: 1, dolarExtra: 1, dolarBase: null, costoAceroExtra: 1, mejoraCosto: 1, capacidadExtra: 1,
    costoUnit: E.costoBase, precio, mesUltimaLista: null,
    sueldos: E.sueldos, alquiler: E.alquiler, servicios: E.servicios, indiceParitaria: 1, indiceAlquiler: 1,
    caja: E.cajaInicial, reserva: 0, descubierto: 0, limiteDescubierto: E.sueldos * 3,
    cobros: {}, pagos: {}, impuestos: {}, sueldosAPagar: {},
    credito: null, moratoriaPendiente: false, palancas: { ...PALANCAS_DEFAULT },
    efectos: [], eventoProgramado: null, eventoPendiente: null, eventosVistos: [], ultimoEventoReal: {},
    inflacionUsada: {}, inflacionCorregida: {}, ipimAplicado: {}, salariosUsados: {},
    ingresoHoy: 0, gastoHoy: 0, acum: null, historial: [], bitacora: [], usoDatos: { reales: 0, proyectados: 0 },
  };
  const f0 = fechaDe(s, 0);
  s.mesUltimaLista = f0.serial;
  // Lo que venía de antes: dos meses de ventas en la calle (cobro a 60), un mes de acero a 30 días,
  // los sueldos del mes anterior (si todavía no se pagaron) y los impuestos del mes anterior (el 20).
  for (let d = 0; d < 59; d++) agendar(s.cobros, d, ventasMes / 29.5);
  for (let d = 0; d < 31; d++) agendar(s.pagos, d, comprasMes / 31);
  const d5 = habilBancario(s, diaDeIso(s, isoDe(f0.anio, f0.mes, 5))), d20 = habilBancario(s, diaDeIso(s, isoDe(f0.anio, f0.mes, 20)));
  if (d5 >= 0) agendar(s.sueldosAPagar, d5, E.sueldos);
  if (d20 >= 0) agendar(s.impuestos, d20, ventasMes * TASA_IMPUESTOS);
  // dólar de referencia: el oficial real del día anterior al inicio
  // (si la partida arranca después del último dato, se toma el último oficial publicado como base)
  const ayerIni = sumarDias(ini, -1);
  const r = ECO ? (realEn(ECO.oficial, ayerIni, 10) || ultimoArr(ECO.oficialArr, ECO.fechaDatos && ayerIni > ECO.fechaDatos ? ECO.fechaDatos : ayerIni)) : null;
  if (r) s.dolarBase = r.valor;
  const im = inflacionDelMes(f0); s.inflacion = im.inf; s.inflMes = im.inf; s.inflMesFuente = im.fuente;
  s.acum = acumuladoVacio(s);
  s.acum.facturado = ventasMes * ((f0.dia - 1) / diasDelMes(f0.anio, f0.mes)); // lo facturado este mes antes de empezar
  s.patrimonioInicialReal = patrimonio(s);
  anotar(s, "hito", `Arranca la partida (${MODOS_NOVEDADES[modoNovedades].nombre.toLowerCase()})${economiaCargada() ? ` con datos reales al ${fechaCorta(ECO.fechaDatos)}` : " sin datos reales cargados: todo se proyecta"}.`);
  return s;
}
const fechaCorta = (iso) => `${+iso.slice(8, 10)}/${+iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function acumuladoVacio(s) {
  const f = fechaDe(s, s.dia);
  return { clave: claveMes(f.anio, f.mes), anio: f.anio, mes: f.mes, facturado: 0, facturadoSerie: 0, facturadoReparaciones: 0, piezas: 0, cobrado: 0,
    egresos: { acero: 0, sueldos: 0, aguinaldo: 0, impuestos: 0, alquiler: 0, energia: 0, cuotaCredito: 0, imprevistos: 0, intereses: 0 },
    rendimientoReserva: 0, nuevoDescubierto: 0, rescateReserva: 0, deudaPagada: 0, eventos: [], remarcaste: false, diasReales: 0, diasProyectados: 0 };
}

// ---------- lectura ----------
export function patrimonio(s) {
  const r = (1 + s.inflacion) ** (1 / 30);
  const desc = (cola) => Object.entries(cola).reduce((a, [k, v]) => (+k >= s.dia ? a + v / Math.pow(r, +k - s.dia) : a), 0);
  const deudaCredito = s.credito ? s.credito.cuota * s.credito.restantes : 0;
  return (s.caja + s.reserva + desc(s.cobros) * 0.98 - desc(s.pagos) - desc(s.impuestos) - desc(s.sueldosAPagar) - s.descubierto - deudaCredito * 0.85) / s.indice;
}
function costoActual(s) {
  return EMPRESA.costoBase * (EMPRESA.partAcero * s.dolar * s.costoAceroExtra + (1 - EMPRESA.partAcero) * s.indice) * s.mejoraCosto;
}
function publicarEvento(s) {
  const e = s.eventoPendiente; if (!e) return null;
  if (e.real) return { ...e };
  const ev = EVENTOS[e.id];
  return { id: e.id, titulo: ev.titulo, icono: ev.icono, texto: ev.texto, opciones: ev.opciones ? ev.opciones.map((o) => ({ ...o })) : null, real: false };
}

export function demandaEstimada(s, palancas = s.palancas) {
  const E = EMPRESA, markupReal = s.precio / s.costoUnit - 1;
  let d = E.demandaBase * Math.pow((1 + E.markup) / (1 + markupReal), E.elasticidad);
  d *= { 0: 0.88, 30: 0.975, 60: 1, 90: 1.04 }[palancas.plazoCobro];
  if (palancas.actualizarCada === 1) d *= 0.985;
  d *= 1 - palancas.reparaciones * 0.3;
  return d * efecto(s, "demanda");
}
export const capacidadSerie = (s, palancas = s.palancas) => EMPRESA.capacidad * s.capacidadExtra * efecto(s, "capacidad") * (1 - palancas.reparaciones);
export function facturacionReparaciones(s, palancas = s.palancas) {
  return EMPRESA.reparacionesMax * Math.sqrt(palancas.reparaciones / 0.5) * s.indice * efecto(s, "reparaciones") * efecto(s, "capacidad");
}

export function vencimientos(s, n = 30) {
  const hasta = s.dia + n, ag = aguinaldos(s);
  const items = { acero: sumaEntre(s.pagos, s.dia, hasta), impuestos: sumaEntre(s.impuestos, s.dia, hasta), sueldos: sumaEntre(s.sueldosAPagar, s.dia, hasta), alquiler: 0, energia: 0, cuotaCredito: 0, aguinaldo: 0 };
  for (let d = s.dia; d < hasta; d++) {
    const f = fechaDe(s, d);
    if (f.dia === 1) items.alquiler += s.alquiler;
    if (f.dia === 15) items.energia += s.servicios;
    if (f.dia === 10 && s.credito && s.credito.restantes > 0) items.cuotaCredito += s.credito.cuota;
    if (ag.includes(d)) items.aguinaldo += s.sueldos * 0.5;
  }
  const pagoSig = vencimiento(s, s.dia, 5);
  if (pagoSig < hasta && !s.sueldosAPagar[pagoSig]) items.sueldos += s.sueldos * efecto(s, "sueldos");
  items.total = Object.values(items).reduce((a, b) => a + b, 0);
  return items;
}

// Indicadores de la economía para el día de juego (real del día anterior o proyección)
export function indicadores(s) {
  const dia = Math.min(s.dia, DIAS_TOTALES - 1), iso = fechaDe(s, dia).iso, ayer = sumarDias(iso, -1);
  const ofi = ECO ? realEn(ECO.oficial, ayer, 10) : null;
  const mep = ECO ? realEn(ECO.mep, ayer, 10) : null;
  const pf = ECO ? ultimoArr(ECO.pf, ayer) : null;
  const ad = ECO ? ultimoArr(ECO.adel, ayer) : null;
  const pfReal = pf && ECO.fechaDatos && ayer <= ECO.fechaDatos;
  const dolarProy = s.dolarBase ? s.dolarBase * s.dolar : null;
  return {
    fecha: iso, fechaDato: ayer,
    dolarOficial: ofi ? { valor: ofi.valor, fecha: ofi.fecha, fuente: "real" } : dolarProy ? { valor: dolarProy, fuente: "proyección" } : null,
    dolarMEP: mep ? { valor: mep.valor, fecha: mep.fecha, fuente: "real" } : null,
    inflacionMes: { valor: s.inflMes, fuente: s.inflMesFuente },
    remAnual: ECO?.remAnual || null,
    tasaPlazoFijo: pf ? { valor: pf.valor, fecha: pf.fecha, fuente: pfReal ? "real" : "último dato" } : null,
    tasaDescubierto: ad ? { valor: ad.valor, fecha: ad.fecha, fuente: ayer <= (ECO.fechaDatos || "") ? "real" : "último dato" } : null,
    feriado: esFeriado(iso) ? nombreFeriado(iso) : null,
    hayDatos: economiaCargada(), fechaDatos: ECO?.fechaDatos || null,
    esReal: !!(ECO?.fechaDatos && ayer <= ECO.fechaDatos),
  };
}

export function lectura(s) {
  const fijos = s.sueldos * efecto(s, "sueldos") + s.alquiler + s.servicios + (s.credito && s.credito.restantes > 0 ? s.credito.cuota : 0);
  const dia = Math.min(s.dia, DIAS_TOTALES - 1), f = fechaDe(s, dia), markupReal = s.precio / s.costoUnit - 1;
  const demanda = demandaEstimada(s) * ESTACIONALIDAD[f.mes], cap = capacidadSerie(s), v30 = vencimientos(s, 30), rep30 = facturacionReparaciones(s);
  return {
    empresa: s.nombre, inicio: s.inicio, modoNovedades: s.modoNovedades,
    dia: s.dia, diasTotales: DIAS_TOTALES, fecha: textoFecha(s, dia), fechaLarga: textoFecha(s, dia, true), fechaIso: f.iso,
    mes: f.mes, mesNombre: NOMBRES_MES[f.mes], mesesCerrados: s.historial.length, terminada: s.terminada, quiebra: s.quiebra,
    temporada: temporadas(s).filter((t) => s.dia >= t.desde && s.dia <= t.hasta).map((t) => t.nombre),
    caja: s.caja, reserva: s.reserva, descubierto: s.descubierto, limiteDescubierto: s.limiteDescubierto,
    porCobrar: sumaEntre(s.cobros, s.dia, Infinity), porPagarAcero: sumaEntre(s.pagos, s.dia, Infinity), impuestosAPagar: sumaEntre(s.impuestos, s.dia, Infinity),
    cobrosProximos30: sumaEntre(s.cobros, s.dia, s.dia + 30), reparacionesProximos30: rep30, vencimientosProximos30: v30, pagosProximos30: v30.total,
    cobrosProximoMes: sumaEntre(s.cobros, s.dia, s.dia + 30), pagosProximoMes: v30.total, reparacionesEstimadas: rep30,
    costosFijos: fijos, diasDeCaja: Math.max(0, Math.round(((s.caja + s.reserva - s.descubierto) / fijos) * 30)),
    precio: s.precio, costoUnitario: s.costoUnit, markupReal,
    pedidosEstimados: Math.round(demanda), capacidadSerie: Math.round(cap), usoCapacidad: Math.min(1, demanda / (EMPRESA.capacidad * s.capacidadExtra)),
    inflacionMensual: s.inflMes, inflacionAcumulada: s.indice - 1, dolarAcumulado: s.dolar - 1,
    cicloDeCajaDias: s.palancas.plazoCobro - s.palancas.plazoPago,
    patrimonioReal: patrimonio(s), patrimonioInicialReal: s.patrimonioInicialReal,
    palancas: { ...s.palancas }, eventoPendiente: publicarEvento(s), credito: s.credito ? { ...s.credito } : null,
    economia: indicadores(s), usoDatos: { ...s.usoDatos },
  };
}

// ---------- palancas ----------
const cercano = (opts, v) => opts.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
export function validarPalancas(p = {}) {
  const out = {};
  if (p.markup != null) out.markup = Math.min(3, Math.max(0, +p.markup));
  if (p.plazoCobro != null) out.plazoCobro = cercano([0, 30, 60, 90], +p.plazoCobro);
  if (p.plazoPago != null) out.plazoPago = cercano([0, 30, 60], +p.plazoPago);
  if (p.actualizarCada != null) out.actualizarCada = Math.min(3, Math.max(1, Math.round(+p.actualizarCada)));
  if (p.reservaPct != null) out.reservaPct = Math.min(1, Math.max(0, +p.reservaPct));
  if (p.reparaciones != null) out.reparaciones = Math.min(0.5, Math.max(0, +p.reparaciones));
  return out;
}
function anotar(s, tipo, texto, extra = {}) { const f = fechaDe(s, Math.min(s.dia, DIAS_TOTALES - 1)); s.bitacora.push({ dia: s.dia, fecha: textoFecha(s, Math.min(s.dia, DIAS_TOTALES - 1)), clave: claveMes(f.anio, f.mes), tipo, texto, ...extra }); }
export const millones = (n) => (n < 0 ? "-" : "") + "$" + (Math.abs(n) / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " M";
export const pesos = (n) => (n < 0 ? "-$" : "$") + Math.round(Math.abs(n)).toLocaleString("es-AR");
const pc = (x, d = 1) => (x * 100).toFixed(d).replace(".", ",") + "%";

// ---------- datos reales: actualizaciones y novedades del día ----------
function datosDelDia(s, f) {
  if (!ECO || !ECO.fechaDatos) return null;
  const ayer = sumarDias(f.iso, -1);
  if (ayer > ECO.fechaDatos) return null; // todavía no ocurrió: se proyecta
  const reales = [];
  // 1) INDEC publica la inflación del mes anterior (≈ día 14): corregimos lo que se había proyectado
  const fa = fechaDe(s, s.dia - 1 - (f.dia - 1)); // último día del mes anterior
  const claveAnt = claveMes(fa.anio, fa.mes);
  if (f.dia >= 14 && s.inflacionUsada[claveAnt] != null && !s.inflacionCorregida[claveAnt] && ECO.inflacion.has(claveAnt)) {
    const real = ECO.inflacion.get(claveAnt), usada = s.inflacionUsada[claveAnt];
    s.inflacionCorregida[claveAnt] = real;
    const factor = (1 + real) / (1 + usada);
    s.indice *= factor; s.servicios *= factor; s.inflacion = real;
    reales.push({ id: "indec", icono: "📊", titulo: `INDEC: la inflación de ${MESES_LARGOS[fa.mes]} fue ${pc(real)}`,
      texto: `Se había proyectado ${pc(usada)} (${s.inflMesFuente === "real" ? "dato" : "expectativa"}). ${real > usada ? "Los costos quedaron más altos de lo previsto." : "Los costos subieron menos de lo previsto."}`,
      fuente: "INDEC vía ArgentinaDatos", decision: real - usada >= 0.004, accion: "remarcar" });
  }
  // 2) precios mayoristas metálicos (IPIM) del mes anterior: corrige el costo del acero
  if (f.dia >= 18 && !s.ipimAplicado[claveAnt] && ECO.ipim.has(claveAnt)) {
    const fprev = fechaDe(s, s.dia - f.dia - fa.dia), clavePrev = claveMes(fprev.anio, fprev.mes);
    if (ECO.ipim.has(clavePrev)) {
      const varIpim = ECO.ipim.get(claveAnt) / ECO.ipim.get(clavePrev) - 1;
      const ofA = realEn(ECO.oficial, isoDe(fa.anio, fa.mes, diasDelMes(fa.anio, fa.mes)), 10), ofP = realEn(ECO.oficial, isoDe(fprev.anio, fprev.mes, diasDelMes(fprev.anio, fprev.mes)), 10);
      const varDolar = ofA && ofP ? ofA.valor / ofP.valor - 1 : 0;
      s.costoAceroExtra *= (1 + varIpim) / (1 + varDolar);
      anotar(s, "dato", `Precios mayoristas metálicos de ${MESES_LARGOS[fa.mes]}: ${pc(varIpim)} (INDEC). El costo del acero se ajusta al dato real.`, { fuente: "INDEC vía datos.gob.ar" });
    }
    s.ipimAplicado[claveAnt] = true;
  }
  // 3) salto real del dólar oficial (≥ 4% en 7 días)
  const hoyD = realEn(ECO.oficial, ayer, 5), antes = realEn(ECO.oficial, sumarDias(ayer, -7), 5);
  if (hoyD && antes && hoyD.valor / antes.valor - 1 >= 0.04 && !(s.ultimoEventoReal.dolar > s.dia - 21)) {
    s.ultimoEventoReal.dolar = s.dia;
    reales.push({ id: "dolar_real", icono: "💵", titulo: `El dólar oficial subió ${pc(hoyD.valor / antes.valor - 1)} en una semana`,
      texto: `Pasó de $${Math.round(antes.valor).toLocaleString("es-AR")} a $${Math.round(hoyD.valor).toLocaleString("es-AR")} (${fechaCorta(hoyD.fecha)}). El acero y los insumos importados ya se están remarcando.`,
      fuente: "BNA vía ArgentinaDatos", decision: true, accion: "remarcar" });
  }
  // 4) cambio fuerte de tasas (≥ 3 puntos en 7 días)
  const pfH = ultimoArr(ECO.pf, ayer), pfA = ultimoArr(ECO.pf, sumarDias(ayer, -7));
  if (pfH && pfA && pfH.fecha > pfA.fecha && Math.abs(pfH.valor - pfA.valor) >= 0.03 && !(s.ultimoEventoReal.tasas > s.dia - 21)) {
    s.ultimoEventoReal.tasas = s.dia;
    reales.push({ id: "tasas_real", icono: pfH.valor > pfA.valor ? "📈" : "📉", titulo: `Las tasas ${pfH.valor > pfA.valor ? "suben" : "bajan"}: plazo fijo al ${pc(pfH.valor)} anual`,
      texto: `Una semana atrás estaba en ${pc(pfA.valor)}. Cambia lo que rinde tu reserva y lo que cuesta el descubierto.`, fuente: "BCRA / ArgentinaDatos", decision: false });
  }
  return reales;
}

// inflación de un mes: la real si INDEC ya la publicó, si no la esperada (REM), si no el último dato
function inflacionDelMes(f) {
  const clave = claveMes(f.anio, f.mes);
  if (ECO && ECO.inflacion.has(clave) && sumarDias(f.iso, -1) <= (ECO.fechaDatos || "")) return { inf: ECO.inflacion.get(clave), fuente: "real" };
  return { inf: inflacionProyectada(), fuente: remMensual() != null ? "proyección REM" : ECO ? "último dato INDEC" : "supuesto" };
}

// ---------- un día ----------
function procesarDia(s) {
  const E = EMPRESA, f = fechaDe(s, s.dia), fin = Math.min(finDeMes(s, s.dia), DIAS_TOTALES - 1);
  const esPrimero = f.dia === 1 || s.dia === 0, esUltimo = s.dia === fin;

  // inicio de mes: inflación del mes (real si INDEC ya la publicó, si no REM), lista, ajustes y sorteo
  if (esPrimero && !s.inicioHecho) {
    s.inicioHecho = true;
    const clave = claveMes(f.anio, f.mes);
    const { inf, fuente } = inflacionDelMes(f);
    s.inflacion = inf;
    s.inflMes = inf + (s.inflacionExtra && s.inflacionExtra.meses > 0 ? s.inflacionExtra.pp : 0);
    s.inflMesFuente = fuente;
    if (s.inflacionExtra) { s.inflacionExtra.meses--; if (s.inflacionExtra.meses <= 0) s.inflacionExtra = null; }
    s.inflacionUsada[clave] = s.inflMes;
    if (s.dia > 0 && f.serial - s.mesUltimaLista >= s.palancas.actualizarCada) { remarcar(s); anotar(s, "lista", `Actualizaste la lista de precios (margen ${Math.round(s.palancas.markup * 100)}%).`); }
    if (s.dia > 0 && f.mes % 3 === 0) {
      // ajuste trimestral de sueldos: índice de salarios real si está, si no la inflación
      const clave = (serial) => claveMes(Math.floor(serial / 12), serial % 12);
      let factor = s.indice / s.indiceParitaria, fuenteS = "inflación";
      const ult = ECO ? [1, 2, 3, 4].map((i) => f.serial - i).find((x) => ECO.salarios.has(clave(x))) : undefined;
      if (ult !== undefined && ECO.salarios.has(clave(ult - 3))) { factor = ECO.salarios.get(clave(ult)) / ECO.salarios.get(clave(ult - 3)); fuenteS = `índice de salarios INDEC hasta ${MESES_LARGOS[ult % 12]}`; }
      s.sueldos *= factor; s.indiceParitaria = s.indice;
      anotar(s, "sueldos", `Ajuste trimestral de sueldos: ${pc(factor - 1)} (${fuenteS}).`);
    }
    if (s.dia > 0 && f.mes % 4 === 0) { s.alquiler *= s.indice / s.indiceAlquiler; s.indiceAlquiler = s.indice; }
    // sorteo de novedad del mes, según el modo
    s.eventoProgramado = null;
    const pool = SORTEABLES[s.modoNovedades].filter((k) => !s.eventosVistos.includes(k));
    const prob = s.modoNovedades === "mixtas" ? 0.5 : 0.65;
    if (pool.length && rnd(s) < prob) {
      const id = pool[Math.floor(rnd(s) * pool.length)];
      const hab = []; for (let d = s.dia + 2; d <= fin - 3; d++) if (habil(s, d)) hab.push(d);
      if (hab.length) { s.eventoProgramado = { id, dia: hab[Math.floor(rnd(s) * hab.length)] }; s.eventosVistos.push(id); }
    }
  }

  // datos reales del día anterior (correcciones y novedades reales)
  if (!s.datosHechos) {
    s.datosHechos = true;
    const reales = datosDelDia(s, f) || [];
    if (s.modoNovedades !== "azar") {
      for (const ev of reales) {
        if (ev.decision) { s.colaReales = (s.colaReales || []).concat([ev]); }
        else { anotar(s, "real", `${ev.titulo}. ${ev.texto}`, { icono: ev.icono, fuente: ev.fuente }); s.acum.eventos.push({ id: ev.id, titulo: ev.titulo, decision: null, real: true }); }
      }
    } else for (const ev of reales) if (ev.id === "indec") anotar(s, "dato", `${ev.titulo}.`, { fuente: ev.fuente });
  }
  if (s.colaReales && s.colaReales.length && !s.eventoPendiente) {
    const ev = s.colaReales.shift();
    s.eventoPendiente = { ...ev, real: true, opciones: OPCIONES_REMARCAR };
    anotar(s, "real", `${ev.titulo}.`, { icono: ev.icono, fuente: ev.fuente });
    return "pausa";
  }

  // novedad sorteada del día
  if (s.eventoProgramado && s.eventoProgramado.dia === s.dia && !s.eventoPendiente) {
    const id = s.eventoProgramado.id, ev = EVENTOS[id];
    s.eventoProgramado = null;
    if (ev.opciones) { s.eventoPendiente = { id, real: false }; anotar(s, "novedad", `${ev.titulo}.`, { evento: id, icono: ev.icono }); return "pausa"; }
    ev.aplicar(s, null, { hastaFinDeMes: fin });
    anotar(s, "novedad", `${ev.titulo}.`, { evento: id, icono: ev.icono });
    s.acum.eventos.push({ id, titulo: ev.titulo, decision: null });
  }

  // precios del día: inflación (proyectada en el mes) y dólar (real del día anterior, si existe)
  const dm = diasDelMes(f.anio, f.mes), fi = Math.pow(1 + s.inflMes, 1 / dm);
  s.indice *= fi; s.servicios *= fi;
  const real = ECO ? realEn(ECO.oficial, sumarDias(f.iso, -1), 5) : null;
  if (real && s.dolarBase) { s.dolar = (real.valor / s.dolarBase) * s.dolarExtra; s.usoDatos.reales++; s.acum.diasReales++; }
  else {
    const desliz = ECO?.deslizamiento ?? E.deslizamientoDolar;
    s.dolar *= Math.pow(1 + desliz, 1 / dm); s.usoDatos.proyectados++; s.acum.diasProyectados++;
  }
  s.costoUnit = costoActual(s);

  // producción y ventas (días hábiles; feriados y vacaciones no se produce)
  const A = s.acum, P = s.palancas;
  let reparacionesHoy = 0;
  if (habil(s, s.dia)) {
    const hab = habilesDelMes(s, f.anio, f.mes);
    const u = Math.min((demandaEstimada(s) * ESTACIONALIDAD[f.mes]) / hab, capacidadSerie(s) / hab);
    const venta = u * s.precio, incobrable = { 0: 0, 30: 0.005, 60: 0.015, 90: 0.035 }[P.plazoCobro];
    agendar(s.cobros, s.dia + P.plazoCobro, venta * (1 - incobrable));
    reparacionesHoy = facturacionReparaciones(s) / hab;
    const plazoPago = hayEfecto(s, "pagoContado") ? 0 : P.plazoPago;
    const recargo = { 0: -0.03, 30: 0, 60: s.inflMes + 0.01 }[plazoPago];
    agendar(s.pagos, s.dia + plazoPago, (u * s.costoUnit + reparacionesHoy * 0.35) * (1 + recargo));
    A.facturado += venta + reparacionesHoy; A.facturadoSerie += venta; A.facturadoReparaciones += reparacionesHoy; A.piezas += u;
  } else if (esFeriado(f.iso) && f.semana !== 0 && f.semana !== 6) anotar(s, "feriado", `Feriado: ${nombreFeriado(f.iso)}. No se produce.`);

  // reserva: rinde la tasa real de plazo fijo (o inflación − 0,2% si no hay dato)
  const pf = ECO ? ultimoArr(ECO.pf, sumarDias(f.iso, -1)) : null;
  const tasaDiaRes = pf ? pf.valor / 365 : Math.pow(1 + s.inflMes - 0.002, 1 / dm) - 1;
  const rend = s.reserva * tasaDiaRes; s.reserva += rend; A.rendimientoReserva += rend;
  // descubierto: tasa real de adelantos en cuenta corriente (o inflación + 3,5% mensual)
  const ad = ECO ? ultimoArr(ECO.adel, sumarDias(f.iso, -1)) : null;
  const tasaDiaDesc = ad ? ad.valor / 365 : Math.pow(1 + s.inflMes + E.spreadDescubierto, 1 / 30) - 1;

  const ag = aguinaldos(s);
  const eg = {
    acero: s.pagos[s.dia] || 0, impuestos: s.impuestos[s.dia] || 0, sueldos: s.sueldosAPagar[s.dia] || 0,
    aguinaldo: ag.includes(s.dia) ? s.sueldos * 0.5 : 0,
    alquiler: f.dia === 1 ? s.alquiler : 0, energia: f.dia === 15 ? s.servicios : 0,
    cuotaCredito: f.dia === 10 && s.credito && s.credito.restantes > 0 ? s.credito.cuota : 0,
    imprevistos: s.gastoHoy, intereses: s.descubierto * tasaDiaDesc,
  };
  if (eg.cuotaCredito) s.credito.restantes--;
  const cobrado = (s.cobros[s.dia] || 0) + reparacionesHoy + s.ingresoHoy;
  let totalEg = 0; for (const k in eg) { A.egresos[k] += eg[k]; totalEg += eg[k]; }
  A.cobrado += cobrado; s.caja += cobrado - totalEg; s.ingresoHoy = 0; s.gastoHoy = 0;
  if (eg.sueldos) anotar(s, "pago", `Pagaste sueldos: ${millones(eg.sueldos)}.`, { monto: eg.sueldos });
  if (eg.aguinaldo) anotar(s, "pago", `Pagaste el aguinaldo: ${millones(eg.aguinaldo)}.`, { monto: eg.aguinaldo });
  if (eg.impuestos) anotar(s, "pago", `Pagaste impuestos a ARCA: ${millones(eg.impuestos)}.`, { monto: eg.impuestos });
  s.ultimoDia = { cobrado, cobrosCinta: s.cobros[s.dia] || 0, reparaciones: reparacionesHoy, egresos: eg };
  delete s.cobros[s.dia]; delete s.pagos[s.dia]; delete s.impuestos[s.dia]; delete s.sueldosAPagar[s.dia];

  if (s.caja < 0) {
    const r = Math.min(s.reserva, -s.caja); s.reserva -= r; s.caja += r; A.rescateReserva += r;
    if (s.caja < 0) { if (s.descubierto === 0) anotar(s, "alerta", "Entraste en descubierto."); A.nuevoDescubierto += -s.caja; s.descubierto += -s.caja; s.caja = 0; }
  } else if (s.descubierto > 0 && s.caja > 0) {
    const p = Math.min(s.descubierto, s.caja); s.descubierto -= p; s.caja -= p; A.deudaPagada += p;
    if (s.descubierto === 0) anotar(s, "hito", "Saliste del descubierto.");
  }
  if (s.descubierto > s.limiteDescubierto) { s.quiebra = true; s.terminada = true; anotar(s, "alerta", "El banco cortó el descubierto: el taller cierra."); }

  if (esUltimo || s.terminada || s.dia === DIAS_TOTALES - 1) cerrarMes(s);
  s.efectos = s.efectos.filter((e) => e.hasta > s.dia);
  s.dia++; s.inicioHecho = false; s.datosHechos = false;
  if (s.dia >= DIAS_TOTALES) s.terminada = true;
  return null;
}

function cerrarMes(s) {
  const A = s.acum;
  agendar(s.sueldosAPagar, vencimiento(s, s.dia, 5), s.sueldos * efecto(s, "sueldos"));
  const diaImp = vencimiento(s, s.dia, 20);
  agendar(s.impuestos, diaImp, A.facturado * TASA_IMPUESTOS);
  if (s.moratoriaPendiente) { s.moratoriaPendiente = false; diferirImpuesto(s, diaImp); }
  const colchon = s.sueldos + s.alquiler + s.servicios;
  let aReserva = 0;
  if (!s.terminada && s.caja > colchon) { aReserva = (s.caja - colchon) * s.palancas.reservaPct; s.caja -= aReserva; s.reserva += aReserva; }
  const totalEgresos = Object.values(A.egresos).reduce((a, b) => a + b, 0);
  const informe = {
    clave: A.clave, mes: A.mes + 1, anio: A.anio, mesNombre: `${NOMBRES_MES[A.mes]} ${String(A.anio).slice(2)}`,
    inflacion: s.inflMes, inflacionFuente: s.inflMesFuente, remarcaste: A.remarcaste,
    piezas: Math.round(A.piezas), usoCapacidad: A.piezas / (EMPRESA.capacidad * s.capacidadExtra),
    facturadoSerie: A.facturadoSerie, facturadoReparaciones: A.facturadoReparaciones, facturado: A.facturado,
    cobrado: A.cobrado, egresos: { ...A.egresos }, totalEgresos, resultadoCaja: A.cobrado - totalEgresos,
    rendimientoReserva: A.rendimientoReserva, rescateReserva: A.rescateReserva, nuevoDescubierto: A.nuevoDescubierto, deudaPagada: A.deudaPagada, aReserva,
    caja: s.caja, reserva: s.reserva, descubierto: s.descubierto, patrimonioReal: patrimonio(s), eventos: A.eventos,
    diasReales: A.diasReales, diasProyectados: A.diasProyectados,
  };
  informe.eventoResuelto = A.eventos.at(-1) || null;
  informe.alertas = alertas(s, informe);
  s.historial.push({ clave: A.clave, mes: A.mes + 1, anio: A.anio, caja: s.caja, reserva: s.reserva, descubierto: s.descubierto, facturado: A.facturado, cobrado: A.cobrado, egresos: totalEgresos, resultadoCaja: informe.resultadoCaja, patrimonioReal: informe.patrimonioReal, inflacion: s.inflMes, informe });
  anotar(s, "cierre", `Cierre de ${informe.mesNombre}: resultado de caja ${millones(informe.resultadoCaja)}.`, { monto: informe.resultadoCaja });
  s.ultimoCierre = informe;
  s.acum = acumuladoVacio({ ...s, dia: s.dia + 1 });
}

function alertas(s, inf) {
  const a = [], L = lectura({ ...s, dia: Math.min(s.dia + 1, DIAS_TOTALES - 1) });
  if (inf.nuevoDescubierto > 0) a.push("Usaste descubierto: es la plata más cara que hay.");
  if (inf.cobrado < inf.totalEgresos * 0.85) a.push("Cobraste bastante menos de lo que pagaste este mes.");
  if (L.markupReal < s.palancas.markup - 0.08) a.push("El costo del acero y la inflación se comieron tu margen: tu lista quedó atrasada.");
  if (L.diasDeCaja < 20) a.push(`Te quedan ${L.diasDeCaja} días de caja para cubrir sueldos y fijos.`);
  if (!s.terminada && L.cobrosProximos30 + L.reparacionesProximos30 < L.pagosProximos30) a.push("En los próximos 30 días vence más de lo que vas a cobrar.");
  if (L.cicloDeCajaDias >= 60) a.push(`Financiás a tus clientes ${L.cicloDeCajaDias} días más de lo que te financia el acero.`);
  if (L.vencimientosProximos30.aguinaldo > 0) a.push(`Ojo: en los próximos 30 días se paga el aguinaldo (${millones(L.vencimientosProximos30.aguinaldo)}).`);
  return a;
}

// ---------- avanzar ----------
export function avanzarDias(s0, dias = 1, { palancas = {}, decision, pararEnCierre = false } = {}) {
  const s = structuredClone(s0);
  if (s.terminada) throw new Error("La partida terminó. Creá una nueva.");
  Object.assign(s.palancas, validarPalancas(palancas));
  const desdeBit = s.bitacora.length, desdeHist = s.historial.length;
  let resuelto = null;
  if (s.eventoPendiente) {
    const p = publicarEvento(s);
    if (!p.opciones.some((o) => o.id === decision)) throw new Error(`Antes de seguir hay que decidir "${p.titulo}". Opciones: ${p.opciones.map((o) => `${o.id} (${o.label})`).join("; ")}`);
    if (p.real) aplicarReal(s, s.eventoPendiente, decision);
    else EVENTOS[p.id].aplicar(s, decision, { hastaFinDeMes: Math.min(finDeMes(s, s.dia), DIAS_TOTALES - 1) });
    const label = p.opciones.find((o) => o.id === decision).label;
    resuelto = { id: p.id, titulo: p.titulo, decision, label, real: !!p.real };
    s.acum.eventos.push(resuelto);
    anotar(s, "decision", `${p.titulo}: ${label.toLowerCase()}.`, { evento: p.id, icono: p.icono, real: !!p.real });
    s.eventoPendiente = null;
  }
  let hechos = 0, pausa = null;
  while (hechos < dias && !s.terminada) {
    if (procesarDia(s) === "pausa") { pausa = publicarEvento(s); break; }
    hechos++;
    if (pararEnCierre && s.historial.length > desdeHist) break;
  }
  return { estado: s, diasAvanzados: hechos, pausa, eventoResuelto: resuelto, cierres: s.historial.slice(desdeHist).map((h) => h.informe), bitacora: s.bitacora.slice(desdeBit) };
}
export function avanzarHastaFinDeMes(s0, opciones = {}) {
  return avanzarDias(s0, Math.min(finDeMes(s0, s0.dia), DIAS_TOTALES - 1) - s0.dia + 1, opciones);
}
export function avanzarMes(s0, { palancas = {}, decision, decidir } = {}) {
  let r = avanzarHastaFinDeMes(s0, { palancas, decision }), s = r.estado; const cierres = [...r.cierres];
  while (r.pausa && decidir) { r = avanzarHastaFinDeMes(s, { decision: decidir(r.pausa) }); s = r.estado; cierres.push(...r.cierres); }
  return { estado: s, informe: cierres.at(-1) || null, pausa: r.pausa };
}

// ---------- diagnóstico ----------
export function diagnostico(s) {
  const L = lectura(s), fugas = [];
  if (L.cicloDeCajaDias > 0) fugas.push({ pieza: "Cinta de cobro", gravedad: L.cicloDeCajaDias >= 60 ? "alta" : "media", texto: `Cobrás ${L.cicloDeCajaDias} días después de pagar el acero. Ese hueco lo financiás vos y, con inflación, cobrás devaluado.` });
  if (L.markupReal < s.palancas.markup * 0.88) fugas.push({ pieza: "Dial de precio", gravedad: "alta", texto: `Tu margen real es ${(L.markupReal * 100).toFixed(0)}% contra ${(s.palancas.markup * 100).toFixed(0)}% objetivo: el costo corre más rápido que tu lista.` });
  if (s.palancas.actualizarCada === 3) fugas.push({ pieza: "Dial de precio", gravedad: "media", texto: "Actualizar la lista cada 3 meses te deja el último mes vendiendo con margen atrasado." });
  if (L.usoCapacidad < 0.55) fugas.push({ pieza: "Torno", gravedad: "media", texto: `Usás ${(L.usoCapacidad * 100).toFixed(0)}% del taller. Los sueldos y la luz se pagan igual: la capacidad ociosa es costo hundido.` });
  if (s.palancas.reparaciones < 0.1 && L.usoCapacidad < 0.6) fugas.push({ pieza: "Puesto de reparaciones", gravedad: "media", texto: "Con el taller medio parado, la tornería y las reparaciones (que se cobran contado) pueden sostener la caja." });
  if (s.reserva < L.costosFijos * 0.5 && s.caja > L.costosFijos * 1.5) fugas.push({ pieza: "Tanque de caja", gravedad: "media", texto: "Tenés plata quieta que pierde contra la inflación. Abrí la válvula de la reserva." });
  if (s.descubierto > 0) fugas.push({ pieza: "Globo de deuda", gravedad: s.descubierto > s.limiteDescubierto * 0.5 ? "alta" : "media", texto: "Estás en descubierto: es la plata más cara que puede tomar una Pyme." });
  if (s.palancas.plazoPago === 60) fugas.push({ pieza: "Cinta de pagos", gravedad: "baja", texto: "Pagar el acero a 60 días te da aire, pero el distribuidor te recarga inflación + 1%." });
  if (s.historial.some((h) => h.informe.egresos.aguinaldo > 0 && h.informe.nuevoDescubierto > 0)) fugas.push({ pieza: "Tanque de caja", gravedad: "media", texto: "El aguinaldo te llevó al descubierto: conviene ir apartando 1/12 de la masa salarial por mes." });
  return { ...veredicto(s), fugas, lectura: L };
}
export function veredicto(s) {
  const cambio = patrimonio(s) / s.patrimonioInicialReal - 1;
  let titulo;
  if (s.quiebra) titulo = "Cerraste: el banco cortó el descubierto";
  else if (cambio > 0.2) titulo = "Taller de acero templado";
  else if (cambio > 0.06) titulo = "Le ganaste a la inflación";
  else if (cambio > -0.06) titulo = "Empate con la inflación";
  else if (cambio > -0.25) titulo = "Sobreviviste, pero más chico";
  else titulo = "Vivo de milagro";
  return { titulo, cambioPatrimonioReal: cambio, puntaje: s.quiebra ? 0 : Math.max(0, Math.round(500 + cambio * 1000)) };
}

// ---------- línea de tiempo ----------
export function lineaDeTiempo(s) {
  const meses = [], tps = temporadas(s), ag = aguinaldos(s);
  let d = 0;
  while (d < DIAS_TOTALES) {
    const f = fechaDe(s, d), hasta = Math.min(finDeMes(s, d), DIAS_TOTALES - 1), clave = claveMes(f.anio, f.mes);
    const h = s.historial.find((x) => x.clave === clave);
    meses.push({
      clave, anio: f.anio, mes: f.mes + 1, nombre: NOMBRES_MES[f.mes], nombreLargo: `${MESES_LARGOS[f.mes]} ${f.anio}`, desde: d, hasta,
      cerrado: !!h, resultadoCaja: h ? h.resultadoCaja : null, patrimonioReal: h ? h.patrimonioReal : null,
      aguinaldo: ag.some((x) => x >= d && x <= hasta), temporadas: tps.filter((t) => t.desde <= hasta && t.hasta >= d).map((t) => t.id),
      feriados: ECO ? [...ECO.feriados.entries()].filter(([iso]) => { const x = diaDeIso(s, iso); return x >= d && x <= hasta; }).map(([iso, n]) => ({ dia: diaDeIso(s, iso), nombre: n })) : [],
      entradas: s.bitacora.filter((b) => b.clave === clave), datosReales: h ? h.informe.diasReales : null,
    });
    d = hasta + 1;
  }
  return { hoy: s.dia, fecha: textoFecha(s, Math.min(s.dia, DIAS_TOTALES - 1)), meses, temporadas: tps, vencimientos: VENCIMIENTOS, aguinaldos: ag };
}

// ---------- comparación de partidas ----------
export function resumenPartida(s) {
  const v = veredicto(s);
  return {
    nombre: s.nombre, semilla: s.semilla, inicio: s.inicio, modoNovedades: s.modoNovedades, terminada: s.terminada, quiebra: s.quiebra,
    titulo: v.titulo, puntaje: v.puntaje, cambioPatrimonioReal: v.cambioPatrimonioReal,
    curva: s.historial.map((h) => ({ clave: h.clave, cambio: h.patrimonioReal / s.patrimonioInicialReal - 1, caja: h.caja, descubierto: h.descubierto })),
    palancas: { ...s.palancas },
    decisiones: s.bitacora.filter((b) => b.tipo === "decision").map((b) => ({ fecha: b.fecha, texto: b.texto, real: !!b.real })),
    novedades: s.bitacora.filter((b) => b.tipo === "novedad" || b.tipo === "real").length,
    diasConDatosReales: s.usoDatos.reales, diasProyectados: s.usoDatos.proyectados,
  };
}

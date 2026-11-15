#!/usr/bin/env node
// Actualizador de datos reales de la economía argentina para La Máquina de Caja.
// Corre todos los días en GitHub Actions (gratis) y escribe datos/economia.json.
// Sin dependencias: solo Node 18+ (fetch nativo).
//
// Fuentes públicas y gratuitas:
//   - BCRA, API de Estadísticas Monetarias v4.0 (tipo de cambio mayorista, inflación esperada REM, tasas)
//   - ArgentinaDatos (dólar oficial y MEP, inflación INDEC, plazo fijo por banco, feriados nacionales)
//   - API de Series de Tiempo de datos.gob.ar (precios mayoristas de productos metálicos, índice de salarios)
//
// Cada fuente es opcional: si una falla, se conserva lo último que se había bajado y se deja constancia.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SALIDA = process.argv[2] || join(AQUI, "economia.json");
const DIAS_HISTORIA = 420;
const UA = "maquina-de-caja/1.0 (juego educativo open source; +https://github.com/proyectopanalarg-glitch/maquina-de-caja)";

const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // Argentina UTC-3
const sumarDias = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const AYER = sumarDias(hoyAR(), -1);
const DESDE = sumarDias(AYER, -DIAS_HISTORIA);
const log = (...a) => console.log("[datos]", ...a);

async function bajarJSON(url, { intentos = 3 } = {}) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      ultimo = e;
      // el servidor del BCRA a veces no envía la cadena de certificados completa: probamos con curl del sistema
      if (/certificate|UNABLE_TO_VERIFY|SELF_SIGNED|fetch failed/i.test(String(e.cause || e))) {
        try { return JSON.parse(execFileSync("curl", ["-sSfL", "--max-time", "25", "-A", UA, url], { encoding: "utf8", maxBuffer: 64e6 })); } catch (e2) { ultimo = e2; }
      }
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw ultimo;
}

// ---------- datos anteriores (para no perder nada si una fuente falla) ----------
let previo = {};
try { if (existsSync(SALIDA)) previo = JSON.parse(readFileSync(SALIDA, "utf8")); } catch { previo = {}; }

const datos = {
  version: 1,
  actualizado: new Date().toISOString(),
  fechaDatos: AYER,
  fuentes: [],
  dolarOficial: previo.dolarOficial || [],
  dolarMayorista: previo.dolarMayorista || [],
  dolarMEP: previo.dolarMEP || [],
  inflacion: previo.inflacion || [],
  remAnual: previo.remAnual || null,
  tasaPlazoFijo: previo.tasaPlazoFijo || [],
  tasaAdelantos: previo.tasaAdelantos || [],
  ipimMetal: previo.ipimMetal || [],
  salarios: previo.salarios || [],
  feriados: previo.feriados || [],
};

function fuente(id, nombre, url, fn) {
  return fn().then(
    (nota) => { datos.fuentes.push({ id, nombre, url, ok: true, nota: nota || "" }); log("OK ", id, nota || ""); },
    (e) => {
      const ant = (previo.fuentes || []).find((f) => f.id === id);
      datos.fuentes.push({ id, nombre, url, ok: false, nota: `No se pudo actualizar (${String(e.message || e).slice(0, 120)}). Se conservan los datos anteriores${ant && ant.ok ? ` del ${previo.fechaDatos}` : ""}.` });
      log("ERR", id, e.message || e);
    },
  );
}

// une series [fecha, valor] priorizando las nuevas y recorta la historia
function unir(viejo, nuevo, desde = DESDE) {
  const m = new Map(viejo.map(([f, v]) => [f, v]));
  for (const [f, v] of nuevo) if (Number.isFinite(v)) m.set(f, v);
  return [...m.entries()].filter(([f]) => f >= desde.slice(0, f.length)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
const pct = (v) => (v > 1.5 ? v : v * 100); // normaliza 0,31 → 31 (%)

// ---------- ArgentinaDatos ----------
const AD = "https://api.argentinadatos.com/v1";
const tareas = [
  fuente("dolar_oficial", "Dólar oficial (BNA, venta) — ArgentinaDatos", `${AD}/cotizaciones/dolares/oficial`, async () => {
    const j = await bajarJSON(`${AD}/cotizaciones/dolares/oficial`);
    const serie = j.filter((x) => x.fecha >= DESDE).map((x) => [x.fecha.slice(0, 10), +x.venta]);
    datos.dolarOficial = unir(datos.dolarOficial, serie);
    return `último ${serie.at(-1)?.[0]} = $${serie.at(-1)?.[1]}`;
  }),
  fuente("dolar_mep", "Dólar MEP (bolsa) — ArgentinaDatos", `${AD}/cotizaciones/dolares/bolsa`, async () => {
    const j = await bajarJSON(`${AD}/cotizaciones/dolares/bolsa`);
    const serie = j.filter((x) => x.fecha >= DESDE).map((x) => [x.fecha.slice(0, 10), +x.venta]);
    datos.dolarMEP = unir(datos.dolarMEP, serie);
    return `último ${serie.at(-1)?.[0]} = $${serie.at(-1)?.[1]}`;
  }),
  fuente("inflacion_indec", "Inflación mensual (INDEC) — ArgentinaDatos", `${AD}/finanzas/indices/inflacion`, async () => {
    const j = await bajarJSON(`${AD}/finanzas/indices/inflacion`);
    const serie = j.map((x) => [x.fecha.slice(0, 7), +x.valor]).filter(([m]) => m >= sumarDias(DESDE, -400).slice(0, 7));
    datos.inflacion = unir(datos.inflacion, serie, "2000-01");
    return `último ${serie.at(-1)?.[0]} = ${serie.at(-1)?.[1]}%`;
  }),
  fuente("plazo_fijo", "Tasa de plazo fijo a 30 días (mediana de bancos, TNA) — ArgentinaDatos", `${AD}/finanzas/tasas/plazoFijo`, async () => {
    const j = await bajarJSON(`${AD}/finanzas/tasas/plazoFijo`);
    const tasas = j.map((x) => +(x.tnaClientes ?? x.tna ?? NaN)).filter((v) => Number.isFinite(v) && v > 0).map(pct).sort((a, b) => a - b);
    if (!tasas.length) throw new Error("sin tasas");
    const med = tasas[Math.floor(tasas.length / 2)];
    datos.tasaPlazoFijo = unir(datos.tasaPlazoFijo, [[AYER, +med.toFixed(2)]]);
    return `mediana de ${tasas.length} bancos = ${med.toFixed(1)}% TNA`;
  }),
  fuente("feriados", "Feriados nacionales — ArgentinaDatos", `${AD}/feriados/{año}`, async () => {
    const anio = +AYER.slice(0, 4), out = [];
    for (const a of [anio, anio + 1]) {
      try { const j = await bajarJSON(`${AD}/feriados/${a}`); for (const x of j) out.push({ fecha: x.fecha.slice(0, 10), nombre: x.nombre, tipo: x.tipo }); }
      catch (e) { if (a === anio) throw e; }
    }
    const m = new Map((datos.feriados || []).map((f) => [f.fecha, f]));
    for (const f of out) m.set(f.fecha, f);
    datos.feriados = [...m.values()].filter((f) => f.fecha >= sumarDias(AYER, -400)).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    return `${out.length} feriados`;
  }),
];

// ---------- BCRA v4 ----------
const BCRA = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias";
tareas.push(
  fuente("bcra", "BCRA — Estadísticas Monetarias v4.0 (mayorista, REM, tasas)", BCRA, async () => {
    const lista = (await bajarJSON(`${BCRA}?limit=3000`)).results || [];
    const buscar = (...pruebas) => lista.find((v) => pruebas.every((p) => p.test(v.descripcion || "")));
    const elegidas = {
      mayorista: buscar(/tipo de cambio mayorista/i) || buscar(/A ?3500/i),
      rem: buscar(/REM/i, /12 meses/i) || buscar(/inflaci[oó]n esperada/i),
      plazoFijo: buscar(/plazo fijo/i, /30/i) || buscar(/BADLAR/i, /privad/i),
      adelantos: buscar(/adelantos/i, /cuenta/i) || buscar(/adelantos/i),
    };
    const serie = async (v) => {
      if (!v) return [];
      const j = await bajarJSON(`${BCRA}/${v.idVariable}?desde=${DESDE}&hasta=${AYER}&limit=3000`);
      const det = (j.results || []).flatMap((r) => r.detalle || (r.fecha ? [r] : []));
      return det.map((d) => [d.fecha.slice(0, 10), +d.valor]).filter(([, x]) => Number.isFinite(x));
    };
    const notas = [];
    if (elegidas.mayorista) { datos.dolarMayorista = unir(datos.dolarMayorista, await serie(elegidas.mayorista)); notas.push(`mayorista #${elegidas.mayorista.idVariable}`); }
    if (elegidas.rem) {
      const s = await serie(elegidas.rem);
      if (s.length) { const [f, v] = s.at(-1); datos.remAnual = { fecha: f, valor: pct(v), variable: elegidas.rem.descripcion }; notas.push(`REM #${elegidas.rem.idVariable} = ${pct(v).toFixed(1)}%`); }
    }
    if (elegidas.plazoFijo) { datos.tasaPlazoFijo = unir(datos.tasaPlazoFijo, (await serie(elegidas.plazoFijo)).map(([f, v]) => [f, pct(v)])); notas.push(`plazo fijo #${elegidas.plazoFijo.idVariable}`); }
    if (elegidas.adelantos) { datos.tasaAdelantos = unir(datos.tasaAdelantos, (await serie(elegidas.adelantos)).map(([f, v]) => [f, pct(v)])); notas.push(`adelantos #${elegidas.adelantos.idVariable}`); }
    if (!notas.length) throw new Error("no se encontraron las variables esperadas");
    return notas.join(" · ");
  }),
);

// ---------- datos.gob.ar (Series de Tiempo) ----------
const SERIES = "https://apis.datos.gob.ar/series/api";
async function serieDatosGob(consulta, filtro) {
  const busq = await bajarJSON(`${SERIES}/search/?q=${encodeURIComponent(consulta)}&limit=25`);
  const cand = (busq.data || []).map((d) => ({ id: d.field?.id, titulo: `${d.field?.description || ""} ${d.field?.title || ""} ${d.dataset?.title || ""}`, frec: d.field?.frequency || "" }))
    .filter((c) => c.id && /P1M/.test(c.frec) && filtro(c.titulo));
  if (!cand.length) throw new Error(`sin series para "${consulta}"`);
  const elegida = cand[0];
  const j = await bajarJSON(`${SERIES}/series/?ids=${encodeURIComponent(elegida.id)}&limit=48&sort=desc&format=json`);
  return { id: elegida.id, titulo: elegida.titulo.trim().slice(0, 140), serie: (j.data || []).map(([f, v]) => [String(f).slice(0, 7), +v]).filter(([, v]) => Number.isFinite(v)).reverse() };
}
tareas.push(
  fuente("ipim_metal", "Precios mayoristas de productos metálicos (INDEC) — datos.gob.ar", `${SERIES}/search/?q=precios mayoristas metalicos`, async () => {
    const r = await serieDatosGob("precios mayoristas productos metalicos", (t) => /metál|metal/i.test(t) && /mayor|IPIM|SIPM/i.test(t) && !/discontinuad/i.test(t));
    datos.ipimMetal = unir(datos.ipimMetal, r.serie, "2000-01");
    return `${r.id}: ${r.titulo} · último ${r.serie.at(-1)?.[0]}`;
  }),
  fuente("salarios", "Índice de salarios, sector privado registrado (INDEC) — datos.gob.ar", `${SERIES}/search/?q=indice de salarios privado registrado`, async () => {
    const r = await serieDatosGob("indice de salarios privado registrado", (t) => /salario/i.test(t) && /privad/i.test(t) && /registrad/i.test(t) && !/no registrad/i.test(t));
    datos.salarios = unir(datos.salarios, r.serie, "2000-01");
    return `${r.id}: ${r.titulo} · último ${r.serie.at(-1)?.[0]}`;
  }),
);

await Promise.all(tareas);

// deslizamiento mensual observado del dólar oficial (últimos 60 días)
const ofi = datos.dolarOficial;
if (ofi.length > 40) {
  const a = ofi.at(-1), b = ofi.find(([f]) => f >= sumarDias(a[0], -60)) || ofi[0];
  const dias = (Date.parse(a[0]) - Date.parse(b[0])) / 86400e3;
  if (dias > 20 && b[1] > 0) datos.deslizamientoMensual = +((Math.pow(a[1] / b[1], 30 / dias) - 1) * 100).toFixed(2);
}
datos.fuentes.sort((a, b) => (a.id < b.id ? -1 : 1));
mkdirSync(dirname(SALIDA), { recursive: true });
writeFileSync(SALIDA, JSON.stringify(datos, null, 1));
const ok = datos.fuentes.filter((f) => f.ok).length;
log(`Listo: ${ok}/${datos.fuentes.length} fuentes actualizadas → ${SALIDA}`);
if (ok === 0) process.exitCode = 1;

// Pruebas del motor v3 con datos sintéticos (test/fixtures/economia-prueba.json, NO son reales).
import { readFileSync } from "node:fs";
import * as M from "../motor/motor.mjs";
const ok = (c, m) => { if (!c) { console.error("FALLA:", m); process.exit(1); } console.log("ok -", m); };
const eco = JSON.parse(readFileSync(new URL("./fixtures/economia-prueba.json", import.meta.url)));

function jugar(s) {
  let pausas = 0, reales = 0;
  while (!s.terminada) {
    let dec;
    if (s.eventoPendiente) { const p = M.lectura(s).eventoPendiente; dec = p.opciones[0].id; pausas++; if (p.real) reales++; }
    s = M.avanzarDias(s, 400, { decision: dec }).estado;
  }
  return { s, pausas, reales };
}

// 1) sin datos: todo proyectado
M.cargarEconomia(null);
let s = M.crearPartida({ semilla: 3, inicio: "2026-11-09", modoNovedades: "azar" });
let r = jugar(s);
ok(r.s.dia === 365 && r.s.usoDatos.reales === 0, `sin datos: 365 días, 0 días reales (${r.pausas} pausas)`);

// 2) con datos, arrancando hoy: el primer día usa el dato real de ayer, después proyecta
M.cargarEconomia(eco);
s = M.crearPartida({ semilla: 3, inicio: "2026-11-09", modoNovedades: "mixtas" });
const L0 = M.lectura(s);
ok(L0.economia.dolarOficial?.fuente === "real" && L0.economia.esReal, `día 1 con dólar real del día anterior: $${Math.round(L0.economia.dolarOficial.valor)}`);
ok(s.dolarBase > 0, "dólar de referencia tomado del dato real");
r = jugar(s);
ok(r.s.usoDatos.reales === 1, `arrancando hoy: ${r.s.usoDatos.reales} día real, ${r.s.usoDatos.proyectados} proyectados (REM)`);
ok(Math.abs(r.s.historial[1].inflacion - (Math.pow(1.24, 1 / 12) - 1)) < 1e-9, "meses futuros usan la inflación esperada del REM");
ok(r.s.historial.length === 13, `13 cierres de mes (de nov a nov): ${r.s.historial.map((h) => h.informe.mesNombre).join(", ")}`);

// 3) arrancando en enero 2026: pasa por datos reales, correcciones INDEC, salto del dólar y cambio de tasas
for (const modo of ["mixtas", "reales", "azar"]) {
  s = M.crearPartida({ semilla: 5, inicio: "2026-01-05", modoNovedades: modo });
  r = jugar(s);
  const b = r.s.bitacora;
  const indec = b.filter((x) => /INDEC/.test(x.texto)).length, ipim = b.filter((x) => /mayoristas metálicos/.test(x.texto)).length;
  const dol = b.filter((x) => /dólar oficial subió/.test(x.texto)).length, sal = b.filter((x) => /salarios INDEC/.test(x.texto)).length;
  const fer = b.filter((x) => x.tipo === "feriado").length;
  console.log(`   ${modo}: reales ${r.s.usoDatos.reales} / proy ${r.s.usoDatos.proyectados} · INDEC ${indec} · IPIM ${ipim} · salto dólar ${dol} · salarios ${sal} · feriados ${fer} · pausas ${r.pausas} (reales ${r.reales}) · ${M.veredicto(r.s).titulo} ${(M.veredicto(r.s).cambioPatrimonioReal * 100).toFixed(1)}%`);
  ok(r.s.usoDatos.reales > 200, `${modo}: más de 200 días con datos reales`);
  if (modo !== "azar") ok(dol >= 1, `${modo}: aparece el salto real del dólar`);
  if (modo === "reales") ok(b.filter((x) => x.tipo === "novedad").length === 0, "solo reales: no hay novedades sorteadas");
  if (modo === "azar") ok(b.filter((x) => x.tipo === "real").length === 0, "al azar: no hay novedades reales con decisión");
}
const rp = M.resumenPartida(r.s);
ok(rp.curva.length >= 12 && rp.modoNovedades === "azar", "resumen para comparar partidas");
const lt = M.lineaDeTiempo(r.s);
ok(lt.meses.length >= 12 && lt.meses.some((m) => m.feriados.length), `línea de tiempo con ${lt.meses.length} meses y feriados reales`);
console.log("\nTodas las pruebas del motor pasaron.");

// Balance: N partidas por estrategia. Uso: node test/balance.mjs [N] [inicio YYYY-MM-DD] [modo] [datos.json]
import { readFileSync } from "node:fs";
import { crearPartida, avanzarDias, veredicto, lectura, cargarEconomia, DIAS_TOTALES } from "../motor/motor.mjs";
const [N = 200, inicio = "2026-11-09", modo = "azar", archivo] = process.argv.slice(2);
cargarEconomia(archivo ? JSON.parse(readFileSync(archivo, "utf8")) : null);
const estrategias = {
  "no tocar nada": {}, "cobro 90": { plazoCobro: 90 }, "cobro 30 + remarcar c/1": { plazoCobro: 30, actualizarCada: 1 },
  "rep 30% + cobro 30": { reparaciones: 0.3, plazoCobro: 30 }, "markup 1.2": { markup: 1.2 }, "markup 0.5": { markup: 0.5 },
  "combo bueno": { plazoCobro: 30, reparaciones: 0.25, actualizarCada: 1, reservaPct: 0.5, markup: 0.85 },
};
export function jugar(seed, palancas) {
  let s = crearPartida({ semilla: seed, inicio, modoNovedades: modo });
  s = avanzarDias(s, 0, { palancas }).estado;
  while (!s.terminada) { const p = s.eventoPendiente ? lectura(s).eventoPendiente.opciones[0].id : undefined; s = avanzarDias(s, DIAS_TOTALES, { decision: p }).estado; }
  return s;
}
console.log(`inicio ${inicio} · modo ${modo} · datos ${archivo || "ninguno (todo proyectado)"}`);
for (const [n, p] of Object.entries(estrategias)) {
  const res = []; let q = 0;
  for (let seed = 1; seed <= +N; seed++) { const s = jugar(seed, p); res.push(veredicto(s).cambioPatrimonioReal); if (s.quiebra) q++; }
  res.sort((a, b) => a - b); const x = (k) => (res[Math.floor(k * (res.length - 1))] * 100).toFixed(1) + "%";
  console.log(n.padEnd(26), "mediana", x(0.5), " p10", x(0.1), " p90", x(0.9), " quiebras", q);
}

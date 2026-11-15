// Prueba de punta a punta del MCP server: habla JSON-RPC por stdio como lo haría un cliente.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = mkdtempSync(join(tmpdir(), "mc-"));
const p = spawn(process.execPath, [fileURLToPath(new URL("../mcp/server.mjs", import.meta.url))], { env: { ...process.env, MAQUINA_CAJA_DIR: dir, MAQUINA_CAJA_DATOS: fileURLToPath(new URL("./fixtures/economia-prueba.json", import.meta.url)) } });
let buf = "", n = 0; const pend = {};
p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(l); pend[m.id]?.(m); } });
const rpc = (method, params) => new Promise((r) => { const id = ++n; pend[id] = r; p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); if (r.error) throw new Error(r.error.message); return r.result; };
const assert = (c, m) => { if (!c) { console.error("FALLA:", m); process.exit(1); } else console.log("ok -", m); };

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
assert(init.result.serverInfo.name === "maquina-caja", "initialize");
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tl = await rpc("tools/list", {});
assert(tl.result.tools.length === 11, "tools/list: " + tl.result.tools.map((t) => t.name).join(", "));
const pr = await rpc("prompts/list", {}); assert(pr.result.prompts.length === 2, "prompts/list");
const pg = await rpc("prompts/get", { name: "jugar", arguments: { nombre_taller: "Tornería Rafaela" } }); assert(pg.result.messages[0].content.text.includes("Rafaela"), "prompts/get");
const rr = await rpc("resources/read", { uri: "maquina-caja://reglas" }); assert(rr.result.contents[0].text.includes("Modos de novedades"), "resources/read");
const er = await call("economia_real", {});
assert(er.structuredContent.resumen.hayDatos, "economia_real con datos (sintéticos de prueba)");
console.log("\n" + er.content[0].text.split("\n").slice(0, 8).join("\n") + "\n");

// partida que arranca hoy
const hoy = await call("nueva_partida", { nombre: "Tornería Rafaela", semilla: 42, modo_novedades: "mixtas", inicio: "2026-11-09" });
console.log(hoy.content[0].text.split("\n\nPalancas")[0].split("\n").slice(0, 12).join("\n") + "\n");
assert(hoy.structuredContent.lectura.economia.esReal, "el primer día usa datos reales del día anterior");

// partida en el pasado para recorrer datos reales, y su repetición con otros modos
const np = await call("nueva_partida", { nombre: "Taller Rosario", semilla: 7, modo_novedades: "mixtas", inicio: "2026-02-02" });
const id = np.structuredContent.partida_id;
assert(id, "nueva_partida → " + id);
const pp = await call("probar_palancas", { partida_id: id, plazoCobro: 30, reparaciones: 0.3 });
console.log(pp.content[0].text + "\n");
const d1 = await call("avanzar", { partida_id: id, unidad: "dia", cantidad: 5, plazoCobro: 30, reparaciones: 0.3, actualizarCada: 1 });
assert(d1.structuredContent.diasAvanzados === 5 || d1.structuredContent.pausa, "avanzar 5 días");
async function terminar(pid) {
  let fin = null, vueltas = 0, pausas = 0, reales = 0;
  while (!fin && vueltas < 80) {
    const tb = (await call("ver_tablero", { partida_id: pid })).structuredContent.lectura;
    const dec = tb.eventoPendiente?.opciones?.[0].id;
    if (dec) { pausas++; if (tb.eventoPendiente.real) reales++; }
    const r = await call("avanzar", { partida_id: pid, unidad: "mes", cantidad: 2, decision: dec });
    vueltas++;
    if (r.structuredContent.diagnostico) fin = r;
  }
  return { fin, vueltas, pausas, reales };
}
const j1 = await terminar(id);
assert(j1.fin, `partida mixtas terminada en ${j1.vueltas} llamadas, ${j1.pausas} pausas (${j1.reales} por novedades reales)`);
const ids = [id];
for (const modo of ["reales", "azar"]) {
  const rp = await call("nueva_partida", { repetir_de: id, modo_novedades: modo });
  assert(rp.structuredContent.inicio === "2026-02-02" && rp.structuredContent.semilla === 7, `repetir_de con modo ${modo}: misma fecha y semilla`);
  const j = await terminar(rp.structuredContent.partida_id); assert(j.fin, `partida ${modo} terminada (${j.pausas} pausas, ${j.reales} reales)`);
  ids.push(rp.structuredContent.partida_id);
}
const cmp = await call("comparar_partidas", { ids });
assert(cmp.structuredContent.partidas.length === 3, "comparar_partidas con 3 modos");
console.log("\n" + cmp.content[0].text + "\n");
const lt = await call("linea_de_tiempo", { partida_id: id });
assert(lt.structuredContent.meses.length >= 12 && lt.structuredContent.meses.every((m) => m.cerrado), "linea_de_tiempo con todos los meses cerrados");
const lj = await call("linea_de_tiempo", { partida_id: id, mes: "2026-06" });
assert(lj.content[0].text.includes("aguinaldo"), "detalle de junio con aguinaldo");
const err = await rpc("tools/call", { name: "avanzar", arguments: { partida_id: id } });
assert(err.result.isError, "error de juego terminado reportado como isError");
const ls = await call("listar_partidas", {}); assert(ls.structuredContent.partidas.length === 4, "partidas persistidas");
const ex = await call("explicar", { tema: "datos_reales" }); assert(ex.content[0].text.length > 50, "explicar");
p.kill(); console.log("\nTodas las pruebas pasaron.");

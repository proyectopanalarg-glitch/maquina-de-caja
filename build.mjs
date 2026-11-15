// Arma web/index.html: incrusta el motor y la última foto de datos reales (datos/economia.json, si existe)
// para que el juego funcione como un único archivo. También copia los datos a web/datos/ para GitHub Pages.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
const u = (p) => new URL(p, import.meta.url);
const motor = readFileSync(u("./motor/motor.mjs"), "utf8").replace(/^export (const|function|let|async function)/gm, "$1");
const src = readFileSync(u("./web/juego.src.html"), "utf8");
const datosArchivo = process.env.DATOS || "./datos/economia.json";
let economia = "null";
if (existsSync(u(datosArchivo))) {
  const d = JSON.parse(readFileSync(u(datosArchivo), "utf8"));
  economia = JSON.stringify(d).replace(/</g, "\\u003c");
  mkdirSync(u("./web/datos/"), { recursive: true });
  copyFileSync(u(datosArchivo), u("./web/datos/economia.json"));
  console.log(`datos reales incrustados: al ${d.fechaDatos} (${(d.fuentes || []).filter((f) => f.ok).length} fuentes OK)`);
} else console.log("sin datos/economia.json: el juego arranca proyectando y los baja al publicarse");
writeFileSync(u("./web/index.html"), src.replace("/*__MOTOR__*/", () => motor).replace("/*__ECONOMIA__*/null", () => economia));
console.log("web/index.html listo");

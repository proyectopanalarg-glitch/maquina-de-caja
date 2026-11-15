# Uso: pip install playwright && playwright install chromium; luego  python test/ui.py  (variables W, H, SEG, OUT opcionales)
# Prueba del juego web: corre el tiempo, responde novedades y captura en un ancho dado.
import sys, asyncio, os, pathlib
from playwright.async_api import async_playwright
W = int(os.environ.get("W", "1440")); H = int(os.environ.get("H", "1000"))
SEG = float(os.environ.get("SEG", "8")); OUT = os.environ.get("OUT", "captura_ui.png")
URL = (pathlib.Path(__file__).resolve().parent.parent / "web" / "index.html").as_uri()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
        pg = await b.new_page(viewport={"width": W, "height": H})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        await pg.goto(URL + "?semilla=7&velocidad=mes")
        await pg.evaluate("document.getElementById('pararCierre').checked = false")
        t = 0
        while t < SEG:
            await pg.wait_for_timeout(500); t += 0.5
            op = await pg.query_selector("#eventoBox:not([hidden]) .op")
            if op: await op.click()
        await pg.wait_for_timeout(300)
        info = await pg.evaluate("({dia: estado.dia, caja: Math.round(estado.caja/1e6), meses: estado.historial.length, sw: document.documentElement.scrollWidth, iw: innerWidth, part: particulas.length})")
        await pg.screenshot(path=OUT, full_page=os.environ.get("FULL") == "1")
        print("errores:", errs, info)
        await b.close()
asyncio.run(main())

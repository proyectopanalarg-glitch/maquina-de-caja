import asyncio, os, pathlib
from playwright.async_api import async_playwright
W=int(os.environ.get("W","1440")); H=int(os.environ.get("H","1000"))
URL = (pathlib.Path(__file__).resolve().parent.parent / "web" / "index.html").as_uri()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
        pg = await b.new_page(viewport={"width":W,"height":H})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(URL + "?semilla=11")
        for i in range(40):
            op = await pg.query_selector("#eventoBox:not([hidden]) .op")
            if op: await op.click(); await pg.evaluate("pausar()")
            fin = await pg.evaluate("estado.terminada")
            if fin: break
            await pg.click("#finMes" if W>820 else "#bFin")
            await pg.wait_for_timeout(150)
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=os.environ.get("OUT","captura_fin.png"))
        await pg.keyboard.press("Escape")
        await pg.evaluate("mesSel=5; lineaFirma=''; pintarLinea(); document.querySelector('.linea').scrollIntoView()")
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=os.environ.get("OUT2","captura_linea.png"))
        print(errs, await pg.evaluate("({dia:estado.dia, meses:estado.historial.length, bit:estado.bitacora.length})"))
        await b.close()
asyncio.run(main())

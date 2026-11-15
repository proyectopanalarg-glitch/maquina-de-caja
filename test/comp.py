# Juega 2 partidas (mixtas y luego repite "solo reales") y captura economía + comparador.
import asyncio, os, pathlib
from playwright.async_api import async_playwright
URL = (pathlib.Path(__file__).resolve().parent.parent / "web" / "index.html").as_uri()
W=int(os.environ.get("W","1440")); H=int(os.environ.get("H","1000"))
async def jugar(pg):
    for i in range(80):
        if await pg.evaluate("estado.terminada"): break
        op = await pg.query_selector("#eventoBox:not([hidden]) .op")
        if op: await op.click(); await pg.evaluate("pausar()")
        await pg.evaluate("avanzar(31)")
        await pg.wait_for_timeout(60)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
        pg = await b.new_page(viewport={"width":W,"height":H})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(URL + "?semilla=4&inicio=2026-03-02&modo=mixtas")
        await pg.wait_for_timeout(400)
        await pg.evaluate("document.querySelector('.eco').scrollIntoView()")
        await pg.screenshot(path=os.environ.get("OUT1","eco.png"))
        await jugar(pg)
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=os.environ.get("OUT2","fin.png"))
        await pg.click("[data-repetir=reales]")
        await jugar(pg)
        await pg.wait_for_timeout(900)
        await pg.keyboard.press("Escape")
        await pg.evaluate("document.querySelector('.comp').scrollIntoView()")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=os.environ.get("OUT3","comp.png"))
        print(errs, await pg.evaluate("({dia: estado.dia, modo: estado.modoNovedades, comp: comparadas().length, sw: document.documentElement.scrollWidth})"))
        await b.close()
asyncio.run(main())

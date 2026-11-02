"""Local (offline, two players on one screen) regression in a real browser: the merge must not have changed local play. Run: python3 tests/e2e/local.py"""
import subprocess, sys, os
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8766"); BASE = f"http://localhost:{PORT}"
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print("  FAIL:", m)
srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True); srv.stdout.readline()
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None); pg = br.new_page(viewport={"width": 1280, "height": 800})
        pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        ev = lambda expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
        def finish_draw():
            for _ in range(8):
                if pg.evaluate("document.getElementById('drawOv').hidden"): return
                if pg.locator("#drawB0").is_visible(): pg.click("#drawB0")
                if pg.locator("#drawB1").is_visible(): pg.click("#drawB1")
                try:
                    pg.wait_for_function("document.getElementById('drawOv').hidden", timeout=6000); return
                except Exception: pass
            raise AssertionError("the first-turn draw never finished")
        pg.goto(BASE + "/"); pg.wait_for_selector("#coverPlay"); pg.click("#coverPlay")
        pg.wait_for_selector("#md[open]"); pg.click("#mf .btn >> nth=0"); pg.wait_for_selector("#sd[open]"); pg.click("#sf .btn >> nth=2")
        pg.wait_for_selector("#dlg[open]"); pg.click("#dF .btn >> nth=0")
        finish_draw()
        pg.wait_for_function("document.querySelectorAll('#rk0 .tile').length===7")
        starter = ev("S.cur"); other = 1 - starter
        ok(ev("S.draw") and ev("S.draw.first") == starter, f"the first-turn draw decided the starter (seat {starter})")
        ok(not ev("!!app.net"), "local play: no online session")
        ok(pg.locator("html[data-online]").count() == 0 and pg.locator("#bUndo").is_visible() and pg.locator("#bNew").is_visible(), "local play still shows Undo and New game")
        ok(pg.locator("#netBar").is_hidden() and pg.locator("#lobby").is_hidden(), "no online UI in local play")
        ok(ev("!!document.querySelector('.pname bdi')") , "names are editable spans as before")
        blanks = ev(f"S.players[{starter}].rack.map(t => !!(t && t.blank))"); idx = [i for i, b in enumerate(blanks) if not b][:2]
        for k, i in enumerate(idx):
            pg.click(f"#rk{starter} .slot:nth-child({i + 1}) .tile"); pg.click(f"#board > .sq:nth-child({7 * 15 + 7 + k + 1})")
        pg.click("#bSubmit"); pg.wait_for_function(f"document.getElementById('sc{starter}').textContent!=='0'")
        ok(ev("S.cur") == other and ev("S.undo") is not None, "turn passed, undo available")
        pg.click("#bUndo"); pg.wait_for_selector("#dlg[open]"); pg.click("#dF .danger"); pg.wait_for_function(f"document.getElementById('sc{starter}').textContent==='0'")
        ok(ev("S.cur") == starter, "undo works")
        # end of game through the real endGame(): the result card must use the v4.5 final-score rule (x2, half rounds down, no floor)
        pg.evaluate("""async () => { const {S} = await import('/js/state.js'); const G = await import('/js/game.js');
          S.players[0].score = 100; S.players[0].ms = 150000; S.players[1].score = 90; S.players[1].ms = 151000; G.endGame('time'); }""")
        pg.wait_for_selector("#dlg.result[open] .resCard")
        bb = pg.locator("#dF .btn >> nth=0").bounding_box(); vh = pg.evaluate("innerHeight")
        ok(bb and bb["y"] >= 0 and bb["y"] + bb["height"] <= vh, "local result card is on screen after an earlier floating confirm (undo)")
        txt = pg.inner_text("#dlg .res")
        ok("2 × 2" in txt.replace("\u200f", "") or "2 × 2" in txt, f"2:30 counts as 2 minutes x 2: {txt[:140]!r}")
        ok("+4" in txt and "+6" in txt, "time bonus shown as +4 (2:30 -> 2 min) and +6 (2:31 -> 3 min)")
        br.close()
finally:
    srv.terminate()
real = [e for e in errors if "favicon" not in e and "manifest" not in e]
ok(not real, f"no browser errors: {real[:3]}")
print(f"{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)

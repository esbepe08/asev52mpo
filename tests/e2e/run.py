"""Two real browsers play a match through the real server core (see server.mjs). Run: python3 tests/e2e/run.py"""
import subprocess, sys, time, uuid, os, json
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8765"); BASE = f"http://localhost:{PORT}"
OUT = Path(os.environ.get("SHOTS", "/tmp/e2e-shots")); OUT.mkdir(parents=True, exist_ok=True)
passed = failed = 0
def ok(cond, msg):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("  FAIL:", msg)
def group(n): print("\n# " + n)

srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True)
srv.stdout.readline()
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
        fake = (HERE / "fake-backend.js").read_text()
        def player(label, w, h, touch=False):
            uid = str(uuid.uuid4()); ctx = br.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch)
            ctx.add_init_script(f"window.__USER='{uid}';" + fake)
            pg = ctx.new_page()
            pg.on("pageerror", lambda e, l=label: errors.append(f"{l} pageerror: {e}"))
            pg.on("console", lambda m, l=label: errors.append(f"{l} console: {m.text}") if m.type == "error" else None)
            return pg
        A = player("A", 1280, 800); B = player("B", 390, 844, touch=True)
        S = lambda pg, expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")

        group("cover -> lobby -> create / join by link")
        A.goto(BASE + "/"); A.wait_for_selector("#coverOnline", state="visible"); A.click("#coverOnline")
        A.wait_for_selector("#lobby #lbNick"); A.fill("#lbNick", "Sultan"); A.click("[data-a=create]")
        A.wait_for_selector(".lbCode"); code = A.inner_text(".lbCode").strip()
        ok(len(code) == 6, f"room code shown: {code}")
        ok(A.locator(".lbSeat").count() == 2 and A.locator(".lbSeat.empty").count() == 1, "two seats, one empty")
        ok(A.locator("[data-a=start]").is_disabled(), "host cannot start before the guest is ready")
        A.screenshot(path=str(OUT / "01-lobby-host.png"))
        B.goto(BASE + f"/?room={code}"); B.wait_for_selector("#lbCode")
        ok(B.input_value("#lbCode") == code, "?room= link prefills the code")
        B.fill("#lbNick", "Ahmad"); B.click("[data-a=join]"); B.wait_for_selector("[data-a=ready]")
        A.wait_for_function("document.querySelectorAll('.lbSeat').length===2 && !document.querySelector('.lbSeat.empty')")
        ok(True, "host sees the guest arrive")
        B.screenshot(path=str(OUT / "02-lobby-guest.png"))
        B.click("[data-a=ready]"); A.wait_for_function("!document.querySelector('[data-a=start]').disabled")
        ok(True, "host can start once the guest is ready")
        A.click("[data-a=start]")
        group("first-turn draw")
        for pg, n in ((A, "A"), (B, "B")):
            pg.wait_for_selector("#drawOv:not([hidden])")
            ok(pg.locator("#drawSeats .drawBtn:visible").count() == 1, f"{n}: exactly one draw button (own card)")
        A.screenshot(path=str(OUT / "03a-draw-A.png"))
        A.click("#drawSeats .drawBtn:visible")   # A draws first: the test server gives the first drawer the higher tile
        A.wait_for_function("document.querySelectorAll('#drawSeats .drawTile[data-state=up]').length===1")
        ok(True, "A's own tile is revealed at once")
        ok(B.locator("#drawSeats .drawTile[data-state=up]").count() == 0, "B does not see A's tile before drawing")
        B.click("#drawSeats .drawBtn:visible")
        for pg, n in ((A, "A"), (B, "B")):
            pg.wait_for_function("document.querySelectorAll('#drawSeats .drawTile[data-state=up]').length===2")
        A.wait_for_timeout(800)   # let both flips finish before the screenshot
        A.screenshot(path=str(OUT / "03b-draw-reveal.png")); B.screenshot(path=str(OUT / "03c-draw-reveal-mobile.png"))
        for pg in (A, B):
            pg.wait_for_function("document.getElementById('drawOv').hidden", timeout=10000)
        ok(True, "both cards reveal, the draw closes and play begins")
        ok(S(A, "app.net.snap.game.current_seat") == 0 and S(B, "app.net.snap.game.current_seat") == 0, "the higher draw (A) starts")
        for pg in (A, B): pg.wait_for_selector("#netBar", state="visible"); pg.wait_for_function("document.getElementById('lobby').hidden")
        A.wait_for_function("document.querySelectorAll('#rk0 .tile:not(.back)').length===7")
        B.wait_for_function("document.querySelectorAll('#rk1 .tile:not(.back)').length===7")
        ok(True, "both players have their own 7 tiles, lobby closed")
        for pg in (A, B): pg.wait_for_function("document.getElementById('cover').hidden && !document.querySelector('.app').inert")
        ok(True, "the cover is gone and the board is usable on both screens")
        ok(B.locator("#rk0 .tile.back").count() == 7, "B sees A's rack as 7 hidden tiles")
        ok(S(A, "app.net.seat") == 0 and S(B, "app.net.seat") == 1, "seats assigned")
        ok(A.locator("html[data-online]").count() == 1 and A.locator("#bNew").is_hidden(), "online mode hides New game")
        ok(A.locator("#bUndo").is_visible() and A.locator("#bUndo").is_disabled() and B.locator("#bUndo").is_disabled(), "Undo is shown online but disabled until there is a move to take back")
        ok(A.locator("#netPause").is_visible() and "إيقاف" in A.inner_text("#netPause"), "the match bar offers a pause")
        ok(A.locator("#wrB .wrList").count() >= 2 and A.locator("#lobby").is_hidden(), "the word rules are in Settings")
        ok("Sultan" in A.inner_text("#pn0 .pname") and "Ahmad" in A.inner_text("#pn1 .pname"), "names come from the room")
        A.screenshot(path=str(OUT / "03-match-desktop.png")); B.screenshot(path=str(OUT / "04-match-mobile.png"))

        rect = lambda pg, sel: pg.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10) }", sel)
        bar0 = {"A": rect(A, "#netBar"), "B": rect(B, "#netBar")}; pn0 = {"A": rect(A, "#pn0"), "B": rect(B, "#pn0")}
        def stable(label):
            for n, pg in (("A", A), ("B", B)):
                b = rect(pg, "#netBar"); ok(b == bar0[n], f"match bar keeps its exact box in state '{label}' on {n}: {b} vs {bar0[n]}")
                ok(rect(pg, "#pn0") == pn0[n], f"nothing below the bar moved in state '{label}' on {n}")
        group("turn gating")
        ok(A.locator("#bPass").is_enabled() and B.locator("#bPass").is_disabled(), "only the player on turn can act")

        def play_two(pg, seat):
            blanks = S(pg, f"S.players[{seat}].rack.map(t => !!(t && t.blank))")
            idx = [i for i, b in enumerate(blanks) if not b][:2]
            for k, i in enumerate(idx):
                pg.click(f"#rk{seat} .slot:nth-child({i + 1}) .tile"); pg.click(f"#board > .sq:nth-child({7 * 15 + 7 + k + 1})")
        group("a move, end to end")
        play_two(A, 0)
        ok(A.locator("#board .sq.mv").count() == 2, "two pending tiles on A's board")
        ok(B.locator("#board .sq.has").count() == 0, "B sees nothing until A commits (the preview is private)")
        A.click("#bSubmit")
        B.wait_for_function("document.querySelectorAll('#board .sq.has').length===2")
        ok(True, "B receives A's move")
        for pg, n in ((A, "A"), (B, "B")): ok(pg.locator("#board .sq.lm").count() == 2, f"{n}: last move marked on the board")
        ok(int(A.inner_text("#sc0")) > 0 and A.inner_text("#sc0") == B.inner_text("#sc0"), "score is the same on both screens")
        ok(A.locator("#bPass").is_disabled() and B.locator("#bPass").is_enabled(), "the turn passed to B")
        ok(A.locator("#rk0 .tile:not(.back)").count() == 7, "A's rack was refilled")
        B.screenshot(path=str(OUT / "05-after-move-mobile.png"))

        group("undo with the opponent's approval")
        ok(A.locator("#bUndo").is_enabled() and B.locator("#bUndo").is_disabled(), "the mover can ask, the player on turn cannot")
        A.click("#bUndo")
        B.wait_for_selector("#undoReq:not([hidden])"); ok("يطلب التراجع" in B.inner_text("#urT"), "B is asked to approve, in a banner that cannot be missed")
        B.wait_for_timeout(400); B.screenshot(path=str(OUT / "09-undo-banner-mobile.png"))
        ok(A.locator("#undoReq:not([hidden])").count() == 0, "the requester does not see the answer banner")
        A.wait_for_function("document.getElementById('netState').textContent.includes('بانتظار موافقة')")
        ok("إلغاء" in A.inner_text("#bUndo"), "A can withdraw the request while it waits")
        B.reload()   # the request is server state: it must come back on a refreshed page, not only on a realtime event
        B.wait_for_selector("#undoReq:not([hidden])", timeout=30000)
        ok(True, "the request survives a refresh, rebuilt from the snapshot")
        B.wait_for_timeout(400); B.screenshot(path=str(OUT / "09-undo-banner-mobile.png"))
        B.click("#urYes")
        for pg in (A, B): pg.wait_for_function("document.querySelectorAll('#board .sq.has').length===0")
        B.wait_for_function("document.getElementById('undoReq').hidden")
        ok(True, "approved: the move is gone from both boards (and the banner closes)")
        A.wait_for_function("!document.getElementById('bPass').disabled"); ok(B.locator("#bPass").is_disabled(), "the turn is back with A")
        ok(int(A.inner_text("#sc0")) == 0 and A.locator("#rk0 .tile:not(.back)").count() == 7, "score and rack are restored")
        play_two(A, 0); A.click("#bSubmit")
        B.wait_for_function("document.querySelectorAll('#board .sq.has').length===2"); ok(True, "A plays again")
        A.click("#bUndo"); B.wait_for_selector("#undoReq:not([hidden])"); B.click("#urNo")
        A.wait_for_function("document.getElementById('toast').textContent.includes('رفض')"); ok(True, "A is told the request was declined")
        ok(A.locator("#bUndo").is_disabled(), "the same move cannot be asked for again")
        ok(A.locator("#board .sq.has").count() == 2, "a decline leaves the board as it was")

        group("pause")
        B.click("#netPause")
        for pg in (A, B): pg.wait_for_selector("html[data-paused]")
        ok(True, "both screens show the pause (board and racks hidden)")
        for pg, n in ((A, "A"), (B, "B")):
            pg.wait_for_selector("#pauseOv:not([hidden])")
            ok("متوقفة" in pg.inner_text("#pauseT") and "مدة التوقف" in pg.inner_text("#pauseClock"), f"{n}: the pause card says what happened and for how long")
        ok(A.locator("#netPause").is_disabled() and "بعد" in A.inner_text("#netPause"), "the other player's resume button counts down")
        ok(A.locator("#pauseResume").is_disabled() and "بعد" in A.inner_text("#pauseResume"), "the other player's card resume is disabled until the limit")
        ok(B.locator("#pauseResume").is_enabled(), "the pauser can resume from the card at any time")
        A.screenshot(path=str(OUT / "10-pause-desktop.png")); B.screenshot(path=str(OUT / "11-pause-mobile.png"))
        ok(B.locator("#bPass").is_disabled(), "nothing can be played while paused")
        stable("paused")
        B.click("#pauseResume")
        for pg in (A, B): pg.wait_for_function("!document.documentElement.dataset.paused")
        for pg in (A, B): pg.wait_for_function("document.getElementById('pauseOv').hidden")
        ok(B.locator("#bPass").is_enabled(), "the pauser resumed: B is on turn again")

        group("live preview of tentative tiles")
        B.click("#rk1 .slot:nth-child(1) .tile"); B.click(f"#board > .sq:nth-child({8 * 15 + 7 + 1})")
        A.wait_for_function("document.querySelectorAll('#board [data-ghost]').length===1")
        ok(A.locator("#board .sq.has").count() == 2, "A sees B's tentative tile as a dashed ghost, not as a tile on the board")
        ok(A.locator("#netLive").is_visible() and A.get_attribute("#netLive", "aria-pressed") == "true", "the match bar has a live-preview switch, and it is on")
        A.click("#netLive")
        A.wait_for_function("document.querySelectorAll('#board [data-ghost]').length===0")
        ok(A.get_attribute("#netLive", "aria-pressed") == "false" and "موقوفة" in A.inner_text("#toast"), "switching it off clears the ghost and says so")
        A.click("#netLive")
        A.wait_for_function("document.querySelectorAll('#board [data-ghost]').length===1")
        ok(True, "switching it back on shows the opponent's current draft again (no extra move needed)")
        B.click("#bCancel")
        A.wait_for_function("document.querySelectorAll('#board [data-ghost]').length===0"); ok(True, "taking the tile back clears the ghost")

        group("tahkim: the challenger rules the word wrong, the move is voided")
        B.click("#bJudge"); B.wait_for_selector("#jd[open]")
        ok(A.locator("#jd[open]").count() == 0, "A (not the resolver) gets no ruling dialog")
        A.wait_for_function("document.getElementById('netState').textContent.includes('حكم')")
        ok(True, "A is told it is waiting for the ruling")
        stable("tahkim pending")
        B.click("#jd [data-a=no]")
        for pg in (A, B): pg.wait_for_function("document.querySelectorAll('#board .sq.has').length===0")
        ok(True, "the voided move is gone from both boards")
        ok(S(A, "app.net.snap.game.current_seat") == 1 and B.locator("#bPass").is_enabled(), "the mover loses the turn: B plays")
        ok(S(A, "S.hist.find(e=>e.st)?.st") == "void", "history records the void ruling")

        group("pass, swap")
        B.click("#bPass"); A.wait_for_function("!document.getElementById('bPass').disabled")
        ok(True, "B passes: A is on turn again")
        A.click("#bSwap"); A.click("#rk0 .slot:nth-child(1) .tile"); A.click("#bSubmit")
        B.wait_for_function("!document.getElementById('bPass').disabled")
        ok(True, "A swaps a tile: B is on turn")

        group("touch drag and drop works online (finger on B's phone)")
        cdp = B.context.new_cdp_session(B)
        def finger(frm, to):
            a = B.locator(frm).bounding_box(); b = B.locator(to).bounding_box()
            x0, y0, x1, y1 = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2, b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
            pt = lambda x, y: [{"x": x, "y": y, "id": 1}]
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pt(x0, y0)})
            for k in range(1, 9): cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pt(x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8 + (k / 8) * 0)})
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        blanksB = S(B, "S.players[1].rack.map(t => !!(t && t.blank))"); idxB = [i for i, b in enumerate(blanksB) if not b][:2]
        # the ghost floats ABOVE the fingertip (js/touchdrag.js), so release a little below the target's centre
        for k, i in enumerate(idxB):
            tgt = f"#board > .sq:nth-child({7 * 15 + 7 + k + 1})"; box = B.locator(tgt).bounding_box()
            src = B.locator(f"#rk1 .slot:nth-child({i + 1}) .tile").bounding_box()
            sx, sy = src["x"] + src["width"] / 2, src["y"] + src["height"] / 2
            tx, ty = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2 + box["width"] * 0.85 * 1.5
            pt = lambda x, y: [{"x": x, "y": y, "id": 1}]
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pt(sx, sy)})
            for n in range(1, 9): cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pt(sx + (tx - sx) * n / 8, sy + (ty - sy) * n / 8)})
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            B.wait_for_function(f"document.querySelectorAll('#board .sq.mv').length>={k + 1}")
        ok(B.locator("#board .sq.mv").count() == 2, "two tiles dragged onto the board with a finger")
        B.click("#bCancel"); B.wait_for_function("document.querySelectorAll('#board .sq.mv').length===0")
        ok(True, "cancel returns them to the rack")

        group("connection state")
        ok(A.locator("#pn1 .pstat.on").count() == 1, "opponent's presence dot is on")

        group("resign -> identical result card for both, rematch")
        B.click("#netLeave"); B.wait_for_selector("#dlg[open]"); B.click("#dF .danger")
        for pg in (A, B): pg.wait_for_selector("#dlg.result[open] .resWin")
        ta, tb = A.inner_text("#dlg .res"), B.inner_text("#dlg .res")
        for pg in (A, B): pg.evaluate("document.querySelector('#dlg').close()") if False else None
        ok(ta == tb and "الفائز" in ta and "Sultan" in ta, "both see the same result with Sultan as winner")
        ok("استسلم" in ta, "reason names the player who resigned")
        A.screenshot(path=str(OUT / "06-result-desktop.png"))
        A.click("#dF .yes")
        B.wait_for_function("document.querySelector('#dlg.result[open] #dF .yes')?.textContent.includes('قبول')")
        ok(True, "B's result card itself says the opponent asked for a rematch (the card is modal)")
        bb = B.locator("#dF .yes").bounding_box(); vh = B.evaluate("innerHeight")
        ok(bb and bb["y"] >= 0 and bb["y"] + bb["height"] <= vh, f"the result card's buttons are inside the phone screen (y={bb and round(bb['y'])}..{bb and round(bb['y'] + bb['height'])} of {vh}): a confirm shown earlier must not displace it")
        B.screenshot(path=str(OUT / "07-b-result.png"))
        B.click("#dF .yes")
        for pg in (A, B): pg.wait_for_function("document.querySelectorAll('#board .sq.has').length===0 && !document.getElementById('netRematch').offsetParent")
        ok(S(A, "app.net.snap.game.round") == 2, "round 2 started with fresh racks")
        group("the rematch draws for the first turn too")
        for pg in (A, B): pg.wait_for_selector("#drawOv:not([hidden])")
        ok(True, "both players are asked to draw again for the new round")
        A.click("#drawSeats .drawBtn:visible")
        B.click("#drawSeats .drawBtn:visible")
        for pg in (A, B): pg.wait_for_function("document.getElementById('drawOv').hidden", timeout=10000)
        ok(S(A, "app.net.snap.game.status") == "active" and S(A, "app.net.snap.game.draw.done"), "round 2 starts after the draw")
        group("Floating Workspace: the match bar is a movable module")
        flo = lambda pg, on: pg.evaluate("async (on) => (await import('/js/float.js')).setFloating(on)", on)
        flo(A, True); A.wait_for_function("document.documentElement.dataset.floating==='true'")
        cs = A.evaluate("getComputedStyle(document.getElementById('netBar')).position")
        ok(cs == "fixed", f"the bar floats (position: {cs})")
        ok(A.locator("#netGrip").is_visible(), "its grip is visible")
        b1 = rect(A, "#netBar"); vw, vh = A.evaluate("[innerWidth, innerHeight]")
        ok(b1[0] >= 0 and b1[1] >= 0 and b1[0] + b1[2] <= vw and b1[1] + b1[3] <= vh, f"it starts on screen: {b1}")
        g = A.locator("#netGrip").bounding_box(); gx, gy = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
        tx, ty = gx + (200 if gx < vw / 2 else -200), gy + (180 if gy < vh / 2 else -180)
        A.mouse.move(gx, gy); A.mouse.down(); A.mouse.move((gx + tx) / 2, (gy + ty) / 2, steps=5); A.mouse.move(tx, ty, steps=5); A.mouse.up()
        b2 = rect(A, "#netBar")
        ok(abs(b2[0] - b1[0]) > 100 or abs(b2[1] - b1[1]) > 100, f"dragging the grip moves the bar: {b1} -> {b2}")
        ok(b2[2:] == b1[2:], "moving never resizes it")
        ok(A.evaluate("!!JSON.parse(localStorage.getItem('scrabble.float')||'{}').net"), "its position is remembered on this device")
        A.screenshot(path=str(OUT / "08-floating-bar-moved.png"))
        A.dblclick("#netGrip"); b3 = rect(A, "#netBar")
        ok(abs(b3[0] - b1[0]) < 3 and abs(b3[1] - b1[1]) < 3, f"double-click on the grip restores the default spot: {b3}")
        A.locator("#netLeave").hover()
        flo(A, False); A.wait_for_function("!document.documentElement.dataset.floating")
        ok(A.evaluate("getComputedStyle(document.getElementById('netBar')).position") != "fixed" and rect(A, "#netBar") == bar0["A"], "leaving the workspace puts the bar back exactly where it was in the page flow")
        br.close()
finally:
    srv.terminate()
group("browser errors")
real = [e for e in errors if "favicon" not in e and "manifest" not in e]
ok(not real, f"no page errors or console errors: {real[:3]}")
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)

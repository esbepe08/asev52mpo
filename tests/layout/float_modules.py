"""Real-browser checks for the floating modules, touch drag-and-drop, vertical fit and the end-of-game result.
Needs: pip install playwright && playwright install chromium   (python3 layout/float_modules.py; exits non-zero on any failure)
It starts its own static server on a free port, so nothing else has to be running. Chromium's synthetic touch (CDP) is used for the touch drag.
Note: Chromium withholds the click for a tap that follows a touch drag by ~1 s whatever the page does, so the tap check waits before tapping."""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'
def boot(b, vp, touch=False, floating=False):
    ctx=b.new_context(viewport=vp, has_touch=touch, is_mobile=touch, device_scale_factor=2 if touch else 1)
    pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e))); pg.on('console',lambda m: m.type=='error' and errs.append('CONSOLE '+m.text))
    fl="localStorage.setItem('scrabble.floatWorkspace.v2',JSON.stringify({v:2,enabled:true,tools:'open',portrait:{},landscape:{}}));" if floating else ""
    pg.add_init_script("try{if(!sessionStorage.getItem('init')){localStorage.clear();localStorage.setItem('scrabble.draw','off');sessionStorage.setItem('init','1');"+fl+"}}catch(e){}")
    pg.goto(BASE+'/index.html',wait_until='networkidle')
    pg.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important}')
    pg.click('#coverPlay'); pg.wait_for_selector('#md[open]'); pg.click('#mf .modeBtn[value="expanded"]'); pg.wait_for_selector('#sd[open]'); pg.click('#sf .btn[value="25"]'); pg.wait_for_selector('#dlg[open]'); pg.click('#dF .btn[value="ok"]'); pg.wait_for_timeout(600)
    return ctx,pg,errs
ok_n=0; bad=[]
ok_n_total=0
def ok(c,msg):
    global ok_n_total
    ok_n_total+=1
    print(('PASS ' if c else 'FAIL ')+msg); 
    if not c: bad.append(msg)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    # ================= 1. touch drag-and-drop (phone, portrait) =================
    ctx,pg,errs=boot(b,dict(width=390,height=844),touch=True)
    cdp=ctx.new_cdp_session(pg)
    def touch(path):
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':path[0][0],'y':path[0][1],'id':1}]})
        for x,y in path[1:]: cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y,'id':1}]}); pg.wait_for_timeout(16)
        return
    def release(): cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); pg.wait_for_timeout(120)
    ctr=lambda s: pg.evaluate("s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,r.width]}",s)
    def line(a,b,n=8): return [(a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n) for i in range(n+1)]
    cell=lambda r,c: pg.evaluate("async([r,c])=>{const {S}=await import('/js/state.js');return !!S.board[r][c]}",[r,c])
    inmove=lambda: pg.evaluate("async()=>{const {S}=await import('/js/state.js');return S.move.length}")
    tile=pg.evaluate("document.querySelector('.panel.on .rack .slot .tile').closest('.slot').dataset.i")
    src=ctr(f'.panel.on .rack .slot[data-i="{tile}"]'); sq=ctr('#board .sq[data-r="7"][data-c="7"]')
    ghost=max(44, sq[2]*1.5); lift=ghost*0.85
    touch(line((src[0],src[1]),(sq[0],sq[1]+lift)))
    ok(pg.evaluate("!!document.querySelector('.tile.dragGhost')"),'ghost tile follows the finger')
    ok(pg.evaluate("!!document.querySelector('#board .sq.drop')"),'square under the ghost is outlined as a drop target')
    ok(pg.evaluate("!!document.querySelector('.tile.dragging')"),'source tile is dimmed while dragging')
    gb=pg.evaluate("(()=>{const r=document.querySelector('.tile.dragGhost').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,r.width]})()")
    ok(gb[1] < sq[1]+lift-5, 'ghost sits above the fingertip (not hidden by the finger)')
    ok(gb[2] >= 44, f'ghost is at least 44px wide ({gb[2]:.0f})')
    release()
    ok(cell(7,7),'dropping on the centre square places the tile'); ok(inmove()==1,'one tile in the pending move')
    ok(pg.evaluate("!document.querySelector('.tile.dragGhost') && !document.querySelector('.tile.dragging') && !document.querySelector('.drop')"),'ghost, dim and outline are cleaned up')
    # a stray click right after the drag must not select anything
    ok(pg.evaluate("async()=>{const {S}=await import('/js/state.js');return S.pick===null}"),'no tile left selected after the drag (follow-up click swallowed)')
    # drag the placed tile back to its rack
    placed=ctr('#board .sq[data-r="7"][data-c="7"]'); empty=pg.evaluate("[...document.querySelectorAll('.panel.on .rack .slot')].findIndex(s=>!s.querySelector('.tile'))")
    slot=ctr(f'.panel.on .rack .slot[data-i="{empty}"]')
    touch(line((placed[0],placed[1]),(slot[0],slot[1]+lift)))
    release()
    ok(not cell(7,7) and inmove()==0,'dragging a pending tile back onto the rack takes it back')
    # drop nowhere
    src=ctr(f'.panel.on .rack .slot[data-i="{tile}"]')
    touch(line((src[0],src[1]),(200,30))); release()
    ok(inmove()==0 and pg.evaluate("!document.querySelector('.tile.dragGhost')"),'dropping outside any target changes nothing')
    # a plain tap still selects (Chromium's synthetic touch swallows any tap for ~1s after a drag whatever the page does, so wait before it)
    pg.wait_for_timeout(2600)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':src[0],'y':src[1],'id':1}]}); cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); pg.wait_for_timeout(250)
    ok(pg.evaluate("async()=>{const {S}=await import('/js/state.js');return S.pick!==null}"),'a tap still selects the tile (tap-then-tap flow intact)')
    # a short wobble (< 8px) is a tap, not a drag
    pg.evaluate("async()=>{const {S}=await import('/js/state.js');S.pick=null;(await import('/js/ui.js')).render()}")
    touch(line((src[0],src[1]),(src[0]+4,src[1]+3),2)); release()
    ok(not pg.evaluate("!!document.querySelector('.tile.dragGhost')"),'a small wobble does not start a drag')
    ok(errs==[],'no errors on touch path '+str(errs)); ctx.close()

    # ================= 2. vertical fit polish (desktop, floating workspace) =================
    ctx,pg,errs=boot(b,dict(width=1280,height=800),floating=True)
    def drag(sel,dx,dy,steps=10,hold=False):
        g=pg.query_selector(sel); r=g.bounding_box(); x=r['x']+r['width']/2; y=r['y']+r['height']/2
        pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.move(x+dx,y+dy,steps=steps)
        if not hold: pg.mouse.up(); pg.wait_for_timeout(100)
        return x,y
    drag('#pn1 .flMove',-420,-330); pg.wait_for_timeout(150)
    hgt=lambda s: pg.evaluate("s=>document.querySelector(s).getBoundingClientRect().height",s)
    pinned=lambda s: pg.evaluate("s=>!!document.querySelector(s).style.height",s)
    nat=hgt('#pn1')
    drag('#pn1 .flGrip',0,+5); ok(not pinned('#pn1'),'a 5px vertical wobble does not pin the height')
    drag('#pn1 .flGrip',0,+60); ok(pinned('#pn1') and hgt('#pn1')>nat+40,f'a real vertical drag pins and grows the panel ({nat:.0f} -> {hgt("#pn1"):.0f})')
    # no jump at the moment the drag becomes vertical: sample heights through a slow drag
    pg.evaluate("document.querySelector('#pn1 .flGrip').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))"); pg.wait_for_timeout(200)
    drag('#pn1 .flMove',-420,-330); pg.wait_for_timeout(150)   # the reset sent it back under the controls: move it into free space again
    nat=hgt('#pn1'); hs=[]
    g=pg.query_selector('#pn1 .flGrip'); r=g.bounding_box(); x=r['x']+r['width']/2; y=r['y']+r['height']/2
    pg.mouse.move(x,y); pg.mouse.down()
    for i in range(1,31):
        pg.mouse.move(x,y+i*3); pg.wait_for_timeout(18); hs.append(hgt('#pn1'))
    pg.mouse.up(); pg.wait_for_timeout(100)
    steps=[round(b-a,1) for a,b in zip([nat]+hs,hs)]
    ok(max(abs(s) for s in steps)<=12,f'height grows smoothly while dragging (largest single step {max(abs(s) for s in steps)}px)')
    # snap back to automatic by dragging up to the natural height
    nat_now=pg.evaluate("async()=>{const f=await import('/js/float-fit.js');const t={id:'p1',el:document.querySelector('#pn1'),def:{flex:true}};return f.naturalHeight(t)}")
    cur=hgt('#pn1'); drag('#pn1 .flGrip',0,-(cur-nat_now)+4)
    ok(not pinned('#pn1'),f'dragging back to within 10px of the automatic height un-pins it (auto {nat_now:.0f}, now {hgt("#pn1"):.0f})')
    # hysteresis: row count changes monotonically while shrinking a pinned rack slowly
    drag('#pn1 .flGrip',0,+140); rows=[]
    g=pg.query_selector('#pn1 .flGrip'); r=g.bounding_box(); x=r['x']+r['width']/2; y=r['y']+r['height']/2
    pg.mouse.move(x,y); pg.mouse.down()
    for i in range(1,60):
        pg.mouse.move(x,y-i*2); pg.wait_for_timeout(12)
        rows.append(pg.evaluate("new Set([...document.querySelectorAll('#rk1 .slot')].map(s=>s.style.gridRow)).size"))
    pg.mouse.up(); pg.wait_for_timeout(100)
    flips=sum(1 for a,b in zip(rows,rows[1:]) if a!=b); 
    ok(flips<=2 and all(b<=a for a,b in zip(rows,rows[1:])),f'row count moves one way, once, while shrinking the height ({rows[0]}..{rows[-1]} rows, {flips} change)')
    # Home on the grip un-pins
    pg.focus('#pn1 .flGrip'); pg.keyboard.press('Home'); pg.wait_for_timeout(150)
    ok(not pinned('#pn1'),'Home on the resize grip returns to automatic height')
    pg.focus('#pn1 .flGrip'); pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(100); ok(pinned('#pn1'),'ArrowDown on the grip pins a height')
    ok('Home' in pg.evaluate("document.querySelector('#pn1 .flGrip').getAttribute('aria-label')"),'grip label mentions Home for automatic height')
    # flActive survives a render (className used to wipe it)
    pg.evaluate("document.querySelector('#pn0').classList.add('flActive')"); pg.evaluate("async()=>(await import('/js/ui.js')).render()")
    ok(pg.evaluate("document.querySelector('#pn0').classList.contains('flActive')"),'a render keeps other classes on the panel (classList.toggle)')
    ok(errs==[],'no errors in floating '+str(errs)); ctx.close()

    # ================= 3. end of game: final score formula =================
    ctx,pg,errs=boot(b,dict(width=1280,height=800))
    def end(ms0, score0, ms1, score1, reason='rack', tile=True):
        return pg.evaluate("""async([ms0,s0,ms1,s1,reason,tile])=>{
          const {S}=await import('/js/state.js'); const G=await import('/js/game.js');
          S.ended=false; S.paused=true; S.players.forEach(p=>{p.rack=p.rack.map(()=>null)});
          const left=tile?S.bag.pop():{v:0}; if(tile) S.players[1].rack[0]=left; S.players[0].ms=ms0; S.players[1].ms=ms1; S.players[0].score=s0; S.players[1].score=s1;
          G.endGame(reason);
          const d=document.querySelector('#dlg'); const cards=[...d.querySelectorAll('.resCard')];
          const r={left:left.v, scores:cards.map(c=>c.querySelector('.resScore').textContent), text:cards.map(c=>c.textContent), why:d.querySelector('.resWhy').textContent, win:d.querySelector('.resWin').textContent};
          d.close(''); return r}""",[ms0,score0,ms1,score1,reason,tile])
    r=end(150000,50,0,30)   # 2:30 -> 2 min -> +4
    ok(r['scores'][0]=='54','2:30 left counts as 2 minutes: 50 + 2x2 = 54 (got %s)'%r['scores'][0])
    ok(r['scores'][1]==str(30-r['left']),f"second player: 30 - tile value {r['left']} = {30-r['left']} (got {r['scores'][1]})")
    ok('+4' in r['text'][0] and 'خصم ' in r['text'][1] and 'النقاط' in r['text'][0],'result card shows score, time bonus and deduction')
    ok('(2 × 2' in r['text'][0].replace('\u2066','').replace('\u2069',''),'time bonus shows its working (minutes x 2): '+r['text'][0][:60])
    for ms,exp in [(151000,6),(149000,4),(10000,0),(0,0),(180000,6),(210000,6),(211000,8)]:
        r=end(ms,0,0,0); ok(r['scores'][0]==str(exp),f'{ms//1000//60}:{ms//1000%60:02d} left -> bonus {exp} (got {r["scores"][0]})')
    neg=pg.evaluate("""async()=>{const {finalScore}=await import('/js/scoring.js');return finalScore(0,0,9).total}""")
    ok(neg==-9,'no floor: a score can go below zero by the formula (%s)'%neg)
    r=end(60000,10,60000,10,'time',False); ok(r['win']=='تعادل!','equal totals are a draw')
    ok('انتهى وقت' in r['why'],'time-out reason names the player: '+r['why'])
    r=end(60000,10,60000,10,'rack'); ok('جميع قطعه' in r['why'],'rack-out reason names the player: '+r['why'])
    # passing is unlimited: 40 passes never end the game
    pg.evaluate("async()=>{const {S}=await import('/js/state.js');S.ended=false;S.paused=false}")
    n=pg.evaluate("async()=>{const {S}=await import('/js/state.js');const G=await import('/js/game.js');for(let i=0;i<40;i++)G.pass();return [S.ended,S.hist.length>=40]}"); ok(n[0]==False,'40 passes in a row do not end the game')
    ok(pg.evaluate("[...document.querySelectorAll('#endRules li')].length")==5,'settings window states the end-of-game rules')
    ok(errs==[],'no errors in end-of-game '+str(errs)); ctx.close()
    # ================= 4. workspace regression: every path through the floating modules runs without an error =================
    ctx,pg,errs=boot(b,dict(width=1280,height=800),floating=True)
    box=lambda s: pg.evaluate("s=>{const r=document.querySelector(s).getBoundingClientRect();return [Math.round(r.left),Math.round(r.top)]}",s)
    def mdrag(sel,dx,dy):
        g=pg.query_selector(sel); r=g.bounding_box(); x=r['x']+r['width']/2; y=r['y']+r['height']/2
        pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.move(x+dx,y+dy,steps=8); pg.mouse.up(); pg.wait_for_timeout(100)
    b0=box('#pn0'); mdrag('#pn0 .flMove',30,-25); ok(box('#pn0')!=b0,'a module moves with its handle')
    pg.click('#toolsToggle'); pg.wait_for_timeout(200); ok(pg.evaluate("document.querySelector('#tools').dataset.min")=='true','Game Tools minimize')
    pg.click('#toolsToggle'); pg.wait_for_timeout(200); ok(pg.evaluate("document.querySelector('#tools').dataset.min")=='false','Game Tools restore')
    pg.evaluate("document.querySelector('#bSettings').click()"); pg.wait_for_timeout(200)
    ok(pg.evaluate("document.querySelector('#ad').open && getComputedStyle(document.querySelector('#ad')).position")=='fixed','settings float')
    pg.evaluate("document.querySelector('#flReset').click()"); pg.wait_for_timeout(250)
    ok(pg.evaluate("!document.querySelector('#pn1').style.height"),'reset clears pinned heights')
    pg.evaluate("document.querySelector('#aClose').click()"); pg.wait_for_timeout(150)
    pg.evaluate("document.querySelector('#bLog').click()"); pg.wait_for_timeout(200); ok(pg.evaluate("document.querySelector('#hist').classList.contains('open')"),'word-log drawer opens'); pg.evaluate("document.querySelector('#bLog').click()")
    pg.evaluate("document.querySelector('#bSettings').click()"); pg.wait_for_timeout(150)
    pg.evaluate("document.querySelector('#lyB [data-k=float][data-v=off]').click()"); pg.wait_for_timeout(250)
    ok(pg.evaluate("document.documentElement.dataset.floating||null")==None and pg.evaluate("document.querySelectorAll('.flGrip').length")==1,'workspace off removes the chrome (the dialogue keeps its grip)')
    pg.evaluate("document.querySelector('#lyB [data-k=float][data-v=on]').click()"); pg.wait_for_timeout(300)
    ok(pg.evaluate("document.querySelectorAll('.flGrip').length")==7,'workspace on again restores all grips')
    ok(errs==[],'no errors through the workspace paths '+str(errs)); ctx.close()
    b.close()

print('\n%d checks, %s' % (ok_n_total, 'FAILED: '+'; '.join(bad) if bad else 'all passed'))
srv.shutdown(); sys.exit(1 if bad else 0)

// Word-log button: one #bLog, a normal member of the control palette (.ctrls), never attached to the board.
// It follows the three button styles (icon / icon+label / text), exists only in drawer mode, never clips or overflows, and still toggles the drawer.
import { launch, openGame, closeGame, VIEWPORTS } from './lib.mjs';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await launch();
const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const MEASURE = () => {
  const btn = document.querySelector('#bLog'), ctrls = document.querySelector('.ctrls'), cs = getComputedStyle(btn), r = btn.getBoundingClientRect(), c = ctrls.getBoundingClientRect();
  const others = [...ctrls.querySelectorAll('.btn:not(#bLog)')].filter(x => getComputedStyle(x).display !== 'none');
  const lbl = btn.querySelector('.lbl'), lr = lbl.getBoundingClientRect(), ic = btn.querySelector('.ic');
  return {
    count: document.querySelectorAll('#bLog').length, inCtrls: btn.closest('.ctrls') === ctrls, inBoard: !!document.querySelector('.boardWrap #bLog'),
    shown: cs.display !== 'none', position: cs.position, radius: cs.borderRadius, w: r.width, h: r.height, minH: Math.min(...others.map(x => x.getBoundingClientRect().height)),
    label: btn.getAttribute('aria-label'), ctl: btn.getAttribute('aria-controls'), exp: btn.getAttribute('aria-expanded'), title: btn.title,
    lblVisible: lr.width > 2 && lr.height > 2, iconShown: !!ic && getComputedStyle(ic).display !== 'none' && ic.getBoundingClientRect().width > 4,
    inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5,
    sameRadius: cs.borderRadius === getComputedStyle(others[0]).borderRadius,
    inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight + 0.5 || document.documentElement.scrollHeight > innerHeight,
    hOverflow: document.documentElement.scrollWidth > innerWidth, hist: document.documentElement.dataset.hist,
    bagPadding: getComputedStyle(document.querySelector('#bagInfo')).paddingInlineStart,
  };
};
for (const layout of ['classic', 'duel']) {
  let first = true;
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const tag = `${layout} / ${name}`;
    const { page, errors } = await openGame(b, vp, { storage: { 'scrabble.layout': JSON.stringify({ layout }) } });   // no "hist" key = the default drawer
    for (const st of ['icon', 'iconlabel', 'text']) {
      await page.evaluate(s => { document.documentElement.dataset.bstyle = s; }, st); await settle(page);
      const m = await page.evaluate(MEASURE), t = `${tag} / ${st}`;
      ok(m.hist === 'drawer' && m.count === 1, `${t}: drawer mode, exactly one #bLog`);
      ok(m.inCtrls && !m.inBoard, `${t}: #bLog is inside .ctrls and not inside .boardWrap`);
      ok(m.shown && m.position !== 'absolute' && m.sameRadius && m.radius !== '50%', `${t}: ordinary control button, no corner overlay (${m.position}, ${m.radius})`);
      ok(m.label === 'سجل الكلمات' && m.title === 'سجل الكلمات' && m.ctl === 'hist' && m.exp === 'false', `${t}: accessible name, title, aria-controls, aria-expanded kept`);
      ok(m.iconShown === (st !== 'text'), `${t}: icon ${st === 'text' ? 'hidden' : 'shown'}`);
      ok(m.lblVisible === (st !== 'icon'), `${t}: label ${st === 'icon' ? 'hidden (accessible name only)' : 'visible'}`);
      ok(m.w >= 28 && m.h >= 28 && m.h >= m.minH - 1.5, `${t}: touch-sized like its siblings (${m.w.toFixed(0)}x${m.h.toFixed(0)}, siblings ${m.minH.toFixed(0)})`);
      ok(m.inside, `${t}: not clipped by the control palette`);
      ok(!m.hOverflow, `${t}: no horizontal overflow`);
      ok(m.bagPadding === '0px', `${t}: bag counter has no leftover padding for the old icon (${m.bagPadding})`);
    }
    await page.evaluate(() => { document.documentElement.dataset.bstyle = 'icon'; });
    if (first) {   // behaviour once per layout: opens, closes with the same button, closes with Esc, focus returns to the button
      first = false;
      const st = () => page.evaluate(() => ({ open: document.querySelector('#hist').classList.contains('open'), exp: document.querySelector('#bLog').getAttribute('aria-expanded') }));
      ok(JSON.stringify(await st()) === '{"open":false,"exp":"false"}', `${tag}: drawer starts closed`);
      await page.$eval('#bLog', e => e.click()); ok(JSON.stringify(await st()) === '{"open":true,"exp":"true"}', `${tag}: click opens the drawer`);
      await page.$eval('#bLog', e => e.click()); ok(JSON.stringify(await st()) === '{"open":false,"exp":"false"}', `${tag}: second click closes it`);
      ok(await page.evaluate(() => document.activeElement.id === 'bLog'), `${tag}: focus returns to #bLog after closing`);
      await page.$eval('#bLog', e => e.click()); await page.keyboard.press('Escape'); ok(JSON.stringify(await st()) === '{"open":false,"exp":"false"}', `${tag}: Esc closes it`);
      ok(await page.evaluate(() => document.activeElement.id === 'bLog'), `${tag}: focus returns to #bLog after Esc`);
    }
    ok(errors.length === 0, `${tag}: no page errors: ${errors.join(';')}`);
    await closeGame(page);
  }
}
// docked history: the toggle is meaningless there, so the button is not shown and takes no grid cell
{
  const { page } = await openGame(b, VIEWPORTS['desktop 1366x768']);   // lib default = docked
  const m = await page.evaluate(() => ({ d: getComputedStyle(document.querySelector('#bLog')).display, h: document.documentElement.dataset.hist, n: document.querySelectorAll('#bLog').length, inC: !!document.querySelector('.ctrls #bLog') }));
  ok(m.h === 'docked' && m.d === 'none' && m.n === 1 && m.inC, 'docked: #bLog stays in .ctrls but is not displayed ' + JSON.stringify(m));
  await closeGame(page);
}
await b.close();
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

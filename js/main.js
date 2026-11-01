// Application entry point.
import { TICK_MS } from './config.js';
import { S } from './state.js';
import { buildDom, onAfterRender } from './ui.js';
import { tick, newGame } from './game.js';
import { initInput } from './input.js';
import { initThemes } from './themes.js';
import { initHistoryToggle } from './histview.js';
import { showCover } from './cover.js';
import { initLayout } from './layout.js';
import { initWorkspace } from './float.js';
import { initFullscreen } from './fullscreen.js';
import { loadNames } from './names.js';
import { initNameEdit } from './nameedit.js';
import { initHaptics } from './haptics.js';
import { loadSaved, initPersistence, startFlow, schedule } from './persist.js';
import { initPwa } from './pwa.js';

const RESUME = 'scrabble.online.resume';
const wantsOnline = () => { try { return !!new URLSearchParams(location.search).get('room') || !!localStorage.getItem(RESUME); } catch { return false; } };

function start() {
  const saved = loadSaved();   // an unfinished match from a previous visit, validated; read before anything can overwrite it
  initThemes();
  loadNames();   // before buildDom: the panels are drawn with the saved names
  initHistoryToggle();
  initLayout();
  buildDom();
  initFullscreen();
  initWorkspace();   // needs the player panels that buildDom just created; a saved "Floating Workspace: ON" is restored here
  initInput();
  initNameEdit();
  initHaptics();
  setInterval(tick, TICK_MS);
  newGame();
  S.paused = true;       // clock stays frozen until the setup flow finishes
  initPersistence(saved);   // before the render hook, so the start-up game can never replace a saved match
  onAfterRender(schedule);
  // Online code is fetched only when asked for (or when a ?room= link / an unfinished online match asks for it): local play never loads it.
  const openOnline = auto => import('./online/lobby.js').then(m => m.lobby.open(() => {}, auto));
  showCover(() => startFlow(saved), () => openOnline(false));   // cover first; "Play" offers to resume a saved match, else opens mode selection, then duration
  if (wantsOnline()) openOnline(true);
  initPwa();
}

start();

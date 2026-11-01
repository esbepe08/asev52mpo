// Touch feedback (vibration, no sound). A device preference with an off switch in Settings; it never reads or writes game state.
//   tick     any press of a button, tile, square or rack slot
//   score    a move was scored          bingo   all seven tiles used          bad   a refused move or a hint          end   the game is over
// Only touch and pen users feel anything: nothing happens until the first touch/pen press, and a mouse press never vibrates.
// Android (Chrome, Edge, Samsung Internet, Firefox) vibrates through navigator.vibrate. iPhone/iPad Safari has no Vibration API, so a best-effort
// switch-control haptic (iOS 18 and later) is used there for a single tick; where it is not supported nothing happens.
//   scrabble.haptics   'off' when switched off; anything else (including missing) means on
const KEY = 'scrabble.haptics';
const PATTERNS = { tick: 10, score: [14, 40, 14], bingo: [16, 40, 16, 40, 48], bad: [28, 50, 28], end: [30, 60, 30, 60, 90] };
const PRESSABLE = '.btn, .tile, .sq, .slot, .pname, .thOpt, [role="button"], summary';

let enabled = true, lastType = 'mouse', lastAt = 0, ios = null;
try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* storage unavailable: on */ }

const hasVibrate = () => typeof navigator.vibrate === 'function';
// Chrome refuses (and logs an intervention) until the page has had a user gesture, so ask first.
const canVibrate = () => hasVibrate() && (!navigator.userActivation || navigator.userActivation.hasBeenActive);
const touchDevice = () => matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;

function iosTick() {
  try {
    if (!ios) {
      ios = document.createElement('label');
      ios.setAttribute('aria-hidden', 'true');
      ios.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      const box = document.createElement('input'); box.type = 'checkbox'; box.setAttribute('switch', ''); box.tabIndex = -1;
      ios.append(box); document.body.append(ios);
    }
    ios.click();
  } catch { /* unsupported: no feedback */ }
}

export function haptic(kind = 'tick') {
  if (!enabled || lastType === 'mouse') return;
  const now = performance.now();
  if (now - lastAt < 30) return;   // one pulse per gesture, however many listeners ask
  lastAt = now;
  if (hasVibrate()) { if (canVibrate()) { try { navigator.vibrate(PATTERNS[kind] ?? PATTERNS.tick); } catch { /* refused by the browser */ } } }
  else if (touchDevice()) iosTick();
}

export function setHaptics(on) {
  enabled = !!on;
  try { enabled ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, 'off'); } catch { /* storage unavailable */ }
}

export function initHaptics() {
  document.addEventListener('pointerdown', e => {
    lastType = e.pointerType || 'mouse';
    if (!e.isPrimary || lastType === 'mouse') return;
    const el = e.target?.closest?.(PRESSABLE);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert]')) return;
    haptic('tick');
  }, true);
  buildSetting();
}

// Settings row: shown only on devices that can plausibly use it (touch screens); a desktop mouse user never sees it.
function buildSetting() {
  const sec = document.getElementById('hpSec'), box = document.getElementById('hpB');
  if (!sec || !box || !touchDevice()) return;
  sec.hidden = false;
  const draw = () => {
    box.innerHTML = '<div class="segRow"><div class="setRowHead">الاهتزاز عند اللمس</div><div class="seg" role="group" aria-label="الاهتزاز عند اللمس">'
      + [[true, 'تشغيل'], [false, 'إيقاف']].map(([v, t]) => `<button type="button" class="btn" data-v="${v}" aria-pressed="${enabled === v}">${t}</button>`).join('')
      + '</div></div>';
  };
  draw();
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    setHaptics(b.dataset.v === 'true'); draw();
    if (enabled) { lastType = 'touch'; haptic('tick'); }   // a sample, so the switch can be felt
  });
}

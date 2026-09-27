// UI / input / audio test bench.
// ?state=hud|start|intro|complete|victory|pause|loading  &theme=office|beach  &bg=office|beach|dark
// &power=0.7  &flash=swish|score|rim|miss|info  &freeze=1 (hold animations for screenshots)
// &touch=1 (touch legends + controls)  &lock=1 (click-to-aim prompt)  &guide=1  &streak=4  &muted=1
// &cancel=1 (touch: throw button in its release-to-cancel state)  &grab=1 (touch: power meter being dragged)
// &test=input  -> synthetic-event checks of ThrowInput
// &test=audio  -> renders every AudioFX sound offline and reports levels / clicks, with play buttons
import '../src/styles.css';
import { UI } from '../src/ui.js';
import { ThrowInput, inputGate } from '../src/input.js';
import { AudioFX } from '../src/audio.js';
import { THROW } from '../src/config.js';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'beach' ? 'beach' : 'office';
const state = q.get('state') || 'hud';
const test = q.get('test');
const touch = q.get('touch') === '1';
const out = document.getElementById('results');

document.getElementById('backdrop').className = `bd bd-${q.get('bg') || theme}`;
if (q.get('freeze') === '1') document.body.classList.add('freeze');
if (q.get('css')) document.head.insertAdjacentHTML('beforeend', `<style>${q.get('css')}</style>`); // debugging aid

const log = (...a) => {
  console.log(...a);
};

if (test === 'input') runInputTests();
else if (test === 'audio') runAudioTests();
else showState();

// ------------------------------------------------------------------ states

function showState() {
  const ui = new UI(undefined, { touch: touch || undefined });
  window.ui = ui;
  ui.setTheme(theme);
  const lvl = theme === 'beach'
    ? { index: 1, name: 'Casa Marea', subtitle: 'Oceanfront Airbnb · Golden Hour', start: 100, target: 200, score: 160 }
    : { index: 0, name: 'Macrodata Refinement', subtitle: 'Lumon Industries · Severed Floor', start: 0, target: 100, score: 40 };
  ui.setLevel(lvl.index, lvl.name, lvl.subtitle);
  ui.setScore(lvl.score, lvl.start, lvl.target);
  const streak = Number(q.get('streak') ?? 2);
  ui.setStats(lvl.index ? { shots: 27, makes: 16, streak } : { shots: 11, makes: 7, streak });
  let guideFull = q.get('guide') === '1';
  let muted = q.get('muted') === '1';
  ui.setAim({ pitchDeg: 34.4, guideFull });
  ui.setMuted(muted);
  // Stand-ins for main.js's toggles, so the touch chip and sound button can be tried here.
  ui.onGuideToggle = () => ui.setAim({ pitchDeg: 34.4, guideFull: (guideFull = !guideFull) });
  const handlers = { onToggleMute: () => ui.setMuted((muted = !muted)) };
  const power = q.get('power');
  if (power !== null) ui.setPower(Number(power), true);
  // Same copy as main.js's aimHint().
  ui.setHint(q.get('hint') ?? (touch
    ? 'Drag to aim · hold the throw button and slide up for power · release to throw'
    : 'Mouse aims · hold click and pull back for power · release to throw · [G] full arc'));

  // Touch controls and the click-to-aim prompt live in input.js; show them when asked.
  if (q.get('lock') === '1') {
    const input = new ThrowInput(document.getElementById('game'), handlers);
    input.update(0.016);
  } else if (touch) {
    const input = new ThrowInput(document.getElementById('game'), handlers);
    window.input = input;
    input._setMode('touch');
    if (power !== null && q.get('grab') !== '1') {
      input.charging = true;
      input._chargeSource = 'button';
      input._btnCancel = q.get('cancel') === '1';
      input.power = Number(power);
    }
    if (q.get('grab') === '1') ui.$.power.classList.add('is-grabbed');
    input.update(0.016);
  }

  const flash = q.get('flash');
  if (flash) {
    const text = { swish: 'Swish! +10', score: '+10', rim: 'Rim out', miss: 'Miss', info: 'Guide: full' }[flash] || flash;
    ui.flash(text, flash in { swish: 1, score: 1, rim: 1, miss: 1, info: 1 } ? flash : 'info');
    if (document.body.classList.contains('freeze')) {
      // Swap in a copy that the UI's auto-removal timer doesn't know about, so it survives until the screenshot.
      const el = ui.$.flashes.lastElementChild;
      ui.$.flashes.appendChild(el.cloneNode(true));
      el.remove();
    }
  }

  const stats = { score: lvl.target, shots: 17, makes: 10, bestStreak: 5, swishes: 3 };
  switch (state) {
    case 'start':
      ui.showStart().then(() => log('start resolved'));
      break;
    case 'intro':
      ui.showLevelIntro({
        index: lvl.index, name: lvl.name, subtitle: lvl.subtitle,
        goal: `Score ${lvl.target - lvl.start} more points (${(lvl.target - lvl.start) / 10} baskets) to clear the level`,
        duration: document.body.classList.contains('freeze') ? Infinity : undefined,
      }).then(() => log('intro resolved'));
      break;
    case 'complete':
      ui.showLevelComplete({ index: lvl.index, name: lvl.name, stats, nextName: lvl.index ? undefined : 'Casa Marea' }).then(() => log('complete resolved'));
      break;
    case 'victory':
      ui.showVictory({ stats: { score: 200, shots: 34, makes: 20, bestStreak: 6, swishes: 7 } }).then((r) => log('victory ->', r));
      break;
    case 'pause':
      ui.showPause(true);
      break;
    case 'loading':
      ui.setLoading(q.get('text') || (theme === 'beach' ? 'Preparing your stay…' : 'Refining the severed floor…'));
      break;
    case 'demo':
      runDemo(ui);
      break;
    default:
  }
}

/** Cycles through HUD events so the motion can be eyeballed in a real browser. */
function runDemo(ui) {
  let score = 0;
  let shots = 0;
  let makes = 0;
  let streak = 0;
  let t = 0;
  const kinds = ['score', 'swish', 'rim', 'miss', 'score'];
  setInterval(() => {
    const kind = kinds[t++ % kinds.length];
    shots++;
    if (kind === 'score' || kind === 'swish') {
      makes++;
      streak++;
      score += 10;
    } else streak = 0;
    ui.flash(kind === 'swish' ? 'Swish! +10' : kind === 'score' ? '+10' : kind === 'rim' ? 'Rim out' : 'Miss', kind);
    ui.setScore(score, 0, 100);
    ui.setStats({ shots, makes, streak });
  }, 1800);
  let p0 = performance.now();
  const loop = (now) => {
    const t = (now - p0) / 1000;
    ui.setPower(0.45 + 0.3 * Math.sin(t * 1.3), true, t % 4 < 2.6);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ input tests

async function runInputTests() {
  out.classList.add('on');
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
  const calls = { throw: [], charge: 0, guide: 0, pause: 0, mute: 0, gesture: 0 };
  const canvas = document.getElementById('game');
  // A real HUD, so the touch power meter, aim chip and sound button can be exercised against it.
  const ui = new UI(undefined, { touch: true });
  const input = new ThrowInput(canvas, {
    onThrow: (p) => calls.throw.push(p),
    onChargeStart: () => calls.charge++,
    onToggleGuide: () => calls.guide++,
    onTogglePause: () => calls.pause++,
    onToggleMute: () => calls.mute++,
    onFirstGesture: () => calls.gesture++,
  });
  const key = (type, code, extra = {}) =>
    window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true, ...extra }));
  const tap = (code) => {
    key('keydown', code);
    key('keyup', code);
  };
  const step = (seconds, dt = 1 / 60) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) input.update(Math.min(dt, seconds - t));
  };
  const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
  const deg = (r) => ((r * 180) / Math.PI).toFixed(2);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const prompt = document.querySelector('.tk-lock-prompt');

  // defaults
  check('default aim', input.yaw === 0 && input.pitch === THROW.defaultPitch);
  check('enabled by default', input.enabled === true);

  // first gesture fires once
  key('keydown', 'KeyQ');
  key('keydown', 'KeyQ');
  check('onFirstGesture once', calls.gesture === 1, `calls=${calls.gesture}`);

  // hold-and-adjust power via Space + Up/Down
  check('power starts at the default', near(input.power, THROW.defaultPower, 1e-9), `p=${input.power}`);
  input.update(0.016);
  check('lock prompt shows while the mouse is free', input.mode !== 'lock' || prompt.classList.contains('is-visible'), `mode=${input.mode}`);
  key('keydown', 'Space');
  check('Space starts charge', input.charging && calls.charge === 1);
  step(1);
  check('lock prompt hides during a keyboard wind-up', !prompt.classList.contains('is-visible'));
  check('holding alone does not change power', near(input.power, THROW.defaultPower, 1e-9), `p=${input.power}`);
  const pitchBefore = input.pitch;
  key('keydown', 'ArrowUp');
  step(1);
  key('keyup', 'ArrowUp');
  check('Up while charging raises power', near(input.power, THROW.defaultPower + THROW.keyPowerRate, 0.02), `p=${input.power.toFixed(3)}`);
  check('Up while charging leaves pitch alone', input.pitch === pitchBefore);
  const expected = input.power;
  key('keydown', 'Space', { repeat: true });
  check('key repeat ignored while charging', input.charging && calls.charge === 1);
  key('keyup', 'Space');
  check('Space release throws once', calls.throw.length === 1 && near(calls.throw[0], expected, 1e-9), `power=${calls.throw[0]?.toFixed(3)}`);
  check('power is remembered after the throw', !input.charging && near(input.power, expected, 1e-9));
  input.update(0.016);
  check('lock prompt returns after the throw', input.mode !== 'lock' || prompt.classList.contains('is-visible'));

  // huge frame dt is clamped (a tab stall must not jump the power)
  const before = input.power;
  key('keydown', 'Space');
  key('keydown', 'ArrowDown');
  input.update(5);
  key('keyup', 'ArrowDown');
  check('update dt clamped to 0.1s', near(input.power, before - 0.1 * THROW.keyPowerRate, 1e-6), `p=${input.power.toFixed(4)}`);
  key('keyup', 'Space');
  calls.throw.length = 0;
  input.resetAim();

  // aim clamping with held keys
  key('keydown', 'ArrowUp');
  step(12);
  key('keyup', 'ArrowUp');
  check('pitch clamps at maxPitch', near(input.pitch, THROW.maxPitch, 1e-9), `${deg(input.pitch)}°`);
  key('keydown', 'KeyS');
  step(12);
  key('keyup', 'KeyS');
  check('pitch clamps at minPitch', near(input.pitch, THROW.minPitch, 1e-9), `${deg(input.pitch)}°`);
  key('keydown', 'ArrowLeft');
  step(12);
  key('keyup', 'ArrowLeft');
  check('yaw clamps at +yawRange (left)', near(input.yaw, THROW.yawRange, 1e-9), `${deg(input.yaw)}°`);
  key('keydown', 'KeyD');
  step(12);
  key('keyup', 'KeyD');
  check('yaw clamps at -yawRange (right)', near(input.yaw, -THROW.yawRange, 1e-9), `${deg(input.yaw)}°`);
  input.resetAim();
  key('keydown', 'KeyA');
  step(0.5);
  key('keyup', 'KeyA');
  const fine = input.yaw;
  check('fine aim rate ~16°/s', near((fine * 180) / Math.PI, 8, 0.2), `${deg(fine)}° in 0.5s`);
  input.resetAim();
  check('resetAim', input.yaw === 0 && input.pitch === THROW.defaultPitch);

  // disabled guard
  const chargesBefore = calls.charge;
  input.setEnabled(false);
  key('keydown', 'Space');
  check('no charge while disabled', !input.charging && calls.charge === chargesBefore);
  input.setEnabled(true);
  step(0.3);
  key('keyup', 'Space');
  check('release of a press made while disabled does not throw', calls.throw.length === 0);
  key('keydown', 'Space');
  step(0.3);
  input.setEnabled(false);
  check('disabling mid-charge cancels', !input.charging);
  key('keyup', 'Space');
  check('...and never throws', calls.throw.length === 0);
  key('keydown', 'ArrowUp');
  step(0.5);
  key('keyup', 'ArrowUp');
  check('no aim while disabled', input.pitch === THROW.defaultPitch);

  // toggles
  tap('KeyP');
  check('P toggles pause even while disabled', calls.pause === 1);
  input.setEnabled(true);
  tap('Escape');
  check('Esc toggles pause (unlocked)', calls.pause === 2);
  tap('KeyG');
  check('G toggles guide', calls.guide === 1);
  tap('KeyM');
  check('M toggles mute', calls.mute === 1);
  key('keydown', 'KeyG', { ctrlKey: true });
  check('modifier combos ignored', calls.guide === 1);

  // gates raised by the UI
  inputGate.modal = true;
  key('keydown', 'Space');
  tap('KeyP');
  tap('KeyM');
  check('modal: no charge, no pause, mute still works', !input.charging && calls.pause === 2 && calls.mute === 2);
  key('keyup', 'Space');
  inputGate.modal = false;
  inputGate.paused = true;
  key('keydown', 'Space');
  check('paused: no charge', !input.charging);
  key('keyup', 'Space');
  inputGate.paused = false;

  // touch: throw button and relative drag
  input._setMode('touch');
  input.update(0.016);
  const btn = document.querySelector('.tk-throw-btn');
  check('throw button shown in touch mode', btn?.classList.contains('is-visible'));
  const pe = (target, type, o) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, ...o }));
  const label = () => btn.querySelector('.tk-throw-label').textContent;
  const pull = THROW.touchPullPixels;
  input.resetAim();
  pe(btn, 'pointerdown', { clientX: 300, clientY: 700 });
  pe(btn, 'pointermove', { clientX: 300, clientY: 700 - pull * 0.2 });
  step(0.05); // controls restyle on the next frame
  const pulled = THROW.defaultPower + 0.2;
  check('button charges; sliding up adds power', input.charging && near(input.power, pulled, 0.01), `p=${input.power.toFixed(3)}`);
  check('button shows pressed state', btn.classList.contains('is-pressed') && label() === 'Release');
  pe(btn, 'pointermove', { clientX: 300, clientY: 700 - pull * 0.1 });
  check('sliding back down takes power away', near(input.power, THROW.defaultPower + 0.1, 0.01), `p=${input.power.toFixed(3)}`);
  pe(btn, 'pointermove', { clientX: 300, clientY: 700 - pull * 0.2 });
  pe(btn, 'pointerup', { clientX: 300, clientY: 700 - pull * 0.2 });
  check('button release throws', calls.throw.length === 1 && near(calls.throw[0], pulled, 0.01), `power=${calls.throw[0]?.toFixed(3)}`);

  // Sliding sideways off the button, then letting go, cancels and keeps the power that was set.
  const kept = input.power;
  pe(btn, 'pointerdown', { clientX: 300, clientY: 700 });
  pe(btn, 'pointermove', { clientX: 250, clientY: 700 - pull * 0.1 });
  step(0.02);
  check('a little sideways drift is not a cancel', !btn.classList.contains('is-cancel') && near(input.power, kept + 0.1, 0.01));
  pe(btn, 'pointermove', { clientX: 200, clientY: 700 - pull * 0.15 });
  step(0.02);
  check('>70px sideways shows the release-to-cancel state', btn.classList.contains('is-cancel') && label() === 'Cancel' && !btn.classList.contains('is-pressed'));
  check('power holds still in the cancel zone', near(input.power, kept + 0.1, 0.01), `p=${input.power.toFixed(3)}`);
  pe(btn, 'pointerup', { clientX: 200, clientY: 700 - pull * 0.15 });
  step(0.02);
  check('letting go there cancels: no throw, power kept', !input.charging && calls.throw.length === 1 && near(input.power, kept + 0.1, 0.01));
  check('button returns to its idle state', !btn.classList.contains('is-cancel') && !btn.classList.contains('is-pressed') && label() === 'Hold');
  pe(btn, 'pointerdown', { clientX: 300, clientY: 700 });
  pe(btn, 'pointermove', { clientX: 390, clientY: 700 });
  pe(btn, 'pointermove', { clientX: 330, clientY: 700 });
  step(0.02);
  check('sliding back from the cancel zone re-arms the throw', !btn.classList.contains('is-cancel') && btn.classList.contains('is-pressed'));
  pe(btn, 'pointerup', { clientX: 330, clientY: 700 });
  check('...and letting go then throws', calls.throw.length === 2);
  pe(btn, 'pointerdown', {});
  step(0.2);
  pe(btn, 'pointercancel', {});
  check('pointercancel cancels without throwing', !input.charging && calls.throw.length === 2);

  // Dragging the HUD power meter sets power without winding up or throwing.
  const meter = ui.$.power;
  ui.setPower(input.power, true, false);
  check('power meter takes touches in touch mode', getComputedStyle(meter).pointerEvents === 'auto');
  const span = meter.querySelector('.tk-power-track').getBoundingClientRect().height;
  const m0 = input.power;
  const chargesBeforeMeter = calls.charge;
  pe(meter, 'pointerdown', { pointerId: 12, clientX: 30, clientY: 500 });
  pe(meter, 'pointermove', { pointerId: 12, clientX: 30, clientY: 500 - span * 0.25 });
  check('dragging the meter up adds power, 1:1 with its track', near(input.power, m0 + 0.25, 0.01) && meter.classList.contains('is-grabbed'), `p=${input.power.toFixed(3)} span=${span}`);
  pe(meter, 'pointermove', { pointerId: 12, clientX: 30, clientY: 500 + span * 0.1 });
  check('...and down takes it away', near(input.power, m0 - 0.1, 0.01), `p=${input.power.toFixed(3)}`);
  pe(meter, 'pointerup', { pointerId: 12 });
  check('the meter never winds up or throws', !input.charging && calls.charge === chargesBeforeMeter && calls.throw.length === 2 && !meter.classList.contains('is-grabbed'));
  input.setEnabled(false);
  const m1 = input.power;
  pe(meter, 'pointerdown', { pointerId: 13, clientX: 30, clientY: 500 });
  pe(meter, 'pointermove', { pointerId: 13, clientX: 30, clientY: 400 });
  pe(meter, 'pointerup', { pointerId: 13 });
  check('meter ignored while input is disabled', input.power === m1);
  input.setEnabled(true);

  // Touch stand-ins for M and G.
  const sound = document.querySelector('.tk-sound-btn');
  input.update(0.016);
  check('sound button shown in touch mode', sound?.classList.contains('is-visible'));
  const mutesBefore = calls.mute;
  sound.click();
  check('sound button toggles mute', calls.mute === mutesBefore + 1);
  ui.setMuted(true);
  check('muted state reaches the sound button', sound.getAttribute('aria-pressed') === 'true' && getComputedStyle(sound.querySelector('.tk-sound-off')).display !== 'none' && getComputedStyle(sound.querySelector('.tk-sound-on')).display === 'none');
  ui.setMuted(false);
  let guideTaps = 0;
  ui.onGuideToggle = () => guideTaps++;
  check('aim chip is tappable in touch mode', getComputedStyle(ui.$.aim).pointerEvents === 'auto');
  ui.$.aim.click();
  check('tapping the aim chip calls ui.onGuideToggle', guideTaps === 1);
  inputGate.paused = true;
  ui.$.aim.click();
  inputGate.paused = false;
  check('...but not while paused', guideTaps === 1);

  input.resetAim();
  const y0 = input.yaw;
  const p0 = input.pitch;
  pe(canvas, 'pointerdown', { pointerId: 9, clientX: 100, clientY: 400 });
  pe(canvas, 'pointermove', { pointerId: 9, clientX: 160, clientY: 360 });
  pe(canvas, 'pointerup', { pointerId: 9, clientX: 160, clientY: 360 });
  check('drag right aims right (yaw decreases)', input.yaw < y0, `${deg(input.yaw)}°`);
  check('drag up raises the arc', input.pitch > p0, `${deg(input.pitch)}°`);
  pe(canvas, 'pointerdown', { pointerId: 10, clientX: 0, clientY: 0 });
  pe(canvas, 'pointermove', { pointerId: 10, clientX: -5000, clientY: -5000 });
  pe(canvas, 'pointerup', { pointerId: 10 });
  check('drag clamps', near(input.yaw, THROW.yawRange, 1e-9) && near(input.pitch, THROW.maxPitch, 1e-9));
  inputGate.paused = true;
  pe(canvas, 'pointerdown', { pointerId: 11, clientX: 10, clientY: 10 });
  pe(canvas, 'pointerup', { pointerId: 11 });
  check('tap while paused resumes', calls.pause === 3);
  inputGate.paused = false;

  // dispose
  input.dispose();
  tap('KeyG');
  check('dispose removes listeners', calls.guide === 1);
  check('dispose removes touch controls', !document.querySelector('.tk-throw-btn') && !document.querySelector('.tk-pause-btn') && !document.querySelector('.tk-sound-btn'));

  // Victory card: a stray Space (the throw key) must never restart the run.
  const press = (code) => {
    const ev = new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return ev;
  };
  let choice = null;
  const opened = performance.now();
  ui.showVictory({ stats: { score: 200, shots: 30, makes: 20 } }).then((v) => (choice = v));
  const early = press('Space');
  await wait(20);
  check('Space in the first second is swallowed', early.defaultPrevented && choice === null);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // focus lands on the next frame
  const focusedAct = document.activeElement?.dataset?.act;
  check('victory card focuses "Keep playing"', focusedAct === 'endless', `focused=${focusedAct ?? document.activeElement?.tagName} after ${Math.round(performance.now() - opened)} ms`);
  await wait(1000);
  document.activeElement?.blur();
  press('Enter');
  await wait(20);
  check('Enter then picks "Keep playing", not a restart', choice === 'endless', `choice=${choice}`);
  choice = null;
  ui.showVictory({ stats: {} }).then((v) => (choice = v));
  await wait(1050);
  ui.$.victoryCard.querySelector('[data-act="again"]').focus();
  const onAgain = press('Enter');
  check('a focused "Play again" is left to activate natively', !onAgain.defaultPrevented && choice === null);
  ui.$.victoryCard.querySelector('[data-act="again"]').click();
  await wait(20);
  check('clicking "Play again" restarts', choice === 'again', `choice=${choice}`);
  ui.dispose();

  const passed = results.filter((r) => r.ok).length;
  out.innerHTML = `<b>ThrowInput synthetic tests: ${passed}/${results.length} passed</b>\n\n` +
    results.map((r) => `<span class="${r.ok ? 'pass' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'}</span>  ${r.name}${r.detail ? `  <i>(${r.detail})</i>` : ''}`).join('\n');
  log(`INPUT TESTS ${passed}/${results.length} passed`);
  for (const r of results) if (!r.ok) log(`INPUT FAIL: ${r.name} ${r.detail}`);
}

// ------------------------------------------------------------------ audio tests

async function runAudioTests() {
  out.classList.add('on');
  const cases = [
    ['crumple'], ['throw'],
    ['bounce', 'floor'], ['bounce', 'carpet'], ['bounce', 'wall'], ['bounce', 'glass'], ['bounce', 'furniture'], ['bounce', 'soft'], ['bounce', 'ball'],
    ['bounce', 'rim'], ['rim', 'metal'], ['rim', 'wicker'], ['binWall', 'metal'], ['binWall', 'wicker'], ['binIn', 'metal'], ['binIn', 'wicker'],
    ['score'], ['swish'], ['miss'], ['levelUp'], ['victory'], ['click'],
  ];
  const sr = 44100;
  const rows = [];
  let failures = 0;
  const html = [];

  for (const themeName of ['office', 'beach']) {
    for (const [name, material] of cases) {
      if (themeName === 'beach' && !['score', 'swish', 'levelUp', 'victory', 'rim', 'binIn'].includes(name)) continue;
      const dur = name === 'victory' ? 3.5 : name === 'levelUp' ? 2.5 : 1.4;
      const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
      const fx = new AudioFX();
      fx._theme = themeName; // chimes and bin materials follow the theme
      fx._attach(ctx);
      fx.play(name, { material, intensity: 1 });
      const buf = await ctx.startRendering();
      const st = analyze(buf);
      const bad = st.nan || st.peak > 1.0 || st.peak < 0.002 || st.first > 0.01 || st.last > 0.01 || st.jump > 0.5;
      if (bad) failures++;
      rows.push({ label: `${themeName}/${name}${material ? `:${material}` : ''}`, st, bad, buf });
    }
  }

  // Ambience beds: level, swell modulation, loop-safety.
  for (const themeName of ['office', 'beach']) {
    const dur = 20;
    const ctx = new OfflineAudioContext(2, sr * dur, sr);
    const fx = new AudioFX();
    fx._attach(ctx);
    fx.setAmbience(themeName);
    if (themeName === 'beach') fx._gulls(fx.ambBus, 6);
    const buf = await ctx.startRendering();
    const st = analyze(buf);
    const win = windowsRms(buf, 0.5).slice(8); // skip the fade-in
    const lo = Math.min(...win);
    const hi = Math.max(...win);
    const swing = 20 * Math.log10(hi / lo);
    const bad = st.nan || st.peak > 1 || st.rms < 0.003 || st.jump > 0.3;
    if (bad) failures++;
    rows.push({ label: `ambience/${themeName}`, st, bad, buf, extra: `swell ${swing.toFixed(1)} dB` });
  }

  html.push(`<b>AudioFX offline render: ${rows.length - failures}/${rows.length} clean</b>  (peak/rms dBFS, first/last sample, max jump)\n`);
  html.push('<div id="play"></div>');
  for (const r of rows) {
    const s = r.st;
    html.push(`<span class="${r.bad ? 'fail' : 'pass'}">${r.bad ? 'FAIL' : 'ok  '}</span> ${r.label.padEnd(24)} peak ${db(s.peak)}  rms ${db(s.rms)}  edges ${s.first.toFixed(4)}/${s.last.toFixed(4)}  jump ${s.jump.toFixed(3)}${s.nan ? '  NaN!' : ''}${r.extra ? '  ' + r.extra : ''}`);
    html.push(`<canvas data-i="${rows.indexOf(r)}" width="700" height="${r.label.startsWith('ambience') ? 60 : 36}"></canvas>`);
  }
  out.innerHTML = html.join('\n');
  for (const c of out.querySelectorAll('canvas')) drawWave(c, rows[Number(c.dataset.i)].buf);

  // Live buttons for a human with speakers.
  const live = new AudioFX();
  const play = out.querySelector('#play');
  const addBtn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      live.unlock();
      fn();
    };
    play.appendChild(b);
  };
  for (const [name, material] of cases) addBtn(`${name}${material ? ':' + material : ''}`, () => live.play(name, { material }));
  addBtn('ambience: office', () => live.setAmbience('office'));
  addBtn('ambience: beach', () => live.setAmbience('beach'));
  addBtn('ambience: off', () => live.setAmbience(null));
  addBtn('mute toggle', () => live.setMuted(!live.muted));
  live.play('click'); // before unlock: must be a silent no-op
  live.setAmbience('office');

  log(`AUDIO TESTS ${rows.length - failures}/${rows.length} clean`);
  if (q.get('verbose') === '1') {
    for (const r of rows) log(`AUDIO ${r.label} peak ${db(r.st.peak)} rms ${db(r.st.rms)} jump ${r.st.jump.toFixed(3)} ${r.extra ?? ''}`);
  }
  for (const r of rows) if (r.bad) log(`AUDIO FAIL: ${r.label} peak=${r.st.peak.toFixed(3)} first=${r.st.first} last=${r.st.last} jump=${r.st.jump}`);
}

function analyze(buf) {
  let peak = 0;
  let sum = 0;
  let n = 0;
  let nan = false;
  let jump = 0;
  let first = 0;
  let last = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    first = Math.max(first, Math.abs(d[0]));
    last = Math.max(last, Math.abs(d[d.length - 1]));
    let prev = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) {
        nan = true;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      n++;
      jump = Math.max(jump, Math.abs(v - prev));
      prev = v;
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, n)), nan, jump, first, last };
}

function windowsRms(buf, seconds) {
  const d = buf.getChannelData(0);
  const w = Math.floor(buf.sampleRate * seconds);
  const res = [];
  for (let i = 0; i + w <= d.length; i += w) {
    let s = 0;
    for (let k = i; k < i + w; k++) s += d[k] * d[k];
    res.push(Math.sqrt(s / w) + 1e-9);
  }
  return res;
}

function db(v) {
  return `${(20 * Math.log10(v + 1e-12)).toFixed(1).padStart(6)}`;
}

function drawWave(canvas, buf) {
  const g = canvas.getContext('2d');
  const d = buf.getChannelData(0);
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = '#5fe0cf';
  const per = Math.ceil(d.length / w);
  for (let x = 0; x < w; x++) {
    let mx = 0;
    for (let k = x * per; k < Math.min(d.length, (x + 1) * per); k++) mx = Math.max(mx, Math.abs(d[k]));
    const bh = Math.max(1, mx * h);
    g.fillRect(x, (h - bh) / 2, 1, bh);
  }
}

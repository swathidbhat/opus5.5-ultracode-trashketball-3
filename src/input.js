import { THROW } from './config.js';

// Throw controls: pointer lock (primary), relative drag + on-screen button (touch / no lock), keyboard.
// Aim (yaw + launch pitch) with the mouse; hold the button and pull back to set power; release to throw.
// Touch: hold the throw button and slide up for power (it sits at the bottom, so all the free travel is
// upward); letting go after sliding sideways off it cancels. The HUD power meter can also be dragged.

const TOUCH_YAW_SENS = 0.0048; // radians per CSS pixel of drag
const TOUCH_PITCH_SENS = 0.0042;
const KEY_YAW_RATE = (16 * Math.PI) / 180; // radians per second for held arrow / WASD keys
const KEY_PITCH_RATE = (14 * Math.PI) / 180;
const KEY_FAST = 2.6; // Shift multiplier
const MAX_MOUSE_JUMP = 160; // px; Chrome occasionally reports huge movementX right after locking
const ESC_UNLOCK_WINDOW = 450; // ms; an Escape keydown this close to an unlock was the unlock itself
const TOUCH_CANCEL_PX = 70; // sideways travel from the press point past which letting go cancels the throw

const AIM_KEYS = {
  ArrowLeft: [1, 0],
  KeyA: [1, 0],
  ArrowRight: [-1, 0],
  KeyD: [-1, 0],
  ArrowUp: [0, 1],
  KeyW: [0, 1],
  ArrowDown: [0, -1],
  KeyS: [0, -1],
};

/**
 * State shared with the UI module. The UI raises `modal` while a card, menu or loading veil is up,
 * and `paused` while the pause overlay shows, so gameplay input stays inert without main.js wiring.
 */
export const inputGate = { modal: false, paused: false };

let activeInput = null;
let expectedUnlockUntil = 0;

/** Ask the active ThrowInput to capture the pointer. Call from inside a user-gesture handler. */
export function requestGameLock() {
  activeInput?.requestLock();
}

/** Release pointer lock without it being treated as the player pausing (Esc). */
export function releaseGameLock() {
  if (!document.pointerLockElement) return;
  expectedUnlockUntil = performance.now() + 1500;
  document.exitPointerLock?.();
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function isEditable(target) {
  if (!target || !(target instanceof Element)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export class ThrowInput {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onThrow?: (power01: number) => void, onChargeStart?: () => void, onToggleGuide?: () => void,
   *   onTogglePause?: () => void, onToggleMute?: () => void, onFirstGesture?: () => void }} handlers
   */
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.handlers = handlers;
    this.yaw = 0;
    this.pitch = THROW.defaultPitch;
    this.power = THROW.defaultPower;
    this.charging = false;
    this.enabled = true;
    this.locked = false;
    this.maxPitch = THROW.maxPitch; // levels with low ceilings lower this

    this._lockApi = typeof canvas.requestPointerLock === 'function';
    const coarseOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
    /** 'lock' = pointer lock + mouse, 'touch' = relative drag + on-screen throw button. */
    this.mode = this._lockApi && !coarseOnly ? 'lock' : 'touch';

    this._keys = new Set();
    this._chargeSource = null;
    this._btnY = 0;
    this._btnX0 = 0;
    this._btnCancel = false; // the finger is far enough sideways that letting go cancels
    this._drag = null;
    this._meter = null; // touch drag on the HUD power meter
    this._lockFailures = 0;
    this._lastUnlockAt = -1e9;
    this._gestureDone = false;
    this._shown = { touch: null, throwBtn: null, pauseBtn: null, lock: null, pressed: null, cancel: null, p: -1 };

    this._prevTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';

    this._ac = new AbortController();
    const opt = { signal: this._ac.signal };
    const on = (target, type, fn, extra) => target.addEventListener(type, fn, { ...opt, ...extra });

    this._host = document.getElementById('ui-root') ?? document.body;
    this._buildControls(on);

    on(canvas, 'pointerdown', (e) => this._onCanvasDown(e));
    on(this._host, 'pointerdown', (e) => this._onMeterDown(e));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'wheel', (e) => this._onWheel(e), { passive: false });
    // Right button while winding up cancels the throw. mousedown, because a second button pressed
    // during a held one only produces a pointermove.
    on(document, 'mousedown', (e) => {
      if (e.button === 2 && this._chargeSource === 'mouse') this._cancelCharge();
    });
    on(window, 'pointermove', (e) => this._onPointerMove(e));
    on(window, 'pointerup', (e) => this._onPointerUp(e));
    on(window, 'pointercancel', (e) => this._onPointerUp(e, true));
    on(document, 'mousemove', (e) => this._onMouseMove(e));
    on(document, 'pointerlockchange', () => this._onLockChange());
    on(document, 'pointerlockerror', () => this._onLockError());
    on(window, 'keydown', (e) => this._onKeyDown(e));
    on(window, 'keyup', (e) => this._onKeyUp(e));
    on(window, 'blur', () => {
      this._keys.clear();
      this._cancelCharge();
    });

    // Audio can only start from an activation-granting event: mouse pointerdown, touch pointerup, keydown.
    const gesture = (e) => {
      if (this._gestureDone) return;
      if (e.type === 'keydown' && (e.key === 'Escape' || e.repeat)) return;
      if (e.type === 'pointerdown' && e.pointerType !== 'mouse') return;
      this._gestureDone = true;
      this.handlers.onFirstGesture?.();
    };
    for (const type of ['pointerdown', 'pointerup', 'keydown', 'touchend']) on(window, type, gesture, { capture: true });

    activeInput = this;
    this._syncControls();
  }

  /** Enable or disable gameplay input. Disabling cancels a charge in progress without throwing. */
  setEnabled(enabled) {
    enabled = !!enabled;
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this._cancelCharge();
      this._drag = null;
      this._endMeterDrag();
    }
    this._syncControls();
  }

  resetAim() {
    this.yaw = 0;
    this.pitch = THROW.defaultPitch;
    this.power = THROW.defaultPower;
  }

  /** True while the game wants a click to capture the mouse (lock mode, not yet locked). */
  get needsLock() {
    return this.mode === 'lock' && !this.locked;
  }

  /** Apply held aim keys (Up/Down set power instead of pitch while winding up). */
  update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    if (this._keys.size && this._active()) {
      let dy = 0;
      let dp = 0;
      for (const code of this._keys) {
        const k = AIM_KEYS[code];
        if (k) {
          dy += k[0];
          dp += k[1];
        }
      }
      const fast = this._keys.has('ShiftLeft') || this._keys.has('ShiftRight') ? KEY_FAST : 1;
      if (this.charging && dp) {
        this._setPower(this.power + Math.sign(dp) * THROW.keyPowerRate * fast * dt);
        dp = 0;
      }
      if (dy || dp) this._setAim(this.yaw + Math.sign(dy) * KEY_YAW_RATE * fast * dt, this.pitch + Math.sign(dp) * KEY_PITCH_RATE * fast * dt);
    }
    this._syncControls();
  }

  /** Capture the mouse (lock mode only). Safe to call repeatedly; failures are handled via pointerlockerror. */
  requestLock() {
    if (this.mode !== 'lock' || !this._lockApi || document.pointerLockElement === this.canvas) return;
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // pointerlockerror handles the fallback
    }
  }

  dispose() {
    this._ac.abort();
    this._cancelCharge();
    if (document.pointerLockElement === this.canvas) releaseGameLock();
    this._endMeterDrag();
    this._throwBtn.remove();
    this._pauseBtn.remove();
    this._soundBtn.remove();
    this._lockPrompt.remove();
    this._host.classList.remove('tk-touch-mode');
    this.canvas.style.touchAction = this._prevTouchAction;
    if (activeInput === this) activeInput = null;
  }

  // ---------------------------------------------------------------- internals

  /** Gameplay input (aim, charge) is live. Pause/mute/guide toggles bypass this. */
  _active() {
    return this.enabled && !inputGate.modal && !inputGate.paused;
  }

  _setAim(yaw, pitch) {
    this.yaw = clamp(yaw, -THROW.yawRange, THROW.yawRange);
    this.pitch = clamp(pitch, THROW.minPitch, this.maxPitch);
  }

  _setPower(power) {
    this.power = clamp(power, 0, 1);
  }

  _startCharge(source) {
    if (this.charging || !this._active()) return;
    this.charging = true;
    this._chargeSource = source;
    this.handlers.onChargeStart?.();
  }

  _releaseCharge(source) {
    if (!this.charging || this._chargeSource !== source) return;
    const power = this.power;
    const live = this._active();
    this._cancelCharge();
    if (live) this.handlers.onThrow?.(power);
  }

  /** Stop winding up without throwing. The power setting is kept for the next attempt. */
  _cancelCharge() {
    this.charging = false;
    this._chargeSource = null;
    this._btnCancel = false;
  }

  _togglePause() {
    this._cancelCharge();
    this.handlers.onTogglePause?.();
  }

  _setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this._drag = null;
    if (mode === 'touch' && this.locked) releaseGameLock();
    if (mode !== 'touch') this._endMeterDrag();
    this._syncControls();
  }

  _onCanvasDown(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') this._setMode('touch');
    else if (this.mode === 'touch' && this._lockApi && this._lockFailures < 2) this._setMode('lock');

    if (inputGate.modal) return;
    if (inputGate.paused) {
      // Click / tap anywhere resumes; in lock mode the same click recaptures the mouse.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      this._togglePause();
      this.requestLock();
      return;
    }

    if (this.mode === 'lock') {
      if (e.button !== 0) return;
      // The click that captures the mouse never starts a charge.
      if (!this.locked) this.requestLock();
      else this._startCharge('mouse');
      return;
    }

    if (!this.enabled || this._drag) return;
    this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // capture is a nicety; window listeners still see the moves
    }
  }

  _onPointerMove(e) {
    const meter = this._meter;
    if (meter && e.pointerId === meter.id) {
      // Relative drag, geared 1:1 with the meter's track so the fill moves with the finger (up = more).
      if (this._active()) this._setPower(this.power + (meter.y - e.clientY) / meter.span);
      meter.y = e.clientY;
      return;
    }
    const drag = this._drag;
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (this._active()) this._setAim(this.yaw - dx * TOUCH_YAW_SENS, this.pitch - dy * TOUCH_PITCH_SENS);
  }

  _onPointerUp(e, cancelled = false) {
    if (this._drag && e.pointerId === this._drag.id) this._drag = null;
    if (this._meter && e.pointerId === this._meter.id) this._endMeterDrag();
    if (e.pointerType === 'mouse' && e.button === 0 && this._chargeSource === 'mouse') {
      if (cancelled) this._cancelCharge();
      else this._releaseCharge('mouse');
    }
  }

  /** Touch mode: grabbing the HUD power meter sets power without winding up a throw. */
  _onMeterDown(e) {
    const el = e.target instanceof Element ? e.target.closest('.tk-power') : null;
    if (!el || this.mode !== 'touch' || this._meter || !this._active()) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // window listeners still see the moves
    }
    const track = el.querySelector('.tk-power-track')?.getBoundingClientRect().height;
    this._meter = { id: e.pointerId, y: e.clientY, span: Math.max(track || 0, 120), el };
    el.classList.add('is-grabbed');
  }

  _endMeterDrag() {
    if (!this._meter) return;
    this._meter.el.classList.remove('is-grabbed');
    this._meter = null;
  }

  _onMouseMove(e) {
    if (!this.locked || !this._active()) return;
    const mx = clamp(e.movementX || 0, -MAX_MOUSE_JUMP, MAX_MOUSE_JUMP);
    const my = clamp(e.movementY || 0, -MAX_MOUSE_JUMP, MAX_MOUSE_JUMP);
    const s = THROW.mouseSensitivity;
    if (this.charging) {
      // Winding up: pulling back (down) adds power, pushing forward takes it away. Yaw still steers.
      this._setAim(this.yaw - mx * s, this.pitch);
      this._setPower(this.power + my / THROW.pullPixels);
    } else {
      this._setAim(this.yaw - mx * s, this.pitch - my * s);
    }
  }

  _onWheel(e) {
    e.preventDefault();
    if (!this._active() || !e.deltaY) return;
    // Wheel up = more power. One notch is ~100 px in pixel mode, 1-3 in line mode.
    const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
    this._setPower(this.power - clamp(notches, -3, 3) * THROW.wheelStep);
  }

  _onLockChange() {
    const locked = document.pointerLockElement === this.canvas;
    if (locked === this.locked) return;
    this.locked = locked;
    if (locked) {
      this._lockFailures = 0;
      this._syncControls();
      return;
    }
    const now = performance.now();
    this._lastUnlockAt = now;
    if (this._chargeSource === 'mouse') this._cancelCharge();
    const expected = now < expectedUnlockUntil;
    expectedUnlockUntil = 0;
    // An unlock nobody asked for is the player pressing Esc (or leaving the tab): pause.
    if (!expected && !inputGate.modal && !inputGate.paused) this._togglePause();
    this._syncControls();
  }

  _onLockError() {
    // Chrome refuses re-locking for ~1 s after an Esc unlock; only count failures outside that window.
    if (performance.now() - this._lastUnlockAt < 1600) return;
    this._lockFailures++;
    if (this._lockFailures >= 2) this._setMode('touch');
  }

  _onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    const code = e.code;
    switch (code) {
      case 'KeyM':
        if (!e.repeat) this.handlers.onToggleMute?.();
        return;
      case 'KeyG':
        if (!e.repeat && !inputGate.modal) this.handlers.onToggleGuide?.();
        return;
      case 'KeyP':
      case 'Escape': {
        if (e.repeat || inputGate.modal) return;
        // With the mouse captured, Esc is consumed by the browser's unlock (handled in _onLockChange).
        if (code === 'Escape' && (this.locked || performance.now() - this._lastUnlockAt < ESC_UNLOCK_WINDOW)) return;
        e.preventDefault();
        const resuming = inputGate.paused;
        this._togglePause();
        if (resuming && code === 'KeyP') this.requestLock();
        return;
      }
      case 'Space':
        if (inputGate.modal) return; // let the focused menu button have it
        e.preventDefault();
        if (!e.repeat) this._startCharge('key');
        return;
      case 'ShiftLeft':
      case 'ShiftRight':
        this._keys.add(code);
        return;
      default:
        if (AIM_KEYS[code] && !inputGate.modal) {
          e.preventDefault();
          this._keys.add(code);
        }
    }
  }

  _onKeyUp(e) {
    this._keys.delete(e.code);
    if (e.code === 'Space') this._releaseCharge('key');
  }

  // ---------------------------------------------------------------- on-screen controls

  _buildControls(on) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tk-throw-btn';
    btn.setAttribute('aria-label', 'Throw: hold and slide up to add power, release to throw. Slide sideways off it before letting go to cancel.');
    btn.innerHTML =
      '<span class="tk-throw-ring" aria-hidden="true"></span>' +
      '<span class="tk-throw-core" aria-hidden="true"><span class="tk-throw-label">Hold</span><span class="tk-throw-sub">slide up for power</span></span>';
    this._throwBtn = btn;
    this._throwLabel = btn.querySelector('.tk-throw-label');
    this._throwSub = btn.querySelector('.tk-throw-sub');

    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'tk-pause-btn';
    pause.setAttribute('aria-label', 'Pause');
    pause.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/></svg>';
    this._pauseBtn = pause;

    // Stands in for the M key. ui.setMuted() marks the root .tk-muted, which swaps the icon.
    const sound = document.createElement('button');
    sound.type = 'button';
    sound.className = 'tk-sound-btn';
    sound.setAttribute('aria-label', 'Mute');
    sound.setAttribute('aria-pressed', 'false');
    sound.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3.5 9.5h3.5L11.5 5.5v13l-4.5-4H3.5z" fill="currentColor" stroke="none"/>' +
      '<path class="tk-sound-on" d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.6a7.6 7.6 0 0 1 0 10.8"/>' +
      '<path class="tk-sound-off" d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg>';
    this._soundBtn = sound;

    on(btn, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // not fatal: pointerup still reaches the button in practice
      }
      this._btnY = e.clientY;
      this._btnX0 = e.clientX;
      this._btnCancel = false;
      this._startCharge('button');
    });
    on(btn, 'pointermove', (e) => {
      if (this._chargeSource !== 'button' || !this._active()) return;
      this._btnCancel = Math.abs(e.clientX - this._btnX0) > TOUCH_CANCEL_PX;
      // Slide up to add power, down to reduce it. Power holds still while the finger is out in the cancel zone.
      if (!this._btnCancel) this._setPower(this.power + (this._btnY - e.clientY) / THROW.touchPullPixels);
      this._btnY = e.clientY;
    });
    on(btn, 'pointerup', (e) => {
      e.stopPropagation();
      if (this._chargeSource !== 'button') return;
      if (this._btnCancel) this._cancelCharge();
      else this._releaseCharge('button');
    });
    on(btn, 'pointercancel', () => {
      if (this._chargeSource === 'button') this._cancelCharge();
    });
    on(btn, 'contextmenu', (e) => e.preventDefault());
    on(pause, 'click', (e) => {
      e.stopPropagation();
      if (!inputGate.modal) this._togglePause();
    });
    on(sound, 'click', (e) => {
      e.stopPropagation();
      this.handlers.onToggleMute?.();
    });

    // Shown in lock mode whenever the mouse is not captured (e.g. after Esc), so the next click's purpose is clear.
    const prompt = document.createElement('div');
    prompt.className = 'tk-lock-prompt';
    prompt.setAttribute('aria-hidden', 'true');
    prompt.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
      '<rect x="6.5" y="3.5" width="11" height="17" rx="5.5"/><path d="M12 7v3.2"/></svg>' +
      '<span>Click to take aim</span>';
    this._lockPrompt = prompt;

    this._host.append(btn, pause, sound, prompt);
  }

  _syncControls() {
    const touch = this.mode === 'touch';
    const showThrow = touch && this.enabled && !inputGate.modal && !inputGate.paused;
    const showPause = touch && !inputGate.modal && !inputGate.paused;
    const pressed = this._chargeSource === 'button' && this.charging;
    const cancel = pressed && this._btnCancel;
    // Hidden while a keyboard player winds up: they are playing without the mouse and need the view clear.
    const keyCharge = this.charging && this._chargeSource === 'key';
    const showLock = this.mode === 'lock' && !this.locked && this.enabled && !inputGate.modal && !inputGate.paused && !keyCharge;
    const s = this._shown;
    if (s.lock !== showLock) {
      s.lock = showLock;
      this._lockPrompt.classList.toggle('is-visible', showLock);
    }
    if (s.touch !== touch) {
      s.touch = touch;
      this._host.classList.toggle('tk-touch-mode', touch);
    }
    if (s.throwBtn !== showThrow) {
      s.throwBtn = showThrow;
      this._throwBtn.classList.toggle('is-visible', showThrow);
    }
    if (s.pauseBtn !== showPause) {
      s.pauseBtn = showPause;
      this._pauseBtn.classList.toggle('is-visible', showPause);
      this._soundBtn.classList.toggle('is-visible', showPause);
    }
    if (s.pressed !== pressed || s.cancel !== cancel) {
      s.pressed = pressed;
      s.cancel = cancel;
      this._throwBtn.classList.toggle('is-pressed', pressed && !cancel);
      this._throwBtn.classList.toggle('is-cancel', cancel);
      this._throwLabel.textContent = cancel ? 'Cancel' : pressed ? 'Release' : 'Hold';
      this._throwSub.textContent = cancel ? 'on release' : pressed ? 'slide off to cancel' : 'slide up for power';
    }
    const p = Math.round(this.power * 200) / 200;
    if (s.p !== p) {
      s.p = p;
      this._throwBtn.style.setProperty('--p', String(p));
    }
  }
}

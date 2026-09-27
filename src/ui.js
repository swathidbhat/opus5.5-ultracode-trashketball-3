import { inputGate, requestGameLock, releaseGameLock } from './input.js';

// DOM overlay: HUD, menus and cards. Everything is built inside the root element; styling lives in
// styles.css and is driven by `data-tk-theme` on the root ('office' | 'beach').

const EMBLEMS = {
  // Globe of stacked latitude lenses, in the spirit of a certain severed-floor employer.
  office: `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round">
    <circle cx="32" cy="32" r="28" stroke-width="2.4"/>
    <ellipse cx="32" cy="32" rx="28" ry="7.5" stroke-width="1.8"/>
    <ellipse cx="32" cy="32" rx="28" ry="16" stroke-width="1.5" opacity=".8"/>
    <ellipse cx="32" cy="32" rx="28" ry="23.5" stroke-width="1.2" opacity=".55"/>
    <path d="M32 4v56" stroke-width="1.2" opacity=".45"/>
  </svg>`,
  // Sun over the swell.
  beach: `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="32" cy="32" r="28" stroke-width="2"/>
    <path d="M19.5 36a12.5 12.5 0 0 1 25 0" stroke-width="2.2"/>
    <path d="M32 15.5v4M20.2 20.6l2.8 2.8M43.8 20.6l-2.8 2.8M14.5 30h3.8M45.7 30h3.8" stroke-width="1.8"/>
    <path d="M10.5 41.5c3.6-2.6 7.2-2.6 10.8 0s7.2 2.6 10.8 0 7.2-2.6 10.8 0 7.2 2.6 10.8 0" stroke-width="2"/>
    <path d="M15 48.5c2.9-2 5.8-2 8.6 0s5.8 2 8.6 0 5.8-2 8.6 0 5.8 2 8.6 0" stroke-width="1.8" opacity=".7"/>
  </svg>`,
};

const MUTE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`;

// What the title screen lists before a level has been built (the levels report their own names on load).
const DEFAULT_LEVELS = [
  { name: 'Macrodata Refinement', subtitle: 'Lumon Industries · Severed Floor', goal: 100 },
  { name: 'Casa Marea', subtitle: 'Oceanfront Airbnb · Golden Hour', goal: 200 },
];

const COPY = {
  office: {
    eyebrow: 'An approved recreational activity',
    tagline: 'The work is mysterious and important.',
    introFlavor: 'Please enjoy each paper ball equally.',
    completeEyebrow: 'Quota met',
    completeLine: 'Your outie would be proud.',
    completeSub: 'A waffle party is under consideration.',
    victoryEyebrow: 'Refinement complete',
    victoryTitle: 'The Board is pleased.',
    victoryLine: 'Every file refined. Every bin fed. Please proceed to the exit.',
    pauseLine: 'Enjoy this mandated wellness break.',
    loading: 'Refining',
  },
  beach: {
    eyebrow: 'An oceanfront paper toss',
    tagline: 'Ocean views. Impeccable aim.',
    introFlavor: 'Check-in complete. Mind the linen.',
    completeEyebrow: 'Well played',
    completeLine: 'Five-star aim.',
    completeSub: 'Housekeeping has been notified.',
    victoryEyebrow: 'Checkout complete',
    victoryTitle: 'A perfect stay.',
    victoryLine: 'Two workplaces. Two hundred points. Not a scrap left on the floor.',
    pauseLine: 'The tide will wait.',
    loading: 'Preparing your stay',
  },
};

const STAT_LABELS = [
  ['score', 'Score'],
  ['shots', 'Shots'],
  ['makes', 'Makes'],
  ['accuracy', 'Accuracy'],
  ['bestStreak', 'Best streak'],
  ['swishes', 'Swishes'],
  ['time', 'Time'],
];

const INTRO_MS = 2600;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad2 = (n) => String(n + 1).padStart(2, '0');
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Escape text, turning `[Key]` tokens into <kbd> chips. */
function richText(text) {
  return esc(text).replace(/\[([^\]]{1,14})\]/g, '<kbd>$1</kbd>');
}

function detectTouch() {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class UI {
  /**
   * @param {HTMLElement} [root] container to build into (defaults to #ui-root, then body)
   * @param {{ touch?: boolean }} [options] force the touch or keyboard controls legend
   */
  constructor(root = document.getElementById('ui-root') ?? document.body, options = {}) {
    this.root = root;
    this.theme = 'office';
    this.touch = options.touch ?? detectTouch();
    this._levels = DEFAULT_LEVELS.map((l) => ({ ...l }));
    this._screens = new Map(); // open modal screens -> { close }
    this._loading = false;
    this._paused = false;
    this._score = { value: null, shown: 0, raf: 0 };
    this._cache = {};
    /** Optional: called when the player taps the aim chip (touch mode) to switch the full trajectory guide. */
    this.onGuideToggle = null;

    root.classList.add('tk-root');
    const el = document.createElement('div');
    el.className = 'tk-ui';
    el.innerHTML = this._template();
    root.appendChild(el);
    this.el = el;
    this.$ = {};
    for (const node of el.querySelectorAll('[data-ref]')) this.$[node.dataset.ref] = node;

    this._fillNumbers();
    this._onKey = (e) => this._routeKey(e);
    window.addEventListener('keydown', this._onKey, true);
    // The aim chip only takes pointer events in touch mode (styles.css), where it stands in for the G key.
    this._onAimClick = (e) => {
      e.stopPropagation();
      if (!inputGate.modal && !inputGate.paused) this.onGuideToggle?.();
    };
    this.$.aim.addEventListener('click', this._onAimClick);

    this.setTheme('office');
    this.setScore(0, 0, DEFAULT_LEVELS[0].goal);
    this.setStats({ shots: 0, makes: 0, streak: 0 });
    this.setAim({ pitchDeg: 30, guideFull: false });
    this.setHint('');
  }

  // ---------------------------------------------------------------- HUD

  /** @param {'office' | 'beach'} theme */
  setTheme(theme) {
    theme = theme === 'beach' ? 'beach' : 'office';
    this.theme = theme;
    this.root.dataset.tkTheme = theme;
    for (const node of this.el.querySelectorAll('.tk-emblem')) node.innerHTML = EMBLEMS[theme];
    this._renderScore(this._score.shown);
    this._renderStartCopy();
  }

  setLevel(index, name, subtitle) {
    this._rememberLevel(index, { name, subtitle });
    const total = Math.max(this._levels.length, index + 1);
    this.$.levelNum.textContent = pad2(index);
    this.$.levelTotal.textContent = pad2(total - 1);
    this.$.levelName.textContent = name ?? '';
    this.$.levelSub.textContent = subtitle ?? '';
  }

  /** Score plus progress from `levelStartScore` toward `levelTargetScore` (non-finite target = endless). */
  setScore(score, levelStartScore = 0, levelTargetScore = 100) {
    const key = `${score}|${levelStartScore}|${levelTargetScore}`;
    if (this._cache.score === key) return;
    this._cache.score = key;

    const endless = !Number.isFinite(levelTargetScore) || levelTargetScore <= levelStartScore;
    const frac = endless ? 1 : clamp01((score - levelStartScore) / (levelTargetScore - levelStartScore));
    this.$.progFill.style.transform = `scaleX(${frac})`;
    this.$.progText.textContent = endless ? `${score}` : `${score} / ${levelTargetScore}`;
    this.$.progPct.textContent = endless ? 'Endless' : `${Math.round(frac * 100)}%`;
    this.$.progress.classList.toggle('is-endless', endless);
    this.$.progress.classList.toggle('is-full', !endless && frac >= 1);

    const s = this._score;
    const prev = s.value;
    s.value = score;
    cancelAnimationFrame(s.raf);
    if (prev === null || score <= prev || reducedMotion()) {
      this._renderScore(score);
      return;
    }
    // Count up and give the number a little bump.
    const from = s.shown;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 420);
      this._renderScore(Math.round(from + (score - from) * (1 - (1 - k) ** 3)));
      if (k < 1) s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
    this._retrigger(this.$.scoreValue, 'is-bump');
  }

  setStats({ shots = 0, makes = 0, streak = 0 } = {}) {
    const key = `${shots}|${makes}|${streak}`;
    if (this._cache.stats === key) return;
    this._cache.stats = key;
    this.$.statShots.textContent = shots;
    this.$.statMakes.textContent = makes;
    this.$.statAcc.textContent = shots > 0 ? `${Math.round((makes / shots) * 100)}%` : '—';
    this.$.statStreak.textContent = streak > 0 ? `×${streak}` : '0';
    const hot = streak >= 3;
    this.$.streakCell.classList.toggle('is-hot', hot);
    if (hot && streak > (this._cache.streak ?? 0)) this._retrigger(this.$.statStreak, 'is-bump');
    this._cache.streak = streak;
  }

  /**
   * @param {number} power01
   * @param {boolean} visible  meter shown (the whole time the player is aiming)
   * @param {boolean} [active] the player is winding up right now (highlights the meter and reticle)
   */
  setPower(power01, visible, active = visible) {
    visible = !!visible;
    active = visible && !!active;
    if (this._cache.powerVisible !== visible) {
      this._cache.powerVisible = visible;
      this.$.power.classList.toggle('is-visible', visible);
    }
    if (this._cache.powerActive !== active) {
      this._cache.powerActive = active;
      this.$.power.classList.toggle('is-active', active);
      this.$.reticle.classList.toggle('is-charging', active);
    }
    if (!visible) return;
    const p = Math.round(clamp01(power01 || 0) * 1000) / 1000;
    if (this._cache.power === p) return;
    this._cache.power = p;
    this.$.power.style.setProperty('--p', p);
    this.$.reticle.style.setProperty('--p', p);
    this.$.powerValue.textContent = Math.round(p * 100);
  }

  setAim({ pitchDeg = 0, guideFull = false } = {}) {
    const deg = Math.round(pitchDeg);
    if (this._cache.pitch !== deg) {
      this._cache.pitch = deg;
      this.$.aimAngle.textContent = `${deg}°`;
      this.$.aimArc.style.setProperty('--a', `${-deg}deg`);
    }
    if (this._cache.guide !== guideFull) {
      this._cache.guide = guideFull;
      this.$.aimGuide.textContent = guideFull ? 'Full' : 'Short';
      this.$.aim.classList.toggle('is-full', !!guideFull);
      this.$.aim.setAttribute('aria-pressed', String(!!guideFull));
    }
  }

  /** Optional (not in the contract): show a muted indicator in the aim chip and on the touch sound button. */
  setMuted(muted) {
    muted = !!muted;
    this.$.aim.classList.toggle('is-muted', muted);
    // The touch sound button belongs to input.js; it styles itself from this root class.
    this.root.classList.toggle('tk-muted', muted);
    this.root.querySelector('.tk-sound-btn')?.setAttribute('aria-pressed', String(muted));
  }

  /**
   * Transient centered callout.
   * @param {string} text  e.g. 'SWISH! +10', '+10', 'Rim out', 'Miss'
   * @param {'score'|'swish'|'miss'|'rim'|'info'} [kind]
   */
  flash(text, kind = 'info') {
    const box = this.$.flashes;
    const el = document.createElement('div');
    el.className = `tk-flash tk-flash--${esc(kind)}`;
    const m = String(text).match(/^(.*?)\s*([+\-−]\s?\d+)$/);
    const word = m ? m[1] : String(text);
    const pts = m ? m[2] : '';
    el.innerHTML =
      (kind === 'swish' ? '<span class="tk-flash-burst" aria-hidden="true"></span>' : '') +
      (word ? `<span class="tk-flash-word">${esc(word)}</span>` : '') +
      (pts ? `<span class="tk-flash-pts">${esc(pts)}</span>` : '');
    if (!word) el.classList.add('is-points-only');
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    const done = () => el.remove();
    el.addEventListener('animationend', (e) => e.target === el && done());
    setTimeout(done, 2600);
  }

  /** Bottom hint line; '' hides it. `[Key]` renders as a key cap. */
  setHint(text) {
    text = text ?? '';
    if (this._cache.hint === text) return;
    this._cache.hint = text;
    if (text) this.$.hint.innerHTML = richText(text);
    this.$.hint.classList.toggle('is-hidden', !text);
  }

  // ---------------------------------------------------------------- screens

  /** Title screen. Resolves on click / tap / Enter. */
  showStart({ levels } = {}) {
    if (Array.isArray(levels)) levels.forEach((l, i) => this._rememberLevel(i, l));
    this._renderStartLevels();
    this.$.startControls.innerHTML = this._controlsMarkup();
    this.$.startCta.textContent = this.touch ? 'Tap to play' : 'Click to play';
    return this._open('start', (finish) => {
      const onClick = () => {
        requestGameLock();
        finish();
      };
      this.$.start.addEventListener('click', onClick);
      return { primary: onClick, cleanup: () => this.$.start.removeEventListener('click', onClick), focus: this.$.startCta };
    });
  }

  /**
   * Level card; auto-dismisses after `duration` ms (default 2.6 s) or on click / key.
   * `duration` is optional and not in the contract; pass Infinity to hold the card until dismissed.
   */
  showLevelIntro({ index = 0, name, subtitle, goal, duration = INTRO_MS } = {}) {
    // `goal` may be a sentence from the game; only a number is the level's point target.
    this._rememberLevel(index, { name, subtitle, goal: typeof goal === 'number' ? goal : undefined });
    const copy = COPY[this.theme];
    const total = Math.max(this._levels.length, index + 1);
    const goalText = typeof goal === 'number' ? `Reach ${goal} points` : goal || `Reach ${this._levels[index]?.goal ?? 100} points`;
    this.$.introCard.innerHTML = `
      <div class="tk-emblem tk-emblem--md">${EMBLEMS[this.theme]}</div>
      <div class="tk-eyebrow">Level ${pad2(index)} <span class="tk-dim">/ ${pad2(total - 1)}</span></div>
      <h2 class="tk-card-title">${esc(name)}</h2>
      ${subtitle ? `<p class="tk-card-sub">${esc(subtitle)}</p>` : ''}
      <div class="tk-rule" aria-hidden="true"></div>
      <div class="tk-goal"><span class="tk-goal-label">Goal</span><span class="tk-goal-value">${esc(goalText)}</span></div>
      <p class="tk-flavor">${esc(copy.introFlavor)}</p>
      ${Number.isFinite(duration) ? `<div class="tk-intro-timer" aria-hidden="true"><span style="animation-duration:${duration}ms"></span></div>` : ''}`;
    return this._open('intro', (finish) => {
      const opened = performance.now();
      const timer = Number.isFinite(duration) ? setTimeout(finish, duration) : 0;
      // Any click dismisses it (even one aimed at the locked canvas); ignore the click that opened it.
      const onClick = (e) => {
        if (performance.now() - opened < 300) return;
        e.stopPropagation();
        finish();
      };
      window.addEventListener('click', onClick, true);
      return {
        primary: finish,
        cancelKey: true,
        cleanup: () => {
          clearTimeout(timer);
          window.removeEventListener('click', onClick, true);
        },
      };
    });
  }

  /** Level-complete card with stats. Resolves on "Continue". */
  showLevelComplete({ index = 0, name, stats = {}, nextName } = {}) {
    const copy = COPY[this.theme];
    this.$.completeCard.innerHTML = `
      <div class="tk-emblem tk-emblem--md">${EMBLEMS[this.theme]}</div>
      <div class="tk-eyebrow">${esc(copy.completeEyebrow)} <span class="tk-dim">· Level ${pad2(index)}</span></div>
      <h2 class="tk-card-title">${esc(name ?? this._levels[index]?.name ?? '')}</h2>
      <p class="tk-flavor tk-flavor--lead">${esc(copy.completeLine)}</p>
      ${this._statsMarkup(stats)}
      <p class="tk-flavor tk-flavor--small">${esc(copy.completeSub)}</p>
      ${nextName ? `<div class="tk-next"><span class="tk-next-label">Up next</span><span class="tk-next-name">${esc(nextName)}</span></div>` : ''}
      <div class="tk-btn-row"><button type="button" class="tk-btn tk-btn--primary" data-act="continue">Continue</button></div>`;
    return this._open('complete', (finish) => {
      const btn = this.$.completeCard.querySelector('[data-act="continue"]');
      const go = () => {
        requestGameLock();
        finish();
      };
      btn.addEventListener('click', go);
      // Space is also the throw key and the card opens right after the scoring throw: swallow it for a beat.
      return { primary: go, focus: btn, keyDelay: 800, releaseLock: true, cleanup: () => btn.removeEventListener('click', go) };
    });
  }

  /** Victory screen. Resolves 'again' (restart) or 'endless' (keep playing). */
  showVictory({ stats = {} } = {}) {
    const copy = COPY[this.theme];
    this.$.victoryCard.innerHTML = `
      <div class="tk-emblem tk-emblem--lg">${EMBLEMS[this.theme]}</div>
      <div class="tk-eyebrow">${esc(copy.victoryEyebrow)}</div>
      <h2 class="tk-title tk-title--victory">${esc(copy.victoryTitle)}</h2>
      <p class="tk-flavor tk-flavor--lead">${esc(copy.victoryLine)}</p>
      ${this._statsMarkup(stats)}
      <div class="tk-btn-row">
        <button type="button" class="tk-btn tk-btn--primary" data-act="endless">Keep playing</button>
        <button type="button" class="tk-btn tk-btn--ghost" data-act="again">Play again</button>
      </div>`;
    this._spawnConfetti();
    return this._open('victory', (finish) => {
      const card = this.$.victoryCard;
      const onClick = (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        requestGameLock();
        finish(act);
      };
      card.addEventListener('click', onClick);
      // Restarting wipes the run, so it takes a click (or tabbing to it). Enter / Space pick the harmless
      // "Keep playing", and only after a beat: Space is also the throw key and may still be in use.
      return {
        primary: () => {
          requestGameLock();
          finish('endless');
        },
        focus: card.querySelector('[data-act="endless"]'),
        keyDelay: 1000,
        releaseLock: true,
        cleanup: () => {
          card.removeEventListener('click', onClick);
          this.$.confetti.replaceChildren();
        },
      };
    });
  }

  showPause(paused) {
    paused = !!paused;
    inputGate.paused = paused;
    if (paused === this._paused) return;
    this._paused = paused;
    if (paused) {
      this.$.pauseControls.innerHTML = this._controlsMarkup(true);
      this.$.pauseLine.textContent = COPY[this.theme].pauseLine;
      this.$.pauseResume.innerHTML = this.touch ? 'Tap anywhere to resume' : 'Click anywhere or press <kbd>P</kbd> to resume';
      releaseGameLock();
    }
    this.$.pause.classList.toggle('is-open', paused);
    this._syncChrome();
  }

  /** Full-screen loading veil; null hides it. */
  setLoading(text) {
    const on = text != null && text !== false;
    if (on) this.$.loadingText.textContent = text === true || text === '' ? `${COPY[this.theme].loading}…` : String(text);
    if (on === this._loading) return;
    this._loading = on;
    this.$.loading.classList.toggle('is-open', on);
    this._syncChrome();
  }

  /** Remove the overlay and listeners. */
  dispose() {
    for (const s of [...this._screens.values()]) s.close();
    window.removeEventListener('keydown', this._onKey, true);
    this.$.aim.removeEventListener('click', this._onAimClick);
    cancelAnimationFrame(this._score.raf);
    this.el.remove();
    this.root.classList.remove('tk-root', 'tk-muted');
    inputGate.modal = false;
    inputGate.paused = false;
  }

  // ---------------------------------------------------------------- internals

  /**
   * Open a modal screen. `setup(finish)` wires it and returns
   * { primary, cleanup, focus, cancelKey, releaseLock, keyDelay (ms during which Enter / Space are swallowed) }.
   * Re-opening a screen that is already up resolves the previous promise first.
   */
  _open(name, setup) {
    this._screens.get(name)?.close();
    const el = this.$[name];
    return new Promise((resolve) => {
      let done = false;
      let wiring = null;
      const finish = (value) => {
        if (done) return;
        done = true;
        wiring?.cleanup?.();
        this._screens.delete(name);
        el.classList.remove('is-open');
        this._syncChrome();
        resolve(value);
      };
      wiring = setup(finish);
      const keysFrom = performance.now() + (wiring.keyDelay ?? 0);
      this._screens.set(name, { close: () => finish(), el, keysFrom, ...wiring });
      if (wiring.releaseLock) releaseGameLock();
      el.classList.add('is-open');
      this._syncChrome();
      if (wiring.focus) requestAnimationFrame(() => el.classList.contains('is-open') && wiring.focus.focus({ preventScroll: true }));
    });
  }

  /** Enter / Space trigger the top screen's primary action before gameplay input sees the key. */
  _routeKey(e) {
    if (!this._screens.size || e.ctrlKey || e.metaKey || e.altKey) return;
    const screen = [...this._screens.values()].pop();
    const confirm = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
    if (!confirm && !(screen.cancelKey && e.code === 'Escape')) return;
    if (e.repeat || performance.now() < screen.keysFrom) {
      // Too early (or a held key): swallow it so a focused button doesn't activate natively either.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // A button the player focused (e.g. tabbed to "Play again") activates natively.
    const focused = document.activeElement;
    if (confirm && focused?.matches?.('.tk-btn') && screen.el.contains(focused)) return;
    e.preventDefault();
    e.stopPropagation();
    screen.primary?.();
  }

  _syncChrome() {
    const open = (n) => this._screens.has(n);
    inputGate.modal = this._screens.size > 0 || this._loading;
    this.el.classList.toggle('is-hud-hidden', open('start') || open('victory') || this._loading);
    this.el.classList.toggle('is-hud-dim', open('complete') || open('intro') || this._paused);
    this.root.classList.toggle('tk-modal-open', inputGate.modal || this._paused);
  }

  _retrigger(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth; // restart the CSS animation
    node.classList.add(cls);
  }

  _renderScore(v) {
    this._score.shown = v;
    this.$.scoreValue.textContent = this.theme === 'office' ? String(Math.max(0, v)).padStart(3, '0') : String(v);
  }

  _rememberLevel(index, info) {
    if (!(index >= 0)) return;
    const cur = this._levels[index] ?? { name: `Level ${index + 1}`, subtitle: '', goal: (index + 1) * 100 };
    for (const [k, v] of Object.entries(info)) if (v !== undefined && v !== null && v !== '') cur[k] = v;
    this._levels[index] = cur;
  }

  _renderStartCopy() {
    const copy = COPY[this.theme];
    this.$.startEyebrow.textContent = copy.eyebrow;
    this.$.startTagline.textContent = copy.tagline;
  }

  _renderStartLevels() {
    this.$.startLevels.innerHTML = this._levels
      .map((l, i) => `
        <div class="tk-level-card tk-level-card--${i === 0 ? 'office' : 'beach'}">
          <span class="tk-level-card-num">${pad2(i)}</span>
          <span class="tk-level-card-text">
            <span class="tk-level-card-name">${esc(l.name)}</span>
            <span class="tk-level-card-sub">${esc(l.subtitle)}</span>
          </span>
          <span class="tk-level-card-goal"><b>${esc(l.goal)}</b> pts</span>
        </div>`)
      .join('');
  }

  _controlsMarkup(compact = false) {
    const rows = this.touch
      ? [
          ['<kbd>Drag</kbd>', 'Aim: sideways to turn, up for a higher arc'],
          ['<kbd>Throw</kbd>', 'Hold, slide up for more power, release to throw'],
          ['<kbd>Cancel</kbd>', 'Slide sideways off the button, then let go'],
          ['<kbd>Meter</kbd>', 'Drag it to set power without throwing'],
          ['<kbd>Guide</kbd>', 'Tap the angle chip for the full arc'],
          ['<kbd>II</kbd>', 'Pause', 'pause'],
        ]
      : [
          ['<kbd>Mouse</kbd>', 'Aim (move up for a higher arc)'],
          ['<kbd>Click</kbd>', 'Hold, pull back for power, release to throw'],
          ['<kbd>Space</kbd>', 'Hold, <kbd>↑</kbd> <kbd>↓</kbd> for power, release to throw'],
          ['<kbd>Scroll</kbd>', 'Fine-tune power'],
          ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', 'Fine-tune aim (arrows too)'],
          ['<kbd>Right-click</kbd>', 'Cancel a wind-up'],
          ['<kbd>G</kbd>', 'Full trajectory guide'],
          ['<kbd>P</kbd><kbd>Esc</kbd>', 'Pause'],
          ['<kbd>M</kbd>', 'Mute'],
        ];
    // The pause screen skips the touch "pause" row: the player just used it.
    const list = compact && this.touch ? rows.filter((r) => r[2] !== 'pause') : rows;
    return list.map(([keys, desc]) => `<div class="tk-control"><span class="tk-keys">${keys}</span><span class="tk-control-desc">${desc}</span></div>`).join('');
  }

  _statsMarkup(stats) {
    const s = { ...stats };
    if (s.accuracy === undefined && s.shots > 0 && s.makes !== undefined) s.accuracy = s.makes / s.shots;
    if (s.bestStreak === undefined && s.streak !== undefined) s.bestStreak = s.streak;
    const fmt = (key, v) => {
      if (key === 'accuracy') return `${Math.round(v <= 1 ? v * 100 : v)}%`;
      if (key === 'time') return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
      return v;
    };
    const cells = STAT_LABELS.filter(([k]) => typeof s[k] === 'number' && Number.isFinite(s[k]))
      .map(([k, label]) => `<div class="tk-stat-cell"><span class="tk-stat-cell-value">${esc(fmt(k, s[k]))}</span><span class="tk-stat-cell-label">${label}</span></div>`);
    const n = cells.length;
    const cols = n <= 4 ? n : n <= 6 ? 3 : 4;
    return n ? `<div class="tk-stats-grid" style="--cols:${cols}">${cells.join('')}</div>` : '';
  }

  /** The drifting field of numbers behind the office title screen. */
  _fillNumbers() {
    const rows = 22;
    const cols = 34;
    let html = '';
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < cols; c++) {
        const d = (Math.random() * 10) | 0;
        line += Math.random() < 0.035 ? `<b style="--d:${(Math.random() * 3).toFixed(2)}s">${d}</b>` : `<i>${d}</i>`;
      }
      html += `<div>${line}</div>`;
    }
    this.$.numbers.innerHTML = html;
  }

  _spawnConfetti() {
    const box = this.$.confetti;
    box.replaceChildren();
    if (reducedMotion()) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 34; i++) {
      const p = document.createElement('i');
      p.style.cssText = `--x:${(Math.random() * 100).toFixed(1)}vw;--drift:${(Math.random() * 16 - 8).toFixed(1)}vw;` +
        `--r:${Math.round(Math.random() * 720 - 360)}deg;--dur:${(4.5 + Math.random() * 4).toFixed(2)}s;` +
        `--delay:${(-Math.random() * 8).toFixed(2)}s;--s:${(0.6 + Math.random() * 0.8).toFixed(2)};--y:${(Math.random() * 100).toFixed(1)}vh`;
      frag.appendChild(p);
    }
    box.appendChild(frag);
  }

  _template() {
    return `
<div class="tk-hud" data-ref="hud">
  <header class="tk-top">
    <section class="tk-panel tk-level" aria-label="Level">
      <div class="tk-level-head">
        <span class="tk-emblem tk-emblem--sm"></span>
        <div class="tk-level-text">
          <div class="tk-eyebrow">Level <span data-ref="levelNum">01</span><span class="tk-dim"> / <span data-ref="levelTotal">02</span></span></div>
          <div class="tk-level-name" data-ref="levelName">${esc(DEFAULT_LEVELS[0].name)}</div>
          <div class="tk-level-sub" data-ref="levelSub">${esc(DEFAULT_LEVELS[0].subtitle)}</div>
        </div>
      </div>
      <div class="tk-progress" data-ref="progress">
        <div class="tk-progress-track"><div class="tk-progress-fill" data-ref="progFill"></div></div>
        <div class="tk-progress-label"><span data-ref="progText">0 / 100</span><span data-ref="progPct">0%</span></div>
      </div>
    </section>
    <section class="tk-panel tk-score" aria-label="Score">
      <div class="tk-eyebrow">Score</div>
      <div class="tk-score-value" data-ref="scoreValue">000</div>
    </section>
    <section class="tk-panel tk-stats" aria-label="Stats">
      <div class="tk-stat"><span class="tk-stat-label">Shots</span><span class="tk-stat-value" data-ref="statShots">0</span></div>
      <div class="tk-stat"><span class="tk-stat-label">Makes</span><span class="tk-stat-value" data-ref="statMakes">0</span></div>
      <div class="tk-stat"><span class="tk-stat-label">Accuracy</span><span class="tk-stat-value" data-ref="statAcc">—</span></div>
      <div class="tk-stat tk-stat--streak" data-ref="streakCell"><span class="tk-stat-label">Streak</span><span class="tk-stat-value" data-ref="statStreak">0</span></div>
    </section>
  </header>

  <div class="tk-reticle" data-ref="reticle" aria-hidden="true"><span class="tk-reticle-power"></span><span class="tk-reticle-ring"></span><span class="tk-reticle-dot"></span></div>
  <div class="tk-flashes" data-ref="flashes" aria-live="polite"></div>

  <div class="tk-power" data-ref="power" aria-hidden="true">
    <div class="tk-power-value"><span data-ref="powerValue">0</span><small>%</small></div>
    <div class="tk-power-track">
      <div class="tk-power-fill"></div>
      <div class="tk-power-ticks"></div>
      <div class="tk-power-cap"></div>
    </div>
    <div class="tk-power-label">Power</div>
  </div>

  <div class="tk-dock">
    <div class="tk-panel tk-aim" data-ref="aim" role="button" aria-label="Full trajectory guide" aria-pressed="false">
      <span class="tk-aim-item">
        <span class="tk-aim-arc" data-ref="aimArc" aria-hidden="true"><i></i></span>
        <span class="tk-aim-label">Angle</span><span class="tk-aim-value" data-ref="aimAngle">30°</span>
      </span>
      <span class="tk-aim-sep" aria-hidden="true"></span>
      <span class="tk-aim-item">
        <span class="tk-aim-label">Guide</span><span class="tk-aim-value" data-ref="aimGuide">Short</span><kbd class="tk-aim-key">G</kbd>
        <span class="tk-aim-switch" aria-hidden="true"><i></i></span>
      </span>
      <span class="tk-aim-mute" title="Muted (M)">${MUTE_ICON}</span>
    </div>

    <div class="tk-hint is-hidden" data-ref="hint"></div>
  </div>
</div>

<div class="tk-screen tk-start" data-ref="start" role="dialog" aria-label="Trashketball">
  <div class="tk-start-bg" aria-hidden="true"><div class="tk-numbers" data-ref="numbers"></div><div class="tk-sun"></div></div>
  <div class="tk-start-inner">
    <div class="tk-emblem tk-emblem--lg"></div>
    <div class="tk-eyebrow tk-start-eyebrow" data-ref="startEyebrow"></div>
    <h1 class="tk-title">Trashketball</h1>
    <p class="tk-tagline" data-ref="startTagline"></p>
    <div class="tk-level-cards" data-ref="startLevels"></div>
    <div class="tk-controls" data-ref="startControls"></div>
    <button type="button" class="tk-btn tk-btn--primary tk-cta" data-ref="startCta">Click to play</button>
    <p class="tk-footnote">10 points per basket · 100 points to advance</p>
  </div>
</div>

<div class="tk-screen tk-intro" data-ref="intro" role="dialog" aria-label="Level intro">
  <div class="tk-card tk-intro-card" data-ref="introCard"></div>
</div>

<div class="tk-screen tk-complete" data-ref="complete" role="dialog" aria-label="Level complete">
  <div class="tk-card tk-complete-card" data-ref="completeCard"></div>
</div>

<div class="tk-screen tk-victory" data-ref="victory" role="dialog" aria-label="Victory">
  <div class="tk-confetti" data-ref="confetti" aria-hidden="true"></div>
  <div class="tk-card tk-victory-card" data-ref="victoryCard"></div>
</div>

<div class="tk-screen tk-pause" data-ref="pause" role="dialog" aria-label="Paused">
  <div class="tk-pause-inner">
    <div class="tk-eyebrow">Game paused</div>
    <h2 class="tk-title tk-title--pause">Paused</h2>
    <p class="tk-flavor" data-ref="pauseLine"></p>
    <p class="tk-resume" data-ref="pauseResume"></p>
    <div class="tk-controls tk-controls--compact" data-ref="pauseControls"></div>
  </div>
</div>

<div class="tk-loading" data-ref="loading" role="status">
  <div class="tk-loading-inner">
    <div class="tk-emblem tk-emblem--md tk-emblem--spin"></div>
    <div class="tk-loading-text" data-ref="loadingText">Loading…</div>
    <div class="tk-loading-bar"><span></span></div>
  </div>
</div>`;
  }
}

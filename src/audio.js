// Every sound in the game, synthesized with WebAudio: oscillators, filtered noise and a few
// short sample buffers rendered procedurally in JS at unlock time. No audio files.

const MAX_VOICES = 28; // one-shot sounds alive at once; extra bounces are dropped, not queued
const BOUNCE_GAP = 0.03; // s; minimum spacing between two bounce sounds of the same material
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Bell-like timbres for chimes and jingles. `ratios` are partial frequency multiples.
const TIMBRES = {
  // Lumon: clean, slightly "corporate terminal" sine bells
  office: { ratios: [1, 2, 3.01], gains: [1, 0.28, 0.08], decays: [1, 0.45, 0.25], type: 'sine' },
  // Beach: marimba-ish, woody fundamental with the characteristic 4x / 10x overtones
  beach: { ratios: [1, 3.96, 9.8], gains: [1, 0.3, 0.06], decays: [1, 0.18, 0.07], type: 'sine' },
};

const NOTE = {
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77,
  C6: 1046.5, Cs6: 1108.73, D6: 1174.66, E6: 1318.51, G6: 1567.98,
};

export class AudioFX {
  constructor() {
    /** @type {BaseAudioContext | null} */
    this.ctx = null;
    this._muted = false;
    this._volume = 0.85;
    this._theme = 'office';
    this._ambName = null;
    this._amb = null;
    this._voices = 0;
    this._lastBounce = new Map();
    this._lastChime = -1;
    this._onVisibility = null;
  }

  get muted() {
    return this._muted;
  }

  /** Create / resume the AudioContext. Call from a user-gesture handler; repeated calls are cheap. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      let ctx;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this._attach(ctx);
      this._onVisibility = () => {
        if (!this.ctx || this.ctx.state === 'closed') return;
        if (document.hidden) this.ctx.suspend().catch(() => {});
        else this.ctx.resume().catch(() => {});
      };
      document.addEventListener('visibilitychange', this._onVisibility);
    }
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
  }

  setMuted(muted) {
    this._muted = !!muted;
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this._muted ? 0 : this._volume, t, 0.04);
  }

  /** Master volume, 0..1. */
  setVolume(volume) {
    this._volume = clamp(volume, 0, 1);
    this.setMuted(this._muted);
  }

  /**
   * Play a one-shot sound.
   * @param {string} name crumple | throw | bounce | rim | binWall | binIn | score | swish | miss | levelUp | victory | click
   * @param {{ intensity?: number, material?: string }} [opts]
   */
  play(name, { intensity = 1, material } = {}) {
    const ctx = this.ctx;
    if (!ctx || this._muted) return;
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    if (ctx.state === 'closed') return;
    const i = clamp(Number.isFinite(intensity) ? intensity : 1, 0, 1.5);
    const t = ctx.currentTime + 0.004;
    switch (name) {
      case 'crumple': return this._crumple(t, i);
      case 'throw': return this._whoosh(t, i);
      case 'bounce': return this._bounce(t, i, material);
      case 'rim': return this._rim(t, i, this._binMat(material));
      case 'binWall': return this._binWall(t, i, this._binMat(material));
      case 'binIn': return this._binIn(t, i, this._binMat(material));
      case 'score': return this._score(t, i);
      case 'swish': return this._swish(t, i);
      case 'miss': return this._miss(t, i);
      case 'levelUp': return this._levelUp(t, i);
      case 'victory': return this._victory(t, i);
      case 'click': return this._click(t, i);
      default:
    }
  }

  /** Crossfade to a looping ambience bed. Safe to call before unlock(); it starts on unlock. */
  setAmbience(name) {
    name = name === 'office' || name === 'beach' ? name : null;
    if (name) this._theme = name;
    if (name === this._ambName && (this._amb || !this.ctx)) return;
    this._ambName = name;
    if (!this.ctx) return;
    this._stopAmbience();
    if (name) this._amb = name === 'office' ? this._officeAmbience() : this._beachAmbience();
  }

  /** Stop everything and close the AudioContext. */
  dispose() {
    this._stopAmbience(0.05);
    if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility);
    this._onVisibility = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx && typeof ctx.close === 'function') ctx.close().catch(() => {});
  }

  // ------------------------------------------------------------------ graph

  /** Build the output graph on a (possibly offline) context. Exposed for tests; unlock() calls it. */
  _attach(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : this._volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.sfx = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.9;
    this.sfx.connect(comp);
    this.ambBus.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);
    this._buf = buildBuffers(ctx);
    if (this._ambName) this._amb = this._ambName === 'office' ? this._officeAmbience() : this._beachAmbience();
  }

  _binMat(material) {
    if (material === 'metal' || material === 'wicker') return material;
    return this._theme === 'beach' ? 'wicker' : 'metal';
  }

  /** Reserve a voice slot until `end`; false when the pool is full. */
  _voice(end) {
    if (this._voices >= MAX_VOICES) return false;
    this._voices++;
    const ms = Math.max(0, end - this.ctx.currentTime) * 1000 + 60;
    setTimeout(() => this._voices--, ms);
    return true;
  }

  /** Envelope: 0 -> peak (linear attack) -> exponential decay -> hard 0. Returns the end time. */
  _env(param, t, attack, peak, decay) {
    const end = t + attack + decay;
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(Math.max(peak * 0.0008, 1e-5), end);
    param.linearRampToValueAtTime(0, end + 0.015);
    return end + 0.02;
  }

  _gain(dest, value = 1) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  _filter(type, freq, Q = 0.707, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    if (dest) f.connect(dest);
    return f;
  }

  _cleanup(src, ...nodes) {
    src.onended = () => {
      src.disconnect();
      for (const n of nodes) n.disconnect();
    };
  }

  /** Enveloped oscillator. */
  _tone(t, { freq, freqEnd, glide, type = 'sine', attack = 0.004, decay = 0.2, gain = 0.2, dest = this.sfx, detune = 0 }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + (glide ?? attack + decay));
    osc.detune.value = detune;
    const g = ctx.createGain();
    const end = this._env(g.gain, t, attack, gain, decay);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(end);
    this._cleanup(osc, g);
    return end;
  }

  /** Enveloped buffer playback through an optional filter. */
  _noise(t, { buffer = this._buf.white, offset, filter, freq = 1000, freqEnd, sweep, Q = 1, attack = 0.002, decay = 0.1, gain = 0.2, rate = 1, dest = this.sfx, pan = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const end = this._env(g.gain, t, attack, gain, decay);
    let head = src;
    const nodes = [g];
    if (filter) {
      const f = this._filter(filter, freq, Q);
      if (freqEnd) {
        f.frequency.setValueAtTime(freq, t);
        f.frequency.exponentialRampToValueAtTime(freqEnd, t + (sweep ?? attack + decay));
      }
      head.connect(f);
      head = f;
      nodes.push(f);
    }
    head.connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(dest);
      nodes.push(p);
    } else {
      g.connect(dest);
    }
    const maxOffset = Math.max(0, buffer.duration - (end - t) * rate - 0.01);
    src.start(t, offset ?? Math.random() * maxOffset);
    src.stop(end);
    this._cleanup(src, ...nodes);
    return end;
  }

  /** Play a pre-rendered one-shot buffer (it carries its own envelope). */
  _sample(t, buffer, { gain = 0.5, rate = 1, filter, freq = 1000, Q = 0.7, dest = this.sfx }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this._gain(dest, gain);
    const nodes = [g];
    if (filter) {
      const f = this._filter(filter, freq, Q, g);
      src.connect(f);
      nodes.push(f);
    } else {
      src.connect(g);
    }
    const end = t + buffer.duration / rate;
    src.start(t);
    this._cleanup(src, ...nodes);
    return end;
  }

  /** Struck bell / marimba note in the current theme's timbre. */
  _bell(t, freq, { gain = 0.12, decay = 0.6, timbre = TIMBRES[this._theme], dest = this.sfx } = {}) {
    let end = t;
    timbre.ratios.forEach((r, k) => {
      const f = freq * r;
      if (f > 16000) return;
      end = Math.max(end, this._tone(t, {
        freq: f, type: timbre.type, attack: k === 0 ? 0.004 : 0.002, decay: decay * timbre.decays[k],
        gain: gain * timbre.gains[k], dest, detune: k === 0 ? 0 : rand(-6, 6),
      }));
    });
    return end;
  }

  // ------------------------------------------------------------------ one-shots

  _crumple(t, i) {
    const buf = pick(this._buf.crumple);
    if (!this._voice(t + buf.duration)) return;
    this._sample(t, buf, { gain: 0.5 * i, rate: rand(0.92, 1.1), filter: 'highpass', freq: 260 });
  }

  _whoosh(t, i) {
    if (!this._voice(t + 0.5)) return;
    const peak = 1300 + 900 * Math.min(i, 1);
    this._noise(t, { filter: 'bandpass', freq: 420, freqEnd: peak, sweep: 0.13, Q: 1.3, attack: 0.07, decay: 0.34, gain: 0.3 * i });
    this._noise(t + 0.02, { buffer: this._buf.pink, filter: 'lowpass', freq: 380, Q: 0.5, attack: 0.05, decay: 0.2, gain: 0.16 * i });
  }

  _bounce(t, i, material) {
    if (material === 'rim') return this._rim(t, i, this._binMat());
    if (material === 'binWall') return this._binWall(t, i, this._binMat());
    if (material === 'binFloor') return this._binIn(t, i * 0.7, this._binMat());
    if (i < 0.03) return;
    const key = material || 'floor';
    const last = this._lastBounce.get(key) ?? -1;
    if (t - last < BOUNCE_GAP) return;
    this._lastBounce.set(key, t);
    if (!this._voice(t + 0.3)) return;
    const v = Math.min(i, 1.2);
    switch (key) {
      case 'carpet':
        this._tone(t, { freq: 115, freqEnd: 58, glide: 0.07, decay: 0.08, gain: 0.34 * v });
        this._noise(t, { filter: 'lowpass', freq: 650, Q: 0.6, decay: 0.035, gain: 0.2 * v });
        break;
      case 'glass':
        [2380, 3790, 5510].forEach((f, k) => {
          this._tone(t, { freq: f * rand(0.97, 1.03), decay: [0.24, 0.14, 0.08][k], gain: [0.1, 0.06, 0.035][k] * v });
        });
        this._noise(t, { filter: 'highpass', freq: 4200, decay: 0.012, gain: 0.11 * v });
        break;
      case 'soft':
        this._noise(t, { buffer: this._buf.pink, filter: 'lowpass', freq: 520, freqEnd: 220, Q: 0.5, attack: 0.008, decay: 0.12, gain: 0.42 * v });
        break;
      case 'furniture':
        this._noise(t, { filter: 'bandpass', freq: rand(1900, 2400), Q: 3, decay: 0.03, gain: 0.44 * v });
        this._tone(t, { freq: rand(320, 360), freqEnd: 290, type: 'triangle', decay: 0.07, gain: 0.18 * v });
        break;
      case 'ball':
        this._sample(t, pick(this._buf.crumple), { gain: 0.22 * v, rate: rand(1.3, 1.6), filter: 'bandpass', freq: 2600, Q: 0.8 });
        break;
      case 'wall':
        this._noise(t, { filter: 'bandpass', freq: rand(900, 1100), Q: 1.2, decay: 0.04, gain: 0.38 * v });
        this._tone(t, { freq: 150, freqEnd: 95, glide: 0.06, decay: 0.07, gain: 0.24 * v });
        break;
      case 'floor':
      default:
        this._noise(t, { filter: 'bandpass', freq: rand(1250, 1550), Q: 1.5, decay: 0.035, gain: 0.42 * v });
        this._tone(t, { freq: 190, freqEnd: 115, glide: 0.05, decay: 0.06, gain: 0.26 * v });
    }
  }

  _rim(t, i, mat) {
    if (!this._voice(t + 0.7)) return;
    const v = Math.min(i, 1.2);
    if (mat === 'wicker') {
      this._sample(t, pick(this._buf.wicker), { gain: 0.62 * v, rate: rand(0.95, 1.08), filter: 'bandpass', freq: 1300, Q: 0.6 });
      this._tone(t, { freq: 215, freqEnd: 175, decay: 0.09, gain: 0.12 * v });
      return;
    }
    // Thin steel ring: inharmonic partials of a free ring, plus the wire mesh buzzing.
    const f0 = 540 * rand(0.96, 1.04);
    [1, 2.76, 5.4, 8.93].forEach((r, k) => {
      this._tone(t, { freq: f0 * r, decay: [0.55, 0.36, 0.2, 0.11][k], gain: [0.11, 0.075, 0.045, 0.028][k] * v, detune: rand(-8, 8) });
    });
    this._noise(t, { filter: 'highpass', freq: 2600, decay: 0.018, gain: 0.16 * v });
    this._sample(t, pick(this._buf.mesh), { gain: 0.14 * v, filter: 'bandpass', freq: 3200, Q: 0.8 });
  }

  _binWall(t, i, mat) {
    if (!this._voice(t + 0.4)) return;
    const v = Math.min(i, 1.2);
    if (mat === 'wicker') {
      this._sample(t, pick(this._buf.wicker), { gain: 0.46 * v, rate: rand(0.78, 0.88), filter: 'lowpass', freq: 1900 });
      this._tone(t, { freq: 165, freqEnd: 140, decay: 0.07, gain: 0.1 * v });
      return;
    }
    this._sample(t, pick(this._buf.mesh), { gain: 0.34 * v, rate: rand(0.85, 1), filter: 'lowpass', freq: 4200 });
    const f0 = 380 * rand(0.96, 1.04);
    this._tone(t, { freq: f0, decay: 0.24, gain: 0.045 * v });
    this._tone(t, { freq: f0 * 2.76, decay: 0.14, gain: 0.03 * v });
  }

  _binIn(t, i, mat) {
    if (!this._voice(t + 0.4)) return;
    const v = Math.min(i, 1.2);
    this._tone(t, { freq: 96, freqEnd: 52, glide: 0.12, attack: 0.003, decay: 0.15, gain: 0.42 * v });
    this._noise(t, { buffer: this._buf.pink, filter: 'lowpass', freq: 900, decay: 0.06, gain: 0.22 * v });
    this._sample(t + 0.006, pick(this._buf.crumple), { gain: 0.12 * v, rate: 1.4, filter: 'bandpass', freq: 1900, Q: 0.7 });
    if (mat === 'wicker') this._sample(t, pick(this._buf.wicker), { gain: 0.14 * v, rate: 0.7, filter: 'lowpass', freq: 1400 });
    else this._sample(t, pick(this._buf.mesh), { gain: 0.08 * v, rate: 0.8, filter: 'lowpass', freq: 3000 });
  }

  /** Two-note chime; skipped if another chime started within 80 ms (score + swish fired together). */
  _chime(t, notes, gain, spacing = 0.085) {
    if (t - this._lastChime < 0.08) return;
    this._lastChime = t;
    if (!this._voice(t + 1)) return;
    notes.forEach((f, k) => this._bell(t + k * spacing, f, { gain, decay: k === notes.length - 1 ? 0.8 : 0.45 }));
  }

  _score(t, i) {
    const notes = this._theme === 'beach' ? [NOTE.G5, NOTE.D6] : [NOTE.A5, NOTE.E6];
    this._chime(t, notes, 0.13 * Math.min(i, 1.2));
  }

  _swish(t, i) {
    const v = Math.min(i, 1.2);
    if (this._voice(t + 0.6)) {
      // Airy "through the net" sweep, panned across.
      this._noise(t, { filter: 'bandpass', freq: 2400, freqEnd: 7200, sweep: 0.2, Q: 3.5, attack: 0.05, decay: 0.42, gain: 0.26 * v, pan: -0.25 });
      this._noise(t + 0.03, { filter: 'highpass', freq: 5200, attack: 0.03, decay: 0.3, gain: 0.07 * v, pan: 0.3 });
    }
    const notes = this._theme === 'beach' ? [NOTE.G5, NOTE.B5, NOTE.D6] : [NOTE.A5, NOTE.Cs6, NOTE.E6];
    this._chime(t + 0.05, notes, 0.12 * v, 0.07);
  }

  _miss(t, i) {
    if (!this._voice(t + 0.8)) return;
    const v = Math.min(i, 1.2);
    const lp = this._filter('lowpass', 1400, 0.5, this.sfx);
    this._tone(t, { freq: 392, freqEnd: 262, glide: 0.42, type: 'triangle', attack: 0.02, decay: 0.5, gain: 0.1 * v, dest: lp });
    this._tone(t + 0.01, { freq: 196, freqEnd: 131, glide: 0.42, attack: 0.02, decay: 0.45, gain: 0.05 * v, dest: lp });
    setTimeout(() => lp.disconnect(), 1200);
  }

  _jingle(t, notes, { step, chord, chordAt, chordDecay, gain }) {
    notes.forEach((f, k) => this._bell(t + k * step, f, { gain, decay: 0.5 }));
    chord.forEach((f, k) => this._bell(t + chordAt + k * 0.012, f, { gain: gain * 0.55, decay: chordDecay }));
    // soft sparkle on the landing chord
    this._noise(t + chordAt, { filter: 'highpass', freq: 6500, attack: 0.02, decay: chordDecay * 0.5, gain: 0.025 });
    return t + chordAt + chordDecay;
  }

  _levelUp(t, i) {
    if (!this._voice(t + 2)) return;
    this._lastChime = t;
    const g = 0.11 * Math.min(i, 1.2);
    this._jingle(t, [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], {
      step: 0.11, chord: [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], chordAt: 0.46, chordDecay: 1.3, gain: g,
    });
  }

  _victory(t, i) {
    if (!this._voice(t + 3)) return;
    this._lastChime = t;
    const g = 0.11 * Math.min(i, 1.2);
    this._jingle(t, [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6], {
      step: 0.09, chord: [NOTE.C5, NOTE.G5, NOTE.B5, NOTE.E6, NOTE.G6], chordAt: 0.62, chordDecay: 2, gain: g,
    });
    this._bell(t + 0.62, NOTE.C5 / 2, { gain: g * 0.6, decay: 1.6 });
  }

  _click(t, i) {
    if (!this._voice(t + 0.08)) return;
    this._tone(t, { freq: 1500, freqEnd: 1100, glide: 0.03, decay: 0.035, gain: 0.12 * i });
    this._noise(t, { filter: 'highpass', freq: 3000, decay: 0.008, gain: 0.07 * i });
  }

  // ------------------------------------------------------------------ ambience

  _stopAmbience(fade = 1.2) {
    const amb = this._amb;
    this._amb = null;
    if (!amb) return;
    amb.stopped = true;
    for (const id of amb.timers) clearTimeout(id);
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    amb.out.gain.cancelScheduledValues(t);
    amb.out.gain.setValueAtTime(amb.out.gain.value, t);
    amb.out.gain.linearRampToValueAtTime(0, t + fade);
    for (const s of amb.sources) {
      try {
        s.stop(t + fade + 0.05);
      } catch {
        // already stopped
      }
    }
    setTimeout(() => amb.out.disconnect(), (fade + 0.2) * 1000);
  }

  /** Output node + bookkeeping for one ambience bed, fading in. */
  _ambBed(level, fadeIn = 2.5) {
    const out = this.ctx.createGain();
    const t = this.ctx.currentTime;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(level, t + fadeIn);
    out.connect(this.ambBus);
    return { out, sources: [], timers: [], stopped: false };
  }

  _loop(amb, buffer, dest, offset = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(dest);
    src.start(this.ctx.currentTime, offset % buffer.duration);
    amb.sources.push(src);
    return src;
  }

  /** Sine LFO (or custom wave) driving `param` around its current value by +/- depth. */
  _lfo(amb, param, freq, depth, { wave, delay = 0 } = {}) {
    const osc = this.ctx.createOscillator();
    if (wave) osc.setPeriodicWave(wave);
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(param);
    osc.start(this.ctx.currentTime + delay);
    amb.sources.push(osc);
    return osc;
  }

  _officeAmbience() {
    const ctx = this.ctx;
    // Bed levels sit ~20 dB under the chimes so ambience never trips the compressor or masks bounces.
    const amb = this._ambBed(0.62);

    // Fluorescent tubes: 120 Hz mains hum with harmonics, plus a faint ballast buzz.
    const hum = this._gain(amb.out, 0.016);
    [[120, 1], [240, 0.5], [360, 0.22], [480, 0.12]].forEach(([f, g]) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(this._gain(hum, g));
      o.start();
      amb.sources.push(o);
    });
    const buzz = ctx.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.value = 120;
    buzz.connect(this._filter('bandpass', 2600, 2.5, this._gain(amb.out, 0.0018)));
    buzz.start();
    amb.sources.push(buzz);
    this._lfo(amb, hum.gain, 0.13, 0.004);

    // HVAC: soft, slowly breathing low-passed air.
    const airLp = this._filter('lowpass', 480, 0.4, this._filter('highpass', 70, 0.7, this._gain(amb.out, 0.075)));
    this._loop(amb, this._buf.pink, airLp, rand(0, 4));
    this._lfo(amb, airLp.frequency, 0.045, 110);
    return amb;
  }

  _beachAmbience() {
    const ctx = this.ctx;
    const amb = this._ambBed(0.45, 3);
    const wave = this._buf.swellWave;

    // Waves: brown noise through a low-pass that opens on each swell, with a matching volume swell.
    // The swell LFO swings about -0.4..+0.6 around the base values below.
    const waveGain = this._gain(amb.out, 0.17);
    const waveLp = this._filter('lowpass', 620, 0.5, waveGain);
    this._loop(amb, this._buf.brown, waveLp, rand(0, 5));
    this._lfo(amb, waveLp.frequency, 1 / 8.7, 700, { wave });
    this._lfo(amb, waveGain.gain, 1 / 8.7, 0.28, { wave });
    this._lfo(amb, waveLp.frequency, 1 / 13.3, 220); // second, slower set so swells never feel metronomic

    // Foam hiss that peaks just after each crest.
    const foamGain = this._gain(amb.out, 0.014);
    const foam = this._filter('highpass', 1900, 0.5, this._filter('lowpass', 7500, 0.5, foamGain));
    this._loop(amb, this._buf.white, foam, rand(0, 2));
    this._lfo(amb, foamGain.gain, 1 / 8.7, 0.013, { wave, delay: 0.9 });

    // Light wind.
    const windGain = this._gain(amb.out, 0.022);
    const wind = this._filter('bandpass', 620, 0.6, windGain);
    this._loop(amb, this._buf.pink, wind, rand(0, 4));
    this._lfo(amb, wind.frequency, 0.061, 240);
    this._lfo(amb, windGain.gain, 0.093, 0.011);

    const scheduleGull = (delay) => {
      const id = setTimeout(() => {
        if (amb.stopped) return;
        if (!document.hidden && !this._muted && this.ctx?.state === 'running') this._gulls(amb.out);
        scheduleGull(rand(9, 20));
      }, delay * 1000);
      amb.timers.push(id);
    };
    scheduleGull(rand(3, 7));
    return amb;
  }

  /** A distant gull: 2-4 nasal "kyow" calls with a throaty flutter. */
  _gulls(dest, t = this.ctx.currentTime + 0.05) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const lp = this._filter('lowpass', 3600, 0.5);
    if (pan) {
      pan.pan.value = rand(-0.75, 0.75);
      lp.connect(pan).connect(dest);
    } else {
      lp.connect(dest);
    }
    const bp = this._filter('bandpass', 1700, 0.9, lp);
    const calls = 2 + ((Math.random() * 3) | 0);
    const base = rand(0.9, 1.12);
    let end = t;
    for (let k = 0; k < calls; k++) {
      const s = t + k * rand(0.3, 0.42);
      const len = rand(0.26, 0.36);
      const f0 = 1180 * base * rand(0.96, 1.04);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f0, s);
      o.frequency.linearRampToValueAtTime(f0 * 1.55, s + 0.06);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.82, s + len);
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.setValueAtTime(f0 * 2, s);
      o2.frequency.linearRampToValueAtTime(f0 * 3.1, s + 0.06);
      o2.frequency.exponentialRampToValueAtTime(f0 * 1.64, s + len);
      const flutter = ctx.createOscillator();
      flutter.frequency.value = rand(18, 26);
      const fg = ctx.createGain();
      fg.gain.value = 40;
      flutter.connect(fg);
      fg.connect(o.frequency);
      fg.connect(o2.frequency);
      const g = ctx.createGain();
      const g2 = this._gain(g, 0.18);
      const stop = this._env(g.gain, s, 0.03, 0.035 * (k === 0 ? 1 : rand(0.6, 0.95)), len);
      o.connect(g);
      o2.connect(g2);
      g.connect(bp);
      for (const n of [o, o2, flutter]) {
        n.start(s);
        n.stop(stop);
      }
      o.onended = () => [o, o2, flutter, fg, g, g2].forEach((n) => n.disconnect());
      end = stop;
    }
    setTimeout(() => [pan, lp, bp].forEach((n) => n?.disconnect()), (end - ctx.currentTime + 0.3) * 1000);
  }
}

// ------------------------------------------------------------------ procedural buffers

/** RBJ band-pass biquad (0 dB peak), processed in place over `x`. */
function bandpass(x, sr, freq, Q) {
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const y = b0 * xn + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xn;
    y2 = y1;
    y1 = y;
    x[n] = y;
  }
  return x;
}

/** Add a resonant click (windowed noise burst through a band-pass) into `out` at sample `at`. */
function addClick(out, sr, at, { len, freq, Q, amp }) {
  const n = Math.floor(len * sr);
  const ring = Math.floor(n * 4 + sr * 0.004);
  const x = new Float32Array(n + ring);
  for (let k = 0; k < n; k++) {
    const w = Math.sin((Math.PI * k) / n);
    x[k] = (Math.random() * 2 - 1) * w;
  }
  bandpass(x, sr, freq, Q);
  const norm = amp * Math.sqrt(Q) * 1.4;
  for (let k = 0; k < x.length && at + k < out.length; k++) out[at + k] += x[k] * norm;
}

function normalize(d, peak = 0.9) {
  let m = 0;
  for (let k = 0; k < d.length; k++) m = Math.max(m, Math.abs(d[k]));
  if (m > 0) for (let k = 0; k < d.length; k++) d[k] *= peak / m;
  // guarantee silent edges so buffers never click in or out
  const fade = Math.min(64, d.length >> 3);
  for (let k = 0; k < fade; k++) {
    d[k] *= k / fade;
    d[d.length - 1 - k] *= k / fade;
  }
  return d;
}

function makeBuffer(ctx, seconds, fill) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * seconds), sr);
  fill(buf.getChannelData(0), sr);
  return buf;
}

/** Seamlessly looping noise: generate extra, then crossfade the tail into the head. */
function loopNoise(ctx, seconds, color) {
  return makeBuffer(ctx, seconds, (d, sr) => {
    const xf = Math.floor(sr * 0.25);
    const n = d.length + xf;
    const s = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let k = 0; k < n; k++) {
      const w = Math.random() * 2 - 1;
      if (color === 'white') s[k] = w * 0.5;
      else if (color === 'pink') {
        // Paul Kellet's refined pink filter
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        s[k] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        s[k] = last * 3.5;
      }
    }
    for (let k = 0; k < d.length; k++) d[k] = s[k];
    for (let k = 0; k < xf; k++) {
      const a = k / xf;
      d[k] = s[k] * Math.sqrt(a) + s[d.length + k] * Math.sqrt(1 - a);
    }
    let m = 0;
    for (let k = 0; k < d.length; k++) m = Math.max(m, Math.abs(d[k]));
    for (let k = 0; k < d.length; k++) d[k] *= 0.8 / m;
  });
}

function makeCrumple(ctx) {
  return makeBuffer(ctx, 0.55, (d, sr) => {
    // soft rustle bed
    let hp = 0, prev = 0;
    for (let k = 0; k < d.length; k++) {
      const t = k / sr;
      const env = Math.min(1, t / 0.02) * Math.exp(-t / 0.16);
      const w = Math.random() * 2 - 1;
      hp = 0.92 * (hp + w - prev);
      prev = w;
      d[k] = hp * env * 0.1;
    }
    // crackles, denser at the start of the scrunch
    const count = 24 + ((Math.random() * 14) | 0);
    for (let c = 0; c < count; c++) {
      const t = 0.42 * Math.pow(Math.random(), 1.5);
      const amp = rand(0.25, 1) * Math.exp(-t / 0.22);
      addClick(d, sr, Math.floor(t * sr), { len: rand(0.002, 0.012), freq: rand(1300, 6200), Q: rand(1.5, 5), amp });
    }
    normalize(d);
  });
}

function makeWicker(ctx) {
  return makeBuffer(ctx, 0.3, (d, sr) => {
    const clicks = 7 + ((Math.random() * 6) | 0);
    let t = 0;
    for (let c = 0; c < clicks; c++) {
      const amp = Math.exp(-c / 3.2) * rand(0.6, 1);
      addClick(d, sr, Math.floor(t * sr), { len: rand(0.0015, 0.004), freq: rand(750, 2100), Q: rand(4, 8), amp });
      if (c === 0) addClick(d, sr, 0, { len: 0.006, freq: 260, Q: 2, amp: 0.8 });
      t += rand(0.007, 0.022);
    }
    normalize(d);
  });
}

function makeMesh(ctx) {
  return makeBuffer(ctx, 0.18, (d, sr) => {
    const clicks = 10 + ((Math.random() * 7) | 0);
    let t = 0;
    for (let c = 0; c < clicks; c++) {
      addClick(d, sr, Math.floor(t * sr), { len: rand(0.0008, 0.002), freq: rand(2600, 6000), Q: rand(6, 10), amp: Math.exp(-c / 4) });
      t += rand(0.003, 0.009);
    }
    normalize(d);
  });
}

/**
 * LFO shape for ocean swells: slow build, crest, long wash. Given as a PeriodicWave so an
 * OscillatorNode can drive AudioParams with it at no per-sample JS cost.
 */
function makeSwellWave(ctx) {
  const shape = (p) => {
    const rise = 0.28;
    if (p < rise) {
      const x = p / rise;
      return 0.05 + 0.95 * x * x * (3 - 2 * x);
    }
    return 0.05 + 0.95 * Math.exp(-(p - rise) * 4.2);
  };
  const H = 14;
  const M = 512;
  const real = new Float32Array(H + 1);
  const imag = new Float32Array(H + 1);
  for (let k = 1; k <= H; k++) {
    let a = 0;
    let b = 0;
    for (let j = 0; j < M; j++) {
      const p = j / M;
      const s = shape(p);
      a += s * Math.cos(2 * Math.PI * k * p);
      b += s * Math.sin(2 * Math.PI * k * p);
    }
    real[k] = (2 * a) / M;
    imag[k] = (2 * b) / M;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

function buildBuffers(ctx) {
  return {
    white: loopNoise(ctx, 3, 'white'),
    pink: loopNoise(ctx, 5, 'pink'),
    brown: loopNoise(ctx, 7, 'brown'),
    crumple: [makeCrumple(ctx), makeCrumple(ctx), makeCrumple(ctx)],
    wicker: [makeWicker(ctx), makeWicker(ctx), makeWicker(ctx)],
    mesh: [makeMesh(ctx), makeMesh(ctx)],
    swellWave: makeSwellWave(ctx),
  };
}

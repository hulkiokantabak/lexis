/* LEXIS — engine.js
 * The governed spine, DOM-driven (no canvas): a motion/visibility governor (reduced-motion +
 * background-tab safety) and a tiny asset-free WebAudio synth. No dependencies, no network.
 * One global: window.LEXIS_ENGINE.
 */
(function (global) {
  'use strict';

  /* ---------- motion / visibility governor ---------- */
  var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var Motion = {
    reduced: !!(mq && mq.matches),
    tabHidden: !!document.hidden,   /* a page opened in a background tab starts hidden (r5) */
    _listeners: [],
    shouldAnimate: function () { return !this.reduced && !this.tabHidden; },
    onChange: function (fn) { this._listeners.push(fn); }
  };
  document.addEventListener('visibilitychange', function () { Motion.tabHidden = document.hidden; });
  function onMQChange(e) {
    Motion.reduced = e.matches;
    Motion._listeners.forEach(function (fn) { try { fn(e.matches); } catch (x) {} });
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', onMQChange);
  else if (mq && mq.addListener) mq.addListener(onMQChange);   /* legacy Safari < 14 / old WebViews */

  /* ---------- tiny synth (asset-free) ----------
   * Gentle by design; low master gain; nothing sudden. Starts only after a user gesture. A mute
   * toggle owns `enabled`. Mobile: resume() on each note; a silent buffer unlock on first enable.
   */
  var Audio = {
    ctx: null, master: null, enabled: true, _started: false,
    /* the iOS/Android unlock ritual: a silent 1-sample buffer, replayed after every resume from
     * a non-running state (creation alone is not always enough on iOS) */
    _unlock: function () {
      try {
        var b = this.ctx.createBuffer(1, 1, 22050);
        var s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      } catch (e) {}
    },
    ensure: function () {
      if (!this.enabled) return false;
      if (!this._started) {
        try {
          var AC = global.AudioContext || global.webkitAudioContext;
          if (!AC) return false;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.16;
          this.master.connect(this.ctx.destination);
          this._started = true;
          this._unlock();
        } catch (e) { return false; }
      }
      if (this.ctx && this.ctx.state !== 'running') {
        try { this.ctx.resume(); } catch (e) {}
        this._unlock();
      }
      return !!this.ctx;
    },
    _tone: function (type, freq, t0, dur, peak, freqEnd) {
      t0 = t0 + 0.01;   /* a hair ahead of "now": a just-resumed mobile context can drop t=now events */
      var c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.04);
    },
    // a soft wooden tick when a glyph is placed (the pen touching down)
    place: function () {
      if (!this.ensure()) return;
      var t = this.ctx.currentTime;
      this._tone('triangle', 280, t, 0.07, 0.20, 210);
    },
    /* THE SOUND CONTRACT (r2 handpicked session; enforced, not aspirational):
     *  - the settle PITCH is a pure function of the settled state (the caller passes a state
     *    hash) — the same field always answers with the same tone; determinism made audible.
     *  - a SYMMETRIC field answers as a dyad (root + fifth) at EQUAL TOTAL ENERGY — a structural
     *    fact reported, never a reward.
     *  - PERMANENT SILENCES: no magnitude/count-aware pitch; no praise or triumph tones; no
     *    "humanization" jitter (an answer that differs each time you ask is a lie); texture, if
     *    it ever ships, stays visual — the ear hears only answers.  Do not reintroduce any. */
    settle: function (i, dyad) {
      if (!this.ensure()) return;
      var scale = [329.63, 392.0, 440.0, 523.25, 587.33];
      var f = scale[((i || 0) % scale.length + scale.length) % scale.length];
      var t = this.ctx.currentTime;
      if (dyad) {
        /* two voices at reduced peaks ~ one voice's energy: reported, not rewarded */
        this._tone('sine', f, t, 0.45, 0.06);
        this._tone('sine', f * 1.5, t, 0.45, 0.05);   /* the fifth */
        this._tone('sine', f * 2.005, t, 0.28, 0.02);
      } else {
        this._tone('sine', f, t, 0.45, 0.10);
        this._tone('sine', f * 2.005, t, 0.28, 0.03);
      }
    },
    // an honest no-op: the field did not change — one low, neutral tone, never a buzzer
    still: function () {
      if (!this.ensure()) return;
      var t = this.ctx.currentTime;
      this._tone('sine', 174.6, t, 0.30, 0.06);
    },
    // a glyph removed — a soft lift
    lift: function () {
      if (!this.ensure()) return;
      var t = this.ctx.currentTime;
      this._tone('sine', 220, t, 0.14, 0.07, 180);
    }
  };

  /* mobile resilience: iOS suspends ("interrupts") the context on backgrounding, calls, Siri —
   * resume when the page becomes visible again; and complete the unlock at the EARLIEST user
   * gesture anywhere on the page, not only the first sounded one. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Audio.ctx && Audio.ctx.state !== 'running') {
      try { Audio.ctx.resume(); } catch (e) {}
      Audio._unlock();
    }
  });
  function earlyUnlock() {
    Audio.ensure();
    document.removeEventListener('pointerdown', earlyUnlock, true);
    document.removeEventListener('touchstart', earlyUnlock, true);
    document.removeEventListener('keydown', earlyUnlock, true);
  }
  /* only where the field lives — the reading pages never sound, so they get no AudioContext */
  if (document.getElementById('grid') || document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (!document.getElementById('grid')) {
        document.removeEventListener('pointerdown', earlyUnlock, true);
        document.removeEventListener('touchstart', earlyUnlock, true);
        document.removeEventListener('keydown', earlyUnlock, true);
      }
    });
    document.addEventListener('pointerdown', earlyUnlock, true);
    document.addEventListener('touchstart', earlyUnlock, true);
    document.addEventListener('keydown', earlyUnlock, true);
  }

  global.LEXIS_ENGINE = { Motion: Motion, Audio: Audio };
})(window);

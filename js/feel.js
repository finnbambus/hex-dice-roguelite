// Game feel: the table shaking under a heavy hit, the lamp flaring, and numbers that count up instead of jumping.
// Nothing here touches the rules. Every effect is optional: shake has its own switch, and
// prefers-reduced-motion turns off shake, flare and counting together.
// Sound is a stub (`sound(name)`) so a synthesised WebAudio pass can be added later without touching the callers.

const STORE_KEY = 'hd-shake';

export class Feel {
  constructor({ board, lamp }) {
    this.board = board;
    this.lamp = lamp;
    this.tw = new Map(); // tween key → { from, to, start, dur }
    this.raf = 0;
    this.shakePref = true;
    try { this.shakePref = localStorage.getItem(STORE_KEY) !== 'off'; } catch { /* storage can be blocked */ }
    this.mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }

  get reduced() { return !!this.mq?.matches; }
  get shakeOn() { return this.shakePref && !this.reduced; }

  setShake(on) {
    this.shakePref = !!on;
    try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  }

  // Placeholder for the later audio pass: 'land', 'drop', 'tick', 'hit', 'slam', 'paid'.
  sound() {}

  // ---------------------------------------------------------------- heavy hits
  // level 1 = a thud (a big payout), 2 = a hit (the boss or the robber), 3 = a slam (a building lost, tribute paid or failed).
  hit(level, tone = 'bad') {
    this.sound(level >= 3 ? 'slam' : level === 2 ? 'hit' : 'thud');
    if (this.reduced) return;
    this.flare(level, tone);
    if (this.shakeOn) this.shake(level);
  }

  shake(level) {
    if (!this.board?.animate) return;
    const amp = [0, 3.5, 7, 12][level] || 3;
    const dur = [0, 300, 480, 720][level] || 300;
    const n = 9 + level * 2;
    const frames = [];
    for (let i = 0; i <= n; i++) {
      const k = (1 - i / n) ** 1.6; // decays to a standstill
      const s = i % 2 ? -1 : 1;
      const x = s * amp * k * (0.7 + Math.random() * 0.6);
      const y = -s * amp * 0.55 * k * (0.6 + Math.random() * 0.8);
      const r = s * level * 0.28 * k;
      frames.push({ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(3)}deg)` });
    }
    this.board.animate(frames, { duration: dur, easing: 'linear' });
  }

  // The lamp surges and settles. A good moment burns warmer, a bad one hotter and redder.
  flare(level, tone) {
    if (!this.lamp?.animate) return;
    const peak = [0, 1.7, 2.3, 3][level] || 1.7;
    const dur = [0, 520, 800, 1200][level] || 520;
    const hue = tone === 'good' ? 'hue-rotate(-8deg)' : 'hue-rotate(12deg) saturate(1.4)';
    this.lamp.animate([
      { filter: 'brightness(1)', offset: 0 },
      { filter: `brightness(${peak}) ${hue}`, offset: 0.1 },
      { filter: `brightness(${1 + (peak - 1) * 0.25})`, offset: 0.4 },
      { filter: 'brightness(1)', offset: 1 },
    ], { duration: dur, easing: 'ease-out' });
  }

  // ---------------------------------------------------------------- numbers that count
  // Starts counting `key` from `from` up to `to`, beginning `delay` ms from now. Elements carry data-ck="key".
  count(key, from, to, delay, dur) {
    if (this.reduced || from === to) { this.tw.delete(key); return; }
    this.tw.set(key, { from, to, start: performance.now() + delay, dur: Math.max(120, dur) });
    this.run();
  }

  // The number to show for `key` right now. `to` is what the game says; a running tween holds the display back.
  value(key, to) {
    const t = this.tw.get(key);
    if (!t) return to;
    return this.at(t, performance.now());
  }

  at(t, now) {
    if (now <= t.start) return t.from;
    const p = Math.min(1, (now - t.start) / t.dur);
    const e = 1 - (1 - p) ** 3;
    return Math.round(t.from + (t.to - t.from) * e);
  }

  active(key) { return this.tw.has(key); }

  run() {
    if (this.raf) return;
    const step = () => {
      const now = performance.now();
      for (const [key, t] of this.tw) {
        const v = this.at(t, now);
        const done = now >= t.start + t.dur;
        for (const n of document.querySelectorAll(`[data-ck="${key}"]`)) {
          if (n.textContent !== String(v)) n.textContent = v;
          if (done) {
            n.classList.remove('bump');
            void n.offsetWidth;
            n.classList.add('bump');
          }
        }
        if (done) this.tw.delete(key);
      }
      this.raf = this.tw.size ? requestAnimationFrame(step) : 0;
    };
    this.raf = requestAnimationFrame(step);
  }
}

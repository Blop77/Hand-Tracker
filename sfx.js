// Procedural sound effects (Web Audio API). No audio files: everything is synthesized.

let ac = null, out = null, noise = null, rv = null, muted = false;
const L = {};
const VOL = 0.7;

const T = (param, v, tc = 0.08) => param.setTargetAtTime(v, ac.currentTime, tc);
const rnd = (a, b) => a + Math.random() * (b - a);
const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; return o; };
const gain = (v = 0) => { const g = ac.createGain(); g.gain.value = v; return g; };
const filt = (type, f, q = 1) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
function noiseSrc() { const s = ac.createBufferSource(); s.buffer = noise; s.loop = true; return s; }
function shaper(k) {
  const ws = ac.createWaveShaper(), n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * (i / n * 2 - 1));
  ws.curve = c; return ws;
}
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

export function init() {
  if (ac) { ac.resume(); return; }
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noise = b;

  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  out = gain(muted ? 0 : VOL); out.connect(comp).connect(ac.destination);

  // cheap "space": filtered feedback delay used as a reverb send
  rv = gain(1);
  const dl = ac.createDelay(1), fb = gain(0.45), lp = filt("lowpass", 2500);
  dl.delayTime.value = 0.23; rv.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(out);

  // Blue: deep sub drone + swirling filtered wind
  {
    const g = gain(0); g.connect(out);
    const sub = osc("sine", 55), s2 = osc("sine", 110.5);
    sub.connect(gain(0.5)).connect(g); s2.connect(gain(0.18)).connect(g);
    const n = noiseSrc(), bp = filt("bandpass", 500, 5);
    n.connect(bp).connect(gain(0.6)).connect(g);
    const lfo = osc("sine", 0.7); lfo.connect(gain(350)).connect(bp.frequency);
    [sub, s2, n, lfo].forEach(x => x.start()); L.blue = g;
  }
  // Red: distorted buzzing hum + crackling static
  {
    const g = gain(0); g.connect(out);
    const a = osc("sawtooth", 82), c = osc("sawtooth", 83.7), ds = shaper(4);
    a.connect(ds); c.connect(ds); ds.connect(filt("lowpass", 900, 2)).connect(gain(0.18)).connect(g);
    const n = noiseSrc(), am = gain(0.12), lfo = osc("square", 17);
    lfo.connect(gain(0.12)).connect(am.gain);
    n.connect(filt("highpass", 1800)).connect(am).connect(g);
    [a, c, n, lfo].forEach(x => x.start()); L.red = g;
  }
  // Hollow Purple: rising charge whine + rumble
  {
    const g = gain(0); g.connect(out); g.connect(rv);
    const a = osc("sine", 120), c = osc("triangle", 180);
    a.connect(g); c.connect(gain(0.3)).connect(g);
    const n = noiseSrc(), lp2 = filt("lowpass", 400);
    n.connect(lp2).connect(gain(0.4)).connect(g);
    [a, c, n].forEach(x => x.start());
    Object.assign(L, { purple: g, pA: a, pB: c, pLP: lp2 });
  }
  // Infinite Void: shimmering ambient chord
  {
    const g = gain(0); g.connect(out); g.connect(rv);
    [110, 164.81, 220, 261.63, 329.63, 440].forEach((f, i) => {
      const o = osc(i % 2 ? "triangle" : "sine", f); o.detune.value = rnd(-7, 7);
      const og = gain(0.12), trem = osc("sine", 0.1 + i * 0.07);
      trem.connect(gain(0.06)).connect(og.gain);
      o.connect(og).connect(g); o.start(); trem.start();
    });
    const sh = osc("sine", 1760); sh.connect(gain(0.02)).connect(g); sh.start();
    L.dom = g;
  }
}

/* continuous layers, called every frame with 0..1 levels */
export function update(s, dt) {
  if (!ac) return;
  T(L.blue.gain, s.blue * 0.5);
  T(L.red.gain, s.red * 0.45);
  T(L.purple.gain, s.purple * 0.35);
  T(L.pA.frequency, s.pitch); T(L.pB.frequency, s.pitch * 1.5); T(L.pLP.frequency, 300 + s.pitch * 2);
  T(L.dom.gain, s.domain * 0.5, 0.4);
  if (s.red > 0.5 && Math.random() < dt * 10) crackle();
}

/* one-shots */
function boom(size = 1, t = ac.currentTime) {
  const o = osc("sine", 140), g = gain();
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.9 * size);
  env(g, t, 0.005, 0.9, 1.2 * size); o.connect(g).connect(out); o.start(t); o.stop(t + 1.5 * size);
  const n = noiseSrc(), lp = filt("lowpass", 4000), ng = gain();
  lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(80, t + 0.8 * size);
  env(ng, t, 0.003, 0.6, 0.9 * size); n.connect(lp).connect(ng); ng.connect(out); ng.connect(rv);
  n.start(t); n.stop(t + 1.4 * size);
}
function chime(freqs, t, vol = 0.15, dur = 2) {
  for (const f of freqs) {
    const o = osc("sine", f), g = gain(); env(g, t, 0.01, vol, dur);
    o.connect(g); g.connect(out); g.connect(rv); o.start(t); o.stop(t + dur + 0.1);
  }
}
function sweep(f0, f1, dur, vol, t, q = 3) {
  const n = noiseSrc(), bp = filt("bandpass", f0, q), g = gain();
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, dur * 0.3, vol, dur * 0.7); n.connect(bp).connect(g).connect(out);
  n.start(t, rnd(0, 1.5)); n.stop(t + dur + 0.1);
}

export function crackle() {
  if (!ac) return;
  const t = ac.currentTime, n = noiseSrc(), g = gain();
  env(g, t, 0.002, 0.35, 0.06);
  n.connect(filt("bandpass", rnd(1500, 5000), 2)).connect(g).connect(out);
  n.start(t, rnd(0, 1.5)); n.stop(t + 0.1);
}
export function fuse() { if (!ac) return; boom(0.8); chime([660, 990, 1320], ac.currentTime, 0.1, 1.8); }
export function fire() {
  if (!ac) return; const t = ac.currentTime;
  sweep(300, 4000, 0.35, 0.6, t, 1.5); boom(1.6, t + 0.05); sweep(3000, 150, 1.4, 0.5, t + 0.2, 1);
}
export function fizzle() { if (ac) sweep(2000, 200, 0.6, 0.3, ac.currentTime, 2); }
export function domainStart() {
  if (!ac) return; const t = ac.currentTime;
  sweep(100, 2500, 0.6, 0.4, t, 1); boom(1.8, t + 0.55);
  chime([220, 329.63, 440, 659.25, 880], t + 0.6, 0.08, 4);
}
export function domainEnd() {
  if (!ac) return; const t = ac.currentTime;
  // glass shatter: scattered high pings over a noise burst
  for (let i = 0; i < 14; i++) chime([rnd(2000, 6000)], t + rnd(0, 0.5), 0.05, rnd(0.15, 0.5));
  sweep(6000, 1500, 0.5, 0.4, t, 0.8); boom(0.7, t);
}

export function setMuted(m) { muted = m; if (ac) T(out.gain, m ? 0 : VOL, 0.03); }
export const isMuted = () => muted;

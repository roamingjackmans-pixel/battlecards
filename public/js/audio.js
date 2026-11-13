// Every sound is synthesized with Web Audio on the fly: nothing loads.
// Score ticks climb in pitch as a hand builds (the Balatro "donk donk DONK"), and the music speeds up
// when the timer runs low or your Life Points are in trouble.
let ac = null, master = null, sfxBus = null, musicBus = null;
const store = (() => { try { return localStorage; } catch { return null; } })();
let sfxOn = store ? store.getItem('bc_sfx') !== '0' : true;
let musicOn = store ? store.getItem('bc_music') !== '0' : true;

export const audioState = () => ({ sfx: sfxOn, music: musicOn });
export function setSfx(v) { sfxOn = !!v; store && store.setItem('bc_sfx', v ? '1' : '0'); if (sfxBus) sfxBus.gain.value = v ? 0.55 : 0; }
export function setMusic(v) { musicOn = !!v; store && store.setItem('bc_music', v ? '1' : '0'); if (musicBus) musicBus.gain.value = v ? 0.16 : 0; }

export function unlock() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.gain.value = sfxOn ? 0.55 : 0; sfxBus.connect(master);
    musicBus = ac.createGain(); musicBus.gain.value = musicOn ? 0.16 : 0; musicBus.connect(master);
  }
  if (ac.state === 'suspended') ac.resume();
}

function tone(freq, dur, opts) { try { tone_(freq, dur, opts); } catch (e) { console.warn('sfx', e); } }
function tone_(freq, dur, { type = 'sine', vol = 0.3, at = 0, slide = 0, attack = 0.005, bus = sfxBus, detune = 0 } = {}) {
  if (!ac || !bus || !isFinite(freq) || !isFinite(dur) || freq <= 0) return;
  const t0 = ac.currentTime + at;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); o.detune.value = detune;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(bus);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
let noiseBuf = null;
function noise(dur, opts) { try { noise_(dur, opts); } catch (e) { console.warn('sfx', e); } }
function noise_(dur, { vol = 0.2, at = 0, freq = 1200, q = 1, type = 'bandpass', attack = 0.005, sweep = 0, bus = sfxBus } = {}) {
  if (!ac || !bus || !isFinite(dur) || !isFinite(freq)) return;
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(bus);
  src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
}
const semi = (base, n) => base * Math.pow(2, n / 12);
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
/** The n-th note up the scale; any n (negative, fractional, huge) gives a real note. */
const sc = n => SCALE[Math.max(0, Math.min(SCALE.length - 1, Math.floor(+n) || 0))];

export const sfx = {
  click() { tone(700, 0.05, { type: 'triangle', vol: 0.12 }); },
  hover() { tone(1200, 0.03, { type: 'sine', vol: 0.04 }); },
  select(i = 0) { tone(semi(520, i * 2), 0.07, { type: 'triangle', vol: 0.16 }); },
  deselect() { tone(400, 0.06, { type: 'triangle', vol: 0.1, slide: 0.8 }); },
  deal(i = 0) { noise(0.06, { vol: 0.12, freq: 3000 + i * 200, q: 0.8, at: i * 0.045 }); },
  swoosh() { noise(0.22, { vol: 0.16, freq: 600, sweep: 6, q: 1.2 }); },
  /** n-th step in a scoring sequence: higher and brighter as the combo builds. */
  chip(n) { const f = semi(330, sc(n)); tone(f, 0.12, { type: 'square', vol: 0.07 }); tone(f * 2, 0.08, { type: 'sine', vol: 0.08 }); },
  mult(n) { const f = semi(440, sc(n)); tone(f, 0.16, { type: 'sawtooth', vol: 0.06 }); tone(f * 1.5, 0.12, { type: 'triangle', vol: 0.08, at: 0.02 }); },
  xmult(n) { const f = semi(220, sc(n)); tone(f, 0.35, { type: 'sawtooth', vol: 0.1, slide: 2 }); tone(f * 2, 0.3, { type: 'square', vol: 0.05, at: 0.03, slide: 2 }); noise(0.2, { vol: 0.1, freq: 5000, q: 3 }); },
  money() { tone(1320, 0.08, { type: 'square', vol: 0.06 }); tone(1760, 0.14, { type: 'square', vol: 0.06, at: 0.07 }); },
  total(big = 0) {
    tone(110, 0.5 + big * 0.2, { type: 'sawtooth', vol: 0.18, slide: 0.5 });
    noise(0.4 + big * 0.2, { vol: 0.25 + big * 0.1, freq: 200, type: 'lowpass' });
    if (big > 1) [0, 4, 7, 12].forEach((n, i) => tone(semi(523, n), 0.4, { type: 'triangle', vol: 0.1, at: 0.05 * i }));
  },
  fizzle() { tone(300, 0.3, { type: 'triangle', vol: 0.12, slide: 0.5 }); },
  buy() { tone(880, 0.07, { type: 'square', vol: 0.08 }); tone(1320, 0.12, { type: 'square', vol: 0.08, at: 0.06 }); noise(0.1, { vol: 0.06, freq: 6000, at: 0.05 }); },
  sell() { tone(1320, 0.06, { type: 'square', vol: 0.07 }); tone(990, 0.1, { type: 'square', vol: 0.07, at: 0.05 }); },
  reroll() { for (let i = 0; i < 6; i++) tone(600 + i * 90, 0.04, { type: 'square', vol: 0.05, at: i * 0.035 }); },
  nope() { tone(180, 0.18, { type: 'square', vol: 0.08 }); tone(150, 0.2, { type: 'square', vol: 0.08, at: 0.1 }); },
  squeak() { tone(1400, 0.12, { type: 'sine', vol: 0.12, slide: 1.6 }); tone(1800, 0.1, { type: 'sine', vol: 0.08, at: 0.1, slide: 0.7 }); },
  chomp() { noise(0.12, { vol: 0.35, freq: 400, q: 0.7 }); tone(90, 0.15, { type: 'square', vol: 0.15, slide: 0.5 }); noise(0.08, { vol: 0.25, freq: 900, at: 0.13 }); },
  rip() { noise(0.35, { vol: 0.3, freq: 1500, sweep: 3, q: 2 }); noise(0.2, { vol: 0.2, freq: 4000, at: 0.1, q: 1 }); },
  bonk() { tone(500, 0.18, { type: 'sine', vol: 0.3, slide: 0.35 }); noise(0.05, { vol: 0.2, freq: 2000 }); },
  boing() { tone(200, 0.35, { type: 'sine', vol: 0.2, slide: 3 }); },
  splat() { noise(0.25, { vol: 0.3, freq: 700, type: 'lowpass', sweep: 0.3 }); },
  zap() { for (let i = 0; i < 5; i++) tone(2000 - i * 300, 0.05, { type: 'sawtooth', vol: 0.06, at: i * 0.03 }); noise(0.2, { vol: 0.15, freq: 6000, q: 4 }); },
  shatter() { for (let i = 0; i < 8; i++) tone(2000 + Math.random() * 3000, 0.08, { type: 'sine', vol: 0.06, at: i * 0.02 }); noise(0.3, { vol: 0.2, freq: 6000, q: 0.5, type: 'highpass' }); },
  boom() { tone(70, 0.8, { type: 'sine', vol: 0.5, slide: 0.4 }); noise(0.7, { vol: 0.45, freq: 300, type: 'lowpass', sweep: 0.3 }); },
  clash() { tone(55, 1.2, { type: 'sawtooth', vol: 0.25, slide: 0.5 }); noise(1, { vol: 0.4, freq: 800, sweep: 0.2, q: 0.5 }); [0, 3, 7].forEach((n, i) => tone(semi(110, n), 0.9, { type: 'square', vol: 0.06, at: 0.02 * i })); },
  lpTick(i) { tone(900 - i * 6, 0.03, { type: 'square', vol: 0.05 }); },
  heartbeat() { tone(60, 0.15, { type: 'sine', vol: 0.5 }); tone(55, 0.18, { type: 'sine', vol: 0.4, at: 0.22 }); },
  heart() {
    noise(2.2, { vol: 0.25, freq: 400, sweep: 8, q: 0.4, attack: 1.5 });
    [0, 4, 7, 11, 14].forEach((n, i) => { tone(semi(261.6, n), 2.2, { type: 'sawtooth', vol: 0.05, at: 0.25 * i, attack: 0.4, detune: 7 }); tone(semi(261.6, n), 2.2, { type: 'sawtooth', vol: 0.05, at: 0.25 * i, attack: 0.4, detune: -7 }); });
    tone(1046, 0.6, { type: 'triangle', vol: 0.15, at: 1.8 });
  },
  tick(urgent) { tone(urgent ? 1500 : 1100, 0.04, { type: 'square', vol: urgent ? 0.08 : 0.04 }); },
  levelUp() { [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone(semi(392, n), 0.25, { type: 'square', vol: 0.07, at: i * 0.07 })); },
  victory() { [[0, 0], [4, 0.15], [7, 0.3], [12, 0.45], [7, 0.75], [12, 0.9]].forEach(([n, t]) => { tone(semi(392, n), 0.4, { type: 'square', vol: 0.09, at: t }); tone(semi(196, n), 0.4, { type: 'triangle', vol: 0.12, at: t }); }); },
  sadTrombone() { [[0, 0, 0.35], [-1, 0.4, 0.35], [-2, 0.8, 0.35], [-3, 1.2, 1.1]].forEach(([n, t, d]) => { tone(semi(233, n), d, { type: 'sawtooth', vol: 0.12, at: t, attack: 0.05 }); }); tone(semi(233, -3), 1.1, { type: 'sine', vol: 0.06, at: 1.2, slide: 0.94 }); },
  pop() { tone(900, 0.06, { type: 'sine', vol: 0.15, slide: 1.8 }); },
  chime() { [0, 7, 12].forEach((n, i) => tone(semi(784, n), 0.5, { type: 'sine', vol: 0.12, at: i * 0.09 })); },
  packOpen() { noise(0.5, { vol: 0.25, freq: 2500, sweep: 0.2, q: 0.5 }); for (let i = 0; i < 10; i++) tone(1500 + Math.random() * 2500, 0.1, { type: 'sine', vol: 0.05, at: 0.1 + i * 0.04 }); },
  reveal(rar) { const base = [0, 523, 659, 784, 1046][rar] || 523; [0, 4, 7].forEach((n, i) => tone(semi(base, n), 0.3 + rar * 0.1, { type: rar >= 3 ? 'sawtooth' : 'triangle', vol: 0.08, at: i * 0.06 })); if (rar >= 3) noise(0.6, { vol: 0.15, freq: 7000, q: 2 }); },
  taunt() { tone(600, 0.08, { type: 'square', vol: 0.06 }); tone(800, 0.1, { type: 'square', vol: 0.06, at: 0.08 }); },
};

// ---------------------------------------------------------------- music: a little bouncy loop
let musicTimer = null, step = 0, nextAt = 0, intensity = 0;
export function setIntensity(v) { intensity = Math.max(0, Math.min(2, v)); }
const PROG = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];   // C Am F G, in semitones from C
export function startMusic() {
  if (!ac || musicTimer) return;
  nextAt = ac.currentTime + 0.1; step = 0;
  musicTimer = setInterval(() => {
    if (!ac) return;
    const bpm = 104 + intensity * 22;
    const sp = 60 / bpm / 2;   // eighth notes
    while (nextAt < ac.currentTime + 0.25) {
      const bar = Math.floor(step / 8) % 4, beat = step % 8, chord = PROG[bar];
      const at = nextAt - ac.currentTime;
      // bass: root on 1 and 5, walking up on 7
      if (beat === 0 || beat === 4) tone(semi(65.4, chord[0]), sp * 1.6, { type: 'triangle', vol: 0.5, at, bus: musicBus });
      if (beat === 6) tone(semi(65.4, chord[0] + 7), sp * 0.9, { type: 'triangle', vol: 0.35, at, bus: musicBus });
      // plucky chord stabs on the off-beats
      if (beat % 2 === 1) chord.forEach(n => tone(semi(261.6, n), sp * 0.7, { type: 'square', vol: 0.045, at, bus: musicBus }));
      // a little melody that wanders around the chord
      if (beat === 0 || beat === 3 || (beat === 5 && bar % 2)) {
        const n = chord[(step * 7 + bar) % 3] + (beat === 3 ? 12 : 7);
        tone(semi(261.6, n), sp * 1.4, { type: 'triangle', vol: 0.12, at, bus: musicBus });
      }
      // drums
      if (beat === 0 || beat === 4) noise(0.12, { vol: 0.5, freq: 120, type: 'lowpass', at, bus: musicBus });
      if (beat === 2 || beat === 6) noise(0.1, { vol: 0.3, freq: 1800, q: 0.6, at, bus: musicBus });
      if (intensity > 0.5 || beat % 2 === 0) noise(0.03, { vol: 0.12 + intensity * 0.05, freq: 8000, type: 'highpass', at, bus: musicBus });
      nextAt += sp; step++;
    }
  }, 60);
}
export function stopMusic() { clearInterval(musicTimer); musicTimer = null; }

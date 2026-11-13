// Juice: the swirly background, particles (paper shreds, confetti, sparks, stars), screen shake,
// floating numbers and big comic-book shouts.
import { h } from './util.js';

const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- background: a slow psychedelic swirl (WebGL)
let bgMood = [0.36, 0.16, 0.55], bgMoodB = [0.95, 0.3, 0.45], bgTarget = null, bgSpeed = 1;
export function setBgMood(name) {
  const M = {
    home: [[0.36, 0.16, 0.55], [0.95, 0.3, 0.45]],
    battle: [[0.12, 0.28, 0.5], [0.2, 0.75, 0.6]],
    danger: [[0.5, 0.06, 0.1], [0.95, 0.35, 0.1]],
    heart: [[0.75, 0.45, 0.05], [1, 0.85, 0.4]],
    shop: [[0.4, 0.2, 0.08], [0.95, 0.6, 0.2]],
    win: [[0.1, 0.45, 0.25], [1, 0.85, 0.3]],
    lose: [[0.18, 0.18, 0.28], [0.4, 0.3, 0.55]],
  };
  bgTarget = M[name] || M.home;
  bgSpeed = name === 'danger' || name === 'heart' ? 2.2 : 1;
}
export function startBackground(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) { canvas.classList.add('nogl'); return; }
  const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
  const fs = `precision mediump float; uniform vec2 r; uniform float t; uniform vec3 ca; uniform vec3 cb;
  void main(){
    vec2 uv = (gl_FragCoord.xy - .5*r) / min(r.x, r.y);
    float d = length(uv);
    float a = atan(uv.y, uv.x);
    float sw = a + d * 3.2 - t * .25;
    for (int i = 0; i < 3; i++) { uv += .18 * vec2(sin(uv.y * 3. + t * .3 + sw), cos(uv.x * 2.7 - t * .25)); }
    float v = sin(uv.x * 3. + sin(uv.y * 2. + t * .2) * 2.) * .5 + .5;
    float bands = smoothstep(.35, .65, fract(v * 2.5 + d * .6));
    vec3 col = mix(ca, cb, bands * .6 + v * .25);
    col *= 1. - smoothstep(.4, 1.25, d) * .55;
    gl_FragColor = vec4(col, 1.);
  }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { canvas.classList.add('nogl'); return; }
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(pr, 'r'), uT = gl.getUniformLocation(pr, 't'), uA = gl.getUniformLocation(pr, 'ca'), uB = gl.getUniformLocation(pr, 'cb');
  let t = 0, last = performance.now();
  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    t += dt * (reduce ? 0.15 : bgSpeed);
    if (bgTarget) {
      for (let i = 0; i < 3; i++) { bgMood[i] += (bgTarget[0][i] - bgMood[i]) * dt * 1.5; bgMoodB[i] += (bgTarget[1][i] - bgMoodB[i]) * dt * 1.5; }
    }
    const scale = 0.35;
    const w = Math.max(1, Math.floor(innerWidth * scale)), hh = Math.max(1, Math.floor(innerHeight * scale));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; gl.viewport(0, 0, w, hh); }
    gl.uniform2f(uR, w, hh); gl.uniform1f(uT, t); gl.uniform3fv(uA, bgMood); gl.uniform3fv(uB, bgMoodB);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- particles
let pc, px, parts = [], running = false;
export function initParticles(canvas) { pc = canvas; px = canvas.getContext('2d'); resize(); addEventListener('resize', resize); }
function resize() { if (!pc) return; const d = Math.min(2, devicePixelRatio || 1); pc.width = innerWidth * d; pc.height = innerHeight * d; px.setTransform(d, 0, 0, d, 0, 0); }
function loop() {
  if (!parts.length) { running = false; px.clearRect(0, 0, innerWidth, innerHeight); return; }
  running = true;
  px.clearRect(0, 0, innerWidth, innerHeight);
  const now = performance.now();
  parts = parts.filter(p => now - p.born < p.life);
  for (const p of parts) {
    const k = (now - p.born) / p.life;
    p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
    p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    px.save();
    px.globalAlpha = Math.max(0, 1 - Math.pow(k, 3));
    px.translate(p.x, p.y); px.rotate(p.rot);
    if (p.kind === 'shred') {
      px.fillStyle = p.color; px.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      px.fillStyle = 'rgba(0,0,0,.18)'; px.fillRect(-p.w / 2, p.h / 2 - 2, p.w, 2);
    } else if (p.kind === 'star') {
      px.fillStyle = p.color; px.beginPath();
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, r = i % 2 ? p.w * 0.45 : p.w; px.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      px.closePath(); px.fill(); px.strokeStyle = '#24163a'; px.lineWidth = 2; px.stroke();
    } else if (p.kind === 'text') {
      px.font = `${p.w}px Bangers, Fredoka, sans-serif`; px.textAlign = 'center';
      px.lineWidth = 5; px.strokeStyle = '#24163a'; px.strokeText(p.text, 0, 0);
      px.fillStyle = p.color; px.fillText(p.text, 0, 0);
    } else if (p.kind === 'ring') {
      px.strokeStyle = p.color; px.lineWidth = 6 * (1 - k); px.beginPath(); px.arc(0, 0, p.w * (0.2 + k * 1.6), 0, Math.PI * 2); px.stroke();
    } else {
      px.fillStyle = p.color; px.beginPath(); px.arc(0, 0, p.w * (1 - k * 0.6), 0, Math.PI * 2); px.fill();
    }
    px.restore();
  }
  requestAnimationFrame(loop);
}
function add(p) {
  if (reduce && parts.length > 40) return;
  parts.push(Object.assign({ born: performance.now(), life: 1200, vx: 0, vy: 0, g: 0.25, drag: 0.985, rot: 0, vr: 0, w: 8, h: 8, color: '#fff', kind: 'dot' }, p));
  if (!running) requestAnimationFrame(loop);
}
const R = (a, b) => a + Math.random() * (b - a);
const PAPER = ['#fffaf0', '#fff', '#f3ead8', '#ffe7c2'];
const CONF = ['#ff4f6d', '#ffd43b', '#4aa3ff', '#3ecf6e', '#c86bff', '#ff9a3c'];

export function shreds(x, y, n = 26, colors = PAPER) {
  for (let i = 0; i < n; i++) add({ kind: 'shred', x, y, vx: R(-7, 7), vy: R(-10, -2), g: 0.35, w: R(3, 7), h: R(12, 26), rot: R(0, 6), vr: R(-0.3, 0.3), color: colors[i % colors.length], life: R(900, 1700) });
}
export function confetti(x, y, n = 60) {
  for (let i = 0; i < n; i++) add({ kind: 'shred', x, y, vx: R(-9, 9), vy: R(-16, -4), g: 0.3, w: R(5, 9), h: R(8, 14), rot: R(0, 6), vr: R(-0.4, 0.4), color: CONF[i % CONF.length], life: R(1400, 2600) });
}
export function stars(x, y, n = 8, color = '#ffe14d') {
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; add({ kind: 'star', x, y, vx: Math.cos(a) * R(3, 7), vy: Math.sin(a) * R(3, 7) - 2, g: 0.18, w: R(6, 11), vr: R(-0.2, 0.2), color, life: R(700, 1100) }); }
}
export function sparks(x, y, n = 14, color = '#ffd43b') {
  for (let i = 0; i < n; i++) add({ x, y, vx: R(-6, 6), vy: R(-7, 3), g: 0.12, w: R(2, 4), color, life: R(400, 800) });
}
export function ring(x, y, color = '#fff', size = 60) { add({ kind: 'ring', x, y, g: 0, w: size, color, life: 500 }); }
export function textPop(x, y, text, color = '#ffd43b', size = 34) {
  add({ kind: 'text', x, y, vy: -3.5, vx: R(-1, 1), g: 0.08, drag: 0.97, rot: R(-0.25, 0.25), vr: R(-0.01, 0.01), text, color, w: size, life: 1100 });
}

// ---------------------------------------------------------------- shake, flash, shouts
let shakeEl = null;
export function setShakeTarget(el) { shakeEl = el; }
export function shake(power = 1, ms = 300) {
  if (!shakeEl || reduce) return;
  const p = Math.min(power, 4) * 6;
  const kf = [];
  for (let i = 0; i < 8; i++) kf.push({ transform: `translate(${R(-p, p)}px, ${R(-p, p)}px) rotate(${R(-p, p) * 0.08}deg)` });
  kf.push({ transform: 'none' });
  shakeEl.animate(kf, { duration: ms, easing: 'ease-out' });
}
export function flash(color = '#fff', ms = 250) {
  const el = h('div.flash', { style: { background: color } });
  document.body.append(el);
  el.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }).onfinish = () => el.remove();
}
/** A big comic shout across the screen ("CHOMP!", "CLASH!"). */
export function shout(text, { color = '#ffd43b', size = 90, ms = 1100, sub = '', tilt = -6, cls = '' } = {}) {
  const el = h('div.shout' + (cls ? '.' + cls : ''), { style: { '--c': color, '--s': size + 'px', '--tilt': tilt + 'deg' } }, h('span.shout-main', text), sub ? h('span.shout-sub', sub) : null);
  document.body.append(el);
  el.animate([
    { transform: `translate(-50%,-50%) scale(.2) rotate(${tilt * 3}deg)`, opacity: 0 },
    { transform: `translate(-50%,-50%) scale(1.15) rotate(${tilt}deg)`, opacity: 1, offset: 0.15 },
    { transform: `translate(-50%,-50%) scale(1) rotate(${tilt}deg)`, opacity: 1, offset: 0.25 },
    { transform: `translate(-50%,-50%) scale(1.03) rotate(${tilt}deg)`, opacity: 1, offset: 0.8 },
    { transform: `translate(-50%,-50%) scale(1.4) rotate(${tilt}deg)`, opacity: 0 },
  ], { duration: ms, easing: 'ease-out' }).onfinish = () => el.remove();
  return el;
}
/** A floating label above an element ("+4 Mult"). */
export function floatAt(el, text, cls = '') {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const f = h('div.float' + (cls ? '.' + cls : ''), text);
  f.style.left = (r.left + r.width / 2) + 'px';
  f.style.top = (r.top + 6) + 'px';
  document.body.append(f);
  f.animate([
    { transform: 'translate(-50%, 0) scale(.4)', opacity: 0 },
    { transform: 'translate(-50%, -22px) scale(1.25)', opacity: 1, offset: 0.2 },
    { transform: 'translate(-50%, -34px) scale(1)', opacity: 1, offset: 0.7 },
    { transform: 'translate(-50%, -48px) scale(.9)', opacity: 0 },
  ], { duration: 900, easing: 'ease-out' }).onfinish = () => f.remove();
}
export function centerOf(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
/** Bounce an element (a monster that just triggered, a card that scored). */
export function jiggle(el, power = 1) {
  if (!el) return;
  el.animate([
    { transform: 'scale(1) rotate(0)' },
    { transform: `scale(${1 + 0.25 * power}, ${1 - 0.15 * power}) rotate(${-6 * power}deg)` },
    { transform: `scale(${1 - 0.1 * power}, ${1 + 0.2 * power}) rotate(${5 * power}deg)` },
    { transform: 'scale(1) rotate(0)' },
  ], { duration: 260, easing: 'ease-out', composite: 'add' });
}
export const fxReduce = reduce;

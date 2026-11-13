// Small helpers shared by every module. No page code at the top level, so the engine can run in Node for tests.

/** Seeded random numbers (mulberry32). The state is a plain object so a run can be saved and copied. */
export function makeRng(seed) { return { s: (seed >>> 0) || 1 }; }
export function rand(r) {
  r.s = (r.s + 0x6D2B79F5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randInt = (r, lo, hi) => lo + Math.floor(rand(r) * (hi - lo + 1));
export const chance = (r, p) => rand(r) < p;
export function pick(r, arr) { return arr[Math.floor(rand(r) * arr.length)]; }
export function shuffle(r, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand(r) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
export function weighted(r, items, w) {
  let tot = 0; for (const it of items) tot += w(it);
  let x = rand(r) * tot;
  for (const it of items) { x -= w(it); if (x <= 0) return it; }
  return items[items.length - 1];
}
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Numbers the way a scoreboard should show them: commas, then e-notation once they get silly. */
export function fmt(n) {
  if (!isFinite(n)) return '∞';
  n = Math.round(n);
  if (Math.abs(n) >= 1e11) return n.toExponential(2).replace('e+', 'e');
  return n.toLocaleString('en-US');
}
export const fmtMult = x => (Math.round(x * 100) / 100).toString();

export const randomId = (n = 12) => {
  const a = new Uint8Array(n);
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(a);
  return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
};

/** Tiny element builder: h('div.card.big', {onclick}, child, 'text'). */
export function h(sel, attrs, ...kids) {
  let id = null;
  sel = sel.replace(/#([\w-]+)/, (m, x) => { id = x; return ''; });
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (id) el.id = id;
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return () => { this._h[ev] = (this._h[ev] || []).filter(f => f !== fn); }; }
  emit(ev, ...a) { for (const f of [...(this._h[ev] || [])]) { try { f(...a); } catch (e) { console.error(e); } } }
}

export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** requestAnimationFrame with a timer fallback, so game logic waiting on an animation never stalls in a hidden or occluded window. */
export const frame = fn => {
  let done = false;
  const go = t => { if (done) return; done = true; fn(t || performance.now()); };
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(go);
  setTimeout(() => go(performance.now()), 100);
};

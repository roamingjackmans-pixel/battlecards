// Shared bits of page: toasts, modals, tooltips, popovers, monster and item cards.
import { h, $, escapeHtml } from './util.js';
import { MON_BY_ID, RARITY, EDITIONS, monsterDesc } from './monsters.js';
import { ITEM_BY_ID, GREM_BY_ID } from './items.js';
import { monsterSVG, avatarSpec } from './art.js';
import { sfx } from './audio.js';

export function toast(content, { ms = 4200, cls = '', av = null, buttons = null } = {}) {
  const t = h('div.toast' + (cls ? '.' + cls : ''));
  if (av) t.append(h('div.tav', { html: monsterSVG(av) }));
  const body = h('div.tbody');
  if (typeof content === 'string') body.innerHTML = content; else body.append(content);
  t.append(body);
  let timer;
  const close = () => { clearTimeout(timer); t.style.transition = 'opacity .25s, transform .25s'; t.style.opacity = 0; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 260); };
  if (buttons) {
    const row = h('div.tbtns');
    for (const b of buttons) row.append(h('button.btn.small' + (b.cls ? '.' + b.cls : ''), { onclick: () => { close(); b.fn && b.fn(); } }, b.label));
    t.append(row);
  }
  $('#toasts').append(t);
  if (ms) timer = setTimeout(close, ms);
  return { el: t, close };
}

export function modal(build, { wide = false, onClose = null, closable = true } = {}) {
  const bg = h('div.modal-bg');
  const m = h('div.modal' + (wide ? '.wide' : ''));
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
  const esc = e => { if (e.key === 'Escape' && closable) close(); };
  if (closable) {
    m.append(h('button.x-close', { onclick: () => { sfx.click(); close(); }, 'aria-label': 'Close' }, '✕'));
    bg.addEventListener('pointerdown', e => { if (e.target === bg) close(); });
    document.addEventListener('keydown', esc);
  }
  build(m, close);
  bg.append(m);
  $('#modals').append(bg);
  return { el: m, close };
}

// ---------------------------------------------------------------- tooltips (hover on desktop, long-press on phones)
let tipEl = null;
export function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }
export function showTip(target, html) {
  hideTip();
  tipEl = h('div.tip', { html });
  document.body.append(tipEl);
  const r = target.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
  let x = r.left + r.width / 2 - t.width / 2, y = r.top - t.height - 10;
  if (y < 6) y = r.bottom + 10;
  x = Math.max(6, Math.min(innerWidth - t.width - 6, x));
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
export function tip(el, fn) {
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showTip(el, fn()); });
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('pointerdown', hideTip);
  return el;
}

// ---------------------------------------------------------------- popover (click a monster, an item…)
let popEl = null;
export function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
export function popover(target, build) {
  closePop(); hideTip();
  popEl = h('div.pop');
  build(popEl);
  document.body.append(popEl);
  const r = target.getBoundingClientRect(), p = popEl.getBoundingClientRect();
  let x = r.left + r.width / 2 - p.width / 2, y = r.bottom + 10;
  if (y + p.height > innerHeight - 6) y = r.top - p.height - 10;
  x = Math.max(6, Math.min(innerWidth - p.width - 6, x));
  popEl.style.left = x + 'px'; popEl.style.top = Math.max(6, y) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', outside, { capture: true }), 0);
  function outside(e) { if (popEl && !popEl.contains(e.target) && !target.contains(e.target)) { closePop(); document.removeEventListener('pointerdown', outside, { capture: true }); } }
  return popEl;
}

// ---------------------------------------------------------------- monsters & items
export function monTipHTML(m) {
  const d = MON_BY_ID[m.id];
  const R = RARITY[d.rar];
  const ed = m.ed ? `<div class="desc"><b>${EDITIONS[m.ed].name}:</b> ${EDITIONS[m.ed].desc}</div>` : '';
  return `<div class="tn">${escapeHtml(d.name)}</div><div class="tr" style="color:${R.color}">${R.name}</div>
    <div class="desc">${m.st ? monsterDesc(m) : (typeof d.desc === 'function' ? d.desc({ st: initState(d) }) : d.desc)}</div>${ed}<div class="tq">“${escapeHtml(d.quip)}”</div>`;
}
function initState(d) { const m = { st: {} }; d.init && d.init(m); return m.st; }
export function monEl(m, { mini = false, onclick = null, idx = 0 } = {}) {
  const d = MON_BY_ID[m.id];
  const el = h('div.mon' + (mini ? '.mini' : '') + (m.ed ? '.ed-' + m.ed : ''), { style: { '--rc': RARITY[d.rar].color, '--d': (-idx * 0.37) + 's' }, 'data-uid': m.uid || '' },
    h('div.mon-card'),
    h('div.mon-art', { html: monsterSVG(d.art) }),
    mini ? null : h('div.mon-name', d.name),
    m.ed && !mini ? h('span.ed-tag', EDITIONS[m.ed].name) : null);
  tip(el, () => monTipHTML(m));
  if (onclick) el.addEventListener('click', e => { hideTip(); onclick(e, el); });
  return el;
}
export function emptyMon() { return h('div.mon.empty', h('div.mon-card')); }

export function itemTipHTML(id) {
  const d = ITEM_BY_ID[id];
  const kind = d.kind === 'tome' ? 'Tome' : d.kind === 'trap' ? 'Trap card' : 'Spell';
  return `<div class="tn">${d.art} ${escapeHtml(d.name)}</div><div class="tr" style="color:${d.kind === 'trap' ? '#8a2be2' : d.kind === 'tome' ? '#2a5cc4' : '#1a7a5c'}">${kind}</div><div class="desc">${d.desc}</div>`;
}
export function itemEl(it, { onclick = null, set = false } = {}) {
  const d = ITEM_BY_ID[it.id];
  const el = h('div.item.' + d.kind + (set ? '.set' : ''), h('div.ie', set ? '' : d.art), h('div.in', set ? '' : d.name));
  if (set) { el.append(h('div.ie', d.art)); el.append(h('div.in', 'SET')); }
  tip(el, () => itemTipHTML(it.id));
  if (onclick) el.addEventListener('click', e => { hideTip(); onclick(e, el); });
  return el;
}
export function gremTipHTML(id) {
  const g = GREM_BY_ID[id];
  return `<div class="tn">${escapeHtml(g.name)}</div><div class="desc">${g.desc}</div><div class="desc">Costs <b class=g>$${g.cost}</b>. Raises your income by <b class=g>$${g.eco}</b> a round (eco).</div>`;
}
export const avatarOf = (av, code) => (av && MON_BY_ID[av] ? MON_BY_ID[av].art : avatarSpec(code || 'x'));

export function copyText(text) {
  try { navigator.clipboard.writeText(text); return true; } catch { return false; }
}

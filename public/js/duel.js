// One duel: the controller (host-driven phases over the DuelLink) and the battle, shop and clash screens.
//
// Both duelists play their own rounds at the same time on their own screen. The host (who made the room)
// runs the clock: pick a starter monster -> battle (90 s) -> clash -> shop (40 s) -> battle ...
// Each side scores its own hands; the host works out each clash from both scores and tells the guest.
// Gremlins go straight to the rival, who applies them (traps and Bouncer Bear get the first go) and
// answers with what happened.
import * as E from './engine.js';
import { RULES } from './engine.js';
import { h, $, $$, fmt, fmtMult, sleep, clamp, makeRng, rand, pick, Emitter, frame } from './util.js';
import { HAND_BY_ID, SUITS, cardShort, rankLabel, handBase, evalHand } from './cards.js';
import { MON_BY_ID, RARITY, EDITIONS } from './monsters.js';
import { ITEM_BY_ID, GREMLINS, GREM_BY_ID, BOSS_BY_ID, bossDesc, ECO_CAP } from './items.js';
import { monsterSVG, cardHTML, backHTML } from './art.js';
import { sfx, setIntensity } from './audio.js';
import * as FX from './fx.js';
import { toast, modal, tip, hideTip, popover, closePop, monEl, emptyMon, itemEl, gremTipHTML, avatarOf, monTipHTML, itemTipHTML } from './ui.js';
import { EMOTES } from './profile.js';

const now = () => Date.now();
const bossFor = (seed, r) => (r % 3 === 0 ? E.pickBoss(makeRng(seed * 31 + r * 7919)) : null);

export class Duel extends Emitter {
  /** opts: { link, role: 'host'|'guest', me: hello, rival: hello, seed, friendly } */
  constructor(app, opts) {
    super();
    this.app = app; this.link = opts.link; this.role = opts.role; this.isHost = opts.role === 'host';
    this.meInfo = opts.me; this.rival = opts.rival; this.seed = opts.seed; this.friendly = !!opts.friendly;
    const prof = app.profile.data;
    this.run = E.newRun(this.seed, { pool: prof.unlocked.slice() });
    this.opp = { lp: RULES.lp, atk: 0, hands: RULES.hands, mons: [], traps: 0, heart: 0, ph: 'pick', done: false, ready: false, gold: 0 };
    this.phase = 'intro'; this.round = 0; this.deadline = 0;
    this.sel = new Set(); this.busy = false; this.cardEls = new Map(); this.gremQ = []; this.cds = {};
    this.host = { picked: {}, done: {}, atk: {}, info: {}, ready: {}, resolved: 0 };
    this.offs = []; this.timers = []; this.over = false; this.sort = 'rank';
    this.pendingGrem = new Map();
    this.lastEmote = 0;
  }

  // ================================================================ setup / teardown
  start() {
    this.offs.push(this.link.on('msg', m => this.onMsg(m)));
    this.offs.push(this.link.on('lost', () => this.connWobble(true)));
    this.offs.push(this.link.on('back', () => this.connWobble(false)));
    this.offs.push(this.link.on('bye', () => this.rivalLeft()));
    this.build();
    this.tickT = setInterval(() => this.tick(), 200);
    this.stT = setInterval(() => this.sendState(), 1500);
    this.app.social && this.app.social.setStatus('dueling');
    this.vsIntro().then(() => { if (this.isHost) this.hostPhase('pick'); });
    this.keyH = e => this.onKey(e);
    addEventListener('keydown', this.keyH);
    this.resizeH = () => this.layoutHand();
    addEventListener('resize', this.resizeH);
  }
  destroy() {
    for (const f of this.offs) f();
    clearInterval(this.tickT); clearInterval(this.stT);
    for (const t of this.timers) clearTimeout(t);
    removeEventListener('keydown', this.keyH); removeEventListener('resize', this.resizeH);
    this.layer && this.layer.remove();
    $$('.overlay').forEach(o => o.remove());
    closePop(); hideTip(); setIntensity(0);
    if (this.netBanner) this.netBanner.remove();
  }
  later(fn, ms) { const t = setTimeout(fn, ms); this.timers.push(t); return t; }

  // ================================================================ network
  send(m, reliable = true) { this.link.send(m, reliable); }
  sendState() {
    const r = this.run;
    this.send({ t: 'st', lp: r.lp, atk: r.atk, hands: r.hands, disc: r.discards, gold: r.gold, mons: r.monsters.map(m => [m.id, m.ed]), traps: r.traps.length, heart: Math.round(r.heart), ph: this.phase, done: !!r.done, ready: !!this.myReady, r: this.round }, false);
  }
  onMsg(m) {
    const o = this.opp;
    switch (m.t) {
      case 'st':
        if (m.r !== undefined && m.r < this.round - 1) return;
        Object.assign(o, { atk: m.r === this.round ? m.atk : o.atk, hands: m.hands, disc: m.disc, gold: m.gold, mons: m.mons, traps: m.traps, heart: m.heart, ph: m.ph, done: m.done, ready: m.ready });
        if (this.phase !== 'clash' && this.phase !== 'over' && typeof m.lp === 'number' && !this.lpLock) o.lp = m.lp;
        this.renderOpp();
        break;
      case 'phase': if (!this.isHost) this.applyPhase(m); break;
      case 'picked': if (this.isHost) this.hostEvent('picked', 'g', m); break;
      case 'done': if (this.isHost) this.hostEvent('done', 'g', m); o.done = true; o.atk = m.atk; this.rivalDone(m.atk); break;
      case 'cdone': if (this.isHost) this.hostEvent('cdone', 'g', m); break;
      case 'ready': if (this.isHost) this.hostEvent('ready', 'g', m); o.ready = true; this.renderOpp(); break;
      case 'clash': if (!this.isHost) this.playClash(m); break;
      case 'hand': this.rivalHand(m); break;
      case 'grem': this.gremQ.push(m); this.drainGrem(); break;
      case 'gremr': this.gremResult(m); break;
      case 'heart': this.rivalHeart(); break;
      case 'emote': this.showEmote(m.e, false); break;
      case 'forfeit': this.rivalLeft(true); break;
      case 'rematch': this.emit('rematch', m); break;
      case 'restart': this.emit('restart', m); break;
    }
  }
  connWobble(bad) {
    if (this.over) return;
    if (bad) {
      if (!this.netBanner) { this.netBanner = h('div.netbanner', '📡 Your rival\'s connection is wobbling…'); document.body.append(this.netBanner); }
      this.lostAt = now();
      clearTimeout(this.lostT);
      this.lostT = this.later(() => { if (this.link.isLost) this.rivalLeft(); }, 45000);
    } else {
      if (this.netBanner) { this.netBanner.remove(); this.netBanner = null; }
      clearTimeout(this.lostT);
    }
  }
  rivalLeft(forfeit) {
    if (this.over) return;
    this.finish({ forfeit: true, won: true, note: forfeit ? `${this.rival.name} ran away! Their monsters are very embarrassed.` : `${this.rival.name} vanished. You win by forfeit!` });
  }
  forfeit() {
    if (this.over) return;
    this.send({ t: 'forfeit' });
    this.finish({ forfeit: true, won: false, note: 'You ran away. Your monsters will remember this.' });
  }

  // ================================================================ host: the clock
  hostPhase(ph, extra = {}) {
    const r = ph === 'battle' ? this.round + 1 : this.round;
    const sec = { pick: RULES.pickSec, battle: RULES.battleSec, shop: RULES.shopSec }[ph] || 0;
    const m = { t: 'phase', ph, r, ms: sec * 1000, boss: ph === 'battle' ? bossFor(this.seed, r) : null, ...extra };
    this.send(m);
    this.applyPhase(m);
    clearTimeout(this.hostT);
    if (ph === 'pick') this.hostT = this.later(() => this.hostPhase('battle'), sec * 1000 + 3000);
    if (ph === 'battle') { this.host.done = {}; this.host.atk = {}; this.host.info = {}; this.hostT = this.later(() => this.hostResolve(), sec * 1000 + 6000); }
    if (ph === 'shop') { this.host.ready = {}; this.hostT = this.later(() => this.hostPhase('battle'), sec * 1000 + 2500); }
  }
  hostEvent(kind, side, m) {
    const H = this.host;
    if (kind === 'picked') { H.picked[side] = true; if (H.picked.h && H.picked.g && this.phase === 'pick') this.hostPhase('battle'); }
    if (kind === 'done') {
      if (m.r !== this.round) return;
      H.done[side] = true; H.atk[side] = m.atk; H.info[side] = m;
      if (H.done.h && H.done.g) this.hostResolve();
    }
    if (kind === 'cdone') { if (m.r !== this.round) return; H.cdone = H.cdone || {}; H.cdone[side] = true; if (H.cdone.h && H.cdone.g && this.phase !== 'shop' && !this.over) { clearTimeout(this.hostT); this.hostPhase('shop'); } }
    if (kind === 'ready') { if (m.r !== this.round) return; H.ready[side] = true; if (H.ready.h && H.ready.g && this.phase === 'shop') this.hostPhase('battle'); }
  }
  hostResolve() {
    const H = this.host;
    if (H.resolved === this.round || this.over) return;
    H.resolved = this.round;
    clearTimeout(this.hostT);
    if (!H.done.h) this.finishBattle(true);
    const a = H.info.h || { atk: this.run.atk, mons: this.run.monsters.length, traps: this.run.traps.map(t => t.id) };
    const b = H.info.g || { atk: this.opp.atk || 0, mons: this.opp.mons.length, traps: [] };
    const res = E.clashResult(this.round, bossFor(this.seed, this.round), a, b);
    const m = { t: 'clash', r: this.round, res, atk: { a: a.atk, b: b.atk } };
    this.send(m);
    this.playClash(m);
    H.cdone = {};
    this.hostT = this.later(() => { if (!this.over && this.phase !== 'shop') this.hostPhase('shop'); }, RULES.clashSec * 1000 + 4000);
  }

  // ================================================================ phases (both sides)
  applyPhase(m) {
    if (this.over) return;
    this.deadline = now() + m.ms;
    // a new shop or round always gets the screen back, even if a clash animation is somehow still up
    if (m.ph === 'shop' || m.ph === 'battle') { this.closeClashOverlay(); this.lpLock = false; }
    if (m.ph === 'pick') { this.phase = 'pick'; this.showPick(); }
    else if (m.ph === 'battle') {
      if (m.r <= this.round && this.phase === 'battle') return;
      this.round = m.r; this.phase = 'battle'; this.myReady = false;
      if (this.pickChoices && !this.run.monsters.length) this.choosePick(this.pickChoices[0]);
      this.startBattle(m.boss);
    } else if (m.ph === 'shop') {
      if (this.phase === 'shop' && this.round === m.r) return;
      this.phase = 'shop'; this.startShop();
    }
    this.renderAll();
  }
  tick() {
    const left = Math.max(0, this.deadline - now());
    const t = $('#timer', this.root);
    if (t) {
      const total = (this.phase === 'battle' ? RULES.battleSec : this.phase === 'shop' ? RULES.shopSec : RULES.pickSec) * 1000;
      t.style.setProperty('--p', clamp(left / total, 0, 1));
      const s = Math.ceil(left / 1000);
      t.querySelector('span').textContent = this.phase === 'clash' || this.phase === 'intro' ? '⚔' : s;
      const urgent = s <= 10 && (this.phase === 'battle' || this.phase === 'shop') && !(this.phase === 'battle' && this.run.done);
      t.classList.toggle('urgent', urgent);
      if (urgent && s !== this.lastTickS) { this.lastTickS = s; sfx.tick(s <= 5); }
    }
    // music speeds up when time is short or you're in danger
    let inten = 0;
    if (this.phase === 'battle' && !this.run.done) inten += left < 15000 ? 1 : 0.3;
    if (this.run.lp < RULES.lp * 0.3) inten += 0.7;
    setIntensity(inten);
    if (left <= 0) {
      if (this.phase === 'battle' && !this.run.done && !this.busy) this.finishBattle(true);
      if (this.phase === 'shop' && !this.myReady) this.readyUp(true);
      if (this.phase === 'pick' && !this.run.monsters.length && this.pickChoices) this.choosePick(this.pickChoices[0]);
    }
    this.updateGate();
  }

  // ================================================================ building the screen
  build() {
    const app = $('#app');
    app.innerHTML = '';
    this.root = h('div.screen.duel');
    this.root.append(
      h('div.opp#opp'),
      h('div.side#side'),
      h('div.board#board',
        h('div.zones#zones'),
        h('div.playzone#play'),
        h('div.handzone#handzone', h('div.deckpile#deck')),
        h('div.hand-hint#hint'),
        h('div.actions#actions')),
      h('div.gate#gate'));
    app.append(this.root);
    this.layer = h('div', { style: { position: 'fixed', inset: 0, zIndex: 30, pointerEvents: 'none' } });
    document.body.append(this.layer);
    FX.setShakeTarget(this.root);
    FX.setBgMood('battle');
    this.renderAll();
  }
  renderAll() { this.renderOpp(); this.renderSide(); this.renderZones(); this.renderActions(); this.renderGate(); this.renderDeck(); if (this.phase === 'battle') this.layoutHand(); }

  renderOpp() {
    const el = $('#opp', this.root); if (!el) return;
    const o = this.opp, rv = this.rival;
    const lpPct = clamp(o.lp / RULES.lp, 0, 1) * 100;
    el.innerHTML = '';
    const av = h('div.oav#oppav', { html: monsterSVG(avatarOf(rv.av, rv.code)) });
    const status = this.phase === 'battle' ? (o.done ? 'DONE ✔' : 'Battling…') : this.phase === 'shop' ? (o.ready ? 'READY ✔' : 'Shopping…') : this.phase === 'pick' ? 'Picking…' : '';
    el.append(...[
      av,
      h('div', h('div.oname', rv.name), h('div.osub', `Lv ${rv.lvl || 1} · ${rv.title || ''}`)),
      h('div.lpbox', h('div.lpnum', h('small', 'LP'), fmt(Math.max(0, o.lp))), h('div.lpbar' + (lpPct < 30 ? '.low' : ''), h('i', { style: { width: lpPct + '%' } })), h('div.heartmini', '♥ ' + (o.heart >= 100 ? 'HEART READY!' : o.heart + '%'))),
      h('div.oatk', h('div.lbl', 'Rival ATK'), h('div.num#oppatk', fmt(o.atk || 0)), h('div.pips', ...Array.from({ length: Math.max(o.hands || 0, 0) }, () => h('i')))),
      status ? h('div.ostatus' + (o.done || o.ready ? '.done' : ''), status) : null,
      h('div.otraps', ...Array.from({ length: o.traps || 0 }, () => tip(h('div.tcard'), () => '<div class="tn">Face-down trap</div><div class="desc">Your rival set a trap. It springs when you send a gremlin or at the clash.</div>'))),
      h('div.omons#oppmons', ...(o.mons || []).map(([id, ed], i) => monEl({ id, ed }, { mini: true, idx: i }))),
    ].filter(Boolean));
  }

  renderSide() {
    const el = $('#side', this.root); if (!el) return;
    const r = this.run;
    const lpPct = clamp(r.lp / RULES.lp, 0, 1) * 100;
    const boss = r.boss && this.phase === 'battle' ? r.boss : (this.phase === 'shop' && bossFor(this.seed, this.round + 1));
    el.innerHTML = '';
    el.append(...[
      h('div.roundbox', h('div', h('div.rnd', this.phase === 'shop' ? 'SHOP' : `ROUND ${this.round || 1}`), h('div', { style: { fontSize: '12px', color: '#cdb8e6' } }, this.round >= 10 ? '☠ SUDDEN DEATH x2' : boss && this.phase === 'battle' ? 'BOSS CLASH x1.5' : 'Clash at 0:00')), h('div.timer#timer', h('span', '90'))),
      boss ? h('div.bossbox', h('div.bav', { html: monsterSVG(BOSS_BY_ID[boss.id].art) }), h('div', h('b', (this.phase === 'shop' ? 'NEXT: ' : '') + BOSS_BY_ID[boss.id].name), h('span', { html: bossDesc(boss) }))) : null,
      h('div.handname#handname', h('div.hn', this.phase === 'battle' ? 'Pick cards' : this.phase === 'shop' ? 'Shop time!' : '…'), h('div.hl', '')),
      h('div.cxm', h('div.box.chips#chips', '0'), h('span.times', '×'), h('div.box.mult#mult', '0')),
      h('div.scorebox#scorebox', h('div.lbl', 'Your ATK this round'), h('div.num#atk', fmt(r.atk))),
      h('div.vsline#vsline'),
      h('div.counts', h('div.hands', h('div.n#handsn', r.hands), h('div.l', 'Hands')), h('div.discs', h('div.n#discn', r.discards), h('div.l', 'Discards'))),
      h('div.money', h('div', h('div.goldnum#gold', '$' + r.gold), h('div.eco', `eco +$${Math.floor(r.eco)}/round`)),
        h('div.lpbox', { style: { minWidth: '90px' } }, h('div.lpnum', h('small', 'LP'), fmt(Math.max(0, r.lp))), h('div.lpbar' + (lpPct < 30 ? '.low' : ''), h('i', { style: { width: lpPct + '%' } })))),
      this.heartBtn(),
    ].filter(Boolean));
    this.renderVs();
    this.tick();
  }
  heartBtn() {
    const r = this.run, ready = r.heart >= 100;
    const b = h('button.heartbtn' + (ready && this.phase === 'battle' && !r.done ? '.ready' : ''), { onclick: () => this.believe() },
      h('i.fill', { style: { width: r.heart + '%' } }),
      h('span', ready ? '💖 BELIEVE IN THE HEART OF THE CARDS' : `♥ Heart of the Cards ${Math.floor(r.heart)}%`));
    tip(b, () => '<div class="tn">💖 Heart of the Cards</div><div class="desc">Fills up when you take damage and when gremlins hit you. When it\'s full, believe: your next draw is the <b>best hand in your whole deck</b>, and it scores <b class=x>X2 Mult</b>.</div>');
    b.id = 'heartbtn';
    return b;
  }
  renderVs() {
    const el = $('#vsline', this.root); if (!el) return;
    const me = this.run.atk, them = this.opp.atk || 0;
    el.innerHTML = '';
    const diff = me - them;
    el.append(h('span', 'Rival: ', h('b', fmt(them)), this.opp.done ? ' 🔒' : ''), h('span.' + (diff >= 0 ? 'ahead' : 'behind'), diff >= 0 ? `▲ ${fmt(diff)}` : `▼ ${fmt(-diff)}`));
  }
  renderZones() {
    const el = $('#zones', this.root); if (!el) return;
    const r = this.run;
    el.innerHTML = '';
    const mrow = h('div.mrow#mons');
    r.monsters.forEach((m, i) => mrow.append(monEl(m, { idx: i, onclick: (e, me) => this.monMenu(m, me) })));
    for (let i = r.monsters.length; i < r.monSlots; i++) mrow.append(emptyMon());
    const irow = h('div.irow#items');
    r.items.forEach(it => irow.append(itemEl(it, { onclick: (e, ie) => this.itemMenu(it, ie) })));
    for (let i = r.items.length; i < r.itemSlots; i++) irow.append(h('div.item.empty'));
    const trow = h('div.irow#traps');
    r.traps.forEach(t => trow.append(itemEl(t, { set: true })));
    for (let i = r.traps.length; i < r.trapSlots; i++) trow.append(h('div.item.empty', { title: 'Trap zone' }));
    el.append(h('span.slotlbl', 'Monsters'), mrow, h('span.slotlbl', 'Spells'), irow, h('span.slotlbl', 'Traps'), trow);
  }
  renderActions() {
    const el = $('#actions', this.root); if (!el) return;
    el.innerHTML = '';
    const emo = h('button.btn.ghost.small', { onclick: e => this.emoteMenu(e.currentTarget) }, '💬');
    const leave = h('button.btn.ghost.small', { onclick: () => this.confirmLeave() }, '🏳️');
    if (this.phase === 'battle' && !this.run.done) {
      const n = this.sel.size;
      el.append(
        h('div.sorts', h('button.btn.dark.small', { onclick: () => this.sortHand('rank') }, 'Rank'), h('button.btn.dark.small', { onclick: () => this.sortHand('suit') }, 'Suit')),
        h('button.btn.blue.big#playbtn', { disabled: !n || this.busy || this.run.hands <= 0, onclick: () => this.play() }, 'PLAY HAND'),
        h('button.btn.red#discbtn', { disabled: !n || this.busy || this.run.discards <= 0, onclick: () => this.discard() }, `DISCARD (${this.run.discards})`),
        emo, leave);
    } else el.append(emo, leave);
    this.renderHint();
  }
  renderHint() {
    const el = $('#hint', this.root); if (!el) return;
    if (this.phase !== 'battle' || this.run.done) { el.textContent = ''; return; }
    const cards = this.run.hand.filter(c => this.sel.has(c.uid));
    if (!cards.length) { el.textContent = 'Click up to 5 cards · Enter plays · D discards'; this.setHandName(null); return; }
    const ev = E.passives(this.run);
      const hidden = cards.some(c => c.down);
      const res = evalHand(cards, { four: ev.four });
      if (hidden) this.setHandName('???', 'Face-down cards: you\'ll find out when you play it');
      else { const b = handBase(this.run.levels, res.type); this.setHandName(HAND_BY_ID[res.type].name, `level ${b.level}`, b.chips, b.mult); }
    el.textContent = `${cards.length} selected`;
  }
  setHandName(name, sub = '', chips, mult) {
    const hn = $('#handname', this.root); if (!hn) return;
    hn.querySelector('.hn').textContent = name || (this.phase === 'battle' ? (this.run.done ? 'All done!' : 'Pick cards') : '');
    hn.querySelector('.hl').textContent = sub;
    if (chips !== undefined) { $('#chips', this.root).textContent = fmt(chips); $('#mult', this.root).textContent = fmt(mult); }
    else if (!this.busy) { $('#chips', this.root).textContent = '0'; $('#mult', this.root).textContent = '0'; }
  }
  renderDeck() {
    const el = $('#deck', this.root); if (!el) return;
    el.innerHTML = this.phase === 'battle' ? `<div style="position:absolute;inset:0;--cw:inherit">${backHTML(this.app.profile.data.back)}</div><div class="cnt">${this.run.draw.length}/${this.run.deck.length}</div>` : '';
    el.style.cursor = 'pointer';
    el.onclick = () => this.deckView();
  }
  renderGate() {
    const el = $('#gate', this.root); if (!el) return;
    el.innerHTML = '';
    el.append(h('h4', 'GREMLIN GATE'), h('div.ecoline#ecoline', `eco +$${fmtMult(this.run.eco)}/round`));
    for (const g of GREMLINS) {
      const b = h('button.gbtn', { 'data-g': g.id, onclick: e => this.sendGremlin(g.id, e.currentTarget) },
        h('div.ga', { html: monsterSVG(g.art) }), h('div.gn', g.name), h('div.gc', '$' + g.cost), h('div.cd', { style: { transform: 'scaleY(0)' } }));
      tip(b, () => gremTipHTML(g.id));
      el.append(b);
    }
    this.updateGate();
  }
  updateGate() {
    const el = $('#gate', this.root); if (!el) return;
    const can = this.phase === 'battle' && !this.opp.done && this.opp.ph === 'battle';
    for (const b of el.querySelectorAll('.gbtn')) {
      const g = GREM_BY_ID[b.dataset.g];
      const cdLeft = Math.max(0, (this.cds[g.id] || 0) - now());
      b.disabled = !can || this.run.gold < g.cost || cdLeft > 0 || (g.once && this.run.hogSent === this.round);
      b.querySelector('.cd').style.transform = `scaleY(${cdLeft / (g.cd * 1000)})`;
    }
    const gold = $('#gold', this.root); if (gold && gold.textContent !== '$' + this.run.gold) gold.textContent = '$' + this.run.gold;
  }

  // ================================================================ hand of cards
  cardEl(c) {
    let el = this.cardEls.get(c.uid);
    if (!el) {
      el = h('div.pcard', { 'data-uid': c.uid, style: { pointerEvents: 'auto' } });
      el.innerHTML = `<div class="pc-sway"><div class="pc-lift"><div class="pc-wrap"><div class="pc-front"></div><div class="pc-backside">${backHTML(this.app.profile.data.back)}</div></div></div></div>`;
      el.addEventListener('click', () => this.toggleCard(c.uid));
      el.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        const r = el.getBoundingClientRect();
        const lift = el.querySelector('.pc-lift');
        lift.style.transform = `translateY(-8px) rotateX(${(0.5 - (e.clientY - r.top) / r.height) * 18}deg) rotateY(${((e.clientX - r.left) / r.width - 0.5) * 22}deg)`;
      });
      el.addEventListener('pointerleave', () => { el.querySelector('.pc-lift').style.transform = ''; });
      tip(el, () => this.cardTip(c));
      const d = this.deckPos();
      el.style.transform = `translate(${d.x}px, ${d.y}px) rotate(8deg)`;
      this.layer.append(el);
      this.cardEls.set(c.uid, el);
      el._c = c;
    }
    this.paintCard(el, c);
    return el;
  }
  paintCard(el, c) {
    const key = `${c.rank}${c.suit}${c.enh}${c.bonus}`;
    if (el._key !== key) { el.querySelector('.pc-front').innerHTML = cardHTML(c); el._key = key; }
    el.className = 'pcard' + (c.enh ? ' enh-' + c.enh : '') + (c.down ? ' down' : '') + (c.sticky ? ' sticky' : '') + (E.isDebuffed(this.run, c) ? ' debuffed' : '') + (this.sel.has(c.uid) ? ' sel' : '');
  }
  cardTip(c) {
    if (c.down) return '<div class="tn">Face down</div><div class="desc">Ink Bat got it. You can still play it… bravely.</div>';
    let s = `<div class="tn">${rankLabel(c.rank)}${SUITS[c.suit].sym} <small>${E.isDebuffed(this.run, c) ? '(debuffed)' : ''}</small></div><div class="desc"><b class=c>+${(c.rank === 14 ? 11 : c.rank >= 10 ? 10 : c.rank) + (c.bonus || 0) + (c.enh === 'swole' ? 30 : 0)} Chips</b></div>`;
    if (c.enh) s += `<div class="desc">${this.enhDesc(c.enh)}</div>`;
    if (c.sticky) s += '<div class="desc">🐌 Glued: can\'t be discarded this round</div>';
    return s;
  }
  enhDesc(e) { return ({ spicy: '🌶️ Spicy: <b class=m>+4 Mult</b>', swole: '💪 Swole: <b class=c>+30 Chips</b>', gilded: '🪙 Gilded: <b class=g>+$2</b> when scored', glass: '🔮 Glass: <b class=x>X2 Mult</b>, may shatter', lucky: '🍀 Lucky: sometimes <b class=m>+20 Mult</b> or <b class=g>$10</b>', steel: '🔩 Steel: <b class=x>X1.5 Mult</b> while held', wild: '🌈 Wild: every suit' })[e]; }
  deckPos() {
    const d = $('#deck', this.root);
    if (!d) return { x: innerWidth, y: innerHeight };
    const r = d.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }
  layoutHand(skip = null) {
    if (this.phase !== 'battle') return;
    const hz = $('#handzone', this.root); if (!hz) return;
    const R = hz.getBoundingClientRect();
    const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw')) || 80;
    const hand0 = skip ? this.run.hand.filter(c => !skip.has(c.uid)) : this.run.hand;
    if (hand0.length) this.cardEl(hand0[0]);
    const sample = hand0.length ? this.cardEls.get(hand0[0].uid) : null;
    const realW = sample ? sample.offsetWidth : cw;
    const realH = sample ? sample.offsetHeight : cw * 1.4;
    const hand = skip ? this.run.hand.filter(c => !skip.has(c.uid)) : this.run.hand;
    const n = hand.length;
    const avail = R.width - realW * 1.4;
    const step = n > 1 ? Math.min(realW * 1.08, (avail - realW) / (n - 1)) : 0;
    const total = step * (n - 1) + realW;
    const x0 = R.left + (avail - total) / 2 + 6;
    let fi = 0;
    hand.forEach((c, i) => {
      const el = this.cardEl(c);
      const mid = (n - 1) / 2, k = i - mid;
      const x = x0 + i * step;
      const y = R.top + 22 + Math.abs(k) * Math.abs(k) * 1.4 - (this.sel.has(c.uid) ? 26 : 0);
      const rot = k * 2.2;
      el.style.zIndex = 10 + i;
      const tf = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
      if (el._fresh === undefined) {
        el._fresh = false;
        const k = fi++;
        frame(() => setTimeout(() => { el.style.transform = tf; }, k * 55));
        sfx.deal(k);
      } else el.style.transform = tf;
      el.querySelector('.pc-sway').style.animationDelay = (-i * 0.4) + 's';
    });
    // remove stale cards
    for (const [uid, el] of this.cardEls) if (!hand.some(c => c.uid === uid) && !el._flying) { el.remove(); this.cardEls.delete(uid); }
    this.renderDeck();
  }
  clearCards() { for (const el of this.cardEls.values()) el.remove(); this.cardEls.clear(); this.sel.clear(); }
  toggleCard(uid) {
    if (this.phase !== 'battle' || this.run.done || this.busy) return;
    if (this.sel.has(uid)) { this.sel.delete(uid); sfx.deselect(); }
    else { if (this.sel.size >= 5) { sfx.nope(); return; } this.sel.add(uid); sfx.select(this.sel.size); }
    const c = this.run.hand.find(x => x.uid === uid);
    if (c) this.paintCard(this.cardEls.get(uid), c);
    this.layoutHand(); this.renderActions();
  }
  sortHand(by) {
    this.sort = by;
    const so = { S: 0, H: 1, C: 2, D: 3 };
    this.run.hand.sort(by === 'rank' ? (a, b) => b.rank - a.rank || so[a.suit] - so[b.suit] : (a, b) => so[a.suit] - so[b.suit] || b.rank - a.rank);
    sfx.swoosh(); this.layoutHand();
  }
  onKey(e) {
    if (e.target.tagName === 'INPUT' || $('.modal-bg')) return;
    if (this.phase !== 'battle') return;
    if (/^[1-9]$/.test(e.key)) { const c = this.run.hand[+e.key - 1]; if (c) this.toggleCard(c.uid); }
    else if (e.key === 'Enter') this.play();
    else if (e.key === 'd' || e.key === 'D' || e.key === 'Backspace') this.discard();
    else if (e.key === 'h' || e.key === 'H') this.believe();
    else if (e.key === 's' || e.key === 'S') this.sortHand(this.sort === 'rank' ? 'suit' : 'rank');
    else if (e.key === 'Escape') { this.sel.clear(); this.layoutHand(); this.renderActions(); for (const c of this.run.hand) this.paintCard(this.cardEls.get(c.uid), c); }
  }

  // ================================================================ intro & starter pick
  async vsIntro() {
    this.phase = 'intro';
    const me = this.meInfo, rv = this.rival;
    const rec = this.app.profile.data.friends[rv.code];
    const ov = h('div.overlay.block', h('div.dim'),
      h('div.vs',
        h('div.side-p.l', h('div.bigav', { html: monsterSVG(avatarOf(me.av, me.code)) }), h('div.pn', me.name), h('div', `Lv ${me.lvl} · ${me.title || ''}`)),
        h('div.vsword', 'VS'),
        h('div.side-p.r', h('div.bigav', { html: monsterSVG(avatarOf(rv.av, rv.code)) }), h('div.pn', rv.name), h('div', `Lv ${rv.lvl || 1} · ${rv.title || ''}`), rec ? h('div', { style: { color: '#ffd43b', fontWeight: 700 } }, `Your record: ${rec.w}–${rec.l}`) : null)));
    document.body.append(ov);
    const [l, vs, r] = ov.querySelectorAll('.side-p.l, .vsword, .side-p.r');
    l.animate([{ transform: 'translateX(-120vw) rotate(-20deg)' }, { transform: 'translateX(0) rotate(0)' }], { duration: 500, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    r.animate([{ transform: 'translateX(120vw) rotate(20deg)' }, { transform: 'translateX(0) rotate(0)' }], { duration: 500, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    sfx.swoosh();
    await sleep(450);
    vs.animate([{ transform: 'scale(4) rotate(-30deg)', opacity: 0 }, { transform: 'scale(1) rotate(-8deg)', opacity: 1 }], { duration: 350, easing: 'cubic-bezier(.2,1.6,.4,1)', fill: 'forwards' });
    await sleep(300);
    sfx.clash(); FX.shake(2.5, 500); FX.flash('#ff4d5e');
    FX.stars(innerWidth / 2, innerHeight / 2, 14);
    await sleep(1500);
    FX.shout('SHUFFLE UP!', { color: '#ffd43b', size: 100 });
    sfx.deal(0); sfx.deal(1); sfx.deal(2);
    await sleep(900);
    FX.autoRemove(ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }), ov);
  }
  showPick() {
    const pz = $('#play', this.root);
    this.pickChoices = E.starterChoices(this.run);
    pz.innerHTML = '';
    const row = h('div.pickrow');
    this.pickChoices.forEach((id, i) => {
      const m = { id, st: {} }; const d = MON_BY_ID[id]; d.init && d.init(m);
      const card = h('div.offer', { style: { '--rc': RARITY[d.rar].color } },
        h('div.oart', { html: monsterSVG(d.art) }), h('div.on', d.name), h('div.or', { style: { color: RARITY[d.rar].color } }, RARITY[d.rar].name),
        h('div.desc', { html: typeof d.desc === 'function' ? d.desc(m) : d.desc }),
        h('button.btn.gold.small', { onclick: () => this.choosePick(id) }, 'Summon!'));
      card.animate([{ transform: 'translateY(60px) rotate(10deg) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, delay: i * 120, easing: 'cubic-bezier(.2,1.5,.4,1)', fill: 'backwards' });
      row.append(card);
    });
    pz.append(h('div.shop', h('div.shop-head', h('span.title', 'PICK YOUR FIRST MONSTER')), h('div', { style: { color: '#e6d6f7' } }, 'Free! Choose wisely. Or don\'t. They\'re all a little feral.'), row));
  }
  choosePick(id) {
    if (this.run.monsters.length || this.phase !== 'pick' && this.phase !== 'battle') return;
    E.addMonster(this.run, id);
    this.pickChoices = null;
    sfx.buy(); sfx.boing();
    const pz = $('#play', this.root);
    if (this.phase === 'pick') pz.innerHTML = '<div class="msg">Waiting for your rival to pick…</div>';
    this.renderZones();
    const mel = $('#mons .mon', this.root);
    if (mel) { const [x, y] = FX.centerOf(mel); FX.stars(x, y, 10); FX.jiggle(mel, 1.5); }
    FX.shout(MON_BY_ID[id].name.toUpperCase() + '!', { size: 56, color: '#ff9ac0', tilt: -4 });
    this.send({ t: 'picked' });
    if (this.isHost) this.hostEvent('picked', 'h', {});
  }

  // ================================================================ battle
  startBattle(boss) {
    closePop();
    $$('.modal-bg').forEach(m => m.dataset.keep || m.remove());
    this.clearCards();
    E.startRound(this.run, this.round, boss);
    this.opp.done = false; this.opp.atk = 0; this.opp.ready = false; this.opp.ph = 'battle'; this.opp.hands = RULES.hands;
    this.rivalDoneShown = false;
    FX.setBgMood(this.run.lp < RULES.lp * 0.3 ? 'danger' : 'battle');
    const pz = $('#play', this.root); pz.innerHTML = '';
    this.renderAll();
    this.layoutHand();
    if (boss) {
      const B = BOSS_BY_ID[boss.id];
      FX.shout(B.name.toUpperCase(), { color: '#ff4d5e', size: 72, sub: bossDesc(boss).replace(/<[^>]+>/g, ''), ms: 2200 });
      sfx.boom(); FX.shake(2);
    } else {
      FX.shout(this.round >= 10 ? 'SUDDEN DEATH!' : `ROUND ${this.round}`, { size: 90, color: this.round >= 10 ? '#ff4d5e' : '#ffd43b', sub: this.round === 1 ? 'Score as much as you can in 4 hands!' : '', ms: 1300 });
    }
  }
  async play() {
    if (this.busy || this.phase !== 'battle' || this.run.done || !this.sel.size || this.run.hands <= 0) return;
    this.busy = true; closePop(); hideTip();
    try { await this._play(); } catch (e) { console.error(e); } finally { this.busy = false; }
    this.renderActions();
    if (this.run.done) this.finishBattle(false);
    this.drainGrem();
  }
  async _play() {
    const uids = this.run.hand.filter(c => this.sel.has(c.uid)).map(c => c.uid);
    const playedEls = uids.map(u => this.cardEls.get(u));
    // fly the chosen cards to the middle
    const pz = $('#play', this.root).getBoundingClientRect();
    const w = playedEls[0].offsetWidth, ht = playedEls[0].offsetHeight;
    playedEls.forEach((el, i) => {
      el._flying = true;
      const x = pz.left + pz.width / 2 + (i - (uids.length - 1) / 2) * w * 1.12 - w / 2;
      el.style.transform = `translate(${x}px, ${pz.top + pz.height / 2 - ht / 2}px) rotate(0deg)`;
      el.style.zIndex = 50 + i;
      el.classList.remove('sel');
    });
    sfx.swoosh();
    this.sel.clear();
    const res = E.playHand(this.run, uids, { oppLp: this.opp.lp });
    if (res.err) { toast(res.err); return; }
    this.renderActions();
    this.layoutHand(new Set(res.drawn.map(c => c.uid)));
    { const hn = $('#handsn', this.root); if (hn) hn.textContent = this.run.hands; const g = $('#gold', this.root); if (g) g.textContent = '$' + this.run.gold; }
    await sleep(380);
    // reveal any face-down cards
    for (const u of uids) { const el = this.cardEls.get(u); el && el.classList.remove('down'); }
    const H = HAND_BY_ID[res.type];
    const base = res.steps[0];
    this.setHandName(H.name, `level ${base.level}`, base.chips, base.mult);
    FX.jiggle($('#handname', this.root), 1);
    await sleep(240);
    // scoring cards pop up
    for (const u of res.scoring) { const el = this.cardEls.get(u); if (el) el.style.transform += ' translateY(-18px)'; }
    await sleep(200);
    await this.animateSteps(res);
    // the total
    const total = res.total;
    const big = total >= 100000 ? 3 : total >= 10000 ? 2 : total >= 2000 ? 1 : 0;
    this.setHandName(fmt(total), H.shout);
    const hn = $('#handname .hn', this.root);
    hn.animate([{ transform: 'scale(2.2)', color: '#ffd43b' }, { transform: 'scale(1)', color: '#fff' }], { duration: 500, easing: 'cubic-bezier(.2,1.6,.4,1)' });
    sfx.total(big);
    FX.shake(0.6 + big * 0.8, 300 + big * 120);
    if (big >= 2) { FX.flash('#ffb300', 300); const [x, y] = FX.centerOf($('#scorebox', this.root)); FX.confetti(x, y, 40 + big * 20); }
    if (big >= 1) FX.shout(H.shout, { size: 60 + big * 16, color: big >= 2 ? '#ff7a00' : '#ffd43b', ms: 1000 });
    const sb = $('#scorebox', this.root);
    sb.classList.toggle('fire', total >= 5000 || this.run.atk > (this.opp.atk || 0) * 1.5 && this.run.atk > 3000);
    await this.countUp($('#atk', this.root), this.run.atk - total, this.run.atk, 600);
    if (res.money) FX.floatAt($('#gold', this.root), `+$${res.money}`, 'g');
    this.send({ t: 'hand', r: this.round, type: res.type, total, atk: this.run.atk, hands: this.run.hands });
    this.questHand(res);
    // cards fly away (or shatter)
    for (const u of uids) {
      const el = this.cardEls.get(u); if (!el) continue;
      if (res.shattered.includes(u)) {
        const [x, y] = FX.centerOf(el); FX.shreds(x, y, 30, ['#cfe8ff', '#ffffff', '#9fd0ff']); sfx.shatter(); FX.textPop(x, y - 40, 'SHATTER!', '#9fd0ff');
        el.remove();
      } else {
        el.style.transition = 'transform .45s ease-in';
        el.style.transform += ` translate(${innerWidth}px, -80px) rotate(40deg)`;
        setTimeout(() => el.remove(), 480);
      }
      this.cardEls.delete(u);
    }
    if (res.eaten) {
      const el = this.cardEls.get(res.eaten);
      if (el) { const [x, y] = FX.centerOf(el); FX.shreds(x, y); sfx.chomp(); FX.textPop(x, y, 'MOON CHOMP!', '#f2e6a0'); el.remove(); this.cardEls.delete(res.eaten); }
    }
    if (res.printed) { toast(`🖨️ Office Printer printed <b>${ITEM_BY_ID[res.printed].name}</b>!`); }
    this.handleEvents();
    await sleep(250);
    this.setHandName(null);
    this.renderSide(); this.renderZones();
    this.layoutHand();
  }
  async animateSteps(res) {
    const chipsEl = $('#chips', this.root), multEl = $('#mult', this.root);
    let n = 0;
    const steps = res.steps.slice(1);
    const fast = steps.length > 14;
    for (const s of steps) {
      const delay = Math.max(fast ? 70 : 110, 360 * Math.pow(0.9, n));
      let target = null, cls = 'w', text = '';
      if (s.k === 'card' || s.k === 'held' || s.k === 'retrig' || s.k === 'debuff') target = this.cardEls.get(s.uid);
      else if (s.k === 'mon' || s.k === 'ed') target = $(`#mons .mon[data-uid="${s.uid}"]`, this.root);
      else if (s.k === 'heart') target = $('#heartbtn', this.root);
      else if (s.k === 'munch' || s.k === 'boss') target = multEl;
      if (s.dc) { text = `+${fmt(s.dc)}`; cls = 'c'; sfx.chip(n); }
      if (s.dm) { text = `+${fmt(s.dm)} Mult`; cls = 'm'; sfx.mult(n); }
      if (s.xm) { text = `X${fmtMult(s.xm)} Mult`; cls = 'x'; sfx.xmult(n); FX.shake(0.5, 150); }
      if (s.money) { text = (s.money > 0 ? '+$' : '-$') + Math.abs(s.money); cls = 'g'; sfx.money(); }
      if (s.msg && !text) { text = s.msg; cls = s.k === 'debuff' ? 'k' : 'w'; if (s.k === 'retrig') sfx.boing(); else sfx.pop(); }
      else if (s.msg) text = s.msg + ' ' + text;
      if (target) { FX.jiggle(target, s.xm ? 1.4 : 0.8); FX.floatAt(target, text, cls); }
      if (s.k === 'heart') { FX.flash('#ffd43b', 300); FX.shout('HEART OF THE CARDS!', { color: '#ffd43b', size: 64 }); }
      if (s.k === 'munch') { sfx.chomp(); }
      chipsEl.textContent = fmt(s.chips); multEl.textContent = fmt(s.mult);
      if (s.dc) FX.jiggle(chipsEl, 0.5);
      if (s.dm || s.xm) FX.jiggle(multEl, s.xm ? 1.2 : 0.5);
      n++;
      await sleep(delay);
    }
  }
  countUp(el, from, to, ms) {
    return new Promise(res => {
      const t0 = performance.now();
      const f = t => {
        const k = clamp((t - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
        el.textContent = fmt(from + (to - from) * e);
        if (k < 1) frame(f); else res();
      };
      frame(f);
    });
  }
  async discard() {
    if (this.busy || this.phase !== 'battle' || this.run.done || !this.sel.size) return;
    const uids = this.run.hand.filter(c => this.sel.has(c.uid)).map(c => c.uid);
    const res = E.discard(this.run, uids);
    if (res.err) { sfx.nope(); toast(res.err, { ms: 2200 }); return; }
    this.busy = true;
    this.sel.clear();
    sfx.swoosh();
    uids.forEach((u, i) => {
      const el = this.cardEls.get(u);
      if (!el) return;
      el.style.transition = 'transform .4s ease-in';
      el.style.transform += ` translate(${-innerWidth * 0.6}px, 60px) rotate(-50deg)`;
      setTimeout(() => el.remove(), 420);
      this.cardEls.delete(u);
    });
    await sleep(200);
    this.layoutHand();
    this.renderSide(); this.renderZones();
    this.busy = false;
    this.renderActions();
    this.drainGrem();
  }
  finishBattle(timeUp) {
    if (this.run.done && this.sentDone === this.round) return;
    this.run.done = true;
    if (this.sentDone === this.round) return;
    this.sentDone = this.round;
    const info = { r: this.round, atk: this.run.atk, mons: this.run.monsters.length, traps: this.run.traps.map(t => t.id) };
    this.send({ t: 'done', ...info });
    if (this.isHost) this.hostEvent('done', 'h', info);
    this.sel.clear();
    if (timeUp && this.run.hands > 0) { FX.shout('TIME!', { color: '#ff4d5e', size: 100 }); sfx.boom(); }
    // put the remaining cards away
    for (const [uid, el] of this.cardEls) { el.style.transition = 'transform .5s ease-in, opacity .5s'; el.style.opacity = '.0'; el.style.transform += ' translateY(120px)'; }
    this.later(() => this.clearCards(), 550);
    const pz = $('#play', this.root);
    pz.innerHTML = '';
    pz.append(h('div.msg', h('div', { style: { fontFamily: 'Bangers', fontSize: '42px', color: '#ffd43b' } }, `LOCKED IN: ${fmt(this.run.atk)}`),
      h('div', this.opp.done ? 'Both locked in. CLASH INCOMING…' : 'Your rival is still playing. Send gremlins to mess them up! 😈')));
    this.renderSide(); this.renderActions();
  }
  rivalDone(atk) {
    if (this.rivalDoneShown === this.round) return;
    this.rivalDoneShown = this.round;
    this.renderOpp(); this.renderVs(); this.updateGate();
    if (this.phase === 'battle' && !this.run.done) {
      FX.shout(`RIVAL LOCKED IN ${fmt(atk)}`, { size: 44, color: '#ff9ac0', sub: atk > this.run.atk ? 'Beat it!' : 'You\'re ahead. Keep it that way.', ms: 1800, tilt: 3 });
      sfx.chime();
    }
  }
  rivalHand(m) {
    if (m.r !== this.round) return;
    this.opp.atk = m.atk; this.opp.hands = m.hands;
    this.renderOpp(); this.renderVs();
    const el = $('#oppatk', this.root);
    if (el) {
      FX.jiggle(el, 1);
      FX.floatAt(el, `+${fmt(m.total)} ${HAND_BY_ID[m.type].name}`, m.total >= 5000 ? 'x' : 'c');
      if (m.total >= 10000) { FX.shake(1); sfx.bonk(); }
    }
  }

  // ================================================================ heart of the cards
  async believe() {
    const r = this.run;
    if (this.phase !== 'battle' || r.done || this.busy) return;
    if (r.heart < 100) { sfx.nope(); toast('Your heart isn\'t full yet. Take some hits first. (That\'s the spirit!)', { ms: 2500 }); return; }
    const res = E.heartActivate(r);
    if (res.err) return;
    this.busy = true;
    this.send({ t: 'heart' });
    this.app.profile.quest('heart');
    const ov = h('div.overlay.heart-ov', h('div.dim'), h('div.rays'), h('div.htext'));
    const words = 'BELIEVE IN THE HEART OF THE CARDS!';
    const ht = ov.querySelector('.htext');
    let li = 0;
    words.split(' ').forEach((w, wi) => { const g = h('span.hw'); for (const ch of w) g.append(h('span', { style: { animationDelay: (li++ * 0.04) + 's' } }, ch)); ht.append(g); if (wi < words.split(' ').length - 1) ht.append(' '); });
    document.body.append(ov);
    FX.setBgMood('heart'); sfx.heart();
    for (const el of this.cardEls.values()) { el.style.transition = 'transform .5s ease-in'; el.style.transform += ' translateY(-60vh) rotate(180deg)'; }
    await sleep(1600);
    FX.flash('#fff6c0', 500);
    this.clearCards();
    this.sel = new Set(res.best);
    FX.autoRemove(ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400 }), ov);
    this.layoutHand();
    await sleep(700);
    for (const u of res.best) { const el = this.cardEls.get(u); if (el) { el.classList.add('sel'); const [x, y] = FX.centerOf(el); FX.sparks(x, y, 12, '#ffd43b'); } }
    FX.setBgMood('battle');
    this.busy = false;
    this.renderSide(); this.renderActions();
    toast('💖 Your destiny cards are selected. Play them!', { ms: 3000 });
  }
  rivalHeart() {
    FX.shout('YOUR RIVAL BELIEVES…', { color: '#ffd43b', size: 52, sub: 'in the heart of the cards. Uh oh.', ms: 2000 });
    sfx.heartbeat(); setTimeout(() => sfx.heartbeat(), 700);
  }

  // ================================================================ gremlins
  sendGremlin(gid, btn) {
    if (this.phase !== 'battle' || this.opp.done) return;
    const err = E.canSend(this.run, gid, now(), this.cds);
    if (err) { sfx.nope(); return; }
    E.paySend(this.run, gid);
    const g = GREM_BY_ID[gid];
    this.cds[gid] = now() + g.cd * 1000;
    const id = Math.random().toString(36).slice(2, 9);
    const twice = E.passives(this.run).gremlinTwice;
    this.pendingGrem.set(id, gid);
    this.send({ t: 'grem', id, g: gid });
    if (twice) this.later(() => this.send({ t: 'grem', id: id + 'b', g: gid }), 900);
    this.app.profile.quest('gremlins');
    sfx.squeak();
    // our gremlin dashes up to the rival
    const from = FX.centerOf(btn), to = FX.centerOf($('#oppav', this.root) || btn);
    this.runner(g.art, from, to, 650).then(() => { FX.stars(to[0], to[1], 6); sfx.bonk(); });
    FX.floatAt($('#gold', this.root), `-$${g.cost}`, 'g');
    $('#ecoline', this.root).textContent = `eco +$${fmtMult(this.run.eco)}/round`;
    this.renderSide(); this.updateGate();
  }
  runner(art, from, to, ms, { spin = false } = {}) {
    const r = h('div.runner', { html: monsterSVG(art) });
    document.body.append(r);
    const midX = (from[0] + to[0]) / 2, midY = Math.min(from[1], to[1]) - 120;
    const a = r.animate([
      { transform: `translate(${from[0] - 35}px, ${from[1] - 35}px) scale(.6) rotate(0)` },
      { transform: `translate(${midX - 35}px, ${midY - 35}px) scale(1.1) rotate(${spin ? 360 : -15}deg)` },
      { transform: `translate(${to[0] - 35}px, ${to[1] - 35}px) scale(1) rotate(${spin ? 720 : 0}deg)` },
    ], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    return FX.animDone(a).then(() => { setTimeout(() => r.remove(), 60); return r; });
  }
  drainGrem() {
    if (this.busy || !this.gremQ.length) return;
    const m = this.gremQ.shift();
    this.takeGremlin(m).catch(e => console.error(e)).finally(() => { this.busy = false; this.drainGrem(); });
  }
  async takeGremlin(m) {
    const g = GREM_BY_ID[m.g];
    if (!g) return;
    if (this.phase !== 'battle' || this.run.done) { this.send({ t: 'gremr', id: m.id, res: 'miss' }); return; }
    this.busy = true;
    const res = E.applyGremlin(this.run, m.g);
    this.send({ t: 'gremr', id: m.id, res: res.res, stolen: res.stolen || 0, by: res.by, msg: res.msg });
    sfx.squeak();
    const from = FX.centerOf($('#oppav', this.root) || this.root);
    const targetEl = res.cards && res.cards.length ? this.cardEls.get(res.cards[0]) : (m.g === 'raccoon' ? $('#gold', this.root) : m.g === 'muncher' ? $('#mult', this.root) : $('#handsn', this.root));
    const to = targetEl ? FX.centerOf(targetEl) : [innerWidth / 2, innerHeight * 0.65];
    if (res.res !== 'hit') {
      await this.runner(g.art, from, [innerWidth / 2, innerHeight * 0.45], 600);
      if (res.by === 'bouncer') {
        const bear = $(`#mons .mon`, this.root) && [...$$('#mons .mon', this.root)].find(el => this.run.monsters.find(x => x.uid == el.dataset.uid && x.id === 'bouncer'));
        bear && FX.jiggle(bear, 2);
        sfx.bonk(); FX.shout('BONK!', { color: '#ffd43b', size: 80 }); FX.stars(innerWidth / 2, innerHeight * 0.45, 10);
      } else if (res.by === 'zapper') { sfx.zap(); FX.flash('#7fd3ff'); FX.shout('ZZZAP!', { color: '#7fd3ff', size: 80, sub: '+$3' }); FX.sparks(innerWidth / 2, innerHeight * 0.45, 24, '#7fd3ff'); }
      else if (res.by === 'boomerang') { sfx.boing(); FX.shout('TRAP CARD!', { color: '#c86bff', size: 80, sub: 'Boomerang Box: return to sender!' }); }
      this.runner(g.art, [innerWidth / 2, innerHeight * 0.45], [from[0], -100], 700, { spin: true });
      this.app.profile.quest('block');
    } else {
      await this.runner(g.art, from, to, 650);
      const hit = pick(makeRng(Date.now()), g.hits);
      const [x, y] = to;
      if (m.g === 'rat' || m.g === 'chomper') {
        const el = targetEl;
        if (el) { await this.tearCard(el); this.cardEls.delete(+el.dataset.uid); }
        sfx.chomp(); FX.textPop(x, y - 30, hit, '#ff4d5e', 44);
      } else if (m.g === 'bat') {
        sfx.splat(); FX.textPop(x, y - 30, hit, '#c86bff', 44);
        for (const u of res.cards) { const el = this.cardEls.get(u); if (el) { const c = this.run.hand.find(x => x.uid === u); this.paintCard(el, c); const [cx, cy] = FX.centerOf(el); FX.sparks(cx, cy, 10, '#1a1030'); } }
      } else if (m.g === 'snail') {
        sfx.splat(); FX.textPop(x, y - 30, hit, '#b6e35a', 44);
        for (const u of res.cards) { const el = this.cardEls.get(u); if (el) this.paintCard(el, this.run.hand.find(x => x.uid === u)); }
      } else if (m.g === 'raccoon') {
        sfx.money(); FX.textPop(x, y - 30, hit, '#ffd43b', 44); if (res.stolen) FX.floatAt($('#gold', this.root), `-$${res.stolen}`, 'g');
      } else { sfx.chomp(); FX.textPop(x, y - 30, hit, '#ff9ac0', 44); FX.shake(1); }
      toast(`<b>${g.name}!</b> ${res.msg}`, { ms: 2600, av: g.art });
      FX.shake(0.8, 250);
      this.runner(g.art, to, [to[0] + (Math.random() < 0.5 ? -1 : 1) * innerWidth, to[1] - 200], 700, { spin: true });
      this.layoutHand();
    }
    this.handleEvents();
    this.renderSide(); this.renderZones(); this.renderActions();
    this.busy = false;
  }
  /** A card ripped in half by a gremlin or a monster: two halves fly apart in a burst of paper. */
  async tearCard(el, color) {
    const r = el.getBoundingClientRect();
    const mk = (clip, dir) => {
      const c = el.cloneNode(true);
      c.className = el.className + ' tornhalf';
      Object.assign(c.style, { left: r.left + 'px', top: r.top + 'px', transform: 'none', transition: 'none', clipPath: clip, width: r.width + 'px', height: r.height + 'px', zIndex: 66 });
      document.body.append(c);
      FX.autoRemove(c.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${dir * 90}px, ${160 + Math.random() * 80}px) rotate(${dir * 50}deg)`, opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.3,0,.8,.5)', fill: 'forwards' }), c);
    };
    mk('polygon(0 0, 55% 0, 40% 20%, 58% 40%, 38% 60%, 55% 80%, 42% 100%, 0 100%)', -1);
    mk('polygon(55% 0, 100% 0, 100% 100%, 42% 100%, 55% 80%, 38% 60%, 58% 40%, 40% 20%)', 1);
    el.remove();
    FX.shreds(r.left + r.width / 2, r.top + r.height / 2, 30);
    sfx.rip();
    await sleep(200);
  }
  gremResult(m) {
    const gid = this.pendingGrem.get(m.id) || this.pendingGrem.get(m.id.replace(/b$/, ''));
    this.pendingGrem.delete(m.id);
    const g = GREM_BY_ID[gid]; if (!g) return;
    const el = $('#oppav', this.root);
    if (m.res === 'hit') {
      if (m.stolen) { this.run.gold += m.stolen; FX.floatAt($('#gold', this.root), `+$${m.stolen} yoink`, 'g'); sfx.money(); }
      el && FX.floatAt(el, 'HIT!', 'm');
      this.run.stats.hits = (this.run.stats.hits || 0) + 1;
    } else if (m.res === 'blocked') { el && FX.floatAt(el, m.by === 'zapper' ? 'ZAPPED' : 'BLOCKED', 'k'); sfx.bonk(); }
    else if (m.res === 'miss') { this.run.gold += g.cost; el && FX.floatAt(el, 'too late, refunded', 'k'); }
    else if (m.res === 'reflect') {
      FX.shout('IT CAME BACK!', { color: '#c86bff', size: 64, sub: 'Their Boomerang Box sent your gremlin home' });
      this.gremQ.push({ t: 'grem', id: 'refl' + m.id, g: gid, reflected: true }); this.drainGrem();
    }
    this.renderSide(); this.updateGate();
  }
  handleEvents() {
    for (const ev of this.run.events.splice(0)) {
      if (ev.k === 'monGone') {
        const d = MON_BY_ID[ev.id];
        toast(`<b>${d.name}</b> ${ev.why}. 🪦 Rest in pieces.`, { av: d.art });
        sfx.fizzle();
      }
    }
  }

  // ================================================================ the clash
  /** The clash: the animation, then what happens next. If the animation ever fails, the overlay still goes
   *  away and the duel carries on, so a glitch can never leave a player stuck behind it. */
  async playClash(m) {
    if (this.over) return;
    try { await this._clashAnim(m); } catch (e) { console.error('clash animation failed', e); }
    this.closeClashOverlay();
    this.lpLock = false;
    if (this.over) return;
    if (!this.lastClash) { const me = this.isHost ? 'a' : 'b'; this.lastClash = { won: m.res.winner === me, lost: !!m.res.winner && m.res.winner !== me, out: {} }; }
    if (this.run.lp <= 0 || this.opp.lp <= 0) {
      const a = this.run.lp, b = this.opp.lp, rv = this.rival;
      this.finish({ won: a > b, draw: a === b, note: a > b ? `${rv.name}'s Life Points hit zero!` : a === b ? 'Double knockout. Both of you are lying on the floor.' : 'Your Life Points hit zero. Your monsters need a nap.' });
      return;
    }
    this.send({ t: 'cdone', r: this.round });
    if (this.isHost) this.hostEvent('cdone', 'h', { r: this.round });
    if (!this.isHost && this.phase === 'clash') { const pz = $('#play', this.root); pz.innerHTML = '<div class="msg">Shop opens in a moment…</div>'; }
    this.renderSide();
  }
  closeClashOverlay() {
    const ov = this.clashOv;
    this.clashOv = null;
    if (ov && ov.isConnected) FX.autoRemove(ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }), ov);
  }
  async _clashAnim(m) {
    this.lastClash = null;
    this.phase = 'clash';
    this.lpLock = true;
    if (!this.run.done) { this.run.done = true; this.sentDone = this.round; }
    this.clearCards();
    const me = this.isHost ? 'a' : 'b', them = this.isHost ? 'b' : 'a';
    const myAtk = m.atk[me], theirAtk = m.atk[them];
    const res = m.res;
    const out = E.applyClash(this.run, res, me);
    const theirLpBefore = this.opp.lp;
    this.opp.lp -= res.dmg[them];
    const won = res.winner === me, lost = res.winner === them;
    this.lastClash = { won, lost, out };
    const close = res.winner && Math.min(myAtk, theirAtk) >= 0.88 * Math.max(myAtk, theirAtk);
    if (won) this.app.profile.quest('clashes');
    if (won && res.dmg[them] >= 1500) this.app.profile.quest('damage');
    // ---- build the overlay
    const meInfo = this.meInfo, rv = this.rival;
    const side = (cls, info, atk, lpNow, lpBefore, mons) => h('div.cl-side.' + cls,
      h('div.cl-av', { html: monsterSVG(avatarOf(info.av, info.code)) }),
      h('div.cl-name', info.name),
      h('div.cl-atk', '0'),
      h('div.lpbox.cl-lp', h('div.lpnum', h('small', 'LP'), h('span.lpv', fmt(Math.max(0, lpBefore)))), h('div.lpbar', h('i.ghost', { style: { width: clamp(lpBefore / RULES.lp, 0, 1) * 100 + '%' } }), h('i.real', { style: { width: clamp(lpBefore / RULES.lp, 0, 1) * 100 + '%' } }))),
      h('div.cl-dmg', ''));
    const myLpBefore = this.run.lp + res.dmg[me];
    const L = side('left', meInfo, myAtk, this.run.lp, myLpBefore);
    const R = side('right', rv, theirAtk, this.opp.lp, theirLpBefore);
    const LM = h('div.cl-mons.left', ...this.run.monsters.map(x => h('div.cl-mon', { html: monsterSVG(MON_BY_ID[x.id].art) })));
    const RM = h('div.cl-mons.right', ...(this.opp.mons || []).map(([id]) => h('div.cl-mon', { html: monsterSVG(MON_BY_ID[id].art) })));
    const mid = h('div.cl-mid');
    const note = h('div.cl-note');
    const box = h('div.clash', L, R, LM, RM, mid, note);
    const ov = h('div.overlay.block', h('div.dim'), box);
    document.body.append(ov);
    this.clashOv = ov;
    FX.setBgMood('battle');
    L.animate([{ transform: 'translateX(-60vw)' }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,1.3,.4,1)' });
    R.animate([{ transform: 'translateX(60vw)' }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,1.3,.4,1)' });
    sfx.swoosh();
    await sleep(500);
    // ---- the numbers race
    const la = L.querySelector('.cl-atk'), ra = R.querySelector('.cl-atk');
    const dur = close ? 2400 : 1500;
    const t0 = performance.now();
    await new Promise(done => {
      let last = 0;
      const f = t => {
        const k = clamp((t - t0) / dur, 0, 1), e = close ? 1 - Math.pow(1 - k, 1.6) : 1 - Math.pow(1 - k, 3);
        la.textContent = fmt(myAtk * e); ra.textContent = fmt(theirAtk * e);
        const step = Math.floor(k * 24);
        if (step !== last) { last = step; sfx.chip(Math.min(15, step >> 1)); }
        if (k < 1) frame(f); else done();
      };
      frame(f);
    });
    // ---- CLASH
    sfx.clash(); FX.flash('#fff', 300); FX.shake(3, 600);
    FX.shout('CLASH!', { color: '#ff4d5e', size: 140, ms: 900 });
    FX.stars(innerWidth / 2, innerHeight / 2, 16);
    await sleep(700);
    if (close) { FX.shout('SO CLOSE!', { color: '#ff9ac0', size: 70, sub: `${fmt(Math.abs(myAtk - theirAtk))} points in it!`, ms: 1200 }); await sleep(900); }
    const W = won ? L : lost ? R : null, Lo = won ? R : lost ? L : null;
    if (!res.winner) {
      FX.shout('DOUBLE BONK!', { color: '#ffd43b', size: 90, sub: 'A perfect tie. Everyone gets hurt.' });
      sfx.bonk();
    } else {
      W.querySelector('.cl-atk').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)', color: '#ffd43b' }, { transform: 'scale(1.2)', color: '#ffd43b' }], { duration: 500, fill: 'forwards' });
      Lo.querySelector('.cl-atk').animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.7) rotate(8deg)', opacity: .5 }], { duration: 500, fill: 'forwards' });
      // traps spring
      for (const id of [...res.used[me], ...res.used[them]]) {
        const it = ITEM_BY_ID[id];
        FX.shout('TRAP CARD!', { color: '#c86bff', size: 80, sub: `${it.art} ${it.name}!` }); sfx.boing();
        await sleep(900);
      }
      // the winner's monsters charge across
      const attackers = won ? [...LM.children] : [...RM.children];
      const targetAv = (won ? R : L).querySelector('.cl-av');
      const [tx, ty] = FX.centerOf(targetAv);
      const words = ['CHOMP!', 'BONK!', 'RRRIP!', 'WHAM!', 'NOM!', 'KAPOW!', 'SMACK!'];
      let i = 0;
      for (const mEl of attackers.length ? attackers : [W.querySelector('.cl-av')]) {
        const [sx, sy] = FX.centerOf(mEl);
        const a = mEl.animate([
          { transform: 'translate(0,0) rotate(0)' },
          { transform: `translate(${(tx - sx) / 2}px, ${(ty - sy) / 2 - 140}px) rotate(${won ? 200 : -200}deg) scale(1.3)` },
          { transform: `translate(${tx - sx}px, ${ty - sy}px) rotate(${won ? 360 : -360}deg) scale(1.1)` },
          { transform: `translate(${(tx - sx) * 0.8}px, ${ty - sy + 60}px) rotate(${won ? 380 : -380}deg) scale(1)`, opacity: 0.0 },
        ], { duration: 520, easing: 'ease-in', fill: 'forwards', delay: 0 });
        await sleep(400);
        sfx[i % 2 ? 'bonk' : 'chomp'](); FX.stars(tx, ty, 7); FX.textPop(tx + (Math.random() - 0.5) * 120, ty - 40, words[i % words.length], '#ffd43b', 42);
        targetAv.animate([{ transform: 'translateX(-10px) rotate(-8deg)' }, { transform: 'translateX(10px) rotate(8deg)' }, { transform: 'none' }], { duration: 220 });
        FX.shake(1.2, 200);
        i++;
        await sleep(Math.max(90, 260 - i * 30));
      }
      // shredded card from the loser's deck
      const shredInfo = lost ? out.shred : null;
      if (shredInfo || won) {
        const fake = shredInfo || { rank: 2 + Math.floor(Math.random() * 13), suit: pick(makeRng(Date.now()), ['S', 'H', 'D', 'C']) };
        const card = h('div.pcard', { style: { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%) scale(1.6)', '--cw': '90px', zIndex: 66 } });
        card.innerHTML = `<div class="pc-sway"><div class="pc-lift"><div class="pc-wrap"><div class="pc-front">${cardHTML(fake)}</div></div></div></div>`;
        document.body.append(card);
        card.animate([{ transform: 'translate(-50%,-50%) scale(.2) rotate(-90deg)' }, { transform: 'translate(-50%,-50%) scale(1.6) rotate(0)' }], { duration: 300, easing: 'cubic-bezier(.2,1.5,.4,1)' });
        await sleep(450);
        await this.tearCard(card);
        FX.textPop(innerWidth / 2, innerHeight / 2 - 80, `RIP ${cardShort(fake)}`, '#fff', 40);
        note.textContent = lost ? `Your ${cardShort(fake)} was shredded out of your deck. (${fake.rank === 14 ? 'It was an Ace. Ouch.' : 'It had a family.'})` : `Your monsters shredded their ${'card'}! 🧻`;
      }
    }
    // ---- damage
    const lpAnim = async (sideEl, before, dmg) => {
      if (!dmg) return;
      const after = before - dmg;
      sideEl.querySelector('.cl-dmg').textContent = `-${fmt(dmg)}`;
      sideEl.querySelector('.cl-dmg').animate([{ transform: 'scale(3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,1.6,.4,1)' });
      sideEl.querySelector('.i.real, i.real').style.width = clamp(after / RULES.lp, 0, 1) * 100 + '%';
      sideEl.querySelector('i.ghost').style.width = clamp(after / RULES.lp, 0, 1) * 100 + '%';
      const lv = sideEl.querySelector('.lpv');
      const t0 = performance.now();
      await new Promise(done => { let k0 = -1; const f = t => { const k = clamp((t - t0) / 900, 0, 1); lv.textContent = fmt(Math.max(0, before - dmg * k)); const kk = Math.floor(k * 20); if (kk !== k0) { k0 = kk; sfx.lpTick(kk); } if (k < 1) frame(f); else done(); }; frame(f); });
    };
    await Promise.all([lpAnim(L, myLpBefore, res.dmg[me]), lpAnim(R, theirLpBefore, res.dmg[them])]);
    if (won) { sfx.victory(); FX.confetti(innerWidth * 0.25, innerHeight * 0.3, 50); }
    else if (lost) { sfx.fizzle(); }
    this.renderOpp();
    await sleep(1100);
  }

  // ================================================================ shop
  startShop() {
    closePop();
    this.clearCards();
    this.myReady = false;
    this.opp.ready = false; this.opp.ph = 'shop';
    FX.setBgMood(this.run.lp < RULES.lp * 0.3 ? 'danger' : 'shop');
    const inc = E.income(this.run, this.lastClash || {});
    if (this.run.lp < this.opp.lp) this.run.freeRerolls += 1;   // trailing: a free reroll
    E.rollShop(this.run);
    this.handleEvents();
    this.incomeLines = inc;
    this.renderShop(true);
    this.renderAll();
    sfx.money();
    const g = $('#gold', this.root);
    if (g) { FX.floatAt(g, `+$${inc.total}`, 'g'); const [x, y] = FX.centerOf(g); FX.sparks(x, y, 16); }
  }
  renderShop(first = false) {
    const pz = $('#play', this.root); if (!pz) return;
    const r = this.run, s = r.shop;
    pz.innerHTML = '';
    const offers = h('div.offers');
    s.offers.forEach((o, i) => offers.append(this.offerEl(o, i, false)));
    const packs = h('div.offers');
    s.packs.forEach((p, i) => {
      const P = E.PACKS[p.id];
      const el = h('div.pack.' + p.id + (p.sold ? '.sold' : ''), { onclick: () => this.buy(i, true, el) },
        h('div.pa', { html: monsterSVG(p.id === 'monpack' ? 'star #ffd43b eyes2 grin sparkle' : 'egg #7fe0c0 eyes2 grin wizardhat') }),
        h('div.pt', P.name), h('div', { style: { fontSize: '11px', position: 'relative' } }, P.desc), h('div', { style: { position: 'relative', fontWeight: 700, color: '#ffd43b', marginTop: '4px' } }, '$' + p.price));
      tip(el, () => `<div class="tn">${P.name}</div><div class="desc">${P.desc}</div>`);
      packs.append(el);
    });
    const rc = r.freeRerolls > 0 ? 'FREE' : '$' + E.rerollCost(r);
    const inc = this.incomeLines;
    pz.append(h('div.shop',
      h('div.shop-head', h('span.title', 'THE MONSTER MART'),
        h('button.btn.purple', { onclick: () => this.reroll() }, '🎲 Reroll ', h('span.price', rc)),
        h('button.btn.green.big#readybtn', { disabled: this.myReady, onclick: () => this.readyUp() }, this.myReady ? 'READY ✔' : 'READY!')),
      offers, packs,
      inc ? h('div.income', ...inc.lines.map(([l, v]) => h('div', h('span', l), h('span', '+$' + v))), h('div.tot', h('span', 'Income'), h('span', '+$' + inc.total))) : null,
    ));
    if (first) [...offers.children, ...packs.children].forEach((el, i) => el.animate([{ transform: 'translateY(40px) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: i * 70, easing: 'cubic-bezier(.2,1.5,.4,1)', fill: 'backwards' }));
  }
  offerEl(o, i) {
    if (o.kind === 'mon') {
      const d = MON_BY_ID[o.id];
      const m = { id: o.id, ed: o.ed, st: {} }; d.init && d.init(m);
      const el = h('div.offer' + (o.ed ? '.ed-' + o.ed : '') + (o.sold ? '.sold' : ''), { style: { '--rc': RARITY[d.rar].color } },
        h('div.oart', { html: monsterSVG(d.art) }), h('div.on', d.name),
        h('div.or', { style: { color: RARITY[d.rar].color } }, RARITY[d.rar].name + (o.ed ? ' · ' + EDITIONS[o.ed].name : '')),
        h('div.desc', { html: typeof d.desc === 'function' ? d.desc(m) : d.desc }),
        h('button.btn.gold.small', { onclick: () => this.buy(i, false, el) }, 'Buy ', h('span.price', '$' + o.price)));
      tip(el.querySelector('.oart'), () => monTipHTML(m));
      return el;
    }
    const d = ITEM_BY_ID[o.id];
    const el = h('div.offer' + (o.sold ? '.sold' : ''), { style: { '--rc': d.kind === 'trap' ? '#8a2be2' : d.kind === 'tome' ? '#2a5cc4' : '#1a9a6c' } },
      h('div.oemo', d.art), h('div.on', d.name), h('div.or', { style: { color: d.kind === 'trap' ? '#8a2be2' : d.kind === 'tome' ? '#2a5cc4' : '#1a9a6c' } }, d.kind === 'tome' ? 'Tome' : d.kind === 'trap' ? 'Trap' : 'Spell'),
      h('div.desc', { html: d.desc }),
      h('button.btn.gold.small', { onclick: () => this.buy(i, false, el) }, 'Buy ', h('span.price', '$' + o.price)));
    return el;
  }
  buy(i, isPack, el) {
    if (this.phase !== 'shop') return;
    const res = E.buy(this.run, i, isPack);
    if (res.err) { sfx.nope(); toast(res.err, { ms: 2200 }); return; }
    sfx.buy();
    this.app.profile.quest('buy');
    if (el) { const [x, y] = FX.centerOf(el); FX.sparks(x, y, 18); }
    if (res.mon) { FX.shout(MON_BY_ID[res.mon.id].name.toUpperCase() + '!', { size: 48, color: '#ff9ac0' }); sfx.boing(); }
    if (res.pack) { this.openPackUI(res.pack); }
    this.renderShop(); this.renderZones(); this.renderSide();
    this.handleEvents();
  }
  openPackUI(pack) {
    sfx.packOpen();
    modal((m, close) => {
      m.dataset.keep = 1;
      m.append(h('h2', E.PACKS[pack.id].name + '!'), h('p', 'Pick one. The rest go back to the void.'));
      const row = h('div.offers');
      pack.choices.forEach((c, i) => {
        let el;
        if (c.kind === 'mon') {
          const d = MON_BY_ID[c.id]; const mm = { id: c.id, ed: c.ed, st: {} }; d.init && d.init(mm);
          el = h('div.offer' + (c.ed ? '.ed-' + c.ed : ''), { style: { '--rc': RARITY[d.rar].color } },
            c.isNew ? h('div.newtag', 'NEW!') : null,
            h('div.oart', { html: monsterSVG(d.art) }), h('div.on', d.name), h('div.or', { style: { color: RARITY[d.rar].color } }, RARITY[d.rar].name + (c.ed ? ' · ' + EDITIONS[c.ed].name : '')),
            h('div.desc', { html: typeof d.desc === 'function' ? d.desc(mm) : d.desc }));
        } else {
          const d = ITEM_BY_ID[c.id];
          el = h('div.offer', h('div.oemo', d.art), h('div.on', d.name), h('div.desc', { html: d.desc }));
        }
        el.append(h('button.btn.gold.small', { onclick: () => {
          const r = E.takeFromPack(this.run, i);
          if (r.err) { sfx.nope(); toast(r.err, { ms: 2500 }); return; }
          sfx.buy(); close();
          if (r.isNew) { this.app.profile.grant({ kind: 'mon', id: c.id }); this.app.profile.save(); FX.shout('NEW MONSTER FOUND!', { color: '#c86bff', size: 60, sub: MON_BY_ID[c.id].name + ' joins your collection forever' }); sfx.reveal(4); FX.confetti(innerWidth / 2, innerHeight / 2, 80); }
          else if (r.used) toast('📖 ' + r.used);
          this.renderShop(); this.renderZones(); this.renderSide();
        } }, 'Take'));
        const d = c.kind === 'mon' ? MON_BY_ID[c.id] : null;
        el.animate([{ transform: 'rotateY(90deg) scale(.6)' }, { transform: 'none' }], { duration: 400, delay: 150 + i * 160, easing: 'cubic-bezier(.2,1.4,.4,1)', fill: 'backwards' });
        setTimeout(() => sfx.reveal(d ? d.rar : 1), 150 + i * 160);
        row.append(el);
      });
      m.append(row, h('div', { style: { textAlign: 'center', marginTop: '14px' } }, h('button.btn.ghost.small', { style: { color: '#24163a' }, onclick: () => { this.run.pack = null; close(); } }, 'Skip')));
    }, { wide: true });
  }
  reroll() {
    if (this.phase !== 'shop') return;
    const r = E.reroll(this.run);
    if (r.err) { sfx.nope(); toast(r.err, { ms: 2000 }); return; }
    sfx.reroll(); this.app.profile.quest('reroll');
    this.renderShop(true); this.renderSide();
  }
  readyUp(auto) {
    if (this.phase !== 'shop' || this.myReady) return;
    this.myReady = true;
    closePop();
    $$('.modal-bg').forEach(m => m.remove());
    this.send({ t: 'ready', r: this.round });
    if (this.isHost) this.hostEvent('ready', 'h', { r: this.round });
    if (!auto) sfx.chime();
    this.renderShop();
  }

  // ================================================================ monster & item menus
  monMenu(m, el) {
    popover(el, p => {
      const d = MON_BY_ID[m.id];
      p.append(h('div', { html: monTipHTML(m) }));
      const btns = h('div.pbtns');
      const i = this.run.monsters.indexOf(m);
      btns.append(h('button.btn.dark.small', { disabled: i <= 0, onclick: () => { E.moveMonster(this.run, m.uid, -1); closePop(); this.renderZones(); } }, '◀'));
      btns.append(h('button.btn.dark.small', { disabled: i >= this.run.monsters.length - 1, onclick: () => { E.moveMonster(this.run, m.uid, 1); closePop(); this.renderZones(); } }, '▶'));
      btns.append(h('button.btn.red.small', { onclick: () => {
        const r = E.sell(this.run, m.uid); closePop();
        if (!r.err) { sfx.sell(); FX.floatAt($('#gold', this.root), `+$${r.gold}`, 'g'); const [x, y] = FX.centerOf(el); FX.shreds(x, y, 20); this.renderZones(); this.renderSide(); }
      } }, `Sell $${E.sellValue(m)}`));
      p.append(btns, h('div', { style: { fontSize: '12px', marginTop: '6px', color: '#7a6a88' } }, 'Monsters score left to right. Order matters!'));
    });
  }
  itemMenu(it, el) {
    const d = ITEM_BY_ID[it.id];
    popover(el, p => {
      p.append(h('div', { html: itemTipHTML(it.id) }));
      const btns = h('div.pbtns');
      const needsCards = d.sel[1] > 0;
      const label = d.kind === 'trap' ? 'Set trap' : d.kind === 'tome' ? 'Read it' : 'Cast';
      btns.append(h('button.btn.green.small', { onclick: () => this.useItem(it, el) }, label));
      btns.append(h('button.btn.red.small', { onclick: () => { const r = E.sellItem(this.run, it.uid); closePop(); if (!r.err) { sfx.sell(); this.renderZones(); this.renderSide(); } } }, `Sell $${Math.max(1, Math.floor(d.price / 2))}`));
      p.append(btns);
      if (needsCards) p.append(h('div', { style: { fontSize: '12px', marginTop: '6px', color: '#7a6a88' } }, this.phase === 'battle' ? `Select ${d.sel[0] === d.sel[1] ? d.sel[0] : d.sel[0] + '-' + d.sel[1]} card(s) in your hand first.` : 'Use this during a round, on cards in your hand.'));
    });
  }
  useItem(it, el) {
    const d = ITEM_BY_ID[it.id];
    if (d.sel[1] > 0 && (this.phase !== 'battle' || this.run.done)) { sfx.nope(); toast('Use that during a round, with cards selected.', { ms: 2200 }); return; }
    if (this.busy) return;
    const sel = this.run.hand.filter(c => this.sel.has(c.uid)).map(c => c.uid);
    const res = E.useItem(this.run, it.uid, d.sel[1] > 0 ? sel : []);
    closePop();
    if (res.err) { sfx.nope(); toast(res.err, { ms: 2200 }); return; }
    if (d.kind === 'trap') { sfx.boing(); FX.shout('TRAP SET!', { color: '#c86bff', size: 60 }); this.app.profile.quest('trap'); }
    else { sfx.xmult(4); FX.shout(d.name.toUpperCase() + '!', { size: 54, color: '#7fe0c0', sub: res.msg }); }
    const [x, y] = FX.centerOf(el); FX.sparks(x, y, 20, '#7fe0c0');
    if (it.id === 'shredder') this.app.profile.quest('shred', res.cards.length);
    for (const u of res.cards || []) {
      const cel = this.cardEls.get(u);
      if (!cel) continue;
      const c = this.run.hand.find(x => x.uid === u);
      if (!c) { this.tearCard(cel); this.cardEls.delete(u); continue; }
      this.paintCard(cel, c); FX.jiggle(cel, 1.4);
      const [cx, cy] = FX.centerOf(cel); FX.sparks(cx, cy, 10, '#ffd43b');
    }
    this.sel.clear();
    this.handleEvents();
    if (this.phase === 'battle') { E.drawToFull(this.run); this.layoutHand(); }
    this.renderZones(); this.renderSide(); this.renderActions();
  }
  deckView() {
    const r = this.run;
    modal(m => {
      m.append(h('h2', `Your deck (${r.deck.length} cards)`), h('p', { style: { margin: '0 0 10px' } }, this.phase === 'battle' ? `${r.draw.length} left to draw this round.` : ''));
      const grid = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', '--cw': '46px' } });
      const so = { S: 0, H: 1, C: 2, D: 3 };
      [...r.deck].sort((a, b) => so[a.suit] - so[b.suit] || b.rank - a.rank).forEach(c => {
        const inDraw = this.phase !== 'battle' || r.draw.includes(c);
        const el = h('div.pcard' + (c.enh ? '.enh-' + c.enh : ''), { style: { position: 'relative', opacity: inDraw ? 1 : 0.35 } });
        el.innerHTML = `<div class="pc-front" style="position:absolute;inset:0">${cardHTML(c)}</div>`;
        grid.append(el);
      });
      m.append(grid);
      const lv = h('div', { style: { marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: '4px 12px', fontSize: '14px' } });
      for (const H of Object.values(HAND_BY_ID)) {
        if (H.secret && !r.played[H.id]) continue;
        const b = handBase(r.levels, H.id);
        lv.append(h('div', h('b', `${H.name} `), `lv${b.level}: `, h('b', { style: { color: '#2563c4' } }, b.chips), ' × ', h('b', { style: { color: '#d92b3d' } }, b.mult)));
      }
      m.append(h('h3', { style: { margin: '14px 0 4px' } }, 'Hand levels'), lv);
    }, { wide: true });
  }

  // ================================================================ emotes
  emoteMenu(btn) {
    popover(btn, p => {
      p.append(h('div.pn', 'Taunt your rival'));
      const row = h('div.emotebar');
      for (const id of this.app.profile.data.emotes) {
        const e = EMOTES[id];
        row.append(h('button.btn.dark.small', { onclick: () => { closePop(); this.sendEmote(id); } }, `${e.e} ${e.text}`));
      }
      p.append(row);
    });
  }
  sendEmote(id) {
    if (now() - this.lastEmote < 2500) { sfx.nope(); return; }
    this.lastEmote = now();
    this.send({ t: 'emote', e: id });
    this.showEmote(id, true);
  }
  showEmote(id, mine) {
    const e = EMOTES[id]; if (!e) return;
    sfx.taunt();
    const anchor = mine ? $('#side', this.root) : $('#oppav', this.root);
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const b = h('div.bubble' + (mine ? '.up' : ''), `${e.e} ${e.text}`);
    b.style.left = (r.left + 10) + 'px';
    b.style.top = mine ? (r.top - 50) + 'px' : (r.bottom + 12) + 'px';
    if (mine) b.style.top = Math.max(10, r.bottom - 60) + 'px';
    b.style.position = 'fixed';
    document.body.append(b);
    FX.autoRemove(b.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.15 }, { transform: 'scale(1)', opacity: 1, offset: 0.85 }, { transform: 'scale(.9)', opacity: 0 }], { duration: 2800 }), b);
  }
  confirmLeave() {
    modal((m, close) => {
      m.append(h('h2', 'Run away?'), h('p', 'Leaving now counts as a loss. Your monsters will be SO disappointed.'),
        h('div', { style: { display: 'flex', gap: '10px' } }, h('button.btn.red', { onclick: () => { close(); this.forfeit(); } }, 'Run away'), h('button.btn.green', { onclick: close }, 'Keep fighting!')));
    });
  }

  // ================================================================ end
  questHand(res) {
    const P = this.app.profile;
    if (res.type === 'flush' || res.type === 'straightflush') P.quest('flush');
    if (res.type === 'straight' || res.type === 'straightflush') P.quest('straight');
    if (res.type === 'fullhouse' || res.type === 'flushhouse') P.quest('fullhouse');
    if (res.total >= 2000) P.quest('bighand');
    if (res.total >= 10000) P.quest('hugehand');
  }
  finish({ won, draw = false, forfeit = false, note = '' }) {
    if (this.over) return;
    this.over = true; this.phase = 'over';
    clearTimeout(this.hostT);
    this.clearCards();
    $$('.overlay').forEach(o => o.remove());
    if (this.netBanner) { this.netBanner.remove(); this.netBanner = null; }
    const P = this.app.profile;
    P.quest('duel2');
    if (won) P.quest('win');
    if (this.friendly) P.quest('friend');
    const summary = P.finishDuel({ won, rival: this.rival, friendly: this.friendly, run: this.run, rounds: this.round });
    this.emit('over', { won, draw, forfeit, note, summary, run: this.run, rounds: this.round, rival: this.rival, oppLp: this.opp.lp });
  }
}

/** Developer-only stand-in rival (?devbot in the address): plays its own rounds in this tab, for testing the duel flow. */
export class BotLink extends Emitter {
  constructor(seed) {
    super();
    this.run = E.newRun(seed);
    this.isLost = false;
    this.round = 0;
  }
  start() { return this; }
  close() { clearInterval(this.t); }
  send(m) { setTimeout(() => this.onHost(m), 120); }
  out(m) { setTimeout(() => this.emit('msg', m), 150); }
  st() { const r = this.run; this.out({ t: 'st', lp: r.lp, atk: r.atk, hands: r.hands, gold: r.gold, mons: r.monsters.map(m => [m.id, m.ed]), traps: r.traps.length, heart: Math.round(r.heart), ph: this.ph, done: !!r.done, ready: this.ready, r: this.round }); }
  async onHost(m) {
    const r = this.run;
    if (m.t === 'phase') {
      this.ph = m.ph;
      if (m.ph === 'pick') { await sleep(1500); E.addMonster(r, E.starterChoices(r)[0]); this.out({ t: 'picked' }); }
      if (m.ph === 'battle') {
        this.round = m.r; E.startRound(r, m.r, m.boss); this.ready = false;
        while (r.hands > 0 && this.round === m.r) {
          await sleep(3500 + Math.random() * 2500);
          if (this.round !== m.r) return;
          if (r.gold >= 3 && Math.random() < 0.5) { const g = pick(makeRng(Date.now()), GREMLINS.filter(x => x.cost <= r.gold && !x.once)); E.paySend(r, g.id); this.out({ t: 'grem', id: 'bot' + Date.now(), g: g.id }); }
          const res = E.playHand(r, E.botChooseHand(r), { oppLp: 4000 });
          this.out({ t: 'hand', r: m.r, type: res.type, total: res.total, atk: r.atk, hands: r.hands });
          this.st();
        }
        this.out({ t: 'done', r: m.r, atk: r.atk, mons: r.monsters.length, traps: r.traps.map(t => t.id) });
      }
      if (m.ph === 'shop') {
        E.income(r, {}); E.rollShop(r);
        for (let i = 0; i < 4; i++) E.buy(r, i);
        await sleep(4000); this.ready = true; this.out({ t: 'ready', r: m.r });
      }
    }
    if (m.t === 'clash') { E.applyClash(r, m.res, 'b'); setTimeout(() => this.out({ t: 'cdone', r: m.r }), 7000); }
    if (m.t === 'grem') { const res = E.applyGremlin(r, m.g); this.out({ t: 'gremr', id: m.id, res: res.res, stolen: res.stolen || 0, by: res.by }); }
    if (m.t === 'emote') setTimeout(() => this.out({ t: 'emote', e: 'lol' }), 800);
    if (m.t === 'rematch') this.out({ t: 'rematch' });
  }
}

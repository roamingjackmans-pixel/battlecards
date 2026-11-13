// The rules of one duelist's side of a duel: deck, hands, scoring, gremlins, traps, the shop.
// Pure logic (no page code) so tools/test.mjs can run it in Node. Every random roll uses run.rng.
import { makeRng, rand, randInt, chance, pick, shuffle, weighted, clamp } from './util.js';
import { SUIT_KEYS, HANDS, HAND_BY_ID, evalHand, handBase, cardChips, isFace, suitIs, bestFive, cardShort } from './cards.js';
import { MONSTERS, MON_BY_ID, EDITIONS, STARTER_POOL } from './monsters.js';
import { ITEMS, ITEM_BY_ID, GREM_BY_ID, ECO_CAP, BOSSES } from './items.js';

export const RULES = {
  lp: 4000, hands: 4, discards: 3, handSize: 8, monSlots: 5, itemSlots: 2, trapSlots: 2,
  battleSec: 90, shopSec: 40, pickSec: 25, clashSec: 9, startGold: 4, rerollCost: 3,
};

// ---------------------------------------------------------------- setup
export function newRun(seed, opts = {}) {
  const run = {
    seed, rng: makeRng(seed), uid: 1,
    lp: RULES.lp, gold: RULES.startGold, eco: 0, heart: 0,
    round: 0, boss: null, phase: 'pick',
    deck: [], draw: [], hand: [], pile: [],
    levels: Object.fromEntries(HANDS.map(H => [H.id, 1])),
    monsters: [], items: [], traps: [],
    monSlots: RULES.monSlots, itemSlots: RULES.itemSlots, trapSlots: RULES.trapSlots,
    hands: 0, discards: 0, handsPlayed: 0, atk: 0, lastHand: 0,
    muncher: 0, hogged: false, heartArmed: false, heartUsed: 0,
    pool: opts.pool || STARTER_POOL.slice(), shop: null, freeRerolls: 0,
    played: {},   // hand types played this duel (secret tomes only show up after you've played one)
    stats: { sent: 0, taken: 0, blocked: 0, clashWins: 0, clashLosses: 0, lossStreak: 0, best: 0, bestType: null, handCounts: {}, destroyed: 0, rerolls: 0, bought: 0, dmgDealt: 0, dmgTaken: 0, heartUsed: 0, enemyShredded: 0 },
    events: [],
  };
  for (const s of SUIT_KEYS) for (let r = 2; r <= 14; r++) run.deck.push(newCard(run, r, s));
  return run;
}
export const newCard = (run, rank, suit, enh = null) => ({ uid: run.uid++, rank, suit, enh, bonus: 0 });

export function passives(run) {
  const p = { handSize: 0, discards: 0, hands: 0, interestCap: 0, four: false, heart: false, gremlinTwice: false };
  run.monsters.forEach((m, i) => {
    const d = hookDef(run, i);
    if (!d || !d.passive) return;
    for (const [k, v] of Object.entries(d.passive)) p[k] = typeof v === 'boolean' ? (p[k] || v) : p[k] + v;
  });
  return p;
}

/** The rules a monster follows (Copycat Cat follows its right-hand neighbour's). */
function hookDef(run, i) {
  const d = MON_BY_ID[run.monsters[i].id];
  if (!d.copy) return d;
  const r = run.monsters[i + 1];
  if (!r) return null;
  const rd = MON_BY_ID[r.id];
  if (rd.copy) return null;
  return { card: rd.card, retrig: rd.retrig, held: rd.held, hand: rd.hand, passive: rd.passive, _copyOf: r };
}
const monState = (run, i) => { const d = MON_BY_ID[run.monsters[i].id]; return d.copy && run.monsters[i + 1] ? run.monsters[i + 1] : run.monsters[i]; };

// ---------------------------------------------------------------- monsters & cards
export function addMonster(run, id, ed = null) {
  if (run.monsters.length >= run.monSlots) return null;
  const m = { uid: run.uid++, id, ed, st: {} };
  const d = MON_BY_ID[id];
  if (d.init) d.init(m, run);
  run.monsters.push(m);
  run.events.push({ k: 'monAdd', uid: m.uid, id });
  return m;
}
export function removeMonster(run, uid, why) {
  const m = run.monsters.find(x => x.uid === uid);
  if (!m) return;
  run.monsters = run.monsters.filter(x => x !== m);
  if (why) run.events.push({ k: 'monGone', uid, id: m.id, why });
}
export function sellValue(m) {
  const d = MON_BY_ID[m.id];
  return Math.max(1, Math.floor((d.cost + (m.ed ? EDITIONS[m.ed].cost : 0)) / 2) + (m.st.extra || 0));
}

export function destroyCard(run, card, why = 'destroyed') {
  const had = run.deck.includes(card);
  run.deck = run.deck.filter(c => c !== card);
  run.hand = run.hand.filter(c => c !== card);
  run.draw = run.draw.filter(c => c !== card);
  run.pile = run.pile.filter(c => c !== card);
  if (!had) return;
  run.stats.destroyed++;
  run.monsters.forEach(m => { const d = MON_BY_ID[m.id]; d.destroyed && d.destroyed(run, m, card); });
  run.events.push({ k: 'cardGone', uid: card.uid, name: cardShort(card), why });
}

export const isDebuffed = (run, c) => {
  if (!run.boss) return false;
  if (run.boss.id === 'suitthief') return c.enh !== 'wild' && c.suit === run.boss.suit;
  if (run.boss.id === 'plainjane') return isFace(c);
  return false;
};

// ---------------------------------------------------------------- rounds
export function pickBoss(seedRng) {
  const b = pick(seedRng, BOSSES);
  return { id: b.id, suit: b.suit ? pick(seedRng, SUIT_KEYS) : null };
}

export function startRound(run, r, boss) {
  run.round = r; run.boss = boss || null; run.phase = 'battle';
  const p = passives(run);
  run.hands = RULES.hands + p.hands;
  run.discards = boss && boss.id === 'mime' ? 0 : RULES.discards + p.discards;
  run.handsPlayed = 0; run.atk = 0; run.lastHand = 0;
  run.muncher = 0; run.hogged = false;
  run.done = false;
  for (const c of run.deck) { delete c.down; delete c.sticky; }
  run.hand = []; run.pile = [];
  run.draw = shuffle(run.rng, run.deck.slice());
  run.monsters.forEach(m => { const d = MON_BY_ID[m.id]; d.roundStart && d.roundStart(run, m); });
  drawToFull(run);
}
export const handSize = run => Math.max(1, RULES.handSize + passives(run).handSize - (run.boss && run.boss.id === 'tiny' ? 2 : 0));

export function drawToFull(run) {
  const n = handSize(run);
  const drawn = [];
  while (run.hand.length < n && run.draw.length) {
    const c = run.draw.pop();
    if (run.boss && run.boss.id === 'fog' && chance(run.rng, 1 / 3)) c.down = true;
    run.hand.push(c); drawn.push(c);
  }
  return drawn;
}

export function discard(run, uids) {
  if (run.discards <= 0) return { err: 'No discards left' };
  const cards = run.hand.filter(c => uids.includes(c.uid));
  if (!cards.length || cards.length > 5) return { err: 'Pick 1 to 5 cards' };
  if (cards.some(c => c.sticky)) return { err: 'Glued! Those cards won\'t budge.' };
  run.discards--;
  run.hand = run.hand.filter(c => !cards.includes(c));
  for (const c of cards) { delete c.down; run.pile.push(c); }
  run.monsters.forEach(m => { const d = MON_BY_ID[m.id]; d.discard && d.discard(run, cards, m); });
  const drawn = drawToFull(run);
  return { cards, drawn };
}

// ---------------------------------------------------------------- scoring
/**
 * Plays the chosen cards. Returns the whole calculation as steps the screen animates one by one:
 * { type, steps: [{k, uid, chips, mult, add, msg}], chips, mult, total, money, drawn }.
 */
export function playHand(run, uids, env = {}) {
  if (run.hands <= 0) return { err: 'No hands left' };
  const played = run.hand.filter(c => uids.includes(c.uid));
  if (!played.length || played.length > 5) return { err: 'Pick 1 to 5 cards' };
  // keep the order the cards are in the hand (left to right)
  const p = passives(run);
  const ev = evalHand(played, { four: p.four });
  const held = run.hand.filter(c => !played.includes(c));
  const base = handBase(run.levels, ev.type);
  let chips = base.chips, mult = base.mult, money = 0;
  const steps = [{ k: 'base', type: ev.type, level: base.level, chips, mult }];
  const out = {};
  const ctx = {
    run, type: ev.type, played, scoring: ev.scoring, held, has: ev.has, env: { oppLp: RULES.lp, ...env }, out,
    first: run.handsPlayed === 0, last: run.hands === 1,
    suitIs, isFaceLike: isFace,
  };
  const push = (k, uid, eff) => {
    if (!eff) return;
    let did = false;
    if (eff.chips) { chips += eff.chips; did = true; }
    if (eff.mult) { mult += eff.mult; did = true; }
    if (eff.xmult && eff.xmult !== 1) { mult *= eff.xmult; did = true; }
    if (eff.money) { money += eff.money; did = true; }
    if (did || eff.msg) steps.push({ k, uid, chips, mult, dc: eff.chips || 0, dm: eff.mult || 0, xm: eff.xmult || 0, money: eff.money || 0, msg: eff.msg || null });
  };

  if (run.boss && run.boss.id === 'taxman') { run.gold = Math.max(0, run.gold - 1); steps.push({ k: 'boss', chips, mult, msg: '-$1 TAX', money: -1 }); }

  run.monsters.forEach((m, i) => { const d = MON_BY_ID[m.id]; d.before && d.before(ctx, m); });

  // 1. each scoring card, left to right, with retriggers
  for (const c of ev.scoring) {
    if (isDebuffed(run, c)) { steps.push({ k: 'debuff', uid: c.uid, chips, mult, msg: 'DEBUFFED' }); continue; }
    let times = 1;
    run.monsters.forEach((m, i) => { const d = hookDef(run, i); if (d && d.retrig) times += d.retrig(ctx, c, monState(run, i)) || 0; });
    for (let t = 0; t < times; t++) {
      if (t > 0) steps.push({ k: 'retrig', uid: c.uid, chips, mult, msg: 'AGAIN!' });
      push('card', c.uid, { chips: cardChips(c) });
      if (c.enh === 'spicy') push('card', c.uid, { mult: 4 });
      if (c.enh === 'gilded') push('card', c.uid, { money: 2 });
      if (c.enh === 'glass') push('card', c.uid, { xmult: 2 });
      if (c.enh === 'lucky') {
        if (chance(run.rng, 1 / 5)) push('card', c.uid, { mult: 20, msg: 'LUCKY!' });
        if (chance(run.rng, 1 / 15)) push('card', c.uid, { money: 10, msg: 'JACKPOT!' });
      }
      run.monsters.forEach((m, i) => {
        const d = hookDef(run, i);
        if (d && d.card) push('mon', run.monsters[i].uid, d.card(ctx, c, monState(run, i)));
      });
    }
  }
  // 2. cards held in hand
  for (const c of held) {
    if (isDebuffed(run, c)) continue;
    if (c.enh === 'steel') push('held', c.uid, { xmult: 1.5 });
    run.monsters.forEach((m, i) => { const d = hookDef(run, i); if (d && d.held) push('mon', run.monsters[i].uid, d.held(ctx, c, monState(run, i))); });
  }
  // 3. monsters, left to right
  run.monsters.forEach((m, i) => {
    if (m.ed === 'foil') push('ed', m.uid, { chips: 50 });
    if (m.ed === 'holo') push('ed', m.uid, { mult: 10 });
    const d = hookDef(run, i);
    if (d && d.hand) push('mon', m.uid, d.hand(ctx, monState(run, i)));
    if (m.ed === 'shiny') push('ed', m.uid, { xmult: 1.5 });
  });
  // 4. Heart of the Cards, gremlin munching
  if (run.heartArmed) {
    run.heartArmed = false;
    push('heart', null, { xmult: p.heart ? 4 : 2, msg: 'HEART OF THE CARDS!' });
  }
  if (run.muncher > 0) {
    run.muncher--;
    push('munch', null, { xmult: 0.5, msg: 'MUNCHED!' });
  }
  mult = Math.max(0, mult);
  const total = Math.floor(chips * mult);

  run.monsters.forEach(m => { const d = MON_BY_ID[m.id]; d.after && d.after(ctx, m); });

  // bookkeeping
  run.hands--; run.handsPlayed++;
  run.atk += total; run.lastHand = total;
  run.gold += money;
  run.played[ev.type] = 1;
  run.stats.handCounts[ev.type] = (run.stats.handCounts[ev.type] || 0) + 1;
  if (total > run.stats.best) { run.stats.best = total; run.stats.bestType = ev.type; }
  run.hand = held;
  const shattered = [];
  for (const c of played) {
    delete c.down; delete c.sticky;
    if (c.enh === 'glass' && !isDebuffed(run, c) && ev.scoring.includes(c) && chance(run.rng, 1 / 4)) shattered.push(c);
    else run.pile.push(c);
  }
  for (const c of shattered) { run.deck = run.deck.filter(x => x !== c); run.stats.destroyed++; run.events.push({ k: 'cardGone', uid: c.uid, name: cardShort(c), why: 'shattered' }); run.monsters.forEach(m => { const d = MON_BY_ID[m.id]; d.destroyed && d.destroyed(run, m, c); }); }
  // monsters that wore out
  for (const m of [...run.monsters]) if (m.st.dead) removeMonster(run, m.uid, m.st.dead);
  let eaten = null;
  if (run.boss && run.boss.id === 'moon' && run.hand.length) {
    eaten = pick(run.rng, run.hand);
    run.hand = run.hand.filter(c => c !== eaten); run.pile.push(eaten);
  }
  let printed = null;
  if (out.printSpell && run.items.length < run.itemSlots) {
    const it = pick(run.rng, ITEMS.filter(i => i.kind === 'spell'));
    run.items.push({ uid: run.uid++, id: it.id }); printed = it.id;
  }
  const drawn = drawToFull(run);
  if (run.hands <= 0) run.done = true;
  return { type: ev.type, scoring: ev.scoring.map(c => c.uid), played: played.map(c => c.uid), steps, chips, mult, total, money, drawn, shattered: shattered.map(c => c.uid), eaten: eaten && eaten.uid, printed };
}

// ---------------------------------------------------------------- Heart of the Cards
export const heartGain = (run, amount) => {
  const p = passives(run);
  run.heart = clamp(run.heart + amount * (p.heart ? 2 : 1), 0, 100);
};
/** Believe! Pulls the best possible hand out of your deck into your hand. Returns the uids to select. */
export function heartActivate(run) {
  if (run.heart < 100 || run.hands <= 0 || run.heartArmed) return { err: 'Not yet…' };
  run.heart = 0; run.heartArmed = true; run.heartUsed++; run.stats.heartUsed++;
  const pile = [...run.hand, ...run.draw];
  const best = bestFive(pile, { four: passives(run).four });
  const keep = run.hand.filter(c => !best.includes(c));
  const size = handSize(run);
  // the destiny cards, plus as many of your old cards as still fit
  const newHand = [...best, ...keep.slice(0, Math.max(0, size - best.length))];
  const back = run.hand.filter(c => !newHand.includes(c));
  run.draw = run.draw.filter(c => !best.includes(c)).concat(back);
  shuffle(run.rng, run.draw);
  for (const c of best) { delete c.down; }
  run.hand = newHand;
  return { best: best.map(c => c.uid) };
}

// ---------------------------------------------------------------- gremlins (on the side that gets hit)
/** A gremlin arrives. Bouncer Bear and traps get the first go. Returns what happened. */
export function applyGremlin(run, gid) {
  const g = GREM_BY_ID[gid];
  const bear = run.monsters.find(m => m.id === 'bouncer' && m.st.ready);
  if (bear) { bear.st.ready = false; run.stats.blocked++; return { res: 'blocked', by: 'bouncer', msg: 'Bouncer Bear: "Not on the list."' }; }
  const trap = run.traps.find(t => ITEM_BY_ID[t.id].trigger === 'gremlin');
  if (trap) {
    run.traps = run.traps.filter(t => t !== trap);
    run.stats.blocked++;
    if (trap.id === 'boomerang') return { res: 'reflect', by: 'boomerang', msg: 'BOOMERANG BOX! Return to sender!' };
    run.gold += 3;
    return { res: 'blocked', by: 'zapper', msg: 'ZZZAP! +$3', money: 3 };
  }
  run.stats.taken++;
  heartGain(run, 8);
  const r = { res: 'hit', cards: [], msg: '' };
  const inHand = run.hand.slice();
  switch (gid) {
    case 'rat': {
      if (!inHand.length) break;
      const c = pick(run.rng, inHand);
      run.hand = run.hand.filter(x => x !== c); delete c.down; delete c.sticky; run.pile.push(c);
      r.cards = [c.uid]; r.msg = `${cardShort(c)} got shredded!`;
      r.drawn = drawToFull(run).map(x => x.uid);
      break;
    }
    case 'bat': {
      const up = shuffle(run.rng, inHand.filter(c => !c.down)).slice(0, 3);
      for (const c of up) c.down = true;
      r.cards = up.map(c => c.uid); r.msg = 'Ink everywhere! Cards flipped!';
      break;
    }
    case 'snail': {
      const free = shuffle(run.rng, inHand.filter(c => !c.sticky)).slice(0, 2);
      for (const c of free) c.sticky = true;
      r.cards = free.map(c => c.uid); r.msg = 'Glued! Those cards can\'t be discarded.';
      break;
    }
    case 'raccoon': {
      const s = Math.min(3, Math.max(0, run.gold));
      run.gold -= s; r.stolen = s; r.msg = s ? `The raccoon took $${s}!` : 'The raccoon found nothing. It\'s disappointed in you.';
      break;
    }
    case 'muncher': run.muncher++; r.msg = 'Your next hand gets half Mult!'; break;
    case 'chomper': {
      if (!inHand.length) break;
      const c = pick(run.rng, inHand);
      r.cards = [c.uid]; r.msg = `${cardShort(c)} was EATEN. Forever.`;
      destroyCard(run, c, 'eaten');
      r.drawn = drawToFull(run).map(x => x.uid);
      break;
    }
    case 'hog': {
      if (run.hands > 1 && !run.hogged) { run.hands--; run.hogged = true; r.msg = 'The Hand Hog stole a hand!'; }
      else r.msg = 'The Hand Hog found nothing to steal. It oinks sadly.';
      break;
    }
  }
  return r;
}

/** Sending one: pay for it, gain eco. Returns an error string or null. */
export function canSend(run, gid, now, cds) {
  const g = GREM_BY_ID[gid];
  if (run.gold < g.cost) return 'Not enough gold';
  if (cds[gid] && cds[gid] > now) return 'Cooling down';
  if (g.once && run.hogSent === run.round) return 'Once per round';
  return null;
}
export function paySend(run, gid) {
  const g = GREM_BY_ID[gid];
  run.gold -= g.cost;
  run.eco = Math.min(ECO_CAP, run.eco + g.eco);
  run.stats.sent++;
  if (g.once) run.hogSent = run.round;
}

// ---------------------------------------------------------------- the clash
const round10 = x => Math.round(x / 10) * 10;
export const clashBase = r => 200 + 100 * r;
/**
 * Works out a clash. a and b: { atk, mons (monster count), traps: ids of traps set }.
 * Returns { winner: 'a'|'b'|null, dmg: {a, b}, used: {a: [], b: []}, ratio, crush }.
 */
export function clashResult(r, boss, a, b) {
  const bm = boss ? 1.5 : 1, sudden = r >= 10 ? 2 : 1;
  const base = clashBase(r) * bm * sudden;
  const used = { a: [], b: [] };
  if (a.atk === b.atk) {
    const d = round10(base * 0.5);
    return { winner: null, dmg: { a: d, b: d }, used, ratio: 1, crush: 1 };
  }
  const W = a.atk > b.atk ? 'a' : 'b', L = W === 'a' ? 'b' : 'a';
  const w = W === 'a' ? a : b, l = W === 'a' ? b : a;
  const ratio = w.atk / Math.max(1, l.atk);
  const crush = clamp(1 + (ratio - 1) * 0.5, 1, 2.25);
  let dmg = base * crush + 25 * (w.mons || 0) * bm * sudden;
  if ((w.traps || []).includes('spikes')) { dmg *= 1.5; used[W].push('spikes'); }
  let reflect = 0;
  if ((l.traps || []).includes('banana')) { dmg *= 0.5; used[L].push('banana'); }
  else if ((l.traps || []).includes('cape')) { reflect = dmg * 0.4; dmg -= reflect; used[L].push('cape'); }
  const out = { winner: W, dmg: { a: 0, b: 0 }, used, ratio, crush: Math.round(crush * 100) / 100 };
  out.dmg[L] = round10(dmg);
  out.dmg[W] = round10(reflect);
  return out;
}

/** After the clash, for this side. me: 'a'|'b'. Applies damage, traps used, monster clash hooks, shreds. */
export function applyClash(run, res, me) {
  const won = res.winner === me, lost = res.winner && !won;
  const dmg = res.dmg[me];
  run.lp -= dmg;
  run.stats.dmgTaken += dmg;
  const them = me === 'a' ? 'b' : 'a';
  run.stats.dmgDealt += res.dmg[them];
  for (const id of res.used[me]) { const t = run.traps.find(x => x.id === id); if (t) run.traps = run.traps.filter(x => x !== t); }
  if (won) { run.stats.clashWins++; run.stats.lossStreak = 0; }
  if (lost) { run.stats.clashLosses++; run.stats.lossStreak++; heartGain(run, 10); }
  heartGain(run, dmg / 20);
  run.monsters.forEach(m => { const d = MON_BY_ID[m.id]; d.clash && d.clash(run, m, won); });
  // the winner's monsters shred one card out of the loser's deck for good
  let shred = null;
  if (lost && run.deck.length > 30) {
    shred = pick(run.rng, run.deck);
    destroyCard(run, shred, 'shredded in the clash');
  }
  return { won, lost, dmg, shred: shred && { uid: shred.uid, rank: shred.rank, suit: shred.suit, enh: shred.enh } };
}

// ---------------------------------------------------------------- money
export function income(run, clash) {
  const p = passives(run);
  const lines = [];
  lines.push(['Round pay', 5]);
  const interest = Math.min(Math.floor(Math.max(0, run.gold) / 5), 5 + p.interestCap);
  if (interest) lines.push([`Interest ($1 per $5, max ${5 + p.interestCap})`, interest]);
  const eco = Math.floor(run.eco);
  if (eco) lines.push(['Gremlin eco', eco]);
  run.monsters.forEach((m, i) => {
    const d = MON_BY_ID[m.id];
    const v = d.roundEnd ? d.roundEnd(run, m) : 0;
    if (v) lines.push([d.name, v]);
  });
  for (const m of [...run.monsters]) if (m.st.dead) removeMonster(run, m.uid, m.st.dead);
  if (clash && clash.won) lines.push(['Clash won', 1]);
  else if (clash && clash.lost) lines.push([`Comeback bonus${run.stats.lossStreak > 1 ? ' x' + run.stats.lossStreak : ''}`, 2 + Math.min(3, run.stats.lossStreak - 1)]);
  if (run.boss) lines.push(['Boss round bounty', 3]);
  const total = lines.reduce((a, l) => a + l[1], 0);
  run.gold += total;
  return { lines, total };
}

// ---------------------------------------------------------------- the shop
const RAR_W = { 1: 70, 2: 25, 3: 5 };
function rollEdition(run, boost = 1) {
  const r = rand(run.rng);
  if (r < 0.01 * boost) return 'shiny';
  if (r < 0.035 * boost) return 'holo';
  if (r < 0.075 * boost) return 'foil';
  return null;
}
export function monsterPrice(id, ed) { return MON_BY_ID[id].cost + (ed ? EDITIONS[ed].cost : 0); }
function rollMonsterOffer(run, exclude) {
  const owned = new Set(run.monsters.map(m => m.id));
  let pool = MONSTERS.filter(m => run.pool.includes(m.id) && m.rar <= 3 && !owned.has(m.id) && !exclude.has(m.id));
  if (!pool.length) pool = MONSTERS.filter(m => m.rar === 1);
  const rar = weighted(run.rng, [1, 2, 3].filter(x => pool.some(m => m.rar === x)), x => RAR_W[x]);
  const m = pick(run.rng, pool.filter(x => x.rar === rar));
  const ed = rollEdition(run);
  exclude.add(m.id);
  return { kind: 'mon', id: m.id, ed, price: monsterPrice(m.id, ed) };
}
function itemPool(run, kinds) {
  return ITEMS.filter(i => kinds.includes(i.kind) && (!i.secret || run.played[i.hand]));
}
function rollItemOffer(run) {
  const r = rand(run.rng);
  const kind = r < 0.4 ? 'tome' : r < 0.82 ? 'spell' : 'trap';
  const it = pick(run.rng, itemPool(run, [kind]));
  return { kind: 'item', id: it.id, price: it.price };
}
export const PACKS = {
  monpack: { name: 'Monster Pack', price: 5, n: 3, desc: 'Pick 1 of 3 monsters. Might hold one you\'ve never seen…' },
  spellpack: { name: 'Spell Pack', price: 4, n: 4, desc: 'Pick 1 of 4 spells, tomes and traps' },
};
export function rollShop(run) {
  const ex = new Set();
  run.shop = {
    offers: [rollMonsterOffer(run, ex), rollMonsterOffer(run, ex), rollItemOffer(run), rollItemOffer(run)],
    packs: [{ kind: 'pack', id: chance(run.rng, 0.55) ? 'monpack' : 'spellpack' }, { kind: 'pack', id: chance(run.rng, 0.5) ? 'monpack' : 'spellpack' }],
    rerolls: 0,
  };
  for (const p of run.shop.packs) p.price = PACKS[p.id].price;
  return run.shop;
}
export const rerollCost = run => RULES.rerollCost + run.shop.rerolls;
export function reroll(run) {
  if (run.freeRerolls > 0) run.freeRerolls--;
  else { const c = rerollCost(run); if (run.gold < c) return { err: 'Not enough gold' }; run.gold -= c; run.shop.rerolls++; }
  run.stats.rerolls++;
  const ex = new Set();
  run.shop.offers = [rollMonsterOffer(run, ex), rollMonsterOffer(run, ex), rollItemOffer(run), rollItemOffer(run)];
  return { ok: true };
}
export function buy(run, idx, isPack) {
  const list = isPack ? run.shop.packs : run.shop.offers;
  const o = list[idx];
  if (!o || o.sold) return { err: 'Sold out' };
  if (run.gold < o.price) return { err: 'Not enough gold' };
  if (o.kind === 'mon' && run.monsters.length >= run.monSlots) return { err: 'Your Monster Zones are full. Sell one first.' };
  if (o.kind === 'item' && run.items.length >= run.itemSlots) return { err: 'Your spell slots are full' };
  run.gold -= o.price;
  o.sold = true;
  run.stats.bought++;
  if (o.kind === 'mon') return { mon: addMonster(run, o.id, o.ed) };
  if (o.kind === 'item') { const it = { uid: run.uid++, id: o.id }; run.items.push(it); return { item: it }; }
  return { pack: openPack(run, o.id) };
}
/** A pack's choices. Monster packs ignore your unlocks now and then: that's how new monsters are found. */
export function openPack(run, id, opts = {}) {
  const P = PACKS[id];
  const choices = [];
  if (id === 'monpack') {
    const owned = new Set(run.monsters.map(m => m.id));
    const ex = new Set();
    for (let i = 0; i < P.n; i++) {
      let m;
      const r = rand(run.rng);
      if (r < 0.03) m = pick(run.rng, MONSTERS.filter(x => x.rar === 4 && !ex.has(x.id)));
      else if (r < 0.13) {
        const locked = MONSTERS.filter(x => x.rar <= 3 && !run.pool.includes(x.id) && !ex.has(x.id));
        if (locked.length) m = pick(run.rng, locked);
      }
      if (!m) {
        const pool = MONSTERS.filter(x => run.pool.includes(x.id) && x.rar <= 3 && !owned.has(x.id) && !ex.has(x.id));
        const rar = weighted(run.rng, [1, 2, 3].filter(x => pool.some(q => q.rar === x)), x => ({ 1: 55, 2: 35, 3: 10 }[x]));
        m = pick(run.rng, pool.filter(x => x.rar === rar));
      }
      ex.add(m.id);
      choices.push({ kind: 'mon', id: m.id, ed: rollEdition(run, 2.5), isNew: !run.pool.includes(m.id) });
    }
  } else {
    const ex = new Set();
    for (let i = 0; i < P.n; i++) {
      const r = rand(run.rng);
      const kind = r < 0.35 ? 'tome' : r < 0.8 ? 'spell' : 'trap';
      let it = pick(run.rng, itemPool(run, [kind]).filter(x => !ex.has(x.id)));
      ex.add(it.id);
      choices.push({ kind: 'item', id: it.id });
    }
  }
  run.pack = { id, choices };
  return run.pack;
}
export function takeFromPack(run, idx) {
  const c = run.pack && run.pack.choices[idx];
  if (!c) return { err: 'Nothing there' };
  if (c.kind === 'mon') {
    if (run.monsters.length >= run.monSlots) return { err: 'Your Monster Zones are full. Sell one first.' };
    run.pack = null;
    const m = addMonster(run, c.id, c.ed);
    if (!run.pool.includes(c.id)) run.pool.push(c.id);
    return { mon: m, isNew: c.isNew };
  }
  const it = ITEM_BY_ID[c.id];
  if (it.kind === 'tome') { run.pack = null; return { used: it.use(run), tome: it.id }; }   // tomes from packs are used right away
  if (run.items.length >= run.itemSlots) return { err: 'Your spell slots are full' };
  run.pack = null;
  const item = { uid: run.uid++, id: c.id };
  run.items.push(item);
  return { item };
}
export function sell(run, uid) {
  const m = run.monsters.find(x => x.uid === uid);
  if (!m) return { err: 'Gone already' };
  const v = sellValue(m);
  run.gold += v;
  removeMonster(run, uid);
  return { gold: v };
}
export function sellItem(run, uid) {
  const it = run.items.find(x => x.uid === uid);
  if (!it) return { err: 'Gone already' };
  run.items = run.items.filter(x => x !== it);
  const v = Math.max(1, Math.floor(ITEM_BY_ID[it.id].price / 2));
  run.gold += v;
  return { gold: v };
}
export function moveMonster(run, uid, dir) {
  const i = run.monsters.findIndex(m => m.uid === uid), j = i + dir;
  if (i < 0 || j < 0 || j >= run.monsters.length) return;
  [run.monsters[i], run.monsters[j]] = [run.monsters[j], run.monsters[i]];
}

/** Use a spell or tome on the selected cards, or set a trap. */
export function useItem(run, uid, selUids = []) {
  const it = run.items.find(x => x.uid === uid);
  if (!it) return { err: 'Gone already' };
  const d = ITEM_BY_ID[it.id];
  if (d.kind === 'trap') {
    if (run.traps.length >= run.trapSlots) return { err: 'Both trap slots are set already' };
    run.items = run.items.filter(x => x !== it);
    run.traps.push({ uid: it.uid, id: it.id });
    return { msg: 'Trap set! Your rival can see a face-down card…', trap: true };
  }
  const sel = run.hand.filter(c => selUids.includes(c.uid));
  // keep left-to-right hand order for the Copy Machine
  const [lo, hi] = d.sel;
  if (sel.length < lo || sel.length > hi) return { err: hi === 0 ? 'Deselect your cards first' : lo === hi ? `Select exactly ${lo} card${lo > 1 ? 's' : ''}` : `Select ${lo} to ${hi} cards` };
  if (d.can && !d.can(run)) return { err: 'Can\'t use that right now' };
  run.items = run.items.filter(x => x !== it);
  const msg = d.use(run, sel, { destroyCard, addMonster });
  return { msg, cards: sel.map(c => c.uid) };
}

/** A starter monster pick: 3 free commons. */
export function starterChoices(run) {
  const pool = MONSTERS.filter(m => m.rar === 1 && run.pool.includes(m.id));
  return shuffle(run.rng, pool.slice()).slice(0, 3).map(m => m.id);
}

/** A rough hand-picker for the dev bot and tests: tries a few candidate hands and keeps the best total. */
export function botChooseHand(run) {
  const best = bestFive(run.hand, { four: passives(run).four });
  return best.map(c => c.uid);
}

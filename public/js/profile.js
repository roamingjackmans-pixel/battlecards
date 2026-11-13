// Your duelist: name, friend code, level, unlocks, daily quests, streak, collection, friends and rivalries.
// Saved in this browser. Add ?as=<anything> to the address to play as a second duelist in another tab.
import { MONSTERS, MON_BY_ID, STARTER_POOL } from './monsters.js';
import { BACKS } from './art.js';
import { randomId, makeRng, pick, shuffle, hashStr, rand } from './util.js';

const NS = (() => { try { const a = new URLSearchParams(location.search).get('as'); return a ? 'bc_' + a.replace(/\W/g, '').slice(0, 12) + '_' : 'bc_'; } catch { return 'bc_'; } })();
const ls = (() => { try { return localStorage; } catch { return null; } })();

const WORDS = ['GOOBER', 'NUGGET', 'GREMLIN', 'PICKLE', 'WOMBAT', 'NOODLE', 'GOBLIN', 'MUFFIN', 'TURNIP', 'BISCUIT', 'WAFFLE', 'GIZMO', 'PRETZEL', 'BADGER', 'MOCHI', 'TOFU', 'JELLY', 'COBRA', 'YETI', 'KRAKEN', 'BANJO', 'TACO', 'PUFFIN', 'GECKO', 'SQUID', 'CHOMP', 'BLOB', 'SNOOT', 'BEANS', 'GOOSE'];
export const TITLES = {
  rookie: 'Rookie Duelist', gremlin: 'Gremlin Wrangler', chef: 'Card Chef', shredder: 'Professional Shredder', heart: 'Believer of the Heart',
  goblin: 'Goblin Diplomat', menace: 'Certified Menace', flush: 'Flush Royalty', chaos: 'Agent of Chaos', legend: 'Living Legend', rat: 'Rat Enthusiast',
  nap: 'Napper Supreme', boss: 'Boss Bonker', cheese: 'The Big Cheese', main: 'Main Character',
};
export const EMOTES = {
  gg: { text: 'GG!', e: '🤝' }, nice: { text: 'Nice hand!', e: '👏' }, hungry: { text: 'My monsters are HUNGRY', e: '😋' },
  oops: { text: 'Oops.', e: '🙃' }, heart: { text: 'I believe in the heart of the cards', e: '💖' }, lol: { text: 'LOL', e: '😂' },
  sweat: { text: 'Sweating rn', e: '😰' }, chomp: { text: 'CHOMP CHOMP', e: '🦷' }, cry: { text: 'pls no', e: '😭' },
  cool: { text: 'Calculated.', e: '😎' }, rat: { text: 'Rat incoming', e: '🐀' }, bow: { text: 'I bow to you', e: '🙇' },
};
const START_EMOTES = ['gg', 'nice', 'hungry', 'oops', 'heart', 'lol'];

/** XP needed to go from level L to L+1. Small early so the first few levels pop quickly. */
export const xpNeed = L => 80 + 30 * (L - 1) + Math.floor(L * L * 1.5);

/** The reward for reaching each level, mostly new monsters for your shop. */
export function levelReward(L, data) {
  const locked = MONSTERS.filter(m => m.rar <= 3 && !data.unlocked.includes(m.id)).sort((a, b) => a.rar - b.rar || a.cost - b.cost);
  if (L % 5 === 0) {
    const backs = Object.keys(BACKS).filter(b => !data.backs.includes(b));
    if (backs.length) return { kind: 'back', id: backs[0] };
  }
  if (L % 4 === 3) {
    const t = Object.keys(TITLES).filter(t => !data.titles.includes(t));
    if (t.length) return { kind: 'title', id: t[0] };
  }
  if (L % 4 === 2) {
    const e = Object.keys(EMOTES).filter(e => !data.emotes.includes(e));
    if (e.length) return { kind: 'emote', id: e[0] };
  }
  if (locked.length) return { kind: 'mon', id: locked[0].id };
  return { kind: 'pack', id: 'gold' };
}

const QUESTS = [
  { id: 'win', text: 'Win a duel', goal: 1 },
  { id: 'duel2', text: 'Finish 2 duels', goal: 2 },
  { id: 'flush', text: 'Play 3 Flushes', goal: 3 },
  { id: 'fullhouse', text: 'Play a Full House', goal: 1 },
  { id: 'straight', text: 'Play 3 Straights', goal: 3 },
  { id: 'gremlins', text: 'Send 8 gremlins', goal: 8 },
  { id: 'bighand', text: 'Score 2,000+ in one hand', goal: 1 },
  { id: 'hugehand', text: 'Score 10,000+ in one hand', goal: 1 },
  { id: 'clashes', text: 'Win 4 clashes', goal: 4 },
  { id: 'heart', text: 'Believe in the Heart of the Cards', goal: 1 },
  { id: 'buy', text: 'Buy 6 things in the shop', goal: 6 },
  { id: 'reroll', text: 'Reroll the shop 3 times', goal: 3 },
  { id: 'shred', text: 'Shred 3 of your own cards', goal: 3 },
  { id: 'friend', text: 'Duel a friend', goal: 1 },
  { id: 'trap', text: 'Set 2 traps', goal: 2 },
  { id: 'damage', text: 'Deal 1,500 damage in one clash', goal: 1 },
  { id: 'block', text: 'Block or bounce a gremlin', goal: 1 },
];
export const QUEST_BY_ID = Object.fromEntries(QUESTS.map(q => [q.id, q]));
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(new Date(y, m - 1, d).getTime() / 86400000); };

export class Profile {
  constructor() {
    let d = null;
    try { d = JSON.parse(ls.getItem(NS + 'profile')); } catch { }
    if (!d || !d.code) d = this.fresh();
    this.data = Object.assign(this.fresh(), d);
    this.dailyCheck();
    this.save();
  }
  fresh() {
    return {
      v: 1, name: '', avatar: pick(makeRng(Date.now()), STARTER_POOL), code: `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${String(1000 + Math.floor(Math.random() * 9000))}`,
      created: Date.now(), xp: 0, level: 1, unlocked: STARTER_POOL.slice(), seen: {}, found: {},
      backs: ['classic'], back: 'classic', titles: ['rookie'], title: 'rookie', emotes: START_EMOTES.slice(),
      packs: 1, packPity: 0, quests: null, streak: { day: null, n: 0, best: 0 },
      stats: { duels: 0, wins: 0, losses: 0, winStreak: 0, bestWinStreak: 0, bestHand: 0, bestHandType: null, clashWins: 0, sent: 0, dmg: 0 },
      friends: {}, incoming: {}, outgoing: {}, recent: [], tutorialSeen: false,
    };
  }
  save() { try { ls.setItem(NS + 'profile', JSON.stringify(this.data)); } catch { } }

  addFriend(code, name, av) {
    const f = this.data.friends[code] || { w: 0, l: 0, added: Date.now() };
    Object.assign(f, { name: name || f.name || code, av: av || f.av });
    this.data.friends[code] = f;
    delete this.data.outgoing[code];
    this.save();
  }
  removeFriend(code) { delete this.data.friends[code]; this.save(); }

  /** New day: fresh quests, keep or break the streak. Returns true if it's a new day. */
  dailyCheck() {
    const d = this.data, t = today();
    if (!d.quests || d.quests.day !== t) {
      const r = makeRng(hashStr(d.code + t));
      const qs = shuffle(r, QUESTS.slice()).slice(0, 3);
      d.quests = { day: t, list: qs.map(q => ({ id: q.id, prog: 0, done: false })), chest: false };
      return true;
    }
    return false;
  }
  /** Played today: keep the daily streak going. */
  markPlayed() {
    const d = this.data, t = today();
    if (d.streak.day === t) return null;
    const gap = d.streak.day ? dayNum(t) - dayNum(d.streak.day) : 99;
    d.streak.n = gap === 1 ? d.streak.n + 1 : 1;
    d.streak.day = t;
    d.streak.best = Math.max(d.streak.best, d.streak.n);
    this.save();
    return d.streak.n;
  }
  /** Bump quest progress. Returns quests that just got done. */
  quest(id, amount = 1, absolute = false) {
    this.dailyCheck();
    const done = [];
    for (const q of this.data.quests.list) {
      if (q.id !== id || q.done) continue;
      const g = QUEST_BY_ID[q.id].goal;
      q.prog = absolute ? Math.max(q.prog, amount) : q.prog + amount;
      if (q.prog >= g) { q.prog = g; q.done = true; done.push(q); }
    }
    this.save();
    return done;
  }
  chestReady() { const q = this.data.quests; return q.list.every(x => x.done) && !q.chest; }
  claimChest() { if (!this.chestReady()) return false; this.data.quests.chest = true; this.data.packs += 2; this.save(); return true; }

  /** Add XP; returns the levels gained with their rewards (already applied). */
  addXp(n) {
    const d = this.data, ups = [];
    d.xp += n;
    while (d.xp >= xpNeed(d.level)) {
      d.xp -= xpNeed(d.level);
      d.level++;
      const rw = levelReward(d.level, d);
      this.grant(rw);
      ups.push({ level: d.level, reward: rw });
    }
    this.save();
    return ups;
  }
  grant(rw) {
    const d = this.data;
    if (rw.kind === 'mon' && !d.unlocked.includes(rw.id)) d.unlocked.push(rw.id);
    if (rw.kind === 'back' && !d.backs.includes(rw.id)) d.backs.push(rw.id);
    if (rw.kind === 'title' && !d.titles.includes(rw.id)) d.titles.push(rw.id);
    if (rw.kind === 'emote' && !d.emotes.includes(rw.id)) d.emotes.push(rw.id);
    if (rw.kind === 'pack') d.packs++;
    if (rw.kind === 'xp') d.xp += rw.n;
  }

  /** Open a loot pack: 3 rewards, rarer ones less often, with a pity timer for new monsters. */
  openLoot() {
    const d = this.data;
    if (d.packs <= 0) return null;
    d.packs--;
    const r = makeRng(Date.now() ^ hashStr(d.code));
    const out = [];
    const lockedOf = rar => MONSTERS.filter(m => m.rar === rar && !d.unlocked.includes(m.id));
    for (let i = 0; i < 3; i++) {
      const x = rand(r);
      let rw = null;
      const pity = i === 2 && d.packPity >= 2;
      if (x < 0.025 || (pity && lockedOf(4).length && rand(r) < 0.15)) { const l = lockedOf(4); if (l.length) rw = { kind: 'mon', id: pick(r, l).id, rar: 4 }; }
      if (!rw && (x < 0.12 || pity)) { const l = lockedOf(3); if (l.length) rw = { kind: 'mon', id: pick(r, l).id, rar: 3 }; }
      if (!rw && (x < 0.3 || pity)) { const l = [...lockedOf(2), ...lockedOf(1)]; if (l.length) rw = { kind: 'mon', id: pick(r, l).id, rar: MON_BY_ID[pick(r, l).id].rar }; }
      if (!rw && x < 0.42) { const b = Object.keys(BACKS).filter(b => !d.backs.includes(b)); if (b.length) rw = { kind: 'back', id: pick(r, b), rar: 3 }; }
      if (!rw && x < 0.55) { const e = Object.keys(EMOTES).filter(e => !d.emotes.includes(e)); if (e.length) rw = { kind: 'emote', id: pick(r, e), rar: 2 }; }
      if (!rw && x < 0.65) { const t = Object.keys(TITLES).filter(t => !d.titles.includes(t)); if (t.length) rw = { kind: 'title', id: pick(r, t), rar: 2 }; }
      if (!rw) rw = { kind: 'xp', n: [25, 40, 60, 100][Math.floor(rand(r) * 4)], rar: 1 };
      if (rw.kind === 'mon' && out.some(o => o.kind === 'mon' && o.id === rw.id)) rw = { kind: 'xp', n: 50, rar: 1 };
      out.push(rw);
    }
    d.packPity = out.some(o => o.kind === 'mon') ? 0 : d.packPity + 1;
    // xp from packs goes through addXp so it can level you up
    const xp = out.filter(o => o.kind === 'xp').reduce((a, o) => a + o.n, 0);
    for (const o of out) if (o.kind !== 'xp') this.grant(o);
    this.save();
    const ups = xp ? this.addXp(xp) : [];
    return { out, ups };
  }

  /** After a duel: XP, stats, rivalry record. Returns a summary for the results screen. */
  finishDuel({ won, rival, friendly, run, rounds }) {
    const d = this.data, s = d.stats;
    s.duels++;
    if (won) { s.wins++; s.winStreak++; s.bestWinStreak = Math.max(s.bestWinStreak, s.winStreak); } else { s.losses++; s.winStreak = 0; }
    if (run.stats.best > s.bestHand) { s.bestHand = run.stats.best; s.bestHandType = run.stats.bestType; }
    s.clashWins += run.stats.clashWins; s.sent += run.stats.sent; s.dmg += run.stats.dmgDealt;
    if (rival && rival.code && d.friends[rival.code]) { const f = d.friends[rival.code]; if (won) f.w++; else f.l++; }
    if (rival) { d.recent = [{ name: rival.name, code: rival.code, av: rival.av, won, at: Date.now() }, ...d.recent].slice(0, 8); }
    for (const m of run.monsters) d.seen[m.id] = (d.seen[m.id] || 0) + 1;
    const streak = this.markPlayed();
    const xpLines = [[won ? 'Victory!' : 'Good effort', won ? 120 : 70], ['Clashes won', 15 * run.stats.clashWins], ['Gremlins sent', 2 * Math.min(20, run.stats.sent)]];
    if (run.stats.best >= 10000) xpLines.push(['Absurd hand bonus', 25]);
    if (s.winStreak >= 2 && won) xpLines.push([`Win streak x${s.winStreak}`, 10 * Math.min(5, s.winStreak)]);
    if (d.streak.n >= 2) xpLines.push([`Daily streak 🔥${d.streak.n}`, 5 * Math.min(10, d.streak.n)]);
    if (friendly) xpLines.push(['Dueled a friend', 15]);
    const total = xpLines.reduce((a, l) => a + l[1], 0);
    const before = { xp: d.xp, level: d.level };
    d.packs += 1;   // every duel gives a loot pack, win or lose
    const ups = this.addXp(total);
    this.save();
    return { xpLines, total, before, ups, streak };
  }
}

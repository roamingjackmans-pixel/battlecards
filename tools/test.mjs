// Rules tests: node tools/test.mjs
import assert from 'node:assert/strict';
import { evalHand, bestFive, handBase, HANDS } from '../public/js/cards.js';
import * as E from '../public/js/engine.js';
import { MONSTERS } from '../public/js/monsters.js';
import { ITEMS, GREMLINS, BOSSES } from '../public/js/items.js';
import { makeRng, fmt } from '../public/js/util.js';

let n = 0, failed = 0;
function test(name, fn) {
  try { fn(); n++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.stack.split('\n').slice(0, 3).join('\n  ')}`); }
}
const C = (s) => { // "AS KH 10D" -> cards
  return s.split(' ').map((t, i) => ({ uid: 1000 + i, rank: { A: 14, K: 13, Q: 12, J: 11 }[t.slice(0, -1)] || +t.slice(0, -1), suit: t.slice(-1), enh: null, bonus: 0 }));
};
const type = s => evalHand(C(s)).type;

test('hand types', () => {
  assert.equal(type('AS'), 'highcard');
  assert.equal(type('AS AH'), 'pair');
  assert.equal(type('AS AH 3D 3C'), 'twopair');
  assert.equal(type('AS AH AD'), 'threeofakind');
  assert.equal(type('2S 3H 4D 5C 6S'), 'straight');
  assert.equal(type('AS 2H 3D 4C 5S'), 'straight');
  assert.equal(type('10S JH QD KC AS'), 'straight');
  assert.equal(type('JS QH KD AC 2S'), 'highcard');
  assert.equal(type('2S 7S 9S JS KS'), 'flush');
  assert.equal(type('2S 2H 2D 9C 9S'), 'fullhouse');
  assert.equal(type('9S 9H 9D 9C 2S'), 'fourofakind');
  assert.equal(type('5H 6H 7H 8H 9H'), 'straightflush');
  assert.equal(type('9S 9H 9D 9C 9S'), 'fiveofakind');
  assert.equal(type('9S 9S 9S 9S 9S'), 'flushfive');
  assert.equal(type('9S 9S 9S 4S 4S'), 'flushhouse');
});
test('scoring cards', () => {
  assert.equal(evalHand(C('AS AH 3D')).scoring.length, 2);
  assert.equal(evalHand(C('KS 3H 5D')).scoring[0].rank, 13);
  assert.equal(evalHand(C('9S 9H 9D 9C 2S')).scoring.length, 4);
});
test('four-card flushes and straights with Shortcut Weasel', () => {
  assert.equal(evalHand(C('2S 7S 9S JS'), { four: true }).type, 'flush');
  assert.equal(evalHand(C('5S 6H 7D 8C'), { four: true }).type, 'straight');
  assert.equal(evalHand(C('2S 7S 9S JS')).type, 'highcard');
});
test('wild cards make flushes', () => {
  const cs = C('2S 7S 9S JS KH'); cs[4].enh = 'wild';
  assert.equal(evalHand(cs).type, 'flush');
});
test('bestFive finds the best hand', () => {
  assert.equal(evalHand(bestFive(C('2S 3S 4S 5S 6S 9H 9D 9C KH'))).type, 'straightflush');
  assert.equal(evalHand(bestFive(C('2S 2H 2D 7C 7S QH 4D 9C'))).type, 'fullhouse');
  assert.equal(evalHand(bestFive(C('2S 5H 9D JC KS 3H 8D'))).type, 'highcard');
});

test('a plain pair scores (10 + chips) x 2', () => {
  const run = E.newRun(42);
  E.startRound(run, 1, null);
  run.hand = C('KS KH 3D 4C 7S 9H 2D 5C');
  const r = E.playHand(run, [1000, 1001]);
  assert.equal(r.type, 'pair');
  assert.equal(r.total, (10 + 10 + 10) * 2);
  assert.equal(run.hands, 3);
  assert.equal(run.atk, 60);
});
test('monsters add up left to right, xmult after +mult', () => {
  const run = E.newRun(42);
  E.addMonster(run, 'chomp');      // +4 mult
  E.addMonster(run, 'bigcheese');  // x3
  E.startRound(run, 1, null);
  run.hand = C('KS KH 3D 4C 7S 9H 2D 5C');
  const r = E.playHand(run, [1000, 1001]);
  assert.equal(r.total, 30 * ((2 + 4) * 3));
});
test('copycat copies its right-hand neighbour', () => {
  const run = E.newRun(42);
  E.addMonster(run, 'copycat'); E.addMonster(run, 'bigcheese');
  E.startRound(run, 1, null);
  run.hand = C('KS KH 3D 4C 7S 9H 2D 5C');
  assert.equal(E.playHand(run, [1000, 1001]).total, 30 * 2 * 9);
});
test('passives: clown car, napper, ernie', () => {
  const run = E.newRun(1);
  E.addMonster(run, 'clowncar'); E.addMonster(run, 'napper'); E.addMonster(run, 'ernie');
  E.startRound(run, 1, null);
  assert.equal(run.hand.length, 9); assert.equal(run.discards, 4); assert.equal(run.hands, 5);
});
test('gremlins', () => {
  const run = E.newRun(7); E.startRound(run, 1, null); run.gold = 10;
  assert.equal(E.applyGremlin(run, 'raccoon').stolen, 3); assert.equal(run.gold, 7);
  const deck = run.deck.length;
  E.applyGremlin(run, 'chomper'); assert.equal(run.deck.length, deck - 1); assert.equal(run.hand.length, 8);
  E.applyGremlin(run, 'bat'); assert.equal(run.hand.filter(c => c.down).length, 3);
  E.applyGremlin(run, 'hog'); assert.equal(run.hands, 3);
  E.addMonster(run, 'bouncer');
  assert.equal(E.applyGremlin(run, 'rat').res, 'blocked');
  run.traps.push({ uid: 99, id: 'boomerang' });
  assert.equal(E.applyGremlin(run, 'rat').res, 'reflect');
  assert.equal(E.applyGremlin(run, 'snail').res, 'hit');
  const glued = run.hand.filter(c => c.sticky).map(c => c.uid);
  assert.ok(E.discard(run, glued).err);
});
test('clash damage', () => {
  const r = E.clashResult(1, null, { atk: 1000, mons: 2, traps: [] }, { atk: 500, mons: 0, traps: [] });
  assert.equal(r.winner, 'a'); assert.equal(r.dmg.a, 0); assert.ok(r.dmg.b > 450);
  const t = E.clashResult(1, null, { atk: 5, traps: [] }, { atk: 5, traps: [] });
  assert.equal(t.winner, null); assert.equal(t.dmg.a, t.dmg.b);
  const banana = E.clashResult(2, null, { atk: 900, traps: [] }, { atk: 300, traps: ['banana'] });
  const plain = E.clashResult(2, null, { atk: 900, traps: [] }, { atk: 300, traps: [] });
  assert.equal(banana.dmg.b, Math.round(plain.dmg.b / 2 / 10) * 10);
  assert.deepEqual(banana.used.b, ['banana']);
  const cape = E.clashResult(2, null, { atk: 900, traps: [] }, { atk: 300, traps: ['cape'] });
  assert.ok(cape.dmg.a > 0 && cape.dmg.b < plain.dmg.b);
  // a huge score can't do more than 2.5x
  const huge = E.clashResult(1, null, { atk: 1e12, traps: [] }, { atk: 1, traps: [] });
  assert.ok(huge.dmg.b <= E.clashBase(1) * 2.5 + 10);
});
test('heart of the cards pulls the best hand', () => {
  const run = E.newRun(3); E.startRound(run, 1, null);
  run.heart = 100;
  const h = E.heartActivate(run);
  assert.equal(h.best.length, 5);
  assert.equal(run.hand.length, 8);
  assert.equal(new Set([...run.hand, ...run.draw]).size, 52);
  const res = E.playHand(run, h.best);
  assert.ok(['straightflush', 'fourofakind', 'fullhouse', 'flush'].includes(res.type), res.type);
  assert.ok(res.steps.some(s => s.k === 'heart'));
});
test('every monster survives random duels', () => {
  for (const m of MONSTERS) {
    const run = E.newRun(m.id.length * 977);
    E.addMonster(run, m.id); E.addMonster(run, 'copycat'); E.addMonster(run, m.id === 'copycat' ? 'chomp' : m.id);
    for (let r = 1; r <= 4; r++) {
      E.startRound(run, r, r === 3 ? E.pickBoss(run.rng) : null);
      while (run.hands > 0) {
        if (run.discards > 0) E.discard(run, run.hand.slice(0, 2).map(c => c.uid).filter(u => !run.hand.find(c => c.uid === u).sticky));
        const res = E.playHand(run, E.botChooseHand(run), { oppLp: 3000 });
        assert.ok(!res.err, res.err);
        assert.ok(Number.isFinite(res.total) && res.total >= 0, `${m.id}: ${res.total}`);
      }
      E.income(run, { won: r % 2 === 0, lost: r % 2 === 1 });
      E.rollShop(run); E.reroll(run);
    }
  }
});
test('every item can be used', () => {
  for (const it of ITEMS) {
    const run = E.newRun(11); E.startRound(run, 1, null); E.addMonster(run, 'chomp');
    run.items.push({ uid: 500, id: it.id });
    const sel = run.hand.slice(0, it.sel[1]).map(c => c.uid);
    const res = E.useItem(run, 500, sel);
    assert.ok(!res.err, `${it.id}: ${res.err}`);
  }
});
test('shop and packs', () => {
  const run = E.newRun(5); run.gold = 100;
  E.rollShop(run);
  assert.equal(run.shop.offers.length, 4);
  const b = E.buy(run, 0); assert.ok(b.mon);
  const p = E.buy(run, 0, true); assert.ok(p.pack.choices.length >= 3);
  const t = E.takeFromPack(run, 0); assert.ok(!t.err, t.err);
  assert.ok(E.reroll(run).ok);
  for (let i = 0; i < 200; i++) { const pk = E.openPack(run, 'monpack'); assert.equal(new Set(pk.choices.map(c => c.id)).size, 3); }
});
test('whole duels end, and in a sensible number of rounds', () => {
  const lens = [];
  for (let s = 1; s <= 40; s++) {
    const A = E.newRun(s * 3), B = E.newRun(s * 3 + 1);
    for (const run of [A, B]) { run.gold = 4; E.addMonster(run, E.starterChoices(run)[0]); }
    let r = 0;
    while (A.lp > 0 && B.lp > 0 && r < 20) {
      r++;
      const boss = r % 3 === 0 ? E.pickBoss(makeRng(s + r)) : null;
      for (const run of [A, B]) {
        E.startRound(run, r, boss);
        while (run.hands > 0) E.playHand(run, E.botChooseHand(run), { oppLp: (run === A ? B : A).lp });
      }
      const res = E.clashResult(r, boss, { atk: A.atk, mons: A.monsters.length, traps: [] }, { atk: B.atk, mons: B.monsters.length, traps: [] });
      const ca = E.applyClash(A, res, 'a'), cb = E.applyClash(B, res, 'b');
      for (const [run, c] of [[A, ca], [B, cb]]) {
        E.income(run, c); E.rollShop(run);
        for (let i = 0; i < 4; i++) E.buy(run, i);
      }
    }
    lens.push(r);
  }
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  console.log(`  bot duels last ${Math.min(...lens)}-${Math.max(...lens)} rounds (avg ${avg.toFixed(1)})`);
  assert.ok(avg >= 4 && avg <= 11, 'average duel length ' + avg);
});
test('fmt', () => { assert.equal(fmt(1234567), '1,234,567'); assert.match(fmt(1e13), /e13/); });

console.log(failed ? `${failed} failed, ${n} passed` : `all ${n} tests passed`);
process.exit(failed ? 1 : 0);

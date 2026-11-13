// Spells (use on your own cards), Tomes (level up a hand), Traps (set face down, spring on your rival),
// Gremlins (sent at your rival mid-round, BTD style) and Boss rounds. Pure data and rules.
import { HANDS, HAND_BY_ID, SUITS } from './cards.js';
import { pick, chance, rand } from './util.js';
import { MONSTERS } from './monsters.js';

const enhSpell = (id, name, enh, max, desc, art) => ({
  id, name, kind: 'spell', price: 3, sel: [1, max], art, desc,
  use: (run, cards) => { for (const c of cards) c.enh = enh; return `${cards.length} card${cards.length > 1 ? 's' : ''} → ${ENH[enh].name}`; },
});
const suitSpell = (id, name, suit, art) => ({
  id, name, kind: 'spell', price: 3, sel: [1, 3], art, desc: `Turn up to 3 selected cards into ${SUITS[suit].sym} ${SUITS[suit].name}`,
  use: (run, cards) => { for (const c of cards) c.suit = suit; return `Now ${SUITS[suit].sym}!`; },
});

export const ENH = {
  spicy: { name: 'Spicy', desc: '<b class=m>+4 Mult</b> when scored', badge: '🌶️' },
  swole: { name: 'Swole', desc: '<b class=c>+30 Chips</b> when scored', badge: '💪' },
  gilded: { name: 'Gilded', desc: '<b class=g>+$2</b> when scored', badge: '🪙' },
  glass: { name: 'Glass', desc: '<b class=x>X2 Mult</b> when scored, 1 in 4 chance to shatter', badge: '🔮' },
  lucky: { name: 'Lucky', desc: '1 in 5: <b class=m>+20 Mult</b>. 1 in 15: <b class=g>+$10</b>', badge: '🍀' },
  steel: { name: 'Steel', desc: '<b class=x>X1.5 Mult</b> while held in hand', badge: '🔩' },
  wild: { name: 'Wild', desc: 'Counts as every suit', badge: '🌈' },
};

const TOME_NAMES = {
  highcard: 'Tome of Lonely Cards', pair: 'Tome of Pairs', twopair: 'Tome of Double Dates', threeofakind: 'Tome of Triplets',
  straight: 'Tome of Ladders', flush: 'Tome of Flushing', fullhouse: 'Tome of Crowded Houses', fourofakind: 'Tome of Quadruplets',
  straightflush: 'Tome of Fancy Ladders', fiveofakind: 'Tome of FIVE?!', flushhouse: 'Tome of Fancy Houses', flushfive: 'Tome of Unreasonable Hands',
};

export const ITEMS = [
  ...HANDS.map(H => ({
    id: 'tome_' + H.id, name: TOME_NAMES[H.id], kind: 'tome', hand: H.id, price: 3, sel: [0, 0], secret: H.secret, art: '📖',
    desc: `Level up <b>${H.name}</b>: <b class=c>+${H.lc} Chips</b> and <b class=m>+${H.lm} Mult</b>`,
    use: run => { run.levels[H.id] = (run.levels[H.id] || 1) + 1; return `${H.name} is now level ${run.levels[H.id]}!`; },
  })),
  enhSpell('hotsauce', 'Hot Sauce', 'spicy', 2, 'Make up to 2 selected cards <b>Spicy</b> (<b class=m>+4 Mult</b> when scored)', '🌶️'),
  enhSpell('protein', 'Protein Shake', 'swole', 2, 'Make up to 2 selected cards <b>Swole</b> (<b class=c>+30 Chips</b> when scored)', '💪'),
  enhSpell('glitter', 'Glitter Bomb', 'gilded', 2, 'Make up to 2 selected cards <b>Gilded</b> (<b class=g>+$2</b> when scored)', '✨'),
  enhSpell('glasscannon', 'Glass Cannon', 'glass', 1, 'Make 1 selected card <b>Glass</b> (<b class=x>X2 Mult</b>, might shatter)', '🔮'),
  enhSpell('clover', 'Four-Leaf Sticker', 'lucky', 2, 'Make up to 2 selected cards <b>Lucky</b>', '🍀'),
  enhSpell('iron', 'Iron Polish', 'steel', 1, 'Make 1 selected card <b>Steel</b> (<b class=x>X1.5 Mult</b> while held)', '🔩'),
  enhSpell('rainbow', 'Rainbow Paint', 'wild', 1, 'Make 1 selected card <b>Wild</b> (every suit at once)', '🌈'),
  suitSpell('loveletter', 'Love Letter', 'H', '💌'),
  suitSpell('shovel', 'Garden Shovel', 'S', '🪏'),
  suitSpell('ring', 'Suspicious Ring', 'D', '💍'),
  suitSpell('clubsandwich', 'Club Sandwich', 'C', '🥪'),
  { id: 'shredder', name: 'Shredder', kind: 'spell', price: 3, sel: [1, 2], art: '🗑️', desc: 'Shred up to 2 selected cards out of your deck <b>forever</b>',
    use: (run, cards, E) => { for (const c of cards) E.destroyCard(run, c, 'shredded'); return 'SHRED SHRED SHRED'; } },
  { id: 'copymachine', name: 'Copy Machine', kind: 'spell', price: 3, sel: [2, 2], art: '📠', desc: 'Select 2 cards: the <b>left</b> one becomes a copy of the <b>right</b> one',
    use: (run, cards) => { const [a, b] = cards; Object.assign(a, { rank: b.rank, suit: b.suit, enh: b.enh, bonus: b.bonus || 0 }); return 'Copied! (toner low)'; } },
  { id: 'growth', name: 'Growth Spurt', kind: 'spell', price: 3, sel: [1, 2], art: '📏', desc: 'Raise the rank of up to 2 selected cards by 1 (A wraps to 2)',
    use: (run, cards) => { for (const c of cards) c.rank = c.rank === 14 ? 2 : c.rank + 1; return 'They grow up so fast'; } },
  { id: 'piggysmash', name: 'Piggy Smash', kind: 'spell', price: 3, sel: [0, 0], art: '🔨', desc: 'Double your money (up to <b class=g>+$15</b>)',
    use: run => { const g = Math.min(15, Math.max(0, run.gold)); run.gold += g; return `+$${g}! (RIP piggy)`; } },
  { id: 'summon', name: 'Summoning Circle', kind: 'spell', price: 4, sel: [0, 0], art: '🕯️', desc: 'Summon a random Common monster (needs an empty Monster Zone)',
    can: run => run.monsters.length < run.monSlots,
    use: (run, cards, E) => { const pool = MONSTERS.filter(m => m.rar === 1 && (!run.pool || run.pool.includes(m.id))); const m = pick(run.rng, pool); E.addMonster(run, m.id); return `${m.name} answers the call!`; } },
  { id: 'spray', name: 'Lucky Spray', kind: 'spell', price: 4, sel: [0, 0], art: '🎰', desc: '<b>1 in 3</b> chance to make a random plain monster Foil, Holo or Shiny',
    can: run => run.monsters.some(m => !m.ed),
    use: run => {
      const plain = run.monsters.filter(m => !m.ed);
      if (!chance(run.rng, 1 / 3)) return 'Nope.';
      const m = pick(run.rng, plain);
      const r = rand(run.rng); m.ed = r < 0.5 ? 'foil' : r < 0.85 ? 'holo' : 'shiny';
      return `${m.ed.toUpperCase()}!!`;
    } },
  // traps: set face down, your rival sees how many you have but not which
  { id: 'boomerang', name: 'Boomerang Box', kind: 'trap', price: 4, sel: [0, 0], art: '🪃', trigger: 'gremlin', desc: 'TRAP: the next gremlin sent at you is <b>sent right back</b>' },
  { id: 'zapper', name: 'Bug Zapper', kind: 'trap', price: 3, sel: [0, 0], art: '⚡', trigger: 'gremlin', desc: 'TRAP: zaps the next gremlin sent at you and pays you <b class=g>$3</b>' },
  { id: 'banana', name: 'Banana Peel', kind: 'trap', price: 4, sel: [0, 0], art: '🍌', trigger: 'lose', desc: 'TRAP: the next clash you lose, their monsters slip: <b>half damage</b>' },
  { id: 'spikes', name: 'Spike Pit', kind: 'trap', price: 4, sel: [0, 0], art: '📌', trigger: 'win', desc: 'TRAP: the next clash you win deals <b>+50% damage</b>' },
  { id: 'cape', name: 'Reflecto-Cape', kind: 'trap', price: 4, sel: [0, 0], art: '🦸', trigger: 'lose', desc: 'TRAP: the next clash you lose, <b>40%</b> of the damage bounces back' },
];
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));

/** Gremlins: buy them mid-round to mess with your rival's hand. Each one also raises your income (eco). */
export const GREMLINS = [
  { id: 'rat', name: 'Shredder Rat', cost: 2, eco: 0.5, cd: 6, art: 'blob #9a9aa8 eyes2 fangs ears tail', desc: 'Shreds a random card in their hand',
    hits: ['RRRIP!', 'NOM!', 'SHRED!'] },
  { id: 'bat', name: 'Ink Bat', cost: 3, eco: 0.75, cd: 8, art: 'blob #3b3b5c eyes2 fangs wings', desc: 'Flips 3 of their cards face down',
    hits: ['SPLAT!', 'INKED!'] },
  { id: 'snail', name: 'Glue Snail', cost: 3, eco: 0.75, cd: 8, art: 'snail #c9e86b eyes2 grin', desc: 'Glues 2 of their cards: they can\'t be discarded',
    hits: ['STICKY!', 'GLOOP!'] },
  { id: 'raccoon', name: 'Bandit Raccoon', cost: 4, eco: 1, cd: 12, art: 'blob #8a8fa3 eyes2 mask grin ears', desc: 'Steals one of their discards',
    hits: ['YOINK!', 'MINE NOW!'] },
  { id: 'muncher', name: 'Mult Muncher', cost: 5, eco: 1.25, cd: 12, art: 'tri #ff6b9d eyes3 teeth', desc: 'Their next hand scores <b>half Mult</b>',
    hits: ['MUNCH!', 'CRUNCH!'] },
  { id: 'chomper', name: 'Big Chomper', cost: 7, eco: 2, cd: 18, art: 'box #4fb06b eyes2 fangs spikes feet', desc: 'Eats a card in their hand. <b>Forever.</b>',
    hits: ['CHOMP!!', 'GULP!'] },
  { id: 'hog', name: 'Hand Hog', cost: 8, eco: 2, cd: 25, once: true, art: 'egg #ffa3b5 eyes2 nose ears feet', desc: 'Steals one of their hands (once a round)',
    hits: ['OINK!', 'HOGGED!'] },
];
export const GREM_BY_ID = Object.fromEntries(GREMLINS.map(g => [g.id, g]));
export const ECO_CAP = 12;

/** Boss rounds: every third round both duelists face the same rule, and the clash hits 1.5x harder. */
export const BOSSES = [
  { id: 'suitthief', name: 'The Sock Goblin', art: 'blob #6b4fa0 eyes2 grin sock', desc: s => `${SUITS[s].sym} cards are debuffed (they score nothing)`, suit: true },
  { id: 'fog', name: 'The Fog Wizard', art: 'ghost #b9c3d6 eyes2 wizardhat', desc: () => '1 in 3 cards are drawn face down' },
  { id: 'tiny', name: 'Tiny Hands Tony', art: 'egg #ffb38a eyes2 grin tinyarms', desc: () => '-2 hand size' },
  { id: 'taxman', name: 'The Tax Man', art: 'box #6b8f71 eyes2 angry tophat glasses', desc: () => 'Every hand you play costs <b class=g>$1</b>' },
  { id: 'moon', name: 'The Chompy Moon', art: 'blob #f2e6a0 eyes2 fangs', desc: () => 'After each hand, a random card in your hand is eaten' },
  { id: 'mime', name: 'The Mime', art: 'egg #ffffff eyes2 o beret', desc: () => 'No discards. (He would explain, but…)' },
  { id: 'plainjane', name: 'Plain Jane', art: 'bean #d9c7a8 eyes2 sleepy', desc: () => 'Face cards are debuffed' },
];
export const BOSS_BY_ID = Object.fromEntries(BOSSES.map(b => [b.id, b]));
export const bossDesc = (boss) => { const b = BOSS_BY_ID[boss.id]; return b.desc(boss.suit); };

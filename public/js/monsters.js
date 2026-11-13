// The monsters (this game's jokers). Each one sits in a Monster Zone and changes how your hands score.
// Pure data and rules, no page code. Art is a short spec string drawn by art.js.
//
// Hooks (all optional), called by engine.js:
//   before(ctx, m)           before a hand scores (for monsters that grow)
//   card(ctx, card, m)       each time a scoring card scores  -> effect
//   retrig(ctx, card, m)     extra times a scoring card scores -> number
//   held(ctx, card, m)       each card held in hand            -> effect
//   hand(ctx, m)             once per hand, left to right      -> effect
//   after(ctx, m)            after the hand scored
//   discard(run, cards, m)   cards were discarded
//   roundStart(run, m) / roundEnd(run, m) -> money
//   clash(run, m, won)       the clash at the end of a round
//   destroyed(run, m, card)  one of your cards was destroyed
//   passive {handSize, discards, hands, interestCap, four, heart, gremlinTwice}
// An effect is {chips, mult, xmult, money, msg}.
import { rand, randInt, chance } from './util.js';
import { isFace } from './cards.js';

const suitMon = (suit, sym) => ({
  card: (ctx, c) => (ctx.suitIs(c, suit) ? { mult: 3 } : null),
  desc: () => `Scored ${sym} cards give <b class=m>+3 Mult</b>`,
});
const containsMon = (key, eff, label) => ({
  hand: ctx => (ctx.has[key] ? eff : null),
  desc: () => (eff.mult ? `<b class=m>+${eff.mult} Mult</b>` : eff.xmult ? `<b class=x>X${eff.xmult} Mult</b>` : `<b class=c>+${eff.chips} Chips</b>`) + ` if the hand contains a ${label}`,
});

export const MONSTERS = [
  // ---------------- commons ----------------
  { id: 'chomp', name: "Lil' Chomp", rar: 1, cost: 4, art: 'blob #ff6b6b eyes2 fangs ears feet', quip: 'Bites ankles. Exclusively yours.',
    hand: () => ({ mult: 4 }), desc: () => '<b class=m>+4 Mult</b>' },
  { id: 'gary', name: 'Gary', rar: 1, cost: 4, art: 'box #9aa7b8 eyes2 slot antenna feet tie', quip: 'A paper shredder with legs. Gary has seen things.',
    hand: () => ({ chips: 40 }), desc: () => '<b class=c>+40 Chips</b>' },
  { id: 'pairsley', name: 'Sir Pairsley', rar: 1, cost: 4, art: 'egg #8fd16a eyes2 grin monocle tophat', quip: 'Insists on bringing a plus-one. Always.',
    ...containsMon('pair', { mult: 8 }, 'Pair') },
  { id: 'trio', name: 'Trio Gnome-ious', rar: 1, cost: 5, art: 'tri #c58cff eyes3 grin gnomehat feet', quip: 'Three eyes, three opinions, zero chill.',
    ...containsMon('three', { mult: 12 }, 'Three of a Kind') },
  { id: 'doubletrouble', name: 'Double Trouble', rar: 1, cost: 5, art: 'bean #ffb347 eyes2 teeth horns arms', quip: 'Two heads would be better. Budget cuts.',
    ...containsMon('twopair', { mult: 10 }, 'Two Pair') },
  { id: 'lizard', name: 'Straight-Laced Lizard', rar: 1, cost: 5, art: 'bean #5fd3a0 eyes2 grin tie glasses', quip: 'Has a spreadsheet for his spreadsheets.',
    ...containsMon('straight', { mult: 12 }, 'Straight') },
  { id: 'flusher', name: 'Royal Flusher', rar: 1, cost: 5, art: 'box #8fd9ff eyes2 o crown arms', quip: 'Lives in a toilet. Very regal about it.',
    ...containsMon('flush', { mult: 10 }, 'Flush') },
  { id: 'ruby', name: 'Ruby Ravager', rar: 1, cost: 5, art: 'star #ff9a3c eyes2 fangs spikes', quip: 'Steals diamonds. Gives them names.', ...suitMon('D', '♦') },
  { id: 'blushbat', name: 'Blushbat', rar: 1, cost: 5, art: 'blob #ff7fae eyes2 fangs wings blush', quip: 'Easily flustered. Extremely bitey.', ...suitMon('H', '♥') },
  { id: 'clubby', name: 'Clubby', rar: 1, cost: 5, art: 'egg #4cc27e eyes1 teeth club arms', quip: 'Carries a club. It is a sandwich.', ...suitMon('C', '♣') },
  { id: 'spadegrub', name: 'Spadegrub', rar: 1, cost: 5, art: 'bean #6f6fd8 eyes2 grin antenna feet', quip: 'Digs holes. Fills them with feelings.', ...suitMon('S', '♠') },
  { id: 'steven', name: 'Even Steven', rar: 1, cost: 4, art: 'box #ffd25a eyes2 grin tuft arms', quip: 'Splits every bill exactly in half. Exhausting.',
    card: (ctx, c) => (!ctx.isFaceLike(c) && c.rank <= 10 && c.rank % 2 === 0 ? { mult: 4 } : null),
    desc: () => 'Scored 10, 8, 6, 4 or 2 give <b class=m>+4 Mult</b>' },
  { id: 'todd', name: 'Odd Todd', rar: 1, cost: 4, art: 'tri #ff8bd1 eyes1 tongue tuft feet', quip: 'Nobody invited Todd. Todd is here.',
    card: (ctx, c) => (c.rank === 14 || (c.rank <= 9 && c.rank % 2 === 1) ? { chips: 31 } : null),
    desc: () => 'Scored A, 9, 7, 5 or 3 give <b class=c>+31 Chips</b>' },
  { id: 'sniffer', name: 'Royal Sniffer', rar: 1, cost: 5, art: 'egg #b88cff eyes2 nose crown', quip: 'Can smell a King from three decks away.',
    card: (ctx, c) => (ctx.isFaceLike(c) ? { chips: 30 } : null), desc: () => 'Scored face cards give <b class=c>+30 Chips</b>' },
  { id: 'couch', name: 'Couch Goblin', rar: 1, cost: 5, art: 'blob #a3b86c eyes2 sleepy grin ears feet', quip: 'Refuses to move. Strong opinions about it.',
    hand: ctx => (ctx.run.discards > 0 ? { chips: 30 * ctx.run.discards } : null), desc: () => '<b class=c>+30 Chips</b> for each discard you have left' },
  { id: 'meatball', name: 'Mystery Meatball', rar: 1, cost: 4, art: 'blob #c2703d eyes3 googly grin', quip: "Nobody knows what's in it. Not even the meatball.",
    hand: ctx => ({ mult: randInt(ctx.run.rng, 0, 23) }), desc: () => '<b class=m>+0 to +23 Mult</b>, rolled every hand' },
  { id: 'piggy', name: 'Piggy Bankenstein', rar: 1, cost: 5, art: 'egg #ffa8c5 eyes2 stitches nose ears feet', quip: "It's alive! And saving for retirement.",
    roundEnd: () => 3, desc: () => 'Earn <b class=g>$3</b> at the end of every round' },
  { id: 'larry', name: 'Last-Second Larry', rar: 1, cost: 4, art: 'bean #ff6f6f eyes2 sweat o arms', quip: 'Started his taxes at 11:58 PM. Every year.',
    hand: ctx => (ctx.last ? { mult: 20 } : null), desc: () => '<b class=m>+20 Mult</b> on your last hand of the round' },
  { id: 'snack', name: 'Snack Goblin', rar: 1, cost: 5, art: 'blob #ffcf6b eyes2 grin crumbs arms', quip: 'Eats himself when bored. Is always bored.',
    init: m => { m.st.mult = 20; },
    hand: (ctx, m) => ({ mult: m.st.mult }),
    roundEnd: (run, m) => { m.st.mult -= 4; if (m.st.mult <= 0) m.st.dead = 'ate himself'; return 0; },
    desc: m => `<b class=m>+${m.st.mult} Mult</b>. Loses 4 Mult every round` },
  { id: 'smallfry', name: 'Small Fry', rar: 1, cost: 4, art: 'tri #ffe066 eyes2 grin feet', quip: 'Small but mighty. Mostly small.',
    card: (ctx, c) => (c.rank >= 2 && c.rank <= 5 ? { chips: 10, mult: 2 } : null), desc: () => 'Scored 2s to 5s give <b class=c>+10 Chips</b> and <b class=m>+2 Mult</b>' },
  { id: 'bonk', name: 'Bonk Bunny', rar: 1, cost: 4, art: 'egg #f2f2f2 eyes2 teeth bunnyears mallet', quip: 'Hits first. Asks questions never.',
    hand: ctx => (ctx.first ? { mult: 10 } : null), desc: () => '<b class=m>+10 Mult</b> on your first hand of the round' },
  { id: 'grumble', name: 'Grumble Bee', rar: 1, cost: 5, art: 'blob #ffd23f eyes2 angry stripes wings antenna', quip: 'Buzzes angrily at every discard. Gets stronger out of spite.',
    init: m => { m.st.mult = 0; },
    discard: (run, cards, m) => { m.st.mult += 1; },
    hand: (ctx, m) => (m.st.mult ? { mult: m.st.mult } : null), desc: m => `Gains +1 Mult per discard used. Now <b class=m>+${m.st.mult} Mult</b>` },
  { id: 'sockrates', name: 'Sockrates', rar: 1, cost: 5, art: 'bean #9fd6ff eyes2 beard toga', quip: 'The only true wisdom is knowing you have no socks.',
    hand: ctx => ({ mult: 3 * ctx.run.monsters.length }), desc: () => '<b class=m>+3 Mult</b> for each monster you have' },
  { id: 'icecream', name: 'Ice Cream Cyclops', rar: 1, cost: 5, art: 'cone #ffc2e2 eyes1 tongue sprinkles', quip: 'Melting under pressure. Literally.',
    init: m => { m.st.chips = 100; },
    hand: (ctx, m) => ({ chips: m.st.chips }),
    after: (ctx, m) => { m.st.chips -= 5; if (m.st.chips <= 0) m.st.dead = 'melted'; },
    desc: m => `<b class=c>+${m.st.chips} Chips</b>. Loses 5 Chips every hand` },

  // ---------------- uncommons ----------------
  { id: 'accountant', name: 'The Accountant', rar: 2, cost: 6, art: 'box #7fb3a8 eyes2 glasses tie grin', quip: 'Has filed you under "liabilities".',
    hand: ctx => (ctx.run.gold > 0 ? { chips: 2 * ctx.run.gold } : null), desc: () => '<b class=c>+2 Chips</b> for every <b class=g>$1</b> you have' },
  { id: 'lasagna', name: 'Lasagna Golem', rar: 2, cost: 6, art: 'box #e0703a eyes2 grin layers arms feet', quip: 'It keeps growing. Nobody knows why. Nobody asks.',
    init: m => { m.st.chips = 0; },
    before: (ctx, m) => { m.st.chips += 6; },
    hand: (ctx, m) => ({ chips: m.st.chips }), desc: m => `Gains +6 Chips every hand played. Now <b class=c>+${m.st.chips} Chips</b>` },
  { id: 'rex', name: 'Ripper Rex', rar: 2, cost: 7, art: 'bean #6fcf6f eyes2 fangs spikes tinyarms', quip: 'Tiny arms. Enormous enthusiasm.',
    retrig: (ctx, c) => (c === ctx.scoring[0] ? 2 : 0), desc: () => 'Your first scored card scores <b>2 more times</b>' },
  { id: 'wrangler', name: 'Gremlin Wrangler', rar: 2, cost: 6, art: 'egg #d9a066 eyes2 grin cowboy lasso', quip: 'Yeehaw, but make it chaos.',
    hand: ctx => (ctx.run.stats.sent ? { mult: 3 * ctx.run.stats.sent } : null), desc: () => '<b class=m>+3 Mult</b> per gremlin you have sent this duel' },
  { id: 'revenge', name: 'Revenge Raccoon', rar: 2, cost: 6, art: 'blob #8a8fa3 eyes2 mask angry ears', quip: 'Keeps a list. You are on it.',
    hand: ctx => (ctx.run.stats.taken ? { mult: 6 * ctx.run.stats.taken } : null), desc: () => '<b class=m>+6 Mult</b> for every gremlin that hit you this duel' },
  { id: 'underdog', name: 'Underdog', rar: 2, cost: 6, art: 'egg #c9a27a eyes2 sad ears bandage', quip: 'Has never won anything. Until today, maybe.',
    hand: ctx => (ctx.run.lp < ctx.env.oppLp ? { xmult: 2 } : null), desc: () => '<b class=x>X2 Mult</b> while your LP is lower than your rival\'s' },
  { id: 'bulldog', name: 'Bully Bulldog', rar: 2, cost: 6, art: 'box #c79c6b eyes2 angry underbite collar', quip: 'Takes your lunch money. Invests it.',
    hand: ctx => (ctx.run.lp > ctx.env.oppLp ? { xmult: 1.5 } : null), desc: () => '<b class=x>X1.5 Mult</b> while your LP is higher than your rival\'s' },
  { id: 'bouncer', name: 'Bouncer Bear', rar: 2, cost: 6, art: 'blob #9b6b4b eyes2 sunglasses ears arms', quip: "Your name's not on the list, gremlin.",
    roundStart: (run, m) => { m.st.ready = true; return 0; }, init: m => { m.st.ready = true; },
    desc: m => `Blocks the first gremlin sent at you each round${m.st.ready ? '' : ' <i>(used)</i>'}` },
  { id: 'frog', name: 'Fortune Frog', rar: 2, cost: 6, art: 'blob #57c94f eyes2 grin coin feet', quip: 'Ribbit means "maybe" in frog.',
    hand: ctx => (chance(ctx.run.rng, 0.25) ? { xmult: 3, msg: 'RIBBIT!' } : { msg: 'ribbit…' }), desc: () => '<b>1 in 4</b> chance for <b class=x>X3 Mult</b>' },
  { id: 'hype', name: 'Hype Squid', rar: 2, cost: 7, art: 'squid #ff7ab6 eyes2 grin tentacles foamfinger', quip: 'Was going to be a cheerleader. Too many arms.',
    init: m => { m.st.mult = 0; },
    clash: (run, m, won) => { if (won) m.st.mult += 5; },
    hand: (ctx, m) => (m.st.mult ? { mult: m.st.mult } : null), desc: m => `Gains +5 Mult every clash you win. Now <b class=m>+${m.st.mult} Mult</b>` },
  { id: 'blueberry', name: 'Blueberry Blob', rar: 2, cost: 6, art: 'blob #5b7dff eyes2 grin drip', quip: 'Leaves stains on everything. Including your heart.',
    card: (ctx, c) => { c.bonus = (c.bonus || 0) + 4; return { msg: '+4 forever' }; }, desc: () => 'Every scored card <b>permanently</b> gains <b class=c>+4 Chips</b>' },
  { id: 'clowncar', name: 'Clown Car', rar: 2, cost: 6, art: 'box #ff5c5c eyes2 grin clownnose wheels', quip: 'There is always room for one more.',
    passive: { handSize: 1 }, desc: () => '<b>+1 hand size</b>' },
  { id: 'napper', name: 'Napping Nugget', rar: 2, cost: 6, art: 'egg #ffcc66 sleepy o nightcap', quip: 'Discards responsibilities. And cards.',
    passive: { discards: 1 }, desc: () => '<b>+1 discard</b> every round' },
  { id: 'stonks', name: 'Stonks Goblin', rar: 2, cost: 7, art: 'box #4fd18b eyes2 grin tie arrow', quip: 'Line goes up. Line must go up.',
    passive: { interestCap: 5 }, desc: () => 'Raises your interest cap from <b class=g>$5</b> to <b class=g>$10</b>' },
  { id: 'trashpanda', name: 'Trash Panda', rar: 2, cost: 6, art: 'blob #a0a0a8 eyes2 mask grin trashlid', quip: "One monster's trash is this monster's lunch.",
    init: m => { m.st.mult = 0; },
    roundStart: (run, m) => { m.st.mult = 0; return 0; },
    discard: (run, cards, m) => { m.st.mult += cards.length; },
    hand: (ctx, m) => (m.st.mult ? { mult: m.st.mult } : null), desc: m => `<b class=m>+1 Mult</b> per card discarded this round. Now <b class=m>+${m.st.mult}</b>` },
  { id: 'weasel', name: 'Shortcut Weasel', rar: 2, cost: 7, art: 'bean #c9a36b eyes2 grin ears tail', quip: 'Why use five cards when four will do?',
    passive: { four: true }, desc: () => 'Flushes and Straights can be made with <b>4 cards</b>' },
  { id: 'printer', name: 'Office Printer', rar: 2, cost: 6, art: 'box #dfe3ea eyes2 slot paper angry', quip: 'PAPER JAM. PAPER JAM. PAPER JAM.',
    hand: ctx => {
      if (!ctx.has.pair) return null;
      if (chance(ctx.run.rng, 1 / 3)) { ctx.out.printSpell = true; return { msg: 'PRINTED!' }; }
      return { msg: 'PAPER JAM' };
    }, desc: () => 'When you play a Pair, <b>1 in 3</b> chance to print a random Spell' },
  { id: 'disco', name: 'Disco Demon', rar: 2, cost: 7, art: 'star #d16bff eyes2 sunglasses grin afro', quip: 'Will not stop doing the hustle.',
    hand: ctx => (ctx.scoring.length >= 5 ? { xmult: 2 } : null), desc: () => '<b class=x>X2 Mult</b> if 5 cards score' },
  { id: 'shredmaster', name: 'Shredmaster 3000', rar: 2, cost: 7, art: 'box #707a8c eyes2 slot angry spikes', quip: "Gary's older, angrier brother.",
    init: m => { m.st.x = 1; },
    destroyed: (run, m) => { m.st.x += 0.25; },
    hand: (ctx, m) => (m.st.x > 1 ? { xmult: m.st.x } : null), desc: m => `Gains X0.25 Mult whenever one of your cards is destroyed. Now <b class=x>X${m.st.x}</b>` },

  // ---------------- rares ----------------
  { id: 'midas', name: 'Midas Moth', rar: 3, cost: 8, art: 'blob #ffd700 eyes2 grin wings antenna sparkle', quip: 'Touched a lamp once. Now the lamp is gold.',
    card: (ctx, c) => { if (ctx.isFaceLike(c) && c.enh !== 'gilded') { c.enh = 'gilded'; return { msg: 'GILDED!' }; } return null; },
    desc: () => 'Scored face cards turn <b class=g>Gilded</b>' },
  { id: 'copycat', name: 'Copycat Cat', rar: 3, cost: 9, art: 'egg #ffb066 eyes2 grin catears whiskers', quip: 'Meow? Meow. (It is copying you.)',
    copy: true, desc: () => 'Copies the ability of the monster to its <b>right</b>' },
  { id: 'chad', name: 'Chad the Jacked Pigeon', rar: 3, cost: 9, art: 'egg #b8c4d6 eyes2 beak muscles headband', quip: 'Never skipped wing day.',
    ...containsMon('straight', { xmult: 3 }, 'Straight') },
  { id: 'dragon', name: 'Pocket Dragon', rar: 3, cost: 9, art: 'bean #ff5a3c eyes2 fangs horns wings smoke', quip: 'Fits in your pocket. Sets the pocket on fire.',
    ...containsMon('flush', { xmult: 2 }, 'Flush') },
  { id: 'ernie', name: 'Extra-Arms Ernie', rar: 3, cost: 10, art: 'blob #7ed9c8 eyes2 grin arms arms2', quip: 'Great at hugs. Greater at card games.',
    passive: { hands: 1 }, desc: () => '<b>+1 hand</b> every round' },
  { id: 'echo', name: 'Echo Owl', rar: 3, cost: 9, art: 'egg #9b7bd1 eyes2 big beak tufts', quip: 'Who? Who? Who? Who? (It retriggers.)',
    retrig: (ctx, c) => (ctx.isFaceLike(c) ? 1 : 0), desc: () => 'Scored face cards score <b>1 more time</b>' },
  { id: 'hydra', name: 'Heartthrob Hydra', rar: 3, cost: 9, art: 'bean #ff4f8b eyes2 grin heads blush', quip: 'Three heads, three dates, one very confused heart.',
    retrig: (ctx, c) => (ctx.suitIs(c, 'H') ? 1 : 0), desc: () => 'Scored ♥ cards score <b>1 more time</b>' },
  { id: 'glutton', name: 'Glutton Ghost', rar: 3, cost: 9, art: 'ghost #e8e8ff eyes2 o napkin', quip: 'Died at a buffet. Never left.',
    init: m => { m.st.x = 1; },
    roundEnd: (run, m) => { m.st.x = Math.round((m.st.x + 0.2) * 100) / 100; return 0; },
    hand: (ctx, m) => (m.st.x > 1 ? { xmult: m.st.x } : null), desc: m => `Gains X0.2 Mult every round. Now <b class=x>X${m.st.x}</b>` },

  // ---------------- legendaries (packs only) ----------------
  { id: 'destiny', name: 'Destiny Dragon', rar: 4, cost: 12, art: 'bean #ffdd55 eyes2 fangs horns wings crown sparkle', quip: 'Believes in you. Believes even harder in itself.',
    passive: { heart: true }, desc: () => 'Heart of the Cards fills <b>twice as fast</b> and gives <b class=x>X4</b> instead of X2' },
  { id: 'goblinking', name: 'Goblin King Grub', rar: 4, cost: 12, art: 'blob #7acb3f eyes2 grin crown cape', quip: 'Rules over gremlins. Mostly by bribery.',
    passive: { gremlinTwice: true }, desc: () => 'Every gremlin you send <b>hits twice</b>' },
  { id: 'bigcheese', name: 'The Big Cheese', rar: 4, cost: 12, art: 'tri #ffd84a eyes2 grin holes tophat', quip: 'He is the big cheese. He knows it. You know it.',
    hand: () => ({ xmult: 3 }), desc: () => '<b class=x>X3 Mult</b>' },
  { id: 'suneater', name: 'Sunny the Sun Eater', rar: 4, cost: 12, art: 'star #ff9f1c eyes2 fangs sunrays', quip: 'Ate the sun. Still hungry. Has eyes on the moon.',
    card: (ctx, c) => (c.rank === 12 || c.rank === 13 ? { xmult: 1.5 } : null), desc: () => 'Scored Kings and Queens give <b class=x>X1.5 Mult</b>' },
];
export const MON_BY_ID = Object.fromEntries(MONSTERS.map(m => [m.id, m]));
export const RARITY = { 1: { name: 'Common', color: '#4aa3ff' }, 2: { name: 'Uncommon', color: '#3ecf6e' }, 3: { name: 'Rare', color: '#ff5470' }, 4: { name: 'Legendary', color: '#c86bff' } };
export const EDITIONS = {
  foil: { name: 'Foil', desc: '<b class=c>+50 Chips</b>', cost: 2 },
  holo: { name: 'Holo', desc: '<b class=m>+10 Mult</b>', cost: 3 },
  shiny: { name: 'Shiny', desc: '<b class=x>X1.5 Mult</b>', cost: 5 },
};

/** Everyone starts with these unlocked; the rest come from levelling up and loot packs. */
export const STARTER_POOL = MONSTERS.filter(m => m.rar === 1).map(m => m.id)
  .concat(['accountant', 'lasagna', 'frog', 'clowncar', 'bouncer', 'underdog']);

export function monsterDesc(m) {
  const d = MON_BY_ID[m.id];
  return typeof d.desc === 'function' ? d.desc(m) : d.desc;
}

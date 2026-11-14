// House rules for one duel, picked by the host in the lobby: starting Life Points, the round timer and
// up to ten modifiers. Both sides play by the same cfg; it travels over the network as { lp, time, mods }.
// Pure data (no page code) so the engine and tools/test.mjs can use it.

export const MODS = [
  { id: 'money', icon: '💸', name: 'Money Rain', desc: 'Start with $12 and get $3 extra every shop.' },
  { id: 'frenzy', icon: '👹', name: 'Gremlin Frenzy', desc: 'Gremlins cost $1 less and cool down twice as fast.' },
  { id: 'glass', icon: '💥', name: 'Glass Cannons', desc: 'All clash damage is doubled. Blink and it\'s over.' },
  { id: 'bighands', icon: '🖐️', name: 'Big Hands', desc: 'Hold 10 cards instead of 8.' },
  { id: 'heart', icon: '💖', name: 'Heart Overdrive', desc: 'Heart of the Cards fills twice as fast.' },
  { id: 'shredder', icon: '🧻', name: 'Shredder Party', desc: 'Losing a clash shreds 3 cards from your deck instead of 1.' },
  { id: 'bossrush', icon: '👑', name: 'Boss Rush', desc: 'Every round is a boss round. Every. Single. One.' },
  { id: 'chaos', icon: '🌈', name: 'Chaos Deck', desc: 'Every card in both decks starts with a random enhancement.' },
  { id: 'sevens', icon: '🎰', name: 'Lucky Sevens', desc: 'Every scoring 7 gives +7 Mult.' },
  { id: 'vampire', icon: '🧛', name: 'Vampire Bites', desc: 'Win a clash and heal for half the damage you dealt.' },
];
export const MOD_BY_ID = Object.fromEntries(MODS.map(m => [m.id, m]));

export const LP_OPTS = [2000, 3000, 4000, 6000, 8000];
/** Battle timer -> shop timer (seconds). */
export const TIME_OPTS = [[45, 25], [60, 30], [90, 40], [120, 50], [150, 55]];

export const DEFAULT_CFG = { lp: 4000, time: 90, mods: [] };

/** Cleans up a cfg (it may come off the network): unknown values fall back to the standard rules. */
export function normCfg(c) {
  c = c || {};
  const lp = LP_OPTS.includes(c.lp) ? c.lp : DEFAULT_CFG.lp;
  const t = TIME_OPTS.find(x => x[0] === c.time) || TIME_OPTS.find(x => x[0] === DEFAULT_CFG.time);
  const mods = MODS.filter(m => Array.isArray(c.mods) && c.mods.includes(m.id)).map(m => m.id);
  return { lp, time: t[0], battleSec: t[0], shopSec: t[1], mods };
}
export const hasMod = (cfg, id) => !!(cfg && cfg.mods && cfg.mods.includes(id));
export const isStandard = cfg => { const c = normCfg(cfg); return c.lp === DEFAULT_CFG.lp && c.time === DEFAULT_CFG.time && !c.mods.length; };

/** Rough rounds a duel lasts with these rules (from bot duels in tools/test.mjs), and minutes on the clock. */
export function estimate(cfg) {
  const c = normCfg(cfg);
  // damage per round grows with the round number, so rounds grow slower than Life Points do
  let rounds = { 2000: 3.6, 3000: 4.7, 4000: 5.8, 6000: 7.4, 8000: 8.6 }[c.lp];
  let pace = 1;
  if (hasMod(c, 'glass')) pace *= 2;
  if (hasMod(c, 'bossrush')) pace *= 1.5;
  if (hasMod(c, 'vampire')) pace *= 0.8;
  if (pace !== 1) rounds = Math.max(2, rounds / Math.pow(pace, 0.6));
  const secs = rounds * (c.battleSec + c.shopSec + 16) + 40;
  return { rounds: Math.round(rounds), mins: Math.max(3, Math.round(secs / 60)) };
}

// Playing cards and poker hands. Pure rules, no page code.

export const SUITS = {
  S: { sym: '♠', name: 'Spades', color: '#2b2a52' },
  H: { sym: '♥', name: 'Hearts', color: '#e5304d' },
  D: { sym: '♦', name: 'Diamonds', color: '#ee7d12' },
  C: { sym: '♣', name: 'Clubs', color: '#1f9558' },
};
export const SUIT_KEYS = ['S', 'H', 'D', 'C'];
export const rankLabel = r => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r));
export const rankName = r => ({ 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' }[r] || String(r));
export const cardName = c => `${rankName(c.rank)} of ${SUITS[c.suit].name}`;
export const cardShort = c => `${rankLabel(c.rank)}${SUITS[c.suit].sym}`;

/** Base chips and mult for each hand, and what a level adds. Best hand first. */
export const HANDS = [
  { id: 'flushfive', name: 'Flush Five', chips: 160, mult: 16, lc: 50, lm: 3, secret: true, shout: 'UNREASONABLE!' },
  { id: 'flushhouse', name: 'Flush House', chips: 140, mult: 14, lc: 40, lm: 4, secret: true, shout: 'FANCY HOUSE!' },
  { id: 'fiveofakind', name: 'Five of a Kind', chips: 120, mult: 12, lc: 35, lm: 3, secret: true, shout: 'FIVE?!' },
  { id: 'straightflush', name: 'Straight Flush', chips: 100, mult: 8, lc: 40, lm: 4, shout: 'STRAIGHT FLUSH!!' },
  { id: 'fourofakind', name: 'Four of a Kind', chips: 60, mult: 7, lc: 30, lm: 3, shout: 'QUADS!' },
  { id: 'fullhouse', name: 'Full House', chips: 40, mult: 4, lc: 25, lm: 2, shout: 'FULL HOUSE!' },
  { id: 'flush', name: 'Flush', chips: 35, mult: 4, lc: 15, lm: 2, shout: 'FLUSH!' },
  { id: 'straight', name: 'Straight', chips: 30, mult: 4, lc: 30, lm: 3, shout: 'STRAIGHT!' },
  { id: 'threeofakind', name: 'Three of a Kind', chips: 30, mult: 3, lc: 20, lm: 2, shout: 'TRIPS!' },
  { id: 'twopair', name: 'Two Pair', chips: 20, mult: 2, lc: 20, lm: 1, shout: 'TWO PAIR' },
  { id: 'pair', name: 'Pair', chips: 10, mult: 2, lc: 15, lm: 1, shout: 'PAIR' },
  { id: 'highcard', name: 'High Card', chips: 5, mult: 1, lc: 10, lm: 1, shout: 'high card…' },
];
export const HAND_BY_ID = Object.fromEntries(HANDS.map(x => [x.id, x]));
export const handRank = id => HANDS.length - HANDS.findIndex(x => x.id === id);

export function handBase(levels, id) {
  const H = HAND_BY_ID[id], l = levels[id] || 1;
  return { chips: H.chips + H.lc * (l - 1), mult: H.mult + H.lm * (l - 1), level: l };
}

export const cardChips = c => (c.rank === 14 ? 11 : c.rank >= 10 ? 10 : c.rank) + (c.bonus || 0) + (c.enh === 'swole' ? 30 : 0);
export const isFace = c => c.rank >= 11 && c.rank <= 13;

/** Does this card count as suit s (Wild counts as every suit). */
export const suitIs = (c, s) => c.enh === 'wild' || c.suit === s;

function straightRun(cards, need) {
  // Returns the cards making a straight of length `need` (A can be low), or null.
  const byRank = new Map();
  for (const c of cards) if (!byRank.has(c.rank)) byRank.set(c.rank, c);
  if (byRank.has(14)) byRank.set(1, byRank.get(14));
  for (let top = 14; top >= need; top--) {
    const run = [];
    for (let r = top; r > top - need; r--) { if (!byRank.has(r)) break; run.push(byRank.get(r)); }
    if (run.length === need) return run;
  }
  return null;
}

function flushSet(cards, need) {
  for (const s of SUIT_KEYS) {
    const m = cards.filter(c => suitIs(c, s));
    if (m.length >= need) return m;
  }
  return null;
}

/**
 * What poker hand these 1-5 cards make. opts.four: flushes and straights can be made with 4 cards.
 * Returns { type, scoring: [cards that score], has: {pair, twopair, three, four, straight, flush} }.
 */
export function evalHand(cards, opts = {}) {
  const n = cards.length;
  if (!n) return { type: null, scoring: [], has: {} };
  const need = opts.four ? Math.min(4, 5) : 5;
  const counts = new Map();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const top = groups[0][1], second = groups[1] ? groups[1][1] : 0;
  const fl = n >= need ? flushSet(cards, need) : null;
  const st = n >= need ? straightRun(cards, need) : null;
  const ofRank = r => cards.filter(c => c.rank === r);
  const has = {
    pair: top >= 2, twopair: (top >= 2 && second >= 2) || top >= 4, three: top >= 3, four: top >= 4,
    straight: !!st, flush: !!fl,
  };
  let type, scoring;
  if (top === 5 && fl && fl.length === 5) { type = 'flushfive'; scoring = cards.slice(); }
  else if (top === 3 && second === 2 && fl && fl.length === 5) { type = 'flushhouse'; scoring = cards.slice(); }
  else if (top === 5) { type = 'fiveofakind'; scoring = cards.slice(); }
  else if (st && fl && straightRun(fl, need)) {
    type = 'straightflush';
    scoring = cards.filter(c => fl.includes(c) || st.includes(c));
  }
  else if (top === 4) { type = 'fourofakind'; scoring = ofRank(groups[0][0]); }
  else if (top === 3 && second >= 2) { type = 'fullhouse'; scoring = cards.slice(); }
  else if (fl) { type = 'flush'; scoring = cards.filter(c => fl.includes(c)); }
  else if (st) { type = 'straight'; scoring = cards.filter(c => st.includes(c)); }
  else if (top === 3) { type = 'threeofakind'; scoring = ofRank(groups[0][0]); }
  else if (top === 2 && second === 2) { type = 'twopair'; scoring = cards.filter(c => c.rank === groups[0][0] || c.rank === groups[1][0]); }
  else if (top === 2) { type = 'pair'; scoring = ofRank(groups[0][0]); }
  else {
    type = 'highcard';
    const best = cards.reduce((a, b) => (b.rank > a.rank ? b : a));
    scoring = [best];
  }
  return { type, scoring, has };
}

/**
 * The best 5 cards anyone could make from a pile (for Heart of the Cards). Builds the hand directly
 * instead of trying every combination. Returns an array of up to 5 cards.
 */
export function bestFive(pile, opts = {}) {
  if (pile.length <= 5) return pile.slice();
  const byRank = new Map();
  for (const c of pile) { if (!byRank.has(c.rank)) byRank.set(c.rank, []); byRank.get(c.rank).push(c); }
  const ranksBy = [...byRank.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const candidates = [];
  // five / four / full house / trips / pairs from rank groups
  for (const [r, cs] of ranksBy) if (cs.length >= 5) candidates.push(cs.slice(0, 5));
  for (const s of SUIT_KEYS) {
    const suited = pile.filter(c => suitIs(c, s));
    if (suited.length >= 5) {
      const sf = straightRun(suited, 5);
      if (sf) candidates.push(sf);
      // flush house / flush five inside one suit
      const sr = new Map();
      for (const c of suited) { if (!sr.has(c.rank)) sr.set(c.rank, []); sr.get(c.rank).push(c); }
      const g = [...sr.values()].sort((a, b) => b.length - a.length || b[0].rank - a[0].rank);
      if (g[0].length >= 5) candidates.push(g[0].slice(0, 5));
      if (g[0].length >= 3 && g[1] && g[1].length >= 2) candidates.push([...g[0].slice(0, 3), ...g[1].slice(0, 2)]);
      candidates.push(suited.slice().sort((a, b) => b.rank - a.rank).slice(0, 5));
    }
  }
  const four = ranksBy.find(([, cs]) => cs.length >= 4);
  if (four) candidates.push([...four[1].slice(0, 4), highestExcept(pile, four[1])].filter(Boolean));
  const trips = ranksBy.filter(([, cs]) => cs.length >= 3);
  const pairs = ranksBy.filter(([, cs]) => cs.length >= 2);
  if (trips.length) {
    const t = trips[0];
    const p = pairs.find(x => x[0] !== t[0]);
    if (p) candidates.push([...t[1].slice(0, 3), ...p[1].slice(0, 2)]);
  }
  const st = straightRun(pile, 5);
  if (st) candidates.push(st);
  if (trips.length) candidates.push(trips[0][1].slice(0, 3));
  if (pairs.length >= 2) candidates.push([...pairs[0][1].slice(0, 2), ...pairs[1][1].slice(0, 2)]);
  if (pairs.length) candidates.push(pairs[0][1].slice(0, 2));
  candidates.push(pile.slice().sort((a, b) => b.rank - a.rank).slice(0, 5));
  let best = null, bestScore = -1;
  for (const c of candidates) {
    const ev = evalHand(c, opts);
    const sc = handRank(ev.type) * 1000 + ev.scoring.reduce((a, x) => a + cardChips(x), 0);
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  return best;
}
function highestExcept(pile, not) {
  let b = null;
  for (const c of pile) if (!not.includes(c) && (!b || c.rank > b.rank)) b = c;
  return b;
}

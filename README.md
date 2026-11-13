# ⚔️🃏 Battle Cards

A two-player poker-hand monster duel for the browser. Both duelists play poker hands at the same time, Balatro
style: **Chips × Mult**, with little monsters in your Monster Zones that multiply everything. Your round score is
your **ATK**. Then the round ends in a **CLASH**: the bigger ATK wins, the winner's monsters charge across the
table and chew up the loser's cards, and the loser's Life Points drop. Mid-round you can buy **gremlins** and send
them at your rival to shred, ink, glue and rob their hand, Bloons TD Battles style. First to 0 Life Points loses.
A duel takes about 15 minutes, and never much more than 25.

**Play:** https://josephjackman.com/games/battlecards/

Two players only. There is no single-player mode.

## How a duel goes

- **Find a rival:** **Quick Duel** (anyone else searching right now), **Make a duel room** (share the 5-number
  code or the invite link, `?room=CODE`), or **⚔️ challenge a friend** who is online. They get a pop-up invite.
- **VS screen, then pick a free starter monster** (1 of 3 commons from your unlocked pool).
- **A round (90 s):** 4 hands, 3 discards, 8 cards in hand. Pick up to 5 cards and play them. Each hand scores
  Chips × Mult and adds to your ATK. Your rival's ATK climbs live at the top of the screen, and when they lock in
  you're told what you have to beat.
- **The clash:** both ATKs race up side by side, CLASH!, then:
  - damage to the loser = `(200 + 100 × round) × crush + 25 per winner's monster`
  - crush = `1 + 0.5 × (winner ÷ loser − 1)`, capped at 2.25×, so a huge score helps but can't one-shot anyone
  - a tie hurts both duelists for half the base
  - every 3rd round is a **Boss Clash** (×1.5 and a shared nasty rule); from round 10 it's **Sudden Death** (×2)
  - the winner's monsters also **shred one random card out of the loser's deck for good**
  - close finishes (within 12%) get a slowed-down "SO CLOSE!" reveal
- **The shop (40 s):** 2 monsters, 2 spells/tomes/traps, 2 packs, reroll ($3, +$1 each time), sell monsters for
  half. **READY!** ends it early once both duelists are ready.
- **Gold each round:** $5, interest ($1 per $5 held, max $5, or $10 with Stonks Goblin), gremlin eco, monster
  payouts, +$1 for winning the clash or a comeback bonus for losing it ($2, more on a losing streak), +$3 after a
  boss. Whoever has fewer Life Points also gets a free reroll.
- **Heart of the Cards:** fills from damage taken (1% per 20 LP), lost clashes (+10%) and gremlin hits (+8%).
  When it's full, **BELIEVE**: the best possible 5-card hand in your hand plus your draw pile is pulled into
  your hand, pre-selected, and scores ×2 Mult (×4 with Destiny Dragon). Your rival is told, ominously.
- **Starting LP:** 4,000 each.

### Monsters (55)

Commons, uncommons, rares and legendaries, each a little procedurally drawn SVG creature that bobs, blinks and
bounces when it triggers. They score **left to right** (click to move or sell). Foil (+50 Chips), Holo (+10
Mult) and Shiny (×1.5 Mult) editions turn up in the shop and more often in packs. Some care about the duel
itself: Underdog (×2 while behind on LP), Bully Bulldog, Gremlin Wrangler (+3 Mult per gremlin sent), Revenge
Raccoon (+6 Mult per gremlin taken), Hype Squid (grows every clash won), Bouncer Bear (blocks the first gremlin
each round), Shredmaster 3000 (grows when your cards are destroyed, including by your rival).

Legendaries only come from packs: Destiny Dragon, Goblin King Grub (your gremlins hit twice), The Big Cheese
(×3 Mult) and Sunny the Sun Eater.

### Spells, tomes and traps

- **Tomes** level up a poker hand (secret hands' tomes only appear once you've played that hand).
- **Spells** change selected cards: Spicy (+4 Mult), Swole (+30 Chips), Gilded (+$2), Glass (×2, may shatter),
  Lucky, Steel (×1.5 while held), Wild, suit changes, Shredder, Copy Machine, Growth Spurt, Piggy Smash,
  Summoning Circle and Lucky Spray (1 in 3 for an edition).
- **Traps** are set face down; your rival sees how many but not which. Boomerang Box (sends a gremlin back),
  Bug Zapper (eats a gremlin, +$3), Banana Peel (half damage on a lost clash), Spike Pit (+50% on a won clash),
  Reflecto-Cape (40% of a lost clash's damage bounces back).

### The Gremlin Gate

| Gremlin | Cost | Eco | Cooldown | Does |
| --- | --- | --- | --- | --- |
| Shredder Rat | $2 | +0.5 | 6 s | Shreds a random card in their hand |
| Ink Bat | $3 | +0.75 | 8 s | Flips 3 of their cards face down |
| Glue Snail | $3 | +0.75 | 8 s | Glues 2 cards (can't discard) |
| Bandit Raccoon | $4 | +1 | 12 s | Steals one of their discards |
| Mult Muncher | $5 | +1.25 | 12 s | Their next hand scores half Mult |
| Big Chomper | $7 | +2 | 18 s | Eats a card in their hand forever |
| Hand Hog | $8 | +2 | 25 s | Steals one of their hands (once a round) |

Eco is extra gold every round, capped at $12. Gremlins can only be sent while your rival is still playing, so
finishing early means gremlin time.

### Boss rounds

The Sock Goblin (a suit is debuffed), The Fog Wizard (1 in 3 cards drawn face down), Tiny Hands Tony (−2 hand
size), The Tax Man ($1 per hand), The Chompy Moon (eats a card after each hand), The Mime (no discards), Plain
Jane (face cards debuffed). Both duelists get the same boss.

## Between duels (the meta)

Built around what makes Balatro-likes hard to put down (research notes are in the commit that added the game):
no score preview (the hand resolves in a count-up whose notes climb in pitch), exponential numbers with shake,
flames and confetti scaled to the size of the hand, variable rewards from shop rerolls and packs, rare editions,
discovery of new monsters, near-miss callouts, and a one-click rematch.

- **Levels and XP:** every duel gives XP (win 120, loss 70, plus clashes, gremlins, streaks and friend duels).
  Early levels come fast. Every level gives something: a new monster for your shop, a taunt, a title or a card
  back.
- **Loot packs:** one after every duel, win or lose, plus 2 from the daily chest. Three face-down cards to flip,
  with a pity timer so a new monster turns up at least every third pack while any are locked.
- **Monster-dex:** all 55 monsters, locked ones as silhouettes. Finding a monster you haven't unlocked in a
  Monster Pack unlocks it forever.
- **Daily quests:** 3 a day from a pool of 17 (the same 3 all day, picked from your friend code and the date),
  and a chest when all 3 are done. A daily streak counts days in a row you've finished a duel.
- **Rivalries:** your win–loss record against each friend shows in the friends list and on the VS screen.
- **Taunts:** 💬 in a duel. 6 to start, more to unlock.

## Friends, invites and codes

- Every duelist gets a **friend code** like `WAFFLE-7583`. Add someone by code, or share your friend link
  (`?friend=CODE`), which sends the request when they open it. Requests wait for people who are offline.
- The friends list shows who's **online**, **in a duel** or when they were last seen, with your record against
  them. **⚔️** invites an online friend: it makes a room and pops up a challenge on their screen.
- **Room codes** are 5 numbers; the invite link is `?room=CODE`. A third person trying to join is told it's full.
- **Quick Duel** pairs you with anyone else searching at the same moment.

## How online play works

There is no game server. Everything goes through free public MQTT message servers over secure websockets
(`public/js/mqtt.js`, the same servers and tiny client as Horse Race, The Deck and Lieage use for their relay).
Each browser connects to all three servers at once, publishes every message on all of them, and drops the
duplicates it hears back, so a duel survives one server dropping out.

- Topics live under `jjgames/battlecards-v1/`: presence (retained), friend requests (retained until handled),
  invites, quick-match seekers, and two topics per duel room.
- In a duel, `public/js/net.js` `DuelLink` re-sends important messages until the other side acks them, pings
  every 0.7 s, and shows a banner if the rival goes quiet for 9 s. After 45 s of silence you win by forfeit.
- The host (whoever made the room) runs the clock and works out each clash from both duelists' reported ATK.
  Each side scores its own hands and applies the gremlins sent at it (traps and Bouncer Bear first), then
  answers with what happened. Both share one seed, so boss rounds match.
- What goes through the public servers (names, friend codes, scores) isn't private. Your progress is saved in
  this browser only (`localStorage`).

## Play locally

```bash
npm start
```

Open http://localhost:8097. To duel yourself, open a second tab with `?as=2` (a second, separate duelist profile
in the same browser), make a room in one tab and join it from the other.

`?devbot` starts a duel against a simple bot in the same tab (developer testing only; it isn't a game mode).

## Tests

```bash
npm test
```

Hand evaluation (including wild cards and 4-card flushes), scoring order, Copycat Cat, passives, every gremlin,
traps, clash damage and its cap, Heart of the Cards, every monster through random rounds, every spell, the shop
and packs, and bot-vs-bot duels to check duels end in a sensible number of rounds.

## Deploying

`.github/workflows/ready.yml` runs the tests on every push to `main` and then moves the `ready` branch to that
commit. The [games](https://github.com/roamingjackmans-pixel/games) repo publishes every game on
josephjackman.com/games/ and puts this one at `josephjackman.com/games/battlecards/`: it looks for new `ready`
commits every 10 minutes, or starts right away when this repo has a `GAMES_DEPLOY_TOKEN` secret. That build
stamps the version and adds `?v=<commit>` to every file URL (`tools/stamp-build.mjs`).

## Project layout

```
public/                the game (this folder is what gets published)
  index.html, css/style.css, version.js
  js/main.js           boot, home, friends, rooms, quick match, results, loot packs, dex, settings
  js/duel.js           one duel: the host-driven phases, battle, shop, clash, gremlins, Heart of the Cards
  js/engine.js         the rules for one duelist (no page code, so it can be tested)
  js/cards.js          cards, poker hands, hand evaluation, best possible hand
  js/monsters.js       the 55 monsters
  js/items.js          spells, tomes, traps, gremlins, bosses
  js/profile.js        levels, unlocks, quests, streaks, loot packs, friends' records
  js/net.js            presence, friend requests, invites, DuelLink, quick match
  js/mqtt.js           the MQTT client and the three-server mesh
  js/art.js            procedural monster SVGs, playing cards, card backs
  js/fx.js             WebGL swirl background, particles, shake, shouts
  js/audio.js          synthesized sound effects and music
  js/ui.js             toasts, modals, tooltips, monster and item cards
tools/
  serve.mjs            local server
  test.mjs             rules tests
  stamp-build.mjs      deploy version stamp
```

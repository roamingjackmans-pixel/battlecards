// Boot, the home screen, friends and invites, rooms and quick match, results, loot packs, the collection.
import { h, $, $$, fmt, sleep, clamp, randomId } from './util.js';
import { MONSTERS, MON_BY_ID, RARITY, STARTER_POOL, monsterDesc } from './monsters.js';
import { HAND_BY_ID } from './cards.js';
import { monsterSVG, BACKS, backHTML } from './art.js';
import { sfx, unlock, startMusic, setSfx, setMusic, audioState } from './audio.js';
import * as FX from './fx.js';
import { Profile, TITLES, EMOTES, QUEST_BY_ID, xpNeed } from './profile.js';
import { Social, DuelLink, Matchmaker, genRoomCode, cleanRoom, cleanFriend } from './net.js';
import { Duel, BotLink } from './duel.js';
import { toast, modal, tip, monTipHTML, avatarOf, copyText } from './ui.js';
import { RULES } from './engine.js';
import { MODS, LP_OPTS, TIME_OPTS, DEFAULT_CFG, normCfg, estimate, isStandard } from './rules.js';

const params = new URLSearchParams(location.search);
const App = { profile: null, social: null, duel: null, link: null, mm: null, screen: null };
window.bcApp = App;
const P = () => App.profile.data;
const base = () => location.origin + location.pathname;

// ================================================================ boot
function boot() {
  FX.startBackground($('#bg'));
  FX.initParticles($('#fx'));
  // load the number font up front so canvas pop-ups (which can't trigger a font load) get it too
  try { document.fonts.load("40px 'BC Digits'", '0123456789'); document.fonts.load('40px Bangers', 'A'); } catch { }
  App.profile = new Profile();
  const go = () => { unlock(); startMusic(); };
  addEventListener('pointerdown', go, { once: true });
  addEventListener('keydown', go, { once: true });
  addEventListener('pointerdown', e => { if (e.target.closest('button, .btn')) sfx.click(); }, true);
  if (!P().name) welcome(); else afterName();
}

function afterName() {
  App.social = new Social(App.profile).start();
  const S = App.social;
  S.on('status', () => { const d = $('#netdot'); if (d) { d.classList.toggle('on', S.mesh.up > 0); d.lastChild.textContent = S.mesh.up ? 'Online' : 'Connecting…'; } });
  S.on('presence', () => { if (App.screen === 'home') renderFriends(); });
  S.on('request', r => {
    sfx.chime();
    toast(`<b>${esc(r.name)}</b> wants to be friends! (${r.code})`, { av: avatarOf(r.av, r.code), ms: 12000, buttons: [{ label: 'Accept', cls: 'green', fn: () => { S.acceptFriend(r); toast(`You and <b>${esc(r.name)}</b> are friends now! 🤝`); refreshHome(); } }, { label: 'Nah', cls: 'dark', fn: () => { S.declineFriend(r); refreshHome(); } }] });
    refreshHome();
  });
  S.on('accepted', r => { sfx.chime(); toast(`<b>${esc(r.name)}</b> is your friend now! Go bully each other with gremlins.`, { av: avatarOf(r.av, r.code) }); refreshHome(); });
  S.on('invite', i => {
    if (App.duel && !App.duel.over) { S.declineInvite(i); return; }
    sfx.chime(); setTimeout(() => sfx.chime(), 300);
    toast(`⚔️ <b>${esc(i.name)}</b> challenges you to a duel!`, { av: avatarOf(i.av, i.code), cls: 'invite', ms: 30000, buttons: [{ label: 'DUEL!', cls: 'gold', fn: () => joinRoom(i.room, i) }, { label: 'Not now', cls: 'dark', fn: () => S.declineInvite(i) }] });
  });
  S.on('declined', code => { const f = P().friends[code]; toast(`${esc(f ? f.name : code)} can't duel right now. Their loss. Literally.`); });

  const fr = params.get('friend');
  if (fr && cleanFriend(fr) !== P().code) { const err = S.requestFriend(fr); toast(err ? esc(err) : `Friend request sent to <b>${esc(cleanFriend(fr))}</b>!`); }
  const room = cleanRoom(params.get('room'));
  history.replaceState(null, '', location.pathname + (params.get('as') ? '?as=' + params.get('as') : '') + (params.has('devbot') ? (params.get('as') ? '&' : '?') + 'devbot' : ''));
  showHome();
  if (room.length === 5) joinRoom(room);
  if (params.has('devbot')) setTimeout(devBotDuel, 300);
  if (App.profile.dailyCheck()) App.profile.save();
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function welcome() {
  App.screen = 'welcome';
  FX.setBgMood('home');
  const app = $('#app'); app.innerHTML = '';
  let av = P().avatar;
  const input = h('input.field', { maxlength: 16, placeholder: 'Your duelist name', autocomplete: 'nickname', style: { textAlign: 'center', width: '100%' } });
  const grid = h('div.avpick');
  const draw = () => { grid.innerHTML = ''; for (const id of STARTER_POOL) grid.append(h('button' + (id === av ? '.on' : ''), { onclick: () => { av = id; sfx.select(3); draw(); }, html: monsterSVG(MON_BY_ID[id].art), title: MON_BY_ID[id].name })); };
  draw();
  const go = () => {
    const n = input.value.trim().slice(0, 16);
    if (!n) { sfx.nope(); input.focus(); input.animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 200 }); return; }
    P().name = n; P().avatar = av; App.profile.save();
    sfx.levelUp(); FX.confetti(innerWidth / 2, innerHeight / 2, 60);
    afterName();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  app.append(h('div.screen', h('div.lobby',
    h('p.site', h('a', { href: '/games/' }, 'josephjackman.com/games')),
    h('h1.logo', h('span', 'BATTLE'), ' ', h('span.l2', 'CARDS')),
    h('p.tagline', 'Poker hands summon monsters. Monsters eat your rival\'s cards. Two duelists enter. One leaves slightly more shredded.'),
    h('div.panel', { style: { width: 'min(460px, 94vw)', color: '#fff' } },
      h('h3', 'What do they call you, duelist?'), input,
      h('h3', { style: { marginTop: '14px' } }, 'Pick your mascot'), grid,
      h('div', { style: { textAlign: 'center', marginTop: '14px' } }, h('button.btn.gold.big', { onclick: go }, 'LET\'S DUEL!'))))));
  setTimeout(() => input.focus(), 100);
}

// ================================================================ home
function refreshHome() { if (App.screen === 'home') showHome(); }
function showHome() {
  App.screen = 'home';
  App.social && App.social.setStatus('menu');
  FX.setBgMood('home');
  const d = P();
  const app = $('#app'); app.innerHTML = '';
  const need = xpNeed(d.level);
  const codeIn = h('input.field', { inputmode: 'numeric', maxlength: 5, placeholder: '5-number code', 'aria-label': 'Room code' });
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(codeIn.value); });
  const mons = ['chomp', 'gary', 'blushbat', 'chad', 'bigcheese'].map((id, i) => {
    const el = h('div.lm', { style: { '--d': (i * 0.18) + 's' }, html: monsterSVG(MON_BY_ID[id].art) });
    el.addEventListener('click', () => { sfx.boing(); FX.jiggle(el, 2); const [x, y] = FX.centerOf(el); FX.stars(x, y, 6); FX.textPop(x, y - 30, ['HI!', 'RAWR', 'BLEP', 'NOM?', 'HEHE'][i], '#ffd43b'); });
    return el;
  });
  const v = window.BC_VERSION || {};
  const root = h('div.screen.home',
    h('div.home-top',
      h('p.site', h('a', { href: '/games/' }, '← games')),
      h('div.me-chip', { onclick: () => profileModal() }, h('div.av', { html: monsterSVG(avatarOf(d.avatar, d.code)) }), h('div', h('div.nm', d.name), h('div.tt', TITLES[d.title] || ''))),
      h('div.lvl', h('span.badge', 'Lv ' + d.level), h('div.xpbar', h('i', { style: { width: clamp(d.xp / need, 0, 1) * 100 + '%' } })), h('small', `${d.xp}/${need} XP`)),
      d.streak.n ? h('div.streak', `🔥 ${d.streak.n}-day streak`) : null,
      h('div.spacer'),
      d.packs > 0 ? h('button.btn.gold', { onclick: openLoot, style: { animation: 'wiggle 1s infinite' } }, `🎁 Open loot pack (${d.packs})`) : null,
      h('div.netdot#netdot' + (App.social && App.social.mesh.up ? '.on' : ''), h('i'), h('span', App.social && App.social.mesh.up ? 'Online' : 'Connecting…')),
      h('button.iconbtn', { onclick: settingsModal, title: 'Settings' }, '⚙️')),
    h('div.panel#questpanel'),
    h('div.home-mid',
      h('div.logo-mons', ...mons),
      h('h1.logo', h('span', 'BATTLE'), ' ', h('span.l2', 'CARDS')),
      h('p.tagline', 'Play poker hands. Summon little monsters. Send gremlins. Shred your rival\'s cards. 2 players, about 15 minutes.'),
      h('div.play-box',
        h('button.btn.gold.quick-btn', { onclick: quickMatch }, '⚔️ QUICK DUEL'),
        h('div', { style: { fontSize: '13px', color: '#cdb8e6', marginTop: '-6px' } }, 'Find a random rival online'),
        h('button.btn.big.purple', { onclick: () => createRoom(), style: { width: '100%' } }, '🏟️ Make a duel room'),
        h('div.join-row', codeIn, h('button.btn.blue', { onclick: () => joinRoom(codeIn.value) }, 'Join')))),
    h('div.panel#friendpanel'),
    h('div.home-bottom',
      h('button.btn.ghost', { onclick: dexModal }, `📖 Monster-dex (${d.unlocked.length}/${MONSTERS.length})`),
      h('button.btn.ghost', { onclick: rulesModal }, '❓ How to play'),
      h('button.btn.ghost', { onclick: statsModal }, '🏆 Stats'),
      h('span.ver', `v${v.version || '1.0.0'} · ${v.commit || 'dev'}`)));
  app.append(root);
  renderQuests(); renderFriends();
  if (!d.tutorialSeen) { d.tutorialSeen = true; App.profile.save(); setTimeout(rulesModal, 600); }
  clearInterval(App.homeT);
  App.homeT = setInterval(() => { if (App.screen === 'home') renderFriends(); else clearInterval(App.homeT); }, 8000);
}

function renderQuests() {
  const el = $('#questpanel'); if (!el) return;
  const d = P(); App.profile.dailyCheck();
  el.innerHTML = '';
  el.append(h('h3', '📜 Daily quests'));
  for (const q of d.quests.list) {
    const Q = QUEST_BY_ID[q.id];
    el.append(h('div.quest' + (q.done ? '.done' : ''), h('div.qt', h('span', (q.done ? '✅ ' : '') + Q.text), h('span', `${q.prog}/${Q.goal}`)), h('div.qbar', h('i', { style: { width: (q.prog / Q.goal * 100) + '%' } }))));
  }
  const ready = App.profile.chestReady();
  const chest = h('div.chest' + (ready ? '.ready' : ''), ready ? '🎁 DAILY CHEST READY! Tap to claim 2 loot packs' : d.quests.chest ? '✔ Chest claimed. New quests tomorrow!' : '🔒 Finish all 3 for a chest with 2 loot packs');
  if (ready) chest.addEventListener('click', () => { App.profile.claimChest(); sfx.levelUp(); const [x, y] = FX.centerOf(chest); FX.confetti(x, y, 60); showHome(); });
  el.append(chest);
  el.append(h('h3', { style: { marginTop: '16px' } }, '🕑 Recent rivals'));
  if (!d.recent.length) el.append(h('div.empty-note', 'Nobody yet. Go make some enemies!'));
  for (const r of d.recent.slice(0, 5)) {
    const isF = r.code && d.friends[r.code];
    el.append(h('div.frow', h('div.fav', { html: monsterSVG(avatarOf(r.av, r.code)) }), h('div.fi', h('b', r.name), h('small', r.won ? 'You won 🏆' : 'They won 😤')),
      !isF && r.code && r.code !== d.code ? h('button.btn.small.blue', { onclick: () => { const e = App.social.requestFriend(r.code); toast(e ? esc(e) : `Friend request sent to <b>${esc(r.name)}</b>`); refreshHome(); } }, '+ Friend') : null));
  }
}

function renderFriends() {
  const el = $('#friendpanel'); if (!el || !App.social) return;
  const d = P(), S = App.social;
  el.innerHTML = '';
  const addIn = h('input.field', { placeholder: 'FRIEND-1234', maxlength: 14 });
  const add = () => { const e = S.requestFriend(addIn.value); if (e) { sfx.nope(); toast(esc(e)); } else { sfx.buy(); toast(`Friend request sent to <b>${esc(cleanFriend(addIn.value))}</b>! It'll wait for them if they're offline.`); renderFriends(); } };
  addIn.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  el.append(h('h3', '👯 Friends'),
    h('div.fcode', h('span', { style: { fontSize: '12px', color: '#cdb8e6' } }, 'Your code'), h('b', d.code),
      h('button.btn.small.dark', { onclick: () => { copyText(d.code); toast('Friend code copied!', { ms: 1500 }); } }, 'Copy'),
      h('button.btn.small.dark', { onclick: () => shareLink(`${base()}?friend=${d.code}`, 'Add me on Battle Cards!') }, 'Link')),
    h('div.add-row', addIn, h('button.btn.small.green', { onclick: add }, 'Add')));
  for (const [code, r] of Object.entries(d.incoming)) {
    el.append(h('div.frow.req', h('div.fav', { html: monsterSVG(avatarOf(r.av, code)) }), h('div.fi', h('b', r.name), h('small', 'wants to be friends')),
      h('button.btn.small.green', { onclick: () => { S.acceptFriend({ code, ...r }); sfx.chime(); renderFriends(); } }, '✔'),
      h('button.btn.small.dark', { onclick: () => { S.declineFriend({ code }); renderFriends(); } }, '✕')));
  }
  const fr = Object.entries(d.friends).map(([code, f]) => ({ code, ...f, on: S.isOnline(code), st: (S.presence[code] || {}).status }));
  fr.sort((a, b) => (b.on - a.on) || (b.w + b.l) - (a.w + a.l));
  if (!fr.length) el.append(h('div.empty-note', 'No friends yet. Share your code, or add a recent rival!'));
  for (const f of fr) {
    const busy = f.on && f.st === 'dueling';
    el.append(h('div.frow', h('div.fav', { html: monsterSVG(avatarOf(f.av, f.code)) }, h('i.dot' + (busy ? '.busy' : f.on ? '.on' : ''))),
      h('div.fi', h('b', f.name), h('small', `${f.on ? (busy ? 'In a duel' : 'Online') : lastSeen(S.presence[f.code])} · you ${f.w}–${f.l}`)),
      h('button.btn.small' + (f.on && !busy ? '.gold' : '.dark'), { disabled: !f.on || busy, onclick: () => challenge(f) }, '⚔️'),
      h('button.btn.small.dark', { title: 'Remove', onclick: () => { if (confirm(`Unfriend ${f.name}?`)) { S.removeFriend(f.code); renderFriends(); } } }, '✕')));
  }
  for (const code of Object.keys(d.outgoing)) el.append(h('div.frow', { style: { opacity: 0.6 } }, h('div.fi', h('b', code), h('small', 'request sent…'))));
}
function lastSeen(p) {
  if (!p || !p.t) return 'Offline';
  const m = Math.floor((Date.now() - p.t) / 60000);
  return m < 60 ? `Seen ${m}m ago` : m < 1440 ? `Seen ${Math.floor(m / 60)}h ago` : `Seen ${Math.floor(m / 1440)}d ago`;
}
function shareLink(url, text) {
  if (navigator.share) navigator.share({ title: 'Battle Cards', text, url }).catch(() => { });
  else { copyText(url); toast('Link copied! Paste it to a friend.', { ms: 2000 }); }
}

// ================================================================ rooms
const helloOf = (extra = {}) => { const d = P(); return { name: d.name, av: d.avatar, code: d.code, lvl: d.level, title: TITLES[d.title], ...extra }; };
function cleanupNet() {
  leaveLobby();
  if (App.link) { App.link.close(); App.link = null; }
  if (App.mm) { App.mm.stop(); App.mm = null; }
}
function createRoom(inviteFriend) {
  cleanupNet();
  const room = genRoomCode();
  const link = new DuelLink(App.social.mesh, room, 'host', helloOf()).start();
  showLobby({ link, role: 'host', room, inviteFriend });
  if (inviteFriend) App.social.invite(inviteFriend.code, room);
}

// ================================================================ the lobby: house rules, then the duel
// The host picks starting Life Points, the round timer and any of the modifiers (rules.js), even while
// still waiting for a rival. The guest watches the rules change live and readies up; the host starts.
// Messages: host -> guest { t: 'cfg', cfg } and { t: 'go', seed, cfg }; guest -> host { t: 'lhello' } and { t: 'lready', on }.
const cfgWire = c => ({ lp: c.lp, time: c.time, mods: c.mods.slice() });
function leaveLobby() {
  const L = App.lobby;
  if (!L) return;
  for (const f of L.offs) f();
  clearInterval(L.helloT);
  App.lobby = null;
}
/** o: { link, role, rival (null while the host waits for one), room, inviteFriend, cfg (guest: last known rules) } */
function showLobby(o) {
  leaveLobby();
  const isHost = o.role === 'host', isBot = o.link instanceof BotLink;
  const L = App.lobby = { link: o.link, rival: o.rival || null, cfg: normCfg(isHost ? P().lobby : o.cfg), ready: isBot, offs: [], room: o.room || o.link.room };
  App.link = o.link;
  App.screen = 'lobby';
  App.social && App.social.setStatus('lobby');
  const send = m => L.link.send(m);
  const sendCfg = () => send({ t: 'cfg', cfg: cfgWire(L.cfg) });

  const onMsg = m => {
    if (App.lobby !== L) return;
    if (isHost) {
      if (m.t === 'lhello') sendCfg();
      if (m.t === 'lready') { L.ready = !!m.on; if (L.ready) sfx.chime(); paint(); }
    } else {
      if (m.t === 'cfg') {
        const was = JSON.stringify(L.cfg); L.cfg = normCfg(m.cfg); clearInterval(L.helloT);
        if (was !== JSON.stringify(L.cfg)) { if (L.ready) { L.ready = false; toast('The host changed the rules. Ready up again!', { ms: 1800 }); } sfx.pop(); paint(true); }
      }
      if (m.t === 'go') { const cfg = normCfg(m.cfg); leaveLobby(); startDuel(L.link, 'guest', L.rival, m.seed, cfg); }
    }
  };
  const onBye = () => {
    if (App.lobby !== L) return;
    if (!isHost) { leaveLobby(); cleanupNet(); showHome(); toast('The host closed the room.'); return; }
    // the rival left: reopen the same room for someone else
    toast(`${L.rival ? esc(L.rival.name) : 'Your rival'} left the lobby.`);
    L.rival = null; L.ready = false;
    L.link.close();
    attach(new DuelLink(App.social.mesh, L.room, 'host', helloOf()).start());
    paint();
  };
  const attach = link => {
    L.link = App.link = link;
    L.offs.push(link.on('msg', onMsg), link.on('bye', onBye));
    if (isHost && !isBot) L.offs.push(link.on('open', rival => { if (App.lobby !== L) return; L.rival = rival; L.ready = false; sfx.chime(); FX.confetti(innerWidth / 2, innerHeight * 0.3, 30); sendCfg(); paint(); }));
  };
  attach(o.link);
  if (!isHost) { send({ t: 'lhello' }); L.helloT = setInterval(() => send({ t: 'lhello' }), 3000); }
  if (isHost && L.rival) sendCfg();

  const change = next => {
    if (!isHost) { sfx.nope(); toast('Only the host can change the rules', { ms: 1400 }); return; }
    L.cfg = normCfg({ ...cfgWire(L.cfg), ...next });
    App.profile.data.lobby = cfgWire(L.cfg); App.profile.save();
    if (!isBot) L.ready = false;
    sendCfg();
    paint(true);
  };
  const start = () => {
    if (!L.rival || !L.ready) return;
    const seed = (Math.random() * 2 ** 31) | 0, cfg = L.cfg;
    send({ t: 'go', seed, cfg: cfgWire(cfg) });
    leaveLobby();
    startDuel(L.link, 'host', L.rival, seed, cfg);
  };
  const leave = () => { leaveLobby(); cleanupNet(); if (App.duel) { App.duel.destroy(); App.duel = null; } showHome(); };

  // ---- the screen
  const hdr = h('div.lb-hdr'), players = h('div.lb-players'), rules = h('div.lb-rules.panel'), foot = h('div.lb-foot');
  const app = $('#app'); app.innerHTML = '';
  app.append(h('div.screen', h('div.lobby2', h('h1.lb-title', 'DUEL LOBBY'), hdr, players, rules, foot)));
  if (isHost && L.room && !isBot) {
    const url = `${base()}?room=${L.room}`;
    hdr.append(
      h('div.lb-code', h('small', 'Room code'), h('b', L.room)),
      h('div.lb-share',
        h('button.btn.small.blue', { onclick: () => { copyText(L.room); toast('Code copied!', { ms: 1500 }); } }, '📋 Copy code'),
        h('button.btn.small.purple', { onclick: () => shareLink(url, 'Duel me in Battle Cards!') }, '🔗 Share link')));
  } else hdr.append(h('div.lb-code', h('small', isBot ? 'Practice room' : 'Room'), h('b', isBot ? 'BOT' : L.room || '')));

  const pcard = (info, tag, state, cls = '') => h('div.lb-p' + cls,
    h('div.lb-av', { html: monsterSVG(avatarOf(info.av, info.code)) }),
    h('b', info.name), h('small', tag), state ? h('div.lb-st', state) : null);
  function paint(flash) {
    if (App.lobby !== L) return;
    const me = helloOf(), rv = L.rival;
    // players
    players.innerHTML = '';
    const online = isHost && !rv && !isBot ? Object.entries(P().friends).filter(([c]) => App.social.isOnline(c) && (App.social.presence[c] || {}).status !== 'dueling') : [];
    players.append(
      pcard(me, `Lv ${me.lvl} · ${me.title || ''}`, isHost ? '👑 HOST' : L.ready ? 'READY ✔' : 'Not ready', isHost ? '.ok' : L.ready ? '.ok' : ''),
      h('div.lb-vs', 'VS'),
      rv ? pcard(rv, `Lv ${rv.lvl || 1} · ${rv.title || ''}`, isHost ? (L.ready ? 'READY ✔' : 'Reading the rules…') : '👑 HOST', isHost ? (L.ready ? '.ok' : '') : '.ok')
        : h('div.lb-p.empty',
          h('div.waiting-mons', ...['gary', 'chomp', 'meatball'].map((id, i) => h('div.lm', { style: { '--d': i * 0.15 + 's' }, html: monsterSVG(MON_BY_ID[id].art) }))),
          h('b', o.inviteFriend ? `Waiting for ${o.inviteFriend.name}…` : 'Waiting for a challenger…'),
          h('small', 'Send them the room code. Pick the rules while you wait!'),
          online.length ? h('div.lb-inv', ...online.map(([c, f]) => h('button.btn.small.gold', { onclick: e => { App.social.invite(c, L.room); e.target.textContent = `Sent to ${f.name}!`; e.target.disabled = true; sfx.chime(); } }, `⚔️ Invite ${f.name}`))) : null));
    // rules
    const c = L.cfg, est = estimate(c);
    const seg = (label, sub, opts, cur, show, key) => h('div.lb-row',
      h('div.lb-lbl', label, sub ? h('small', sub) : null),
      h('div.seg', ...opts.map(v => h('button.segb' + (v === cur ? '.on' : ''), { onclick: () => change({ [key]: v }) }, show(v)))));
    rules.innerHTML = '';
    rules.classList.toggle('ro', !isHost);
    rules.append(
      h('h3', '📜 House rules', h('span.lb-who', isHost ? 'you pick' : `${rv ? rv.name : 'the host'} picks`)),
      seg('❤ Starting Life Points', null, LP_OPTS, c.lp, v => fmt(v), 'lp'),
      seg('⏱ Time per round', `then ${c.shopSec}s in the shop`, TIME_OPTS.map(t => t[0]), c.time, v => v + 's', 'time'),
      h('div.lb-row', h('div.lb-lbl', `🎲 Modifiers`, h('small', `${c.mods.length} of ${MODS.length} on`)),
        isHost ? h('div.lb-quick',
          h('button.btn.small.ghost', { onclick: () => { const pool = MODS.map(m => m.id).sort(() => Math.random() - 0.5); change({ mods: pool.slice(0, 3) }); FX.confetti(innerWidth / 2, innerHeight / 2, 25); } }, '🎲 Surprise me'),
          h('button.btn.small.ghost', { onclick: () => change({ mods: MODS.map(m => m.id) }) }, '🤪 ALL OF THEM'),
          h('button.btn.small.ghost', { onclick: () => change({ ...DEFAULT_CFG }) }, '↺ Standard')) : null),
      h('div.modgrid', ...MODS.map(m => {
        const on = c.mods.includes(m.id);
        return h('button.modt' + (on ? '.on' : ''), { onclick: () => change({ mods: on ? c.mods.filter(x => x !== m.id) : [...c.mods, m.id] }) },
          h('div.mi', m.icon), h('div.mt', h('b', m.name), h('small', m.desc)), h('div.mk', on ? 'ON' : 'OFF'));
      })),
      h('div.lb-est', `≈ ${est.rounds} rounds · about ${est.mins} min`, est.mins > 30 ? h('span', ' (a long one!)') : null, isStandard(c) ? h('span', ' · standard rules') : null));
    if (flash) rules.animate([{ boxShadow: '0 0 0 4px #ffd43b' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 600 });
    // the big button
    foot.innerHTML = '';
    if (isHost) {
      const can = rv && L.ready;
      const b = h('button.btn.big.gold', { onclick: start, disabled: !can }, can ? '⚔️ START THE DUEL!' : rv ? `Waiting for ${rv.name} to ready up…` : 'Waiting for a rival…');
      if (can) b.style.animation = 'wiggle .8s infinite';
      foot.append(b);
    } else {
      foot.append(h('button.btn.big' + (L.ready ? '.green' : '.gold'), { onclick: () => { L.ready = !L.ready; send({ t: 'lready', on: L.ready }); if (L.ready) sfx.chime(); paint(); } },
        L.ready ? '✔ READY! (tap to wait)' : '✋ I\'M READY'));
    }
    foot.append(h('button.btn.ghost', { onclick: leave }, isHost ? 'Close room' : 'Leave'));
  }
  paint();
}
function challenge(f) { sfx.chime(); createRoom(f); }

function joinRoom(code, invite) {
  code = cleanRoom(code);
  if (code.length !== 5) { sfx.nope(); toast('Room codes are 5 numbers'); return; }
  cleanupNet();
  if (App.duel && App.duel.over) { App.duel.destroy(); App.duel = null; }
  const link = App.link = new DuelLink(App.social.mesh, code, 'guest', helloOf()).start();
  App.screen = 'joining';
  const app = $('#app'); app.innerHTML = '';
  app.append(h('div.screen', h('div.lobby', h('p.tagline', 'Knocking on room'), h('div.roomcode', code),
    h('div.waiting-mons', ...['bonk', 'blushbat', 'flusher'].map((id, i) => h('div.lm', { style: { '--d': i * 0.15 + 's' }, html: monsterSVG(MON_BY_ID[id].art) }))),
    h('p#joinmsg', { style: { color: '#cdb8e6' } }, App.social.mesh.up ? 'Knock knock…' : 'Connecting to the message servers…'),
    h('button.btn.ghost', { onclick: () => { cleanupNet(); showHome(); } }, 'Cancel'))));
  const giveUp = setTimeout(() => { if (App.link === link && !link.peer) { cleanupNet(); showHome(); toast(`Nobody answered at room ${code}. Check the code, or they might have left.`); } }, 25000);
  link.on('open', host => { clearTimeout(giveUp); showLobby({ link, role: 'guest', rival: host, room: code }); });
  link.on('full', () => { clearTimeout(giveUp); cleanupNet(); showHome(); toast('That duel already has two duelists. Three\'s a crowd!'); });
}

const SEARCH_LINES = ['Polishing monsters…', 'Shuffling aggressively…', 'Bribing gremlins…', 'Looking under the couch for rivals…', 'Asking the Sock Goblin for directions…', 'Warming up the shredder…', 'Counting to 4,000 Life Points…'];
function quickMatch() {
  cleanupNet();
  if (!App.social.mesh.up) toast('Still connecting… hang on.', { ms: 1500 });
  const mm = App.mm = new Matchmaker(App.social.mesh, App.profile);
  let hostLink = null;
  mm.on('host', (room, other) => {
    const seed = (Math.random() * 2 ** 31) | 0;
    hostLink = App.link = new DuelLink(App.social.mesh, room, 'host', helloOf({ seed })).start();
    hostLink.on('open', rival => { mm.matched(); mm.stop(); App.mm = null; startDuel(hostLink, 'host', rival, seed); });
  });
  mm.on('retry', () => { if (hostLink && !hostLink.peer) { hostLink.close(); hostLink = null; App.link = null; } });
  mm.on('join', room => {
    const link = App.link = new DuelLink(App.social.mesh, room, 'guest', helloOf()).start();
    link.on('open', host => { mm.stop(); App.mm = null; startDuel(link, 'guest', host, host.seed); });
    setTimeout(() => { if (App.link === link && !link.peer) { link.close(); App.link = null; mm.state = 'seeking'; } }, 10000);
  });
  mm.start();
  App.screen = 'search';
  App.social.setStatus('searching');
  const msg = h('p', { style: { color: '#e6d6f7', fontSize: '20px' } }, SEARCH_LINES[0]);
  let i = 0;
  const t = setInterval(() => { if (App.screen !== 'search') return clearInterval(t); msg.textContent = SEARCH_LINES[++i % SEARCH_LINES.length]; }, 2200);
  const app = $('#app'); app.innerHTML = '';
  app.append(h('div.screen', h('div.lobby',
    h('h1.logo', { style: { fontSize: '70px' } }, h('span', 'SEARCHING…')),
    h('div.waiting-mons', ...['wrangler', 'frog', 'hype', 'disco'].map((id, i) => h('div.lm', { style: { '--d': i * 0.12 + 's' }, html: monsterSVG(MON_BY_ID[id].art) }))),
    msg,
    h('p', { style: { color: '#cdb8e6', fontSize: '14px', maxWidth: '420px' } }, 'Quick Duel finds anyone else searching right now and plays the standard rules. Want modifiers, or nobody around? Make a room and send the code to a friend instead.'),
    h('button.btn.ghost', { onclick: () => { clearInterval(t); cleanupNet(); showHome(); } }, 'Cancel'))));
}

function devBotDuel() {
  cleanupNet();
  const seed = (Math.random() * 2 ** 31) | 0;
  const link = new BotLink(seed + 1);
  showLobby({ link, role: 'host', rival: { name: 'Test Bot', av: 'gary', code: 'BOT-0000', lvl: 1, title: 'Robot Menace' } });
}

// ================================================================ the duel
function startDuel(link, role, rival, seed, cfg) {
  if (App.duel) { App.duel.destroy(); App.duel = null; }
  App.screen = 'duel';
  const friendly = !!P().friends[rival.code];
  const duel = App.duel = new Duel(App, { link, role, me: helloOf(), rival, seed, friendly, cfg });
  duel.on('over', r => showResults(duel, r));
  duel.start();
}

async function showResults(duel, R) {
  App.screen = 'results';
  App.social && App.social.setStatus('menu');
  const { won, draw, note, summary, run, rival } = R;
  FX.setBgMood(won ? 'win' : 'lose');
  if (won) { sfx.victory(); setTimeout(() => FX.confetti(innerWidth / 2, innerHeight * 0.25, 120), 200); }
  else sfx.sadTrombone();
  const d = P();
  const isFriend = !!d.friends[rival.code];
  let mine = false, theirs = false;
  const rmBtn = h('button.btn.gold.big', { onclick: () => { if (mine) return; mine = true; duel.send({ t: 'rematch' }); updRm(); tryRestart(); } }, '⚔️ RUN IT BACK');
  const rmNote = h('div', { style: { color: '#ffd43b', fontWeight: 700, minHeight: '22px' } });
  const updRm = () => {
    rmBtn.textContent = mine ? (theirs ? 'Starting…' : 'Waiting for rival…') : theirs ? `⚔️ ${rival.name} WANTS A REMATCH!` : '⚔️ RUN IT BACK';
    rmBtn.disabled = mine; if (theirs && !mine) rmBtn.style.animation = 'wiggle .6s infinite';
    rmNote.textContent = theirs && !mine ? `${rival.name} is waiting… 👀` : '';
  };
  const tryRestart = () => {
    if (!(mine && theirs) || duel.role !== 'host') return;
    const seed = (Math.random() * 2 ** 31) | 0;
    duel.send({ t: 'restart', seed, cfg: cfgWire(duel.cfg) });
    restart(seed, duel.cfg);
  };
  const restart = (seed, cfg) => { const link = duel.link; duel.destroy(); App.duel = null; startDuel(link, duel.role, rival, seed, cfg || duel.cfg); };
  // back to the lobby to change the rules (the host decides; the guest follows)
  const toLobby = () => { const link = duel.link; duel.destroy(); App.duel = null; showLobby({ link, role: duel.role, rival, room: link.room, cfg: duel.cfg }); };
  duel.on('lobby', toLobby);
  duel.on('rematch', () => { theirs = true; sfx.chime(); updRm(); tryRestart(); });
  duel.on('restart', m => restart(m.seed, m.cfg && normCfg(m.cfg)));
  if (duel.link instanceof BotLink) theirs = true;
  const bar = h('i');
  const xpTxt = h('span', `Lv ${summary.before.level}`);
  const app = $('#app'); app.innerHTML = '';
  duel.clearCards();
  const best = run.stats.bestType ? `${fmt(run.stats.best)} (${HAND_BY_ID[run.stats.bestType].name})` : '—';
  app.append(h('div.screen', h('div.results',
    h('div.verdict.' + (draw ? 'draw' : won ? 'win' : 'lose'), draw ? 'DRAW?!' : won ? 'VICTORY!' : 'DEFEAT'),
    h('div.rsub', note),
    h('div.rstats',
      h('div', h('b', best), h('small', 'Best hand')),
      h('div', h('b', fmt(run.stats.dmgDealt)), h('small', 'Damage dealt')),
      h('div', h('b', `${run.stats.clashWins}/${R.rounds}`), h('small', 'Clashes won')),
      h('div', h('b', run.stats.sent), h('small', 'Gremlins sent')),
      h('div', h('b', run.stats.destroyed), h('small', 'Cards shredded'))),
    h('div.xpwrap', h('div.xl', xpTxt, h('span', `+${summary.total} XP`)), h('div.bigbar', bar), h('div', { style: { fontSize: '13px', color: '#cdb8e6', marginTop: '6px', textAlign: 'left' } }, summary.xpLines.filter(l => l[1]).map(([l, v]) => `${l} +${v}`).join(' · '))),
    h('div.rbtns', rmBtn,
      duel.role === 'host' && !R.forfeit ? h('button.btn.blue', { onclick: () => { duel.send({ t: 'lobby' }); toLobby(); } }, '⚙️ Change rules') : null,
      d.packs > 0 ? h('button.btn.purple', { onclick: openLoot }, `🎁 Loot pack (${d.packs})`) : null,
      !isFriend && rival.code && !rival.code.startsWith('BOT') ? h('button.btn.blue', { onclick: e => { const er = App.social.requestFriend(rival.code); toast(er ? esc(er) : 'Friend request sent!'); e.target.disabled = true; } }, '+ Add friend') : null,
      h('button.btn.ghost', { onclick: () => { duel.destroy(); App.duel = null; cleanupNet(); showHome(); } }, 'Menu')),
    rmNote,
    summary.streak > 1 ? h('div', { style: { color: '#ffb347', fontWeight: 700 } }, `🔥 ${summary.streak}-day streak! Come back tomorrow to keep it going.`) : null)));
  updRm();
  // fill the XP bar, levelling up along the way
  await sleep(600);
  let lvl = summary.before.level, xp = summary.before.xp, left = summary.total;
  while (left > 0) {
    const need = xpNeed(lvl), take = Math.min(left, need - xp);
    bar.animate([{ width: (xp / need * 100) + '%' }, { width: ((xp + take) / need * 100) + '%' }], { duration: 700, easing: 'ease-out', fill: 'forwards' });
    sfx.chip(Math.min(15, lvl));
    await sleep(750);
    xp += take; left -= take;
    if (xp >= need) {
      lvl++; xp = 0; xpTxt.textContent = `Lv ${lvl}`;
      const up = summary.ups.find(u => u.level === lvl);
      sfx.levelUp(); FX.confetti(innerWidth / 2, innerHeight / 2, 70); FX.shout(`LEVEL ${lvl}!`, { color: '#ffd43b', size: 100, sub: up ? rewardText(up.reward) : '' , ms: 1800 });
      await sleep(1300);
    }
  }
  for (const u of summary.ups) if (u.reward.kind === 'mon') { await rewardModal(u.reward, `Level ${u.level} reward`); }
}
function rewardText(rw) {
  if (rw.kind === 'mon') return `New monster unlocked: ${MON_BY_ID[rw.id].name}!`;
  if (rw.kind === 'back') return `New card back: ${BACKS[rw.id].name}`;
  if (rw.kind === 'title') return `New title: ${TITLES[rw.id]}`;
  if (rw.kind === 'emote') return `New taunt: ${EMOTES[rw.id].e} ${EMOTES[rw.id].text}`;
  if (rw.kind === 'pack') return 'A bonus loot pack!';
  if (rw.kind === 'xp') return `+${rw.n} XP`;
  return '';
}
function rewardModal(rw, title) {
  return new Promise(res => modal(m => {
    const d = MON_BY_ID[rw.id];
    m.append(h('h2', title), h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, h('div', { style: { width: '130px', height: '130px', flex: 'none' }, html: monsterSVG(d.art) }),
      h('div', h('div', { style: { fontWeight: 700, fontSize: '22px' } }, d.name), h('div', { style: { color: RARITY[d.rar].color, fontWeight: 700, fontSize: '13px', textTransform: 'uppercase' } }, RARITY[d.rar].name),
        h('div.desc', { html: typeof d.desc === 'function' ? d.desc({ st: { mult: 20, chips: 100, x: 1 } }) : d.desc }), h('div', { style: { fontStyle: 'italic', color: '#7a6a88' } }, `“${d.quip}”`))),
      h('p', 'It can show up in your shop now.'));
    sfx.reveal(d.rar);
  }, { onClose: res }));
}

// ================================================================ loot packs
function openLoot() {
  const r = App.profile.openLoot();
  if (!r) return;
  sfx.packOpen();
  modal((m, close) => {
    m.append(h('h2', '🎁 Loot pack!'), h('p', 'Tap the cards to flip them.'));
    const row = h('div.loot');
    let flipped = 0;
    r.out.forEach((rw, i) => {
      const color = RARITY[rw.rar] ? RARITY[rw.rar].color : '#999';
      let art, name, kind;
      if (rw.kind === 'mon') { art = h('div.la', { html: monsterSVG(MON_BY_ID[rw.id].art) }); name = MON_BY_ID[rw.id].name; kind = 'New monster!'; }
      else if (rw.kind === 'back') { art = h('div.la', { style: { position: 'relative', '--cw': '70px', width: '70px', height: '98px' }, html: backHTML(rw.id) }); name = BACKS[rw.id].name; kind = 'Card back'; }
      else if (rw.kind === 'emote') { art = h('div.la', EMOTES[rw.id].e); name = EMOTES[rw.id].text; kind = 'Taunt'; }
      else if (rw.kind === 'title') { art = h('div.la', '🏷️'); name = TITLES[rw.id]; kind = 'Title'; }
      else { art = h('div.la', '⭐'); name = `+${rw.n} XP`; kind = 'Experience'; }
      const c = h('div.lcard', { style: { '--rc': color } }, h('div.lb', '?'), h('div.lf', art, h('small', { style: { color } }, kind), h('b', name)));
      c.addEventListener('click', () => {
        if (c.classList.contains('open')) return;
        c.classList.add('open'); flipped++;
        sfx.reveal(rw.rar || 1);
        const [x, y] = FX.centerOf(c);
        if ((rw.rar || 1) >= 3) { FX.confetti(x, y, 60); FX.flash(color, 300); FX.shake(1.5); }
        else FX.sparks(x, y, 16);
        if (flipped === 3) { done.disabled = false; }
      });
      c.animate([{ transform: 'translateY(-200px) rotate(-30deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: i * 150, easing: 'cubic-bezier(.2,1.4,.4,1)', fill: 'backwards' });
      row.append(c);
    });
    const done = h('button.btn.gold', { disabled: true, onclick: () => { close(); for (const u of r.ups) FX.shout(`LEVEL ${u.level}!`, { color: '#ffd43b', size: 90, sub: rewardText(u.reward) }); if (App.screen === 'home') showHome(); } }, 'Sweet!');
    m.append(row, h('div', { style: { textAlign: 'center' } }, done, P().packs > 0 ? h('button.btn.purple', { style: { marginLeft: '10px' }, onclick: () => { close(); openLoot(); } }, `Next pack (${P().packs})`) : null));
  }, { wide: true, onClose: () => { if (App.screen === 'home') showHome(); } });
}

// ================================================================ modals: dex, rules, profile, settings, stats
function dexModal() {
  const d = P();
  modal(m => {
    m.append(h('h2', `📖 Monster-dex: ${d.unlocked.length}/${MONSTERS.length}`), h('p', { style: { marginTop: 0 } }, 'Unlock monsters by levelling up, opening loot packs and finding NEW ones in Monster Packs. Only unlocked monsters show up in your shop.'));
    const detail = h('div.dexdetail', h('div', 'Tap a monster.'));
    const grid = h('div.dex');
    for (const mon of [...MONSTERS].sort((a, b) => a.rar - b.rar)) {
      const has = d.unlocked.includes(mon.id);
      const cell = h('div.dexcell' + (has ? '' : '.locked'), { style: { '--rc': RARITY[mon.rar].color } }, h('div.da', { html: monsterSVG(mon.art) }), h('b', has ? mon.name : '???'), h('small', RARITY[mon.rar].name + (d.seen[mon.id] ? ` · used ${d.seen[mon.id]}×` : '')));
      cell.addEventListener('click', () => {
        sfx.select(2);
        detail.innerHTML = '';
        detail.append(h('div.da', { html: monsterSVG(mon.art), style: has ? {} : { filter: 'brightness(0) opacity(.4)' } }), h('div', { html: has ? monTipHTML({ id: mon.id }) : `<div class="tn">???</div><div class="tr" style="color:${RARITY[mon.rar].color}">${RARITY[mon.rar].name}</div><div class="desc">Not discovered yet. ${mon.rar === 4 ? 'Legendaries only turn up in Monster Packs and loot packs.' : 'Level up or open packs to find it.'}</div>` }));
      });
      grid.append(cell);
    }
    m.append(detail, grid);
  }, { wide: true });
}
function rulesModal() {
  modal(m => {
    m.append(h('h2', '❓ How to duel'), h('div.rules', { html: `
      <p><b>Two duelists, 4,000 Life Points each.</b> Every round you both play poker hands at the same time on your own screens. Biggest total wins the clash, and the loser's Life Points take the hit. Hit zero and you're out. A duel takes about 15 minutes.</p>
      <p><b>House rules:</b> when you make a room, you pick the starting Life Points (2,000 to 8,000), the time per round (45 to 150 seconds) and any of 10 modifiers in the lobby: Money Rain, Gremlin Frenzy, Glass Cannons, Big Hands, Heart Overdrive, Shredder Party, Boss Rush, Chaos Deck, Lucky Sevens and Vampire Bites. Quick Duel always plays the standard rules.</p>
      <h4>⚔️ A round</h4>
      <ul><li>You get <b>4 hands</b> and <b>3 discards</b> in 90 seconds (or whatever the room set). Pick up to 5 cards and play them.</li>
      <li>Each hand scores <b class="c">Chips</b> × <b class="m">Mult</b>. Better poker hands start higher, and each scoring card adds its chips.</li>
      <li>Your round <b>ATK</b> is all your hands added up. You can see your rival's climbing live.</li>
      <li>When both of you are done: <b>CLASH!</b> The bigger ATK wins. The more you beat them by, the harder it hits (up to 2.25×). The winner's monsters also shred a card out of the loser's deck. Forever.</li>
      <li>Every 3rd round is a <b>Boss Clash</b> with a nasty rule for both of you. From round 10 it's <b>Sudden Death</b>: double damage.</li></ul>
      <h4>👾 Monsters</h4>
      <ul><li>Monsters sit in your 5 Monster Zones and boost every hand. They trigger <b>left to right</b>, so order matters (click one to move or sell it).</li>
      <li>Buy them in the shop between rounds. Monster Packs can hold ones you've never seen.</li></ul>
      <h4>✨ Spells, tomes and traps</h4>
      <ul><li><b>Tomes</b> level up a poker hand. <b>Spells</b> change cards in your hand (select the cards first). <b>Traps</b> are set face down and spring on your rival.</li></ul>
      <h4>😈 The Gremlin Gate</h4>
      <ul><li>During a round, spend gold to send gremlins at your rival: shred their cards, ink them face down, glue them, steal a discard or a whole hand.</li>
      <li>Every gremlin you send also raises your <b>eco</b>: extra gold every round. Spend now, earn later.</li>
      <li>Finished early? Your rival isn't. Gremlin time.</li></ul>
      <h4>💰 Gold</h4>
      <ul><li>$5 a round, plus <b>interest</b> ($1 for every $5 you hold, up to $5), plus eco. Losing a clash pays a comeback bonus; trailing gets a free reroll.</li></ul>
      <h4>💖 Heart of the Cards</h4>
      <ul><li>Taking damage fills your heart. When it's full, <b>believe</b>: your hand becomes the best hand hiding in your deck, and it scores ×2 Mult.</li></ul>
      <h4>⌨️ Keys</h4>
      <ul><li><b>1–9</b> pick cards · <b>Enter</b> play · <b>D</b> discard · <b>S</b> sort · <b>H</b> heart · <b>Esc</b> clear</li></ul>` }));
  }, { wide: true });
}
function profileModal() {
  const d = P();
  modal((m, close) => {
    const name = h('input.field', { value: d.name, maxlength: 16, style: { width: '100%' } });
    let av = d.avatar;
    const grid = h('div.avpick');
    const drawAv = () => { grid.innerHTML = ''; for (const id of d.unlocked) grid.append(h('button' + (id === av ? '.on' : ''), { onclick: () => { av = id; drawAv(); }, html: monsterSVG(MON_BY_ID[id].art), title: MON_BY_ID[id].name })); };
    drawAv();
    const titles = h('div.choice-row');
    let title = d.title;
    const drawT = () => { titles.innerHTML = ''; for (const t of d.titles) titles.append(h('button' + (t === title ? '.on' : ''), { onclick: () => { title = t; drawT(); } }, TITLES[t])); };
    drawT();
    const backs = h('div.backs');
    let back = d.back;
    const drawB = () => { backs.innerHTML = ''; for (const b of Object.keys(BACKS)) { const has = d.backs.includes(b); backs.append(h('div.bk' + (b === back ? '.on' : '') + (has ? '' : '.locked'), { title: BACKS[b].name + (has ? '' : ' (locked)'), html: backHTML(b), onclick: () => { if (has) { back = b; drawB(); } } })); } };
    drawB();
    m.append(h('h2', 'Your duelist'), h('b', 'Name'), name, h('p', h('b', 'Mascot'), ' (any monster you\'ve unlocked)'), grid, h('p', h('b', 'Title')), titles, h('p', h('b', 'Card back')), backs,
      h('div', { style: { marginTop: '16px', textAlign: 'right' } }, h('button.btn.green', { onclick: () => {
        const n = name.value.trim().slice(0, 16); if (n) d.name = n;
        d.avatar = av; d.title = title; d.back = back; App.profile.save(); App.social.announce(); close(); showHome();
      } }, 'Save')));
  });
}
function settingsModal() {
  modal(m => {
    const st = audioState();
    const row = (label, on, fn) => { const b = h('button.btn.small' + (on ? '.green' : '.dark'), { onclick: () => { on = !on; fn(on); b.className = 'btn small ' + (on ? 'green' : 'dark'); b.textContent = on ? 'On' : 'Off'; } }, on ? 'On' : 'Off'); return h('div.settings-row', h('span', label), b); };
    m.append(h('h2', '⚙️ Settings'), row('Sound effects', st.sfx, setSfx), row('Music', st.music, setMusic),
      h('div.settings-row', h('span', 'Your friend code'), h('b', P().code)),
      h('p', { style: { fontSize: '13px', color: '#7a6a88' } }, 'Battle Cards has no game server. Duels, friends and invites travel through free public message servers (MQTT), so what goes through them (names, scores) isn\'t private. Your progress is saved in this browser only.'));
  });
}
function statsModal() {
  const s = P().stats;
  modal(m => {
    m.append(h('h2', '🏆 Your stats'));
    const rows = [['Duels', s.duels], ['Wins', s.wins], ['Losses', s.losses], ['Win rate', s.duels ? Math.round(s.wins / s.duels * 100) + '%' : '—'], ['Best win streak', s.bestWinStreak], ['Best hand ever', s.bestHand ? `${fmt(s.bestHand)} (${HAND_BY_ID[s.bestHandType] ? HAND_BY_ID[s.bestHandType].name : ''})` : '—'], ['Clashes won', s.clashWins], ['Gremlins sent', s.sent], ['Damage dealt', fmt(s.dmg)], ['Longest daily streak', P().streak.best]];
    for (const [k, v] of rows) m.append(h('div.settings-row', h('span', k), h('b', String(v))));
  });
}

boot();

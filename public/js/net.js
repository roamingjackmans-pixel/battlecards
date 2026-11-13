// Friends, presence, invites, room codes, quick match and the duel connection, all over the Mesh.
//
// Topics (under jjgames/battlecards-v1/):
//   u/<friend code>/p          presence, retained: {name, av, status, t}
//   u/<friend code>/rq/<from>  friend requests and acceptances, retained until handled (so they wait for you)
//   u/<friend code>/in         invites to a duel (only while you're online)
//   r/<room>/h  r/<room>/g      a duel: messages to the host and to the guest
//   q                           quick match: people looking for a rival
import { Mesh } from './mqtt.js';
import { Emitter, randomId } from './util.js';

const ROOT = 'jjgames/battlecards-v1/';
export const T = {
  pres: c => `${ROOT}u/${c}/p`, req: (c, from) => `${ROOT}u/${c}/rq/${from}`, reqAll: c => `${ROOT}u/${c}/rq/+`,
  inbox: c => `${ROOT}u/${c}/in`, host: r => `${ROOT}r/${r}/h`, guest: r => `${ROOT}r/${r}/g`, queue: `${ROOT}q2`,
};
export const ONLINE_MS = 75000;

export function genRoomCode() {
  const a = new Uint32Array(5); crypto.getRandomValues(a);
  let c = String(1 + (a[0] % 9));
  for (let i = 1; i < 5; i++) c += String(a[i] % 10);
  return c;
}
export const cleanRoom = c => String(c || '').replace(/\D/g, '').slice(0, 5);
export const cleanFriend = c => String(c || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 14);

/**
 * The social side. Events:
 *  status(n)            how many message servers we're connected to
 *  presence(code, p)    a friend's presence changed
 *  request(r)           someone wants to be friends: {code, name, av}
 *  accepted(r)          they said yes: {code, name, av}
 *  invite(i)            a duel invite: {code, name, av, room}
 *  declined(code)       a friend said no to your invite
 */
export class Social extends Emitter {
  constructor(profile) {
    super();
    this.p = profile;
    this.mesh = new Mesh();
    this.presence = {};
    this.status = 'menu';
    this.mesh.on('msg', (t, m) => this._msg(t, m));
    this.mesh.on('status', n => this.emit('status', n));
  }
  start() {
    const c = this.p.data.code;
    this.mesh.sub(T.reqAll(c));
    this.mesh.sub(T.inbox(c));
    for (const f of Object.keys(this.p.data.friends)) this.mesh.sub(T.pres(f));
    this.mesh.start();
    this.announce();
    this._presTimer = setInterval(() => this.announce(), 25000);
    addEventListener('pagehide', () => this.announce('offline'));
    return this;
  }
  announce(status) {
    if (status) this.status = status;
    const d = this.p.data;
    this.mesh.pub(T.pres(d.code), { name: d.name, av: d.avatar, status: this.status, lvl: d.level, t: Date.now() }, true);
  }
  setStatus(s) { if (s !== this.status) this.announce(s); }
  isOnline(code) { const p = this.presence[code]; return !!p && p.status !== 'offline' && Date.now() - p.t < ONLINE_MS; }

  // friends
  requestFriend(code) {
    const d = this.p.data;
    code = cleanFriend(code);
    if (!/^[A-Z]+-\d{4}$/.test(code)) return 'Friend codes look like GOOBER-1234';
    if (code === d.code) return 'That\'s you! Making friends with yourself is healthy, but not here.';
    if (d.friends[code]) return 'You\'re already friends!';
    d.outgoing[code] = Date.now(); this.p.save();
    this.mesh.pub(T.req(code, d.code), { t: 'freq', code: d.code, name: d.name, av: d.avatar, at: Date.now() }, true);
    return null;
  }
  acceptFriend(r) {
    const d = this.p.data;
    this.p.addFriend(r.code, r.name, r.av);
    delete d.incoming[r.code]; this.p.save();
    this.mesh.clear(T.req(d.code, r.code));
    this.mesh.pub(T.req(r.code, d.code), { t: 'facc', code: d.code, name: d.name, av: d.avatar, at: Date.now() }, true);
    this.mesh.sub(T.pres(r.code));
  }
  declineFriend(r) {
    const d = this.p.data;
    delete d.incoming[r.code]; this.p.save();
    this.mesh.clear(T.req(d.code, r.code));
  }
  removeFriend(code) {
    this.p.removeFriend(code);
    this.mesh.unsub(T.pres(code));
  }
  invite(code, room) {
    const d = this.p.data;
    this.mesh.pub(T.inbox(code), { t: 'inv', code: d.code, name: d.name, av: d.avatar, room, at: Date.now() });
  }
  declineInvite(i) { this.mesh.pub(T.inbox(i.code), { t: 'invno', code: this.p.data.code, at: Date.now() }); }

  _msg(topic, m) {
    const d = this.p.data;
    if (topic.startsWith(`${ROOT}u/`) && topic.endsWith('/p')) {
      const code = topic.split('/')[3];
      this.presence[code] = m;
      if (d.friends[code] && (d.friends[code].name !== m.name || d.friends[code].av !== m.av)) { d.friends[code].name = m.name; d.friends[code].av = m.av; this.p.save(); }
      this.emit('presence', code, m);
      return;
    }
    if (topic.startsWith(T.req(d.code, ''))) {
      if (!m.code || m.code === d.code) return;
      if (m.t === 'freq') {
        if (d.friends[m.code]) { this.mesh.clear(topic); return; }
        if (d.outgoing[m.code]) { this.acceptFriend(m); this.emit('accepted', m); return; }   // we both asked
        d.incoming[m.code] = { name: m.name, av: m.av, at: m.at }; this.p.save();
        this.emit('request', m);
      } else if (m.t === 'facc') {
        this.mesh.clear(topic);
        if (d.friends[m.code]) return;
        delete d.outgoing[m.code];
        this.p.addFriend(m.code, m.name, m.av);
        this.mesh.sub(T.pres(m.code));
        this.emit('accepted', m);
      }
      return;
    }
    if (topic === T.inbox(d.code)) {
      if (m.t === 'inv' && Date.now() - (m.at || 0) < 90000) this.emit('invite', m);
      if (m.t === 'invno') this.emit('declined', m.code);
    }
  }
}

/**
 * The connection for one duel, host or guest. Reliable in-order-ish delivery on top of the mesh:
 * important messages get a sequence number and are re-sent until the other side acks them.
 * Events: open(peerHello), msg(m), lost(), back(), full()
 */
export class DuelLink extends Emitter {
  constructor(mesh, room, role, hello) {
    super();
    this.mesh = mesh; this.room = room; this.role = role; this.hello = hello;
    this.me = randomId(10); this.peer = null;
    this.seq = 0; this.pending = new Map(); this.got = new Set(); this.lastIn = 0; this.isLost = false;
    this.inT = role === 'host' ? T.host(room) : T.guest(room);
    this.outT = role === 'host' ? T.guest(room) : T.host(room);
    this._onMsg = (t, m) => { if (t === this.inT) this._in(m); };
    mesh.on('msg', this._onMsg);
  }
  start() {
    this.mesh.sub(this.inT);
    if (this.role === 'guest') {
      const knock = () => { if (!this.peer) this.mesh.pub(this.outT, { t: 'knock', from: this.me, hello: this.hello }); };
      knock(); this._knock = setInterval(knock, 1500);
    }
    this._resend = setInterval(() => {
      const now = Date.now();
      for (const [s, p] of this.pending) if (now - p.at > 1200) { p.at = now; this._raw(p.m); }
      if (this.peer) {
        this._raw({ t: 'ping', at: now });
        const quiet = now - this.lastIn;
        if (quiet > 9000 && !this.isLost) { this.isLost = true; this.emit('lost'); }
      }
    }, 700);
    return this;
  }
  close() {
    clearInterval(this._knock); clearInterval(this._resend);
    if (this.peer) this._raw({ t: 'bye' });
    this.mesh.unsub(this.inT);
    this.mesh._h.msg = (this.mesh._h.msg || []).filter(f => f !== this._onMsg);
    this.closed = true;
  }
  send(m, reliable = true) {
    if (reliable) { m = { ...m, s: ++this.seq }; this.pending.set(m.s, { m, at: Date.now() }); }
    this._raw(m);
  }
  _raw(m) { this.mesh.pub(this.outT, { ...m, from: this.me, to: this.peer }); }
  _in(m) {
    if (this.closed || !m || m.from === this.me) return;
    if (m.t === 'knock') {
      if (this.role !== 'host') return;
      if (this.peer && this.peer !== m.from) { this.mesh.pub(this.outT, { t: 'full', to: m.from, from: this.me }); return; }
      if (!this.peer) { this.peer = m.from; this.lastIn = Date.now(); this.mesh.pub(this.outT, { t: 'welcome', to: m.from, from: this.me, hello: this.hello }); this.emit('open', m.hello); }
      else this.mesh.pub(this.outT, { t: 'welcome', to: m.from, from: this.me, hello: this.hello });
      return;
    }
    if (m.to && m.to !== this.me) return;
    if (m.t === 'full') { if (!this.peer) { clearInterval(this._knock); this.emit('full'); } return; }
    if (m.t === 'welcome') {
      if (this.role !== 'guest') return;
      if (!this.peer) { this.peer = m.from; clearInterval(this._knock); this.lastIn = Date.now(); this.emit('open', m.hello); }
      return;
    }
    if (!this.peer || m.from !== this.peer) return;
    this.lastIn = Date.now();
    if (this.isLost) { this.isLost = false; this.emit('back'); }
    if (m.t === 'ping') return;
    if (m.t === 'bye') { this.emit('bye'); return; }
    if (m.t === 'ack') { this.pending.delete(m.a); return; }
    if (m.s) {
      this._raw({ t: 'ack', a: m.s });
      if (this.got.has(m.s)) return;
      this.got.add(m.s);
    }
    this.emit('msg', m);
  }
}

/** Quick match: everyone looking publishes "seek"; the one with the bigger id invites the smaller. */
export class Matchmaker extends Emitter {
  constructor(mesh, profile) {
    super();
    this.mesh = mesh; this.p = profile; this.id = randomId(12); this.state = 'idle';
    this._onMsg = (t, m) => { if (t === T.queue) this._in(m); };
    mesh.on('msg', this._onMsg);
  }
  start() {
    this.state = 'seeking'; this.mesh.sub(T.queue);
    const say = () => { if (this.state === 'seeking') this.mesh.pub(T.queue, { t: 'seek', id: this.id, name: this.p.data.name, lvl: this.p.data.level, at: Date.now() }); };
    say(); this._t = setInterval(say, 2000);
  }
  stop() {
    this.state = 'idle'; clearInterval(this._t); clearTimeout(this._offerT);
    this.mesh.unsub(T.queue);
    this.mesh._h.msg = (this.mesh._h.msg || []).filter(f => f !== this._onMsg);
  }
  _in(m) {
    if (m.id === this.id || Date.now() - (m.at || 0) > 15000) return;
    if (m.t === 'seek' && this.state === 'seeking' && m.id < this.id) {
      this.state = 'offering';
      const room = genRoomCode();
      this.mesh.pub(T.queue, { t: 'offer', id: this.id, to: m.id, room, name: this.p.data.name, at: Date.now() });
      this.emit('host', room, m);
      this._offerT = setTimeout(() => { if (this.state === 'offering') { this.state = 'seeking'; this.emit('retry'); } }, 9000);
    } else if (m.t === 'offer' && m.to === this.id && this.state === 'seeking') {
      this.state = 'matched';
      this.emit('join', m.room, m);
    }
  }
  matched() { this.state = 'matched'; clearTimeout(this._offerT); }
}

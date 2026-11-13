// Just enough MQTT 3.1.1 over secure websockets to talk through free public message servers
// (the same servers and the same tiny client as Horse Race, The Deck and Lieage use for their relay).
// Battle Cards uses them for everything: duels, friends, presence and invites. There is no game server.
//
// Mesh connects to every server at once, publishes on all of them and drops the duplicates it hears
// back, so a duel keeps going if one server hiccups.
import { Emitter, randomId } from './util.js';

export const BROKERS = [
  { name: 'emqx', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'hivemq', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'shiftr', url: 'wss://public.cloud.shiftr.io', user: 'public', pass: 'public' },
];
const KEEPALIVE = 30;
const te = new TextEncoder(), td = new TextDecoder();
const mstr = s => { const b = te.encode(s); const out = new Uint8Array(b.length + 2); out[0] = b.length >> 8; out[1] = b.length & 255; out.set(b, 2); return out; };
function packet(type, parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const head = [type];
  let n = len;
  do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; head.push(d); } while (n);
  const out = new Uint8Array(head.length + len);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

class Link {
  constructor(broker, onMessage, onClose) {
    this.broker = broker; this.onMessage = onMessage; this.onClose = onClose;
    this.ready = false; this.closed = false; this._buf = new Uint8Array(0); this._subs = new Map(); this._nextId = 1;
  }
  connect(ms = 9000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = err => { if (settled) return; settled = true; clearTimeout(timer); if (err) { this._kill(); reject(err); } else resolve(this); };
      const timer = setTimeout(() => done(new Error(this.broker.name + ': timed out')), ms);
      let ws;
      try { ws = new WebSocket(this.broker.url, 'mqtt'); } catch (e) { done(e); return; }
      this.ws = ws; ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const b = this.broker;
        const parts = [mstr('MQTT'), Uint8Array.of(4, b.user ? 0xc2 : 0x02, 0, KEEPALIVE), mstr('jjbc-' + randomId(10))];
        if (b.user) parts.push(mstr(b.user), mstr(b.pass || ''));
        this._raw(packet(0x10, parts));
      };
      ws.onmessage = e => this._onData(new Uint8Array(e.data), done);
      ws.onerror = () => done(new Error(this.broker.name + ': could not connect'));
      ws.onclose = () => {
        done(new Error(this.broker.name + ': closed'));
        const was = this.ready; this.ready = false; clearInterval(this._ping);
        if (was && !this.closed) { this.closed = true; this.onClose && this.onClose(this); }
      };
    });
  }
  subscribe(topic) {
    const id = (this._nextId++ & 0xffff) || 1;
    this._raw(packet(0x82, [Uint8Array.of(id >> 8, id & 255), mstr(topic), Uint8Array.of(0)]));
  }
  unsubscribe(topic) {
    const id = (this._nextId++ & 0xffff) || 1;
    this._raw(packet(0xa2, [Uint8Array.of(id >> 8, id & 255), mstr(topic)]));
  }
  publish(topic, text, retain = false) {
    if (!this.ready) return false;
    this._raw(packet(retain ? 0x31 : 0x30, [mstr(topic), te.encode(text)]));
    return true;
  }
  close() { if (this.closed) return; this.closed = true; if (this.ready) this._raw(Uint8Array.of(0xe0, 0)); this._kill(); }
  _kill() { this.ready = false; clearInterval(this._ping); try { this.ws && this.ws.close(); } catch { } }
  _raw(bytes) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(bytes); } catch { } }
  _onData(chunk, connected) {
    const buf = new Uint8Array(this._buf.length + chunk.length);
    buf.set(this._buf, 0); buf.set(chunk, this._buf.length);
    let at = 0;
    for (;;) {
      if (buf.length - at < 2) break;
      let len = 0, mul = 1, i = at + 1, ok = false;
      for (let k = 0; k < 4 && i < buf.length; k++, i++) { len += (buf[i] & 127) * mul; mul *= 128; if (!(buf[i] & 128)) { ok = true; i++; break; } }
      if (!ok || buf.length - i < len) break;
      this._handle(buf[at], buf.subarray(i, i + len), connected);
      at = i + len;
    }
    this._buf = buf.slice(at);
  }
  _handle(b0, body, connected) {
    switch (b0 >> 4) {
      case 2:
        if (body[1] === 0) { this.ready = true; this._ping = setInterval(() => this._raw(Uint8Array.of(0xc0, 0)), 15000); connected(null); }
        else connected(new Error(this.broker.name + ': refused'));
        break;
      case 3: {
        const qos = (b0 >> 1) & 3;
        const tlen = (body[0] << 8) | body[1];
        const topic = td.decode(body.subarray(2, 2 + tlen));
        const payload = td.decode(body.subarray(2 + tlen + (qos ? 2 : 0)));
        try { this.onMessage(this, topic, payload); } catch (e) { console.error(e); }
        break;
      }
    }
  }
}

/** Connected to every server; publishes on all, delivers each message once. Events: msg(topic, obj), status(n). */
export class Mesh extends Emitter {
  constructor() {
    super();
    this.links = new Set(); this.topics = new Set(); this.seen = new Map(); this.queue = []; this.stopped = false;
    this.id = randomId(10);
  }
  get up() { return this.links.size; }
  start() { for (const b of BROKERS) this._keep(b, 0); return this; }
  stop() { this.stopped = true; for (const l of this.links) l.close(); this.links.clear(); }
  async _keep(broker, tries) {
    if (this.stopped) return;
    let again = false;
    const retry = (ms, n) => { if (again || this.stopped) return; again = true; setTimeout(() => this._keep(broker, n), ms); };
    const link = new Link(broker, (l, t, p) => this._in(t, p), l => { this.links.delete(l); this.emit('status', this.up); retry(1500, 0); });
    try {
      await link.connect();
      if (this.stopped) { link.close(); return; }
      for (const t of this.topics) link.subscribe(t);
      this.links.add(link);
      this.emit('status', this.up);
      if (this.queue.length) { const q = this.queue; this.queue = []; for (const [t, s, r] of q) this._out(t, s, r); }
    } catch {
      link.close();
      retry(Math.min(30000, 2000 * 2 ** tries), tries + 1);
    }
  }
  sub(topic) { if (this.topics.has(topic)) return; this.topics.add(topic); for (const l of this.links) l.subscribe(topic); }
  unsub(topic) { if (!this.topics.delete(topic)) return; for (const l of this.links) l.unsubscribe(topic); }
  pub(topic, obj, retain = false) {
    const text = JSON.stringify({ ...obj, _m: this.id + '.' + (++this._n || (this._n = 1)) });
    this._out(topic, text, retain);
  }
  /** Removes a retained message. */
  clear(topic) { for (const l of this.links) l.publish(topic, '', true); }
  _out(topic, text, retain) {
    let sent = false;
    for (const l of this.links) sent = l.publish(topic, text, retain) || sent;
    if (!sent) { this.queue.push([topic, text, retain]); if (this.queue.length > 60) this.queue.shift(); }
  }
  _in(topic, text) {
    if (!text) { this.emit('cleared', topic); return; }
    let obj;
    try { obj = JSON.parse(text); } catch { return; }
    if (!obj || typeof obj !== 'object') return;
    const key = topic + '|' + obj._m;
    if (obj._m) {
      if (this.seen.has(key)) return;
      this.seen.set(key, Date.now());
      if (this.seen.size > 3000) { const cut = Date.now() - 120000; for (const [k, t] of this.seen) if (t < cut) this.seen.delete(k); }
    }
    this.emit('msg', topic, obj);
  }
}

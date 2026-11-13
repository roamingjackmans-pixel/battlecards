// Everything is drawn in code: monsters are little SVGs built from a spec string such as
// "blob #ff6b6b eyes2 fangs ears feet" (shape, colour, then features), and playing cards are HTML.
import { SUITS, rankLabel, isFace } from './cards.js';
import { ENH } from './items.js';
import { hashStr } from './util.js';
import { MONSTERS } from './monsters.js';

const INK = '#24163a';
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

function shade(hex, amt) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const n = parseInt(c, 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
}

const BODIES = {
  blob: c => `<path d="M20,62 C18,35 35,24 50,24 C66,24 82,35 80,62 C80,80 66,88 50,88 C33,88 20,80 20,62Z" fill="${c}" ${S}/>`,
  box: c => `<rect x="22" y="27" width="56" height="60" rx="11" fill="${c}" ${S}/>`,
  egg: c => `<path d="M50,22 C70,22 80,46 79,62 C78,80 66,89 50,89 C34,89 22,80 21,62 C20,46 30,22 50,22Z" fill="${c}" ${S}/>`,
  tri: c => `<path d="M50,18 C54,18 84,80 82,85 C80,90 20,90 18,85 C16,80 46,18 50,18Z" fill="${c}" ${S}/>`,
  bean: c => `<path d="M30,30 C45,17 73,21 77,45 C81,70 72,89 50,89 C27,89 19,72 23,55 C25,44 21,38 30,30Z" fill="${c}" ${S}/>`,
  star: c => {
    let d = '';
    for (let i = 0; i < 16; i++) { const a = -Math.PI / 2 + i * Math.PI / 8, r = i % 2 ? 26 : 36; d += `${i ? 'L' : 'M'}${(50 + Math.cos(a) * r).toFixed(1)},${(58 + Math.sin(a) * r).toFixed(1)} `; }
    return `<path d="${d}Z" fill="${c}" ${S}/>`;
  },
  ghost: c => `<path d="M23,88 L23,50 C23,29 36,21 50,21 C64,21 77,29 77,50 L77,88 L68,80 L59,88 L50,80 L41,88 L32,80 Z" fill="${c}" ${S}/>`,
  cone: c => `<path d="M31,60 L50,97 L69,60Z" fill="#e6a85a" ${S}/><path d="M38,66 L62,66 M42,76 L58,76" stroke="#b97a35" stroke-width="2"/><circle cx="50" cy="44" r="25" fill="${c}" ${S}/>`,
  squid: c => `<path d="M30,66 Q26,84 20,90 M40,68 Q38,86 34,93 M50,68 Q50,88 50,95 M60,68 Q62,86 66,93 M70,66 Q74,84 80,90" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M30,66 Q26,84 20,90 M40,68 Q38,86 34,93 M50,68 Q50,88 50,95 M60,68 Q62,86 66,93 M70,66 Q74,84 80,90" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/><path d="M27,66 C24,34 38,18 50,18 C62,18 76,34 73,66 Z" fill="${c}" ${S}/>`,
  snail: c => `<path d="M14,86 C14,74 28,72 40,74 L86,74 C90,74 92,86 86,88 L18,88 C15,88 14,87 14,86Z" fill="${c}" ${S}/><circle cx="58" cy="52" r="24" fill="#d98b4a" ${S}/><path d="M58,52 m-12,0 a12,12 0 1,0 24,0 a7,7 0 1,0 -14,0" fill="none" stroke="${INK}" stroke-width="3"/>`,
};

// where the face sits on each body
const FACE = { blob: [50, 52], box: [50, 50], egg: [50, 52], tri: [50, 60], bean: [50, 52], star: [50, 56], ghost: [50, 46], cone: [50, 42], squid: [50, 44], snail: [25, 74] };

function eyes(n, x, y, mods, c) {
  const r = mods.has('big') ? 10 : n === 1 ? 10 : n === 3 ? 6 : 7.5;
  const pos = n === 1 ? [[x, y]] : n === 3 ? [[x - 14, y + 2], [x, y - 6], [x + 14, y + 2]] : [[x - 11, y], [x + 11, y]];
  let s = '';
  if (mods.has('mask')) s += `<rect x="${x - 26}" y="${y - 9}" width="52" height="16" rx="8" fill="#2d2d3a"/>`;
  if (mods.has('sunglasses')) {
    s += `<path d="M${x - 24},${y - 6} L${x + 24},${y - 6}" stroke="${INK}" stroke-width="3"/>`;
    for (const [ex, ey] of pos) s += `<rect x="${ex - 10}" y="${ey - 7}" width="20" height="13" rx="4" fill="#1b1b2a" stroke="${INK}" stroke-width="2"/><path d="M${ex - 6},${ey - 4} l5,0" stroke="#fff" stroke-width="2" opacity=".7"/>`;
    return s;
  }
  s += '<g class="eyes">';
  pos.forEach(([ex, ey], i) => {
    const gx = mods.has('googly') ? [2, -3, 3][i % 3] : 0, gy = mods.has('googly') ? [3, -2, 1][i % 3] : 1.5;
    s += `<circle cx="${ex}" cy="${ey}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="2.5"/>`;
    s += `<circle cx="${ex + gx}" cy="${ey + gy}" r="${r * 0.48}" fill="${INK}"/><circle cx="${ex + gx + r * 0.2}" cy="${ey + gy - r * 0.25}" r="${r * 0.16}" fill="#fff"/>`;
    if (mods.has('sleepy')) s += `<path d="M${ex - r - 1},${ey} A${r + 1},${r + 1} 0 0 1 ${ex + r + 1},${ey} Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>`;
  });
  s += '</g>';
  if (mods.has('angry')) for (const [ex, ey] of pos) { const d = ex < x ? 1 : ex > x ? -1 : 0; s += `<path d="M${ex - 8},${ey - r - 4 - d * 3} L${ex + 8},${ey - r - 4 + d * 3}" stroke="${INK}" stroke-width="3.5"/>`; }
  if (mods.has('sad')) for (const [ex, ey] of pos) { const d = ex < x ? -1 : 1; s += `<path d="M${ex - 7},${ey - r - 3 - d * 3} L${ex + 7},${ey - r - 3 + d * 3}" stroke="${INK}" stroke-width="3"/>`; }
  if (mods.has('glasses')) s += pos.map(([ex, ey]) => `<circle cx="${ex}" cy="${ey}" r="${r + 3}" fill="none" stroke="${INK}" stroke-width="2.5"/>`).join('') + (n === 2 ? `<path d="M${x - 11 + r + 3},${y} L${x + 11 - r - 3},${y}" stroke="${INK}" stroke-width="2.5"/>` : '');
  if (mods.has('monocle')) s += `<circle cx="${pos[pos.length - 1][0]}" cy="${pos[pos.length - 1][1]}" r="${r + 3}" fill="none" stroke="#d4a017" stroke-width="2.5"/><path d="M${pos[pos.length - 1][0] + r + 3},${pos[pos.length - 1][1]} l4,16" stroke="#d4a017" stroke-width="1.5"/>`;
  return s;
}

function mouth(kind, x, y) {
  switch (kind) {
    case 'fangs': return `<path d="M${x - 11},${y} Q${x},${y + 8} ${x + 11},${y}" fill="#4a1630" ${S}/><path d="M${x - 8},${y + 1} l3,6 l3,-5 M${x + 2},${y + 1} l3,6 l3,-6" fill="#fff" stroke="${INK}" stroke-width="1.5"/>`;
    case 'teeth': return `<rect x="${x - 12}" y="${y - 3}" width="24" height="11" rx="4" fill="#4a1630" ${S}/><path d="M${x - 10},${y - 2} h20 v4 h-20z" fill="#fff"/><path d="M${x - 5},${y - 2} v4 M${x},${y - 2} v4 M${x + 5},${y - 2} v4" stroke="${INK}" stroke-width="1"/>`;
    case 'o': return `<ellipse cx="${x}" cy="${y + 2}" rx="5" ry="6" fill="#4a1630" ${S}/>`;
    case 'tongue': return `<path d="M${x - 10},${y} Q${x},${y + 10} ${x + 10},${y}" fill="#4a1630" ${S}/><path d="M${x - 3},${y + 4} q3,9 7,0" fill="#ff7aa2" stroke="${INK}" stroke-width="2"/>`;
    case 'slot': return `<rect x="${x - 16}" y="${y - 3}" width="32" height="7" rx="3" fill="#1b1b2a" ${S}/><path d="M${x - 10},${y + 4} v6 M${x - 4},${y + 4} v9 M${x + 2},${y + 4} v5 M${x + 8},${y + 4} v8" stroke="#fff" stroke-width="3"/>`;
    case 'underbite': return `<path d="M${x - 11},${y + 2} Q${x},${y - 4} ${x + 11},${y + 2}" fill="none" ${S}/><path d="M${x - 8},${y + 1} l2,-6 l2,5 M${x + 4},${y + 1} l2,-6 l2,5" fill="#fff" stroke="${INK}" stroke-width="1.5"/>`;
    case 'beak': return `<path d="M${x - 7},${y - 4} L${x + 7},${y - 4} L${x},${y + 6}Z" fill="#ffb02e" ${S}/>`;
    case 'grin': default: return `<path d="M${x - 11},${y - 1} Q${x},${y + 10} ${x + 11},${y - 1}" fill="#4a1630" ${S}/><path d="M${x - 6},${y + 3} q6,4 12,0" fill="#ff7aa2"/>`;
  }
}

const BACK = {   // drawn behind the body
  wings: c => `<path d="M24,52 C6,36 4,60 12,70 C16,62 20,62 24,64Z M76,52 C94,36 96,60 88,70 C84,62 80,62 76,64Z" fill="${shade(c, -0.25)}" ${S}/>`,
  tail: c => `<path d="M78,76 C94,72 96,56 88,50" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M78,76 C94,72 96,56 88,50" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
  cape: () => `<path d="M26,44 L14,92 L86,92 L74,44Z" fill="#c8243c" ${S}/>`,
  sunrays: () => [0, 1, 2, 3, 4, 5, 6, 7].map(i => { const a = i * Math.PI / 4; return `<path d="M${50 + Math.cos(a) * 40},${58 + Math.sin(a) * 40} L${50 + Math.cos(a) * 48},${58 + Math.sin(a) * 48}" stroke="#ffcf3a" stroke-width="5" stroke-linecap="round"/>`; }).join(''),
  heads: c => `<circle cx="22" cy="34" r="12" fill="${c}" ${S}/><circle cx="78" cy="34" r="12" fill="${c}" ${S}/><circle cx="19" cy="32" r="3" fill="${INK}"/><circle cx="25" cy="32" r="3" fill="${INK}"/><circle cx="75" cy="32" r="3" fill="${INK}"/><circle cx="81" cy="32" r="3" fill="${INK}"/>`,
  arms2: c => `<path d="M22,48 L8,34 M78,48 L92,34" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M22,48 L8,34 M78,48 L92,34" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`,
  smoke: () => `<circle cx="82" cy="20" r="6" fill="#ccc" opacity=".8"/><circle cx="90" cy="12" r="4" fill="#ddd" opacity=".7"/>`,
};

const FRONT = {   // drawn on top, at fixed places
  ears: c => `<path d="M28,36 L24,14 L42,28Z M72,36 L76,14 L58,28Z" fill="${c}" ${S}/>`,
  catears: c => `<path d="M28,36 L26,12 L44,28Z M72,36 L74,12 L56,28Z" fill="${c}" ${S}/><path d="M30,30 L29,19 L38,27Z M70,30 L71,19 L62,27Z" fill="#ff9ab8"/>`,
  bunnyears: c => `<ellipse cx="38" cy="12" rx="6" ry="16" fill="${c}" ${S}/><ellipse cx="62" cy="12" rx="6" ry="16" fill="${c}" ${S}/><ellipse cx="38" cy="12" rx="2.5" ry="10" fill="#ff9ab8"/><ellipse cx="62" cy="12" rx="2.5" ry="10" fill="#ff9ab8"/>`,
  horns: () => `<path d="M32,30 C26,20 26,12 32,8 C32,16 38,22 40,26Z M68,30 C74,20 74,12 68,8 C68,16 62,22 60,26Z" fill="#fff4d6" ${S}/>`,
  antenna: () => `<path d="M42,26 L36,10 M58,26 L64,10" stroke="${INK}" stroke-width="3"/><circle cx="36" cy="9" r="4.5" fill="#ff5c8a" ${S}/><circle cx="64" cy="9" r="4.5" fill="#ff5c8a" ${S}/>`,
  spikes: c => `<path d="M32,30 L36,16 L42,27 L50,12 L58,27 L64,16 L68,30" fill="${shade(c, -0.2)}" ${S}/>`,
  tuft: () => `<path d="M46,24 Q44,10 50,14 Q52,6 56,14 Q60,10 56,24" fill="#4a2d6b" ${S}/>`,
  tufts: c => `<path d="M30,30 L24,16 L38,26Z M70,30 L76,16 L62,26Z" fill="${shade(c, -0.25)}" ${S}/>`,
  crown: () => `<path d="M34,26 L34,10 L42,18 L50,6 L58,18 L66,10 L66,26Z" fill="#ffd43b" ${S}/><circle cx="50" cy="19" r="2.5" fill="#ff4f6d"/>`,
  tophat: () => `<rect x="36" y="4" width="28" height="20" rx="2" fill="#2a2440" ${S}/><rect x="28" y="22" width="44" height="6" rx="3" fill="#2a2440" ${S}/><rect x="37" y="17" width="26" height="4" fill="#d6336c"/>`,
  gnomehat: () => `<path d="M30,30 L50,0 L70,30Z" fill="#e8384f" ${S}/>`,
  wizardhat: () => `<path d="M28,28 L54,0 L72,28Z" fill="#5a3fbf" ${S}/><circle cx="50" cy="18" r="2" fill="#ffd43b"/><circle cx="58" cy="12" r="1.5" fill="#ffd43b"/>`,
  beret: () => `<ellipse cx="50" cy="22" rx="22" ry="8" fill="#2a2440" ${S}/><path d="M50,14 l0,-5" stroke="${INK}" stroke-width="3"/>`,
  nightcap: () => `<path d="M28,30 C30,12 50,8 66,14 C76,18 82,26 86,34" fill="#5c8dff" ${S}/><circle cx="86" cy="36" r="5" fill="#fff" ${S}/>`,
  cowboy: () => `<path d="M18,28 Q50,36 82,28 Q72,24 66,24 L62,8 Q50,4 38,8 L34,24 Q28,24 18,28Z" fill="#a0612f" ${S}/>`,
  headband: () => `<rect x="24" y="30" width="52" height="7" rx="3" fill="#ff3b5c" ${S}/>`,
  afro: () => `<circle cx="36" cy="22" r="11" fill="#3a2316"/><circle cx="50" cy="16" r="13" fill="#3a2316"/><circle cx="64" cy="22" r="11" fill="#3a2316"/>`,
  feet: c => `<ellipse cx="38" cy="90" rx="9" ry="5" fill="${shade(c, -0.2)}" ${S}/><ellipse cx="62" cy="90" rx="9" ry="5" fill="${shade(c, -0.2)}" ${S}/>`,
  arms: c => `<path d="M22,62 Q10,58 8,48 M78,62 Q90,58 92,48" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M22,62 Q10,58 8,48 M78,62 Q90,58 92,48" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`,
  tinyarms: c => `<path d="M26,64 l-6,-3 M74,64 l6,-3" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M26,64 l-6,-3 M74,64 l6,-3" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`,
  muscles: c => `<path d="M22,58 C6,58 4,40 14,38 C18,44 22,46 24,50 M78,58 C94,58 96,40 86,38 C82,44 78,46 76,50" fill="${c}" ${S}/>`,
  tentacles: () => '',
  tie: () => `<path d="M46,74 L54,74 L52,78 L56,90 L50,94 L44,90 L48,78Z" fill="#e8384f" ${S}/>`,
  collar: () => `<path d="M28,76 Q50,84 72,76" fill="none" stroke="#e8384f" stroke-width="6"/><circle cx="50" cy="82" r="4" fill="#ffd43b" ${S}/>`,
  blush: () => `<ellipse cx="32" cy="62" rx="6" ry="3.5" fill="#ff7aa2" opacity=".7"/><ellipse cx="68" cy="62" rx="6" ry="3.5" fill="#ff7aa2" opacity=".7"/>`,
  nose: () => `<ellipse cx="50" cy="60" rx="7" ry="5" fill="#ff8fab" ${S}/><circle cx="47" cy="60" r="1.5" fill="${INK}"/><circle cx="53" cy="60" r="1.5" fill="${INK}"/>`,
  clownnose: () => `<circle cx="50" cy="60" r="6" fill="#ff2d2d" ${S}/>`,
  stitches: () => `<path d="M60,30 l10,8 M62,36 l4,-4 M66,39 l4,-4" stroke="${INK}" stroke-width="2"/>`,
  stripes: () => `<path d="M24,70 Q50,76 76,70 M22,80 Q50,86 78,80" fill="none" stroke="${INK}" stroke-width="4"/>`,
  beard: () => `<path d="M34,66 Q50,96 66,66 Q58,74 50,74 Q42,74 34,66Z" fill="#f0f0f0" ${S}/>`,
  toga: () => `<path d="M30,74 L70,86 L66,90 L28,80Z" fill="#fff" ${S}/>`,
  crumbs: () => `<circle cx="40" cy="78" r="2" fill="#a0612f"/><circle cx="56" cy="82" r="2.5" fill="#a0612f"/><circle cx="62" cy="76" r="1.5" fill="#a0612f"/>`,
  sweat: () => `<path d="M76,34 q4,8 0,10 q-4,-2 0,-10Z" fill="#7fd3ff" ${S}/>`,
  bandage: () => `<rect x="58" y="30" width="16" height="7" rx="3" fill="#ffe0b0" ${S} transform="rotate(25 66 33)"/>`,
  coin: () => `<circle cx="84" cy="74" r="8" fill="#ffd43b" ${S}/><text x="84" y="78" font-size="10" text-anchor="middle" fill="${INK}" font-weight="700">$</text>`,
  foamfinger: () => `<path d="M80,70 L80,46 Q80,40 85,40 Q90,40 90,46 L90,56 L94,56 L94,70Z" fill="#ffd43b" ${S}/>`,
  drip: c => `<path d="M30,82 q2,10 4,0 M62,84 q2,8 4,0" fill="${c}" ${S}/>`,
  wheels: () => `<circle cx="34" cy="90" r="7" fill="#2a2440" ${S}/><circle cx="66" cy="90" r="7" fill="#2a2440" ${S}/>`,
  arrow: () => `<path d="M58,82 L70,70 L76,74 L88,60" fill="none" stroke="#1f9a48" stroke-width="4"/><path d="M82,58 L90,58 L90,66" fill="none" stroke="#1f9a48" stroke-width="4"/>`,
  trashlid: () => `<rect x="30" y="16" width="40" height="8" rx="3" fill="#9aa3ad" ${S} transform="rotate(-12 50 20)"/>`,
  paper: () => `<rect x="40" y="76" width="20" height="16" fill="#fff" ${S}/>`,
  whiskers: () => `<path d="M30,62 l-14,-2 M30,66 l-14,2 M70,62 l14,-2 M70,66 l14,2" stroke="${INK}" stroke-width="2"/>`,
  lasso: () => `<ellipse cx="86" cy="60" rx="9" ry="6" fill="none" stroke="#c98a3c" stroke-width="3"/>`,
  mallet: () => `<path d="M84,84 L84,58" stroke="#a0612f" stroke-width="4"/><rect x="74" y="48" width="20" height="12" rx="3" fill="#c98a3c" ${S}/>`,
  club: () => `<path d="M82,86 L88,58" stroke="#c98a3c" stroke-width="6" stroke-linecap="round"/><path d="M80,60 h16 v6 h-16z" fill="#ffe7a8" ${S}/>`,
  napkin: () => `<path d="M38,70 L62,70 L50,84Z" fill="#fff" ${S}/>`,
  holes: () => `<circle cx="34" cy="76" r="4" fill="#e0b52f"/><circle cx="64" cy="72" r="5" fill="#e0b52f"/><circle cx="54" cy="84" r="3" fill="#e0b52f"/>`,
  sprinkles: () => `<path d="M38,30 l4,2 M52,24 l3,-3 M62,32 l4,1 M44,38 l-2,3" stroke="#ff4f8b" stroke-width="3"/><path d="M58,24 l2,4 M36,40 l4,0" stroke="#4aa3ff" stroke-width="3"/>`,
  layers: () => `<path d="M22,48 H78 M22,62 H78 M22,76 H78" stroke="#ffe08a" stroke-width="4"/>`,
  sparkle: () => `<path d="M14,22 l3,7 l7,3 l-7,3 l-3,7 l-3,-7 l-7,-3 l7,-3Z" fill="#fff6a8"/><path d="M86,82 l2,5 l5,2 l-5,2 l-2,5 l-2,-5 l-5,-2 l5,-2Z" fill="#fff6a8"/>`,
  sock: () => `<path d="M80,60 L80,76 Q80,84 88,84 L94,84 L94,76 L88,76 L88,60Z" fill="#fff" ${S}/><path d="M80,64 h8" stroke="#e8384f" stroke-width="3"/>`,
};

const cache = new Map();
/** The SVG for a monster spec. */
export function monsterSVG(spec, cls = '') {
  const key = spec + '|' + cls;
  if (cache.has(key)) return cache.get(key);
  const t = spec.split(/\s+/);
  const body = t[0], c = t[1];
  const feats = new Set(t.slice(2));
  const n = feats.has('eyes3') ? 3 : feats.has('eyes1') ? 1 : 2;
  const [fx, fy] = FACE[body] || [50, 52];
  const mouthKind = ['fangs', 'teeth', 'o', 'tongue', 'slot', 'underbite', 'beak', 'grin'].find(m => feats.has(m)) || 'grin';
  let s = `<svg class="mon-svg ${cls}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
  s += `<ellipse cx="50" cy="94" rx="30" ry="4" fill="rgba(0,0,0,.25)"/>`;
  for (const f of feats) if (BACK[f]) s += BACK[f](c);
  if (feats.has('feet')) s += FRONT.feet(c);
  if (feats.has('wheels')) s += FRONT.wheels(c);
  s += `<g class="mon-body">${(BODIES[body] || BODIES.blob)(c)}`;
  // a soft highlight so they look squishy
  if (body !== 'snail' && body !== 'cone') s += `<ellipse cx="38" cy="38" rx="8" ry="5" fill="#fff" opacity=".35" transform="rotate(-25 38 38)"/>`;
  s += '</g>';
  for (const f of feats) if (FRONT[f] && f !== 'feet' && f !== 'wheels' && f !== 'blush' && f !== 'nose' && f !== 'clownnose') s += FRONT[f](c);
  s += eyes(n, fx, fy, feats, c);
  if (feats.has('blush')) s += FRONT.blush();
  if (feats.has('nose')) s += FRONT.nose();
  if (feats.has('clownnose')) s += FRONT.clownnose();
  s += mouth(mouthKind, fx, fy + (body === 'snail' ? 8 : 16));
  s += '</svg>';
  cache.set(key, s);
  return s;
}

// ---------------------------------------------------------------- playing cards
const FACE_SPEC = {
  11: (c) => `bean ${c} eyes2 grin tophat`,
  12: (c) => `egg ${c} eyes2 grin crown blush`,
  13: (c) => `egg ${c} eyes2 grin crown beard`,
};
const lighten = (hex) => shade(hex, 0.55);

/** HTML for a playing card face. */
export function cardHTML(c, opts = {}) {
  const s = SUITS[c.suit];
  const lab = rankLabel(c.rank);
  let mid;
  if (isFace(c)) mid = `<div class="pc-face">${monsterSVG(FACE_SPEC[c.rank](lighten(s.color)))}</div>`;
  else if (c.rank === 14) mid = `<div class="pc-ace">${s.sym}</div>`;
  else mid = `<div class="pc-big">${s.sym}</div>`;
  const e = c.enh ? ENH[c.enh] : null;
  return `<div class="pc-in" style="--sc:${s.color}">
    <div class="pc-corner tl"><b>${lab}</b><i>${s.sym}</i></div>
    ${mid}
    <div class="pc-corner br"><b>${lab}</b><i>${s.sym}</i></div>
    ${e ? `<span class="pc-enh" title="${e.name}">${e.badge}</span>` : ''}
    ${c.bonus ? `<span class="pc-bonus">+${c.bonus}</span>` : ''}
  </div>`;
}

/** A card back. Style comes from the player's chosen back (cosmetic). */
export const BACKS = {
  classic: { name: 'Classic Grape', a: '#5b2a86', b: '#8c4dcc' },
  lava: { name: 'Lava Lamp', a: '#b3261e', b: '#ff8a3d' },
  ocean: { name: 'Deep Sea Snack', a: '#0f4c81', b: '#2bb0d6' },
  slime: { name: 'Slime Time', a: '#2d7a2d', b: '#9be15d' },
  gold: { name: 'Fancy Pants Gold', a: '#8a6100', b: '#ffd43b' },
  bubblegum: { name: 'Bubblegum Crisis', a: '#c2185b', b: '#ff9ccf' },
  midnight: { name: 'Midnight Goblin', a: '#11122b', b: '#4b3a9b' },
  rainbow: { name: 'Absolute Chaos', a: '#ff4f6d', b: '#4aa3ff' },
};
export function backHTML(back = 'classic') {
  const b = BACKS[back] || BACKS.classic;
  return `<div class="pc-back" style="--ba:${b.a};--bb:${b.b}"><div class="pc-back-eye">${monsterSVG('blob #ffffff eyes1 fangs')}</div></div>`;
}

/** Deterministic little mascot for a player id, used as a fallback avatar. */
export const avatarSpec = id => MONSTERS[hashStr(String(id)) % MONSTERS.length].art;

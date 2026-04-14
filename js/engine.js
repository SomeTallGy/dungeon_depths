'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const W = 60, H = 30;
const MAX_ROOMS = 12, MIN_RS = 4, MAX_RS = 11;
const MAX_INV = 5;
const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2 };
const FOV_R = 9;

const ENEMY_DEFS = [
  { name:'Rat',      ch:'r', col:'#a53', hp: 6,  atk: 2, def: 0, xp: 5,   minD:1 },
  { name:'Bat',      ch:'b', col:'#875', hp: 8,  atk: 3, def: 0, xp: 8,   minD:1 },
  { name:'Goblin',   ch:'g', col:'#4a3', hp:14,  atk: 4, def: 1, xp:15,   minD:2 },
  { name:'Kobold',   ch:'k', col:'#5b5', hp:11,  atk: 5, def: 1, xp:12,   minD:2 },
  { name:'Orc',      ch:'o', col:'#3a2', hp:22,  atk: 6, def: 2, xp:28,   minD:3 },
  { name:'Skeleton', ch:'s', col:'#aab', hp:18,  atk: 6, def: 3, xp:22,   minD:3 },
  { name:'Zombie',   ch:'z', col:'#686', hp:25,  atk: 7, def: 2, xp:30,   minD:4 },
  { name:'Troll',    ch:'T', col:'#3b0', hp:38,  atk: 9, def: 3, xp:45,   minD:4 },
  { name:'Ogre',     ch:'O', col:'#5a1', hp:32,  atk:10, def: 4, xp:50,   minD:5 },
  { name:'Vampire',  ch:'V', col:'#c46', hp:28,  atk:11, def: 5, xp:60,   minD:6 },
  { name:'Lich',     ch:'L', col:'#a6f', hp:35,  atk:13, def: 5, xp:80,   minD:7 },
  { name:'Dragon',   ch:'D', col:'#f50', hp:65,  atk:16, def: 7, xp:120,  minD:8 },
];

const BOSS_DEF = {
  name:'Hollow King', ch:'K', col:'#6af',
  hp:160, maxHp:160, atk:22, def:8, xp:300,
  regen:2, phase2Atk:26, phase2Col:'#f66',
  phase2Threshold:80, isBoss:true,
};

// type, name, char, col, value (hp restored / atk bonus / def bonus), price (gold cost)
const ITEM_DEFS = [
  { type:'potion', name:'Minor Potion',   ch:'!', col:'#f4f', val:20, price: 15 },
  { type:'potion', name:'Health Potion',  ch:'‼', col:'#f0f', val:40, price: 30 },
  { type:'potion', name:'Max Potion',     ch:'¶', col:'#d0d', val:80, price: 55 },
  { type:'weapon', name:'Dagger',         ch:'/', col:'#fa8', val: 2, minD:1, price: 20 },
  { type:'weapon', name:'Short Sword',    ch:'/', col:'#fb2', val: 4, minD:2, price: 42 },
  { type:'weapon', name:'Long Sword',     ch:'/', col:'#fc0', val: 6, minD:4, price: 72 },
  { type:'weapon', name:'Battle Axe',     ch:'/', col:'#fd0', val: 9, minD:6, price:115 },
  { type:'armor',  name:'Leather Armor',  ch:']', col:'#a75', val: 2, minD:1, price: 22 },
  { type:'armor',  name:'Chain Mail',     ch:']', col:'#79a', val: 4, minD:3, price: 48 },
  { type:'armor',  name:'Plate Mail',     ch:']', col:'#9af', val: 6, minD:5, price: 78 },
  { type:'gold',   name:'Gold Coins',     ch:'$', col:'#fb0', val: 0 },
];

// ─── Gamble flavor text (tiered by item price) ────────────────────────────────
const GAMBLE_QUIPS = [
  // low tier (price <= 30): junk, commons
  ["Found it in a ditch. Cleaned up most of it.", "A beggar left it behind. Didn't fight me for it.", "Fell off a cart. No one came looking.", "Had it under the counter. Happy to be rid of it.", "Scraped it off the floor. Still functions."],
  // mid tier (price <= 60): decent gear
  ["Pried it off a soldier. He was nearly finished with it.", "Former owner settled a debt. In full.", "Came off a man who owed me money. We're square.", "Someone left it behind in a hurry.", "A mercenary traded it for passage out. Didn't get far."],
  // high tier (price > 60): rare, impressive
  ["Took it off a knight. He'd finished with it.", "A lord had this commissioned. The lord is a memory now.", "Stripped from an adventurer who came back in parts.", "Belonged to someone important. Past tense.", "Was bound for a general's vault. The general had other plans."]
];

// ─── Lore ─────────────────────────────────────────────────────────────────────
const FLOOR_LORE = [
  {
    title: 'Into the Dark',
    text:  'The village of Ashfen is dying. Crops rot overnight. Children wake screaming of hollow eyes beneath the earth. The elders speak of an old dungeon — sealed, forgotten, and now, somehow, <em>open</em>.<br><br>Someone had to go down. You volunteered.',
  },
  {
    title: 'Deeper Than the Maps',
    text:  'The stairs descend further than any chart shows. The stonework changes here — older, cruder, scored with symbols no scholar has ever translated.<br><br>Whatever carved these halls did not have human hands.',
  },
  {
    title: 'The Lost Company',
    text:  'Eight adventurers, armored and prepared, lie scattered across the chamber floor. No wounds. No signs of struggle. One hand still clutches a journal, open to the final entry:<br><br><em>"It doesn\'t attack. It waits. And while it waits, it empties you."</em>',
  },
  {
    title: 'Roots of Corruption',
    text:  'The creatures here move in patterns — circling a fixed point far below, like moths around a flame. They aren\'t hunting. They\'re <em>orbiting</em> something.<br><br>You feel the pull too, now. A cold gravity in your chest that wasn\'t there before.',
  },
  {
    title: 'No Turning Back',
    text:  'Halfway down. You\'ve killed more things than you can count. The surface feels like a memory you\'re no longer sure was real.<br><br>Below, the air grows thick with a presence that has no name in any language you know. You descend anyway.',
  },
  {
    title: 'The Broken Seal',
    text:  'A great iron door, split down the middle as if struck from within by something vast. Ancient runes, dead and dark, line every inch of the frame. The inscription above reads:<br><br><em>"Here sleeps the Hollow King. May he never wake."</em><br><br>He woke.',
  },
  {
    title: 'He Knows You\'re Here',
    text:  'The shadows lean toward you now. They move against the light.<br><br>Somewhere far below, something vast and patient turns its attention upward — and finds you. You hear your name spoken in a voice that has never needed air to breathe.',
  },
  {
    title: 'The Altar of Unmaking',
    text:  'A chamber of black glass, still warm to the touch. At its heart, a throne of fused bone and iron.<br><br>This is where the Hollow King sat for a thousand years, fed by the fear of those who sealed him. The throne is empty. He has gone deeper. Waiting.',
  },
  {
    title: 'The Last Step',
    text:  'One floor remains. The walls no longer feel like stone — they breathe.<br><br>Every creature left in this dungeon has abandoned its territory and gathered below. Not to fight you. To <em>witness</em>. Whatever happens next, they want to see it.',
  },
  {
    title: 'The Hollow King',
    text:  'He was here before the dungeon was built around him. Before the kingdom that sealed him rose and fell to dust. He is not a king of any land — he is a king of <em>absence</em>. Of the hollow place that fear leaves behind.<br><br>He has waited a thousand years for something worth consuming.<br><br>You have come to end that wait.',
  },
];

const NPC_NAMES = ['Aldric','Mira','Cobb','Torvin','Bram','Nessa','Dex','Rhea','Vesper','Gund'];

// ─── Hit Flash & Death Animation ──────────────────────────────────────────────
// Flash: Maps id -> end timestamp. Alternates white/red every 70ms for ~350ms.
// Dying: array of {x, y, start} — plays 5-frame ASCII spark over ~400ms.
const DEATH_FRAMES = [
  { ch: '*', col: '#fff', sh: '0 0 10px #fff, 0 0 4px #ff8' },
  { ch: '+', col: '#ff8', sh: '0 0 7px #ff8' },
  { ch: 'x', col: '#f84', sh: '0 0 5px #f84' },
  { ch: '-', col: '#832', sh: null },
  { ch: '.', col: '#511', sh: null },
];
const DEATH_FRAME_MS = 80;

const SLASH_FRAME_MS = 60;
const SLASH_TOTAL_FRAMES = 4; // 3 path cells + 1 trailing frame = 240ms

const CELL = {
  wall_v:  '#555',
  wall_e:  '#2a2a2a',
  floor_v: '#1e1e1e',
  floor_e: '#131313',
  stair_v: '#eee',
  stair_e: '#444',
};

// ─── Globals ──────────────────────────────────────────────────────────────────
let G = {};
let _id = 0;
let _cheatBuf = '';
let _flashRaf = null;

// ─── Utils ────────────────────────────────────────────────────────────────────
function rand(a,b){ return a+Math.floor(Math.random()*(b-a+1)); }
function anyEntityAt(x,y){
  if(G.p&&G.p.x===x&&G.p.y===y) return true;
  if(G.npc&&G.npc.x===x&&G.npc.y===y) return true;
  return G.enemies.some(e=>e.x===x&&e.y===y);
}
function esc(c){ return c==='>'?'&gt;':c==='<'?'&lt;':c==='&'?'&amp;':c; }
function span(ch, col, shadow) {
  return shadow
    ? `<span style="color:${col};text-shadow:${shadow}">${esc(ch)}</span>`
    : `<span style="color:${col}">${esc(ch)}</span>`;
}

// ─── Flash & Death ────────────────────────────────────────────────────────────
function addFlash(id) {
  G.flashing.set(id, Date.now() + 350);
  if (!_flashRaf) _flashLoop();
}

function addLevelFlash() {
  G.flashing.set('levelup', Date.now() + 800);
  G.lvPulse = { start: Date.now(), x: G.p.x, y: G.p.y };
  if (!_flashRaf) _flashLoop();
  const mapEl = document.getElementById('map');
  if (mapEl) {
    const r = mapEl.getBoundingClientRect();
    const cw = r.width / W, ch = r.height / H;
    const el = document.createElement('div');
    el.className = 'lvup-text';
    el.textContent = 'LEVEL UP';
    el.style.left = (r.left + (G.p.x + 0.5) * cw) + 'px';
    el.style.top  = (r.top  + G.p.y * ch - 18) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
}

function addDeath(x, y) {
  G.dying.push({ x, y, start: Date.now() });
  if (!_flashRaf) _flashLoop();
}

function addSlash(x, y) {
  const backslash = Math.random() < 0.5;
  G.slashAnims.push({
    path: backslash ? [[x-1,y-1],[x,y],[x+1,y+1]] : [[x+1,y-1],[x,y],[x-1,y+1]],
    ch:   backslash ? '\\' : '/',
    start: Date.now()
  });
  if (!_flashRaf) _flashLoop();
}

function _flashLoop() {
  draw();
  const now = Date.now();
  for (const [id, end] of G.flashing) if (now >= end) G.flashing.delete(id);
  G.dying = G.dying.filter(d => now < d.start + DEATH_FRAME_MS * DEATH_FRAMES.length);
  G.slashAnims = G.slashAnims.filter(s => now < s.start + SLASH_FRAME_MS * SLASH_TOTAL_FRAMES);
  if (G.lvPulse && now - G.lvPulse.start >= 600) G.lvPulse = null;
  if (G.flashing.size > 0 || G.dying.length > 0 || G.slashAnims.length > 0 || G.lvPulse) {
    _flashRaf = requestAnimationFrame(_flashLoop);
  } else {
    _flashRaf = null;
    draw(); // restore normal colors
  }
}

function flashColor(id) {
  const end = G.flashing.get(id);
  if (!end) return null;
  const dur = id === 'levelup' ? 800 : 350;
  const slot = Math.max(0, Math.floor((dur - (end - Date.now())) / 70));
  if (id === 'levelup') {
    const cols = ['#fc0','#fff','#ff8','#fc0'];
    return cols[slot % cols.length];
  }
  return slot % 2 === 0 ? '#fff' : '#f44';
}

// ─── Overlays ─────────────────────────────────────────────────────────────────
function removeOverlay() {
  const ov=document.getElementById('overlay');
  if(ov) ov.remove();
}

function showOverlay(title, sub, stats, btns) {
  removeOverlay();
  const ov=document.createElement('div');
  ov.className='overlay'; ov.id='overlay';
  ov.innerHTML=`<div class="obox">
    <div class="otitle">${title}</div>
    <div class="osub">${sub}</div>
    <div class="ostats">${stats}</div>
    ${btns.map(([t,fn])=>`<button class="btn" onclick="${fn}">${t}</button>`).join('')}
  </div>`;
  document.body.appendChild(ov);
}

function showEnd() {
  const p=G.p;
  if (G.won) {
    showOverlay(
      '<span style="color:#c80">VICTORY!</span>',
      'The Hollow King is slain. The dungeon is free.',
      `Level ${p.lv} &bull; ${G.turns} turns &bull; ${p.gold}g collected`,
      [['New Game','newGame()']]
    );
  } else {
    showOverlay(
      '<span style="color:#c33">YOU DIED</span>',
      `Slain on floor ${G.depth}`,
      `Level ${p.lv} &bull; ${G.turns} turns &bull; ${p.gold}g collected`,
      [['Try Again','newGame()']]
    );
  }
}

function showLore(depth) {
  const { title, text } = FLOOR_LORE[Math.min(depth, FLOOR_LORE.length) - 1];
  const nextAction = depth === 1 ? 'showTutorial()' : 'removeOverlay()';
  const nextLabel  = depth === 1 ? 'Continue →' : 'Continue';
  removeOverlay();
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'overlay';
  ov.dataset.lore = depth;
  ov.innerHTML = `<div class="obox" style="max-width:460px">
    <div style="color:#444;font-size:10px;letter-spacing:3px;margin-bottom:10px;text-transform:uppercase">Floor ${depth} of 10</div>
    <div style="color:#c80;font-size:21px;letter-spacing:1px;margin-bottom:18px">${title}</div>
    <div style="font-style:italic;line-height:1.9;color:#bbb;font-size:13px;margin-bottom:26px;text-align:left">${text}</div>
    <button class="btn" onclick="${nextAction}">${nextLabel}</button>
    <div style="color:#333;font-size:10px;margin-top:10px">tap or press any key to continue</div>
  </div>`;
  // tap-outside-to-dismiss on touch devices
  ov.addEventListener('touchstart', e => {
    if (e.target === ov) { e.preventDefault(); ov.querySelector('.btn').click(); }
  }, { passive: false });
  document.body.appendChild(ov);
}

// ─── State ────────────────────────────────────────────────────────────────────
function newGame() {
  removeOverlay();
  G = {
    map: [], explored: [], visible: [],
    rooms: [], enemies: [], items: [],
    depth: 1, turns: 0, over: false, won: false, god: false, flashing: new Map(), dying: [], slashAnims: [], npc: null, bossDefeated: false, gasTiles: new Set(), lvPulse: null, bloodTiles: new Map(),
    log: [],
    p: {
      x:0, y:0,
      hp:30, maxHp:30,
      baseAtk:3, baseDef:0,
      lv:1, xp:0, xpNext:20,
      gold:0, weapon:null, armor:null,
      inv: [],
    },
  };
  buildFloor();
  fov();
  msg('You descend into the dungeon depths. Survive!', 'info');
  draw();
  showLore(1);
}

// ─── Dungeon Generation ───────────────────────────────────────────────────────
function buildFloor() {
  G.map      = Array.from({length:H}, () => new Uint8Array(W));
  G.explored = Array.from({length:H}, () => new Uint8Array(W));
  G.visible  = Array.from({length:H}, () => new Uint8Array(W));
  G.rooms    = [];
  G.enemies  = [];
  G.items    = [];
  G.npc        = null;
  G.gasTiles   = new Set();
  G.bloodTiles = new Map();

  for (let attempt = 0; attempt < 200 && G.rooms.length < MAX_ROOMS; attempt++) {
    const rw = rand(MIN_RS, MAX_RS), rh = rand(MIN_RS, MAX_RS);
    const rx = rand(1, W - rw - 1),  ry = rand(1, H - rh - 1);
    const room = {x:rx, y:ry, w:rw, h:rh};
    if (!G.rooms.some(r => overlaps(r, room, 1))) {
      carve(room);
      if (G.rooms.length > 0) tunnel(G.rooms[G.rooms.length-1], room);
      G.rooms.push(room);
    }
  }

  // Place player in first room
  const fr = G.rooms[0];
  G.p.x = fr.x + (fr.w>>1);
  G.p.y = fr.y + (fr.h>>1);

  // Stairs in last room
  const lr = G.rooms[G.rooms.length-1];
  const sx = lr.x + (lr.w>>1), sy = lr.y + (lr.h>>1);
  G.map[sy][sx] = TILE.STAIRS;

  // Mark a poison gas room on floor 5
  if (G.depth === 5 && G.rooms.length > 2) {
    const mid = G.rooms.slice(1, -1);
    const gr = mid[rand(0, mid.length - 1)];
    for (let gy = gr.y; gy < gr.y + gr.h; gy++)
      for (let gx = gr.x; gx < gr.x + gr.w; gx++)
        if (G.map[gy][gx] === TILE.FLOOR) G.gasTiles.add(`${gx},${gy}`);
  }

  // Populate rooms
  if (G.depth === 10) {
    // Boss floor: no regular enemies — Hollow King alone in last room
    G.bossDefeated = false;
    const bossPos = freeInRoom(lr);
    if (bossPos) {
      G.enemies.push({
        ...BOSS_DEF,
        hp: BOSS_DEF.hp, maxHp: BOSS_DEF.maxHp,
        phase2: false,
        x: bossPos.x, y: bossPos.y,
        id: ++_id, awake: false,
        huntTurns: 0, lastKnownX: null, lastKnownY: null,
      });
    }
    // Items in middle rooms for last-chance prep
    for (let i = 1; i < G.rooms.length - 1; i++) {
      const pos = freeInRoom(G.rooms[i]);
      if (pos) placeItem(pos.x, pos.y);
    }
    placeNPC();
  } else {
    for (let i = 1; i < G.rooms.length; i++) populate(G.rooms[i]);
    placeNPC();
  }
}

function carve(r) {
  for (let y = r.y; y < r.y+r.h; y++)
    for (let x = r.x; x < r.x+r.w; x++)
      G.map[y][x] = TILE.FLOOR;
}

function tunnel(a, b) {
  let ax = a.x+(a.w>>1), ay = a.y+(a.h>>1);
  let bx = b.x+(b.w>>1), by = b.y+(b.h>>1);
  if (Math.random() < 0.5) { hline(ax,ay,bx); vline(bx,ay,by); }
  else                      { vline(ax,ay,by); hline(ax,by,bx); }
}

function hline(x1,y,x2){ const d=Math.sign(x2-x1)||1; for(let x=x1;x!==x2+d;x+=d) setFloor(x,y); }
function vline(x,y1,y2){ const d=Math.sign(y2-y1)||1; for(let y=y1;y!==y2+d;y+=d) setFloor(x,y); }
function setFloor(x,y){ if(x>=0&&x<W&&y>=0&&y<H&&G.map[y][x]===TILE.WALL) G.map[y][x]=TILE.FLOOR; }

function overlaps(a,b,m=0){
  return !(a.x+a.w+m<=b.x||b.x+b.w+m<=a.x||a.y+a.h+m<=b.y||b.y+b.h+m<=a.y);
}

function populate(room) {
  const d = G.depth;
  const numE = rand(1, Math.min(4, 1+Math.floor(d/2)));
  for (let i=0; i<numE; i++) {
    const pos = freeInRoom(room);
    if (!pos) continue;
    const eligible = ENEMY_DEFS.filter(e=>e.minD<=d);
    const idx = Math.floor(Math.pow(Math.random(), 0.6) * eligible.length);
    const t = eligible[Math.min(idx, eligible.length-1)];
    const hpBonus = Math.floor(d * 1.5);
    const atkBonus = Math.floor(d * 0.4);
    G.enemies.push({
      ...t,
      hp: t.hp+hpBonus, maxHp: t.hp+hpBonus,
      atk: t.atk+atkBonus,
      x:pos.x, y:pos.y,
      id: ++_id,
      awake: false,
      huntTurns: 0, lastKnownX: null, lastKnownY: null,
    });
  }
  // Items
  const numI = Math.random()<0.7 ? 1 : (Math.random()<0.5 ? 2 : 0);
  for (let i=0; i<numI; i++) {
    const pos = freeInRoom(room);
    if (pos) placeItem(pos.x, pos.y);
  }
}

function placeItem(x, y, forceType) {
  let def;
  if (forceType) {
    def = ITEM_DEFS.find(d=>d.type===forceType) || ITEM_DEFS[0];
  } else {
    const r = Math.random();
    const d = G.depth;
    if (r < 0.28) {
      // potion
      const p = Math.random();
      def = p<0.5 ? ITEM_DEFS[0] : p<0.8 ? ITEM_DEFS[1] : ITEM_DEFS[2];
    } else if (r < 0.48) {
      // weapon
      const ws = ITEM_DEFS.filter(i=>i.type==='weapon'&&i.minD<=d);
      def = ws[rand(0,ws.length-1)];
    } else if (r < 0.68) {
      // armor
      const as = ITEM_DEFS.filter(i=>i.type==='armor'&&i.minD<=d);
      def = as[rand(0,as.length-1)];
    } else {
      // gold
      def = {...ITEM_DEFS[10], val: rand(5,12)*d};
    }
  }
  if (!def) def = ITEM_DEFS[0];
  G.items.push({ ...def, x, y, id:++_id });
}

function freeInRoom(room) {
  for (let a=0; a<30; a++) {
    const x=rand(room.x+1, room.x+room.w-2);
    const y=rand(room.y+1, room.y+room.h-2);
    if (G.map[y][x]===TILE.FLOOR && !anyEntityAt(x,y)) return {x,y};
  }
  return null;
}

function placeNPC() {
  // Prefer a middle room; skip room 0 (player) and last room (stairs)
  const candidates = G.rooms.length > 2 ? G.rooms.slice(1, -1) : G.rooms.slice(1);
  if (!candidates.length) return;
  const room = candidates[rand(0, candidates.length - 1)];
  const pos = freeInRoom(room);
  if (!pos) return;
  G.npc = { x:pos.x, y:pos.y, name:NPC_NAMES[rand(0,NPC_NAMES.length-1)], stock:generateStock(), greeted:false };
}

function generateStock() {
  const d = G.depth;
  const stock = [];
  const pots = ITEM_DEFS.filter(i=>i.type==='potion');
  const maxPot = Math.min(d - 1, pots.length - 1);
  stock.push({...pots[rand(0, maxPot)]});
  if (Math.random() < 0.65) stock.push({...pots[rand(0, maxPot)]});
  const wpns = ITEM_DEFS.filter(i=>i.type==='weapon' && (i.minD||1)<=d);
  if (wpns.length) stock.push({...wpns[rand(0, wpns.length-1)]});
  const arms = ITEM_DEFS.filter(i=>i.type==='armor'  && (i.minD||1)<=d);
  if (arms.length) stock.push({...arms[rand(0, arms.length-1)]});
  return stock.slice(0, 4);
}

// ─── FOV ──────────────────────────────────────────────────────────────────────
function fov() {
  for (let y=0;y<H;y++) G.visible[y].fill(0);
  const px=G.p.x, py=G.p.y;
  for (let deg=0; deg<360; deg+=3) {
    const rad=deg*Math.PI/180;
    const cos=Math.cos(rad)*0.5, sin=Math.sin(rad)*0.5;
    let rx=px, ry=py;
    for (let i=0; i<FOV_R*2; i++) {
      const mx=Math.round(rx), my=Math.round(ry);
      if (mx<0||mx>=W||my<0||my>=H) break;
      G.visible[my][mx]=1; G.explored[my][mx]=1;
      if (G.map[my][mx]===TILE.WALL) break;
      rx+=cos; ry+=sin;
    }
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function atk(e) { return (e.baseAtk??e.atk??0)+(e.weapon?e.weapon.val:0); }
function def(e) { return (e.baseDef??e.def??0)+(e.armor?e.armor.val:0); }

function dmg(attacker, defender) {
  const base = Math.max(1, atk(attacker)-def(defender));
  return Math.max(1, base + rand(-1,1));
}

// ─── Combat ───────────────────────────────────────────────────────────────────
function strikeEnemy(en) {
  const d = dmg(G.p, en);
  en.hp -= d;
  addSlash(en.x, en.y);
  setTimeout(() => { if (!G.over) addFlash(en.id); }, SLASH_FRAME_MS * SLASH_TOTAL_FRAMES);
  // Phase 2 transition for boss
  if (en.isBoss && !en.phase2 && en.hp <= en.phase2Threshold && en.hp > 0) {
    en.phase2 = true;
    en.atk = en.phase2Atk;
    en.col = en.phase2Col;
    msg(`<b style="color:#f66">The Hollow King shatters — his true form tears free. His strikes grow frenzied!</b>`, 'warn');
  }
  if (en.hp <= 0) {
    if (en.isBoss) {
      G.bossDefeated = true;
      msg(`<b style="color:#c80">The Hollow King collapses. The dungeon shudders. A thousand years of silence finally end.</b>`, 'good');
      msg(`The stairs are unsealed. You may now descend.`, 'info');
      G.p.xp += en.xp;
      G.enemies = G.enemies.filter(e=>e.id!==en.id);
      addDeath(en.x, en.y);
      levelUp();
    } else {
      msg(`You slay the ${en.name}! <span style="color:#c80">(+${en.xp} XP)</span>`, 'good');
      G.p.xp += en.xp;
      G.enemies = G.enemies.filter(e=>e.id!==en.id);
      addDeath(en.x, en.y);
      if (Math.random()<0.3) placeItem(en.x, en.y);
      levelUp();
    }
  } else {
    msg(`You hit the <span style="color:${en.col}">${en.name}</span> for <b>${d}</b> dmg. (${en.hp}hp)`, 'combat');
  }
}

function strikePlayer(en) {
  if (G.god) return;
  const d = dmg(en, G.p);
  G.p.hp -= d;
  addFlash('player');
  msg(`<span style="color:${en.col}">${en.name}</span> hits you for <b>${d}</b> dmg!`, 'combat');
  if (G.p.hp <= 0) { G.p.hp=0; G.over=true; }
}

function levelUp() {
  while (G.p.xp >= G.p.xpNext) {
    G.p.xp -= G.p.xpNext;
    G.p.lv++;
    G.p.xpNext = Math.floor(G.p.xpNext*1.6);
    G.p.maxHp += 8; G.p.hp = Math.min(G.p.hp+8, G.p.maxHp);
    G.p.baseAtk += 1;
    msg(`⬆ Level ${G.p.lv}! Max HP +8, Attack +1.`, 'level');
    addLevelFlash();
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────
function move(dx, dy) {
  if (G.over) return;
  const nx=G.p.x+dx, ny=G.p.y+dy;
  if (nx<0||nx>=W||ny<0||ny>=H) return;

  if (G.npc && G.npc.x===nx && G.npc.y===ny) { openShop(); return; }

  const en = G.enemies.find(e=>e.x===nx&&e.y===ny);
  if (en) { strikeEnemy(en); endTurn(); return; }

  if (G.map[ny][nx]===TILE.WALL) return;

  G.p.x=nx; G.p.y=ny;

  if (G.p.hp / G.p.maxHp <= 0.35 && Math.random() < 0.5) {
    const bch  = ['·','·',',',"'"][Math.floor(Math.random()*4)];
    const bcol = ['#6a0000','#7a0808','#580000','#880010'][Math.floor(Math.random()*4)];
    const key  = `${nx},${ny}`;
    G.bloodTiles.set(key, { ch: bch, col: bcol });
    if (G.bloodTiles.size > 120) G.bloodTiles.delete(G.bloodTiles.keys().next().value);
  }

  const it = G.items.find(i=>i.x===nx&&i.y===ny);
  if (it) msg(`You see a <span style="color:${it.col}">${it.name}</span>. (G to pick up)`, 'info');
  if (G.map[ny][nx]===TILE.STAIRS) openStairsPrompt();

  endTurn();
}

function pickup() {
  if (G.over) return;
  const it = G.items.find(i=>i.x===G.p.x&&i.y===G.p.y);
  if (!it) { msg('Nothing here to pick up.', 'info'); return; }

  if (it.type==='gold') {
    G.p.gold += it.val;
    G.items = G.items.filter(i=>i.id!==it.id);
    msg(`You pocket <span style="color:#fb0">${it.val} gold coins</span>.`, 'loot');
  } else if (it.type==='weapon') {
    const old = G.p.weapon;
    G.p.weapon = it;
    G.items = G.items.filter(i=>i.id!==it.id);
    if (old) {
      G.items.push({...old, x:G.p.x, y:G.p.y, id:++_id});
      msg(`You swap <span style="color:#fa8">${old.name}</span> for <span style="color:${it.col}">${it.name}</span> (+${it.val} atk).`, 'loot');
    } else {
      msg(`You equip <span style="color:${it.col}">${it.name}</span> (+${it.val} atk).`, 'loot');
    }
  } else if (it.type==='armor') {
    const old = G.p.armor;
    G.p.armor = it;
    G.items = G.items.filter(i=>i.id!==it.id);
    if (old) {
      G.items.push({...old, x:G.p.x, y:G.p.y, id:++_id});
      msg(`You swap <span style="color:#a75">${old.name}</span> for <span style="color:${it.col}">${it.name}</span> (+${it.val} def).`, 'loot');
    } else {
      msg(`You equip <span style="color:${it.col}">${it.name}</span> (+${it.val} def).`, 'loot');
    }
  } else if (it.type==='potion') {
    if (G.p.inv.length>=MAX_INV) { msg('Inventory full! (max '+MAX_INV+')', 'warn'); return; }
    G.p.inv.push(it);
    G.items = G.items.filter(i=>i.id!==it.id);
    msg(`You stow the <span style="color:${it.col}">${it.name}</span>.`, 'loot');
  }
  draw();
}

function useInvItem(i) {
  if (G.over) return;
  const it = G.p.inv[i];
  if (!it) return;
  if (it.type==='potion') {
    const heal = Math.min(it.val, G.p.maxHp-G.p.hp);
    G.p.hp += heal;
    G.p.inv.splice(i,1);
    msg(`You quaff the <span style="color:${it.col}">${it.name}</span> and recover <b>${heal}</b> HP.`, 'good');
    endTurn();
  }
}

function tryStairs() {
  if (G.over) return;
  if (G.map[G.p.y][G.p.x]===TILE.STAIRS) openStairsPrompt();
  else msg('No staircase here. Find the &gt; tile.', 'info');
}

function openStairsPrompt() {
  removeOverlay();
  const dest = G.depth >= 10 ? 'your destiny' : `floor ${G.depth + 1}`;
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'overlay'; ov.dataset.stairs = '1';
  ov.innerHTML = `<div class="obox">
    <div class="otitle" style="font-size:20px">&gt; Staircase</div>
    <div class="osub">Descend to ${dest}?</div>
    <div style="margin-top:4px">
      <button class="btn" onclick="descend()">[Y] Descend</button>
      <button class="btn" onclick="removeOverlay()">[N] Stay</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}

function descend() {
  if (G.over) return;
  removeOverlay();
  if (G.depth >= 10) {
    if (!G.bossDefeated) {
      msg('The stairs are sealed by a dark force. The Hollow King must be defeated first.', 'warn');
      return;
    }
    G.won = true; G.over = true; showEnd(); return;
  }
  G.depth++;
  msg(`You descend to floor ${G.depth}…`, 'warn');
  buildFloor(); fov(); draw();
  showLore(G.depth);
}

function waitTurn() {
  if (G.over) return;
  if (G.turns%10===0 && G.p.hp<G.p.maxHp) {
    G.p.hp=Math.min(G.p.hp+1, G.p.maxHp);
  }
  endTurn();
}

// ─── Enemy AI ─────────────────────────────────────────────────────────────────
function enemyTurns() {
  for (const e of G.enemies) {
    if (G.over) return;
    const visible = !!G.visible[e.y][e.x];

    if (visible) {
      e.awake = true;
      e.lastKnownX = G.p.x;
      e.lastKnownY = G.p.y;
      e.huntTurns = 10;
    } else if (e.awake && e.huntTurns > 0) {
      e.huntTurns--;
      if (e.huntTurns <= 0) e.awake = false;
    } else {
      e.awake = false;
      continue;
    }

    // Boss regen (fires while awake or hunting)
    if (e.isBoss && e.regen && e.hp < e.maxHp) {
      e.hp = Math.min(e.hp + e.regen, e.maxHp);
      if (visible && G.turns % 5 === 0)
        msg(`The Hollow King regenerates <b>${e.regen}</b> HP. (${e.hp}/${e.maxHp})`, 'warn');
    }

    const targetX = visible ? G.p.x : e.lastKnownX;
    const targetY = visible ? G.p.y : e.lastKnownY;
    if (targetX === null) continue;

    const dx = targetX - e.x, dy = targetY - e.y;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist <= 1 && visible) {
      strikePlayer(e);
    } else if (dist > 0) {
      const pref = Math.abs(dx)>=Math.abs(dy)
        ? [[Math.sign(dx),0],[0,Math.sign(dy)],[0,-Math.sign(dy)],[-Math.sign(dx),0]]
        : [[0,Math.sign(dy)],[Math.sign(dx),0],[-Math.sign(dx),0],[0,-Math.sign(dy)]];
      for (const [mdx,mdy] of pref) {
        const nx=e.x+mdx, ny=e.y+mdy;
        if (nx<0||nx>=W||ny<0||ny>=H) continue;
        if (G.map[ny][nx]===TILE.WALL) continue;
        if (G.enemies.some(o=>o!==e&&o.x===nx&&o.y===ny)) continue;
        if (nx===G.p.x&&ny===G.p.y) continue;
        e.x=nx; e.y=ny; break;
      }
      // Reached last known position but player gone — go dormant
      if (!visible && e.x === e.lastKnownX && e.y === e.lastKnownY) {
        e.awake = false;
        e.huntTurns = 0;
      }
    }
  }
}

function endTurn() {
  enemyTurns();
  if (!G.god && !G.over && G.gasTiles.has(`${G.p.x},${G.p.y}`)) {
    G.p.hp -= 1;
    msg(`<span style="color:#4a4">Poison gas burns your lungs.</span> (-1 HP)`, 'warn');
    if (G.p.hp <= 0) { G.p.hp = 0; G.over = true; }
  }
  G.turns++;
  fov();
  if (G.npc && !G.npc.greeted && G.visible[G.npc.y][G.npc.x]) {
    msg(`You spot <span style="color:#0cd">${G.npc.name}</span> the merchant. (bump to trade)`, 'info');
    G.npc.greeted = true;
  }
  draw();
  if (G.over) setTimeout(showEnd, 300);
}

// ─── Shop ─────────────────────────────────────────────────────────────────────
function openShop() { renderShop(); }

function renderShop() {
  removeOverlay();
  const p = G.p, npc = G.npc;
  const rows = npc.stock.map((it, i) => {
    const can = p.gold >= it.price;
    const stat = it.type==='potion' ? `${it.val} HP`
               : it.type==='weapon' ? `+${it.val} ATK` : `+${it.val} DEF`;
    return `<div class="shop-item${can?'':' cant-afford'}" onclick="buyItem(${i})">
      <span style="color:#555;min-width:22px">[${i+1}]</span>
      <span style="color:${it.col};min-width:14px">${it.ch}</span>
      <span style="flex:1">${it.name}</span>
      <span style="color:#666;margin-right:14px;font-size:11px">${stat}</span>
      <span style="color:${can?'#fb0':'#554'}">${it.price}g</span>
    </div>`;
  });
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'overlay';
  ov.dataset.shop = '1';
  ov.innerHTML = `<div class="obox" style="min-width:320px">
    <div class="otitle" style="color:#0cd;font-size:22px">@ ${npc.name}</div>
    <div class="osub">"Fine wares for the discerning adventurer."</div>
    <div style="color:#777;margin-bottom:16px;font-size:12px">
      Your gold: <span style="color:#fb0">${p.gold}g</span>
    </div>
    <div style="text-align:left;margin-bottom:12px">
      ${npc.stock.length ? rows.join('') : '<div style="color:#555;padding:14px 0;text-align:center">Sold out!</div>'}
    </div>
    <div style="border-top:1px solid #2a2a2a;padding-top:8px;margin-bottom:16px">
      <div class="shop-item${p.gold>=15?'':' cant-afford'}" onclick="gambleItem()">
        <span style="color:#555;min-width:22px">[G]</span>
        <span style="color:#f8a;min-width:14px">?</span>
        <span style="flex:1">Mystery Item</span>
        <span style="color:#666;margin-right:14px;font-size:11px">Any tier</span>
        <span style="color:${p.gold>=15?'#fb0':'#554'}">15g</span>
      </div>
    </div>
    <button class="btn" onclick="removeOverlay()">[Esc] Leave</button>
  </div>`;
  document.body.appendChild(ov);
}

function buyItem(i) {
  const npc = G.npc, p = G.p;
  const it = npc.stock[i];
  if (!it) return;
  if (p.gold < it.price) { msg(`Not enough gold. (need ${it.price}g)`, 'warn'); renderShop(); return; }

  p.gold -= it.price;
  npc.stock.splice(i, 1);

  if (it.type === 'potion') {
    if (p.inv.length >= MAX_INV) {
      p.gold += it.price; npc.stock.splice(i, 0, it);
      msg('Inventory full!', 'warn'); renderShop(); return;
    }
    p.inv.push({...it});
    msg(`Bought <span style="color:${it.col}">${it.name}</span> for ${it.price}g.`, 'loot');
  } else if (it.type === 'weapon') {
    const old = p.weapon; p.weapon = {...it};
    if (old) { G.items.push({...old, x:npc.x, y:npc.y, id:++_id}); }
    msg(`Bought & equipped <span style="color:${it.col}">${it.name}</span> for ${it.price}g.${old?' Old weapon dropped.':''}`, 'loot');
  } else if (it.type === 'armor') {
    const old = p.armor; p.armor = {...it};
    if (old) { G.items.push({...old, x:npc.x, y:npc.y, id:++_id}); }
    msg(`Bought & equipped <span style="color:${it.col}">${it.name}</span> for ${it.price}g.${old?' Old armor dropped.':''}`, 'loot');
  }
  renderShop();
  draw();
}


function gambleItem() {
  const npc = G.npc, p = G.p;
  if (p.gold < 15) { msg('Not enough gold to gamble. (need 15g)', 'warn'); renderShop(); return; }
  p.gold -= 15;
  const d = G.depth;
  // 20% chance to draw from up to 2 floors ahead; otherwise floor-appropriate only
  const maxD = Math.random() < 0.2 ? d + 2 : d;
  const pool = ITEM_DEFS.filter(i => i.type !== 'gold' && (i.minD||1) <= maxD);
  const def = pool[rand(0, pool.length - 1)];
  const item = { ...def, id: ++_id };
  if (item.type === 'potion') {
    if (p.inv.length >= MAX_INV) {
      G.items.push({ ...item, x: npc.x, y: npc.y });
      msg(`You gamble and receive a <span style="color:${item.col}">${item.name}</span> — pack is full! It falls to the floor.`, 'warn');
    } else {
      p.inv.push(item);
      msg(`You gamble and receive a <span style="color:${item.col}">${item.name}</span>!`, 'loot');
    }
  } else if (item.type === 'weapon') {
    const old = p.weapon; p.weapon = item;
    if (old) { G.items.push({ ...old, x: npc.x, y: npc.y, id: ++_id }); }
    msg(`You gamble and receive a <span style="color:${item.col}">${item.name}</span>!${old ? ' Old weapon dropped.' : ''}`, 'loot');
  } else if (item.type === 'armor') {
    const old = p.armor; p.armor = item;
    if (old) { G.items.push({ ...old, x: npc.x, y: npc.y, id: ++_id }); }
    msg(`You gamble and receive a <span style="color:${item.col}">${item.name}</span>!${old ? ' Old armor dropped.' : ''}`, 'loot');
  }
  showGambleResult(item, npc.name); draw();
}

function showGambleResult(item, npcName) {
  removeOverlay();
  const tier = item.price <= 30 ? 0 : item.price <= 60 ? 1 : 2;
  const quips = GAMBLE_QUIPS[tier];
  const quip = quips[rand(0, quips.length - 1)];
  const stat = item.type==='potion' ? `${item.val} HP`
             : item.type==='weapon' ? `+${item.val} ATK` : `+${item.val} DEF`;
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'overlay';
  ov.dataset.gamble = '1';
  ov.innerHTML = `<div class="obox" style="max-width:360px">
    <div class="otitle" style="color:#0cd;font-size:20px">@ ${npcName}</div>
    <div class="osub" style="font-style:italic;color:#888;margin-bottom:24px">"${quip}"</div>
    <div style="font-size:36px;margin-bottom:10px"><span style="color:${item.col}">${item.ch}</span></div>
    <div style="color:#ccc;font-size:15px;margin-bottom:4px">${item.name}</div>
    <div style="color:#555;font-size:12px;margin-bottom:28px">${stat}</div>
    <button class="btn" onclick="closeGamble()">[Enter] Take it</button>
  </div>`;
  document.body.appendChild(ov);
}

function closeGamble() { removeOverlay(); renderShop(); }

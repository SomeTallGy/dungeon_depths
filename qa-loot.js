'use strict';

const pw   = require('C:\\Users\\User\\AppData\\Roaming\\npm\\node_modules\\playwright');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT      = 7434;
const BASE_DIR  = path.resolve(__dirname);
const OUT_DIR   = path.join(BASE_DIR, '.playwright-output');
const REPORT    = path.join(OUT_DIR, 'loot-report.txt');
const MAX_TURNS = 3000;  // per-floor safety cap
const TICK_MS   = 20;    // ms between keypresses

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── HTTP server ──────────────────────────────────────────────────────────────
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p    = path.join(BASE_DIR, req.url === '/' ? '/dungeon.html' : req.url.split('?')[0]);
      const ext  = path.extname(p).toLowerCase();
      const mime = { '.html': 'text/html', '.js': 'application/javascript' }[ext] || 'text/plain';
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
      });
    });
    srv.listen(PORT, () => {
      console.log(`HTTP server: http://localhost:${PORT}/`);
      resolve(srv);
    });
  });
}

// ─── Inject loot tracker into the game's JS context ──────────────────────────
// Hooks window.pickup() to observe every successful item pickup.
// Tracks gold, potions, weapons, and armor collected per floor.
async function injectTracker(page) {
  await page.evaluate(() => {
    window._loot = { floors: {} };

    function initFloor(d) {
      if (!window._loot.floors[d])
        window._loot.floors[d] = { goldPickedUp: 0, goldCount: 0, potions: [], weapons: [], armor: [] };
      return window._loot.floors[d];
    }

    const _orig = window.pickup;
    window.pickup = function () {
      const it = G.items.find(i => i.x === G.p.x && i.y === G.p.y);
      if (!it) return _orig.apply(this, arguments);

      // Snapshot before so we only record successful pickups
      const goldBefore = G.p.gold;
      const invBefore  = G.p.inv.length;
      const wpnBefore  = G.p.weapon?.name ?? null;
      const armBefore  = G.p.armor?.name  ?? null;

      _orig.apply(this, arguments);

      const fd = initFloor(G.depth);
      if      (it.type === 'gold'   && G.p.gold > goldBefore)
        { fd.goldPickedUp += G.p.gold - goldBefore; fd.goldCount++; }
      else if (it.type === 'potion' && G.p.inv.length > invBefore)
        fd.potions.push(it.name);
      else if (it.type === 'weapon' && (G.p.weapon?.name ?? null) !== wpnBefore)
        fd.weapons.push(it.name);
      else if (it.type === 'armor'  && (G.p.armor?.name  ?? null) !== armBefore)
        fd.armor.push(it.name);
    };

    initFloor(1);
  });
}

// ─── Overlay handler ──────────────────────────────────────────────────────────
// Loops up to 8 times so chains like lore→generic resolve in one call.
// Returns 'end' if the game is over, 'ok' otherwise.
async function handleOverlays(page) {
  for (let i = 0; i < 8; i++) {
    const kind = await page.evaluate(() => {
      const el = document.getElementById('overlay');
      if (!el) return null;
      if (G.over)            return 'end';
      if (el.dataset.stairs) return 'stairs';
      if (el.dataset.shop)   return 'shop';
      if (el.dataset.gamble) return 'gamble';
      if (el.dataset.lore)   return 'lore';
      return 'generic';
    });
    if (kind === null)  break;
    if (kind === 'end') return 'end';
    const key = { stairs: 'y', shop: 'Escape', gamble: 'Enter', lore: 'Space', generic: 'Space' }[kind];
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
  return 'ok';
}

// ─── Lightweight state snapshot ───────────────────────────────────────────────
async function readState(page) {
  return page.evaluate(() => ({
    over:  G.over,
    won:   G.won,
    depth: G.depth,
    hp:    G.p.hp,
    maxHp: G.p.maxHp,
    turns: G.turns,
    gold:  G.p.gold,
    x: G.p.x, y: G.p.y,
  }));
}

// ─── In-browser AI: decide the next action ───────────────────────────────────
// Runs inside the browser context so it can inspect G directly.
// Priority order:
//   1. Auto-heal at <40% HP
//   2. Pick up item at feet
//   3. Trigger stair descent if already standing on >
//   4. Walk toward nearest explored item
//   5. Fight boss (floor 10 only)
//   6. Walk toward explored stairs
//   7. Explore frontier (edge of explored territory)
//   8. Force BFS to stairs ignoring explored state
//   9. Random passable move
async function decide(page) {
  return page.evaluate(() => {
    const px = G.p.x, py = G.p.y;
    const W = 60, H = 30, WALL = 0, STAIRS = 2;

    // Treat walls and the merchant as impassable; enemies are passable (will be attacked).
    function ok(x, y) {
      return x >= 0 && x < W && y >= 0 && y < H
          && G.map[y][x] !== WALL
          && !(G.npc && G.npc.x === x && G.npc.y === y);
    }

    // BFS from player to (tx, ty). exploredOnly restricts traversal to explored tiles.
    // Returns {dx, dy} of the first step, or null if unreachable.
    function bfs(tx, ty, exploredOnly) {
      if (px === tx && py === ty) return null;
      const vis = new Uint8Array(W * H);
      vis[py * W + px] = 1;
      // Flat queue: [x, y, firstDx, firstDy], sentinel 99 = not yet set
      const q = [px, py, 99, 99];
      for (let h = 0; h < q.length; h += 4) {
        const cx = q[h], cy = q[h+1], fdx = q[h+2], fdy = q[h+3];
        for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const nx = cx+dx, ny = cy+dy;
          if (!ok(nx, ny)) continue;
          if (exploredOnly && !G.explored[ny][nx]) continue;
          if (vis[ny*W+nx]) continue;
          vis[ny*W+nx] = 1;
          const nfx = fdx === 99 ? dx : fdx;
          const nfy = fdy === 99 ? dy : fdy;
          if (nx === tx && ny === ty) return { dx: nfx, dy: nfy };
          q.push(nx, ny, nfx, nfy);
        }
      }
      return null;
    }

    // Helper: is this item worth picking up?
    function want(it) {
      if (it.type === 'gold')   return true;
      if (it.type === 'potion') return G.p.inv.length < 5;
      if (it.type === 'weapon') return it.val > (G.p.weapon ? G.p.weapon.val : 0);
      if (it.type === 'armor')  return it.val > (G.p.armor  ? G.p.armor.val  : 0);
      return false;
    }

    // 1. Auto-heal when below 40% HP
    if (G.p.hp / G.p.maxHp < 0.4 && G.p.inv.length > 0)
      return { key: '1' };

    // 2. Item at feet — only pick up if better than what we have.
    //    (Prevents infinite weapon-swap loop: equip new → old drops at feet →
    //     old is inferior → skip → move away next tick.)
    const atFeet = G.items.filter(i => i.x === px && i.y === py);
    if (atFeet.some(want)) return { key: 'g' };

    // 3. Already standing on stairs — trigger descent prompt
    if (G.map[py][px] === STAIRS && (G.depth < 10 || G.bossDefeated))
      return { key: 'Shift+Period' };   // generates e.key === '>'

    // 4. Nearest explored item we actually want
    let best = null, bestD = Infinity;
    for (const it of G.items) {
      if (!G.explored[it.y][it.x]) continue;
      if (!want(it)) continue;
      const d = Math.abs(it.x - px) + Math.abs(it.y - py);
      if (d < bestD) {
        const s = bfs(it.x, it.y, true);
        if (s) { bestD = d; best = s; }
      }
    }
    if (best) return { dx: best.dx, dy: best.dy };

    // 5. Floor 10: pathfind to boss (will fight it en route)
    if (G.depth === 10 && !G.bossDefeated) {
      const boss = G.enemies.find(e => e.isBoss);
      if (boss) {
        const s = bfs(boss.x, boss.y, false);
        if (s) return { dx: s.dx, dy: s.dy };
      }
    }

    // 6. Explored stairs
    let sx = -1, sy = -1;
    for (let y = 0; y < H && sx < 0; y++)
      for (let x = 0; x < W; x++)
        if (G.map[y][x] === STAIRS && G.explored[y][x]) { sx = x; sy = y; break; }
    if (sx >= 0 && (G.depth < 10 || G.bossDefeated)) {
      const s = bfs(sx, sy, true);
      if (s) return { dx: s.dx, dy: s.dy };
    }

    // 7. Frontier exploration — walk toward edges of the explored area
    const frontiers = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!G.explored[y][x] || G.map[y][x] === WALL) continue;
        for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          if (!G.explored[ny][nx] && G.map[ny][nx] !== WALL) {
            frontiers.push({ x, y, d: Math.abs(x-px) + Math.abs(y-py) });
            break;
          }
        }
      }
    }
    frontiers.sort((a, b) => a.d - b.d);
    for (const f of frontiers.slice(0, 25)) {
      const s = bfs(f.x, f.y, true);
      if (s) return { dx: s.dx, dy: s.dy };
    }

    // 8. Force BFS to any stairs regardless of explored state
    if (sx < 0) {
      for (let y = 0; y < H && sx < 0; y++)
        for (let x = 0; x < W; x++)
          if (G.map[y][x] === STAIRS) { sx = x; sy = y; break; }
    }
    if (sx >= 0) {
      const s = bfs(sx, sy, false);
      if (s) return { dx: s.dx, dy: s.dy };
    }

    // 9. Random passable move (last resort)
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]]
      .filter(([dx, dy]) => ok(px+dx, py+dy));
    if (dirs.length) {
      const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
      return { dx, dy };
    }

    return null;
  });
}

// ─── Execute a decision as a keypress ────────────────────────────────────────
async function exec(page, act) {
  if (!act) return;
  if (act.key) {
    await page.keyboard.press(act.key);
  } else {
    const k = act.dy === -1 ? 'ArrowUp'
            : act.dy ===  1 ? 'ArrowDown'
            : act.dx === -1 ? 'ArrowLeft'
            :                 'ArrowRight';
    await page.keyboard.press(k);
  }
}

// ─── Report generator ─────────────────────────────────────────────────────────
function buildReport(floors, outcome, turns) {
  const SEP  = '─'.repeat(56);
  const DSEP = '═'.repeat(56);
  const lines = [
    DSEP,
    '  DUNGEON DEPTHS — LOOT DISTRIBUTION REPORT',
    DSEP,
    `  Outcome : ${outcome}`,
    `  Turns   : ${turns}`,
    '',
  ];

  let totGold = 0, totPots = 0, totWpn = 0, totArm = 0;
  const zeroFloors = [];

  for (let f = 1; f <= 10; f++) {
    const fd = floors[f];
    lines.push(SEP);
    lines.push(`  Floor ${f}`);
    if (!fd) {
      lines.push('    (not reached)');
      continue;
    }
    lines.push(`    Gold    : ${fd.goldPickedUp}g  (${fd.goldCount} pile${fd.goldCount !== 1 ? 's' : ''})`);
    lines.push(`    Potions : ${fd.potions.length ? fd.potions.join(', ') : 'none'}`);
    lines.push(`    Weapons : ${fd.weapons.length ? fd.weapons.join(', ') : 'none'}`);
    lines.push(`    Armor   : ${fd.armor.length   ? fd.armor.join(', ')   : 'none'}`);
    const hasLoot = fd.goldPickedUp > 0 || fd.potions.length || fd.weapons.length || fd.armor.length;
    if (!hasLoot) { lines.push('    *** ZERO LOOT ***'); zeroFloors.push(f); }
    totGold += fd.goldPickedUp;
    totPots += fd.potions.length;
    totWpn  += fd.weapons.length;
    totArm  += fd.armor.length;
  }

  lines.push(DSEP);
  lines.push('  TOTALS');
  lines.push(`    Gold collected : ${totGold}g`);
  lines.push(`    Potions found  : ${totPots}`);
  lines.push(`    Weapons found  : ${totWpn}`);
  lines.push(`    Armor found    : ${totArm}`);
  lines.push(`    Total items    : ${totPots + totWpn + totArm}`);
  lines.push('');
  if (zeroFloors.length) {
    lines.push(`  ⚠  ZERO-LOOT FLOORS: ${zeroFloors.join(', ')}`);
    lines.push('     These floors had no pickable loot — possible spawn bug.');
  } else {
    lines.push('  ✓  All visited floors had at least one loot source.');
  }
  lines.push(DSEP);
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const server  = await startServer();
  const browser = await pw.chromium.launch({ headless: true });
  const page    = await browser.newPage();
  page.setDefaultTimeout(30000);

  console.log('Loading dungeon.html…');
  await page.goto(`http://localhost:${PORT}/dungeon.html`);
  await page.waitForTimeout(600);
  await injectTracker(page);

  // Dismiss initial overlays (lore + tutorial on floor 1)
  await handleOverlays(page);

  let floor = 1, floorTurns = 0, stuckPos = '', stuckN = 0;
  console.log(`\nFloor 1 — starting playthrough`);

  mainLoop: while (true) {
    // Always clear overlays first
    const ovr = await handleOverlays(page);
    if (ovr === 'end') break;

    const s = await readState(page);
    if (s.over) break;

    // Floor transition detected
    if (s.depth !== floor) {
      console.log(`  Floor ${floor} complete → entering floor ${s.depth}  (${floorTurns} turns)`);
      floor = s.depth;
      floorTurns = 0;
      stuckN = 0;
      // Ensure tracker entry exists for the new floor
      await page.evaluate(d => {
        if (!window._loot.floors[d])
          window._loot.floors[d] = { goldPickedUp: 0, goldCount: 0, potions: [], weapons: [], armor: [] };
      }, floor);
      continue;
    }

    // Per-floor turn cap — use 'next' cheat as last resort
    if (++floorTurns > MAX_TURNS) {
      console.log(`  Floor ${floor}: turn cap (${MAX_TURNS}) hit — advancing with cheat`);
      for (const ch of 'next') { await page.keyboard.press(ch); await page.waitForTimeout(60); }
      floorTurns = 0;
      continue;
    }

    // Stuck detection — inject a random move if position unchanged for 20 ticks
    const pos = `${s.x},${s.y}`;
    if (pos === stuckPos) {
      if (++stuckN > 20) {
        const r = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'][Math.floor(Math.random() * 4)];
        await page.keyboard.press(r);
        stuckN = 0;
        await page.waitForTimeout(TICK_MS);
        continue;
      }
    } else {
      stuckPos = pos;
      stuckN   = 0;
    }

    const act = await decide(page);
    await exec(page, act);
    await page.waitForTimeout(TICK_MS);
  }

  // ── Collect final data ──────────────────────────────────────────────────────
  const final  = await readState(page);
  const floors = await page.evaluate(() => window._loot.floors);

  const outcome = final.won  ? `VICTORY (completed all 10 floors)` :
                  final.over ? `DIED on floor ${final.depth}` :
                               `Run ended on floor ${final.depth} (incomplete)`;

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`Result : ${outcome}`);
  console.log(`Turns  : ${final.turns}   Gold held: ${final.gold}g`);
  console.log('─'.repeat(56));

  const report = buildReport(floors, outcome, final.turns);
  fs.writeFileSync(REPORT, report, 'utf8');
  console.log(`\nReport saved → ${REPORT}\n`);
  console.log(report);

  await browser.close();
  server.close();
}

main().catch(err => { console.error(err); process.exit(1); });

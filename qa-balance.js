'use strict';

const pw   = require('C:\\Users\\User\\AppData\\Roaming\\npm\\node_modules\\playwright');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT      = 7435;
const BASE_DIR  = path.resolve(__dirname);
const OUT_DIR   = path.join(BASE_DIR, '.playwright-output');
const MAX_TURNS = 3000;
const TICK_MS   = 20;

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Player profiles ──────────────────────────────────────────────────────────
// healAt        : heal below this HP fraction
// visitMerchant : NPC tile is passable; shop is processed rather than dismissed
// seekMerchant  : actively BFS toward merchant (novice); expert only bumps passively
// buyPotions    : buy potions at the shop
// buyGear       : buy weapon/armor upgrades at the shop
// itemMinBenefit: minimum val improvement before picking up weapon/armor
// rushStairs    : skip loot-seeking; prioritise stairs over exploration
// frontierLimit : max frontier nodes checked per turn
const PROFILES = {
  novice: {
    healAt: 0.60,
    descendAt: 0.80,   // won't descend below this HP fraction if potions available
    fleeAt: 0.55,      // retreat when 2+ enemies adjacent and below this HP
    emergencyAt: 0.20, // retreat from ANY visible enemy if below this HP
    visitMerchant: true, seekMerchant: true,
    buyPotions: true, buyGear: true,
    itemMinBenefit: 1,
    rushStairs: false, frontierLimit: 25,
  },
  experienced: {
    healAt: 0.40,
    descendAt: 0.65,
    fleeAt: 0.40,
    emergencyAt: 0.15,
    visitMerchant: false, seekMerchant: false,
    buyPotions: false, buyGear: false,
    itemMinBenefit: 1,
    rushStairs: false, frontierLimit: 25,
  },
  expert: {
    healAt: 0.20,
    descendAt: 0.50,
    fleeAt: 0.30,
    emergencyAt: 0.10,
    visitMerchant: true, seekMerchant: false,
    buyPotions: false, buyGear: true,
    itemMinBenefit: 2,
    rushStairs: true, frontierLimit: 10,
  },
};

const profileName = process.argv[2] || 'experienced';
const profile = PROFILES[profileName];
if (!profile) {
  console.error(`Unknown profile "${profileName}". Valid: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}
const REPORT = path.join(OUT_DIR, `balance-report-${profileName}.txt`);

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

// ─── Inject balance tracker ───────────────────────────────────────────────────
async function injectTracker(page) {
  await page.evaluate(() => {
    window._bal = {
      floors: {},
      kills: [],
      deathCause: null,
      merchantVisited: false,
    };

    function initFloor(d) {
      if (!window._bal.floors[d]) {
        window._bal.floors[d] = {
          hpOnEntry:        G.p.hp,
          maxHpOnEntry:     G.p.maxHp,
          hpOnExit:         null,
          maxHpOnExit:      null,
          turnsOnFloor:     0,
          enemiesKilled:    [],
          totalDmgDealt:    0,
          totalDmgReceived: 0,
          levelOnEntry:     G.p.lv,
          levelOnExit:      null,
          weaponOnEntry:    G.p.weapon ? G.p.weapon.name : 'Fists',
          weaponOnExit:     null,
          armorOnEntry:     G.p.armor  ? G.p.armor.name  : 'None',
          armorOnExit:      null,
          potionsUsed:      0,
          goldSpent:        0,
        };
      }
      return window._bal.floors[d];
    }

    initFloor(1);

    // Track damage dealt + kills
    const origStrikeEnemy = window.strikeEnemy;
    window.strikeEnemy = function(en) {
      const hpBefore = en.hp;
      const enName   = en.name;
      origStrikeEnemy.apply(this, arguments);
      const dmg = hpBefore - en.hp;
      const fd  = initFloor(G.depth);
      fd.totalDmgDealt += dmg;
      if (en.hp <= 0) {
        fd.enemiesKilled.push(enName);
        window._bal.kills.push({ name: enName, floor: G.depth, turn: G.turns, playerLv: G.p.lv });
      }
    };

    // Track damage received + cause of death
    const origStrikePlayer = window.strikePlayer;
    window.strikePlayer = function(en) {
      const hpBefore = G.p.hp;
      origStrikePlayer.apply(this, arguments);
      const dmg = hpBefore - G.p.hp;
      if (dmg > 0) {
        const fd = initFloor(G.depth);
        fd.totalDmgReceived += dmg;
        if (G.over && !window._bal.deathCause) {
          window._bal.deathCause = {
            cause: 'enemy', killedBy: en.name, dmg,
            floor: G.depth, turn: G.turns, playerLv: G.p.lv,
          };
        }
      }
    };

    // Init new floors on first endTurn; track turns; catch gas deaths
    const origEndTurn = window.endTurn;
    window.endTurn = function() {
      const overBefore = G.over;
      const wasOnGas   = G.gasTiles.size > 0 && G.gasTiles.has(`${G.p.x},${G.p.y}`);
      initFloor(G.depth);
      origEndTurn.apply(this, arguments);
      const fd = window._bal.floors[G.depth];
      if (fd) fd.turnsOnFloor++;
      if (!overBefore && G.over && wasOnGas && !window._bal.deathCause) {
        window._bal.deathCause = {
          cause: 'gas', floor: G.depth, turn: G.turns, playerLv: G.p.lv,
        };
      }
    };

    // Track potion use
    const origUseInvItem = window.useInvItem;
    window.useInvItem = function(i) {
      const it           = G.p.inv[i];
      const invLenBefore = G.p.inv.length;
      origUseInvItem.apply(this, arguments);
      if (it && it.type === 'potion' && G.p.inv.length < invLenBefore)
        initFloor(G.depth).potionsUsed++;
    };

    // Track gold spent at shop
    const origBuyItem = window.buyItem;
    window.buyItem = function(i) {
      const goldBefore = G.p.gold;
      origBuyItem.apply(this, arguments);
      const spent = goldBefore - G.p.gold;
      if (spent > 0) initFloor(G.depth).goldSpent += spent;
    };
  });
}

// ─── Shop handler (visiting profiles only) ────────────────────────────────────
// Buys appropriate items per profile config, then closes the shop overlay.
async function handleShop(page, prof) {
  await page.evaluate((prof) => {
    const npc = G.npc, p = G.p;
    if (!npc) { removeOverlay(); return; }

    let bought = true;
    while (bought) {
      bought = false;
      for (let i = 0; i < npc.stock.length; i++) {
        const it = npc.stock[i];
        if (!it) continue;
        const shouldBuy =
          (it.type === 'potion' && prof.buyPotions && p.gold >= it.price && p.inv.length < 5) ||
          (it.type === 'weapon' && prof.buyGear && p.gold >= it.price &&
            it.val > (p.weapon ? p.weapon.val : 0)) ||
          (it.type === 'armor'  && prof.buyGear && p.gold >= it.price &&
            it.val > (p.armor  ? p.armor.val  : 0));
        if (shouldBuy) { buyItem(i); bought = true; break; }
      }
    }

    window._bal.merchantVisited = true;
    removeOverlay();
  }, prof);
}

// ─── Overlay handler ──────────────────────────────────────────────────────────
async function handleOverlays(page, prof) {
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
    if (kind === 'shop' && prof && prof.visitMerchant) {
      await handleShop(page, prof);
      continue;
    }
    if (kind === 'stairs' && prof) {
      // Don't descend if HP is low and we have potions to heal first
      const ready = await page.evaluate((prof) => {
        return G.p.hp / G.p.maxHp >= prof.descendAt || G.p.inv.length === 0;
      }, prof);
      await page.keyboard.press(ready ? 'y' : 'n');
      await page.waitForTimeout(150);
      continue;
    }
    const key = { stairs: 'y', shop: 'Escape', gamble: 'Enter', lore: 'Space', generic: 'Space' }[kind];
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
  return 'ok';
}

// ─── State snapshot ───────────────────────────────────────────────────────────
async function readState(page) {
  return page.evaluate(() => ({
    over:     G.over,
    won:      G.won,
    depth:    G.depth,
    hp:       G.p.hp,
    maxHp:    G.p.maxHp,
    turns:    G.turns,
    gold:     G.p.gold,
    lv:       G.p.lv,
    xp:       G.p.xp,
    xpNext:   G.p.xpNext,
    weapon:   G.p.weapon ? G.p.weapon.name : null,
    armor:    G.p.armor  ? G.p.armor.name  : null,
    invCount: G.p.inv.length,
    x: G.p.x, y: G.p.y,
  }));
}

// ─── In-browser AI ────────────────────────────────────────────────────────────
// Profile shapes: heal threshold, item selectivity, merchant behaviour, stairs vs explore priority.
async function decide(page, prof) {
  return page.evaluate((prof) => {
    const px = G.p.x, py = G.p.y;
    const W = 60, H = 30, WALL = 0, STAIRS = 2;

    // NPC tile is passable only while a visiting profile hasn't yet visited this floor
    function ok(x, y) {
      if (x < 0 || x >= W || y < 0 || y >= H) return false;
      if (G.map[y][x] === WALL) return false;
      if (G.npc && G.npc.x === x && G.npc.y === y) {
        if (!prof.visitMerchant || window._bal.merchantVisited) return false;
      }
      return true;
    }

    function bfs(tx, ty, exploredOnly) {
      if (px === tx && py === ty) return null;
      const vis = new Uint8Array(W * H);
      vis[py * W + px] = 1;
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

    // itemMinBenefit: novice/experienced take any upgrade (+1), expert only takes +2 or better
    function want(it) {
      if (it.type === 'gold')   return true;
      if (it.type === 'potion') return G.p.inv.length < 5;
      if (it.type === 'weapon') return it.val >= (G.p.weapon ? G.p.weapon.val : 0) + prof.itemMinBenefit;
      if (it.type === 'armor')  return it.val >= (G.p.armor  ? G.p.armor.val  : 0) + prof.itemMinBenefit;
      return false;
    }

    // Retreat helper: move away from the centroid of given threats
    function retreat(threats) {
      let cx = 0, cy = 0;
      for (const e of threats) { cx += e.x; cy += e.y; }
      cx /= threats.length; cy /= threats.length;
      const adx = px - cx, ady = py - cy;
      const pref = Math.abs(adx) >= Math.abs(ady)
        ? [[Math.sign(adx)||1,0],[0,Math.sign(ady)||1],[0,-(Math.sign(ady)||1)],[-(Math.sign(adx)||1),0]]
        : [[0,Math.sign(ady)||1],[Math.sign(adx)||1,0],[-(Math.sign(adx)||1),0],[0,-(Math.sign(ady)||1)]];
      for (const [dx, dy] of pref) {
        const nx = px+dx, ny = py+dy;
        if (ok(nx, ny) && G.explored[ny][nx]) return { dx, dy };
      }
      return null;
    }

    const hpPct = G.p.hp / G.p.maxHp;
    const visEnemies = G.enemies.filter(e => G.visible[e.y][e.x]);
    const adjEnemies = visEnemies.filter(e => Math.abs(e.x-px)+Math.abs(e.y-py) <= 1);

    // 1. Emergency flee — critically low HP, any visible enemy
    if (hpPct < prof.emergencyAt && visEnemies.length > 0) {
      const r = retreat(visEnemies);
      if (r) return r;
      // Can't flee — heal if possible, else fight through
    }

    // 2. Heal (threshold varies by profile)
    if (hpPct < prof.healAt && G.p.inv.length > 0)
      return { key: '1' };

    // 3. Pick up item at feet
    const atFeet = G.items.filter(i => i.x === px && i.y === py);
    if (atFeet.some(want)) return { key: 'g' };

    // 4. Multi-enemy retreat — outnumbered and below flee threshold
    if (adjEnemies.length >= 2 && hpPct < prof.fleeAt) {
      const r = retreat(adjEnemies);
      if (r) return r;
    }

    // 5. Already on stairs — descend only if HP is ready, else heal
    if (G.map[py][px] === STAIRS && (G.depth < 10 || G.bossDefeated)) {
      if (hpPct >= prof.descendAt || G.p.inv.length === 0)
        return { key: 'Shift+Period' };
      return { key: '1' }; // heal first, retry stairs next turn
    }

    // 6. Loot seeking (skipped for expert who rushes stairs)
    if (!prof.rushStairs) {
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
    }

    // 7. Floor 10: fight boss
    if (G.depth === 10 && !G.bossDefeated) {
      const boss = G.enemies.find(e => e.isBoss);
      if (boss) {
        const s = bfs(boss.x, boss.y, false);
        if (s) return { dx: s.dx, dy: s.dy };
      }
    }

    // 8. Seek merchant actively (novice only — expert bumps passively via ok())
    if (prof.seekMerchant && G.npc && !window._bal.merchantVisited) {
      const s = bfs(G.npc.x, G.npc.y, true);
      if (s) return { dx: s.dx, dy: s.dy };
    }

    // 9. Head toward explored stairs
    let sx = -1, sy = -1;
    for (let y = 0; y < H && sx < 0; y++)
      for (let x = 0; x < W; x++)
        if (G.map[y][x] === STAIRS && G.explored[y][x]) { sx = x; sy = y; break; }
    if (sx >= 0 && (G.depth < 10 || G.bossDefeated)) {
      const s = bfs(sx, sy, true);
      if (s) return { dx: s.dx, dy: s.dy };
    }

    // 10. Explore frontier (frontierLimit differs by profile)
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
    for (const f of frontiers.slice(0, prof.frontierLimit)) {
      const s = bfs(f.x, f.y, true);
      if (s) return { dx: s.dx, dy: s.dy };
    }

    // 11. Force BFS to any stairs
    if (sx < 0) {
      for (let y = 0; y < H && sx < 0; y++)
        for (let x = 0; x < W; x++)
          if (G.map[y][x] === STAIRS) { sx = x; sy = y; break; }
    }
    if (sx >= 0) {
      const s = bfs(sx, sy, false);
      if (s) return { dx: s.dx, dy: s.dy };
    }

    // 12. Random passable move
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]]
      .filter(([dx, dy]) => ok(px+dx, py+dy));
    if (dirs.length) {
      const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
      return { dx, dy };
    }

    return null;
  }, prof);
}

// ─── Execute a decision ───────────────────────────────────────────────────────
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

// ─── Report builder ───────────────────────────────────────────────────────────
function buildReport(bal, final, profName, prof) {
  const SEP  = '─'.repeat(54);
  const DSEP = '═'.repeat(54);
  const dc   = bal.deathCause;

  const PROFILE_DESC = {
    novice:      'Heals early (60%), shops for potions & gear, explores fully',
    experienced: 'Heals at 40%, ignores merchant, balanced exploration',
    expert:      'Heals late (20%), shops for gear only, rushes stairs',
  };

  let outcomeLine;
  if (final.won) {
    outcomeLine = 'VICTORY — all 10 floors cleared';
  } else if (final.over && dc) {
    outcomeLine = dc.cause === 'gas'
      ? `DIED on floor ${dc.floor} (poison gas)`
      : `DIED on floor ${dc.floor} (killed by ${dc.killedBy})`;
  } else {
    outcomeLine = `Run ended on floor ${final.depth}`;
  }

  const lines = [
    DSEP,
    '  DUNGEON DEPTHS — BALANCE REPORT',
    `  Profile  : ${profName.toUpperCase()} — ${PROFILE_DESC[profName] || ''}`,
    DSEP,
    `  Outcome  : ${outcomeLine}`,
  ];

  if (dc) {
    if (dc.cause === 'gas')
      lines.push(`  Cause    : Poison gas — floor ${dc.floor}, turn ${dc.turn}`);
    else
      lines.push(`  Killed by: ${dc.killedBy} — floor ${dc.floor}, turn ${dc.turn}, dealt ${dc.dmg} dmg`);
  }

  lines.push(
    `  Final lv : ${final.lv}  (${final.xp} / ${final.xpNext} XP to next)`,
    `  Gold held: ${final.gold}g`,
    `  Turns    : ${final.turns}`,
    '',
  );

  const deathFloor = dc ? dc.floor : null;
  let totalDmgDealt = 0, totalDmgReceived = 0, totalKills = 0, totalGoldSpent = 0;
  const weaponUpgradeFloors = [], armorUpgradeFloors = [];

  for (let f = 1; f <= 10; f++) {
    const fd  = bal.floors[f];
    const tag = f === deathFloor ? '  ← DIED HERE' : '';
    lines.push(SEP);
    lines.push(`  Floor ${f}${tag}`);

    if (!fd) { lines.push('    (not reached)'); continue; }

    const wpnEntry = fd.weaponOnEntry;
    const armEntry = fd.armorOnEntry;
    const wpnExit  = fd.weaponOnExit ?? final.weapon ?? fd.weaponOnEntry;
    const armExit  = fd.armorOnExit  ?? final.armor  ?? fd.armorOnEntry;
    const lvExit   = fd.levelOnExit  ?? final.lv;
    const maxHpX   = fd.maxHpOnExit  ?? fd.maxHpOnEntry;

    lines.push(`    Entered : lv ${fd.levelOnEntry} | ${fd.hpOnEntry}/${fd.maxHpOnEntry} HP | ${wpnEntry} / ${armEntry}`);

    if (f === deathFloor && dc) {
      lines.push(`    Died at : 0/${fd.maxHpOnEntry} HP  (turn ${dc.turn})`);
      lines.push(`    Cause   : ${dc.cause === 'gas' ? 'Poison gas' : `${dc.killedBy} hit for ${dc.dmg} dmg`}`);
    } else if (fd.hpOnExit !== null) {
      lines.push(`    Exited  : lv ${lvExit} | ${fd.hpOnExit}/${maxHpX} HP | ${wpnExit} / ${armExit}`);
    }

    const kills   = fd.enemiesKilled.length;
    const killStr = kills > 0 ? `${fd.enemiesKilled.join(', ')} (${kills})` : 'none';
    lines.push(`    Turns   : ${fd.turnsOnFloor}`);
    lines.push(`    Killed  : ${killStr}`);
    lines.push(`    Dmg out : ${fd.totalDmgDealt}   Dmg in: ${fd.totalDmgReceived}   Potions: ${fd.potionsUsed}   Gold spent: ${fd.goldSpent}g`);

    totalDmgDealt    += fd.totalDmgDealt;
    totalDmgReceived += fd.totalDmgReceived;
    totalKills       += kills;
    totalGoldSpent   += fd.goldSpent;

    if (fd.weaponOnExit && fd.weaponOnExit !== wpnEntry) weaponUpgradeFloors.push(f);
    if (fd.armorOnExit  && fd.armorOnExit  !== armEntry) armorUpgradeFloors.push(f);
  }

  lines.push(
    DSEP,
    '  TOTALS',
    `    Enemies killed : ${totalKills}`,
    `    Damage dealt   : ${totalDmgDealt}`,
    `    Damage taken   : ${totalDmgReceived}`,
    `    Levels gained  : ${final.lv - 1}  (lv 1 → lv ${final.lv})`,
    `    Gold spent     : ${totalGoldSpent}g`,
    '',
  );

  lines.push(DSEP, '  BALANCE NOTES');

  if (final.won) {
    lines.push('  ✓ Full run completed — bot survived all 10 floors');
  } else {
    const reached = Object.keys(bal.floors).map(Number).sort((a, b) => a - b);
    const last    = reached[reached.length - 1] || 1;
    for (let f = 1; f < last; f++) lines.push(`  ✓ Survived floor ${f}`);
    if (deathFloor) lines.push(`  ✗ Died on floor ${deathFloor}`);
  }

  // Damage spike: >35% of total incoming on one floor (min 5 turns to avoid noise)
  if (totalDmgReceived > 0) {
    for (let f = 1; f <= 10; f++) {
      const fd = bal.floors[f];
      if (!fd || fd.turnsOnFloor < 5) continue;
      const pct = Math.round(fd.totalDmgReceived / totalDmgReceived * 100);
      if (pct > 35)
        lines.push(`  ✗ Damage spike on floor ${f}: ${fd.totalDmgReceived} dmg in (${pct}% of run total)`);
    }
  }

  // Gear notes
  if (weaponUpgradeFloors.length > 0)
    lines.push(`  ✓ Weapon upgraded on floor${weaponUpgradeFloors.length > 1 ? 's' : ''}: ${weaponUpgradeFloors.join(', ')}`);
  else
    lines.push('  ✗ No weapon upgrades equipped this run');

  if (armorUpgradeFloors.length > 0)
    lines.push(`  ✓ Armor upgraded on floor${armorUpgradeFloors.length > 1 ? 's' : ''}: ${armorUpgradeFloors.join(', ')}`);
  else
    lines.push('  ✗ No armor upgrades equipped this run');

  // Merchant note
  if (prof.visitMerchant)
    lines.push(totalGoldSpent > 0
      ? `  ✓ Merchant visited — spent ${totalGoldSpent}g`
      : '  ✗ Merchant never reached or had nothing to buy');

  // Avoidable death
  if (!final.won && final.over && final.invCount > 0)
    lines.push(`  ✗ Died with ${final.invCount} potion(s) in inventory — possibly avoidable`);

  if (dc && dc.cause === 'gas')
    lines.push('  ✗ Died to gas — lingered in poison room on floor 5');

  lines.push(DSEP);
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Profile: ${profileName.toUpperCase()}`);
  const server  = await startServer();
  const browser = await pw.chromium.launch({ headless: true });
  const page    = await browser.newPage();
  page.setDefaultTimeout(30000);

  console.log('Loading dungeon.html…');
  await page.goto(`http://localhost:${PORT}/dungeon.html`);
  await page.waitForTimeout(600);
  await injectTracker(page);

  // Dismiss initial lore + tutorial (no shop possible here, pass null)
  await handleOverlays(page, null);

  let floor = 1, floorTurns = 0, stuckPos = '', stuckN = 0;
  console.log('\nFloor 1 — starting playthrough');

  while (true) {
    const ovr = await handleOverlays(page, profile);
    if (ovr === 'end') break;

    const s = await readState(page);
    if (s.over) break;

    // Floor transition — snapshot exit stats and reset per-floor flags
    if (s.depth !== floor) {
      console.log(`  Floor ${floor} complete → entering floor ${s.depth}  (${floorTurns} turns)`);
      await page.evaluate((f) => {
        const fd = window._bal.floors[f];
        if (fd && fd.hpOnExit === null) {
          fd.hpOnExit     = G.p.hp;
          fd.maxHpOnExit  = G.p.maxHp;
          fd.levelOnExit  = G.p.lv;
          fd.weaponOnExit = G.p.weapon ? G.p.weapon.name : 'Fists';
          fd.armorOnExit  = G.p.armor  ? G.p.armor.name  : 'None';
        }
        window._bal.merchantVisited = false; // reset for next floor
      }, floor);
      floor = s.depth;
      floorTurns = 0;
      stuckN = 0;
      continue;
    }

    // Per-floor turn cap
    if (++floorTurns > MAX_TURNS) {
      console.log(`  Floor ${floor}: turn cap (${MAX_TURNS}) hit — advancing with cheat`);
      for (const ch of 'next') { await page.keyboard.press(ch); await page.waitForTimeout(60); }
      floorTurns = 0;
      continue;
    }

    // Stuck detection
    const pos = `${s.x},${s.y}`;
    if (pos === stuckPos) {
      if (++stuckN > 20) {
        const r = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'][Math.floor(Math.random() * 4)];
        await page.keyboard.press(r);
        stuckN = 0;
        await page.waitForTimeout(TICK_MS);
        continue;
      }
    } else { stuckPos = pos; stuckN = 0; }

    const act = await decide(page, profile);
    await exec(page, act);
    await page.waitForTimeout(TICK_MS);
  }

  // Snapshot final floor stats
  const final = await readState(page);
  await page.evaluate((f) => {
    const fd = window._bal.floors[f];
    if (fd && fd.hpOnExit === null) {
      fd.hpOnExit     = G.p.hp;
      fd.maxHpOnExit  = G.p.maxHp;
      fd.levelOnExit  = G.p.lv;
      fd.weaponOnExit = G.p.weapon ? G.p.weapon.name : 'Fists';
      fd.armorOnExit  = G.p.armor  ? G.p.armor.name  : 'None';
    }
  }, floor);

  const bal = await page.evaluate(() => window._bal);

  const outcome = final.won  ? 'VICTORY (all 10 floors)'
                : final.over ? `DIED on floor ${final.depth}`
                :              `Run ended floor ${final.depth}`;

  console.log(`\n${'─'.repeat(54)}`);
  console.log(`Result : ${outcome}`);
  console.log(`Level  : ${final.lv}   Turns: ${final.turns}   Gold: ${final.gold}g`);
  console.log('─'.repeat(54));

  const report = buildReport(bal, final, profileName, profile);
  fs.writeFileSync(REPORT, report, 'utf8');
  console.log(`\nReport saved → ${REPORT}\n`);
  console.log(report);

  await browser.close();
  server.close();
}

main().catch(err => { console.error(err); process.exit(1); });

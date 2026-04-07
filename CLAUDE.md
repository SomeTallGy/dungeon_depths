# Dungeon Depths — CLAUDE.md

## Project overview

Single-file browser roguelike (`dungeon.html`). All game logic, rendering, and styles live in one HTML file. No build step, no dependencies, no server needed — open in browser directly.

`dungeon_mobile.html` is a separate mobile-optimized version. `index.html` is the entry point/landing page.

## Architecture

All mutable game state must live in `G`. Do not introduce state outside it. Each floor is rebuilt via `buildFloor()`, which resets relevant state and regenerates the map.

### Key systems

- **Map**: 60×30 ASCII grid, rooms connected by corridors
- **FOV**: raycasting, fog of war tracked per cell
- **Rendering**: `render()` rebuilds the full `#map` innerHTML each turn
- **Overlay system**: modal cards (lore, tutorial, stairs, shop) use `data-*` attributes (`data-shop`, `data-stairs`, `data-lore`) to route keyboard input
- **Flash/death animation**: single `requestAnimationFrame` loop (`_flashLoop`), self-terminating
- **Cheat codes**: `_cheatBuf` accumulates last 4 typed characters, checked after each `keydown`

### Enemy AI

- Enemies pursue when player is in FOV
- **Hunt state**: when player leaves FOV, enemy chases last known position for ~10 turns (`huntTurns`, `lastKnownX`, `lastKnownY`), then goes dormant
- Prevents peek-and-retreat exploit

### Floor 10 — Hollow King boss

`buildFloor()` branches on floor 10: skips `populate()`, places boss + items only. Boss spawns alone in the last room.
Do not refactor `buildFloor()` branching without asking first.

- 160 HP, 22 ATK, 8 DEF, regenerates 2 HP/turn
- Phase 2 at ≤80 HP: ATK 26, color shifts blue → red, warning message fires once
- Stairs sealed until boss is dead
- Victory: "The Hollow King is slain. The dungeon is free."

## Game constants

| Thing | Value |
|---|---|
| Map size | 60×30 |
| Floors | 10 |
| Enemy types | 12 (Rat → Dragon) |
| Potion cap | 5 |
| Rest healing | 1 HP / 10 turns |
| Merchant reroll | 25g |
| Mystery item | 15g |

## Controls

- **Move/attack**: arrow keys, WASD, numpad (1–9 except 5)
- **Potions**: keys 1–5
- **Stairs**: Y / Enter to descend, N / Esc to cancel
- **Merchant**: bump into cyan `@`, then 1–4 to buy, R to reroll, G for mystery item, Esc to close
- **Cheat codes** (type while playing, no Enter): `next` (skip floor), `god` (toggle god mode)

## Do not touch

- Numpad/inventory key conflict: solved via `e.location === 3`. Do not simplify this.
- Weapon swap order: item reassigned before old one dropped. Order matters.

## Lore / narrative

10-floor story arc (the Hollow King). Lore card shown on each floor entry; tutorial card chains after floor 1 lore.

## Tone

Terse, dark, dry. Lore entries are short — 2-3 sentences max. 
No heroic clichés.

## Do not change without asking

- `G` object structure
- `buildFloor()` floor 10 branching
- Numpad disambiguation (`e.location === 3`)
- Map dimensions (60×30) — layout logic depends on this

## Code style

Match existing style: vanilla JS, functions over classes, 
terse variable names (G, x, y), comments only on non-obvious logic.
# Dungeon Depths — CLAUDE.md

## Project overview
Single-file browser roguelike (`dungeon.html`). Vanilla JS, no build step, no dependencies. `dungeon_mobile.html` is the mobile version. `index.html` is the landing page.

## Architecture
All mutable game state must live in `G`. Do not introduce state outside it.
Each floor rebuilt via `buildFloor()`. Floor 10 branches separately — skips `populate()`, places Hollow King boss only. Stairs sealed until boss is dead.

Key systems: 60×30 ASCII map, raycasting FOV, `render()` rebuilds `#map` innerHTML each turn, overlay system routes input via `data-*` attributes, `_flashLoop` handles animations.

## Do not change without asking
- `G` object structure
- `buildFloor()` floor 10 branching
- Numpad disambiguation (`e.location === 3`) — do not simplify
- Weapon swap order — item reassigned before old one dropped
- Map dimensions (60×30) — layout depends on this

## Code style
Vanilla JS, functions over classes, terse variable names (G, x, y). Comments only on non-obvious logic.

## Tone
Terse, dark, dry. Lore entries 2-3 sentences max. No heroic clichés.

## Tools
Use playwright MCP for all browser automation. Never write raw node scripts that require('playwright'). Save all output to `.playwright-output/`.
Playwright global path: C:\Users\User\AppData\Roaming\npm\node_modules\playwright
Always require() using this full path in any node scripts.
# AGENTS

This file is the shared operating guide for coding agents working in `Neural Bastion`.

Use it as the first-stop project brief before making changes.

## Project Summary

- Project: `Neural Bastion`
- Stack: plain JavaScript, ES modules, Canvas 2D, lightweight ECS
- Platform target: mobile-first portrait game, still readable on desktop
- Local game URL: `http://localhost:6969`
- Admin URL: `http://localhost:6969/admin.html`
- Safe dev server:
  - `python3 scripts/dev_static_server.py --port 6969`
  - `bash scripts/ensure_dev_server.sh 6969`

This is a prototype-heavy game project. Most gameplay and rendering logic lives in one main file, so agents must work carefully and verify side effects.

## Core Rules For Agents

1. If gameplay logic changes, update [docs/GAME_LOGIC_HD.md](/home/dev/rnn-glider/docs/GAME_LOGIC_HD.md) in the same change set.
2. If a temporary screenshot is added to diagnose a bug, delete it as soon as it has been read and is no longer needed, in the same fix change set.
3. Prefer minimal, targeted changes over broad refactors unless the task explicitly requires restructuring.
4. Keep mobile layout quality high. Many regressions in this project are mobile UI regressions.
5. Do not silently change game balance when the task is purely visual.
6. If a task affects reward flow, camp flow, drag-and-drop, inspect popups, or boss logic, test those paths explicitly. They are common regression zones.

## Codebase Layout

- [src/main.js](/home/dev/rnn-glider/src/main.js)
  Bootstraps world state, input, main loop, and top-level systems.

- [src/ecs/world.js](/home/dev/rnn-glider/src/ecs/world.js)
  Minimal ECS/world storage.

- [src/game/systems.js](/home/dev/rnn-glider/src/game/systems.js)
  Main gameplay file.
  Contains:
  - combat updates
  - rendering
  - UI overlays
  - route map
  - reward/shop/camp flows
  - drag-and-drop
  - inspect popups
  - boss behavior glue

- [src/game/network.js](/home/dev/rnn-glider/src/game/network.js)
  Neural route simulation and packet/charge behavior.

- [src/game/upgrades.js](/home/dev/rnn-glider/src/game/upgrades.js)
  Upgrade catalog, validation, and application.

- [src/game/spawners.js](/home/dev/rnn-glider/src/game/spawners.js)
  Factories for enemies, projectiles, flashes, floating text, and other spawned entities.

- [src/game/config.js](/home/dev/rnn-glider/src/game/config.js)
  Shared constants, colors, and layout helpers.

- [src/game/catalog.js](/home/dev/rnn-glider/src/game/catalog.js)
  Legendary perk catalog.

- [src/game/enemy_catalog.js](/home/dev/rnn-glider/src/game/enemy_catalog.js)
  Enemy reference data used by admin tooling.

- [src/admin.js](/home/dev/rnn-glider/src/admin.js)
  Admin UI logic and roadmap/editor behavior.

- [admin.html](/home/dev/rnn-glider/admin.html)
  Local admin UI for roadmap, upgrades, legendary items, and enemies.

## Current Game Model

High-detail source of truth lives in [docs/GAME_LOGIC_HD.md](/home/dev/rnn-glider/docs/GAME_LOGIC_HD.md). Keep that file aligned with actual code.

Short version:

- The run starts on a route map.
- Three branch themes exist:
  - northwest: worms
  - northeast: beetles
  - south: spiders
- Only the first battle uses a pre-battle upgrade screen.
- Most later upgrades are post-combat.
- Camp offers:
  - heal
  - neuron empower flow
- Boss is at branch depth `13`.
- Depth `12` guarantees `shop` and `camp` before boss.
- Clearing a boss completes that branch, persists meta progress, and restarts from base with the branch marked complete.

## Critical Runtime Phases

Agents changing flow logic must understand the major `phase.name` states in [src/game/systems.js](/home/dev/rnn-glider/src/game/systems.js).

Important ones:

- `map`
- `combat`
- `combat_finish`
- `reward_drag`
- `shop`
- `camp`
- `camp_finish`
- `legendary_drop`

There is legacy/special-case code for some older phases too, but current preferred flows lean on the regular combat/reward screens rather than custom mini-layouts.

## High-Risk Systems

These parts break easily and should be treated as regression-sensitive:

- Drag-and-drop upgrades
- Reordering installed modules
- Same-type merge behavior
- Inspect popup opening/closing rules
- Reward/shop/camp toolbar buttons
- Mobile card layout in reward/shop/camp
- Signal animation and held-route visuals
- Boss abilities and branch-specific enemy behavior

If you touch any of those, test the related screen directly.

## Known Interaction Conventions

- Reward and shop both use drag-on-neuron interactions.
- Installed modules can be moved outside combat when the network is visible.
- Same-type installed modules can merge up to the current merge cap.
- Inspect popups should not open as a side effect of a drag action.
- Camp empower should behave like a familiar reward-style drag flow, not like a custom one-off screen.

## Visual And UI Conventions

- Preserve the portrait-first composition.
- Keep overlays transparent enough that the network remains readable when required.
- Reward and shop should feel like the same UI family unless a task explicitly differentiates them.
- Avoid introducing top/bottom bars or borders that look like accidental panel artifacts.
- For mobile, prioritize spacing, card containment, and text legibility over decorative complexity.

## Admin Expectations

The admin UI is local-only. It does not save to a backend.

Use [src/admin.js](/home/dev/rnn-glider/src/admin.js) to:

- add roadmap items
- expose new upgrade data
- expose legendary items
- expose enemies

Do not assume admin draft edits affect runtime game data automatically.

## Debug Mode

Debug mode exists in the game page:

- `http://localhost:6969/#dev`
- `http://localhost:6969/?dev=1`

Use it to:

- jump to branch depth
- force branch theme
- set test loadouts
- test bosses and pre-boss routing faster

Do not build debug workflows that require a backend.

## Recommended Workflow For Agents

1. Read the user request carefully.
2. Inspect the relevant area of [src/game/systems.js](/home/dev/rnn-glider/src/game/systems.js) first.
3. If gameplay behavior changes, also inspect:
   - [src/game/network.js](/home/dev/rnn-glider/src/game/network.js)
   - [src/game/upgrades.js](/home/dev/rnn-glider/src/game/upgrades.js)
   - [src/game/spawners.js](/home/dev/rnn-glider/src/game/spawners.js)
4. Make the smallest coherent change.
5. Run targeted syntax checks:
   - `node --check src/game/systems.js`
   - or the file(s) you changed
6. Update [docs/GAME_LOGIC_HD.md](/home/dev/rnn-glider/docs/GAME_LOGIC_HD.md) if gameplay logic changed.
7. Remove any temporary screenshot used during debugging.

## Change Checklist

Before finishing a task, verify:

- syntax check passes on changed JS files
- mobile layout is still coherent
- buttons do not overlap cards or text
- drag/drop still works if the task touched overlay/layout/input code
- inspect popups still behave if the task touched pointer handling
- gameplay doc is updated if logic changed
- no temporary screenshots remain in the repo

## When To Refactor

Refactor only if at least one of these is true:

- the current logic is actively blocking the requested feature
- multiple branches of special-case UI are causing repeated bugs
- the same bug pattern is appearing across reward/shop/camp because of duplicated layout logic

Otherwise prefer local fixes. This codebase moves fast and broad cleanup can break working flows.

## Current Development Priorities

Check the admin roadmap for the live list, but generally the next-value areas are:

- camp flow polish
- reroll UX and balance
- shield visualization
- turret power buildup visuals
- topology occupying connection space instead of node body
- scrollable route-map camera
- deterministic seeded runs

## Current Handoff Snapshot

Use this section as the fast resume point for the next coding agent.

### Recently Stabilized

- Route-map progression with branch themes is in place.
- Boss depth is `13`, with forced `shop/camp` at depth `12`.
- Branch bosses now have distinct first-pass behaviors:
  - spider boss keeps shield
  - beetle boss summons tiny fast beetles
  - worm boss uses a butterfly first form and splits on death
- Reward and shop use closely related card layouts.
- Reward screen has `Leave`.
- Camp now has:
  - `Heal Base`
  - `Upgrade Neuron`
- Camp upgrade is intended to use the same familiar drag-on-neuron flow as reward screens.

### Current Fragile Areas

- `src/game/systems.js` remains the highest-risk file.
- Reward/shop/camp layouts are still easy to regress on mobile.
- Drag-and-drop, merge, and inspect popup interactions can interfere with each other.
- Camp upgrade flow has recently been changed and must be tested directly after any related edit.

### Things To Test After Editing UI Or Flow

- `reward_drag`
- `shop`
- `camp`
- `camp_finish`
- drag reorder of installed modules
- same-type merge by dragging one installed module onto another
- inspect popup should not open after a drag gesture

### Known Intentions

- Camp empower should visibly apply `+1` white damage and then land in a normal review state.
- Merge should feel visual and readable, including when merge is triggered by drag-reorder.
- Reward and shop should feel like the same UI family, not like two unrelated overlays.
- Mobile layout quality is not optional. If the screen looks cramped or misaligned on phone, it is not done.

## Agent Handoff Notes

When handing work to another agent or resuming later, include:

- which `phase` or screen is affected
- whether the issue is logic, render, layout, or input
- which file is the real source of truth
- whether [docs/GAME_LOGIC_HD.md](/home/dev/rnn-glider/docs/GAME_LOGIC_HD.md) was updated
- whether any temporary screenshots were created and removed

This project is easiest to maintain when agents describe the flow they changed, not just the file they edited.

# Repository Guidelines

## Project Structure & Module Organization
`rnn-glider` is a dependency-free 2D Canvas prototype using ES modules and a lightweight ECS.
- `index.html`: entry page and canvas container.
- `src/main.js`: bootstraps world state, systems, and the game loop.
- `src/ecs/world.js`: ECS core (entities, components, queries).
- `src/game/constants.js`: gameplay tuning values.
- `src/game/spawners.js`: entity creation/reset helpers.
- `src/game/systems.js`: gameplay and render systems.

Keep gameplay logic in systems, not in rendering or bootstrapping code.

## Build, Test, and Development Commands
No build step is required.
- `python3 -m http.server 8080`: serve the project locally.
- Open `http://localhost:8080`: run the prototype in browser.

Use a local server (not `file://`) so ES module imports resolve correctly.

## Coding Style & Naming Conventions
- Use plain JavaScript (ES modules), no external dependencies.
- Indentation: 2 spaces; keep files ASCII unless needed.
- Filenames: lowercase with dashes only when needed (`main.js`, `world.js`).
- Variables/functions: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- ECS component names are `PascalCase` strings (for example `Transform`, `Enemy`).

Prefer small, single-purpose systems (`movementSystem`, `collisionSystem`, etc.).

## Testing Guidelines
Automated tests are not configured yet; validate behavior manually in-browser:
- Ship moves left to right and wraps.
- Ship auto-fires 5 bullets per burst.
- Enemy spheres move right to left with visible HP numbers.
- Bullet hit applies 1 damage; ship-enemy contact applies 1 damage.
- Game over at ship HP `0`; `R` restarts.

When adding tests later, place them under `tests/` and mirror `src/` structure.

## Commit & Pull Request Guidelines
Adopt Conventional Commits:
- `feat: add enemy spawn balancing`
- `fix: prevent double collision damage`
- `chore: refactor ecs query`

PRs should include:
- Clear summary of gameplay/tech changes.
- Manual test checklist with observed results.
- Screenshot or short recording for visible behavior updates.

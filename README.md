# Neural Bastion

Mobile-first sci-fi lane defense prototype built with plain JavaScript, ES modules, Canvas 2D, and a lightweight ECS.

## Run

Serve the repository root with the bundled static-only dev server:

```bash
python3 scripts/dev_static_server.py --port 6969
```

Or use the safe launcher, which starts it only if nothing is already serving on that port:

```bash
bash scripts/ensure_dev_server.sh 6969
```

Open `http://localhost:6969`.

Admin tools: `http://localhost:6969/admin.html`

## Current Vertical Slice

- One central turret across a portrait-first battlefield
- Enemies descend from the top toward the base shield and core
- A visible neural network charges over time and powers the turret
- Route-map progression with branch themes, elite rooms, shop, camp, and bosses
- Upgrade mix covering projectile effects, topology, summons, and legendary perks

## Gameplay Documentation Rule

Detailed gameplay logic and architecture are documented in [docs/GAME_LOGIC_HD.md](/home/dev/rnn-glider/docs/GAME_LOGIC_HD.md).

When gameplay logic changes, that file must be updated in the same change set.

When a temporary screenshot is dropped into the repository to diagnose a bug, it must be deleted as soon as it has been read and is no longer needed, in the same fix change set.

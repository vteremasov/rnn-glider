# rnn-glider

`rnn-glider` is a dependency-free 2D canvas prototype built with plain JavaScript, ES modules, and a lightweight ECS.

## Run locally

Serve the repository root with a local web server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Current game loop

- Move the ship with `W/A/S/D`
- Auto-fire from 5 guns
- Upgrade the weapon network through normal and miniboss reward cards
- Survive enemy waves, minibosses, and the final boss

## Deploy

The repository is configured for GitHub Pages through `.github/workflows/pages.yml`.
Push to `main` to deploy the static site.

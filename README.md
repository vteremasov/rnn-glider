# rnn-glider

`rnn-glider` is a dependency-free 2D canvas prototype built with plain JavaScript, ES modules, and a lightweight ECS.
The current theme is a reactor-defense lab where a signal lattice powers one central discharge turret.

## Run locally

Serve the repository root with a local web server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Current game loop

- Move the defense core with `W/A/S/D`
- Auto-fire from one central turret using routed signal bursts
- Upgrade the relay lattice through normal and miniboss reward cards
- Survive enemy waves, sub-cores, and the final rogue core

## Deploy

The repository is configured for GitHub Pages through `.github/workflows/pages.yml`.
Push to `main` to deploy the static site.

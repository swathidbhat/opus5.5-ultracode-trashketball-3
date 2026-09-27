# Trashketball

A first-person 3D paper-toss game built with three.js. Crumple, aim, and shoot paper balls into the bin.

- **Level 1: Macrodata Refinement.** A Severance-style Lumon office: green carpet, white walls, fluorescent
  ceiling grid, the four-desk MDR cluster, and a wire-mesh wastebasket.
- **Level 2: Casa Marea.** A double-height beachside Airbnb with designer sofas, a floor-to-ceiling glass wall,
  an animated ocean at golden hour, and a woven rattan basket.

Every basket is worth 10 points. Reach 100 points to leave the severed floor; reach 200 in the beach house to win.
After each basket you move to a new shot spot around the room.

## Play

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Take aim | Click the game to capture the mouse, then move it (or A / D, ← / →) | Drag on the scene |
| Launch angle | Move the mouse up or down (or W / S, ↑ / ↓) | Drag up or down |
| Power | Hold the button and pull the mouse back (down) for more, push forward for less; release to throw. Scroll to fine-tune | Hold the throw button and slide up for more; release to throw (slide sideways off it to cancel) |
| Keyboard throw | Hold Space, set power with ↑ / ↓, release Space | |
| Cancel a wind-up | Right-click | Slide off the button sideways |
| Full trajectory guide | G | Tap the angle chip |
| Pause | P or Esc | Pause button |
| Mute | M | Sound button |

Power is remembered between throws, and the aiming arc updates live as you change it. The dotted arc shows
the first part of the throw (60% of the way to the bin in the office, 45% in the beach house); the rest is up
to your judgement, or press G for the full arc with its landing point. Every throw leaves a trail so you can
see where it went.

URL options: `?level=2` starts in the beach house, `?debug=1` draws the collision shapes.

## How it works

- `src/physics.js`: a small custom rigid-sphere simulation (fixed 240 Hz step, gravity, quadratic air drag,
  per-material restitution and friction). The bin is modelled exactly as an open truncated cone with a rim torus,
  so rim-outs, wall rattles and swishes behave physically. The aiming guide runs the same integrator.
- `src/aim.js`: camera framing, release point and launch velocity as pure functions of the aim, shared by the
  game and offline tuning, so the guide is exactly the throw.
- `src/levels/`: each level builds its own scene, lights, colliders, bin and shot spots. All textures are drawn
  procedurally on canvases, so there are no image or model files.
- `src/audio.js`: every sound is synthesised with the Web Audio API.
- `src/main.js`: renderer, camera, game loop, scoring and level flow.

More detail, including the level and bin contracts, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Scripts

- `npm run dev`: development server
- `npm run build`: production build into `dist/`
- `npm test`: physics and aiming unit tests (Node's built-in test runner)
- `dev/preview.html?level=office&view=overview&debug=1`: level viewer for scene work
- `dev/ui-preview.html?state=hud&theme=office`: HUD and menu states in either theme; `?test=input` runs the
  input tests in the browser

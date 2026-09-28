# Architecture

Trashketball is plain JavaScript ES modules on Vite and three.js. There are no binary assets: every texture is
drawn on a canvas at load time and every sound is synthesised with Web Audio.

Units are metres, seconds and radians. +Y is up, the floor is at y = 0 in both levels, and at yaw 0 the player
faces -Z. Shared tuning lives in `src/config.js` (`PHYS`, `THROW`, `RULES`).

| Module | Role |
| --- | --- |
| `src/main.js` | Renderer, camera, game loop, scoring, level flow, pause, test hooks |
| `src/aim.js` | Camera framing, release point and launch velocity as pure functions of the aim (DOM-free) |
| `src/physics.js` | Fixed-step sphere physics, bin model, events, trajectory prediction (DOM-free) |
| `src/trajectory.js` | Aiming guide (dotted arc, impact marker) and flight trail |
| `src/paperBall.js` | Crumpled paper-ball meshes (cached variants per theme) |
| `src/input.js` | Pointer lock, keyboard, touch controls |
| `src/ui.js`, `src/styles.css` | DOM HUD, cards and menus in two themes |
| `src/audio.js` | Synthesised sound effects and ambience |
| `src/effects.js` | Confetti burst for a made basket |
| `src/levels/office.js` (+ `office/`) | Level 1, Lumon's Macrodata Refinement room |
| `src/levels/beach.js` (+ `beach/`) | Level 2, the Casa Marea beach house |

## Levels

Each level module exports an async factory that builds a complete scene and returns a LevelDef.

```js
export async function createOfficeLevel(ctx) { /* ... */ }
export async function createBeachLevel(ctx) { /* ... */ }

ctx = { renderer, pmrem, maxAnisotropy }

levelDef = {
  id: 'office' | 'beach',
  name, subtitle,          // shown on the HUD and the cards
  theme: 'office' | 'beach', // UI theme, guide colours, audio ambience
  scene,                   // lights, shadows, environment, all meshes including the bin
  exposure,                // renderer.toneMappingExposure for this level
  guideReach,              // share of the horizontal distance to the bin the short guide reveals
  maxPitch,                // optional launch-angle cap (radians); both levels use 55°
  bin: BinDef,
  colliders: Colliders,
  shotSpots: [{ eye: Vector3, label }], // the player moves to the next one after each basket
  update(dt, elapsed),     // cheap per-frame animation (flicker, waves, curtains)
  dispose(),               // frees only what the level created
}
```

### BinDef: the shape physics collides against

The bin is an open-topped truncated cone standing on the floor. Physics works in its meridian (r, y) half-plane.

```
bin = {
  position,        // centre of the base, on the floor
  height,          // base to the top of the rim
  radiusBottom,    // outer radius at the base
  radiusTop,       // outer radius at the top of the wall
  wallThickness,   // side wall collision thickness
  floorThickness,  // bottom plate collision thickness
  rimTube,         // radius of the rim bead (>= wallThickness / 2)
  object,          // the visual, already in the scene
  sound: 'metal' | 'wicker',
  kind,            // visual only
}
```

Derived geometry (visuals match it within a few millimetres):

- Rim: a torus centred at `yRim = position.y + height - rimTube` with major radius `R = radiusTop - wallThickness / 2`
  and tube radius `rimTube`.
- Side wall: the segment from `(radiusBottom - wallThickness / 2, position.y)` to `(R, yRim)`, thickened by
  `wallThickness / 2` on each side, so balls collide with it from inside and outside.
- Bottom plate: the segment from `(0, floorThickness / 2)` to `(radiusBottom - wallThickness / 2, floorThickness / 2)`,
  thickened by `floorThickness / 2`.
- The opening radius at the top is `R - rimTube`.

### Colliders

```
colliders = {
  room: { min, max, materials: { floor, ceiling, px, nx, pz, nz } }, // balls stay inside
  boxes: [{ min, max, material }],                              // axis-aligned solids
  cylinders: [{ x, z, radius, yMin, yMax, material }],          // upright solids
}
material: 'floor' | 'carpet' | 'wall' | 'glass' | 'furniture' | 'soft' | 'ceiling'
```

Colliders are coarse approximations of the visuals. None may overlap the bin or block the view and throwing arc
from a shot spot. `?debug=1` (in the game) or `dev/preview.html?debug=1` draws them as wireframes.

## Physics (`src/physics.js`)

- Semi-implicit Euler at a fixed 240 Hz with gravity and quadratic drag (`PHYS.dragK`), with extra sub-steps at
  high speed so the thin bin wall can never be tunnelled.
- Contacts push the ball out, reflect the normal velocity by the material's restitution, and remove a share of
  the tangential velocity. Resting balls sleep until something touches them; ball piles are relaxed iteratively.
- `PhysicsWorld.step(frameDt)` returns events:
  - `{ type: 'bounce', ball, material, speed }`: material includes `'rim'`, `'binWall'`, `'binFloor'`, `'ball'`
  - `{ type: 'score', ball, swish }`: once per ball, when it is conclusively inside the bin
  - `{ type: 'rest', ball, reason }`: a ball that will not go in (settled, timed out, or cannot reach the rim)
- `predictTrajectory(world, origin, velocity)` runs the same integrator and stops at the first contact. It
  returns the sampled points and times, the first `hit`, and an `entry` when the path drops through the opening.

## Aiming (`src/aim.js`)

Everything that decides where a throw goes is a pure function of the shot spot and the current aim (yaw,
launch pitch, power). None of it depends on how long a button was held, so the arc the guide draws is exactly the
arc that a tap or a long wind-up throws.

- `framingFor(bin, spot)`: base camera yaw and pitch facing the bin.
- `aimPitch(view, launchPitch, power, fov, reachShare, arcTop)`: tilts the camera just enough to keep the
  revealed arc below the HUD, without letting the rim leave the bottom of the frame.
- `flightFollow(...)`: the same idea for the ball in flight.
- `releaseOrigin(eye, yaw, pitch, hand)`: the hand's camera-space offset in world space.
- `throwVelocity(view, origin, yaw, launchPitch, power)`: the launch velocity. Its yaw converges on the view
  centre at the bin's distance, so the reticle means what it says even though the hand is off to the right.

`main.js` draws the guide from these every frame and, on release, throws exactly the aim the guide drew last
frame. The ball in hand is a cosmetic child of a fixed hand point; its wind-up animation never moves the
release point.

## Controls (`src/input.js`)

Power is a persistent 0..1 setting (`THROW.defaultPower` at the start of a level).

- Mouse (pointer lock): moving aims (X is yaw, Y is launch pitch). Holding the button and pulling back raises
  power, pushing forward lowers it, and releasing throws. The wheel fine-tunes power; right-click cancels a
  wind-up.
- Keyboard: arrows or WASD aim; holding Space winds up, Up/Down set power, and releasing Space throws.
- Touch: dragging the scene aims. Holding the throw button and sliding up raises power; releasing throws, and
  releasing after sliding sideways off the button cancels. The HUD power meter can also be dragged.
- G toggles the full guide (tap the angle chip on touch), P / Esc pause, M mutes.

## Rendering policy (`src/main.js`)

- ACES tone mapping, sRGB output, PCF shadows. The pixel ratio is capped at 1.5 and steps down by 0.25 if frames
  stay slow. A step that does not help is undone, because that means a browser frame cap rather than a busy GPU.
- `renderer.shadowMap.autoUpdate` is off. Shadow maps are redrawn only while a ball is awake, the bin is
  wobbling, a retired ball is fading, or a level has just loaded.
- While paused, one frame is drawn and then the loop idles.
- Levels are code-split. The beach chunk is prefetched after boot and built while the level-complete card is up.
  If the chunk cannot be fetched, the error screen offers a reload straight into the next level.

## Testing

- `npm test`: physics and aiming unit tests (Node's built-in runner; both modules are DOM-free).
- `dev/ui-preview.html?test=input`: input tests in the browser; other `?state=` values show each HUD and card state.
- `dev/preview.html?level=office|beach&view=spot0..5|overview&debug=1`: a level on its own, for scene work.
- `window.__trashketball` exposes test hooks (`throwWith`, `predict`, `gotoSpot`, `skipTo`, and the game state)
  for scripted play-throughs.

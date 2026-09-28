// Shared tuning constants.
// Units: meters, seconds, radians. +Y is up. At yaw 0 the player faces -Z.

const deg = (d) => (d * Math.PI) / 180;

export const PHYS = {
  gravity: 9.81,
  dt: 1 / 240, // fixed physics step
  maxStepsPerFrame: 40, // clamp so a stalled tab doesn't spiral
  ballRadius: 0.045, // crumpled A4 sheet, ~9 cm across
  // Quadratic air drag: a = -dragK * |v| * v. Real paper balls are draggier;
  // this keeps the arc readable while still bending the tail of long throws.
  dragK: 0.055,
  // Coefficients of restitution per surface material.
  restitution: {
    floor: 0.32,
    carpet: 0.22,
    wall: 0.38,
    glass: 0.34,
    furniture: 0.32,
    soft: 0.12, // sofas, cushions, upholstered chairs
    ceiling: 0.1, // acoustic tiles
    rim: 0.42,
    binWall: 0.28,
    binFloor: 0.1,
    ball: 0.3,
  },
  // Fraction of tangential velocity removed on each contact.
  friction: {
    floor: 0.35,
    carpet: 0.55,
    wall: 0.25,
    glass: 0.1,
    furniture: 0.3,
    soft: 0.7,
    ceiling: 0.05,
    rim: 0.2,
    binWall: 0.3,
    binFloor: 0.6,
    ball: 0.3,
  },
  rollingDamping: 2.5, // 1/s, slows balls rolling on a surface
  restSpeed: 0.06, // below this speed while in contact, a ball starts to settle
  restTime: 0.35, // seconds below restSpeed before a ball is considered at rest
  maxFlightTime: 7, // seconds before an unresolved ball counts as a miss
};

export const THROW = {
  minSpeed: 2.2,
  maxSpeed: 10.5,
  minPitch: deg(0),
  maxPitch: deg(70),
  defaultPitch: deg(30),
  yawRange: deg(55), // max yaw offset either side of the shot spot's facing
  // Power is a persistent 0..1 setting. Holding the throw button and pulling the mouse back (down)
  // raises it, pushing forward lowers it; the aiming arc updates live, and release throws.
  // A basket from ~3 m is a window of about 0.02 power, so the controls are geared finely:
  // that window is ~18 px of mouse travel.
  defaultPower: 0.3,
  pullPixels: 900, // pointer-lock mouse travel for the full 0 -> 1 range
  touchPullPixels: 700, // finger travel on the throw button for the full range
  wheelStep: 0.01, // power change per mouse-wheel notch
  keyPowerRate: 0.15, // power per second while Space is held with Up/Down (Shift for faster)
  // Where the held ball sits, in camera space (right, up, back).
  handOffset: { x: 0.17, y: -0.15, z: -0.4 },
  mouseSensitivity: 0.0022, // radians per pixel of pointer-lock movement
};

export const RULES = {
  pointsPerBasket: 10,
  pointsPerLevel: 100, // level N is cleared at N * pointsPerLevel total points
  levelIds: ['office', 'beach'],
  maxLooseBalls: 14, // missed balls left lying around before the oldest fade out
  nextBallDelay: 0.55, // seconds after a throw resolves before the next ball is ready
};

export { deg };

export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

export const SHIP = {
  hp: 5,
  controlSpeed: 240,
  radius: 26,
  fireInterval: 0.22,
  gunOffsetsY: [-34, -17, 0, 17, 34],
  muzzleOffsetX: 34,
  renderScale: 1.25,
  upgradeRenderScale: 3.6,
};

export const BULLET = {
  speedX: 440,
  radius: 4,
  damage: 1,
  startSpeedFactor: 0.22,
  easeDuration: 0.32,
};

export const ELECTRIC = {
  radius: 135,
  damageFactor: 0.35,
};

export const ENEMY = {
  spawnInterval: 0.65,
  minRadius: 13,
  maxRadius: 34,
  minSpeed: 52,
  maxSpeed: 98,
};

export const MINIBOSS = {
  baseRadius: 68,
  radiusPerTier: 14,
  speed: 38,
  baseHp: 900,
  hpPerTier: 600,
};

export const BOSS = {
  radius: 160,
  speed: 28,
  hp: 16000,
};

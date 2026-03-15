export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

export const LAYOUT = {
  sidebarWidth: 560,
  panelPadding: 24,
  battlePadding: 28,
};

export const SHIP = {
  hp: 10,
  controlSpeed: 240,
  radius: 40,
  fireInterval: 0.6,
  burstSpacing: 0.08,
  gunOffsetsY: [0],
  muzzleOffsetX: 48,
  renderScale: 1.85,
  upgradeRenderScale: 4.9,
};

export const BULLET = {
  speedX: 440,
  radius: 8,
  damage: 1,
  startSpeedFactor: 0.22,
  easeDuration: 0.32,
};

export const ENEMY_BULLET = {
  speed: 260,
  radius: 10,
  damage: 1,
};

export const ENEMY = {
  spawnInterval: 0.65,
  minRadius: 40,
  maxRadius: 86,
  minSpeed: 28,
  maxSpeed: 54,
};

export const MINIBOSS = {
  baseRadius: 112,
  radiusPerTier: 28,
  speed: 42,
  anchorY: GAME_HEIGHT * 0.34,
  fireInterval: 1.45,
  baseHp: 1800,
  hpPerTier: 1200,
};

export const BOSS = {
  radius: 286,
  speed: 32,
  anchorY: GAME_HEIGHT * 0.36,
  fireInterval: 1.1,
  hp: 32000,
};

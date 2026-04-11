import { laneCenterX } from "./config.js";

export function createEnemy(world, lane, kind) {
  const entity = world.createEntity();
  const layout = world.resources.layout;
  const fieldTop = layout && typeof layout.fieldTop === "number" ? layout.fieldTop : 0;
  const unit = layout && layout.cell ? layout.cell : 16;
  const laneSpacing = layout && typeof layout.laneSpacing === "number" ? layout.laneSpacing : unit * 2.4;
  const isBeetle = kind.family === "beetle";
  const radius = kind.boss
    ? Math.max(unit * (isBeetle ? 1.12 : 0.9), Math.min(kind.radius, unit * (isBeetle ? 1.92 : 1.28)))
    : kind.elite
    ? Math.max(unit * (isBeetle ? 0.74 : 0.52), Math.min(kind.radius, unit * (isBeetle ? 1.2 : 0.82)))
    : Math.max(unit * (isBeetle ? 0.22 : 0.22), Math.min(kind.radius, unit * (isBeetle ? 0.58 : 0.38)));
  const spawnY = fieldTop - radius - unit * 0.4;
  const laneX = layout && typeof layout.gridWidth === "number"
    ? laneCenterX(layout, lane)
    : lane * laneSpacing;
  const bossSweepAnchorOffset = kind.boss && layout
    ? layout.gridX + layout.gridWidth * 0.5 - laneX
    : 0;
  world.addComponent(entity, "enemy", {
    lane,
    y: spawnY,
    radius,
    elite: !!kind.elite,
    boss: !!kind.boss,
    family: kind.family || "spider",
    shape: kind.shape || "square",
    hp: kind.hp,
    maxHp: kind.hp,
    shield: kind.shield || 0,
    maxShield: kind.shield || 0,
    speed: kind.speed,
    reward: kind.reward,
    damage: kind.damage,
    tint: kind.tint,
    bossAbility: kind.bossAbility || null,
    bossStage: kind.bossStage || (kind.shape === "butterfly" ? "butterfly" : null),
    summonInterval: typeof kind.summonInterval === "number" ? kind.summonInterval : 0,
    summonTimer: typeof kind.summonInterval === "number" ? kind.summonInterval : 0,
    splitTriggered: false,
    status: {
      burn: 0,
      curse: 0,
      slow: 0,
      freeze: 0,
    },
    pushImpulse: 0,
    pushbackResistance: typeof kind.pushbackResistance === "number" ? kind.pushbackResistance : 1,
    shieldKnockbackDistance: typeof kind.shieldKnockbackDistance === "number" ? kind.shieldKnockbackDistance : 1,
    shieldHitFlash: 0,
    shieldVisualPulse: Math.random() * Math.PI * 2,
    hitFlash: 0,
    hitNudgeX: 0,
    hitNudgeY: 0,
    burnTickTimer: 0,
    burnTickAccum: 0,
    curseTickTimer: 0,
    curseTickAccum: 0,
    burnHold: 0,
    curseHold: 0,
    xOffset: 0,
    bossSweepAnchorOffset,
    bossSweepTime: 0,
    bossSweepAmplitude: kind.boss && layout
      ? Math.max(layout.gridWidth * 0.36, layout.gridWidth * 0.5 - unit * 1.35)
      : 0,
    bossSweepPeriod: kind.boss ? 4.8 : 0,
    wormZigzagTime: 0,
    wormZigzagAmplitude: kind.family === "worm" ? Math.min(unit * 0.96, laneSpacing * 0.32) : 0,
    wormZigzagPeriod: kind.family === "worm" ? (kind.boss ? 2.05 : kind.elite ? 1.82 : 1.56) : 0,
    wormWave: Math.random() * Math.PI * 2,
  });
  return entity;
}

export function createProjectile(world, lane, x, y, targetId, payload) {
  const entity = world.createEntity();
  const unit = world.resources.layout && world.resources.layout.cell ? world.resources.layout.cell : 16;
  world.addComponent(entity, "projectile", {
    lane,
    x,
    y,
    radius: Math.max(3, unit * 0.14),
    speed: 760,
    targetId,
    drift: typeof payload.drift === "number" ? payload.drift : 0,
    damage: payload.damage,
    pierce: payload.pierce,
    split: payload.split,
    ricochet: payload.ricochet,
    burn: payload.burn,
    curse: payload.curse,
    slow: payload.slow,
    freeze: payload.freeze,
    pushback: payload.pushback,
    hitIds: [],
  });
  return entity;
}

export function createShard(world, lane, x, y, drift, payload) {
  const entity = world.createEntity();
  const unit = world.resources.layout && world.resources.layout.cell ? world.resources.layout.cell : 16;
  world.addComponent(entity, "projectile", {
    lane,
    x,
    y,
    radius: Math.max(2, unit * 0.11),
    speed: 700,
    targetId: null,
    drift,
    damage: Math.max(1, Math.round(payload.damage * 0.5)),
    pierce: 0,
    split: 0,
    ricochet: 0,
    burn: payload.burn,
    curse: payload.curse,
    slow: payload.slow,
    freeze: payload.freeze,
    pushback: payload.pushback * 0.7,
    hitIds: [],
  });
  return entity;
}

export function createFlash(world, x, y, color, radius, options = {}) {
  const entity = world.createEntity();
  world.addComponent(entity, "flash", {
    x,
    y,
    color,
    radius,
    life: typeof options.life === "number" ? options.life : 0.26,
    maxLife: typeof options.life === "number" ? options.life : 0.26,
    style: options.style || "burst",
    accent: options.accent || color,
    rotation: typeof options.rotation === "number" ? options.rotation : 0,
    spread: typeof options.spread === "number" ? options.spread : 0,
    upgradeId: options.upgradeId || null,
    icon: options.icon || null,
    shape: options.shape || null,
    level: typeof options.level === "number" ? options.level : 1,
  });
  return entity;
}

export function createSummonBot(world, lane, y, kind) {
  const entity = world.createEntity();
  const layout = world.resources.layout;
  const unit = layout && layout.cell ? layout.cell : 16;
  const isBeetle = kind.family === "beetle";
  const radius = Math.max(unit * (isBeetle ? 0.28 : 0.22), Math.min(kind.radius, unit * (isBeetle ? 0.5 : 0.4)));
  world.addComponent(entity, "summonBot", {
    lane,
    y,
    radius,
    family: kind.family || "spider",
    shape: kind.shape || "square",
    tint: kind.tint || "#8fd8ff",
    hp: kind.hp,
    damage: kind.damage,
    speed: kind.speed || 118,
  });
  return entity;
}

export function createDamageText(world, x, y, value, color = "#fff4d8") {
  const entity = world.createEntity();
  world.addComponent(entity, "damageText", {
    x,
    y,
    value,
    color,
    driftY: -24,
    life: 0.46,
    maxLife: 0.46,
  });
  return entity;
}

export function createCoinDrop(world, x, y, value) {
  const entity = world.createEntity();
  const unit = world.resources.layout && world.resources.layout.cell ? world.resources.layout.cell : 16;
  world.addComponent(entity, "coin", {
    x,
    y,
    value,
    radius: Math.max(10, unit * 0.34),
    bob: Math.random() * Math.PI * 2,
    pulse: Math.random() * Math.PI * 2,
  });
  return entity;
}

export function createCoinFly(world, x, y, value, targetX, targetY) {
  const entity = world.createEntity();
  world.addComponent(entity, "coinFly", {
    x,
    y,
    fromX: x,
    fromY: y,
    targetX,
    targetY,
    value,
    t: 0,
    duration: 0.38,
  });
  return entity;
}

export function turretMuzzle(layout, angle) {
  const length = layout.cell * 0.75;
  return {
    x: layout.turretX + Math.cos(angle) * length,
    y: layout.turretY + Math.sin(angle) * length,
  };
}

import { BOSS, BULLET, ENEMY, ENEMY_BULLET, GAME_HEIGHT, GAME_WIDTH, LAYOUT, MINIBOSS, SHIP } from "./constants.js";
import { RICOCHET_BOUNCES, countCompletedColumns, createWeaponNetwork } from "./weapon-network.js";

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

const OPENING_ENEMY_HP_SCALE = 0.42;
const OPENING_ENEMY_SPEED_SCALE = 0.64;
const OPENING_ENEMY_MIN_HP = 16;

function enemyColor(hp) {
  const palette = [
    "#50d8ff",
    "#40e0a8",
    "#f6dd6a",
    "#ffb36a",
    "#ff7e7e",
    "#f07cff",
  ];
  return palette[Math.min(hp - 1, palette.length - 1)];
}

function getEnemyShape() {
  const shapes = ["circle", "triangle", "square", "diamond", "hex"];
  return shapes[Math.floor(Math.random() * shapes.length)];
}

function getEnemyVariant(shape) {
  const variants = {
    circle: "pod",
    triangle: "drone",
    square: "rack",
    diamond: "display",
    hex: "canister",
  };
  return variants[shape] ?? "pod";
}

function getMiniBossName(tier) {
  const names = [
    "Sir Bump",
    "Count Chonkula",
    "Admiral Wobble",
    "The Orb Accountant",
  ];
  return names[(tier - 1) % names.length];
}

export function createShip(world) {
  const ship = world.createEntity();
  const battleLeft = LAYOUT.sidebarWidth + LAYOUT.battlePadding;
  const battleRight = GAME_WIDTH - LAYOUT.battlePadding;
  world.addComponent(ship, "Transform", { x: (battleLeft + battleRight) * 0.5, y: GAME_HEIGHT - 118 });
  world.addComponent(ship, "CircleCollider", { radius: SHIP.radius });
  world.addComponent(ship, "Ship", {
    hp: SHIP.hp,
    maxHp: SHIP.hp,
    shield: 0,
    controlSpeed: SHIP.controlSpeed,
    fireInterval: SHIP.fireInterval,
    fireTimer: 0,
    burstSpacing: SHIP.burstSpacing,
    burstTimer: 0,
    pendingShots: [],
    activeVolleyRow: 0,
    contactCooldown: 0,
    gunOffsetsY: [...SHIP.gunOffsetsY],
  });
  world.addComponent(ship, "Render", { type: "ship" });
  return ship;
}

export function createBullet(world, x, y, stats) {
  const bullet = world.createEntity();
  world.addComponent(bullet, "Transform", { x, y });
  world.addComponent(bullet, "Velocity", {
    x: 0,
    y: -BULLET.speedX * BULLET.startSpeedFactor,
  });
  world.addComponent(bullet, "CircleCollider", { radius: BULLET.radius });
  world.addComponent(bullet, "Bullet", {
    damage: stats?.damage ?? BULLET.damage,
    fire: stats?.fire ?? false,
    curse: stats?.curse ?? false,
    slow: stats?.slow ?? false,
    freeze: stats?.freeze ?? false,
    pushback: stats?.pushback ?? false,
    penetration: stats?.penetration ?? false,
    split: stats?.split ?? false,
    ricochet: stats?.ricochet ?? false,
    splitRemaining: stats?.splitRemaining ?? (stats?.split ? 1 : 0),
    bouncesLeft: stats?.bouncesLeft ?? (stats?.ricochet ? RICOCHET_BOUNCES : 0),
    buffColors: [...(stats?.buffColors ?? [])],
    row: stats?.row ?? 0,
    age: 0,
    baseSpeed: BULLET.speedX,
    dirX: stats?.dirX ?? 0,
    dirY: stats?.dirY ?? -1,
  });
  world.addComponent(bullet, "Render", {
    type: "bullet",
    color: stats?.color ?? "#dff9ff",
  });
  return bullet;
}

export function createEnemyBullet(world, x, y, velocityX, velocityY) {
  const bullet = world.createEntity();
  world.addComponent(bullet, "Transform", { x, y });
  world.addComponent(bullet, "Velocity", { x: velocityX, y: velocityY });
  world.addComponent(bullet, "CircleCollider", { radius: ENEMY_BULLET.radius });
  world.addComponent(bullet, "EnemyBullet", {
    damage: ENEMY_BULLET.damage,
  });
  world.addComponent(bullet, "Render", {
    type: "enemyBullet",
    color: "#ff8da9",
  });
  return bullet;
}

export function createEnemy(world) {
  const completedColumns = countCompletedColumns(world.resources.weaponNetwork);
  const minibossesDefeated = world.resources.minibossesDefeated ?? 0;
  const isOpeningWave = completedColumns === 0 && minibossesDefeated === 0;
  const lateTierNerf = isOpeningWave ? 1 : 0.78;
  const hpScale = 0.72 + completedColumns * 0.22 + minibossesDefeated * 0.45;
  const speedScale = 0.88 + completedColumns * 0.08 + minibossesDefeated * 0.12;
  const radiusBonus = completedColumns * 1 + minibossesDefeated * 2.5;
  const radius = randomBetween(ENEMY.minRadius + radiusBonus, ENEMY.maxRadius + radiusBonus);
  const speed =
    randomBetween(ENEMY.minSpeed, ENEMY.maxSpeed) *
    speedScale *
    lateTierNerf *
    (isOpeningWave ? OPENING_ENEMY_SPEED_SCALE : 1);
  const hp = Math.max(
    isOpeningWave ? OPENING_ENEMY_MIN_HP : 26,
    Math.round(
      (radius / 2 + 28 + completedColumns * 3 + minibossesDefeated * 8) *
        hpScale *
        lateTierNerf *
        (isOpeningWave ? OPENING_ENEMY_HP_SCALE : 1),
    ),
  );
  const battleLeft = LAYOUT.sidebarWidth + LAYOUT.battlePadding;
  const battleRight = GAME_WIDTH - LAYOUT.battlePadding;
  const x = randomBetween(battleLeft + radius, battleRight - radius);

  const enemy = world.createEntity();
  world.addComponent(enemy, "Transform", { x, y: -radius - 20 });
  world.addComponent(enemy, "Velocity", { x: 0, y: speed });
  world.addComponent(enemy, "CircleCollider", { radius });
  world.addComponent(enemy, "Enemy", {
    hp,
    maxHp: hp,
    speed,
    isBoss: false,
    isMiniBoss: false,
    miniBossTier: 0,
    burnTicks: 0,
    burnTimer: 0,
    burnDamage: 0,
    curseTicks: 0,
    curseTimer: 0,
    curseDamage: 0,
    slowTimer: 0,
    slowFactor: 0,
    freezeTimer: 0,
  });
  const shape = getEnemyShape();
  world.addComponent(enemy, "Render", {
    type: "enemy",
    color: enemyColor(hp),
    shape,
    variant: getEnemyVariant(shape),
  });
  return enemy;
}

export function createMiniBoss(world, tier) {
  const radius = MINIBOSS.baseRadius + (tier - 1) * MINIBOSS.radiusPerTier;
  const hp = MINIBOSS.baseHp + tier * MINIBOSS.hpPerTier;
  const boss = world.createEntity();
  const battleLeft = LAYOUT.sidebarWidth + LAYOUT.battlePadding;
  const battleRight = GAME_WIDTH - LAYOUT.battlePadding;
  const x = battleLeft + (battleRight - battleLeft) * Math.min(0.8, 0.2 + tier * 0.14);
  world.addComponent(boss, "Transform", {
    x,
    y: -radius - 30,
  });
  world.addComponent(boss, "Velocity", { x: 0, y: MINIBOSS.speed });
  world.addComponent(boss, "CircleCollider", { radius });
  world.addComponent(boss, "Enemy", {
    hp,
    maxHp: hp,
    speed: MINIBOSS.speed,
    fireTimer: 0,
    fireInterval: MINIBOSS.fireInterval,
    isBoss: false,
    isMiniBoss: true,
    miniBossTier: tier,
    bossName: getMiniBossName(tier),
    burnTicks: 0,
    burnTimer: 0,
    burnDamage: 0,
    curseTicks: 0,
    curseTimer: 0,
    curseDamage: 0,
    slowTimer: 0,
    slowFactor: 0,
    freezeTimer: 0,
  });
  world.addComponent(boss, "Render", { type: "enemy", color: "#ff8d57" });
  return boss;
}

export function createBoss(world) {
  const boss = world.createEntity();
  const battleLeft = LAYOUT.sidebarWidth + LAYOUT.battlePadding;
  const battleRight = GAME_WIDTH - LAYOUT.battlePadding;
  world.addComponent(boss, "Transform", {
    x: (battleLeft + battleRight) * 0.5,
    y: -BOSS.radius - 40,
  });
  world.addComponent(boss, "Velocity", { x: 0, y: BOSS.speed });
  world.addComponent(boss, "CircleCollider", { radius: BOSS.radius });
  world.addComponent(boss, "Enemy", {
    hp: BOSS.hp,
    maxHp: BOSS.hp,
    speed: BOSS.speed,
    fireTimer: 0,
    fireInterval: BOSS.fireInterval,
    isBoss: true,
    isMiniBoss: false,
    miniBossTier: 0,
    bossName: "The Glorious Meatball",
    burnTicks: 0,
    burnTimer: 0,
    burnDamage: 0,
    curseTicks: 0,
    curseTimer: 0,
    curseDamage: 0,
    slowTimer: 0,
    slowFactor: 0,
    freezeTimer: 0,
  });
  world.addComponent(boss, "Render", { type: "enemy", color: "#ff5d8f" });
  return boss;
}

export function resetGame(world) {
  const keepStars = world.resources.stars;
  const keepInput = world.resources.input;
  const keepPointer = world.resources.pointer;
  world.entities.clear();
  world.components.clear();
  world.nextEntityId = 1;

  world.resources = {
    ...world.resources,
    stars: keepStars,
    input: keepInput,
    pointer: keepPointer,
    weaponNetwork: createWeaponNetwork(),
    gameOver: false,
    bossSpawned: false,
    bossDefeated: false,
    minibossesDefeated: 0,
    activeMinibossTier: 0,
    pendingSpecialUpgrade: false,
    score: 0,
    commitUpgrade: false,
    dispatchRow: 0,
    signalTime: world.resources.signalTime ?? 0,
    enemySpawnTimer: 0,
    restartRequested: false,
  };

  world.resources.input.w = false;
  world.resources.input.a = false;
  world.resources.input.s = false;
  world.resources.input.d = false;
  world.resources.pointer.active = false;

  createShip(world);
}

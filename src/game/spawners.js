import { BOSS, BULLET, ENEMY, GAME_HEIGHT, GAME_WIDTH, SHIP } from "./constants.js";
import { countCompletedColumns, createWeaponNetwork } from "./weapon-network.js";

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

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

export function createShip(world) {
  const ship = world.createEntity();
  world.addComponent(ship, "Transform", { x: 110, y: GAME_HEIGHT * 0.5 });
  world.addComponent(ship, "CircleCollider", { radius: SHIP.radius });
  world.addComponent(ship, "Ship", {
    hp: SHIP.hp,
    maxHp: SHIP.hp,
    controlSpeed: SHIP.controlSpeed,
    fireInterval: SHIP.fireInterval,
    fireTimer: 0,
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
    x: BULLET.speedX * BULLET.startSpeedFactor,
    y: 0,
  });
  world.addComponent(bullet, "CircleCollider", { radius: BULLET.radius });
  world.addComponent(bullet, "Bullet", {
    damage: stats?.damage ?? BULLET.damage,
    crit: stats?.crit ?? false,
    fire: stats?.fire ?? false,
    curse: stats?.curse ?? false,
    penetration: stats?.penetration ?? false,
    row: stats?.row ?? 0,
    age: 0,
    baseSpeedX: BULLET.speedX,
  });
  world.addComponent(bullet, "Render", {
    type: "bullet",
    color: stats?.color ?? "#dff9ff",
  });
  return bullet;
}

export function createEnemy(world) {
  const completedColumns = countCompletedColumns(world.resources.weaponNetwork);
  const hpScale = 1 + completedColumns * 0.45;
  const speedScale = 1 + completedColumns * 0.16;
  const radius = randomBetween(ENEMY.minRadius, ENEMY.maxRadius);
  const speed = randomBetween(ENEMY.minSpeed, ENEMY.maxSpeed) * speedScale;
  const hp = Math.max(12, Math.round((radius / 2 + 8) * hpScale));
  const y = randomBetween(radius + 16, GAME_HEIGHT - radius - 16);

  const enemy = world.createEntity();
  world.addComponent(enemy, "Transform", { x: GAME_WIDTH + radius + 20, y });
  world.addComponent(enemy, "Velocity", { x: -speed, y: 0 });
  world.addComponent(enemy, "CircleCollider", { radius });
  world.addComponent(enemy, "Enemy", {
    hp,
    maxHp: hp,
    speed,
    isBoss: false,
    burnTicks: 0,
    burnTimer: 0,
    burnDamage: 0,
    curseTicks: 0,
    curseTimer: 0,
    curseDamage: 0,
  });
  world.addComponent(enemy, "Render", { type: "enemy", color: enemyColor(hp) });
  return enemy;
}

export function createBoss(world) {
  const boss = world.createEntity();
  world.addComponent(boss, "Transform", {
    x: GAME_WIDTH + BOSS.radius * 0.35,
    y: GAME_HEIGHT * 0.5,
  });
  world.addComponent(boss, "Velocity", { x: -BOSS.speed, y: 0 });
  world.addComponent(boss, "CircleCollider", { radius: BOSS.radius });
  world.addComponent(boss, "Enemy", {
    hp: BOSS.hp,
    maxHp: BOSS.hp,
    speed: BOSS.speed,
    isBoss: true,
    burnTicks: 0,
    burnTimer: 0,
    burnDamage: 0,
    curseTicks: 0,
    curseTimer: 0,
    curseDamage: 0,
  });
  world.addComponent(boss, "Render", { type: "enemy", color: "#ff5d8f" });
  return boss;
}

export function resetGame(world) {
  const keepStars = world.resources.stars;
  const keepInput = world.resources.input;
  world.entities.clear();
  world.components.clear();
  world.nextEntityId = 1;

  world.resources = {
    ...world.resources,
    stars: keepStars,
    input: keepInput,
    weaponNetwork: createWeaponNetwork(),
    gameOver: false,
    bossSpawned: false,
    bossDefeated: false,
    score: 0,
    commitUpgrade: false,
    signalTime: world.resources.signalTime ?? 0,
    enemySpawnTimer: 0,
    restartRequested: false,
  };

  world.resources.input.w = false;
  world.resources.input.a = false;
  world.resources.input.s = false;
  world.resources.input.d = false;

  createShip(world);
}

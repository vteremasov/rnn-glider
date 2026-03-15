import { World } from "./ecs/world.js";
import { ENEMY, GAME_HEIGHT, GAME_WIDTH } from "./game/constants.js";
import { createShip } from "./game/spawners.js";
import {
  chooseCard,
  createWeaponNetwork,
  moveCardSelection,
  moveColumnSelection,
  moveRowSelection,
} from "./game/weapon-network.js";
import {
  backgroundParallaxSystem,
  bossAttackSystem,
  cleanupSystem,
  collisionSystem,
  createAutoFireSystem,
  createEnemySpawnSystem,
  createRenderSystem,
  createShipFlightSystem,
  enemyStatusSystem,
  enemyHomingSystem,
  movementSystem,
  stateSystem,
} from "./game/systems.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = GAME_WIDTH;
canvas.height = GAME_HEIGHT;

const world = new World();
world.resources = {
  gameOver: false,
  bossSpawned: false,
  bossDefeated: false,
  minibossesDefeated: 0,
  activeMinibossTier: 0,
  pendingSpecialUpgrade: false,
  score: 0,
  restartRequested: false,
  commitUpgrade: false,
  dispatchRow: 0,
  signalTime: 0,
  enemySpawnTimer: 0,
  enemySpawnInterval: ENEMY.spawnInterval,
  weaponNetwork: createWeaponNetwork(),
  pointer: {
    x: 0,
    y: 0,
    active: false,
  },
  input: {
    w: false,
    a: false,
    s: false,
    d: false,
  },
  stars: Array.from({ length: 130 }, () => ({
    x: Math.random() * GAME_WIDTH,
    y: Math.random() * GAME_HEIGHT,
    size: Math.random() * 2 + 0.4,
    alpha: Math.random() * 0.55 + 0.2,
    speed: 40 + Math.random() * 120,
  })),
};

createShip(world);

function resolveMovementInput(event) {
  if (event.code === "KeyW" || event.code === "ArrowUp") {
    return "w";
  }
  if (event.code === "KeyA" || event.code === "ArrowLeft") {
    return "a";
  }
  if (event.code === "KeyS" || event.code === "ArrowDown") {
    return "s";
  }
  if (event.code === "KeyD" || event.code === "ArrowRight") {
    return "d";
  }

  const key = event.key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(world.resources.input, key)) {
    return key;
  }
  return null;
}

function clearDirectionalInput() {
  world.resources.input.w = false;
  world.resources.input.a = false;
  world.resources.input.s = false;
  world.resources.input.d = false;
}

function setDirectionalInput(inputKey, pressed) {
  if (!inputKey) {
    return;
  }

  if (pressed) {
    if (inputKey === "a" || inputKey === "d") {
      world.resources.input.a = false;
      world.resources.input.d = false;
    }
    if (inputKey === "w" || inputKey === "s") {
      world.resources.input.w = false;
      world.resources.input.s = false;
    }
  }

  world.resources.input[inputKey] = pressed;
}

function handleUpgradeInput(event) {
  const upgrade = world.resources.weaponNetwork.upgrade;
  const key = event.key.toLowerCase();

  if (upgrade.step === "card") {
    if (event.code === "ArrowUp" || event.code === "KeyW") {
      moveCardSelection(world.resources.weaponNetwork, -1);
      return true;
    }
    if (event.code === "ArrowDown" || event.code === "KeyS") {
      moveCardSelection(world.resources.weaponNetwork, 1);
      return true;
    }
    if (key === "1" || key === "2" || key === "3") {
      return chooseCard(world.resources.weaponNetwork, Number(key) - 1);
    }
    if (event.code === "Enter" || event.code === "Space") {
      return chooseCard(world.resources.weaponNetwork);
    }
  }

  if (upgrade.step === "slot") {
    if (event.code === "ArrowUp" || event.code === "KeyW") {
      moveColumnSelection(world.resources.weaponNetwork, -1);
      return true;
    }
    if (event.code === "ArrowDown" || event.code === "KeyS") {
      moveColumnSelection(world.resources.weaponNetwork, 1);
      return true;
    }

    if (event.code === "ArrowLeft" || event.code === "KeyA") {
      moveRowSelection(world.resources.weaponNetwork, -1);
      return true;
    }
    if (event.code === "ArrowRight" || event.code === "KeyD") {
      moveRowSelection(world.resources.weaponNetwork, 1);
      return true;
    }
    if (event.code === "Enter" || event.code === "Space") {
      world.resources.commitUpgrade = true;
      return true;
    }
  }

  return false;
}

function onKeyDown(event) {
  if (event.code === "KeyR" || event.key.toLowerCase() === "r") {
    world.resources.restartRequested = true;
  }

  if (world.resources.weaponNetwork.upgrade.active) {
    if (handleUpgradeInput(event)) {
      event.preventDefault();
    }
    return;
  }

  const inputKey = resolveMovementInput(event);
  if (inputKey) {
    event.preventDefault();
    setDirectionalInput(inputKey, true);
  }
}

function onKeyUp(event) {
  if (world.resources.weaponNetwork.upgrade.active) {
    return;
  }

  const inputKey = resolveMovementInput(event);
  if (inputKey) {
    event.preventDefault();
    setDirectionalInput(inputKey, false);
  }
}

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  world.resources.pointer.x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  world.resources.pointer.y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  world.resources.pointer.active = true;
});
canvas.addEventListener("mouseleave", () => {
  world.resources.pointer.active = false;
});

window.addEventListener("blur", () => {
  clearDirectionalInput();
  world.resources.pointer.active = false;
});

const systems = [
  stateSystem,
  backgroundParallaxSystem,
  createShipFlightSystem(),
  createAutoFireSystem(),
  createEnemySpawnSystem(),
  enemyHomingSystem,
  bossAttackSystem,
  movementSystem,
  enemyStatusSystem,
  collisionSystem,
  cleanupSystem,
  createRenderSystem(ctx, canvas),
];

let previous = performance.now();

function frame(now) {
  const dt = Math.min((now - previous) / 1000, 1 / 30);
  previous = now;

  for (const system of systems) {
    system(world, dt);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

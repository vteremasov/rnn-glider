import {
  COLORS,
  GRID_COLUMNS,
  GRID_ROWS,
  LANE_COUNT,
  NETWORK_LAYERS,
  ROOM_TYPES,
  clamp,
  formatRoomName,
  laneCenterX,
} from "./config.js";
import { createCoinDrop, createCoinFly, createDamageText, createEnemy, createFlash, createProjectile, createShard, createSummonBot, turretMuzzle } from "./spawners.js";
import { randomUpgrades, applyUpgrade, getNodeUpgradeLevel, isValidUpgradeTarget, upgradeVisual, MAX_UPGRADE_LEVEL, UPGRADE_LIBRARY } from "./upgrades.js";
import { createNetworkState, triggerLegendaryOpeningVolley, updateNetwork } from "./network.js";
import { LEGENDARY_PERKS } from "./catalog.js";

const META_PROGRESS_KEY = "neural-bastion-meta-v1";
const REROLL_BASE_COST = {
  reward: 8,
  shop: 10,
};
const REROLL_STEP_COST = {
  reward: 6,
  shop: 8,
};
const CAMP_EMPOWER_UPGRADE = {
  id: "campEmpower",
  name: "Empower Neuron",
  short: "+1 white route damage",
  description: "Drag onto any neuron to permanently empower that node.",
  color: "#8fd8ff",
  icon: "+",
  shape: "hex",
};

function weightedChoice(rng, items) {
  const total = items.reduce((sum, item) => sum + (item.weight || 0), 0);
  let roll = rng() * Math.max(total, 0.0001);
  for (const item of items) {
    roll -= item.weight || 0;
    if (roll <= 0) {
      return item;
    }
  }
  return items[0] || null;
}

function rerollCostFor(context, count) {
  const base = REROLL_BASE_COST[context] || 8;
  const step = REROLL_STEP_COST[context] || 6;
  return base + step * Math.max(0, count || 0);
}

const PERIODIC_STATUS_RULES = {
  burn: {
    throughShield: false,
    cap: 20,
    hold: 1.1,
  },
  curse: {
    throughShield: true,
    cap: 20,
    hold: 0.95,
  },
};

function applyPeriodicDamage(enemy, amount, throughShield) {
  if (!enemy || amount <= 0) {
    return { shield: 0, hp: 0 };
  }
  if ((enemy.shield || 0) > 0 && !throughShield) {
    const shieldDamage = Math.min(enemy.shield, amount);
    enemy.shield -= shieldDamage;
    return { shield: shieldDamage, hp: 0 };
  }
  enemy.hp -= amount;
  return { shield: 0, hp: amount };
}

function pathRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function networkLayerGap(layout) {
  return NETWORK_LAYERS > 1 ? (layout.networkBottom - layout.networkTop) / (NETWORK_LAYERS - 1) : 0;
}

function networkLayerY(layout, layer) {
  return layout.networkBottom - layer * networkLayerGap(layout);
}

function networkLayerBounds(layout) {
  const firstY = networkLayerY(layout, 0);
  const lastY = networkLayerY(layout, NETWORK_LAYERS - 1);
  return {
    top: Math.min(firstY, lastY),
    bottom: Math.max(firstY, lastY),
  };
}

function campTargetLayout(layout) {
  const headerRect = {
    x: layout.width * 0.08,
    y: layout.contentTop + 10,
    width: layout.width * 0.84,
    height: 112,
  };
  const cancelRect = {
    x: headerRect.x + headerRect.width * 0.5 - 48,
    y: headerRect.y + 8,
    width: 96,
    height: 38,
  };
  const selectionPanel = {
    x: layout.gridX - 12,
    y: headerRect.y + headerRect.height + 12,
    width: layout.gridWidth + 24,
    height: Math.min(layout.contentBottom - (headerRect.y + headerRect.height + 12) - 14, 284),
  };
  const layerY = (layer) => {
    const topInset = 34;
    const bottomInset = 30;
    const usableHeight = Math.max(120, selectionPanel.height - topInset - bottomInset);
    if (NETWORK_LAYERS <= 1) {
      return selectionPanel.y + topInset + usableHeight * 0.5;
    }
    return selectionPanel.y + topInset + usableHeight - (usableHeight / (NETWORK_LAYERS - 1)) * layer;
  };
  return { headerRect, cancelRect, selectionPanel, layerY };
}

function phaseLayerY(world, layer) {
  return networkLayerY(world.resources.layout, layer);
}

function zigzagWave(time, period) {
  if (!period) {
    return 0;
  }
  const phase = ((time % period) + period) % period / period;
  if (phase < 0.25) {
    return -phase * 4;
  }
  if (phase < 0.75) {
    return -1 + (phase - 0.25) * 4;
  }
  return 1 - (phase - 0.75) * 4;
}

function enemyScreenX(layout, enemy) {
  if (!layout || !enemy) {
    return 0;
  }
  return laneCenterX(layout, enemy.lane) + (enemy.xOffset || 0);
}

function computeTurretChargeProgress(network) {
  if (!network) {
    return 0;
  }
  const packetShots = network.pendingShot ? network.pendingShot.shots || [] : [];
  const currentPacketShot =
    network.pendingShot && network.outputChargeIndex < packetShots.length
      ? packetShots[network.outputChargeIndex]
      : null;
  const packetProgress = packetShots.length > 0
    ? clamp(
        (Math.min(network.outputChargeIndex || 0, packetShots.length)
          + (currentPacketShot ? clamp(network.outputChargeTimer / Math.max(network.outputChargeStep, 0.001), 0, 1) : 0))
          / packetShots.length,
        0,
        1,
      )
    : 0;
  return clamp(Math.max((network.queuedShots || []).length / LANE_COUNT, packetProgress), 0, 1);
}

function drawSpiderEnemy(ctx, enemy, x, y) {
  const radius = enemy.radius;
  ctx.fillStyle = "rgba(7, 10, 14, 0.28)";
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 1.02, radius * (enemy.elite ? 1.12 : 0.88), radius * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  if (enemy.elite) {
    ctx.strokeStyle = "rgba(245, 212, 164, 0.58)";
    ctx.lineWidth = Math.max(1.8, radius * 0.14);
    for (let side = -1; side <= 1; side += 2) {
      for (let pair = 0; pair < 4; pair += 1) {
        const anchorY = y - radius * 0.52 + pair * radius * 0.38;
        const anchorX = x + side * radius * (pair < 2 ? 0.32 : 0.18);
        const kneeX = x + side * (radius * 0.72 + pair * radius * 0.18);
        const kneeY = anchorY + (pair < 2 ? -radius * 0.44 : radius * 0.14);
        const tipX = x + side * (radius * 1.48 + pair * radius * 0.08);
        const tipY = anchorY + (pair < 2 ? -radius * 0.74 : radius * 0.98);
        ctx.beginPath();
        ctx.moveTo(anchorX, anchorY);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
      }
    }

    ctx.fillStyle = enemy.tint;
    ctx.beginPath();
    ctx.ellipse(x, y + radius * 0.12, radius * 0.9, radius * 0.76, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1717";
    ctx.beginPath();
    ctx.arc(x, y - radius * 0.08, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - radius * 0.56, radius * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 244, 211, 0.34)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y + radius * 0.08, radius * 0.94, radius * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff0cf";
    for (let eye = -1; eye <= 1; eye += 1) {
      ctx.beginPath();
      ctx.arc(x + eye * radius * 0.16, y - radius * 0.59, Math.max(1.4, radius * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  const bodyScale = enemy.shape === "square" ? 1.08 : enemy.shape === "triangle" ? 0.82 : 0.92;
  const abdomenRx = radius * bodyScale;
  const abdomenRy = radius * (enemy.shape === "triangle" ? 0.66 : 0.78);
  const thoraxR = radius * (enemy.shape === "square" ? 0.48 : 0.42);
  const headR = radius * (enemy.shape === "triangle" ? 0.24 : 0.28);
  const legSpread = radius * (enemy.shape === "square" ? 1.35 : 1.2);
  const legLift = radius * (enemy.shape === "triangle" ? 0.55 : 0.42);
  const legDrop = radius * (enemy.shape === "square" ? 0.95 : 0.82);

  ctx.strokeStyle = "rgba(120, 214, 255, 0.58)";
  ctx.lineWidth = Math.max(1.2, radius * 0.16);
  for (let side = -1; side <= 1; side += 2) {
    for (let pair = 0; pair < 4; pair += 1) {
      const anchorY = y - radius * 0.42 + pair * radius * 0.3;
      const anchorX = x + side * radius * (pair < 2 ? 0.28 : 0.12);
      const kneeX = x + side * (radius * 0.46 + pair * radius * 0.16);
      const kneeY = anchorY + (pair < 2 ? -legLift : legLift * 0.35);
      const tipX = x + side * (legSpread + pair * radius * 0.08);
      const tipY = anchorY + (pair < 2 ? -legDrop * 0.55 : legDrop);
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
  }

  ctx.fillStyle = enemy.tint;
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 0.1, abdomenRx * 0.72, abdomenRy * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(220,246,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.18, y - radius * 0.08, abdomenRx * 0.22, abdomenRy * 0.16, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0d1826";
  ctx.beginPath();
  ctx.arc(x, y - radius * 0.12, thoraxR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0b1420";
  ctx.beginPath();
  ctx.arc(x, y - radius * 0.48, headR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#8df3ff";
  ctx.beginPath();
  ctx.arc(x - headR * 0.46, y - radius * 0.51, Math.max(1.2, headR * 0.18), 0, Math.PI * 2);
  ctx.arc(x + headR * 0.46, y - radius * 0.51, Math.max(1.2, headR * 0.18), 0, Math.PI * 2);
  ctx.fill();
}

function drawWormEnemy(ctx, enemy, x, y) {
  const radius = enemy.radius;
  ctx.fillStyle = "rgba(7, 10, 14, 0.24)";
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 1.36, radius * 1.48, radius * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  const segments = enemy.boss ? 9 : enemy.elite ? 7 : 6;
  const segmentGap = radius * 0.48;
  const travelLean = clamp((enemy.xOffset || 0) / Math.max(radius * 1.8, 1), -1, 1);
  const bodyWave = (enemy.wormWave || 0) + (enemy.wormZigzagTime || 0) * 6.2;
  for (let index = segments - 1; index >= 0; index -= 1) {
    const t = index / Math.max(segments - 1, 1);
    const segR = radius * (0.42 + (1 - t) * 0.32);
    const curve = Math.sin(bodyWave + index * 0.7) * radius * 0.2;
    const lean = travelLean * radius * (0.1 + t * 0.28);
    const segX = x + curve + lean;
    const segY = y + (index - (segments - 1) * 0.5) * segmentGap;
    ctx.fillStyle = enemy.tint;
    ctx.beginPath();
    ctx.ellipse(segX, segY, segR * 0.94, segR * 0.56, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(244, 248, 251, 0.18)";
    ctx.lineWidth = Math.max(1, radius * 0.06);
    ctx.beginPath();
    ctx.ellipse(segX, segY, segR * 0.94, segR * 0.56, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const headY = y - (segments - 1) * segmentGap * 0.5 - radius * 0.06;
  const headX = x + Math.sin(bodyWave - 0.5) * radius * 0.12 + travelLean * radius * 0.24;
  ctx.fillStyle = "#0b1420";
  ctx.beginPath();
  ctx.ellipse(headX, headY, radius * 0.5, radius * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8df3ff";
  ctx.beginPath();
  ctx.arc(headX - radius * 0.13, headY - radius * 0.04, Math.max(1.2, radius * 0.06), 0, Math.PI * 2);
  ctx.arc(headX + radius * 0.13, headY - radius * 0.04, Math.max(1.2, radius * 0.06), 0, Math.PI * 2);
  ctx.fill();
}

function drawButterflyBoss(ctx, enemy, x, y) {
  const radius = enemy.radius;
  ctx.fillStyle = "rgba(7, 10, 14, 0.24)";
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 1.08, radius * 1.18, radius * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  const flap = Math.sin((enemy.wormZigzagTime || 0) * 7.2) * radius * 0.08;
  const wingTint = enemy.tint || "#b98060";

  ctx.fillStyle = wingTint;
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.18, y - radius * 0.08);
  ctx.quadraticCurveTo(x - radius * 1.48, y - radius * (0.98 + flap * 0.02), x - radius * 1.22, y + radius * 0.18);
  ctx.quadraticCurveTo(x - radius * 0.76, y + radius * 0.66, x - radius * 0.08, y + radius * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + radius * 0.18, y - radius * 0.08);
  ctx.quadraticCurveTo(x + radius * 1.48, y - radius * (0.98 + flap * 0.02), x + radius * 1.22, y + radius * 0.18);
  ctx.quadraticCurveTo(x + radius * 0.76, y + radius * 0.66, x + radius * 0.08, y + radius * 0.18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(244, 248, 251, 0.16)";
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.62, y - radius * 0.14, radius * 0.38, radius * 0.22, -0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + radius * 0.62, y - radius * 0.14, radius * 0.38, radius * 0.22, 0.28, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#121a24";
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 0.08, radius * 0.2, radius * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y - radius * 0.46, radius * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(120, 214, 255, 0.46)";
  ctx.lineWidth = Math.max(1.3, radius * 0.05);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.08, y - radius * 0.54);
  ctx.lineTo(x - radius * 0.24, y - radius * 0.92);
  ctx.moveTo(x + radius * 0.08, y - radius * 0.54);
  ctx.lineTo(x + radius * 0.24, y - radius * 0.92);
  ctx.stroke();

  ctx.fillStyle = "#8df3ff";
  ctx.beginPath();
  ctx.arc(x - radius * 0.07, y - radius * 0.48, Math.max(1.4, radius * 0.04), 0, Math.PI * 2);
  ctx.arc(x + radius * 0.07, y - radius * 0.48, Math.max(1.4, radius * 0.04), 0, Math.PI * 2);
  ctx.fill();
}

function drawBeetleEnemy(ctx, enemy, x, y) {
  const radius = enemy.radius;
  ctx.fillStyle = "rgba(7, 10, 14, 0.28)";
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 0.98, radius * 0.94, radius * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = enemy.tint;
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 0.04, radius * 0.82, radius * 0.74, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#16202c";
  ctx.beginPath();
  ctx.ellipse(x, y - radius * 0.22, radius * 0.46, radius * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 0.66);
  ctx.lineTo(x, y + radius * 0.66);
  ctx.strokeStyle = "rgba(244, 248, 251, 0.22)";
  ctx.lineWidth = Math.max(1.2, radius * 0.08);
  ctx.stroke();
  ctx.strokeStyle = "rgba(120, 214, 255, 0.46)";
  ctx.lineWidth = Math.max(1.1, radius * 0.11);
  for (let side = -1; side <= 1; side += 2) {
    for (let pair = 0; pair < 3; pair += 1) {
      const anchorY = y - radius * 0.24 + pair * radius * 0.3;
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.34, anchorY);
      ctx.lineTo(x + side * radius * 0.82, anchorY + radius * (pair === 1 ? 0.08 : side * 0.02));
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#8df3ff";
  ctx.beginPath();
  ctx.arc(x - radius * 0.12, y - radius * 0.3, Math.max(1.2, radius * 0.06), 0, Math.PI * 2);
  ctx.arc(x + radius * 0.12, y - radius * 0.3, Math.max(1.2, radius * 0.06), 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemy(ctx, enemy, x, y) {
  if (enemy.family === "worm" && enemy.boss && enemy.bossStage === "butterfly") {
    drawButterflyBoss(ctx, enemy, x, y);
    return;
  }
  if (enemy.family === "worm") {
    drawWormEnemy(ctx, enemy, x, y);
    return;
  }
  if (enemy.family === "beetle") {
    drawBeetleEnemy(ctx, enemy, x, y);
    return;
  }
  drawSpiderEnemy(ctx, enemy, x, y);
}

function drawEnemyShield(ctx, enemy, x, y, phase = "back") {
  if (!enemy || (enemy.shield || 0) <= 0 || (enemy.maxShield || 0) <= 0) {
    return;
  }
  const strength = clamp(enemy.shield / Math.max(enemy.maxShield, 1), 0, 1);
  const family = enemy.family || "spider";
  let shellRx = enemy.radius * (enemy.boss ? 1.56 : enemy.elite ? 1.38 : 1.28);
  let shellRy = shellRx * (enemy.boss ? 0.94 : 0.88);
  let centerY = y - enemy.radius * 0.08;
  if (family === "spider") {
    shellRx = enemy.radius * (enemy.boss ? 2.56 : enemy.elite ? 2.22 : 2.0);
    shellRy = enemy.radius * (enemy.boss ? 2.08 : enemy.elite ? 1.84 : 1.64);
    centerY = y + enemy.radius * 0.06;
  } else if (family === "worm") {
    shellRx = enemy.radius * (enemy.boss ? 1.68 : enemy.elite ? 1.52 : 1.38);
    shellRy = enemy.radius * (enemy.boss ? 2.7 : enemy.elite ? 2.3 : 2.02);
    centerY = y - enemy.radius * 0.04;
  } else if (family === "beetle") {
    shellRx = enemy.radius * (enemy.boss ? 1.82 : enemy.elite ? 1.62 : 1.42);
    shellRy = enemy.radius * (enemy.boss ? 1.44 : enemy.elite ? 1.26 : 1.08);
    centerY = y - enemy.radius * 0.02;
  }
  const pulse = 0.5 + Math.sin((enemy.shieldVisualPulse || 0) * 5.6) * 0.5;
  const hitFlash = enemy.shieldHitFlash || 0;
  const shellAlpha = 0.18 + strength * 0.18 + pulse * 0.06;
  const rimAlpha = 0.38 + strength * 0.22 + pulse * 0.14 + hitFlash * 0.24;
  const shellGradient = ctx.createLinearGradient(x, centerY - shellRy, x, centerY + shellRy);
  shellGradient.addColorStop(0, `rgba(232, 250, 255, ${0.15 + strength * 0.1 + pulse * 0.06 + hitFlash * 0.1})`);
  shellGradient.addColorStop(0.28, `rgba(145, 220, 255, ${shellAlpha})`);
  shellGradient.addColorStop(0.62, `rgba(84, 170, 235, ${0.12 + strength * 0.1 + pulse * 0.05})`);
  shellGradient.addColorStop(1, `rgba(34, 89, 146, ${0.04 + strength * 0.04})`);

  if (phase === "back") {
    ctx.fillStyle = shellGradient;
    ctx.beginPath();
    ctx.ellipse(x, centerY, shellRx, shellRy, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(152, 229, 255, ${0.28 + strength * 0.18 + pulse * 0.09})`;
    ctx.lineWidth = Math.max(1.4, enemy.radius * 0.06);
    ctx.beginPath();
    ctx.ellipse(x, centerY - enemy.radius * 0.08, shellRx * 0.82, shellRy * 0.74, 0, -2.42, -0.58);
    ctx.stroke();
    return;
  }

  ctx.strokeStyle = `rgba(180, 238, 255, ${rimAlpha})`;
  ctx.lineWidth = Math.max(1.8, enemy.radius * 0.08);
  ctx.beginPath();
  ctx.ellipse(x, centerY, shellRx, shellRy, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(240, 251, 255, ${0.16 + strength * 0.16 + pulse * 0.1 + hitFlash * 0.14})`;
  ctx.lineWidth = Math.max(1.2, enemy.radius * 0.05);
  ctx.beginPath();
  ctx.ellipse(x, centerY - enemy.radius * 0.08, shellRx * 0.84, shellRy * 0.72, 0, -2.4, -0.5);
  ctx.stroke();

  ctx.strokeStyle = `rgba(126, 215, 255, ${0.16 + strength * 0.14 + pulse * 0.08})`;
  ctx.lineWidth = Math.max(1.1, enemy.radius * 0.05);
  ctx.beginPath();
  ctx.ellipse(x, centerY + enemy.radius * 0.05, shellRx * 0.9, shellRy * 0.82, 0, 0.24, 2.7);
  ctx.stroke();
}

function projectileVisual(projectile) {
  let r = 93;
  let g = 232;
  let b = 255;
  let weight = 1;
  const accents = [];

  const add = (cr, cg, cb, amount, label) => {
    if (amount <= 0) {
      return;
    }
    r += cr * amount;
    g += cg * amount;
    b += cb * amount;
    weight += amount;
    accents.push({ color: `rgb(${cr}, ${cg}, ${cb})`, label });
  };

  add(255, 120, 74, projectile.burn > 0 ? 1.35 : 0, "burn");
  add(161, 104, 255, projectile.curse > 0 ? 1.15 : 0, "curse");
  add(98, 255, 214, projectile.slow > 0 ? 0.95 : 0, "slow");
  add(226, 252, 255, projectile.freeze > 0 ? 1.25 : 0, "freeze");
  add(255, 214, 92, projectile.pushback > 0 ? 0.75 : 0, "push");

  const mixR = Math.round(clamp(r / weight, 0, 255));
  const mixG = Math.round(clamp(g / weight, 0, 255));
  const mixB = Math.round(clamp(b / weight, 0, 255));
  const halo = `rgba(${mixR}, ${mixG}, ${mixB}, 0.32)`;
  const trail = `rgba(${mixR}, ${mixG}, ${mixB}, 0.66)`;
  const core = `rgb(${Math.round((mixR + 255) * 0.5)}, ${Math.round((mixG + 255) * 0.5)}, ${Math.round((mixB + 255) * 0.5)})`;
  return { halo, trail, core, accents };
}

function drawEnemyStatuses(ctx, enemy, x, y, layout) {
  const markers = [];
  if (enemy.status.burn > 0) {
    markers.push({ color: "#ff8b57", label: "B" });
  }
  if (enemy.status.curse > 0) {
    markers.push({ color: "#a774ff", label: "V" });
  }
  if (enemy.status.slow > 0) {
    markers.push({ color: "#63ffd5", label: "S" });
  }
  if (enemy.status.freeze > 0) {
    markers.push({ color: "#ecfbff", label: "F" });
  }

  if (enemy.status.burn > 0) {
    ctx.strokeStyle = "rgba(255,139,87,0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, enemy.radius * 0.9, -1.8, -0.2);
    ctx.stroke();
  }

  if (enemy.status.curse > 0) {
    ctx.strokeStyle = "rgba(167,116,255,0.56)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(x, y - enemy.radius * 0.08, enemy.radius * 1.15, enemy.radius * 0.74, 0.22, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (enemy.status.slow > 0) {
    ctx.strokeStyle = "rgba(99,255,213,0.54)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x - enemy.radius * 0.18, y, enemy.radius * 1.02, 2.2, 3.95);
    ctx.stroke();
  }

  if (enemy.status.freeze > 0) {
    ctx.strokeStyle = "#d9fbff";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, y, enemy.radius * 1.08, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (markers.length === 0) {
    return;
  }

  const badgeSize = Math.max(8, layout.cell * 0.28);
  const totalWidth = markers.length * badgeSize + (markers.length - 1) * 4;
  let badgeX = x - totalWidth * 0.5;
  const badgeY = y - enemy.radius - layout.cell * 0.42;

  for (const marker of markers) {
    ctx.fillStyle = "rgba(7,14,24,0.82)";
    pathRoundedRect(ctx, badgeX, badgeY, badgeSize, badgeSize, badgeSize * 0.28);
    ctx.fill();
    ctx.strokeStyle = marker.color;
    ctx.lineWidth = 1.5;
    pathRoundedRect(ctx, badgeX, badgeY, badgeSize, badgeSize, badgeSize * 0.28);
    ctx.stroke();
    drawText(ctx, marker.label, badgeX + badgeSize * 0.5, badgeY + badgeSize * 0.72, Math.max(8, badgeSize * 0.62), marker.color, "center");
    badgeX += badgeSize + 4;
  }
}

function pathUpgradeShape(ctx, shape, x, y, radius) {
  if (shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x - radius * 0.88, y + radius * 0.78);
    ctx.lineTo(x + radius * 0.88, y + radius * 0.78);
    ctx.closePath();
    return;
  }

  if (shape === "diamond") {
    ctx.beginPath();
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x - radius, y);
    ctx.lineTo(x, y + radius);
    ctx.lineTo(x + radius, y);
    ctx.closePath();
    return;
  }

  if (shape === "hex") {
    ctx.beginPath();
    for (let side = 0; side < 6; side += 1) {
      const angle = -Math.PI * 0.5 + (Math.PI * 2 * side) / 6;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (side === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    return;
  }

  pathRoundedRect(ctx, x - radius, y - radius, radius * 2, radius * 2, radius * 0.28);
}

function branchHealthMultiplier(run) {
  const completed = (run && run.completedBranches ? run.completedBranches.length : 0) || 0;
  return 1 + completed * 0.75;
}

function enemyKinds(wave, roomType, branchTheme = "spider", run = null) {
  const elite = roomType === "elite";
  const hpScale = branchHealthMultiplier(run);
  if (branchTheme === "worm") {
    return [
      {
        family: "worm",
        hp: (6 + wave * 1.1) * hpScale,
        speed: 24 + wave * 0.95,
        reward: elite ? 11 : 7,
        damage: 1,
        radius: 14,
        shape: "diamond",
        tint: "#c17f64",
        weight: 1.1,
      },
      {
        family: "worm",
        hp: (9 + wave * 1.4) * hpScale,
        speed: 19 + wave * 0.82,
        reward: elite ? 13 : 8,
        damage: 1,
        radius: 15,
        shape: "square",
        tint: "#d39c76",
        weight: 0.85,
      },
      {
        family: "worm",
        hp: (5 + wave * 0.9) * hpScale,
        speed: 30 + wave * 1.2,
        reward: elite ? 12 : 7,
        damage: 1,
        radius: 12,
        shape: "triangle",
        tint: "#e0ba92",
        weight: 0.55,
      },
    ];
  }
  if (branchTheme === "beetle") {
    return [
      {
        family: "beetle",
        hp: (12 + wave * 2.1) * hpScale,
        speed: 15 + wave * 0.55,
        reward: elite ? 12 : 7,
        damage: 1,
        radius: 20,
        shape: "diamond",
        tint: "#7f9361",
        weight: 0.95,
      },
      {
        family: "beetle",
        hp: (18 + wave * 2.8) * hpScale,
        speed: 11 + wave * 0.46,
        reward: elite ? 16 : 10,
        damage: wave >= 2 ? 2 : 1,
        radius: 25,
        shape: "square",
        tint: "#91aa72",
        weight: 1.2,
      },
      {
        family: "beetle",
        hp: (10 + wave * 1.9) * hpScale,
        speed: 13 + wave * 0.48,
        reward: elite ? 14 : 8,
        damage: 1,
        radius: 21,
        shape: "triangle",
        tint: "#aabf8b",
        weight: 0.7,
      },
    ];
  }
  return [
    {
      family: "spider",
      hp: (7 + wave * 1.5) * hpScale,
      speed: 22 + wave * 0.9,
      reward: elite ? 10 : 6,
      damage: 1,
      radius: 14,
      shape: "diamond",
      tint: "#c87455",
      weight: 1.2,
    },
    {
      family: "spider",
      hp: (12 + wave * 2.2) * hpScale,
      speed: 17 + wave * 0.8,
      reward: elite ? 14 : 9,
      damage: wave >= 3 ? 2 : 1,
      radius: 16,
      shape: "square",
      tint: "#c9ae6d",
      weight: elite ? 1.1 : 0.7,
    },
    {
      family: "spider",
      hp: (5 + wave * 0.8) * hpScale,
      speed: 29 + wave * 1.15,
      reward: elite ? 11 : 7,
      damage: 1,
      radius: 12,
      shape: "triangle",
      tint: "#88b6b2",
      weight: elite ? 1 : 0.45,
    },
  ];
}

function eliteSpiderKind(wave, branchTheme = "spider", run = null) {
  const hpScale = branchHealthMultiplier(run);
  if (branchTheme === "worm") {
    return {
      elite: true,
      family: "worm",
      hp: (132 + wave * 34) * hpScale,
      speed: 9.2 + wave * 0.36,
      reward: 34 + wave * 8,
      damage: 999,
      radius: 58,
      shape: "elite",
      tint: "#c08969",
    };
  }
  if (branchTheme === "beetle") {
    return {
      elite: true,
      family: "beetle",
      hp: (168 + wave * 42) * hpScale,
      speed: 6.2 + wave * 0.24,
      reward: 38 + wave * 9,
      damage: 999,
      radius: 88,
      shape: "elite",
      tint: "#849866",
    };
  }
  return {
    elite: true,
    family: "spider",
    hp: (120 + wave * 36) * hpScale,
    speed: 8 + wave * 0.38,
    reward: 32 + wave * 8,
    damage: 999,
    radius: 56,
    shape: "elite",
    tint: "#b88e62",
  };
}

function bossSpiderKind(wave, branchTheme = "spider", run = null) {
  const hp = (220 + wave * 42) * branchHealthMultiplier(run);
  if (branchTheme === "worm") {
    return {
      elite: true,
      boss: true,
      family: "worm",
      hp,
      pushbackResistance: 0.25,
      shieldKnockbackDistance: 0.25,
      speed: 6.5 + wave * 0.2,
      reward: 56 + wave * 10,
      damage: 999,
      radius: 112,
      shape: "butterfly",
      tint: "#b98060",
      bossAbility: "split_worm",
    };
  }
  if (branchTheme === "beetle") {
    return {
      elite: true,
      boss: true,
      family: "beetle",
      hp,
      pushbackResistance: 0.25,
      shieldKnockbackDistance: 0.25,
      speed: 5.4 + wave * 0.18,
      reward: 56 + wave * 10,
      damage: 999,
      radius: 118,
      shape: "elite",
      tint: "#7f9361",
      bossAbility: "summon_beetle",
      summonInterval: 1,
    };
  }
  return {
    elite: true,
    boss: true,
    family: "spider",
    hp,
    shield: hp,
    pushbackResistance: 0.25,
    shieldKnockbackDistance: 0.25,
    speed: 6.2 + wave * 0.22,
    reward: 56 + wave * 10,
    damage: 999,
    radius: 72,
    shape: "elite",
    tint: "#9a7156",
  };
}

function isLegendaryRoom(roomType) {
  return roomType === "elite" || roomType === "boss";
}

function randomLegendaryPerk(world) {
  const owned = new Set((world.resources.run.legendaryPerks || []).map((perk) => perk.id));
  const pool = LEGENDARY_PERKS.filter((perk) => !owned.has(perk.id));
  const bag = pool.length > 0 ? pool : LEGENDARY_PERKS;
  return bag[Math.floor(world.resources.rng() * bag.length)];
}

function grantLegendaryPerk(world, perk) {
  const run = world.resources.run;
  if (!run.legendaryPerks.some((entry) => entry.id === perk.id)) {
    run.legendaryPerks.push(perk);
  }
}

function hasLegendaryPerk(run, perkId) {
  return run.legendaryPerks.some((perk) => perk.id === perkId);
}

function usableLocalStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function readMetaProgress() {
  const storage = usableLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(META_PROGRESS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeMetaProgress(progress) {
  const storage = usableLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(META_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
  }
}

function clearMetaProgress() {
  const storage = usableLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(META_PROGRESS_KEY);
  } catch {
  }
}

function uniqueThemes(themes) {
  const seen = new Set();
  const list = [];
  for (const theme of themes || []) {
    if (!theme || seen.has(theme)) {
      continue;
    }
    seen.add(theme);
    list.push(theme);
  }
  return list;
}

function encounterThemes(run) {
  const themes = uniqueThemes([...(run.completedBranches || []), run.currentBranchTheme || "spider"]);
  return themes.length > 0 ? themes : ["spider"];
}

function pickEnemyKind(world) {
  const themes = encounterThemes(world.resources.run);
  const kinds = [];
  for (const theme of themes) {
    const themedKinds = enemyKinds(world.resources.run.wave, world.resources.run.currentRoomType, theme, world.resources.run);
    for (const kind of themedKinds) {
      kinds.push({
        ...kind,
        weight: kind.weight / themes.length,
      });
    }
  }
  const total = kinds.reduce((sum, kind) => sum + kind.weight, 0);
  let roll = world.resources.rng() * total;
  for (const kind of kinds) {
    roll -= kind.weight;
    if (roll <= 0) {
      return kind;
    }
  }
  return kinds[0];
}

function mapNodeById(run, nodeId) {
  return (run.mapNodes || []).find((node) => node.id === nodeId) || null;
}

function createMapNode(id, parentId, roomType, x, y, angle, depth, branchTheme = null) {
  return {
    id,
    parentId,
    roomType,
    x,
    y,
    angle,
    depth,
    branchTheme,
    cleared: false,
    childrenGenerated: false,
    children: [],
  };
}

function cloneCompletedBranchPath(path) {
  return (path || []).map((node) => ({
    roomType: node.roomType,
    x: node.x,
    y: node.y,
    angle: node.angle,
    depth: node.depth,
    branchTheme: node.branchTheme || null,
  }));
}

function captureCompletedBranchPath(world) {
  const run = world.resources.run;
  const path = [];
  let current = mapNodeById(run, run.activeMapNodeId);
  while (current) {
    path.push({
      roomType: current.roomType,
      x: current.x,
      y: current.y,
      angle: current.angle,
      depth: current.depth,
      branchTheme: current.branchTheme || null,
    });
    if (current.parentId === null) {
      break;
    }
    current = mapNodeById(run, current.parentId);
  }
  return cloneCompletedBranchPath(path.reverse());
}

function upsertCompletedBranchPath(paths, path) {
  if (!path || path.length === 0) {
    return (paths || []).map((entry) => cloneCompletedBranchPath(entry));
  }
  const theme = path[path.length - 1].branchTheme || null;
  const next = [];
  let replaced = false;
  for (const entry of paths || []) {
    if (!replaced && theme && entry && entry[entry.length - 1] && entry[entry.length - 1].branchTheme === theme) {
      next.push(cloneCompletedBranchPath(path));
      replaced = true;
      continue;
    }
    next.push(cloneCompletedBranchPath(entry));
  }
  if (!replaced) {
    next.push(cloneCompletedBranchPath(path));
  }
  return next;
}

const PRE_BOSS_CHOICE_DEPTH = 12;
const BOSS_DEPTH = 13;
const DEBUG_BRANCH_THEMES = ["worm", "beetle", "spider"];

function mapBranchCount(rng) {
  return rng() < 0.1 ? 1 : 2;
}

function rollMapRoomType(world, depth) {
  const roll = world.resources.rng();
  if (depth >= 2 && roll < 0.12) {
    return "elite";
  }
  if (roll < 0.24) {
    return "shop";
  }
  if (roll < 0.38) {
    return "camp";
  }
  return "combat";
}

function generateMapChildren(world, nodeId) {
  const run = world.resources.run;
  const node = mapNodeById(run, nodeId);
  if (!node || node.childrenGenerated) {
    return;
  }
  if (node.roomType === "boss") {
    node.childrenGenerated = true;
    return;
  }

  const childDepth = node.depth + 1;
  const isPreBossChoiceDepth = childDepth === PRE_BOSS_CHOICE_DEPTH;
  const isBossDepth = childDepth >= BOSS_DEPTH;
  const count = node.depth === 0 ? 3 : isPreBossChoiceDepth ? 2 : isBossDepth ? 1 : mapBranchCount(world.resources.rng);
  const step = 1.48;
  const angles = node.depth === 0
    ? [-Math.PI * 0.75, -Math.PI * 0.25, Math.PI * 0.5]
    : count === 1
      ? [node.angle]
      : [node.angle - 0.48, node.angle + 0.48];

  for (let index = 0; index < count; index += 1) {
    const angle = angles[index];
    const roomType = node.depth === 0
      ? "combat"
      : isPreBossChoiceDepth
        ? index === 0 ? "shop" : "camp"
        : isBossDepth
          ? "boss"
          : rollMapRoomType(world, childDepth);
    const branchTheme = node.depth === 0
      ? index === 0
        ? "worm"
        : index === 1
          ? "beetle"
          : "spider"
      : node.branchTheme;
    const child = createMapNode(
      run.nextMapNodeId++,
      node.id,
      roomType,
      node.x + Math.cos(angle) * step,
      node.y + Math.sin(angle) * step,
      angle,
      childDepth,
      branchTheme,
    );
    run.mapNodes.push(child);
    node.children.push(child.id);
  }
  node.childrenGenerated = true;
}

function initializeMap(world) {
  const run = world.resources.run;
  run.mapNodes = [createMapNode(0, null, "base", 0, 0, -Math.PI * 0.5, 0, null)];
  run.nextMapNodeId = 1;
  run.mapNodes[0].cleared = true;
  run.currentMapNodeId = 0;
  run.activeMapNodeId = null;
  generateMapChildren(world, 0);
  for (const childId of run.mapNodes[0].children) {
    const child = mapNodeById(run, childId);
    if (!child) {
      continue;
    }
    if ((run.completedBranches || []).indexOf(child.branchTheme) !== -1) {
      child.cleared = true;
      child.branchClosed = true;
    }
  }
}

function openMap(world) {
  world.resources.phase.name = "map";
  world.resources.ui.pendingUpgrade = null;
  world.resources.ui.drag = null;
  world.resources.ui.cards = [];
  world.resources.ui.shopStock = [];
  world.resources.ui.legendaryDrop = null;
  world.resources.ui.neuronInspect = null;
  world.resources.ui.buttons = [];
  if (world.resources.run.mapCamera) {
    world.resources.run.mapCamera.x = 0;
    world.resources.run.mapCamera.y = 0;
  }
}

function upgradeById(upgradeId) {
  return UPGRADE_LIBRARY.find((upgrade) => upgrade.id === upgradeId) || null;
}

function refreshRewardOffers(world) {
  const ui = world.resources.ui;
  const rewards = randomUpgrades(3, world.resources.rng, []);
  ui.cards = rewards;
  ui.rewardSelection = 0;
  ui.pendingUpgrade = rewards[0]
    ? {
        source: ui.pendingUpgrade && ui.pendingUpgrade.source ? ui.pendingUpgrade.source : "reward",
        upgrade: rewards[0],
        roomType: ui.pendingUpgrade ? ui.pendingUpgrade.roomType || null : null,
        nodeId: ui.pendingUpgrade && typeof ui.pendingUpgrade.nodeId === "number" ? ui.pendingUpgrade.nodeId : null,
        branchCompleteAfter: !!(ui.pendingUpgrade && ui.pendingUpgrade.branchCompleteAfter),
      }
    : null;
  clearDragState(ui);
}

function refreshShopOffers(world) {
  const ui = world.resources.ui;
  const run = world.resources.run;
  ui.shopStock = randomUpgrades(3, world.resources.rng, []).map((upgrade, index) => ({
    ...upgrade,
    price: 14 + index * 8 + run.wave * 2,
  }));
  ui.pendingUpgrade = null;
  clearDragState(ui);
}

function rerollUpgrades(world, context) {
  const ui = world.resources.ui;
  const run = world.resources.run;
  const rerollState = ui.rerollState || { reward: 0, shop: 0 };
  const currentCount = rerollState[context] || 0;
  const price = rerollCostFor(context, currentCount);
  if (run.money < price) {
    return false;
  }
  run.money -= price;
  rerollState[context] = currentCount + 1;
  ui.rerollState = rerollState;
  ui.rerollCost = {
    ...(ui.rerollCost || {}),
    [context]: rerollCostFor(context, currentCount + 1),
  };
  if (context === "reward") {
    refreshRewardOffers(world);
    return true;
  }
  if (context === "shop") {
    refreshShopOffers(world);
    return true;
  }
  return false;
}

function pickDebugChild(run, parent, targetDepth, branchTheme, preBossRoom) {
  const children = (parent.children || []).map((childId) => mapNodeById(run, childId)).filter(Boolean);
  if (parent.depth === 0) {
    return children.find((child) => child.branchTheme === branchTheme) || children[0] || null;
  }
  if (targetDepth === PRE_BOSS_CHOICE_DEPTH) {
    return children.find((child) => child.roomType === preBossRoom) || children[0] || null;
  }
  if (targetDepth === BOSS_DEPTH) {
    return children.find((child) => child.roomType === "boss") || children[0] || null;
  }
  return children.find((child) => child.roomType === "combat") ||
    children.find((child) => child.roomType === "elite") ||
    children.find((child) => child.roomType === "shop") ||
    children.find((child) => child.roomType === "camp") ||
    children[0] ||
    null;
}

function pickDebugUpgradeTarget(network, upgrade) {
  let bestMerge = null;
  let bestEmpty = null;
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const target = { layer, lane };
      const node = network.nodes[layer][lane];
      if (nodeHasInstalledUpgrade(node) && sameInstalledUpgrade(node, upgrade.id) && isValidUpgradeTarget(network, upgrade, target)) {
        return target;
      }
      if (!nodeHasInstalledUpgrade(node) && !bestEmpty && isValidUpgradeTarget(network, upgrade, target)) {
        bestEmpty = target;
      }
      if (!bestMerge && nodeHasInstalledUpgrade(node) && sameInstalledUpgrade(node, upgrade.id) && isValidUpgradeTarget(network, upgrade, target)) {
        bestMerge = target;
      }
    }
  }
  return bestMerge || bestEmpty;
}

function applyDebugBuild(world, config) {
  const network = world.resources.network;
  for (const upgrade of UPGRADE_LIBRARY) {
    const count = Math.max(0, Number(config.upgrades && config.upgrades[upgrade.id]) || 0);
    for (let step = 0; step < count; step += 1) {
      const target = pickDebugUpgradeTarget(network, upgrade);
      if (!target) {
        break;
      }
      const result = applyUpgrade(network, upgrade, target);
      if (!result || !result.applied) {
        break;
      }
    }
  }
}

function applyDebugLegendary(world, config) {
  const enabled = new Set(Array.isArray(config.legendary) ? config.legendary : []);
  world.resources.run.legendaryPerks = LEGENDARY_PERKS.filter((perk) => enabled.has(perk.id)).map((perk) => ({ ...perk }));
}

function jumpDebugMap(world, config) {
  const run = world.resources.run;
  const depth = Math.max(0, Math.min(BOSS_DEPTH, Number(config.depth) || 0));
  const branchTheme = DEBUG_BRANCH_THEMES.includes(config.branchTheme) ? config.branchTheme : "spider";
  const preBossRoom = config.preBossRoom === "camp" ? "camp" : "shop";
  run.currentBranchTheme = branchTheme;
  run.currentMapNodeId = 0;
  run.activeMapNodeId = null;

  if (depth <= 0) {
    return null;
  }

  let parent = mapNodeById(run, 0);
  let target = null;
  for (let targetDepth = 1; targetDepth <= depth; targetDepth += 1) {
    generateMapChildren(world, parent.id);
    target = pickDebugChild(run, parent, targetDepth, branchTheme, preBossRoom);
    if (!target) {
      break;
    }
    if (targetDepth < depth) {
      target.cleared = true;
      run.currentMapNodeId = target.id;
      parent = target;
    }
  }
  if (parent) {
    generateMapChildren(world, parent.id);
  }
  return target;
}

export function applyDebugScenario(world, config = {}) {
  resetRun(world, {});
  const run = world.resources.run;
  const depth = Math.max(0, Math.min(BOSS_DEPTH, Number(config.depth) || 0));
  run.wave = depth;
  run.hasOpeningUpgrade = true;
  run.money = Math.max(run.money, 99);
  applyDebugBuild(world, config);
  applyDebugLegendary(world, config);
  const targetNode = jumpDebugMap(world, config);
  openMap(world);
  if (config.enterMode === "enter" && targetNode) {
    enterMapNode(world, targetNode.id);
  }
}

function completeMapRoom(world) {
  const run = world.resources.run;
  const node = mapNodeById(run, run.activeMapNodeId);
  if (!node) {
    openMap(world);
    return;
  }
  node.cleared = true;
  run.currentMapNodeId = node.id;
  generateMapChildren(world, node.id);
  run.activeMapNodeId = null;
  openMap(world);
}

function buildMetaSnapshot(world, completedBranchesOverride = null) {
  const run = world.resources.run;
  return {
    version: 1,
    completedBranches: uniqueThemes(completedBranchesOverride || run.completedBranches || []),
    completedBranchPaths: (run.completedBranchPaths || []).map((path) => cloneCompletedBranchPath(path)),
    nodes: world.resources.network.nodes.map((layer) => layer.map((node) => cloneNodeState(node))),
    legendaryPerks: (run.legendaryPerks || []).map((perk) => ({ ...perk })),
    hasOpeningUpgrade: !!run.hasOpeningUpgrade,
    money: run.money,
    baseHp: run.baseHp,
    maxBaseHp: run.maxBaseHp,
    score: run.score,
    wave: run.wave,
  };
}

function applyMetaSnapshot(world, snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const run = world.resources.run;
  run.completedBranches = uniqueThemes(snapshot.completedBranches || []);
  run.completedBranchPaths = Array.isArray(snapshot.completedBranchPaths)
    ? snapshot.completedBranchPaths.map((path) => cloneCompletedBranchPath(path))
    : [];
  run.legendaryPerks = Array.isArray(snapshot.legendaryPerks) ? snapshot.legendaryPerks.map((perk) => ({ ...perk })) : [];
  run.hasOpeningUpgrade = !!snapshot.hasOpeningUpgrade;
  if (typeof snapshot.money === "number") {
    run.money = snapshot.money;
  }
  if (typeof snapshot.baseHp === "number") {
    run.baseHp = snapshot.baseHp;
  }
  if (typeof snapshot.maxBaseHp === "number") {
    run.maxBaseHp = snapshot.maxBaseHp;
  }
  if (typeof snapshot.score === "number") {
    run.score = snapshot.score;
  }
  if (typeof snapshot.wave === "number") {
    run.wave = snapshot.wave;
  }
  if (Array.isArray(snapshot.nodes)) {
    for (let layer = 0; layer < Math.min(snapshot.nodes.length, world.resources.network.nodes.length); layer += 1) {
      for (let lane = 0; lane < Math.min(snapshot.nodes[layer].length, world.resources.network.nodes[layer].length); lane += 1) {
        restoreNodeState(world.resources.network.nodes[layer][lane], snapshot.nodes[layer][lane]);
      }
    }
  }
}

function persistCurrentMeta(world, completedBranchesOverride = null) {
  writeMetaProgress(buildMetaSnapshot(world, completedBranchesOverride));
}

function completeBranchProgress(world) {
  const completed = uniqueThemes([...(world.resources.run.completedBranches || []), world.resources.run.currentBranchTheme]);
  const completedPaths = upsertCompletedBranchPath(world.resources.run.completedBranchPaths, captureCompletedBranchPath(world));
  world.resources.run.completedBranchPaths = completedPaths;
  const snapshot = buildMetaSnapshot(world, completed);
  writeMetaProgress(snapshot);
  resetRun(world, snapshot);
}

function enterMapNode(world, nodeId) {
  const run = world.resources.run;
  const node = mapNodeById(run, nodeId);
  if (!node || node.cleared || node.parentId !== run.currentMapNodeId) {
    return;
  }
  run.activeMapNodeId = node.id;
  run.currentRoomType = node.roomType;
  run.currentBranchTheme = node.branchTheme || "spider";
  if (node.roomType === "shop") {
    openShop(world);
    return;
  }
  if (node.roomType === "camp") {
    openCamp(world);
    return;
  }
  if (!run.hasOpeningUpgrade) {
    openReward(world, {
      source: "map_entry",
      roomType: node.roomType,
      nodeId: node.id,
    });
    return;
  }
  beginWave(world, node.roomType);
}

function openReward(world, options = {}) {
  const staged = options && options.rewards && !Array.isArray(options.rewards) ? options.rewards : options;
  const rewards = Array.isArray(staged.rewards)
    ? staged.rewards
    : Array.isArray(staged.reward)
      ? staged.reward
      : randomUpgrades(3, world.resources.rng, []);
  const reward = rewards[0] || null;
  world.resources.phase.name = "reward_drag";
  world.resources.ui.cards = rewards;
  world.resources.ui.pendingUpgrade = reward
    ? {
        source: staged.source || "reward",
        upgrade: reward,
        roomType: staged.roomType || null,
        nodeId: typeof staged.nodeId === "number" ? staged.nodeId : null,
        branchCompleteAfter: !!staged.branchCompleteAfter,
      }
    : null;
  world.resources.ui.drag = reward
    ? {
        armed: false,
        active: false,
        started: false,
        sourceKind: null,
        sourceTarget: null,
        sourceNode: null,
        startX: 0,
        startY: 0,
        x: 0,
        y: 0,
        hoverTarget: null,
        worldRef: world,
      }
    : null;
  world.resources.ui.rewardSelection = 0;
  world.resources.ui.rewardIntro = {
    showVictory: false,
    timer: 0,
  };
  world.resources.ui.legendaryDrop = null;
  world.resources.ui.neuronInspect = null;
  world.resources.ui.stagedReward = null;
  world.resources.ui.rerollState = {
    ...(world.resources.ui.rerollState || {}),
    reward: 0,
  };
  world.resources.ui.rerollCost = {
    ...(world.resources.ui.rerollCost || {}),
    reward: rerollCostFor("reward", 0),
  };
  world.resources.ui.buttons = [];
}

function openRewardVictory(world) {
  const stagedReward = {
    source: "post_combat",
    rewards: randomUpgrades(3, world.resources.rng, []),
    roomType: world.resources.run.currentRoomType,
    nodeId: world.resources.run.activeMapNodeId,
    branchCompleteAfter: world.resources.run.currentRoomType === "boss",
  };
  world.resources.ui.stagedReward = stagedReward;
  if (isLegendaryRoom(world.resources.run.currentRoomType)) {
    const perk = randomLegendaryPerk(world);
    if (perk) {
      grantLegendaryPerk(world, perk);
      world.resources.phase.name = "legendary_drop";
      world.resources.ui.legendaryDrop = perk;
      world.resources.ui.rewardIntro = {
        showVictory: false,
        timer: 1.8,
        closing: false,
        nextAction: "reward",
      };
      world.resources.ui.buttons = [];
      return;
    }
  }
  world.resources.phase.name = "reward_victory";
  world.resources.ui.rewardIntro = {
    showVictory: true,
    timer: 0.72,
  };
  world.resources.ui.buttons = [];
}

function openDoors(world) {
  world.resources.phase.name = "doors";
  const doors = ROOM_TYPES.slice();
  for (let index = doors.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(world.resources.rng() * (index + 1));
    const temp = doors[index];
    doors[index] = doors[swapIndex];
    doors[swapIndex] = temp;
  }
  world.resources.ui.roomOptions = doors;
  world.resources.ui.legendaryDrop = null;
  world.resources.ui.neuronInspect = null;
  world.resources.ui.buttons = [];
}

function openShop(world) {
  world.resources.phase.name = "shop";
  world.resources.ui.shopStock = randomUpgrades(3, world.resources.rng, []).map((upgrade, index) => ({
    ...upgrade,
    price: 14 + index * 8 + world.resources.run.wave * 2,
  }));
  world.resources.ui.pendingUpgrade = null;
  world.resources.ui.drag = {
    armed: false,
    active: false,
    started: false,
    sourceKind: null,
    sourceTarget: null,
    sourceNode: null,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    hoverTarget: null,
    worldRef: world,
  };
  world.resources.ui.legendaryDrop = null;
  world.resources.ui.neuronInspect = null;
  world.resources.ui.rerollState = {
    ...(world.resources.ui.rerollState || {}),
    shop: 0,
  };
  world.resources.ui.rerollCost = {
    ...(world.resources.ui.rerollCost || {}),
    shop: rerollCostFor("shop", 0),
  };
  world.resources.ui.buttons = [];
}

function createEmptyNodeState() {
  return {
    power: 0,
    appearance: null,
    effects: {
      fire: 0,
      curse: 0,
      slow: 0,
      freeze: 0,
      pushback: 0,
      penetration: 0,
      split: 0,
      ricochet: 0,
      shield: 0,
      overdrive: 0,
      summon: 0,
    },
    links: {
      left: 0,
      right: 0,
      divider: 0,
      merger: 0,
      relay: 0,
    },
  };
}

function cloneNodeState(node) {
  return {
    power: node.power,
    appearance: node.appearance
      ? {
          id: node.appearance.id,
          color: node.appearance.color,
          icon: node.appearance.icon,
          shape: node.appearance.shape,
          level: node.appearance.level || 1,
        }
      : null,
    effects: { ...node.effects },
    links: { ...node.links },
  };
}

function restoreNodeState(node, snapshot) {
  node.power = snapshot.power;
  node.appearance = snapshot.appearance
    ? {
        id: snapshot.appearance.id,
        color: snapshot.appearance.color,
        icon: snapshot.appearance.icon,
        shape: snapshot.appearance.shape,
        level: snapshot.appearance.level || 1,
      }
    : null;
  for (const key of Object.keys(node.effects)) {
    node.effects[key] = snapshot.effects[key] || 0;
  }
  for (const key of Object.keys(node.links)) {
    node.links[key] = snapshot.links[key] || 0;
  }
}

function renderNodeState(world, layer, lane) {
  const node = world.resources.network.nodes[layer][lane];
  const drag = world.resources.ui && world.resources.ui.drag;
  if (
    drag &&
    drag.sourceKind === "node" &&
    (drag.armed || drag.started || drag.active) &&
    drag.sourceTarget &&
    drag.sourceTarget.layer === layer &&
    drag.sourceTarget.lane === lane
  ) {
    return createEmptyNodeState();
  }
  return node;
}

function nodeHasInstalledUpgrade(node) {
  return !!(node && (node.appearance || nodeStats(node) > 0));
}

function sameInstalledUpgrade(node, upgradeId) {
  return !!(node && node.appearance && node.appearance.id === upgradeId);
}

function canDropUpgradeOnNode(network, pendingUpgrade, target) {
  if (!pendingUpgrade || !target) {
    return false;
  }
  if (pendingUpgrade.source === "camp") {
    return true;
  }
  const node = network.nodes[target.layer][target.lane];
  if (!nodeHasInstalledUpgrade(node)) {
    return isValidUpgradeTarget(network, pendingUpgrade.upgrade, target);
  }
  if (!sameInstalledUpgrade(node, pendingUpgrade.upgrade.id)) {
    return false;
  }
  return isValidUpgradeTarget(network, pendingUpgrade.upgrade, target);
}

function canMergeNodeSnapshots(sourceSnapshot, targetSnapshot) {
  if (!sourceSnapshot || !targetSnapshot || !sourceSnapshot.appearance || !targetSnapshot.appearance) {
    return false;
  }
  if (sourceSnapshot.appearance.id !== targetSnapshot.appearance.id) {
    return false;
  }
  const sourceLevel = sourceSnapshot.appearance.level || 1;
  const targetLevel = targetSnapshot.appearance.level || 1;
  return sourceLevel + targetLevel <= MAX_UPGRADE_LEVEL;
}

function mergeNodeSnapshots(targetNode, sourceSnapshot, targetSnapshot) {
  targetNode.power = (targetSnapshot.power || 0) + (sourceSnapshot.power || 0);
  targetNode.appearance = {
    id: targetSnapshot.appearance.id,
    color: targetSnapshot.appearance.color,
    icon: targetSnapshot.appearance.icon,
    shape: targetSnapshot.appearance.shape,
    level: (targetSnapshot.appearance.level || 1) + (sourceSnapshot.appearance.level || 1),
  };
  for (const key of Object.keys(targetNode.effects)) {
    targetNode.effects[key] = (targetSnapshot.effects[key] || 0) + (sourceSnapshot.effects[key] || 0);
  }
  for (const key of Object.keys(targetNode.links)) {
    targetNode.links[key] = (targetSnapshot.links[key] || 0) + (sourceSnapshot.links[key] || 0);
  }
}

function nodeEditingPhase(phaseName) {
  return phaseName === "reward_drag" ||
    phaseName === "shop" ||
    phaseName === "combat_finish" ||
    phaseName === "camp_finish" ||
    phaseName === "camp" ||
    phaseName === "camp_target" ||
    phaseName === "reward_target" ||
    phaseName === "shop_target";
}

function isValidNodePlacement(network, nodeSnapshot, target) {
  if (!nodeSnapshot || !target) {
    return false;
  }
  if (target.layer >= network.nodes.length - 1 && ((nodeSnapshot.links.left || 0) > 0 || (nodeSnapshot.links.right || 0) > 0)) {
    return false;
  }
  return true;
}

function clearDragState(ui) {
  if (!ui.drag) {
    return;
  }
  ui.drag.armed = false;
  ui.drag.active = false;
  ui.drag.started = false;
  ui.drag.sourceKind = null;
  ui.drag.sourceTarget = null;
  ui.drag.sourceNode = null;
  ui.drag.startX = 0;
  ui.drag.startY = 0;
  ui.drag.x = 0;
  ui.drag.y = 0;
  ui.drag.hoverTarget = null;
}

function commitNodeReorder(world, origin, target) {
  if (!origin || !target) {
    return false;
  }
  if (origin.layer === target.layer && origin.lane === target.lane) {
    return false;
  }
  const network = world.resources.network;
  const sourceNode = network.nodes[origin.layer][origin.lane];
  const targetNode = network.nodes[target.layer][target.lane];
  if (!nodeHasInstalledUpgrade(sourceNode)) {
    return false;
  }

  const sourceSnapshot = cloneNodeState(sourceNode);
  const targetSnapshot = cloneNodeState(targetNode);
  const targetOccupied = nodeHasInstalledUpgrade(targetNode);

  if (!isValidNodePlacement(network, sourceSnapshot, target)) {
    return false;
  }
  if (targetOccupied && canMergeNodeSnapshots(sourceSnapshot, targetSnapshot)) {
    mergeNodeSnapshots(targetNode, sourceSnapshot, targetSnapshot);
    restoreNodeState(sourceNode, createEmptyNodeState());
    const layout = world.resources.layout;
    if (layout) {
      createFlash(
        world,
        laneCenterX(layout, target.lane),
        networkLayerY(layout, target.layer),
        targetNode.appearance.color || COLORS.energy,
        layout.cell * 1.12,
        {
          style: "merge",
          accent: COLORS.energyBright,
          life: 0.82,
          upgradeId: targetNode.appearance.id,
          icon: targetNode.appearance.icon,
          shape: targetNode.appearance.shape,
          level: targetNode.appearance.level,
        },
      );
    }
    world.resources.ui.neuronInspect = null;
    world.resources.ui.legendaryInspect = null;
    return true;
  }
  if (targetOccupied && !isValidNodePlacement(network, targetSnapshot, origin)) {
    return false;
  }

  restoreNodeState(sourceNode, targetOccupied ? targetSnapshot : createEmptyNodeState());
  restoreNodeState(targetNode, sourceSnapshot);
  world.resources.ui.neuronInspect = null;
  world.resources.ui.legendaryInspect = null;
  return true;
}

function commitUpgradeTarget(world, target) {
  const pending = world.resources.ui.pendingUpgrade;
  if (!pending) {
    return;
  }
  if (!canDropUpgradeOnNode(world.resources.network, pending, target)) {
    return;
  }
  if (pending.source === "camp") {
    const node = world.resources.network.nodes[target.layer][target.lane];
    if (!node) {
      return;
    }
    node.power += 1;
    world.resources.ui.neuronInspect = null;
    world.resources.ui.legendaryInspect = null;
    const layout = world.resources.layout;
    if (layout) {
      createFlash(
        world,
        laneCenterX(layout, target.lane),
        networkLayerY(layout, target.layer),
        CAMP_EMPOWER_UPGRADE.color,
        layout.cell * 1.1,
        {
          style: "merge",
          accent: COLORS.energyBright,
          life: 0.84,
          upgradeId: CAMP_EMPOWER_UPGRADE.id,
          icon: CAMP_EMPOWER_UPGRADE.icon,
          shape: CAMP_EMPOWER_UPGRADE.shape,
          level: Math.max(1, node.power || 1),
        },
      );
      createDamageText(
        world,
        laneCenterX(layout, target.lane),
        networkLayerY(layout, target.layer) - layout.cell * 0.48,
        "White +1",
        "#e7fbff",
      );
    }
    world.resources.ui.cards = [];
    world.resources.ui.pendingUpgrade = null;
    clearDragState(world.resources.ui);
    world.resources.phase.name = "camp_finish";
    world.resources.ui.buttons = [];
    return;
  }
  const result = applyUpgrade(world.resources.network, pending.upgrade, target);
  if (!result || !result.applied) {
    return;
  }
  world.resources.ui.neuronInspect = null;
  world.resources.ui.legendaryInspect = null;
  const layout = world.resources.layout;
  if (result.merged && layout) {
    createFlash(
      world,
      laneCenterX(layout, target.lane),
      networkLayerY(layout, target.layer),
      pending.upgrade.color,
      layout.cell * 1.08,
      {
        style: "merge",
        accent: COLORS.energyBright,
        life: 0.78,
        upgradeId: pending.upgrade.id,
        icon: pending.upgrade.icon,
        shape: pending.upgrade.shape,
        level: result.level,
      },
    );
  }
  if (pending.source === "shop") {
    world.resources.run.money -= pending.price;
    pending.item.sold = true;
    world.resources.phase.name = "shop";
  } else if (pending.source === "map_entry") {
    world.resources.run.hasOpeningUpgrade = true;
    beginWave(world, pending.roomType || "combat");
  } else if (pending.source === "post_combat") {
    world.resources.run.pendingBranchComplete = !!pending.branchCompleteAfter;
    world.resources.phase.name = "combat_finish";
  } else if (world.resources.run.wave === 0) {
    beginWave(world, "combat");
  } else {
    world.resources.run.pendingBranchComplete = false;
    world.resources.phase.name = "combat_finish";
  }
  world.resources.ui.pendingUpgrade = null;
}

function commitCampTarget(world, target) {
  if (!target) {
    return;
  }
  const network = world.resources.network;
  const node = network.nodes[target.layer][target.lane];
  if (!node) {
    return;
  }
  node.power += 1;
  world.resources.ui.neuronInspect = null;
  world.resources.ui.legendaryInspect = null;
  const layout = world.resources.layout;
  if (layout) {
    createFlash(
      world,
      laneCenterX(layout, target.lane),
      networkLayerY(layout, target.layer),
      COLORS.energyBright,
      layout.cell * 1.28,
      {
        style: "shock",
        accent: "rgba(246, 248, 251, 0.72)",
        life: 0.56,
      },
    );
    createFlash(
      world,
      laneCenterX(layout, target.lane),
      networkLayerY(layout, target.layer),
      "rgba(143, 216, 255, 0.82)",
      layout.cell * 1.6,
      {
        style: "shock",
        accent: COLORS.energyBright,
        life: 0.44,
      },
    );
    createDamageText(
      world,
      laneCenterX(layout, target.lane),
      networkLayerY(layout, target.layer) - layout.cell * 0.52,
      "White +1",
      "#e7fbff",
    );
  }
  world.resources.ui.pendingUpgrade = null;
  world.resources.phase.name = "camp_finish";
  world.resources.ui.buttons = [];
}

function skipPendingUpgrade(world) {
  const ui = world.resources.ui;
  const pending = ui.pendingUpgrade;
  const source = pending && pending.source ? pending.source : "reward";
  const roomType = pending && pending.roomType ? pending.roomType : "combat";
  const branchCompleteAfter = !!(pending && pending.branchCompleteAfter);

  ui.neuronInspect = null;
  ui.legendaryInspect = null;
  ui.pendingUpgrade = null;
  clearDragState(ui);

  if (source === "shop") {
    world.resources.phase.name = "shop";
    return;
  }
  if (source === "camp") {
    completeMapRoom(world);
    return;
  }
  if (source === "map_entry") {
    world.resources.run.hasOpeningUpgrade = true;
    beginWave(world, roomType);
    return;
  }
  if (source === "post_combat") {
    world.resources.run.pendingBranchComplete = branchCompleteAfter;
    world.resources.phase.name = "combat_finish";
    return;
  }
  if (world.resources.run.wave === 0) {
    beginWave(world, "combat");
    return;
  }
  world.resources.run.pendingBranchComplete = false;
  world.resources.phase.name = "combat_finish";
}

function openCamp(world) {
  world.resources.phase.name = "camp";
  world.resources.ui.pendingUpgrade = null;
  world.resources.ui.legendaryDrop = null;
  world.resources.ui.neuronInspect = null;
  world.resources.ui.legendaryInspect = null;
  clearDragState(world.resources.ui);
  world.resources.ui.buttons = [];
}

function openCampEmpower(world) {
  openReward(world, {
    source: "camp",
    rewards: [CAMP_EMPOWER_UPGRADE],
  });
}

function normalWaveEnemyCount(wave, run) {
  return (3 + wave + Math.floor(wave / 2)) * Math.max(1, encounterThemes(run || {}).length);
}

function normalWaveSpawnInterval(wave) {
  return Math.max(0.58, 0.92 - wave * 0.04);
}

function beginWave(world, roomType) {
  const run = world.resources.run;
  run.currentRoomType = roomType;
  run.wave += 1;
  run.enemiesRemaining = roomType === "elite" || roomType === "boss" ? 1 : normalWaveEnemyCount(run.wave, run);
  run.spawnTimer = roomType === "elite" || roomType === "boss" ? 0.45 : 0.42;
  run.waveClearDelay = 0;
  run.pendingLegendaryOpening = true;
  run.legendaryBattle = {
    fireFromFreezeBonus: 0,
    curseFromSlowBonus: 0,
  };
  world.resources.phase.name = "combat";
  world.resources.ui.buttons = [];
}

function createEnemyAt(world, lane, kind, y, extra = {}) {
  const entity = createEnemy(world, lane, kind);
  const enemy = world.getComponent(entity, "enemy");
  if (enemy) {
    enemy.y = y;
    Object.assign(enemy, extra);
  }
  return entity;
}

function beetleBossSummonKind(wave, run = null) {
  return {
    family: "beetle",
    hp: 1,
    speed: 28 + wave * 0.7,
    reward: 0,
    damage: 1,
    radius: 12,
    shape: "square",
    tint: "#97b46f",
  };
}

function spawnBeetleBossMinion(world, bossEnemy) {
  const laneShift = world.resources.rng() < 0.5 ? -1 : 1;
  const lane = clamp(bossEnemy.lane + laneShift, 0, LANE_COUNT - 1);
  const kind = beetleBossSummonKind(world.resources.run.wave, world.resources.run);
  createEnemyAt(world, lane, kind, bossEnemy.y - bossEnemy.radius * 0.72, {
    xOffset: bossEnemy.xOffset || 0,
  });
}

function splitWormBoss(world, entity, enemy) {
  const eliteKind = eliteSpiderKind(world.resources.run.wave, "worm", world.resources.run);
  const spacing = world.resources.layout ? world.resources.layout.cell * 0.2 : 0;
  const leftLane = clamp(enemy.lane - 1, 0, LANE_COUNT - 1);
  const rightLane = clamp(enemy.lane + 1, 0, LANE_COUNT - 1);
  createFlash(world, enemyScreenX(world.resources.layout, enemy), enemy.y, "rgba(246, 248, 251, 0.92)", enemy.radius * 1.18, {
    style: "shock",
    accent: enemy.tint || COLORS.energyBright,
    life: 0.34,
  });
  createEnemyAt(world, leftLane, eliteKind, enemy.y - enemy.radius * 0.16, { xOffset: -spacing });
  createEnemyAt(world, rightLane, eliteKind, enemy.y - enemy.radius * 0.16, { xOffset: spacing });
  world.destroyEntity(entity);
}

function summonKind(world) {
  const run = world.resources.run;
  const kinds = enemyKinds(run.wave, "combat", run.currentBranchTheme, run);
  return weightedChoice(world.resources.rng, kinds);
}

function releasePendingSummons(world) {
  const { network, layout, phase } = world.resources;
  if (phase.name !== "combat" || !layout || !Array.isArray(network.pendingSummons) || network.pendingSummons.length === 0) {
    return;
  }

  while (network.pendingSummons.length > 0) {
    const summon = network.pendingSummons.shift();
    const kind = summonKind(world);
    if (!kind) {
      continue;
    }
    const hp = Math.max(1, Math.round(kind.hp));
    createSummonBot(world, summon.lane, networkLayerY(layout, summon.layer) - layout.cell * 0.18, {
      family: kind.family,
      shape: kind.shape,
      tint: kind.tint,
      radius: kind.radius,
      hp,
      damage: hp,
      speed: Math.max(46, 60 + kind.speed * 0.9),
      burn: summon.fire > 0 ? summon.fire * 2.4 : 0,
      curse: summon.curse > 0 ? summon.curse * 1.8 : 0,
    });
    createFlash(world, laneCenterX(layout, summon.lane), networkLayerY(layout, summon.layer), "rgba(143, 216, 255, 0.86)", layout.cell * 0.7, {
      style: "shock",
      accent: "rgba(246, 248, 251, 0.56)",
      life: 0.22,
    });
  }
}

function applyHit(world, enemyId, projectile, contactX, contactY) {
  const enemy = world.getComponent(enemyId, "enemy");
  if (!enemy) {
    return;
  }
  const run = world.resources.run;
  const enemyCenterX = enemyScreenX(world.resources.layout, enemy);
  const knockDx = enemyCenterX - contactX;
  const knockDy = enemy.y - contactY;
  const knockLen = Math.hypot(knockDx, knockDy) || 1;

  const shielded = (enemy.shield || 0) > 0;
  let remainingDamage = projectile.damage;
  if (shielded) {
    const absorbed = Math.min(enemy.shield, remainingDamage);
    enemy.shield -= absorbed;
    enemy.shieldHitFlash = Math.max(enemy.shieldHitFlash || 0, 1);
    remainingDamage -= absorbed;
    createDamageText(world, contactX, contactY - enemy.radius * 0.4, Math.max(1, Math.round(absorbed)), "#9fdcff");
    createFlash(world, contactX, contactY, "rgba(143, 216, 255, 0.86)", enemy.radius * 1.04, {
      style: "shock",
      accent: "rgba(221, 248, 255, 0.68)",
      life: 0.24,
    });
    if (enemy.shield <= 0) {
      enemy.shieldHitFlash = 0;
      createFlash(world, contactX, contactY, "rgba(164, 232, 255, 0.94)", enemy.radius * 1.34, {
        style: "shock",
        accent: "rgba(244, 251, 255, 0.76)",
        life: 0.38,
      });
    }
  }
  enemy.hp -= remainingDamage;
  enemy.hitFlash = Math.max(enemy.hitFlash || 0, 0.16);
  enemy.hitNudgeX = (knockDx / knockLen) * Math.min(enemy.radius * 0.12, 5);
  enemy.hitNudgeY = (knockDy / knockLen) * Math.min(enemy.radius * 0.1, 4);
  if (remainingDamage > 0) {
    createDamageText(world, contactX, contactY - enemy.radius * 0.2, Math.max(1, Math.round(remainingDamage)));
  }
  const burnRule = PERIODIC_STATUS_RULES.burn;
  const curseRule = PERIODIC_STATUS_RULES.curse;
  if (projectile.burn > 0) {
    enemy.status.burn = clamp(enemy.status.burn + projectile.burn, 0, burnRule.cap);
    enemy.burnHold = Math.max(enemy.burnHold || 0, burnRule.hold);
  }
  if (projectile.curse > 0) {
    enemy.status.curse = clamp(enemy.status.curse + projectile.curse, 0, curseRule.cap);
    enemy.curseHold = Math.max(enemy.curseHold || 0, curseRule.hold);
  }
  if (!shielded) {
    enemy.status.slow = Math.max(enemy.status.slow, projectile.slow);
    enemy.status.freeze = Math.max(enemy.status.freeze, projectile.freeze * 1.35);
    enemy.pushImpulse = Math.max(enemy.pushImpulse, projectile.pushback * (enemy.pushbackResistance || 1));
  }

  if (!shielded && projectile.freeze > 0 && hasLegendaryPerk(run, "thermal_feedback")) {
    run.legendaryBattle.fireFromFreezeBonus += 0.2;
  }
  if (!shielded && projectile.slow > 0 && hasLegendaryPerk(run, "void_resonance")) {
    run.legendaryBattle.curseFromSlowBonus += 0.2;
  }

  createFlash(world, contactX, contactY, COLORS.threat, 20, { style: "burst", life: 0.18 });
  if (projectile.pierce > 0) {
    createFlash(world, contactX, contactY, "rgba(245, 247, 255, 0.92)", enemy.radius * 1.2, {
      style: "pierce",
      accent: "rgba(127, 224, 255, 0.82)",
      life: 0.22,
      rotation: Math.atan2(projectile.y - enemy.y, projectile.x - enemyCenterX),
    });
  }
  if (projectile.burn > 0) {
    createFlash(world, contactX, contactY, "rgba(255, 132, 76, 0.88)", enemy.radius * 0.92, {
      style: "burn",
      accent: "rgba(255, 205, 134, 0.72)",
      life: 0.26,
    });
  }
  if (projectile.curse > 0) {
    createFlash(world, contactX, contactY, "rgba(174, 116, 255, 0.72)", enemy.radius * 1.08, {
      style: "curse",
      accent: "rgba(226, 197, 255, 0.7)",
      life: 0.3,
    });
  }
  if (!shielded && projectile.slow > 0) {
    createFlash(world, contactX, contactY, "rgba(110, 245, 255, 0.7)", enemy.radius * 1.02, {
      style: "slow",
      accent: "rgba(213, 250, 255, 0.65)",
      life: 0.28,
    });
  }
  if (!shielded && projectile.freeze > 0) {
    createFlash(world, contactX, contactY, "rgba(221, 250, 255, 0.9)", enemy.radius * 1.16, {
      style: "freeze",
      accent: "rgba(126, 223, 255, 0.72)",
      life: 0.32,
    });
  }
  if (projectile.pushback > 0) {
    createFlash(world, contactX, contactY, "rgba(255, 214, 104, 0.72)", enemy.radius * 1.14, {
      style: "shock",
      accent: "rgba(255, 244, 200, 0.52)",
      life: 0.22,
    });
  }

  if (projectile.split > 0) {
    createShard(world, enemy.lane, contactX, contactY, -0.22, projectile);
    createShard(world, enemy.lane, contactX, contactY, 0.22, projectile);
  }

  if (projectile.ricochet > 0) {
    let bestTargetId = 0;
    let bestTarget = null;
    let bestLaneDistance = Infinity;
    for (const id of world.query("enemy")) {
      if (id === enemyId) {
        continue;
      }
      const candidate = world.getComponent(id, "enemy");
      if (!candidate || Math.abs(candidate.y - enemy.y) >= 120) {
        continue;
      }
      const laneDistance = Math.abs(candidate.lane - enemy.lane);
      if (laneDistance < bestLaneDistance) {
        bestLaneDistance = laneDistance;
        bestTargetId = id;
        bestTarget = candidate;
      }
    }

    if (bestTargetId && bestTarget) {
      createProjectile(world, bestTarget.lane, contactX, contactY, bestTargetId, {
        damage: projectile.damage,
        pierce: 0,
        split: 0,
        ricochet: projectile.ricochet - 1,
        burn: projectile.burn,
        curse: projectile.curse,
        slow: projectile.slow,
        freeze: projectile.freeze,
        pushback: projectile.pushback,
      });
    }
  }
}

function createEnemyDeathBurst(world, enemy, x, y) {
  const burstColor = enemy.tint || COLORS.threat;
  createFlash(world, x, y, burstColor, enemy.radius * 1.18, { style: "burst", life: 0.42 });
  createFlash(world, x, y, "rgba(246, 248, 251, 0.9)", enemy.radius * 0.72, { style: "shock", accent: burstColor, life: 0.34 });
  if (enemy.status.burn > 0) {
    createFlash(world, x, y, "rgba(255, 132, 76, 0.88)", enemy.radius * 1.06, { style: "burn", accent: "rgba(255, 216, 142, 0.7)", life: 0.56 });
  }
  if (enemy.status.curse > 0) {
    createFlash(world, x, y, "rgba(174, 116, 255, 0.7)", enemy.radius * 1.14, { style: "curse", accent: "rgba(233, 208, 255, 0.65)", life: 0.6 });
  }
  if (enemy.status.freeze > 0) {
    createFlash(world, x, y, "rgba(221, 250, 255, 0.92)", enemy.radius * 1.2, { style: "freeze", accent: "rgba(136, 225, 255, 0.72)", life: 0.62 });
  }
  if (enemy.status.slow > 0) {
    createFlash(world, x, y, "rgba(110, 245, 255, 0.68)", enemy.radius * 1.08, { style: "slow", accent: "rgba(214, 251, 255, 0.6)", life: 0.52 });
  }
}

function rewardDragTarget(world, pointerX, pointerY, pendingUpgrade) {
  const { layout, network } = world.resources;
  const layerY = (layer) => phaseLayerY(world, layer);
  const bounds = networkLayerBounds(layout);
  const magnetRadius = layout.cell * 1.9;
  const insideNetworkBounds =
    pointerX >= layout.gridX - layout.cell * 0.9 &&
    pointerX <= layout.gridX + layout.gridWidth + layout.cell * 0.9 &&
    pointerY >= bounds.top - layout.cell * 1.2 &&
    pointerY <= bounds.bottom + layout.cell * 1.2;
  let best = null;
  let bestDistance = insideNetworkBounds ? Infinity : magnetRadius;

  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const target = { layer, lane };
      if (!canDropUpgradeOnNode(network, pendingUpgrade, target)) {
        continue;
      }
      const x = laneCenterX(layout, lane);
      const y = layerY(layer);
      const distance = Math.hypot(pointerX - x, pointerY - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { target, x, y, distance };
      }
    }
  }

  return best;
}

function rearrangeDragTarget(world, pointerX, pointerY, sourceTarget) {
  const { layout, network } = world.resources;
  const sourceNode = sourceTarget ? network.nodes[sourceTarget.layer][sourceTarget.lane] : null;
  if (!sourceTarget || !nodeHasInstalledUpgrade(sourceNode)) {
    return null;
  }
  const sourceSnapshot = cloneNodeState(sourceNode);
  const bounds = networkLayerBounds(layout);
  const magnetRadius = layout.cell * 1.9;
  const insideNetworkBounds =
    pointerX >= layout.gridX - layout.cell * 0.9 &&
    pointerX <= layout.gridX + layout.gridWidth + layout.cell * 0.9 &&
    pointerY >= bounds.top - layout.cell * 1.2 &&
    pointerY <= bounds.bottom + layout.cell * 1.2;
  let best = null;
  let bestDistance = insideNetworkBounds ? Infinity : magnetRadius;

  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      if (layer === sourceTarget.layer && lane === sourceTarget.lane) {
        continue;
      }
      const target = { layer, lane };
      const targetNode = network.nodes[layer][lane];
      const targetOccupied = nodeHasInstalledUpgrade(targetNode);
      const targetSnapshot = targetOccupied ? cloneNodeState(targetNode) : createEmptyNodeState();
      if (!isValidNodePlacement(network, sourceSnapshot, target)) {
        continue;
      }
      if (targetOccupied && !canMergeNodeSnapshots(sourceSnapshot, targetSnapshot) && !isValidNodePlacement(network, targetSnapshot, sourceTarget)) {
        continue;
      }
      const x = laneCenterX(layout, lane);
      const y = phaseLayerY(world, layer);
      const distance = Math.hypot(pointerX - x, pointerY - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { target, x, y, distance, occupied: targetOccupied };
      }
    }
  }

  return best;
}

function rewardModuleRects(layout, count) {
  const { width, height, gap } = offerModuleMetrics(layout);
  const x = (layout.width - width) * 0.5;
  const y = layout.contentTop + Math.max(66, layout.cell * 1.22);
  return Array.from({ length: count }, (_, index) => ({
    x,
    y: y + index * (height + gap),
    width,
    height,
  }));
}

function rewardInlineModuleRects(layout, count) {
  return rewardModuleRects(layout, count);
}

function offerModuleMetrics(layout) {
  return {
    width: Math.min(layout.width * 0.84, 336),
    height: Math.max(82, Math.min(92, layout.cell * 2.3)),
    gap: 10,
  };
}

function compactShopLayout(layout) {
  return layout.width <= 520;
}

function mobileShopMetrics(layout) {
  const rewardTop = rewardModuleRects(layout, 1)[0]?.y || (layout.contentTop + 66);
  const toolbarY = layout.contentTop + 4;
  const toolbarHeight = 42;
  return {
    toolbarY,
    toolbarHeight,
    cardsGapFromToolbar: Math.max(6, rewardTop - (toolbarY + toolbarHeight)),
  };
}

function shopItemRects(layout, count) {
  if (compactShopLayout(layout)) {
    const metrics = mobileShopMetrics(layout);
    const { width, height, gap } = offerModuleMetrics(layout);
    const x = (layout.width - width) * 0.5;
    const y = metrics.toolbarY + metrics.toolbarHeight + metrics.cardsGapFromToolbar;
    return Array.from({ length: count }, (_, index) => ({
      x,
      y: y + index * (height + gap),
      width,
      height,
    }));
  }
  const gap = 14;
  const totalGap = gap * (count - 1);
  const width = Math.min(220, (layout.width - 36 - totalGap) / count);
  const x = (layout.width - (width * count + totalGap)) / 2;
  const y = layout.height * 0.19;
  return Array.from({ length: count }, (_, index) => ({
    x: x + index * (width + gap),
    y,
    width,
    height: 184,
  }));
}

function shopControlRects(layout, count) {
  const cards = shopItemRects(layout, count);
  if (compactShopLayout(layout)) {
    const metrics = mobileShopMetrics(layout);
    const width = 96;
    const height = 42;
    const gap = 10;
    const totalWidth = width * 3 + gap * 2;
    const startX = (layout.width - totalWidth) * 0.5;
    const y = metrics.toolbarY;
    return {
      repair: {
        x: startX,
        y,
        width,
        height,
      },
      cancel: {
        x: startX + width + gap,
        y,
        width,
        height,
      },
      reroll: {
        x: startX + width + gap,
        y,
        width,
        height,
      },
      leave: {
        x: startX + (width + gap) * 2,
        y,
        width,
        height,
      },
    };
  }
  const controlY = Math.max(layout.contentTop + 8, (cards[0]?.y || layout.height * 0.19) - 66);
  return {
    repair: {
      x: 28,
      y: controlY,
      width: 156,
      height: 56,
    },
    cancel: {
      x: layout.width / 2 - 78,
      y: controlY,
      width: 156,
      height: 56,
    },
    reroll: {
      x: layout.width / 2 - 78,
      y: controlY,
      width: 156,
      height: 56,
    },
    leave: {
      x: layout.width - 184,
      y: controlY,
      width: 156,
      height: 56,
    },
  };
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function legendaryBadgeRects(layout, run) {
  const perks = run.legendaryPerks || [];
  const size = 28;
  const gap = 8;
  const startX = 22;
  const startY = run.shield > 0 ? 84 : 60;
  return perks.map((perk, index) => ({
    perk,
    x: startX + index * (size + gap),
    y: startY,
    width: size,
    height: size,
  }));
}

function moneyBoxRect(layout) {
  const width = 104;
  return {
    x: layout.width - width - 18,
    y: 10,
    width,
    height: 34,
  };
}

function legendaryPerkAtPointer(world) {
  const { layout, pointer, run } = world.resources;
  if (!layout || !run || !(run.legendaryPerks || []).length) {
    return null;
  }
  const phase = world.resources.phase;
  const currentLegendaryId = phase.name === "legendary_drop" && world.resources.ui.legendaryDrop ? world.resources.ui.legendaryDrop.id : null;
  const rects = legendaryBadgeRects(layout, run);
  for (const rect of rects) {
    if (rect.perk.id === currentLegendaryId) {
      continue;
    }
    if (pointInRect(pointer.x, pointer.y, rect)) {
      return rect;
    }
  }
  return null;
}

function legendaryRectForPerk(layout, run, perkId) {
  if (!layout || !run || !perkId) {
    return null;
  }
  return legendaryBadgeRects(layout, run).find((rect) => rect.perk.id === perkId) || null;
}

function updateLegendaryInspect(world) {
  return world;
}

function collectCoinAtPointer(world) {
  const { pointer, layout, run } = world.resources;
  if (!layout) {
    return false;
  }
  let bestId = 0;
  let bestCoin = null;
  let bestDistance = Infinity;
  for (const entity of world.query("coin")) {
    const coin = world.getComponent(entity, "coin");
    if (!coin) {
      continue;
    }
    const pickupRadius = pointer.pointerType === "mouse"
      ? Math.max(coin.radius * 1.8, layout.cell * 0.42)
      : Math.max(coin.radius * 3.1, layout.cell * 0.92);
    const distance = Math.hypot(pointer.x - coin.x, pointer.y - coin.y);
    if (distance <= pickupRadius && distance < bestDistance) {
      bestDistance = distance;
      bestId = entity;
      bestCoin = coin;
    }
  }
  if (!bestId || !bestCoin) {
    return false;
  }

  const wallet = moneyBoxRect(layout);
  createCoinFly(world, bestCoin.x, bestCoin.y, bestCoin.value, wallet.x + wallet.width - 18, wallet.y + wallet.height * 0.62);
  createFlash(world, bestCoin.x, bestCoin.y, "rgba(255, 212, 112, 0.82)", bestCoin.radius * 1.2, {
    style: "shock",
    accent: "rgba(255, 242, 208, 0.52)",
    life: 0.18,
  });
  world.destroyEntity(bestId);
  run.moneyPickupFlash = Math.max(run.moneyPickupFlash || 0, 1);
  return true;
}

function neuronAtPointer(world) {
  const { layout, pointer } = world.resources;
  if (!layout || !layout.cell) {
    return null;
  }
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const x = laneCenterX(layout, lane);
      const y = phaseLayerY(world, layer);
      const distance = Math.hypot(pointer.x - x, pointer.y - y);
      if (distance <= layout.cell * 0.95) {
        return { layer, lane, x, y };
      }
    }
  }
  return null;
}

function showNeuronInspect(world, target) {
  if (!target) {
    world.resources.ui.neuronInspect = null;
    return;
  }
  const node = world.resources.network.nodes[target.layer][target.lane];
  world.resources.ui.neuronInspect = {
    layer: target.layer,
    lane: target.lane,
    x: target.x,
    y: target.y,
    node,
  };
}

function inspectablePhase(phaseName) {
  return phaseName === "combat" || (
    nodeEditingPhase(phaseName) &&
    phaseName !== "camp_target"
  );
}

export function inputSystem(world) {
  const { pointer, phase, ui } = world.resources;
  if ((phase.name === "combat" || phase.name === "combat_finish" || phase.name === "camp_finish") && (pointer.pointerType === "mouse" || pointer.down)) {
    collectCoinAtPointer(world);
  }

  if (phase.name === "map" && world.resources.run.mapCamera) {
    const run = world.resources.run;
    const camera = run.mapCamera;
    if (pointer.down) {
      if (!camera.dragging) {
        const hitButton = ui.buttons.find((b) => {
          return (
            pointer.x >= b.x &&
            pointer.x <= b.x + b.width &&
            pointer.y >= b.y &&
            pointer.y <= b.y + b.height
          );
        });
        if (!hitButton) {
          camera.dragging = true;
          camera.lastPointerX = pointer.x;
          camera.lastPointerY = pointer.y;
          camera.dragStartX = pointer.x;
          camera.dragStartY = pointer.y;
          camera.didMove = false;
        }
      } else {
        const dx = pointer.x - camera.lastPointerX;
        const dy = pointer.y - camera.lastPointerY;
        camera.x += dx;
        camera.y += dy;
        camera.lastPointerX = pointer.x;
        camera.lastPointerY = pointer.y;
        if (Math.hypot(pointer.x - camera.dragStartX, pointer.y - camera.dragStartY) > 5) {
          camera.didMove = true;
        }
      }
    } else {
      camera.dragging = false;
    }

    if (pointer.justReleased && camera.didMove) {
      pointer.justReleased = false;
      camera.didMove = false;
      return;
    }
  }

  if (nodeEditingPhase(phase.name) && ui.drag) {
    const layout = world.resources.layout;
    const network = world.resources.network;
    const allowUpgradeDrag = phase.name === "reward_drag" || phase.name === "shop";
    const isRewardDrag = phase.name === "reward_drag";
    const moduleRects = phase.name === "reward_drag" ? rewardInlineModuleRects(layout, ui.cards.length) : phase.name === "shop" ? shopItemRects(layout, ui.shopStock.length) : [];
    const shopControls = phase.name === "shop" ? shopControlRects(layout, ui.shopStock.length) : null;

    if (pointer.down && !ui.drag.active && !ui.drag.started) {
      let startedCardDrag = false;
      if (allowUpgradeDrag) {
        for (let index = 0; index < moduleRects.length; index += 1) {
          const rect = moduleRects[index];
          const inside = pointInRect(pointer.x, pointer.y, rect);
          if (inside) {
            const item = isRewardDrag ? ui.cards[index] : ui.shopStock[index];
            if (!item || item.sold || (!isRewardDrag && world.resources.run.money < item.price)) {
              continue;
            }
            ui.rewardSelection = index;
            ui.pendingUpgrade = isRewardDrag
              ? {
                  source: ui.pendingUpgrade && ui.pendingUpgrade.source ? ui.pendingUpgrade.source : "reward",
                  upgrade: item,
                  roomType: ui.pendingUpgrade ? ui.pendingUpgrade.roomType || null : null,
                  nodeId: ui.pendingUpgrade && typeof ui.pendingUpgrade.nodeId === "number" ? ui.pendingUpgrade.nodeId : null,
                  branchCompleteAfter: !!(ui.pendingUpgrade && ui.pendingUpgrade.branchCompleteAfter),
                }
              : {
                  source: "shop",
                  upgrade: item,
                  price: item.price,
                  item,
                };
            ui.drag.active = true;
            ui.drag.started = true;
            ui.drag.sourceKind = "upgrade";
            ui.drag.sourceTarget = null;
            ui.drag.sourceNode = null;
            ui.drag.startX = pointer.x;
            ui.drag.startY = pointer.y;
            ui.drag.x = rect.x + rect.width * 0.5;
            ui.drag.y = rect.y + rect.height * 0.5;
            startedCardDrag = true;
            break;
          }
        }
      }
      if (!startedCardDrag) {
        const hit = neuronAtPointer(world);
        if (hit) {
          const node = network.nodes[hit.layer][hit.lane];
          if (nodeHasInstalledUpgrade(node)) {
            ui.drag.armed = true;
            ui.drag.started = false;
            ui.drag.sourceKind = "node";
            ui.drag.sourceTarget = { layer: hit.layer, lane: hit.lane, x: hit.x, y: hit.y };
            ui.drag.sourceNode = cloneNodeState(node);
            ui.drag.startX = pointer.x;
            ui.drag.startY = pointer.y;
            ui.drag.x = hit.x;
            ui.drag.y = hit.y;
            ui.drag.hoverTarget = null;
          }
        }
      }
    }

    if (pointer.down && (ui.drag.armed || ui.drag.started) && !ui.drag.active && ui.drag.sourceKind === "node") {
      const dragDistance = Math.hypot(pointer.x - ui.drag.startX, pointer.y - ui.drag.startY);
      if (dragDistance > Math.max(5, layout.cell * 0.14)) {
        ui.drag.armed = false;
        ui.drag.started = true;
        ui.drag.active = true;
      }
    }

    if (ui.drag.active) {
      ui.drag.x = pointer.x;
      ui.drag.y = pointer.y;
      const hover =
        ui.drag.sourceKind === "node"
          ? rearrangeDragTarget(world, pointer.x, pointer.y, ui.drag.sourceTarget)
          : ui.pendingUpgrade
            ? rewardDragTarget(world, pointer.x, pointer.y, ui.pendingUpgrade)
            : null;
      ui.drag.hoverTarget = hover;
    }

    if (pointer.justReleased && ui.drag.sourceKind === "node" && (ui.drag.armed || ui.drag.started || ui.drag.active)) {
      const dragDistance = Math.hypot(pointer.x - ui.drag.startX, pointer.y - ui.drag.startY);
      const didMove = ui.drag.active || dragDistance > Math.max(5, layout.cell * 0.14);
      if (ui.drag.active && ui.drag.hoverTarget) {
        commitNodeReorder(world, ui.drag.sourceTarget, ui.drag.hoverTarget.target);
        pointer.justReleased = false;
        clearDragState(ui);
        return;
      }
      clearDragState(ui);
      if (didMove) {
        pointer.justReleased = false;
        return;
      }
    }

    if (allowUpgradeDrag && pointer.justReleased && ui.drag.sourceKind === "upgrade" && (ui.drag.active || ui.drag.started || ui.pendingUpgrade)) {
      const releasedOnCancel = !isRewardDrag && shopControls && pointInRect(pointer.x, pointer.y, shopControls.cancel);
      pointer.justReleased = false;
      if (ui.drag.active && ui.drag.hoverTarget) {
        commitUpgradeTarget(world, ui.drag.hoverTarget.target);
      } else if (ui.drag.active && releasedOnCancel) {
        ui.pendingUpgrade = null;
      } else if (!isRewardDrag) {
        ui.pendingUpgrade = null;
      }
      clearDragState(ui);
    }
    if (!ui.drag.active && !ui.drag.started && pointer.justReleased) {
      const toolbarHit = ui.buttons.find((button) => {
        return (
          pointer.x >= button.x &&
          pointer.x <= button.x + button.width &&
          pointer.y >= button.y &&
          pointer.y <= button.y + button.height
        );
      });
      if (toolbarHit) {
        if (phase.name === "reward_drag" && toolbarHit.action === "leave_reward") {
          pointer.justReleased = false;
          skipPendingUpgrade(world);
          return;
        }
        if (phase.name === "reward_drag" && toolbarHit.action === "reroll_reward") {
          pointer.justReleased = false;
          rerollUpgrades(world, "reward");
          return;
        }
        if (phase.name === "shop" && toolbarHit.action === "reroll_shop") {
          pointer.justReleased = false;
          rerollUpgrades(world, "shop");
          return;
        }
      }
    }
    if (isRewardDrag || ui.drag.active || ui.drag.started || ui.pendingUpgrade) {
      if (!ui.drag.active && !ui.drag.started && pointer.justReleased && inspectablePhase(phase.name)) {
        pointer.justReleased = false;
        const legendaryTarget = legendaryPerkAtPointer(world);
        if (legendaryTarget) {
          ui.legendaryInspect = legendaryTarget.perk;
          ui.neuronInspect = null;
          return;
        }
        const target = neuronAtPointer(world);
        if (target) {
          showNeuronInspect(world, target);
          ui.legendaryInspect = null;
        } else {
          ui.neuronInspect = null;
          ui.legendaryInspect = null;
        }
      }
      return;
    }
  }

  if (!pointer.justReleased) {
    return;
  }
  pointer.justReleased = false;

  const legendaryHit = legendaryPerkAtPointer(world);
  if (legendaryHit) {
    ui.legendaryInspect = legendaryHit.perk;
    ui.neuronInspect = null;
    return;
  }

  if (inspectablePhase(phase.name)) {
    const target = neuronAtPointer(world);
    if (target) {
      showNeuronInspect(world, target);
      ui.legendaryInspect = null;
      return;
    }
    ui.neuronInspect = null;
    ui.legendaryInspect = null;
  }
  if (ui.legendaryInspect || ui.neuronInspect) {
    ui.legendaryInspect = null;
    ui.neuronInspect = null;
  }

  if (phase.name === "map") {
    const directNode = mapHitNode(world, pointer.x, pointer.y);
    if (directNode) {
      enterMapNode(world, directNode.id);
      return;
    }
  }

  const hit = ui.buttons.find((button) => {
    return (
      pointer.x >= button.x &&
      pointer.x <= button.x + button.width &&
      pointer.y >= button.y &&
      pointer.y <= button.y + button.height
    );
  });

  if (!hit) {
    return;
  }

  if (phase.name === "reward") {
    world.resources.ui.pendingUpgrade = {
      source: "reward",
      upgrade: hit.upgrade,
    };
    world.resources.phase.name = "reward_target";
    return;
  }

  if (phase.name === "reward_target") {
    if (hit.action === "cancel_reward_target") {
      world.resources.ui.pendingUpgrade = null;
      world.resources.phase.name = "reward";
      return;
    }
    if (hit.target) {
      commitUpgradeTarget(world, hit.target);
    }
    return;
  }

  if (phase.name === "reward_drag") {
    if (hit.action === "leave_reward") {
      skipPendingUpgrade(world);
      return;
    }
    if (hit.action === "reroll_reward") {
      rerollUpgrades(world, "reward");
    }
    return;
  }

  if (phase.name === "doors") {
    if (hit.roomType === "shop") {
      openShop(world);
      return;
    }
    if (hit.roomType === "camp") {
      openCamp(world);
      return;
    }
    beginWave(world, hit.roomType);
    return;
  }

  if (phase.name === "shop") {
    if (hit.action === "leave") {
      completeMapRoom(world);
      return;
    }
    if (hit.action === "reroll_shop") {
      rerollUpgrades(world, "shop");
      return;
    }
    if (hit.action === "repair" && world.resources.run.money >= 12) {
      world.resources.run.money -= 12;
      world.resources.run.baseHp = Math.min(world.resources.run.maxBaseHp, world.resources.run.baseHp + 2);
    }
    return;
  }

  if (phase.name === "shop_target") {
    if (hit.action === "cancel_shop_target") {
      world.resources.ui.pendingUpgrade = null;
      world.resources.phase.name = "shop";
      return;
    }
    if (hit.target) {
      commitUpgradeTarget(world, hit.target);
    }
    return;
  }

  if (phase.name === "camp") {
    if (hit.action === "camp_heal") {
      world.resources.run.baseHp = Math.min(world.resources.run.maxBaseHp, world.resources.run.baseHp + 3);
      completeMapRoom(world);
      return;
    }
    if (hit.action === "camp_upgrade") {
      openCampEmpower(world);
      return;
    }
    return;
  }

  if (phase.name === "camp_target") {
    if (hit.action === "cancel_camp_target") {
      world.resources.phase.name = "camp";
      return;
    }
    if (hit.target) {
      commitCampTarget(world, hit.target);
    }
    return;
  }

  if (phase.name === "legendary_drop") {
    if (hit.action === "legendary_ok") {
      world.resources.ui.rewardIntro.closing = true;
    }
    return;
  }

  if (phase.name === "combat_finish") {
    if (hit.action === "finish_battle") {
      if (world.resources.run.pendingBranchComplete) {
        world.resources.run.pendingBranchComplete = false;
        completeBranchProgress(world);
        return;
      }
      completeMapRoom(world);
    }
    return;
  }

  if (phase.name === "camp_finish") {
    if (hit.action === "finish_camp") {
      completeMapRoom(world);
    }
    return;
  }

  if (phase.name === "map") {
    if (hit.action === "reset_progress") {
      clearMetaProgress();
      resetRun(world);
      return;
    }
    if (hit && typeof hit.nodeId === "number") {
      enterMapNode(world, hit.nodeId);
    }
    return;
  }

  if (phase.name === "gameover") {
    world.resources.resetRequested = true;
  }
}

export function combatStateSystem(world, delta) {
  const { phase, run } = world.resources;
  if (phase.name === "legendary_drop") {
    const intro = world.resources.ui.rewardIntro;
    if (intro.closing) {
      intro.timer = Math.max(0, intro.timer - delta);
    }
    if (intro.closing && intro.timer <= 0) {
      world.resources.ui.legendaryDrop = null;
      if (intro.nextAction === "map") {
        completeMapRoom(world);
      } else {
        openReward(world, { rewards: world.resources.ui.stagedReward });
      }
    }
    return;
  }

  if (phase.name === "reward_victory") {
    const intro = world.resources.ui.rewardIntro;
    intro.timer = Math.max(0, intro.timer - delta);
    if (intro.timer <= 0) {
      openReward(world, { rewards: world.resources.ui.stagedReward });
    }
    return;
  }

  if (phase.name !== "combat") {
    return;
  }

  if (run.pendingLegendaryOpening) {
    if (run.legendaryPerks.some((perk) => perk.id === "opening_barrage")) {
      triggerLegendaryOpeningVolley(world.resources.network);
    }
    run.pendingLegendaryOpening = false;
  }

  world.resources.network.sameTypeResonance = hasLegendaryPerk(run, "resonant_mesh");
  world.resources.network.globalFireRateMultiplier = hasLegendaryPerk(run, "rapid_chamber") ? 2 : 1;
  updateNetwork(world.resources.network, delta);

  if (run.enemiesRemaining <= 0 && world.query("enemy").length === 0) {
    run.waveClearDelay += delta;
    if (run.waveClearDelay > 0.5) {
      openRewardVictory(world);
    }
  }
}

export function enemySpawnSystem(world, delta) {
  const { phase, run } = world.resources;
  if (phase.name !== "combat" || run.enemiesRemaining <= 0) {
    return;
  }

  run.spawnTimer -= delta;
  if (run.spawnTimer > 0) {
    return;
  }

  run.spawnTimer = run.currentRoomType === "elite" ? 9 : normalWaveSpawnInterval(run.wave);
  run.enemiesRemaining -= 1;
  if (run.currentRoomType === "boss") {
    createEnemy(world, Math.floor(world.resources.rng() * LANE_COUNT), bossSpiderKind(run.wave, run.currentBranchTheme, run));
    return;
  }
  if (run.currentRoomType === "elite") {
    createEnemy(world, Math.floor(world.resources.rng() * LANE_COUNT), eliteSpiderKind(run.wave, run.currentBranchTheme, run));
    return;
  }
  createEnemy(world, Math.floor(world.resources.rng() * LANE_COUNT), pickEnemyKind(world));
}

export function towerFireSystem(world, delta) {
  const { phase, network, layout, turret, run } = world.resources;
  if (phase.name !== "combat" || !layout || !layout.cell) {
    return;
  }

  const chargeTarget = computeTurretChargeProgress(network);
  const chargeBlend = chargeTarget >= (turret.chargeVisual || 0) ? 1 - Math.exp(-delta * 8.2) : 1 - Math.exp(-delta * 12.5);
  turret.chargeVisual = (turret.chargeVisual || 0) + (chargeTarget - (turret.chargeVisual || 0)) * chargeBlend;
  turret.chargeCycle = ((turret.chargeCycle || 0) + delta * (0.9 + chargeTarget * 3.1)) % (Math.PI * 2);
  turret.chargeBurst = Math.max(0, (turret.chargeBurst || 0) - delta * 1.9);
  turret.coreFlash = Math.max(0, (turret.coreFlash || 0) - delta * 2.8);
  turret.muzzleFlash = Math.max(0, (turret.muzzleFlash || 0) - delta * 9.5);
  turret.recoil = Math.max(0, (turret.recoil || 0) - delta * 7.8);

  let bestTarget = null;
  for (const entity of world.query("enemy")) {
    const enemy = world.getComponent(entity, "enemy");
    if (!enemy) {
      continue;
    }
    if (!bestTarget || enemy.y > bestTarget.enemy.y) {
      bestTarget = { entity, enemy };
    }
  }

  const targetEnemyX = bestTarget ? enemyScreenX(layout, bestTarget.enemy) : layout.turretX;
  const targetY = bestTarget ? bestTarget.enemy.y : layout.fieldTop;
  turret.targetAngle = Math.atan2(targetY - layout.turretY, targetEnemyX - layout.turretX);
  const angleDelta = turret.targetAngle - turret.angle;
  turret.angle += angleDelta * 0.12;

  network.globalFireRateMultiplier = hasLegendaryPerk(run, "rapid_chamber") ? 2 : 1;
  network.sameTypeResonance = hasLegendaryPerk(run, "resonant_mesh");
  releasePendingSummons(world);
  if (!bestTarget || network.queuedShots.length === 0) {
    return;
  }

  const shot = network.queuedShots.shift();
  const combinedEffects = {};
  const sourceLane = typeof shot.sourceLane === "number" ? shot.sourceLane : shot.lane;
  for (const key of Object.keys(network.nodes[0][sourceLane].effects)) {
    combinedEffects[key] = 0;
  }
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    const lane = layer === 0 ? sourceLane : shot.lane;
    const node = network.nodes[layer][lane];
    for (const key of Object.keys(node.effects)) {
      combinedEffects[key] += node.effects[key] || 0;
    }
  }
  if (typeof shot.overdrive === "number") {
    combinedEffects.overdrive = Math.max(combinedEffects.overdrive, shot.overdrive);
  }
  const damageScale = 1 + combinedEffects.overdrive;
  const statusScale = 1 + combinedEffects.overdrive;
  const muzzle = turretMuzzle(layout, turret.angle);
  const damage = Math.round(shot.damage * damageScale);

  createProjectile(world, shot.lane, muzzle.x, muzzle.y, bestTarget.entity, {
    damage,
    pierce: combinedEffects.penetration,
    split: combinedEffects.split,
    ricochet: combinedEffects.ricochet,
    burn: combinedEffects.fire * 2.4 * statusScale,
    curse: combinedEffects.curse * 1.8 * statusScale,
    slow: combinedEffects.slow * 0.85 * statusScale,
    freeze: combinedEffects.freeze * 1.6 * statusScale,
    pushback: combinedEffects.pushback * 18 * statusScale,
  });
  createFlash(world, muzzle.x, muzzle.y, COLORS.energyBright, 34);
  createFlash(world, layout.turretX, layout.turretY, COLORS.energy, 20);
  turret.recoil = Math.max(turret.recoil || 0, 1);
  turret.muzzleFlash = 1;
  turret.coreFlash = 1;
  turret.chargeBurst = Math.max(turret.chargeBurst || 0, 1);
  turret.chargeVisual = Math.max(0, (turret.chargeVisual || 0) * 0.72);

  if (combinedEffects.shield > 0) {
    world.resources.run.shield = Math.min(8, world.resources.run.shield + combinedEffects.shield);
  }
}

export function enemyMovementSystem(world, delta) {
  const { layout, run, phase } = world.resources;
  if (phase.name !== "combat" || !layout || !layout.baseLineY) {
    return;
  }

  run.baseHitFlash = Math.max(0, (run.baseHitFlash || 0) - delta * 1.7);
  run.shieldHitFlash = Math.max(0, (run.shieldHitFlash || 0) - delta * 2);

  const fireDotMultiplier = 1 + ((run.legendaryBattle && run.legendaryBattle.fireFromFreezeBonus) || 0);
  const curseDotMultiplier = 1 + ((run.legendaryBattle && run.legendaryBattle.curseFromSlowBonus) || 0);

  for (const entity of world.query("enemy")) {
    const enemy = world.getComponent(entity, "enemy");
    if (!enemy) {
      continue;
    }

    enemy.burnHold = Math.max(0, (enemy.burnHold || 0) - delta);
    enemy.curseHold = Math.max(0, (enemy.curseHold || 0) - delta);
    if ((enemy.burnHold || 0) <= 0) {
      enemy.status.burn = Math.max(0, enemy.status.burn - delta * 0.45);
    }
    if ((enemy.curseHold || 0) <= 0) {
      enemy.status.curse = Math.max(0, enemy.status.curse - delta * 0.45);
    }
    enemy.status.slow = Math.max(0, enemy.status.slow - delta);
    enemy.status.freeze = Math.max(0, enemy.status.freeze - delta * 0.34);
    if ((enemy.shield || 0) > 0) {
      enemy.status.slow = 0;
      enemy.status.freeze = 0;
    }
    enemy.shieldHitFlash = Math.max(0, (enemy.shieldHitFlash || 0) - delta * 3.2);
    enemy.shieldVisualPulse = (enemy.shieldVisualPulse || 0) + delta;
    enemy.hitFlash = Math.max(0, (enemy.hitFlash || 0) - delta);
    enemy.hitNudgeX = (enemy.hitNudgeX || 0) * Math.max(0, 1 - delta * 18);
    enemy.hitNudgeY = (enemy.hitNudgeY || 0) * Math.max(0, 1 - delta * 18);
    enemy.shieldTouchCooldown = Math.max(0, (enemy.shieldTouchCooldown || 0) - delta);
    enemy.burnTickTimer = (enemy.burnTickTimer || 0) + delta;
    enemy.curseTickTimer = (enemy.curseTickTimer || 0) + delta;

    if (enemy.boss && enemy.bossAbility === "summon_beetle") {
      enemy.summonTimer = Math.max(0, (enemy.summonTimer || enemy.summonInterval || 1) - delta);
      if (enemy.summonTimer <= 0) {
        spawnBeetleBossMinion(world, enemy);
        enemy.summonTimer = enemy.summonInterval || 1;
      }
    }

    if (enemy.status.burn > 0) {
      const burnDamage = delta * enemy.status.burn * fireDotMultiplier;
      const applied = applyPeriodicDamage(enemy, burnDamage, PERIODIC_STATUS_RULES.burn.throughShield);
      enemy.burnTickAccum = (enemy.burnTickAccum || 0) + applied.shield + applied.hp;
      if (enemy.burnTickTimer >= 0.24 && enemy.burnTickAccum >= 0.35) {
        createDamageText(world, enemyScreenX(layout, enemy), enemy.y - enemy.radius * 0.34, Math.max(1, Math.round(enemy.burnTickAccum)), "#ff9d72");
        enemy.burnTickTimer = 0;
        enemy.burnTickAccum = 0;
      }
    }
    if (enemy.status.curse > 0) {
      const curseDamage = delta * enemy.status.curse * curseDotMultiplier;
      const applied = applyPeriodicDamage(enemy, curseDamage, PERIODIC_STATUS_RULES.curse.throughShield);
      enemy.curseTickAccum = (enemy.curseTickAccum || 0) + applied.shield + applied.hp;
      if (enemy.curseTickTimer >= 0.28 && enemy.curseTickAccum >= 0.35) {
        createDamageText(world, enemyScreenX(layout, enemy), enemy.y - enemy.radius * 0.58, Math.max(1, Math.round(enemy.curseTickAccum)), "#c79aff");
        enemy.curseTickTimer = 0;
        enemy.curseTickAccum = 0;
      }
    }

    if (enemy.status.burn <= 0) {
      enemy.burnTickTimer = 0;
      enemy.burnTickAccum = 0;
    }
    if (enemy.status.curse <= 0) {
      enemy.curseTickTimer = 0;
      enemy.curseTickAccum = 0;
    }

    const frozen = enemy.status.freeze > 0.04;
    const slowMultiplier = enemy.status.slow > 0 ? Math.max(0.42, 1 - enemy.status.slow * 0.32) : 1;
    const push = enemy.pushImpulse;
    enemy.pushImpulse = Math.max(0, enemy.pushImpulse - delta * 90);

    if (!frozen) {
      if (enemy.boss) {
        enemy.bossSweepTime = (enemy.bossSweepTime || 0) + delta;
        enemy.xOffset =
          (enemy.bossSweepAnchorOffset || 0) +
          zigzagWave(enemy.bossSweepTime, enemy.bossSweepPeriod || 4.8) * (enemy.bossSweepAmplitude || 0);
      } else if (enemy.family === "worm") {
        enemy.wormZigzagTime = (enemy.wormZigzagTime || 0) + delta;
        enemy.xOffset = zigzagWave(enemy.wormZigzagTime, enemy.wormZigzagPeriod || 1.56) * (enemy.wormZigzagAmplitude || 0);
      } else {
        enemy.xOffset = 0;
      }
      const laneX = laneCenterX(layout, enemy.lane);
      const minOffset = layout.gridX + enemy.radius - laneX;
      const maxOffset = layout.gridX + layout.gridWidth - enemy.radius - laneX;
      enemy.xOffset = clamp(enemy.xOffset || 0, minOffset, maxOffset);
      const verticalSpeedScale = enemy.boss ? 0.78 : 1;
      enemy.y += enemy.speed * verticalSpeedScale * slowMultiplier * delta;
      enemy.y -= push * delta;
      enemy.y = Math.max(layout.fieldTop + enemy.radius + layout.cell * 0.2, enemy.y);
    }

    if (enemy.hp <= 0) {
      if (enemy.boss && enemy.bossAbility === "split_worm" && !enemy.splitTriggered) {
        enemy.splitTriggered = true;
        splitWormBoss(world, entity, enemy);
        continue;
      }
      run.score += enemy.reward;
      createEnemyDeathBurst(world, enemy, enemyScreenX(layout, enemy), enemy.y);
      createCoinDrop(world, enemyScreenX(layout, enemy), enemy.y - enemy.radius * 0.08, enemy.reward);
      world.destroyEntity(entity);
      continue;
    }

    const enemyX = enemyScreenX(layout, enemy);
    const shieldHitY = run.shield > 0 ? shieldSurfaceY(layout, enemyX) : 0;
    const collidedShield = run.shield > 0 && enemy.shieldTouchCooldown <= 0 && enemy.y + enemy.radius >= shieldHitY;
    const collidedBase = run.shield <= 0 && enemy.y >= layout.baseLineY;
    if (collidedShield) {
      run.shield = Math.max(0, run.shield - 1);
      run.shieldHitFlash = 1;
      createDamageText(world, 86, 64, "-1", "#8fd8ff");
      enemy.hp -= 1;
      enemy.hitFlash = Math.max(enemy.hitFlash || 0, 0.14);
      enemy.status.freeze = Math.max(enemy.status.freeze, 0.16);
      enemy.pushImpulse = Math.max(enemy.pushImpulse, enemy.radius * 1.4 * (enemy.pushbackResistance || 1));
      enemy.shieldTouchCooldown = 0.16;
      enemy.y = Math.max(
        layout.fieldTop + enemy.radius + layout.cell * 0.2,
        shieldHitY - enemy.radius * (1 + (enemy.shieldKnockbackDistance || 1)),
      );
      createDamageText(world, enemyX, shieldHitY - enemy.radius * 0.4, "1", "#dff7ff");
      createFlash(world, enemyX, shieldHitY, "rgba(143, 216, 255, 0.86)", 42, {
        style: "shock",
        accent: "rgba(221, 248, 255, 0.68)",
        life: 0.3,
      });
      createFlash(world, layout.turretX, layout.shieldLineY + layout.cell * 0.08, "rgba(105, 204, 255, 0.42)", layout.cell * 2.2, {
        style: "shock",
        accent: "rgba(221, 248, 255, 0.28)",
        life: 0.26,
      });
      if (enemy.hp <= 0) {
        run.score += enemy.reward;
        createEnemyDeathBurst(world, enemy, enemyX, enemy.y);
        createCoinDrop(world, enemyX, enemy.y - enemy.radius * 0.08, enemy.reward);
        world.destroyEntity(entity);
      }
      continue;
    }

    if (collidedBase) {
      if (enemy.elite || enemy.boss) {
        run.shield = 0;
        run.baseHp = 0;
        run.baseHitFlash = 1;
        createDamageText(world, 102, 42, "CORE BREACH", "#ff8f7d");
      } else {
        run.baseHp -= enemy.damage;
        run.baseHitFlash = 1;
        createDamageText(world, 86, 34, `-${enemy.damage}`, "#ff8f7d");
      }
      createFlash(world, enemyX, layout.baseLineY, COLORS.threat, 38, {
        style: "shock",
        accent: "rgba(255, 232, 220, 0.62)",
        life: 0.26,
      });
      createFlash(world, layout.turretX, layout.baseLineY + layout.cell * 0.18, "rgba(255, 126, 110, 0.74)", layout.cell * 1.8, {
        style: "shock",
        accent: "rgba(255, 240, 228, 0.44)",
        life: 0.28,
      });
      world.destroyEntity(entity);
      if (run.baseHp <= 0) {
        world.resources.phase.name = "gameover";
      }
    }
  }

  for (const entity of world.query("summonBot")) {
    const summon = world.getComponent(entity, "summonBot");
    if (!summon) {
      continue;
    }
    summon.y -= summon.speed * delta;
    const summonX = laneCenterX(layout, summon.lane);
    let collisionTargetId = 0;
    for (const enemyId of world.query("enemy")) {
      const enemy = world.getComponent(enemyId, "enemy");
      if (!enemy) {
        continue;
      }
      if (Math.abs(enemyScreenX(layout, enemy) - summonX) >= enemy.radius + summon.radius) {
        continue;
      }
      if (Math.abs(enemy.y - summon.y) >= enemy.radius + summon.radius) {
        continue;
      }
      collisionTargetId = enemyId;
      break;
    }

    if (collisionTargetId) {
      applyHit(world, collisionTargetId, {
        damage: summon.damage,
        pierce: 0,
        split: 0,
        ricochet: 0,
        burn: summon.burn || 0,
        curse: summon.curse || 0,
        slow: 0,
        freeze: 0,
        pushback: 0,
        x: summonX,
        y: summon.y,
      }, summonX, summon.y);
      createFlash(world, summonX, summon.y, "rgba(143, 216, 255, 0.84)", summon.radius * 1.24, {
        style: "shock",
        accent: "rgba(246, 248, 251, 0.58)",
        life: 0.24,
      });
      world.destroyEntity(entity);
      continue;
    }

    if (summon.y < layout.fieldTop - summon.radius - layout.cell) {
      world.destroyEntity(entity);
    }
  }
}

export function projectileSystem(world, delta) {
  const { layout, phase } = world.resources;
  if (phase.name !== "combat" || !layout || !layout.cell) {
    return;
  }

  const enemyEntities = world.query("enemy");
  for (const entity of world.query("projectile")) {
    const projectile = world.getComponent(entity, "projectile");
    if (!projectile) {
      continue;
    }
    if (!Array.isArray(projectile.hitIds)) {
      projectile.hitIds = [];
    }

    if (typeof projectile.drift !== "number") {
      projectile.drift = 0;
    }

    if (projectile.targetId) {
      const target = world.getComponent(projectile.targetId, "enemy");
      if (!target) {
        projectile.targetId = null;
        continue;
      }
      const targetX = enemyScreenX(layout, target);
      const dx = targetX - projectile.x;
      const dy = target.y - projectile.y;
      const length = Math.hypot(dx, dy) || 1;
      projectile.x += (dx / length) * projectile.speed * delta;
      projectile.y += (dy / length) * projectile.speed * delta;

      if (length < target.radius + projectile.radius + 8) {
        applyHit(world, projectile.targetId, projectile, projectile.x, projectile.y);
        projectile.hitIds.push(projectile.targetId);
        if (projectile.pierce > 0) {
          projectile.pierce -= 1;
          projectile.targetId = null;
          projectile.y -= 10;
        } else {
          world.destroyEntity(entity);
        }
      }
      continue;
    }

    projectile.y -= projectile.speed * delta;
    projectile.x += projectile.drift * projectile.speed * delta;

    let collisionTargetId = 0;
    for (const enemyId of enemyEntities) {
      if (projectile.hitIds.indexOf(enemyId) !== -1) {
        continue;
      }
      const enemy = world.getComponent(enemyId, "enemy");
      if (!enemy) {
        continue;
      }
      if (Math.abs(enemyScreenX(layout, enemy) - projectile.x) >= enemy.radius + projectile.radius) {
        continue;
      }
      if (Math.abs(enemy.y - projectile.y) >= enemy.radius + projectile.radius) {
        continue;
      }
      collisionTargetId = enemyId;
      break;
    }

    if (collisionTargetId) {
      applyHit(world, collisionTargetId, projectile, projectile.x, projectile.y);
      projectile.hitIds.push(collisionTargetId);
      if (projectile.pierce > 0) {
        projectile.pierce -= 1;
        projectile.y -= 10;
      } else {
        world.destroyEntity(entity);
      }
      continue;
    }

    if (projectile.y < -40 || projectile.x < layout.fieldX - 40 || projectile.x > layout.fieldX + layout.fieldW + 40) {
      world.destroyEntity(entity);
    }
  }
}

export function coinSystem(world, delta) {
  const { layout, phase, run } = world.resources;
  run.moneyPickupFlash = Math.max(0, (run.moneyPickupFlash || 0) - delta * 2.6);
  run.shieldAppearPulse = Math.max(0, (run.shieldAppearPulse || 0) - delta * 2.2);
  const currentShield = run.shield || 0;
  const lastShield = run.lastShield || 0;
  if (currentShield > lastShield) {
    run.shieldAppearPulse = 1;
  }
  run.lastShield = currentShield;
  const shieldTarget = currentShield > 0 ? 1 : 0;
  if (typeof run.shieldVisual !== "number") {
    run.shieldVisual = shieldTarget;
  }
  if (shieldTarget > run.shieldVisual) {
    run.shieldVisual = Math.min(shieldTarget, run.shieldVisual + delta * 3.8);
  } else if (shieldTarget < run.shieldVisual) {
    run.shieldVisual = Math.max(shieldTarget, run.shieldVisual - delta * 2.8);
  }

  for (const entity of world.query("coin")) {
    const coin = world.getComponent(entity, "coin");
    if (!coin) {
      continue;
    }
    coin.bob += delta * 3.8;
    coin.pulse += delta * 5.4;
  }

  for (const entity of world.query("coinFly")) {
    const coinFly = world.getComponent(entity, "coinFly");
    if (!coinFly) {
      continue;
    }
    coinFly.t += delta / Math.max(coinFly.duration, 0.001);
    if (coinFly.t >= 1) {
      run.money += coinFly.value;
      run.moneyPickupFlash = 1;
      createFlash(world, coinFly.targetX, coinFly.targetY, "rgba(255, 214, 112, 0.9)", Math.max(14, layout ? layout.cell * 0.7 : 14), {
        style: "shock",
        accent: "rgba(255, 245, 214, 0.62)",
        life: 0.18,
      });
      world.destroyEntity(entity);
      continue;
    }
    const t = smoothStep(coinFly.t);
    coinFly.x = coinFly.fromX + (coinFly.targetX - coinFly.fromX) * t;
    coinFly.y = coinFly.fromY + (coinFly.targetY - coinFly.fromY) * t - Math.sin(t * Math.PI) * 24;
  }

  if (phase !== "combat") {
    return;
  }
}

export function flashSystem(world, delta) {
  for (const entity of world.query("flash")) {
    const flash = world.getComponent(entity, "flash");
    flash.life -= delta;
    if (flash.life <= 0) {
      world.destroyEntity(entity);
    }
  }

  for (const entity of world.query("damageText")) {
    const damageText = world.getComponent(entity, "damageText");
    damageText.life -= delta;
    damageText.y += damageText.driftY * delta;
    if (damageText.life <= 0) {
      world.destroyEntity(entity);
    }
  }
}

function button(world, x, y, width, height, label, extra = {}) {
  world.resources.ui.buttons.push({
    x,
    y,
    width,
    height,
    label,
    ...extra,
  });
}

function drawButton(ctx, button, active = false) {
  ctx.fillStyle = active ? "rgba(10, 13, 18, 0.34)" : "rgba(10, 13, 18, 0.24)";
  pathRoundedRect(ctx, button.x, button.y + 3, button.width, button.height, 16);
  ctx.fill();

  const fill = ctx.createLinearGradient(button.x, button.y, button.x, button.y + button.height);
  fill.addColorStop(0, active ? "rgba(42, 49, 58, 0.98)" : "rgba(31, 37, 45, 0.96)");
  fill.addColorStop(1, active ? "rgba(30, 35, 42, 0.98)" : "rgba(22, 26, 32, 0.96)");
  ctx.fillStyle = fill;
  ctx.strokeStyle = active ? COLORS.energy : COLORS.line;
  ctx.lineWidth = active ? 2 : 1.3;
  pathRoundedRect(ctx, button.x, button.y, button.width, button.height, 16);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = active ? "rgba(246,248,251,0.42)" : "rgba(246,248,251,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(button.x + 10, button.y + 9);
  ctx.lineTo(button.x + button.width - 10, button.y + 9);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.beginPath();
  ctx.moveTo(button.x + 12, button.y + button.height - 10);
  ctx.lineTo(button.x + button.width - 12, button.y + button.height - 10);
  ctx.stroke();
}

function drawPillButton(ctx, button, active = false) {
  ctx.fillStyle = active ? "rgba(28, 34, 42, 0.96)" : "rgba(20, 25, 32, 0.9)";
  pathRoundedRect(ctx, button.x, button.y, button.width, button.height, 16);
  ctx.fill();
  ctx.strokeStyle = active ? "rgba(246,248,251,0.34)" : "rgba(246,248,251,0.12)";
  ctx.lineWidth = active ? 1.6 : 1.1;
  pathRoundedRect(ctx, button.x, button.y, button.width, button.height, 16);
  ctx.stroke();
}

function drawCampChoiceCard(ctx, rect, title, subtitle, accent, icon) {
  ctx.fillStyle = "rgba(8, 12, 18, 0.28)";
  pathRoundedRect(ctx, rect.x, rect.y + 4, rect.width, rect.height, 18);
  ctx.fill();

  const fill = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
  fill.addColorStop(0, "rgba(36, 43, 52, 0.98)");
  fill.addColorStop(1, "rgba(24, 29, 36, 0.98)");
  ctx.fillStyle = fill;
  pathRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 18);
  ctx.fill();

  ctx.strokeStyle = "rgba(246,248,251,0.14)";
  ctx.lineWidth = 1.2;
  pathRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 18);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.1;
  pathRoundedRect(ctx, rect.x + 1.5, rect.y + 1.5, rect.width - 3, rect.height - 3, 16);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.04)";
  pathRoundedRect(ctx, rect.x + 14, rect.y + 12, 52, 52, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(246,248,251,0.1)";
  ctx.lineWidth = 1;
  pathRoundedRect(ctx, rect.x + 14, rect.y + 12, 52, 52, 16);
  ctx.stroke();

  ctx.save();
  ctx.translate(rect.x + 40, rect.y + rect.height * 0.5);
  if (icon === "heal") {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 8);
    ctx.stroke();
  } else {
    drawUpgradePreview(ctx, { id: "overdrive", color: accent, icon: "+", shape: "hex", level: 1 }, 0, 0, 18);
  }
  ctx.restore();

  drawText(ctx, title, rect.x + 78, rect.y + 28, 20, COLORS.text);
  drawText(ctx, subtitle, rect.x + 78, rect.y + 52, 14, accent);
}

function drawCampChoicePanel(ctx, rect, options = {}) {
  const active = options.active !== false;
  const accent = options.accent || COLORS.energy;
  const title = options.title || "";
  const subtitle = options.subtitle || "";
  const detail = options.detail || "";
  const icon = options.icon || "upgrade";

  ctx.fillStyle = active ? "rgba(8, 12, 18, 0.28)" : "rgba(8, 12, 18, 0.18)";
  pathRoundedRect(ctx, rect.x, rect.y + 4, rect.width, rect.height, 20);
  ctx.fill();

  const fill = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
  fill.addColorStop(0, active ? "rgba(36, 43, 52, 0.98)" : "rgba(28, 34, 42, 0.9)");
  fill.addColorStop(1, active ? "rgba(24, 29, 36, 0.98)" : "rgba(18, 22, 28, 0.9)");
  ctx.fillStyle = fill;
  pathRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 20);
  ctx.fill();

  ctx.strokeStyle = active ? "rgba(246,248,251,0.14)" : "rgba(246,248,251,0.08)";
  ctx.lineWidth = 1.2;
  pathRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 20);
  ctx.stroke();

  ctx.strokeStyle = active ? accent : "rgba(168,178,194,0.24)";
  ctx.lineWidth = active ? 2.1 : 1.2;
  pathRoundedRect(ctx, rect.x + 1.5, rect.y + 1.5, rect.width - 3, rect.height - 3, 18);
  ctx.stroke();

  ctx.fillStyle = active ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)";
  pathRoundedRect(ctx, rect.x + 16, rect.y + 16, 54, 54, 16);
  ctx.fill();
  ctx.strokeStyle = active ? "rgba(246,248,251,0.1)" : "rgba(246,248,251,0.05)";
  ctx.lineWidth = 1;
  pathRoundedRect(ctx, rect.x + 16, rect.y + 16, 54, 54, 16);
  ctx.stroke();

  ctx.save();
  ctx.translate(rect.x + 43, rect.y + 43);
  ctx.globalAlpha = active ? 1 : 0.45;
  if (icon === "heal") {
    ctx.strokeStyle = active ? accent : COLORS.textDim;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 8);
    ctx.stroke();
  } else {
    drawUpgradePreview(ctx, { id: "overdrive", color: active ? accent : COLORS.textDim, icon: "+", shape: "hex", level: 1 }, 0, 0, 18);
  }
  ctx.restore();

  const titleX = rect.x + 84;
  drawText(ctx, title, titleX, rect.y + 28, 19, active ? COLORS.text : COLORS.textDim);
  drawText(ctx, subtitle, titleX, rect.y + 50, 14, active ? accent : COLORS.textDim);
  if (detail) {
    drawWrappedTextBlock(ctx, detail, titleX, rect.y + 71, 12, active ? COLORS.textDim : "rgba(168,178,194,0.66)", rect.width - 102, 14, 2);
  }
}

function drawOfferModuleCard(ctx, rect, upgrade, options = {}) {
  const selected = options.selected === true;
  const price = typeof options.price === "number" ? options.price : null;
  const sold = options.sold === true;
  const showDescription = options.showDescription !== false;
  const accent = sold ? "rgba(168,178,194,0.34)" : selected ? "rgba(246,248,251,0.34)" : "rgba(246,248,251,0.14)";
  const surfaceTop = selected ? "rgba(30, 36, 44, 0.96)" : "rgba(24, 29, 36, 0.94)";
  const surfaceBottom = selected ? "rgba(21, 26, 33, 0.98)" : "rgba(18, 22, 28, 0.96)";
  const titleColor = sold ? COLORS.textDim : COLORS.text;
  const shortColor = sold ? "rgba(168,178,194,0.74)" : COLORS.textDim;
  const iconAlpha = sold ? 0.48 : 1;
  const textX = rect.x + 76;
  const textWidth = rect.width - 92;

  ctx.fillStyle = "rgba(8, 12, 18, 0.26)";
  pathRoundedRect(ctx, rect.x, rect.y + 3, rect.width, rect.height, 18);
  ctx.fill();

  const fill = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
  fill.addColorStop(0, surfaceTop);
  fill.addColorStop(1, surfaceBottom);
  ctx.fillStyle = fill;
  pathRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 18);
  ctx.fill();

  ctx.strokeStyle = accent;
  ctx.lineWidth = selected ? 1.6 : 1.15;
  pathRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 18);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.04)";
  pathRoundedRect(ctx, rect.x + 14, rect.y + rect.height * 0.5 - 24, 48, 48, 14);
  ctx.fill();
  ctx.strokeStyle = selected ? "rgba(246,248,251,0.14)" : "rgba(246,248,251,0.08)";
  ctx.lineWidth = 1;
  pathRoundedRect(ctx, rect.x + 14, rect.y + rect.height * 0.5 - 24, 48, 48, 14);
  ctx.stroke();

  ctx.save();
  ctx.translate(rect.x + 38, rect.y + rect.height * 0.5);
  ctx.globalAlpha = iconAlpha;
  drawUpgradePreview(ctx, upgrade, 0, 0, 20);
  ctx.restore();

  const titleY = rect.y + 18;
  const titleCount = drawWrappedTextBlock(ctx, upgrade.name, textX, titleY, 13, titleColor, textWidth, 15, 2);
  const shortY = titleY + titleCount * 15 + 4;
  const shortCount = drawWrappedTextBlock(
    ctx,
    upgrade.short || upgrade.description,
    textX,
    shortY,
    10,
    shortColor,
    textWidth,
    12,
    showDescription ? 2 : 3,
  );

  if (showDescription) {
    const descY = shortY + shortCount * 12 + 6;
    drawWrappedTextBlock(ctx, upgrade.description, textX, descY, 10, shortColor, textWidth, 12, 2);
  }

  if (price !== null) {
    drawText(
      ctx,
      sold ? "Sold" : `$${price}`,
      textX,
      rect.y + rect.height - 14,
      15,
      sold ? COLORS.textDim : COLORS.warning,
    );
  }
}

function drawSwordIcon(ctx, x, y, scale, color, rotation = -0.78) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.6, scale * 0.12);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, scale * 0.3);
  ctx.lineTo(0, -scale * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-scale * 0.2, scale * 0.08);
  ctx.lineTo(scale * 0.2, scale * 0.08);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -scale * 0.64);
  ctx.lineTo(-scale * 0.12, -scale * 0.4);
  ctx.lineTo(scale * 0.12, -scale * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCrossedSwordsIcon(ctx, x, y, scale, color) {
  drawSwordIcon(ctx, x - scale * 0.18, y + scale * 0.04, scale * 0.96, color, Math.PI * 0.25);
  drawSwordIcon(ctx, x + scale * 0.18, y + scale * 0.04, scale * 0.96, color, -Math.PI * 0.25);
}

function drawDemonHeadIcon(ctx, x, y, scale, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, scale * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-scale * 0.3, -scale * 0.1);
  ctx.lineTo(-scale * 0.48, -scale * 0.44);
  ctx.lineTo(-scale * 0.12, -scale * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(scale * 0.3, -scale * 0.1);
  ctx.lineTo(scale * 0.48, -scale * 0.44);
  ctx.lineTo(scale * 0.12, -scale * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#0b1117";
  ctx.beginPath();
  ctx.arc(-scale * 0.12, -scale * 0.04, scale * 0.05, 0, Math.PI * 2);
  ctx.arc(scale * 0.12, -scale * 0.04, scale * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0b1117";
  ctx.lineWidth = Math.max(1.2, scale * 0.06);
  ctx.beginPath();
  ctx.arc(0, scale * 0.06, scale * 0.12, 0.18, Math.PI - 0.18);
  ctx.stroke();
  ctx.restore();
}

function drawCampfireIcon(ctx, x, y, scale) {
  ctx.strokeStyle = "rgba(246,248,251,0.7)";
  ctx.lineWidth = Math.max(1.4, scale * 0.08);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - scale * 0.32, y + scale * 0.28);
  ctx.lineTo(x + scale * 0.22, y - scale * 0.16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + scale * 0.32, y + scale * 0.28);
  ctx.lineTo(x - scale * 0.22, y - scale * 0.16);
  ctx.stroke();
  ctx.fillStyle = "#ffb36c";
  ctx.beginPath();
  ctx.moveTo(x, y - scale * 0.44);
  ctx.quadraticCurveTo(x - scale * 0.26, y - scale * 0.1, x, y + scale * 0.18);
  ctx.quadraticCurveTo(x + scale * 0.28, y - scale * 0.08, x, y - scale * 0.44);
  ctx.fill();
  ctx.fillStyle = "#fff1c0";
  ctx.beginPath();
  ctx.moveTo(x, y - scale * 0.24);
  ctx.quadraticCurveTo(x - scale * 0.14, y - scale * 0.04, x, y + scale * 0.1);
  ctx.quadraticCurveTo(x + scale * 0.14, y - scale * 0.04, x, y - scale * 0.24);
  ctx.fill();
}

function drawRoomRouteIcon(ctx, roomType, x, y, scale) {
  if (roomType === "shop") {
    drawText(ctx, "$", x, y + scale * 0.18, Math.max(18, scale * 0.9), COLORS.warning, "center");
    return;
  }
  if (roomType === "camp") {
    drawCampfireIcon(ctx, x, y, scale * 0.9);
    return;
  }
  if (roomType === "boss") {
    drawDemonHeadIcon(ctx, x, y, scale * 0.94, "#d88972");
    return;
  }
  if (roomType === "elite") {
    drawCrossedSwordsIcon(ctx, x - scale * 0.06, y + scale * 0.02, scale * 0.96, "#f0e6c9");
    drawDemonHeadIcon(ctx, x + scale * 0.4, y - scale * 0.02, scale * 0.66, "#d88972");
    return;
  }
  drawCrossedSwordsIcon(ctx, x, y, scale * 1.04, "#f0e6c9");
}

function drawBaseMapIcon(ctx, x, y, size) {
  ctx.fillStyle = "rgba(10, 14, 20, 0.34)";
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.38, size * 0.88, size * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1b2430";
  pathRoundedRect(ctx, x - size * 0.58, y - size * 0.58, size * 1.16, size * 1.16, size * 0.18);
  ctx.fill();
  ctx.strokeStyle = "rgba(246,248,251,0.16)";
  ctx.lineWidth = 1.2;
  pathRoundedRect(ctx, x - size * 0.58, y - size * 0.58, size * 1.16, size * 1.16, size * 0.18);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  pathRoundedRect(ctx, x - size * 0.46, y - size * 0.48, size * 0.92, size * 0.26, size * 0.1);
  ctx.fill();
  ctx.fillStyle = "#243a54";
  pathRoundedRect(ctx, x - size * 0.22, y - size * 0.22, size * 0.44, size * 0.44, size * 0.1);
  ctx.fill();
  ctx.strokeStyle = "rgba(141, 217, 255, 0.56)";
  ctx.lineWidth = 1.4;
  pathRoundedRect(ctx, x - size * 0.22, y - size * 0.22, size * 0.44, size * 0.44, size * 0.1);
  ctx.stroke();
  ctx.fillStyle = "#eef1f6";
  pathRoundedRect(ctx, x - size * 0.08, y - size * 0.08, size * 0.16, size * 0.16, size * 0.04);
  ctx.fill();
}

function branchThemeMapColor(theme) {
  if (theme === "worm") {
    return "rgba(208, 164, 116, 0.9)";
  }
  if (theme === "beetle") {
    return "rgba(176, 212, 148, 0.9)";
  }
  return "rgba(152, 214, 255, 0.9)";
}

function mapProjection(layout, run) {
  const focusNode = mapNodeById(run, run.currentMapNodeId) || mapNodeById(run, 0);
  const scale = Math.min(layout.width, layout.height) * 0.16;
  const cameraX = run.mapCamera ? run.mapCamera.x : 0;
  const cameraY = run.mapCamera ? run.mapCamera.y : 0;
  const centerX = layout.width * 0.5 + cameraX;
  const centerY = layout.height * 0.54 + cameraY;
  return {
    focusNode,
    scale,
    toScreenX(node) {
      return centerX + (node.x - focusNode.x) * scale;
    },
    toScreenY(node) {
      return centerY + (node.y - focusNode.y) * scale;
    },
  };
}

function mapNodeBounce(layout, nodeId, timeSeconds) {
  return Math.sin(timeSeconds * 4.2 + nodeId * 0.9) * layout.cell * 0.055;
}

function mapHitNode(world, pointerX, pointerY) {
  const { layout, run } = world.resources;
  if (!layout || !run || !run.mapNodes) {
    return null;
  }
  const projection = mapProjection(layout, run);
  const t = performance.now() * 0.001;
  let best = null;
  let bestDistance = Infinity;
  for (const node of run.mapNodes) {
    if (node.parentId !== run.currentMapNodeId || node.cleared) {
      continue;
    }
    const x = projection.toScreenX(node);
    const bounce = mapNodeBounce(layout, node.id, t);
    const y = projection.toScreenY(node) + bounce;
    const radius = layout.cell * 1.95;
    const distance = Math.hypot(pointerX - x, pointerY - y);
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

function drawMapScene(world, ctx) {
  const { layout, run } = world.resources;
  const projection = mapProjection(layout, run);
  const toScreenX = (node) => projection.toScreenX(node);
  const toScreenY = (node) => projection.toScreenY(node);
  const t = performance.now() * 0.001;

  for (const path of run.completedBranchPaths || []) {
    if (!path || path.length < 2) {
      continue;
    }
    const theme = path[path.length - 1].branchTheme || "spider";
    const lineColor = branchThemeMapColor(theme);
    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1];
      const to = path[index];
      const x1 = toScreenX(from);
      const y1 = toScreenY(from);
      const x2 = toScreenX(to);
      const y2 = toScreenY(to);
      ctx.strokeStyle = lineColor.replace("0.9", "0.26");
      ctx.lineWidth = 3.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = lineColor.replace("0.9", "0.52");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (let index = 1; index < path.length; index += 1) {
      const node = path[index];
      const x = toScreenX(node);
      const y = toScreenY(node);
      const nodeSize = layout.cell * 0.84;
      ctx.fillStyle = "rgba(20, 26, 32, 0.74)";
      pathRoundedRect(ctx, x - nodeSize * 0.66, y - nodeSize * 0.66, nodeSize * 1.32, nodeSize * 1.32, nodeSize * 0.22);
      ctx.fill();
      ctx.strokeStyle = lineColor.replace("0.9", index === path.length - 1 ? "0.78" : "0.46");
      ctx.lineWidth = index === path.length - 1 ? 1.9 : 1.4;
      pathRoundedRect(ctx, x - nodeSize * 0.66, y - nodeSize * 0.66, nodeSize * 1.32, nodeSize * 1.32, nodeSize * 0.22);
      ctx.stroke();
      drawRoomRouteIcon(ctx, node.roomType, x, y, nodeSize * 0.72);
    }
  }

  const visibleNodes = (run.mapNodes || []).filter((node) => {
    const x = toScreenX(node);
    const y = toScreenY(node);
    return x > -100 && x < layout.width + 100 && y > -100 && y < layout.height + 100;
  });

  for (const node of visibleNodes) {
    if (node.parentId === null) {
      continue;
    }
    const parent = mapNodeById(run, node.parentId);
    if (!parent) {
      continue;
    }
    const x1 = toScreenX(parent);
    const y1 = toScreenY(parent);
    const x2 = toScreenX(node);
    const y2 = toScreenY(node);
    const active = parent.id === run.currentMapNodeId || node.id === run.currentMapNodeId || node.parentId === run.currentMapNodeId;
    ctx.strokeStyle = active ? "rgba(207,215,230,0.42)" : "rgba(207,215,230,0.18)";
    ctx.lineWidth = active ? 3 : 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  for (const node of visibleNodes) {
    const x = toScreenX(node);
    const y = toScreenY(node);
    const isCurrent = node.id === run.currentMapNodeId;
    const isChildChoice = node.parentId === run.currentMapNodeId && !node.cleared;
    const bounce = isChildChoice ? mapNodeBounce(layout, node.id, t) : 0;
    const renderY = y + bounce;
    const nodeSize = isCurrent ? layout.cell * 1.08 : layout.cell * 0.94;
    if (node.roomType === "base") {
      drawBaseMapIcon(ctx, x, y, nodeSize * 1.18);
    } else {
      if (isChildChoice) {
        ctx.fillStyle = "rgba(246,248,251,0.14)";
        ctx.beginPath();
        ctx.arc(x, renderY, nodeSize * 1.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(246,248,251,0.06)";
        ctx.beginPath();
        ctx.arc(x, renderY, nodeSize * 1.42, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = isChildChoice ? "rgba(31, 37, 45, 0.98)" : node.cleared ? "rgba(24, 30, 38, 0.9)" : "rgba(21, 26, 32, 0.88)";
      pathRoundedRect(ctx, x - nodeSize * 0.72, renderY - nodeSize * 0.72, nodeSize * 1.44, nodeSize * 1.44, nodeSize * 0.22);
      ctx.fill();
      ctx.strokeStyle = isCurrent ? "rgba(246,248,251,0.42)" : isChildChoice ? "rgba(246,248,251,0.3)" : "rgba(246,248,251,0.08)";
      ctx.lineWidth = isCurrent ? 2.4 : isChildChoice ? 1.8 : 1.2;
      pathRoundedRect(ctx, x - nodeSize * 0.72, renderY - nodeSize * 0.72, nodeSize * 1.44, nodeSize * 1.44, nodeSize * 0.22);
      ctx.stroke();
      if (isChildChoice) {
        ctx.strokeStyle = "rgba(207,215,230,0.54)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, renderY, nodeSize * 1.14, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawRoomRouteIcon(ctx, node.roomType, x, renderY, nodeSize * 0.78);
      if (node.cleared) {
        ctx.strokeStyle = "rgba(149, 193, 156, 0.72)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, renderY, nodeSize * 0.94, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (isChildChoice) {
      button(world, x - nodeSize * 1.4, renderY - nodeSize * 1.4, nodeSize * 2.8, nodeSize * 2.8, formatRoomName(node.roomType), { nodeId: node.id });
      drawText(ctx, formatRoomName(node.roomType), x, renderY + nodeSize * 1.72, 13, COLORS.textDim, "center");
    } else if (isCurrent && node.roomType !== "base") {
      drawText(ctx, formatRoomName(node.roomType), x, renderY + nodeSize * 1.56, 13, COLORS.textDim, "center");
    } else if (node.roomType === "base") {
      drawText(ctx, "Base", x, renderY + nodeSize * 1.48, 13, COLORS.textDim, "center");
    }
  }

  const resetRect = {
    x: layout.width - 158,
    y: layout.safeTop + 16,
    width: 136,
    height: 42,
  };
  drawButton(ctx, resetRect, false);
  drawText(ctx, "Reset Save", resetRect.x + resetRect.width * 0.5, resetRect.y + 27, 16, COLORS.text, "center");
  button(world, resetRect.x, resetRect.y, resetRect.width, resetRect.height, "Reset Save", { action: "reset_progress" });
}

function drawText(ctx, text, x, y, size, color, align = "left") {
  const drawX = Math.round(x);
  const drawY = Math.round(y);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(8, 12, 18, 0.92)";
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.font = `600 ${size}px "Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif`;
  ctx.textAlign = align;
  ctx.strokeText(text, drawX, drawY);
  ctx.fillText(text, drawX, drawY);
}

function damageTextFontSize(layout, value) {
  const base = Math.max(12, layout.cell * 0.72);
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric)) {
    return base;
  }
  const magnitude = Math.abs(numeric);
  const boost = Math.min(layout.cell * 0.9, Math.log10(Math.max(1, magnitude) + 1) * layout.cell * 0.42);
  return base + boost;
}

function trimTextToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed.trimEnd()}...`;
}

function wrapTextLines(ctx, text, maxWidth, maxLines = Infinity) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines = [];
  let current = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${current} ${words[index]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = words[index];

    if (lines.length === maxLines - 1) {
      const remainder = [current, ...words.slice(index + 1)].join(" ");
      lines.push(trimTextToWidth(ctx, remainder, maxWidth));
      return lines;
    }
  }

  lines.push(current);
  if (lines.length > maxLines) {
    const visible = lines.slice(0, maxLines);
    visible[maxLines - 1] = trimTextToWidth(ctx, visible[maxLines - 1], maxWidth);
    return visible;
  }
  return lines;
}

function drawWrappedText(ctx, text, x, y, size, color, maxWidth, lineHeight, maxLines) {
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(8, 12, 18, 0.88)";
  ctx.lineWidth = Math.max(1.6, size * 0.11);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.font = `600 ${size}px "Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif`;
  ctx.textAlign = "left";
  const lines = wrapTextLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => {
    const drawY = Math.round(y + index * lineHeight);
    ctx.strokeText(line, Math.round(x), drawY);
    ctx.fillText(line, Math.round(x), drawY);
  });
}

function measureWrappedText(ctx, text, size, maxWidth, maxLines) {
  ctx.font = `600 ${size}px "Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif`;
  return wrapTextLines(ctx, text, maxWidth, maxLines);
}

function drawWrappedTextBlock(ctx, text, x, y, size, color, maxWidth, lineHeight, maxLines) {
  const lines = measureWrappedText(ctx, text, size, maxWidth, maxLines);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(8, 12, 18, 0.88)";
  ctx.lineWidth = Math.max(1.6, size * 0.11);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.font = `600 ${size}px "Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif`;
  ctx.textAlign = "left";
  lines.forEach((line, index) => {
    const drawY = Math.round(y + index * lineHeight);
    ctx.strokeText(line, Math.round(x), drawY);
    ctx.fillText(line, Math.round(x), drawY);
  });
  return lines.length;
}

function smoothStep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function quadraticControlPoint(x1, y1, x2, y2, bend) {
  const mx = (x1 + x2) * 0.5;
  const my = (y1 + y2) * 0.5;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: mx - (dy / length) * bend,
    y: my + (dx / length) * bend,
  };
}

function drawLinkCurve(ctx, x1, y1, x2, y2, width, color, bend = 0) {
  const control = quadraticControlPoint(x1, y1, x2, y2, bend);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(control.x, control.y, x2, y2);
  ctx.stroke();
}

function drawEnergySegment(ctx, x1, y1, x2, y2, progress, width, alpha, bend = 0) {
  const t = smoothStep(progress);
  const control = quadraticControlPoint(x1, y1, x2, y2, bend);
  ctx.strokeStyle = `rgba(230,255,251,${alpha})`;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  if (t <= 0.001) {
    ctx.lineTo(x1, y1);
  } else {
    const steps = Math.max(6, Math.ceil(18 * t));
    for (let index = 1; index <= steps; index += 1) {
      const s = t * (index / steps);
      const inv = 1 - s;
      const px = inv * inv * x1 + 2 * inv * s * control.x + s * s * x2;
      const py = inv * inv * y1 + 2 * inv * s * control.y + s * s * y2;
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
}

function softPulse(progress) {
  const t = clamp(progress, 0, 1);
  return smoothStep(t) * (0.78 + (1 - Math.abs(t - 0.5) * 2) * 0.22);
}

function segmentTravelProgress(progress, x1, y1, x2, y2, referenceLength) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const reference = Math.max(referenceLength, 1);
  const speedBoost = clamp(length / reference, 0.92, 2.8);
  return clamp(progress * speedBoost, 0, 1);
}

function neuronButton(world, x, y, target, size) {
  button(world, x - size * 0.7, y - size * 0.7, size * 1.4, size * 1.4, "Neuron", { target });
}

function nodeStats(node) {
  return node.power + Object.values(node.effects).reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0) + Object.values(node.links).reduce((sum, value) => sum + value, 0);
}

function drawUpgradeGlyph(ctx, upgradeId, x, y, size, color) {
  const stroke = color || "#f7fffd";
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = Math.max(1.4, size * 0.11);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (upgradeId === "fire" || upgradeId === "thermal_feedback") {
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.48);
    ctx.quadraticCurveTo(-size * 0.26, -size * 0.1, 0, size * 0.28);
    ctx.quadraticCurveTo(size * 0.28, -size * 0.08, 0, -size * 0.48);
    ctx.fill();
  } else if (upgradeId === "curse" || upgradeId === "void_resonance") {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-size * 0.08, 0, size * 0.26, -1.05, 1.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size * 0.16, 0, size * 0.2, -1.18, 1.18, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size * 0.02, -size * 0.02, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  } else if (upgradeId === "slow") {
    ctx.beginPath();
    ctx.moveTo(-size * 0.42, -size * 0.12);
    ctx.lineTo(size * 0.06, -size * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 0.24, size * 0.12);
    ctx.lineTo(size * 0.28, size * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size * 0.18, -size * 0.12, size * 0.14, -1.6, 1.6);
    ctx.stroke();
  } else if (upgradeId === "freeze") {
    for (let spoke = 0; spoke < 6; spoke += 1) {
      const angle = (Math.PI * 2 * spoke) / 6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * size * 0.1, Math.sin(angle) * size * 0.1);
      ctx.lineTo(Math.cos(angle) * size * 0.44, Math.sin(angle) * size * 0.44);
      ctx.stroke();
    }
  } else if (upgradeId === "pushback") {
    ctx.beginPath();
    ctx.moveTo(size * 0.36, 0);
    ctx.lineTo(-size * 0.28, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 0.12, -size * 0.18);
    ctx.lineTo(-size * 0.34, 0);
    ctx.lineTo(-size * 0.12, size * 0.18);
    ctx.stroke();
  } else if (upgradeId === "penetration") {
    ctx.beginPath();
    ctx.moveTo(-size * 0.4, size * 0.22);
    ctx.lineTo(size * 0.34, -size * 0.22);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size * 0.16, -size * 0.34);
    ctx.lineTo(size * 0.42, -size * 0.22);
    ctx.lineTo(size * 0.24, 0.02);
    ctx.closePath();
    ctx.fill();
  } else if (upgradeId === "ricochet") {
    ctx.beginPath();
    ctx.arc(-size * 0.08, 0, size * 0.28, 0.3, 5.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size * 0.16, -size * 0.22);
    ctx.lineTo(size * 0.38, -size * 0.28);
    ctx.lineTo(size * 0.3, -size * 0.06);
    ctx.closePath();
    ctx.fill();
  } else if (upgradeId === "shield") {
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.46);
    ctx.lineTo(size * 0.34, -size * 0.18);
    ctx.lineTo(size * 0.22, size * 0.26);
    ctx.lineTo(0, size * 0.46);
    ctx.lineTo(-size * 0.22, size * 0.26);
    ctx.lineTo(-size * 0.34, -size * 0.18);
    ctx.closePath();
    ctx.stroke();
  } else if (upgradeId === "overdrive" || upgradeId === "rapid_chamber") {
    ctx.beginPath();
    ctx.moveTo(size * 0.08, -size * 0.46);
    ctx.lineTo(-size * 0.12, -size * 0.06);
    ctx.lineTo(size * 0.06, -size * 0.06);
    ctx.lineTo(-size * 0.06, size * 0.44);
    ctx.lineTo(size * 0.18, 0.04);
    ctx.lineTo(0, 0.04);
    ctx.closePath();
    ctx.fill();
  } else if (upgradeId === "resonant_mesh") {
    ctx.beginPath();
    ctx.arc(-size * 0.26, 0, size * 0.16, 0, Math.PI * 2);
    ctx.arc(size * 0.26, 0, size * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 0.1, -size * 0.12);
    ctx.lineTo(size * 0.1, -size * 0.12);
    ctx.moveTo(-size * 0.1, 0.12 * size);
    ctx.lineTo(size * 0.1, 0.12 * size);
    ctx.stroke();
  } else if (upgradeId === "summon") {
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.42);
    ctx.lineTo(-size * 0.24, -size * 0.02);
    ctx.lineTo(size * 0.24, -size * 0.02);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, size * 0.4);
    ctx.lineTo(0, size * 0.02);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, size * 0.14, size * 0.16, 0, Math.PI * 2);
    ctx.stroke();
  } else if (upgradeId === "leftLink") {
    ctx.beginPath();
    ctx.moveTo(size * 0.28, -size * 0.3);
    ctx.lineTo(-size * 0.18, 0);
    ctx.lineTo(size * 0.28, size * 0.3);
    ctx.stroke();
  } else if (upgradeId === "rightLink") {
    ctx.beginPath();
    ctx.moveTo(-size * 0.28, -size * 0.3);
    ctx.lineTo(size * 0.18, 0);
    ctx.lineTo(-size * 0.28, size * 0.3);
    ctx.stroke();
  } else if (upgradeId === "divider") {
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.38);
    ctx.lineTo(0, size * 0.08);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size * 0.34, size * 0.34);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size * 0.34, size * 0.34);
    ctx.stroke();
  } else if (upgradeId === "merger") {
    ctx.beginPath();
    ctx.moveTo(-size * 0.34, -size * 0.2);
    ctx.lineTo(0, size * 0.12);
    ctx.lineTo(size * 0.34, -size * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, size * 0.1);
    ctx.lineTo(0, size * 0.42);
    ctx.stroke();
  } else if (upgradeId === "opening_barrage") {
    drawSwordIcon(ctx, -size * 0.12, 0, size * 0.7, stroke);
    drawSwordIcon(ctx, size * 0.12, 0, size * 0.7, stroke);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawNeuronNode(ctx, x, y, radius, node, activeAlpha, selected = false) {
  const stats = nodeStats(node);
  const visual = upgradeVisual(node);
  const visualLevel = visual && visual.level ? visual.level : 1;
  const effectStrength = Object.values(node.effects).reduce((sum, value) => sum + Math.max(0, value || 0), 0);
  const linkStrength = Object.values(node.links).reduce((sum, value) => sum + Math.max(0, value || 0), 0);
  const nodeIntensity = clamp(effectStrength * 0.16 + linkStrength * 0.08 + node.power * 0.14 + (visualLevel - 1) * 0.2, 0, 1.4);
  const signalGlow = clamp(activeAlpha || 0, 0, 1);
  const baseFill = "#16303f";
  const baseStroke = visual ? visual.color : stats > 0 ? COLORS.energyBright : COLORS.line;
  const coreRadius = radius * 1.1;

  if (signalGlow > 0.02) {
    ctx.fillStyle = `rgba(89,245,214,${0.05 + signalGlow * 0.14})`;
    pathRoundedRect(ctx, x - coreRadius * 1.14, y - coreRadius * 1.14, coreRadius * 2.28, coreRadius * 2.28, coreRadius * 0.28);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(5, 8, 12, 0.22)";
  pathRoundedRect(ctx, x - coreRadius, y - coreRadius + radius * 0.16, coreRadius * 2, coreRadius * 2, coreRadius * 0.24);
  ctx.fill();

  ctx.fillStyle = `rgba(255,255,255,${0.04 + nodeIntensity * 0.03})`;
  pathRoundedRect(ctx, x - coreRadius, y - coreRadius, coreRadius * 2, coreRadius * 0.42, coreRadius * 0.2);
  ctx.fill();

  ctx.fillStyle = baseFill;
  pathRoundedRect(ctx, x - coreRadius, y - coreRadius, coreRadius * 2, coreRadius * 2, coreRadius * 0.24);
  ctx.fill();

  if (visual) {
    ctx.fillStyle = visual.color + (visualLevel >= 3 ? "5c" : visualLevel === 2 ? "46" : "30");
    pathUpgradeShape(ctx, visual.shape, x, y, radius * 1.02);
    ctx.fill();
    if (signalGlow > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${0.04 + signalGlow * 0.16 + (visualLevel - 1) * 0.04})`;
      pathUpgradeShape(ctx, visual.shape, x, y, radius * (0.76 + nodeIntensity * 0.06));
      ctx.fill();
    }
    ctx.strokeStyle = visual.color;
    ctx.lineWidth = (selected ? 3.6 : 3) + nodeIntensity * 0.5 + (visualLevel - 1) * 0.35 + signalGlow * 0.4;
    pathUpgradeShape(ctx, visual.shape, x, y, radius * 1.02);
    ctx.stroke();
    drawUpgradeGlyph(ctx, visual.id || visual.icon, x, y, radius * 0.92, "#f7fffd");
    for (let pip = 1; pip < visualLevel; pip += 1) {
      const pipX = x + radius * 0.64;
      const pipY = y - radius * 0.62 + (pip - 1) * radius * 0.34;
      ctx.fillStyle = "#f7fffd";
      ctx.beginPath();
      ctx.arc(pipX, pipY, Math.max(2, radius * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = baseStroke;
    ctx.lineWidth = (selected ? 3.2 : stats > 0 ? 2.6 : 2) + nodeIntensity * 0.4 + signalGlow * 0.4;
    pathRoundedRect(ctx, x - coreRadius, y - coreRadius, coreRadius * 2, coreRadius * 2, coreRadius * 0.24);
    ctx.stroke();
  }
}

function previewNodeFromUpgrade(upgrade) {
  const node = {
    power: 0,
    appearance: {
      id: upgrade.id,
      color: upgrade.color,
      icon: upgrade.icon,
      shape: upgrade.shape,
      level: 1,
    },
    effects: {
      fire: 0,
      curse: 0,
      slow: 0,
      freeze: 0,
      pushback: 0,
      penetration: 0,
      split: 0,
      ricochet: 0,
      shield: 0,
      overdrive: 0,
      summon: 0,
    },
    links: {
      left: 0,
      right: 0,
      divider: 0,
      merger: 0,
      relay: 0,
    },
  };
  if (upgrade.id in node.effects) {
    node.effects[upgrade.id] = 1;
  }
  if (upgrade.id === "leftLink") {
    node.links.left = 1;
  }
  if (upgrade.id === "rightLink") {
    node.links.right = 1;
  }
  if (upgrade.id === "divider") {
    node.links.divider = 1;
  }
  if (upgrade.id === "merger") {
    node.links.merger = 1;
  }
  if (upgrade.id === "relay") {
    node.links.relay = 1;
  }
  return node;
}

function drawUpgradePreview(ctx, upgrade, x, y, scale) {
  const previewNode = previewNodeFromUpgrade(upgrade);
  const radius = scale * 0.52;
  const linkColor = upgrade.color;
  ctx.strokeStyle = linkColor;
  ctx.lineWidth = Math.max(2, scale * 0.12);

  if (previewNode.links.left > 0) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - scale * 0.9, y - scale * 0.55);
    ctx.stroke();
  }
  if (previewNode.links.right > 0) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + scale * 0.9, y - scale * 0.55);
    ctx.stroke();
  }
  if (previewNode.links.divider > 0) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - scale * 0.9, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + scale * 0.9, y);
    ctx.stroke();
  }
  if (previewNode.links.merger > 0) {
    ctx.beginPath();
    ctx.moveTo(x - scale * 0.9, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + scale * 0.9, y);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  if (previewNode.links.relay > 0) {
    ctx.beginPath();
    ctx.moveTo(x, y + scale * 0.88);
    ctx.lineTo(x, y - scale * 0.88);
    ctx.stroke();
  }

  drawNeuronNode(ctx, x, y, radius, previewNode, 0.18, true);
}

function drawLegendaryBadge(ctx, rect, perk, highlighted = false) {
  ctx.fillStyle = "rgba(7, 10, 14, 0.24)";
  pathRoundedRect(ctx, rect.x, rect.y + 2, rect.width, rect.height, 10);
  ctx.fill();
  ctx.fillStyle = highlighted ? "rgba(29, 35, 43, 0.96)" : "rgba(20, 24, 31, 0.9)";
  pathRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 10);
  ctx.fill();
  ctx.strokeStyle = highlighted ? "rgba(246,248,251,0.34)" : "rgba(246,248,251,0.12)";
  ctx.lineWidth = highlighted ? 1.5 : 1;
  pathRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 10);
  ctx.stroke();
  ctx.save();
  ctx.translate(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
  drawUpgradePreview(ctx, perk, 0, 0, rect.width * 0.6);
  ctx.restore();
}

const NODE_EFFECT_LABELS = {
  fire: "Fire",
  curse: "Void",
  slow: "Slow",
  freeze: "Freeze",
  pushback: "Push",
  penetration: "Pierce",
  ricochet: "Ricochet",
  shield: "Shield",
  overdrive: "Overdrive",
  summon: "Summon",
};

const NODE_LINK_LABELS = {
  left: "Left Link",
  right: "Right Link",
  divider: "Divider",
  merger: "Merger",
  relay: "Relay",
};

function nodeInspectLines(node) {
  const lines = [];
  if (node.appearance && node.appearance.level > 1) {
    lines.push(`Level ${node.appearance.level}`);
  }
  if (node.power > 0) {
    lines.push(`White +${node.power.toFixed(1).replace(/\.0$/, "")}`);
  }
  for (const [key, label] of Object.entries(NODE_EFFECT_LABELS)) {
    if ((node.effects[key] || 0) > 0) {
      const value = node.effects[key];
      lines.push(`${label} +${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}`);
    }
  }
  for (const [key, label] of Object.entries(NODE_LINK_LABELS)) {
    if ((node.links[key] || 0) > 0) {
      lines.push(`${label} x${node.links[key]}`);
    }
  }
  if (lines.length === 0) {
    lines.push("No upgrades installed");
  }
  return lines;
}

function legendaryInspectLines(perk) {
  const lines = Array.isArray(perk && perk.stats) && perk.stats.length ? perk.stats.slice() : [];
  if (lines.length === 0 && perk && perk.short) {
    lines.push(perk.short);
  }
  return lines;
}

function drawNeuronInspectCard(world, ctx) {
  const inspect = world.resources.ui.neuronInspect;
  const { layout, network } = world.resources;
  if (!inspect || !layout) {
    return;
  }
  const safeCell = Number.isFinite(layout.cell) ? layout.cell : NaN;
  if (!Number.isFinite(safeCell) || safeCell <= 0) {
    return;
  }
  const safeLayer = Number.isFinite(inspect.layer) ? clamp(Math.floor(inspect.layer), 0, NETWORK_LAYERS - 1) : null;
  const safeLane = Number.isFinite(inspect.lane) ? clamp(Math.floor(inspect.lane), 0, LANE_COUNT - 1) : null;
  const baseX =
    Number.isFinite(inspect.x)
      ? inspect.x
      : safeLane !== null
        ? laneCenterX(layout, safeLane)
        : NaN;
  const baseY =
    Number.isFinite(inspect.y)
      ? inspect.y
      : safeLayer !== null
        ? networkLayerY(layout, safeLayer)
        : NaN;
  if (!Number.isFinite(baseX) || !Number.isFinite(baseY)) {
    return;
  }
  const node =
    inspect.node
    || (safeLayer !== null && safeLane !== null && network && network.nodes && network.nodes[safeLayer]
      ? network.nodes[safeLayer][safeLane]
      : null);
  if (!node) {
    return;
  }
  const upgrade = node.appearance ? UPGRADE_LIBRARY.find((item) => item.id === node.appearance.id) || null : null;
  const lines = nodeInspectLines(node);
  const visibleLines = lines.slice(0, 5);
  const width = Math.min(310, layout.width * 0.78);
  const textX = 78;
  const textWidth = width - textX - 14;
  const title = upgrade ? upgrade.name : "Empty Node";
  const shortText = upgrade ? upgrade.short : "No upgrade installed";
  const descText = upgrade ? upgrade.description : "This neuron is empty. Drag an upgrade here during reward or shop phases.";
  const titleLines = measureWrappedText(ctx, title, 15, textWidth, 2);
  const shortLines = measureWrappedText(ctx, shortText, 11, textWidth, 2);
  const descLines = measureWrappedText(ctx, descText, 10, textWidth, 4);
  const height = Math.max(170, 56 + titleLines.length * 16 + 6 + shortLines.length * 13 + 8 + descLines.length * 12 + 14 + 20 + visibleLines.length * 16 + 24);
  const preferredX = baseX + safeCell * 0.96;
  const fallbackX = baseX - width - safeCell * 0.96;
  const x = clamp(preferredX + width <= layout.width - 12 ? preferredX : fallbackX, 12, layout.width - width - 12);
  const preferredY = baseY - height - safeCell * 0.72;
  const y = clamp(preferredY, layout.contentTop + 6, layout.height - height - 12);
  const anchorX = baseX + safeCell * 0.28;
  const anchorY = baseY - safeCell * 0.1;
  const lineTargetX = clamp(anchorX, x + 22, x + width - 22);
  const lineTargetY = y + height - 18;

  ctx.strokeStyle = "rgba(143, 216, 255, 0.24)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(lineTargetX, lineTargetY);
  ctx.stroke();
  ctx.fillStyle = "rgba(143, 216, 255, 0.32)";
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(226, 244, 255, 0.9)";
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 2.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(10, 14, 20, 0.92)";
  pathRoundedRect(ctx, x, y + 4, width, height, 16);
  ctx.fill();
  ctx.fillStyle = "rgba(22, 28, 36, 0.96)";
  pathRoundedRect(ctx, x, y, width, height, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(246,248,251,0.12)";
  ctx.lineWidth = 1;
  pathRoundedRect(ctx, x, y, width, height, 16);
  ctx.stroke();

  ctx.fillStyle = "rgba(143, 216, 255, 0.08)";
  pathRoundedRect(ctx, x + 10, y + 10, width - 20, 24, 10);
  ctx.fill();
  ctx.fillStyle = "rgba(143, 216, 255, 0.16)";
  pathRoundedRect(ctx, x + 14, y + 42, 42, 42, 12);
  ctx.fill();

  ctx.save();
  ctx.translate(x + 35, y + 63);
  if (upgrade) {
    drawUpgradePreview(ctx, upgrade, 0, 0, 22);
  } else {
    drawNeuronNode(ctx, 0, 0, 12, node, 0.1, false);
  }
  ctx.restore();

  drawText(ctx, "NEURAL NODE", x + 18, y + 27, 11, COLORS.energyBright);
  drawText(ctx, upgrade ? "Installed module" : "Empty slot", x + width - 14, y + 27, 11, COLORS.textDim, "right");
  const titleY = y + 48;
  const titleCount = drawWrappedTextBlock(ctx, title, x + textX, titleY, 15, COLORS.text, textWidth, 16, 2);
  const shortY = titleY + titleCount * 16 + 6;
  const shortCount = drawWrappedTextBlock(ctx, shortText, x + textX, shortY, 11, COLORS.warning, textWidth, 13, 2);
  const descY = shortY + shortCount * 13 + 8;
  const descCount = drawWrappedTextBlock(ctx, descText, x + textX, descY, 10, COLORS.textDim, textWidth, 12, 4);
  const statsY = descY + descCount * 12 + 12;
  drawText(ctx, "Stats", x + textX, statsY, 11, COLORS.energyBright);
  drawText(ctx, `White ${nodeStats(node)}`, x + width - 14, statsY, 11, COLORS.warning, "right");
  for (let index = 0; index < visibleLines.length; index += 1) {
    drawText(ctx, `• ${visibleLines[index]}`, x + textX, statsY + 20 + index * 16, 12, index === 0 ? COLORS.warning : COLORS.textDim);
  }
  drawText(ctx, "Tap outside to close", x + 18, y + height - 14, 10, COLORS.textDim);
}

function drawLegendaryInspectCard(world, ctx) {
  const { ui, layout, run } = world.resources;
  if (!ui.legendaryInspect || !layout) {
    return;
  }

  const perk = ui.legendaryInspect;
  const stats = legendaryInspectLines(perk);
  const badgeRect = legendaryRectForPerk(layout, run, perk.id);
  const boxW = Math.min(310, layout.width * 0.78);
  const textX = 78;
  const textWidth = boxW - textX - 14;
  const nameLines = measureWrappedText(ctx, perk.name, 15, textWidth, 2);
  const shortLines = measureWrappedText(ctx, perk.short, 11, textWidth, 2);
  const descLines = measureWrappedText(ctx, perk.description, 10, textWidth, 4);
  const boxH = Math.max(160, 56 + nameLines.length * 16 + 6 + shortLines.length * 13 + 8 + descLines.length * 12 + 14 + 20 + stats.length * 16 + 24);
  const preferredX = badgeRect ? badgeRect.x + badgeRect.width + 12 : 18;
  const fallbackX = badgeRect ? badgeRect.x - boxW - 12 : 18;
  const boxX = clamp(preferredX + boxW <= layout.width - 18 ? preferredX : fallbackX, 18, layout.width - boxW - 18);
  const preferredY = badgeRect ? badgeRect.y + badgeRect.height + 12 : (run.shield > 0 ? 124 : 100);
  const boxY = clamp(preferredY, layout.contentTop + 10, layout.height - boxH - 18);
  const anchorX = badgeRect ? badgeRect.x + badgeRect.width * 0.5 : boxX + 18;
  const anchorY = badgeRect ? badgeRect.y + badgeRect.height * 0.5 : boxY + 20;
  const lineTargetX = clamp(anchorX, boxX + 22, boxX + boxW - 22);
  const lineTargetY = boxY + 18;

  ctx.strokeStyle = `${perk.color}55`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(lineTargetX, lineTargetY);
  ctx.stroke();
  ctx.fillStyle = `${perk.color}44`;
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(250,252,255,0.92)";
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 2.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(17, 22, 29, 0.92)";
  pathRoundedRect(ctx, boxX, boxY + 4, boxW, boxH, 16);
  ctx.fill();
  ctx.fillStyle = "rgba(23, 29, 37, 0.96)";
  pathRoundedRect(ctx, boxX, boxY, boxW, boxH, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(246,248,251,0.12)";
  ctx.lineWidth = 1;
  pathRoundedRect(ctx, boxX, boxY, boxW, boxH, 16);
  ctx.stroke();
  ctx.fillStyle = `${perk.color}14`;
  pathRoundedRect(ctx, boxX + 10, boxY + 10, boxW - 20, 24, 10);
  ctx.fill();
  ctx.fillStyle = `${perk.color}18`;
  pathRoundedRect(ctx, boxX + 14, boxY + 42, 42, 42, 12);
  ctx.fill();
  ctx.save();
  ctx.translate(boxX + 35, boxY + 63);
  drawUpgradePreview(ctx, perk, 0, 0, 22);
  ctx.restore();
  drawText(ctx, "LEGENDARY BADGE", boxX + 18, boxY + 27, 11, perk.color);
  drawText(ctx, "Tap badge to inspect", boxX + boxW - 14, boxY + 27, 11, COLORS.textDim, "right");
  const titleY = boxY + 48;
  const titleCount = drawWrappedTextBlock(ctx, perk.name, boxX + textX, titleY, 15, COLORS.text, textWidth, 16, 2);
  const shortY = titleY + titleCount * 16 + 6;
  const shortCount = drawWrappedTextBlock(ctx, perk.short, boxX + textX, shortY, 11, COLORS.warning, textWidth, 13, 2);
  const descY = shortY + shortCount * 13 + 8;
  const descCount = drawWrappedTextBlock(ctx, perk.description, boxX + textX, descY, 10, COLORS.textDim, textWidth, 12, 4);
  const statsY = descY + descCount * 12 + 12;
  drawText(ctx, "Stats", boxX + textX, statsY, 11, COLORS.energyBright);
  for (let index = 0; index < stats.length; index += 1) {
    drawText(ctx, `• ${stats[index]}`, boxX + textX, statsY + 20 + index * 16, 12, index === 0 ? COLORS.warning : COLORS.textDim);
  }
  drawText(ctx, "Tap outside to close", boxX + 18, boxY + boxH - 14, 10, COLORS.textDim);
  drawText(ctx, perk.id, boxX + boxW - 14, boxY + boxH - 14, 10, COLORS.textDim, "right");
}

function drawDraggedNodePreview(ctx, drag, layout) {
  if (!drag || !drag.sourceNode) {
    return;
  }
  ctx.save();
  ctx.translate(drag.hoverTarget ? drag.hoverTarget.x : drag.x, drag.hoverTarget ? drag.hoverTarget.y : drag.y);
  ctx.rotate(0.04);
  ctx.globalAlpha = 0.96;
  drawNeuronNode(ctx, 0, 0, layout.cell * 0.7, drag.sourceNode, 0.18, true);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawNodeDragTargets(ctx, layout, network, drag) {
  if (!(drag && drag.sourceKind === "node" && drag.active)) {
    return;
  }
  const world = drag.worldRef;
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const sourceTarget = drag.sourceTarget;
      if (sourceTarget && sourceTarget.layer === layer && sourceTarget.lane === lane) {
        continue;
      }
      const targetNode = network.nodes[layer][lane];
      const valid = drag.sourceNode && isValidNodePlacement(network, drag.sourceNode, { layer, lane }) &&
        (!nodeHasInstalledUpgrade(targetNode) ||
          canMergeNodeSnapshots(drag.sourceNode, cloneNodeState(targetNode)) ||
          isValidNodePlacement(network, cloneNodeState(targetNode), sourceTarget));
      if (!valid) {
        continue;
      }
      const x = laneCenterX(layout, lane);
      const y = world ? phaseLayerY(world, layer) : networkLayerY(layout, layer);
      const hover = drag.hoverTarget && drag.hoverTarget.target.layer === layer && drag.hoverTarget.target.lane === lane;
      const merge = nodeHasInstalledUpgrade(targetNode) && canMergeNodeSnapshots(drag.sourceNode, cloneNodeState(targetNode));
      ctx.strokeStyle = hover
        ? merge ? "rgba(255, 216, 122, 0.7)" : "rgba(89,245,214,0.58)"
        : merge ? "rgba(255, 216, 122, 0.34)" : "rgba(89,245,214,0.18)";
      ctx.lineWidth = hover ? 2.2 : 1.1;
      ctx.beginPath();
      ctx.arc(x, y, layout.cell * 1.18, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  drawDraggedNodePreview(ctx, drag, layout);
}

function drawBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, COLORS.bgPanel);
  gradient.addColorStop(0.38, COLORS.bgPanel);
  gradient.addColorStop(1, COLORS.bg);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const bloom = ctx.createRadialGradient(width * 0.5, height * 0.16, 0, width * 0.5, height * 0.16, height * 0.9);
  bloom.addColorStop(0, "rgba(0, 229, 255, 0.05)");
  bloom.addColorStop(0.35, "rgba(0, 229, 255, 0.02)");
  bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, width, height);

  // Tactical Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const cellSize = 32;
  for (let x = 0; x <= width; x += cellSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += cellSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function buildLayout(width, height) {
  const safeTop = 12;
  const safeBottom = 12;
  const isWide = width > height;
  const sideInset = isWide ? Math.max(32, width * 0.04) : 12;
  const topHudH = isWide ? 64 : 52;
  const stageHeight = height - safeTop - safeBottom;
  const stageWidthLimit = Math.min(width - sideInset * 2, stageHeight * 0.68);
  const gridCell = Math.max(12, Math.floor(stageWidthLimit / GRID_COLUMNS));
  const gridWidth = gridCell * GRID_COLUMNS;
  const gridHeight = gridCell * GRID_ROWS;
  const gridX = Math.floor((width - gridWidth) * 0.5);
  const gridY = Math.floor(safeTop + topHudH);
  const laneLeft = gridX + gridCell * 2.5;
  const laneRight = gridX + gridCell * 13.5;
  const laneSpacing = (laneRight - laneLeft) / (LANE_COUNT - 1);
  const fieldX = gridX;
  const fieldW = gridWidth;
  const contentTop = gridY;
  const contentBottom = height - safeBottom - 8;
  const contentHeight = contentBottom - contentTop;
  const fieldTop = contentTop + contentHeight * 0.04;
  const fieldBottom = contentTop + contentHeight * 0.5;
  const baseLineY = contentTop + contentHeight * 0.56;
  const shieldLineY = baseLineY - gridCell * 1.02;
  const towerY = contentTop + contentHeight * 0.59;
  const networkTop = contentTop + contentHeight * 0.73;
  const networkBottom = contentTop + contentHeight * 0.95;
  const turretX = gridX + gridWidth * 0.5;
  const turretY = towerY;
  return {
    width,
    height,
    safeTop,
    safeBottom,
    fieldX,
    fieldW,
    cell: gridCell,
    gridX,
    gridY,
    gridWidth,
    gridHeight,
    laneLeft,
    laneRight,
    laneSpacing,
    topHudH,
    contentTop,
    contentBottom,
    contentHeight,
    turretX,
    turretY,
    towerY,
    baseLineY,
    shieldLineY,
    fieldTop,
    fieldBottom,
    networkTop,
    networkBottom,
  };
}

function shieldGeometry(layout) {
  const shieldInset = layout.cell * 0.36;
  const domeWidth = layout.gridWidth - shieldInset * 2;
  const domeHeight = layout.cell * 1.3;
  const shieldY = layout.shieldLineY;
  const shieldCx = layout.gridX + layout.gridWidth * 0.5;
  const shieldRx = domeWidth * 0.5;
  const shieldRy = domeHeight * 0.78;
  return {
    shieldInset,
    domeWidth,
    domeHeight,
    shieldY,
    shieldCx,
    shieldRx,
    shieldRy,
    rimY: shieldY + layout.cell * 0.08,
    highlightY: shieldY - layout.cell * 0.1,
  };
}

function shieldSurfaceY(layout, x) {
  const geometry = shieldGeometry(layout);
  const rx = geometry.shieldRx * 0.94;
  const ry = geometry.shieldRy * 0.86;
  const nx = clamp((x - geometry.shieldCx) / Math.max(rx, 1), -1, 1);
  return geometry.highlightY - ry * Math.sqrt(Math.max(0, 1 - nx * nx));
}

function drawCombatScene(world, ctx) {
  const { layout, run, network, turret } = world.resources;
  const phaseName = world.resources.phase.name;
  const calmOverlay = world.resources.phase.name === "camp";
  const compactSelectionOverlay = false;
  const quietBackdrop = calmOverlay;
  const uiScale = layout.cell;
  const layerY = (layer) => networkLayerY(layout, layer);
  const activeLane = typeof network.activeInputLane === "number" ? network.activeInputLane : -1;
  const chargeProgress = network.pendingShot ? clamp(network.outputChargeTimer / Math.max(network.outputChargeStep, 0.001), 0, 1) : 0;
  const chargeEase = softPulse(chargeProgress);
  const propagationProgress = clamp(network.inputChargeTimer / Math.max(network.inputChargeStep || 0.001, 0.001), 0, 1);
  const propagationEase = softPulse(propagationProgress);
  const propagationStage = typeof network.inputStage === "number" ? network.inputStage : 0;
  const settledPacket = !!network.pendingShot && chargeProgress >= 0.999;
  const segmentReference = layout.cell * 1.7;
  const renderGrid = network.displayGrid || network.grid;
  const renderEdgeFlows = network.displayEdgeFlows || network.edgeFlows;
  const edgeFlow = (layer, type, lane) => {
    if (!renderEdgeFlows || !renderEdgeFlows[layer] || !renderEdgeFlows[layer][type]) {
      return 0;
    }
    return renderEdgeFlows[layer][type][lane] || 0;
  };
  const layerSignalProgress = (layer) => {
    if (network.pendingShot) {
      if (layer === NETWORK_LAYERS - 1) {
        return 0.34;
      }
      if (layer === NETWORK_LAYERS - 2) {
        return 0.18;
      }
      return 0;
    }
    if (layer < propagationStage) {
      return 1;
    }
    if (layer === propagationStage) {
      return propagationEase;
    }
    return 0;
  };
  const edgeSignalProgress = (layer, x1, y1, x2, y2) => {
    if (network.pendingShot) {
      if (layer === NETWORK_LAYERS - 1) {
        return segmentTravelProgress(chargeEase, x1, y1, x2, y2, segmentReference);
      }
      return 1;
    }
    if (layer < propagationStage - 1) {
      return 1;
    }
    if (layer === propagationStage - 1) {
      return segmentTravelProgress(propagationEase, x1, y1, x2, y2, segmentReference);
    }
    return 0;
  };

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let column = 0; column <= GRID_COLUMNS; column += 1) {
    const x = layout.gridX + column * layout.cell;
    ctx.globalAlpha = column % 4 === 0 ? 0.16 : 0.07;
    ctx.beginPath();
    ctx.moveTo(x, layout.contentTop);
    ctx.lineTo(x, layout.contentBottom);
    ctx.stroke();
  }
  for (let row = 0; row <= GRID_ROWS; row += 1) {
    if (quietBackdrop) {
      continue;
    }
    const y = layout.contentTop + (layout.contentHeight / GRID_ROWS) * row;
    ctx.globalAlpha = row % 4 === 0 ? 0.16 : 0.07;
    ctx.beginPath();
    ctx.moveTo(layout.gridX, y);
    ctx.lineTo(layout.gridX + layout.gridWidth, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (!quietBackdrop && ((run.shield || 0) > 0 || (run.shieldVisual || 0) > 0.01)) {
    const { shieldY, shieldInset, domeHeight, rimY, highlightY, shieldCx, shieldRx, shieldRy } = shieldGeometry(layout);
    const shieldAppear = smoothStep(run.shieldVisual || 0);
    const pulse = run.shieldAppearPulse || 0;
    const renderRx = shieldRx * (0.82 + shieldAppear * 0.18);
    const renderRy = shieldRy * (0.42 + shieldAppear * 0.58);
    const renderHighlightY = rimY - (rimY - highlightY) * shieldAppear;
    const fillAlpha = (0.05 + pulse * 0.06 + (run.shieldHitFlash || 0) * 0.12) * shieldAppear;
    const glowAlpha = (0.16 + pulse * 0.1 + (run.shieldHitFlash || 0) * 0.16) * shieldAppear;
    const rimAlpha = (0.24 + pulse * 0.12 + (run.shieldHitFlash || 0) * 0.34) * shieldAppear;
    const lowerAlpha = (0.17 + pulse * 0.08 + (run.shieldHitFlash || 0) * 0.22) * shieldAppear;

    ctx.fillStyle = `rgba(120, 212, 255, ${fillAlpha})`;
    ctx.beginPath();
    ctx.ellipse(shieldCx, rimY, renderRx, renderRy, 0, Math.PI, 0);
    ctx.lineTo(layout.gridX + layout.gridWidth - shieldInset, rimY + layout.cell * 0.26);
    ctx.ellipse(shieldCx, rimY + layout.cell * 0.26, renderRx, renderRy * 0.34, 0, 0, Math.PI, true);
    ctx.closePath();
    ctx.fill();

    const shieldGradient = ctx.createLinearGradient(0, shieldY - domeHeight * 0.82, 0, rimY + layout.cell * 0.26);
    shieldGradient.addColorStop(0, `rgba(224, 248, 255, ${glowAlpha})`);
    shieldGradient.addColorStop(0.45, `rgba(130, 214, 255, ${(0.12 + pulse * 0.08 + (run.shieldHitFlash || 0) * 0.18) * shieldAppear})`);
    shieldGradient.addColorStop(1, `rgba(64, 150, 220, ${(0.03 + pulse * 0.03 + (run.shieldHitFlash || 0) * 0.08) * shieldAppear})`);
    ctx.fillStyle = shieldGradient;
    ctx.beginPath();
    ctx.ellipse(shieldCx, shieldY, renderRx * 0.96, renderRy * 0.9, 0, Math.PI, 0);
    ctx.lineTo(layout.gridX + layout.gridWidth - shieldInset * 1.08, rimY + layout.cell * 0.14);
    ctx.ellipse(shieldCx, rimY + layout.cell * 0.14, renderRx * 0.96, renderRy * 0.28, 0, 0, Math.PI, true);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(210, 244, 255, ${rimAlpha})`;
    ctx.lineWidth = Math.max(1.6, layout.cell * 0.08);
    ctx.beginPath();
    ctx.ellipse(shieldCx, renderHighlightY, renderRx * 0.94, renderRy * 0.86, 0, Math.PI, 0);
    ctx.stroke();

    ctx.strokeStyle = `rgba(95, 194, 255, ${lowerAlpha})`;
    ctx.lineWidth = Math.max(1.2, layout.cell * 0.06);
    ctx.beginPath();
    ctx.ellipse(shieldCx, rimY + layout.cell * 0.06, renderRx, renderRy * 0.28, 0, 0, Math.PI);
    ctx.stroke();
  }

  if (!quietBackdrop) {
    ctx.fillStyle = "#352f38";
    ctx.fillRect(layout.gridX, layout.baseLineY, layout.gridWidth, uiScale * 0.45);
  }

  if (!compactSelectionOverlay) {
    const packetShots = network.pendingShot ? network.pendingShot.shots || [] : [];
    const currentPacketShot =
      network.pendingShot && network.outputChargeIndex < packetShots.length
        ? packetShots[network.outputChargeIndex]
        : null;
    const arrivedPacketLanes = new Set();
    for (let shotIndex = 0; shotIndex < Math.min(network.outputChargeIndex || 0, packetShots.length); shotIndex += 1) {
      arrivedPacketLanes.add(packetShots[shotIndex].lane);
    }

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const x = laneCenterX(layout, lane);
      const outputY = layerY(NETWORK_LAYERS - 1);
      const activeOutputs = network.pendingShot ? network.pendingShot.outputs || [] : [];
      const isInPacket = activeOutputs.indexOf(lane) !== -1;
      const isCurrentCharge = !!(currentPacketShot && currentPacketShot.lane === lane);
      const isArrived = arrivedPacketLanes.has(lane);
      const previewCharge = !network.pendingShot ? clamp((renderGrid[NETWORK_LAYERS - 1][lane] || 0) / 3.2, 0, 1) : 0;
      const towerCharge = network.pendingShot
        ? isInPacket
          ? 0.56
          : isArrived
            ? 0.34
            : 0
        : previewCharge * 0.82;
      const linkAlpha = network.pendingShot
        ? isInPacket
          ? 0.34
          : isArrived
            ? 0.22
            : 0
        : 0.06 + previewCharge * 0.18;
      const linkWidth = network.pendingShot
        ? isInPacket
          ? Math.max(2.3, uiScale * 0.15)
          : isArrived
            ? Math.max(1.8, uiScale * 0.12)
            : 0
        : 1 + previewCharge * Math.max(1.2, uiScale * 0.08);
      const turretBend = (layout.turretX - x) * 0.14;
      drawLinkCurve(ctx, x, outputY + layout.cell * 0.14, layout.turretX, layout.turretY - layout.cell * 0.2, linkWidth, `rgba(89,245,214,${linkAlpha})`, turretBend);
      if (isCurrentCharge || isArrived || previewCharge > 0.02) {
        const turretPathProgress = network.pendingShot
          ? (isCurrentCharge || isArrived || isInPacket ? 1 : 0)
          : segmentTravelProgress(previewCharge, x, outputY + layout.cell * 0.14, layout.turretX, layout.turretY - layout.cell * 0.2, segmentReference);
        drawEnergySegment(
          ctx,
          x,
          outputY + layout.cell * 0.14,
          layout.turretX,
          layout.turretY - layout.cell * 0.2,
          turretPathProgress,
          network.pendingShot
            ? isInPacket
              ? Math.max(2.8, uiScale * 0.19)
              : Math.max(2.0, uiScale * 0.14)
            : Math.max(2.0, uiScale * 0.14),
          network.pendingShot
            ? isInPacket
              ? 0.56
              : isArrived
                ? 0.26
                : 0
            : 0.42,
          turretBend,
        );
      }
    }

    const turretChargeRaw = computeTurretChargeProgress(network);
    const turretCharge = clamp(Math.max(0.08, turret.chargeVisual || turretChargeRaw), 0.08, 1);
    const turretChargePhase = turret.chargeCycle || 0;
    const turretChargeWave = Math.sin(turretChargePhase) * 0.5 + 0.5;
    const turretBurst = turret.chargeBurst || 0;
    const turretCoreFlash = turret.coreFlash || 0;
    const turretMuzzleFlash = turret.muzzleFlash || 0;
    const turretRecoil = turret.recoil || 0;
    const turretBaseW = layout.cell * 2.6;
    const turretBaseH = layout.cell * 0.42;
    const turretHeadW = layout.cell * 1.48;
    const turretHeadH = layout.cell * 1.02;
    const barrelLength = layout.cell * (1.06 - turretRecoil * 0.08);
    const barrelWidth = Math.max(4, layout.cell * 0.18);
    const barrelStartOffset = layout.cell * (0.46 - turretRecoil * 0.1);
    const barrelStartX = layout.turretX + Math.cos(world.resources.turret.angle) * barrelStartOffset;
    const barrelStartY = layout.turretY + Math.sin(world.resources.turret.angle) * barrelStartOffset;
    const barrelX = layout.turretX + Math.cos(world.resources.turret.angle) * barrelLength;
    const barrelY = layout.turretY + Math.sin(world.resources.turret.angle) * barrelLength;

    ctx.fillStyle = "rgba(7, 10, 14, 0.3)";
    ctx.beginPath();
    ctx.ellipse(layout.turretX, layout.turretY + layout.cell * 0.9, layout.cell * 1.25, layout.cell * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f2e8c9";
    pathRoundedRect(
      ctx,
      layout.turretX - turretBaseW * 0.42,
      layout.turretY + layout.cell * 0.52,
      turretBaseW * 0.84,
      turretBaseH,
      layout.cell * 0.08,
    );
    ctx.fill();

    ctx.fillStyle = "#15283d";
    pathRoundedRect(
      ctx,
      layout.turretX - turretBaseW * 0.5,
      layout.turretY + layout.cell * 0.26,
      turretBaseW,
      turretBaseH * 1.08,
      layout.cell * 0.14,
    );
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    pathRoundedRect(
      ctx,
      layout.turretX - turretBaseW * 0.42,
      layout.turretY + layout.cell * 0.3,
      turretBaseW * 0.84,
      turretBaseH * 0.36,
      layout.cell * 0.08,
    );
    ctx.fill();
    ctx.strokeStyle = "rgba(137, 218, 255, 0.4)";
    ctx.lineWidth = 1.8;
    pathRoundedRect(
      ctx,
      layout.turretX - turretBaseW * 0.5,
      layout.turretY + layout.cell * 0.26,
      turretBaseW,
      turretBaseH * 1.08,
      layout.cell * 0.14,
    );
    ctx.stroke();

    ctx.fillStyle = "rgba(216,191,132,0.14)";
    pathRoundedRect(
      ctx,
      layout.turretX - turretBaseW * 0.46,
      layout.turretY + layout.cell * 0.36,
      turretBaseW * 0.92,
      layout.cell * 0.18,
      layout.cell * 0.08,
    );
    ctx.fill();
    ctx.fillStyle = `rgba(216,191,132,${0.34 + turretCharge * 0.42})`;
    pathRoundedRect(
      ctx,
      layout.turretX - turretBaseW * 0.46,
      layout.turretY + layout.cell * 0.36,
      turretBaseW * 0.92 * turretCharge,
      layout.cell * 0.18,
      layout.cell * 0.08,
    );
    ctx.fill();
    ctx.fillStyle = `rgba(143,216,255,${0.12 + turretCharge * 0.1 + turretChargeWave * 0.06 + turretBurst * 0.1})`;
    pathRoundedRect(
      ctx,
      layout.turretX - turretBaseW * 0.44,
      layout.turretY + layout.cell * 0.34,
      turretBaseW * 0.88 * clamp(turretCharge * 0.72 + turretBurst * 0.14, 0, 1),
      layout.cell * 0.08,
      layout.cell * 0.05,
    );
    ctx.fill();

    ctx.save();
    ctx.translate(layout.turretX, layout.turretY - layout.cell * 0.02);
    ctx.rotate(world.resources.turret.angle);

    ctx.fillStyle = "rgba(216,191,132,0.14)";
    ctx.beginPath();
    ctx.ellipse(0, 0, turretHeadW * 0.56, turretHeadH * 0.64, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#102235";
    pathRoundedRect(ctx, -turretHeadW * 0.5, -turretHeadH * 0.42, turretHeadW, turretHeadH * 0.84, layout.cell * 0.22);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    pathRoundedRect(ctx, -turretHeadW * 0.38, -turretHeadH * 0.36, turretHeadW * 0.76, turretHeadH * 0.24, layout.cell * 0.12);
    ctx.fill();
    ctx.strokeStyle = "rgba(151, 219, 255, 0.54)";
    ctx.lineWidth = 2;
    pathRoundedRect(ctx, -turretHeadW * 0.5, -turretHeadH * 0.42, turretHeadW, turretHeadH * 0.84, layout.cell * 0.22);
    ctx.stroke();

    ctx.fillStyle = "#213a57";
    pathRoundedRect(ctx, -turretHeadW * 0.3, -turretHeadH * 0.6, turretHeadW * 0.6, turretHeadH * 0.24, layout.cell * 0.1);
    ctx.fill();

    ctx.fillStyle = `rgba(216,191,132,${0.26 + turretCharge * 0.42})`;
    ctx.beginPath();
    ctx.arc(0, 0, layout.cell * 0.19 + turretCharge * layout.cell * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(143,216,255,${0.1 + turretCharge * 0.24 + turretCoreFlash * 0.2})`;
    ctx.lineWidth = Math.max(1.2, layout.cell * 0.06);
    ctx.beginPath();
    ctx.arc(0, 0, layout.cell * (0.34 + turretCharge * 0.06), -Math.PI * 0.68 + turretChargePhase * 0.18, Math.PI * 0.18 + turretChargePhase * 0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, layout.cell * (0.42 + turretCharge * 0.08), Math.PI * 0.22 - turretChargePhase * 0.14, Math.PI * 0.94 - turretChargePhase * 0.14);
    ctx.stroke();
    ctx.strokeStyle = COLORS.energyBright;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, layout.cell * 0.27, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#1c3148";
    pathRoundedRect(ctx, -turretHeadW * 0.72, -layout.cell * 0.14, layout.cell * 0.28, layout.cell * 0.24, layout.cell * 0.08);
    ctx.fill();
    pathRoundedRect(ctx, turretHeadW * 0.44, -layout.cell * 0.14, layout.cell * 0.28, layout.cell * 0.24, layout.cell * 0.08);
    ctx.fill();

    ctx.strokeStyle = "#e9fbff";
    ctx.lineWidth = barrelWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(layout.cell * 0.2, 0);
    ctx.lineTo(barrelLength, 0);
    ctx.stroke();

    ctx.strokeStyle = "rgba(89,245,214,0.42)";
    ctx.lineWidth = Math.max(2, barrelWidth * 0.44);
    ctx.beginPath();
    ctx.moveTo(layout.cell * 0.25, 0);
    ctx.lineTo(barrelLength, 0);
    ctx.stroke();
    ctx.strokeStyle = `rgba(143,216,255,${0.08 + turretCharge * 0.28 + turretBurst * 0.18})`;
    ctx.lineWidth = Math.max(1.4, barrelWidth * 0.24);
    ctx.beginPath();
    ctx.moveTo(layout.cell * 0.24, 0);
    ctx.lineTo(barrelLength, 0);
    ctx.stroke();
    if (turretCharge > 0.12 || turretMuzzleFlash > 0.01) {
      const muzzleGlow = 0.12 + turretCharge * 0.22 + turretMuzzleFlash * 0.54;
      ctx.fillStyle = `rgba(143,216,255,${muzzleGlow})`;
      ctx.beginPath();
      ctx.ellipse(
        barrelLength + layout.cell * 0.05,
        0,
        layout.cell * (0.08 + turretCharge * 0.08 + turretMuzzleFlash * 0.12),
        layout.cell * (0.14 + turretCharge * 0.06 + turretMuzzleFlash * 0.12),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    ctx.fillStyle = "#13283f";
    pathRoundedRect(ctx, layout.cell * 0.06, -layout.cell * 0.12, layout.cell * 0.44, layout.cell * 0.24, layout.cell * 0.08);
    ctx.fill();
    ctx.strokeStyle = "rgba(140, 214, 255, 0.48)";
    ctx.lineWidth = 1.3;
    pathRoundedRect(ctx, layout.cell * 0.06, -layout.cell * 0.12, layout.cell * 0.44, layout.cell * 0.24, layout.cell * 0.08);
    ctx.stroke();

    ctx.restore();

    ctx.fillStyle = `rgba(143,216,255,${0.08 + turretCharge * 0.12 + turretBurst * 0.1})`;
    ctx.beginPath();
    ctx.arc(barrelStartX, barrelStartY, layout.cell * (0.09 + turretCharge * 0.03), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(216,191,132,${0.18 + turretCharge * 0.26 + turretBurst * 0.12})`;
    ctx.beginPath();
    ctx.arc(barrelX, barrelY, layout.cell * (0.11 + turretMuzzleFlash * 0.04), 0, Math.PI * 2);
    ctx.fill();
    if (turretCharge > 0.08 || turretBurst > 0.01) {
      ctx.strokeStyle = `rgba(143,216,255,${0.1 + turretCharge * 0.16 + turretBurst * 0.2})`;
      ctx.lineWidth = Math.max(1.4, layout.cell * 0.06);
      ctx.beginPath();
      ctx.arc(layout.turretX, layout.turretY - layout.cell * 0.02, layout.cell * (0.62 + turretChargeWave * 0.04), -Math.PI * 0.84, -Math.PI * 0.18);
      ctx.stroke();
    }

    for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const x = laneCenterX(layout, lane);
      const y = layerY(layer);
      const strength = renderGrid[layer][lane];
      const active = clamp(strength / 8, 0, 1);
      const routeActive = lane === activeLane;

      const node = renderNodeState(world, layer, lane);

      if (layer < NETWORK_LAYERS - 1) {
        const nextY = layerY(layer + 1);
        const forwardFlow = clamp(edgeFlow(layer, "forward", lane) / 8, 0, 1);
        const linkGlow = forwardFlow > 0 ? 0.12 + forwardFlow * 0.24 : 0.06;
        drawLinkCurve(ctx, x, y, x, nextY, 2, forwardFlow > 0 ? `rgba(89,245,214,${linkGlow})` : COLORS.grid, layout.cell * 0.18);
        if (forwardFlow > 0.02) {
          const verticalProgress = edgeSignalProgress(layer, x, y, x, nextY);
          drawEnergySegment(
            ctx,
            x,
            y,
            x,
            nextY,
            verticalProgress,
            Math.max(3, uiScale * 0.2),
            settledPacket ? 0.82 : 0.58,
            layout.cell * 0.18,
          );
        }
        if (node.links.left > 0 && lane > 0) {
          const leftGlow = clamp(edgeFlow(layer, "left", lane) / 8, 0, 1);
          const leftTargetX = laneCenterX(layout, lane - 1);
          const leftBend = -layout.cell * 0.38;
          drawLinkCurve(ctx, x, y, leftTargetX, nextY, 2, `rgba(89,245,214,${0.1 + leftGlow * 0.28})`, leftBend);
          if (leftGlow > 0.02) {
            const diagonalLeftProgress = edgeSignalProgress(layer, x, y, leftTargetX, nextY);
            drawEnergySegment(
              ctx,
              x,
              y,
              leftTargetX,
              nextY,
              diagonalLeftProgress,
              Math.max(2.6, uiScale * 0.18),
              0.76,
              leftBend,
            );
          }
        }
        if (node.links.right > 0 && lane < LANE_COUNT - 1) {
          const rightGlow = clamp(edgeFlow(layer, "right", lane) / 8, 0, 1);
          const rightTargetX = laneCenterX(layout, lane + 1);
          const rightBend = layout.cell * 0.38;
          drawLinkCurve(ctx, x, y, rightTargetX, nextY, 2, `rgba(89,245,214,${0.1 + rightGlow * 0.28})`, rightBend);
          if (rightGlow > 0.02) {
            const diagonalRightProgress = edgeSignalProgress(layer, x, y, rightTargetX, nextY);
            drawEnergySegment(
              ctx,
              x,
              y,
              rightTargetX,
              nextY,
              diagonalRightProgress,
              Math.max(2.6, uiScale * 0.18),
              0.76,
              rightBend,
            );
          }
        }
      }
      if (
        network.sameTypeResonance &&
        lane < LANE_COUNT - 1 &&
        node.appearance &&
        renderNodeState(world, layer, lane + 1) &&
        renderNodeState(world, layer, lane + 1).appearance &&
        node.appearance.id === renderNodeState(world, layer, lane + 1).appearance.id
      ) {
        const rightX = laneCenterX(layout, lane + 1);
        const resonanceGlow = layer < NETWORK_LAYERS - 1
          ? clamp((edgeFlow(layer, "resonanceRight", lane) + edgeFlow(layer, "resonanceLeft", lane + 1)) / 8, 0, 1)
          : clamp((Math.max(renderGrid[layer][lane], renderGrid[layer][lane + 1]) * 0.72) / 8, 0, 1);
        const resonanceBend = lane % 2 === 0 ? -layout.cell * 0.16 : layout.cell * 0.16;
        drawLinkCurve(
          ctx,
          x,
          y,
          rightX,
          y,
          1.9,
          `rgba(89,245,214,${0.11 + resonanceGlow * 0.24})`,
          resonanceBend,
        );
        if (resonanceGlow > 0.02) {
          const resonanceProgress = network.pendingShot
            ? 1
            : layer === NETWORK_LAYERS - 1
              ? (settledPacket ? 1 : segmentTravelProgress(chargeProgress, x, y, rightX, y, segmentReference))
            : edgeSignalProgress(layer, x, y, rightX, y);
          drawEnergySegment(
            ctx,
            x,
            y,
            rightX,
            y,
            resonanceProgress,
            Math.max(2.4, uiScale * 0.17),
            0.66,
            resonanceBend,
          );
        }
      }
      if (node.links.divider > 0) {
        const dividerLeftGlow = lane > 0
          ? layer < NETWORK_LAYERS - 1
            ? clamp(edgeFlow(layer, "dividerLeft", lane) / 8, 0, 1)
            : clamp((renderGrid[layer][lane - 1] || 0) / 8, 0, 1)
          : 0;
        const dividerRightGlow = lane < LANE_COUNT - 1
          ? layer < NETWORK_LAYERS - 1
            ? clamp(edgeFlow(layer, "dividerRight", lane) / 8, 0, 1)
            : clamp((renderGrid[layer][lane + 1] || 0) / 8, 0, 1)
          : 0;
        const dividerGlow = Math.max(dividerLeftGlow, dividerRightGlow);
        ctx.strokeStyle = `rgba(89,245,214,${0.12 + dividerGlow * 0.26})`;
        ctx.lineWidth = 1.6 + Math.min(1.8, node.links.divider * 0.55);
        if (lane > 0) {
          const leftTargetX = laneCenterX(layout, lane - 1);
          drawLinkCurve(ctx, x, y, leftTargetX, y, ctx.lineWidth, `rgba(89,245,214,${0.12 + dividerGlow * 0.26})`, -layout.cell * 0.24);
          if (dividerLeftGlow > 0.02) {
            drawEnergySegment(
              ctx,
              x,
              y,
              leftTargetX,
              y,
              network.pendingShot
                ? 1
                : layer === NETWORK_LAYERS - 1
                  ? (settledPacket ? 1 : segmentTravelProgress(chargeProgress, x, y, laneCenterX(layout, lane - 1), y, segmentReference))
                : edgeSignalProgress(layer, x, y, laneCenterX(layout, lane - 1), y),
              Math.max(2.4, uiScale * 0.17),
              0.68,
              -layout.cell * 0.24,
            );
          }
        }
        if (lane < LANE_COUNT - 1) {
          const rightTargetX = laneCenterX(layout, lane + 1);
          drawLinkCurve(ctx, x, y, rightTargetX, y, ctx.lineWidth, `rgba(89,245,214,${0.12 + dividerGlow * 0.26})`, layout.cell * 0.24);
          if (dividerRightGlow > 0.02) {
            drawEnergySegment(
              ctx,
              x,
              y,
              rightTargetX,
              y,
              network.pendingShot
                ? 1
                : layer === NETWORK_LAYERS - 1
                  ? (settledPacket ? 1 : segmentTravelProgress(chargeProgress, x, y, laneCenterX(layout, lane + 1), y, segmentReference))
                : edgeSignalProgress(layer, x, y, laneCenterX(layout, lane + 1), y),
              Math.max(2.4, uiScale * 0.17),
              0.68,
              layout.cell * 0.24,
            );
          }
        }
        ctx.lineWidth = 2;
      }
      if (node.links.merger > 0) {
        const mergerLeftGlow = lane > 0
          ? layer < NETWORK_LAYERS - 1
            ? clamp(edgeFlow(layer, "mergerLeft", lane) / 8, 0, 1)
            : clamp((renderGrid[layer][lane - 1] || 0) / 8, 0, 1)
          : 0;
        const mergerRightGlow = lane < LANE_COUNT - 1
          ? layer < NETWORK_LAYERS - 1
            ? clamp(edgeFlow(layer, "mergerRight", lane) / 8, 0, 1)
            : clamp((renderGrid[layer][lane + 1] || 0) / 8, 0, 1)
          : 0;
        const mergerGlow = Math.max(mergerLeftGlow, mergerRightGlow);
        ctx.strokeStyle = `rgba(89,245,214,${0.12 + mergerGlow * 0.26})`;
        ctx.lineWidth = 1.6 + Math.min(1.6, node.links.merger * 0.5);
        if (lane > 0) {
          const leftSourceX = laneCenterX(layout, lane - 1);
          drawLinkCurve(ctx, leftSourceX, y, x, y, ctx.lineWidth, `rgba(89,245,214,${0.12 + mergerGlow * 0.26})`, layout.cell * 0.2);
          if (mergerLeftGlow > 0.02) {
            drawEnergySegment(
              ctx,
              leftSourceX,
              y,
              x,
              y,
              network.pendingShot
                ? 1
                : layer === NETWORK_LAYERS - 1
                  ? (settledPacket ? 1 : segmentTravelProgress(chargeProgress, laneCenterX(layout, lane - 1), y, x, y, segmentReference))
                : edgeSignalProgress(layer, laneCenterX(layout, lane - 1), y, x, y),
              Math.max(2.4, uiScale * 0.17),
              0.68,
              layout.cell * 0.2,
            );
          }
        }
        if (lane < LANE_COUNT - 1) {
          const rightSourceX = laneCenterX(layout, lane + 1);
          drawLinkCurve(ctx, rightSourceX, y, x, y, ctx.lineWidth, `rgba(89,245,214,${0.12 + mergerGlow * 0.26})`, -layout.cell * 0.2);
          if (mergerRightGlow > 0.02) {
            drawEnergySegment(
              ctx,
              rightSourceX,
              y,
              x,
              y,
              network.pendingShot
                ? 1
                : layer === NETWORK_LAYERS - 1
                  ? (settledPacket ? 1 : segmentTravelProgress(chargeProgress, laneCenterX(layout, lane + 1), y, x, y, segmentReference))
                : edgeSignalProgress(layer, laneCenterX(layout, lane + 1), y, x, y),
              Math.max(2.4, uiScale * 0.17),
              0.68,
              -layout.cell * 0.2,
            );
          }
        }
        ctx.lineWidth = 2;
      }

        const stageGlow = routeActive ? layerSignalProgress(layer) : 0;
        const nodeGlow = routeActive
          ? network.pendingShot
            ? layer === NETWORK_LAYERS - 1
              ? 0.42
              : layer === NETWORK_LAYERS - 2
                ? 0.16
                : 0
            : 0.18 + stageGlow * 0.34
          : 0;
        const nodeRadius = layout.cell * 0.64;
        drawNeuronNode(ctx, x, y, nodeRadius, node, nodeGlow, false);
      }
    }

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const x = laneCenterX(layout, lane);
      if (lane === activeLane && !network.pendingShot) {
        const sourceStrength = 0.14 + layerSignalProgress(0) * 0.42;
        ctx.fillStyle = `rgba(89,245,214,${sourceStrength})`;
        ctx.beginPath();
        ctx.arc(x, layerY(0), layout.cell * 0.28 + layerSignalProgress(0) * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  for (const entity of world.query("enemy")) {
    const enemy = world.getComponent(entity, "enemy");
    const baseX = enemyScreenX(layout, enemy);
    const x = baseX + (enemy.hitNudgeX || 0);
    const y = enemy.y + (enemy.hitNudgeY || 0);
    drawEnemyShield(ctx, enemy, x, y, "back");
    drawEnemy(ctx, enemy, x, y);
    drawEnemyShield(ctx, enemy, x, y, "front");
    if (enemy.hitFlash > 0) {
      const hitAlpha = clamp(enemy.hitFlash / 0.16, 0, 1);
      ctx.globalAlpha = hitAlpha * 0.58;
      ctx.strokeStyle = "#f6f8fb";
      ctx.lineWidth = Math.max(1.4, enemy.radius * 0.08);
      ctx.beginPath();
      ctx.ellipse(x, y - enemy.radius * 0.08, enemy.radius * 0.88, enemy.radius * 0.68, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = hitAlpha * 0.18;
      ctx.fillStyle = "#f6f8fb";
      ctx.beginPath();
      ctx.ellipse(x, y - enemy.radius * 0.04, enemy.radius * 1.02, enemy.radius * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawEnemyStatuses(ctx, enemy, x, y, layout);

    const hpWidth = enemy.elite ? enemy.radius * 2.8 : enemy.radius * 2;
    const hpX = x - hpWidth * 0.5;
    if ((enemy.maxShield || 0) > 0 && (enemy.shield || 0) > 0) {
      ctx.fillStyle = "#162434";
      ctx.fillRect(hpX, y + enemy.radius - 4, hpWidth, enemy.elite ? 6 : 4);
      ctx.fillStyle = "#8fd8ff";
      ctx.fillRect(hpX, y + enemy.radius - 4, hpWidth * (enemy.shield / enemy.maxShield), enemy.elite ? 6 : 4);
    }
    ctx.fillStyle = "#1d1715";
    ctx.fillRect(hpX, y + enemy.radius + 6, hpWidth, enemy.elite ? 7 : 5);
    ctx.fillStyle = COLORS.good;
    ctx.fillRect(hpX, y + enemy.radius + 6, hpWidth * (enemy.hp / enemy.maxHp), enemy.elite ? 7 : 5);
  }

  for (const entity of world.query("summonBot")) {
    const summon = world.getComponent(entity, "summonBot");
    const x = laneCenterX(layout, summon.lane);
    const y = summon.y;
    ctx.globalAlpha = 0.86;
    ctx.strokeStyle = "rgba(143, 216, 255, 0.34)";
    ctx.lineWidth = Math.max(1.4, summon.radius * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, y + summon.radius * 0.9);
    ctx.lineTo(x, y + summon.radius * 1.85);
    ctx.stroke();
    
    const summonStatus = { burn: summon.burn || 0, curse: summon.curse || 0, slow: 0, freeze: 0 };
    const dummyEnemy = {
      family: summon.family,
      shape: summon.shape,
      radius: summon.radius,
      tint: summon.tint,
      elite: false,
      boss: false,
      xOffset: 0,
      wormWave: 0,
      wormZigzagTime: 0,
      status: summonStatus,
    };
    drawEnemy(ctx, dummyEnemy, x, y);
    drawEnemyStatuses(ctx, dummyEnemy, x, y, layout);
    
    ctx.globalAlpha = 1;
  }

  for (const entity of world.query("coin")) {
    const coin = world.getComponent(entity, "coin");
    const bobY = Math.sin(coin.bob) * 2.2;
    const pulse = 0.5 + Math.sin(coin.pulse) * 0.5;
    ctx.fillStyle = "rgba(7, 10, 14, 0.24)";
    ctx.beginPath();
    ctx.ellipse(coin.x, coin.y + coin.radius * 0.9, coin.radius * 0.9, coin.radius * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 214, 112, ${0.16 + pulse * 0.18})`;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y + bobY, coin.radius * 1.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f2c764";
    ctx.beginPath();
    ctx.arc(coin.x, coin.y + bobY, coin.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff0bd";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y + bobY, coin.radius, 0, Math.PI * 2);
    ctx.stroke();
    drawText(ctx, `$`, coin.x, coin.y + bobY + coin.radius * 0.3, Math.max(10, coin.radius * 1.1), "#fff8db", "center");
    if (coin.value > 9) {
      drawText(ctx, `${coin.value}`, coin.x, coin.y - coin.radius * 1.15 + bobY, Math.max(10, layout.cell * 0.46), COLORS.warning, "center");
    }
  }

  for (const entity of world.query("projectile")) {
    const projectile = world.getComponent(entity, "projectile");
    const visual = projectileVisual(projectile);
    ctx.fillStyle = visual.halo;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = visual.trail;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = visual.core;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
    if (visual.accents.length > 0) {
      const orbitRadius = projectile.radius * 1.55;
      const markerRadius = Math.max(1.8, projectile.radius * 0.42);
      for (let index = 0; index < visual.accents.length; index += 1) {
        const accent = visual.accents[index];
        const angle = -Math.PI * 0.5 + (Math.PI * 2 * index) / visual.accents.length;
        const px = projectile.x + Math.cos(angle) * orbitRadius;
        const py = projectile.y + Math.sin(angle) * orbitRadius;
        ctx.fillStyle = accent.color;
        ctx.beginPath();
        ctx.arc(px, py, markerRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(7,14,24,0.82)";
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
    }
  }

  for (const entity of world.query("flash")) {
    const flash = world.getComponent(entity, "flash");
    const alpha = clamp(flash.life / flash.maxLife, 0, 1);
    const growth = 1.2 - alpha * 0.4;
    ctx.globalAlpha = alpha * 0.8;
    if (flash.style === "pierce") {
      ctx.save();
      ctx.translate(flash.x, flash.y);
      ctx.rotate(flash.rotation || 0);
      ctx.strokeStyle = flash.color;
      ctx.lineWidth = Math.max(2, flash.radius * 0.16);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-flash.radius * (0.25 + (1 - alpha) * 0.35), flash.radius * 0.16);
      ctx.lineTo(flash.radius * (0.92 + (1 - alpha) * 0.16), -flash.radius * 0.16);
      ctx.stroke();
      ctx.strokeStyle = flash.accent || flash.color;
      ctx.lineWidth = Math.max(1.2, flash.radius * 0.08);
      ctx.beginPath();
      ctx.moveTo(-flash.radius * 0.12, flash.radius * 0.34);
      ctx.lineTo(flash.radius * 0.66, -flash.radius * 0.34);
      ctx.stroke();
      ctx.restore();
    } else if (flash.style === "merge") {
      const t = 1 - alpha;
      const mergeT = smoothStep(clamp(t / 0.64, 0, 1));
      const settleT = smoothStep(clamp((t - 0.64) / 0.36, 0, 1));
      const preview = {
        id: flash.upgradeId || flash.icon,
        color: flash.color,
        icon: flash.icon,
        shape: flash.shape || "diamond",
        level: flash.level || 1,
      };
      const rise = flash.radius * 1.36 * (1 - mergeT);
      const spread = flash.radius * 0.96 * (1 - mergeT);
      ctx.save();
      ctx.globalAlpha = alpha * 0.92;
      ctx.translate(flash.x - spread, flash.y - rise);
      drawUpgradePreview(ctx, preview, 0, 0, flash.radius * 0.54);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = alpha * 0.92;
      ctx.translate(flash.x + spread, flash.y - rise);
      drawUpgradePreview(ctx, preview, 0, 0, flash.radius * 0.54);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = settleT * alpha;
      ctx.translate(flash.x, flash.y - flash.radius * 0.12 * (1 - settleT));
      drawUpgradePreview(ctx, preview, 0, 0, flash.radius * (0.62 + settleT * 0.1));
      ctx.restore();
      ctx.strokeStyle = `rgba(246,248,251,${0.12 + settleT * 0.42})`;
      ctx.lineWidth = Math.max(1.6, flash.radius * 0.08);
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius * (0.58 + settleT * 0.22), 0, Math.PI * 2);
      ctx.stroke();
    } else if (flash.style === "burn") {
      ctx.strokeStyle = flash.color;
      ctx.lineWidth = Math.max(1.8, flash.radius * 0.11);
      for (let index = 0; index < 3; index += 1) {
        const angle = -1.1 + index * 1.1;
        ctx.beginPath();
        ctx.arc(flash.x, flash.y, flash.radius * (0.46 + index * 0.16 + (1 - alpha) * 0.08), angle, angle + 0.85);
        ctx.stroke();
      }
      ctx.fillStyle = flash.accent || flash.color;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (flash.style === "curse") {
      ctx.strokeStyle = flash.color;
      ctx.lineWidth = Math.max(1.6, flash.radius * 0.08);
      ctx.beginPath();
      ctx.ellipse(flash.x, flash.y, flash.radius * (0.9 + (1 - alpha) * 0.16), flash.radius * 0.58, 0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(flash.x, flash.y, flash.radius * 0.54, flash.radius * (0.92 + (1 - alpha) * 0.12), -0.22, 0, Math.PI * 2);
      ctx.stroke();
    } else if (flash.style === "slow") {
      ctx.strokeStyle = flash.color;
      ctx.lineWidth = Math.max(1.8, flash.radius * 0.1);
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius * (0.74 + (1 - alpha) * 0.16), Math.PI * 0.2, Math.PI * 1.18);
      ctx.stroke();
      ctx.strokeStyle = flash.accent || flash.color;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius * (0.54 + (1 - alpha) * 0.12), -Math.PI * 0.84, -Math.PI * 0.04);
      ctx.stroke();
    } else if (flash.style === "freeze") {
      ctx.save();
      ctx.translate(flash.x, flash.y);
      ctx.strokeStyle = flash.color;
      ctx.lineWidth = Math.max(1.6, flash.radius * 0.09);
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const angle = (Math.PI * 2 * spoke) / 6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * flash.radius * 0.18, Math.sin(angle) * flash.radius * 0.18);
        ctx.lineTo(Math.cos(angle) * flash.radius * 0.88, Math.sin(angle) * flash.radius * 0.88);
        ctx.stroke();
      }
      ctx.strokeStyle = flash.accent || flash.color;
      ctx.beginPath();
      ctx.arc(0, 0, flash.radius * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (flash.style === "shock") {
      ctx.strokeStyle = flash.color;
      ctx.lineWidth = Math.max(1.8, flash.radius * 0.1);
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius * growth, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = flash.accent || flash.color;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius * (0.58 + (1 - alpha) * 0.18), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = flash.color;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius * growth, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  for (const entity of world.query("damageText")) {
    const damageText = world.getComponent(entity, "damageText");
    ctx.globalAlpha = clamp(damageText.life / damageText.maxLife, 0, 1);
    drawText(ctx, `${damageText.value}`, damageText.x, damageText.y, damageTextFontSize(layout, damageText.value), damageText.color, "center");
    ctx.globalAlpha = 1;
  }

  for (const entity of world.query("coinFly")) {
    const coinFly = world.getComponent(entity, "coinFly");
    ctx.fillStyle = "rgba(255, 214, 112, 0.2)";
    ctx.beginPath();
    ctx.arc(coinFly.x, coinFly.y, layout.cell * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f2c764";
    ctx.beginPath();
    ctx.arc(coinFly.x, coinFly.y, Math.max(6, layout.cell * 0.24), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff0bd";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(coinFly.x, coinFly.y, Math.max(6, layout.cell * 0.24), 0, Math.PI * 2);
    ctx.stroke();
  }

  const hudX = 22;
  const hudY = 22;
  const barW = Math.min(160, layout.gridWidth * 0.34);
  const barH = 10;
  const hudShakeX = (run.baseHitFlash || 0) > 0 ? Math.sin(performance.now() * 0.08) * (run.baseHitFlash * 3.5) : 0;
  const panelX = hudX + hudShakeX;
  const panelY = hudY;
  ctx.fillStyle = "rgba(28, 33, 40, 0.9)";
  pathRoundedRect(ctx, panelX - 12, panelY - 16, barW + 24, run.shield > 0 ? 64 : 42, 14);
  ctx.fill();
  if ((run.baseHitFlash || 0) > 0.01) {
    ctx.fillStyle = `rgba(255, 110, 92, ${0.1 + run.baseHitFlash * 0.22})`;
    pathRoundedRect(ctx, panelX - 14, panelY - 18, barW + 28, run.shield > 0 ? 68 : 46, 16);
    ctx.fill();
  }
  if ((run.shieldHitFlash || 0) > 0.01) {
    ctx.fillStyle = `rgba(143, 216, 255, ${0.08 + run.shieldHitFlash * 0.18})`;
    pathRoundedRect(ctx, panelX - 14, panelY - 18, barW + 28, run.shield > 0 ? 68 : 46, 16);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(246,248,251,0.08)";
  ctx.lineWidth = 1;
  pathRoundedRect(ctx, panelX - 12, panelY - 16, barW + 24, run.shield > 0 ? 64 : 42, 14);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  pathRoundedRect(ctx, panelX, panelY + 10, barW, barH, 4);
  ctx.fill();
  ctx.fillStyle = COLORS.threat;
  pathRoundedRect(ctx, panelX, panelY + 10, barW * clamp(run.baseHp / run.maxBaseHp, 0, 1), barH, 4);
  ctx.fill();
  drawText(ctx, `Base ${run.baseHp}/${run.maxBaseHp}`, panelX, panelY, 16, COLORS.text);
  if (run.shield > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    pathRoundedRect(ctx, panelX, panelY + 30, barW, barH, 4);
    ctx.fill();
    ctx.fillStyle = "#8fd8ff";
    pathRoundedRect(ctx, panelX, panelY + 30, barW * clamp(run.shield / 8, 0, 1), barH, 4);
    ctx.fill();
    drawText(ctx, `Shield ${run.shield}`, panelX, panelY + 50, 14, COLORS.textDim);
  }
  const wallet = moneyBoxRect(layout);
  ctx.fillStyle = "rgba(28, 33, 40, 0.9)";
  pathRoundedRect(ctx, wallet.x, wallet.y, wallet.width, wallet.height, 12);
  ctx.fill();
  if ((run.moneyPickupFlash || 0) > 0.01) {
    ctx.fillStyle = `rgba(255, 214, 112, ${0.08 + run.moneyPickupFlash * 0.22})`;
    pathRoundedRect(ctx, wallet.x - 2, wallet.y - 2, wallet.width + 4, wallet.height + 4, 14);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(246,248,251,0.08)";
  ctx.lineWidth = 1;
  pathRoundedRect(ctx, wallet.x, wallet.y, wallet.width, wallet.height, 12);
  ctx.stroke();
  drawText(ctx, "$", wallet.x + 16, wallet.y + 23, 16, COLORS.warning);
  drawText(ctx, `${run.money}`, wallet.x + wallet.width - 12, wallet.y + 23, 18, COLORS.warning, "right");

  const phase = world.resources.phase;
  const currentLegendaryId = phase.name === "legendary_drop" && world.resources.ui.legendaryDrop ? world.resources.ui.legendaryDrop.id : null;
  const inspect = world.resources.ui.legendaryInspect;
  for (const rect of legendaryBadgeRects(layout, run)) {
    if (rect.perk.id === currentLegendaryId) {
      continue;
    }
    drawLegendaryBadge(ctx, rect, rect.perk, inspect && inspect.id === rect.perk.id);
  }
}

function cardLayout(world, count) {
  const { width, height } = world.resources.layout;
  const gap = 14;
  const totalGap = gap * (count - 1);
  const widthEach = Math.min(220, (width - 36 - totalGap) / count);
  const x = (width - (widthEach * count + totalGap)) / 2;
  return { x, y: height * 0.44, width: widthEach, height: Math.min(196, height * 0.28), gap };
}

function drawOverlay(world, ctx) {
  const { phase, ui, layout, network, run } = world.resources;

  if (phase.name === "combat" || phase.name === "map") {
    return;
  }

  const overlayAlpha =
    phase.name === "gameover"
      ? 0.76
      : phase.name === "camp"
        ? 0.16
        : phase.name === "camp_target"
          ? 0.08
        : phase.name === "doors"
          ? 0.16
          : phase.name === "shop"
            ? ui.drag && ui.drag.active
              ? 0.02
              : 0.06
            : phase.name === "reward_target" || phase.name === "shop_target"
              ? 0.08
              : 0.06;
  ctx.fillStyle = `rgba(15, 18, 24, ${overlayAlpha})`;
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (phase.name === "legendary_drop") {
    const intro = ui.rewardIntro || { timer: 0 };
    const perk = ui.legendaryDrop;
    const total = 1.8;
    const progress = intro.closing ? clamp(1 - intro.timer / total, 0, 1) : 0;
    const moveT = intro.closing ? smoothStep(clamp((progress - 0.42) / 0.48, 0, 1)) : 0;
    const panelFade = intro.closing ? 1 - clamp((progress - 0.58) / 0.22, 0, 1) : 1;
    const rects = legendaryBadgeRects(layout, run);
    const targetRect = rects.find((entry) => perk && entry.perk.id === perk.id) || {
      x: 22,
      y: run.shield > 0 ? 84 : 60,
      width: 28,
      height: 28,
    };
    const panel = {
      x: layout.width * 0.07,
      y: layout.height * 0.18,
      width: layout.width * 0.86,
      height: 0,
    };
    const iconSlotX = panel.x + 58;
    const iconSlotY = panel.y + 92;
    const fromX = iconSlotX;
    const fromY = iconSlotY;
    const toX = targetRect.x + targetRect.width * 0.5;
    const toY = targetRect.y + targetRect.height * 0.5;
    const iconX = fromX + (toX - fromX) * moveT;
    const iconY = fromY + (toY - fromY) * moveT;
    const iconScale = (1 - moveT) * 26 + moveT * (targetRect.width * 0.6);
    const textX = panel.x + 118;
    const textWidth = panel.width - 146;
    const titleY = panel.y + 68;
    const titleLines = measureWrappedText(ctx, perk ? perk.name : "Unknown Signal", 26, textWidth, 2);
    const shortY = titleY + titleLines.length * 28 + 8;
    const shortLines = measureWrappedText(ctx, perk ? perk.short : "", 12, textWidth, 2);
    const descY = shortY + shortLines.length * 14 + 12;
    const descLines = measureWrappedText(ctx, perk ? perk.description : "", 14, textWidth, 4);
    const textBottom = descY + descLines.length * 18;
    panel.height = Math.max(264, textBottom - panel.y + 86);

    ctx.fillStyle = `rgba(16, 20, 26, ${0.12 + panelFade * 0.14})`;
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.globalAlpha = panelFade * 0.96;
    ctx.fillStyle = "rgba(18, 23, 31, 0.8)";
    pathRoundedRect(ctx, panel.x, panel.y, panel.width, panel.height, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(246,248,251,0.12)";
    ctx.lineWidth = 1.2;
    pathRoundedRect(ctx, panel.x, panel.y, panel.width, panel.height, 18);
    ctx.stroke();
    drawText(ctx, "Legendary Perk", textX, panel.y + 34, 18, COLORS.warning);
    drawWrappedTextBlock(ctx, perk ? perk.name : "Unknown Signal", textX, titleY, 26, COLORS.energyBright, textWidth, 28, 2);
    drawWrappedTextBlock(ctx, perk ? perk.short : "", textX, shortY, 12, COLORS.warning, textWidth, 14, 2);
    drawWrappedTextBlock(ctx, perk ? perk.description : "", textX, descY, 14, COLORS.textDim, textWidth, 18, 4);
    if (!intro.closing) {
      const okRect = {
        x: layout.width * 0.5 - 74,
        y: panel.y + panel.height - 54,
        width: 148,
        height: 40,
      };
      drawButton(ctx, okRect, true);
      drawText(ctx, "OK", okRect.x + okRect.width * 0.5, okRect.y + 26, 18, COLORS.text, "center");
      button(world, okRect.x, okRect.y, okRect.width, okRect.height, "OK", { action: "legendary_ok" });
    }
    ctx.globalAlpha = 1;

    if (perk) {
      ctx.save();
      ctx.translate(iconX, iconY);
      drawUpgradePreview(ctx, perk, 0, 0, iconScale);
      ctx.restore();
    }
    return;
  }

  if (phase.name === "reward_victory") {
    const intro = ui.rewardIntro || { timer: 0 };
    const introAlpha = clamp(intro.timer / 1.15, 0, 1);
    ctx.fillStyle = `rgba(16, 20, 26, ${0.18 + introAlpha * 0.2})`;
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.globalAlpha = introAlpha;
    drawText(ctx, "Victory", layout.width / 2, layout.height * 0.42, 40, COLORS.energyBright, "center");
    drawText(ctx, "Neural imprint recovered", layout.width / 2, layout.height * 0.47, 18, COLORS.textDim, "center");
    ctx.globalAlpha = 1;
    return;
  }

  if (phase.name === "combat_finish") {
    ctx.fillStyle = "rgba(16, 20, 26, 0.08)";
    ctx.fillRect(0, 0, layout.width, layout.height);
    drawNodeDragTargets(ctx, layout, network, ui.drag);
    drawText(ctx, "Battle Complete", layout.width * 0.5, layout.height * 0.16, 30, COLORS.text, "center");
    const finishRect = {
      x: layout.width * 0.5 - 82,
      y: layout.contentTop + 8,
      width: 164,
      height: 52,
    };
    drawButton(ctx, finishRect, true);
    drawText(ctx, "Next", finishRect.x + finishRect.width * 0.46, finishRect.y + 34, 18, COLORS.text, "center");
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(finishRect.x + finishRect.width * 0.7 - 10, finishRect.y + 26);
    ctx.lineTo(finishRect.x + finishRect.width * 0.7 + 10, finishRect.y + 26);
    ctx.lineTo(finishRect.x + finishRect.width * 0.7 + 2, finishRect.y + 18);
    ctx.moveTo(finishRect.x + finishRect.width * 0.7 + 10, finishRect.y + 26);
    ctx.lineTo(finishRect.x + finishRect.width * 0.7 + 2, finishRect.y + 34);
    ctx.stroke();
    button(world, finishRect.x, finishRect.y, finishRect.width, finishRect.height, "Next", { action: "finish_battle" });
    return;
  }

  if (phase.name === "camp_finish") {
    ctx.fillStyle = "rgba(16, 20, 26, 0.08)";
    ctx.fillRect(0, 0, layout.width, layout.height);
    drawNodeDragTargets(ctx, layout, network, ui.drag);
    drawText(ctx, "Camp Upgrade Applied", layout.width * 0.5, layout.height * 0.16, 28, COLORS.text, "center");
    drawText(ctx, "You can review or rearrange the lattice before leaving.", layout.width * 0.5, layout.height * 0.2, 15, COLORS.textDim, "center");
    const finishRect = {
      x: layout.width * 0.5 - 82,
      y: layout.contentTop + 8,
      width: 164,
      height: 52,
    };
    drawButton(ctx, finishRect, true);
    drawText(ctx, "Next", finishRect.x + finishRect.width * 0.46, finishRect.y + 34, 18, COLORS.text, "center");
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(finishRect.x + finishRect.width * 0.7 - 10, finishRect.y + 26);
    ctx.lineTo(finishRect.x + finishRect.width * 0.7 + 10, finishRect.y + 26);
    ctx.lineTo(finishRect.x + finishRect.width * 0.7 + 2, finishRect.y + 18);
    ctx.moveTo(finishRect.x + finishRect.width * 0.7 + 10, finishRect.y + 26);
    ctx.lineTo(finishRect.x + finishRect.width * 0.7 + 2, finishRect.y + 34);
    ctx.stroke();
    button(world, finishRect.x, finishRect.y, finishRect.width, finishRect.height, "Next", { action: "finish_camp" });
    return;
  }

  if (phase.name === "reward_drag") {
    const pending = ui.pendingUpgrade;
    const isCampReward = !!(pending && pending.source === "camp");
    const drag = ui.drag;
    const t = performance.now() * 0.001;
    const moduleRects = rewardInlineModuleRects(layout, ui.cards.length);
    const cardsTop = moduleRects[0] ? moduleRects[0].y : layout.contentTop + 100;
    const cardsBottom = moduleRects.length ? moduleRects[moduleRects.length - 1].y + moduleRects[moduleRects.length - 1].height : cardsTop + 120;
    const trayRect = {
      x: layout.width * 0.06,
      y: cardsTop - 10,
      width: layout.width * 0.88,
      height: cardsBottom - cardsTop + 20,
    };
    const rewardToolbarWidth = isCampReward ? 108 : 226;
    const rewardToolbarX = trayRect.x + trayRect.width * 0.5 - rewardToolbarWidth * 0.5;
    const rewardLeaveRect = {
      x: rewardToolbarX,
      y: layout.contentTop + 4,
      width: 108,
      height: 46,
    };
    const rewardRerollRect = isCampReward
      ? null
      : {
          x: rewardToolbarX + 118,
          y: layout.contentTop + 4,
          width: 108,
          height: 46,
        };
    const rewardRerollCost = ui.rerollCost && typeof ui.rerollCost.reward === "number" ? ui.rerollCost.reward : rerollCostFor("reward", 0);
    const canRewardReroll = world.resources.run.money >= rewardRerollCost;
    const visual = pending ? pending.upgrade : null;
    const selectedRect = moduleRects[Math.max(0, ui.rewardSelection || 0)] || { x: layout.width * 0.5 - 50, y: layout.contentTop + layout.cell * 0.08, width: 100, height: 96 };
    const dragX = drag && drag.active ? (drag.hoverTarget ? drag.hoverTarget.x : drag.x) : selectedRect.x + selectedRect.width * 0.5;
    const dragY = drag && drag.active ? (drag.hoverTarget ? drag.hoverTarget.y : drag.y) : selectedRect.y + selectedRect.height * 0.5;
    const layerY = (layer) => networkLayerY(layout, layer);

    ctx.fillStyle = "rgba(17, 23, 30, 0.16)";
    pathRoundedRect(ctx, trayRect.x, trayRect.y, trayRect.width, trayRect.height, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(246,248,251,0.08)";
    ctx.lineWidth = 1;
    pathRoundedRect(ctx, trayRect.x, trayRect.y, trayRect.width, trayRect.height, 20);
    ctx.stroke();

    ui.cards.forEach((upgrade, index) => {
      const rect = moduleRects[index];
      const selected = index === (ui.rewardSelection || 0);
      drawOfferModuleCard(ctx, rect, upgrade, { selected, showDescription: true });
    });

    if (!(drag && drag.active)) {
      drawPillButton(ctx, rewardLeaveRect, true);
      drawText(ctx, "Leave", rewardLeaveRect.x + rewardLeaveRect.width * 0.5, rewardLeaveRect.y + 27, 14, COLORS.text, "center");
      button(world, rewardLeaveRect.x, rewardLeaveRect.y, rewardLeaveRect.width, rewardLeaveRect.height, "Leave", { action: "leave_reward" });

      if (rewardRerollRect) {
        drawPillButton(ctx, rewardRerollRect, canRewardReroll);
        drawText(ctx, "Reroll", rewardRerollRect.x + rewardRerollRect.width * 0.5, rewardRerollRect.y + 21, 14, COLORS.text, "center");
        drawText(
          ctx,
          `$${rewardRerollCost}`,
          rewardRerollRect.x + rewardRerollRect.width * 0.5,
          rewardRerollRect.y + 37,
          12,
          canRewardReroll ? COLORS.warning : COLORS.textDim,
          "center",
        );
        button(world, rewardRerollRect.x, rewardRerollRect.y, rewardRerollRect.width, rewardRerollRect.height, "Reroll", { action: "reroll_reward" });
      }
    }

    if (!(drag && drag.sourceKind === "node" && drag.active)) {
      for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
        for (let lane = 0; lane < LANE_COUNT; lane += 1) {
          const target = { layer, lane };
          const valid = pending && canDropUpgradeOnNode(network, pending, target);
          if (!valid) {
            continue;
          }
          const x = laneCenterX(layout, lane);
          const y = layerY(layer);
          const hover = drag && drag.hoverTarget && drag.hoverTarget.target.layer === layer && drag.hoverTarget.target.lane === lane;
          ctx.strokeStyle = hover ? "rgba(89,245,214,0.58)" : "rgba(89,245,214,0.22)";
          ctx.lineWidth = hover ? 2.2 : 1.2;
          ctx.beginPath();
          ctx.arc(x, y, layout.cell * 1.18, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    drawNodeDragTargets(ctx, layout, network, drag);

    if (visual && drag && drag.active && drag.sourceKind !== "node") {
      ctx.save();
      ctx.translate(dragX, dragY + Math.sin(t * 6.4) * (drag && drag.active ? 0 : 4));
      ctx.rotate(drag && drag.active ? 0.06 : -0.02);
      ctx.globalAlpha = drag && drag.active ? 0.94 : 0.82;
      drawUpgradePreview(ctx, visual, 0, 0, 22);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    return;
  }

  if (phase.name === "reward_target" || phase.name === "shop_target") {
    const pending = ui.pendingUpgrade;
    drawNodeDragTargets(ctx, layout, network, ui.drag);
    drawText(ctx, "Select Neuron", layout.width / 2, layout.height * 0.16, 30, COLORS.text, "center");
    drawText(ctx, pending.upgrade.name, layout.width / 2, layout.height * 0.21, 18, COLORS.energy, "center");
    drawText(ctx, "Choose the neuron that receives this upgrade.", layout.width / 2, layout.height * 0.25, 15, COLORS.textDim, "center");

    const layerY = (layer) => networkLayerY(layout, layer);
    const bounds = networkLayerBounds(layout);

    ctx.fillStyle = "rgba(17, 23, 30, 0.22)";
    pathRoundedRect(ctx, layout.gridX - 16, bounds.top - 38, layout.gridWidth + 32, bounds.bottom - bounds.top + 92, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(246,248,251,0.08)";
    ctx.lineWidth = 1;
    pathRoundedRect(ctx, layout.gridX - 16, bounds.top - 38, layout.gridWidth + 32, bounds.bottom - bounds.top + 92, 18);
    ctx.stroke();

    for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        const target = { layer, lane };
        const valid = canDropUpgradeOnNode(network, pending, target);
        const x = laneCenterX(layout, lane);
        const y = layerY(layer);
        const node = renderNodeState(world, layer, lane);
        const radius = layout.cell * 0.76;
        ctx.fillStyle = valid ? "rgba(89,245,214,0.12)" : "rgba(255,255,255,0.04)";
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.4, 0, Math.PI * 2);
        ctx.fill();
        drawNeuronNode(ctx, x, y, radius, node, valid ? 0.18 : 0, valid);
        if (nodeStats(node) > 0) {
          drawText(ctx, `${nodeStats(node)}`, x, y + radius + 14, 11, COLORS.textDim, "center");
        }
        if (valid) {
          neuronButton(world, x, y, target, layout.cell);
        }
      }
    }

    drawButton(ctx, { x: layout.width / 2 - 78, y: layout.height - 96, width: 156, height: 56 }, true);
    drawText(ctx, "Cancel", layout.width / 2, layout.height - 61, 18, COLORS.text, "center");
    button(world, layout.width / 2 - 78, layout.height - 96, 156, 56, "Cancel", {
      action: phase.name === "shop_target" ? "cancel_shop_target" : "cancel_reward_target",
    });
    return;
  }

  if (phase.name === "doors") {
    drawText(ctx, "Choose Next Room", layout.width / 2, layout.height * 0.2, 30, COLORS.text, "center");
    drawText(ctx, "Combat grows the run. Shop spends cash. Camp restores HP.", layout.width / 2, layout.height * 0.25, 16, COLORS.textDim, "center");
    const cards = cardLayout(world, ui.roomOptions.length);
    ui.roomOptions.forEach((roomType, index) => {
      const x = cards.x + index * (cards.width + cards.gap);
      const y = cards.y;
      drawButton(ctx, { x, y, width: cards.width, height: 120 }, roomType === "elite");
      drawRoomRouteIcon(ctx, roomType, x + cards.width * 0.5, y + 34, 24);
      drawText(ctx, formatRoomName(roomType), x + cards.width / 2, y + 66, 22, COLORS.text, "center");
      drawText(
        ctx,
        roomType === "elite"
          ? "One giant spider. If it reaches the core, the run ends."
          : roomType === "shop"
            ? "Spend money on upgrades"
            : roomType === "camp"
              ? "Choose heal or neuron upgrade"
              : "Standard wave",
        x + cards.width / 2,
        y + 94,
        14,
        COLORS.textDim,
        "center",
      );
      button(world, x, y, cards.width, 120, formatRoomName(roomType), { roomType });
    });
    return;
  }

  if (phase.name === "map") {
    const currentNode = mapNodeById(run, run.currentMapNodeId);
    drawText(
      ctx,
      currentNode && currentNode.roomType !== "base" ? `Current: ${formatRoomName(currentNode.roomType)}` : "Current: Base",
      layout.width * 0.5,
      layout.height - 32,
      14,
      COLORS.textDim,
      "center",
    );
    return;
  }

  if (phase.name === "shop") {
    const cards = shopItemRects(layout, ui.shopStock.length);
    const controls = shopControlRects(layout, ui.shopStock.length);
    const compactShop = compactShopLayout(layout);
    const drag = ui.drag;
    const pending = ui.pendingUpgrade;
    const visual = pending ? pending.upgrade : null;
    const cancelRect = controls.cancel;
    const rerollRect = controls.reroll;
    const rerollCost = ui.rerollCost && typeof ui.rerollCost.shop === "number" ? ui.rerollCost.shop : rerollCostFor("shop", 0);
    const canShopReroll = world.resources.run.money >= rerollCost;
    const controlsAlpha = drag && drag.active ? 0.24 : 1;
    const layerY = (layer) => networkLayerY(layout, layer);

    if (compactShop) {
      const tray = {
        x: layout.width * 0.06,
        y: cards[0].y - 10,
        width: layout.width * 0.88,
        height: cards[cards.length - 1].y + cards[cards.length - 1].height - cards[0].y + 20,
      };
      ctx.fillStyle = "rgba(17, 23, 30, 0.16)";
      pathRoundedRect(ctx, tray.x, tray.y, tray.width, tray.height, 20);
      ctx.fill();
      ctx.strokeStyle = "rgba(246,248,251,0.08)";
      ctx.lineWidth = 1;
      pathRoundedRect(ctx, tray.x, tray.y, tray.width, tray.height, 20);
      ctx.stroke();
    } else {
      drawText(ctx, "Field Shop", layout.width / 2, layout.height * 0.15, 30, COLORS.text, "center");
    }

    ui.shopStock.forEach((item, index) => {
      const rect = cards[index];
      const x = rect.x;
      const y = rect.y;
      if (compactShop) {
        drawOfferModuleCard(ctx, rect, item, {
          price: item.price,
          sold: item.sold,
          showDescription: false,
        });
      } else {
        drawText(ctx, item.name, x + 14, y + 30, 20, COLORS.text);
        drawText(ctx, item.description, x + 14, y + 70, 14, COLORS.textDim);
        drawText(ctx, item.sold ? "Sold" : `$${item.price}`, x + 14, y + 154, 16, item.sold ? COLORS.textDim : COLORS.warning);
      }
      if (!item.sold) {
        button(world, x, y, rect.width, rect.height, item.name, { upgrade: item, price: item.price, item });
      }
    });

    drawNodeDragTargets(ctx, layout, network, drag);

    if (visual && drag && drag.active && drag.sourceKind !== "node") {
      for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
        for (let lane = 0; lane < LANE_COUNT; lane += 1) {
          const target = { layer, lane };
          const valid = canDropUpgradeOnNode(network, pending, target);
          if (!valid) {
            continue;
          }
          const x = laneCenterX(layout, lane);
          const y = layerY(layer);
          const hover = drag.hoverTarget && drag.hoverTarget.target.layer === layer && drag.hoverTarget.target.lane === lane;
          ctx.strokeStyle = hover ? "rgba(89,245,214,0.58)" : "rgba(89,245,214,0.22)";
          ctx.lineWidth = hover ? 2.2 : 1.2;
          ctx.beginPath();
          ctx.arc(x, y, layout.cell * 1.18, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.save();
      ctx.translate(drag.hoverTarget ? drag.hoverTarget.x : drag.x, drag.hoverTarget ? drag.hoverTarget.y : drag.y);
      ctx.rotate(0.06);
      ctx.globalAlpha = 0.94;
      drawUpgradePreview(ctx, visual, 0, 0, 22);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.28;
      drawButton(ctx, cancelRect, true);
      ctx.restore();
      drawText(ctx, "Cancel", cancelRect.x + cancelRect.width * 0.5, cancelRect.y + 36, 18, "rgba(246,248,251,0.62)", "center");
      button(world, cancelRect.x, cancelRect.y, cancelRect.width, cancelRect.height, "Cancel", { action: "cancel_shop_drag" });
    }

    ctx.save();
    ctx.globalAlpha = controlsAlpha;
    drawPillButton(ctx, controls.repair, true);
    drawText(ctx, compactShop ? "Repair" : "Repair +2 HP", controls.repair.x + controls.repair.width * 0.5, controls.repair.y + (compactShop ? 18 : 26), compactShop ? 14 : 16, COLORS.text, "center");
    drawText(ctx, "$12", controls.repair.x + controls.repair.width * 0.5, controls.repair.y + (compactShop ? 33 : 44), 12, COLORS.warning, "center");
    ctx.restore();
    button(world, controls.repair.x, controls.repair.y, controls.repair.width, controls.repair.height, "Repair", { action: "repair" });

    if (!(drag && drag.active)) {
      ctx.save();
      ctx.globalAlpha = controlsAlpha;
      drawPillButton(ctx, rerollRect, canShopReroll);
      drawText(ctx, "Reroll", rerollRect.x + rerollRect.width * 0.5, rerollRect.y + (compactShop ? 18 : 24), compactShop ? 14 : 16, COLORS.text, "center");
      drawText(ctx, `$${rerollCost}`, rerollRect.x + rerollRect.width * 0.5, rerollRect.y + (compactShop ? 33 : 42), 12, canShopReroll ? COLORS.warning : COLORS.textDim, "center");
      ctx.restore();
      button(world, rerollRect.x, rerollRect.y, rerollRect.width, rerollRect.height, "Reroll", { action: "reroll_shop" });
    }

    ctx.save();
    ctx.globalAlpha = controlsAlpha;
    drawPillButton(ctx, controls.leave, true);
    drawText(ctx, compactShop ? "Leave" : "Leave Shop", controls.leave.x + controls.leave.width * 0.5, controls.leave.y + (compactShop ? 26 : 36), compactShop ? 14 : 18, COLORS.text, "center");
    ctx.restore();
    button(world, controls.leave.x, controls.leave.y, controls.leave.width, controls.leave.height, "Leave", { action: "leave" });
    return;
  }

  if (phase.name === "camp") {
    const canHeal = run.baseHp < run.maxBaseHp;
    const healedHp = Math.min(run.maxBaseHp, run.baseHp + 3);
    const panel = {
      x: layout.width * 0.08,
      y: layout.height * 0.14,
      width: layout.width * 0.84,
      height: 348,
    };
    const healRect = {
      x: panel.x + 16,
      y: panel.y + 126,
      width: panel.width - 32,
      height: 92,
    };
    const upgradeRect = {
      x: panel.x + 16,
      y: panel.y + 230,
      width: panel.width - 32,
      height: 92,
    };
    ctx.fillStyle = "rgba(18, 23, 31, 0.9)";
    pathRoundedRect(ctx, panel.x, panel.y, panel.width, panel.height, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(246,248,251,0.12)";
    ctx.lineWidth = 1.2;
    pathRoundedRect(ctx, panel.x, panel.y, panel.width, panel.height, 18);
    ctx.stroke();
    drawText(ctx, "Camp", layout.width / 2, panel.y + 34, 30, COLORS.text, "center");
    drawText(ctx, "Choose one benefit before returning to the map.", layout.width / 2, panel.y + 64, 16, COLORS.textDim, "center");

    drawCampChoicePanel(ctx, healRect, {
      title: "Heal Base",
      subtitle: canHeal ? `${run.baseHp}/${run.maxBaseHp} -> ${healedHp}/${run.maxBaseHp}` : "Base already full",
      detail: canHeal ? "Restore structural integrity and keep the current route alive longer." : "Healing is unavailable because the base is already at maximum HP.",
      accent: COLORS.warning,
      icon: "heal",
      active: canHeal,
    });
    if (canHeal) {
      button(world, healRect.x, healRect.y, healRect.width, healRect.height, "Heal", { action: "camp_heal" });
    }

    drawCampChoicePanel(ctx, upgradeRect, {
      title: "Upgrade Neuron",
      subtitle: "Choose one node to empower",
      detail: "Select any neuron in the lattice and permanently strengthen its white route damage.",
      accent: COLORS.energy,
      icon: "upgrade",
      active: true,
    });
    button(world, upgradeRect.x, upgradeRect.y, upgradeRect.width, upgradeRect.height, "Upgrade", { action: "camp_upgrade" });
    return;
  }

  if (phase.name === "camp_target") {
    const { headerRect, cancelRect } = campTargetLayout(layout);

    ctx.fillStyle = "rgba(16, 20, 26, 0.08)";
    ctx.fillRect(0, 0, layout.width, layout.height);
    drawNodeDragTargets(ctx, layout, network, ui.drag);

    ctx.fillStyle = "rgba(17, 23, 30, 0.32)";
    pathRoundedRect(ctx, headerRect.x, headerRect.y, headerRect.width, headerRect.height, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(246,248,251,0.08)";
    ctx.lineWidth = 1;
    pathRoundedRect(ctx, headerRect.x, headerRect.y, headerRect.width, headerRect.height, 20);
    ctx.stroke();
    drawPillButton(ctx, cancelRect, true);
    drawText(ctx, "Cancel", cancelRect.x + cancelRect.width * 0.5, cancelRect.y + 25, 15, COLORS.text, "center");
    button(world, cancelRect.x, cancelRect.y, cancelRect.width, cancelRect.height, "Cancel", { action: "cancel_camp_target" });

    drawText(ctx, "Empower Neuron", layout.width * 0.5, headerRect.y + 74, 28, COLORS.text, "center");
    drawText(ctx, "Choose one neuron to empower.", layout.width * 0.5, headerRect.y + 98, 15, COLORS.textDim, "center");

    for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        const target = { layer, lane };
        const x = laneCenterX(layout, lane);
        const y = networkLayerY(layout, layer);
        ctx.strokeStyle = "rgba(89,245,214,0.18)";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(x, y, layout.cell * 1.08, 0, Math.PI * 2);
        ctx.stroke();
        neuronButton(world, x, y, target, layout.cell);
      }
    }
    return;
  }

  if (phase.name === "gameover") {
    drawText(ctx, "Base Lost", layout.width / 2, layout.height * 0.32, 34, COLORS.threat, "center");
    drawText(ctx, `Score ${run.score}`, layout.width / 2, layout.height * 0.38, 18, COLORS.text, "center");
    drawText(ctx, "Tap to restart the run.", layout.width / 2, layout.height * 0.43, 16, COLORS.textDim, "center");
    button(world, 0, 0, layout.width, layout.height, "Restart");
  }

}

export function renderSystem(world) {
  const { ctx, layout, canvas, dpr } = world.resources;
  if (!layout || !layout.width || !layout.height) {
    return;
  }
  if (world.resources.lowPowerMode && world.resources.frameIndex % 2 === 1) {
    return;
  }

  world.resources.ui.buttons = [];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground(ctx, layout.width, layout.height);
  if (world.resources.phase.name === "map") {
    drawMapScene(world, ctx);
  } else {
    drawCombatScene(world, ctx);
  }
  drawOverlay(world, ctx);
  drawLegendaryInspectCard(world, ctx);
  drawNeuronInspectCard(world, ctx);
}

export function resizeSystem(world) {
  const { canvas, dpr } = world.resources;
  const logicalWidth = Math.floor(window.innerWidth);
  const logicalHeight = Math.floor(window.innerHeight);
  const width = Math.floor(logicalWidth * dpr);
  const height = Math.floor(logicalHeight * dpr);
  if (canvas.width !== width || canvas.height !== height || canvas.style.width !== `${logicalWidth}px` || canvas.style.height !== `${logicalHeight}px`) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
  }
  world.resources.layout = buildLayout(logicalWidth, logicalHeight);
}

export function resetRun(world, restoredProgress = null) {
  world.entities.clear();
  world.components.clear();
  world.resources.network = createNetworkState();
  world.resources.phase = { name: "map" };
  world.resources.run = {
    wave: 0,
    currentRoomType: "combat",
    enemiesRemaining: 0,
    spawnTimer: 0,
    waveClearDelay: 0,
    pendingLegendaryOpening: false,
    legendaryPerks: [],
    legendaryBattle: {
      fireFromFreezeBonus: 0,
      curseFromSlowBonus: 0,
    },
    baseHp: 14,
    maxBaseHp: 14,
    shield: 0,
    lastShield: 0,
    shieldVisual: 0,
    shieldAppearPulse: 0,
    baseHitFlash: 0,
    shieldHitFlash: 0,
    moneyPickupFlash: 0,
    money: 18,
    score: 0,
    currentBranchTheme: "spider",
    completedBranches: [],
    completedBranchPaths: [],
    hasOpeningUpgrade: false,
    mapNodes: [],
    nextMapNodeId: 0,
    currentMapNodeId: 0,
    activeMapNodeId: null,
    pendingBranchComplete: false,
    mapCamera: { x: 0, y: 0, dragging: false, lastPointerX: 0, lastPointerY: 0 },
  };
  world.resources.ui = {
    buttons: [],
    cards: [],
    roomOptions: [],
    shopStock: [],
    rerollState: { reward: 0, shop: 0 },
    rerollCost: { reward: rerollCostFor("reward", 0), shop: rerollCostFor("shop", 0) },
    pendingUpgrade: null,
    stagedReward: null,
    legendaryDrop: null,
    legendaryInspect: null,
    neuronInspect: null,
    rewardIntro: { showVictory: false, timer: 0 },
  };
  world.resources.turret = {
    angle: -Math.PI / 2,
    targetAngle: -Math.PI / 2,
    cooldown: 0,
    chargeVisual: 0,
    chargeCycle: 0,
    chargeBurst: 0,
    coreFlash: 0,
    muzzleFlash: 0,
    recoil: 0,
  };
  const progress = restoredProgress || readMetaProgress();
  if (progress) {
    applyMetaSnapshot(world, progress);
  }
  initializeMap(world);
  openMap(world);
}

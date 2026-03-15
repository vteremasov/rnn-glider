import { BOSS, BULLET, ENEMY_BULLET, GAME_HEIGHT, GAME_WIDTH, HEALTH_PICKUP, LAYOUT, MINIBOSS, SHIP } from "./constants.js";
import { createBoss, createBullet, createEnemy, createEnemyBullet, createMiniBoss, resetGame } from "./spawners.js";
import {
  BASE_ENGINE_ENERGY,
  BURN_DAMAGE_FACTOR,
  CURSE_DAMAGE_FACTOR,
  FREEZE_DURATION,
  PUSHBACK_BASE,
  PUSHBACK_PER_DAMAGE,
  SLOW_DURATION,
  SLOW_FACTOR,
  SOURCE_ROW_ENERGY,
  SPLIT_ANGLE_DEGREES,
  applyUpgradeToSelectedRow,
  beginSpecialUpgrade,
  beginUpgrade,
  createPreviewNetwork,
  countCompletedColumns,
  hasAvailableUpgrade,
  isNetworkComplete,
  resolveWeaponOutputs,
} from "./weapon-network.js";

const BURN_TICKS = 5;
const CURSE_TICKS = 6;
const TOOLTIP_WIDTH = 286;

function getSlotLocalBonus(slot) {
  const localAmp = (slot?.damageMultiplier ?? 1) * (slot?.specialMultiplier ?? 1);
  const localFlat = slot?.filled ? 2 : 0;
  return { localAmp, localFlat };
}

function getEffectSummary(slot, buffs) {
  const effects = [...buffs];
  if (effects.length === 0) {
    return "None";
  }
  return effects.join(", ");
}

function circlesOverlap(a, ra, b, rb) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const radii = ra + rb;
  return dx * dx + dy * dy <= radii * radii;
}

function isPaused(world) {
  return (
    world.resources.gameOver ||
    world.resources.weaponNetwork.upgrade.active ||
    (world.resources.bossDefeated && !world.resources.pendingSpecialUpgrade)
  );
}

function clearDirectionalInput(world) {
  world.resources.input.w = false;
  world.resources.input.a = false;
  world.resources.input.s = false;
  world.resources.input.d = false;
}

function mixColors(colors, fallback) {
  const validColors = colors.filter(Boolean);
  if (validColors.length === 0) {
    return fallback;
  }

  let red = 0;
  let green = 0;
  let blue = 0;
  for (const color of validColors) {
    red += Number.parseInt(color.slice(1, 3), 16);
    green += Number.parseInt(color.slice(3, 5), 16);
    blue += Number.parseInt(color.slice(5, 7), 16);
  }

  const count = validColors.length;
  const channels = [red, green, blue].map((value) =>
    Math.max(0, Math.min(255, Math.round(value / count))),
  );

  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function bulletColor(stats) {
  const colors = stats.buffColors.filter(Boolean);
  if (colors.length === 0) {
    return "#dff9ff";
  }

  return mixColors(colors, "#dff9ff");
}

function createDamageText(world, x, y, damage) {
  const entity = world.createEntity();
  const magnitude = Math.max(1, Math.abs(damage));
  const size = Math.min(40, 16 + Math.sqrt(magnitude) * 3.8);
  const riseSpeed = Math.max(-72, -30 - Math.sqrt(magnitude) * 6.5);
  world.addComponent(entity, "Transform", { x, y });
  world.addComponent(entity, "DamageText", {
    value: `-${Math.round(magnitude)}`,
    life: 0.9,
    totalLife: 0.9,
    size,
  });
  world.addComponent(entity, "Velocity", { x: 0, y: riseSpeed });
  world.addComponent(entity, "Render", { type: "damageText", color: "#ffe6e6" });
  return entity;
}

function createHealthPickup(world, x, y) {
  const entity = world.createEntity();
  world.addComponent(entity, "Transform", { x, y });
  world.addComponent(entity, "Velocity", { x: 0, y: HEALTH_PICKUP.driftSpeed });
  world.addComponent(entity, "CircleCollider", { radius: HEALTH_PICKUP.radius });
  world.addComponent(entity, "HealthPickup", { heal: HEALTH_PICKUP.heal });
  world.addComponent(entity, "Render", { type: "healthPickup", color: "#9cffb2" });
  return entity;
}

function bounceBulletOffWalls(transform, body, bullet) {
  if (!bullet?.ricochet || (bullet.bouncesLeft ?? 0) <= 0) {
    return false;
  }

  const battleLeft = LAYOUT.sidebarWidth + LAYOUT.battlePadding;
  const battleRight = GAME_WIDTH - LAYOUT.battlePadding;
  let bounced = false;

  if (transform.x - body.radius <= battleLeft) {
    transform.x = battleLeft + body.radius + 1;
    bullet.dirX = Math.abs(bullet.dirX || 0.24);
    bounced = true;
  } else if (transform.x + body.radius >= battleRight) {
    transform.x = battleRight - body.radius - 1;
    bullet.dirX = -Math.abs(bullet.dirX || 0.24);
    bounced = true;
  }

  if (transform.y - body.radius <= 0) {
    transform.y = body.radius + 1;
    bullet.dirY = Math.abs(bullet.dirY || 1);
    bounced = true;
  } else if (transform.y + body.radius >= GAME_HEIGHT) {
    transform.y = GAME_HEIGHT - body.radius - 1;
    bullet.dirY = -Math.abs(bullet.dirY || 1);
    bounced = true;
  }

  if (bounced) {
    const length = Math.hypot(bullet.dirX, bullet.dirY) || 1;
    bullet.dirX /= length;
    bullet.dirY /= length;
    bullet.bouncesLeft -= 1;
    bullet.damage *= 0.5;
  }

  return bounced;
}

function bounceBulletOffEnemy(bulletPos, bulletBody, bullet, enemyPos, enemyBody) {
  if (!bullet?.ricochet || (bullet.bouncesLeft ?? 0) <= 0) {
    return false;
  }

  const dx = bulletPos.x - enemyPos.x;
  const dy = bulletPos.y - enemyPos.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = dx / length;
  const normalY = dy / length;
  const incomingX = bullet.dirX ?? 0;
  const incomingY = bullet.dirY ?? -1;
  const dot = incomingX * normalX + incomingY * normalY;

  bullet.dirX = incomingX - 2 * dot * normalX;
  bullet.dirY = incomingY - 2 * dot * normalY;
  const nextLength = Math.hypot(bullet.dirX, bullet.dirY) || 1;
  bullet.dirX /= nextLength;
  bullet.dirY /= nextLength;
  bulletPos.x = enemyPos.x + normalX * (enemyBody.radius + bulletBody.radius + 6);
  bulletPos.y = enemyPos.y + normalY * (enemyBody.radius + bulletBody.radius + 6);
  bullet.bouncesLeft -= 1;
  bullet.damage *= 0.5;
  return true;
}

function spawnSplitBullets(world, bullet, x, y) {
  if (!bullet?.split || (bullet.splitRemaining ?? 0) <= 0) {
    return;
  }

  const baseAngle = Math.atan2(bullet.dirY ?? -1, bullet.dirX ?? 0);
  const splitAngle = (SPLIT_ANGLE_DEGREES * Math.PI) / 180;
  for (const angleOffset of [-splitAngle, splitAngle]) {
    const angle = baseAngle + angleOffset;
    createBullet(world, x, y, {
      damage: bullet.damage * 0.5,
      fire: bullet.fire,
      curse: bullet.curse,
      slow: bullet.slow,
      freeze: bullet.freeze,
      pushback: bullet.pushback,
      penetration: bullet.penetration,
      split: bullet.split,
      ricochet: bullet.ricochet,
      splitRemaining: Math.max(0, (bullet.splitRemaining ?? 1) - 1),
      bouncesLeft: bullet.bouncesLeft ?? 0,
      buffColors: bullet.buffColors,
      row: bullet.row,
      color: mixColors(bullet.buffColors ?? [], "#dff9ff"),
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
    });
  }
}

function damageEnemy(world, enemyEntity, damage) {
  if (!world.entities.has(enemyEntity)) {
    return true;
  }

  const transform = world.getComponent(enemyEntity, "Transform");
  createDamageText(
    world,
    transform.x + (Math.random() * 18 - 9),
    transform.y - 18 + (Math.random() * 10 - 5),
    damage,
  );

  const enemy = world.getComponent(enemyEntity, "Enemy");
  enemy.hp -= damage;

  if (enemy.hp <= 0) {
    const minibossesDefeated = world.resources.minibossesDefeated ?? 0;
    const scoreMultiplier = enemy.isMiniBoss || enemy.isBoss ? 0 : 0.85 ** minibossesDefeated;

    if (enemy.isBoss) {
      world.resources.bossDefeated = true;
      world.resources.pendingSpecialUpgrade = true;
    }
    if (enemy.isMiniBoss) {
      world.resources.minibossesDefeated = Math.max(
        world.resources.minibossesDefeated ?? 0,
        enemy.miniBossTier ?? 0,
      );
      world.resources.activeMinibossTier = 0;
      world.resources.pendingSpecialUpgrade = true;
    }
    if (!enemy.isBoss && !enemy.isMiniBoss && Math.random() < HEALTH_PICKUP.dropChance) {
      createHealthPickup(world, transform.x, transform.y);
    }
    world.resources.score += Math.round(enemy.maxHp * scoreMultiplier);
    world.destroyEntity(enemyEntity);
    return true;
  }

  return false;
}

function enemyDebuffColors(enemy) {
  const colors = [];
  if (enemy.burnTicks > 0) {
    colors.push("#ff8e72");
  }
  if (enemy.curseTicks > 0) {
    colors.push("#9a63ff");
  }
  if ((enemy.freezeTimer ?? 0) > 0) {
    colors.push("#d8f4ff");
  }
  if ((enemy.slowTimer ?? 0) > 0) {
    colors.push("#7fd9ff");
  }
  return colors;
}

function drawShip(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#a7d8ff";
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(-24, 18);
  ctx.lineTo(-10, 10);
  ctx.lineTo(0, 24);
  ctx.lineTo(10, 10);
  ctx.lineTo(24, 18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#61b3ff";
  for (const offsetX of SHIP.gunOffsetsY) {
    ctx.fillRect(offsetX - 2.5, -38, 5, 12);
  }
  ctx.restore();
}

function drawEnemyShape(ctx, shape, x, y, radius) {
  ctx.beginPath();

  if (shape === "triangle") {
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x - radius * 0.9, y + radius * 0.8);
    ctx.lineTo(x + radius * 0.9, y + radius * 0.8);
    ctx.closePath();
    return;
  }

  if (shape === "square") {
    ctx.rect(x - radius * 0.82, y - radius * 0.82, radius * 1.64, radius * 1.64);
    return;
  }

  if (shape === "diamond") {
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x - radius * 0.92, y);
    ctx.lineTo(x, y + radius);
    ctx.lineTo(x + radius * 0.92, y);
    ctx.closePath();
    return;
  }

  if (shape === "hex") {
    for (let index = 0; index < 6; index += 1) {
      const angle = -Math.PI / 2 + index * (Math.PI / 3);
      const pointX = x + Math.cos(angle) * radius;
      const pointY = y + Math.sin(angle) * radius;
      if (index === 0) {
        ctx.moveTo(pointX, pointY);
      } else {
        ctx.lineTo(pointX, pointY);
      }
    }
    ctx.closePath();
    return;
  }

  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

function drawGunChargeEffects(ctx, shipX, shipY, ship, outputs, signalTime) {
  if (!ship || !outputs) {
    return;
  }

  const activeOutputs = outputs.filter(Boolean);
  if (activeOutputs.length === 0) {
    return;
  }

  const chargeProgress = Math.min(1, ship.fireTimer / Math.max(0.001, ship.fireInterval));
  const queuedShots = ship.pendingShots?.length ?? 0;
  const x = shipX;
  const conduitStartY = shipY + 4;
  const conduitEndY = shipY - SHIP.muzzleOffsetX + 6;
  const color = mixColors(
    activeOutputs.flatMap((output) => output.buffColors ?? []),
    bulletColor(activeOutputs[0]),
  );
  const pulseCount = Math.max(3, Math.min(6, activeOutputs.length + queuedShots));

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.18 + chargeProgress * 0.25;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, conduitStartY);
  ctx.lineTo(x, conduitEndY);
  ctx.stroke();

  for (let pulseIndex = 0; pulseIndex < pulseCount; pulseIndex += 1) {
    const localProgress = Math.max(0, Math.min(1, chargeProgress * 1.35 - pulseIndex * 0.14));
    if (localProgress <= 0) {
      continue;
    }

    const eased = localProgress * localProgress;
    const y = conduitStartY + (conduitEndY - conduitStartY) * eased;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3 + localProgress * 0.45;
    ctx.beginPath();
    ctx.arc(x, y, 2.8 + localProgress * 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const muzzleY = shipY - SHIP.muzzleOffsetX;
  const muzzlePulse = 0.82 + Math.sin(signalTime * 7) * 0.18;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.28 + chargeProgress * 0.38;
  ctx.beginPath();
  ctx.arc(x, muzzleY, 6 + chargeProgress * (6 + queuedShots) * muzzlePulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || current === "") {
      current = next;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function pushUniqueValues(target, values) {
  for (const value of values) {
    if (value && !target.includes(value)) {
      target.push(value);
    }
  }
}

function mergeCycleOutputs(flows, rowCount) {
  return Array.from({ length: rowCount }, (_, row) => {
    const outputs = flows.map((flow) => flow.outputs[row]).filter(Boolean);
    if (outputs.length === 0) {
      return null;
    }

    const merged = {
      energy: 0,
      damage: 0,
      flatDamage: 0,
      fire: false,
      curse: false,
      slow: false,
      freeze: false,
      pushback: false,
      penetration: false,
      split: false,
      ricochet: false,
      buffNames: [],
      buffShorts: [],
      buffColors: [],
    };

    for (const output of outputs) {
      merged.energy = Math.max(merged.energy, output.energy ?? 0);
      merged.damage = Math.max(merged.damage, output.damage ?? 0);
      merged.flatDamage = Math.max(merged.flatDamage, output.flatDamage ?? 0);
      merged.fire = merged.fire || Boolean(output.fire);
      merged.curse = merged.curse || Boolean(output.curse);
      merged.slow = merged.slow || Boolean(output.slow);
      merged.freeze = merged.freeze || Boolean(output.freeze);
      merged.pushback = merged.pushback || Boolean(output.pushback);
      merged.penetration = merged.penetration || Boolean(output.penetration);
      merged.split = merged.split || Boolean(output.split);
      merged.ricochet = merged.ricochet || Boolean(output.ricochet);
      pushUniqueValues(merged.buffNames, output.buffNames ?? []);
      pushUniqueValues(merged.buffShorts, output.buffShorts ?? []);
      pushUniqueValues(merged.buffColors, output.buffColors ?? []);
    }

    return merged;
  });
}

function mergeFlowSet(flows, network) {
  const nodes = Array.from({ length: network.columns.length }, () =>
    Array.from({ length: network.rows }, () => ({
      active: false,
      energy: 0,
      amp: 0,
      flatDamage: 0,
      damage: 0,
      buffNames: [],
      buffShorts: [],
      buffColors: [],
    })),
  );
  const connectionMap = new Map();

  for (const flow of flows) {
    for (let columnIndex = 0; columnIndex < flow.nodes.length; columnIndex += 1) {
      for (let row = 0; row < flow.nodes[columnIndex].length; row += 1) {
        const sourceNode = flow.nodes[columnIndex][row];
        const targetNode = nodes[columnIndex][row];
        if (!sourceNode.active) {
          continue;
        }

        targetNode.active = true;
        targetNode.energy = Math.max(targetNode.energy, sourceNode.energy ?? 0);
        targetNode.amp = Math.max(targetNode.amp, sourceNode.amp ?? 0);
        targetNode.flatDamage = Math.max(targetNode.flatDamage, sourceNode.flatDamage ?? 0);
        targetNode.damage = Math.max(targetNode.damage, sourceNode.damage ?? 0);
        pushUniqueValues(targetNode.buffNames, sourceNode.buffNames ?? []);
        pushUniqueValues(targetNode.buffShorts, sourceNode.buffShorts ?? []);
        pushUniqueValues(targetNode.buffColors, sourceNode.buffColors ?? []);
      }
    }

    for (const connection of flow.connections) {
      const existing = connectionMap.get(connection.id);
      if (!existing) {
        connectionMap.set(connection.id, {
          ...connection,
          active: Boolean(connection.active),
          buffColors: [...(connection.buffColors ?? [])],
        });
        continue;
      }

      existing.active = existing.active || Boolean(connection.active);
      pushUniqueValues(existing.buffColors, connection.buffColors ?? []);
    }
  }

  return {
    nodes,
    connections: [...connectionMap.values()],
    outputs: mergeCycleOutputs(flows, network.rows),
  };
}

function resolveFocusedWeaponFlow(network, focusedNode) {
  const candidateFlows = Array.from({ length: network.rows }, (_, dispatchRow) =>
    resolveWeaponOutputs(network, { dispatchRow }),
  );
  const matchingFlows = candidateFlows.filter((flow) =>
    flow.nodes[focusedNode.columnIndex]?.[focusedNode.row]?.active,
  );

  if (matchingFlows.length === 0) {
    return {
      ...resolveWeaponOutputs(network, {
        injectedNode: focusedNode,
      }),
      projected: true,
    };
  }

  return {
    ...mergeFlowSet(matchingFlows, network),
    projected: false,
  };
}

function getDisplayedDispatchState(world, network = world.resources.weaponNetwork) {
  const shipEntity = world.query("Ship")[0];
  const ship = shipEntity ? world.getComponent(shipEntity, "Ship") : null;
  const pendingShots = ship?.pendingShots?.length ?? 0;
  const activeRow = pendingShots > 0 ? (ship.activeVolleyRow ?? 0) : (world.resources.dispatchRow ?? 0);
  const fireInterval = Math.max(0.001, ship?.fireInterval ?? SHIP.fireInterval);
  const burstSpacing = Math.max(0.001, ship?.burstSpacing ?? SHIP.burstSpacing);
  const signalProgress = pendingShots > 0
    ? Math.max(0.25, 1 - (ship?.burstTimer ?? 0) / burstSpacing)
    : Math.min(1, (ship?.fireTimer ?? 0) / fireInterval);

  return {
    dispatchRow: ((activeRow % network.rows) + network.rows) % network.rows,
    signalProgress,
  };
}

function resolveDisplayedWeaponFlow(world, network = world.resources.weaponNetwork) {
  const displayState = getDisplayedDispatchState(world, network);
  const flow = resolveWeaponOutputs(network, { dispatchRow: displayState.dispatchRow });
  return {
    ...flow,
    pulseConnections: flow.connections
      .filter((connection) => connection.active)
      .map((connection) => ({
        ...connection,
        phaseOffset: 0,
      })),
    signalProgress: displayState.signalProgress,
    dispatchRow: displayState.dispatchRow,
  };
}

function buildFlowChangeSet(baseFlow, previewFlow) {
  const changedNodeKeys = new Set();
  const changedConnectionIds = new Set();

  for (let columnIndex = 0; columnIndex < previewFlow.nodes.length; columnIndex += 1) {
    const previewColumn = previewFlow.nodes[columnIndex];
    const baseColumn = baseFlow.nodes[columnIndex] ?? [];
    for (let row = 0; row < previewColumn.length; row += 1) {
      const previewNode = previewColumn[row];
      const baseNode = baseColumn[row] ?? { active: false, buffColors: [], buffShorts: [] };
      const previewColors = previewNode.buffColors.join(",");
      const baseColors = baseNode.buffColors.join(",");
      if (previewNode.active !== baseNode.active || previewColors !== baseColors) {
        changedNodeKeys.add(`${columnIndex}:${row}`);
      }
    }
  }

  const baseConnections = new Map(baseFlow.connections.map((connection) => [connection.id, connection]));
  for (const connection of previewFlow.connections) {
    const base = baseConnections.get(connection.id);
    if (!base || base.active !== connection.active || base.buffColors.join(",") !== connection.buffColors.join(",")) {
      changedConnectionIds.add(connection.id);
    }
  }

  return { changedNodeKeys, changedConnectionIds };
}

function drawConnectionStroke(ctx, from, to, color, lineWidth, slotRadius) {
  const sameColumn = Math.abs(from.x - to.x) < 1;
  ctx.beginPath();
  if (sameColumn) {
    const branchX = from.x + slotRadius + 22;
    ctx.moveTo(from.x + slotRadius * 0.7, from.y);
    ctx.bezierCurveTo(branchX, from.y, branchX, to.y, to.x + slotRadius * 0.7, to.y);
  } else {
    ctx.moveTo(from.x + slotRadius + 8, from.y);
    ctx.lineTo(to.x - slotRadius - 8, to.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function getConnectionPulsePoint(from, to, travel, slotRadius) {
  const sameColumn = Math.abs(from.x - to.x) < 1;
  if (!sameColumn) {
    return {
      x: from.x + (to.x - from.x) * travel,
      y: from.y + (to.y - from.y) * travel,
    };
  }

  const startX = from.x + slotRadius * 0.7;
  const startY = from.y;
  const control1X = from.x + slotRadius + 22;
  const control1Y = from.y;
  const control2X = from.x + slotRadius + 22;
  const control2Y = to.y;
  const endX = to.x + slotRadius * 0.7;
  const endY = to.y;
  const inverse = 1 - travel;

  return {
    x:
      inverse ** 3 * startX +
      3 * inverse ** 2 * travel * control1X +
      3 * inverse * travel ** 2 * control2X +
      travel ** 3 * endX,
    y:
      inverse ** 3 * startY +
      3 * inverse ** 2 * travel * control1Y +
      3 * inverse * travel ** 2 * control2Y +
      travel ** 3 * endY,
  };
}

function collectOutgoingRows(slot, row, rowCount) {
  if (!slot) {
    return [];
  }

  const rows = [row];
  if (slot.upLink) {
    rows.push(row - 1);
  }
  if (slot.downLink) {
    rows.push(row + 1);
  }

  return [...new Set(rows)].filter((value) => value >= 0 && value < rowCount);
}

function collectLocalDividerTargets(slot, row, rowCount) {
  if (!slot?.dividerMultiplier) {
    return [];
  }

  return [row - 1, row + 1].filter((value) => value >= 0 && value < rowCount);
}

function collectLocalMergerSources(slot, row, rowCount) {
  if (slot?.mergerMultiplier) {
    return [row - 1, row + 1].filter((value) => value >= 0 && value < rowCount);
  }

  return [];
}

function getHoveredGridNode(nodePositions, hoverPoint, slotRadius) {
  if (!hoverPoint) {
    return null;
  }

  let closest = null;
  let closestDistance = (slotRadius + 8) ** 2;
  for (const [key, point] of nodePositions) {
    const dx = point.x - hoverPoint.x;
    const dy = point.y - hoverPoint.y;
    const distance = dx * dx + dy * dy;
    if (distance > closestDistance) {
      continue;
    }

    closest = key;
    closestDistance = distance;
  }

  if (!closest) {
    return null;
  }

  const [columnIndex, row] = closest.split(":").map(Number);
  return { columnIndex, row };
}

function getRotatedHoverPoint(pointer, translateX, translateY) {
  if (!pointer?.active) {
    return null;
  }

  return {
    x: translateY - pointer.y,
    y: pointer.x - translateX,
  };
}

function drawNodeGlyph(ctx, slot, x, y, slotRadius, strokeColor) {
  if (!slot?.filled) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(1.5, slotRadius * 0.12);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (slot.dividerMultiplier) {
    ctx.beginPath();
    ctx.moveTo(x - slotRadius * 0.18, y);
    ctx.lineTo(x + slotRadius * 0.04, y);
    ctx.lineTo(x + slotRadius * 0.34, y - slotRadius * 0.28);
    ctx.moveTo(x + slotRadius * 0.04, y);
    ctx.lineTo(x + slotRadius * 0.34, y + slotRadius * 0.28);
    ctx.stroke();
  }

  if (slot.mergerMultiplier) {
    ctx.beginPath();
    ctx.moveTo(x - slotRadius * 0.34, y - slotRadius * 0.28);
    ctx.lineTo(x - slotRadius * 0.04, y);
    ctx.lineTo(x + slotRadius * 0.22, y);
    ctx.moveTo(x - slotRadius * 0.34, y + slotRadius * 0.28);
    ctx.lineTo(x - slotRadius * 0.04, y);
    ctx.stroke();
  }

  ctx.restore();
}

function formatBuildSummary(network) {
  const rows = Array.from({ length: network.rows }, (_, row) => {
    const parts = [];
    for (let columnIndex = network.columns.length - 1; columnIndex >= 0; columnIndex -= 1) {
      const slot = network.columns[columnIndex]?.slots[row];
      parts.push(slot?.filled ? slot.buffShort : "...");
    }
    return `R${row + 1}: ${parts.join(" > ")}`;
  });

  return rows;
}

function drawVictoryOverlay(ctx, canvas, world) {
  const network = world.resources.weaponNetwork;
  const flow = resolveDisplayedWeaponFlow(world, network);
  const panelX = 110;
  const panelY = 188;
  const panelWidth = canvas.width - 220;
  const panelHeight = 620;
  const modelPanelWidth = Math.max(640, Math.min(860, panelWidth * 0.58));
  const rightPanelWidth = panelWidth - modelPanelWidth - 22;
  const modelX = panelX + 18;
  const modelY = panelY + 18;
  const modelWidth = modelPanelWidth - 36;
  const modelHeight = panelHeight - 36;
  const modelInset = 10;
  const rightX = modelX + modelPanelWidth + 4;
  const rightY = modelY;
  const hoverInfo = {};
  const modelMetrics = getFittedGridMetrics(network, modelWidth, modelHeight, {
    rowSpacing: 68,
    columnSpacing: 102,
    slotRadius: 24,
    gunOffsetX: 108,
  });

  ctx.fillStyle = "rgba(6, 18, 10, 0.62)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ecfff1";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 38px Trebuchet MS, sans-serif";
  ctx.fillText("BOSS DESTROYED", canvas.width * 0.5, 110);
  ctx.font = "22px Trebuchet MS, sans-serif";
  ctx.fillText("Final build", canvas.width * 0.5, 152);

  ctx.fillStyle = "rgba(8, 14, 30, 0.92)";
  ctx.strokeStyle = "rgba(149, 189, 255, 0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 20);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(10, 18, 34, 0.95)";
  ctx.beginPath();
  ctx.roundRect(modelX, modelY, modelWidth, modelHeight, 18);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(rightX, rightY, rightPanelWidth, modelHeight, 18);
  ctx.fill();

  const victoryModelTranslateX = modelX + 34;
  const victoryModelTranslateY = modelY + modelHeight - 18;
  ctx.save();
  ctx.beginPath();
  ctx.rect(modelX + modelInset, modelY + modelInset, modelWidth - modelInset * 2, modelHeight - modelInset * 2);
  ctx.clip();
  ctx.translate(victoryModelTranslateX, victoryModelTranslateY);
  ctx.rotate(-Math.PI / 2);
  const cycleSpanX =
    network.columns.length * modelMetrics.columnSpacing + 120 + modelMetrics.gunOffsetX;
  const centeredFrontX = modelHeight * 0.5 + (cycleSpanX - modelMetrics.gunOffsetX) * 0.5 - 16;
  drawWeaponGrid(ctx, world, {
    flow,
    focusNetwork: network,
    focusOnHover: true,
    hoverInfoTarget: hoverInfo,
    signalTime: world.resources.signalTime,
    signalProgress: flow.signalProgress,
    frontX: centeredFrontX,
    centerY: modelWidth * 0.5 - 8,
    rowSpacing: modelMetrics.rowSpacing,
    columnSpacing: modelMetrics.columnSpacing,
    slotRadius: modelMetrics.slotRadius,
    lineWidth: 3,
    labelSize: 14,
    buffSize: 11,
    showBuffLabels: true,
    showCoreLabels: false,
    gunOffsetX: modelMetrics.gunOffsetX,
    hoverPoint: getRotatedHoverPoint(
      world.resources.pointer,
      victoryModelTranslateX,
      victoryModelTranslateY,
    ),
  });
  ctx.restore();
  drawNeuronTooltip(ctx, world.resources.pointer, hoverInfo.info);

  const burstOutputs = flow.outputs.filter(Boolean);
  const primaryOutput = burstOutputs[0] ?? null;
  ctx.fillStyle = "#f3f7ff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 24px Trebuchet MS, sans-serif";
  ctx.fillText("Final Model", rightX + 18, rightY + 18);
  ctx.font = "16px Trebuchet MS, sans-serif";
  ctx.fillStyle = "#dbe8ff";
  ctx.fillText("Hover a neuron to inspect its path and effects.", rightX + 18, rightY + 58);
  ctx.fillText(`Columns: ${network.columns.length}/${network.maxColumns}`, rightX + 18, rightY + 90);
  ctx.fillText(`Engine: ${(BASE_ENGINE_ENERGY * (network.engineMultiplier ?? 1)).toFixed(1)}`, rightX + 18, rightY + 114);
  ctx.fillText(`Burst shots: ${burstOutputs.length}`, rightX + 18, rightY + 138);
  ctx.fillText(
    `Primary output: ${primaryOutput ? primaryOutput.damage.toFixed(1) : "0.0"}`,
    rightX + 18,
    rightY + 162,
  );
  ctx.fillText(`Score: ${world.resources.score}`, rightX + 18, rightY + 186);

  ctx.fillStyle = "#dce8ff";
  ctx.textAlign = "center";
  ctx.font = "18px Trebuchet MS, sans-serif";
  ctx.fillText(`Score ${world.resources.score}`, canvas.width * 0.5, panelY + panelHeight + 34);
  ctx.font = "20px Trebuchet MS, sans-serif";
  ctx.fillText("Press R to restart or hover the model to inspect signal paths.", canvas.width * 0.5, panelY + panelHeight + 72);
}

function drawGunEndpoint(ctx, x, y, scale, activeColor) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#183052";
  ctx.strokeStyle = activeColor || "rgba(146, 198, 255, 0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-12, -8, 18, 16, 6);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(6, -3);
  ctx.lineTo(18, -3);
  ctx.lineTo(18, 3);
  ctx.lineTo(6, 3);
  ctx.closePath();
  ctx.fillStyle = activeColor || "#33537e";
  ctx.fill();
  ctx.restore();
}

function drawNeuronTooltip(ctx, pointer, info) {
  if (!pointer?.active || !info) {
    return;
  }

  const periodicLines = info.periodic?.length ? info.periodic : ["Periodic: none"];
  const panelHeight = 132 + periodicLines.length * 18;
  const x = Math.min(ctx.canvas.width - TOOLTIP_WIDTH - 16, pointer.x + 18);
  const y = Math.min(ctx.canvas.height - panelHeight - 16, pointer.y + 18);

  ctx.save();
  ctx.fillStyle = "rgba(8, 14, 30, 0.94)";
  ctx.strokeStyle = info.color ?? "rgba(149, 189, 255, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, TOOLTIP_WIDTH, panelHeight, 12);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f3f7ff";
  ctx.font = "bold 15px Trebuchet MS, sans-serif";
  ctx.fillText(info.title, x + 12, y + 10);
  ctx.font = "14px Trebuchet MS, sans-serif";
  ctx.fillText(`Input: ${info.inputText}`, x + 12, y + 34);
  ctx.fillText(`Local: ${info.localText}`, x + 12, y + 54);
  ctx.fillText(`Output: ${info.damageText}`, x + 12, y + 74);
  ctx.fillText(`Effects: ${info.effectsText}`, x + 12, y + 94);
  for (let index = 0; index < periodicLines.length; index += 1) {
    ctx.fillText(periodicLines[index], x + 12, y + 114 + index * 18);
  }
  ctx.restore();
}

function drawWeaponGrid(ctx, world, layout) {
  const network = world.resources.weaponNetwork;
  const scaffoldNetwork = layout.scaffoldNetwork ?? network;
  const flow = layout.flow;
  const signalTime = layout.signalTime ?? 0;
  const signalProgress = layout.signalProgress ?? null;
  const previewPulseColor = layout.previewPulseColor ?? "#fff4c4";
  const changedConnections = layout.changedConnections ?? new Set();
  const changedNodes = layout.changedNodes ?? new Set();
  const selectedRow =
    network.upgrade.active && network.upgrade.step === "slot" ? network.upgrade.selectedRow : null;
  const selectedColumn =
    network.upgrade.active && network.upgrade.step === "slot"
      ? network.upgrade.selectedColumn
      : null;
  const shipEntity = world.query("Ship", "Transform")[0];
  const shipY = shipEntity ? world.getComponent(shipEntity, "Transform").y : GAME_HEIGHT * 0.5;
  const baseY = layout.centerY ?? shipY;
  const rowSpacing = layout.rowSpacing ?? 26;
  const columnSpacing = layout.columnSpacing ?? 76;
  const slotRadius = layout.slotRadius ?? 14;
  const showCoreLabels = layout.showCoreLabels ?? true;
  const showNodeLabels = layout.showNodeLabels ?? true;
  const frontX = layout.frontX;
  const leftmostX = frontX - (scaffoldNetwork.columns.length - 1) * columnSpacing;
  const engineX = leftmostX - Math.max(96, columnSpacing + 8);
  const gunX = frontX + (layout.gunOffsetX ?? Math.max(72, columnSpacing + 12));
  const nodePositions = new Map();
  const gunPositions = new Map();

  function getColumnPosition(columnIndex, row) {
    const key = `${columnIndex}:${row}`;
    return nodePositions.get(key);
  }

  function getEndpointPosition(point) {
    if (!point) {
      return null;
    }
    if (point.type === "engine") {
      return { x: engineX, y: baseY };
    }
    if (point.type === "gun") {
      return gunPositions.get(point.row);
    }
    return getColumnPosition(point.column, point.row);
  }

  ctx.lineWidth = layout.lineWidth ?? 2;
  ctx.strokeStyle = "rgba(146, 198, 255, 0.35)";
  ctx.fillStyle = "#1b2d52";
  ctx.beginPath();
  ctx.arc(engineX, baseY, slotRadius + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#dce8ff";
  ctx.font = `${layout.labelSize ?? 11}px Trebuchet MS, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const sourceColumnIndex = scaffoldNetwork.columns.length - 1;
  const sourceRowsTotal =
    scaffoldNetwork.columns[sourceColumnIndex] === scaffoldNetwork.columns[0]
      ? SOURCE_ROW_ENERGY * network.rows
      : BASE_ENGINE_ENERGY;
  const engineValue = sourceRowsTotal * (network.engineMultiplier ?? 1);
  const engineLabel =
    Math.abs(engineValue - Math.round(engineValue)) < 0.01
      ? String(Math.round(engineValue))
      : engineValue.toFixed(1);
  if (showCoreLabels) {
    ctx.fillText(engineLabel, engineX, baseY);
  }

  for (let columnIndex = 0; columnIndex < scaffoldNetwork.columns.length; columnIndex += 1) {
    const column = scaffoldNetwork.columns[columnIndex];
    const x = frontX - columnIndex * columnSpacing;

    for (let row = 0; row < column.slots.length; row += 1) {
      const y = baseY + (row - 2) * rowSpacing;
      nodePositions.set(`${columnIndex}:${row}`, { x, y });
    }
  }

  const hoveredNode = getHoveredGridNode(nodePositions, layout.hoverPoint ?? null, slotRadius);
  const focusedNode = hoveredNode ?? (
    network.upgrade.active && network.upgrade.step === "slot"
      ? { columnIndex: selectedColumn, row: selectedRow }
      : null
  );
  const activeFlow =
    layout.focusOnHover && focusedNode
      ? {
          ...resolveFocusedWeaponFlow(layout.focusNetwork ?? scaffoldNetwork, focusedNode),
          signalProgress,
        }
      : flow;
  const pulseConnections =
    activeFlow.pulseConnections ??
    activeFlow.connections
      .filter((connection) => connection.active)
      .map((connection) => ({
        ...connection,
        phaseOffset: 0,
      }));

  gunPositions.set(0, { x: gunX, y: baseY });
  const scaffoldColor = "rgba(142, 164, 202, 0.22)";
  const previewPulseSegments = [];

  if (hoveredNode && layout.hoverInfoTarget) {
    const slot = scaffoldNetwork.columns[hoveredNode.columnIndex]?.slots[hoveredNode.row];
    const nodeFlow = activeFlow.nodes[hoveredNode.columnIndex]?.[hoveredNode.row];
    const buffs = [];
    if (slot?.buffShort) {
      buffs.push(slot.buffShort);
    }
    if ((slot?.specialMultiplier ?? 1) > 1.001) {
      buffs.push(`EMP x${slot.specialMultiplier.toFixed(2)}`);
    }
    const damage = nodeFlow?.damage ?? 0;
    const energy = nodeFlow?.energy ?? 0;
    const { localAmp, localFlat } = getSlotLocalBonus(slot);
    const periodic = [];
    if (nodeFlow?.active && (slot?.alwaysFire || nodeFlow.buffShorts?.includes("FIRE"))) {
      const burnTick = Math.max(1, Math.round(damage * BURN_DAMAGE_FACTOR));
      periodic.push(`Burn: ${burnTick}/tick x ${BURN_TICKS} = ${burnTick * BURN_TICKS}`);
    }
    if (nodeFlow?.active && (slot?.alwaysCurse || nodeFlow.buffShorts?.includes("CURSE"))) {
      const curseTick = Math.max(1, Math.round(damage * CURSE_DAMAGE_FACTOR));
      periodic.push(`Curse: ${curseTick}/tick x ${CURSE_TICKS} = ${curseTick * CURSE_TICKS}`);
    }
    layout.hoverInfoTarget.info = {
      title: `L${hoveredNode.columnIndex + 1} R${hoveredNode.row + 1}`,
      damageText: nodeFlow?.active ? nodeFlow.damage.toFixed(1) : "0.0",
      inputText: nodeFlow?.active ? energy.toFixed(1) : "0.0",
      localText: `x${localAmp.toFixed(2)} +${localFlat.toFixed(1)}`,
      effectsText: getEffectSummary(slot, buffs),
      buffs,
      periodic,
      color: slot?.buffColor ?? (nodeFlow?.buffColors?.[0] ?? "#9bc8ff"),
    };
  }

  for (let row = 0; row < network.rows; row += 1) {
    const from = getEndpointPosition({ type: "engine", row: 0 });
    const to = getColumnPosition(network.columns.length - 1, row);
    if (!from || !to) {
      continue;
    }
    drawConnectionStroke(
      ctx,
      from,
      to,
      scaffoldColor,
      Math.max(1, (layout.lineWidth ?? 2) - 0.5),
      slotRadius,
    );
  }

  for (let columnIndex = scaffoldNetwork.columns.length - 1; columnIndex >= 0; columnIndex -= 1) {
    for (let row = 0; row < network.rows; row += 1) {
      const slot = scaffoldNetwork.columns[columnIndex].slots[row];

      for (const targetRow of collectLocalDividerTargets(slot, row, network.rows)) {
        const from = getColumnPosition(columnIndex, row);
        const to = getColumnPosition(columnIndex, targetRow);
        if (from && to) {
          drawConnectionStroke(
            ctx,
            from,
            to,
            scaffoldColor,
            Math.max(1, (layout.lineWidth ?? 2) - 0.5),
            slotRadius,
          );
        }
      }

      for (const sourceRow of collectLocalMergerSources(slot, row, network.rows)) {
        const from = getColumnPosition(columnIndex, sourceRow);
        const to = getColumnPosition(columnIndex, row);
        if (from && to) {
          drawConnectionStroke(
            ctx,
            from,
            to,
            scaffoldColor,
            Math.max(1, (layout.lineWidth ?? 2) - 0.5),
            slotRadius,
          );
        }
      }
    }

    if (columnIndex === 0) {
      continue;
    }

    const guideKeys = new Set();
    for (let row = 0; row < network.rows; row += 1) {
      const sourceSlot = scaffoldNetwork.columns[columnIndex].slots[row];
      for (const targetRow of collectOutgoingRows(sourceSlot, row, network.rows)) {
        const key = `${row}:${targetRow}`;
        if (guideKeys.has(key)) {
          continue;
        }
        guideKeys.add(key);

        const from = getColumnPosition(columnIndex, row);
        const to = getColumnPosition(columnIndex - 1, targetRow);
        if (from && to) {
          drawConnectionStroke(
            ctx,
            from,
            to,
            scaffoldColor,
            Math.max(1, (layout.lineWidth ?? 2) - 0.5),
            slotRadius,
          );
        }
      }
    }
  }

  for (let row = 0; row < network.rows; row += 1) {
    const from = getColumnPosition(0, row);
    if (!from) {
      continue;
    }

    const gun = gunPositions.get(0);
    if (gun) {
      drawConnectionStroke(
        ctx,
        from,
        gun,
        scaffoldColor,
        Math.max(1, (layout.lineWidth ?? 2) - 0.5),
        slotRadius,
      );
    }
  }

  if (focusedNode) {
    const previewColor = previewPulseColor;
    const previewColumn = scaffoldNetwork.columns[focusedNode.columnIndex];
    const previewSlot = previewColumn?.slots[focusedNode.row];
    const from = getColumnPosition(focusedNode.columnIndex, focusedNode.row);

    if (previewSlot && from) {
      for (const sourceRow of collectLocalMergerSources(previewSlot, focusedNode.row, network.rows)) {
        const source = getColumnPosition(focusedNode.columnIndex, sourceRow);
        if (!source) {
          continue;
        }
        drawConnectionStroke(
          ctx,
          source,
          from,
          previewColor,
          (layout.lineWidth ?? 2) + 0.25,
          slotRadius,
        );
        previewPulseSegments.push({ from: source, to: from });
      }

      for (const targetRow of collectLocalDividerTargets(previewSlot, focusedNode.row, network.rows)) {
        const to = getColumnPosition(focusedNode.columnIndex, targetRow);
        if (!to) {
          continue;
        }
        drawConnectionStroke(
          ctx,
          from,
          to,
          previewColor,
          (layout.lineWidth ?? 2) + 0.25,
          slotRadius,
        );
        previewPulseSegments.push({ from, to });
      }

      for (const targetRow of collectOutgoingRows(previewSlot, focusedNode.row, network.rows)) {
        const to =
          focusedNode.columnIndex > 0
            ? getColumnPosition(focusedNode.columnIndex - 1, targetRow)
            : gunPositions.get(0);
        if (!to) {
          continue;
        }
        drawConnectionStroke(
          ctx,
          from,
          to,
          previewColor,
          (layout.lineWidth ?? 2) + 0.25,
          slotRadius,
        );
        previewPulseSegments.push({ from, to });
      }

      if (layout.previewFocusPulses) {
        const incomingSource =
          focusedNode.columnIndex < scaffoldNetwork.columns.length - 1
            ? getColumnPosition(focusedNode.columnIndex + 1, focusedNode.row)
            : getEndpointPosition({ type: "engine", row: 0 });
        if (incomingSource) {
          drawConnectionStroke(
            ctx,
            incomingSource,
            from,
            previewColor,
            (layout.lineWidth ?? 2) + 0.25,
            slotRadius,
          );
          previewPulseSegments.push({ from: incomingSource, to: from });
        }
      }
    }
  }

  for (const connection of activeFlow.connections) {
    if (!connection.active) {
      continue;
    }

    const from = getEndpointPosition(connection.from);
    const to = getEndpointPosition(connection.to);

    if (!from || !to) {
      continue;
    }

    drawConnectionStroke(
      ctx,
      from,
      to,
      mixColors(connection.buffColors, "#fff4c4"),
      (layout.lineWidth ?? 2) + 0.5,
      slotRadius,
    );

    const pulseSources =
      pulseConnections.filter((pulse) => pulse.id === connection.id) ??
      [{ ...connection, phaseOffset: 0 }];

    for (const pulse of pulseSources) {
      const pulseColor = changedConnections.has(connection.id)
        ? "#fff4c4"
        : mixColors(pulse.buffColors ?? connection.buffColors, "#e8f7ff");
      const travel = signalProgress == null
        ? (signalTime * 1.15 + (pulse.phaseOffset ?? 0)) % 1
        : Math.max(0.04, Math.min(0.98, signalProgress));
      const pulsePoint = getConnectionPulsePoint(from, to, travel, slotRadius);
      ctx.fillStyle = pulseColor;
      ctx.globalAlpha = changedConnections.has(connection.id) ? 0.9 : 0.68;
      ctx.beginPath();
      ctx.arc(
        pulsePoint.x,
        pulsePoint.y,
        changedConnections.has(connection.id) ? 4.2 : 3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (layout.previewFocusPulses && previewPulseSegments.length > 0) {
    previewPulseSegments.forEach((segment, index) => {
      const travel = (signalTime * 1.15 + index * 0.17) % 1;
      const pulsePoint = getConnectionPulsePoint(segment.from, segment.to, travel, slotRadius);
      ctx.fillStyle = previewPulseColor;
      ctx.globalAlpha = 0.82;
      ctx.beginPath();
      ctx.arc(pulsePoint.x, pulsePoint.y, 3.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  for (let columnIndex = 0; columnIndex < network.columns.length; columnIndex += 1) {
    const column = network.columns[columnIndex];
    const x = frontX - columnIndex * columnSpacing;

    for (let row = 0; row < column.slots.length; row += 1) {
      const y = baseY + (row - 2) * rowSpacing;
      const slot = column.slots[row];
      const nodeFlow = activeFlow.nodes[columnIndex]?.[row];
      const isSelectable =
        network.upgrade.active &&
        network.upgrade.step === "slot" &&
        (network.upgrade.mode === "special"
          ? slot.filled
          : !slot.filled);
      const isSelected =
        isSelectable &&
        columnIndex === selectedColumn &&
        network.upgrade.selectedRow === row;
      const isUnlocked = true;
      const isChanged = changedNodes.has(`${columnIndex}:${row}`);
      const isEmpowered = (slot.specialMultiplier ?? 1) > 1.001;
      const nodeColor = nodeFlow?.active
        ? mixColors(nodeFlow.buffColors, "#8ed8ff")
        : slot.filled && slot.buffColor
          ? slot.buffColor
          : null;

      ctx.fillStyle = nodeFlow?.active
        ? "rgba(42, 82, 133, 0.95)"
        : slot.filled
          ? "#193153"
          : isSelectable
            ? "#21365d"
            : isUnlocked
              ? "#1a2845"
              : "#0d1424";
      ctx.beginPath();
      ctx.arc(x, y, slotRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isSelected
        ? "#fff4c4"
        : nodeColor
          ? nodeColor
          : isSelectable
            ? "#9bc8ff"
            : "rgba(146, 198, 255, 0.45)";
      ctx.lineWidth = isSelected ? 4 : nodeFlow?.active ? 3 : 2;
      ctx.stroke();

      if (nodeFlow?.active) {
        ctx.strokeStyle = mixColors(nodeFlow.buffColors, "#eaf6ff");
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, slotRadius - 4, 0, Math.PI * 2);
        ctx.stroke();

        const pulseRadius = slotRadius - 5 + Math.sin(signalTime * 5 + columnIndex + row) * 1.5;
        ctx.strokeStyle = isChanged ? "#fff4c4" : mixColors(nodeFlow.buffColors, "#f7fdff");
        ctx.lineWidth = isChanged ? 2.5 : 1.5;
        ctx.globalAlpha = isChanged ? 0.95 : 0.55;
        ctx.beginPath();
        ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (isChanged) {
        ctx.strokeStyle = "#fff4c4";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, slotRadius + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (isEmpowered) {
        ctx.strokeStyle = "#ffe27a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, slotRadius + 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (
        hoveredNode &&
        hoveredNode.columnIndex === columnIndex &&
        hoveredNode.row === row
      ) {
        ctx.strokeStyle = "#fff4c4";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, slotRadius + 11, 0, Math.PI * 2);
        ctx.stroke();
      }

      drawNodeGlyph(
        ctx,
        slot,
        x,
        y,
        slotRadius,
        nodeFlow?.active ? mixColors(nodeFlow.buffColors, "#f7fdff") : "rgba(223, 239, 255, 0.9)",
      );

      if (showNodeLabels) {
        const labelSize = slot.filled && String(slot.buffShort).length > 3
          ? Math.max(8, (layout.labelSize ?? 11) - 2)
          : layout.labelSize ?? 11;
        ctx.fillStyle = slot.filled ? "#f4fbff" : "#8ea4ca";
        ctx.font = `${labelSize}px Trebuchet MS, sans-serif`;
        ctx.fillText(slot.filled ? slot.buffShort : columnIndex === 0 ? "G" : String(slot.baseEnergy), x, y);
      }

      if (nodeFlow?.active && layout.showNodeStats !== false) {
        const { localAmp, localFlat } = getSlotLocalBonus(slot);
        ctx.textAlign = "center";
        ctx.fillStyle = "#f5fbff";
        ctx.font = `bold ${Math.max(9, Math.round((layout.labelSize ?? 11) * 0.9))}px Trebuchet MS, sans-serif`;
        ctx.fillText(`${nodeFlow.damage.toFixed(1)}`, x, y - slotRadius - 14);
        ctx.fillStyle = "rgba(224, 238, 255, 0.92)";
        ctx.font = `${Math.max(8, Math.round((layout.labelSize ?? 11) * 0.78))}px Trebuchet MS, sans-serif`;
        ctx.fillText(`x${localAmp.toFixed(2)} +${localFlat}`, x, y + slotRadius + 28);
      }

      if (slot.filled && layout.showBuffLabels) {
        ctx.fillStyle = "#dce8ff";
        ctx.font = `${layout.buffSize ?? 10}px Trebuchet MS, sans-serif`;
        ctx.fillText(slot.buffShort, x, y + slotRadius + 14);
      }
    }
  }

  const gunPos = gunPositions.get(0);
  const activeOutputs = activeFlow.outputs.filter(Boolean);
  const gunColor =
    activeOutputs.length > 0
      ? mixColors(activeOutputs.flatMap((output) => output.buffColors ?? []), bulletColor(activeOutputs[0]))
      : null;
  drawGunEndpoint(
    ctx,
    gunPos.x,
    gunPos.y,
    Math.max(0.7, slotRadius / 12),
    gunColor,
  );
}

function getFittedGridMetrics(network, panelWidth, panelHeight, preferred) {
  const columnSpacing = Math.min(
    preferred.columnSpacing,
    Math.max(72, (panelHeight - 240) / Math.max(1, network.columns.length)),
  );
  const rowSpacing = Math.min(
    preferred.rowSpacing,
    Math.max(50, (panelWidth - 140) / Math.max(4, network.rows - 1)),
  );
  const slotRadius = Math.min(
    preferred.slotRadius,
    Math.max(14, Math.min(rowSpacing * 0.28, columnSpacing * 0.22)),
  );
  const gunOffsetX = Math.max(72, Math.min(preferred.gunOffsetX, columnSpacing + slotRadius * 2.5));

  return {
    columnSpacing,
    rowSpacing,
    slotRadius,
    gunOffsetX,
  };
}

function drawUpgradeOverlay(ctx, canvas, world) {
  const network = world.resources.weaponNetwork;
  const upgrade = network.upgrade;
  const displayState = getDisplayedDispatchState(world, network);
  const baseFlow = resolveWeaponOutputs(network, { dispatchRow: displayState.dispatchRow });
  const previewNetwork = createPreviewNetwork(network);
  const flow = resolveWeaponOutputs(previewNetwork, { dispatchRow: displayState.dispatchRow });
  flow.pulseConnections = flow.connections
    .filter((connection) => connection.active)
    .map((connection) => ({
      ...connection,
      phaseOffset: 0,
    }));
  flow.signalProgress = displayState.signalProgress;
  flow.dispatchRow = displayState.dispatchRow;
  const projectedOutputs = flow.outputs;
  const changeSet = buildFlowChangeSet(baseFlow, flow);
  const shellX = 44;
  const shellY = 38;
  const shellWidth = canvas.width - 88;
  const shellHeight = canvas.height - 76;
  const modelPanelWidth = Math.max(620, Math.min(840, shellWidth * 0.47));
  const gap = 18;
  const modelX = shellX + 22;
  const modelY = shellY + 22;
  const modelWidth = modelPanelWidth - 44;
  const modelHeight = shellHeight - 44;
  const rightX = shellX + modelPanelWidth + gap;
  const rightY = shellY + 22;
  const rightWidth = shellWidth - modelPanelWidth - gap - 22;
  const rightInnerWidth = rightWidth - 28;
  const cardWidth = rightInnerWidth;
  const cardHeight = Math.max(128, Math.min(168, (modelHeight - 152) / 3));
  const cardGap = 16;
  const cardsY = rightY + 94;
  const hoverInfo = {};
  const modelMetrics = getFittedGridMetrics(network, modelWidth, modelHeight, {
    rowSpacing: 68,
    columnSpacing: 102,
    slotRadius: 24,
    gunOffsetX: 108,
  });

  ctx.fillStyle = "rgba(3, 6, 14, 0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(7, 13, 26, 0.96)";
  ctx.strokeStyle = "rgba(149, 189, 255, 0.24)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(shellX, shellY, shellWidth, shellHeight, 24);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(10, 18, 34, 0.95)";
  ctx.beginPath();
  ctx.roundRect(modelX, modelY, modelWidth, modelHeight, 20);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(rightX, rightY, rightWidth, modelHeight, 20);
  ctx.fill();

  ctx.fillStyle = "#f3f7ff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 26px Trebuchet MS, sans-serif";
  ctx.fillText(upgrade.mode === "special" ? "Special Upgrade" : "Upgrade Phase", rightX + 14, rightY);
  ctx.font = "16px Trebuchet MS, sans-serif";

  if (upgrade.step === "card") {
    ctx.fillText(
      upgrade.mode === "special"
        ? "Choose a special reward: W/S or Up/Down, Enter confirms, 1/2/3 for direct pick."
        : "Choose a card: W/S or Up/Down, Enter confirms, 1/2/3 for direct pick.",
      rightX + 14,
      rightY + 40,
    );
  } else {
    ctx.fillText(
      upgrade.mode === "special"
        ? "Choose an existing lens: Left/Right moves rows, Up/Down moves depth, Enter applies."
        : "Choose any empty lens: Left/Right moves rows, Up/Down moves depth, Enter applies.",
      rightX + 14,
      rightY + 40,
    );
  }

  for (let index = 0; index < upgrade.cards.length; index += 1) {
    const card = upgrade.cards[index];
    const x = rightX + 14;
    const y = cardsY + index * (cardHeight + cardGap);
    const isSelected = upgrade.selectedCardIndex === index;
    const isPending = upgrade.pendingCard?.id === card.id;

    ctx.fillStyle = card.special ? (isPending ? "#493b12" : "#2b2410") : isPending ? "#1f3f52" : "#13233d";
    ctx.strokeStyle = isSelected ? card.color : card.special ? "rgba(255, 226, 122, 0.45)" : "rgba(214, 228, 255, 0.2)";
    ctx.lineWidth = isSelected ? 4 : card.special ? 3 : 2;
    ctx.beginPath();
    ctx.roundRect(x, y, cardWidth, cardHeight, 16);
    ctx.fill();
    ctx.stroke();

    if (card.special) {
      ctx.fillStyle = "rgba(255, 226, 122, 0.18)";
      ctx.beginPath();
      ctx.roundRect(x + 10, y + 10, cardWidth - 20, 26, 10);
      ctx.fill();
      ctx.fillStyle = "#ffe27a";
      ctx.font = "bold 12px Trebuchet MS, sans-serif";
      ctx.fillText("SPECIAL", x + 18, y + 16);
    }

    ctx.fillStyle = card.color;
    ctx.font = "bold 24px Trebuchet MS, sans-serif";
    ctx.fillText(`${index + 1}. ${card.name}`, x + 18, y + (card.special ? 44 : 18));
    ctx.fillStyle = "#dbe8ff";
    ctx.font = "16px Trebuchet MS, sans-serif";
    const descriptionLines = wrapText(ctx, card.description, cardWidth - 36);
    for (let lineIndex = 0; lineIndex < descriptionLines.length; lineIndex += 1) {
      ctx.fillText(descriptionLines[lineIndex], x + 18, y + (card.special ? 88 : 62) + lineIndex * 22);
    }
  }

  const upgradeModelTranslateX = modelX + 42;
  const upgradeModelTranslateY = modelY + modelHeight - 36;
  ctx.save();
  ctx.beginPath();
  ctx.rect(modelX + 18, modelY + 18, modelWidth - 36, modelHeight - 36);
  ctx.clip();
  ctx.translate(upgradeModelTranslateX, upgradeModelTranslateY);
  ctx.rotate(-Math.PI / 2);
  const cycleSpanX =
    network.columns.length * modelMetrics.columnSpacing + 120 + modelMetrics.gunOffsetX;
  const centeredFrontX = modelHeight * 0.5 + (cycleSpanX - modelMetrics.gunOffsetX) * 0.5 - 16;
  drawWeaponGrid(ctx, world, {
    flow,
    scaffoldNetwork: previewNetwork,
    focusNetwork: previewNetwork,
    focusOnHover: upgrade.step === "slot",
    hoverInfoTarget: hoverInfo,
    previewFocusPulses: true,
    previewPulseColor: upgrade.pendingCard?.color ?? "#fff4c4",
    signalTime: world.resources.signalTime,
    signalProgress: flow.signalProgress,
    changedConnections: changeSet.changedConnectionIds,
    changedNodes: changeSet.changedNodeKeys,
    frontX: centeredFrontX,
    centerY: modelWidth * 0.5 - 24,
    rowSpacing: modelMetrics.rowSpacing,
    columnSpacing: modelMetrics.columnSpacing,
    slotRadius: modelMetrics.slotRadius,
    lineWidth: 3,
    labelSize: 14,
    buffSize: 11,
    showBuffLabels: true,
    showCoreLabels: false,
    gunOffsetX: modelMetrics.gunOffsetX,
    hoverPoint: getRotatedHoverPoint(
      world.resources.pointer,
      upgradeModelTranslateX,
      upgradeModelTranslateY,
    ),
  });
  ctx.restore();
  drawNeuronTooltip(ctx, world.resources.pointer, hoverInfo.info);

  const shipEntity = world.query("Ship", "Transform")[0];
  const ship = shipEntity ? world.getComponent(shipEntity, "Ship") : null;
  if (ship) {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const burstShots = projectedOutputs.filter(Boolean);
    const primaryShot = burstShots[0] ?? null;
    const labelY = modelY + 118;
    ctx.fillStyle = primaryShot ? bulletColor(primaryShot) : "#6e7e9f";
    ctx.font = primaryShot ? "bold 20px Trebuchet MS, sans-serif" : "16px Trebuchet MS, sans-serif";
    ctx.fillText(`Gun: ${burstShots.length} shots`, modelX + 28, labelY);
    ctx.fillText(`Base DMG: ${primaryShot ? primaryShot.damage : 0}`, modelX + 28, labelY + 40);
  }

  ctx.fillStyle = "#dbe8ff";
  ctx.font = "16px Trebuchet MS, sans-serif";
  ctx.fillText(
    upgrade.mode === "special"
      ? "MiniBoss reward: choose one special upgrade."
      : `Column ${network.activeColumn + 1}/${network.maxColumns}   Next cost: ${network.upgradeCost}`,
    rightX + 14,
    shellY + shellHeight - 46,
  );
}

function getBossEntity(world) {
  return world
    .query("Enemy")
    .find((entity) => world.getComponent(entity, "Enemy")?.isBoss);
}

function getMiniBossEntity(world) {
  return world
    .query("Enemy")
    .find((entity) => world.getComponent(entity, "Enemy")?.isMiniBoss);
}

export function createShipFlightSystem() {
  return (world, dt) => {
    if (isPaused(world)) {
      return;
    }

    for (const entity of world.query("Ship", "Transform")) {
      const ship = world.getComponent(entity, "Ship");
      const transform = world.getComponent(entity, "Transform");
      const body = world.getComponent(entity, "CircleCollider");
      const input = world.resources.input;
      ship.contactCooldown = Math.max(0, ship.contactCooldown - dt);
      let inputX = 0;
      let inputY = 0;

      if (input.a) {
        inputX -= 1;
      }
      if (input.d) {
        inputX += 1;
      }
      if (input.w) {
        inputY -= 1;
      }
      if (input.s) {
        inputY += 1;
      }

      if (inputX !== 0 || inputY !== 0) {
        const length = Math.hypot(inputX, inputY);
        inputX /= length;
        inputY /= length;
      }

      transform.x += inputX * ship.controlSpeed * dt;
      transform.y += inputY * ship.controlSpeed * dt;

      const minX = LAYOUT.sidebarWidth + LAYOUT.battlePadding + body.radius;
      const maxX = GAME_WIDTH - LAYOUT.battlePadding - body.radius;
      const minY = GAME_HEIGHT * 0.68;
      const maxY = GAME_HEIGHT - body.radius - 8;
      transform.x = Math.max(minX, Math.min(maxX, transform.x));
      transform.y = Math.max(minY, Math.min(maxY, transform.y));
    }
  };
}

export function backgroundParallaxSystem(world, dt) {
  if (isPaused(world)) {
    return;
  }

  for (const star of world.resources.stars) {
    star.y += star.speed * dt;
    if (star.y > GAME_HEIGHT + star.size) {
      star.y = -Math.random() * 40;
      star.x = Math.random() * GAME_WIDTH;
      star.alpha = Math.random() * 0.55 + 0.2;
    }
  }
}

export function createAutoFireSystem() {
  return (world, dt) => {
    if (isPaused(world)) {
      return;
    }

    const network = world.resources.weaponNetwork;
    const dispatchRow = world.resources.dispatchRow ?? 0;
    const outputs = resolveWeaponOutputs(network, { dispatchRow }).outputs;

    for (const entity of world.query("Ship", "Transform")) {
      const ship = world.getComponent(entity, "Ship");
      const transform = world.getComponent(entity, "Transform");
      ship.fireTimer += dt;
      ship.burstTimer = Math.max(0, (ship.burstTimer ?? 0) - dt);

      if ((!ship.pendingShots || ship.pendingShots.length === 0) && ship.fireTimer >= ship.fireInterval) {
        ship.fireTimer = 0;
        ship.activeVolleyRow = dispatchRow;
        ship.pendingShots = outputs
          .map((stats, row) => (stats ? { ...stats, row, color: bulletColor(stats) } : null))
          .filter(Boolean);
        world.resources.dispatchRow = (dispatchRow + 1) % network.rows;
      }

      if ((ship.pendingShots?.length ?? 0) > 0 && ship.burstTimer <= 0) {
        const shot = ship.pendingShots.shift();
        createBullet(world, transform.x, transform.y - SHIP.muzzleOffsetX, shot);
        ship.burstTimer = ship.burstSpacing ?? SHIP.burstSpacing;
      }
    }
  };
}

export function createEnemySpawnSystem() {
  return (world, dt) => {
    if (isPaused(world)) {
      return;
    }

    const completedColumns = countCompletedColumns(world.resources.weaponNetwork);
    const minibossesDefeated = world.resources.minibossesDefeated ?? 0;
    const isOpeningWave = completedColumns === 0 && minibossesDefeated === 0;
    const spawnInterval = Math.max(
      isOpeningWave ? 2.15 : 0.95,
      world.resources.enemySpawnInterval -
        completedColumns * 0.008 -
        minibossesDefeated * 0.025 +
        (isOpeningWave ? 1.45 : 0.52),
    );

    world.resources.enemySpawnTimer += dt;
    if (world.resources.enemySpawnTimer < spawnInterval) {
      return;
    }

    world.resources.enemySpawnTimer = 0;
    createEnemy(world);
  };
}

export function enemyHomingSystem(world) {
  if (isPaused(world)) {
    return;
  }

  for (const entity of world.query("Enemy", "Transform", "Velocity")) {
    const transform = world.getComponent(entity, "Transform");
    const velocity = world.getComponent(entity, "Velocity");
    const enemy = world.getComponent(entity, "Enemy");
    const slowFactor = enemy.slowTimer > 0 ? Math.max(0, 1 - (enemy.slowFactor ?? 0)) : 1;
    const effectiveSpeed = enemy.freezeTimer > 0 ? 0 : enemy.speed * slowFactor;
    if (enemy.isBoss || enemy.isMiniBoss) {
      const anchorY = enemy.isBoss ? BOSS.anchorY : MINIBOSS.anchorY;
      const dy = anchorY - transform.y;
      velocity.x = 0;
      velocity.y = Math.abs(dy) <= effectiveSpeed * (1 / 60) ? 0 : Math.sign(dy) * effectiveSpeed;
      continue;
    }

    velocity.x = 0;
    velocity.y = effectiveSpeed;
  }
}

export function bossAttackSystem(world, dt) {
  if (isPaused(world)) {
    return;
  }

  const shipEntity = world.query("Ship", "Transform")[0];
  if (!shipEntity) {
    return;
  }

  const shipPos = world.getComponent(shipEntity, "Transform");
  for (const entity of world.query("Enemy", "Transform", "CircleCollider")) {
    const enemy = world.getComponent(entity, "Enemy");
    if (!enemy?.isBoss && !enemy?.isMiniBoss) {
      continue;
    }

    const transform = world.getComponent(entity, "Transform");
    const body = world.getComponent(entity, "CircleCollider");
    const anchorY = enemy.isBoss ? BOSS.anchorY : MINIBOSS.anchorY;
    if (Math.abs(transform.y - anchorY) > 8) {
      continue;
    }

    enemy.fireTimer = (enemy.fireTimer ?? 0) + dt;
    if (enemy.fireTimer < (enemy.fireInterval ?? BOSS.fireInterval)) {
      continue;
    }

    enemy.fireTimer = 0;
    const dx = shipPos.x - transform.x;
    const dy = shipPos.y - transform.y;
    const length = Math.hypot(dx, dy) || 1;
    createEnemyBullet(
      world,
      transform.x,
      transform.y + body.radius * 0.55,
      (dx / length) * ENEMY_BULLET.speed,
      (dy / length) * ENEMY_BULLET.speed,
    );
  }
}

export function movementSystem(world, dt) {
  if (isPaused(world)) {
    return;
  }

  for (const entity of world.query("Transform", "Velocity")) {
    const transform = world.getComponent(entity, "Transform");
    const velocity = world.getComponent(entity, "Velocity");
    const bullet = world.getComponent(entity, "Bullet");

    if (bullet) {
      bullet.age += dt;
      const progress = Math.min(1, bullet.age / BULLET.easeDuration);
      const eased = progress * progress;
      const speedFactor =
        BULLET.startSpeedFactor + (1 - BULLET.startSpeedFactor) * eased;
      const dirLength = Math.hypot(bullet.dirX ?? 0, bullet.dirY ?? -1) || 1;
      bullet.dirX = (bullet.dirX ?? 0) / dirLength;
      bullet.dirY = (bullet.dirY ?? -1) / dirLength;
      velocity.x = bullet.dirX * bullet.baseSpeed * speedFactor;
      velocity.y = bullet.dirY * bullet.baseSpeed * speedFactor;
    }

    transform.x += velocity.x * dt;
    transform.y += velocity.y * dt;

    if (bullet) {
      bounceBulletOffWalls(transform, world.getComponent(entity, "CircleCollider"), bullet);
    }
  }
}

export function enemyStatusSystem(world, dt) {
  if (isPaused(world)) {
    return;
  }

  for (const entity of world.query("Enemy")) {
    const enemy = world.getComponent(entity, "Enemy");
    if (enemy.burnTicks > 0) {
      enemy.burnTimer -= dt;
      if (enemy.burnTimer <= 0) {
        enemy.burnTimer = 0.5;
        enemy.burnTicks -= 1;
        damageEnemy(world, entity, enemy.burnDamage || 1);
        if (enemy.burnTicks <= 0) {
          enemy.burnTicks = 0;
          enemy.burnTimer = 0;
          enemy.burnDamage = 0;
        }
      }
    }

    if (!world.entities.has(entity)) {
      continue;
    }

    if (enemy.curseTicks > 0) {
      enemy.curseTimer -= dt;
      if (enemy.curseTimer <= 0) {
        enemy.curseTimer = 0.65;
        enemy.curseTicks -= 1;
        damageEnemy(world, entity, enemy.curseDamage || 1);
        if (enemy.curseTicks <= 0) {
          enemy.curseTicks = 0;
          enemy.curseTimer = 0;
          enemy.curseDamage = 0;
        }
      }
    }

    enemy.freezeTimer = Math.max(0, (enemy.freezeTimer ?? 0) - dt);
    enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - dt);
    if (enemy.slowTimer <= 0) {
      enemy.slowFactor = 0;
    }
  }

  for (const entity of world.query("DamageText", "Transform", "Velocity")) {
    const text = world.getComponent(entity, "DamageText");
    text.life -= dt;
    if (text.life <= 0) {
      world.destroyEntity(entity);
    }
  }
}

export function collisionSystem(world) {
  if (isPaused(world)) {
    return;
  }

  const bulletEntities = world.query("Bullet", "Transform", "CircleCollider");
  const enemyEntities = world.query("Enemy", "Transform", "CircleCollider");

  for (const bulletEntity of bulletEntities) {
    if (!world.entities.has(bulletEntity)) {
      continue;
    }

    const bulletPos = world.getComponent(bulletEntity, "Transform");
    const bulletBody = world.getComponent(bulletEntity, "CircleCollider");
    const bullet = world.getComponent(bulletEntity, "Bullet");

    for (const enemyEntity of enemyEntities) {
      if (!world.entities.has(enemyEntity)) {
        continue;
      }

      const enemyPos = world.getComponent(enemyEntity, "Transform");
      const enemyBody = world.getComponent(enemyEntity, "CircleCollider");
      if (!circlesOverlap(bulletPos, bulletBody.radius, enemyPos, enemyBody.radius)) {
        continue;
      }

      const hitDamage = bullet.damage;
      damageEnemy(world, enemyEntity, hitDamage);

      if (world.entities.has(enemyEntity) && bullet.fire) {
        const enemy = world.getComponent(enemyEntity, "Enemy");
        if (enemy.burnTicks <= 0) {
          enemy.burnTimer = 0.5;
          enemy.burnDamage = 0;
        }
        enemy.burnTicks += BURN_TICKS;
        enemy.burnDamage += Math.max(1, Math.round(bullet.damage * BURN_DAMAGE_FACTOR));
      }

      if (world.entities.has(enemyEntity) && bullet.curse) {
        const enemy = world.getComponent(enemyEntity, "Enemy");
        if (enemy.curseTicks <= 0) {
          enemy.curseTimer = 0.65;
          enemy.curseDamage = 0;
        }
        enemy.curseTicks += CURSE_TICKS;
        enemy.curseDamage += Math.max(1, Math.round(bullet.damage * CURSE_DAMAGE_FACTOR));
      }

      if (world.entities.has(enemyEntity) && bullet.slow) {
        const enemy = world.getComponent(enemyEntity, "Enemy");
        enemy.slowTimer = Math.max(enemy.slowTimer ?? 0, SLOW_DURATION);
        enemy.slowFactor = Math.max(enemy.slowFactor ?? 0, SLOW_FACTOR);
      }

      if (world.entities.has(enemyEntity) && bullet.freeze) {
        const enemy = world.getComponent(enemyEntity, "Enemy");
        enemy.freezeTimer = Math.max(enemy.freezeTimer ?? 0, FREEZE_DURATION);
      }

      if (world.entities.has(enemyEntity) && bullet.pushback) {
        const pushDistance = Math.min(
          enemyBody.radius * 1.35,
          PUSHBACK_BASE + hitDamage * PUSHBACK_PER_DAMAGE,
        );
        enemyPos.y = Math.max(-enemyBody.radius * 0.6, enemyPos.y - pushDistance);
      }

      if (bullet.split && (bullet.splitRemaining ?? 0) > 0) {
        spawnSplitBullets(world, bullet, bulletPos.x, enemyPos.y - enemyBody.radius - bulletBody.radius - 6);
        world.destroyEntity(bulletEntity);
      } else if (bullet.ricochet && (bullet.bouncesLeft ?? 0) > 0) {
        bounceBulletOffEnemy(bulletPos, bulletBody, bullet, enemyPos, enemyBody);
      } else if (bullet.penetration) {
        bulletPos.y = enemyPos.y - enemyBody.radius - bulletBody.radius - 4;
      } else {
        world.destroyEntity(bulletEntity);
      }
      break;
    }
  }

  const shipEntity = world.query("Ship", "Transform", "CircleCollider")[0];
  if (!shipEntity) {
    return;
  }

  const shipPos = world.getComponent(shipEntity, "Transform");
  const shipBody = world.getComponent(shipEntity, "CircleCollider");
  const ship = world.getComponent(shipEntity, "Ship");

  for (const pickupEntity of world.query("HealthPickup", "Transform", "CircleCollider")) {
    const pickupPos = world.getComponent(pickupEntity, "Transform");
    const pickupBody = world.getComponent(pickupEntity, "CircleCollider");
    const pickup = world.getComponent(pickupEntity, "HealthPickup");
    if (!circlesOverlap(shipPos, shipBody.radius, pickupPos, pickupBody.radius)) {
      continue;
    }

    if (ship.hp >= ship.maxHp) {
      continue;
    }

    ship.hp = Math.min(ship.maxHp, ship.hp + (pickup.heal ?? HEALTH_PICKUP.heal));
    world.destroyEntity(pickupEntity);
    break;
  }

  if (ship.contactCooldown <= 0) {
    for (const bulletEntity of world.query("EnemyBullet", "Transform", "CircleCollider")) {
      const bulletPos = world.getComponent(bulletEntity, "Transform");
      const bulletBody = world.getComponent(bulletEntity, "CircleCollider");
      const bullet = world.getComponent(bulletEntity, "EnemyBullet");
      if (!circlesOverlap(shipPos, shipBody.radius, bulletPos, bulletBody.radius)) {
        continue;
      }

      ship.hp -= bullet.damage ?? 1;
      ship.contactCooldown = 0.6;
      world.destroyEntity(bulletEntity);
      if (ship.hp <= 0) {
        ship.hp = 0;
        world.resources.gameOver = true;
      }
      break;
    }
  }

  if (ship.contactCooldown <= 0) {
    for (const enemyEntity of world.query("Enemy", "Transform", "CircleCollider")) {
      const enemyPos = world.getComponent(enemyEntity, "Transform");
      const enemyBody = world.getComponent(enemyEntity, "CircleCollider");
      const enemy = world.getComponent(enemyEntity, "Enemy");
      if (!circlesOverlap(shipPos, shipBody.radius, enemyPos, enemyBody.radius)) {
        continue;
      }

      ship.hp -= 1;
      ship.contactCooldown = 0.6;
      if (!enemy.isBoss && !enemy.isMiniBoss) {
        world.destroyEntity(enemyEntity);
      }
      if (ship.hp <= 0) {
        ship.hp = 0;
        world.resources.gameOver = true;
      }
      break;
    }
  }

  if (ship.contactCooldown <= 0 && !world.resources.gameOver) {
    for (const enemyEntity of world.query("Enemy", "Transform", "CircleCollider")) {
      const enemyPos = world.getComponent(enemyEntity, "Transform");
      const enemyBody = world.getComponent(enemyEntity, "CircleCollider");
      const enemy = world.getComponent(enemyEntity, "Enemy");
      if (enemyPos.y + enemyBody.radius < GAME_HEIGHT) {
        continue;
      }

      ship.hp -= 1;
      ship.contactCooldown = 0.6;
      if (!enemy.isBoss && !enemy.isMiniBoss) {
        world.destroyEntity(enemyEntity);
      } else {
        enemyPos.y = GAME_HEIGHT - enemyBody.radius;
      }
      if (ship.hp <= 0) {
        ship.hp = 0;
        world.resources.gameOver = true;
      }
      break;
    }
  }
}

export function cleanupSystem(world) {
  const margin = 80;

  for (const entity of world.query("Bullet", "Transform")) {
    const { x, y } = world.getComponent(entity, "Transform");
    if (x > GAME_WIDTH + margin || x < -margin || y < -margin || y > GAME_HEIGHT + margin) {
      world.destroyEntity(entity);
    }
  }

  for (const entity of world.query("EnemyBullet", "Transform")) {
    const { x, y } = world.getComponent(entity, "Transform");
    if (x > GAME_WIDTH + margin || x < -margin || y < -margin || y > GAME_HEIGHT + margin) {
      world.destroyEntity(entity);
    }
  }

  for (const entity of world.query("Enemy", "Transform")) {
    const { x, y } = world.getComponent(entity, "Transform");
    const body = world.getComponent(entity, "CircleCollider");
    const radius = body?.radius ?? 0;
    if (
      x > GAME_WIDTH + radius + margin ||
      x < -radius - margin ||
      y < -radius - margin ||
      y > GAME_HEIGHT + radius + margin
    ) {
      world.destroyEntity(entity);
    }
  }

  for (const entity of world.query("HealthPickup", "Transform")) {
    const { x, y } = world.getComponent(entity, "Transform");
    const body = world.getComponent(entity, "CircleCollider");
    const radius = body?.radius ?? 0;
    if (
      x > GAME_WIDTH + radius + margin ||
      x < -radius - margin ||
      y < -radius - margin ||
      y > GAME_HEIGHT + radius + margin
    ) {
      world.destroyEntity(entity);
    }
  }
}

export function stateSystem(world) {
  if (world.resources.restartRequested) {
    resetGame(world);
    return;
  }

  const network = world.resources.weaponNetwork;
  const completedColumns = countCompletedColumns(network);
  const unlockedColumns = Math.max(0, network.columns.length - 1);

  if (world.resources.commitUpgrade) {
    applyUpgradeToSelectedRow(network);
    world.resources.commitUpgrade = false;
  }

  if (
    !world.resources.gameOver &&
    world.resources.pendingSpecialUpgrade &&
    !network.upgrade.active
  ) {
    clearDirectionalInput(world);
    beginSpecialUpgrade(network);
    world.resources.pendingSpecialUpgrade = false;
    return;
  }

  if (
    !world.resources.gameOver &&
    !world.resources.bossSpawned &&
    world.resources.activeMinibossTier === 0 &&
    unlockedColumns > (world.resources.minibossesDefeated ?? 0) &&
    unlockedColumns < network.maxColumns
  ) {
    world.resources.activeMinibossTier = unlockedColumns;
    createMiniBoss(world, unlockedColumns);
    world.resources.enemySpawnTimer = 0;
    return;
  }

  if (
    !world.resources.gameOver &&
    !world.resources.bossSpawned &&
    world.resources.activeMinibossTier === 0 &&
    isNetworkComplete(network)
  ) {
    world.resources.bossSpawned = true;
    createBoss(world);
    createEnemy(world);
    createEnemy(world);
    world.resources.enemySpawnTimer = 0;
    return;
  }

  if (
    !world.resources.gameOver &&
    !network.upgrade.active &&
    hasAvailableUpgrade(network) &&
    world.resources.score >= network.nextUpgradeScore
  ) {
    clearDirectionalInput(world);
    beginUpgrade(network);
  }
}

export function createRenderSystem(ctx, canvas) {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#0b1734");
  gradient.addColorStop(1, "#070b17");

  return (world) => {
    const flow = resolveDisplayedWeaponFlow(world, world.resources.weaponNetwork);
    const currentFlow = flow;
    const sidebarWidth = LAYOUT.sidebarWidth;
    const panelPadding = LAYOUT.panelPadding;
    world.resources.signalTime += 1 / 60;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const star of world.resources.stars) {
      ctx.globalAlpha = star.alpha;
      ctx.fillStyle = "#c5d4ff";
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(5, 10, 20, 0.86)";
    ctx.fillRect(0, 0, sidebarWidth, canvas.height);
    ctx.strokeStyle = "rgba(126, 170, 232, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sidebarWidth + 0.5, 0);
    ctx.lineTo(sidebarWidth + 0.5, canvas.height);
    ctx.stroke();

    for (const entity of world.query("Render", "Transform")) {
      const render = world.getComponent(entity, "Render");
      const transform = world.getComponent(entity, "Transform");

      if (render.type === "ship") {
        drawShip(ctx, transform.x, transform.y, SHIP.renderScale);
        const ship = world.getComponent(entity, "Ship");
        drawGunChargeEffects(
          ctx,
          transform.x,
          transform.y,
          ship,
          currentFlow.outputs,
          world.resources.signalTime,
        );
      }

      if (render.type === "bullet") {
        const body = world.getComponent(entity, "CircleCollider");
        const bullet = world.getComponent(entity, "Bullet");
        const trailLength = 16 + Math.min(1, bullet.age / Math.max(0.001, BULLET.easeDuration)) * 34;
        const dirLength = Math.hypot(bullet.dirX ?? 0, bullet.dirY ?? -1) || 1;
        const dirX = (bullet.dirX ?? 0) / dirLength;
        const dirY = (bullet.dirY ?? -1) / dirLength;
        ctx.strokeStyle = render.color;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = body.radius * 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(transform.x - dirX * trailLength, transform.y - dirY * trailLength);
        ctx.lineTo(transform.x, transform.y);
        ctx.stroke();

        ctx.fillStyle = render.color;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(transform.x, transform.y, body.radius + 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(transform.x, transform.y, body.radius, 0, Math.PI * 2);
        ctx.fill();

        const accentColors = bullet.buffColors.filter((color) => color && color !== render.color).slice(0, 3);
        for (let index = 0; index < accentColors.length; index += 1) {
          const angle = world.resources.signalTime * 8 + index * 2.2 + bullet.row * 0.6;
          const sparkX = transform.x + Math.cos(angle) * (body.radius + 4.5);
          const sparkY = transform.y + Math.sin(angle) * (body.radius + 3.5);
          ctx.fillStyle = accentColors[index];
          ctx.beginPath();
          ctx.arc(sparkX, sparkY, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (render.type === "enemyBullet") {
        const body = world.getComponent(entity, "CircleCollider");
        ctx.fillStyle = render.color;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(transform.x, transform.y, body.radius + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(transform.x, transform.y, body.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (render.type === "healthPickup") {
        const body = world.getComponent(entity, "CircleCollider");
        const pulse = 0.92 + Math.sin(world.resources.signalTime * 5.5 + transform.y * 0.01) * 0.08;
        ctx.fillStyle = "rgba(156, 255, 178, 0.22)";
        ctx.beginPath();
        ctx.arc(transform.x, transform.y, body.radius + 6 * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#9cffb2";
        ctx.beginPath();
        ctx.arc(
          transform.x - body.radius * 0.36,
          transform.y - body.radius * 0.08,
          body.radius * 0.46,
          0,
          Math.PI * 2,
        );
        ctx.arc(
          transform.x + body.radius * 0.36,
          transform.y - body.radius * 0.08,
          body.radius * 0.46,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(transform.x - body.radius * 0.88, transform.y + body.radius * 0.04);
        ctx.lineTo(transform.x, transform.y + body.radius * 1.08);
        ctx.lineTo(transform.x + body.radius * 0.88, transform.y + body.radius * 0.04);
        ctx.closePath();
        ctx.fill();
      }

      if (render.type === "enemy") {
        const body = world.getComponent(entity, "CircleCollider");
        const enemy = world.getComponent(entity, "Enemy");
        ctx.fillStyle = render.color;
        ctx.beginPath();
        drawEnemyShape(
          ctx,
          enemy.isBoss || enemy.isMiniBoss ? "circle" : render.shape,
          transform.x,
          transform.y,
          body.radius,
        );
        ctx.fill();

        if (enemy.isBoss) {
          ctx.strokeStyle = "#ffd6e4";
          ctx.lineWidth = 5;
          ctx.stroke();
        }
        if (enemy.isMiniBoss) {
          ctx.strokeStyle = "#ffe2bf";
          ctx.lineWidth = 4;
          ctx.stroke();
        }

        const debuffColors = enemyDebuffColors(enemy);
        if (debuffColors.length > 0) {
          ctx.strokeStyle = mixColors(debuffColors, "#f1f6ff");
          ctx.lineWidth = enemy.isBoss ? 10 : enemy.isMiniBoss ? 7 : 4;
          ctx.beginPath();
          drawEnemyShape(
            ctx,
            enemy.isBoss || enemy.isMiniBoss ? "circle" : render.shape,
            transform.x,
            transform.y,
            body.radius + (enemy.isBoss ? 9 : enemy.isMiniBoss ? 7 : 5),
          );
          ctx.stroke();
        }

        ctx.fillStyle = "#0c1020";
        ctx.font = enemy.isBoss
          ? "bold 22px Trebuchet MS, sans-serif"
          : enemy.isMiniBoss
            ? "bold 18px Trebuchet MS, sans-serif"
            : "bold 14px Trebuchet MS, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const centerLabel =
          enemy.isBoss || enemy.isMiniBoss
            ? enemy.bossName ?? (enemy.isBoss ? "Boss Core" : "MiniBoss")
            : String(Math.ceil(enemy.hp));
        ctx.fillText(centerLabel, transform.x, transform.y);
      }

      if (render.type === "damageText") {
        const text = world.getComponent(entity, "DamageText");
        const alpha = Math.max(0, text.life / text.totalLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = render.color;
        ctx.font = `bold ${Math.round(text.size)}px Trebuchet MS, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(text.value, transform.x, transform.y);
        ctx.globalAlpha = 1;
      }
    }

	    const shipEntity = world.query("Ship")[0];
	    const ship = shipEntity ? world.getComponent(shipEntity, "Ship") : { hp: 0, maxHp: 0 };
	    const network = world.resources.weaponNetwork;
    const displayState = getDisplayedDispatchState(world, network);

    ctx.fillStyle = "#f3f8ff";
    ctx.font = "bold 24px Trebuchet MS, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Stats", panelPadding, panelPadding);

    ctx.fillStyle = "#e4eeff";
    ctx.font = "16px Trebuchet MS, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`Ship HP: ${ship.hp}/${ship.maxHp}`, panelPadding, panelPadding + 40);
    ctx.fillText(`Score: ${world.resources.score}`, panelPadding, panelPadding + 62);
    ctx.fillText(`Move: W/A/S/D`, panelPadding, panelPadding + 84);
	    ctx.fillText(
	      `Signal row: ${displayState.dispatchRow + 1}`,
	      panelPadding,
	      panelPadding + 106,
	    );
    ctx.fillText(`Next upgrade: ${network.nextUpgradeScore}`, panelPadding, panelPadding + 128);
    ctx.fillText(`Columns: ${network.columns.length}/${network.maxColumns}`, panelPadding, panelPadding + 150);
    ctx.fillText(
      `Threat tier: ${countCompletedColumns(network) + (world.resources.minibossesDefeated ?? 0) * 2}`,
      panelPadding,
      panelPadding + 172,
    );
    ctx.fillText(
      `Minibosses: ${world.resources.minibossesDefeated ?? 0}/${network.maxColumns - 1}`,
      panelPadding,
      panelPadding + 194,
    );

    const modelTop = 306;
    const modelHeight = canvas.height - modelTop - panelPadding;
    const modelWidth = sidebarWidth - panelPadding * 2;
    const mainModelMetrics = getFittedGridMetrics(network, modelWidth, modelHeight, {
      rowSpacing: 74,
      columnSpacing: 112,
      slotRadius: 18,
      gunOffsetX: 94,
    });

    ctx.fillStyle = "#f3f8ff";
    ctx.font = "bold 24px Trebuchet MS, sans-serif";
    ctx.fillText("Model", panelPadding, 262);

    const mainModelTranslateX = panelPadding + 18;
    const mainModelTranslateY = canvas.height - panelPadding + 30;
    const hoverInfo = {};
    ctx.save();
    ctx.beginPath();
    ctx.rect(panelPadding, modelTop, modelWidth, modelHeight);
    ctx.clip();
    ctx.translate(mainModelTranslateX, mainModelTranslateY);
    ctx.rotate(-Math.PI / 2);
    drawWeaponGrid(ctx, world, {
      flow,
      hoverInfoTarget: hoverInfo,
      signalTime: world.resources.signalTime,
      signalProgress: flow.signalProgress,
      frontX: modelHeight - (mainModelMetrics.gunOffsetX + 10),
      centerY: modelWidth * 0.5 - 8,
      rowSpacing: mainModelMetrics.rowSpacing,
      columnSpacing: mainModelMetrics.columnSpacing,
      slotRadius: mainModelMetrics.slotRadius,
      lineWidth: 2.5,
      showBuffLabels: false,
      showNodeLabels: false,
      showCoreLabels: false,
      gunOffsetX: mainModelMetrics.gunOffsetX,
      hoverPoint: getRotatedHoverPoint(
        world.resources.pointer,
        mainModelTranslateX,
        mainModelTranslateY,
      ),
    });
    ctx.restore();
    drawNeuronTooltip(ctx, world.resources.pointer, hoverInfo.info);

    const bossEntity = getBossEntity(world);
    const miniBossEntity = getMiniBossEntity(world);
    if (miniBossEntity) {
      const miniboss = world.getComponent(miniBossEntity, "Enemy");
      const barWidth = 280;
      const barHeight = 14;
      const x = panelPadding;
      const y = 228;
      const progress = Math.max(0, miniboss.hp / miniboss.maxHp);

      ctx.fillStyle = "rgba(8, 14, 30, 0.9)";
      ctx.fillRect(x - 8, y - 10, barWidth + 16, 38);
      ctx.fillStyle = "#3a2412";
      ctx.fillRect(x, y + 8, barWidth, barHeight);
      ctx.fillStyle = "#ff8d57";
      ctx.fillRect(x, y + 8, barWidth * progress, barHeight);
      ctx.strokeStyle = "rgba(255, 227, 196, 0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y + 8, barWidth, barHeight);
      ctx.fillStyle = "#ffe8d1";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "bold 16px Trebuchet MS, sans-serif";
      ctx.fillText(miniboss.bossName ?? `MiniBoss T${miniboss.miniBossTier}`, x, y - 2);
    }

    if (bossEntity) {
      const boss = world.getComponent(bossEntity, "Enemy");
      const barWidth = 320;
      const barHeight = 18;
      const x = panelPadding;
      const y = miniBossEntity ? 284 : 228;
      const progress = Math.max(0, boss.hp / boss.maxHp);

      ctx.fillStyle = "rgba(8, 14, 30, 0.9)";
      ctx.fillRect(x - 8, y - 10, barWidth + 16, 42);
      ctx.fillStyle = "#291221";
      ctx.fillRect(x, y + 8, barWidth, barHeight);
      ctx.fillStyle = "#ff5d8f";
      ctx.fillRect(x, y + 8, barWidth * progress, barHeight);
      ctx.strokeStyle = "rgba(255, 208, 224, 0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y + 8, barWidth, barHeight);
      ctx.fillStyle = "#ffe6ef";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "bold 16px Trebuchet MS, sans-serif";
      ctx.fillText(boss.bossName ?? "Boss Core", x, y - 2);
    }

    if (
      world.resources.bossDefeated &&
      !world.resources.pendingSpecialUpgrade &&
      !world.resources.gameOver
    ) {
      drawVictoryOverlay(ctx, canvas, world);
    }

    if (network.upgrade.active) {
      drawUpgradeOverlay(ctx, canvas, world);
    }

    if (world.resources.gameOver) {
      ctx.fillStyle = "rgba(2, 4, 10, 0.65)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5f8ff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 42px Trebuchet MS, sans-serif";
      ctx.fillText("GAME OVER", canvas.width * 0.5, canvas.height * 0.45);
      ctx.font = "22px Trebuchet MS, sans-serif";
      ctx.fillText("Press R to restart", canvas.width * 0.5, canvas.height * 0.56);
    }
  };
}

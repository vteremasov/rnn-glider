import { BULLET, ELECTRIC, GAME_HEIGHT, GAME_WIDTH, SHIP } from "./constants.js";
import { createBoss, createBullet, createEnemy, createMiniBoss, resetGame } from "./spawners.js";
import {
  applyUpgradeToSelectedRow,
  beginSpecialUpgrade,
  beginUpgrade,
  createPreviewNetwork,
  countCompletedColumns,
  getActiveColumn,
  hasAvailableUpgrade,
  isNetworkComplete,
  resolveWeaponOutputs,
} from "./weapon-network.js";

function circlesOverlap(a, ra, b, rb) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const radii = ra + rb;
  return dx * dx + dy * dy <= radii * radii;
}

function isPaused(world) {
  return world.resources.gameOver || world.resources.weaponNetwork.upgrade.active;
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
    if (stats.energy >= 5) {
      return "#ffc96a";
    }
    if (stats.energy >= 3) {
      return "#ff9b8c";
    }
    return "#dff9ff";
  }

  return mixColors(colors, "#dff9ff");
}

function createDamageText(world, x, y, damage) {
  const entity = world.createEntity();
  const magnitude = Math.max(1, Math.abs(damage));
  world.addComponent(entity, "Transform", { x, y });
  world.addComponent(entity, "DamageText", {
    value: `-${Math.round(magnitude)}`,
    life: 0.9,
    totalLife: 0.9,
    size: Math.min(34, 16 + magnitude * 1.35),
  });
  world.addComponent(entity, "Velocity", { x: 0, y: -28 - magnitude * 1.2 });
  world.addComponent(entity, "Render", { type: "damageText", color: "#ffe6e6" });
  return entity;
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
    const scoreMultiplier = enemy.isMiniBoss ? 0 : 0.85 ** minibossesDefeated;

    if (enemy.isBoss) {
      world.resources.bossDefeated = true;
    }
    if (enemy.isMiniBoss) {
      world.resources.minibossesDefeated = Math.max(
        world.resources.minibossesDefeated ?? 0,
        enemy.miniBossTier ?? 0,
      );
      world.resources.activeMinibossTier = 0;
      world.resources.pendingSpecialUpgrade = true;
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
  return colors;
}

function drawShip(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#a7d8ff";
  ctx.beginPath();
  ctx.moveTo(30, 0);
  ctx.lineTo(-20, -24);
  ctx.lineTo(-11, 0);
  ctx.lineTo(-20, 24);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#61b3ff";
  for (const offsetY of SHIP.gunOffsetsY) {
    ctx.fillRect(24, offsetY - 2.5, 12, 5);
  }
  ctx.restore();
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
  const flow = resolveWeaponOutputs(network);
  const panelX = 110;
  const panelY = 240;
  const panelWidth = canvas.width - 220;
  const panelHeight = 470;
  const panelCenterY = panelY + panelHeight * 0.5;
  const rowSpacing = 68;
  const shipEntity = world.query("Ship", "Transform")[0];
  const ship = shipEntity ? world.getComponent(shipEntity, "Ship") : null;

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

  drawShip(ctx, panelX + 190, panelCenterY, SHIP.upgradeRenderScale);
  drawWeaponGrid(ctx, world, {
    flow,
    signalTime: world.resources.signalTime,
    frontX: panelX + panelWidth - 260,
    centerY: panelCenterY,
    rowSpacing,
    columnSpacing: 102,
    slotRadius: 24,
    lineWidth: 3,
    labelSize: 14,
    buffSize: 11,
    showBuffLabels: true,
    gunOffsetX: 108,
  });

  if (ship) {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let row = 0; row < ship.gunOffsetsY.length; row += 1) {
      const output = flow.outputs[row];
      const y = panelCenterY + (row - 2) * rowSpacing;
      const damage = output ? output.damage : 0;
      ctx.fillStyle = output ? bulletColor(output) : "#6e7e9f";
      ctx.font = output ? "bold 18px Trebuchet MS, sans-serif" : "16px Trebuchet MS, sans-serif";
      ctx.fillText(`DMG ${damage}`, panelX + 340, y);
    }
  }

  ctx.fillStyle = "#dce8ff";
  ctx.textAlign = "center";
  ctx.font = "18px Trebuchet MS, sans-serif";
  ctx.fillText(`Score ${world.resources.score}`, canvas.width * 0.5, panelY + panelHeight + 38);
  ctx.font = "20px Trebuchet MS, sans-serif";
  ctx.fillText("Press R to restart or keep flying.", canvas.width * 0.5, panelY + panelHeight + 76);
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

function drawWeaponGrid(ctx, world, layout) {
  const network = world.resources.weaponNetwork;
  const flow = layout.flow;
  const signalTime = layout.signalTime ?? 0;
  const changedConnections = layout.changedConnections ?? new Set();
  const changedNodes = layout.changedNodes ?? new Set();
  const activeColumn = getActiveColumn(network);
  const selectedRow =
    network.upgrade.active && network.upgrade.step === "slot" ? network.upgrade.selectedRow : null;
  const selectedColumn =
    network.upgrade.active && network.upgrade.step === "slot"
      ? network.upgrade.mode === "special"
        ? network.upgrade.selectedColumn
        : network.activeColumn
      : null;
  const shipEntity = world.query("Ship", "Transform")[0];
  const shipY = shipEntity ? world.getComponent(shipEntity, "Transform").y : GAME_HEIGHT * 0.5;
  const baseY = layout.centerY ?? shipY;
  const rowSpacing = layout.rowSpacing ?? 26;
  const columnSpacing = layout.columnSpacing ?? 76;
  const slotRadius = layout.slotRadius ?? 14;
  const frontX = layout.frontX;
  const leftmostX = frontX - (network.columns.length - 1) * columnSpacing;
  const engineX = frontX - network.columns.length * columnSpacing - 120;
  const dividerX = frontX - network.columns.length * columnSpacing - 46;
  const gunX = frontX + (layout.gunOffsetX ?? Math.max(72, columnSpacing + 12));
  const nodePositions = new Map();
  const dividerPositions = new Map();
  const gunPositions = new Map();

  function getColumnPosition(columnIndex, row) {
    const key = `${columnIndex}:${row}`;
    return nodePositions.get(key);
  }

  function getEndpointPosition(point) {
    if (!point) {
      return null;
    }
    if (point.type === "divider") {
      return dividerPositions.get(point.row);
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
  const engineValue = 5 * (network.engineMultiplier ?? 1);
  const engineLabel =
    Math.abs(engineValue - Math.round(engineValue)) < 0.01
      ? String(Math.round(engineValue))
      : engineValue.toFixed(1);
  ctx.fillText(engineLabel, engineX, baseY);

  ctx.beginPath();
  ctx.moveTo(engineX + slotRadius + 8, baseY);
  ctx.lineTo(dividerX - slotRadius - 8, baseY);
  ctx.stroke();

  ctx.fillStyle = "#223968";
  ctx.beginPath();
  ctx.arc(dividerX, baseY, slotRadius + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#dce8ff";
  ctx.fillText("/", dividerX, baseY);

  for (let row = 0; row < network.rows; row += 1) {
    const y = baseY + (row - 2) * rowSpacing;
    dividerPositions.set(row, { x: dividerX, y });
    ctx.beginPath();
    ctx.moveTo(dividerX + slotRadius + 8, baseY);
    ctx.lineTo(leftmostX - slotRadius - 10, y);
    ctx.strokeStyle = "rgba(146, 198, 255, 0.2)";
    ctx.lineWidth = layout.lineWidth ?? 2;
    ctx.stroke();
  }

  for (let columnIndex = 0; columnIndex < network.columns.length; columnIndex += 1) {
    const column = network.columns[columnIndex];
    const x = frontX - columnIndex * columnSpacing;

    for (let row = 0; row < column.slots.length; row += 1) {
      const y = baseY + (row - 2) * rowSpacing;
      nodePositions.set(`${columnIndex}:${row}`, { x, y });
    }
  }

  for (let row = 0; row < network.rows; row += 1) {
    const y = baseY + (row - 2) * rowSpacing;
    gunPositions.set(row, { x: gunX, y });
  }

  for (let columnIndex = network.columns.length - 1; columnIndex >= 0; columnIndex -= 1) {
    for (let row = 0; row < network.rows; row += 1) {
      const slot = network.columns[columnIndex].slots[row];

      for (const targetRow of collectLocalDividerTargets(slot, row, network.rows)) {
        const from = getColumnPosition(columnIndex, row);
        const to = getColumnPosition(columnIndex, targetRow);
        if (from && to) {
          drawConnectionStroke(
            ctx,
            from,
            to,
            "rgba(122, 156, 212, 0.16)",
            (layout.lineWidth ?? 2) - 0.5,
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
            "rgba(122, 156, 212, 0.16)",
            (layout.lineWidth ?? 2) - 0.5,
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
      const sourceSlot = network.columns[columnIndex].slots[row];
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
            "rgba(122, 156, 212, 0.16)",
            (layout.lineWidth ?? 2) - 0.5,
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

    const slot = network.columns[0].slots[row];
    for (const targetRow of collectOutgoingRows(slot, row, network.rows)) {
      const gun = gunPositions.get(targetRow);
      if (gun) {
        drawConnectionStroke(
          ctx,
          from,
          gun,
          "rgba(122, 156, 212, 0.16)",
          (layout.lineWidth ?? 2) - 0.5,
          slotRadius,
        );
      }
    }
  }

  for (const connection of flow.connections) {
    const from = getEndpointPosition(connection.from);
    const to = getEndpointPosition(connection.to);

    if (!from || !to) {
      continue;
    }

    drawConnectionStroke(
      ctx,
      from,
      to,
      connection.active
        ? mixColors(connection.buffColors, "#fff4c4")
        : "rgba(146, 198, 255, 0.18)",
      connection.active ? (layout.lineWidth ?? 2) + 1 : layout.lineWidth ?? 2,
      slotRadius,
    );

    if (connection.active) {
      const pulseColor = changedConnections.has(connection.id)
        ? "#fff4c4"
        : mixColors(connection.buffColors, "#e8f7ff");
      const pulseCount = 2;
      for (let pulseIndex = 0; pulseIndex < pulseCount; pulseIndex += 1) {
        const travel = (signalTime * 1.4 + pulseIndex / pulseCount) % 1;
        const pulsePoint = getConnectionPulsePoint(from, to, travel, slotRadius);
        ctx.fillStyle = pulseColor;
        ctx.globalAlpha = changedConnections.has(connection.id) ? 0.95 : 0.75;
        ctx.beginPath();
        ctx.arc(
          pulsePoint.x,
          pulsePoint.y,
          changedConnections.has(connection.id) ? 4.5 : 3.2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  for (let columnIndex = 0; columnIndex < network.columns.length; columnIndex += 1) {
    const column = network.columns[columnIndex];
    const x = frontX - columnIndex * columnSpacing;

    for (let row = 0; row < column.slots.length; row += 1) {
      const y = baseY + (row - 2) * rowSpacing;
      const slot = column.slots[row];
      const nodeFlow = flow.nodes[columnIndex]?.[row];
      const isSelectable =
        network.upgrade.active &&
        network.upgrade.step === "slot" &&
        (network.upgrade.mode === "special"
          ? columnIndex === selectedColumn && slot.filled
          : column === activeColumn && !slot.filled);
      const isSelected = isSelectable && network.upgrade.selectedRow === row;
      const isUnlocked = columnIndex <= network.activeColumn || slot.filled;
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

      drawNodeGlyph(
        ctx,
        slot,
        x,
        y,
        slotRadius,
        nodeFlow?.active ? mixColors(nodeFlow.buffColors, "#f7fdff") : "rgba(223, 239, 255, 0.9)",
      );

      const labelSize = slot.filled && String(slot.buffShort).length > 3
        ? Math.max(8, (layout.labelSize ?? 11) - 2)
        : layout.labelSize ?? 11;
      ctx.fillStyle = slot.filled ? "#f4fbff" : "#8ea4ca";
      ctx.font = `${labelSize}px Trebuchet MS, sans-serif`;
      ctx.fillText(slot.filled ? slot.buffShort : columnIndex === 0 ? "G" : String(slot.baseEnergy), x, y);

      if (slot.filled && layout.showBuffLabels) {
        ctx.fillStyle = "#dce8ff";
        ctx.font = `${layout.buffSize ?? 10}px Trebuchet MS, sans-serif`;
        ctx.fillText(slot.buffShort, x, y + slotRadius + 14);
      }
    }
  }

  for (let row = 0; row < network.rows; row += 1) {
    const output = flow.outputs[row];
    const gunPos = gunPositions.get(row);
    drawGunEndpoint(
      ctx,
      gunPos.x,
      gunPos.y,
      Math.max(0.7, slotRadius / 12),
      output ? bulletColor(output) : null,
    );
  }
}

function drawUpgradeOverlay(ctx, canvas, world) {
  const network = world.resources.weaponNetwork;
  const upgrade = network.upgrade;
  const baseFlow = resolveWeaponOutputs(network);
  const previewNetwork = createPreviewNetwork(network);
  const flow = resolveWeaponOutputs(previewNetwork);
  const projectedOutputs = flow.outputs;
  const changeSet = buildFlowChangeSet(baseFlow, flow);
  const overlayTop = 56;
  const cardsY = 74;
  const cardWidth = 360;
  const cardHeight = 188;
  const cardGap = 40;
  const totalWidth = cardWidth * upgrade.cards.length + cardGap * (upgrade.cards.length - 1);
  const startX = canvas.width * 0.5 - totalWidth * 0.5;

  ctx.fillStyle = "rgba(3, 6, 14, 0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#f3f7ff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 26px Trebuchet MS, sans-serif";
  ctx.fillText(upgrade.mode === "special" ? "Special Upgrade" : "Upgrade Phase", 48, 20);
  ctx.font = "16px Trebuchet MS, sans-serif";

  if (upgrade.step === "card") {
    ctx.fillText(
      upgrade.mode === "special"
        ? "Choose a special reward: A/D or Left/Right, Enter confirms, 1/2/3 for direct pick."
        : "Choose a card: A/D or Left/Right, Enter confirms, 1/2/3 for direct pick.",
      48,
      overlayTop,
    );
  } else {
    ctx.fillText(
      upgrade.mode === "special"
        ? "Choose an existing lens: A/D changes column, W/S changes row, Enter applies."
        : "Choose a target gun in the active column: W/S or Up/Down, Enter applies.",
      48,
      overlayTop,
    );
  }

  for (let index = 0; index < upgrade.cards.length; index += 1) {
    const card = upgrade.cards[index];
    const x = startX + index * (cardWidth + cardGap);
    const isSelected = upgrade.selectedCardIndex === index;
    const isPending = upgrade.pendingCard?.id === card.id;

    ctx.fillStyle = card.special ? (isPending ? "#493b12" : "#2b2410") : isPending ? "#1f3f52" : "#13233d";
    ctx.strokeStyle = isSelected ? card.color : card.special ? "rgba(255, 226, 122, 0.45)" : "rgba(214, 228, 255, 0.2)";
    ctx.lineWidth = isSelected ? 4 : card.special ? 3 : 2;
    ctx.beginPath();
    ctx.roundRect(x, cardsY, cardWidth, cardHeight, 16);
    ctx.fill();
    ctx.stroke();

    if (card.special) {
      ctx.fillStyle = "rgba(255, 226, 122, 0.18)";
      ctx.beginPath();
      ctx.roundRect(x + 10, cardsY + 10, cardWidth - 20, 26, 10);
      ctx.fill();
      ctx.fillStyle = "#ffe27a";
      ctx.font = "bold 12px Trebuchet MS, sans-serif";
      ctx.fillText("SPECIAL", x + 18, cardsY + 16);
    }

    ctx.fillStyle = card.color;
    ctx.font = "bold 24px Trebuchet MS, sans-serif";
    ctx.fillText(`${index + 1}. ${card.name}`, x + 18, cardsY + (card.special ? 44 : 18));
    ctx.fillStyle = "#dbe8ff";
    ctx.font = "16px Trebuchet MS, sans-serif";
    const descriptionLines = wrapText(ctx, card.description, cardWidth - 36);
    for (let lineIndex = 0; lineIndex < descriptionLines.length; lineIndex += 1) {
      ctx.fillText(descriptionLines[lineIndex], x + 18, cardsY + (card.special ? 88 : 62) + lineIndex * 22);
    }
  }

  const panelX = 74;
  const panelY = 284;
  const panelWidth = canvas.width - 148;
  const panelHeight = 420;
  const overlayCenterY = panelY + panelHeight * 0.5;
  const overlayRowSpacing = 68;
  ctx.fillStyle = "rgba(8, 14, 30, 0.92)";
  ctx.strokeStyle = "rgba(149, 189, 255, 0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 20);
  ctx.fill();
  ctx.stroke();

  drawShip(ctx, panelX + 180, panelY + panelHeight * 0.5, SHIP.upgradeRenderScale);
  drawWeaponGrid(ctx, world, {
    flow,
    signalTime: world.resources.signalTime,
    changedConnections: changeSet.changedConnectionIds,
    changedNodes: changeSet.changedNodeKeys,
    frontX: panelX + panelWidth - 260,
    centerY: overlayCenterY,
    rowSpacing: overlayRowSpacing,
    columnSpacing: 102,
    slotRadius: 24,
    lineWidth: 3,
    labelSize: 14,
    buffSize: 11,
    showBuffLabels: true,
    gunOffsetX: 108,
  });

  const shipEntity = world.query("Ship", "Transform")[0];
  const ship = shipEntity ? world.getComponent(shipEntity, "Ship") : null;
  if (ship) {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let row = 0; row < ship.gunOffsetsY.length; row += 1) {
      const output = projectedOutputs[row];
      const y = overlayCenterY + (row - 2) * overlayRowSpacing;
      const damage = output ? output.damage : 0;
      ctx.fillStyle = output ? bulletColor(output) : "#6e7e9f";
      ctx.font = output ? "bold 18px Trebuchet MS, sans-serif" : "16px Trebuchet MS, sans-serif";
      ctx.fillText(`DMG ${damage}`, panelX + 330, y);
    }
  }

  ctx.fillStyle = "#dbe8ff";
  ctx.font = "16px Trebuchet MS, sans-serif";
  ctx.fillText(
    upgrade.mode === "special"
      ? "MiniBoss reward: choose one special upgrade."
      : `Column ${network.activeColumn + 1}/${network.maxColumns}   Next cost: ${network.upgradeCost}`,
    panelX + 26,
    panelY + panelHeight - 40,
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

      const minX = body.radius + 8;
      const maxX = GAME_WIDTH - body.radius - 8;
      const minY = body.radius + 8;
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
    star.x -= star.speed * dt;
    if (star.x < -star.size) {
      star.x = GAME_WIDTH + Math.random() * 40;
      star.y = Math.random() * GAME_HEIGHT;
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
    const outputs = resolveWeaponOutputs(network).outputs;

    for (const entity of world.query("Ship", "Transform")) {
      const ship = world.getComponent(entity, "Ship");
      const transform = world.getComponent(entity, "Transform");
      ship.fireTimer += dt;

      if (ship.fireTimer < ship.fireInterval) {
        continue;
      }

      ship.fireTimer = 0;
      for (let row = 0; row < ship.gunOffsetsY.length; row += 1) {
        const stats = outputs[row];
        if (!stats) {
          continue;
        }

        createBullet(world, transform.x + SHIP.muzzleOffsetX, transform.y + ship.gunOffsetsY[row], {
          ...stats,
          row,
          color: bulletColor(stats),
        });
      }
    }
  };
}

export function createEnemySpawnSystem() {
  return (world, dt) => {
    if (isPaused(world)) {
      return;
    }

    if (
      world.resources.bossSpawned ||
      world.resources.activeMinibossTier > 0 ||
      isNetworkComplete(world.resources.weaponNetwork)
    ) {
      return;
    }

    const completedColumns = countCompletedColumns(world.resources.weaponNetwork);
    const minibossesDefeated = world.resources.minibossesDefeated ?? 0;
    const spawnInterval = Math.max(
      0.18,
      world.resources.enemySpawnInterval - completedColumns * 0.04 - minibossesDefeated * 0.12,
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

  const shipEntity = world.query("Ship", "Transform")[0];
  if (!shipEntity) {
    return;
  }

  const shipPos = world.getComponent(shipEntity, "Transform");
  for (const entity of world.query("Enemy", "Transform", "Velocity")) {
    const enemyPos = world.getComponent(entity, "Transform");
    const velocity = world.getComponent(entity, "Velocity");
    const enemy = world.getComponent(entity, "Enemy");

    const dx = shipPos.x - enemyPos.x;
    const dy = shipPos.y - enemyPos.y;
    const length = Math.hypot(dx, dy) || 1;

    velocity.x = (dx / length) * enemy.speed;
    velocity.y = (dy / length) * enemy.speed;
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
      velocity.x = bullet.baseSpeedX * speedFactor;
    }

    transform.x += velocity.x * dt;
    transform.y += velocity.y * dt;
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
        enemy.burnTimer = 0.42;
        enemy.burnTicks -= 1;
        damageEnemy(world, entity, enemy.burnDamage || 1);
      }
    }

    if (!world.entities.has(entity)) {
      continue;
    }

    if (enemy.curseTicks > 0) {
      enemy.curseTimer -= dt;
      if (enemy.curseTimer <= 0) {
        enemy.curseTimer = 0.55;
        enemy.curseTicks -= 1;
        damageEnemy(world, entity, enemy.curseDamage || 1);
      }
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

      const hitDamage = bullet.crit ? bullet.damage * 2 : bullet.damage;
      const impactX = enemyPos.x;
      const impactY = enemyPos.y;
      damageEnemy(world, enemyEntity, hitDamage);

      if (bullet.electric) {
        const chainDamage = Math.max(1, Math.round(hitDamage * ELECTRIC.damageFactor));
        for (const chainedEntity of enemyEntities) {
          if (chainedEntity === enemyEntity || !world.entities.has(chainedEntity)) {
            continue;
          }

          const chainedPos = world.getComponent(chainedEntity, "Transform");
          const dx = chainedPos.x - impactX;
          const dy = chainedPos.y - impactY;
          if (dx * dx + dy * dy > ELECTRIC.radius * ELECTRIC.radius) {
            continue;
          }

          damageEnemy(world, chainedEntity, chainDamage);
        }
      }

      if (world.entities.has(enemyEntity) && bullet.fire) {
        const enemy = world.getComponent(enemyEntity, "Enemy");
        enemy.burnTicks = Math.max(enemy.burnTicks, 3);
        enemy.burnTimer = 0.42;
        enemy.burnDamage = Math.max(
          enemy.burnDamage,
          Math.max(1, Math.round(bullet.damage * 0.2 * (bullet.crit ? 2 : 1))),
        );
      }

      if (world.entities.has(enemyEntity) && bullet.curse) {
        const enemy = world.getComponent(enemyEntity, "Enemy");
        enemy.curseTicks = Math.max(enemy.curseTicks, 4);
        enemy.curseTimer = 0.55;
        enemy.curseDamage = Math.max(
          enemy.curseDamage,
          Math.max(1, Math.round(bullet.damage * 0.16)),
        );
      }

      if (bullet.penetration) {
        bulletPos.x = enemyPos.x + enemyBody.radius + bulletBody.radius + 4;
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

  if (ship.contactCooldown > 0) {
    return;
  }

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

  for (const entity of world.query("Enemy", "Transform")) {
    const { x, y } = world.getComponent(entity, "Transform");
    if (x > GAME_WIDTH + margin || x < -margin || y < -margin || y > GAME_HEIGHT + margin) {
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
    completedColumns > (world.resources.minibossesDefeated ?? 0) &&
    completedColumns < network.maxColumns
  ) {
    world.resources.activeMinibossTier = completedColumns;
    createMiniBoss(world, completedColumns);
    for (const entity of world.query("Enemy")) {
      const enemy = world.getComponent(entity, "Enemy");
      if (!enemy?.isMiniBoss) {
        world.destroyEntity(entity);
      }
    }
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
    for (const entity of world.query("Enemy")) {
      const enemy = world.getComponent(entity, "Enemy");
      if (!enemy?.isBoss) {
        world.destroyEntity(entity);
      }
    }
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
    const flow = resolveWeaponOutputs(world.resources.weaponNetwork);
    world.resources.signalTime += 1 / 60;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const star of world.resources.stars) {
      ctx.globalAlpha = star.alpha;
      ctx.fillStyle = "#c5d4ff";
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1;

    for (const entity of world.query("Render", "Transform")) {
      const render = world.getComponent(entity, "Render");
      const transform = world.getComponent(entity, "Transform");

      if (render.type === "ship") {
        drawShip(ctx, transform.x, transform.y, SHIP.renderScale);
      }

      if (render.type === "bullet") {
        const body = world.getComponent(entity, "CircleCollider");
        ctx.fillStyle = render.color;
        ctx.beginPath();
        ctx.arc(transform.x, transform.y, body.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (render.type === "enemy") {
        const body = world.getComponent(entity, "CircleCollider");
        const enemy = world.getComponent(entity, "Enemy");
        ctx.fillStyle = render.color;
        ctx.beginPath();
        ctx.arc(transform.x, transform.y, body.radius, 0, Math.PI * 2);
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
          ctx.arc(
            transform.x,
            transform.y,
            body.radius + (enemy.isBoss ? 9 : enemy.isMiniBoss ? 7 : 5),
            0,
            Math.PI * 2,
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

    drawWeaponGrid(ctx, world, {
      flow,
      signalTime: world.resources.signalTime,
      frontX: 300,
      centerY: 118,
      rowSpacing: 30,
      columnSpacing: 58,
      slotRadius: 10,
      labelSize: 10,
      showBuffLabels: false,
      gunOffsetX: 68,
    });

    const shipEntity = world.query("Ship")[0];
    const ship = shipEntity ? world.getComponent(shipEntity, "Ship") : { hp: 0, maxHp: 0 };
    const network = world.resources.weaponNetwork;

    ctx.fillStyle = "#e4eeff";
    ctx.font = "16px Trebuchet MS, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`Ship HP: ${ship.hp}/${ship.maxHp}`, 14, 14);
    ctx.fillText(`Score: ${world.resources.score}`, 14, 36);
    ctx.fillText(`Move: W/A/S/D`, 14, 58);
    ctx.fillText(`Next upgrade: ${network.nextUpgradeScore}`, 14, 80);
    ctx.fillText(`Columns: ${network.columns.length}/${network.maxColumns}`, 14, 102);
    ctx.fillText(
      `Threat tier: ${countCompletedColumns(network) + (world.resources.minibossesDefeated ?? 0) * 2}`,
      14,
      124,
    );
    ctx.fillText(`Minibosses: ${world.resources.minibossesDefeated ?? 0}/${network.maxColumns - 1}`, 14, 146);

    const bossEntity = getBossEntity(world);
    const miniBossEntity = getMiniBossEntity(world);
    if (miniBossEntity) {
      const miniboss = world.getComponent(miniBossEntity, "Enemy");
      const barWidth = 280;
      const barHeight = 14;
      const x = canvas.width - barWidth - 24;
      const y = 20;
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
      const x = canvas.width - barWidth - 24;
      const y = miniBossEntity ? 72 : 20;
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

    if (world.resources.bossDefeated && !world.resources.gameOver) {
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

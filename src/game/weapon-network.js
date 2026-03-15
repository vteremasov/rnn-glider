const ROWS = 5;
const MAX_COLUMNS = 5;
const INITIAL_UPGRADE_COST = 70;
const UPGRADE_COST_GROWTH = 1.25;
export const BASE_ENGINE_ENERGY = 25;
export const SOURCE_ROW_ENERGY = BASE_ENGINE_ENERGY / ROWS;
const ENGINE_OVERCLOCK_STEP = 0.1;
const SPECIAL_EMPOWER_STEP = 0.1;
const MAX_SPECIAL_MULTIPLIER = 1.6;
const OVERDRIVE_STEP = 0.35;
export const BURN_DAMAGE_FACTOR = 0.2;
export const CURSE_DAMAGE_FACTOR = 0.16;
export const UPGRADE_FLAT_DAMAGE = 2;
export const SPLIT_ANGLE_DEGREES = 45;
export const RICOCHET_BOUNCES = 5;
const DIVIDER_SPLIT_SHARE = 0.5;
const DIVIDER_BONUS_STEP = 0.1;
const MERGER_PULL_SHARE = 0.5;
const MERGER_BONUS_STEP = 0.1;
const RELAY_BONUS_STEP = 0.1;
const LINK_BONUS_STEP = 0.1;
export const SLOW_FACTOR = 0.45;
export const SLOW_DURATION = 1.6;
export const FREEZE_DURATION = 0.28;
export const PUSHBACK_BASE = 14;
export const PUSHBACK_PER_DAMAGE = 4;

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatBonus(multiplier) {
  return `+${Math.round((multiplier - 1) * 100)}%`;
}

function withFlatDamage(description) {
  return `${description} Adds +${UPGRADE_FLAT_DAMAGE} flat damage when signal passes through this lens.`;
}

export const SPECIAL_UPGRADE_CARDS = [
  {
    id: "engine_overclock",
    name: `Engine Overclock ${formatBonus(1 + ENGINE_OVERCLOCK_STEP)}`,
    short: "ENG+",
    description: `Boosts source energy by ${formatPercent(ENGINE_OVERCLOCK_STEP)}. Each source row receives (${BASE_ENGINE_ENERGY} * ${formatPercent(ENGINE_OVERCLOCK_STEP)}) / ${ROWS} more energy.`,
    color: "#ffe27a",
    special: true,
    target: "none",
  },
  {
    id: "reset_lens",
    name: "Reset One Lens",
    short: "RESET",
    description: "Clears one existing lens so you can replace it with a future upgrade.",
    color: "#ff9f9f",
    special: true,
    target: "filled",
  },
  {
    id: "empower_lens",
    name: `Empower Lens ${formatBonus(1 + SPECIAL_EMPOWER_STEP)}`,
    short: "EMP+",
    description: `Boosts one existing lens output by ${formatPercent(SPECIAL_EMPOWER_STEP)} per pick, up to ${formatBonus(MAX_SPECIAL_MULTIPLIER)} total. Works on structural and damage lenses.`,
    color: "#9dffcc",
    special: true,
    target: "filled",
  },
];

export const BUFF_LIBRARY = [
  {
    id: "fire",
    name: "Fire Core",
    short: "FIRE",
    description: withFlatDamage(`Every shot ignites. Burn deals ${formatPercent(BURN_DAMAGE_FACTOR)} periodic damage.`),
    color: "#ff8e72",
    apply(slot) {
      slot.alwaysFire = true;
    },
  },
  {
    id: "penetration",
    name: "Penetration",
    short: "PEN",
    description: withFlatDamage("Every shot penetrates through the first target."),
    color: "#89b7ff",
    apply(slot) {
      slot.alwaysPenetrate = true;
    },
  },
  {
    id: "split",
    name: `Split Shot ${SPLIT_ANGLE_DEGREES}deg`,
    short: "SPLT",
    description: withFlatDamage(`On hit, this bullet splits into 2 bullets that fly at +/-${SPLIT_ANGLE_DEGREES}deg.`),
    color: "#7afff0",
    apply(slot) {
      slot.alwaysSplit = true;
    },
  },
  {
    id: "ricochet",
    name: `Ricochet x${RICOCHET_BOUNCES}`,
    short: "RICO",
    description: withFlatDamage(`Every shot ricochets off enemies and walls up to ${RICOCHET_BOUNCES} times.`),
    color: "#7ac8ff",
    apply(slot) {
      slot.alwaysRicochet = true;
    },
  },
  {
    id: "overdrive",
    name: `Overdrive ${formatBonus(1 + OVERDRIVE_STEP)}`,
    short: "OVR",
    description: withFlatDamage(`Raises this lens output by ${formatPercent(OVERDRIVE_STEP)}.`),
    color: "#ffb56b",
    apply(slot) {
      slot.damageMultiplier += OVERDRIVE_STEP;
    },
  },
  {
    id: "uplink",
    name: `Left-Link ${formatBonus(1 + LINK_BONUS_STEP)}`,
    short: "LEFT",
    description: withFlatDamage(
      `Sends the normal signal forward and a second ${formatBonus(1 + LINK_BONUS_STEP)} branch into the left lane of the next layer.`,
    ),
    color: "#72e0ff",
    apply(slot) {
      slot.upLink = true;
    },
  },
  {
    id: "downlink",
    name: `Right-Link ${formatBonus(1 + LINK_BONUS_STEP)}`,
    short: "RIGHT",
    description: withFlatDamage(
      `Sends the normal signal forward and a second ${formatBonus(1 + LINK_BONUS_STEP)} branch into the right lane of the next layer.`,
    ),
    color: "#a890ff",
    apply(slot) {
      slot.downLink = true;
    },
  },
  {
    id: "curse",
    name: "Curse Core",
    short: "CURSE",
    description: withFlatDamage("Every shot curses. Curse deals periodic void damage."),
    color: "#9a63ff",
    apply(slot) {
      slot.alwaysCurse = true;
    },
  },
  {
    id: "slow",
    name: "Slow Field",
    short: "SLOW",
    description: withFlatDamage(`Every shot slows targets by ${formatPercent(SLOW_FACTOR)} for ${SLOW_DURATION.toFixed(1)}s.`),
    color: "#7fd9ff",
    apply(slot) {
      slot.alwaysSlow = true;
    },
  },
  {
    id: "freeze",
    name: "Freeze Pulse",
    short: "FRZ",
    description: withFlatDamage(`Every shot freezes targets in place for ${FREEZE_DURATION.toFixed(2)}s.`),
    color: "#d8f4ff",
    apply(slot) {
      slot.alwaysFreeze = true;
    },
  },
  {
    id: "pushback",
    name: "Push Back",
    short: "PUSH",
    description: withFlatDamage(
      `Every shot knocks enemies back by ${PUSHBACK_BASE} plus ${PUSHBACK_PER_DAMAGE} per damage dealt.`,
    ),
    color: "#ffb7d9",
    apply(slot) {
      slot.alwaysPushback = true;
    },
  },
  {
    id: "relay_multiplier",
    name: `Back Multiplier ${formatBonus(1 + RELAY_BONUS_STEP)}`,
    short: "BACK",
    description: withFlatDamage(
      `Does not power this lens. Multiplies all incoming signal from behind by ${formatPercent(RELAY_BONUS_STEP)} and forwards it.`,
    ),
    color: "#6bf0da",
    apply(slot) {
      slot.relayMultiplier = true;
    },
  },
  {
    id: "divider_multiplier",
    name: `Divider ${formatBonus(1 + DIVIDER_BONUS_STEP)}`,
    short: "DIV2",
    description: withFlatDamage(
      `Keeps ${formatPercent(1 - DIVIDER_SPLIT_SHARE)} on the current path and splits ${formatPercent(DIVIDER_SPLIT_SHARE)} into top and bottom rows of this column, each amplified by ${formatPercent(DIVIDER_BONUS_STEP)}.`,
    ),
    color: "#7bb4ff",
    apply(slot) {
      slot.dividerMultiplier = true;
    },
  },
  {
    id: "merger_multiplier",
    name: `Merger ${formatBonus(1 + MERGER_BONUS_STEP)}`,
    short: "MRG3",
    description: withFlatDamage(
      `Pulls ${formatPercent(MERGER_PULL_SHARE)} from adjacent top and bottom rows in this column, amplifies that siphoned signal by ${formatPercent(MERGER_BONUS_STEP)}, and adds it to the current path.`,
    ),
    color: "#ff8ed8",
    apply(slot) {
      slot.mergerMultiplier = true;
    },
  },
];

function createSlot(row, isFrontColumn) {
  return {
    row,
    filled: false,
    buffId: null,
    buffName: null,
    buffShort: null,
    buffColor: null,
    damageMultiplier: 1,
    alwaysFire: false,
    alwaysCurse: false,
    alwaysSlow: false,
    alwaysFreeze: false,
    alwaysPushback: false,
    alwaysPenetrate: false,
    alwaysSplit: false,
    alwaysRicochet: false,
    relayMultiplier: false,
    dividerMultiplier: false,
    mergerMultiplier: false,
    upLink: false,
    downLink: false,
    specialMultiplier: 1,
    baseEnergy: isFrontColumn ? 1 : SOURCE_ROW_ENERGY,
  };
}

function createColumn(index) {
  return {
    index,
    slots: Array.from({ length: ROWS }, (_, row) => createSlot(row, index === 0)),
  };
}

function getUpgradeCostForPurchase(upgradesPurchased) {
  return Math.ceil(INITIAL_UPGRADE_COST * UPGRADE_COST_GROWTH ** upgradesPurchased);
}

function getRandomCards() {
  const pool = [...BUFF_LIBRARY];
  const picks = [];

  while (picks.length < 3 && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(index, 1)[0]);
  }

  return picks;
}

export function createWeaponNetwork() {
  return {
    rows: ROWS,
    maxColumns: MAX_COLUMNS,
    columns: [createColumn(0), createColumn(1)],
    engineMultiplier: 1,
    activeColumn: 0,
    upgradesPurchased: 0,
    nextUpgradeScore: getUpgradeCostForPurchase(0),
    upgradeCost: getUpgradeCostForPurchase(0),
    upgrade: {
      active: false,
      mode: "normal",
      step: "card",
      cards: [],
      selectedCardIndex: 0,
      pendingCard: null,
      selectedColumn: 0,
      selectedRow: 0,
    },
  };
}

export function getSlot(network, columnIndex, row) {
  return network.columns[columnIndex]?.slots[row] ?? null;
}

export function getActiveColumn(network) {
  return network.columns[network.activeColumn];
}

export function getFirstEmptyRow(network) {
  const column = getActiveColumn(network);
  if (!column) {
    return 0;
  }

  const index = column.slots.findIndex((slot) => !slot.filled);
  return index === -1 ? 0 : index;
}

export function hasAvailableUpgrade(network) {
  return network.columns.some((column) => column.slots.some((slot) => !slot.filled));
}

export function isColumnFilled(column) {
  return column.slots.every((slot) => slot.filled);
}

export function isNetworkComplete(network) {
  return (
    network.columns.length === network.maxColumns &&
    network.columns.every((column) => isColumnFilled(column))
  );
}

export function countCompletedColumns(network) {
  return network.columns.filter((column) => isColumnFilled(column)).length;
}

export function beginUpgrade(network) {
  network.upgrade.active = true;
  network.upgrade.mode = "normal";
  network.upgrade.step = "card";
  network.upgrade.cards = getRandomCards();
  network.upgrade.selectedCardIndex = 0;
  network.upgrade.pendingCard = null;
  const firstEmpty = getFirstEmptyTarget(network);
  network.upgrade.selectedColumn = firstEmpty.columnIndex;
  network.upgrade.selectedRow = firstEmpty.row;
}

function getFirstEmptyTarget(network) {
  for (let columnIndex = 0; columnIndex < network.columns.length; columnIndex += 1) {
    const row = network.columns[columnIndex].slots.findIndex((slot) => !slot.filled);
    if (row !== -1) {
      return { columnIndex, row };
    }
  }

  return { columnIndex: Math.max(0, network.activeColumn), row: 0 };
}

function getFirstFilledTarget(network) {
  for (let columnIndex = 0; columnIndex < network.columns.length; columnIndex += 1) {
    const row = network.columns[columnIndex].slots.findIndex((slot) => slot.filled);
    if (row !== -1) {
      return { columnIndex, row };
    }
  }

  return { columnIndex: 0, row: 0 };
}

export function beginSpecialUpgrade(network) {
  const firstFilled = getFirstFilledTarget(network);
  network.upgrade.active = true;
  network.upgrade.mode = "special";
  network.upgrade.step = "card";
  network.upgrade.cards = SPECIAL_UPGRADE_CARDS;
  network.upgrade.selectedCardIndex = 0;
  network.upgrade.pendingCard = null;
  network.upgrade.selectedColumn = firstFilled.columnIndex;
  network.upgrade.selectedRow = firstFilled.row;
}

export function moveCardSelection(network, direction) {
  const count = network.upgrade.cards.length;
  network.upgrade.selectedCardIndex =
    (network.upgrade.selectedCardIndex + direction + count) % count;
}

export function chooseCard(network, cardIndex = network.upgrade.selectedCardIndex) {
  const card = network.upgrade.cards[cardIndex];
  if (!card) {
    return false;
  }

  if (network.upgrade.mode === "special" && card.target === "none") {
    network.engineMultiplier *= 1 + ENGINE_OVERCLOCK_STEP;
    network.upgrade.active = false;
    network.upgrade.pendingCard = null;
    network.upgrade.cards = [];
    network.upgrade.step = "card";
    return true;
  }

  network.upgrade.pendingCard = card;
  network.upgrade.selectedCardIndex = cardIndex;
  network.upgrade.step = "slot";
  if (network.upgrade.mode === "special") {
    const firstFilled = getFirstFilledTarget(network);
    network.upgrade.selectedColumn = firstFilled.columnIndex;
    network.upgrade.selectedRow = firstFilled.row;
  } else {
    const firstEmpty = getFirstEmptyTarget(network);
    network.upgrade.selectedColumn = firstEmpty.columnIndex;
    network.upgrade.selectedRow = firstEmpty.row;
  }
  return true;
}

export function moveRowSelection(network, direction) {
  const column = network.columns[network.upgrade.selectedColumn];
  if (!column) {
    return;
  }

  const targetRows = column.slots
    .map((slot, row) => ({ slot, row }))
    .filter(({ slot }) => (network.upgrade.mode === "special" ? slot.filled : !slot.filled))
    .map(({ row }) => row);

  if (targetRows.length === 0) {
    return;
  }

  const currentIndex = Math.max(0, targetRows.indexOf(network.upgrade.selectedRow));
  const nextIndex = (currentIndex + direction + targetRows.length) % targetRows.length;
  network.upgrade.selectedRow = targetRows[nextIndex];
}

export function moveColumnSelection(network, direction) {
  const selectableColumns = network.columns
    .map((column, columnIndex) => ({ column, columnIndex }))
    .filter(({ column }) =>
      network.upgrade.mode === "special"
        ? column.slots.some((slot) => slot.filled)
        : column.slots.some((slot) => !slot.filled),
    )
    .map(({ columnIndex }) => columnIndex);

  if (selectableColumns.length === 0) {
    return;
  }

  const currentIndex = Math.max(0, selectableColumns.indexOf(network.upgrade.selectedColumn));
  const nextIndex = (currentIndex + direction + selectableColumns.length) % selectableColumns.length;
  network.upgrade.selectedColumn = selectableColumns[nextIndex];

  const nextColumn = network.columns[network.upgrade.selectedColumn];
  const rowIsSelectable = (row) => {
    const slot = nextColumn.slots[row];
    return network.upgrade.mode === "special" ? slot?.filled : !slot?.filled;
  };

  if (rowIsSelectable(network.upgrade.selectedRow)) {
    return;
  }

  const selectableRows = nextColumn.slots
    .map((slot, row) => ({ slot, row }))
    .filter(({ slot }) => (network.upgrade.mode === "special" ? slot.filled : !slot.filled))
    .map(({ row }) => row);

  if (selectableRows.length === 0) {
    network.upgrade.selectedRow = 0;
    return;
  }

  let bestRow = selectableRows[0];
  let bestDistance = Math.abs(bestRow - network.upgrade.selectedRow);
  for (const row of selectableRows) {
    const distance = Math.abs(row - network.upgrade.selectedRow);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRow = row;
    }
  }
  network.upgrade.selectedRow = bestRow;
}

function syncActiveColumn(network) {
  const firstIncomplete = network.columns.findIndex((column) => column.slots.some((slot) => !slot.filled));
  network.activeColumn = firstIncomplete === -1 ? network.columns.length - 1 : firstIncomplete;
}

function resetSlot(slot, row, isFrontColumn) {
  const fresh = createSlot(row, isFrontColumn);
  Object.assign(slot, fresh);
}

export function applyUpgradeToSelectedRow(network) {
  if (network.upgrade.mode === "special") {
    const card = network.upgrade.pendingCard;
    const column = network.columns[network.upgrade.selectedColumn];
    const slot = column?.slots[network.upgrade.selectedRow];
    if (!card || !slot || !slot.filled) {
      return false;
    }

    if (card.id === "reset_lens") {
      resetSlot(slot, network.upgrade.selectedRow, network.upgrade.selectedColumn === 0);
      syncActiveColumn(network);
    } else if (card.id === "empower_lens") {
      slot.specialMultiplier = Math.min(
        MAX_SPECIAL_MULTIPLIER,
        slot.specialMultiplier * (1 + SPECIAL_EMPOWER_STEP),
      );
    } else {
      return false;
    }

    network.upgrade.active = false;
    network.upgrade.pendingCard = null;
    network.upgrade.cards = [];
    network.upgrade.step = "card";
    return true;
  }

  const column = network.columns[network.upgrade.selectedColumn];
  const card = network.upgrade.pendingCard;
  const slot = column?.slots[network.upgrade.selectedRow];

  if (!column || !card || !slot || slot.filled) {
    return false;
  }

  slot.filled = true;
  slot.buffId = card.id;
  slot.buffName = card.name;
  slot.buffShort = card.short;
  slot.buffColor = card.color;
  card.apply(slot);

  network.upgrade.active = false;
  network.upgrade.pendingCard = null;
  network.upgrade.cards = [];
  network.upgrade.step = "card";

  const allExistingColumnsFilled = network.columns.every((existingColumn) => isColumnFilled(existingColumn));

    if (allExistingColumnsFilled && network.columns.length < network.maxColumns) {
      network.columns.push(createColumn(network.columns.length));
      network.activeColumn = network.columns.length - 1;
    } else {
      syncActiveColumn(network);
    }

    network.upgradesPurchased += 1;
    network.upgradeCost = getUpgradeCostForPurchase(network.upgradesPurchased);
    network.nextUpgradeScore += network.upgradeCost;
    return true;
  }

function pushUnique(list, values) {
  for (const value of values) {
    if (value && !list.includes(value)) {
      list.push(value);
    }
  }
}

function cloneSignal(signal) {
  if (!signal) {
    return null;
  }

  return {
    energy: signal.energy,
    amp: signal.amp,
    flatDamage: signal.flatDamage,
    fire: signal.fire,
    curse: signal.curse,
    slow: signal.slow,
    freeze: signal.freeze,
    pushback: signal.pushback,
    penetration: signal.penetration,
    split: signal.split,
    ricochet: signal.ricochet,
    buffNames: [...signal.buffNames],
    buffShorts: [...signal.buffShorts],
    buffColors: [...signal.buffColors],
  };
}

function mergeSignals(signals) {
  const validSignals = signals.filter(Boolean);
  if (validSignals.length === 0) {
    return null;
  }

  const merged = {
    energy: 0,
    amp: 1,
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

  for (const signal of validSignals) {
    merged.energy += signal.energy;
    merged.amp *= signal.amp;
    merged.flatDamage += signal.flatDamage ?? 0;
    merged.fire = merged.fire || signal.fire;
    merged.curse = merged.curse || signal.curse;
    merged.slow = merged.slow || signal.slow;
    merged.freeze = merged.freeze || signal.freeze;
    merged.pushback = merged.pushback || signal.pushback;
    merged.penetration = merged.penetration || signal.penetration;
    merged.split = merged.split || signal.split;
    merged.ricochet = merged.ricochet || signal.ricochet;
    pushUnique(merged.buffNames, signal.buffNames);
    pushUnique(merged.buffShorts, signal.buffShorts);
    pushUnique(merged.buffColors, signal.buffColors);
  }

  return merged;
}

function decorateSignal(signal, slot) {
  if (!signal || !slot.filled) {
    return signal;
  }

  pushUnique(signal.buffNames, [slot.buffName]);
  pushUnique(signal.buffShorts, [slot.buffShort]);
  pushUnique(signal.buffColors, [slot.buffColor]);
  return signal;
}

function createLocalSignal(
  slot,
  row,
  columnIndex,
  sourceColumnIndex,
  engineMultiplier,
  hasIncomingSignal,
  dispatchRow,
) {
  const receivesSource =
    columnIndex === sourceColumnIndex && (dispatchRow == null || row === dispatchRow);
  const contributesEnergy = receivesSource || hasIncomingSignal;

  if (!contributesEnergy) {
    return null;
  }

  const signal = {
    energy: (receivesSource ? SOURCE_ROW_ENERGY : slot.baseEnergy) * (receivesSource ? engineMultiplier : 1),
    amp: slot.damageMultiplier,
    flatDamage: slot.filled ? UPGRADE_FLAT_DAMAGE : 0,
    fire: slot.alwaysFire,
    curse: slot.alwaysCurse,
    slow: slot.alwaysSlow,
    freeze: slot.alwaysFreeze,
    pushback: slot.alwaysPushback,
    penetration: slot.alwaysPenetrate,
    split: slot.alwaysSplit,
    ricochet: slot.alwaysRicochet,
    buffNames: [],
    buffShorts: [],
    buffColors: [],
  };

  return decorateSignal(signal, slot);
}

function createInjectedSignal(slot, energy) {
  const signal = {
    energy,
    amp: slot.damageMultiplier,
    flatDamage: slot.filled ? UPGRADE_FLAT_DAMAGE : 0,
    fire: slot.alwaysFire,
    curse: slot.alwaysCurse,
    slow: slot.alwaysSlow,
    freeze: slot.alwaysFreeze,
    pushback: slot.alwaysPushback,
    penetration: slot.alwaysPenetrate,
    split: slot.alwaysSplit,
    ricochet: slot.alwaysRicochet,
    buffNames: [],
    buffShorts: [],
    buffColors: [],
  };

  return decorateSignal(signal, slot);
}

function amplifySignal(signal, factor, slot) {
  const next = cloneSignal(signal);
  if (!next) {
    return null;
  }

  next.amp *= factor;
  return decorateSignal(next, slot);
}

function scaleSignal(signal, factor, slot) {
  const next = cloneSignal(signal);
  if (!next) {
    return null;
  }

  next.energy *= factor;
  return slot ? decorateSignal(next, slot) : next;
}

function applySlotBoost(signal, slot) {
  const next = cloneSignal(signal);
  if (!next) {
    return null;
  }

  next.amp *= slot?.specialMultiplier ?? 1;
  return next;
}

function createEmptyNodes(columnCount) {
  return Array.from({ length: columnCount }, () =>
    Array.from({ length: ROWS }, () => ({
      active: false,
      energy: 0,
      amp: 0,
      flatDamage: 0,
      damage: 0,
      buffNames: [],
      buffColors: [],
      buffShorts: [],
    })),
  );
}

function markNode(nodes, columnIndex, row, signal) {
  if (!signal) {
    return;
  }

  const node = nodes[columnIndex][row];
  node.active = true;
  node.energy = signal.energy;
  node.amp = signal.amp;
  node.flatDamage = signal.flatDamage ?? 0;
  node.damage = Math.max(1, Math.round((signal.energy * signal.amp + (signal.flatDamage ?? 0)) * 10) / 10);
  pushUnique(node.buffNames, signal.buffNames);
  pushUnique(node.buffColors, signal.buffColors);
  pushUnique(node.buffShorts, signal.buffShorts);
}

function buildConnection(from, to, signal) {
  return {
    id: `${from.type}:${from.column ?? "src"}:${from.row}->${to.type}:${to.column ?? "dst"}:${to.row}`,
    from,
    to,
    active: Boolean(signal),
    buffColors: signal ? [...signal.buffColors] : [],
  };
}

function createForwardTarget(columnIndex, row) {
  if (columnIndex > 0) {
    return { type: "column", column: columnIndex - 1, row };
  }
  return { type: "gun", row: 0 };
}

export function cloneWeaponNetwork(network) {
  return {
    ...network,
    columns: network.columns.map((column) => ({
      ...column,
      slots: column.slots.map((slot) => ({ ...slot })),
    })),
    upgrade: {
      ...network.upgrade,
      cards: [...network.upgrade.cards],
    },
  };
}

export function createPreviewNetwork(network) {
  const preview = cloneWeaponNetwork(network);
  const { pendingCard, step, selectedColumn, selectedRow } = preview.upgrade;
  if (step !== "slot" || !pendingCard) {
    return preview;
  }

  if (preview.upgrade.mode === "special") {
    const column = preview.columns[selectedColumn];
    const slot = column?.slots[selectedRow];
    if (!slot) {
      return preview;
    }

    if (pendingCard.id === "reset_lens" && slot.filled) {
      resetSlot(slot, selectedRow, selectedColumn === 0);
      syncActiveColumn(preview);
    }

    if (pendingCard.id === "empower_lens" && slot.filled) {
      slot.specialMultiplier = Math.min(
        MAX_SPECIAL_MULTIPLIER,
        slot.specialMultiplier * (1 + SPECIAL_EMPOWER_STEP),
      );
    }

    return preview;
  }

  const column = preview.columns[selectedColumn];
  const slot = column?.slots[selectedRow];
  if (!slot || slot.filled) {
    return preview;
  }

  slot.filled = true;
  slot.buffId = pendingCard.id;
  slot.buffName = pendingCard.name;
  slot.buffShort = pendingCard.short;
  slot.buffColor = pendingCard.color;
  pendingCard.apply(slot);
  return preview;
}

export function resolveWeaponOutputs(network, options = {}) {
  const nodes = createEmptyNodes(network.columns.length);
  const connections = [];
  const sourceColumnIndex = network.columns.length - 1;
  const dispatchRow = options.dispatchRow ?? null;
  const injectedNode = options.injectedNode ?? null;
  const injectedEnergy =
    options.injectedEnergy ?? SOURCE_ROW_ENERGY * (network.engineMultiplier ?? 1);
  let incoming = Array.from({ length: ROWS }, () => null);

  for (let columnIndex = network.columns.length - 1; columnIndex >= 0; columnIndex -= 1) {
    const column = network.columns[columnIndex];
    const outgoingLists = Array.from({ length: ROWS }, () => []);
    const baseSignals = Array.from({ length: ROWS }, () => null);
    const localAdditions = Array.from({ length: ROWS }, () => []);
    const retainedShare = Array.from({ length: ROWS }, () => 1);
    const mergerConsumers = Array.from({ length: ROWS }, () => []);

    for (let row = 0; row < ROWS; row += 1) {
      const slot = column.slots[row];
      const active =
        columnIndex === 0 ||
        columnIndex === sourceColumnIndex ||
        slot.filled ||
        Boolean(incoming[row]);
      if (!active) {
        continue;
      }

      const localSignal = createLocalSignal(
        slot,
        row,
        columnIndex,
        sourceColumnIndex,
        network.engineMultiplier,
        Boolean(incoming[row]),
        dispatchRow,
      );
      const injectedSignal =
        injectedNode &&
        injectedNode.columnIndex === columnIndex &&
        injectedNode.row === row
          ? createInjectedSignal(slot, injectedEnergy)
          : null;
      const combined = mergeSignals([incoming[row], localSignal, injectedSignal]);
      if (!combined) {
        continue;
      }

      baseSignals[row] = combined;

      if (incoming[row]) {
        connections.push(
          buildConnection(
            { type: "column", column: columnIndex + 1, row },
            { type: "column", column: columnIndex, row },
            incoming[row],
          ),
        );
      }
      if (columnIndex === sourceColumnIndex && localSignal) {
        connections.push(
          buildConnection(
            { type: "engine", row: 0 },
            { type: "column", column: sourceColumnIndex, row },
            localSignal,
          ),
        );
      }
    }

    for (let row = 0; row < ROWS; row += 1) {
      const slot = column.slots[row];
      if (!slot?.mergerMultiplier) {
        continue;
      }

      if (row > 0 && baseSignals[row - 1]) {
        mergerConsumers[row - 1].push(row);
      }
      if (row < ROWS - 1 && baseSignals[row + 1]) {
        mergerConsumers[row + 1].push(row);
      }
    }

    for (let row = 0; row < ROWS; row += 1) {
      const slot = column.slots[row];
      const signal = baseSignals[row];
      if (!slot || !signal) {
        continue;
      }

      if (slot.dividerMultiplier) {
        retainedShare[row] *= 1 - DIVIDER_SPLIT_SHARE;
        const branchBase = scaleSignal(applySlotBoost(signal, slot), DIVIDER_SPLIT_SHARE);
        if (row > 0) {
          const branchUp = amplifySignal(branchBase, 1 + DIVIDER_BONUS_STEP, slot);
          localAdditions[row - 1].push(branchUp);
          connections.push(
            buildConnection(
              { type: "column", column: columnIndex, row },
              { type: "column", column: columnIndex, row: row - 1 },
              branchUp,
            ),
          );
        }
        if (row < ROWS - 1) {
          const branchDown = amplifySignal(branchBase, 1 + DIVIDER_BONUS_STEP, slot);
          localAdditions[row + 1].push(branchDown);
          connections.push(
            buildConnection(
              { type: "column", column: columnIndex, row },
              { type: "column", column: columnIndex, row: row + 1 },
              branchDown,
            ),
          );
        }
      }

      if (mergerConsumers[row].length > 0) {
        retainedShare[row] *= 1 - MERGER_PULL_SHARE;
        const share = MERGER_PULL_SHARE / mergerConsumers[row].length;
        for (const targetRow of mergerConsumers[row]) {
          const mergerSlot = column.slots[targetRow];
          const siphon = amplifySignal(scaleSignal(signal, share), 1 + MERGER_BONUS_STEP, mergerSlot);
          localAdditions[targetRow].push(siphon);
          connections.push(
            buildConnection(
              { type: "column", column: columnIndex, row },
              { type: "column", column: columnIndex, row: targetRow },
              siphon,
            ),
          );
        }
      }
    }

    for (let row = 0; row < ROWS; row += 1) {
      const slot = column.slots[row];
      const baseSignal = baseSignals[row];
      const retained = baseSignal ? scaleSignal(baseSignal, retainedShare[row]) : null;
      const current = applySlotBoost(mergeSignals([retained, ...localAdditions[row]]), slot);
      if (!slot || !current) {
        continue;
      }

      markNode(nodes, columnIndex, row, current);

      const forwardCurrent = slot.relayMultiplier
        ? amplifySignal(current, 1 + RELAY_BONUS_STEP, slot)
        : current;

      outgoingLists[row].push(forwardCurrent);
      connections.push(
        buildConnection(
          { type: "column", column: columnIndex, row },
          createForwardTarget(columnIndex, row),
          forwardCurrent,
        ),
      );

      if (slot.upLink && row > 0) {
        const upward = amplifySignal(current, 1 + LINK_BONUS_STEP, slot);
        outgoingLists[row - 1].push(cloneSignal(upward));
        connections.push(
          buildConnection(
            { type: "column", column: columnIndex, row },
            createForwardTarget(columnIndex, row - 1),
            upward,
          ),
        );
      }

      if (slot.downLink && row < ROWS - 1) {
        const downward = amplifySignal(current, 1 + LINK_BONUS_STEP, slot);
        outgoingLists[row + 1].push(cloneSignal(downward));
        connections.push(
          buildConnection(
            { type: "column", column: columnIndex, row },
            createForwardTarget(columnIndex, row + 1),
            downward,
          ),
        );
      }
    }

    incoming = outgoingLists.map((list) => mergeSignals(list));
  }

  return {
    nodes,
    connections,
    outputs: incoming.map((signal) => {
      if (!signal) {
        return null;
      }

      return {
        energy: signal.energy,
        flatDamage: signal.flatDamage ?? 0,
        damage: Math.max(1, Math.round((signal.energy * signal.amp + (signal.flatDamage ?? 0)) * 10) / 10),
        fire: signal.fire,
        curse: signal.curse,
        slow: signal.slow,
        freeze: signal.freeze,
        pushback: signal.pushback,
        penetration: signal.penetration,
        split: signal.split,
        ricochet: signal.ricochet,
        buffNames: signal.buffNames,
        buffShorts: signal.buffShorts,
        buffColors: signal.buffColors,
      };
    }),
  };
}

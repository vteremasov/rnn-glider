const ROWS = 5;
const MAX_COLUMNS = 5;
const INITIAL_UPGRADE_COST = 100;

export const BUFF_LIBRARY = [
  {
    id: "multiplier",
    name: "Local Multiplier +10%",
    short: "AMP",
    description: "Amplifies this lens output by 10%.",
    color: "#7ce8b5",
    apply(slot) {
      slot.damageMultiplier += 0.1;
    },
  },
  {
    id: "crit",
    name: "Critical Core",
    short: "CRIT",
    description: "Every shot from this row crits for double damage.",
    color: "#ffd56b",
    apply(slot) {
      slot.alwaysCrit = true;
    },
  },
  {
    id: "fire",
    name: "Fire Core",
    short: "FIRE",
    description:
      "Every shot ignites. Burn deals 20% periodic damage, doubled if this row also crits.",
    color: "#ff8e72",
    apply(slot) {
      slot.alwaysFire = true;
    },
  },
  {
    id: "penetration",
    name: "Penetration",
    short: "PEN",
    description: "Every shot penetrates through the first target.",
    color: "#89b7ff",
    apply(slot) {
      slot.alwaysPenetrate = true;
    },
  },
  {
    id: "overdrive",
    name: "Overdrive +35%",
    short: "OVR",
    description: "Raises this lens output by 35%.",
    color: "#ffb56b",
    apply(slot) {
      slot.damageMultiplier += 0.35;
    },
  },
  {
    id: "uplink",
    name: "Up-Link +10%",
    short: "UP",
    description:
      "Sends the normal signal forward and a second +10% copy into the upper row of the next column.",
    color: "#72e0ff",
    apply(slot) {
      slot.upLink = true;
    },
  },
  {
    id: "downlink",
    name: "Down-Link +10%",
    short: "DOWN",
    description:
      "Sends the normal signal forward and a second +10% copy into the lower row of the next column.",
    color: "#a890ff",
    apply(slot) {
      slot.downLink = true;
    },
  },
  {
    id: "curse",
    name: "Curse Core",
    short: "CURSE",
    description: "Every shot curses. Curse deals periodic void damage.",
    color: "#9a63ff",
    apply(slot) {
      slot.alwaysCurse = true;
    },
  },
  {
    id: "relay_multiplier",
    name: "Back Multiplier +10%",
    short: "BACK",
    description:
      "Does not power this lens. Multiplies all incoming signal from behind by 10% and forwards it.",
    color: "#6bf0da",
    apply(slot) {
      slot.relayMultiplier = true;
    },
  },
  {
    id: "divider_multiplier",
    name: "Divider +10%",
    short: "DIV2",
    description: "Splits incoming signal into top and bottom rows, each amplified by 10%.",
    color: "#7bb4ff",
    apply(slot) {
      slot.dividerMultiplier = true;
    },
  },
  {
    id: "merger_multiplier",
    name: "Merger +10%",
    short: "MRG3",
    description:
      "Merges top, current, and bottom signals, amplifies by 10%, and sends one signal forward.",
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
    alwaysCrit: false,
    alwaysFire: false,
    alwaysCurse: false,
    alwaysPenetrate: false,
    relayMultiplier: false,
    dividerMultiplier: false,
    mergerMultiplier: false,
    upLink: false,
    downLink: false,
    baseEnergy: isFrontColumn ? 1 : 1,
  };
}

function createColumn(index) {
  return {
    index,
    slots: Array.from({ length: ROWS }, (_, row) => createSlot(row, index === 0)),
  };
}

function getUpgradeCostForColumn(columnIndex) {
  return INITIAL_UPGRADE_COST * 2 ** columnIndex;
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
    columns: [createColumn(0)],
    activeColumn: 0,
    nextUpgradeScore: getUpgradeCostForColumn(0),
    upgradeCost: getUpgradeCostForColumn(0),
    upgrade: {
      active: false,
      step: "card",
      cards: [],
      selectedCardIndex: 0,
      pendingCard: null,
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
  const column = getActiveColumn(network);
  return Boolean(column && column.slots.some((slot) => !slot.filled));
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
  network.upgrade.step = "card";
  network.upgrade.cards = getRandomCards();
  network.upgrade.selectedCardIndex = 0;
  network.upgrade.pendingCard = null;
  network.upgrade.selectedRow = getFirstEmptyRow(network);
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

  network.upgrade.pendingCard = card;
  network.upgrade.selectedCardIndex = cardIndex;
  network.upgrade.step = "slot";
  network.upgrade.selectedRow = getFirstEmptyRow(network);
  return true;
}

export function moveRowSelection(network, direction) {
  const column = getActiveColumn(network);
  if (!column) {
    return;
  }

  const empties = column.slots
    .map((slot, row) => ({ slot, row }))
    .filter(({ slot }) => !slot.filled)
    .map(({ row }) => row);

  if (empties.length === 0) {
    return;
  }

  const currentIndex = Math.max(0, empties.indexOf(network.upgrade.selectedRow));
  const nextIndex = (currentIndex + direction + empties.length) % empties.length;
  network.upgrade.selectedRow = empties[nextIndex];
}

export function applyUpgradeToSelectedRow(network) {
  const column = getActiveColumn(network);
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

  if (isColumnFilled(column) && network.columns.length < network.maxColumns) {
    network.columns.push(createColumn(network.columns.length));
    network.activeColumn = network.columns.length - 1;
    network.upgradeCost = getUpgradeCostForColumn(network.activeColumn);
  }

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
    crit: signal.crit,
    fire: signal.fire,
    curse: signal.curse,
    penetration: signal.penetration,
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
    crit: false,
    fire: false,
    curse: false,
    penetration: false,
    buffNames: [],
    buffShorts: [],
    buffColors: [],
  };

  for (const signal of validSignals) {
    merged.energy += signal.energy;
    merged.amp *= signal.amp;
    merged.crit = merged.crit || signal.crit;
    merged.fire = merged.fire || signal.fire;
    merged.curse = merged.curse || signal.curse;
    merged.penetration = merged.penetration || signal.penetration;
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

function isTransformOnly(slot) {
  return slot.relayMultiplier || slot.dividerMultiplier || slot.mergerMultiplier;
}

function createLocalSignal(slot, columnIndex, sourceColumnIndex) {
  const receivesSource = columnIndex === sourceColumnIndex;
  const contributesEnergy = receivesSource || columnIndex === 0 || slot.filled;

  if (!contributesEnergy || isTransformOnly(slot)) {
    return null;
  }

  const signal = {
    energy: slot.baseEnergy,
    amp: slot.damageMultiplier,
    crit: slot.alwaysCrit,
    fire: slot.alwaysFire,
    curse: slot.alwaysCurse,
    penetration: slot.alwaysPenetrate,
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

function createEmptyNodes(columnCount) {
  return Array.from({ length: columnCount }, () =>
    Array.from({ length: ROWS }, () => ({ active: false, buffColors: [], buffShorts: [] })),
  );
}

function markNode(nodes, columnIndex, row, signal) {
  if (!signal) {
    return;
  }

  const node = nodes[columnIndex][row];
  node.active = true;
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
  const { pendingCard, step, selectedRow } = preview.upgrade;
  if (step !== "slot" || !pendingCard) {
    return preview;
  }

  const column = preview.columns[preview.activeColumn];
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

export function resolveWeaponOutputs(network) {
  const nodes = createEmptyNodes(network.columns.length);
  const connections = [];
  const sourceColumnIndex = network.columns.length - 1;
  let incoming = Array.from({ length: ROWS }, () => null);

  for (let columnIndex = network.columns.length - 1; columnIndex >= 0; columnIndex -= 1) {
    const column = network.columns[columnIndex];
    const outgoingLists = Array.from({ length: ROWS }, () => []);
    const claimedRows = new Set();

    for (let row = 0; row < ROWS; row += 1) {
      const slot = column.slots[row];
      const active = columnIndex === 0 || columnIndex === sourceColumnIndex || slot.filled;
      if (!active || !slot.mergerMultiplier) {
        continue;
      }

      const sourceRows = [row - 1, row, row + 1].filter((value) => value >= 0 && value < ROWS);
      if (sourceRows.some((value) => claimedRows.has(value))) {
        continue;
      }

      const merged = mergeSignals(sourceRows.map((value) => incoming[value]));
      if (!merged) {
        continue;
      }

      markNode(nodes, columnIndex, row, merged);
      for (const value of sourceRows) {
        if (incoming[value]) {
          connections.push(
            buildConnection(
              { type: "column", column: columnIndex + 1, row: value },
              { type: "column", column: columnIndex, row },
              incoming[value],
            ),
          );
        }
      }

      const outgoing = amplifySignal(merged, 1.1, slot);
      outgoingLists[row].push(outgoing);
      if (columnIndex > 0) {
        connections.push(
          buildConnection(
            { type: "column", column: columnIndex, row },
            { type: "column", column: columnIndex - 1, row },
            outgoing,
          ),
        );
      }
      for (const value of sourceRows) {
        claimedRows.add(value);
      }
    }

    for (let row = 0; row < ROWS; row += 1) {
      if (claimedRows.has(row)) {
        continue;
      }

      const slot = column.slots[row];
      const active = columnIndex === 0 || columnIndex === sourceColumnIndex || slot.filled;
      if (!active) {
        continue;
      }

      const localSignal = createLocalSignal(slot, columnIndex, sourceColumnIndex);
      const combined = mergeSignals([incoming[row], localSignal]);
      if (!combined) {
        continue;
      }

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
            { type: "divider", row },
            { type: "column", column: sourceColumnIndex, row },
            localSignal,
          ),
        );
      }
      markNode(nodes, columnIndex, row, combined);

      if (slot.relayMultiplier) {
        const outgoing = amplifySignal(combined, 1.1, slot);
        outgoingLists[row].push(outgoing);
        if (columnIndex > 0) {
          connections.push(
            buildConnection(
              { type: "column", column: columnIndex, row },
              { type: "column", column: columnIndex - 1, row },
              outgoing,
            ),
          );
        }
        continue;
      }

      if (slot.dividerMultiplier) {
        const divided = amplifySignal(combined, 1.1, slot);
        if (row > 0) {
          outgoingLists[row - 1].push(cloneSignal(divided));
          if (columnIndex > 0) {
            connections.push(
              buildConnection(
                { type: "column", column: columnIndex, row },
                { type: "column", column: columnIndex - 1, row: row - 1 },
                divided,
              ),
            );
          }
        }
        if (row < ROWS - 1) {
          outgoingLists[row + 1].push(cloneSignal(divided));
          if (columnIndex > 0) {
            connections.push(
              buildConnection(
                { type: "column", column: columnIndex, row },
                { type: "column", column: columnIndex - 1, row: row + 1 },
                divided,
              ),
            );
          }
        }
        continue;
      }

      outgoingLists[row].push(combined);
      if (columnIndex > 0) {
        connections.push(
          buildConnection(
            { type: "column", column: columnIndex, row },
            { type: "column", column: columnIndex - 1, row },
            combined,
          ),
        );
      }

      if (slot.upLink && row > 0 && columnIndex > 0) {
        const upward = amplifySignal(combined, 1.1, slot);
        outgoingLists[row - 1].push(cloneSignal(upward));
        connections.push(
          buildConnection(
            { type: "column", column: columnIndex, row },
            { type: "column", column: columnIndex - 1, row: row - 1 },
            upward,
          ),
        );
      }

      if (slot.downLink && row < ROWS - 1 && columnIndex > 0) {
        const downward = amplifySignal(combined, 1.1, slot);
        outgoingLists[row + 1].push(cloneSignal(downward));
        connections.push(
          buildConnection(
            { type: "column", column: columnIndex, row },
            { type: "column", column: columnIndex - 1, row: row + 1 },
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
        damage: Math.max(1, Math.round(signal.energy * signal.amp * 10) / 10),
        crit: signal.crit,
        fire: signal.fire,
        curse: signal.curse,
        penetration: signal.penetration,
        buffNames: signal.buffNames,
        buffShorts: signal.buffShorts,
        buffColors: signal.buffColors,
      };
    }),
  };
}

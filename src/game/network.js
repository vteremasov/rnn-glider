import { LANE_COUNT, NETWORK_LAYERS, clamp } from "./config.js";

function createGrid() {
  return Array.from({ length: NETWORK_LAYERS }, () => Array(LANE_COUNT).fill(0));
}

function createEdgeFlows() {
  return Array.from({ length: Math.max(0, NETWORK_LAYERS - 1) }, () => ({
    forward: Array(LANE_COUNT).fill(0),
    left: Array(LANE_COUNT).fill(0),
    right: Array(LANE_COUNT).fill(0),
    resonanceLeft: Array(LANE_COUNT).fill(0),
    resonanceRight: Array(LANE_COUNT).fill(0),
    dividerLeft: Array(LANE_COUNT).fill(0),
    dividerRight: Array(LANE_COUNT).fill(0),
    mergerLeft: Array(LANE_COUNT).fill(0),
    mergerRight: Array(LANE_COUNT).fill(0),
  }));
}

function cloneEdgeFlows(edgeFlows) {
  return edgeFlows.map((flow) => ({
    forward: flow.forward.slice(),
    left: flow.left.slice(),
    right: flow.right.slice(),
    resonanceLeft: flow.resonanceLeft.slice(),
    resonanceRight: flow.resonanceRight.slice(),
    dividerLeft: flow.dividerLeft.slice(),
    dividerRight: flow.dividerRight.slice(),
    mergerLeft: flow.mergerLeft.slice(),
    mergerRight: flow.mergerRight.slice(),
  }));
}

function scaleFlow(flow, amount) {
  return {
    forward: flow.forward.map((value) => value * amount),
    left: flow.left.map((value) => value * amount),
    right: flow.right.map((value) => value * amount),
    resonanceLeft: flow.resonanceLeft.map((value) => value * amount),
    resonanceRight: flow.resonanceRight.map((value) => value * amount),
    dividerLeft: flow.dividerLeft.map((value) => value * amount),
    dividerRight: flow.dividerRight.map((value) => value * amount),
    mergerLeft: flow.mergerLeft.map((value) => value * amount),
    mergerRight: flow.mergerRight.map((value) => value * amount),
  };
}

function smoothArray(target, source, riseAmount, fallAmount) {
  for (let index = 0; index < target.length; index += 1) {
    const amount = source[index] >= target[index] ? riseAmount : fallAmount;
    target[index] += (source[index] - target[index]) * amount;
  }
}

function smoothDisplayState(state, delta) {
  const riseAmount = clamp(1 - Math.exp(-delta * 8.5), 0.08, 0.28);
  const fallAmount = clamp(1 - Math.exp(-delta * 18), 0.22, 0.62);
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    smoothArray(state.displayGrid[layer], state.grid[layer], riseAmount, fallAmount);
  }
  for (let layer = 0; layer < NETWORK_LAYERS - 1; layer += 1) {
    const displayFlow = state.displayEdgeFlows[layer];
    const sourceFlow = state.edgeFlows[layer];
    smoothArray(displayFlow.forward, sourceFlow.forward, riseAmount, fallAmount);
    smoothArray(displayFlow.left, sourceFlow.left, riseAmount, fallAmount);
    smoothArray(displayFlow.right, sourceFlow.right, riseAmount, fallAmount);
    smoothArray(displayFlow.resonanceLeft, sourceFlow.resonanceLeft, riseAmount, fallAmount);
    smoothArray(displayFlow.resonanceRight, sourceFlow.resonanceRight, riseAmount, fallAmount);
    smoothArray(displayFlow.dividerLeft, sourceFlow.dividerLeft, riseAmount, fallAmount);
    smoothArray(displayFlow.dividerRight, sourceFlow.dividerRight, riseAmount, fallAmount);
    smoothArray(displayFlow.mergerLeft, sourceFlow.mergerLeft, riseAmount, fallAmount);
    smoothArray(displayFlow.mergerRight, sourceFlow.mergerRight, riseAmount, fallAmount);
  }
}

function createNode() {
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

function createNodes() {
  return Array.from({ length: NETWORK_LAYERS }, () => Array.from({ length: LANE_COUNT }, () => createNode()));
}

function mergeGrids(target, source) {
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      target[layer][lane] += source[layer][lane];
    }
  }
}

function mergeEdgeFlows(target, source) {
  for (let layer = 0; layer < NETWORK_LAYERS - 1; layer += 1) {
    for (const key of Object.keys(target[layer])) {
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        target[layer][key][lane] += source[layer][key][lane];
      }
    }
  }
}

function packetOverdrive(state, grid) {
  let total = 0;
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      if ((grid[layer][lane] || 0) <= 0.12) {
        continue;
      }
      total += state.nodes[layer][lane].effects.overdrive || 0;
    }
  }
  return total;
}

function packetSummons(state, grid) {
  const summons = [];
  let packetFire = 0;
  let packetCurse = 0;
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      if ((grid[layer][lane] || 0) <= 0.12) {
        continue;
      }
      packetFire += state.nodes[layer][lane].effects.fire || 0;
      packetCurse += state.nodes[layer][lane].effects.curse || 0;
    }
  }

  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      if ((grid[layer][lane] || 0) <= 0.12) {
        continue;
      }
      const count = Math.max(0, Math.round(state.nodes[layer][lane].effects.summon || 0));
      for (let index = 0; index < count; index += 1) {
        summons.push({ layer, lane, fire: packetFire, curse: packetCurse });
      }
    }
  }
  return summons;
}

function effectiveChargeStep(baseStep, globalMultiplier) {
  const multiplier = Math.max(0.25, globalMultiplier || 1);
  return baseStep / multiplier;
}

function sameTypeResonancePair(state, layerIndex, leftLane, rightLane) {
  if (!state.sameTypeResonance) {
    return false;
  }
  if (leftLane < 0 || rightLane >= LANE_COUNT) {
    return false;
  }
  const layer = state.nodes[layerIndex];
  if (!layer) {
    return false;
  }
  const left = layer[leftLane];
  const right = layer[rightLane];
  if (!left || !right || !left.appearance || !right.appearance) {
    return false;
  }
  return !!left.appearance.id && left.appearance.id === right.appearance.id;
}

function seededSource(state, lane) {
  const node = state.nodes[0][lane];
  const base = state.sourceEnergy;
  return base + node.power * 0.8;
}

function buildStagedPacket(packet, stage, progress) {
  const grid = createGrid();
  const edgeFlows = createEdgeFlows();
  const clampedStage = clamp(stage, 0, NETWORK_LAYERS - 1);
  const clampedProgress = clamp(progress, 0, 1);

  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    if (layer < clampedStage) {
      grid[layer] = packet.grid[layer].slice();
    } else if (layer === clampedStage) {
      grid[layer] = packet.grid[layer].map((value) => value * clampedProgress);
    }
  }

  for (let layer = 0; layer < NETWORK_LAYERS - 1; layer += 1) {
    if (layer < clampedStage - 1) {
      edgeFlows[layer] = scaleFlow(packet.edgeFlows[layer], 1);
    } else if (layer === clampedStage - 1) {
      edgeFlows[layer] = scaleFlow(packet.edgeFlows[layer], clampedProgress);
    }
  }

  return { grid, edgeFlows };
}

function startCycle(state) {
  state.cycleTimer = 0;
  state.stepTimer = 0;
  state.propagatedLayers = 0;
  state.firedThisCycle = false;
  state.pendingShot = null;
  state.grid = createGrid();
  state.edgeFlows = createEdgeFlows();
  if (!state.displayGrid) {
    state.displayGrid = createGrid();
  }
  if (!state.displayEdgeFlows) {
    state.displayEdgeFlows = createEdgeFlows();
  }
  state.sourcePulse = 1;
  state.currentSourceLane = 0;
  state.inputChargeTimer = 0;
  state.inputChargeStep = state.baseInputChargeStep;
  state.inputStage = 0;
  state.outputChargeIndex = 0;
  state.outputChargeTimer = 0;
  state.outputChargeStep = state.baseOutputChargeStep;
  state.queuedShots = [];
  state.currentOutputs = [];
  state.activeInputLane = 0;
  state.legendaryOpening = false;
  state.previewPacket = null;
  state.pendingSummons = [];
}

export function createNetworkState() {
  const state = {
    grid: createGrid(),
    edgeFlows: createEdgeFlows(),
    displayGrid: createGrid(),
    displayEdgeFlows: createEdgeFlows(),
    nodes: createNodes(),
    cycleTimer: 0,
    cycleDuration: 0,
    propagationStep: 0.55,
    stepTimer: 0,
    propagatedLayers: 0,
    sourceEnergy: 3,
    signalRetention: 0.84,
    lastOutputs: Array(LANE_COUNT).fill(0),
    firedThisCycle: false,
    upgradeCounts: {},
    pendingShot: null,
    sourcePulse: 0,
    activeInputLane: 0,
    currentSourceLane: 0,
    inputChargeTimer: 0,
    baseInputChargeStep: 0.24,
    inputChargeStep: 0.24,
    inputStage: 0,
    outputChargeIndex: 0,
    outputChargeTimer: 0,
    baseOutputChargeStep: 0.28,
    outputChargeStep: 0.28,
    currentOutputs: [],
    queuedShots: [],
    legendaryOpening: false,
    previewPacket: null,
    globalFireRateMultiplier: 1,
    sameTypeResonance: false,
    pendingSummons: [],
  };
  startCycle(state);
  return state;
}

function outputsFromSourceLane(state, sourceLane) {
  const grid = createGrid();
  const edgeFlows = createEdgeFlows();
  grid[0][sourceLane] = seededSource(state, sourceLane);
  for (let layer = 0; layer < NETWORK_LAYERS - 1; layer += 1) {
    const propagation = propagateLayer(grid[layer], state, layer);
    grid[layer + 1] = propagation.next;
    edgeFlows[layer] = propagation.flows;
  }
  const rawOutputs = resolveOutputLayer(grid[NETWORK_LAYERS - 1], state);
  grid[NETWORK_LAYERS - 1] = rawOutputs.slice();
  return {
    grid,
    edgeFlows,
    rawOutputs,
    outputs: rawOutputs.map((value, lane) => {
      const node = state.nodes[NETWORK_LAYERS - 1][lane];
      if (value <= 0.12) {
        return 0;
      }
      return clamp(Math.max(1, Math.round(value) + node.power), 0, 99);
    }),
  };
}

export function triggerLegendaryOpeningVolley(state) {
  const combinedGrid = createGrid();
  const combinedEdgeFlows = createEdgeFlows();
  const combinedOutputs = new Set();
  const combinedShots = [];

  for (let sourceLane = 0; sourceLane < LANE_COUNT; sourceLane += 1) {
    const packet = outputsFromSourceLane(state, sourceLane);
    mergeGrids(combinedGrid, packet.grid);
    mergeEdgeFlows(combinedEdgeFlows, packet.edgeFlows);
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      if (packet.outputs[lane] > 0) {
        combinedOutputs.add(lane);
        combinedShots.push({
          lane,
          damage: packet.outputs[lane],
          sourceLane,
          overdrive: packetOverdrive(state, packet.grid),
        });
      }
    }
  }

  state.grid = combinedGrid;
  state.edgeFlows = combinedEdgeFlows;
  state.displayGrid = createGrid();
  state.displayEdgeFlows = createEdgeFlows();
  state.lastOutputs = Array.from({ length: LANE_COUNT }, (_, lane) => (combinedOutputs.has(lane) ? 1 : 0));
  state.currentOutputs = Array.from(combinedOutputs);
  state.queuedShots = [];
  state.pendingShot = {
    sourceLane: 0,
    outputs: state.currentOutputs.slice(),
    shots: combinedShots,
  };
  state.outputChargeIndex = 0;
  state.inputChargeStep = effectiveChargeStep(state.baseInputChargeStep, state.globalFireRateMultiplier);
  state.outputChargeStep = effectiveChargeStep(state.baseOutputChargeStep, state.globalFireRateMultiplier);
  state.outputChargeTimer = 0;
  state.inputChargeTimer = state.inputChargeStep;
  state.activeInputLane = 0;
  state.firedThisCycle = true;
  state.legendaryOpening = true;
  state.pendingSummons = [];
  for (let sourceLane = 0; sourceLane < LANE_COUNT; sourceLane += 1) {
    const packet = outputsFromSourceLane(state, sourceLane);
    state.pendingSummons.push(...packetSummons(state, packet.grid));
  }
}

function resolveOutputLayer(incoming, state) {
  const lateral = incoming.slice();
  const lastLayer = NETWORK_LAYERS - 1;

  const resonanceBase = lateral.slice();
  for (let lane = 0; lane < LANE_COUNT - 1; lane += 1) {
    if (!sameTypeResonancePair(state, lastLayer, lane, lane + 1)) {
      continue;
    }
    const leftToRight = resonanceBase[lane] * 0.72;
    const rightToLeft = resonanceBase[lane + 1] * 0.72;
    lateral[lane + 1] += leftToRight;
    lateral[lane] += rightToLeft;
  }

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const node = state.nodes[lastLayer][lane];
    if (node.links.divider > 0) {
      const splitPower = incoming[lane] * (0.55 + node.links.divider * 0.18);
      if (lane > 0) {
        lateral[lane - 1] += splitPower;
      }
      if (lane < LANE_COUNT - 1) {
        lateral[lane + 1] += splitPower;
      }
    }
  }

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const node = state.nodes[lastLayer][lane];
    if (node.links.merger > 0) {
      const pull = 0.45 + node.links.merger * 0.16;
      const left = lane > 0 ? lateral[lane - 1] * pull : 0;
      const right = lane < LANE_COUNT - 1 ? lateral[lane + 1] * pull : 0;
      lateral[lane] += left + right;
    }
  }

  return lateral;
}

function advanceLane(state) {
  if (state.legendaryOpening) {
    startCycle(state);
    return;
  }
  state.currentSourceLane += 1;
  if (state.currentSourceLane >= LANE_COUNT) {
    startCycle(state);
    return;
  }
  state.inputChargeTimer = 0;
  state.inputStage = 0;
  state.outputChargeTimer = 0;
  state.outputChargeIndex = 0;
  state.inputChargeStep = state.baseInputChargeStep;
  state.outputChargeStep = state.baseOutputChargeStep;
  state.currentOutputs = [];
  state.pendingShot = null;
  state.pendingSummons = [];
  state.grid = createGrid();
  state.edgeFlows = createEdgeFlows();
  state.lastOutputs = Array(LANE_COUNT).fill(0);
  state.activeInputLane = state.currentSourceLane;
  state.previewPacket = null;
}

function propagateLayer(incoming, state, layerIndex) {
  const lateral = incoming.slice();
  const next = Array(LANE_COUNT).fill(0);
  const flows = {
    forward: Array(LANE_COUNT).fill(0),
    left: Array(LANE_COUNT).fill(0),
    right: Array(LANE_COUNT).fill(0),
    resonanceLeft: Array(LANE_COUNT).fill(0),
    resonanceRight: Array(LANE_COUNT).fill(0),
    dividerLeft: Array(LANE_COUNT).fill(0),
    dividerRight: Array(LANE_COUNT).fill(0),
    mergerLeft: Array(LANE_COUNT).fill(0),
    mergerRight: Array(LANE_COUNT).fill(0),
  };

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const node = state.nodes[layerIndex][lane];
    if (node.links.divider > 0) {
      const splitPower = incoming[lane] * (0.55 + node.links.divider * 0.18);
      if (lane > 0) {
        lateral[lane - 1] += splitPower;
        flows.dividerLeft[lane] += splitPower;
      }
      if (lane < LANE_COUNT - 1) {
        lateral[lane + 1] += splitPower;
        flows.dividerRight[lane] += splitPower;
      }
    }
  }

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const node = state.nodes[layerIndex][lane];
    if (node.links.merger > 0) {
      const pull = 0.45 + node.links.merger * 0.16;
      const left = lane > 0 ? lateral[lane - 1] * pull : 0;
      const right = lane < LANE_COUNT - 1 ? lateral[lane + 1] * pull : 0;
      lateral[lane] += left + right;
      flows.mergerLeft[lane] += left;
      flows.mergerRight[lane] += right;
    }
  }

  const resonanceBase = lateral.slice();
  for (let lane = 0; lane < LANE_COUNT - 1; lane += 1) {
    if (!sameTypeResonancePair(state, layerIndex, lane, lane + 1)) {
      continue;
    }
    const leftToRight = resonanceBase[lane] * 0.72;
    const rightToLeft = resonanceBase[lane + 1] * 0.72;
    lateral[lane + 1] += leftToRight;
    lateral[lane] += rightToLeft;
    flows.resonanceRight[lane] += leftToRight;
    flows.resonanceLeft[lane + 1] += rightToLeft;
  }

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const node = state.nodes[layerIndex][lane];
    let localSignal = lateral[lane] * (1 + node.power * 0.18);
    
    // Corruption penalty
    if (node.effects.corruption > 0) {
      localSignal *= 0.5;
    }

    const retained = localSignal * (state.signalRetention + node.links.relay * 0.08);
    next[lane] += retained;
    flows.forward[lane] += retained;

    if (node.links.left > 0 && lane > 0) {
      const leftFlow = localSignal * (0.85 + node.links.left * 0.24);
      next[lane - 1] += leftFlow;
      flows.left[lane] += leftFlow;
    }
    if (node.links.right > 0 && lane < LANE_COUNT - 1) {
      const rightFlow = localSignal * (0.85 + node.links.right * 0.24);
      next[lane + 1] += rightFlow;
      flows.right[lane] += rightFlow;
    }
  }

  return { next, flows };
}

export function updateNetwork(state, delta) {
  state.cycleTimer += delta;
  state.sourcePulse = Math.max(0, state.sourcePulse - delta * 2.5);

  if (
    state.pendingShot &&
    state.queuedShots.length === 0 &&
    state.outputChargeIndex >= ((state.pendingShot.shots && state.pendingShot.shots.length) || 0)
  ) {
    advanceLane(state);
  }

  if (!state.pendingShot) {
    state.activeInputLane = state.currentSourceLane;
    state.stepTimer = state.inputChargeTimer;
    if (!state.previewPacket) {
      state.previewPacket = outputsFromSourceLane(state, state.currentSourceLane);
      state.inputChargeStep = effectiveChargeStep(state.baseInputChargeStep, state.globalFireRateMultiplier);
      state.outputChargeStep = effectiveChargeStep(state.baseOutputChargeStep, state.globalFireRateMultiplier);
    }
    state.inputChargeTimer += delta;
    const stageProgress = clamp(state.inputChargeTimer / Math.max(state.inputChargeStep, 0.001), 0, 1);
    const staged = buildStagedPacket(state.previewPacket, state.inputStage, stageProgress);
    state.grid = staged.grid;
    state.edgeFlows = staged.edgeFlows;
    if (state.inputChargeTimer >= state.inputChargeStep) {
      state.inputChargeTimer = 0;
      state.inputStage += 1;
      if (state.inputStage >= NETWORK_LAYERS) {
        const sourceLane = state.currentSourceLane;
        const packet = state.previewPacket;
        for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
          state.grid[layer] = packet.grid[layer].slice();
        }
        state.edgeFlows = cloneEdgeFlows(packet.edgeFlows);
        state.propagatedLayers = NETWORK_LAYERS - 1;
        state.lastOutputs = packet.outputs.slice();
        state.currentOutputs = [];
        const packetShots = [];
        state.queuedShots = [];

        for (let lane = 0; lane < LANE_COUNT; lane += 1) {
          if (packet.outputs[lane] > 0) {
            state.currentOutputs.push(lane);
            packetShots.push({
              lane,
              damage: packet.outputs[lane],
              sourceLane,
              overdrive: packetOverdrive(state, packet.grid),
            });
          }
        }

        state.pendingShot = {
          sourceLane,
          outputs: state.currentOutputs.slice(),
          shots: packetShots,
        };
        state.pendingSummons = packetSummons(state, packet.grid);
        state.outputChargeIndex = 0;
        state.outputChargeTimer = 0;
        state.firedThisCycle = true;
      }
    }
  } else {
    state.activeInputLane = state.pendingShot.sourceLane;
    state.stepTimer = state.inputChargeStep;
    state.outputChargeTimer += delta;
    while (
      state.pendingShot &&
      state.outputChargeIndex < state.pendingShot.shots.length &&
      state.outputChargeTimer >= state.outputChargeStep
    ) {
      state.outputChargeTimer -= state.outputChargeStep;
      state.queuedShots.push(state.pendingShot.shots[state.outputChargeIndex]);
      state.outputChargeIndex += 1;
    }
  }

  smoothDisplayState(state, delta);
}

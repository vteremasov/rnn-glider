const EFFECT_STEP = {
  fire: 1,
  curse: 1,
  slow: 0.12,
  freeze: 0.08,
  pushback: 20,
  penetration: 1,
  split: 1,
  ricochet: 1,
  shield: 1,
  overdrive: 1.2,
  summon: 1,
};

const TOPOLOGY_IDS = new Set(["leftLink", "rightLink", "divider", "merger", "relay"]);
export const MAX_UPGRADE_LEVEL = 3;

export const UPGRADE_LIBRARY = [
  { id: "fire", name: "Fire Core", short: "+2.4 burn dps", description: "Adds burn: +2.4 damage per second on hit.", category: "projectile", rewardWeight: 1, color: "#ff8256", icon: "F", shape: "diamond" },
  { id: "curse", name: "Void Curse", short: "+1.8 curse dps", description: "Adds curse: +1.8 damage per second on hit.", category: "projectile", rewardWeight: 1, color: "#cb8cff", icon: "C", shape: "diamond" },
  { id: "slow", name: "Slow Field", short: "-6% move speed", description: "Adds slow: enemies move about 6% slower per stack.", category: "projectile", rewardWeight: 1, color: "#74d5ff", icon: "S", shape: "diamond" },
  { id: "freeze", name: "Cryo Gate", short: "+0.08 freeze", description: "Adds freeze buildup: short stops on repeated hits.", category: "projectile", rewardWeight: 0.8, color: "#b6f4ff", icon: "I", shape: "diamond" },
  { id: "pushback", name: "Push Pulse", short: "+20 push force", description: "Adds pushback: +20 impulse on hit.", category: "projectile", rewardWeight: 0.8, color: "#ffd06c", icon: "P", shape: "diamond" },
  { id: "penetration", name: "Penetration", short: "+1 pierce", description: "Adds piercing: projectile passes through 1 more target.", category: "projectile", rewardWeight: 0.9, color: "#fff1a2", icon: "N", shape: "diamond" },
  { id: "ricochet", name: "Ricochet", short: "+1 bounce", description: "Adds ricochet: projectile jumps to 1 nearby target.", category: "projectile", rewardWeight: 0.8, color: "#ffc98e", icon: "R", shape: "diamond" },
  { id: "shield", name: "Shield Relay", short: "+1 shield", description: "Successful hit can restore +1 shield.", category: "utility", rewardWeight: 0.7, color: "#8ec8ff", icon: "U", shape: "square" },
  { id: "overdrive", name: "Overdrive", short: "+120% damage/status", description: "Boosts route damage and applied status strength by +120% per stack.", category: "energy", rewardWeight: 1, color: "#59f5d6", icon: "+", shape: "hex" },
  { id: "summon", name: "Summon Node", short: "+1 summon copy", description: "Whenever signal passes this neuron, summon an allied copy in that lane that rushes upward and explodes for its own HP on impact.", category: "energy", rewardWeight: 0.9, color: "#8fd8ff", icon: "^", shape: "hex" },
  { id: "leftLink", name: "Left Link", short: "+~85% left branch", description: "Adds a strong branch: about 85% extra signal into the left neuron of the next layer.", category: "topology", rewardWeight: 0.9, color: "#ffb37f", icon: "L", shape: "triangle" },
  { id: "rightLink", name: "Right Link", short: "+~85% right branch", description: "Adds a strong branch: about 85% extra signal into the right neuron of the next layer.", category: "topology", rewardWeight: 0.9, color: "#ffb37f", icon: "R", shape: "triangle" },
  { id: "divider", name: "Divider", short: "split sideways", description: "Copies charge sideways into left and right neighbors.", category: "topology", rewardWeight: 0.8, color: "#ffd67f", icon: "D", shape: "triangle" },
  { id: "merger", name: "Merger", short: "pull sideways", description: "Pulls charge from left and right neighbors into this neuron.", category: "topology", rewardWeight: 0.8, color: "#ffe7aa", icon: "M", shape: "triangle" },
];

const UPGRADE_INDEX = Object.fromEntries(UPGRADE_LIBRARY.map((upgrade) => [upgrade.id, upgrade]));

export function randomUpgrades(count, rng, exclude = []) {
  const blocked = new Set(exclude);
  const bag = UPGRADE_LIBRARY.filter((upgrade) => !blocked.has(upgrade.id));
  const picks = [];

  while (bag.length > 0 && picks.length < count) {
    const total = bag.reduce((sum, item) => sum + item.rewardWeight, 0);
    let roll = rng() * total;
    let chosenIndex = 0;
    for (let index = 0; index < bag.length; index += 1) {
      roll -= bag[index].rewardWeight;
      if (roll <= 0) {
        chosenIndex = index;
        break;
      }
    }
    picks.push(bag.splice(chosenIndex, 1)[0]);
  }

  return picks;
}

export function isValidUpgradeTarget(state, upgrade, target) {
  if (!target) {
    return false;
  }
  const node = state.nodes[target.layer][target.lane];
  if (upgrade.id === "resetLens") {
    return node.power > 0 || Object.values(node.effects).some((value) => value > 0) || Object.values(node.links).some((value) => value > 0);
  }
  if (getNodeUpgradeLevel(node, upgrade.id) >= MAX_UPGRADE_LEVEL) {
    return false;
  }
  if (upgrade.id === "leftLink" || upgrade.id === "rightLink") {
    return target.layer < state.nodes.length - 1;
  }
  if (upgrade.id === "divider" || upgrade.id === "merger") {
    return true;
  }
  return true;
}

export function getNodeUpgradeLevel(node, upgradeId) {
  if (!node || !upgradeId) {
    return 0;
  }
  if (upgradeId in EFFECT_STEP) {
    const step = EFFECT_STEP[upgradeId] || 1;
    return Math.max(0, Math.round((node.effects[upgradeId] || 0) / step));
  }
  if (upgradeId === "leftLink") {
    return node.links.left || 0;
  }
  if (upgradeId === "rightLink") {
    return node.links.right || 0;
  }
  if (upgradeId === "divider") {
    return node.links.divider || 0;
  }
  if (upgradeId === "merger") {
    return node.links.merger || 0;
  }
  if (upgradeId === "relay") {
    return node.links.relay || 0;
  }
  return 0;
}

export function applyUpgrade(state, upgrade, target) {
  const node = state.nodes[target.layer][target.lane];
  if (upgrade.id !== "resetLens" && node.appearance && node.appearance.id && node.appearance.id !== upgrade.id) {
    return { applied: false, conflict: true, merged: false, level: getNodeUpgradeLevel(node, upgrade.id) };
  }
  const currentLevel = getNodeUpgradeLevel(node, upgrade.id);
  if (upgrade.id !== "resetLens" && currentLevel >= MAX_UPGRADE_LEVEL) {
    return { applied: false, capped: true, level: currentLevel, merged: false };
  }
  state.upgradeCounts[upgrade.id] = (state.upgradeCounts[upgrade.id] || 0) + 1;

  if (upgrade.id === "resetLens") {
    node.power = 0;
    for (const effectKey of Object.keys(node.effects)) {
      node.effects[effectKey] = 0;
    }
    for (const linkKey of Object.keys(node.links)) {
      node.links[linkKey] = 0;
    }
    node.appearance = null;
    return { applied: true, reset: true, level: 0, merged: false };
  }

  node.appearance = {
    id: upgrade.id,
    color: upgrade.color,
    icon: upgrade.icon,
    shape: upgrade.shape,
    level: currentLevel + 1,
  };
  node.power += 1;

  if (upgrade.id === "leftLink") {
    node.links.left += 1;
    return { applied: true, merged: currentLevel > 0, level: currentLevel + 1 };
  }

  if (upgrade.id === "rightLink") {
    node.links.right += 1;
    return { applied: true, merged: currentLevel > 0, level: currentLevel + 1 };
  }

  if (upgrade.id === "divider") {
    node.links.divider += 1;
    return { applied: true, merged: currentLevel > 0, level: currentLevel + 1 };
  }

  if (upgrade.id === "merger") {
    node.links.merger += 1;
    return { applied: true, merged: currentLevel > 0, level: currentLevel + 1 };
  }

  if (upgrade.id === "relay") {
    node.links.relay += 1;
    return { applied: true, merged: currentLevel > 0, level: currentLevel + 1 };
  }

  if (upgrade.id in EFFECT_STEP) {
    node.effects[upgrade.id] = (node.effects[upgrade.id] || 0) + EFFECT_STEP[upgrade.id];
  }
  return { applied: true, merged: currentLevel > 0, level: currentLevel + 1 };
}

export function upgradeVisual(node) {
  if (node && node.appearance) {
    return node.appearance;
  }
  return null;
}

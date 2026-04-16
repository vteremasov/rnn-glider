import { World } from "./ecs/world.js";
import { createNetworkState } from "./game/network.js";
import { NETWORK_LAYERS, LANE_COUNT } from "./game/config.js";
import { UPGRADE_LIBRARY } from "./game/upgrades.js";
import { LEGENDARY_PERKS } from "./game/catalog.js";
import {
  applyDebugScenario,
  coinSystem,
  combatStateSystem,
  enemyMovementSystem,
  enemySpawnSystem,
  flashSystem,
  inputSystem,
  projectileSystem,
  renderSystem,
  resetRun,
  resizeSystem,
  towerFireSystem,
} from "./game/systems.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = true;
const debugPanel = document.getElementById("debug-panel");
const debugText = document.getElementById("debug-text");
const debugCopy = document.getElementById("debug-copy");
const debugClose = document.getElementById("debug-close");
const debugBoot = window.__DEBUG_BOOT__ || null;
const debugRequested = window.location.hash.indexOf("debug") !== -1;
const devRequested =
  window.location.hash.indexOf("dev") !== -1 ||
  new URLSearchParams(window.location.search).get("dev") === "1";
const devToggle = document.getElementById("devtools-toggle");
const devPanel = document.getElementById("devtools-panel");
const devBranch = document.getElementById("dev-branch");
const devDepth = document.getElementById("dev-depth");
const devEnterMode = document.getElementById("dev-enter-mode");
const devPreBossRoom = document.getElementById("dev-preboss-room");
const devSeed = document.getElementById("dev-seed");
const devResetBuild = document.getElementById("dev-reset-build");
const devApply = document.getElementById("dev-apply");
const devPalette = document.getElementById("dev-palette");
const devUpgrades = document.getElementById("dev-upgrades");
const devLegendary = document.getElementById("dev-legendary");

function stringifyError(value) {
  if (value === null) {
    return "[null]";
  }
  if (typeof value === "undefined") {
    return "[undefined]";
  }
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pushDebugLine(title, detail) {
  if (!debugRequested && title !== "frame.crash") {
    return;
  }
  const timestamp = new Date().toISOString();
  const block = `[${timestamp}] ${title}\n${detail}`.trim();
  debugPanel.classList.add("is-visible");
  debugText.value = debugText.value ? `${debugText.value}\n\n${block}` : block;
  debugText.scrollTop = debugText.scrollHeight;
}

if (debugBoot && typeof debugBoot.setStatus === "function") {
  debugBoot.setStatus("Main module parsed.");
}

debugCopy.addEventListener("click", async () => {
  debugText.removeAttribute("readonly");
  debugText.focus();
  debugText.select();
  debugText.setSelectionRange(0, debugText.value.length);

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(debugText.value);
    } else {
      document.execCommand("copy");
    }
    pushDebugLine("debug.copy", "Copied debug output to clipboard.");
  } catch (error) {
    try {
      document.execCommand("copy");
      pushDebugLine("debug.copy", "Copied debug output via fallback.");
    } catch {
      pushDebugLine("debug.copy.failed", stringifyError(error));
    }
  }

  debugText.setAttribute("readonly", "readonly");
});

debugClose.addEventListener("click", () => {
  debugPanel.classList.remove("is-visible");
});

window.addEventListener("error", (event) => {
  if (event.message === "Script error." && !event.filename) {
    return;
  }
  const location = event.filename ? `\n${event.filename}:${event.lineno}:${event.colno}` : "";
  pushDebugLine("window.error", `${event.message}${location}\n${stringifyError(event.error)}`);
});

window.addEventListener("unhandledrejection", (event) => {
  pushDebugLine("unhandledrejection", stringifyError(event.reason));
});

const world = new World();
world.resources.canvas = canvas;
world.resources.ctx = ctx;
const deviceDpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
world.resources.dpr = Math.min(deviceDpr, 2);
world.resources.lowPowerMode = deviceDpr > 1.8 && Math.min(window.innerWidth, window.innerHeight) < 820;
world.resources.network = createNetworkState();
world.resources.pointer = {
  x: 0,
  y: 0,
  down: false,
  justReleased: false,
  downAt: 0,
  pointerType: "mouse",
};
world.resources.phase = { name: "combat" };
world.resources.rng = Math.random;
world.resources.resetRequested = false;
world.resources.layout = {
  width: 0,
  height: 0,
  cell: 0,
  turretX: 0,
  turretY: 0,
  towerY: 0,
  baseLineY: 0,
  fieldTop: 0,
  fieldW: 0,
  fieldX: 0,
};
world.resources.frameIndex = 0;

if (debugRequested) {
  debugPanel.classList.add("is-visible");
}

const DEV_STATE_KEY = "neural-bastion-dev-state";

function loadDevState() {
  try {
    const raw = localStorage.getItem(DEV_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch {}
  return null;
}

function saveDevState() {
  try {
    localStorage.setItem(DEV_STATE_KEY, JSON.stringify(devState));
  } catch {}
}

function defaultDevState() {
  const grid = [];
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    const row = [];
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      row.push("");
    }
    grid.push(row);
  }
  return {
    seed: "",
    branchTheme: "spider",
    depth: 0,
    enterMode: "map",
    preBossRoom: "shop",
    grid,
    legendary: [],
  };
}

let devState = loadDevState();
if (!devState || !devState.grid) {
  devState = defaultDevState();
}

function populateDevPanel() {
  if (!devRequested || !devToggle || !devPanel || !devDepth || !devUpgrades || !devLegendary || !devPalette) {
    return;
  }
  devToggle.classList.add("is-visible");
  if (devSeed) devSeed.value = devState.seed || "";
  devBranch.value = devState.branchTheme;
  devEnterMode.value = devState.enterMode;
  devPreBossRoom.value = devState.preBossRoom;

  devDepth.innerHTML = "";
  for (let depth = 0; depth <= 13; depth += 1) {
    const option = document.createElement("option");
    option.value = String(depth);
    option.textContent = depth === 0 ? "0 Base" : `${depth}`;
    if (depth === devState.depth) {
      option.selected = true;
    }
    devDepth.appendChild(option);
  }

  devPalette.innerHTML = "";
  let activeUpgradeId = null;

  for (const upgrade of UPGRADE_LIBRARY) {
    const item = document.createElement("div");
    item.className = "devtools-drag-item";
    item.draggable = true;
    item.textContent = upgrade.short || upgrade.name;
    item.dataset.upgradeId = upgrade.id;
    
    // Drag and Drop
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", upgrade.id);
      e.dataTransfer.effectAllowed = "copy";
    });

    // Brush mode (Click to select)
    item.addEventListener("click", () => {
      const isSelected = item.classList.contains("is-selected");
      // Clear previous selection
      devPalette.querySelectorAll(".devtools-drag-item").forEach(el => {
        el.classList.remove("is-selected");
        el.style.borderColor = "";
      });
      
      if (isSelected) {
        activeUpgradeId = null;
      } else {
        item.classList.add("is-selected");
        item.style.borderColor = "#00e5ff";
        activeUpgradeId = upgrade.id;
      }
    });

    devPalette.appendChild(item);
  }

  function renderGridCell(layer, lane, cell) {
    const value = devState.grid && devState.grid[layer] && devState.grid[layer][lane] ? devState.grid[layer][lane] : "";
    if (value) {
      const parts = value.split(":");
      const upgrade = UPGRADE_LIBRARY.find((u) => u.id === parts[0]);
      if (upgrade) {
        cell.textContent = `${upgrade.short || upgrade.name} ${parts[1]}`;
        cell.style.color = upgrade.color || "#eef1f6";
        cell.style.fontWeight = "bold";
      } else {
        cell.textContent = "-";
        cell.style.color = "";
        cell.style.fontWeight = "normal";
      }
    } else {
      cell.textContent = "-";
      cell.style.color = "";
      cell.style.fontWeight = "normal";
    }
  }

  devUpgrades.innerHTML = "";
  for (let layer = 0; layer < NETWORK_LAYERS; layer += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const cell = document.createElement("div");
      cell.className = "devtools-grid-cell";
      
      renderGridCell(layer, lane, cell);

      cell.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        cell.classList.add("drag-over");
      });
      cell.addEventListener("dragleave", () => {
        cell.classList.remove("drag-over");
      });
      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        cell.classList.remove("drag-over");
        const upgradeId = e.dataTransfer.getData("text/plain");
        if (upgradeId) {
          if (!devState.grid) devState.grid = [];
          if (!devState.grid[layer]) devState.grid[layer] = [];
          devState.grid[layer][lane] = `${upgradeId}:1`;
          saveDevState();
          renderGridCell(layer, lane, cell);
        }
      });

      cell.addEventListener("click", () => {
        if (!devState.grid) devState.grid = [];
        if (!devState.grid[layer]) devState.grid[layer] = [];

        if (activeUpgradeId) {
          // If we have a brush selected, apply it
          devState.grid[layer][lane] = `${activeUpgradeId}:1`;
        } else {
          // Normal cycle behavior
          if (!devState.grid[layer][lane]) return;
          const current = devState.grid[layer][lane];
          const parts = current.split(":");
          const upgradeId = parts[0];
          let level = Number(parts[1]) || 1;
          if (level >= 3) {
            devState.grid[layer][lane] = "";
          } else {
            devState.grid[layer][lane] = `${upgradeId}:${level + 1}`;
          }
        }
        saveDevState();
        renderGridCell(layer, lane, cell);
      });
      
      devUpgrades.appendChild(cell);
    }
  }

  devLegendary.innerHTML = "";
  for (const perk of LEGENDARY_PERKS) {
    const row = document.createElement("label");
    row.innerHTML = `
      <input type="checkbox" value="${perk.id}" ${devState.legendary.indexOf(perk.id) !== -1 ? "checked" : ""} />
      <span>${perk.name}</span>
    `;
    const input = row.querySelector("input");
    input.addEventListener("change", () => {
      if (input.checked) {
        if (devState.legendary.indexOf(perk.id) === -1) {
          devState.legendary.push(perk.id);
        }
      } else {
        devState.legendary = devState.legendary.filter((id) => id !== perk.id);
      }
      saveDevState();
    });
    devLegendary.appendChild(row);
  }
}

function collectDevScenario() {
  return {
    branchTheme: devBranch ? devBranch.value : devState.branchTheme,
    depth: devDepth ? Number(devDepth.value) || 0 : devState.depth,
    enterMode: devEnterMode ? devEnterMode.value : devState.enterMode,
    preBossRoom: devPreBossRoom ? devPreBossRoom.value : devState.preBossRoom,
    grid: devState.grid ? JSON.parse(JSON.stringify(devState.grid)) : [],
    legendary: devState.legendary.slice(),
  };
}

if (devRequested && devToggle && devPanel) {
  populateDevPanel();
  devToggle.addEventListener("click", () => {
    devPanel.classList.toggle("is-visible");
  });
  devBranch.addEventListener("change", () => {
    devState.branchTheme = devBranch.value;
    saveDevState();
  });
  devDepth.addEventListener("change", () => {
    devState.depth = Number(devDepth.value) || 0;
    saveDevState();
  });
  devEnterMode.addEventListener("change", () => {
    devState.enterMode = devEnterMode.value;
    saveDevState();
  });
  devPreBossRoom.addEventListener("change", () => {
    devState.preBossRoom = devPreBossRoom.value;
    saveDevState();
  });
  if (devSeed) {
    devSeed.addEventListener("input", () => {
      devState.seed = devSeed.value;
      saveDevState();
    });
  }
  devResetBuild.addEventListener("click", () => {
    const fresh = defaultDevState();
    devState.seed = fresh.seed;
    devState.branchTheme = fresh.branchTheme;
    devState.depth = fresh.depth;
    devState.enterMode = fresh.enterMode;
    devState.preBossRoom = fresh.preBossRoom;
    devState.legendary = fresh.legendary.slice();
    devState.grid = JSON.parse(JSON.stringify(fresh.grid));
    saveDevState();
    populateDevPanel();
  });
  devApply.addEventListener("click", () => {
    applyDebugScenario(world, collectDevScenario());
    devPanel.classList.remove("is-visible");
  });
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  world.resources.pointer.x = event.clientX - rect.left;
  world.resources.pointer.y = event.clientY - rect.top;
  world.resources.pointer.pointerType = event.pointerType || "mouse";
}

canvas.addEventListener("pointerdown", (event) => {
  updatePointer(event);
  world.resources.pointer.down = true;
  world.resources.pointer.downAt = performance.now();
});

canvas.addEventListener("pointermove", (event) => {
  updatePointer(event);
});

canvas.addEventListener("pointerup", (event) => {
  updatePointer(event);
  world.resources.pointer.down = false;
  world.resources.pointer.justReleased = true;
  world.resources.pointer.downAt = 0;
});

canvas.addEventListener("pointercancel", () => {
  world.resources.pointer.down = false;
  world.resources.pointer.downAt = 0;
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "r") {
    world.resources.resetRequested = true;
  }
});

resetRun(world);
if (debugBoot && typeof debugBoot.setStatus === "function") {
  debugBoot.setStatus("Game loop initialized.");
}

const systems = [
  resizeSystem,
  inputSystem,
  combatStateSystem,
  enemySpawnSystem,
  towerFireSystem,
  enemyMovementSystem,
  projectileSystem,
  coinSystem,
  flashSystem,
  renderSystem,
];

let lastTime = performance.now();

function frame(now) {
  try {
    const delta = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;
    world.resources.frameIndex += 1;

    if (world.resources.resetRequested) {
      world.resources.network = createNetworkState();
      world.resources.resetRequested = false;
      resetRun(world);
    }

    for (const system of systems) {
      system(world, delta);
    }
  } catch (error) {
    pushDebugLine("frame.crash", stringifyError(error));
    return;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);


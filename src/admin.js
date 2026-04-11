import { UPGRADE_LIBRARY, MAX_UPGRADE_LEVEL } from "./game/upgrades.js";
import { LEGENDARY_PERKS } from "./game/catalog.js";
import { ENEMY_CATALOG } from "./game/enemy_catalog.js";

const LEGACY_ROADMAP_KEY = "neural-bastion-admin-v1";
const DRAFT_KEY = "neural-bastion-admin-draft-v2";

const STATUS_META = [
  { id: "idea", label: "Ideas" },
  { id: "next", label: "Next" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];

const AREA_OPTIONS = ["combat", "map", "ui", "economy", "content", "other"];
const AUTO_DONE_TITLES = new Set([
  "Track branch completion on map",
  "Summon upgrade replaces Accelerator",
  "Improve text readability",
  "Add game debug mode",
  "Improve signal transfer and turret charge animation",
]);

function randomId() {
  try {
    if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_TASKS = [
  {
    id: randomId(),
    title: "Summon upgrade replaces Accelerator",
    notes: "Spawn allied copies from energized neurons instead of route fire-rate stacking.",
    area: "combat",
    status: "doing",
  },
  {
    id: randomId(),
    title: "Improve text readability",
    notes: "Higher DPR plus stronger contrast for damage numbers and UI labels.",
    area: "ui",
    status: "doing",
  },
  {
    id: randomId(),
    title: "Track branch completion on map",
    notes: "Persist and visualize completed routes after boss clears.",
    area: "map",
    status: "done",
  },
  {
    id: randomId(),
    title: "Bosses need distinct abilities",
    notes: "Only spider boss keeps shield. Beetle boss loses shield and summons one small fast 1 HP beetle every 1s. Worm boss loses shield, appears as a butterfly in phase one, then splits into 2 elite worms on HP loss.",
    area: "content",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Improve signal transfer and turret charge animation",
    notes: "Make signal propagation and turret charging smoother, clearer, and easier to read during combat.",
    area: "ui",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Visualize enemy shields",
    notes: "Add a clear visual shield layer or effect on enemies that currently have shield.",
    area: "ui",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Improve turret charge visuals and power buildup",
    notes: "Make it clearer that the turret is storing routed energy and building up power before each fired shot.",
    area: "ui",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Move topology upgrades into connection space",
    notes: "Link-type upgrades should live between neurons on the connections, while the neuron body itself should stay reserved for neuron upgrades.",
    area: "ui",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Add game debug mode",
    notes: "Allow jumping to a chosen tree depth and assembling a desired build immediately for testing runs.",
    area: "other",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Add paid upgrade rerolls",
    notes: "Let the player reroll offered upgrades by spending money during reward/shop flows.",
    area: "economy",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Deterministic seeded runs",
    notes: "Use pseudo-random generation with an explicit starting seed so a full run can be reproduced exactly. Debug mode should also allow setting the seed from the URL.",
    area: "other",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Improve overall visual polish",
    notes: "Push the full game look further: cleaner composition, stronger silhouettes, better effects, and more cohesive faction visuals.",
    area: "ui",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Add legendary that unlocks shield cap",
    notes: "Introduce a legendary item that removes or raises the player's maximum shield limit.",
    area: "content",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Camp should offer heal or neuron upgrade",
    notes: "At camp, let the player choose between restoring health or improving a neuron instead of auto-healing only.",
    area: "content",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Summons should inherit fire and void effects",
    notes: "If signal passes through fire or curse upgrades, summoned allies should also apply burn or void curse on impact.",
    area: "combat",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Shield should inherit the last routed upgrade",
    notes: "The player's shield should take on the last routed upgrade effect as a single active imbue, but only one shield upgrade effect at a time.",
    area: "combat",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Consumable temporary buffs",
    notes: "Add temporary buffs that grant a large power spike but are destroyed or spent once used.",
    area: "combat",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Enemy reactive resist profiles",
    notes: "Give enemies resist-style reactions to statuses, for example regeneration while frozen or acceleration while burning.",
    area: "combat",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Boss hits should be survivable",
    notes: "Bosses and elites should hit very hard without instantly ending the run, so their mechanics can become more complex and interesting.",
    area: "combat",
    status: "idea",
  },
  {
    id: randomId(),
    title: "Order-dependent DPS synergies",
    notes: "Create stronger DPS growth through neuron ordering and interdependence, not only by stacking isolated upgrades.",
    area: "combat",
    status: "idea",
  },
];

const UPGRADE_STATS = {
  fire: ["Burn DPS per stack: 2.4", "Burn stack cap per enemy: 20"],
  curse: ["Curse DPS per stack: 1.8", "Curse stack cap per enemy: 20"],
  slow: ["Slow per stack: 6%"],
  freeze: ["Freeze per stack: 0.08", "Freeze decay tuned to long stop windows"],
  pushback: ["Push force per stack: 5"],
  penetration: ["Pierce per stack: +1 target"],
  ricochet: ["Bounce per stack: +1 target"],
  shield: ["Shield gain on successful hit: +1"],
  overdrive: ["Route damage per stack: +120%", "Applied statuses per stack: +120%"],
  summon: ["Summons per energized pass: +1 allied copy", "Summon impact damage: equal to summon HP"],
  leftLink: ["Side branch into next layer: about +85% signal to left"],
  rightLink: ["Side branch into next layer: about +85% signal to right"],
  divider: ["Copies charge sideways into left and right neighbors"],
  merger: ["Pulls charge from left and right neighbors into this neuron"],
};

const LEGENDARY_STATS = {
  opening_barrage: ["Battle start: all 5 entry neurons are charged immediately"],
  thermal_feedback: ["Every freeze proc this battle: +20% burn damage"],
  void_resonance: ["Every slow proc this battle: +20% void damage"],
  resonant_mesh: ["Adjacent matching upgrade types auto-link sideways"],
  rapid_chamber: ["Global fire rate multiplier: +100%"],
};

function usableStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeTask(task) {
  const title = String((task && task.title) || "Untitled task");
  return {
    id: String(task && task.id ? task.id : randomId()),
    title,
    notes: String((task && task.notes) || ""),
    area: AREA_OPTIONS.includes(task && task.area) ? task.area : "other",
    status: AUTO_DONE_TITLES.has(title)
      ? "done"
      : STATUS_META.some((entry) => entry.id === (task && task.status)) ? task.status : "idea",
  };
}

function sanitizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback.slice();
  }
  return value.map((entry) => String(entry || "")).filter((entry) => entry.trim().length > 0);
}

function defaultUpgradeDrafts() {
  return UPGRADE_LIBRARY.map((upgrade) => ({
    id: upgrade.id,
    name: upgrade.name,
    short: upgrade.short,
    description: upgrade.description,
    category: upgrade.category,
    rewardWeight: upgrade.rewardWeight,
    color: upgrade.color,
    icon: upgrade.icon,
    shape: upgrade.shape,
    maxLevel: MAX_UPGRADE_LEVEL,
    stats: sanitizeStringArray(UPGRADE_STATS[upgrade.id] || [], []),
  }));
}

function defaultLegendaryDrafts() {
  return LEGENDARY_PERKS.map((perk) => ({
    id: perk.id,
    name: perk.name,
    short: perk.short,
    description: perk.description,
    color: perk.color,
    icon: perk.icon,
    shape: perk.shape,
    stats: sanitizeStringArray(LEGENDARY_STATS[perk.id] || [], []),
  }));
}

function defaultEnemyDrafts() {
  return ENEMY_CATALOG.map((enemy) => ({
    id: enemy.id,
    name: enemy.name,
    short: enemy.short,
    description: enemy.description,
    family: enemy.family,
    role: enemy.role,
    stats: sanitizeStringArray(enemy.stats || [], []),
  }));
}

function sanitizeUpgradeDraft(entry, fallback) {
  return {
    id: fallback.id,
    name: String((entry && entry.name) || fallback.name),
    short: String((entry && entry.short) || fallback.short),
    description: String((entry && entry.description) || fallback.description),
    category: String((entry && entry.category) || fallback.category),
    rewardWeight: Number.isFinite(Number(entry && entry.rewardWeight)) ? Number(entry.rewardWeight) : fallback.rewardWeight,
    color: String((entry && entry.color) || fallback.color),
    icon: String((entry && entry.icon) || fallback.icon),
    shape: String((entry && entry.shape) || fallback.shape),
    maxLevel: Number.isFinite(Number(entry && entry.maxLevel)) ? Number(entry.maxLevel) : fallback.maxLevel,
    stats: sanitizeStringArray(entry && entry.stats, fallback.stats),
  };
}

function sanitizeLegendaryDraft(entry, fallback) {
  return {
    id: fallback.id,
    name: String((entry && entry.name) || fallback.name),
    short: String((entry && entry.short) || fallback.short),
    description: String((entry && entry.description) || fallback.description),
    color: String((entry && entry.color) || fallback.color),
    icon: String((entry && entry.icon) || fallback.icon),
    shape: String((entry && entry.shape) || fallback.shape),
    stats: sanitizeStringArray(entry && entry.stats, fallback.stats),
  };
}

function sanitizeEnemyDraft(entry, fallback) {
  return {
    id: fallback.id,
    name: String((entry && entry.name) || fallback.name),
    short: String((entry && entry.short) || fallback.short),
    description: String((entry && entry.description) || fallback.description),
    family: String((entry && entry.family) || fallback.family),
    role: String((entry && entry.role) || fallback.role),
    stats: sanitizeStringArray(entry && entry.stats, fallback.stats),
  };
}

function mergeById(defaults, existing, sanitize) {
  const existingMap = new Map(Array.isArray(existing) ? existing.map((item) => [item && item.id, item]) : []);
  return defaults.map((fallback) => sanitize(existingMap.get(fallback.id), fallback));
}

function loadLegacyRoadmap() {
  const storage = usableStorage();
  if (!storage) {
    return DEFAULT_TASKS.map(sanitizeTask);
  }
  try {
    const raw = storage.getItem(LEGACY_ROADMAP_KEY);
    if (!raw) {
      return DEFAULT_TASKS.map(sanitizeTask);
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_TASKS.map(sanitizeTask);
    }
    const tasks = parsed.map(sanitizeTask);
    const requiredTitles = new Set(DEFAULT_TASKS.map((task) => task.title));
    const existingTitles = new Set(tasks.map((task) => task.title));
    const missingTasks = DEFAULT_TASKS.filter((task) => requiredTitles.has(task.title) && !existingTitles.has(task.title)).map(sanitizeTask);
    return missingTasks.length ? [...missingTasks, ...tasks] : tasks;
  } catch {
    return DEFAULT_TASKS.map(sanitizeTask);
  }
}

function defaultDraft() {
  return {
    roadmap: loadLegacyRoadmap(),
    upgrades: defaultUpgradeDrafts(),
    legendary: defaultLegendaryDrafts(),
    enemies: defaultEnemyDrafts(),
  };
}

function loadDraft() {
  const storage = usableStorage();
  const fallback = defaultDraft();
  if (!storage) {
    return fallback;
  }
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) {
      storage.setItem(DRAFT_KEY, JSON.stringify(fallback));
      return fallback;
    }
    const parsed = JSON.parse(raw);
    const existingRoadmap = Array.isArray(parsed && parsed.roadmap) ? parsed.roadmap.map(sanitizeTask) : fallback.roadmap;
    const existingTitles = new Set(existingRoadmap.map((task) => task.title));
    const missingTasks = DEFAULT_TASKS.filter((task) => !existingTitles.has(task.title)).map(sanitizeTask);
    return {
      roadmap: missingTasks.length ? [...missingTasks, ...existingRoadmap] : existingRoadmap,
      upgrades: mergeById(fallback.upgrades, parsed && parsed.upgrades, sanitizeUpgradeDraft),
      legendary: mergeById(fallback.legendary, parsed && parsed.legendary, sanitizeLegendaryDraft),
      enemies: mergeById(fallback.enemies, parsed && parsed.enemies, sanitizeEnemyDraft),
    };
  } catch {
    return fallback;
  }
}

function saveDraft() {
  const storage = usableStorage();
  if (!storage) {
    return;
  }
  storage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

let draft = loadDraft();
let activeCatalogTab = "roadmap";
const editingCards = new Set();

function areaLabel(area) {
  return String(area || "other").toUpperCase();
}

function statusSelectHtml(value) {
  return STATUS_META.map((status) => `<option value="${status.id}" ${status.id === value ? "selected" : ""}>${status.label}</option>`).join("");
}

function areaSelectHtml(value) {
  return AREA_OPTIONS.map((area) => `<option value="${area}" ${area === value ? "selected" : ""}>${areaLabel(area)}</option>`).join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cardActionsHtml(key, editing) {
  return editing
    ? `
      <div class="task-actions">
        <button type="button" data-action="save" data-key="${key}">Save</button>
        <button type="button" data-action="cancel" data-key="${key}">Cancel</button>
      </div>
    `
    : `
      <div class="task-actions">
        <button type="button" data-action="edit" data-key="${key}">Edit</button>
      </div>
    `;
}

function bindCardActions(container, onSave) {
  container.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      const key = button.dataset.key;
      if (!key) {
        return;
      }
      if (action === "edit") {
        editingCards.add(key);
        renderAll();
        return;
      }
      if (action === "cancel") {
        editingCards.delete(key);
        renderAll();
        return;
      }
      if (action === "save") {
        onSave(key, container);
        editingCards.delete(key);
        saveDraft();
        renderAll();
      }
    });
  });
}

function renderTaskCard(task, key, done = false) {
  const editing = editingCards.has(key);
  const card = document.createElement("article");
  card.className = `task${done ? " is-done" : ""}`;
  if (!editing) {
    card.innerHTML = `
      <div class="card-body">
        <div class="card-head">
          <strong>${escapeHtml(task.title)}</strong>
          ${done ? '<span class="done-mark">Done</span>' : ""}
        </div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(areaLabel(task.area))}</span>
          <span class="chip">${escapeHtml(task.status)}</span>
        </div>
        <div class="card-text">${escapeHtml(task.notes || "No notes yet.")}</div>
        ${cardActionsHtml(key, false)}
      </div>
    `;
    bindCardActions(card, () => {});
    return card;
  }

  card.innerHTML = `
    <div class="edit-grid">
      <input type="text" data-field="title" value="${escapeHtml(task.title)}" />
      <div class="chip-row">
        <select data-field="area">${areaSelectHtml(task.area)}</select>
        <select data-field="status">${statusSelectHtml(task.status)}</select>
      </div>
      <textarea data-field="notes">${escapeHtml(task.notes)}</textarea>
      ${cardActionsHtml(key, true)}
    </div>
  `;
  bindCardActions(card, (_key, container) => {
    const titleInput = container.querySelector('[data-field="title"]');
    const areaInput = container.querySelector('[data-field="area"]');
    const statusInput = container.querySelector('[data-field="status"]');
    const notesInput = container.querySelector('[data-field="notes"]');
    task.title = titleInput ? titleInput.value : task.title;
    task.area = areaInput ? areaInput.value : task.area;
    task.status = statusInput ? statusInput.value : task.status;
    task.notes = notesInput ? notesInput.value : task.notes;
  });
  return card;
}

function renderDataCard(entry, key, typeLabel, chips, fields) {
  const editing = editingCards.has(key);
  const card = document.createElement("article");
  card.className = "catalog-item";
  if (!editing) {
    card.innerHTML = `
      <div class="card-body">
        <div class="card-head">
          <strong>${escapeHtml(entry.name)}</strong>
          <small>${escapeHtml(typeLabel)}</small>
        </div>
        <div class="chip-row">${chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")}</div>
        <div class="stats">
          <div><strong>ID:</strong> ${escapeHtml(entry.id)}</div>
          <div><strong>Short:</strong> ${escapeHtml(entry.short)}</div>
          <div><strong>Description:</strong> ${escapeHtml(entry.description)}</div>
          ${Array.isArray(entry.stats) && entry.stats.length ? `<div style="margin-top:8px;">${entry.stats.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>` : ""}
        </div>
        ${cardActionsHtml(key, false)}
      </div>
    `;
    bindCardActions(card, () => {});
    return card;
  }

  card.innerHTML = `
    <div class="edit-grid">
      <input type="text" data-field="name" value="${escapeHtml(entry.name)}" />
      <input type="text" data-field="short" value="${escapeHtml(entry.short)}" />
      <textarea data-field="description">${escapeHtml(entry.description)}</textarea>
      <textarea data-field="stats">${escapeHtml((entry.stats || []).join("\n"))}</textarea>
      ${cardActionsHtml(key, true)}
    </div>
  `;
  bindCardActions(card, (_key, container) => {
    fields.forEach((field) => {
      const element = container.querySelector(`[data-field="${field}"]`);
      if (!element) {
        return;
      }
      if (field === "stats") {
        entry.stats = element.value.split("\n").map((line) => line.trim()).filter(Boolean);
      } else {
        entry[field] = element.value;
      }
    });
  });
  return card;
}

function renderRoadmap() {
  const root = document.getElementById("roadmap");
  if (!root) {
    return;
  }
  root.innerHTML = "";
  root.className = "roadmap-stack";

  const activeGrid = document.createElement("div");
  activeGrid.className = "roadmap";
  const activeStatuses = STATUS_META.filter((status) => status.id !== "done");
  const doneTasks = draft.roadmap.filter((task) => task.status === "done");

  for (const status of activeStatuses) {
    const lane = document.createElement("section");
    lane.className = "lane";
    const laneTasks = draft.roadmap.filter((task) => task.status === status.id);
    lane.innerHTML = `
      <div class="lane-head">
        <strong>${status.label}</strong>
        <span class="muted">${laneTasks.length}</span>
      </div>
      <div class="task-list"></div>
    `;
    const list = lane.querySelector(".task-list");

    for (const task of laneTasks) {
      list.appendChild(renderTaskCard(task, `task:${task.id}`));
    }

    activeGrid.appendChild(lane);
  }

  root.appendChild(activeGrid);

  const doneSection = document.createElement("section");
  doneSection.className = "done-section";
  doneSection.innerHTML = `
    <h4>Done</h4>
    <p class="muted">Completed tasks stay here until reopened by changing their status.</p>
    <div class="task-list"></div>
  `;
  const doneList = doneSection.querySelector(".task-list");

  for (const task of doneTasks) {
    doneList.appendChild(renderTaskCard(task, `task:${task.id}`, true));
  }

  if (doneTasks.length > 0) {
    root.appendChild(doneSection);
  }
}

function renderUpgradeCatalog() {
  const root = document.getElementById("upgrade-list");
  if (!root) {
    return;
  }
  root.innerHTML = "";

  for (const upgrade of draft.upgrades) {
    root.appendChild(renderDataCard(
      upgrade,
      `upgrade:${upgrade.id}`,
      `max level ${upgrade.maxLevel}`,
      [upgrade.category, `weight ${upgrade.rewardWeight}`, upgrade.shape],
      ["name", "short", "description", "stats"],
    ));
  }
}

function renderLegendaryCatalog() {
  const root = document.getElementById("legendary-list");
  if (!root) {
    return;
  }
  root.innerHTML = "";

  for (const perk of draft.legendary) {
    root.appendChild(renderDataCard(
      perk,
      `legendary:${perk.id}`,
      "legendary",
      [perk.shape, perk.color],
      ["name", "short", "description", "stats"],
    ));
  }
}

function renderEnemyCatalog() {
  const root = document.getElementById("enemy-list");
  if (!root) {
    return;
  }
  root.innerHTML = "";

  for (const enemy of draft.enemies) {
    root.appendChild(renderDataCard(
      enemy,
      `enemy:${enemy.id}`,
      `${enemy.role} enemy`,
      [enemy.family, enemy.role],
      ["name", "short", "description", "stats"],
    ));
  }
}

function renderTabs() {
  const tabs = document.querySelectorAll("[data-tab]");
  const roadmapRoot = document.getElementById("catalog-roadmap");
  const upgradesRoot = document.getElementById("catalog-upgrades");
  const legendaryRoot = document.getElementById("catalog-legendary");
  const enemiesRoot = document.getElementById("catalog-enemies");
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === activeCatalogTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (roadmapRoot) {
    roadmapRoot.hidden = activeCatalogTab !== "roadmap";
  }
  if (upgradesRoot) {
    upgradesRoot.hidden = activeCatalogTab !== "upgrades";
  }
  if (legendaryRoot) {
    legendaryRoot.hidden = activeCatalogTab !== "legendary";
  }
  if (enemiesRoot) {
    enemiesRoot.hidden = activeCatalogTab !== "enemies";
  }
}

function renderAll() {
  renderTabs();
  renderRoadmap();
  renderUpgradeCatalog();
  renderLegendaryCatalog();
  renderEnemyCatalog();
}

function initTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCatalogTab = button.dataset.tab || "roadmap";
      renderTabs();
    });
  });
}

function exportPayload() {
  return {
    exportedAt: new Date().toISOString(),
    roadmap: clone(draft.roadmap),
    upgrades: clone(draft.upgrades),
    legendary: clone(draft.legendary),
    enemies: clone(draft.enemies),
  };
}

function initActions() {
  const addRoadmapButton = document.getElementById("add-roadmap-item");
  const copyJsonButton = document.getElementById("copy-json");
  const resetDraftButton = document.getElementById("reset-draft");

  if (addRoadmapButton) {
    addRoadmapButton.addEventListener("click", () => {
      draft.roadmap.unshift({
        id: randomId(),
        title: "New task",
        notes: "",
        area: "other",
        status: "idea",
      });
      saveDraft();
      renderRoadmap();
    });
  }

  if (copyJsonButton) {
    copyJsonButton.addEventListener("click", async () => {
      const ok = await copyText(JSON.stringify(exportPayload(), null, 2));
      copyJsonButton.textContent = ok ? "Copied" : "Copy Failed";
      window.setTimeout(() => {
        copyJsonButton.textContent = "Copy JSON";
      }, 1400);
    });
  }

  if (resetDraftButton) {
    resetDraftButton.addEventListener("click", () => {
      draft = defaultDraft();
      saveDraft();
      renderAll();
    });
  }
}

function initAdmin() {
  initTabs();
  initActions();
  renderAll();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdmin, { once: true });
} else {
  initAdmin();
}

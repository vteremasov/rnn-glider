export const LANE_COUNT = 5;
export const NETWORK_LAYERS = 3;
export const GRID_COLUMNS = 16;
export const GRID_ROWS = 16;
export const ROOM_TYPES = ["combat", "elite", "shop", "camp", "boss"];

export const COLORS = {
  bg: "#06080a",
  bgPanel: "#0d1116",
  steel: "#1a232c",
  grid: "rgba(0, 229, 255, 0.05)",
  line: "#304255",
  energy: "#00e5ff",
  energySoft: "rgba(0, 229, 255, 0.15)",
  energyBright: "#ffffff",
  threat: "#ff2a4d",
  threatSoft: "rgba(255, 42, 77, 0.15)",
  warning: "#ffaa00",
  text: "#e0e6ed",
  textDim: "#6c8093",
  card: "#11161d",
  cardAlt: "#161c24",
  good: "#00ff88",
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function laneCenterX(layout, lane) {
  return layout.laneLeft + layout.laneSpacing * lane;
}

export function formatRoomName(roomType) {
  if (roomType === "elite") {
    return "Elite";
  }
  if (roomType === "shop") {
    return "Shop";
  }
  if (roomType === "camp") {
    return "Camp";
  }
  if (roomType === "boss") {
    return "Boss";
  }
  return "Combat";
}

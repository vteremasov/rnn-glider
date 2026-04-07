export const LANE_COUNT = 5;
export const NETWORK_LAYERS = 3;
export const GRID_COLUMNS = 16;
export const GRID_ROWS = 16;
export const ROOM_TYPES = ["combat", "elite", "shop", "camp", "boss"];

export const COLORS = {
  bg: "#14171d",
  bgPanel: "#1d2229",
  steel: "#2c333b",
  grid: "rgba(186, 197, 214, 0.11)",
  line: "#79879a",
  energy: "#cfd7e6",
  energySoft: "rgba(207, 215, 230, 0.22)",
  energyBright: "#f6f8fb",
  threat: "#c86a56",
  threatSoft: "rgba(212, 107, 79, 0.18)",
  warning: "#c9d1de",
  text: "#eef1f6",
  textDim: "#a8b2c2",
  card: "#21262d",
  cardAlt: "#292f37",
  good: "#95c19c",
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

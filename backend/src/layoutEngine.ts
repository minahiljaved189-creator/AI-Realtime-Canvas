import type { CanvasNode, LayoutGroup, LayoutType, PositionAnchor, ShapeType } from "./types.js";

export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;
export const CANVAS_PADDING = 48;
export const MAX_SHAPES = 12;
export const MAX_LABEL_LEN = 2;

const CENTER_X = CANVAS_WIDTH / 2;
const CENTER_Y = CANVAS_HEIGHT / 2;

// Fixed shape sizing keeps every layout predictable and non-overlapping —
// the LLM never gets to pick sizes, only type/layout/count/position.
const CIRCLE_RADIUS = 26;
const RECT_WIDTH = 56;
const RECT_HEIGHT = 40;

export const SUPPORTED_SHAPES: ShapeType[] = ["circle", "rectangle"];
export const SUPPORTED_LAYOUTS: LayoutType[] = [
  "row",
  "column",
  "grid",
  "circle",
  "triangle",
  "star",
  "diamond",
  "cross",
  "zigzag",
  "spiral",
];
export const SUPPORTED_POSITIONS: PositionAnchor[] = [
  "center",
  "above-center",
  "below-center",
  "left-of-center",
  "right-of-center",
];

/** Offset applied to an entire group's block, so compound prompts like
 *  "1 circle above center" can be expressed without raw coordinates. */
const POSITION_OFFSETS: Record<PositionAnchor, { dx: number; dy: number }> = {
  "center": { dx: 0, dy: 0 },
  "above-center": { dx: 0, dy: -150 },
  "below-center": { dx: 0, dy: 150 },
  "left-of-center": { dx: -170, dy: 0 },
  "right-of-center": { dx: 170, dy: 0 },
};

/**
 * Generate spreadsheet-style labels: A, B, ... Z, AA, AB, ...
 * Always <= MAX_LABEL_LEN characters for indices 0..701 (26 + 26*26).
 */
export function generateLabel(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label.slice(0, MAX_LABEL_LEN);
}

interface Point {
  x: number;
  y: number;
}

/** Usable half-extent so shapes never clip canvas edges, accounting for shape size + padding. */
function maxRadiusFor(shape: ShapeType): number {
  const halfExtent = shape === "circle" ? CIRCLE_RADIUS : Math.max(RECT_WIDTH, RECT_HEIGHT) / 2;
  return Math.min(CENTER_X, CENTER_Y) - CANVAS_PADDING - halfExtent;
}

// ---- All position functions below return points RELATIVE to a group's own
// center (0,0). The group's anchor offset + canvas center are added once,
// uniformly, in buildGroupNodes(). This is what makes multi-group / compound
// layouts possible without duplicating offset math in every function. ----

function rowPositions(count: number): Point[] {
  const spacing = Math.min(90, (CANVAS_WIDTH - CANVAS_PADDING * 2) / Math.max(count, 1));
  const totalWidth = spacing * (count - 1);
  const startX = -totalWidth / 2;
  return Array.from({ length: count }, (_, i) => ({ x: startX + i * spacing, y: 0 }));
}

function columnPositions(count: number): Point[] {
  const spacing = Math.min(80, (CANVAS_HEIGHT - CANVAS_PADDING * 2) / Math.max(count, 1));
  const totalHeight = spacing * (count - 1);
  const startY = -totalHeight / 2;
  return Array.from({ length: count }, (_, i) => ({ x: 0, y: startY + i * spacing }));
}

function gridPositions(count: number): Point[] {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellW = Math.min(110, (CANVAS_WIDTH - CANVAS_PADDING * 2) / cols);
  const cellH = Math.min(90, (CANVAS_HEIGHT - CANVAS_PADDING * 2) / rows);
  const gridWidth = cellW * (cols - 1);
  const gridHeight = cellH * (rows - 1);
  const startX = -gridWidth / 2;
  const startY = -gridHeight / 2;

  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // Center the last, possibly-incomplete row.
    const itemsInRow = row === rows - 1 ? count - row * cols : cols;
    const rowOffset = ((cols - itemsInRow) * cellW) / 2;
    points.push({ x: startX + col * cellW + rowOffset, y: startY + row * cellH });
  }
  return points;
}

function circlePositions(count: number, shape: ShapeType): Point[] {
  if (count <= 1) return [{ x: 0, y: 0 }];
  const r = Math.min(maxRadiusFor(shape), 180);
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
  });
}

/**
 * "Star" = proper 5-pointed star shape with items distributed along the 5 points
 * radiating outward from center, creating a symmetric star pattern.
 */
function starPositions(count: number, shape: ShapeType): Point[] {
  if (count <= 1) return [{ x: 0, y: 0 }];
  
  const numPoints = 5;
  const maxR = Math.min(maxRadiusFor(shape), 190);
  const itemsPerPoint = Math.ceil(count / numPoints);
  const spacing = maxR / Math.max(itemsPerPoint, 1);
  const points: Point[] = [];

  // Distribute items across 5 star points
  for (let i = 0; i < count; i++) {
    const pointIndex = i % numPoints;
    const distanceStep = Math.floor(i / numPoints) + 1;
    const angle = (pointIndex * 2 * Math.PI) / numPoints - Math.PI / 2;
    const dist = spacing * distanceStep;
    
    points.push({
      x: dist * Math.cos(angle),
      y: dist * Math.sin(angle),
    });
  }
  return points;
}

function trianglePositions(count: number): Point[] {
  const rows = Math.ceil((Math.sqrt(8 * count + 1) - 1) / 2) || 1;
  const spacing = Math.min(85, (CANVAS_HEIGHT - CANVAS_PADDING * 2) / rows);
  const points: Point[] = [];
  let remaining = count;
  const totalHeight = spacing * (rows - 1);
  const startY = -totalHeight / 2;

  for (let row = 0; row < rows && remaining > 0; row++) {
    const itemsInRow = Math.min(row + 1, remaining);
    const rowWidth = spacing * (itemsInRow - 1);
    const startX = -rowWidth / 2;
    for (let col = 0; col < itemsInRow; col++) {
      points.push({ x: startX + col * spacing, y: startY + row * spacing });
    }
    remaining -= itemsInRow;
  }
  return points;
}

function diamondPositions(count: number, shape: ShapeType): Point[] {
  if (count <= 1) return [{ x: 0, y: 0 }];
  // Same angular distribution as circle, but squared into a diamond via L1-normalized radius.
  const r = Math.min(maxRadiusFor(shape), 190);
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const norm = Math.abs(cos) + Math.abs(sin) || 1;
    const scaled = r / norm;
    return { x: scaled * cos, y: scaled * sin };
  });
}

function crossPositions(count: number): Point[] {
  if (count <= 1) return [{ x: 0, y: 0 }];
  const arm = Math.min(maxRadiusFor("circle"), 190);
  const maxPerAxis = Math.ceil(count / 4);
  const spacing = arm / Math.max(maxPerAxis, 1);
  const points: Point[] = [];

  // Distribute items evenly across 4 directions: right (1,0), down (0,1), left (-1,0), up (0,-1).
  // Items cycle through directions at increasing distances for a symmetric cross.
  for (let i = 0; i < count; i++) {
    const direction = i % 4;
    const distance = Math.floor(i / 4) + 1;
    const dist = spacing * distance;
    
    if (direction === 0) {
      points.push({ x: dist, y: 0 });      // right
    } else if (direction === 1) {
      points.push({ x: 0, y: dist });      // down
    } else if (direction === 2) {
      points.push({ x: -dist, y: 0 });     // left
    } else {
      points.push({ x: 0, y: -dist });     // up
    }
  }
  return points;
}

function zigzagPositions(count: number): Point[] {
  if (count <= 1) return [{ x: 0, y: 0 }];
  const spacingX = Math.min(85, (CANVAS_WIDTH - CANVAS_PADDING * 2) / Math.max(count - 1, 1));
  const amplitude = Math.min(70, CENTER_Y - CANVAS_PADDING - RECT_HEIGHT);
  const totalWidth = spacingX * (count - 1);
  const startX = -totalWidth / 2;

  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * spacingX,
    y: i % 2 === 0 ? -amplitude / 2 : amplitude / 2,
  }));
}

function spiralPositions(count: number, shape: ShapeType): Point[] {
  if (count <= 1) return [{ x: 0, y: 0 }];
  const maxR = Math.min(maxRadiusFor(shape), 190);
  const turns = 2;
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const angle = turns * 2 * Math.PI * t;
    const r = maxR * t;
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
  });
}

/**
 * Compute deterministic, group-relative coordinates for a layout.
 * This is the single source of truth for geometry — the LLM never supplies x/y.
 */
export function computeLayout(layout: LayoutType, count: number, shape: ShapeType): Point[] {
  switch (layout) {
    case "row":
      return rowPositions(count);
    case "column":
      return columnPositions(count);
    case "grid":
      return gridPositions(count);
    case "circle":
      return circlePositions(count, shape);
    case "star":
      return starPositions(count, shape);
    case "triangle":
      return trianglePositions(count);
    case "diamond":
      return diamondPositions(count, shape);
    case "cross":
      return crossPositions(count);
    case "zigzag":
      return zigzagPositions(count);
    case "spiral":
      return spiralPositions(count, shape);
    default:
      return gridPositions(count);
  }
}

/**
 * Build nodes for a single group, offsetting the whole block by its anchor
 * (e.g. "above-center"), then clamping every point inside canvas bounds.
 */
function buildGroupNodes(group: LayoutGroup, startIndex: number): CanvasNode[] {
  const { shape, layout, count } = group;
  const anchor = group.position ?? "center";
  const { dx, dy } = POSITION_OFFSETS[anchor];

  const points = computeLayout(layout, count, shape);

  return points.map((p, i) => {
    const id = String(startIndex + i + 1);
    const label = generateLabel(startIndex + i);
    const x = Math.round(
      Math.min(Math.max(CENTER_X + dx + p.x, CANVAS_PADDING), CANVAS_WIDTH - CANVAS_PADDING)
    );
    const y = Math.round(
      Math.min(Math.max(CENTER_Y + dy + p.y, CANVAS_PADDING), CANVAS_HEIGHT - CANVAS_PADDING)
    );

    if (shape === "circle") {
      return { id, type: "circle", x, y, radius: CIRCLE_RADIUS, label };
    }
    return { id, type: "rectangle", x, y, width: RECT_WIDTH, height: RECT_HEIGHT, label };
  });
}

/**
 * Build the final CanvasNode array across one or more groups. Supports both
 * simple single-shape prompts and compound prompts like "4 rectangles in a
 * row and 1 circle above center". Labels/ids are sequential across all groups.
 * Total node count is defensively clamped to MAX_SHAPES even though callers
 * should have already validated this upstream.
 */
export function buildNodes(groups: LayoutGroup[]): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  let index = 0;

  for (const group of groups) {
    if (index >= MAX_SHAPES) break;
    const remaining = MAX_SHAPES - index;
    const clampedGroup: LayoutGroup = { ...group, count: Math.min(Math.max(group.count, 1), remaining) };
    const groupNodes = buildGroupNodes(clampedGroup, index);
    nodes.push(...groupNodes);
    index += groupNodes.length;
  }

  return nodes;
}

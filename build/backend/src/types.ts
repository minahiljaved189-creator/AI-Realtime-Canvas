export type ShapeType = "circle" | "rectangle";

export type LayoutType =
  | "row"
  | "column"
  | "grid"
  | "circle"
  | "triangle"
  | "star"
  | "diamond"
  | "cross"
  | "zigzag"
  | "spiral";

/**
 * Optional anchor offsetting a group's block away from dead-center.
 * Lets the LLM express compound prompts like "1 circle above center"
 * without ever supplying raw coordinates.
 */
export type PositionAnchor =
  | "center"
  | "above-center"
  | "below-center"
  | "left-of-center"
  | "right-of-center";

/**
 * One shape/layout block. A prompt like "4 rectangles in a row and 1 circle
 * above center" becomes two groups. Simple prompts are always exactly one group.
 */
export interface LayoutGroup {
  shape: ShapeType;
  layout: LayoutType;
  count: number;
  position?: PositionAnchor;
}

/**
 * The ONLY thing the LLM is allowed to produce. No coordinates, no sizes —
 * geometry is always computed deterministically by layoutEngine.ts.
 */
export interface LayoutIntent {
  groups: LayoutGroup[];
}

export interface CircleNode {
  id: string;
  type: "circle";
  x: number;
  y: number;
  radius: number;
  label: string;
}

export interface RectangleNode {
  id: string;
  type: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export type CanvasNode = CircleNode | RectangleNode;

export interface CanvasState {
  nodes: CanvasNode[];
}

export interface NodeMovePayload {
  id: string;
  x: number;
  y: number;
}

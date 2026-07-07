export type ShapeType = "circle" | "rectangle";

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

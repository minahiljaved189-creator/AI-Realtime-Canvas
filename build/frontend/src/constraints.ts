// Mirrors backend/src/layoutEngine.ts SUPPORTED_SHAPES / SUPPORTED_LAYOUTS.
// Kept in sync manually since frontend and backend are separate packages —
// if you add a layout/shape on the backend, update this list too.
export const SUPPORTED_SHAPES = ["circle", "rectangle"] as const;

export const SUPPORTED_LAYOUTS = [
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
] as const;

export const MAX_SHAPES = 12;

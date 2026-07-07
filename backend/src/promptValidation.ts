import { SUPPORTED_SHAPES } from "./layoutEngine.js";

export interface PromptValidationResult {
  valid: boolean;
  error?: string;
}

// Shapes we explicitly reject with a clear, friendly reason (vs. just "unsupported").
const REJECTED_SHAPES = ["ellipse", "polygon", "hexagon", "star shape"];

// Color is not part of the supported schema (shape/layout/count/position only).
// This is an unambiguous, binary constraint — not a "guess" — so it's safe to
// reject locally without involving the LLM's natural-language parsing.
const COLOR_WORDS = [
  "red", "blue", "green", "yellow", "purple", "orange", "pink", "black",
  "white", "gray", "grey", "cyan", "magenta", "brown", "violet", "teal",
  "colored", "coloured", "colorful", "colourful", "rainbow",
];

/**
 * Cheap, deterministic pre-checks run BEFORE the prompt reaches the LLM.
 *
 * IMPORTANT: this file intentionally does NOT try to detect whether a shape,
 * layout, or count is present in the text — that used to be done here with
 * keyword regexes, which is exactly the "keyword matcher" behavior we moved
 * away from. Determining whether those three required fields are actually
 * present, in any phrasing or word order, is now entirely the LLM's job
 * (see ai.ts). This file only catches things that are unambiguous binary
 * constraints regardless of phrasing: explicitly unsupported shape names and
 * color mentions, neither of which requires understanding sentence structure.
 */
export function validatePromptText(prompt: string): PromptValidationResult {
  const trimmed = prompt.trim();

  if (trimmed.length > 300) {
    return { valid: false, error: "Prompt is too long. Please keep it concise." };
  }

  const lower = trimmed.toLowerCase();

  for (const bad of REJECTED_SHAPES) {
    if (lower.includes(bad)) {
      return {
        valid: false,
        error: `Unsupported shape "${bad}". Allowed shapes: ${SUPPORTED_SHAPES.join(", ")}.`,
      };
    }
  }

  for (const color of COLOR_WORDS) {
    if (new RegExp(`\\b${color}\\b`).test(lower)) {
      return {
        valid: false,
        error:
          "Color customization isn't supported — shapes always use the app's default colors. " +
          "Please describe only shape, layout, and count (e.g. \"5 circles in a row\").",
      };
    }
  }

  return { valid: true };
}

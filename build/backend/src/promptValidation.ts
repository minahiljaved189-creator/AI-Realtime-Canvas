import { MAX_SHAPES, SUPPORTED_LAYOUTS, SUPPORTED_SHAPES } from "./layoutEngine.js";

export interface PromptValidationResult {
  valid: boolean;
  error?: string;
}

// Shapes we explicitly reject with a clear, friendly reason (vs. just "unsupported").
const REJECTED_SHAPES = ["triangle", "ellipse", "polygon", "hexagon", "star shape"];

// Common color words. Color is not part of the supported schema (shape/layout/
// count/position only), so we reject explicitly instead of silently ignoring
// it — silently dropping a property the user asked for is worse than telling
// them it isn't supported.
const COLOR_WORDS = [
  "red", "blue", "green", "yellow", "purple", "orange", "pink", "black",
  "white", "gray", "grey", "cyan", "magenta", "brown", "violet", "teal",
  "colored", "coloured", "colorful", "colourful", "rainbow",
];

// "layout" itself is deliberately NOT in this list — it's a generic noun, not
// an actual layout name, and including it let garbled/misspelled layout words
// (e.g. "eow layout") slip past this check just because the sentence
// happened to contain the word "layout".
const LAYOUT_WORD_PATTERN = new RegExp(`\\b(${SUPPORTED_LAYOUTS.join("|")})\\b`, "i");

/**
 * Cheap, deterministic checks run BEFORE the prompt ever reaches the LLM.
 * Catches empty prompts, unsupported shape/color words, missing shape/layout
 * keywords, and obviously invalid counts (0, negative, >12) mentioned in the
 * raw text.
 *
 * This is intentionally strict on the things the assignment explicitly
 * constrains (shape, layout, count) and does not try to guess intent the way
 * the LLM might — if the required keywords aren't there, we reject with the
 * exact allowed list rather than letting the model guess.
 */
export function validatePromptText(prompt: string): PromptValidationResult {
  const trimmed = prompt.trim();

  if (!trimmed) {
    return { valid: false, error: "Prompt cannot be empty." };
  }

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

  if (!LAYOUT_WORD_PATTERN.test(lower)) {
    return {
      valid: false,
      error: `Please describe a layout using one of: ${SUPPORTED_LAYOUTS.join(", ")}.`,
    };
  }

  // Look for an explicit shape count in the text (e.g. "12 circles", "0 rectangles").
  const countMatch = lower.match(/\b(\d+)\s*(circle|circles|rectangle|rectangles|shape|shapes|node|nodes)\b/);
  if (countMatch) {
    const count = parseInt(countMatch[1], 10);
    if (count <= 0) {
      return { valid: false, error: "Shape count must be at least 1." };
    }
    if (count > MAX_SHAPES) {
      return { valid: false, error: "Maximum allowed shapes is 12." };
    }
  }

  // "star" prompts often phrase count as "1 center node and 6 surrounding nodes" —
  // sum those explicitly since neither number alone is the real total.
  const centerAndSurrounding = lower.match(/(\d+)\s*center\D+(\d+)\s*surrounding/);
  if (centerAndSurrounding) {
    const total = parseInt(centerAndSurrounding[1], 10) + parseInt(centerAndSurrounding[2], 10);
    if (total <= 0) {
      return { valid: false, error: "Shape count must be at least 1." };
    }
    if (total > MAX_SHAPES) {
      return { valid: false, error: "Maximum allowed shapes is 12." };
    }
  }

  return { valid: true };
}

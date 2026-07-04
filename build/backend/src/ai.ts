import Groq from "groq-sdk";
import type { CanvasState, LayoutGroup, LayoutType, PositionAnchor, ShapeType } from "./types.js";
import {
  SUPPORTED_LAYOUTS,
  SUPPORTED_SHAPES,
  SUPPORTED_POSITIONS,
  MAX_SHAPES,
  buildNodes,
} from "./layoutEngine.js";

/**
 * Thrown for any validation/generation failure that should surface as a
 * friendly, specific message to the user instead of a raw stack trace.
 */
export class GenerationError extends Error {}

const SYSTEM_PROMPT = `You are an intent extractor for a canvas layout tool.

STRICT RULES:
- Return ONLY valid JSON. No prose, no markdown, no code fences, no explanations, no extra text.
- The JSON must always have this exact top-level shape:
{ "groups": [ { "shape": "circle", "layout": "star", "count": 5 } ] }
- Most prompts need exactly ONE group. Only use multiple groups when the prompt clearly describes
  more than one distinct shape/layout combination (e.g. "4 rectangles in a row AND 1 circle above center").
- "shape" must be one of: ${SUPPORTED_SHAPES.join(", ")}. No other shape names exist (no triangle, ellipse, polygon, hexagon, etc.).
- "layout" must be one of: ${SUPPORTED_LAYOUTS.join(", ")}.
- "count" must be a whole number, at least 1. The SUM of all groups' counts must not exceed ${MAX_SHAPES}.
- "position" is OPTIONAL and only needed for extra groups anchored relative to the main group. One of: ${SUPPORTED_POSITIONS.join(", ")}. Defaults to "center" if omitted.
- Do NOT include coordinates, sizes, colors, or labels. You only decide shape, layout, count, and optionally position.
- Colors are never part of the output. If the user mentions a color, ignore it — it has no effect on the schema.
- Each group object must contain ONLY these keys: shape, layout, count, and optionally position. No other keys, ever.
- "star" layout means ONE center node plus the rest evenly spaced in a ring around it. If a prompt says
  "1 center node and 6 surrounding nodes", that is layout "star" with count 7 (1 + 6), not two groups.
- If the user's request is ambiguous, pick the closest reasonable values within the allowed lists — never invent new values.

EXAMPLES:
User: "Create 5 circles in a star layout"
{ "groups": [ { "shape": "circle", "layout": "star", "count": 5 } ] }

User: "Create a star layout with 1 center node and 6 surrounding nodes"
{ "groups": [ { "shape": "circle", "layout": "star", "count": 7 } ] }

User: "Create a 3x4 grid of circles labeled A to L"
{ "groups": [ { "shape": "circle", "layout": "grid", "count": 12 } ] }

User: "Create 4 rectangles in a row and 1 circle above center"
{ "groups": [ { "shape": "rectangle", "layout": "row", "count": 4 }, { "shape": "circle", "layout": "row", "count": 1, "position": "above-center" } ] }`;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Strip common LLM formatting mistakes (code fences, leading/trailing prose)
 * before attempting to parse JSON.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Last resort: grab the first {...} block in case the model added stray text.
    const braceMatch = candidate.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {
        throw new GenerationError("Invalid AI response.");
      }
    }
    throw new GenerationError("Invalid AI response.");
  }
}

const ALLOWED_GROUP_KEYS = new Set(["shape", "layout", "count", "position"]);

function validateGroup(raw: unknown): LayoutGroup {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new GenerationError("Invalid AI response.");
  }
  const obj = raw as Record<string, unknown>;

  // Reject any property outside the strict contract (e.g. a stray "color"
  // field) instead of silently ignoring it.
  const extraKeys = Object.keys(obj).filter((k) => !ALLOWED_GROUP_KEYS.has(k));
  if (extraKeys.length > 0) {
    throw new GenerationError("Invalid AI response.");
  }

  const shape = obj.shape;
  if (typeof shape !== "string" || !SUPPORTED_SHAPES.includes(shape as ShapeType)) {
    throw new GenerationError("Unsupported shape. Only circle and rectangle are supported.");
  }

  const layout = obj.layout;
  if (typeof layout !== "string" || !SUPPORTED_LAYOUTS.includes(layout as LayoutType)) {
    throw new GenerationError("Unsupported layout requested.");
  }

  const count = obj.count;
  if (typeof count !== "number" || !Number.isFinite(count) || !Number.isInteger(count)) {
    throw new GenerationError("Invalid AI response.");
  }
  if (count < 1) {
    throw new GenerationError("Shape count must be at least 1.");
  }

  let position: PositionAnchor | undefined;
  if (obj.position !== undefined) {
    if (typeof obj.position !== "string" || !SUPPORTED_POSITIONS.includes(obj.position as PositionAnchor)) {
      throw new GenerationError("Invalid AI response.");
    }
    position = obj.position as PositionAnchor;
  }

  return { shape: shape as ShapeType, layout: layout as LayoutType, count, position };
}

/**
 * Validate the parsed LLM output against the strict groups contract.
 * Any deviation (unsupported shape/layout, bad count, malformed group,
 * total count over the cap) is rejected with a friendly, specific message.
 */
function validateLayoutIntent(raw: unknown): LayoutGroup[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new GenerationError("Invalid AI response.");
  }
  const obj = raw as Record<string, unknown>;

  const topLevelExtra = Object.keys(obj).filter((k) => k !== "groups");
  if (topLevelExtra.length > 0) {
    throw new GenerationError("Invalid AI response.");
  }

  if (!Array.isArray(obj.groups) || obj.groups.length === 0) {
    throw new GenerationError("Invalid AI response.");
  }

  const groups = obj.groups.map(validateGroup);
  const total = groups.reduce((sum, g) => sum + g.count, 0);

  if (total > MAX_SHAPES) {
    throw new GenerationError("Maximum allowed shapes is 12.");
  }

  return groups;
}

export async function generateCanvasFromPrompt(prompt: string): Promise<CanvasState> {
  if (!process.env.GROQ_API_KEY) {
    throw new GenerationError("Server is missing GROQ_API_KEY. Add it to backend/.env");
  }

  let completion;
  try {
    completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });
  } catch (err) {
    console.error("[ai] Groq request failed:", err);
    throw new GenerationError("Unable to generate layout. Please try again.");
  }

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = extractJson(raw);
  const groups = validateLayoutIntent(parsed);

  // Geometry is always computed here, never trusted from the LLM.
  const nodes = buildNodes(groups);
  return { nodes };
}

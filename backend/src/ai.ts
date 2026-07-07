import Groq from "groq-sdk";
import type {
  CanvasState,
  LayoutGroup,
  LayoutType,
  PositionAnchor,
  RequiredField,
  ShapeType,
} from "./types.js";
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

const REQUIRED_FIELD_DESCRIPTIONS: Record<RequiredField, string> = {
  shape: `a shape (${SUPPORTED_SHAPES.join(" or ")})`,
  layout: `a layout (${SUPPORTED_LAYOUTS.join(", ")})`,
  count: "how many shapes you'd like (1 to 12)",
};

function composeMissingMessage(missing: RequiredField[]): string {
  const parts = missing.map((f) => REQUIRED_FIELD_DESCRIPTIONS[f]);
  const joined =
    parts.length === 1
      ? parts[0]
      : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  return `I need a bit more detail — please specify ${joined}. For example: "Create 5 circles in a star layout".`;
}

/**
 * Thrown when the LLM determines the prompt is missing one or more of the
 * three required fields (shape, layout, count). The server clears the canvas
 * when this is thrown — a request this incomplete should not leave stale
 * shapes on screen implying something was generated.
 */
export class MissingFieldsError extends GenerationError {
  missing: RequiredField[];
  constructor(missing: RequiredField[]) {
    super(composeMissingMessage(missing));
    this.missing = missing;
  }
}

/** Thrown when the prompt has nothing to do with generating a canvas layout. */
export class UnrelatedPromptError extends GenerationError {
  constructor() {
    super(
      "This application only generates circle and rectangle layouts — it can't help with that. " +
        'Try something like: "Create 5 circles in a star layout" or "Create 4 rectangles in a row and 1 circle above center".'
    );
  }
}

const SYSTEM_PROMPT = `You are a natural-language parser for a canvas layout tool. You must understand MEANING and INTENT regardless of word order, phrasing, or synonyms — you are explicitly NOT a keyword matcher.

Three pieces of information are REQUIRED and must be clearly stated somewhere in the message:
1. shape — one of: ${SUPPORTED_SHAPES.join(", ")}
2. layout — one of: ${SUPPORTED_LAYOUTS.join(", ")}
3. count — how many shapes. Accept digits, spelled-out numbers ("five" = 5), and clearly derivable counts ("3x4 grid" = 12, "labeled A to L" = 12, "1 center node and 6 surrounding" = 7).

CRITICAL RULE: NEVER guess, assume, infer a default, or invent a value for shape, layout, or count. If any of the three cannot be clearly determined from the text, you MUST report it as missing instead. Vague quantities like "some", "a few", or "several" are NOT a count — treat them as missing.

You must recognize the SAME meaning across different phrasings and word orders. These four prompts are semantically identical and MUST produce the exact same output:
- "Create 5 circles in a star layout"
- "Star layout with 5 circles"
- "Arrange 5 circles as a star"
- "Five circles arranged like a star"
All four → { "status": "ok", "groups": [ { "shape": "circle", "layout": "star", "count": 5 } ] }

OUTPUT FORMAT — return ONLY ONE of these three JSON shapes. No prose, no markdown, no code fences, no explanations, no extra text.

(1) All three required fields are clearly present:
{ "status": "ok", "groups": [ { "shape": "circle", "layout": "star", "count": 5 } ] }
Use more than one group only when the prompt clearly describes more than one distinct shape/layout combination, e.g.:
{ "status": "ok", "groups": [ { "shape": "rectangle", "layout": "row", "count": 4 }, { "shape": "circle", "layout": "row", "count": 1, "position": "above-center" } ] }
"position" is optional (one of: ${SUPPORTED_POSITIONS.join(", ")}) and only anchors an extra group relative to center.
Each group object must contain ONLY: shape, layout, count, and optionally position — no other keys, ever. Never include coordinates, sizes, colors, or labels.

(2) One or more required fields cannot be determined from the text:
{ "status": "missing", "missing": ["shape", "layout", "count"] }
List ONLY the fields that are actually unclear. Examples:
User: "Make a star layout" → shape and count are not stated → { "status": "missing", "missing": ["shape", "count"] }
User: "Draw some circles" → layout not stated, and "some" is not a number → { "status": "missing", "missing": ["layout", "count"] }
User: "Draw 5 shapes" → "shapes" is not a specific shape name, and layout is not stated → { "status": "missing", "missing": ["shape", "layout"] }

(3) The message has nothing to do with generating a canvas layout (greetings, jokes, questions about you, requests to write code, etc.):
{ "status": "unrelated" }
Examples: "hello", "tell me a joke", "who are you", "write python code" → all four → { "status": "unrelated" }

If the user mentions a color, ignore it completely — color is never part of the output and never counts as missing information.`;

let groqClient: Groq | null = null;
function getGroqClient(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

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

const VALID_REQUIRED_FIELDS: RequiredField[] = ["shape", "layout", "count"];

/**
 * Validate the parsed LLM output against the three-way envelope contract
 * (ok / missing / unrelated). Throws the appropriate typed error for
 * "missing" and "unrelated" so the server can react differently to each
 * (clearing the canvas only for "missing").
 */
function validateEnvelope(raw: unknown): LayoutGroup[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new GenerationError("Invalid AI response.");
  }
  const obj = raw as Record<string, unknown>;

  if (obj.status === "unrelated") {
    throw new UnrelatedPromptError();
  }

  if (obj.status === "missing") {
    if (!Array.isArray(obj.missing) || obj.missing.length === 0) {
      throw new GenerationError("Invalid AI response.");
    }
    const missing = obj.missing.filter(
      (m): m is RequiredField => typeof m === "string" && VALID_REQUIRED_FIELDS.includes(m as RequiredField)
    );
    if (missing.length === 0) {
      throw new GenerationError("Invalid AI response.");
    }
    throw new MissingFieldsError(missing);
  }

  if (obj.status !== "ok") {
    throw new GenerationError("Invalid AI response.");
  }

  const topLevelExtra = Object.keys(obj).filter((k) => k !== "status" && k !== "groups");
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
  const trimmed = prompt.trim();

  // An empty prompt is, definitionally, missing all three required fields.
  // Handle it deterministically without spending an LLM call on it.
  if (!trimmed) {
    throw new MissingFieldsError(["shape", "layout", "count"]);
  }

  if (!process.env.GROQ_API_KEY) {
    throw new GenerationError("Server is missing GROQ_API_KEY. Add it to backend/.env");
  }

  let completion;
  try {
    completion = await getGroqClient().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: trimmed },
      ],
    });
  } catch (err) {
    console.error("[ai] Groq request failed:", err);
    throw new GenerationError("Unable to generate layout. Please try again.");
  }

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = extractJson(raw);
  const groups = validateEnvelope(parsed);

  // Geometry is always computed here, never trusted from the LLM.
  const nodes = buildNodes(groups);
  return { nodes };
}

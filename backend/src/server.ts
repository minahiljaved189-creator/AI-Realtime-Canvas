import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { generateCanvasFromPrompt, GenerationError, MissingFieldsError } from "./ai.js";
import { validatePromptText } from "./promptValidation.js";
import { CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_PADDING } from "./layoutEngine.js";
import type { CanvasNode, CanvasState, NodeMovePayload } from "./types.js";

const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: FRONTEND_ORIGIN, methods: ["GET", "POST"] },
});

// Single in-memory canvas state shared by all connected clients.
// Simple and sufficient for this app's scope (no DB required).
let canvasState: CanvasState = { nodes: [] };

// Tracks whether a generation is currently in flight so concurrent/duplicate
// requests (double-click, rapid Enter presses) are rejected server-side too,
// not just via the disabled button on the frontend.
let generationInFlight = false;

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/generate", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "");

  const validation = validatePromptText(prompt);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  if (generationInFlight) {
    return res.status(429).json({ error: "A generation is already in progress." });
  }

  generationInFlight = true;
  try {
    const result = await generateCanvasFromPrompt(prompt);
    canvasState = result;

    // Broadcast to every connected client, including the requester, exactly once.
    io.emit("canvas:generated", canvasState);

    res.json(canvasState);
  } catch (err) {
    console.error("[/generate] error:", err);

    if (err instanceof MissingFieldsError) {
      // A request this incomplete should not leave stale shapes on screen
      // implying something was generated — clear the canvas for everyone.
      canvasState = { nodes: [] };
      io.emit("canvas:generated", canvasState);
      return res.status(400).json({ error: err.message });
    }

    const message = err instanceof GenerationError ? err.message : "Unable to generate layout.";
    res.status(err instanceof GenerationError ? 400 : 500).json({ error: message });
  } finally {
    generationInFlight = false;
  }
});

io.on("connection", (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);

  // Send current state to the newly connected client so it stays in sync.
  socket.emit("canvas:generated", canvasState);

  socket.on("canvas:generate", async (prompt: string) => {
    const text = String(prompt ?? "");
    const validation = validatePromptText(text);
    if (!validation.valid) {
      socket.emit("canvas:error", validation.error);
      return;
    }

    if (generationInFlight) {
      socket.emit("canvas:error", "A generation is already in progress.");
      return;
    }

    generationInFlight = true;
    try {
      const result = await generateCanvasFromPrompt(text);
      canvasState = result;
      io.emit("canvas:generated", canvasState);
    } catch (err) {
      console.error("[socket canvas:generate] error:", err);

      if (err instanceof MissingFieldsError) {
        canvasState = { nodes: [] };
        io.emit("canvas:generated", canvasState);
        socket.emit("canvas:error", err.message);
        return;
      }

      const message = err instanceof GenerationError ? err.message : "Unable to generate layout.";
      socket.emit("canvas:error", message);
    } finally {
      generationInFlight = false;
    }
  });

  socket.on("node:move", (payload: NodeMovePayload) => {
    const node = canvasState.nodes.find((n: CanvasNode) => n.id === payload.id);
    if (!node) return;

    // Never trust client-sent coordinates blindly — same principle already
    // applied to the AI's output. A non-standard client could send anything
    // directly over the socket, bypassing the UI's own drag boundary.
    const clampedX = Math.min(Math.max(payload.x, CANVAS_PADDING), CANVAS_WIDTH - CANVAS_PADDING);
    const clampedY = Math.min(Math.max(payload.y, CANVAS_PADDING), CANVAS_HEIGHT - CANVAS_PADDING);

    node.x = clampedX;
    node.y = clampedY;

    // Broadcast the authoritative (possibly clamped) position to EVERY
    // client, including the sender — guarantees all clients converge on the
    // same value even if a sender's own optimistic update ever diverges.
    io.emit("node:moved", { id: payload.id, x: clampedX, y: clampedY });
  });

  socket.on("disconnect", () => {
    console.log(`[socket] client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

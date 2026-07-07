import { useEffect, useRef, useState } from "react";
import Canvas from "./Canvas";
import { socket } from "./socket";
import { useCanvasStore, applyCanvasState } from "./store";
import { SUPPORTED_SHAPES, SUPPORTED_LAYOUTS, MAX_SHAPES } from "./constraints";
import type { CanvasState, NodeMovePayload } from "./types";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [connected, setConnected] = useState(socket.connected);

  const nodes = useCanvasStore((s) => s.nodes);
  const isGenerating = useCanvasStore((s) => s.isGenerating);
  const error = useCanvasStore((s) => s.error);
  const setGenerating = useCanvasStore((s) => s.setGenerating);
  const setError = useCanvasStore((s) => s.setError);
  const setNodes = useCanvasStore((s) => s.setNodes);
  const moveNode = useCanvasStore((s) => s.moveNode);

  // React state updates are async, so a synchronous ref is used alongside
  // isGenerating to guarantee a rapid double-click/double-Enter can never
  // fire two requests before the first re-render lands.
  const requestInFlightRef = useRef(false);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onGenerated(state: CanvasState) {
      // Just sync the canvas. Do NOT touch error/generating/ref here — this
      // event can arrive from ANY client's action (including our own canvas
      // being cleared after a "missing fields" response), and the requesting
      // client's own success/error state is derived directly from its fetch
      // response below, not from this broadcast. Otherwise a race between
      // this event and the fetch response could wipe out an error message
      // the user is supposed to see.
      applyCanvasState(state);
    }
    function onMoved(payload: NodeMovePayload) {
      moveNode(payload.id, payload.x, payload.y);
    }
    function onError(message: string) {
      // Used only by socket-initiated generation (not the REST flow below).
      setError(message);
      setGenerating(false);
      requestInFlightRef.current = false;
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("canvas:generated", onGenerated);
    socket.on("node:moved", onMoved);
    socket.on("canvas:error", onError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("canvas:generated", onGenerated);
      socket.off("node:moved", onMoved);
      socket.off("canvas:error", onError);
    };
  }, [setGenerating, setError, moveNode]);

  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (!trimmed || requestInFlightRef.current) return;

    requestInFlightRef.current = true;
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch(`${BACKEND_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      // Apply directly from the response — don't wait on the socket
      // broadcast to know this succeeded. Other tabs still get the update
      // via "canvas:generated".
      applyCanvasState(body as CanvasState);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate layout.");
    } finally {
      setGenerating(false);
      requestInFlightRef.current = false;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleGenerate();
  }

  function handleClear() {
    setNodes([]);
    setPrompt("");
    setError(null);
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-dot" />
          AI Realtime Canvas
        </div>
        <div className={`status ${connected ? "status-online" : "status-offline"}`}>
          {connected ? "Live" : "Reconnecting…"}
        </div>
      </header>

      <main className="app-main">
        <div className="prompt-bar">
          <input
            type="text"
            className="prompt-input"
            placeholder='Try: "Create 5 circles in a star layout"'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
          />
          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Generating…
              </>
            ) : (
              "Generate"
            )}
          </button>
          <button
            className="clear-btn"
            onClick={handleClear}
            disabled={isGenerating || nodes.length === 0}
            title="Clear the canvas"
          >
            Clear
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="constraints-hint">
          <span>
            <strong>Shapes:</strong> {SUPPORTED_SHAPES.join(", ")}
          </span>
          <span>
            <strong>Layouts:</strong> {SUPPORTED_LAYOUTS.join(", ")}
          </span>
          <span>
            <strong>Max:</strong> {MAX_SHAPES} shapes · no colors, just shape + layout + count
          </span>
        </div>

        <Canvas />

        <footer className="canvas-footer">
          {nodes.length} / 12 shapes on canvas
        </footer>
      </main>
    </div>
  );
}

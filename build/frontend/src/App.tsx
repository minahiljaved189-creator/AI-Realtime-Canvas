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
      applyCanvasState(state);
      setGenerating(false);
      setError(null);
      requestInFlightRef.current = false;
    }
    function onMoved(payload: NodeMovePayload) {
      moveNode(payload.id, payload.x, payload.y);
    }
    function onError(message: string) {
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

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      // Response also arrives via the "canvas:generated" socket broadcast,
      // which keeps every connected client in sync, including this tab.
      // The ref lock is released there (onGenerated/onError), not here,
      // since the REST call resolving doesn't mean generation is done.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate layout.");
      setGenerating(false);
      requestInFlightRef.current = false;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleGenerate();
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

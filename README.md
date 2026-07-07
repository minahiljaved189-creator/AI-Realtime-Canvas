# AI Realtime Canvas

Type a prompt like *"Create 5 circles in a star layout"*, click **Generate**, and a shared canvas updates live for every connected client. Drag a shape in one tab, it moves in every other tab.

## Stack

- **Frontend:** Vite + React + TypeScript, `react-konva` for canvas rendering, Zustand for state, `socket.io-client` for real-time sync.
- **Backend:** Node.js + Express, Socket.io, Groq SDK (Llama 3.3 70B) for natural-language parsing only.

## Project structure

```
frontend/
  src/
    App.tsx          # prompt input, socket wiring, layout
    Canvas.tsx        # react-konva rendering, drag & drop with boundary clamping
    store.ts          # Zustand store (single source of truth for nodes)
    socket.ts          # socket.io client with auto-reconnect
    constraints.ts    # supported shapes/layouts shown in the UI (mirrors backend)
    types.ts          # shared shape/node types
backend/
  src/
    server.ts         # Express routes + Socket.io event handlers
    ai.ts               # LLM call: natural-language parsing ONLY (no coordinates)
    layoutEngine.ts    # deterministic geometry — the only source of x/y/size
    promptValidation.ts # fast pre-AI checks (unsupported shapes, colors)
    types.ts
```

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env
# edit .env and add your GROQ_API_KEY (https://console.groq.com)
npm install
npm run dev
```

Backend runs on `http://localhost:4000`.

### 2. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`. Open the URL in two tabs to see real-time sync.

## Architecture: why the LLM never produces coordinates

The AI's ONLY job is natural-language understanding — turning a sentence into a small structured intent:

```json
{ "status": "ok", "groups": [ { "shape": "circle", "layout": "star", "count": 5 } ] }
```

It never outputs x/y/radius/width/height. All geometry — centering, spacing, avoiding overlap, staying inside the canvas — is computed deterministically in `layoutEngine.ts`. This is a deliberate departure from asking the LLM to output raw coordinates directly (as a literal reading of "AI converts prompt → JSON with positions" might suggest): LLMs are unreliable at precise spatial arithmetic, so trusting them for pixel positions makes layouts inconsistent and prone to overlap. Making the AI responsible only for intent, and the app responsible for geometry, is what keeps every layout centered, non-overlapping, and reliably inside canvas bounds no matter what the model returns.

### The LLM must never guess

If the prompt doesn't clearly state a shape, layout, or count (in any phrasing or word order — "Five circles arranged like a star" and "Create 5 circles in a star layout" must parse identically), the model reports exactly which field(s) are missing instead of inventing a value:

```json
{ "status": "missing", "missing": ["layout", "count"] }
```

When this happens, the server **clears the canvas** for every connected client and returns a message explaining exactly what's missing — it never silently generates a guessed layout.

Prompts unrelated to canvas generation (greetings, jokes, code requests, etc.) get a third status:

```json
{ "status": "unrelated" }
```

...which returns an explanatory message and leaves the canvas untouched (nothing was implied to have been generated, so nothing needs clearing).

### Defense in depth

Every layer distrusts the one before it:
- `promptValidation.ts` rejects explicitly unsupported shapes/colors before the LLM is even called.
- `ai.ts` validates the LLM's JSON envelope strictly — unknown status values, extra properties, out-of-range counts, and malformed groups are all rejected with a friendly message, never silently coerced.
- `layoutEngine.ts` re-clamps every computed coordinate to canvas bounds regardless of what fed into it.
- `server.ts` re-clamps drag coordinates arriving over the socket too — a non-standard client sending raw socket messages can't push a shape outside the canvas either.

## Socket events

| Event               | Direction        | Payload                          |
|---------------------|-------------------|-----------------------------------|
| `canvas:generate`   | client → server  | `prompt: string` (available for socket-based clients; the bundled UI uses REST `POST /generate` instead — see note below) |
| `canvas:generated`  | server → clients | `{ nodes: CanvasNode[] }`        |
| `node:move`         | client → server  | `{ id, x, y }`                    |
| `node:moved`        | server → clients | `{ id, x, y }` (clamped to canvas bounds) |
| `canvas:error`      | server → client  | `string` (error message)          |

**Note on `canvas:generate`:** the bundled frontend calls `POST /generate` over REST rather than emitting this socket event, so it can rely on real HTTP status codes for error handling. The successful result is still broadcast to every client via `canvas:generated`, so real-time sync is identical either way. The socket event is fully implemented server-side for any client that prefers a pure-socket flow.

## Persistence & reconnection

- Canvas state is persisted to `localStorage` on every update, so a refresh shows the last known layout instantly rather than a blank canvas while the socket reconnects. Note this is a perceived-continuity aid, not durable storage: the server holds one shared in-memory canvas per process, so on reconnect the server's authoritative state (which could be empty if the server restarted) always overwrites the local snapshot.
- The Socket.io client is configured with infinite reconnection attempts and capped backoff — the header shows **Live** / **Reconnecting…**.

## Notes on the LLM provider

The backend uses Groq's `llama-3.3-70b-versatile` model by default. To switch providers, only `backend/src/ai.ts` needs to change — swap the client and model name; validation and the rest of the app are provider-agnostic.

# AI Realtime Canvas

Type a prompt like *"Create 5 circles in a star layout"*, click **Generate**, and an LLM produces a JSON layout of shapes rendered live on a shared canvas. Every connected client stays in sync in real time — drag a shape in one tab, it moves in every other tab.

## Stack

- **Frontend:** Vite + React + TypeScript, `react-konva` for canvas rendering, Zustand for state, `socket.io-client` for real-time sync.
- **Backend:** Node.js + Express, Socket.io, Groq SDK (OpenAI-compatible) for the LLM call.

## Project structure

```
frontend/
  src/
    App.tsx        # prompt input, socket wiring, layout
    Canvas.tsx      # react-konva rendering + drag & drop
    store.ts        # Zustand store (single source of truth for nodes)
    socket.ts        # socket.io client with auto-reconnect
    types.ts        # shared shape/node types
backend/
  src/
    server.ts       # Express routes + Socket.io event handlers
    ai.ts            # LLM call, strict system prompt, output validation/clamping
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

Frontend runs on `http://localhost:5173`.

Open the URL in two browser tabs to see real-time sync in action.

## How generation works

1. Frontend sends `POST /generate` with `{ prompt }`.
2. Backend calls the LLM with a strict system prompt (JSON-only, circle/rectangle only, max 12 shapes, label ≤ 2 chars, coordinates within 800×600).
3. **The server never trusts the LLM's output directly** — `ai.ts` re-validates and clamps every field (drops disallowed shape types, truncates labels, clamps coordinates/sizes) before it ever reaches a client.
4. The sanitized result is broadcast to all connected clients via the `canvas:generated` socket event, so every open tab updates together.

## Socket events

| Event               | Direction        | Payload                          |
|---------------------|-------------------|-----------------------------------|
| `canvas:generate`   | client → server  | `prompt: string`                  |
| `canvas:generated`  | server → clients | `{ nodes: CanvasNode[] }`        |
| `node:move`         | client → server  | `{ id, x, y }`                    |
| `node:moved`        | server → clients | `{ id, x, y }`                    |
| `canvas:error`      | server → client  | `string` (error message)          |

(Generation is also exposed as `POST /generate` over REST for a simple request/response from the UI; the result is still broadcast over the socket so all clients sync.)

## Persistence & reconnection

- Canvas state is persisted to `localStorage` on every update, so refreshing a tab restores the last known layout instantly (it's then reconciled with the server's state on reconnect).
- The Socket.io client is configured with infinite reconnection attempts and capped backoff, so a dropped connection recovers automatically — the header shows **Live** / **Reconnecting…**.

## Notes on the LLM provider

The backend uses Groq's `llama-3.3-70b-versatile` model by default (fast + generous free tier, OpenAI-compatible SDK). To switch providers, only `backend/src/ai.ts` needs to change — swap the client and model name; the system prompt, validation, and rest of the app are provider-agnostic.
